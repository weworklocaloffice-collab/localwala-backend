const { status: httpStatus } = require('http-status');
const { Business, City, Locality, UserAddress, DairyCoverageRequest, DeliveryZone } = require('../../../models');
const ApiError = require('../../../utils/ApiError');
const { withOptionalTransaction } = require('../../../utils/optionalTransaction');

const idOf = (value) => (value && value._id ? String(value._id) : value ? String(value) : '');
const uniqueIds = (values) => [...new Set((values || []).map(idOf).filter(Boolean))];

const localityReviewsFor = (request) => {
  const stored = request?.localityReviews || [];
  return (request?.requestedLocalities || []).map((locality) => {
    const localityId = idOf(locality);
    const review = stored.find((item) => idOf(item.locality) === localityId);
    return {
      locality,
      status: review?.status || (request.status === 'pending' ? 'pending' : request.status),
      reviewedBy: review?.reviewedBy || request.reviewedBy || null,
      reviewedAt: review?.reviewedAt || request.reviewedAt || null,
      reviewNote: review?.reviewNote || request.reviewNote || '',
    };
  });
};

const getBusiness = async (businessId) => {
  const business = await Business.findOne({ _id: businessId, vertical: 'dairy', status: true });
  if (!business) throw new ApiError(httpStatus.NOT_FOUND, 'Dairy outlet not found');
  if (!business.city) throw new ApiError(httpStatus.CONFLICT, 'Set the outlet city before configuring delivery coverage');
  return business;
};

/** The outlet's published zone is its Dairy expansion boundary. */
const publishedZoneForBusiness = async (business, session = null) => {
  const baseLocalityId = idOf(business.locality);
  if (!baseLocalityId) return null;
  let query = DeliveryZone.findOne({
    city: business.city,
    status: true,
    localities: baseLocalityId,
  }).populate({
    path: 'localities',
    select: 'name city status',
    match: { city: business.city, status: true },
  });
  if (session) query = query.session(session);
  return query.lean();
};

const localityForAddress = async (address) => {
  let localityId = idOf(address.localityRef);
  if (!localityId && address.locality && address.cityRef) {
    const locality = await Locality.resolveByNameOrAlias(address.locality, address.cityRef);
    localityId = idOf(locality?._id);
  }
  if (!localityId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'We could not match this address to a service locality. Update the address locality and try again.');
  }
  return localityId;
};

/** Outlets that may be shown as deliverable at a customer's selected locality. */
const businessIdsForLocality = async (localityId) => {
  const businesses = await Business.find({
    vertical: 'dairy',
    status: true,
    $or: [
      { 'deliveryCoverage.activeLocalities': localityId },
      // Until an outlet completes its first approval, expose it only in the
      // locality already attached to its profile, never across the whole city.
      { locality: localityId, 'deliveryCoverage.activeLocalities': { $exists: false } },
      { locality: localityId, 'deliveryCoverage.activeLocalities': { $size: 0 } },
    ],
  }).select('_id dairyOperations.serviceableLocalities').lean();
  return businesses
    .filter((business) => !Array.isArray(business.dairyOperations?.serviceableLocalities)
      || business.dairyOperations.serviceableLocalities.some((id) => idOf(id) === idOf(localityId)))
    .map((business) => business._id);
};

const businessIdsForAddress = async ({ addressId, userId }) => {
  if (!userId) throw new ApiError(httpStatus.UNAUTHORIZED, 'Sign in to filter Dairy products by a saved address');
  const address = await UserAddress.findOne({ _id: addressId, user: userId, status: true }).lean();
  if (!address) throw new ApiError(httpStatus.BAD_REQUEST, 'Choose one of your active saved delivery addresses');
  return businessIdsForLocality(await localityForAddress(address));
};

const getPartnerCoverage = async (businessId) => {
  const business = await getBusiness(businessId);
  const [city, latestRequest, zone] = await Promise.all([
    City.findById(business.city).select('name').lean(),
    DairyCoverageRequest.findOne({ business: business._id })
      .populate('requestedLocalities', 'name')
      .populate('localityReviews.locality', 'name')
      .populate('localityReviews.reviewedBy', 'firstName lastName')
      .populate('reviewedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .lean(),
    publishedZoneForBusiness(business),
  ]);
  if (!city) throw new ApiError(httpStatus.CONFLICT, 'The outlet city is not available');

  const currentIds = uniqueIds(business.deliveryCoverage?.activeLocalities);
  if (!currentIds.length && business.locality) currentIds.push(idOf(business.locality));
  const activeLocalities = currentIds.length
    ? await Locality.find({ _id: { $in: currentIds }, status: true }).select('_id name').lean()
    : [];
  const latestReviews = latestRequest ? localityReviewsFor(latestRequest) : [];
  const pendingLocalities = latestReviews
    .filter((review) => review.status === 'pending')
    .map((review) => review.locality);
  const pendingIds = uniqueIds(pendingLocalities);
  const zoneLocalities = (zone?.localities || []).filter(Boolean);
  const zoneGroup = zone
    ? {
        id: idOf(zone._id),
        name: zone.name,
        version: zone.version || 1,
        localities: zoneLocalities.map((locality) => {
          const id = idOf(locality._id);
          return {
            id,
            name: locality.name,
            state: currentIds.includes(id)
              ? 'active'
              : pendingIds.includes(id)
              ? 'pending'
              : 'requestable',
          };
        }),
      }
    : null;
  const requestableLocalities = zoneGroup
    ? zoneGroup.localities.filter((locality) => locality.state === 'requestable')
    : [];

  return {
    city: { id: idOf(city._id), name: city.name },
    eligibleZone: zoneGroup ? { id: zoneGroup.id, name: zoneGroup.name, version: zoneGroup.version } : null,
    activeLocalities,
    // Preserve the flat field for clients that have not adopted zone grouping.
    nearbyLocalities: requestableLocalities,
    zoneGroups: zoneGroup ? [zoneGroup] : [],
    ungroupedNearbyLocalities: [],
    zoneAssignmentAvailable: !!zoneGroup,
    pendingRequest: latestRequest?.status === 'pending'
      ? { ...latestRequest, requestedLocalities: pendingLocalities }
      : null,
    latestRequest: latestRequest || null,
  };
};

const requestCoverage = async (businessId, actorId, payload) => {
  const business = await getBusiness(businessId);
  const zone = await publishedZoneForBusiness(business);
  if (!zone) {
    throw new ApiError(httpStatus.CONFLICT, 'Your base locality is not in an active delivery zone. Ask the platform admin to publish its zone.');
  }
  const allowedIds = new Set((zone.localities || []).map((row) => idOf(row._id)));
  const activeIds = uniqueIds(business.deliveryCoverage?.activeLocalities);
  if (!activeIds.length && business.locality) activeIds.push(idOf(business.locality));
  const requestedIds = uniqueIds(payload.localityIds);

  if (requestedIds.length !== payload.localityIds.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Choose each locality only once');
  }
  const invalid = requestedIds.filter((id) => !allowedIds.has(id));
  if (invalid.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Choose only active localities in your outlet delivery zone');
  }
  const alreadyCovered = requestedIds.filter((id) => activeIds.includes(id));
  if (alreadyCovered.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Remove localities that are already active in your delivery area');
  }
  if (!requestedIds.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Select at least one locality in your delivery zone');

  const existing = await DairyCoverageRequest.findOne({ business: business._id, status: 'pending' });
  if (existing) throw new ApiError(httpStatus.CONFLICT, 'A coverage request is already waiting for review');

  try {
    const request = await DairyCoverageRequest.create({
      business: business._id,
      city: business.city,
      zone: zone._id,
      zoneVersion: zone.version || 1,
      requestedLocalities: requestedIds,
      localityReviews: requestedIds.map((locality) => ({ locality, status: 'pending' })),
      requestedBy: actorId,
      message: payload.message || '',
    });
    return request;
  } catch (error) {
    if (error && error.code === 11000) {
      throw new ApiError(httpStatus.CONFLICT, 'A coverage request is already waiting for review');
    }
    throw error;
  }
};

const listCoverageRequests = async (options = {}) => {
  const limit = Math.min(100, Math.max(1, Number.parseInt(options.limit, 10) || 20));
  const page = Math.max(1, Number.parseInt(options.page, 10) || 1);
  const query = {};
  if (options.status) query.status = options.status;
  if (options.city) query.city = options.city;
  const [requests, totalResults] = await Promise.all([
    DairyCoverageRequest.find(query)
      .populate('business', 'name code city locality location')
      .populate('city', 'name')
      .populate('zone', 'name version')
      .populate('requestedLocalities', 'name')
      .populate('localityReviews.locality', 'name')
      .populate('localityReviews.reviewedBy', 'firstName lastName')
      .populate('requestedBy', 'firstName lastName email')
      .populate('reviewedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    DairyCoverageRequest.countDocuments(query),
  ]);

  const localityIds = uniqueIds(requests.flatMap((request) => request.requestedLocalities || []));
  let existingOutlets = [];
  if (localityIds.length) {
    existingOutlets = await Business.find({
      vertical: 'dairy',
      status: true,
      $or: [
        { 'deliveryCoverage.activeLocalities': { $in: localityIds } },
        {
          locality: { $in: localityIds },
          $or: [
            { 'deliveryCoverage.activeLocalities': { $exists: false } },
            { 'deliveryCoverage.activeLocalities': { $size: 0 } },
          ],
        },
      ],
    })
      .select('_id name code businessModel locality deliveryCoverage.activeLocalities')
      .lean();
  }

  const vendorsByLocality = new Map();
  for (const outlet of existingOutlets) {
    const activeLocalities = uniqueIds(outlet.deliveryCoverage?.activeLocalities);
    const servedLocalities = activeLocalities.length ? activeLocalities : [idOf(outlet.locality)];
    const vendor = {
      id: idOf(outlet._id),
      name: outlet.name || 'Dairy outlet',
      code: outlet.code || '',
      businessModel: outlet.businessModel || '',
    };
    for (const localityId of servedLocalities) {
      if (!localityIds.includes(localityId)) continue;
      const rows = vendorsByLocality.get(localityId) || [];
      rows.push(vendor);
      vendorsByLocality.set(localityId, rows);
    }
  }

  const enrichedRequests = requests.map((request) => {
    const requesterId = idOf(request.business);
    const reviews = localityReviewsFor(request).map((review) => {
      const localityId = idOf(review.locality);
      const existingVendors = (vendorsByLocality.get(localityId) || [])
        .filter((vendor) => vendor.id !== requesterId);
      return { ...review, existingVendors, existingVendorCount: existingVendors.length };
    });
    return { ...request, localityReviews: reviews };
  });

  return {
    requests: enrichedRequests,
    totalResults,
    page,
    limit,
    totalPages: Math.ceil(totalResults / limit),
  };
};

const reviewCoverageRequest = async (requestId, reviewerId, localityId, decision, reviewNote = '') => {
  return withOptionalTransaction(async (session) => {
    let requestQuery = DairyCoverageRequest.findById(requestId);
    let request = await requestQuery.session(session).exec();
    if (!request) throw new ApiError(httpStatus.NOT_FOUND, 'Coverage request not found');
    if (!['pending'].includes(request.status)) {
      throw new ApiError(httpStatus.CONFLICT, `This request has already been ${request.status}`);
    }

    const requestedIds = uniqueIds(request.requestedLocalities);
    const reviewRows = request.localityReviews?.length
      ? request.localityReviews.map((row) => row.toObject ? row.toObject() : { ...row })
      : requestedIds.map((locality) => ({ locality, status: 'pending' }));
    const rowsByLocality = new Map(reviewRows.map((row) => [idOf(row.locality), row]));
    for (const id of requestedIds) {
      if (!rowsByLocality.has(id)) {
        const row = { locality: id, status: 'pending' };
        reviewRows.push(row);
        rowsByLocality.set(id, row);
      }
    }

    const targetIds = localityId ? [idOf(localityId)] : requestedIds.filter((id) => rowsByLocality.get(id)?.status === 'pending');
    if (!targetIds.length || targetIds.some((id) => !requestedIds.includes(id))) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Choose a locality included in this request');
    }
    if (targetIds.some((id) => rowsByLocality.get(id)?.status !== 'pending')) {
      throw new ApiError(httpStatus.CONFLICT, 'That locality has already been reviewed');
    }
    if (decision === 'rejected' && !String(reviewNote).trim()) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Add a reason when rejecting a locality');
    }

    if (decision === 'approved') {
      const business = await Business.findOne({ _id: request.business, vertical: 'dairy', status: true }).session(session);
      if (!business) throw new ApiError(httpStatus.CONFLICT, 'The outlet is no longer active');
      if (idOf(business.city) !== idOf(request.city)) {
        throw new ApiError(httpStatus.CONFLICT, 'The outlet city changed; the partner must submit a new request');
      }
      const zone = await publishedZoneForBusiness(business, session);
      if (!zone || (request.zone && idOf(zone._id) !== idOf(request.zone))) {
        throw new ApiError(httpStatus.CONFLICT, 'The outlet delivery zone changed; the partner must submit a new request');
      }
      const allowedIds = new Set((zone.localities || []).map((row) => idOf(row._id)));
      if (targetIds.some((id) => !allowedIds.has(id))) {
        throw new ApiError(httpStatus.CONFLICT, 'A requested locality is no longer in the outlet delivery zone');
      }

      const activeIds = uniqueIds(business.deliveryCoverage?.activeLocalities);
      if (!activeIds.length && business.locality) activeIds.push(idOf(business.locality));
      business.deliveryCoverage = {
        ...(business.deliveryCoverage || {}),
        activeLocalities: uniqueIds([...activeIds, ...targetIds]),
        updatedAt: new Date(),
        updatedBy: reviewerId,
      };
      await business.save({ session });
    }

    const reviewedAt = new Date();
    for (const id of targetIds) {
      const row = rowsByLocality.get(id);
      row.status = decision;
      row.reviewedBy = reviewerId;
      row.reviewedAt = reviewedAt;
      row.reviewNote = String(reviewNote || '').trim();
    }
    request.localityReviews = requestedIds.map((id) => rowsByLocality.get(id));
    const outcomes = request.localityReviews.map((row) => row.status);
    const hasPending = outcomes.includes('pending');
    if (hasPending) {
      request.status = 'pending';
    } else if (outcomes.every((status) => status === 'approved')) {
      request.status = 'approved';
    } else if (outcomes.every((status) => status === 'rejected')) {
      request.status = 'rejected';
    } else {
      request.status = 'partially_approved';
    }
    if (!hasPending) {
      request.reviewedBy = reviewerId;
      request.reviewedAt = reviewedAt;
      request.reviewNote = String(reviewNote || '').trim();
    }
    await request.save({ session });
    return request;
  });
};

/** Enforce locality coverage at checkout/plan creation once an outlet opts in. */
const assertAddressCovered = async ({ businessId, addressId, userId }) => {
  const business = await Business.findOne({ _id: businessId, vertical: 'dairy', status: true })
    .select('city locality deliveryCoverage.activeLocalities dairyOperations.serviceableLocalities')
    .lean();
  if (!business) throw new ApiError(httpStatus.NOT_FOUND, 'Dairy outlet not found');
  const activeIds = uniqueIds(business.deliveryCoverage?.activeLocalities);
  const hasServiceabilitySelection = Array.isArray(business.dairyOperations?.serviceableLocalities);
  // Unconfigured legacy outlets keep their existing checkout behavior. The first
  // approved request seeds the outlet's home locality and turns on enforcement.
  if (!activeIds.length && !hasServiceabilitySelection) return true;
  if (!addressId) throw new ApiError(httpStatus.BAD_REQUEST, 'Choose a saved delivery address to check this outlet’s coverage');

  const address = await UserAddress.findOne({ _id: addressId, user: userId, status: true }).lean();
  if (!address) throw new ApiError(httpStatus.BAD_REQUEST, 'Choose one of your active saved delivery addresses');
  const localityId = await localityForAddress(address);
  if (activeIds.length && !activeIds.includes(localityId)) {
    throw new ApiError(httpStatus.CONFLICT, 'This dairy outlet does not deliver to the selected locality');
  }
  if (hasServiceabilitySelection
    && !business.dairyOperations.serviceableLocalities.some((id) => idOf(id) === localityId)) {
    throw new ApiError(httpStatus.CONFLICT, 'This Dairy outlet is not currently serving the selected locality');
  }
  return true;
};

module.exports = {
  getPartnerCoverage,
  requestCoverage,
  listCoverageRequests,
  reviewCoverageRequest,
  businessIdsForLocality,
  businessIdsForAddress,
  assertAddressCovered,
};
