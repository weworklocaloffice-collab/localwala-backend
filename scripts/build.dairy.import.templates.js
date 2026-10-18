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
 * Generates the `.xlsx` twins of the CSV import templates.
 *
 * The platform offers operators both formats, and the xlsx files are committed
 * alongside the CSVs rather than produced at runtime: `downloadImportFile` serves
 * straight off disk, so a template that is not on disk is a 404.
 *
 * Column headers and the sample rows are read from the CSV of the same name, so
 * the two formats cannot drift apart. Run after changing any dairy CSV:
 *
 *   node scripts/build.dairy.import.templates.js
 */

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const CSV_DIR = path.join(__dirname, '..', 'src', 'templates', 'import_collection', 'csv');
const XLSX_DIR = path.join(__dirname, '..', 'src', 'templates', 'import_collection', 'xlsx');

/** Base names to convert. Each must have a matching `_empty.csv` and `_sample.csv`. */
const DAIRY_TEMPLATES = [
  'dairy_can',
  'dairy_product',
  'dairy_sku',
  'dairy_milk_provider',
];

/**
 * Minimal RFC 4180 reader.
 *
 * A full CSV parser is not needed for templates we generate ourselves, but quoted
 * commas must still survive — a description like `Milk, full cream` would
 * otherwise be read as two columns and quietly shift every value after it.
 */
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

const writeWorkbook = async (filePath, rows) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'LocalWala';
  const sheet = workbook.addWorksheet('Import');

  // Plain strings, styled afterwards via `getRow(1)`. Passing rich-text objects
  // (`{ text, font }`) to `addRow` makes ExcelJS write the object's JSON as the
  // cell's literal value, so the header row ends up as escaped JSON rather than
  // column names.
  rows.forEach((row) => sheet.addRow(row));

  sheet.getRow(1).font = { bold: true };
  // Width from the longest value in each column, capped so one long description
  // does not push the rest of the sheet off screen.
  const widths = rows[0].map((_, col) => {
    const longest = rows.reduce((max, row) => Math.max(max, String(row[col] || '').length), 0);
    return Math.min(Math.max(longest + 2, 10), 40);
  });
  widths.forEach((width, col) => {
    sheet.getColumn(col + 1).width = width;
  });

  await workbook.xlsx.writeFile(filePath);
};

const run = async () => {
  if (!fs.existsSync(XLSX_DIR)) {
    fs.mkdirSync(XLSX_DIR, { recursive: true });
  }

  for (const base of DAIRY_TEMPLATES) {
    for (const variant of ['empty', 'sample']) {
      const csvPath = path.join(CSV_DIR, `${base}_${variant}.csv`);
      if (!fs.existsSync(csvPath)) {
        console.log(`  SKIP  ${base}_${variant}.csv is missing`);
        continue;
      }
      const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
      const xlsxPath = path.join(XLSX_DIR, `${base}_${variant}.xlsx`);
      // eslint-disable-next-line no-await-in-loop
      await writeWorkbook(xlsxPath, rows);
      console.log(`  WROTE ${path.relative(process.cwd(), xlsxPath)} (${rows.length} rows)`);
    }
  }
};

run().catch((error) => {
  console.error('template build failed:', error.message);
  process.exit(1);
});
