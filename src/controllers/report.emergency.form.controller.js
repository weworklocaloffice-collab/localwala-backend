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

const ExcelJS = require('exceljs');
const Papa = require('papaparse');
const fs = require('fs');
const path = require('path');
const catchAsync = require('../utils/catchAsync');
const pick = require('../utils/pick');
const { reportEmergencyFormService, emailConfigService } = require('../services');

const saveReportEmergency = catchAsync(async (req, res) => {
  const result = await reportEmergencyFormService.saveReportEmergency(req.body);
  res.send(result);
});

const reportEmergencyListAdmin = catchAsync(async (req, res) => {
  const options = pick(req.query, ['status', 'limit', 'page', 'search']);
  const result = await reportEmergencyFormService.reportEmergencyListAdmin(options);
  res.send(result);
});

const drop = catchAsync(async (req, res) => {
  const { id } = req.params;
  await reportEmergencyFormService.deleteReportEmergencyFormById(id);
  res.send({ success: true });
});

const update = catchAsync(async (req, res) => {
  const { id, email, text } = req.body;
  const result = await reportEmergencyFormService.updateReportEmergencyFormByID(id);
  if (result && result !== null && result.success === true) {
    emailConfigService.sendThankYouReplayForReportEmergency(email, text);
  }
  res.send(result);
});

const exportCollection = catchAsync(async (req, res) => {
  const { type, status, search } = req.query;
  const statusName = status === true || status === 'true';
  if (type !== 'raw') {
    const result = await reportEmergencyFormService.exportCollection(statusName, search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        status: detail.status ? 'New' : 'Resolved',
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('ReportEmergency');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Full Name', key: 'userName' },
        { header: 'Country Code', key: 'userCountryCode' },
        { header: 'Mobile', key: 'userContact' },
        { header: 'Email', key: 'userEmail' },
        { header: 'Short Description', key: 'shortDescription' },
        { header: 'Type', key: 'type' },
        { header: 'Status', key: 'status' },
      ];

      worksheet.addRows(mappedResult);

      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.font = {
            name: 'Verdana',
            size: 12,
            color: { argb: 'FF000000' }, // Black text
          };
          cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 3 };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFFFFF' }, // White background
          };
        });
      });

      const headerRow = worksheet.getRow(1);

      headerRow.eachCell((cell) => {
        cell.font = {
          name: 'Verdana',
          size: 12,
          bold: true,
          color: { argb: 'FF000000' },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 3 };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFDCE6F1' }, // Optional
        };
      });

      worksheet.columns.forEach((column) => {
        let maxLength = 0;

        column.eachCell({ includeEmpty: true }, (cell) => {
          let columnLength = 0;

          if (cell.value) {
            const rawValue =
              typeof cell.value === 'object' && cell.value.richText
                ? cell.value.richText.map((rt) => rt.text).join('')
                : cell.value.toString();

            // Account for line breaks and longest line in multi-line cells
            const lines = rawValue.split('\n');
            columnLength = Math.max(...lines.map((line) => line.length));
          }

          if (columnLength > maxLength) {
            maxLength = columnLength;
          }
        });

        column.width = maxLength + 10; // Add some padding
      });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename=users.xlsx');

      await workbook.xlsx.write(res);
      res.end();
    } else {
      const fieldItems = result.map((detail, index) => ({
        'S. No.': index + 1,
        Id: detail.id,
        'Full Name': detail.userName,
        'Country Code': detail.userCountryCode,
        Mobile: detail.userContact,
        Email: detail.userEmail,
        'Short Description': detail.shortDescription,
        Type: detail.type,
        Status: detail.status ? 'New' : 'Resolved',
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await reportEmergencyFormService.exportRawCollection(statusName, search);
    const downloadPath = path.join(__dirname, `../templates/downloads/reportemergencyforms.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'reportemergencyforms.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

module.exports = {
  saveReportEmergency,
  reportEmergencyListAdmin,
  drop,
  update,
  exportCollection,
};

