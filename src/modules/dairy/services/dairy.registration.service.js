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
const {
  User,
  Business,
  City,
  Locality,
  DairyDriver,
  DairyDriverInvite,
  DairyJoiningRequest,
} = require('../../../models');
const ApiError = require('../../../utils/ApiError');
const { withOptionalTransaction } = require('../../../utils/optionalTransaction');
const verticalService = require('../../../kernel/vertical/services/vertical.service');

/**
 * Confirms a locality really belongs to the city it was submitted with.
 *
 * Both fields being present is not enough. Without this, a client could send a
 * valid city id and a valid locality id that belong to *different* cities, and
 * the outlet would land in a zone that contradicts its own address. The app's
 * cascading dropdown makes that unlikely, but the dropdown is a convenience —
 * the pairing has to be enforced where it can be trusted.
 *
 * Both must also be active, so an outlet cannot be registered into a city or
 * locality an admin has switched off.
 *
 * @param {string} cityId
 * @param {string} localityId
 * @returns {Promise<void>} throws ApiError if either is unknown, inactive, or mismatched
 */
const assertLocationPairing = async (cityId, localityId) => {
  const [city, locality] = await Promise.all([
    City.findOne({ _id: cityId, status: true }).select('_id'),
    Locality.findOne({ _id: localityId, status: true }).select('_id city'),
  ]);

  if (!city) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'That city is not one we serve');
  }
  if (!locality) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'That locality is not one we serve');
  }
  if (String(locality.city) !== String(cityId)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'That locality does not belong to the selected city'
    );
  }
};

/**
 * Self-registration for the dairy vertical.
 *
 * Roles are allowlisted to `dairyPartner` and `dairyDriver` only. `admin`,
 * `accountant`, `cityMaster` and friends are never self-selectable — the
 * allowlist is the security boundary, matching the existing pattern at
 * `validations/auth.validation.js:240` where `vendor`/`user` are allowlisted.
 *
 * Registration always succeeds and the account can always log in. Compliance
 * review is tracked separately on `DairyJoiningRequest` and gates commercial
 * actions (receiving orders, raising payouts) via `Business.verified`, not
 * access. Blocking login on approval would make the vertical untestable.
 */

/**
 * Partner registration.
 *
 * Creates the user, an unverified `Business`, and a pending
 * `DairyJoiningRequest` for admin review of FSSAI / GST / identity.
 *
 * @param {Object} param
 * @returns {Promise<{user: Object, business: Object, request: Object}>}
 */
const registerPartner = async (param) => {
  const existing = await User.findOne({
    countryCode: param.countryCode,
    mobile: param.mobile,
  });
  if (existing) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already registered');
  }

  // Checked before anything is written, so a bad pair cannot leave half an
  // account behind.
  await assertLocationPairing(param.city, param.locality);

  // The vertical is fixed at `dairy` here, but the check is against the registry
  // rather than the constant: if the line were ever halted, registration should
  // stop taking new outlets instead of quietly accumulating ones that cannot
  // trade.
  await verticalService.assertRegistered('dairy');


  try {
    const created = await withOptionalTransaction(async (session) => {
      const user = await User.create(
        [
          {
            firstName: param.firstName,
            lastName: param.lastName,
countryCode: param.countryCode,
            mobile: param.mobile,
            email: param.email,
            // Required by the User model. This was never passed through, so
            // `registerPartner` and `registerDriver` both failed validation on
            // `password` and *nobody* could register on the dairy vertical.
            password: param.password,
            role: 'dairyPartner',
            locale: param.locale,
            isMobileVerified: true,
            status: true,
          },
        ],
        { session }
      );

      const business = await Business.create(
        [
          {
            vertical: 'dairy',
            businessModel: param.businessModel,
            name: param.businessName,
            description: param.shortDescription,
            logo: param.logo,
            cover: param.cover,
            city: param.city ? new mongoose.Types.ObjectId(param.city) : null,
            locality: param.locality ? new mongoose.Types.ObjectId(param.locality) : null,
            location: param.coordinates
              ? { type: 'Point', coordinates: param.coordinates }
              : undefined,
            owner: user[0]._id,
            contact: {
              name: `${param.firstName} ${param.lastName}`,
              mobile: param.mobile,
              countryCode: param.countryCode,
              email: param.email,
            },
              // Every dairy outlet runs its own riders, so this is no longer a
              // choice. The field stays on the shared `Business` model because
              // restaurant still branches on it, but dairy always sets it true —
              // an outlet with it false would have no way to get anyone to deliver
              // its orders, since there is no platform pool to fall back on.
              ownDeliveryPartner: true,
              // Likewise the rider is the outlet's employee, so the outlet pays.
              // `platform_pays` only ever meant "the platform employs this rider",
              // and there are no platform riders.
              driverPayoutMode: 'business_pays',
            // Unverified. Admin approval via DairyJoiningRequest sets this true.
            verified: false,
            status: true,
          },
        ],
        { session }
      );

      const request = await DairyJoiningRequest.create(
        [
          {
            user: user[0]._id,
            business: business[0]._id,
            businessModel: param.businessModel,
            name: param.businessName,
            address: param.address,
            shortDescription: param.shortDescription,
            logo: param.logo,
            cover: param.cover,
            city: param.city ? new mongoose.Types.ObjectId(param.city) : null,
            locality: param.locality ? new mongoose.Types.ObjectId(param.locality) : null,
            location: param.coordinates
              ? { type: 'Point', coordinates: param.coordinates }
              : undefined,
            expectedDrivers: param.expectedDrivers,
            fssaiLicence: param.fssaiLicence,
            fssaiExpiry: param.fssaiExpiry,
            gstNumber: param.gstNumber,
            identityProof: param.identityProof,
            status: 'pending',
          },
        ],
{ session }
      );

      return { user: user[0], business: business[0], request: request[0] };
    });

    return created;
  } catch (error) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, error.message);
  }
};

/**
 * Rider registration.
 *
 * Creates the user and a `DairyDriver` profile. When the rider was invited by a
 * partner, `business` is taken from the invite so they join that outlet's own
 * fleet; otherwise `business` stays null and they draw from the platform pool —
 * the same discriminator as `Driver.restaurant` at `models/driver.model.js:36`.
 *
 * ## Location follows employment
 *
 * An own-fleet rider works for one outlet, in that outlet's area, so their city,
 * locality and coordinates are **copied from the outlet** — never taken from the
 * client. There is only one correct answer, so asking is pointless, and accepting
 * a client value would let a rider sit outside their employer's service area
 * while appearing on their roster.
 *
 * A platform-pool rider has no outlet to inherit from and is dispatched across
 * several, so they must supply their own city and locality. The pooling field
 * `territory.localities[]` is where their real coverage goes.
 *
 * @param {Object} param
 * @returns {Promise<{user: Object, driver: Object}>}
 */
const registerDriver = async (param) => {
  const existing = await User.findOne({
    countryCode: param.countryCode,
    mobile: param.mobile,
  });
  if (existing) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already registered');
  }

  // The outlet is decided by an invitation the *partner* created, looked up by
  // this rider's phone number - the identifier the OTP flow has just proven they
  // hold. This used to accept an `invitedBy` user id from the payload and attach
  // the rider to whoever owned it, so anyone who knew a partner's user id could
  // enrol themselves on that outlet's fleet.
  const invite = await DairyDriverInvite.findOne({
    countryCode: param.countryCode,
    mobile: param.mobile,
    status: 'pending',
    expiresAt: { $gt: new Date() },
  });
  /**
   * ## There is no platform pool
   *
   * A dairy rider is always employed by one outlet, so registration requires a
   * valid invitation and refuses outright without one.
   *
   * The pool existed because the shared kernel carries `Driver.restaurant`'s
   * `business: null` pattern, and restaurant delivery genuinely needs it: a courier
   * carrying hot food from an arbitrary origin to a timed destination *is* the
   * product. Dairy has neither property. Demand is a fixed daily routine, the value
   * is hitting a morning window reliably, and the profitable unit is one rider
   * working a dense fixed route through a locality. Ad-hoc cross-city dispatch is
   * the wrong shape for that — and wrong for the compliance story too, because the
   * FSSAI food business operator is the outlet holding the licence.
   *
   * Removing it also removes the only reason a rider ever supplied their own
   * location. Every rider now inherits one, so there is a single source of truth
   * and the client has nothing to disagree with.
   */
  if (!invite) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Dairy riders join an outlet by invitation. Ask the outlet to invite this mobile number.'
    );
  }

  const invitedBusiness = await Business.findById(invite.business).select(
    '_id ownDeliveryPartner city locality location'
  );
  if (!invitedBusiness) {
    throw new ApiError(httpStatus.NOT_FOUND, 'The outlet that invited you no longer exists');
  }
  if (invitedBusiness.ownDeliveryPartner !== true) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'This outlet does not run its own delivery riders, so it cannot add one'
    );
  }

  // The outlet's location is the whole source of truth here, so a client value is a
  // bug rather than a preference. Rejecting beats silently discarding, which would
  // look like the rider's input was honoured.
  if (param.city || param.locality) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'A rider joining an outlet takes that outlet\'s location; it cannot be set here'
    );
  }

  const businessId = invitedBusiness._id;
  const inheritedLocation = {
    city: invitedBusiness.city,
    locality: invitedBusiness.locality,
    location: invitedBusiness.location,
  };

  try {
    const created = await withOptionalTransaction(async (session) => {
      const user = await User.create(
        [
          {
            firstName: param.firstName,
            lastName: param.lastName,
countryCode: param.countryCode,
            mobile: param.mobile,
            email: param.email,
            // See the note in `registerPartner`: this was never passed through,
            // so driver registration could not succeed either.
            password: param.password,
            role: 'dairyDriver',
            locale: param.locale,
            isMobileVerified: true,
            status: true,
          },
        ],
        { session }
      );

      // Location is inherited from the inviting outlet. There is no second source,
      // so the client was already rejected above for trying to supply one.
      const city = inheritedLocation.city;
      const locality = inheritedLocation.locality;

      const driver = await DairyDriver.create(
        [
          {
            userId: user[0]._id,
            business: businessId,
            city,
            locality,
            // The outlet's coordinates, so the rider is not left at null island.
            //
            // This line used to be a no-op: `DairyDriver` had no `location` path on
            // the schema, so Mongoose strict mode dropped the value on every save. It
            // read as though the rider were being placed, and nothing was stored. The
            // field now exists (see the model) and `verify.driver.location.probe`
            // pins the round trip and the `2dsphere` index.
            //
            // Spread conditionally because an outlet may itself have no coordinates.
            // Inventing a position for a rider would be worse than admitting we do
            // not know where they are.
            ...(inheritedLocation.location ? { location: inheritedLocation.location } : {}),
            payoutMode: param.payoutMode,
            canCapacity: param.canCapacity,
            vehicleType: param.vehicleType,
            identity: param.identity,
            identityNumber: param.identityNumber,
            identityProof: param.identityProof,
            licence: param.licence,
            licenceExpiry: param.licenceExpiry,
            fssaiLicence: param.fssaiLicence,
            age: param.age,
            dob: param.dob,
            activeStatus: true,
            status: true,
          },
        ],
        { session }
      );

      // Keep the outlet's rider list in step. Unconditional now that every rider
      // has an outlet.
      await Business.updateOne(
        { _id: businessId },
        { $addToSet: { deliveryPartners: user[0]._id } },
        { session }
      );

      return { user: user[0], driver: driver[0] };
    });

    // Claim the invitation now the rider exists, so it cannot invite them twice
    // and the audit trail records which outlet they joined through.
    await DairyDriverInvite.updateOne(
      { _id: invite._id },
      { $set: { status: 'accepted', rider: created.user._id, acceptedAt: new Date() } }
    );

    return created;
  } catch (error) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, error.message);
  }
};

/**
 * Admin decision on a pending `DairyJoiningRequest`.
 *
 * Approving flips `Business.verified`, which is what gates commercial actions.
 *
 * @param {string} requestId
 * @param {boolean} approve
 * @param {string} adminId
 * @param {string} reason
 */
const reviewJoiningRequest = async (requestId, approve, adminId, reason) => {
  const request = await DairyJoiningRequest.findById(requestId);
  if (!request) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  // An outlet with no location cannot be dispatched to, so approving it verifies a
  // business that can never trade. Registration has required a city and locality for
  // a while now, so a request without one predates that rule — but the request could
  // still be approved, which is how three outlets ended up `verified: true` with no
  // location at all.
  //
  // Refused only on approval. Rejecting a location-less request is exactly the right
  // thing to be able to do, and blocking it would leave an operator unable to clear
  // the queue.
  //
  // The error names what is missing rather than saying "invalid", because the fix is
  // always the same and an operator should not have to guess it.
  if (approve) {
    const business = await Business.findById(request.business).select('city locality');
    if (!business) {
      throw new ApiError(httpStatus.NOT_FOUND, 'The outlet this request refers to no longer exists');
    }
    const missing = [];
    if (!business.city) missing.push('city');
    if (!business.locality) missing.push('locality');
    if (missing.length) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `This outlet cannot be approved: it has no ${missing.join(' and no ')}. ` +
          'An outlet with no city and locality cannot be dispatched to, so approving it ' +
          'would verify a business that can never trade. Set its location first.'
      );
    }
  }

  request.status = approve ? 'approved' : 'rejected';
  request.rejectionReason = approve ? undefined : reason;
  request.verifiedBy = adminId;
  request.verifiedAt = new Date();
  await request.save();

  await Business.updateOne(
    { _id: request.business },
    { $set: { verified: approve === true } }
  );

  return request;
};

/**
 * The admin's review queue.
 *
 * Review exists by id only, which is a problem: a request id has to come from
 * somewhere, and nothing could show an operator what was waiting. This is that
 * somewhere — the work queue.
 *
 * The city and locality are denormalised onto each row (via populate) so the
 * operator can see where the outlet is without a second request, and because
 * verifying that an address is real is the main thing being reviewed. `hasLocation`
 * is computed rather than left implicit: a row whose `city` or `locality` is missing
 * predates the registration-time location rules, and an operator should see that
 * plainly rather than see two blank cells and have to wonder.
 *
 * @param {Object} options status, business, search, limit, page
 * @returns {Promise<Object>} results and totalResults
 */
const listJoiningRequests = async (options = {}) => {
  const filter = {};

  if (options.status) {
    filter.status = options.status;
  }
  if (options.business) {
    filter.business = options.business;
  }
  if (options.search) {
    // Escaped: the search term is operator input going straight into a RegExp, and
    // an unescaped `.` or `(` would otherwise change what it matches — or throw.
    const term = new RegExp(String(options.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: term }, { address: term }];
  }

  const page = Math.max(0, Number(options.page) || 0);
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));

  const [rows, totalResults] = await Promise.all([
    DairyJoiningRequest.find(filter)
      .populate('business')
      .populate('city')
      .populate('locality')
      .populate('user', 'firstName lastName email mobile')
      .sort({ status: 1, createdAt: -1 })
      .skip(page * limit)
      .limit(limit)
      .lean(),
    DairyJoiningRequest.countDocuments(filter),
  ]);

  return {
    results: rows.map((row) => ({
      ...row,
      hasLocation: Boolean(row.city && row.locality),
    })),
    totalResults,
  };
};

module.exports = {
  registerPartner,
  registerDriver,
  reviewJoiningRequest,
  listJoiningRequests,
};
