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
const { userAddressService } = require('../services');

const saveAddress = catchAsync(async (req, res) => {
  const result = await userAddressService.saveAddress(req.body);
  res.send(result);
});

const getDeliveryAddressList = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userAddressService.getDeliveryAddressList(id);
  res.send(result);
});

const updateAddress = catchAsync(async (req, res) => {
  const result = await userAddressService.updateAddress(req.params.id, req.body);
  res.send(result);
});

const drop = catchAsync(async (req, res) => {
  await userAddressService.deleteAddress(req.params.id);
  res.send({ success: true });
});

const getMyAddressListFromRestaurant = catchAsync(async (req, res) => {
  const { user, restaurant } = req.body;
  const result = await userAddressService.getMyAddressListFromRestaurant(user, restaurant);
  res.send(result);
});

const customerAddressList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['user', 'limit', 'page']);
  const result = await userAddressService.customerAddressList(options);
  res.send(result);
});

module.exports = {
  saveAddress,
  getDeliveryAddressList,
  updateAddress,
  drop,
  getMyAddressListFromRestaurant,
  customerAddressList,
};

