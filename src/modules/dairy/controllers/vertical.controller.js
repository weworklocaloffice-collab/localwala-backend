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
const verticalService = require('../../../kernel/vertical/services/vertical.service');

/**
 * The vertical registry, as an operator sees it.
 *
 * ## The switch
 *
 * Turning a vertical off stops it taking **new** orders and subscriptions. It does
 * not cut off the business already on it: reads, in-flight deliveries, settlements
 * and rider payouts all keep working. See `vertical.service` for why that
 * distinction is the whole point.
 *
 * The list carries a `businessCount` per vertical on purpose — an operator about
 * to halt a line needs to see how many outlets are behind it, or the switch is a
 * guess.
 */

/**
 * @returns {Object[]} registered verticals
 */
const list = catchAsync(async (req, res) => {
  const verticals = await verticalService.listVerticals();
  res.send({ verticals });
});

/**
 * Turns one vertical on or off.
 *
 * @returns {Object} the vertical
 */
const setStatus = catchAsync(async (req, res) => {
  const vertical = await verticalService.setVerticalStatus(req.params.key, req.body.status, {
    actor: req.user._id,
    reason: req.body.reason,
  });
  res.send({ vertical });
});

module.exports = {
  list,
  setStatus,
};