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
const { toJSON } = require('./plugins');

const paymentInitiationSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
    payment: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'PaymentConfig',
      required: true,
    },
    orders: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Orders',
      required: false,
    },
    tiffinSubscription: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'UserPurchasedTiffinSubscription',
      required: false,
    },
    booking: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DiningBooking',
      required: false,
    },
    restaurantRegisterRequest: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RestaurantJoiningRequest',
      required: false,
    },
    // Real Estate subjects (no second payment stack — the gateway
    // controller routes `listing_package` / `property_hold` /
    // `property_hold_refund` through realestate.payment.service).
    listingOrder: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateListingOrder',
      required: false,
    },
    hold: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstatePropertyHold',
      required: false,
    },
    holdRefund: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'RealEstateHoldRefund',
      required: false,
    },
    subscribeId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Subscriber',
      required: false,
    },
    // Local Stores subjects (§2.1 — "Extend, add storeOrders and storeSubscription
    // subjects"). The gateway stack stays vertical-agnostic: it reads `paymentFrom`
    // and hands the side effects to the stores module's payment bridge.
    storeOrder: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOrder',
      required: false,
    },
    storeSubscriptionPayment: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreSubscriptionPayment',
      required: false,
    },
    // Local Services subject (§6 — reuse gateway, no second payment stack).
    // Booking engine writes bookingId string here until full Booking model lands;
    // paymentFrom 'localServiceBooking' routes side-effects to revenue.booking.service.
    localServiceBookingId: {
      type: String,
      required: false,
      trim: true,
    },
localServiceBooking: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'LocalServiceBooking',
      required: false,
    },
    // Jhatka subjects (§2.1 — fresh meat / butcher).
    //
    // `jhatkaOrder` is the thing a one-off customer order pays for. `jhatkaOccurrence`
    // is the thing a SUBSCRIPTION pays for — deliberately the occurrence, not the
    // subscription, because one subscription has many occurrences and one payment does
    // not cover all of them (§9.2's {subscription, occurrenceDate} idempotency anchor
    // is the occurrence's own unique index).
    jhatkaOrder: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOrder',
      required: false,
    },
    jhatkaOccurrence: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaRecurringOrder',
      required: false,
    },
    // Denormalised copy of the subscription for reporting and for the callback, which
    // needs the customer before it can notify them.
    jhatkaSubscription: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaSubscription',
      required: false,
    },
    amount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    paymentFrom: {
      type: String,
      required: true,
      // order // wallet // tiffinsubscription // booking // restaurant_register //
      // renew_subscription // storeOrders // storeSubscription //
      // localServiceBooking // jhatka_order // jhatka_subscription
      default: 'order',
    },
    paymentRef: {
      type: String,
      required: false,
    },
    payResponse: {
      type: Object,
      required: false,
    },
    from: {
      type: String,
      default: 'app',
    },
    redirect: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      default: 'initiated', // initiated, paid, cancelled
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
paymentInitiationSchema.plugin(toJSON);

/**
 * @typedef PaymentInitiation
 */
const PaymentInitiation = mongoose.model('PaymentInitiation', paymentInitiationSchema);

module.exports = PaymentInitiation;

