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
 * localservice.policy.config.service — resolves the Admin-configurable
 * policy that governs a booking.
 *
 * The precedence mirrors revenue rules exactly:
 *
 *   provider(4) > service(3) > subcategory(2) > category(1) > platform(0)
 *
 * A value the CATALOGUE already carries for the service (`depositPercent`,
 * `allowedPaymentModes`) is more explicit than a category policy, so it
 * still wins. That keeps one rule of thumb: the nearest, most specific
 * configuration governs.
 *
 * Every value has a safe default, so a deployment with no policy rows
 * behaves exactly as it did before this existed.
 */

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

const POLICY_DEFAULTS = Object.freeze({
  cancellationCutoffHours: 24,
  cancellationFee: 0,
  providerCancellationRefundable: true,
  rescheduleCutoffHours: 24,
  rescheduleCountLimit: 3,
  quoteExpiryHours: 72,
  quoteMaxExpiryHours: 168,
  advanceBookingDays: 60,
  minNoticeHours: 0,
  depositPercent: 0,
  taxPercent: 0,
  taxLabel: 'Tax',
  allowedPaymentModes: [],
});

/**
 * Deterministic precedence, same ladder as revenue rules.
 */
function policySpecificity(policy, scope = {}) {
  if (policy.provider && String(policy.provider) === String(scope.provider || '')) return 4;
  if (policy.serviceKey) return 3;
  if (policy.subcategoryKey) return 2;
  if (policy.categoryKey) return 1;
  return 0;
}

/**
 * Pick the policy that governs a scope.
 *
 * @param {object[]} policies candidate policy rows
 * @param {object} scope { categoryKey, subcategoryKey, serviceKey, provider }
 * @param {Date} atDate when the booking happens
 */
function resolvePolicy(policies = [], scope = {}, atDate = new Date()) {
  const d = new Date(atDate);
  const eligible = (policies || []).filter((p) => {
    if (!p || p.status !== 'active') return false;
    if (p.effectiveFrom && d < new Date(p.effectiveFrom)) return false;
    if (p.effectiveTo && d >= new Date(p.effectiveTo)) return false;
    if (p.categoryKey && p.categoryKey !== (scope.categoryKey || null)) return false;
    if (p.subcategoryKey && p.subcategoryKey !== (scope.subcategoryKey || null)) return false;
    if (p.serviceKey && p.serviceKey !== (scope.serviceKey || null)) return false;
    if (p.provider) {
      if (!scope.provider) return false;
      if (String(p.provider) !== String(scope.provider)) return false;
    }
    return true;
  });
  if (!eligible.length) return null;
  eligible.sort(
    (a, b) =>
      policySpecificity(b, scope) - policySpecificity(a, scope) ||
      new Date(b.effectiveFrom || 0) - new Date(a.effectiveFrom || 0) ||
      (b.version || 1) - (a.version || 1)
  );
  return eligible[0];
}

/**
 * Merge a resolved policy with the defaults and the catalogue's own
 * (more specific) values.
 *
 * @param {object} policy resolved policy row or null
 * @param {object} catalogue { depositPercent, allowedPaymentModes } from the Service
 */
function buildEffectivePolicy(policy, catalogue = {}) {
  const base = { ...POLICY_DEFAULTS, ...(policy || {}) };
  const allowed = Array.isArray(catalogue.allowedPaymentModes) && catalogue.allowedPaymentModes.length
    ? catalogue.allowedPaymentModes
    : base.allowedPaymentModes;
  const catalogueDeposit = Number(catalogue.depositPercent);
  return {
    policyId: policy ? policy._id : null,
    policyCode: policy ? policy.code : null,
    policyVersion: policy ? policy.version || 1 : null,
    cancellationCutoffHours: Number(base.cancellationCutoffHours),
    cancellationFee: Number(base.cancellationFee || 0),
    providerCancellationRefundable: base.providerCancellationRefundable !== false,
    rescheduleCutoffHours: Number(base.rescheduleCutoffHours),
    rescheduleCountLimit: Number(base.rescheduleCountLimit),
    quoteExpiryHours: Number(base.quoteExpiryHours),
    quoteMaxExpiryHours: Number(base.quoteMaxExpiryHours),
    advanceBookingDays: Number(base.advanceBookingDays),
    minNoticeHours: Number(base.minNoticeHours),
    depositPercent: catalogueDeposit > 0 ? catalogueDeposit : Number(base.depositPercent || 0),
    taxPercent: Number(base.taxPercent || 0),
    taxLabel: base.taxLabel || 'Tax',
    allowedPaymentModes: allowed,
  };
}

/**
 * Load the effective policy for a scope.
 *
 * @param {object} scope { categoryKey, subcategoryKey, serviceKey, provider }
 * @param {object} catalogue { depositPercent, allowedPaymentModes }
 * @param {object} [deps] injectable model
 */
async function loadEffectivePolicy(scope = {}, catalogue = {}, { PolicyModel } = {}) {
  const Policy = PolicyModel || require('../models/localservice.policy.model');
  const rows = await Policy.find({ status: 'active' }).lean();
  const policy = resolvePolicy(rows, scope, new Date());
  return buildEffectivePolicy(policy, catalogue);
}

/**
 * Validate a requested quote expiry against the policy ceiling.
 *
 * A partner may ask for a shorter expiry than the default, never a longer
 * one. Without this a partner could hold a quote open for years.
 */
function assertQuoteExpiryWithinPolicy({ expiresAt, effectivePolicy, now = new Date() }) {
  const policy = effectivePolicy || POLICY_DEFAULTS;
  const maxHours = Number(policy.quoteMaxExpiryHours || POLICY_DEFAULTS.quoteMaxExpiryHours);
  const requested = new Date(expiresAt);
  if (Number.isNaN(requested.getTime())) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'expiresAt is not a valid date');
  }
  if (requested <= new Date(now)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Quote expiry must be in the future');
  }
  const maxAt = new Date(new Date(now).getTime() + maxHours * 3600000);
  if (requested > maxAt) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Quote expiry cannot exceed ${maxHours} hours`
    );
  }
  return requested;
}

/**
 * Validate a requested booking start against the advance window and the
 * minimum notice.
 */
function assertWithinBookingWindow({ scheduledAt, effectivePolicy, now = new Date() }) {
  const policy = effectivePolicy || POLICY_DEFAULTS;
  const start = new Date(scheduledAt);
  if (Number.isNaN(start.getTime())) return start;
  const current = new Date(now);
  if (start <= current) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Booking start must be in the future');
  }
  const minNotice = Number(policy.minNoticeHours || 0);
  if (minNotice > 0) {
    const earliest = new Date(current.getTime() + minNotice * 3600000);
    if (start < earliest) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Bookings need at least ${minNotice} hour(s) notice`);
    }
  }
  const advanceDays = Number(policy.advanceBookingDays || 0);
  if (advanceDays > 0) {
    const latest = new Date(current.getTime() + advanceDays * 86400000);
    if (start > latest) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Bookings cannot be made more than ${advanceDays} days ahead`);
    }
  }
  return start;
}

/**
 * Which payment channels a service may use, given the service's own list and
 * the policy's list.
 */
function allowedPaymentModesFor({ serviceModes, policyModes }) {
  const service = Array.isArray(serviceModes) ? serviceModes : [];
  const policy = Array.isArray(policyModes) ? policyModes : [];
  if (service.length) return service;
  return policy;
}

module.exports = {
  POLICY_DEFAULTS,
  resolvePolicy,
  buildEffectivePolicy,
  loadEffectivePolicy,
  assertQuoteExpiryWithinPolicy,
  assertWithinBookingWindow,
  allowedPaymentModesFor,
  policySpecificity,
};
