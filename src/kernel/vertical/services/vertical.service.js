/*
 * LocalWala - Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright (c) 2026 WeWorkLocal Private Limited
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
const { Vertical, Business } = require('../../../models');
const ApiError = require('../../../utils/ApiError');
const logger = require('../../../config/logger');

/**
 * The vertical registry, and the switch that stops a business line trading.
 *
 * The `Vertical` collection has existed since the kernel was laid out, seeded with
 * `dairy`, but nothing ever read it. `Business.vertical` was a free string with a
 * default, so `'pharmacy'` would have been accepted silently. This service is what
 * makes the registry real.
 *
 * ## What "off" means
 *
 * Turning a vertical off **stops new trading but does not stop the business
 * already on it.** Specifically:
 *
 *   blocked  - new orders and new subscriptions
 *   allowed  - everything reads, plus delivery of what is already in flight
 *
 * That distinction is the whole design. A rider mid-run finishes their run; a
 * partner can still see their orders, settle up, and pay a rider. The alternative
 * — rejecting all traffic for the vertical — would strand a rider between stops
 * and leave a customer with an order nobody can complete.
 *
 * The level is stated once, in {@link TRADING_HALTED}, and read through
 * {@link assertTradingOpen}. Moving to a stricter level is a change to this file
 * and this gate, not a hunt through every caller.
 */

/** Whether a halted vertical still takes new orders. */
const TRADING_HALTED = true;

// //// Registry ////

/**
 * Every registered vertical, in the order an operator should see them.
 *
 * @returns {Promise<Array>} verticals, each with the outlet count that uses it
 */
const listVerticals = async () => {
  const verticals = await Vertical.find({}).sort({ sortOrder: 1, name: 1 }).lean();

  // How many outlets sit behind each. An operator turning a line off needs to see
  // the blast radius, not just the name.
  const counts = await Business.aggregate([
    { $group: { _id: '$vertical', total: { $sum: 1 } } },
  ]);

  const byVertical = new Map(counts.map((row) => [String(row._id), row.total]));

  return verticals.map((vertical) => ({
    ...vertical,
    businessCount: byVertical.get(vertical.key) || 0,
  }));
};

/**
 * The registry record for one key, or null.
 *
 * Deliberately does not throw: a missing vertical is a normal state for a code
 * that has not been registered, and the callers need to treat it differently
 * (refuse, versus "off").
 *
 * @param {string} key
 * @returns {Promise<Object|null>}
 */
const findVertical = async (key) => Vertical.findOne({ key: String(key).toLowerCase() });

/**
 * Whether a vertical accepts new orders and subscriptions.
 *
 * @param {string} key
 * @returns {Promise<boolean>} true when trading is open
 */
const isTradingOpen = async (key) => {
  const vertical = await findVertical(key);

  // An unregistered key is treated as closed. That is the safe direction: a typo
  // in `Business.vertical` must not open a business line nobody registered.
  if (!vertical) {
    return false;
  }
  return vertical.status === true;
};

/**
 * Throws if the vertical is halted, or unknown.
 *
 * Called on the write paths that *start* something new. Reads are never blocked —
 * an operator working a halted vertical still needs to see the data, and a customer
 * still needs to follow an order already placed.
 *
 * @param {string} key
 * @param {string} action what was being attempted, for the error message
 * @returns {Promise<void>}
 */
const assertTradingOpen = async (key, action) => {
  if (await isTradingOpen(key)) {
    return;
  }

  const vertical = await findVertical(key);
  if (!vertical) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `No vertical is registered as "${key}" — it cannot trade`
    );
  }

  throw new ApiError(
    httpStatus.SERVICE_UNAVAILABLE,
    `${vertical.name} is temporarily unavailable, so ${action} is not possible right now. ` +
      'Anything already in progress continues as normal.'
  );
};

/**
 * Confirms a vertical is registered, and open, before a business is created.
 *
 * Stops `'pharmacy'` reaching the `businesses` collection: `Business.vertical` is
 * a plain string, so without this nothing would notice an unregistered value until
 * the first query that filtered on it returned nothing.
 *
 * @param {string} key
 * @param {Object} [options] requireOpen false to allow creating on a halted vertical
 * @returns {Promise<void>}
 */
const assertRegistered = async (key, options = {}) => {
  const vertical = await findVertical(key);

  if (!vertical) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `"${key}" is not a registered vertical`
    );
  }

  if (options.requireOpen !== false) {
    await assertTradingOpen(key, 'a new outlet cannot be opened');
  }
};

// //// Operator actions ////

/**
 * Turns a vertical on or off, recording who and when.
 *
 * @param {string} key
 * @param {boolean} status
 * @param {Object} param actor, reason
 * @returns {Promise<Object>} the vertical
 */
const setVerticalStatus = async (key, status, param = {}) => {
  const vertical = await findVertical(key);
  if (!vertical) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Vertical not found');
  }

  const next = status === true;
  if (vertical.status === next) {
    return vertical;
  }

  // A halt stops live trading, so the count is what tells the operator whether
  // they are pausing a new line or pulling one out from under real outlets.
  const businessCount = await Business.countDocuments({ vertical: vertical.key });

  vertical.status = next;
  vertical.statusChangedBy = param.actor || null;
  vertical.statusChangedAt = new Date();
  vertical.statusReason = param.reason || null;
  await vertical.save();

  logger.info(
    `[dairy.vertical] ${vertical.key} ${next ? 'enabled' : 'halted'} by ` +
      `${param.actor || 'unknown'} — ${businessCount} outlet(s) on this vertical`
  );

  return vertical;
};

module.exports = {
  TRADING_HALTED,
  listVerticals,
  findVertical,
  isTradingOpen,
  assertTradingOpen,
  assertRegistered,
  setVerticalStatus,
};