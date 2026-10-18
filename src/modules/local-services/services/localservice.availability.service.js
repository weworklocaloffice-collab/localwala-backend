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
 * DB layer checks `Reservation` intervals; this decides overlap incl. buffers.
 */
function intervalsOverlap(aStart, aEnd, bStart, bEnd, bufferMinutes = 0) {
  const s1 = new Date(aStart).getTime();
  const e1 = new Date(aEnd).getTime() + bufferMinutes * 60000;
  const s2 = new Date(bStart).getTime();
  const e2 = new Date(bEnd).getTime() + bufferMinutes * 60000;
  return s1 < e2 && s2 < e1;
}

function assertSlotFree(existing = [], startAt, endAt, bufferMinutes = 0) {
  for (const r of existing) {
    if (r.status !== 'held' && r.status !== 'confirmed') continue;
    if (intervalsOverlap(r.startAt, r.endAt, startAt, endAt, bufferMinutes)) {
      throw new ApiError(httpStatus.CONFLICT, 'Slot already reserved');
    }
  }
}

module.exports = { intervalsOverlap, assertSlotFree };
