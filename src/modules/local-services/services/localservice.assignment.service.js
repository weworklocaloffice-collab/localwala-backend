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
 * localservice.assignment.service — pure staff/resource allocation math.
 * DB queries stay in controllers; overlap and capacity decisions live here.
 */

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const { intervalsOverlap } = require('./localservice.availability.service');

function bookingWindow(booking, { service, offering } = {}) {
  const startValue = booking.startAt || booking.scheduledAt;
  if (!startValue) return null;
  const startAt = new Date(startValue);
  if (Number.isNaN(startAt.getTime())) return null;
  let endAt;
  if (booking.endAt) {
    endAt = new Date(booking.endAt);
  } else {
    const durationMinutes = Number(offering && offering.durationMinutes) || Number(service && service.baseDurationMinutes) || 60;
    endAt = new Date(startAt.getTime() + durationMinutes * 60000);
  }
  if (Number.isNaN(endAt.getTime()) || endAt <= startAt) return null;
  return { startAt, endAt };
}

function countAssignmentOverlaps(assignments = [], startAt, endAt, { bufferMinutes = 0, excludeBooking } = {}) {
  if (!startAt || !endAt) return 0;
  return assignments.filter((assignment) => {
    if ((assignment.status || 'assigned') !== 'assigned') return false;
    if (excludeBooking && String(assignment.booking) === String(excludeBooking)) return false;
    return intervalsOverlap(assignment.startAt, assignment.endAt, startAt, endAt, bufferMinutes);
  }).length;
}

function assertStaffFree(assignments, startAt, endAt, { excludeBooking } = {}) {
  if (countAssignmentOverlaps(assignments, startAt, endAt, { excludeBooking }) > 0) {
    throw new ApiError(httpStatus.CONFLICT, 'Staff is already allocated for this time');
  }
}

function assertResourceCapacity(assignments, startAt, endAt, { capacity = 1, bufferMinutes = 0, excludeBooking } = {}) {
  const used = countAssignmentOverlaps(assignments, startAt, endAt, { bufferMinutes, excludeBooking });
  if (used >= Math.max(1, Number(capacity) || 1)) {
    throw new ApiError(httpStatus.CONFLICT, 'Resource is already allocated for this time');
  }
}

module.exports = {
  bookingWindow,
  countAssignmentOverlaps,
  assertStaffFree,
  assertResourceCapacity,
};
