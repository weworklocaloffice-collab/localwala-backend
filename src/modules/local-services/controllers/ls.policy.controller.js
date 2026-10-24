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
const catchAsync = require('../../../utils/catchAsync');
const pick = require('../../../utils/pick');
const ApiError = require('../../../utils/ApiError');
const Policy = require('../models/localservice.policy.model');
const { recordAudit } = require('../services/localservice.audit.service');

const POLICY_TRANSITIONS = {
  draft: ['active', 'inactive'],
  active: ['inactive', 'draft'],
  inactive: ['active', 'draft'],
  expired: ['draft'],
};

const createPolicy = catchAsync(async (req, res) => {
  const body = pick(req.body, [
    'code',
    'name',
    'description',
    'categoryKey',
    'subcategoryKey',
    'serviceKey',
    'provider',
    'cancellationCutoffHours',
    'cancellationFee',
    'providerCancellationRefundable',
    'rescheduleCutoffHours',
    'rescheduleCountLimit',
    'quoteExpiryHours',
    'quoteMaxExpiryHours',
    'advanceBookingDays',
    'minNoticeHours',
    'depositPercent',
    'taxPercent',
    'taxLabel',
    'allowedPaymentModes',
    'effectiveFrom',
    'effectiveTo',
  ]);
  const doc = await Policy.create({
    ...body,
    status: 'draft',
    version: 1,
    createdBy: req.user._id,
  });
  await recordAudit(req, {
    event: 'policy.created',
    targetType: 'policy',
    targetId: doc._id,
    details: `Policy ${doc.code} created`,
    metadata: { scope: { categoryKey: doc.categoryKey, serviceKey: doc.serviceKey } },
  });
  res.status(httpStatus.CREATED).send({ policy: doc });
});

const listPolicies = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['status', 'categoryKey', 'subcategoryKey', 'serviceKey', 'code']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  res.status(httpStatus.OK).send(await Policy.paginate(filter, options));
});

const getPolicy = catchAsync(async (req, res) => {
  const doc = await Policy.findById(req.params.id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Policy not found');
  res.status(httpStatus.OK).send({ policy: doc });
});

const updatePolicy = catchAsync(async (req, res) => {
  const doc = await Policy.findById(req.params.id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Policy not found');
  const fields = pick(req.body, [
    'name',
    'description',
    'cancellationCutoffHours',
    'cancellationFee',
    'providerCancellationRefundable',
    'rescheduleCutoffHours',
    'rescheduleCountLimit',
    'quoteExpiryHours',
    'quoteMaxExpiryHours',
    'advanceBookingDays',
    'minNoticeHours',
    'depositPercent',
    'taxPercent',
    'taxLabel',
    'allowedPaymentModes',
    'effectiveFrom',
    'effectiveTo',
  ]);
  for (const field of fields) {
    if (req.body[field] !== undefined) doc[field] = req.body[field];
  }
  doc.updatedBy = req.user._id;
  await doc.save();
  await recordAudit(req, {
    event: 'policy.updated',
    targetType: 'policy',
    targetId: doc._id,
    details: `Policy ${doc.code} updated`,
    metadata: { fields: Object.keys(fields) },
  });
  res.status(httpStatus.OK).send({ policy: doc });
});

/**
 * Activate a policy.
 *
 * Activation creates the NEXT VERSION rather than editing the live row, so a
 * booking created last week is still judged by the policy that was in force
 * when it was created. The old version is retired to `expired`.
 */
const activatePolicy = catchAsync(async (req, res) => {
  const doc = await Policy.findById(req.params.id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Policy not found');
  if (doc.status !== 'draft') {
    throw new ApiError(httpStatus.CONFLICT, `Only a draft can be activated (this one is ${doc.status})`);
  }
  const effectiveFrom = req.body.effectiveFrom ? new Date(req.body.effectiveFrom) : new Date();
  const next = await Policy.create({
    ...doc.toObject(),
    _id: undefined,
    version: (doc.version || 1) + 1,
    status: 'active',
    effectiveFrom,
    effectiveTo: req.body.effectiveTo ? new Date(req.body.effectiveTo) : undefined,
    supersedes: doc._id,
    createdBy: req.user._id,
    updatedBy: req.user._id,
    createdAt: undefined,
    updatedAt: undefined,
  });
  doc.status = 'expired';
  doc.effectiveTo = effectiveFrom;
  doc.updatedBy = req.user._id;
  await doc.save();
  await recordAudit(req, {
    event: 'policy.activated',
    targetType: 'policy',
    targetId: next._id,
    details: `Policy ${next.code} v${next.version} activated`,
    metadata: { supersedes: String(doc._id), version: next.version },
  });
  res.status(httpStatus.OK).send({ policy: next });
});

const transitionPolicy = catchAsync(async (req, res) => {
  const to = req.params.status;
  const doc = await Policy.findById(req.params.id);
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Policy not found');
  const allowed = POLICY_TRANSITIONS[doc.status] || [];
  if (!allowed.includes(to)) {
    throw new ApiError(httpStatus.CONFLICT, `Illegal policy transition ${doc.status} -> ${to}`);
  }
  doc.status = to;
  doc.updatedBy = req.user._id;
  await doc.save();
  await recordAudit(req, {
    event: `policy.${to}`,
    targetType: 'policy',
    targetId: doc._id,
    details: `Policy ${doc.code} moved ${doc.status} -> ${to}`,
    metadata: { note: req.body.note || undefined },
  });
  res.status(httpStatus.OK).send({ policy: doc });
});

module.exports = { createPolicy, listPolicies, getPolicy, updatePolicy, activatePolicy, transitionPolicy, POLICY_TRANSITIONS };
