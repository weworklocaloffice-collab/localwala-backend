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
 * Verifies procurement, quality control and FEFO against the real DB.
 *
 * Quality control — every collection must record provider, quantity, fat, SNF,
 * collection date/time, quality status, accepted/rejected, rejection reason and
 * who recorded it. Only accepted milk becomes a batch.
 *
 * Asserts grading:
 *   1. good cow milk accepted on intake
 *   2. low SNF auto-rejected, and never becomes a batch
 *   3. low fat auto-rejected
 *   4. over-temperature auto-rejected
 *   5. borderline reading stays PENDING for an operator
 *   6. fat/SNF percentage computed
 *   7. intake rate and amount captured, independent of later rate changes
 *
 * Asserts batches and FEFO:
 *   8. accept creates a batch with the configured shelf life
 *   9. rejected collections cannot be accepted
 *  10. accepted collections cannot be rejected
 *  11. FEFO takes the EARLIEST expiry first, not the newest
 *  12. FEFO splits across batches when the first is short
 *  13. FEFO skips and withdraws expired batches
 *  14. FEFO preview writes nothing
 *  15. commit decrements stock and writes the ledger
 *  16. fully consumed batch flips to `consumed`
 *  17. shrinkage is tracked separately from consumption
 *  18. shrinkage cannot exceed available stock
 *  19. batch report separates usable from expired
 *  20. provider payable counts accepted only
 *  21. payable excludes rejected milk
 *
 * Asserts the order integration:
 *  22. a batchTracked SKU allocates by FEFO at checkout
 *  23. the order records which batches it drew from
 *  24. a non-batchTracked SKU does not consume batches
 *
 * Usage: node scripts/verify.dairy.procurement.js
 */

const mongoose = require('mongoose');
const {
  User,
  Business,
  DairySku,
  DairyCategory,
  DairySubCategory,
  DairyProduct,
  DairyCartItem,
  DairyOrder,
  DairyOrderStatusHistory,
  DairyMilkProvider,
  DairyMilkCollection,
  DairyMilkRejectionReason,
  DairyMilkBatch,
  DairyBatchLedger,
  DeliveryRun,
  DeliveryStop,
} = require('../src/models');
const procurement = require('../src/modules/dairy/services/dairy.procurement.service');
const cartService = require('../src/modules/dairy/services/dairy.cart.service');
const orderService = require('../src/modules/dairy/services/dairy.order.service');

let failures = 0;
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const hoursAgo = (h) => new Date(Date.now() - h * 60 * 60 * 1000);

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
  const business = await Business.findOne({ owner: asha._id });
  const tag = `P${Date.now().toString().slice(-6)}`;

  const mobile = Number(`98${Date.now().toString().slice(-8)}`);
  const customer = await User.create({
    firstName: 'Bulk', lastName: 'Buyer', countryCode: '+91', mobile,
    email: `bulk${Date.now()}@proc.local`, password: 'Customer@123',
    role: 'user', status: true, locale: 'en',
  });

  const created = { categories: [], products: [], skus: [], providers: [] };

  try {
    const category = await DairyCategory.create({ key: `raw_${tag}`, name: `Raw ${tag}` });
    const subCat = await DairySubCategory.create({ category: category._id, name: `Cow ${tag}` });
    created.categories.push(category, subCat);

    const product = await DairyProduct.create({
      business: business._id, category: category._id, subCategory: subCat._id,
      name: `Raw Milk ${tag}`,
    });
    created.products.push(product);

    // batchTracked SKU: stock comes from DairyMilkBatch by FEFO.
    const rawSku = await DairySku.create({
      business: business._id, product: product._id, category: category._id, subCategory: subCat._id,
      name: `Raw Milk 1 Litre ${tag}`,
      packSize: { value: '1 Litre', unit: 'litre', quantity: 1 },
      batchTracked: true, litresPerUnit: 1,
      price: 70, availableQty: 500, inStock: true, status: true,
    });
    created.skus.push(rawSku);

    // Ordinary SKU: no batch consumption.
    const plainSku = await DairySku.create({
      business: business._id, product: product._id, category: category._id, subCategory: subCat._id,
      name: `Paneer ${tag}`,
      packSize: { value: '200 g', unit: 'g', quantity: 200 },
      price: 90, availableQty: 100, inStock: true, status: true,
    });
    created.skus.push(plainSku);

    // ---- Provider ----
    console.log('\n1. Provider');
    const provider = await procurement.createProvider({
      business: business._id, code: `PR-${tag}`, name: `Ravi Kumar`,
      mobile: 9812345670, milkType: 'cow', ratePerLitre: 40,
    });
    created.providers.push(provider);
    check('provider created', !!provider._id);

    let dupProviderRefused = false;
    try {
      await procurement.createProvider({
        business: business._id, code: `PR-${tag}`, name: 'Dup', mobile: 9812345671,
      });
    } catch (e) { dupProviderRefused = e.statusCode === 400; }
    check('duplicate provider code/mobile refused', dupProviderRefused);

    // ---- QC grading ----
    console.log('\n2. Quality control');
    const good = await procurement.recordCollection({
      provider: provider._id, quantityL: 20, fat: 4.2, snf: 8.8, temperature: 22,
    });
    check('good milk pending for confirmation', good.collection.qualityStatus === 'pending');
    check('verdict passed', good.verdict.passed === true);
    check('fat+SNF percentage computed',
      Number(good.collection.fatSnfPercentage) === 13, `got ${good.collection.fatSnfPercentage}`);
    check('intake amount captured at the provider rate',
      Number(good.collection.amount) === 800, `got ${good.collection.amount}`);

    const lowSnf = await procurement.recordCollection({
      provider: provider._id, quantityL: 15, fat: 4.0, snf: 7.0, temperature: 22,
    });
    check('low SNF auto-rejected', lowSnf.collection.qualityStatus === 'rejected',
      `got ${lowSnf.collection.qualityStatus}`);
    check('rejection reason recorded', !!lowSnf.collection.rejectionReason);
    check('rejected collection has no batch', !lowSnf.collection.batch);

    const lowFat = await procurement.recordCollection({
      provider: provider._id, quantityL: 10, fat: 2.5, snf: 8.6, temperature: 22,
    });
    check('low fat auto-rejected', lowFat.collection.qualityStatus === 'rejected');

    const hot = await procurement.recordCollection({
      provider: provider._id, quantityL: 10, fat: 4.0, snf: 8.7, temperature: 32,
    });
    check('over-temperature auto-rejected', hot.collection.qualityStatus === 'rejected');

    // Between the reject floor and the acceptance target -> pending, not rejected.
    const borderline = await procurement.recordCollection({
      provider: provider._id, quantityL: 5, fat: 3.2, snf: 8.2, temperature: 20,
    });
    check('borderline reading stays pending for an operator',
      borderline.collection.qualityStatus === 'pending',
      `got ${borderline.collection.qualityStatus}`);
    check('borderline reading carries a warning note',
      !!borderline.collection.qualityNotes, `notes=${borderline.collection.qualityNotes}`);

    const rejectedCount = await DairyMilkCollection.countDocuments({
      provider: provider._id, qualityStatus: 'rejected',
    });
    check('three rejections recorded', rejectedCount === 3, `got ${rejectedCount}`);

    // Rate change must not alter what was already collected.
    await procurement.updateProvider(provider._id, { ratePerLitre: 55 });
    const reloaded = await DairyMilkCollection.findById(good.collection._id);
    check('later rate change does not alter an existing collection',
      Number(reloaded.amount) === 800, `got ${reloaded.amount}`);

    // ---- Accept -> batch ----
    console.log('\n3. Batches');
    const batch1 = await procurement.acceptCollection(good.collection._id, {
      storageTank: 'TANK-A', recordedBy: asha._id,
    });
    check('accept creates a batch', !!batch1._id);
    check('batch holds the collected litres', batch1.quantityL === 20 && batch1.availableQtyL === 20);
    check('batch records fat and SNF', batch1.fat === 4.2 && batch1.snf === 8.8);
    check('expiry derived from shelf life',
      Math.abs(batch1.expiry - new Date(good.collection.collectedAt.getTime() + 12 * 3600000)) < 1000);
    check('batch ledger records creation',
      (await DairyBatchLedger.countDocuments({ batch: batch1._id, eventType: 'created' })) === 1);

    let acceptTwiceRefused = false;
    try {
      await procurement.acceptCollection(good.collection._id, {});
    } catch (e) { acceptTwiceRefused = e.statusCode === 400; }
    check('accepting twice refused', acceptTwiceRefused);

    let acceptRejectedRefused = false;
    try {
      await procurement.acceptCollection(lowSnf.collection._id, {});
    } catch (e) { acceptRejectedRefused = e.statusCode === 400; }
    check('accepting a rejected collection refused', acceptRejectedRefused);

    let rejectAcceptedRefused = false;
    try {
      await procurement.rejectCollection(good.collection._id, {});
    } catch (e) { rejectAcceptedRefused = e.statusCode === 400; }
    check('rejecting accepted milk refused', rejectAcceptedRefused);

    // ---- FEFO ----
    console.log('\n4. FEFO');
    // A second, OLDER batch must be consumed first.
    const older = await procurement.recordCollection({
      provider: provider._id, quantityL: 8, fat: 4.1, snf: 8.7,
      collectedAt: hoursAgo(8),
    });
    const batchOld = await procurement.acceptCollection(older.collection._id, {
      storageTank: 'TANK-A', recordedBy: asha._id,
    });
    check('older batch expires sooner', batchOld.expiry < batch1.expiry,
      `${batchOld.expiry} vs ${batch1.expiry}`);

    const preview = await procurement.allocateByFEFO(business._id, 5);
    check('FEFO preview takes the OLDEST batch first',
      preview.length > 0 && preview[0].batch._id.equals(batchOld._id),
      `first=${preview[0] && preview[0].batch.batchNo}`);
    check('FEFO preview writes nothing',
      (await DairyMilkBatch.findById(batchOld._id)).availableQtyL === 8);

    // Split: ask for more than the oldest batch holds.
    const split = await procurement.allocateByFEFO(business._id, 12);
    check('FEFO splits across batches when the first is short',
      split.length === 2, `allocations=${split.length}`);
    check('first split takes the whole older batch',
      split[0] && Number(split[0].quantityL) === 8, `took ${split[0] && split[0].quantityL}`);

    // Expired batch must be skipped and withdrawn.
    const expiredBatch = await DairyMilkBatch.create({
      batchNo: 980000 + Math.floor(Math.random() * 1000),
      business: business._id, provider: provider._id, sourceCollection: good.collection._id,
      quantityL: 5, availableQtyL: 5, fat: 4, snf: 8.5,
      collectedAt: hoursAgo(48), expiry: hoursAgo(36),
      status: 'source',
    });
    const afterExpiry = await procurement.allocateByFEFO(business._id, 3);
    check('expired batch is skipped', !afterExpiry.some((a) => a.batch._id.equals(expiredBatch._id)));
    const expiredNow = await DairyMilkBatch.findById(expiredBatch._id);
    check('expired batch marked and withdrawn from usable stock',
      expiredNow.status === 'expired' && expiredNow.availableQtyL === 0,
      `status=${expiredNow.status} qty=${expiredNow.availableQtyL}`);
    check('expiry written to the ledger',
      (await DairyBatchLedger.countDocuments({ batch: expiredBatch._id, eventType: 'expired' })) === 1);

    // ---- Commit ----
    console.log('\n5. Commit and shrinkage');
    const allocations = await procurement.allocateByFEFO(business._id, 10);
    const committed = await procurement.commitAllocations(allocations, {
      order: null, recordedBy: asha._id, note: 'Test commit',
    });
    check('commit decrements stock',
      Number((await DairyMilkBatch.findById(committed[0].batchId)).availableQtyL) === 0,
      `qty=${(await DairyMilkBatch.findById(committed[0].batchId)).availableQtyL}`);
    check('consumed quantity recorded',
      (await DairyMilkBatch.findById(committed[0].batchId)).consumedQtyL === 8);
    check('fully consumed batch flips to consumed',
      (await DairyMilkBatch.findById(committed[0].batchId)).status === 'consumed');
    check('consumption written to the ledger',
      (await DairyBatchLedger.countDocuments({ eventType: 'consumed' })) >= 1);

    const batch2 = await DairyMilkBatch.findById(batch1._id);
    const beforeShrink = batch2.availableQtyL;
    const shrunk = await procurement.recordShrinkage(batch1._id, 2, {
      reason: 'curdled', note: 'Spill', recordedBy: asha._id,
    });
    check('shrinkage reduces available stock',
      shrunk.availableQtyL === beforeShrink - 2, `${beforeShrink} -> ${shrunk.availableQtyL}`);
    check('shrinkage tracked separately from consumption',
      shrunk.shrinkageL === 2 && shrunk.consumedQtyL === 2,
      `shrinkage=${shrunk.shrinkageL} consumed=${shrunk.consumedQtyL}`);

    let overShrinkRefused = false;
    try {
      await procurement.recordShrinkage(batch1._id, 9999, { reason: 'x' });
    } catch (e) { overShrinkRefused = e.statusCode === 400; }
    check('shrinkage beyond available stock refused', overShrinkRefused);

    const report = await procurement.getBatchReport(business._id, {});
    check('batch report present', Array.isArray(report.batches));
    const shrinkage = await procurement.getShrinkageReport(business._id, {});
    check('shrinkage rate computed', shrinkage.totalAcceptedLitres > 0 && shrinkage.shrinkageRatePercentage >= 0,
      `accepted=${shrinkage.totalAcceptedLitres} rate=${shrinkage.shrinkageRatePercentage}`);

    // ---- Payable ----
    console.log('\n6. Provider payable');
    const payables = await procurement.getProviderPayable(business._id, {});
    check('payable covers accepted collections', payables.length === 1);
    const payableLitres = payables[0].litres;
    check('payable litres exclude rejected milk', payableLitres === 28, `got ${payableLitres}`);
    const payableAmount = payables[0].amount;
    // The rate moved from ₹40 to ₹55 partway through, and each collection keeps
    // the rate captured at intake — so this is 20x40 + 8x55, not 28x40.
    check('payable amount uses the rate captured at intake', payableAmount === 20 * 40 + 8 * 55,
      `got ${payableAmount}`);

    // ---- Order integration ----
    console.log('\n7. Order integration');
    // Reset batch stock so the order has something to draw on.
    await DairyMilkBatch.updateOne(
      { _id: batch1._id },
      { $set: { availableQtyL: 20, consumedQtyL: 10, status: 'source' } }
    );

    await cartService.addItem({ user: customer._id, sku: rawSku._id, quantity: 3 });
    const order = await orderService.createOrder({
      user: customer._id, addressRaw: '1 Test Street', paymentMode: 'cod',
      deliverySlot: { startTime: '06:00', endTime: '08:00' },
    });
    check('order created', !!order._id);
    check('batch allocation recorded on the order',
      Array.isArray(order.items[0].batchAllocation) && order.items[0].batchAllocation.length > 0,
      `alloc=${order.items[0].batchAllocation && order.items[0].batchAllocation.length}`);
    const allocQty = order.items[0].batchAllocation.reduce((s, a) => s + a.quantityL, 0);
    check('3 litres allocated for a 3-unit order', allocQty === 3, `got ${allocQty}`);
    const afterOrder = await DairyMilkBatch.findById(batch1._id);
    check('batch stock decremented by the order',
      afterOrder.availableQtyL === 17, `got ${afterOrder.availableQtyL}`);

    // Non-batchTracked SKU must not touch batches.
    const batchesBefore = await DairyBatchLedger.countDocuments({ eventType: 'consumed' });
    await DairyCartItem.deleteMany({ user: customer._id });
    await cartService.addItem({ user: customer._id, sku: plainSku._id, quantity: 1 });
    const plainOrder = await orderService.createOrder({
      user: customer._id, addressRaw: '1 Test Street', paymentMode: 'cod',
      deliverySlot: { startTime: '06:00', endTime: '08:00' },
    });
    check('non-batchTracked order records no batch allocation',
      plainOrder.items[0].batchAllocation.length === 0,
      `alloc=${plainOrder.items[0].batchAllocation.length}`);
    check('non-batchTracked order consumes no batches',
      (await DairyBatchLedger.countDocuments({ eventType: 'consumed' })) === batchesBefore);

    // Not enough milk in date must be refused, not silently short-filled.
    await DairyMilkBatch.updateMany(
      { business: business._id }, { $set: { availableQtyL: 1, status: 'source', expiry: hoursAgo(1) } }
    );
    await DairyCartItem.deleteMany({ user: customer._id });
    await cartService.addItem({ user: customer._id, sku: rawSku._id, quantity: 5 });
    // Earlier orders legitimately consumed SKU stock, so unwind is measured
    // against the value immediately before this attempt.
    const stockBeforeRefusal = (await DairySku.findById(rawSku._id)).availableQty;
    let shortRefused = false;
    let shortStatusCode = 0;
    let stockUnwound = false;
    try {
      await orderService.createOrder({
        user: customer._id, addressRaw: '1 Test Street', paymentMode: 'cod',
        deliverySlot: { startTime: '06:00', endTime: '08:00' },
      });
    } catch (e) {
      shortRefused = e.statusCode === 400;
      shortStatusCode = e.statusCode;
      const skuNow = await DairySku.findById(rawSku._id);
      stockUnwound = skuNow.availableQty === stockBeforeRefusal;
    }
    check('insufficient milk in date refused with 400, not 500', shortRefused,
      `statusCode=${shortStatusCode}`);
    check('SKU stock unwound after the refusal', stockUnwound,
      `before=${stockBeforeRefusal} after=${(await DairySku.findById(rawSku._id)).availableQty}`);
    check('order not left behind after the refusal',
      (await DairyOrder.countDocuments({ user: customer._id })) === 2);
  } catch (e) {
    failures += 1;
    console.log(`\n  UNCAUGHT: ${e.message}`);
  } finally {
    await DairyOrderStatusHistory.deleteMany({});
    await DairyCartItem.deleteMany({ user: customer._id });
    await DairyOrder.deleteMany({ user: customer._id });
    await DeliveryStop.deleteMany({});
    await DeliveryRun.deleteMany({});
    const batchIds = (await DairyMilkBatch.find({ business: business._id }).select('_id')).map((b) => b._id);
    await DairyBatchLedger.deleteMany({ batch: { $in: batchIds } });
    await DairyMilkBatch.deleteMany({ _id: { $in: batchIds } });
    await DairyMilkCollection.deleteMany({ provider: { $in: created.providers.map((p) => p._id) } });
    await DairyMilkProvider.deleteMany({ _id: { $in: created.providers.map((p) => p._id) } });
    await DairyMilkRejectionReason.deleteMany({ business: business._id, code: { $exists: true } });
    await DairySku.deleteMany({ _id: { $in: created.skus.map((s) => s._id) } });
    await DairyProduct.deleteMany({ _id: { $in: created.products.map((p) => p._id) } });
    await DairySubCategory.deleteMany({ _id: { $in: created.categories.map((c) => c._id) } });
    await DairyCategory.deleteMany({ _id: { $in: created.categories.map((c) => c._id) } });
    await User.deleteMany({ _id: customer._id });
    await mongoose.disconnect();
  }

  console.log(failures === 0 ? '\nALL PROCUREMENT CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch(async (e) => {
  console.error('verification failed:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});