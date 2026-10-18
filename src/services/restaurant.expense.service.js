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
const { RestaurantExpense } = require('../models');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const saveExpense = async (param) => {
  const expenseData = new RestaurantExpense({
    restaurant: param.restaurant,
    expenseType: param.expenseType,
    coupon:
      param && param.coupon && param.coupon !== null && param.coupon !== '' ? param.coupon : null,
    diningCoupon:
      param && param.diningCoupon && param.diningCoupon !== null && param.diningCoupon !== ''
        ? param.diningCoupon
        : null,
    diningBooking:
      param && param.diningBooking && param.diningBooking !== null && param.diningBooking !== ''
        ? param.diningBooking
        : null,
    order: param && param.order && param.order !== null && param.order !== '' ? param.order : null,
    posOrder:
      param && param.posOrder && param.posOrder !== null && param.posOrder !== ''
        ? param.posOrder
        : null,
    tableOrder:
      param && param.tableOrder && param.tableOrder !== null && param.tableOrder !== ''
        ? param.tableOrder
        : null,
    user: param && param.user && param.user !== null && param.user !== '' ? param.user : null,
    amount:
      param && param.amount && param.amount !== null && param.amount !== '' ? param.amount : 0,
  });
  await RestaurantExpense.create(expenseData);
  return { success: true };
};

const getInitialResponse = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const matchQuery = {
    $match:
      options && options.type && options.type !== null && options.type !== 'all'
        ? { expenseType: options.type, restaurant: new mongoose.Types.ObjectId(options.restaurant) }
        : {
            expenseType: { $ne: null },
            restaurant: new mongoose.Types.ObjectId(options.restaurant),
          },
  };
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
        from: 'orders',
        localField: 'order',
        foreignField: '_id',
        as: 'orders',
      },
    },
    {
      $lookup: {
        from: 'posortableorders',
        localField: 'posOrder',
        foreignField: '_id',
        as: 'posortableorders',
      },
    },
    {
      $lookup: {
        from: 'tableorders',
        localField: 'tableOrder',
        foreignField: '_id',
        as: 'tableorders',
      },
    },
    {
      $lookup: {
        from: 'diningbookings',
        localField: 'diningBooking',
        foreignField: '_id',
        as: 'diningbookings',
      },
    },
    {
      $lookup: {
        from: 'coupons',
        localField: 'coupon',
        foreignField: '_id',
        as: 'coupons',
      },
    },
    {
      $lookup: {
        from: 'diningcoupons',
        localField: 'diningCoupon',
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
        path: '$orders',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$posortableorders',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$tableorders',
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
      $unwind: {
        path: '$coupons',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$diningcoupons',
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
        expenseType: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
        },
        orderInfo: {
          id: { $ifNull: ['$orders._id', ''] },
          orderNo: { $ifNull: ['$orders.orderNo', 0] },
        },
        posOrderInfo: {
          id: { $ifNull: ['$posortableorders._id', ''] },
          orderNo: { $ifNull: ['$posortableorders.orderNo', 0] },
        },
        tableOrderInfo: {
          id: { $ifNull: ['$tableorders._id', ''] },
          orderNo: { $ifNull: ['$tableorders.orderNo', 0] },
        },
        bookingInfo: {
          id: { $ifNull: ['$diningbookings._id', ''] },
        },
        couponInfo: {
          id: { $ifNull: ['$coupons._id', ''] },
          name: { $ifNull: ['$coupons.name', ''] },
          code: { $ifNull: ['$coupons.code', ''] },
          translations: { $ifNull: ['$coupons.translations', []] },
        },
        diningCouponInfo: {
          id: { $ifNull: ['$diningcoupons._id', ''] },
          name: { $ifNull: ['$diningcoupons.name', ''] },
          code: { $ifNull: ['$diningcoupons.code', ''] },
          translations: { $ifNull: ['$diningcoupons.translations', []] },
        },
        createdAt: 1,
      },
    },
  ];
  const countQuery = [matchQuery, { $count: 'totalCount' }];
  const results = await RestaurantExpense.aggregate(query);
  const resultCount = await RestaurantExpense.aggregate(countQuery);
  const totalResults = checkArrayNotEmpty(resultCount) ? resultCount[0].totalCount : 0;

  const totalExpense = await RestaurantExpense.aggregate([
    {
      $match: { restaurant: new mongoose.Types.ObjectId(options.restaurant) },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        amount: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
        count: 1,
      },
    },
  ]);

  const orderProductDiscountExpense = await RestaurantExpense.aggregate([
    {
      $match: {
        expenseType: 'order_product_discout',
        restaurant: new mongoose.Types.ObjectId(options.restaurant),
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        amount: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
        count: 1,
      },
    },
  ]);

  const posOrderProductDiscountExpense = await RestaurantExpense.aggregate([
    {
      $match: {
        expenseType: 'pos_order_product_discount',
        restaurant: new mongoose.Types.ObjectId(options.restaurant),
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        amount: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
        count: 1,
      },
    },
  ]);

  const tableOrderProductDiscountExpense = await RestaurantExpense.aggregate([
    {
      $match: {
        expenseType: 'table_order_product_discount',
        restaurant: new mongoose.Types.ObjectId(options.restaurant),
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        amount: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
        count: 1,
      },
    },
  ]);

  const posOrderExtraDiscountExpense = await RestaurantExpense.aggregate([
    {
      $match: {
        expenseType: 'pos_order_extra_discount',
        restaurant: new mongoose.Types.ObjectId(options.restaurant),
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        amount: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
        count: 1,
      },
    },
  ]);

  const tableOrderExtraDiscountExpense = await RestaurantExpense.aggregate([
    {
      $match: {
        expenseType: 'table_order_extra_discount',
        restaurant: new mongoose.Types.ObjectId(options.restaurant),
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        amount: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
        count: 1,
      },
    },
  ]);

  const couponExpense = await RestaurantExpense.aggregate([
    {
      $match: {
        expenseType: 'coupon',
        restaurant: new mongoose.Types.ObjectId(options.restaurant),
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        amount: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
        count: 1,
      },
    },
  ]);

  const diningCouponExpense = await RestaurantExpense.aggregate([
    {
      $match: {
        expenseType: 'dining_coupon',
        restaurant: new mongoose.Types.ObjectId(options.restaurant),
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        amount: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
        count: 1,
      },
    },
  ]);

  const diningBookingDiscountExpense = await RestaurantExpense.aggregate([
    {
      $match: {
        expenseType: 'dining_booking_discount',
        restaurant: new mongoose.Types.ObjectId(options.restaurant),
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        amount: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
        count: 1,
      },
    },
  ]);

  const refundOrderExpense = await RestaurantExpense.aggregate([
    {
      $match: {
        expenseType: 'refund_order',
        restaurant: new mongoose.Types.ObjectId(options.restaurant),
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        amount: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
        count: 1,
      },
    },
  ]);

  const otherExpense = await RestaurantExpense.aggregate([
    {
      $match: {
        expenseType: 'other',
        restaurant: new mongoose.Types.ObjectId(options.restaurant),
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        amount: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
        count: 1,
      },
    },
  ]);

  return Promise.all([
    results,
    totalResults,
    totalExpense,
    orderProductDiscountExpense,
    posOrderProductDiscountExpense,
    tableOrderProductDiscountExpense,
    posOrderExtraDiscountExpense,
    tableOrderExtraDiscountExpense,
    couponExpense,
    diningCouponExpense,
    diningBookingDiscountExpense,
    refundOrderExpense,
    otherExpense,
  ]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const totalExpenseData = {
      count: 0,
      amount: 0,
    };
    const orderProductDiscountExpenseData = {
      count: 0,
      amount: 0,
    };
    const posOrderProductDiscountExpenseData = {
      count: 0,
      amount: 0,
    };
    const tableOrderProductDiscountExpenseData = {
      count: 0,
      amount: 0,
    };
    const posOrderExtraDiscountExpenseData = {
      count: 0,
      amount: 0,
    };
    const tableOrderExtraDiscountExpenseData = {
      count: 0,
      amount: 0,
    };
    const couponExpenseData = {
      count: 0,
      amount: 0,
    };
    const diningCouponExpenseData = {
      count: 0,
      amount: 0,
    };
    const diningBookingDiscountExpenseData = {
      count: 0,
      amount: 0,
    };
    const refundOrderExpenseData = {
      count: 0,
      amount: 0,
    };
    const otherExpenseData = {
      count: 0,
      amount: 0,
    };

    if (checkArrayNotEmpty(totalExpense)) {
      totalExpenseData.count = totalExpense[0].count;
      totalExpenseData.amount = totalExpense[0].amount;
    }
    if (checkArrayNotEmpty(orderProductDiscountExpense)) {
      orderProductDiscountExpenseData.count = orderProductDiscountExpense[0].count;
      orderProductDiscountExpenseData.amount = orderProductDiscountExpense[0].amount;
    }
    if (checkArrayNotEmpty(posOrderProductDiscountExpense)) {
      posOrderProductDiscountExpenseData.count = posOrderProductDiscountExpense[0].count;
      posOrderProductDiscountExpenseData.amount = posOrderProductDiscountExpense[0].amount;
    }
    if (checkArrayNotEmpty(tableOrderProductDiscountExpense)) {
      tableOrderProductDiscountExpenseData.count = tableOrderProductDiscountExpense[0].count;
      tableOrderProductDiscountExpenseData.amount = tableOrderProductDiscountExpense[0].amount;
    }
    if (checkArrayNotEmpty(posOrderExtraDiscountExpense)) {
      posOrderExtraDiscountExpenseData.count = posOrderExtraDiscountExpense[0].count;
      posOrderExtraDiscountExpenseData.amount = posOrderExtraDiscountExpense[0].amount;
    }
    if (checkArrayNotEmpty(tableOrderExtraDiscountExpense)) {
      tableOrderExtraDiscountExpenseData.count = tableOrderExtraDiscountExpense[0].count;
      tableOrderExtraDiscountExpenseData.amount = tableOrderExtraDiscountExpense[0].amount;
    }
    if (checkArrayNotEmpty(couponExpense)) {
      couponExpenseData.count = couponExpense[0].count;
      couponExpenseData.amount = couponExpense[0].amount;
    }
    if (checkArrayNotEmpty(diningCouponExpense)) {
      diningCouponExpenseData.count = diningCouponExpense[0].count;
      diningCouponExpenseData.amount = diningCouponExpense[0].amount;
    }
    if (checkArrayNotEmpty(diningBookingDiscountExpense)) {
      diningBookingDiscountExpenseData.count = diningBookingDiscountExpense[0].count;
      diningBookingDiscountExpenseData.amount = diningBookingDiscountExpense[0].amount;
    }
    if (checkArrayNotEmpty(refundOrderExpense)) {
      refundOrderExpenseData.count = refundOrderExpense[0].count;
      refundOrderExpenseData.amount = refundOrderExpense[0].amount;
    }
    if (checkArrayNotEmpty(otherExpense)) {
      otherExpenseData.count = otherExpense[0].count;
      otherExpenseData.amount = otherExpense[0].amount;
    }
    const result = {
      totalExpenseData,
      orderProductDiscountExpenseData,
      posOrderProductDiscountExpenseData,
      tableOrderProductDiscountExpenseData,
      posOrderExtraDiscountExpenseData,
      tableOrderExtraDiscountExpenseData,
      couponExpenseData,
      diningCouponExpenseData,
      diningBookingDiscountExpenseData,
      refundOrderExpenseData,
      otherExpenseData,
      results,
      page,
      limit,
      totalPages,
      totalResults,
    };
    return Promise.resolve(result);
  });
};

const getExpenseList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const matchQuery = {
    $match:
      options && options.type && options.type !== null && options.type !== 'all'
        ? { expenseType: options.type, restaurant: new mongoose.Types.ObjectId(options.restaurant) }
        : {
            expenseType: { $ne: null },
            restaurant: new mongoose.Types.ObjectId(options.restaurant),
          },
  };
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
        from: 'orders',
        localField: 'order',
        foreignField: '_id',
        as: 'orders',
      },
    },
    {
      $lookup: {
        from: 'posortableorders',
        localField: 'posOrder',
        foreignField: '_id',
        as: 'posortableorders',
      },
    },
    {
      $lookup: {
        from: 'tableorders',
        localField: 'tableOrder',
        foreignField: '_id',
        as: 'tableorders',
      },
    },
    {
      $lookup: {
        from: 'diningbookings',
        localField: 'diningBooking',
        foreignField: '_id',
        as: 'diningbookings',
      },
    },
    {
      $lookup: {
        from: 'coupons',
        localField: 'coupon',
        foreignField: '_id',
        as: 'coupons',
      },
    },
    {
      $lookup: {
        from: 'diningcoupons',
        localField: 'diningCoupon',
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
        path: '$orders',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$posortableorders',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$tableorders',
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
      $unwind: {
        path: '$coupons',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$diningcoupons',
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
        expenseType: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
        },
        orderInfo: {
          id: { $ifNull: ['$orders._id', ''] },
          orderNo: { $ifNull: ['$orders.orderNo', 0] },
        },
        posOrderInfo: {
          id: { $ifNull: ['$posortableorders._id', ''] },
          orderNo: { $ifNull: ['$posortableorders.orderNo', 0] },
        },
        tableOrderInfo: {
          id: { $ifNull: ['$tableorders._id', ''] },
          orderNo: { $ifNull: ['$tableorders.orderNo', 0] },
        },
        bookingInfo: {
          id: { $ifNull: ['$diningbookings._id', ''] },
        },
        couponInfo: {
          id: { $ifNull: ['$coupons._id', ''] },
          name: { $ifNull: ['$coupons.name', ''] },
          code: { $ifNull: ['$coupons.code', ''] },
          translations: { $ifNull: ['$coupons.translations', []] },
        },
        diningCouponInfo: {
          id: { $ifNull: ['$diningcoupons._id', ''] },
          name: { $ifNull: ['$diningcoupons.name', ''] },
          code: { $ifNull: ['$diningcoupons.code', ''] },
          translations: { $ifNull: ['$diningcoupons.translations', []] },
        },
        createdAt: 1,
      },
    },
  ];
  const countQuery = [matchQuery, { $count: 'totalCount' }];
  const results = await RestaurantExpense.aggregate(query);
  const resultCount = await RestaurantExpense.aggregate(countQuery);
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
  const matchQuery = {
    $match:
      options && options.type && options.type !== null && options.type !== 'all'
        ? { expenseType: options.type }
        : { expenseType: { $ne: null } },
  };
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
        from: 'orders',
        localField: 'order',
        foreignField: '_id',
        as: 'orders',
      },
    },
    {
      $lookup: {
        from: 'posortableorders',
        localField: 'posOrder',
        foreignField: '_id',
        as: 'posortableorders',
      },
    },
    {
      $lookup: {
        from: 'tableorders',
        localField: 'tableOrder',
        foreignField: '_id',
        as: 'tableorders',
      },
    },
    {
      $lookup: {
        from: 'diningbookings',
        localField: 'diningBooking',
        foreignField: '_id',
        as: 'diningbookings',
      },
    },
    {
      $lookup: {
        from: 'coupons',
        localField: 'coupon',
        foreignField: '_id',
        as: 'coupons',
      },
    },
    {
      $lookup: {
        from: 'diningcoupons',
        localField: 'diningCoupon',
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
        path: '$orders',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$posortableorders',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$tableorders',
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
      $unwind: {
        path: '$coupons',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$diningcoupons',
        preserveNullAndEmptyArrays: true,
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        expenseType: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
        },
        orderInfo: {
          id: { $ifNull: ['$orders._id', ''] },
          orderNo: { $ifNull: ['$orders.orderNo', 0] },
        },
        posOrderInfo: {
          id: { $ifNull: ['$posortableorders._id', ''] },
          orderNo: { $ifNull: ['$posortableorders.orderNo', 0] },
        },
        tableOrderInfo: {
          id: { $ifNull: ['$tableorders._id', ''] },
          orderNo: { $ifNull: ['$tableorders.orderNo', 0] },
        },
        bookingInfo: {
          id: { $ifNull: ['$diningbookings._id', ''] },
        },
        couponInfo: {
          id: { $ifNull: ['$coupons._id', ''] },
          code: { $ifNull: ['$coupons.code', ''] },
        },
        diningCouponInfo: {
          id: { $ifNull: ['$diningcoupons._id', ''] },
          code: { $ifNull: ['$diningcoupons.code', ''] },
        },
        createdAt: 1,
      },
    },
  ];
  const result = await RestaurantExpense.aggregate(query);
  return result;
};

module.exports = {
  saveExpense,
  getInitialResponse,
  getExpenseList,
  exportCollection,
};

