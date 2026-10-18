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
const { DeliveryGratitude } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createGratitude = async (param) => {
  if (param.mostTipped === true || param.mostTipped === 'true') {
    await DeliveryGratitude.updateMany({}, { $set: { mostTipped: false } });
  }
  const gratitudeData = new DeliveryGratitude({
    price: param.price,
    mostTipped: param.mostTipped,
    status: true,
  });
  await DeliveryGratitude.create(gratitudeData);
  return { success: true };
};

const getGratitudeListAdmin = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const numericSearch = Number(options.search);
  const isNumericSearch = !Number.isNaN(numericSearch);
  const matchStage = {};
  if (isNumericSearch && options.search !== null && options.search !== '') {
    const searchCents = Math.round((+numericSearch + Number.EPSILON) * 100);
    matchStage.price = searchCents;
  }
  const query = [
    { $match: matchStage },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        mostTipped: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        status: 1,
      },
    },
  ];
  const results = await DeliveryGratitude.aggregate(query);
  const countResult = await DeliveryGratitude.aggregate([
    { $match: matchStage },
    { $count: 'totalCount' },
  ]);
  return Promise.all([results, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      results,
      page,
      limit,
      totalPages,
      totalResults,
    };
    return Promise.resolve(result);
  });
};

const getGratitudeById = async (id) => {
  return DeliveryGratitude.findById(id);
};

const updateGratitude = async (id, updateBody) => {
  if (updateBody.mostTipped === true || updateBody.mostTipped === 'true') {
    await DeliveryGratitude.updateMany({}, { $set: { mostTipped: false } });
  }
  const gratitudeData = await getGratitudeById(id);
  Object.assign(gratitudeData, updateBody);
  await gratitudeData.save();
  return { success: true };
};

const deleteGratitude = async (id) => {
  const gratitude = await getGratitudeById(id);
  if (!gratitude) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await gratitude.deleteOne();
  return { success: true };
};

const exportCollection = async (search) => {
  const numericSearch = Number(search);
  const isNumericSearch = !Number.isNaN(numericSearch);
  const matchStage = {};
  if (isNumericSearch && search !== null && search !== '') {
    const searchCents = Math.round((+numericSearch + Number.EPSILON) * 100);
    matchStage.price = searchCents;
  }
  const query = [
    { $match: matchStage },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        mostTipped: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        status: 1,
      },
    },
  ];
  const results = await DeliveryGratitude.aggregate(query);
  return results;
};

const exportRawCollection = async (search) => {
  const numericSearch = Number(search);
  const isNumericSearch = !Number.isNaN(numericSearch);
  const matchStage = {};
  if (isNumericSearch && search !== null && search !== '') {
    const searchCents = Math.round((+numericSearch + Number.EPSILON) * 100);
    matchStage.price = searchCents;
  }
  const query = [{ $match: matchStage }, { $sort: { createdAt: -1 } }];
  const results = await DeliveryGratitude.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    await DeliveryGratitude.updateMany({}, { $set: { mostTipped: false } });
    importArray.forEach(async (param) => {
      const gratitudeData = new DeliveryGratitude({
        price: param && param.price && param.price !== null && param.price !== '' ? param.price : 0,
        mostTipped: param && (param.mostTipped === 'yes' || param.mostTipped === 'Yes'),
        status: param && (param.status === 'active' || param.status === 'Active'),
      });
      await DeliveryGratitude.create(gratitudeData);
    });
    await DeliveryGratitude.findOneAndUpdate({}, { $set: { mostTipped: true } });
  }
  return { success: true };
};

module.exports = {
  createGratitude,
  updateGratitude,
  deleteGratitude,
  getGratitudeListAdmin,
  exportCollection,
  exportRawCollection,
  importCollection,
};

