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
 * @returns {{payout: object|null, decision: object, carryOutPaise: number}}
 */
async function buildPayout({
  period,
  partner,
  grossPaise,
  carryInPaise = 0,
  partnerFeePct = 10,
  minimumNetPayoutPaise = DEFAULT_MINIMUM_PAYOUT_PAISE,
  models,
  nextNumber,
  items = [],
  ruleSnapshot = {},
}) {
  const { JhatkaOperatorPayout } = models;

const gross = Number(grossPaise) || 0;
  const carryIn = Number(carryInPaise) || 0;

  // Real money field names. See the note at the top of this file.
  const platformFeePaise = Math.round((gross * partnerFeePct) / 100);
  const netAmountPaise = gross - platformFeePaise + carryIn;

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
    commissionEarned: 0,
    royalty: 0,
    adjustments: asMoney(carryInPaise),      // the carried-in balance
    netAmount: asMoney(netAmountPaise),
    paidAmount: 0,
  };

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
    });

    await payout.save();
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
  });

  await payout.save();
  return { payout, decision, carryOutPaise: 0 };
}

/**
 * Run the weekly payout sweep for every partner with deliveries in the window.
 *
 * Carries balances forward: a partner whose payout rolled last week starts this week
 * with that balance included, so the accumulation is real rather than nominal.
 */
async function runPayoutSweep({ models, from, to, nextNumber, partnerFeePct }) {
  const { JhatkaDriver, JhatkaDelivery, JhatkaOperatorPayout } = models;

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
      .populate('order')
      .lean();

    if (!deliveries.length) continue;

    let grossPaise = 0;
    for (const d of deliveries) {
      // The delivery fee a rider earns lives on the ORDER, not the delivery. The
      // previous version read `order.payment.driverCommissionPaise`, which is not a
      // field on either model, so every sum was zero.
      grossPaise += d.order?.deliveryFee || 0;
    }

    // Whatever this partner failed to collect last period.
    const priorCarries = await JhatkaOperatorPayout.find({
      outlet: driver.outlet,
      status: 'draft',
      statusReason: 'below_minimum_payout_rolled_forward',
      'period.to': { $lt: from },
    })
      .select('totals.netAmount')
      .lean();

    const carryInPaise = priorCarries.reduce(
      (s, p) => s + Math.round((p.totals?.netAmount || 0) * 100),
      0
    );

    const outlet = await models.JhatkaOutlet.findById(driver.outlet).lean();
    if (!outlet) continue;

    const built = await buildPayout({
      period: {
        from,
        to,
        label: `${new Date(from).toISOString().slice(0, 10)}/${new Date(to).toISOString().slice(0, 10)}`,
      },
      partner: {
        partner: outlet.partner,
        franchise: outlet.franchise,
        outlet: outlet._id,
        business: outlet.business,
        // Validated by the model; a missing value here fails the save with a message
        // naming one field, so it is resolved explicitly first.
        businessModel: outlet.businessModel === 'franchise' ? 'franchise' : 'commission_partner',
      },
      grossPaise,
      carryInPaise,
      partnerFeePct,
      models,
      nextNumber,
      items: deliveries.map((d) => {
        // `items[]` on `JhatkaOperatorPayout` is keyed on ORDER, not delivery —
        // `order` and `orderNo` are both required. One payout line per ORDER, with the
        // delivery's fee folded into `revenueComponents.delivery`.
        const order = d.order || {};
        const deliveryFee = Number(order.deliveryFee || 0) / 100; // paise -> rupees
        const grossOrderValue = Number(order.finalTotal || order.estimatedTotal || 0) / 100;

        return {
          order: order._id,
          orderNo: order.orderNo || String(d._id),
          orderDate: new Date(d.codFrozenAt || order.createdAt || Date.now()),
          grossOrderValue,
          commissionableRevenue: grossOrderValue,
          revenueComponents: {
            product: Math.max(0, grossOrderValue - deliveryFee),
            delivery: deliveryFee,
            packaging: Number(order.packagingFee || 0) / 100,
            service: 0,
          },
          refundDeduction: 0,
          platformFee: deliveryFee * (partnerFeePct / 100),
          commissionEarned: 0,
          ruleSnapshot: { partnerFeePct },
        };
      }).filter((i) => i.order),
      ruleSnapshot: { partnerFeePct },
    });

    results.push({
      driver: String(driver._id),
      grossPaise,
      carryInPaise,
      netPaise: built.decision.amount,
      shouldPay: built.decision.shouldPay,
      reason: built.decision.reason,
      payoutNo: built.payout?.payoutNo,
    });
  }

  return results;
}

module.exports = { buildPayout, runPayoutSweep, DEFAULT_MINIMUM_PAYOUT_PAISE };