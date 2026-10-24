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

const { createOptionalAuthMiddleware } = require('./auth.factory');

/**
 * Populates `req.user` when a valid app token is sent, and lets the request
 * through as a guest when it is missing or stale. Used by the reels feed and
 * comment list so signed-out visitors can watch a limited number of reels.
 */
const appAuthOptional = createOptionalAuthMiddleware('jwt-app');

module.exports = appAuthOptional;
