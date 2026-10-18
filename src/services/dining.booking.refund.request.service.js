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
const ApiError = require('../utils/ApiError');
const {
  DiningBookingRefundRequest,
  DiningBooking,
  User,
  Wallet,
  Transactions,
  PaymentInitiation,
} = require('../models');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const saveRefundRequest = async (param) => {
  const checkExist = await DiningBookingRefundRequest.findOne({ booking: param.booking });
  if (checkExist) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already requested');
  }
  const refundData = new DiningBookingRefundRequest({
    user: param.user,
    booking: param.booking,
    refundReason: param.reason,
    restaurant: param.restaurant,
    payment: param.payment,
  });
  const refundInfo = await DiningBookingRefundRequest.create(refundData);
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
      { 'restaurants.slug': searchRegExp },
      {
        'restaurants.translations': {
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
        from: 'diningbookingrefundrequestreasons',
        localField: 'refundReason',
        foreignField: '_id',
        as: 'diningbookingrefundrequestreasons',
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
        path: '$diningbookingrefundrequestreasons',
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
        reason: {
          id: { $ifNull: ['$diningbookingrefundrequestreasons._id', ''] },
          name: { $ifNull: ['$diningbookingrefundrequestreasons.name', ''] },
          translations: { $ifNull: ['$diningbookingrefundrequestreasons.translations', []] },
        },
        createdAt: 1,
      },
    },
  ];

  const request = await DiningBookingRefundRequest.aggregate(orderQuery);
  const countResult = await DiningBookingRefundRequest.aggregate([
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
      { 'restaurants.slug': searchRegExp },
      {
        'restaurants.translations': {
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
        from: 'diningbookingrefundrequestreasons',
        localField: 'refundReason',
        foreignField: '_id',
        as: 'diningbookingrefundrequestreasons',
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
    {
      $unwind: {
        path: '$diningbookingrefundrequestreasons',
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
        reason: {
          id: { $ifNull: ['$diningbookingrefundrequestreasons._id', ''] },
          name: { $ifNull: ['$diningbookingrefundrequestreasons.name', ''] },
          translations: { $ifNull: ['$diningbookingrefundrequestreasons.translations', []] },
        },
        createdAt: 1,
      },
    },
  ];

  const request = await DiningBookingRefundRequest.aggregate(orderQuery);
  const countResult = await DiningBookingRefundRequest.aggregate([
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

const getRefundRequestInfo = async (requestId) => {
  const bookingQuery = [
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
        from: 'diningbookingrefundrequestreasons',
        localField: 'refundReason',
        foreignField: '_id',
        as: 'diningbookingrefundrequestreasons',
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
        path: '$diningbookingrefundrequestreasons',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        booking: 1,
        refundTo: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
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
          id: { $ifNull: ['$diningbookingrefundrequestreasons._id', ''] },
          name: { $ifNull: ['$diningbookingrefundrequestreasons.name', ''] },
          translations: { $ifNull: ['$diningbookingrefundrequestreasons.translations', []] },
        },
        createdAt: 1,
      },
    },
  ];
  const request = await DiningBookingRefundRequest.aggregate(bookingQuery);
  if (request !== null && request.length > 0) {
    const info = request[0];
    const bookingDetailQuery = [
      { $match: { _id: new mongoose.Types.ObjectId(info.booking) } },
      { $limit: 1 },
      {
        $lookup: {
          from: 'diningcoupons',
          localField: 'coupon',
          foreignField: '_id',
          as: 'diningcoupons',
          pipeline: [
            {
              $project: {
                _id: 0,
                id: '$_id',
                name: 1,
                preBookingChargeRequired: 1,
                discountType: 1,
                minDiscount: {
                  $round: [{ $divide: ['$minDiscount', 100] }, 2],
                },
                maxDiscount: {
                  $round: [{ $divide: ['$maxDiscount', 100] }, 2],
                },
                preBookingChargeAmount: {
                  $round: [{ $divide: ['$preBookingChargeAmount', 100] }, 2],
                },
                translations: 1,
              },
            },
          ],
        },
      },
      {
        $unwind: {
          path: '$diningcoupons',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id: 0,
          id: '$_id',
          bookingDate: 1,
          bookingSlot: 1,
          guest: 1,
          userName: 1,
          userCountryCode: 1,
          userContact: 1,
          userEmail: 1,
          specialRequest: 1,
          status: 1,
          diningcoupons: 1,
          preBookingCharge: {
            $round: [{ $divide: ['$preBookingCharge', 100] }, 2],
          },
          couponCoverCharge: {
            $round: [{ $divide: ['$couponCoverCharge', 100] }, 2],
          },
          grandTotal: {
            $round: [{ $divide: ['$grandTotal', 100] }, 2],
          },
        },
      },
    ];
    const booking = await DiningBooking.aggregate(bookingDetailQuery);
    if (booking !== null && booking.length > 0) {
      const diningInfo = booking[0];
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
      return Promise.all([info, diningInfo, restUserInfo]).then(() => {
        const result = {
          info,
          diningInfo,
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
  const requestInfo = await DiningBookingRefundRequest.findById(requestId);
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
  const requestInfo = await DiningBookingRefundRequest.findById(requestId);
  if (!requestInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const bookingInfo = await DiningBooking.findById(requestInfo.booking);
  const updateBookingBody = {
    status: 'refunded',
  };
  Object.assign(bookingInfo, updateBookingBody);
  await bookingInfo.save();
  const updateBody = {
    status: 'refunded',
    amount: bookingInfo.grandTotal,
    refundTo: 'inherit',
  };
  Object.assign(requestInfo, updateBody);
  await requestInfo.save();
  return bookingInfo;
};

const approveRefundRequest = async (bookingId, refundAmount, refundTo, refundType, requestId) => {
  const requestInfo = await DiningBookingRefundRequest.findById(requestId);
  if (!requestInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const bookingInfo = await DiningBooking.findById(bookingId);
  if (!bookingInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const addNewAmount =
    refundType === 'partial' ? parseFloat(refundAmount) : parseFloat(bookingInfo.grandTotal);
  if (refundTo === 'wallet') {
    const walletInfo = await Wallet.findOne({
      holderId: new mongoose.Types.ObjectId(requestInfo.user),
    });
    if (!walletInfo) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
    }

    const oldBalance = walletInfo.balance;
    const userWalletId = walletInfo.id;
    const newBalance = parseFloat(oldBalance) + parseFloat(addNewAmount);
    Object.assign(walletInfo, { balance: newBalance });
    await walletInfo.save();
    const transactionBody = {
      payableId: requestInfo.user,
      walletId: userWalletId,
      type: 'deposite',
      amount: addNewAmount,
      confirmed: true,
      meta: [{ reason: `refunded for booking #${bookingId}` }],
      status: true,
    };
    await Transactions.create(transactionBody);
    const updateBody = {
      status: refundType === 'partially_refunded' ? '' : 'refunded',
      amount: addNewAmount,
      refundTo: 'wallet',
    };
    Object.assign(requestInfo, updateBody);
    await requestInfo.save();
    const updateBookingBody = {
      status: refundType === 'partially_refunded' ? '' : 'refunded',
    };
    Object.assign(bookingInfo, updateBookingBody);
    await bookingInfo.save();
    return bookingInfo;
  }
  if (bookingInfo.paymentMode === 'online') {
    const payIntentQuery = [
      { $match: { booking: new mongoose.Types.ObjectId(bookingId) } },
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
              bookingInfo &&
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
                Object.assign(requestInfo, updateBody);
                await requestInfo.save();
                const updateBookingBody = {
                  status: refundType === 'partial' ? 'partially_refunded' : 'refunded',
                };
                Object.assign(bookingInfo, updateBookingBody);
                await bookingInfo.save();
                return bookingInfo;
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
              bookingInfo &&
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
                Object.assign(requestInfo, updateBody);
                await requestInfo.save();
                const updateBookingBody = {
                  status: refundType === 'partial' ? 'partially_refunded' : 'refunded',
                };
                Object.assign(bookingInfo, updateBookingBody);
                await bookingInfo.save();
                return bookingInfo;
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
              bookingInfo &&
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
                Object.assign(requestInfo, updateBody);
                await requestInfo.save();
                const updateBookingBody = {
                  status: refundType === 'partial' ? 'partially_refunded' : 'refunded',
                };
                Object.assign(bookingInfo, updateBookingBody);
                await bookingInfo.save();
                return bookingInfo;
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
              bookingInfo &&
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
                        Object.assign(requestInfo, updateBody);
                        await requestInfo.save();
                        const updateBookingBody = {
                          status: refundType === 'partial' ? 'partially_refunded' : 'refunded',
                        };
                        Object.assign(bookingInfo, updateBookingBody);
                        await bookingInfo.save();
                        return bookingInfo;
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
              bookingInfo &&
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
                Object.assign(requestInfo, updateBody);
                await requestInfo.save();
                const updateBookingBody = {
                  status: refundType === 'partial' ? 'partially_refunded' : 'refunded',
                };
                Object.assign(bookingInfo, updateBookingBody);
                await bookingInfo.save();
                return bookingInfo;
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
              bookingInfo &&
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
                Object.assign(requestInfo, updateBody);
                await requestInfo.save();
                const updateBookingBody = {
                  status: refundType === 'partial' ? 'partially_refunded' : 'refunded',
                };
                Object.assign(bookingInfo, updateBookingBody);
                await bookingInfo.save();
                return bookingInfo;
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
                  refund_id: bookingInfo.id,
                  refund_note: `Refund for dining booking #${bookingInfo.id}`,
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
                  Object.assign(requestInfo, updateBody);
                  await requestInfo.save();
                  const updateBookingBody = {
                    status: refundType === 'partial' ? 'partially_refunded' : 'refunded',
                  };
                  Object.assign(bookingInfo, updateBookingBody);
                  await bookingInfo.save();
                  return bookingInfo;
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
                  Object.assign(requestInfo, updateBody);
                  await requestInfo.save();
                  const updateBookingBody = {
                    status: refundType === 'partial' ? 'partially_refunded' : 'refunded',
                  };
                  Object.assign(bookingInfo, updateBookingBody);
                  await bookingInfo.save();
                  return bookingInfo;
                }
                // eslint-disable-next-line no-unused-vars
              } catch (error) {
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
      { 'restaurants.slug': searchRegExp },
      {
        'restaurants.translations': {
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
        from: 'diningbookingrefundrequestreasons',
        localField: 'refundReason',
        foreignField: '_id',
        as: 'diningbookingrefundrequestreasons',
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
        path: '$diningbookingrefundrequestreasons',
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
        booking: 1,
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
        reason: {
          id: { $ifNull: ['$diningbookingrefundrequestreasons._id', ''] },
          name: { $ifNull: ['$diningbookingrefundrequestreasons.name', ''] },
        },
        createdAt: 1,
        cancelReason: 1,
      },
    },
  ];

  const results = await DiningBookingRefundRequest.aggregate(query);
  return results;
};

const exportQueryRawCollection = async (statusName, search) => {
  const searchRegExp = RegExp(search, 'i');
  const orderMatch = {
    $or: [
      { 'users.firstName': searchRegExp },
      { 'users.lastName': searchRegExp },
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
    $and: [statusName !== 'all' ? { status: statusName } : { status: { $ne: 'all' } }],
  };
  const results = await DiningBookingRefundRequest.aggregate([
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
      $match: orderMatch,
    },
    {
      $project: {
        restaurants: 0,
        users: 0,
      },
    },
  ]);
  return results;
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
      const bookingId =
        param && param.booking && param.booking !== null && param.booking !== ''
          ? param.booking
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
        bookingId !== null &&
        restaurantId !== null &&
        paymentId !== null &&
        reasonId !== null &&
        statusArray.includes(param.status) &&
        refundToArray.includes(param.refundTo)
      ) {
        const refundData = new DiningBookingRefundRequest({
          user: userId,
          booking: bookingId,
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
        await DiningBookingRefundRequest.create(refundData);
      }
    });
  }
  return { success: true };
};

module.exports = {
  saveRefundRequest,
  getActiveRefundRequest,
  getRefundRequestInfo,
  cancelRefundRequest,
  refundFromMerchant,
  approveRefundRequest,
  cityzenRefundRequest,
  exportQueryCollection,
  exportQueryRawCollection,
  importCollection,
};

