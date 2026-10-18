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

const catchAsync = require('../utils/catchAsync');
const pick = require('../utils/pick');
const { deliverymanPayoutMethodService } = require('../services');

const create = catchAsync(async (req, res) => {
  const result = await deliverymanPayoutMethodService.savePayoutMethod(req.body);
  res.send(result);
});

const getMyPayoutMethodList = catchAsync(async (req, res) => {
  const { deliveryman } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await deliverymanPayoutMethodService.getMyPayoutMethodList(deliveryman, options);
  res.send(result);
});

const deletePayoutMethod = catchAsync(async (req, res) => {
  const { deliveryman, id } = req.params;
  const result = await deliverymanPayoutMethodService.deletePayoutMethod(deliveryman, id);
  res.send(result);
});

const getPayoutMethodDetail = catchAsync(async (req, res) => {
  const { deliveryman, id } = req.params;
  const result = await deliverymanPayoutMethodService.getPayoutMethodDetail(deliveryman, id);
  res.send(result);
});

const updatePayoutMethodDetail = catchAsync(async (req, res) => {
  const { deliveryman, id, formElement } = req.body;
  const result = await deliverymanPayoutMethodService.updatePayoutMethodDetail(
    deliveryman,
    id,
    formElement
  );
  res.send(result);
});

const changeDefaultPayoutMethod = catchAsync(async (req, res) => {
  const { id, deliveryman, isDefault } = req.body;
  const result = await deliverymanPayoutMethodService.changeDefaultPayoutMethod(
    id,
    deliveryman,
    isDefault
  );
  res.send(result);
});

const deliverymanPayoutAccounts = catchAsync(async (req, res) => {
  const options = pick(req.query, ['deliveryman', 'limit', 'page']);
  const result = await deliverymanPayoutMethodService.deliverymanPayoutAccounts(options);
  res.send(result);
});

module.exports = {
  create,
  getMyPayoutMethodList,
  deletePayoutMethod,
  getPayoutMethodDetail,
  updatePayoutMethodDetail,
  changeDefaultPayoutMethod,
  deliverymanPayoutAccounts,
};

