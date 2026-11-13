const { status: httpStatus } = require('http-status');
const { DairyMarketingCampaign, PaymentInitiation, PaymentConfig } = require('../../../models');
const ApiError = require('../../../utils/ApiError');
const paymentInitiationService = require('../../../services/payment.initiation.service');

const DAIRY_PAYMENT_SUBJECTS = Object.freeze(['dairy_campaign']);

const initiateCampaignPayment = async ({ campaignId, businessId, userId, paymentConfigId }) => {
  const campaign = await DairyMarketingCampaign.findOne({ _id: campaignId, business: businessId });
  if (!campaign) throw new ApiError(httpStatus.NOT_FOUND, 'Campaign not found');
  if (campaign.status !== 'approved_unpaid' || campaign.approval?.status !== 'approved') {
    throw new ApiError(httpStatus.CONFLICT, 'Campaign must be approved before payment');
  }
  if (campaign.paymentStatus === 'paid') throw new ApiError(httpStatus.CONFLICT, 'Campaign is already paid');
  if (!(Number(campaign.amount) > 0)) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Campaign amount must be positive');
  }

  const existing = await PaymentInitiation.findOne({
    dairyCampaign: campaign._id,
    paymentFrom: 'dairy_campaign',
    status: 'initiated',
  }).sort({ createdAt: -1 });
  if (existing) {
    campaign.paymentInitiation = existing._id;
    campaign.paymentStatus = 'initiated';
    await campaign.save();
    return { campaign, initiation: existing };
  }

  let config = paymentConfigId ? await PaymentConfig.findById(paymentConfigId) : null;
  if (paymentConfigId && !config) throw new ApiError(httpStatus.BAD_REQUEST, 'Payment method not found');
  if (!config) {
    config = (await PaymentConfig.findOne({ isDefault: true, status: true, paymentWay: 'online' })) ||
      (await PaymentConfig.findOne({ status: true, paymentWay: 'online' }));
  }
  if (!config || config.status === false) {
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Online payments are not available right now');
  }

  const initiation = await paymentInitiationService.initiatePayment({
    user: String(userId),
    payment: String(config._id),
    dairyCampaign: String(campaign._id),
    amount: Number(campaign.amount),
    from: 'dairy_campaign',
    ref: `DAIRY-CAMPAIGN-${String(campaign._id).slice(-8).toUpperCase()}`,
  });
  campaign.paymentInitiation = initiation._id;
  campaign.paymentStatus = 'initiated';
  await campaign.save();
  return { campaign, initiation };
};

const applyCampaignPayment = async (payment) => {
  if (!payment?.dairyCampaign) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'Dairy campaign payment has no campaign reference');
  }
  const campaign = await DairyMarketingCampaign.findById(payment.dairyCampaign);
  if (!campaign) throw new ApiError(httpStatus.NOT_FOUND, 'Dairy campaign not found for payment');
  if (campaign.paymentStatus === 'paid') return campaign; // gateway callbacks can be replayed
  if (campaign.status !== 'approved_unpaid' || campaign.approval?.status !== 'approved') {
    throw new ApiError(httpStatus.CONFLICT, 'Only an approved campaign can be paid');
  }
  if (Number(payment.amount) !== Number(campaign.amount)) {
    throw new ApiError(httpStatus.CONFLICT, 'Campaign payment does not match the approved amount');
  }

  const now = new Date();
  campaign.paymentStatus = 'paid';
  campaign.paidAt = now;
  campaign.paymentInitiation = payment._id || campaign.paymentInitiation;
  campaign.status = campaign.endsAt <= now ? 'completed' : campaign.startsAt <= now ? 'live' : 'scheduled';
  await campaign.save();
  return campaign;
};

const routePaidCallback = async (payment) => {
  if (!payment || !DAIRY_PAYMENT_SUBJECTS.includes(payment.paymentFrom)) return false;
  await applyCampaignPayment(payment);
  return true;
};

const routeFailedCallback = async (payment) => {
  if (!payment || !DAIRY_PAYMENT_SUBJECTS.includes(payment.paymentFrom)) return false;
  if (!payment.dairyCampaign) return true;

  const campaign = await DairyMarketingCampaign.findById(payment.dairyCampaign);
  if (!campaign) return true;

  // A delayed callback for an older attempt must not reset a newer attempt.
  const paymentId = payment._id || payment.id;
  if (String(campaign.paymentInitiation || '') === String(paymentId || '')) {
    campaign.paymentStatus = 'unpaid';
    campaign.paymentInitiation = undefined;
    await campaign.save();
  }
  return true;
};

module.exports = {
  DAIRY_PAYMENT_SUBJECTS,
  initiateCampaignPayment,
  routePaidCallback,
  routeFailedCallback,
};
