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

const RealEstateCommissionRule = require('../models/realestate.commission.rule.model');

/**
 * Commission rule service — versioned data management.
 *
 * Two guarantees:
 * 1. F-8: no two ACTIVE rules for the same (type, slab) at the same
 *    moment — partial unique index + this service checks before activate.
 * 2. F-9: no overlapping effective windows on retire — the service
 *    rejects an overlapping retirement.
 *
 * Rate changes never restate history: payouts freeze a `ruleSnapshot`
 * (BR-15), so this table is write-rarely, read-at-resolution-only.
 */

function toPaise(rupees) {
  if (rupees === null || rupees === undefined) return null;
  return Math.round(Number(rupees) * 100);
}

async function createRule(data) {
  const latest = await RealEstateCommissionRule.findOne({ type: data.type }).sort({ version: -1 }).lean();
  const doc = {
    ...data,
    version: (latest ? latest.version : 0) + 1,
    status: data.status || 'DRAFT',
  };
  return RealEstateCommissionRule.create(doc);
}

async function activateRule(ruleId) {
  const rule = await RealEstateCommissionRule.findById(ruleId);
  if (!rule) throw new Error('Commission rule not found');
  if (rule.status === 'ACTIVE') return rule;
  const clash = await RealEstateCommissionRule.findOne({
    _id: { $ne: rule._id },
    type: rule.type,
    status: 'ACTIVE',
    slabFrom: rule.slabFrom,
    effectiveFrom: rule.effectiveFrom,
  }).lean();
  if (clash) {
    throw new Error(`An ACTIVE ${rule.type} rule already exists for this slab (rule ${clash._id}). Retire it first.`);
  }
  rule.status = 'ACTIVE';
  await rule.save();
  return rule;
}

const UPDATABLE_RULE_FIELDS = [
  'name',
  'rate',
  'calculationBasis',
  'slabFrom',
  'slabTo',
  'minAmount',
  'maxAmount',
  'effectiveFrom',
  'effectiveTo',
];

/**
 * Admin: edit a DRAFT rule in place. ACTIVE rows are immutable — a rate
 * change is a new version (POST + activate + retire old), never an
 * edit, because payouts freeze a `ruleSnapshot` (BR-15) and the F-8
 * slab identity (type/slabFrom/effectiveFrom) must not shift under it.
 */
async function updateDraftRule(ruleId, patch = {}) {
  const rule = await RealEstateCommissionRule.findById(ruleId);
  if (!rule) throw new Error('Commission rule not found');
  if (rule.status !== 'DRAFT') throw new Error('Only DRAFT rules can be edited — create a new version instead.');
  for (const k of UPDATABLE_RULE_FIELDS) {
    if (patch[k] !== undefined) rule[k] = patch[k];
  }
  await rule.save();
  return rule.toObject({ getters: true });
}

async function retireRule(ruleId, effectiveTo = new Date()) {
  const rule = await RealEstateCommissionRule.findById(ruleId);
  if (!rule) throw new Error('Commission rule not found');
  if (rule.effectiveFrom && effectiveTo < rule.effectiveFrom) {
    throw new Error('Retirement date cannot precede effectiveFrom (F-9 overlap guard).');
  }
  rule.status = 'RETIRED';
  rule.effectiveTo = effectiveTo;
  await rule.save();
  return rule;
}

/**
 * Resolve the ACTIVE rule for (type, basis amount, moment).
 * Slab match is on paise: slabFrom <= amount < slabTo (null = infinity).
 */
async function resolveActiveRule(type, basisAmountRupees, at = new Date()) {
  const paise = toPaise(basisAmountRupees);
  const candidates = await RealEstateCommissionRule.find({
    type,
    status: 'ACTIVE',
    effectiveFrom: { $lte: at },
    $and: [{ $or: [{ effectiveTo: null }, { effectiveTo: { $gt: at } }] }],
  })
    .sort({ version: -1 })
    .lean();
  const match = candidates.find((r) => {
    const from = r.slabFrom || 0;
    const to = r.slabTo === null || r.slabTo === undefined ? Infinity : r.slabTo;
    return paise >= from && paise < to;
  });
  if (!match) throw new Error(`No ACTIVE ${type} rule covers ${basisAmountRupees} at ${at.toISOString()}.`);
  return match;
}

const realEstateCommissionRuleService = {
  createRule,
  updateDraftRule,
  UPDATABLE_RULE_FIELDS,
  activateRule,
  retireRule,
  resolveActiveRule,
};

module.exports = realEstateCommissionRuleService;
