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
const { toPaise, creditMoneyField } = require('../../../utils/money');

const settleTransaction = async (Transactions, transaction, confirmed) => {
  if (!transaction) return;
  if (typeof transaction.save === 'function') {
    transaction.confirmed = confirmed;
    transaction.status = confirmed;
    await transaction.save();
    return;
  }
  if (transaction._id && typeof Transactions.updateOne === 'function') {
    await Transactions.updateOne(
      { _id: transaction._id },
      { $set: { confirmed, status: confirmed } }
    );
  }
};

const findReplay = async (Transactions, reference) => {
  if (!reference || typeof Transactions.findOne !== 'function') return null;
  return Transactions.findOne({ reference });
};

/**
 * Credit a user's wallet.
 *
 * @param {object} opts
 * @param {string} opts.userId wallet holder
 * @param {number} opts.amountRupees amount to credit, in rupees
 * @param {string} [opts.bookingCode] reference written on the transaction
 * @param {string} [opts.reason] human reason
 * @param {string} [opts.idempotencyKey] retry-safe ledger reference
 * @param {object} [deps] injectable models/services (tests)
 */
async function creditWallet(
  { userId, amountRupees, bookingCode, reason, idempotencyKey } = {},
  { WalletModel, TransactionModel } = {}
) {
  const Wallet = WalletModel || require('../../../models/wallet.model');
  const Transactions = TransactionModel || require('../../../models/transactions.model');

  const amount = Number(amountRupees || 0);
  if (!(amount > 0)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'amountRupees must be greater than zero');
  }
  const reference = idempotencyKey ? String(idempotencyKey).slice(0, 200) : undefined;

  const wallet = await Wallet.findOne({ holderId: userId });
  if (!wallet) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Wallet not found for this customer');
  }

  const replay = await findReplay(Transactions, reference);
  if (replay) {
    if (replay.confirmed === true) {
      const fresh = await Wallet.findById(wallet._id);
      return {
        transactionId: replay.uuid || String(replay._id),
        balance: Number((fresh ? fresh.balance : 0) || 0),
        amount: Number(replay.amount || amount),
        deduped: true,
      };
    }
    throw new ApiError(httpStatus.CONFLICT, 'WALLET_CREDIT_IN_PROGRESS');
  }

  let transaction = null;
  if (reference) {
    try {
      transaction = await Transactions.create({
        payableId: userId,
        walletId: wallet._id,
        type: 'deposite',
        amount,
        reference,
        confirmed: false,
        meta: [{ reason: reason || 'Local Services refund', bookingCode: bookingCode || '' }],
        status: false,
      });
    } catch (error) {
      if (error && error.code === 11000) {
        const duplicate = await findReplay(Transactions, reference);
        if (duplicate && duplicate.confirmed === true) {
          const fresh = await Wallet.findById(wallet._id);
          return {
            transactionId: duplicate.uuid || String(duplicate._id),
            balance: Number((fresh ? fresh.balance : 0) || 0),
            amount: Number(duplicate.amount || amount),
            deduped: true,
          };
        }
        throw new ApiError(httpStatus.CONFLICT, 'WALLET_CREDIT_IN_PROGRESS');
      }
      throw error;
    }
  }

  const { credited } = await creditMoneyField(Wallet, wallet._id, 'balance', toPaise(amount));
  if (!credited) {
    await settleTransaction(Transactions, transaction, false);
    throw new ApiError(httpStatus.NOT_FOUND, 'Wallet not found for this customer');
  }

  if (transaction) {
    await settleTransaction(Transactions, transaction, true);
  } else {
    transaction = await Transactions.create({
      payableId: userId,
      walletId: wallet._id,
      type: 'deposite',
      amount,
      confirmed: true,
      meta: [{ reason: reason || 'Local Services refund', bookingCode: bookingCode || '' }],
      status: true,
    });
  }

  const fresh = await Wallet.findById(wallet._id);
  return {
    transactionId: transaction.uuid || String(transaction._id),
    balance: Number((fresh ? fresh.balance : 0) || 0),
    amount,
  };
}

module.exports = { creditWallet };
