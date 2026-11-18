const mongoose = require('mongoose');

const jhatkaCreditNoteSchema = new mongoose.Schema(
  {
    creditNoteNo: { type: String, required: true, trim: true },
    financialYear: { type: String, required: true, trim: true },
    invoiceNo: { type: String, required: true, trim: true },
    order: { type: mongoose.SchemaTypes.ObjectId, ref: 'JhatkaOrder', required: true },
    outlet: { type: mongoose.SchemaTypes.ObjectId, ref: 'JhatkaOutlet', required: true },
    business: { type: mongoose.SchemaTypes.ObjectId, ref: 'Business', required: false },
    reason: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, default: 0 },
    taxTotal: { type: Number, required: false, default: 0 },
    issuedAt: { type: Date, required: true },
    status: { type: String, required: false, enum: ['issued', 'void'], default: 'issued' },
    isVoided: { type: Boolean, required: false, default: false },
  },
  { timestamps: true }
);

jhatkaCreditNoteSchema.index({ outlet: 1, creditNoteNo: 1 }, { unique: true });
jhatkaCreditNoteSchema.index({ order: 1 });

module.exports = mongoose.model('JhatkaCreditNote', jhatkaCreditNoteSchema);
