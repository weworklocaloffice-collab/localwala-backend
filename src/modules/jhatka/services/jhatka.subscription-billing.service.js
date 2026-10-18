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
 * jhatka.subscription-billing.service.js — charging a PREPAID occurrence (§9.5).
 *
 * ## What was missing
 *
 * A subscription carries `prepaid: true` and `paymentMode: 'gateway'`. The nightly
 * generator creates a `JhatkaRecurringOrder` per due date and freezes a `chargeAmount`
 * on it — §9.5's CEILING for a weight line. And then nothing charges it. The only way
 * a prepaid occurrence could be paid was for the customer to open the app and tap a
 * pay button for a delivery they had already paid for in advance.
 *
 * That is not a gap in polish; it is the whole commercial model of a prepaid
 * subscription missing its engine.
 *
 * ## Why there is NO auto-charge mandate
 *
 * A true auto-charge needs a stored mandate, a mandate lifecycle (expiry, revocation,
 * per-bank support) and a dunning ladder. None of that exists in this platform, and
 * building a card vault is not a thing to do quietly inside a meat vertical.
 *
 * So v1 does what Real Estate does for property holds: the sweep creates the
 * `PaymentInitiation` and hands the customer a LINK. They pay when they can, from any
 * device, with the bank doing the heavy lifting. It is less automatic and it is
 * honest — an auto-charge that silently fails for three weeks because a mandate
 * expired is worse than a customer tapping a link.
 *
 * When the platform grows a mandate service, this file becomes the caller and
 * nothing else has to change: the amount, the deadline, the skip and the credit are
 * all already correct.
 *
 * ## The ladder, and why it ends in a credit rather than a debt
 *
 *   charge → reminder → SKIP + credit + count toward auto-pause
 *
 * §9.6 is explicit that a skip must never be silent and that `notify_and_pause` stops
 * a subscription from quietly skipping eight times. Three attempts is the minimum
 * that gives a customer whose phone was dead a second chance. The skip carries a
 * CREDIT (`creditAmount`, §9.6) rather than a debt, because the meat was never cut —
 * charging a customer for a kilo that was never weighed is precisely the thing §3.3
 * exists to prevent, applied in the other direction.
 */

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const notifyService = require('./jhatka.notify.service');
const reservationService = require('./jhatka.reservation.service');
const occurrenceService = require('./jhatka.occurrence.service');

/**
 * How long before the delivery date a prepaid occurrence is charged.
 *
 * Evening-before is deliberate: it is the point at which a customer is thinking about
 * tomorrow's curry, and it leaves a working day for a declined card to be retried.
 */
const DEFAULT_LEAD_MINUTES = 720; // 12 hours

/** Default time before delivery at which an unpaid occurrence is skipped. */
const DEFAULT_DEADLINE_MINUTES = 180; // 3 hours

/**
 * Is this occurrence one we are responsible for charging?
 *
 * Deliberately narrow. `prepaid` alone is not enough — a COD subscription has no
 * charge to make, and `chargeAmount` of zero means there is nothing to collect even
 * if it is marked prepaid (which is exactly what a fully-credited skip looks like).
 */
const isBillable = (occurrence) =>
  occurrence &&
  occurrence.billingStatus !== 'billed' &&
  occurrence.billingStatus !== 'unpaid_skipped' &&
  occurrence.billingStatus !== 'not_required' &&
  occurrence.paymentStatus !== 'paid' &&
  Number(occurrence.chargeAmount) > 0;

/**
 * Charge, remind, or give up on one occurrence.
 *
 * Split out from the sweep so the sweep can loop without the decision logic being
 * re-entered, and so this is callable directly from a test without booting cron.
 *
 * @returns {Promise<{action: string, occurrence: object, reason?: string}>}
 */
async function billOccurrence({
  models, occurrence, now = new Date(), leadMinutes, deadlineMinutes, actor, force = false,
}) {
  const { JhatkaSubscription, JhatkaRecurringOrder } = models;

  if (occurrence.paymentStatus === 'paid') return { action: 'already_paid', occurrence };
  if (!isBillable(occurrence)) return { action: 'not_billable', occurrence };

  const deliveryAt = new Date(occurrence.occurrenceDate);
  const deadline = occurrence.billingDeadlineAt
    ? new Date(occurrence.billingDeadlineAt)
    : new Date(deliveryAt.getTime() - (deadlineMinutes ?? DEFAULT_DEADLINE_MINUTES) * 60000);

  // ---- GIVE UP -------------------------------------------------------------
  //
  // Past the deadline and still unpaid. §9.6: skip, credit, and count it toward the
  // auto-pause threshold. It is NOT a cancellation of the whole subscription here —
  // that is `occurrence.service`'s job, and it owns the consecutive-failure counter.
  if (now >= deadline) {
    occurrence.billingStatus = 'unpaid_skipped';
    occurrence.generationStatus = 'skipped_no_stock';
    occurrence.skipReason = 'payment_failed';
    occurrence.skipNote = `Prepaid — payment not received by the ${DEFAULT_DEADLINE_MINUTES}-minute cutoff`;
    occurrence.stockReserved = false;
    // §9.6 step 6. The meat was never cut, so this is a CREDIT the customer carries
    // forward or recovers on cancellation. Never a charge.
    occurrence.creditAmount = occurrence.chargeAmount;
    occurrence.creditedAt = now;
    await occurrence.save();

    // Release the reservation so the stock sells again.
    //
    // All THREE models are required, not just `JhatkaInventoryItem`:
    // `releaseOccurrenceStock` reads the `RESERVATION` allocations and then writes both
    // a ledger movement and a mirrored allocation row. Passing only the inventory item
    // throws inside it — and because the occurrence is saved before this call, the
    // failure leaves a correctly-skipped occurrence with its stock still held. That is
    // the worst shape this code could fail in: a skip that looks complete and silently
    // strands perishable stock.
    //
    // The outlet is resolved as a DOCUMENT, not the raw ref. `releaseOccurrenceStock`
    // reads `outlet.business` when mirroring the allocation, and `occurrence.outlet` is
    // an ObjectId — so passing it directly yields `business: undefined` on a row that
    // wants one.
    const outletDoc = models.JhatkaOutlet
      ? await models.JhatkaOutlet.findById(occurrence.outlet).lean()
      : null;

    await reservationService.releaseOccurrenceStock({
      occurrence,
      outlet: outletDoc || occurrence.outlet,
      models: {
        JhatkaInventoryItem: models.JhatkaInventoryItem,
        JhatkaBatchAllocation: models.JhatkaBatchAllocation,
        JhatkaInventoryMovement: models.JhatkaInventoryMovement,
      },
      actor: actor || { _id: null, name: 'jhatka.billing' },
      reason: 'Prepaid occurrence was never paid; the stock is returned to sale.',
    });

    const subscription = await JhatkaSubscription.findById(occurrence.subscription);
    if (subscription) {
      await occurrenceService.notifyStockFailure({
        sub: subscription,
        occurrence,
        shortfalls: (occurrence.items || []).map((i) => ({ sku: i.sku })),
        autoPaused: false,
        consecutiveFailures: subscription.stats?.consecutiveStockFailures || 0,
        occurrenceDate: deliveryAt,
      });
      // The customer's own record, so "why did my subscription skip" is answerable
      // from the subscription rather than only from the occurrence.
      await models.JhatkaSubscriptionEvent.create({
        subscription: subscription._id,
        customer: subscription.customer,
        outlet: subscription.outlet,
        type: 'stock_failure_skipped',
        actorType: 'cron',
        at: now,
        reason: `Prepaid occurrence not paid by the cutoff; ${DEFAULT_DEADLINE_MINUTES} minutes before delivery`,
        recurringOrder: occurrence._id,
      });
    }

    return { action: 'skipped_unpaid', occurrence, reason: 'deadline_passed' };
  }

  // ---- REMIND --------------------------------------------------------------
  //
  // Once, the evening before. A reminder that fires every sweep until the deadline
  // is a notification storm; `billingReminderAt` is the guard.
  const chargedAlready = occurrence.billingStatus === 'pending' && occurrence.billingAttemptedAt;
  const isEveningBefore =
    chargedAlready && !occurrence.billingReminderAt && now >= new Date(deliveryAt.getTime() - 12 * 3600000);

  if (isEveningBefore) {
    occurrence.billingReminderAt = now;
    occurrence.billingAttempts = (occurrence.billingAttempts || 0) + 1;
    await occurrence.save();

    const subscription = await JhatkaSubscription.findById(occurrence.subscription);
    await notifyService.notifyCustomer(
      subscription?.customer || occurrence.customer,
      'subscription_payment_reminder',
      {
        deliveryDate: deliveryAt.toDateString(),
        itemSummary: (occurrence.items || []).map((i) => i.sku).filter(Boolean),
        amount: occurrence.chargeAmount,
        payRef: occurrence.billingPaymentRef ? String(occurrence.billingPaymentRef) : '',
      }
    );

    return { action: 'reminded', occurrence };
  }

  // ---- FIRST CHARGE --------------------------------------------------------
  const deliveryLead = new Date(deliveryAt.getTime() - (leadMinutes ?? DEFAULT_LEAD_MINUTES) * 60000);
  if (!force && now < deliveryLead) {
    return { action: 'too_early', occurrence };
  }

  if (chargedAlready) {
    // Already asked once and still inside the window. Do NOT mint a second
    // initiation: two live gateway orders for one occurrence is a double charge the
    // customer has to unpick, and the refund path for it is §3.6's awkward one.
    return { action: 'awaiting_payment', occurrence };
  }

  const subscription = await JhatkaSubscription.findById(occurrence.subscription);
  if (!subscription) {
    return { action: 'no_subscription', occurrence, reason: 'subscription missing' };
  }

  // A prepaid subscription is, by definition, a gateway one. If it is not, that is a
  // data problem worth shouting about rather than silently billing a COD order.
  if (subscription.paymentMode !== 'gateway') {
    console.error(
      `[jhatka.billing] subscription ${subscription._id} is prepaid but paymentMode='${subscription.paymentMode}'; not charging`
    );
    occurrence.billingStatus = 'not_required';
    await occurrence.save();
    return { action: 'not_gateway', occurrence };
  }

  const config = await pickPaymentConfig(models, subscription);
  if (!config) {
    return { action: 'no_gateway', occurrence, reason: 'no active PaymentConfig' };
  }

  let initiation;
  try {
    initiation = await initiateOccurrenceCharge({ models, occurrence, subscription, config });
  } catch (error) {
    console.error(`[jhatka.billing] could not start a charge for ${occurrence._id}: ${error.message}`);
    return { action: 'initiation_failed', occurrence, reason: error.message };
  }

  occurrence.billingStatus = 'pending';
  occurrence.billingAttemptedAt = now;
  occurrence.billingAttempts = (occurrence.billingAttempts || 0) + 1;
  occurrence.billingPaymentRef = initiation._id;
  occurrence.billingDeadlineAt = deadline;
  await occurrence.save();

  await notifyService.notifyCustomer(subscription.customer, 'subscription_payment_due', {
    deliveryDate: deliveryAt.toDateString(),
    itemSummary: (occurrence.items || []).map((i) => i.sku).filter(Boolean),
    amount: occurrence.chargeAmount,
    payRef: String(initiation._id),
  });

  return { action: 'charged', occurrence, initiationId: String(initiation._id) };
}

/**
 * Create the `PaymentInitiation` for one occurrence.
 *
 * The amount is `occurrence.chargeAmount` — §9.5's ceiling, frozen at generation — and
 * never recomputed. A getter result is rupees; `PaymentInitiation.amount` has a setter
 * that takes rupees and stores paise, so this direction is the correct one. Writing raw
 * paise here would inflate the charge 100x, which is the single most expensive mistake
 * available in this file.
 */
async function initiateOccurrenceCharge({ models, occurrence, subscription, config }) {
  const { PaymentInitiation } = models;

  const open = await PaymentInitiation.findOne({
    jhatkaOccurrence: occurrence._id,
    paymentFrom: 'jhatka_subscription',
    status: 'initiated',
  }).sort({ createdAt: -1 });

  if (open) return open;

  return PaymentInitiation.create({
    user: subscription.customer,
    payment: config._id,
    jhatkaOccurrence: occurrence._id,
    jhatkaSubscription: subscription._id,
    amount: occurrence.chargeAmount,
    paymentRef: `JHATKA-SUB-${String(occurrence._id).slice(-8).toUpperCase()}`,
    paymentFrom: 'jhatka_subscription',
  });
}

/**
 * Which gateway to charge through.
 *
 * Prefers the subscription's stored choice, falls back to the platform default. Never
 * invents one — a subscription with no reachable gateway must stay unbilled and
 * visible, not be billed through whatever happens to be configured.
 */
async function pickPaymentConfig(models, subscription) {
  const { PaymentConfig } = models;
  // `JhatkaSubscription` has no `paymentConfig` field — a subscriber picks their
  // gateway at the app, not on the record — so this always resolves to the platform
  // default. The lookup is kept anyway so the day that field lands nothing else here
  // has to change, and an explicit per-subscriber gateway would take precedence over
  // the platform default without anyone touching this function.
  if (subscription.paymentConfig) {
    const chosen = await PaymentConfig.findById(subscription.paymentConfig).lean();
    if (chosen && chosen.status !== false) return chosen;
  }
  return PaymentConfig.findOne({ status: true, isDefault: true }).lean()
    || PaymentConfig.findOne({ status: true }).lean();
}

/**
 * The nightly sweep.
 *
 * @returns {Promise<{scanned: number, charged: number, reminded: number, skipped: number,
 *                    tooEarly: number, failures: Array}>}
 */
async function billDueOccurrences({ models, now = new Date(), leadMinutes, deadlineMinutes, actor }) {
  const { JhatkaRecurringOrder } = models;

  const windowStart = new Date(now.getTime() - 2 * 86400000);
  const windowEnd = new Date(now.getTime() + 2 * 86400000);

  const candidates = await JhatkaRecurringOrder.find({
    occurrenceDate: { $gte: windowStart, $lte: windowEnd },
    paymentStatus: { $ne: 'paid' },
    billingStatus: { $in: ['pending', undefined, null] },
    chargeAmount: { $gt: 0 },
  })
    .select('_id subscription outlet customer occurrenceDate chargeAmount billingStatus billingAttemptedAt billingReminderAt billingDeadlineAt paymentStatus items order')
    .lean();

  const summary = {
    scanned: candidates.length, charged: 0, reminded: 0,
    skipped: 0, tooEarly: 0, awaiting: 0, failures: [],
  };

  for (const row of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await billOccurrence({
        models,
        occurrence: await JhatkaRecurringOrder.findById(row._id),
        now,
        leadMinutes,
        deadlineMinutes,
        actor,
      });

      if (result.action === 'charged') summary.charged += 1;
      else if (result.action === 'reminded') summary.reminded += 1;
      else if (result.action === 'skipped_unpaid') summary.skipped += 1;
      else if (result.action === 'awaiting_payment') summary.awaiting += 1;
      else if (result.action === 'too_early') summary.tooEarly += 1;
    } catch (error) {
      summary.failures.push({ occurrence: String(row._id), message: error.message });
    }
  }

  return summary;
}

/**
 * Manual retry for one occurrence. Used by the partner route when a customer says they
 * have paid and the gateway has not called back.
 *
 * ## `force` is set, deliberately
 *
 * A retry exists because the automatic schedule FAILED — the customer paid, the
 * webhook was lost, or the first charge hit a gateway outage. Honouring the 12-hour
 * lead here would refuse the retry precisely when it is most needed: the earlier a
 * customer is told their delivery is ready, the more likely the automatic charge fired
 * while the gateway was broken.
 *
 * Setting `leadMinutes: 0` is NOT enough, and that is the version this file shipped
 * first. With a zero lead the deadline moves to the delivery instant itself, so an
 * occurrence dated tomorrow is still "too early" — the lead check compares against
 * the DELIVERY date, not against now-minus-lead. Only an explicit `force` skips it.
 *
 * The deadline is NOT bypassed. An operator cannot resurrect an occurrence whose meat
 * was never cut; by that point the amount is a credit, not a charge.
 */
async function retryOccurrence({ models, occurrenceId, actor }) {
  const { JhatkaRecurringOrder } = models;
  const occurrence = await JhatkaRecurringOrder.findById(occurrenceId);
  if (!occurrence) throw new ApiError(httpStatus.NOT_FOUND, 'Occurrence not found');
  if (occurrence.paymentStatus === 'paid') {
    throw new ApiError(httpStatus.CONFLICT, 'OCCURRENCE_ALREADY_PAID');
  }
  if (occurrence.billingStatus === 'unpaid_skipped') {
    throw new ApiError(
      httpStatus.CONFLICT,
      'OCCURRENCE_ALREADY_SKIPPED: the delivery date passed without payment; the amount is now a credit'
    );
  }

  // Clear the attempt markers so `billOccurrence` treats this as a first charge
  // again. The old initiation is NOT reused: its gateway order may have expired, and a
  // stale order re-charged is how a customer gets billed twice for one delivery.
  occurrence.billingAttemptedAt = undefined;
  occurrence.billingReminderAt = undefined;
  occurrence.billingStatus = 'pending';
  await occurrence.save();

  if (models.PaymentInitiation) {
    await models.PaymentInitiation.updateMany(
      { jhatkaOccurrence: occurrence._id, status: 'initiated' },
      { $set: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: actor || null } }
    );
  }

  // `force: true` — see the note above. The deadline is still enforced.
  return billOccurrence({
    models,
    occurrence,
    actor,
    now: new Date(),
    force: true,
  });
}

module.exports = {
  billDueOccurrences,
  billOccurrence,
  retryOccurrence,
  isBillable,
  DEFAULT_LEAD_MINUTES,
  DEFAULT_DEADLINE_MINUTES,
};