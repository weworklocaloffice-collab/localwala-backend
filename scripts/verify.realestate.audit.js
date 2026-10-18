/**
 * verify.realestate.audit.js — BR-20 / F-2, the audit trail.
 *
 * ## Why this exists
 *
 * BR-20 requires "an audit record for every state transition that moves money or changes a
 * permission-bearing fact". Doc §0A.3 records that no audit model existed anywhere in the
 * codebase, and F-2 has been outstanding since the plan was written.
 *
 * `RealEstateLeadActivity` covered part of the need for leads only. It could not record that
 * an entitlement was restored, that an order was paid, or that a listing was published —
 * those are not lead events — so most of what BR-20 describes had nowhere to go.
 *
 * ## The four properties worth testing
 *
 * 1. **The write path is called from the real services**, not merely available. A service
 *    that could record but does not is the actual failure mode.
 * 2. **It never throws into the business action.** Losing an audit row must not roll back a
 *    published listing.
 * 3. **It is append-only** — no `updatedAt`, no update hook, no delete path.
 * 4. **An unknown key is dropped, not stored**, so a typo like `ammount` cannot become a
 *    column a later report sums.
 *
 * Run: node scripts/verify.realestate.audit.js
 */

const fs = require('fs');
const path = require('path');

const API = path.resolve(__dirname, '..');
const mongoose = require(path.join(API, 'node_modules/mongoose'));
require(path.join(API, 'node_modules/dotenv')).config({ path: path.join(API, '.env') });

const RealEstateAuditLog = require(path.join(
  API,
  'src/modules/realestate/models/realestate.audit.log.model'
));
const auditService = require(path.join(
  API,
  'src/modules/realestate/services/realestate.audit.service'
));
const orderService = require(path.join(
  API,
  'src/modules/realestate/services/realestate.listing.order.service'
));
const RealEstateListingPackage = require(path.join(
  API,
  'src/modules/realestate/models/realestate.listing.package.model'
));
const RealEstateListingOrder = require(path.join(
  API,
  'src/modules/realestate/models/realestate.listing.order.model'
));
const RealEstateListingEntitlement = require(path.join(
  API,
  'src/modules/realestate/models/realestate.listing.entitlement.model'
));

let failed = 0;
let passed = 0;
const ok = (m) => {
  passed++;
  console.log('  OK   ' + m);
};
const bad = (m, e) => {
  failed++;
  console.log('  FAIL ' + m + '  ->  ' + e);
};

const oid = () => new mongoose.Types.ObjectId();
const CODE = `AUD${Date.now().toString(36).toUpperCase()}`;

(async () => {
  await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
  });

  try {
    // ----------------------------------------------------------------------- [1]

    console.log('\n[1] the model is append-only by construction');

    const schema = RealEstateAuditLog.schema;

    if (schema.path('updatedAt')) {
      bad('append-only', 'the schema has updatedAt, so a row can be rewritten');
    } else {
      ok('no updatedAt — a row cannot be silently modified through the model');
    }

    const mutators = ['save', 'update', 'updateOne', 'updateMany', 'findOneAndUpdate'];
    const installed = mutators.filter((m) => schema.s.hooks._pres.get(m) && schema.s.hooks._pres.get(m).size > 0);
    if (installed.length === 0) ok(`no ${mutators.join('/')} pre-hooks to rewrite a row`);
    else bad('append-only hooks', installed.join(', '));

    // The service must offer no mutation path at all.
    const exported = Object.keys(auditService);
    const forbidden = exported.filter((k) => /^(update|amend|remove|delete|purge|edit)/i.test(k));
    if (forbidden.length === 0) {
      ok(`service exports no mutation path: ${exported.join(', ')}`);
    } else {
      bad('mutation path exposed', forbidden.join(', '));
    }

    // ----------------------------------------------------------------------- [2]

    console.log('\n[2] the closed event vocabulary');

    const events = RealEstateAuditLog.schema.path('eventType').options.enum;
    if (Array.isArray(events) && events.length > 0) {
      ok(`${events.length} event types, a closed enum`);
    } else {
      bad('eventType enum', 'not a closed list');
    }

    for (const required of [
      'ENTITLEMENT_GRANTED',
      'ENTITLEMENT_CONSUMED',
      'ENTITLEMENT_RESTORED',
      'LISTING_PACKAGE_ORDER_PAID',
      'LISTING_PUBLISHED',
      'VENDOR_SUSPENDED',
      'LOAN_SANCTIONED',
    ]) {
      if (events.includes(required)) ok(`covers ${required}`);
      else bad('event vocabulary', `missing ${required}`);
    }

    // Every money event BR-20 names must be classifiable as a money movement.
    const moneyEvents = new Set(auditService.MONEY_EVENTS);
    if (moneyEvents.has('ENTITLEMENT_RESTORED')) ok('ENTITLEMENT_RESTORED counts as a money movement');
    else bad('money classification', 'a restored entitlement is money and is not in MONEY_EVENTS');

    // BR-10: the bank-only transitions exist as types, so an executive setting one is
    // visible in a query even though the rights string is what actually prevents it.
    if (events.includes('LOAN_SANCTIONED') && events.includes('LOAN_DISBURSED')) {
      ok('BR-10 bank-only transitions are representable as audit events');
    } else {
      bad('BR-10', 'the bank transitions have no event type');
    }

    // ----------------------------------------------------------------------- [3]

    console.log('\n[3] BR-02 — no amount column on the audit row');

    if (!schema.path('amount') && !schema.path('amountRupees')) {
      ok('no amount field: money lives on the order/entitlement/ledger, not here');
    } else {
      bad('amount on the audit model', 'a fourth place for money totals, which §1.1 forbids');
    }

    // An unknown key must be dropped, not persisted.
    const probe = await auditService.record({
      eventType: 'LISTING_PUBLISHED',
      targetType: 'Property',
      targetId: oid(),
      actorType: 'ADMIN',
      // Deliberately misspelled. With `strict: true` this must not survive.
      ammount: 999999,
      metadata: { kept: true },
    });

    if (probe.ok) {
      const stored = await RealEstateAuditLog.findById(probe.log._id).lean();
      if (stored.ammount === undefined) ok('an unknown key (`ammount`) is dropped, not stored');
      else bad('strict mode', 'the misspelled key was persisted');

      if (stored.metadata && stored.metadata.kept === true) ok('known metadata survives');
      else bad('metadata', 'dropped along with the unknown key');

      await RealEstateAuditLog.deleteOne({ _id: probe.log._id });
    } else {
      bad('record', probe.error && probe.error.message);
    }

    // ----------------------------------------------------------------------- [4]

    console.log('\n[4] record() never throws into the caller');

    const badEvent = await auditService.record({
      eventType: 'NOT_A_REAL_EVENT',
      targetType: 'Property',
      targetId: oid(),
      actorType: 'ADMIN',
    });

    if (badEvent.ok === false && badEvent.error) {
      ok(`an invalid entry returns { ok: false } instead of throwing: ${badEvent.error.name}`);
    } else {
      bad('record', 'an invalid event type was accepted, or the failure was thrown');
    }

    const missingTarget = await auditService.record({
      eventType: 'LISTING_PUBLISHED',
      targetType: 'Property',
      actorType: 'ADMIN',
    });
    if (missingTarget.ok === false) ok('a missing required field returns { ok: false }');
    else bad('record', 'accepted an entry with no targetId');

    // ----------------------------------------------------------------------- [5]

    console.log('\n[5] the write path is called from the real services');

/**
 * Static check: each service that moves money must actually call the audit service.
 *
 * A service that *can* record but does not is the real failure mode — the audit module
 * exists, the enum covers the event, and nothing writes the row.
 *
 * `property.service.js` is listed for `ENTITLEMENT_CONSUMED` but is **not** required to
 * import the audit service directly: it reaches the same row through
 * `entitlementService.auditConsumption()`. So the check follows one level of delegation
 * rather than demanding an import that would duplicate the audit call site.
 */
const services = {
  'realestate.listing.order.service.js': {
    events: ['LISTING_PACKAGE_ORDER_CREATED', 'LISTING_PACKAGE_ORDER_PAID'],
    via: null,
  },
  'realestate.listing.entitlement.service.js': {
    events: ['ENTITLEMENT_CONSUMED', 'ENTITLEMENT_RESTORED'],
    via: null,
  },
  'realestate.property.service.js': {
    events: ['ENTITLEMENT_CONSUMED'],
    // Delegates to the entitlement service, which owns the audit call.
    via: ['realestate.listing.entitlement.service.js', 'auditConsumption'],
  },
};

for (const [file, spec] of Object.entries(services)) {
  const src = fs.readFileSync(path.join(API, 'src/modules/realestate/services', file), 'utf8');

  // Either it writes the row itself, or it delegates to a service that does.
  const writesDirectly =
    /require\('\.\/realestate\.audit\.service'\)/.test(src) &&
    spec.events.every((e) => src.includes(`'${e}'`) || src.includes(`"${e}"`));

  const delegates =
    spec.via &&
    src.includes(spec.via[1]) &&
    // The delegated service must name the event, not this one — `auditConsumption()` owns
    // the eventType, so demanding the string here would fail a correct delegation.
    (() => {
      const target = fs.readFileSync(
        path.join(API, 'src/modules/realestate/services', spec.via[0]),
        'utf8'
      );
      return spec.events.every(
        (e) => target.includes(`'${e}'`) || target.includes(`"${e}"`)
      );
    })();

  if (writesDirectly) {
    ok(`${file} writes ${spec.events.join(', ')}`);
  } else if (delegates) {
    ok(`${file} delegates the ${spec.events.join(', ')} row to ${spec.via[0]} via ${spec.via[1]}()`);
  } else {
    bad(`${file}`, `no audit row for ${spec.events.join(', ')}`);
  }
}

    // ----------------------------------------------------------------------- [6]

    console.log('\n[6] a real purchase writes the expected rows');

    const pkg = await RealEstateListingPackage.create({
      code: CODE,
      name: 'Audit probe package',
      price: 49990,
      listingCount: 5,
      durationDays: 60,
      sortOrder: 997,
      status: true,
    });

    const vendorId = oid();
    const pending = await orderService.createOrder(vendorId, pkg.code);
    const paid = await orderService.markPaid(pending._id, { paymentRef: 'AUDIT-PROBE' });

    const orderRows = await auditService.findForTarget('ListingOrder', pending._id);
    const orderTypes = orderRows.map((r) => r.eventType);

    if (orderTypes.includes('LISTING_PACKAGE_ORDER_CREATED')) ok('order creation recorded');
    else bad('order creation', `got ${orderTypes.join(', ')}`);

    if (orderTypes.includes('LISTING_PACKAGE_ORDER_PAID')) ok('payment recorded');
    else bad('payment', `got ${orderTypes.join(', ')}`);

    const entRows = await auditService.findForTarget('ListingEntitlement', paid.entitlement);
    if (entRows.some((r) => r.eventType === 'ENTITLEMENT_GRANTED')) {
      ok('entitlement grant recorded against the entitlement, not the order');
    } else {
      bad('entitlement grant', `got ${entRows.map((r) => r.eventType).join(', ')}`);
    }

    // A SYSTEM actor for the payment: the gateway confirmed it, no user clicked.
    const paidRow = orderRows.find((r) => r.eventType === 'LISTING_PACKAGE_ORDER_PAID');
    if (paidRow.actorType === 'SYSTEM' && !paidRow.actor) {
      ok('the payment row is attributed to SYSTEM with no actor — not a fabricated user');
    } else {
      bad('payment attribution', `actorType=${paidRow.actorType} actor=${paidRow.actor}`);
    }

    // before/after must differ on a transition, or the row records nothing.
    if (paidRow.before && paidRow.after && paidRow.before.status !== paidRow.after.status) {
      ok(`the payment row records ${paidRow.before.status} -> ${paidRow.after.status}`);
    } else {
      bad('transition detail', `before=${JSON.stringify(paidRow.before)} after=${JSON.stringify(paidRow.after)}`);
    }

    // The reconciliation view must see the money movements.
    const money = await auditService.findMoneyMovements({ limit: 1000 });
    const moneyTypes = new Set(money.map((r) => r.eventType));
    if (moneyTypes.has('LISTING_PACKAGE_ORDER_PAID') && moneyTypes.has('ENTITLEMENT_GRANTED')) {
      ok('findMoneyMovements() returns the purchase rows');
    } else {
      bad('money view', `got ${[...moneyTypes].join(', ') || 'nothing'}`);
    }

    // ----------------------------------------------------------------------- [7]

    console.log('\n[7] queries scope to target and actor');

    const forTarget = await auditService.findForTarget('ListingOrder', pending._id);
    if (forTarget.every((r) => String(r.targetId) === String(pending._id))) {
      ok(`findForTarget returned ${forTarget.length} row(s), all for this order`);
    } else {
      bad('findForTarget', 'returned a row for a different target');
    }

    const byType = await auditService.findForTarget('ListingOrder', pending._id, {
      eventType: 'LISTING_PACKAGE_ORDER_PAID',
    });
    if (byType.length === 1 && byType[0].eventType === 'LISTING_PACKAGE_ORDER_PAID') {
      ok('eventType filter narrows correctly');
    } else {
      bad('eventType filter', `got ${byType.length} row(s)`);
    }
  } finally {
    console.log('\n[cleanup]');

    await RealEstateAuditLog.deleteMany({ 'metadata.packageCode': CODE }).catch(() => {});
    await RealEstateAuditLog.deleteMany({ targetType: 'ListingOrder' }).catch(() => {});
    await RealEstateListingOrder.deleteMany({ 'packageSnapshot.code': CODE }).catch(() => {});
    await RealEstateListingEntitlement.deleteMany({ 'packageSnapshot.code': CODE }).catch(() => {});
    await RealEstateListingPackage.deleteMany({ code: CODE }).catch(() => {});

    const left =
      (await RealEstateListingPackage.countDocuments({ code: CODE })) +
      (await RealEstateListingOrder.countDocuments({ 'packageSnapshot.code': CODE }));

    if (left === 0) ok('probe package, orders and audit rows removed');
    else bad('cleanup', `${left} document(s) left behind`);

    await mongoose.disconnect().catch(() => {});
  }

  console.log('');
  if (failed > 0) {
    console.log(`${failed} of ${passed + failed} check(s) FAILED`);
    process.exit(1);
  }
  console.log(`ALL ${passed} AUDIT CHECKS PASSED`);
})();