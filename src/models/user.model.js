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
const bcrypt = require('bcryptjs');
const { toJSON, paginate } = require('./plugins');
const { roles } = require('../config/roles');

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
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
    password: {
      type: String,
      required: true,
      trim: true,
      minlength: 8,
      validate(value) {
        if (!value.match(/\d/) || !value.match(/[a-zA-Z]/)) {
          throw new Error('Password must contain at least one letter and one number');
        }
      },
      private: true, // used by the toJSON plugin
    },
    role: {
      type: String,
      enum: roles,
      default: 'user',
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    image: {
      type: String,
      default: 'NA',
    },
    countryCode: {
      type: Number,
      required: true,
    },
    mobile: {
      type: String,
      required: true,
    },
    isMobileVerified: {
      type: Boolean,
      default: false,
    },
    gender: {
      type: String,
      default: 'male',
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
    city: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'City',
      required: false,
    },
    locale: {
      type: String,
      required: false,
      default: 'en',
    },
    // Spoken languages for ticket routing (['en','hi']). Empty = any ticket;
    // set from the Team page. A Hindi ticket never lands on an English-only
    // agent once tags exist.
    languages: {
      type: [String],
      default: [],
    },
    status: {
      type: Boolean,
      default: true,
    },
    // Phase-2 social matching: SHA-256 of digitsOnly(countryCode + mobile).
    // Sparse+unique: only present for users with a verified mobile number.
    // Contact matching reads this with a single indexed $in query instead of
    // a full user-table scan — see docs/social-reels-hybrid-monolith.md §5.
    phoneHash: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.plugin(toJSON);
userSchema.plugin(paginate);

userSchema.index({ location: '2dsphere' });
userSchema.index({ phoneHash: 1 }, { unique: true, sparse: true });

userSchema.statics.isEmailTaken = async function (email, excludeUserId) {
  const user = await this.findOne({ email, _id: { $ne: excludeUserId } });
  return !!user;
};

userSchema.statics.isPhoneTaken = async function (countryCode, mobile, excludeUserId) {
  const user = await this.findOne({ countryCode, mobile, _id: { $ne: excludeUserId } });
  return !!user;
};

userSchema.statics.isAdminSetupDone = async function () {
  const user = await this.findOne({ role: 'admin' });
  return !!user;
};

userSchema.methods.isPasswordMatch = async function (password) {
  if (!this.password) {
    return false;
  }

  return bcrypt.compare(password, this.password);
};

userSchema.pre('save', async function () {
  if (this.isModified('password') && this.password) {
    this.password = await bcrypt.hash(this.password, 8);
  }
  // Keep phoneHash in sync whenever the mobile number changes. We hash
  // digitsOnly(countryCode + mobile) so the value matches the Flutter client
  // (see modules/social/contacts.service.js normalizePhone + sha256Hex).
  const crypto = require('crypto');
  const digits = (this.countryCode || '').toString() + (this.mobile || '').toString();
  const normalized = digits.replace(/\D/g, '').replace(/^0+/, '');
  this.phoneHash = normalized
    ? crypto.createHash('sha256').update(normalized).digest('hex')
    : null;
});

const User = mongoose.model('User', userSchema);

module.exports = User;

