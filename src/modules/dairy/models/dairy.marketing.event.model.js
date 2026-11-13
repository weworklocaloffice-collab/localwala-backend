const mongoose = require('mongoose');
const { toJSON } = require('../../../models/plugins');

const dairyMarketingEventSchema = mongoose.Schema(
  {
    campaign: { type: mongoose.SchemaTypes.ObjectId, ref: 'DairyMarketingCampaign', required: true },
    business: { type: mongoose.SchemaTypes.ObjectId, ref: 'Business', required: true },
    user: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: true },
    locality: { type: mongoose.SchemaTypes.ObjectId, ref: 'Locality', required: true },
    type: { type: String, enum: ['impression', 'click'], required: true },
    day: { type: Date, required: true },
  },
  { timestamps: true }
);

dairyMarketingEventSchema.plugin(toJSON);
dairyMarketingEventSchema.index({ campaign: 1, user: 1, type: 1, day: 1 }, { unique: true });
dairyMarketingEventSchema.index({ campaign: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model('DairyMarketingEvent', dairyMarketingEventSchema);
