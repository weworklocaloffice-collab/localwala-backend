/**
 * jhatka.settlement.service.js — the one place settlement money is computed.
 *
 * ## The bug this file was written to kill
 *
 * `JhatkaSettlement.totals.*` are ALL `moneyField`s, so their setter takes RUPEES.
 * The settlement job accumulated from `.lean()` reads, which return raw PAISE, and
 * assigned the running totals straight in — so a Rs 420 day settled as
 * Rs 4,200,000. Every total was exactly 100x too large.
 *
 * Nothing threw. The numbers looked plausible, the margin percentage was internally
 * consistent (a uniform error cancels in a ratio), and no test compared a settlement
 * against the orders it summarised.
 *
 * ## Why margin is not a subtraction
 *
 * `contributionMargin` is NOT computed here. `JhatkaSettlement`'s own doc points at
 * `utils/commercial.arithmetic.contributionMargin`, and that function exists and is
 * correct — it subtracts absorbed over-charges, strips tax, and knows that delivery
 * and packaging are already inside `grossOrderValue`. An earlier draft of this file
 * re-derived the arithmetic and got all three of those wrong, which is precisely the
 * argument for calling the one that already exists.
 *
 * The caller's job is therefore narrow and mechanical: gather paise, convert once at
 * the model boundary, and hand the rupee totals to that function.
 *
 * ## Units
 *
 * `summariseOrdersPaise` returns PAISE for every money field.
 * `toSettlementTotals` converts to RUPEES exactly once, at the model boundary.
 * Between those two calls the margin helper runs on RUPEES, which is what it
 * documents. A function that cannot be handed the wrong unit is worth more than a
 * comment asking people to be careful.
 */

const { toGrams } = require('../utils/quantity');
const { asMoney } = require('../utils/money');

/**
 * Cost of goods actually consumed, from PACKED weights rather than ordered ones.
 *
 * A 900 g pack of a product priced per kg costs less than the 1 kg sold, and settling
 * on the ordered quantity quietly overstates COGS — and therefore understates margin —
 * on every variable-weight line in the vertical.
 *
 * COGS is derived from `unitPrice` (what the customer paid per unit), which is a
 * deliberate simplification: it values consumed stock at SELLING price, not purchase
 * cost. That is WRONG for true margin and is called out on the settlement model. It
 * is kept because switching it now would move every historical settlement, and the
 * real fix is `JhatkaBatch.costPerUnit` propagated from the supplier receipt — which
 * the batches now carry. Flagged rather than silently "fixed".
 */
function computeCogsPaise(order) {
  let cogs = 0;
  for (const item of order.items || []) {
    if (item.measurementMode !== 'WEIGHT') continue;
    const grams = item.actualQuantity?.value != null ? toGrams(item.actualQuantity) : null;
    if (grams == null) continue;
    if (!item.unitPrice) continue;
    // per_kg pricing -> cost proportional to grams. `item.unitPrice` is paise here
    // because `order` is a lean read.
    cogs += Math.round((grams / 1000) * item.unitPrice);
  }
  return cogs;
}

/**
 * Fold a set of delivered orders into raw paise totals.
 *
 * Returns PAISE for every money field. The caller converts once.
 */
function summariseOrdersPaise(orders) {
  const t = {
    orderCount: orders.length,
    grossOrderValue: 0,
    weightAdjustmentTotal: 0,
    absorbedOverchargeTotal: 0,
    discountTotal: 0,
    taxCollected: 0,
    deliveryFeeCollected: 0,
    packagingFeeCollected: 0,
    netCustomerCollections: 0,
    cogsTotal: 0,
  };

  for (const order of orders) {
    // `order.finalTotal ?? order.estimatedTotal` — a lean read, so both are PAISE.
    // The customer paid the confirmed total; only fall back to the estimate if the
    // order was never weighed, which cannot happen for a DELIVERED order but keeps
    // the fallback honest rather than assuming.
    t.grossOrderValue += order.finalTotal ?? order.estimatedTotal ?? 0;
    t.weightAdjustmentTotal += order.weightAdjustmentTotal || 0;
    t.absorbedOverchargeTotal += order.absorbedOverchargeTotal || 0;
    t.discountTotal += order.discountTotal || 0;
    t.taxCollected += order.taxTotal || 0;
    t.deliveryFeeCollected += order.deliveryFee || 0;
    t.packagingFeeCollected += order.packagingFee || 0;
    t.netCustomerCollections += order.paidAmount || order.codCollectionAmount || 0;
    t.cogsTotal += computeCogsPaise(order);
  }

  return t;
}

/**
 * Convert PAISE totals into the RUPEES shape `JhatkaSettlement.totals` expects.
 *
 * This is the ONLY conversion boundary. `contributionMarginPct` is a percentage and
 * is passed through untouched — converting it would be a unit error of a different
 * kind, and it is the kind that hides, because the ratio still looks sane.
 */
function toSettlementTotals(paise, margin) {
  return {
    orderCount: paise.orderCount,
    grossOrderValue: asMoney(paise.grossOrderValue),
    weightAdjustmentTotal: asMoney(paise.weightAdjustmentTotal),
    absorbedOverchargeTotal: asMoney(paise.absorbedOverchargeTotal),
    discountTotal: asMoney(paise.discountTotal),
    taxCollected: asMoney(paise.taxCollected),
    deliveryFeeCollected: asMoney(paise.deliveryFeeCollected),
    packagingFeeCollected: asMoney(paise.packagingFeeCollected),
    netCustomerCollections: asMoney(paise.netCustomerCollections),
    cogsTotal: asMoney(paise.cogsTotal),
    wastageTotal: asMoney(paise.wastageTotal),
    wastageInherent: asMoney(paise.wastageInherent),
    wastageAvoidable: asMoney(paise.wastageAvoidable),
    operatorPayoutTotal: asMoney(paise.operatorPayoutTotal),
    supplierPayableTotal: asMoney(paise.supplierPayableTotal || 0),
    deliveryCostTotal: asMoney(paise.deliveryCostTotal || 0),
    tdsDeductedTotal: asMoney(paise.tdsDeductedTotal || 0),
    // Margin figures come from `commercial.arithmetic.contributionMargin`, which is
    // the documented home of this calculation. Re-deriving them here — which an
    // earlier draft of this file did — gets the revenue definition wrong twice over.
    platformGrossRevenue: asMoney(margin.platformGrossRevenue),
    platformNetRevenue: asMoney(margin.platformNetRevenue),
    contributionMargin: asMoney(margin.contributionMargin),
    contributionMarginPct: margin.contributionMarginPct,
  };
}

module.exports = { summariseOrdersPaise, toSettlementTotals, computeCogsPaise };