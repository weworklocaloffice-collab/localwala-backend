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
const { toJSON, paginate } = require('../../../models/plugins');

/**
 * DairyMilkRejectionReason — outlet-configurable reasons for refusing milk.
 *
 * A flat lookup rather than an enum, because what counts as a reason varies:
 * "curdled on boiling" and "ran a low SNF test" are both rejections but only one
 * is about the animal. Keeping them as documents means an outlet can add its own
 * without a deploy, and rejection analytics can group by cause.
 */
const dairyMilkRejectionReasonSchema = mongoose.Schema(
  {
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    /**
     * low_snf | low_fat | high_temperature | sour | curdled | adulterated
     * | foreign_body | late_collection | other
     */
    code: {
      type: String,
      required: false,
      trim: true,
    },
    description: {
      type: String,
      required: false,
      trim: true,
    },
    /**
     * Marks a reason the system raises automatically from a failed QC check,
     * which cannot be deselected by an operator. Free-text reasons can.
     */
    system: {
      type: Boolean,
      required: false,
      default: false,
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
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
dairyMilkRejectionReasonSchema.plugin(toJSON);
dairyMilkRejectionReasonSchema.plugin(paginate);
dairyMilkRejectionReasonSchema.index({ business: 1, status: 1, sortOrder: 1 });

/**
 * @typedef DairyMilkRejectionReason
 */
const DairyMilkRejectionReason = mongoose.model(
  'DairyMilkRejectionReason',
  dairyMilkRejectionReasonSchema
);

module.exports = DairyMilkRejectionReason;