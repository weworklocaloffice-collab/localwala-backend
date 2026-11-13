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
 * modification, or use of this source code is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const {
  LocalServiceMarketingPackage,
  LocalServiceMarketingCampaign,
  LocalServiceMarketingEvent,
} = require('../models/localservice.marketing.model');
const LocalServiceProvider = require('../models/localservice.provider.model');
const { LocalServiceCoverage } = require('../models/localservice.staff.model');
const { notifyUser } = require('./localservice.notify.service');

const ACTIVE_CAMPAIGN_STATUSES = Object.freeze([
  'pending_review',
  'approved_unpaid',
  'scheduled',
  'live',
  'paused',
]);

const PLACEMENT_ORDER = Object.freeze({ home: 0, search: 1, category: 2 });

const pagination = ({ page = 1, limit = 20 } = {}) => ({
  page: Math.max(1, Number.parseInt(page, 10) || 1),
  limit: Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 20)),
});

const normalizeList = (values = []) =>
  [...new Set((values || []).map((value) => String(value).trim()).filter(Boolean))];

const resolveProvider = async (ownerId) => {
  const provider = await LocalServiceProvider.findOne({ owner: ownerId });
  if (!provider) throw new ApiError(httpStatus.NOT_FOUND, 'No provider profile');
  return provider;
};

const resolveActiveProvider = async (ownerId) => {
  const provider = await resolveProvider(ownerId);
  if (provider.status !== 'ACTIVE' || !provider.bookable) {
    throw new ApiError(httpStatus.CONFLICT, 'Complete provider setup and get approved before buying marketing');
  }
  return provider;
};

const listPackages = async ({ page, limit, status, placement, activeOnly = false } = {}) => {
  const paging = pagination({ page, limit });
  const filter = {};
  if (activeOnly) filter.status = true;
  else if (status !== undefined) filter.status = status === true || status === 'true';
  if (placement) filter.placement = placement;
  const [packages, totalResults] = await Promise.all([
    LocalServiceMarketingPackage.find(filter)
      .sort({ placement: 1, durationHours: 1, name: 1 })
      .skip((paging.page - 1) * paging.limit)
      .limit(paging.limit)
      .lean(),
    LocalServiceMarketingPackage.countDocuments(filter),
  ]);
  return { packages, totalResults, ...paging };
};

const createPackage = async (payload, actorId) => {
  try {
    return await LocalServiceMarketingPackage.create({
      ...payload,
      createdBy: actorId,
      updatedBy: actorId,
    });
  } catch (error) {
    if (error && error.code === 11000) {
      throw new ApiError(httpStatus.CONFLICT, 'A package with this code already exists');
    }
    throw error;
  }
};

const updatePackage = async (packageId, payload, actorId) => {
  const packageDoc = await LocalServiceMarketingPackage.findById(packageId);
  if (!packageDoc) throw new ApiError(httpStatus.NOT_FOUND, 'Marketing package not found');
  Object.assign(packageDoc, payload, { updatedBy: actorId });
  try {
    await packageDoc.save();
  } catch (error) {
    if (error && error.code === 11000) {
      throw new ApiError(httpStatus.CONFLICT, 'A package with this code already exists');
    }
    throw error;
  }
  return packageDoc;
};

const validateTarget = async ({ provider, packageDoc, localities, pincodes, city }) => {
  const coverage = await LocalServiceCoverage.findOne({ provider: provider._id }).lean();
  if (!coverage) {
    throw new ApiError(httpStatus.CONFLICT, 'Set service areas before booking a campaign');
  }

  const coverageLocalities = normalizeList(coverage.localities);
  const coveragePincodes = normalizeList(coverage.pincodes);
  const targetLocalities = normalizeList(localities);
  const targetPincodes = normalizeList(pincodes);

  if (targetLocalities.length > 50 || targetPincodes.length > 50) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Choose at most 50 target areas');
  }

  if (packageDoc.targetingLevel === 'locality') {
    if (targetLocalities.length !== 1) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'This package targets exactly one locality');
    }
    if (!coverageLocalities.includes(targetLocalities[0])) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Campaigns can target only localities in your service area');
    }
    return { targetLocalities, targetPincodes: [], city: coverage.city || null };
  }

  if (packageDoc.targetingLevel === 'pincode') {
    if (!targetPincodes.length) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Choose one or more target pincodes');
    }
    if (targetPincodes.some((pincode) => !coveragePincodes.includes(pincode))) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Campaigns can target only pincodes in your service area');
    }
    return { targetLocalities: [], targetPincodes, city: coverage.city || null };
  }

  const coverageCity = String(coverage.city || '').trim();
  const requestedCity = String(city || coverageCity).trim();
  if (!coverageCity) {
    throw new ApiError(httpStatus.CONFLICT, 'Set your service city before booking a city campaign');
  }
  if (requestedCity.toLowerCase() !== coverageCity.toLowerCase()) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'City campaigns must match your service city');
  }
  return { targetLocalities, targetPincodes, city: coverageCity };
};

const ensureSlotAvailable = async ({ packageDoc, campaignTarget, startsAt, endsAt }) => {
  const overlap = [];
  if (campaignTarget.targetLocalities.length) {
    overlap.push({ targetLocalities: { $in: campaignTarget.targetLocalities } });
  }
  if (campaignTarget.targetPincodes.length) {
    overlap.push({ targetPincodes: { $in: campaignTarget.targetPincodes } });
  }
  if (!overlap.length) overlap.push({ city: campaignTarget.city });

  const conflicts = await LocalServiceMarketingCampaign.find({
    package: packageDoc._id,
    status: { $in: ACTIVE_CAMPAIGN_STATUSES },
    startsAt: { $lt: endsAt },
    endsAt: { $gt: startsAt },
    $or: overlap,
  })
    .select('_id')
    .limit(packageDoc.maxConcurrent)
    .lean();

  if (conflicts.length >= packageDoc.maxConcurrent) {
    throw new ApiError(
      httpStatus.CONFLICT,
      'That placement is already booked for one or more selected areas at this time'
    );
  }
};

const createCampaign = async ({
  ownerId,
  actorId,
  packageId,
  caption,
  startsAt: requestedStart,
  localities,
  pincodes,
  city,
  categoryKey,
  service: serviceId,
}) => {
  const provider = await resolveActiveProvider(ownerId);
  const packageDoc = await LocalServiceMarketingPackage.findOne({ _id: packageId, status: true });
  if (!packageDoc) throw new ApiError(httpStatus.NOT_FOUND, 'Marketing package is unavailable');

  const start = new Date(requestedStart);
  const now = Date.now();
  if (!Number.isFinite(start.getTime()) || start.getTime() < now + 5 * 60 * 1000) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Campaign start time must be at least five minutes from now');
  }
  if (start.getTime() > now + 60 * 24 * 60 * 60 * 1000) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Campaigns can be scheduled up to 60 days ahead');
  }

  const campaignTarget = await validateTarget({
    provider,
    packageDoc,
    localities,
    pincodes,
    city,
  });

  let service = null;
  if (serviceId) {
    const Service = require('../models/localservice.service.model');
    service = await Service.findById(serviceId).select('_id categoryKey status').lean();
    if (!service || service.status !== 'active') {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Choose an active service to promote');
    }
    if (categoryKey && service.categoryKey !== categoryKey) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Promoted service does not belong to the selected category');
    }
  }
  if (packageDoc.placement === 'category') {
    if (!categoryKey) throw new ApiError(httpStatus.BAD_REQUEST, 'Choose a category for this placement');
    if (service && service.categoryKey !== categoryKey) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Promoted service does not belong to the selected category');
    }
  }

  const end = new Date(start.getTime() + packageDoc.durationHours * 60 * 60 * 1000);
  await ensureSlotAvailable({
    packageDoc,
    campaignTarget,
    startsAt: start,
    endsAt: end,
  });

  return LocalServiceMarketingCampaign.create({
    provider: provider._id,
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
    city: campaignTarget.city,
    targetLocalities: campaignTarget.targetLocalities,
    targetPincodes: campaignTarget.targetPincodes,
    categoryKey: categoryKey || service?.categoryKey,
    service: service?._id,
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
  const rows = await LocalServiceMarketingEvent.aggregate([
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

const listCampaigns = async ({ providerId, status, paymentStatus, page, limit } = {}) => {
  const paging = pagination({ page, limit });
  const filter = {};
  if (providerId) filter.provider = providerId;
  if (status) filter.status = status;
  if (paymentStatus) filter.paymentStatus = paymentStatus;
  const [rows, totalResults] = await Promise.all([
    LocalServiceMarketingCampaign.find(filter)
      .populate('package', 'name code placement targetingLevel durationHours')
      .populate('service', 'name categoryKey')
      .sort({ createdAt: -1 })
      .skip((paging.page - 1) * paging.limit)
      .limit(paging.limit)
      .lean(),
    LocalServiceMarketingCampaign.countDocuments(filter),
  ]);
  const counts = await eventCounts(rows.map((row) => row._id));
  return {
    campaigns: rows.map((row) => ({
      ...row,
      metrics: counts.get(String(row._id)) || { impressions: 0, clicks: 0 },
    })),
    totalResults,
    ...paging,
  };
};

const listAdminCampaigns = async ({ status, paymentStatus, page, limit } = {}) => {
  const result = await listCampaigns({ status, paymentStatus, page, limit });
  const providerIds = result.campaigns.map((row) => row.provider).filter(Boolean);
  if (providerIds.length) {
    const providers = await LocalServiceProvider.find({ _id: { $in: providerIds } })
      .select('businessName providerType owner status bookable')
      .lean();
    const byId = new Map(providers.map((provider) => [String(provider._id), provider]));
    result.campaigns = result.campaigns.map((row) => ({
      ...row,
      provider: byId.get(String(row.provider)) || row.provider,
    }));
  }
  return result;
};

const reviewCampaign = async ({ campaignId, reviewerId, decision, note = '' }) => {
  const campaign = await LocalServiceMarketingCampaign.findById(campaignId);
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

  const provider = await LocalServiceProvider.findById(campaign.provider).lean();
  if (provider && provider.owner) {
    await notifyUser({
      userId: provider.owner,
      title: decision === 'approve' ? 'Campaign approved' : 'Campaign rejected',
      content:
        decision === 'approve'
          ? `Your campaign "${campaign.caption}" is approved. Complete payment to schedule it.`
          : `Your campaign "${campaign.caption}" was rejected${note ? `: ${note}` : ''}`,
      payload: { campaignId: String(campaign._id), kind: 'local_service_marketing_review' },
    });
  }
  return campaign;
};

const updateCampaignStatus = async ({ campaignId, ownerId, action }) => {
  const provider = await resolveProvider(ownerId);
  const campaign = await LocalServiceMarketingCampaign.findOne({
    _id: campaignId,
    provider: provider._id,
  });
  if (!campaign) throw new ApiError(httpStatus.NOT_FOUND, 'Campaign not found');
  if (campaign.paymentStatus !== 'paid') {
    throw new ApiError(httpStatus.CONFLICT, 'Only a paid campaign can be paused, resumed, or cancelled');
  }

  const now = new Date();
  if (action === 'cancel') {
    if (['completed', 'cancelled'].includes(campaign.status)) {
      throw new ApiError(httpStatus.CONFLICT, `Campaign is already ${campaign.status}`);
    }
    campaign.status = 'cancelled';
  } else if (action === 'pause') {
    if (!['scheduled', 'live'].includes(campaign.status)) {
      throw new ApiError(httpStatus.CONFLICT, 'Only a scheduled or live campaign can be paused');
    }
    campaign.status = 'paused';
  } else if (action === 'resume') {
    if (campaign.status !== 'paused') {
      throw new ApiError(httpStatus.CONFLICT, 'Only a paused campaign can be resumed');
    }
    if (campaign.endsAt <= now) campaign.status = 'completed';
    else if (campaign.startsAt <= now) campaign.status = 'live';
    else campaign.status = 'scheduled';
  } else {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Unknown campaign action');
  }
  await campaign.save();
  return campaign;
};

const availableCampaignQuery = (now = new Date()) => ({
  paymentStatus: 'paid',
  'approval.status': 'approved',
  status: { $in: ['scheduled', 'live'] },
  startsAt: { $lte: now },
  endsAt: { $gt: now },
});

const audienceFilter = ({ locality, pincode, city }) => {
  const clauses = [];
  if (locality) clauses.push({ targetLocalities: String(locality) });
  if (pincode) clauses.push({ targetPincodes: String(pincode) });
  if (city) clauses.push({ city: String(city) });
  return clauses;
};

const listFeatured = async ({ locality, pincode, city, placement, categoryKey, limit = 30 } = {}) => {
  const clauses = audienceFilter({ locality, pincode, city });
  if (!clauses.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Provide a locality, pincode, or city');
  }
  const now = new Date();
  const filter = { ...availableCampaignQuery(now), $or: clauses };
  if (placement) filter['packageSnapshot.placement'] = placement;
  if (categoryKey) filter.categoryKey = String(categoryKey).toLowerCase();

  const campaigns = await LocalServiceMarketingCampaign.find(filter)
    .populate('provider', 'businessName providerType status bookable')
    .populate('service', 'name categoryKey status')
    .sort({ 'packageSnapshot.placement': 1, startsAt: 1 })
    .limit(Math.min(100, Math.max(1, Number(limit) || 30)))
    .lean();

  const providerIds = campaigns.map((campaign) => campaign.provider?._id).filter(Boolean);
  const coverages = providerIds.length
    ? await LocalServiceCoverage.find({ provider: { $in: providerIds } }).lean()
    : [];
  const coverageByProvider = new Map(
    coverages.map((coverage) => [String(coverage.provider), coverage])
  );

  const result = [];
  for (const campaign of campaigns) {
    const provider = campaign.provider;
    if (!provider || provider.status !== 'ACTIVE' || !provider.bookable) continue;
    const coverage = coverageByProvider.get(String(provider._id));
    if (!coverage) continue;
    const coverageLocalities = normalizeList(coverage.localities);
    const coveragePincodes = normalizeList(coverage.pincodes);
    if (locality && !coverageLocalities.includes(String(locality))) continue;
    if (pincode && !coveragePincodes.includes(String(pincode))) continue;
    if (campaign.service && campaign.service.status !== 'active') continue;
    result.push(campaign);
  }

  result.sort((a, b) => {
    const placementDelta =
      (PLACEMENT_ORDER[a.packageSnapshot?.placement] ?? 9) -
      (PLACEMENT_ORDER[b.packageSnapshot?.placement] ?? 9);
    if (placementDelta !== 0) return placementDelta;
    return new Date(a.startsAt) - new Date(b.startsAt);
  });

  return {
    campaigns: result,
    context: {
      locality: locality ? String(locality) : null,
      pincode: pincode ? String(pincode) : null,
      city: city ? String(city) : null,
    },
  };
};

const recordEvent = async ({ campaignId, userId, locality, pincode, city, type }) => {
  const clauses = audienceFilter({ locality, pincode, city });
  if (!clauses.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Provide a locality, pincode, or city');
  }
  const campaign = await LocalServiceMarketingCampaign.findOne({
    _id: campaignId,
    ...availableCampaignQuery(),
    $or: clauses,
  }).select('provider');

  if (!campaign) throw new ApiError(httpStatus.NOT_FOUND, 'Campaign is not available for this area');

  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  try {
    await LocalServiceMarketingEvent.create({
      campaign: campaign._id,
      provider: campaign.provider,
      user: userId,
      locality: locality ? String(locality) : undefined,
      pincode: pincode ? String(pincode) : undefined,
      type,
      day,
    });
  } catch (error) {
    if (!error || error.code !== 11000) throw error;
  }
  return { recorded: true };
};

const sweepCampaigns = async (now = new Date(), { CampaignModel } = {}) => {
  const Campaign = CampaignModel || LocalServiceMarketingCampaign;
  const activated = await Campaign.updateMany(
    { status: 'scheduled', startsAt: { $lte: now }, endsAt: { $gt: now } },
    { $set: { status: 'live' } }
  );
  const completed = await Campaign.updateMany(
    { status: { $in: ['scheduled', 'live', 'paused'] }, endsAt: { $lte: now } },
    { $set: { status: 'completed' } }
  );
  const lapsed = await Campaign.updateMany(
    { status: 'approved_unpaid', endsAt: { $lte: now } },
    { $set: { status: 'cancelled' } }
  );
  return {
    activated: activated.modifiedCount || 0,
    completed: completed.modifiedCount || 0,
    lapsed: lapsed.modifiedCount || 0,
  };
};

module.exports = {
  ACTIVE_CAMPAIGN_STATUSES,
  listPackages,
  createPackage,
  updatePackage,
  createCampaign,
  listCampaigns,
  listAdminCampaigns,
  reviewCampaign,
  updateCampaignStatus,
  listFeatured,
  recordEvent,
  sweepCampaigns,
};
