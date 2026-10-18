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

const RealEstateBank = require('../models/realestate.bank.model');
const RealEstateBankMember = require('../models/realestate.bank.member.model');

/**
 * Bank service — banks + members (portal users).
 * A bank sees only its own loan leads (plan §13.3); scoping by
 * `bank` happens in the loan service, using membership resolved
 * here from the token user.
 */

async function createBank({ name, code }) {
  return RealEstateBank.create({ name, code, status: 'ACTIVE' });
}

async function addMember({ user, bank, designation = '' }) {
  return RealEstateBankMember.create({ user, bank, designation, status: 'ACTIVE' });
}

const UPDATABLE_BANK_FIELDS = ['name', 'contactEmail', 'contactPhone', 'status'];

/**
 * Admin: edit bank contact details or lifecycle status
 * (ACTIVE/SUSPENDED/CLOSED). `code` is immutable — agreements and
 * offers key off the bank id, and the code is the human stable key.
 */
async function updateBank(bankId, patch = {}) {
  const doc = await RealEstateBank.findById(bankId);
  if (!doc) throw new Error('Bank not found.');
  for (const k of UPDATABLE_BANK_FIELDS) {
    if (patch[k] !== undefined) doc[k] = patch[k];
  }
  await doc.save();
  return doc.toObject({ getters: true });
}

async function listMembers(bankId) {
  return RealEstateBankMember.find({ bank: bankId })
    .sort({ createdAt: -1 })
    .populate('user', 'firstName lastName email mobile')
    .lean();
}

/**
 * Admin: officer lifecycle. SUSPENDED/TERMINATED officers fail the
 * bank-auth ACTIVE check, so `/auth/bank/login` rejects them —
 * removal is a status, never a delete (audit trail preserved).
 */
async function setMemberStatus(memberId, { status, designation } = {}) {
  const doc = await RealEstateBankMember.findById(memberId);
  if (!doc) throw new Error('Bank member not found.');
  if (status !== undefined) doc.status = status;
  if (designation !== undefined) doc.designation = designation;
  await doc.save();
  return doc.toObject({ getters: true });
}

async function resolveBankForUser(userId) {
  const member = await RealEstateBankMember.findOne({ user: userId, status: 'ACTIVE' });
  if (!member) throw new Error('No active bank membership for this user.');
  return member;
}

const realEstateBankService = {
  createBank,
  updateBank,
  UPDATABLE_BANK_FIELDS,
  addMember,
  listMembers,
  setMemberStatus,
  resolveBankForUser,
};

module.exports = realEstateBankService;
