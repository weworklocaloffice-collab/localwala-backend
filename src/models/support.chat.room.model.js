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

const supportChatRoomSchema = mongoose.Schema(
  {
    userId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    supportTeam: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'User',
        required: true,
      },
    ],
    orders: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Orders',
      required: false,
    },
    booking: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DiningBooking',
      required: false,
    },
    purchaseSubscription: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'UserPurchasedTiffinSubscription',
      required: false,
    },
    complaints: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Complaints',
      required: false,
    },
    reportIssue: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ReportIssueRestaurant',
      required: false,
    },
    restaurantComplaints: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RestaurantComplaints',
      required: false,
    },
    supportType: {
      type: String,
      required: true,
      default: 'orders', // orders, dining, tiffin_subscription, complaints, reports,restaurant_complaints
    },
    lastMessage: {
      type: String,
      required: false,
    },
    lastMessageType: {
      type: String,
      required: false,
    },
    resolvedBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    status: {
      type: String,
      default: 'open', // open, in_progress, resolved
    },
    // --- Enterprise bot-first -> human handover extensions (backward compatible) ---
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },
    channel: {
      type: String,
      default: 'app', // app, web, whatsapp, etc
    },
    queueId: {
      type: mongoose.SchemaTypes.ObjectId,
      required: false,
    },
    // Snapshot of the queue's staffed hours at ticket creation. Copied rather
    // than looked up on every deadline: an agent must not be able to change a
    // policy that makes an already-breached ticket un-breached.
    workingHours: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    assignedAgent: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    skillTags: {
      type: [String],
      default: [],
    },
    language: {
      type: String,
      required: false,
    },
    cityZone: {
      type: String,
      required: false,
    },
    slaDueAt: {
      type: Date,
      required: false,
    },
    firstResponseAt: {
      type: Date,
      required: false,
    },
    // First reply deadline for THIS assignment: always 30s after assign.
    // Reset on every (re)assignment; hidden once firstResponseAt is stamped.
    firstResponseDueAt: {
      type: Date,
      required: false,
    },
    resolvedAt: {
      type: Date,
      required: false,
    },
    csat: {
      score: { type: Number, min: 1, max: 5, required: false },
      comment: { type: String, required: false },
      ratedAt: { type: Date, required: false },
    },
    tags: {
      type: [String],
      default: [],
    },
    collaborators: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'User',
        required: false,
      },
    ],
    // Set when this ticket was merged into an older one. The row is kept, never
    // deleted: the customer's message history stays readable and the agent who
    // answered it stays attributable. Reads filter on `mergedInto: null`.
    mergedInto: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'SupportChatRoom',
      required: false,
    },
    mergedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    mergedAt: { type: Date, required: false },
    orderSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
    },
    botEnabled: {
      type: Boolean,
      default: true,
    },
    handoverState: {
      type: String,
      enum: ['bot', 'queued', 'assigned', 'human', 'resolved'],
      default: 'bot',
    },
    lastReadBy: {
      userAt: { type: Date, required: false },
      agentAt: { type: Date, required: false },
    },
    reopenCount: {
      type: Number,
      default: 0,
    },
    audit: [
      {
        by: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
        action: { type: String, required: true },
        at: { type: Date, default: Date.now },
        meta: { type: mongoose.Schema.Types.Mixed, required: false },
      },
    ],
    // Transfer-with-accept: an offered handoff waits here until the receiving
    // agent accepts/declines (or it expires). Ownership never moves silently.
    pendingTransfer: {
      toAgent: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
      byAgent: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
      reason: { type: String, required: false },
      at: { type: Date, required: false },
      expiresAt: { type: Date, required: false },
    },
    // --- Escalation state --------------------------------------------------
    // `escalationLevel` is what stops a runaway ladder: a ticket escalates once
    // per level, and an agent reply or a resolve resets it to 0. Without this
    // the sweep would re-fire every minute on the same stuck ticket.
    escalationLevel: {
      type: Number,
      default: 0,
    },
    escalatedAt: { type: Date, required: false },
    escalatedTo: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: false },
    escalationReason: { type: String, required: false },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
supportChatRoomSchema.plugin(toJSON);
supportChatRoomSchema.plugin(paginate);

// Enterprise indexes for queue/SLA/assignment (safe, background)
supportChatRoomSchema.index({ status: 1, updatedAt: -1 });
supportChatRoomSchema.index({ assignedAgent: 1, status: 1 });
// Duplicate detection scans open tickets for the same customer within a recent
// window. This compound index is what makes that scan bounded: without the
// status prefix every historical ticket for a customer is walked on each probe.
supportChatRoomSchema.index({ userId: 1, status: 1, createdAt: -1 });
supportChatRoomSchema.index({ userId: 1, supportType: 1 });
supportChatRoomSchema.index({ slaDueAt: 1, status: 1 });
supportChatRoomSchema.index({ handoverState: 1, status: 1 });
supportChatRoomSchema.index({ escalationLevel: 1, status: 1 });

/**
 * @typedef SupportChatRoom
 */
const SupportChatRoom = mongoose.model('SupportChatRoom', supportChatRoomSchema);

module.exports = SupportChatRoom;

