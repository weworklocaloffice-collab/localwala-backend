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

const { status: httpStatus } = require('http-status');
const catchAsync = require('../../../utils/catchAsync');
const ApiError = require('../../../utils/ApiError');
const marketing = require('../services/localservice.marketing.service');
const marketingPayment = require('../services/localservice.marketing.payment.service');
const entitlement = require('../services/localservice.entitlement.service');
const LocalServiceProvider = require('../models/localservice.provider.model');
const { recordAudit } = require('../services/localservice.audit.service');

const pagePayload = ({ totalResults, page, limit }) => ({
  totalResults,
  totalPages: Math.ceil(totalResults / limit),
  page,
  limit,
});

const requireProvider = async (ownerId) => {
  const provider = await LocalServiceProvider.findOne({ owner: ownerId });
  if (!provider) throw new ApiError(httpStatus.NOT_FOUND, 'No provider profile');
  return provider;
};

const listPartnerPackages = catchAsync(async (req, res) => {
  const result = await marketing.listPackages({
    page: req.query.page,
    limit: req.query.limit,
    placement: req.query.placement,
    activeOnly: true,
  });
  res.status(httpStatus.OK).send({
    packages: result.packages,
    ...pagePayload(result),
  });
});

const listPartnerCampaigns = catchAsync(async (req, res) => {
  const provider = await requireProvider(req.user._id);
  const result = await marketing.listCampaigns({
    providerId: provider._id,
    status: req.query.status,
    paymentStatus: req.query.paymentStatus,
    page: req.query.page,
    limit: req.query.limit,
  });
  res.status(httpStatus.OK).send({
    campaigns: result.campaigns,
    ...pagePayload(result),
  });
});

const createCampaign = catchAsync(async (req, res) => {
  await entitlement.requireEntitlement(req.user._id, 'marketing');
  const campaign = await marketing.createCampaign({
    ownerId: req.user._id,
    actorId: req.user._id,
    packageId: req.body.package,
    caption: req.body.caption,
    startsAt: req.body.startsAt,
    localities: req.body.localities,
    pincodes: req.body.pincodes,
    city: req.body.city,
    categoryKey: req.body.categoryKey,
    service: req.body.service,
  });
  res.status(httpStatus.CREATED).send({ campaign });
});

const payCampaign = catchAsync(async (req, res) => {
  const result = await marketingPayment.initiateCampaignPayment({
    campaignId: req.params.campaign,
    ownerId: req.user._id,
    paymentConfigId: req.body.paymentConfigId,
    paymentRef: req.body.paymentRef,
  });
  res.status(httpStatus.OK).send({
    campaign: result.campaign,
    payLink: String(result.initiation._id),
    paymentInitiation: result.initiation,
  });
});

const updateCampaignStatus = catchAsync(async (req, res) => {
  const campaign = await marketing.updateCampaignStatus({
    campaignId: req.params.campaign,
    ownerId: req.user._id,
    action: req.body.action,
  });
  res.status(httpStatus.OK).send({ campaign });
});

const listAdminPackages = catchAsync(async (req, res) => {
  const result = await marketing.listPackages({
    page: req.query.page,
    limit: req.query.limit,
    status: req.query.status,
    placement: req.query.placement,
  });
  res.status(httpStatus.OK).send({
    packages: result.packages,
    ...pagePayload(result),
  });
});

const createPackage = catchAsync(async (req, res) => {
  const packageDoc = await marketing.createPackage(req.body, req.user._id);
  await recordAudit(req, {
    event: 'marketing_package.created',
    targetType: 'marketing_package',
    targetId: packageDoc._id,
    details: `Created marketing package ${packageDoc.code}`,
    metadata: { code: packageDoc.code, placement: packageDoc.placement, price: packageDoc.price },
  });
  res.status(httpStatus.CREATED).send({ package: packageDoc });
});

const updatePackage = catchAsync(async (req, res) => {
  const packageDoc = await marketing.updatePackage(req.params.packageId, req.body, req.user._id);
  await recordAudit(req, {
    event: 'marketing_package.updated',
    targetType: 'marketing_package',
    targetId: packageDoc._id,
    details: `Updated marketing package ${packageDoc.code}`,
    metadata: { code: packageDoc.code, placement: packageDoc.placement, price: packageDoc.price },
  });
  res.status(httpStatus.OK).send({ package: packageDoc });
});

const listAdminCampaigns = catchAsync(async (req, res) => {
  const result = await marketing.listAdminCampaigns({
    status: req.query.status,
    paymentStatus: req.query.paymentStatus,
    page: req.query.page,
    limit: req.query.limit,
  });
  res.status(httpStatus.OK).send({
    campaigns: result.campaigns,
    ...pagePayload(result),
  });
});

const reviewCampaign = catchAsync(async (req, res) => {
  const campaign = await marketing.reviewCampaign({
    campaignId: req.params.campaign,
    reviewerId: req.user._id,
    decision: req.body.decision,
    note: req.body.note,
  });
  await recordAudit(req, {
    event: `marketing_campaign.${req.body.decision}`,
    targetType: 'marketing_campaign',
    targetId: campaign._id,
    details: `Campaign ${campaign.caption} ${req.body.decision === 'approve' ? 'approved' : 'rejected'}`,
    metadata: { status: campaign.status, note: req.body.note || '' },
  });
  res.status(httpStatus.OK).send({ campaign });
});

const listFeatured = catchAsync(async (req, res) => {
  const result = await marketing.listFeatured({
    locality: req.query.locality,
    pincode: req.query.pincode,
    city: req.query.city,
    placement: req.query.placement,
    categoryKey: req.query.categoryKey,
    limit: req.query.limit,
  });
  res.status(httpStatus.OK).send(result);
});

const recordEvent = catchAsync(async (req, res) => {
  const result = await marketing.recordEvent({
    campaignId: req.params.campaign,
    userId: req.user._id,
    locality: req.body.locality,
    pincode: req.body.pincode,
    city: req.body.city,
    type: req.body.type,
  });
  res.status(httpStatus.OK).send(result);
});

module.exports = {
  listPartnerPackages,
  listPartnerCampaigns,
  createCampaign,
  payCampaign,
  updateCampaignStatus,
  listAdminPackages,
  createPackage,
  updatePackage,
  listAdminCampaigns,
  reviewCampaign,
  listFeatured,
  recordEvent,
};
