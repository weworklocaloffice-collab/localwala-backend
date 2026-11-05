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

/**
 * stores.audit.service.js — one writer for StoreAuditLog (plan F24).
 *
 * Call shape: `recordAudit({ actor, role, action, targetType, targetId, ... })`.
 *
 * Audit is DOWNSTREAM of the business action, never a gate on it: an audit write failure
 * must never roll back an approval, a settlement, or a merge that already happened. Every
 * caller wraps in the same fire-and-forget contract, so it lives here rather than being
 * duplicated at each call site.
 */

const mongoose = require('mongoose');
const logger = require('../../../config/logger');

const AUDIT_ACTIONS = Object.freeze({
  brandCreated: 'store.brand.created',
  brandUpdated: 'store.brand.updated',
  brandArchived: 'store.brand.archived',
  brandCertificationAdded: 'store.brand.certification.added',
  brandCertificationReviewed: 'store.brand.certification.reviewed',
  brandMerged: 'store.brand.merged',
  settlementSettled: 'store.settlement.settled',
  settlementFailed: 'store.settlement.failed',
  settlementReversed: 'store.settlement.reversed',
});

const recordAudit = async ({
  actor,
  role,
  action,
  targetType,
  targetId,
  chain,
  outlet,
  before,
  after,
  meta,
}) => {
  try {
    if (!actor || !action || !targetType || !targetId) {
      logger.warn(`stores audit skipped: missing actor/action/target (${action || 'none'} ${targetType || 'none'})`);
      return;
    }
    await mongoose.model('StoreAuditLog').create({
      actor,
      actorRole: role || 'admin',
      action,
      targetType,
      targetId,
      chain: chain || undefined,
      outlet: outlet || undefined,
      before: before || undefined,
      after: after || undefined,
      meta: meta || undefined,
    });
  } catch (error) {
    // The business action already happened. Losing the trail entry is a logger.error,
    // not a rollback — an audit failure must never undo an approval.
    logger.error(`stores audit write failed for ${action} ${targetType}: ${error.message}`);
  }
};

module.exports = {
  AUDIT_ACTIONS,
  recordAudit,
};
