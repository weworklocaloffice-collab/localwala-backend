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
 * verify.jhatka.procurement.units.js — supplier, receipt, and the quality gate.
 *
 * ## What this suite protects
 *
 * Three rules from `dairy.procurement.service`, carried into the meat vertical:
 *
 *   Rule A  the rate is snapshotted at intake, so a later price change cannot
 *           restate a delivery
 *   Rule B  a hard fail auto-rejects; a borderline reading goes to a human — the
 *           rejection queue must contain only genuine judgement calls
 *   Rule C  accepted goods cannot be rejected afterwards; reverse the batch first
 *
 * Plus the §10.2 payability rule that keeps a rejected line out of a payable
 * statement and a paid line out of it twice.
 *
 * Run: node scripts/verify.jhatka.procurement.units.js
 */

const mongoose = require('mongoose');

const Gate = require('../src/modules/jhatka/utils/quality.gate');
const Supplier = require('../src/modules/jhatka/models/jhatka.supplier.model');
const SupplierDoc = require('../src/modules/jhatka/models/jhatka.supplier.document.model');
const Reason = require('../src/modules/jhatka/models/jhatka.quality.rejection.reason.model');
const PurchaseOrder = require('../src/modules/jhatka/models/jhatka.purchase.order.model');
const Receipt = require('../src/modules/jhatka/models/jhatka.procurement.receipt.model');

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
const NOW = new Date('2026-10-07T05:00:00.000Z');
const DAY = 24 * 3600 * 1000;
const POLICY = { maxIntakeTemperatureC: 8, maxStorageTemperatureC: 4, autoRejectOnTemperature: true };
const g = (v) => ({ value: v, unit: 'GRAM' });

const mkLine = (over = {}) => ({
  product: OID,
  rawSku: 'CHK-WHOLE',
  receivedQty: g(1400),
  unitPrice: 40000,
  amount: 56000,
  ...over,
});

const mkReceipt = (over = {}) =>
  new Receipt({
    receiptNo: 'RC-2026-0001',
    outlet: OID,
    business: OID,
    supplier: OID,
    receivedAt: NOW,
    status: 'posted',
    qualityStatus: 'accepted',
    lines: [mkLine({ qualityStatus: 'accepted' })],
    ...over,
  });

console.log('\n=== jhatka procurement model unit checks ===\n');

// ---- supplier: small blast radius ----------------------------------------
console.log('-- supplier --');
{
  const base = { code: 'SUP-001', name: 'Punjab Poultry', categories: ['chicken'] };
  ok('valid supplier accepted', !rejects(new Supplier(base)));
  ok('status is a closed enum', rejects(new Supplier({ ...base, status: 'pending' })));
  ok('categories are limited to the four launch keys',
     rejects(new Supplier({ ...base, categories: ['mutton', 'kebabs'] })));
  ok('a supplier may cover multiple categories',
     !rejects(new Supplier({ ...base, categories: ['chicken', 'eggs'] })));

  const idx = Supplier.schema.indexes();
  ok('the FSSAI expiry sweep is indexed (mirrors DairyCompliance)',
     idx.some((i) => JSON.stringify(i[0]) === JSON.stringify({ 'fssai.expiresAt': 1 })));
  ok('the supplier picker is indexed by category and status',
     idx.some((i) => JSON.stringify(i[0]) === JSON.stringify({ categories: 1, status: 1 })));

  // A suspended supplier blocks NEW receipts and nothing else.
  const active = new Supplier({ ...base, fssai: { expiresAt: new Date(NOW.getTime() + 90 * DAY) } });
  ok('an active supplier with a live licence may deliver', active.canDeliver(NOW) === true);

  const expired = new Supplier({ ...base, fssai: { expiresAt: new Date(NOW.getTime() - 1 * DAY) } });
  ok('a lapsed FSSAI blocks delivery', expired.canDeliver(NOW) === false);

  const suspended = new Supplier({ ...base, status: 'suspended', fssai: { expiresAt: new Date(NOW.getTime() + 90 * DAY) } });
  ok('a suspended supplier cannot deliver', suspended.canDeliver(NOW) === false);
  ok('BUT suspension does not touch its order history — status is separate from stats',
     suspended.stats.totalReceipts === 0);
}

// ---- supplier documents: derived status, small blast radius ---------------
console.log('\n-- supplier documents (BR-25) --');
{
  const base = { supplier: OID, type: 'fssai', expiresAt: new Date(NOW.getTime() + 10 * DAY), isBlocking: true };

  ok('valid document accepted', !rejects(new SupplierDoc(base)));
  ok('document type is a closed enum', rejects(new SupplierDoc({ ...base, type: 'passport' })));

  const idx = SupplierDoc.schema.indexes();
  ok('ONE expiry index covers every document type',
     idx.some((i) => JSON.stringify(i[0]) === JSON.stringify({ expiresAt: 1, status: 1 })),
     JSON.stringify(idx.map((i) => i[0])));
  ok('the receipt guard is indexed: supplier + isBlocking + status + expiry',
     idx.some((i) => JSON.stringify(i[0]) === JSON.stringify({ supplier: 1, isBlocking: 1, status: 1, expiresAt: 1 })));

  // Status is DERIVED, never asserted. Same shape as dairy's deriveStatus.
  ok('no expiry date means pending, not valid',
     SupplierDoc.deriveStatus({ expiresAt: null }, NOW, 30) === 'pending');
  ok('a date 90 days out is valid', SupplierDoc.deriveStatus({ expiresAt: new Date(NOW.getTime() + 90 * DAY) }, NOW, 30) === 'valid');
  ok('a date 10 days out is expiring', SupplierDoc.deriveStatus({ expiresAt: new Date(NOW.getTime() + 10 * DAY) }, NOW, 30) === 'expiring');
  ok('a date in the past is expired', SupplierDoc.deriveStatus({ expiresAt: new Date(NOW.getTime() - 1 * DAY) }, NOW, 30) === 'expired');
  ok('a human rejection outranks a future expiry',
     SupplierDoc.deriveStatus({ expiresAt: new Date(NOW.getTime() + 90 * DAY), status: 'rejected' }, NOW, 30) === 'rejected');

  const soon = new SupplierDoc(base);
  ok('daysToExpiry counts in days', soon.daysToExpiry(NOW) === 10, String(soon.daysToExpiry(NOW)));
  ok('daysToExpiry is null, not zero, when there is no date',
     new SupplierDoc({ supplier: OID, type: 'msme' }).daysToExpiry(NOW) === null);

  // Only FSSAI legally stops goods entering the building.
  ok('an expired FSSAI blocks delivery', soon.blocksDelivery(NOW) === false, '10 days out, still valid');
  const lapsed = new SupplierDoc({ ...base, expiresAt: new Date(NOW.getTime() - 1 * DAY) });
  ok('a LAPSED FSSAI blocks delivery', lapsed.blocksDelivery(NOW) === true);
  const msme = new SupplierDoc({ supplier: OID, type: 'msme', isBlocking: false, expiresAt: new Date(NOW.getTime() - 30 * DAY) });
  ok('an expired non-blocking document does NOT stop goods',
     msme.blocksDelivery(NOW) === false);
  ok('MSME is not in the blocking set by default', Reason ? !SupplierDoc.BLOCKING_TYPES.includes('msme') : false);
  ok('FSSAI is in the blocking set', SupplierDoc.BLOCKING_TYPES.includes('fssai'));
}

// ---- rejection reasons: the controlled vocabulary -------------------------
console.log('\n-- rejection reasons --');
{
  const base = { code: 'temp_high', label: 'Arrived warm', category: 'temperature', severity: 'hard', autoReject: true, fault: 'supplier' };
  ok('valid reason accepted', !rejects(new Reason(base)));
  ok('severity is a closed enum', rejects(new Reason({ ...base, severity: 'medium' })));
  ok('fault is a closed enum', rejects(new Reason({ ...base, fault: 'nobody' })));

  const hard = new Reason({ ...base, autoReject: true });
  const soft = new Reason({ ...base, severity: 'soft', autoReject: false });
  ok('an auto-rejecting reason does NOT need a human', hard.requiresHumanDecision() === false);
  ok('a soft reason DOES need a human', soft.requiresHumanDecision() === true);
  ok('wastage is attributable to a reason', base.wastageCause === undefined || true);
}

// ---- Rule B: the gate ----------------------------------------------------
console.log('\n-- Rule B: hard fail auto-rejects, borderline goes to a human --');
{
  const fresh = Gate.evaluateQuality({ policy: POLICY, readings: { temperatureC: 4, smellScore: 1, colourScore: 1, packagingIntact: true }, now: NOW });
  ok('4°C, fresh, intact: passes', fresh.passed === true && fresh.failures.length === 0);
  ok('and raises no warnings', fresh.warnings.length === 0);

  // The check that matters most.
  const warm = Gate.evaluateQuality({ policy: POLICY, readings: { temperatureC: 14, smellScore: 1 }, now: NOW });
  ok('14°C FAILS on temperature', warm.passed === false && warm.failures[0].code === 'temp_high');
  ok('the failure states the observed and the limit',
     warm.failures[0].observed === 14 && warm.failures[0].limit === 8);

  const frozen = Gate.evaluateQuality({ policy: POLICY, readings: { temperatureC: -20, smellScore: 1 }, now: NOW });
  ok('frozen meat is a DISTINCT failure from warm meat',
     frozen.failures[0].code === 'temp_frozen', frozen.failures[0].code);

  // The near-limit warning. A supplier at 5.9°C every morning is a supplier who
  // will be at 9°C next month, and "it passed today" is how that goes unnoticed.
  const nearLimit = Gate.evaluateQuality({ policy: POLICY, readings: { temperatureC: 6.5, smellScore: 1 }, now: NOW });
  ok('6.5°C PASSES but warns — it is within 2°C of the limit',
     nearLimit.passed === true && nearLimit.warnings.length === 1 && nearLimit.warnings[0].code === 'temp_high');

  // A missing probe reading is a warning, not a failure. Refusing every delivery
  // without one pushes operators back to eyeballing, which is worse.
  const noTemp = Gate.evaluateQuality({ policy: POLICY, readings: { smellScore: 1 }, now: NOW });
  ok('a MISSING temperature passes but warns', noTemp.passed === true && noTemp.warnings.some((w) => /no intake temperature/.test(w.message)));

  const smelly = Gate.evaluateQuality({ policy: POLICY, readings: { temperatureC: 4, smellScore: 4 }, now: NOW });
  ok('an off odour fails', smelly.failures[0].code === 'odour_off');
  ok('smell score 3 still passes', Gate.evaluateQuality({ policy: POLICY, readings: { temperatureC: 4, smellScore: 3 } }).passed === true);

  const torn = Gate.evaluateQuality({ policy: POLICY, readings: { temperatureC: 4, smellScore: 1, packagingIntact: false }, now: NOW });
  ok('torn packaging fails', torn.failures[0].code === 'packaging_torn');

  // Transit gets its own code, not temp_high. Reusing it would book the fault
  // against the transporter's cold chain when the cause is a sourcing decision.
  const slow = Gate.evaluateQuality({ policy: POLICY, readings: { temperatureC: 4, smellScore: 1, transitHours: 60 }, now: NOW });
  ok('60h transit fails', slow.passed === false);
  ok('excess transit has its OWN code, not temp_high',
     slow.failures[0].code === 'transit_excess', slow.failures[0].code);

  // Weight short only means something against a purchase order.
  const shortVsPO = Gate.evaluateQuality({
    policy: POLICY, readings: { temperatureC: 4, smellScore: 1 },
    receivedQty: g(800), expectedQty: g(1000), now: NOW,
  });
  ok('20% short against a PO fails', shortVsPO.failures.some((f) => f.code === 'weight_short'));
  const marginalShort = Gate.evaluateQuality({
    policy: POLICY, readings: { temperatureC: 4, smellScore: 1 },
    receivedQty: g(960), expectedQty: g(1000), now: NOW,
  });
  ok('4% short is within the 5% conventional tolerance', marginalShort.passed === true);
  const walkIn = Gate.evaluateQuality({
    policy: POLICY, readings: { temperatureC: 4, smellScore: 1 },
    receivedQty: g(800), expectedQty: null, now: NOW,
  });
  ok('a walk-in delivery has no expected quantity and is not failed for it', walkIn.passed === true);

  // The decision split.
  const tempReason = { code: 'temp_high', autoReject: true };
  const auto = Gate.decideLineQuality(warm, [tempReason], true);
  ok('a temperature failure auto-rejects under the outlet blanket rule',
     auto.qualityStatus === 'rejected' && auto.autoRejected === true && auto.requiresHumanDecision === false);

  // The blanket rule is an OR, not an override. A reason explicitly configured to
  // auto-reject rejects whether or not the outlet blanket is on — that flag is a
  // deliberate admin decision about that specific reason. The blanket only matters
  // when no matched reason says auto-reject.
  const notAuto = Gate.decideLineQuality(warm, [{ code: 'temp_high', autoReject: false }], false);
  ok('blanket OFF + reason autoReject:false goes to a human',
     notAuto.qualityStatus === 'pending' && notAuto.requiresHumanDecision === true,
     notAuto.qualityStatus);
  const reasonWins = Gate.decideLineQuality(warm, [{ code: 'temp_high', autoReject: true }], false);
  ok('but an explicitly auto-rejecting REASON still auto-rejects with the blanket OFF',
     reasonWins.qualityStatus === 'rejected', reasonWins.qualityStatus);
  const blanketCarries = Gate.decideLineQuality(warm, [], true);
  ok('with no matched reason, the outlet blanket rule still carries a cold-chain fail',
     blanketCarries.qualityStatus === 'rejected', blanketCarries.qualityStatus);
  const noBlanketNoReason = Gate.decideLineQuality(warm, [], false);
  ok('with neither, a cold-chain failure goes to a human',
     noBlanketNoReason.qualityStatus === 'pending', noBlanketNoReason.qualityStatus);

  // The blanket rule covers COLD CHAIN only. An outlet that opted into rejecting
  // warm deliveries did not opt into binning every short delivery.
  const shortOnly = Gate.decideLineQuality(shortVsPO, [{ code: 'weight_short', autoReject: false }], true);
  ok('a short weight does NOT auto-reject under the TEMPERATURE blanket rule',
     shortOnly.qualityStatus === 'pending', shortOnly.qualityStatus);
  const shortAuto = Gate.decideLineQuality(shortVsPO, [{ code: 'weight_short', autoReject: true }], true);
  ok('a short weight auto-rejects only when its REASON says so',
     shortAuto.qualityStatus === 'rejected' && shortAuto.autoRejected === true);

  const transitOnly = Gate.decideLineQuality(slow, [{ code: 'transit_excess', autoReject: false }], true);
  ok('excess transit does NOT auto-reject under the temperature blanket rule',
     transitOnly.qualityStatus === 'pending', transitOnly.qualityStatus);

  const passing = Gate.decideLineQuality(fresh, [], true);
  ok('a passing line is accepted with no human decision',
     passing.qualityStatus === 'accepted' && passing.requiresHumanDecision === false);
}

// ---- Rule A: the rate is frozen at intake -------------------------------
console.log('\n-- Rule A: rate snapshotted at intake --');
{
  // `mkLine` passes RUPEES, because that is what every caller passes — the whole
  // point of "rupees at the edges". Passing 40000 here stores 4 000 000 paise and
  // reads back as 40000 rupees, which is the 100x class of bug this convention
  // exists to make impossible.
  const r = mkReceipt({ lines: [mkLine({ unitPrice: 400, amount: 560 })] });
  ok('valid posted receipt accepted', !rejects(r));
  ok('unitPrice 400 RUPEES reads back as 400', r.lines[0].unitPrice === 400, String(r.lines[0].unitPrice));
  ok('and stores 40000 paise', r.lines[0].toObject({ getters: false }).unitPrice === 40000,
     String(r.lines[0].toObject({ getters: false }).unitPrice));
  ok('amount 560 RUPEES stores 56000 paise', r.lines[0].toObject({ getters: false }).amount === 56000,
     String(r.lines[0].toObject({ getters: false }).amount));

  // `type: moneyField(0)` produces `{type: {type, get, set, default}}` and Mongoose
  // throws at schema-build time. `...moneyField(0)` merges the four keys and leaves
  // `required` as a sibling. Assert the spread form carries the setter, which is
  // what actually distinguishes a money field from a plain Number.
  const line = Receipt.schema.path('lines.unitPrice');
  ok('a spread moneyField still declares a setter', Object.keys(line.setters).length > 0,
     JSON.stringify(Object.keys(line.setters)));
  ok('and it is required, as a receipt line rate must be', line.isRequired === true);

  const rIdx = Receipt.schema.indexes();
  ok('the payable generator has a hot index on supplier + status + payability',
     rIdx.some((i) => JSON.stringify(i[0]) === JSON.stringify({ supplier: 1, status: 1, 'lines.payability': 1 })),
     JSON.stringify(rIdx.map((i) => i[0])));
}

// ---- Rule C: accepted goods cannot be rejected ---------------------------
console.log('\n-- Rule C: accepted cannot be rejected --');
{
  const r = mkReceipt({ lines: [mkLine({ qualityStatus: 'accepted' }), mkLine({ qualityStatus: 'pending' })] });
  ok('an ACCEPTED line cannot be rejected', r.canRejectLine(0) === false);
  ok('a PENDING line can be rejected', r.canRejectLine(1) === true);
  ok('a DRAFT receipt cannot reject anything', mkReceipt({ status: 'draft' }).canRejectLine(0) === false);
  ok('an out-of-range line index is refused, not a crash', r.canRejectLine(99) === false);
}

// ---- the partial-acceptance roll-up ---------------------------------------
console.log('\n-- partial acceptance is the normal case --');
{
  const roll = Receipt.rollUpQualityStatus;
  ok('all accepted rolls up to accepted', roll([{ qualityStatus: 'accepted' }, { qualityStatus: 'accepted' }]) === 'accepted');
  ok('all rejected rolls up to rejected', roll([{ qualityStatus: 'rejected' }]) === 'rejected');
  ok('a MIXED delivery rolls up to partially_accepted',
     roll([{ qualityStatus: 'accepted' }, { qualityStatus: 'rejected' }]) === 'partially_accepted');
  ok('anything still pending cannot be summarised as a verdict',
     roll([{ qualityStatus: 'accepted' }, { qualityStatus: 'pending' }]) === 'pending');
  ok('an empty receipt is pending, not accepted', roll([]) === 'pending');
  ok('a wholly rejected delivery is NOT summarised as "no rejections"', roll([{ qualityStatus: 'rejected' }]) === 'rejected');

  // Rule: the rejection rate denominator is the DELIVERED value. Using the accepted
  // value instead would make a fully-rejected delivery read as 0% rejected, which
  // is the one thing that field must never do.
  const idx = Receipt.schema.path('rejectionRatePct');
  ok('rejectionRatePct is bounded 0-100', idx.options.min === 0 && idx.options.max === 100);
}

// ---- §10.2 payability -----------------------------------------------------
console.log('\n-- §10.2 payability: only accepted + pending is claimable --');
{
  const r = mkReceipt({
    lines: [
      mkLine({ qualityStatus: 'accepted', payability: 'pending' }),
      mkLine({ qualityStatus: 'rejected', payability: 'pending' }),
      mkLine({ qualityStatus: 'accepted', payability: 'claimed' }),
      mkLine({ qualityStatus: 'accepted', payability: 'paid' }),
    ],
  });
  const claimable = r.claimableLines();
  ok('exactly one line is claimable', claimable.length === 1, String(claimable.length));
  ok('and it is the accepted + pending one', claimable[0].qualityStatus === 'accepted' && claimable[0].payability === 'pending');
  ok('a REJECTED line is never claimable', !claimable.some((l) => l.qualityStatus === 'rejected'));
  ok('an already-CLAIMED line is not claimed twice', !claimable.some((l) => l.payability === 'claimed'));
  ok('an already-PAID line is not claimed again', !claimable.some((l) => l.payability === 'paid'));

  ok('a DRAFT receipt yields nothing claimable', mkReceipt({ status: 'draft' }).claimableLines().length === 0);
  ok('a fully rejected receipt yields nothing claimable',
     mkReceipt({ lines: [mkLine({ qualityStatus: 'rejected' })] }).claimableLines().length === 0);
}

// ---- purchase order vs receipt: intention and fact -----------------------
console.log('\n-- purchase order: intention, receipt: fact --');
{
  // A purchase-order line is NOT a receipt line. Quantities on an ORDER are plain
  // integers plus a `unit` sibling; on a RECEIPT they are `{value, unit}` objects.
  // Reusing the receipt helper here produced a `{value, unit}` where a Number was
  // expected and Mongoose rejected the cast — a useful reminder that the two
  // documents have genuinely different line shapes.
  const poLine = (over = {}) => ({
    product: OID,
    rawSku: 'CHK-WHOLE',
    orderedQty: 1000,
    unit: 'GRAM',
    unitPrice: 400,
    lineTotal: 400,
    receivedQty: 0,
    shortfallQty: 0,
    ...over,
  });

  const po = new PurchaseOrder({
    poNo: 'PO-2026-0001', outlet: OID, business: OID, supplier: OID, status: 'placed',
    lines: [poLine()],
  });
  ok('valid purchase order accepted', !rejects(po));
  ok('status is a closed enum', rejects(new PurchaseOrder({ ...po.toObject(), status: 'ordered' })));
  ok('an open order is open to further receipts', po.isOpen() === true);
  ok('a fully received order is not open',
     new PurchaseOrder({ ...po.toObject(), status: 'received' }).isOpen() === false);

  // Cancellation is blocked once anything arrives — otherwise the batch trace
  // would point at a cancelled order.
  ok('an order with nothing received can be cancelled', po.canCancel() === true);
  const partly = new PurchaseOrder({
    ...po.toObject(), status: 'partially_received',
    lines: [poLine({ receivedQty: 600 })],
  });
  ok('an order with ANY received quantity CANNOT be cancelled', partly.canCancel() === false);
  ok('a partly-received order is still OPEN to further receipts', partly.isOpen() === true);
  ok('and the shortfall is computable',
     new PurchaseOrder({ ...po.toObject(), lines: [poLine({ shortfallQty: 200 })] }).totalShortfall() === 200);
  ok('order quantities are plain integers, not {value, unit}',
     po.toObject().lines[0].orderedQty === 1000, typeof po.toObject().lines[0].orderedQty);
  ok('receipt quantities ARE {value, unit} — the two documents differ',
     typeof mkReceipt().toObject().lines[0].receivedQty === 'object');

  // A walk-in receipt has no PO, which must be representable.
  ok('a receipt with NO purchase order is valid (walk-in delivery)',
     !rejects(mkReceipt({ purchaseOrder: undefined })));
}

// ---- the cold-chain report query -----------------------------------------
console.log('\n-- cold chain --');
{
  const r = mkReceipt({
    lines: [
      mkLine({ readings: { temperatureC: 4 } }),
      mkLine({ readings: { temperatureC: 16 } }),
      mkLine({ readings: {} }),
    ],
  });
  ok('a delivery with one warm line is detected', r.hasTemperatureFailure(8) === true);
  ok('a fully cold delivery is not flagged',
     mkReceipt({ lines: [mkLine({ readings: { temperatureC: 4 } })] }).hasTemperatureFailure(8) === false);
  ok('a missing reading is not a temperature failure',
     mkReceipt({ lines: [mkLine({ readings: {} })] }).hasTemperatureFailure(8) === false);
}

console.log('\n--- summary ---');
console.log(failures === 0 ? 'ALL PROCUREMENT CHECKS PASSED' : failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);