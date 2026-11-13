const catchAsync = require('../../../utils/catchAsync');
const marketingService = require('../services/dairy.marketing.service');
const paymentService = require('../services/dairy.marketing.payment.service');

const partnerPackages = catchAsync(async (req, res) => {
  const result = await marketingService.listPackages({ ...req.query, activeOnly: true });
  res.send(result);
});

const partnerCampaigns = catchAsync(async (req, res) => {
  const result = await marketingService.listCampaigns({
    ...req.query,
    businessId: req.outletId,
  });
  res.send(result);
});

const createCampaign = catchAsync(async (req, res) => {
  const campaign = await marketingService.createCampaign({
    ...req.body,
    businessId: req.outletId,
    actorId: req.user._id,
  });
  res.status(201).send({ campaign });
});

const payCampaign = catchAsync(async (req, res) => {
  const result = await paymentService.initiateCampaignPayment({
    campaignId: req.params.campaign,
    businessId: req.outletId,
    userId: req.user._id,
    paymentConfigId: req.body.payment,
  });
  res.status(201).send({ campaign: result.campaign, payLink: String(result.initiation._id) });
});

const adminPackages = catchAsync(async (req, res) => {
  res.send(await marketingService.listPackages(req.query));
});

const createPackage = catchAsync(async (req, res) => {
  const packageDoc = await marketingService.createPackage(req.body, req.user._id);
  res.status(201).send({ package: packageDoc });
});

const updatePackage = catchAsync(async (req, res) => {
  const packageDoc = await marketingService.updatePackage(req.params.package, req.body, req.user._id);
  res.send({ package: packageDoc });
});

const adminCampaigns = catchAsync(async (req, res) => {
  res.send(await marketingService.listAdminCampaigns(req.query));
});

const reviewCampaign = catchAsync(async (req, res) => {
  const campaign = await marketingService.reviewCampaign({
    campaignId: req.params.campaign,
    reviewerId: req.user._id,
    ...req.body,
  });
  res.send({ campaign });
});

const featured = catchAsync(async (req, res) => {
  res.send(await marketingService.listFeatured({
    addressId: req.query.address,
    userId: req.user._id,
    placement: req.query.placement,
  }));
});

const recordEvent = catchAsync(async (req, res) => {
  res.send(await marketingService.recordEvent({
    campaignId: req.params.campaign,
    userId: req.user._id,
    addressId: req.body.address,
    type: req.body.type,
  }));
});

module.exports = {
  partnerPackages,
  partnerCampaigns,
  createCampaign,
  payCampaign,
  adminPackages,
  createPackage,
  updatePackage,
  adminCampaigns,
  reviewCampaign,
  featured,
  recordEvent,
};
