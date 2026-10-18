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
const RealEstateExecutive = require('../models/realestate.executive.model');
const RealEstateVendor = require('../models/realestate.vendor.model');
const ApiError = require('../../../utils/ApiError');
const { status: httpStatus } = require('http-status');

/**
 * Executive tenant gate.
 *
 * ## 403, not 404, and not 401
 *
 * A signed-in user who is neither an executive nor a vendor gets **403**. The token
 * proved who they are, so pretending the resource is missing would be a lie; but 401
 * would wrongly suggest they should log in again when re-authenticating changes nothing.
 *
 * Doc §11.2 and the Phase 11b DoD both require the mutual exclusion explicitly: a vendor
 * session must be refused on every executive route, and an executive session on every
 * vendor route. That is why this checks the vendor table as well — without the vendor
 * branch, a user who is both would pass here, and the two roles live in the same app
 * (§15), so "user who is both" is not a hypothetical.
 *
 * ## No executive id in the path
 *
 * Doc §7.1. The id comes from the token and lands on `req.actorId`; handlers read only
 * that. An `/executive/:executiveId/...` route would let any executive act as any other
 * by editing a path segment.
 *
 * ## Suspended executives are refused
 *
 * `status` is checked, not just existence. An executive terminated last month still holds
 * a JWT that verifies cryptographically, and their phone is offline so they never learn
 * to discard it. Trusting the signature alone keeps a dead executive's token live until
 * it expires.
 *
 * Unlike the identifying middleware next door, this one **does** reject — it guards
 * authenticated routes only, so there is no anonymous case to fall through to.
 *
 * @param {object} req
 * @param {object} res
 * @param {function} next
 * @throws {ApiError} 401 when no usable token, 403 when the user is not an executive
 */
async function executiveAuth(req, res, next) {
  let payload;

  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'An executive access token is required');
    }

    payload = jwt.verify(header.slice('Bearer '.length), config.jwt.secret);

    if (!payload || payload.type !== tokenTypes.ACCESS || !payload.sub) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'An executive access token is required');
    }
  } catch (e) {
    // Preserve our own 401; a jwt.verify failure becomes one too.
    return next(
      e instanceof ApiError
        ? e
        : new ApiError(httpStatus.UNAUTHORIZED, 'An executive access token is required')
    );
  }

  try {
    const executive = await RealEstateExecutive.findOne({ user: payload.sub })
      .select('_id status operationalZone')
      .lean();

    if (!executive) {
      // Distinguish "wrong kind of user" from "no such user" so a vendor can tell that
      // re-logging-in as a vendor will not help.
      const isVendor = await RealEstateVendor.exists({ user: payload.sub });
      return next(
        new ApiError(
          httpStatus.FORBIDDEN,
          isVendor
            ? 'This is a vendor account. Executive routes require an executive account.'
            : 'This account is not a property executive'
        )
      );
    }

    if (executive.status !== 'ACTIVE') {
      return next(
        new ApiError(httpStatus.FORBIDDEN, `Executive account is ${executive.status}`)
      );
    }

    req.actorType = 'executive';
    req.actorId = executive._id;
    req.userId = payload.sub;
    req.executiveZone = executive.operationalZone;

    return next();
  } catch (e) {
    return next(e);
  }
}

module.exports = executiveAuth;