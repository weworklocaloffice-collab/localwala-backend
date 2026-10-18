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
const { countryService } = require('../services');

const create = catchAsync(async (req, res) => {
  const result = await countryService.createCountry(req.body);
  res.send(result);
});

const get = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await countryService.getAllCountries(filter, options);
  res.send(result);
});

const update = catchAsync(async (req, res) => {
  const result = await countryService.updateCountryById(req.params.countryId, req.body);
  res.send(result);
});

const drop = catchAsync(async (req, res) => {
  await countryService.deleteCountryById(req.params.countryId);
  res.send({ success: true });
});

module.exports = {
  create,
  get,
  update,
  drop,
};

