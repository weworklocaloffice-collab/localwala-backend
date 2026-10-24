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

// The feed reads likers with `{ reel: { $in: [...] }, type: 'like' }` on every single
// request (reel.liker.repository.js). The unique index above cannot serve that - `user`
// is its leading field and the query never constrains `user`, so it fell back to a full
// collection scan of the feed's hot path. This is the index that query actually wants.
reelActivitySchema.index({ reel: 1, type: 1 });

reelActivitySchema.plugin(toJSON);
reelActivitySchema.plugin(paginate);

const ReelActivity = mongoose.model('ReelActivity', reelActivitySchema);

module.exports = ReelActivity;