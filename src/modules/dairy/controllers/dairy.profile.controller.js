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

const catchAsync = require('../../../utils/catchAsync');
const pick = require('../../../utils/pick');
const dairyProfileService = require('../services/dairy.profile.service');

/**
 * @typedef Profile
 * @property {string} id
 * @property {string[]} availableRoles
 * @property {string} activeRole
 */

/**
 * Returns the dairy roles the authenticated session may render.
 *
 * Backs the role gate in
 * `DairyPartner_app/lib/app/presentation/pages/role_gate/`.
 *
 * The user comes from the access token. This used to read `:id` from the path,
 * which both made the route impossible to call — the path declared no `:id` —
 * and would have let any signed-in user read another user's roles.
 *
 * @returns {Object} role payload
 */
const availableRoles = catchAsync(async (req, res) => {
  const roles = await dairyProfileService.getAvailableRoles(req.user._id);
  res.send(pick(roles, ['id', 'firstName', 'lastName', 'email', 'mobile', 'countryCode', 'cover', 'role', 'roles']));
});

/**
 * The signed-in session: identity plus which shells this account may open.
 *
 * The app calls this on every cold start to decide whether to show the role gate,
 * so it deliberately answers even for an account with neither an outlet nor a
 * rider profile yet — the onboarding screens need something to render.
 *
 * @returns {Object} profile
 */
const profileMe = catchAsync(async (req, res) => {
  const profile = await dairyProfileService.getAvailableRoles(req.user._id);
  res.send(pick(profile, [
    'id', 'firstName', 'lastName', 'email', 'mobile', 'countryCode', 'cover', 'role', 'roles',
  ]));
});

/**
 * Validates a shell switch.
 *
 * `activeRole` is a device preference and is not persisted server-side — see
 * the note in `dairy.profile.service.js`.
 *
 * @returns {Object}
 */
const switchRole = catchAsync(async (req, res) => {
  // Token, not path: otherwise any signed-in user could switch another account's
  // shell by passing its id.
  const result = await dairyProfileService.switchRole(req.user._id, req.body.role);
  res.send(result);
});

module.exports = {
  profileMe,
  availableRoles,
  switchRole,
};