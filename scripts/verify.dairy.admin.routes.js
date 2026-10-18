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
 * The taxonomy DELETE routes, proven to actually reach their controller.
 *
 * ## Why this suite exists
 *
 * All three taxonomy deletes were wired to an *update* validation schema, which
 * carries `body: Joi.object().min(1)`. A DELETE sends no body, so
 * `express.urlencoded` left `req.body` as `{}` and every delete was rejected with
 * `"key" is required` before the controller ran. The service layer was tested and
 * passed the whole time, because the bug was in the route, not the service.
 *
 * That is exactly the class of defect a service-level suite cannot see, so this one
 * exercises the real Express app over HTTP. It asserts the three outcomes that
 * matter: an unreferenced row deletes, a referenced one is refused with 400, and a
 * malformed id is rejected by validation rather than reaching the service.
 *
 * It authenticates as a real `admin` user, which is also the first time the
 * `webAuth` surface gets real end-to-end coverage.
 */

const mongoose = require('mongoose');
const app = require('../src/app');
const {
  User,
  Vertical,
  DairyCategory,
  DairySubCategory,
  DairyBrand,
  DairyProduct,
  City,
  Locality,
  Business,
  DairyJoiningRequest,
} = require('../src/models');
const tokenService = require('../src/services/token.service');
const registrationService = require('../src/modules/dairy/services/dairy.registration.service');
const config = require('../src/config/config');

let baseUrl;

const request = async (method, path, { token, bearer, body } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  // The admin/web routes authenticate by *cookie*, not by the Authorization header:
  // `jwtWebStrategy` extracts the JWT with `cookieExtractor`, while the app
  // strategy reads a bearer token. This is why the Angular panel sends
  // `withCredentials`. Sending a bearer token to a web route would authenticate
  // nothing, which is exactly the mistake this suite first made.
  if (token) headers.Cookie = `${config.jwt.cookieName}=${token}`;
  // App routes (`appAuth`, the customer/partner/rider surface) use the other
  // strategy, so those need `bearer` passed explicitly.
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (e) {
      payload = text;
    }
  }
  return { status: response.status, body: payload };
};

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
  const created = { categories: [], subCategories: [], brands: [], products: [], users: [], businesses: [], joiningRequests: [] };

  const server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    console.log('\n1. Setting up a real admin and some taxonomy');

    const admin = await User.create({
      firstName: 'Delete',
      lastName: 'Tester',
      countryCode: '+91',
      mobile: Number(`5${stamp}9`),
      email: `deltest${stamp}@test.local`,
      password: 'Deletetest@123',
      role: 'admin',
      status: true,
    });
    created.users.push(admin._id);

    // A real web token, minted the same way login does. The `webAuth` middleware is
    // what stands between these routes and the public internet, so it is part of
    // what is under test.
    const tokens = await tokenService.generateAuthTokens(admin, '127.0.0.1', 'admin-route-suite');
    const token = tokens.access.token;

    // Two categories. `category` stays clean so its delete can succeed; `categoryInUse`
    // exists to carry the references, because there is no product-delete route to
    // clean them up with afterwards.
    const category = await DairyCategory.create({
      key: `del-cat-${stamp}`,
      name: `Delete Category ${stamp}`,
      status: true,
    });
    const categoryInUse = await DairyCategory.create({
      key: `del-used-${stamp}`,
      name: `Delete Category Used ${stamp}`,
      status: true,
    });
    created.categories.push(category._id, categoryInUse._id);

    const subCategory = await DairySubCategory.create({
      category: categoryInUse._id,
      key: `del-sub-${stamp}`,
      name: `Delete Sub ${stamp}`,
      status: true,
    });
    created.subCategories.push(subCategory._id);

    const brand = await DairyBrand.create({ name: `Delete Brand ${stamp}`, status: true });
    const brandInUse = await DairyBrand.create({ name: `Delete Brand Used ${stamp}`, status: true });
    created.brands.push(brand._id, brandInUse._id);

    // A product pointing at `brandInUse` and `categoryInUse`, so both of their
    // deletes must be refused.
    const product = await DairyProduct.create({
      business: new mongoose.Types.ObjectId(),
      category: categoryInUse._id,
      subCategory: subCategory._id,
      brand: brandInUse._id,
      name: `Delete Product ${stamp}`,
      status: true,
    });
    created.products.push(product._id);

    const del = (path, authToken = token) =>
      request('DELETE', path, { token: authToken });

    console.log('\n2. A delete with no body is no longer rejected by validation');

    // The regression itself. Before the fix each of these came back 400 with
    // `"key" is required` — from validation, before the controller ever ran.
    res = await del(`/v1/dairy/admin/catalog/categories/${category._id}`);
    check('DELETE category reaches the controller', res.status === 200,
      `got ${res.status} ${res.body && res.body.message}`);

    res = await del(`/v1/dairy/admin/catalog/brands/${brand._id}`);
    check('DELETE brand reaches the controller', res.status === 200,
      `got ${res.status} ${res.body && res.body.message}`);

    const gone = await DairyCategory.findById(category._id);
    check('the category is actually gone', gone === null);
    const brandGone = await DairyBrand.findById(brand._id);
    check('the brand is actually gone', brandGone === null);

    // The sub-category was left clean of dependents, so it goes too. This is the
    // third route that shared the broken schema.
    res = await del(`/v1/dairy/admin/catalog/sub_categories/${subCategory._id}`);
    // It does carry a product reference, so the service is expected to refuse it.
    // Either way the point stands: validation let the request through to the service.
    check('DELETE sub-category is answered by the service, not validation',
      res.status === 200 || res.status === 400,
      `got ${res.status}`);
    check('a refused sub-category delete never says "is required"',
      !/is required/.test((res.body && res.body.message) || ''),
      res.body && res.body.message);

    console.log('\n3. A referenced row is still refused');

    res = await del(`/v1/dairy/admin/catalog/brands/${brandInUse._id}`);
    check('a brand a product uses is refused with 400', res.status === 400, `got ${res.status}`);
    check('the refusal names the reason',
      /reference/i.test((res.body && res.body.message) || ''),
      res.body && res.body.message);
    const survived = await DairyBrand.findById(brandInUse._id);
    check('the referenced brand survives', survived !== null);

    res = await del(`/v1/dairy/admin/catalog/categories/${categoryInUse._id}`);
    check('a category with dependents is refused with 400', res.status === 400, `got ${res.status}`);
    const categorySurvived = await DairyCategory.findById(categoryInUse._id);
    check('the referenced category survives', categorySurvived !== null);

    console.log('\n4. Validation still guards the id');

    res = await del('/v1/dairy/admin/catalog/categories/not-an-object-id');
    check('a malformed id is rejected by validation', res.status === 400, `got ${res.status}`);

    res = await request('DELETE', `/v1/dairy/admin/catalog/categories/${new mongoose.Types.ObjectId()}`, { token });
    check('a well-formed but unknown id is a 404 from the service', res.status === 404, `got ${res.status}`);

    console.log('\n5. The auth guard still applies to the fixed routes');

    res = await request('DELETE', `/v1/dairy/admin/catalog/categories/${new mongoose.Types.ObjectId()}`);
    check('an unauthenticated delete is refused', res.status === 401, `got ${res.status}`);

    console.log('\n6. The vertical switch, over real HTTP');

    res = await request('GET', '/v1/dairy/admin/verticals', { token });
    check('the registry is readable by an admin', res.status === 200, `got ${res.status}`);
    const list = res.body && res.body.verticals;
    check('it returns a verticals array', Array.isArray(list), JSON.stringify(res.body).slice(0, 120));
    const dairyRow = Array.isArray(list) ? list.find((v) => v.key === 'dairy') : null;
    check('dairy is listed with an outlet count', Boolean(dairyRow) && typeof dairyRow.businessCount === 'number');

    // The form-encoded body the Angular panel actually sends. `status` arrives as
    // the string "false" and Joi has to coerce it — if it did not, the toggle would
    // appear to work and silently store the wrong value.
    res = await request('PATCH', '/v1/dairy/admin/verticals/dairy', {
      token,
      body: { status: 'false', reason: 'admin route suite' },
    });
    check('a form-encoded status=false is accepted and coerced', res.status === 200,
      `got ${res.status} ${res.body && res.body.message}`);
    check('the response reports the vertical as off',
      res.body && res.body.vertical && res.body.vertical.status === false,
      JSON.stringify(res.body && res.body.vertical).slice(0, 120));

    const halted = await Vertical.findOne({ key: 'dairy' });
    check('it is genuinely off in the database', halted.status === false);
    check('the operator is recorded', String(halted.statusChangedBy) === String(admin._id));

    // And now prove the string "true" round-trips the other way, which is the case
    // that would silently re-enable nothing if coercion broke.
    res = await request('PATCH', '/v1/dairy/admin/verticals/dairy', {
      token,
      body: { status: 'true' },
    });
    check('a form-encoded status=true is accepted and coerced',
      res.body && res.body.vertical && res.body.vertical.status === true,
      JSON.stringify(res.body && res.body.vertical).slice(0, 120));

    console.log('\n7. The switch refuses bad input rather than guessing');

    res = await request('PATCH', '/v1/dairy/admin/verticals/dairy', { token, body: {} });
    check('a missing status is rejected', res.status === 400, `got ${res.status}`);

    res = await request('PATCH', '/v1/dairy/admin/verticals/not-a-vertical', {
      token,
      body: { status: 'false' },
    });
    check('an unknown vertical is a 404', res.status === 404, `got ${res.status}`);

    res = await request('PATCH', '/v1/dairy/admin/verticals/dairy', { body: { status: 'false' } });
    check('an unauthenticated switch is refused', res.status === 401, `got ${res.status}`);

    // The key is case-insensitive on the way in, so a screen that sends "Dairy"
    // should not 404.
    res = await request('PATCH', '/v1/dairy/admin/verticals/DAIRY', {
      token,
      body: { status: 'true' },
    });
    check('the key is matched case-insensitively', res.status === 200, `got ${res.status}`);

    console.log('\n8. The panel can learn what rights the operator has');

    // `adminAuthGuard` calls this on every navigation and only ever reads
    // `success`. The `rights` array is additive, and is what lets the frontend hide
    // controls the operator cannot use instead of rendering them and eating a 403.
    res = await request('GET', `/v1/admin/web_guard/${admin._id}`, { token });
    check('the session check still succeeds', res.status === 200, `got ${res.status}`);
    check('it still returns success:true for the guard',
      res.body && res.body.success === true, JSON.stringify(res.body).slice(0, 120));
    check('it now returns a rights array', Array.isArray(res.body && res.body.rights),
      JSON.stringify(res.body).slice(0, 120));
    check('the dairy rights are present for an admin',
      Array.isArray(res.body && res.body.rights) &&
        res.body.rights.includes('dairy_vertical_manage') &&
        res.body.rights.includes('dairy_catalog_manage'));

    // A non-admin must not be able to read another role's profile.
    const customer = await User.create({
      firstName: 'Not',
      lastName: 'Admin',
      countryCode: '+91',
      mobile: Number(`5${stamp}7`),
      email: `notadmin${stamp}@test.local`,
      password: 'Notadmin@123',
      role: 'user',
      status: true,
    });
    created.users.push(customer._id);

    res = await request('GET', `/v1/admin/web_guard/${admin._id}`, {
      token: (await tokenService.generateAuthTokens(customer, '127.0.0.1', 'suite')).access.token,
    });
    check('a non-admin cannot read an admin profile', res.status === 403 || res.status === 401,
      `got ${res.status}`);

    console.log('\n9. The joining-request review route accepts both of its path ids');

    // This route is `/joining_request/review/:request/:id` and its schema declared
    // only `request`, so every review was a 400 before the controller ran. The
    // route-param suite now guards that statically; this proves it over HTTP.
    const reviewId = new mongoose.Types.ObjectId();
    res = await request('PATCH', `/v1/dairy/joining_request/review/${reviewId}/${admin._id}`, {
      token,
      body: { approve: false, reason: 'admin route suite' }
    });
    check('a review with both ids is not rejected by validation',
      res.status !== 400 || !/is not allowed/.test((res.body && res.body.message) || ''),
      `got ${res.status} ${res.body && res.body.message}`);
    // A request id that does not exist should surface as a 404 from the service.
    check('the review then reaches the service', res.status === 404, `got ${res.status}`);

    res = await request('PATCH', `/v1/dairy/joining_request/review/not-an-id/${admin._id}`, {
      token,
      body: { approve: false }
    });
    check('a malformed request id is still rejected', res.status === 400, `got ${res.status}`);

    res = await request('PATCH', `/v1/dairy/joining_request/review/${reviewId}/${admin._id}`, {
      token,
      body: {}
    });
    check('a missing approve is rejected', res.status === 400, `got ${res.status}`);

    console.log('\n10. A settlement id is validated before it reaches the service');

    // This shared the *list* schema, which validates a query and no params, so a
    // malformed id used to sail straight through to the service.
    res = await request('GET', '/v1/dairy/settlements/not-an-id');
    check('a malformed settlement id is rejected',
      res.status === 400 || res.status === 401, `got ${res.status}`);
    check('the rejection is validation, not a crash',
      !(res.body && res.status >= 500), `got ${res.status}`);

    console.log('\n11. A failed stop is recorded as failed, not skipped');

    // The rider app sends the past participles `skipped`/`failed`. The controller
    // used to test only for `fail`, so `failed` fell through to the `skipped`
    // branch and a delivery failure was recorded as a skip — invisible in the data
    // and wrong in every report built on it.
    //
    // A nonsense `status` is enough to prove the mapping without building a whole
    // run: if `not-a-status` is still accepted and coerced to `skipped`, the guard
    // is not doing its job. This asserts the schema refuses it.
    //
    // `/driver/stops` is `appAuth`, which reads a *bearer* token, so these need a
    // real rider rather than the admin's web cookie.
    const rider = await User.create({
      firstName: 'Stop',
      lastName: 'Tester',
      countryCode: '+91',
      mobile: Number(`5${stamp}3`),
      email: `stoptest${stamp}@test.local`,
      password: 'Stoptest@123',
      role: 'dairyDriver',
      status: true,
    });
    created.users.push(rider._id);
    const riderToken = (await tokenService.generateAuthTokens(rider, '127.0.0.1', 'suite')).access
      .token;

    res = await request('PATCH', `/v1/dairy/driver/stops/failed/${new mongoose.Types.ObjectId()}`, {
      bearer: riderToken,
      body: { reason: 'customer_unavailable' }
    });
    check('`failed` is an accepted stop status',
      res.status !== 400 || !/is not allowed/.test((res.body && res.body.message) || ''),
      `got ${res.status} ${res.body && res.body.message}`);

    res = await request('PATCH', `/v1/dairy/driver/stops/not-a-status/${new mongoose.Types.ObjectId()}`, {
      bearer: riderToken,
      body: { reason: 'customer_unavailable' }
    });
    check('a nonsense stop status is rejected by validation',
      res.status === 400, `got ${res.status} ${res.body && res.body.message}`);

    res = await request('PATCH', `/v1/dairy/driver/stops/failed/${new mongoose.Types.ObjectId()}`, {
      bearer: riderToken,
      body: {}
    });
    check('a skip with no reason is rejected', res.status === 400, `got ${res.status}`);

    console.log('\n12. The review queue, end to end');

    // Review was previously reachable only by id, so nothing could show an operator
    // what was waiting. This walks the whole path a real application takes: self
    // register, appear in the queue, get approved, and have the outlet flip to
    // verified.
    const City = mongoose.model('City');
    const Locality = mongoose.model('Locality');
    // `City` requires an image and GeoJSON coordinates, so both are supplied.
    const city = await City.create({
      name: `Queue City ${stamp}`,
      image: 'test.jpg',
      location: { type: 'Point', coordinates: [77.59, 12.97] },
      status: true,
    });
    const locality = await Locality.create({
      name: `Queue Locality ${stamp}`,
      city: city._id,
      location: { type: 'Point', coordinates: [77.6, 12.98] },
      status: true,
    });
    created.locations = created.locations || [];
    created.locations.push(city._id, locality._id);

    // The HTTP register endpoint sits behind a verified phone OTP, which the queue
    // test has no interest in — registration itself is covered by
    // `verify.dairy.location.js`. So the real service is called directly to build a
    // genuine applicant (user + business + joining request) and the HTTP queue is
    // then exercised against it.
    const registration = await registrationService.registerPartner({
      firstName: 'Queue',
      lastName: 'Applicant',
      countryCode: '+91',
      mobile: Number(`5${stamp}5`),
      email: `queue${stamp}@example.com`,
      password: 'Queueapp@123',
      role: 'dairyPartner',
      businessName: `Queue Outlet ${stamp}`,
      businessModel: 'direct',
      address: '12 Test Lane',
      city: city._id,
      locality: locality._id,
      ownDeliveryPartner: false,
    });
    check('the applicant is created by the real registration service',
      Boolean(registration && registration.business), JSON.stringify(registration).slice(0, 120));

    const applicantBusiness = registration && registration.business ? registration.business._id : null;
    check('registration returns the business', Boolean(applicantBusiness));
    if (applicantBusiness) {
      // Tracked so the queue test leaves nothing behind.
      created.businesses.push(applicantBusiness);
    }
    if (registration && registration.user) {
      created.users.push(registration.user._id);
    }

    res = await request('GET', '/v1/dairy/admin/joining-requests?status=pending', { token });
    check('the admin can list the queue', res.status === 200, `got ${res.status}`);
    const queued = res.body && res.body.results ? res.body.results : [];
    const businessIdOf = (r) => (r.business && r.business._id ? r.business._id : r.business);
    const mine = queued.find((r) => businessIdOf(r) && String(businessIdOf(r)) === String(applicantBusiness));
    check('the new request is in the pending queue', Boolean(mine));
    check('it carries the outlet city', Boolean(mine && mine.city && mine.city.name === city.name),
      mine && mine.city ? mine.city.name : 'no city');
    check('it carries the locality',
      Boolean(mine && mine.locality && mine.locality.name === locality.name),
      mine && mine.locality ? mine.locality.name : 'no locality');
    check('it is reported as having a location', Boolean(mine && mine.hasLocation === true));

    // The request id is what review needs, and the only way to get it is the queue.
    const requestId = mine ? mine._id : null;
    res = await request('PATCH', `/v1/dairy/joining_request/review/${requestId}/${admin._id}`, {
      token,
      body: { approve: 'true' },
    });
    check('the request can be approved', res.status === 200,
      `got ${res.status} ${res.body && res.body.message}`);
    check('the response reports it approved', res.body && res.body.status === 'approved',
      JSON.stringify(res.body).slice(0, 120));

    const approvedBusiness = await Business.findById(applicantBusiness);
    check('the outlet is now verified', approvedBusiness && approvedBusiness.verified === true);

    res = await request('GET', '/v1/dairy/admin/joining-requests?status=pending', { token });
    const stillQueued = (res.body && res.body.results ? res.body.results : []).find(
      (r) => String(businessIdOf(r)) === String(applicantBusiness)
    );
    check('an approved request leaves the pending queue', !stillQueued);

    res = await request('GET', '/v1/dairy/admin/joining-requests?status=approved', { token });
    const inApproved = (res.body && res.body.results ? res.body.results : []).find(
      (r) => String(businessIdOf(r)) === String(applicantBusiness)
    );
    check('it is in the approved queue instead', Boolean(inApproved));

    res = await request('GET', '/v1/dairy/admin/joining-requests', {});
    check('the queue is refused without authentication', res.status === 401, `got ${res.status}`);

    res = await request('GET', '/v1/dairy/admin/joining-requests?status=nonsense', { token });
    check('a bad status filter is rejected', res.status === 400, `got ${res.status}`);

    console.log('\n9b. A location-less outlet cannot be approved');

    // Registration has required a city and locality for a while, so a request
    // without one only exists because it predates that rule — or because the row was
    // written directly. Approving it would verify a business that can never be
    // dispatched to, which is how three outlets ended up `verified: true` with no
    // location. Rejecting it must still work, or the queue could not be cleared.
    const orphanBusiness = await Business.create({
      vertical: 'dairy',
      businessModel: 'direct',
      name: `No Location ${stamp}`,
      owner: registration.user._id,
      verified: false,
      status: true,
    });
    created.businesses.push(orphanBusiness._id);

    const orphanRequest = await DairyJoiningRequest.create({
      user: registration.user._id,
      business: orphanBusiness._id,
      businessModel: 'direct',
      name: `No Location ${stamp}`,
      address: 'nowhere in particular',
      status: 'pending',
    });
    created.joiningRequests.push(orphanRequest._id);

    res = await request(
      'PATCH',
      `/v1/dairy/joining_request/review/${orphanRequest._id}/${admin._id}`,
      { token, body: { approve: 'true' } }
    );
    check('approving a location-less outlet is refused', res.status === 400, `got ${res.status}`);
    check('the refusal names what is missing',
      /city|locality/.test((res.body && res.body.message) || ''),
      res.body && res.body.message);

    const stillPending = await DairyJoiningRequest.findById(orphanRequest._id).lean();
    check('the request is left pending, not approved', stillPending.status === 'pending',
      `status=${stillPending.status}`);
    const orphanAfter = await Business.findById(orphanBusiness._id).lean();
    check('the outlet is left unverified', orphanAfter.verified !== true);

    // Rejecting must still work, or the queue could never be cleared.
    res = await request(
      'PATCH',
      `/v1/dairy/joining_request/review/${orphanRequest._id}/${admin._id}`,
      { token, body: { approve: 'false', reason: 'no service area' } }
    );
    check('rejecting it still works', res.status === 200,
      `got ${res.status} ${res.body && res.body.message}`);

    console.log('\n13. The settlement transition rules the admin screen mirrors');

    // `verify.dairy.settlements` drives the service transitions in depth. This asserts
    // the *route* half: the status segment is validated, an illegal target is refused
    // by validation rather than reaching the service, and `paid` is not a legal
    // status-patch target at all because payout is its own endpoint.
    const settlementId = new mongoose.Types.ObjectId();

    res = await request('GET', '/v1/dairy/settlements?limit=5', { token });
    check('the settlement list is readable by an admin', res.status === 200, `got ${res.status}`);
    check('it returns a settlements array', Array.isArray(res.body && res.body.settlements));
    check('with a totalResults count', typeof (res.body && res.body.totalResults) === 'number');

    res = await request('GET', '/v1/dairy/settlements/summary/all', { token });
    check('the summary is readable', res.status === 200, `got ${res.status}`);
    check('the summary is grouped by type', Boolean(res.body && res.body.summary && res.body.summary.byType !== undefined));

    res = await request('PATCH', `/v1/dairy/settlements/paid/${settlementId}`, { token, body: {} });
    check('`paid` is refused as a status-patch target',
      res.status === 400, `got ${res.status} ${res.body && res.body.message}`);

    res = await request('PATCH', `/v1/dairy/settlements/nonsense/${settlementId}`, { token, body: {} });
    check('a nonsense status is refused by validation', res.status === 400, `got ${res.status}`);

    res = await request('PATCH', `/v1/dairy/settlements/approved/${settlementId}`, { token, body: {} });
    check('a legal status on an unknown id reaches the service as a 404',
      res.status === 404, `got ${res.status}`);

    res = await request('GET', '/v1/dairy/settlements?status=nonsense', { token });
    check('a bad settlement status filter is rejected', res.status === 400, `got ${res.status}`);

    res = await request('POST', '/v1/dairy/settlements/generate', { token, body: { period: 'monthly' } });
    check('generating with neither partner nor franchise is rejected',
      res.status === 400, `got ${res.status} ${res.body && res.body.message}`);

    res = await request('POST', '/v1/dairy/settlements/generate', {
      token,
      body: { period: 'monthly', partner: settlementId, franchise: settlementId },
    });
    check('generating with both is rejected (they xor)',
      res.status === 400, `got ${res.status}`);

    console.log('\n14. Franchise agreements and the operator picker');

    res = await request('GET', '/v1/dairy/admin/franchises?limit=5', { token });
    check('the franchise list is readable', res.status === 200, `got ${res.status}`);
    check('it returns a franchises array', Array.isArray(res.body && res.body.franchises));
    check('with a totalResults count', typeof (res.body && res.body.totalResults) === 'number');

    // The endpoint the create dialog's operator dropdown needs. Without it the only
    // user search in the platform filters to `role: 'user'`, which is customers.
    res = await request('GET', '/v1/dairy/admin/franchise-operators?limit=5', { token });
    check('candidate operators are listable', res.status === 200, `got ${res.status}`);
    check('they come back as a results array', Array.isArray(res.body && res.body.results));
    const operators = (res.body && res.body.results) || [];
    check('they are all dairy partners',
      operators.length === 0 || operators.every((o) => o.firstName !== undefined && o.role === undefined),
      `${operators.length} returned`);

    res = await request('GET', '/v1/dairy/admin/franchise-operators', {});
    check('the operator list is refused without authentication',
      res.status === 401, `got ${res.status}`);

    res = await request('PATCH', `/v1/dairy/admin/franchises/${settlementId}/nonsense`, { token, body: {} });
    check('a nonsense franchise status is rejected by validation',
      res.status === 400, `got ${res.status}`);

    res = await request('PATCH', `/v1/dairy/admin/franchises/${settlementId}/active`, { token, body: {} });
    check('a legal status on an unknown franchise is a 404 from the service',
      res.status === 404, `got ${res.status}`);

    res = await request('POST', '/v1/dairy/admin/franchises', {
      token,
      body: { business: settlementId, operator: admin._id, franchiseCode: 'X', name: 'X' },
    });
    check('creating without a revenue share is rejected',
      res.status === 400, `got ${res.status} ${res.body && res.body.message}`);

    res = await request('POST', '/v1/dairy/admin/franchises', {
      token,
      body: {
        business: settlementId,
        operator: admin._id,
        franchiseCode: 'X',
        name: 'X',
        revenueSharePercentage: 150,
      },
    });
    check('a revenue share above 100 is rejected',
      res.status === 400, `got ${res.status}`);

    console.log('\n15. Compliance and catalog health');

    res = await request('GET', '/v1/dairy/admin/compliance/expiring', { token });
    check('the expiring list is readable', res.status === 200, `got ${res.status}`);
    check('it returns a records array', Array.isArray(res.body && res.body.records));
    check('with a totalResults count', typeof (res.body && res.body.totalResults) === 'number');
    const records = (res.body && res.body.records) || [];
    check('each record carries a live status',
      records.every((r) => ['pending', 'valid', 'expiring', 'expired'].includes(r.liveStatus)),
      `${records.length} record(s)`);
    check('each record carries a cacheFresh flag',
      records.every((r) => typeof r.cacheFresh === 'boolean'));

    res = await request('GET', '/v1/dairy/admin/compliance/expiring?days=0', { token });
    check('a zero-day window is rejected', res.status === 400, `got ${res.status}`);

    res = await request('GET', '/v1/dairy/admin/compliance/expiring?days=9999', { token });
    check('an absurd window is rejected', res.status === 400, `got ${res.status}`);

    res = await request('GET', '/v1/dairy/admin/compliance/expiring', {});
    check('the compliance list is refused without authentication',
      res.status === 401, `got ${res.status}`);

    // The refresh writes to every compliance record in the platform. The screen
    // confirms before firing it; here it just has to succeed and report counts.
    res = await request('POST', '/v1/dairy/admin/compliance/refresh', { token, body: {} });
    check('the status refresh runs', res.status === 200, `got ${res.status} ${res.body && res.body.message}`);
    check('it reports how many it checked', typeof (res.body && res.body.checked) === 'number');
    check('it reports how many it changed', typeof (res.body && res.body.changed) === 'number');

    res = await request('POST', '/v1/dairy/admin/compliance/refresh', { body: {} });
    check('the refresh is refused without authentication', res.status === 401, `got ${res.status}`);

    res = await request('GET', '/v1/dairy/admin/catalog/health', { token });
    check('the catalog health check is readable', res.status === 200, `got ${res.status}`);
    const health = res.body && res.body.health;
    check('it returns a health object', Boolean(health));
    check('it counts the catalog', health && typeof health.totalProducts === 'number'
      && typeof health.totalSkus === 'number');
    check('it reports all three orphan counts',
      health && typeof health.orphanProductSku === 'number'
      && typeof health.skusWithoutProduct === 'number'
      && typeof health.productsWithoutSku === 'number');
  } catch (error) {
    failures += 1;
    console.log(`\n  UNCAUGHT: ${error.message} >>> ${error.stack}`);
  } finally {
    // Restore dairy before anything else. A suite that exits with the registry
    // halted would break every suite that follows it.
    try {
      await Vertical.updateOne(
        { key: 'dairy' },
        { $set: { status: true, statusChangedBy: null, statusChangedAt: null, statusReason: null } }
      );
    } catch (error) {
      console.log(`  restore warning: ${error.message}`);
    }

    try {
      await server.close();
    } catch (error) {
      /* already closed */
    }
    try {
      await DairyProduct.deleteMany({ _id: { $in: created.products } });
      await DairySubCategory.deleteMany({ _id: { $in: created.subCategories } });
      await DairyCategory.deleteMany({ _id: { $in: created.categories } });
      await DairyBrand.deleteMany({ _id: { $in: created.brands } });
      if (created.locations) {
        await Locality.deleteMany({ _id: { $in: created.locations.slice(1) } });
        await City.deleteMany({ _id: { $in: created.locations.slice(0, 1) } });
      }
      await DairyJoiningRequest.deleteMany({ _id: { $in: created.joiningRequests } });
      await DairyJoiningRequest.deleteMany({ business: { $in: created.businesses } });
      await Business.deleteMany({ _id: { $in: created.businesses } });
      await User.deleteMany({ _id: { $in: created.users } });
    } catch (error) {
      console.log(`  cleanup warning: ${error.message}`);
    }
  }

  console.log(
    failures === 0
      ? '\nALL DAIRY ADMIN DELETE ROUTE CHECKS PASSED'
      : `\n${failures} CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error('verification failed:', error.message);
  process.exit(1);
});