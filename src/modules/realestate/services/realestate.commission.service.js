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

const RealEstateCommission = require('../models/realestate.commission.model');
const RealEstateCommissionRule = require('../models/realestate.commission.rule.model');
const ruleService = require('./realestate.commission.rule.service');
const ledgerService = require('./realestate.ledger.service');
const { COMMISSION_TRANSITIONS, canTransition } = require('../utils/realestate.state.machine');
const fcmNotificationService = require('../../../services/fcm.notification.service');

let commissionSequence = 0;

function nextCommissionNo() {
  commissionSequence += 1;
  const ts = Date.now().toString().slice(-8);
  return `RE-COM-${ts}-${String(commissionSequence).padStart(4, '0')}`;
}

function round2(n) {
  return Number(Number(n).toFixed(2));
}

function assertCommissionTransition(from, to) {
  if (!canTransition(COMMISSION_TRANSITIONS, from, to)) {
    const allowed = COMMISSION_TRANSITIONS[from] || [];
    throw new Error(
      allowed.length
        ? `Cannot move commission from "${from}" to "${to}". Allowed: ${allowed.join(', ')}.`
        : `Commission is already "${from}" and cannot change.`
    );
  }
}

async function computeSaleCommissions(
  { saleId, saleValue, referralRate = 0, executiveRate = 0, referrer = null, executive = null },
  session = null
) {
  if (!(saleValue > 0)) throw new Error('saleValue must be positive');
  const saleRule = await ruleService.resolveActiveRule('PROPERTY_SALE', saleValue, new Date());
  const localwalaCommission = round2((saleValue * saleRule.rate) / 100);

  let referralCommission = 0;
  let executiveCommission = 0;
  let referralRule = null;
  let executiveRule = null;

  if (referralRate > 0) {
    if (!referrer) throw new Error('referrer required when referralRate > 0');
    referralRule = await ruleService.resolveActiveRule('CUSTOMER_REFERRAL', localwalaCommission, new Date());
    referralCommission = round2((localwalaCommission * referralRate) / 100);
  }
  if (executiveRate > 0) {
    if (!executive) throw new Error('executive required when executiveRate > 0');
    executiveRule = await ruleService.resolveActiveRule('EXECUTIVE', localwalaCommission, new Date());
    executiveCommission = round2((localwalaCommission * executiveRate) / 100);
  }

  if (referralCommission + executiveCommission - localwalaCommission > 0.009) {
    throw new Error(
      `Commission shares exceed LocalWala commission: referral ${referralCommission} + executive ${executiveCommission} > ${localwalaCommission}.`
    );
  }

  const now = new Date();
  const rows = [];

  const mkSnapshot = (rule) => ({
    ruleId: rule._id,
    version: rule.version,
    type: rule.type,
    rate: rule.rate,
    basis: rule.calculationBasis,
    effectiveFrom: rule.effectiveFrom,
  });

  // OD-04: sale-commission tax snapshot (inactive until approved determination).
  let saleTaxSnapshot = { inactive: true, reason: 'no approved written determination' };
  try {
    const holdPolicyService = require('./realestate.hold.policy.service');
    const activePolicy = await holdPolicyService.getActive(new Date());
    const active = holdPolicyService.getActiveTaxForSupply(activePolicy, 'propertySaleCommission');
    saleTaxSnapshot = active || saleTaxSnapshot;
  } catch (e) {
    /* no active policy — tax stays inactive, commission still computes */
  }

  const createOne = async ({ beneficiaryType, beneficiary, baseAmount, rate, amount, rule, snapshot }) => {
    const doc = {
      commissionNo: nextCommissionNo(),
      sale: saleId || null,
      rule: rule ? rule._id : null,
      ruleSnapshot: snapshot,
      // Frozen tax — later Admin edits must not restate this row.
      taxSnapshot: beneficiaryType === 'LOCALWALA' ? saleTaxSnapshot : { inactive: true, reason: 'only LOCALWALA sale commission carries sale tax' },
      beneficiaryType,
      baseAmount,
      rate,
      amount,
      status: 'PENDING',
      resolvedAt: now,
    };
    if (beneficiary) doc.beneficiary = beneficiary;
    const created = session
      ? (await RealEstateCommission.create([doc], { session }))[0]
      : await RealEstateCommission.create(doc);
    rows.push(created);
    const ledgerEntry = await ledgerService.record(
      {
        eventType:
          beneficiaryType === 'LOCALWALA' ? 'PROPERTY_SALE_COMMISSION' : beneficiaryType === 'REFERRER' ? 'CUSTOMER_REFERRAL_COMMISSION' : 'EXECUTIVE_COMMISSION',
        accountType: beneficiaryType === 'LOCALWALA' ? 'REVENUE' : 'PAYABLE',
        direction: 'CREDIT',
        amount,
        partyType: beneficiaryType === 'REFERRER' ? 'REFERRER' : beneficiaryType,
        party: beneficiary || null,
        sourceModel: 'RealEstateCommission',
        sourceId: created._id,
        narration: `Commission ${created.commissionNo} for sale ${saleId || ''}`.trim(),
        // Each beneficiary is its own event — never merged (OD-04 §4).
        metadata: {
          saleId: saleId || null,
          ruleSnapshot: snapshot,
          taxSnapshot: created.taxSnapshot || { inactive: true },
        },
      },
      session
    );
    // Phase C: LocalWala's sale-commission invoice under an approved
    // determination. Referral/executive legs are payables, never revenue,
    // so only the LOCALWALA leg invoices. Skipped while inactive (OD-04).
    if (beneficiaryType === 'LOCALWALA') {
      try {
        const invoiceService = require('./realestate.invoice.service');
        const holdPolicyService = require('./realestate.hold.policy.service');
        const policy = await holdPolicyService.getActive();
        if (holdPolicyService.getActiveTaxForSupply(policy, 'propertySaleCommission')) {
          await invoiceService.issueInvoice(
            {
              supply: 'PROPERTY_SALE_COMMISSION',
              buyerType: 'VENDOR',
              amountPaise: Math.round(Number(amount) * 100),
              sourceModel: 'RealEstateCommission',
              sourceId: created._id,
              ledgerEntry: ledgerEntry._id,
            },
            session
          );
        }
      } catch (e) {
        console.error(`sale commission invoice skipped for ${created.commissionNo}: ${e.message}`);
      }
    }
    return created;
  };

  await createOne({
    beneficiaryType: 'LOCALWALA',
    beneficiary: null,
    baseAmount: saleValue,
    rate: saleRule.rate,
    amount: localwalaCommission,
    rule: saleRule,
    snapshot: mkSnapshot(saleRule),
  });
  if (referralCommission > 0) {
    await createOne({
      beneficiaryType: 'REFERRER',
      beneficiary: referrer,
      baseAmount: localwalaCommission,
      rate: referralRate,
      amount: referralCommission,
      rule: referralRule,
      snapshot: referralRule
        ? mkSnapshot(referralRule)
        : { type: 'CUSTOMER_REFERRAL', rate: referralRate, basis: 'LOCALWALA_COMMISSION', effectiveFrom: now },
    });
  }
  if (executiveCommission > 0) {
    await createOne({
      beneficiaryType: 'EXECUTIVE',
      beneficiary: executive,
      baseAmount: localwalaCommission,
      rate: executiveRate,
      amount: executiveCommission,
      rule: executiveRule,
      snapshot: executiveRule
        ? mkSnapshot(executiveRule)
        : { type: 'EXECUTIVE', rate: executiveRate, basis: 'LOCALWALA_COMMISSION', effectiveFrom: now },
    });
  }

  // Phase 10: notify commission beneficiaries. Never throws into computation.
  try {
    for (const row of rows) {
      if (row.beneficiaryType === 'EXECUTIVE' && row.beneficiary) {
        const RealEstateExecutive = require('../models/realestate.executive.model');
        const exec = await RealEstateExecutive.findById(row.beneficiary).select('user').lean();
        if (exec && exec.user) {
          await fcmNotificationService.realEstateCommissionEarned({
            userId: exec.user,
            recipientType: 'EXECUTIVE',
            title: 'Commission earned',
            body: `Commission ${row.commissionNo} earned ₹${row.amount.toLocaleString('en-IN')}.`,
            data: { commissionId: String(row._id) },
          });
        }
      }
      if (row.beneficiaryType === 'REFERRER' && row.beneficiary) {
        await fcmNotificationService.realEstateCommissionEarned({
          userId: row.beneficiary,
          recipientType: 'CUSTOMER',
          title: 'Referral commission earned',
          body: `Commission ${row.commissionNo} earned ₹${row.amount.toLocaleString('en-IN')}.`,
          data: { commissionId: String(row._id) },
        });
      }
    }
  } catch (e) {
    /* notify-only */
  }

  return { localwalaCommission, referralCommission, executiveCommission, rows };
}

/**
 * Vendor's own commissions.
 *
 * BR-02: the listing package and the sale commission are separate
 * financial events. A vendor's "earnings" view is the sales
 * commission only, never summed with package spend. This filter
 * pulls `beneficiaryType: VENDOR` rows — every other beneficiary
 * type is someone else's money, not the vendor's.
 *
 * The commission does not carry a `vendor` field directly; the
 * filter is `{ beneficiaryType: 'VENDOR', beneficiary: vendorId }`,
 * which is also the most selective index on the table
 * (`{ beneficiaryType: 1, beneficiary: 1, status: 1 }`).
 *
 * @param {mongoose.Types.ObjectId} vendorId
 * @param {{ page?: number, limit?: number, status?: string }} opts
 */
async function listForVendor(vendorId, { page = 1, limit = 20, status } = {}) {
  if (!vendorId) return { results: [], total: 0, page, limit };
  const filter = { beneficiaryType: 'VENDOR', beneficiary: vendorId };
  if (status) filter.status = status;
  const [docs, total] = await Promise.all([
    RealEstateCommission.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    RealEstateCommission.countDocuments(filter),
  ]);
  // Hydrated — `amount` / `baseAmount` are moneyFields.
  // See the money-edges gate: lean reads ship paise.
  const results = docs.map((d) => d.toObject({ getters: true }));
  return { results, total, page, limit };
}

/**
 * Retire a commission rule with overlap validation (F-9).
 *
 * Only ACTIVE rules can be retired. Retiring is disallowed if another
 * ACTIVE rule would have an effective window that overlaps the retired
 * rule's window. This prevents rule version collisions.
 *
 * @param {mongoose.Types.ObjectId} ruleId - The rule to retire
 * @returns {Promise<RealEstateCommissionRule>} The retired rule document
 */
async function retireRule(ruleId) {
  return await RealEstateCommissionRule.retireRule(ruleId);
}

const realEstateCommissionService = {
  computeSaleCommissions,
  assertCommissionTransition,
  listForVendor,
  retireRule,
};

module.exports = realEstateCommissionService;
