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
 * verify.localservices.settlementpayout.units.js — settlement payout units.
 * Run: node scripts/verify.localservices.settlementpayout.units.js
 */

const settlementService = require('../src/modules/local-services/services/localservice.settlement.service');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` – ${detail}` : ''}`);
  }
};

// ---- 1. Disputed bookings are held out of a batch --------------------------
const makeEntry = (bookingId, over = {}) => ({
  _id: `e-${bookingId}`,
  bookingId,
  entryType: 'charge',
  status: 'applied',
  settlement: null,
  bookingFee: 6000,
  commissionAmount: 2000,
  platformRevenue: 8000,
  providerPayable: 38000,
  serviceValue: 40000,
  ...over,
});

const runHeld = async () => {
  const entries = [makeEntry('b1'), makeEntry('b2')];
  const bookings = {
    find: () => ({
      select: () => ({
        lean: async () => [
          { _id: 'b1', status: 'COMPLETED' },
          { _id: 'b2', status: 'DISPUTED' },
        ],
      }),
    }),
  };
  const held = await settlementService.loadHeldBookingIds(entries, { BookingModel: bookings });
  ok('a disputed booking is held', held.has('b2'));
  ok('a completed booking is not held', !held.has('b1'));
};

const runGenerateHolds = async () => {
  const entries = [makeEntry('b1'), makeEntry('b2')];
  let created = null;
  const Entry = {
    find: () => ({ lean: async () => entries }),
    updateMany: async () => ({}),
  };
  const Provider = {
    findById: async () => ({ _id: 'p1', business: 'biz1' }),
  };
  const Settlement = {
    findOne: async () => ({ settlementNo: 42 }),
    create: async (payload) => {
      created = { ...payload, _id: 's1' };
      return created;
    },
  };
  const bookings = {
    find: () => ({
      select: () => ({
        lean: async () => [
          { _id: 'b1', status: 'COMPLETED' },
          { _id: 'b2', status: 'DISPUTED' },
        ],
      }),
    }),
  };
  const result = await settlementService.generateSettlement(
    { providerId: 'p1', from: '2026-01-01', to: '2026-12-31' },
    { EntryModel: Entry, ProviderModel: Provider, SettlementModel: Settlement, BookingModel: bookings }
  );
  ok('the settlement is created', result.settlement !== null);
  ok('the held amount is reported', result.held && result.held.count === 1);
  ok('the batch counts only payable bookings', result.summary.count === 1);
  ok('the settlement number is the global max plus one', created && created.settlementNo === 43);
  ok('the counterparty is the linked business', created && created.counterparty === 'biz1');
};

// ---- 2. A duplicate settlement number is retried --------------------------
const runNumberRetry = async () => {
  let attempts = 0;
  const Settlement = {
    findOne: async () => ({ settlementNo: 42 + attempts }),
    create: async (payload) => {
      attempts += 1;
      if (attempts === 1) {
        const e = new Error('duplicate');
        e.code = 11000;
        throw e;
      }
      return { ...payload, _id: 's2' };
    },
  };
  const doc = await settlementService.createSettlementWithUniqueNumber(Settlement, { vertical: 'local_services' });
  ok('a duplicate number is retried', attempts === 2);
  ok('the retried settlement carries the new number', doc.settlementNo === 44);
};

// ---- 3. Paying a settlement moves money -----------------------------------
const makeSettlement = (over = {}) => ({
  _id: 's1',
  settlementNo: 7,
  counterparty: 'biz1',
  status: 'processing',
  totals: { netAmount: 380 },
  save: async function save() {
    this.saved = true;
  },
  ...over,
});

const runWalletPayout = async () => {
  const settlement = makeSettlement();
  const Provider = { findOne: async () => ({ _id: 'p1', owner: 'owner1' }) };
  let credited = null;
  const result = await settlementService.paySettlement(
    's1',
    { method: 'wallet' },
    {
      SettlementModel: { findById: async () => settlement },
      ProviderModel: Provider,
      creditWallet: async (args) => {
        credited = args;
        return { transactionId: 'txn_9', balance: 1380 };
      },
    }
  );
  ok('the wallet is credited', credited !== null);
  ok('the credit is the net payable', credited && credited.amountRupees === 380);
  ok('the credit names the settlement', credited && String(credited.bookingCode).includes('7'));
  ok('the settlement is settled', result.settlement.status === 'settled');
  ok('the payout reference is recorded', result.settlement.gatewayReference === 'txn_9');
  ok('the payout method is recorded', result.settlement.payoutMethod === 'wallet');
};

const runBankPayout = async () => {
  const settlement = makeSettlement();
  const result = await settlementService.paySettlement(
    's1',
    { method: 'bank', reference: 'UTR123' },
    { SettlementModel: { findById: async () => settlement } }
  );
  ok('a bank payout records the reference', result.settlement.gatewayReference === 'UTR123');
  ok('a bank payout is settled', result.settlement.status === 'settled');
  ok('a bank payout records the method', result.settlement.payoutMethod === 'bank');
};

const runBankPayoutWithoutReference = async () => {
  const settlement = makeSettlement();
  let threw = false;
  try {
    await settlementService.paySettlement(
      's1',
      { method: 'bank' },
      { SettlementModel: { findById: async () => settlement } }
    );
  } catch (e) {
    threw = e.statusCode === 400;
  }
  ok('a bank payout without a reference is refused', threw);
  ok('a refused payout does not settle the batch', settlement.status === 'processing');
};

const runZeroPayout = async () => {
  const settlement = makeSettlement({ totals: { netAmount: 0 } });
  let threw = false;
  try {
    await settlementService.paySettlement(
      's1',
      { method: 'wallet' },
      { SettlementModel: { findById: async () => settlement } }
    );
  } catch (e) {
    threw = e.statusCode === 409;
  }
  ok('a settlement with nothing payable cannot be paid', threw);
};

(async () => {
  await runHeld();
  await runGenerateHolds();
  await runNumberRetry();
  await runWalletPayout();
  await runBankPayout();
  await runBankPayoutWithoutReference();
  await runZeroPayout();
  console.log(failures === 0 ? '\nAll local-services settlement-payout units passed.' : `\n${failures} FAILURES`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
