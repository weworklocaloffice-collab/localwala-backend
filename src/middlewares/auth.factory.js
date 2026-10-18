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

const passport = require('passport');
const { status: httpStatus } = require('http-status');
const ApiError = require('../utils/ApiError');
const { roleRights } = require('../config/roles');

const verifyCallback = (req, resolve, reject, requiredRights) => async (err, user, info) => {
  if (err || info || !user) {
    return reject(new ApiError(httpStatus.UNAUTHORIZED, 'Please authenticate'));
  }

  req.user = user;

  if (requiredRights.length) {
    const userRights = roleRights.get(user.role) || [];
    // OR semantics: holding ANY listed right suffices. All existing
    // callers pass exactly one right (verified — no multi-arg callers
    // for webAuth/appAuth), so this is behavior-preserving and lets
    // read routes admit `audit_view` alongside the area right.
    const hasRequiredRights = requiredRights.some((requiredRight) => userRights.includes(requiredRight));

    if (!hasRequiredRights && req.params.userId !== user.id) {
      return reject(new ApiError(httpStatus.FORBIDDEN, 'Forbidden'));
    }
  }

  return resolve();
};

const createAuthMiddleware = (strategyName) => {
  return (...requiredRights) => {
    return async (req, res, next) => {
      return new Promise((resolve, reject) => {
        passport.authenticate(
          strategyName,
          { session: false },
          verifyCallback(req, resolve, reject, requiredRights)
        )(req, res, next);
      })
        .then(() => next())
        .catch((err) => next(err));
    };
  };
};

module.exports = {
  createAuthMiddleware,
};

