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
const {
  Wallet,
  Transactions,
  UserSettings,
  Restaurant,
  RestaurantPayoutMethod,
  DeliverymanPayoutMethod,
  AdminExpense,
} = require('../models');
const ApiError = require('../utils/ApiError');
const transactionService = require('./transaction.service');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createWallet = async (walletBody) => {
  if (await Wallet.isUserExist(walletBody.holderId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  return Wallet.create(walletBody);
};

const getWalletByUserId = async (id) => {
  const info = await Wallet.findOne({ holderId: new mongoose.Types.ObjectId(id) });
  return info;
};

const getWalletById = async (id) => {
  return Wallet.findById(id);
};

const updateWallet = async (walletId, updateBody) => {
  const wallet = await getWalletById(walletId);
  if (!wallet) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }

  Object.assign(wallet, updateBody);
  await wallet.save();
  return wallet;
};

const getMyWalletData = async (userId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const info = await Wallet.findOne({ holderId: new mongoose.Types.ObjectId(userId) });
  const userSettings = await UserSettings.findOne(
    {},
    {
      canEarnBuyFromWallet: 1,
      refundToWallet: 1,
      canAddFundToWallet: 1,
      canEarnLoyaltyPointOnOrder: 1,
    }
  );
  if (info !== null && info.id !== null) {
    const transactionQuary = [
      { $match: { walletId: new mongoose.Types.ObjectId(info.id) } },
      { $skip: skip },
      { $limit: Number(limit) },
      {
        $project: {
          _id: 0,
          id: '$_id',
          type: 1,
          amount: {
            $round: [{ $divide: ['$amount', 100] }, 2],
          },
          uuid: 1,
          confirmed: 1,
          status: 1,
          createdAt: 1,
        },
      },
    ];
    const transaction = await Transactions.aggregate(transactionQuary);
    const totalResults = await Transactions.countDocuments({
      walletId: new mongoose.Types.ObjectId(info.id),
    });
    return Promise.all([transaction, info, totalResults, userSettings]).then(() => {
      const totalPages = Math.ceil(totalResults / limit);
      const result = {
        transaction,
        info,
        page,
        limit,
        totalPages,
        totalResults,
        userSettings,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const vendorWalletTransaction = async (userId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const info = await Wallet.findOne({ holderId: new mongoose.Types.ObjectId(userId) });
  if (info !== null && info.id !== null) {
    const transactionQuary = [
      { $match: { walletId: new mongoose.Types.ObjectId(info.id) } },
      { $skip: skip },
      { $limit: Number(limit) },
      {
        $project: {
          _id: 0,
          id: '$_id',
          type: 1,
          amount: {
            $round: [{ $divide: ['$amount', 100] }, 2],
          },
          uuid: 1,
          confirmed: 1,
          status: 1,
          createdAt: 1,
        },
      },
    ];
    const transaction = await Transactions.aggregate(transactionQuary);
    const totalResults = await Transactions.countDocuments({
      walletId: new mongoose.Types.ObjectId(info.id),
    });
    return Promise.all([transaction, info, totalResults]).then(() => {
      const totalPages = Math.ceil(totalResults / limit);
      const result = {
        transaction,
        page,
        limit,
        totalPages,
        totalResults,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const vendorWalletWithdrawalDetail = async (vendor) => {
  const restaurant = await Restaurant.findById(vendor, { userId: 1 });
  if (!restaurant) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const walletInfo = await Wallet.findOne(
    { holderId: new mongoose.Types.ObjectId(restaurant.userId) },
    { balance: 1, decimalPlaces: 1, uuid: 1, id: 1 }
  );
  const methodQuery = [
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
      },
    },
    {
      $lookup: {
        from: 'withdrawalmethods',
        localField: 'method',
        foreignField: '_id',
        as: 'withdrawalmethods',
      },
    },
    {
      $unwind: {
        path: '$withdrawalmethods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        formElement: 1,
        status: 1,
        method: {
          id: { $ifNull: ['$withdrawalmethods._id', ''] },
          name: { $ifNull: ['$withdrawalmethods.name', ''] },
          translations: { $ifNull: ['$withdrawalmethods.translations', []] },
        },
      },
    },
  ];
  const methods = await RestaurantPayoutMethod.aggregate(methodQuery);
  return Promise.all([restaurant, walletInfo, methods]).then(() => {
    const result = {
      walletInfo,
      methods,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const deliverymanWalletTransaction = async (userId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const info = await Wallet.findOne({ holderId: new mongoose.Types.ObjectId(userId) });
  if (info !== null && info.id !== null) {
    const transactionQuary = [
      { $match: { walletId: new mongoose.Types.ObjectId(info.id) } },
      { $skip: skip },
      { $limit: Number(limit) },
      {
        $project: {
          _id: 0,
          id: '$_id',
          type: 1,
          amount: {
            $round: [{ $divide: ['$amount', 100] }, 2],
          },
          uuid: 1,
          confirmed: 1,
          status: 1,
          createdAt: 1,
        },
      },
    ];
    const transaction = await Transactions.aggregate(transactionQuary);
    const totalResults = await Transactions.countDocuments({
      walletId: new mongoose.Types.ObjectId(info.id),
    });
    return Promise.all([transaction, info, totalResults]).then(() => {
      const totalPages = Math.ceil(totalResults / limit);
      const result = {
        transaction,
        page,
        limit,
        totalPages,
        totalResults,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const deliverymanWalletWithdrawalDetail = async (deliveryman) => {
  const walletInfo = await Wallet.findOne(
    { holderId: new mongoose.Types.ObjectId(deliveryman) },
    { balance: 1, decimalPlaces: 1, uuid: 1, id: 1 }
  );
  const methodQuery = [
    {
      $match: {
        deliveryman: new mongoose.Types.ObjectId(deliveryman),
      },
    },
    {
      $lookup: {
        from: 'withdrawalmethods',
        localField: 'method',
        foreignField: '_id',
        as: 'withdrawalmethods',
      },
    },
    {
      $unwind: {
        path: '$withdrawalmethods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        formElement: 1,
        status: 1,
        method: {
          id: { $ifNull: ['$withdrawalmethods._id', ''] },
          name: { $ifNull: ['$withdrawalmethods.name', ''] },
          translations: { $ifNull: ['$withdrawalmethods.translations', []] },
        },
      },
    },
  ];
  const methods = await DeliverymanPayoutMethod.aggregate(methodQuery);
  return Promise.all([walletInfo, methods]).then(() => {
    const result = {
      walletInfo,
      methods,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const adminAddWalletFund = async (walletId, userId, amount, notes) => {
  const walletInfo = await getWalletById(walletId);
  if (!walletInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const oldBalance = walletInfo.balance;
  const newBalance = parseFloat(parseFloat(oldBalance) + parseFloat(amount)).toFixed(2);
  const newBalanceParam = { balance: newBalance };
  await updateWallet(walletId, newBalanceParam);
  const transactionMeta = [{ reason: notes }];
  await transactionService.saveTransation({
    payableId: userId,
    walletId: `${walletId}`,
    type: 'deposite',
    amount: `${amount}`,
    confirmed: true,
    meta: transactionMeta,
    status: true,
  });
  const expenseData = new AdminExpense({
    expenseType: `customer_wallet_credit`,
    coupon: null,
    diningCoupon: null,
    diningBooking: null,
    order: null,
    user: userId,
    amount: `${amount}`,
  });
  await AdminExpense.create(expenseData);
  return { success: true };
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const { walletId, userId, amount, notes } = param;
      function isValidNonNegativeNumber(value) {
        const number = Number(value);
        return typeof value !== 'boolean' && !Number.isNaN(number) && number >= 0;
      }
      if (
        walletId &&
        walletId !== null &&
        walletId !== '' &&
        userId &&
        userId !== null &&
        userId !== '' &&
        amount &&
        amount !== null &&
        amount !== '' &&
        amount !== '0' &&
        amount !== 0 &&
        isValidNonNegativeNumber(amount)
      ) {
        const walletInfo = await getWalletById(walletId);
        if (
          walletInfo &&
          walletInfo.holderId &&
          walletInfo.holderId !== null &&
          walletInfo.holderId !== ''
        ) {
          const oldBalance = walletInfo.balance;
          const newBalance = parseFloat(parseFloat(oldBalance) + parseFloat(amount)).toFixed(2);
          const newBalanceParam = { balance: newBalance };
          await updateWallet(walletId, newBalanceParam);
          const transactionMeta = [
            { reason: notes && notes !== null && notes !== '' ? notes : 'NA' },
          ];
          await transactionService.saveTransation({
            payableId: userId,
            walletId: `${walletId}`,
            type: 'deposite',
            amount: `${amount}`,
            confirmed: true,
            meta: transactionMeta,
            status: true,
          });
          const expenseData = new AdminExpense({
            expenseType: `customer_wallet_credit`,
            coupon: null,
            diningCoupon: null,
            diningBooking: null,
            order: null,
            user: userId,
            amount: `${amount}`,
          });
          await AdminExpense.create(expenseData);
        }
      }
    });
  }
  return { success: true };
};

const importDeliverymanWalletFundCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    importArray.forEach(async (param) => {
      const { walletId, driverUID, amount, notes } = param;
      function isValidNonNegativeNumber(value) {
        const number = Number(value);
        return typeof value !== 'boolean' && !Number.isNaN(number) && number >= 0;
      }
      if (
        walletId &&
        walletId !== null &&
        walletId !== '' &&
        driverUID &&
        driverUID !== null &&
        driverUID !== '' &&
        amount &&
        amount !== null &&
        amount !== '' &&
        amount !== '0' &&
        amount !== 0 &&
        isValidNonNegativeNumber(amount)
      ) {
        const walletInfo = await getWalletById(walletId);
        if (
          walletInfo &&
          walletInfo.holderId &&
          walletInfo.holderId !== null &&
          walletInfo.holderId !== ''
        ) {
          const oldBalance = walletInfo.balance;
          const newBalance = parseFloat(parseFloat(oldBalance) + parseFloat(amount)).toFixed(2);
          const newBalanceParam = { balance: newBalance };
          await updateWallet(walletId, newBalanceParam);
          const transactionMeta = [
            { reason: notes && notes !== null && notes !== '' ? notes : 'NA' },
          ];
          await transactionService.saveTransation({
            payableId: driverUID,
            walletId: `${walletId}`,
            type: 'deposite',
            amount: `${amount}`,
            confirmed: true,
            meta: transactionMeta,
            status: true,
          });
          const expenseData = new AdminExpense({
            expenseType: `customer_wallet_credit`,
            coupon: null,
            diningCoupon: null,
            diningBooking: null,
            order: null,
            user: driverUID,
            amount: `${amount}`,
          });
          await AdminExpense.create(expenseData);
        }
      }
    });
  }
  return { success: true };
};

module.exports = {
  createWallet,
  getWalletByUserId,
  updateWallet,
  getMyWalletData,
  vendorWalletTransaction,
  vendorWalletWithdrawalDetail,
  deliverymanWalletTransaction,
  deliverymanWalletWithdrawalDetail,
  adminAddWalletFund,
  importCollection,
  importDeliverymanWalletFundCollection,
};

