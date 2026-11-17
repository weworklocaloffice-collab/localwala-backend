const mongoose = require('mongoose');
const { toJSON } = require('../../../models/plugins');

const localServiceProviderTypeSchema = mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true, unique: true },
    label: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true, toJSON: { getters: true } }
);

localServiceProviderTypeSchema.plugin(toJSON);

localServiceProviderTypeSchema.index({ active: 1, sortOrder: 1 });

const LocalServiceProviderType = mongoose.model('LocalServiceProviderType', localServiceProviderTypeSchema);

module.exports = LocalServiceProviderType;
