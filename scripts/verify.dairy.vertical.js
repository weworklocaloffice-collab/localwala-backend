/*
 * LocalWala - Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright (c) 2026 WeWorkLocal Private Limited
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
 * The vertical switch.
 *
 * ## What is being proven
 *
 * That turning a vertical off does what it says and no more. The failure mode for a
 * kill switch is asymmetric: too permissive and an operator believes trading has
 * stopped when it has not, which is the dangerous one. Too aggressive and riders
 * are stranded mid-run, which is the expensive one.
 *
 * So the halt is asserted to block exactly two things — a new order and a new plan
 * — and explicitly *not* to block the paths that finish what is already in
 * progress. The second half matters as much as the first: a gate that quietly also
 * stopped delivery would be a worse bug than no gate at all.
 *
 * Every state is restored in the `finally` block. The registry is shared with the
 * other suites, and leaving dairy halted would fail the next one to run.
 */

const mongoose = require('mongoose');
const {
  User,
  Business,
  Wallet,
  Vertical,
  DairySku,
  DairyOrder,
  DairySubscription,
  DairyDriver,
  DairyCan,
} = require('../src/models');
const verticalService = require('../src/kernel/vertical/services/vertical.service');
const orderService = require('../src/modules/dairy/services/dairy.order.service');
const subscriptionService = require('../src/modules/dairy/services/dairy.subscription.service');

let failures = 0;

const check = (label, ok, detail) => {
  if (ok) {
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

  const stamp = Date.now().toString().slice(-7);
  const created = { users: [], businesses: [], skus: [], orders: [], subs: [] };

  const owner = await User.create({
    firstName: 'Vert',
    lastName: 'Tester',
    countryCode: '+91',
    mobile: Number(`5${stamp}1`),
    email: `vert${stamp}a@test.local`,
    password: 'Vertical@123',
    role: 'dairyPartner',
    status: true,
  });
  created.users.push(owner._id);
  await Wallet.create({ holderId: owner._id, balance: 10000, status: true });

  const business = await Business.create({
    vertical: 'dairy',
    businessModel: 'direct',
    name: `Vert Outlet ${stamp}`,
    owner: owner._id,
    ownDeliveryPartner: false,
    verified: true,
    status: true,
  });
  created.businesses.push(business._id);

  const sku = await DairySku.create({
    business: business._id,
    name: `Vert Milk ${stamp}`,
    packSize: { value: 1, unit: 'litre', quantity: 1 },
    price: 50,
    availableQty: 100,
    inStock: true,
    status: true,
  });
  created.skus.push(sku._id);

  try {
    console.log('\n1. The registry is readable, and dairy is on it');

    const verticals = await verticalService.listVerticals();
    check('the registry lists its verticals', Array.isArray(verticals) && verticals.length >= 1,
      `${verticals.length}`);

    const dairyRow = verticals.find((v) => v.key === 'dairy');
    check('dairy is registered', Boolean(dairyRow));
    check('the list reports how many outlets use each vertical',
      dairyRow && typeof dairyRow.businessCount === 'number',
      dairyRow ? String(dairyRow.businessCount) : 'no row');

    check('dairy is trading as seeded', (await verticalService.isTradingOpen('dairy')) === true);

    // An unregistered key is closed, not open. A typo in `Business.vertical` must
    // not open a business line nobody registered.
    check('an unregistered vertical is not trading',
      (await verticalService.isTradingOpen('pharmacy')) === false);

    console.log('\n2. Halting the vertical stops new trading');

    await verticalService.setVerticalStatus('dairy', false, {
      actor: owner._id,
      reason: 'regulator hold',
    });

    check('dairy reports as halted', (await verticalService.isTradingOpen('dairy')) === false);

    const halted = await Vertical.findOne({ key: 'dairy' });
    check('the halt records who did it',
      halted.statusChangedBy && String(halted.statusChangedBy) === String(owner._id),
      `by=${halted.statusChangedBy}`);
    check('the halt records when', halted.statusChangedAt instanceof Date);
    check('the halt records why', halted.statusReason === 'regulator hold',
      `reason=${halted.statusReason}`);

    // A new order needs a cart, so the refusal is proven at the order service
    // rather than at a controller - one gate, every path.
    let orderRefused = false;
    try {
      await orderService.createOrder({ user: owner._id });
    } catch (error) {
      orderRefused = /unavailable/i.test(error.message);
    }
    check('a new order is refused while halted',
      orderRefused,
      'createOrder resolved or failed for another reason');

    let planRefused = false;
    try {
      await subscriptionService.createSubscription({
        user: owner._id,
        business: business._id,
        sku: sku._id,
        quantity: 1,
        scheduleType: 'daily',
        startDate: new Date(),
        deliverySlot: { startTime: '06:00', endTime: '08:00' },
        paymentMode: 'cod',
      });
    } catch (error) {
      planRefused = /unavailable/i.test(error.message);
    }
    check('a new plan is refused while halted', planRefused);

    let newOutletRefused = false;
    try {
      await verticalService.assertRegistered('dairy');
    } catch (error) {
      newOutletRefused = /unavailable/i.test(error.message);
    }
    check('a new outlet is refused while halted', newOutletRefused);

    console.log('\n3. A halt does not stop what is already in progress');

    // An order that exists before the halt must remain readable, and remain
    // deliverable. A gate that blocked these would strand riders between stops.
    const existingOrder = await DairyOrder.create({
      orderNo: 70000 + (Date.now() % 9000),
      mode: 'one_time',
      user: owner._id,
      business: business._id,
      items: [
        {
          sku: sku._id,
          name: sku.name,
          packSize: sku.packSize,
          quantity: 1,
          price: sku.price,
          amount: sku.price,
        },
      ],
      itemTotal: sku.price,
      grandTotal: sku.price,
      status: 'confirmed',
      paymentStatus: 'paid',
      deliverySlot: { startTime: '06:00', endTime: '08:00' },
    });
    created.orders.push(existingOrder._id);

    const readBack = await orderService.getOrder(existingOrder._id, {
      businessId: business._id.toString(),
    });
    check('an order placed before the halt is still readable',
      Boolean(readBack) && String(readBack._id) === String(existingOrder._id));

    let deliveredWhileHalted = false;
    try {
      const moved = await orderService.updateStatus(
        existingOrder._id,
        'preparing',
        { businessId: business._id.toString(), actorType: 'partner' }
      );
      deliveredWhileHalted = moved.status === 'preparing';
    } catch (error) {
      check('an order in flight can still progress', false, error.message);
    }
    check('an order in flight can still progress', deliveredWhileHalted);

    const listWhileHalted = await orderService.listOrders({ business: business._id.toString() });
    check('the outlet can still list its orders while halted',
      Array.isArray(listWhileHalted.orders) && listWhileHalted.orders.length >= 1,
      `${listWhileHalted.orders.length} order(s)`);

    console.log('\n4. Restoring the vertical reopens trading');

    await verticalService.setVerticalStatus('dairy', true, { actor: owner._id });
    check('dairy reports as trading again', (await verticalService.isTradingOpen('dairy')) === true);

    let stillRefused = false;
    try {
      await verticalService.assertTradingOpen('dairy', 'a new order cannot be placed');
    } catch (error) {
      stillRefused = true;
    }
    check('the gate stops refusing once restored', stillRefused === false);
  } catch (error) {
    failures += 1;
    console.log(`\n  UNCAUGHT: ${error.message} >>> ${error.stack}`);
  } finally {
    // Restore before cleaning up: a suite that dies with dairy halted fails every
    // suite after it.
    try {
      await Vertical.updateOne(
        { key: 'dairy' },
        {
          $set: {
            status: true,
            statusChangedBy: null,
            statusChangedAt: null,
            statusReason: null,
          },
        }
      );
    } catch (error) {
      console.log(`  restore warning: ${error.message}`);
    }

    try {
      await DairySubscription.deleteMany({ _id: { $in: created.subs } });
      await DairyOrder.deleteMany({ _id: { $in: created.orders } });
      await DairySku.deleteMany({ _id: { $in: created.skus } });
      await Business.deleteMany({ _id: { $in: created.businesses } });
      await Wallet.deleteMany({ holderId: { $in: created.users } });
      await User.deleteMany({ _id: { $in: created.users } });
    } catch (error) {
      console.log(`  cleanup warning: ${error.message}`);
    }
  }

  console.log(
    failures === 0
      ? '\nALL VERTICAL SWITCH CHECKS PASSED'
      : `\n${failures} CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error('verification failed:', error.message);
  process.exit(1);
});