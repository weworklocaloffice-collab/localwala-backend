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

const LocalServiceAuditLog = require('../models/localservice.audit.log.model');

/**
 * Best-effort audit write. A logging failure must never roll back or hide the
 * business action that already committed, but it must be visible in logs.
 */
async function recordAudit(req, { event, targetType, targetId, details, metadata }) {
  try {
    return await LocalServiceAuditLog.create({
      event,
      targetType,
      targetId: targetId ? String(targetId) : undefined,
      actor: req && req.user ? req.user._id : undefined,
      actorRole: req && req.user ? req.user.role : 'system',
      details,
      metadata,
      ip: req ? req.ip : undefined,
    });
  } catch (e) {
    console.error('LocalServices audit write failed:', e.message);
    return null;
  }
}

module.exports = { recordAudit };
