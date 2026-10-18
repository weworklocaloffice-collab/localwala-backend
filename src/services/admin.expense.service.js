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

const { AdminExpense } = require('../models');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const saveExpense = async (param) => {
  const expenseData = new AdminExpense({
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
    user: param && param.user && param.user !== null && param.user !== '' ? param.user : null,
    amount:
      param && param.amount && param.amount !== null && param.amount !== '' ? param.amount : 0,
  });
  await AdminExpense.create(expenseData);
  return { success: true };
};

const getInitialResponse = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
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
  const results = await AdminExpense.aggregate(query);
  const resultCount = await AdminExpense.aggregate(countQuery);
  const totalResults = checkArrayNotEmpty(resultCount) ? resultCount[0].totalCount : 0;

  const totalExpense = await AdminExpense.aggregate([
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

  const couponExpense = await AdminExpense.aggregate([
    {
      $match: {
        expenseType: 'coupon',
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

  const deliveryChargeExpense = await AdminExpense.aggregate([
    {
      $match: {
        expenseType: 'delivery_charge',
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

  const referralChargeExpense = await AdminExpense.aggregate([
    {
      $match: {
        expenseType: 'referral',
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

  const walletBonusExpense = await AdminExpense.aggregate([
    {
      $match: {
        expenseType: 'wallet_bonus',
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

  const loyaltyPointsExpense = await AdminExpense.aggregate([
    {
      $match: {
        expenseType: 'loyalty_points',
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

  const diningCouponExpense = await AdminExpense.aggregate([
    {
      $match: {
        expenseType: 'dining_booking_coupon',
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

  const walletCreditExpense = await AdminExpense.aggregate([
    {
      $match: {
        expenseType: 'customer_wallet_credit',
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

  const itSupportExpense = await AdminExpense.aggregate([
    {
      $match: {
        expenseType: 'it_support_service',
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

  const adsExpense = await AdminExpense.aggregate([
    {
      $match: {
        expenseType: 'ads',
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

  const employeeExpense = await AdminExpense.aggregate([
    {
      $match: {
        expenseType: 'employee_expenses',
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

  const outSourceExpense = await AdminExpense.aggregate([
    {
      $match: {
        expenseType: 'outsource',
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

  const paymentGatewayChargeExpense = await AdminExpense.aggregate([
    {
      $match: {
        expenseType: 'payment_gateway_charge',
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

  const otherExpense = await AdminExpense.aggregate([
    {
      $match: {
        expenseType: 'other',
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
    couponExpense,
    deliveryChargeExpense,
    referralChargeExpense,
    walletBonusExpense,
    loyaltyPointsExpense,
    diningCouponExpense,
    walletCreditExpense,
    itSupportExpense,
    adsExpense,
    employeeExpense,
    outSourceExpense,
    paymentGatewayChargeExpense,
    otherExpense,
  ]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const totalExpenseData = {
      count: 0,
      amount: 0,
    };
    const couponExpenseData = {
      count: 0,
      amount: 0,
    };
    const deliveryChargeExpenseData = {
      count: 0,
      amount: 0,
    };
    const referralChargeExpenseData = {
      count: 0,
      amount: 0,
    };
    const walletBonusExpenseData = {
      count: 0,
      amount: 0,
    };
    const loyaltyPointsExpenseData = {
      count: 0,
      amount: 0,
    };
    const diningCouponExpenseData = {
      count: 0,
      amount: 0,
    };
    const walletCreditExpenseData = {
      count: 0,
      amount: 0,
    };
    const itSupportExpenseData = {
      count: 0,
      amount: 0,
    };
    const adsExpenseData = {
      count: 0,
      amount: 0,
    };
    const employeeExpenseData = {
      count: 0,
      amount: 0,
    };
    const outSourceExpenseData = {
      count: 0,
      amount: 0,
    };
    const paymentGatewayChargeExpenseData = {
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
    if (checkArrayNotEmpty(couponExpense)) {
      couponExpenseData.count = couponExpense[0].count;
      couponExpenseData.amount = couponExpense[0].amount;
    }
    if (checkArrayNotEmpty(deliveryChargeExpense)) {
      deliveryChargeExpenseData.count = deliveryChargeExpense[0].count;
      deliveryChargeExpenseData.amount = deliveryChargeExpense[0].amount;
    }
    if (checkArrayNotEmpty(referralChargeExpense)) {
      referralChargeExpenseData.count = referralChargeExpense[0].count;
      referralChargeExpenseData.amount = referralChargeExpense[0].amount;
    }
    if (checkArrayNotEmpty(walletBonusExpense)) {
      walletBonusExpenseData.count = walletBonusExpense[0].count;
      walletBonusExpenseData.amount = walletBonusExpense[0].amount;
    }
    if (checkArrayNotEmpty(loyaltyPointsExpense)) {
      loyaltyPointsExpenseData.count = loyaltyPointsExpense[0].count;
      loyaltyPointsExpenseData.amount = loyaltyPointsExpense[0].amount;
    }
    if (checkArrayNotEmpty(diningCouponExpense)) {
      diningCouponExpenseData.count = diningCouponExpense[0].count;
      diningCouponExpenseData.amount = diningCouponExpense[0].amount;
    }
    if (checkArrayNotEmpty(walletCreditExpense)) {
      walletCreditExpenseData.count = walletCreditExpense[0].count;
      walletCreditExpenseData.amount = walletCreditExpense[0].amount;
    }
    if (checkArrayNotEmpty(itSupportExpense)) {
      itSupportExpenseData.count = itSupportExpense[0].count;
      itSupportExpenseData.amount = itSupportExpense[0].amount;
    }
    if (checkArrayNotEmpty(adsExpense)) {
      adsExpenseData.count = adsExpense[0].count;
      adsExpenseData.amount = adsExpense[0].amount;
    }
    if (checkArrayNotEmpty(employeeExpense)) {
      employeeExpenseData.count = employeeExpense[0].count;
      employeeExpenseData.amount = employeeExpense[0].amount;
    }
    if (checkArrayNotEmpty(outSourceExpense)) {
      outSourceExpenseData.count = outSourceExpense[0].count;
      outSourceExpenseData.amount = outSourceExpense[0].amount;
    }
    if (checkArrayNotEmpty(paymentGatewayChargeExpense)) {
      paymentGatewayChargeExpenseData.count = paymentGatewayChargeExpense[0].count;
      paymentGatewayChargeExpenseData.amount = paymentGatewayChargeExpense[0].amount;
    }
    if (checkArrayNotEmpty(otherExpense)) {
      otherExpenseData.count = otherExpense[0].count;
      otherExpenseData.amount = otherExpense[0].amount;
    }
    const result = {
      totalExpenseData,
      couponExpenseData,
      deliveryChargeExpenseData,
      referralChargeExpenseData,
      walletBonusExpenseData,
      loyaltyPointsExpenseData,
      diningCouponExpenseData,
      walletCreditExpenseData,
      itSupportExpenseData,
      adsExpenseData,
      employeeExpenseData,
      outSourceExpenseData,
      paymentGatewayChargeExpenseData,
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
  const results = await AdminExpense.aggregate(query);
  const resultCount = await AdminExpense.aggregate(countQuery);
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

const exportQueryCollection = async (type) => {
  const matchQuery = {
    $match:
      type !== null && type !== 'all' ? { expenseType: type } : { expenseType: { $ne: null } },
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
        bookingInfo: {
          id: { $ifNull: ['$diningbookings._id', ''] },
        },
        couponInfo: {
          id: { $ifNull: ['$coupons._id', ''] },
          name: { $ifNull: ['$coupons.name', ''] },
          code: { $ifNull: ['$coupons.code', ''] },
        },
        diningCouponInfo: {
          id: { $ifNull: ['$diningcoupons._id', ''] },
          name: { $ifNull: ['$diningcoupons.name', ''] },
          code: { $ifNull: ['$diningcoupons.code', ''] },
        },
        createdAt: 1,
      },
    },
  ];
  const result = await AdminExpense.aggregate(query);
  return result;
};

const exportQueryRawCollection = async (type) => {
  const results = await AdminExpense.find(
    type !== null && type !== 'all' ? { expenseType: type } : { expenseType: { $ne: null } }
  ).lean();
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    const expenseTypeExist = [
      'coupon',
      'delivery_charge',
      'referral',
      'wallet_bonus',
      'loyalty_points',
      'dining_booking_coupon',
      'customer_wallet_credit',
      'it_support_service',
      'ads',
      'employee_expenses',
      'outsource',
      'payment_gateway_charge',
      'other',
    ];
    importArray.forEach(async (param) => {
      if (expenseTypeExist.includes(param.expenseType)) {
        const expenseData = new AdminExpense({
          expenseType: param.expenseType,
          coupon:
            param &&
            param.coupon &&
            param.coupon !== null &&
            param.coupon !== '' &&
            param.coupon !== '-'
              ? param.coupon
              : null,
          diningCoupon:
            param &&
            param.diningCoupon &&
            param.diningCoupon !== null &&
            param.diningCoupon !== '' &&
            param.diningCoupon !== '-'
              ? param.diningCoupon
              : null,
          diningBooking:
            param &&
            param.diningBooking &&
            param.diningBooking !== null &&
            param.diningBooking !== '' &&
            param.diningBooking !== '-'
              ? param.diningBooking
              : null,
          order:
            param &&
            param.order &&
            param.order !== null &&
            param.order !== '' &&
            param.order !== '-'
              ? param.order
              : null,
          user:
            param && param.user && param.user !== null && param.user !== '' && param.user !== '-'
              ? param.user
              : null,
          amount:
            param && param.amount && param.amount !== null && param.amount !== ''
              ? param.amount
              : 0,
        });
        await AdminExpense.create(expenseData);
      }
    });
  }
  return { success: true };
};

module.exports = {
  saveExpense,
  getInitialResponse,
  getExpenseList,
  exportQueryCollection,
  exportQueryRawCollection,
  importCollection,
};

