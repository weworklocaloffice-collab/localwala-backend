const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');

const dairySkuInventoryLotSchema = mongoose.Schema(
  {
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    sku: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairySku',
      required: true,
    },
    lotNo: {
      type: String,
      required: true,
      trim: true,
    },
    receivedQty: {
      type: Number,
      required: true,
      min: 0,
    },
    availableQty: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    expiredQty: {
      type: Number,
      min: 0,
      default: 0,
    },
    heldQty: {
      type: Number,
      min: 0,
      default: 0,
    },
    writtenOffQty: {
      type: Number,
      min: 0,
      default: 0,
    },
    receivedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    // Null is reserved for the one-time legacy opening balance conversion.
    expiry: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ['receiving', 'active', 'depleted', 'expired', 'held', 'recalled', 'written_off'],
      default: 'active',
      required: true,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    dispositionReason: { type: String, trim: true, maxlength: 300, default: '' },
    dispositionAt: { type: Date },
    dispositionBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
    createdBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true, toJSON: { getters: true } }
);

dairySkuInventoryLotSchema.plugin(toJSON);
dairySkuInventoryLotSchema.plugin(paginate);
dairySkuInventoryLotSchema.index({ business: 1, sku: 1, lotNo: 1 }, { unique: true });
dairySkuInventoryLotSchema.index({ business: 1, sku: 1, status: 1, expiry: 1, availableQty: 1 });

module.exports = mongoose.model('DairySkuInventoryLot', dairySkuInventoryLotSchema);
