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
const { joiningFormService } = require('../services');

const saveRestaurantForm = catchAsync(async (req, res) => {
  const { formField } = req.body;
  const result = await joiningFormService.saveRestaurantForm(formField);
  res.send(result);
});

const saveDeliverymanForm = catchAsync(async (req, res) => {
  const { formField } = req.body;
  const result = await joiningFormService.saveDeliverymanForm(formField);
  res.send(result);
});

const getRestaurantForm = catchAsync(async (req, res) => {
  const result = await joiningFormService.getRestaurantForm();
  res.send(result);
});

const getDeliverymanForm = catchAsync(async (req, res) => {
  const result = await joiningFormService.getDeliverymanForm();
  res.send(result);
});

module.exports = {
  saveRestaurantForm,
  saveDeliverymanForm,
  getRestaurantForm,
  getDeliverymanForm,
};

