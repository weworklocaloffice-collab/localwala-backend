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
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const occurrenceMath = require('./occurrence.math');
const { buildIdempotencyKey } = require('./idempotency');

const generateDueOccurrences = async ({ vertical, entityType, dueSchedules, buildEntity }) => {
  const results = { generated: 0, skipped: 0, failed: 0 };

  for (const schedule of dueSchedules) {
    try {
      const occurrenceDate = new Date();
      const key = buildIdempotencyKey(vertical, entityType, schedule._id.toString(), occurrenceDate.toISOString().split('T')[0]);

      const existing = await mongoose.model('StoreRecurringOrder').findOne({
        subscription: schedule._id,
        occurrenceDate,
      });

      if (existing) {
        results.skipped += 1;
        continue;
      }

      const entity = await buildEntity(schedule, occurrenceDate);
      if (entity) {
        results.generated += 1;
      } else {
        results.skipped += 1;
      }
    } catch (error) {
      results.failed += 1;
    }
  }

  return results;
};

const advanceCursor = async (schedule, cadence, intervalCount = 1) => {
  schedule.nextOccurrenceDate = occurrenceMath.nextOccurrence(schedule.nextOccurrenceDate, cadence, intervalCount);
  schedule.lastOccurrenceDate = new Date();
  await schedule.save();
};

module.exports = {
  generateDueOccurrences,
  advanceCursor,
};