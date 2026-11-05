const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');

const outboxSchema = new mongoose.Schema(
  {
    aggregateType: { type: String, required: true, trim: true },
    aggregateId: { type: String, required: true, trim: true },
    eventType: { type: String, required: true, trim: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    status: { type: String, required: true, enum: ['pending', 'processing', 'done', 'failed'], default: 'pending' },
    attempts: { type: Number, required: true, default: 0 },
    lastError: { type: String, required: false, trim: true },
    processedAt: { type: Date, required: false },
  },
  { timestamps: true, toJSON: { getters: true } }
);

outboxSchema.plugin(toJSON);
outboxSchema.plugin(paginate);

outboxSchema.index({ status: 1, createdAt: 1 });

const LocalServiceOutbox = mongoose.model('LocalServiceOutbox', outboxSchema);

module.exports = LocalServiceOutbox;
