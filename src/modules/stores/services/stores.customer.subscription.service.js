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

/**
 * stores.customer.subscription.service.js — customer subscription lifecycle.
 *
 * Handles creation, listing, pausing, skipping, cancelling, and occurrence
 * generation for customer recurring subscriptions (§6.18).
 */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const { toPaise, toRupees } = require('./stores.tax.service');

const SUBSCRIPTION_TRANSITIONS = {
  scheduled: ['paused', 'skipped', 'payment_failed', 'cancelled', 'completed', 'failed'],
  paused: ['scheduled', 'cancelled'],
  skipped: ['scheduled', 'cancelled'],
  payment_failed: ['scheduled', 'cancelled', 'failed'],
  cancelled: [],
  completed: [],
  failed: [],
};

const assertTransition = (from, to) => {
  const allowed = SUBSCRIPTION_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new ApiError(httpStatus.CONFLICT, `ILLEGAL_SUBSCRIPTION_MOVE: ${from} -> ${to} is not allowed. Allowed: ${allowed?.join(', ') || 'none'}`);
  }
};

const getNextOccurrence = (current, cadence, intervalCount) => {
  const next = new Date(current);
  switch (cadence) {
    case 'weekly':
      next.setDate(next.getDate() + 7 * intervalCount);
      break;
    case 'biweekly':
      next.setDate(next.getDate() + 14 * intervalCount);
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + intervalCount);
      break;
    case 'custom':
      // Custom cadence handled elsewhere
      break;
  }
  return next;
};

const createCustomerSubscription = async ({ customer, outlet, chain, plan, items, cadence, intervalCount, deliveryDayOfWeek, deliverySlot, address, discountPercentage, substitutionPolicy, priceLockPolicy, startDate, endDate, editCutoffHours, skipDates }) => {
  const StoreCustomerSubscription = mongoose.model('StoreCustomerSubscription');
  const StoreRecurringPlan = mongoose.model('StoreRecurringPlan');

  // Derive the chain from the outlet when the caller did not send one.
  //
  // A customer subscribes AT a store, so the outlet is the fact they know; the chain is a
  // property of that outlet and is not something the app should have to look up or carry.
  // Resolving it here means `chain` can never be a silently-undefined field — the exact
  // failure that left every customer-created subscription orphaned.
  let resolvedChain = chain;
  if (outlet && !resolvedChain) {
    const StoreOutlet = mongoose.model('StoreOutlet');
    const outletDoc = await StoreOutlet.findById(outlet).select('chain').lean();
    if (!outletDoc) throw new ApiError(httpStatus.NOT_FOUND, 'Store not found');
    resolvedChain = outletDoc.chain;
  }

  // If plan is provided, validate and copy plan details
  let subscriptionData = {
    customer,
    outlet,
    chain: resolvedChain,
    items,
    cadence,
    intervalCount: intervalCount || 1,
    deliveryDayOfWeek,
    deliverySlot,
    address,
    discountPercentage: discountPercentage || 0,
    substitutionPolicy: substitutionPolicy || 'none',
    priceLockPolicy: priceLockPolicy || 'notify_and_confirm',
    startDate,
    nextOccurrenceDate: startDate,
    editCutoffHours: editCutoffHours || 2,
    skipDates: skipDates || [],
    endDate,
    status: 'scheduled',
  };

  if (plan) {
    const planDoc = await StoreRecurringPlan.findById(plan);
    if (!planDoc) throw new ApiError(httpStatus.NOT_FOUND, 'Recurring plan not found');
    if (planDoc.status !== 'active') throw new ApiError(httpStatus.CONFLICT, 'Plan is not active');
    if (String(planDoc.outlet) !== String(outlet)) throw new ApiError(httpStatus.CONFLICT, 'Plan not available at this outlet');
    if (planDoc.maxSubscribers > 0 && planDoc.subscriberCount >= planDoc.maxSubscribers) {
      throw new ApiError(httpStatus.CONFLICT, 'Plan subscriber limit reached');
    }

    // Use plan defaults if not explicitly provided
    if (!items || !items.length) {
      subscriptionData.items = planDoc.items.map(i => ({
        variant: i.variant,
        quantity: i.quantity,
        name: i.variant?.name || '', // would need populate
        unitPriceAtSubscribe: i.variant?.price || 0, // would need populate
      }));
    }
    if (!cadence) subscriptionData.cadence = planDoc.cadence;
    if (!intervalCount) subscriptionData.intervalCount = 1;
    if (!deliveryDayOfWeek) subscriptionData.deliveryDayOfWeek = planDoc.deliveryDayOfWeek;
    if (!deliverySlot) subscriptionData.deliverySlot = planDoc.deliverySlot;
    if (!discountPercentage) subscriptionData.discountPercentage = planDoc.discountPercentage || 0;
    if (!substitutionPolicy) subscriptionData.substitutionPolicy = planDoc.substitutionPolicy || 'none';
  }

  const subscription = await StoreCustomerSubscription.create(subscriptionData);

  // Increment plan subscriber count if applicable
  if (plan) {
    await StoreRecurringPlan.findByIdAndUpdate(plan, { $inc: { subscriberCount: 1 } });
  }

  return subscription;
};

/**
 * Build the scoping filter for a customer-facing subscription read or write.
 *
 * `customer` and `outlet` are BOTH applied when supplied — they narrow, never replace.
 * Passing neither is only legitimate for a caller that has already established
 * authorisation some other way (an admin sweep, a cron over every subscription).
 *
 * Why this exists: every read/write below used to key off `outlet` alone, or off the bare
 * id. On the customer routes the auth is `appAuth`, so `req.outletId` is undefined — those
 * filters collapsed to `{ _id }` and any authenticated customer could read, pause, resume,
 * cancel or skip ANY other customer's subscription by guessing its id. `pauseSubscription`,
 * `resumeSubscription` and `cancelSubscription` were worse: they accepted an `outlet`
 * argument and then ignored it, delegating straight to a bare `findById`.
 */
const ownershipFilter = (subscriptionId, { outlet, customer } = {}) => {
  const query = { _id: subscriptionId };
  if (outlet) query.outlet = outlet;
  if (customer) query.customer = customer;
  return query;
};

const getCustomerSubscription = async (subscriptionId, { outlet, customer } = {}) => {
  const StoreCustomerSubscription = mongoose.model('StoreCustomerSubscription');
  const query = ownershipFilter(subscriptionId, { outlet, customer });
  const subscription = await StoreCustomerSubscription.findOne(query)
    .populate('plan', 'name description price')
    .populate('outlet', 'name outletCode')
    .populate('chain', 'name')
    .populate('customer', 'name email mobile')
    .populate('items.variant', 'name sku price priceInPaise')
    .populate('address', 'name line1 line2 city pincode location')
    .lean();
  if (!subscription) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription not found');
  return subscription;
};

const listCustomerSubscriptions = async ({ outlet, customer, status, page = 1, limit = 20 }) => {
  const StoreCustomerSubscription = mongoose.model('StoreCustomerSubscription');
  const filter = {};
  if (outlet) filter.outlet = outlet;
  if (customer) filter.customer = customer;
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    StoreCustomerSubscription.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate('plan', 'name')
      .populate('outlet', 'name outletCode')
      .populate('chain', 'name')
      .lean(),
    StoreCustomerSubscription.countDocuments(filter),
  ]);
  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

/**
 * `customer` and `outlet` scope WHICH subscription may be touched. They are not optional
 * decoration: the customer routes pass `customer: req.user._id`, and without it this
 * function is a bare `findById` — see `ownershipFilter`.
 */
const transitionSubscription = async (subscriptionId, to, { actor, notes, outlet, customer } = {}) => {
  const StoreCustomerSubscription = mongoose.model('StoreCustomerSubscription');
  const subscription = await StoreCustomerSubscription.findOne(ownershipFilter(subscriptionId, { outlet, customer }));
  if (!subscription) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription not found');

  assertTransition(subscription.status, to);

  subscription.status = to;
  subscription.history = subscription.history || [];
  subscription.history.push({ from: subscription.status, to, by: actor, at: new Date(), notes });

  if (to === 'paused') subscription.pausedAt = new Date();
  if (to === 'skipped') subscription.skipDates.push(new Date());
  if (to === 'cancelled') {
    subscription.cancelledAt = new Date();
    subscription.cancelReason = notes;
  }
  if (to === 'completed') subscription.completedAt = new Date();

  await subscription.save();
  return subscription;
};

const skipNextOccurrence = async (subscriptionId, { outlet, customer, actor, reason } = {}) => {
  const StoreCustomerSubscription = mongoose.model('StoreCustomerSubscription');
  const query = ownershipFilter(subscriptionId, { outlet, customer });
  const subscription = await StoreCustomerSubscription.findOne(query);
  if (!subscription) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription not found');
  if (subscription.status !== 'scheduled') throw new ApiError(httpStatus.CONFLICT, 'Only scheduled subscriptions can be skipped');

  // Add next occurrence to skip dates
  const nextOcc = subscription.nextOccurrenceDate;
  if (nextOcc) {
    subscription.skipDates.push(nextOcc);
    // Recalculate next occurrence
    subscription.nextOccurrenceDate = getNextOccurrence(nextOcc, subscription.cadence, subscription.intervalCount || 1);
  }

  subscription.history = subscription.history || [];
  subscription.history.push({ from: 'scheduled', to: 'skipped', by: actor, at: new Date(), notes: reason });

  await subscription.save();
  return subscription;
};

/**
 * `outlet` AND `customer` are now both forwarded to `transitionSubscription`. They used to
 * be accepted and thrown away: each of these three destructured `outlet`, then called
 * `transitionSubscription(subscriptionId, ...)` with a bare id. The signature promised a
 * scope the implementation never applied — which is worse than not having the parameter,
 * because a caller reading the signature believes the row is constrained when it is not.
 */
const pauseSubscription = async (subscriptionId, { outlet, customer, actor, reason } = {}) => {
  return transitionSubscription(subscriptionId, 'paused', { actor, notes: reason, outlet, customer });
};

const resumeSubscription = async (subscriptionId, { outlet, customer, actor } = {}) => {
  return transitionSubscription(subscriptionId, 'scheduled', { actor, outlet, customer });
};

const cancelSubscription = async (subscriptionId, { outlet, customer, actor, reason } = {}) => {
  return transitionSubscription(subscriptionId, 'cancelled', { actor, notes: reason, outlet, customer });
};

const listCustomerSubscriptionsForCustomer = async (customerId, { page = 1, limit = 20 } = {}) => {
  const StoreCustomerSubscription = mongoose.model('StoreCustomerSubscription');
  const [items, total] = await Promise.all([
    StoreCustomerSubscription.find({ customer: customerId }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate('plan', 'name')
      .populate('outlet', 'name outletCode')
      .populate('chain', 'name')
      .lean(),
    StoreCustomerSubscription.countDocuments({ customer: customerId }),
  ]);
  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

const getUpcomingOccurrences = async ({ outlet, customer, days = 30 } = {}) => {
  const StoreCustomerSubscription = mongoose.model('StoreCustomerSubscription');
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);
  const filter = { status: 'scheduled', nextOccurrenceDate: { $lte: cutoff } };
  if (outlet) filter.outlet = outlet;
  if (customer) filter.customer = customer;
  return StoreCustomerSubscription.find(filter).populate('plan', 'name').populate('outlet', 'name outletCode').lean();
};

module.exports = {
  createCustomerSubscription,
  getCustomerSubscription,
  listCustomerSubscriptions,
  transitionSubscription,
  skipNextOccurrence,
  pauseSubscription,
  resumeSubscription,
  cancelSubscription,
  listCustomerSubscriptionsForCustomer,
  getUpcomingOccurrences,
  assertTransition,
  SUBSCRIPTION_TRANSITIONS,
};