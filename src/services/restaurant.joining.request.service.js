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
const { RestaurantJoiningRequest, User } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createRestaurantJoiningRequest = async (param, payCharge) => {
  const restaurantData = new RestaurantJoiningRequest({
    name: param.name,
    address: param.address,
    shortDescription: param.shortDescription,
    cuisine: param.cuisine,
    logo: param.logo,
    cover: param.cover,
    city: param.city,
    locality: param && param.locality !== '' ? param.locality : null,
    location: { type: param.locationType, coordinates: [param.longitude, param.latitude] },
    approxDeliveryTime: param.approxDeliveryTime,
    dishPriceForTwo: param.dishPriceForTwo,
    takeAway: param.takeAway,
    translations: param.translations,
    restaurantType: param.restaurantType,
    restaurantFacility: param.restaurantFacility,
    acceptScheduleDelivery: param.acceptScheduleDelivery,
    acceptHomeDelivery: param.acceptHomeDelivery,
    minOrderAmount: param.minOrderAmount,
    license: param && param.license !== '' ? param.license : null,
    licenseId: param.licenseId,
    formElement: param.formElement,
    firstName: param.firstName,
    lastName: param.lastName,
    email: param.email,
    password: param.password,
    countryCode: param.countryCode,
    mobile: param.mobile,
    businessType: param.businessType,
    subscription: param && param.subscriptionId !== '' ? param.subscriptionId : null,
    paidAmount: payCharge,
    locale: param && param.locale !== null && param.locale !== '' ? param.locale : 'en',
    status: payCharge !== 0 ? 'pending_payments' : 'created',
    socialFacebook:
      param && param.socialFacebook && param.socialFacebook !== '' && param.socialFacebook !== null
        ? param.socialFacebook
        : '',
    socialInstagram:
      param &&
      param.socialInstagram &&
      param.socialInstagram !== '' &&
      param.socialInstagram !== null
        ? param.socialInstagram
        : '',
    socialX:
      param && param.socialX && param.socialX !== '' && param.socialX !== null ? param.socialX : '',
    socialYoutube:
      param && param.socialYoutube && param.socialYoutube !== '' && param.socialYoutube !== null
        ? param.socialYoutube
        : '',
    socialLinkedIn:
      param && param.socialLinkedIn && param.socialLinkedIn !== '' && param.socialLinkedIn !== null
        ? param.socialLinkedIn
        : '',
    socialPinterest:
      param &&
      param.socialPinterest &&
      param.socialPinterest !== '' &&
      param.socialPinterest !== null
        ? param.socialPinterest
        : '',
  });

  const result = await RestaurantJoiningRequest.create(restaurantData);
  return { id: result.id, success: true };
};

const getRestaurantJoiningRequestById = async (id) => {
  const joiningInfo = await RestaurantJoiningRequest.findById(id);
  return joiningInfo;
};

const updateRestaurantJoiningRequest = async (id, param) => {
  const joiningInfo = await getRestaurantJoiningRequestById(id);
  if (joiningInfo) {
    Object.assign(joiningInfo, param);
    await joiningInfo.save();
  }
};

const getJoiningRequestList = async (options, statusName) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const query = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
          { firstName: searchRegExp },
          { lastName: searchRegExp },
          {
            translations: {
              $elemMatch: {
                title: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [{ businessType: statusName === 'all' ? { $ne: statusName } : statusName }],
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'cuisines',
        localField: 'cuisine',
        foreignField: '_id',
        as: 'cuisine',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              name: 1,
              translations: 1,
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'cities',
        localField: 'city',
        foreignField: '_id',
        as: 'cities',
      },
    },
    {
      $lookup: {
        from: 'localities',
        localField: 'locality',
        foreignField: '_id',
        as: 'localities',
      },
    },
    {
      $lookup: {
        from: 'subscriptions',
        localField: 'subscription',
        foreignField: '_id',
        as: 'subscriptions',
      },
    },
    {
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$localities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$subscriptions',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $addFields: {
        contactNumber: {
          $concat: [
            { $substr: ['$mobile', 0, 2] },
            'XXXXXX',
            { $substr: ['$mobile', { $subtract: [{ $strLenCP: '$mobile' }, 2] }, 2] },
          ],
        },
        contactEmail: {
          $concat: [
            { $substr: [{ $arrayElemAt: [{ $split: ['$email', '@'] }, 0] }, 0, 2] },
            'xxxx@',
            { $arrayElemAt: [{ $split: ['$email', '@'] }, 1] },
          ],
        },
      },
    },
    {
      $addFields: {
        cuisineLimited: { $slice: ['$cuisine', 2] },
        moreCuisines: {
          $cond: [
            { $gt: [{ $size: '$cuisine' }, 2] },
            { $subtract: [{ $size: '$cuisine' }, 2] },
            0,
          ],
        },
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        address: 1,
        logo: 1,
        cover: 1,
        firstName: 1,
        lastName: 1,
        businessType: 1,
        countryCode: 1,
        contactNumber: 1,
        contactEmail: 1,
        cuisine: '$cuisineLimited',
        moreCuisines: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
        subscriptionInfo: {
          id: { $ifNull: ['$subscriptions._id', ''] },
          name: { $ifNull: ['$subscriptions.name', ''] },
          translations: { $ifNull: ['$subscriptions.translations', []] },
        },
        status: 1,
        createdAt: 1,
        translations: 1,
      },
    },
  ];
  const results = await RestaurantJoiningRequest.aggregate(query);
  const countResult = await RestaurantJoiningRequest.aggregate([
    {
      $match: {
        $or: [
          { name: searchRegExp },
          { firstName: searchRegExp },
          { lastName: searchRegExp },
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

// "FB|RJ|2026|ENVATO|FOODBITE|ECITAW15071997"

const cityzenJoiningRequestList = async (masterId, options, statusName) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const query = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
          { firstName: searchRegExp },
          { lastName: searchRegExp },
          {
            translations: {
              $elemMatch: {
                title: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [
          { businessType: statusName === 'all' ? { $ne: statusName } : statusName },
          { city: new mongoose.Types.ObjectId(city) },
        ],
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'cuisines',
        localField: 'cuisine',
        foreignField: '_id',
        as: 'cuisine',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              name: 1,
              translations: 1,
            },
          },
        ],
      },
    },
    {
      $lookup: {
        from: 'cities',
        localField: 'city',
        foreignField: '_id',
        as: 'cities',
      },
    },
    {
      $lookup: {
        from: 'localities',
        localField: 'locality',
        foreignField: '_id',
        as: 'localities',
      },
    },
    {
      $lookup: {
        from: 'subscriptions',
        localField: 'subscription',
        foreignField: '_id',
        as: 'subscriptions',
      },
    },
    {
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$localities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$subscriptions',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $addFields: {
        contactNumber: {
          $concat: [
            { $substr: ['$mobile', 0, 2] },
            'XXXXXX',
            { $substr: ['$mobile', { $subtract: [{ $strLenCP: '$mobile' }, 2] }, 2] },
          ],
        },
        contactEmail: {
          $concat: [
            { $substr: [{ $arrayElemAt: [{ $split: ['$email', '@'] }, 0] }, 0, 2] },
            'xxxx@',
            { $arrayElemAt: [{ $split: ['$email', '@'] }, 1] },
          ],
        },
      },
    },
    {
      $addFields: {
        cuisineLimited: { $slice: ['$cuisine', 2] },
        moreCuisines: {
          $cond: [
            { $gt: [{ $size: '$cuisine' }, 2] },
            { $subtract: [{ $size: '$cuisine' }, 2] },
            0,
          ],
        },
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        address: 1,
        logo: 1,
        cover: 1,
        firstName: 1,
        lastName: 1,
        businessType: 1,
        countryCode: 1,
        contactNumber: 1,
        contactEmail: 1,
        cuisine: '$cuisineLimited',
        moreCuisines: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
        subscriptionInfo: {
          id: { $ifNull: ['$subscriptions._id', ''] },
          name: { $ifNull: ['$subscriptions.name', ''] },
          translations: { $ifNull: ['$subscriptions.translations', []] },
        },
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const results = await RestaurantJoiningRequest.aggregate(query);
  const countResult = await RestaurantJoiningRequest.aggregate([
    {
      $match: {
        $or: [
          { name: searchRegExp },
          { firstName: searchRegExp },
          { lastName: searchRegExp },
          {
            translations: {
              $elemMatch: {
                title: { $regex: searchRegExp },
              },
            },
          },
        ],
        $and: [
          { businessType: statusName === 'all' ? { $ne: statusName } : statusName },
          { city: new mongoose.Types.ObjectId(city) },
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

const deleteRequest = async (id) => {
  const result = await RestaurantJoiningRequest.findById(id);
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await result.deleteOne();
  return { success: true };
};

const getDetail = async (id) => {
  const result = await RestaurantJoiningRequest.findById(id);
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return result;
};

const getDeepDetail = async (id) => {
  const restaurants = await RestaurantJoiningRequest.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(id),
      },
    },
    { $limit: 1 },
    {
      $project: {
        _id: 0,
        id: '$_id',
        password: 1,
        email: 1,
        locale: 1,
        businessType: 1,
        paidAmount: 1,
      },
    },
  ]);
  if (!checkArrayNotEmpty(restaurants)) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return restaurants[0];
};

const rejectRequest = async (id) => {
  const result = await RestaurantJoiningRequest.findById(id);
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  Object.assign(result, { status: 'rejected' });
  await result.save();
  return result;
};

const exportCollection = async (statusName, search) => {
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
        $and: [{ businessType: statusName === 'all' ? { $ne: statusName } : statusName }],
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'cities',
        localField: 'city',
        foreignField: '_id',
        as: 'cities',
      },
    },
    {
      $lookup: {
        from: 'localities',
        localField: 'locality',
        foreignField: '_id',
        as: 'localities',
      },
    },
    {
      $lookup: {
        from: 'subscriptions',
        localField: 'subscription',
        foreignField: '_id',
        as: 'subscriptions',
      },
    },
    {
      $lookup: {
        from: 'restaurantfoodlicenses',
        localField: 'license',
        foreignField: '_id',
        as: 'restaurantfoodlicenses',
      },
    },
    {
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$localities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$subscriptions',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$restaurantfoodlicenses',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        address: 1,
        logo: 1,
        cover: 1,
        firstName: 1,
        lastName: 1,
        businessType: 1,
        countryCode: 1,
        mobile: 1,
        email: 1,
        location: 1,
        city: {
          name: { $ifNull: ['$cities.name', ''] },
        },
        locality: {
          name: { $ifNull: ['$localities.name', ''] },
        },
        subscriptionInfo: {
          name: { $ifNull: ['$subscriptions.name', ''] },
        },
        approxDeliveryTime: 1,
        socialFacebook: 1,
        socialInstagram: 1,
        socialX: 1,
        socialYoutube: 1,
        socialLinkedIn: 1,
        socialPinterest: 1,
        minOrderAmount: {
          $round: [{ $divide: ['$minOrderAmount', 100] }, 2],
        },
        dishPriceForTwo: {
          $round: [{ $divide: ['$dishPriceForTwo', 100] }, 2],
        },
        paidAmount: {
          $round: [{ $divide: ['$paidAmount', 100] }, 2],
        },
        license: {
          name: { $ifNull: ['$restaurantfoodlicenses.name', ''] },
        },
        licenseId: 1,
        acceptScheduleDelivery: 1,
        acceptHomeDelivery: 1,
        takeAway: 1,
        status: 1,
      },
    },
  ];
  const results = await RestaurantJoiningRequest.aggregate(query);
  return results;
};

const exportRawCollection = async (statusName, search) => {
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
        $and: [{ businessType: statusName === 'all' ? { $ne: statusName } : statusName }],
      },
    },
    { $sort: { createdAt: -1 } },
  ];
  const results = await RestaurantJoiningRequest.aggregate(query);
  return results;
};

module.exports = {
  createRestaurantJoiningRequest,
  updateRestaurantJoiningRequest,
  getJoiningRequestList,
  deleteRequest,
  getDetail,
  getDeepDetail,
  rejectRequest,
  cityzenJoiningRequestList,
  exportCollection,
  exportRawCollection,
};

