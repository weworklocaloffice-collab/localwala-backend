/**
 * LocalWala - Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright c 2026 WeWorkLocal Private Limited
 * https://weworklocal.in/
 *
 * WeWorkLocal Private Limited
 *
 * This source code is confidential.
 * Unauthorized copying, redistribution, resale, publication,
 * modification, or use of this source code is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

/**
 * verify.stores.validation.wiring.js - no stores validator may be silently skipped.
 *
 * Run: node scripts/verify.stores.validation.wiring.js
 *
 * ## The bug this pins
 *
 * `validate(schema)` picks only `params`, `query` and `body` from the schema. A bare
 * `Joi.object({...})` has none of those keys, so `validate()` saw an empty picking and
 * called `next()` without validating anything. The partner return, exchange and review
 * writes - the routes that derive money - were in exactly that state.
 *
 * The suite does two things:
 *
 *   1. STATIC: every `validate(V.xxx)` call in a stores route must resolve to a schema
 *      that declares at least one of `params`, `query` or `body`.
 *   2. RUNTIME: the middleware itself rejects a bad body/query and accepts a good one,
 *      including unknown-key rejection, so a future refactor cannot restore the bypass.
 */

const fs = require('fs');
const path = require('path');

const validate = require('../src/middlewares/validate');
const V = require('../src/modules/stores/validations/stores.validation');

let failures = 0;
const ck = (label, condition, detail) => {
  if (condition) {
    console.log('  PASS  ' + label);
  } else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail !== undefined ? ' -> ' + detail : ''));
  }
};

const isWrapped = (schema) =>
  !!schema &&
  typeof schema === 'object' &&
  ['params', 'query', 'body'].some((key) => schema[key] !== undefined);

const routesDir = path.join(__dirname, '..', 'src', 'modules', 'stores', 'routes');
const routeFiles = fs
  .readdirSync(routesDir)
  .filter((file) => file.endsWith('.js') && file.startsWith('stores.'));

const used = new Map();

for (const file of routeFiles) {
  const source = fs.readFileSync(path.join(routesDir, file), 'utf8');

  // Routes may import more than one validation module (the admin catalog file uses the
  // admin schemas for taxonomy and the partner schemas for product/inventory reads).
  // Resolve every alias rather than assuming a single `V`.
  const aliases = new Map();
  for (const match of source.matchAll(
    /const ([A-Za-z0-9_]+) = require\('\.\.\/validations\/([^']+)'\)/g
  )) {
    const moduleName = match[2];
    const modulePath = path.join(routesDir, '..', 'validations', `${moduleName}.js`);
    aliases.set(match[1], { moduleName, schemas: require(modulePath) });
  }

  for (const match of source.matchAll(/validate\(([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\)/g)) {
    const [, alias, key] = match;
    const target = aliases.get(alias);
    if (!target) continue;

    const id = `${target.moduleName}:${key}`;
    if (!used.has(id)) {
      used.set(id, {
        moduleName: target.moduleName,
        key,
        schema: target.schemas[key],
        files: [],
      });
    }
    used.get(id).files.push(file);
  }
}

const run = async () => {
  console.log('\n=== every schema passed to validate() declares a target ===\n');

  ck('route files found', routeFiles.length > 0, routeFiles.length);
  ck('validate() usages found', used.size > 0, used.size);

  for (const { moduleName, key, schema, files } of used.values()) {
    ck(
      `V.${key} [${moduleName}] is wrapped (${[...new Set(files)].join(', ')})`,
      isWrapped(schema),
      schema === undefined ? 'missing export' : 'bare Joi schema - validation is bypassed'
    );
  }

  ck(
    'no bare exported schema is reachable from a route',
    [...used.values()].every(({ schema }) => isWrapped(schema)),
    [...used.values()]
      .filter(({ schema }) => !isWrapped(schema))
      .map(({ moduleName, key }) => `${moduleName}.${key}`)
      .join(', ')
  );

  console.log('\n=== the middleware actually rejects invalid input ===\n');

  const invoke = (schema, req) =>
    new Promise((resolve) => {
      validate(schema)(req, {}, (error) => resolve(error));
    });

  const check = async (label, schema, req, expectError) => {
    const error = await invoke(schema, req);
    ck(
      label,
      expectError ? Boolean(error) : !error,
      expectError ? `expected rejection, got ${error ? error.statusCode : 'success'}` : error && error.message
    );
  };

  const oid = '507f1f77bcf86cd799439011';
  const validReturn = {
    body: {
      order: oid,
      items: [
        {
          product: oid,
          variant: oid,
          name: 'Shirt',
          quantity: 1,
          unitPrice: 100,
          refundAmount: 100,
          reason: 'Wrong size',
        },
      ],
      reason: 'Wrong size',
    },
  };
  const validExchange = {
    body: {
      order: oid,
      items: [
        {
          originalProduct: oid,
          originalVariant: oid,
          exchangeForProduct: oid,
          exchangeForVariant: oid,
          quantity: 1,
          reason: 'Wrong size',
        },
      ],
      reason: 'Wrong size',
    },
  };

  await check('return rejects a non-objectId order', V.returnCreateValidation, { body: { order: 'nope', items: [] } }, true);
    await check('return rejects an empty item list', V.returnCreateValidation, { body: { order: oid, items: [], reason: 'x' } }, true);
    await check('return accepts a valid body', V.returnCreateValidation, validReturn, false);
    await check('return rejects a client-supplied refund on an unknown field', V.returnCreateValidation, { body: { ...validReturn.body, refundAmount: 1 } }, true);

    await check('exchange rejects a missing replacement', V.exchangeCreateValidation, { body: { ...validExchange.body, items: [{ ...validExchange.body.items[0], exchangeForProduct: undefined }] } }, true);
    await check('exchange accepts a valid body', V.exchangeCreateValidation, validExchange, false);

    await check('review rejects rating 9', V.reviewCreateValidation, { body: { rating: 9 } }, true);
    await check('review accepts rating 5', V.reviewCreateValidation, { body: { rating: 5 } }, false);
    await check('review rejects an unknown field', V.reviewCreateValidation, { body: { rating: 5, isVerifiedPurchase: true } }, true);

    await check('product list rejects page 0', V.productListValidation, { query: { page: 0 } }, true);
    await check('product list accepts a valid query', V.productListValidation, { query: { page: 1, limit: 20 } }, false);

    await check('product approval rejects a missing status', V.productApproval, { body: {} }, true);
    await check('product approval accepts status without a body product', V.productApproval, { body: { status: 'approved' } }, false);

    await check('delivery OTP rejects a 3-digit code', V.deliveryOtpValidation, { body: { otp: '123' } }, true);
    await check('delivery OTP accepts a 6-digit code', V.deliveryOtpValidation, { body: { otp: '123456' } }, false);

    await check('order id rejects a non-objectId param', V.orderIdValidation, { params: { order: 'nope' } }, true);
    await check('order id accepts an objectId param', V.orderIdValidation, { params: { order: oid } }, false);

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`));
  process.exitCode = failures === 0 ? 0 : 1;
};

run();
