/**
 * LocalWala – Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright © 2026 WeWorkLocal Private Limited
 * https://weworklocal.in/
 *
 * WeWorkLocal Private Limited
 *
 * This source code is confidential.
 * Unauthorized copying, redistribution, resale, publication,
 * modification, or use of this source code in any public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
// The same strategy `appAuth` uses. Naming a strategy directly here would register a
// second middleware bound to a name passport never had, which fails at request time
// with "Unknown authentication strategy".
const appAuth = require('../../../middlewares/appAuth');
const { JhatkaCompliance } = require('../../../models');
const profileService = require('../services/jhatka.profile.service');
const { deriveComplianceStatus } = require('../utils/compliance.arithmetic');

/**
 * Jhatka tenant resolution. §2.3. The pattern is copied from `stores.tenant.js`;
 * the file is not, because the middleware here resolves an OUTLET and stores
 * resolves an outlet AND a chain.
 *
 * ## What lands on the request
 *
 *   req.outletId       the active outlet as a STRING (BR-04)
 *   req.businessId     the owning business as a STRING
 *   req.role           the outlet role, for `assertCan`
 *   req.outlet         the outlet document
 *   req.assignment     the `JhatkaTenantRoleAssignment`, or null for a driver
 *   req.permittedOutletIds  everything this actor may act on
 *   req.isJhatkaDriver  whether this is a rider
 *   req.driver         the driver document
 *   req.isPlatformPoolDriver  a rider with no outlet, paid from the pool
 *
 * ## Every id is a STRING. §2.3.
 *
 * `result.outlet._id` is an ObjectId instance and `req.outletId` is compared against
 * `assignment.outlets[]` entries, which are ObjectIds too, and against header
 * values, which are strings. `===` between any two of those is unreliable, and the
 * failure is a silent fall-through to the wrong outlet rather than an exception.
 * Every id is `.toString()`ed at the boundary and compared with
 * `profileService.sameId`.
 *
 * ## Deliberately NOT written as "overwrite req.params.id"
 *
 * `stores.tenant.js` gives the reason and it is worth repeating: it leaves a handler
 * reading a key whose name says "the client sent this" while its value came from the
 * token, and that ambiguity is eventually mistaken for a trust boundary.
 */

/**
 * Populate the active outlet, business and role from the token plus session.
 *
 * @returns {Function} Express middleware
 */
const resolveOutlet = async (req, res, next) => {
  try {
    // Attacker-controlled. Treated as a HINT and checked against the actor's scope
    // by `resolveActorOutlet`, so a forged header can only ever name an outlet the
    // caller is already authorised for.
    //
    // No session: this platform is stateless JWT. When the header is absent the
    // service falls back to `lastActiveOutletId`, which lives in the database and
    // therefore cannot be forged.
    const hinted = req.get('X-Jhatka-Outlet') || (req.body && req.body.outletHint);

    const result = await profileService.resolveActorOutlet(req.user._id, hinted);

    // A platform-pool rider resolves to `outlet: null` — they belong to no counter.
    // They still get a session; their routes scope by `driver`, not by outlet.
    req.outletId = result.outletId ? String(result.outletId) : null;
    req.businessId = result.business ? String(result.business) : null;
    req.role = result.role;
    req.outlet = result.outlet;
    req.assignment = result.assignment;
    req.permittedOutletIds = result.permittedOutletIds || [];
    req.isJhatkaDriver = result.isDriver === true;
    req.driver = result.driver;
    req.isPlatformPoolDriver = result.isPlatformPoolDriver === true;
    req.outletHintedByClient = !!hinted;

    return next();
  } catch (error) {
    return next(
      error instanceof ApiError
        ? error
        : new ApiError(httpStatus.FORBIDDEN, error.message)
    );
  }
};

/**
 * Authenticate, then pin the outlet — in that order.
 *
 * They cannot be reversed: `resolveOutlet` needs `req.user`, which exists only once
 * the token has been verified. Partner and driver routes use this instead of a bare
 * `appAuth(...)` so the outlet is ALWAYS resolved and a route cannot accidentally opt
 * out of tenancy scoping.
 *
 * @param {...string} requiredRights
 * @returns {Function} Express middleware
 */
const jhatkaAuth = (...requiredRights) => async (req, res, next) => {
  return appAuth(...requiredRights)(req, res, async (authError) => {
    if (authError) return next(authError);
    return resolveOutlet(req, res, next);
  });
};

/**
 * Authenticate and resolve SCOPE, without pinning an outlet.
 *
 * ## Why a second middleware rather than `jhatkaAuth` everywhere
 *
 * Four routes cannot use it:
 *
 *   GET  /jhatka/partner/outlets       the picker — lists every outlet it MAY reach
 *   POST /jhatka/partner/session/outlet validates a switch target against scope
 *   GET  /jhatka/partner/scope         the whole scope map
 *   GET  /jhatka/partner/subscription-list  a customer browsing across outlets
 *
 * Each is circular under `jhatkaAuth`: the picker would depend on an active outlet,
 * but an active outlet is chosen BY the picker. And a partner whose outlets are all
 * suspended must still be able to see and switch to them, which `jhatkaAuth` refuses.
 *
 * So `jhatkaScope` populates the authorised set and leaves `req.outletId` UNSET. That
 * absence is the safety property: a handler that acts on an outlet and forgets
 * `jhatkaAuth` gets `req.outletId === undefined` and fails loudly rather than acting
 * on an arbitrary outlet.
 *
 * @param {...string} requiredRights
 * @returns {Function} Express middleware
 */
const jhatkaScope = (...requiredRights) => async (req, res, next) => {
  return appAuth(...requiredRights)(req, res, async (authError) => {
    if (authError) return next(authError);
    try {
      const scope = await profileService.resolveActorScope(req.user._id);
      req.scopeGroups = scope.groups;
      req.permittedOutletIds = scope.permittedOutletIds || [];
      req.role = scope.role;
      req.assignment = scope.assignment;
      req.isJhatkaDriver = scope.isDriver === true;
      req.driver = scope.driver;
      // Deliberately NOT set: outletId, businessId, outlet. See the note above.
      return next();
    } catch (error) {
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(httpStatus.FORBIDDEN, error.message)
      );
    }
  });
};

/**
 * Guard a route by role, for outlet authority the rights map does not express.
 *
 * A FAST FAIL only. The enforcement is `profileService.assertCan` inside the service,
 * because this checks `req.role` and nothing about scope — a `weigher` on outlet A is
 * still a `weigher` on outlet B as far as this middleware is concerned.
 *
 * @param {...string} roles allowed roles
 * @returns {Function} Express middleware
 */
const requireRole = (...roles) => async (req, res, next) => {
  if (!req.role || !roles.includes(req.role)) {
    return next(
      new ApiError(
        httpStatus.FORBIDDEN,
        `Role '${req.role || 'unknown'}' may not use this route`,
        true,
        '',
        { role: req.role, allowed: roles }
      )
    );
  }
  return next();
};

/**
 * Reject a request that carries a client-supplied outlet hint.
 *
 * ## Why any at all
 *
 * Blueprint §8 requires the customer to see products available for THEIR address,
 * not every outlet in the city. That makes `lat`/`lng` or a locality legitimate
 * input on a BROWSING route. It does not make an arbitrary `outletId` legitimate on
 * a MUTATING one, and a route that takes an outlet id as a query parameter is one
 * refactor away from trusting it.
 *
 * So: routes that resolve their own outlet from the token call this, and a hint in a
 * body that they are about to ignore becomes a 400 rather than a silent no-op that
 * looks like a successful empty result.
 *
 * @returns {Function} Express middleware
 */
const rejectClientOutlet = async (req, res, next) => {
  const hinted = req.get('X-Jhatka-Outlet') || (req.body && req.body.outletHint);
  if (hinted) {
    return next(
      new ApiError(
        httpStatus.BAD_REQUEST,
        'This route resolves its outlet from your session; the outlet hint is not accepted'
      )
    );
  }
  return next();
};

/**
 * Require an ACTIVE outlet for a mutating route.
 *
 * ## This is a caller decision, not a model one
 *
 * `DairyCompliance`'s rule, carried here: encoding the block in the model silently
 * makes compliance a trading decision. So this is an explicit middleware a route
 * opts into, and a read route deliberately does not.
 *
 * A SUSPENDED outlet must still be readable so an in-flight order stays trackable —
 * `JhatkaOutlet.capabilities().fulfilExisting` is true in every non-draft state,
 * because a shop whose FSSAI lapsed at noon still owes the chicken it accepted at
 * 11:55.
 *
 * @returns {Function} Express middleware
 */
const requireActiveOutlet = async (req, res, next) => {
  if (!req.outlet) {
    return next(
      new ApiError(httpStatus.FORBIDDEN, 'This route requires an outlet session')
    );
  }

  const capabilities = req.outlet.capabilities
    ? req.outlet.capabilities()
    : { acceptNewOrders: req.outlet.status === 'active' };

  if (!capabilities.acceptNewOrders) {
    return next(
      new ApiError(
        httpStatus.FORBIDDEN,
        `This outlet cannot accept new work while '${req.outlet.status}'`,
        true,
        '',
        // Machine-readable, so callers and tests can distinguish "suspended" from
        // every other 403 without parsing prose. Added when the compliance gate
        // (§12.2) was built: this middleware is the single suspension enforcement
        // for partner routes, and the gate delegates to it rather than duplicating
        // it — two suspension checks is how one of them goes stale.
        {
          code: 'OUTLET_NOT_TRADING',
          status: req.outlet.status,
          reason: req.outlet.suspensionReason || req.outlet.statusReason,
        }
      )
    );
  }

  return next();
};

/**
 * Require compliance permission to be current. §12.
 *
 * Separate from `requireActiveOutlet` because they answer different questions and
 * the difference is operationally important: a non-compliant outlet can usually still
 * FULFIL, and blocking fulfilment turns a paperwork problem into a pile of
 * already-paid orders nobody can deliver.
 */
const requireComplianceCurrent = async (req, res, next) => {
  if (!req.outletId) {
    return next(
      new ApiError(httpStatus.FORBIDDEN, 'This route requires an outlet session')
    );
  }

  const compliance = await JhatkaCompliance.findOne({ outlet: req.outletId }).lean();
  if (!compliance) {
    return next(
      new ApiError(httpStatus.FORBIDDEN, 'This outlet has no compliance record')
    );
  }

  // `compliance.fssai`, not `compliance` — see the note on
  // `JhatkaCompliance.deriveStatus`, where passing the whole record silently
  // returned `pending` for every outlet in the country.
  const status = deriveComplianceStatus(compliance.fssai, new Date(), 30);

  // `expiring` is allowed. 30 days of warning is not a reason to stop trading.
  if (status !== 'valid' && status !== 'expiring') {
    return next(
      new ApiError(
        httpStatus.FORBIDDEN,
        `This outlet's FSSAI status is '${status}'`,
        true,
        '',
        { complianceStatus: status }
      )
    );
  }

  return next();
};

module.exports = {
  resolveOutlet,
  jhatkaAuth,
  jhatkaScope,
  requireRole,
  rejectClientOutlet,
  requireActiveOutlet,
  requireComplianceCurrent,
};