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
const { DateTime } = require('luxon');
const ApiError = require('../utils/ApiError');
const { PosOrTableOrder, BusinessSettings, User, Restaurant, KitchenOrder } = require('../models');
const fcmNotificationService = require('./fcm.notification.service');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const createOrder = async (param) => {
  const orderCount = await PosOrTableOrder.countDocuments();
  const orderNumber = 100000 + parseInt(orderCount, 10) + 1;
  const orderData = new PosOrTableOrder({
    orderNo: orderNumber,
    foods: param && param.foods && param.foods.length > 0 ? param.foods : [],
    restaurant:
      param && param.restaurant && param.restaurant !== null && param.restaurant !== ''
        ? param.restaurant
        : null,
    paymentMode:
      param && param.paymentMode && param.paymentMode !== null && param.paymentMode !== ''
        ? param.paymentMode
        : 'offline',
    customerType:
      param && param.customerType && param.customerType !== null && param.customerType !== ''
        ? param.customerType
        : 'guest',
    customerName:
      param && param.customerName && param.customerName !== null && param.customerName !== ''
        ? param.customerName
        : 'none',
    customerCountryCode:
      param &&
      param.customerCountryCode &&
      param.customerCountryCode !== null &&
      param.customerCountryCode !== ''
        ? param.customerCountryCode
        : 1,
    customerMobileNumber:
      param &&
      param.customerMobileNumber &&
      param.customerMobileNumber !== null &&
      param.customerMobileNumber !== ''
        ? param.customerMobileNumber
        : '000000000000',
    cartItemRaw:
      param && param.cartItemRaw && param.cartItemRaw !== null && param.cartItemRaw !== ''
        ? param.cartItemRaw
        : '',
    realTotal:
      param && param.realTotal && param.realTotal !== null && param.realTotal !== ''
        ? param.realTotal
        : 0,
    itemTotal:
      param && param.itemTotal && param.itemTotal !== null && param.itemTotal !== ''
        ? param.itemTotal
        : 0,
    itemDiscount:
      param && param.itemDiscount && param.itemDiscount !== null && param.itemDiscount !== ''
        ? param.itemDiscount
        : 0,
    discountType:
      param && param.discountType && param.discountType !== null && param.discountType !== ''
        ? param.discountType
        : 'per',
    discountAmount:
      param && param.discountAmount && param.discountAmount !== null && param.discountAmount !== ''
        ? param.discountAmount
        : 0,
    discountCharge:
      param && param.discountCharge && param.discountCharge !== null && param.discountCharge !== ''
        ? param.discountCharge
        : 0,
    foodServiceCharge:
      param &&
      param.foodServiceCharge &&
      param.foodServiceCharge !== null &&
      param.foodServiceCharge !== ''
        ? param.foodServiceCharge
        : 0,
    serviceCharge:
      param && param.serviceCharge && param.serviceCharge !== null && param.serviceCharge !== ''
        ? param.serviceCharge
        : 0,
    packageCharge:
      param && param.packageCharge && param.packageCharge !== null && param.packageCharge !== ''
        ? param.packageCharge
        : 0,
    packageChargeTax:
      param &&
      param.packageChargeTax &&
      param.packageChargeTax !== null &&
      param.packageChargeTax !== ''
        ? param.packageChargeTax
        : 0,
    waiterTip:
      param && param.waiterTip && param.waiterTip !== null && param.waiterTip !== ''
        ? param.waiterTip
        : 0,
    extraCharge:
      param && param.extraCharge && param.extraCharge !== null && param.extraCharge !== ''
        ? param.extraCharge
        : 0,
    restaurantCommission:
      param &&
      param.restaurantCommission &&
      param.restaurantCommission !== null &&
      param.restaurantCommission !== ''
        ? param.restaurantCommission
        : 0,
    tableOrder:
      param && param.tableOrder && param.tableOrder !== null && param.tableOrder !== ''
        ? param.tableOrder
        : false,
    grandTotal:
      param && param.grandTotal && param.grandTotal !== null && param.grandTotal !== ''
        ? param.grandTotal
        : 0,
    orderFrom:
      param && param.orderFrom && param.orderFrom !== null && param.orderFrom !== ''
        ? param.orderFrom
        : 'vendor',
    status:
      param && param.status && param.status !== null && param.status !== ''
        ? param.status
        : 'created',
  });
  const orderResponse = await PosOrTableOrder.create(orderData);
  if (param && param.restaurant && param.restaurant !== null && param.restaurant !== '') {
    const restaurantInfo = await Restaurant.findById(param.restaurant);
    if (
      restaurantInfo &&
      restaurantInfo !== null &&
      restaurantInfo.id &&
      restaurantInfo.id !== null &&
      restaurantInfo.id !== ''
    ) {
      let ownKitchen = false;
      if (
        restaurantInfo !== null &&
        restaurantInfo.type === 'derived' &&
        restaurantInfo.isOutlet === true &&
        restaurantInfo.outletManagerId !== null
      ) {
        const outletManager = await Restaurant.findById(restaurantInfo.outletManagerId);
        if (outletManager !== null && outletManager.id !== null) {
          ownKitchen = outletManager.ownKitchen;
        }
      } else {
        ownKitchen = restaurantInfo.ownKitchen;
      }
      if (ownKitchen === true || ownKitchen === 'true') {
        const kitchenOrder = new KitchenOrder({
          orderFrom: 'pos_order',
          restaurant:
            param && param.restaurant && param.restaurant !== null && param.restaurant !== ''
              ? param.restaurant
              : null,
          regularOrder: null,
          posOrder: orderResponse.id,
          tableId: null,
          cartItemRaw:
            param && param.cartItemRaw && param.cartItemRaw !== null && param.cartItemRaw !== ''
              ? param.cartItemRaw
              : '',
          cookingInstruction: '',
          status: 'new',
        });
        await KitchenOrder.create(kitchenOrder);
        await fcmNotificationService.kitchenOwnerNewOrder('pos_order', param.restaurant);
      }
    }
  }

  return orderResponse;
};

const getPosOrderOfVendor = async (vendor, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const orderQuery = [
    { $match: { restaurant: new mongoose.Types.ObjectId(vendor) } },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        orderNo: 1,
        customerType: 1,
        customerName: 1,
        realTotal: {
          $round: [{ $divide: ['$realTotal', 100] }, 2],
        },
        itemTotal: {
          $round: [{ $divide: ['$itemTotal', 100] }, 2],
        },
        itemDiscount: {
          $round: [{ $divide: ['$itemDiscount', 100] }, 2],
        },
        discountCharge: {
          $round: [{ $divide: ['$discountCharge', 100] }, 2],
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
        waiterTip: {
          $round: [{ $divide: ['$waiterTip', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
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
        paymentMode: 1,
        tableOrder: 1,
        orderFrom: 1,
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const orders = await PosOrTableOrder.aggregate(orderQuery);
  const totalResults = await PosOrTableOrder.countDocuments({
    restaurant: new mongoose.Types.ObjectId(vendor),
  });
  return Promise.all([orders, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      orders,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const adminPosOrderList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const isValidObjectId = mongoose.Types.ObjectId.isValid(options.search);
  const numericSearch = Number(options.search);
  const isNumericSearch = !Number.isNaN(numericSearch);
  const orderMatch = {
    $or: [
      isNumericSearch ? { orderNo: numericSearch } : null,
      isValidObjectId ? { _id: new mongoose.Types.ObjectId(options.search) } : null,
      { customerName: searchRegExp },
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
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $addFields: {
        totalEarning: {
          $divide: [
            { $sum: ['$restaurantCommission', '$foodServiceCharge', '$serviceCharge'] },
            100,
          ],
        },
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
        orderNo: 1,
        customerType: 1,
        customerName: 1,
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        totalEarning: 1,
        paymentMode: 1,
        tableOrder: 1,
        orderFrom: 1,
        status: 1,
        createdAt: 1,
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ];
  const orders = await PosOrTableOrder.aggregate(orderQuery);
  const countResult = await PosOrTableOrder.aggregate([
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
      $match: orderMatch,
    },
    { $count: 'totalCount' },
  ]);
  return Promise.all([orders, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      orders,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityzenPosOrderList = async (masterId, options) => {
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
  const numericSearch = Number(options.search);
  const isNumericSearch = !Number.isNaN(numericSearch);
  const orderMatch = {
    $or: [
      isNumericSearch ? { orderNo: numericSearch } : null,
      isValidObjectId ? { _id: new mongoose.Types.ObjectId(options.search) } : null,
      { customerName: searchRegExp },
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
    $and: [{ 'restaurants.city': new mongoose.Types.ObjectId(city) }],
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
        orderNo: 1,
        customerType: 1,
        customerName: 1,
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        paymentMode: 1,
        tableOrder: 1,
        orderFrom: 1,
        status: 1,
        createdAt: 1,
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ];
  const orders = await PosOrTableOrder.aggregate(orderQuery);
  const countResult = await PosOrTableOrder.aggregate([
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
      $match: orderMatch,
    },
    { $count: 'totalCount' },
  ]);
  return Promise.all([orders, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      orders,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getPosOrderDetail = async (id, vendor) => {
  const orderQuery = [
    {
      $match: {
        _id: new mongoose.Types.ObjectId(id),
        restaurant: new mongoose.Types.ObjectId(vendor),
      },
    },
    { $limit: 1 },
    {
      $project: {
        _id: 0,
        id: '$_id',
        orderNo: 1,
        customerType: 1,
        customerName: 1,
        customerCountryCode: 1,
        customerMobileNumber: 1,
        discountType: 1,
        discountAmount: {
          $round: [{ $divide: ['$discountAmount', 100] }, 2],
        },
        realTotal: {
          $round: [{ $divide: ['$realTotal', 100] }, 2],
        },
        itemTotal: {
          $round: [{ $divide: ['$itemTotal', 100] }, 2],
        },
        itemDiscount: {
          $round: [{ $divide: ['$itemDiscount', 100] }, 2],
        },
        discountCharge: {
          $round: [{ $divide: ['$discountCharge', 100] }, 2],
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
        waiterTip: {
          $round: [{ $divide: ['$waiterTip', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
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
        paymentMode: 1,
        tableOrder: 1,
        orderFrom: 1,
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const orders = await PosOrTableOrder.aggregate(orderQuery);
  if (orders !== null && orders.length > 0) {
    const details = orders[0];
    return Promise.all([orders]).then(() => {
      const result = {
        details,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const adminPosOrderDetail = async (id) => {
  const orderQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(id) } },
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
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $addFields: {
        totalEarning: {
          $divide: [
            { $sum: ['$restaurantCommission', '$foodServiceCharge', '$serviceCharge'] },
            100,
          ],
        },
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        orderNo: 1,
        customerType: 1,
        customerName: 1,
        customerCountryCode: 1,
        customerMobileNumber: 1,
        discountType: 1,
        totalEarning: 1,
        discountAmount: {
          $round: [{ $divide: ['$discountAmount', 100] }, 2],
        },
        realTotal: {
          $round: [{ $divide: ['$realTotal', 100] }, 2],
        },
        itemTotal: {
          $round: [{ $divide: ['$itemTotal', 100] }, 2],
        },
        itemDiscount: {
          $round: [{ $divide: ['$itemDiscount', 100] }, 2],
        },
        discountCharge: {
          $round: [{ $divide: ['$discountCharge', 100] }, 2],
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
        waiterTip: {
          $round: [{ $divide: ['$waiterTip', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
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
        paymentMode: 1,
        tableOrder: 1,
        orderFrom: 1,
        status: 1,
        createdAt: 1,
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ];
  const orders = await PosOrTableOrder.aggregate(orderQuery);
  if (orders !== null && orders.length > 0) {
    const details = orders[0];
    return Promise.all([orders]).then(() => {
      const result = {
        details,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const cityzenPosOrderDetail = async (id) => {
  const orderQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(id) } },
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
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        orderNo: 1,
        customerType: 1,
        customerName: 1,
        customerCountryCode: 1,
        customerMobileNumber: 1,
        discountType: 1,
        discountAmount: {
          $round: [{ $divide: ['$discountAmount', 100] }, 2],
        },
        realTotal: {
          $round: [{ $divide: ['$realTotal', 100] }, 2],
        },
        itemTotal: {
          $round: [{ $divide: ['$itemTotal', 100] }, 2],
        },
        itemDiscount: {
          $round: [{ $divide: ['$itemDiscount', 100] }, 2],
        },
        discountCharge: {
          $round: [{ $divide: ['$discountCharge', 100] }, 2],
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
        waiterTip: {
          $round: [{ $divide: ['$waiterTip', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
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
        paymentMode: 1,
        tableOrder: 1,
        orderFrom: 1,
        status: 1,
        createdAt: 1,
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ];
  const orders = await PosOrTableOrder.aggregate(orderQuery);
  if (orders !== null && orders.length > 0) {
    const details = orders[0];
    return Promise.all([orders]).then(() => {
      const result = {
        details,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const vendorPosBusinessInsight = async (vendor) => {
  const currentMonth = new Date().getUTCMonth() + 1;
  const monthTotalSoldData = await PosOrTableOrder.aggregate([
    {
      $addFields: {
        month: { $month: '$createdAt' },
      },
    },
    {
      $match: {
        month: currentMonth,
        restaurant: new mongoose.Types.ObjectId(vendor),
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$grandTotal' },
        averageSum: { $avg: '$grandTotal' },
      },
    },
    {
      $project: {
        _id: 0,
        totalSold: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
        averageSold: { $round: [{ $divide: ['$averageSum', 100] }, 2] },
      },
    },
  ]);
  const startOfWeek = new Date();
  startOfWeek.setDate(startOfWeek.getDate() - 7);
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date();
  endOfWeek.setHours(23, 59, 59, 999);
  const weekTotalSoldData = await PosOrTableOrder.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: {
          $gte: startOfWeek,
          $lte: endOfWeek,
        },
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$grandTotal' },
        averageSum: { $avg: '$grandTotal' },
      },
    },
    {
      $project: {
        _id: 0,
        totalSold: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
        averageSold: { $round: [{ $divide: ['$averageSum', 100] }, 2] },
      },
    },
  ]);
  const startOfToday = DateTime.now().startOf('day').toJSDate();
  const endOfToday = DateTime.now().endOf('day').toJSDate();
  const todayTotalSoldData = await PosOrTableOrder.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: {
          $gte: startOfToday,
          $lte: endOfToday,
        },
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$grandTotal' },
        averageSum: { $avg: '$grandTotal' },
      },
    },
    {
      $project: {
        _id: 0,
        totalSold: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
        averageSold: { $round: [{ $divide: ['$averageSum', 100] }, 2] },
      },
    },
  ]);
  const monthChartData = await PosOrTableOrder.aggregate([
    {
      $addFields: {
        month: { $month: '$createdAt' },
      },
    },
    {
      $match: {
        month: currentMonth,
        restaurant: new mongoose.Types.ObjectId(vendor),
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        soldCount: { $sum: '$grandTotal' },
      },
    },
    {
      $project: {
        _id: 0,
        date: '$_id',
        soldCount: { $round: [{ $divide: ['$soldCount', 100] }, 2] },
      },
    },
    {
      $sort: {
        date: 1,
      },
    },
  ]);
  const weekChartData = await PosOrTableOrder.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: {
          $gte: startOfWeek,
          $lte: endOfWeek,
        },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        soldCount: { $sum: '$grandTotal' },
      },
    },
    {
      $project: {
        _id: 0,
        date: '$_id',
        soldCount: { $round: [{ $divide: ['$soldCount', 100] }, 2] },
      },
    },
    {
      $sort: {
        date: 1,
      },
    },
  ]);
  const todayChartData = await PosOrTableOrder.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: {
          $gte: startOfToday,
          $lte: endOfToday,
        },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%H:%M', date: '$createdAt' },
        },
        soldCount: { $sum: '$grandTotal' },
      },
    },
    {
      $project: {
        _id: 0,
        hourAndMinute: '$_id',
        soldCount: { $round: [{ $divide: ['$soldCount', 100] }, 2] },
      },
    },
    {
      $sort: {
        hourAndMinute: 1,
      },
    },
  ]);
  const monthlyTrendingFoods = await PosOrTableOrder.aggregate([
    {
      $addFields: {
        month: { $month: '$createdAt' },
      },
    },
    {
      $match: {
        month: currentMonth,
        restaurant: new mongoose.Types.ObjectId(vendor),
      },
    },
    { $unwind: '$foods' },
    { $group: { _id: '$foods', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    {
      $lookup: {
        from: 'foods',
        localField: '_id',
        foreignField: '_id',
        as: 'foodDetails',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              name: 1,
              image: 1,
              foodTax: 1,
              taxationEnable: 1,
              price: {
                $round: [{ $divide: ['$price', 100] }, 2],
              },
              discount: {
                $round: [{ $divide: ['$discount', 100] }, 2],
              },
              discountType: 1,
              translations: 1,
            },
          },
          {
            $lookup: {
              from: 'foodtaxations',
              localField: 'foodTax',
              foreignField: '_id',
              pipeline: [
                {
                  $project: {
                    _id: 0,
                    id: '$_id',
                    taxName: 1,
                    taxAmount: {
                      $round: [{ $divide: ['$taxAmount', 100] }, 2],
                    },
                    translations: 1,
                  },
                },
              ],
              as: 'foodtaxations',
            },
          },
        ],
      },
    },
    {
      $unwind: '$foodDetails',
    },
    {
      $project: {
        _id: 0,
        count: 1,
        foodDetails: 1,
      },
    },
  ]);
  const weeklyTrendingFoods = await PosOrTableOrder.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: {
          $gte: startOfWeek,
          $lte: endOfWeek,
        },
      },
    },
    { $unwind: '$foods' },
    { $group: { _id: '$foods', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    {
      $lookup: {
        from: 'foods',
        localField: '_id',
        foreignField: '_id',
        as: 'foodDetails',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              name: 1,
              image: 1,
              foodTax: 1,
              taxationEnable: 1,
              price: {
                $round: [{ $divide: ['$price', 100] }, 2],
              },
              discount: {
                $round: [{ $divide: ['$discount', 100] }, 2],
              },
              discountType: 1,
              translations: 1,
            },
          },
          {
            $lookup: {
              from: 'foodtaxations',
              localField: 'foodTax',
              foreignField: '_id',
              pipeline: [
                {
                  $project: {
                    _id: 0,
                    id: '$_id',
                    taxName: 1,
                    taxAmount: {
                      $round: [{ $divide: ['$taxAmount', 100] }, 2],
                    },
                    translations: 1,
                  },
                },
              ],
              as: 'foodtaxations',
            },
          },
        ],
      },
    },
    {
      $unwind: '$foodDetails',
    },
    {
      $project: {
        _id: 0,
        count: 1,
        foodDetails: 1,
      },
    },
  ]);
  const todayTrendingFoods = await PosOrTableOrder.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: {
          $gte: startOfToday,
          $lte: endOfToday,
        },
      },
    },
    { $unwind: '$foods' },
    { $group: { _id: '$foods', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    {
      $lookup: {
        from: 'foods',
        localField: '_id',
        foreignField: '_id',
        as: 'foodDetails',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              name: 1,
              image: 1,
              foodTax: 1,
              taxationEnable: 1,
              price: {
                $round: [{ $divide: ['$price', 100] }, 2],
              },
              discount: {
                $round: [{ $divide: ['$discount', 100] }, 2],
              },
              discountType: 1,
              translations: 1,
            },
          },
          {
            $lookup: {
              from: 'foodtaxations',
              localField: 'foodTax',
              foreignField: '_id',
              pipeline: [
                {
                  $project: {
                    _id: 0,
                    id: '$_id',
                    taxName: 1,
                    taxAmount: {
                      $round: [{ $divide: ['$taxAmount', 100] }, 2],
                    },
                    translations: 1,
                  },
                },
              ],
              as: 'foodtaxations',
            },
          },
        ],
      },
    },
    {
      $unwind: '$foodDetails',
    },
    {
      $project: {
        _id: 0,
        count: 1,
        foodDetails: 1,
      },
    },
  ]);
  return Promise.all([
    monthTotalSoldData,
    weekTotalSoldData,
    todayTotalSoldData,
    monthChartData,
    weekChartData,
    todayChartData,
    monthlyTrendingFoods,
    weeklyTrendingFoods,
    todayTrendingFoods,
  ]).then(() => {
    const monthTotalSold = {
      totalSold: 0,
      averageSold: 0,
    };
    const weekTotalSold = {
      totalSold: 0,
      averageSold: 0,
    };
    const todayTotalSold = {
      totalSold: 0,
      averageSold: 0,
    };
    if (checkArrayNotEmpty(monthTotalSoldData)) {
      monthTotalSold.totalSold = monthTotalSoldData[0].totalSold;
      monthTotalSold.averageSold = monthTotalSoldData[0].averageSold;
    }
    if (checkArrayNotEmpty(weekTotalSoldData)) {
      weekTotalSold.totalSold = weekTotalSoldData[0].totalSold;
      weekTotalSold.averageSold = weekTotalSoldData[0].averageSold;
    }
    if (checkArrayNotEmpty(todayTotalSoldData)) {
      todayTotalSold.totalSold = todayTotalSoldData[0].totalSold;
      todayTotalSold.averageSold = todayTotalSoldData[0].averageSold;
    }
    const result = {
      monthTotalSold,
      weekTotalSold,
      todayTotalSold,
      monthChartData,
      weekChartData,
      todayChartData,
      monthlyTrendingFoods,
      weeklyTrendingFoods,
      todayTrendingFoods,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const vendorCustomDatePosOrderBusinessInsight = async (vendor, from, to) => {
  const startDate = new Date(from);
  const endDate = new Date(to);
  const totalSoldData = await PosOrTableOrder.aggregate([
    {
      $match: {
        createdAt: {
          $gte: startDate,
          $lte: endDate,
        },
        restaurant: new mongoose.Types.ObjectId(vendor),
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$grandTotal' },
        averageSum: { $avg: '$grandTotal' },
      },
    },
    {
      $project: {
        _id: 0,
        totalSold: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
        averageSold: { $round: [{ $divide: ['$averageSum', 100] }, 2] },
      },
    },
  ]);
  const chartData = await PosOrTableOrder.aggregate([
    {
      $match: {
        createdAt: {
          $gte: startDate,
          $lte: endDate,
        },
        restaurant: new mongoose.Types.ObjectId(vendor),
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        soldCount: { $sum: '$grandTotal' },
      },
    },
    {
      $project: {
        _id: 0,
        date: '$_id',
        soldCount: { $round: [{ $divide: ['$soldCount', 100] }, 2] },
      },
    },
    {
      $sort: {
        date: 1,
      },
    },
  ]);
  const trendingFoods = await PosOrTableOrder.aggregate([
    {
      $match: {
        createdAt: {
          $gte: startDate,
          $lte: endDate,
        },
        restaurant: new mongoose.Types.ObjectId(vendor),
      },
    },
    { $unwind: '$foods' },
    { $group: { _id: '$foods', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    {
      $lookup: {
        from: 'foods',
        localField: '_id',
        foreignField: '_id',
        as: 'foodDetails',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              name: 1,
              image: 1,
              foodTax: 1,
              taxationEnable: 1,
              price: {
                $round: [{ $divide: ['$price', 100] }, 2],
              },
              discount: {
                $round: [{ $divide: ['$discount', 100] }, 2],
              },
              discountType: 1,
              translations: 1,
            },
          },
          {
            $lookup: {
              from: 'foodtaxations',
              localField: 'foodTax',
              foreignField: '_id',
              pipeline: [
                {
                  $project: {
                    _id: 0,
                    id: '$_id',
                    taxName: 1,
                    taxAmount: {
                      $round: [{ $divide: ['$taxAmount', 100] }, 2],
                    },
                    translations: 1,
                  },
                },
              ],
              as: 'foodtaxations',
            },
          },
        ],
      },
    },
    {
      $unwind: '$foodDetails',
    },
    {
      $project: {
        _id: 0,
        count: 1,
        foodDetails: 1,
      },
    },
  ]);
  return Promise.all([totalSoldData, chartData, trendingFoods]).then(() => {
    const totalSold = {
      totalSold: 0,
      averageSold: 0,
    };
    if (checkArrayNotEmpty(totalSoldData)) {
      totalSold.totalSold = totalSoldData[0].totalSold;
      totalSold.averageSold = totalSoldData[0].averageSold;
    }
    const result = {
      totalSold,
      chartData,
      trendingFoods,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const posOrderReport = async (options) => {
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
      $match: {
        $or: [{ customerName: RegExp(name, 'i') }],
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
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $addFields: {
        restaurantCommission: {
          $divide: [
            { $sum: ['$restaurantCommission', '$foodServiceCharge', '$serviceCharge'] },
            100,
          ],
        },
      },
    },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        orderNo: 1,
        paymentMode: 1,
        customerType: 1,
        customerName: 1,
        customerCountryCode: 1,
        customerMobileNumber: {
          $concat: [
            { $substr: ['$customerMobileNumber', 0, 2] },
            'XXXXXX',
            {
              $substr: [
                '$customerMobileNumber',
                { $subtract: [{ $strLenCP: '$customerMobileNumber' }, 2] },
                2,
              ],
            },
          ],
        },
        realTotal: {
          $round: [{ $divide: ['$realTotal', 100] }, 2],
        },
        itemTotal: {
          $round: [{ $divide: ['$itemTotal', 100] }, 2],
        },
        itemDiscount: {
          $round: [{ $divide: ['$itemDiscount', 100] }, 2],
        },
        discountType: 1,
        discountAmount: {
          $round: [{ $divide: ['$discountAmount', 100] }, 2],
        },
        discountCharge: {
          $round: [{ $divide: ['$discountCharge', 100] }, 2],
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
        waiterTip: {
          $round: [{ $divide: ['$waiterTip', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        restaurantCommission: 1,
        status: 1,
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        createdAt: 1,
      },
    },
  ];
  const countQuery = [
    matchQuery,
    {
      $match: {
        $or: [{ customerName: RegExp(name, 'i') }],
      },
    },
    { $count: 'totalCount' },
  ];
  const results = await PosOrTableOrder.aggregate(query);
  const resultCount = await PosOrTableOrder.aggregate(countQuery);
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

const vendorPosOrderList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { restaurant: new mongoose.Types.ObjectId(options.restaurant) };
  const orderQuery = [
    { $match: queryCondition },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $addFields: {
        totalEarning: {
          $divide: [
            { $sum: ['$restaurantCommission', '$foodServiceCharge', '$serviceCharge'] },
            100,
          ],
        },
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        orderNo: 1,
        customerType: 1,
        customerName: 1,
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        totalEarning: 1,
        paymentMode: 1,
        tableOrder: 1,
        orderFrom: 1,
        status: 1,
        createdAt: 1,
      },
    },
  ];
  const orders = await PosOrTableOrder.aggregate(orderQuery);
  const totalResults = await PosOrTableOrder.countDocuments(queryCondition);
  return Promise.all([orders, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      orders,
      page,
      limit,
      totalPages,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const adminPOSOrderInvoice = async (id) => {
  const orderQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(id) } },
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
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        orderNo: 1,
        customerType: 1,
        customerName: 1,
        customerCountryCode: 1,
        customerMobileNumber: 1,
        discountType: 1,
        discountAmount: {
          $round: [{ $divide: ['$discountAmount', 100] }, 2],
        },
        realTotal: {
          $round: [{ $divide: ['$realTotal', 100] }, 2],
        },
        itemTotal: {
          $round: [{ $divide: ['$itemTotal', 100] }, 2],
        },
        itemDiscount: {
          $round: [{ $divide: ['$itemDiscount', 100] }, 2],
        },
        discountCharge: {
          $round: [{ $divide: ['$discountCharge', 100] }, 2],
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
        waiterTip: {
          $round: [{ $divide: ['$waiterTip', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
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
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        paymentMode: 1,
        orderFrom: 1,
        createdAt: 1,
      },
    },
  ];
  const orders = await PosOrTableOrder.aggregate(orderQuery);
  if (orders !== null && checkArrayNotEmpty(orders) > 0) {
    const details = orders[0];
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
      }
    );
    return Promise.all([orders, businessSettings]).then(() => {
      const result = {
        details,
        businessSettings,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const vendorPOSOrderInvoice = async (id, vendor) => {
  const orderQuery = [
    {
      $match: {
        _id: new mongoose.Types.ObjectId(id),
        restaurant: new mongoose.Types.ObjectId(vendor),
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
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        orderNo: 1,
        customerType: 1,
        customerName: 1,
        customerCountryCode: 1,
        customerMobileNumber: 1,
        discountType: 1,
        discountAmount: {
          $round: [{ $divide: ['$discountAmount', 100] }, 2],
        },
        realTotal: {
          $round: [{ $divide: ['$realTotal', 100] }, 2],
        },
        itemTotal: {
          $round: [{ $divide: ['$itemTotal', 100] }, 2],
        },
        itemDiscount: {
          $round: [{ $divide: ['$itemDiscount', 100] }, 2],
        },
        discountCharge: {
          $round: [{ $divide: ['$discountCharge', 100] }, 2],
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
        waiterTip: {
          $round: [{ $divide: ['$waiterTip', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
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
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        paymentMode: 1,
        orderFrom: 1,
        createdAt: 1,
      },
    },
  ];
  const orders = await PosOrTableOrder.aggregate(orderQuery);
  if (orders !== null && checkArrayNotEmpty(orders) > 0) {
    const details = orders[0];
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
      }
    );
    return Promise.all([orders, businessSettings]).then(() => {
      const result = {
        details,
        businessSettings,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const exportCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const isValidObjectId = mongoose.Types.ObjectId.isValid(search);
  const numericSearch = Number(search);
  const isNumericSearch = !Number.isNaN(numericSearch);
  const orderMatch = {
    $or: [
      isNumericSearch ? { orderNo: numericSearch } : null,
      isValidObjectId ? { _id: new mongoose.Types.ObjectId(search) } : null,
      { customerName: searchRegExp },
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
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $addFields: {
        totalEarning: {
          $divide: [
            { $sum: ['$restaurantCommission', '$foodServiceCharge', '$serviceCharge'] },
            100,
          ],
        },
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
        orderNo: 1,
        customerType: 1,
        customerName: 1,
        customerCountryCode: 1,
        customerMobileNumber: 1,
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        realTotal: {
          $round: [{ $divide: ['$realTotal', 100] }, 2],
        },
        itemTotal: {
          $round: [{ $divide: ['$itemTotal', 100] }, 2],
        },
        itemDiscount: {
          $round: [{ $divide: ['$itemDiscount', 100] }, 2],
        },
        discountAmount: {
          $round: [{ $divide: ['$discountAmount', 100] }, 2],
        },
        discountCharge: {
          $round: [{ $divide: ['$discountCharge', 100] }, 2],
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
        waiterTip: {
          $round: [{ $divide: ['$waiterTip', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        restaurantCommission: {
          $round: [{ $divide: ['$restaurantCommission', 100] }, 2],
        },
        discountType: 1,
        totalEarning: 1,
        paymentMode: 1,
        tableOrder: 1,
        orderFrom: 1,
        status: 1,
        createdAt: 1,
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
        },
      },
    },
  ];
  const result = await PosOrTableOrder.aggregate(orderQuery);
  return result;
};

const exportRawCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const isValidObjectId = mongoose.Types.ObjectId.isValid(search);
  const numericSearch = Number(search);
  const isNumericSearch = !Number.isNaN(numericSearch);
  const orderMatch = {
    $or: [
      isNumericSearch ? { orderNo: numericSearch } : null,
      isValidObjectId ? { _id: new mongoose.Types.ObjectId(search) } : null,
      { customerName: searchRegExp },
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
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $addFields: {
        totalEarning: {
          $divide: [
            { $sum: ['$restaurantCommission', '$foodServiceCharge', '$serviceCharge'] },
            100,
          ],
        },
      },
    },
    {
      $match: orderMatch,
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        restaurants: 0,
      },
    },
  ];
  const result = await PosOrTableOrder.aggregate(orderQuery);
  return result;
};

const exportPOSOrderReportCollection = async (options) => {
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
      $match: {
        $or: [{ customerName: RegExp(name, 'i') }],
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
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $addFields: {
        restaurantCommission: {
          $divide: [
            { $sum: ['$restaurantCommission', '$foodServiceCharge', '$serviceCharge'] },
            100,
          ],
        },
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        orderNo: 1,
        paymentMode: 1,
        customerType: 1,
        customerName: 1,
        customerCountryCode: 1,
        customerMobileNumber: 1,
        realTotal: {
          $round: [{ $divide: ['$realTotal', 100] }, 2],
        },
        itemTotal: {
          $round: [{ $divide: ['$itemTotal', 100] }, 2],
        },
        itemDiscount: {
          $round: [{ $divide: ['$itemDiscount', 100] }, 2],
        },
        discountType: 1,
        discountAmount: {
          $round: [{ $divide: ['$discountAmount', 100] }, 2],
        },
        discountCharge: {
          $round: [{ $divide: ['$discountCharge', 100] }, 2],
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
        waiterTip: {
          $round: [{ $divide: ['$waiterTip', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        restaurantCommission: 1,
        status: 1,
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
        },
        createdAt: 1,
      },
    },
  ];
  const result = await PosOrTableOrder.aggregate(query);
  return result;
};

const checkPermissionOfRestaurant = async (vendor) => {
  const restaurantInfo = await Restaurant.findOne({ _id: new mongoose.Types.ObjectId(vendor) });
  let posPermission = false;
  if (
    restaurantInfo !== null &&
    restaurantInfo.type === 'derived' &&
    restaurantInfo.isOutlet === true &&
    restaurantInfo.outletManagerId !== null
  ) {
    const outletManager = await Restaurant.findById(restaurantInfo.outletManagerId, { pos: 1 });
    if (outletManager !== null && outletManager.id !== null) {
      posPermission = outletManager.pos;
    }
  } else {
    posPermission = restaurantInfo.pos;
  }
  return { posPermission };
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    const statusArray = ['created', 'accepted', 'preparing', 'ready', 'completed'];
    const orderFromArray = ['vendor', 'waiter', 'user_web'];
    importArray.forEach(async (param) => {
      const restaurantId =
        param && param.restaurant && param.restaurant !== null && param.restaurant !== ''
          ? param.restaurant
          : null;
      const permission = await checkPermissionOfRestaurant(restaurantId);
      if (
        restaurantId !== null &&
        statusArray.includes(param.status) &&
        orderFromArray.includes(param.orderFrom) &&
        permission.posPermission
      ) {
        const orderData = new PosOrTableOrder({
          orderNo:
            param && param.orderNo && param.orderNo !== null && param.orderNo !== ''
              ? param.orderNo
              : 0,
          foods:
            param && param.foods && param.foods !== null && param.foods !== ''
              ? param.foods.split(',')
              : [],
          restaurant: restaurantId,
          paymentMode:
            param &&
            param.paymentMode &&
            param.paymentMode !== null &&
            param.paymentMode !== '' &&
            param.paymentMode === 'online'
              ? 'online'
              : 'offline',
          customerType:
            param &&
            param.customerType &&
            param.customerType !== null &&
            param.customerType !== '' &&
            param.customerType === 'guest'
              ? 'guest'
              : 'regular',
          customerName:
            param &&
            param.customerName &&
            param.customerName !== null &&
            param.customerName !== '' &&
            param.customerName !== 'none'
              ? param.customerName
              : 'none',
          customerCountryCode:
            param &&
            param.customerCountryCode &&
            param.customerCountryCode !== null &&
            param.customerCountryCode !== ''
              ? param.customerCountryCode
              : 1,
          customerMobileNumber:
            param &&
            param.customerMobileNumber &&
            param.customerMobileNumber !== null &&
            param.customerMobileNumber !== '' &&
            param.customerMobileNumber !== '-'
              ? param.customerMobileNumber
              : '000000000000',
          cartItemRaw:
            param && param.cartItemRaw && param.cartItemRaw !== null && param.cartItemRaw !== ''
              ? param.cartItemRaw
              : '[]',
          realTotal:
            param && param.realTotal && param.realTotal !== null && param.realTotal !== ''
              ? param.realTotal
              : 0,
          itemTotal:
            param && param.itemTotal && param.itemTotal !== null && param.itemTotal !== ''
              ? param.itemTotal
              : 0,
          itemDiscount:
            param && param.itemDiscount && param.itemDiscount !== null && param.itemDiscount !== ''
              ? param.itemDiscount
              : 0,
          discountType:
            param && param.discountType && param.discountType !== null && param.discountType !== ''
              ? param.discountType
              : 'per',
          discountAmount:
            param &&
            param.discountAmount &&
            param.discountAmount !== null &&
            param.discountAmount !== ''
              ? param.discountAmount
              : 0,
          discountCharge:
            param &&
            param.discountCharge &&
            param.discountCharge !== null &&
            param.discountCharge !== ''
              ? param.discountCharge
              : 0,
          foodServiceCharge:
            param &&
            param.foodServiceCharge &&
            param.foodServiceCharge !== null &&
            param.foodServiceCharge !== ''
              ? param.foodServiceCharge
              : 0,
          serviceCharge:
            param &&
            param.serviceCharge &&
            param.serviceCharge !== null &&
            param.serviceCharge !== ''
              ? param.serviceCharge
              : 0,
          packageCharge:
            param &&
            param.packageCharge &&
            param.packageCharge !== null &&
            param.packageCharge !== ''
              ? param.packageCharge
              : 0,
          packageChargeTax:
            param &&
            param.packageChargeTax &&
            param.packageChargeTax !== null &&
            param.packageChargeTax !== ''
              ? param.packageChargeTax
              : 0,
          waiterTip:
            param && param.waiterTip && param.waiterTip !== null && param.waiterTip !== ''
              ? param.waiterTip
              : 0,
          extraCharge:
            param && param.extraCharge && param.extraCharge !== null && param.extraCharge !== ''
              ? param.extraCharge
              : 0,
          restaurantCommission:
            param &&
            param.restaurantCommission &&
            param.restaurantCommission !== null &&
            param.restaurantCommission !== ''
              ? param.restaurantCommission
              : 0,
          grandTotal:
            param && param.grandTotal && param.grandTotal !== null && param.grandTotal !== ''
              ? param.grandTotal
              : 0,
          orderFrom:
            param && param.orderFrom && param.orderFrom !== null && param.orderFrom !== ''
              ? param.orderFrom
              : 'vendor',
          status: param.status,
        });
        await PosOrTableOrder.create(orderData);
      }
    });
  }
  return { success: true };
};

module.exports = {
  createOrder,
  getPosOrderOfVendor,
  adminPosOrderList,
  getPosOrderDetail,
  adminPosOrderDetail,
  vendorPosBusinessInsight,
  vendorCustomDatePosOrderBusinessInsight,
  posOrderReport,
  vendorPosOrderList,
  adminPOSOrderInvoice,
  vendorPOSOrderInvoice,
  cityzenPosOrderList,
  cityzenPosOrderDetail,
  exportCollection,
  exportRawCollection,
  exportPOSOrderReportCollection,
  importCollection,
};

