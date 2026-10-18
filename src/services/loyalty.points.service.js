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
const { LoyaltyPoints, UserSettings, Wallet, Transactions, AdminExpense } = require('../models');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const saveLoyaltyPoint = async (param) => {
  const loyaltyPointsData = new LoyaltyPoints({
    user: param.user,
    orderId: param.orderId,
    coupon: param && param.coupon !== null && param.coupon !== '' ? param.coupon : null,
    loyaltyPointValue: param.loyaltyPointValue,
    redeemFrom: param.redeemFrom,
    redeemedToWallet: false,
  });
  return LoyaltyPoints.create(loyaltyPointsData);
};

const getLoyaltyPointsData = async (userId) => {
  const userSettings = await UserSettings.findOne(
    {},
    {
      canEarnLoyaltyPointOnOrder: 1,
      loyaltyMinOrderTotal: 1,
      loyaltyPointValue: 1,
      minLoyaltyPointToRedeem: 1,
      priceOfOneLoyaltyPoint: 1,
    }
  );
  if (userSettings !== null && userSettings.id !== null) {
    const transactionQuary = [
      { $match: { user: new mongoose.Types.ObjectId(userId), redeemedToWallet: false } },
      {
        $project: {
          _id: 0,
          id: '$_id',
          redeemFrom: 1,
          loyaltyPointValue: {
            $round: [{ $divide: ['$loyaltyPointValue', 100] }, 2],
          },
          orderId: 1,
          coupon: 1,
          redeemedToWallet: 1,
          status: 1,
          createdAt: 1,
        },
      },
    ];
    const activePoints = await LoyaltyPoints.aggregate(transactionQuary);
    let totalPoints = 0;
    let canEarnInWallet = 0;
    if (activePoints !== null && activePoints.length > 0) {
      const pipeline = [
        { $match: { user: new mongoose.Types.ObjectId(userId), redeemedToWallet: false } },
        {
          $group: {
            _id: null,
            totalSum: { $sum: '$loyaltyPointValue' },
          },
        },
        {
          $project: {
            _id: 0,
            totalPointsValue: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
          },
        },
      ];
      const sumOfActivePoints = await LoyaltyPoints.aggregate(pipeline);
      if (sumOfActivePoints !== null && sumOfActivePoints.length > 0) {
        totalPoints = sumOfActivePoints[0].totalPointsValue;
        if (
          totalPoints > 0 &&
          userSettings !== null &&
          userSettings.canEarnLoyaltyPointOnOrder === true &&
          userSettings.priceOfOneLoyaltyPoint > 0
        ) {
          canEarnInWallet = totalPoints / userSettings.priceOfOneLoyaltyPoint;
        }
      }
    }
    return Promise.all([activePoints, userSettings, totalPoints, canEarnInWallet]).then(() => {
      const result = {
        activePoints,
        userSettings,
        totalPoints,
        canEarnInWallet,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const redeemPoints = async (redeemData) => {
  const userSettings = await UserSettings.findOne(
    {},
    {
      canEarnLoyaltyPointOnOrder: 1,
      loyaltyMinOrderTotal: 1,
      loyaltyPointValue: 1,
      minLoyaltyPointToRedeem: 1,
      priceOfOneLoyaltyPoint: 1,
    }
  );
  const ids = redeemData.ids.map((id) => new mongoose.Types.ObjectId(id));
  if (userSettings !== null && userSettings.id !== null) {
    const pipeline = [
      {
        $match: {
          user: new mongoose.Types.ObjectId(redeemData.user),
          _id: { $in: ids },
          redeemedToWallet: false,
        },
      },
      {
        $group: {
          _id: null,
          totalSum: { $sum: '$loyaltyPointValue' },
        },
      },
      {
        $project: {
          _id: 0,
          totalPointsValue: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
        },
      },
    ];
    let totalPoints = 0;
    let canEarnInWallet = 0;
    const sumOfActivePoints = await LoyaltyPoints.aggregate(pipeline);
    if (sumOfActivePoints !== null && sumOfActivePoints.length > 0) {
      totalPoints = sumOfActivePoints[0].totalPointsValue;
      if (
        totalPoints > 0 &&
        userSettings !== null &&
        userSettings.canEarnLoyaltyPointOnOrder === true &&
        userSettings.priceOfOneLoyaltyPoint > 0
      ) {
        canEarnInWallet = totalPoints / userSettings.priceOfOneLoyaltyPoint;
        const walletInfo = await Wallet.findOne({
          holderId: new mongoose.Types.ObjectId(redeemData.user),
        });
        if (walletInfo !== null && walletInfo.id !== null) {
          const oldBalance = walletInfo.balance;
          const userWalletId = walletInfo.id;
          const newBalance = parseFloat(oldBalance) + parseFloat(canEarnInWallet);
          Object.assign(walletInfo, { balance: newBalance });
          await walletInfo.save();
          const transactionBody = {
            payableId: redeemData.user,
            walletId: userWalletId,
            type: 'deposite',
            amount: canEarnInWallet,
            confirmed: true,
            meta: [{ reason: `Loyalty Points Redeemed ${ids}` }],
            status: true,
          };
          await Transactions.create(transactionBody);
          await LoyaltyPoints.updateMany(
            { _id: { $in: ids } },
            {
              $set: {
                redeemedToWallet: true,
              },
            }
          );
          const expenseData = new AdminExpense({
            expenseType: `loyalty_points`,
            coupon: null,
            diningCoupon: null,
            diningBooking: null,
            order: null,
            user: redeemData.user,
            amount: `${canEarnInWallet}`,
          });
          await AdminExpense.create(expenseData);
        }
        return { success: true };
      }
      return { success: false };
    }
    return { success: false };
  }
  return { success: false };
};

const loyalityPointReport = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const filter = options.filter === 'true' || options.filter === true;
  const filterStatus = options.status === 'true' || options.status === true;
  const searchRegExp = RegExp(options.search, 'i');
  const matchQuery = {
    $match: filter
      ? { redeemFrom: { $in: [options.type] }, redeemedToWallet: filterStatus }
      : { redeemFrom: { $in: ['order', 'coupon'] }, redeemedToWallet: { $in: [true, false] } },
  };
  if (filter) {
    if (options.range !== '-') {
      const dateRangeArray = options.range.split('-');

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
  matchQuery.$match.$or = [
    { 'users.firstName': searchRegExp },
    { 'users.lastName': searchRegExp },
  ].filter(Boolean);
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
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    matchQuery,
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        redeemFrom: 1,
        redeemedToWallet: 1,
        orderId: 1,
        coupon: 1,
        createdAt: 1,
        loyaltyPointValue: {
          $round: [{ $divide: ['$loyaltyPointValue', 100] }, 2],
        },
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
        },
      },
    },
  ];
  const results = await LoyaltyPoints.aggregate(query);
  const countResult = await LoyaltyPoints.aggregate([
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
    matchQuery,
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

const exportCollection = async (options) => {
  const filter = options.filter === 'true' || options.filter === true;
  const filterStatus = options.status === 'true' || options.status === true;
  const searchRegExp = RegExp(options.search, 'i');
  const matchQuery = {
    $match: filter
      ? { redeemFrom: { $in: [options.filterType] }, redeemedToWallet: filterStatus }
      : { redeemFrom: { $in: ['order', 'coupon'] }, redeemedToWallet: { $in: [true, false] } },
  };
  if (filter) {
    if (options.range !== '-') {
      const dateRangeArray = options.range.split('-');

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
  matchQuery.$match.$or = [
    { 'users.firstName': searchRegExp },
    { 'users.lastName': searchRegExp },
  ].filter(Boolean);
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
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    matchQuery,
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        redeemFrom: 1,
        redeemedToWallet: 1,
        orderId: 1,
        coupon: 1,
        createdAt: 1,
        loyaltyPointValue: {
          $round: [{ $divide: ['$loyaltyPointValue', 100] }, 2],
        },
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
        },
      },
    },
  ];
  const result = await LoyaltyPoints.aggregate(query);
  return result;
};

const exportRawCollection = async (options) => {
  const filter = options.filter === 'true' || options.filter === true;
  const filterStatus = options.status === 'true' || options.status === true;
  const searchRegExp = RegExp(options.search, 'i');
  const matchQuery = {
    $match: filter
      ? { redeemFrom: { $in: [options.filterType] }, redeemedToWallet: filterStatus }
      : { redeemFrom: { $in: ['order', 'coupon'] }, redeemedToWallet: { $in: [true, false] } },
  };
  if (filter) {
    if (options.range !== '-') {
      const dateRangeArray = options.range.split('-');

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
  matchQuery.$match.$or = [
    { 'users.firstName': searchRegExp },
    { 'users.lastName': searchRegExp },
  ].filter(Boolean);
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
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    matchQuery,
    {
      $project: {
        users: 0,
      },
    },
  ];
  const results = await LoyaltyPoints.aggregate(query);
  return results;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const loyaltyPointsData = new LoyaltyPoints({
        user: param && param.user && param.user !== null && param.user !== '' ? param.user : null,
        orderId:
          param &&
          param.orderId &&
          param.orderId !== null &&
          param.orderId !== '' &&
          param.orderId !== '-'
            ? param.orderId
            : null,
        coupon:
          param &&
          param.coupon &&
          param.coupon !== null &&
          param.coupon !== '' &&
          param.coupon !== '-'
            ? param.coupon
            : null,
        loyaltyPointValue:
          param && param.loyaltyPointValue !== null && param.loyaltyPointValue !== ''
            ? param.loyaltyPointValue
            : 0,
        redeemFrom:
          param && param.redeemFrom && param.redeemFrom !== null && param.redeemFrom === 'coupon'
            ? 'coupon'
            : 'order',
        redeemedToWallet:
          param && (param.redeemedToWallet === 'Yes' || param.redeemedToWallet === 'yes'),
      });
      await LoyaltyPoints.create(loyaltyPointsData);
    });
  }
  return { success: true };
};

module.exports = {
  saveLoyaltyPoint,
  getLoyaltyPointsData,
  redeemPoints,
  loyalityPointReport,
  exportCollection,
  exportRawCollection,
  importCollection,
};

