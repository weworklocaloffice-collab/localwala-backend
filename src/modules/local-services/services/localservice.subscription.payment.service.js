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
const growth = require('./localservice.growth.service');
const { notifyUser } = require('./localservice.notify.service');

const LS_SUBSCRIPTION_PAYMENT_SUBJECTS = Object.freeze(['localServiceSubscription']);

const isLsSubscriptionSubject = (paymentFrom) =>
  LS_SUBSCRIPTION_PAYMENT_SUBJECTS.includes(paymentFrom);

const requireActiveProvider = async (ownerId, { ProviderModel } = {}) => {
  const LocalServiceProvider = ProviderModel || require('../models/localservice.provider.model');
  const provider = await LocalServiceProvider.findOne({ owner: ownerId, status: 'ACTIVE' });
  if (!provider) throw new ApiError(httpStatus.FORBIDDEN, 'Provider not active');
  return provider;
};

const planSnapshotOf = (plan) => ({
  code: plan.code,
  name: plan.name,
  price: Number(plan.price) || 0,
  interval: plan.interval,
  entitlements: Array.isArray(plan.entitlements) ? [...plan.entitlements] : [],
});

const ensureSystemRule = async ({ RevenueRuleModel } = {}) => {
  const LocalServiceRevenueRule =
    RevenueRuleModel || require('../models/localservice.revenue.rule.model');
  const existing = await LocalServiceRevenueRule.findOne({ code: 'SYSTEM_SUBSCRIPTION', version: 1 });
  if (existing) return existing;
  try {
    return await LocalServiceRevenueRule.create({
      code: 'SYSTEM_SUBSCRIPTION',
      name: 'Partner subscription revenue (system)',
      description: 'System rule used to post prepaid subscription plan revenue',
      revenueModel: 'SUBSCRIPTION',
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
      return LocalServiceRevenueRule.findOne({ code: 'SYSTEM_SUBSCRIPTION', version: 1 });
    }
    throw error;
  }
};

const postSubscriptionRevenue = async (
  subscription,
  paymentId,
  { RevenueEntryModel, RevenueRuleModel } = {}
) => {
  const LocalServiceRevenueEntry =
    RevenueEntryModel || require('../models/localservice.revenue.entry.model');
  const rule = await ensureSystemRule({ RevenueRuleModel });
  if (!rule) return null;

  const amount = Number(subscription.amount) || 0;
  const snapshot = rule.toSnapshot();
  snapshot.subscriptionId = String(subscription._id);
  snapshot.planCode = subscription.planSnapshot?.code || null;
  snapshot.entrySource = 'subscription';

  try {
    return await LocalServiceRevenueEntry.create({
      idempotencyKey: `lssub:subscription:${subscription._id}:paid`,
      provider: subscription.provider,
      paymentId: paymentId || subscription.paymentInitiation,
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
      note: `Subscription plan ${subscription.planSnapshot?.code || ''}`.trim(),
    });
  } catch (error) {
    if (error && error.code === 11000) return null;
    throw error;
  }
};

const activateSubscription = async (
  { subscriptionId, paymentId, amount },
  { SubscriptionModel, RevenueEntryModel, RevenueRuleModel } = {}
) => {
  const Subscription =
    SubscriptionModel ||
    require('../models/localservice.growth.model').LocalServiceSubscription;
  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription) return { subscription: null, deduped: true };
  if (subscription.paymentStatus === 'paid') return { subscription, deduped: true };

  const expected = Number(subscription.amount) || 0;
  const paidAmount = amount == null ? expected : Number(amount);
  if (expected > 0 && Math.abs(paidAmount - expected) > 0.01) {
    console.error(
      `[ls.subscription] amount mismatch for subscription ${subscription._id}: expected ${expected}, got ${paidAmount}`
    );
  }

  const now = new Date();
  subscription.paymentStatus = 'paid';
  subscription.paidAt = now;
  subscription.status = 'active';
  subscription.startedAt = now;
  subscription.renewAt = growth.nextRenewAt(now, subscription.planSnapshot?.interval || 'monthly');
  if (paymentId) subscription.paymentInitiation = paymentId;
  await subscription.save();

  if (typeof Subscription.updateMany === 'function') {
    await Subscription.updateMany(
      { provider: subscription.provider, _id: { $ne: subscription._id }, status: 'active' },
      { $set: { status: 'expired' } }
    );
  }

  await postSubscriptionRevenue(subscription, paymentId, { RevenueEntryModel, RevenueRuleModel });
  return { subscription, deduped: false };
};

const initiateSubscriptionPayment = async (
  { subscriptionId, ownerId, paymentConfigId, paymentRef } = {},
  { SubscriptionModel, PaymentInitiationModel, PaymentConfigModel, ProviderModel } = {}
) => {
  const Subscription =
    SubscriptionModel ||
    require('../models/localservice.growth.model').LocalServiceSubscription;
  const PaymentInitiation =
    PaymentInitiationModel || require('../../../models/payment.initiation.model');
  const PaymentConfig = PaymentConfigModel || require('../../../models/payment.config.model');

  const provider = await requireActiveProvider(ownerId, { ProviderModel });
  const subscription = await Subscription.findOne({ _id: subscriptionId, provider: provider._id });
  if (!subscription) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription not found');
  if (subscription.paymentStatus === 'paid' || subscription.status === 'active') {
    throw new ApiError(httpStatus.CONFLICT, 'Subscription is already active');
  }
  if (subscription.status !== 'pending_payment') {
    throw new ApiError(httpStatus.CONFLICT, 'Subscription is not payable');
  }

  const amount = Number(subscription.amount) || 0;
  if (amount <= 0) throw new ApiError(httpStatus.BAD_REQUEST, 'Subscription amount is invalid');

  const config = paymentConfigId
    ? await PaymentConfig.findById(paymentConfigId)
    : (await PaymentConfig.findOne({ status: true, isDefault: true })) ||
      (await PaymentConfig.findOne({ status: true }));
  if (!config || config.status === false) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Payment gateway not available');
  }

  const open = await PaymentInitiation.findOne({
    localServiceSubscription: subscription._id,
    paymentFrom: 'localServiceSubscription',
    status: 'initiated',
  }).sort({ createdAt: -1 });

  if (open && (open.amount == null || Number(open.amount) === amount)) {
    subscription.paymentStatus = 'initiated';
    subscription.paymentInitiation = open._id;
    await subscription.save();
    return { subscription, initiation: open };
  }
  if (open) {
    open.status = 'cancelled';
    if (typeof open.save === 'function') await open.save();
  }

  const initiation = await PaymentInitiation.create({
    user: provider.owner,
    payment: config._id,
    localServiceSubscriptionId: String(subscription._id),
    localServiceSubscription: subscription._id,
    amount,
    paymentRef: paymentRef || `LS-SUB-${subscription._id}`,
    paymentFrom: 'localServiceSubscription',
  });

  subscription.paymentStatus = 'initiated';
  subscription.paymentInitiation = initiation._id;
  await subscription.save();

  return { subscription, initiation };
};

const subscribe = async (
  { ownerId, planId, paymentConfigId, paymentRef } = {},
  { PlanModel, SubscriptionModel, ProviderModel, ...deps } = {}
) => {
  const Plan =
    PlanModel ||
    require('../models/localservice.growth.model').LocalServiceSubscriptionPlan;
  const Subscription =
    SubscriptionModel ||
    require('../models/localservice.growth.model').LocalServiceSubscription;

  const provider = await requireActiveProvider(ownerId, { ProviderModel });
  const plan = await Plan.findById(planId);
  if (!plan || plan.status !== 'active') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Plan not active');
  }

  const amount = Number(plan.price) || 0;
  const now = new Date();
  const subscription = await Subscription.create({
    provider: provider._id,
    plan: plan._id,
    status: amount > 0 ? 'pending_payment' : 'active',
    startedAt: now,
    renewAt: growth.nextRenewAt(now, plan.interval),
    amount,
    paymentStatus: amount > 0 ? 'unpaid' : 'paid',
    paidAt: amount > 0 ? undefined : now,
    planSnapshot: planSnapshotOf(plan),
  });

  if (amount <= 0) return { subscription, initiation: null };

  const { initiation } = await initiateSubscriptionPayment(
    { subscriptionId: subscription._id, ownerId, paymentConfigId, paymentRef },
    { SubscriptionModel, ProviderModel, ...deps }
  );
  return { subscription, initiation };
};

const expireSubscriptions = async (at = new Date(), { SubscriptionModel } = {}) => {
  const Subscription =
    SubscriptionModel ||
    require('../models/localservice.growth.model').LocalServiceSubscription;

  const expired = await Subscription.updateMany(
    { status: 'active', renewAt: { $lte: at } },
    { $set: { status: 'expired' } }
  );
  const abandoned = await Subscription.updateMany(
    {
      status: 'pending_payment',
      createdAt: { $lte: new Date(new Date(at).getTime() - 24 * 60 * 60 * 1000) },
    },
    { $set: { status: 'cancelled', cancelledAt: at } }
  );

  return {
    expired: expired.modifiedCount || 0,
    abandoned: abandoned.modifiedCount || 0,
  };
};

const routePaidCallback = async (payment) => {
  if (!payment || !isLsSubscriptionSubject(payment.paymentFrom)) return false;
  const subscriptionId = payment.localServiceSubscriptionId || payment.localServiceSubscription;
  if (!subscriptionId) {
    console.error('[ls.subscription] localServiceSubscription callback without subscription id');
    return true;
  }
  const { subscription, deduped } = await activateSubscription({
    subscriptionId,
    paymentId: payment._id || payment.id,
    amount: payment.amount,
  });
  if (!subscription) return true;

  if (!deduped) {
    const LocalServiceProvider = require('../models/localservice.provider.model');
    const provider = await LocalServiceProvider.findById(subscription.provider).select('owner').lean();
    if (provider && provider.owner) {
      await notifyUser({
        userId: provider.owner,
        title: 'Subscription active',
        content: `Your ${subscription.planSnapshot?.name || 'subscription'} plan is active until ${new Date(
          subscription.renewAt
        ).toLocaleDateString('en-IN')}.`,
        payload: {
          subscriptionId: String(subscription._id),
          kind: 'local_service_subscription_paid',
        },
      });
    }
  }
  return true;
};

const routeFailedCallback = async (payment, reason) => {
  if (!payment || !isLsSubscriptionSubject(payment.paymentFrom)) return false;
  const subscriptionId = payment.localServiceSubscriptionId || payment.localServiceSubscription;
  if (!subscriptionId) return true;

  const Subscription =
    require('../models/localservice.growth.model').LocalServiceSubscription;
  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription) return true;

  if (subscription.paymentStatus === 'initiated') {
    subscription.paymentStatus = 'unpaid';
    await subscription.save();
  }
  if (reason) {
    const LocalServiceProvider = require('../models/localservice.provider.model');
    const provider = await LocalServiceProvider.findById(subscription.provider).select('owner').lean();
    if (provider && provider.owner) {
      await notifyUser({
        userId: provider.owner,
        title: 'Subscription payment failed',
        content: 'Payment could not be completed for your subscription plan.',
        payload: {
          subscriptionId: String(subscription._id),
          kind: 'local_service_subscription_payment_failed',
          reason,
        },
      });
    }
  }
  return true;
};

module.exports = {
  LS_SUBSCRIPTION_PAYMENT_SUBJECTS,
  isLsSubscriptionSubject,
  activateSubscription,
  initiateSubscriptionPayment,
  subscribe,
  expireSubscriptions,
  routePaidCallback,
  routeFailedCallback,
};
