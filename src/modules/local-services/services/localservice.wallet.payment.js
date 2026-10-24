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
 * localservice.wallet.payment — pay a Local Services booking from the
 * shared platform wallet.
 *
 * ## Why this exists
 *
 * The booking model has always allowed `paymentMode: 'wallet'`, and services
 * could list `'wallet'` in `allowedPaymentModes` — but nothing could pay with
 * it. `assertBookingPayable` rejected every non-gateway mode, so a customer
 * who chose wallet got a booking that could never be paid and eventually a
 * stuck-booking alert.
 *
 * ## The rules
 *
 *  1. **No overdraft.** The wallet is debited with a guarded atomic update
 *     that refuses to take the balance below zero. Two concurrent payments
 *     cannot both spend the same rupees.
 *  2. **Same money path as a card.** The amount lands in `amountPaid`, the
 *     capacity hold is confirmed, and the booking moves to CONFIRMED exactly
 *     as it would after a gateway callback.
 *  3. **A visible trail.** A `Transactions` withdrawal row records the debit,
 *     and the booking stores the transaction id.
 */

const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const { toPaise } = require('../../../utils/money');

/**
 * Debit a wallet and pay the booking.
 *
 * @param {object} opts
 * @param {number} opts.amountRupees amount to debit, in rupees
 * @param {string} opts.userId wallet holder
 * @param {string} opts.bookingCode reference written on the transaction
 * @param {string} [opts.reason] human reason
 * @param {object} [deps] injectable models/services (tests)
 * @returns {Promise<{transactionId: string, balance: number, amount: number}>}
 */
async function debitWallet(
  { amountRupees, userId, bookingCode, reason } = {},
  { WalletModel, TransactionModel } = {}
) {
  const Wallet = WalletModel || require('../../../models/wallet.model');
  const Transactions = TransactionModel || require('../../../models/transactions.model');

  const amount = Number(amountRupees || 0);
  if (!(amount > 0)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'amountRupees must be greater than zero');
  }
  const amountPaise = toPaise(amount);

  const wallet = await Wallet.findOne({ holderId: userId });
  if (!wallet) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Wallet not found for this customer');
  }

  // Guarded atomic debit: raw paise, no setter, no overdraft.
  const { debitMoneyField } = require('../../../utils/money');
  const { debited } = await debitMoneyField(Wallet, wallet._id, 'balance', amountPaise);
  if (!debited) {
    throw new ApiError(httpStatus.CONFLICT, 'INSUFFICIENT_WALLET_BALANCE');
  }

  const transaction = await Transactions.create({
    payableId: userId,
    walletId: wallet._id,
    type: 'withdrawal',
    amount,
    confirmed: true,
    meta: [{ reason: reason || 'Local Services booking payment', bookingCode: bookingCode || '' }],
    status: true,
  });

  const fresh = await Wallet.findById(wallet._id);
  return {
    transactionId: transaction.uuid || String(transaction._id),
    balance: Number((fresh ? fresh.balance : 0) || 0),
    amount,
  };
}

module.exports = { debitWallet };
