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
const {
  DairySubscription,
  DairySubscriptionEvent,
  DairyRecurringOrder,
  DairySku,
} = require('../../../models');
const ApiError = require('../../../utils/ApiError');
const billingService = require('./dairy.subscription.billing.service');
const verticalService = require('../../../kernel/vertical/services/vertical.service');

/**
 * Reads the configured skip cutoff, never throwing.
 *
 * Subscriptions are on the read path of the app and admin, so a settings lookup
 * failure must not take the page down with it — falling back to the schema default
 * (9 hours) is both safe and non-disruptive.
 *
 * @returns {Promise<number>}
 */
const resolveSkipCutoffHours = async () => {
  try {
    const { dairySettingsService } = require('../../../services');
    return await dairySettingsService.getSubscriptionSkipCutoffHours();
  } catch {
    return 9;
  }
};

/**
 * Subscription lifecycle.
 *
 * The specification requires these operations, and every one of them appends to
 * `DairySubscriptionEvent`:
 *
 *   skip date · pause · resume · change quantity · change address
 *   change schedule · cancel
 *
 * Two rules hold throughout:
 *
 *   1. **Recurrence is derived, never stored.** Whether a plan is due on a date is
 *      answered by `isScheduledFor` on the model, so it can never drift out of
 *      date the way a precomputed "next delivery" column would.
 *   2. **Already-generated occurrences are never rewritten.** A change takes
 *      effect from the next occurrence; anything already planned stays as it was
 *      and is visible to the customer, because silently altering a delivery the
 *      rider has already planned is worse than a one-day lag.
 */

const nextSubscriptionNo = async () => {
  const latest = await DairySubscription.findOne().sort({ subscriptionNo: -1 }).select('subscriptionNo');
  return latest && latest.subscriptionNo ? latest.subscriptionNo + 1 : 1;
};

const recordEvent = async (subscription, eventType, param) => {
  return DairySubscriptionEvent.create({
    subscription: subscription._id,
    eventType,
    changes: param.changes,
    skippedDate: param.skippedDate,
    reason: param.reason,
    actorType: param.actorType || 'customer',
    actor: param.actor,
    effectiveFrom: param.effectiveFrom || new Date(),
  });
};

const dayKey = (date) => {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

// //// Create / activate ////

const createSubscription = async (param) => {
  const sku = await DairySku.findById(param.sku);
  if (!sku) {
    throw new ApiError(httpStatus.NOT_FOUND, 'SKU not found');
  }
  if (!sku.inStock) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This pack size is out of stock');
  }

  if (param.scheduleType === 'custom_days' && (!param.customDays || param.customDays.length === 0)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Custom schedule requires at least one day');
  }

  // A plan reserves stock and recurs indefinitely, so halting a vertical has to
  // stop new plans. Existing plans keep generating — cancelling them on a halt
  // would be a far larger act than turning a switch off, and the operator did not
  // ask for it.
  await verticalService.assertTradingOpen('dairy', 'a new plan cannot be started');

  const subscriptionNo = await nextSubscriptionNo();
  const amount = (sku.price || 0) * (param.quantity || 1);

  const subscription = await DairySubscription.create({
    subscriptionNo,
    user: param.user,
    business: param.business || sku.business,
    sku: param.sku,
    quantity: param.quantity,
    scheduleType: param.scheduleType || 'daily',
    customDays: param.customDays || [],
    startDate: param.startDate,
    endDate: param.endDate,
    deliverySlot: param.deliverySlot,
    address: param.address,
    addressRaw: param.addressRaw,
    receiverName: param.receiverName,
    receiverContact: param.receiverContact,
    unitPrice: sku.price,
    payment: param.payment,
    paymentMode: param.paymentMode || 'wallet',
    containerAssignment: param.containerAssignment,
    status: 'active',
    activatedAt: new Date(),
  });

  await recordEvent(subscription, 'created', {
    actor: param.actor || param.user,
    changes: { quantity: param.quantity, scheduleType: subscription.scheduleType },
    effectiveFrom: param.startDate,
  });

  // Stock is deliberately NOT reserved here. It is reserved per occurrence, when
  // the nightly job generates the delivery, so a plan signed today does not lock
  // up next month's milk and a daily plan is not treated like a monthly one.
  // See dairy.subscription.billing.service.js.
  return { subscription, amount };
};

// //// Skip dates ////

/**
 * Skips one delivery.
 *
 * Rejected once an occurrence has already been generated for that date, because
 * the rider may already have it on the manifest. The customer withdraws the skip
 * instead, or asks for the run to be adjusted.
 */
const skipDate = async (subscriptionId, date, param) => {
  const subscription = await getSubscription(subscriptionId);
  assertMutable(subscription);

    const target = dayKey(date);
    const existing = await DairyRecurringOrder.findOne({
      subscription: subscription._id,
      occurrenceDate: target,
    });
    if (existing) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'This delivery has already been planned. Remove the skip so the rider can drop the stop instead.'
      );
    }

    // The skip cutoff: the rider counts tomorrow's crates by ~21:00 the night
    // before, so a skip that arrives after that is too late for the morning run.
    // Without this guard the manifest would quietly lie — the rider shows up with
    // a bottle the customer has already skipped.
    const cutoffHours = await resolveSkipCutoffHours();
    const slotStart = (subscription.deliverySlot && subscription.deliverySlot.startTime) || '06:00';
    const [hh, mm] = String(slotStart).split(':').map(Number);
    const cutoffAt = new Date(target);
    cutoffAt.setHours(Number.isFinite(hh) ? hh : 6, Number.isFinite(mm) ? mm : 0, 0, 0);
    cutoffAt.setHours(cutoffAt.getHours() - cutoffHours);

    if (new Date() >= cutoffAt) {
      throw new ApiError(
        httpStatus.CONFLICT,
        `This delivery is already too close to its ${slotStart} window to skip. Skip at least ${cutoffHours} hour(s) before the slot.`
      );
    }

    const already = (subscription.skipDates || []).some((d) => dayKey(d).getTime() === target.getTime());
  if (already) {
    return subscription;
  }

  subscription.skipDates.push(target);
  await subscription.save();

  await recordEvent(subscription, 'skipped', {
    actor: param.actor,
    skippedDate: target,
    reason: param.reason,
  });

  return subscription;
};

const unskipDate = async (subscriptionId, date, param) => {
  const subscription = await getSubscription(subscriptionId);
  const target = dayKey(date);

  subscription.skipDates = (subscription.skipDates || []).filter(
    (d) => dayKey(d).getTime() !== target.getTime()
  );
  await subscription.save();

  await recordEvent(subscription, 'unskipped', {
    actor: param.actor,
    skippedDate: target,
  });

  return subscription;
};

// //// Pause / resume ////

/**
 * Pauses generation for a window. The plan resumes automatically afterwards, so
 * pausing is not a cancellation.
 */
const pause = async (subscriptionId, param) => {
  // `businessId` is set only by the partner route, where the outlet comes from the
  // token. A customer call leaves it undefined and is scoped by userId instead.
  const subscription = await getSubscription(subscriptionId, { businessId: param.businessId });
  assertMutable(subscription);

  if (subscription.status !== 'paused') {
    subscription.status = 'paused';
  }

  subscription.pauseWindows.push({
    from: param.from || new Date(),
    to: param.to,
    reason: param.reason,
  });
  await subscription.save();

  await recordEvent(subscription, 'paused', {
    actor: param.actor,
    reason: param.reason,
    changes: { from: param.from || new Date(), to: param.to },
  });

  return subscription;
};

const resume = async (subscriptionId, param) => {
  const subscription = await getSubscription(subscriptionId, { businessId: param.businessId });

  if (subscription.status === 'cancelled') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A cancelled plan cannot be resumed — create a new one');
  }

  subscription.status = 'active';

  // Close every open pause window rather than replacing the list, so the history
  // of pauses survives.
  const now = new Date();
  subscription.pauseWindows = (subscription.pauseWindows || []).map((w) =>
    !w.to || new Date(w.to) > now ? { ...w.toObject(), to: now } : w
  );
  await subscription.save();

  await recordEvent(subscription, 'resumed', { actor: param.actor });

  return subscription;
};

// //// Change quantity / address / schedule ////

const changeQuantity = async (subscriptionId, quantity, param) => {
  const subscription = await getSubscription(subscriptionId);
  assertMutable(subscription);

  if (!quantity || quantity < 1) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Quantity must be at least 1');
  }

  const previous = subscription.quantity;
  subscription.quantity = quantity;

  // No stock movement. The new quantity applies from the next generated
  // occurrence, which reserves what it needs; past deliveries are already billed
  // and are not retroactively repriced.
  await subscription.save();

  await recordEvent(subscription, 'quantity_changed', {
    actor: param.actor,
    changes: { from: previous, to: quantity },
  });

  return subscription;
};

const changeAddress = async (subscriptionId, param) => {
  const subscription = await getSubscription(subscriptionId);
  assertMutable(subscription);

  const previous = subscription.addressRaw;
  subscription.address = param.address;
  subscription.addressRaw = param.addressRaw;
  subscription.receiverName = param.receiverName;
  subscription.receiverContact = param.receiverContact;
  await subscription.save();

  await recordEvent(subscription, 'address_changed', {
    actor: param.actor,
    changes: { from: previous, to: param.addressRaw },
  });

  return subscription;
};

/**
 * Changes the recurrence or the delivery slot.
 *
 * `effectiveFrom` defaults to today, and already-generated occurrences are left
 * alone — the rider's manifest for today was built overnight.
 */
const changeSchedule = async (subscriptionId, param) => {
  const subscription = await getSubscription(subscriptionId);
  assertMutable(subscription);

  const changes = {};

  if (param.scheduleType) {
    if (param.scheduleType === 'custom_days' && (!param.customDays || param.customDays.length === 0)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Custom schedule requires at least one day');
    }
    changes.scheduleType = { from: subscription.scheduleType, to: param.scheduleType };
    subscription.scheduleType = param.scheduleType;
  }

  if (param.customDays) {
    changes.customDays = { from: subscription.customDays, to: param.customDays };
    subscription.customDays = param.customDays;
  }

  if (param.deliverySlot) {
    changes.deliverySlot = { from: subscription.deliverySlot, to: param.deliverySlot };
    subscription.deliverySlot = param.deliverySlot;
  }

  if (param.startDate) {
    changes.startDate = { from: subscription.startDate, to: param.startDate };
    subscription.startDate = param.startDate;
  }

  if (param.endDate !== undefined) {
    changes.endDate = { from: subscription.endDate, to: param.endDate };
    subscription.endDate = param.endDate || undefined;
  }

  await subscription.save();

  await recordEvent(subscription, 'schedule_changed', {
    actor: param.actor,
    changes,
    effectiveFrom: param.effectiveFrom || new Date(),
  });

  return subscription;
};

// //// Cancel ////

const cancel = async (subscriptionId, param) => {
  const subscription = await getSubscription(subscriptionId);

  if (subscription.status === 'cancelled') {
    return subscription;
  }

  subscription.status = 'cancelled';
  subscription.cancellation = {
    cancelledAt: new Date(),
    cancelledBy: param.actorType || 'customer',
    reason: param.reason,
  };
  await subscription.save();

  // Anything not yet on a rider's manifest is withdrawn, which refunds anything
  // already prepaid and returns any stock held for it. An already-assigned stop
  // is left alone so the rider's manifest stays truthful.
  const pending = await DairyRecurringOrder.find({
    subscription: subscription._id,
    status: { $in: ['planned', 'billed'] },
    run: { $exists: false },
  });

  for (const occurrence of pending) {
    // The customer's own words, not a generic label: the refund on the order has
    // to explain itself when someone asks why they were charged back.
    await billingService.unwindOccurrence(
      occurrence,
      param.reason || 'Subscription cancelled'
    );
  }

  await recordEvent(subscription, 'cancelled', {
    actor: param.actor,
    reason: param.reason,
    actorType: param.actorType,
  });

  return subscription;
};

const reactivate = async (subscriptionId, param) => {
  const subscription = await getSubscription(subscriptionId);

  if (subscription.status !== 'cancelled') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Only a cancelled plan can be reactivated');
  }

  const sku = await DairySku.findById(subscription.sku);
  if (!sku) {
    throw new ApiError(httpStatus.NOT_FOUND, 'SKU not found');
  }

  // No stock check either. Whether the restarted plan can actually be delivered
  // is decided occurrence by occurrence, so a plan can be restarted on the same
  // day its previous stock was returned and will simply be skipped if the next
  // delivery cannot be covered.
  subscription.status = 'active';
  subscription.cancellation = undefined;
  subscription.skipDates = [];
  subscription.pauseWindows = [];
  await subscription.save();

  await recordEvent(subscription, 'reactivated', { actor: param.actor });

  return subscription;
};

// //// Read helpers ////

const getSubscription = async (subscriptionId, options = {}) => {
  const subscription = await DairySubscription.findById(subscriptionId)
    .populate('sku', 'name packSize price reusableContainer inStock')
    .populate('business', 'name businessModel ownDeliveryPartner')
    .populate('user', 'firstName lastName mobile countryCode');
  
  if (!subscription) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  
  if (options.userId && subscription.user._id.toString() !== options.userId.toString()) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
  }
  
  // A partner may only touch plans belonging to their own outlet. Checked here so
  // every mutating operation below inherits it: without it, passing another
  // outlet's subscription id would let a partner pause or resume its plans.
  if (options.businessId) {
    const planBusiness = subscription.business && subscription.business._id
      ? subscription.business._id
      : subscription.business;
    if (!planBusiness || planBusiness.toString() !== options.businessId.toString()) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
    }
  }
  
  return subscription;
};

const assertMutable = (subscription) => {
  if (subscription.status === 'cancelled') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This plan is cancelled and can no longer be changed');
  }
};

const listSubscriptions = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;

  const query = {};
  if (options.user) query.user = options.user;
  if (options.business) query.business = options.business;
  if (options.status) query.status = options.status;
  if (options.sku) query.sku = options.sku;

  const [subscriptions, totalResults] = await Promise.all([
    DairySubscription.find(query)
      .populate('sku', 'name packSize price inStock')
      .populate('business', 'name businessModel')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    DairySubscription.countDocuments(query),
  ]);

  return { subscriptions, totalResults, page, limit };
};

const listEvents = async (subscriptionId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 20;

  return DairySubscriptionEvent.find({ subscription: subscriptionId })
    .sort({ createdAt: -1 })
    .limit(limit);
};

/**
 * Upcoming deliveries for a subscription, so the customer can see what is
 * planned and what they have skipped.
 */
const getUpcoming = async (subscriptionId, options) => {
  const subscription = await getSubscription(subscriptionId);
  const days = options.days && parseInt(options.days, 10) > 0 ? parseInt(options.days, 10) : 14;

  const results = [];
  const cursor = new Date();
  for (let i = 0; i <= days; i += 1) {
    const candidate = new Date(cursor);
    candidate.setDate(cursor.getDate() + i);
    if (subscription.isScheduledFor(candidate)) {
      const occurrence = await DairyRecurringOrder.findOne({
        subscription: subscription._id,
        occurrenceDate: dayKey(candidate),
      });
      results.push({
        date: dayKey(candidate),
        status: occurrence ? occurrence.status : 'planned',
        run: occurrence ? occurrence.run : null,
      });
    }
  }

  return results;
};

/**
 * Closes out plans that have passed their end date. Keeps `status: 'completed'`
 * meaningful instead of leaving expired plans looking active.
 */
const completeExpired = async () => {
  const today = dayKey(new Date());
  const result = await DairySubscription.updateMany(
    {
      status: 'active',
      endDate: { $exists: true, $ne: null, $lt: today },
    },
    { $set: { status: 'completed' } }
  );
  return result.modifiedCount;
};

module.exports = {
  createSubscription,
  getSubscription,
  listSubscriptions,
  listEvents,
  getUpcoming,
  skipDate,
  unskipDate,
  pause,
  resume,
  changeQuantity,
  changeAddress,
  changeSchedule,
  cancel,
  reactivate,
  completeExpired,
  recordEvent,
  dayKey,
};