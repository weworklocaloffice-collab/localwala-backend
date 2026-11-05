/**
 * LocalWala - Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright c 2026 WeWorkLocal Private Limited
 * https://weworklocal.in/
 *
 * WeWorkLocal Private Limited
 *
 * This source code is confidential. Unauthorized copying, redistribution, resale,
 * publication, modification, or use of this source code is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

/**
 * generate.stores.import.templates.js - regenerate the stores taxonomy and product templates.
 *
 * Run: node scripts/generate.stores.import.templates.js
 *
 * Every header comes from `importCollectionSchema.js`, the same arrays the importer
 * cross-checks, so a template can never drift from the parser. Both formats are written
 * from the same row objects, which keeps the CSV and XLSX samples identical.
 */

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const Papa = require('papaparse');
const schema = require('../src/utils/importCollectionSchema');

const ROOT = path.join(__dirname, '..', 'src', 'templates', 'import_collection');

const TEMPLATES = [
  {
    name: 'store_category',
    keys: schema.storeCategorySchemaKeys,
    sample: [
      {
        key: 'smart_home',
        name: 'Smart Home',
        description: 'Connected home devices and accessories',
        icon: 'tablerHomeBolt',
        sortOrder: 25,
        parent: 'electronics',
        status: 'true',
      },
      {
        key: 'smart_lighting',
        name: 'Smart Lighting',
        description: 'App-controlled bulbs and strips',
        icon: 'tablerBulb',
        sortOrder: 26,
        parent: 'smart_home',
        status: 'true',
      },
    ],
  },
  {
    name: 'store_subcategory',
    keys: schema.storeSubcategorySchemaKeys,
    sample: [
      {
        category: 'electronics',
        key: 'smart_speakers',
        name: 'Smart Speakers',
        description: 'Voice assistants and connected speakers',
        icon: 'tablerDeviceSpeaker',
        image: '',
        sortOrder: 10,
        status: 'true',
      },
    ],
  },
  {
    name: 'store_brand',
    keys: schema.storeBrandSchemaKeys,
    sample: [
      {
        name: 'Noise',
        aliases: 'NOISE|Noise India',
        categories: 'electronics',
        subcategories: 'audio',
        originCountry: 'India',
        website: 'https://www.gonoise.com',
        description: 'Consumer audio and wearables',
        logo: '',
        banner: '',
        status: 'approved',
      },
    ],
  },
  {
    name: 'chain_product',
    keys: schema.chainProductSchemaKeys,
    sample: [
      {
        name: 'Noise Air Buds Pro',
        category: 'electronics',
        subcategory: 'audio',
        brand: 'Noise',
        description: 'True wireless earbuds with active noise cancellation',
        images: 'https://cdn.example.com/noise-air-buds-pro.jpg',
        videoUrl: '',
        basePrice: 2499,
        baseMrp: 2999,
        tax: 'inclusive',
        taxPercentage: 18,
        hsn: '85183000',
        tags: 'earbuds|bluetooth|anc',
        searchTerms: 'noise air buds tws',
        isOrganic: 'false',
        warrantyMonths: 12,
        warrantyProvider: 'Noise',
        warrantyType: 'manufacturer',
        status: 'active',
      },
    ],
  },
];

const writeCsv = (filePath, keys, rows) => {
  const header = keys.join(',');
  const body = rows.length
    ? Papa.unparse(rows, { columns: keys, header: false, newline: '\r\n' })
    : '';
  fs.writeFileSync(filePath, body ? `${header}\r\n${body}\r\n` : `${header}\r\n`, 'utf8');
};

const writeXlsx = async (filePath, keys, rows) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');

  worksheet.addRow(keys);
  worksheet.getRow(1).font = { bold: true };
  keys.forEach((key, index) => {
    worksheet.getColumn(index + 1).width = Math.max(16, key.length + 6);
  });
  rows.forEach((row) => worksheet.addRow(keys.map((key) => row[key])));

  await workbook.xlsx.writeFile(filePath);
};

const run = async () => {
  const csvDir = path.join(ROOT, 'csv');
  const xlsxDir = path.join(ROOT, 'xlsx');
  fs.mkdirSync(csvDir, { recursive: true });
  fs.mkdirSync(xlsxDir, { recursive: true });

  for (const template of TEMPLATES) {
    const emptyPath = path.join(csvDir, `${template.name}_empty.csv`);
    const samplePath = path.join(csvDir, `${template.name}_sample.csv`);
    const emptyXlsxPath = path.join(xlsxDir, `${template.name}_empty.xlsx`);
    const sampleXlsxPath = path.join(xlsxDir, `${template.name}_sample.xlsx`);

    writeCsv(emptyPath, template.keys, []);
    writeCsv(samplePath, template.keys, template.sample);
    await writeXlsx(emptyXlsxPath, template.keys, []);
    await writeXlsx(sampleXlsxPath, template.keys, template.sample);

    console.log(`wrote ${template.name} (csv + xlsx, empty + sample)`);
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
