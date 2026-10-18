/**
 * @file Proves, over real HTTP, that guarded stores routes reach THEIR OWN handler.
 *
 * @description
 * The stores surface carried ELEVEN endpoints that existed, were documented, were guarded,
 * and were completely unreachable. Every one of them was a literal path declared AFTER a
 * sibling route whose path had a parameter in that position, so Express — which resolves
 * to the FIRST matching route — handed the request to the wrong handler:
 *
 *     GET /v1/stores/delivery           -> getStoreProfile('delivery')    -> CastError 500
 *     GET /v1/stores/subscription       -> getStoreProfile('subscription')
 *     GET /v1/stores/settlement         -> getStoreProfile('settlement')
 *     GET /v1/stores/remittances        -> getStoreProfile('remittances')
 *     GET /v1/stores/warranty           -> getStoreProfile('warranty')
 *     GET /v1/stores/catalog/products   -> browseProducts('catalog', ...)
 *     GET /v1/stores/subscriptions      -> getStoreProfile('subscriptions')
 *     GET /v1/stores/subscriptions/upcoming -> getSubscription('upcoming')
 *     GET /v1/stores/partner/featured/pending -> getFeatured('pending')
 *     GET /v1/stores/partner/complaints/open  -> getComplaint('open')
 *     GET /v1/stores/partner/warranty/expiring -> getWarrantyRequest('expiring')
 *     POST /v1/stores/deliveries/:d/deliver -> transitionDelivery('deliver')  <- BR-29 OTP
 *     POST /v1/stores/deliveries/:d/fail    -> transitionDelivery('fail')
 *
 * The two driver routes are the worst of them: the OTP handover and the failure path both
 * resolved to the generic status transition, so delivery could complete WITHOUT the
 * customer's OTP ever being verified. BR-29 was unenforced over HTTP while passing every
 * test written against the service.
 *
 * WHY UNIT TESTS MISSED ALL OF THIS. Every stores suite except the HTTP one calls the
 * service layer directly. A handler that cannot be routed to is still a perfectly good
 * function, so it passes every assertion ever written about it. Reachability is a property
 * of the ASSEMBLED router, and nothing assembled it.
 *
 * WHY THIS IS SEPARATE FROM `verify.stores.api.contract.js`. That suite detects shadowing
 * by walking `router.stack` and re-implementing path-to-regexp's matching rules in JS. That
 * is a model of what Express does, and a model can be wrong. This suite sends real requests
 * through real Express, so it is the ground truth. The two failing for different reasons is
 * the point: a bug in the model shows up as a disagreement.
 *
 * WHY 401 IS THE PASS. Each probe targets a route guarded by `appAuth(...)`. Sending no
 * token makes the CORRECT outcome `401` — the route matched, then authentication refused.
 * A shadowed route instead lands on the storefront, which has no auth guard at all and
 * calls `findById(<segment>)`, yielding `500` and a `Cast to ObjectId failed` body. So the
 * status code alone distinguishes "right handler, refused" from "wrong handler, crashed",
 * which is why this suite needs no database, no fixtures and no tokens.
 *
 * If a probe ever needs to assert something stronger than "the right route was selected",
 * this suite is the wrong tool — build real fixtures instead.
 */
const express = require('express');
const storesRouter = require('../src/modules/stores/routes/stores.route');
const { errorConverter, errorHandler } = require('../src/middlewares/error');
const { jwtWebStrategy, jwtAppStrategy } = require('../src/config/passport');
const passport = require('passport');

passport.use('jwt-app', jwtAppStrategy).use('jwt-admin', jwtWebStrategy);

const app = express();
app.use(express.json());
app.use('/v1/stores', storesRouter);
app.use(errorConverter);
app.use(errorHandler);

const probes = [
  // Bare partner GETs, all previously captured by the storefront's `/:store`.
  ['GET', '/v1/stores/delivery'],
  ['GET', '/v1/stores/subscription'],
  ['GET', '/v1/stores/settlement'],
  ['GET', '/v1/stores/remittances'],
  ['GET', '/v1/stores/warranty'],
  ['GET', '/v1/stores/catalog/products'],
  // Customer subscriptions: both GETs were captured by `/:store` and, for `upcoming`,
  // additionally by `/subscriptions/:subscription`.
  ['GET', '/v1/stores/subscriptions'],
  ['GET', '/v1/stores/subscriptions/upcoming'],
  // Literal-after-param inside the partner file itself.
  ['GET', '/v1/stores/partner/featured/pending'],
  ['GET', '/v1/stores/partner/complaints/open'],
  ['GET', '/v1/stores/partner/warranty/expiring'],
  // BR-29: these two must NOT fall through to the generic `:status` transition.
  ['POST', '/v1/stores/deliveries/abc/deliver'],
  ['POST', '/v1/stores/deliveries/abc/fail'],
];

let failures = 0;

const run = async () => {
  console.log('\n=== every guarded stores route is reachable over real HTTP ===\n');

  const app = express();
  app.use(express.json());
  app.use('/v1/stores', storesRouter);
  app.use(errorConverter);
  app.use(errorHandler);

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  for (const [method, url] of probes) {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      // `Connection: close` keeps undici from pooling the socket. A pooled socket left
      // open makes `process.exit()` race libuv's handle teardown, which aborts the
      // process with "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" and
      // reports a non-zero exit even though every check passed.
      headers: { 'Content-Type': 'application/json', Connection: 'close' },
      body: method === 'POST' ? JSON.stringify({ otp: '000000' }) : undefined,
    });
    const text = await res.text();
    const cast = /Cast to ObjectId failed/i.test(text);
    const ok = (res.status === 401 || res.status === 403) && !cast;
    if (!ok) failures += 1;
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'}  ${method.padEnd(4)} ${url.padEnd(46)} -> ${res.status}` +
      `${cast ? '   CastError: captured by an earlier route' : ''}` +
      `${!ok && !cast ? '   body: ' + text.slice(0, 100) : ''}`
    );
  }

  await new Promise((resolve) => server.close(resolve));

  if (failures === 0) {
    console.log('\nALL STORES ROUTE REACHABILITY CHECKS PASSED');
  } else {
    console.log(`\n${failures} STORES ROUTE REACHABILITY CHECK(S) FAILED`);
  }
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error('reachability suite crashed:', error.message);
  process.exit(1);
});