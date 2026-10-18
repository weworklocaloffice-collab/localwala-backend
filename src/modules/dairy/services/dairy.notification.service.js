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
const mongoose = require('mongoose');
const { DairyNotification } = require('../../../models');
const ApiError = require('../../../utils/ApiError');
const logger = require('../../../config/logger');

/**
 * Notices for dairy operators and riders.
 *
 * ## Emission never blocks the thing that triggered it
 *
 * `notify` is called from the middle of order processing, dispatch and compliance
 * work. A notice is a courtesy to the reader; failing an order because the
 * notification could not be written would be exactly backwards. So `notify`
 * returns `null` and logs on failure, and callers ignore the result.
 *
 * ## De-duplication
 *
 * Two things that happen repeatedly - a run dispatched every morning, a sweep
 * finding the same licence expiring - must not produce a notice per occurrence.
 * `dedupeKey` collapses those: within {@link DEDUPE_WINDOW_MINUTES}, an identical
 * key is not written twice. An operator who already saw it does not need it again
 * every morning, and a list that fills with the same row teaches people to ignore
 * the list.
 */

/** Same `dedupeKey` inside this window is written once. */
const DEDUPE_WINDOW_MINUTES = 60;

const DEDUPE_FIELD = 'dedupeKey';
const DEDUPE_AT = 'dedupeAt';

/**
 * Writes one notice.
 *
 * @param {Object} param user, business, kind, title, content, payload, dedupeKey
 * @returns {Promise<Object|null>} the notice, or null if it could not be written
 */
const notify = async (param) => {
  try {
    if (!param.user || !param.kind || !param.title) {
      // A malformed caller is a bug, not a data problem. Logged loudly; never
      // thrown, because the caller is mid-transaction.
      logger.error(
        `[dairy.notification] refusing a malformed notice: ${JSON.stringify({
          user: param.user,
          kind: param.kind,
        })}`
      );
      return null;
    }

    if (param.dedupeKey) {
      const cutoff = new Date(Date.now() - DEDUPE_WINDOW_MINUTES * 60000);
      const recent = await DairyNotification.findOne({
        user: param.user,
        [DEDUPE_FIELD]: param.dedupeKey,
        [DEDUPE_AT]: { $gte: cutoff },
      }).select('_id');

      if (recent) {
        return null;
      }
    }

    return DairyNotification.create({
      user: param.user,
      business: param.business,
      kind: param.kind,
      title: param.title,
      content: param.content,
      payload: param.payload || {},
      ...(param.dedupeKey ? { [DEDUPE_FIELD]: param.dedupeKey, [DEDUPE_AT]: new Date() } : {}),
    });
  } catch (error) {
    logger.error(`[dairy.notification] could not write a notice: ${error.message}`);
    return null;
  }
};

/**
 * The signed-in user's notices.
 *
 * Scoped by `userId` only. A caller cannot pass a user, so there is nothing to
 * tamper with.
 *
 * @param {string} userId
 * @param {Object} options unreadOnly, limit, page
 * @returns {Promise<Object>}
 */
const listForUser = async (userId, options = {}) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 20;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;

  const query = { user: userId, dismissed: false };
  if (options.unreadOnly) {
    query.readAt = null;
  }

  const [notifications, totalResults, unreadCount] = await Promise.all([
    DairyNotification.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
    DairyNotification.countDocuments(query),
    DairyNotification.countDocuments({ user: userId, dismissed: false, readAt: null }),
  ]);

  return { notifications, totalResults, unreadCount, page, limit };
};

/**
 * Marks notices read.
 *
 * With no `ids`, marks everything unread for the user - which is what a "mark all
 * read" button means. With `ids`, only those, and only the caller's own: the
 * filter carries `user` so a request naming another person's notice changes
 * nothing.
 *
 * @param {string} userId
 * @param {string[]} [ids]
 * @returns {Promise<Object>} how many were marked
 */
const markRead = async (userId, ids = null) => {
  const filter = { user: userId, readAt: null };
  if (Array.isArray(ids) && ids.length > 0) {
    filter._id = { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) };
  }

  const result = await DairyNotification.updateMany(filter, {
    $set: { readAt: new Date() },
  });

  return { markedRead: result.modifiedCount };
};

/**
 * Hides a notice from the list, keeping the row.
 *
 * Distinct from marking read: dismissing says "this does not concern me",
 * reading says "I have seen this". Collapsing them would lose the audit trail.
 *
 * @param {string} userId
 * @param {string} id
 * @returns {Promise<Object>}
 */
const dismiss = async (userId, id) => {
  const notification = await DairyNotification.findOne({ _id: id, user: userId });
  if (!notification) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Notification not found');
  }

  notification.dismissed = true;
  await notification.save();
  return notification;
};

// //// Emitters ////
//
// Thin wrappers that know the wording. Keeping the copy next to the trigger
// means the wording cannot drift from the event that caused it, and a caller
// never has to invent a title under time pressure.

/**
 * Tells a partner an order arrived at their outlet.
 *
 * @param {Object} param business, partnerUserId, order
 */
const notifyOrderPlaced = async (param) => {
  await notify({
    user: param.partnerUserId,
    business: param.business,
    kind: 'order_placed',
    title: 'New order',
    content: `Order #${param.order.orderNo} has arrived.`,
    payload: { order: param.order.id || String(param.order._id), amount: param.order.grandTotal },
  });
};

/**
 * Tells a customer their order moved.
 *
 * @param {Object} param userId, order, status
 */
const notifyOrderStatus = async (param) => {
  await notify({
    user: param.userId,
    business: param.business,
    kind: 'order_status',
    title: 'Order update',
    content: `Order #${param.order.orderNo} is now ${String(param.status).replace(/_/g, ' ')}.`,
    payload: { order: param.order.id || String(param.order._id), status: param.status },
  });
};

/**
 * Tells a partner a run is out.
 *
 * De-duplicated per run and day: the same run is dispatched once, but a retry or
 * a second dispatch attempt should not produce a second notice.
 *
 * @param {Object} param partnerUserId, business, run
 */
const notifyRunDispatched = async (param) => {
  await notify({
    user: param.partnerUserId,
    business: param.business,
    kind: 'run_dispatched',
    title: 'Delivery run dispatched',
    content: `Run #${param.run.runNo} is on the road.`,
    payload: { run: param.run.id || String(param.run._id) },
    dedupeKey: `run_dispatched:${param.run.id || param.run._id}`,
  });
};

/**
 * Tells a partner their FSSAI licence is close to expiry.
 *
 * De-duplicated per licence per day, because the compliance sweep runs on a cron
 * and would otherwise write the same notice every hour.
 *
 * @param {Object} param partnerUserId, business, licence, expiresAt, daysLeft
 */
const notifyFssaiExpiry = async (param) => {
  const days = Number(param.daysLeft || 0);
  const urgent = days <= 7;

  await notify({
    user: param.partnerUserId,
    business: param.business,
    kind: 'fssai_expiry',
    title: urgent ? 'FSSAI licence expiring' : 'FSSAI licence expiry approaching',
    content: `Your FSSAI licence expires in ${days} day${days === 1 ? '' : 's'}.`,
    payload: { expiresAt: param.expiresAt, daysLeft: days },
    dedupeKey: `fssai_expiry:${param.business}:${param.expiresAt}`,
  });
};

/**
 * Tells a partner a settlement was paid.
 *
 * @param {Object} param partnerUserId, business, settlement
 */
const notifySettlementPaid = async (param) => {
  await notify({
    user: param.partnerUserId,
    business: param.business,
    kind: 'settlement_paid',
    title: 'Settlement paid',
    content: `Settlement #${param.settlement.settlementNo} has been paid.`,
    payload: {
      settlement: param.settlement.id || String(param.settlement._id),
      amount: param.settlement.totals && param.settlement.totals.netAmount,
    },
  });
};

/**
 * Tells a partner a rider payout was recorded.
 *
 * @param {Object} param partnerUserId, business, driver, amount
 */
const notifyPayoutRecorded = async (param) => {
  await notify({
    user: param.partnerUserId,
    business: param.business,
    kind: 'payout_recorded',
    title: 'Rider paid',
    content: `Paid ${param.driverName} ₹${param.amount}.`,
    payload: {
      driver: param.driver.id || String(param.driver._id),
      amount: param.amount,
    },
  });
};

module.exports = {
  DEDUPE_WINDOW_MINUTES,
  notify,
  listForUser,
  markRead,
  dismiss,
  notifyOrderPlaced,
  notifyOrderStatus,
  notifyRunDispatched,
  notifyFssaiExpiry,
  notifySettlementPaid,
  notifyPayoutRecorded,
};