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
const { DateTime } = require('luxon');
const { Subscriber } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createSubscriber = async (subscriberBody) => {
  return Subscriber.create(subscriberBody);
};

const getAllSubscriber = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const orderMatch = {
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
      { 'subscriptions.name': searchRegExp },
      { 'subscriptions.slug': searchRegExp },
      {
        'subscriptions.translations': {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
    ].filter(Boolean),
  };
  const results = await Subscriber.aggregate([
    {
      $lookup: {
        from: 'restaurants',
        localField: 'restaurant',
        foreignField: '_id',
        as: 'restaurants',
      },
    },
    {
      $lookup: {
        from: 'subscriptions',
        localField: 'subscriptions',
        foreignField: '_id',
        as: 'subscriptions',
      },
    },
    {
      $unwind: {
        path: '$restaurants',
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
      $match: orderMatch,
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        trialStartDate: 1,
        trialEndDate: 1,
        startDate: 1,
        endDate: 1,
        status: 1,
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        subscriptions: {
          id: { $ifNull: ['$subscriptions._id', ''] },
          name: { $ifNull: ['$subscriptions.name', ''] },
          translations: { $ifNull: ['$subscriptions.translations', []] },
        },
      },
    },
  ]);
  const countResult = await Subscriber.aggregate([
    {
      $lookup: {
        from: 'restaurants',
        localField: 'restaurant',
        foreignField: '_id',
        as: 'restaurants',
      },
    },
    {
      $lookup: {
        from: 'subscriptions',
        localField: 'subscriptions',
        foreignField: '_id',
        as: 'subscriptions',
      },
    },
    {
      $unwind: {
        path: '$restaurants',
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
      $match: orderMatch,
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
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getSubscriberId = async (id) => {
  return Subscriber.findById(id);
};

const updateSubscriberById = async (subscriberId, updateBody) => {
  const subscriber = await getSubscriberId(subscriberId);
  if (!subscriber) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  Object.assign(subscriber, updateBody);
  await subscriber.save();
  return subscriber;
};

const deleteSubscriberById = async (subscriberId) => {
  const subscriber = await getSubscriberId(subscriberId);
  if (!subscriber) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await subscriber.deleteOne();
  return subscriber;
};

const deleteSubscriberByRestaurant = async (restaurantId) => {
  const subscriber = await Subscriber.findOne({ restaurant: restaurantId });
  if (subscriber) {
    await subscriber.deleteOne();
    return subscriber;
  }
};

const renewSubscription = async (id) => {
  const info = await Subscriber.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(id),
      },
    },
    { $limit: 1 },
    {
      $lookup: {
        from: 'subscriptions',
        localField: 'subscriptions',
        foreignField: '_id',
        as: 'subscriptions',
      },
    },
    {
      $unwind: {
        path: '$subscriptions',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        trialEndDate: 1,
        endDate: 1,
        subscriptionInfo: {
          validity: { $divide: [{ $ifNull: ['$subscriptions.validity', 0] }, 100] },
        },
      },
    },
  ]);
  if (checkArrayNotEmpty(info)) {
    const detail = info[0];
    let targetDateString = '';
    if (detail && detail.trialEndDate !== null && detail.trialEndDate !== '') {
      targetDateString = detail.trialEndDate;
    }
    if (detail && detail.endDate !== null && detail.endDate !== '') {
      targetDateString = detail.endDate;
    }
    const targetDate = new Date(targetDateString);
    const currentDate = new Date();
    const differenceInMs = targetDate - currentDate;
    let differenceInDays = Math.ceil(differenceInMs / (1000 * 60 * 60 * 24));
    if (differenceInDays <= 0) {
      differenceInDays = 0;
    }
    const totalDayToAdd = parseInt(
      parseInt(differenceInDays, 10) + parseInt(detail.subscriptionInfo.validity, 10),
      10
    );
    const serverStartDate = DateTime.now().toFormat('yyyy-MM-dd');
    const serverEndDate = DateTime.now().plus({ days: totalDayToAdd }).toFormat('yyyy-MM-dd');
    const subscriptionUpdate = {
      trialStartDate: '',
      trialEndDate: '',
      startDate: serverStartDate,
      endDate: serverEndDate,
    };
    const subscriber = await getSubscriberId(id);
    if (subscriber) {
      Object.assign(subscriber, subscriptionUpdate);
      await subscriber.save();
    }
  }
};

const extendSubscriptionDate = async (param) => {
  const subscriber = await getSubscriberId(param.id);
  if (!subscriber) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateBody = {
    startDate:
      subscriber &&
      subscriber.startDate &&
      subscriber.startDate !== null &&
      subscriber.startDate !== ''
        ? param.startDate
        : null,
    endDate:
      subscriber && subscriber.endDate && subscriber.endDate !== null && subscriber.endDate !== ''
        ? param.endDate
        : null,
    trialStartDate:
      subscriber &&
      subscriber.trialStartDate &&
      subscriber.trialStartDate !== null &&
      subscriber.trialStartDate !== ''
        ? param.startDate
        : null,
    trialEndDate:
      subscriber &&
      subscriber.trialEndDate &&
      subscriber.trialEndDate !== null &&
      subscriber.trialEndDate !== ''
        ? param.endDate
        : null,
  };
  Object.assign(subscriber, updateBody);
  await subscriber.save();
  return { success: true };
};

const exportCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const orderMatch = {
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
      { 'subscriptions.name': searchRegExp },
      { 'subscriptions.slug': searchRegExp },
      {
        'subscriptions.translations': {
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
      $lookup: {
        from: 'subscriptions',
        localField: 'subscriptions',
        foreignField: '_id',
        as: 'subscriptions',
      },
    },
    {
      $unwind: {
        path: '$restaurants',
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
      $match: orderMatch,
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        trialStartDate: 1,
        trialEndDate: 1,
        startDate: 1,
        endDate: 1,
        status: 1,
        restaurant: {
          name: { $ifNull: ['$restaurants.name', ''] },
        },
        subscriptions: {
          id: { $ifNull: ['$subscriptions._id', ''] },
          name: { $ifNull: ['$subscriptions.name', ''] },
        },
      },
    },
  ];
  const results = await Subscriber.aggregate(query);
  return results;
};

const exportRawCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const orderMatch = {
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
      { 'subscriptions.name': searchRegExp },
      { 'subscriptions.slug': searchRegExp },
      {
        'subscriptions.translations': {
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
      $lookup: {
        from: 'subscriptions',
        localField: 'subscriptions',
        foreignField: '_id',
        as: 'subscriptions',
      },
    },
    {
      $unwind: {
        path: '$restaurants',
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
      $match: orderMatch,
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        restaurants: 0,
        subscriptions: 0,
      },
    },
  ];
  const results = await Subscriber.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const subscriberData = new Subscriber({
        restaurant:
          param && param.restaurant && param.restaurant !== null && param.restaurant !== ''
            ? param.restaurant
            : null,
        subscriptions:
          param && param.subscriptions && param.subscriptions !== null && param.subscriptions !== ''
            ? param.subscriptions
            : null,
        trialStartDate:
          param &&
          param.trialStartDate &&
          param.trialStartDate !== null &&
          param.trialStartDate !== '' &&
          param.trialStartDate !== '-'
            ? param.trialStartDate
            : null,
        trialEndDate:
          param &&
          param.trialEndDate &&
          param.trialEndDate !== null &&
          param.trialEndDate !== '' &&
          param.trialEndDate !== '-'
            ? param.trialEndDate
            : null,
        startDate:
          param &&
          param.startDate &&
          param.startDate !== null &&
          param.startDate !== '' &&
          param.startDate !== '-'
            ? param.startDate
            : null,
        endDate:
          param &&
          param.endDate &&
          param.endDate !== null &&
          param.endDate !== '' &&
          param.endDate !== '-'
            ? param.endDate
            : null,
        cronJobDates: [],
        status: param && (param.status === 'active' || param.status === 'Active'),
      });
      await Subscriber.create(subscriberData);
    });
  }
  return { success: true };
};

module.exports = {
  createSubscriber,
  getAllSubscriber,
  getSubscriberId,
  updateSubscriberById,
  deleteSubscriberById,
  deleteSubscriberByRestaurant,
  renewSubscription,
  extendSubscriptionDate,
  exportCollection,
  exportRawCollection,
  importCollection,
};

