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
const { RestaurantFoodLicense } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createLicense = async (param) => {
  if (await RestaurantFoodLicense.isNameTaken(param.name)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  const licenseData = new RestaurantFoodLicense({
    name: param.name,
    image: param.image,
    website: param.website,
    translations: param.translations,
    status: true,
  });
  await RestaurantFoodLicense.create(licenseData);
  return { success: true };
};

const getRestaurantLicenseListAdmin = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const query = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
          {
            translations: {
              $elemMatch: {
                value: { $regex: searchRegExp },
              },
            },
          },
        ],
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        image: 1,
        name: 1,
        status: 1,
        translations: 1,
        website: 1,
      },
    },
  ];
  const results = await RestaurantFoodLicense.aggregate(query);
  const countResult = await RestaurantFoodLicense.aggregate([
    {
      $match: {
        $or: [
          { name: searchRegExp },
          {
            translations: {
              $elemMatch: {
                value: { $regex: searchRegExp },
              },
            },
          },
        ],
      },
    },
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

const getLicenseId = async (id) => {
  return RestaurantFoodLicense.findById(id);
};

const updateLicense = async (licenseId, updateBody) => {
  const license = await getLicenseId(licenseId);
  if (!license) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (updateBody.name && (await RestaurantFoodLicense.isNameTaken(updateBody.name, licenseId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  Object.assign(license, updateBody);
  await license.save();
  return { success: true };
};

const deleteLicenseById = async (licenseId) => {
  const license = await getLicenseId(licenseId);
  if (!license) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await license.deleteOne();
  return { success: true };
};

const listAllLicenses = async () => {
  const license = await RestaurantFoodLicense.find({});
  return license;
};

const getLicenseListForNewRestaurant = async () => {
  const license = await RestaurantFoodLicense.find(
    { status: true },
    { id: 1, name: 1, translations: 1 }
  );
  return license;
};

const exportCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
          {
            translations: {
              $elemMatch: {
                value: { $regex: searchRegExp },
              },
            },
          },
        ],
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        image: 1,
        name: 1,
        status: 1,
        website: 1,
      },
    },
  ];
  const results = await RestaurantFoodLicense.aggregate(query);
  return results;
};

const exportRawCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
          {
            translations: {
              $elemMatch: {
                value: { $regex: searchRegExp },
              },
            },
          },
        ],
      },
    },
    { $sort: { createdAt: -1 } },
  ];
  const results = await RestaurantFoodLicense.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const licenseData = new RestaurantFoodLicense({
        name: param && param.name && param.name !== null && param.name !== '' ? param.name : 'NA',
        image:
          param && param.image && param.image !== null && param.image !== '' ? param.image : 'NA',
        website:
          param && param.website && param.website !== null && param.website !== ''
            ? param.website
            : 'NA',
        translations: [],
        status: param && (param.status === 'active' || param.status === 'Active'),
      });
      await RestaurantFoodLicense.create(licenseData);
    });
  }
  return { success: true };
};

module.exports = {
  createLicense,
  updateLicense,
  deleteLicenseById,
  listAllLicenses,
  getLicenseListForNewRestaurant,
  getRestaurantLicenseListAdmin,
  exportCollection,
  exportRawCollection,
  importCollection,
};

