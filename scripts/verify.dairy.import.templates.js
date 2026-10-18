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
 * Verifies the dairy import templates against the column maps that drive them.
 *
 * Why this needs checking: an import template is a contract with an operator
 * filling in a spreadsheet. If the CSV header and the `SchemaKeys` array disagree,
 * the upload is either rejected outright or — worse — accepted with columns
 * silently mapped onto the wrong fields. Nothing else in the build would notice.
 *
 * Asserts, for every dairy template:
 *   1. the CSV header matches the column map exactly, order included
 *   2. the `_empty` template carries headers and no data rows
 *   3. the `_sample` template has at least one data row
 *   4. every sample row has the same number of columns as the header
 *   5. the `.xlsx` twin exists and its header row matches the CSV
 *   6. no column map is exported without templates behind it
 *
 * Usage: node scripts/verify.dairy.import.templates.js
 */

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const {
  dairyCanSchemaKeys,
  dairyProductSchemaKeys,
  dairySkuSchemaKeys,
  dairyMilkProviderSchemaKeys,
} = require('../src/utils/importCollectionSchema');

const CSV_DIR = path.join(__dirname, '..', 'src', 'templates', 'import_collection', 'csv');
const XLSX_DIR = path.join(__dirname, '..', 'src', 'templates', 'import_collection', 'xlsx');

let failures = 0;
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

/** Minimal RFC 4180 reader; the same rules as the template builder. */
const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
};

const TEMPLATES = [
  { base: 'dairy_can', keys: dairyCanSchemaKeys },
  { base: 'dairy_product', keys: dairyProductSchemaKeys },
  { base: 'dairy_sku', keys: dairySkuSchemaKeys },
  { base: 'dairy_milk_provider', keys: dairyMilkProviderSchemaKeys },
];

const run = async () => {
  console.log('\n1. CSV headers match the column maps');
  TEMPLATES.forEach(({ base, keys }) => {
    const csvPath = path.join(CSV_DIR, `${base}_empty.csv`);
    if (!fs.existsSync(csvPath)) {
      check(`${base} empty template exists`, false, csvPath);
      return;
    }
    const [header] = parseCsv(fs.readFileSync(csvPath, 'utf8'));
    check(
      `${base} header matches its column map`,
      JSON.stringify(header) === JSON.stringify(keys),
      `csv=${JSON.stringify(header)} map=${JSON.stringify(keys)}`
    );
  });

  console.log('\n2. Empty templates carry no data');
  TEMPLATES.forEach(({ base }) => {
    const rows = parseCsv(fs.readFileSync(path.join(CSV_DIR, `${base}_empty.csv`), 'utf8'));
    check(`${base} empty template is headers only`, rows.length === 1, `${rows.length} rows`);
  });

  console.log('\n3. Sample templates are usable');
  TEMPLATES.forEach(({ base, keys }) => {
    const rows = parseCsv(fs.readFileSync(path.join(CSV_DIR, `${base}_sample.csv`), 'utf8'));
    check(`${base} sample has data rows`, rows.length > 1, `${rows.length} rows`);

    const badRow = rows.slice(1).findIndex((row) => row.length !== keys.length);
    check(
      `${base} every sample row has ${keys.length} columns`,
      badRow === -1,
      badRow === -1 ? '' : `row ${badRow + 2} has ${rows[badRow + 1].length}`
    );

    // A header/column-count mismatch inside the sample file itself would be a
    // broken spreadsheet even if the map agrees.
    check(
      `${base} sample header matches its column map`,
      JSON.stringify(rows[0]) === JSON.stringify(keys),
      `csv=${JSON.stringify(rows[0])}`
    );
  });

  console.log('\n4. xlsx twins exist and agree');
  for (const { base, keys } of TEMPLATES) {
    const xlsxPath = path.join(XLSX_DIR, `${base}_sample.xlsx`);
    // eslint-disable-next-line no-await-in-loop
    const exists = fs.existsSync(xlsxPath);
    check(`${base} sample workbook exists`, exists, xlsxPath);
    if (!exists) continue;

    // eslint-disable-next-line no-await-in-loop
    const workbook = new ExcelJS.Workbook();
    // eslint-disable-next-line no-await-in-loop
    await workbook.xlsx.readFile(xlsxPath);
    const sheet = workbook.worksheets[0];
    // eslint-disable-next-line no-await-in-loop
    const header = sheet.getRow(1).values.slice(1).map((v) => String(v));
    check(
      `${base} workbook header matches the CSV`,
      JSON.stringify(header) === JSON.stringify(keys),
      `xlsx=${JSON.stringify(header)}`
    );
  }

  console.log('\n5. No orphaned column maps');
  const declared = Object.keys(require('../src/utils/importCollectionSchema'))
    .filter((k) => k.startsWith('dairy') && k.endsWith('SchemaKeys'));
  check('all four dairy maps are exported', declared.length === 4, `got ${declared.length}`);
  TEMPLATES.forEach(({ base }) => {
    check(
      `${base} has both csv templates`,
      fs.existsSync(path.join(CSV_DIR, `${base}_empty.csv`))
      && fs.existsSync(path.join(CSV_DIR, `${base}_sample.csv`))
    );
  });

  console.log(failures === 0 ? '\nALL IMPORT TEMPLATE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error('verification failed:', error.message);
  process.exit(1);
});
