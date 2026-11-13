const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');

const allocationSchema = new mongoose.Schema({
  lot: { type: mongoose.SchemaTypes.ObjectId, ref: 'DairySkuInventoryLot', required: true },
  lotNo: { type: String, trim: true },
  quantity: { type: Number, required: true, min: 0 },
}, { _id: false });

const dairySkuInventoryMovementSchema = mongoose.Schema({
  business: { type: mongoose.SchemaTypes.ObjectId, ref: 'Business', required: true, index: true },
  sku: { type: mongoose.SchemaTypes.ObjectId, ref: 'DairySku', required: true, index: true },
  eventType: {
    type: String,
    enum: ['opening_balance', 'received', 'reserved', 'released', 'expired', 'write_off', 'held', 'hold_released', 'recalled'],
    required: true,
    index: true,
  },
  quantity: { type: Number, required: true, min: 0 },
  availableDelta: { type: Number, required: true, default: 0 },
  heldDelta: { type: Number, required: true, default: 0 },
  expiredDelta: { type: Number, required: true, default: 0 },
  writtenOffDelta: { type: Number, required: true, default: 0 },
  allocations: { type: [allocationSchema], default: [] },
  sourceType: { type: String, enum: ['manual', 'order', 'recurring_order', 'system'], default: 'manual' },
  sourceId: { type: mongoose.SchemaTypes.ObjectId },
  idempotencyKey: { type: String, trim: true, maxlength: 200 },
  reason: { type: String, trim: true, maxlength: 300, default: '' },
  note: { type: String, trim: true, maxlength: 500, default: '' },
  actor: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
  balanceAfter: {
    skuAvailableQty: { type: Number, min: 0 },
    lotAvailableQty: { type: Number, min: 0 },
    lotHeldQty: { type: Number, min: 0 },
    lotExpiredQty: { type: Number, min: 0 },
    lotWrittenOffQty: { type: Number, min: 0 },
  },
  occurredAt: { type: Date, default: Date.now, required: true, index: true },
}, { timestamps: true, toJSON: { getters: true } });

dairySkuInventoryMovementSchema.plugin(toJSON);
dairySkuInventoryMovementSchema.plugin(paginate);
dairySkuInventoryMovementSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
dairySkuInventoryMovementSchema.index({ business: 1, occurredAt: -1 });
dairySkuInventoryMovementSchema.index({ business: 1, sku: 1, occurredAt: -1 });
dairySkuInventoryMovementSchema.index({ 'allocations.lot': 1, occurredAt: -1 });

module.exports = mongoose.model('DairySkuInventoryMovement', dairySkuInventoryMovementSchema);
