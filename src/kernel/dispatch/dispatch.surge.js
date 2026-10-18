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
 * dispatch.surge.js — surge pricing maths for the food vertical.
 *
 * Deliberately pure: no models, no database, no config. Same reasoning as
 * `dispatch.scoring.js` — any vertical with riders can require this file and
 * get the same quote, which is the point of putting it in the kernel rather
 * than inside the food dispatch service.
 *
 * ## What surge is and is not
 *
 * Surge is a *quote*, not a charge. `quoteDeliveryCharge()` answers "what
 * should the delivery fee be right now"; it never writes to an order. The
 * caller snapshots the answer onto `Orders.surgeMultiplier / surgeReason /
 * surgeAppliedAt` via `services/dispatch.service.js`, and checkout adoption
 * (actually charging the quoted fee) is a separate step. Setting a
 * restaurant's `deliveryConfig.surge` therefore never changes a charged total
 * by itself.
 *
 * ## The two signals
 *
 *   peak hours  the restaurant's own `surge.peakHours[]` — dinner rush is
 *               predictable and does not need a demand ratio to prove it.
 *   demand      pending un-assigned orders vs active riders. When orders
 *               pile up faster than riders free up, the fee rises to pay for
 *               the extra capacity being pulled in.
 *
 * Both are capped by `surge.multiplierCap` so a misconfigured threshold can
 * never produce a 10x fee.
 */

const DEFAULT_SURGE = Object.freeze({
  enabled: false,
  demandThreshold: 3,
  multiplierCap: 2.0,
  baseStep: 0.25,
  peakHours: Object.freeze([]),
});

const MIN_MULTIPLIER = 1.0;
const MAX_MULTIPLIER_HARD = 5.0;

const clamp = (n, lo, hi) => {
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
};

/**
 * Hour of day (0-23) for a timestamp. Defaults to server-local time, matching
 * how `DeliveryShiftSchedule` compares `HH:mm` strings elsewhere.
 *
 * @param {Date|string|number} [at]
 * @returns {number} 0..23
 */
const hourOf = (at) => {
  const d = at ? new Date(at) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().getHours();
  return d.getHours();
};

/**
 * Whether `hour` falls inside a peak window. Windows wrap midnight, so
 * `{ startHour: 22, endHour: 2 }` covers 22:00-01:59.
 *
 * @param {number} hour 0..23
 * @param {{startHour: number, endHour: number}} window
 * @returns {boolean}
 */
const isHourInWindow = (hour, window) => {
  const start = Number(window && window.startHour);
  const end = Number(window && window.endHour);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  const s = ((Math.floor(start) % 24) + 24) % 24;
  const e = ((Math.floor(end) % 24) + 24) % 24;
  if (s === e) return true;
  if (s < e) return h >= s && h < e;
  return h >= s || h < e;
};

/**
 * Peak-hour multiplier for this instant, or 1 when outside every window.
 *
 * @param {Array} peakHours
 * @param {Date|string|number} [at]
 * @returns {{multiplier: number, window: object|null}}
 */
const peakMultiplier = (peakHours, at) => {
  if (!Array.isArray(peakHours) || !peakHours.length) return { multiplier: 1, window: null };
  const h = hourOf(at);
  let best = { multiplier: 1, window: null };
  for (const w of peakHours) {
    if (!isHourInWindow(h, w)) continue;
    const m = Number(w.multiplier);
    if (Number.isFinite(m) && m > best.multiplier) best = { multiplier: m, window: w };
  }
  return best;
};

/**
 * Demand ratio: pending orders per active rider. `Infinity` when nobody is
 * online — which is exactly when surge matters most — and 0 when there is
 * nothing to deliver.
 *
 * @param {number} pendingOrders
 * @param {number} activeRiders
 * @returns {number}
 */
const demandRatio = (pendingOrders, activeRiders) => {
  const pending = Number(pendingOrders);
  const riders = Number(activeRiders);
  if (!Number.isFinite(pending) || pending <= 0) return 0;
  if (!Number.isFinite(riders) || riders <= 0) return Number.POSITIVE_INFINITY;
  return pending / riders;
};

/**
 * Demand multiplier. Each full `demandThreshold` of backlog above the first
 * adds one `baseStep`, so the fee climbs in predictable steps rather than
 * jumping.
 *
 * @param {number} pendingOrders
 * @param {number} activeRiders
 * @param {object} [policy]
 * @returns {{multiplier: number, ratio: number}}
 */
const demandMultiplier = (pendingOrders, activeRiders, policy = {}) => {
  const threshold =
    Number(policy.demandThreshold) > 0 ? Number(policy.demandThreshold) : DEFAULT_SURGE.demandThreshold;
  const step = Number(policy.baseStep) > 0 ? Number(policy.baseStep) : DEFAULT_SURGE.baseStep;
  const ratio = demandRatio(pendingOrders, activeRiders);
  if (!Number.isFinite(ratio) && ratio !== Number.POSITIVE_INFINITY) return { multiplier: 1, ratio: 0 };
  if (ratio === Number.POSITIVE_INFINITY) {
    return { multiplier: 1 + step * 2, ratio };
  }
  if (ratio <= threshold) return { multiplier: 1, ratio };
  const steps = Math.floor(ratio / threshold);
  return { multiplier: 1 + step * steps, ratio };
};

/**
 * Quote the surge multiplier for one restaurant at one instant.
 *
 * @param {object} [params]
 * @param {object} [params.policy]        `deliveryConfig.surge` (or {})
 * @param {Date|string|number} [params.at]
 * @param {number} [params.pendingOrders]
 * @param {number} [params.activeRiders]
 * @returns {{multiplier: number, reason: string, peak: object, demand: object}}
 */
const computeSurgeMultiplier = (params = {}) => {
  const policy = { ...DEFAULT_SURGE, ...(params.policy || {}) };
  if (policy.enabled !== true) {
    return { multiplier: 1, reason: 'surge_disabled', peak: { multiplier: 1 }, demand: { multiplier: 1 } };
  }

  const peak = peakMultiplier(policy.peakHours, params.at);
  const demand = demandMultiplier(params.pendingOrders, params.activeRiders, policy);
  const cap = clamp(
    Number(policy.multiplierCap) > 0 ? Number(policy.multiplierCap) : DEFAULT_SURGE.multiplierCap,
    MIN_MULTIPLIER,
    MAX_MULTIPLIER_HARD
  );

  const raw = Math.max(peak.multiplier, demand.multiplier, MIN_MULTIPLIER);
  const multiplier = Number(clamp(raw, MIN_MULTIPLIER, cap).toFixed(2));
  const reason =
    multiplier <= 1
      ? 'no_surge'
      : peak.multiplier >= demand.multiplier && peak.multiplier > 1
        ? 'peak_hours'
        : 'high_demand';

  return { multiplier, reason, peak, demand };
};

/**
 * Apply a quoted multiplier to a base fee.
 *
 * @param {number} baseCharge  in display units (rupees, not paise)
 * @param {number} multiplier from `computeSurgeMultiplier`
 * @param {number} [cap]
 * @returns {{charge: number, multiplier: number}}
 */
const quoteDeliveryCharge = (baseCharge, multiplier, cap = MAX_MULTIPLIER_HARD) => {
  const base = Number(baseCharge);
  if (!Number.isFinite(base) || base < 0) return { charge: 0, multiplier: 1 };
  const m = clamp(Number(multiplier), MIN_MULTIPLIER, Number(cap) > 0 ? Number(cap) : MAX_MULTIPLIER_HARD);
  return { charge: Number((base * m).toFixed(2)), multiplier: Number(m.toFixed(2)) };
};

module.exports = {
  DEFAULT_SURGE,
  MIN_MULTIPLIER,
  MAX_MULTIPLIER_HARD,
  hourOf,
  isHourInWindow,
  peakMultiplier,
  demandRatio,
  demandMultiplier,
  computeSurgeMultiplier,
  quoteDeliveryCharge,
};
