/**
 * LocalWala - Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright (c) 2026 WeWorkLocal Private Limited
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

const fs = require('fs');
const ExcelJS = require('exceljs');
const Papa = require('papaparse');
const { status: httpStatus } = require('http-status');

/**
 * Shared CSV/XLSX transport for every bulk importer.
 *
 * The service should not know which encoding arrived; both formats produce the
 * same `{ headers, records }` shape. Keeping this in one place means a fix to
 * Excel rich-text handling applies to taxonomy and products at once.
 */

const cellText = (value) => {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text || '').join('');
    }
    if (value.text !== undefined) return String(value.text);
    if (value.result !== undefined) return String(value.result);
    if (value.error !== undefined) return '';
  }
  return String(value);
};

const isBlankRow = (row) =>
  !Object.values(row).some((value) =>
    String(value === undefined || value === null ? '' : value).trim()
  );

const parseCsv = async (filePath) => {
  let text = await fs.promises.readFile(filePath, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  });

  if (parsed.errors && parsed.errors.length) {
    throw new Error(`CSV could not be parsed: ${parsed.errors[0].message}`);
  }

  const headers = (parsed.meta && parsed.meta.fields) || [];
  const records = parsed.data.filter((row) => row && !isBlankRow(row));
  return { headers, records };
};

const parseExcel = async (filePath) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('The workbook has no worksheet');

  const columnCount = worksheet.columnCount;
  if (!columnCount) throw new Error('The worksheet has no columns');

  const headerRow = worksheet.getRow(1);
  const headers = [];
  for (let column = 1; column <= columnCount; column += 1) {
    headers.push(cellText(headerRow.getCell(column).value).trim());
  }

  const records = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const record = {};
    for (let column = 1; column <= columnCount; column += 1) {
      record[headers[column - 1]] = cellText(row.getCell(column).value);
    }
    if (!isBlankRow(record)) records.push(record);
  }

  return { headers, records };
};

const parseImportFile = (filePath, extension) => {
  if (extension === '.csv') return parseCsv(filePath);
  if (extension === '.xlsx') return parseExcel(filePath);
  return null;
};

const sendError = (res, error, fallbackStatus) => {
  const statusCode = error.statusCode || fallbackStatus || httpStatus.INTERNAL_SERVER_ERROR;
  return res.status(statusCode).send({
    code: statusCode,
    message: error.message,
    extra: '',
  });
};

module.exports = {
  cellText,
  isBlankRow,
  parseCsv,
  parseExcel,
  parseImportFile,
  sendError,
};
