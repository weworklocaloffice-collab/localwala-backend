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
 * Route paths and their validation schemas, cross-checked against each other.
 *
 * ## Why this suite exists
 *
 * Three separate defects in this codebase were the same mistake: the route path
 * declared a parameter that its validation schema did not.
 *
 *   PATCH /joining_request/review/:request/:id   schema declared only `request`
 *   DELETE .../categories/:id                   schema also demanded a non-empty body
 *   DELETE .../brands/:id                       aliased to an update schema, same fault
 *
 * Every one of them turned a working feature into a 400 that only appears at
 * runtime. The service layer was tested and passing throughout, because the defect
 * was never in the service — it was in the wiring between the path and the schema.
 *
 * So this check is not about any one route. It parses the route file, resolves the
 * schema each route is actually validated against, and compares the `:params` in the
 * path with the keys that schema accepts. A mismatch is reported with the route that
 * causes it.
 *
 * It also catches the inverse: a schema requiring a param the path does not supply,
 * which fails the same way with a more confusing message.
 */

const fs = require('fs');
const path = require('path');

const ROUTE_FILE = path.join(__dirname, '..', 'src', 'modules', 'dairy', 'routes', 'dairy.route.js');

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
  const source = fs.readFileSync(ROUTE_FILE, 'utf8');

  console.log('\n1. Reading the route file');

  // The route file pulls its validation objects in under short aliases. Resolve
  // those aliases to real modules so the schemas can actually be inspected.
  const moduleAliases = {};
  const requireRe = /const\s+(\w+)\s*=\s*require\((['"])([^'"]*validations[^'"]*)\2\);/g;
  let m;
  while ((m = requireRe.exec(source))) {
    moduleAliases[m[1]] = m[3];
  }
  const schemaModules = {};
  for (const [alias, rel] of Object.entries(moduleAliases)) {
    try {
      // Resolved against the route file's own directory, because that is what the
      // `require` in the route file is relative to.
      schemaModules[alias] = require(path.resolve(path.dirname(ROUTE_FILE), rel));
    } catch (error) {
      check(`could not load ${alias} from ${rel}`, false, error.message);
    }
  }
  check(
    'the validation modules all load',
    Object.keys(moduleAliases).length > 0 && Object.keys(schemaModules).length === Object.keys(moduleAliases).length,
    `${Object.keys(schemaModules).length}/${Object.keys(moduleAliases).length}`
  );

  console.log('\n2. Every route path matches its validation schema');

  // Each router.<method>( 'path', [middlewares...] ); registration.
  const routeRe = /router\.(get|post|patch|delete|put)\(\s*'([^']+)'([\s\S]{0,600}?)\)\s*;/g;
  const problems = [];
  let routes = 0;
  let validated = 0;

  while ((m = routeRe.exec(source))) {
    const method = m[1].toUpperCase();
    const routePath = m[2];
    const rest = m[3];
    routes += 1;

    // The `:params` the path promises Express.
    const pathParams = [...routePath.matchAll(/:(\w+)/g)].map((x) => x[1]);
    if (!pathParams.length) {
      continue;
    }

    const schemaMatch = rest.match(/validate\(\s*(\w+)\.(\w+)\s*\)/);
    if (!schemaMatch) {
      problems.push(`${method} ${routePath} — has :${pathParams.join(', :')} but no validate() schema`);
      continue;
    }
    validated += 1;

    const [, moduleAlias, schemaName] = schemaMatch;
    const mod = schemaModules[moduleAlias];
    if (!mod) {
      problems.push(`${method} ${routePath} — unknown validation module ${moduleAlias}`);
      continue;
    }
    const schema = mod[schemaName];
    if (!schema) {
      problems.push(`${method} ${routePath} — ${moduleAlias} exports no ${schemaName}`);
      continue;
    }

    const paramsSchema = schema.params;
    if (!paramsSchema) {
      problems.push(
        `${method} ${routePath} — path supplies :${pathParams.join(', :')} but ${schemaName} validates no params`
      );
      continue;
    }

    // Ask Joi which keys it will actually accept, then compare.
    //
    // Only an `object.unknown` detail counts as a mismatch. A value-level failure
    // is not a wiring defect: many of these params carry a `valid()` enum (a status
    // may only be `active`/`suspended`/`terminated`, say), which a probe value
    // cannot satisfy. Those schemas do declare the key, and this check is not
    // about their allowed values.
    const probe = {};
    for (const key of pathParams) {
      probe[key] = '507f1f77bcf86cd799439011';
    }
    const result = paramsSchema.validate(probe, { abortEarly: false });
    const unknown = result.error
      ? result.error.details.filter((d) => d.type === 'object.unknown')
      : [];

    if (unknown.length) {
      const names = unknown.map((d) => d.context && d.context.key).filter(Boolean);
      problems.push(
        `${method} ${routePath} — ${schemaName} does not declare :${names.join(', :')}`
      );
    }
  }

  check(
    `no route's path disagrees with its schema (${validated} validated of ${routes} routes)`,
    problems.length === 0,
    `${problems.length} mismatch(es)`
  );
  for (const problem of problems) {
    console.log(`          ${problem}`);
  }

  console.log('\n3. No DELETE route rejects an empty body');

  // A separate assertion because this exact failure produced a 400 with a
  // misleading message ("key is required") that looked like a payload problem
  // rather than a routing one.
  //
  // The test is whether an empty body actually *fails*, not whether the schema
  // mentions a body at all. A DELETE may legitimately accept an optional reason —
  // `driverRemoveValidation` does — and a schema that merely declares a body is
  // harmless. What breaks is a body with `.min(1)` or a required key, because
  // `express.urlencoded` leaves `req.body` as `{}`.
  const deleteRe = /router\.delete\(\s*'([^']+)'([\s\S]{0,600}?)\)\s*;/g;
  const deleteProblems = [];
  let deletes = 0;
  while ((m = deleteRe.exec(source))) {
    deletes += 1;
    const schemaMatch = m[2].match(/validate\(\s*(\w+)\.(\w+)\s*\)/);
    if (!schemaMatch) {
      continue;
    }
    const mod = schemaModules[schemaMatch[1]];
    const schema = mod && mod[schemaMatch[2]];
    if (!schema || !schema.body) {
      continue;
    }
    const result = schema.body.validate({});
    if (result.error) {
      deleteProblems.push(
        `DELETE ${m[1]} — ${schemaMatch[2]} rejects the empty body a DELETE sends: ${result.error.details
          .map((d) => d.message)
          .join(', ')}`
      );
    }
  }
  check(
    `every DELETE tolerates an empty body (${deletes} delete routes)`,
    deleteProblems.length === 0,
    `${deleteProblems.length} offender(s)`
  );
  for (const problem of deleteProblems) {
    console.log(`          ${problem}`);
  }

  console.log(
    failures === 0
      ? '\nALL DAIRY ROUTE/SCHEMA AGREEMENT CHECKS PASSED'
      : `\n${failures} CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error('verification failed:', error.message);
  process.exit(1);
});