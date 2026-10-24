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

function isOnLeaveRange(staff, startAt, endAt) {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return true;
  return (staff.leave || []).some((l) => {
    const from = new Date(l.from).getTime();
    const to = new Date(l.to).getTime();
    return from < end && to > start;
  });
}

function isQualified(staff, { serviceId, serviceKey } = {}) {
  if (!serviceId && !serviceKey) return true;
  if (!staff) return false;
  if (serviceId && (staff.services || []).some((id) => String(id) === String(serviceId))) return true;
  const key = String(serviceKey || '').toLowerCase();
  if (key && (staff.skills || []).some((skill) => String(skill).toLowerCase() === key)) return true;
  return false;
}

/** A shift covers a window inside one local calendar day. Overnight shifts wrap. */
function shiftCovers(shift, day, startMinutes, endMinutes) {
  const open = timeToMinutes(shift.start);
  const close = timeToMinutes(shift.end);
  if (Number(shift.day) === day) {
    if (close > open) return startMinutes >= open && endMinutes <= close;
    return startMinutes >= open && endMinutes <= 1440;
  }
  if (Number(shift.day) === (day + 6) % 7 && close <= open) {
    return startMinutes >= 0 && endMinutes <= close;
  }
  return false;
}

function isStaffAvailableForRange(staff, startAt, endAt) {
  if (!staff || staff.status !== 'active') return false;
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return false;
  if (isOnLeaveRange(staff, start, end)) return false;
  let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  while (cursor < end) {
    const dayStart = cursor.getTime();
    const next = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    const dayEnd = next.getTime();
    const windowStart = Math.max(start.getTime(), dayStart);
    const windowEnd = Math.min(end.getTime(), dayEnd);
    const startMinutes = Math.floor((windowStart - dayStart) / 60000);
    const endMinutes = Math.ceil((windowEnd - dayStart) / 60000);
    if (endMinutes > startMinutes && !(staff.shifts || []).some((s) => shiftCovers(s, cursor.getDay(), startMinutes, endMinutes))) {
      return false;
    }
    cursor = next;
  }
  return true;
}

function isCovered(coverage, { locality, pincode } = {}) {
  if (!coverage) return false;
  if (locality && (coverage.localities || []).map((x) => x.toLowerCase()).includes(String(locality).toLowerCase())) return true;
  if (pincode && (coverage.pincodes || []).includes(String(pincode))) return true;
  return false;
}

module.exports = { timeToMinutes, isOnLeave, isOnLeaveRange, isStaffAvailable, isStaffAvailableForRange, isQualified, shiftCovers, isCovered };
