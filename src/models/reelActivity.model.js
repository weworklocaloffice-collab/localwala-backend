const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

const reelActivitySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    reel: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Reel',
      required: true,
    },
    type: {
      type: String,
      enum: ['like', 'save'],
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

reelActivitySchema.index({ user: 1, reel: 1, type: 1 }, { unique: true });

reelActivitySchema.plugin(toJSON);
reelActivitySchema.plugin(paginate);

const ReelActivity = mongoose.model('ReelActivity', reelActivitySchema);

module.exports = ReelActivity;