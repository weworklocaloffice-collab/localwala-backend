/**
 * verify.realestate.money.edges.js — rupees-at-the-edges gate.
 *
 * `moneyField` stores paise and exposes rupees through getters. `lean()`
 * bypasses getters, so every lean read ships paise — a silent 100x bug
 * (Flow 12 fixed the loan paths; gate [10d] there is the precedent).
 *
 * This gate pins the convention for EVERY money-carrying read edge in the
 * vertical: probe documents are created with known rupee amounts through
 * the model setters, then read back through the exact service function
 * each controller calls. The assertion is always rupees-in == rupees-out.
 *
 * Edges covered (live section [10]):
 *   public search / nearby / featured / recent / similar + price filter
 *   property findByIdOrCode / findById / findByIdForVendor
 *   customer visit requests (populated property price)
 *   vendor holds / sales / commissions / orders / packages / entitlements
 *   vendor + executive visits and leads (no money — shape anchors)
 *
 * Run: node scripts/verify.realestate.money.edges.js
 */

const path = require('path');

// Same .env the app boots from (API/.env) — the live section needs MONGODB_URL.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const SVC = (...parts) => path.resolve(__dirname, '..', 'src', 'modules', 'realestate', 'services', ...parts);
const MDL = (...parts) => path.resolve(__dirname, '..', 'src', 'modules', 'realestate', 'models', ...parts);

const propertyService = require(SVC('realestate.property.service.js'));
const searchService = require(SVC('realestate.property.search.service.js'));
const visitService = require(SVC('realestate.visit.service.js'));
const holdService = require(SVC('realestate.hold.service.js'));
const saleService = require(SVC('realestate.sale.service.js'));
const commissionService = require(SVC('realestate.commission.service.js'));
const orderService = require(SVC('realestate.listing.order.service.js'));
const packageService = require(SVC('realestate.listing.package.service.js'));
const leadService = require(SVC('realestate.lead.service.js'));
const entitlementService = require(SVC('realestate.listing.entitlement.service.js'));

const checks = [];
const assert = (label, ok, detail = '') => {
  checks.push({ label, ok, detail });
};

// ---- 1. The read functions exist on the services. ----
for (const [svc, name, fns] of [
  [propertyService, 'propertyService', ['findByIdOrCode', 'findById', 'findByIdForVendor', 'listForVendor']],
  [searchService, 'searchService', ['search', 'nearby', 'featured', 'recent', 'similar', 'buildPublicFilter']],
  [visitService, 'visitService', ['listVisitRequestsForCustomer', 'findVisitRequestForCustomer', 'findVisits']],
  [holdService, 'holdService', ['listForVendor']],
  [saleService, 'saleService', ['listForVendor', 'findByIdForVendor']],
  [commissionService, 'commissionService', ['listForVendor']],
  [orderService, 'orderService', ['findForVendor', 'findForVendorById']],
  [packageService, 'packageService', ['listAll', 'getPackageDetails']],
  [leadService, 'leadService', ['findLeads', 'getLeadDetail']],
  [entitlementService, 'entitlementService', ['findActiveForVendor']],
]) {
  for (const fn of fns) {
    assert(`[1] ${name}.${fn} exported`, typeof svc[fn] === 'function', typeof svc[fn]);
  }
}

// ---- 10. Live DB: rupees in, rupees out, on every money edge. ----
async function liveDbChecks() {
  const mongoose = require('mongoose');
  const url = process.env.MONGODB_URL || process.env.MONGODB_URI;
  if (!url) {
    assert('[10] live DB section', false, 'MONGODB_URL not set — skipped?');
    return;
  }
  await mongoose.connect(url, { serverSelectionTimeoutMS: 8000 });
  try {
    const RealEstatePropertyCategory = require(MDL('realestate.property.category.model.js'));
    const RealEstateProperty = require(MDL('realestate.property.model.js'));
    const RealEstatePropertyHold = require(MDL('realestate.property.hold.model.js'));
    const RealEstateSale = require(MDL('realestate.sale.model.js'));
    const RealEstateCommission = require(MDL('realestate.commission.model.js'));
    const RealEstateListingPackage = require(MDL('realestate.listing.package.model.js'));
    const RealEstateListingOrder = require(MDL('realestate.listing.order.model.js'));
    const RealEstateListingEntitlement = require(MDL('realestate.listing.entitlement.model.js'));
    const RealEstateLead = require(MDL('realestate.lead.model.js'));
    const RealEstateVisitRequest = require(MDL('realestate.visit.request.model.js'));
    const RealEstateVisit = require(MDL('realestate.visit.model.js'));
    const RealEstateFollowUp = require(MDL('realestate.followup.model.js'));
    const RealEstateLoanRequest = require(MDL('realestate.loan.request.model.js'));
    const User = require(path.resolve(__dirname, '..', 'src', 'models', 'user.model.js'));

    const stamp = Date.now();
    const vendorId = new mongoose.Types.ObjectId();
    const executiveId = new mongoose.Types.ObjectId();
    // A real user row: customer populates resolve to null without one,
    // which would make every populated-customer assertion vacuous.
    const probeUser = await User.create({
      firstName: 'Gate',
      lastName: 'Customer',
      email: `gate${stamp}@example.com`,
      password: 'GatePass123!',
      countryCode: '+91',
      mobile: `90000${String(stamp).slice(-5)}`,
    });
    const customerId = probeUser._id;
    const localityId = new mongoose.Types.ObjectId();
    const cityId = new mongoose.Types.ObjectId();
    const stateId = new mongoose.Types.ObjectId();
    const here = [78.4, 17.4];

    const category = await RealEstatePropertyCategory.create({
      key: `GATE${stamp}`,
      name: 'Gate Apartments',
    });

    const mkProperty = (code, price) =>
      RealEstateProperty.create({
        propertyCode: code,
        source: 'VENDOR',
        vendor: vendorId,
        title: `Gate Property ${code}`,
        category: category._id,
        transactionType: 'BUY',
        price,
        locality: localityId,
        city: cityId,
        state: stateId,
        location: { coordinates: here },
        status: 'PUBLISHED',
        availability: 'AVAILABLE',
      });

    const probe = await mkProperty(`RE-GATE-${stamp}A`, 5000000);
    const probe2 = await mkProperty(`RE-GATE-${stamp}B`, 5100000);

    const hold = await RealEstatePropertyHold.create({
      holdCode: `GH${stamp}`,
      property: probe._id,
      customer: customerId,
      policySnapshot: {},
      principal: 50000,
      serviceFee: 2500,
      total: 52500,
      expiresAt: new Date(Date.now() + 86400000),
    });

    const sale = await RealEstateSale.create({
      saleCode: `GS${stamp}`,
      property: probe._id,
      customer: customerId,
      vendor: vendorId,
      saleValue: 5200000,
      holdPrincipalApplied: 50000,
      transactionType: 'BUY',
    });

    const commission = await RealEstateCommission.create({
      commissionNo: `GC${stamp}`,
      ruleSnapshot: {},
      beneficiaryType: 'VENDOR',
      beneficiary: vendorId,
      baseAmount: 5200000,
      rate: 2,
      amount: 104000,
    });

    const pkg = await RealEstateListingPackage.create({
      code: `GATE${String(stamp % 1000000)}`,
      name: 'Gate Pack',
      price: 49990,
      listingCount: 10,
      durationDays: 30,
    });

    const order = await RealEstateListingOrder.create({
      orderCode: `GO${stamp}`,
      vendor: vendorId,
      package: pkg._id,
      amount: 49990,
    });

    const entitlement = await RealEstateListingEntitlement.create({
      vendor: vendorId,
      package: pkg._id,
      totalCount: 10,
      consumedCount: 3,
      effectiveTo: new Date(Date.now() + 86400000 * 30),
    });

    const lead = await RealEstateLead.create({
      leadCode: `GL${stamp}`,
      property: probe._id,
      customer: customerId,
      vendor: vendorId,
    });

    const tomorrow = new Date(Date.now() + 86400000);
    const visitRequest = await RealEstateVisitRequest.create({
      property: probe._id,
      customer: customerId,
      lead: lead._id,
      preferredDate: tomorrow,
      preferredTimeSlot: 'MORNING',
    });

    const visit = await RealEstateVisit.create({
      property: probe._id,
      customer: customerId,
      lead: lead._id,
      executive: executiveId,
      request: visitRequest._id,
      scheduledAt: tomorrow,
    });

    const followUp = await RealEstateFollowUp.create({
      lead: lead._id,
      executive: executiveId,
      nextFollowUpAt: new Date(Date.now() + 86400000 * 2),
      mode: 'CALL',
      notes: 'Gate follow-up',
    });

    const loanRequest = await RealEstateLoanRequest.create({
      customer: customerId,
      property: probe._id,
      lead: lead._id,
      requestedAmount: 5000000,
      employment: 'SALARIED',
      monthlyIncome: 75000,
    });

    // Link the money docs the lead points at (lead.hold / lead.sale).
    await RealEstateLead.updateOne({ _id: lead._id }, { hold: hold._id, sale: sale._id });

    const byId = (rows, id) => rows.find((r) => String(r._id || r.id) === String(id));

    // -- public search edges --
    const searched = await searchService.search({ category: String(category._id), limit: 100, page: 1 });
    const sRow = byId(searched.results, probe._id);
    assert('[10a] search list returns RUPEES', !!sRow && sRow.price === 5000000, `price=${sRow && sRow.price}`);

    const near = await searchService.nearby(here[0], here[1], { limit: 100 });
    const nRow = byId(near, probe._id);
    assert('[10b] nearby returns RUPEES', !!nRow && nRow.price === 5000000, `price=${nRow && nRow.price}`);

    const feat = await searchService.featured(50);
    const fRow = byId(feat, probe._id);
    assert('[10c] featured returns RUPEES', !!fRow && fRow.price === 5000000, `price=${fRow && fRow.price}`);

    const recent = await searchService.recent(50);
    const rRow = byId(recent, probe._id);
    assert('[10d] recent returns RUPEES', !!rRow && rRow.price === 5000000, `price=${rRow && rRow.price}`);

    const ranged = await searchService.search({
      category: String(category._id),
      priceMin: 4000000,
      priceMax: 5050000,
      limit: 100,
      page: 1,
    });
    assert(
      '[10e] price filter works in RUPEES (5.0M in [4M, 5.05M], 5.1M out)',
      !!byId(ranged.results, probe._id) && !byId(ranged.results, probe2._id),
      `found=${ranged.results.length}`
    );

    const detail = await propertyService.findByIdOrCode(probe.propertyCode);
    const sim = await searchService.similar(detail, 10);
    const simRow = byId(sim, probe2._id);
    assert('[10f] similar() filters in RUPEES and returns RUPEES', !!simRow && simRow.price === 5100000, `price=${simRow && simRow.price}`);

    assert('[10g] findByIdOrCode returns RUPEES', !!detail && detail.price === 5000000, `price=${detail && detail.price}`);

    const vProp = await propertyService.findByIdForVendor(probe._id, vendorId);
    assert('[10h] vendor property detail returns RUPEES', !!vProp && vProp.price === 5000000, `price=${vProp && vProp.price}`);

    // -- customer visit edges (populated property) --
    const vrList = await visitService.listVisitRequestsForCustomer(customerId, { page: 1, limit: 20 });
    const vrRow = byId(vrList.results, visitRequest._id);
    const vrPrice = vrRow && vrRow.property && vrRow.property.price;
    assert('[10i] visit-request list populated price is RUPEES', vrPrice === 5000000, `price=${vrPrice}`);

    const vrOne = await visitService.findVisitRequestForCustomer(visitRequest._id, customerId);
    const vrOnePrice = vrOne && vrOne.property && vrOne.property.price;
    assert('[10j] visit-request detail populated price is RUPEES', vrOnePrice === 5000000, `price=${vrOnePrice}`);

    // -- vendor money edges --
    const holds = await holdService.listForVendor(vendorId, {});
    const hRow = byId(holds.results, hold._id);
    assert(
      '[10k] hold list returns RUPEES',
      !!hRow && hRow.principal === 50000 && hRow.serviceFee === 2500 && hRow.total === 52500,
      `principal=${hRow && hRow.principal} fee=${hRow && hRow.serviceFee} total=${hRow && hRow.total}`
    );

    const sales = await saleService.listForVendor(vendorId, {});
    const sRow2 = byId(sales.results, sale._id);
    assert('[10l] sale list returns RUPEES', !!sRow2 && sRow2.saleValue === 5200000, `saleValue=${sRow2 && sRow2.saleValue}`);
    const sOne = await saleService.findByIdForVendor(sale._id, vendorId);
    assert('[10m] sale detail returns RUPEES', !!sOne && sOne.saleValue === 5200000, `saleValue=${sOne && sOne.saleValue}`);

    const comms = await commissionService.listForVendor(vendorId, {});
    const cRow = byId(comms.results, commission._id);
    assert(
      '[10n] commission list returns RUPEES',
      !!cRow && cRow.amount === 104000 && cRow.baseAmount === 5200000,
      `amount=${cRow && cRow.amount} base=${cRow && cRow.baseAmount}`
    );

    const orders = await orderService.findForVendor(vendorId);
    const oRow = byId(orders, order._id);
    assert('[10o] order list returns RUPEES', !!oRow && oRow.amount === 49990, `amount=${oRow && oRow.amount}`);
    const oOne = await orderService.findForVendorById(order._id, vendorId);
    assert('[10p] order detail returns RUPEES', !!oOne && oOne.amount === 49990, `amount=${oOne && oOne.amount}`);

    const pkgs = await packageService.listAll({ status: true });
    const pRow = pkgs.find((p) => String(p._id) === String(pkg._id));
    assert('[10q] package list returns RUPEES', !!pRow && pRow.price === 49990, `price=${pRow && pRow.price}`);
    const pOne = await packageService.getPackageDetails(pkg.code);
    assert('[10r] package detail returns RUPEES', !!pOne && pOne.price === 49990, `price=${pOne && pOne.price}`);

    const ents = await entitlementService.findActiveForVendor(vendorId);
    const eRow = byId(ents, entitlement._id);
    assert(
      '[10s] entitlement counts intact',
      !!eRow && eRow.totalCount === 10 && eRow.consumedCount === 3,
      `total=${eRow && eRow.totalCount} consumed=${eRow && eRow.consumedCount}`
    );

    // -- shape anchors (no money on these docs) --
    const visits = await visitService.findVisits({ vendor: vendorId });
    assert('[10t] vendor visit list resolves through the property chain', visits.some((v) => String(v._id) === String(visit._id)), `rows=${visits.length}`);

    const leads = await leadService.findLeads({ vendor: vendorId });
    assert('[10u] vendor lead list returns rows', leads.some((l) => String(l._id) === String(lead._id)), `rows=${leads.length}`);
    const detail2 = await leadService.getLeadDetail(lead._id);
    assert('[10v] lead detail carries activities', !!detail2 && Array.isArray(detail2.activities), `activities=${detail2 && detail2.activities && detail2.activities.length}`);

    // -- populated names (list rows must render without a second lookup) --
    const leadRow = leads.find((l) => String(l._id) === String(lead._id));
    const leadCustomer = leadRow && leadRow.customer;
    assert(
      '[10w] lead rows carry a populated customer',
      !!leadCustomer && typeof leadCustomer === 'object' && leadCustomer.firstName === 'Gate' && !!leadCustomer.mobile,
      `customer=${JSON.stringify(leadCustomer)}`
    );
    const visitRow = visits.find((v) => String(v._id) === String(visit._id));
    assert(
      '[10x] visit rows carry a populated customer and property',
      !!visitRow &&
        !!visitRow.customer && typeof visitRow.customer === 'object' &&
        !!visitRow.property && typeof visitRow.property === 'object' && 'title' in visitRow.property,
      `customer=${typeof (visitRow && visitRow.customer)} property=${typeof (visitRow && visitRow.property)}`
    );
    assert(
      '[10y] lead detail carries populated customer and property',
      !!detail2 &&
        !!detail2.customer && typeof detail2.customer === 'object' &&
        !!detail2.property && typeof detail2.property === 'object',
      `customer=${typeof (detail2 && detail2.customer)} property=${typeof (detail2 && detail2.property)}`
    );
    assert(
      '[10z] sale rows carry a populated customer',
      !!sRow2 && !!sRow2.customer && typeof sRow2.customer === 'object',
      `customer=${typeof (sRow2 && sRow2.customer)}`
    );
    assert(
      '[10aa] hold rows carry populated customer and property',
      !!hRow &&
        !!hRow.customer && typeof hRow.customer === 'object' &&
        !!hRow.property && typeof hRow.property === 'object',
      `customer=${typeof (hRow && hRow.customer)} property=${typeof (hRow && hRow.property)}`
    );

    // -- lead crossroads (detail joins visits, follow-ups, hold, sale, loans) --
    const crossroads = await leadService.getLeadDetail(lead._id);
    assert(
      '[10ab] lead detail carries its visits',
      Array.isArray(crossroads.visits) && crossroads.visits.some((v) => String(v._id) === String(visit._id)),
      `visits=${crossroads.visits && crossroads.visits.length}`
    );
    assert(
      '[10ac] lead detail carries its follow-ups',
      Array.isArray(crossroads.followUps) && crossroads.followUps.some((f) => String(f._id) === String(followUp._id)),
      `followUps=${crossroads.followUps && crossroads.followUps.length}`
    );
    assert(
      '[10ad] lead detail hold is RUPEES',
      !!crossroads.hold && crossroads.hold.principal === 50000 && crossroads.hold.total === 52500,
      `principal=${crossroads.hold && crossroads.hold.principal}`
    );
    assert(
      '[10ae] lead detail sale is RUPEES',
      !!crossroads.sale && crossroads.sale.saleValue === 5200000,
      `saleValue=${crossroads.sale && crossroads.sale.saleValue}`
    );
    const crossLoan = crossroads.loanRequests && crossroads.loanRequests[0];
    assert(
      '[10af] lead detail loan request is RUPEES',
      !!crossLoan && crossLoan.requestedAmount === 5000000 && crossLoan.monthlyIncome === 75000,
      `requestedAmount=${crossLoan && crossLoan.requestedAmount}`
    );

    // -- cleanup --
    await User.deleteOne({ _id: probeUser._id });
    await RealEstateLoanRequest.deleteOne({ _id: loanRequest._id });
    await RealEstateFollowUp.deleteOne({ _id: followUp._id });
    await RealEstateVisit.deleteOne({ _id: visit._id });
    await RealEstateVisitRequest.deleteOne({ _id: visitRequest._id });
    await RealEstateLead.deleteOne({ _id: lead._id });
    await RealEstateListingEntitlement.deleteOne({ _id: entitlement._id });
    await RealEstateListingOrder.deleteOne({ _id: order._id });
    await RealEstateListingPackage.deleteOne({ _id: pkg._id });
    await RealEstateCommission.deleteOne({ _id: commission._id });
    await RealEstateSale.deleteOne({ _id: sale._id });
    await RealEstatePropertyHold.deleteOne({ _id: hold._id });
    await RealEstateProperty.deleteOne({ _id: probe._id });
    await RealEstateProperty.deleteOne({ _id: probe2._id });
    await RealEstatePropertyCategory.deleteOne({ _id: category._id });
  } finally {
    await mongoose.disconnect();
  }
}

// ---- Report ----
liveDbChecks()
  .catch((e) => {
    assert('[10] live DB section', false, e.message);
  })
  .then(() => {
    let failed = 0;
    console.log('Money edges (rupees at the edges) — gate');
    console.log('==========================================');
    for (const c of checks) {
      const mark = c.ok ? 'OK  ' : 'FAIL';
      console.log(`  [${mark}] ${c.label}${c.detail ? '  — ' + c.detail : ''}`);
      if (!c.ok) failed += 1;
    }
    console.log('');
    if (failed) {
      console.log(`${failed} of ${checks.length} checks FAILED`);
      process.exit(1);
    }
    console.log(`ALL ${checks.length} MONEY EDGE CHECKS PASSED`);
  });
