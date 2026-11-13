const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');

const dairyCouponSchema = mongoose.Schema({
  business: { type: mongoose.SchemaTypes.ObjectId, ref: 'Business', required: true, index: true },
  code: { type: String, required: true, uppercase: true, trim: true },
  title: { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, trim: true, maxlength: 500, default: '' },
  discountType: { type: String, enum: ['percentage', 'fixed'], required: true },
  discountValue: { type: Number, required: true, min: 0.01 },
  minOrderAmount: { type: Number, default: 0, get: (v) => Number((v / 100).toFixed(2)), set: (v) => Math.round(v * 100) },
  maxDiscountAmount: { type: Number, get: (v) => v == null ? undefined : Number((v / 100).toFixed(2)), set: (v) => v == null ? undefined : Math.round(v * 100) },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  maxRedemptions: { type: Number, default: null, min: 1 },
  reservedCount: { type: Number, default: 0, min: 0, select: false },
  redeemedCount: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['pending_review', 'active', 'rejected', 'disabled', 'expired'], default: 'pending_review', index: true },
  approval: {
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    by: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
    at: Date,
    note: { type: String, maxlength: 500, default: '' },
  },
  createdBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: true },
}, { timestamps: true, toJSON: { getters: true } });

dairyCouponSchema.plugin(toJSON);
dairyCouponSchema.plugin(paginate);
dairyCouponSchema.index({ business: 1, code: 1 }, { unique: true });
dairyCouponSchema.index({ status: 1, startsAt: 1, endsAt: 1 });

module.exports = mongoose.model('DairyCoupon', dairyCouponSchema);
