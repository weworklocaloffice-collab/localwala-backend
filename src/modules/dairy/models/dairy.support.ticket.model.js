const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');

const attachmentSchema = mongoose.Schema({
  url: { type: String, required: true, trim: true, maxlength: 2048 },
  name: { type: String, required: false, trim: true, maxlength: 160 },
  mimeType: { type: String, required: false, trim: true, maxlength: 120 },
}, { _id: false });

const messageSchema = mongoose.Schema({
  sender: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: true },
  senderType: { type: String, enum: ['customer', 'partner', 'admin'], required: true },
  body: { type: String, required: true, trim: true, maxlength: 5000 },
  attachments: { type: [attachmentSchema], default: [] },
  createdAt: { type: Date, default: Date.now, required: true },
}, { _id: true });

const statusHistorySchema = mongoose.Schema({
  fromStatus: { type: String, enum: ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'], required: false },
  toStatus: { type: String, enum: ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'], required: true },
  actor: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: true },
  actorType: { type: String, enum: ['customer', 'partner', 'admin'], required: true },
  note: { type: String, trim: true, maxlength: 1000, required: false },
  changedAt: { type: Date, default: Date.now, required: true },
}, { _id: true });

const dairySupportTicketSchema = mongoose.Schema({
  ticketNo: { type: String, required: true, trim: true, uppercase: true, unique: true },
  requester: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: true, index: true },
  requesterType: { type: String, enum: ['customer', 'partner'], required: true, index: true },
  business: { type: mongoose.SchemaTypes.ObjectId, ref: 'Business', required: false, index: true },
  order: { type: mongoose.SchemaTypes.ObjectId, ref: 'DairyOrder', required: false, index: true },
  category: {
    type: String,
    enum: ['order', 'delivery', 'payment', 'subscription', 'product_quality', 'inventory', 'account', 'other'],
    required: true,
  },
  subject: { type: String, required: true, trim: true, maxlength: 160 },
  priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal', required: true },
  status: {
    type: String,
    enum: ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'],
    default: 'open',
    required: true,
    index: true,
  },
  assignedTo: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
  messages: { type: [messageSchema], default: [] },
  statusHistory: { type: [statusHistorySchema], default: [] },
  lastMessageAt: { type: Date, default: Date.now, index: true },
  resolvedAt: { type: Date, required: false },
  closedAt: { type: Date, required: false },
}, { timestamps: true, optimisticConcurrency: true });

dairySupportTicketSchema.plugin(toJSON);
dairySupportTicketSchema.plugin(paginate);
dairySupportTicketSchema.index({ requester: 1, createdAt: -1 });
dairySupportTicketSchema.index({ business: 1, createdAt: -1 });
dairySupportTicketSchema.index({ status: 1, priority: -1, lastMessageAt: 1 });

module.exports = mongoose.model('DairySupportTicket', dairySupportTicketSchema);
