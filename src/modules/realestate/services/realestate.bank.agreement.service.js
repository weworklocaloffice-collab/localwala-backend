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

const RealEstateBankAgreement = require('../models/realestate.bank.agreement.model');
const ledgerService = require('./realestate.ledger.service');

/**
 * Bank agreement service — versioned commission terms.
 * On disbursement, resolves the ACTIVE agreement and records the
 * bank commission: REVENUE → LOCALWALA, party BANK (plan §5.10).
 */

async function createAgreement(data) {
  const latest = await RealEstateBankAgreement.findOne({ bank: data.bank }).sort({ version: -1 }).lean();
  return RealEstateBankAgreement.create({ ...data, version: (latest ? latest.version : 0) + 1 });
}

const UPDATABLE_AGREEMENT_FIELDS = [
  'commissionType',
  'rate',
  'calculationBasis',
  'minLoan',
  'maxLoan',
  'effectiveFrom',
  'effectiveTo',
  'settlementTerms',
  'offerVisibleToCustomer',
];

/**
 * Admin: edit a DRAFT agreement in place. ACTIVE rows are immutable —
 * new terms are a new version (POST), never an edit, so disbursements
 * already recorded keep the terms they were computed under.
 */
async function updateDraftAgreement(id, patch = {}) {
  const doc = await RealEstateBankAgreement.findById(id);
  if (!doc) throw new Error('Bank agreement not found.');
  if (doc.status !== 'DRAFT') throw new Error('Only DRAFT agreements can be edited — create a new version instead.');
  for (const k of UPDATABLE_AGREEMENT_FIELDS) {
    if (patch[k] !== undefined) doc[k] = patch[k];
  }
  await doc.save();
  return doc.toObject({ getters: true });
}

/**
 * Admin: activate a DRAFT version. Exactly one ACTIVE row per bank —
 * competing ACTIVE rows retire (EXPIRED, effectiveTo = now) in the
 * same call. Activation is separate from approval by design.
 */
async function activateAgreement(id) {
  const doc = await RealEstateBankAgreement.findById(id);
  if (!doc) throw new Error('Bank agreement not found.');
  if (doc.status !== 'DRAFT') throw new Error('Only DRAFT agreements can be activated.');
  await RealEstateBankAgreement.updateMany(
    { bank: doc.bank, status: 'ACTIVE', _id: { $ne: doc._id } },
    { $set: { status: 'EXPIRED', effectiveTo: new Date() } }
  );
  doc.status = 'ACTIVE';
  await doc.save();
  return doc.toObject({ getters: true });
}

async function expireAgreement(id) {
  const doc = await RealEstateBankAgreement.findById(id);
  if (!doc) throw new Error('Bank agreement not found.');
  doc.status = 'EXPIRED';
  doc.effectiveTo = new Date();
  await doc.save();
  return doc.toObject({ getters: true });
}

async function resolveActiveAgreement(bankId, at = new Date()) {
  const agreement = await RealEstateBankAgreement.findOne({
    bank: bankId,
    status: 'ACTIVE',
    effectiveFrom: { $lte: at },
    $and: [{ $or: [{ effectiveTo: null }, { effectiveTo: { $gt: at } }] }],
  }).sort({ version: -1 });
  if (!agreement) throw new Error('No ACTIVE bank agreement for this bank.');
  return agreement;
}

async function recordBankCommission(
  { bankId, sanctionedAmount = 0, disbursedAmount = 0, loanApplicationId },
  session = null
) {
  const agreement = await resolveActiveAgreement(bankId);
  const basis =
    agreement.calculationBasis === 'SANCTION_AMOUNT' ? sanctionedAmount : disbursedAmount;
  if (!(basis > 0)) {
    throw new Error(
      `Bank commission basis must be positive (calculationBasis ${agreement.calculationBasis}).`
    );
  }
  const amount = Number(((basis * agreement.rate) / 100).toFixed(2));
  const entry = await ledgerService.record(
    {
      eventType: 'BANK_LOAN_COMMISSION',
      accountType: 'REVENUE',
      direction: 'CREDIT',
      amount,
      partyType: 'BANK',
      party: bankId,
      sourceModel: 'RealEstateLoanApplication',
      sourceId: loanApplicationId,
      narration: `Bank commission for application ${loanApplicationId}`,
      // Frozen terms (BR-15): rate, basis and agreement version as
      // approved — later agreement edits must not restate this row.
      metadata: {
        agreementId: agreement._id,
        agreementVersion: agreement.version,
        rate: agreement.rate,
        calculationBasis: agreement.calculationBasis,
      },
    },
    session
  );
  return { agreement, amount, entry };
}

const realEstateBankAgreementService = {
  createAgreement,
  updateDraftAgreement,
  UPDATABLE_AGREEMENT_FIELDS,
  activateAgreement,
  expireAgreement,
  resolveActiveAgreement,
  recordBankCommission,
};

module.exports = realEstateBankAgreementService;
