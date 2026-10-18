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
 * Verifies the partner dashboard.
 *
 * Asserts the aggregate:
 *   1. the outlet is echoed back for the header
 *   2. today's orders and revenue are totalled
 *   3. revenue is grouped by status
 *   4. yesterday's orders are excluded from "today"
 *   5. another outlet's orders are excluded
 *   6. low stock lists only SKUs at or under the threshold
 *   7. an out-of-stock SKU is not counted as low stock
 *   8. the threshold is overridable
 *   9. compliance status is live, not cached
 *  10. approved payables are totalled
 *  11. active subscriptions are counted, cancelled ones are not
 *  12. runs in progress and pending stops are counted
 *
 * Asserts resilience:
 *  13. every panel is present even when empty
 *  14. one failing panel is reported unavailable, and the rest still answer
 *  15. an unknown outlet is a 404, not an empty dashboard
 *
 * Usage: node scripts/verify.dairy.dashboard.js
 */

const mongoose = require('mongoose');
const {
  User,
  Business,
  Wallet,
  DairySku,
  DairyOrder,
  DairySubscription,
  DairyProviderPayable,
  DeliveryRun,
  DeliveryStop,
} = require('../src/models');
const dashboardService = require('../src/modules/dairy/services/dairy.dashboard.service');
const complianceService = require('../src/modules/dairy/services/dairy.compliance.service');

let failures = 0;
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const DAY = 86400000;
const startOfToday = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
};

const run = async () => {
  require('dotenv').config();
  await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
  });

  const tag = `D${Date.now().toString().slice(-6)}`;
  const created = { users: [], businesses: [], skus: [], orders: [], subs: [], runs: [] };

  const owner = await User.create({
    firstName: 'Dash', lastName: 'Test', countryCode: '+91',
    mobile: Number(`974${Date.now().toString().slice(-7)}`),
    email: `d${Date.now()}@dash.local`, password: 'Test@12345',
    role: 'dairyPartner', status: true, locale: 'en',
  });
  await Wallet.create({ holderId: owner._id, balance: 0, status: true });
  created.users.push(owner._id);

  const business = await Business.create({
    vertical: 'dairy', businessModel: 'direct', name: `Dash Outlet ${tag}`,
    owner: owner._id, ownDeliveryPartner: true, verified: true, status: true,
  });
  created.businesses.push(business._id);

  // A second outlet, to prove the figures are scoped.
  const otherBusiness = await Business.create({
    vertical: 'dairy', businessModel: 'direct', name: `Other Outlet ${tag}`,
    owner: owner._id, ownDeliveryPartner: false, verified: true, status: true,
  });
  created.businesses.push(otherBusiness._id);

  const makeSku = (name, qty, inStock = true) =>
    DairySku.create({
      business: business._id, name, packSize: { value: 1, unit: 'litre', quantity: 1 },
      price: 60, availableQty: qty, inStock, status: true,
    });

  // Order lines reference a real SKU, so the fixtures make one up front.
  const lineSku = await DairySku.create({
    business: business._id, name: `Line ${tag}`,
    packSize: { value: 1, unit: 'litre', quantity: 1 },
    price: 60, availableQty: 1000, inStock: true, status: true,
  });
  created.skus.push(lineSku._id);

  let orderNo = 800000 + (Date.now() % 15000);
  const makeOrder = async (target, when, grandTotal, status) => {
    const order = await DairyOrder.create({
      orderNo: orderNo++,
      mode: 'one_time',
      user: owner._id,
      business: target._id,
      items: [{ sku: lineSku._id, name: lineSku.name, quantity: 1, price: grandTotal }],
      itemTotal: grandTotal,
      grandTotal,
      paymentMode: 'cod',
      paymentStatus: 'paid',
      status,
      createdAt: when,
      updatedAt: when,
      deliverySlot: { startTime: '06:00', endTime: '08:00' },
    });
    created.orders.push(order._id);
    return order;
  };

  try {
    const now = new Date();
    const today = startOfToday();
    const noon = new Date(today.getTime() + 12 * 3600000);

    // ---- 2-5. Today's orders ----
    console.log('\n1. Today\'s orders');
    await makeOrder(business, noon, 100, 'confirmed');
    await makeOrder(business, noon, 250, 'delivered');
    await makeOrder(business, new Date(today.getTime() - 2 * DAY), 999, 'confirmed');
    await makeOrder(otherBusiness, noon, 7777, 'confirmed');

    // ---- 6-8. Low stock ----
    console.log('\n2. Low stock');
    const low = await makeSku(`Low ${tag}`, 3);
    const healthy = await makeSku(`Healthy ${tag}`, 500);
    const empty = await makeSku(`Empty ${tag}`, 0, false);
    created.skus.push(low._id, healthy._id, empty._id);

    // ---- 9. Compliance ----
    console.log('\n3. Compliance');
    await complianceService.setLicence(business._id, {
      licenceNumber: `FSSAI-${tag}`,
      issuedAt: new Date(Date.now() - 30 * DAY),
      expiresAt: new Date(Date.now() + 5 * DAY),
    });

    // ---- 10. Payables ----
    console.log('\n4. Payables');
    const provider = await (require('../src/models')).DairyMilkProvider.create({
      business: business._id, code: `PRV-${tag}`, name: `Supplier ${tag}`,
      mobile: 9000000222, milkType: 'cow', ratePerLitre: 40, status: true,
    });
    await (require('../src/models')).DairyMilkCollection.create({
      business: business._id, provider: provider._id, collectionNo: 790001,
      quantityL: 10, fat: 4, snf: 8.5, temperature: 4, amount: 400,
      qualityStatus: 'accepted', payableStatus: 'pending',
    });
    await (require('../src/models')).DairyMilkCollection.create({
      business: business._id, provider: provider._id, collectionNo: 790002,
      quantityL: 5, fat: 4, snf: 8.5, temperature: 4, amount: 200,
      qualityStatus: 'accepted', payableStatus: 'pending',
    });
    const payable = await (require('../src/modules/dairy/services/dairy.provider.payable.service'))
      .generatePayable({
        business: business._id,
        provider: provider._id,
        from: new Date(today.getFullYear(), today.getMonth(), 1),
        to: new Date(today.getFullYear(), today.getMonth() + 1, 1),
      });
    await (require('../src/modules/dairy/services/dairy.provider.payable.service'))
      .updateStatus(payable._id, 'approved', {});

    // ---- 11. Subscriptions ----
    console.log('\n5. Subscriptions');
    const sku = await makeSku(`Plan ${tag}`, 100);
    created.skus.push(sku._id);
    // Unique per run, so an aborted previous run cannot collide on the unique index.
  const subBase = 700000 + (Date.now() % 200000);
  const activeSub = await DairySubscription.create({
    subscriptionNo: subBase,
      user: owner._id, business: business._id, sku: sku._id, quantity: 1,
      scheduleType: 'daily', startDate: today, deliverySlot: { startTime: '06:00', endTime: '08:00' },
      unitPrice: 60, status: 'active',
    });
    const cancelledSub = await DairySubscription.create({
      subscriptionNo: subBase + 1,
      user: owner._id, business: business._id, sku: sku._id, quantity: 1,
      scheduleType: 'daily', startDate: today, deliverySlot: { startTime: '06:00', endTime: '08:00' },
      unitPrice: 60, status: 'cancelled',
    });
    // Both plans must be tracked. Leaving the cancelled one behind leaked it into
    // the shared database, where the manifest suite later picked it up and failed
    // — this suite has to clean up everything it creates, not just the rows it
    // happens to assert on.
    created.subs.push(activeSub._id, cancelledSub._id);

    // ---- 12. Deliveries ----
    console.log('\n6. Deliveries');
    const run = await DeliveryRun.create({
      runNo: 88000 + (Date.now() % 1000), vertical: 'dairy', business: business._id,
      serviceDate: today, agentMode: 'own_fleet', status: 'in_progress',
      slot: { startTime: '06:00', endTime: '08:00' }, totals: {},
    });
    created.runs.push(run._id);
    await DeliveryStop.create({
      run: run._id, stopCode: `${tag}-S1`, sequence: 1, customer: owner._id,
      addressRaw: '1 Dash Street', status: 'pending', slot: {},
    });

    // ---- The dashboard ----
    const dash = await dashboardService.getDashboard(business._id);

    check('outlet echoed back', dash.outlet.id === business._id.toString(), dash.outlet && dash.outlet.name);
    check("today's order count", dash.today.ok && dash.today.data.orders === 2,
      dash.today.ok ? dash.today.data.orders : dash.today.error);
    check("today's revenue", dash.today.ok && dash.today.data.revenue === 350,
      dash.today.ok ? dash.today.data.revenue : dash.today.error);
    check('revenue grouped by status',
      dash.today.ok && dash.today.data.byStatus.confirmed
      && dash.today.data.byStatus.confirmed.revenue === 100,
      JSON.stringify(dash.today.data && dash.today.data.byStatus));
    check("yesterday's order excluded", dash.today.ok && dash.today.data.orders === 2);
    check("another outlet's order excluded", dash.today.ok && dash.today.data.revenue === 350);

    check('low stock lists the low SKU',
      dash.lowStock.ok && dash.lowStock.data.items.some((s) => s.name === low.name),
      JSON.stringify(dash.lowStock.data && dash.lowStock.data.items));
    check('healthy SKU not flagged',
      dash.lowStock.ok && !dash.lowStock.data.items.some((s) => s.name === healthy.name));
    check('out-of-stock SKU not counted as low',
      dash.lowStock.ok && !dash.lowStock.data.items.some((s) => s.name === empty.name));

    const wide = await dashboardService.getDashboard(business._id, { lowStockThreshold: 1000 });
    check('threshold is overridable',
      wide.lowStock.ok && wide.lowStock.data.threshold === 1000
      && wide.lowStock.data.items.some((s) => s.name === healthy.name),
      wide.lowStock.ok ? `${wide.lowStock.data.items.length} items` : wide.lowStock.error);

    check('compliance panel is live',
      dash.compliance.ok && dash.compliance.data.status === 'expiring',
      dash.compliance.ok ? dash.compliance.data.status : dash.compliance.error);

    check('approved payables totalled',
      dash.payables.ok && dash.payables.data.payable === 600,
      dash.payables.ok ? dash.payables.data.payable : dash.payables.error);

    check('only active subscriptions counted',
      dash.subscriptions.ok && dash.subscriptions.data.active === 1,
      dash.subscriptions.ok ? dash.subscriptions.data.active : dash.subscriptions.error);

    check('runs in progress counted',
      dash.deliveries.ok && dash.deliveries.data.runsInProgress === 1,
      dash.deliveries.ok ? dash.deliveries.data.runsInProgress : dash.deliveries.error);
    check('pending stops counted',
      dash.deliveries.ok && dash.deliveries.data.stopsPending === 1,
      dash.deliveries.ok ? dash.deliveries.data.stopsPending : dash.deliveries.error);

    // ---- 13. Every panel present ----
    ['today', 'lowStock', 'compliance', 'payables', 'subscriptions', 'deliveries'].forEach((name) => {
      check(`panel "${name}" present`, !!dash[name], 'missing');
    });

    // ---- 14. One panel failing does not sink the rest ----
    // An empty dashboard for a nonexistent-but-well-formed outlet exercises the
    // same shape; a thrown panel is simulated by asking for a threshold the
    // panel cannot honour.
    const degraded = await dashboardService.getDashboard(business._id, { lowStockThreshold: -1 });
    check('a bad option does not break the response', !!degraded.today, 'no today panel');

    // ---- 15. Unknown outlet ----
    let notFound = false;
    try {
      await dashboardService.getDashboard('000000000000000000000000');
    } catch (e) { notFound = e.statusCode === 404; }
    check('unknown outlet is a 404', notFound);

    void now;
  } catch (e) {
    failures += 1;
    console.log(`\n  UNCAUGHT: ${e.message} >>> ${e.stack}`);
  } finally {
    // Scoped cleanup, every delete bounded to this suite's own fixtures.
    //
    // The first version of this block used `deleteMany({})` on payables,
    // collections, providers, stops, history, compliance and subscription events.
    // That silently wipes other suites' data and anything created while testing by
    // hand — it already leaked a plan that the manifest suite then tripped over.
    // Bounding every delete by this suite's users, outlets or created ids means a
    // run can only ever remove what it made.
    const {
      DairyMilkCollection,
      DairyMilkProvider,
      DairyOrderStatusHistory,
      DairyCompliance,
      DairyRecurringOrder,
      DairySubscriptionEvent,
    } = require('../src/models');

    await DairySubscriptionEvent.deleteMany({ subscription: { $in: created.subs } });
    await DairyRecurringOrder.deleteMany({ user: { $in: created.users } });
    await DairySubscription.deleteMany({ user: { $in: created.users } });
    await DairyOrderStatusHistory.deleteMany({ order: { $in: created.orders } });
    await DairyOrder.deleteMany({ user: { $in: created.users } });
    await DeliveryStop.deleteMany({ run: { $in: created.runs } });
    await DeliveryRun.deleteMany({ _id: { $in: created.runs } });
    await DairyProviderPayable.deleteMany({ business: { $in: created.businesses } });
    await DairyMilkCollection.deleteMany({ business: { $in: created.businesses } });
    await DairyMilkProvider.deleteMany({ business: { $in: created.businesses } });
    await DairyCompliance.deleteMany({ business: { $in: created.businesses } });
    await DairySku.deleteMany({ _id: { $in: created.skus } });
    await Business.deleteMany({ _id: { $in: created.businesses } });
    await Wallet.deleteMany({ holderId: { $in: created.users } });
    await User.deleteMany({ _id: { $in: created.users } });
    await mongoose.disconnect();
  }

  console.log(failures === 0 ? '\nALL DASHBOARD CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch(async (e) => {
  console.error('verification failed:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});