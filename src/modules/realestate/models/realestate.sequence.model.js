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

const mongoose = require('mongoose');

const sequenceSchema = mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);

sequenceSchema.index({ key: 1 }, { unique: true });

/**
 * Atomic per-series counters (invoice numbering, case numbers, …).
 * `findOneAndUpdate` with `$inc` + upsert is a single atomic step, so
 * concurrent issuers never share a number. Numbers are monotonic per
 * key, never reused.
 */
async function next(key) {
  const doc = await mongoose
    .model('RealEstateSequence')
    .findOneAndUpdate({ key }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return doc.seq;
}

const RealEstateSequence = mongoose.model('RealEstateSequence', sequenceSchema);

module.exports = RealEstateSequence;
module.exports.next = next;
