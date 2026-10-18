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
 * The commercial arithmetic. Pure.
 *
 * ## Everything here computes a FIGURE. Nothing here persists it.
 *
 * That separation is the point. Commission rates, revenue-share bases, TDS and
 * payout floors are the rules most likely to be quietly duplicated across a
 * service, a settlement generator and an analytics report — and the version that
 * drifts is the one nobody reconciles. One pure module, called from all three,
 * means a change to a rate is a change in one place.
 *
 * ## BR-26: every result is computed against a SNAPSHOT
 *
 * `JhatkaOperatorPayout` and `JhatkaCommissionRule` both carry a frozen copy of
 * the rule. Nothing in this module takes a live rule reference. A rate changed in
 * the admin panel must not restate a payout that was already approved, and the
 * only way to guarantee that is for the arithmetic to have no access to the live
 * document.
 *
 * ## Sign convention, matching `DairyProviderPayable`
 *
 * `netAmount` is **positive when the platform owes**. Every figure below follows
 * it. A negative `netAmount` in a payout statement is a genuine anomaly, and the
 * test suite asserts it cannot arise from ordinary arithmetic.
 *
 * ## Everything here is in RUPEES, never paise
 *
 * Every function takes and returns rupees. The models that call these declare
 * their fields with `moneyField()`, so Mongoose converts at the boundary and the
 * paise never leak into a percentage. Doing the conversion inside these functions
 * instead would mean two conversions — once on write, once on read — and the
 * division between them is invisible.
 */

/** Revenue-share bases. Which revenue counts is a commercial decision. */
const REVENUE_SHARE_BASES = [
  'product_only',
  'product_and_delivery',
  'product_and_packaging',
  'product_delivery_and_service',
];

/** Commission calculation bases. §10.3. */
const COMMISSION_BASES = [
  'final_weighted_value',
  'gross_order_value',
  'net_of_refunds',
  'fixed_monthly',
];

/**
 * The revenue a commission is calculated on.
 *
 * ## Why `final_weighted_value` and not `grand_total`
 *
 * This is the single most consequential choice in the money module, and it is a
 * direct consequence of BR-06.
 *
 * Under the blueprint's original §37, the partner was the seller and commission
 * was a share of what the customer paid. But BR-06 means the customer may pay LESS
 * than the estimate, because the weight came in short and LocalWala absorbs the
 * refund. Commissioning on `grand_total` would then charge the partner commission
 * on revenue that was refunded and never reached them.
 *
 * So the basis is explicitly the VALUE OF THE MEAT THAT WAS ACTUALLY PREPARED —
 * `items[].finalAmount` summed — not what was charged. Under-delivery reduces the
 * partner's commission, which is correct: they prepared less.
 *
 * `net_of_refunds` is offered for a commercial who wants the other reading, and it
 * is a separate, explicitly-chosen basis rather than a fallback.
 *
 * @param {object} args
 * @param {Array<{finalAmount:number, lineGrand:number, lineTotal:number}>} args.items
 * @param {number} args.grandTotal          charged to the customer
 * @param {number} args.refundedAmount      settled refunds on this order
 * @param {number} args.deliveryFee
 * @param {number} args.packagingFee
 * @param {number} args.serviceFee
 * @param {string} args.basis
 * @returns {number} revenue in RUPEES
 */
function commissionableRevenue({
  items = [],
  grandTotal = 0,
  refundedAmount = 0,
  basis = 'final_weighted_value',
  // `deliveryFee`, `packagingFee` and `serviceFee` are NOT parameters here. A
  // commission BASE is never "gross plus fees" — those are separate components
  // handled by `revenueComponents`, and a basis that silently added them would
  // double-count them for any caller that passed both.
  }) {
  const g = (v) => Number(v) || 0;

  switch (basis) {
    case 'final_weighted_value': {
      // What the meat was actually worth once weighed. Sum the lines, never take
      // a difference of totals — a total-minus-refund is where the stores
      // settlement bug (F-5's sibling) starts.
      const sum = items.reduce((acc, it) => acc + g(it.finalAmount), 0);
      return sum > 0 ? sum : Math.max(0, g(grandTotal) - g(refundedAmount));
    }

    case 'gross_order_value':
      return Math.max(0, g(grandTotal));

    case 'net_of_refunds':
      return Math.max(0, g(grandTotal) - g(refundedAmount));

    case 'fixed_monthly':
      return 0; // handled by the rule's flatAmount, not by a percentage

    default:
      // An unknown basis must not silently become a percentage of everything.
      // Returning the most conservative reading means a typo cannot overpay.
      return Math.max(0, g(grandTotal) - g(refundedAmount));
  }
}

/**
 * Split a revenue figure into the components a revenue-share basis names.
 *
 * Returned rather than summed inside the commission function so the payout
 * STATEMENT can itemise which component was counted — an operator disputing a
 * payout needs to see "product ₹840, delivery ₹60, packaging ₹20" and which of
 * those counted, not a single opaque number.
 *
 * ## Two independent axes, and conflating them was a real bug
 *
 *   `commissionBasis`  — WHAT revenue the commission is a percentage OF
 *                        (final_weighted_value | gross_order_value | net_of_refunds)
 *   `revenueShareBasis` — WHICH revenue components a SHARE agreement counts
 *                        (product_only | product_and_delivery | …)
 *
 * These are separate questions and both existed in the signature, but the first
 * version hard-coded `final_weighted_value` when resolving the product component
 * and ignored the argument. Every basis therefore computed identically, so a
 * partner configured for `gross_order_value` would have been paid commission on
 * revenue that had been refunded — the exact loss `final_weighted_value` exists to
 * prevent, silently reintroduced through the other two settings.
 *
 * @returns {{product: number, delivery: number, packaging: number, service: number, counted: number}}
 */
function revenueComponents({
  items = [],
  grandTotal = 0,
  refundedAmount = 0,
  deliveryFee = 0,
  packagingFee = 0,
  serviceFee = 0,
  commissionBasis = 'final_weighted_value',
  revenueShareBasis = 'product_only',
}) {
  const g = (v) => Number(v) || 0;

  // The commission basis decides what the PRODUCT revenue is. This is the line
  // that was previously hard-coded.
  const productRevenue = commissionableRevenue({
    items,
    grandTotal,
    refundedAmount,
    basis: commissionBasis,
  });

  const parts = {
    product: productRevenue,
    delivery: g(deliveryFee),
    packaging: g(packagingFee),
    service: g(serviceFee),
    counted: 0,
  };

  let counted = parts.product;
  if (REVENUE_SHARE_BASES.includes(revenueShareBasis)) {
    if (revenueShareBasis === 'product_and_delivery') counted += parts.delivery;
    else if (revenueShareBasis === 'product_and_packaging') counted += parts.packaging;
    else if (revenueShareBasis === 'product_delivery_and_service') {
      counted += parts.delivery + parts.service;
    }
  }

  parts.counted = counted;
  return parts;
}

/**
 * Commission earned on one order.
 *
 * ## Never returns a negative commission
 *
 * A heavily-refunded order must not produce a negative figure that a payout
 * statement then has to explain. Refunds reduce the BASE (§ `commissionableRevenue`);
 * they do not claw back commission already earned. Clawback is a separate,
 * explicit decision with a window — not something that falls out of arithmetic.
 *
 * @param {object} ruleSnapshot a frozen `JhatkaCommissionRule`
 * @param {object} order        the order's money fields
 * @returns {{
 *   revenue: number, components: object, commission: number,
 *   platformFee: number, refundDeduction: number, netAmount: number
 * }} all in RUPEES
 */
function computeCommission(ruleSnapshot, order) {
  const rule = ruleSnapshot || {};
  const g = (v) => Number(v) || 0;

  const revenueComponentsResult = revenueComponents({
    items: order.items || [],
    grandTotal: order.grandTotal ?? order.finalTotal ?? order.estimatedTotal,
    refundedAmount: order.refundedAmount,
    deliveryFee: order.deliveryFee,
    packagingFee: order.packagingFee,
    serviceFee: order.serviceFee,
    // Both axes, passed explicitly. `basis` is what the commission is a percentage
    // OF; `revenueShareBasis` is which components a share agreement counts.
    commissionBasis: rule.basis,
    revenueShareBasis: rule.revenueShareBasis,
  });

  const counted = revenueComponentsResult.counted;
  const rate = Number(rule.ratePercent) || 0;

  let commission;
  if (rule.basis === 'fixed_monthly') {
    commission = g(rule.flatAmount);
  } else {
    // Percentage-of-revenue is the one place a float is acceptable, and the
    // FLOOR is deliberate: rounding a partner's commission UP over a hundred
    // orders is a real, cumulative overpayment, and the paisa a rounding-down
    // costs is the correct trade.
    commission = Math.floor((counted * rate) / 100);
  }

  commission = Math.max(0, commission);

  const refundDeduction = g(order.refundedAmount);
  const platformFee = Math.floor((counted * (Number(rule.platformFeePercent) || 0)) / 100);

  // A minimum order threshold can void the commission entirely for a tiny order,
  // which is how a partner agreement with no payout floor actually behaves.
  const minOrder = g(rule.minimumOrderAmount);
  const qualifies = minOrder <= 0 || counted >= minOrder;
  if (!qualifies) commission = 0;

  return {
    revenue: counted,
    components: revenueComponentsResult,
    commission,
    platformFee,
    refundDeduction,
    netAmount: commission,
  };
}

/**
 * Whether a payout clears the bank, or rolls forward. §10.3.
 *
 * A ₹40 bank transfer costs more in fees and support time than the ₹40 is worth,
 * and a partner with nine such payouts gets nine transfers a month instead of one.
 * Below the floor, the balance carries.
 *
 * @returns {{ shouldPay: boolean, amount: number, reason: string }}
 */
function payoutDecision(netAmount, minimumNetPayout = 0) {
  const net = Number(netAmount) || 0;
  const floor = Number(minimumNetPayout) || 0;

  if (net < 0) {
    // Should be unreachable from computeCommission, which floors at zero. If it
    // ever happens it is a genuine anomaly and must not be paid.
    return { shouldPay: false, amount: 0, reason: 'negative_net_amount' };
  }
  if (net === 0) {
    return { shouldPay: false, amount: 0, reason: 'nothing_due' };
  }
  if (floor > 0 && net < floor) {
    return { shouldPay: false, amount: net, reason: 'below_minimum_payout_rolled_forward' };
  }
  return { shouldPay: true, amount: net, reason: 'payable' };
}

/**
 * TDS on a payout. §4.3.
 *
 * ## Why the field exists on day one
 *
 * Deducting TDS after payouts have been made means restating historical payouts
 * and issuing corrected statements. So the flag ships with the model even though it
 * defaults false — the assumption is that finance turns it on before the first
 * partner is paid, not after.
 *
 * ## Rate is a parameter, not a constant
 *
 * Indian TDS on partnership income is 5%, on certain professional services higher.
 * That is a finance answer, not an engineering one, so the rate arrives as an
 * argument and this function only does the arithmetic.
 *
 * @param {number} netAmount in RUPEES
 * @param {boolean} applicable
 * @param {number} ratePercent
 * @returns {{ grossAmount: number, tdsAmount: number, netPayout: number }}
 */
function computeTds(netAmount, applicable, ratePercent) {
  const net = Math.max(0, Number(netAmount) || 0);
  if (!applicable) {
    return { grossAmount: net, tdsAmount: 0, netPayout: net };
  }

  const rate = Number(ratePercent) || 0;
  // FLOORED. Under-deducting is a finance problem to correct; over-deducting takes
  // the partner's money without agreement and is a dispute.
  const tds = Math.floor((net * rate) / 100);

  return { grossAmount: net, tdsAmount: tds, netPayout: net - tds };
}

/**
 * Contribution margin. §10.5.
 *
 * ## The order of deductions is the entire point
 *
 * `grossOrderValue` is what customers were charged. What the business actually
 * made is that figure minus the cost of the meat, minus what was thrown away,
 * minus what the operator earned, minus delivery. Omitting any line makes margin
 * a different number, and each omission is a way this report is used to justify a
 * wrong decision:
 *
 *   - leave out `absorbedOverchargeTotal` → margin overstated by the cost of every
 *     over-delivery, which BR-06 makes a routine operating cost
 *   - leave out `wastageTotal` → margin overstated by the cost of the trim, which
 *     is real and which §5.6 goes to some trouble to measure
 *   - treat `taxCollected` as revenue → margin overstated by 5-12% instantly
 *
 * ## Never a subtraction of two accumulated money fields
 *
 * The inputs are summed here and the result is computed once. A service that reads
 * two stored `moneyField` totals and subtracts them inherits any drift in either,
 * and money fields are paise internally — a double conversion is silent.
 *
 * @param {object} t the totals object, all RUPEES
 * @returns {{ platformGrossRevenue: number, platformNetRevenue: number,
 *             contributionMargin: number, contributionMarginPct: number }}
 */
function contributionMargin(t = {}) {
  const g = (v) => Number(v) || 0;

  const grossOrderValue = g(t.grossOrderValue);
  const weightAdjustment = g(t.weightAdjustmentTotal);
  const absorbed = g(t.absorbedOverchargeTotal);
  const discount = g(t.discountTotal);
  const tax = g(t.taxCollected);
  const deliveryCollected = g(t.deliveryFeeCollected);
  const packagingCollected = g(t.packagingFeeCollected);

  // What we actually hold after giving back refunds and absorbed over-deliveries.
  const netCollections =
    grossOrderValue - weightAdjustment - absorbed - discount;

  const cogs = g(t.cogsTotal);
  const wastage = g(t.wastageTotal);
  const operatorPayout = g(t.operatorPayoutTotal);
  const deliveryCost = g(t.deliveryCostTotal);
  const supplierPayable = g(t.supplierPayableTotal);

  // Supplier payable IS the COGS. They are the same money seen from two sides, so
  // subtracting both would double-count every rupee of meat. `cogsTotal` is the
  // accepted-intake figure; `supplierPayableTotal` is what has been or is about to
  // be paid for it. The caller passes whichever it has, and this function takes
  // COGS as authoritative and treats the payable as informational.
  void supplierPayable;

  // ## Delivery and packaging are INSIDE grossOrderValue. They are NOT added.
  //
  // `grossOrderValue` is what the customer was charged in total — the order's
  // `finalTotal`, which already includes delivery and packaging. Adding them again
  // double-counts ₹4,500 on a ₹100,000 month, which is the single easiest way to
  // overstate revenue and it is why this line is written out rather than written
  // as `+ deliveryCollected + packagingCollected`.
  //
  // They are still accepted as inputs, because a caller reporting gross
  // REVENUE rather than gross COLLECTIONS needs to know what of it was a fee rather
  // than product — see `deliveryAndPackagingCarried`.
  const deliveryAndPackagingCarried = deliveryCollected + packagingCollected;

  // Gross revenue: what we collected, less the tax that was never ours. Product
  // revenue is therefore `grossRevenue − deliveryAndPackagingCarried`.
  const platformGrossRevenue = netCollections - tax;

  // Net revenue is gross minus the cost of goods and the operators who produced it.
  const platformNetRevenue = platformGrossRevenue - cogs - wastage - operatorPayout;

  const contributionMargin = platformNetRevenue - deliveryCost;

  return {
    platformGrossRevenue,
    platformNetRevenue,
    contributionMargin,
    deliveryAndPackagingCarried,
    productRevenue: platformGrossRevenue - deliveryAndPackagingCarried,
    contributionMarginPct:
      netCollections > 0
        ? Number(((contributionMargin / netCollections) * 100).toFixed(2))
        : 0,
  };
}

/**
 * Royalty for a franchise period. §10.4.
 *
 * Flat, not percentage — a franchise agreement's royalty is a fixed monthly fee and
 * treating it as a rate would be a different commercial product. The `frequency`
 * on the rule is about how often it is charged, not how it is computed.
 *
 * @returns {number} RUPEES
 */
function computeRoyalty(ruleSnapshot, monthsInPeriod = 1) {
  const royalty = ruleSnapshot?.royalty;
  if (!royalty) return 0;
  const rate = Math.max(0, Number(royalty.ratePercent) || 0);
  const months = Math.max(0, Number(monthsInPeriod) || 0);
  return Math.floor((rate * months) / 1);
}

/**
 * Franchise agreement activation checklist. §6, JH-03.
 *
 * A franchise outlet must not go live until the agreement is dated, every required
 * compliance document is valid, and the joining fee is paid. All three, not any
 * one. `JhatkaFranchise.canActivate()` returns the same shape.
 *
 * @returns {{ ok: boolean, blockers: string[] }}
 */
function franchiseActivationBlockers({
  agreementStartDate,
  agreementEndDate,
  now = new Date(),
  complianceDocuments = [],
  requiredDocuments = [],
  joiningFeePaid = false,
  status,
}) {
  const blockers = [];

  if (status !== 'pending' && status !== 'active') {
    blockers.push(`status_${status}`);
  }

  // No dated agreement means no enforceable territory and no agreed commercial
  // terms. This is the one blocker that cannot be waived by an admin click.
  if (!agreementStartDate) {
    blockers.push('agreement_missing');
  } else if (agreementEndDate && new Date(agreementEndDate) <= now) {
    blockers.push('agreement_expired');
  }

  const missing = requiredDocuments.filter((req) => {
    const doc = complianceDocuments.find((d) => d.type === req);
    return !doc || doc.status === 'expired' || doc.status === 'rejected' || !doc.status;
  });
  if (missing.length) blockers.push('compliance_missing:' + missing.join(','));

  if (!joiningFeePaid) blockers.push('joining_fee_unpaid');

  return { ok: blockers.length === 0, blockers };
}

module.exports = {
  REVENUE_SHARE_BASES,
  COMMISSION_BASES,
  commissionableRevenue,
  revenueComponents,
  computeCommission,
  contributionMargin,
  payoutDecision,
  computeTds,
  computeRoyalty,
  franchiseActivationBlockers,
};