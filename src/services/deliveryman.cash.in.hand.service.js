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
const { DeliverymanCashInHand, DriverSettings, User, Driver, CollectCash } = require('../models');

const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const saveCashInHand = async (param) => {
  const deliverymanCashInHandData = new DeliverymanCashInHand({
    orders: param.orders,
    payment: param.payment,
    deliveryman: param.deliveryman,
    grandTotal: param.grandTotal,
  });
  await DeliverymanCashInHand.create(deliverymanCashInHandData);
  const pipeline = [
    { $match: { deliveryman: new mongoose.Types.ObjectId(param.deliveryman), status: true } },
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
  const totalCashInHand = await DeliverymanCashInHand.aggregate(pipeline);
  if (
    totalCashInHand !== null &&
    totalCashInHand.length > 0 &&
    checkArrayNotEmpty(totalCashInHand)
  ) {
    const inHandAmount = parseFloat(totalCashInHand[0].inHandAmount);
    const driverSettigns = await DriverSettings.findOne(
      {},
      { cashInHand: 1, minCashInHand: 1, maxCashInHand: 1 }
    );
    if (driverSettigns && driverSettigns !== null) {
      if (
        driverSettigns &&
        driverSettigns.cashInHand !== null &&
        driverSettigns.cashInHand === true
      ) {
        const maxCashInHand = parseFloat(driverSettigns.maxCashInHand);
        if (inHandAmount >= maxCashInHand) {
          const driverUserInfo = await User.findById(param.deliveryman);
          const driverInfo = await Driver.findOne({
            userId: new mongoose.Types.ObjectId(param.deliveryman),
          });
          if (driverUserInfo && driverUserInfo !== null) {
            const restaurantSuspendData = {
              status: false,
            };
            Object.assign(driverUserInfo, restaurantSuspendData);
            await driverUserInfo.save();
          }
          if (driverInfo && driverInfo !== null) {
            const restaurantSuspendData = {
              status: false,
            };
            Object.assign(driverInfo, restaurantSuspendData);
            await driverInfo.save();
          }
        }
      }
    }
  }
};

const getDeliverymanCashInHand = async (deliveryman) => {
  const cashInHandQuery = [
    {
      $match: { deliveryman: new mongoose.Types.ObjectId(deliveryman), status: true },
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
        orderInfo: {
          id: { $ifNull: ['$orders._id', ''] },
          grandTotal: { $round: [{ $divide: ['$orders.grandTotal', 100] }, 2] },
        },
      },
    },
  ];
  const cashInHand = await DeliverymanCashInHand.aggregate(cashInHandQuery);
  let cashInHandAmount = 0;
  let isSuccess = false;
  if (cashInHand !== null && cashInHand.length > 0 && checkArrayNotEmpty(cashInHand)) {
    cashInHand.forEach((order) => {
      if (order !== null && order.orderInfo && order.orderInfo.id !== null) {
        cashInHandAmount += parseFloat(order.orderInfo.grandTotal);
      }
    });
    isSuccess = true;
  }
  cashInHandAmount = parseFloat(cashInHandAmount).toFixed(2);
  return { cashInHandAmount, success: isSuccess };
};

const clearCashInHand = async (deliveryman, method, reference) => {
  const cashInHandQuery = [
    {
      $match: { deliveryman: new mongoose.Types.ObjectId(deliveryman), status: true },
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
        orderInfo: {
          id: { $ifNull: ['$orders._id', ''] },
          grandTotal: { $round: [{ $divide: ['$orders.grandTotal', 100] }, 2] },
        },
      },
    },
  ];
  const cashInHand = await DeliverymanCashInHand.aggregate(cashInHandQuery);
  let cashInHandAmount = 0;
  let isSuccess = false;
  if (cashInHand !== null && cashInHand.length > 0 && checkArrayNotEmpty(cashInHand)) {
    cashInHand.forEach((order) => {
      if (order !== null && order.orderInfo && order.orderInfo.id !== null) {
        cashInHandAmount += parseFloat(order.orderInfo.grandTotal);
      }
    });
    isSuccess = true;
  }
  if (isSuccess) {
    await DeliverymanCashInHand.updateMany(
      { deliveryman: new mongoose.Types.ObjectId(deliveryman), status: true },
      { $set: { status: false } }
    );
    const collectCashParam = {
      from: 'deliveryman',
      deliveryman: `${deliveryman}`,
      cashCollected: cashInHandAmount,
      walletAmount: 0,
      method: `${method}`,
      reference: `${reference}`,
    };
    await CollectCash.create(collectCashParam);
    return { success: isSuccess };
  }
  return { success: isSuccess };
};

const getDeliveryDepositeDetail = async (deliveryman, options) => {
  const cashInHandQueryTotal = [
    {
      $match: { deliveryman: new mongoose.Types.ObjectId(deliveryman), status: true },
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
        orderInfo: {
          id: { $ifNull: ['$orders._id', ''] },
          orderNo: { $ifNull: ['$orders.orderNo', 0] },
          grandTotal: { $round: [{ $divide: ['$orders.grandTotal', 100] }, 2] },
        },
      },
    },
  ];
  const cashInHand = await DeliverymanCashInHand.aggregate(cashInHandQueryTotal);

  let cashInHandAmount = 0;
  if (cashInHand !== null && cashInHand.length > 0 && checkArrayNotEmpty(cashInHand)) {
    cashInHand.forEach((order) => {
      if (order !== null && order.orderInfo && order.orderInfo.id !== null) {
        cashInHandAmount += parseFloat(order.orderInfo.grandTotal);
      }
    });
  }
  cashInHandAmount = parseFloat(cashInHandAmount).toFixed(2);

  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;

  const cashInHandHistoryQuery = [
    {
      $match: { deliveryman: new mongoose.Types.ObjectId(deliveryman) },
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
          grandTotal: { $round: [{ $divide: ['$orders.grandTotal', 100] }, 2] },
        },
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const history = await DeliverymanCashInHand.aggregate(cashInHandHistoryQuery);
  const totalHistoryResults = await DeliverymanCashInHand.countDocuments({
    deliveryman: new mongoose.Types.ObjectId(deliveryman),
  });

  const collectedCashInHandQuery = [
    {
      $match: { deliveryman: new mongoose.Types.ObjectId(deliveryman), from: 'deliveryman' },
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
  const totalCollectedResults = await CollectCash.countDocuments({
    deliveryman: new mongoose.Types.ObjectId(deliveryman),
    from: 'deliveryman',
  });
  return Promise.all([
    cashInHandAmount,
    history,
    totalHistoryResults,
    collected,
    totalCollectedResults,
  ]).then(() => {
    const totalHistoryPages = Math.ceil(totalHistoryResults / limit);
    const totalCollectedPages = Math.ceil(totalCollectedResults / limit);
    const result = {
      cashInHandAmount,
      history,
      collected,
      page,
      limit,
      totalHistoryPages,
      totalHistoryResults,
      totalCollectedPages,
      totalCollectedResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

module.exports = {
  saveCashInHand,
  getDeliverymanCashInHand,
  clearCashInHand,
  getDeliveryDepositeDetail,
};

