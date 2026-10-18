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
const { FoodTaxation, User } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const saveFoodTaxation = async (param) => {
  const taxData = new FoodTaxation({
    restaurant: param.restaurant,
    taxName: param.taxName,
    taxAmount: param.taxAmount,
    translations: param.translation,
  });
  await FoodTaxation.create(taxData);
  return { success: true };
};

const getVendorTaxationList = async (restaurantId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const query = [
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(restaurantId),
      },
    },
    { $skip: skip },
    { $limit: Number(limit) },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        restaurant: 1,
        taxName: 1,
        taxAmount: {
          $round: [{ $divide: ['$taxAmount', 100] }, 2],
        },
        translations: 1,
      },
    },
  ];
  const results = await FoodTaxation.aggregate(query);
  const totalResults = await FoodTaxation.countDocuments({
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

const updateTaxation = async (id, restaurant, param) => {
  const taxation = await FoodTaxation.findOne({
    _id: new mongoose.Types.ObjectId(id),
    restaurant: new mongoose.Types.ObjectId(restaurant),
  });
  if (!taxation) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Not found');
  }
  const taxData = {
    restaurant: param.restaurant,
    taxName: param.taxName,
    taxAmount: param.taxAmount,
    translations: param.translation,
  };
  Object.assign(taxation, taxData);
  await taxation.save();
  return { success: true };
};

const deleteTaxation = async (id, restaurant) => {
  const taxation = await FoodTaxation.findOne({
    _id: new mongoose.Types.ObjectId(id),
    restaurant: new mongoose.Types.ObjectId(restaurant),
  });
  if (!taxation) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await taxation.deleteOne();
  return { success: true };
};

const getTaxationListAdmin = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const matchQuery = {
    $or: [
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
  const queryTaxation = [
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
    {
      $group: {
        _id: '$restaurant',
        restaurants: {
          $first: '$restaurants',
        },
        taxes: {
          $push: {
            id: '$_id',
            taxName: '$taxName',
            taxAmount: {
              $round: [{ $divide: ['$taxAmount', 100] }, 2],
            },
            tax_translations: '$translations',
          },
        },
      },
    },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        restaurant_id: '$restaurants._id',
        restaurant_name: '$restaurants.name',
        restaurant_address: '$restaurants.address',
        restaurant_logo: '$restaurants.logo',
        restaurant_cover: '$restaurants.cover',
        restaurant_translations: '$restaurants.translations',
        taxes: 1,
      },
    },
  ];
  const countResult = await FoodTaxation.aggregate([
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
    {
      $group: {
        _id: '$restaurant',
      },
    },
    {
      $count: 'totalGroups',
    },
  ]);
  const totalResults = countResult.length > 0 ? countResult[0].totalGroups : 0;
  const results = await FoodTaxation.aggregate(queryTaxation);
  return Promise.all([results, countResult, totalResults]).then(() => {
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

const cityzenTaxationList = async (masterId, options) => {
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
  const queryTaxation = [
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
    {
      $group: {
        _id: '$restaurant',
        restaurants: {
          $first: '$restaurants',
        },
        taxes: {
          $push: {
            id: '$_id',
            taxName: '$taxName',
            taxAmount: {
              $round: [{ $divide: ['$taxAmount', 100] }, 2],
            },
            tax_translations: '$translations',
          },
        },
      },
    },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        restaurant_id: '$restaurants._id',
        restaurant_name: '$restaurants.name',
        restaurant_address: '$restaurants.address',
        restaurant_logo: '$restaurants.logo',
        restaurant_cover: '$restaurants.cover',
        restaurant_translations: '$restaurants.translations',
        taxes: 1,
      },
    },
  ];
  const countResult = await FoodTaxation.aggregate([
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
    {
      $group: {
        _id: '$restaurant',
      },
    },
    {
      $count: 'totalGroups',
    },
  ]);

  const results = await FoodTaxation.aggregate(queryTaxation);
  return Promise.all([results, countResult]).then(() => {
    const totalResults = countResult.length > 0 ? countResult[0].totalGroups : 0;
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

const deleteTaxationAdmin = async (restaurant) => {
  await FoodTaxation.deleteMany({ restaurant: new mongoose.Types.ObjectId(restaurant) });
  return { success: true };
};

const getAllMyTaxation = async (restaurant) => {
  const taxations = await FoodTaxation.find({
    restaurant: new mongoose.Types.ObjectId(restaurant),
  });
  return taxations;
};

const exportCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const matchQuery = {
    $or: [
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
        taxName: 1,
        taxAmount: {
          $round: [{ $divide: ['$taxAmount', 100] }, 2],
        },
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
        },
      },
    },
  ];
  const results = await FoodTaxation.aggregate(query);
  return results;
};

const exportRawCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const matchQuery = {
    $or: [
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
  const results = await FoodTaxation.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const taxData = new FoodTaxation({
        restaurant:
          param && param.restaurant && param.restaurant !== null && param.restaurant !== ''
            ? param.restaurant
            : null,
        taxName:
          param && param.taxName && param.taxName !== null && param.taxName !== ''
            ? param.taxName
            : 'NA',
        taxAmount:
          param && param.taxAmount && param.taxAmount !== null && param.taxAmount !== ''
            ? param.taxAmount
            : 0,
        translations: [],
      });
      await FoodTaxation.create(taxData);
    });
  }
  return { success: true };
};

module.exports = {
  saveFoodTaxation,
  getVendorTaxationList,
  updateTaxation,
  deleteTaxation,
  getTaxationListAdmin,
  deleteTaxationAdmin,
  getAllMyTaxation,
  cityzenTaxationList,
  exportCollection,
  exportRawCollection,
  importCollection,
};

