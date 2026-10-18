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

const { toGrams, gramsPerUnit } = require('../utils/quantity');

/**
 * The variable-weight arithmetic. §3.5. Pure, and the only place these rules live.
 *
 * ## The three rules this module exists to enforce
 *
 *   1. **Refund-only.** The customer is never charged above the estimate. BR-06.
 *      Upward variance is absorbed by the platform; there is no code path that
 *      produces a positive customer charge.
 *   2. **Inside the tolerance band, no financial event at all.** BR-07. The
 *      amount is recorded for analytics but no refund document is created.
 *   3. **A shortfall beyond the hard floor refunds automatically.** BR-21.
 *      Under-delivery is not a support ticket.
 *
 * ## Why this is a pure module and not service code
 *
 * Every number in the vertical that decides money flows through here. Pure
 * functions mean the rules are unit-testable with no database, no Mongoose and no
 * fixtures, and it makes an accidental second implementation — the classic way a
 * weight rule diverges between the order service and the settlement service —
 * visible in review rather than in production.
 *
 * ## Floor, never round-half-up
 *
 * `Math.floor` on every money figure. Rounding UP at any step means the customer
 * is overcharged by a paisa on some lines and it compounds across a cart. Flooring
 * is the conservative choice in both directions: the customer is never charged more
 * than the stated rate.
 */

/** Paise per rupee. Money is paise everywhere inside this module. */
const PAISE = 100;

/**
 * Line price in paise for a quantity.
 *
 * The division by `gramsPerUnit` is the `per_kg` → per-gram conversion: ₹400 per
 * 1000 g is 40 paise per gram. For a COUNT basis the quantity IS the price
 * quantity and the conversion factor is 1.
 *
 * @param {{value: number, unit: string}} qty
 * @param {number} unitPricePaise rate, in paise, per price unit
 * @param {string} priceBasis one of per_kg | per_g | per_piece | per_dozen | per_pack | per_tier
 * @returns {number} integer paise, floored
 */
function linePricePaise(qty, unitPricePaise, priceBasis) {
  const rate = Number(unitPricePaise) || 0;

  switch (priceBasis) {
    case 'per_kg': {
      const grams = toGrams(qty);
      return Math.floor((grams * rate) / 1000);
    }
    case 'per_g': {
      const grams = toGrams(qty);
      return Math.floor((grams * rate) / 1);
    }
    default:
      // per_piece, per_dozen, per_pack, per_tier — the count IS the price count.
      return Math.floor(qty.value * rate);
  }
}

/**
 * The core of §3.3: what happens when the scale disagrees with the estimate.
 *
 * Pure. Returns everything the caller needs to write the refund document and
 * decide whether a manager override is required — and nothing it must not do
 * itself, because this function never touches the database.
 *
 * @param {object} args
 * @param {{value:number,unit:string}} args.requestedQty  what the customer asked for
 * @param {{value:number,unit:string}} args.actualQty      what the scale read
 * @param {number} args.unitPricePaise                     rate in paise per price unit
 * @param {string} args.priceBasis                         price basis
 * @param {object} args.policy                             { tolerancePct, hardOverchargePct, hardShortfallPct }
 * @returns {{
 *   isVariableWeight: boolean,
 *   estimatedAmountPaise: number,
 *   finalAmountPaise: number,
 *   deltaPaise: number,
 *   direction: 'none'|'absorbed'|'refund_required'|'override_required',
 *   withinTolerance: boolean,
 *   exceedsHardOvercharge: boolean,
 *   breachesShortfallFloor: boolean,
 *   ratio: number|null,
 *   variancePct: number|null,
 *   refundablePaise: number,
 *   note: string
 * }}
 */
function reconcileWeight({
  requestedQty,
  actualQty,
  unitPricePaise,
  priceBasis,
  policy,
}) {
  const tolerancePct = Number(policy?.tolerancePct ?? 5);
  const hardOverPct = Number(policy?.hardOverchargePct ?? 10);
  const hardShortPct = Number(policy?.hardShortfallPct ?? 2);

  const estimatedAmountPaise = linePricePaise(requestedQty, unitPricePaise, priceBasis);
  const finalAmountPaise = linePricePaise(actualQty, unitPricePaise, priceBasis);
  const deltaPaise = finalAmountPaise - estimatedAmountPaise;

  // Convert both sides to grams for a unit-agnostic ratio. A customer asking in KG
  // and a scale reporting in GRAM must produce the same variance, or the same
  // physical deviation reads as 0% to one and 1000% to the other.
  const reqGrams = toGrams(requestedQty);
  const actGrams = toGrams(actualQty);
  const ratio = reqGrams > 0 ? actGrams / reqGrams : null;

  const variancePct = ratio === null ? 0 : Number(((ratio - 1) * 100).toFixed(2));

  const withinTolerance = Math.abs(variancePct) <= tolerancePct;
  const exceedsHardOvercharge = variancePct > hardOverPct;
  /**
   * The floor is a magnitude, not a signed variance: `hardShortfallPct: 2` means
   * "2% short", i.e. `variancePct <= -2`.
   *
   * Comparing the signed variance against the negated floor looks right and is
   * off by one at the boundary — `-2 < -2` is false, so an order that is exactly
   * 2% short does not flag. It only gets worse the closer to the boundary you go,
   * and a 2% shortfall on a 1 kg pack is a routine occurrence, not an edge case.
   */
  const breachesShortfallFloor = -variancePct >= hardShortPct;

  // BR-07 first: inside the band, no FINANCIAL event happens.
  //
  // Note what is still computed and returned here: `exceedsHardOvercharge` and
  // `breachesShortfallFloor`. A 2% shortfall on a 5% tolerance band produces no
  // refund — correct — but it DOES breach the outlet's 2% shortfall guarantee, and
  // that breach has to reach the short-delivery report. Hard-coding these to false
  // in the early return silently swallows it, which is the kind of bug that only
  // shows up as "why does the variance report look empty".
  if (withinTolerance) {
    return {
      isVariableWeight: true,
      estimatedAmountPaise,
      finalAmountPaise,
      deltaPaise,
      direction: 'none',
      withinTolerance: true,
      exceedsHardOvercharge,
      breachesShortfallFloor,
      ratio,
      variancePct,
      refundablePaise: 0,
      note: breachesShortfallFloor
        ? `variance ${variancePct}% is inside the ${tolerancePct}% band so no financial event (BR-07), but it breaches the ${hardShortPct}% shortfall guarantee`
        : `variance ${variancePct}% is inside the ${tolerancePct}% band — no financial event (BR-07)`,
    };
  }

  // BR-08: above the hard cap the confirmation is REFUSED without an override.
  // Checked BEFORE the absorb branch, because an override is a manager decision
  // about possibly-theft rather than an accounting adjustment.
  if (exceedsHardOvercharge) {
    return {
      isVariableWeight: true,
      estimatedAmountPaise,
      finalAmountPaise,
      deltaPaise,
      direction: 'override_required',
      withinTolerance: false,
      exceedsHardOvercharge: true,
      breachesShortfallFloor: false,
      ratio,
      variancePct,
      refundablePaise: 0,
      note: `${variancePct}% over the requested weight exceeds the ${hardOverPct}% cap — manager override required (BR-08)`,
    };
  }

  // BR-06: upward variance outside the band is absorbed. Never charged.
  if (deltaPaise > 0) {
    return {
      isVariableWeight: true,
      estimatedAmountPaise,
      finalAmountPaise,
      deltaPaise,
      direction: 'absorbed',
      withinTolerance: false,
      exceedsHardOvercharge: false,
      breachesShortfallFloor: false,
      ratio,
      variancePct,
      refundablePaise: 0,
      note: `${variancePct}% over — absorbed by LocalWala, charged to nobody (BR-06)`,
    };
  }

  // BR-21: under-delivery refunds automatically, with or without a support ticket.
  return {
    isVariableWeight: true,
    estimatedAmountPaise,
    finalAmountPaise,
    deltaPaise,
    direction: 'refund_required',
    withinTolerance: false,
    exceedsHardOvercharge: false,
    breachesShortfallFloor,
    ratio,
    variancePct,
    // Positive. The refund amount is the shortfall, and the shortfall can never
    // exceed the estimate itself.
    refundablePaise: Math.min(Math.abs(deltaPaise), estimatedAmountPaise),
    note: breachesShortfallFloor
      ? `${variancePct}% under, past the ${hardShortPct}% floor — automatic refund and a short-delivery flag (BR-21)`
      : `${variancePct}% under the requested weight — automatic refund (BR-21)`,
  };
}

/**
 * Tax on a weight adjustment, computed from the FROZEN snapshot.
 *
 * BR-20: the rate comes from `order.taxSnapshot`, never from `TaxConfiguration`.
 * A refund whose tax component is recomputed from today's rate produces an
 * invoice that disagrees with the original, and the customer's refund is either
 * short by a few paisa or over by a few paisa, both of which are real.
 *
 * `refundablePaise` here is PRE-TAX. The customer paid tax on the estimate, so the
 * reversal is proportional to the shortfall.
 *
 * @param {number} refundablePreTaxPaise
 * @param {number} taxRatePct  e.g. 5 for 5%
 * @returns {{taxReversalPaise: number, netRefundPaise: number}}
 */
function taxOnAdjustment(refundablePreTaxPaise, taxRatePct) {
  const rate = Number(taxRatePct) || 0;
  const pre = Math.max(0, Number(refundablePreTaxPaise) || 0);
  const tax = Math.round((pre * rate) / 100);
  return {
    taxReversalPaise: tax,
    // The pre-tax shortfall plus the proportional tax reversal.
    netRefundPaise: pre + tax,
  };
}

/**
 * The ceiling a prepaid subscription occurrence charges. BR-16, §9.5.
 *
 * A subscription occurrence for a variable-weight item has the same unknown-final-
 * amount problem as an order, except a refund per occurrence is operationally
 * unacceptable — a weekly subscription with a weekly refund has a refund rate, a
 * refund SLA, a reconciliation queue and a failed-refund backlog. So the ceiling
 * is charged and NOT reconciled per occurrence.
 *
 * @param {{value:number,unit:string}} qty
 * @param {number} unitPricePaise
 * @param {string} priceBasis
 * @param {number} ceilingPct
 * @returns {number} paise to charge
 */
function subscriptionCeilingPaise(qty, unitPricePaise, priceBasis, ceilingPct = 10) {
  const base = linePricePaise(qty, unitPricePaise, priceBasis);
  return Math.floor((base * (100 + Number(ceilingPct || 0))) / 100);
}

/**
 * What a rider may collect on a COD order. §3.6.
 *
 * The customer has paid nothing, so there is nothing to refund and nothing to top
 * up: they pay `min(ceiling, actual)`.
 *
 * ## The ceiling is what keeps this inside BR-06
 *
 * `ceiling = estimate × (1 + codTolerancePct)` is the highest the rider may ask
 * for, and it is deliberately ABOVE the estimate. That is what absorbs an
 * over-delivery at the door: the butcher weighed 1.08 kg of a 1 kg order, the
 * customer pays the estimate, and the difference never becomes a demand.
 *
 * Without it the arithmetic is a trap. `min(estimate, actual)` would work perfectly
 * for under-delivery and then hand the rider ₹432 on a ₹400 order — the customer
 * pays MORE than they agreed to, by cash, at their door, with no document behind
 * it. That is the exact failure BR-06 exists to prevent, and it is why the ceiling
 * is a separate figure from the estimate rather than the estimate itself.
 *
 * @param {number} estimatedAmountPaise
 * @param {number} finalAmountPaise
 * @param {number} codTolerancePct
 * @returns {number} paise the rider collects
 */
function codCollectablePaise(estimatedAmountPaise, finalAmountPaise, codTolerancePct = 10) {
  const ceiling = Math.floor((estimatedAmountPaise * (100 + Number(codTolerancePct || 0))) / 100);
  return Math.max(0, Math.min(ceiling, finalAmountPaise));
}

/**
 * The ceiling a COD order may collect up to, in paise. Exposed separately so the
 * delivery screen can SHOW the rider the number rather than have them compute it.
 *
 * @param {number} estimatedAmountPaise
 * @param {number} codTolerancePct
 * @returns {number}
 */
function codCeilingPaise(estimatedAmountPaise, codTolerancePct = 10) {
  return Math.floor((estimatedAmountPaise * (100 + Number(codTolerancePct || 0))) / 100);
}

/**
 * Does an order carry any variable-weight line?
 *
 * A COUNT-only order has a final amount the moment it is placed and never enters
 * the weighing flow. This is what VW-07 in the test matrix turns into a route
 * guard.
 *
 * @param {Array<{isVariableWeight?: boolean}>} items
 * @returns {boolean}
 */
function hasVariableWeightLine(items) {
  return Array.isArray(items) && items.some((i) => i && i.isVariableWeight === true);
}

/**
 * Paise → rupees, floored to 2dp, for an API response.
 *
 * The read side of `moneyField`. Every figure leaving this module as a number in a
 * JSON body has passed through here, so a client never receives paise labelled as
 * rupees.
 *
 * @param {number} paise
 * @returns {number}
 */
function toRupees(paise) {
  return Number((Math.floor(Number(paise) || 0) / PAISE).toFixed(2));
}

module.exports = {
  PAISE,
  linePricePaise,
  reconcileWeight,
  taxOnAdjustment,
  subscriptionCeilingPaise,
  codCollectablePaise,
  codCeilingPaise,
  hasVariableWeightLine,
  toRupees,
  gramsPerUnit,
};