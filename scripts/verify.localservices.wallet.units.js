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
 * verify.localservices.wallet.units.js — wallet payment units (no DB).
 * Run: node scripts/verify.localservices.wallet.units.js
 */

const paymentService = require('../src/modules/local-services/services/localservice.payment.service');
const bridge = require('../src/modules/local-services/services/localservice.payment.bridge.service');
const walletPayment = require('../src/modules/local-services/services/localservice.wallet.payment');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` – ${detail}` : ''}`);
  }
};

// ---- 1. Wallet is a collectible mode ---------------------------------------
const walletBooking = {
  _id: 'b1',
  customer: 'c1',
  paymentMode: 'wallet',
  status: 'ACCEPTED',
  bookingMode: 'SLOT',
  serviceValue: 1000,
  depositAmount: 200,
  balanceAmount: 800,
  amountPaid: 0,
  paymentStatus: 'pending',
};

ok(
  'wallet bookings are payable',
  paymentService.assertBookingPayable(walletBooking, 'c1') === 200
);
ok(
  'cod bookings are not collectible online',
  (() => {
    try {
      paymentService.assertBookingPayable({ ...walletBooking, paymentMode: 'cod' }, 'c1');
      return false;
    } catch (e) {
      return e.statusCode === 409;
    }
  })()
);
ok(
  'direct bookings are not collectible online',
  (() => {
    try {
      paymentService.assertBookingPayable({ ...walletBooking, paymentMode: 'direct' }, 'c1');
      return false;
    } catch (e) {
      return e.statusCode === 409;
    }
  })()
);
ok(
  'a foreign customer cannot pay a wallet booking',
  (() => {
    try {
      paymentService.assertBookingPayable(walletBooking, 'c2');
      return false;
    } catch (e) {
      return e.statusCode === 403;
    }
  })()
);

// ---- 2. A wallet payment debits and settles in one call --------------------
const runWalletPayment = async () => {
  const booking = {
    _id: 'b1',
    bookingCode: 'LS260101AAAA',
    customer: 'c1',
    provider: 'pr1',
    paymentMode: 'wallet',
    status: 'ACCEPTED',
    serviceValue: 1000,
    depositAmount: 200,
    balanceAmount: 800,
    amountPaid: 0,
    paymentStatus: 'pending',
    save: async function save() {
      this.saved = true;
    },
  };
  let debited = null;
  const result = await paymentService.initiateBookingPayment(
    { bookingId: 'b1', customerId: 'c1' },
    {
      BookingModel: { findById: async () => booking },
      ReservationModel: { updateMany: async () => {} },
      bookingService: {
        transitionBooking: async (id, to) => {
          booking.status = to;
          return { booking };
        },
      },
      debitWallet: async (args) => {
        debited = args;
        return { transactionId: 'txn_1', balance: 800, amount: args.amountRupees };
      },
    },
  );
  ok('the wallet was debited', debited !== null);
  ok('the debit amount is the deposit first', debited && debited.amountRupees === 200);
  ok('the debit names the booking', debited && debited.bookingCode === 'LS260101AAAA');
  ok('no gateway intent is created for wallet', result.initiation === null);
  ok('the wallet payment settles the booking', booking.status === 'CONFIRMED');
};

// ---- 3. The booking is marked paid from the wallet debit -------------------
const runWalletSettlement = async () => {
  const booking = {
    _id: 'b2',
    bookingCode: 'LS260101BBBB',
    customer: 'c1',
    paymentMode: 'wallet',
    status: 'PAYMENT_PENDING',
    serviceValue: 1000,
    amountPaid: 0,
    paymentStatus: 'pending',
    walletPayments: [],
    save: async function save() {
      this.saved = true;
    },
  };
  let confirmed = null;
  let holds = 0;
  const result = await bridge.markBookingPaidFromWallet(
    { bookingId: 'b2', amount: 200, transactionId: 'txn_2' },
    {
      BookingModel: { findById: async () => booking },
      ReservationModel: {
        updateMany: async () => {
          holds += 1;
        },
      },
      bookingService: {
        transitionBooking: async (id, to) => {
          confirmed = to;
          return { booking: { ...booking, status: to } };
        },
      },
    },
  );
  ok('the wallet payment is recorded on the booking', booking.walletPayments.length === 1);
  ok('the amount paid grows', Number(booking.amountPaid) === 200);
  ok('a partial wallet payment is partially paid', booking.paymentStatus === 'partially_paid');
  ok('the capacity hold is confirmed', holds === 1);
  ok('a pending booking is confirmed', confirmed === 'CONFIRMED');
  ok('the settlement reports the confirmation', result.confirmed === true);
};

// ---- 4. A replayed wallet debit does not double-charge --------------------
const runWalletReplay = async () => {
  const booking = {
    _id: 'b3',
    bookingCode: 'LS260101CCCC',
    customer: 'c1',
    paymentMode: 'wallet',
    status: 'CONFIRMED',
    serviceValue: 1000,
    amountPaid: 1000,
    paymentStatus: 'paid',
    walletPayments: ['txn_3'],
    save: async function save() {
      this.saved = true;
    },
  };
  const result = await bridge.markBookingPaidFromWallet(
    { bookingId: 'b3', amount: 1000, transactionId: 'txn_3' },
    {
      BookingModel: { findById: async () => booking },
      ReservationModel: { updateMany: async () => {} },
      bookingService: { transitionBooking: async () => ({ booking }) },
    },
  );
  ok('a replayed wallet payment is deduped', result.deduped === true);
  ok('a replayed wallet payment does not add money', Number(booking.amountPaid) === 1000);
};

// ---- 5. The wallet debit refuses to overdraw ------------------------------
const runNoOverdraft = async () => {
  const wallet = {
    _id: 'w1',
    balance: 100,
    save: async function save() {
      this.saved = true;
    },
  };
  const collection = {
    updateOne: async (filter) => {
      // The guard is `{ balance: { $gte: amountPaise } }`: emulate a wallet
      // that does not have enough by reporting no match.
      const matches = filter.balance.$gte <= Number(wallet.balance) * 100;
      return { matchedCount: matches ? 1 : 0 };
    },
  };
  const WalletModel = {
    findOne: async () => wallet,
    findById: async () => wallet,
    collection,
  };
  let threw = false;
  try {
    await walletPayment.debitWallet(
      { amountRupees: 500, userId: 'c1', bookingCode: 'LS1' },
      { WalletModel, TransactionModel: { create: async () => ({ uuid: 't1' }) } },
    );
  } catch (e) {
    threw = e.statusCode === 409;
  }
  ok('the wallet refuses to overdraw', threw);
};

(async () => {
  await runWalletPayment();
  await runWalletSettlement();
  await runWalletReplay();
  await runNoOverdraft();
  console.log(failures === 0 ? '\nAll local-services wallet units passed.' : `\n${failures} FAILURES`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
