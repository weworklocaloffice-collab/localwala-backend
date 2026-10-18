/**
 * LocalWala – Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright © 2026 WeWorkLocal Private Limited
 * https://weworklocal.in/
 *
 * WeWorkLocal Private Limited
 *
 * This source code is confidential.
 * Unauthorized copying, redistribution, resale, publication,
 * modification, or use of this source code in any public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

const agentPresenceSchema = mongoose.Schema(
  {
    agentId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    online: {
      type: Boolean,
      default: false,
    },
    currentRooms: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'SupportChatRoom',
      },
    ],
    lastSeen: {
      type: Date,
      default: Date.now,
    },
    // True when the agent logged out cleanly (vs vanished). Clean-logout
    // rooms keep their assignee; only vanished agents' rooms requeue.
    cleanLogout: {
      type: Boolean,
      default: false,
    },
    // Availability: available (default) | busy | offline. Busy keeps current
    // tickets but pulls the agent from auto-assign and transfer rosters.
    // Offline behaves like logout without killing the session.
    //
    // Every consumer compares these strings literally (`availability: 'available'`,
    // `a.availability === 'busy'`), and `enum` alone does NOT protect that on
    // update paths — Mongoose skips validators unless the op passes
    // `runValidators`. A row holding `'Available'` or `'busy '` failed every
    // comparison at once: invisible to auto-assign, and rendered "offline" on
    // the supervisor roster. Normalizing here closes that for every writer
    // (REST, cron, scripts, imports), not just the one that validates.
    availability: {
      type: String,
      enum: ['available', 'busy', 'offline'],
      default: 'available',
      lowercase: true,
      trim: true,
    },
    // Live ticket counter for the ATOMIC WIP guard. Incremented only by the
    // guarded claim (`$lt: wipLimit` + `$inc` in one update), so concurrent
    // assigns can never overshoot the cap. Reconciled by the sweep.
    openTickets: {
      type: Number,
      default: 0,
    },
    // True while a shift has the agent off-shift. Kept separate from
    // `availability` so the sweep can restore what the agent had chosen before,
    // instead of guessing on shift start and clobbering a manual choice.
    offShift: {
      type: Boolean,
      default: false,
    },
    preShiftAvailability: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

agentPresenceSchema.plugin(toJSON);
agentPresenceSchema.plugin(paginate);
// `online` alone is the wrong index for every read in the system: the transfer
// roster, the room-collision lock, the broadcast fan-out and all three crons
// query `online: true` PLUS a `lastSeen` freshness bound. Serving that from an
// {online:1} index means scanning every online row on each poll — and the
// 90-second window it is written to only makes sense as a compound key.
// `availability` rides along because the assignment filter pairs it with
// `online` on every claim.
agentPresenceSchema.index({ online: 1, lastSeen: -1 });
agentPresenceSchema.index({ online: 1, availability: 1 });

/**
 * @typedef AgentPresence
 */
const AgentPresence = mongoose.model('AgentPresence', agentPresenceSchema);

module.exports = AgentPresence;
