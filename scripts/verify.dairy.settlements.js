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
 * Verifies partner and franchise agreements and the settlement engine.
 *
 * Sign convention under test: `netAmount` is POSITIVE when the platform owes the
 * counterparty and NEGATIVE when the counterparty owes the platform. One
 * convention across both settlement types.
 *
 * Asserts agreements:
 *   1. partner created and outlet marked commission_partner
 *   2. duplicate agreement for an outlet refused
 *   3. commission outside 0-100 refused
 *   4. commission rate renegotiated
 *   5. suspension and termination, with the reason kept
 *   6. illegal status move refused
 *   7. franchise created and outlet marked franchise
 *   8. franchise procurement hidden on a full-supply model
 *   9. overlapping franchise territory refused
 *
 * Asserts period maths:
 *  10. weekly period starts on Monday
 *  11. monthly period spans the calendar month
 *
 * Asserts commission settlements:
 *  12. only delivered AND paid orders count
 *  13. commission on goods only by default
 *  14. commission includes delivery charges when the basis says so
 *  15. netAmount POSITIVE — platform owes the partner
 *  16. line items frozen into the statement
 *  17. a second settlement for the same period refused
 *  18. preview writes nothing
 *  19. a rate change does not restate an approved settlement
 *
 * Asserts franchise settlements:
 *  20. netAmount NEGATIVE — franchisee owes the platform
 *  21. revenue share and royalty deducted
 *  22. joining fee charged only in the agreement's first period
 *
 * Asserts the approval flow:
 *  23. draft -> submitted -> approved -> paid
 *  24. illegal transitions refused
 *  25. paying an unapproved settlement refused
 *  26. payout credits the partner wallet and records a transaction
 *  27. payout debits a franchisee with insufficient balance refused
 *  28. paid settlement is terminal
 *
 * Usage: node scripts/verify.dairy.settlements.js
 */

const mongoose = require('mongoose');
const {
  User,
  Business,
  Wallet,
  Transactions,
  DairyPartner,
  DairyFranchise,
  DairySettlement,
  DairyOrder,
  DairyOrderStatusHistory,
  City,
  Locality,
  DairySku,
} = require('../src/models');
const partnerService = require('../src/modules/dairy/services/dairy.partner.service');
const settlementService = require('../src/modules/dairy/services/dairy.settlement.service');

let failures = 0;
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const run = async () => {
  require('dotenv').config();
  await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
  });

  const asha = await User.findOne({ countryCode: '+91', mobile: '9000000001' });
  if (!asha) {
    console.error('Seed data missing. Run: node/scripts/seed.dairy.js');
    process.exit(1);
  }
  const tag = `S${Date.now().toString().slice(-6)}`;

  const makeUser = async (name, mobile) => {
    const u = await User.create({
      firstName: name, lastName: 'Test', countryCode: '+91', mobile: Number(mobile),
      email: `${mobile}@settle.local`, password: 'Test@12345',
      role: 'dairyPartner', status: true, locale: 'en',
    });
    await Wallet.create({ holderId: u._id, balance: 0, status: true });
    return u;
  };

  const partnerUser = await makeUser('Priya', `991${Date.now().toString().slice(-7)}1`);
  const operatorUser = await makeUser('Ravi', `992${Date.now().toString().slice(-7)}2`);
  const customer = await makeUser('Buyer', `993${Date.now().toString().slice(-7)}3`);

  const partnerBusiness = await Business.create({
    vertical: 'dairy', businessModel: 'direct', name: `Partner Outlet ${tag}`,
    owner: partnerUser._id, ownDeliveryPartner: false, verified: true, status: true,
  });
  const franchiseBusiness = await Business.create({
    vertical: 'dairy', businessModel: 'direct', name: `Franchise Outlet ${tag}`,
    owner: operatorUser._id, ownDeliveryPartner: false, verified: true, status: true,
  });

  const locality = await Locality.findOne();
  const created = { partners: [], franchises: [], orders: [], skus: [] };

  // Orders reference a real SKU, so make one per outlet.
  const makeSku = async (business, name) => {
    const sku = await DairySku.create({
      business: business._id, name, packSize: { value: 1, unit: 'litre', quantity: 1 },
      price: 60, availableQty: 500, inStock: true, status: true,
    });
    created.skus.push(sku);
    return sku;
  };
  const partnerSku = await makeSku(partnerBusiness, `Partner Milk ${tag}`);
  const franchiseSku = await makeSku(franchiseBusiness, `Franchise Milk ${tag}`);

  /**
   * Creates a settled order. `status` and `paymentStatus` decide whether it
   * counts toward a settlement.
   */
  const makeOrder = async (business, sku, { itemTotal, serviceCharge, status, paymentStatus, deliveredAt }) => {
    const order = await DairyOrder.create({
      orderNo: 9900000 + Math.floor(Math.random() * 90000),
      mode: 'one_time',
      user: customer._id,
      business: business._id,
      items: [{ sku: sku._id, name: sku.name, quantity: 1, price: itemTotal }],
      itemTotal,
      serviceCharge,
      grandTotal: Number((itemTotal + serviceCharge).toFixed(2)),
      paymentMode: 'cod',
      paymentStatus,
      status,
      deliveredAt,
      addressRaw: '1 Test Street',
      deliverySlot: { startTime: '06:00', endTime: '08:00' },
    });
    created.orders.push(order);
    return order;
  };

  try {
    // ---- 1-6. Partner agreement ----
    console.log('\n1. Partner agreement');
    const partner = await partnerService.createPartner({
      business: partnerBusiness._id,
      user: partnerUser._id,
      partnerCode: `CP-${tag}`,
      name: `Priya ${tag}`,
      commissionPercentage: 12,
      agreement: { startDate: new Date(Date.now() - 60 * 24 * 3600000) },
      payoutMethod: 'wallet',
    });
    created.partners.push(partner);
    check('partner created', !!partner._id);
    const bizAfter = await Business.findById(partnerBusiness._id);
    check('outlet marked commission_partner', bizAfter.businessModel === 'commission_partner',
      `got ${bizAfter.businessModel}`);
    check('commission rate stored as a percentage', partner.commissionPercentage === 12,
      `got ${partner.commissionPercentage}`);
    check('commission basis defaults to product_only', partner.commissionBasis === 'product_only');

    let dupRefused = false;
    try {
      await partnerService.createPartner({
        business: partnerBusiness._id, user: partnerUser._id,
        partnerCode: `CP2-${tag}`, name: 'Dup',
        commissionPercentage: 5, agreement: { startDate: new Date() },
      });
    } catch (e) { dupRefused = e.statusCode === 400; }
    check('second agreement for the same outlet refused', dupRefused);

    let badRateRefused = false;
    try {
      await partnerService.createPartner({
        business: franchiseBusiness._id, user: operatorUser._id,
        partnerCode: `CP3-${tag}`, name: 'Bad',
        commissionPercentage: 150, agreement: { startDate: new Date() },
      });
    } catch (e) { badRateRefused = e.statusCode === 400; }
    check('commission above 100 percent refused', badRateRefused);

    await partnerService.updatePartnerTerms(partner._id, { commissionPercentage: 15 });
    check('commission renegotiated',
      (await partnerService.listPartners({})).partners.some((p) => p.commissionPercentage === 15));

    const suspended = await partnerService.setPartnerStatus(partner._id, 'suspended', { reason: 'unpaid dues' });
    check('partner suspended', suspended.status === 'suspended');

    let illegalRefused = false;
    try {
      await partnerService.setPartnerStatus(partner._id, 'active', {});
    } catch (e) { illegalRefused = false; }
    // suspended -> active is legal; suspended -> terminated is legal. Try something else.
    try {
      await partnerService.setPartnerStatus(partner._id, 'pending', {});
    } catch (e) { illegalRefused = e.statusCode === 400; }
    check('illegal partner status move refused', illegalRefused);

    const terminated = await partnerService.setPartnerStatus(partner._id, 'terminated', {
      reason: 'contract ended',
    });
    check('termination reason kept on the agreement',
      terminated.terminationReason === 'contract ended', `got ${terminated.terminationReason}`);
    await partnerService.updatePartnerTerms(partner._id, { commissionPercentage: 12 });
    await partnerService.createPartner({
      business: partnerBusiness._id, user: partnerUser._id,
      partnerCode: `CP-${tag}`, name: `Priya ${tag}`,
      commissionPercentage: 12, agreement: { startDate: new Date(Date.now() - 60 * 24 * 3600000) },
    }).catch(() => {});
    // Reinstate an active agreement for the settlement tests.
    const livePartner = await DairyPartner.findOneAndUpdate(
      { business: partnerBusiness._id },
      { $set: { status: 'active', commissionPercentage: 12 } },
      { new: true }
    );

    // ---- 7-9. Franchise agreement ----
    console.log('\n2. Franchise agreement');
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    // A fixed day inside the settlement window, so the test never depends on
    // where in the month it happens to run.
    const inWindow = (day) => new Date(now.getFullYear(), now.getMonth(), day);

    const franchise = await partnerService.createFranchise({
      business: franchiseBusiness._id,
      operator: operatorUser._id,
      franchiseCode: `FR-${tag}`,
      name: `Ravi ${tag}`,
      revenueSharePercentage: 8,
      joiningFee: 25000,
      royalty: 2000,
      territory: { city: locality ? locality.city : undefined, localities: locality ? [locality._id] : [] },
      // Agreement starts inside the window, so this is the "first period".
      agreement: { startDate: inWindow(2) },
      supplyModel: 'platform_supplied',
    });
    created.franchises.push(franchise);
    check('franchise created', !!franchise._id);
    check('outlet marked franchise',
      (await Business.findById(franchiseBusiness._id)).businessModel === 'franchise');
    check('procurement hidden on a full-supply model', franchise.procurementEnabled === false,
      `got ${franchise.procurementEnabled}`);

    if (locality) {
      let overlapRefused = false;
      try {
        await partnerService.createFranchise({
          business: franchiseBusiness._id, operator: operatorUser._id,
          franchiseCode: `FR2-${tag}`, name: 'Overlap',
          revenueSharePercentage: 5,
          territory: { city: locality.city, localities: [locality._id] },
          agreement: { startDate: new Date() },
        });
      } catch (e) {
        overlapRefused = e.statusCode === 400 || e.statusCode === 409;
      }
      check('overlapping franchise territory refused', overlapRefused);
    } else {
      console.log('  SKIP  territory overlap (no locality in database)');
    }

    // ---- 10-11. Period maths ----
    console.log('\n3. Period resolution');
    const wednesday = new Date(2026, 8, 9);
    const week = settlementService.resolvePeriod('weekly', wednesday);
    check('weekly period starts on Monday',
      week.from.getDay() === 1 && week.from.getDate() === 7,
      `from=${week.from.toDateString()} day=${week.from.getDay()}`);
    check('weekly period spans seven days',
      Math.round((week.to - week.from) / 86400000) === 7);

    const mid = new Date(2026, 8, 15);
    const month = settlementService.resolvePeriod('monthly', mid);
    check('monthly period starts on the 1st', month.from.getDate() === 1, `got ${month.from.getDate()}`);
    check('monthly period ends on the 1st of the next month',
      month.to.getDate() === 1 && month.to.getMonth() === 9,
      `to=${month.to.toDateString()}`);
    check('monthly period matches an explicit window',
      month.from.getTime() === new Date(2026, 8, 1).getTime()
      && month.to.getTime() === new Date(2026, 9, 1).getTime());

    // ---- 12-19. Commission settlement ----
    console.log('\n4. Commission settlement');

    await makeOrder(partnerBusiness._id, partnerSku, { itemTotal: 1000, serviceCharge: 40, status: 'delivered', paymentStatus: 'paid', deliveredAt: inWindow(1) });
    await makeOrder(partnerBusiness._id, partnerSku, { itemTotal: 500, serviceCharge: 40, status: 'delivered', paymentStatus: 'paid', deliveredAt: inWindow(2) });
    // Not delivered — must not count.
    await makeOrder(partnerBusiness._id, partnerSku, { itemTotal: 9999, serviceCharge: 0, status: 'confirmed', paymentStatus: 'paid', deliveredAt: inWindow(3) });
    // Delivered but unpaid (COD) — must not count.
    await makeOrder(partnerBusiness._id, partnerSku, { itemTotal: 8888, serviceCharge: 0, status: 'delivered', paymentStatus: 'pending', deliveredAt: inWindow(4) });

    const preview = await settlementService.previewSettlement({
      partnerId: livePartner._id, from, to, period: 'monthly',
    });
    check('preview counts only delivered AND paid orders', preview.orderCount === 2,
      `got ${preview.orderCount}`);
    check('preview writes nothing', (await DairySettlement.countDocuments({ partner: livePartner._id })) === 0);
    check('preview base excludes delivery charges by default',
      preview.includesDelivery === false && preview.commissionBase === 1500,
      `base=${preview.commissionBase} includes=${preview.includesDelivery}`);
    check('preview amount = base x 12 percent', preview.amount === 180, `got ${preview.amount}`);
    check('preview amount POSITIVE for a commission partner', preview.amount > 0);

    const commission = await settlementService.createCommissionSettlement({
      partnerId: livePartner._id, from, to, period: 'monthly',
    });
    check('commission settlement created', !!commission._id);
    check('only settled orders counted', commission.totals.orderCount === 2, `got ${commission.totals.orderCount}`);
    check('gross sales = 1500', commission.totals.grossSales === 1500, `got ${commission.totals.grossSales}`);
    check('commission base excludes delivery', commission.totals.commissionBase === 1500);
    check('commission amount = 180', commission.totals.commissionAmount === 180, `got ${commission.totals.commissionAmount}`);
    check('netAmount POSITIVE — platform owes the partner', commission.totals.netAmount === 180);
    check('line items frozen', commission.lineItems.length === 2, `got ${commission.lineItems.length}`);
    check('starts as a draft', commission.status === 'draft');

    let doubleRefused = false;
    try {
      await settlementService.createCommissionSettlement({ partnerId: livePartner._id, from, to, period: 'monthly' });
    } catch (e) { doubleRefused = e.statusCode === 409; }
    check('second settlement for the same period refused', doubleRefused);

    // Delivery-inclusive basis.
    const partnerWithDelivery = await DairyPartner.findByIdAndUpdate(
      livePartner._id,
      { $set: { commissionBasis: 'product_and_delivery' } },
      { new: true }
    );
    // A one-day window holding exactly one order, so the delivery charge in the
    // basis can be proven rather than inferred.
    const withDelivery = await settlementService.createCommissionSettlement({
      partnerId: partnerWithDelivery._id,
      from: inWindow(2),
      to: inWindow(3),
      period: 'daily',
    });
    check('delivery basis includes delivery charges',
      withDelivery.totals.commissionBase === 540, `base=${withDelivery.totals.commissionBase}`);
    check('delivery-inclusive commission = 540 x 12 percent',
      withDelivery.totals.commissionAmount === 64.8, `got ${withDelivery.totals.commissionAmount}`);

    // A rate change must not restate an approved settlement.
    await settlementService.updateSettlementStatus(commission._id, 'submitted', {});
    await settlementService.updateSettlementStatus(commission._id, 'approved', { actor: asha._id });
    await partnerService.updatePartnerTerms(livePartner._id, { commissionPercentage: 30 });
    const afterRateChange = await settlementService.getSettlement(commission._id);
    check('approved settlement is not restated by a later rate change',
      afterRateChange.totals.commissionAmount === 180, `got ${afterRateChange.totals.commissionAmount}`);
    check('approved rate recorded on the statement',
      afterRateChange.totals.ratePercentage === 12, `got ${afterRateChange.totals.ratePercentage}`);
    await partnerService.updatePartnerTerms(livePartner._id, { commissionPercentage: 12 });

    // ---- 20-22. Franchise settlement ----
    console.log('\n5. Franchise settlement');
    await makeOrder(franchiseBusiness._id, franchiseSku, { itemTotal: 2000, serviceCharge: 50, status: 'delivered', paymentStatus: 'paid', deliveredAt: inWindow(1) });

    const franPreview = await settlementService.previewSettlement({
      franchiseId: franchise._id, from, to, period: 'monthly',
    });
    check('franchise preview amount NEGATIVE — franchisee owes the platform',
      franPreview.amount === -160, `got ${franPreview.amount}`);

    const franSettlement = await settlementService.createFranchiseSettlement({
      franchiseId: franchise._id, from, to, period: 'monthly',
    });
    check('revenue share computed', franSettlement.totals.commissionAmount === 160,
      `got ${franSettlement.totals.commissionAmount}`);
    check('royalty deducted', franSettlement.totals.royalty === 2000, `got ${franSettlement.totals.royalty}`);
    check('joining fee charged in the agreement first period',
      franSettlement.totals.joiningFee === 25000, `got ${franSettlement.totals.joiningFee}`);
    check('netAmount NEGATIVE', franSettlement.totals.netAmount === -(160 + 2000 + 25000),
      `got ${franSettlement.totals.netAmount}`);

    const laterPeriod = await settlementService.createFranchiseSettlement({
      franchiseId: franchise._id,
      from: new Date(now.getFullYear(), now.getMonth() + 1, 1),
      to: new Date(now.getFullYear(), now.getMonth() + 2, 1),
      period: 'monthly',
    });
    check('joining fee NOT charged in a later period',
      laterPeriod.totals.joiningFee === 0, `got ${laterPeriod.totals.joiningFee}`);

    // ---- 23-28. Approval flow and payout ----
    console.log('\n6. Approval and payout');
    const walletBefore = (await Wallet.findOne({ holderId: partnerUser._id })).balance;
    const paid = await settlementService.paySettlement(commission._id, { reference: 'PAY-001' });
    check('approved settlement can be paid', paid.status === 'paid');
    check('partner wallet credited', Number(paid.totals.netAmount) === 180);
    const walletAfter = await Wallet.findOne({ holderId: partnerUser._id });
    check('wallet balance increased by the commission',
      walletAfter.balance === walletBefore + 180, `${walletBefore} -> ${walletAfter.balance}`);
    check('payout transaction recorded',
      (await Transactions.countDocuments({ payableId: partnerUser._id, type: 'dairy_settlement_credit' })) === 1);
    check('payout timestamp recorded', !!paid.paidAt);

    let payTwiceRefused = false;
    try {
      await settlementService.paySettlement(commission._id, {});
    } catch (e) { payTwiceRefused = e.statusCode === 400; }
    check('paying an already-paid settlement refused', payTwiceRefused);

    let illegalTransitionRefused = false;
    try {
      await settlementService.updateSettlementStatus(commission._id, 'draft', {});
    } catch (e) { illegalTransitionRefused = e.statusCode === 400; }
    check('paid -> draft refused', illegalTransitionRefused);

    let payUnapprovedRefused = false;
    try {
      await settlementService.paySettlement(laterPeriod._id, {});
    } catch (e) { payUnapprovedRefused = e.statusCode === 400; }
    check('paying an unapproved settlement refused', payUnapprovedRefused);

    // Franchisee with no balance cannot be debited.
    await settlementService.updateSettlementStatus(laterPeriod._id, 'submitted', {});
    await settlementService.updateSettlementStatus(laterPeriod._id, 'approved', { actor: asha._id });
    let debitRefused = false;
    try {
      await settlementService.paySettlement(laterPeriod._id, {});
    } catch (e) { debitRefused = e.statusCode === 400; }
    check('franchisee without funds cannot be debited', debitRefused);
    check('settlement left approved after a failed payout',
      (await DairySettlement.findById(laterPeriod._id)).status === 'approved');

    const summary = await settlementService.getSettlementSummary({});
    check('settlement summary groups by type', !!summary.byType.commission || !!summary.byType.franchise,
      Object.keys(summary.byType).join(','));
  } catch (e) {
    failures += 1;
    console.log(`\n  UNCAUGHT: ${e.message} >>> ${e.stack}`);
  } finally {
    await DairySettlement.deleteMany({});
    await DairyOrderStatusHistory.deleteMany({});
    await DairyOrder.deleteMany({ _id: { $in: created.orders.map((o) => o._id) } });
    await Transactions.deleteMany({ payableId: { $in: [partnerUser._id, operatorUser._id, customer._id] } });
    await Wallet.deleteMany({ holderId: { $in: [partnerUser._id, operatorUser._id, customer._id] } });
    await DairyFranchise.deleteMany({ _id: { $in: created.franchises.map((f) => f._id) } });
    await DairyPartner.deleteMany({ business: { $in: [partnerBusiness._id, franchiseBusiness._id] } });
    await DairySku.deleteMany({ _id: { $in: created.skus.map((s) => s._id) } });
    await Business.deleteMany({ _id: { $in: [partnerBusiness._id, franchiseBusiness._id] } });
    await User.deleteMany({ _id: { $in: [partnerUser._id, operatorUser._id, customer._id] } });
    await mongoose.disconnect();
  }

  console.log(failures === 0 ? '\nALL SETTLEMENT CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch(async (e) => {
  console.error('verification failed:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
