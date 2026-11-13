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

/**
 * The outlet a request is acting on, taken from the access token.
 *
 * ## Why a middleware rather than a service call per handler
 *
 * Every partner route acts on exactly one outlet, and that outlet is whatever the
 * signed-in partner owns or franchises. Express has no notion of "the resource
 * this request is about" beyond the path, so without this the outlet would either
 * come from the URL — which any client can edit — or be resolved by hand in ~30
 * handlers, where one omission reopens the hole everywhere else.
 *
 * So it is resolved once, here, and put on the request as `req.outletId`. Handlers
 * read `req.outletId` and never `req.params.id`; the route paths no longer carry the
 * outlet at all, so there is nothing left to tamper with.
 *
 * Deliberately **not** written as "overwrite `req.params.id`". That would have been
 * a smaller diff, but it leaves a handler reading a key whose name says "the client
 * sent this" while its value came from the token — the kind of ambiguity that
 * eventually gets mistaken for a trust boundary.
 *
 * A 403 here means the account has no outlet. That is a real state — a partner
 * mid-onboarding — so the message says so rather than reporting a missing resource.
 */

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
// The same strategy `appAuth` uses. Naming it directly here would register a
// second middleware bound to a strategy name passport never had, which fails at
// request time with "Unknown authentication strategy".
const appAuth = require('../../../middlewares/appAuth');
const profileService = require('../services/dairy.profile.service');
const { LOCATION_REQUIRED_MESSAGE, locationRequirements } = require('../services/dairy.outlet.location');
const { DairyPartner, DairyFranchise } = require('../../../models');

// A verified partner may enter the dashboard and the outlet-profile setup
// flow before the physical address is complete. Every operational partner
// endpoint stays behind this check; the owner cannot bypass it with an older
// or modified client.
const setupAllowedPaths = new Set([
  '/partner/dashboard',
  '/partner/profile/business',
  '/partner/franchise/joining-fee/pay',
  '/partner/outlets',
  '/partner/outlets/select',
  '/partner/support/chat',
]);

const assertCommercialAgreementReady = async (business) => {
  if (business.businessModel === 'direct') return;
  if (business.businessModel === 'commission_partner') {
    const agreement = await DairyPartner.findOne({ business: business._id, status: 'active' }).select('_id');
    if (agreement) return;
    throw new ApiError(httpStatus.CONFLICT, 'Your commission agreement is awaiting activation by the platform');
  }
  if (business.businessModel === 'franchise') {
    const agreement = await DairyFranchise.findOne({ business: business._id }).select(
      'status joiningFee joiningFeePaymentStatus'
    );
    if (
      agreement && agreement.status === 'active' &&
      (Number(agreement.joiningFee || 0) <= 0 || ['paid', 'waived', 'not_required'].includes(agreement.joiningFeePaymentStatus))
    ) return;
    throw new ApiError(httpStatus.CONFLICT, 'Your franchise agreement and joining fee must be completed before trading');
  }
  throw new ApiError(httpStatus.CONFLICT, 'Your business model is awaiting an agreement from the platform');
};

/**
 * Populates `req.outletId` from the authenticated user's own outlet.
 *
 * @returns {Function} Express middleware
 */
const resolveOutlet = async (req, res, next) => {
  try {
    const business = await profileService.resolveActorBusiness(
      req.user._id,
      req.headers['x-dairy-outlet-id']
    );
    req.outletId = business._id.toString();
    req.outlet = business;
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
 * They cannot be reversed: `resolveOutlet` needs `req.user`, which only exists
 * once the token has been verified. Partner routes use this instead of a bare
 * `appAuth(...)` so the outlet is always resolved and a route cannot accidentally
 * opt out of it.
 *
 * @param {...string} requiredRights
 * @returns {Function} Express middleware
 */
const partnerAuth = (...requiredRights) => async (req, res, next) => {
  return appAuth(...requiredRights)(req, res, async (authError) => {
    if (authError) {
      return next(authError);
    }
    return resolveOutlet(req, res, async (outletError) => {
      if (outletError) return next(outletError);
      const normalizedPath = req.path.replace(/\/+$/, '') || '/';
      const isSupportPath = normalizedPath.startsWith('/partner/support/chat');
      if (setupAllowedPaths.has(normalizedPath) || isSupportPath) {
        if (req.method === 'PATCH' && normalizedPath === '/partner/profile/business' && req.outlet.verified !== true) {
          return next(new ApiError(httpStatus.FORBIDDEN, 'Outlet address and map pin setup becomes available after admin verification'));
        }
        if (normalizedPath === '/partner/franchise/joining-fee/pay' && req.outlet.verified !== true) {
          return next(new ApiError(httpStatus.FORBIDDEN, 'Your outlet application must be approved before paying the franchise joining fee'));
        }
        return next();
      }
      if (req.outlet.verified !== true) {
        return next(new ApiError(httpStatus.FORBIDDEN, 'Your Dairy partner account is waiting for admin verification'));
      }
      const requirements = locationRequirements(req.outlet);
      if (!requirements.complete) {
        return next(new ApiError(httpStatus.CONFLICT, LOCATION_REQUIRED_MESSAGE, true, '', {
          code: 'OUTLET_LOCATION_REQUIRED',
          missing: requirements.missing,
        }));
      }
      try {
        await assertCommercialAgreementReady(req.outlet);
      } catch (agreementError) {
        return next(agreementError);
      }
      return next();
    });
  });
};

module.exports = {
  resolveOutlet,
  partnerAuth,
};
