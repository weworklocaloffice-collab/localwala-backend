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

const mongoose = require('mongoose');
const fs = require('fs');
const { status: httpStatus } = require('http-status');
const { Media, Restaurant } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createMedia = async (param) => {
  const mediaData = new Media({
    path: param.path,
    uid: param.uid,
  });
  return Media.create(mediaData);
};

const getMediaById = async (id) => {
  return Media.findById(id);
};

const dropFile = async (path) => {
  const media = await getMediaById(path);
  if (!media) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const publicFolderPath = `${process.cwd()}/public/`;
  const filePath = publicFolderPath + media.path;
  if (fs.existsSync(filePath)) {
    fs.unlink(filePath, function (err) {
      if (err) return err;
      return true;
    });
  }
  await media.deleteOne();
  return media;
};

const dropUserMediaFile = async (imagePath, userId) => {
  const media = await Media.findOne({ path: imagePath, uid: userId });
  if (!media) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const publicFolderPath = `${process.cwd()}/public/`;
  const filePath = publicFolderPath + media.path;
  if (fs.existsSync(filePath)) {
    fs.unlink(filePath, function (err) {
      if (err) return err;
      return true;
    });
  }
  await media.deleteOne();
  return { success: true };
};

const getMediaListAdmin = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const findQuery = [
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'users',
        localField: 'uid',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        createdAt: 1,
        path: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
      },
    },
  ];
  const media = await Media.aggregate(findQuery);
  const totalResults = await Media.countDocuments();
  return Promise.all([media, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      media,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityzenMediaFiles = async (masterId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const findQuery = [
    {
      $match: {
        uid: new mongoose.Types.ObjectId(masterId),
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'users',
        localField: 'uid',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        createdAt: 1,
        path: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
      },
    },
  ];
  const media = await Media.aggregate(findQuery);
  const totalResults = await Media.countDocuments({ uid: new mongoose.Types.ObjectId(masterId) });
  return Promise.all([media, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      media,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getMediaListForAdminDialog = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const findQuery = [
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        path: 1,
      },
    },
  ];
  const results = await Media.aggregate(findQuery);
  const totalResults = await Media.countDocuments();
  return Promise.all([results, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      results,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getMediaListForVendorDialog = async (vendorId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const findQuery = [
    {
      $match: {
        uid: new mongoose.Types.ObjectId(vendorId),
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        path: 1,
      },
    },
  ];
  const results = await Media.aggregate(findQuery);
  const totalResults = await Media.countDocuments({ uid: new mongoose.Types.ObjectId(vendorId) });
  return Promise.all([results, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      results,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityzenMediaDialog = async (masterId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const findQuery = [
    {
      $match: {
        uid: new mongoose.Types.ObjectId(masterId),
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        path: 1,
      },
    },
  ];
  const results = await Media.aggregate(findQuery);
  const totalResults = await Media.countDocuments({ uid: new mongoose.Types.ObjectId(masterId) });
  return Promise.all([results, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      results,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getMyMediaFiles = async (userId) => {
  const results = await Media.find({ uid: new mongoose.Types.ObjectId(userId) });
  return Promise.all([results]).then(() => {
    const result = {
      results,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const customerMediaFiles = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { uid: new mongoose.Types.ObjectId(options.user) };
  const findQuery = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'users',
        localField: 'uid',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        createdAt: 1,
        path: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
      },
    },
  ];
  const results = await Media.aggregate(findQuery);
  const totalResults = await Media.countDocuments(queryCondition);
  return Promise.all([results, totalResults]).then(() => {
    const result = {
      results,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const vendorMediaFiles = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const restaurantInfo = await Restaurant.findById(options.restaurant);
  if (!restaurantInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const queryCondition = { uid: new mongoose.Types.ObjectId(restaurantInfo.userId) };
  const findQuery = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'users',
        localField: 'uid',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        createdAt: 1,
        path: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
      },
    },
  ];
  const results = await Media.aggregate(findQuery);
  const totalResults = await Media.countDocuments(queryCondition);
  return Promise.all([results, totalResults]).then(() => {
    const result = {
      results,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const deliverymanMediaFiles = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { uid: new mongoose.Types.ObjectId(options.deliveryman) };
  const findQuery = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'users',
        localField: 'uid',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        createdAt: 1,
        path: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
      },
    },
  ];
  const results = await Media.aggregate(findQuery);
  const totalResults = await Media.countDocuments(queryCondition);
  return Promise.all([results, totalResults]).then(() => {
    const result = {
      results,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const exportCollection = async () => {
  const query = [
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'users',
        localField: 'uid',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        createdAt: 1,
        path: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
      },
    },
  ];
  const results = await Media.aggregate(query);
  return results;
};

const exportRawCollection = async () => {
  const results = await Media.find({}).lean();
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      if (param && param.path && param.path !== null && param.path !== '' && param.path !== 'NA') {
        const mediaData = new Media({
          uid: param && param.user && param.user !== '' && param.user !== null ? param.user : null,
          path: param.path,
        });
        await Media.create(mediaData);
      }
    });
  }
  return { success: true };
};

module.exports = {
  createMedia,
  dropFile,
  dropUserMediaFile,
  getMediaListForAdminDialog,
  getMediaListAdmin,
  getMediaListForVendorDialog,
  getMyMediaFiles,
  customerMediaFiles,
  vendorMediaFiles,
  deliverymanMediaFiles,
  cityzenMediaDialog,
  cityzenMediaFiles,
  exportCollection,
  exportRawCollection,
  importCollection,
};

