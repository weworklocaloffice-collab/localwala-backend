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
  DiningSetting,
  DiningCoupon,
  DiningBooking,
  RestaurantSettings,
  PaymentConfig,
  BusinessSettings,
  User,
  Restaurant,
  AdminExpense,
  RestaurantExpense,
} = require('../models');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createBooking = async (param) => {
  const restaurants = await Restaurant.findOne(
    { _id: new mongoose.Types.ObjectId(param.restaurant) },
    { tableOrderCommission: 1 }
  );
  let tableOrderAdminCommission = 0;
  if (
    restaurants !== null &&
    restaurants.type === 'derived' &&
    restaurants.isOutlet === true &&
    restaurants.outletManagerId !== null
  ) {
    const outletManager = await Restaurant.findById(
      { _id: new mongoose.Types.ObjectId(restaurants.outletManagerId) },
      { tableOrderCommission: 1 }
    );
    if (outletManager !== null && outletManager.id !== null) {
      tableOrderAdminCommission = outletManager.tableOrderCommission;
    }
  } else {
    tableOrderAdminCommission = restaurants.tableOrderCommission;
  }
  const dinnigSetting = await DiningSetting.findOne(
    {},
    { minBookingCharge: 1, preBookingChargeRequired: 1, guestBooking: 1 }
  );
  let preBookingChargeAmount = 0;
  let couponCoverChargeAmount = 0;
  if (
    dinnigSetting !== null &&
    dinnigSetting.preBookingChargeRequired !== null &&
    dinnigSetting.preBookingChargeRequired === true
  ) {
    const preBookingChargeString = String(dinnigSetting.minBookingCharge);
    preBookingChargeAmount = parseFloat(preBookingChargeString);
  }
  let coupon = null;
  const couponId = param.coupon;
  if (couponId != null && couponId !== '') {
    coupon = await DiningCoupon.findById(couponId, {
      preBookingChargeRequired: 1,
      preBookingChargeAmount: 1,
    });
  }
  if (
    coupon !== null &&
    coupon.preBookingChargeRequired !== null &&
    coupon.preBookingChargeRequired === true
  ) {
    const couponCoverChargeString = String(coupon.preBookingChargeAmount);
    couponCoverChargeAmount = parseFloat(couponCoverChargeString);
  }
  const grandTotalString = (preBookingChargeAmount + couponCoverChargeAmount).toFixed(2);
  const toPay = parseFloat(grandTotalString);
  let bookingCommission = 0;
  if (toPay > 0) {
    bookingCommission = parseFloat(
      (parseFloat(toPay) * parseFloat(tableOrderAdminCommission)) / 100
    ).toFixed(2);
  }
  const bookingData = new DiningBooking({
    user: param && param.user && param.user !== null && param.user !== '' ? param.user : null,
    payment:
      param && param.payment && param.payment !== null && param.payment !== ''
        ? param.payment
        : null,
    paymentMode:
      param && param.payment && param.payment !== null && param.payment !== ''
        ? 'online'
        : 'offline',
    restaurant:
      param && param.restaurant && param.restaurant !== null && param.restaurant !== ''
        ? param.restaurant
        : null,
    coupon:
      param && param.coupon && param.coupon !== null && param.coupon !== '' ? param.coupon : null,
    bookingDate:
      param && param.bookingDate && param.bookingDate !== null && param.bookingDate !== ''
        ? param.bookingDate
        : null,
    bookingSlot:
      param && param.bookingSlot && param.bookingSlot !== null && param.bookingSlot !== ''
        ? param.bookingSlot
        : null,
    guest: param && param.guest && param.guest !== null && param.guest !== '' ? param.guest : 1,
    userName:
      param && param.userName && param.userName !== null && param.userName !== ''
        ? param.userName
        : '',
    userCountryCode:
      param &&
      param.userCountryCode &&
      param.userCountryCode !== null &&
      param.userCountryCode !== ''
        ? param.userCountryCode
        : null,
    userContact:
      param && param.userContact && param.userContact !== null && param.userContact !== ''
        ? param.userContact
        : null,
    userEmail:
      param && param.userEmail && param.userEmail !== null && param.userEmail !== ''
        ? param.userEmail
        : null,
    specialRequest:
      param && param.specialRequest && param.specialRequest !== null && param.specialRequest !== ''
        ? param.specialRequest
        : null,
    preBookingCharge: preBookingChargeAmount,
    couponCoverCharge: couponCoverChargeAmount,
    grandTotal: toPay,
    bookingCommission: `${bookingCommission}`,
    status:
      param && param.payment && param.payment !== null && param.payment !== '' && toPay > 0
        ? 'pending_payments'
        : 'created',
    campaign:
      param && param.campaignId && param.campaignId !== null && param.campaignId !== ''
        ? param.campaignId
        : null,
  });
  const response = await DiningBooking.create(bookingData);
  return { id: response.id, total: toPay };
};

const getDiningBookingById = async (id) => {
  const diningInfo = await DiningBooking.findById(id);
  return diningInfo;
};

const updateDiningBookingStatus = async (id, param) => {
  const diningInfo = await getDiningBookingById(id);
  if (diningInfo) {
    Object.assign(diningInfo, param);
    await diningInfo.save();
  }
};

const getDiningBookingWithUserId = async (userId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const diningQuery = [
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
      $project: {
        _id: 0,
        id: '$_id',
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          slug: { $ifNull: ['$restaurants.slug', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        status: 1,
        bookingDate: 1,
        bookingSlot: 1,
        guest: 1,
        userName: 1,
        userCountryCode: 1,
        userContact: 1,
        userEmail: 1,
        createdAt: 1,
      },
    },
  ];
  const bookings = await DiningBooking.aggregate(diningQuery);
  const totalResults = await DiningBooking.countDocuments({
    user: new mongoose.Types.ObjectId(userId),
  });
  return Promise.all([bookings, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      bookings,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const searchDiningBooking = async (userId, query) => {
  const diningQuery = [
    {
      $match: {
        $and: [
          { user: new mongoose.Types.ObjectId(userId) },
          { $or: [{ userEmail: query }, { userContact: query }] },
        ],
      },
    },
    // { $match: { $or: [{ userEmail: query }, { userContact: query }] } },
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
      $project: {
        _id: 0,
        id: '$_id',
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          slug: { $ifNull: ['$restaurants.slug', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        status: 1,
        bookingDate: 1,
        bookingSlot: 1,
        guest: 1,
        userName: 1,
        userCountryCode: 1,
        userContact: 1,
        userEmail: 1,
        createdAt: 1,
      },
    },
  ];
  const bookings = await DiningBooking.aggregate(diningQuery);
  const totalResults = await DiningBooking.countDocuments({
    $and: [
      { user: new mongoose.Types.ObjectId(userId) },
      { $or: [{ userEmail: query }, { userContact: query }] },
    ],
  });
  return Promise.all([bookings, totalResults]).then(() => {
    const result = {
      bookings,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getUserDiningBookingInformation = async (userId, bookingId) => {
  const diningQuery = [
    {
      $match: {
        user: new mongoose.Types.ObjectId(userId),
        _id: new mongoose.Types.ObjectId(bookingId),
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
      $lookup: {
        from: 'paymentconfigs',
        localField: 'payment',
        foreignField: '_id',
        as: 'paymentconfigs',
      },
    },
    {
      $lookup: {
        from: 'paymentinitiations',
        localField: '_id',
        foreignField: 'booking',
        as: 'paymentinitiations',
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
        path: '$diningcoupons',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$paymentinitiations',
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
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          slug: { $ifNull: ['$restaurants.slug', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          location: { $ifNull: ['$restaurants.location', null] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          slug: { $ifNull: ['$paymentconfigs.slug', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        transaction: {
          id: { $ifNull: ['$paymentinitiations._id', ''] },
          status: { $ifNull: ['$paymentinitiations.status', ''] },
          createdAt: { $ifNull: ['$paymentinitiations.createdAt', ''] },
        },
        diningcoupons: {
          id: { $ifNull: ['$diningcoupons._id', ''] },
          name: { $ifNull: ['$diningcoupons.name', ''] },
          preBookingChargeRequired: { $ifNull: ['$diningcoupons.preBookingChargeRequired', false] },
          discountType: { $ifNull: ['$diningcoupons.discountType', ''] },
          minDiscount: {
            $round: [{ $divide: ['$diningcoupons.minDiscount', 100] }, 2],
          },
          maxDiscount: {
            $round: [{ $divide: ['$diningcoupons.maxDiscount', 100] }, 2],
          },
          preBookingChargeAmount: {
            $round: [{ $divide: ['$diningcoupons.preBookingChargeAmount', 100] }, 2],
          },
          translations: { $ifNull: ['$diningcoupons.translations', []] },
        },
        preBookingCharge: {
          $round: [{ $divide: ['$preBookingCharge', 100] }, 2],
        },
        couponCoverCharge: {
          $round: [{ $divide: ['$couponCoverCharge', 100] }, 2],
        },
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        status: 1,
        bookingDate: 1,
        bookingSlot: 1,
        guest: 1,
        userName: 1,
        userCountryCode: 1,
        userContact: 1,
        userEmail: 1,
        specialRequest: 1,
        timeDifferenceOfOrderInMinutes: 1,
        createdAt: 1,
      },
    },
  ];
  const info = await DiningBooking.aggregate(diningQuery);
  if (info !== null && info.length > 0) {
    const details = info[0];
    const restaurantSettings = await RestaurantSettings.findOne(
      {},
      { canInitiateChat: 1, canInitiateCall: 1 }
    );
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
    const businessSettings = await BusinessSettings.findOne({}, { refundRequest: 1 });
    return Promise.all([info, restaurantSettings, payments, primary, businessSettings]).then(() => {
      const result = {
        details,
        restaurantSettings,
        payments,
        primary,
        businessSettings,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const updateBookingPayment = async (id, param) => {
  const diningInfo = await getDiningBookingById(id);
  if (diningInfo) {
    Object.assign(diningInfo, param);
    await diningInfo.save();
  }
};

const getDiningBookingMetaNotification = async (id) => {
  const bookingInfo = await DiningBooking.findById(id, { user: 1, restaurant: 1, userName: 1 });
  return bookingInfo;
};

const cancelDiningBookingByUser = async (bookingId, reasonId) => {
  const bookingInfo = await DiningBooking.findById(bookingId);
  if (!bookingInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateData = {
    status: 'cancelled',
    bookingCancellation: reasonId,
  };
  Object.assign(bookingInfo, updateData);
  await bookingInfo.save();
  return bookingInfo;
};

const adminDiningBookingCount = async () => {
  const all = await DiningBooking.countDocuments();
  const fresh = await DiningBooking.countDocuments({ status: 'created' });
  const accepted = await DiningBooking.countDocuments({ status: 'accepted' });
  const completed = await DiningBooking.countDocuments({ status: 'completed' });
  const cancelled = await DiningBooking.countDocuments({ status: 'cancelled' });
  const rejected = await DiningBooking.countDocuments({ status: 'rejected' });
  const refunded = await DiningBooking.countDocuments({ status: 'refunded' });
  const partially = await DiningBooking.countDocuments({ status: 'partially_refunded' });
  const pending = await DiningBooking.countDocuments({ status: 'pending_payments' });
  return Promise.all([
    all,
    fresh,
    accepted,
    completed,
    cancelled,
    rejected,
    refunded,
    partially,
    pending,
  ]).then(() => {
    const result = {
      all,
      fresh,
      accepted,
      completed,
      cancelled,
      rejected,
      refunded,
      partially,
      pending,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityzenDiningBookingCount = async (masterId) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const allCount = await DiningBooking.aggregate([
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
      $match: {
        'restaurants.city': new mongoose.Types.ObjectId(city),
      },
    },
    { $count: 'totalCount' },
  ]);
  const freshCount = await DiningBooking.aggregate([
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
      $match: {
        'restaurants.city': new mongoose.Types.ObjectId(city),
        status: 'created',
      },
    },
    { $count: 'totalCount' },
  ]);
  const acceptedCount = await DiningBooking.aggregate([
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
      $match: {
        'restaurants.city': new mongoose.Types.ObjectId(city),
        status: 'accepted',
      },
    },
    { $count: 'totalCount' },
  ]);
  const completedCount = await DiningBooking.aggregate([
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
      $match: {
        'restaurants.city': new mongoose.Types.ObjectId(city),
        status: 'completed',
      },
    },
    { $count: 'totalCount' },
  ]);
  const cancelledCount = await DiningBooking.aggregate([
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
      $match: {
        'restaurants.city': new mongoose.Types.ObjectId(city),
        status: 'cancelled',
      },
    },
    { $count: 'totalCount' },
  ]);
  const rejectedCount = await DiningBooking.aggregate([
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
      $match: {
        'restaurants.city': new mongoose.Types.ObjectId(city),
        status: 'rejected',
      },
    },
    { $count: 'totalCount' },
  ]);
  const refundedCount = await DiningBooking.aggregate([
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
      $match: {
        'restaurants.city': new mongoose.Types.ObjectId(city),
        status: 'refunded',
      },
    },
    { $count: 'totalCount' },
  ]);
  const partiallyCount = await DiningBooking.aggregate([
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
      $match: {
        'restaurants.city': new mongoose.Types.ObjectId(city),
        status: 'partially_refunded',
      },
    },
    { $count: 'totalCount' },
  ]);
  const pendingCount = await DiningBooking.aggregate([
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
      $match: {
        'restaurants.city': new mongoose.Types.ObjectId(city),
        status: 'pending_payments',
      },
    },
    { $count: 'totalCount' },
  ]);
  return Promise.all([
    allCount,
    freshCount,
    acceptedCount,
    completedCount,
    cancelledCount,
    rejectedCount,
    refundedCount,
    partiallyCount,
    pendingCount,
  ]).then(() => {
    const all = checkArrayNotEmpty(allCount) ? allCount[0].totalCount : 0;
    const fresh = checkArrayNotEmpty(freshCount) ? freshCount[0].totalCount : 0;
    const accepted = checkArrayNotEmpty(acceptedCount) ? acceptedCount[0].totalCount : 0;
    const completed = checkArrayNotEmpty(completedCount) ? completedCount[0].totalCount : 0;
    const cancelled = checkArrayNotEmpty(cancelledCount) ? cancelledCount[0].totalCount : 0;
    const rejected = checkArrayNotEmpty(rejectedCount) ? rejectedCount[0].totalCount : 0;
    const refunded = checkArrayNotEmpty(refundedCount) ? refundedCount[0].totalCount : 0;
    const partially = checkArrayNotEmpty(partiallyCount) ? partiallyCount[0].totalCount : 0;
    const pending = checkArrayNotEmpty(pendingCount) ? pendingCount[0].totalCount : 0;
    const result = {
      all,
      fresh,
      accepted,
      completed,
      cancelled,
      rejected,
      refunded,
      partially,
      pending,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const adminDiningBookingList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const isValidObjectId = mongoose.Types.ObjectId.isValid(options.search);
  const bookingStatus = options.status;
  const orderMatch = {
    $or: [
      isValidObjectId ? { _id: new mongoose.Types.ObjectId(options.search) } : null,
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
    $and: [bookingStatus !== 'all' ? { status: bookingStatus } : { status: { $ne: 'all' } }],
  };
  const bookingQuery = [
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
      $match: orderMatch,
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
        bookingDate: 1,
        bookingSlot: 1,
        guest: 1,
        userName: 1,
        userCountryCode: 1,
        userContact: {
          $concat: [
            { $substr: ['$userContact', 0, 2] },
            'XXXXXX',
            { $substr: ['$userContact', { $subtract: [{ $strLenCP: '$userContact' }, 2] }, 2] },
          ],
        },
        userEmail: {
          $concat: [
            { $substrCP: ['$userEmail', 0, 2] },
            'XXXXX@',
            { $arrayElemAt: [{ $split: ['$userEmail', '@'] }, 1] },
          ],
        },
        paymentMode: 1,
        status: 1,
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
      },
    },
  ];
  const bookings = await DiningBooking.aggregate(bookingQuery);
  const countResult = await DiningBooking.aggregate([
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
  return Promise.all([bookings, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      bookings,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityzenDiningBookingList = async (masterId, bookingStatus, options) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const isValidObjectId = mongoose.Types.ObjectId.isValid(options.search);
  const orderMatch = {
    $or: [
      isValidObjectId ? { _id: new mongoose.Types.ObjectId(options.search) } : null,
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
      bookingStatus !== 'all' ? { status: bookingStatus } : { status: { $ne: 'all' } },
      { 'restaurants.city': new mongoose.Types.ObjectId(city) },
    ],
  };
  const bookingQuery = [
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
        from: 'paymentconfigs',
        localField: 'payment',
        foreignField: '_id',
        as: 'paymentconfigs',
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
      $unwind: {
        path: '$paymentconfigs',
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
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        bookingDate: 1,
        bookingSlot: 1,
        guest: 1,
        userName: 1,
        userCountryCode: 1,
        userContact: {
          $concat: [
            { $substr: ['$userContact', 0, 2] },
            'XXXXXX',
            { $substr: ['$userContact', { $subtract: [{ $strLenCP: '$userContact' }, 2] }, 2] },
          ],
        },
        userEmail: {
          $concat: [
            { $substrCP: ['$userEmail', 0, 2] },
            'XXXXX@',
            { $arrayElemAt: [{ $split: ['$userEmail', '@'] }, 1] },
          ],
        },
        paymentMode: 1,
        status: 1,
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
      },
    },
  ];
  const bookings = await DiningBooking.aggregate(bookingQuery);
  const countResult = await DiningBooking.aggregate([
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
  return Promise.all([bookings, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      bookings,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getVendorDiningBookingList = async (vendorId, statusName, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const diningQuery = [
    { $match: { restaurant: new mongoose.Types.ObjectId(vendorId), status: statusName } },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
        from: 'diningcoupons',
        localField: 'coupon',
        foreignField: '_id',
        as: 'diningcoupons',
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
        path: '$diningcoupons',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        bookingDate: 1,
        bookingSlot: 1,
        guest: 1,
        userName: 1,
        userCountryCode: 1,
        specialRequest: 1,
        userContact: {
          $concat: [
            { $substr: ['$userContact', 0, 2] },
            'XXXXXX',
            { $substr: ['$userContact', { $subtract: [{ $strLenCP: '$userContact' }, 2] }, 2] },
          ],
        },
        userEmail: {
          $concat: [
            { $substrCP: ['$userEmail', 0, 2] },
            'XXXXX@',
            { $arrayElemAt: [{ $split: ['$userEmail', '@'] }, 1] },
          ],
        },
        createdAt: 1,
        couponCoverCharge: {
          $round: [{ $divide: ['$couponCoverCharge', 100] }, 2],
        },
        preBookingCharge: {
          $round: [{ $divide: ['$preBookingCharge', 100] }, 2],
        },
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
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
        coupon: {
          id: { $ifNull: ['$diningcoupons._id', ''] },
          name: { $ifNull: ['$diningcoupons.name', ''] },
          code: { $ifNull: ['$diningcoupons.code', ''] },
          discountType: { $ifNull: ['$diningcoupons.discountType', ''] },
          minDiscount: {
            $round: [{ $divide: ['$diningcoupons.minDiscount', 100] }, 2],
          },
          maxDiscount: {
            $round: [{ $divide: ['$diningcoupons.maxDiscount', 100] }, 2],
          },
          translations: { $ifNull: ['$diningcoupons.translations', []] },
        },
      },
    },
  ];
  const bookings = await DiningBooking.aggregate(diningQuery);
  const totalResults = await DiningBooking.countDocuments({
    restaurant: new mongoose.Types.ObjectId(vendorId),
    status: statusName,
  });
  const createdBooking = await DiningBooking.countDocuments({
    restaurant: new mongoose.Types.ObjectId(vendorId),
    status: 'created',
  });
  const acceptedBooking = await DiningBooking.countDocuments({
    restaurant: new mongoose.Types.ObjectId(vendorId),
    status: 'accepted',
  });
  const completedBooking = await DiningBooking.countDocuments({
    restaurant: new mongoose.Types.ObjectId(vendorId),
    status: 'completed',
  });
  const cancelledBooking = await DiningBooking.countDocuments({
    restaurant: new mongoose.Types.ObjectId(vendorId),
    status: 'cancelled',
  });
  const rejectedBooking = await DiningBooking.countDocuments({
    restaurant: new mongoose.Types.ObjectId(vendorId),
    status: 'rejected',
  });
  const refundedBooking = await DiningBooking.countDocuments({
    restaurant: new mongoose.Types.ObjectId(vendorId),
    status: 'refunded',
  });
  const partialRefundedBooking = await DiningBooking.countDocuments({
    restaurant: new mongoose.Types.ObjectId(vendorId),
    status: 'partially_refunded',
  });
  const diningSettings = await DiningSetting.findOne({}, { restaurantCanCancelRequest: 1 });
  return Promise.all([
    bookings,
    totalResults,
    createdBooking,
    acceptedBooking,
    completedBooking,
    cancelledBooking,
    rejectedBooking,
    refundedBooking,
    partialRefundedBooking,
    diningSettings,
  ]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      bookings,
      page,
      limit,
      totalPages,
      totalResults,
      createdBooking,
      acceptedBooking,
      completedBooking,
      cancelledBooking,
      rejectedBooking,
      refundedBooking,
      partialRefundedBooking,
      diningSettings,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const acceptDiningBooking = async (bookingId, vendorId) => {
  const bookingInfo = await DiningBooking.findOne({
    _id: new mongoose.Types.ObjectId(bookingId),
    restaurant: new mongoose.Types.ObjectId(vendorId),
  });
  if (!bookingInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateData = {
    status: 'accepted',
  };
  Object.assign(bookingInfo, updateData);
  await bookingInfo.save();
  return bookingInfo;
};

const rejectDiningBooking = async (bookingId, vendorId, reasonId) => {
  const bookingInfo = await DiningBooking.findOne({
    _id: new mongoose.Types.ObjectId(bookingId),
    restaurant: new mongoose.Types.ObjectId(vendorId),
  });
  if (!bookingInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateData = {
    status: 'rejected',
    bookingCancellation: reasonId,
  };
  Object.assign(bookingInfo, updateData);
  await bookingInfo.save();
  return bookingInfo;
};

const completeDiningBooking = async (
  bookingId,
  vendorId,
  itemTotal,
  itemDiscount,
  couponDiscount,
  billTotal
) => {
  const bookingInfo = await DiningBooking.findOne({
    _id: new mongoose.Types.ObjectId(bookingId),
    restaurant: new mongoose.Types.ObjectId(vendorId),
  });
  if (!bookingInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (
    bookingInfo &&
    bookingInfo.coupon &&
    bookingInfo.coupon !== null &&
    bookingInfo.coupon !== ''
  ) {
    const diningCoupon = await DiningCoupon.findById(bookingInfo.coupon);
    if (
      diningCoupon &&
      diningCoupon.createdBy &&
      diningCoupon.createdBy !== null &&
      diningCoupon.createdBy === 'admin'
    ) {
      const expenseData = new AdminExpense({
        expenseType: `dining_booking_coupon`,
        coupon: null,
        diningCoupon: bookingInfo.coupon,
        diningBooking: bookingId,
        order: null,
        user: bookingInfo.user,
        amount: couponDiscount,
      });
      await AdminExpense.create(expenseData);
    } else if (
      diningCoupon &&
      diningCoupon.createdBy &&
      diningCoupon.createdBy !== null &&
      diningCoupon.createdBy !== 'admin'
    ) {
      const expenseData = new RestaurantExpense({
        expenseType: `dining_coupon`,
        restaurant: vendorId,
        coupon: null,
        diningCoupon: bookingInfo.coupon,
        diningBooking: bookingId,
        order: null,
        posOrder: null,
        tableOrder: null,
        user: bookingInfo.user,
        amount: couponDiscount,
      });
      await RestaurantExpense.create(expenseData);
    }
  }

  if (parseFloat(itemDiscount) > 0) {
    const expenseData = new RestaurantExpense({
      expenseType: `dining_booking_discount`,
      restaurant: vendorId,
      coupon: null,
      diningCoupon: null,
      diningBooking: bookingId,
      order: null,
      posOrder: null,
      tableOrder: null,
      user: bookingInfo.user,
      amount: itemDiscount,
    });
    await RestaurantExpense.create(expenseData);
  }
  const updateData = {
    status: 'completed',
    diningItemTotalAmount: itemTotal,
    diningItemDiscountAmount: itemDiscount,
    diningCouponDiscountAmount: couponDiscount,
    diningGrandTotalBillAmount: billTotal,
  };
  Object.assign(bookingInfo, updateData);
  await bookingInfo.save();
  return bookingInfo;
};

const getDiningBookingInformation = async (bookingId, vendorId) => {
  const diningQuery = [
    {
      $match: {
        _id: new mongoose.Types.ObjectId(bookingId),
        restaurant: new mongoose.Types.ObjectId(vendorId),
      },
    },
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
        from: 'paymentconfigs',
        localField: 'payment',
        foreignField: '_id',
        as: 'paymentconfigs',
      },
    },
    {
      $lookup: {
        from: 'diningcoupons',
        localField: 'coupon',
        foreignField: '_id',
        as: 'diningcoupons',
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
        path: '$diningcoupons',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        bookingDate: 1,
        bookingSlot: 1,
        guest: 1,
        userName: 1,
        userCountryCode: 1,
        specialRequest: 1,
        userContact: {
          $concat: [
            { $substr: ['$userContact', 0, 2] },
            'XXXXXX',
            { $substr: ['$userContact', { $subtract: [{ $strLenCP: '$userContact' }, 2] }, 2] },
          ],
        },
        userEmail: {
          $concat: [
            { $substrCP: ['$userEmail', 0, 2] },
            'XXXXX@',
            { $arrayElemAt: [{ $split: ['$userEmail', '@'] }, 1] },
          ],
        },
        createdAt: 1,
        couponCoverCharge: {
          $round: [{ $divide: ['$couponCoverCharge', 100] }, 2],
        },
        preBookingCharge: {
          $round: [{ $divide: ['$preBookingCharge', 100] }, 2],
        },
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
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
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          slug: { $ifNull: ['$paymentconfigs.slug', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        coupon: {
          id: { $ifNull: ['$diningcoupons._id', ''] },
          name: { $ifNull: ['$diningcoupons.name', ''] },
          code: { $ifNull: ['$diningcoupons.code', ''] },
          discountType: { $ifNull: ['$diningcoupons.discountType', ''] },
          minDiscount: {
            $round: [{ $divide: ['$diningcoupons.minDiscount', 100] }, 2],
          },
          maxDiscount: {
            $round: [{ $divide: ['$diningcoupons.maxDiscount', 100] }, 2],
          },
          translations: { $ifNull: ['$diningcoupons.translations', []] },
        },
      },
    },
  ];
  const bookings = await DiningBooking.aggregate(diningQuery);
  if (!bookings[0]) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const details = bookings[0];
  const diningSettings = await DiningSetting.findOne({}, { restaurantCanCancelRequest: 1 });
  const restaurantConfig = await RestaurantSettings.findOne(
    {},
    { canInitiateCall: 1, canInitiateChat: 1 }
  );
  return Promise.all([details, diningSettings, restaurantConfig]).then(() => {
    const result = {
      details,
      diningSettings,
      restaurantConfig,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const callBookingCustomer = async (bookingId, vendorId) => {
  const details = await DiningBooking.findOne(
    {
      _id: new mongoose.Types.ObjectId(bookingId),
      restaurant: new mongoose.Types.ObjectId(vendorId),
    },
    { userCountryCode: 1, userContact: 1 }
  );
  return { details, success: true };
};

const getVendorWebDiningBookingList = async (vendorId, statusName, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const diningQuery = [
    { $match: { restaurant: new mongoose.Types.ObjectId(vendorId), status: statusName } },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        bookingDate: 1,
        bookingSlot: 1,
        guest: 1,
        userName: 1,
        userCountryCode: 1,
        specialRequest: 1,
        userContact: {
          $concat: [
            { $substr: ['$userContact', 0, 2] },
            'XXXXXX',
            { $substr: ['$userContact', { $subtract: [{ $strLenCP: '$userContact' }, 2] }, 2] },
          ],
        },
        userEmail: {
          $concat: [
            { $substrCP: ['$userEmail', 0, 2] },
            'XXXXX@',
            { $arrayElemAt: [{ $split: ['$userEmail', '@'] }, 1] },
          ],
        },
        createdAt: 1,
        couponCoverCharge: {
          $round: [{ $divide: ['$couponCoverCharge', 100] }, 2],
        },
        preBookingCharge: {
          $round: [{ $divide: ['$preBookingCharge', 100] }, 2],
        },
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
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
      },
    },
  ];
  const bookings = await DiningBooking.aggregate(diningQuery);
  const totalResults = await DiningBooking.countDocuments({
    restaurant: new mongoose.Types.ObjectId(vendorId),
    status: statusName,
  });
  return Promise.all([bookings]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      bookings,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getDiningBookingInfoAdmin = async (bookingId) => {
  const diningQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(bookingId) } },
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
        from: 'paymentconfigs',
        localField: 'payment',
        foreignField: '_id',
        as: 'paymentconfigs',
      },
    },
    {
      $lookup: {
        from: 'diningcoupons',
        localField: 'coupon',
        foreignField: '_id',
        as: 'diningcoupons',
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
        path: '$paymentconfigs',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$diningcoupons',
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
        bookingDate: 1,
        bookingSlot: 1,
        guest: 1,
        userName: 1,
        userCountryCode: 1,
        specialRequest: 1,
        userContact: {
          $concat: [
            { $substr: ['$userContact', 0, 2] },
            'XXXXXX',
            { $substr: ['$userContact', { $subtract: [{ $strLenCP: '$userContact' }, 2] }, 2] },
          ],
        },
        userEmail: {
          $concat: [
            { $substrCP: ['$userEmail', 0, 2] },
            'XXXXX@',
            { $arrayElemAt: [{ $split: ['$userEmail', '@'] }, 1] },
          ],
        },
        createdAt: 1,
        couponCoverCharge: {
          $round: [{ $divide: ['$couponCoverCharge', 100] }, 2],
        },
        preBookingCharge: {
          $round: [{ $divide: ['$preBookingCharge', 100] }, 2],
        },
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
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
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          slug: { $ifNull: ['$paymentconfigs.slug', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        coupon: {
          id: { $ifNull: ['$diningcoupons._id', ''] },
          name: { $ifNull: ['$diningcoupons.name', ''] },
          discountType: { $ifNull: ['$diningcoupons.discountType', ''] },
          minDiscount: {
            $round: [{ $divide: ['$diningcoupons.minDiscount', 100] }, 2],
          },
          maxDiscount: {
            $round: [{ $divide: ['$diningcoupons.maxDiscount', 100] }, 2],
          },
          translations: { $ifNull: ['$diningcoupons.translations', []] },
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
      },
    },
  ];
  const bookings = await DiningBooking.aggregate(diningQuery);
  if (!bookings[0]) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const details = bookings[0];
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
  return Promise.all([details, restUserInfo]).then(() => {
    const result = {
      details,
      restUserInfo,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const diningBookingReport = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const filter = options.filter === 'true' || options.filter === true;
  const matchQuery = {
    $match:
      filter &&
      options &&
      options.restaurant &&
      options.restaurant !== null &&
      options.restaurant !== ''
        ? { restaurant: new mongoose.Types.ObjectId(options.restaurant) }
        : { restaurant: { $ne: null } },
  };
  if (filter) {
    if (options.filterDates !== '-') {
      const dateRangeArray = options.filterDates.split('-');

      if (dateRangeArray && checkArrayNotEmpty(dateRangeArray)) {
        const parseDate = (dateStr) => {
          const [day, month, year] = dateStr.trim().split('/');
          return new Date(`${year}-${month}-${day}`);
        };

        const start = parseDate(dateRangeArray[0]);
        const end = parseDate(dateRangeArray[1]);

        const dateRange = {};

        if (start) dateRange.$gte = start;
        if (end) dateRange.$lte = end;

        matchQuery.$match.createdAt = dateRange;
      }
    }
  }
  const name = options.search;
  const query = [
    matchQuery,
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
      $match: {
        $or: [
          { 'users.firstName': RegExp(name, 'i') },
          { 'users.lastName': RegExp(name, 'i') },
          { userName: RegExp(name, 'i') },
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
        paymentMode: 1,
        userName: 1,
        bookingDate: 1,
        bookingSlot: 1,
        preBookingCharge: {
          $round: [{ $divide: ['$preBookingCharge', 100] }, 2],
        },
        couponCoverCharge: {
          $round: [{ $divide: ['$couponCoverCharge', 100] }, 2],
        },
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        bookingCommission: {
          $round: [{ $divide: ['$bookingCommission', 100] }, 2],
        },
        status: 1,
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        createdAt: 1,
      },
    },
  ];
  const countQuery = [
    matchQuery,
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
        $or: [{ 'users.firstName': RegExp(name, 'i') }, { 'users.lastName': RegExp(name, 'i') }],
      },
    },
    { $count: 'totalCount' },
  ];
  const results = await DiningBooking.aggregate(query);
  const resultCount = await DiningBooking.aggregate(countQuery);
  const totalResults = checkArrayNotEmpty(resultCount) ? resultCount[0].totalCount : 0;
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

const customerDiningBooking = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { user: new mongoose.Types.ObjectId(options.user) };
  const bookingQuery = [
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
      $lookup: {
        from: 'paymentconfigs',
        localField: 'payment',
        foreignField: '_id',
        as: 'paymentconfigs',
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
      $project: {
        _id: 0,
        id: '$_id',
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        bookingDate: 1,
        bookingSlot: 1,
        guest: 1,
        userName: 1,
        userCountryCode: 1,
        userContact: {
          $concat: [
            { $substr: ['$userContact', 0, 2] },
            'XXXXXX',
            { $substr: ['$userContact', { $subtract: [{ $strLenCP: '$userContact' }, 2] }, 2] },
          ],
        },
        userEmail: {
          $concat: [
            { $substrCP: ['$userEmail', 0, 2] },
            'XXXXX@',
            { $arrayElemAt: [{ $split: ['$userEmail', '@'] }, 1] },
          ],
        },
        paymentMode: 1,
        status: 1,
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
      },
    },
  ];
  const bookings = await DiningBooking.aggregate(bookingQuery);
  const totalResults = await DiningBooking.countDocuments(queryCondition);
  return Promise.all([bookings, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      bookings,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const vendorBookingList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { restaurant: new mongoose.Types.ObjectId(options.restaurant) };
  const bookingQuery = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
    {
      $project: {
        _id: 0,
        id: '$_id',
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        bookingDate: 1,
        bookingSlot: 1,
        guest: 1,
        userName: 1,
        userCountryCode: 1,
        userContact: {
          $concat: [
            { $substr: ['$userContact', 0, 2] },
            'XXXXXX',
            { $substr: ['$userContact', { $subtract: [{ $strLenCP: '$userContact' }, 2] }, 2] },
          ],
        },
        userEmail: {
          $concat: [
            { $substrCP: ['$userEmail', 0, 2] },
            'XXXXX@',
            { $arrayElemAt: [{ $split: ['$userEmail', '@'] }, 1] },
          ],
        },
        paymentMode: 1,
        status: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
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
      },
    },
  ];
  const bookings = await DiningBooking.aggregate(bookingQuery);
  const totalResults = await DiningBooking.countDocuments(queryCondition);
  return Promise.all([bookings, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      bookings,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const couponBooking = async (id, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { coupon: new mongoose.Types.ObjectId(id) };
  const bookingQuery = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
      $project: {
        _id: 0,
        id: '$_id',
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        bookingDate: 1,
        bookingSlot: 1,
        guest: 1,
        userName: 1,
        userCountryCode: 1,
        userContact: {
          $concat: [
            { $substr: ['$userContact', 0, 2] },
            'XXXXXX',
            { $substr: ['$userContact', { $subtract: [{ $strLenCP: '$userContact' }, 2] }, 2] },
          ],
        },
        userEmail: {
          $concat: [
            { $substrCP: ['$userEmail', 0, 2] },
            'XXXXX@',
            { $arrayElemAt: [{ $split: ['$userEmail', '@'] }, 1] },
          ],
        },
        paymentMode: 1,
        status: 1,
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
      },
    },
  ];
  const bookings = await DiningBooking.aggregate(bookingQuery);
  const totalResults = await DiningBooking.countDocuments(queryCondition);
  return Promise.all([bookings, totalResults]).then(() => {
    const result = {
      bookings,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const supportTeamBookingDetail = async (bookingId) => {
  const diningQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(bookingId) } },
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
        from: 'paymentconfigs',
        localField: 'payment',
        foreignField: '_id',
        as: 'paymentconfigs',
      },
    },
    {
      $lookup: {
        from: 'diningcoupons',
        localField: 'coupon',
        foreignField: '_id',
        as: 'diningcoupons',
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
        path: '$paymentconfigs',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$diningcoupons',
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
        bookingDate: 1,
        bookingSlot: 1,
        guest: 1,
        userName: 1,
        userCountryCode: 1,
        specialRequest: 1,
        userContact: {
          $concat: [
            { $substr: ['$userContact', 0, 2] },
            'XXXXXX',
            { $substr: ['$userContact', { $subtract: [{ $strLenCP: '$userContact' }, 2] }, 2] },
          ],
        },
        userEmail: {
          $concat: [
            { $substrCP: ['$userEmail', 0, 2] },
            'XXXXX@',
            { $arrayElemAt: [{ $split: ['$userEmail', '@'] }, 1] },
          ],
        },
        createdAt: 1,
        couponCoverCharge: {
          $round: [{ $divide: ['$couponCoverCharge', 100] }, 2],
        },
        preBookingCharge: {
          $round: [{ $divide: ['$preBookingCharge', 100] }, 2],
        },
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
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
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          slug: { $ifNull: ['$paymentconfigs.slug', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        coupon: {
          id: { $ifNull: ['$diningcoupons._id', ''] },
          name: { $ifNull: ['$diningcoupons.name', ''] },
          discountType: { $ifNull: ['$diningcoupons.discountType', ''] },
          minDiscount: {
            $round: [{ $divide: ['$diningcoupons.minDiscount', 100] }, 2],
          },
          maxDiscount: {
            $round: [{ $divide: ['$diningcoupons.maxDiscount', 100] }, 2],
          },
          translations: { $ifNull: ['$diningcoupons.translations', []] },
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
      },
    },
  ];
  const bookings = await DiningBooking.aggregate(diningQuery);
  if (!bookings[0]) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const details = bookings[0];
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
  return Promise.all([details, restUserInfo]).then(() => {
    const result = {
      details,
      restUserInfo,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const exportCollection = async (bookingStatus, search) => {
  const searchRegExp = RegExp(search, 'i');
  const isValidObjectId = mongoose.Types.ObjectId.isValid(search);
  const orderMatch = {
    $or: [
      isValidObjectId ? { _id: new mongoose.Types.ObjectId(search) } : null,
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
    $and: [bookingStatus !== 'all' ? { status: bookingStatus } : { status: { $ne: 'all' } }],
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
        from: 'paymentconfigs',
        localField: 'payment',
        foreignField: '_id',
        as: 'paymentconfigs',
      },
    },
    {
      $lookup: {
        from: 'diningcancellationreasons',
        localField: 'bookingCancellation',
        foreignField: '_id',
        as: 'diningcancellationreasons',
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
        path: '$diningcancellationreasons',
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
        bookingDate: 1,
        bookingSlot: 1,
        guest: 1,
        userName: 1,
        userCountryCode: 1,
        userContact: 1,
        userEmail: 1,
        paymentMode: 1,
        status: 1,
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
        cancelReason: {
          id: { $ifNull: ['$diningcancellationreasons._id', ''] },
          name: { $ifNull: ['$diningcancellationreasons.name', ''] },
        },
        specialRequest: 1,
        coupon: 1,
        campaign: 1,
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        preBookingCharge: {
          $round: [{ $divide: ['$preBookingCharge', 100] }, 2],
        },
        couponCoverCharge: {
          $round: [{ $divide: ['$couponCoverCharge', 100] }, 2],
        },
        bookingCommission: {
          $round: [{ $divide: ['$bookingCommission', 100] }, 2],
        },
        diningItemTotalAmount: {
          $round: [{ $divide: ['$diningItemTotalAmount', 100] }, 2],
        },
        diningItemDiscountAmount: {
          $round: [{ $divide: ['$coupondiningItemDiscountAmountCoverCharge', 100] }, 2],
        },
        diningCouponDiscountAmount: {
          $round: [{ $divide: ['$diningCouponDiscountAmount', 100] }, 2],
        },
        diningGrandTotalBillAmount: {
          $round: [{ $divide: ['$diningGrandTotalBillAmount', 100] }, 2],
        },
      },
    },
  ];
  const result = await DiningBooking.aggregate(query);
  return result;
};

const exportRawCollection = async (bookingStatus, search) => {
  const searchRegExp = RegExp(search, 'i');
  const isValidObjectId = mongoose.Types.ObjectId.isValid(search);
  const orderMatch = {
    $or: [
      isValidObjectId ? { _id: new mongoose.Types.ObjectId(search) } : null,
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
    $and: [bookingStatus !== 'all' ? { status: bookingStatus } : { status: { $ne: 'all' } }],
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
    { $sort: { createdAt: -1 } },
    {
      $project: {
        users: 0,
        restaurants: 0,
      },
    },
  ];
  const result = await DiningBooking.aggregate(query);
  return result;
};

const exportReportCollection = async (options) => {
  const filter = options.filter === 'true' || options.filter === true;
  const matchQuery = {
    $match:
      filter &&
      options &&
      options.restaurant &&
      options.restaurant !== null &&
      options.restaurant !== ''
        ? { restaurant: new mongoose.Types.ObjectId(options.restaurant) }
        : { restaurant: { $ne: null } },
  };
  if (filter) {
    if (options.filterDates !== '-') {
      const dateRangeArray = options.filterDates.split('-');

      if (dateRangeArray && checkArrayNotEmpty(dateRangeArray)) {
        const parseDate = (dateStr) => {
          const [day, month, year] = dateStr.trim().split('/');
          return new Date(`${year}-${month}-${day}`);
        };

        const start = parseDate(dateRangeArray[0]);
        const end = parseDate(dateRangeArray[1]);

        const dateRange = {};

        if (start) dateRange.$gte = start;
        if (end) dateRange.$lte = end;

        matchQuery.$match.createdAt = dateRange;
      }
    }
  }
  const name = options.search;
  const query = [
    matchQuery,
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
      $match: {
        $or: [
          { 'users.firstName': RegExp(name, 'i') },
          { 'users.lastName': RegExp(name, 'i') },
          { userName: RegExp(name, 'i') },
        ],
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        paymentMode: 1,
        bookingDate: 1,
        bookingSlot: 1,
        diningItemTotalAmount: {
          $round: [{ $divide: ['$diningItemTotalAmount', 100] }, 2],
        },
        diningItemDiscountAmount: {
          $round: [{ $divide: ['$diningItemDiscountAmount', 100] }, 2],
        },
        diningCouponDiscountAmount: {
          $round: [{ $divide: ['$diningCouponDiscountAmount', 100] }, 2],
        },
        diningGrandTotalBillAmount: {
          $round: [{ $divide: ['$diningGrandTotalBillAmount', 100] }, 2],
        },
        preBookingCharge: {
          $round: [{ $divide: ['$preBookingCharge', 100] }, 2],
        },
        couponCoverCharge: {
          $round: [{ $divide: ['$couponCoverCharge', 100] }, 2],
        },
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        bookingCommission: {
          $round: [{ $divide: ['$bookingCommission', 100] }, 2],
        },
        status: 1,
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
        },
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        coupon: 1,
        campaign: 1,
        createdAt: 1,
      },
    },
  ];
  const result = await DiningBooking.aggregate(query);
  return result;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    const statusArray = [
      'created',
      'accepted',
      'completed',
      'cancelled',
      'rejected',
      'refunded',
      'partially_refunded',
      'pending_payments',
    ];
    importArray.forEach(async (param) => {
      if (statusArray.includes(param.status)) {
        const bookingData = new DiningBooking({
          user: param && param.user && param.user !== null && param.user !== '' ? param.user : null,
          payment:
            param &&
            param.payment &&
            param.payment !== null &&
            param.payment !== '' &&
            param.payment !== '-'
              ? param.payment
              : null,
          paymentMode:
            param &&
            param.paymentMode &&
            param.paymentMode !== null &&
            param.paymentMode !== '' &&
            param.paymentMode === 'online'
              ? 'online'
              : 'offline',
          restaurant:
            param && param.restaurant && param.restaurant !== null && param.restaurant !== ''
              ? param.restaurant
              : null,
          coupon:
            param &&
            param.coupon &&
            param.coupon !== null &&
            param.coupon !== '' &&
            param.coupon !== '-'
              ? param.coupon
              : null,
          bookingDate:
            param && param.bookingDate && param.bookingDate !== null && param.bookingDate !== ''
              ? param.bookingDate
              : null,
          bookingSlot:
            param && param.bookingSlot && param.bookingSlot !== null && param.bookingSlot !== ''
              ? param.bookingSlot
              : null,
          guest:
            param && param.guest && param.guest !== null && param.guest !== '' ? param.guest : 1,
          userName:
            param && param.userName && param.userName !== null && param.userName !== ''
              ? param.userName
              : '',
          userCountryCode:
            param &&
            param.userCountryCode &&
            param.userCountryCode !== null &&
            param.userCountryCode !== ''
              ? param.userCountryCode
              : null,
          userContact:
            param && param.userContact && param.userContact !== null && param.userContact !== ''
              ? param.userContact
              : null,
          userEmail:
            param && param.userEmail && param.userEmail !== null && param.userEmail !== ''
              ? param.userEmail
              : null,
          specialRequest:
            param &&
            param.specialRequest &&
            param.specialRequest !== null &&
            param.specialRequest !== '' &&
            param.specialRequest !== '-'
              ? param.specialRequest
              : null,
          preBookingCharge:
            param &&
            param.preBookingCharge &&
            param.preBookingCharge !== null &&
            param.preBookingCharge !== ''
              ? param.preBookingCharge
              : 0,
          couponCoverCharge:
            param &&
            param.couponCoverCharge &&
            param.couponCoverCharge !== null &&
            param.couponCoverCharge !== ''
              ? param.couponCoverCharge
              : 0,
          grandTotal:
            param && param.grandTotal && param.grandTotal !== null && param.grandTotal !== ''
              ? param.grandTotal
              : 0,
          bookingCommission:
            param &&
            param.bookingCommission &&
            param.bookingCommission !== null &&
            param.bookingCommission !== ''
              ? param.bookingCommission
              : 0,
          status: param.status,
          campaign:
            param &&
            param.campaignId &&
            param.campaignId !== null &&
            param.campaignId !== '' &&
            param.campaignId !== '-'
              ? param.campaignId
              : null,
          bookingCancellation:
            param &&
            param.bookingCancellation &&
            param.bookingCancellation !== null &&
            param.bookingCancellation !== '' &&
            param.bookingCancellation !== '-'
              ? param.bookingCancellation
              : null,
          diningItemTotalAmount:
            param &&
            param.diningItemTotalAmount &&
            param.diningItemTotalAmount !== null &&
            param.diningItemTotalAmount !== ''
              ? param.diningItemTotalAmount
              : 0,
          diningItemDiscountAmount:
            param &&
            param.diningItemDiscountAmount &&
            param.diningItemDiscountAmount !== null &&
            param.diningItemDiscountAmount !== ''
              ? param.diningItemDiscountAmount
              : 0,
          diningCouponDiscountAmount:
            param &&
            param.diningCouponDiscountAmount &&
            param.diningCouponDiscountAmount !== null &&
            param.diningCouponDiscountAmount !== ''
              ? param.diningCouponDiscountAmount
              : 0,
          diningGrandTotalBillAmount:
            param &&
            param.diningGrandTotalBillAmount &&
            param.diningGrandTotalBillAmount !== null &&
            param.diningGrandTotalBillAmount !== ''
              ? param.diningGrandTotalBillAmount
              : 0,
        });
        await DiningBooking.create(bookingData);
      }
    });
  }
  return { success: true };
};

const downloadBookingSummary = async (bookingId, userId) => {
  const bookingQuery = [
    {
      $match: {
        _id: new mongoose.Types.ObjectId(bookingId),
        user: new mongoose.Types.ObjectId(userId),
      },
    },
    { $limit: 1 },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        restaurant: 1,
        bookingDate: 1,
        bookingSlot: 1,
        guest: 1,
        userName: 1,
        userCountryCode: 1,
        userContact: 1,
        userEmail: 1,
        diningGrandTotalBillAmount: {
          $round: [{ $divide: ['$diningGrandTotalBillAmount', 100] }, 2],
        },
      },
    },
  ];
  const booking = await DiningBooking.aggregate(bookingQuery);
  if (booking !== null && booking.length > 0 && checkArrayNotEmpty(booking)) {
    const details = booking[0];
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
    return Promise.all([booking, businessSettings, restaurantInfo]).then(() => {
      const result = {
        details,
        businessSettings,
        restaurantDetail:
          restaurantInfo !== null && restaurantInfo.length > 0 && checkArrayNotEmpty(restaurantInfo)
            ? restaurantInfo[0]
            : null,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const downloadBookingInvoice = async (bookingId, userId) => {
  const bookingQuery = [
    {
      $match: {
        _id: new mongoose.Types.ObjectId(bookingId),
        user: new mongoose.Types.ObjectId(userId),
      },
    },
    { $limit: 1 },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        restaurant: 1,
        bookingDate: 1,
        bookingSlot: 1,
        guest: 1,
        userName: 1,
        userCountryCode: 1,
        userContact: 1,
        userEmail: 1,
        paymentMode: 1,
        preBookingCharge: {
          $round: [{ $divide: ['$preBookingCharge', 100] }, 2],
        },
        couponCoverCharge: {
          $round: [{ $divide: ['$couponCoverCharge', 100] }, 2],
        },
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        diningItemTotalAmount: {
          $round: [{ $divide: ['$diningItemTotalAmount', 100] }, 2],
        },
        diningItemDiscountAmount: {
          $round: [{ $divide: ['$diningItemDiscountAmount', 100] }, 2],
        },
        diningCouponDiscountAmount: {
          $round: [{ $divide: ['$diningItemDiscountAmount', 100] }, 2],
        },
        diningGrandTotalBillAmount: {
          $round: [{ $divide: ['$diningGrandTotalBillAmount', 100] }, 2],
        },
      },
    },
  ];
  const booking = await DiningBooking.aggregate(bookingQuery);
  if (booking !== null && booking.length > 0 && checkArrayNotEmpty(booking)) {
    const details = booking[0];
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
    return Promise.all([booking, businessSettings, restaurantInfo]).then(() => {
      const result = {
        details,
        businessSettings,
        restaurantDetail:
          restaurantInfo !== null && restaurantInfo.length > 0 && checkArrayNotEmpty(restaurantInfo)
            ? restaurantInfo[0]
            : null,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

module.exports = {
  createBooking,
  updateDiningBookingStatus,
  getDiningBookingWithUserId,
  searchDiningBooking,
  getUserDiningBookingInformation,
  updateBookingPayment,
  getDiningBookingMetaNotification,
  cancelDiningBookingByUser,
  adminDiningBookingCount,
  adminDiningBookingList,
  getVendorDiningBookingList,
  acceptDiningBooking,
  rejectDiningBooking,
  completeDiningBooking,
  getDiningBookingInformation,
  callBookingCustomer,
  getVendorWebDiningBookingList,
  getDiningBookingInfoAdmin,
  diningBookingReport,
  customerDiningBooking,
  vendorBookingList,
  couponBooking,
  supportTeamBookingDetail,
  cityzenDiningBookingCount,
  cityzenDiningBookingList,
  exportCollection,
  exportRawCollection,
  exportReportCollection,
  importCollection,
  downloadBookingSummary,
  downloadBookingInvoice,
};

