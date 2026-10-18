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
const { Vehicle } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createVehicle = async (param) => {
  if (await Vehicle.isNameTaken(param.name)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  const vehicleData = new Vehicle({
    name: param.name,
    extraCharge: param.extraCharge,
    minimumCoverage: param.minimumCoverage,
    maximumCoverage: param.maximumCoverage,
    translations: param.translations,
    status: true,
  });
  await Vehicle.create(vehicleData);
  return { success: true };
};

const getAllVehicle = async (options) => {
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
        extraCharge: 1,
        maximumCoverage: 1,
        minimumCoverage: 1,
        name: 1,
        status: 1,
        translations: 1,
      },
    },
  ];
  const results = await Vehicle.aggregate(query);
  const countResult = await Vehicle.aggregate([
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

const listAllVehicle = async () => {
  const vehicles = await Vehicle.find({ status: 1 }, { id: 1, name: 1, translations: 1 });
  return vehicles;
};

const getVehicleId = async (id) => {
  return Vehicle.findById(id);
};

const updateVehicleById = async (vehicleId, updateBody) => {
  const vehicle = await getVehicleId(vehicleId);
  if (!vehicle) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (updateBody.name && (await Vehicle.isNameTaken(updateBody.name, vehicleId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already taken');
  }
  Object.assign(vehicle, updateBody);
  await vehicle.save();
  return { success: true };
};

const deleteVehicleById = async (vehicleId) => {
  const vehicle = await getVehicleId(vehicleId);
  if (!vehicle) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await vehicle.deleteOne();
  return { success: true };
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
        extraCharge: 1,
        maximumCoverage: 1,
        minimumCoverage: 1,
        name: 1,
        status: 1,
      },
    },
  ];
  const results = await Vehicle.aggregate(query);
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
  const results = await Vehicle.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const vehicleData = new Vehicle({
        name: param && param.name && param.name !== null && param.name !== '' ? param.name : 'NA',
        extraCharge:
          param && param.extraCharge && param.extraCharge !== null && param.extraCharge !== ''
            ? param.extraCharge
            : 0,
        minimumCoverage:
          param &&
          param.minimumCoverage &&
          param.minimumCoverage !== null &&
          param.minimumCoverage !== ''
            ? param.minimumCoverage
            : 0,
        maximumCoverage:
          param &&
          param.maximumCoverage &&
          param.maximumCoverage !== null &&
          param.maximumCoverage !== ''
            ? param.maximumCoverage
            : 0,
        status: param && (param.status === 'active' || param.status === 'Active'),
        translations: [],
      });
      await Vehicle.create(vehicleData);
    });
  }
  return { success: true };
};

module.exports = {
  createVehicle,
  getAllVehicle,
  getVehicleId,
  updateVehicleById,
  deleteVehicleById,
  listAllVehicle,
  exportCollection,
  exportRawCollection,
  importCollection,
};

