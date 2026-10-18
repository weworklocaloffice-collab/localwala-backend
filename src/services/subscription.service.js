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
const { Subscriptions } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createSubscriptions = async (param) => {
  if (await Subscriptions.isNameTaken(param.name)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  const subscriptionData = new Subscriptions({
    name: param.name,
    shortDescriptions: param.shortDescriptions,
    price: param.price,
    discount: param.discount,
    validity: param.validity,
    haveTrial: param.haveTrial,
    trialValidity: param.trialValidity,
    pos: param.pos,
    ownDriver: param.ownDriver,
    promote: param.promote,
    customCategory: param.customCategory,
    multiOutlet: param.multiOutlet,
    preBooking: param.preBooking,
    tableOrder: param.tableOrder,
    tiffinSubscription: param.tiffinSubscription,
    ownWaiter: param.ownWaiter,
    ownKitchen: param.ownKitchen,
    orderLimit: param.orderLimit,
    productLimit: param.productLimit,
    icon: param.icon,
    commission: param.commission,
    translations: param.translations,
    status: true,
  });
  await Subscriptions.create(subscriptionData);
  return { success: true };
};

const getAdminSubscriptionList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const query = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
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
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        customCategory: 1,
        commission: {
          $round: [{ $divide: ['$commission', 100] }, 2],
        },
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        haveTrial: 1,
        icon: 1,
        multiOutlet: 1,
        name: 1,
        orderLimit: {
          $round: [{ $divide: ['$orderLimit', 100] }, 2],
        },
        ownDriver: 1,
        pos: 1,
        preBooking: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        productLimit: {
          $round: [{ $divide: ['$productLimit', 100] }, 2],
        },
        trialValidity: {
          $round: [{ $divide: ['$trialValidity', 100] }, 2],
        },
        validity: {
          $round: [{ $divide: ['$validity', 100] }, 2],
        },
        promote: 1,
        shortDescriptions: 1,
        slug: 1,
        status: 1,
        tableOrder: 1,
        tiffinSubscription: 1,
        ownWaiter: 1,
        ownKitchen: 1,
        translations: 1,
      },
    },
  ];
  const results = await Subscriptions.aggregate(query);
  const countResult = await Subscriptions.aggregate([
    {
      $match: {
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
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

const getSubscriptionId = async (id) => {
  return Subscriptions.findById(id);
};

const getById = async (id) => {
  const subscription = await getSubscriptionId(id);
  if (!subscription) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return subscription;
};

const updateSubscriptionById = async (subscriptionId, updateBody) => {
  const subscription = await getSubscriptionId(subscriptionId);
  if (!subscription) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (updateBody.name && (await Subscriptions.isNameTaken(updateBody.name, subscriptionId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  Object.assign(subscription, updateBody);
  await subscription.save();
  return { success: true };
};

const deleteSubscriptionById = async (subscriptionId) => {
  const subscription = await getSubscriptionId(subscriptionId);
  if (!subscription) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await subscription.deleteOne();
  return { success: true };
};

const updateStatus = async (subscriptionId, updateBody) => {
  const subscription = await getSubscriptionId(subscriptionId);
  if (!subscription) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (updateBody.name && (await Subscriptions.isNameTaken(updateBody.name, subscriptionId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  Object.assign(subscription, updateBody);
  await subscription.save();
  return { success: true };
};

const listAllSubscription = async () => {
  const subscription = await Subscriptions.find({});
  return subscription;
};

const getSubscriptionListForNewRestaurant = async () => {
  const subscription = await Subscriptions.find({ status: true });
  return subscription;
};

const exportCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
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
    {
      $project: {
        _id: 0,
        id: '$_id',
        customCategory: 1,
        commission: {
          $round: [{ $divide: ['$commission', 100] }, 2],
        },
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        haveTrial: 1,
        icon: 1,
        multiOutlet: 1,
        name: 1,
        orderLimit: {
          $round: [{ $divide: ['$orderLimit', 100] }, 2],
        },
        ownDriver: 1,
        pos: 1,
        preBooking: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        productLimit: {
          $round: [{ $divide: ['$productLimit', 100] }, 2],
        },
        trialValidity: {
          $round: [{ $divide: ['$trialValidity', 100] }, 2],
        },
        validity: {
          $round: [{ $divide: ['$validity', 100] }, 2],
        },
        promote: 1,
        slug: 1,
        status: 1,
        tableOrder: 1,
        tiffinSubscription: 1,
        ownWaiter: 1,
        ownKitchen: 1,
      },
    },
  ];
  const results = await Subscriptions.aggregate(query);
  return results;
};

const exportRawCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const query = [
    {
      $match: {
        $or: [
          { name: searchRegExp },
          { slug: searchRegExp },
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
  const results = await Subscriptions.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const subscriptionData = new Subscriptions({
        name: param && param.name && param.name !== null && param.name !== '' ? param.name : 'NA',
        shortDescriptions:
          param &&
          param.shortDescriptions &&
          param.shortDescriptions !== null &&
          param.shortDescriptions !== ''
            ? param.shortDescriptions
            : 'NA',
        price:
          param && param.price && param.price !== null && param.price !== '' ? param.price : 99,
        discount:
          param && param.discount && param.discount !== null && param.discount !== ''
            ? param.discount
            : 0,
        validity:
          param && param.validity && param.validity !== null && param.validity !== ''
            ? param.validity
            : 0,
        haveTrial: param && (param.haveTrial === 'Yes' || param.haveTrial === 'yes'),
        trialValidity:
          param && param.trialValidity && param.trialValidity !== null && param.trialValidity !== ''
            ? param.trialValidity
            : 0,
        pos: param && (param.pos === 'Yes' || param.pos === 'yes'),
        ownDriver: param && (param.ownDriver === 'Yes' || param.ownDriver === 'yes'),
        promote: param && (param.promote === 'Yes' || param.promote === 'yes'),
        customCategory: param && (param.customCategory === 'Yes' || param.customCategory === 'yes'),
        multiOutlet: param && (param.multiOutlet === 'Yes' || param.multiOutlet === 'yes'),
        preBooking: param && (param.preBooking === 'Yes' || param.preBooking === 'yes'),
        tableOrder: param && (param.tableOrder === 'Yes' || param.tableOrder === 'yes'),
        tiffinSubscription:
          param && (param.tiffinSubscription === 'Yes' || param.tiffinSubscription === 'yes'),
        ownWaiter: param && (param.ownWaiter === 'Yes' || param.ownWaiter === 'yes'),
        ownKitchen: param && (param.ownKitchen === 'Yes' || param.ownKitchen === 'yes'),
        orderLimit:
          param && param.orderLimit && param.orderLimit !== null && param.orderLimit !== ''
            ? param.orderLimit
            : -1,
        productLimit:
          param && param.productLimit && param.productLimit !== null && param.productLimit !== ''
            ? param.productLimit
            : -1,
        icon: param && param.icon && param.icon !== null && param.icon !== '' ? param.icon : 'NA',
        commission:
          param && param.commission && param.commission !== null && param.commission !== ''
            ? param.commission
            : 5,
        translations: [],
        status: param && (param.status === 'active' || param.status === 'Active'),
      });
      await Subscriptions.create(subscriptionData);
    });
  }
  return { success: true };
};

module.exports = {
  createSubscriptions,
  getSubscriptionId,
  updateSubscriptionById,
  deleteSubscriptionById,
  getById,
  updateStatus,
  listAllSubscription,
  getAdminSubscriptionList,
  getSubscriptionListForNewRestaurant,
  exportCollection,
  exportRawCollection,
  importCollection,
};

