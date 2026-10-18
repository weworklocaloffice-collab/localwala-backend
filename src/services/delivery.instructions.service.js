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
const { DeliveryInstruction } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createInstruction = async (param) => {
  const instructionsData = new DeliveryInstruction({
    name: param.name,
    image: param.image,
    translations: param.translations,
    status: true,
  });
  await DeliveryInstruction.create(instructionsData);
  return { success: true };
};

const getDeliveryInstructionListAdmin = async (options) => {
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
      },
    },
  ];
  const results = await DeliveryInstruction.aggregate(query);
  const countResult = await DeliveryInstruction.aggregate([
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

const getInstructionById = async (id) => {
  return DeliveryInstruction.findById(id);
};

const updateInstructionById = async (id, updateBody) => {
  const instructions = await getInstructionById(id);
  if (!instructions) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  Object.assign(instructions, updateBody);
  await instructions.save();
  return { success: true };
};

const deleteInstructionById = async (id) => {
  const instructions = await getInstructionById(id);
  if (!instructions) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await instructions.deleteOne();
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
        image: 1,
        name: 1,
        status: 1,
      },
    },
  ];
  const results = await DeliveryInstruction.aggregate(query);
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
  const results = await DeliveryInstruction.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const instructionsData = new DeliveryInstruction({
        name: param && param.name && param.name !== null && param.name !== '' ? param.name : 'NA',
        image:
          param && param.image && param.image !== null && param.image !== '' ? param.image : 'NA',
        translations: [],
        status: param && (param.status === 'active' || param.status === 'Active'),
      });
      await DeliveryInstruction.create(instructionsData);
    });
  }
  return { success: true };
};

module.exports = {
  createInstruction,
  getInstructionById,
  updateInstructionById,
  deleteInstructionById,
  getDeliveryInstructionListAdmin,
  exportCollection,
  exportRawCollection,
  importCollection,
};

