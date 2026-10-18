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

const { toPaise, fromPaise } = require('../../../utils/money');
const ApiError = require('../../../utils/ApiError');
const { status: httpStatus } = require('http-status');

/**
 * localservice.revenue.service — SOLE authority for Local Services money.
 *
 * Rules:
 * - Rupees at edges, paise inside. All arithmetic in integer paise.
 * - Toggles enforced HERE, not in UI: bookingFeeEnabled OFF => fee 0,
 *   commissionEnabled OFF => commission 0. Four combos supported.
 * - Only `status:'active'` + in-force rules apply. Draft/pending/suspended never.
 * - Lead-fee-only rule must not compute commission (validated).
 * - Every result carries ruleSnapshot so history is immutable.
 */

const toPaiseInt = (rupees) => toPaise(Number(rupees) || 0);

function resolveEligibleBase(rule, amounts = {}) {
  const labour = toPaiseInt(amounts.labourAmount);
  const parts = toPaiseInt(amounts.partsAmount);
  const serviceValue = toPaiseInt(amounts.serviceValue);
  const collected = toPaiseInt(amounts.collectedAmount);
  const bookingValue = toPaiseInt(amounts.bookingValue);
  switch (rule.calculationBasis) {
    case 'LABOUR_ONLY':
      return labour;
    case 'SERVICE_VALUE':
      // SERVICE_VALUE = labour + parts only when partsCommissionable, else labour.
      return rule.partsCommissionable ? labour + parts : labour;
    case 'ELIGIBLE_COLLECTED_AMOUNT':
      return collected || serviceValue || labour;
    case 'BOOKING_VALUE':
      return bookingValue || serviceValue || labour + parts;
    case 'QUALIFIED_LEAD':
      return 0;
    default:
      return labour;
  }
}

function validateRuleCompatible(rule) {
  if (rule.revenueModel === 'LEAD_FEE' && rule.commissionEnabled) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Lead-fee-only rule must not enable commission');
  }
  // Combined-model representation (§14-B): the two toggles are independent and
  // each must agree with the declared model, so a rule can never silently
  // charge a component its model disclaims — or disclaim one it charges.
  if (rule.revenueModel === 'BOOKING_FEE' && !rule.bookingFeeEnabled) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'BOOKING_FEE model requires booking fee ON');
  }
  if (rule.revenueModel === 'BOOKING_FEE' && rule.commissionEnabled) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'BOOKING_FEE model must not enable commission (use COMBINED)');
  }
  if (rule.revenueModel === 'COMMISSION' && !rule.commissionEnabled) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'COMMISSION model requires commission ON');
  }
  if (rule.revenueModel === 'COMMISSION' && rule.bookingFeeEnabled) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'COMMISSION model must not enable booking fee (use COMBINED)');
  }
  // COMBINED permits any toggle combination INCLUDING both OFF (booking
  // proceeds with neither charge — the mandatory OFF+OFF case). Single-model
  // rules must match their component so neither over- nor under-charges.
  if (rule.revenueModel === 'LEAD_FEE' && !rule.bookingFeeEnabled) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'LEAD_FEE model carries the lead price in the fee field (fee ON)');
  }
}

function assertRuleUsable(rule, atDate = new Date()) {
  if (!rule) throw new ApiError(httpStatus.NOT_FOUND, 'No revenue rule resolved');
  if (rule.status !== 'active') {
    throw new ApiError(httpStatus.BAD_REQUEST, `Rule ${rule.code} is not active (${rule.status})`);
  }
  const from = new Date(rule.effectiveFrom);
  const to = rule.effectiveTo ? new Date(rule.effectiveTo) : null;
  const d = new Date(atDate);
  if (d < from || (to && d >= to)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Rule ${rule.code} not in force on ${d.toISOString()}`);
  }
  validateRuleCompatible(rule);
}

/**
 * Pure calculation — no DB, fully unit-testable. Amounts in RUPEES.
 * Returns paise-safe rupee figures + snapshot.
 */
function calculateRevenue(ruleLike, amounts = {}, opts = {}) {
  const rule = ruleLike && typeof ruleLike.toSnapshot === 'function' ? ruleLike : ruleLike;
  assertRuleUsable(rule, opts.atDate);
  validateRuleCompatible(rule);

  const labourPaise = toPaiseInt(amounts.labourAmount);
  const partsPaise = toPaiseInt(amounts.partsAmount);
  const discountPaise = toPaiseInt(amounts.discountAmount);

  // --- Booking fee toggle ---
  const feePaise = rule.bookingFeeEnabled ? toPaiseInt(rule.bookingFee) : 0;

  // --- Commission toggle ---
  let commissionPaise = 0;
  let basePaise = 0;
  if (rule.commissionEnabled && rule.revenueModel !== 'BOOKING_FEE' && rule.revenueModel !== 'LEAD_FEE') {
    basePaise = resolveEligibleBase(rule, amounts);
    if (rule.commissionType === 'fixed') {
      commissionPaise = toPaiseInt(rule.commissionFixedAmount);
    } else {
      commissionPaise = Math.round((basePaise * Number(rule.commissionRatePercent || 0)) / 100);
    }
    const minPaise = toPaiseInt(rule.minimumCharge);
    const maxPaise = toPaiseInt(rule.maximumCharge);
    if (minPaise > 0 && commissionPaise < minPaise) commissionPaise = minPaise;
    if (maxPaise > 0 && commissionPaise > maxPaise) commissionPaise = maxPaise;
  } else if (rule.revenueModel === 'LEAD_FEE') {
    basePaise = 0;
    commissionPaise = 0;
  }

  const platformPaise = feePaise + commissionPaise;
  // Provider keeps labour minus commission (parts pass through; discount reduces labour base already at booking layer).
  const providerPaise = Math.max(0, labourPaise - commissionPaise);
  const customerPaise = labourPaise + partsPaise + feePaise - Math.min(discountPaise, labourPaise + partsPaise);

  const snapshot =
    ruleLike && typeof ruleLike.toSnapshot === 'function'
      ? ruleLike.toSnapshot()
      : {
          code: rule.code,
          version: rule.version,
          bookingFeeEnabled: rule.bookingFeeEnabled,
          commissionEnabled: rule.commissionEnabled,
          calculationBasis: rule.calculationBasis,
          commissionRatePercent: rule.commissionRatePercent,
          frozenAt: new Date(),
        };

  return {
    bookingFee: fromPaise(feePaise),
    commissionBase: fromPaise(basePaise),
    commissionAmount: fromPaise(commissionPaise),
    customerTotal: fromPaise(customerPaise),
    providerPayable: fromPaise(providerPaise),
    platformRevenue: fromPaise(platformPaise),
    labourAmount: fromPaise(labourPaise),
    partsAmount: fromPaise(partsPaise),
    ruleSnapshot: snapshot,
    _paise: { feePaise, basePaise, commissionPaise, customerPaise, providerPaise, platformPaise },
  };
}

/**
 * Deterministic precedence: provider(4) > service(3) > subcategory(2) >
 * category(1) > platform(0). Ties broken by latest effectiveFrom.
 */
function resolveRule(rules = [], scope = {}, atDate = new Date()) {
  const d = new Date(atDate);
  const eligible = (rules || []).filter((r) => {
    if (!r || r.status !== 'active') return false;
    if (d < new Date(r.effectiveFrom)) return false;
    if (r.effectiveTo && d >= new Date(r.effectiveTo)) return false;
    if (r.categoryKey && r.categoryKey !== (scope.categoryKey || null)) return false;
    if (r.subcategoryKey && r.subcategoryKey !== (scope.subcategoryKey || null)) return false;
    if (r.serviceKey && r.serviceKey !== (scope.serviceKey || null)) return false;
    if (r.provider && String(r.provider) !== String(scope.provider || '')) {
      // rule bound to a different provider — skip; platform/category rules (no provider) still match
      if (scope.provider) return false;
    }
    // A provider-scoped rule only matches its own provider
    if (r.provider && !scope.provider) return false;
    return true;
  });
  if (!eligible.length) return null;
  const spec = (r) => {
    if (r.provider && String(r.provider) === String(scope.provider || '')) return 4;
    if (r.serviceKey) return 3;
    if (r.subcategoryKey) return 2;
    if (r.categoryKey) return 1;
    return 0;
  };
  eligible.sort((a, b) => spec(b) - spec(a) || new Date(b.effectiveFrom) - new Date(a.effectiveFrom));
  return eligible[0];
}

function buildIdempotencyKey(bookingId, ruleCode, ruleVersion) {
  return `lsrev:${bookingId}:${ruleCode}:v${ruleVersion}`;
}

module.exports = {
  resolveEligibleBase,
  validateRuleCompatible,
  assertRuleUsable,
  calculateRevenue,
  resolveRule,
  buildIdempotencyKey,
};
