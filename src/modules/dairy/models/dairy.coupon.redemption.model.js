const mongoose = require('mongoose');
const { toJSON } = require('../../../models/plugins');

const dairyCouponRedemptionSchema = mongoose.Schema({
  coupon: { type: mongoose.SchemaTypes.ObjectId, ref: 'DairyCoupon', required: true },
  user: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: true },
  business: { type: mongoose.SchemaTypes.ObjectId, ref: 'Business', required: true },
  order: { type: mongoose.SchemaTypes.ObjectId, ref: 'DairyOrder', required: true },
  status: { type: String, enum: ['reserved', 'redeemed', 'released'], required: true, default: 'reserved' },
  reservedAt: { type: Date, default: Date.now },
  redeemedAt: Date,
  releasedAt: Date,
}, { timestamps: true });

dairyCouponRedemptionSchema.plugin(toJSON);
dairyCouponRedemptionSchema.index({ coupon: 1, user: 1 }, { unique: true });
dairyCouponRedemptionSchema.index({ order: 1 }, { unique: true });
dairyCouponRedemptionSchema.index({ coupon: 1, status: 1 });

module.exports = mongoose.model('DairyCouponRedemption', dairyCouponRedemptionSchema);
