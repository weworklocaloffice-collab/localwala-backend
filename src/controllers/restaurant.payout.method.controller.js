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
const { restaurantPayoutMethodService } = require('../services');

const create = catchAsync(async (req, res) => {
  const result = await restaurantPayoutMethodService.savePayoutMethod(req.body);
  res.send(result);
});

const getMyPayoutMethodList = catchAsync(async (req, res) => {
  const { vendor } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await restaurantPayoutMethodService.getMyPayoutMethodList(vendor, options);
  res.send(result);
});

const deletePayoutMethod = catchAsync(async (req, res) => {
  const { vendor, id } = req.params;
  const result = await restaurantPayoutMethodService.deletePayoutMethod(vendor, id);
  res.send(result);
});

const getPayoutMethodDetail = catchAsync(async (req, res) => {
  const { vendor, id } = req.params;
  const result = await restaurantPayoutMethodService.getPayoutMethodDetail(vendor, id);
  res.send(result);
});

const updatePayoutMethodDetail = catchAsync(async (req, res) => {
  const { restaurant, id, formElement } = req.body;
  const result = await restaurantPayoutMethodService.updatePayoutMethodDetail(
    restaurant,
    id,
    formElement
  );
  res.send(result);
});

const changeDefaultPayoutMethod = catchAsync(async (req, res) => {
  const { id, restaurant, isDefault } = req.body;
  const result = await restaurantPayoutMethodService.changeDefaultPayoutMethod(
    id,
    restaurant,
    isDefault
  );
  res.send(result);
});

const vendorPayoutAccounts = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'limit', 'page']);
  const result = await restaurantPayoutMethodService.vendorPayoutAccounts(options);
  res.send(result);
});

module.exports = {
  create,
  getMyPayoutMethodList,
  deletePayoutMethod,
  getPayoutMethodDetail,
  updatePayoutMethodDetail,
  changeDefaultPayoutMethod,
  vendorPayoutAccounts,
};

