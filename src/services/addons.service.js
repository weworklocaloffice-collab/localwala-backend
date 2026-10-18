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
const { status: httpStatus } = require('http-status');
const { Addons, User, KitchenOwner } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createAddons = async (param) => {
  const addonData = new Addons({
    name: param.name,
    price: param.price,
    restaurant: param.restaurant,
    inStock: param.inStock,
    stockType: param.stockType,
    stockNumber: param.stockNumber,
    translations: param.translations,
    status: true,
  });
  await Addons.create(addonData);
  return { success: true };
};

const getAllAddons = async (restaurantId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const query = [
    { $match: { restaurant: new mongoose.Types.ObjectId(restaurantId) } },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        restaurant: 1,
        stockType: 1,
        stockNumber: 1,
        inStock: 1,
        status: 1,
        translations: 1,
      },
    },
  ];
  const results = await Addons.aggregate(query);
  const totalResults = await Addons.countDocuments({
    restaurant: new mongoose.Types.ObjectId(restaurantId),
  });
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

const getForAdmin = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const matchQuery = {
    $or: [
      { name: searchRegExp },
      {
        translations: {
          $elemMatch: {
            value: { $regex: searchRegExp },
          },
        },
      },
      { 'restaurants.name': searchRegExp },
      { 'restaurants.slug': searchRegExp },
      {
        'restaurants.translations': {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
    ].filter(Boolean),
  };
  const query = [
    {
      $lookup: {
        from: 'restaurants',
        localField: 'restaurant',
        foreignField: '_id',
        as: 'restaurants',
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: matchQuery,
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        status: 1,
        translations: 1,
        stockType: 1,
        stockNumber: 1,
        inStock: 1,
        restaurant: 1,
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ];
  const results = await Addons.aggregate(query);
  const countResult = await Addons.aggregate([
    {
      $lookup: {
        from: 'restaurants',
        localField: 'restaurant',
        foreignField: '_id',
        as: 'restaurants',
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: matchQuery,
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

const cityzenAddonList = async (masterId, options) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const matchQuery = {
    $or: [
      { name: searchRegExp },
      {
        translations: {
          $elemMatch: {
            value: { $regex: searchRegExp },
          },
        },
      },
      { 'restaurants.name': searchRegExp },
      { 'restaurants.slug': searchRegExp },
      {
        'restaurants.translations': {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
    ].filter(Boolean),
    $and: [{ 'restaurants.city': new mongoose.Types.ObjectId(city) }],
  };
  const query = [
    {
      $lookup: {
        from: 'restaurants',
        localField: 'restaurant',
        foreignField: '_id',
        as: 'restaurants',
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: matchQuery,
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        status: 1,
        translations: 1,
        stockType: 1,
        stockNumber: 1,
        inStock: 1,
        restaurant: 1,
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ];
  const results = await Addons.aggregate(query);
  const countResult = await Addons.aggregate([
    {
      $lookup: {
        from: 'restaurants',
        localField: 'restaurant',
        foreignField: '_id',
        as: 'restaurants',
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: matchQuery,
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

const getAddonId = async (id) => {
  return Addons.findById(id);
};

const updateAddonById = async (addonId, param) => {
  const addons = await getAddonId(addonId);
  if (!addons) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  Object.assign(addons, param);
  await addons.save();
  return { success: true };
};

const deleteAddonById = async (addonId) => {
  const addons = await getAddonId(addonId);
  if (!addons) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await addons.deleteOne();
  return { success: true };
};

const getAllMyAddons = async (id) => {
  const addons = await Addons.find(
    { restaurant: id, status: true },
    { id: 1, name: 1, translations: 1 }
  );
  return addons;
};

const updateAddonStockAfterOrder = async (addonArray) => {
  if (addonArray !== null && checkArrayNotEmpty(addonArray)) {
    const bulkUpdateItem = addonArray.map((item) => ({
      updateOne: {
        filter: { _id: item.id },
        update: { $set: item.updateSet },
      },
    }));
    await Addons.bulkWrite(bulkUpdateItem);
  }
};

const kitchenOwnerAddonList = async (ownerId) => {
  const ownerDetail = await KitchenOwner.findOne({ userId: new mongoose.Types.ObjectId(ownerId) });
  if (!ownerDetail) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const addons = await Addons.find(
    { restaurant: new mongoose.Types.ObjectId(ownerDetail.restaurant), status: true },
    { id: 1, name: 1, translations: 1 }
  );
  return addons;
};

const exportCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const matchQuery = {
    $or: [
      { name: searchRegExp },
      {
        translations: {
          $elemMatch: {
            value: { $regex: searchRegExp },
          },
        },
      },
      { 'restaurants.name': searchRegExp },
      { 'restaurants.slug': searchRegExp },
      {
        'restaurants.translations': {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
    ].filter(Boolean),
  };
  const query = [
    {
      $lookup: {
        from: 'restaurants',
        localField: 'restaurant',
        foreignField: '_id',
        as: 'restaurants',
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: matchQuery,
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        status: 1,
        stockType: 1,
        stockNumber: 1,
        inStock: 1,
        restaurant: 1,
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
        },
      },
    },
  ];
  const results = await Addons.aggregate(query);
  return results;
};

const exportRawCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const matchQuery = {
    $or: [
      { name: searchRegExp },
      {
        translations: {
          $elemMatch: {
            value: { $regex: searchRegExp },
          },
        },
      },
      { 'restaurants.name': searchRegExp },
      { 'restaurants.slug': searchRegExp },
      {
        'restaurants.translations': {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
    ].filter(Boolean),
  };
  const query = [
    {
      $lookup: {
        from: 'restaurants',
        localField: 'restaurant',
        foreignField: '_id',
        as: 'restaurants',
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: matchQuery,
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        restaurants: 0,
      },
    },
  ];
  const results = await Addons.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const addonData = new Addons({
        name: param && param.name && param.name !== null && param.name !== '' ? param.name : 'NA',
        price: param && param.price && param.price !== null && param.price !== '' ? param.price : 0,
        restaurant:
          param && param.restaurant && param.restaurant !== null && param.restaurant !== ''
            ? param.restaurant
            : null,
        inStock: param && (param.inStock === 'yes' || param.inStock === 'Yes'),
        stockType:
          param && param.stockType && param.stockType !== null && param.stockType !== ''
            ? param.stockType
            : 'unlimited',
        stockNumber:
          param &&
          param.stockNumber &&
          param.stockNumber !== null &&
          param.stockNumber !== '' &&
          param.stockType !== 'unlimited'
            ? param.stockNumber
            : -1,
        status: param && (param.status === 'active' || param.status === 'Active'),
        translations: [],
      });
      await Addons.create(addonData);
    });
  }
  return { success: true };
};

module.exports = {
  createAddons,
  getAllAddons,
  getAddonId,
  updateAddonById,
  deleteAddonById,
  getAllMyAddons,
  getForAdmin,
  updateAddonStockAfterOrder,
  cityzenAddonList,
  kitchenOwnerAddonList,
  exportCollection,
  exportRawCollection,
  importCollection,
};

