const { status: httpStatus } = require('http-status');
const {
  Business,
  DairyMarketingPackage,
  DairyMarketingCampaign,
  DairyMarketingEvent,
  DairyProduct,
  DairySku,
  DeliveryZone,
  Locality,
  UserAddress,
} = require('../../../models');
const ApiError = require('../../../utils/ApiError');

const activeCampaignStatuses = ['pending_review', 'approved_unpaid', 'scheduled', 'live', 'paused'];
const idOf = (value) => String(value?._id || value || '');
const uniqueIds = (values) => [...new Set((values || []).map(idOf).filter(Boolean))];
const pagination = ({ page = 1, limit = 20 } = {}) => ({
  page: Math.max(1, Number.parseInt(page, 10) || 1),
  limit: Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20)),
});

const listPackages = async ({ page, limit, status, placement, activeOnly = false } = {}) => {
  const paging = pagination({ page, limit });
  const filter = {};
  if (activeOnly) filter.status = true;
  else if (status !== undefined) filter.status = status === true || status === 'true';
  if (placement) filter.placement = placement;
  const [packages, totalResults] = await Promise.all([
    DairyMarketingPackage.find(filter).sort({ placement: 1, durationHours: 1, name: 1 })
      .skip((paging.page - 1) * paging.limit).limit(paging.limit).lean(),
    DairyMarketingPackage.countDocuments(filter),
  ]);
  return { packages, totalResults, ...paging };
};

const createPackage = async (payload, actorId) => {
  try {
    return await DairyMarketingPackage.create({ ...payload, createdBy: actorId, updatedBy: actorId });
  } catch (error) {
    if (error?.code === 11000) throw new ApiError(httpStatus.CONFLICT, 'A package with this code already exists');
    throw error;
  }
};

const updatePackage = async (packageId, payload, actorId) => {
  const packageDoc = await DairyMarketingPackage.findById(packageId);
  if (!packageDoc) throw new ApiError(httpStatus.NOT_FOUND, 'Marketing package not found');
  Object.assign(packageDoc, payload, { updatedBy: actorId });
  try {
    await packageDoc.save();
  } catch (error) {
    if (error?.code === 11000) throw new ApiError(httpStatus.CONFLICT, 'A package with this code already exists');
    throw error;
  }
  return packageDoc;
};

const approvedCoverage = (business) => {
  if (Array.isArray(business.dairyOperations?.serviceableLocalities)) {
    return uniqueIds(business.dairyOperations.serviceableLocalities);
  }
  const active = uniqueIds(business.deliveryCoverage?.activeLocalities);
  return active.length ? active : business.locality ? [idOf(business.locality)] : [];
};

const validateTarget = async ({ business, packageDoc, localityIds, zoneId }) => {
  const coverageIds = approvedCoverage(business);
  if (!coverageIds.length) throw new ApiError(httpStatus.CONFLICT, 'Set approved Dairy delivery localities before booking a campaign');
  const ids = uniqueIds(localityIds);
  if (ids.length !== localityIds.length || !ids.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Choose one or more unique target localities');
  }
  if (ids.some((id) => !coverageIds.includes(id))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Campaigns can target only localities approved for this outlet');
  }
  const localities = await Locality.find({ _id: { $in: ids }, city: business.city, status: true }).select('_id').lean();
  if (localities.length !== ids.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Every selected locality must be active and belong to the outlet city');
  }

  let zone = null;
  if (packageDoc.targetingLevel === 'locality' && ids.length !== 1) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This package targets exactly one locality');
  }
  if (packageDoc.targetingLevel === 'zone') {
    if (!zoneId) throw new ApiError(httpStatus.BAD_REQUEST, 'Select a published delivery zone for this package');
    zone = await DeliveryZone.findOne({ _id: zoneId, city: business.city, status: true }).select('name localities').lean();
    if (!zone) throw new ApiError(httpStatus.BAD_REQUEST, 'Choose an active delivery zone in the outlet city');
    const zoneIds = new Set(uniqueIds(zone.localities));
    if (ids.some((id) => !zoneIds.has(id))) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Every selected locality must belong to the selected delivery zone');
    }
  } else if (zoneId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A delivery zone is only used for zone-targeted packages');
  }
  if (packageDoc.targetingLevel === 'city') {
    const cityLocalities = await Locality.find({ city: business.city, status: true }).distinct('_id');
    const allCityIds = new Set(uniqueIds(cityLocalities));
    if (ids.length !== allCityIds.size || ids.some((id) => !allCityIds.has(id))) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'City-targeted campaigns must include every active locality in the city');
    }
  }
  return { ids, zone };
};

const ensureSlotAvailable = async ({ packageDoc, localityIds, startsAt, endsAt }) => {
  const conflicts = await DairyMarketingCampaign.find({
    package: packageDoc._id,
    status: { $in: activeCampaignStatuses },
    startsAt: { $lt: endsAt },
    endsAt: { $gt: startsAt },
    targetLocalities: { $in: localityIds },
  }).select('_id').limit(packageDoc.maxConcurrent).lean();
  if (conflicts.length >= packageDoc.maxConcurrent) {
    throw new ApiError(httpStatus.CONFLICT, 'That placement is already booked for one or more selected localities at this time');
  }
};

const createCampaign = async ({ businessId, actorId, packageId, caption, startsAt: requestedStart, localities, zone: zoneId, product: productId }) => {
  const [business, packageDoc] = await Promise.all([
    Business.findOne({ _id: businessId, vertical: 'dairy', status: true }),
    DairyMarketingPackage.findOne({ _id: packageId, status: true }),
  ]);
  if (!business) throw new ApiError(httpStatus.NOT_FOUND, 'Active Dairy outlet not found');
  if (!packageDoc) throw new ApiError(httpStatus.NOT_FOUND, 'Marketing package is unavailable');
  const start = new Date(requestedStart);
  const now = Date.now();
  if (!Number.isFinite(start.getTime()) || start.getTime() < now + 5 * 60 * 1000) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Campaign start time must be at least five minutes from now');
  }
  if (start.getTime() > now + 60 * 24 * 60 * 60 * 1000) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Campaigns can be scheduled up to 60 days ahead');
  }
  const { ids, zone } = await validateTarget({ business, packageDoc, localityIds: localities, zoneId });
  let product = null;
  if (productId) {
    product = await DairyProduct.findOne({ _id: productId, business: business._id, status: true }).select('_id').lean();
    if (!product) throw new ApiError(httpStatus.BAD_REQUEST, 'Choose an active product from this outlet');
  }
  if (packageDoc.placement === 'featured_product' && !product) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Choose a product for the featured-product package');
  }
  const end = new Date(start.getTime() + packageDoc.durationHours * 60 * 60 * 1000);
  await ensureSlotAvailable({ packageDoc, localityIds: ids, startsAt: start, endsAt: end });

  return DairyMarketingCampaign.create({
    business: business._id,
    package: packageDoc._id,
    caption,
    packageSnapshot: {
      name: packageDoc.name,
      code: packageDoc.code,
      placement: packageDoc.placement,
      targetingLevel: packageDoc.targetingLevel,
      durationHours: packageDoc.durationHours,
      price: packageDoc.price,
    },
    city: business.city,
    zone: zone?._id,
    targetLocalities: ids,
    product: product?._id,
    startsAt: start,
    endsAt: end,
    amount: packageDoc.price,
    paymentStatus: 'unpaid',
    status: 'pending_review',
    approval: { status: 'pending' },
    createdBy: actorId,
  });
};

const eventCounts = async (campaignIds) => {
  if (!campaignIds.length) return new Map();
  const rows = await DairyMarketingEvent.aggregate([
    { $match: { campaign: { $in: campaignIds } } },
    { $group: { _id: { campaign: '$campaign', type: '$type' }, total: { $sum: 1 } } },
  ]);
  const counts = new Map();
  for (const row of rows) {
    const id = String(row._id.campaign);
    const item = counts.get(id) || { impressions: 0, clicks: 0 };
    item[row._id.type === 'click' ? 'clicks' : 'impressions'] = row.total;
    counts.set(id, item);
  }
  return counts;
};

const listCampaigns = async ({ businessId, status, paymentStatus, page, limit } = {}) => {
  const paging = pagination({ page, limit });
  const filter = {};
  if (businessId) filter.business = businessId;
  if (status) filter.status = status;
  if (paymentStatus) filter.paymentStatus = paymentStatus;
  const [rows, totalResults] = await Promise.all([
    DairyMarketingCampaign.find(filter).populate('package', 'name code placement targetingLevel durationHours')
      .populate('targetLocalities', 'name').populate('product', 'name images')
      .sort({ createdAt: -1 }).skip((paging.page - 1) * paging.limit).limit(paging.limit).lean(),
    DairyMarketingCampaign.countDocuments(filter),
  ]);
  const counts = await eventCounts(rows.map((row) => row._id));
  return {
    campaigns: rows.map((row) => ({ ...row, metrics: counts.get(String(row._id)) || { impressions: 0, clicks: 0 } })),
    totalResults,
    ...paging,
  };
};

const listAdminCampaigns = async ({ status, paymentStatus, page, limit } = {}) => {
  const result = await listCampaigns({ status, paymentStatus, page, limit });
  const campaignIds = result.campaigns.map((row) => row._id);
  if (campaignIds.length) {
    const businesses = await Business.find({ _id: { $in: result.campaigns.map((row) => row.business) } })
      .select('name code city locality vertical status').populate('city', 'name').populate('locality', 'name').lean();
    const byId = new Map(businesses.map((business) => [String(business._id), business]));
    result.campaigns = result.campaigns.map((row) => ({ ...row, business: byId.get(String(row.business)) || row.business }));
  }
  return result;
};

const reviewCampaign = async ({ campaignId, reviewerId, decision, note = '' }) => {
  const campaign = await DairyMarketingCampaign.findById(campaignId);
  if (!campaign) throw new ApiError(httpStatus.NOT_FOUND, 'Campaign not found');
  if (campaign.status !== 'pending_review' || campaign.paymentStatus !== 'unpaid') {
    throw new ApiError(httpStatus.CONFLICT, 'Only unpaid campaigns awaiting review can be moderated');
  }
  if (decision === 'approve' && campaign.endsAt <= new Date()) {
    throw new ApiError(httpStatus.CONFLICT, 'This campaign schedule has already ended');
  }
  campaign.approval = {
    status: decision === 'approve' ? 'approved' : 'rejected',
    by: reviewerId,
    at: new Date(),
    note: note || '',
  };
  campaign.status = decision === 'approve' ? 'approved_unpaid' : 'rejected';
  await campaign.save();
  return campaign;
};

const currentLocalityForAddress = async ({ addressId, userId }) => {
  const address = await UserAddress.findOne({ _id: addressId, user: userId, status: true }).lean();
  if (!address) throw new ApiError(httpStatus.BAD_REQUEST, 'Choose an active saved delivery address');
  let localityId = idOf(address.localityRef);
  if (!localityId && address.locality && address.cityRef) {
    const locality = await Locality.resolveByNameOrAlias(address.locality, address.cityRef);
    localityId = idOf(locality?._id);
  }
  if (!localityId) throw new ApiError(httpStatus.BAD_REQUEST, 'Update the address locality to view Dairy promotions');
  return localityId;
};

const listFeatured = async ({ addressId, userId, placement }) => {
  const localityId = await currentLocalityForAddress({ addressId, userId });
  const now = new Date();
  const filter = {
    targetLocalities: localityId,
    paymentStatus: 'paid',
    'approval.status': 'approved',
    status: { $in: ['scheduled', 'live'] },
    startsAt: { $lte: now },
    endsAt: { $gt: now },
  };
  if (placement) filter['packageSnapshot.placement'] = placement;
  const campaigns = await DairyMarketingCampaign.find(filter)
    .populate('business', 'name code logo locality city vertical status deliveryCoverage.activeLocalities')
    .populate('product', 'name images shortDescription category brand status')
    .sort({ 'packageSnapshot.placement': 1, startsAt: 1 }).limit(30).lean();
  const result = [];
  for (const campaign of campaigns) {
    const business = campaign.business;
    if (!business || business.status !== true || business.vertical !== 'dairy') continue;
    const activeIds = uniqueIds(business.deliveryCoverage?.activeLocalities);
    if ((activeIds.length ? !activeIds.includes(localityId) : idOf(business.locality) !== localityId)) continue;
    const stockFilter = {
      business: business._id,
      status: true,
      inStock: true,
      availableQty: { $gt: 0 },
      ...(campaign.product ? { product: campaign.product._id } : {}),
    };
    if (!(await DairySku.exists(stockFilter))) continue;
    result.push(campaign);
  }
  return { campaigns: result, locality: localityId };
};

const recordEvent = async ({ campaignId, userId, addressId, type }) => {
  const localityId = await currentLocalityForAddress({ addressId, userId });
  const campaign = await DairyMarketingCampaign.findOne({
    _id: campaignId,
    targetLocalities: localityId,
    paymentStatus: 'paid',
    'approval.status': 'approved',
    status: { $in: ['scheduled', 'live'] },
    startsAt: { $lte: new Date() },
    endsAt: { $gt: new Date() },
  }).select('business');
  if (!campaign) throw new ApiError(httpStatus.NOT_FOUND, 'Campaign is not available for this locality');
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  try {
    await DairyMarketingEvent.create({ campaign: campaign._id, business: campaign.business, user: userId, locality: localityId, type, day });
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
  return { recorded: true };
};

module.exports = {
  listPackages,
  createPackage,
  updatePackage,
  createCampaign,
  listCampaigns,
  listAdminCampaigns,
  reviewCampaign,
  listFeatured,
  recordEvent,
};
