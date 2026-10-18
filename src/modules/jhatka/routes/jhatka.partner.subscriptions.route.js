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
 * jhatka.partner.subscriptions.route.js — subscription management. -9, -15.2.
 *
 * ## A subscription is NOT a discount contract, and this file is where that shows
 *
 * OD-07 resolved to **option A**: a variable-weight line on a subscription is sold
 * at a CEILING — "1 kg, up to 10% over" — and the customer is charged the ceiling
 * once. Option C (a fixed price band) was rejected as a commercial change for
 * Phase 12, and option B (monthly reconciliation) was rejected outright: a monthly
 * refund on a food subscription is a support burden nobody should create.
 *
 * That is what `chargeMode: 'ceiling'` means on `JhatkaSubscription.items[]` and on
 * `JhatkaRecurringOrder.items[]`, and it is why a subscription order carries
 * `lineCharge` (what to charge) SEPARATE from `estimatedAmount` (what the meat was
 * worth). Conflating them turns a weekly chicken delivery into a variable bill.
 *
 * ## One occurrence per subscription per date — enforced by the DATABASE
 *
 * Phase 9's DoD: "Two runs of the generator on the same day produce one
 * occurrence." `JhatkaRecurringOrder` has a UNIQUE index on
 * `{ subscription, occurrenceDate }`, and `Math.floor` normalises the date so
 * `09:00` and `23:59` are the same day rather than two.
 *
 * This route relies on that index rather than a find-then-insert, because a
 * find-then-insert loses the race under two concurrent cron ticks — and a duplicate
 * occurrence means the customer is charged twice for one week.
 *
 * ## Eggs are not subscribable
 *
 * `subscriptionEligible: false` on all egg variants (plan -9 note 1: "nobody
 * subscribes to eggs; they buy a tray"). Creating a subscription containing one is
 * refused at creation, not silently filtered, because a customer who was shown a
 * subscribe button and then quietly loses it from the cart has been misled.
 */

const express = require('express');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const { jhatkaAuth, requireActiveOutlet } = require('../middlewares/jhatka.tenant');
const profileService = require('../services/jhatka.profile.service');
const {
  JhatkaSubscription,
  JhatkaSubscriptionEvent,
  JhatkaRecurringOrder,
  JhatkaOutlet,
  JhatkaProduct,
  JhatkaVariant,
  JhatkaInventoryItem,
  JhatkaInventoryMovement,
  JhatkaBatchAllocation,
  PaymentInitiation,
  PaymentConfig,
} = require('../../../models');
const subscriptionService = require('../services/jhatka.subscription.service');
const { validateSubscriptionItems } = require('../utils/jhatka.validator');
const validate = require('../../../middlewares/validate');
const V = require('../validations/jhatka.partner.subscriptions.validation');
// Occurrence generation, shared with the 03:00 cron.
const occurrenceService = require('../services/jhatka.occurrence.service');
const subscriptionLifecycle = require('../services/jhatka.subscription-lifecycle.service');
const billingService = require('../services/jhatka.subscription-billing.service');

const router = express.Router();

const subAuth = [jhatkaAuth(), requireActiveOutlet];

const cap = (capability) => async (req, res, next) => {
  try {
    profileService.assertCan(req.role, capability);
    return next();
  } catch (error) {
    return next(error);
  }
};

const nextNumber = (prefix) => {
  const now = new Date();
  const stamp =
    String(now.getFullYear()).slice(2) +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  return `${prefix}${stamp}${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
};

/**
 * Midnight UTC on the given date.
 *
 * NOT optional. `{subscription, occurrenceDate}` is unique, so an occurrence saved
 * at 09:00 and another at 23:59 on the same day are DIFFERENT documents to Mongo —
 * and the customer's week would be charged twice.
 */
/**
 * Midnight of the day containing `d`, in LOCAL time.
 *
 * Deliberately `setHours(0,0,0,0)` and not `Date.UTC(...)`: `JhatkaRecurringOrder`
 * validates `occurrenceDate` with `new Date(v).getHours() === 0`, which is LOCAL
 * hours. `Date.UTC` midnight is 05:30 in IST, so in any timezone east of UTC this
 * produced dates that failed their own validator and no subscription ever generated.
 * Both sides of the unique index must agree, and local midnight is what a shop means
 * by "today".
 */
const dayKey = (d) => {
  const date = new Date(d);
  const out = new Date(date);
  out.setHours(0, 0, 0, 0);
  return out;
};

/**
 * The next occurrence date for a subscription.
 *
 * `alternate_days` uses `intervalCount` as the step in DAYS from the last
 * occurrence, so a fortnightly plan with intervalCount 14 lands on a fortnight —
 * counting from the start date would drift onto a different weekday after the first
 * month, which is the classic bug in fortnightly delivery.
 */
const nextOccurrence = (sub, from) => {
  const base = new Date(from || sub.lastOccurrenceDate || sub.startDate);
  switch (sub.scheduleType) {
    case 'daily':
      base.setUTCDate(base.getUTCDate() + 1);
      break;
    case 'alternate_days':
      base.setUTCDate(base.getUTCDate() + Math.max(2, sub.intervalCount || 2));
      break;
    case 'weekly':
      base.setUTCDate(base.getUTCDate() + 7);
      break;
    case 'custom_days': {
      const days = (sub.customDays || []).slice().sort((a, b) => a - b);
      if (!days.length) return null;
      const current = base.getUTCDay();
      const next = days.find((d) => d > current);
      base.setUTCDate(base.getUTCDate() + (next === undefined ? days[0] + 7 - current : next - current));
      break;
    }
    default:
      return null;
  }
  if (sub.endDate && base > new Date(sub.endDate)) return null;
  return dayKey(base);
};

/** Load a subscription belonging to THIS outlet. */
const loadOwnSub = async (id, outletId) => {
  const sub = await JhatkaSubscription.findOne({ _id: id, outlet: outletId });
  if (!sub) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription not found for this outlet');
  return sub;
};

/** Write an event. The 20-value `type` enum is the audit trail; never skip it. */
const recordEvent = async (sub, { type, actorType, actor, actorName, reason, note, toValue, fromValue, recurringOrder }) => {
  return JhatkaSubscriptionEvent.create({
    subscription: sub._id,
    customer: sub.customer,
    outlet: sub.outlet,
    type,
    actorType,
    actor,
    actorName,
    reason,
    note,
    fromValue,
    toValue,
    recurringOrder,
    at: new Date(),
  });
};
/**
 * GET /jhatka/partner/subscriptions
 *
 * Filter by status, customer, or the `autoPauseCandidates` view — subscriptions with
 * consecutive stock failures, which §9's DoD requires to auto-pause and which an
 * outlet needs to see BEFORE it happens.
 *
 * Filter, query and projection live in the service; this handler keeps auth,
 * tenancy and the envelope.
 */
router.get('/', ...subAuth, cap('subscriptions.read'), async (req, res, next) => {
  try {
    return res.json(await subscriptionLifecycle.listSubscriptions({
      models: { JhatkaSubscription },
      outletId: req.outletId,
      query: req.query,
    }));
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/partner/subscriptions
 *
 * Create a subscription on behalf of a customer.
 *
 * Refuses a COUNT variant that is not `subscriptionEligible`, and refuses an egg or
 * prawn tier outright, with the reason in the error — a customer shown a subscribe
 * control and then refused needs to be told why, not silently dropped.
 */
router.post('/', ...subAuth, cap('subscriptions.manage'), validate(V.subscriptionCreateBody), async (req, res, next) => {
  try {
    const outlet = await JhatkaOutlet.findById(req.outletId).lean();
    if (!outlet) throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');

    // The construction rules — the egg rule, the OD-07 ceiling, and the paise/rupee
    // boundary on both money fields — live in the service because the CUSTOMER surface
    // creates subscriptions too. Duplicating them here would have produced a second
    // copy of the two 100x bugs that were fixed in this block minutes ago.
    const sub = await subscriptionService.createSubscription({
      body: req.body,
      customer: req.body.customer,
      outlet,
      models: { JhatkaVariant, JhatkaProduct, JhatkaSubscription },
      nextNumber,
      dayKey,
      recordEvent,
      actor: { _id: req.user._id, name: req.user.name, type: 'admin' },
    });

    return res.status(httpStatus.CREATED).json({
      subscription: {
        id: String(sub._id),
        subscriptionNo: sub.subscriptionNo,
        status: sub.status,
        scheduleType: sub.scheduleType,
        nextOccurrenceDate: sub.nextOccurrenceDate,
        estimatedAmountPerOccurrence: sub.estimatedAmountPerOccurrence,
        items: sub.items,
        pricingBasis:
          'ceiling — a variable-weight line is charged at estimate plus the ceiling percentage, once',
      },
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /jhatka/partner/subscriptions/:subscription
 *
 * Detail with the event trail and the next few occurrences.
 */
router.get('/:subscription', ...subAuth, cap('subscriptions.read'), validate(V.subscriptionParam), async (req, res, next) => {
  try {
    const sub = await JhatkaSubscription.findById(req.params.subscription)
      .populate('customer', 'name phone email')
      .lean();
    if (!sub) throw new ApiError(httpStatus.NOT_FOUND, 'Subscription not found');
    if (String(sub.outlet) !== req.outletId) {
      throw new ApiError(httpStatus.FORBIDDEN, 'Subscription not in this outlet');
    }

    return res.json(await subscriptionLifecycle.subscriptionDetail({
      models: { JhatkaSubscriptionEvent, JhatkaRecurringOrder },
      sub,
    }));
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/partner/subscriptions/:subscription/pause
 */
router.post('/:subscription/pause', ...subAuth, cap('subscriptions.manage'), validate(V.subscriptionParam), validate(V.pauseBody), async (req, res, next) => {
  try {
    const sub = await loadOwnSub(req.params.subscription, req.outletId);
    return res.json(await subscriptionLifecycle.pauseSubscription({
      sub,
      body: req.body || {},
      actor: { _id: req.user._id, name: req.user.name },
      recordEvent,
    }));
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/partner/subscriptions/:subscription/resume
 */
router.post('/:subscription/resume', ...subAuth, cap('subscriptions.manage'), validate(V.subscriptionParam), async (req, res, next) => {
  try {
    const sub = await loadOwnSub(req.params.subscription, req.outletId);
    return res.json(await subscriptionLifecycle.resumeSubscription({
      sub,
      actor: { _id: req.user._id, name: req.user.name },
      recordEvent,
      nextOccurrenceFn: nextOccurrence,
    }));
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/partner/subscriptions/:subscription/cancel
 *
 * Cancels the subscription. Occurrences already generated are NOT deleted — they are
 * real charges or real skips and the customer has to see them.
 */
router.post('/:subscription/cancel', ...subAuth, cap('subscriptions.manage'), validate(V.subscriptionParam), validate(V.cancelBody), async (req, res, next) => {
  try {
    const sub = await loadOwnSub(req.params.subscription, req.outletId);
    return res.json(await subscriptionLifecycle.cancelSubscription({
      models: { JhatkaRecurringOrder },
      sub,
      body: req.body || {},
      actor: { _id: req.user._id, name: req.user.name },
      recordEvent,
    }));
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/partner/subscriptions/:subscription/items
 *
 * Change the standing items. `editCutoffHours` is enforced: a customer who edited
 * their order an hour before delivery must not have a third kilo silently added.
 */
router.post('/:subscription/items', ...subAuth, cap('subscriptions.manage'), validate(V.subscriptionParam), validate(V.itemsBody), async (req, res, next) => {
  try {
    validateSubscriptionItems(req.body);

    const sub = await loadOwnSub(req.params.subscription, req.outletId);
    const result = await subscriptionService.updateSubscriptionItems({
      sub,
      body: req.body,
      models: { JhatkaVariant },
      user: req.user,
      recordEvent,
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/partner/subscriptions/:subscription/skip
 *
 * Skip the NEXT occurrence only. Not a pause: a pause is a state, a skip is one
 * date, and conflating them is how a customer who misses a week ends up cancelled.
 */
router.post('/:subscription/skip', ...subAuth, cap('subscriptions.manage'), validate(V.subscriptionParam), validate(V.skipBody), async (req, res, next) => {
  try {
    const sub = await loadOwnSub(req.params.subscription, req.outletId);
    const result = await subscriptionLifecycle.skipNextOccurrence({
      models: { JhatkaRecurringOrder },
      sub,
      body: req.body || {},
      actor: { _id: req.user._id, name: req.user.name },
      recordEvent,
      dayKeyFn: dayKey,
      nextOccurrenceFn: nextOccurrence,
      notifyStockFailure: occurrenceService.notifyStockFailure,
    });
    return res.status(httpStatus.CREATED).json(result);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/partner/subscriptions/occurrences/:occurrence/generate
 *
 * Generate the next occurrence into a real order. §9's DoD: two runs on the same day
 * produce ONE occurrence, guaranteed by the unique index rather than by a
 * find-then-insert that would lose the race.
 *
 * Stock failure is a FIRST-CLASS outcome: the occurrence is written with
 * `skipped_no_stock`, the customer is recorded as notified, and the failure is
 * counted. It never silently vanishes, and `stockFailurePolicy` decides whether the
 * subscription pauses after three consecutive failures.
 */
router.post('/occurrences/:occurrence/generate', ...subAuth, cap('subscriptions.manage'), validate(V.occurrenceParam), validate(V.generateBody), async (req, res, next) => {
  try {
    const sub = await loadOwnSub(req.params.occurrence, req.outletId);
    const occurrenceDate = dayKey(req.body?.occurrenceDate || sub.nextOccurrenceDate);

    // The rules live in the service because the 03:00 generator applies the SAME ones,
    // and the two had drifted: this route's stock check was an unordered findOne that
    // could report 'no stock' while sellable stock sat on the shelf, and its money
    // boundary fed a hydrated RUPEES getter into a PAISE helper (a 100x under-charge).
    const result = await occurrenceService.generateOccurrence({
      models: {
        JhatkaRecurringOrder,
        JhatkaInventoryItem,
        JhatkaInventoryMovement,
        JhatkaBatchAllocation,
        JhatkaOutlet,
        JhatkaSubscription,
      },
      sub,
      occurrenceDate,
      outletId: req.outletId,
      actor: { _id: req.user._id, name: req.user.name },
      recordEvent,
      nextOccurrenceFn: nextOccurrence,
      dayKeyFn: dayKey,
    });

    return res.status(result.status).json(result.body);
  } catch (error) {
    // A duplicate-key error here is the unique index doing its job — two cron ticks
    // raced and exactly one occurrence exists. Reported as a success-with-replay
    // rather than a 500, because that is what actually happened.
    if (error && error.code === 11000) {
      const existing = await occurrenceService.findExistingOccurrence(
        { JhatkaRecurringOrder },
        req.params.occurrence,
        dayKey(req.body?.occurrenceDate)
      );
      return res.json({
        occurrence: existing
          ? {
              id: String(existing._id),
              occurrenceDate: existing.occurrenceDate,
              generationStatus: existing.generationStatus,
            }
          : null,
        idempotent: true,
        note: 'A concurrent run created this occurrence first; nothing was duplicated.',
      });
    }
    return next(error);
  }
});

/**
 * POST /jhatka/partner/subscriptions/occurrences/:occurrence/retry-billing
 *
 * Start a fresh charge for a prepaid occurrence whose payment never arrived.
 *
 * ## Why the outlet can trigger this
 *
 * The common real-world case is a customer who says "I have paid" while the gateway
 * webhook is lost, retries, or was never configured. Without this route the outlet's
 * only options are to wait for the 3-hour deadline (and the customer loses the
 * delivery) or cancel the subscription outright.
 *
 * ## What it does NOT do
 *
 * It does not mark the occurrence paid. Only a verified gateway callback does that —
 * an operator clicking a button is not evidence that money arrived, and an endpoint
 * that let it would make `paymentStatus` meaningless. What it does is clear the
 * attempt markers and mint a NEW initiation; the customer still has to actually pay.
 *
 * The previous initiation is cancelled rather than reused: a gateway order that has
 * been open for hours may be expired at the provider, and re-charging a stale gateway
 * order is how one delivery gets billed twice.
 */
router.post('/occurrences/:occurrence/retry-billing', ...subAuth, cap('subscriptions.manage'), validate(V.occurrenceParam), async (req, res, next) => {
  try {
    const sub = await loadOwnSub(req.params.occurrence, req.outletId);

    const result = await billingService.retryOccurrence({
      models: {
        JhatkaRecurringOrder,
        JhatkaInventoryItem,
        JhatkaSubscription,
        JhatkaSubscriptionEvent,
        PaymentInitiation,
        PaymentConfig,
      },
      occurrenceId: req.params.occurrence,
      actor: { _id: req.user._id, name: req.user.name },
    });

    return res.status(httpStatus.OK).json({
      occurrence: {
        id: String(result.occurrence._id),
        action: result.action,
        billingStatus: result.occurrence.billingStatus,
        billingAttempts: result.occurrence.billingAttempts,
        chargeAmount: result.occurrence.chargeAmount,
        initiationId: result.initiationId || null,
      },
      note:
        result.action === 'charged'
          ? 'A fresh charge was started and the customer has been notified. It is not paid until the gateway confirms.'
          : 'Nothing to retry (' + result.action + ').',
      subscriptionId: String(sub._id),
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
module.exports.dayKey = dayKey;
module.exports.nextOccurrence = nextOccurrence;
