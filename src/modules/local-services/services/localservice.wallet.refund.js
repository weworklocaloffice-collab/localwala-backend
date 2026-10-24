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

/**
 * localservice.wallet.refund — credit the shared wallet back.
 *
 * A booking paid from the platform wallet has to be paid back from the
 * platform wallet. This uses the SHARED wallet/transaction stack (the same
 * `Wallet` model and `Transactions` rows the food stack writes), so the
 * customer's wallet history shows the refund like any other credit.
 *
 * Money convention: rupees at the edges, paise inside. The wallet's
 * `balance` field has a getter/setter pair, so it must be read-modify-saved
 * in rupees — never `$inc`'d.
 */

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

/**
 * Credit a user's wallet.
 *
 * @param {object} opts
 * @param {string} opts.userId wallet holder
 * @param {number} opts.amountRupees amount to credit, in rupees
 * @param {string} [opts.bookingCode] reference written on the transaction
 * @param {string} [opts.reason] human reason
 * @param {object} [deps] injectable models/services (tests)
 */
async function creditWallet(
  { userId, amountRupees, bookingCode, reason } = {},
  { WalletModel, TransactionModel } = {}
) {
  const Wallet = WalletModel || require('../../../models/wallet.model');
  const Transactions = TransactionModel || require('../../../models/transactions.model');

  const amount = Number(amountRupees || 0);
  if (!(amount > 0)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'amountRupees must be greater than zero');
  }

  const wallet = await Wallet.findOne({ holderId: userId });
  if (!wallet) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Wallet not found for this customer');
  }

  const balance = Number(wallet.balance || 0);
  wallet.balance = Number((balance + amount).toFixed(2));
  await wallet.save();

  const transaction = await Transactions.create({
    payableId: userId,
    walletId: wallet._id,
    type: 'deposite',
    amount,
    confirmed: true,
    meta: [{ reason: reason || 'Local Services refund', bookingCode: bookingCode || '' }],
    status: true,
  });

  return {
    transactionId: transaction.uuid || String(transaction._id),
    balance: Number(wallet.balance || 0),
    amount,
  };
}

module.exports = { creditWallet };
