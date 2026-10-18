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
const catchAsync = require('../utils/catchAsync');
const pick = require('../utils/pick');
const { restaurantTableService } = require('../services');

const create = catchAsync(async (req, res) => {
  const table = await restaurantTableService.createTable(req.body);
  res.status(201).send(table);
});

const get = catchAsync(async (req, res) => {
  const { restaurant } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await restaurantTableService.getMyTableList(restaurant, options);
  res.send(result);
});

const updateStatus = catchAsync(async (req, res) => {
  const { id } = req.params;
  const table = await restaurantTableService.updateStatus(id, req.body);
  res.send(table);
});

const updateTable = catchAsync(async (req, res) => {
  const { id } = req.params;
  const table = await restaurantTableService.updateRestaurantTable(id, req.body);
  res.send(table);
});

const drop = catchAsync(async (req, res) => {
  const { id } = req.params;
  const table = await restaurantTableService.deleteTable(id);
  res.send(table);
});

const waiterTableList = catchAsync(async (req, res) => {
  const { vendor } = req.params;
  const result = await restaurantTableService.waiterTableList(vendor);
  res.send(result);
});

module.exports = {
  create,
  get,
  updateStatus,
  updateTable,
  drop,
  waiterTableList,
};

