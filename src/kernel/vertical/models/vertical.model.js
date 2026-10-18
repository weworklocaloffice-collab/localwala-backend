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
const { toJSON, paginate, slugGenerator } = require('../../../models/plugins');

/**
 * Vertical registry.
 *
 * A vertical is a business line sharing the platform kernel — dairy, food, and
 * later grocery or pharmacy. Registering them as data rather than as folders
 * means the Admin panel can list and toggle verticals without a deploy, and
 * `Business.vertical` can be validated against this collection.
 *
 * The `key` values here must stay in sync with the role enums added to
 * `config/roles.js` and with the `DairyAppRole` wire values in
 * `DairyPartner_app/lib/app/core/models/user_session_model.dart`.
 */
const verticalSchema = mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      // dairy, food, grocery, ...
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: false,
      trim: true,
    },
    icon: {
      type: String,
      required: false,
      trim: true,
    },
    /**
     * Whether this vertical participates in the shared delivery engine.
     * Dairy is true; a vertical with its own logistics sets this false.
     */
    usesSharedDelivery: {
      type: Boolean,
      required: false,
      default: true,
    },
    settings: {
      type: mongoose.SchemaTypes.Mixed,
      required: false,
    },
    sortOrder: {
      type: Number,
      required: false,
      default: 0,
    },
    status: {
      type: Boolean,
      required: false,
      default: true,
    },
    /**
     * Who last flipped `status`, and when.
     *
     * A switch that stops a business line needs an answer to "who turned this off,
     * and when". Without these, a halted vertical has no trail and the question
     * is only answerable by guessing.
     */
    statusChangedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    statusChangedAt: {
      type: Date,
      required: false,
    },
    /**
     * Why it was changed, in the operator's words. A toggle that can carry a
     * reason gets one used; a bare switch tends to get flipped back and forth with
     * no record of why.
     */
    statusReason: {
      type: String,
      required: false,
      trim: true,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
verticalSchema.plugin(toJSON);
verticalSchema.plugin(paginate);
verticalSchema.plugin(slugGenerator);
// `unique: true` is declared on the field above, so it is not repeated here —
// declaring it in both places makes Mongoose warn about a duplicate index on every
// boot.
verticalSchema.index({ status: 1, sortOrder: 1 });

/**
 * @typedef Vertical
 */
const Vertical = mongoose.model('Vertical', verticalSchema);

module.exports = Vertical;