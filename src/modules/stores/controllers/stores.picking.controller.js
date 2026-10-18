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
const catchAsync = require('../../../utils/catchAsync');
const orderService = require('../services/stores.order.service');
const pickingService = require('../services/stores.picking.service');

const getPickList = catchAsync(async (req, res) => {
  const pickList = await pickingService.getPickList(req.params.order, { outlet: req.outletId });
  res.status(httpStatus.OK).send({ pickList });
});

// Records a per-line pick/unavailable decision. BR-31: no silent substitution;
// `substituted` demands BOTH the chosen substitute and a mandatory note.
const pickItem = catchAsync(async (req, res) => {
  const order = await pickingService.pickItem({
    orderId: req.params.order,
    outlet: req.outletId,
    variant: req.body.variant,
    pickedQuantity: req.body.pickedQuantity,
    status: req.body.status,
    resolution: req.body.resolution,
    substituteVariant: req.body.substituteVariant,
    note: req.body.note,
  });

  // Picking comes after acceptance. Moving here on first item both protects the
  // counter from acting on a stale `created` order and gives the packing gate a state.
  if (order.lifecycle === 'accepted') {
    await orderService.transitionOrder(req.params.order, 'picking', { actor: req.user._id });
  }

  const refreshed = await orderService.getOrder(req.params.order);
  res.status(httpStatus.OK).send({ order: refreshed });
});

const completePacking = catchAsync(async (req, res) => {
  const order = await pickingService.completePacking({
    orderId: req.params.order,
    outlet: req.outletId,
    packageCount: req.body.packageCount,
    totalWeightGrams: req.body.totalWeightGrams,
    fragile: req.body.fragile,
    specialHandling: req.body.specialHandling,
    note: req.body.note,
  });

  if (order.lifecycle === 'picking') {
    await orderService.transitionOrder(req.params.order, 'packing', { actor: req.user._id });
  }

  const refreshed = await orderService.getOrder(req.params.order);
  res.status(httpStatus.OK).send({ order: refreshed });
});

const getFulfilmentSummary = catchAsync(async (req, res) => {
  const summary = await pickingService.calculatePartialFulfilment(req.params.order, { outlet: req.outletId });
  res.status(httpStatus.OK).send(summary);
});

module.exports = {
  getPickList,
  pickItem,
  completePacking,
  getFulfilmentSummary,
};
