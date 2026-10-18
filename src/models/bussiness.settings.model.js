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
const validator = require('validator');
const { toJSON } = require('./plugins');

const businessSchema = mongoose.Schema(
  {
    companyName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      validate(value) {
        if (!validator.isEmail(value)) {
          throw new Error('Invalid email');
        }
      },
    },
    mobile: {
      type: String,
      required: true,
    },
    country: {
      type: String,
      required: true,
    },
    address: {
      type: String,
      required: true,
    },
    location: {
      type: {
        type: String, // Don't do `{ location: { type: String } }`
        enum: ['Point'], // 'location.type' must be 'Point'
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        default: [0, 0],
      },
    },
    timezone: {
      type: Object,
      required: true,
    },
    timeFormat: {
      type: String,
      required: true,
      default: '12', // 12 hours or 24 hours
    },
    defaultCountryCode: {
      type: Object,
      required: true,
    },
    currency: {
      type: Object,
      required: true,
    },
    currencySide: {
      type: String,
      required: true,
      default: 'left', // Currency Symbol Side left = ($100) || right = (100$)
    },
    decimalPoint: {
      type: Number,
      required: true,
      default: 2, // 10.22
    },
    cookiesText: {
      type: String,
      required: true,
    },
    commission: {
      type: Number,
      required: true,
      default: 10, // 10
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
    },
    commissionDelivery: {
      type: Number,
      required: true,
      default: 10, // 10
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
    },
    haveFreeDeliveryInTotal: {
      type: Boolean,
      default: false,
    },
    freeDelivery: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
    },
    haveFreeDeliveryInDistance: {
      type: Boolean,
      default: false,
    },
    freeDeliveryInDistance: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
    },
    deliveryChargeMethod: {
      type: String,
      default: 'distance', // distance // fixed
      required: true,
    },
    deliveryChargeAmount: {
      type: Number,
      required: true,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
    },
    vegNonVegOption: {
      type: Boolean,
      default: false,
    },
    commissionBasedSystem: {
      type: Boolean,
      default: false,
    },
    subscriptionBasedSystem: {
      type: Boolean,
      default: false,
    },
    includeTaxOnFood: {
      type: Boolean,
      default: false,
    },
    foodTaxName: {
      type: String,
      required: false,
    },
    foodTaxAmount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    foodTaxType: {
      type: String,
      default: 'per', // per // fixed
      required: false,
    },
    receiveNotificationAdmin: {
      type: Boolean,
      default: false,
    },
    additionalServiceCharge: {
      type: Boolean,
      default: false,
    },
    additionalServiceName: {
      type: String,
      required: false,
    },
    additionalServiceAmount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
    },
    partialPayment: {
      type: Boolean,
      required: false,
    },
    partialAmountPayment: {
      type: String,
      required: false, // cod or digital payment
      default: 'cod',
    },
    guestCheckout: {
      type: Boolean,
      required: false,
    },
    logo: {
      type: String,
      required: true,
    },
    favicon: {
      type: String,
      required: true,
    },
    maintenance: {
      type: Boolean,
      default: false,
    },
    findMode: {
      type: String,
      default: 'km', // find the near restaurants based on km = kilometers or mile = miles
    },
    deliveryArea: {
      type: Number,
      required: true, // find the near restaurants based on delivery area radius
    },
    socialLinks: {
      type: Object,
      required: false,
    },
    refundRequest: {
      type: Boolean,
      required: false,
      default: false,
    },
    websiteUrl: {
      type: String,
      required: false,
    },
    otpType: {
      type: String,
      default: 'num', // num, numstr, str
    },
    canResendOtp: {
      type: Boolean,
      default: false,
    },
    otpLength: {
      type: Number,
      default: 6,
    },
    foodLicenseImage: {
      type: String,
      default: '',
      required: false,
    },
    foodLicenseName: {
      type: String,
      default: '',
      required: false,
    },
    foodLicenseWebsite: {
      type: String,
      default: '',
      required: false,
    },
    foodLicense: {
      type: String,
      default: '',
      required: false,
    },
    complianceForm: {
      type: Array,
      default: [],
    },
    // Real Estate vertical block (plan §9.3, §15.7). Optional Mixed — never
    // required, never defaulted — so the 100% of existing settings docs
    // without it validate exactly as before. The authoritative store is
    // `RealEstateSetting` (own model + admin screen); this mirror exists so
    // platform-level readers (cron, search fallbacks) have one settings doc
    // to consult. Keys mirror `realestate.setting.model.js`.
    realestate: {
      type: Object,
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
businessSchema.plugin(toJSON);

/**
 * @typedef BusinessSettings
 */
const BusinessSettings = mongoose.model('BusinessSettings', businessSchema);

module.exports = BusinessSettings;

