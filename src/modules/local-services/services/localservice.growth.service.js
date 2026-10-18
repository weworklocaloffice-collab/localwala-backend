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
 * localservice.growth.service — pure helpers (no DB).
 * renewAt math + sponsored check. Revenue for plans/featured is recorded via
 * a SUBSCRIPTION/FEATURED RevenueEntry by the caller (manual or worker).
 */
function nextRenewAt(from, interval) {
  const d = new Date(from);
  if (interval === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

function isFeatured(placements = [], { providerId, serviceId } = {}, atDate = new Date()) {
  const d = new Date(atDate);
  return (placements || []).some((p) => {
    if (p.status !== 'active') return false;
    if (d < new Date(p.from) || d > new Date(p.to)) return false;
    if (providerId && p.provider && String(p.provider) === String(providerId)) return true;
    if (serviceId && p.service && String(p.service) === String(serviceId)) return true;
    return false;
  });
}

module.exports = { nextRenewAt, isFeatured };
