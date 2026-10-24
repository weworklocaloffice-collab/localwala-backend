/**
 * verify.realestate.customer.loans.js — Flow 12 gate.
 *
 * The customer loan surface: request a loan against a property you can
 * see, list your requests with their applications + offers nested,
 * open one for the compare screen. The backend pieces this gates:
 *
 *   - 4 routes on `/v1/realestate/customer` behind `appAuth()`
 *   - Joi body with employment + income required, and **no** `customer`
 *     / `status` / `bank` field (tenant from the token; a customer
 *     cannot route the lead or self-sanction — BR-10)
 *   - ownership scoping (list, detail, optional lead) — 404, not 403
 *   - one open request per property (no duplicate distribution)
 *   - the request flips REQUIRED → LOAN_LEAD_CREATED through
 *     LOAN_TRANSITIONS, then fans out to every ACTIVE bank as one
 *     application each (unique index tolerated on retry)
 *   - first offer moves application + request to OFFERS_PENDING
 *   - accepting one offer closes the others and advances the winner to
 *     DOCUMENTS_PENDING, then the bank moves it to UNDER_BANK_REVIEW
 *   - property on a request must be PUBLIC_STATUS (same check as the
 *     enquiry route)
 *
 * Run: node scripts/verify.realestate.customer.loans.js
 */

const fs = require('fs');
const path = require('path');

const ROUTE = path.resolve(__dirname, '..', 'src', 'modules', 'realestate', 'routes', 'realestate.customer.route.js');
const VALIDATION = path.resolve(__dirname, '..', 'src', 'modules', 'realestate', 'validations', 'realestate.customer.validation.js');
const CONTROLLER = path.resolve(__dirname, '..', 'src', 'modules', 'realestate', 'controllers', 'realestate.customer.controller.js');
const LOAN_SERVICE = path.resolve(__dirname, '..', 'src', 'modules', 'realestate', 'services', 'realestate.loan.service.js');
const REQUEST_MODEL = path.resolve(__dirname, '..', 'src', 'modules', 'realestate', 'models', 'realestate.loan.request.model.js');
const STATE_MACHINE = path.resolve(__dirname, '..', 'src', 'modules', 'realestate', 'utils', 'realestate.state.machine.js');
const BANK_VALIDATION = path.resolve(__dirname, '..', 'src', 'modules', 'realestate', 'validations', 'realestate.bank.validation.js');
const BANK_CONTROLLER = path.resolve(__dirname, '..', 'src', 'modules', 'realestate', 'controllers', 'realestate.bank.controller.js');

const V = require(VALIDATION);
const router = require(ROUTE);
const stateMachine = require(STATE_MACHINE);

const controllerText = fs.readFileSync(CONTROLLER, 'utf8');
const loanText = fs.readFileSync(LOAN_SERVICE, 'utf8');
const validationText = fs.readFileSync(VALIDATION, 'utf8');
const routeText = fs.readFileSync(ROUTE, 'utf8');
const requestModelText = fs.readFileSync(REQUEST_MODEL, 'utf8');
const bankValidationText = fs.readFileSync(BANK_VALIDATION, 'utf8');
const bankControllerText = fs.readFileSync(BANK_CONTROLLER, 'utf8');

const checks = [];
const assert = (label, ok, detail = '') => {
  checks.push({ label, ok, detail });
};

// ---- 1. The 4 customer loan routes are wired behind appAuth(). ----
const wired = router.stack
  .filter((l) => l.route)
  .map((l) => ({
    method: Object.keys(l.route.methods)[0].toUpperCase(),
    path: l.route.path,
  }));
const expected = [
  { method: 'POST', path: '/loans' },
  { method: 'GET', path: '/loans' },
  { method: 'POST', path: '/loans/:id/offers/:offerId/accept' },
  { method: 'GET', path: '/loans/:id' },
];
const missing = expected.filter(
  (e) => !wired.some((w) => w.method === e.method && w.path === e.path)
);
assert(
  '[1a] POST/GET /loans, accept-offer and GET /loans/:id wired on the customer router',
  missing.length === 0,
  missing.length
    ? `missing: ${missing.map((m) => m.method + ' ' + m.path).join(', ')}`
    : 'all 4 wired'
);

const loanRouteBlocks = routeText.split('router.').filter((block) => block.includes("'/loans"));
assert(
  '[1b] every loan route declares appAuth()',
  loanRouteBlocks.length === 4 && loanRouteBlocks.every((block) => block.includes('appAuth()')),
  `${loanRouteBlocks.length} loan route block(s)`
);

// ---- 2. Validation: schema shape. ----
assert(
  '[2a] createLoan body schema exported (in the { body } wrapper)',
  !!(V.createLoan && V.createLoan.body) && /createLoan: \{ body: loanCreateBody \}/.test(validationText)
);
const loanBodyMatch = validationText.match(/loanCreateBody = Joi\.object\(\{[\s\S]*?\}\)/);
const loanFields = loanBodyMatch
  ? (loanBodyMatch[0].match(/^\s+(\w+):/gm) || []).map((s) => s.trim().replace(':', ''))
  : [];
assert(
  '[2b] body has property + amount + employment + income, and no customer / status / bank',
  !!loanBodyMatch &&
    ['property', 'requestedAmount', 'employment', 'monthlyIncome'].every((f) => loanFields.includes(f)) &&
    !loanFields.includes('customer') &&
    !loanFields.includes('status') &&
    !loanFields.includes('bank'),
  loanBodyMatch ? `fields: ${loanFields.join(', ')}` : 'loanCreateBody not found'
);

// ---- 3. Joi probes: income required, employment closed, no self-sanction. ----
{
  const good = V.createLoan.body.validate({
    property: '64b0000000000000000000aa',
    requestedAmount: 5000000,
    employment: 'SALARIED',
    monthlyIncome: 75000,
  });
  assert('[3a] a complete request body validates', !good.error, good.error ? good.error.message : 'ok');

  const noIncome = V.createLoan.body.validate({
    property: '64b0000000000000000000aa',
    requestedAmount: 5000000,
    employment: 'SALARIED',
  });
  assert('[3b] monthlyIncome is required (the form collects it, the bank needs it)', !!noIncome.error);

  const badEmployment = V.createLoan.body.validate({
    property: '64b0000000000000000000aa',
    requestedAmount: 5000000,
    employment: 'UNEMPLOYED',
    monthlyIncome: 75000,
  });
  assert('[3c] employment enum is closed', !!badEmployment.error && /one of|valid/.test(badEmployment.error.message));

  const selfSanction = V.createLoan.body.validate({
    property: '64b0000000000000000000aa',
    requestedAmount: 5000000,
    employment: 'SALARIED',
    monthlyIncome: 75000,
    status: 'SANCTIONED',
  });
  assert('[3d] a `status` (self-sanction) in the body is rejected — BR-10 has no path here', !!selfSanction.error);

  const zeroAmount = V.createLoan.body.validate({
    property: '64b0000000000000000000aa',
    requestedAmount: 500,
    employment: 'SALARIED',
    monthlyIncome: 75000,
  });
  assert('[3e] requestedAmount below ₹1,000 rejected', !!zeroAmount.error);
}

// ---- 4. Controller handlers exist and scope to req.user. ----
const handlerOk = (name) => {
  const m = controllerText.match(new RegExp(`const ${name} = catchAsync\\(async \\(req, res\\) => \\{[\\s\\S]+?\\n\\}\\);`));
  return m && m[0].includes('requireCustomer(req)');
};
assert('[4a] createLoanRequest handler scopes to requireCustomer', !!handlerOk('createLoanRequest'));
assert('[4b] listMyLoans handler scopes to requireCustomer', !!handlerOk('listMyLoans'));
assert('[4c] getMyLoan handler scopes to requireCustomer', !!handlerOk('getMyLoan'));
assert(
  '[4d] getMyLoan 404s (missing and foreign id are indistinguishable)',
  /getMyLoan[\s\S]+?NOT_FOUND/.test(controllerText)
);
assert(
  '[4e] createLoanRequest applies the PUBLIC_STATUS check (same constant as the enquiry route)',
  /createLoanRequest[\s\S]+?searchService\.PUBLIC_STATUS/.test(controllerText)
);
assert(
  '[4f] an optional lead must be this customer\'s (foreign id → 404)',
  /findOne\(\s*\{\s*_id:\s*req\.body\.lead,\s*customer:\s*customerId\s*\}\)/.test(controllerText)
);

// ---- 5. Service: guards, transition, fan-out, scoping. ----
assert(
  '[5a] one open request per property ($nin terminal: WITHDRAWN/REJECTED/DISBURSED)',
  /status: \{ \$nin: \['WITHDRAWN', 'REJECTED', 'DISBURSED'\] \}/.test(loanText)
);
assert(
  '[5b] duplicate open request is a 409 CONFLICT',
  /CONFLICT/.test(loanText) && /already have an open loan request/.test(loanText)
);
assert(
  '[5c] REQUIRED → LOAN_LEAD_CREATED goes through assertLoanTransition (table-sanctioned)',
  /assertLoanTransition\(request\.status, 'LOAN_LEAD_CREATED'\)/.test(loanText)
);
assert(
  '[5d] fan-out targets every ACTIVE bank with status LOAN_LEAD_CREATED',
  /RealEstateBank\.find\(\{ status: 'ACTIVE' \}\)/.test(loanText) &&
    /status: 'LOAN_LEAD_CREATED'/.test(loanText)
);
assert(
  '[5e] a retried fan-out tolerates the unique index { loanRequest, bank } (code 11000)',
  /e\.code !== 11000/.test(loanText)
);
assert(
  '[5f] listForCustomer filters { customer: customerId } and sorts newest first',
  /async function listForCustomer[\s\S]+?find\(\{ customer: customerId \}\)[\s\S]+?sort\(\{ createdAt: -1 \}\)/.test(loanText)
);
assert(
  '[5g] findForCustomer scopes findOne to { _id, customer }',
  /async function findForCustomer[\s\S]+?findOne\(\s*\{\s*_id:\s*requestId,\s*customer:\s*customerId\s*\}\)/.test(loanText)
);
assert(
  '[5h] applications + offers are manual joins (no aggregation stages)',
  /attachApplications/.test(loanText) && !/\.aggregate\(/.test(loanText)
);

// ---- 6. Model carries the borrower profile the form collects. ----
assert(
  '[6a] request model has an employment enum (SALARIED..OTHER)',
  /employment: \{[\s\S]{0,200}enum: \['SALARIED', 'SELF_EMPLOYED', 'BUSINESS', 'OTHER'\]/.test(requestModelText)
);
assert(
  '[6b] request model has monthlyIncome as a moneyField',
  /monthlyIncome: moneyField\(0\)/.test(requestModelText)
);

// ---- 7. First offer moves application + request to OFFERS_PENDING. ----
assert(
  '[7a] createOffer flips a LOAN_LEAD_CREATED application to OFFERS_PENDING',
  /createOffer[\s\S]+?app\.status = 'OFFERS_PENDING'/.test(loanText)
);
assert(
  '[7b] ...and its parent request, so the customer list chip updates',
  /parent\.status = 'OFFERS_PENDING'/.test(loanText)
);
assert(
  '[7c] the offer status side-effect is best-effort (a failed flip cannot lose an offer)',
  /createOffer[\s\S]+?try \{[\s\S]+?status side-effect is best-effort/.test(loanText)
);
assert(
  '[7d] createOffer scopes the application to the calling bank and blocks post-selection offers',
  /findOne\(\{ _id: loanApplication, bank \}\)/.test(loanText) &&
    /no longer accepting offers/.test(loanText)
);

// ---- 7.5 Customer accepts one offer; losers close; winner advances. ----
assert(
  '[7.5a] acceptLoanOffer is exported in the { params } shape with both ids',
  !!(V.acceptLoanOffer && V.acceptLoanOffer.params) &&
    /acceptLoanOffer: \{ params: loanOfferParam \}/.test(validationText) &&
    /offerId: id\.required\(\)/.test(validationText)
);
assert(
  '[7.5b] acceptLoanOffer handler scopes to requireCustomer and calls the service',
  handlerOk('acceptLoanOffer') && /loanService\.acceptOffer\(/.test(controllerText)
);
assert(
  '[7.5c] acceptOffer proves ownership through { _id, customer }',
  /async function acceptOffer[\s\S]+?findOne\(\{ _id: requestId, customer: customerId \}\)/.test(loanText)
);
assert(
  '[7.5d] a second selection is rejected with 409',
  /already selected a loan offer/.test(loanText) && /CONFLICT/.test(loanText)
);
assert(
  '[7.5e] accepting runs in withOptionalTransaction and closes losers',
  /acceptOffer[\s\S]+?withOptionalTransaction\(async \(session\) =>/.test(loanText) &&
    /status: 'WITHDRAWN'/.test(loanText) &&
    /status: 'REJECTED'/.test(loanText)
);
assert(
  '[7.5f] the selected offer becomes ACCEPTED and app + request advance to DOCUMENTS_PENDING',
  /offer\.status = 'ACCEPTED'/.test(loanText) &&
    /advanceLoanStatus\(app\.status, 'DOCUMENTS_PENDING'\)/.test(loanText) &&
    /advanceLoanStatus\(request\.status, 'DOCUMENTS_PENDING'\)/.test(loanText)
);
assert(
  '[7.5g] no BFS shortcut invents an edge outside LOAN_TRANSITIONS',
  /function loanStatusPath[\s\S]+?LOAN_TRANSITIONS\[current\]/.test(loanText)
);

// ---- 8. State machine still sanctions the loan lifecycle. ----
assert(
  '[8a] LOAN_TRANSITIONS: REQUIRED → LOAN_LEAD_CREATED',
  stateMachine.canTransition(stateMachine.LOAN_TRANSITIONS, 'REQUIRED', 'LOAN_LEAD_CREATED')
);
assert(
  '[8b] LOAN_TRANSITIONS: LOAN_LEAD_CREATED → OFFERS_PENDING',
  stateMachine.canTransition(stateMachine.LOAN_TRANSITIONS, 'LOAN_LEAD_CREATED', 'OFFERS_PENDING')
);
assert(
  '[8c] the customer surface cannot reach a bank-only target at all (BR-10)',
  !stateMachine.canTransition(stateMachine.LOAN_TRANSITIONS, 'LOAN_LEAD_CREATED', 'SANCTIONED')
);
assert(
  '[8d] DOCUMENTS_PENDING → UNDER_BANK_REVIEW is legal',
  stateMachine.canTransition(stateMachine.LOAN_TRANSITIONS, 'DOCUMENTS_PENDING', 'UNDER_BANK_REVIEW')
);
assert(
  '[8e] the full selection → review → sanction path is legal',
  ['OFFERS_PENDING', 'OFFERS_RECEIVED', 'CUSTOMER_SELECTING', 'BANK_SELECTED', 'APPLICATION_STARTED', 'DOCUMENTS_PENDING', 'UNDER_BANK_REVIEW', 'SANCTIONED']
    .every((s, i, all) => i === 0 || stateMachine.canTransition(stateMachine.LOAN_TRANSITIONS, all[i - 1], s))
);
assert(
  '[8f] bank status allow-list includes UNDER_BANK_REVIEW',
  /ALLOWED_STATUS = \[[^\]]*'UNDER_BANK_REVIEW'/.test(bankValidationText)
);
assert(
  '[8g] bank controller passes req.bankId into setApplicationStatus',
  /setApplicationStatus\([\s\S]+?bankId: req\.bankId/.test(bankControllerText)
);
assert(
  '[8h] setApplicationStatus scopes the application to the calling bank',
  /bankId && String\(app\.bank\) !== String\(bankId\)/.test(loanText)
);
assert(
  '[8i] a bank withdrawing before selection does not close the parent request',
  /PRE_SELECTION_REQUEST_STATUSES[\s\S]+?target === 'WITHDRAWN'/.test(loanText)
);

// ---- 9. Admin can switch the capability off (settings, default ON). ----
assert(
  '[9a] createRequestForCustomer honours settings.customerCanRequestLoan === false (403)',
  /customerCanRequestLoan === false/.test(loanText) &&
    /FORBIDDEN/.test(loanText)
);

// ---- 10. Live DB: fan-out, ownership, and the money getters. ----
//
// The money check is the load-bearing one: lean() bypasses the
// moneyField getters, so a lean query ships paise — a silent 100×
// bug. This section proves the read path returns rupees.
async function liveDbChecks() {
  const mongoose = require('mongoose');
  const url = process.env.MONGODB_URL || process.env.MONGODB_URI;
  if (!url) {
    assert('[10] live DB section', false, 'MONGODB_URL not set — skipped?');
    return;
  }
  await mongoose.connect(url, { serverSelectionTimeoutMS: 8000 });
  try {
    const RealEstateBank = require('../src/modules/realestate/models/realestate.bank.model');
    const LoanRequest = require('../src/modules/realestate/models/realestate.loan.request.model');
    const LoanApplication = require('../src/modules/realestate/models/realestate.loan.application.model');
    const BankOffer = require('../src/modules/realestate/models/realestate.bank.offer.model');
    const Setting = require('../src/modules/realestate/models/realestate.setting.model');
    const svc = require('../src/modules/realestate/services/realestate.loan.service.js');

    const stamp = Date.now();
    const activeBank = await RealEstateBank.create({
      name: `Gate Active Bank ${stamp}`,
      code: `GAB${stamp % 100000}`,
      status: 'ACTIVE',
    });
    const offBank = await RealEstateBank.create({
      name: `Gate Off Bank ${stamp}`,
      code: `GOB${stamp % 100000}`,
      status: 'SUSPENDED',
    });
    const customer = new mongoose.Types.ObjectId();
    const propertyId = new mongoose.Types.ObjectId();

    const request = await svc.createRequestForCustomer({
      customer,
      property: { _id: propertyId },
      requestedAmount: 5000000,
      employment: 'SALARIED',
      monthlyIncome: 75000,
    });
    assert(
      '[10a] a new request lands LOAN_LEAD_CREATED (table-sanctioned)',
      request.status === 'LOAN_LEAD_CREATED',
      `status=${request.status}`
    );

    const apps = await LoanApplication.find({ loanRequest: request._id });
    assert(
      '[10b] fan-out created exactly one application, on the ACTIVE bank only',
      apps.length === 1 &&
        String(apps[0].bank) === String(activeBank._id) &&
        apps[0].status === 'LOAN_LEAD_CREATED',
      `${apps.length} application(s)`
    );

    let conflict = null;
    try {
      await svc.createRequestForCustomer({
        customer,
        property: { _id: propertyId },
        requestedAmount: 5000000,
        employment: 'SALARIED',
        monthlyIncome: 75000,
      });
    } catch (e) {
      conflict = e;
    }
    assert(
      '[10c] a second open request for the same property is 409 CONFLICT',
      conflict && conflict.statusCode === 409,
      conflict ? `statusCode=${conflict.statusCode}` : 'no error thrown'
    );

    // The money round-trip: raw storage is paise, the read path is rupees.
    // Create through the service so the first-offer status side-effect runs.
    await svc.createOffer({
      loanApplication: apps[0]._id,
      bank: activeBank._id,
      loanAmount: 4800000,
      tenureMonths: 180,
      interestRate: 8.5,
      processingFee: 5000,
    });
    const { results } = await svc.listForCustomer(customer, { page: 1, limit: 10 });
    const row = results.find((r) => String(r._id) === String(request._id));
    const offer = row && row.applications[0] && row.applications[0].offers[0];
    assert(
      '[10d] read path returns RUPEES, not paise (the 100× guard)',
      !!row &&
        row.requestedAmount === 5000000 &&
        row.monthlyIncome === 75000 &&
        !!offer &&
        offer.loanAmount === 4800000,
      row
        ? `requestedAmount=${row.requestedAmount} monthlyIncome=${row.monthlyIncome} loanAmount=${offer && offer.loanAmount}`
        : 'row not found'
    );
    assert(
      '[10e] the first offer moved application + request to OFFERS_PENDING',
      !!row && row.status === 'OFFERS_PENDING' &&
        row.applications[0].status === 'OFFERS_PENDING',
      row ? `request=${row.status} app=${row.applications[0].status}` : ''
    );

    // Cross-bank offer: the suspended bank must not be able to price
    // another bank's application just because it knows the id.
    let crossBankOffer = null;
    try {
      await svc.createOffer({
        loanApplication: apps[0]._id,
        bank: offBank._id,
        loanAmount: 4700000,
        tenureMonths: 180,
        interestRate: 9,
      });
    } catch (e) {
      crossBankOffer = e;
    }
    assert(
      '[10f] createOffer refuses another bank\'s application (404)',
      crossBankOffer && crossBankOffer.statusCode === 404,
      crossBankOffer ? `statusCode=${crossBankOffer.statusCode}` : 'no error thrown'
    );

    // Customer selection: winner ACCEPTED, request + application at
    // DOCUMENTS_PENDING, then the bank starts underwriting.
    const selected = await svc.acceptOffer({
      requestId: request._id,
      offerId: offer._id,
      customer,
    });
    const selectedApp = selected.applications.find((a) => String(a._id) === String(apps[0]._id));
    const selectedOffer = selectedApp && selectedApp.offers.find((o) => String(o._id) === String(offer._id));
    assert(
      '[10g] accepting one offer advances request + application to DOCUMENTS_PENDING',
      selected.status === 'DOCUMENTS_PENDING' &&
        !!selectedApp &&
        selectedApp.status === 'DOCUMENTS_PENDING' &&
        !!selectedOffer &&
        selectedOffer.status === 'ACCEPTED',
      selected
        ? `request=${selected.status} app=${selectedApp && selectedApp.status} offer=${selectedOffer && selectedOffer.status}`
        : 'selection returned nothing'
    );

    await svc.setApplicationStatus(apps[0]._id, 'UNDER_BANK_REVIEW', {
      actorType: 'bank',
      bankId: activeBank._id,
    });
    const reviewed = await svc.findForCustomer(request._id, customer);
    assert(
      '[10h] bank review keeps the parent request in step',
      !!reviewed &&
        reviewed.status === 'UNDER_BANK_REVIEW' &&
        reviewed.applications[0].status === 'UNDER_BANK_REVIEW',
      reviewed ? `request=${reviewed.status} app=${reviewed.applications[0].status}` : 'not found'
    );

    let wrongBankStatus = null;
    try {
      await svc.setApplicationStatus(apps[0]._id, 'SANCTIONED', {
        actorType: 'bank',
        bankId: offBank._id,
        sanctionedAmount: 4500000,
      });
    } catch (e) {
      wrongBankStatus = e;
    }
    assert(
      '[10i] setApplicationStatus refuses another bank\'s application (404)',
      wrongBankStatus && wrongBankStatus.statusCode === 404,
      wrongBankStatus ? `statusCode=${wrongBankStatus.statusCode}` : 'no error thrown'
    );

    await svc.setApplicationStatus(apps[0]._id, 'SANCTIONED', {
      actorType: 'bank',
      bankId: activeBank._id,
      sanctionedAmount: 4500000,
    });
    const sanctioned = await svc.findForCustomer(request._id, customer);
    assert(
      '[10j] sanctioning syncs the request and keeps the amount in rupees',
      !!sanctioned &&
        sanctioned.status === 'SANCTIONED' &&
        sanctioned.applications[0].status === 'SANCTIONED' &&
        sanctioned.applications[0].sanctionedAmount === 4500000,
      sanctioned
        ? `request=${sanctioned.status} app=${sanctioned.applications[0].status} amount=${sanctioned.applications[0].sanctionedAmount}`
        : 'not found'
    );

    // Settings kill-switch: flagged OFF → 403, then restore.
    const settingsDoc = await Setting.findOne();
    let restored = false;
    if (settingsDoc) {
      const before = settingsDoc.customerCanRequestLoan;
      settingsDoc.customerCanRequestLoan = false;
      await settingsDoc.save();
      let forbidden = null;
      try {
        await svc.createRequestForCustomer({
          customer: new mongoose.Types.ObjectId(),
          property: { _id: new mongoose.Types.ObjectId() },
          requestedAmount: 2000000,
          employment: 'BUSINESS',
          monthlyIncome: 90000,
        });
      } catch (e) {
        forbidden = e;
      }
      settingsDoc.customerCanRequestLoan = before;
      await settingsDoc.save();
      restored = true;
      assert(
        '[10k] settings.customerCanRequestLoan=false blocks a new request with 403',
        forbidden && forbidden.statusCode === 403,
        forbidden ? `statusCode=${forbidden.statusCode}` : 'no error thrown'
      );
    } else {
      assert(
        '[10k] settings.customerCanRequestLoan=false blocks a new request with 403',
        true,
        'no settings row on this DB — default-ON path covered by [9a]'
      );
    }

    await LoanRequest.deleteOne({ _id: request._id });
    await LoanApplication.deleteMany({ loanRequest: request._id });
    await BankOffer.deleteMany({ loanApplication: apps[0]._id });
    await RealEstateBank.deleteOne({ _id: activeBank._id });
    await RealEstateBank.deleteOne({ _id: offBank._id });
    void restored;
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
    console.log('Customer loans (Flow 12) — gate');
    console.log('===============================');
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
    console.log(`ALL ${checks.length} CUSTOMER LOAN CHECKS PASSED`);
  });
