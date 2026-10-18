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

const Joi = require('joi');
const { objectId } = require('./custom.validation');

const createWallet = {
  body: Joi.object().keys({
    holderId: Joi.string().required(),
    balance: Joi.allow(),
  }),
};

const idValidation = {
  params: Joi.object().keys({
    walletId: Joi.string().custom(objectId),
  }),
};

const vendorWalletWithdrawalDetailValidation = {
  params: Joi.object().keys({
    vendor: Joi.string().custom(objectId).required(),
  }),
};

const deliverymanWalletWithdrawalDetailValidation = {
  params: Joi.object().keys({
    deliveryman: Joi.string().custom(objectId).required(),
  }),
};

const adminAddWalletFundValidation = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    userId: Joi.string().custom(objectId).required(),
    amount: Joi.number().required(),
    referral: Joi.string().required(),
  }),
};

const exportTransactionValidation = {
  query: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    filter: Joi.boolean(),
    status: Joi.string().allow(null, '').valid('deposite', 'withdrawal'),
    role: Joi.string()
      .allow(null, '')
      .valid('user', 'driver', 'vendor', 'vendorDriver', 'vendorOutlet'),
    filterDates: Joi.string().allow(null, ''),
    search: Joi.string().allow(null, ''),
  }),
};

module.exports = {
  createWallet,
  idValidation,
  vendorWalletWithdrawalDetailValidation,
  deliverymanWalletWithdrawalDetailValidation,
  adminAddWalletFundValidation,
  exportTransactionValidation,
};

