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
const { PaymentInitiation, BusinessSettings } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const initiatePayment = async (param) => {
  const paymentData = new PaymentInitiation({
    user: param && param.user && param.user !== null && param.user !== '' ? param.user : null,
    payment:
      param && param.payment && param.payment !== null && param.payment !== ''
        ? param.payment
        : null,
    orders:
      param && param.orders && param.orders !== null && param.orders !== '' ? param.orders : null,
    tiffinSubscription:
      param &&
      param.tiffinSubscription &&
      param.tiffinSubscription !== null &&
      param.tiffinSubscription !== ''
        ? param.tiffinSubscription
        : null,
    booking:
      param && param.booking && param.booking !== null && param.booking !== ''
        ? param.booking
        : null,
    restaurantRegisterRequest:
      param &&
      param.restaurantRegisterRequest &&
      param.restaurantRegisterRequest !== null &&
      param.restaurantRegisterRequest !== ''
        ? param.restaurantRegisterRequest
        : null,
    subscribeId:
      param && param.subscribeId && param.subscribeId !== null && param.subscribeId !== ''
        ? param.subscribeId
        : null,
    // Real Estate subjects — the gateway controller routes `listing_package`
    // / `property_hold` / `property_hold_refund` through
    // realestate.payment.service routePaidCallback. Additive only: every
    // existing caller leaves these undefined and is unaffected.
    listingOrder:
      param && param.listingOrder && param.listingOrder !== null && param.listingOrder !== ''
        ? param.listingOrder
        : null,
    hold:
      param && param.hold && param.hold !== null && param.hold !== '' ? param.hold : null,
    holdRefund:
      param && param.holdRefund && param.holdRefund !== null && param.holdRefund !== ''
        ? param.holdRefund
        : null,
    storeOrder:
      param && param.storeOrder && param.storeOrder !== null && param.storeOrder !== ''
        ? param.storeOrder
        : null,
    storeSubscriptionPayment:
      param &&
      param.storeSubscriptionPayment &&
      param.storeSubscriptionPayment !== null &&
      param.storeSubscriptionPayment !== ''
        ? param.storeSubscriptionPayment
        : null,
    localServiceBookingId:
      param && param.localServiceBookingId && param.localServiceBookingId !== null && param.localServiceBookingId !== ''
        ? param.localServiceBookingId
        : null,
    localServiceBooking:
      param && param.localServiceBooking && param.localServiceBooking !== null && param.localServiceBooking !== ''
        ? param.localServiceBooking
        : null,
    // Jhatka subjects. Additive only: every existing caller leaves these undefined
    // and is unaffected. Jhatka writes these rows through
    // modules/jhatka/services/jhatka.payment.service (the stores pattern), so the
    // legacy initiation service is only used if something calls it directly.
    jhatkaOrder:
      param && param.jhatkaOrder && param.jhatkaOrder !== null && param.jhatkaOrder !== ''
        ? param.jhatkaOrder
        : null,
    jhatkaOccurrence:
      param && param.jhatkaOccurrence && param.jhatkaOccurrence !== null && param.jhatkaOccurrence !== ''
        ? param.jhatkaOccurrence
        : null,
    jhatkaSubscription:
      param && param.jhatkaSubscription && param.jhatkaSubscription !== null && param.jhatkaSubscription !== ''
        ? param.jhatkaSubscription
        : null,
    paymentRef: param && param.ref && param.ref !== null && param.ref !== '' ? param.ref : '',
    amount:
      param && param.amount && param.amount !== null && param.amount !== '' ? param.amount : 0,
    paymentFrom:
      param && param.from && param.from !== null && param.from !== '' ? param.from : 'order',
    from:
      param && param.redirect && param.redirect !== null && param.redirect !== '' ? 'web' : 'app',
    redirect:
      param && param.redirect && param.redirect !== null && param.redirect !== ''
        ? param.redirect
        : '',
  });
  return PaymentInitiation.create(paymentData);
};

const paymentInfo = async (id) => {
  const paymentQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(id) } },
    { $limit: 1 },
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              firstName: 1,
              lastName: 1,
              email: 1,
              countryCode: 1,
              mobile: 1,
            },
          },
        ],
        as: 'users',
      },
    },
    {
      $lookup: {
        from: 'paymentconfigs',
        localField: 'payment',
        foreignField: '_id',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              name: 1,
              slug: 1,
              environment: 1,
              credentials: 1,
            },
          },
        ],
        as: 'payments',
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
        path: '$payments',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        users: 1,
        payments: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        paymentFrom: 1,
        paymentRef: 1,
        payResponse: 1,
        orders: 1,
        tiffinSubscription: 1,
        booking: 1,
        restaurantRegisterRequest: 1,
        subscribeId: 1,
        storeOrder: 1,
        storeSubscriptionPayment: 1,
        from: 1,
        redirect: 1,
      },
    },
  ];
  const info = await PaymentInitiation.aggregate([paymentQuery]);
  const businessInfo = await BusinessSettings.findOne({}, { currency: 1, companyName: 1, logo: 1 });
  return Promise.all([info, businessInfo]).then(() => {
    if (!info[0]) {
      const result = { success: false };
      return Promise.resolve(result);
    }
    const result = {
      payments: info[0],
      settings: businessInfo,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getPaymentInitiateInfo = async (id) => {
  return PaymentInitiation.findById(id);
};

const updatePaymentsInfo = async (id, updateBody) => {
  const payments = await getPaymentInitiateInfo(id);
  if (payments) {
    Object.assign(payments, updateBody);
    await payments.save();
  }
};

const deletePaymentIntentForRePayment = async (orderId, userId, payMethod) => {
  const payments = await PaymentInitiation.findOne({
    user: new mongoose.Types.ObjectId(userId),
    orders: new mongoose.Types.ObjectId(orderId),
    payment: new mongoose.Types.ObjectId(payMethod),
  });
  if (!payments) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await payments.deleteOne();
  return payments;
};

const deleteTiffinSubscriptionPaymentIntentForRePayment = async (packageId, userId, payMethod) => {
  const payments = await PaymentInitiation.findOne({
    user: new mongoose.Types.ObjectId(userId),
    tiffinSubscription: new mongoose.Types.ObjectId(packageId),
    payment: new mongoose.Types.ObjectId(payMethod),
  });
  if (!payments) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await payments.deleteOne();
  return payments;
};

const deleteBookingPaymentIntentForRePayment = async (bookingId, userId, payMethod) => {
  const payments = await PaymentInitiation.findOne({
    user: new mongoose.Types.ObjectId(userId),
    booking: new mongoose.Types.ObjectId(bookingId),
    payment: new mongoose.Types.ObjectId(payMethod),
  });
  if (!payments) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await payments.deleteOne();
  return payments;
};

const getUserOrderTransaction = async (userId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = {
    $and: [{ user: new mongoose.Types.ObjectId(userId), paymentFrom: 'order' }],
  };
  const orderTransactionQuery = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'orders',
        localField: 'orders',
        foreignField: '_id',
        as: 'orders',
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
      $unwind: {
        path: '$orders',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'restaurants',
        localField: 'orders.restaurant',
        foreignField: '_id',
        as: 'restaurantInfo',
      },
    },
    {
      $unwind: {
        path: '$restaurantInfo',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        createdAt: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        paymentRef: 1,
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          slug: { $ifNull: ['$paymentconfigs.slug', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        orderInfo: {
          id: { $ifNull: ['$orders._id', ''] },
          orderNo: { $ifNull: ['$orders.orderNo', 0] },
          name: { $ifNull: ['$restaurantInfo.name', ''] },
          logo: { $ifNull: ['$restaurantInfo.logo', ''] },
          cover: { $ifNull: ['$restaurantInfo.cover', ''] },
          slug: { $ifNull: ['$restaurantInfo.slug', ''] },
          address: { $ifNull: ['$restaurantInfo.address', ''] },
          translations: { $ifNull: ['$restaurantInfo.translations', []] },
        },
      },
    },
  ];
  const transactions = await PaymentInitiation.aggregate(orderTransactionQuery);
  const totalResults = await PaymentInitiation.countDocuments(queryCondition);
  return Promise.all([transactions, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      transactions,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getUserDiningTransaction = async (userId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = {
    $and: [{ user: new mongoose.Types.ObjectId(userId), paymentFrom: 'booking' }],
  };
  const orderTransactionQuery = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'diningbookings',
        localField: 'booking',
        foreignField: '_id',
        as: 'diningbookings',
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
      $unwind: {
        path: '$diningbookings',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'restaurants',
        localField: 'diningbookings.restaurant',
        foreignField: '_id',
        as: 'restaurantInfo',
      },
    },
    {
      $unwind: {
        path: '$restaurantInfo',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        createdAt: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        paymentRef: 1,
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          slug: { $ifNull: ['$paymentconfigs.slug', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        diningInfo: {
          id: { $ifNull: ['$diningbookings._id', ''] },
          name: { $ifNull: ['$restaurantInfo.name', ''] },
          logo: { $ifNull: ['$restaurantInfo.logo', ''] },
          cover: { $ifNull: ['$restaurantInfo.cover', ''] },
          slug: { $ifNull: ['$restaurantInfo.slug', ''] },
          address: { $ifNull: ['$restaurantInfo.address', ''] },
          translations: { $ifNull: ['$restaurantInfo.translations', []] },
        },
      },
    },
  ];
  const transactions = await PaymentInitiation.aggregate(orderTransactionQuery);
  const totalResults = await PaymentInitiation.countDocuments(queryCondition);
  return Promise.all([transactions, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      transactions,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getUserFoodSubscriptionTransaction = async (userId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = {
    $and: [{ user: new mongoose.Types.ObjectId(userId), paymentFrom: 'tiffinsubscription' }],
  };
  const orderTransactionQuery = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'userpurchasedtiffinsubscriptions',
        localField: 'tiffinSubscription',
        foreignField: '_id',
        as: 'userpurchasedtiffinsubscriptions',
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
      $unwind: {
        path: '$userpurchasedtiffinsubscriptions',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'subscriptiontiffinpackages',
        localField: 'userpurchasedtiffinsubscriptions.subscriptionPackage',
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
        status: 1,
        createdAt: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        paymentRef: 1,
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          slug: { $ifNull: ['$paymentconfigs.slug', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        tiffinSubscription: 1,
        subscription: {
          id: { $ifNull: ['$subscriptiontiffinpackages._id', ''] },
          name: { $ifNull: ['$subscriptiontiffinpackages.name', ''] },
          image: { $ifNull: ['$subscriptiontiffinpackages.image', ''] },
          interval: { $ifNull: ['$subscriptiontiffinpackages.interval', 0] },
          totalOrder: { $ifNull: ['$subscriptiontiffinpackages.totalOrder', 0] },
          available: { $ifNull: ['$subscriptiontiffinpackages.available', ''] },
          translations: { $ifNull: ['$subscriptiontiffinpackages.translations', []] },
        },
      },
    },
  ];
  const transactions = await PaymentInitiation.aggregate(orderTransactionQuery);
  const totalResults = await PaymentInitiation.countDocuments(queryCondition);
  return Promise.all([transactions, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      transactions,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getPaymentInitiateReport = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const filter = options.filter === 'true' || options.filter === true;
  const matchQuery = {
    $match: filter
      ? { status: { $in: [options.status] }, paymentFrom: { $in: [options.kind] } }
      : {
          status: { $in: ['initiated', 'paid', 'cancelled'] },
          paymentFrom: {
            $nin: ['all'],
          },
        },
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
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'orders',
        localField: 'orders',
        foreignField: '_id',
        as: 'orders',
      },
    },
    {
      $unwind: {
        path: '$orders',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: options.search
        ? {
            $or: [
              { 'users.firstName': RegExp(name, 'i') },
              { 'users.lastName': RegExp(name, 'i') },
            ],
          }
        : {},
    },
    {
      $lookup: {
        from: 'userpurchasedtiffinsubscriptions',
        localField: 'tiffinSubscription',
        foreignField: '_id',
        as: 'userpurchasedtiffinsubscriptions',
      },
    },
    {
      $unwind: {
        path: '$userpurchasedtiffinsubscriptions',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'diningbookings',
        localField: 'booking',
        foreignField: '_id',
        as: 'diningbookings',
      },
    },
    {
      $unwind: {
        path: '$diningbookings',
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
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          role: { $ifNull: ['$users.role', ''] },
          image: { $ifNull: ['$users.image', ''] },
        },
        orderInfo: {
          id: { $ifNull: ['$orders._id', ''] },
          orderNo: { $ifNull: ['$orders.orderNo', 0] },
        },
        tiffinSubscriptionPackageInfo: {
          id: { $ifNull: ['$userpurchasedtiffinsubscriptions._id', ''] },
          package: { $ifNull: ['$userpurchasedtiffinsubscriptions.subscriptionPackage', ''] },
        },
        diningBookingInfo: {
          id: { $ifNull: ['$diningbookings._id', ''] },
        },
        paymentFrom: 1,
        status: 1,
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
      $match: options.search
        ? {
            $or: [
              { 'users.firstName': RegExp(name, 'i') },
              { 'users.lastName': RegExp(name, 'i') },
            ],
          }
        : {},
    },
    { $count: 'totalCount' },
  ];
  const results = await PaymentInitiation.aggregate(query);
  const resultCount = await PaymentInitiation.aggregate(countQuery);
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

const exportCollection = async (options) => {
  const filter = options.filter === 'true' || options.filter === true;
  const matchQuery = {
    $match: filter
      ? { status: { $in: [options.status] }, paymentFrom: { $in: [options.kind] } }
      : {
          status: { $in: ['initiated', 'paid', 'cancelled'] },
          paymentFrom: {
            $nin: ['all'],
          },
        },
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
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'orders',
        localField: 'orders',
        foreignField: '_id',
        as: 'orders',
      },
    },
    {
      $unwind: {
        path: '$orders',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: options.search
        ? {
            $or: [
              { 'users.firstName': RegExp(name, 'i') },
              { 'users.lastName': RegExp(name, 'i') },
            ],
          }
        : {},
    },
    {
      $lookup: {
        from: 'paymentconfigs',
        localField: 'payment',
        foreignField: '_id',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              name: 1,
            },
          },
        ],
        as: 'payments',
      },
    },
    {
      $unwind: {
        path: '$payments',
        preserveNullAndEmptyArrays: true,
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        orderInfo: {
          id: { $ifNull: ['$orders._id', ''] },
          orderNo: { $ifNull: ['$orders.orderNo', 0] },
        },
        tiffinSubscription: 1,
        booking: 1,
        restaurantRegisterRequest: 1,
        subscribeId: 1,
        paymentFrom: 1,
        payments: 1,
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const result = await PaymentInitiation.aggregate(query);
  return result;
};

const exportRawCollection = async (options) => {
  const filter = options.filter === 'true' || options.filter === true;
  const matchQuery = {
    $match: filter
      ? { status: { $in: [options.status] }, paymentFrom: { $in: [options.kind] } }
      : {
          status: { $in: ['initiated', 'paid', 'cancelled'] },
          paymentFrom: {
            $nin: ['all'],
          },
        },
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
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'orders',
        localField: 'orders',
        foreignField: '_id',
        as: 'orders',
      },
    },
    {
      $unwind: {
        path: '$orders',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $match: options.search
        ? {
            $or: [
              { 'users.firstName': RegExp(name, 'i') },
              { 'users.lastName': RegExp(name, 'i') },
            ],
          }
        : {},
    },
    {
      $lookup: {
        from: 'paymentconfigs',
        localField: 'payment',
        foreignField: '_id',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              name: 1,
            },
          },
        ],
        as: 'payments',
      },
    },
    {
      $unwind: {
        path: '$payments',
        preserveNullAndEmptyArrays: true,
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        users: 0,
        orders: 0,
      },
    },
  ];
  const result = await PaymentInitiation.aggregate(query);
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
    const typeArray = [
      'order',
      'wallet',
      'tiffinsubscription',
      'booking',
      'restaurant_register',
      'renew_subscription',
    ];
    const statusArray = ['initiated', 'paid', 'cancelled'];

    importArray.forEach(async (param) => {
      if (typeArray.includes(param.paymentFrom) && statusArray.includes(param.status)) {
        const payResponseObj =
          param &&
          param.payResponse &&
          param.payResponse !== null &&
          param.payResponse !== '' &&
          param.payResponse !== '-'
            ? safeParse(param.payResponse)
            : {};
        const paymentData = new PaymentInitiation({
          user:
            param && param.user && param.user !== null && param.user !== '' && param.user !== '-'
              ? param.user
              : null,
          payment:
            param &&
            param.payment &&
            param.payment !== null &&
            param.payment !== '' &&
            param.payment !== '-'
              ? param.payment
              : null,
          orders:
            param &&
            param.orders &&
            param.orders !== null &&
            param.orders !== '' &&
            param.orders !== '-'
              ? param.orders
              : null,
          tiffinSubscription:
            param &&
            param.tiffinSubscription &&
            param.tiffinSubscription !== null &&
            param.tiffinSubscription !== '' &&
            param.tiffinSubscription !== '-'
              ? param.tiffinSubscription
              : null,
          booking:
            param &&
            param.booking &&
            param.booking !== null &&
            param.booking !== '' &&
            param.booking !== '-'
              ? param.booking
              : null,
          restaurantRegisterRequest:
            param &&
            param.restaurantRegisterRequest &&
            param.restaurantRegisterRequest !== null &&
            param.restaurantRegisterRequest !== '' &&
            param.restaurantRegisterRequest !== '-'
              ? param.restaurantRegisterRequest
              : null,
          subscribeId:
            param &&
            param.subscribeId &&
            param.subscribeId !== null &&
            param.subscribeId !== '' &&
            param.subscribeId !== '-'
              ? param.subscribeId
              : null,
          paymentRef:
            param && param.paymentRef && param.paymentRef !== null && param.paymentRef !== ''
              ? param.ref
              : '',
          amount:
            param && param.amount && param.amount !== null && param.amount !== ''
              ? param.amount
              : 0,
          paymentFrom:
            param && param.paymentFrom && param.paymentFrom !== null && param.paymentFrom !== ''
              ? param.paymentFrom
              : 'order',
          payResponse: payResponseObj,
          status:
            param && param.status && param.status !== null && param.status !== ''
              ? param.status
              : 'paid',
        });
        await PaymentInitiation.create(paymentData);
      }
    });
  }
  return { success: true };
};

module.exports = {
  initiatePayment,
  paymentInfo,
  updatePaymentsInfo,
  deletePaymentIntentForRePayment,
  deleteTiffinSubscriptionPaymentIntentForRePayment,
  deleteBookingPaymentIntentForRePayment,
  getUserOrderTransaction,
  getUserDiningTransaction,
  getUserFoodSubscriptionTransaction,
  getPaymentInitiateReport,
  exportCollection,
  exportRawCollection,
  importCollection,
};

