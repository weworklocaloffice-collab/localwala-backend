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

/**
 * Populates `req.outletId` from the authenticated user's own outlet.
 *
 * @returns {Function} Express middleware
 */
const resolveOutlet = async (req, res, next) => {
  try {
    const business = await profileService.resolveActorBusiness(req.user._id);
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
    return resolveOutlet(req, res, next);
  });
};

module.exports = {
  resolveOutlet,
  partnerAuth,
};