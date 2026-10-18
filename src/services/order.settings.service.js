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
const { DateTime } = require('luxon');
const {
  OrderSettings,
  BusinessSettings,
  UserSettings,
  PaymentConfig,
  Wallet,
  Restaurant,
  DeliveryInstruction,
  UserAddress,
  RestaurantSettings,
  DeliveryGratitude,
  Orders,
} = require('../models');
const ApiError = require('../utils/ApiError');
const cartItemService = require('./cart.item.service');
const restaurantService = require('./restaurant.service');

const createSettings = async (param) => {
  if ((await OrderSettings.countDocuments()) > 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  const order = await OrderSettings.create(param);
  return { id: order.id, success: true };
};

const getSettingsId = async (id) => {
  return OrderSettings.findById(id);
};

const getSettings = async () => {
  const settings = await OrderSettings.findOne();
  return settings;
};

const updateSettingsById = async (settingId, param) => {
  const setting = await getSettingsId(settingId);
  if (!setting) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  Object.assign(setting, param);
  await setting.save();
  return { success: true };
};

const getOrderSettings = async (uid, restaurant, addressId, latitude, longitude, trackingId) => {
  const orderSettings = await OrderSettings.findOne(
    {},
    {
      homeDelivery: 1,
      takeaway: 1,
      scheduleDelivery: 1,
      timeIntervalForScheduleDelivery: 1,
      instantOrder: 1,
      customerOrderDate: 1,
      customerCanOrderWithinDays: 1,
    }
  );
  const businessSettings = await BusinessSettings.findOne(
    {},
    {
      haveFreeDeliveryInTotal: 1,
      freeDelivery: 1,
      haveFreeDeliveryInDistance: 1,
      freeDeliveryInDistance: 1,
      deliveryChargeMethod: 1,
      deliveryChargeAmount: 1,
      includeTaxOnFood: 1,
      foodTaxName: 1,
      foodTaxAmount: 1,
      foodTaxType: 1,
      additionalServiceCharge: 1,
      additionalServiceName: 1,
      additionalServiceAmount: 1,
      partialPayment: 1,
      partialAmountPayment: 1,
      deliveryArea: 1,
      findMode: 1,
    }
  );
  const restaurantSettings = await RestaurantSettings.findOne(
    {},
    {
      havePackagingCharges: 1,
      packagingCharges: 1,
      includePackagesChargesInTax: 1,
      packagingChargesTax: 1,
    }
  );
  const radius = 5000;
  const findMode =
    businessSettings && businessSettings.findMode !== null && businessSettings.findMode !== ''
      ? businessSettings.findMode
      : 'km';
  const radiusInMeters = findMode === 'km' ? radius * 1000 : radius * 1609.34; // 1000 = 1 kilometer
  const queryPoint = { type: 'Point', coordinates: [longitude, latitude] };

  const restaurantQuery = {
    $geoNear: {
      near: queryPoint,
      maxDistance: radiusInMeters,
      distanceField: 'distance',
      distanceMultiplier: findMode === 'km' ? 1 / 1000 : 1 / 1609.34,
      query: { status: true, _id: new mongoose.Types.ObjectId(restaurant) },
    },
  };
  const restaurants = await Restaurant.aggregate([
    restaurantQuery,
    { $limit: 1 },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        distance: 1,
        approxDeliveryTime: 1,
        slots: 1,
        takeAway: 1,
        acceptHomeDelivery: 1,
        acceptScheduleDelivery: 1,
        minOrderAmount: {
          $round: [{ $divide: ['$minOrderAmount', 100] }, 2],
        },
      },
    },
  ]);
  const customerSettinsg = await UserSettings.findOne(
    {},
    {
      canEarnBuyFromWallet: 1,
      canEarnLoyaltyPointOnOrder: 1,
      loyaltyMinOrderTotal: 1,
      loyaltyPointValue: 1,
    }
  );
  const defaultPayment = await PaymentConfig.findOne(
    { isDefault: true, status: true },
    { name: 1, slug: 1, image: 1, translations: 1, isDefault: 1 }
  );
  const paymentSettings = await PaymentConfig.find(
    { status: true },
    { name: 1, slug: 1, image: 1, translations: 1, isDefault: 1 }
  );
  const deliveryInstruction = await DeliveryInstruction.find({ status: true });
  const deliveryGratitude = await DeliveryGratitude.find({ status: true });
  const walletInfo = await Wallet.findOne({ holderId: uid }, { balance: 1 });
  const savedAddress =
    addressId !== null && addressId !== ''
      ? await UserAddress.findById(
          { _id: new mongoose.Types.ObjectId(addressId) },
          {
            title: 1,
            receiverName: 1,
            countryCode: 1,
            receiverContact: 1,
            flatHouse: 1,
            locality: 1,
            landmark: 1,
            location: 1,
          }
        )
      : null;
  const foodInCart = await cartItemService.getCartItemForCheckout(trackingId, restaurant);
  return Promise.all([
    orderSettings,
    businessSettings,
    customerSettinsg,
    defaultPayment,
    paymentSettings,
    walletInfo,
    restaurants,
    deliveryInstruction,
    savedAddress,
    restaurantSettings,
    deliveryGratitude,
    foodInCart,
  ]).then(() => {
    const result = {
      orders: orderSettings,
      business: businessSettings,
      customer: customerSettinsg,
      primary: defaultPayment,
      payments: paymentSettings,
      wallet: walletInfo,
      restaurant: restaurants !== null && restaurants.length > 0 ? restaurants[0] : null,
      instruction: deliveryInstruction,
      address: savedAddress,
      packaging: restaurantSettings,
      gratitudes: deliveryGratitude,
      foods: foodInCart,
    };
    return Promise.resolve(result);
  });
};

const getOrderSettingForCheckout = async (restaurantId) => {
  const orderSettings = await OrderSettings.findOne(
    {},
    {
      homeDelivery: 1,
      takeaway: 1,
      scheduleDelivery: 1,
      timeIntervalForScheduleDelivery: 1,
      instantOrder: 1,
      customerOrderDate: 1,
      customerCanOrderWithinDays: 1,
    }
  );
  const businessSettings = await BusinessSettings.findOne(
    {},
    {
      haveFreeDeliveryInTotal: 1,
      freeDelivery: 1,
      haveFreeDeliveryInDistance: 1,
      freeDeliveryInDistance: 1,
      deliveryChargeMethod: 1,
      deliveryChargeAmount: 1,
      includeTaxOnFood: 1,
      foodTaxName: 1,
      foodTaxAmount: 1,
      foodTaxType: 1,
      additionalServiceCharge: 1,
      additionalServiceName: 1,
      additionalServiceAmount: 1,
      partialPayment: 1,
      partialAmountPayment: 1,
      deliveryArea: 1,
      findMode: 1,
    }
  );
  const restaurantSettings = await RestaurantSettings.findOne(
    {},
    {
      havePackagingCharges: 1,
      packagingCharges: 1,
      includePackagesChargesInTax: 1,
      packagingChargesTax: 1,
    }
  );
  const restaurants = await Restaurant.findOne(
    { _id: new mongoose.Types.ObjectId(restaurantId) },
    {
      location: 1,
      takeAway: 1,
      acceptHomeDelivery: 1,
      acceptScheduleDelivery: 1,
      minOrderAmount: 1,
      cover: 1,
      logo: 1,
      name: 1,
      slug: 1,
      translations: 1,
      commission: 1,
      posOrderCommission: 1,
      tableOrderCommission: 1,
      type: 1,
      isOutlet: 1,
      outletManagerId: 1,
      orderLimit: 1,
    }
  );
  let adminCommission = 0;
  let posAdminCommission = 0;
  let tableOrderAdminCommission = 0;
  if (
    restaurants !== null &&
    restaurants.type === 'derived' &&
    restaurants.isOutlet === true &&
    restaurants.outletManagerId !== null
  ) {
    const outletManager = await restaurantService.getRestaurantManagerTypeAndCommission(
      restaurants.outletManagerId
    );
    if (outletManager !== null && outletManager.id !== null) {
      adminCommission = outletManager.commission;
      posAdminCommission = outletManager.posOrderCommission;
      tableOrderAdminCommission = outletManager.tableOrderCommission;
    }
  } else {
    adminCommission = restaurants.commission;
    posAdminCommission = restaurants.posOrderCommission;
    tableOrderAdminCommission = restaurants.tableOrderCommission;
  }
  const customerSettinsg = await UserSettings.findOne(
    {},
    {
      canEarnBuyFromWallet: 1,
      canEarnLoyaltyPointOnOrder: 1,
      loyaltyMinOrderTotal: 1,
      loyaltyPointValue: 1,
    }
  );
  const now = DateTime.now();
  const startOfMonth = now.startOf('month').toJSDate();
  const endOfMonth = now.endOf('month').toJSDate();
  const orderCount = await Orders.countDocuments({
    restaurant: new mongoose.Types.ObjectId(restaurantId),
    createdAt: { $gte: startOfMonth, $lte: endOfMonth },
  });
  return Promise.all([
    orderSettings,
    businessSettings,
    customerSettinsg,
    restaurants,
    restaurantSettings,
    orderCount,
  ]).then(() => {
    const orderLimit =
      parseInt(restaurants.orderLimit, 10) !== -1
        ? parseInt(restaurants.orderLimit, 10)
        : Number.MAX_SAFE_INTEGER;
    let canPlaceOrder = true;
    if (orderCount >= orderLimit) {
      canPlaceOrder = false;
    }
    const result = {
      commission: adminCommission,
      posCommission: posAdminCommission,
      tableOrderCommission: tableOrderAdminCommission,
      orders: orderSettings,
      business: businessSettings,
      customer: customerSettinsg,
      restaurant: restaurants,
      packaging: restaurantSettings,
      canPlaceOrder,
    };
    return Promise.resolve(result);
  });
};

const posOrderSettings = async () => {
  const businessSettings = await BusinessSettings.findOne(
    {},
    {
      includeTaxOnFood: 1,
      foodTaxName: 1,
      foodTaxAmount: 1,
      foodTaxType: 1,
      additionalServiceCharge: 1,
      additionalServiceName: 1,
      additionalServiceAmount: 1,
    }
  );
  const restaurantSettings = await RestaurantSettings.findOne(
    {},
    {
      havePackagingCharges: 1,
      packagingCharges: 1,
      includePackagesChargesInTax: 1,
      packagingChargesTax: 1,
    }
  );
  return Promise.all([businessSettings, restaurantSettings]).then(() => {
    const result = {
      business: businessSettings,
      packaging: restaurantSettings,
    };
    return Promise.resolve(result);
  });
};

module.exports = {
  createSettings,
  updateSettingsById,
  getSettings,
  getOrderSettings,
  getOrderSettingForCheckout,
  posOrderSettings,
};

