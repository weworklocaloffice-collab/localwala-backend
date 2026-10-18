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
const { toJSON, paginate } = require('./plugins');

const ordersSchema = mongoose.Schema(
  {
    orderNo: {
      type: Number,
      required: true,
    },
    user: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    driver: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    payment: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'PaymentConfig',
      required: true,
    },
    paymentMode: {
      type: String,
      required: false,
      default: 'online',
    },
    restaurant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Restaurant',
      required: true,
    },
    addons: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'Addons',
        required: false,
      },
    ],
    foods: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'Food',
        required: true,
      },
    ],
    coupon: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Coupon',
      required: false,
    },
    couponType: {
      type: String,
      required: false,
    },
    orderTo: {
      type: String,
      required: false,
      default: 'homedelivery', // homedelivery, selfpickup
    },
    cookingInstruction: {
      type: String,
      required: false,
    },
    deliveryInstruction: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DeliveryInstruction',
      required: false,
    },
    deliveryAddress: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'UserAddress',
      required: false,
    },
    deliveryAddressRaw: {
      type: String,
      required: false,
    },
    receiverName: {
      type: String,
      required: false,
    },
    countryCode: {
      type: Number,
      required: false,
    },
    receiverContact: {
      type: String,
      required: false,
    },
    cartItemRaw: {
      type: String,
      required: true,
    },
    walletUsed: {
      type: Boolean,
      default: true,
    },
    instantOrder: {
      type: Boolean,
      default: false,
    },
    scheduleOrder: {
      type: Boolean,
      default: false,
    },
    scheduleDate: {
      type: Date,
      required: false,
    },
    orderAt: {
      type: String,
      required: true,
    },
    scheduleTime: {
      type: String,
      required: false,
    },
    realTotal: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    itemTotal: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    itemDiscount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    couponDiscountCharge: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    deliveryCharge: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    foodServiceCharge: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    serviceCharge: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    packageCharge: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    packageChargeTax: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    deliveryTip: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    extraCharge: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    walletAmount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    grandTotal: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    preparationTime: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 10,
    },
    userOrderCount: {
      type: Number,
      required: false,
      default: 1,
    },
    driverOrderPin: {
      type: String,
      default: 'XXXX',
      required: false,
    },
    customerOrderPin: {
      type: String,
      default: 'XXXX',
      required: false,
    },
    orderCancellation: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'OrderCancellationReason',
      required: false,
    },
    cancellationBy: {
      type: String,
      default: 'none',
    },
    driverAssign: {
      type: String,
      default: 'ideal', // ideal, assign, rejected, notfound, hardreject
    },
    // Dispatch cascade state. `driverAssign` says what happened to the rider;
    // these say how far the engine got on its own, so the cron sweep can pick up
    // an order mid-escalation without replaying every offer.
    dispatchRound: {
      type: Number,
      default: 0,
    },
    dispatchAttempts: {
      type: Number,
      default: 0,
    },
    dispatchStartedAt: {
      type: Date,
      default: null,
    },
    dispatchLastAttemptAt: {
      type: Date,
      default: null,
    },
    dispatchExhaustedAt: {
      type: Date,
      default: null,
    },
    // Surge quote snapshot (Phase 3). Informational: which multiplier the
    // engine quoted for this order and why. The charged total is untouched —
    // checkout adoption is a separate step.
    surgeMultiplier: {
      type: Number,
      required: false,
      default: 1,
    },
    surgeReason: {
      type: String,
      required: false,
      default: null,
    },
    surgeAppliedAt: {
      type: Date,
      required: false,
      default: null,
    },
    // Customer-side delivery zone, stamped best-effort at creation (Batch
    // A-4). Null when unresolvable — "ungrouped" volume is itself the alert
    // that triggers zone review. Never blocks checkout.
    zone: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DeliveryZone',
      required: false,
      default: null,
    },
    zoneVersion: {
      type: Number,
      required: false,
      default: null,
    },
    orderFrom: {
      type: String,
      default: 'app', // app, web
    },
    ratingSaved: {
      type: Boolean,
      required: false,
      default: false,
    },
    subscriptionOrder: {
      type: Boolean,
      default: false,
    },
    purchasedTiffinSubscription: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'UserPurchasedTiffinSubscription',
      required: false,
    },
    tiffinSubscription: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'SubscriptionTiffinPackage',
      required: false,
    },
    restaurantCampaign: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RestaurantCampaign',
      required: false,
    },
    foodCampaign: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'FoodCampaign',
      required: false,
    },
    refundedAmount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    driverEarining: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    deliveryCommission: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    restaurantCommission: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    status: {
      type: String,
      default: 'pending_payments', // created, accepted, preparing, ready, handover, ongoing, delivered, cancelled, rejected, refunded, partially_refunded, pending_payments
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
ordersSchema.plugin(toJSON);
ordersSchema.plugin(paginate);

/**
 * @typedef Orders
 */
const Orders = mongoose.model('Orders', ordersSchema);

module.exports = Orders;

