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
 * modification, or use of this source code in a public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const jwt = require('jsonwebtoken');
const config = require('../../../config/config');
const { tokenTypes } = require('../../../config/tokens');
const RealEstateVendor = require('../models/realestate.vendor.model');

/**
 * Real Estate tenant identification.
 *
 * Sets three things on the request and never throws:
 *
 *   req.actorType — 'guest' | 'customer' | 'vendor' | 'executive'
 *   req.actorId   — the RealEstateVendor / RealEstateExecutive _id, NOT the user id
 *   req.userId    — the platform User _id, which is what `payload.sub` carries
 *
 * ## Why it never throws
 *
 * It runs on the public search surface, where a customer browses before signing in.
 * A missing or expired token must leave `actorType = 'guest'` and let the request
 * continue — public listing search has to work anonymously. The 401 for a route that
 * genuinely needs a tenant belongs in the controller (`requireVendor`), not here.
 *
 * ## The token contract this reads
 *
 * `sub` is a **User id**, and `type` is `access`. That is what `config/passport.js`
 * mints and verifies, so this file reads the same claims. An earlier version of this
 * middleware tested `payload.role === 'RealEstateVendor'`, a claim no token in this
 * codebase has ever carried — which meant `actorType` was permanently `guest` and every
 * vendor route answered 401 no matter how the requires were spelled. A middleware that
 * identifies nobody is worse than no middleware, because it looks like it is working.
 *
 * ## `req.actorId` is the vendor document, not the user
 *
 * The vertical's services address vendors by `RealEstateVendor._id`
 * (`getVendorDashboard(vendorId)`, `consume(vendorId, …)`), while the token only knows
 * the User. So this resolves the user's vendor row once, here, and puts its `_id` on
 * `req.actorId`. Handlers then never take a vendor id from anywhere the client controls.
 *
 * Note the deliberate difference between the two: `vendorService.findByUser()` expects
 * the **User** id, so it is called with `req.userId`. Getting these two the wrong way
 * round is the single easiest mistake to make in this file, because both ids look alike
 * and one of them silently returns null instead of throwing.
 *
 * ## Body is wrapped in try/catch, not just the verify
 *
 * This is an `async` middleware. Under Node's default `--unhandled-rejections=throw`,
 * a rejection escaping here takes the whole process down — an unauthenticated visitor
 * to a public page would be able to crash the server. The catch is load-bearing.
 *
 * @param {object} req
 * @param {object} res
 * @param {function} next
 */
async function realestateTenantMiddleware(req, res, next) {
  req.actorType = 'guest';
  req.actorId = null;
  req.userId = null;

  try {
    const header = req.headers.authorization || '';

    if (!header.startsWith('Bearer ')) return next();

    const payload = jwt.verify(header.slice('Bearer '.length), config.jwt.secret);

    // A refresh token is a valid signature and must not be accepted as a tenant.
    if (!payload || payload.type !== tokenTypes.ACCESS || !payload.sub) return next();

    req.userId = payload.sub;

    const vendor = await RealEstateVendor.findOne({ user: payload.sub })
      .select('_id')
      .lean();

    if (vendor) {
      req.actorType = 'vendor';
      req.actorId = vendor._id;
    } else {
      // A signed-in user with no vendor row. Still not a guest — customer-scoped
      // document reads key off this.
      req.actorType = 'customer';
    }
  } catch {
    // Invalid, expired or unverifiable token → stay a guest. Never throw here.
    // Optional catch binding (`catch {`, ES2019) so there is no unused binding to name.
  }

  return next();
}

module.exports = realestateTenantMiddleware;