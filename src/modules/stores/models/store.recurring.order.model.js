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
const { toJSON, paginate } = require('../../../models/plugins');

const storeRecurringOrderSchema = mongoose.Schema(
  {
    subscription: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreCustomerSubscription',
      required: true,
    },
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOutlet',
      required: true,
    },
    chain: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreChain',
      required: true,
    },
    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    occurrenceDate: {
      type: Date,
      required: true,
    },
    order: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOrder',
    },
    generationStatus: {
      type: String,
      default: 'generated',
      enum: ['generated', 'reserved', 'skipped_no_stock', 'skipped_store_inactive', 'payment_failed', 'cancelled', 'expired'],
    },
    creditAmount: {
      type: Number,
      default: 0,
    },
    skipReason: {
      type: String,
    },
    notifiedAt: {
      type: Date,
    },
    expiresAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

storeRecurringOrderSchema.plugin(toJSON);
storeRecurringOrderSchema.plugin(paginate);

storeRecurringOrderSchema.index({ subscription: 1, occurrenceDate: 1 }, { unique: true });
storeRecurringOrderSchema.index({ outlet: 1, generationStatus: 1 });
storeRecurringOrderSchema.index({ customer: 1, createdAt: -1 });

storeRecurringOrderSchema.statics.findBySubscription = async function (subscriptionId) {
  return this.find({ subscription: subscriptionId }).sort({ occurrenceDate: -1 });
};

storeRecurringOrderSchema.statics.findPending = async function (outletId) {
  return this.find({ outlet: outletId, generationStatus: { $in: ['generated', 'reserved'] } });
};

module.exports = mongoose.model('StoreRecurringOrder', storeRecurringOrderSchema);