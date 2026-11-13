const mongoose = require('mongoose');

const deliveryAuditSchema = mongoose.Schema(
  {
    agent: { type: mongoose.SchemaTypes.ObjectId, ref: 'DairyDriver', required: false },
    user: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    action: { type: String, required: true },
    entityType: { type: String, required: false },
    entityId: { type: mongoose.SchemaTypes.ObjectId, required: false },
    run: { type: mongoose.SchemaTypes.ObjectId, ref: 'DeliveryRun', required: false },
    stop: { type: mongoose.SchemaTypes.ObjectId, ref: 'DeliveryStop', required: false },
    metadata: { type: mongoose.SchemaTypes.Mixed, required: false },
  },
  { timestamps: true }
);

const DeliveryAudit = mongoose.model('DeliveryAudit', deliveryAuditSchema);

module.exports = DeliveryAudit;