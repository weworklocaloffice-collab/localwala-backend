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

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const { User, Business, DairyDriver, DairyFranchise } = require('../../../models');
const ApiError = require('../../../utils/ApiError');

/**
 * Roles a single `User` document may hold on the dairy side.
 *
 * `User.role` is a single-value enum (models/user.model.js:61), so an
 * owner-operator cannot express "partner AND rider" there. Availability is
 * therefore derived rather than stored: a user can act as a partner if they own
 * a business, and as a rider if a `DairyDriver` profile exists for them.
 */
const DAIRY_PARTNER = 'dairyPartner';
const DAIRY_DRIVER = 'dairyDriver';

/**
 * The outlet a signed-in partner is allowed to act on.
 *
 * ## Why this exists
 *
 * Partner routes used to take the outlet id in the path and trust it. Nothing
 * checked that the caller owned it, so any partner could read — and on the write
 * routes, modify — another outlet's orders, cans, procurement and compliance just
 * by editing a URL. That is an IDOR, and it is closed by never accepting the outlet
 * from the client at all.
 *
 * ## Why franchise operation counts too
 *
 * `DairyFranchise` already carries `operator` and `business`, so a franchisee
 * holding agreements over several outlets is expressible in the data model even
 * though the seed data does not use it. Checking ownership alone would have locked
 * that case out and needed unpicking later.
 *
 * ## Extending it
 *
 * This is deliberately a whitelist that starts narrow. When a "manages" relation
 * is needed — a hired outlet manager who neither owns nor franchises — add that
 * lookup here. No route changes, because no route carries the outlet any more.
 *
 * @param {string} userId the authenticated user's id
 * @returns {Promise<Object>} the `Business` document
 */
const resolveActorBusiness = async (userId) => {
  const owned = await Business.findOne({
    owner: userId,
    vertical: 'dairy',
    status: true,
  });
  if (owned) {
    return owned;
  }

  const agreement = await DairyFranchise.findOne({
    operator: userId,
    status: 'active',
  }).select('business');

  if (agreement && agreement.business) {
    const operated = await Business.findOne({
      _id: agreement.business,
      vertical: 'dairy',
      status: true,
    });
    if (operated) {
      return operated;
    }
  }

  throw new ApiError(
    httpStatus.FORBIDDEN,
    'No dairy outlet is linked to this account'
  );
};

/**
 * Resolves the set of dairy roles a user holds.
 *
 * This is what drives the Flutter role gate. The response shape must stay in
 * sync with `UserSessionModel.fromJson` in
 * `DairyPartner_app/lib/app/core/models/user_session_model.dart`.
 *
 * @param {string} uid
 * @returns {Promise<Object>} role payload
 */
const getAvailableRoles = async (uid) => {
  const userId = new mongoose.Types.ObjectId(uid);

  const user = await User.findById(userId).select('role firstName lastName email mobile countryCode cover status');
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!(user.status === true)) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Account Blocked');
  }

  const isDairyUser = user.role === DAIRY_PARTNER || user.role === DAIRY_DRIVER;
  if (!isDairyUser) {
    // A signed-in customer is not an error here. They hold no dairy shell, so
    // there is nothing to resolve — but the app calls this on every cold start to
    // decide what to render, and answering 401 to a legitimate customer made the
    // whole app bounce to login.
    //
    // Identity is returned with an empty role set. Authorisation for anything the
    // customer actually calls is enforced per-endpoint by the `dairy_customer_*`
    // rights in `config/roles.js`.
    return {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      mobile: user.mobile,
      countryCode: user.countryCode,
      cover: user.cover,
      role: user.role,
      roles: {
        available: [],
        active: user.role,
        ownDeliveryPartner: false,
        driverPayoutMode: null,
        dairyDriver: null,
        business: null,
      },
    };
  }

  const [business, driver] = await Promise.all([
    Business.findOne({ owner: userId, status: true }).select(
      '_id name businessModel ownDeliveryPartner driverPayoutMode'
    ),
    DairyDriver.findOne({ userId: userId }).select(
      '_id business payoutMode canCapacity vehicleType'
    ),
  ]);

  const available = [];
  if (business) {
    available.push(DAIRY_PARTNER);
  }
  if (driver) {
    available.push(DAIRY_DRIVER);
  }

  // A dairy user with neither an outlet nor a rider profile yet is still allowed
  // in, on their primary role, so the app has something to render while the
  // onboarding flow completes.
  if (available.length === 0) {
    available.push(user.role === DAIRY_DRIVER ? DAIRY_DRIVER : DAIRY_PARTNER);
  }

  return {
    id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    mobile: user.mobile,
    countryCode: user.countryCode,
    cover: user.cover,
    role: user.role,
    roles: {
      available: available,
      active: available.includes(user.role) ? user.role : available[0],
      ownDeliveryPartner: business ? business.ownDeliveryPartner === true : false,
      driverPayoutMode: business ? business.driverPayoutMode : null,
      dairyDriver: driver ? driver._id : null,
      business: business ? business._id : null,
    },
  };
};

/**
 * Validates a requested shell switch.
 *
 * `activeRole` is deliberately NOT persisted server-side. It is a device
 * preference, and authorization is enforced per-endpoint by the `dairyPartner`
 * and `dairyDriver` rights in `config/roles.js`. Persisting it on `User` would
 * mean writing an ad-hoc field into `models/user.model.js` for no security
 * benefit. The client keeps it in SharedPreferences.
 *
 * @param {string} uid
 * @param {string} role
 * @returns {Promise<Object>}
 */
const switchRole = async (uid, role) => {
  const payload = await getAvailableRoles(uid);
  if (!payload.roles.available.includes(role)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
  }

  return {
    success: true,
    message: 'Role switched',
    roles: { ...payload.roles, active: role },
  };
};

/**
 * Login payload returned alongside tokens.
 *
 * @param {string} uid
 * @returns {Promise<Object>}
 */
const getDairyLoginInfo = async (uid) => {
  const payload = await getAvailableRoles(uid);
  return {
    id: payload.id,
    firstName: payload.firstName,
    lastName: payload.lastName,
    email: payload.email,
    mobile: payload.mobile,
    countryCode: payload.countryCode,
    cover: payload.cover,
    role: payload.role,
    availableRoles: payload.roles.available,
    activeRole: payload.roles.active,
    ownDeliveryPartner: payload.roles.ownDeliveryPartner,
    driverPayoutMode: payload.roles.driverPayoutMode,
    dairyDriver: payload.roles.dairyDriver,
    business: payload.roles.business,
  };
};

module.exports = {
  DAIRY_PARTNER,
  DAIRY_DRIVER,
  resolveActorBusiness,
  getAvailableRoles,
  switchRole,
  getDairyLoginInfo,
};