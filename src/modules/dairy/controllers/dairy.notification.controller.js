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

const catchAsync = require('../../../utils/catchAsync');
const pick = require('../../../utils/pick');
const notificationService = require('../services/dairy.notification.service');

/**
 * The signed-in person's notices.
 *
 * Every handler passes `req.user._id` and nothing else. There is no user
 * parameter on any of these routes, so a caller cannot ask for someone else's
 * list - which is the only reason a notification endpoint is safe to have.
 *
 * These serve partners and riders alike: the notice is addressed to a person, not
 * to a role, so one controller covers both shells of the merged app.
 */

/**
 * @returns {Object} paginated notifications with an unread count
 */
const list = catchAsync(async (req, res) => {
  const result = await notificationService.listForUser(req.user._id, req.query);
  res.send(
    pick(result, ['notifications', 'totalResults', 'unreadCount', 'page', 'limit'])
  );
});

/**
 * Marks notices read - all of them, or the named ones.
 *
 * `ids` is optional and filters within the caller's own notices either way, so
 * naming another person's id changes nothing.
 */
const markRead = catchAsync(async (req, res) => {
  const ids = Array.isArray(req.body.ids) && req.body.ids.length > 0 ? req.body.ids : null;
  const result = await notificationService.markRead(req.user._id, ids);
  res.send(result);
});

/** Hides one notice from the list, keeping the row for audit. */
const dismiss = catchAsync(async (req, res) => {
  const notification = await notificationService.dismiss(req.user._id, req.params.notification);
  res.send({ notification });
});

module.exports = {
  list,
  markRead,
  dismiss,
};