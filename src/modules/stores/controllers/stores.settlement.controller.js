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
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const catchAsync = require('../../../utils/catchAsync');
const pick = require('../../../utils/pick');
const { StoreChain, StoreOutlet } = require('../../../models');
const settlementService = require('../services/stores.settlement.service');

/**
 * Partner settlement routes are session-scoped (BR-38). The active outlet is resolved by
 * `stores.tenant.js`; nothing on this surface may name another outlet's settlement.
 */
const activeOutletScope = (req) => {
  if (!req.outletId) {
    throw new ApiError(httpStatus.FORBIDDEN, 'No active outlet for this session');
  }
  return { outlet: req.outletId };
};

const generateSettlement = catchAsync(async (req, res) => {
  const { outlet: outletId } = activeOutletScope(req);
  const outlet = await StoreOutlet.findById(outletId).select('chain').lean();
  if (!outlet) throw new ApiError(httpStatus.NOT_FOUND, 'Active outlet not found');
  const chain = await StoreChain.findById(outlet.chain).select('business').lean();
  if (!chain) throw new ApiError(httpStatus.NOT_FOUND, 'Chain not found');

  const settlement = await settlementService.generateSettlement({
    vertical: 'stores',
    counterpartyType: 'store_owner',
    counterparty: chain.business,
    store: outlet._id,
    chain: chain._id,
    settlementType: 'order_revenue',
    period: req.body.period,
    from: req.body.from,
    to: req.body.to,
  });
  if (!settlement) {
    return res.status(httpStatus.OK).send({ message: 'No orders found for settlement period' });
  }
  res.status(httpStatus.CREATED).send({ settlement });
});

const getSettlement = catchAsync(async (req, res) => {
  const settlement = await settlementService.getSettlement(req.params.settlement, activeOutletScope(req));
  res.status(httpStatus.OK).send({ settlement });
});

const listSettlements = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['status', 'period', 'page', 'limit']);
  const result = await settlementService.listSettlements({
    ...filter,
    vertical: 'stores',
    store: activeOutletScope(req).outlet,
  });
  res.status(httpStatus.OK).send(result);
});

const markSettled = catchAsync(async (req, res) => {
  const settlement = await settlementService.markSettled(
    req.params.settlement,
    {
      ...req.body,
      approvedBy: req.user._id,
    },
    activeOutletScope(req),
  );
  res.status(httpStatus.OK).send({ settlement });
});

const markFailed = catchAsync(async (req, res) => {
  const settlement = await settlementService.markFailed(
    req.params.settlement,
    { failureReason: req.body.failureReason, by: req.user._id },
    activeOutletScope(req),
  );
  res.status(httpStatus.OK).send({ settlement });
});

const reverseSettlement = catchAsync(async (req, res) => {
  const settlement = await settlementService.reverseSettlement(
    req.params.settlement,
    {
      reason: req.body.reason,
      approvedBy: req.user._id,
    },
    activeOutletScope(req),
  );
  res.status(httpStatus.OK).send({ settlement });
});

module.exports = {
  generateSettlement,
  getSettlement,
  listSettlements,
  markSettled,
  markFailed,
  reverseSettlement,
};