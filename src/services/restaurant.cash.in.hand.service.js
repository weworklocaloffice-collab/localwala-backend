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
const {
  RestaurantCashInHand,
  RestaurantSettings,
  Restaurant,
  Wallet,
  Transactions,
  CollectCash,
  RestaurantPosTableOrderCommission,
} = require('../models');

const restaurantService = require('./restaurant.service');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const saveCashInHand = async (param) => {
  const restaurantInfo = await Restaurant.findById(param.restaurant);
  let type = 'commission';
  let commission = 0;
  if (
    restaurantInfo !== null &&
    restaurantInfo.type === 'derived' &&
    restaurantInfo.isOutlet === true &&
    restaurantInfo.outletManagerId !== null
  ) {
    const outletManager = await restaurantService.getRestaurantManagerTypeAndCommission(
      restaurantInfo.outletManagerId
    );
    if (outletManager !== null && outletManager.id !== null) {
      type = outletManager.type;
      commission = outletManager.commission;
    }
  } else {
    type = restaurantInfo.type;
    commission = restaurantInfo.commission;
  }
  if (restaurantInfo && restaurantInfo !== null) {
    const cashInHandData = new RestaurantCashInHand({
      orders: param.orders,
      payment: param.payment,
      restaurant: param.restaurant,
      grandTotal: param.grandTotal,
      restaurantType: `${type}`,
      commission: `${commission}`,
    });
    await RestaurantCashInHand.create(cashInHandData);
    const pipeline = [
      { $match: { restaurant: new mongoose.Types.ObjectId(param.restaurant), status: true } },
      {
        $group: {
          _id: null,
          totalSum: { $sum: '$grandTotal' },
        },
      },
      {
        $project: {
          _id: 0,
          inHandAmount: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
        },
      },
    ];
    const totalCashInHand = await RestaurantCashInHand.aggregate(pipeline);
    if (
      totalCashInHand !== null &&
      totalCashInHand.length > 0 &&
      checkArrayNotEmpty(totalCashInHand)
    ) {
      const inHandAmount = parseFloat(totalCashInHand[0].inHandAmount);
      const restaurantSettings = await RestaurantSettings.findOne(
        {},
        { cashInHand: 1, minCashInHand: 1, maxCashInHand: 1 }
      );
      if (restaurantSettings && restaurantSettings !== null) {
        if (
          restaurantSettings &&
          restaurantSettings.cashInHand !== null &&
          restaurantSettings.cashInHand === true
        ) {
          const maxCashInHand = parseFloat(restaurantSettings.maxCashInHand);
          if (inHandAmount >= maxCashInHand) {
            if (restaurantInfo && restaurantInfo !== null) {
              const restaurantSuspendData = {
                status: false,
              };
              Object.assign(restaurantInfo, restaurantSuspendData);
              await restaurantInfo.save();
            }
          }
        }
      }
    }
  }
};

const getRestaurantCashInHand = async (vendor) => {
  const cashInHandQuery = [
    {
      $match: { restaurant: new mongoose.Types.ObjectId(vendor), status: true },
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
      $project: {
        _id: 0,
        id: '$_id',
        restaurantType: 1,
        commission: 1,
        orderInfo: {
          id: { $ifNull: ['$orders._id', ''] },
          deliveryCharge: { $round: [{ $divide: ['$orders.deliveryCharge', 100] }, 2] },
          itemTotal: { $round: [{ $divide: ['$orders.itemTotal', 100] }, 2] },
          grandTotal: { $round: [{ $divide: ['$orders.grandTotal', 100] }, 2] },
          packageCharge: { $round: [{ $divide: ['$orders.packageCharge', 100] }, 2] },
          packageChargeTax: { $round: [{ $divide: ['$orders.packageChargeTax', 100] }, 2] },
        },
      },
    },
  ];
  const posAndTableOrderCommissionQuery = [
    { $match: { restaurant: new mongoose.Types.ObjectId(vendor), status: true } },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$totalEarning' },
      },
    },
    {
      $project: {
        _id: 0,
        commission: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
      },
    },
  ];
  const cashInHand = await RestaurantCashInHand.aggregate(cashInHandQuery);
  const posAndTableOrderCommission = await RestaurantPosTableOrderCommission.aggregate(
    posAndTableOrderCommissionQuery
  );
  let totalCashInHand = 0;
  let creditAmount = 0;
  if (cashInHand !== null && cashInHand.length > 0 && checkArrayNotEmpty(cashInHand)) {
    cashInHand.forEach((order) => {
      if (
        order !== null &&
        order.orderInfo &&
        order.orderInfo.id !== null &&
        order.orderInfo.id !== ''
      ) {
        totalCashInHand += parseFloat(order.orderInfo.grandTotal);
        if (order !== null && order.id) {
          const restaurantEarning = parseFloat(
            parseFloat(order.orderInfo.itemTotal) +
              parseFloat(order.orderInfo.packageCharge) +
              parseFloat(order.orderInfo.packageChargeTax)
          );
          const taxDeductionAmount = parseFloat(
            (parseFloat(restaurantEarning) * parseFloat(order.commission)) / 100
          ).toFixed(2);
          const restaurantEarningAfterDeduction = parseFloat(
            parseFloat(restaurantEarning) - parseFloat(taxDeductionAmount)
          ).toFixed(2);
          creditAmount += parseFloat(restaurantEarningAfterDeduction);
        }
      }
    });
  }
  let posAndTableOrderCommissionAmount = 0;
  if (
    posAndTableOrderCommission !== null &&
    posAndTableOrderCommission.length > 0 &&
    checkArrayNotEmpty(posAndTableOrderCommission)
  ) {
    posAndTableOrderCommissionAmount = parseFloat(posAndTableOrderCommission[0].commission);
  }
  const cashInHandAmount = parseFloat(
    parseFloat(totalCashInHand) + parseFloat(posAndTableOrderCommissionAmount)
  ).toFixed(2);
  creditAmount = parseFloat(creditAmount).toFixed(2);
  return { cashInHandAmount, creditAmount, success: true };
};

const clearCashInHandAndUpdateWallet = async (vendor, method, reference) => {
  const cashInHandQuery = [
    {
      $match: { restaurant: new mongoose.Types.ObjectId(vendor), status: true },
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
      $project: {
        _id: 0,
        id: '$_id',
        restaurantType: 1,
        commission: 1,
        orderInfo: {
          id: { $ifNull: ['$orders._id', ''] },
          deliveryCharge: { $round: [{ $divide: ['$orders.deliveryCharge', 100] }, 2] },
          itemTotal: { $round: [{ $divide: ['$orders.itemTotal', 100] }, 2] },
          grandTotal: { $round: [{ $divide: ['$orders.grandTotal', 100] }, 2] },
          packageCharge: { $round: [{ $divide: ['$orders.packageCharge', 100] }, 2] },
          packageChargeTax: { $round: [{ $divide: ['$orders.packageChargeTax', 100] }, 2] },
        },
      },
    },
  ];
  const posAndTableOrderCommissionQuery = [
    { $match: { restaurant: new mongoose.Types.ObjectId(vendor), status: true } },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$totalEarning' },
      },
    },
    {
      $project: {
        _id: 0,
        commission: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
      },
    },
  ];
  const cashInHand = await RestaurantCashInHand.aggregate(cashInHandQuery);
  const posAndTableOrderCommission = await RestaurantPosTableOrderCommission.aggregate(
    posAndTableOrderCommissionQuery
  );
  let totalCashInHand = 0;
  let creditAmount = 0;
  let isSuccess = false;
  if (cashInHand !== null && cashInHand.length > 0 && checkArrayNotEmpty(cashInHand)) {
    cashInHand.forEach((order) => {
      if (
        order !== null &&
        order.orderInfo &&
        order.orderInfo.id !== null &&
        order.orderInfo.id !== ''
      ) {
        totalCashInHand += parseFloat(order.orderInfo.grandTotal);
        if (order !== null && order.id) {
          const restaurantEarning = parseFloat(
            parseFloat(order.orderInfo.itemTotal) +
              parseFloat(order.orderInfo.packageCharge) +
              parseFloat(order.orderInfo.packageChargeTax)
          );
          const taxDeductionAmount = parseFloat(
            (parseFloat(restaurantEarning) * parseFloat(order.commission)) / 100
          ).toFixed(2);
          const restaurantEarningAfterDeduction = parseFloat(
            parseFloat(restaurantEarning) - parseFloat(taxDeductionAmount)
          ).toFixed(2);
          creditAmount += parseFloat(restaurantEarningAfterDeduction);
        }
      }
    });
    isSuccess = true;
  }
  let posAndTableOrderCommissionAmount = 0;
  if (
    posAndTableOrderCommission !== null &&
    posAndTableOrderCommission.length > 0 &&
    checkArrayNotEmpty(posAndTableOrderCommission)
  ) {
    posAndTableOrderCommissionAmount = parseFloat(posAndTableOrderCommission[0].commission);
    isSuccess = true;
  }
  if (isSuccess) {
    creditAmount = parseFloat(creditAmount).toFixed(2);
    const restaurant = await Restaurant.findById(vendor);
    const walletInfo = await Wallet.findOne({
      holderId: new mongoose.Types.ObjectId(restaurant.userId),
    });
    if (walletInfo !== null && walletInfo.id !== null) {
      const oldBalance = walletInfo.balance;
      const userWalletId = walletInfo.id;
      const newBalance = parseFloat(parseFloat(oldBalance) + parseFloat(creditAmount)).toFixed(2);
      Object.assign(walletInfo, { balance: newBalance });
      await walletInfo.save();
      const transactionBody = {
        payableId: restaurant.userId,
        walletId: userWalletId,
        type: 'deposite',
        amount: creditAmount,
        confirmed: true,
        meta: [{ reason: `CashInHandClear Method:${method} Reference:${reference}` }],
        status: true,
      };
      await Transactions.create(transactionBody);
      await RestaurantCashInHand.updateMany(
        { restaurant: new mongoose.Types.ObjectId(vendor), status: true },
        { $set: { status: false } }
      );
      await RestaurantPosTableOrderCommission.updateMany(
        { restaurant: new mongoose.Types.ObjectId(vendor), status: true },
        { $set: { status: false } }
      );
      const cashInHandAmount = parseFloat(
        parseFloat(totalCashInHand) + parseFloat(posAndTableOrderCommissionAmount)
      ).toFixed(2);
      const collectCashParam = {
        from: 'restaurant',
        restaurant: vendor,
        cashCollected: cashInHandAmount,
        walletAmount: creditAmount,
        method: `${method}`,
        reference: `${reference}`,
      };
      await CollectCash.create(collectCashParam);
    }

    return { success: isSuccess };
  }
  return { success: isSuccess };
};

const cashOnHandHistory = async (vendor, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const cashInHandQuery = [
    {
      $match: { restaurant: new mongoose.Types.ObjectId(vendor) },
    },
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
      $unwind: {
        path: '$orders',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        orderInfo: {
          id: { $ifNull: ['$orders._id', ''] },
          orderNo: { $ifNull: ['$orders.orderNo', 0] },
          grandTotal: { $round: [{ $divide: [{ $ifNull: ['$orders.grandTotal', 0] }, 100] }, 2] },
        },
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const history = await RestaurantCashInHand.aggregate(cashInHandQuery);
  const totalResults = await RestaurantCashInHand.countDocuments({
    restaurant: new mongoose.Types.ObjectId(vendor),
  });
  return Promise.all([history, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      history,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const posAndTableOrderCommissionHistory = async (vendor, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const query = [
    {
      $match: { restaurant: new mongoose.Types.ObjectId(vendor) },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
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
      $project: {
        _id: 0,
        id: '$_id',
        posOrderInfo: {
          id: { $ifNull: ['$posortableorders._id', ''] },
          orderNo: { $ifNull: ['$posortableorders.orderNo', 0] },
          grandTotal: { $round: [{ $divide: ['$posortableorders.grandTotal', 100] }, 2] },
        },
        tableOrderInfo: {
          id: { $ifNull: ['$tableorders._id', ''] },
          orderNo: { $ifNull: ['$tableorders.orderNo', 0] },
          grandTotal: { $round: [{ $divide: ['$tableorders.grandTotal', 100] }, 2] },
        },
        foodServiceCharge: {
          $round: [{ $divide: ['$foodServiceCharge', 100] }, 2],
        },
        serviceCharge: {
          $round: [{ $divide: ['$serviceCharge', 100] }, 2],
        },
        orderCommission: {
          $round: [{ $divide: ['$orderCommission', 100] }, 2],
        },
        totalCommision: {
          $round: [{ $divide: ['$totalEarning', 100] }, 2],
        },
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const history = await RestaurantPosTableOrderCommission.aggregate(query);
  const totalResults = await RestaurantPosTableOrderCommission.countDocuments({
    restaurant: new mongoose.Types.ObjectId(vendor),
  });
  return Promise.all([history, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      history,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cashCollectedHistory = async (vendor, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const collectedCashInHandQuery = [
    {
      $match: { restaurant: new mongoose.Types.ObjectId(vendor), from: 'restaurant' },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        method: 1,
        reference: 1,
        cashCollected: {
          $round: [{ $divide: ['$cashCollected', 100] }, 2],
        },
        walletAmount: {
          $round: [{ $divide: ['$walletAmount', 100] }, 2],
        },
        createdAt: 1,
      },
    },
  ];
  const collected = await CollectCash.aggregate(collectedCashInHandQuery);
  const totalResults = await CollectCash.countDocuments({
    restaurant: new mongoose.Types.ObjectId(vendor),
    from: 'restaurant',
  });
  return Promise.all([collected, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      collected,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

module.exports = {
  saveCashInHand,
  getRestaurantCashInHand,
  clearCashInHandAndUpdateWallet,
  cashOnHandHistory,
  posAndTableOrderCommissionHistory,
  cashCollectedHistory,
};

