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
const {
  ReferralCode,
  RedeemReferral,
  UserSettings,
  Wallet,
  Transactions,
  AdminExpense,
} = require('../models');
const ApiError = require('../utils/ApiError');

const createReferralCode = async (referralBody) => {
  if (await ReferralCode.isUserExist(referralBody.holderId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Already exist');
  }
  return ReferralCode.create(referralBody);
};

const redeemReferralCode = async (referralCode, redeemerId) => {
  const data = await ReferralCode.findOne({ code: referralCode });
  if (data) {
    const haveRedeemed = await RedeemReferral.findOne({
      owner: data.holderId,
      code: data.id,
      redeemer: redeemerId,
    });
    if (!haveRedeemed) {
      const redeemCount = await RedeemReferral.countDocuments({
        owner: data.holderId,
        code: data.id,
      });
      const scheme = await UserSettings.findOne(
        {},
        {
          canEarnBuyFromWallet: 1,
          earnPerReferral: 1,
          referralLimit: 1,
          whoEarnReferral: 1,
          _id: 0,
        }
      );
      if (scheme && scheme.canEarnBuyFromWallet && redeemCount <= scheme.referralLimit) {
        const inviterWallet = await Wallet.findOne({ holderId: data.holderId });
        const redeemerWallet = await Wallet.findOne({ holderId: redeemerId });
        if (scheme && scheme.whoEarnReferral === 'both') {
          if (inviterWallet && inviterWallet.id) {
            const inviteeBalance = Math.floor(inviterWallet.balance);
            const schemeAmount = Math.floor(scheme.earnPerReferral);
            const newWalletBalance = inviteeBalance + schemeAmount;
            const updateBody = {
              balance: newWalletBalance,
            };
            Object.assign(inviterWallet, updateBody);
            await inviterWallet.save();
            const transactionsBody = {
              payableId: data.holderId,
              walletId: inviterWallet.id,
              type: 'deposite',
              amount: schemeAmount,
              meta: [{ reason: 'referral deposite' }],
            };
            await Transactions.create(transactionsBody);

            const expenseData = new AdminExpense({
              expenseType: `referral`,
              coupon: null,
              diningCoupon: null,
              diningBooking: null,
              order: null,
              user: data.holderId,
              amount: schemeAmount,
            });
            await AdminExpense.create(expenseData);
          }

          if (redeemerWallet && redeemerWallet.id) {
            const redeemerBalance = Math.floor(redeemerWallet.balance);
            const schemeAmount = Math.floor(scheme.earnPerReferral);
            const newWalletBalance = redeemerBalance + schemeAmount;
            const updateBody = {
              balance: newWalletBalance,
            };
            Object.assign(redeemerWallet, updateBody);
            await redeemerWallet.save();
            const transactionsBody = {
              payableId: redeemerId,
              walletId: redeemerWallet.id,
              type: 'deposite',
              amount: schemeAmount,
              meta: [{ reason: 'referral deposite' }],
            };
            await Transactions.create(transactionsBody);

            const expenseData = new AdminExpense({
              expenseType: `referral`,
              coupon: null,
              diningCoupon: null,
              diningBooking: null,
              order: null,
              user: redeemerId,
              amount: schemeAmount,
            });
            await AdminExpense.create(expenseData);
          }
        } else if (scheme && scheme.whoEarnReferral === 'invitee') {
          if (inviterWallet && inviterWallet.id) {
            const inviteeBalance = Math.floor(inviterWallet.balance);
            const schemeAmount = Math.floor(scheme.earnPerReferral);
            const newWalletBalance = inviteeBalance + schemeAmount;
            const updateBody = {
              balance: newWalletBalance,
            };
            Object.assign(inviterWallet, updateBody);
            await inviterWallet.save();
            const transactionsBody = {
              payableId: data.holderId,
              walletId: inviterWallet.id,
              type: 'deposite',
              amount: schemeAmount,
              meta: [{ reason: 'referral deposite' }],
            };
            await Transactions.create(transactionsBody);

            const expenseData = new AdminExpense({
              expenseType: `referral`,
              coupon: null,
              diningCoupon: null,
              diningBooking: null,
              order: null,
              user: data.holderId,
              amount: schemeAmount,
            });
            await AdminExpense.create(expenseData);
          }
        } else if (scheme && scheme.whoEarnReferral === 'redeemer') {
          if (redeemerWallet && redeemerWallet.id) {
            const redeemerBalance = Math.floor(redeemerWallet.balance);
            const schemeAmount = Math.floor(scheme.earnPerReferral);
            const newWalletBalance = redeemerBalance + schemeAmount;
            const updateBody = {
              balance: newWalletBalance,
            };
            Object.assign(redeemerWallet, updateBody);
            await redeemerWallet.save();
            const transactionsBody = {
              payableId: redeemerId,
              walletId: redeemerWallet.id,
              type: 'deposite',
              amount: schemeAmount,
              meta: [{ reason: 'referral deposite' }],
            };
            await Transactions.create(transactionsBody);

            const expenseData = new AdminExpense({
              expenseType: `referral`,
              coupon: null,
              diningCoupon: null,
              diningBooking: null,
              order: null,
              user: redeemerId,
              amount: schemeAmount,
            });
            await AdminExpense.create(expenseData);
          }
        }
        return { status: true, amount: scheme.earnPerReferral, received: scheme.whoEarnReferral };
      }
      return { status: false, amount: 0, received: 'none' };
    }
    return { status: false, amount: 0, received: 'none' };
  }
  return { status: false, amount: 0, received: 'none' };
};

module.exports = {
  createReferralCode,
  redeemReferralCode,
};

