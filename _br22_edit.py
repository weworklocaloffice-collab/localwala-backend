import io

p = "src/modules/jhatka/services/jhatka.payout.service.js"
with io.open(p, encoding='utf-8') as f:
    lines = f.readlines()

start = None
for i, line in enumerate(lines):
    if 'async function runPayoutSweep' in line:
        start = i
        break
assert start is not None, 'runPayoutSweep not found'

# find the closing '}' of the function: the first line that is exactly '}\n'
# after start (the function is top-level, so its close is at column 0)
end = None
for i in range(start + 1, len(lines)):
    if 'return results;' in lines[i]:
        # the closing '}' of this top-level function follows the return
        for j in range(i, min(i + 5, len(lines))):
            if lines[j].rstrip() == '}':
                end = j  # exclusive
                break
        break
assert end is not None, 'closing brace not found'

new_code = '''/**
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
    JhatkaCommissionRule, JhatkaPartnerLedger,
  } = models;

  const activeRules = await JhatkaCommissionRule.find({ status: 'active' }).lean();
  const outlets = await JhatkaOutlet.find({ status: 'active' })
    .select('_id business businessModel partner franchise')
    .lean();

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
'''

lines[start:end] = [new_code]
with open(p, 'w', encoding='utf-8', newline='') as f:
    f.writelines(lines)
print('runPayoutSweep reworked + runRiderFeeSweep added')
