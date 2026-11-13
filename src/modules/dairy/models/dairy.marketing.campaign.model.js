const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');

const dairyMarketingCampaignSchema = mongoose.Schema(
  {
    business: { type: mongoose.SchemaTypes.ObjectId, ref: 'Business', required: true },
    package: { type: mongoose.SchemaTypes.ObjectId, ref: 'DairyMarketingPackage', required: true },
    caption: { type: String, required: true, trim: true, maxlength: 100 },
    packageSnapshot: {
      name: { type: String, required: true },
      code: { type: String, required: true },
      placement: { type: String, required: true },
      targetingLevel: { type: String, required: true },
      durationHours: { type: Number, required: true },
      price: {
        type: Number,
        required: true,
        get: (value) => Number((value / 100).toFixed(2)),
        set: (value) => Math.round(value * 100),
      },
    },
    city: { type: mongoose.SchemaTypes.ObjectId, ref: 'City', required: true },
    zone: { type: mongoose.SchemaTypes.ObjectId, ref: 'DeliveryZone' },
    targetLocalities: {
      type: [{ type: mongoose.SchemaTypes.ObjectId, ref: 'Locality' }],
      required: true,
      validate: [(rows) => rows.length > 0 && rows.length <= 50, 'Choose 1–50 approved localities'],
    },
    product: { type: mongoose.SchemaTypes.ObjectId, ref: 'DairyProduct' },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    amount: {
      type: Number,
      required: true,
      get: (value) => Number((value / 100).toFixed(2)),
      set: (value) => Math.round(value * 100),
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'initiated', 'paid', 'refunded'],
      default: 'unpaid',
      required: true,
    },
    paymentInitiation: { type: mongoose.SchemaTypes.ObjectId, ref: 'PaymentInitiation' },
    paidAt: Date,
    status: {
      type: String,
      enum: ['pending_review', 'rejected', 'approved_unpaid', 'scheduled', 'live', 'paused', 'completed', 'cancelled'],
      default: 'pending_review',
      required: true,
    },
    approval: {
      status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
      by: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
      at: Date,
      note: { type: String, trim: true, maxlength: 500, default: '' },
    },
    createdBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, toJSON: { getters: true } }
);

dairyMarketingCampaignSchema.plugin(toJSON);
dairyMarketingCampaignSchema.plugin(paginate);
dairyMarketingCampaignSchema.index({ business: 1, createdAt: -1 });
dairyMarketingCampaignSchema.index({ status: 1, startsAt: 1, endsAt: 1, targetLocalities: 1 });
dairyMarketingCampaignSchema.index({ package: 1, status: 1, startsAt: 1, endsAt: 1 });

module.exports = mongoose.model('DairyMarketingCampaign', dairyMarketingCampaignSchema);
