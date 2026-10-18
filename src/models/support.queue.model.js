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
const { toJSON, paginate } = require('./plugins');

const supportQueueSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    skills: {
      type: [String],
      default: [],
    },
    members: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'User',
      },
    ],
    wipLimit: {
      type: Number,
      default: 10,
    },
    roundRobinPointer: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Staffed hours for SLA. `days` is `{ mon: [[540, 1080]], ... }` with
    // minutes-from-midnight windows; empty or absent means 24x7, which is the
    // legacy behaviour and needs no migration.
    workingHours: {
      type: {
        timezone: { type: String, default: 'Asia/Kolkata' },
        days: { type: mongoose.Schema.Types.Mixed, default: {} },
      },
      default: () => ({ timezone: 'Asia/Kolkata', days: {} }),
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

supportQueueSchema.plugin(toJSON);
supportQueueSchema.plugin(paginate);
supportQueueSchema.index({ isActive: 1 });

/**
 * @typedef SupportQueue
 */
const SupportQueue = mongoose.model('SupportQueue', supportQueueSchema);

module.exports = SupportQueue;
