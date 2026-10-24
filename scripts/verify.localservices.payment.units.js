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

const paymentService = require('../src/modules/local-services/services/localservice.payment.service');
const bridge = require('../src/modules/local-services/services/localservice.payment.bridge.service');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const expectStatus = async (label, fn, code) => {
  let actual = null;
  try {
    await fn();
  } catch (e) {
    actual = e.statusCode;
  }
  ok(label, actual === code, `expected ${code}, got ${actual}`);
};

(async () => {
  const baseBooking = {
    _id: 'b1',
    bookingCode: 'LS2601010001',
    customer: 'c1',
    status: 'DRAFT',
    bookingMode: 'INSTANT',
    paymentMode: 'gateway',
    paymentStatus: 'pending',
    serviceValue: 1200,
  };

  await expectStatus(
    'request booking rejected before acceptance',
    () =>
      paymentService.assertBookingPayable(
        { ...baseBooking, bookingMode: 'REQUEST' },
        'c1'
      ),
    409
  );
  await expectStatus(
    'non-gateway booking rejected',
    () =>
      paymentService.assertBookingPayable(
        { ...baseBooking, paymentMode: 'cod' },
        'c1'
      ),
    409
  );
  await expectStatus(
    'foreign booking rejected',
    () => paymentService.assertBookingPayable(baseBooking, 'someone-else'),
    403
  );
  ok(
    'instant draft is self-payable',
    paymentService.assertBookingPayable(baseBooking, 'c1') === 1200
  );
  const depositBooking = {
    ...baseBooking,
    serviceValue: 1200,
    depositAmount: 200,
    balanceAmount: 1000,
    amountPaid: 0,
  };
  ok(
    'deposit is the first amount due',
    paymentService.assertBookingPayable(depositBooking, 'c1') === 200
  );
  ok(
    'balance is due after the deposit',
    paymentService.assertBookingPayable(
      { ...depositBooking, amountPaid: 200, paymentStatus: 'partially_paid', status: 'CONFIRMED' },
      'c1'
    ) === 1000
  );

  let transitionedTo = null;
  const created = [];
  const booking = { ...baseBooking };
  const result = await paymentService.initiateBookingPayment(
    { bookingId: 'b1', customerId: 'c1', paymentConfigId: 'pc1' },
    {
      BookingModel: { findById: async () => booking },
      PaymentConfigModel: { findById: async () => ({ _id: 'pc1', status: true }) },
      PaymentInitiationModel: {
        findOne: () => ({ sort: async () => null }),
        create: async (doc) => {
          const row = { _id: 'pi1', ...doc };
          created.push(row);
          return row;
        },
      },
      bookingService: {
        transitionBooking: async (id, to) => {
          transitionedTo = to;
          return { booking };
        },
      },
    }
  );
  ok('payment initiation moves booking to PAYMENT_PENDING', transitionedTo === 'PAYMENT_PENDING');
  ok('server sets the payable amount', result.initiation.amount === 1200);
  ok(
    'payment initiation is linked to the booking',
    result.initiation.localServiceBooking === 'b1' &&
      result.initiation.localServiceBookingId === 'b1'
  );
  ok('payment subject is localServiceBooking', result.initiation.paymentFrom === 'localServiceBooking');
  ok('payment reference is generated', result.initiation.paymentRef === 'LS-BOOKING-LS2601010001');
  ok('exactly one initiation created', created.length === 1);
  ok('booking response reflects pending payment status', result.booking.status === 'PAYMENT_PENDING');

  let depositInitiation = null;
  const depositFlowBooking = { ...depositBooking, status: 'DRAFT' };
  await paymentService.initiateBookingPayment(
    { bookingId: 'b1', customerId: 'c1', paymentConfigId: 'pc1' },
    {
      BookingModel: { findById: async () => depositFlowBooking },
      PaymentConfigModel: { findById: async () => ({ _id: 'pc1', status: true }) },
      PaymentInitiationModel: {
        findOne: () => ({ sort: async () => null }),
        create: async (doc) => {
          depositInitiation = { _id: 'pi-deposit', ...doc };
          return depositInitiation;
        },
      },
      bookingService: { transitionBooking: async () => ({ booking: depositFlowBooking }) },
    }
  );
  ok('deposit initiation charges only the deposit', depositInitiation && depositInitiation.amount === 200);

  const existing = { _id: 'pi-open', status: 'initiated' };
  let createCalls = 0;
  await paymentService.initiateBookingPayment(
    { bookingId: 'b1', customerId: 'c1', paymentConfigId: 'pc1' },
    {
      BookingModel: { findById: async () => ({ ...baseBooking, status: 'PAYMENT_PENDING' }) },
      PaymentConfigModel: { findById: async () => ({ _id: 'pc1', status: true }) },
      PaymentInitiationModel: {
        findOne: () => ({ sort: async () => existing }),
        create: async () => {
          createCalls += 1;
          return null;
        },
      },
      bookingService: { transitionBooking: async () => ({ booking: {} }) },
    }
  );
  ok('open initiation is reused, not duplicated', createCalls === 0);

  let defaultInitiation = null;
  await paymentService.initiateBookingPayment(
    { bookingId: 'b1', customerId: 'c1' },
    {
      BookingModel: { findById: async () => ({ ...baseBooking, status: 'PAYMENT_PENDING' }) },
      PaymentConfigModel: { findOne: async () => ({ _id: 'pc-default', status: true }) },
      PaymentInitiationModel: {
        findOne: () => ({ sort: async () => null }),
        create: async (doc) => {
          defaultInitiation = { _id: 'pi-default', ...doc };
          return defaultInitiation;
        },
      },
      bookingService: { transitionBooking: async () => ({ booking: {} }) },
    }
  );
  ok(
    'missing payment config falls back to the default gateway',
    defaultInitiation && defaultInitiation.payment === 'pc-default'
  );

  const pending = {
    _id: 'b2',
    customer: 'c1',
    status: 'PAYMENT_PENDING',
    paymentStatus: 'pending',
    payment: null,
    save: async () => pending,
  };
  let confirmedTo = null;
  let released = 0;
  const paid = await bridge.markBookingPaid(
    { bookingId: 'b2', paymentId: 'pay1' },
    {
      BookingModel: { findById: async () => pending },
      ReservationModel: {
        updateMany: async (filter, update) => {
          if (update.$set.status === 'confirmed') released += 1;
        },
      },
      bookingService: {
        transitionBooking: async (id, to) => {
          confirmedTo = to;
          return { booking: { ...pending, status: to } };
        },
      },
    }
  );
  ok('paid callback sets paymentStatus=paid', pending.paymentStatus === 'paid');
  ok('paid callback stores gateway payment id', pending.payment === 'pay1');
  ok('paid callback confirms pending booking', confirmedTo === 'CONFIRMED' && paid.confirmed === true);
  ok('paid callback confirms the capacity hold', released === 1);

  const partial = {
    _id: 'b-deposit',
    customer: 'c1',
    status: 'PAYMENT_PENDING',
    paymentMode: 'gateway',
    paymentStatus: 'pending',
    serviceValue: 1200,
    depositAmount: 200,
    balanceAmount: 1000,
    amountPaid: 0,
    payments: [],
    save: async () => partial,
  };
  let partialTransition = null;
  const depositPaid = await bridge.markBookingPaid(
    { bookingId: 'b-deposit', paymentId: 'pay-deposit', amount: 200 },
    {
      BookingModel: { findById: async () => partial },
      ReservationModel: { updateMany: async () => {} },
      bookingService: {
        transitionBooking: async (id, to) => {
          partialTransition = to;
          return { booking: { ...partial, status: to } };
        },
      },
    }
  );
  ok('deposit callback records partial payment', partial.amountPaid === 200 && partial.paymentStatus === 'partially_paid');
  ok('deposit callback confirms the booking', partialTransition === 'CONFIRMED' && depositPaid.confirmed === true);
  ok('deposit callback records the initiation', partial.payments.includes('pay-deposit'));

  const balanceBooking = { ...partial, status: 'CONFIRMED', amountPaid: 200, payments: ['pay-deposit'] };
  let balanceTransition = null;
  await bridge.markBookingPaid(
    { bookingId: 'b-deposit', paymentId: 'pay-balance', amount: 1000 },
    {
      BookingModel: { findById: async () => balanceBooking },
      ReservationModel: { updateMany: async () => {} },
      bookingService: {
        transitionBooking: async () => {
          balanceTransition = true;
          return { booking: balanceBooking };
        },
      },
    }
  );
  ok('balance callback settles the booking', balanceBooking.amountPaid === 1200 && balanceBooking.paymentStatus === 'paid');
  ok('balance callback does not re-transition', balanceTransition === null);

  const replayPartial = await bridge.markBookingPaid(
    { bookingId: 'b-deposit', paymentId: 'pay-deposit', amount: 200 },
    {
      BookingModel: { findById: async () => balanceBooking },
      ReservationModel: { updateMany: async () => {} },
      bookingService: { transitionBooking: async () => { throw new Error('must not transition'); } },
    }
  );
  ok('deposit callback replay is deduped', replayPartial.deduped === true && balanceBooking.amountPaid === 1200);

  const settled = { status: 'CONFIRMED', paymentStatus: 'paid', payment: 'pay1' };
  const replay = await bridge.markBookingPaid(
    { bookingId: 'b3', paymentId: 'pay1' },
    {
      BookingModel: { findById: async () => settled },
      ReservationModel: { updateMany: async () => {} },
      bookingService: {
        transitionBooking: async () => {
          throw new Error('replay must not transition');
        },
      },
    }
  );
  ok('replayed callback is deduped', replay.deduped === true && replay.confirmed === true);

  const failedBooking = {
    _id: 'b4',
    customer: 'c4',
    bookingCode: 'LS2601010004',
    paymentStatus: 'pending',
    save: async () => failedBooking,
  };
  let holderReleased = 0;
  await paymentService.routeFailedCallback(
    { paymentFrom: 'localServiceBooking', localServiceBookingId: 'b4' },
    null,
    {
      BookingModel: { findById: async () => failedBooking },
      ReservationModel: {
        updateMany: async () => {
          holderReleased += 1;
        },
      },
    }
  );
  ok('failed callback marks payment failed', failedBooking.paymentStatus === 'failed');
  ok('failed callback releases the capacity hold', holderReleased === 1);

  const PaymentInitiationModel = require('../src/models/payment.initiation.model');
  const models = require('../src/models');
  const paymentInitiationService = require('../src/services/payment.initiation.service');
  const originalAggregate = PaymentInitiationModel.aggregate;
  const originalSettings = models.BusinessSettings.findOne;
  let pipeline = null;
  PaymentInitiationModel.aggregate = async (stages) => {
    pipeline = stages;
    return [];
  };
  models.BusinessSettings.findOne = async () => ({});
  try {
    await paymentInitiationService.paymentInfo('507f1f77bcf86cd799439011');
  } finally {
    PaymentInitiationModel.aggregate = originalAggregate;
    models.BusinessSettings.findOne = originalSettings;
  }
  const projection = (pipeline || []).flat(Infinity).find((stage) => stage.$project);
  ok(
    'paymentInfo projects localServiceBookingId',
    projection && projection.$project.localServiceBookingId === 1
  );
  ok(
    'paymentInfo projects localServiceBooking',
    projection && projection.$project.localServiceBooking === 1
  );

  console.log(failures === 0 ? '\nAll local-services payment units passed.' : `\n${failures} FAILURES`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
