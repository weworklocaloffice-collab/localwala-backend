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
const catchAsync = require('../../../utils/catchAsync');
const pick = require('../../../utils/pick');
const inventoryService = require('../services/stores.inventory.service');

const adjustStock = catchAsync(async (req, res) => {
  const item = await inventoryService.adjustStock({
    ...req.body,
    outlet: req.outletId,
    chain: req.chainId,
    performedBy: req.user._id,
    performedByName: req.user.name,
  });
  res.status(httpStatus.OK).send({ item });
});

const getStockForOutlet = catchAsync(async (req, res) => {
  const items = await inventoryService.getStockForOutlet(req.outletId);
  res.status(httpStatus.OK).send({ items });
});

const getLowStockItems = catchAsync(async (req, res) => {
  const items = await inventoryService.getLowStockItems(req.outletId);
  res.status(httpStatus.OK).send({ items });
});

const getMovements = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['variant', 'limit']);
  const movements = await inventoryService.getMovements({ outlet: req.outletId, ...filter });
  res.status(httpStatus.OK).send({ movements });
});

module.exports = {
  adjustStock,
  getStockForOutlet,
  getLowStockItems,
  getMovements,
};