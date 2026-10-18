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

/**
 * DeliveryZone — a named group of localities in one city (food vertical).
 *
 * A zone has no shape: it is a set of `Locality` ids, and every coverage
 * check downstream is membership, not geometry. Zones are the ops layer —
 * metrics, surge and accountability per area — never assignment handcuffs.
 *
 * ## Versioning (the rule that keeps dashboards honest)
 *
 * Rows are never edited destructively for coverage purposes: each publish
 * bumps `version` and appends a full snapshot to `DeliveryZoneHistory`.
 * Events tag `zone + zoneVersion`, so "breaches up 30% in Hitech Belt" always
 * means the same Hitech Belt as last week.
 *
 * ## One locality, one zone
 *
 * Enforced in `services/delivery.zone.service.js` at publish time, not by a
 * unique index (Mongo cannot express "unique within one city's active zones"
 * for array members). A locality in two zones would double-count every metric.
 */
const deliveryZoneSchema = mongoose.Schema(
  {
    city: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'City',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    localities: {
      type: [{ type: mongoose.SchemaTypes.ObjectId, ref: 'Locality' }],
      default: [],
    },
    version: {
      type: Number,
      required: false,
      default: 1,
    },
    effectiveFrom: {
      type: Date,
      required: false,
      default: Date.now,
    },
    updatedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
      default: null,
    },
    status: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

deliveryZoneSchema.plugin(toJSON);
deliveryZoneSchema.plugin(paginate);
deliveryZoneSchema.index({ city: 1, status: 1 });
deliveryZoneSchema.index({ localities: 1 });

/**
 * @typedef DeliveryZone
 */
const DeliveryZone = mongoose.model('DeliveryZone', deliveryZoneSchema);

module.exports = DeliveryZone;
