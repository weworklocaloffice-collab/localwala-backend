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
  JhatkaOutlet,
  JhatkaProcurementReceipt,
  JhatkaSupplier,
  JhatkaSupplierPayable,
} = require('../../../models');
const ApiError = require('../../../utils/ApiError');
const { withOptionalTransaction } = require('../../../utils/optionalTransaction');
const { computeTds, payoutDecision } = require('../utils/commercial.arithmetic');

const payableNoPattern = (year) => new RegExp(`^SP-${year}-`);

const startOfDay = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const nextPayableNo = async () => {
  const year = new Date().getFullYear();
  const latest = await JhatkaSupplierPayable.findOne({ payableNo: payableNoPattern(year) })
    .sort({ payableNo: -1 })
    .select('payableNo')
    .lean();
  const sequence = latest?.payableNo ? parseInt(latest.payableNo.split('-')[2], 10) : 0;
  return `SP-${year}-${String((Number(sequence) || 0) + 1).padStart(4, '0')}`;
};

const assertTransition = (payable, nextStatus) => {
  if (!JhatkaSupplierPayable.canTransition(payable.status, nextStatus)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Illegal payable transition: ${payable.status} -> ${nextStatus}`
    );
  }
};

const loadPayable = async (payableId, session = null) => {
  const query = JhatkaSupplierPayable.findById(payableId);
  if (session) query.session(session);
  const payable = await query;
  if (!payable) throw new ApiError(httpStatus.NOT_FOUND, 'Payable not found');
  return payable;
};

const receiptIdsOf = (payable) => [
  ...new Set((payable.receipts || []).map((receipt) => String(receipt.intake))),
];

const receiptIdsOfClaimed = async (payable, session = null) => {
  const query = JhatkaProcurementReceipt.find({
    _id: { $in: receiptIdsOf(payable) },
    'lines.payableStatement': payable._id,
  }).select('_id');
  if (session) query.session(session);
  const receipts = await query.lean();
  return receipts.map((receipt) => receipt._id);
};

const releaseClaimedLines = async (payable, session = null) => {
  const receiptIds = await receiptIdsOfClaimed(payable, session);
  if (!receiptIds.length) return 0;
  const options = {
    arrayFilters: [{ 'line.payableStatement': payable._id, 'line.payability': 'claimed' }],
  };
  if (session) options.session = session;
  const result = await JhatkaProcurementReceipt.updateMany(
    { _id: { $in: receiptIds }, 'lines.payableStatement': payable._id },
    {
      $set: {
        'lines.$[line].payability': 'pending',
        'lines.$[line].payableStatement': null,
        'lines.$[line].payabilitySettledAt': null,
      },
    },
    options
  );
  return result.modifiedCount || 0;
};

const settleClaimedLines = async (payable, settledAt, session = null) => {
  const receiptIds = await receiptIdsOfClaimed(payable, session);
  const updated = [];
  try {
    for (const receiptId of receiptIds) {
      const options = {
        arrayFilters: [{ 'line.payableStatement': payable._id, 'line.payability': 'claimed' }],
      };
      if (session) options.session = session;
      const result = await JhatkaProcurementReceipt.updateOne(
        {
          _id: receiptId,
          lines: {
            $elemMatch: { payableStatement: payable._id, payability: 'claimed' },
          },
        },
        {
          $set: {
            'lines.$[line].payability': 'paid',
            'lines.$[line].payabilitySettledAt': settledAt,
          },
        },
        options
      );
      if (!result.modifiedCount) {
        throw new ApiError(
          httpStatus.CONFLICT,
          'A receipt line is no longer available to settle this payable'
        );
      }
      updated.push(receiptId);
    }
  } catch (error) {
    if (!session && updated.length) {
      await JhatkaProcurementReceipt.updateMany(
        { _id: { $in: updated }, 'lines.payableStatement': payable._id },
        {
          $set: {
            'lines.$[line].payability': 'claimed',
            'lines.$[line].payabilitySettledAt': null,
          },
        },
        {
          arrayFilters: [
            { 'line.payableStatement': payable._id, 'line.payability': 'paid' },
          ],
        }
      );
    }
    throw error;
  }
};

const buildStatement = (receipts) => {
  const lines = [];
  const claims = [];
  let receiptCount = 0;
  let acceptedQty = 0;
  let rejectedQty = 0;
  let grossAmount = 0;
  let rejectionDeduction = 0;

  for (const receipt of receipts) {
    const claimable = receipt.claimableLines();
    if (!claimable.length) continue;
    receiptCount += 1;
    claims.push({ intake: receipt._id, lineIds: claimable.map((line) => line._id) });

    for (const line of claimable) {
      const accepted = Number(line.acceptedQty?.value ?? line.receivedQty?.value ?? 0);
      const rejected = Number(line.rejectedQty?.value || 0);
      const unit = line.acceptedQty?.unit || line.receivedQty?.unit || line.unit;
      const unitPrice = roundMoney(line.unitPrice);
      const amount = roundMoney(line.amount ?? unitPrice * accepted);
      const rejectedValue = roundMoney(line.rejectedValue || unitPrice * rejected);

      lines.push({
        intake: receipt._id,
        receiptNo: receipt.receiptNo,
        receivedAt: receipt.receivedAt,
        product: line.product,
        rawSku: line.rawSku,
        acceptedQty: accepted,
        rejectedQty: rejected,
        unit,
        unitPrice,
        amount,
      });

      acceptedQty += accepted;
      rejectedQty += rejected;
      grossAmount += amount;
      rejectionDeduction += rejectedValue;
    }
  }

  return {
    lines,
    claims,
    receiptCount,
    lineCount: lines.length,
    acceptedQty: roundMoney(acceptedQty),
    rejectedQty: roundMoney(rejectedQty),
    grossAmount: roundMoney(grossAmount),
    rejectionDeduction: roundMoney(rejectionDeduction),
  };
};

const generatePayable = async (params) => {
  const from = startOfDay(params.from);
  const to = startOfDay(params.to);
  if (!from || !to) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A valid period start and end are required');
  }
  if (!(to > from)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'The period end must be after its start');
  }

  const [outlet, supplier] = await Promise.all([
    JhatkaOutlet.findById(params.outlet).select('business name').lean(),
    JhatkaSupplier.findById(params.supplier).select('code name').lean(),
  ]);
  if (!outlet) throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');
  if (!supplier) throw new ApiError(httpStatus.NOT_FOUND, 'Supplier not found');

  const existing = await JhatkaSupplierPayable.findOne({
    outlet: outlet._id,
    supplier: supplier._id,
    'period.from': from,
    status: { $ne: 'void' },
  }).select('payableNo status');
  if (existing) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `A payable already covers this period (${existing.payableNo}, ${existing.status})`
    );
  }

  const receipts = await JhatkaProcurementReceipt.find({
    outlet: outlet._id,
    business: outlet.business,
    supplier: supplier._id,
    status: 'posted',
    receivedAt: { $gte: from, $lt: to },
    lines: {
      $elemMatch: {
        payability: 'pending',
        qualityStatus: { $in: ['accepted', 'partially_accepted'] },
      },
    },
  }).sort({ receivedAt: 1 });
  if (!receipts.length) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'No accepted, unsettled receipts for this supplier and outlet in that period'
    );
  }

  const statement = buildStatement(receipts);
  if (!statement.lines.length || statement.grossAmount <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'The period has no payable accepted value');
  }

  const tds = computeTds(
    statement.grossAmount,
    params.tdsApplicable === true,
    params.tdsRatePercent
  );
  const decision = payoutDecision(tds.netPayout, 0);
  if (!decision.shouldPay) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `The period is not payable: ${decision.reason}`
    );
  }

  try {
    return await withOptionalTransaction(async (session) => {
      const payable = new JhatkaSupplierPayable({
        payableNo: await nextPayableNo(),
        outlet: outlet._id,
        business: outlet.business,
        supplier: supplier._id,
        supplierName: supplier.name,
        period: {
          from,
          to,
          label:
            params.label ||
            `${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`,
        },
        totals: {
          receiptCount: statement.receiptCount,
          lineCount: statement.lineCount,
          acceptedQty: statement.acceptedQty,
          rejectedQty: statement.rejectedQty,
          grossAmount: statement.grossAmount,
          rejectionDeduction: statement.rejectionDeduction,
          adjustmentsTotal: 0,
          amountPaid: 0,
          netAmount: statement.grossAmount,
        },
        receipts: statement.lines,
        status: 'draft',
        payoutMethod: params.payoutMethod || 'bank',
        tdsApplicable: params.tdsApplicable === true,
        tdsRatePercent: params.tdsApplicable === true ? Number(params.tdsRatePercent) || 0 : 0,
        tdsAmount: tds.tdsAmount,
        netPayout: tds.netPayout,
        notes: params.notes,
      });

      await payable.save(session ? { session } : {});

      try {
        for (const claim of statement.claims) {
          for (const lineId of claim.lineIds) {
            const options = {
              arrayFilters: [{ 'line._id': lineId, 'line.payability': 'pending' }],
            };
            if (session) options.session = session;
            const result = await JhatkaProcurementReceipt.updateOne(
              {
                _id: claim.intake,
                business: outlet.business,
                supplier: supplier._id,
                status: 'posted',
                lines: {
                  $elemMatch: { _id: lineId, payability: 'pending' },
                },
              },
              {
                $set: {
                  'lines.$[line].payability': 'claimed',
                  'lines.$[line].payableStatement': payable._id,
                },
              },
              options
            );
            if (!result.modifiedCount) {
              throw new ApiError(
                httpStatus.CONFLICT,
                'Some receipt lines were claimed by another statement'
              );
            }
          }
        }
      } catch (error) {
        if (!session) {
          await releaseClaimedLines(payable);
          payable.status = 'void';
          payable.statusReason = 'Could not claim every receipt line';
          payable.voidedAt = new Date();
          await payable.save();
        }
        throw error;
      }

      return payable;
    });
  } catch (error) {
    if (error?.code === 11000) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'A payable already covers this outlet, supplier and period'
      );
    }
    throw error;
  }
};

const approvePayable = async (payableId, actor, input = {}) => {
  const payable = await loadPayable(payableId);
  assertTransition(payable, 'approved');
  payable.status = 'approved';
  payable.approvedAt = new Date();
  payable.approvedBy = actor?._id;
  payable.approvedByName = actor?.name;
  if (input.notes !== undefined) payable.notes = input.notes;
  await payable.save();
  return payable;
};

const disputePayable = async (payableId, reason) => {
  const payable = await loadPayable(payableId);
  assertTransition(payable, 'disputed');
  payable.status = 'disputed';
  payable.statusReason = reason;
  await payable.save();
  return payable;
};

const payPayable = async (payableId, input) =>
  withOptionalTransaction(async (session) => {
    const payable = await loadPayable(payableId, session);
    assertTransition(payable, 'paid');

    const decision = payoutDecision(payable.netPayout, 0);
    if (!decision.shouldPay) {
      throw new ApiError(httpStatus.BAD_REQUEST, `The payable is not payable: ${decision.reason}`);
    }

    const settledAt = new Date();
    await settleClaimedLines(payable, settledAt, session);

    payable.totals.amountPaid = decision.amount;
    payable.status = 'paid';
    payable.paidAt = settledAt;
    payable.paymentReference = input.paymentReference;
    if (input.notes !== undefined) payable.notes = input.notes;
    await payable.save(session ? { session } : {});
    return payable;
  });

const voidPayable = async (payableId, actor, reason) =>
  withOptionalTransaction(async (session) => {
    const payable = await loadPayable(payableId, session);
    assertTransition(payable, 'void');
    await releaseClaimedLines(payable, session);
    payable.status = 'void';
    payable.statusReason = reason;
    payable.voidedAt = new Date();
    payable.voidedBy = actor?._id;
    payable.voidedByName = actor?.name;
    await payable.save(session ? { session } : {});
    return payable;
  });

module.exports = {
  generatePayable,
  approvePayable,
  disputePayable,
  payPayable,
  voidPayable,
};
