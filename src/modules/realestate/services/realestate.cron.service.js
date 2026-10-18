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

const RealEstateProperty = require('../models/realestate.property.model');
const RealEstatePropertyHold = require('../models/realestate.property.hold.model');
const RealEstateVisitRequest = require('../models/realestate.visit.request.model');
const RealEstateVisit = require('../models/realestate.visit.model');
const RealEstateFollowUp = require('../models/realestate.followup.model');
const RealEstateLead = require('../models/realestate.lead.model');
const propertyService = require('./realestate.property.service');
const holdRefundService = require('./realestate.hold.refund.service');
const assignmentService = require('./realestate.assignment.service');
const { withOptionalTransaction } = require('../../../utils/optionalTransaction');
const notificationService = require('./realestate.notification.service');
const promotionService = require('./realestate.promotion.service');

/**
 * Real Estate cron jobs — all idempotent, all safe to retry.
 * Scheduled in `services/cron.job.scheduler.service.js` (same file
 * as the dairy manifest job). A retry after a partial failure must
 * never duplicate an expiry, a refund, or a stat row: every job keys
 * on status or a unique index.
 */

async function expireListings() {
  const due = await RealEstateProperty.find({
    status: 'PUBLISHED',
    expiresAt: { $lt: new Date() },
  }).select('_id');
  let expired = 0;
  for (const p of due) {
    try {
      await propertyService.changeStatus(p._id, 'EXPIRED', { actorType: 'system' });
      expired += 1;
    } catch (e) {
      console.error(`expireListings ${p._id}: ${e.message}`);
    }
  }
  return { checked: due.length, expired };
}

async function expireHolds() {
  const due = await RealEstatePropertyHold.find({ status: 'ACTIVE', expiresAt: { $lt: new Date() } });
  let expired = 0;
  for (const h of due) {
    try {
      // F-11: the EXPIRED flip and the refund request are one unit — a crash
      // between them would leave an expired hold with no refund row.
      await withOptionalTransaction(async (session) => {
        h.status = 'EXPIRED';
        await h.save(session ? { session } : {});
        await holdRefundService.requestRefund(h._id, 'EXPIRY', null, session);
      });
      // Phase 10: customer confirmation. Never throws into the sweep.
      try {
        const fcm = require('../../../services/fcm.notification.service');
        await fcm.realEstateHoldExpired({
          userId: h.customer,
          recipientType: 'CUSTOMER',
          title: 'Hold expired',
          body: `Hold ${h.holdCode} has expired. Your refund is being processed.`,
          data: { holdId: String(h._id) },
        });
      } catch (e) {
        /* notify-only */
      }
      expired += 1;
    } catch (e) {
      console.error(`expireHolds ${h._id}: ${e.message}`);
    }
  }
  return { checked: due.length, expired };
}

async function sendReminders() {
  const now = new Date();
  let holdReminders = 0;
  for (const hours of [72, 24, 6]) {
    const from = new Date(now.getTime() + (hours - 1) * 3600 * 1000);
    const to = new Date(now.getTime() + hours * 3600 * 1000);
    const due = await RealEstatePropertyHold.find({ status: 'ACTIVE', expiresAt: { $gte: from, $lt: to } });
    for (const h of due) {
      await notificationService.fire({
        eventType: 'HOLD_EXPIRING',
        recipient: h.customer,
        recipientType: 'CUSTOMER',
        title: 'Your hold is expiring',
        body: `Hold ${h.holdCode} expires in about ${hours} hours.`,
        data: { hold: h._id },
      });
      // Phase 10: push alongside the DB row. Never throws into the sweep.
      try {
        const fcm = require('../../../services/fcm.notification.service');
        await fcm.realEstateHoldExpiring({
          userId: h.customer,
          recipientType: 'CUSTOMER',
          title: 'Your hold is expiring',
          body: `Hold ${h.holdCode} expires in about ${hours} hours.`,
          data: { holdId: String(h._id) },
        });
      } catch (e) {
        /* notify-only */
      }
      holdReminders += 1;
    }
  }
  const overdue = await RealEstateFollowUp.find({ status: 'PENDING', nextFollowUpAt: { $lt: now } });
  let followUpReminders = 0;
  for (const f of overdue) {
    if (!f.executive) continue;
    const RealEstateExecutive = require('../models/realestate.executive.model');
    const exec = await RealEstateExecutive.findById(f.executive).select('user');
    if (!exec) continue;
    await notificationService.fire({
      eventType: 'FOLLOW_UP_OVERDUE',
      recipient: exec.user,
      recipientType: 'EXECUTIVE',
      title: 'Follow-up overdue',
      body: 'A follow-up passed its due time.',
      data: { followUp: f._id },
    });
    // Phase 10: push alongside the DB row. Never throws into the sweep.
    try {
      const fcm = require('../../../services/fcm.notification.service');
      await fcm.realEstateFollowUpOverdue({
        userId: exec.user,
        recipientType: 'EXECUTIVE',
        title: 'Follow-up overdue',
        body: 'A follow-up passed its due time.',
        data: { followUpId: String(f._id) },
      });
    } catch (e) {
      /* notify-only */
    }
    followUpReminders += 1;
  }
  return { holdReminders, followUpReminders };
}

async function sweepAssignments() {
  const pending = await RealEstateVisitRequest.find({ status: 'PENDING_ASSIGNMENT' }).limit(50);
  let assigned = 0;
  for (const req of pending) {
    try {
      // The assignment mechanics (pick executive → create visit →
      // flip request → notify) live in `assignmentService` so the
      // customer's immediate-assign path and this sweep share one
      // implementation. `null` means nobody was eligible — the
      // request stays queued for the next sweep.
      const visit = await assignmentService.assignVisitRequest(req);
      if (visit) assigned += 1;
    } catch (e) {
      console.error(`sweepAssignments ${req._id}: ${e.message}`);
    }
  }
  return { checked: pending.length, assigned };
}

/**
 * Phase A governance — expire past-SLA approval cases. Expiry is a
 * timeout, never a decision: nothing auto-approves.
 */
async function expireApprovals(now = new Date()) {
  const approvalService = require('./realestate.approval.service');
  return approvalService.expireOverdue(now);
}

/**
 * Phase B — nightly three-way money match (holds ↔ ledger ↔ refunds).
 * Never throws into the scheduler; an unhealthy report pages finance
 * via the audit row + console error, it does not freeze trading.
 */
async function runReconciliation() {
  try {
    const reconciliationService = require('./realestate.reconciliation.service');
    return await reconciliationService.runReconciliation('cron');
  } catch (e) {
    console.error(`runReconciliation: ${e.message}`);
    return { healthy: false, error: e.message };
  }
}

async function complianceRollup() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const props = await RealEstateProperty.find({ updatedAt: { $gte: start } }).select('_id');
  let rolled = 0;
  for (const p of props) {
    const [leads, visits] = await Promise.all([
      RealEstateLead.countDocuments({ property: p._id, createdAt: { $gte: start } }),
      RealEstateVisit.countDocuments({ property: p._id, createdAt: { $gte: start } }),
    ]);
    await promotionService.upsertDailyStat({ property: p._id, day: start, leads, visits });
    rolled += 1;
  }
  return { rolled };
}

module.exports = {
  expireListings,
  expireHolds,
  sendReminders,
  sweepAssignments,
  complianceRollup,
  expireApprovals,
  runReconciliation,
};
