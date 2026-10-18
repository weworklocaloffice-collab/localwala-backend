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
 * localservice.staff.service — pure availability math (no DB).
 * HH:MM string comparison is lexicographic-safe for zero-padded times.
 */
function timeToMinutes(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
}

function isOnLeave(staff, atDate) {
  const d = new Date(atDate).getTime();
  return (staff.leave || []).some((l) => d >= new Date(l.from).getTime() && d <= new Date(l.to).getTime());
}

function isStaffAvailable(staff, atDate) {
  if (!staff || staff.status !== 'active') return false;
  if (isOnLeave(staff, atDate)) return false;
  const d = new Date(atDate);
  const day = d.getDay();
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const shifts = (staff.shifts || []).filter((s) => s.day === day);
  if (!shifts.length) return false;
  return shifts.some((s) => hhmm >= s.start && hhmm < s.end);
}

function isCovered(coverage, { locality, pincode } = {}) {
  if (!coverage) return false;
  if (locality && (coverage.localities || []).map((x) => x.toLowerCase()).includes(String(locality).toLowerCase())) return true;
  if (pincode && (coverage.pincodes || []).includes(String(pincode))) return true;
  return false;
}

module.exports = { timeToMinutes, isOnLeave, isStaffAvailable, isCovered };
