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
const mongoose = require('mongoose');
const ApiError = require('../utils/ApiError');
const {
  SubscriptionTiffinPackage,
  Food,
  BusinessSettings,
  OrderSettings,
  RestaurantSettings,
  PaymentConfig,
  DeliveryInstruction,
  User,
  Restaurant,
} = require('../models');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createPackage = async (param) => {
  const packageData = new SubscriptionTiffinPackage({
    name: param.name,
    shortDescription: param.shortDescription,
    image: param.image,
    restaurant: param.restaurant,
    foods: param.foods,
    interval: param.interval,
    offDays: param.offDays,
    totalOrder: param.totalOrder,
    orderTo: param.orderTo,
    deliveryArea:
      param && param.deliveryArea && param.deliveryArea !== null && param.deliveryArea !== ''
        ? param.deliveryArea
        : 0,
    available: param.available,
    timeSlots: param.timeSlots,
    canSelectAddon: param.canSelectAddon,
    canSelectVariation: param.canSelectVariation,
    price: param.price,
    discountType: param.discountType,
    discount: param.discount,
    notice: param.notice,
    translations: param.translations,
    status:
      param && param.status && param.status !== null && param.status !== '' ? param.status : 'hold',
  });
  await SubscriptionTiffinPackage.create(packageData);
  return { success: true };
};

const updatePackage = async (id, param) => {
  const subscription = await SubscriptionTiffinPackage.findById(id);
  if (!subscription) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateBody = {
    name: param.name,
    shortDescription: param.shortDescription,
    image: param.image,
    restaurant: param.restaurant,
    foods: param.foods,
    interval: param.interval,
    offDays: param.offDays,
    totalOrder: param.totalOrder,
    orderTo: param.orderTo,
    deliveryArea:
      param && param.deliveryArea && param.deliveryArea !== null && param.deliveryArea !== ''
        ? param.deliveryArea
        : 0,
    available: param.available,
    timeSlots: param.timeSlots,
    canSelectAddon: param.canSelectAddon,
    canSelectVariation: param.canSelectVariation,
    price: param.price,
    discountType: param.discountType,
    discount: param.discount,
    notice: param.notice,
    translations: param.translations,
  };
  Object.assign(subscription, updateBody);
  await subscription.save();
  return { success: true };
};

const getSubscriptionPackageListVendor = async (restaurant, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const results = await SubscriptionTiffinPackage.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(restaurant),
      },
    },
    {
      $lookup: {
        from: 'userpurchasedtiffinsubscriptions',
        localField: '_id',
        foreignField: 'subscriptionPackage',
        as: 'userpurchasedtiffinsubscriptions',
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        image: 1,
        foods: 1,
        interval: 1,
        available: 1,
        orderTo: 1,
        totalPurchase: {
          $size: '$userpurchasedtiffinsubscriptions',
        },
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        discountType: 1,
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        status: 1,
        translations: 1,
      },
    },
  ]);
  const totalResults = await SubscriptionTiffinPackage.countDocuments({
    restaurant: new mongoose.Types.ObjectId(restaurant),
  });
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

const getById = async (id, restaurant) => {
  const results = await SubscriptionTiffinPackage.aggregate([
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
        name: 1,
        image: 1,
        foods: 1,
        interval: 1,
        available: 1,
        orderTo: 1,
        canSelectAddon: 1,
        canSelectVariation: 1,
        deliveryArea: 1,
        notice: 1,
        offDays: 1,
        restaurant: 1,
        shortDescription: 1,
        status: 1,
        timeSlots: 1,
        totalOrder: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        discountType: 1,
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        translations: 1,
      },
    },
  ]);
  if (!results) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (!results[0]) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const foodQuery = [
    { $match: { restaurant: new mongoose.Types.ObjectId(restaurant), status: 'live' } },
    {
      $lookup: {
        from: 'addons',
        localField: 'addons',
        foreignField: '_id',
        pipeline: [
          { $match: { status: true } },
          {
            $project: {
              _id: 0,
              id: '$_id',
              name: 1,
              translations: 1,
            },
          },
        ],
        as: 'addons',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        image: 1,
        addons: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        discountType: 1,
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        variations: 1,
        translations: 1,
      },
    },
  ];
  const foods = await Food.aggregate(foodQuery);
  return { info: results[0], food: foods };
};

const getSubscriptionPackageListAdmin = async (options) => {
  const searchRegExp = RegExp(options.search, 'i');
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const orderMatch = {
    $or: [
      { name: searchRegExp },
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
  const results = await SubscriptionTiffinPackage.aggregate([
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
        from: 'userpurchasedtiffinsubscriptions',
        localField: '_id',
        foreignField: 'subscriptionPackage',
        as: 'userpurchasedtiffinsubscriptions',
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
        foods: 1,
        interval: 1,
        available: 1,
        orderTo: 1,
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        totalPurchase: {
          $size: '$userpurchasedtiffinsubscriptions',
        },
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        discountType: 1,
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        status: 1,
        translations: 1,
      },
    },
  ]);
  const countResult = await SubscriptionTiffinPackage.aggregate([
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

const cityzenPackageList = async (masterId, options) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const orderMatch = {
    $or: [
      { name: searchRegExp },
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
  const results = await SubscriptionTiffinPackage.aggregate([
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
        from: 'userpurchasedtiffinsubscriptions',
        localField: '_id',
        foreignField: 'subscriptionPackage',
        as: 'userpurchasedtiffinsubscriptions',
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
        foods: 1,
        interval: 1,
        available: 1,
        orderTo: 1,
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        totalPurchase: {
          $size: '$userpurchasedtiffinsubscriptions',
        },
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        discountType: 1,
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        status: 1,
        translations: 1,
      },
    },
  ]);
  const countResult = await SubscriptionTiffinPackage.aggregate([
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
      $match: orderMatch,
    },
    { $count: 'totalCount' },
  ]);
  return Promise.all([results, countResult]).then(() => {
    const totalResults = countResult.length > 0 ? countResult[0].totalCount : 0;
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

const updatePackageStatus = async (id, param) => {
  const subscription = await SubscriptionTiffinPackage.findById(id);
  if (!subscription) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateBody = {
    status: param.status,
  };
  Object.assign(subscription, updateBody);
  await subscription.save();
  return { success: true };
};

const deletePackage = async (id) => {
  const subscription = await SubscriptionTiffinPackage.findById(id);
  if (!subscription) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await subscription.deleteOne();
  return { success: true };
};

const getSubscriptionPackageDetailCustomer = async (id) => {
  const info = await SubscriptionTiffinPackage.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(id),
      },
    },
    { $sort: { createdAt: -1 } },
    { $limit: 1 },
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
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        shortDescription: 1,
        image: 1,
        foods: 1,
        interval: 1,
        offDays: 1,
        totalOrder: 1,
        orderTo: 1,
        deliveryArea: 1,
        available: 1,
        timeSlots: 1,
        canSelectAddon: 1,
        canSelectVariation: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        discountType: 1,
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        notice: 1,
        status: 1,
        translations: 1,
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ]);
  if (!info[0]) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const businessSettings = await BusinessSettings.findOne({}, { deliveryArea: 1, findMode: 1 });
  const findMode =
    businessSettings && businessSettings.findMode !== null && businessSettings.findMode !== ''
      ? businessSettings.findMode
      : 'km';
  const foodQuery = [
    {
      $match: {
        _id: {
          $in: info[0].foods,
        },
        status: 'live',
        inStock: true,
      },
    },
    { $sort: { rating: -1 } },
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
        from: 'addons',
        localField: 'addons',
        foreignField: '_id',
        pipeline: [
          { $match: { status: true, inStock: true } },
          {
            $project: {
              _id: 0,
              id: '$_id',
              name: 1,
              inStock: 1,
              stockType: 1,
              stockNumber: 1,
              price: {
                $round: [{ $divide: ['$price', 100] }, 2],
              },
              translations: 1,
            },
          },
        ],
        as: 'addons',
      },
    },
    {
      $lookup: {
        from: 'foodtaxations',
        localField: 'foodTax',
        foreignField: '_id',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              taxName: 1,
              taxAmount: {
                $round: [{ $divide: ['$taxAmount', 100] }, 2],
              },
              translations: 1,
            },
          },
        ],
        as: 'foodtaxations',
      },
    },
    {
      $lookup: {
        from: 'foodorderreviews',
        localField: '_id',
        foreignField: 'food',
        as: 'foodorderreviews',
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
        name: 1,
        shortDescription: 1,
        image: 1,
        restaurant: 1,
        foodType: 1,
        startTime: 1,
        endTime: 1,
        discountType: 1,
        purchaseLimit: 1,
        variations: 1,
        translations: 1,
        recommended: 1,
        rating: 1,
        totalRating: {
          $size: '$foodorderreviews',
        },
        addons: 1,
        status: 1,
        inStock: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        taxationEnable: 1,
        foodtaxations: 1,
      },
    },
  ];
  const foodList = await Food.aggregate(foodQuery);
  return Promise.all([info, foodList, findMode]).then(() => {
    const result = {
      details: info[0],
      foods: foodList,
      findMode,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const buySubscriptionDetails = async (id) => {
  const info = await SubscriptionTiffinPackage.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(id),
      },
    },
    { $sort: { createdAt: -1 } },
    { $limit: 1 },
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
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        shortDescription: 1,
        image: 1,
        foods: 1,
        interval: 1,
        offDays: 1,
        totalOrder: 1,
        orderTo: 1,
        deliveryArea: 1,
        available: 1,
        timeSlots: 1,
        canSelectAddon: 1,
        canSelectVariation: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        discountType: 1,
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        notice: 1,
        status: 1,
        translations: 1,
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ]);
  if (!info[0]) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const foodQuery = [
    {
      $match: {
        _id: {
          $in: info[0].foods,
        },
        status: 'live',
        inStock: true,
      },
    },
    { $sort: { rating: -1 } },
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
        from: 'addons',
        localField: 'addons',
        foreignField: '_id',
        pipeline: [
          { $match: { status: true, inStock: true } },
          {
            $project: {
              _id: 0,
              id: '$_id',
              name: 1,
              inStock: 1,
              stockType: 1,
              stockNumber: 1,
              price: {
                $round: [{ $divide: ['$price', 100] }, 2],
              },
              translations: 1,
            },
          },
        ],
        as: 'addons',
      },
    },
    {
      $lookup: {
        from: 'foodtaxations',
        localField: 'foodTax',
        foreignField: '_id',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              taxName: 1,
              taxAmount: {
                $round: [{ $divide: ['$taxAmount', 100] }, 2],
              },
              translations: 1,
            },
          },
        ],
        as: 'foodtaxations',
      },
    },
    {
      $lookup: {
        from: 'foodorderreviews',
        localField: '_id',
        foreignField: 'food',
        as: 'foodorderreviews',
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
        name: 1,
        shortDescription: 1,
        image: 1,
        restaurant: 1,
        foodType: 1,
        startTime: 1,
        endTime: 1,
        discountType: 1,
        purchaseLimit: 1,
        variations: 1,
        translations: 1,
        recommended: 1,
        rating: 1,
        totalRating: {
          $size: '$foodorderreviews',
        },
        addons: 1,
        status: 1,
        inStock: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        foodtaxations: 1,
        taxationEnable: 1,
      },
    },
  ];

  const foodList = await Food.aggregate(foodQuery);

  const orderSettings = await OrderSettings.findOne({}, { includeChargesForSubscription: 1 });
  const businessSettings = await BusinessSettings.findOne(
    {},
    {
      haveFreeDeliveryInTotal: 1,
      freeDelivery: 1,
      haveFreeDeliveryInDistance: 1,
      freeDeliveryInDistance: 1,
      deliveryChargeMethod: 1,
      deliveryChargeAmount: 1,
      includeTaxOnFood: 1,
      foodTaxName: 1,
      foodTaxAmount: 1,
      foodTaxType: 1,
      additionalServiceCharge: 1,
      additionalServiceName: 1,
      additionalServiceAmount: 1,
      partialPayment: 1,
      partialAmountPayment: 1,
      deliveryArea: 1,
      findMode: 1,
    }
  );
  const restaurantSettings = await RestaurantSettings.findOne(
    {},
    {
      havePackagingCharges: 1,
      packagingCharges: 1,
      includePackagesChargesInTax: 1,
      packagingChargesTax: 1,
    }
  );
  const findMode =
    businessSettings && businessSettings.findMode !== null && businessSettings.findMode !== ''
      ? businessSettings.findMode
      : 'km';

  const paymentSettings = await PaymentConfig.find(
    { status: true, paymentWay: 'online' },
    { name: 1, slug: 1, image: 1, translations: 1, isDefault: 1 }
  );
  const defaultPayment = await PaymentConfig.findOne(
    { isDefault: true, status: true, paymentWay: 'online' },
    { name: 1, slug: 1, image: 1, translations: 1, isDefault: 1 }
  );
  const deliveryInstruction = await DeliveryInstruction.find({ status: true });

  return Promise.all([
    info,
    foodList,
    orderSettings,
    businessSettings,
    restaurantSettings,
    paymentSettings,
    defaultPayment,
    deliveryInstruction,
    findMode,
  ]).then(() => {
    const result = {
      details: info[0],
      foods: foodList,
      payments: paymentSettings,
      primary: defaultPayment,
      instruction: deliveryInstruction,
      orderSettings,
      businessSettings,
      restaurantSettings,
      findMode,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getSubscriptionPackageFromVendor = async (restaurant, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const results = await SubscriptionTiffinPackage.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(restaurant),
        status: 'live',
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        shortDescription: 1,
        image: 1,
        interval: 1,
        available: 1,
        orderTo: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        discountType: 1,
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        status: 1,
        translations: 1,
      },
    },
  ]);
  const totalResults = await SubscriptionTiffinPackage.countDocuments({
    restaurant: new mongoose.Types.ObjectId(restaurant),
    status: 'live',
  });
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

const purchaseSubscriptionDetail = async (id) => {
  const info = await SubscriptionTiffinPackage.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(id),
      },
    },
    { $sort: { createdAt: -1 } },
    { $limit: 1 },
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
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        shortDescription: 1,
        image: 1,
        foods: 1,
        interval: 1,
        offDays: 1,
        totalOrder: 1,
        orderTo: 1,
        deliveryArea: 1,
        available: 1,
        timeSlots: 1,
        canSelectAddon: 1,
        canSelectVariation: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        discountType: 1,
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        notice: 1,
        status: 1,
        translations: 1,
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          slug: { $ifNull: ['$restaurants.slug', ''] },
          location: { $ifNull: ['$restaurants.location', null] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ]);
  if (!info[0]) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  const foodQuery = [
    {
      $match: {
        _id: {
          $in: info[0].foods,
        },
        status: 'live',
        inStock: true,
      },
    },
    { $sort: { rating: -1 } },
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
        from: 'addons',
        localField: 'addons',
        foreignField: '_id',
        pipeline: [
          { $match: { status: true, inStock: true } },
          {
            $project: {
              _id: 0,
              id: '$_id',
              name: 1,
              inStock: 1,
              stockType: 1,
              stockNumber: 1,
              price: {
                $round: [{ $divide: ['$price', 100] }, 2],
              },
              translations: 1,
            },
          },
        ],
        as: 'addons',
      },
    },
    {
      $lookup: {
        from: 'foodtaxations',
        localField: 'foodTax',
        foreignField: '_id',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              taxName: 1,
              taxAmount: {
                $round: [{ $divide: ['$taxAmount', 100] }, 2],
              },
              translations: 1,
            },
          },
        ],
        as: 'foodtaxations',
      },
    },
    {
      $lookup: {
        from: 'foodorderreviews',
        localField: '_id',
        foreignField: 'food',
        as: 'foodorderreviews',
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
        name: 1,
        shortDescription: 1,
        image: 1,
        restaurant: 1,
        foodType: 1,
        startTime: 1,
        endTime: 1,
        discountType: 1,
        purchaseLimit: 1,
        variations: 1,
        translations: 1,
        recommended: 1,
        rating: 1,
        totalRating: {
          $size: '$foodorderreviews',
        },
        addons: 1,
        status: 1,
        inStock: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        foodtaxations: 1,
        taxationEnable: 1,
      },
    },
  ];

  const foodList = await Food.aggregate(foodQuery);

  const orderSettings = await OrderSettings.findOne({}, { includeChargesForSubscription: 1 });
  const businessSettings = await BusinessSettings.findOne(
    {},
    {
      haveFreeDeliveryInTotal: 1,
      freeDelivery: 1,
      haveFreeDeliveryInDistance: 1,
      freeDeliveryInDistance: 1,
      deliveryChargeMethod: 1,
      deliveryChargeAmount: 1,
      includeTaxOnFood: 1,
      foodTaxName: 1,
      foodTaxAmount: 1,
      foodTaxType: 1,
      additionalServiceCharge: 1,
      additionalServiceName: 1,
      additionalServiceAmount: 1,
      partialPayment: 1,
      partialAmountPayment: 1,
      deliveryArea: 1,
      findMode: 1,
    }
  );
  const restaurantSettings = await RestaurantSettings.findOne(
    {},
    {
      havePackagingCharges: 1,
      packagingCharges: 1,
      includePackagesChargesInTax: 1,
      packagingChargesTax: 1,
    }
  );
  const findMode =
    businessSettings && businessSettings.findMode !== null && businessSettings.findMode !== ''
      ? businessSettings.findMode
      : 'km';
  return Promise.all([
    info,
    foodList,
    orderSettings,
    businessSettings,
    restaurantSettings,
    findMode,
  ]).then(() => {
    const result = {
      details: info[0],
      foods: foodList,
      orderSettings,
      businessSettings,
      restaurantSettings,
      findMode,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const vendorTiffinPackageList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { restaurant: new mongoose.Types.ObjectId(options.restaurant) };
  const results = await SubscriptionTiffinPackage.aggregate([
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
        from: 'userpurchasedtiffinsubscriptions',
        localField: '_id',
        foreignField: 'subscriptionPackage',
        as: 'userpurchasedtiffinsubscriptions',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        foods: 1,
        interval: 1,
        available: 1,
        orderTo: 1,
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        totalPurchase: {
          $size: '$userpurchasedtiffinsubscriptions',
        },
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        discountType: 1,
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        status: 1,
        translations: 1,
      },
    },
  ]);
  const totalResults = await SubscriptionTiffinPackage.countDocuments(queryCondition);
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

const exportCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const orderMatch = {
    $or: [
      { name: searchRegExp },
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
    { $sort: { createdAt: -1 } },
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
        from: 'userpurchasedtiffinsubscriptions',
        localField: '_id',
        foreignField: 'subscriptionPackage',
        as: 'userpurchasedtiffinsubscriptions',
      },
    },
    {
      $match: orderMatch,
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        shortDescription: 1,
        image: 1,
        foodCount: { $size: '$foods' },
        offDayCount: { $size: '$offDays' },
        interval: 1,
        available: 1,
        orderTo: 1,
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
        },
        totalPurchase: {
          $size: '$userpurchasedtiffinsubscriptions',
        },
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        discountType: 1,
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        status: 1,
        totalOrder: 1,
        deliveryArea: 1,
        canSelectAddon: 1,
        canSelectVariation: 1,
      },
    },
  ];
  const results = await SubscriptionTiffinPackage.aggregate(query);
  return results;
};

const exportRawCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const orderMatch = {
    $or: [
      { name: searchRegExp },
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
    { $sort: { createdAt: -1 } },
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
        from: 'userpurchasedtiffinsubscriptions',
        localField: '_id',
        foreignField: 'subscriptionPackage',
        as: 'userpurchasedtiffinsubscriptions',
      },
    },
    {
      $match: orderMatch,
    },
    {
      $project: {
        restaurants: 0,
        userpurchasedtiffinsubscriptions: 0,
      },
    },
  ];
  const results = await SubscriptionTiffinPackage.aggregate(query);
  return results;
};

const checkPermissionOfRestaurant = async (vendor) => {
  const restaurantInfo = await Restaurant.findOne({ _id: new mongoose.Types.ObjectId(vendor) });
  let tiffinSubscription = false;
  if (
    restaurantInfo !== null &&
    restaurantInfo.type === 'derived' &&
    restaurantInfo.isOutlet === true &&
    restaurantInfo.outletManagerId !== null
  ) {
    const outletManager = await Restaurant.findById(restaurantInfo.outletManagerId, {
      tiffinSubscription: 1,
    });
    if (outletManager !== null && outletManager.id !== null) {
      tiffinSubscription = outletManager.tiffinSubscription;
    }
  } else {
    tiffinSubscription = restaurantInfo.tiffinSubscription;
  }
  return { tiffinSubscription };
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
    importArray.forEach(async (param) => {
      const availableArray = ['breakfast', 'lunch', 'dinner'];
      const orderToArray = ['homedelivery', 'selfpickup'];
      const intervalArray = ['week', 'fortnight', 'month'];
      const statusArray = ['live', 'hold', 'hide'];
      const restaurantId =
        param && param.restaurant && param.restaurant !== null && param.restaurant !== ''
          ? param.restaurant
          : null;
      const permission = await checkPermissionOfRestaurant(restaurantId);
      if (
        restaurantId !== null &&
        availableArray.includes(param.available) &&
        orderToArray.includes(param.orderTo) &&
        intervalArray.includes(param.interval) &&
        permission.tiffinSubscription &&
        statusArray.includes(param.status)
      ) {
        const timeSlotsArray =
          param &&
          param.timeSlots &&
          param.timeSlots !== null &&
          param.timeSlots !== '' &&
          param.timeSlots !== '[]'
            ? safeParse(param.timeSlots)
            : [];
        const noticeArray =
          param &&
          param.notice &&
          param.notice !== null &&
          param.notice !== '' &&
          param.notice !== '[]' &&
          param.notice !== '-'
            ? safeParse(param.notice)
            : [];
        const packageData = new SubscriptionTiffinPackage({
          name: param && param.name && param.name !== null && param.name !== '' ? param.name : 'NA',
          shortDescription:
            param &&
            param.shortDescription &&
            param.shortDescription !== null &&
            param.shortDescription !== ''
              ? param.shortDescription
              : 'NA',
          image:
            param && param.image && param.image !== null && param.image !== '' ? param.image : 'NA',
          restaurant: restaurantId,
          foods:
            param && param.foods && param.foods !== null && param.foods !== ''
              ? param.foods.split(',')
              : [],
          interval: param.interval,
          offDays:
            param &&
            param.offDays &&
            param.offDays !== null &&
            param.offDays !== '' &&
            param.offDays !== '-'
              ? param.offDays.split(',')
              : [],
          totalOrder:
            param && param.totalOrder && param.totalOrder !== null && param.totalOrder !== ''
              ? param.totalOrder
              : 0,
          orderTo: param.orderTo,
          deliveryArea:
            param && param.deliveryArea && param.deliveryArea !== null && param.deliveryArea !== ''
              ? param.deliveryArea
              : 0,
          available: param.available,
          timeSlots: timeSlotsArray,
          canSelectAddon:
            param && (param.canSelectAddon === 'yes' || param.canSelectAddon === 'Yes'),
          canSelectVariation:
            param && (param.canSelectVariation === 'yes' || param.canSelectVariation === 'Yes'),
          price:
            param && param.price && param.price !== null && param.price !== '' ? param.price : 0,
          discountType:
            param &&
            param.discountType &&
            param.discountType !== null &&
            param.discountType !== '' &&
            param.discountType === '%'
              ? '%'
              : '$',
          discount:
            param && param.discount && param.discount !== null && param.discount !== ''
              ? param.discount
              : 0,
          notice: noticeArray,
          translations: [],
          status:
            param && param.status && param.status !== null && param.status !== ''
              ? param.status
              : 'hold',
        });
        await SubscriptionTiffinPackage.create(packageData);
      }
    });
  }
  return { success: true };
};

module.exports = {
  createPackage,
  updatePackage,
  getById,
  getSubscriptionPackageListVendor,
  getSubscriptionPackageListAdmin,
  updatePackageStatus,
  deletePackage,
  getSubscriptionPackageDetailCustomer,
  buySubscriptionDetails,
  getSubscriptionPackageFromVendor,
  purchaseSubscriptionDetail,
  vendorTiffinPackageList,
  cityzenPackageList,
  exportCollection,
  exportRawCollection,
  importCollection,
};

