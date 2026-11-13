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
  DairyPartner,
  DairyFranchise,
  DairyJoiningRequest,
  Business,
  User,
  City,
  Locality,
  DairyOrder,
  DairySubscription,
  DairyDriver,
  DairySettlement,
} = require('../../../models');
const ApiError = require('../../../utils/ApiError');
const { withOptionalTransaction } = require('../../../utils/optionalTransaction');

/**
 * Partner and franchise agreements.
 *
 * The onboarding side, as opposed to `dairy.settlement.service` which is the money
 * side. Kept separate because the two change for different reasons and are owned
 * by different people: an operator negotiates an agreement once, while a
 * settlement is produced every period.
 */

const createPartner = async (param) => {
  const business = await Business.findById(param.business);
  if (!business) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Business not found');
  }
  if (business.verified !== true || business.status !== true) {
    throw new ApiError(httpStatus.CONFLICT, 'Approve and verify the outlet application before creating an agreement');
  }

  const [existingPartner, existingFranchise] = await Promise.all([
    DairyPartner.findOne({
      $or: [{ business: param.business }, { partnerCode: param.partnerCode }],
    }),
    DairyFranchise.findOne({ business: param.business }).select('_id'),
  ]);
  if (existingPartner || existingFranchise) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This outlet already has a partner agreement, or the code is taken');
  }

  if (param.commissionPercentage < 0 || param.commissionPercentage > 100) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Commission must be between 0 and 100 percent');
  }

  const partner = await DairyPartner.create({ ...param, status: 'active' });

  // Reflect the commercial model on the outlet so catalogue and routing code
  // does not have to join the agreement to know how the outlet trades.
  business.businessModel = 'commission_partner';
  await business.save();
  await DairyJoiningRequest.updateOne(
    { business: business._id, status: 'approved' },
    { $set: { assignedBusinessModel: 'commission_partner' } }
  );

  return partner;
};

const listPartners = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;

  const query = {};
  if (options.status) query.status = options.status;
  if (options.business) query.business = options.business;

  const [partners, totalResults] = await Promise.all([
    DairyPartner.find(query)
      // `city` and `locality` are included because an operator looking at an outlet
      // needs to see where it is: an outlet with no location can never be dispatched
      // to, and that is not visible from the partner record alone.
      .populate('business', 'name businessModel verified city locality')
      .populate('business.city', 'name')
      .populate('business.locality', 'name')
      .populate('user', 'firstName lastName mobile')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    DairyPartner.countDocuments(query),
  ]);

  // The panel addresses a partner by `_id`, while the model's toJSON transform
  // replaces it with `id`. Converting here keeps both the id the dialogs need and
  // the getters that turn the stored basis points back into a percentage.
  return {
    partners: partners.map((partner) => partner.toObject({ getters: true })),
    totalResults,
    page,
    limit,
  };
};

/**
 * Renegotiates the commission rate.
 *
 * Applies from `effectiveFrom`, never retrospectively: settlements already
 * approved are financial statements and must not move.
 */
const updatePartnerTerms = async (partnerId, param) => {
  const partner = await DairyPartner.findById(partnerId);
  if (!partner) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  if (param.commissionPercentage !== undefined) {
    if (param.commissionPercentage < 0 || param.commissionPercentage > 100) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Commission must be between 0 and 100 percent');
    }
    partner.commissionPercentage = param.commissionPercentage;
  }
  if (param.commissionBasis) {
    partner.commissionBasis = param.commissionBasis;
  }
  if (param.driverPayoutMode) {
    partner.driverPayoutMode = param.driverPayoutMode;
  }
  if (param.payoutMethod) {
    partner.payoutMethod = param.payoutMethod;
  }
  if (param.payoutDetails) {
    partner.payoutDetails = { ...partner.payoutDetails, ...param.payoutDetails };
  }
  if (param.agreement) {
    partner.agreement = { ...partner.agreement.toObject(), ...param.agreement };
  }

  await partner.save();
  return partner;
};

const setPartnerStatus = async (partnerId, status, param) => {
  const partner = await DairyPartner.findById(partnerId);
  if (!partner) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const allowed = {
    pending: ['active', 'terminated'],
    active: ['suspended', 'terminated'],
    suspended: ['active', 'terminated'],
    terminated: [],
  }[partner.status] || [];

  if (!allowed.includes(status)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot move a ${partner.status} partner to ${status}`
    );
  }

  partner.status = status;
  if (status === 'terminated') {
    partner.terminatedAt = new Date();
    // The reason is kept on the agreement, not just logged: a terminated
    // relationship is exactly what gets disputed later.
    partner.terminationReason = param.reason;
  }
  await partner.save();

  return partner;
};

// //// Franchise ////

const createFranchise = async (param) => {
  const business = await Business.findById(param.business);
  if (!business) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Business not found');
  }
  if (business.verified !== true || business.status !== true) {
    throw new ApiError(httpStatus.CONFLICT, 'Approve and verify the outlet application before creating an agreement');
  }

  const operator = await User.findById(param.operator);
  if (!operator) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Operator not found');
  }

  const [existingFranchise, existingPartner] = await Promise.all([
    DairyFranchise.findOne({
      $or: [{ business: param.business }, { franchiseCode: param.franchiseCode }],
    }),
    DairyPartner.findOne({ business: param.business }).select('_id'),
  ]);
  if (existingFranchise || existingPartner) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This outlet already has a franchise agreement, or the code is taken');
  }

  if (param.revenueSharePercentage < 0 || param.revenueSharePercentage > 100) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Revenue share must be between 0 and 100 percent');
  }

  // Territory overlap check. Two franchises covering the same locality would
  // make settlement attribution ambiguous.
  if (param.territory && Array.isArray(param.territory.localities) && param.territory.localities.length > 0) {
    const clash = await DairyFranchise.findOne({
      _id: { $ne: param.franchiseId },
      status: 'active',
      'territory.localities': { $in: param.territory.localities },
    });
    if (clash) {
      throw new ApiError(
        httpStatus.CONFLICT,
        `Territory overlaps active franchise ${clash.franchiseCode}`
      );
    }
  }

  const joiningFee = Number(param.joiningFee || 0);
  const feeRequired = joiningFee > 0;
  const franchise = await DairyFranchise.create({
    ...param,
    joiningFee,
    joiningFeePaymentStatus: feeRequired ? 'pending' : 'not_required',
    // A franchisee on a full supply model has no procurement screens.
    procurementEnabled: param.procurementEnabled === true || param.supplyModel === 'local_procurement',
    // A fee-bearing franchise cannot trade until the payment callback confirms
    // the exact approved amount. Zero-fee agreements may activate immediately.
    status: feeRequired ? 'pending' : 'active',
  });

  business.businessModel = 'franchise';
  await business.save();
  await DairyJoiningRequest.updateOne(
    { business: business._id, status: 'approved' },
    { $set: { assignedBusinessModel: 'franchise' } }
  );

  return franchise;
};

/**
 * Admin-created dairy outlet: owner login + outlet (+ agreement) in one call.
 *
 * Mirrors the restaurant "Add Restaurant" flow. The owner is created as a
 * `dairyPartner` user so they can log in immediately; the outlet is trusted
 * (verified) because an admin created it. A commission-partner or franchise
 * agreement is attached when `businessModel` asks for one, reusing the same
 * agreement shape as the standalone create endpoints.
 *
 * @param {Object} param
 * @returns {Promise<{user, business, agreement}>}
 */
const createAdminOutlet = async (param) => {
  const existingByEmail = await User.findOne({ email: param.email });
  if (existingByEmail) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  const existingByPhone = await User.findOne({
    countryCode: param.countryCode,
    mobile: param.mobile,
  });
  if (existingByPhone) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone already registered');
  }

  // Location pairing is enforced here, not just in validation: a valid city id
  // and a valid locality id that belong to different cities must not create an
  // outlet that can never be dispatched to.
  const [city, locality] = await Promise.all([
    City ? City.findOne({ _id: param.city, status: true }).select('_id') : null,
    Locality ? Locality.findOne({ _id: param.locality, status: true }).select('_id city') : null,
  ]);
  if (!city) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'That city is not one we serve');
  }
  if (!locality) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'That locality is not one we serve');
  }
  if (String(locality.city) !== String(param.city)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'That locality does not belong to the selected city');
  }

  const model = param.businessModel || 'direct';
  if (!['direct', 'commission_partner', 'franchise'].includes(model)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid business model');
  }

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
            businessModel: model,
            name: param.businessName,
            description: param.shortDescription || undefined,
            logo: param.logo || undefined,
            cover: param.cover || undefined,
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
            ownDeliveryPartner: true,
            driverPayoutMode: 'business_pays',
            verified: true,
            status: true,
          },
        ],
        { session }
      );

      let agreement = null;

      if (model === 'commission_partner') {
        let partnerCode = param.partnerCode && String(param.partnerCode).trim();
        if (!partnerCode) {
          for (let i = 0; i < 5; i++) {
            partnerCode = 'DP-' + Math.random().toString(36).slice(2, 8).toUpperCase();
            const clash = await DairyPartner.findOne({ partnerCode }).session(session);
            if (!clash) break;
            partnerCode = null;
          }
          if (!partnerCode) {
            throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Could not generate a unique partner code');
          }
        } else {
          const existing = await DairyPartner.findOne({ partnerCode }).session(session);
          if (existing) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'That partner code is already taken');
          }
        }
        if (param.commissionPercentage === null || param.commissionPercentage === undefined || param.commissionPercentage === '') {
          throw new ApiError(httpStatus.BAD_REQUEST, 'commissionPercentage is required');
        }
        agreement = await DairyPartner.create(
          [
            {
              business: business[0]._id,
              user: user[0]._id,
              partnerCode: partnerCode,
              name: param.name || param.businessName,
              commissionPercentage: param.commissionPercentage,
              commissionBasis: param.commissionBasis || 'product_only',
              payoutMethod: param.payoutMethod || 'wallet',
              payoutDetails: param.payoutDetails,
              agreement: {
                startDate: param.agreement && param.agreement.startDate ? param.agreement.startDate : new Date(),
                endDate: param.agreement && param.agreement.endDate ? param.agreement.endDate : undefined,
                minimumGuarantee: param.agreement && param.agreement.minimumGuarantee !== undefined ? param.agreement.minimumGuarantee : 0,
                documentUrl: param.agreement && param.agreement.documentUrl ? param.agreement.documentUrl : undefined,
                notes: param.agreement && param.agreement.notes ? param.agreement.notes : undefined,
              },
              status: 'active',
            },
          ],
          { session }
        );
        agreement = agreement[0];
      }

      if (model === 'franchise') {
        let franchiseCode = param.franchiseCode && String(param.franchiseCode).trim();
        if (!franchiseCode) {
          for (let i = 0; i < 5; i++) {
            franchiseCode = 'DF-' + Math.random().toString(36).slice(2, 8).toUpperCase();
            const clash = await DairyFranchise.findOne({ franchiseCode }).session(session);
            if (!clash) break;
            franchiseCode = null;
          }
          if (!franchiseCode) {
            throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Could not generate a unique franchise code');
          }
        } else {
          const existing = await DairyFranchise.findOne({ franchiseCode }).session(session);
          if (existing) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'That franchise code is already taken');
          }
        }
        if (param.revenueSharePercentage === null || param.revenueSharePercentage === undefined || param.revenueSharePercentage === '') {
          throw new ApiError(httpStatus.BAD_REQUEST, 'revenueSharePercentage is required');
        }
        const operatorId = param.operator || user[0]._id;
        const operator = await User.findById(operatorId).session(session);
        if (!operator) {
          throw new ApiError(httpStatus.NOT_FOUND, 'Operator not found');
        }
        // Territory overlap check.
        if (param.territory && Array.isArray(param.territory.localities) && param.territory.localities.length > 0) {
          const clash = await DairyFranchise.findOne({
            status: 'active',
            'territory.localities': { $in: param.territory.localities },
          }).session(session);
          if (clash) {
            throw new ApiError(httpStatus.CONFLICT, `Territory overlaps active franchise ${clash.franchiseCode}`);
          }
        }
        agreement = await DairyFranchise.create(
          [
            {
              business: business[0]._id,
              operator: operatorId,
              franchiseCode: franchiseCode,
              name: param.name || param.businessName,
              revenueSharePercentage: param.revenueSharePercentage,
              revenueShareBasis: param.revenueShareBasis || 'product_only',
              joiningFee: param.joiningFee || 0,
              joiningFeePaymentStatus: Number(param.joiningFee || 0) > 0 ? 'pending' : 'not_required',
              royalty: param.royalty || 0,
              royaltyFrequency: param.royaltyFrequency || 'monthly',
              supplyModel: param.supplyModel || 'platform_supplied',
              procurementEnabled:
                param.procurementEnabled === true || param.supplyModel === 'local_procurement',
              territory: param.territory,
              agreement: {
                startDate: param.agreement && param.agreement.startDate ? param.agreement.startDate : new Date(),
                endDate: param.agreement && param.agreement.endDate ? param.agreement.endDate : undefined,
                documentUrl: param.agreement && param.agreement.documentUrl ? param.agreement.documentUrl : undefined,
                notes: param.agreement && param.agreement.notes ? param.agreement.notes : undefined,
              },
              status: Number(param.joiningFee || 0) > 0 ? 'pending' : 'active',
            },
          ],
          { session }
        );
        agreement = agreement[0];
      }

      return { user: user[0], business: business[0], agreement };
    });

    return created;
  } catch (error) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, error.message);
  }
};

/**
 * Every dairy outlet, not just the ones with an agreement.
 *
 * The old admin "Outlets" screen listed `DairyPartner` documents, so a direct
 * outlet or a franchise never appeared there. That made it look as though the
 * panel had no way to see, let alone onboard, a commission partner: the only
 * outlets on screen were the ones that already had a partner agreement. This is
 * the directory the create dialogs and the governance screen both read.
 *
 * `availableFor` is for the create pickers. It returns verified, trading, direct
 * outlets with no agreement of either kind, so the UI cannot offer an outlet that
 * the API would reject and cannot accidentally stack a franchise on top of a
 * commission agreement.
 *
 * @param {Object} options search, model, status, city, availableFor, limit, page
 * @returns {Promise<Object>} outlets, totalResults, page, limit, summary
 */
const listAdminOutlets = async (options = {}) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0
    ? Math.min(parseInt(options.limit, 10), 100)
    : 20;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;

  const query = { vertical: 'dairy' };

  if (options.model) query.businessModel = options.model;
  if (options.city) query.city = options.city;

  // Derived from the fields that actually decide whether an outlet can trade, not
  // from `Business.status` alone: an out-of-date verification is what a direct
  // applicant is waiting on, and showing that as `active` hides the queue.
  if (options.status === 'active') {
    query.verified = true;
    query.status = true;
  } else if (options.status === 'pending') {
    query.verified = false;
  } else if (options.status === 'suspended') {
    query.verified = true;
    query.status = false;
  }

  if (options.search) {
    // Escaped because the search term is operator input and goes into a RegExp.
    const term = new RegExp(
      String(options.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'i'
    );
    query.$or = [{ name: term }, { code: term }];
  }

  if (options.availableFor) {
    query.verified = true;
    query.status = true;
    const availableClauses = [{ $or: [{ businessModel: 'direct' }, { businessModel: null }] }];
    if (query.$or) {
      availableClauses.push({ $or: query.$or });
      delete query.$or;
    }
    query.$and = availableClauses;

    const [partnerBusinesses, franchiseBusinesses] = await Promise.all([
      DairyPartner.distinct('business'),
      DairyFranchise.distinct('business'),
    ]);
    query._id = { $nin: [...partnerBusinesses, ...franchiseBusinesses] };
  }

  const [outlets, totalResults, summaryRows] = await Promise.all([
    Business.find(query)
      .populate('city', 'name')
      .populate('locality', 'name')
      .populate('owner', 'firstName lastName mobile countryCode')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      // `lean` keeps `_id` on the outlet, owner, city and locality. The panel's
      // create dialogs post the owner id back, and the model transform would rename
      // it to `id` on the way out.
      .lean(),
    Business.countDocuments(query),
    // One pass over the whole dairy book, independent of the filters, so the KPI
    // cards do not change when an operator narrows the table.
    Business.aggregate([
      { $match: { vertical: 'dairy' } },
      {
        $group: {
          _id: { model: '$businessModel', verified: '$verified', status: '$status' },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const ids = outlets.map((outlet) => outlet._id);
  const [partnerDocs, franchiseDocs] = await Promise.all([
    DairyPartner.find({ business: { $in: ids } }),
    DairyFranchise.find({ business: { $in: ids } }).populate(
      'operator',
      'firstName lastName mobile'
    ),
  ]);

  // Same reason as `listPartners`: keep `_id` for the edit/status dialogs, and
  // apply the commission getter so the row shows 10% rather than the stored 1000.
  const partners = partnerDocs.map((partner) => partner.toObject({ getters: true }));
  const franchises = franchiseDocs.map((franchise) => franchise.toObject({ getters: true }));

  const partnerByBusiness = new Map(
    partners.map((partner) => [String(partner.business), partner])
  );
  const franchiseByBusiness = new Map(
    franchises.map((franchise) => [String(franchise.business), franchise])
  );

  const summary = {
    total: 0,
    active: 0,
    pending: 0,
    suspended: 0,
    direct: 0,
    franchise: 0,
    commissionPartner: 0,
  };

  for (const row of summaryRows) {
    summary.total += row.count;
    if (row._id.verified) {
      if (row._id.status) summary.active += row.count;
      else summary.suspended += row.count;
    } else {
      summary.pending += row.count;
    }

    if (row._id.model === 'commission_partner') summary.commissionPartner += row.count;
    else if (row._id.model === 'franchise') summary.franchise += row.count;
    else summary.direct += row.count;
  }

  return {
    outlets: outlets.map((outlet) => ({
      _id: outlet._id,
      name: outlet.name,
      code: outlet.code,
      businessModel: outlet.businessModel,
      verified: outlet.verified,
      status: outlet.status,
      city: outlet.city,
      locality: outlet.locality,
      owner: outlet.owner,
      createdAt: outlet.createdAt,
      partner: partnerByBusiness.get(String(outlet._id)) || null,
      franchise: franchiseByBusiness.get(String(outlet._id)) || null,
    })),
    totalResults,
    page,
    limit,
    summary,
  };
};

const listFranchises = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;

  const query = {};
  if (options.status) query.status = options.status;
  if (options.business) query.business = options.business;
  if (options.city) query['territory.city'] = options.city;

  const [franchises, totalResults] = await Promise.all([
    DairyFranchise.find(query)
      .populate('business', 'name businessModel verified')
      .populate('operator', 'firstName lastName mobile')
      .populate('territory.city', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    DairyFranchise.countDocuments(query),
  ]);

  // The franchise status dialog addresses the agreement by `_id`.
  return {
    franchises: franchises.map((franchise) => franchise.toObject({ getters: true })),
    totalResults,
    page,
    limit,
  };
};

const setFranchiseStatus = async (franchiseId, status, param) => {
  const franchise = await DairyFranchise.findById(franchiseId);
  if (!franchise) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const allowed = {
    pending: ['active', 'terminated'],
    active: ['suspended', 'expired', 'terminated'],
    suspended: ['active', 'terminated'],
    expired: ['active', 'terminated'],
    terminated: [],
  }[franchise.status] || [];

  if (!allowed.includes(status)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot move a ${franchise.status} franchise to ${status}`
    );
  }

  if (
    status === 'active' &&
    Number(franchise.joiningFee || 0) > 0 &&
    !['paid', 'waived'].includes(franchise.joiningFeePaymentStatus)
  ) {
    throw new ApiError(httpStatus.CONFLICT, 'The franchise joining fee must be paid before activation');
  }

  franchise.status = status;
  if (['terminated', 'suspended'].includes(status) && param.reason) {
    franchise.statusReason = param.reason;
  }
  await franchise.save();

  return franchise;
};

/**
 * Check whether an outlet location falls inside a franchise territory.
 *
 * Used to decide which partner a new order belongs to. Locality matching is the
 * fast path; polygon containment is the precise one.
 */
// //// Partner-facing outlet views ////
//
// Everything below is read by the outlet's own partner, from the app. The outlet
// is never a parameter: it arrives as `businessId` from `resolveOutlet`, which
// reads it off the access token. A partner sees their own outlet and nothing
// else, because there is no code path here that could scope a query elsewhere.

/**
 * Every customer who has bought from this outlet.
 *
 * Derived by aggregating orders rather than by holding a customer list: the
 * customer app already owns the customer record, and a separate roster would
 * drift from who actually ordered. Someone who only holds a subscription still
 * belongs on this list, so both collections are unioned.
 *
 * A partner needs this to answer "who buys from me", which is also what a
 * subscription list cannot tell them - plans are per-customer but the partner
 * wants one row per person.
 *
 * @param {string} businessId outlet from the token
 * @param {Object} options search, limit, page
 * @returns {Promise<Object>}
 */
const listOutletCustomers = async (businessId, options = {}) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 20;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;

  // Matched against the populated name, since the query below cannot search a
  // populated field. The name filter is applied after the aggregation so the
  // search and the paging stay consistent with each other.
  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const orderRows = await DairyOrder.aggregate([
    { $match: { business: new mongoose.Types.ObjectId(businessId) } },
    {
      $group: {
        _id: '$user',
        orderCount: { $sum: 1 },
        // Top-level, not `totals.*` - these fields sit directly on the order.
        lifetimeValue: { $sum: '$grandTotal' },
        lastOrderAt: { $max: '$createdAt' },
        receiverName: { $last: '$receiverName' },
        receiverContact: { $last: '$receiverContact' },
        address: { $last: '$address' },
      },
    },
  ]);

  const subscriptionRows = await DairySubscription.aggregate([
    { $match: { business: new mongoose.Types.ObjectId(businessId) } },
    {
      $group: {
        _id: '$user',
        subscriptionCount: { $sum: 1 },
        activeSubscriptions: {
          $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] },
        },
      },
    },
  ]);

  const subscriptionByUser = new Map(
    subscriptionRows.map((row) => [String(row._id), row])
  );

  const merged = orderRows.map((row) => {
    const subs = subscriptionByUser.get(String(row._id));
    subscriptionByUser.delete(String(row._id));
    return {
      user: row._id,
      orderCount: row.orderCount,
      // Paise holds rupees; the raw field is paise. Divided here so the endpoint
      // never reports a lifetime value a hundred times too large.
      lifetimeValue: Number((row.lifetimeValue / 100).toFixed(2)),
      subscriptionCount: subs ? subs.subscriptionCount : 0,
      activeSubscriptions: subs ? subs.activeSubscriptions : 0,
      lastOrderAt: row.lastOrderAt,
      receiverName: row.receiverName,
      receiverContact: row.receiverContact,
      address: row.address,
    };
  });

  // Subscription-only customers: they have never placed a one-time order, so they
  // appear in no order row above.
  for (const [userId, row] of subscriptionByUser) {
    merged.push({
      user: row._id,
      orderCount: 0,
      lifetimeValue: 0,
      subscriptionCount: row.subscriptionCount,
      activeSubscriptions: row.activeSubscriptions,
      lastOrderAt: null,
      receiverName: null,
      receiverContact: null,
      address: null,
    });
    void userId;
  }

  const populated = await User.find({
    _id: { $in: merged.map((row) => row.user) },
  }).select('firstName lastName mobile countryCode email status');

  const userById = new Map(populated.map((user) => [String(user._id), user]));

  let customers = merged.map((row) => {
    const user = userById.get(String(row.user));
    return {
      ...row,
      firstName: user ? user.firstName : null,
      lastName: user ? user.lastName : null,
      mobile: user ? user.mobile : null,
      countryCode: user ? user.countryCode : null,
      email: user ? user.email : null,
    };
  });

  // Sorted by recency first, then name, so the search below cannot reorder the
  // page the client asked for.
  customers.sort((a, b) => {
    const left = a.lastOrderAt ? new Date(a.lastOrderAt).getTime() : 0;
    const right = b.lastOrderAt ? new Date(b.lastOrderAt).getTime() : 0;
    return right - left;
  });

  if (options.search) {
    const needle = new RegExp(escapeRegExp(options.search), 'i');
    customers = customers.filter((row) =>
      needle.test(
        [row.firstName, row.lastName, row.mobile, row.receiverName, row.receiverContact]
          .filter(Boolean)
          .join(' ')
      )
    );
  }

  const totalResults = customers.length;

  return { customers: customers.slice(skip, skip + limit), totalResults, page, limit };
};

/**
 * The outlet's own riders.
 *
 * Only riders whose `business` is this outlet. Platform-pool riders have
 * `business: null` and belong to whoever dispatches them, so they are excluded
 * rather than shown as unassigned.
 *
 * @param {string} businessId outlet from the token
 * @param {Object} options status, search, limit, page
 * @returns {Promise<Object>}
 */
const listOutletDrivers = async (businessId, options = {}) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 20;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;

  const query = { business: new mongoose.Types.ObjectId(businessId) };
  if (options.status !== undefined) {
    query.status = options.status === 'true';
  }

  const [drivers, totalResults] = await Promise.all([
    DairyDriver.find(query)
      .populate('userId', 'firstName lastName mobile countryCode email status isMobileVerified')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    DairyDriver.countDocuments(query),
  ]);

  let riders = drivers;

  if (options.search) {
    const needle = new RegExp(String(options.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    riders = drivers.filter((driver) => {
      const user = driver.userId;
      if (!user) return false;
      return needle.test(
        [user.firstName, user.lastName, user.mobile, user.email].filter(Boolean).join(' ')
      );
    });
  }

  return { drivers: riders, totalResults, page, limit };
};

/**
 * What the outlet has earned: the platform's commission on its sales.
 *
 * Read from settled orders rather than from `DairySettlement`, because the
 * settlement only exists once a period has been closed and this figure is
 * needed before that. A partner asking "what did I make this month" should not
 * have to wait for the finance run.
 *
 * Only `delivered` + `paid` orders count, matching
 * `settlement.collectSettleableOrders` - otherwise the two would disagree and
 * the partner would be shown a number the settlement later contradicts.
 *
 * @param {string} businessId outlet from the token
 * @param {Object} options from, to
 * @returns {Promise<Object>}
 */
const getOutletEarnings = async (businessId, options = {}) => {
  const match = {
    business: new mongoose.Types.ObjectId(businessId),
    status: 'delivered',
    paymentStatus: 'paid',
  };

  if (options.from || options.to) {
    match.deliveredAt = {};
    if (options.from) match.deliveredAt.$gte = new Date(options.from);
    if (options.to) match.deliveredAt.$lt = new Date(options.to);
  }

  const [rows] = await DairyOrder.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        orderCount: { $sum: 1 },
        // Raw paise out of Mongo; divided once, here. The fields are top-level
        // on the order, not nested under `totals`.
        grossSalesPaise: { $sum: '$itemTotal' },
        deliveryPaise: { $sum: '$serviceCharge' },
        discountPaise: { $sum: '$discountAmount' },
        taxPaise: { $sum: '$taxAmount' },
        couponOrderCount: { $sum: { $cond: [{ $gt: ['$discountAmount', 0] }, 1, 0] } },
      },
    },
  ]);

  const partner = await DairyPartner.findOne({ business: businessId });

  const grossSales = rows ? Number((rows.grossSalesPaise / 100).toFixed(2)) : 0;
  const deliveryCharges = rows ? Number((rows.deliveryPaise / 100).toFixed(2)) : 0;
  const discounts = rows ? Number((rows.discountPaise / 100).toFixed(2)) : 0;
  const taxes = rows ? Number((rows.taxPaise / 100).toFixed(2)) : 0;

  // Same basis and rate the settlement engine uses, so the preview and the
  // statement cannot diverge. An outlet with no agreement yet reports zero
  // commission rather than guessing a rate.
  const rate = partner ? partner.commissionPercentage || 0 : 0;
  const includeDelivery = partner ? partner.commissionBasis === 'product_and_delivery' : false;
  const commissionBase = Number((grossSales + (includeDelivery ? deliveryCharges : 0)).toFixed(2));
  const commissionAmount = Number(((commissionBase * rate) / 100).toFixed(2));

  return {
    period: {
      from: options.from ? new Date(options.from) : null,
      to: options.to ? new Date(options.to) : null,
    },
    orderCount: rows ? rows.orderCount : 0,
    grossSales,
    deliveryCharges,
    discounts,
    netSales: Number((grossSales - discounts).toFixed(2)),
    taxes,
    couponOrderCount: rows ? rows.couponOrderCount : 0,
    commissionBase,
    ratePercentage: rate,
    commissionBasis: includeDelivery ? 'product_and_delivery' : 'product_only',
    // The platform owes the partner this, so positive.
    commissionAmount,
    // Gross less the platform's cut is what the outlet keeps.
    netEarnings: Number((grossSales - commissionAmount).toFixed(2)),
    hasAgreement: Boolean(partner),
  };
};

/**
 * Settlements already closed for this outlet.
 *
 * The counterpart to `getOutletEarnings`: the earnings figure is a live preview,
 * this is what has actually been settled and paid.
 *
 * @param {string} businessId outlet from the token
 * @param {Object} options status, limit, page
 * @returns {Promise<Object>}
 */
const listOutletSettlements = async (businessId, options = {}) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 20;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;

  const query = { business: new mongoose.Types.ObjectId(businessId) };
  if (options.status) {
    query.status = options.status;
  }

  const [settlements, totalResults] = await Promise.all([
    DairySettlement.find(query)
      .select('settlementNo settlementType period from to totals status paidAt payoutReference payoutMethod')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    DairySettlement.countDocuments(query),
  ]);

  return { settlements, totalResults, page, limit };
};

/** A full, outlet-scoped statement for the partner's report/export view. */
const getOutletSettlementDetail = async (businessId, settlementId) => {
  const settlement = await DairySettlement.findOne({ _id: settlementId, business: businessId })
    .select('settlementNo settlementType period from to totals lineItems status paidAt payoutReference payoutMethod notes createdAt');
  if (!settlement) throw new ApiError(httpStatus.NOT_FOUND, 'Settlement not found');
  return settlement;
};

const findTerritoryOwner = async (cityId, localityId) => {
  if (!cityId && !localityId) return null;
  return DairyFranchise.findOne({
    status: 'active',
    ...(localityId ? { 'territory.localities': localityId } : { 'territory.city': cityId }),
  });
};

/**
 * Candidate franchise operators for the admin picker.
 *
 * `DairyFranchise.operator` references a `User`, but nothing could list the
 * candidates — the only user search in the platform (`findUserWithName`) filters to
 * `role: 'user'`, which is customers. So the create screen faced a choice between a
 * raw id box and this.
 *
 * Restricted to `dairyPartner`, the only self-registerable dairy role that would
 * plausibly operate a franchise. This is a convenience list, not a permission: the
 * API still validates that the id resolves to a real user.
 *
 * @param {Object} options search, limit, page
 * @returns {Promise<Object>} results and totalResults
 */
const listFranchiseOperators = async (options = {}) => {
  const query = { role: 'dairyPartner' };

  if (options.search) {
    // Escaped: operator input goes straight into a RegExp.
    const term = new RegExp(
      String(options.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'i'
    );
    query.$or = [{ firstName: term }, { lastName: term }, { email: term }];
  }

  const page = Math.max(0, Number(options.page) || 0);
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));

  const [rows, totalResults] = await Promise.all([
    User.find(query)
      .select('firstName lastName email mobile')
      .sort({ firstName: 1 })
      .skip(page * limit)
      .limit(limit)
      .lean(),
    User.countDocuments(query),
  ]);

  return { results: rows, totalResults };
};

module.exports = {
  createPartner,
  createAdminOutlet,
  listPartners,
  updatePartnerTerms,
  setPartnerStatus,
  createFranchise,
  listFranchises,
  listAdminOutlets,
  setFranchiseStatus,
  listFranchiseOperators,
  findTerritoryOwner,
  listOutletCustomers,
  listOutletDrivers,
  getOutletEarnings,
  listOutletSettlements,
  getOutletSettlementDetail,
};
