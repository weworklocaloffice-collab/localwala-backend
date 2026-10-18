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
 * FSSAI licensing, hygiene checks and document expiry for a dairy outlet.
 *
 * The value here is not storing dates — it is never letting a stale answer
 * through. A licence expires on a fixed day whether or not anyone looks at it, so
 * every status is *derived* from the dates at the moment it is asked for, and the
 * cached `status` column exists only so dashboards can filter without recomputing
 * for every outlet. `refreshStatus` re-derives it, and the summary endpoint
 * reports the live figures alongside the cached flag so a stale cache is visible
 * rather than silently trusted.
 */

const { status: httpStatus } = require('http-status');
const { DairyCompliance, Business } = require('../../../models');
const ApiError = require('../../../utils/ApiError');
const notificationService = require('./dairy.notification.service');
// Required lazily inside `resolveWarningDays`: `src/services/index.js` pulls in every
// service, including this one via the dairy barrel, so a top-level require here would
// close a cycle. Deferring to call time keeps module init acyclic.

/**
 * Fallback warning window, used only when the settings service cannot be reached.
 *
 * This was the whole implementation before the `dairy_settings` tab existed. It is
 * retained as a fallback rather than the default source so the behaviour on a fresh
 * database is unchanged, but the live value now comes from
 * `dairySettingsService.getFefoWarningDays()`, overridable in Business Setup.
 */
const WARNING_DAYS = 30;

const DAY_MS = 86400000;

/**
 * Reads the configured warning window, never throwing.
 *
 * Compliance is on the read path of dashboards and order-adjacent screens, so a
 * settings lookup failure must not take the page down with it — falling back to the
 * previous hardcoded behaviour is both safe and non-disruptive.
 *
 * @returns {Promise<number>}
 */
const resolveWarningDays = async () => {
  try {
    const { dairySettingsService } = require('../../../services');
    return await dairySettingsService.getFefoWarningDays();
  } catch {
    return WARNING_DAYS;
  }
};

/**
 * Days from today until `date`.
 *
 * @returns {number|null} null when there is no date
 */
const daysUntil = (date) => {
  if (!date) return null;
  return Math.ceil((new Date(date).getTime() - Date.now()) / DAY_MS);
};

/**
 * The compliance state implied by the licence dates.
 *
 * Pure, so the same rule can be applied to one record, a list, or a sweep.
 *
 * @param {Object} compliance
 * @returns {string} pending | valid | expiring | expired
 */
const deriveStatus = (compliance, warningDays = WARNING_DAYS) => {
  const licence = compliance.fssai || {};
  if (!licence.licenceNumber || !licence.expiresAt) {
    return 'pending';
  }

  const remaining = daysUntil(licence.expiresAt);
  if (remaining < 0) {
    return 'expired';
  }
  if (remaining <= warningDays) {
    return 'expiring';
  }
  return 'valid';
};

/**
 * Recomputes and stores the cached status.
 *
 * @param {Object} compliance
 * @returns {Promise<Object>} the saved record
 */
const refreshStatus = async (compliance, warningDays) => {
  const days = warningDays ?? (await resolveWarningDays());
  compliance.status = deriveStatus(compliance, days);
  compliance.statusEvaluatedAt = new Date();
  await compliance.save();
  return compliance;
};

const getCompliance = async (businessId) => {
  const compliance = await DairyCompliance.findOne({ business: businessId });
  if (!compliance) {
    throw new ApiError(httpStatus.NOT_FOUND, 'No compliance record for this outlet');
  }
  return compliance;
};

/**
 * The record for an outlet, created empty on first read.
 *
 * Upsert rather than 404 so the partner app has something to render before the
 * paperwork is uploaded, which is the state most outlets start in.
 */
const getOrCreateCompliance = async (businessId) => {
  const existing = await DairyCompliance.findOne({ business: businessId });
  if (existing) {
    return existing;
  }
  return DairyCompliance.create({ business: businessId });
};

/**
 * Records or replaces the FSSAI licence.
 *
 * Replaces rather than merges: a renewed licence is a new number and a new expiry
 * date, and keeping the old one around invites the wrong expiry being read.
 */
const setLicence = async (businessId, param) => {
  const compliance = await getOrCreateCompliance(businessId);

  compliance.fssai = {
    licenceNumber: param.licenceNumber,
    issuedAt: param.issuedAt,
    expiresAt: param.expiresAt,
    documentUrl: param.documentUrl,
    category: param.category || 'petrol',
  };

  await refreshStatus(compliance);
  return compliance;
};

/**
 * Appends a hygiene check.
 *
 * Append-only: a failed check is evidence, so it is added and never edited.
 */
const recordHygieneCheck = async (businessId, param) => {
  const compliance = await getOrCreateCompliance(businessId);

  compliance.hygieneChecks.push({
    checkType: param.checkType,
    result: param.result,
    // Defaults to now so a backdated import is the caller's explicit choice.
    checkedAt: param.checkedAt || new Date(),
    checkedBy: param.checkedBy,
    nextDueAt: param.nextDueAt,
    notes: param.notes,
    proofUrls: param.proofUrls || [],
  });

  await compliance.save();
  return compliance;
};

/**
 * Adds a dated document.
 */
const addDocument = async (businessId, param) => {
  const compliance = await getOrCreateCompliance(businessId);

  compliance.documents.push({
    type: param.type,
    reference: param.reference,
    issuedAt: param.issuedAt,
    expiresAt: param.expiresAt,
    fileUrl: param.fileUrl,
  });

  await compliance.save();
  return compliance;
};

/**
 * The latest result for each check type.
 *
 * A type can be checked many times; a dashboard wants the current standing, not
 * every historical reading.
 */
const latestHygieneChecks = (compliance) => {
  const latest = new Map();
  (compliance.hygieneChecks || []).forEach((check) => {
    const existing = latest.get(check.checkType);
    if (!existing || new Date(check.checkedAt) > new Date(existing.checkedAt)) {
      latest.set(check.checkType, check);
    }
  });
  return Array.from(latest.values());
};

/**
 * Live compliance standing for an outlet.
 *
 * Recomputed rather than read from the cache, so the answer is correct even if
 * nothing has called `refreshStatus` for a while. `cacheFresh` reports whether
 * the stored status still agrees.
 */
const getSummary = async (businessId) => {
  const compliance = await getOrCreateCompliance(businessId);
  const warningDays = await resolveWarningDays();
  const liveStatus = deriveStatus(compliance, warningDays);
  const checks = latestHygieneChecks(compliance);

  const failing = checks.filter((c) => c.result === 'fail');
  const conditional = checks.filter((c) => c.result === 'conditional');
  const overdue = checks.filter(
    (c) => c.nextDueAt && new Date(c.nextDueAt).getTime() < Date.now()
  );

  const documentsExpiring = (compliance.documents || [])
.filter((doc) => {
        const remaining = daysUntil(doc.expiresAt);
        return remaining !== null && remaining <= warningDays;
      })
    .map((doc) => ({ ...doc.toObject ? doc.toObject() : doc, daysRemaining: daysUntil(doc.expiresAt) }));

  return {
    status: liveStatus,
    /** True when the stored `status` still matches the dates. */
    cacheFresh: compliance.status === liveStatus,
    daysToExpiry: daysUntil(compliance.fssai && compliance.fssai.expiresAt),
    licence: compliance.fssai || null,
    hygiene: {
      total: (compliance.hygieneChecks || []).length,
      latest: checks,
      failing: failing.length,
      conditional: conditional.length,
      overdue: overdue.length,
    },
    documents: {
      total: (compliance.documents || []).length,
      expiringSoon: documentsExpiring,
    },
  };
};

/**
 * Every outlet whose licence has lapsed or is about to.
 *
 * The sweep a compliance dashboard or a cron job runs. Returns the live status
 * alongside the cached one so a stale record is obvious.
 *
 * @param {Object} options
 * @param {number} options.days how far ahead to look
 */
const listExpiring = async (options = {}) => {
  const warningDays = await resolveWarningDays();
  // An explicit `days` is the caller asking for a wider/narrower horizon for the
  // query only. It deliberately does NOT change what "expiring" means, so the
  // statuses below stay comparable with every other compliance surface.
  const days = options.days && options.days > 0 ? options.days : warningDays;
  const horizon = new Date(Date.now() + days * DAY_MS);

  const records = await DairyCompliance.find({
    'fssai.expiresAt': { $ne: null, $lte: horizon },
  })
    .populate('business', 'name businessModel status')
    .sort({ 'fssai.expiresAt': 1 });

  return records.map((record) => ({
    _id: record._id,
    business: record.business,
    licenceNumber: record.fssai ? record.fssai.licenceNumber : null,
    expiresAt: record.fssai ? record.fssai.expiresAt : null,
    daysRemaining: daysUntil(record.fssai && record.fssai.expiresAt),
    liveStatus: deriveStatus(record, warningDays),
    cachedStatus: record.status,
    cacheFresh: record.status === deriveStatus(record, warningDays),
  }));
};

/**
 * Re-derives `status` for every record.
 *
 * Meant for a scheduled job. Records whose status did not change are left
 * untouched so an unchanged sweep writes nothing.
 *
 * @returns {Promise<{checked: number, changed: number}>}
 */
const refreshAllStatuses = async () => {
  const records = await DairyCompliance.find({});
  const warningDays = await resolveWarningDays();
  let changed = 0;

  for (const record of records) {
    const next = deriveStatus(record, warningDays);
    if (record.status !== next) {
      record.status = next;
      record.statusEvaluatedAt = new Date();
      await record.save();
      changed += 1;
    }
  }

  return { checked: records.length, changed };
};

/**
 * Notifies outlets whose licence is close to expiry.
 *
 * Separate from {@link listExpiring} so a dashboard can read the list without
 * writing a notice. Meant for a scheduled job - the sweep writes nothing on its
 * own, so a cron that runs hourly would otherwise spam every operator with the
 * same warning.
 *
 * Notices are de-duplicated per licence by the notification service, so this is
 * safe to call as often as the schedule runs.
 *
 * @param {Object} options days how far ahead to look
 * @returns {Promise<{checked: number, notified: number}>}
 */
const notifyExpiring = async (options = {}) => {
  const expiring = await listExpiring(options);
  let notified = 0;

  for (const record of expiring) {
    const businessId = record.business && record.business._id
      ? record.business._id
      : record.business;
    if (!businessId) {
      continue;
    }

    const outlet = await Business.findById(businessId).select('owner vertical status');
    if (!outlet || outlet.vertical !== 'dairy' || !outlet.owner) {
      continue;
    }

    const written = await notificationService.notifyFssaiExpiry({
      partnerUserId: outlet.owner,
      business: businessId,
      expiresAt: record.expiresAt,
      daysLeft: record.daysRemaining,
    });

    if (written) {
      notified += 1;
    }
  }

  return { checked: expiring.length, notified };
};

module.exports = {
  WARNING_DAYS,
  deriveStatus,
  daysUntil,
  refreshStatus,
  getCompliance,
  getOrCreateCompliance,
  setLicence,
  recordHygieneCheck,
  addDocument,
  latestHygieneChecks,
  getSummary,
  listExpiring,
  refreshAllStatuses,
  notifyExpiring,
};
