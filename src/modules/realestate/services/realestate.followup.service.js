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

const RealEstateFollowUp = require('../models/realestate.followup.model');
const { FOLLOW_UP_TRANSITIONS, canTransition } = require('../utils/realestate.state.machine');

/**
 * Follow-up service (plan §5.7). PENDING → COMPLETED / RESCHEDULED /
 * CANCELLED. RESCHEDULED creates a new PENDING row; the original
 * keeps the link. `nextFollowUpAt` indexed for the reminder cron.
 */
function assertTransition(from, to) {
  if (!canTransition(FOLLOW_UP_TRANSITIONS, from, to)) {
    throw new Error(`Cannot move follow-up from "${from}" to "${to}".`);
  }
}

async function schedule({ lead, executive, customer, nextFollowUpAt, channel = 'CALL', note = '' }) {
  const created = await RealEstateFollowUp.create({ lead, executive, customer, nextFollowUpAt, channel, note, status: 'PENDING' });
  // Phase 10: assignee's queue changed. Never throws into scheduling.
  try {
    const RealEstateExecutive = require('../models/realestate.executive.model');
    const exec = executive && (await RealEstateExecutive.findById(executive).select('user').lean());
    if (exec && exec.user) {
      const fcm = require('../../../services/fcm.notification.service');
      await fcm.realEstateFollowUpDue({
        userId: exec.user,
        recipientType: 'EXECUTIVE',
        title: 'Follow-up scheduled',
        body: 'A new follow-up is on your list.',
        data: { followUpId: String(created._id), leadId: String(lead) },
      });
    }
  } catch (e) {
    /* notify-only */
  }
  return created;
}

async function complete(followUpId) {
  const f = await RealEstateFollowUp.findById(followUpId);
  if (!f) throw new Error('Follow-up not found');
  assertTransition(f.status, 'COMPLETED');
  f.status = 'COMPLETED';
  await f.save();
  return f;
}

const realEstateFollowUpService = { assertTransition, schedule, complete };

module.exports = realEstateFollowUpService;
