/**
 * Builds the `Dairy Routes` folder in the Postman collection from
 * `dairy.route.js`, and injects it.
 *
 * ## Why generate it
 *
 * The collection is the thing people actually click through, and a hand-written
 * copy of 160 routes is wrong within a week. Every request here is derived from
 * the same declarations the contract checker reads, so a route that changes
 * shape changes the collection on the next run.
 *
 * ## What is derived, and what is not
 *
 * From the route file: method, path, and the validation applied.
 *
 * From the validation: required path params (emitted as Postman path variables)
 * and required body keys (emitted as a minimal example body).
 *
 * Not derived: the *values*. A `{{skuId}}` is a variable with no example, so a
 * request only works once the caller fills in the collection's variables. That is
 * deliberate - a guessed `ObjectId` would return a 404 and read as a broken
 * endpoint rather than an unfilled variable.
 *
 * Run with `--check` to verify the committed collection is up to date without
 * writing; CI can fail on a mismatch.
 */

const fs = require('fs');
const path = require('path');

const API_ROOT = path.join(__dirname, '..');
const COLLECTION = path.join(API_ROOT, '..', 'Resource', 'postman_collection.json');
const ROUTE_FILE = path.join(API_ROOT, 'src', 'modules', 'dairy', 'routes', 'dairy.route.js');
const VALIDATION_DIR = path.join(API_ROOT, 'src', 'modules', 'dairy', 'validations');
const KERNEL_VALIDATION_DIR = path.join(API_ROOT, 'src', 'kernel', 'delivery', 'validations');

const checkOnly = process.argv.includes('--check');

/** The vertical's base path, so a reader can see it without counting segments. */
const BASE = '{{baseUrl}}/v1/dairy';

/**
 * Groups the routes into folders by the first path segment after `/`.
 *
 * A flat list of 160 requests is unnavigable. Grouping by resource mirrors how
 * the documentation and the route file are organised.
 */
const FOLDER_ORDER = [
  'auth',
  'profile',
  'catalog',
  'customer',
  'driver',
  'partner',
  'settlements',
  'compliance',
  'canners',
  'partners',
  'franchises',
  'batches',
  'containers',
  'subscription',
  'running',
  'notification',
  'joining_request',
];

// //// Reading the route file ////

const routeSource = fs.readFileSync(ROUTE_FILE, 'utf8');

/**
 * Pulls every registration out of the route file.
 *
 * Each capture is the same shape the contract checker uses, deliberately: if one
 * of them matches registrations the other does not, the collection and the
 * contract report would disagree about what exists.
 */
const readRoutes = () => {
  const re = /router\.(get|post|put|patch|delete)\(\s*'([^']+)'([\s\S]*?)\);/g;
  const routes = [];
  let match = re.exec(routeSource);

  while (match !== null) {
    const [, method, routePath, body] = match;

    const validateMatch = /validate\(\s*([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s*\)/.exec(body);
    const handlerMatch = /([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s*$/.exec(body.trim());

    routes.push({
      method: method.toUpperCase(),
      path: routePath,
      validation: validateMatch ? `${validateMatch[1]}.${validateMatch[2]}` : null,
      handler: handlerMatch ? `${handlerMatch[1]}.${handlerMatch[2]}` : null,
      // Auth, kept as a note so a reader knows what a 403 will mean.
      auth: /partnerAuth\(\s*'([^']+)'/.exec(body)
        ? `partner (${/partnerAuth\(\s*'([^']+)'/.exec(body)[1]})`
        : /appAuth\(\s*'([^']+)'/.exec(body)
          ? `app (${/appAuth\(\s*'([^']+)'/.exec(body)[1]})`
          : /webAuth\(\s*'([^']+)'/.exec(body)
            ? `web (${/webAuth\(\s*'([^']+)'/.exec(body)[1]})`
            : 'public',
    });

    match = re.exec(routeSource);
  }

  return routes;
};

// //// Reading the validations ////

/**
 * Extracts the required `params` and `body` keys a validation declares.
 *
 * Read from source rather than by requiring the modules, because requiring the
 * validations pulls in Joi and the custom validators, and this script should be
 * runnable without the app's dependencies being installed.
 */
const readValidationKeys = (alias, name) => {
  // The filename convention is not derivable reliably (`DairyCanValidation` ->
  // `dairy.can.validation.js` is, but `DairySubscriptionValidation` and
  // `DeliveryRunValidation` live in different directories), so the directory is
  // searched instead.
  const candidates =
    alias === 'DeliveryRunValidation'
      ? [path.join(KERNEL_VALIDATION_DIR, 'delivery.run.validation.js')]
      : fs
        .readdirSync(VALIDATION_DIR)
        .filter((f) => f.endsWith('.validation.js'))
        .map((f) => path.join(VALIDATION_DIR, f))
        .filter((f) => {
          const source = fs.readFileSync(f, 'utf8');
          return source.includes('module.exports = {') && source.includes(`  ${name},`);
        });

  const file = candidates.find(Boolean);
  if (!file) {
    return { params: [], body: [] };
  }

  const source = fs.readFileSync(file, 'utf8');
  const start = source.indexOf(`const ${name} = {`);
  if (start === -1) {
    return { params: [], body: [] };
  }

  const block = source.slice(start, source.indexOf('\n};', start));

  const section = (label) => {
    const at = block.indexOf(`${label}: Joi.object()`);
    if (at === -1) return [];
    // Keys are lines of the form `key: Joi....required(),` inside the section.
    const keys = [];
    const re = /^\s{2,4}(\w+):\s*Joi\.[^\n]*\.required\(\),?\s*$/gm;
    let m = re.exec(block.slice(at));
    while (m !== null) {
      keys.push(m[1]);
      m = re.exec(block.slice(at));
    }
    return keys;
  };

  return { params: section('params'), body: section('body') };
};

// //// Building requests ////

/**
 * An example value for a field name.
 *
 * Only *structural* fields get a literal. Anything where a wrong value would
 * still be accepted by the API becomes a variable instead, because a plausible
 * literal is worse than an obvious blank:
 *
 *   amount: 1        -> a real payout request for one rupee, sent in confidence
 *   quantity: 1      -> a real order for one litre
 *   mobile: 1        -> a registration against someone else's number
 *
 * A `{{variable}}` is impossible to mistake for data. Dates and booleans are the
 * exceptions: their valid values are enumerable, so a literal there is
 * informative rather than misleading.
 */
const EXAMPLE = (key) => {
  if (/date|At$|^from$|^to$|Expiry/i.test(key)) return '{{isoDate}}';
  if (/^(is|has|approve|approved|active|blocked|inStock|required|verified)/.test(key)) return true;
  return `{{${key}}}`;
};

const buildRequest = (route) => {
  const keys = route.validation
    ? readValidationKeys(route.validation.split('.')[0], route.validation.split('.')[1])
    : { params: [], body: [] };

  const url = `${BASE}${route.path.replace(/:(\w+)/g, '{{$1}}')}`;

  // Path variables are declared on the URL, with their example in the path itself.
  for (const key of keys.params) {
    route.paramKeys = route.paramKeys || [];
    route.paramKeys.push(key);
  }

  const raw =
    route.path.match(/:(\w+)/g)?.map((p) => p.slice(1)) || [];

  const segments = url.split('/').map((segment) => {
    const match = /^{{(\w+)}}$/.exec(segment);
    if (!match) return segment;
    return `{{${match[1]}}}`;
  });

  const request = {
    name: `${route.method} ${route.path}`,
    request: {
      method: route.method,
      header: [
        { key: 'Content-Type', value: 'application/json' },
        { key: 'Authorization', value: 'Bearer {{accessToken}}' },
      ],
      description: [
        `Handler: \`${route.handler || 'unknown'}\``,
        `Auth: ${route.auth}`,
        route.validation ? `Validation: \`${route.validation}\`` : 'Validation: none',
        raw.length > 0 ? `Path params: ${raw.join(', ')}` : null,
        '',
        'The outlet and the signed-in user come from the token, so no path here',
        'carries an outlet id - {{accessToken}} decides which outlet answers.',
      ]
        .filter((line) => line !== null)
        .join('\n'),
      url: {
        raw: segments.join('/'),
        host: ['{{baseUrl}}'],
        path: route.path.replace(/^\//, '').split('/'),
      },
    },
    response: [],
  };

  if (keys.body.length > 0 && route.method !== 'GET') {
    const body = {};
    for (const key of keys.body) {
      body[key] = EXAMPLE(key);
    }
    request.request.body = {
      mode: 'raw',
      raw: JSON.stringify(body, null, 2),
      options: { raw: { language: 'json' } },
    };
  }

  return { request, paramKeys: raw };
};

// //// Assembling ////

const routes = readRoutes();
const folders = new Map();

for (const route of routes) {
  const segments = route.path.replace(/^\//, '').split('/');
  const key = segments[0] === 'partner' ? 'partner' : segments[0];

  if (!folders.has(key)) {
    folders.set(key, []);
  }

  folders.get(key).push(route);
}

const known = FOLDER_ORDER.filter((name) => folders.has(name));
const extra = [...folders.keys()].filter((name) => !FOLDER_ORDER.includes(name)).sort();

const items = [...known, ...extra].map((folder) => ({
  name: folder === 'partner' ? 'Partner (outlet-scoped)' : folder,
  item: folders.get(folder).map((route) => buildRequest(route).request),
}));

const dairyFolder = {
  name: 'Dairy Routes',
  description:
    'Generated by `scripts/build.dairy.postman.js` from `dairy.route.js`.\n\n' +
    'Do not hand-edit: re-run the script. A hand edit is lost on the next run, ' +
    'which is how a collection and an API drift apart.\n\n' +
    'Every partner route is outlet-scoped from the token. There is deliberately ' +
    'no outlet variable here - `{{accessToken}}` decides which outlet answers.',
  item: items,
};

const collection = JSON.parse(fs.readFileSync(COLLECTION, 'utf8'));

const existingIndex = (collection.item || []).findIndex((f) => f.name === 'Dairy Routes');
if (existingIndex >= 0) {
  collection.item.splice(existingIndex, 1, dairyFolder);
} else {
  collection.item.push(dairyFolder);
}

const serialised = `${JSON.stringify(collection, null, 2)}\n`;

if (checkOnly) {
  const current = fs.readFileSync(COLLECTION, 'utf8');
  if (current === serialised) {
    console.log('  up to date');
    process.exit(0);
  }
  console.error('  STALE: the committed collection differs from what the routes produce');
  process.exit(1);
}

fs.writeFileSync(COLLECTION, serialised);

const requestCount = items.reduce((sum, folder) => sum + folder.item.length, 0);
console.log(`  Dairy Routes: ${requestCount} requests in ${items.length} folders`);
for (const folder of items) {
  console.log(`    ${folder.name.padEnd(32)} ${String(folder.item.length).padStart(3)}`);
}
console.log(`  collection: ${COLLECTION}`);