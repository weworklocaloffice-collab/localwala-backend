/** Auditable requests to expand an outlet's approved delivery localities. */
const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');

const dairyCoverageRequestSchema = mongoose.Schema(
  {
    business: { type: mongoose.SchemaTypes.ObjectId, ref: 'Business', required: true },
    city: { type: mongoose.SchemaTypes.ObjectId, ref: 'City', required: true },
    // Snapshot which published zone made the requested localities eligible.
    // Optional so historical requests remain readable and reviewable.
    zone: { type: mongoose.SchemaTypes.ObjectId, ref: 'DeliveryZone', required: false },
    zoneVersion: { type: Number, min: 1, required: false },
    requestedLocalities: {
      type: [{ type: mongoose.SchemaTypes.ObjectId, ref: 'Locality', required: true }],
      required: true,
      validate: [(rows) => rows.length > 0 && rows.length <= 50, 'Choose 1–50 localities'],
    },
    localityReviews: [{
      locality: { type: mongoose.SchemaTypes.ObjectId, ref: 'Locality', required: true },
      status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', required: true },
      reviewedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
      reviewedAt: { type: Date, required: false },
      reviewNote: { type: String, trim: true, maxlength: 500, default: '' },
    }],
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'partially_approved'], default: 'pending', required: true },
    message: { type: String, trim: true, maxlength: 500, default: '' },
    requestedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: true },
    reviewedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    reviewedAt: { type: Date, required: false },
    reviewNote: { type: String, trim: true, maxlength: 500, default: '' },
  },
  { timestamps: true }
);

dairyCoverageRequestSchema.plugin(toJSON);
dairyCoverageRequestSchema.plugin(paginate);
dairyCoverageRequestSchema.index(
  { business: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);
dairyCoverageRequestSchema.index({ status: 1, city: 1, createdAt: -1 });

module.exports = mongoose.model('DairyCoverageRequest', dairyCoverageRequestSchema);
