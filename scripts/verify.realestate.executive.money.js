/**
 * Static checks for the executive money surface: holds, loans and sales.
 *
 * No database and no HTTP server. The live behaviours (lead scoping,
 * populated projections, money getters) are covered by the service and
 * integration checks; this file pins the wiring that a route or export
 * rename could silently break.
 *
 * Run: node scripts/verify.realestate.executive.money.js
 */

const path = require('path');

const API = path.resolve(__dirname, '..');
const at = (p) => path.join(API, p);

let failed = 0;
const ok = (m) => console.log('  OK   ' + m);
const bad = (m, e) => {
  failed++;
  console.log('  FAIL ' + m + '  ->  ' + e);
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const routesOf = (router) => {
  const out = [];
  const walk = (stack) => {
    for (const layer of stack || []) {
      if (layer.route) {
        const methods = layer.route.methods;
        const names = Array.isArray(methods)
          ? methods
          : Object.keys(methods || {}).filter((k) => methods[k]);
        for (const name of names) out.push(name.toUpperCase() + ' ' + layer.route.path);
      } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk(router.stack);
  return out;
};

console.log('\n[1] executive money routes are mounted');

const router = require(at('src/modules/realestate/routes/realestate.executive.route.js'));
const routes = routesOf(router);

const expected = [
  'GET /holds',
  'GET /holds/:id',
  'GET /loans',
  'GET /loans/:id',
  'GET /sales',
  'GET /sales/:id',
];
for (const route of expected) {
  if (routes.includes(route)) ok(route);
  else bad(route, 'missing');
}

const actorIdRoutes = routes.filter((r) => r.includes(':executiveId'));
if (actorIdRoutes.length) bad('no :executiveId route', actorIdRoutes.join(', '));
else ok('no route names the actor (doc 7.1)');

console.log('\n[2] controller handlers and service reads are exported');

const controller = require(at('src/modules/realestate/controllers/realestate.executive.controller.js'));
for (const name of ['listHolds', 'getHold', 'listLoans', 'getLoan', 'listSales', 'getSale']) {
  if (typeof controller[name] === 'function') ok(`controller.${name}`);
  else bad(`controller.${name}`, typeof controller[name]);
}

const loanService = require(at('src/modules/realestate/services/realestate.loan.service.js'));
const saleService = require(at('src/modules/realestate/services/realestate.sale.service.js'));
for (const name of ['listForExecutive', 'findForExecutive']) {
  if (typeof loanService[name] === 'function') ok(`loanService.${name}`);
  else bad(`loanService.${name}`, typeof loanService[name]);
}
for (const name of ['listForExecutive', 'findByIdForExecutive']) {
  if (typeof saleService[name] === 'function') ok(`saleService.${name}`);
  else bad(`saleService.${name}`, typeof saleService[name]);
}

console.log('\n[3] validation status list cannot drift from the model enum');

const V = require(at('src/modules/realestate/validations/realestate.executive.validation.js'));
const LoanRequest = require(at('src/modules/realestate/models/realestate.loan.request.model.js'));
const modelStatuses = LoanRequest.schema.path('status').enumValues;
const validated = V.LOAN_STATUS;

if (validated.length !== modelStatuses.length) {
  bad('LOAN_STATUS length', `${validated.length} validated vs ${modelStatuses.length} model`);
} else if (modelStatuses.some((s) => !validated.includes(s))) {
  bad('LOAN_STATUS values', 'validated list is missing a model status');
} else {
  ok(`LOAN_STATUS mirrors all ${modelStatuses.length} loan request states`);
}

for (const name of ['loans', 'loanParams', 'holdParams', 'sales', 'saleParams']) {
  if (V[name]) ok(`validate shape ${name} present`);
  else bad(`validate shape ${name}`, 'missing');
}

console.log('\n[4] document MIME allowlist covers every property category');

const rules = require(at('src/modules/realestate/utils/realestate.document.rules.js'));
const PropertyDocument = require(at(
  'src/modules/realestate/models/realestate.property.document.model.js'
));
const categories = PropertyDocument.schema.path('category').enumValues;
const uncovered = categories.filter((c) => !rules.DOCUMENT_MIME_ALLOWLIST[c]);

if (uncovered.length) bad('MIME allowlist category coverage', uncovered.join(', '));
else ok(`allowlist covers all ${categories.length} property document categories`);

for (const category of categories) {
  const allowed = rules.DOCUMENT_MIME_ALLOWLIST[category];
  if (Array.isArray(allowed) && allowed.length > 0) {
    ok(`${category.padEnd(12)} -> ${allowed.join(', ')}`);
  } else {
    bad(`${category} allowlist`, 'empty');
  }
}

console.log('\n' + (failed === 0 ? 'ALL EXECUTIVE MONEY CHECKS PASSED' : failed + ' CHECK(S) FAILED'));
process.exit(failed === 0 ? 0 : 1);
