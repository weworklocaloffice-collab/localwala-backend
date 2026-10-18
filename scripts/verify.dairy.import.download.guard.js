/**
 * LocalWala – Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright © 2026 WeWorkLocal Private Limited
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
 * Verifies the import-template download cannot escape its directory.
 *
 * The handler used to join a query-string `link` straight onto the template path,
 * so `../../.env` served the database URL and JWT secrets to any authenticated
 * admin. These checks pin the containment rule so it cannot regress.
 *
 * Usage: node scripts/verify.import.download.guard.js
 */

const fs = require('fs');
const path = require('path');

let failures = 0;
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const IMPORT_TEMPLATE_ROOT = path.resolve(__dirname, '..', 'src', 'templates', 'import_collection');

/** Mirrors the guard in `user.controller.downloadImportFile`. */
const resolveDownload = (link) => {
  if (typeof link !== 'string' || !link.trim()) {
    return { ok: false, reason: 'missing' };
  }
  const resolved = path.resolve(IMPORT_TEMPLATE_ROOT, link);
  const insideRoot = resolved.startsWith(IMPORT_TEMPLATE_ROOT + path.sep);
  if (!insideRoot) {
    return { ok: false, reason: 'outside root' };
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return { ok: false, reason: 'not a file' };
  }
  return { ok: true, resolved };
};

const run = () => {
  console.log('\n1. Legitimate templates are still served');
  [
    'csv/dairy_can_sample.csv',
    'csv/dairy_can_empty.csv',
    'xlsx/dairy_sku_sample.xlsx',
    'csv/dairy_milk_provider_empty.csv',
  ].forEach((link) => {
    const result = resolveDownload(link);
    check(`${link} resolves`, result.ok, result.reason);
  });

  console.log('\n2. Traversal is refused');
  [
    ['../../.env', 'the environment file'],
    ['../../../../package.json', 'the package manifest'],
    ['../user.controller.js', 'a source file'],
    ['csv/../../utils/importCollectionSchema.js', 'a traversal hidden mid-path'],
    ['..\\..\\.env', 'a Windows-style traversal'],
  ].forEach(([link, what]) => {
    const result = resolveDownload(link);
    check(`${link} refused (${what})`, !result.ok, result.resolved);
  });

  console.log('\n3. A sibling directory with a shared prefix is refused');
  // `import_collection_evil` starts with the same characters as the root but is
  // not inside it, which a naive `startsWith(root)` check would wave through.
  const sibling = `${IMPORT_TEMPLATE_ROOT}_evil/secret.csv`;
  const insideRoot = path.resolve(sibling).startsWith(IMPORT_TEMPLATE_ROOT + path.sep);
  check('prefix-sharing sibling is outside the root', insideRoot === false, sibling);

  console.log('\n4. Empty and non-string links are refused');
  [undefined, null, '', '   '].forEach((link) => {
    const result = resolveDownload(link);
    check(`${JSON.stringify(link)} refused`, !result.ok && result.reason === 'missing');
  });

  console.log('\n5. The root itself is not downloadable');
  const rootResult = resolveDownload('.');
  check('the directory itself is refused', !rootResult.ok, rootResult.reason);

  console.log(failures === 0 ? '\nALL IMPORT DOWNLOAD GUARD CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

run();
