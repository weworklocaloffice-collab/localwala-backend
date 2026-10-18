/*
 * LocalWala - Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright (c) 2026 WeWorkLocal Private Limited
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
  Business,
  User,
  Wallet,
  Transactions,
  DairyDriver,
  DairyDriverInvite,
  DeliveryRun,
  DeliveryStop,
  DriverOfflineMessages,
} = require('../../../models');
const ApiError = require('../../../utils/ApiError');
const { debitMoneyField, creditMoneyField, toPaise } = require('../../../utils/money');
const notificationService = require('./dairy.notification.service');

/**
 * A partner's own delivery fleet, and the rider's side of it.
 *
 * Every outlet-scoped function here takes `businessId`, which the partner routes
 * fill from the access token. None accepts it from the client, so there is no
 * request shape that reaches another outlet's riders.
 *
 * ## Payout semantics
 *
 * A payout is money leaving the platform, so it moves between two wallets and is
 * recorded as a pair of `Transactions`. The debit is guarded and atomic
 * ({@link debitMoneyField}) so two concurrent payouts cannot both pass a
 * read-check and jointly overdraw the outlet. The credit is deliberately *not*
 * conditional - once the debit has succeeded, refusing the credit would strand
 * the money, which is the worse of the two failures.
 *
 * Because MongoDB here is standalone (see `check.mongo.capabilities`), the two
 * wallet writes cannot share a transaction. The failure mode is therefore: debit
 * succeeded, credit did not. That is recoverable by re-running the payout, and
 * `paidAt` is only written after both, so an interrupted payout stays visible as
 * outstanding rather than looking complete.
 */

const INVITE_TTL_DAYS = 14;

// //// Invitations ////

/**
 * Invites a rider to this outlet's fleet.
 *
 * Idempotent on the phone number: re-inviting someone who already has a pending
 * invite returns that invite rather than failing on the unique index. A partner
 * who taps invite twice should not see an error, and the second tap should not
 * silently create a second invitation.
 *
 * @param {string} businessId outlet from the token
 * @param {Object} param mobile, countryCode, invitedBy
 * @returns {Promise<Object>} the invite
 */
const inviteRider = async (businessId, param) => {
  const business = await Business.findById(businessId).select('ownDeliveryPartner name');
  if (!business) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');
  }
  if (business.ownDeliveryPartner !== true) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'This outlet does not run its own delivery fleet. Turn that on before inviting riders.'
    );
  }

  const mobile = Number(param.mobile);
  if (!Number.isFinite(mobile) || mobile <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A valid mobile number is required');
  }

  const existingUser = await User.findOne({
    countryCode: param.countryCode || '+91',
    mobile,
  }).select('_id role');

  if (existingUser) {
    // Already on a fleet? Then inviting is a mistake worth naming rather than a
    // no-op that leaves the partner thinking it worked.
    const alreadyOnFleet = await DairyDriver.findOne({ userId: existingUser._id });
    if (alreadyOnFleet && alreadyOnFleet.business) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'That number is already a rider on another outlet'
      );
    }

    // Registered but not yet on a fleet: attach them directly rather than
    // sending an invitation to a phone they already own.
    if (alreadyOnFleet) {
      const attached = await attachRider(alreadyOnFleet, businessId);
      return { invite: null, rider: attached, alreadyRegistered: true };
    }

    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'That number is already registered as a non-rider account and cannot join a fleet'
    );
  }

  const pending = await DairyDriverInvite.findOne({
    business: businessId,
    mobile,
    status: 'pending',
  });

  if (pending) {
    // Extend the window: a partner re-inviting means they still want this rider.
    pending.expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400000);
    await pending.save();
    return { invite: pending, rider: null, alreadyInvited: true };
  }

  const invite = await DairyDriverInvite.create({
    business: businessId,
    invitedBy: param.invitedBy,
    countryCode: param.countryCode || '+91',
    mobile,
    status: 'pending',
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86400000),
  });

  return { invite, rider: null, alreadyInvited: false };
};

/**
 * Pending invitations for this outlet.
 *
 * @param {string} businessId outlet from the token
 * @returns {Promise<Object[]>}
 */
const listInvites = async (businessId) => {
  return DairyDriverInvite.find({ business: businessId })
    .populate('rider', 'firstName lastName mobile countryCode')
    .sort({ createdAt: -1 })
    .limit(100);
};

/**
 * Attaches a rider to an outlet and marks the invite accepted.
 *
 * Shared by the invite path and by direct attachment, so the fleet bookkeeping
 * - the outlet's `deliveryPartners` list and the invite's `accepted` state - is
 * written in exactly one place.
 *
 * @param {Document} driver
 * @param {string} businessId
 * @returns {Promise<Document>} the driver
 */
const attachRider = async (driver, businessId) => {
  driver.business = businessId;
  driver.status = true;
  driver.isBlocked = false;
  driver.activeStatus = true;
  await driver.save();

  await Business.updateOne(
    { _id: businessId },
    { $addToSet: { deliveryPartners: driver.userId } }
  );

  // Matched on the rider's phone, which is how an invitation is issued: the
  // invite has no rider id until the rider accepts it.
  const rider = await User.findById(driver.userId).select('countryCode mobile');
  if (rider) {
    await DairyDriverInvite.updateOne(
      {
        business: businessId,
        countryCode: rider.countryCode,
        mobile: rider.mobile,
        status: 'pending',
      },
      { $set: { status: 'accepted', rider: driver.userId, acceptedAt: new Date() } }
    );
  }

  return driver;
};

/**
 * Revokes a pending invitation.
 *
 * Only while it is still pending: an accepted invite is history, and "undoing"
 * one would be the same operation as removing the rider, which is a separate
 * decision with its own record.
 *
 * @param {string} businessId
 * @param {string} inviteId
 * @param {string} reason
 * @returns {Promise<Object>}
 */
const revokeInvite = async (businessId, inviteId, reason) => {
  const invite = await DairyDriverInvite.findOne({ _id: inviteId, business: businessId });
  if (!invite) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Invitation not found');
  }
  if (invite.status !== 'pending') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `This invitation is ${invite.status} and cannot be revoked`
    );
  }

  invite.status = 'revoked';
  invite.revokedAt = new Date();
  invite.reason = reason;
  await invite.save();
  return invite;
};

// //// Fleet membership ////

/**
 * The rider record, but only if it belongs to this outlet.
 *
 * The outlet is part of the lookup rather than a check afterwards, so a foreign
 * rider is reported as absent rather than forbidden - which also avoids
 * confirming that a rider id exists on another fleet.
 *
 * @param {string} businessId
 * @param {string} driverId
 * @returns {Promise<Document>}
 */
const findFleetDriver = async (businessId, driverId) => {
  const driver = await DairyDriver.findOne({
    _id: driverId,
    business: businessId,
  }).populate('userId', 'firstName lastName mobile countryCode email');

  if (!driver) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Rider not found on this outlet');
  }
  return driver;
};

/**
 * Approves or blocks a rider on this outlet.
 *
 * `approve` is what a partner does after a rider's documents check out; `block`
 * takes them off the run roster without deleting anything. Nothing is ever
 * deleted, because a rider's delivery history has to keep resolving.
 *
 * @param {string} businessId
 * @param {string} driverId
 * @param {boolean} approve
 * @param {Object} param reason
 * @returns {Promise<Document>}
 */
const setDriverApproval = async (businessId, driverId, approve, param = {}) => {
  const driver = await findFleetDriver(businessId, driverId);

  driver.isBlocked = !approve;
  driver.activeStatus = approve;
  // `status` is the profile's own validity. Blocking hides the rider from
  // dispatch but must not look like the profile was deleted.
  driver.status = true;
  await driver.save();

  // The reason is a `DriverOfflineMessages` reference, not free text: the field
  // is an ObjectId. Writing a sentence there was a cast error. A reason is
  // optional, and a wrong id must not silently block the whole decision - the
  // rider is already unblocked or blocked by this point, so a bad reason is
  // reported rather than thrown.
  if (param.reason) {
    const reason = await DriverOfflineMessages.findOne({
      name: param.reason,
      status: true,
    }).select('_id');

    if (!reason) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `"${param.reason}" is not a known offline reason`
      );
    }
    driver.offlineReason = reason._id;
    await driver.save();
  }

  return driver;
};

/**
 * Removes a rider from this outlet's fleet.
 *
 * Deactivates rather than deletes, and stays attached to the outlet. It used to set
 * `business: null`, which moved the rider onto the platform pool — but there is no
 * pool, and a rider with no outlet has no route and nobody paying them. Keeping the
 * link is the more honest record: this rider worked here, so their runs, stops and
 * earnings still resolve. `status: false` is what takes them off the active roster.
 *
 * @param {string} businessId
 * @param {string} driverId
 * @param {Object} param reason
 * @returns {Promise<Document>}
 */
const removeDriver = async (businessId, driverId, param = {}) => {
  const driver = await findFleetDriver(businessId, driverId);

  // A rider mid-run cannot be pulled off the fleet: their manifest is already
  // planned and stops are assigned to them. Removing them here would leave a run
  // pointing at a rider who is no longer on the roster.
  const liveRun = await DeliveryRun.findOne({
    agent: driver._id,
    status: { $in: ['dispatched', 'started'] },
  }).select('_id runNo status');

  if (liveRun) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `This rider has a live run (#${liveRun.runNo}, ${liveRun.status}). Complete or cancel it first.`
    );
  }

  const riderUserId = driver.userId && driver.userId._id ? driver.userId._id : driver.userId;

  // Deactivated, not detached.
  //
  // This used to set `business = null`, which moved the rider onto the platform
  // pool. There is no pool, so a detached rider would have no outlet, no route and
  // nobody paying them — and `DairyDriver.business` is required, so the save failed
  // outright with a validation error.
  //
  // Staying attached is also the more honest record: this rider worked here, so their
  // runs, stops and earnings still resolve to this outlet. `status: false` takes
  // them off the active roster, which is what "removed" has to mean.
  driver.isBlocked = false;
  driver.activeStatus = false;
  driver.status = false;
  await driver.save();

  // `offlineReason` is a `DriverOfflineMessages` reference, so a free-text reason
  // cannot be written there - the same trap as in `setDriverApproval`. Resolved
  // the same way: a known reason id, or a refusal that names what was wrong.
  if (param.reason) {
    const reason = await DriverOfflineMessages.findOne({
      name: param.reason,
      status: true,
    }).select('_id');

    if (!reason) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `"${param.reason}" is not a known offline reason`
      );
    }
    driver.offlineReason = reason._id;
    await driver.save();
  }

  await Business.updateOne(
    { _id: businessId },
    { $pull: { deliveryPartners: riderUserId } }
  );

  return driver;
};

// //// Payout ////

/**
 * Pays a rider from the outlet's wallet.
 *
 * The rider's payout rate is applied by the caller; this takes an explicit
 * `amount` because a partner paying a rider off-cycle is a real thing and the
 * rate-based figure is only a default.
 *
 * @param {string} businessId
 * @param {string} driverId
 * @param {Object} param amount, reference, actor
 * @returns {Promise<Object>} the payout summary
 */
const payDriver = async (businessId, driverId, param = {}) => {
  const driver = await findFleetDriver(businessId, driverId);

  const amount = Number(param.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A positive payout amount is required');
  }

  const riderUserId = driver.userId && driver.userId._id ? driver.userId._id : driver.userId;

  const riderWallet = await Wallet.findOne({ holderId: riderUserId, status: true });
  if (!riderWallet) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'This rider has no active wallet, so they cannot be paid yet'
    );
  }

  const outletWallet = await Wallet.findOne({ holderId: businessId, status: true });
  if (!outletWallet) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This outlet has no active wallet');
  }

  const amountPaise = toPaise(amount);

  // Guarded debit: refuses to overdraw rather than trusting a read of the
  // balance taken a moment ago.
  const { debited } = await debitMoneyField(Wallet, outletWallet._id, 'balance', amountPaise, {
    $set: { updatedAt: new Date() },
  });

  if (!debited) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'The outlet wallet does not have enough balance for this payout'
    );
  }

  const { credited } = await creditMoneyField(Wallet, riderWallet._id, 'balance', amountPaise, {
    $set: { updatedAt: new Date() },
  });

  if (!credited) {
    // The money has left the outlet. Not crediting the rider would strand it, and
    // the operator needs to know immediately rather than find a gap in two
    // statements later.
    console.error(
      `[dairy] payout debit succeeded but credit failed: outlet=${businessId} rider=${riderUserId} paise=${amountPaise}`
    );
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      'The payout was debited but could not be credited. It has not been lost - re-run it.'
    );
  }

  const payout = {
    amount,
    reference: param.reference || null,
    paidAt: new Date(),
    paidBy: param.actor || null,
    // The rate the payout was derived from, kept for the record even when the
    // amount was entered by hand.
    payoutMode: driver.payoutMode,
    payoutRate: driver.payoutRate,
  };

  driver.payoutHistory = driver.payoutHistory || [];
  driver.payoutHistory.push(payout);
  await driver.save();

  // Tell the partner the payout is on the record. Best-effort: the money has
  // already moved, so a notice that cannot be written must not fail the payout.
  if (param.partnerUserId) {
    await notificationService.notifyPayoutRecorded({
      partnerUserId: param.partnerUserId,
      business: businessId,
      driver: { _id: driver._id, id: driver.id || String(driver._id) },
      driverName:
        (driver.userId && driver.userId.firstName) || `rider ${String(riderUserId).slice(-4)}`,
      amount,
    });
  }

  // `Transactions` is a legacy-shaped model: `payableId` is the *account* the
  // row is about (named for the payout flow it was built for), `walletId` the
  // wallet moved, `type` a free string, `status` a Boolean, and everything else
  // lives in `meta`. Writing a conventional shape here fails validation, so the
  // ledger rows are built to fit the model rather than the model widened.
  const meta = {
    source: 'driver_payout',
    reference: payout.reference || null,
    paidBy: payout.paidBy,
    payoutMode: payout.payoutMode,
    payoutRate: payout.payoutRate,
    counterparty: riderUserId,
  };

  await Transactions.create([
    {
      payableId: businessId,
      walletId: outletWallet._id,
      type: 'driver_payout_debit',
      amount,
      confirmed: true,
      status: true,
      meta: [meta],
    },
    {
      payableId: riderUserId,
      walletId: riderWallet._id,
      type: 'driver_payout_credit',
      amount,
      confirmed: true,
      status: true,
      meta: [meta],
    },
  ]);

  return { driver, payout, riderWalletId: riderWallet._id };
};

// //// Rider-side views ////

/**
 * What a rider has earned over a window.
 *
 * `per_can` - the default - pays on cans returned (`cansIn`), because a rider is
 * paid for the empties they bring back: that is the behaviour the can ledger is
 * built to prove. `per_litre` and `salary` do not vary with the day's work, so
 * they report the agreed figure rather than inventing a per-stop number.
 *
 * @param {string} driverId `DairyDriver._id`
 * @param {Object} options from, to
 * @returns {Promise<Object>}
 */
const getDriverEarnings = async (driverId, options = {}) => {
  const driver = await DairyDriver.findById(driverId).select('payoutMode payoutRate');
  if (!driver) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Rider not found');
  }

  const dateFilter = {};
  if (options.from || options.to) {
    dateFilter.completedAt = {};
    if (options.from) dateFilter.completedAt.$gte = new Date(options.from);
    if (options.to) dateFilter.completedAt.$lt = new Date(options.to);
  }

// The stop ledger joined to its run is the only place a rider's cans and
  // amounts are recorded.
  const stops = await DeliveryStop.find({
    status: 'delivered',
    ...dateFilter,
  })
    .populate('run', 'business agent runNo serviceDate')
    .select('run cansIn amountDue amountCollected completedAt')
    .sort({ completedAt: -1 })
    .limit(500);

  const mine = stops.filter(
    (stop) =>
      stop.run &&
      stop.run.agent &&
      stop.run.agent._id.toString() === driverId.toString()
  );

  const cansIn = mine.reduce((sum, stop) => sum + (stop.cansIn || 0), 0);
  const deliveredStops = mine.length;

  // Amounts on a stop are rupee fields, so they arrive as rupees here.
  const cashCollected = mine.reduce((sum, stop) => sum + Number(stop.amountCollected || 0), 0);
  const amountDue = mine.reduce((sum, stop) => sum + Number(stop.amountDue || 0), 0);

  const rate = Number(driver.payoutRate || 0);
  let earned = 0;

  if (driver.payoutMode === 'per_can') {
    earned = Number((cansIn * rate).toFixed(2));
  } else if (driver.payoutMode === 'salary') {
    // A salary does not vary with the day's stops, so there is nothing to sum.
    earned = rate;
  }

  return {
    payoutMode: driver.payoutMode,
    payoutRate: rate,
    deliveredStops,
    cansIn,
    // Collection figures, not earnings: they belong to the depot, and showing
    // them here would invite a rider to "earn" money that is not theirs.
    amountDue: Number(amountDue.toFixed(2)),
    cashCollected: Number(cashCollected.toFixed(2)),
    earned,
    // `per_litre` needs litres, which only the can ledger carries; reported as
    // null rather than approximated from cans, since a guess here would be a
    // wrong wage.
    perLitreSupported: false,
  };
};

/**
 * Cash the rider is currently holding.
 *
 * Collected cash is the platform's money in the rider's hands, so it has to be
 * visible before it is banked. This is the figure that makes the cash-deposit
 * step reconcilable.
 *
 * @param {string} driverId
 * @param {Object} options from, to
 * @returns {Promise<Object>}
 */
const getCashInHand = async (driverId, options = {}) => {
  const dateFilter = {};
  if (options.from || options.to) {
    dateFilter.completedAt = {};
    if (options.from) dateFilter.completedAt.$gte = new Date(options.from);
    if (options.to) dateFilter.completedAt.$lt = new Date(options.to);
  }

  const stops = await DeliveryStop.find({ status: 'delivered', ...dateFilter })
    .populate('run', 'agent runNo')
    .select('run amountDue amountCollected paymentMode completedAt')
    .limit(1000);

  const mine = stops.filter(
    (stop) =>
      stop.run &&
      stop.run.agent &&
      stop.run.agent._id.toString() === driverId.toString()
  );

  const cashStops = mine.filter((stop) => stop.paymentMode === 'cod');

  const collected = cashStops.reduce(
    (sum, stop) => sum + Number(stop.amountCollected || 0),
    0
  );

  // `payableId` is the account the row belongs to and `meta` carries the source,
  // so the source filter has to reach into the array.
  const deposits = await Transactions.find({
    payableId: { $in: await riderUserIds(driverId) },
    'meta.source': 'cash_deposit',
    status: true,
  })
    .select('amount createdAt reference')
    .sort({ createdAt: -1 })
    .limit(200);

  const deposited = deposits.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);

  return {
    cashStops: cashStops.length,
    // What the rider is carrying.
    collected: Number(collected.toFixed(2)),
    // What they have already handed over at the depot.
    deposited: Number(deposited.toFixed(2)),
    // Collected less deposited. Negative would mean a deposit is missing.
    outstanding: Number((collected - deposited).toFixed(2)),
    deposits: deposits.slice(0, 20),
  };
};

/**
 * Records cash handed to the depot.
 *
 * Recorded against the rider and immediately visible in `getCashInHand`, so a
 * missing deposit shows up as outstanding rather than disappearing.
 *
 * @param {string} driverId
 * @param {Object} param amount, reference
 * @returns {Promise<Object>}
 */
const recordCashDeposit = async (driverId, param = {}) => {
  const driver = await DairyDriver.findById(driverId).select('userId');
  if (!driver) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Rider not found');
  }

  const amount = Number(param.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A positive deposit amount is required');
  }

  const wallet = await Wallet.findOne({ holderId: driver.userId, status: true });
  if (!wallet) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'You have no active wallet');
  }

  const transaction = await Transactions.create({
    payableId: driver.userId,
    walletId: wallet._id,
    type: 'cash_deposit',
    amount,
    confirmed: true,
    status: true,
    meta: [
      {
        source: 'cash_deposit',
        reference: param.reference || null,
        note: 'Cash handed to the depot',
      },
    ],
  });

  return { deposit: { amount, reference: param.reference || null, recordedAt: new Date() }, transaction };
};

const riderUserIds = async (driverId) => {
  const driver = await DairyDriver.findById(driverId).select('userId');
  return driver ? [driver.userId] : [];
};

module.exports = {
  INVITE_TTL_DAYS,
  inviteRider,
  listInvites,
  revokeInvite,
  setDriverApproval,
  removeDriver,
  payDriver,
  getDriverEarnings,
  getCashInHand,
  recordCashDeposit,
};