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
 * dispatch.scoring.js — how a delivery candidate is ranked.
 *
 * Deliberately pure: no models, no database, no config. Any vertical that has
 * riders can require this file and get the same ranking, which is the point of
 * putting it in the kernel rather than inside the food dispatch service.
 *
 * ## Why this is not just "nearest wins"
 *
 * Straight-line distance was the whole of the previous selection rule. That
 * ignores the three things that actually decide whether an order gets picked up:
 * whether the rider is already carrying orders, whether they are still fresh in a
 * shift, and whether they have a track record of accepting from this pool. A
 * rider 0.4 km away who is already at capacity loses to one 1.2 km away who is
 * idle — which is what `load` and `fatigue` are for.
 *
 * ## Why every factor is returned
 *
 * `explain()` returns the per-factor breakdown rather than a bare number. When a
 * vendor disputes why rider X was sent an order instead of rider Y, the stored
 * breakdown is the answer; an opaque score is not.
 */

/**
 * Default weights. They sum to 1 so a score reads as a 0..1 figure.
 *
 * `eta` dominates because the customer's wait is the only factor they ever see.
 * `load` is next: an over-committed rider silently stops responding, which is
 * the exact failure this whole engine exists to fix. `zoneAffinity` is small
 * on purpose — a soft nudge toward same-zone riders (less deadheading), never
 * a hard exclusion: a nearer cross-zone rider still wins on eta.
 */
const DEFAULT_WEIGHTS = Object.freeze({
  eta: 0.3,
  load: 0.25,
  rating: 0.15,
  fatigue: 0.1,
  fleetPriority: 0.1,
  reliability: 0.05,
  zoneAffinity: 0.05,
});

/** Straight-line km per hour. Deliberately pessimistic — real roads are slower. */
const CITY_SPEED_KMH = 18;

/** Minutes online after which fatigue starts to count, and again after a hard day. */
const FATIGUE_FREE_MINUTES = 240;
const FATIGUE_HEAVY_MINUTES = 600;

/** Clamp to 0..1 so one pathological input cannot dominate the sum. */
const clamp01 = (n) => {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
};

/**
 * ETA score. Linear decay over the search radius: at the edge of the radius a
 * candidate scores 0, at the restaurant itself a candidate scores 1.
 *
 * @param {number} distanceKm
 * @param {number} radiusKm
 * @returns {number} 0..1
 */
const etaScore = (distanceKm, radiusKm) => {
  if (!radiusKm || radiusKm <= 0) return 0;
  return clamp01(1 - distanceKm / radiusKm);
};

/**
 * Load score. A rider at zero active orders scores 1; at `maxOrderLimit`, 0.
 * Above capacity is still 0 — they are not a candidate, but the ranking should
 * degrade gracefully rather than produce a negative score.
 */
const loadScore = (orderHandling, maxOrderLimit) => {
  const cap = Number(maxOrderLimit) > 0 ? Number(maxOrderLimit) : 1;
  const load = Number(orderHandling);
  if (!Number.isFinite(load)) return 1;
  return clamp01(1 - load / cap);
};

/**
 * Rating score. Platform ratings are 0..5. An unrated rider (0) is treated as
 * average rather than worst — otherwise every new rider is starved of work and
 * never accumulates the rating that would let them be ranked.
 */
const ratingScore = (rating) => {
  const r = Number(rating);
  if (!Number.isFinite(r) || r <= 0) return 0.5;
  return clamp01(r / 5);
};

/**
 * Fatigue score from how long the rider's record has gone untouched, standing in
 * for "how long have they been on shift". 1 while fresh, tapering to 0 after a
 * full long day.
 *
 * @param {Date|string|number} updatedAt last write to the rider document
 */
const fatigueScore = (updatedAt) => {
  const ts = updatedAt ? new Date(updatedAt).getTime() : NaN;
  if (!Number.isFinite(ts)) return 0.5;
  const minutes = (Date.now() - ts) / 60000;
  if (minutes <= FATIGUE_FREE_MINUTES) return 1;
  return clamp01(1 - (minutes - FATIGUE_FREE_MINUTES) / (FATIGUE_HEAVY_MINUTES - FATIGUE_FREE_MINUTES));
};

/**
 * Fleet priority. A restaurant that pays its own riders has a commercial
 * interest in those riders being used, so own-fleet candidates outrank otherwise
 * identical platform riders. Policy, not physics — which is why it is a weight
 * and not a hard filter.
 */
const fleetPriorityScore = (isOwnFleet) => (isOwnFleet ? 1 : 0);

/**
 * Reliability. A rider who has already declined this specific order is penalised
 * so the cascade does not immediately re-offer to them on a later rung.
 */
const reliabilityScore = (priorRejects) => {
  const n = Number(priorRejects);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return clamp01(1 - n / 3);
};

/**
 * Zone affinity (Batch C-1). A rider heartbeat-tagged in the order's zone
 * outranks an otherwise identical rider from elsewhere — less deadheading,
 * more area familiarity. Soft by design: missing tags score neutral (0.5)
 * rather than 0, so zones improve ranking during rollout instead of punishing
 * riders the heartbeat hasn't tagged yet. Never a hard filter — a nearer
 * cross-zone rider still wins on eta.
 */
const zoneAffinityScore = (zoneId, orderZoneId) => {
  if (!zoneId || !orderZoneId) return 0.5;
  return String(zoneId) === String(orderZoneId) ? 1 : 0;
};

/**
 * Estimated minutes to arrival. Uses straight-line distance, so it is a ranking
 * signal and not a customer-facing promise — a real ETA needs a routing engine.
 *
 * @param {number} distanceKm
 * @returns {number} minutes
 */
const etaMinutes = (distanceKm) => Math.max(1, Math.round((distanceKm / CITY_SPEED_KMH) * 60));

/**
 * Score one candidate.
 *
 * @param {object} candidate
 * @param {number} candidate.distanceKm      straight-line distance from the kitchen
 * @param {number} candidate.orderHandling   active orders already carried
 * @param {number} candidate.maxOrderLimit   capacity from DriverSettings
 * @param {number} candidate.rating          0..5
 * @param {Date}   candidate.updatedAt       last rider-document write
 * @param {boolean} candidate.isOwnFleet     own-fleet vs platform pool
 * @param {number} [candidate.priorRejects]  declines already recorded for this order
 * @param {number} [candidate.radiusKm]      search radius for the eta decay
 * @param {string} [candidate.zoneId]        rider's heartbeat-tagged zone
 * @param {string} [candidate.orderZoneId]   customer-side zone of the order
 * @param {object} [weights]
 * @returns {{score: number, factors: object, etaMinutes: number}}
 */
const scoreCandidate = (candidate, weights = DEFAULT_WEIGHTS) => {
  const radiusKm = candidate.radiusKm > 0 ? candidate.radiusKm : candidate.distanceKm || 1;
  const factors = {
    eta: etaScore(candidate.distanceKm, radiusKm),
    load: loadScore(candidate.orderHandling, candidate.maxOrderLimit),
    rating: ratingScore(candidate.rating),
    fatigue: fatigueScore(candidate.updatedAt),
    fleetPriority: fleetPriorityScore(candidate.isOwnFleet),
    reliability: reliabilityScore(candidate.priorRejects),
    zoneAffinity: zoneAffinityScore(candidate.zoneId, candidate.orderZoneId),
  };

  let score = 0;
  for (const [key, weight] of Object.entries(weights)) {
    if (factors[key] !== undefined) {
      score += factors[key] * weight;
    }
  }

  return {
    score: Number(score.toFixed(6)),
    factors: Object.fromEntries(Object.entries(factors).map(([k, v]) => [k, Number(v.toFixed(4))])),
    etaMinutes: etaMinutes(candidate.distanceKm),
  };
};

/**
 * Rank candidates best-first. Ties break on distance so the result is stable and
 * reproducible — an unstable order would make the stored score unexplainable.
 *
 * @param {object[]} candidates
 * @param {object} [weights]
 * @returns {Array<object>} each entry gains `score`, `factors`, `etaMinutes`
 */
const rankCandidates = (candidates, weights = DEFAULT_WEIGHTS) =>
  candidates
    .map((c) => ({ ...c, ...scoreCandidate(c, weights) }))
    .sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm);

module.exports = {
  DEFAULT_WEIGHTS,
  CITY_SPEED_KMH,
  clamp01,
  etaScore,
  loadScore,
  ratingScore,
  fatigueScore,
  fleetPriorityScore,
  reliabilityScore,
  zoneAffinityScore,
  etaMinutes,
  scoreCandidate,
  rankCandidates,
};
