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
const { WithdrawalMethod } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createMethod = async (param) => {
  if (param.isDefault === true || param.isDefault === 'true') {
    await WithdrawalMethod.updateMany({}, { $set: { isDefault: false } });
  }
  const methodData = new WithdrawalMethod({
    name: param.name,
    image: param.image,
    formElement: param.formElement,
    translations: param.translations,
    isDefault: param.isDefault,
  });
  await WithdrawalMethod.create(methodData);
  return { success: true };
};

const methodList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const methodQuery = [
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
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        image: 1,
        isDefault: 1,
        translations: 1,
        status: 1,
      },
    },
  ];
  const methods = await WithdrawalMethod.aggregate(methodQuery);
  const countResult = await WithdrawalMethod.aggregate([
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
  return Promise.all([methods, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      methods,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getMethodById = async (id) => {
  return WithdrawalMethod.findById(id);
};

const updateMethod = async (methodId, param) => {
  const method = await getMethodById(methodId);
  if (!method) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  Object.assign(method, param);
  await method.save();
  return { success: true };
};

const updateDefault = async (methodId) => {
  const haveDefault = await WithdrawalMethod.findOne({ isDefault: true });
  if (haveDefault.id === methodId) {
    return { success: true };
  }
  const method = await getMethodById(methodId);
  if (!method) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  Object.assign(haveDefault, { isDefault: false });
  Object.assign(method, { isDefault: true });
  await haveDefault.save();
  await method.save();
  return { success: true };
};

const deleteMethod = async (methodId) => {
  const method = await getMethodById(methodId);
  if (!method) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await method.deleteOne();
  return { success: true };
};

const withdrawalMethodDetail = async (methodId) => {
  const method = await WithdrawalMethod.findById(methodId);
  if (!method) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return { method, success: true };
};

const withdrawalMethodListVendor = async () => {
  const methods = await WithdrawalMethod.find({ status: 1 });
  return { methods, success: true };
};

const withdrawalMethodListDeliveryman = async () => {
  const methods = await WithdrawalMethod.find({ status: true });
  return { methods, success: true };
};

const listAllWithdrawalMethod = async () => {
  const methods = await WithdrawalMethod.find(
    { status: true },
    { id: 1, name: 1, translations: 1 }
  );
  return methods;
};

const exportCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const methodQuery = [
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
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        image: 1,
        isDefault: 1,
        status: 1,
      },
    },
  ];
  const result = await WithdrawalMethod.aggregate(methodQuery);
  return result;
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
  const results = await WithdrawalMethod.aggregate(query);
  return results;
};

function safeParse(str) {
  try {
    return JSON.parse(str);
    // eslint-disable-next-line no-unused-vars
  } catch (e) {
    return null;
  }
}

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    await WithdrawalMethod.updateMany({}, { $set: { isDefault: false } });
    importArray.forEach(async (param) => {
      const formElementObj =
        param &&
        param.formElement &&
        param.formElement !== null &&
        param.formElement !== '' &&
        param.formElement !== '[]'
          ? safeParse(param.formElement)
          : {};
      const methodData = new WithdrawalMethod({
        name: param && param.name && param.name !== null && param.name !== '' ? param.name : 'NA',
        image:
          param && param.image && param.image !== null && param.image !== '' ? param.image : 'NA',
        formElement: formElementObj,
        translations: [],
        isDefault: param && (param.isDefault === 'yes' || param.isDefault === 'Yes'),
        status: param && (param.status === 'active' || param.status === 'Active'),
      });
      await WithdrawalMethod.create(methodData);
    });
    await WithdrawalMethod.findOneAndUpdate({}, { $set: { isDefault: true } });
  }
  return { success: true };
};

module.exports = {
  createMethod,
  methodList,
  updateMethod,
  updateDefault,
  deleteMethod,
  withdrawalMethodDetail,
  withdrawalMethodListVendor,
  withdrawalMethodListDeliveryman,
  listAllWithdrawalMethod,
  exportCollection,
  exportRawCollection,
  importCollection,
};

