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

const { status: httpStatus } = require('http-status');
// Direct model require (not via ../models): this service is loaded by
// services/index.js, and going through the registry index from here would
// widen the load graph for no reason.
const JhatkaSettings = require('../modules/jhatka/models/jhatka.settings.model');
const ApiError = require('../utils/ApiError');

/**
 * Jhatka platform settings.
 *
 * A singleton, like every other vertical's settings: `createSettings` refuses a
 * second document, and `getSettings` falls back to the model defaults when none
 * exists yet. That matters because the weigh policy reads these numbers before
 * an operator has ever opened the settings screen — it must get the default
 * rather than null.
 */

/**
 * The current settings, or the defaults when nothing has been saved.
 *
 * @returns {Promise<Object>}
 */
const getSettings = async () => {
  const settings = await JhatkaSettings.findOne().lean();
  if (settings) {
    return settings;
  }

  // Not persisted yet. `new JhatkaSettings()` applies the schema defaults, which is
  // why the defaults are declared on the model rather than here — one source.
  // `toObject()` so callers get plain values, not a document.
  return new JhatkaSettings({}).toObject();
};

const numOr = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** Platform weight policy, for `resolvePolicy` — category and outlet win. */
const getWeightPolicy = async () => {
  const settings = await getSettings();
  return {
    tolerancePct: numOr(settings.weightTolerancePct, 5),
    hardOverchargePct: numOr(settings.weightHardOverchargePct, 10),
    hardShortfallPct: numOr(settings.weightHardShortfallPct, 2),
  };
};

/** Platform subscription ceiling, behind entry and variant values (BR-16). */
const getSubscriptionCeilingPct = async () => {
  const settings = await getSettings();
  return numOr(settings.subscriptionCeilingPct, 10);
};

/** Platform edit cutoff, behind `sub.editCutoffHours` (§9.7). */
const getEditCutoffHours = async () => {
  const settings = await getSettings();
  return numOr(settings.editCutoffHours, 12);
};

/** Platform COD tolerance, behind the category value (§3.6). */
const getCodTolerancePct = async () => {
  const settings = await getSettings();
  return numOr(settings.codTolerancePct, 10);
};

/** Platform transit cap, behind `outlet.qualityPolicy.maxTransitMinutes` (BR-12). */
const getMaxTransitMinutes = async () => {
  const settings = await getSettings();
  const minutes = numOr(settings.maxTransitMinutes, 120);
  return minutes > 0 ? minutes : 120;
};

/**
 * Creates the settings document. Only ever one.
 *
 * @param {Object} param
 * @returns {Promise<Object>}
 */
const createSettings = async (body) => {
  const existing = await JhatkaSettings.findOne().lean();
  if (existing) {
    throw new ApiError(
      httpStatus.CONFLICT,
      'Jhatka settings already exist — update them instead',
      true,
      '',
      { code: 'SETTINGS_ALREADY_EXIST', id: String(existing._id) }
    );
  }
  const created = await JhatkaSettings.create({ ...(body || {}) });
  return created;
};

const updateSettings = async (settingId, body) => {
  const updated = await JhatkaSettings.findByIdAndUpdate(
    settingId,
    { ...(body || {}) },
    { new: true, runValidators: true }
  ).lean();
  if (!updated) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Jhatka settings not found');
  }
  return updated;
};

module.exports = {
  getSettings,
  getWeightPolicy,
  getSubscriptionCeilingPct,
  getEditCutoffHours,
  getCodTolerancePct,
  getMaxTransitMinutes,
  createSettings,
  updateSettings,
};
