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
const { toJSON, paginate } = require('../../../models/plugins');

/**
 * RealEstateNotification — one event delivery record.
 *
 * 20 event types (plan Phase 10). Delivery itself reuses
 * `fcm.notification.service`; this row is the auditable fact that
 * the event fired, for whom, and whether it was read.
 */
const realEstateNotificationSchema = mongoose.Schema(
  {
    eventType: {
      type: String,
      required: true,
      enum: [
        'LEAD_CREATED',
        'LEAD_ASSIGNED',
        'VISIT_REQUESTED',
        'VISIT_ASSIGNED',
        'VISIT_REMINDER',
        'VISIT_COMPLETED',
        'INTEREST_RECORDED',
        'FOLLOW_UP_DUE',
        'FOLLOW_UP_OVERDUE',
        'HOLD_CREATED',
        'HOLD_EXPIRING',
        'HOLD_EXPIRED',
        'HOLD_REFUNDED',
        'SALE_RECORDED',
        'COMMISSION_EARNED',
        'SETTLEMENT_CREATED',
        'LOAN_OFFER_RECEIVED',
        'LOAN_SANCTIONED',
        'LOAN_DISBURSED',
        'DOCUMENT_VERIFIED',
        'DOCUMENT_REQUESTED',
        'DOCUMENT_SUBMITTED',
        'DOCUMENT_REVIEWED',
      ],
    },

    recipient: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },

    recipientType: {
      type: String,
      required: true,
      enum: ['CUSTOMER', 'VENDOR', 'EXECUTIVE', 'BANK', 'ADMIN'],
    },

    title: { type: String, required: true, trim: true },
    body: { type: String, required: false, trim: true },

    data: { type: mongoose.Schema.Types.Mixed, required: false },

    readAt: { type: Date, required: false },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json
realEstateNotificationSchema.plugin(toJSON);
realEstateNotificationSchema.plugin(paginate);

realEstateNotificationSchema.index({ recipient: 1, createdAt: -1 });
realEstateNotificationSchema.index({ eventType: 1, createdAt: -1 });

/**
 * @typedef RealEstateNotification
 */
const RealEstateNotification = mongoose.model('RealEstateNotification', realEstateNotificationSchema);

module.exports = RealEstateNotification;
