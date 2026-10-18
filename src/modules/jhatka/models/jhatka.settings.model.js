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
const { toJSON } = require('../../../models/plugins');

/**
 * Jhatka platform settings — the `jhatka_settings` tab in Business Setup.
 *
 * Follows the same shape as `dairy.settings.model`: one singleton document,
 * every field optional with a default, guarded by a service that allows only
 * one to exist.
 *
 * ## Every field here is read
 *
 * The other verticals carry knobs that are stored and never read, which trains
 * operators to expect settings to do nothing. Each field below names its
 * reader, and each reader falls back to the default below when no document
 * exists — so behavior is identical until an admin saves, and every save
 * takes effect on the next request.
 *
 * - weightTolerancePct / weightHardOverchargePct / weightHardShortfallPct:
 *   read by `resolvePolicy` in `jhatka.weigh.service.js`, behind category and
 *   outlet (BR-07/BR-08).
 * - subscriptionCeilingPct: read by `jhatka.subscription.service.js` behind
 *   the entry and variant values (BR-16).
 * - editCutoffHours: read by `jhatka.subscription.service.js` behind
 *   `sub.editCutoffHours` (§9.7).
 * - codTolerancePct: read by `resolveCodTolerance` in `jhatka.weigh.service.js`
 *   behind the category value (§3.6).
 * - maxTransitMinutes: read by the dispatch route behind
 *   `outlet.qualityPolicy.maxTransitMinutes` (BR-12).
 */
const jhatkaSettingsSchema = mongoose.Schema(
  {
    weightTolerancePct: {
      type: Number,
      required: false,
      default: 5,
      min: 0,
      max: 100,
    },
    weightHardOverchargePct: {
      type: Number,
      required: false,
      default: 10,
      min: 0,
      max: 100,
    },
    weightHardShortfallPct: {
      type: Number,
      required: false,
      default: 2,
      min: 0,
      max: 100,
    },
    subscriptionCeilingPct: {
      type: Number,
      required: false,
      default: 10,
      min: 0,
      max: 100,
    },
    editCutoffHours: {
      type: Number,
      required: false,
      default: 12,
      min: 0,
      max: 168,
    },
    codTolerancePct: {
      type: Number,
      required: false,
      default: 10,
      min: 0,
      max: 100,
    },
    maxTransitMinutes: {
      type: Number,
      required: false,
      default: 120,
      min: 1,
      max: 1440,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

jhatkaSettingsSchema.plugin(toJSON);

const JhatkaSettings = mongoose.model('JhatkaSettings', jhatkaSettingsSchema);

module.exports = JhatkaSettings;

