const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');

const localServiceSettingSchema = mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    value: { type: mongoose.Schema.Types.Mixed },
    description: { type: String, default: '' },
    updatedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

localServiceSettingSchema.plugin(toJSON);
localServiceSettingSchema.plugin(paginate);

const LocalServiceSetting = mongoose.model('LocalServiceSetting', localServiceSettingSchema);
module.exports = LocalServiceSetting;
