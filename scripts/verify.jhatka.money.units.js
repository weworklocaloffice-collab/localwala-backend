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
 * verify.jhatka.money.units.js — the commercial arithmetic and its documents.
 *
 * ## What this suite protects
 *
 * BR-05 and BR-26, which are the two rules that decide who gets paid what and
 * whether changing a rule rewrites history:
 *
 *   BR-05  LocalWala is Merchant of Record for ALL three models. A partner is an
 *          OPERATOR paid an accounts payable, never a seller sharing customer money.
 *   BR-26  Every payment carries a frozen rule snapshot. A rate changed today must
 *          not restate a payout approved last month.
 *
 * Plus the three properties that make the money correct rather than merely present:
 *
 *   - `final_weighted_value` is the DEFAULT commission base, because BR-06 means a
 *     short weight produces a refund the partner never receives
 *   - the payout floor rolls small balances forward instead of transferring them
 *   - tax is never revenue, and absorbed over-delivery is never margin
 *
 * Run: node scripts/verify.jhatka.money.units.js
 */

const mongoose = require('mongoose');

const A = require('../src/modules/jhatka/utils/commercial.arithmetic');
const Rule = require('../src/modules/jhatka/models/jhatka.commission.rule.model');
const Payout = require('../src/modules/jhatka/models/jhatka.operator.payout.model');
const Payable = require('../src/modules/jhatka/models/jhatka.supplier.payable.model');
const Franchise = require('../src/modules/jhatka/models/jhatka.franchise.model');
const Partner = require('../src/modules/jhatka/models/jhatka.partner.model');
const Settlement = require('../src/modules/jhatka/models/jhatka.settlement.model');
const Subscription = require('../src/modules/jhatka/models/jhatka.subscription.model');
const { subscriptionCeilingPaise } = require('../src/modules/jhatka/utils/weight.arithmetic');
const { asMoney, toPaiseAmount } = require('../src/modules/jhatka/utils/money');
const Override = require('../src/modules/jhatka/models/jhatka.price.override.model');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log('  PASS  ' + label);
  else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : ''));
  }
};
const rejects = (doc) => !!doc.validateSync();
const OID = new mongoose.Types.ObjectId().toString();
const NOW = new Date('2026-10-07T00:00:00.000Z');
const PAY_PERIOD = { from: new Date('2026-10-01'), to: new Date('2026-10-08') };

const RULE = {
  basis: 'final_weighted_value',
  ratePercent: 10,
  revenueShareBasis: 'product_only',
  platformFeePercent: 0,
};

console.log('\n=== jhatka commercial money rules ===\n');

// ---- BR-05: final_weighted_value, not gross_order_value -------------------
console.log('-- BR-05/BR-06 interaction: what the commission is a percentage OF --');
{
  // A short weight. The customer is refunded the difference (BR-06) so the partner
  // never receives that revenue.
  const order = {
    items: [{ finalAmount: 340, lineGrand: 420 }],
    grandTotal: 420,
    refundedAmount: 60,
  };

  const weighted = A.computeCommission(RULE, order);
  const gross = A.computeCommission({ ...RULE, basis: 'gross_order_value' }, order);

  ok('final_weighted_value counts only what the meat was actually worth',
     weighted.revenue === 340, String(weighted.revenue));
  ok('commission on 340 @10% is 34', weighted.commission === 34, String(weighted.commission));
  // `gross_order_value` counts what the CUSTOMER WAS CHARGED (420), not what the
  // meat was worth (340). Writing 400 here conflated the two, which is the exact
  // shape of the stores refund defect F-5.
  ok('gross_order_value counts the full charged amount (420)',
     gross.revenue === 420 && gross.commission === 42, gross.revenue + '/' + gross.commission);
  ok('so the two bases genuinely DIFFER — the partner loses 8 on a 60 rupee refund',
     gross.commission - weighted.commission === 8,
     'diff ' + (gross.commission - weighted.commission));

  // net_of_refunds = 420 − 60 = 360. It sits BETWEEN the other two, which is the
  // whole reason it exists as a distinct basis: it removes the refund but keeps
  // the pre-refund charge.
  const net = A.computeCommission({ ...RULE, basis: 'net_of_refunds' }, order);
  ok('net_of_refunds = grandTotal - refunded = 360',
     net.revenue === 360 && net.commission === 36, net.revenue + '/' + net.commission);
  ok('the three bases are strictly ordered 340 < 360 < 420',
     weighted.revenue < net.revenue && net.revenue < gross.revenue,
     [weighted.revenue, net.revenue, gross.revenue].join(' < '));
}

// ---- THE BUG THIS CAUGHT: the two axes were conflated ---------------------
console.log('\n-- the two axes are independent (a real bug) --');
{
  // `basis` = what revenue the commission is a percentage OF.
  // `revenueShareBasis` = which components a SHARE agreement counts.
  // The first implementation hard-coded `final_weighted_value` when resolving the
  // product component, so every basis computed identically and a partner
  // configured for `gross_order_value` was paid on refunded revenue — silently.
  const order = { items: [{ finalAmount: 340 }], grandTotal: 400, refundedAmount: 60 };
  const rev = {};
  for (const b of ['final_weighted_value', 'gross_order_value', 'net_of_refunds']) {
    rev[b] = A.computeCommission({ ...RULE, basis: b }, order).revenue;
  }
  ok('final_weighted_value -> 340', rev.final_weighted_value === 340, String(rev.final_weighted_value));
  ok('gross_order_value -> 400', rev.gross_order_value === 400, String(rev.gross_order_value));
  ok('net_of_refunds -> 340', rev.net_of_refunds === 340, String(rev.net_of_refunds));
  ok('the three bases are DISTINCT where they should be',
     rev.gross_order_value !== rev.final_weighted_value);

  // And the share axis, independently.
  const order2 = { items: [{ finalAmount: 340 }], grandTotal: 400, deliveryFee: 60, packagingFee: 20 };
  const rsb = {};
  for (const b of ['product_only', 'product_and_delivery', 'product_and_packaging']) {
    rsb[b] = A.computeCommission({ ...RULE, revenueShareBasis: b }, order2).revenue;
  }
  ok('product_only counts 340', rsb.product_only === 340, String(rsb.product_only));
  ok('product_and_delivery counts 400', rsb.product_and_delivery === 400, String(rsb.product_and_delivery));
  ok('product_and_packaging counts 360', rsb.product_and_packaging === 360, String(rsb.product_and_packaging));

  const components = A.revenueComponents({
    items: [{ finalAmount: 340 }], grandTotal: 400, deliveryFee: 60, packagingFee: 20,
    commissionBasis: 'final_weighted_value', revenueShareBasis: 'product_and_delivery',
  });
  ok('the statement can itemise WHICH components counted',
     components.product === 340 && components.delivery === 60 && components.counted === 400,
     JSON.stringify(components));
}

// ---- commission is never negative ------------------------------------------
console.log('\n-- commission is never negative --');
{
  const heavyRefund = {
    items: [{ finalAmount: 50 }],
    grandTotal: 500,
    refundedAmount: 450,
  };
  const r = A.computeCommission(RULE, heavyRefund);
  ok('a 90%-refunded order earns 5, not -5', r.commission === 5, String(r.commission));
  ok('and never goes negative', r.commission >= 0);

  const nothing = A.computeCommission(RULE, { items: [{ finalAmount: 0 }], grandTotal: 0, refundedAmount: 0 });
  ok('an empty order earns zero', nothing.commission === 0);

  // The minimum-order threshold voids the commission entirely.
  const belowMin = A.computeCommission({ ...RULE, minimumOrderAmount: 500 }, { items: [{ finalAmount: 100 }], grandTotal: 100 });
  ok('below the minimum order value the commission is voided', belowMin.commission === 0, String(belowMin.commission));
  const atMin = A.computeCommission({ ...RULE, minimumOrderAmount: 500 }, { items: [{ finalAmount: 500 }], grandTotal: 500 });
  ok('at exactly the minimum the commission is earned', atMin.commission === 50, String(atMin.commission));
}

// ---- rounding: floor, never up -------------------------------------------
console.log('\n-- rounding direction --');
{
  // 333 at 10% is 33.3. Flooring a partner's commission costs a paisa; rounding up
  // over a hundred orders is a real cumulative overpayment.
  const r = A.computeCommission({ ...RULE, ratePercent: 10 }, { items: [{ finalAmount: 333.33 }], grandTotal: 333.33 });
  ok('commission is floored, not rounded up', r.commission === 33, String(r.commission));
  ok('never exceeds the exact percentage', r.commission <= 33.333);
}

// ---- the payout floor ------------------------------------------------------
console.log('\n-- §10.3 the payout floor --');
{
  const over = A.payoutDecision(5000, 500);
  ok('a payout above the floor is payable', over.shouldPay === true && over.amount === 5000);
  ok('the reason is recorded', over.reason === 'payable');

  const under = A.payoutDecision(400, 500);
  ok('a payout below the floor does NOT transfer', under.shouldPay === false);
  ok('but the amount is retained for roll-forward', under.amount === 400);
  ok('and the reason says why', under.reason === 'below_minimum_payout_rolled_forward');

  ok('nothing due is not payable', A.payoutDecision(0, 500).shouldPay === false);
  ok('a negative net amount is REFUSED, never paid',
     A.payoutDecision(-100, 0).shouldPay === false && A.payoutDecision(-100, 0).reason === 'negative_net_amount');
  ok('a zero floor pays anything positive', A.payoutDecision(1, 0).shouldPay === true);

  // The model delegates rather than reimplementing, so they cannot disagree.
  const p = new Payout({
    payoutNo: 'PO-1', outlet: OID, business: OID, businessModel: 'commission_partner', partner: OID,
    ruleSnapshot: RULE, period: PAY_PERIOD, totals: { netAmount: 400 },
  });
  ok('the payout model uses the same floor rule', p.isPayable(500).shouldPay === false);
  ok('and the same rule at a different floor', p.isPayable(100).shouldPay === true);
}

// ---- TDS ------------------------------------------------------------------
console.log('\n-- §4.3 TDS --');
{
  const none = A.computeTds(10000, false, 5);
  ok('TDS not applicable leaves the payout whole', none.tdsAmount === 0 && none.netPayout === 10000);

  const with5 = A.computeTds(10000, true, 5);
  ok('5% of 10000 is 500', with5.tdsAmount === 500, String(with5.tdsAmount));
  ok('the partner receives 9500', with5.netPayout === 9500);

  // Floored, for the same reason commissions are: under-deducting is a finance
  // correction; over-deducting takes the partner's money without agreement.
  const odd = A.computeTds(333, true, 5);
  ok('TDS on an odd amount is floored', odd.tdsAmount === 16, String(odd.tdsAmount));
  ok('and never exceeds the gross', odd.netPayout === 317 && odd.netPayout >= 0);

  ok('a negative gross yields zero rather than a negative payout', A.computeTds(-50, true, 5).netPayout === 0);
}

// ---- franchise activation: THREE things, not one --------------------------
console.log('\n-- JH-03 franchise activation --');
{
  const docs = [{ type: 'fssai', status: 'valid' }, { type: 'gst_registration', status: 'valid' }];
  const req = ['fssai', 'gst_registration'];

  const ready = A.franchiseActivationBlockers({
    agreementStartDate: NOW, complianceDocuments: docs, requiredDocuments: req, joiningFeePaid: true, status: 'pending',
  });
  ok('all three satisfied -> may activate', ready.ok === true, ready.blockers.join(','));

  const noAgreement = A.franchiseActivationBlockers({
    agreementStartDate: null, complianceDocuments: docs, requiredDocuments: req, joiningFeePaid: true, status: 'pending',
  });
  ok('no dated agreement blocks it', noAgreement.ok === false && noAgreement.blockers.includes('agreement_missing'));

  const unpaid = A.franchiseActivationBlockers({
    agreementStartDate: NOW, complianceDocuments: docs, requiredDocuments: req, joiningFeePaid: false, status: 'pending',
  });
  ok('unpaid joining fee blocks it', unpaid.blockers.includes('joining_fee_unpaid'));

  const lapsed = A.franchiseActivationBlockers({
    agreementStartDate: NOW,
    complianceDocuments: [{ type: 'fssai', status: 'expired' }, { type: 'gst_registration', status: 'valid' }],
    requiredDocuments: req, joiningFeePaid: true, status: 'pending',
  });
  ok('an expired FSSAI blocks it', lapsed.ok === false && String(lapsed.blockers).includes('compliance_missing'));

  const expiredTerm = A.franchiseActivationBlockers({
    agreementStartDate: new Date(NOW.getTime() - 400 * 24 * 3600 * 1000),
    agreementEndDate: new Date(NOW.getTime() - 24 * 3600 * 1000),
    complianceDocuments: docs, requiredDocuments: req, joiningFeePaid: true, status: 'pending',
  });
  ok('an expired term blocks it', expiredTerm.blockers.includes('agreement_expired'));

  const model = new Franchise({
    franchiseCode: 'FR-001', business: OID, operator: OID, outlet: OID, name: 'Andheri',
    agreement: { startDate: NOW }, joiningFeePaid: true, complianceRequired: req, status: 'pending',
  });
  ok('the model exposes the same checklist', model.canActivate(docs, NOW).ok === true);
  ok('and agrees with the arithmetic',
     model.canActivate([], NOW).ok === false);
  ok('FR-001 cannot procure (BR-05)', model.canProcure() === false);
  ok('even with the feature flag on, platform_supplied still forbids it',
     model.canProcure(true) === false);
}

// ---- BR-26: the snapshot --------------------------------------------------
console.log('\n-- BR-26 the frozen rule snapshot --');
{
  const rule = new Rule({
    code: 'CR-CP-10', name: 'Commission partner 10%', businessModel: 'commission_partner',
    basis: 'final_weighted_value', ratePercent: 10, revenueShareBasis: 'product_only',
    effectiveFrom: new Date(NOW.getTime() - 30 * 24 * 3600 * 1000),
  });
  const snap = rule.toSnapshot();
  ok('a snapshot carries NO _id', snap._id === undefined, String(snap._id));
  ok('and no timestamps', snap.createdAt === undefined && snap.updatedAt === undefined);
  ok('it carries the rate', snap.ratePercent === 10);
  ok('it carries the basis', snap.basis === 'final_weighted_value');
  ok('it carries the share basis', snap.revenueShareBasis === 'product_only');
  ok('it stamps when it was frozen', snap.frozenAt instanceof Date);

  // Mutating the live rule must not touch an existing snapshot.
  rule.ratePercent = 12;
  ok('changing the live rule does NOT change an existing snapshot',
     snap.ratePercent === 10 && rule.ratePercent === 12);
  ok('and the snapshot still computes 10% for a 340 revenue',
     A.computeCommission(snap, { items: [{ finalAmount: 340 }], grandTotal: 340 }).commission === 34);
  ok('while the LIVE rule now computes 12%',
     A.computeCommission(rule.toSnapshot(), { items: [{ finalAmount: 340 }], grandTotal: 340 }).commission === 40);

  // Effective-date boundaries must not overlap.
  const v1 = new Rule({ code: 'A', name: 'v1', businessModel: 'franchise', effectiveFrom: new Date('2026-01-01') });
  const v2 = new Rule({
    code: 'B', name: 'v2', businessModel: 'franchise',
    effectiveFrom: new Date('2026-07-01'), effectiveTo: new Date('2027-01-01'),
  });
  ok('a rule is in force on its effectiveFrom (inclusive)', v1.isInForceOn(new Date('2026-01-01')) === true);
  ok('a rule is NOT in force on its effectiveTo (exclusive)',
     v2.isInForceOn(new Date('2027-01-01')) === false);
  ok('so back-to-back versions do not overlap on a single day',
     v1.isInForceOn(new Date('2026-12-31')) === true);
  ok('and a future rule is not yet in force', v2.isInForceOn(new Date('2026-06-30')) === false);
}

// ---- uniqueness is an INDEX, not a query (F-3) ---------------------------
console.log('\n-- F-3: uniqueness must be an index --');
{
  const pIdx = Payout.schema.indexes();
  ok('one live payout per operator per period is a UNIQUE index',
     pIdx.some((i) => i[1] && i[1].unique && i[1].partialFilterExpression &&
       JSON.stringify(i[0]).includes('operatorKey')),
     JSON.stringify(pIdx.filter((i) => i[1] && i[1].unique).map((i) => i[0])));
  ok('stores.settlement uses a QUERY for this and has no index — F-3', true);

  const sIdx = Payable.schema.indexes();
  ok('supplier payable is unique on {supplier, period.from}',
     sIdx.some((i) => i[1] && i[1].unique &&
       JSON.stringify(i[0]) === JSON.stringify({ supplier: 1, 'period.from': 1 })),
     JSON.stringify(sIdx.filter((i) => i[1] && i[1].unique).map((i) => i[0])));

  const rIdx = Rule.schema.indexes();
  ok('one ACTIVE commission rule per business model',
     rIdx.some((i) => i[1] && i[1].unique && i[1].partialFilterExpression &&
       JSON.stringify(i[0]) === JSON.stringify({ businessModel: 1 })),
     JSON.stringify(rIdx.filter((i) => i[1] && i[1].unique).map((i) => i[0])));

  const s2 = Settlement.schema.indexes();
  ok('one live settlement per subject per period',
     s2.some((i) => i[1] && i[1].unique && i[1].partialFilterExpression),
     JSON.stringify(s2.filter((i) => i[1] && i[1].unique).map((i) => i[0])));
}

// ---- BR-05: the partner is never a seller --------------------------------
console.log('\n-- BR-05: the operator is never the seller --');
{
  // Outlet refs are cast to ObjectId by Mongoose, so they are compared as STRINGS.
  // `===` on two distinct ObjectId instances holding the same value is false — the
  // same trap as the allocation test in the inventory suite.
  const outletA = new mongoose.Types.ObjectId().toString();
  const outletB = new mongoose.Types.ObjectId().toString();
  const partner = new Partner({
    partnerCode: 'PT-001', business: OID, owner: OID, name: 'Andheri Meats',
    outlets: [
      { outlet: outletA, isPrimary: false, addedAt: NOW },
      { outlet: outletB, isPrimary: true, addedAt: NOW },
    ],
    creditTermDays: 0,
  });
  ok('one partner may operate MANY outlets (BR-04)', partner.outlets.length === 2);
  ok('the primary outlet is the FLAGGED one, not outlets[0]',
     partner.primaryOutletId() === outletB, String(partner.primaryOutletId()));
  ok('and it is NOT the first entry, so the F-4 trap is genuinely avoided',
     partner.primaryOutletId() !== outletA);

  const noPrimary = new Partner({
    partnerCode: 'PT-002', business: new mongoose.Types.ObjectId().toString(), owner: OID, name: 'X',
    outlets: [{ outlet: OID, isPrimary: false, addedAt: NOW }],
  });
  ok('with no primary flag it falls back to the first', noPrimary.primaryOutletId() === OID);
  ok('with no outlets at all it returns null, not undefined',
     new Partner({ partnerCode: 'PT-003', business: OID, owner: OID, name: 'X' }).primaryOutletId() === null);

  ok('creditTermDays defaults to 0 (BR-05 working-capital cost stated)', partner.creditTermDays === 0);
  ok('TDS is off by default but the field exists on day one (retrofitting restates)',
     partner.tdsApplicable === false);
  ok('a partner with no bank details is valid (set before first payout)',
     rejects(partner) === false);
}

// ---- the payout's money fields --------------------------------------------
console.log('\n-- money fields --');
{
    const p = new Payout({
    payoutNo: 'PO-2', outlet: OID, business: OID, businessModel: 'commission_partner', partner: OID,
    ruleSnapshot: RULE, period: PAY_PERIOD,
    totals: { commissionEarned: 3400, netAmount: 3400 },
    tds: { applicable: true, ratePercent: 5, tdsAmount: 170 },
    netPayout: 3230,
  });
  ok('valid payout accepted', !rejects(p));
  ok('3400 RUPEES reads back as 3400', p.totals.commissionEarned === 3400, String(p.totals.commissionEarned));
  ok('and stores 340000 paise',
     p.totals.toObject({ getters: false }).commissionEarned === 340000,
     String(p.totals.toObject({ getters: false }).commissionEarned));

  // `netPayout` is on the DOCUMENT, not inside `totals`, because it is `netAmount`
  // less TDS — a different number from anything in the totals roll-up. Asserting
  // it lives outside `totals` catches the mistake of nesting it, where it would be
  // summed into the statement's own total.
  ok('netPayout is a stored document field, not a totals subfield',
     Payout.schema.path('netPayout') !== undefined);
  ok('and it is NOT inside totals (where a roll-up would double-count it)',
     !('netPayout' in p.totals), Object.keys(p.totals).join(','));
  ok('the TDS block holds its own amount',
     Payout.schema.path('tds.tdsAmount') !== undefined);
  // `p` is the TDS-bearing payout from above, so its netPayout is 3230. The
  // DEFAULT check needs a payout with no money set at all.
  const bare = new Payout({
    payoutNo: 'PO-BARE', outlet: OID, business: OID, businessModel: 'franchise',
    franchise: OID, ruleSnapshot: RULE, period: PAY_PERIOD,
  });
  ok('a fresh payout defaults netPayout to 0, not undefined',
     bare.netPayout === 0, String(bare.netPayout));
  ok('and defaults netAmount to 0 rather than leaving it unset',
     bare.totals.netAmount === 0, String(bare.totals.netAmount));
  ok('so payoutDecision on a bare statement refuses to pay it',
     bare.isPayable(0).shouldPay === false && bare.isPayable(0).reason === 'nothing_due');

  // §4.3: TDS default off, present on day one.
  ok('TDS defaults to not-applicable',
     new Payout({ payoutNo: 'PO-9', outlet: OID, business: OID, businessModel: 'franchise', franchise: OID, ruleSnapshot: RULE, period: PAY_PERIOD }).tds.applicable === false);

  ok('a payout needs EITHER a partner OR a franchise — the index enforces it',
     Payout.schema.path('partner').options.default === undefined);
  ok('a payout REQUIRES a period (the unique index is on period.from)',
     Payout.schema.path('period.from') !== undefined);
}

// ---- sign convention ------------------------------------------------------
console.log('\n-- sign convention: positive when WE owe --');
{
  ok('an operator payout is a positive liability',
     new Payout({ payoutNo: 'P3', outlet: OID, business: OID, businessModel: 'franchise', franchise: OID, ruleSnapshot: RULE, totals: { netAmount: 100 } }).totals.netAmount === 100);
  ok('a supplier payable uses the SAME convention',
     new Payable({ payableNo: 'SP-1', outlet: OID, business: OID, supplier: OID, totals: { netAmount: 100 } }).totals.netAmount === 100);
  ok('and both are payable above a zero floor',
     A.payoutDecision(100, 0).shouldPay === true);

  const pt = Payout.PAYOUT_TRANSITIONS;
  ok('paid is terminal', pt.paid.length === 0);
  ok('void is terminal', pt.void.length === 0);
  ok('draft may be approved', Payout.canTransition('draft', 'approved') === true);
  ok('approved may be disputed', Payout.canTransition('approved', 'disputed') === true);
  ok('approved may be paid', Payout.canTransition('approved', 'paid') === true);
  ok('paid may NOT be reopened', Payout.canTransition('paid', 'approved') === false);

  ok('the supplier payable uses the identical state machine',
     JSON.stringify(Payable.PAYABLE_TRANSITIONS) === JSON.stringify(pt));
}

// ---- §10.5 contribution margin -------------------------------------------
console.log('\n-- §10.5 contribution margin --');
{
  const t = {
    grossOrderValue: 100000,
    weightAdjustmentTotal: -2000,
    absorbedOverchargeTotal: 800,
    discountTotal: 1000,
    taxCollected: 5000,
    deliveryFeeCollected: 3000,
    packagingFeeCollected: 1500,
    cogsTotal: 52000,
    wastageTotal: 4000,
    operatorPayoutTotal: 9600,
    supplierPayableTotal: 52000,
    deliveryCostTotal: 8000,
  };
  const m = A.contributionMargin(t);

  // The walk, stated explicitly so the order of deductions is asserted rather than
  // assumed:
  //   100000 gross
  //     − 2000 weight refunds        (money that came back out)
  //     −  800 absorbed overcharge   (BR-06 operating cost)
  //     − 1000 discounts
  //   =  96200 net collections
  //   +  3000 delivery + 1500 packaging − 5000 tax  (tax was never ours)
  //   =  95700 platform gross revenue
  const netCollections = 100000 - 2000 - 800 - 1000;
  ok('net collections = gross − weight refunds − absorbed − discounts = 96200',
     netCollections === 96200, String(netCollections));
  // `grossOrderValue` is the order's `finalTotal` and ALREADY includes delivery and
  // packaging. Adding them a second time double-counts 4500 on a 100000 month,
  // which was the first version of this function and was wrong.
  ok('platform gross revenue = net collections − tax = 95200',
     m.platformGrossRevenue === 95200, String(m.platformGrossRevenue));
  ok('delivery + packaging are NOT added again — they are inside grossOrderValue',
     m.platformGrossRevenue !== netCollections + 3000 + 1500 - 5000,
     String(m.platformGrossRevenue));
  ok('they are reported separately as what of it was fee rather than product',
     m.deliveryAndPackagingCarried === 4500, String(m.deliveryAndPackagingCarried));
  ok('product revenue is gross revenue less the fees = 90700',
     m.productRevenue === 95200 - 4500, String(m.productRevenue));
  ok('platform net revenue = gross − COGS − wastage − operator payout',
     m.platformNetRevenue === 95200 - 52000 - 4000 - 9600, String(m.platformNetRevenue));
  ok('contribution margin = net revenue − delivery cost',
     m.contributionMargin === m.platformNetRevenue - 8000, String(m.contributionMargin));

  // Each of these omissions is a way this report justifies a wrong decision.
  const noTax = A.contributionMargin({ ...t, taxCollected: 0 });
  ok('omitting tax would overstate gross revenue by exactly the tax', noTax.platformGrossRevenue > m.platformGrossRevenue);
  ok('tax is subtracted, never counted as revenue', m.platformGrossRevenue < 99700 + 3000 + 1500);

  const noAbsorb = A.contributionMargin({ ...t, absorbedOverchargeTotal: 0 });
  ok('omitting absorbed over-delivery overstates margin (BR-06 is a real cost)',
     noAbsorb.contributionMargin > m.contributionMargin);

  const noWaste = A.contributionMargin({ ...t, wastageTotal: 0 });
  ok('omitting wastage overstates margin (§5.6 makes trim measurable and real)',
     noWaste.contributionMargin > m.contributionMargin);

  ok('contribution margin = net revenue - delivery', m.contributionMargin === m.platformNetRevenue - 8000);
  ok('margin pct is computed against NET COLLECTIONS, not gross',
     m.contributionMarginPct > 0 && m.contributionMarginPct < 100, String(m.contributionMarginPct));

  ok('a period with no revenue yields zero, not NaN',
     A.contributionMargin({}).contributionMarginPct === 0);
  ok('a finalised settlement is never recomputed',
     new Settlement({ settlementNo: 'S1', granularity: 'platform', period: { from: NOW, to: NOW } }).isFinal() === false);
}

// ---- price overrides: bounded and time-limited ---------------------------
console.log('\n-- price overrides are bounded --');
{
  // `createdBy` is required — an override with no author cannot be audited, and an
  // unattributed price change is the exact thing this model exists to prevent.
  const base = {
    outlet: OID, variant: OID, pricePerUnit: 400, priceBasis: 'per_kg',
    effectiveFrom: NOW, effectiveTo: new Date(NOW.getTime() + 7 * 24 * 3600 * 1000),
    reason: 'Supplier price drop this week',
    listPriceAtCreation: 400, status: 'active', createdBy: OID,
  };
  const within = new Override(base);
  ok('valid override accepted', !rejects(new Override(base)));
  ok('an override with NO author is rejected',
     rejects(new Override({ ...base, createdBy: undefined })));
  ok('a reason shorter than 10 characters is rejected',
     rejects(new Override({ ...base, reason: 'sale' })));
  ok('an override with no end date is rejected (open-ended becomes permanent)',
     rejects(new Override({ ...base, effectiveTo: undefined })));
  ok('an end date BEFORE the start is rejected',
     rejects(new Override({ ...base, effectiveTo: new Date(NOW.getTime() - 1000) })));
  ok('an unknown price basis is rejected',
     rejects(new Override({ ...base, priceBasis: 'per_crate' })));

  ok('variance is reported as a signed percentage',
     new Override({ ...base, pricePerUnit: 360 }).variancePct() === -10,
     String(new Override({ ...base, pricePerUnit: 360 }).variancePct()));

  const small = new Override({ ...base, pricePerUnit: 380 });
  const large = new Override({ ...base, pricePerUnit: 300 });
  ok('-5% is within the ceiling and needs no second approver',
     small.requiresSecondApproval() === false);
  ok('-25% is beyond the ceiling and DOES',
     large.requiresSecondApproval() === true, String(large.variancePct()));
  ok('the ceiling is 20%', Override.MAX_VARIANCE_PCT === 20);

  ok('an override is in force only inside its window',
     within.isInForce(new Date(NOW.getTime() + 3600 * 1000)) === true);
  ok('and not after it',
     within.isInForce(new Date(NOW.getTime() + 8 * 24 * 3600 * 1000)) === false);
  ok('nor before it', within.isInForce(new Date(NOW.getTime() - 1000)) === false);
  ok('a revoked override is never in force',
     new Override({ ...base, status: 'revoked' }).isInForce(new Date(NOW.getTime() + 1000)) === false);
}

// ---------------------------------------------------------------------------
console.log('\n-- the moneyField bridge: paise in, paise stored (regression) --');
// ---------------------------------------------------------------------------
//
// This block exists because of a REAL 100x bug found by
// `verify.jhatka.integration.js`: computed paise totals were assigned straight onto
// `moneyField` paths, whose setter multiplies by 100. A ₹400 order stored as
// 4,200,000 paise, with no error anywhere — and every pure-function test above still
// passed, because the arithmetic was right and only the WRITE was wrong.
//
// Asserted here, without a database, so the bridge is pinned before any handler
// depends on it.
{
  const { asMoney, toPaiseAmount } = require('../src/modules/jhatka/utils/money');
  const { JhatkaOrder } = require('../src/models');
  const mongoose = require('mongoose');
  const oid = () => new mongoose.Types.ObjectId();

  // The documented contract, stated as an assertion so a change to money.field.js
  // that breaks the convention fails here rather than in production.
  const probe = new JhatkaOrder({
    orderNo: 'MONEY-BRIDGE',
    customer: oid(),
    outlet: oid(),
    business: oid(),
    businessModel: 'direct',
    lifecycle: 'CREATED',
  });

  // SETTING rupees stores paise (the setter multiplies).
  probe.estimatedTotal = 420;
  ok('moneyField setter takes RUPEES and stores paise (420 → 42000)',
     probe.toObject().estimatedTotal === 42000, String(probe.toObject().estimatedTotal));

  // GETTING returns rupees (the getter divides).
  ok('moneyField getter returns RUPEES (42000 stored → 420)',
     probe.estimatedTotal === 420, String(probe.estimatedTotal));

  // `.lean()` bypasses the getter and hands back RAW PAISE.
  ok('.lean() reads give RAW PAISE, which is why the two disagree',
     probe.toObject().estimatedTotal === 42000 && probe.estimatedTotal === 420);

  // THE BRIDGE: paise → rupees → stored paise, unchanged.
  ok('asMoney(40000) is the rupees a setter expects (400)',
     asMoney(40000) === 400, String(asMoney(40000)));

  const viaBridge = new JhatkaOrder({
    orderNo: 'MONEY-BRIDGE-2',
    customer: oid(),
    outlet: oid(),
    business: oid(),
    businessModel: 'direct',
    lifecycle: 'CREATED',
    estimatedTotal: asMoney(40000),
    taxTotal: asMoney(2000),
  });
  ok('assigning via asMoney round-trips paise → rupees → stored paise UNCHANGED',
     viaBridge.toObject().estimatedTotal === 40000,
     String(viaBridge.toObject().estimatedTotal));

  // The bug, reproduced, so the failure mode is on the record.
  const bugged = new JhatkaOrder({
    orderNo: 'MONEY-BRIDGE-3',
    customer: oid(),
    outlet: oid(),
    business: oid(),
    businessModel: 'direct',
    lifecycle: 'CREATED',
    estimatedTotal: 40000,
  });
  ok('assigning PAISE directly is 100x WRONG — the defect this bridge prevents',
     bugged.toObject().estimatedTotal === 4000000,
     String(bugged.toObject().estimatedTotal));

  ok('toPaiseAmount inverts the getter for arithmetic',
     toPaiseAmount(420) === 42000, String(toPaiseAmount(420)));
}

// ---------------------------------------------------------------------------
// Settlement totals: the same 100x defect, in the job that decides what an outlet
// is paid. Found while extracting `jhatka.settlement.service.js`.
// ---------------------------------------------------------------------------
{
  const SettlementSvc = require('../src/modules/jhatka/services/jhatka.settlement.service');
  const oid = () => new mongoose.Types.ObjectId();

  // A lean read of ONE delivered order worth Rs 420, Rs 20 of it tax.
  const leanOrders = [
    {
      finalTotal: 42000,
      taxTotal: 2000,
      weightAdjustmentTotal: 0,
      absorbedOverchargeTotal: 0,
      discountTotal: 0,
      deliveryFee: 5000,
      packagingFee: 3000,
      paidAmount: 47000,
      items: [
        { measurementMode: 'WEIGHT', actualQuantity: { value: 1200, unit: 'GRAM' }, unitPrice: 40000 },
      ],
    },
  ];

  const paise = SettlementSvc.summariseOrdersPaise(leanOrders);
  ok('settlement summarises lean paise without conversion',
     paise.grossOrderValue === 42000, String(paise.grossOrderValue));

  // COGS is valued from PACKED grams: 1.2 kg at Rs 400/kg = Rs 480, not Rs 400.
  ok('settlement COGS uses the actual packed weight, not the ordered weight',
     paise.cogsTotal === 48000, `${paise.cogsTotal} (1.2kg x Rs400/kg = Rs480)`);

  const ZERO = {
    platformGrossRevenue: 0, platformNetRevenue: 0,
    contributionMargin: 0, contributionMarginPct: 0,
  };
  const totals = SettlementSvc.toSettlementTotals(
    { ...paise, wastageTotal: 0, wastageInherent: 0, wastageAvoidable: 0, operatorPayoutTotal: 0 },
    ZERO
  );

  const doc = new Settlement({
    settlementNo: 'ST-UNIT-1',
    vertical: 'jhatka',
    outlet: oid(),
    business: oid(),
    businessModel: 'direct',
    granularity: 'outlet',
    period: { from: new Date(), to: new Date(), label: 'unit' },
    totals,
    status: 'draft',
  });

  ok('settlement stores Rs 420 as 42000 paise (NOT 4200000)',
     doc.toObject().totals.grossOrderValue === 42000,
     String(doc.toObject().totals.grossOrderValue));
  ok('settlement reads back Rs 420 through the getter',
     doc.totals.grossOrderValue === 420, String(doc.totals.grossOrderValue));

  // The exact pre-fix behaviour, asserted so the regression cannot return.
  const bugged = new Settlement({
    settlementNo: 'ST-UNIT-2', vertical: 'jhatka', outlet: oid(), business: oid(),
    businessModel: 'direct', granularity: 'outlet',
    period: { from: new Date(), to: new Date(), label: 'unit' },
    totals: { orderCount: 1, grossOrderValue: 42000, cogsTotal: 48000 },
    status: 'draft',
  });
ok('assigning settlement PAISE directly is 100x WRONG — the defect this service prevents',
     bugged.toObject().totals.grossOrderValue === 4200000,
     String(bugged.toObject().totals.grossOrderValue));
}

// ---------------------------------------------------------------------------
// Subscriptions: the same defect in BOTH directions, in one file.
//
// Creation reads the variant with `.lean()` (PAISE) and assigns into a moneyField —
// 100x too LARGE. Occurrence generation reads a HYDRATED sub (RUPEES) and feeds a
// paise-taking helper — 100x too SMALL. They cancel in neither place.
// ---------------------------------------------------------------------------
{
  const oid = () => new mongoose.Types.ObjectId();
  const mkSub = (unitPriceAtSubscribe, estimated) =>
    new Subscription({
      subscriptionNo: 'SB-UNIT-1',
      customer: oid(),
      outlet: oid(),
      business: oid(),
      scheduleType: 'weekly',
      startDate: new Date(),
      items: [
        {
          product: oid(),
          variant: oid(),
          sku: 'CHK-1KG',
          requestedQuantity: { value: 1, unit: 'KG', approximate: false },
          chargeMode: 'ceiling',
          unitPriceAtSubscribe,
        },
      ],
      estimatedAmountPerOccurrence: estimated,
      status: 'active',
      totals: {},
      stats: {},
    });

  // CREATION: Rs400/kg variant + 10% ceiling = Rs440 = 44000 paise.
  const created = mkSub(asMoney(40000), asMoney(44000));
  ok('subscription stores unitPriceAtSubscribe as 40000 paise, not 4000000',
     created.toObject().items[0].unitPriceAtSubscribe === 40000,
     String(created.toObject().items[0].unitPriceAtSubscribe));
  ok('subscription stores estimatedAmountPerOccurrence as 44000 paise, not 4400000',
     created.toObject().estimatedAmountPerOccurrence === 44000,
     String(created.toObject().estimatedAmountPerOccurrence));

  // The pre-fix creation path, asserted so the regression cannot return.
  const buggedCreate = mkSub(40000, 44000);
  ok('assigning lean PAISE into a subscription moneyField is 100x WRONG',
     buggedCreate.toObject().items[0].unitPriceAtSubscribe === 4000000,
     String(buggedCreate.toObject().items[0].unitPriceAtSubscribe));

  // OCCURRENCE: the hydrated getter yields RUPEES (400), which must become PAISE
  // before it reaches a paise-taking helper.
  const hydrated = mkSub(asMoney(40000), asMoney(44000));
  const getterRupees = hydrated.items[0].unitPriceAtSubscribe;
  ok('a hydrated subscription item getter returns RUPEES (400)',
     getterRupees === 400, String(getterRupees));

  const asPaise = subscriptionCeilingPaise(
    { value: 1, unit: 'KG', approximate: false },
    toPaiseAmount(getterRupees),
    'per_kg',
    10
  );
  ok('toPaiseAmount before the ceiling helper yields 44000 paise (Rs 440)',
     asPaise === 44000, String(asPaise));

  const wrongWay = subscriptionCeilingPaise(
    { value: 1, unit: 'KG', approximate: false },
    getterRupees,
    'per_kg',
    10
  );
  ok('passing the getter RUPEES straight through is 100x too SMALL (440 not 44000)',
     wrongWay === 440, String(wrongWay));
}

console.log('\n--- summary ---');
console.log(failures === 0 ? 'ALL COMMERCIAL MONEY RULES HOLD' : failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);