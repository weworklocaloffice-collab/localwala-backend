const mongoose = require('mongoose');

async function enqueue({ aggregateType, aggregateId, eventType, payload } = {}, { OutboxModel } = {}) {
  const Outbox = OutboxModel || require('../models/localservice.outbox.model');
  try {
    return await Outbox.create({ aggregateType, aggregateId, eventType, payload: payload || {}, status: 'pending' });
  } catch (e) {
    console.error('LocalServices outbox enqueue failed:', e && e.message);
    return null;
  }
}

async function processPending({ OutboxModel, handler } = {}) {
  const Outbox = OutboxModel || require('../models/localservice.outbox.model');
  const pending = await Outbox.find({ status: 'pending' }).sort({ createdAt: 1 }).limit(50).lean();
  const out = { scanned: pending.length, processed: 0, failed: 0 };
  for (const row of pending) {
    try {
      await Outbox.updateOne({ _id: row._id }, { $set: { status: 'processing' } });
      if (typeof handler === 'function') await handler(row);
      await Outbox.updateOne({ _id: row._id }, { $set: { status: 'done', processedAt: new Date() } });
      out.processed += 1;
    } catch (e) {
      await Outbox.updateOne({ _id: row._id }, { $set: { status: 'pending', lastError: (e && e.message) || 'error' }, $inc: { attempts: 1 } });
      out.failed += 1;
    }
  }
  return out;
}

module.exports = { enqueue, processPending };
