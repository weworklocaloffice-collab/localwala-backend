/**
 * verify.realestate.customer.js — BR-06 and the customer tenant boundary.
 *
 * ## What this covers
 *
 * Doc §7.3 names `POST /v1/realestate/customer/properties/:id/enquiry` as one of four routes
 * that must exist by name. It did not: there was no `realestate.customer.route.js`, so BR-06
 * — "an enquiry creates a Lead, it is never a contact message" — was enforceable only by
 * calling the service directly from a test. No customer could reach it.
 *
 * These checks drive the controller over HTTP so the route, the auth gate and the tenant
 * scoping are all exercised together.
 *
 * ## The four cases that matter
 *
 * 1. A published property produces a lead (BR-06), not a stored message.
 * 2. An unpublished property produces 404 — an enquiry must not be a way to probe drafts.
 * 3. One customer cannot read another's lead, and the refusal is indistinguishable from a
 *    missing id (no id oracle).
 * 4. No customer id appears anywhere in the route surface — the tenant is the token only.
 *
 * Run: node scripts/verify.realestate.customer.js
 */

const path = require('path');
const fs = require('fs');

const API = path.resolve(__dirname, '..');
const mongoose = require(path.join(API, 'node_modules/mongoose'));
require(path.join(API, 'node_modules/dotenv')).config({ path: path.join(API, '.env') });

const RealEstateLead = require(path.join(
  API,
  'src/modules/realestate/models/realestate.lead.model'
));
const RealEstateLeadActivity = require(path.join(
  API,
  'src/modules/realestate/models/realestate.lead.activity.model'
));
const RealEstateProperty = require(path.join(
  API,
  'src/modules/realestate/models/realestate.property.model'
));
const RealEstatePropertyCategory = require(path.join(
  API,
  'src/modules/realestate/models/realestate.property.category.model'
));
const leadService = require(path.join(
  API,
  'src/modules/realestate/services/realestate.lead.service'
));
const customerRoute = require(path.join(
  API,
  'src/modules/realestate/routes/realestate.customer.route'
));

/**
 * Register the passport strategies the customer routes depend on.
 *
 * `appAuth()` calls `passport.authenticate('jwt-app', …)`, and those strategies are only
 * registered in `src/app.js` at boot. Without them every route 500s with
 * `Unknown authentication strategy "jwt-app"` — a harness gap, not a product bug.
 */
const passport = require(path.join(API, 'node_modules/passport'));
const { jwtAppStrategy, jwtWebStrategy } = require(path.join(API, 'src/config/passport'));
passport.use('jwt-app', jwtAppStrategy);
passport.use('jwt-web', jwtWebStrategy);

/**
 * Mint a real access token for a real User.
 *
 * The first version of this harness injected `req.user` directly and every route answered
 * 401. `appAuth()` is passport, and passport runs `jwtVerify` (see `src/config/passport.js`)
 * which does `User.findById(payload.sub)` — it ignores any `req.user` already present and
 * overwrites it. So the only faithful way to test an `appAuth()` route is with a genuine
 * signed token for a genuine user, which is what this does.
 */
const jwt = require(path.join(API, 'node_modules/jsonwebtoken'));
const config = require(path.join(API, 'src/config/config'));
const { tokenTypes } = require(path.join(API, 'src/config/tokens'));
const User = require(path.join(API, 'src/models/user.model'));

const probeUsers = [];

async function makeCustomer() {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const user = await User.create({
    email: `custprobe${stamp}@test.local`,
    // `password` has a custom validator; this satisfies it without being a real secret.
    password: 'ProbeOnly12345',
    role: 'user',
    // Both are required by the User schema — omitting them fails the whole fixture.
    firstName: 'Customer',
    lastName: 'Probe',
    countryCode: '+91',
    mobile: `9${String(stamp).slice(-9)}`,
    status: true,
  });
  probeUsers.push(user._id);

  const token = jwt.sign(
    { sub: user._id.toString(), type: tokenTypes.ACCESS },
    config.jwt.secret,
    { expiresIn: '15m' }
  );

  return { id: user._id.toString(), token };
}

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

/**
 * Drive an express router with a fake req/res, so the real middleware chain, the real
 * passport strategy and the real Joi validation all run without binding a port.
 *
 * `auth` is a `{ id, token }` from `makeCustomer()`; the token goes in as a real
 * `Authorization: Bearer` header so `appAuth()` does the resolving.
 *
 * ## `req.params` is filled by matching the route PATTERN
 *
 * Express does not read params out of the URL — the router matches the request path
 * against each route's pattern and copies the captured groups into `req.params`. Passing a
 * concrete path like `/leads/<id>` therefore populates nothing, because no literal segment
 * starts with `:`. The first version of this harness did exactly that and every param route
 * answered `""id" must be a valid mongo id` with the literal string "undefined".
 *
 * So the route table is searched for a pattern that matches the request, and the captured
 * groups are extracted from it.
 */
const ROUTE_PATTERNS = [];

const matchRoute = (method, path_) => {
  const parts = path_.split('/').filter(Boolean);
  for (const pattern of ROUTE_PATTERNS) {
    const p = pattern.path.split('/').filter(Boolean);
    if (p.length !== parts.length) continue;
    if (pattern.method && pattern.method !== method.toUpperCase()) continue;

    const captured = {};
    let matched = true;
    for (let i = 0; i < p.length; i++) {
      if (p[i].startsWith(':')) captured[p[i].slice(1)] = parts[i];
      else if (p[i] !== parts[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { pattern, captured };
  }
  return null;
};

const call = (method, path_, { body = {}, query = {}, auth = null } = {}) =>
  new Promise((resolve) => {
    const found = matchRoute(method, path_);
    if (!found) {
      resolve({ status: 404, error: new Error(`no route matches ${method} ${path_}`) });
      return;
    }

    const req = {
      method: method.toUpperCase(),
      url: path_,
      path: path_,
      params: found.captured,
      query,
      body,
      headers: auth ? { authorization: `Bearer ${auth.token}` } : {},
    };

    let statusCode = 200;
    const res = {
      status(code) {
        statusCode = code;
        return res;
      },
      send(payload) {
        resolve({ status: statusCode, body: payload });
        return res;
      },
      json(payload) {
        resolve({ status: statusCode, body: payload });
        return res;
      },
    };

    customerRoute(req, res, (err) => {
      if (err && process.env.PROBE_VERBOSE) {
        console.log(`       [verbose] ${method} ${path_} -> ${err.statusCode} ${err.message}`);
      }
      resolve({ status: err ? err.statusCode || 500 : 404, error: err });
    });
  });

const routesOf = (router) => {
  const out = [];
  for (const layer of router.stack || []) {
    if (!layer.route) continue;
    const m = layer.route.methods;
    const methods = Array.isArray(m) ? m : Object.keys(m || {}).filter((k) => m[k]);
    for (const one of methods) out.push(one.toUpperCase() + ' ' + layer.route.path);
  }
  return out;
};

(async () => {
  console.log('\n[0] fixtures');
  await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
  });

  const category =
    (await RealEstatePropertyCategory.findOne({ status: true })) ||
    (await RealEstatePropertyCategory.create({
      key: 'CUSTPROBE',
      name: 'Customer probe',
      slug: 'customer-probe',
      transactionTypes: ['BUY'],
      amenityOptions: [],
      specSchema: { fields: [] },
      status: true,
    }));

  const makeProperty = async (status) => {
    const fields = (category.specSchema && category.specSchema.fields) || [];
    const specs = {};
    for (const f of fields) {
      if (!f.required) continue;
      specs[f.key] = f.type === 'NUMBER' ? 1 : true;
    }
    return RealEstateProperty.create({
      source: 'LOCALWALA_DIRECT',
      category: category._id,
      transactionType: 'BUY',
      propertyCode: `CUST-${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
      title: 'Customer probe property',
      description: 'temporary',
      price: 52500,
      location: { type: 'Point', coordinates: [78.4867, 17.385] },
      locality: oid(),
      city: oid(),
      state: oid(),
      specs,
      status,
      createdBy: oid(),
    });
  };

  const published = await makeProperty('PUBLISHED');
  const draft = await makeProperty('DRAFT');

const customerA = await makeCustomer();
  const customerB = await makeCustomer();

  const created = [];

  try {
    // ----------------------------------------------------------------------- [1]

    console.log('\n[1] the named enquiry route exists — doc §7.3');

    const mounted = routesOf(customerRoute);
    ok(`${mounted.length} customer routes registered`);
    mounted.forEach((r) => console.log('       ' + r));

    // Record the (method, pattern) pairs so `call()` can populate req.params the way
    // express does.
    ROUTE_PATTERNS.length = 0;
    for (const layer of customerRoute.stack || []) {
      if (!layer.route) continue;
      const m = layer.route.methods;
      const methods = Array.isArray(m) ? m : Object.keys(m || {}).filter((k) => m[k]);
      for (const one of methods) {
        ROUTE_PATTERNS.push({ method: one.toUpperCase(), path: layer.route.path });
      }
    }

    const enquiry = mounted.find((r) => r.includes('/properties/:id/enquiry'));
    if (enquiry && enquiry.startsWith('POST')) ok('POST /properties/:id/enquiry is present');
    else bad('enquiry route', `not found among: ${mounted.join(', ')}`);

    // ----------------------------------------------------------------------- [2]

    console.log('\n[2] BR-06 — an enquiry creates a Lead, not a message');

    const res = await call('POST', `/properties/${published._id}/enquiry`, {
      auth: customerA,
      body: { message: 'Is this still available?' },
    });

    if (res.status === 201) ok('201 Created');
    else bad('enquiry status', `got ${res.status} ${JSON.stringify(res.error && res.error.message)}`);

    const leadId = res.body && res.body.data && res.body.data._id;
    if (leadId) {
      ok(`lead ${res.body.data.leadCode} created`);
      created.push(leadId);

      const stored = await RealEstateLead.findById(leadId).lean();
      if (stored) ok('a Lead row exists — not a contact message');
      else bad('BR-06', 'no Lead document was created');

      if (String(stored.customer) === String(customerA.id)) ok('lead belongs to the token holder');
      else bad('lead customer', 'mismatch — the body was trusted over the token');

      if (String(stored.property) === String(published._id)) ok('lead points at the property');
      else bad('lead property', 'mismatch');

      if (stored.source === 'ENQUIRY') ok('source is ENQUIRY');
      else bad('lead source', `got ${stored.source}`);

      // BR-06 also means an audit row exists for the creation.
      const activity = await RealEstateLeadActivity.findOne({ lead: leadId, action: 'CREATED' }).lean();
      if (activity) ok('a CREATED activity row records the enquiry (BR-20)');
      else bad('activity', 'no CREATED row');

      if (activity && activity.actorType === 'CUSTOMER') ok('the row attributes the CUSTOMER');
      else bad('activity actorType', activity ? `got ${activity.actorType}` : 'no row');
    } else {
      bad('enquiry', 'no lead id in the response');
    }

    // ----------------------------------------------------------------------- [3]

    console.log('\n[3] no token, no enquiry');

    const anon = await call('POST', `/properties/${published._id}/enquiry`, {});
    if (anon.status === 401) ok('unauthenticated enquiry is refused with 401');
    else bad('anonymous enquiry', `got ${anon.status}`);

    const anonCount = await RealEstateLead.countDocuments({ property: published._id });
    if (anonCount === 1) ok('the refused request created nothing');
    else bad('anonymous side effect', `${anonCount} leads exist, expected 1`);

    // ----------------------------------------------------------------------- [4]

    console.log('\n[4] an enquiry cannot be filed against an unpublished property');

    const hidden = await call('POST', `/properties/${draft._id}/enquiry`, { auth: customerA });
    if (hidden.status === 404) ok('a DRAFT property answers 404, not 403 or 201');
    else bad('draft enquiry', `got ${hidden.status}`);

    // ----------------------------------------------------------------------- [5]

    console.log('\n[5] one customer cannot read another customer\'s lead');

    const mine = await call('GET', `/leads/${leadId}`, { auth: customerA });
    if (mine.status === 200) ok('the owner can read their lead');
    else bad('owner read', `got ${mine.status}`);

    const theirs = await call('GET', `/leads/${leadId}`, { auth: customerB });
    if (theirs.status === 404) ok("another customer gets 404 — no id oracle");
    else bad('cross-customer read', `got ${theirs.status}, expected 404`);

    // The 404 for "someone else's" must be the same shape as the 404 for "no such id".
    const missing = await call('GET', `/leads/${oid()}`, { auth: customerB });
    if (missing.status === theirs.status) {
      ok('the two 404s are indistinguishable, so ids cannot be probed');
    } else {
      bad('id oracle', `someone-else gave ${theirs.status}, nonexistent gave ${missing.status}`);
    }

    // ----------------------------------------------------------------------- [6]

    console.log('\n[6] the customer list is scoped to the token');

    await call('POST', `/properties/${published._id}/enquiry`, { auth: customerB });
    const bLeads = await RealEstateLead.find({ customer: customerB.id }).lean().catch(() => []);
    if (Array.isArray(bLeads)) created.push(...bLeads.map((l) => l._id));

    const listA = await call('GET', '/leads', { auth: customerA });
    if (listA.status === 200 && Array.isArray(listA.body.results)) {
      const allMine = listA.body.results.every((l) => String(l.customer) === String(customerA.id));
      if (allMine) ok(`customer A sees only their own ${listA.body.total} lead(s)`);
      else bad('list scoping', 'another customer\'s lead appeared in the list');
    } else {
      bad('list', `got ${listA.status}`);
    }

    // ----------------------------------------------------------------------- [7]

    console.log('\n[7] a customer cannot set the status the pipeline owns');

    const before = await RealEstateLead.findById(leadId).lean();
    const escalate = await call('PATCH', `/leads/${leadId}/withdraw`, {
      auth: customerA,
      body: { status: 'SALE', reason: 'let me skip the pipeline' },
    });
    if (escalate.status >= 400) ok('`status: SALE` is rejected by validation');
    else bad('status escalation', `got ${escalate.status}`);

    const after = await RealEstateLead.findById(leadId).lean();
    if (after.status === before.status) ok(`lead is still ${after.status}`);
    else bad('status changed', `${before.status} -> ${after.status}`);

    // ----------------------------------------------------------------------- [8]

    console.log('\n[8] withdrawal records LOST with a customer-attributed audit row');

    const withdrawn = await call('PATCH', `/leads/${leadId}/withdraw`, {
      auth: customerA,
      body: { status: 'LOST', reason: 'Found elsewhere' },
    });

    if (withdrawn.status === 200 && withdrawn.body.data.status === 'LOST') {
      ok('withdrawal recorded as LOST');
    } else {
      bad('withdraw', `got ${withdrawn.status} ${JSON.stringify(withdrawn.error && withdrawn.error.message)}`);
    }

    const lostRows = await RealEstateLeadActivity.find({ lead: leadId, action: 'LOST' }).lean();
    if (lostRows.length === 1) ok('exactly one LOST activity row (BR-20)');
    else bad('LOST activity', `${lostRows.length} rows, expected 1`);

    if (lostRows.length === 1) {
      if (lostRows[0].actorType === 'CUSTOMER') ok('the row attributes the CUSTOMER, not an admin');
      else bad('actorType', `got ${lostRows[0].actorType}`);

      if (String(lostRows[0].actor) === String(customerA.id)) ok('the row names the customer who withdrew');
      else bad('activity actor', 'mismatch');

      if (lostRows[0].fromStatus && lostRows[0].fromStatus !== 'LOST') {
        ok(`the row preserves fromStatus = ${lostRows[0].fromStatus}`);
      } else {
        bad('fromStatus', `got ${lostRows[0].fromStatus} — the trail must record the status it left`);
      }

      // A transition that records from == to records nothing. `recordActivity` re-reads the
      // lead, so the caller must record before saving the new status and pass the target.
      if (lostRows[0].toStatus === 'LOST') ok('the row records toStatus = LOST');
      else bad('toStatus', `got ${lostRows[0].toStatus}, expected LOST`);

      if (lostRows[0].fromStatus !== lostRows[0].toStatus) {
        ok(`the row is a real transition: ${lostRows[0].fromStatus} -> ${lostRows[0].toStatus}`);
      } else {
        bad(
          'transition trail',
          `fromStatus and toStatus are both ${lostRows[0].fromStatus} — this is a snapshot, not a transition`
        );
      }
    }

    // The customer activity feed must not leak staff notes.
    const feed = await call('GET', `/leads/${leadId}/activity`, { auth: customerA });
    if (feed.status === 200 && Array.isArray(feed.body.data)) {
      const onlyActionAndTime = feed.body.data.every(
        (a) => Object.keys(a).every((k) => k === 'action' || k === 'at')
      );
      if (onlyActionAndTime) ok(`customer feed is ${feed.body.data.length} rows, action + time only`);
      else bad('feed leak', 'the customer feed carries more than action and timestamp');
    } else {
      bad('activity feed', `got ${feed.status}`);
    }

    // ----------------------------------------------------------------------- [9]

    console.log('\n[10] every validate() target has the {params|query|body} shape');

/**
 * `src/middlewares/validate.js` does `pick(schema, ['params','query','body'])` and calls
 * `next()` immediately when nothing matched — so a validation module exporting a *bare*
 * Joi schema validates nothing at all, silently, while still looking wired in.
 *
 * That is not hypothetical: the first version of this file exported bare schemas, and
 * `PATCH /leads/:id/withdraw` accepted `status: 'SALE'` — a customer marking their own lead
 * as a completed sale, the transition that carries a commission. Check [7] now covers the
 * behaviour; this check covers the cause, so it applies to the other Real Estate
 * validation modules too.
 */
const pick = require(path.join(API, 'src/utils/pick'));

const validationFiles = fs
  .readdirSync(path.join(API, 'src/modules/realestate/validations'))
  .filter((f) => f.endsWith('.js'));

const routeFiles = fs
  .readdirSync(path.join(API, 'src/modules/realestate/routes'))
  .filter((f) => f.endsWith('.js'));

for (const rf of routeFiles) {
  const src = fs.readFileSync(path.join(API, 'src/modules/realestate/routes', rf), 'utf8');

  // Every `validate(V.<name>)` reference in the file.
  for (const m of src.matchAll(/validate\(\s*V\.([A-Za-z0-9_]+)\s*\)/g)) {
    const name = m[1];

    // Resolve the module the route requires, then the export by that name.
    const modMatch = src.match(/require\('\.\.\/validations\/([a-z.]+)'\)/);
    if (!modMatch) continue;

    const validation = require(path.join(
      API,
      'src/modules/realestate/validations',
      modMatch[1]
    ));
    const schema = validation[name];

    if (!schema) {
      bad(`${rf}: validate(V.${name})`, `no such export in ${modMatch[1]}`);
      continue;
    }

    const picked = pick(schema, ['params', 'query', 'body']);
    if (Object.keys(picked).length === 0) {
      bad(
        `${rf}: validate(V.${name})`,
        'the export has none of params/query/body, so validate() skips it silently'
      );
    } else {
      ok(`${rf}: V.${name} validates ${Object.keys(picked).join(' + ')}`);
    }
  }
}

if (!validationFiles.length) ok('no validation modules found (unexpected)');

console.log('\n[11] no customer id anywhere in the route surface');

    const withCustomerId = mounted.filter((r) => /:customer|customerId/.test(r));
    if (withCustomerId.length === 0) ok('no :customerId in any path (doc §7.1)');
    else bad('customer id in a path', withCustomerId.join(', '));

    const bodyAllowsCustomer = JSON.stringify(
      require(path.join(API, 'src/modules/realestate/validations/realestate.customer.validation'))
    );
    if (!/"customer"\s*:/.test(bodyAllowsCustomer.replace(/\/\*[\s\S]*?\*\//g, ''))) {
      ok('no validation schema accepts a customer field — the tenant is the token');
    } else {
      bad('customer in body', 'a schema accepts a client-supplied customer id');
    }
  } finally {
    console.log('\n[cleanup]');
    const ids = created.length ? created : [];
    await RealEstateLeadActivity.deleteMany({ lead: { $in: ids } }).catch(() => {});
    await RealEstateLead.deleteMany({
      customer: { $in: [oid(), customerA.id, customerB.id] },
    }).catch(() => {});
    await RealEstateProperty.deleteMany({ _id: { $in: [published._id, draft._id] } }).catch(() => {});
    if (category.key === 'CUSTPROBE') {
      await RealEstatePropertyCategory.deleteMany({ _id: category._id }).catch(() => {});
    }
    if (probeUsers.length) await User.deleteMany({ _id: { $in: probeUsers } }).catch(() => {});

    const left =
      (await RealEstateLead.countDocuments({ customer: { $in: [customerA.id, customerB.id] } })) +
      (await RealEstateProperty.countDocuments({ _id: { $in: [published._id, draft._id] } }));

    if (left === 0) ok('probe leads, activities, properties and users removed');
    else bad('cleanup', `${left} document(s) left behind`);

    await mongoose.disconnect().catch(() => {});
  }

  console.log('');
  if (failed > 0) {
    console.log(`${failed} of ${passed + failed} check(s) FAILED`);
    process.exit(1);
  }
  console.log(`ALL ${passed} CUSTOMER CHECKS PASSED`);
})();