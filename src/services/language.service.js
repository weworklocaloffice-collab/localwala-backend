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
const { Language } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createLanguage = async (param) => {
  if (await Language.isNameTaken(param.name)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  const haveDefault = await Language.findOne({ isDefault: true });
  const languageData = new Language({
    name: param.name,
    code: param.code,
    direction: param.direction,
    isDefault: !haveDefault,
    nativeName: param.nativeName,
    image: param.image,
    status: true,
  });
  await Language.create(languageData);
  return { success: true };
};

const getAllLangaugesAdmin = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const query = [
    {
      $match: {
        $or: [{ name: searchRegExp }, { nativeName: searchRegExp }],
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        code: 1,
        direction: 1,
        isDefault: 1,
        image: 1,
        name: 1,
        nativeName: 1,
        status: 1,
      },
    },
  ];
  const results = await Language.aggregate(query);
  const countResult = await Language.aggregate([
    {
      $match: {
        $or: [{ name: searchRegExp }, { nativeName: searchRegExp }],
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

const getPublicLanguages = async () => {
  const languages = await Language.find();
  return languages;
};

const getLanguageId = async (id) => {
  return Language.findById(id);
};

const updateLanguageById = async (languageId, updateBody) => {
  const language = await getLanguageId(languageId);
  if (!language) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (updateBody.name && (await Language.isNameTaken(updateBody.name, languageId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  Object.assign(language, updateBody);
  await language.save();
  return { success: true };
};

const updateDefault = async (languageId) => {
  await Language.updateMany({}, { $set: { isDefault: false } });
  const language = await getLanguageId(languageId);
  if (!language) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  Object.assign(language, { isDefault: true });
  await language.save();
  return { success: true };
};

const deleteLanguageById = async (languageId) => {
  const language = await getLanguageId(languageId);
  if (!language) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await language.deleteOne();
  return { success: true };
};

const getDefaultLanguage = async () => {
  const language = await Language.findOne({ isDefault: true, status: true }, { _id: 0 });
  return language;
};

const exportCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [{ name: searchRegExp }, { nativeName: searchRegExp }],
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        code: 1,
        direction: 1,
        isDefault: 1,
        image: 1,
        name: 1,
        nativeName: 1,
        status: 1,
      },
    },
  ];
  const results = await Language.aggregate(query);
  return results;
};

const exportRawCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [{ name: searchRegExp }, { nativeName: searchRegExp }],
      },
    },
    { $sort: { createdAt: -1 } },
  ];
  const results = await Language.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    await Language.updateMany({}, { $set: { isDefault: false } });
    importArray.forEach(async (param) => {
      const languageData = new Language({
        name:
          param && param.name && param.name !== null && param.name !== '' ? param.name : 'English',
        code: param && param.code && param.code !== null && param.code !== '' ? param.code : 'en',
        direction:
          param && param.direction && param.direction !== null && param.direction !== ''
            ? param.direction
            : 'ltr',
        nativeName:
          param && param.nativeName && param.nativeName !== null && param.nativeName !== ''
            ? param.nativeName
            : 'English',
        image:
          param && param.image && param.image !== null && param.image !== '' ? param.image : 'NA',
        isDefault: param && (param.isDefault === 'yes' || param.isDefault === 'Yes'),
        status: param && (param.status === 'active' || param.status === 'Active'),
      });
      await Language.create(languageData);
    });
    await Language.updateOne({}, { $set: { isDefault: true } });
  }
  return { success: true };
};

module.exports = {
  createLanguage,
  getAllLangaugesAdmin,
  getLanguageId,
  updateLanguageById,
  deleteLanguageById,
  updateDefault,
  getPublicLanguages,
  getDefaultLanguage,
  exportCollection,
  exportRawCollection,
  importCollection,
};

