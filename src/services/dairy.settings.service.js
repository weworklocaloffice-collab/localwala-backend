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
const { DairySettings } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Dairy platform settings.
 *
 * A singleton, like every other vertical's settings: `createSettings` refuses a
 * second document, and `getSettings` falls back to the model defaults when none
 * exists yet. That matters because the compliance service reads
 * `fefoWarningDays` before an operator has ever opened the settings screen — it must
 * get the default rather than null.
 */

/**
 * The current settings, or the defaults when nothing has been saved.
 *
 * @returns {Promise<Object>}
 */
const getSettings = async () => {
  const settings = await DairySettings.findOne();
  if (settings) {
    return settings;
  }

  // Not persisted yet. `new DairySettings()` applies the schema defaults, which is
  // why the defaults are declared on the model rather than here — one source.
  return new DairySettings({});
};

/**
 * The warning window in days, for callers that only need the number.
 *
 * Reads the stored value and falls back to the model default, so a code path never
 * has to handle a null settings document.
 *
 * @returns {Promise<number>}
 */
const getFefoWarningDays = async () => {
  const settings = await getSettings();
  const days = Number(settings.fefoWarningDays);
  return Number.isFinite(days) && days > 0 ? days : 30;
};

/**
 * The skip cutoff window, for callers that only need the number.
 *
 * Reads the stored value and falls back to the schema default, so a caller never
 * has to handle a null settings document. Mirrors `getFefoWarningDays` deliberately.
 *
 * @returns {Promise<number>}
 */
const getSubscriptionSkipCutoffHours = async () => {
  const settings = await getSettings();
  const hours = Number(settings.subscriptionSkipCutoffHours);
  return Number.isFinite(hours) && hours >= 0 ? hours : 9;
};

/**
 * Creates the settings document. Only ever one.
 *
 * @param {Object} param
 * @returns {Promise<Object>}
 */
const createSettings = async (param = {}) => {
  if ((await DairySettings.countDocuments()) > 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }

  return DairySettings.create({
    fefoWarningDays: normaliseDays(param.fefoWarningDays, 30),
    subscriptionSkipCutoffHours: normaliseHours(param.subscriptionSkipCutoffHours, 9),
    selfRegistration: param.selfRegistration === true,
  });
};

/**
 * Updates the settings, creating them on first save.
 *
 * Create-on-update rather than a 404: the admin screen loads with defaults, shows
 * them, and the operator presses save. Making that a create keeps the screen's
 * behaviour identical whether or not anyone has visited this tab before.
 *
 * @param {string} settingId
 * @param {Object} param
 * @returns {Promise<Object>}
 */
const updateSettings = async (settingId, param = {}) => {
  const update = {};

  if (param.fefoWarningDays !== undefined) {
    update.fefoWarningDays = normaliseDays(param.fefoWarningDays, 30);
  }
  if (param.subscriptionSkipCutoffHours !== undefined) {
    update.subscriptionSkipCutoffHours = normaliseHours(param.subscriptionSkipCutoffHours, 9);
  }
  if (param.selfRegistration !== undefined) {
    update.selfRegistration = param.selfRegistration === true;
  }

  const existing = await DairySettings.findById(settingId);
  if (!existing) {
    return createSettings(param);
  }

  const settings = await DairySettings.findByIdAndUpdate(settingId, update, {
    new: true,
    runValidators: true,
  });
  return settings;
};

/**
 * The admin panel sends `application/x-www-form-urlencoded`, so a number arrives as
 * a string and an untouched field arrives as `''`.
 *
 * `''` and `null` mean "not supplied", which is different from 0 — and 0 days would
 * make every licence read as expiring, so it falls back to the default rather than
 * being clamped.
 */
const normaliseDays = (value, fallback) => {
  if (value === '' || value === null || value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(365, Math.max(1, Math.round(parsed)));
};

/** Skip window: `''` / `null` / non-numeric fall back, everything else clamps to 0-48. */
const normaliseHours = (value, fallback) => {
  if (value === '' || value === null || value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(48, Math.max(0, Math.round(parsed)));
};

module.exports = {
  getSettings,
  getFefoWarningDays,
  getSubscriptionSkipCutoffHours,
  createSettings,
  updateSettings,
};