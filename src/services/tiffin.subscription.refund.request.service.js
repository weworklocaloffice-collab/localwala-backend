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
const Stripe = require('stripe');
const { status: httpStatus } = require('http-status');
const superagent = require('superagent');
const {
  TiffinSubscriptionRefundRequest,
  UserPurchasedTiffinSubscription,
  User,
  Wallet,
  Transactions,
  PaymentInitiation,
} = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const saveRefundRequest = async (param) => {
  const checkExist = await TiffinSubscriptionRefundRequest.findOne({
    purchaseSubscription: param.purchaseId,
  });
  if (checkExist) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already requested');
  }
  const refundData = new TiffinSubscriptionRefundRequest({
    user: param.user,
    purchaseSubscription: param.purchaseId,
    refundReason: param.reason,
    subscriptionPackage: param.subscriptionPackage,
    restaurant: param.restaurant,
    payment: param.payment,
  });
  const refundInfo = await TiffinSubscriptionRefundRequest.create(refundData);
  return { id: refundInfo.id };
};

const getActiveRefundRequest = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const orderMatch = {
    $or: [
      { 'users.firstName': searchRegExp },
      { 'users.lastName': searchRegExp },
      { 'restaurants.name': searchRegExp },
      { 'subscriptiontiffinpackages.name': searchRegExp },
      { 'restaurants.slug': searchRegExp },
      {
        'restaurants.translations': {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
      {
        'subscriptiontiffinpackages.translations': {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
    ].filter(Boolean),
    $and: [options.status !== 'all' ? { status: options.status } : { status: { $ne: 'all' } }],
  };

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
        from: 'restaurants',
        localField: 'restaurant',
        foreignField: '_id',
        as: 'restaurants',
      },
    },
    {
      $lookup: {
        from: 'tiffinsubscriptionrefundrequestreasons',
        localField: 'refundReason',
        foreignField: '_id',
        as: 'tiffinsubscriptionrefundrequestreasons',
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
        path: '$restaurants',
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
        path: '$tiffinsubscriptionrefundrequestreasons',
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
      $match: orderMatch,
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        orders: 1,
        refundTo: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
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
        packageInfo: {
          id: { $ifNull: ['$subscriptiontiffinpackages._id', ''] },
          name: { $ifNull: ['$subscriptiontiffinpackages.name', ''] },
          orderTo: { $ifNull: ['$subscriptiontiffinpackages.orderTo', ''] },
          available: { $ifNull: ['$subscriptiontiffinpackages.available', ''] },
          translations: { $ifNull: ['$subscriptiontiffinpackages.translations', []] },
        },
        reason: {
          id: { $ifNull: ['$tiffinsubscriptionrefundrequestreasons._id', ''] },
          name: { $ifNull: ['$tiffinsubscriptionrefundrequestreasons.name', ''] },
          translations: { $ifNull: ['$tiffinsubscriptionrefundrequestreasons.translations', []] },
        },
        createdAt: 1,
      },
    },
  ];

  const request = await TiffinSubscriptionRefundRequest.aggregate(orderQuery);
  const countResult = await TiffinSubscriptionRefundRequest.aggregate([
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
      $match: orderMatch,
    },
    { $count: 'totalCount' },
  ]);
  return Promise.all([request, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      request,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityzenRefundRequest = async (masterId, options) => {
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
      { 'users.firstName': searchRegExp },
      { 'users.lastName': searchRegExp },
      { 'restaurants.name': searchRegExp },
      { 'subscriptiontiffinpackages.name': searchRegExp },
      { 'restaurants.slug': searchRegExp },
      {
        'restaurants.translations': {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
      {
        'subscriptiontiffinpackages.translations': {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
    ].filter(Boolean),
    $and: [
      options.status !== 'all' ? { status: options.status } : { status: { $ne: 'all' } },
      { 'restaurants.city': new mongoose.Types.ObjectId(city) },
    ],
  };

  const orderQuery = [
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
        from: 'tiffinsubscriptionrefundrequestreasons',
        localField: 'refundReason',
        foreignField: '_id',
        as: 'tiffinsubscriptionrefundrequestreasons',
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
        path: '$restaurants',
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
        path: '$tiffinsubscriptionrefundrequestreasons',
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
      $match: orderMatch,
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        orders: 1,
        refundTo: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
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
        packageInfo: {
          id: { $ifNull: ['$subscriptiontiffinpackages._id', ''] },
          name: { $ifNull: ['$subscriptiontiffinpackages.name', ''] },
          orderTo: { $ifNull: ['$subscriptiontiffinpackages.orderTo', ''] },
          available: { $ifNull: ['$subscriptiontiffinpackages.available', ''] },
          translations: { $ifNull: ['$subscriptiontiffinpackages.translations', []] },
        },
        reason: {
          id: { $ifNull: ['$tiffinsubscriptionrefundrequestreasons._id', ''] },
          name: { $ifNull: ['$tiffinsubscriptionrefundrequestreasons.name', ''] },
          translations: { $ifNull: ['$tiffinsubscriptionrefundrequestreasons.translations', []] },
        },
        createdAt: 1,
      },
    },
  ];

  const request = await TiffinSubscriptionRefundRequest.aggregate(orderQuery);
  const countResult = await TiffinSubscriptionRefundRequest.aggregate([
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
      $match: orderMatch,
    },
    { $count: 'totalCount' },
  ]);
  return Promise.all([request, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      request,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getTiffinSubscriptionRefundRequestInfo = async (requestId) => {
  const orderQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(requestId) } },
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
      $lookup: {
        from: 'tiffinsubscriptionrefundrequestreasons',
        localField: 'refundReason',
        foreignField: '_id',
        as: 'tiffinsubscriptionrefundrequestreasons',
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
        path: '$restaurants',
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
        path: '$subscriptiontiffinpackages',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$tiffinsubscriptionrefundrequestreasons',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        purchaseSubscription: 1,
        refundTo: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        package: {
          id: { $ifNull: ['$subscriptiontiffinpackages._id', ''] },
          name: { $ifNull: ['$subscriptiontiffinpackages.name', ''] },
          shortDescription: { $ifNull: ['$subscriptiontiffinpackages.shortDescription', ''] },
          image: { $ifNull: ['$subscriptiontiffinpackages.image', ''] },
          translations: { $ifNull: ['$subscriptiontiffinpackages.translations', []] },
        },
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          slug: { $ifNull: ['$restaurants.slug', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          userId: { $ifNull: ['$restaurants.userId', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          slug: { $ifNull: ['$paymentconfigs.slug', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        reason: {
          id: { $ifNull: ['$tiffinsubscriptionrefundrequestreasons._id', ''] },
          name: { $ifNull: ['$tiffinsubscriptionrefundrequestreasons.name', ''] },
          translations: { $ifNull: ['$tiffinsubscriptionrefundrequestreasons.translations', []] },
        },
        createdAt: 1,
      },
    },
  ];

  const request = await TiffinSubscriptionRefundRequest.aggregate(orderQuery);
  if (request !== null && request.length > 0) {
    const info = request[0];
    const orderDetailQuery = [
      { $match: { _id: new mongoose.Types.ObjectId(info.purchaseSubscription) } },
      { $limit: 1 },
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
          status: 1,
          deliveryAddressRaw: {
            $function: {
              body: function (jsonString) {
                return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
              },
              args: ['$deliveryAddressRaw'],
              lang: 'js',
            },
          },
          cartItem: {
            $function: {
              body: function (jsonString) {
                return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
              },
              args: ['$cartItemRaw'],
              lang: 'js',
            },
          },
          receiverName: 1,
          countryCode: 1,
          receiverContact: 1,
          user: 1,
          cookingInstruction: 1,
          createdAt: 1,
          orderTo: 1,
          orderAt: 1,
          ordersDates: 1,
          totalOrder: 1,
          slot: 1,
          startDate: 1,
          offDays: 1,
          requestedOffDates: 1,
          grandTotal: {
            $round: [{ $divide: ['$grandTotal', 100] }, 2],
          },
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
          deliveryInstructionInfo: {
            id: { $ifNull: ['$deliveryinstructions._id', ''] },
            name: { $ifNull: ['$deliveryinstructions.name', ''] },
            image: { $ifNull: ['$deliveryinstructions.image', ''] },
            translations: { $ifNull: ['$deliveryinstructions.translations', []] },
          },
        },
      },
    ];
    const orders = await UserPurchasedTiffinSubscription.aggregate(orderDetailQuery);
    if (orders !== null && orders.length > 0) {
      const orderInfo = orders[0];
      let restUserInfo = null;
      if (info !== null && info.restaurant !== null && info.restaurant.userId !== null) {
        restUserInfo = await User.findById(info.restaurant.userId, {
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
      return Promise.all([info, orderInfo, restUserInfo]).then(() => {
        const result = {
          info,
          orderInfo,
          restUserInfo,
          success: true,
        };
        return Promise.resolve(result);
      });
    }
    return { success: false };
  }
  return { success: false };
};

const cancelRefundRequest = async (requestId, reason) => {
  const requestInfo = await TiffinSubscriptionRefundRequest.findById(requestId);
  if (!requestInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateBody = {
    status: 'cancelled',
    cancelReason: reason,
  };
  Object.assign(requestInfo, updateBody);
  await requestInfo.save();
  return requestInfo;
};

const refundFromMerchant = async (requestId) => {
  const requestInfo = await TiffinSubscriptionRefundRequest.findById(requestId);
  if (!requestInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const orderInfo = await UserPurchasedTiffinSubscription.findById(
    requestInfo.purchaseSubscription
  );
  const updateOrderBody = {
    status: 'refunded',
  };
  Object.assign(orderInfo, updateOrderBody);
  await orderInfo.save();
  const updateBody = {
    status: 'refunded',
    amount: orderInfo.grandTotal,
    refundTo: 'inherit',
  };
  Object.assign(requestInfo, updateBody);
  await requestInfo.save();
  return orderInfo;
};

const approveRefundRequest = async (purchaseId, refundAmount, refundTo, refundType, requestId) => {
  const tiffinSubscriptionrequestInfo = await TiffinSubscriptionRefundRequest.findById(requestId);
  if (!tiffinSubscriptionrequestInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const purchaseInfo = await UserPurchasedTiffinSubscription.findById(purchaseId);
  if (!purchaseInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Purchase Not Found');
  }
  const addNewAmount =
    refundType === 'partial' ? parseFloat(refundAmount) : parseFloat(purchaseInfo.grandTotal);
  if (refundTo === 'wallet') {
    const walletInfo = await Wallet.findOne({
      holderId: new mongoose.Types.ObjectId(tiffinSubscriptionrequestInfo.user),
    });
    if (!walletInfo) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Wallet Not Found');
    }

    const oldBalance = walletInfo.balance;
    const userWalletId = walletInfo.id;
    const newBalance = parseFloat(oldBalance) + parseFloat(addNewAmount);
    Object.assign(walletInfo, { balance: newBalance });
    await walletInfo.save();
    const transactionBody = {
      payableId: tiffinSubscriptionrequestInfo.user,
      walletId: userWalletId,
      type: 'deposite',
      amount: addNewAmount,
      confirmed: true,
      meta: [{ reason: `refunded for tiffinsubcription #${purchaseId}` }],
      status: true,
    };
    await Transactions.create(transactionBody);
    const updateBody = {
      status: refundType === 'partially_refunded' ? '' : 'refunded',
      amount: addNewAmount,
      refundTo: 'wallet',
    };
    Object.assign(tiffinSubscriptionrequestInfo, updateBody);
    await tiffinSubscriptionrequestInfo.save();
    const updateOrderBody = {
      status: refundType === 'partially_refunded' ? '' : 'refunded',
    };
    Object.assign(purchaseInfo, updateOrderBody);
    await purchaseInfo.save();
    return purchaseInfo;
  }
  const payIntentQuery = [
    { $match: { tiffinSubscription: new mongoose.Types.ObjectId(purchaseId) } },
    { $limit: 1 },
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
        status: 1,
        payResponse: 1,
        paymentInfo: {
          slug: { $ifNull: ['$paymentconfigs.slug', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
          environment: { $ifNull: ['$paymentconfigs.environment', ''] },
          credentials: { $ifNull: ['$paymentconfigs.credentials', ''] },
        },
      },
    },
  ];
  const payResponse = await PaymentInitiation.aggregate(payIntentQuery);
  if (payResponse !== null && payResponse.length > 0) {
    const payDetails = payResponse[0];
    if (
      payDetails !== null &&
      payDetails.paymentInfo !== null &&
      payDetails.paymentInfo.slug !== null &&
      payDetails.paymentInfo.slug !== '' &&
      payDetails.paymentInfo.slug
    ) {
      const payData = payDetails.paymentInfo;
      if (payData !== null && payData.slug && payData.slug === 'stripe') {
        if (
          payData !== null &&
          payData.credentials !== null &&
          payData.credentials.secret &&
          payData.credentials.secret !== null
        ) {
          if (
            payDetails.payResponse &&
            payDetails.payResponse.payment_intent &&
            payDetails.payResponse.payment_intent !== null &&
            payDetails.payResponse.payment_intent !== ''
          ) {
            const stripePay = new Stripe(payData.credentials.secret);
            const refundDetails = await stripePay.refunds.create({
              payment_intent: payDetails.payResponse.payment_intent,
              amount: parseFloat(addNewAmount) * 100,
            });
            if (refundDetails !== null && refundDetails.id && refundDetails.id !== null) {
              const updateBody = {
                status: refundType === 'partial' ? 'partially_refunded' : 'refunded',
                amount: addNewAmount,
                refundTo: 'inherit',
                payResponse: refundDetails,
              };
              Object.assign(tiffinSubscriptionrequestInfo, updateBody);
              await tiffinSubscriptionrequestInfo.save();
              const updateOrderBody = {
                status: refundType === 'partial' ? 'partially_refunded' : 'refunded',
              };
              Object.assign(purchaseInfo, updateOrderBody);
              await purchaseInfo.save();
              return purchaseInfo;
            }
            return { success: false };
          }
          return { success: false };
        }
        return { success: false };
      }
      if (payData !== null && payData.slug && payData.slug === 'razorpay') {
        if (
          payData !== null &&
          payData.credentials &&
          payData.credentials !== null &&
          payData.credentials.secret !== null
        ) {
          if (
            payDetails.payResponse &&
            payDetails.payResponse.id &&
            payDetails.payResponse.id !== null &&
            payDetails.payResponse.id !== ''
          ) {
            const refundDetails = await superagent
              .post(`https://api.razorpay.com/v1/payments/${payDetails.payResponse.id}/refund`)
              .auth(payData.credentials.key, payData.credentials.secret)
              .send({ amount: parseFloat(addNewAmount) * 100 });
            if (refundDetails !== null && refundDetails.id && refundDetails.id !== null) {
              const updateBody = {
                status: refundType === 'partial' ? 'partially_refunded' : 'refunded',
                amount: addNewAmount,
                refundTo: 'inherit',
                payResponse: refundDetails,
              };
              Object.assign(tiffinSubscriptionrequestInfo, updateBody);
              await tiffinSubscriptionrequestInfo.save();
              const updateOrderBody = {
                status: refundType === 'partial' ? 'partially_refunded' : 'refunded',
              };
              Object.assign(purchaseInfo, updateOrderBody);
              await purchaseInfo.save();
              return purchaseInfo;
            }
            return { success: false };
          }
          return { success: false };
        }
        return { success: false };
      }
      if (payData !== null && payData.slug && payData.slug === 'paytm') {
        return payData;
      }
      if (payData !== null && payData.slug && payData.slug === 'paystack') {
        if (
          payData !== null &&
          payData.credentials !== null &&
          payData.credentials.sk &&
          payData.credentials.sk !== null
        ) {
          if (
            payDetails.payResponse &&
            payDetails.payResponse.data &&
            payDetails.payResponse.data !== null &&
            payDetails.payResponse.data.reference &&
            payDetails.payResponse.data.reference !== null &&
            payDetails.payResponse.data.reference !== ''
          ) {
            const paystackParam = {
              transaction: payDetails.payResponse.data.reference,
              amount: parseFloat(addNewAmount) * 100,
            };
            const refundDetails = await superagent
              .post('https://api.paystack.co/refund')
              .set('Authorization', `Bearer ${payData.credentials.sk}`)
              .send(paystackParam);
            if (
              refundDetails &&
              refundDetails !== null &&
              refundDetails.body &&
              refundDetails.body !== null &&
              refundDetails.body.status === true
            ) {
              const updateBody = {
                status: refundType === 'partial' ? 'partially_refunded' : 'refunded',
                amount: addNewAmount,
                refundTo: 'inherit',
                payResponse: refundDetails.body,
              };
              Object.assign(tiffinSubscriptionrequestInfo, updateBody);
              await tiffinSubscriptionrequestInfo.save();
              const updateOrderBody = {
                status: refundType === 'partial' ? 'partially_refunded' : 'refunded',
              };
              Object.assign(purchaseInfo, updateOrderBody);
              await purchaseInfo.save();
              return purchaseInfo;
            }
            return { success: false };
          }
          return { success: false };
        }
        return { success: false };
      }
      if (payData !== null && payData.slug && payData.slug === 'paypal') {
        if (
          payData !== null &&
          payData.credentials &&
          payData.credentials !== null &&
          payData.credentials.secret !== null
        ) {
          if (
            payDetails.payResponse &&
            payDetails.payResponse.id &&
            payDetails.payResponse.id !== null &&
            payDetails.payResponse.id !== ''
          ) {
            const captureId = payDetails.payResponse.purchase_units[0].payments.captures[0].id;
            if (captureId && captureId !== null && captureId !== '') {
              const paypalDetail = await superagent
                .post(
                  payData.environment === false
                    ? `https://api-m.sandbox.paypal.com/v1/oauth2/token`
                    : `https://api-m.paypal.com/v1/oauth2/token`
                )
                .auth(payData.credentials.id, payData.credentials.secret)
                .set('Content-Type', 'application/x-www-form-urlencoded')
                .send({ grant_type: 'client_credentials' });
              if (
                paypalDetail &&
                paypalDetail !== null &&
                paypalDetail.status === 200 &&
                paypalDetail.text !== ''
              ) {
                const payPaylAuth = JSON.parse(paypalDetail.text);
                if (
                  payPaylAuth !== null &&
                  payPaylAuth.access_token &&
                  payPaylAuth.access_token !== ''
                ) {
                  const paypalRefundParam = {
                    amount: {
                      value: addNewAmount,
                      currency_code: 'USD',
                    },
                  };
                  const refundDetails = await superagent
                    .post(
                      payData.environment === false
                        ? `https://api-m.sandbox.paypal.com/v2/payments/captures/${captureId}/refund`
                        : `https://api-m.paypal.com/v2/payments/captures/${captureId}/refund`
                    )
                    .set('Authorization', `Bearer ${payPaylAuth.access_token}`)
                    .set('Content-Type', 'application/json')
                    .send(paypalRefundParam);
                  if (
                    refundDetails &&
                    refundDetails !== null &&
                    refundDetails.status === 201 &&
                    refundDetails.text &&
                    refundDetails.text !== ''
                  ) {
                    const refundResponse = JSON.parse(refundDetails.text);
                    if (
                      refundResponse !== null &&
                      refundResponse.id &&
                      refundResponse.id !== null
                    ) {
                      const updateBody = {
                        status: refundType === 'partial' ? 'partially_refunded' : 'refunded',
                        amount: addNewAmount,
                        refundTo: 'inherit',
                        payResponse: refundResponse,
                      };
                      Object.assign(tiffinSubscriptionrequestInfo, updateBody);
                      await tiffinSubscriptionrequestInfo.save();
                      const updateOrderBody = {
                        status: refundType === 'partial' ? 'partially_refunded' : 'refunded',
                      };
                      Object.assign(purchaseInfo, updateOrderBody);
                      await purchaseInfo.save();
                      return purchaseInfo;
                    }
                  }
                  return { success: false };
                }
                return { success: false };
              }
              return { success: false };
            }
            return { success: false };
          }
          return { success: false };
        }
        return { success: false };
      }
      if (payData !== null && payData.slug && payData.slug === 'instamojo') {
        if (
          payData !== null &&
          payData.credentials !== null &&
          payData.credentials.token &&
          payData.credentials.token !== null
        ) {
          if (
            payDetails.payResponse &&
            payDetails.payResponse.payment_request &&
            payDetails.payResponse.payment_request !== null &&
            payDetails.payResponse.payment_request.payment &&
            payDetails.payResponse.payment_request.payment !== null &&
            payDetails.payResponse.payment_request.payment.payment_id &&
            payDetails.payResponse.payment_request.payment.payment_id !== null &&
            payDetails.payResponse.payment_request.payment.payment_id !== ''
          ) {
            const paymentParam = {
              payment_id: payDetails.payResponse.payment_request.payment.payment_id,
              type: 'QFL',
              amount: addNewAmount,
              body: 'REFUND',
              purpose: 'REFUND',
            };
            const instamojoPaymentLink =
              payData.environment === false
                ? 'https://test.instamojo.com/api/1.1/payment-requests/'
                : 'https://www.instamojo.com/api/1.1/payment-requests/';
            const refundDetails = await superagent
              .post(instamojoPaymentLink)
              .set('X-Api-Key', payData.credentials.key)
              .set('X-Auth-Token', payData.credentials.token)
              .send(paymentParam);
            if (
              refundDetails &&
              refundDetails !== null &&
              refundDetails.body &&
              refundDetails.body !== null &&
              refundDetails.body.success &&
              refundDetails.body.success === true
            ) {
              const updateBody = {
                status: refundType === 'partial' ? 'partially_refunded' : 'refunded',
                amount: addNewAmount,
                refundTo: 'inherit',
                payResponse: refundDetails.body,
              };
              Object.assign(tiffinSubscriptionrequestInfo, updateBody);
              await tiffinSubscriptionrequestInfo.save();
              const updateOrderBody = {
                status: refundType === 'partial' ? 'partially_refunded' : 'refunded',
              };
              Object.assign(purchaseInfo, updateOrderBody);
              await purchaseInfo.save();
              return purchaseInfo;
            }
            return { success: false };
          }
          return { success: false };
        }
        return { success: false };
      }
      if (payData !== null && payData.slug && payData.slug === 'flutterwave') {
        if (
          payData !== null &&
          payData.credentials !== null &&
          payData.credentials.secret &&
          payData.credentials.secret !== null
        ) {
          if (
            payDetails.payResponse &&
            payDetails.payResponse.data &&
            payDetails.payResponse.data !== null &&
            payDetails.payResponse.data.id &&
            payDetails.payResponse.data.id !== null &&
            payDetails.payResponse.data.id !== ''
          ) {
            const flutterwaveParam = {
              amount: addNewAmount,
              comments: 'REFUND',
            };
            const refundDetails = await superagent
              .post(
                `https://api.flutterwave.com/v3/transactions/${payDetails.payResponse.data.id}/refund`
              )
              .set('Authorization', `Bearer ${payData.credentials.secret}`)
              .send(flutterwaveParam);
            if (
              refundDetails &&
              refundDetails !== null &&
              refundDetails.body &&
              refundDetails.body !== null &&
              refundDetails.body.status &&
              refundDetails.body.status === 'success'
            ) {
              const updateBody = {
                status: refundType === 'partial' ? 'partially_refunded' : 'refunded',
                amount: addNewAmount,
                refundTo: 'inherit',
                payResponse: refundDetails.body,
              };
              Object.assign(tiffinSubscriptionrequestInfo, updateBody);
              await tiffinSubscriptionrequestInfo.save();
              const updateOrderBody = {
                status: refundType === 'partial' ? 'partially_refunded' : 'refunded',
              };
              Object.assign(purchaseInfo, updateOrderBody);
              await purchaseInfo.save();
              return purchaseInfo;
            }
            return { success: false };
          }
          return { success: false };
        }
        return { success: false };
      }
      if (payData !== null && payData.slug && payData.slug === 'cashfree') {
        if (
          payData !== null &&
          payData.credentials !== null &&
          payData.credentials.appId &&
          payData.credentials.appId !== null
        ) {
          if (
            payDetails.payResponse &&
            payDetails.payResponse.order_id &&
            payDetails.payResponse.order_id !== null &&
            payDetails.payResponse.order_id !== ''
          ) {
            try {
              const link =
                payData.environment === true
                  ? `https://api.cashfree.com/pg/orders/${payDetails.payResponse.order_id}/refunds`
                  : `https://sandbox.cashfree.com/pg/orders/${payDetails.payResponse.order_id}/refunds`;
              const refundParam = {
                refund_amount: addNewAmount,
                refund_id: tiffinSubscriptionrequestInfo.id,
                refund_note: `Refund for tiffin pacakge #${tiffinSubscriptionrequestInfo.id}`,
                refund_speed: 'STANDARD',
              };
              const refundDetails = await superagent
                .post(link)
                .set('Content-Type', 'application/json')
                .set('x-api-version', payData.credentials.apiVersion)
                .set('x-client-id', payData.credentials.appId)
                .set('x-client-secret', payData.credentials.secretKey)
                .send(refundParam);
              if (
                refundDetails &&
                refundDetails !== null &&
                refundDetails.body &&
                refundDetails.body !== null
              ) {
                const updateBody = {
                  status: refundType === 'partial' ? 'partially_refunded' : 'refunded',
                  amount: addNewAmount,
                  refundTo: 'inherit',
                  payResponse: refundDetails.body,
                };
                Object.assign(tiffinSubscriptionrequestInfo, updateBody);
                await tiffinSubscriptionrequestInfo.save();
                const updateOrderBody = {
                  status: refundType === 'partial' ? 'partially_refunded' : 'refunded',
                };
                Object.assign(purchaseInfo, updateOrderBody);
                await purchaseInfo.save();
                return purchaseInfo;
              }
              return { success: false };
              // eslint-disable-next-line no-unused-vars
            } catch (error) {
              return { success: false };
            }
          }
          return { success: false };
        }
        return { success: false };
      }
      if (payData !== null && payData.slug && payData.slug === 'xendit') {
        if (
          payData !== null &&
          payData.credentials !== null &&
          payData.credentials.secretKey &&
          payData.credentials.secretKey !== null
        ) {
          if (
            payDetails.payResponse &&
            payDetails.payResponse.id &&
            payDetails.payResponse.id !== null &&
            payDetails.payResponse.id !== ''
          ) {
            try {
              const refundParam = {
                payment_request_id: payDetails.payResponse.id,
                reason: 'CANCELLATION',
                amount: Math.floor(addNewAmount),
                currency: payDetails.payResponse.currency,
              };
              const refundDetails = await superagent
                .post('https://api.xendit.co/refunds')
                .auth(payData.credentials.secretKey, '')
                .send(refundParam);
              if (
                refundDetails &&
                refundDetails !== null &&
                refundDetails.body &&
                refundDetails.body !== null
              ) {
                const updateBody = {
                  status: refundType === 'partial' ? 'partially_refunded' : 'refunded',
                  amount: addNewAmount,
                  refundTo: 'inherit',
                  payResponse: refundDetails.body,
                };
                Object.assign(tiffinSubscriptionrequestInfo, updateBody);
                await tiffinSubscriptionrequestInfo.save();
                const updateOrderBody = {
                  status: refundType === 'partial' ? 'partially_refunded' : 'refunded',
                };
                Object.assign(purchaseInfo, updateOrderBody);
                await purchaseInfo.save();
                return purchaseInfo;
              }
              return { success: false };
              // eslint-disable-next-line no-unused-vars
            } catch (error) {
              return { success: false };
            }
          }
          return { success: false };
        }
        return { success: false };
      }
      return { success: false };
    }
    return { success: false };
  }
  return { success: false };
};

const exportQueryCollection = async (statusName, search) => {
  const searchRegExp = RegExp(search, 'i');
  const orderMatch = {
    $or: [
      { 'users.firstName': searchRegExp },
      { 'users.lastName': searchRegExp },
      { 'restaurants.name': searchRegExp },
      { 'subscriptiontiffinpackages.name': searchRegExp },
      { 'restaurants.slug': searchRegExp },
      {
        'restaurants.translations': {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
      {
        'subscriptiontiffinpackages.translations': {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
    ].filter(Boolean),
    $and: [statusName !== 'all' ? { status: statusName } : { status: { $ne: 'all' } }],
  };
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
        from: 'restaurants',
        localField: 'restaurant',
        foreignField: '_id',
        as: 'restaurants',
      },
    },
    {
      $lookup: {
        from: 'tiffinsubscriptionrefundrequestreasons',
        localField: 'refundReason',
        foreignField: '_id',
        as: 'tiffinsubscriptionrefundrequestreasons',
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
        path: '$restaurants',
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
        path: '$tiffinsubscriptionrefundrequestreasons',
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
      $match: orderMatch,
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        orders: 1,
        refundTo: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
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
        packageInfo: {
          id: { $ifNull: ['$subscriptiontiffinpackages._id', ''] },
          name: { $ifNull: ['$subscriptiontiffinpackages.name', ''] },
        },
        reason: {
          id: { $ifNull: ['$tiffinsubscriptionrefundrequestreasons._id', ''] },
          name: { $ifNull: ['$tiffinsubscriptionrefundrequestreasons.name', ''] },
        },
        cancelReason: 1,
        purchaseSubscription: 1,
        createdAt: 1,
      },
    },
  ];

  const result = await TiffinSubscriptionRefundRequest.aggregate(query);
  return result;
};

const exportQueryRawCollection = async (statusName, search) => {
  const searchRegExp = RegExp(search, 'i');
  const orderMatch = {
    $or: [
      { 'users.firstName': searchRegExp },
      { 'users.lastName': searchRegExp },
      { 'restaurants.name': searchRegExp },
      { 'subscriptiontiffinpackages.name': searchRegExp },
      { 'restaurants.slug': searchRegExp },
      {
        'restaurants.translations': {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
      {
        'subscriptiontiffinpackages.translations': {
          $elemMatch: {
            title: { $regex: searchRegExp },
          },
        },
      },
    ].filter(Boolean),
    $and: [statusName !== 'all' ? { status: statusName } : { status: { $ne: 'all' } }],
  };
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
      $match: orderMatch,
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        users: 0,
        restaurants: 0,
        subscriptiontiffinpackages: 0,
      },
    },
  ];

  const result = await TiffinSubscriptionRefundRequest.aggregate(query);
  return result;
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
      const userId =
        param && param.user && param.user !== null && param.user !== '' ? param.user : null;
      const purchaseId =
        param &&
        param.purchaseSubscription &&
        param.purchaseSubscription !== null &&
        param.purchaseSubscription !== ''
          ? param.purchaseSubscription
          : null;
      const packageId =
        param &&
        param.subscriptionPackage &&
        param.subscriptionPackage !== null &&
        param.subscriptionPackage !== ''
          ? param.subscriptionPackage
          : null;
      const restaurantId =
        param && param.restaurant && param.restaurant !== null && param.restaurant !== ''
          ? param.restaurant
          : null;
      const paymentId =
        param && param.payment && param.payment !== null && param.payment !== ''
          ? param.payment
          : null;
      const reasonId =
        param && param.refundReason && param.refundReason !== null && param.refundReason !== ''
          ? param.refundReason
          : null;
      const statusArray = ['initiated', 'refunded', 'partially_refunded', 'cancelled'];
      const refundToArray = ['none', 'wallet', 'inherit'];
      const payResponseObj =
        param &&
        param.payResponse &&
        param.payResponse !== null &&
        param.payResponse !== '' &&
        param.payResponse !== '-'
          ? safeParse(param.payResponse)
          : {};
      if (
        userId !== null &&
        purchaseId !== null &&
        packageId !== null &&
        restaurantId !== null &&
        paymentId !== null &&
        reasonId !== null &&
        statusArray.includes(param.status) &&
        refundToArray.includes(param.refundTo)
      ) {
        const refundData = new TiffinSubscriptionRefundRequest({
          user: userId,
          purchaseSubscription: purchaseId,
          subscriptionPackage: packageId,
          refundReason: reasonId,
          restaurant: restaurantId,
          payment: paymentId,
          payResponse: payResponseObj,
          amount:
            param && param.amount && param.amount !== null && param.amount !== ''
              ? param.amount
              : 0,
          refundTo:
            param && param.refundTo && param.refundTo !== null && param.refundTo !== ''
              ? param.refundTo
              : 'none',
          cancelReason:
            param &&
            param.cancelReason &&
            param.cancelReason !== null &&
            param.cancelReason !== '' &&
            param.cancelReason !== '-'
              ? param.cancelReason
              : 'NA',
          status: param.status,
        });
        await TiffinSubscriptionRefundRequest.create(refundData);
      }
    });
  }
  return { success: true };
};

module.exports = {
  saveRefundRequest,
  getActiveRefundRequest,
  getTiffinSubscriptionRefundRequestInfo,
  cancelRefundRequest,
  refundFromMerchant,
  approveRefundRequest,
  cityzenRefundRequest,
  exportQueryCollection,
  exportQueryRawCollection,
  importCollection,
};

