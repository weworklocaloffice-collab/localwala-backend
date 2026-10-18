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
const otpGenerator = require('otp-generator');
const { toJSON, paginate } = require('./plugins');

const referralCodeSchema = mongoose.Schema(
  {
    holderId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    code: {
      type: String,
    },
    status: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json & convert to unique slug
referralCodeSchema.plugin(toJSON);
referralCodeSchema.plugin(paginate);

referralCodeSchema.statics.isUserExist = async function (holderId, excludeUserId) {
  const referralCode = await this.findOne({ holderId, _id: { $ne: excludeUserId } });
  return !!referralCode;
};

referralCodeSchema.pre('save', async function () {
  const referralCode = this;
  referralCode.code = otpGenerator.generate(10, {
    digits: true,
    upperCaseAlphabets: true,
    lowerCaseAlphabets: false,
    specialChars: false,
  });
});

/**
 * @typedef ReferralCode
 */
const ReferralCode = mongoose.model('ReferralCode', referralCodeSchema);

module.exports = ReferralCode;

