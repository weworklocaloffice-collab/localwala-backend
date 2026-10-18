/**
 * verify.realestate.customer.visits.js — Flow 11 gate.
 *
 * The customer visit-request surface: request a visit against one of
 * your own leads, list them, open one. The backend pieces this gates:
 *
 *   - 3 routes on `/v1/realestate/customer` behind `appAuth()`
 *   - Joi body with no `customer` / `executive` / `status` field
 *     (tenant from the token; assignment belongs to the engine)
 *   - service ownership scoping (lead, list, detail) — 404, not 403
 *   - one open request per lead (no double-booking)
 *   - no past dates; SOLD/RENTED properties refuse visits
 *   - lead status advances only through LEAD_TRANSITIONS (BR-03)
 *   - immediate assignment shares one implementation with the cron
 *     sweep (`assignmentService.assignVisitRequest`)
 *
 * Run: node scripts/verify.realestate.customer.visits.js
 */

const fs = require('fs');
const path = require('path');

const ROUTE = path.resolve(__dirname, '..', 'src', 'modules', 'realestate', 'routes', 'realestate.customer.route.js');
const VALIDATION = path.resolve(__dirname, '..', 'src', 'modules', 'realestate', 'validations', 'realestate.customer.validation.js');
const CONTROLLER = path.resolve(__dirname, '..', 'src', 'modules', 'realestate', 'controllers', 'realestate.customer.controller.js');
const VISIT_SERVICE = path.resolve(__dirname, '..', 'src', 'modules', 'realestate', 'services', 'realestate.visit.service.js');
const ASSIGNMENT_SERVICE = path.resolve(__dirname, '..', 'src', 'modules', 'realestate', 'services', 'realestate.assignment.service.js');
const CRON_SERVICE = path.resolve(__dirname, '..', 'src', 'modules', 'realestate', 'services', 'realestate.cron.service.js');
const STATE_MACHINE = path.resolve(__dirname, '..', 'src', 'modules', 'realestate', 'utils', 'realestate.state.machine.js');

const V = require(VALIDATION);
const router = require(ROUTE);
const stateMachine = require(STATE_MACHINE);

const controllerText = fs.readFileSync(CONTROLLER, 'utf8');
const visitText = fs.readFileSync(VISIT_SERVICE, 'utf8');
const assignmentText = fs.readFileSync(ASSIGNMENT_SERVICE, 'utf8');
const cronText = fs.readFileSync(CRON_SERVICE, 'utf8');

const checks = [];
const assert = (label, ok, detail = '') => {
  checks.push({ label, ok, detail });
};

// ---- 1. The 3 customer visit routes are wired behind appAuth(). ----
const wired = router.stack
  .filter((l) => l.route)
  .map((l) => ({
    method: Object.keys(l.route.methods)[0].toUpperCase(),
    path: l.route.path,
    handlers: (l.route.stack || []).map((s) => s.name || ''),
  }));
const expected = [
  { method: 'POST', path: '/visits' },
  { method: 'GET', path: '/visits' },
  { method: 'GET', path: '/visits/:id' },
];
const missing = expected.filter(
  (e) => !wired.some((w) => w.method === e.method && w.path === e.path)
);
assert(
  '[1a] POST/GET /visits and GET /visits/:id wired on the customer router',
  missing.length === 0,
  missing.length
    ? `missing: ${missing.map((m) => m.method + ' ' + m.path).join(', ')}`
    : 'all 3 wired'
);

// appAuth on every route: the route file source shows `appAuth()` on
// the same line as each visit declaration.
const routeText = fs.readFileSync(ROUTE, 'utf8');
const visitRouteLines = routeText.split('\n').filter((l) => /router\.(post|get)\('\/visits/.test(l));
assert(
  '[1b] every visit route declares appAuth()',
  visitRouteLines.length === 3 && visitRouteLines.every((l) => l.includes('appAuth()')),
  `${visitRouteLines.length} visit route line(s)`
);

// ---- 2. Validation: no tenant/status/executive in the body. ----
assert(
  '[2a] createVisit body schema exported',
  !!(V.createVisit && V.createVisit.body)
);
const visitBodyMatch = fs.readFileSync(VALIDATION, 'utf8').match(/visitCreateBody = Joi\.object\(\{[\s\S]*?\}\)/);
assert(
  '[2b] body has no customer / executive / status / property field',
  visitBodyMatch &&
    !/\bcustomer:/.test(visitBodyMatch[0]) &&
    !/\bexecutive:/.test(visitBodyMatch[0]) &&
    !/\bstatus:/.test(visitBodyMatch[0]) &&
    !/\bproperty:/.test(visitBodyMatch[0]),
  visitBodyMatch ? 'fields: ' + (visitBodyMatch[0].match(/^\s+(\w+):/gm) || []).map((s) => s.trim().replace(':', '')).join(', ') : 'visitCreateBody not found'
);

// ---- 3. Slot enum is closed (Joi probe). ----
{
  const good = V.createVisit.body.validate({
    lead: '64b0000000000000000000aa',
    preferredDate: '2030-01-15',
    preferredTimeSlot: 'MORNING',
  });
  const bad = V.createVisit.body.validate({
    lead: '64b0000000000000000000aa',
    preferredDate: '2030-01-15',
    preferredTimeSlot: 'MIDDAY',
  });
  assert(
    '[3a] preferredTimeSlot enum is closed (MORNING ok, MIDDAY rejected)',
    !good.error && !!bad.error && /one of|valid/.test(bad.error.message)
  );
  const noCustomer = V.createVisit.body.validate({
    lead: '64b0000000000000000000aa',
    preferredDate: '2030-01-15',
    preferredTimeSlot: 'EVENING',
    customer: '64b0000000000000000000bb',
  });
  assert(
    '[3b] an enumerable `customer` in the body is rejected (unknown key)',
    !!noCustomer.error
  );
}

// ---- 4. Controller handlers exist and scope to req.user. ----
const handlerOk = (name) => {
  const m = controllerText.match(new RegExp(`const ${name} = catchAsync\\(async \\(req, res\\) => \\{[\\s\\S]+?\\n\\}\\);`));
  return m && m[0].includes('requireCustomer(req)');
};
assert('[4a] createVisitRequest handler scopes to requireCustomer', !!handlerOk('createVisitRequest'));
assert('[4b] listMyVisits handler scopes to requireCustomer', !!handlerOk('listMyVisits'));
assert('[4c] getMyVisit handler scopes to requireCustomer', !!handlerOk('getMyVisit'));
assert(
  '[4d] getMyVisit 404s (missing and foreign id are indistinguishable)',
  /getMyVisit[\s\S]+?NOT_FOUND/.test(controllerText)
);

// ---- 5. Service ownership scoping. ----
assert(
  '[5a] createVisitRequest resolves the lead with { _id: leadId, customer }',
  /findOne\(\s*\{\s*_id:\s*leadId,\s*customer\s*\}/.test(visitText)
);
assert(
  '[5b] listVisitRequestsForCustomer filters { customer: customerId }',
  /async function listVisitRequestsForCustomer[\s\S]+?filter = \{\s*customer:\s*customerId\s*\}/.test(visitText)
);
assert(
  '[5c] findVisitRequestForCustomer scopes findOne to the customer',
  /async function findVisitRequestForCustomer[\s\S]+?findOne\(\s*\{\s*_id:\s*requestId,\s*customer:\s*customerId\s*\}/.test(visitText)
);

// ---- 6. Business guards. ----
assert(
  '[6a] one open request per lead (PENDING_ASSIGNMENT..IN_PROGRESS $in)',
  /OPEN_REQUEST_STATUSES = \[[^\]]*'PENDING_ASSIGNMENT'[^\]]*'ASSIGNED'[^\]]*\]/.test(visitText) &&
    /status: \{ \$in: OPEN_REQUEST_STATUSES \}/.test(visitText)
);
assert(
  '[6b] past dates rejected (startOfToday guard)',
  /startOfToday/.test(visitText) && /past date/.test(visitText)
);
assert(
  '[6c] SOLD/RENTED properties refuse visit requests',
  /\['SOLD', 'RENTED'\]\.includes\(prop\.availability\)/.test(visitText)
);
assert(
  '[6d] lead status advances only through LEAD_TRANSITIONS (BR-03)',
  /canLeadTransition\(\s*LEAD_TRANSITIONS,\s*lead\.status,\s*'VISIT_REQUESTED'\s*\)/.test(visitText)
);
assert(
  '[6e] the service never creates a visit directly (assignment is the engine\'s job)',
  !/RealEstateVisit\.create/.test(visitText) &&
    /assignmentService\.assignVisitRequest\(request\)/.test(visitText)
);
assert(
  '[6f] customer confirmation is best-effort (try/catch around the push)',
  /try \{\s*await fcmNotificationService\.realEstateVisitRequested/.test(visitText)
);

// ---- 7. Immediate assignment shares one implementation with the sweep. ----
assert(
  '[7a] assignmentService exports assignVisitRequest',
  /assignVisitRequest/.test(assignmentText) &&
    /realEstateAssignmentService = \{ pickExecutive, assignVisitRequest \}/.test(assignmentText)
);
assert(
  '[7b] assignVisitRequest creates the visit ASSIGNED and flips the request',
  /status: 'ASSIGNED'/.test(assignmentText) &&
    /request\.status = 'ASSIGNED'/.test(assignmentText) &&
    /request\.visit = visit\._id/.test(assignmentText)
);
assert(
  '[7c] cron sweepAssignments delegates to assignmentService.assignVisitRequest',
  /assignmentService\.assignVisitRequest\(req\)/.test(cronText)
);

// ---- 8. State machine still sanctions the request lifecycle. ----
assert(
  '[8] VISIT_REQUEST_TRANSITIONS: PENDING_ASSIGNMENT → ASSIGNED/CANCELLED',
  JSON.stringify(stateMachine.VISIT_REQUEST_TRANSITIONS.PENDING_ASSIGNMENT) ===
    JSON.stringify(['ASSIGNED', 'CANCELLED'])
);

// ---- Report ----
let failed = 0;
console.log('Customer visits (Flow 11) — gate');
console.log('================================');
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
console.log(`ALL ${checks.length} CUSTOMER VISIT CHECKS PASSED`);
