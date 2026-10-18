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
const { UserAvatar } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const saveAvatar = async (param) => {
  if (param.isDefault === true || param.isDefault === 'true') {
    await UserAvatar.updateMany({}, { $set: { isDefault: false } });
  }
  const avatarData = new UserAvatar({
    avatar: param.avatar,
    isDefault: false,
    status: true,
  });
  await UserAvatar.create(avatarData);
  return { success: true };
};

const getAllAvatarAdmin = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const query = [
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        avatar: 1,
        isDefault: 1,
        status: 1,
      },
    },
  ];
  const results = await UserAvatar.aggregate(query);
  const totalResults = await UserAvatar.countDocuments();
  return Promise.all([results, totalResults]).then(() => {
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

const getAvaratById = async (id) => {
  return UserAvatar.findById(id);
};

const updateStatus = async (avatarId, param) => {
  const avatar = await getAvaratById(avatarId);
  if (!avatar) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  Object.assign(avatar, param);
  await avatar.save();
  return { success: true };
};

const updateDefault = async (avatarId) => {
  const haveDefault = await UserAvatar.findOne({ isDefault: true });
  if (haveDefault && haveDefault.id === avatarId) {
    Object.assign(haveDefault, { isDefault: false });
    await haveDefault.save();
    return { success: true };
  }
  const avatar = await getAvaratById(avatarId);
  if (!avatar) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  Object.assign(avatar, { isDefault: true });
  await avatar.save();
  return { success: true };
};

const deleteAvatarById = async (avatarId) => {
  const avatar = await getAvaratById(avatarId);
  if (!avatar) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await avatar.deleteOne();
  return { success: true };
};

const getAvatarList = async () => {
  const avatarList = await UserAvatar.find({ status: true });
  return { avatar: avatarList, success: true };
};

const exportCollection = async () => {
  const query = [
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        avatar: 1,
        isDefault: 1,
        status: 1,
      },
    },
  ];
  const results = await UserAvatar.aggregate(query);
  return results;
};

const exportRawCollection = async () => {
  const results = await UserAvatar.find({}).lean();
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    await UserAvatar.updateMany({}, { $set: { isDefault: false } });
    importArray.forEach(async (param) => {
      const avatarData = new UserAvatar({
        avatar:
          param && param.avatar && param.avatar !== null && param.avatar !== ''
            ? param.avatar
            : 'NA',
        isDefault: param && (param.isDefault === 'Yes' || param.isDefault === 'yes'),
        status: param && (param.status === 'active' || param.status === 'Active'),
      });
      await UserAvatar.create(avatarData);
    });
    await UserAvatar.findOneAndUpdate({}, { $set: { isDefault: true } });
  }
  return { success: true };
};

module.exports = {
  saveAvatar,
  getAllAvatarAdmin,
  updateDefault,
  deleteAvatarById,
  updateStatus,
  getAvatarList,
  exportCollection,
  exportRawCollection,
  importCollection,
};

