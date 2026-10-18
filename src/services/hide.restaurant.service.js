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
const { HideRestaurant, Restaurant, User } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const hideRestaurant = async (params) => {
  const restaurant = await HideRestaurant.findOne({
    user: params.user,
    restaurant: params.restaurant,
  });
  if (restaurant) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already Hidden');
  }
  const hideData = new HideRestaurant({
    user: params && params.user && params.user !== '' && params.user !== null ? params.user : null,
    restaurant:
      params && params.restaurant && params.restaurant !== '' && params.restaurant !== null
        ? params.restaurant
        : null,
    reason:
      params && params.reason && params.reason !== '' && params.reason !== null
        ? params.reason
        : null,
  });
  await HideRestaurant.create(hideData);
  return { success: true };
};

const showRestaurant = async (params) => {
  const restaurant = await HideRestaurant.findOne({
    user: params.user,
    restaurant: params.restaurant,
  });
  if (!restaurant) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Not found');
  }
  await restaurant.deleteOne();
  return { success: true };
};

const updateHideReason = async (params) => {
  const restaurant = await HideRestaurant.findOne({
    user: params.user,
    restaurant: params.restaurant,
  });
  if (!restaurant) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Not found');
  }
  Object.assign(restaurant, { reason: params.reason });
  await restaurant.save();
  return { success: true };
};

const getHiddenRestaurantList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const hiddenQuery = [
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'users',
        pipeline: [
          {
            $addFields: {
              contactNumber: {
                $concat: [
                  { $substr: ['$mobile', 0, 2] },
                  'XXXXXX',
                  { $substr: ['$mobile', { $subtract: [{ $strLenCP: '$mobile' }, 2] }, 2] },
                ],
              },
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'hiderestaurantreasons',
        localField: 'reason',
        foreignField: '_id',
        as: 'reasons',
      },
    },
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
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$reasons',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        $or: [
          { 'users.firstName': searchRegExp },
          { 'users.lastName': searchRegExp },
          { 'restaurants.name': searchRegExp },
          {
            'restaurants.translations': {
              $elemMatch: {
                title: { $regex: searchRegExp },
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
        status: 1,
        createdAt: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        reasons: {
          id: { $ifNull: ['$reasons._id', ''] },
          name: { $ifNull: ['$reasons.name', ''] },
          translations: { $ifNull: ['$reasons.translations', []] },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ];
  const hidden = await HideRestaurant.aggregate(hiddenQuery);
  const countResult = await HideRestaurant.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'users',
      },
    },
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
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        $or: [
          { 'users.firstName': searchRegExp },
          { 'users.lastName': searchRegExp },
          { 'restaurants.name': searchRegExp },
          {
            'restaurants.translations': {
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
  return Promise.all([hidden, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      hidden,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityzenHiddenRestaurantList = async (masterId, options) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const hiddenQuery = [
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
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'users',
        pipeline: [
          {
            $addFields: {
              contactNumber: {
                $concat: [
                  { $substr: ['$mobile', 0, 2] },
                  'XXXXXX',
                  { $substr: ['$mobile', { $subtract: [{ $strLenCP: '$mobile' }, 2] }, 2] },
                ],
              },
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'hiderestaurantreasons',
        localField: 'reason',
        foreignField: '_id',
        as: 'reasons',
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$reasons',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        $or: [
          { 'users.firstName': searchRegExp },
          { 'users.lastName': searchRegExp },
          { 'restaurants.name': searchRegExp },
          {
            'restaurants.translations': {
              $elemMatch: {
                title: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [{ 'restaurants.city': new mongoose.Types.ObjectId(city) }],
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        createdAt: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        reasons: {
          id: { $ifNull: ['$reasons._id', ''] },
          name: { $ifNull: ['$reasons.name', ''] },
          translations: { $ifNull: ['$reasons.translations', []] },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ];
  const hidden = await HideRestaurant.aggregate(hiddenQuery);
  const resultcount = await HideRestaurant.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'users',
      },
    },
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
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        $or: [
          { 'users.firstName': searchRegExp },
          { 'users.lastName': searchRegExp },
          { 'restaurants.name': searchRegExp },
          {
            'restaurants.translations': {
              $elemMatch: {
                title: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [{ 'restaurants.city': new mongoose.Types.ObjectId(city) }],
      },
    },
    { $count: 'totalCount' },
  ]);
  const totalResults = checkArrayNotEmpty(resultcount) ? resultcount[0].totalCount : 0;
  return Promise.all([hidden, resultcount]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      hidden,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getMyHiddenRestaurants = async (latitude, longitude, userId) => {
  const restaurantIds = await HideRestaurant.distinct(
    'restaurant',
    { user: new mongoose.Types.ObjectId(userId) },
    { _id: 0, restaurant: 1 }
  );
  const restaurantCuisineLookup = {
    $lookup: {
      from: 'cuisines',
      localField: 'cuisine',
      foreignField: '_id',
      as: 'cuisine',
      pipeline: [
        { $match: { status: true } },
        {
          $project: {
            _id: 0,
            id: '$_id',
            name: 1,
            image: 1,
            status: 1,
            slug: 1,
            translations: 1,
          },
        },
      ],
    },
  };
  const filterOptions = {
    _id: 0,
    id: '$_id',
    name: 1,
    logo: 1,
    cover: 1,
    dishPriceForTwo: {
      $round: [{ $divide: ['$dishPriceForTwo', 100] }, 2],
    },
    translations: 1,
    rating: 1,
    restaurantType: 1,
    status: 1,
    slug: 1,
    cuisine: 1,
    address: 1,
  };
  const hiddenQuery = [
    {
      $match: {
        _id: {
          $in: restaurantIds,
        },
      },
    },
    restaurantCuisineLookup,
    { $project: filterOptions },
  ];
  const restaurants = await Restaurant.aggregate(hiddenQuery);
  return Promise.all([restaurants, restaurantIds]).then(() => {
    const result = {
      restaurants,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const customerHiddenRestaurants = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { user: new mongoose.Types.ObjectId(options.user) };
  const hiddenQuery = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'hiderestaurantreasons',
        localField: 'reason',
        foreignField: '_id',
        as: 'reasons',
      },
    },
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
        path: '$reasons',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        createdAt: 1,
        reasons: {
          id: { $ifNull: ['$reasons._id', ''] },
          name: { $ifNull: ['$reasons.name', ''] },
          translations: { $ifNull: ['$reasons.translations', []] },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ];
  const results = await HideRestaurant.aggregate(hiddenQuery);
  const totalResults = await HideRestaurant.countDocuments(queryCondition);
  return Promise.all([results, totalResults]).then(() => {
    const result = {
      results,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const exportCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $lookup: {
        from: 'hiderestaurantreasons',
        localField: 'reason',
        foreignField: '_id',
        as: 'reasons',
      },
    },
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
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$reasons',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        $or: [
          { 'users.firstName': searchRegExp },
          { 'users.lastName': searchRegExp },
          { 'restaurants.name': searchRegExp },
          {
            'restaurants.translations': {
              $elemMatch: {
                title: { $regex: searchRegExp },
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
        status: 1,
        createdAt: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        reasons: {
          id: { $ifNull: ['$reasons._id', ''] },
          name: { $ifNull: ['$reasons.name', ''] },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
        },
      },
    },
  ];
  const result = await HideRestaurant.aggregate(query);
  return result;
};

const exportRawCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const results = await HideRestaurant.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'users',
      },
    },
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
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        $or: [
          { 'users.firstName': searchRegExp },
          { 'users.lastName': searchRegExp },
          { 'restaurants.name': searchRegExp },
          {
            'restaurants.translations': {
              $elemMatch: {
                title: { $regex: searchRegExp },
              },
            },
          },
        ],
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        users: 0,
        restaurants: 0,
      },
    },
  ]);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const hideData = new HideRestaurant({
        user: param && param.user && param.user !== '' && param.user !== null ? param.user : null,
        restaurant:
          param && param.restaurant && param.restaurant !== '' && param.restaurant !== null
            ? param.restaurant
            : null,
        reason:
          param && param.reason && param.reason !== '' && param.reason !== null
            ? param.reason
            : null,
      });
      await HideRestaurant.create(hideData);
    });
  }
  return { success: true };
};

module.exports = {
  hideRestaurant,
  showRestaurant,
  updateHideReason,
  getHiddenRestaurantList,
  getMyHiddenRestaurants,
  customerHiddenRestaurants,
  cityzenHiddenRestaurantList,
  exportCollection,
  exportRawCollection,
  importCollection,
};

