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
 * Provider payables: freeze a period into a statement, then settle it.
 *
 * The live aggregate in `dairy.procurement.service` answers "what would we owe
 * right now" — useful on a dashboard, useless as a statement, because it moves
 * under you. Everything here exists to turn that moving figure into a fixed one:
 *
 *   - **Only accepted collections are claimable.** Milk that failed QC is never
 *     owed, and a `pending` intake is not owed *yet*. Claiming one would create a
 *     debt the platform does not have.
 *   - **Generation freezes them.** Each statement records which intakes it covers,
 *     so a later QC decision or rate change cannot restate it, and those intakes
 *     cannot be claimed twice.
 *   - **Payment settles them.** Marking a statement paid is what moves the
 *     underlying intakes to `paid` — that link is the whole point.
 *
 * MongoDB here is standalone, so generation is written to be compensatable rather
 * than atomic: the statement is written first, and if the collections cannot be
 * claimed it is voided rather than left claiming money it does not own.
 */

const { status: httpStatus } = require('http-status');
const {
  DairyProviderPayable,
  DairyMilkCollection,
  DairyMilkProvider,
} = require('../../../models');
const ApiError = require('../../../utils/ApiError');

/** Legal transitions. Anything else is rejected rather than silently applied. */
const PAYABLE_TRANSITIONS = {
  draft: ['approved', 'disputed', 'void'],
  disputed: ['approved', 'void'],
  approved: ['paid', 'disputed', 'void'],
  paid: [],
  void: [],
};

const assertTransition = (from, to) => {
  const allowed = PAYABLE_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Illegal payable transition: ${from} -> ${to}. Allowed from ${from}: ${allowed.join(', ') || 'none'}`
    );
  }
};

const nextPayableNo = async () => {
  const year = new Date().getFullYear();
  const latest = await DairyProviderPayable.findOne({ payableNo: new RegExp(`^PP-${year}-`) })
    .sort({ payableNo: -1 })
    .select('payableNo');
  const lastSeq = latest && latest.payableNo
    ? parseInt(latest.payableNo.split('-')[2], 10)
    : 0;
  return `PP-${year}-${String(lastSeq + 1).padStart(4, '0')}`;
};

/** Midnight on the given date, so a period boundary is not a moving target. */
const startOfDay = (date) => {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

/**
 * Collections a statement may claim: accepted QC, and not already on a statement.
 *
 * `payableStatus: 'pending'` is the claimable state — it means "not yet owed".
 * Excluding every other value is what stops the same litre appearing twice.
 */
const claimableCollections = (businessId, providerId, from, to) =>
  DairyMilkCollection.find({
    business: businessId,
    provider: providerId,
    qualityStatus: 'accepted',
    payableStatus: 'pending',
    collectedAt: { $gte: from, $lt: to },
  }).sort({ collectedAt: 1 });

/**
 * Generates a draft statement for one provider over a period.
 *
 * Refuses when a live statement already covers the same period start, and when
 * there is nothing to pay — an empty statement is noise, and a provider who
 * receives one will ask what it means.
 *
 * @param {Object} param
 * @returns {Promise<Object>} the draft payable
 */
const generatePayable = async (param) => {
  const from = startOfDay(param.from);
  const to = startOfDay(param.to);

  if (!(to > from)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'The period end must be after its start');
  }

  const provider = await DairyMilkProvider.findById(param.provider);
  if (!provider) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Provider not found');
  }

  const existing = await DairyProviderPayable.findOne({
    provider: provider._id,
    'period.from': from,
    status: { $ne: 'void' },
  });
  if (existing) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `A payable already covers this period (${existing.payableNo}, ${existing.status})`
    );
  }

  const collections = await claimableCollections(param.business, provider._id, from, to);
  if (collections.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'No accepted, unsettled collections for this provider in that period'
    );
  }

  const providerRate = Number(provider.ratePerLitre || 0);

  const lineItems = collections.map((collection) => {
    const litres = Number(collection.quantityL || 0);
    // Prefer the rate the intake was actually recorded at. Falling back to the
    // provider's current rate keeps a legacy collection with no amount from
    // contributing nothing.
    const rate = Number(collection.amount) > 0 && litres > 0
      ? Number((Number(collection.amount) / litres).toFixed(2))
      : providerRate;

    return {
      intake: collection._id,
      collectionNo: collection.collectionNo,
      collectedAt: collection.collectedAt,
      quantityL: litres,
      ratePerLitre: rate,
      amount: Number((litres * rate).toFixed(2)),
    };
  });

  const litres = Number(lineItems.reduce((sum, l) => sum + l.quantityL, 0).toFixed(2));
  const grossAmount = Number(lineItems.reduce((sum, l) => sum + l.amount, 0).toFixed(2));

  const payable = await DairyProviderPayable.create({
    payableNo: await nextPayableNo(),
    business: param.business,
    provider: provider._id,
    period: {
      from,
      to,
      label: param.label || `${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`,
    },
    totals: {
      collectionCount: lineItems.length,
      litres,
      grossAmount,
      adjustmentsTotal: 0,
      netAmount: grossAmount,
      amountPaid: 0,
    },
    collections: lineItems,
    status: 'draft',
    payoutMethod: param.payoutMethod || 'bank',
    notes: param.notes,
  });

  // Claim the intakes. Only an unsettled one may be claimed, so this doubles as
  // the guard against a concurrent generation taking the same litres.
  const claimed = await DairyMilkCollection.updateMany(
    { _id: { $in: lineItems.map((l) => l.intake) }, payableStatus: 'pending' },
    { $set: { payableStatus: 'approved' } }
  );

  if (claimed.modifiedCount !== lineItems.length) {
    // Lost a race. Void rather than leave a statement claiming collections it
    // does not own.
    payable.status = 'void';
    payable.statusReason = 'Superseded by a concurrent generation';
    await payable.save();
    throw new ApiError(
      httpStatus.CONFLICT,
      'Some of those collections were claimed by another statement. Nothing was created.'
    );
  }

  return payable;
};

/**
 * Loads a payable, but only if it belongs to `business`.
 *
 * A partner route names the payable in the path while the outlet comes from the
 * token. Without the outlet in the lookup, passing another outlet's payable id
 * would let a partner read, adjust, approve or even pay it. Scoping the query
 * makes a foreign payable simply not exist.
 *
 * @param {string} payableId
 * @param {string} [business] outlet the caller is acting for
 * @returns {Promise<Document>}
 */
const findPayableOrFail = async (payableId, business) => {
  const query = { _id: payableId };
  if (business) {
    query.business = business;
  }
  const found = await DairyProviderPayable.findOne(query);
  if (!found) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Payable not found');
  }
  return found;
};

/**
 * Adds a deduction to a statement.
 *
 * Only while it is still open. Once money has moved the statement is history, and
 * a silent edit afterwards would leave the paid figure and the net figure
 * disagreeing with no trace.
 */
const addAdjustment = async (payableId, param) => {
  const payable = await findPayableOrFail(payableId, param.business);
  if (!['draft', 'disputed'].includes(payable.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Cannot adjust a payable that is ${payable.status}`);
  }
  if (!param.reason) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'An adjustment needs a reason');
  }

  payable.adjustments.push({
    amount: Number(param.amount || 0),
    reason: param.reason,
    recordedBy: param.recordedBy,
    recordedAt: new Date(),
  });

  const adjustmentsTotal = Number(
    payable.adjustments.reduce((sum, a) => sum + Number(a.amount), 0).toFixed(2)
  );
  payable.totals.adjustmentsTotal = adjustmentsTotal;
  // Recomputed from the frozen gross, never from a live aggregate — that is the
  // whole reason this document exists.
  payable.totals.netAmount = Number(
    (Number(payable.totals.grossAmount) - adjustmentsTotal).toFixed(2)
  );

  await payable.save();
  return payable;
};

/**
 * Moves a statement to a new state, rejecting illegal transitions.
 *
 * @param {string} payableId
 * @param {string} status
 * @param {Object} param
 */
const updateStatus = async (payableId, status, param = {}) => {
  const payable = await findPayableOrFail(payableId, param.business);

  assertTransition(payable.status, status);

  payable.status = status;
  if (param.reason) {
    payable.statusReason = param.reason;
  }
  if (status === 'approved') {
    payable.approvedAt = new Date();
    payable.approvedBy = param.actor;
  }

  await payable.save();
  return payable;
};

/**
 * Settles a statement and the collections behind it.
 *
 * The collections move first: they are the ledger, and a statement reading `paid`
 * while its intakes still read `approved` is exactly the drift this model exists to
 * prevent. If the settle fails the statement stays `approved` and can simply be
 * paid again — no partial state to unpick.
 */
const payPayable = async (payableId, param = {}) => {
  const payable = await findPayableOrFail(payableId, param.business);
  if (payable.status !== 'approved') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Only an approved payable can be paid; this one is ${payable.status}`
    );
  }

  const net = Number(payable.totals.netAmount);
  if (net < 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'This payable is negative, meaning the provider owes the platform. Settle it as a recovery, not a payout.'
    );
  }

  const settled = await DairyMilkCollection.updateMany(
    {
      _id: { $in: payable.collections.map((c) => c.intake) },
      payableStatus: 'approved',
    },
    { $set: { payableStatus: 'paid', payableSettledAt: new Date() } }
  );

  if (settled.modifiedCount !== payable.collections.length) {
    throw new ApiError(
      httpStatus.CONFLICT,
      'Some of the collections behind this payable are no longer in the approved state. Nothing was paid.'
    );
  }

  payable.status = 'paid';
  payable.paidAt = new Date();
  payable.paymentReference = param.reference;
  payable.totals.amountPaid = net;
  await payable.save();

  return payable;
};

/**
 * Releases a voided statement's collections so a corrected one can claim them.
 *
 * Without this, voiding would strand that milk as permanently unpayable.
 *
 * @param {string} payableId
 * @param {Object} param
 */
const voidPayable = async (payableId, param = {}) => {
  const payable = await findPayableOrFail(payableId, param.business);

  assertTransition(payable.status, 'void');

  // A paid statement keeps its collections settled: the money really did move, and
  // releasing them would let the same litres be paid twice.
  if (payable.status !== 'paid') {
    await DairyMilkCollection.updateMany(
      { _id: { $in: payable.collections.map((c) => c.intake) }, payableStatus: 'approved' },
      { $set: { payableStatus: 'pending', payableSettledAt: null } }
    );
  }

  payable.status = 'void';
  payable.statusReason = param.reason || 'Voided';
  await payable.save();

  return payable;
};

const getPayable = async (payableId, business) => {
  // The outlet has to be part of the query, so the population is chained onto
  // the query rather than onto the resulting document.
  const query = { _id: payableId };
  if (business) {
    query.business = business;
  }

  const payable = await DairyProviderPayable.findOne(query)
    .populate('provider', 'name code mobile countryCode ratePerLitre bankDetails')
    .populate('business', 'name businessModel');

  if (!payable) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Payable not found');
  }

  return payable;
};

/**
 * Payables matching a filter.
 *
 * @param {Object} options business, provider, status, limit, page
 */
const listPayables = async (options = {}) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;

  const query = {};
  if (options.business) query.business = options.business;
  if (options.provider) query.provider = options.provider;
  if (options.status) query.status = options.status;

  const [payables, totalResults] = await Promise.all([
    DairyProviderPayable.find(query)
      .populate('provider', 'name code')
      .sort({ 'period.from': -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    DairyProviderPayable.countDocuments(query),
  ]);

  return { payables, totalResults, page, limit };
};

module.exports = {
  PAYABLE_TRANSITIONS,
  assertTransition,
  generatePayable,
  addAdjustment,
  updateStatus,
  payPayable,
  voidPayable,
  getPayable,
  listPayables,
};
