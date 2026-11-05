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
 * delivery.fee.arithmetic.js — the two-band delivery fee, as pure maths.
 *
 * ## The bands (OD-12 companion, agreed with the business)
 *
 *   ≤ radiusKm                    → FREE (the outlet's normal service ring)
 *   radiusKm → +extendedRadiusKm  → extendedDeliveryFee (flat, per order)
 *   beyond the outer band         → NOT SERVICEABLE (refused, never priced)
 *
 * Every knob is a per-outlet DB value editable from the admin panel
 * (`serviceArea.radiusKm`, `serviceArea.extendedRadiusKm`,
 * `serviceArea.extendedDeliveryFee`, `orderConfig.deliveryFeeType`) bounded by
 * the platform's `Vertical.settings.maxRadiusKm` — nothing here is hardcoded
 * except the FALLBACKS for outlets that never configured the fields, which are
 * "free" (today's behaviour), so an unconfigured outlet behaves exactly as it
 * did before this file existed.
 *
 * ## Purity and units
 *
 * Pure functions only — the caller (quote, creation) owns the reads. Money is
 * PAISE out (`feePaise`); distances are KILOMETRES (one decimal). A missing or
 * unusable address location NEVER charges: the fallback is free, because
 * guessing a distance and billing on it is worse than not billing.
 */

const geographic = require('../../../kernel/geographic/services/geographic.service');

/**
 * Resolve the delivery fee for one address against one outlet's configuration.
 *
 * @param {object} p
 * @param {object} p.outlet            hydrated/lean outlet with `location`,
 *                                     `serviceArea`, `orderConfig`
 * @param {object} [p.addressLocation] GeoJSON Point from the saved address
 * @returns {{feePaise: number, distanceKm: number|null, band: string, serviceable: boolean, reason: string|null}}
 *          band ∈ 'inner_free' | 'outer_paid' | 'unserviced' | 'no_address'
 */
function resolveDeliveryFee({ outlet, addressLocation }) {
  const serviceArea = outlet?.serviceArea || {};
  const radiusKm = Number(serviceArea.radiusKm) > 0 ? Number(serviceArea.radiusKm) : 5;
  // An outlet that has never configured the outer band has none: the old
  // behaviour (refuse beyond radiusKm) is the default.
  const extendedRadiusKm = Number(serviceArea.extendedRadiusKm) || 0;
  const extendedFeePaise = Math.round(Number(serviceArea.extendedDeliveryFee || 0));

  if (!addressLocation || !Array.isArray(addressLocation.coordinates)) {
    // No usable location → never charge on a guess. Serviceability beyond the
    // plain radius cannot be proven either, so only the inner ring stands.
    return { feePaise: 0, distanceKm: null, band: 'no_address', serviceable: true, reason: null };
  }

  const outletCoords = outlet?.location?.coordinates;
  if (!Array.isArray(outletCoords)) {
    return { feePaise: 0, distanceKm: null, band: 'no_address', serviceable: true, reason: null };
  }

  const meters = geographic.haversineMeters(
    outletCoords[0], outletCoords[1],
    addressLocation.coordinates[0], addressLocation.coordinates[1],
  );
  const distanceKm = Math.round((meters / 1000) * 10) / 10;

  if (distanceKm <= radiusKm) {
    // The inner ring is free while `deliveryFeeType` is 'free' (the default).
    // A future 'flat' type would price here — deliberately a config, not an
    // assumption.
    const innerType = outlet?.orderConfig?.deliveryFeeType || 'free';
    const feePaise = innerType === 'free' ? 0 : extendedFeePaise;
    return { feePaise, distanceKm, band: 'inner_free', serviceable: true, reason: null };
  }

  if (extendedRadiusKm > 0 && distanceKm <= radiusKm + extendedRadiusKm) {
    return {
      feePaise: extendedFeePaise,
      distanceKm,
      band: 'outer_paid',
      serviceable: extendedFeePaise > 0,
      // A configured outer band with a ZERO fee is a misconfiguration: it
      // extends the promise for free by accident. Refused with the reason
      // rather than served free — fixing the config is the cure.
      reason: extendedFeePaise > 0 ? null : 'OUTER_BAND_ZERO_FEE',
    };
  }

  return {
    feePaise: 0,
    distanceKm,
    band: 'unserviced',
    serviceable: false,
    reason: 'OUT_OF_SERVICE_AREA',
  };
}

module.exports = { resolveDeliveryFee };
