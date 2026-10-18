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

const kernelMath = require('../../../kernel/recurrence/occurrence.math');

/**
 * localservice.recurring.service — daily/alternate_days + kernel fallback.
 * Kernel handles weekly/biweekly/monthly; daily cadences live here (kernel
 * silently maps unknown -> +7d, which would corrupt daily tutoring).
 */
function nextDate(from, cadence, intervalCount = 1) {
  const d = new Date(from);
  if (cadence === 'daily') {
    d.setDate(d.getDate() + 1 * intervalCount);
    return d;
  }
  if (cadence === 'alternate_days') {
    d.setDate(d.getDate() + 2 * intervalCount);
    return d;
  }
  return kernelMath.nextOccurrence(d, cadence, intervalCount);
}

/**
 * Generate due occurrences. Idempotent: duplicate (agreement+date) hits E11000
 * and counts as alreadyPresent. Advance nextOccurrenceDate either way so one
 * failure never blocks the schedule (jhatka pattern).
 */
async function generateDueOccurrences(now = new Date(), { AgreementModel, OccurrenceModel, buildBooking } = {}) {
  const Agreement = AgreementModel || require('../models/localservice.recurring.agreement.model');
  const Occurrence = OccurrenceModel || require('../models/localservice.recurring.occurrence.model');
  const due = await Agreement.find({ status: 'active', nextOccurrenceDate: { $lte: now } });
  const out = { scanned: due.length, generated: 0, alreadyPresent: 0, failed: 0 };
  for (const ag of due) {
    const occDate = new Date(ag.nextOccurrenceDate);
    try {
      let bookingId = null;
      if (buildBooking) {
        const booking = await buildBooking(ag, occDate);
        bookingId = booking ? booking._id || booking.id : null;
      }
      await Occurrence.create({ agreement: ag._id, occurrenceDate: occDate, booking: bookingId || undefined, status: buildBooking ? 'generated' : 'scheduled' });
      out.generated += 1;
    } catch (e) {
      if (e && (e.code === 11000 || String(e.message || '').includes('unique'))) {
        out.alreadyPresent += 1;
      } else {
        out.failed += 1;
      }
    }
    // Advance either way (never stuck on a failed date).
    ag.nextOccurrenceDate = nextDate(occDate, ag.cadence, ag.intervalCount || 1);
    if (ag.endDate && ag.nextOccurrenceDate > new Date(ag.endDate)) ag.status = 'completed';
    try {
      await ag.save();
    } catch (e) {
      out.failed += 1;
    }
  }
  return out;
}

module.exports = { nextDate, generateDueOccurrences };
