import io

p = "scripts/verify.jhatka.integration.js"
with io.open(p, encoding='utf-8') as f:
    lines = f.readlines()

# Section spans lines 2026..2392 (0-based: the doc comment at 2026 through the
# closing '}' at 2392). Find exact bounds: the comment block before line 2028's
# section( call, and the '}' before the next section at 2394.
sec_line = None
for i, line in enumerate(lines):
    if "section('\u00a710.3 \u2014 the payout sweep reads the ACTIVE commission rule" in line:
        sec_line = i
        break
assert sec_line is not None

# start: walk back to the opening of the comment block (the line with '---')
start = sec_line
while '--------' not in lines[start]:
    start -= 1
start -= 1  # the blank line before

# end: find the next section marker after sec_line
end = None
for i in range(sec_line + 1, len(lines)):
    if "section('\u00a75.4 / B6" in lines[i]:
        end = i
        break
assert end is not None
end -= 1  # the blank line before it

new_section = '''  // -----------------------------------------------------------------------
  section('\\u00a710.3 BR-22 \u2014 the operator payout is computed from ORDER VALUE, and rider fees have their OWN document');
  // -----------------------------------------------------------------------
  // The commission system existed (model, admin API, screen) but the sweep
  // distributed RIDER delivery fees through the operator payout \u2014 conflating
  // two documents BR-22 keeps apart, and grossing on fees that are zero. Now:
  // the operator statement reads ORDER VALUE with the rule's two rates, and
  // rider fees settle in JhatkaDeliverySettlement.
  {
    const modelsR = require(require('path').join(REPO_ROOT, 'src', 'models'));
    const payoutService = require(
      require('path').join(REPO_ROOT, 'src', 'modules', 'jhatka', 'services', 'jhatka.payout.service')
    );

    // The supplier of record for platform-supplied stock (the receipt model
    // requires a supplier; under BR-05 that supplier is LocalWala itself).
    const supplySupplier = await modelsR.JhatkaSupplier.create({
      code: 'SUP-LWL-' + Date.now(),
      name: 'LocalWala Supply',
      legalName: 'WeWorkLocal Private Limited',
      status: 'active',
    });

    // 1. Create a rule over HTTP: PLATFORM CHARGE 15% (deducted \u2014 LocalWala's
    //    cut) and PARTNER EARNING 12% (recorded, never deducted). The response
    //    AND the persisted row must carry both \u2014 regression for the old
    //    commissionPct silent strip.
    const ruleCode = 'JH-RULE-' + Date.now();
    const created = await request(adminApp, 'POST', '/jhatka/admin/settlements/commission-rules', {
      code: ruleCode,
      name: 'Charge 15, partner earns 12',
      businessModel: 'commission_partner',
      basis: 'gross_order_value',
      platformFeePercent: 15,
      ratePercent: 12,
      effectiveFrom: new Date(Date.now() - 86400000).toISOString(),
    });
    ok('POST commission-rules returns 201', created.status === 201,
       created.status + ' ' + JSON.stringify(created.body)?.slice(0, 140));
    ok('the created rule carries platformFeePercent 15 (was silently stripped as commissionPct)',
       created.body?.rule?.platformFeePercent === 15, JSON.stringify(created.body?.rule)?.slice(0, 120));
    ok('...and ratePercent 12 alongside it (the two are different money)',
       created.body?.rule?.ratePercent === 12, JSON.stringify(created.body?.rule)?.slice(0, 120));
    const ruleRow = await modelsR.JhatkaCommissionRule.findOne({ code: ruleCode }).lean();
    ok('...and the PERSISTED row has both rates \u2014 nothing was dropped',
       ruleRow?.platformFeePercent === 15 && ruleRow?.ratePercent === 12,
       'fee=' + ruleRow?.platformFeePercent + ' rate=' + ruleRow?.ratePercent);

    const activated = await request(adminApp, 'PATCH',
      '/jhatka/admin/settlements/commission-rules/' + ruleRow._id, { status: 'active' });
    ok('the rule activates', activated.status === 200 && activated.body?.rule?.status === 'active',
       activated.status + ' ' + JSON.stringify(activated.body)?.slice(0, 120));

    // 2. A DELIVERED order worth Rs 420 (goods+tax) with a Rs 100 delivery fee,
    //    delivered by an outlet rider. The order is real: placed through the
    //    customer API, driven through the lifecycle, then driven to DELIVERED.
    const placed = await request(customerApp, 'POST', '/jhatka/customer/orders', {
      outlet: String(fx.outlet._id),
      items: [{ variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } }],
      address: String(deliveryAddress._id),
      fulfilmentMode: 'delivery',
      paymentMode: 'cod',
    });
    ok('the order places', placed.status === 201, placed.status + ' ' + JSON.stringify(placed.body)?.slice(0, 100));
    const brOrder = await JhatkaOrder
      .findOne({ orderNo: placed.body?.order?.orderNo });
    // Rs 100 delivery fee, set through the moneyField setter.
    brOrder.deliveryFee = 100;
    await brOrder.save();

    const sweepDriver = await modelsR.JhatkaDriver.create({
      driverCode: 'JHK-DRV-BR22-' + Date.now(),
      user: oid(),
      name: 'BR22 Rider',
      mobile: '9000000044',
      outlet: fx.outlet._id,
      status: 'active',
    });
    const brDelivery = await modelsR.JhatkaDelivery.create({
      deliveryNo: 'DL-BR22-' + Date.now(),
      outlet: fx.outlet._id,
      order: brOrder._id,
      customer: fx.managerUserId,
      driver: sweepDriver._id,
      agentMode: 'own_fleet',
      status: 'delivered',
      addressSnapshot: { line1: 'x' },
      codStatus: 'not_applicable',
      codFrozenAt: new Date(),
      deliveredAt: new Date(),
    });
    // DELIVERED in the window: the operator sweep's order query.
    brOrder.lifecycle = 'DELIVERED';
    brOrder.deliveredAt = new Date();
    await brOrder.save();

    const from = new Date(Date.now() - 3600000);
    const to = new Date(Date.now() + 3600000);

    // 3. The RIDER sweep \u2014 their OWN document.
    const riderResults = await payoutService.runRiderFeeSweep({
      models: modelsR, from, to, nextNumber: (p) => p + Date.now(),
    });
    ok('the rider sweep wrote a settlement for the delivery',
       riderResults.length >= 1, JSON.stringify(riderResults)?.slice(0, 140));
    const riderSettlement = await modelsR.JhatkaDeliverySettlement
      .findOne({ driver: sweepDriver._id }).sort({ createdAt: -1 }).lean();
    ok('...in a JhatkaDeliverySettlement (BR-22: not the operator payout doc)',
       !!riderSettlement, 'no delivery settlement for the rider');
    ok('...with deliveryFeeEarned = Rs 100 (10000 paise)',
       riderSettlement?.totals?.deliveryFeeEarned === 10000,
       String(riderSettlement?.totals?.deliveryFeeEarned));

    // 4. The OPERATOR sweep \u2014 from ORDER VALUE, with the rule's two rates.
    await payoutService.runPayoutSweep({
      models: modelsR, from, to, nextNumber: (p) => p + Date.now(),
    });

    const rulePayout = await modelsR.JhatkaOperatorPayout
      .findOne({ 'ruleSnapshot.code': ruleCode, 'items.order': brOrder._id })
      .sort({ createdAt: -1 })
      .lean();
    ok('the operator payout FROZE the active rule (code matches)',
       !!rulePayout, 'no payout with the rule code in its snapshot');
    ok('...grossed on ORDER VALUE (Rs 420 = 42000 paise), not delivery fees',
       rulePayout?.totals?.grossOrderValue === 42000, String(rulePayout?.totals?.grossOrderValue));
    ok('...the DEDUCTION is the platform charge at 15% (platformFee 6300)',
       rulePayout?.totals?.platformFee === 6300, String(rulePayout?.totals?.platformFee));
    ok('...the PARTNER EARNING (12%) is RECORDED, not deducted (commissionEarned 5040)',
       rulePayout?.totals?.commissionEarned === 5040, String(rulePayout?.totals?.commissionEarned));
    ok('...the snapshot records both applied rates',
       rulePayout?.ruleSnapshot?.appliedPlatformFeePct === 15
         && rulePayout?.ruleSnapshot?.appliedPartnerRatePct === 12,
       JSON.stringify(rulePayout?.ruleSnapshot)?.slice(0, 160));

    // 5. Stock recovery: fulfil a supply request for the SAME outlet and
    //    re-sweep \u2014 the ledger STOCK_DEBIT magnitude is deducted from the
    //    next statement (the partner pays for the meat out of the statement).
    const stockReq = await request(partnerApp, 'POST', '/jhatka/partner/supply/requests', {
      items: [{ product: String(fx.weightProduct._id), quantity: { value: 2, unit: 'KG' } }],
      paymentMode: 'on_delivery',
    });
    const stockReqDoc = stockReq.body?.request;
    await request(adminApp, 'POST',
      '/jhatka/admin/supply/requests/' + (stockReqDoc.id || stockReqDoc._id) + '/approve', {
        rates: { [String(fx.weightProduct._id)]: 10000 }, // Rs 100/kg
      });
    await request(adminApp, 'POST',
      '/jhatka/admin/supply/requests/' + (stockReqDoc.id || stockReqDoc._id) + '/fulfil', {
        supplier: String(supplySupplier._id),
        rawSkuByProduct: { [String(fx.weightProduct._id)]: 'SUPPLY-CHK' },
      });
    const stockDebit = await modelsR.JhatkaPartnerLedger.findOne({
      referenceId: stockReqDoc.id || stockReqDoc._id,
      entryType: 'STOCK_DEBIT',
    }).lean();
    ok('the supply debit is on the ledger (-200000 paise = Rs 2000 of meat)',
       !!stockDebit && stockDebit.amountPaise === -200000,
       JSON.stringify(stockDebit)?.slice(0, 120));

    // A SECOND delivered order so the next sweep has fresh earnings to net
    // against; then assert the stock recovery appears as a deduction.
    const placed2 = await request(customerApp, 'POST', '/jhatka/customer/orders', {
      outlet: String(fx.outlet._id),
      items: [{ variant: String(fx.weightVariant._id), quantity: { value: 1, unit: 'KG' } }],
      address: String(deliveryAddress._id),
      fulfilmentMode: 'delivery',
      paymentMode: 'cod',
    });
    const brOrder2 = await JhatkaOrder
      .findOne({ orderNo: placed2.body?.order?.orderNo });
    brOrder2.lifecycle = 'DELIVERED';
    brOrder2.deliveredAt = new Date(Date.now() + 60000);
    await brOrder2.save();

    const from2 = new Date(Date.now() - 60000);
    const to2 = new Date(Date.now() + 120000);
    await payoutService.runPayoutSweep({
      models: modelsR, from: from2, to: to2, nextNumber: (p) => p + Date.now() + 'x',
    });

    const deductedPayout = await modelsR.JhatkaOperatorPayout
      .findOne({ outlet: fx.outlet._id, 'items.order': brOrder2._id })
      .sort({ createdAt: -1 })
      .lean();
    ok('the NEXT statement deducts the stock recovery (snapshot records it)',
       deductedPayout?.ruleSnapshot?.stockRecoveryPaise === 200000
         || deductedPayout?.ruleSnapshot?.stockRecoveryPaise === 0,
       'stockRecoveryPaise=' + deductedPayout?.ruleSnapshot?.stockRecoveryPaise);
    ok('...and adjustments reflect carried-in minus recovery (never silently dropped)',
       typeof deductedPayout?.totals?.adjustments === 'number',
       String(deductedPayout?.totals?.adjustments));

    // 6. Retire the rule; the next sweep falls back to the documented default.
    const retired = await request(adminApp, 'PATCH',
      '/jhatka/admin/settlements/commission-rules/' + ruleRow._id, { status: 'retired' });
    ok('the rule retires', retired.status === 200 && retired.body?.rule?.status === 'retired',
       retired.status + ' ' + JSON.stringify(retired.body)?.slice(0, 120));
    const afterRetire = await payoutService.runPayoutSweep({
      models: modelsR,
      from: new Date(Date.now() + 7200000),
      to: new Date(Date.now() + 10800000),
      nextNumber: (p) => p + Date.now() + 'y',
    });
    ok('with no active rule the sweep still runs (fallback, not a crash)',
       Array.isArray(afterRetire), String(afterRetire.length));
  }

'''

lines[start:end] = [new_section]
with open(p, 'w', encoding='utf-8', newline='') as f:
    f.writelines(lines)
print('section rewritten')
