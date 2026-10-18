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
const { WalletBonus } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createBonus = async (param) => {
  const bonusData = new WalletBonus({
    name: param.name,
    shortDescription: param.shortDescription,
    image: param.image,
    start: param.start,
    expires: param.expires,
    bonusType: param.bonusType,
    bonusAmount: param.bonusAmount,
    minWalletAmount: param.minWalletAmount,
    maxBonusAmount: param.maxBonusAmount,
    translations: param.translations,
    status: true,
  });
  await WalletBonus.create(bonusData);
  return { success: true };
};

const getAllBonusAdmin = async (options) => {
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
                title: { $regex: searchRegExp },
              },
            },
          },
        ],
      },
    },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $sort: {
        createdAt: -1,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        shortDescription: 1,
        image: 1,
        start: 1,
        expires: 1,
        bonusType: 1,
        bonusAmount: {
          $round: [{ $divide: ['$bonusAmount', 100] }, 2],
        },
        minWalletAmount: {
          $round: [{ $divide: ['$minWalletAmount', 100] }, 2],
        },
        maxBonusAmount: {
          $round: [{ $divide: ['$maxBonusAmount', 100] }, 2],
        },
        translations: 1,
        status: 1,
      },
    },
  ];
  const results = await WalletBonus.aggregate(query);
  const countResult = await WalletBonus.aggregate([
    {
      $match: {
        $or: [
          { name: searchRegExp },
          {
            translations: {
              $elemMatch: {
                title: { $regex: searchRegExp },
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

const getBonusById = async (id) => {
  return WalletBonus.findById(id);
};

const updateStatus = async (bonusId, param) => {
  const bonus = await getBonusById(bonusId);
  if (!bonus) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateBody = {
    status: param.status,
  };
  Object.assign(bonus, updateBody);
  await bonus.save();
  return { success: true };
};

const updateData = async (bonusId, param) => {
  const bonus = await getBonusById(bonusId);
  if (!bonus) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateBody = {
    name: param.name,
    shortDescription: param.shortDescription,
    image: param.image,
    start: param.start,
    expires: param.expires,
    bonusType: param.bonusType,
    bonusAmount: param.bonusAmount,
    minWalletAmount: param.minWalletAmount,
    maxBonusAmount: param.maxBonusAmount,
    translations: param.translations,
  };
  Object.assign(bonus, updateBody);
  await bonus.save();
  return { success: true };
};

const deleteBonusById = async (bonusId) => {
  const bonus = await getBonusById(bonusId);
  if (!bonus) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await bonus.deleteOne();
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
                title: { $regex: searchRegExp },
              },
            },
          },
        ],
      },
    },
    {
      $sort: { createdAt: -1 },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        shortDescription: 1,
        image: 1,
        start: 1,
        expires: 1,
        bonusType: 1,
        bonusAmount: {
          $round: [{ $divide: ['$bonusAmount', 100] }, 2],
        },
        minWalletAmount: {
          $round: [{ $divide: ['$minWalletAmount', 100] }, 2],
        },
        maxBonusAmount: {
          $round: [{ $divide: ['$maxBonusAmount', 100] }, 2],
        },
        status: 1,
      },
    },
  ];
  const results = await WalletBonus.aggregate(query);
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
                title: { $regex: searchRegExp },
              },
            },
          },
        ],
      },
    },
    { $sort: { createdAt: -1 } },
  ];
  const results = await WalletBonus.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const bonusData = new WalletBonus({
        name: param && param.name && param.name !== null && param.name !== '' ? param.name : 'NA',
        shortDescription:
          param &&
          param.shortDescription &&
          param.shortDescription !== null &&
          param.shortDescription !== ''
            ? param.shortDescription
            : 'NA',
        image:
          param && param.image && param.image !== null && param.image !== '' ? param.image : 'NA',
        start:
          param && param.start && param.start !== null && param.start !== '' ? param.start : 'NA',
        expires:
          param && param.expires && param.expires !== null && param.expires !== ''
            ? param.expires
            : 'NA',
        bonusType:
          param &&
          param.bonusType &&
          param.bonusType !== null &&
          param.bonusType !== '' &&
          param.bonusType === 'amount'
            ? 'amount'
            : 'percentage',
        bonusAmount:
          param && param.bonusAmount && param.bonusAmount !== null && param.bonusAmount !== ''
            ? param.bonusAmount
            : 0,
        minWalletAmount:
          param &&
          param.minWalletAmount &&
          param.minWalletAmount !== null &&
          param.minWalletAmount !== ''
            ? param.minWalletAmount
            : 0,
        maxBonusAmount:
          param &&
          param.maxBonusAmount &&
          param.maxBonusAmount !== null &&
          param.maxBonusAmount !== ''
            ? param.maxBonusAmount
            : 0,
        status: param && (param.status === 'active' || param.status === 'Active'),
        translations: [],
      });
      await WalletBonus.create(bonusData);
    });
  }
  return { success: true };
};

module.exports = {
  createBonus,
  getAllBonusAdmin,
  updateStatus,
  deleteBonusById,
  updateData,
  exportCollection,
  exportRawCollection,
  importCollection,
};

