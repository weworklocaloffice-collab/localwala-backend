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
const { Country } = require('../models');
const ApiError = require('../utils/ApiError');

const createCountry = async (countryBody) => {
  if (await Country.isNameTaken(countryBody.name)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  return Country.create(countryBody);
};

const getAllCountries = async (filter, options) => {
  return { filter, options };
};

const getCountryId = async (id) => {
  return Country.findById(id);
};

const updateCountryById = async (countryId, updateBody) => {
  const country = await getCountryId(countryId);
  if (!country) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (updateBody.name && (await Country.isNameTaken(updateBody.name, countryId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  Object.assign(country, updateBody);
  await country.save();
  return country;
};

const deleteCountryById = async (countryId) => {
  const country = await getCountryId(countryId);
  if (!country) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await country.deleteOne();
  return country;
};

module.exports = {
  createCountry,
  getAllCountries,
  getCountryId,
  updateCountryById,
  deleteCountryById,
};

