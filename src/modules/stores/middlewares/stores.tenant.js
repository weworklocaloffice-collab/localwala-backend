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
const profileService = require('../services/stores.profile.service');

/**
 * The OUTLET a request acts on, resolved from the access token and the session.
 *
 * ## Why a middleware rather than a service call per handler
 *
 * Every partner and driver route acts on exactly one outlet. Express has no notion of
 * "the resource this request is about" beyond the path, so without this the outlet
 * would either come from the URL — which any client can edit — or be resolved by hand
 * in every handler, where a single omission reopens the hole everywhere else.
 *
 * So it is resolved once, here, and put on the request. Handlers read `req.outletId`.
 * The route paths carry no outlet id at all, so there is nothing left to tamper with.
 *
 * ## What lands on the request
 *
 *   req.outletId  the active outlet, validated against the actor's scope  (BR-38)
 *   req.chainId   the owning chain
 *   req.role      the actor's role, for assertCan
 *   req.outlet    the outlet document
 *   req.chain     the chain document
 *   req.assignment the StoreRoleAssignment, or null for a driver
 *   req.permittedOutletIds  everything this actor may act on — for the switcher
 *
 * ## Deliberately NOT written as "overwrite req.params.id"
 *
 * That would be a smaller diff, but it leaves a handler reading a key whose name says
 * "the client sent this" while its value came from the token. That ambiguity is
 * eventually mistaken for a trust boundary, which is how Dairy defect 12 happened.
 */

/**
 * Populate the active outlet, chain and role from the token plus session.
 *
 * @returns {Function} Express middleware
 */
const resolveOutlet = async (req, res, next) => {
  try {
    // The caller states which outlet it means. This header is attacker-controlled, so
    // it is treated as a HINT and checked against the actor's scope by
    // `resolveActorOutlet`. A forged header can only ever name an outlet the caller is
    // already authorised for.
    //
    // There is deliberately no session here: this platform is stateless JWT. When the
    // header is absent, `resolveActorOutlet` falls back to the actor's
    // `lastActiveOutletId`, which lives in the database and therefore cannot be forged.
    const hinted = req.get('X-Store-Outlet') || (req.body && req.body.outletHint);

    const result = await profileService.resolveActorOutlet(req.user._id, hinted);

    req.outletId = result.outlet._id.toString();
    req.chainId = result.chain._id.toString();
    req.role = result.role;
    req.outlet = result.outlet;
    req.chain = result.chain;
    req.assignment = result.assignment;
    req.permittedOutletIds = result.permittedOutletIds;
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
 * They cannot be reversed: `resolveOutlet` needs `req.user`, which only exists once
 * the token has been verified. Partner and driver routes use this instead of a bare
 * `appAuth(...)` so the outlet is always resolved and a route cannot accidentally opt
 * out of it.
 *
 * @param {...string} requiredRights
 * @returns {Function} Express middleware
 */
const storeAuth = (...requiredRights) => async (req, res, next) => {
  return appAuth(...requiredRights)(req, res, async (authError) => {
    if (authError) {
      return next(authError);
    }
    return resolveOutlet(req, res, next);
  });
};

/**
 * For routes that need only the session's outlet and are safe while suspended.
 * Reviewing a return, reading a settlement, changing the plan. FULFILMENT is never
 * blocked — a suspended outlet must still deliver and settle what customers paid for.
 */
const storeAuthSuspendedOk = (...requiredRights) => async (req, res, next) => {
  return appAuth(...requiredRights)(req, res, async (authError) => {
    if (authError) {
      return next(authError);
    }
    return resolveOutlet(req, res, next);
  });
};

/**
 * Authenticate and resolve SCOPE, without requiring an active outlet.
 *
 * ## Why a second middleware, not `storeAuth` everywhere
 *
 * `storeAuth` pins exactly one active outlet. Three routes cannot use it:
 *
 *   GET  /stores/outlets         the picker - lists every outlet it MAY reach
 *   POST /stores/session/outlet  validates a switch target against scope
 *   GET  /stores/scope           the whole scope map
 *
 * Each of those is circular under `storeAuth`: the picker would depend on an active
 * outlet, but an active outlet is chosen by the picker. And a partner whose outlets are
 * all suspended must still be able to see and switch to them, which `storeAuth` refuses
 * because the outlet is not active.
 *
 * So `storeScope` populates the full authorised set and leaves `req.outletId` UNSET.
 * That absence is the safety property: a handler that acts on an outlet and forgets
 * `storeAuth` gets `req.outletId === undefined` and fails loudly instead of acting on an
 * arbitrary outlet.
 *
 * @param {...string} requiredRights
 * @returns {Function} Express middleware
 */
const storeScope = (...requiredRights) => async (req, res, next) => {
  return appAuth(...requiredRights)(req, res, async (authError) => {
    if (authError) {
      return next(authError);
    }
    try {
      const scope = await profileService.resolveActorScope(req.user._id);
      req.scopeGroups = scope.groups;
      req.permittedOutletIds = scope.permittedOutletIds;
      req.role = scope.role;
      req.assignment = scope.assignment;
      req.isStoreDriver = scope.isDriver;
      // Deliberately NOT set: outletId, chainId, outlet, chain. See the note above.
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
 * Guard a route by role, for rights the role map does not express as a permission
 * string. Call `profileService.assertCan` inside the service for the real check; this
 * is the route-level fast fail.
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
 * A 403 here means the account has no outlet. That is a real state — a partner
 * mid-onboarding — so the message says so rather than reporting a missing resource.
 */
module.exports = {
  resolveOutlet,
  storeAuth,
  storeAuthSuspendedOk,
  storeScope,
  requireRole,
  appAuth,
};