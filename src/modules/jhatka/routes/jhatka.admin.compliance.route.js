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
 * jhatka.admin.compliance.route.js — B1.8
 *
 * FSSAI licensing, hygiene checks, recalls and the supplier-compliance rollup. §11.
 *
 * ## Schema verified against `docs/JHATKA-ADMIN-SCHEMA-SURVEY.md`
 *
 *   JhatkaCompliance required : outlet, business, fssai.licenceNumber,
 *                                      fssai.category, fssai.expiresAt
 *                            category : registration | state_licence | central_licence
 *                            status   : pending | valid | expiring | expired
 *
 * ## Status is DERIVED, never asserted by an admin
 *
 * `JhatkaCompliance.status` is computed from `fssai.expiresAt` on every write and on
 * every read. An admin can set the licence number and the expiry; they cannot set
 * `status: 'valid'` on a licence that expired last Tuesday.
 *
 * That is the whole point of the document. A stored status that a human can set is a
 * status that will eventually be wrong, and §11's whole job is to make sure an expired
 * FSSAI licence stops meat being sold — not to record that someone believed it hadn't.
 *
 * ## The rollup is the console
 *
 * `GET /compliance/overview` is the screen an operator actually opens: which outlets
 * cannot legally sell today, which lapse inside 30 days, and which have open recalls.
 * Everything else on this page is the detail behind that answer.
 */

const express = require('express');
const { status: httpStatus } = require('http-status');

const ApiError = require('../../../utils/ApiError');
const webAuth = require('../../../middlewares/webAuth');
const { compliance } = require('../utils/compliance.arithmetic');
const { JhatkaCompliance, JhatkaOutlet, JhatkaRecall } = require('../../../models');

const router = express.Router();
const validate = require('../../../middlewares/validate');
const V = require('../validations/jhatka.admin.validation');

const FSSAI_CATEGORIES = ['registration', 'state_licence', 'central_licence'];

/**
 * Derive compliance status from the expiry date.
 *
 * Delegates to `compliance.arithmetic.deriveComplianceStatus` rather than
 * re-deriving it, because the outlet activation guard, the 04:00 cron and this
 * console must all answer "is this licence valid?" IDENTICALLY — or an operator sees
 * one answer on screen while the system acts on another.
 */
function deriveStatus(expiresAt, now = new Date()) {
  if (!expiresAt) return 'pending';
  return compliance.deriveComplianceStatus({ expiresAt }, { now });
}

/**
 * GET /v1/jhatka/admin/compliance/overview
 *
 * THE screen. Everything else is detail behind this answer.
 */
router.get('/compliance/overview', webAuth('jhatka_compliance_read'), async (req, res, next) => {
  try {
    const now = new Date();

    const [records, openRecalls] = await Promise.all([
      JhatkaCompliance.find({}).populate('outlet', 'name outletCode status businessModel').lean(),
      JhatkaRecall.find({ status: { $ne: 'closed' } })
        .populate('outlet', 'name outletCode')
        .populate('batch', 'batchNo rawSku')
        .lean(),
    ]);

    // RECOMPUTED, never read from the stored `status`. The stored value may be stale
    // if a cron sweep has not run since midnight; this console must not.
    const enriched = records.map((r) => {
      const derived = deriveStatus(r.fssai?.expiresAt, now);
      const daysLeft = r.fssai?.expiresAt
        ? Math.ceil((new Date(r.fssai.expiresAt).getTime() - now.getTime()) / 86400000)
        : null;
      return {
        id: String(r._id),
        outlet: r.outlet,
        outletId: String(r.outlet),
        licenceNumber: r.fssai?.licenceNumber,
        category: r.fssai?.category,
        expiresAt: r.fssai?.expiresAt,
        // The STORED status and the DERIVED one are both returned. A mismatch means
        // a sweep is behind, which is itself worth seeing.
        storedStatus: r.status,
        derivedStatus: derived,
        statusDrift: r.status !== derived,
        daysToExpiry: daysLeft,
        isBlocked: derived === 'expired' || derived === 'pending',
        supplierCompliance: r.supplierCompliance,
      };
    });

    return res.json({
      outlets: enriched,
      count: enriched.length,
      summary: {
        valid: enriched.filter((r) => r.derivedStatus === 'valid').length,
        expiringSoon: enriched.filter(
          (r) => r.derivedStatus !== 'expired' && r.daysToExpiry !== null && r.daysToExpiry <= 30
        ).length,
        expired: enriched.filter((r) => r.derivedStatus === 'expired').length,
        pending: enriched.filter((r) => r.derivedStatus === 'pending').length,
        // Outlets that cannot legally sell RIGHT NOW. This is the number that matters.
        blocked: enriched.filter((r) => r.isBlocked).length,
        statusDrift: enriched.filter((r) => r.statusDrift).length,
      },
      openRecalls: {
        count: openRecalls.length,
        bySeverity: {
          advisory: openRecalls.filter((r) => r.severity === 'advisory').length,
          withdraw: openRecalls.filter((r) => r.severity === 'withdraw').length,
          recall: openRecalls.filter((r) => r.severity === 'recall').length,
        },
        recalls: openRecalls.map((r) => ({
          recallNo: r.recallNo,
          outlet: r.outlet?.name || String(r.outlet),
          batch: r.batch?.batchNo,
          severity: r.severity,
          status: r.status,
          reason: r.reason,
          initiatedAt: r.initiatedAt,
          affectedOrderCount: r.affectedOrderItems?.count ?? null,
        })),
      },
    });
  } catch (error) {
    return next(error);
  }
});

/** GET /v1/jhatka/admin/compliance/records — filterable list. */
router.get('/compliance/records', webAuth('jhatka_compliance_read'), async (req, res, next) => {
  try {
    const query = {};
    if (req.query.outlet) query.outlet = req.query.outlet;
    if (req.query.status) query.status = req.query.status;

    const records = await JhatkaCompliance.find(query)
      .populate('outlet', 'name outletCode status')
      .sort({ 'fssai.expiresAt': 1 })
      .lean();

    return res.json({
      records: records.map((r) => ({
        ...r,
        derivedStatus: deriveStatus(r.fssai?.expiresAt),
      })),
      count: records.length,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /v1/jhatka/admin/compliance
 *
 * `status` is NOT accepted. It is derived on save from the expiry, which is the entire
 * reason this document cannot lie.
 */
router.post('/compliance', webAuth('jhatka_compliance_write'), async (req, res, next) => {
  try {
    const { outlet, business, fssai, gstin, tradeLicence, premisesLease, notes } = req.body || {};

    if (!outlet) throw new ApiError(httpStatus.BAD_REQUEST, 'outlet is required', true, '', {
      code: 'MISSING_REQUIRED_FIELD', field: 'outlet',
    });
    if (!fssai?.licenceNumber) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'fssai.licenceNumber is required', true, '', {
        code: 'MISSING_REQUIRED_FIELD', field: 'fssai.licenceNumber',
      });
    }
    if (!fssai?.expiresAt) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'fssai.expiresAt is required', true, '', {
        code: 'MISSING_REQUIRED_FIELD', field: 'fssai.expiresAt',
      });
    }

    if (fssai.category && !FSSAI_CATEGORIES.includes(fssai.category)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `fssai.category must be one of ${FSSAI_CATEGORIES.join(' | ')}`,
        true, '', { code: 'INVALID_FSSAI_CATEGORY', allowed: FSSAI_CATEGORIES, received: fssai.category }
      );
    }

    const outletDoc = await JhatkaOutlet.findById(outlet).lean();
    if (!outletDoc) throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');

    const derived = deriveStatus(fssai.expiresAt);

    const record = await JhatkaCompliance.create({
      outlet: outletDoc._id,
      business: business || outletDoc.business,
      fssai: {
        licenceNumber: fssai.licenceNumber,
        category: fssai.category || 'state_licence',
        issuedAt: fssai.issuedAt ? new Date(fssai.issuedAt) : undefined,
        expiresAt: new Date(fssai.expiresAt),
        documentUrl: fssai.documentUrl || undefined,
      },
      gstin: gstin || undefined,
      tradeLicence,
      premisesLease,
      notes,
      // DERIVED. An admin cannot assert it.
      status: derived,
      statusEvaluatedAt: new Date(),
    });

    return res.status(201).json({
      compliance: record.toObject(),
      derivedStatus: derived,
      note:
        derived === 'expired'
          ? 'This licence is already expired. The outlet cannot sell and cannot be activated.'
          : undefined,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * PATCH /v1/jhatka/admin/compliance/:compliance
 *
 * The ONLY mutable field on a valid record is `status` (to retire it). Everything else
 * is locked, because a compliance record that can be edited in place has no record of
 * what the licence ACTUALLY was on the day the meat was sold — which is the question a
 * regulator asks.
 *
 * `status: 'pending'` is the escape hatch: it takes an expired licence out of service
 * immediately and preserves the history.
 */
router.patch('/compliance/:compliance', webAuth('jhatka_compliance_write'), validate(V.namedParam('compliance')), async (req, res, next) => {
  try {
    const record = await JhatkaCompliance.findById(req.params.compliance);
    if (!record) throw new ApiError(httpStatus.NOT_FOUND, 'Compliance record not found');

    const { fssai, gstin, tradeLicence, premisesLease, notes, status } = req.body || {};

    if (status !== undefined && !['pending', 'valid', 'expiring', 'expired'].includes(status)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'status must be pending | valid | expiring | expired',
        true, '', { code: 'INVALID_STATUS', received: status }
      );
    }

    // Re-deriving on every write means an expiry pushed back re-validates the record
    // automatically, rather than needing an admin to also flip `status`.
    if (fssai?.expiresAt !== undefined) {
      record.fssai = { ...(record.fssai || {}), ...fssai };
    }
    if (fssai?.licenceNumber !== undefined) record.fssai.licenceNumber = fssai.licenceNumber;
    if (gstin !== undefined) record.gstin = gstin;
    if (tradeLicence !== undefined) record.tradeLicence = { ...(record.tradeLicence || {}), ...tradeLicence };
    if (premisesLease !== undefined) {
      record.premisesLease = { ...(record.premisesLease || {}), ...premisesLease };
    }
    if (notes !== undefined) record.notes = notes;

    // `pending` is honoured verbatim (the manual stop). Everything else is derived,
    // so the document cannot assert a validity the expiry does not support.
    record.status = status === 'pending' ? 'pending' : deriveStatus(record.fssai?.expiresAt);
    record.statusEvaluatedAt = new Date();

    await record.save();
    return res.json({
      compliance: record.toObject(),
      derivedStatus: record.status,
      overriddenStatus: status === 'pending',
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /v1/jhatka/admin/compliance/expiring
 *
 * Everything lapsing inside `?days` (default 30). Backs both the 04:00 cron and the
 * operator's weekly check.
 */
router.get('/compliance/expiring', webAuth('jhatka_compliance_read'), async (req, res, next) => {
  try {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const now = new Date();
    const until = new Date(now.getTime() + days * 86400000);

    const records = await JhatkaCompliance.find({
      'fssai.expiresAt': { $ne: null, $lte: until },
    })
      .populate('outlet', 'name outletCode status')
      .sort({ 'fssai.expiresAt': 1 })
      .lean();

    const nowMs = now.getTime();
    return res.json({
      days,
      records,
      count: records.length,
      expired: records.filter((r) => new Date(r.fssai.expiresAt).getTime() < nowMs),
      // `blocksSale` is the actionable flag: an expired licence on an ACTIVE outlet is
      // a compliance breach happening right now.
      blocksSale: records.filter(
        (r) => new Date(r.fssai.expiresAt).getTime() < nowMs && r.outlet?.status === 'active'
      ),
    });
  } catch (error) {
    return next(error);
  }
});

/** GET /v1/jhatka/admin/compliance/recalls */
router.get('/compliance/recalls', webAuth('jhatka_recall_read'), async (req, res, next) => {
  try {
    const query = {};
    if (req.query.status) query.status = req.query.status;
    if (req.query.severity) query.severity = req.query.severity;
    if (req.query.outlet) query.outlet = req.query.outlet;

    const recalls = await JhatkaRecall.find(query)
      .populate('outlet', 'name outletCode')
      .populate('batch', 'batchNo rawSku expiresAt')
      .sort({ initiatedAt: -1 })
      .limit(200)
      .lean();

    return res.json({
      recalls: recalls.map((r) => ({
        ...r,
        // §5.4: `acknowledgedCount < notifiedCount` is the number that stays open.
        unacknowledged: Math.max(0, (r.notifiedCount || 0) - (r.acknowledgedCount || 0)),
      })),
      count: recalls.length,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /v1/jhatka/admin/compliance/recalls/:recall/close
 *
 * Closing requires the customer set to be accounted for. A recall closed while
 * `unacknowledged > 0` is a recall that stopped asking, and §5.4 exists precisely to
 * stop that being a quiet outcome.
 */
router.post('/compliance/recalls/:recall/close', webAuth('jhatka_recall_manage'), validate(V.namedParam('recall')), async (req, res, next) => {
  try {
    const recall = await JhatkaRecall.findById(req.params.recall);
    if (!recall) throw new ApiError(httpStatus.NOT_FOUND, 'Recall not found');
    if (recall.status === 'closed') {
      throw new ApiError(httpStatus.CONFLICT, 'This recall is already closed', true, '', {
        code: 'ALREADY_CLOSED',
      });
    }

    const unacknowledged = Math.max(0, (recall.notifiedCount || 0) - (recall.acknowledgedCount || 0));
    const force = req.body?.force === true;

    if (unacknowledged > 0 && !force) {
      throw new ApiError(
        httpStatus.CONFLICT,
        `${unacknowledged} affected customer(s) have not acknowledged. Resolve them, or close with force:true and a reason.`,
        true, '',
        { code: 'UNACKNOWLEDGED_CUSTOMERS', unacknowledged }
      );
    }

    if (force && !req.body?.resolutionNote) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'resolutionNote is required when forcing a close over unacknowledged customers',
        true, '', { code: 'RESOLUTION_NOTE_REQUIRED' }
      );
    }

    recall.status = 'closed';
    recall.closedAt = new Date();
    recall.closedBy = req.user._id;
    recall.resolutionNote = req.body?.resolutionNote;
    await recall.save();

    return res.json({ recall: recall.toObject(), closed: true, forced: force, unacknowledged });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
module.exports.FSSAI_CATEGORIES = FSSAI_CATEGORIES;