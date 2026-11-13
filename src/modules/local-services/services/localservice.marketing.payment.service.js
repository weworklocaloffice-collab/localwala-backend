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
const ApiError = require('../../../utils/ApiError');
const { notifyUser } = require('./localservice.notify.service');

const LS_MARKETING_PAYMENT_SUBJECTS = Object.freeze(['localServiceCampaign']);

const isLsMarketingSubject = (paymentFrom) => LS_MARKETING_PAYMENT_SUBJECTS.includes(paymentFrom);

const requireProvider = async (ownerId, { ProviderModel } = {}) => {
  const LocalServiceProvider = ProviderModel || require('../models/localservice.provider.model');
  const provider = await LocalServiceProvider.findOne({ owner: ownerId });
  if (!provider) throw new ApiError(httpStatus.NOT_FOUND, 'No provider profile');
  return provider;
};

const ensureSystemRule = async ({ RevenueRuleModel } = {}) => {
  const LocalServiceRevenueRule =
    RevenueRuleModel || require('../models/localservice.revenue.rule.model');
  const existing = await LocalServiceRevenueRule.findOne({ code: 'SYSTEM_MARKETING', version: 1 });
  if (existing) return existing;
  try {
    return await LocalServiceRevenueRule.create({
      code: 'SYSTEM_MARKETING',
      name: 'Marketing campaign revenue (system)',
      description: 'System rule used to post prepaid sponsored campaign revenue',
      revenueModel: 'FEATURED',
      vertical: 'local_services',
      payer: 'provider',
      bookingFeeEnabled: false,
      bookingFee: 0,
      commissionEnabled: false,
      commissionType: 'fixed',
      commissionRatePercent: 0,
      commissionFixedAmount: 0,
      calculationBasis: 'BOOKING_VALUE',
      qualifyingEvent: 'PAYMENT_RECEIVED',
      effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
      status: 'active',
      version: 1,
    });
  } catch (error) {
    if (error && error.code === 11000) {
      return LocalServiceRevenueRule.findOne({ code: 'SYSTEM_MARKETING', version: 1 });
    }
    throw error;
  }
};

const postCampaignRevenue = async (campaign, paymentId, { RevenueEntryModel, RevenueRuleModel } = {}) => {
  const LocalServiceRevenueEntry =
    RevenueEntryModel || require('../models/localservice.revenue.entry.model');
  const rule = await ensureSystemRule({ RevenueRuleModel });
  if (!rule) return null;

  const amount = Number(campaign.amount) || 0;
  const snapshot = rule.toSnapshot();
  snapshot.campaignId = String(campaign._id);
  snapshot.campaignCode = campaign.packageSnapshot?.code || null;
  snapshot.entrySource = 'marketing';

  try {
    return await LocalServiceRevenueEntry.create({
      idempotencyKey: `lsmkt:campaign:${campaign._id}:paid`,
      provider: campaign.provider,
      paymentId: paymentId || campaign.paymentInitiation,
      rule: rule._id,
      ruleSnapshot: snapshot,
      serviceValue: amount,
      customerTotal: amount,
      platformRevenue: amount,
      providerPayable: 0,
      bookingFee: 0,
      commissionBase: 0,
      commissionAmount: 0,
      currency: 'INR',
      payer: 'provider',
      qualifyingEvent: 'PAYMENT_RECEIVED',
      entryType: 'charge',
      status: 'applied',
      note: `Sponsored campaign ${campaign.caption}`,
      createdBy: campaign.createdBy,
    });
  } catch (error) {
    if (error && error.code === 11000) return null;
    throw error;
  }
};

const markCampaignPaid = async (
  { campaignId, paymentId, amount },
  { CampaignModel, RevenueEntryModel, RevenueRuleModel } = {}
) => {
  const Campaign =
    CampaignModel || require('../models/localservice.marketing.model').LocalServiceMarketingCampaign;
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) return { campaign: null, deduped: true };
  if (campaign.paymentStatus === 'paid') return { campaign, deduped: true };

  const expected = Number(campaign.amount) || 0;
  const paidAmount = amount == null ? expected : Number(amount);
  if (expected > 0 && Math.abs(paidAmount - expected) > 0.01) {
    console.error(
      `[ls.marketing] amount mismatch for campaign ${campaign._id}: expected ${expected}, got ${paidAmount}`
    );
  }

  const now = new Date();
  let nextStatus = 'completed';
  if (campaign.endsAt > now) {
    nextStatus = campaign.startsAt <= now ? 'live' : 'scheduled';
  }

  campaign.paymentStatus = 'paid';
  campaign.paidAt = now;
  campaign.status = nextStatus;
  if (paymentId) campaign.paymentInitiation = paymentId;
  await campaign.save();

  await postCampaignRevenue(campaign, paymentId, { RevenueEntryModel, RevenueRuleModel });
  return { campaign, deduped: false, nextStatus };
};

const initiateCampaignPayment = async (
  { campaignId, ownerId, paymentConfigId, paymentRef } = {},
  { CampaignModel, PaymentInitiationModel, PaymentConfigModel, ProviderModel } = {}
) => {
  const Campaign =
    CampaignModel || require('../models/localservice.marketing.model').LocalServiceMarketingCampaign;
  const PaymentInitiation =
    PaymentInitiationModel || require('../../../models/payment.initiation.model');
  const PaymentConfig = PaymentConfigModel || require('../../../models/payment.config.model');

  const provider = await requireProvider(ownerId, { ProviderModel });
  const campaign = await Campaign.findOne({ _id: campaignId, provider: provider._id });
  if (!campaign) throw new ApiError(httpStatus.NOT_FOUND, 'Campaign not found');
  if (campaign.approval?.status !== 'approved' || campaign.status !== 'approved_unpaid') {
    throw new ApiError(httpStatus.CONFLICT, 'Campaign must be approved before payment');
  }
  if (campaign.paymentStatus === 'paid') {
    throw new ApiError(httpStatus.CONFLICT, 'Campaign is already paid');
  }
  if (campaign.endsAt <= new Date()) {
    throw new ApiError(httpStatus.CONFLICT, 'Campaign schedule has ended');
  }

  const amount = Number(campaign.amount) || 0;
  if (amount <= 0) throw new ApiError(httpStatus.BAD_REQUEST, 'Campaign amount is invalid');

  const config = paymentConfigId
    ? await PaymentConfig.findById(paymentConfigId)
    : (await PaymentConfig.findOne({ status: true, isDefault: true })) ||
      (await PaymentConfig.findOne({ status: true }));
  if (!config || config.status === false) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Payment gateway not available');
  }

  const open = await PaymentInitiation.findOne({
    localServiceCampaign: campaign._id,
    paymentFrom: 'localServiceCampaign',
    status: 'initiated',
  }).sort({ createdAt: -1 });

  if (open && (open.amount == null || Number(open.amount) === amount)) {
    campaign.paymentStatus = 'initiated';
    campaign.paymentInitiation = open._id;
    await campaign.save();
    return { campaign, initiation: open };
  }
  if (open) {
    open.status = 'cancelled';
    if (typeof open.save === 'function') await open.save();
  }

  const initiation = await PaymentInitiation.create({
    user: provider.owner,
    payment: config._id,
    localServiceCampaignId: String(campaign._id),
    localServiceCampaign: campaign._id,
    amount,
    paymentRef: paymentRef || `LS-CAMPAIGN-${campaign._id}`,
    paymentFrom: 'localServiceCampaign',
  });

  campaign.paymentStatus = 'initiated';
  campaign.paymentInitiation = initiation._id;
  await campaign.save();

  return { campaign, initiation };
};

const routePaidCallback = async (payment) => {
  if (!payment || !isLsMarketingSubject(payment.paymentFrom)) return false;
  const campaignId = payment.localServiceCampaignId || payment.localServiceCampaign;
  if (!campaignId) {
    console.error('[ls.marketing] localServiceCampaign callback without campaign id');
    return true;
  }
  const { campaign, deduped } = await markCampaignPaid({
    campaignId,
    paymentId: payment._id || payment.id,
    amount: payment.amount,
  });
  if (!campaign) return true;

  if (!deduped) {
    const LocalServiceProvider = require('../models/localservice.provider.model');
    const provider = await LocalServiceProvider.findById(campaign.provider).select('owner').lean();
    if (provider && provider.owner) {
      await notifyUser({
        userId: provider.owner,
        title: 'Campaign scheduled',
        content: `Payment received. Campaign "${campaign.caption}" is ${campaign.status}.`,
        payload: { campaignId: String(campaign._id), kind: 'local_service_marketing_paid' },
      });
    }
  }
  return true;
};

const routeFailedCallback = async (payment, reason) => {
  if (!payment || !isLsMarketingSubject(payment.paymentFrom)) return false;
  const campaignId = payment.localServiceCampaignId || payment.localServiceCampaign;
  if (!campaignId) return true;

  const Campaign = require('../models/localservice.marketing.model').LocalServiceMarketingCampaign;
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) return true;

  if (campaign.paymentStatus === 'initiated') {
    campaign.paymentStatus = 'unpaid';
    await campaign.save();
  }
  if (reason) {
    const LocalServiceProvider = require('../models/localservice.provider.model');
    const provider = await LocalServiceProvider.findById(campaign.provider).select('owner').lean();
    if (provider && provider.owner) {
      await notifyUser({
        userId: provider.owner,
        title: 'Campaign payment failed',
        content: `Payment could not be completed for campaign "${campaign.caption}".`,
        payload: {
          campaignId: String(campaign._id),
          kind: 'local_service_marketing_payment_failed',
          reason,
        },
      });
    }
  }
  return true;
};

module.exports = {
  LS_MARKETING_PAYMENT_SUBJECTS,
  isLsMarketingSubject,
  initiateCampaignPayment,
  markCampaignPaid,
  routePaidCallback,
  routeFailedCallback,
};
