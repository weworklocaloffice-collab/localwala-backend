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
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');

const createVerification = async ({ subjectType, outlet, chain, product, certificateType, certificateNumber, issuingAuthority, document, issueDate, expiryDate, scope }) => {
  const StoreOrganicVerification = mongoose.model('StoreOrganicVerification');
  return StoreOrganicVerification.create({
    subjectType,
    outlet,
    chain,
    product,
    certificateType,
    certificateNumber,
    issuingAuthority,
    document,
    issueDate,
    expiryDate,
    scope,
    status: 'pending',
  });
};

const reviewVerification = async (verificationId, { status, verifiedBy, note }) => {
  const StoreOrganicVerification = mongoose.model('StoreOrganicVerification');
  const verification = await StoreOrganicVerification.findById(verificationId);
  if (!verification) throw new ApiError(httpStatus.NOT_FOUND, 'Verification not found');

  verification.status = status;
  verification.verifiedBy = verifiedBy;
  verification.verifiedAt = new Date();
  verification.note = note;

  await verification.save();

  if (status === 'approved') {
    await updateBadge(verification);
  }

  return verification;
};

const updateBadge = async (verification) => {
  if (verification.subjectType === 'store') {
    const StoreOutlet = mongoose.model('StoreOutlet');
    const hasValid = await mongoose.model('StoreOrganicVerification').findOne({
      subjectType: 'store',
      outlet: verification.outlet,
      status: 'approved',
      expiryDate: { $gt: new Date() },
    });
    await StoreOutlet.findByIdAndUpdate(verification.outlet, { $set: { isOrganicCertified: !!hasValid } });
  } else if (verification.subjectType === 'product') {
    const ChainProduct = mongoose.model('ChainProduct');
    const hasValid = await mongoose.model('StoreOrganicVerification').findOne({
      subjectType: 'product',
      product: verification.product,
      status: 'approved',
      expiryDate: { $gt: new Date() },
    });
    await ChainProduct.findByIdAndUpdate(verification.product, { $set: { isOrganic: !!hasValid } });
  }
};

const expireCertifications = async () => {
  const StoreOrganicVerification = mongoose.model('StoreOrganicVerification');
  const expired = await StoreOrganicVerification.find({
    status: 'approved',
    expiryDate: { $lte: new Date() },
  });

  for (const cert of expired) {
    cert.status = 'expired';
    await cert.save();
    await updateBadge(cert);
  }

  return { expired: expired.length };
};

const getExpiringSoon = async (days = 30) => {
  const StoreOrganicVerification = mongoose.model('StoreOrganicVerification');
  return StoreOrganicVerification.findExpiringSoon(days);
};

const getVerification = async (verificationId) => {
  const StoreOrganicVerification = mongoose.model('StoreOrganicVerification');
  const verification = await StoreOrganicVerification.findById(verificationId)
    .populate('outlet', 'name outletCode')
    .populate('product', 'name slug')
    .lean();
  if (!verification) throw new ApiError(httpStatus.NOT_FOUND, 'Verification not found');
  return verification;
};

const listVerifications = async ({ subjectType, outlet, product, status, page = 1, limit = 20 }) => {
  const StoreOrganicVerification = mongoose.model('StoreOrganicVerification');
  const filter = {};
  if (subjectType) filter.subjectType = subjectType;
  if (outlet) filter.outlet = outlet;
  if (product) filter.product = product;
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    StoreOrganicVerification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    StoreOrganicVerification.countDocuments(filter),
  ]);

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

module.exports = {
  createVerification,
  reviewVerification,
  expireCertifications,
  getExpiringSoon,
  getVerification,
  listVerifications,
  updateBadge,
};