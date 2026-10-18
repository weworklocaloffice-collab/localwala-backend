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
 * jhatka/cron.js — the vertical's scheduled work. §16.0.
 *
 * ## Why this file is self-contained
 *
 * `cron.job.scheduler.service.js` has a `finally` that stops every task, DELETES
 * every `CronJobScheduler` row and re-registers the scheduler. A Jhatka job that
 * throws once therefore tears down and rebuilds the dairy manifest job on its way
 * past. So this follows the stores pattern: its own `node-cron`, its own
 * `startJhatkaCron`, one `require` in `src/index.js`, gated on
 * `config.env !== 'test'`.
 *
 * ## THIS FILE WAS BROKEN, SILENTLY
 *
 * It was written from the blueprint rather than from the models, and queried fields
 * that do not exist:
 *
 *   it queried                        reality
 *   ────────────────────────────────  ────────────────────────────────────────
 *   JhatkaSubscription.nextDeliveryDate  nextOccurrenceDate
 *   sub.outlets[0]                      sub.outlet  (ONE ref, not an array)
 *   JhatkaRecurringOrder.scheduledFor   occurrenceDate
 *   JhatkaOrder.status                  lifecycle
 *   order.finalTotalPaise               finalTotal
 *   JhatkaSettlement.totalRevenuePaise  totals.grossOrderValue
 *   JhatkaPromotion.validUntil          endAt
 *   JhatkaVarianceFlag.status           action
 *
 * The subscription job is the dangerous one: its query is on a field that does not
 * exist, so it matched NOTHING, returned an empty list, logged "complete", and
 * generated no occurrences — every night, with no error and no alert. A cron job
 * that cannot fail is worse than no job, because it looks healthy.
 *
 * `count.jhatka.drift.js` catches this class; it originally scanned only `routes/`
 * and reported 11/11 clean while this file was broken.
 *
 * ## Idempotency comes from the database, not from a check
 *
 * The subscription generator relies on the UNIQUE index on
 * `JhatkaRecurringOrder { subscription, occurrenceDate }` and catches E11000. A
 * find-then-insert loses a race between two ticks, and a duplicate occurrence
 * charges the customer twice for one week.
 */

const cron = require('node-cron');
const { dayKey, nextOccurrence } = require('./routes/jhatka.partner.subscriptions.route');
const { asMoney, toPaiseAmount } = require('./utils/money');
const settlementService = require('./services/jhatka.settlement.service');
const payoutService = require('./services/jhatka.payout.service');
const { processRefundQueue } = require('./services/jhatka.refund.settlement');
const reservationService = require('./services/jhatka.reservation.service');
const expiryService = require('./services/jhatka.expiry.service');
const occurrenceService = require('./services/jhatka.occurrence.service');
const paymentService = require('./services/jhatka.payment.service');
const billingService = require('./services/jhatka.subscription-billing.service');
const completionService = require('./services/jhatka.completion.service');
const commercialArithmetic = require('./utils/commercial.arithmetic');
const notifyService = require('./services/jhatka.notify.service');

/**
 * Start all Jhatka cron jobs.
 *
 * @param {object} opts - { mongoose, models }
 * @returns {object} map of job names to cron.Job instances (for testing/stopping)
 */
function startJhatkaCron({ mongoose: _mongoose, models }) {
  const {
    JhatkaOrder,
    JhatkaOutlet,
    JhatkaWastage,
    JhatkaSettlement,
    JhatkaCompliance,
    JhatkaBatch,
    JhatkaOperatorPayout,
    JhatkaSupplierPayable,
    JhatkaPromotion,
    JhatkaOutletVarianceFlag,
  } = models;

  // `JhatkaSubscription`, `JhatkaRecurringOrder`, `JhatkaSubscriptionEvent` and
  // `JhatkaInventoryItem` are destructured INSIDE `generateRecurringOrders(models)`,
  // not here, because that function is exported and takes `models` as an argument so
  // a test can call it without booting eight cron jobs.

  const jobs = {};

  const num = (prefix) => {
    const now = new Date();
    const stamp =
      String(now.getFullYear()).slice(2) +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0');
    return `${prefix}${stamp}${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
  };

  /** Yesterday, midnight UTC. */
  const yesterdayWindow = () => {
    const now = new Date();
    const from = dayKey(new Date(now.getTime() - 86400000));
    const to = dayKey(now);
    return { from, to };
  };

  // =========================================================================
  // Every 30 min — close gateway orders whose payment was never finished
  // =========================================================================
  //
  // §16 of the lifecycle table, and the reason `PAYMENT_FAILED` had no writer at all:
  // `PaymentInitiation.status` is only ever written `paid`, so an order abandoned at
  // the payment screen stayed `PAYMENT_PENDING` forever with no route out of it. The
  // customer could not cancel it (cancellation is refused from `PAYMENT_PENDING`
  // without an explicit path) and the outlet could not accept it.
  //
  // HALF-HOURLY, not daily, and deliberately not on the hour. The default window is 20
  // minutes, so an hourly sweep would let a stock order sit abandoned for up to 80
  // minutes — and this is fresh meat, where the cost of a held order is the order.
  //
  // Every other job in this file is on the hour because they are nightly reconciliations
  // and the exact minute does not matter. This one is a queue drain, so it is not one.
  jobs.paymentTimeoutSweep = cron.schedule('*/30 * * * *', async () => {
    try {
      const result = await paymentService.sweepAbandonedPayments({
        models,
        actor: { _id: null, name: 'jhatka.cron' },
      });

      if (result.cancelled > 0 || result.failures.length > 0) {
        console.log(
          `[jhatka.cron] payment sweep: scanned=${result.scanned} cancelled=${result.cancelled} failed=${result.failures.length}`
        );
        // A failure here is one order stuck in PAYMENT_PENDING. Worth a line of its
        // own, because the sweep will retry it next run and nobody else will look.
        result.failures.forEach((f) =>
          console.error(`[jhatka.cron] payment sweep could not close ${f.order}: ${f.message}`)
        );
      }
    } catch (error) {
      // Swallowed deliberately. This cron file is self-contained and a throw here
      // would take the recurring-order generator down with it — the exact failure
      // §16.0 exists to prevent. A failed sweep is retried in 30 minutes.
      console.error('[jhatka.cron] payment sweep failed:', error.message);
    }
  });

  // =========================================================================
  // 05:30 — charge PREPAID subscription occurrences (§9.5)
  // =========================================================================
  //
  // Two hours after `recurringOrders` (03:00) and before `batchExpiry` (05:00 is
  // wrong for this — see below). The ordering matters in one direction only: billing
  // must run AFTER generation, or it bills yesterday's occurrences twice.
  //
  // 05:30 also puts it inside the 12-hour lead the billing service charges on, so a
  // subscription due today is charged the evening before — the point at which a
  // customer is thinking about tomorrow's curry and a declined card can still be
  // retried before the 3-hour deadline.
  jobs.subscriptionBilling = cron.schedule('30 5 * * *', async () => {
    try {
      const summary = await billingService.billDueOccurrences({
        models,
        actor: { _id: null, name: 'jhatka.cron' },
      });

      if (summary.charged || summary.reminded || summary.skipped || summary.failures.length) {
        console.log(
          `[jhatka.cron] subscription billing: scanned=${summary.scanned} ` +
            `charged=${summary.charged} reminded=${summary.reminded} ` +
            `skipped=${summary.skipped} awaiting=${summary.awaiting} ` +
            `tooEarly=${summary.tooEarly} failed=${summary.failures.length}`
        );
      }
      summary.failures.forEach((f) =>
        console.error(`[jhatka.cron] billing failed for ${f.occurrence}: ${f.message}`)
      );
    } catch (error) {
      // Swallowed for the same reason as every other job here: a throw in this file
      // tears down the other eight. See §16.0.
      console.error('[jhatka.cron] subscription billing failed:', error.message);
    }
  });

  // =========================================================================
  // 01:00 — complete DELIVERED orders with nothing still open on them
  // =========================================================================
  //
  // `COMPLETED` is the table's only sink for a fulfilled order and nothing wrote it:
  // every delivered order sat at `DELIVERED` forever, so "delivered" and "finished"
  // were the same thing. See `jhatka.completion.service` for why it is time-based
  // (48h, clearing OD-08's windows) and what holds an order back (open refunds,
  // open complaints).
  //
  // 01:00 because it is the quietest hour and completion is not time-critical.
  // Leftover candidates are picked up tomorrow; the sweep is bounded per run.
  jobs.completionSweep = cron.schedule('0 1 * * *', async () => {
    try {
      const summary = await completionService.sweepCompletions({
        models,
        actor: { _id: null, name: 'jhatka.cron' },
      });

      if (summary.completed > 0) {
        const held = Object.entries(summary.held)
          .map(([reason, n]) => `${reason}=${n}`)
          .join(' ');
        console.log(
          `[jhatka.cron] completion: scanned=${summary.scanned} completed=${summary.completed}` +
            (held ? ` held(${held})` : '')
        );
      }
    } catch (error) {
      console.error('[jhatka.cron] completion sweep failed:', error.message);
    }
  });

  // =========================================================================
  // 02:00 — Daily settlement per outlet
  // =========================================================================
  jobs.dailySettlement = cron.schedule('0 2 * * *', async () => {
    const { from, to } = yesterdayWindow();
    console.log(`[jhatka.cron] settlement ${from.toISOString()} → ${to.toISOString()}`);

    const outlets = await JhatkaOutlet.find({ status: { $in: ['active', 'suspended'] } })
      .select('_id business businessModel')
      .lean();

    for (const outlet of outlets) {
      // DELIVERED, per the lifecycle enum — not `status: 'delivered'`.
      const orders = await JhatkaOrder.find({
        outlet: outlet._id,
        lifecycle: 'DELIVERED',
        deliveredAt: { $gte: from, $lt: to },
      }).lean();
      if (!orders.length) continue;

      // All settlement money is PAISE from here to `toSettlementTotals`, which
      // converts once at the model boundary. Previously this block accumulated
      // lean-read PAISE and assigned it straight into `moneyField` totals, settling
      // a Rs 420 day as Rs 4,200,000 — a uniform 100x error that produced a
      // self-consistent margin percentage and therefore looked entirely plausible.
      const ordersPaise = settlementService.summariseOrdersPaise(orders);

      // Wastage is valued, not weighed — `qty` carries no money on its own.
      const wastages = await JhatkaWastage.find({
        outlet: outlet._id,
        occurredAt: { $gte: from, $lt: to },
      }).lean();
      let wastageTotal = 0;
      let wastageInherent = 0;
      let wastageAvoidable = 0;
      for (const w of wastages) {
        const value = w.estimatedValue || 0;
        wastageTotal += value;
        // TRIM is inherent to cutting; everything else is a process failure.
        if (w.cause === 'TRIM') wastageInherent += value;
        else wastageAvoidable += value;
      }

      const payouts = await JhatkaOperatorPayout.find({
        outlet: outlet._id,
        'period.from': { $gte: from, $lt: to },
        status: { $in: ['draft', 'approved', 'paid'] },
      })
        // `netPayablePaise` DOES NOT EXIST on `JhatkaOperatorPayout`. Selecting it
        // returned nothing, so `operatorPayoutTotal` was ALWAYS 0 and every
        // settlement overstated margin by the full amount owed to riders. The real
        // field is `netPayout` (a moneyField, so RUPEES — hence the *100 below).
        .select('netPayout status')
        .lean();
      const operatorPayoutTotal = payouts.reduce(
        (s, p) => s + toPaiseAmount(p.netPayout || 0),
        0
      );

      // `commercial.arithmetic.contributionMargin` is the documented home of this
      // calculation and the settlement model points at it by name. It works in
      // RUPEES, so it runs on the converted totals, not on the paise inputs.
      const paiseTotals = {
        ...ordersPaise,
        wastageTotal,
        wastageInherent,
        wastageAvoidable,
        operatorPayoutTotal,
      };

      const rupeesTotals = settlementService.toSettlementTotals(paiseTotals, {
        platformGrossRevenue: 0,
        platformNetRevenue: 0,
        contributionMargin: 0,
        contributionMarginPct: 0,
      });

      const margin = commercialArithmetic.contributionMargin(rupeesTotals);

      const settlement = new JhatkaSettlement({
        settlementNo: num('ST'),
        outlet: outlet._id,
        business: outlet.business,
        businessModel: outlet.businessModel,
        granularity: 'outlet',
        period: {
          from,
          to,
          label: from.toISOString().slice(0, 10),
        },
        // `rupeesTotals` already holds the converted money; only the margin figures
        // are replaced, since they are computed from those same rupees.
        totals: {
          ...rupeesTotals,
          platformGrossRevenue: margin.platformGrossRevenue,
          platformNetRevenue: margin.platformNetRevenue,
          contributionMargin: margin.contributionMargin,
          contributionMarginPct: margin.contributionMarginPct,
        },
        sourceRefs: {
          orders: orders.length,
          wastageRecords: wastages.length,
          computedAt: new Date(),
        },
        // 'draft', not 'generated' — the enum is draft|finalised|disputed, and a
        // settlement nobody has approved is a draft.
        status: 'draft',
      });

      const err = settlement.validateSync();
      if (err) {
        console.error('[jhatka.cron] settlement validation failed', Object.keys(err.errors));
        continue;
      }
       
      await settlement.save();
    }

    console.log('[jhatka.cron] settlements done');
  });

  jobs.recurringOrders = cron.schedule('0 3 * * *', () => generateRecurringOrders(models));

  // =========================================================================
  // 03:30 — F-5: actually move refunded money.
  //
  // Weighing an order creates a `JhatkaRefund` in `REFUND_PENDING` and nothing used
  // to pick it up. `jhatka.refund.gateway.js` existed since Phase 1 and had NO callers,
  // so `gatewayRefundId` was written by nothing — Phase 8's DoD was, literally,
  // unmeetable.
  //
  // Exported as a callable for the same reason the generator is: a scheduled body
  // cannot be invoked without waiting for 03:30, so it would have been untestable.
  // =========================================================================
  jobs.refundSettlement = cron.schedule('30 3 * * *', () => processRefunds(models));

  // =========================================================================
  // 04:00 — FSSAI expiry warnings. §12.4
  // =========================================================================
  //
  // §12.4 is three rungs and this used to implement zero of them:
  //
  //     30 days before expiry → notify outlet + admin
  //      7 days before expiry → escalated notification
  //     expiry                → assertJhatkaOperational blocks new orders
  //
  // It printed to stdout instead. `console.log` is not a notification channel: an
  // operator does not read the API server's log, so a licence that lapsed on a
  // Tuesday took the outlet out of trading on Wednesday with nobody warned.
  //
  // The blocking rung itself is NOT here. §12.4 says blocking is a CALLER decision
  // (`assertJhatkaOperational`, called from mutating services) and that it must
  // suspend the OUTLET and never the vertical — suspending `jhatka` because one
  // counter's trade licence lapsed would take down every outlet in the country.
  // What this rung owns is the notification and the escalation.
  jobs.complianceWarnings = cron.schedule('0 4 * * *', async () => {
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 86400000);
    const in7 = new Date(now.getTime() + 7 * 86400000);

    const expiring = await JhatkaCompliance.find({
      'fssai.expiresAt': { $gte: now, $lte: in30 },
    })
      .populate('outlet', 'name contact')
      .lean();

    const alreadyExpired = await JhatkaCompliance.find({
      'fssai.expiresAt': { $lt: now },
    })
      .populate('outlet', 'name contact')
      .lean();

    let warned = 0;
    let escalated = 0;

    for (const c of expiring) {
      const expiresAt = new Date(c.fssai.expiresAt);
      const days = Math.ceil((expiresAt - now) / 86400000);
      const outletId = c.outlet?._id;
      if (!outletId) continue;

      const result = await notifyService.notifyOutlet(outletId, 'compliance_expiry', {
        documentName: 'FSSAI licence',
        daysLeft: days,
        expiryDate: expiresAt.toDateString(),
      });

      if (days <= 7) escalated += 1;
      warned += 1;

      console.log(
        `[jhatka.cron] FSSAI expires in ${days}d: outlet ${outletId} ${c.outlet?.name || ''} ` +
          `(notified=${result.sent ? 'yes' : result.reason}${days <= 7 ? ', ESCALATED' : ''})`
      );
    }

    for (const c of alreadyExpired) {
      const outletId = c.outlet?._id;
      if (!outletId) continue;
      await notifyService.notifyOutlet(outletId, 'compliance_blocked', {
        documentName: 'FSSAI licence',
        expiryDate: new Date(c.fssai.expiresAt).toDateString(),
      });
      console.log(
        `[jhatka.cron] FSSAI EXPIRED: outlet ${outletId} ${c.outlet?.name || ''} — new orders blocked`
      );
    }

    console.log(
      `[jhatka.cron] compliance: ${warned} FSSAI expiring within 30 days ` +
        `(${escalated} within 7), ${alreadyExpired.length} already expired`
    );
  });

  // =========================================================================
  // 05:00 — Batch expiry. §5
  // =========================================================================
  jobs.batchExpiry = cron.schedule('0 5 * * *', async () => {
    const now = new Date();
    const until = new Date(now.getTime() + 2 * 86400000);

    // `expiresAt` and `status: { source, opened }` — the previous version queried
    // `expiryAt` and `status: 'received'`, neither of which exists, so it found
    // nothing on every run.
    const batches = await JhatkaBatch.find({
      status: { $in: ['source', 'opened'] },
      expiresAt: { $gte: now, $lte: until },
      availableQty: { $gt: 0 },
    })
      .populate('outlet', 'name')
      .lean();

    for (const b of batches) {
      const days = Math.ceil((new Date(b.expiresAt) - now) / 86400000);
      console.log(
        `[jhatka.cron] batch ${b.batchNo} expires in ${days}d (${b.availableQty} ${b.unit}) at ${b.outlet?.name || b.outlet?._id}`
      );
    }

    // Expiry write-off (§5). B7: this used to flip `JhatkaBatch.status` to 'expired'
    // and stop. The inventory item kept its `availableQty`, so the AUTHORITATIVE
    // stock count still offered expired meat for sale; no `EXPIRY_WRITE_OFF`
    // movement was written, so the ledger claimed stock that was gone; and no
    // `JhatkaWastage` row was created, so the loss never reached settlement.
    //
    // The service does all three and preserves `availableQty = onHand - reserved`.
    const writeOff = await expiryService.writeOffExpiredBatches({
      models,
      actor: { _id: null, name: 'jhatka.cron' },
    });

    if (writeOff.processed) {
      console.log(
        `[jhatka.cron] expiry write-off: ${writeOff.processed} batch(es), ` +
        `${writeOff.qtyWrittenOff} written off, ` +
        `${writeOff.reservedCarriedOver} reserved carried over (customer-owned)`
      );
    }
  });

  // =========================================================================
  // 06:00 Mondays — Rider payouts
  // =========================================================================
  jobs.weeklyPayouts = cron.schedule('0 6 * * 1', async () => {
    const to = dayKey(new Date());
    const from = dayKey(new Date(Date.now() - 7 * 86400000));

// Jhatka has NO platform pool (§13.2), so `outlet` is required on every driver
    // and there is no second population to sweep. The previous version looked for
    // `status: 'on_delivery'`, which is not in the enum.
    //
    // B4: the previous body wrote `grossEarningsPaise` / `netPayablePaise` /
    // `deliveryCount` / `driver`, NONE of which exist on `JhatkaOperatorPayout`.
    // Mongoose dropped every one, so each payout saved as a row of ZEROS and the
    // settlement job's `.select('netPayablePaise')` read nothing — riders were owed
    // nothing, permanently, with no error. Field names and §10.3 roll-forward now
    // live in the service.
    const payoutResults = await payoutService.runPayoutSweep({
      models,
      from,
      to,
      nextNumber: num,
      partnerFeePct: 10,
    });

    if (payoutResults.length) {
      const rolled = payoutResults.filter((r) => r.reason === 'below_minimum_payout_rolled_forward');
      console.log(
        `[jhatka.cron] payouts=${payoutResults.length} ` +
        `rolledForward=${rolled.length} ` +
`payable=${payoutResults.filter((r) => r.shouldPay).length}`
      );
    }
  });

  // =========================================================================
  // 07:00 — Supplier payable ageing
  // =========================================================================
  jobs.payableAgeing = cron.schedule('0 7 * * *', async () => {
    // There is no `dueDate` on JhatkaSupplierPayable. Ageing is derived from the
    // payable's own period end plus the supplier's credit terms; the previous
    // version filtered on `dueDate: { $lt: now }`, a field that does not exist,
    // which matched nothing.
    const now = new Date();
    const { Supplier } = models;

    const payables = await JhatkaSupplierPayable.find({
      status: { $in: ['draft', 'approved'] },
    })
      .populate('supplier', 'name creditTermDays')
      .lean();

    for (const p of payables) {
      const terms = p.supplier?.creditTermDays ?? 0;
      const due = new Date(new Date(p.period.to).getTime() + terms * 86400000);
      if (due > now) continue;
      const daysOverdue = Math.ceil((now - due) / 86400000);
      console.log(
        `[jhatka.cron] payable ${p.payableNo} overdue ${daysOverdue}d: ${p.supplier?.name} (net ${p.totals?.netAmount})`
      );
    }
    void Supplier;
  });

  // =========================================================================
  // 08:00 — Promotion expiry. `endAt`, and 'expired' is not the status enum.
  // =========================================================================
  jobs.promoCleanup = cron.schedule('0 8 * * *', async () => {
    const now = new Date();

    // JhatkaPromotion.status is a STRING field on the model (not an enum list I
    // could read), so 'expired' is applied rather than asserted. The previous
    // version filtered `validUntil`, which does not exist — the field is `endAt`.
    const result = await JhatkaPromotion.updateMany(
      { status: { $ne: 'void' }, endAt: { $lt: now } },
      { $set: { status: 'expired' } }
    );
    console.log(`[jhatka.cron] promotions expired: ${result.modifiedCount}`);
  });

  // =========================================================================
  // 09:00 — Variance flag ageing
  // =========================================================================
  jobs.varianceAgeing = cron.schedule('0 9 * * *', async () => {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 30 * 86400000);

    // There is no `status` on JhatkaOutletVarianceFlag — the equivalent is `action`
    // (none|observed|reviewed|escalated|calibrated|fraud_referred). The previous
    // version filtered `status: 'open'` and set `status: 'aged'`, neither of which
    // exist, so it never aged a single flag.
    const result = await JhatkaOutletVarianceFlag.updateMany(
      { action: 'observed', flaggedAt: { $lt: cutoff } },
      { $set: { action: 'reviewed', actionAt: now, actionNote: 'Aged after 30 days unreviewed' } }
    );
    console.log(`[jhatka.cron] variance flags aged: ${result.modifiedCount}`);
  });

return jobs;
}

// =========================================================================
// 03:00 - Subscription occurrence generation. §9 DoD.
//
// Module scope, and callable, rather than only scheduled. A `cron.schedule` body
// cannot be invoked without waiting for 03:00 or reaching into node-cron's private
// `runner`, so when this job was a bare schedule it was effectively untestable -
// the integration suite could assert nothing about it. The schedule wraps this
// function; tests call it directly.
// =========================================================================
async function generateRecurringOrders(models) {
  const {
    JhatkaSubscription,
    JhatkaRecurringOrder,
    JhatkaSubscriptionEvent,
    // `JhatkaInventoryItem` is read below via `models.JhatkaInventoryItem` because
    // the stock check below needs the model, not a value bound at destructure time.
  } = models;

  const today = dayKey(new Date());
  console.log(`[jhatka.cron] occurrences for ${today.toISOString().slice(0, 10)}`);

  // The field is `nextOccurrenceDate`. The previous version queried
  // `nextDeliveryDate`, which does not exist, so this matched nothing at all.
  const subs = await JhatkaSubscription.find({
    status: 'active',
    nextOccurrenceDate: { $lte: today },
  }).lean();

  let generated = 0;
  let skippedNoStock = 0;
  let alreadyPresent = 0;

  for (const sub of subs) {
    const occurrenceDate = dayKey(sub.nextOccurrenceDate || today);

    const items = (sub.items || []).map((i) => ({
      variant: i.variant,
      sku: i.sku,
      quantity: i.requestedQuantity.value,
      unit: i.requestedQuantity.unit,
      unitPricePaise: i.unitPriceAtSubscribe,
      chargeMode: i.chargeMode,
      lineCharge: 0,
    }));
    if (!items.length) continue;

    // OD-07: charge the recorded ceiling, not today's market price. Repricing a
    // standing order each week turns a subscription into a variable bill.
    //
    // UNITS. `sub` came back `.lean()`, so `unitPriceAtSubscribe` is raw PAISE
    // (40000 = Rs 400). `lineCharge` and `chargeAmount` are `moneyField`s, whose
    // setter takes RUPEES. Doing the arithmetic in paise and assigning the result
    // straight into the model charged Rs 4,400,000 for a Rs 440 order — the same
    // 100x class of bug the weigh path had. So: compute in paise, convert with
    // `asMoney` at the assignment boundary.
    let chargePaise = 0;
    for (const line of items) {
      const pct = (sub.items.find((i) => i.sku === line.sku)?.subscriptionCeilingPct) ?? 10;
      const basePaise = Math.round((line.quantity || 0) * (line.unitPricePaise || 0));
      const linePaise = line.chargeMode === 'ceiling'
        ? Math.floor((basePaise * (100 + Number(pct || 0))) / 100)
        : basePaise;
      line.lineCharge = asMoney(linePaise);
      line.unitPrice = asMoney(line.unitPricePaise);
      delete line.unitPricePaise;
      chargePaise += linePaise;
    }
    const chargeAmount = asMoney(chargePaise);

    let generationStatus = 'generated';
    let skipReason;
    let skipNote;
    let failures = 0;

    const doc = new JhatkaRecurringOrder({
      subscription: sub._id,
      outlet: sub.outlet,
      customer: sub.customer,
      occurrenceDate,
      generationStatus,
      items,
      estimatedAmount: chargeAmount,
      chargeAmount,
      generatedAt: new Date(),
    });

    try {
      await doc.save();
      generated += 1;
    } catch (e) {
      if (e && e.code === 11000) {
        // The unique index did its job: this occurrence already exists. This is
        // the §9 guarantee ("two runs produce one occurrence") holding under a
        // double tick, not an error.
        alreadyPresent += 1;
         
        continue;
      }
      throw e;
    }

    // Stock is checked AFTER the record exists, so a failure is recorded rather
    // than silently absent. §9: "a stock failure notifies and never silently
    // skips."
    //
    // §9.4: this RESERVES, it does not merely look. The previous version ran
    // `findOne(...).select('availableQty')` and discarded the result — two
    // subscriptions due the same morning both saw the same 5 kg and both promised
    // it. The conditional update inside the service is the actual guard.
    const { shortfalls } = await reservationService.reserveOccurrenceStock({
      occurrence: doc,
      lines: items,
      outlet: sub.outlet,
      models,
      actor: { _id: null, name: 'jhatka.cron' },
    });

    if (shortfalls.length) {
      generationStatus = 'skipped_no_stock';
      skipReason = 'insufficient_stock';
      skipNote = `Short on ${shortfalls.map((s) => s.sku).join(', ')}`;
      failures = 1;
      doc.generationStatus = generationStatus;
      doc.skipReason = skipReason;
      doc.skipNote = skipNote;
      doc.stockReserved = false;
      doc.chargeAmount = 0;
      // `notifiedAt` is NOT stamped here. This cron generator is a THIRD independent
      // copy of the stock-failure path (the other two are in
      // `jhatka.occurrence.service`), and it also used to stamp the date and then
      // report `notifiedAt` on the event as though a message had gone out. One
      // function does the notifying now — see the `notifyStockFailure` call below.
      await doc.save();
      skippedNoStock += 1;
    } else {
      doc.stockReserved = true;
      doc.reservedAt = new Date();
      doc.generationStatus = 'reserved';
      await doc.save();
    }

    // Advance the schedule either way — a skipped occurrence still consumed the
    // date, and leaving nextOccurrenceDate behind means the same day is retried
    // every night until the unique index silently absorbs it.
     
    const live = await JhatkaSubscription.findById(sub._id);
    if (live) {
      live.stats = live.stats || {};
      live.stats.occurrencesGenerated = (live.stats.occurrencesGenerated || 0) + 1;
      live.stats.consecutiveStockFailures =
        failures > 0 ? (live.stats.consecutiveStockFailures || 0) + 1 : 0;
      live.stats.lastGeneratedAt = new Date();
      live.lastOccurrenceDate = occurrenceDate;
      live.nextOccurrenceDate = nextOccurrence(live, occurrenceDate);
      live.stats.nextDeliveryDate = live.nextOccurrenceDate;

      let autoPaused = false;
      if (failures > 0 && live.stats.consecutiveStockFailures >= 3) {
        live.status = 'paused';
        live.statusReason = 'Auto-paused after 3 consecutive stock failures';
        live.pausedAt = new Date();
        autoPaused = true;
      }
await live.save();

      // BR-17. Notify, then stamp from the result. This is the only place the cron
      // speaks to a customer, and it delegates so it cannot drift from the two
      // occurrence-service paths.
      let notification = { sent: false, reason: 'not_required', stampedAt: null };
      if (failures > 0) {
        notification = await occurrenceService.notifyStockFailure({
          sub: live,
          occurrence: doc,
          shortfalls,
          autoPaused,
          consecutiveFailures: live.stats.consecutiveStockFailures,
          occurrenceDate,
        });
        if (notification.stampedAt) await doc.save();
      }

      await JhatkaSubscriptionEvent.create({
        subscription: live._id,
        customer: live.customer,
        outlet: live.outlet,
        type: autoPaused
          ? 'auto_paused'
          : failures > 0
            ? 'stock_failure_skipped'
            : 'activated',
        actorType: 'cron',
        at: new Date(),
        reason: autoPaused ? 'Three consecutive stock failures' : skipNote || 'Occurrence generated',
        consecutiveStockFailures: live.stats.consecutiveStockFailures,
        recurringOrder: doc._id,
        // What the transport did. Was `failures > 0 ? new Date() : undefined`, which
        // was true for every skip and meant nothing.
        notifiedAt: notification.stampedAt,
        notificationReason: failures > 0 ? notification.reason : undefined,
      });
    }
  }

  console.log(
    `[jhatka.cron] occurrences generated=${generated} noStock=${skippedNoStock} alreadyPresent=${alreadyPresent} scanned=${subs.length}`
  );

  // RETURNED, not just logged. A scheduled job's console output is not an
  // assertion; the counts let `verify.jhatka.integration.js` prove that two runs
  // produce one occurrence, which is §9's actual DoD.
  return { generated, skippedNoStock, alreadyPresent, scanned: subs.length };
}

/** Grams for a quantity, used by the settlement COGS estimate. */
function unitToGrams(qty) {
  if (!qty || typeof qty.value !== 'number') return null;
  switch (qty.unit) {
    case 'KG':
      return qty.value * 1000;
    case 'GRAM':
      return qty.value;
    default:
      return null;
  }
}

/** Stop all jobs (for tests/shutdown). */
function stopJhatkaCron(jobs) {
  Object.values(jobs || {}).forEach((job) => job.stop && job.stop());
}

/**
 * Derives `collectionKind` from the ORDER, because the order's payment mode is the
 * only thing that knows whether money was ever collected.
 *
 * Guessing from the refund's own `fundingSource` gets the common COD case wrong: a
 * COD weight refund is SIMULTANEOUSLY `platform_absorbed` (LocalWala bears the cost)
 * and realised as a reduced collection. Those are different questions and need
 * different settlement routes.
 */
async function collectionKindFor(models, refund) {
  const order = await models.JhatkaOrder.findById(refund.order)
    .select('paymentMode')
    .lean();
  if (!order) return 'none';
  if (order.paymentMode === 'gateway') return 'online';
  if (order.paymentMode === 'cod') return 'cod';
  return 'none';
}

/** F-5 sweep. Callable so a test can run it without waiting for 03:30. */
async function processRefunds(models) {
  const result = await processRefundQueue({
    models,
    collectionKindFor: (refund) => collectionKindFor(models, refund),
  });
  console.log(
    `[jhatka.cron] refunds processed=${result.processed} settled=${result.settled} failed=${result.failed}`
  );
  return result;
}

module.exports = {
  startJhatkaCron,
  stopJhatkaCron,
  generateRecurringOrders,
  processRefundQueue,
  processRefunds,
};
module.exports.unitToGrams = unitToGrams;
