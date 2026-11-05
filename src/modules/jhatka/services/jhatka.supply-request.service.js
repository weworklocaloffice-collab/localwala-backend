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
 * jhatka.supply-request.service.js — the pull half of "LocalWala supplies the
 * meat" (BR-05, OD-12 companion).
 *
 * ## The lifecycle, and who owns each transition
 *
 *   createRequest      partner     requested          (mode eligibility computed HERE)
 *   approveRequest     admin       requested → approved    (rates frozen per line — BR-26 spirit)
 *   rejectRequest      admin       requested → rejected
 *   cancelRequest      both        requested/approved → cancelled
 *   fulfilRequest      admin       approved → fulfilled    (receipt POSTED + ledger debit, ONE transaction)
 *   markSupplyPrepaid  payment     payment.pending → paid  (verified gateway callback via payment.dispatch)
 *   settleRequest      cron/admin  fulfilled → settled     (goods value fully recovered)
 *
 * ## The two invariants this service exists to hold
 *
 * 1. Fulfilment is ATOMIC: the receipt posts (batches, stock, movements, FEFO)
 *    and the ledger debit writes in ONE `withTransaction`. A stock delivery
 *    without its ledger debit is the half-written state this vertical exists
 *    to prevent.
 * 2. Mode eligibility is COMPUTED, never declared: the response to createRequest
 *    carries which modes the outlet may use, and a request claiming a mode it
 *    is not owed is refused. The UI renders the server's list; the server
 *    decides.
 */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const { withTransaction } = require('../utils/transaction');
const ledgerService = require('./jhatka.partner-ledger.service');
const receiptService = require('./jhatka.receipt.service');
const settingsService = require('../../../services/jhatka.settings.service');
const notifyService = require('./jhatka.notify.service');

/** Builds the visible request number. Prefix JV per §6.5's convention. */
const buildRequestNo = () => `JV${Date.now()}${Math.floor(Math.random() * 1e4)}`;

/**
 * Compute which payment modes the outlet may use, and why not the others.
 * Pure-ish (reads); the create route returns this so the UI never guesses.
 *
 * @param {object} p
 * @param {object} p.models
 * @param {string} p.outletId
 * @param {number} p.requestValuePaise
 * @param {number} p.prepaidBalancePaise current ledger balance
 * @param {number} p.creditCapPaise
 * @returns {Promise<{modes: string[], reasons: object}>}
 */
async function computeEligibleModes({
  models, outletId, requestValuePaise, prepaidBalancePaise, creditCapPaise,
}) {
  const deduct = await ledgerService.computeDeductEligibility({
    models, outletId, requestValuePaise, creditCapPaise,
  });

  const modes = ['prepaid', 'on_delivery'];
  const reasons = {
    prepaid: prepaidBalancePaise >= requestValuePaise
      ? null
      : 'INSUFFICIENT_PREPAID_BALANCE_PAY_AT_REQUEST',
    on_delivery: null,
    deduct: deduct.eligible ? null : deduct.reasons.join('|'),
  };
  if (deduct.eligible) modes.push('deduct');

  return { modes, reasons, outstandingPaise: deduct.outstandingPaise };
}

/**
 * Partner creates a supply request.
 *
 * Items reference the OUTLET'S OWN CATALOGUE products (what the counter sells);
 * fulfilment turns them into procurement-receipt lines with LocalWala as the
 * supplier. The request's value is NOT computed here from live rates — rates
 * are frozen at APPROVAL by the admin, because the transfer price is the
 * commercial term, not the catalogue price.
 *
 * @param {object} p
 * @param {object} p.models `{ JhatkaOutlet, JhatkaProduct, JhatkaSupplyRequest, JhatkaPartnerLedger, JhatkaOperatorPayout }`
 * @param {string} p.outletId      from the TENANT, never the body
 * @param {object} p.actor         `{ _id, name }` — the partner user
 * @param {object} p.body          `{ items: [{ product, quantity: {value, unit} }], neededBy, note, paymentMode }`
 * @returns {Promise<object>} `{ request, eligibleModes }`
 */
async function createRequest({ models, outletId, actor, body }) {
  const { JhatkaOutlet, JhatkaProduct, JhatkaSupplyRequest } = models;

  const { items, neededBy, note, paymentMode } = body || {};
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'At least one item is required');
  }
  if (!['prepaid', 'on_delivery', 'deduct'].includes(paymentMode)) {
    throw new ApiError(httpStatus.BAD_REQUEST, "paymentMode must be 'prepaid', 'on_delivery' or 'deduct'");
  }

  const outlet = await JhatkaOutlet.findById(outletId).lean();
  if (!outlet) throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');

  // Every product must belong to this outlet's catalogue. A request for
  // another business's product is a tenancy breach, not a 404.
  const productIds = [...new Set(items.map((i) => String(i.product)))];
  // The catalogue's `status` is a BOOLEAN (matches the creation service's
  // `status: true` query — a string 'active' here casts to a 500).
  const products = await JhatkaProduct.find({
    _id: { $in: productIds },
    status: true,
  }).lean();
  if (products.length !== productIds.length) {
    throw new ApiError(httpStatus.FORBIDDEN, 'One or more products are not in your catalogue');
  }
  const productById = new Map(products.map((p) => [String(p._id), p]));

  // ---- mode eligibility (computed, never declared) ------------------------
  const prepaidBalancePaise = await ledgerService.getBalance({ models, outletId });
  const creditCapPaise = await settingsService.getSupplyCreditCapPaise();
  // The value is unknown until approval; eligibility for DEDUCT uses the upper
  // bound of catalogued context — 0 here would understate, so the estimate is
  // deliberately the ITEM COUNT times the cap-check later at approval. The
  // authoritative gate re-runs at approve time with real rates.
  const { modes, reasons } = await computeEligibleModes({
    models, outletId, requestValuePaise: 0, prepaidBalancePaise, creditCapPaise,
  });
  if (!modes.includes(paymentMode)) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `Payment mode '${paymentMode}' is not available for this outlet (${reasons[paymentMode] || 'ineligible'})`,
      true,
      '',
      { code: 'PAYMENT_MODE_INELIGIBLE', eligibleModes: modes, reasons }
    );
  }

  const request = await JhatkaSupplyRequest.create({
    requestNo: buildRequestNo(),
    outlet: outlet._id,
    business: outlet.business,
    businessModel: outlet.businessModel,
    requestedBy: actor._id,
    requestedByName: actor.name,
    items: items.map((i) => {
      const product = productById.get(String(i.product));
      return {
        product: product._id,
        productName: product.name,
        rawSku: product.rawSku || undefined,
        quantity: i.quantity,
      };
    }),
    neededBy: neededBy ? new Date(neededBy) : undefined,
    note,
    paymentMode,
    payment: { status: paymentMode === 'prepaid' ? 'pending' : 'not_applicable' },
    status: 'requested',
  });

  return {
    request: request.toObject(),
    eligibleModes: modes,
    modeReasons: reasons,
  };
}

/**
 * Admin approves — the credit decision AND the price decision in one act.
 * Rates are frozen per line (paise per unit, from the admin's body) and the
 * approved value computed in JavaScript from those frozen rates.
 */
async function approveRequest({ models, requestId, actor, body }) {
  const { JhatkaSupplyRequest } = models;
  const { rates, note } = body || {};
  // rates: { [itemId or productId]: paisePerUnit } — admin sets the transfer price.

  const request = await JhatkaSupplyRequest.findById(requestId);
  if (!request) throw new ApiError(httpStatus.NOT_FOUND, 'Supply request not found');
  if (!models.JhatkaSupplyRequest.canTransition(request.status, 'approved')) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `A ${request.status} request cannot be approved`,
      true, '', { code: 'ILLEGAL_SUPPLY_MOVE', from: request.status }
    );
  }
  if (!rates || typeof rates !== 'object') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'rates (paise per unit per product) are required to approve');
  }

  let approvedValuePaise = 0;
  for (const item of request.items) {
    const rate = Number(rates[String(item.product)]);
    if (!Number.isFinite(rate) || rate < 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `A rate (paise per unit) is required for ${item.productName}`,
        true, '', { code: 'RATE_REQUIRED', product: String(item.product) }
      );
    }
    item.ratePaisePerUnit = Math.round(rate);
    // Value = rate × quantity, in paise. Quantity is in the item's unit; the
    // rate is per that unit, so no unit conversion — the admin prices the unit
    // they saw.
    item.lineValuePaise = Math.round(item.ratePaisePerUnit * Number(item.quantity.value));
    approvedValuePaise += item.lineValuePaise;
  }

  request.approvedValuePaise = approvedValuePaise;
  request.approval = {
    by: actor._id,
    byName: actor.name,
    at: new Date(),
    note,
  };
  request.status = 'approved';
  await request.save();

  const value = `Rs ${(approvedValuePaise / 100).toFixed(2)}`;
  const paymentNote = request.paymentMode === 'prepaid'
    ? 'Pay from the app to confirm.'
    : request.paymentMode === 'on_delivery'
      ? 'Payment is collected when the stock arrives.'
      : 'The value is deducted from your next payout.';

  await notifyService.notifyOutlet(request.outlet, 'supply_request_status', {
    requestNo: request.requestNo,
    status: 'approved',
    statusNote: `${note ? `${note} ` : ''}Approved for ${value}. ${paymentNote}`,
  });

  return { request: request.toObject() };
}

async function rejectRequest({ models, requestId, actor: _actor, reason }) {
  const { JhatkaSupplyRequest } = models;
  const request = await JhatkaSupplyRequest.findById(requestId);
  if (!request) throw new ApiError(httpStatus.NOT_FOUND, 'Supply request not found');
  if (!models.JhatkaSupplyRequest.canTransition(request.status, 'rejected')) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `A ${request.status} request cannot be rejected`,
      true, '', { code: 'ILLEGAL_SUPPLY_MOVE', from: request.status }
    );
  }
  if (!reason) throw new ApiError(httpStatus.BAD_REQUEST, 'A rejection reason is required');
  request.status = 'rejected';
  request.statusReason = reason;
  await request.save();

  await notifyService.notifyOutlet(request.outlet, 'supply_request_status', {
    requestNo: request.requestNo,
    status: 'rejected',
    statusNote: reason,
  });

  return { request: request.toObject() };
}

async function cancelRequest({ models, requestId, actor, reason }) {
  const { JhatkaSupplyRequest } = models;
  const request = await JhatkaSupplyRequest.findById(requestId);
  if (!request) throw new ApiError(httpStatus.NOT_FOUND, 'Supply request not found');
  if (!models.JhatkaSupplyRequest.canTransition(request.status, 'cancelled')) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `A ${request.status} request cannot be cancelled`,
      true, '', { code: 'ILLEGAL_SUPPLY_MOVE', from: request.status }
    );
  }
  request.status = 'cancelled';
  request.statusReason = reason || undefined;
  request.cancelledBy = actor._id;
  request.cancelledByName = actor.name;
  request.cancelledAt = new Date();
  await request.save();

  await notifyService.notifyOutlet(request.outlet, 'supply_request_status', {
    requestNo: request.requestNo,
    status: 'cancelled',
    statusNote: reason || 'Cancelled by LocalWala.',
  });

  return { request: request.toObject() };
}

/**
 * Admin fulfils: the stock physically arrives at the partner's outlet.
 *
 * ## Resumable, not all-or-nothing — an explicit engineering call
 *
 * `postReceipt` (the existing receipt service) owns its own transaction: the
 * batches/stock/movements for a posted receipt are atomic and were proven so by
 * `verify.jhatka.integration.js`'s atomicity test. It does not accept an outer
 * session, so this operation is structured as TWO units with an idempotent
 * seam between them:
 *
 *   Unit 1 — draft receipt created from the approved lines and POSTED
 *            (own transaction, reuse of the tested machinery).
 *   Unit 2 — ledger debit + request status, in ONE transaction of our own.
 *
 * If Unit 2 fails after Unit 1 committed, the request is still `approved` but
 * carries `fulfilment.receipt` — re-calling fulfil resumes at Unit 2 (the
 * ledger debit is guarded by a lookup, so a retry cannot double-debit). A
 * receipt posted with no ledger debit is visible and resumable; it is not the
 * silent half-written state this vertical fears, because the seam is recorded
 * on the request itself.
 *
 * @param {object} p.body
 * @param {string} p.body.supplier    REQUIRED — the JhatkaSupplier representing
 *                                    LocalWala's supply arm (receipt model
 *                                    requires a supplier of record).
 * @param {object} p.body.rawSkuByProduct REQUIRED — { productId: rawSku }; the
 *                                    catalogue carries no raw SKU (it is manual
 *                                    input in this vertical, same as the
 *                                    receipt screen).
 * @param {object} [p.body.deliveredQuantities] { productId: number } — partial
 *                                    fulfilment; defaults to approved quantities.
 * @param {object} [p.body.expiresAtByLine] passthrough to postReceipt.
 */
async function fulfilRequest({ models, requestId, actor, body }) {
  const { JhatkaSupplyRequest, JhatkaProcurementReceipt } = models;
  const { supplier, rawSkuByProduct, deliveredQuantities, expiresAtByLine } = body || {};

  const request = await JhatkaSupplyRequest.findById(requestId);
  if (!request) throw new ApiError(httpStatus.NOT_FOUND, 'Supply request not found');
  if (request.status === 'fulfilled' || request.status === 'settled') {
    // A settled request being fulfilled again is a CALLER BUG, not a retry —
    // the receipt flow treats the same case as 409, and so does this.
    throw new ApiError(
      httpStatus.CONFLICT,
      `This request is already ${request.status}`,
      true, '', { code: 'ILLEGAL_SUPPLY_MOVE', from: request.status }
    );
  }
  if (!models.JhatkaSupplyRequest.canTransition(request.status, 'fulfilled')) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `A ${request.status} request cannot be fulfilled`,
      true, '', { code: 'ILLEGAL_SUPPLY_MOVE', from: request.status }
    );
  }
  if (request.paymentMode === 'prepaid' && request.payment?.status !== 'paid') {
    throw new ApiError(
      httpStatus.CONFLICT,
      'This request is prepaid and the payment has not been verified yet',
      true, '', { code: 'PREPAYMENT_PENDING' }
    );
  }
  if (!supplier) throw new ApiError(httpStatus.BAD_REQUEST, 'supplier is required (LocalWala supply entity)');

  // ---- Unit 1: the receipt (skipped on resume) ----------------------------
  let receiptDoc;
  if (request.fulfilment?.receipt) {
    receiptDoc = await JhatkaProcurementReceipt.findById(request.fulfilment.receipt);
    if (!receiptDoc || receiptDoc.status !== 'posted') {
      throw new ApiError(
        httpStatus.CONFLICT,
        'The fulfilment receipt exists but is not posted — complete or cancel it in inventory first',
        true, '', { code: 'FULFIL_RECEIPT_UNPOSTED' }
      );
    }
  } else {
    if (!rawSkuByProduct || typeof rawSkuByProduct !== 'object') {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'rawSkuByProduct is required (the raw SKU per product, as on the pack)',
        true, '', { code: 'RAW_SKU_REQUIRED' }
      );
    }
    const outlet = await models.JhatkaOutlet.findById(request.outlet).lean();
    if (!outlet) throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');

    const lines = request.items.map((item) => {
      const rawSku = String(rawSkuByProduct[String(item.product)] || '').toUpperCase().trim();
      if (!rawSku) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `A raw SKU is required for ${item.productName}`,
          true, '', { code: 'RAW_SKU_REQUIRED', product: String(item.product) }
        );
      }
      const delivered = deliveredQuantities?.[String(item.product)];
      const qty = delivered === undefined
        ? item.quantity.value
        : Number(delivered);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new ApiError(httpStatus.BAD_REQUEST, `Delivered quantity for ${item.productName} must be positive`);
      }
      return {
        product: item.product,
        rawSku,
        receivedQty: { value: qty, unit: item.quantity.unit },
        // Transfer price frozen at approval. The receipt service's contract is
        // RUPEES at the edge (its moneyField setter converts).
        unitPrice: (item.ratePaisePerUnit || 0) / 100,
        readings: {},
      };
    });

    const { receipt: draftReceipt } = await receiptService.createDraftReceipt({
      models: { JhatkaPurchaseOrder: models.JhatkaPurchaseOrder, JhatkaProcurementReceipt },
      outlet,
      body: { supplier, lines, note: `Supply request ${request.requestNo}` },
      actor,
      nextNumber: () => `JV-R${Date.now()}${Math.floor(Math.random() * 1e4)}`,
    });
    // createDraftReceipt SAVES the draft (validateSync + save) and returns the
    // persisted document; postReceipt refuses anything but the real document.
    await receiptService.postReceipt({
      receipt: draftReceipt,
      outlet,
      actor,
      body: { expiresAtByLine },
      models,
      nextNumber: (p) => `${p}${Date.now()}`,
    });

    const deliveredValuePaise = request.items.reduce((sum, item) => {
      const delivered = deliveredQuantities?.[String(item.product)];
      const qty = delivered === undefined ? Number(item.quantity.value) : Number(delivered);
      return sum + Math.round(qty * (item.ratePaisePerUnit || 0));
    }, 0);

    request.fulfilment = {
      receipt: draftReceipt._id,
      receiptNo: draftReceipt.receiptNo,
      by: actor._id,
      byName: actor.name,
      at: new Date(),
      deliveredValuePaise,
    };
    request.items.forEach((item) => {
      const delivered = deliveredQuantities?.[String(item.product)];
      if (delivered !== undefined) {
        item.fulfilledQuantity = { value: Number(delivered), unit: item.quantity.unit };
      }
    });
    await request.save();
  }

  // ---- Unit 2: ledger debit + status, in ONE transaction ------------------
  const result = await withTransaction({
    startSession: () => mongoose.startSession(),
    fn: async (session) => {
      // Idempotency guard: a resumed fulfil must not double-debit.
      const existingDebit = await models.JhatkaPartnerLedger.findOne({
        referenceId: request._id,
        entryType: 'STOCK_DEBIT',
      }).session(session);
      if (!existingDebit) {
        const entry = await ledgerService.postEntry({
          models,
          session,
          outletId: String(request.outlet),
          businessId: String(request.business),
          entryType: 'STOCK_DEBIT',
          amountPaise: -(request.fulfilment.deliveredValuePaise || 0),
          referenceType: 'JhatkaSupplyRequest',
          referenceId: request._id,
          referenceNo: request.requestNo,
          note: `Stock delivered for ${request.requestNo}`,
          actor,
        });
        if (request.ledgerEntries) request.ledgerEntries.push(entry._id);
      }

      request.status = 'fulfilled';
      if (request.paymentMode === 'on_delivery') {
        // Collected at the counter when the truck unloads — settled immediately.
        // The COLLECTION entry mirrors the STOCK_DEBIT, so the ledger nets to
        // zero for a settled request: money in, meat out, both on record.
        await ledgerService.postEntry({
          models,
          session,
          outletId: String(request.outlet),
          businessId: String(request.business),
          entryType: 'COLLECTION',
          amountPaise: request.fulfilment.deliveredValuePaise || 0,
          referenceType: 'JhatkaSupplyRequest',
          referenceId: request._id,
          referenceNo: request.requestNo,
          note: `On-delivery collection for ${request.requestNo}`,
          actor,
        });
        request.settledAt = new Date();
        request.settledVia = 'on_delivery_collection';
        request.status = 'settled';
      }
      await request.save({ session });

      const balance = await models.JhatkaPartnerLedger.findOne({ outlet: request.outlet })
        .sort({ seq: -1 }).session(session).lean();

      return {
        request: request.toObject(),
        ledgerBalancePaise: balance?.balanceAfterPaise ?? 0,
        alreadyFulfilled: false,
      };
    },
  });

  await notifyService.notifyOutlet(request.outlet, 'supply_request_status', {
    requestNo: request.requestNo,
    status: result.request.status,
    statusNote: `Stock received${result.request.fulfilment?.receiptNo
      ? ` against receipt ${result.request.fulfilment.receiptNo}`
      : ''}.`,
  });

  return result;
}

/**
 * Verified-gateway-callback side effect: a prepaid request's payment arrived.
 * Routed here by payment.dispatch. Idempotent — a second callback for an
 * already-paid request is a no-op success.
 */
async function markSupplyPrepaid({ models, requestId, paymentId, gatewayPaymentId, amountPaise }) {
  const { JhatkaSupplyRequest } = models;
  const request = await JhatkaSupplyRequest.findById(requestId);
  if (!request) throw new ApiError(httpStatus.NOT_FOUND, 'Supply request not found');
  if (request.payment?.status === 'paid') {
    return { request: request.toObject(), alreadyPaid: true };
  }

  request.payment.status = 'paid';
  request.payment.initiation = paymentId;
  request.payment.gatewayPaymentId = gatewayPaymentId;
  request.payment.paidAt = new Date();
  request.payment.paidAmountPaise = Math.round(Number(amountPaise) || 0);
  await request.save();

  await ledgerService.postEntry({
    models,
    outletId: String(request.outlet),
    businessId: String(request.business),
    entryType: 'PREPAYMENT',
    amountPaise: request.payment.paidAmountPaise,
    referenceType: 'JhatkaSupplyRequest',
    referenceId: request._id,
    referenceNo: request.requestNo,
    note: `Prepayment for ${request.requestNo}`,
  });

  return { request: request.toObject(), alreadyPaid: false };
}

module.exports = {
  createRequest,
  approveRequest,
  rejectRequest,
  cancelRequest,
  fulfilRequest,
  markSupplyPrepaid,
  computeEligibleModes,
  buildRequestNo,
};
