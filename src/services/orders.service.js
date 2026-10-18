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
const otpGenerator = require('otp-generator');
const { DateTime } = require('luxon');
const ApiError = require('../utils/ApiError');
const {
  Orders,
  OrderSettings,
  Restaurant,
  BusinessSettings,
  RestaurantSettings,
  Driver,
  DriverSettings,
  DriverNewOrderStatus,
  User,
  RestaurantFoodLicense,
  ComplaintsReason,
  FavouriteOrder,
  OrderRatingMessages,
  PaymentConfig,
  OrderDeliveryProof,
  DriverIncentive,
  PosOrTableOrder,
  TableOrder,
  DriverOrderReview,
  InvoiceInstruction,
  DeliveryShiftSchedule,
  Coupon,
  AdminExpense,
  RestaurantExpense,
  RefundRequest,
  TiffinSubscriptionRefundRequest,
  DiningBookingRefundRequest,
  DiningBooking,
  Food,
  KitchenOrder,
} = require('../models');
const restaurantCashInHandService = require('./restaurant.cash.in.hand.service');
const deliverymanCashInHandService = require('./deliveryman.cash.in.hand.service');
const restaurantService = require('./restaurant.service');
const driverService = require('./driver.service');
const fcmNotificationService = require('./fcm.notification.service');
const config = require('../config/config');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');
const { assertRiderEligible, resolveRiderPool, buildPoolQuery } = require('../utils/rider.pool');
const geographicService = require('../kernel/geographic/services/geographic.service');
const { assertOrderCovered } = require('../utils/delivery.policy');
const { assertFoodOrderTransition } = require('./food.delivery.transitions');
const { recordAssignmentEvent, orderZoneTag } = require('./dispatch.events.service');

/**
 * Create a manual rider offer after validating the rider server-side.
 *
 * `driverId` arrives from a client picker whose data may be minutes stale, and
 * before this guard it was written straight to the database: any user id at all
 * became a live offer. Eligibility is re-derived here rather than trusted.
 *
 * The offer is an *offer*, not an assignment — the rider still has to accept.
 *
 * Supersede semantics: an active offer to the *same* rider is a client double-tap
 * and is refused. An active offer to a *different* rider means a human is
 * overriding the previous choice, so the stale offer is cancelled (the first
 * write of the `cancelled` value the enum has always declared) and the new one
 * created. That keeps operations able to fix a stuck order.
 *
 * @param {object} params
 * @param {string} params.orderId
 * @param {string} params.driverId
 * @param {string} params.restaurantId
 * @param {string} params.deliveryAddressRaw
 * @param {string} [params.selectedBy]      user id of whoever selected the rider
 * @param {string} [params.selectionSource] vendor_app | vendor_web | admin | city_master
 * @returns {Promise<{offer: Object, superseded: Object|null}>}
 */
const createManualRiderOffer = async ({
  orderId,
  driverId,
  restaurantId,
  deliveryAddressRaw,
  selectedBy,
  selectionSource,
}) => {
  await assertRiderEligible({ driverId, restaurantId, orderId });

  const activeOffer = await DriverNewOrderStatus.findOne({
    orderId: new mongoose.Types.ObjectId(orderId),
    driverOrderStatus: 'ideal',
  });

  if (activeOffer && String(activeOffer.driver) === String(driverId)) {
    throw new ApiError(httpStatus.CONFLICT, 'This rider already has an active offer on the order');
  }

  let superseded = null;
  if (activeOffer) {
    superseded = activeOffer;
    await DriverNewOrderStatus.updateOne(
      { _id: activeOffer._id },
      { $set: { driverOrderStatus: 'cancelled' } }
    );
  }

  const offer = await DriverNewOrderStatus.create({
    orderId,
    driver: driverId,
    driverOrderStatus: 'ideal',
    orderFrom: 'manually',
    restaurant: restaurantId,
    deliveryAddressRaw,
    selectedBy: selectedBy || null,
    selectedAt: new Date(),
    selectionSource: selectionSource || null,
  });

  // Audit trail (Phase 3). Best-effort — `recordAssignmentEvent` never throws,
  // so a slow audit collection cannot fail the assignment it describes.
  if (superseded) {
    await recordAssignmentEvent({
      order: String(orderId),
      restaurant: String(restaurantId),
      type: 'overridden',
      actorType: selectionSource || 'system',
      actor: selectedBy || null,
      reason: 'manual_override',
      ...(await orderZoneTag(orderId)),
    });
  }
  await recordAssignmentEvent({
    order: String(orderId),
    restaurant: String(restaurantId),
    type: 'offered',
    actorType: selectionSource || 'system',
    actor: selectedBy || null,
    reason: 'manual_selection',
    ...(await orderZoneTag(orderId)),
  });

  return { offer, superseded };
};


/**
 * Great-circle distance in metres.
 *
 * Delegates to the kernel implementation rather than keeping a fourth copy of
 * the formula. The kernel uses the WGS-84 equatorial radius (6378137 m) where
 * this used a mean radius (6371000 m), so distances here shift by about 0.1%.
 * That is deliberate: the same number now drives the rider payout calculation,
 * the delivery-area check and the dispatch radius, so a customer cannot be
 * inside the delivery zone by one formula and outside it by another.
 */
function haversineDistance(coords1, coords2) {
  return geographicService.haversineMeters(coords1[0], coords1[1], coords2[0], coords2[1]);
}

const getUserOrderCount = async (userId, vendorId) => {
  const count = await Orders.countDocuments({
    user: new mongoose.Types.ObjectId(userId),
    restaurant: new mongoose.Types.ObjectId(vendorId),
  });
  return count;
};

const createOrder = async (param) => {
  // Coverage gate (Batch E-1): a decidable-but-uncovered home-delivery pin is
  // refused here — before any write — instead of becoming a doomed order no
  // rider can reach. Self-pickup and unresolvable pins pass through untouched.
  if (param && param.orderTo === 'homedelivery') {
    await assertOrderCovered({
      restaurantId: param.restaurant,
      orderTo: param.orderTo,
      deliveryAddress: param.deliveryAddress,
      deliveryAddressRaw: param.deliveryAddressRaw,
    });
  }
  const orderCount = await Orders.countDocuments();
  const orderNumber = 100000 + parseInt(orderCount, 10) + 1;
  const driverPin = otpGenerator.generate(4, {
    digits: true,
    upperCaseAlphabets: false,
    lowerCaseAlphabets: false,
    specialChars: false,
  });
  const customerPin = otpGenerator.generate(4, {
    digits: true,
    upperCaseAlphabets: false,
    lowerCaseAlphabets: false,
    specialChars: false,
  });
  const userOrderNumber = await getUserOrderCount(param.user, param.restaurant);
  const orderData = new Orders({
    orderNo: orderNumber,
    user: param && param.user && param.user !== null && param.user !== '' ? param.user : null,
    driver:
      param && param.driver && param.driver !== null && param.driver !== '' ? param.driver : null,
    payment:
      param && param.payment && param.payment !== null && param.payment !== ''
        ? param.payment
        : null,
    restaurant:
      param && param.restaurant && param.restaurant !== null && param.restaurant !== ''
        ? param.restaurant
        : null,
    addons: param && param.addons && param.addons.length > 0 ? param.addons : [],
    foods: param && param.foods && param.foods.length > 0 ? param.foods : [],
    coupon:
      param && param.coupon && param.coupon !== null && param.coupon !== '' ? param.coupon : null,
    couponType:
      param && param.couponType && param.couponType !== null && param.couponType !== ''
        ? param.couponType
        : '',
    orderTo: param.orderTo,
    cookingInstruction:
      param &&
      param.cookingInstruction &&
      param.cookingInstruction !== null &&
      param.cookingInstruction !== ''
        ? param.cookingInstruction
        : '',
    deliveryInstruction:
      param &&
      param.deliveryInstruction &&
      param.deliveryInstruction !== null &&
      param.deliveryInstruction !== ''
        ? param.deliveryInstruction
        : null,
    deliveryAddress:
      param &&
      param.deliveryAddress &&
      param.deliveryAddress !== null &&
      param.deliveryAddress !== ''
        ? param.deliveryAddress
        : null,
    deliveryAddressRaw:
      param &&
      param.deliveryAddressRaw &&
      param.deliveryAddressRaw != null &&
      param.deliveryAddressRaw !== ''
        ? param.deliveryAddressRaw
        : '',
    receiverName: param.receiverName,
    countryCode: param.countryCode,
    receiverContact: param.receiverContact,
    cartItemRaw: param.cartItemRaw,
    walletUsed: param.walletUsed,
    instantOrder: param.instantOrder,
    scheduleOrder: param.scheduleOrder,
    scheduleDate:
      param && param.scheduleDate && param.scheduleDate !== null && param.scheduleDate !== ''
        ? param.scheduleDate
        : '',
    scheduleTime:
      param && param.scheduleTime && param.scheduleTime !== null && param.scheduleTime !== ''
        ? param.scheduleTime
        : '',
    orderAt:
      param && param.orderAt && param.orderAt !== null && param.orderAt !== '' ? param.orderAt : '',
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
    couponDiscountCharge:
      param &&
      param.couponDiscountCharge &&
      param.couponDiscountCharge !== null &&
      param.couponDiscountCharge !== ''
        ? param.couponDiscountCharge
        : 0,
    deliveryCharge:
      param && param.deliveryCharge && param.deliveryCharge !== null && param.deliveryCharge !== ''
        ? param.deliveryCharge
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
    deliveryTip:
      param && param.deliveryTip && param.deliveryTip !== null && param.deliveryTip !== ''
        ? param.deliveryTip
        : 0,
    extraCharge:
      param && param.extraCharge && param.extraCharge !== null && param.extraCharge !== ''
        ? param.extraCharge
        : 0,
    walletAmount:
      param && param.walletAmount && param.walletAmount !== null && param.walletAmount !== ''
        ? param.walletAmount
        : 0,
    grandTotal:
      param && param.grandTotal && param.grandTotal !== null && param.grandTotal !== ''
        ? param.grandTotal
        : 0,
    driverOrderPin: driverPin,
    customerOrderPin: customerPin,
    userOrderCount: userOrderNumber + 1,
    subscriptionOrder:
      param &&
      param.subscriptionOrder &&
      param.subscriptionOrder !== null &&
      param.subscriptionOrder !== ''
        ? param.subscriptionOrder
        : false,
    purchasedTiffinSubscription:
      param &&
      param.purchasedTiffinSubscription &&
      param.purchasedTiffinSubscription !== null &&
      param.purchasedTiffinSubscription !== ''
        ? param.purchasedTiffinSubscription
        : null,
    tiffinSubscription:
      param &&
      param.tiffinSubscription &&
      param.tiffinSubscription !== null &&
      param.tiffinSubscription !== ''
        ? param.tiffinSubscription
        : null,
    status: param.status,
    orderFrom:
      param && param.orderFrom && param.orderFrom !== null && param.orderFrom !== ''
        ? param.orderFrom
        : 'app',
    deliveryCommission:
      param &&
      param.deliveryCommission &&
      param.deliveryCommission !== null &&
      param.deliveryCommission !== ''
        ? param.deliveryCommission
        : 0,
    restaurantCommission:
      param &&
      param.restaurantCommission &&
      param.restaurantCommission !== null &&
      param.restaurantCommission !== ''
        ? param.restaurantCommission
        : 0,
    refundedAmount: 0,
    restaurantCampaign:
      param &&
      param.restaurantCampaign &&
      param.restaurantCampaign !== null &&
      param.restaurantCampaign !== ''
        ? param.restaurantCampaign
        : null,
    foodCampaign:
      param && param.foodCampaign && param.foodCampaign !== null && param.foodCampaign !== ''
        ? param.foodCampaign
        : null,
    driverEarining: 0,
  });
  const orderResponse = await Orders.create(orderData);
  // Zone stamp (Batch A-4). Best-effort and post-write: resolution reads the
  // saved row, and a missing tag must never fail checkout. Powers per-zone
  // pending/breach metrics — "ungrouped" volume is itself the review signal.
  try {
    const zoneTag = await orderZoneTag(orderResponse._id);
    if (zoneTag.zone) {
      await Orders.updateOne(
        { _id: orderResponse._id },
        {
          $set: {
            zone: new mongoose.Types.ObjectId(zoneTag.zone),
            zoneVersion: zoneTag.zoneVersion,
          },
        }
      );
      orderResponse.zone = new mongoose.Types.ObjectId(zoneTag.zone);
      orderResponse.zoneVersion = zoneTag.zoneVersion;
    }
  } catch {
    /* audit tagging never fails checkout */
  }
  return orderResponse;
};

const getOrderById = async (id) => {
  const orderInfo = await Orders.findById(id);
  return orderInfo;
};

const getVendorOrderById = async (id, vendorId) => {
  const orderInfo = await Orders.findOne({
    _id: new mongoose.Types.ObjectId(id),
    restaurant: new mongoose.Types.ObjectId(vendorId),
  });
  return orderInfo;
};

const updateOrderStatus = async (id, param) => {
  const order = await getOrderById(id);
  if (order) {
    Object.assign(order, param);
    await order.save();
  }
};

const updateOrderPayment = async (id, param) => {
  const order = await getOrderById(id);
  if (order) {
    Object.assign(order, param);
    await order.save();
  }
};

const getMyOrderList = async (userId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const orderQuery = [
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
        orderNo: 1,
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
        status: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        scheduleDate: 1,
        scheduleTime: 1,
        orderAt: 1,
        subscriptionOrder: 1,
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          slug: { $ifNull: ['$restaurants.slug', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        createdAt: 1,
      },
    },
  ];
  const orders = await Orders.aggregate(orderQuery);
  const totalResults = await Orders.countDocuments({ user: new mongoose.Types.ObjectId(userId) });
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

const getMyFavouriteOrders = async (userId, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const favouriteOrders = await FavouriteOrder.find(
    { user: new mongoose.Types.ObjectId(userId) },
    { _id: 1, order: 1 }
  )
    .skip(skip)
    .limit(limit);
  const ids = favouriteOrders.map((doc) => doc.order);
  const orderQuery = [
    { $match: { _id: { $in: ids } } },
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
        status: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        scheduleDate: 1,
        scheduleTime: 1,
        orderAt: 1,
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          slug: { $ifNull: ['$restaurants.slug', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        createdAt: 1,
      },
    },
  ];
  const orders = await Orders.aggregate(orderQuery);
  const totalResults = await FavouriteOrder.countDocuments({
    user: new mongoose.Types.ObjectId(userId),
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

const getVendorOrder = async (vendorId, orderStatus, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  let queryCondition = {};
  if (orderStatus !== 'new') {
    queryCondition = {
      $and: [{ restaurant: new mongoose.Types.ObjectId(vendorId), status: orderStatus }],
    };
  } else {
    queryCondition = {
      $and: [{ restaurant: new mongoose.Types.ObjectId(vendorId) }],
      $or: [{ status: 'created' }, { status: 'accepted' }],
    };
  }

  const newOrders = await Orders.countDocuments({
    $and: [{ restaurant: new mongoose.Types.ObjectId(vendorId) }],
    $or: [{ status: 'created' }, { status: 'accepted' }],
  });
  const preparingOrders = await Orders.countDocuments({
    $and: [{ restaurant: new mongoose.Types.ObjectId(vendorId), status: 'preparing' }],
  });
  const readyOrder = await Orders.countDocuments({
    $and: [{ restaurant: new mongoose.Types.ObjectId(vendorId), status: 'ready' }],
  });
  const handOverOrder = await Orders.countDocuments({
    $and: [{ restaurant: new mongoose.Types.ObjectId(vendorId), status: 'handover' }],
  });
  const ongoingOrder = await Orders.countDocuments({
    $and: [{ restaurant: new mongoose.Types.ObjectId(vendorId), status: 'ongoing' }],
  });
  const deliveredOrder = await Orders.countDocuments({
    $and: [{ restaurant: new mongoose.Types.ObjectId(vendorId), status: 'delivered' }],
  });
  const rejectedOrder = await Orders.countDocuments({
    $and: [{ restaurant: new mongoose.Types.ObjectId(vendorId), status: 'rejected' }],
  });
  const orderSettings = await OrderSettings.findOne(
    {},
    {
      restaurantCanCancelOrder: 1,
      driverCanCancelOrder: 1,
      deliveryVerification: 1,
      orderConfirmationModel: 1,
    }
  );
  const restaurantInfo = await Restaurant.findOne(
    { _id: new mongoose.Types.ObjectId(vendorId) },
    {
      name: 1,
      location: 1,
      logo: 1,
      cover: 1,
      ownDriver: 1,
      isOutlet: 1,
      outletManagerId: 1,
      temporaryClosed: 1,
      status: 1,
    }
  );
  // Pool resolution is shared with the vendor picker and the auto engine.
  //
  // The block this replaced was one of THREE identical copies of the same
  // ternary, and they had drifted in two ways that showed wrong numbers on a
  // vendor screen: the platform branch carried no `restaurant: null` filter, so
  // "riders nearby" counted other restaurants own riders as well, and the
  // own-fleet branch queried the outlet own id instead of the parent, so a
  // derived outlet always counted zero.
  const pool = await resolveRiderPool(vendorId);
  const restaurantConfig = await RestaurantSettings.findOne(
    {},
    { canInitiateCall: 1, canInitiateChat: 1, driverPickup: 1, platformDriverPickup: 1 }
  );
  const driverConfig = await DriverSettings.findOne({}, { maxOrderLimit: 1 });
  const storeLatitude =
    restaurantInfo !== null &&
    restaurantInfo.location !== null &&
    restaurantInfo.location.coordinates !== null &&
    restaurantInfo.location.coordinates.length > 0
      ? restaurantInfo.location.coordinates[1]
      : 0.0;
  const storeLongitude =
    restaurantInfo !== null &&
    restaurantInfo.location !== null &&
    restaurantInfo.location.coordinates !== null &&
    restaurantInfo.location.coordinates.length > 0
      ? restaurantInfo.location.coordinates[0]
      : 0.0;
  const businessSettings = await BusinessSettings.findOne({}, { deliveryArea: 1, findMode: 1 });
  const radius =
    businessSettings &&
    businessSettings.deliveryArea !== null &&
    businessSettings.deliveryArea !== ''
      ? businessSettings.deliveryArea
      : 10;
  const findMode =
    businessSettings && businessSettings.findMode !== null && businessSettings.findMode !== ''
      ? businessSettings.findMode
      : 'km';
  const radiusInMeters = findMode === 'km' ? radius * 1000 : radius * 1609.34; // 1000 = 1 kilometer
  let nearDriver = 0;
  const driverFindQueryCondition = buildPoolQuery(pool);
  if (orderStatus === 'preparing') {
    const queryPoint = { type: 'Point', coordinates: [storeLongitude, storeLatitude] };
    const nearestDriver = {
      $geoNear: {
        near: queryPoint,
        maxDistance: radiusInMeters,
        distanceField: 'distance',
        distanceMultiplier: findMode === 'km' ? 1 / 1000 : 1 / 1609.34,
        query: driverFindQueryCondition,
      },
    };
    const nearDriverCount = await Driver.aggregate([nearestDriver, { $count: 'count' }]);
    nearDriver = nearDriverCount.length > 0 ? nearDriverCount[0].count : 0;
  }
  const orderQuery = [
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
        from: 'users',
        localField: 'driver',
        foreignField: '_id',
        as: 'drivers',
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
        path: '$drivers',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        orderNo: 1,
        cartItem: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$cartItemRaw'],
            lang: 'js',
          },
        },
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
        couponDiscountCharge: {
          $round: [{ $divide: ['$couponDiscountCharge', 100] }, 2],
        },
        deliveryCharge: {
          $round: [{ $divide: ['$deliveryCharge', 100] }, 2],
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
        walletAmount: {
          $round: [{ $divide: ['$walletAmount', 100] }, 2],
        },
        deliveryTip: {
          $round: [{ $divide: ['$deliveryTip', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        paymentMode: 1,
        cookingInstruction: 1,
        preparationTime: {
          $round: [{ $divide: ['$preparationTime', 100] }, 2],
        },
        status: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        scheduleDate: 1,
        scheduleTime: 1,
        orderAt: 1,
        createdAt: 1,
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        orderTo: 1,
        userOrderCount: 1,
        driverAssign: 1,
        driverOrderPin: 1,
        customerOrderPin: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
        },
        driverInfo: {
          id: { $ifNull: ['$drivers._id', ''] },
          firstName: { $ifNull: ['$drivers.firstName', ''] },
          lastName: { $ifNull: ['$drivers.lastName', ''] },
          image: { $ifNull: ['$drivers.image', ''] },
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
  const orders = await Orders.aggregate(orderQuery);
  const totalResults = await Orders.countDocuments(queryCondition);
  return Promise.all([
    newOrders,
    preparingOrders,
    readyOrder,
    ongoingOrder,
    deliveredOrder,
    rejectedOrder,
    orderSettings,
    handOverOrder,
    orders,
    restaurantInfo,
    restaurantConfig,
    nearDriver,
    driverConfig,
    totalResults,
  ]).then(() => {
    let totalPages = 0;
    if (orderStatus === 'new') {
      totalPages = Math.ceil(newOrders / limit);
    } else if (orderStatus === 'preparing') {
      totalPages = Math.ceil(preparingOrders / limit);
    } else if (orderStatus === 'handover') {
      totalPages = Math.ceil(handOverOrder / limit);
    } else if (orderStatus === 'ready') {
      totalPages = Math.ceil(readyOrder / limit);
    } else if (orderStatus === 'ongoing') {
      totalPages = Math.ceil(ongoingOrder / limit);
    } else if (orderStatus === 'delivered') {
      totalPages = Math.ceil(deliveredOrder / limit);
    } else if (orderStatus === 'rejected') {
      totalPages = Math.ceil(rejectedOrder / limit);
    }
    const result = {
      orders,
      newOrders,
      preparingOrders,
      readyOrder,
      ongoingOrder,
      deliveredOrder,
      rejectedOrder,
      orderSettings,
      handOverOrder,
      totalPages,
      totalResults,
      page,
      limit,
      restaurantInfo,
      restaurantConfig,
      nearDriver,
      driverConfig,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const prepareOrder = async (id, param) => {
  const order = await getVendorOrderById(id, param.vendorId);
  if (!order) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  // State machine (Batch F-2): an order reaches `preparing` from `created`
  // (or via `accepted` for scheduled orders) — never backwards, never skipped.
  assertFoodOrderTransition(order.status, 'preparing');
  const updateData = {
    status: 'preparing',
    preparationTime: param.time,
  };
  Object.assign(order, updateData);
  await order.save();
  if (param && param.driverId && param.driverId !== null && param.driverId !== '') {
    const { superseded } = await createManualRiderOffer({
      orderId: id,
      driverId: param.driverId,
      restaurantId: param.vendorId,
      deliveryAddressRaw: order.deliveryAddressRaw,
      selectedBy: param.user,
      selectionSource: 'vendor_app',
    });
    if (superseded) {
      await fcmNotificationService.driverRejectOrder(id, param.vendorId, superseded.driver);
    }
  }

  const restaurantInfo = await Restaurant.findById(param.vendorId);
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
        orderFrom: 'regular_order',
        restaurant: order.restaurant,
        regularOrder: id,
        posOrder: null,
        tableId: null,
        cartItemRaw: order.cartItemRaw,
        cookingInstruction: order.cookingInstruction,
        status: 'new',
      });
      await KitchenOrder.create(kitchenOrder);
      await fcmNotificationService.kitchenOwnerNewOrder('regular_order', param.vendorId);
    }
  }
  return order;
};

const acceptScheduleOrder = async (id, vendorId) => {
  const order = await getVendorOrderById(id, vendorId);
  if (!order) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  assertFoodOrderTransition(order.status, 'accepted');
  const updateData = {
    status: 'accepted',
  };
  Object.assign(order, updateData);
  await order.save();
  return { success: true };
};

const orderReady = async (id, vendorId) => {
  const order = await getVendorOrderById(id, vendorId);
  if (!order) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  assertFoodOrderTransition(order.status, 'ready');
  const updateData = {
    status: 'ready',
  };
  Object.assign(order, updateData);
  await order.save();
  return { success: true };
};

const getOrderMetaNotification = async (id) => {
  const orderInfo = await Orders.findById(id, { user: 1, restaurant: 1 });
  return orderInfo;
};

const getDriverNewOrderList = async (driverId) => {
  const orderQuery = [
    { $match: { driver: new mongoose.Types.ObjectId(driverId), driverOrderStatus: 'ideal' } },
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
      $lookup: {
        from: 'orders',
        localField: 'orderId',
        foreignField: '_id',
        as: 'orderInfo',
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
        path: '$orderInfo',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        driverOrderStatus: 1,
        orderFrom: 1,
        createdAt: 1,
        orderId: 1,
        orderNo: '$orderInfo.orderNo',
        deliveryTip: {
          $round: [{ $divide: ['$orderInfo.deliveryTip', 100] }, 2],
        },
        grandTotal: {
          $round: [{ $divide: ['$orderInfo.grandTotal', 100] }, 2],
        },
        deliveryAddressRaw: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$deliveryAddressRaw'],
            lang: 'js',
          },
        },
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
      },
    },
  ];
  const orders = await DriverNewOrderStatus.aggregate(orderQuery);
  if (orders != null && checkArrayNotEmpty(orders)) {
    const ordersSettings = await OrderSettings.findOne({}, { driverCanCancelOrder: 1 });
    const driverSettings = await DriverSettings.findOne(
      {},
      {
        showEarning: 1,
        earningModel: 1,
        earningOnOrder: 1,
        distanceRadiusForFixed: 1,
        earningFixedDistanceAmount: 1,
        earningAmount: 1,
        earningSurplusDistanceAmount: 1,
        haveIncentive: 1,
      }
    );
    const driverInfo = await Driver.findOne(
      {
        userId: new mongoose.Types.ObjectId(driverId),
      },
      { type: 1 }
    );
    const incentive = await DriverIncentive.find({ status: true });
    const businessSettings = await BusinessSettings.findOne({}, { findMode: 1, timezone: 1 });
    const findMode =
      businessSettings && businessSettings.findMode !== null && businessSettings.findMode !== ''
        ? businessSettings.findMode
        : 'km';
    let timezoneName = config.timezone;
    if (
      businessSettings &&
      businessSettings.timezone &&
      businessSettings.timezone !== null &&
      businessSettings.timezone.value !== null
    ) {
      if (checkArrayNotEmpty(businessSettings.timezone.utc)) {
        const timezoneNameSaved = businessSettings.timezone.utc[0];
        timezoneName = timezoneNameSaved;
      }
    }
    const currentTime = DateTime.now().setZone(timezoneName).toFormat('HH:mm');
    const currentShift = await DeliveryShiftSchedule.findOne({
      $expr: {
        $and: [{ $lte: ['$startTime', currentTime] }, { $gte: ['$endTime', currentTime] }],
      },
    });

    let extraShiftChargePercentage = 0;
    if (
      currentShift &&
      currentShift !== null &&
      currentShift.id &&
      currentShift.id !== null &&
      currentShift.id !== ''
    ) {
      extraShiftChargePercentage = currentShift.extraEarningPercentage;
    }

    return Promise.all([
      businessSettings,
      orders,
      ordersSettings,
      driverSettings,
      driverInfo,
      incentive,
      currentShift,
    ]).then(() => {
      const result = {
        findMode,
        orders,
        ordersSettings,
        driverSettings,
        driverInfo,
        incentive,
        extraShiftChargePercentage,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const getDriverNewOrderById = async (orderId) => {
  const orderInfo = await DriverNewOrderStatus.findOne({
    _id: new mongoose.Types.ObjectId(orderId),
  });
  return orderInfo;
};

function getPercentageAmount(totalAmount, percentage) {
  return (totalAmount * percentage) / 100;
}

const driverAcceptOrder = async (assignId, orderId, driver) => {
  const results = await DriverNewOrderStatus.find(
    { orderId: new mongoose.Types.ObjectId(orderId) },
    { driverOrderStatus: 1, deliveryAddressRaw: 1 }
  );
  const allOrderStatus = results.map((dm) => dm.driverOrderStatus);
  const ongoingOrders = [
    'accepted',
    'driver_reached_restaurant',
    'driver_pickpup_order',
    'driver_reached_customer',
    'delivered',
    'accepted_another',
  ];
  const hasAcceptedAny = await allOrderStatus.some((value) => ongoingOrders.includes(value));
  if (hasAcceptedAny) {
    const alreadyAccepted = await DriverNewOrderStatus.findOne({
      orderId: new mongoose.Types.ObjectId(orderId),
      driver: new mongoose.Types.ObjectId(driver),
    });
    const updateDataDriver = {
      driverOrderStatus: 'accepted_another',
    };
    Object.assign(alreadyAccepted, updateDataDriver);
    await alreadyAccepted.save();
    throw new ApiError(httpStatus.NOT_FOUND, 'Another Deliveryman Accepted Order');
  }
  let driverOrder = await getDriverNewOrderById(assignId);
  if (!driverOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const userOrder = await getVendorOrderById(driverOrder.orderId, driverOrder.restaurant);
  if (!userOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (userOrder.driver) {
    // Already claimed by someone else — fail fast with the rider-facing message
    // before doing any of the earnings work below.
    await DriverNewOrderStatus.updateOne(
      { _id: driverOrder._id, driverOrderStatus: 'ideal' },
      { $set: { driverOrderStatus: 'accepted_another' } }
    );
    throw new ApiError(httpStatus.CONFLICT, 'Another Deliveryman Accepted Order');
  }
  const driverSettings = await DriverSettings.findOne(
    {},
    {
      showEarning: 1,
      earningModel: 1,
      earningOnOrder: 1,
      distanceRadiusForFixed: 1,
      earningFixedDistanceAmount: 1,
      earningAmount: 1,
      earningSurplusDistanceAmount: 1,
      haveIncentive: 1,
    }
  );
  const incentive = await DriverIncentive.find({ status: true });
  const businessSettings = await BusinessSettings.findOne({}, { findMode: 1, timezone: 1 });
  const findMode =
    businessSettings && businessSettings.findMode !== null && businessSettings.findMode !== ''
      ? businessSettings.findMode
      : 'km';
  let timezoneName = config.timezone;
  if (
    businessSettings &&
    businessSettings.timezone &&
    businessSettings.timezone !== null &&
    businessSettings.timezone.value !== null
  ) {
    if (checkArrayNotEmpty(businessSettings.timezone.utc)) {
      const timezoneNameSaved = businessSettings.timezone.utc[0];
      timezoneName = timezoneNameSaved;
    }
  }
  const currentTime = DateTime.now().setZone(timezoneName).toFormat('HH:mm');
  const currentShift = await DeliveryShiftSchedule.findOne({
    $expr: {
      $and: [{ $lte: ['$startTime', currentTime] }, { $gte: ['$endTime', currentTime] }],
    },
  });

  let extraShiftChargePercentage = 0;
  if (
    currentShift &&
    currentShift !== null &&
    currentShift.id &&
    currentShift.id !== null &&
    currentShift.id !== ''
  ) {
    extraShiftChargePercentage = currentShift.extraEarningPercentage;
  }
  const orderGrandTotal = parseFloat(userOrder.grandTotal);
  const orderDeliveryTip = parseFloat(userOrder.deliveryTip);
  let incentiveAmount = 0;
  let extraEarningOnShiftAmount = 0;
  if (
    driverSettings !== null &&
    driverSettings.id !== null &&
    driverSettings.haveIncentive === true
  ) {
    if (incentive !== null && checkArrayNotEmpty(incentive)) {
      const indexOfIncentive = incentive.findIndex(
        (incentiveElement) => parseFloat(orderGrandTotal) >= parseFloat(incentiveElement.orderTotal)
      );
      if (indexOfIncentive !== -1) {
        incentiveAmount = parseFloat(incentive[indexOfIncentive].incentiveAmount);
      }
    }
  }
  const driverInfo = await Driver.findOne(
    {
      userId: new mongoose.Types.ObjectId(driver),
    },
    { type: 1, location: 1 }
  );
  const restaurantInfo = await Restaurant.findOne(
    {
      _id: new mongoose.Types.ObjectId(driverOrder.restaurant),
    },
    { location: 1, name: 1 }
  );
  let calculateEarning = false;
  if (
    driverInfo !== null &&
    driverInfo.id !== null &&
    driverInfo.type === 'freelancer' &&
    driverSettings !== null &&
    driverSettings.earningModel !== null &&
    driverSettings.earningModel === 'order'
  ) {
    calculateEarning = true;
  }

  let restaurantLocation = null;
  if (restaurantInfo !== null && restaurantInfo.id !== null && restaurantInfo.location !== null) {
    restaurantLocation = restaurantInfo.location.coordinates;
  }
  let deliveryLocation = null;
  if (driverOrder !== null && driverOrder.id !== null && driverOrder.deliveryAddressRaw !== null) {
    try {
      const addressInJson = JSON.parse(driverOrder.deliveryAddressRaw);
      if (addressInJson !== null && addressInJson.location !== null) {
        deliveryLocation = addressInJson.location.coordinates;
      }
      // eslint-disable-next-line no-unused-vars
    } catch (error) {
      //
    }
  }
  let totalOrderDistance = 0;
  if (deliveryLocation !== null && restaurantLocation !== null) {
    const distanceInMeter = haversineDistance(deliveryLocation, restaurantLocation);
    totalOrderDistance += distanceInMeter;
  }
  totalOrderDistance =
    findMode === 'km'
      ? parseFloat(totalOrderDistance / 1000)
      : parseFloat(totalOrderDistance / 1609.34);
  let earningOfOrder = 0;
  if (calculateEarning === true) {
    if (driverSettings !== null && driverSettings.earningOnOrder === 'distance') {
      if (
        driverSettings !== null &&
        driverSettings.distanceRadiusForFixed !== null &&
        parseFloat(driverSettings.distanceRadiusForFixed) >= parseFloat(totalOrderDistance)
      ) {
        extraEarningOnShiftAmount = getPercentageAmount(
          parseFloat(driverSettings.earningFixedDistanceAmount),
          parseFloat(extraShiftChargePercentage)
        );
        const totalEarningOfOrder = parseFloat(
          parseFloat(incentiveAmount) +
            parseFloat(orderDeliveryTip) +
            parseFloat(driverSettings.earningFixedDistanceAmount) +
            parseFloat(extraEarningOnShiftAmount)
        ).toFixed(2);
        earningOfOrder = parseFloat(totalEarningOfOrder);
      } else {
        const surplusDistance = parseFloat(
          parseFloat(totalOrderDistance) - parseFloat(driverSettings.distanceRadiusForFixed)
        ).toFixed(2);
        const surplusCount = (
          parseFloat(surplusDistance) * parseFloat(driverSettings.earningFixedDistanceAmount)
        ).toFixed(2);
        const canEarnAmount = parseFloat(
          parseFloat(driverSettings.earningFixedDistanceAmount) + parseFloat(surplusCount)
        ).toFixed(2);
        extraEarningOnShiftAmount = getPercentageAmount(
          parseFloat(canEarnAmount),
          parseFloat(extraShiftChargePercentage)
        );
        const totalEarningOfOrder = parseFloat(
          parseFloat(incentiveAmount) +
            parseFloat(orderDeliveryTip) +
            parseFloat(canEarnAmount) +
            parseFloat(extraEarningOnShiftAmount)
        ).toFixed(2);
        earningOfOrder = parseFloat(totalEarningOfOrder);
      }
    } else {
      const earningAmount =
        driverSettings !== null && driverSettings.earningAmount !== null
          ? parseFloat(driverSettings.earningAmount)
          : 0;
      extraEarningOnShiftAmount = getPercentageAmount(
        parseFloat(earningAmount),
        parseFloat(extraShiftChargePercentage)
      );
      const totalEarningOfOrder = parseFloat(
        parseFloat(incentiveAmount) +
          parseFloat(orderDeliveryTip) +
          parseFloat(earningAmount) +
          parseFloat(extraEarningOnShiftAmount)
      ).toFixed(2);
      earningOfOrder = parseFloat(totalEarningOfOrder);
    }
  } else {
    const extraEarning = parseFloat(
      parseFloat(incentiveAmount) + parseFloat(orderDeliveryTip)
    ).toFixed(2);
    earningOfOrder = parseFloat(extraEarning);
  }
  const updateDataDriver = {
    earning: earningOfOrder,
    tipAmount: `${orderDeliveryTip}`,
    incentiveAmount: `${incentiveAmount}`,
    driverOrderStatus: 'accepted',
    extraEarningOnShiftAmount: `${extraEarningOnShiftAmount}`,
    acceptedAt: new Date(),
  };

  // --- Atomic claim -------------------------------------------------------
  //
  // The read at the top of this function (`allOrderStatus` / `hasAcceptedAny`)
  // is a fast-fail that saves the rider a slow error, but it is NOT the guard:
  // two riders tapping Accept in the same instant both read `ideal`, both pass,
  // and both went on to save. That is the classic time-of-check/time-of-use hole
  // and it is why an order could end up with two accepted riders.
  //
  // The contended resource is `Orders.driver`. A single-document
  // `findOneAndUpdate` carrying `driver: null` in its filter is atomic on any
  // deployment, so no replica set or session is required and the accept path
  // keeps working on a standalone mongod.
  //
  // Order of operations: claim the offer, then claim the order. Losing the order
  // race rolls this rider back to `accepted_another`, which is exactly the state
  // the pre-check used to set — so the rider app sees no behavioural change.
  const claimedOffer = await DriverNewOrderStatus.findOneAndUpdate(
    { _id: driverOrder._id, driverOrderStatus: 'ideal' },
    { $set: updateDataDriver },
    { new: true }
  );
  if (!claimedOffer) {
    throw new ApiError(httpStatus.CONFLICT, 'This offer is no longer available');
  }

  const claimedOrder = await Orders.findOneAndUpdate(
    { _id: userOrder._id, driver: null },
    { $set: { driverAssign: 'assign', driver: claimedOffer.driver } },
    { new: true }
  );
  if (!claimedOrder) {
    await DriverNewOrderStatus.updateOne(
      { _id: driverOrder._id },
      { $set: { driverOrderStatus: 'accepted_another' } }
    );
    throw new ApiError(httpStatus.CONFLICT, 'Another Deliveryman Accepted Order');
  }
  driverOrder = claimedOffer;

  // Audit trail (Phase 3). Best-effort; never throws.
  await recordAssignmentEvent({
    order: String(userOrder._id),
    restaurant: driverOrder.restaurant ? String(driverOrder.restaurant) : null,
    type: 'accepted',
    actorType: 'rider',
    actor: driver ? String(driver) : null,
    reason: 'rider_accepted',
    ...(await orderZoneTag(userOrder._id)),
  });

  if (driverOrder !== null && driverOrder.driver !== null && driverOrder.driver !== '') {
    const activeOrderCount = await DriverNewOrderStatus.countDocuments({
      $and: [{ driver: new mongoose.Types.ObjectId(driverOrder.driver) }],
      $or: [
        { driverOrderStatus: 'accepted' },
        { driverOrderStatus: 'driver_reached_restaurant' },
        { driverOrderStatus: 'driver_pickpup_order' },
        { driverOrderStatus: 'driver_reached_customer' },
      ],
    });
    const driverDetail = await Driver.findOne({
      userId: new mongoose.Types.ObjectId(driverOrder.driver),
    });
    const handlingUpdate = {
      orderHandling: activeOrderCount,
    };
    Object.assign(driverDetail, handlingUpdate);
    await driverDetail.save();
  }
  return driverOrder;
};

const driverRejectOrder = async (id, reasonId) => {
  const driverOrder = await getDriverNewOrderById(id);
  if (!driverOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const userOrder = await getVendorOrderById(driverOrder.orderId, driverOrder.restaurant);
  if (!userOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateDataDriver = {
    driverOrderStatus: 'rejected',
    orderCancellation: reasonId,
  };
  Object.assign(driverOrder, updateDataDriver);
  await driverOrder.save();
  if (driverOrder !== null && driverOrder.orderFrom === 'manually') {
    const updateDataUser = {
      driverAssign: 'rejected',
    };
    Object.assign(userOrder, updateDataUser);
    await userOrder.save();
  }

  // Audit trail (Phase 3). Best-effort; never throws.
  await recordAssignmentEvent({
    order: String(driverOrder.orderId),
    restaurant: driverOrder.restaurant ? String(driverOrder.restaurant) : null,
    type: 'rejected',
    actorType: 'rider',
    actor: driverOrder.driver ? String(driverOrder.driver) : null,
    reason: 'rider_declined',
    ...(await orderZoneTag(driverOrder.orderId)),
  });

  return { driverOrder };
};

const driverActiveOrders = async (driverId) => {
  const queryCondition = {
    $and: [{ driver: new mongoose.Types.ObjectId(driverId) }],
    $or: [
      { driverOrderStatus: 'accepted' },
      { driverOrderStatus: 'driver_reached_restaurant' },
      { driverOrderStatus: 'driver_pickpup_order' },
      { driverOrderStatus: 'driver_reached_customer' },
    ],
  };
  const orderQuery = [
    { $match: queryCondition },
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
      $lookup: {
        from: 'orders',
        localField: 'orderId',
        foreignField: '_id',
        as: 'orders',
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
        path: '$orders',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        driverOrderStatus: 1,
        orderFrom: 1,
        createdAt: 1,
        orderId: 1,
        deliveryAddressRaw: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$deliveryAddressRaw'],
            lang: 'js',
          },
        },
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
        orderInfo: {
          id: { $ifNull: ['$orders._id', ''] },
          orderNo: { $ifNull: ['$orders.orderNo', 0] },
        },
      },
    },
  ];
  const orders = await DriverNewOrderStatus.aggregate(orderQuery);
  return orders;
};

const driverOrderDetails = async (orderId) => {
  const orderQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(orderId) } },
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
      $lookup: {
        from: 'deliveryinstructions',
        localField: 'deliveryInstruction',
        foreignField: '_id',
        as: 'deliveryinstructions',
      },
    },
    {
      $unwind: {
        path: '$deliveryinstructions',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'driverneworderstatuses',
        localField: '_id',
        foreignField: 'orderId',
        as: 'driverneworderstatuses',
      },
    },
    {
      $unwind: {
        path: '$driverneworderstatuses',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        orderNo: 1,
        status: 1,
        deliveryAddressRaw: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$deliveryAddressRaw'],
            lang: 'js',
          },
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
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        customerOrderPin: 1,
        driverOrderPin: 1,
        user: 1,
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        itemTotal: {
          $round: [{ $divide: ['$itemTotal', 100] }, 2],
        },
        couponDiscountCharge: {
          $round: [{ $divide: ['$couponDiscountCharge', 100] }, 2],
        },
        deliveryCharge: {
          $round: [{ $divide: ['$deliveryCharge', 100] }, 2],
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
        walletAmount: {
          $round: [{ $divide: ['$walletAmount', 100] }, 2],
        },
        deliveryTip: {
          $round: [{ $divide: ['$deliveryTip', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
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
        deliveryInstructionInfo: {
          id: { $ifNull: ['$deliveryinstructions._id', ''] },
          name: { $ifNull: ['$deliveryinstructions.name', ''] },
          image: { $ifNull: ['$deliveryinstructions.image', ''] },
          translations: { $ifNull: ['$deliveryinstructions.translations', []] },
        },
        orderExtraDetail: {
          earning: {
            $round: [{ $divide: [{ $ifNull: ['$driverneworderstatuses.earning', 0] }, 100] }, 2],
          },
          tipAmount: {
            $round: [{ $divide: [{ $ifNull: ['$driverneworderstatuses.tipAmount', 0] }, 100] }, 2],
          },
          incentiveAmount: {
            $round: [
              { $divide: [{ $ifNull: ['$driverneworderstatuses.incentiveAmount', 0] }, 100] },
              2,
            ],
          },
        },
      },
    },
  ];
  const orders = await Orders.aggregate(orderQuery);
  if (orders !== null && orders.length > 0) {
    const businessSettings = await BusinessSettings.findOne({}, { deliveryArea: 1, findMode: 1 });
    const findMode =
      businessSettings && businessSettings.findMode !== null && businessSettings.findMode !== ''
        ? businessSettings.findMode
        : 'km';
    const driverSettings = await DriverSettings.findOne(
      {},
      { pickupProof: 1, canInitiateCall: 1, canInitiateChat: 1, deliveryProof: 1 }
    );
    const orderSettings = await OrderSettings.findOne(
      {},
      { deliveryVerification: 1, driverCanCancelOrder: 1, orderConfirmationModel: 1 }
    );
    const details = orders[0];
    return Promise.all([orders, businessSettings, driverSettings, orderSettings]).then(() => {
      const result = {
        details,
        findMode,
        driverSettings,
        orderSettings,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const driverReachedRestaurant = async (id) => {
  const driverOrder = await DriverNewOrderStatus.findOne({
    orderId: new mongoose.Types.ObjectId(id),
  });
  if (!driverOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateDataUser = {
    driverOrderStatus: 'driver_reached_restaurant',
  };
  Object.assign(driverOrder, updateDataUser);
  await driverOrder.save();
  return driverOrder;
};

const restuarantOrderHandoverDriver = async (id, vendorId) => {
  const order = await getVendorOrderById(id, vendorId);
  if (!order) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  assertFoodOrderTransition(order.status, 'handover');
  const updateData = {
    status: 'handover',
  };
  Object.assign(order, updateData);
  await order.save();
  return { success: true };
};

const restaurantOrderHandoverCustomer = async (id, vendorId) => {
  const order = await getVendorOrderById(id, vendorId);
  if (!order) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  if (order && order.coupon && order.coupon !== null && order.coupon !== '') {
    const couponInfo = await Coupon.findById(order.coupon);
    if (couponInfo && couponInfo !== null && couponInfo.id !== null && couponInfo.id !== '') {
      if (couponInfo.createdBy === 'admin' && parseFloat(order.couponDiscountCharge) > 0) {
        const expenseData = new AdminExpense({
          expenseType: `coupon`,
          coupon: order.coupon,
          diningCoupon: null,
          diningBooking: null,
          order: id,
          user: order.user,
          amount: order.couponDiscountCharge,
        });
        await AdminExpense.create(expenseData);
      } else if (couponInfo.createdBy !== 'admin' && parseFloat(order.couponDiscountCharge) > 0) {
        const expenseData = new RestaurantExpense({
          expenseType: `coupon`,
          restaurant: order.restaurant,
          coupon: order.coupon,
          diningCoupon: null,
          diningBooking: null,
          order: id,
          posOrder: null,
          tableOrder: null,
          user: order.user,
          amount: order.couponDiscountCharge,
        });
        await RestaurantExpense.create(expenseData);
      }
    }
  }

  if (order && parseFloat(order.itemDiscount) > 0) {
    const expenseData = new RestaurantExpense({
      expenseType: `order_product_discout`,
      restaurant: order.restaurant,
      coupon: null,
      diningCoupon: null,
      diningBooking: null,
      order: id,
      posOrder: null,
      tableOrder: null,
      user: order.user,
      amount: order.itemDiscount,
    });
    await RestaurantExpense.create(expenseData);
  }
  if (order !== null && order.paymentMode === 'offline') {
    const cashInHandData = {
      orders: order.id,
      payment: order.payment,
      restaurant: order.restaurant,
      grandTotal: order.grandTotal,
    };
    await restaurantCashInHandService.saveCashInHand(cashInHandData);
  } else {
    const restaurantEarningCount = parseFloat(
      parseFloat(order.itemTotal) +
        parseFloat(order.packageCharge) +
        parseFloat(order.packageChargeTax)
    ).toFixed(2);
    await restaurantService.addMoneyToWalletAfterDelivery(restaurantEarningCount, vendorId, id);
  }
  const updateData = {
    status: 'delivered',
  };
  assertFoodOrderTransition(order.status, 'delivered');
  Object.assign(order, updateData);
  await order.save();
  return { success: true };
};

const driverPickupOrder = async (id, vendorId) => {
  const userOrder = await getVendorOrderById(id, vendorId);
  if (!userOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  assertFoodOrderTransition(userOrder.status, 'ongoing');
  const updateDataUserOrder = {
    status: 'ongoing',
  };
  Object.assign(userOrder, updateDataUserOrder);
  await userOrder.save();
  const driverOrder = await DriverNewOrderStatus.findOne({
    orderId: new mongoose.Types.ObjectId(id),
  });
  // const driverOrder = await getDriverNewOrderById(id);
  if (!driverOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateDataUser = {
    driverOrderStatus: 'driver_pickpup_order',
  };
  Object.assign(driverOrder, updateDataUser);
  await driverOrder.save();
  return driverOrder;
};

const driverReachedCustomer = async (id) => {
  const driverOrder = await DriverNewOrderStatus.findOne({
    orderId: new mongoose.Types.ObjectId(id),
  });
  if (!driverOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateDataUser = {
    driverOrderStatus: 'driver_reached_customer',
  };
  Object.assign(driverOrder, updateDataUser);
  await driverOrder.save();
  return driverOrder;
};

const driverDeliverOrder = async (orderId, driverId) => {
  const driverOrder = await DriverNewOrderStatus.findOne({
    orderId: new mongoose.Types.ObjectId(orderId),
    driver: new mongoose.Types.ObjectId(driverId),
  });
  if (!driverOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const driverInfo = await User.findById(driverId);
  if (!driverInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Invalid Deliveryman');
  }
  if (driverOrder !== null && driverOrder.earning !== null && parseFloat(driverOrder.earning) > 0) {
    await driverService.addMoneyToWalletAfterDelivery(driverOrder.earning, driverId, orderId);
  }
  const updateDataUser = {
    driverOrderStatus: 'delivered',
    deliveredAt: new Date(),
  };
  Object.assign(driverOrder, updateDataUser);
  await driverOrder.save();
  if (driverOrder !== null && driverOrder.restaurant !== null && driverOrder.restaurant !== '') {
    const userOrder = await getVendorOrderById(orderId, driverOrder.restaurant);
    if (!userOrder) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
    }
    if (userOrder && userOrder.coupon && userOrder.coupon !== null && userOrder.coupon !== '') {
      const couponInfo = await Coupon.findById(userOrder.coupon);
      if (couponInfo && couponInfo !== null && couponInfo.id !== null && couponInfo.id !== '') {
        if (couponInfo.createdBy === 'admin' && parseFloat(userOrder.couponDiscountCharge) > 0) {
          const expenseData = new AdminExpense({
            expenseType: `coupon`,
            coupon: userOrder.coupon,
            diningCoupon: null,
            diningBooking: null,
            order: orderId,
            posOrder: null,
            tableOrder: null,
            user: userOrder.user,
            amount: userOrder.couponDiscountCharge,
          });
          await AdminExpense.create(expenseData);
        } else if (
          couponInfo.createdBy !== 'admin' &&
          parseFloat(userOrder.couponDiscountCharge) > 0
        ) {
          const expenseData = new RestaurantExpense({
            expenseType: `coupon`,
            restaurant: userOrder.restaurant,
            coupon: userOrder.coupon,
            diningCoupon: null,
            diningBooking: null,
            order: orderId,
            posOrder: null,
            tableOrder: null,
            user: userOrder.user,
            amount: userOrder.couponDiscountCharge,
          });
          await RestaurantExpense.create(expenseData);
        }
      }
    }

    if (userOrder && parseFloat(userOrder.itemDiscount) > 0) {
      const expenseData = new RestaurantExpense({
        expenseType: `order_product_discout`,
        restaurant: userOrder.restaurant,
        coupon: null,
        diningCoupon: null,
        diningBooking: null,
        order: orderId,
        posOrder: null,
        tableOrder: null,
        user: userOrder.user,
        amount: userOrder.itemDiscount,
      });
      await RestaurantExpense.create(expenseData);
    }

    if (
      driverOrder &&
      driverOrder !== null &&
      driverOrder.earning !== null &&
      driverOrder.earning !== '' &&
      parseFloat(driverOrder.earning) > 0
    ) {
      if (parseFloat(driverOrder.earning) > parseFloat(userOrder.deliveryCharge)) {
        const deliveryExpenceTotal = parseFloat(
          parseFloat(driverOrder.earning) - parseFloat(userOrder.deliveryCharge)
        ).toFixed(2);
        const expenseData = new AdminExpense({
          expenseType: `delivery_charge`,
          coupon: null,
          diningCoupon: null,
          diningBooking: null,
          order: orderId,
          user: userOrder.user,
          amount: deliveryExpenceTotal,
        });
        await AdminExpense.create(expenseData);
      } else {
        const deliveryExpenceTotal = parseFloat(
          parseFloat(userOrder.deliveryCharge) - parseFloat(driverOrder.earning)
        ).toFixed(2);
        const expenseData = new AdminExpense({
          expenseType: `delivery_charge`,
          coupon: null,
          diningCoupon: null,
          diningBooking: null,
          order: orderId,
          user: userOrder.user,
          amount: deliveryExpenceTotal,
        });
        await AdminExpense.create(expenseData);
      }
    }
    if (userOrder !== null && userOrder.paymentMode === 'offline') {
      if (driverInfo && driverInfo !== null && driverInfo.role === 'driver') {
        const deliverymanCashInHandData = {
          orders: orderId,
          payment: userOrder.payment,
          deliveryman: driverId,
          grandTotal: userOrder.grandTotal,
        };
        await deliverymanCashInHandService.saveCashInHand(deliverymanCashInHandData);
        const earningFromOrder = parseFloat(
          parseFloat(userOrder.itemTotal) +
            parseFloat(userOrder.packageCharge) +
            parseFloat(userOrder.packageChargeTax)
        ).toFixed(2);
        await restaurantService.addMoneyToWalletAfterDelivery(
          earningFromOrder,
          userOrder.restaurant,
          orderId
        );
      } else {
        const cashInHandData = {
          orders: orderId,
          payment: userOrder.payment,
          restaurant: userOrder.restaurant,
          grandTotal: userOrder.grandTotal,
        };
        await restaurantCashInHandService.saveCashInHand(cashInHandData);
      }
    } else {
      const earningFromOrder = parseFloat(
        parseFloat(userOrder.itemTotal) +
          parseFloat(userOrder.packageCharge) +
          parseFloat(userOrder.packageChargeTax)
      ).toFixed(2);
      await restaurantService.addMoneyToWalletAfterDelivery(
        earningFromOrder,
        userOrder.restaurant,
        orderId
      );
    }
    const updateDataUserOrder = {
      status: 'delivered',
      driverAssign: 'ideal',
    };
    Object.assign(userOrder, updateDataUserOrder);
    await userOrder.save();
  }
  if (driverOrder !== null && driverOrder.driver !== null && driverOrder.driver !== '') {
    const activeOrderCount = await DriverNewOrderStatus.countDocuments({
      $and: [{ driver: new mongoose.Types.ObjectId(driverOrder.driver) }],
      $or: [
        { driverOrderStatus: 'accepted' },
        { driverOrderStatus: 'driver_reached_restaurant' },
        { driverOrderStatus: 'driver_pickpup_order' },
        { driverOrderStatus: 'driver_reached_customer' },
      ],
    });
    const orderInfo = await Driver.findOne({
      userId: new mongoose.Types.ObjectId(driverOrder.driver),
    });
    const handlingUpdate = {
      orderHandling: activeOrderCount,
    };
    Object.assign(orderInfo, handlingUpdate);
    await orderInfo.save();
  }

  await DriverNewOrderStatus.updateMany(
    { orderId: new mongoose.Types.ObjectId(orderId) },
    { $set: { driverOrderStatus: 'delivered' } }
  );

  return driverOrder;
};

const getOrderCounts = async () => {
  const all = await Orders.countDocuments();
  const fresh = await Orders.countDocuments({ status: 'created' });
  const accepted = await Orders.countDocuments({ status: 'accepted' });
  const preparing = await Orders.countDocuments({ status: 'preparing' });
  const ready = await Orders.countDocuments({ status: 'ready' });
  const handover = await Orders.countDocuments({ status: 'handover' });
  const ongoing = await Orders.countDocuments({ status: 'ongoing' });
  const delivered = await Orders.countDocuments({ status: 'delivered' });
  const cancelled = await Orders.countDocuments({ status: 'cancelled' });
  const rejected = await Orders.countDocuments({ status: 'rejected' });
  const refunded = await Orders.countDocuments({ status: 'refunded' });
  const partially = await Orders.countDocuments({ status: 'partially_refunded' });
  const pending = await Orders.countDocuments({ status: 'pending_payments' });
  const schedule = await Orders.countDocuments({
    scheduleOrder: true,
    subscriptionOrder: false,
  });
  return Promise.all([
    all,
    fresh,
    accepted,
    preparing,
    ready,
    handover,
    ongoing,
    delivered,
    cancelled,
    rejected,
    refunded,
    partially,
    pending,
    schedule,
  ]).then(() => {
    const result = {
      all,
      fresh,
      accepted,
      preparing,
      ready,
      handover,
      ongoing,
      delivered,
      cancelled,
      rejected,
      refunded,
      partially,
      pending,
      schedule,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityzenOrderCounts = async (masterId) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  const allCount = await Orders.aggregate([
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
  const freshCount = await Orders.aggregate([
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
  const acceptedCount = await Orders.aggregate([
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
  const preparingCount = await Orders.aggregate([
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
        status: 'preparing',
      },
    },
    { $count: 'totalCount' },
  ]);
  const readyCount = await Orders.aggregate([
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
        status: 'ready',
      },
    },
    { $count: 'totalCount' },
  ]);
  const handoverCount = await Orders.aggregate([
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
        status: 'handover',
      },
    },
    { $count: 'totalCount' },
  ]);
  const ongoingCount = await Orders.aggregate([
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
        status: 'ongoing',
      },
    },
    { $count: 'totalCount' },
  ]);
  const deliveredCount = await Orders.aggregate([
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
        status: 'delivered',
      },
    },
    { $count: 'totalCount' },
  ]);
  const cancelledCount = await Orders.aggregate([
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
  const rejectedCount = await Orders.aggregate([
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
  const refundedCount = await Orders.aggregate([
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
  const partiallyCount = await Orders.aggregate([
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
  const pendingCount = await Orders.aggregate([
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
  const scheduleCount = await Orders.aggregate([
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
        scheduleOrder: true,
        subscriptionOrder: false,
      },
    },
    { $count: 'totalCount' },
  ]);
  return Promise.all([
    cityzen,
    allCount,
    freshCount,
    acceptedCount,
    preparingCount,
    readyCount,
    handoverCount,
    ongoingCount,
    deliveredCount,
    cancelledCount,
    rejectedCount,
    refundedCount,
    partiallyCount,
    pendingCount,
    scheduleCount,
  ]).then(() => {
    const all = checkArrayNotEmpty(allCount) ? allCount[0].totalCount : 0;
    const fresh = checkArrayNotEmpty(freshCount) ? freshCount[0].totalCount : 0;
    const accepted = checkArrayNotEmpty(acceptedCount) ? acceptedCount[0].totalCount : 0;
    const preparing = checkArrayNotEmpty(preparingCount) ? preparingCount[0].totalCount : 0;
    const ready = checkArrayNotEmpty(readyCount) ? readyCount[0].totalCount : 0;
    const handover = checkArrayNotEmpty(handoverCount) ? handoverCount[0].totalCount : 0;
    const ongoing = checkArrayNotEmpty(ongoingCount) ? ongoingCount[0].totalCount : 0;
    const delivered = checkArrayNotEmpty(deliveredCount) ? deliveredCount[0].totalCount : 0;
    const cancelled = checkArrayNotEmpty(cancelledCount) ? cancelledCount[0].totalCount : 0;
    const rejected = checkArrayNotEmpty(rejectedCount) ? rejectedCount[0].totalCount : 0;
    const refunded = checkArrayNotEmpty(refundedCount) ? refundedCount[0].totalCount : 0;
    const partially = checkArrayNotEmpty(partiallyCount) ? partiallyCount[0].totalCount : 0;
    const pending = checkArrayNotEmpty(pendingCount) ? pendingCount[0].totalCount : 0;
    const schedule = checkArrayNotEmpty(scheduleCount) ? scheduleCount[0].totalCount : 0;
    const result = {
      all,
      fresh,
      accepted,
      preparing,
      ready,
      handover,
      ongoing,
      delivered,
      cancelled,
      rejected,
      refunded,
      partially,
      pending,
      schedule,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getAdminOrderList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const searchRegExp = RegExp(options.search, 'i');
  const isValidObjectId = mongoose.Types.ObjectId.isValid(options.search);
  const numericSearch = Number(options.search);
  const isNumericSearch = !Number.isNaN(numericSearch);
  const orderStatus = options.status;
  const orderMatch = {
    $or: [
      isNumericSearch ? { orderNo: numericSearch } : null,
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
    $and: [orderStatus !== 'all' ? { status: orderStatus } : { status: { $ne: 'all' } }],
  };
  const orderQuery = [
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
        orderNo: 1,
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        paymentMode: 1,
        status: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        scheduleDate: 1,
        scheduleTime: 1,
        orderAt: 1,
        createdAt: 1,
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        orderTo: 1,
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
  const orders = await Orders.aggregate(orderQuery);
  const countResult = await Orders.aggregate([
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
  return Promise.all([orders, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      orders,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityzenOrderList = async (masterId, orderStatus, options) => {
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
  let statusCondition = {};
  if (orderStatus !== 'all' && orderStatus !== 'schedule') {
    statusCondition = { status: orderStatus };
  } else if (orderStatus !== 'schedule') {
    statusCondition = { status: { $ne: 'all' } };
  } else {
    statusCondition = { scheduleOrder: true };
  }
  const orderMatch = {
    $or: [
      isNumericSearch ? { orderNo: numericSearch } : null,
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
    $and: [statusCondition, { 'restaurants.city': new mongoose.Types.ObjectId(city) }],
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
        orderNo: 1,
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        paymentMode: 1,
        status: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        scheduleDate: 1,
        scheduleTime: 1,
        orderAt: 1,
        createdAt: 1,
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        orderTo: 1,
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
  const orders = await Orders.aggregate(orderQuery);
  const countResult = await Orders.aggregate([
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
  return Promise.all([orders, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      orders,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getAdminScheduleOrderList = async (options) => {
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
    $and: [{ scheduleOrder: true, subscriptionOrder: false }],
  };
  const orderQuery = [
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
        orderNo: 1,
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        paymentMode: 1,
        status: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        scheduleDate: 1,
        scheduleTime: 1,
        orderAt: 1,
        createdAt: 1,
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        orderTo: 1,
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
  const orders = await Orders.aggregate(orderQuery);
  const countResult = await Orders.aggregate([
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
  return Promise.all([orders, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      orders,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getAdminSubscriptionOrderList = async (options) => {
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
    $and: [{ subscriptionOrder: true }],
  };
  const orderQuery = [
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
      $lookup: {
        from: 'subscriptiontiffinpackages',
        localField: 'tiffinSubscription',
        foreignField: '_id',
        as: 'subscriptiontiffinpackages',
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
        path: '$subscriptiontiffinpackages',
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
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        paymentMode: 1,
        status: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        scheduleDate: 1,
        scheduleTime: 1,
        orderAt: 1,
        createdAt: 1,
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        orderTo: 1,
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
        subscriptionTiffinPackage: {
          id: { $ifNull: ['$subscriptiontiffinpackages._id', ''] },
          name: { $ifNull: ['$subscriptiontiffinpackages.name', ''] },
          available: { $ifNull: ['$subscriptiontiffinpackages.available', ''] },
          orderTo: { $ifNull: ['$subscriptiontiffinpackages.orderTo', ''] },
          translations: { $ifNull: ['$subscriptiontiffinpackages.translations', []] },
        },
      },
    },
  ];
  const orders = await Orders.aggregate(orderQuery);
  const countResult = await Orders.aggregate([
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
  return Promise.all([orders, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      orders,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityzenSubscriptionOrderList = async (masterId, options) => {
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
    $and: [{ subscriptionOrder: true }, { 'restaurants.city': new mongoose.Types.ObjectId(city) }],
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
      $lookup: {
        from: 'subscriptiontiffinpackages',
        localField: 'tiffinSubscription',
        foreignField: '_id',
        as: 'subscriptiontiffinpackages',
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
        path: '$subscriptiontiffinpackages',
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
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $project: {
        _id: 0,
        id: '$_id',
        orderNo: 1,
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        paymentMode: 1,
        status: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        scheduleDate: 1,
        scheduleTime: 1,
        orderAt: 1,
        createdAt: 1,
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        orderTo: 1,
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
        subscriptionTiffinPackage: {
          id: { $ifNull: ['$subscriptiontiffinpackages._id', ''] },
          name: { $ifNull: ['$subscriptiontiffinpackages.name', ''] },
          available: { $ifNull: ['$subscriptiontiffinpackages.available', ''] },
          orderTo: { $ifNull: ['$subscriptiontiffinpackages.orderTo', ''] },
          translations: { $ifNull: ['$subscriptiontiffinpackages.translations', []] },
        },
      },
    },
  ];
  const orders = await Orders.aggregate(orderQuery);
  const countResult = await Orders.aggregate([
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
  return Promise.all([orders, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      orders,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const restaurantRejectOrder = async (id, reasonId, vendorId) => {
  const userOrder = await getVendorOrderById(id, vendorId);
  if (!userOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateDataDriver = {
    status: 'rejected',
    orderCancellation: reasonId,
  };
  Object.assign(userOrder, updateDataDriver);
  await userOrder.save();
  return userOrder;
};

const getUserOrderDetail = async (orderId, userId) => {
  const orderQuery = [
    {
      $match: {
        _id: new mongoose.Types.ObjectId(orderId),
        user: new mongoose.Types.ObjectId(userId),
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
        from: 'users',
        localField: 'driver',
        foreignField: '_id',
        as: 'driver',
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
        path: '$driver',
        preserveNullAndEmptyArrays: true,
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
      $lookup: {
        from: 'deliveryinstructions',
        localField: 'deliveryInstruction',
        foreignField: '_id',
        as: 'deliveryinstructions',
      },
    },
    {
      $unwind: {
        path: '$deliveryinstructions',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'favouriteorders',
        localField: 'user',
        foreignField: 'user',
        as: 'favouriteorders',
        pipeline: [
          {
            $match: {
              user: new mongoose.Types.ObjectId(userId),
              order: new mongoose.Types.ObjectId(orderId),
            },
          },
        ],
      },
    },
    {
      $addFields: {
        isFavouriteOrder: {
          $cond: {
            if: { $eq: [{ $size: '$favouriteorders' }, 0] },
            then: false,
            else: true,
          },
        },
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
        orderNo: 1,
        status: 1,
        deliveryAddressRaw: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$deliveryAddressRaw'],
            lang: 'js',
          },
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
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        customerOrderPin: 1,
        driverOrderPin: 1,
        user: 1,
        cookingInstruction: 1,
        createdAt: 1,
        scheduleDate: 1,
        orderAt: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        scheduleTime: 1,
        orderTo: 1,
        timeDifferenceOfOrderInMinutes: 1,
        isFavouriteOrder: 1,
        ratingSaved: 1,
        subscriptionOrder: 1,
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
        couponDiscountCharge: {
          $round: [{ $divide: ['$couponDiscountCharge', 100] }, 2],
        },
        deliveryCharge: {
          $round: [{ $divide: ['$deliveryCharge', 100] }, 2],
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
        walletAmount: {
          $round: [{ $divide: ['$walletAmount', 100] }, 2],
        },
        deliveryTip: {
          $round: [{ $divide: ['$deliveryTip', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          slug: { $ifNull: ['$restaurants.slug', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          location: { $ifNull: ['$restaurants.location', null] },
          userId: { $ifNull: ['$restaurants.userId', ''] },
          license: { $ifNull: ['$restaurants.license', ''] },
          licenseId: { $ifNull: ['$restaurants.licenseId', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          slug: { $ifNull: ['$paymentconfigs.slug', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        deliveryInstructionInfo: {
          id: { $ifNull: ['$deliveryinstructions._id', ''] },
          name: { $ifNull: ['$deliveryinstructions.name', ''] },
          image: { $ifNull: ['$deliveryinstructions.image', ''] },
          translations: { $ifNull: ['$deliveryinstructions.translations', []] },
        },
        driverInfo: {
          id: { $ifNull: ['$driver._id', ''] },
          firstName: { $ifNull: ['$driver.firstName', ''] },
          lastName: { $ifNull: ['$driver.lastName', ''] },
          image: { $ifNull: ['$driver.image', ''] },
          role: { $ifNull: ['$driver.role', ''] },
          location: { $ifNull: ['$driver.location', null] },
        },
      },
    },
  ];
  const orders = await Orders.aggregate(orderQuery);
  if (orders !== null && orders.length > 0) {
    const businessSettings = await BusinessSettings.findOne(
      {},
      { deliveryArea: 1, findMode: 1, refundRequest: 1 }
    );
    const findMode =
      businessSettings && businessSettings.findMode !== null && businessSettings.findMode !== ''
        ? businessSettings.findMode
        : 'km';
    const driverSettings = await DriverSettings.findOne(
      {},
      { pickupProof: 1, canInitiateCall: 1, canInitiateChat: 1, deliveryProof: 1 }
    );
    const orderSettings = await OrderSettings.findOne(
      {},
      { deliveryVerification: 1, driverCanCancelOrder: 1, orderConfirmationModel: 1 }
    );
    const restaurantSettings = await RestaurantSettings.findOne(
      {},
      { canInitiateChat: 1, canInitiateCall: 1 }
    );
    const details = orders[0];
    let restUserInfo = null;
    let restaurantLicense = null;
    if (details !== null && details.restaurant !== null && details.restaurant.userId !== null) {
      restUserInfo = await User.findById(details.restaurant.userId, {
        firstName: 1,
        lastName: 1,
        mobile: 1,
        countryCode: 1,
        role: 1,
        image: 1,
      });
      if (
        restUserInfo !== null &&
        restUserInfo.firstName !== null &&
        restUserInfo.mobile !== null
      ) {
        const maskedNumber = `${restUserInfo.mobile.substring(0, 3)}XXXXXX${restUserInfo.mobile.substring(
          restUserInfo.mobile.length - 3
        )}`;
        restUserInfo.mobile = maskedNumber;
      }
    }

    if (details !== null && details.restaurant !== null && details.restaurant.license !== null) {
      restaurantLicense = await RestaurantFoodLicense.findById(details.restaurant.license, {
        image: 1,
        name: 1,
        website: 1,
        translations: 1,
      });
    }
    let driverOrderDeliveredCount = 0;
    if (
      details !== null &&
      details.driverInfo !== null &&
      details.driverInfo &&
      details.driverInfo.id !== null &&
      details.driverInfo.id !== ''
    ) {
      driverOrderDeliveredCount = await Orders.countDocuments({
        driver: details.driverInfo.id,
        status: 'delivered',
      });
    }
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

    return Promise.all([
      orders,
      businessSettings,
      driverSettings,
      orderSettings,
      restaurantSettings,
      restUserInfo,
      restaurantLicense,
      driverOrderDeliveredCount,
      payments,
      primary,
    ]).then(() => {
      const result = {
        details,
        findMode,
        businessSettings,
        driverSettings,
        orderSettings,
        restaurantSettings,
        restUserInfo,
        restaurantLicense,
        driverOrderCount: driverOrderDeliveredCount,
        payments,
        primary,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const getOrderDetailForReview = async (orderId, userId) => {
  const orderQuery = [
    {
      $match: {
        _id: new mongoose.Types.ObjectId(orderId),
        user: new mongoose.Types.ObjectId(userId),
        status: 'delivered',
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
        from: 'users',
        localField: 'driver',
        foreignField: '_id',
        as: 'driver',
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
        path: '$driver',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        cartItem: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$cartItemRaw'],
            lang: 'js',
          },
        },
        user: 1,
        orderTo: 1,
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          slug: { $ifNull: ['$restaurants.slug', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        driverInfo: {
          id: { $ifNull: ['$driver._id', ''] },
          firstName: { $ifNull: ['$driver.firstName', ''] },
          lastName: { $ifNull: ['$driver.lastName', ''] },
          image: { $ifNull: ['$driver.image', ''] },
          role: { $ifNull: ['$driver.role', ''] },
          location: { $ifNull: ['$driver.location', null] },
        },
      },
    },
  ];
  const orders = await Orders.aggregate(orderQuery);
  if (orders !== null && orders.length > 0) {
    const details = orders[0];
    let driverOrderDeliveredCount = 0;
    if (
      details !== null &&
      details.driverInfo !== null &&
      details.driverInfo &&
      details.driverInfo.id !== null &&
      details.driverInfo.id !== ''
    ) {
      driverOrderDeliveredCount = await Orders.countDocuments({
        driver: details.driverInfo.id,
        status: 'delivered',
      });
    }
    const orderSettings = await OrderSettings.findOne({}, { ratingStyle: 1 });
    const messages = await OrderRatingMessages.find({ status: true });
    return Promise.all([orders, driverOrderDeliveredCount, orderSettings, messages]).then(() => {
      const result = {
        details,
        driverOrderCount: driverOrderDeliveredCount,
        orderSettings,
        messages,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const cancelOrderByUser = async (orderId, reasonId) => {
  const userOrder = await Orders.findById(orderId);
  if (!userOrder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const updateDataDriver = {
    status: 'cancelled',
    orderCancellation: reasonId,
  };
  Object.assign(userOrder, updateDataDriver);
  await userOrder.save();
  return userOrder;
};

const getOrderDetailForComplaints = async (orderId) => {
  const orderQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(orderId) } },
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
        from: 'users',
        localField: 'driver',
        foreignField: '_id',
        as: 'driver',
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
        path: '$driver',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        orderTo: 1,
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
          logo: { $ifNull: ['$restaurants.logo', ''] },
          cover: { $ifNull: ['$restaurants.cover', ''] },
          slug: { $ifNull: ['$restaurants.slug', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          location: { $ifNull: ['$restaurants.location', null] },
          userId: { $ifNull: ['$restaurants.userId', ''] },
          license: { $ifNull: ['$restaurants.license', ''] },
          licenseId: { $ifNull: ['$restaurants.licenseId', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        driverInfo: {
          id: { $ifNull: ['$driver._id', ''] },
          firstName: { $ifNull: ['$driver.firstName', ''] },
          lastName: { $ifNull: ['$driver.lastName', ''] },
          image: { $ifNull: ['$driver.image', ''] },
          role: { $ifNull: ['$driver.role', ''] },
        },
      },
    },
  ];
  const orders = await Orders.aggregate(orderQuery);
  if (orders !== null && orders.length > 0) {
    const details = orders[0];
    const orderComplaintsReason = await ComplaintsReason.find();
    return Promise.all([orders, orderComplaintsReason]).then(() => {
      const result = {
        details,
        reason: orderComplaintsReason,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const fetchDriverPhoneNumber = async (driverID) => {
  const driverInfo = await User.findById(driverID, { countryCode: 1, mobile: 1 });
  if (!driverInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const result = {
    success: true,
    detail: {
      id: driverID,
      contactInfo: { countryCode: driverInfo.countryCode, contactNumber: driverInfo.mobile },
    },
  };
  return result;
};

/**
 * `$lookup` for offers that are still live on an order.
 *
 * An order whose only problem is that a rider never answered sits at
 * `driverAssign: 'ideal'` with one `ideal` `DriverNewOrderStatus` open forever —
 * there is no timeout. Excluding `ideal` from the un-assigned queue (as this
 * list used to) made exactly those orders invisible to operations, which is the
 * failure mode this stage exists to expose.
 */
const liveOfferLookupStage = () => ({
  $lookup: {
    from: DriverNewOrderStatus.collection.name,
    localField: '_id',
    foreignField: 'orderId',
    as: '_liveOffers',
    pipeline: [
      { $match: { driverOrderStatus: 'ideal' } },
      { $project: { _id: 0, orderId: 1, driver: 1 } },
    ],
  },
});

/**
 * `driverAssign` clause shared by the admin and city-master un-assigned queues.
 *
 * Escalated orders (`rejected` / `notfound` / `hardreject`) always belong here.
 * An order still at `ideal` belongs here only when nothing is live on it — i.e.
 * it was never offered, or every offer closed without an assignment.
 */
const unAssignedDriverAssignClause = {
  $or: [
    { driverAssign: { $in: ['rejected', 'notfound', 'hardreject'] } },
    { driverAssign: 'ideal', '_liveOffers': { $eq: [] } },
  ],
};

const getAdminUnAssignedOrderList = async (options) => {
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
      { orderTo: 'homedelivery' },
      { driver: null },
      { status: { $in: ['preparing', 'ready'] } },
      unAssignedDriverAssignClause,
    ],
  };
  const orderQuery = [
    liveOfferLookupStage(),
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
        orderNo: 1,
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        paymentMode: 1,
        status: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        scheduleDate: 1,
        scheduleTime: 1,
        orderAt: 1,
        createdAt: 1,
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        orderTo: 1,
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
  const orders = await Orders.aggregate(orderQuery);
  const countResult = await Orders.aggregate([
    liveOfferLookupStage(),
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
  return Promise.all([orders, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      orders,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityzenUnAssignedOrderList = async (masterId, options) => {
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
      { orderTo: 'homedelivery' },
      { driver: null },
      unAssignedDriverAssignClause,
      { status: { $in: ['preparing', 'ready'] } },
      { 'restaurants.city': new mongoose.Types.ObjectId(city) },
    ],
  };
  const orderQuery = [
    liveOfferLookupStage(),
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
        orderNo: 1,
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        paymentMode: 1,
        status: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        scheduleDate: 1,
        scheduleTime: 1,
        orderAt: 1,
        createdAt: 1,
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        orderTo: 1,
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
  const orders = await Orders.aggregate(orderQuery);
  const countResult = await Orders.aggregate([
    liveOfferLookupStage(),
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
  return Promise.all([orders, countResult]).then(() => {
    const totalResults = checkArrayNotEmpty(countResult) ? countResult[0].totalCount : 0;
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      orders,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const fetchDriverNearToOrder = async (orderId, restaurantId) => {
  const restaurantInfo = await Restaurant.findById(restaurantId, {
    type: 1,
    isOutlet: 1,
    outletManagerId: 1,
    city: 1,
    name: 1,
    location: 1,
    ownDriver: 1,
  });
  if (!restaurantInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  let ownDriver = false;
  if (
    restaurantInfo !== null &&
    restaurantInfo.type === 'derived' &&
    restaurantInfo.isOutlet === true &&
    restaurantInfo.outletManagerId !== null
  ) {
    const outletManager = await restaurantService.getRestaurantByIdVendorLogin(
      restaurantInfo.outletManagerId
    );
    if (outletManager !== null && outletManager.id !== null) {
      ownDriver = outletManager.ownDriver;
    }
  } else {
    ownDriver = restaurantInfo.ownDriver;
  }
  const storeLatitude =
    restaurantInfo !== null &&
    restaurantInfo.location !== null &&
    restaurantInfo.location.coordinates !== null &&
    restaurantInfo.location.coordinates.length > 0
      ? restaurantInfo.location.coordinates[1]
      : 0.0;
  const storeLongitude =
    restaurantInfo !== null &&
    restaurantInfo.location !== null &&
    restaurantInfo.location.coordinates !== null &&
    restaurantInfo.location.coordinates.length > 0
      ? restaurantInfo.location.coordinates[0]
      : 0.0;
  const queryPoint = { type: 'Point', coordinates: [storeLongitude, storeLatitude] };
  const businessSettings = await BusinessSettings.findOne({}, { deliveryArea: 1, findMode: 1 });
  const findMode =
    businessSettings && businessSettings.findMode !== null && businessSettings.findMode !== ''
      ? businessSettings.findMode
      : 'km';
  const radius =
    businessSettings &&
    businessSettings.deliveryArea !== null &&
    businessSettings.deliveryArea !== ''
      ? businessSettings.deliveryArea
      : 10;
  const driverConfig = await DriverSettings.findOne({}, { maxOrderLimit: 1 });
  const maxOrderLimit =
    driverConfig && driverConfig.maxOrderLimit !== null && driverConfig.maxOrderLimit !== ''
      ? driverConfig.maxOrderLimit
      : 1;
  const radiusInMeters = findMode === 'km' ? radius * 1000 : radius * 1609.34; // 1000 = 1 kilometer
  const nearestDriver = {
    $geoNear: {
      near: queryPoint,
      maxDistance: radiusInMeters, // Comment Out For Global Drivers
      distanceField: 'distance',
      distanceMultiplier: findMode === 'km' ? 1 / 1000 : 1 / 1609.34,
      query:
        ownDriver === true
          ? {
              city: new mongoose.Types.ObjectId(restaurantInfo.city),
              isBlocked: false,
              activeStatus: true,
              restaurant: new mongoose.Types.ObjectId(restaurantId),
            }
          : {
              city: new mongoose.Types.ObjectId(restaurantInfo.city),
              isBlocked: false,
              activeStatus: true,
              restaurant: null,
              orderHandling: { $lte: maxOrderLimit },
            },
    },
  };
  const driverQuery = [
    nearestDriver,
    { $sort: { distance: 1 } },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'users',
      },
    },
    {
      $lookup: {
        from: 'driverorderreviews',
        localField: 'userId',
        foreignField: 'driver',
        as: 'driverorderreviews',
      },
    },
    {
      $unwind: {
        path: '$users',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        type: 1,
        orderHandling: 1,
        rating: 1,
        totalRating: {
          $size: '$driverorderreviews',
        },
        distance: 1,
        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          mobile: { $ifNull: ['$users.mobile', ''] },
        },
      },
    },
  ];
  const drivers = await Driver.aggregate(driverQuery);
  if (!checkArrayNotEmpty(drivers)) {
    const orderInfo = await Orders.findById(orderId);
    if (orderInfo) {
      Object.assign(orderInfo, { driverAssign: 'notfound' });
      await orderInfo.save();
    }
  }
  return Promise.all([drivers, restaurantInfo, businessSettings]).then(() => {
    const result = {
      drivers,
      findMode,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const assignDriverOrderAdmin = async (id, driverId, actor) => {
  const orderDetails = await Orders.findById(id, { restaurant: 1, deliveryAddressRaw: 1 });
  if (!orderDetails) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await createManualRiderOffer({
    orderId: id,
    driverId,
    restaurantId: orderDetails.restaurant,
    deliveryAddressRaw: orderDetails.deliveryAddressRaw,
    selectedBy: (actor && (actor.id || actor._id)) || null,
    selectionSource: 'admin',
  });
  return orderDetails;
};

const assignDriverOrderVendor = async (id, driverId, actor) => {
  const orderDetails = await Orders.findById(id, { restaurant: 1, deliveryAddressRaw: 1 });
  if (!orderDetails) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await createManualRiderOffer({
    orderId: id,
    driverId,
    restaurantId: orderDetails.restaurant,
    deliveryAddressRaw: orderDetails.deliveryAddressRaw,
    selectedBy: (actor && (actor.id || actor._id)) || null,
    selectionSource: 'vendor_web',
  });
  return orderDetails;
};

const vendorOrderCountWeb = async (vendorId) => {
  const newOrders = await Orders.countDocuments({
    $and: [{ restaurant: new mongoose.Types.ObjectId(vendorId) }],
    $or: [{ status: 'created' }, { status: 'accepted' }],
  });
  const preparingOrders = await Orders.countDocuments({
    $and: [{ restaurant: new mongoose.Types.ObjectId(vendorId), status: 'preparing' }],
  });
  const readyOrder = await Orders.countDocuments({
    $and: [{ restaurant: new mongoose.Types.ObjectId(vendorId), status: 'ready' }],
  });
  const handOverOrder = await Orders.countDocuments({
    $and: [{ restaurant: new mongoose.Types.ObjectId(vendorId), status: 'handover' }],
  });
  const ongoingOrder = await Orders.countDocuments({
    $and: [{ restaurant: new mongoose.Types.ObjectId(vendorId), status: 'ongoing' }],
  });
  const deliveredOrder = await Orders.countDocuments({
    $and: [{ restaurant: new mongoose.Types.ObjectId(vendorId), status: 'delivered' }],
  });
  const rejectedOrder = await Orders.countDocuments({
    $and: [{ restaurant: new mongoose.Types.ObjectId(vendorId), status: 'rejected' }],
  });
  return Promise.all([
    newOrders,
    preparingOrders,
    readyOrder,
    ongoingOrder,
    deliveredOrder,
    rejectedOrder,
    handOverOrder,
  ]).then(() => {
    const result = {
      newOrders,
      preparingOrders,
      readyOrder,
      ongoingOrder,
      deliveredOrder,
      rejectedOrder,
      handOverOrder,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const vendorOrderListWeb = async (vendorId, orderStatus, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  let queryCondition = {};
  if (orderStatus !== 'new') {
    queryCondition = {
      $and: [{ restaurant: new mongoose.Types.ObjectId(vendorId), status: orderStatus }],
    };
  } else {
    queryCondition = {
      $and: [{ restaurant: new mongoose.Types.ObjectId(vendorId) }],
      $or: [{ status: 'created' }, { status: 'accepted' }],
    };
  }

  const orderSettings = await OrderSettings.findOne(
    {},
    {
      restaurantCanCancelOrder: 1,
      driverCanCancelOrder: 1,
      deliveryVerification: 1,
      orderConfirmationModel: 1,
    }
  );

  const restaurantInfo = await Restaurant.findOne(
    { _id: new mongoose.Types.ObjectId(vendorId) },
    { name: 1, location: 1, logo: 1, cover: 1, ownDriver: 1, isOutlet: 1, outletManagerId: 1 }
  );

  // Pool resolution is shared with the vendor picker and the auto engine.
  //
  // The block this replaced was one of THREE identical copies of the same
  // ternary, and they had drifted in two ways that showed wrong numbers on a
  // vendor screen: the platform branch carried no `restaurant: null` filter, so
  // "riders nearby" counted other restaurants own riders as well, and the
  // own-fleet branch queried the outlet own id instead of the parent, so a
  // derived outlet always counted zero.
  const pool = await resolveRiderPool(vendorId);
  const restaurantConfig = await RestaurantSettings.findOne(
    {},
    { canInitiateCall: 1, canInitiateChat: 1, driverPickup: 1, platformDriverPickup: 1 }
  );
  const driverConfig = await DriverSettings.findOne({}, { maxOrderLimit: 1 });
  const storeLatitude =
    restaurantInfo !== null &&
    restaurantInfo.location !== null &&
    restaurantInfo.location.coordinates !== null &&
    restaurantInfo.location.coordinates.length > 0
      ? restaurantInfo.location.coordinates[1]
      : 0.0;
  const storeLongitude =
    restaurantInfo !== null &&
    restaurantInfo.location !== null &&
    restaurantInfo.location.coordinates !== null &&
    restaurantInfo.location.coordinates.length > 0
      ? restaurantInfo.location.coordinates[0]
      : 0.0;
  const businessSettings = await BusinessSettings.findOne({}, { deliveryArea: 1, findMode: 1 });
  const radius =
    businessSettings &&
    businessSettings.deliveryArea !== null &&
    businessSettings.deliveryArea !== ''
      ? businessSettings.deliveryArea
      : 10;
  const findMode =
    businessSettings && businessSettings.findMode !== null && businessSettings.findMode !== ''
      ? businessSettings.findMode
      : 'km';
  const radiusInMeters = findMode === 'km' ? radius * 1000 : radius * 1609.34; // 1000 = 1 kilometer
  let nearDriver = 0;
  const driverFindQueryCondition = buildPoolQuery(pool);
  if (orderStatus === 'preparing') {
    const queryPoint = { type: 'Point', coordinates: [storeLongitude, storeLatitude] };
    const nearestDriver = {
      $geoNear: {
        near: queryPoint,
        maxDistance: radiusInMeters,
        distanceField: 'distance',
        distanceMultiplier: findMode === 'km' ? 1 / 1000 : 1 / 1609.34,
        query: driverFindQueryCondition,
      },
    };
    const nearDriverCount = await Driver.aggregate([nearestDriver, { $count: 'count' }]);
    nearDriver = nearDriverCount.length > 0 ? nearDriverCount[0].count : 0;
  }
  const orderQuery = [
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
        from: 'users',
        localField: 'driver',
        foreignField: '_id',
        as: 'drivers',
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
        path: '$drivers',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        cartItem: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$cartItemRaw'],
            lang: 'js',
          },
        },
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        itemTotal: {
          $round: [{ $divide: ['$itemTotal', 100] }, 2],
        },
        couponDiscountCharge: {
          $round: [{ $divide: ['$couponDiscountCharge', 100] }, 2],
        },
        deliveryCharge: {
          $round: [{ $divide: ['$deliveryCharge', 100] }, 2],
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
        walletAmount: {
          $round: [{ $divide: ['$walletAmount', 100] }, 2],
        },
        deliveryTip: {
          $round: [{ $divide: ['$deliveryTip', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        paymentMode: 1,
        cookingInstruction: 1,
        preparationTime: {
          $round: [{ $divide: ['$preparationTime', 100] }, 2],
        },
        status: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        scheduleDate: 1,
        scheduleTime: 1,
        orderAt: 1,
        createdAt: 1,
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        orderTo: 1,
        userOrderCount: 1,
        driverAssign: 1,
        driverOrderPin: 1,
        customerOrderPin: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
        },
        driverInfo: {
          id: { $ifNull: ['$drivers._id', ''] },
          firstName: { $ifNull: ['$drivers.firstName', ''] },
          lastName: { $ifNull: ['$drivers.lastName', ''] },
          image: { $ifNull: ['$drivers.image', ''] },
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
  const orders = await Orders.aggregate(orderQuery);
  const totalResults = await Orders.countDocuments(queryCondition);
  return Promise.all([
    orderSettings,
    orders,
    restaurantInfo,
    restaurantConfig,
    nearDriver,
    driverConfig,
    totalResults,
  ]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      orders,
      orderSettings,
      totalPages,
      totalResults,
      page,
      limit,
      restaurantInfo,
      restaurantConfig,
      nearDriver,
      driverConfig,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const vendorOrderDetail = async (orderId, vendorId) => {
  const orderQuery = [
    {
      $match: {
        _id: new mongoose.Types.ObjectId(orderId),
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
        from: 'users',
        localField: 'driver',
        foreignField: '_id',
        as: 'drivers',
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
        from: 'deliveryinstructions',
        localField: 'deliveryInstruction',
        foreignField: '_id',
        as: 'deliveryinstructions',
      },
    },
    {
      $unwind: {
        path: '$deliveryinstructions',
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
      $unwind: {
        path: '$drivers',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        orderNo: 1,
        cartItem: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$cartItemRaw'],
            lang: 'js',
          },
        },
        deliveryAddressRaw: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$deliveryAddressRaw'],
            lang: 'js',
          },
        },
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
        couponDiscountCharge: {
          $round: [{ $divide: ['$couponDiscountCharge', 100] }, 2],
        },
        deliveryCharge: {
          $round: [{ $divide: ['$deliveryCharge', 100] }, 2],
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
        walletAmount: {
          $round: [{ $divide: ['$walletAmount', 100] }, 2],
        },
        deliveryTip: {
          $round: [{ $divide: ['$deliveryTip', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        paymentMode: 1,
        cookingInstruction: 1,
        preparationTime: {
          $round: [{ $divide: ['$preparationTime', 100] }, 2],
        },
        status: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        scheduleDate: 1,
        scheduleTime: 1,
        orderAt: 1,
        createdAt: 1,
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        orderTo: 1,
        userOrderCount: 1,
        driverAssign: 1,
        driverOrderPin: 1,
        customerOrderPin: 1,
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
        driverInfo: {
          id: { $ifNull: ['$drivers._id', ''] },
          firstName: { $ifNull: ['$drivers.firstName', ''] },
          lastName: { $ifNull: ['$drivers.lastName', ''] },
          image: { $ifNull: ['$drivers.image', ''] },
          countryCode: { $ifNull: ['$drivers.countryCode', ''] },
          contactNumber: { $ifNull: ['$drivers.contactNumber', ''] },
          contactEmail: { $ifNull: ['$drivers.contactEmail', ''] },
          role: { $ifNull: ['$drivers.role', ''] },
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          slug: { $ifNull: ['$paymentconfigs.slug', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        deliveryInstructionInfo: {
          id: { $ifNull: ['$deliveryinstructions._id', ''] },
          name: { $ifNull: ['$deliveryinstructions.name', ''] },
          image: { $ifNull: ['$deliveryinstructions.image', ''] },
          translations: { $ifNull: ['$deliveryinstructions.translations', []] },
        },
      },
    },
  ];
  const orders = await Orders.aggregate(orderQuery);
  if (!orders[0]) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const orderSettings = await OrderSettings.findOne(
    {},
    {
      restaurantCanCancelOrder: 1,
      driverCanCancelOrder: 1,
      deliveryVerification: 1,
      orderConfirmationModel: 1,
    }
  );
  const restaurantInfo = await Restaurant.findOne(
    { _id: new mongoose.Types.ObjectId(vendorId) },
    {
      name: 1,
      location: 1,
      logo: 1,
      cover: 1,
      ownDriver: 1,
      isOutlet: 1,
      outletManagerId: 1,
      translations: 1,
    }
  );

  // Pool resolution is shared with the vendor picker and the auto engine.
  //
  // The block this replaced was one of THREE identical copies of the same
  // ternary, and they had drifted in two ways that showed wrong numbers on a
  // vendor screen: the platform branch carried no `restaurant: null` filter, so
  // "riders nearby" counted other restaurants own riders as well, and the
  // own-fleet branch queried the outlet own id instead of the parent, so a
  // derived outlet always counted zero.
  const pool = await resolveRiderPool(vendorId);
  const restaurantConfig = await RestaurantSettings.findOne(
    {},
    { canInitiateCall: 1, canInitiateChat: 1, driverPickup: 1, platformDriverPickup: 1 }
  );
  const driverConfig = await DriverSettings.findOne({}, { maxOrderLimit: 1 });
  const storeLatitude =
    restaurantInfo !== null &&
    restaurantInfo.location !== null &&
    restaurantInfo.location.coordinates !== null &&
    restaurantInfo.location.coordinates.length > 0
      ? restaurantInfo.location.coordinates[1]
      : 0.0;
  const storeLongitude =
    restaurantInfo !== null &&
    restaurantInfo.location !== null &&
    restaurantInfo.location.coordinates !== null &&
    restaurantInfo.location.coordinates.length > 0
      ? restaurantInfo.location.coordinates[0]
      : 0.0;
  const businessSettings = await BusinessSettings.findOne({}, { deliveryArea: 1, findMode: 1 });
  const radius =
    businessSettings &&
    businessSettings.deliveryArea !== null &&
    businessSettings.deliveryArea !== ''
      ? businessSettings.deliveryArea
      : 10;
  const findMode =
    businessSettings && businessSettings.findMode !== null && businessSettings.findMode !== ''
      ? businessSettings.findMode
      : 'km';
  const radiusInMeters = findMode === 'km' ? radius * 1000 : radius * 1609.34; // 1000 = 1 kilometer
  let nearDriver = 0;
  const driverFindQueryCondition = buildPoolQuery(pool);
  const queryPoint = { type: 'Point', coordinates: [storeLongitude, storeLatitude] };
  const nearestDriver = {
    $geoNear: {
      near: queryPoint,
      maxDistance: radiusInMeters,
      distanceField: 'distance',
      distanceMultiplier: findMode === 'km' ? 1 / 1000 : 1 / 1609.34,
      query: driverFindQueryCondition,
    },
  };
  const nearDriverCount = await Driver.aggregate([nearestDriver, { $count: 'count' }]);
  nearDriver = nearDriverCount.length > 0 ? nearDriverCount[0].count : 0;
  const detail = orders[0];
  return Promise.all([
    orderSettings,
    detail,
    restaurantInfo,
    restaurantConfig,
    nearDriver,
    driverConfig,
  ]).then(() => {
    const result = {
      detail,
      orderSettings,
      restaurantInfo,
      restaurantConfig,
      nearDriver,
      driverConfig,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const callCustomer = async (orderId, vendorId) => {
  const orderInfo = await Orders.findOne(
    {
      _id: new mongoose.Types.ObjectId(orderId),
      restaurant: new mongoose.Types.ObjectId(vendorId),
    },
    { user: 1, orderTo: 1, countryCode: 1, receiverContact: 1 }
  );
  if (!orderInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const userInfo = await User.findOne(
    { _id: new mongoose.Types.ObjectId(orderInfo.user) },
    { countryCode: 1, mobile: 1 }
  );
  return Promise.all([orderInfo, userInfo]).then(() => {
    const result = {
      orderInfo,
      userInfo,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const callDeliveryman = async (orderId, vendorId) => {
  const orderInfo = await Orders.findOne(
    {
      _id: new mongoose.Types.ObjectId(orderId),
      restaurant: new mongoose.Types.ObjectId(vendorId),
    },
    { driver: 1 }
  );
  if (!orderInfo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const driverInfo = await User.findOne(
    { _id: new mongoose.Types.ObjectId(orderInfo.driver) },
    { countryCode: 1, mobile: 1 }
  );
  return Promise.all([orderInfo, driverInfo]).then(() => {
    const result = {
      orderInfo,
      driverInfo,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const getOrderDetailAdmin = async (orderId) => {
  const orderDetailQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(orderId) } },
    { $limit: 1 },
    {
      $lookup: {
        from: 'users',
        localField: 'driver',
        foreignField: '_id',
        as: 'driver',
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
        path: '$driver',
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
      $lookup: {
        from: 'deliveryinstructions',
        localField: 'deliveryInstruction',
        foreignField: '_id',
        as: 'deliveryinstructions',
      },
    },
    {
      $unwind: {
        path: '$deliveryinstructions',
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
        orderNo: 1,
        status: 1,
        deliveryAddressRaw: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$deliveryAddressRaw'],
            lang: 'js',
          },
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
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        customerOrderPin: 1,
        driverOrderPin: 1,
        user: 1,
        cookingInstruction: 1,
        createdAt: 1,
        scheduleDate: 1,
        orderAt: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        scheduleTime: 1,
        orderTo: 1,
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
        couponDiscountCharge: {
          $round: [{ $divide: ['$couponDiscountCharge', 100] }, 2],
        },
        deliveryCharge: {
          $round: [{ $divide: ['$deliveryCharge', 100] }, 2],
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
        walletAmount: {
          $round: [{ $divide: ['$walletAmount', 100] }, 2],
        },
        deliveryTip: {
          $round: [{ $divide: ['$deliveryTip', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        deliveryInstructionInfo: {
          id: { $ifNull: ['$deliveryinstructions._id', ''] },
          name: { $ifNull: ['$deliveryinstructions.name', ''] },
          image: { $ifNull: ['$deliveryinstructions.image', ''] },
          translations: { $ifNull: ['$deliveryinstructions.translations', []] },
        },
        driverInfo: {
          id: { $ifNull: ['$driver._id', ''] },
          firstName: { $ifNull: ['$driver.firstName', ''] },
          lastName: { $ifNull: ['$driver.lastName', ''] },
          image: { $ifNull: ['$driver.image', ''] },
          countryCode: { $ifNull: ['$driver.countryCode', ''] },
          contactNumber: { $ifNull: ['$driver.contactNumber', ''] },
          role: { $ifNull: ['$driver.role', ''] },
          contactEmail: { $ifNull: ['$driver.contactEmail', ''] },
        },
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
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
  const orders = await Orders.aggregate(orderDetailQuery);
  if (orders !== null && orders.length > 0) {
    const info = orders[0];
    const deliveryProof = await OrderDeliveryProof.findOne({
      orderId: new mongoose.Types.ObjectId(orderId),
    });
    const userTotalOrderCount = await Orders.countDocuments({
      user: new mongoose.Types.ObjectId(info.user),
    });
    let driverDeliveredOrder = 0;
    if (
      info !== null &&
      info.orderTo === 'homedelivery' &&
      info.driverInfo !== null &&
      info.driverInfo.id !== null &&
      info.driverInfo.id !== ''
    ) {
      driverDeliveredOrder = await Orders.countDocuments({
        driver: new mongoose.Types.ObjectId(info.driverInfo.id),
        status: 'delivered',
      });
    }
    let restUserInfo = null;
    if (info !== null && info.restaurant !== null && info.restaurant.userId !== null) {
      restUserInfo = await User.findById(info.restaurant.userId, {
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
    let storeOrderCount = 0;
    if (
      info !== null &&
      info.restaurant !== null &&
      info.restaurant.id !== null &&
      info.restaurant.id !== ''
    ) {
      storeOrderCount = await Orders.countDocuments({
        restaurant: new mongoose.Types.ObjectId(info.restaurant.id),
        status: 'delivered',
      });
    }
    return Promise.all([
      info,
      deliveryProof,
      userTotalOrderCount,
      driverDeliveredOrder,
      restUserInfo,
      storeOrderCount,
    ]).then(() => {
      const result = {
        info,
        deliveryProof,
        userTotalOrderCount,
        driverDeliveredOrder,
        restUserInfo,
        storeOrderCount,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const getOrderDetailForRestaurantComplaint = async (orderId, vendorId) => {
  const orderQuery = [
    {
      $match: {
        _id: new mongoose.Types.ObjectId(orderId),
        restaurant: new mongoose.Types.ObjectId(vendorId),
      },
    },
    { $limit: 1 },
    {
      $lookup: {
        from: 'users',
        localField: 'driver',
        foreignField: '_id',
        as: 'driver',
      },
    },
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
        path: '$driver',
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
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        orderTo: 1,
        driverInfo: {
          id: { $ifNull: ['$driver._id', ''] },
          firstName: { $ifNull: ['$driver.firstName', ''] },
          lastName: { $ifNull: ['$driver.lastName', ''] },
          image: { $ifNull: ['$driver.image', ''] },
          role: { $ifNull: ['$driver.role', ''] },
        },
        customer: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
      },
    },
  ];
  const orders = await Orders.aggregate(orderQuery);
  if (orders !== null && orders.length > 0) {
    const details = orders[0];
    const orderComplaintsReason = await ComplaintsReason.find();
    return Promise.all([orders, orderComplaintsReason]).then(() => {
      const result = {
        details,
        reason: orderComplaintsReason,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const vendorOrderBusinessInsight = async (vendor) => {
  const currentMonth = new Date().getUTCMonth() + 1;
  const monthTotalSoldData = await Orders.aggregate([
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
        totalSum: { $sum: '$itemTotal' },
        averageSum: { $avg: '$itemTotal' },
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
  const weekTotalSoldData = await Orders.aggregate([
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
        totalSum: { $sum: '$itemTotal' },
        averageSum: { $avg: '$itemTotal' },
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
  const todayTotalSoldData = await Orders.aggregate([
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
        totalSum: { $sum: '$itemTotal' },
        averageSum: { $avg: '$itemTotal' },
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
  const monthChartData = await Orders.aggregate([
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
        soldCount: { $sum: '$itemTotal' },
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
  const weekChartData = await Orders.aggregate([
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
        soldCount: { $sum: '$itemTotal' },
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
  const todayChartData = await Orders.aggregate([
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
        soldCount: { $sum: '$itemTotal' },
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
  const monthlyTrendingFoods = await Orders.aggregate([
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
  const weeklyTrendingFoods = await Orders.aggregate([
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
  const todayTrendingFoods = await Orders.aggregate([
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

const vendorOrderCustomDateBusinessInsight = async (vendor, from, to) => {
  const startDate = new Date(from);
  const endDate = new Date(to);
  const totalSoldData = await Orders.aggregate([
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
        totalSum: { $sum: '$itemTotal' },
        averageSum: { $avg: '$itemTotal' },
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
  const chartData = await Orders.aggregate([
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
        soldCount: { $sum: '$itemTotal' },
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
  const trendingFoods = await Orders.aggregate([
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

const vendorWebOverallDashboardBusinessInsight = async (vendor) => {
  const newOrder = await Orders.countDocuments({
    $or: [{ status: 'created' }, { status: 'accepted' }],
    restaurant: new mongoose.Types.ObjectId(vendor),
  });
  const preparingOrder = await Orders.countDocuments({
    status: 'preparing',
    restaurant: new mongoose.Types.ObjectId(vendor),
  });
  const readyOrder = await Orders.countDocuments({
    status: 'ready',
    restaurant: new mongoose.Types.ObjectId(vendor),
  });
  const handoverOrder = await Orders.countDocuments({
    status: 'handover',
    restaurant: new mongoose.Types.ObjectId(vendor),
  });
  const ongoingOrder = await Orders.countDocuments({
    status: 'ongoing',
    restaurant: new mongoose.Types.ObjectId(vendor),
  });
  const deliveredOrder = await Orders.countDocuments({
    status: 'delivered',
    restaurant: new mongoose.Types.ObjectId(vendor),
  });
  const rejectedOrder = await Orders.countDocuments({
    status: 'rejected',
    restaurant: new mongoose.Types.ObjectId(vendor),
  });
  const allOrder = await Orders.countDocuments({
    restaurant: new mongoose.Types.ObjectId(vendor),
  });
  /// Order Insight ///
  const orderTotalSoldData = await Orders.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$itemTotal' },
        averageSum: { $avg: '$itemTotal' },
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
  const orderChartData = await Orders.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        soldCount: { $sum: '$itemTotal' },
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
  const orderTrendingFoods = await Orders.aggregate([
    {
      $match: {
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
  const minMaxOrderData = await Orders.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
      },
    },
    {
      $group: {
        _id: null,
        minCreatedAt: { $min: '$createdAt' },
        maxCreatedAt: { $max: '$createdAt' },
      },
    },
    {
      $project: {
        _id: 0, // Exclude the _id field
        minCreatedAt: {
          $dateToString: { format: '%Y-%m-%d', date: '$minCreatedAt' },
        },
        maxCreatedAt: {
          $dateToString: { format: '%Y-%m-%d', date: '$maxCreatedAt' },
        },
      },
    },
  ]);
  /// Order Insight ///

  // POS Insight ///
  const posTotalSoldData = await PosOrTableOrder.aggregate([
    {
      $match: {
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
  const posChartData = await PosOrTableOrder.aggregate([
    {
      $match: {
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
  const posTrendingFoods = await PosOrTableOrder.aggregate([
    {
      $match: {
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
  const minMaxPosData = await PosOrTableOrder.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
      },
    },
    {
      $group: {
        _id: null,
        minCreatedAt: { $min: '$createdAt' },
        maxCreatedAt: { $max: '$createdAt' },
      },
    },
    {
      $project: {
        _id: 0, // Exclude the _id field
        minCreatedAt: {
          $dateToString: { format: '%Y-%m-%d', date: '$minCreatedAt' },
        },
        maxCreatedAt: {
          $dateToString: { format: '%Y-%m-%d', date: '$maxCreatedAt' },
        },
      },
    },
  ]);
  // POS Insight ///

  /// Table Order Insight ///
  const tableOrderTotalSoldData = await TableOrder.aggregate([
    {
      $match: {
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
  const tableOrderChartData = await TableOrder.aggregate([
    {
      $match: {
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
  const tableOrderTrendingFoods = await TableOrder.aggregate([
    {
      $match: {
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
  const minMaxTableOrderData = await TableOrder.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
      },
    },
    {
      $group: {
        _id: null,
        minCreatedAt: { $min: '$createdAt' },
        maxCreatedAt: { $max: '$createdAt' },
      },
    },
    {
      $project: {
        _id: 0, // Exclude the _id field
        minCreatedAt: {
          $dateToString: { format: '%Y-%m-%d', date: '$minCreatedAt' },
        },
        maxCreatedAt: {
          $dateToString: { format: '%Y-%m-%d', date: '$maxCreatedAt' },
        },
      },
    },
  ]);
  /// Table Order Insight ///

  const restaurantInfo = await Restaurant.findById(vendor);
  const permission = {
    pos: false,
    tableOrder: false,
  };
  if (
    restaurantInfo !== null &&
    restaurantInfo.type === 'derived' &&
    restaurantInfo.isOutlet === true &&
    restaurantInfo.outletManagerId !== null
  ) {
    const outletManager = await Restaurant.findById(restaurantInfo.outletManagerId);
    if (outletManager !== null && outletManager.id !== null) {
      permission.pos = outletManager.pos;
      permission.tableOrder = outletManager.tableOrder;
    }
  } else {
    permission.pos = restaurantInfo.pos;
    permission.tableOrder = restaurantInfo.tableOrder;
  }
  return Promise.all([
    newOrder,
    preparingOrder,
    readyOrder,
    handoverOrder,
    ongoingOrder,
    deliveredOrder,
    rejectedOrder,
    allOrder,
    orderTotalSoldData,
    orderChartData,
    orderTrendingFoods,
    minMaxOrderData,
    posTotalSoldData,
    posChartData,
    posTrendingFoods,
    minMaxPosData,
    tableOrderTotalSoldData,
    tableOrderChartData,
    tableOrderTrendingFoods,
    minMaxTableOrderData,
    restaurantInfo,
    permission,
  ]).then(() => {
    const orderTotalSold = {
      totalSold: 0,
      averageSold: 0,
    };
    const orderMinMaxDate = {
      min: '',
      max: '',
    };
    const posTotalSold = {
      totalSold: 0,
      averageSold: 0,
    };
    const posMinMaxDate = {
      min: '',
      max: '',
    };
    const tableOrderTotalSold = {
      totalSold: 0,
      averageSold: 0,
    };
    const tableOrderMinMaxDate = {
      min: '',
      max: '',
    };
    if (checkArrayNotEmpty(orderTotalSoldData)) {
      orderTotalSold.totalSold = orderTotalSoldData[0].totalSold;
      orderTotalSold.averageSold = orderTotalSoldData[0].averageSold;
    }
    if (checkArrayNotEmpty(minMaxOrderData)) {
      orderMinMaxDate.min = minMaxOrderData[0].minCreatedAt;
      orderMinMaxDate.max = minMaxOrderData[0].maxCreatedAt;
    }
    if (checkArrayNotEmpty(posTotalSoldData)) {
      posTotalSold.totalSold = posTotalSoldData[0].totalSold;
      posTotalSold.averageSold = posTotalSoldData[0].averageSold;
    }
    if (checkArrayNotEmpty(minMaxPosData)) {
      posMinMaxDate.min = minMaxPosData[0].minCreatedAt;
      posMinMaxDate.max = minMaxPosData[0].maxCreatedAt;
    }
    if (checkArrayNotEmpty(tableOrderTotalSoldData)) {
      tableOrderTotalSold.totalSold = tableOrderTotalSoldData[0].totalSold;
      tableOrderTotalSold.averageSold = tableOrderTotalSoldData[0].averageSold;
    }
    if (checkArrayNotEmpty(minMaxTableOrderData)) {
      tableOrderMinMaxDate.min = minMaxTableOrderData[0].minCreatedAt;
      tableOrderMinMaxDate.max = minMaxTableOrderData[0].maxCreatedAt;
    }
    const result = {
      newOrder,
      preparingOrder,
      readyOrder,
      handoverOrder,
      ongoingOrder,
      deliveredOrder,
      rejectedOrder,
      allOrder,
      orderTotalSold,
      orderChartData,
      orderTrendingFoods,
      orderMinMaxDate,
      posTotalSold,
      posChartData,
      posTrendingFoods,
      posMinMaxDate,
      tableOrderTotalSold,
      tableOrderChartData,
      tableOrderTrendingFoods,
      tableOrderMinMaxDate,
      permission,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const vendorWebMonthlyDashboardBusinessInsight = async (vendor) => {
  const startOfMonth = DateTime.now().startOf('month').toJSDate();
  const endOfMonth = DateTime.now().endOf('month').toJSDate();
  const newOrder = await Orders.countDocuments({
    $or: [{ status: 'created' }, { status: 'accepted' }],
    restaurant: new mongoose.Types.ObjectId(vendor),
    createdAt: { $gte: startOfMonth, $lt: endOfMonth },
  });
  const preparingOrder = await Orders.countDocuments({
    status: 'preparing',
    restaurant: new mongoose.Types.ObjectId(vendor),
    createdAt: { $gte: startOfMonth, $lt: endOfMonth },
  });
  const readyOrder = await Orders.countDocuments({
    status: 'ready',
    restaurant: new mongoose.Types.ObjectId(vendor),
    createdAt: { $gte: startOfMonth, $lt: endOfMonth },
  });
  const handoverOrder = await Orders.countDocuments({
    status: 'handover',
    restaurant: new mongoose.Types.ObjectId(vendor),
    createdAt: { $gte: startOfMonth, $lt: endOfMonth },
  });
  const ongoingOrder = await Orders.countDocuments({
    status: 'ongoing',
    restaurant: new mongoose.Types.ObjectId(vendor),
    createdAt: { $gte: startOfMonth, $lt: endOfMonth },
  });
  const deliveredOrder = await Orders.countDocuments({
    status: 'delivered',
    restaurant: new mongoose.Types.ObjectId(vendor),
    createdAt: { $gte: startOfMonth, $lt: endOfMonth },
  });
  const rejectedOrder = await Orders.countDocuments({
    status: 'rejected',
    restaurant: new mongoose.Types.ObjectId(vendor),
    createdAt: { $gte: startOfMonth, $lt: endOfMonth },
  });
  const allOrder = await Orders.countDocuments({
    restaurant: new mongoose.Types.ObjectId(vendor),
    createdAt: { $gte: startOfMonth, $lt: endOfMonth },
  });
  /// Order Insight ///
  const orderTotalSoldData = await Orders.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: { $gte: startOfMonth, $lt: endOfMonth },
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$itemTotal' },
        averageSum: { $avg: '$itemTotal' },
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
  const orderChartData = await Orders.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: { $gte: startOfMonth, $lt: endOfMonth },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        soldCount: { $sum: '$itemTotal' },
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
  const orderTrendingFoods = await Orders.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: { $gte: startOfMonth, $lt: endOfMonth },
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
  /// Order Insight ///

  // POS Insight ///
  const posTotalSoldData = await PosOrTableOrder.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: { $gte: startOfMonth, $lt: endOfMonth },
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
  const posChartData = await PosOrTableOrder.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: { $gte: startOfMonth, $lt: endOfMonth },
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
  const posTrendingFoods = await PosOrTableOrder.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: { $gte: startOfMonth, $lt: endOfMonth },
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
  // POS Insight ///

  /// Table Order Insight ///
  const tableOrderTotalSoldData = await TableOrder.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: { $gte: startOfMonth, $lt: endOfMonth },
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
  const tableOrderChartData = await TableOrder.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: { $gte: startOfMonth, $lt: endOfMonth },
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
  const tableOrderTrendingFoods = await TableOrder.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: { $gte: startOfMonth, $lt: endOfMonth },
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
  /// Table Order Insight ///

  const restaurantInfo = await Restaurant.findById(vendor);
  const permission = {
    pos: false,
    tableOrder: false,
  };
  if (
    restaurantInfo !== null &&
    restaurantInfo.type === 'derived' &&
    restaurantInfo.isOutlet === true &&
    restaurantInfo.outletManagerId !== null
  ) {
    const outletManager = await Restaurant.findById(restaurantInfo.outletManagerId);
    if (outletManager !== null && outletManager.id !== null) {
      permission.pos = outletManager.pos;
      permission.tableOrder = outletManager.tableOrder;
    }
  } else {
    permission.pos = restaurantInfo.pos;
    permission.tableOrder = restaurantInfo.tableOrder;
  }

  return Promise.all([
    newOrder,
    preparingOrder,
    readyOrder,
    handoverOrder,
    ongoingOrder,
    deliveredOrder,
    rejectedOrder,
    allOrder,
    orderTotalSoldData,
    orderChartData,
    orderTrendingFoods,
    posTotalSoldData,
    posChartData,
    posTrendingFoods,
    tableOrderTotalSoldData,
    tableOrderChartData,
    tableOrderTrendingFoods,
    restaurantInfo,
    permission,
  ]).then(() => {
    const orderTotalSold = {
      totalSold: 0,
      averageSold: 0,
    };
    const orderMinMaxDate = {
      min: startOfMonth,
      max: endOfMonth,
    };
    const posTotalSold = {
      totalSold: 0,
      averageSold: 0,
    };
    const posMinMaxDate = {
      min: startOfMonth,
      max: endOfMonth,
    };
    const tableOrderTotalSold = {
      totalSold: 0,
      averageSold: 0,
    };
    const tableOrderMinMaxDate = {
      min: startOfMonth,
      max: endOfMonth,
    };
    if (checkArrayNotEmpty(orderTotalSoldData)) {
      orderTotalSold.totalSold = orderTotalSoldData[0].totalSold;
      orderTotalSold.averageSold = orderTotalSoldData[0].averageSold;
    }
    if (checkArrayNotEmpty(posTotalSoldData)) {
      posTotalSold.totalSold = posTotalSoldData[0].totalSold;
      posTotalSold.averageSold = posTotalSoldData[0].averageSold;
    }
    if (checkArrayNotEmpty(tableOrderTotalSoldData)) {
      tableOrderTotalSold.totalSold = tableOrderTotalSoldData[0].totalSold;
      tableOrderTotalSold.averageSold = tableOrderTotalSoldData[0].averageSold;
    }
    const result = {
      newOrder,
      preparingOrder,
      readyOrder,
      handoverOrder,
      ongoingOrder,
      deliveredOrder,
      rejectedOrder,
      allOrder,
      orderTotalSold,
      orderChartData,
      orderTrendingFoods,
      orderMinMaxDate,
      posTotalSold,
      posChartData,
      posTrendingFoods,
      posMinMaxDate,
      tableOrderTotalSold,
      tableOrderChartData,
      tableOrderTrendingFoods,
      tableOrderMinMaxDate,
      permission,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const vendorWebWeeklyDashboardBusinessInsight = async (vendor) => {
  const startOfWeek = new Date();
  startOfWeek.setDate(startOfWeek.getDate() - 7);
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date();
  endOfWeek.setHours(23, 59, 59, 999);
  const newOrder = await Orders.countDocuments({
    $or: [{ status: 'created' }, { status: 'accepted' }],
    restaurant: new mongoose.Types.ObjectId(vendor),
    createdAt: { $gte: startOfWeek, $lt: endOfWeek },
  });
  const preparingOrder = await Orders.countDocuments({
    status: 'preparing',
    restaurant: new mongoose.Types.ObjectId(vendor),
    createdAt: { $gte: startOfWeek, $lt: endOfWeek },
  });
  const readyOrder = await Orders.countDocuments({
    status: 'ready',
    restaurant: new mongoose.Types.ObjectId(vendor),
    createdAt: { $gte: startOfWeek, $lt: endOfWeek },
  });
  const handoverOrder = await Orders.countDocuments({
    status: 'handover',
    restaurant: new mongoose.Types.ObjectId(vendor),
    createdAt: { $gte: startOfWeek, $lt: endOfWeek },
  });
  const ongoingOrder = await Orders.countDocuments({
    status: 'ongoing',
    restaurant: new mongoose.Types.ObjectId(vendor),
    createdAt: { $gte: startOfWeek, $lt: endOfWeek },
  });
  const deliveredOrder = await Orders.countDocuments({
    status: 'delivered',
    restaurant: new mongoose.Types.ObjectId(vendor),
    createdAt: { $gte: startOfWeek, $lt: endOfWeek },
  });
  const rejectedOrder = await Orders.countDocuments({
    status: 'rejected',
    restaurant: new mongoose.Types.ObjectId(vendor),
    createdAt: { $gte: startOfWeek, $lt: endOfWeek },
  });
  const allOrder = await Orders.countDocuments({
    restaurant: new mongoose.Types.ObjectId(vendor),
    createdAt: { $gte: startOfWeek, $lt: endOfWeek },
  });
  /// Order Insight ///
  const orderTotalSoldData = await Orders.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: { $gte: startOfWeek, $lt: endOfWeek },
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$itemTotal' },
        averageSum: { $avg: '$itemTotal' },
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
  const orderChartData = await Orders.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: { $gte: startOfWeek, $lt: endOfWeek },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        soldCount: { $sum: '$itemTotal' },
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
  const orderTrendingFoods = await Orders.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: { $gte: startOfWeek, $lt: endOfWeek },
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
  /// Order Insight ///

  // POS Insight ///
  const posTotalSoldData = await PosOrTableOrder.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: { $gte: startOfWeek, $lt: endOfWeek },
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
  const posChartData = await PosOrTableOrder.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: { $gte: startOfWeek, $lt: endOfWeek },
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
  const posTrendingFoods = await PosOrTableOrder.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: { $gte: startOfWeek, $lt: endOfWeek },
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
  // POS Insight ///

  /// Table Order Insight ///
  const tableOrderTotalSoldData = await TableOrder.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: { $gte: startOfWeek, $lt: endOfWeek },
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
  const tableOrderChartData = await TableOrder.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: { $gte: startOfWeek, $lt: endOfWeek },
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
  const tableOrderTrendingFoods = await TableOrder.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: { $gte: startOfWeek, $lt: endOfWeek },
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
  /// Table Order Insight ///

  const restaurantInfo = await Restaurant.findById(vendor);
  const permission = {
    pos: false,
    tableOrder: false,
  };
  if (
    restaurantInfo !== null &&
    restaurantInfo.type === 'derived' &&
    restaurantInfo.isOutlet === true &&
    restaurantInfo.outletManagerId !== null
  ) {
    const outletManager = await Restaurant.findById(restaurantInfo.outletManagerId);
    if (outletManager !== null && outletManager.id !== null) {
      permission.pos = outletManager.pos;
      permission.tableOrder = outletManager.tableOrder;
    }
  } else {
    permission.pos = restaurantInfo.pos;
    permission.tableOrder = restaurantInfo.tableOrder;
  }

  return Promise.all([
    newOrder,
    preparingOrder,
    readyOrder,
    handoverOrder,
    ongoingOrder,
    deliveredOrder,
    rejectedOrder,
    allOrder,
    orderTotalSoldData,
    orderChartData,
    orderTrendingFoods,
    posTotalSoldData,
    posChartData,
    posTrendingFoods,
    tableOrderTotalSoldData,
    tableOrderChartData,
    tableOrderTrendingFoods,
    restaurantInfo,
    permission,
  ]).then(() => {
    const orderTotalSold = {
      totalSold: 0,
      averageSold: 0,
    };
    const orderMinMaxDate = {
      min: startOfWeek,
      max: endOfWeek,
    };
    const posTotalSold = {
      totalSold: 0,
      averageSold: 0,
    };
    const posMinMaxDate = {
      min: startOfWeek,
      max: endOfWeek,
    };
    const tableOrderTotalSold = {
      totalSold: 0,
      averageSold: 0,
    };
    const tableOrderMinMaxDate = {
      min: startOfWeek,
      max: endOfWeek,
    };
    if (checkArrayNotEmpty(orderTotalSoldData)) {
      orderTotalSold.totalSold = orderTotalSoldData[0].totalSold;
      orderTotalSold.averageSold = orderTotalSoldData[0].averageSold;
    }
    if (checkArrayNotEmpty(posTotalSoldData)) {
      posTotalSold.totalSold = posTotalSoldData[0].totalSold;
      posTotalSold.averageSold = posTotalSoldData[0].averageSold;
    }
    if (checkArrayNotEmpty(tableOrderTotalSoldData)) {
      tableOrderTotalSold.totalSold = tableOrderTotalSoldData[0].totalSold;
      tableOrderTotalSold.averageSold = tableOrderTotalSoldData[0].averageSold;
    }
    const result = {
      newOrder,
      preparingOrder,
      readyOrder,
      handoverOrder,
      ongoingOrder,
      deliveredOrder,
      rejectedOrder,
      allOrder,
      orderTotalSold,
      orderChartData,
      orderTrendingFoods,
      orderMinMaxDate,
      posTotalSold,
      posChartData,
      posTrendingFoods,
      posMinMaxDate,
      tableOrderTotalSold,
      tableOrderChartData,
      tableOrderTrendingFoods,
      tableOrderMinMaxDate,
      permission,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const vendorWebTodayDashboardBusinessInsight = async (vendor) => {
  const startOfToday = DateTime.now().startOf('day').toJSDate();
  const endOfToday = DateTime.now().endOf('day').toJSDate();
  const newOrder = await Orders.countDocuments({
    $or: [{ status: 'created' }, { status: 'accepted' }],
    restaurant: new mongoose.Types.ObjectId(vendor),
    createdAt: { $gte: startOfToday, $lt: endOfToday },
  });
  const preparingOrder = await Orders.countDocuments({
    status: 'preparing',
    restaurant: new mongoose.Types.ObjectId(vendor),
    createdAt: { $gte: startOfToday, $lt: endOfToday },
  });
  const readyOrder = await Orders.countDocuments({
    status: 'ready',
    restaurant: new mongoose.Types.ObjectId(vendor),
    createdAt: { $gte: startOfToday, $lt: endOfToday },
  });
  const handoverOrder = await Orders.countDocuments({
    status: 'handover',
    restaurant: new mongoose.Types.ObjectId(vendor),
    createdAt: { $gte: startOfToday, $lt: endOfToday },
  });
  const ongoingOrder = await Orders.countDocuments({
    status: 'ongoing',
    restaurant: new mongoose.Types.ObjectId(vendor),
    createdAt: { $gte: startOfToday, $lt: endOfToday },
  });
  const deliveredOrder = await Orders.countDocuments({
    status: 'delivered',
    restaurant: new mongoose.Types.ObjectId(vendor),
    createdAt: { $gte: startOfToday, $lt: endOfToday },
  });
  const rejectedOrder = await Orders.countDocuments({
    status: 'rejected',
    restaurant: new mongoose.Types.ObjectId(vendor),
    createdAt: { $gte: startOfToday, $lt: endOfToday },
  });
  const allOrder = await Orders.countDocuments({
    restaurant: new mongoose.Types.ObjectId(vendor),
    createdAt: { $gte: startOfToday, $lt: endOfToday },
  });
  /// Order Insight ///
  const orderTotalSoldData = await Orders.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: { $gte: startOfToday, $lt: endOfToday },
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$itemTotal' },
        averageSum: { $avg: '$itemTotal' },
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
  const orderChartData = await Orders.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: { $gte: startOfToday, $lt: endOfToday },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        soldCount: { $sum: '$itemTotal' },
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
  const orderTrendingFoods = await Orders.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: { $gte: startOfToday, $lt: endOfToday },
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
  /// Order Insight ///

  // POS Insight ///
  const posTotalSoldData = await PosOrTableOrder.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: { $gte: startOfToday, $lt: endOfToday },
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
  const posChartData = await PosOrTableOrder.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: { $gte: startOfToday, $lt: endOfToday },
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
  const posTrendingFoods = await PosOrTableOrder.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: { $gte: startOfToday, $lt: endOfToday },
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
  // POS Insight ///

  /// Table Order Insight ///
  const tableOrderTotalSoldData = await TableOrder.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: { $gte: startOfToday, $lt: endOfToday },
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
  const tableOrderChartData = await TableOrder.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: { $gte: startOfToday, $lt: endOfToday },
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
  const tableOrderTrendingFoods = await TableOrder.aggregate([
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        createdAt: { $gte: startOfToday, $lt: endOfToday },
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
  /// Table Order Insight ///

  const restaurantInfo = await Restaurant.findById(vendor);
  const permission = {
    pos: false,
    tableOrder: false,
  };
  if (
    restaurantInfo !== null &&
    restaurantInfo.type === 'derived' &&
    restaurantInfo.isOutlet === true &&
    restaurantInfo.outletManagerId !== null
  ) {
    const outletManager = await Restaurant.findById(restaurantInfo.outletManagerId);
    if (outletManager !== null && outletManager.id !== null) {
      permission.pos = outletManager.pos;
      permission.tableOrder = outletManager.tableOrder;
    }
  } else {
    permission.pos = restaurantInfo.pos;
    permission.tableOrder = restaurantInfo.tableOrder;
  }

  return Promise.all([
    newOrder,
    preparingOrder,
    readyOrder,
    handoverOrder,
    ongoingOrder,
    deliveredOrder,
    rejectedOrder,
    allOrder,
    orderTotalSoldData,
    orderChartData,
    orderTrendingFoods,
    posTotalSoldData,
    posChartData,
    posTrendingFoods,
    tableOrderTotalSoldData,
    tableOrderChartData,
    tableOrderTrendingFoods,
    restaurantInfo,
    permission,
  ]).then(() => {
    const orderTotalSold = {
      totalSold: 0,
      averageSold: 0,
    };
    const posTotalSold = {
      totalSold: 0,
      averageSold: 0,
    };
    const tableOrderTotalSold = {
      totalSold: 0,
      averageSold: 0,
    };
    if (checkArrayNotEmpty(orderTotalSoldData)) {
      orderTotalSold.totalSold = orderTotalSoldData[0].totalSold;
      orderTotalSold.averageSold = orderTotalSoldData[0].averageSold;
    }
    if (checkArrayNotEmpty(posTotalSoldData)) {
      posTotalSold.totalSold = posTotalSoldData[0].totalSold;
      posTotalSold.averageSold = posTotalSoldData[0].averageSold;
    }
    if (checkArrayNotEmpty(tableOrderTotalSoldData)) {
      tableOrderTotalSold.totalSold = tableOrderTotalSoldData[0].totalSold;
      tableOrderTotalSold.averageSold = tableOrderTotalSoldData[0].averageSold;
    }
    const result = {
      newOrder,
      preparingOrder,
      readyOrder,
      handoverOrder,
      ongoingOrder,
      deliveredOrder,
      rejectedOrder,
      allOrder,
      orderTotalSold,
      orderChartData,
      orderTrendingFoods,
      posTotalSold,
      posChartData,
      posTrendingFoods,
      tableOrderTotalSold,
      tableOrderChartData,
      tableOrderTrendingFoods,
      permission,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const deliverymanInsight = async (uid) => {
  const deliveredOrders = await DriverNewOrderStatus.countDocuments({
    driver: uid,
    driverOrderStatus: 'delivered',
  });
  const earnings = await DriverNewOrderStatus.aggregate([
    {
      $match: {
        driver: new mongoose.Types.ObjectId(uid),
      },
    },
    {
      $group: {
        _id: null,
        totalSum: { $sum: '$earning' },
      },
    },
    {
      $project: {
        _id: 0,
        earnings: { $round: [{ $divide: ['$totalSum', 100] }, 2] },
      },
    },
  ]);
  const averageDeliveryTime = await DriverNewOrderStatus.aggregate([
    {
      $match: {
        driver: new mongoose.Types.ObjectId(uid),
        acceptedAt: { $exists: true, $ne: null },
        deliveredAt: { $exists: true, $ne: null },
      },
    },
    {
      $addFields: {
        deliveryTimeInMillis: { $subtract: ['$deliveredAt', '$acceptedAt'] },
      },
    },
    {
      $addFields: {
        deliveryTimeInMinutes: { $divide: ['$deliveryTimeInMillis', 1000 * 60] },
      },
    },
    {
      $match: {
        deliveryTimeInMinutes: { $gte: 0, $lte: 180 }, // Adjust the upper limit if necessary
      },
    },
    {
      $group: {
        _id: null,
        averageDeliveryTimeInMinutes: { $avg: '$deliveryTimeInMinutes' },
      },
    },
    {
      $project: {
        _id: 0,
        averageDeliveryTime: { $round: ['$averageDeliveryTimeInMinutes', 0] },
      },
    },
  ]);
  const statusName = [
    'ideal',
    'accepted',
    'driver_reached_restaurant',
    'driver_pickpup_order',
    'driver_reached_customer',
    'rejected',
    'cancelled',
    'delivered',
    'accepted_another',
  ];
  const chartCountList = await DriverNewOrderStatus.aggregate([
    {
      $match: {
        driver: new mongoose.Types.ObjectId(uid),
      },
    },
    {
      $group: {
        _id: '$driverOrderStatus',
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        status: '$_id',
        count: 1,
      },
    },
  ]);
  const chartCount = statusName.map((status) => {
    const found = chartCountList.find((item) => item.status === status);
    return {
      status,
      count: found ? found.count : 0,
    };
  });
  const earningChart = await DriverNewOrderStatus.aggregate([
    {
      $match: {
        driver: new mongoose.Types.ObjectId(uid),
        earning: { $exists: true, $ne: null },
        tipAmount: { $exists: true, $ne: null },
        incentiveAmount: { $exists: true, $ne: null },
        extraEarningOnShiftAmount: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: null,
        totalEarnings: { $sum: '$earning' },
        totalTips: { $sum: '$tipAmount' },
        totalBonuses: { $sum: '$incentiveAmount' },
        totalExtraShiftEarning: { $sum: '$extraEarningOnShiftAmount' },
      },
    },
    {
      $project: {
        _id: 0,
        totalEarnings: { $round: [{ $divide: ['$totalEarnings', 100] }, 2] },
        totalTips: { $round: [{ $divide: ['$totalTips', 100] }, 2] },
        totalBonuses: { $round: [{ $divide: ['$totalBonuses', 100] }, 2] },
        totalExtraShiftEarning: { $round: [{ $divide: ['$totalExtraShiftEarning', 100] }, 2] },
      },
    },
  ]);
  const hourlyPerformanceChart = await DriverNewOrderStatus.aggregate([
    {
      $match: {
        driver: new mongoose.Types.ObjectId(uid),
        deliveredAt: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: { $hour: '$deliveredAt' },
        totalDeliveries: { $sum: 1 },
        totalEarnings: { $sum: '$earning' },
      },
    },
    {
      $sort: { _id: 1 },
    },
    {
      $project: {
        hour: '$_id',
        totalDeliveries: 1,
        totalEarnings: { $round: [{ $divide: ['$totalEarnings', 100] }, 2] },
        _id: 0,
      },
    },
  ]);
  const recentOrders = await DriverNewOrderStatus.aggregate([
    {
      $match: {
        driver: new mongoose.Types.ObjectId(uid),
      },
    },
    { $sort: { createdAt: -1 } },
    { $limit: 10 },
    {
      $lookup: {
        from: 'orders',
        localField: 'orderId',
        foreignField: '_id',
        as: 'orders',
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
        path: '$orders',
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
        driverOrderStatus: 1,
        earning: {
          $round: [{ $divide: ['$earning', 100] }, 2],
        },
        tipAmount: {
          $round: [{ $divide: ['$tipAmount', 100] }, 2],
        },
        incentiveAmount: {
          $round: [{ $divide: ['$incentiveAmount', 100] }, 2],
        },
        order: {
          id: { $ifNull: ['$orders._id', ''] },
          orderNo: { $ifNull: ['$orders.orderNo', 1] },
          receiverName: { $ifNull: ['$orders.receiverName', ''] },
        },
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
        deliveryAddressRaw: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$deliveryAddressRaw'],
            lang: 'js',
          },
        },
        createdAt: 1,
      },
    },
  ]);
  const recentReviews = await DriverOrderReview.aggregate([
    {
      $match: {
        driver: new mongoose.Types.ObjectId(uid),
      },
    },
    { $sort: { createdAt: -1 } },
    { $limit: 10 },
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
        from: 'orderratingmessages',
        localField: 'messages',
        foreignField: '_id',
        pipeline: [
          { $match: { status: true } },
          {
            $project: {
              _id: 0,
              id: '$_id',
              name: 1,
              translations: 1,
            },
          },
        ],
        as: 'hashtags',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        createdAt: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
        },
        ratingCount: 1,
        images: 1,
        shortReview: 1,
        hashtags: 1,
      },
    },
  ]);
  const businessSettings = await BusinessSettings.findOne({}, { findMode: 1 });
  const findMode =
    businessSettings && businessSettings.findMode !== null && businessSettings.findMode !== ''
      ? businessSettings.findMode
      : 'km';
  return Promise.all([
    deliveredOrders,
    earnings,
    averageDeliveryTime,
    chartCountList,
    earningChart,
    hourlyPerformanceChart,
    recentOrders,
    recentReviews,
    businessSettings,
  ]).then(() => {
    let totalEarning = 0;
    let averageDeliveryTimeOfDelivery = 0;
    const earningChartData = {
      totalEarnings: 0,
      totalTips: 0,
      totalBonuses: 0,
      totalExtraShiftEarning: 0,
    };
    if (checkArrayNotEmpty(earnings)) {
      totalEarning = earnings[0].earnings;
    }
    if (checkArrayNotEmpty(averageDeliveryTime)) {
      averageDeliveryTimeOfDelivery = averageDeliveryTime[0].averageDeliveryTime;
    }
    if (checkArrayNotEmpty(earningChart)) {
      earningChartData.totalEarnings = earningChart[0].totalEarnings;
      earningChartData.totalTips = earningChart[0].totalTips;
      earningChartData.totalBonuses = earningChart[0].totalBonuses;
      earningChartData.totalExtraShiftEarning = earningChart[0].totalExtraShiftEarning;
    }
    const result = {
      deliveredOrders,
      totalEarning,
      averageDeliveryTimeOfDelivery,
      chartCount,
      earningChartData,
      hourlyPerformanceChart,
      recentOrders,
      recentReviews,
      findMode,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const driverOrderList = async (uid, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const orders = await DriverNewOrderStatus.aggregate([
    {
      $match: {
        driver: new mongoose.Types.ObjectId(uid),
      },
    },
    { $skip: skip },
    { $limit: Number(limit) },
    {
      $lookup: {
        from: 'orders',
        localField: 'orderId',
        foreignField: '_id',
        as: 'orders',
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
        path: '$orders',
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
        driverOrderStatus: 1,
        earning: {
          $round: [{ $divide: ['$earning', 100] }, 2],
        },
        tipAmount: {
          $round: [{ $divide: ['$tipAmount', 100] }, 2],
        },
        incentiveAmount: {
          $round: [{ $divide: ['$incentiveAmount', 100] }, 2],
        },
        order: {
          id: { $ifNull: ['$orders._id', ''] },
          orderNo: { $ifNull: ['$orders.orderNo', 1] },
          receiverName: { $ifNull: ['$orders.receiverName', ''] },
        },
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
        deliveryAddressRaw: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$deliveryAddressRaw'],
            lang: 'js',
          },
        },
        createdAt: 1,
      },
    },
  ]);
  const totalResults = await DriverNewOrderStatus.countDocuments({
    driver: new mongoose.Types.ObjectId(uid),
  });
  const businessSettings = await BusinessSettings.findOne({}, { findMode: 1 });
  const findMode =
    businessSettings && businessSettings.findMode !== null && businessSettings.findMode !== ''
      ? businessSettings.findMode
      : 'km';
  return Promise.all([orders, totalResults, businessSettings]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      orders,
      totalPages,
      totalResults,
      page,
      limit,
      findMode,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const downloadOrderSummary = async (orderId, userId) => {
  const orderQuery = [
    {
      $match: {
        _id: new mongoose.Types.ObjectId(orderId),
        user: new mongoose.Types.ObjectId(userId),
      },
    },
    { $limit: 1 },
    {
      $lookup: {
        from: 'users',
        localField: 'driver',
        foreignField: '_id',
        as: 'driver',
      },
    },
    {
      $unwind: {
        path: '$driver',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        orderNo: 1,
        status: 1,
        deliveryAddressRaw: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$deliveryAddressRaw'],
            lang: 'js',
          },
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
        receiverName: 1,
        user: 1,
        createdAt: 1,
        scheduleDate: 1,
        orderAt: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        scheduleTime: 1,
        orderTo: 1,
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        itemTotal: {
          $round: [{ $divide: ['$itemTotal', 100] }, 2],
        },
        couponDiscountCharge: {
          $round: [{ $divide: ['$couponDiscountCharge', 100] }, 2],
        },
        deliveryCharge: {
          $round: [{ $divide: ['$deliveryCharge', 100] }, 2],
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
        walletAmount: {
          $round: [{ $divide: ['$walletAmount', 100] }, 2],
        },
        deliveryTip: {
          $round: [{ $divide: ['$deliveryTip', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        restaurant: 1,
        driverInfo: {
          id: { $ifNull: ['$driver._id', ''] },
          firstName: { $ifNull: ['$driver.firstName', ''] },
          lastName: { $ifNull: ['$driver.lastName', ''] },
        },
      },
    },
  ];
  const orders = await Orders.aggregate(orderQuery);
  if (orders !== null && orders.length > 0) {
    const details = orders[0];
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
    const instructions = await InvoiceInstruction.find(
      { status: true },
      { id: 1, name: 1, translations: 1 }
    );
    return Promise.all([orders, businessSettings, restaurantInfo, instructions]).then(() => {
      const result = {
        details,
        businessSettings,
        restaurantDetail:
          restaurantInfo !== null && restaurantInfo.length > 0 ? restaurantInfo[0] : null,
        instructions,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const downloadVendorOrderSummary = async (orderId, vendorId) => {
  const orderQuery = [
    {
      $match: {
        _id: new mongoose.Types.ObjectId(orderId),
        restaurant: new mongoose.Types.ObjectId(vendorId),
      },
    },
    { $limit: 1 },
    {
      $lookup: {
        from: 'users',
        localField: 'driver',
        foreignField: '_id',
        as: 'driver',
      },
    },
    {
      $unwind: {
        path: '$driver',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        orderNo: 1,
        status: 1,
        deliveryAddressRaw: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$deliveryAddressRaw'],
            lang: 'js',
          },
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
        receiverName: 1,
        user: 1,
        createdAt: 1,
        scheduleDate: 1,
        orderAt: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        scheduleTime: 1,
        orderTo: 1,
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        itemTotal: {
          $round: [{ $divide: ['$itemTotal', 100] }, 2],
        },
        couponDiscountCharge: {
          $round: [{ $divide: ['$couponDiscountCharge', 100] }, 2],
        },
        deliveryCharge: {
          $round: [{ $divide: ['$deliveryCharge', 100] }, 2],
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
        walletAmount: {
          $round: [{ $divide: ['$walletAmount', 100] }, 2],
        },
        deliveryTip: {
          $round: [{ $divide: ['$deliveryTip', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        restaurant: 1,
        driverInfo: {
          id: { $ifNull: ['$driver._id', ''] },
          firstName: { $ifNull: ['$driver.firstName', ''] },
          lastName: { $ifNull: ['$driver.lastName', ''] },
        },
      },
    },
  ];
  const orders = await Orders.aggregate(orderQuery);
  if (orders !== null && orders.length > 0) {
    const details = orders[0];
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
    const instructions = await InvoiceInstruction.find(
      { status: true },
      { id: 1, name: 1, translations: 1 }
    );
    return Promise.all([orders, businessSettings, restaurantInfo, instructions]).then(() => {
      const result = {
        details,
        businessSettings,
        restaurantDetail:
          restaurantInfo !== null && restaurantInfo.length > 0 ? restaurantInfo[0] : null,
        instructions,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const downloadOrderInvoice = async (orderId, userId) => {
  const orderQuery = [
    {
      $match: {
        _id: new mongoose.Types.ObjectId(orderId),
        user: new mongoose.Types.ObjectId(userId),
      },
    },
    { $limit: 1 },
    {
      $lookup: {
        from: 'users',
        localField: 'driver',
        foreignField: '_id',
        as: 'driver',
      },
    },
    {
      $unwind: {
        path: '$driver',
        preserveNullAndEmptyArrays: true,
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
      $project: {
        _id: 0,
        id: '$_id',
        orderNo: 1,
        status: 1,
        deliveryAddressRaw: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$deliveryAddressRaw'],
            lang: 'js',
          },
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
        receiverName: 1,
        user: 1,
        createdAt: 1,
        scheduleDate: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        orderTo: 1,
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        itemTotal: {
          $round: [{ $divide: ['$itemTotal', 100] }, 2],
        },
        couponDiscountCharge: {
          $round: [{ $divide: ['$couponDiscountCharge', 100] }, 2],
        },
        deliveryCharge: {
          $round: [{ $divide: ['$deliveryCharge', 100] }, 2],
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
        walletAmount: {
          $round: [{ $divide: ['$walletAmount', 100] }, 2],
        },
        deliveryTip: {
          $round: [{ $divide: ['$deliveryTip', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        restaurant: 1,
        driverInfo: {
          id: { $ifNull: ['$driver._id', ''] },
          firstName: { $ifNull: ['$driver.firstName', ''] },
          lastName: { $ifNull: ['$driver.lastName', ''] },
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
        },
      },
    },
  ];

  const orders = await Orders.aggregate(orderQuery);
  if (orders !== null && orders.length > 0) {
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
    return Promise.all([orders, businessSettings, restaurantInfo]).then(() => {
      const result = {
        details,
        businessSettings,
        restaurantDetail:
          restaurantInfo !== null && restaurantInfo.length > 0 ? restaurantInfo[0] : null,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const downloadVendorOrderInvoice = async (orderId, vendorId) => {
  const orderQuery = [
    {
      $match: {
        _id: new mongoose.Types.ObjectId(orderId),
        restaurant: new mongoose.Types.ObjectId(vendorId),
      },
    },
    { $limit: 1 },
    {
      $lookup: {
        from: 'users',
        localField: 'driver',
        foreignField: '_id',
        as: 'driver',
      },
    },
    {
      $unwind: {
        path: '$driver',
        preserveNullAndEmptyArrays: true,
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
      $project: {
        _id: 0,
        id: '$_id',
        orderNo: 1,
        status: 1,
        deliveryAddressRaw: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$deliveryAddressRaw'],
            lang: 'js',
          },
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
        receiverName: 1,
        user: 1,
        createdAt: 1,
        scheduleDate: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        orderTo: 1,
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        itemTotal: {
          $round: [{ $divide: ['$itemTotal', 100] }, 2],
        },
        couponDiscountCharge: {
          $round: [{ $divide: ['$couponDiscountCharge', 100] }, 2],
        },
        deliveryCharge: {
          $round: [{ $divide: ['$deliveryCharge', 100] }, 2],
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
        walletAmount: {
          $round: [{ $divide: ['$walletAmount', 100] }, 2],
        },
        deliveryTip: {
          $round: [{ $divide: ['$deliveryTip', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        restaurant: 1,
        driverInfo: {
          id: { $ifNull: ['$driver._id', ''] },
          firstName: { $ifNull: ['$driver.firstName', ''] },
          lastName: { $ifNull: ['$driver.lastName', ''] },
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
        },
      },
    },
  ];

  const orders = await Orders.aggregate(orderQuery);
  if (orders !== null && orders.length > 0) {
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
    return Promise.all([orders, businessSettings, restaurantInfo]).then(() => {
      const result = {
        details,
        businessSettings,
        restaurantDetail:
          restaurantInfo !== null && restaurantInfo.length > 0 ? restaurantInfo[0] : null,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const orderReports = async (options) => {
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
        $or: [{ 'users.firstName': RegExp(name, 'i') }, { 'users.lastName': RegExp(name, 'i') }],
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
        realTotal: {
          $round: [{ $divide: ['$realTotal', 100] }, 2],
        },
        itemTotal: {
          $round: [{ $divide: ['$itemTotal', 100] }, 2],
        },
        itemDiscount: {
          $round: [{ $divide: ['$itemDiscount', 100] }, 2],
        },
        couponDiscountCharge: {
          $round: [{ $divide: ['$couponDiscountCharge', 100] }, 2],
        },
        deliveryCharge: {
          $round: [{ $divide: ['$deliveryCharge', 100] }, 2],
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
        deliveryTip: {
          $round: [{ $divide: ['$deliveryTip', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        walletAmount: {
          $round: [{ $divide: ['$walletAmount', 100] }, 2],
        },
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        refundedAmount: {
          $round: [{ $divide: ['$refundedAmount', 100] }, 2],
        },
        driverEarining: {
          $round: [{ $divide: ['$driverEarining', 100] }, 2],
        },
        deliveryCommission: {
          $round: [{ $divide: ['$deliveryCommission', 100] }, 2],
        },
        restaurantCommission: {
          $round: [{ $divide: ['$restaurantCommission', 100] }, 2],
        },
        status: 1,
        paymentMode: 1,
        orderTo: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
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
  const results = await Orders.aggregate(query);
  const resultCount = await Orders.aggregate(countQuery);
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

const customerOrderList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { user: new mongoose.Types.ObjectId(options.user) };
  const orderQuery = [
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
        orderNo: 1,
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        paymentMode: 1,
        status: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        scheduleDate: 1,
        scheduleTime: 1,
        orderAt: 1,
        createdAt: 1,
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        orderTo: 1,
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
  const orders = await Orders.aggregate(orderQuery);
  const totalResults = await Orders.countDocuments(queryCondition);
  return Promise.all([orders, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      orders,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const customerAllRefundRequest = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { user: new mongoose.Types.ObjectId(options.user) };
  const orderRefundQuery = [
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
        from: 'refundrequestreasons',
        localField: 'refundReason',
        foreignField: '_id',
        as: 'refundrequestreasons',
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
      $unwind: {
        path: '$refundrequestreasons',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        orders: 1,
        refundTo: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        reason: {
          id: { $ifNull: ['$refundrequestreasons._id', ''] },
          name: { $ifNull: ['$refundrequestreasons.name', ''] },
          translations: { $ifNull: ['$refundrequestreasons.translations', []] },
        },
        createdAt: 1,
      },
    },
  ];

  const tiffinRefundQuery = [
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
        from: 'tiffinsubscriptionrefundrequestreasons',
        localField: 'refundReason',
        foreignField: '_id',
        as: 'tiffinsubscriptionrefundrequestreasons',
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
        from: 'subscriptiontiffinpackages',
        localField: 'subscriptionPackage',
        foreignField: '_id',
        as: 'subscriptiontiffinpackages',
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
        path: '$tiffinsubscriptionrefundrequestreasons',
        preserveNullAndEmptyArrays: true,
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
        orders: 1,
        refundTo: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        packageInfo: {
          id: { $ifNull: ['$subscriptiontiffinpackages._id', ''] },
          name: { $ifNull: ['$subscriptiontiffinpackages.name', ''] },
          orderTo: { $ifNull: ['$subscriptiontiffinpackages.orderTo', ''] },
          available: { $ifNull: ['$subscriptiontiffinpackages.available', ''] },
          translations: { $ifNull: ['$subscriptiontiffinpackages.translations', []] },
        },
        reason: {
          id: { $ifNull: ['$tiffinsubscriptionrefundrequestreasons._id', ''] },
          name: { $ifNull: ['$tiffinsubscriptionrefundrequestreasons.name', ''] },
          translations: { $ifNull: ['$tiffinsubscriptionrefundrequestreasons.translations', []] },
        },
        createdAt: 1,
      },
    },
  ];

  const bookingRefundQuery = [
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
        from: 'diningbookingrefundrequestreasons',
        localField: 'refundReason',
        foreignField: '_id',
        as: 'diningbookingrefundrequestreasons',
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
      $unwind: {
        path: '$diningbookingrefundrequestreasons',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        orders: 1,
        refundTo: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        reason: {
          id: { $ifNull: ['$diningbookingrefundrequestreasons._id', ''] },
          name: { $ifNull: ['$diningbookingrefundrequestreasons.name', ''] },
          translations: { $ifNull: ['$diningbookingrefundrequestreasons.translations', []] },
        },
        createdAt: 1,
      },
    },
  ];

  const orderRefundRequest = await RefundRequest.aggregate(orderRefundQuery);
  const totalResultsOrderRefund = await RefundRequest.countDocuments(queryCondition);

  const tiffinRefundRequest = await TiffinSubscriptionRefundRequest.aggregate(tiffinRefundQuery);
  const totalResultsTiffinRefund =
    await TiffinSubscriptionRefundRequest.countDocuments(queryCondition);

  const bookingRefundRequest = await DiningBookingRefundRequest.aggregate(bookingRefundQuery);
  const totalResultsBookingRefund =
    await TiffinSubscriptionRefundRequest.countDocuments(queryCondition);
  return Promise.all([
    orderRefundRequest,
    totalResultsOrderRefund,
    tiffinRefundRequest,
    totalResultsTiffinRefund,
    bookingRefundRequest,
    totalResultsBookingRefund,
  ]).then(() => {
    const orderRefund = {
      orderRefundRequest,
      totalResultsOrderRefund,
    };
    const tiffinRefund = {
      tiffinRefundRequest,
      totalResultsTiffinRefund,
    };
    const bookingRefund = {
      bookingRefundRequest,
      totalResultsBookingRefund,
    };
    const result = {
      orderRefund,
      tiffinRefund,
      bookingRefund,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const customerOrderRefundList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { user: new mongoose.Types.ObjectId(options.user) };
  const orderRefundQuery = [
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
        from: 'refundrequestreasons',
        localField: 'refundReason',
        foreignField: '_id',
        as: 'refundrequestreasons',
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
      $unwind: {
        path: '$refundrequestreasons',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        orders: 1,
        refundTo: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        reason: {
          id: { $ifNull: ['$refundrequestreasons._id', ''] },
          name: { $ifNull: ['$refundrequestreasons.name', ''] },
          translations: { $ifNull: ['$refundrequestreasons.translations', []] },
        },
        createdAt: 1,
      },
    },
  ];
  const results = await RefundRequest.aggregate(orderRefundQuery);
  const totalResults = await RefundRequest.countDocuments(queryCondition);

  return Promise.all([results, totalResults]).then(() => {
    const result = {
      results,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const customerTiffinRefundList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { user: new mongoose.Types.ObjectId(options.user) };
  const tiffinRefundQuery = [
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
        from: 'tiffinsubscriptionrefundrequestreasons',
        localField: 'refundReason',
        foreignField: '_id',
        as: 'tiffinsubscriptionrefundrequestreasons',
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
        from: 'subscriptiontiffinpackages',
        localField: 'subscriptionPackage',
        foreignField: '_id',
        as: 'subscriptiontiffinpackages',
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
        path: '$tiffinsubscriptionrefundrequestreasons',
        preserveNullAndEmptyArrays: true,
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
        orders: 1,
        refundTo: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        packageInfo: {
          id: { $ifNull: ['$subscriptiontiffinpackages._id', ''] },
          name: { $ifNull: ['$subscriptiontiffinpackages.name', ''] },
          orderTo: { $ifNull: ['$subscriptiontiffinpackages.orderTo', ''] },
          available: { $ifNull: ['$subscriptiontiffinpackages.available', ''] },
          translations: { $ifNull: ['$subscriptiontiffinpackages.translations', []] },
        },
        reason: {
          id: { $ifNull: ['$tiffinsubscriptionrefundrequestreasons._id', ''] },
          name: { $ifNull: ['$tiffinsubscriptionrefundrequestreasons.name', ''] },
          translations: { $ifNull: ['$tiffinsubscriptionrefundrequestreasons.translations', []] },
        },
        createdAt: 1,
      },
    },
  ];
  const results = await TiffinSubscriptionRefundRequest.aggregate(tiffinRefundQuery);
  const totalResults = await TiffinSubscriptionRefundRequest.countDocuments(queryCondition);
  return Promise.all([results, totalResults]).then(() => {
    const result = {
      results,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const customerBookingRefundList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { user: new mongoose.Types.ObjectId(options.user) };
  const bookingRefundQuery = [
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
        from: 'diningbookingrefundrequestreasons',
        localField: 'refundReason',
        foreignField: '_id',
        as: 'diningbookingrefundrequestreasons',
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
      $unwind: {
        path: '$diningbookingrefundrequestreasons',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        orders: 1,
        refundTo: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        reason: {
          id: { $ifNull: ['$diningbookingrefundrequestreasons._id', ''] },
          name: { $ifNull: ['$diningbookingrefundrequestreasons.name', ''] },
          translations: { $ifNull: ['$diningbookingrefundrequestreasons.translations', []] },
        },
        createdAt: 1,
      },
    },
  ];
  const results = await DiningBookingRefundRequest.aggregate(bookingRefundQuery);
  const totalResults = await TiffinSubscriptionRefundRequest.countDocuments(queryCondition);
  return Promise.all([results, totalResults]).then(() => {
    const result = {
      results,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const vendorOrderList = async (options) => {
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
        orderNo: 1,
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        paymentMode: 1,
        status: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        scheduleDate: 1,
        scheduleTime: 1,
        orderAt: 1,
        createdAt: 1,
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        orderTo: 1,
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
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          paymentWay: { $ifNull: ['$paymentconfigs.paymentWay', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
      },
    },
  ];
  const orders = await Orders.aggregate(orderQuery);
  const totalResults = await Orders.countDocuments(queryCondition);
  return Promise.all([orders, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      orders,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const vendorAllRefundRequest = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { restaurant: new mongoose.Types.ObjectId(options.restaurant) };
  const orderRefundQuery = [
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
        from: 'refundrequestreasons',
        localField: 'refundReason',
        foreignField: '_id',
        as: 'refundrequestreasons',
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
        path: '$refundrequestreasons',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        orders: 1,
        refundTo: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        reason: {
          id: { $ifNull: ['$refundrequestreasons._id', ''] },
          name: { $ifNull: ['$refundrequestreasons.name', ''] },
          translations: { $ifNull: ['$refundrequestreasons.translations', []] },
        },
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        createdAt: 1,
      },
    },
  ];

  const tiffinRefundQuery = [
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
        from: 'tiffinsubscriptionrefundrequestreasons',
        localField: 'refundReason',
        foreignField: '_id',
        as: 'tiffinsubscriptionrefundrequestreasons',
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
        from: 'subscriptiontiffinpackages',
        localField: 'subscriptionPackage',
        foreignField: '_id',
        as: 'subscriptiontiffinpackages',
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
        path: '$tiffinsubscriptionrefundrequestreasons',
        preserveNullAndEmptyArrays: true,
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
        orders: 1,
        refundTo: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        packageInfo: {
          id: { $ifNull: ['$subscriptiontiffinpackages._id', ''] },
          name: { $ifNull: ['$subscriptiontiffinpackages.name', ''] },
          orderTo: { $ifNull: ['$subscriptiontiffinpackages.orderTo', ''] },
          available: { $ifNull: ['$subscriptiontiffinpackages.available', ''] },
          translations: { $ifNull: ['$subscriptiontiffinpackages.translations', []] },
        },
        reason: {
          id: { $ifNull: ['$tiffinsubscriptionrefundrequestreasons._id', ''] },
          name: { $ifNull: ['$tiffinsubscriptionrefundrequestreasons.name', ''] },
          translations: { $ifNull: ['$tiffinsubscriptionrefundrequestreasons.translations', []] },
        },
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        createdAt: 1,
      },
    },
  ];

  const bookingRefundQuery = [
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
        from: 'diningbookingrefundrequestreasons',
        localField: 'refundReason',
        foreignField: '_id',
        as: 'diningbookingrefundrequestreasons',
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
        path: '$diningbookingrefundrequestreasons',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        orders: 1,
        refundTo: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        reason: {
          id: { $ifNull: ['$diningbookingrefundrequestreasons._id', ''] },
          name: { $ifNull: ['$diningbookingrefundrequestreasons.name', ''] },
          translations: { $ifNull: ['$diningbookingrefundrequestreasons.translations', []] },
        },
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        createdAt: 1,
      },
    },
  ];

  const orderRefundRequest = await RefundRequest.aggregate(orderRefundQuery);
  const totalResultsOrderRefund = await RefundRequest.countDocuments(queryCondition);

  const tiffinRefundRequest = await TiffinSubscriptionRefundRequest.aggregate(tiffinRefundQuery);
  const totalResultsTiffinRefund =
    await TiffinSubscriptionRefundRequest.countDocuments(queryCondition);

  const bookingRefundRequest = await DiningBookingRefundRequest.aggregate(bookingRefundQuery);
  const totalResultsBookingRefund = await DiningBookingRefundRequest.countDocuments(queryCondition);
  return Promise.all([
    orderRefundRequest,
    totalResultsOrderRefund,
    tiffinRefundRequest,
    totalResultsTiffinRefund,
    bookingRefundRequest,
    totalResultsBookingRefund,
  ]).then(() => {
    const orderRefund = {
      orderRefundRequest,
      totalResultsOrderRefund,
    };
    const tiffinRefund = {
      tiffinRefundRequest,
      totalResultsTiffinRefund,
    };
    const bookingRefund = {
      bookingRefundRequest,
      totalResultsBookingRefund,
    };
    const result = {
      orderRefund,
      tiffinRefund,
      bookingRefund,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const vendorOrderRefundRequest = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { restaurant: new mongoose.Types.ObjectId(options.restaurant) };
  const orderRefundQuery = [
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
        from: 'refundrequestreasons',
        localField: 'refundReason',
        foreignField: '_id',
        as: 'refundrequestreasons',
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
        path: '$refundrequestreasons',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        orders: 1,
        refundTo: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        reason: {
          id: { $ifNull: ['$refundrequestreasons._id', ''] },
          name: { $ifNull: ['$refundrequestreasons.name', ''] },
          translations: { $ifNull: ['$refundrequestreasons.translations', []] },
        },
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        createdAt: 1,
      },
    },
  ];
  const results = await RefundRequest.aggregate(orderRefundQuery);
  const totalResults = await RefundRequest.countDocuments(queryCondition);
  return Promise.all([results, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      results,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const vendorDiningRefundRequest = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { restaurant: new mongoose.Types.ObjectId(options.restaurant) };
  const bookingRefundQuery = [
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
        from: 'diningbookingrefundrequestreasons',
        localField: 'refundReason',
        foreignField: '_id',
        as: 'diningbookingrefundrequestreasons',
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
        path: '$diningbookingrefundrequestreasons',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        status: 1,
        orders: 1,
        refundTo: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        reason: {
          id: { $ifNull: ['$diningbookingrefundrequestreasons._id', ''] },
          name: { $ifNull: ['$diningbookingrefundrequestreasons.name', ''] },
          translations: { $ifNull: ['$diningbookingrefundrequestreasons.translations', []] },
        },
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        createdAt: 1,
      },
    },
  ];
  const results = await DiningBookingRefundRequest.aggregate(bookingRefundQuery);
  const totalResults = await DiningBookingRefundRequest.countDocuments(queryCondition);
  return Promise.all([results, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      results,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const vendorTiffinRefundRequest = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { restaurant: new mongoose.Types.ObjectId(options.restaurant) };
  const tiffinRefundQuery = [
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
        from: 'tiffinsubscriptionrefundrequestreasons',
        localField: 'refundReason',
        foreignField: '_id',
        as: 'tiffinsubscriptionrefundrequestreasons',
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
        from: 'subscriptiontiffinpackages',
        localField: 'subscriptionPackage',
        foreignField: '_id',
        as: 'subscriptiontiffinpackages',
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
        path: '$tiffinsubscriptionrefundrequestreasons',
        preserveNullAndEmptyArrays: true,
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
        orders: 1,
        refundTo: 1,
        amount: {
          $round: [{ $divide: ['$amount', 100] }, 2],
        },
        paymentInfo: {
          id: { $ifNull: ['$paymentconfigs._id', ''] },
          name: { $ifNull: ['$paymentconfigs.name', ''] },
          translations: { $ifNull: ['$paymentconfigs.translations', []] },
        },
        packageInfo: {
          id: { $ifNull: ['$subscriptiontiffinpackages._id', ''] },
          name: { $ifNull: ['$subscriptiontiffinpackages.name', ''] },
          orderTo: { $ifNull: ['$subscriptiontiffinpackages.orderTo', ''] },
          available: { $ifNull: ['$subscriptiontiffinpackages.available', ''] },
          translations: { $ifNull: ['$subscriptiontiffinpackages.translations', []] },
        },
        reason: {
          id: { $ifNull: ['$tiffinsubscriptionrefundrequestreasons._id', ''] },
          name: { $ifNull: ['$tiffinsubscriptionrefundrequestreasons.name', ''] },
          translations: { $ifNull: ['$tiffinsubscriptionrefundrequestreasons.translations', []] },
        },
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          role: { $ifNull: ['$users.role', ''] },
        },
        createdAt: 1,
      },
    },
  ];
  const results = await TiffinSubscriptionRefundRequest.aggregate(tiffinRefundQuery);
  const totalResults = await TiffinSubscriptionRefundRequest.countDocuments(queryCondition);
  return Promise.all([results, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      results,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const deliverymanOrderList = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { driver: new mongoose.Types.ObjectId(options.deliveryman) };
  const orderQuery = [
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
        from: 'orders',
        localField: 'orderId',
        foreignField: '_id',
        as: 'orders',
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
        path: '$orders',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        orderId: 1,
        orderFrom: 1,
        createdAt: 1,
        driverOrderStatus: 1,
        orderInfo: {
          id: { $ifNull: ['$orders._id', ''] },
          orderNo: { $ifNull: ['$orders.orderNo', 0] },
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        earning: {
          $round: [{ $divide: ['$earning', 100] }, 2],
        },
        tipAmount: {
          $round: [{ $divide: ['$tipAmount', 100] }, 2],
        },
        incentiveAmount: {
          $round: [{ $divide: ['$incentiveAmount', 100] }, 2],
        },
        extraEarningOnShiftAmount: {
          $round: [{ $divide: ['$extraEarningOnShiftAmount', 100] }, 2],
        },
        deliveryAddressRaw: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$deliveryAddressRaw'],
            lang: 'js',
          },
        },
      },
    },
  ];
  const orders = await DriverNewOrderStatus.aggregate(orderQuery);
  const totalResults = await DriverNewOrderStatus.countDocuments(queryCondition);
  return Promise.all([orders, totalResults]).then(() => {
    const totalPages = Math.ceil(totalResults / limit);
    const result = {
      orders,
      totalPages,
      totalResults,
      page,
      limit,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const orderEarningBreakdown = async () => {
  const multipleYears = await Orders.aggregate([
    {
      $group: {
        _id: { $year: '$createdAt' },
        count: { $sum: 1 },
      },
    },
  ]);
  if (multipleYears.length > 1) {
    const chart = await Orders.aggregate([
      {
        $project: {
          year: { $year: '$createdAt' },
          grandTotal: 1,
          commission: { $add: ['$deliveryCommission', '$restaurantCommission'] },
        },
      },
      {
        $group: {
          _id: '$year',
          count: { $sum: 1 },
          grandTotal: { $sum: '$grandTotal' },
          commission: { $sum: '$commission' },
        },
      },
      {
        $project: {
          _id: 0,
          label: '$_id',
          count: 1,
          grandTotal: { $round: [{ $divide: ['$grandTotal', 100] }, 2] },
          commission: { $round: [{ $divide: ['$commission', 100] }, 2] },
        },
      },
      {
        $sort: { label: 1 },
      },
    ]);
    return chart;
  }

  const allMonths = [
    { month: 1, label: 'January' },
    { month: 2, label: 'February' },
    { month: 3, label: 'March' },
    { month: 4, label: 'April' },
    { month: 5, label: 'May' },
    { month: 6, label: 'June' },
    { month: 7, label: 'July' },
    { month: 8, label: 'August' },
    { month: 9, label: 'September' },
    { month: 10, label: 'October' },
    { month: 11, label: 'November' },
    { month: 12, label: 'December' },
  ];

  const chart = await Orders.aggregate([
    {
      $project: {
        month: { $month: '$createdAt' },
        grandTotal: 1,
        commission: { $add: ['$deliveryCommission', '$restaurantCommission'] },
      },
    },
    {
      $group: {
        _id: '$month',
        count: { $sum: 1 },
        grandTotal: { $sum: '$grandTotal' },
        commission: { $sum: '$commission' },
      },
    },
    {
      $project: {
        _id: 0,
        month: '$_id',
        count: 1,
        grandTotal: { $round: [{ $divide: ['$grandTotal', 100] }, 2] },
        commission: { $round: [{ $divide: ['$commission', 100] }, 2] },
      },
    },
    {
      $sort: { month: 1 },
    },
  ]).then((monthData) => {
    const result = allMonths.map((m) => {
      const data = monthData.find((d) => d.month === m.month);
      return {
        label: m.label,
        count: data ? data.count : 0,
        grandTotal: data ? data.grandTotal : 0,
        commission: data ? data.commission : 0,
      };
    });

    return result;
  });
  return chart;
};

const cityBasedOrderEarningBreakdown = async (city) => {
  const multipleYears = await Orders.aggregate([
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
    {
      $group: {
        _id: { $year: '$createdAt' },
        count: { $sum: 1 },
      },
    },
  ]);
  if (multipleYears.length > 1) {
    const chart = await Orders.aggregate([
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
      {
        $project: {
          year: { $year: '$createdAt' },
          grandTotal: 1,
          commission: { $add: ['$deliveryCommission', '$restaurantCommission'] },
        },
      },
      {
        $group: {
          _id: '$year',
          count: { $sum: 1 },
          grandTotal: { $sum: '$grandTotal' },
          commission: { $sum: '$commission' },
        },
      },
      {
        $project: {
          _id: 0,
          label: '$_id',
          count: 1,
          grandTotal: { $round: [{ $divide: ['$grandTotal', 100] }, 2] },
          commission: { $round: [{ $divide: ['$commission', 100] }, 2] },
        },
      },
      {
        $sort: { label: 1 },
      },
    ]);
    return chart;
  }
  const allMonths = [
    { month: 1, label: 'January' },
    { month: 2, label: 'February' },
    { month: 3, label: 'March' },
    { month: 4, label: 'April' },
    { month: 5, label: 'May' },
    { month: 6, label: 'June' },
    { month: 7, label: 'July' },
    { month: 8, label: 'August' },
    { month: 9, label: 'September' },
    { month: 10, label: 'October' },
    { month: 11, label: 'November' },
    { month: 12, label: 'December' },
  ];
  const chart = await Orders.aggregate([
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
    {
      $project: {
        month: { $month: '$createdAt' },
        grandTotal: 1,
        commission: { $add: ['$deliveryCommission', '$restaurantCommission'] },
      },
    },
    {
      $group: {
        _id: '$month',
        count: { $sum: 1 },
        grandTotal: { $sum: '$grandTotal' },
        commission: { $sum: '$commission' },
      },
    },
    {
      $project: {
        _id: 0,
        month: '$_id',
        count: 1,
        grandTotal: { $round: [{ $divide: ['$grandTotal', 100] }, 2] },
        commission: { $round: [{ $divide: ['$commission', 100] }, 2] },
      },
    },
    {
      $sort: { month: 1 },
    },
  ]).then((monthData) => {
    const result = allMonths.map((m) => {
      const data = monthData.find((d) => d.month === m.month);
      return {
        label: m.label,
        count: data ? data.count : 0,
        grandTotal: data ? data.grandTotal : 0,
        commission: data ? data.commission : 0,
      };
    });

    return result;
  });
  return chart;
};

const posOrderEarningBreakdown = async () => {
  const multipleYears = await PosOrTableOrder.aggregate([
    {
      $group: {
        _id: { $year: '$createdAt' },
        count: { $sum: 1 },
      },
    },
  ]);
  if (multipleYears.length > 1) {
    const chart = await PosOrTableOrder.aggregate([
      {
        $project: {
          year: { $year: '$createdAt' },
          grandTotal: 1,
          restaurantCommission: 1,
        },
      },
      {
        $group: {
          _id: '$year',
          count: { $sum: 1 },
          grandTotal: { $sum: '$grandTotal' },
          restaurantCommission: { $sum: '$restaurantCommission' },
        },
      },
      {
        $project: {
          _id: 0,
          label: '$_id',
          count: 1,
          grandTotal: { $round: [{ $divide: ['$grandTotal', 100] }, 2] },
          commission: { $round: [{ $divide: ['$restaurantCommission', 100] }, 2] },
        },
      },
      {
        $sort: { label: 1 },
      },
    ]);
    return chart;
  }

  const allMonths = [
    { month: 1, label: 'January' },
    { month: 2, label: 'February' },
    { month: 3, label: 'March' },
    { month: 4, label: 'April' },
    { month: 5, label: 'May' },
    { month: 6, label: 'June' },
    { month: 7, label: 'July' },
    { month: 8, label: 'August' },
    { month: 9, label: 'September' },
    { month: 10, label: 'October' },
    { month: 11, label: 'November' },
    { month: 12, label: 'December' },
  ];

  const chart = await PosOrTableOrder.aggregate([
    {
      $project: {
        month: { $month: '$createdAt' },
        grandTotal: 1,
        restaurantCommission: 1,
      },
    },
    {
      $group: {
        _id: '$month',
        count: { $sum: 1 },
        grandTotal: { $sum: '$grandTotal' },
        restaurantCommission: { $sum: '$restaurantCommission' },
      },
    },
    {
      $project: {
        _id: 0,
        month: '$_id',
        count: 1,
        grandTotal: { $round: [{ $divide: ['$grandTotal', 100] }, 2] },
        commission: { $round: [{ $divide: ['$restaurantCommission', 100] }, 2] },
      },
    },
    {
      $sort: { month: 1 },
    },
  ]).then((monthData) => {
    const result = allMonths.map((m) => {
      const data = monthData.find((d) => d.month === m.month);
      return {
        label: m.label,
        count: data ? data.count : 0,
        grandTotal: data ? data.grandTotal : 0,
        commission: data ? data.commission : 0,
      };
    });

    return result;
  });
  return chart;
};

const cityBasedPOSOrderEarningBreakdown = async (city) => {
  const multipleYears = await PosOrTableOrder.aggregate([
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
    {
      $group: {
        _id: { $year: '$createdAt' },
        count: { $sum: 1 },
      },
    },
  ]);
  if (multipleYears.length > 1) {
    const chart = await PosOrTableOrder.aggregate([
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
      {
        $project: {
          year: { $year: '$createdAt' },
          grandTotal: 1,
          restaurantCommission: 1,
        },
      },
      {
        $group: {
          _id: '$year',
          count: { $sum: 1 },
          grandTotal: { $sum: '$grandTotal' },
          restaurantCommission: { $sum: '$restaurantCommission' },
        },
      },
      {
        $project: {
          _id: 0,
          label: '$_id',
          count: 1,
          grandTotal: { $round: [{ $divide: ['$grandTotal', 100] }, 2] },
          commission: { $round: [{ $divide: ['$restaurantCommission', 100] }, 2] },
        },
      },
      {
        $sort: { label: 1 },
      },
    ]);
    return chart;
  }

  const allMonths = [
    { month: 1, label: 'January' },
    { month: 2, label: 'February' },
    { month: 3, label: 'March' },
    { month: 4, label: 'April' },
    { month: 5, label: 'May' },
    { month: 6, label: 'June' },
    { month: 7, label: 'July' },
    { month: 8, label: 'August' },
    { month: 9, label: 'September' },
    { month: 10, label: 'October' },
    { month: 11, label: 'November' },
    { month: 12, label: 'December' },
  ];

  const chart = await PosOrTableOrder.aggregate([
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
    {
      $project: {
        month: { $month: '$createdAt' },
        grandTotal: 1,
        restaurantCommission: 1,
      },
    },
    {
      $group: {
        _id: '$month',
        count: { $sum: 1 },
        grandTotal: { $sum: '$grandTotal' },
        restaurantCommission: { $sum: '$restaurantCommission' },
      },
    },
    {
      $project: {
        _id: 0,
        month: '$_id',
        count: 1,
        grandTotal: { $round: [{ $divide: ['$grandTotal', 100] }, 2] },
        commission: { $round: [{ $divide: ['$restaurantCommission', 100] }, 2] },
      },
    },
    {
      $sort: { month: 1 },
    },
  ]).then((monthData) => {
    const result = allMonths.map((m) => {
      const data = monthData.find((d) => d.month === m.month);
      return {
        label: m.label,
        count: data ? data.count : 0,
        grandTotal: data ? data.grandTotal : 0,
        commission: data ? data.commission : 0,
      };
    });

    return result;
  });
  return chart;
};

const tableOrderEarningBreakdown = async () => {
  const multipleYears = await TableOrder.aggregate([
    {
      $group: {
        _id: { $year: '$createdAt' },
        count: { $sum: 1 },
      },
    },
  ]);
  if (multipleYears.length > 1) {
    const chart = await TableOrder.aggregate([
      {
        $project: {
          year: { $year: '$createdAt' },
          grandTotal: 1,
          restaurantCommission: 1,
        },
      },
      {
        $group: {
          _id: '$year',
          count: { $sum: 1 },
          grandTotal: { $sum: '$grandTotal' },
          restaurantCommission: { $sum: '$restaurantCommission' },
        },
      },
      {
        $project: {
          _id: 0,
          label: '$_id',
          count: 1,
          grandTotal: { $round: [{ $divide: ['$grandTotal', 100] }, 2] },
          commission: { $round: [{ $divide: ['$restaurantCommission', 100] }, 2] },
        },
      },
      {
        $sort: { label: 1 },
      },
    ]);
    return chart;
  }

  const allMonths = [
    { month: 1, label: 'January' },
    { month: 2, label: 'February' },
    { month: 3, label: 'March' },
    { month: 4, label: 'April' },
    { month: 5, label: 'May' },
    { month: 6, label: 'June' },
    { month: 7, label: 'July' },
    { month: 8, label: 'August' },
    { month: 9, label: 'September' },
    { month: 10, label: 'October' },
    { month: 11, label: 'November' },
    { month: 12, label: 'December' },
  ];

  const chart = await TableOrder.aggregate([
    {
      $project: {
        month: { $month: '$createdAt' },
        grandTotal: 1,
        restaurantCommission: 1,
      },
    },
    {
      $group: {
        _id: '$month',
        count: { $sum: 1 },
        grandTotal: { $sum: '$grandTotal' },
        restaurantCommission: { $sum: '$restaurantCommission' },
      },
    },
    {
      $project: {
        _id: 0,
        month: '$_id',
        count: 1,
        grandTotal: { $round: [{ $divide: ['$grandTotal', 100] }, 2] },
        commission: { $round: [{ $divide: ['$restaurantCommission', 100] }, 2] },
      },
    },
    {
      $sort: { month: 1 },
    },
  ]).then((monthData) => {
    const result = allMonths.map((m) => {
      const data = monthData.find((d) => d.month === m.month);
      return {
        label: m.label,
        count: data ? data.count : 0,
        grandTotal: data ? data.grandTotal : 0,
        commission: data ? data.commission : 0,
      };
    });

    return result;
  });
  return chart;
};

const cityBasedTableOrderEarningBreakdown = async (city) => {
  const multipleYears = await TableOrder.aggregate([
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
    {
      $group: {
        _id: { $year: '$createdAt' },
        count: { $sum: 1 },
      },
    },
  ]);
  if (multipleYears.length > 1) {
    const chart = await TableOrder.aggregate([
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
      {
        $project: {
          year: { $year: '$createdAt' },
          grandTotal: 1,
          restaurantCommission: 1,
        },
      },
      {
        $group: {
          _id: '$year',
          count: { $sum: 1 },
          grandTotal: { $sum: '$grandTotal' },
          restaurantCommission: { $sum: '$restaurantCommission' },
        },
      },
      {
        $project: {
          _id: 0,
          label: '$_id',
          count: 1,
          grandTotal: { $round: [{ $divide: ['$grandTotal', 100] }, 2] },
          commission: { $round: [{ $divide: ['$restaurantCommission', 100] }, 2] },
        },
      },
      {
        $sort: { label: 1 },
      },
    ]);
    return chart;
  }

  const allMonths = [
    { month: 1, label: 'January' },
    { month: 2, label: 'February' },
    { month: 3, label: 'March' },
    { month: 4, label: 'April' },
    { month: 5, label: 'May' },
    { month: 6, label: 'June' },
    { month: 7, label: 'July' },
    { month: 8, label: 'August' },
    { month: 9, label: 'September' },
    { month: 10, label: 'October' },
    { month: 11, label: 'November' },
    { month: 12, label: 'December' },
  ];

  const chart = await TableOrder.aggregate([
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
    {
      $project: {
        month: { $month: '$createdAt' },
        grandTotal: 1,
        restaurantCommission: 1,
      },
    },
    {
      $group: {
        _id: '$month',
        count: { $sum: 1 },
        grandTotal: { $sum: '$grandTotal' },
        restaurantCommission: { $sum: '$restaurantCommission' },
      },
    },
    {
      $project: {
        _id: 0,
        month: '$_id',
        count: 1,
        grandTotal: { $round: [{ $divide: ['$grandTotal', 100] }, 2] },
        commission: { $round: [{ $divide: ['$restaurantCommission', 100] }, 2] },
      },
    },
    {
      $sort: { month: 1 },
    },
  ]).then((monthData) => {
    const result = allMonths.map((m) => {
      const data = monthData.find((d) => d.month === m.month);
      return {
        label: m.label,
        count: data ? data.count : 0,
        grandTotal: data ? data.grandTotal : 0,
        commission: data ? data.commission : 0,
      };
    });

    return result;
  });
  return chart;
};

const diningBookingEarningBreakdown = async () => {
  const multipleYears = await DiningBooking.aggregate([
    {
      $group: {
        _id: { $year: '$createdAt' },
        count: { $sum: 1 },
      },
    },
  ]);
  if (multipleYears.length > 1) {
    const chart = await DiningBooking.aggregate([
      {
        $project: {
          year: { $year: '$createdAt' },
          grandTotal: 1,
          bookingCommission: 1,
        },
      },
      {
        $group: {
          _id: '$year',
          count: { $sum: 1 },
          grandTotal: { $sum: '$grandTotal' },
          bookingCommission: { $sum: '$bookingCommission' },
        },
      },
      {
        $project: {
          _id: 0,
          label: '$_id',
          count: 1,
          grandTotal: { $round: [{ $divide: ['$grandTotal', 100] }, 2] },
          commission: { $round: [{ $divide: ['$bookingCommission', 100] }, 2] },
        },
      },
      {
        $sort: { label: 1 },
      },
    ]);
    return chart;
  }

  const allMonths = [
    { month: 1, label: 'January' },
    { month: 2, label: 'February' },
    { month: 3, label: 'March' },
    { month: 4, label: 'April' },
    { month: 5, label: 'May' },
    { month: 6, label: 'June' },
    { month: 7, label: 'July' },
    { month: 8, label: 'August' },
    { month: 9, label: 'September' },
    { month: 10, label: 'October' },
    { month: 11, label: 'November' },
    { month: 12, label: 'December' },
  ];

  const chart = await DiningBooking.aggregate([
    {
      $project: {
        month: { $month: '$createdAt' },
        grandTotal: 1,
        bookingCommission: 1,
      },
    },
    {
      $group: {
        _id: '$month',
        count: { $sum: 1 },
        grandTotal: { $sum: '$grandTotal' },
        bookingCommission: { $sum: '$bookingCommission' },
      },
    },
    {
      $project: {
        _id: 0,
        month: '$_id',
        count: 1,
        grandTotal: { $round: [{ $divide: ['$grandTotal', 100] }, 2] },
        commission: { $round: [{ $divide: ['$bookingCommission', 100] }, 2] },
      },
    },
    {
      $sort: { month: 1 },
    },
  ]).then((monthData) => {
    const result = allMonths.map((m) => {
      const data = monthData.find((d) => d.month === m.month);
      return {
        label: m.label,
        count: data ? data.count : 0,
        grandTotal: data ? data.grandTotal : 0,
        commission: data ? data.commission : 0,
      };
    });

    return result;
  });
  return chart;
};

const cityBasedDiningBookingEarningBreakdown = async (city) => {
  const multipleYears = await DiningBooking.aggregate([
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
    {
      $group: {
        _id: { $year: '$createdAt' },
        count: { $sum: 1 },
      },
    },
  ]);
  if (multipleYears.length > 1) {
    const chart = await DiningBooking.aggregate([
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
      {
        $project: {
          year: { $year: '$createdAt' },
          grandTotal: 1,
          bookingCommission: 1,
        },
      },
      {
        $group: {
          _id: '$year',
          count: { $sum: 1 },
          grandTotal: { $sum: '$grandTotal' },
          bookingCommission: { $sum: '$bookingCommission' },
        },
      },
      {
        $project: {
          _id: 0,
          label: '$_id',
          count: 1,
          grandTotal: { $round: [{ $divide: ['$grandTotal', 100] }, 2] },
          commission: { $round: [{ $divide: ['$bookingCommission', 100] }, 2] },
        },
      },
      {
        $sort: { label: 1 },
      },
    ]);
    return chart;
  }

  const allMonths = [
    { month: 1, label: 'January' },
    { month: 2, label: 'February' },
    { month: 3, label: 'March' },
    { month: 4, label: 'April' },
    { month: 5, label: 'May' },
    { month: 6, label: 'June' },
    { month: 7, label: 'July' },
    { month: 8, label: 'August' },
    { month: 9, label: 'September' },
    { month: 10, label: 'October' },
    { month: 11, label: 'November' },
    { month: 12, label: 'December' },
  ];

  const chart = await DiningBooking.aggregate([
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
    {
      $project: {
        month: { $month: '$createdAt' },
        grandTotal: 1,
        bookingCommission: 1,
      },
    },
    {
      $group: {
        _id: '$month',
        count: { $sum: 1 },
        grandTotal: { $sum: '$grandTotal' },
        bookingCommission: { $sum: '$bookingCommission' },
      },
    },
    {
      $project: {
        _id: 0,
        month: '$_id',
        count: 1,
        grandTotal: { $round: [{ $divide: ['$grandTotal', 100] }, 2] },
        commission: { $round: [{ $divide: ['$bookingCommission', 100] }, 2] },
      },
    },
    {
      $sort: { month: 1 },
    },
  ]).then((monthData) => {
    const result = allMonths.map((m) => {
      const data = monthData.find((d) => d.month === m.month);
      return {
        label: m.label,
        count: data ? data.count : 0,
        grandTotal: data ? data.grandTotal : 0,
        commission: data ? data.commission : 0,
      };
    });

    return result;
  });
  return chart;
};

const adminDashboard = async () => {
  const fresh = await Orders.countDocuments({ status: 'created' });
  const accepted = await Orders.countDocuments({ status: 'accepted' });
  const preparing = await Orders.countDocuments({ status: 'preparing' });
  const ready = await Orders.countDocuments({ status: 'ready' });
  const handover = await Orders.countDocuments({ status: 'handover' });
  const ongoing = await Orders.countDocuments({ status: 'ongoing' });
  const delivered = await Orders.countDocuments({ status: 'delivered' });
  const cancelled = await Orders.countDocuments({ status: 'cancelled' });
  const rejected = await Orders.countDocuments({ status: 'rejected' });
  const refunded = await Orders.countDocuments({ status: 'refunded' });
  const partially = await Orders.countDocuments({ status: 'partially_refunded' });
  const pending = await Orders.countDocuments({ status: 'pending_payments' });

  const totalUsers = await User.countDocuments({ role: 'user' });
  const totalDeliveryman = await User.countDocuments({ role: 'driver' });
  const totalVendor = await User.countDocuments({ role: 'vendor' });
  const totalVendorDeliveryman = await User.countDocuments({ role: 'vendorDriver' });
  const totalOutlet = await User.countDocuments({ role: 'vendorOutlet' });
  const totalCityMaster = await User.countDocuments({ role: 'cityMaster' });
  const totalSupportTeam = await User.countDocuments({ role: 'supportTeam' });
  const totalGuest = await User.countDocuments({ role: 'guest' });
  const totalWaiter = await User.countDocuments({ role: 'waiter' });
  const totalAccountant = await User.countDocuments({ role: 'accountant' });
  const totalKitchenOwner = await User.countDocuments({ role: 'kitchen' });

  const orderEarningStats = await orderEarningBreakdown();
  const posOrderEarningStats = await posOrderEarningBreakdown();
  const tableOrderEarningStats = await tableOrderEarningBreakdown();
  const diningBookingEarningStats = await diningBookingEarningBreakdown();

  const topRatedRestaurant = await Restaurant.aggregate([
    { $sort: { rating: -1 } },
    { $limit: 10 },
    {
      $lookup: {
        from: 'restaurantorderreviews',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'restaurantorderreviews',
      },
    },
    {
      $lookup: {
        from: 'cities',
        localField: 'city',
        foreignField: '_id',
        as: 'cities',
      },
    },
    {
      $lookup: {
        from: 'localities',
        localField: 'locality',
        foreignField: '_id',
        as: 'localities',
      },
    },
    {
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$localities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        logo: 1,
        translations: 1,
        rating: 1,
        totalRating: {
          $size: '$restaurantorderreviews',
        },
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
      },
    },
  ]);

  const topOrderedRestaurant = await Restaurant.aggregate([
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'orders',
      },
    },
    {
      $addFields: {
        totalOrders: { $size: '$orders' },
      },
    },
    {
      $sort: { totalOrders: -1 },
    },
    { $limit: 10 },
    {
      $lookup: {
        from: 'cities',
        localField: 'city',
        foreignField: '_id',
        as: 'cities',
      },
    },
    {
      $lookup: {
        from: 'localities',
        localField: 'locality',
        foreignField: '_id',
        as: 'localities',
      },
    },
    {
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$localities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        logo: 1,
        translations: 1,
        totalOrders: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
      },
    },
  ]);

  const topRatedFood = await Food.aggregate([
    { $limit: 10 },
    { $sort: { rating: -1 } },
    {
      $lookup: {
        from: 'foodorderreviews',
        localField: '_id',
        foreignField: 'food',
        as: 'foodorderreviews',
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
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        image: 1,
        rating: 1,
        translations: 1,
        totalRating: {
          $size: '$foodorderreviews',
        },
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ]);

  const topOrderedFood = await Food.aggregate([
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'foods',
        as: 'orders',
      },
    },
    {
      $addFields: {
        orderCount: { $size: '$orders' },
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
      $sort: { orderCount: -1 },
    },
    { $limit: 10 },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        image: 1,
        translations: 1,
        orderCount: 1,
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ]);

  const topRatedDeliveryman = await Driver.aggregate([
    { $sort: { rating: -1 } },
    { $limit: 10 },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
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
        from: 'cities',
        localField: 'city',
        foreignField: '_id',
        as: 'cities',
      },
    },
    {
      $lookup: {
        from: 'localities',
        localField: 'locality',
        foreignField: '_id',
        as: 'localities',
      },
    },
    {
      $lookup: {
        from: 'driverorderreviews',
        localField: 'userId',
        foreignField: 'driver',
        as: 'driverorderreviews',
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
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$localities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        rating: 1,
        totalRating: {
          $size: '$driverorderreviews',
        },
        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
        },
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
      },
    },
  ]);

  const topOrderHandlingDeliveryan = await Driver.aggregate([
    {
      $lookup: {
        from: 'orders',
        localField: 'userId',
        foreignField: 'driver',
        as: 'orders',
      },
    },
    {
      $addFields: {
        totalOrders: { $size: '$orders' },
      },
    },
    {
      $sort: { totalOrders: -1 },
    },
    { $limit: 10 },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
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
        from: 'cities',
        localField: 'city',
        foreignField: '_id',
        as: 'cities',
      },
    },
    {
      $lookup: {
        from: 'localities',
        localField: 'locality',
        foreignField: '_id',
        as: 'localities',
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
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$localities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        totalOrders: 1,
        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
        },
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
      },
    },
  ]);

  const expenseData = await AdminExpense.aggregate([
    {
      $group: {
        _id: null,
        couponExpense: {
          $sum: {
            $cond: { if: { $in: ['$expenseType', ['coupon']] }, then: '$amount', else: 0 },
          },
        },
        deliveryChargeExpense: {
          $sum: {
            $cond: { if: { $in: ['$expenseType', ['delivery_charge']] }, then: '$amount', else: 0 },
          },
        },
        referralChargeExpense: {
          $sum: {
            $cond: { if: { $in: ['$expenseType', ['referral']] }, then: '$amount', else: 0 },
          },
        },
        walletBonusExpense: {
          $sum: {
            $cond: { if: { $in: ['$expenseType', ['wallet_bonus']] }, then: '$amount', else: 0 },
          },
        },
        loyaltyPointsExpense: {
          $sum: {
            $cond: { if: { $in: ['$expenseType', ['loyalty_points']] }, then: '$amount', else: 0 },
          },
        },
        diningCouponExpense: {
          $sum: {
            $cond: {
              if: { $in: ['$expenseType', ['dining_booking_coupon']] },
              then: '$amount',
              else: 0,
            },
          },
        },
        walletCreditExpense: {
          $sum: {
            $cond: {
              if: { $in: ['$expenseType', ['customer_wallet_credit']] },
              then: '$amount',
              else: 0,
            },
          },
        },
        itSupportExpense: {
          $sum: {
            $cond: {
              if: { $in: ['$expenseType', ['it_support_service']] },
              then: '$amount',
              else: 0,
            },
          },
        },
        adsExpense: {
          $sum: {
            $cond: { if: { $in: ['$expenseType', ['ads']] }, then: '$amount', else: 0 },
          },
        },
        employeeExpense: {
          $sum: {
            $cond: {
              if: { $in: ['$expenseType', ['employee_expenses']] },
              then: '$amount',
              else: 0,
            },
          },
        },
        outSourceExpense: {
          $sum: {
            $cond: { if: { $in: ['$expenseType', ['outsource']] }, then: '$amount', else: 0 },
          },
        },
        paymentGatewayChargeExpense: {
          $sum: {
            $cond: {
              if: { $in: ['$expenseType', ['payment_gateway_charge']] },
              then: '$amount',
              else: 0,
            },
          },
        },
        otherExpense: {
          $sum: {
            $cond: { if: { $in: ['$expenseType', ['other']] }, then: '$amount', else: 0 },
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        couponExpense: { $round: [{ $divide: ['$couponExpense', 100] }, 2] },
        deliveryChargeExpense: { $round: [{ $divide: ['$deliveryChargeExpense', 100] }, 2] },
        referralChargeExpense: { $round: [{ $divide: ['$referralChargeExpense', 100] }, 2] },
        walletBonusExpense: { $round: [{ $divide: ['$walletBonusExpense', 100] }, 2] },
        loyaltyPointsExpense: { $round: [{ $divide: ['$loyaltyPointsExpense', 100] }, 2] },
        diningCouponExpense: { $round: [{ $divide: ['$diningCouponExpense', 100] }, 2] },
        walletCreditExpense: { $round: [{ $divide: ['$walletCreditExpense', 100] }, 2] },
        itSupportExpense: { $round: [{ $divide: ['$itSupportExpense', 100] }, 2] },
        adsExpense: { $round: [{ $divide: ['$adsExpense', 100] }, 2] },
        employeeExpense: { $round: [{ $divide: ['$employeeExpense', 100] }, 2] },
        outSourceExpense: { $round: [{ $divide: ['$outSourceExpense', 100] }, 2] },
        paymentGatewayChargeExpense: {
          $round: [{ $divide: ['$paymentGatewayChargeExpense', 100] }, 2],
        },
        otherExpense: { $round: [{ $divide: ['$otherExpense', 100] }, 2] },
      },
    },
  ]);

  return Promise.all([
    fresh,
    accepted,
    preparing,
    ready,
    handover,
    ongoing,
    delivered,
    cancelled,
    rejected,
    refunded,
    partially,
    pending,
    totalUsers,
    totalDeliveryman,
    totalVendor,
    totalVendorDeliveryman,
    totalOutlet,
    totalCityMaster,
    totalSupportTeam,
    totalGuest,
    totalWaiter,
    totalAccountant,
    totalKitchenOwner,
    orderEarningStats,
    posOrderEarningStats,
    tableOrderEarningStats,
    diningBookingEarningStats,
    topRatedRestaurant,
    topOrderedRestaurant,
    topRatedFood,
    topOrderedFood,
    topRatedDeliveryman,
    topOrderHandlingDeliveryan,
    expenseData,
  ]).then(() => {
    const count = {
      fresh,
      accepted,
      preparing,
      ready,
      handover,
      ongoing,
      delivered,
      cancelled,
      rejected,
      refunded,
      partially,
      pending,
    };
    const roles = {
      totalUsers,
      totalDeliveryman,
      totalVendor,
      totalVendorDeliveryman,
      totalOutlet,
      totalCityMaster,
      totalSupportTeam,
      totalGuest,
      totalWaiter,
      totalAccountant,
      totalKitchenOwner,
    };
    const expenses = {
      couponExpense: 0,
      deliveryChargeExpense: 0,
      referralChargeExpense: 0,
      walletBonusExpense: 0,
      loyaltyPointsExpense: 0,
      diningCouponExpense: 0,
      walletCreditExpense: 0,
      itSupportExpense: 0,
      adsExpense: 0,
      employeeExpense: 0,
      outSourceExpense: 0,
      paymentGatewayChargeExpense: 0,
      otherExpense: 0,
    };
    if (checkArrayNotEmpty(expenseData)) {
      expenses.couponExpense = expenseData[0].couponExpense;
      expenses.deliveryChargeExpense = expenseData[0].deliveryChargeExpense;
      expenses.referralChargeExpense = expenseData[0].referralChargeExpense;
      expenses.walletBonusExpense = expenseData[0].walletBonusExpense;
      expenses.loyaltyPointsExpense = expenseData[0].loyaltyPointsExpense;
      expenses.diningCouponExpense = expenseData[0].diningCouponExpense;
      expenses.walletCreditExpense = expenseData[0].walletCreditExpense;
      expenses.itSupportExpense = expenseData[0].itSupportExpense;
      expenses.adsExpense = expenseData[0].adsExpense;
      expenses.employeeExpense = expenseData[0].employeeExpense;
      expenses.outSourceExpense = expenseData[0].outSourceExpense;
      expenses.paymentGatewayChargeExpense = expenseData[0].paymentGatewayChargeExpense;
      expenses.otherExpense = expenseData[0].otherExpense;
    }
    const result = {
      count,
      roles,
      orderEarningStats,
      posOrderEarningStats,
      tableOrderEarningStats,
      diningBookingEarningStats,
      topRatedRestaurant,
      topOrderedRestaurant,
      topRatedFood,
      topOrderedFood,
      topRatedDeliveryman,
      topOrderHandlingDeliveryan,
      expenses,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const couponOrders = async (id, options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const queryCondition = { coupon: new mongoose.Types.ObjectId(id) };
  const orderQuery = [
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
        orderNo: 1,
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        paymentMode: 1,
        status: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        scheduleDate: 1,
        scheduleTime: 1,
        orderAt: 1,
        createdAt: 1,
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        orderTo: 1,
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
  const orders = await Orders.aggregate(orderQuery);
  const totalResults = await Orders.countDocuments(queryCondition);
  return Promise.all([orders, totalResults]).then(() => {
    const result = {
      orders,
      totalResults,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const adminOrderInvoice = async (id) => {
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
        orderNo: 1,
        status: 1,
        deliveryAddressRaw: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$deliveryAddressRaw'],
            lang: 'js',
          },
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
        countryCode: 1,
        receiverContact: 1,
        receiverName: 1,
        user: 1,
        createdAt: 1,
        scheduleDate: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        orderAt: 1,
        scheduleTime: 1,
        orderTo: 1,
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
        couponDiscountCharge: {
          $round: [{ $divide: ['$couponDiscountCharge', 100] }, 2],
        },
        deliveryCharge: {
          $round: [{ $divide: ['$deliveryCharge', 100] }, 2],
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
        walletAmount: {
          $round: [{ $divide: ['$walletAmount', 100] }, 2],
        },
        deliveryTip: {
          $round: [{ $divide: ['$deliveryTip', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
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
  const orders = await Orders.aggregate(orderQuery);
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

const vendorOrderInvoice = async (id, vendor) => {
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
        orderNo: 1,
        status: 1,
        deliveryAddressRaw: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$deliveryAddressRaw'],
            lang: 'js',
          },
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
        countryCode: 1,
        receiverContact: 1,
        receiverName: 1,
        user: 1,
        createdAt: 1,
        scheduleDate: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        orderAt: 1,
        scheduleTime: 1,
        orderTo: 1,
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
        couponDiscountCharge: {
          $round: [{ $divide: ['$couponDiscountCharge', 100] }, 2],
        },
        deliveryCharge: {
          $round: [{ $divide: ['$deliveryCharge', 100] }, 2],
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
        walletAmount: {
          $round: [{ $divide: ['$walletAmount', 100] }, 2],
        },
        deliveryTip: {
          $round: [{ $divide: ['$deliveryTip', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        restaurant: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          address: { $ifNull: ['$restaurants.address', ''] },
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
  const orders = await Orders.aggregate(orderQuery);
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

const supportTeamOrderDetail = async (orderId) => {
  const orderDetailQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(orderId) } },
    { $limit: 1 },
    {
      $lookup: {
        from: 'users',
        localField: 'driver',
        foreignField: '_id',
        as: 'driver',
      },
    },
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
        path: '$driver',
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
      $lookup: {
        from: 'deliveryinstructions',
        localField: 'deliveryInstruction',
        foreignField: '_id',
        as: 'deliveryinstructions',
      },
    },
    {
      $unwind: {
        path: '$deliveryinstructions',
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
        deliveryAddressRaw: {
          $function: {
            body: function (jsonString) {
              return jsonString !== null && jsonString !== '' ? JSON.parse(jsonString) : null;
            },
            args: ['$deliveryAddressRaw'],
            lang: 'js',
          },
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
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        customerOrderPin: 1,
        driverOrderPin: 1,
        user: 1,
        cookingInstruction: 1,
        createdAt: 1,
        scheduleDate: 1,
        orderAt: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        scheduleTime: 1,
        orderTo: 1,
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
        couponDiscountCharge: {
          $round: [{ $divide: ['$couponDiscountCharge', 100] }, 2],
        },
        deliveryCharge: {
          $round: [{ $divide: ['$deliveryCharge', 100] }, 2],
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
        walletAmount: {
          $round: [{ $divide: ['$walletAmount', 100] }, 2],
        },
        deliveryTip: {
          $round: [{ $divide: ['$deliveryTip', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        deliveryInstructionInfo: {
          id: { $ifNull: ['$deliveryinstructions._id', ''] },
          name: { $ifNull: ['$deliveryinstructions.name', ''] },
          image: { $ifNull: ['$deliveryinstructions.image', ''] },
          translations: { $ifNull: ['$deliveryinstructions.translations', []] },
        },
        driverInfo: {
          id: { $ifNull: ['$driver._id', ''] },
          firstName: { $ifNull: ['$driver.firstName', ''] },
          lastName: { $ifNull: ['$driver.lastName', ''] },
          image: { $ifNull: ['$driver.image', ''] },
          countryCode: { $ifNull: ['$driver.countryCode', ''] },
          mobile: { $ifNull: ['$driver.mobile', ''] },
          role: { $ifNull: ['$driver.role', ''] },
          email: { $ifNull: ['$driver.email', ''] },
        },
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          mobile: { $ifNull: ['$users.mobile', ''] },
          role: { $ifNull: ['$users.role', ''] },
          email: { $ifNull: ['$users.email', ''] },
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
  const orders = await Orders.aggregate(orderDetailQuery);
  if (orders !== null && orders.length > 0) {
    const info = orders[0];
    const deliveryProof = await OrderDeliveryProof.findOne({
      orderId: new mongoose.Types.ObjectId(orderId),
    });
    const userTotalOrderCount = await Orders.countDocuments({
      user: new mongoose.Types.ObjectId(info.user),
    });
    let driverDeliveredOrder = 0;
    if (
      info !== null &&
      info.orderTo === 'homedelivery' &&
      info.driverInfo !== null &&
      info.driverInfo.id !== null &&
      info.driverInfo.id !== ''
    ) {
      driverDeliveredOrder = await Orders.countDocuments({
        driver: new mongoose.Types.ObjectId(info.driverInfo.id),
        status: 'delivered',
      });
    }
    let restUserInfo = null;
    if (info !== null && info.restaurant !== null && info.restaurant.userId !== null) {
      restUserInfo = await User.findById(info.restaurant.userId, {
        firstName: 1,
        lastName: 1,
        mobile: 1,
        countryCode: 1,
        role: 1,
        image: 1,
        email: 1,
      });
    }
    let storeOrderCount = 0;
    if (
      info !== null &&
      info.restaurant !== null &&
      info.restaurant.id !== null &&
      info.restaurant.id !== ''
    ) {
      storeOrderCount = await Orders.countDocuments({
        restaurant: new mongoose.Types.ObjectId(info.restaurant.id),
        status: 'delivered',
      });
    }
    return Promise.all([
      info,
      deliveryProof,
      userTotalOrderCount,
      driverDeliveredOrder,
      restUserInfo,
      storeOrderCount,
    ]).then(() => {
      const result = {
        info,
        deliveryProof,
        userTotalOrderCount,
        driverDeliveredOrder,
        restUserInfo,
        storeOrderCount,
        success: true,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const accountantDashboard = async () => {
  const orderEarningStats = await orderEarningBreakdown();
  const posOrderEarningStats = await posOrderEarningBreakdown();
  const tableOrderEarningStats = await tableOrderEarningBreakdown();
  const diningBookingEarningStats = await diningBookingEarningBreakdown();
  const expenseData = await AdminExpense.aggregate([
    {
      $group: {
        _id: null,
        couponExpense: {
          $sum: {
            $cond: { if: { $in: ['$expenseType', ['coupon']] }, then: '$amount', else: 0 },
          },
        },
        deliveryChargeExpense: {
          $sum: {
            $cond: { if: { $in: ['$expenseType', ['delivery_charge']] }, then: '$amount', else: 0 },
          },
        },
        referralChargeExpense: {
          $sum: {
            $cond: { if: { $in: ['$expenseType', ['referral']] }, then: '$amount', else: 0 },
          },
        },
        walletBonusExpense: {
          $sum: {
            $cond: { if: { $in: ['$expenseType', ['wallet_bonus']] }, then: '$amount', else: 0 },
          },
        },
        loyaltyPointsExpense: {
          $sum: {
            $cond: { if: { $in: ['$expenseType', ['loyalty_points']] }, then: '$amount', else: 0 },
          },
        },
        diningCouponExpense: {
          $sum: {
            $cond: {
              if: { $in: ['$expenseType', ['dining_booking_coupon']] },
              then: '$amount',
              else: 0,
            },
          },
        },
        walletCreditExpense: {
          $sum: {
            $cond: {
              if: { $in: ['$expenseType', ['customer_wallet_credit']] },
              then: '$amount',
              else: 0,
            },
          },
        },
        itSupportExpense: {
          $sum: {
            $cond: {
              if: { $in: ['$expenseType', ['it_support_service']] },
              then: '$amount',
              else: 0,
            },
          },
        },
        adsExpense: {
          $sum: {
            $cond: { if: { $in: ['$expenseType', ['ads']] }, then: '$amount', else: 0 },
          },
        },
        employeeExpense: {
          $sum: {
            $cond: {
              if: { $in: ['$expenseType', ['employee_expenses']] },
              then: '$amount',
              else: 0,
            },
          },
        },
        outSourceExpense: {
          $sum: {
            $cond: { if: { $in: ['$expenseType', ['outsource']] }, then: '$amount', else: 0 },
          },
        },
        paymentGatewayChargeExpense: {
          $sum: {
            $cond: {
              if: { $in: ['$expenseType', ['payment_gateway_charge']] },
              then: '$amount',
              else: 0,
            },
          },
        },
        otherExpense: {
          $sum: {
            $cond: { if: { $in: ['$expenseType', ['other']] }, then: '$amount', else: 0 },
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        couponExpense: { $round: [{ $divide: ['$couponExpense', 100] }, 2] },
        deliveryChargeExpense: { $round: [{ $divide: ['$deliveryChargeExpense', 100] }, 2] },
        referralChargeExpense: { $round: [{ $divide: ['$referralChargeExpense', 100] }, 2] },
        walletBonusExpense: { $round: [{ $divide: ['$walletBonusExpense', 100] }, 2] },
        loyaltyPointsExpense: { $round: [{ $divide: ['$loyaltyPointsExpense', 100] }, 2] },
        diningCouponExpense: { $round: [{ $divide: ['$diningCouponExpense', 100] }, 2] },
        walletCreditExpense: { $round: [{ $divide: ['$walletCreditExpense', 100] }, 2] },
        itSupportExpense: { $round: [{ $divide: ['$itSupportExpense', 100] }, 2] },
        adsExpense: { $round: [{ $divide: ['$adsExpense', 100] }, 2] },
        employeeExpense: { $round: [{ $divide: ['$employeeExpense', 100] }, 2] },
        outSourceExpense: { $round: [{ $divide: ['$outSourceExpense', 100] }, 2] },
        paymentGatewayChargeExpense: {
          $round: [{ $divide: ['$paymentGatewayChargeExpense', 100] }, 2],
        },
        otherExpense: { $round: [{ $divide: ['$otherExpense', 100] }, 2] },
      },
    },
  ]);
  return Promise.all([
    orderEarningStats,
    posOrderEarningStats,
    tableOrderEarningStats,
    diningBookingEarningStats,
    expenseData,
  ]).then(() => {
    const expenses = {
      couponExpense: 0,
      deliveryChargeExpense: 0,
      referralChargeExpense: 0,
      walletBonusExpense: 0,
      loyaltyPointsExpense: 0,
      diningCouponExpense: 0,
      walletCreditExpense: 0,
      itSupportExpense: 0,
      adsExpense: 0,
      employeeExpense: 0,
      outSourceExpense: 0,
      paymentGatewayChargeExpense: 0,
      otherExpense: 0,
    };
    if (checkArrayNotEmpty(expenseData)) {
      expenses.couponExpense = expenseData[0].couponExpense;
      expenses.deliveryChargeExpense = expenseData[0].deliveryChargeExpense;
      expenses.referralChargeExpense = expenseData[0].referralChargeExpense;
      expenses.walletBonusExpense = expenseData[0].walletBonusExpense;
      expenses.loyaltyPointsExpense = expenseData[0].loyaltyPointsExpense;
      expenses.diningCouponExpense = expenseData[0].diningCouponExpense;
      expenses.walletCreditExpense = expenseData[0].walletCreditExpense;
      expenses.itSupportExpense = expenseData[0].itSupportExpense;
      expenses.adsExpense = expenseData[0].adsExpense;
      expenses.employeeExpense = expenseData[0].employeeExpense;
      expenses.outSourceExpense = expenseData[0].outSourceExpense;
      expenses.paymentGatewayChargeExpense = expenseData[0].paymentGatewayChargeExpense;
      expenses.otherExpense = expenseData[0].otherExpense;
    }
    const result = {
      orderEarningStats,
      posOrderEarningStats,
      tableOrderEarningStats,
      diningBookingEarningStats,
      expenses,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const cityzenDashboard = async (masterId) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;

  const freshCount = await Orders.aggregate([
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
  const acceptedCount = await Orders.aggregate([
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
  const preparingCount = await Orders.aggregate([
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
        status: 'preparing',
      },
    },
    { $count: 'totalCount' },
  ]);
  const readyCount = await Orders.aggregate([
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
        status: 'ready',
      },
    },
    { $count: 'totalCount' },
  ]);
  const handoverCount = await Orders.aggregate([
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
        status: 'handover',
      },
    },
    { $count: 'totalCount' },
  ]);
  const ongoingCount = await Orders.aggregate([
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
        status: 'ongoing',
      },
    },
    { $count: 'totalCount' },
  ]);
  const deliveredCount = await Orders.aggregate([
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
        status: 'delivered',
      },
    },
    { $count: 'totalCount' },
  ]);
  const cancelledCount = await Orders.aggregate([
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
  const rejectedCount = await Orders.aggregate([
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
  const refundedCount = await Orders.aggregate([
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
  const partiallyCount = await Orders.aggregate([
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
        status: 'partially',
      },
    },
    { $count: 'totalCount' },
  ]);
  const pendingCount = await Orders.aggregate([
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
        status: 'pending',
      },
    },
    { $count: 'totalCount' },
  ]);

  const orderEarningStats = await cityBasedOrderEarningBreakdown(city);
  const posOrderEarningStats = await cityBasedPOSOrderEarningBreakdown(city);
  const tableOrderEarningStats = await cityBasedTableOrderEarningBreakdown(city);
  const diningBookingEarningStats = await cityBasedDiningBookingEarningBreakdown(city);

  const topRatedRestaurant = await Restaurant.aggregate([
    {
      $match: {
        city: new mongoose.Types.ObjectId(city),
      },
    },
    { $sort: { rating: -1 } },
    { $limit: 10 },
    {
      $lookup: {
        from: 'restaurantorderreviews',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'restaurantorderreviews',
      },
    },
    {
      $lookup: {
        from: 'cities',
        localField: 'city',
        foreignField: '_id',
        as: 'cities',
      },
    },
    {
      $lookup: {
        from: 'localities',
        localField: 'locality',
        foreignField: '_id',
        as: 'localities',
      },
    },
    {
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$localities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        logo: 1,
        translations: 1,
        rating: 1,
        totalRating: {
          $size: '$restaurantorderreviews',
        },
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
      },
    },
  ]);

  const topOrderedRestaurant = await Restaurant.aggregate([
    {
      $match: {
        city: new mongoose.Types.ObjectId(city),
      },
    },
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'restaurant',
        as: 'orders',
      },
    },
    {
      $addFields: {
        totalOrders: { $size: '$orders' },
      },
    },
    {
      $sort: { totalOrders: -1 },
    },
    { $limit: 10 },
    {
      $lookup: {
        from: 'cities',
        localField: 'city',
        foreignField: '_id',
        as: 'cities',
      },
    },
    {
      $lookup: {
        from: 'localities',
        localField: 'locality',
        foreignField: '_id',
        as: 'localities',
      },
    },
    {
      $unwind: {
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$localities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        logo: 1,
        translations: 1,
        totalOrders: 1,
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
      },
    },
  ]);

  const topRatedFood = await Food.aggregate([
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
        from: 'foodorderreviews',
        localField: '_id',
        foreignField: 'food',
        as: 'foodorderreviews',
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
    { $limit: 10 },
    { $sort: { rating: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        image: 1,
        rating: 1,
        translations: 1,
        totalRating: {
          $size: '$foodorderreviews',
        },
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ]);

  const topOrderedFood = await Food.aggregate([
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'foods',
        as: 'orders',
      },
    },
    {
      $addFields: {
        orderCount: { $size: '$orders' },
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
      $match: {
        'restaurants.city': new mongoose.Types.ObjectId(city),
      },
    },
    {
      $sort: { orderCount: -1 },
    },
    { $limit: 10 },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        image: 1,
        translations: 1,
        orderCount: 1,
        restaurants: {
          id: { $ifNull: ['$restaurants._id', ''] },
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ]);

  const topRatedDeliveryman = await Driver.aggregate([
    {
      $match: {
        city: new mongoose.Types.ObjectId(city),
      },
    },
    { $sort: { rating: -1 } },
    { $limit: 10 },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
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
        from: 'cities',
        localField: 'city',
        foreignField: '_id',
        as: 'cities',
      },
    },
    {
      $lookup: {
        from: 'localities',
        localField: 'locality',
        foreignField: '_id',
        as: 'localities',
      },
    },
    {
      $lookup: {
        from: 'driverorderreviews',
        localField: 'userId',
        foreignField: 'driver',
        as: 'driverorderreviews',
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
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$localities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        rating: 1,
        totalRating: {
          $size: '$driverorderreviews',
        },
        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
        },
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
      },
    },
  ]);

  const topOrderHandlingDeliveryan = await Driver.aggregate([
    {
      $match: {
        city: new mongoose.Types.ObjectId(city),
      },
    },
    {
      $lookup: {
        from: 'orders',
        localField: 'userId',
        foreignField: 'driver',
        as: 'orders',
      },
    },
    {
      $addFields: {
        totalOrders: { $size: '$orders' },
      },
    },
    {
      $sort: { totalOrders: -1 },
    },
    { $limit: 10 },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
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
        from: 'cities',
        localField: 'city',
        foreignField: '_id',
        as: 'cities',
      },
    },
    {
      $lookup: {
        from: 'localities',
        localField: 'locality',
        foreignField: '_id',
        as: 'localities',
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
        path: '$cities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $unwind: {
        path: '$localities',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        totalOrders: 1,
        driverInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          image: { $ifNull: ['$users.image', ''] },
          countryCode: { $ifNull: ['$users.countryCode', ''] },
          contactNumber: { $ifNull: ['$users.contactNumber', ''] },
          contactEmail: { $ifNull: ['$users.contactEmail', ''] },
        },
        city: {
          id: { $ifNull: ['$cities._id', ''] },
          name: { $ifNull: ['$cities.name', ''] },
          translations: { $ifNull: ['$cities.translations', []] },
        },
        locality: {
          id: { $ifNull: ['$localities._id', ''] },
          name: { $ifNull: ['$localities.name', ''] },
          translations: { $ifNull: ['$localities.translations', []] },
        },
      },
    },
  ]);

  return Promise.all([
    cityzen,
    freshCount,
    freshCount,
    preparingCount,
    readyCount,
    handoverCount,
    ongoingCount,
    deliveredCount,
    cancelledCount,
    rejectedCount,
    refundedCount,
    partiallyCount,
    pendingCount,
    orderEarningStats,
    posOrderEarningStats,
    tableOrderEarningStats,
    diningBookingEarningStats,
    topRatedRestaurant,
    topOrderedRestaurant,
    topRatedFood,
    topOrderedFood,
    topRatedDeliveryman,
    topOrderHandlingDeliveryan,
  ]).then(() => {
    const fresh = checkArrayNotEmpty(freshCount) ? freshCount[0].totalCount : 0;
    const accepted = checkArrayNotEmpty(acceptedCount) ? acceptedCount[0].totalCount : 0;
    const preparing = checkArrayNotEmpty(preparingCount) ? preparingCount[0].totalCount : 0;
    const ready = checkArrayNotEmpty(readyCount) ? readyCount[0].totalCount : 0;
    const handover = checkArrayNotEmpty(handoverCount) ? handoverCount[0].totalCount : 0;
    const ongoing = checkArrayNotEmpty(ongoingCount) ? ongoingCount[0].totalCount : 0;
    const delivered = checkArrayNotEmpty(deliveredCount) ? deliveredCount[0].totalCount : 0;
    const cancelled = checkArrayNotEmpty(cancelledCount) ? cancelledCount[0].totalCount : 0;
    const rejected = checkArrayNotEmpty(rejectedCount) ? rejectedCount[0].totalCount : 0;
    const refunded = checkArrayNotEmpty(refundedCount) ? refundedCount[0].totalCount : 0;
    const partially = checkArrayNotEmpty(partiallyCount) ? partiallyCount[0].totalCount : 0;
    const pending = checkArrayNotEmpty(pendingCount) ? pendingCount[0].totalCount : 0;
    const count = {
      fresh,
      accepted,
      preparing,
      ready,
      handover,
      ongoing,
      delivered,
      cancelled,
      rejected,
      refunded,
      partially,
      pending,
    };
    const result = {
      count,
      orderEarningStats,
      posOrderEarningStats,
      tableOrderEarningStats,
      diningBookingEarningStats,
      topRatedRestaurant,
      topOrderedRestaurant,
      topRatedFood,
      topOrderedFood,
      topRatedDeliveryman,
      topOrderHandlingDeliveryan,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const exportQueryCollection = async (orderStatus, search) => {
  const searchRegExp = RegExp(search, 'i');
  const isValidObjectId = mongoose.Types.ObjectId.isValid(search);
  const numericSearch = Number(search);
  const isNumericSearch = !Number.isNaN(numericSearch);
  const orderMatch = {
    $or: [
      isNumericSearch ? { orderNo: numericSearch } : null,
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
    $and:
      orderStatus === 'schedule'
        ? [{ scheduleOrder: true, subscriptionOrder: false }]
        : [orderStatus !== 'all' ? { status: orderStatus } : { status: { $ne: 'all' } }],
  };
  const orderQuery = [
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
      $match: orderMatch,
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        paymentMode: 1,
        status: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        scheduleDate: 1,
        scheduleTime: 1,
        orderAt: 1,
        createdAt: 1,
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        orderTo: 1,
        orderNo: 1,
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
      },
    },
  ];
  const result = await Orders.aggregate(orderQuery);
  return result;
};

const exportQueryRawCollection = async (orderStatus, search) => {
  const searchRegExp = RegExp(search, 'i');
  const isValidObjectId = mongoose.Types.ObjectId.isValid(search);
  const numericSearch = Number(search);
  const isNumericSearch = !Number.isNaN(numericSearch);
  const orderMatch = {
    $or: [
      isNumericSearch ? { orderNo: numericSearch } : null,
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
    $and:
      orderStatus === 'schedule'
        ? [{ scheduleOrder: true, subscriptionOrder: false }]
        : [orderStatus !== 'all' ? { status: orderStatus } : { status: { $ne: 'all' } }],
  };
  const orderQuery = [
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
  const result = await Orders.aggregate(orderQuery);
  return result;
  // let queryCondition = {};
  // if (orderStatus === 'schedule') {
  //   queryCondition = { $and: [{ scheduleOrder: true, subscriptionOrder: false }] };
  // } else if (orderStatus !== 'all') {
  //   queryCondition = { status: orderStatus };
  // } else if (orderStatus === 'all') {
  //   queryCondition = { status: { $ne: 'all' } };
  // }
  // const results = await Orders.find(queryCondition).lean();
  // return results;
};

const exportUnAssignedOrderCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const isValidObjectId = mongoose.Types.ObjectId.isValid(search);
  const numericSearch = Number(search);
  const isNumericSearch = !Number.isNaN(numericSearch);
  const orderMatch = {
    $or: [
      isNumericSearch ? { orderNo: numericSearch } : null,
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
      { driverAssign: 'rejected' },
      { driverAssign: 'notfound' },
      { driverAssign: 'hardreject' },
    ].filter(Boolean),
    $and: [
      { orderTo: 'homedelivery' },
      { driver: null },
      { status: { $in: ['preparing', 'ready'] } },
    ],
  };
  const orderQuery = [
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
      $match: orderMatch,
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        paymentMode: 1,
        status: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        scheduleDate: 1,
        scheduleTime: 1,
        orderAt: 1,
        createdAt: 1,
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        orderTo: 1,
        orderNo: 1,
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
      },
    },
  ];
  const result = await Orders.aggregate(orderQuery);
  return result;
};

const exportUnAssignedRawOrderCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const isValidObjectId = mongoose.Types.ObjectId.isValid(search);
  const numericSearch = Number(search);
  const isNumericSearch = !Number.isNaN(numericSearch);
  const orderMatch = {
    $or: [
      isNumericSearch ? { orderNo: numericSearch } : null,
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
      { driverAssign: 'rejected' },
      { driverAssign: 'notfound' },
      { driverAssign: 'hardreject' },
    ].filter(Boolean),
    $and: [
      { orderTo: 'homedelivery' },
      { driver: null },
      { status: { $in: ['preparing', 'ready'] } },
    ],
  };
  const orderQuery = [
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
        restaurants: 0,
        users: 0,
      },
    },
  ];
  const result = await Orders.aggregate(orderQuery);
  return result;
};

const exportSubscriptionOrderQueryCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const isValidObjectId = mongoose.Types.ObjectId.isValid(search);
  const numericSearch = Number(search);
  const isNumericSearch = !Number.isNaN(numericSearch);
  const orderMatch = {
    $or: [
      isNumericSearch ? { orderNo: numericSearch } : null,
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
    $and: [{ subscriptionOrder: true }],
  };
  const orderQuery = [
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
      $match: orderMatch,
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        paymentMode: 1,
        status: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        scheduleDate: 1,
        scheduleTime: 1,
        orderAt: 1,
        createdAt: 1,
        receiverName: 1,
        countryCode: 1,
        receiverContact: 1,
        orderTo: 1,
        orderNo: 1,
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
      },
    },
  ];
  const result = await Orders.aggregate(orderQuery);
  return result;
};

const exportSubscriptionOrderQueryRawCollection = async (search) => {
  const searchRegExp = RegExp(search, 'i');
  const isValidObjectId = mongoose.Types.ObjectId.isValid(search);
  const numericSearch = Number(search);
  const isNumericSearch = !Number.isNaN(numericSearch);
  const orderMatch = {
    $or: [
      isNumericSearch ? { orderNo: numericSearch } : null,
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
    $and: [{ subscriptionOrder: true }],
  };
  const orderQuery = [
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
        restaurants: 0,
        users: 0,
      },
    },
  ];
  const result = await Orders.aggregate(orderQuery);
  return result;
};

const exportRegularOrderReportCollection = async (options) => {
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
        $or: [{ 'users.firstName': RegExp(name, 'i') }, { 'users.lastName': RegExp(name, 'i') }],
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 0,
        id: '$_id',
        orderNo: 1,
        realTotal: {
          $round: [{ $divide: ['$realTotal', 100] }, 2],
        },
        itemTotal: {
          $round: [{ $divide: ['$itemTotal', 100] }, 2],
        },
        itemDiscount: {
          $round: [{ $divide: ['$itemDiscount', 100] }, 2],
        },
        couponDiscountCharge: {
          $round: [{ $divide: ['$couponDiscountCharge', 100] }, 2],
        },
        deliveryCharge: {
          $round: [{ $divide: ['$deliveryCharge', 100] }, 2],
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
        deliveryTip: {
          $round: [{ $divide: ['$deliveryTip', 100] }, 2],
        },
        extraCharge: {
          $round: [{ $divide: ['$extraCharge', 100] }, 2],
        },
        walletAmount: {
          $round: [{ $divide: ['$walletAmount', 100] }, 2],
        },
        grandTotal: {
          $round: [{ $divide: ['$grandTotal', 100] }, 2],
        },
        refundedAmount: {
          $round: [{ $divide: ['$refundedAmount', 100] }, 2],
        },
        driverEarining: {
          $round: [{ $divide: ['$driverEarining', 100] }, 2],
        },
        deliveryCommission: {
          $round: [{ $divide: ['$deliveryCommission', 100] }, 2],
        },
        restaurantCommission: {
          $round: [{ $divide: ['$restaurantCommission', 100] }, 2],
        },
        status: 1,
        paymentMode: 1,
        orderTo: 1,
        userInfo: {
          id: { $ifNull: ['$users._id', ''] },
          firstName: { $ifNull: ['$users.firstName', ''] },
          lastName: { $ifNull: ['$users.lastName', ''] },
          role: { $ifNull: ['$users.role', ''] },
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
        createdAt: 1,
        instantOrder: 1,
        scheduleOrder: 1,
        scheduleDate: 1,
        orderAt: 1,
        scheduleTime: 1,
        countryCode: 1,
        receiverContact: 1,
        receiverName: 1,
      },
    },
  ];
  const result = await Orders.aggregate(query);
  return result;
};

const importCollection = async (importArray) => {
  if (importArray !== null && checkArrayNotEmpty(importArray)) {
    const statusArray = [
      'created',
      'accepted',
      'preparing',
      'ready',
      'handover',
      'ongoing',
      'delivered',
      'cancelled',
      'rejected',
      'refunded',
      'partially_refunded',
      'pending_payments',
    ];
    const driverAssignArray = ['ideal', 'assign', 'rejected', 'notfound', 'hardreject'];

    importArray.forEach(async (param) => {
      const userId =
        param && param.user && param.user !== null && param.user !== '' ? param.user : null;
      const paymentId =
        param && param.payment && param.payment !== null && param.payment !== ''
          ? param.payment
          : null;
      const restaurantId =
        param && param.restaurant && param.restaurant !== null && param.restaurant !== ''
          ? param.restaurant
          : null;
      if (
        userId !== null &&
        paymentId !== null &&
        restaurantId !== null &&
        statusArray.includes(param.status) &&
        driverAssignArray.includes(param.driverAssign)
      ) {
        const orderData = new Orders({
          orderNo:
            param && param.orderNo && param.orderNo !== null && param.orderNo !== ''
              ? param.orderNo
              : 0,
          user: userId,
          driver:
            param &&
            param.driver &&
            param.driver !== null &&
            param.driver !== '' &&
            param.driver !== '-'
              ? param.driver
              : null,
          payment:
            param && param.payment && param.payment !== null && param.payment !== ''
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
          restaurant: restaurantId,
          addons:
            param &&
            param.addons &&
            param.addons !== null &&
            param.addons !== '' &&
            param.addons !== '-'
              ? param.addons.split(',')
              : [],
          foods:
            param && param.foods && param.foods !== null && param.foods !== ''
              ? param.foods.split(',')
              : [],
          coupon:
            param &&
            param.coupon &&
            param.coupon !== null &&
            param.coupon !== '' &&
            param.coupon !== '-'
              ? param.coupon
              : null,
          couponType:
            param &&
            param.couponType &&
            param.couponType !== null &&
            param.couponType !== '' &&
            param.couponType !== '-'
              ? param.couponType
              : '',
          orderTo:
            param &&
            param.orderTo &&
            param.orderTo !== null &&
            param.orderTo !== '' &&
            param.orderTo === 'homedelivery'
              ? 'homedelivery'
              : 'selfpickup',
          cookingInstruction:
            param &&
            param.cookingInstruction &&
            param.cookingInstruction !== null &&
            param.cookingInstruction !== '' &&
            param.cookingInstruction !== '-'
              ? param.cookingInstruction
              : '',
          deliveryInstruction:
            param &&
            param.deliveryInstruction &&
            param.deliveryInstruction !== null &&
            param.deliveryInstruction !== '' &&
            param.deliveryInstruction !== '-'
              ? param.deliveryInstruction
              : null,
          deliveryAddress:
            param &&
            param.deliveryAddress &&
            param.deliveryAddress !== null &&
            param.deliveryAddress !== '' &&
            param.deliveryAddress !== '-'
              ? param.deliveryAddress
              : null,
          deliveryAddressRaw:
            param &&
            param.deliveryAddressRaw &&
            param.deliveryAddressRaw !== null &&
            param.deliveryAddressRaw !== '' &&
            param.deliveryAddressRaw !== '-'
              ? param.deliveryAddressRaw
              : '',
          receiverName:
            param && param.receiverName && param.receiverName !== null && param.receiverName !== ''
              ? param.receiverName
              : 'NA',
          countryCode:
            param && param.countryCode && param.countryCode !== null && param.countryCode !== ''
              ? param.countryCode
              : 1,
          receiverContact:
            param &&
            param.receiverContact &&
            param.receiverContact !== null &&
            param.receiverContact !== ''
              ? param.receiverContact
              : 'NA',
          cartItemRaw:
            param && param.cartItemRaw && param.cartItemRaw !== null && param.cartItemRaw !== ''
              ? param.cartItemRaw
              : '[]',
          walletUsed: param && (param.walletUsed === 'yes' || param.walletUsed === 'Yes'),
          instantOrder: param && (param.instantOrder === 'yes' || param.instantOrder === 'Yes'),
          scheduleOrder: param && (param.scheduleOrder === 'yes' || param.scheduleOrder === 'Yes'),
          scheduleDate:
            param &&
            param.scheduleDate &&
            param.scheduleDate !== null &&
            param.scheduleDate !== '' &&
            param.scheduleDate !== '-'
              ? param.scheduleDate
              : null,
          orderAt:
            param && param.orderAt && param.orderAt !== null && param.orderAt !== ''
              ? param.orderAt
              : '10:00 AM',
          scheduleTime:
            param &&
            param.scheduleTime &&
            param.scheduleTime !== null &&
            param.scheduleTime !== '' &&
            param.scheduleTime !== '-'
              ? param.scheduleTime
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
          couponDiscountCharge:
            param &&
            param.couponDiscountCharge &&
            param.couponDiscountCharge !== null &&
            param.couponDiscountCharge !== ''
              ? param.couponDiscountCharge
              : 0,
          deliveryCharge:
            param &&
            param.deliveryCharge &&
            param.deliveryCharge !== null &&
            param.deliveryCharge !== ''
              ? param.deliveryCharge
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
          deliveryTip:
            param && param.deliveryTip && param.deliveryTip !== null && param.deliveryTip !== ''
              ? param.deliveryTip
              : 0,
          extraCharge:
            param && param.extraCharge && param.extraCharge !== null && param.extraCharge !== ''
              ? param.extraCharge
              : 0,
          walletAmount:
            param && param.walletAmount && param.walletAmount !== null && param.walletAmount !== ''
              ? param.walletAmount
              : 0,
          grandTotal:
            param && param.grandTotal && param.grandTotal !== null && param.grandTotal !== ''
              ? param.grandTotal
              : 0,
          preparationTime:
            param &&
            param.preparationTime &&
            param.preparationTime !== null &&
            param.preparationTime !== ''
              ? param.preparationTime
              : 10,
          userOrderCount:
            param &&
            param.userOrderCount &&
            param.userOrderCount !== null &&
            param.userOrderCount !== ''
              ? param.userOrderCount
              : 1,
          driverOrderPin:
            param &&
            param.driverOrderPin &&
            param.driverOrderPin !== null &&
            param.driverOrderPin !== ''
              ? param.driverOrderPin
              : '0000',
          customerOrderPin:
            param &&
            param.customerOrderPin &&
            param.customerOrderPin !== null &&
            param.customerOrderPin !== ''
              ? param.customerOrderPin
              : '0000',
          orderCancellation:
            param &&
            param.orderCancellation &&
            param.orderCancellation !== null &&
            param.orderCancellation !== '' &&
            param.orderCancellation !== '-'
              ? param.orderCancellation
              : null,
          cancellationBy:
            param &&
            param.cancellationBy &&
            param.cancellationBy !== null &&
            param.cancellationBy !== '' &&
            param.cancellationBy !== '-'
              ? param.cancellationBy
              : 'none',
          driverAssign: param.driverAssign,
          orderFrom:
            param &&
            param.orderFrom &&
            param.orderFrom !== null &&
            param.orderFrom !== '' &&
            param.orderFrom === 'app'
              ? 'app'
              : 'web',
          ratingSaved: param && (param.ratingSaved === 'yes' || param.ratingSaved === 'Yes'),
          subscriptionOrder:
            param && (param.subscriptionOrder === 'yes' || param.subscriptionOrder === 'Yes'),
          purchasedTiffinSubscription:
            param &&
            param.purchasedTiffinSubscription &&
            param.purchasedTiffinSubscription !== null &&
            param.purchasedTiffinSubscription !== '' &&
            param.purchasedTiffinSubscription !== '-'
              ? param.purchasedTiffinSubscription
              : null,
          tiffinSubscription:
            param &&
            param.tiffinSubscription &&
            param.tiffinSubscription !== null &&
            param.tiffinSubscription !== '' &&
            param.tiffinSubscription !== '-'
              ? param.tiffinSubscription
              : null,
          restaurantCampaign:
            param &&
            param.restaurantCampaign &&
            param.restaurantCampaign !== null &&
            param.restaurantCampaign !== '' &&
            param.restaurantCampaign !== '-'
              ? param.restaurantCampaign
              : null,
          foodCampaign:
            param &&
            param.foodCampaign &&
            param.foodCampaign !== null &&
            param.foodCampaign !== '' &&
            param.foodCampaign !== '-'
              ? param.foodCampaign
              : null,
          refundedAmount:
            param &&
            param.refundedAmount &&
            param.refundedAmount !== null &&
            param.refundedAmount !== ''
              ? param.refundedAmount
              : 0,
          driverEarining:
            param &&
            param.driverEarining &&
            param.driverEarining !== null &&
            param.driverEarining !== ''
              ? param.driverEarining
              : 0,
          deliveryCommission:
            param &&
            param.deliveryCommission &&
            param.deliveryCommission !== null &&
            param.deliveryCommission !== ''
              ? param.deliveryCommission
              : 0,
          restaurantCommission:
            param &&
            param.restaurantCommission &&
            param.restaurantCommission !== null &&
            param.restaurantCommission !== ''
              ? param.restaurantCommission
              : 0,
          status: param.status,
        });
        await Orders.create(orderData);
      }
    });
  }
  return { success: true };
};

module.exports = {
  createOrder,
  updateOrderStatus,
  getMyOrderList,
  getVendorOrder,
  prepareOrder,
  acceptScheduleOrder,
  orderReady,
  getUserOrderCount,
  getOrderMetaNotification,
  getDriverNewOrderList,
  driverAcceptOrder,
  driverRejectOrder,
  driverActiveOrders,
  driverOrderDetails,
  driverReachedRestaurant,
  restuarantOrderHandoverDriver,
  restaurantOrderHandoverCustomer,
  driverPickupOrder,
  driverReachedCustomer,
  driverDeliverOrder,
  getOrderCounts,
  getAdminOrderList,
  getAdminScheduleOrderList,
  restaurantRejectOrder,
  getUserOrderDetail,
  cancelOrderByUser,
  getOrderDetailForComplaints,
  getMyFavouriteOrders,
  getOrderDetailForReview,
  updateOrderPayment,
  getAdminSubscriptionOrderList,
  fetchDriverPhoneNumber,
  getAdminUnAssignedOrderList,
  fetchDriverNearToOrder,
  assignDriverOrderAdmin,
  assignDriverOrderVendor,
  vendorOrderCountWeb,
  vendorOrderListWeb,
  vendorOrderDetail,
  callCustomer,
  callDeliveryman,
  getOrderDetailAdmin,
  getOrderDetailForRestaurantComplaint,
  vendorOrderBusinessInsight,
  vendorOrderCustomDateBusinessInsight,
  vendorWebOverallDashboardBusinessInsight,
  vendorWebMonthlyDashboardBusinessInsight,
  vendorWebWeeklyDashboardBusinessInsight,
  vendorWebTodayDashboardBusinessInsight,
  deliverymanInsight,
  driverOrderList,
  downloadOrderSummary,
  downloadVendorOrderSummary,
  downloadOrderInvoice,
  downloadVendorOrderInvoice,
  orderReports,
  customerOrderList,
  customerAllRefundRequest,
  customerOrderRefundList,
  customerTiffinRefundList,
  customerBookingRefundList,
  vendorOrderList,
  vendorAllRefundRequest,
  deliverymanOrderList,
  adminDashboard,
  couponOrders,
  adminOrderInvoice,
  vendorOrderInvoice,
  supportTeamOrderDetail,
  accountantDashboard,
  cityzenDashboard,
  cityzenOrderCounts,
  cityzenOrderList,
  cityzenUnAssignedOrderList,
  cityzenSubscriptionOrderList,
  vendorOrderRefundRequest,
  vendorDiningRefundRequest,
  vendorTiffinRefundRequest,
  exportQueryCollection,
  exportQueryRawCollection,
  exportUnAssignedOrderCollection,
  exportUnAssignedRawOrderCollection,
  exportSubscriptionOrderQueryCollection,
  exportSubscriptionOrderQueryRawCollection,
  exportRegularOrderReportCollection,
  importCollection,
};

