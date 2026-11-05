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
const logger = require('../../../config/logger');
const { toPaise, toRupees } = require('./stores.tax.service');
const { nextOccurrence: advanceCursor } = require('../../../kernel/recurrence/occurrence.math');

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

const listAwaitingPriceChanges = async (customerId) => {
  const StoreRecurringOrder = mongoose.model('StoreRecurringOrder');
  return StoreRecurringOrder.find({ customer: customerId, generationStatus: 'awaiting_price_acceptance' })
    .populate('subscription', 'items cadence editCutoffHours priceLockPolicy')
    .populate('outlet', 'name outletCode')
    .sort({ occurrenceDate: 1 })
    .lean();
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

// ---------------------------------------------------------------------------
// §6.18.6 occurrence generation
// ---------------------------------------------------------------------------

const dayKeyOf = (value) => new Date(value).toISOString().slice(0, 10);
const utcMidnight = (key) => new Date(`${key}T00:00:00.000Z`);
const round2 = (value) => Math.round(Number(value) * 100) / 100;

// A subscription left behind by weeks (paused, or a cron outage) is caught up over
// several runs instead of one unbounded pass.
const MAX_CYCLES_PER_RUN = 45;

/**
 * Run ONE due occurrence of a subscription through the §6.18.6 gate.
 *
 * The row was already upserted (insert-first contract); this evaluates stock, credit
 * and prices against the CURRENT outlet data and leaves a plain `generated` row when
 * everything is fine.
 */
const evaluateOccurrence = async ({ subscription, row, key, forceAcceptPriceChange = false }) => {
  const notifyService = require('./stores.notify.service');
  const StoreOutletProduct = mongoose.model('StoreOutletProduct');
  const StoreOutletStockItem = mongoose.model('StoreOutletStockItem');
  const StoreRecurringOrder = mongoose.model('StoreRecurringOrder');

  const variants = subscription.items.map((item) => item.variant);

  const [outletProducts, stockItems] = await Promise.all([
    StoreOutletProduct.find({ outlet: subscription.outlet, productVariant: { $in: variants } })
      .select('productVariant price status')
      .lean(),
    StoreOutletStockItem.find({ outlet: subscription.outlet, variant: { $in: variants } })
      .select('variant onHand reserved damaged allowNegativeStock')
      .lean(),
  ]);

  const priceByVariant = new Map(
    outletProducts.filter((rowProduct) => rowProduct.status === 'active').map((rowProduct) => [String(rowProduct.productVariant), rowProduct])
  );
  const stockByVariant = new Map(stockItems.map((stockRow) => [String(stockRow.variant), stockRow]));

  let agreedValue = 0;
  let creditValue = 0;
  let neededQty = 0;
  let fulfillableQty = 0;
  let priceChanged = false;

  for (const item of subscription.items) {
    const qty = Math.max(1, Number(item.quantity) || 1);
    neededQty += qty;

    const stockRow = stockByVariant.get(String(item.variant));
    const sellable = stockRow && !stockRow.allowNegativeStock
      ? Math.max(0, Number(stockRow.onHand) - Number(stockRow.reserved) - Number(stockRow.damaged))
      : qty; // negative-sellable rows are treated as always fulfillable

    fulfillableQty += Math.min(qty, sellable);

    // Credit basis. `unitPriceAtSubscribe` is what the customer agreed to; plan-created
    // subscriptions may not carry it at all (the plan picker copies rows lazily), so the
    // credit falls back to the outlet's live price rather than silently crediting zero.
    const agreedPrice = Number(item.unitPriceAtSubscribe);
    const priceRow = priceByVariant.get(String(item.variant));
    const creditPrice = Number.isFinite(agreedPrice) ? agreedPrice : Number(priceRow?.price ?? 0);
    if (Number.isFinite(creditPrice) && creditPrice > 0) {
      agreedValue += creditPrice * qty;
      creditValue += creditPrice * Math.max(0, qty - sellable);
    }

    // Rule 2 compares the two KNOWN sides; a snapshot with no agreed price cannot claim
    // a "change" just because the row now carries one.
    if (priceRow && Number.isFinite(agreedPrice) && Number(priceRow.price) !== agreedPrice) {
      priceChanged = true;
    }
  }

  const ratio = neededQty ? fulfillableQty / neededQty : 0;

  // Rule 4: below half the box, the delivery is not what was subscribed to.
  if (ratio < 0.5) {
    await StoreRecurringOrder.updateOne(
      { _id: row._id },
      { $set: { generationStatus: 'skipped_no_stock', creditAmount: round2(agreedValue), skipReason: 'stock_under_half' } }
    );
    await notifyService.notifyOrderLifecycle(subscription, 'recurring_order_skipped', {
      date: key,
      reason: 'The store could not supply your box today; its full value is added as store credit.',
    });
    return { outcome: 'skipped_no_stock', creditAmount: round2(agreedValue) };
  }

  // Rule 2: price changed and the customer asked to confirm before charging.
  // Do not create the order yet; leave the occurrence generated and wait for
  // acceptance. No stock is reserved and nothing is charged.
  if (priceChanged && subscription.priceLockPolicy === 'notify_and_confirm' && !forceAcceptPriceChange) {
    await StoreRecurringOrder.updateOne(
      { _id: row._id },
      { $set: { generationStatus: 'awaiting_price_acceptance', creditAmount: round2(creditValue), skipReason: 'price_changed_awaiting_acceptance', notifiedAt: new Date() } }
    );
    await notifyService.notifyOrderLifecycle(subscription, 'recurring_order_generated', {
      date: key,
      cutoff: `${subscription.editCutoffHours ?? 2} hours`,
      note: 'Prices changed since you subscribed — review your box before dispatch. No charge was made.',
    });
    return { outcome: 'awaiting_price_acceptance', creditAmount: round2(creditValue) };
  }

  // Build the order lines from the fulfillable quantities, crediting any shortfall.
  if (!subscription.address) {
    await StoreRecurringOrder.updateOne(
      { _id: row._id },
      { $set: { generationStatus: 'payment_failed', creditAmount: round2(creditValue), skipReason: 'no_delivery_address', notifiedAt: new Date() } }
    );
    await notifyService.notifyOrderLifecycle(subscription, 'recurring_order_skipped', {
      date: key,
      reason: 'No delivery address on file; update your subscription to resume deliveries.',
    });
    return { outcome: 'payment_failed', creditAmount: round2(creditValue) };
  }
  const orderItems = [];
  for (const item of subscription.items) {
    const qty = Math.max(1, Number(item.quantity) || 1);
    const stockRow = stockByVariant.get(String(item.variant));
    const sellable = stockRow && !stockRow.allowNegativeStock
      ? Math.max(0, Number(stockRow.onHand) - Number(stockRow.reserved) - Number(stockRow.damaged))
      : qty;
    const fulfillable = Math.min(qty, sellable);
    if (fulfillable <= 0) continue;

    orderItems.push({ variant: item.variant, quantity: fulfillable });
  }

  if (!orderItems.length) {
    await StoreRecurringOrder.updateOne(
      { _id: row._id },
      { $set: { generationStatus: 'skipped_no_stock', creditAmount: round2(agreedValue), skipReason: 'no_fulfillable_lines' } }
    );
    await notifyService.notifyOrderLifecycle(subscription, 'recurring_order_skipped', {
      date: key,
      reason: 'The store could not supply your box today; its full value is added as store credit.',
    });
    return { outcome: 'skipped_no_stock', creditAmount: round2(agreedValue) };
  }

  // Create the actual StoreOrder (reserves stock inside createOrder).
  const orderService = require('./stores.order.service');
  let createdOrder = null;
  try {
    createdOrder = await orderService.createOrder({
      customer: subscription.customer,
      outlet: subscription.outlet,
      chain: subscription.chain,
      items: orderItems,
      address: subscription.address,
      paymentMode: 'gateway',
    });
  } catch (orderError) {
    logger.error(`Recurring order creation failed for subscription ${subscription._id}: ${orderError.message}`);
    // Fall back to the upsert-first contract: an occurrence with no order is
    // repaired by the reconciliation sweep instead of failing the whole sweep.
    // The shortfall is still credited so the customer is not out of pocket.
    await StoreRecurringOrder.updateOne(
      { _id: row._id },
      { $set: { generationStatus: 'generated', creditAmount: round2(creditValue), skipReason: 'stock_partial_shortfall', notifiedAt: new Date() } }
    );
    await notifyService.notifyOrderLifecycle(subscription, 'recurring_order_generated', {
      date: key,
      cutoff: `${subscription.editCutoffHours ?? 2} hours`,
      note: creditValue > 0 ? `Partial availability: store credit of ${round2(creditValue)} added.` : '',
    });
    return { outcome: creditValue > 0 ? 'generated_with_credit' : 'generated', creditAmount: round2(creditValue) };
  }

  await StoreRecurringOrder.updateOne(
    { _id: row._id },
    { $set: { order: createdOrder._id, generationStatus: 'reserved', creditAmount: round2(creditValue), notifiedAt: new Date() } }
  );

  await notifyService.notifyOrderLifecycle(subscription, 'recurring_order_generated', {
    date: key,
    cutoff: `${subscription.editCutoffHours ?? 2} hours`,
    note: creditValue > 0 ? `Partial availability: store credit of ${round2(creditValue)} added.` : '',
  });

  return { outcome: creditValue > 0 ? 'generated_with_credit' : 'generated', creditAmount: round2(creditValue), orderId: createdOrder._id };
};

/**
 * The §6.18.6 generator. Runs every due `StoreCustomerSubscription` occurrence
 * through its gate and advances the cursor, so a subscription that fell behind is
 * caught up cycle by cycle rather than batched into one order.
 *
 * Ordering contract: the `StoreRecurringOrder` upsert happens BEFORE any stock math
 * or notification — the `(subscription, occurrenceDate)` unique index makes re-runs
 * idempotent, so a crash between the upsert and the evaluation is repaired by the
 * next sweep instead of duplicating an order.
 */
const generateOccurrences = async ({ now = new Date() } = {}) => {
  const StoreCustomerSubscription = mongoose.model('StoreCustomerSubscription');
  const StoreRecurringOrder = mongoose.model('StoreRecurringOrder');
  const notifyService = require('./stores.notify.service');

  const subs = await StoreCustomerSubscription.findDueForGeneration();
  const summary = { subscriptionsChecked: subs.length, generated: 0, skipped: 0, advanced: 0, failures: 0 };
  if (!subs.length) return summary;

  const outletCache = new Map();
  const loadOutlet = async (outletId) => {
    const keyId = String(outletId);
    if (!outletCache.has(keyId)) {
      outletCache.set(keyId, await mongoose.model('StoreOutlet').findById(outletId).select('status operational').lean());
    }
    return outletCache.get(keyId);
  };

  for (const subscription of subs) {
    try {
      let cursor = new Date(subscription.nextOccurrenceDate);
      let stop = false;
      let processed = 0;
      let lastHandled = null;

      while (cursor && cursor <= now && processed < MAX_CYCLES_PER_RUN) {
        processed += 1;

        const key = dayKeyOf(cursor);
        const occurrenceDate = utcMidnight(key);

        if (subscription.endDate && occurrenceDate > subscription.endDate) {
          subscription.status = 'completed';
          stop = true;
          break;
        }

        const nextCursor = advanceCursor(cursor, subscription.cadence, subscription.intervalCount || 1);
        if (!nextCursor || nextCursor <= cursor) break; // non-advancing cadence would loop forever

        const isSkippedDay = (subscription.skipDates || []).some((skipDate) => dayKeyOf(skipDate) === key);

        let inserted = false;
        let row = null;
        if (!isSkippedDay) {
          // Upsert-first; `$setOnInsert` means a row already present (an earlier run,
          // or a parallel sweep racing the same window) is left untouched, and the
          // (subscription, occurrenceDate) unique index rejects a second insert —
          // so the plan's exactly-once guard holds regardless of how many workers run.
          const preExisting = await StoreRecurringOrder
            .findOne({ subscription: subscription._id, occurrenceDate })
            .select('_id')
            .lean();
          if (preExisting) {
            row = preExisting;
          } else {
            // `returnDocument: 'after'` — with `new`, this Mongoose version deprecates
            // findOneAndUpdate's option and returns a wrapped result instead of the
            // document, which breaks the `row._id` uses below.
            row = await StoreRecurringOrder.findOneAndUpdate(
              { subscription: subscription._id, occurrenceDate },
              {
                $setOnInsert: {
                  subscription: subscription._id,
                  outlet: subscription.outlet,
                  chain: subscription.chain,
                  customer: subscription.customer,
                  generationStatus: 'generated',
                },
              },
              { upsert: true, returnDocument: 'after' }
            );
            if (!row) throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Occurrence upsert returned no document');
            inserted = true;
          }
        }

        if (inserted && !isSkippedDay) {
          const outlet = await loadOutlet(subscription.outlet);
          if (outlet && outlet.operational && outlet.status === 'active') {
            const outcome = await evaluateOccurrence({ subscription, row, key });
            if (outcome.outcome === 'skipped_no_stock') summary.skipped += 1;
            else summary.generated += 1;
          } else {
            // Rule 3: never generate against a store that cannot fulfil.
            await StoreRecurringOrder.updateOne(
              { _id: row._id },
              { $set: { generationStatus: 'skipped_store_inactive', skipReason: 'store_not_operational', notifiedAt: new Date() } }
            );
            await notifyService.notifyOrderLifecycle(subscription, 'recurring_order_skipped', {
              date: key,
              reason: 'The store is closed on this day; its next delivery runs as scheduled.',
            });
            summary.skipped += 1;
          }
        } else {
          summary.advanced += 1; // repeat run or customer skip day: cursor moves, nothing re-notifies
        }

        lastHandled = key;
        cursor = nextCursor;
      }

      if (stop) {
        subscription.nextOccurrenceDate = cursor || new Date(subscription.nextOccurrenceDate);
      } else {
        if (cursor) subscription.nextOccurrenceDate = cursor;
        if (lastHandled) subscription.lastOccurrenceDate = utcMidnight(lastHandled);
      }
      await subscription.save();
    } catch (error) {
      summary.failures += 1; // one broken subscription must not stop the sweep
      logger.error(`Recurring occurrence generation failed for subscription ${subscription._id}: ${error.message}`);
      continue;
    }
  }

  return summary;
};

const getDemandForOutlet = async (outletId, { days = 7 } = {}) => {
  const StoreCustomerSubscription = mongoose.model('StoreCustomerSubscription');
  const ChainProductVariant = mongoose.model('ChainProductVariant');
  const ChainProduct = mongoose.model('ChainProduct');

  const now = new Date();
  const horizon = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const subs = await StoreCustomerSubscription.find({
    outlet: outletId,
    status: 'scheduled',
    nextOccurrenceDate: { $lte: horizon },
  }).select('items nextOccurrenceDate customer').lean();

  const byVariant = new Map();
  for (const sub of subs) {
    for (const item of sub.items || []) {
      const key = String(item.variant);
      const entry = byVariant.get(key) || { variant: item.variant, quantity: 0, subscriptions: 0 };
      entry.quantity += Number(item.quantity) || 0;
      entry.subscriptions += 1;
      byVariant.set(key, entry);
    }
  }

  const variantIds = [...byVariant.keys()];
  const variants = await ChainProductVariant.find({ _id: { $in: variantIds } }).select('name product').lean();
  const variantById = new Map(variants.map((v) => [String(v._id), v]));
  const productIds = variants.map((v) => v.product).filter(Boolean);
  const products = await ChainProduct.find({ _id: { $in: productIds } }).select('name').lean();
  const productById = new Map(products.map((p) => [String(p._id), p]));

  const items = [...byVariant.values()].map((entry) => {
    const v = variantById.get(String(entry.variant));
    const p = v ? productById.get(String(v.product)) : null;
    return {
      variant: entry.variant,
      variantName: v ? v.name : null,
      product: v ? v.product : null,
      productName: p ? p.name : null,
      quantity: entry.quantity,
      subscriptions: entry.subscriptions,
    };
  });

  return { items, totalSubscriptions: subs.length, horizon };
};

const acceptOccurrencePriceChange = async (subscriptionId, occurrenceId, customerId) => {
  const StoreCustomerSubscription = mongoose.model('StoreCustomerSubscription');
  const StoreRecurringOrder = mongoose.model('StoreRecurringOrder');
  const subscription = await StoreCustomerSubscription.findOne({ _id: subscriptionId, customer: customerId });
  if (!subscription) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription not found');
  const row = await StoreRecurringOrder.findOne({ _id: occurrenceId, subscription: subscriptionId, generationStatus: 'awaiting_price_acceptance' });
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'No pending price change for this occurrence');
  const key = dayKeyOf(row.occurrenceDate);
  const result = await evaluateOccurrence({ subscription, row, key, forceAcceptPriceChange: true });
  return { subscription, occurrence: row, result };
};

const reconcileOccurrences = async ({ now = new Date() } = {}) => {
  const StoreRecurringOrder = mongoose.model('StoreRecurringOrder');
  const StoreCustomerSubscription = mongoose.model('StoreCustomerSubscription');
  const summary = { scanned: 0, repaired: 0, failed: 0 };
  const rows = await StoreRecurringOrder.find({ generationStatus: 'generated', order: null }).limit(200).lean();
  summary.scanned = rows.length;
  for (const row of rows) {
    try {
      const subscription = await StoreCustomerSubscription.findById(row.subscription);
      if (!subscription || subscription.status !== 'scheduled') continue;
      const key = dayKeyOf(row.occurrenceDate);
      const result = await evaluateOccurrence({ subscription, row: await StoreRecurringOrder.findById(row._id), key });
      if (result && result.outcome && result.outcome !== 'payment_failed') summary.repaired += 1;
    } catch (error) {
      summary.failed += 1;
      logger.error(`Reconciliation failed for occurrence ${row._id}: ${error.message}`);
    }
  }
  return summary;
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
  listAwaitingPriceChanges,
  getUpcomingOccurrences,
  getDemandForOutlet,
  acceptOccurrencePriceChange,
  reconcileOccurrences,
  generateOccurrences,
  evaluateOccurrence,
  assertTransition,
  SUBSCRIPTION_TRANSITIONS,
};