const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');

const dairyMarketingPackageSchema = mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    code: { type: String, required: true, trim: true, uppercase: true, unique: true },
    placement: {
      type: String,
      required: true,
      enum: ['dairy_home_banner', 'featured_partner', 'featured_product'],
    },
    targetingLevel: { type: String, required: true, enum: ['locality', 'zone', 'city'] },
    durationHours: { type: Number, required: true, enum: [1, 3, 6, 12, 24, 168, 720] },
    price: {
      type: Number,
      required: true,
      min: 0,
      get: (value) => Number((value / 100).toFixed(2)),
      set: (value) => Math.round(value * 100),
    },
    maxConcurrent: { type: Number, default: 1, min: 1, max: 20 },
    status: { type: Boolean, default: true },
    createdBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { getters: true } }
);

dairyMarketingPackageSchema.plugin(toJSON);
dairyMarketingPackageSchema.plugin(paginate);
dairyMarketingPackageSchema.index({ status: 1, placement: 1, targetingLevel: 1, durationHours: 1 });

module.exports = mongoose.model('DairyMarketingPackage', dairyMarketingPackageSchema);
