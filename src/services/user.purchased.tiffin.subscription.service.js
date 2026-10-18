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
const { DateTime } = require('luxon');
const {
  SubscriptionTiffinPackage,
  UserPurchasedTiffinSubscription,
  BusinessSettings,
  RestaurantFoodLicense,
  User,
  RestaurantSettings,
  OrderSettings,
  PaymentConfig,
  Restaurant,
  InvoiceInstruction,
} = require('../models');
const ApiError = require('../utils/ApiError');
const config = require('../config/config');
const fcmNotificationService = require('./fcm.notification.service');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const saveTiffinSubscription = async (param) => {
  const subscriptionInfo = await SubscriptionTiffinPackage.findOne(
    {
      _id: new mongoose.Types.ObjectId(param.subscriptionPackage),
    },
    { restaurant: 1, orderTo: 1, totalOrder: 1, offDays: 1 }
  );
  if (!subscriptionInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const serverTimezone = await BusinessSettings.findOne({}, { timezone: 1 });
  let savedTimezone = '';
  if (
    serverTimezone !== null &&
    serverTimezone.timezone !== null &&
    checkArrayNotEmpty(serverTimezone.timezone.utc)
  ) {
    savedTimezone = serverTimezone.timezone.utc[0];
  } else {
    savedTimezone = config.timezone;
  }
  const purchaseData = new UserPurchasedTiffinSubscription({
    user: param && param.user && param.user !== null && param.user !== '' ? param.user : null,
    addons: param && param.addons && param.addons.length > 0 ? param.addons : [],
    foods: param && param.foods && param.foods.length > 0 ? param.foods : [],
    subscriptionPackage: param.subscriptionPackage,
    payment:
      param && param.payment && param.payment !== null && param.payment !== ''
        ? param.payment
        : null,
    restaurant: subscriptionInfo.restaurant,
    slot: param && param.slot && param.slot !== null && param.slot !== '' ? param.slot : null,
    orderAt:
      param && param.orderAt && param.orderAt !== null && param.orderAt !== ''
        ? param.orderAt
        : null,
    orderTo: subscriptionInfo.orderTo,
    totalOrder: subscriptionInfo.totalOrder,
    offDays: subscriptionInfo.offDays,
    cookingInstruction:
      param &&
      param.cookingInstruction &&
      param.cookingInstruction !== null &&
      param.cookingInstruction !== ''
        ? param.cookingInstruction
        : '',
    deliveryInstruction:
      param &&
      param.deliveryInstruction &&
      param.deliveryInstruction !== null &&
      param.deliveryInstruction !== ''
        ? param.deliveryInstruction
        : null,
    deliveryAddress:
      param &&
      param.deliveryAddress &&
      param.deliveryAddress !== null &&
      param.deliveryAddress !== ''
        ? param.deliveryAddress
        : null,
    deliveryAddressRaw:
      param &&
      param.deliveryAddressRaw &&
      param.deliveryAddressRaw != null &&
      param.deliveryAddressRaw !== ''
        ? param.deliveryAddressRaw
        : '',
    receiverName: param.receiverName,
    countryCode: param.countryCode,
    receiverContact: param.receiverContact,
    cartItemRaw: param.cartItemRaw,
    itemTotal:
      param && param.itemTotal && param.itemTotal !== null && param.itemTotal !== ''
        ? param.itemTotal
        : 0,
    foodServiceCharge:
      param &&
      param.foodServiceCharge &&
      param.foodServiceCharge !== null &&
      param.foodServiceCharge !== ''
        ? param.foodServiceCharge
        : 0,
    serviceCharge:
      param && param.serviceCharge && param.serviceCharge !== null && param.serviceCharge !== ''
        ? param.serviceCharge
        : 0,
    packageCharge:
      param && param.packageCharge && param.packageCharge !== null && param.packageCharge !== ''
        ? param.packageCharge
        : 0,
    packageChargeTax:
      param &&
      param.packageChargeTax &&
      param.packageChargeTax !== null &&
      param.packageChargeTax !== ''
        ? param.packageChargeTax
        : 0,
    extraCharge:
      param && param.extraCharge && param.extraCharge !== null && param.extraCharge !== ''
        ? param.extraCharge
        : 0,
    grandTotal:
      param && param.grandTotal && param.grandTotal !== null && param.grandTotal !== ''
        ? param.grandTotal
        : 0,
    ordersDates: [],
    requestedOffDates: [],
    startDate: DateTime.now().setZone(savedTimezone).plus({ days: 1 }).toJSDate(),
  });
  const purchaseInfo = await UserPurchasedTiffinSubscription.create(purchaseData);
  return purchaseInfo;
};

const getPurchaseInfoById = async (id) => {
  const purchasedInfo = await UserPurchasedTiffinSubscription.findById(id);
  return purchasedInfo;
};

const updateSubscriptionStatus = async (id, param) => {
  const purchasedInfo = await getPurchaseInfoById(id);
  if (purchasedInfo) {
    Object.assign(purchasedInfo, param);
    await purchasedInfo.save();
  }
};

const updateSubscriptionPayment = async (id, param) => {
  const purchasedInfo = await getPurchaseInfoById(id);
  if (purchasedInfo) {
    Object.assign(purchasedInfo, param);
    await purchasedInfo.save();
  }
};

const getMyPurchasedSubscription = async (userId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const orderQuery = [
    { $match: { user: new mongoose.Types.ObjectId(userId) } },
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
        from: 'subscriptiontiffinpackages',
        localField: 'subscriptionPackage',
        foreignField: '_id',
        as: 'subscriptiontiffinpackages',
      },
    },
    {
      $unwind: {
        path: '$subscriptiontiffinpackages',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        orderTo: 1,
        orderAt: 1,
        ordersDates: 1,
        totalOrder: 1,
        slot: 1,
        status: 1,
        package: {
          id: { $ifNull: ['$subscriptiontiffinpackages._id', ''] },
          name: { $ifNull: ['$subscriptiontiffinpackages.name', ''] },
          shortDescription: { $ifNull: ['$subscriptiontiffinpackages.shortDescription', ''] },
          image: { $ifNull: ['$subscriptiontiffinpackages.image', ''] },
          translations: { $ifNull: ['$subscriptiontiffinpackages.translations', []] },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          slug: { $ifNull: ['$restaurants.slug', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ];
  const purchased = await UserPurchasedTiffinSubscription.aggregate(orderQuery);
  const totalResults = await UserPurchasedTiffinSubscription.countDocuments({
    user: new mongoose.Types.ObjectId(userId),
  });
  return Promise.all([purchased, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      purchased,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getPurchasedSubscriptionInfo = async (userId, purchaseId) => {
  const orderQuery = [
    {
      $match: {
        user: new mongoose.Types.ObjectId(userId),
        _id: new mongoose.Types.ObjectId(purchaseId),
      },
    },
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
      $lookup: {
        from: 'subscriptiontiffinpackages',
        localField: 'subscriptionPackage',
        foreignField: '_id',
        as: 'subscriptiontiffinpackages',
      },
    },
    {
      $unwind: {
        path: '$subscriptiontiffinpackages',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'paymentconfigs',
        localField: 'payment',
        foreignField: '_id',
        as: 'paymentconfigs',
      },
    },
    {
      $unwind: {
        path: '$paymentconfigs',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'deliveryinstructions',
        localField: 'deliveryInstruction',
        foreignField: '_id',
        as: 'deliveryinstructions',
      },
    },
    {
      $unwind: {
        path: '$deliveryinstructions',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $addFields: {
        timeDifferenceOfOrderInMinutes: {
          $divide: [
            {
              $subtract: [new Date(), '$createdAt'],
            },
            60000, // for Minuites
            // 1000 * 60 * 60, // for Hours
          ],
        },
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        cartItem: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$cartItemRaw'],
            lang: 'js',
          },
        },
        deliveryAddress: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$deliveryAddressRaw'],
            lang: 'js',
          },
        },
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        cookingInstruction: 1,
        timeDifferenceOfOrderInMinutes: 1,
        itemTotal: {
          $round: [{ $divide: ['$itemTotal', 100] }, 2],
        },
        foodServiceCharge: {
          $round: [{ $divide: ['$foodServiceCharge', 100] }, 2],
        },
        serviceCharge: {
          $round: [{ $divide: ['$serviceCharge', 100] }, 2],
        },
        packageCharge: {
          $round: [{ $divide: ['$packageCharge', 100] }, 2],
        },
        packageChargeTax: {
          $round: [{ $divide: ['$packageChargeTax', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        orderTo: 1,
        orderAt: 1,
        ordersDates: 1,
        totalOrder: 1,
        slot: 1,
        status: 1,
        startDate: 1,
        offDays: 1,
        requestedOffDates: 1,
        package: {
          id: { $ifNull: ['$subscriptiontiffinpackages._id', ''] },
          name: { $ifNull: ['$subscriptiontiffinpackages.name', ''] },
          shortDescription: { $ifNull: ['$subscriptiontiffinpackages.shortDescription', ''] },
          image: { $ifNull: ['$subscriptiontiffinpackages.image', ''] },
          translations: { $ifNull: ['$subscriptiontiffinpackages.translations', []] },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          slug: { $ifNull: ['$restaurants.slug', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          location: { $ifNull: ['$restaurants.location', null] },
          userId: { $ifNull: ['$restaurants.userId', ''] },
          license: { $ifNull: ['$restaurants.license', ''] },
          licenseId: { $ifNull: ['$restaurants.licenseId', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          slug: { $ifNull: ['$paymentconfigs.slug', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        deliveryInstructionInfo: {
          id: { $ifNull: ['$deliveryinstructions._id', ''] },
          name: { $ifNull: ['$deliveryinstructions.name', ''] },
          image: { $ifNull: ['$deliveryinstructions.image', ''] },
          translations: { $ifNull: ['$deliveryinstructions.translations', []] },
        },
      },
    },
  ];
  const purchased = await UserPurchasedTiffinSubscription.aggregate(orderQuery);
  if (purchased !== null && purchased.length > 0) {
    const details = purchased[0];
    let restUserInfo = null;
    let restaurantLicense = null;
    const businessSettings = await BusinessSettings.findOne({}, { refundRequest: 1 });
    if (details !== null && details.restaurant !== null && details.restaurant.userId !== null) {
      restUserInfo = await User.findById(details.restaurant.userId, {
        firstName: 1,
        lastName: 1,
        mobile: 1,
        countryCode: 1,
        role: 1,
        image: 1,
      });
      if (
        restUserInfo !== null &&
        restUserInfo.firstName !== null &&
        restUserInfo.mobile !== null
      ) {
        const maskedNumber = `${restUserInfo.mobile.substring(0, 3)}XXXXXX${restUserInfo.mobile.substring(
          restUserInfo.mobile.length - 3
        )}`;
        restUserInfo.mobile = maskedNumber;
      }
    }

    if (details !== null && details.restaurant !== null && details.restaurant.license !== null) {
      restaurantLicense = await RestaurantFoodLicense.findById(details.restaurant.license, {
        image: 1,
        name: 1,
        website: 1,
        translations: 1,
      });
    }
    let payments = [];
    let primary = null;
    if (details !== null && details.status !== null && details.status === 'pending_payments') {
      payments = await PaymentConfig.find(
        { status: true, paymentWay: 'online' },
        { name: 1, slug: 1, image: 1, translations: 1, isDefault: 1 }
      );
      primary = await PaymentConfig.findOne(
        { isDefault: true, status: true, paymentWay: 'online' },
        { name: 1, slug: 1, image: 1, translations: 1, isDefault: 1 }
      );
    }
    const restaurantSettings = await RestaurantSettings.findOne(
      {},
      { canInitiateChat: 1, canInitiateCall: 1 }
    );
    const orderSettings = await OrderSettings.findOne(
      {},
      { userCanCancelTiffinSubscriptionPackage: 1 }
    );
    return Promise.all([
      purchased,
      businessSettings,
      restUserInfo,
      restaurantLicense,
      restaurantSettings,
      orderSettings,
      payments,
      primary,
    ]).then(() => {
      const result = {
        details,
        businessSettings,
        restUserInfo,
        restaurantLicense,
        restaurantSettings,
        orderSettings,
        payments,
        primary,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const getPurchaseListForVendor = async (vendorId, subscriptionId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const orderQuery = [
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendorId),
        subscriptionPackage: new mongoose.Types.ObjectId(subscriptionId),
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
        from: 'paymentconfigs',
        localField: 'payment',
        foreignField: '_id',
        as: 'paymentconfigs',
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
        path: '$paymentconfigs',
        preserveNullAndEmptyArrays: true,
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        orderTo: 1,
        orderAt: 1,
        ordersDates: 1,
        totalOrder: 1,
        startDate: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          slug: { $ifNull: ['$paymentconfigs.slug', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        status: 1,
      },
    },
  ];
  const results = await UserPurchasedTiffinSubscription.aggregate(orderQuery);
  const totalResults = await UserPurchasedTiffinSubscription.countDocuments({
    restaurant: new mongoose.Types.ObjectId(vendorId),
    subscriptionPackage: new mongoose.Types.ObjectId(subscriptionId),
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

const getPurchaseListForAdmin = async (subscriptionId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const orderQuery = [
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
        from: 'paymentconfigs',
        localField: 'payment',
        foreignField: '_id',
        as: 'paymentconfigs',
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
      $lookup: {
        from: 'subscriptiontiffinpackages',
        localField: 'subscriptionPackage',
        foreignField: '_id',
        as: 'subscriptiontiffinpackages',
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
        path: '$paymentconfigs',
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
      $unwind: {
        path: '$subscriptiontiffinpackages',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        $or: [{ 'users.firstName': searchRegExp }, { 'users.lastName': searchRegExp }],
        $and: [{ subscriptionPackage: new mongoose.Types.ObjectId(subscriptionId) }],
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        orderTo: 1,
        orderAt: 1,
        ordersDates: 1,
        totalOrder: 1,
        startDate: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        package: {
          id: { $ifNull: ['$subscriptiontiffinpackages._id', ''] },
          name: { $ifNull: ['$subscriptiontiffinpackages.name', ''] },
          translations: { $ifNull: ['$subscriptiontiffinpackages.translations', []] },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          slug: { $ifNull: ['$paymentconfigs.slug', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        status: 1,
      },
    },
  ];
  const results = await UserPurchasedTiffinSubscription.aggregate(orderQuery);
  const countResult = await UserPurchasedTiffinSubscription.aggregate([
    {
      $lookup: {
        from: 'users',
        localField: 'user',
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
      $match: {
        $or: [{ 'users.firstName': searchRegExp }, { 'users.lastName': searchRegExp }],
        $and: [{ subscriptionPackage: new mongoose.Types.ObjectId(subscriptionId) }],
      },
    },
    { $sort: { createdAt: -1 } },
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

const getPurchaseDetailAdmin = async (purchaseId) => {
  const orderQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(purchaseId) } },
    { $limit: 1 },
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
          {
            $addFields: {
              contactEmail: {
                $concat: [
                  { $substrCP: ['$email', 0, 2] },
                  'XXXXX@',
                  { $arrayElemAt: [{ $split: ['$email', '@'] }, 1] },
                ],
              },
            },
          },
        ],
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
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'subscriptiontiffinpackages',
        localField: 'subscriptionPackage',
        foreignField: '_id',
        as: 'subscriptiontiffinpackages',
      },
    },
    {
      $unwind: {
        path: '$subscriptiontiffinpackages',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'paymentconfigs',
        localField: 'payment',
        foreignField: '_id',
        as: 'paymentconfigs',
      },
    },
    {
      $unwind: {
        path: '$paymentconfigs',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'deliveryinstructions',
        localField: 'deliveryInstruction',
        foreignField: '_id',
        as: 'deliveryinstructions',
      },
    },
    {
      $unwind: {
        path: '$deliveryinstructions',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        cartItem: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$cartItemRaw'],
            lang: 'js',
          },
        },
        deliveryAddress: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$deliveryAddressRaw'],
            lang: 'js',
          },
        },
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        cookingInstruction: 1,
        itemTotal: {
          $round: [{ $divide: ['$itemTotal', 100] }, 2],
        },
        foodServiceCharge: {
          $round: [{ $divide: ['$foodServiceCharge', 100] }, 2],
        },
        serviceCharge: {
          $round: [{ $divide: ['$serviceCharge', 100] }, 2],
        },
        packageCharge: {
          $round: [{ $divide: ['$packageCharge', 100] }, 2],
        },
        packageChargeTax: {
          $round: [{ $divide: ['$packageChargeTax', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        orderTo: 1,
        orderAt: 1,
        ordersDates: 1,
        totalOrder: 1,
        slot: 1,
        status: 1,
        startDate: 1,
        offDays: 1,
        requestedOffDates: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        package: {
          id: { $ifNull: ['$subscriptiontiffinpackages._id', ''] },
          name: { $ifNull: ['$subscriptiontiffinpackages.name', ''] },
          shortDescription: { $ifNull: ['$subscriptiontiffinpackages.shortDescription', ''] },
          image: { $ifNull: ['$subscriptiontiffinpackages.image', ''] },
          translations: { $ifNull: ['$subscriptiontiffinpackages.translations', []] },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          slug: { $ifNull: ['$restaurants.slug', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          location: { $ifNull: ['$restaurants.location', null] },
          userId: { $ifNull: ['$restaurants.userId', ''] },
          license: { $ifNull: ['$restaurants.license', ''] },
          licenseId: { $ifNull: ['$restaurants.licenseId', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          slug: { $ifNull: ['$paymentconfigs.slug', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        deliveryInstructionInfo: {
          id: { $ifNull: ['$deliveryinstructions._id', ''] },
          name: { $ifNull: ['$deliveryinstructions.name', ''] },
          image: { $ifNull: ['$deliveryinstructions.image', ''] },
          translations: { $ifNull: ['$deliveryinstructions.translations', []] },
        },
      },
    },
  ];
  const purchased = await UserPurchasedTiffinSubscription.aggregate(orderQuery);
  if (purchased !== null && purchased.length > 0) {
    const details = purchased[0];
    let restUserInfo = null;
    if (details !== null && details.restaurant !== null && details.restaurant.userId !== null) {
      restUserInfo = await User.findById(details.restaurant.userId, {
        firstName: 1,
        lastName: 1,
        mobile: 1,
        countryCode: 1,
        role: 1,
        image: 1,
        email: 1,
      });
      if (
        restUserInfo !== null &&
        restUserInfo.firstName !== null &&
        restUserInfo.mobile !== null &&
        restUserInfo.mobile !== ''
      ) {
        const maskedNumber = `${restUserInfo.mobile.substring(0, 3)}XXXXXX${restUserInfo.mobile.substring(
          restUserInfo.mobile.length - 3
        )}`;
        restUserInfo.mobile = maskedNumber;
      }

      if (
        restUserInfo !== null &&
        restUserInfo.firstName !== null &&
        restUserInfo.email !== null &&
        restUserInfo.email !== ''
      ) {
        const [localPart, domainPart] = restUserInfo.email.split('@');
        const firstTwoChars = localPart.slice(0, 2);

        const maskedEmail = `${firstTwoChars}XXXXX@${domainPart}`;
        restUserInfo.email = maskedEmail;
      }
    }
    return Promise.all([purchased, restUserInfo]).then(() => {
      const result = {
        details,
        restUserInfo,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const getPurchaseDetailVendor = async (purchaseId) => {
  const orderQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(purchaseId) } },
    { $limit: 1 },
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
          {
            $addFields: {
              contactEmail: {
                $concat: [
                  { $substrCP: ['$email', 0, 2] },
                  'XXXXX@',
                  { $arrayElemAt: [{ $split: ['$email', '@'] }, 1] },
                ],
              },
            },
          },
        ],
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'subscriptiontiffinpackages',
        localField: 'subscriptionPackage',
        foreignField: '_id',
        as: 'subscriptiontiffinpackages',
      },
    },
    {
      $unwind: {
        path: '$subscriptiontiffinpackages',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'paymentconfigs',
        localField: 'payment',
        foreignField: '_id',
        as: 'paymentconfigs',
      },
    },
    {
      $unwind: {
        path: '$paymentconfigs',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'deliveryinstructions',
        localField: 'deliveryInstruction',
        foreignField: '_id',
        as: 'deliveryinstructions',
      },
    },
    {
      $unwind: {
        path: '$deliveryinstructions',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        cartItem: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$cartItemRaw'],
            lang: 'js',
          },
        },
        deliveryAddress: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$deliveryAddressRaw'],
            lang: 'js',
          },
        },
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        cookingInstruction: 1,
        itemTotal: {
          $round: [{ $divide: ['$itemTotal', 100] }, 2],
        },
        foodServiceCharge: {
          $round: [{ $divide: ['$foodServiceCharge', 100] }, 2],
        },
        serviceCharge: {
          $round: [{ $divide: ['$serviceCharge', 100] }, 2],
        },
        packageCharge: {
          $round: [{ $divide: ['$packageCharge', 100] }, 2],
        },
        packageChargeTax: {
          $round: [{ $divide: ['$packageChargeTax', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        orderTo: 1,
        orderAt: 1,
        ordersDates: 1,
        totalOrder: 1,
        slot: 1,
        status: 1,
        startDate: 1,
        offDays: 1,
        requestedOffDates: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        package: {
          id: { $ifNull: ['$subscriptiontiffinpackages._id', ''] },
          name: { $ifNull: ['$subscriptiontiffinpackages.name', ''] },
          shortDescription: { $ifNull: ['$subscriptiontiffinpackages.shortDescription', ''] },
          image: { $ifNull: ['$subscriptiontiffinpackages.image', ''] },
          translations: { $ifNull: ['$subscriptiontiffinpackages.translations', []] },
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          slug: { $ifNull: ['$paymentconfigs.slug', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        deliveryInstructionInfo: {
          id: { $ifNull: ['$deliveryinstructions._id', ''] },
          name: { $ifNull: ['$deliveryinstructions.name', ''] },
          image: { $ifNull: ['$deliveryinstructions.image', ''] },
          translations: { $ifNull: ['$deliveryinstructions.translations', []] },
        },
      },
    },
  ];
  const purchased = await UserPurchasedTiffinSubscription.aggregate(orderQuery);
  if (purchased !== null && purchased.length > 0) {
    const details = purchased[0];
    const settings = await RestaurantSettings.findOne(
      {},
      { canInitiateCall: 1, canInitiateChat: 1 }
    );
    return Promise.all([purchased, settings]).then(() => {
      const result = {
        details,
        settings,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const userCancelTiffinSubscription = async (userId, purchaseId, cancellationId) => {
  const purchasedInfo = await UserPurchasedTiffinSubscription.findOne({
    user: new mongoose.Types.ObjectId(userId),
    _id: new mongoose.Types.ObjectId(purchaseId),
  });
  if (!purchasedInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateBody = {
    subscriptionCancellation: cancellationId,
    cancellationBy: 'customer',
    status: 'cancelled',
  };
  Object.assign(purchasedInfo, updateBody);
  await purchasedInfo.save();
  await fcmNotificationService.userCancelledTiffinSubscriptionPackage(purchaseId);
  return { success: true };
};

const userRequestOffDayOnSubscription = async (purchaseId, offDayDate) => {
  const serverTimezone = await BusinessSettings.findOne({}, { timezone: 1 });
  let savedTimezone = '';
  if (
    serverTimezone !== null &&
    serverTimezone.timezone !== null &&
    checkArrayNotEmpty(serverTimezone.timezone.utc)
  ) {
    savedTimezone = serverTimezone.timezone.utc[0];
  } else {
    savedTimezone = config.timezone;
  }

  const dateToSave = DateTime.fromJSDate(offDayDate).setZone(savedTimezone).toJSDate();
  const result = await UserPurchasedTiffinSubscription.aggregate([
    {
      $project: {
        matchingDate: {
          $filter: {
            input: '$requestedOffDates',
            as: 'date',
            cond: {
              $and: [
                { $eq: [{ $year: '$$date' }, { $year: dateToSave }] },
                { $eq: [{ $month: '$$date' }, { $month: dateToSave }] },
                { $eq: [{ $dayOfMonth: '$$date' }, { $dayOfMonth: dateToSave }] },
              ],
            },
          },
        },
      },
    },
    {
      $match: {
        _id: new mongoose.Types.ObjectId(purchaseId),
      },
    },
    {
      $project: {
        exists: { $gt: [{ $size: '$matchingDate' }, 0] },
      },
    },
  ]);
  const checkDate = result.length > 0 ? result[0].exists : false;
  if (checkDate) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Already saved');
  }
  await UserPurchasedTiffinSubscription.updateOne(
    { _id: new mongoose.Types.ObjectId(purchaseId) },
    { $push: { requestedOffDates: dateToSave } }
  );
  return { success: true };
};

const customerPurchasedPackages = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const orderQuery = [
    { $match: { user: new mongoose.Types.ObjectId(options.user) } },
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
        from: 'subscriptiontiffinpackages',
        localField: 'subscriptionPackage',
        foreignField: '_id',
        as: 'subscriptiontiffinpackages',
      },
    },
    {
      $unwind: {
        path: '$subscriptiontiffinpackages',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        orderTo: 1,
        orderAt: 1,
        ordersDates: 1,
        totalOrder: 1,
        slot: 1,
        status: 1,
        package: {
          id: { $ifNull: ['$subscriptiontiffinpackages._id', ''] },
          name: { $ifNull: ['$subscriptiontiffinpackages.name', ''] },
          translations: { $ifNull: ['$subscriptiontiffinpackages.translations', []] },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ];
  const results = await UserPurchasedTiffinSubscription.aggregate(orderQuery);
  const totalResults = await UserPurchasedTiffinSubscription.countDocuments({
    user: new mongoose.Types.ObjectId(options.user),
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

const supportTeamPurchaseDetail = async (purchaseId) => {
  const orderQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(purchaseId) } },
    { $limit: 1 },
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
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'subscriptiontiffinpackages',
        localField: 'subscriptionPackage',
        foreignField: '_id',
        as: 'subscriptiontiffinpackages',
      },
    },
    {
      $unwind: {
        path: '$subscriptiontiffinpackages',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'paymentconfigs',
        localField: 'payment',
        foreignField: '_id',
        as: 'paymentconfigs',
      },
    },
    {
      $unwind: {
        path: '$paymentconfigs',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'deliveryinstructions',
        localField: 'deliveryInstruction',
        foreignField: '_id',
        as: 'deliveryinstructions',
      },
    },
    {
      $unwind: {
        path: '$deliveryinstructions',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        cartItem: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$cartItemRaw'],
            lang: 'js',
          },
        },
        deliveryAddress: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$deliveryAddressRaw'],
            lang: 'js',
          },
        },
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        cookingInstruction: 1,
        itemTotal: {
          $round: [{ $divide: ['$itemTotal', 100] }, 2],
        },
        foodServiceCharge: {
          $round: [{ $divide: ['$foodServiceCharge', 100] }, 2],
        },
        serviceCharge: {
          $round: [{ $divide: ['$serviceCharge', 100] }, 2],
        },
        packageCharge: {
          $round: [{ $divide: ['$packageCharge', 100] }, 2],
        },
        packageChargeTax: {
          $round: [{ $divide: ['$packageChargeTax', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        orderTo: 1,
        orderAt: 1,
        ordersDates: 1,
        totalOrder: 1,
        slot: 1,
        status: 1,
        startDate: 1,
        offDays: 1,
        requestedOffDates: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          mobile: { $ifNull: ['$users.mobile', ''] },
          email: { $ifNull: ['$users.email', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        package: {
          id: { $ifNull: ['$subscriptiontiffinpackages._id', ''] },
          name: { $ifNull: ['$subscriptiontiffinpackages.name', ''] },
          shortDescription: { $ifNull: ['$subscriptiontiffinpackages.shortDescription', ''] },
          image: { $ifNull: ['$subscriptiontiffinpackages.image', ''] },
          translations: { $ifNull: ['$subscriptiontiffinpackages.translations', []] },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          slug: { $ifNull: ['$restaurants.slug', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          location: { $ifNull: ['$restaurants.location', null] },
          userId: { $ifNull: ['$restaurants.userId', ''] },
          license: { $ifNull: ['$restaurants.license', ''] },
          licenseId: { $ifNull: ['$restaurants.licenseId', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          slug: { $ifNull: ['$paymentconfigs.slug', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        deliveryInstructionInfo: {
          id: { $ifNull: ['$deliveryinstructions._id', ''] },
          name: { $ifNull: ['$deliveryinstructions.name', ''] },
          image: { $ifNull: ['$deliveryinstructions.image', ''] },
          translations: { $ifNull: ['$deliveryinstructions.translations', []] },
        },
      },
    },
  ];
  const purchased = await UserPurchasedTiffinSubscription.aggregate(orderQuery);
  if (purchased !== null && purchased.length > 0) {
    const details = purchased[0];
    let restUserInfo = null;
    if (details !== null && details.restaurant !== null && details.restaurant.userId !== null) {
      restUserInfo = await User.findById(details.restaurant.userId, {
        firstName: 1,
        lastName: 1,
        mobile: 1,
        countryCode: 1,
        role: 1,
        image: 1,
        email: 1,
      });
    }
    return Promise.all([purchased, restUserInfo]).then(() => {
      const result = {
        details,
        restUserInfo,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const exportCollection = async (options) => {
  const searchRegExp = RegExp(options.search, 'i');
  const orderQuery = [
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
        from: 'paymentconfigs',
        localField: 'payment',
        foreignField: '_id',
        as: 'paymentconfigs',
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
      $lookup: {
        from: 'subscriptiontiffinpackages',
        localField: 'subscriptionPackage',
        foreignField: '_id',
        as: 'subscriptiontiffinpackages',
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
        path: '$paymentconfigs',
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
      $unwind: {
        path: '$subscriptiontiffinpackages',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        $or: [{ 'users.firstName': searchRegExp }, { 'users.lastName': searchRegExp }],
        $and: [{ subscriptionPackage: new mongoose.Types.ObjectId(options.id) }],
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        orderTo: 1,
        orderAt: 1,
        totalOrder: 1,
        startDate: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
        },
        package: {
          id: { $ifNull: ['$subscriptiontiffinpackages._id', ''] },
          name: { $ifNull: ['$subscriptiontiffinpackages.name', ''] },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
        },
        status: 1,
      },
    },
  ];
  const results = await UserPurchasedTiffinSubscription.aggregate(orderQuery);
  return results;
};

const exportRawCollection = async (options) => {
  const searchRegExp = RegExp(options.search, 'i');
  const orderQuery = [
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
        from: 'paymentconfigs',
        localField: 'payment',
        foreignField: '_id',
        as: 'paymentconfigs',
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
      $lookup: {
        from: 'subscriptiontiffinpackages',
        localField: 'subscriptionPackage',
        foreignField: '_id',
        as: 'subscriptiontiffinpackages',
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
        path: '$paymentconfigs',
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
      $unwind: {
        path: '$subscriptiontiffinpackages',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: {
        $or: [{ 'users.firstName': searchRegExp }, { 'users.lastName': searchRegExp }],
        $and: [{ subscriptionPackage: new mongoose.Types.ObjectId(options.id) }],
      },
    },
    {
      $project: {
        users: 0,
        subscriptiontiffinpackages: 0,
        restaurants: 0,
        paymentconfigs: 0,
      },
    },
  ];
  const results = await UserPurchasedTiffinSubscription.aggregate(orderQuery);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    const statusArray = [
      'created',
      'cancelled',
      'completed',
      'refunded',
      'partially_refunded',
      'pending_payments',
    ];
    const orderToArray = ['homedelivery', 'selfpickup'];
    importArray.forEach(async (param) => {
      const userId =
        param && param.user && param.user !== null && param.user !== '' ? param.user : null;
      const subscriptionPackageId =
        param &&
        param.subscriptionPackage &&
        param.subscriptionPackage !== null &&
        param.subscriptionPackage !== ''
          ? param.subscriptionPackage
          : null;
      const paymentId =
        param && param.payment && param.payment !== null && param.payment !== ''
          ? param.payment
          : null;
      const restaurantId =
        param && param.restaurant && param.restaurant !== null && param.restaurant !== ''
          ? param.restaurant
          : null;
      if (
        statusArray.includes(param.status) &&
        orderToArray.includes(param.orderTo) &&
        userId !== null &&
        subscriptionPackageId !== null &&
        paymentId !== null &&
        restaurantId !== null
      ) {
        const purchaseData = new UserPurchasedTiffinSubscription({
          user: userId,
          addons:
            param &&
            param.addons &&
            param.addons !== null &&
            param.addons !== '' &&
            param.addons !== '-'
              ? param.addons.split(',')
              : [],
          foods:
            param && param.foods && param.foods !== null && param.foods !== ''
              ? param.foods.split(',')
              : [],
          subscriptionPackage: subscriptionPackageId,
          payment: paymentId,
          restaurant: restaurantId,
          slot: param && param.slot && param.slot !== null && param.slot !== '' ? param.slot : null,
          orderAt:
            param && param.orderAt && param.orderAt !== null && param.orderAt !== ''
              ? param.orderAt
              : null,
          orderTo: param.orderTo,
          totalOrder:
            param && param.totalOrder && param.totalOrder !== null && param.totalOrder !== ''
              ? param.totalOrder
              : 0,
          offDays:
            param &&
            param.offDays &&
            param.offDays !== null &&
            param.offDays !== '' &&
            param.offDays !== '-'
              ? param.offDays.split(',')
              : [],
          cookingInstruction:
            param &&
            param.cookingInstruction &&
            param.cookingInstruction !== null &&
            param.cookingInstruction !== '' &&
            param.cookingInstruction !== '-'
              ? param.cookingInstruction
              : '',
          deliveryInstruction:
            param &&
            param.deliveryInstruction &&
            param.deliveryInstruction !== null &&
            param.deliveryInstruction !== '' &&
            param.deliveryInstruction !== '-'
              ? param.deliveryInstruction
              : null,
          deliveryAddress:
            param &&
            param.deliveryAddress &&
            param.deliveryAddress !== null &&
            param.deliveryAddress !== '' &&
            param.deliveryAddress !== '-'
              ? param.deliveryAddress
              : null,
          deliveryAddressRaw:
            param &&
            param.deliveryAddressRaw &&
            param.deliveryAddressRaw != null &&
            param.deliveryAddressRaw !== '' &&
            param.deliveryAddressRaw !== '-'
              ? param.deliveryAddressRaw
              : '',
          receiverName:
            param && param.receiverName && param.receiverName !== null && param.receiverName !== ''
              ? param.receiverName
              : 'NA',
          countryCode:
            param && param.countryCode && param.countryCode !== null && param.countryCode !== ''
              ? param.countryCode
              : 1,
          receiverContact:
            param &&
            param.receiverContact &&
            param.receiverContact !== null &&
            param.receiverContact !== ''
              ? param.receiverContact
              : 'NA',
          cartItemRaw:
            param && param.cartItemRaw && param.cartItemRaw !== null && param.cartItemRaw !== ''
              ? param.cartItemRaw
              : '[]',
          itemTotal:
            param && param.itemTotal && param.itemTotal !== null && param.itemTotal !== ''
              ? param.itemTotal
              : 0,
          foodServiceCharge:
            param &&
            param.foodServiceCharge &&
            param.foodServiceCharge !== null &&
            param.foodServiceCharge !== ''
              ? param.foodServiceCharge
              : 0,
          serviceCharge:
            param &&
            param.serviceCharge &&
            param.serviceCharge !== null &&
            param.serviceCharge !== ''
              ? param.serviceCharge
              : 0,
          packageCharge:
            param &&
            param.packageCharge &&
            param.packageCharge !== null &&
            param.packageCharge !== ''
              ? param.packageCharge
              : 0,
          packageChargeTax:
            param &&
            param.packageChargeTax &&
            param.packageChargeTax !== null &&
            param.packageChargeTax !== ''
              ? param.packageChargeTax
              : 0,
          extraCharge:
            param && param.extraCharge && param.extraCharge !== null && param.extraCharge !== ''
              ? param.extraCharge
              : 0,
          grandTotal:
            param && param.grandTotal && param.grandTotal !== null && param.grandTotal !== ''
              ? param.grandTotal
              : 0,
          startDate:
            param && param.startDate && param.startDate !== null && param.startDate !== ''
              ? param.startDate
              : '1997-07-15',
          ordersDates:
            param &&
            param.ordersDates &&
            param.ordersDates !== null &&
            param.ordersDates !== '' &&
            param.ordersDates !== '-'
              ? param.ordersDates.split(',')
              : [],
          requestedOffDates:
            param &&
            param.requestedOffDates &&
            param.requestedOffDates !== null &&
            param.requestedOffDates !== '' &&
            param.requestedOffDates !== '-'
              ? param.requestedOffDates.split(',')
              : [],
          subscriptionCancellation:
            param &&
            param.subscriptionCancellation &&
            param.subscriptionCancellation !== null &&
            param.subscriptionCancellation !== '' &&
            param.subscriptionCancellation !== '-'
              ? param.subscriptionCancellation
              : null,
          cancellationBy:
            param &&
            param.cancellationBy &&
            param.cancellationBy !== null &&
            param.cancellationBy !== '' &&
            param.cancellationBy !== '-'
              ? param.cancellationBy
              : 'none',
          status: param.status,
        });
        await UserPurchasedTiffinSubscription.create(purchaseData);
      }
    });
  }
  return { success: true };
};

const downloadSummary = async (purchaseId, userId) => {
  const purchaseQuery = [
    {
      $match: {
        user: new mongoose.Types.ObjectId(userId),
        _id: new mongoose.Types.ObjectId(purchaseId),
      },
    },
    { $limit: 1 },
    {
      $lookup: {
        from: 'subscriptiontiffinpackages',
        localField: 'subscriptionPackage',
        foreignField: '_id',
        as: 'subscriptiontiffinpackages',
      },
    },
    {
      $unwind: {
        path: '$subscriptiontiffinpackages',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        cartItem: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$cartItemRaw'],
            lang: 'js',
          },
        },
        deliveryAddress: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$deliveryAddressRaw'],
            lang: 'js',
          },
        },
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        itemTotal: {
          $round: [{ $divide: ['$itemTotal', 100] }, 2],
        },
        foodServiceCharge: {
          $round: [{ $divide: ['$foodServiceCharge', 100] }, 2],
        },
        serviceCharge: {
          $round: [{ $divide: ['$serviceCharge', 100] }, 2],
        },
        packageCharge: {
          $round: [{ $divide: ['$packageCharge', 100] }, 2],
        },
        packageChargeTax: {
          $round: [{ $divide: ['$packageChargeTax', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        restaurant: 1,
        orderTo: 1,
        orderAt: 1,
        totalOrder: 1,
        slot: 1,
        status: 1,
        startDate: 1,
        package: {
          id: { $ifNull: ['$subscriptiontiffinpackages._id', ''] },
          name: { $ifNull: ['$subscriptiontiffinpackages.name', ''] },
          shortDescription: { $ifNull: ['$subscriptiontiffinpackages.shortDescription', ''] },
          image: { $ifNull: ['$subscriptiontiffinpackages.image', ''] },
          available: { $ifNull: ['$subscriptiontiffinpackages.available', ''] },
          translations: { $ifNull: ['$subscriptiontiffinpackages.translations', []] },
        },
      },
    },
  ];
  const purchaseDetail = await UserPurchasedTiffinSubscription.aggregate(purchaseQuery);
  if (purchaseDetail !== null && purchaseDetail.length > 0 && checkArrayNotEmpty(purchaseDetail)) {
    const details = purchaseDetail[0];
    const businessSettings = await BusinessSettings.findOne(
      {},
      {
        companyName: 1,
        websiteUrl: 1,
        logo: 1,
        foodTaxName: 1,
        additionalServiceName: 1,
        foodLicense: 1,
        foodLicenseName: 1,
        currencySide: 1,
        currency: 1,
      }
    );
    const restaurantInfo = await Restaurant.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(details.restaurant) } },
      { $limit: 1 },
      {
        $lookup: {
          from: 'restaurantfoodlicenses',
          localField: 'license',
          foreignField: '_id',
          as: 'restaurantfoodlicenses',
          pipeline: [
            {
              $project: {
                _id: 0,
                id: '$_id',
                name: 1,
                image: 1,
                website: 1,
                translations: 1,
              },
            },
          ],
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
          translations: 1,
          address: 1,
          licenseId: 1,
          license: {
            id: { $ifNull: ['$restaurantfoodlicenses.id', ''] },
            name: { $ifNull: ['$restaurantfoodlicenses.name', ''] },
            translations: { $ifNull: ['$restaurantfoodlicenses.translations', []] },
          },
        },
      },
    ]);
    const instructions = await InvoiceInstruction.find(
      { status: true },
      { id: 1, name: 1, translations: 1 }
    );
    return Promise.all([purchaseDetail, businessSettings, restaurantInfo, instructions]).then(
      () => {
        const result = {
          details,
          businessSettings,
          restaurantDetail:
            restaurantInfo !== null && restaurantInfo.length > 0 ? restaurantInfo[0] : null,
          instructions,
          success: true,
        };
        return Promise.resolve(result);
      }
    );
  }
  return { success: false };
};

const downloadInvoice = async (purchaseId, userId) => {
  const purchaseQuery = [
    {
      $match: {
        user: new mongoose.Types.ObjectId(userId),
        _id: new mongoose.Types.ObjectId(purchaseId),
      },
    },
    { $limit: 1 },
    {
      $lookup: {
        from: 'subscriptiontiffinpackages',
        localField: 'subscriptionPackage',
        foreignField: '_id',
        as: 'subscriptiontiffinpackages',
      },
    },
    {
      $unwind: {
        path: '$subscriptiontiffinpackages',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'paymentconfigs',
        localField: 'payment',
        foreignField: '_id',
        as: 'paymentconfigs',
      },
    },
    {
      $unwind: {
        path: '$paymentconfigs',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        cartItem: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$cartItemRaw'],
            lang: 'js',
          },
        },
        deliveryAddress: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$deliveryAddressRaw'],
            lang: 'js',
          },
        },
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        itemTotal: {
          $round: [{ $divide: ['$itemTotal', 100] }, 2],
        },
        foodServiceCharge: {
          $round: [{ $divide: ['$foodServiceCharge', 100] }, 2],
        },
        serviceCharge: {
          $round: [{ $divide: ['$serviceCharge', 100] }, 2],
        },
        packageCharge: {
          $round: [{ $divide: ['$packageCharge', 100] }, 2],
        },
        packageChargeTax: {
          $round: [{ $divide: ['$packageChargeTax', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        restaurant: 1,
        orderTo: 1,
        orderAt: 1,
        totalOrder: 1,
        slot: 1,
        status: 1,
        startDate: 1,
        package: {
          id: { $ifNull: ['$subscriptiontiffinpackages._id', ''] },
          name: { $ifNull: ['$subscriptiontiffinpackages.name', ''] },
          shortDescription: { $ifNull: ['$subscriptiontiffinpackages.shortDescription', ''] },
          image: { $ifNull: ['$subscriptiontiffinpackages.image', ''] },
          available: { $ifNull: ['$subscriptiontiffinpackages.available', ''] },
          translations: { $ifNull: ['$subscriptiontiffinpackages.translations', []] },
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
        },
      },
    },
  ];
  const purchaseDetail = await UserPurchasedTiffinSubscription.aggregate(purchaseQuery);
  if (purchaseDetail !== null && purchaseDetail.length > 0 && checkArrayNotEmpty(purchaseDetail)) {
    const details = purchaseDetail[0];
    const businessSettings = await BusinessSettings.findOne(
      {},
      {
        companyName: 1,
        websiteUrl: 1,
        logo: 1,
        foodLicense: 1,
        foodLicenseName: 1,
        foodTaxName: 1,
        additionalServiceName: 1,
        currencySide: 1,
        currency: 1,
        complianceForm: 1,
      }
    );
    const restaurantInfo = await Restaurant.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(details.restaurant) } },
      { $limit: 1 },
      {
        $lookup: {
          from: 'restaurantfoodlicenses',
          localField: 'license',
          foreignField: '_id',
          as: 'restaurantfoodlicenses',
          pipeline: [
            {
              $project: {
                _id: 0,
                id: '$_id',
                name: 1,
                image: 1,
                website: 1,
                translations: 1,
              },
            },
          ],
        },
      },
      {
        $unwind: {
          path: '$restaurantfoodlicenses',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'owner',
        },
      },
      {
        $unwind: {
          path: '$owner',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id: 0,
          id: '$_id',
          name: 1,
          translations: 1,
          address: 1,
          licenseId: 1,
          license: {
            id: { $ifNull: ['$restaurantfoodlicenses.id', ''] },
            name: { $ifNull: ['$restaurantfoodlicenses.name', ''] },
            translations: { $ifNull: ['$restaurantfoodlicenses.translations', []] },
          },
          ownerInfo: {
            id: { $ifNull: ['$owner._id', ''] },
            firstName: { $ifNull: ['$owner.firstName', ''] },
            lastName: { $ifNull: ['$owner.lastName', ''] },
          },
        },
      },
    ]);
    return Promise.all([purchaseDetail, businessSettings, restaurantInfo]).then(() => {
      const result = {
        details,
        businessSettings,
        restaurantDetail:
          restaurantInfo !== null && restaurantInfo.length > 0 ? restaurantInfo[0] : null,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

module.exports = {
  saveTiffinSubscription,
  updateSubscriptionStatus,
  getMyPurchasedSubscription,
  getPurchasedSubscriptionInfo,
  updateSubscriptionPayment,
  getPurchaseListForVendor,
  getPurchaseListForAdmin,
  getPurchaseDetailAdmin,
  getPurchaseDetailVendor,
  userCancelTiffinSubscription,
  userRequestOffDayOnSubscription,
  customerPurchasedPackages,
  supportTeamPurchaseDetail,
  exportCollection,
  exportRawCollection,
  importCollection,
  downloadSummary,
  downloadInvoice,
};

