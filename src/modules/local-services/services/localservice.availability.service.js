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

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

/**
 * localservice.availability.service — pure overlap math (no DB).
 * DB layer checks `Reservation` intervals; this decides overlap incl. buffers,
 * capacity and whether a request sits inside the provider's working hours.
 */
function intervalsOverlap(aStart, aEnd, bStart, bEnd, bufferMinutes = 0) {
  const s1 = new Date(aStart).getTime();
  const e1 = new Date(aEnd).getTime() + bufferMinutes * 60000;
  const s2 = new Date(bStart).getTime();
  const e2 = new Date(bEnd).getTime() + bufferMinutes * 60000;
  return s1 < e2 && s2 < e1;
}

function isBlocking(reservation, now = new Date()) {
  if (!reservation) return false;
  if (reservation.status === 'confirmed') return true;
  if (reservation.status !== 'held') return false;
  if (!reservation.expiresAt) return true;
  return new Date(reservation.expiresAt).getTime() > new Date(now).getTime();
}

function countOverlaps(existing = [], startAt, endAt, bufferMinutes = 0, now = new Date()) {
  return existing.reduce(
    (count, r) =>
      isBlocking(r, now) && intervalsOverlap(r.startAt, r.endAt, startAt, endAt, bufferMinutes)
        ? count + 1
        : count,
    0
  );
}

function assertSlotFree(existing = [], startAt, endAt, bufferMinutes = 0, { capacity = 1, now = new Date() } = {}) {
  const used = countOverlaps(existing, startAt, endAt, bufferMinutes, now);
  if (used >= Math.max(1, Number(capacity) || 1)) {
    throw new ApiError(httpStatus.CONFLICT, 'Slot already reserved');
  }
}

function minutesOfDay(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function isWithinWorkingHours(rule, startAt, endAt) {
  if (!rule) return true;
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return false;
  if (Number(rule.day) !== start.getDay()) return false;
  const open = minutesOfDay(rule.open);
  const close = minutesOfDay(rule.close);
  if (open === null || close === null) return false;
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();
  if (close > open) return startMinutes >= open && endMinutes <= close;
  return startMinutes >= open || endMinutes <= close;
}

module.exports = {
  intervalsOverlap,
  isBlocking,
  countOverlaps,
  assertSlotFree,
  isWithinWorkingHours,
};
