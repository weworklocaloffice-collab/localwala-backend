/**
 * jhatka.payout.service.js — §10.3 rider payouts, including the roll-forward.
 *
 * ## The bug this exists to fix
 *
 * The weekly payout job built a `JhatkaOperatorPayout` with:
 *
 *     driver, totals: { deliveryCount, grossEarningsPaise, platformFeePaise, netPayablePaise }
 *
 * **Not one of those field names exists on the model.** Mongoose runs in strict mode,
 * so every one was discarded on save without a warning or an error. The row was written,
 * `status: 'draft'`, with every total `0`.
 *
 * And the settlement job then read `.select('netPayablePaise')` — a field that does
 * not exist — so `operatorPayoutTotal` was **always zero**. A rider could deliver for a
 * month and settlement would show nothing owed to them, with no error anywhere.
 *
 * Verified before fixing: the totals persisted as
 * `{orderCount: 0, grossRevenue: 0, ..., netAmount: 0}`.
 *
 * ## This is the same class as the six 100× money bugs
 *
 * A write to a field the schema does not define is not an error, it is a silent zero.
 * It is the shape that produced "the ledger claims stock that is gone" (B7) and "the
 * settlement settled Rs 4,200,000" — a value that looks computed because it is a
 * number, just not the right one.
 *
 * ## §10.3 roll-forward
 *
 * A Rs 40 bank transfer costs more in fees and support time than the Rs 40 is worth,
 * and a partner with nine of them gets nine transfers a month instead of one. Below
 * `minimumNetPayout` the balance is NOT paid and NOT discarded — it is carried into the
 * next period, and this period records `rolledForwardReason` so the statement explains
 * itself without an operator needing to know the rule.
 *
 * The carried amount is written to the NEXT payout, so a partner who accrues Rs 30,
 * Rs 30, Rs 30 receives one Rs 90 transfer rather than three Rs 30 ones.
 */

const { payoutDecision } = require('../utils/commercial.arithmetic');
const { asMoney } = require('../utils/money');
const notifyService = require('./jhatka.notify.service');

/** Default floor. Overridable per partner via `ruleSnapshot.minimumNetPayoutPaise`. */
const DEFAULT_MINIMUM_PAYOUT_PAISE = 5000; // Rs 50

/**
 * Build the payout for one partner over a period, applying §10.3.
 *
 * @param {object} p
 * @param {object} p.period `{ from, to, label }`
 * @param {object} p.partner `{ _id, partner?, franchise?, outlet, business, businessModel }`
 * @param {number} p.grossPaise  earnings before platform fee
 * @param {number} p.carryInPaise balance carried in from a previous roll-forward
 * @param {object} p.payoutDetails bank/UPI destination frozen onto the statement
 * @param {string} p.payoutMethod `bank` | `wallet`
 * @returns {{payout: object|null, decision: object, carryOutPaise: number}}
 */
async function buildPayout({
  period,
  partner,
  grossPaise,
  carryInPaise = 0,
  deductPaise = 0,
  partnerFeePct = 10,
  minimumNetPayoutPaise = DEFAULT_MINIMUM_PAYOUT_PAISE,
  payoutDetails = {},
  payoutMethod = 'bank',
  models,
  nextNumber,
  items = [],
  ruleSnapshot = {},
}) {
  const { JhatkaOperatorPayout } = models;

const gross = Number(grossPaise) || 0;
  const carryIn = Number(carryInPaise) || 0;
  // BR-22: stock the partner received this period (ledger STOCK_DEBIT
  // magnitude) is a DEDUCTION — the partner pays for the meat out of the
  // statement.
  const deduct = Math.max(0, Number(deductPaise) || 0);

  // Real money field names. See the note at the top of this file.
  const platformFeePaise = Math.round((gross * partnerFeePct) / 100);
  const netAmountPaise = gross - platformFeePaise + carryIn - deduct;

  // The decision is about the TOTAL payable this period, carry-in included. Deciding on
  // the period's earnings alone and then adding a carried balance would pay out exactly
  // what §10.3 exists to avoid.
  // Everything up to here is PAISE. Every `totals.*` below is a moneyField and
  // therefore RUPEES, so each conversion is written as `asMoney(...)` rather than a
  // bare `/ 100` — the whole point is that the direction is legible at the call site.
  const decision = payoutDecision(netAmountPaise, minimumNetPayoutPaise);

  const totals = {
    orderCount: items.length,
    grossRevenue: asMoney(netAmountPaise),
    grossOrderValue: asMoney(netAmountPaise),
    refundDeduction: 0,
    absorbedOvercharge: 0,
    platformFee: asMoney(platformFeePaise),
    // What the OPERATOR earned per the statement, summed from the item lines in
    // JavaScript (never an aggregation): the items carry rupee figures written
    // through moneyField semantics, so the sum is scaled back to paise first.
    commissionEarned: asMoney(
      items.reduce((s, i) => s + Math.round(Number(i.commissionEarned || 0) * 100), 0)
    ),
    royalty: 0,
    adjustments: asMoney(carryIn - deduct),  // carried-in minus stock recovery (detail in ruleSnapshot)
    netAmount: asMoney(netAmountPaise),
    paidAmount: 0,
  };

  // BR-22: with stock deductions in play a period can net NEGATIVE — the
  // partner owes LocalWala more than they earned. The balance is not lost: it
  // carries as a negative carry-in, surfacing in the next period's statement
  // and on the ledger via the sweep's PAYOUT_NETTING entry.
  if (!decision.shouldPay && decision.reason === 'negative_net_amount') {
    const payout = new JhatkaOperatorPayout({
      payoutNo: nextNumber('OP'),
      partner: partner.partner,
      franchise: partner.franchise,
      outlet: partner.outlet,
      business: partner.business,
      businessModel: partner.businessModel,
      period,
      ruleSnapshot: { ...ruleSnapshot, minimumNetPayoutPaise },
      totals,
      items,
      status: 'draft',
      statusReason: 'negative_net_carried_forward',
      rolledForwardReason:
        `Rs ${(netAmountPaise / 100).toFixed(2)} owed to LocalWala — carried against future earnings`,
      payoutMethod,
      payoutDetails,
    });
    await payout.save();
    return { payout, decision, carryOutPaise: netAmountPaise };
  }

  if (!decision.shouldPay && decision.reason === 'below_minimum_payout_rolled_forward') {
    // Below the floor: the money is NOT lost, it is deferred. The row still exists so
    // the partner has a statement for the period, marked as carrying forward.
    const payout = new JhatkaOperatorPayout({
      payoutNo: nextNumber('OP'),
      partner: partner.partner,
      franchise: partner.franchise,
      outlet: partner.outlet,
      business: partner.business,
      businessModel: partner.businessModel,
      period,
      ruleSnapshot: { ...ruleSnapshot, minimumNetPayoutPaise },
      totals,
      items,
      status: 'draft',
      statusReason: 'below_minimum_payout_rolled_forward',
      // The single field that makes the statement self-explanatory. Written ONLY on a
      // genuine roll-forward, never as a default — an empty string on a paid payout
      // would read as "this was rolled forward and nobody said why".
      rolledForwardReason:
        `Rs ${(netAmountPaise / 100).toFixed(2)} is below the Rs ${(
          minimumNetPayoutPaise / 100
        ).toFixed(2)} minimum; carried to the next period`,
      netPayout: 0,
      payoutMethod,
      payoutDetails,
    });

    await payout.save();

    await notifyService.notifyOutlet(partner.outlet, 'payout_rolled_forward', {
      payoutNo: payout.payoutNo,
      netAmount: `Rs ${(netAmountPaise / 100).toFixed(2)}`,
      minimumNetPayout: `Rs ${(minimumNetPayoutPaise / 100).toFixed(2)}`,
    });

    return { payout, decision, carryOutPaise: netAmountPaise };
  }

  if (!decision.shouldPay) {
    // `nothing_due` or `negative_net_amount`. A negative is an anomaly and must NOT be
    // paid; a zero nets nothing to roll.
    return { payout: null, decision, carryOutPaise: 0 };
  }

  const payout = new JhatkaOperatorPayout({
    payoutNo: nextNumber('OP'),
    partner: partner.partner,
    franchise: partner.franchise,
    outlet: partner.outlet,
    business: partner.business,
    businessModel: partner.businessModel,
    period,
    ruleSnapshot: { ...ruleSnapshot, minimumNetPayoutPaise },
    totals,
    items,
    status: 'draft',
    statusReason: 'payable',
    // `netPayout` is a moneyField: the setter takes RUPEES. `netAmountPaise` is
    // PAISE, so dividing is the CONVERSION, not a cosmetic scale.
    //
    // Writing `netAmount` raw here would have been the seventh 100× bug in this
    // vertical — and this one would have been introduced by the very fix for the
    // payout zeros. `asMoney` is used rather than a bare `/ 100` so the direction is
    // visible at the call site.
    netPayout: asMoney(netAmountPaise),
    payoutMethod,
    payoutDetails,
  });

  await payout.save();
  return { payout, decision, carryOutPaise: 0 };
}

/**
 * Pick the rule in force for `businessModel` at `at`, from an already-fetched
 * list. Pure, so the unit suite can cover selection without a database.
 *
 * Rules: only `active` ones apply; only ones that have TAKEN EFFECT
 * (`effectiveFrom <= at` — an active rule dated for next month must not govern
 * this week's payouts); the latest effectiveFrom wins. The partial-unique index
 * guarantees at most one active rule per business model, so the tie-break is
 * defensive rather than load-bearing.
 *
 * @param {Array<object>} rules
 * @param {string} businessModel
 * @param {Date|number|string} at
 * @returns {object|null}
 */
function pickActiveRule(rules, businessModel, at) {
  const atMs = new Date(at).getTime();
  return (rules || [])
    .filter((r) => r.businessModel === businessModel
      && r.status === 'active'
      && new Date(r.effectiveFrom).getTime() <= atMs)
    .sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom))[0] || null;
}

/**
 * Run the weekly payout sweep for every partner with deliveries in the window.
 *
 * Carries balances forward: a partner whose payout rolled last week starts this week
 * with that balance included, so the accumulation is real rather than nominal.
 *
 * The fee percentage is RESOLVED, not assumed: the active `JhatkaCommissionRule`
 * for the outlet's business model governs when one exists and carries a
 * `ratePercent`. The caller's `partnerFeePct` (the cron's 10) is only the
 * FALLBACK for outlets with no effective rule — so a rule the admin activates
 * genuinely changes what partners are paid, and each payout freezes the rule it
 * actually used, not a hand-written echo of a default.
 */
/**
 * Run the BR-22 payout sweep: ONE operator payout per OUTLET per period,
 * computed from ORDER VALUE.
 *
 * ## What changed and why (BR-22, the five-document rule)
 *
 * The first version of this sweep distributed RIDER delivery fees through
 * `JhatkaOperatorPayout` - conflating the rider's settlement with the
 * operator's, and grossing on delivery fees that are (today) zero, so no
 * payout ever existed and the commission rules had nothing to govern. Now:
 *
 *   - THIS sweep writes the OPERATOR statement: gross = the order value the
 *     outlet's counters actually delivered (finalTotal of DELIVERED/COMPLETED
 *     orders in the window), platform fee = the active commission rule's
 *     `platformFeePercent` on that value, the partner's earning = `ratePercent`
 *     (recorded, never deducted), and stock recovery = the period's ledger
 *     STOCK_DEBIT magnitude (the partner pays for the meat out of the
 *     statement - Design B).
 *   - RIDER fees go to their own document: `runRiderFeeSweep` below writes
 *     `JhatkaDeliverySettlement` rows. Never the same doc (BR-22).
 *
 * A period can net NEGATIVE (fees + stock > sales). `buildPayout` carries that
 * as a negative roll-forward (statusReason `negative_net_carried_forward`), and
 * the carry-in reader below picks up both roll-forward reasons, so the balance
 * survives until earnings cover it.
 *
 * ## Units, stated once
 *
 * Orders are read LEAN: every moneyField is the RAW stored paise. All sums are
 * paise in and paise out; `buildPayout` converts at its moneyField boundary.
 * No x100, no /100 in this function - the classic F-9 trap lives exactly here.
 */
async function runPayoutSweep({ models, from, to, nextNumber, partnerFeePct = 10 }) {
  const {
    JhatkaOutlet, JhatkaOrder, JhatkaOperatorPayout,
    JhatkaCommissionRule, JhatkaPartnerLedger, JhatkaPartner,
  } = models;

  const activeRules = await JhatkaCommissionRule.find({ status: 'active' }).lean();
  const outlets = await JhatkaOutlet.find({ status: 'active' })
    .select('_id business businessModel partner franchise paymentConfig')
    .lean();

  // Freeze the destination ONTO the statement at generation time. Without this
  // the approve route always refused with NO_PAYOUT_DESTINATION, so a sweep
  // payout could never reach `paid`. The outlet's own account wins (a payout is
  // per outlet); the partner account is the fallback for outlets that have not
  // set one.
  const partnerIds = [...new Set(outlets.map((o) => o.partner).filter(Boolean).map(String))];
  const partners = partnerIds.length
    ? await JhatkaPartner.find({ _id: { $in: partnerIds } })
      .select('bank payoutMethod')
      .lean()
    : [];
  const partnerById = new Map(partners.map((p) => [String(p._id), p]));

  const results = [];

  for (const outlet of outlets) {
    const orders = await JhatkaOrder.find({
      outlet: outlet._id,
      lifecycle: { $in: ['DELIVERED', 'COMPLETED'] },
      deliveredAt: { $gte: from, $lt: to },
    })
      .select('finalTotal orderNo deliveredAt')
      .lean();

    if (!orders.length) continue;

    const grossPaise = orders.reduce(
      (s, o) => s + Math.max(0, Number(o.finalTotal || 0)),
      0
    );

    // Whatever this partner failed to collect last period (either roll-forward
    // reason - the balance is the same fact in both clothes).
    const priorCarries = await JhatkaOperatorPayout.find({
      outlet: outlet._id,
      status: 'draft',
      statusReason: { $in: ['below_minimum_payout_rolled_forward', 'negative_net_carried_forward'] },
      'period.to': { $lt: from },
    })
      .select('totals.netAmount')
      .lean();

    // Lean read: netAmount is the RAW stored paise. Take it at face value (the
    // x100 version of this line was a real 100x carry bug - see Addendum 7).
    const carryInPaise = priorCarries.reduce(
      (s, p) => s + Math.round(p.totals?.netAmount || 0),
      0
    );

    // Stock recovery: the outlet's ledger STOCK_DEBIT magnitude inside the
    // window. The debit is stored NEGATIVE (partner's perspective); the
    // deduction is its absolute value.
    const stockDebits = await JhatkaPartnerLedger.find({
      outlet: outlet._id,
      entryType: 'STOCK_DEBIT',
      createdAt: { $gte: from, $lt: to },
    })
      .select('amountPaise')
      .lean();
    const stockDebitPaise = stockDebits.reduce(
      (s, e) => s + Math.abs(Number(e.amountPaise) || 0),
      0
    );

    const payoutBusinessModel = outlet.businessModel === 'franchise'
      ? 'franchise'
      : 'commission_partner';
    const rule = pickActiveRule(activeRules, payoutBusinessModel, to);
    const appliedFeePct = rule?.platformFeePercent ?? partnerFeePct;
    const partnerRatePct = rule?.ratePercent ?? 0;
    const appliedSnapshot = rule
      ? {
          ...(rule.toSnapshot ? rule.toSnapshot() : rule),
          appliedPlatformFeePct: appliedFeePct,
          appliedPartnerRatePct: partnerRatePct,
          stockRecoveryPaise: stockDebitPaise,
        }
      : {
          platformFeePct: appliedFeePct,
          partnerRatePct,
          stockRecoveryPaise: stockDebitPaise,
          source: 'default_no_active_rule',
        };

    const partnerRecord = outlet.partner ? partnerById.get(String(outlet.partner)) : null;
    const outletBank = outlet.paymentConfig?.bank || {};
    const payoutDetails = (outletBank.ifsc || outletBank.upiId)
      ? outletBank
      : (partnerRecord?.bank || {});
    const payoutMethod = outlet.paymentConfig?.payoutMethod
      || partnerRecord?.payoutMethod
      || 'bank';

    const built = await buildPayout({
      period: {
        from,
        to,
        label: new Date(from).toISOString().slice(0, 10) + '/' + new Date(to).toISOString().slice(0, 10),
      },
      partner: {
        partner: outlet.partner,
        franchise: outlet.franchise,
        outlet: outlet._id,
        business: outlet.business,
        businessModel: payoutBusinessModel,
      },
      grossPaise,
      carryInPaise,
      deductPaise: stockDebitPaise,
      partnerFeePct: appliedFeePct,
      payoutDetails,
      payoutMethod,
      models,
      nextNumber,
      items: orders.map((o) => {
        const grossOrderValue = Number(o.finalTotal || 0) / 100; // paise -> rupees
        return {
          order: o._id,
          orderNo: o.orderNo,
          orderDate: new Date(o.deliveredAt || Date.now()),
          grossOrderValue,
          commissionableRevenue: grossOrderValue,
          revenueComponents: { product: grossOrderValue, delivery: 0, packaging: 0, service: 0 },
          refundDeduction: 0,
          platformFee: grossOrderValue * (appliedFeePct / 100),
          commissionEarned: grossOrderValue * (partnerRatePct / 100),
          ruleSnapshot: appliedSnapshot,
        };
      }),
      ruleSnapshot: appliedSnapshot,
    });

    results.push({
      outlet: String(outlet._id),
      grossPaise,
      stockDebitPaise,
      carryInPaise,
      platformFeePct: appliedFeePct,
      partnerRatePct,
      netPaise: built.decision.amount,
      shouldPay: built.decision.shouldPay,
      reason: built.decision.reason,
      payoutNo: built.payout?.payoutNo,
    });
  }

  return results;
}

/**
 * RIDER fees - their OWN document per BR-22 (`JhatkaDeliverySettlement`,
 * LocalWala -> Driver). The platform does not take a cut of the rider's fee:
 * the operator's statement above carries the platform's economics, and this
 * statement carries the rider's. Mixing them is what BR-22 exists to forbid.
 *
 * Per active driver with delivered deliveries in the window:
 *   deliveryFeeEarned = sum of order.deliveryFee (raw stored paise, lean)
 *   netAmount         = deliveryFeeEarned + adjustments (v1: no adjustments)
 *
 * @returns {Promise<Array>} one summary per settlement written
 */
async function runRiderFeeSweep({ models, from, to, nextNumber }) {
  const { JhatkaDriver, JhatkaDelivery, JhatkaDeliverySettlement } = models;

  const drivers = await JhatkaDriver.find({ status: 'active' })
    .select('_id outlet payoutMode')
    .lean();

  const results = [];

  for (const driver of drivers) {
    const deliveries = await JhatkaDelivery.find({
      driver: driver._id,
      status: 'delivered',
      codFrozenAt: { $gte: from, $lt: to },
    })
      .populate('order', 'deliveryFee')
      .lean();

    if (!deliveries.length) continue;

    // Lean: order.deliveryFee is RAW PAISE.
    const feePaise = deliveries.reduce(
      (s, d) => s + Math.max(0, Number(d.order?.deliveryFee || 0)),
      0
    );
    if (feePaise <= 0) continue;

    const settlement = await JhatkaDeliverySettlement.create({
      settlementNo: nextNumber('DS'),
      driver: driver._id,
      outlet: driver.outlet,
      payoutMode: driver.payoutMode || 'business_pays',
      period: {
        from,
        to,
        label: new Date(from).toISOString().slice(0, 10) + '/' + new Date(to).toISOString().slice(0, 10),
      },
      totals: {
        deliveryCount: deliveries.length,
        successfulCount: deliveries.length,
        failedCount: 0,
        deliveryFeeEarned: feePaise / 100, // moneyField takes RUPEES
        netAmount: feePaise / 100,         // POSITIVE: the platform owes the rider
      },
      deliveries: deliveries.map((d) => ({
        delivery: d._id,
        deliveryNo: d.deliveryNo,
        deliveredAt: d.codFrozenAt || new Date(),
        // Per-line fee snapshot (the totals are the sum of these) and the
        // payer, REQUIRED per line.
        deliveryFee: (Number(d.order?.deliveryFee) || 0) / 100,
        payoutMode: driver.payoutMode || 'business_pays',
      })),
      status: 'draft',
    });

    results.push({
      driver: String(driver._id),
      settlementNo: settlement.settlementNo,
      deliveryCount: deliveries.length,
      feePaise,
    });
  }

  return results;
}

module.exports = {
  buildPayout,
  runPayoutSweep,
  runRiderFeeSweep,
  pickActiveRule,
  DEFAULT_MINIMUM_PAYOUT_PAISE,
};