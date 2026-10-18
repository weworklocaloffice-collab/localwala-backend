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
const { DateTime } = require('luxon');
const catchAsync = require('../utils/catchAsync');
const pick = require('../utils/pick');
const { disbursementService, cityService, withdrawalMethodService } = require('../services');

const create = catchAsync(async (req, res) => {
  const result = await disbursementService.createDisbursement(req.body);
  res.send(result);
});

const get = catchAsync(async (req, res) => {
  const result = await disbursementService.getDisbursement();
  res.send(result);
});

const update = catchAsync(async (req, res) => {
  const result = await disbursementService.updateDisbursement(req.params.disbursementId, req.body);
  res.send(result);
});

const restaurantDisbursement = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'status', 'limit', 'page']);
  const result = await disbursementService.restaurantDisbursement(options);
  res.send(result);
});

const deliverymanDisbursement = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'status', 'limit', 'page']);
  const result = await disbursementService.deliverymanDisbursement(options);
  res.send(result);
});

const restaurantDisbursementReport = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await disbursementService.restaurantDisbursementReport(id);
  res.send(result);
});

const deliverymanDisbursementReport = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await disbursementService.deliverymanDisbursementReport(id);
  res.send(result);
});

const restaurantDisbursementDetail = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await disbursementService.restaurantDisbursementDetail(id);
  res.send(result);
});

const deliverymanDisbursementDetail = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await disbursementService.deliverymanDisbursementDetail(id);
  res.send(result);
});

const acceptRestaurantDisburment = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await disbursementService.acceptRestaurantDisburment(id);
  res.send(result);
});

const rejectRestaurantDisburment = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await disbursementService.rejectRestaurantDisburment(id);
  res.send(result);
});

const acceptDeliverymanDisbursment = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await disbursementService.acceptDeliverymanDisbursment(id);
  res.send(result);
});

const rejectDeliverymanDisbursment = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await disbursementService.rejectDeliverymanDisbursment(id);
  res.send(result);
});

const disbursementTransactionInitial = catchAsync(async (req, res) => {
  const cities = await cityService.listAllCities();
  const methods = await withdrawalMethodService.listAllWithdrawalMethod();
  const stats = await disbursementService.restaurantDisbursementAmounts();
  res.send({ stats, cities, methods, success: true });
});

const restaurantDisbursementTransactionReport = catchAsync(async (req, res) => {
  const options = pick(req.query, [
    'restaurant',
    'filter',
    'filterDates',
    'payment',
    'status',
    'search',
    'limit',
    'page',
  ]);
  const result = await disbursementService.restaurantDisbursementTransactionReport(options);
  res.send(result);
});

const deliverymanDisbursementTransactionInitial = catchAsync(async (req, res) => {
  const cities = await cityService.listAllCities();
  const methods = await withdrawalMethodService.listAllWithdrawalMethod();
  const stats = await disbursementService.deliverymanDisbursementAmounts();
  res.send({ stats, cities, methods, success: true });
});

const deliverymanDisbursementTransactionReport = catchAsync(async (req, res) => {
  const options = pick(req.query, [
    'filter',
    'filterDates',
    'payment',
    'status',
    'search',
    'limit',
    'page',
  ]);
  const result = await disbursementService.deliverymanDisbursementTransactionReport(options);
  res.send(result);
});

const vendorDisbursementList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'limit', 'page']);
  const result = await disbursementService.vendorDisbursementList(options);
  res.send(result);
});

const deliverymanDisbursementList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['deliveryman', 'limit', 'page']);
  const result = await disbursementService.deliverymanDisbursementList(options);
  res.send(result);
});

const cityzenRestaurantDisbursement = catchAsync(async (req, res) => {
  const { master } = req.params;
  const options = pick(req.query, ['status', 'limit', 'page', 'search']);
  const result = await disbursementService.cityzenRestaurantDisbursement(master, options);
  res.send(result);
});

const cityzenDeliverymanDisbursement = catchAsync(async (req, res) => {
  const { master } = req.params;
  const options = pick(req.query, ['status', 'limit', 'page', 'search']);
  const result = await disbursementService.cityzenDeliverymanDisbursement(master, options);
  res.send(result);
});

const exportRestaurantCollection = catchAsync(async (req, res) => {
  const { type, status } = req.params;
  if (type !== 'raw') {
    const result = await disbursementService.exportRestaurantCollection(status);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('RestaurantDisbursement');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Report No', key: 'disbursementNo' },
        { header: 'Report Amount', key: 'totalAmount' },
        { header: 'Generated At', key: 'createdAt' },
        { header: 'Generated Time', key: 'generatedTime' },
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
        'Report No': detail.disbursementNo,
        'Report Amount': detail.totalAmount,
        'Generated At': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
        'Generated Time': detail.generatedTime,
        Status: detail.status,
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await disbursementService.exportRestaurantRawCollection(status);
    const downloadPath = path.join(
      __dirname,
      `../templates/downloads/restaurantdisbursementdatas.json`
    );
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'restaurantdisbursementdatas.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportDeliverymanCollection = catchAsync(async (req, res) => {
  const { type, status } = req.params;
  if (type !== 'raw') {
    const result = await disbursementService.exportDeliverymanCollection(status);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('RestaurantDisbursement');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Report No', key: 'disbursementNo' },
        { header: 'Report Amount', key: 'totalAmount' },
        { header: 'Generated At', key: 'createdAt' },
        { header: 'Generated Time', key: 'generatedTime' },
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
        'Report No': detail.disbursementNo,
        'Report Amount': detail.totalAmount,
        'Generated At': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
        'Generated Time': detail.generatedTime,
        Status: detail.status,
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await disbursementService.exportDeliverymanRawCollection(status);
    const downloadPath = path.join(
      __dirname,
      `../templates/downloads/deliverymandisbursementdatas.json`
    );
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'deliverymandisbursementdatas.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportRestaurantDisbursementCollection = catchAsync(async (req, res) => {
  const { type, id } = req.params;
  if (type !== 'raw') {
    const result = await disbursementService.exportRestaurantDisbursementCollection(id);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
        restaurantId:
          detail &&
          detail.restaurant &&
          detail.restaurant.id &&
          detail.restaurant.id !== null &&
          detail.restaurant.id !== ''
            ? detail.restaurant.id
            : '-',
        restaurantName:
          detail &&
          detail.restaurant &&
          detail.restaurant.name &&
          detail.restaurant.name !== null &&
          detail.restaurant.name !== ''
            ? detail.restaurant.name
            : '-',
        withdrawalMethodId:
          detail &&
          detail.withdrawalMethodDetail &&
          detail.withdrawalMethodDetail.id &&
          detail.withdrawalMethodDetail.id !== null &&
          detail.withdrawalMethodDetail.id !== ''
            ? detail.withdrawalMethodDetail.id
            : '-',
        withdrawalMethodName:
          detail &&
          detail.withdrawalMethodDetail &&
          detail.withdrawalMethodDetail.name &&
          detail.withdrawalMethodDetail.name !== null &&
          detail.withdrawalMethodDetail.name !== ''
            ? detail.withdrawalMethodDetail.name
            : '-',
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('RestaurantDisbursement');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Disbursement Id', key: 'disbursementId' },
        { header: 'Payout Method', key: 'restaurantPayoutMethod' },
        { header: 'Restaurant Id', key: 'restaurantId' },
        { header: 'Restaurant Name', key: 'restaurantName' },
        { header: 'Withdrawal Id', key: 'withdrawalMethodId' },
        { header: 'Withdrawal Name', key: 'withdrawalMethodName' },
        { header: 'Amount', key: 'amount' },
        { header: 'Created At', key: 'createdAt' },
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
        'Disbursement Id': detail.disbursementId,
        'Payout Method': detail.restaurantPayoutMethod,
        'Restaurant Id':
          detail &&
          detail.restaurant &&
          detail.restaurant.id &&
          detail.restaurant.id !== null &&
          detail.restaurant.id !== ''
            ? detail.restaurant.id
            : '-',
        'Restaurant Name':
          detail &&
          detail.restaurant &&
          detail.restaurant.name &&
          detail.restaurant.name !== null &&
          detail.restaurant.name !== ''
            ? detail.restaurant.name
            : '-',
        'Withdrawal Id':
          detail &&
          detail.withdrawalMethodDetail &&
          detail.withdrawalMethodDetail.id &&
          detail.withdrawalMethodDetail.id !== null &&
          detail.withdrawalMethodDetail.id !== ''
            ? detail.withdrawalMethodDetail.id
            : '-',
        'Withdrawal Name':
          detail &&
          detail.withdrawalMethodDetail &&
          detail.withdrawalMethodDetail.name &&
          detail.withdrawalMethodDetail.name !== null &&
          detail.withdrawalMethodDetail.name !== ''
            ? detail.withdrawalMethodDetail.name
            : '-',
        Amount: detail.amount,
        'Created At': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
        Status: detail.status,
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await disbursementService.exportRestaurantDisbursementRawCollection(id);
    const downloadPath = path.join(
      __dirname,
      `../templates/downloads/restaurantdisbursements.json`
    );
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'restaurantdisbursements.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportDeliverymanDisbursementCollection = catchAsync(async (req, res) => {
  const { type, id } = req.params;
  if (type !== 'raw') {
    const result = await disbursementService.exportDeliverymanDisbursementCollection(id);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
        deliverymanId:
          detail &&
          detail.driverInfo &&
          detail.driverInfo.id &&
          detail.driverInfo.id !== null &&
          detail.driverInfo.id !== ''
            ? detail.driverInfo.id
            : '-',
        deliverymanFirstName:
          detail &&
          detail.driverInfo &&
          detail.driverInfo.firstName &&
          detail.driverInfo.firstName !== null &&
          detail.driverInfo.firstName !== ''
            ? detail.driverInfo.firstName
            : '-',
        deliverymanLastName:
          detail &&
          detail.driverInfo &&
          detail.driverInfo.lastName &&
          detail.driverInfo.lastName !== null &&
          detail.driverInfo.lastName !== ''
            ? detail.driverInfo.lastName
            : '-',
        withdrawalMethodId:
          detail &&
          detail.withdrawalMethodDetail &&
          detail.withdrawalMethodDetail.id &&
          detail.withdrawalMethodDetail.id !== null &&
          detail.withdrawalMethodDetail.id !== ''
            ? detail.withdrawalMethodDetail.id
            : '-',
        withdrawalMethodName:
          detail &&
          detail.withdrawalMethodDetail &&
          detail.withdrawalMethodDetail.name &&
          detail.withdrawalMethodDetail.name !== null &&
          detail.withdrawalMethodDetail.name !== ''
            ? detail.withdrawalMethodDetail.name
            : '-',
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('DeliverymanDisbursement');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Disbursement Id', key: 'disbursementId' },
        { header: 'Payout Method', key: 'deliverymanPayoutMethod' },
        { header: 'Deliveryman Id', key: 'deliverymanId' },
        { header: 'Deliveryman FirstName', key: 'deliverymanFirstName' },
        { header: 'Deliveryman LastName', key: 'deliverymanLastName' },
        { header: 'Withdrawal Id', key: 'withdrawalMethodId' },
        { header: 'Withdrawal Name', key: 'withdrawalMethodName' },
        { header: 'Amount', key: 'amount' },
        { header: 'Created At', key: 'createdAt' },
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
        'Disbursement Id': detail.disbursementId,
        'Payout Method': detail.deliverymanPayoutMethod,
        'Deliveryman Id':
          detail &&
          detail.driverInfo &&
          detail.driverInfo.id &&
          detail.driverInfo.id !== null &&
          detail.driverInfo.id !== ''
            ? detail.driverInfo.id
            : '-',
        'Deliveryman FirstName':
          detail &&
          detail.driverInfo &&
          detail.driverInfo.firstName &&
          detail.driverInfo.firstName !== null &&
          detail.driverInfo.firstName !== ''
            ? detail.driverInfo.firstName
            : '-',
        'Deliveryman LastName':
          detail &&
          detail.driverInfo &&
          detail.driverInfo.lastName &&
          detail.driverInfo.lastName !== null &&
          detail.driverInfo.lastName !== ''
            ? detail.driverInfo.lastName
            : '-',
        'Withdrawal Id':
          detail &&
          detail.withdrawalMethodDetail &&
          detail.withdrawalMethodDetail.id &&
          detail.withdrawalMethodDetail.id !== null &&
          detail.withdrawalMethodDetail.id !== ''
            ? detail.withdrawalMethodDetail.id
            : '-',
        'Withdrawal Name':
          detail &&
          detail.withdrawalMethodDetail &&
          detail.withdrawalMethodDetail.name &&
          detail.withdrawalMethodDetail.name !== null &&
          detail.withdrawalMethodDetail.name !== ''
            ? detail.withdrawalMethodDetail.name
            : '-',
        Amount: detail.amount,
        'Created At': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
        Status: detail.status,
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await disbursementService.exportDeliverymanDisbursementRawCollection(id);
    const downloadPath = path.join(
      __dirname,
      `../templates/downloads/deliverymandisbursements.json`
    );
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'deliverymandisbursements.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportRestaurantDisbursementReportCollection = catchAsync(async (req, res) => {
  const options = pick(req.query, [
    'restaurant',
    'filter',
    'filterDates',
    'payment',
    'status',
    'search',
  ]);
  const { type } = req.query;
  if (type !== 'raw') {
    const result = await disbursementService.exportRestaurantDisbursementReportCollection(options);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        restaurantId:
          detail &&
          detail.restaurant &&
          detail.restaurant.id &&
          detail.restaurant.id !== null &&
          detail.restaurant.id !== ''
            ? detail.restaurant.id
            : '-',
        restaurantName:
          detail &&
          detail.restaurant &&
          detail.restaurant.name &&
          detail.restaurant.name !== null &&
          detail.restaurant.name !== ''
            ? detail.restaurant.name
            : '-',
        disbursementId:
          detail &&
          detail.disbursement &&
          detail.disbursement.id &&
          detail.disbursement.id !== null &&
          detail.disbursement.id !== ''
            ? detail.disbursement.id
            : '-',
        disbursementNo:
          detail &&
          detail.disbursement &&
          detail.disbursement.disbursementNo &&
          detail.disbursement.disbursementNo !== null &&
          detail.disbursement.disbursementNo !== ''
            ? detail.disbursement.disbursementNo
            : '-',
        methodId:
          detail &&
          detail.withdrawalMethodDetail &&
          detail.withdrawalMethodDetail.id &&
          detail.withdrawalMethodDetail.id !== null &&
          detail.withdrawalMethodDetail.id !== ''
            ? detail.withdrawalMethodDetail.id
            : '-',
        methodName:
          detail &&
          detail.withdrawalMethodDetail &&
          detail.withdrawalMethodDetail.name &&
          detail.withdrawalMethodDetail.name !== null &&
          detail.withdrawalMethodDetail.name !== ''
            ? detail.withdrawalMethodDetail.name
            : '-',
        createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('RestaurantDisbursementReport');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Disbursement Id', key: 'disbursementId' },
        { header: 'Disbursement Number', key: 'disbursementNo' },
        { header: 'Withdrawal Method Id', key: 'methodId' },
        { header: 'Withdrawal Method Name', key: 'methodName' },
        { header: 'Restaurant Id', key: 'restaurantId' },
        { header: 'Restaurant Name', key: 'restaurantName' },
        { header: 'Payout Method', key: 'restaurantPayoutMethod' },
        { header: 'Amount', key: 'amount' },
        { header: 'Status', key: 'status' },
        { header: 'Created At', key: 'createdAt' },
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
        'Disbursement Id':
          detail &&
          detail.disbursement &&
          detail.disbursement.id &&
          detail.disbursement.id !== null &&
          detail.disbursement.id !== ''
            ? detail.disbursement.id
            : '-',
        'Disbursement Number':
          detail &&
          detail.disbursement &&
          detail.disbursement.disbursementNo &&
          detail.disbursement.disbursementNo !== null &&
          detail.disbursement.disbursementNo !== ''
            ? detail.disbursement.disbursementNo
            : '-',
        'Withdrawal Method Id':
          detail &&
          detail.withdrawalMethodDetail &&
          detail.withdrawalMethodDetail.id &&
          detail.withdrawalMethodDetail.id !== null &&
          detail.withdrawalMethodDetail.id !== ''
            ? detail.withdrawalMethodDetail.id
            : '-',
        'Withdrawal Method Name':
          detail &&
          detail.withdrawalMethodDetail &&
          detail.withdrawalMethodDetail.name &&
          detail.withdrawalMethodDetail.name !== null &&
          detail.withdrawalMethodDetail.name !== ''
            ? detail.withdrawalMethodDetail.name
            : '-',
        'Restaurant Id':
          detail &&
          detail.restaurant &&
          detail.restaurant.id &&
          detail.restaurant.id !== null &&
          detail.restaurant.id !== ''
            ? detail.restaurant.id
            : '-',
        'Restaurant Name':
          detail &&
          detail.restaurant &&
          detail.restaurant.name &&
          detail.restaurant.name !== null &&
          detail.restaurant.name !== ''
            ? detail.restaurant.name
            : '-',
        'Payout Method': detail.restaurantPayoutMethod,
        Amount: detail.amount,
        Status: detail.status,
        'Created At': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result =
      await disbursementService.exportRestaurantDisbursementReportRawCollection(options);
    const downloadPath = path.join(
      __dirname,
      `../templates/downloads/restaurantdisbursements.json`
    );
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'restaurantdisbursements.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportDeliverymanDisbursementReportCollection = catchAsync(async (req, res) => {
  const { type } = req.query;
  const options = pick(req.query, ['filter', 'filterDates', 'payment', 'status', 'search']);
  if (type !== 'raw') {
    const result = await disbursementService.exportDeliverymanDisbursementReportCollection(options);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        driverId:
          detail &&
          detail.driverInfo &&
          detail.driverInfo.id &&
          detail.driverInfo.id !== null &&
          detail.driverInfo.id !== ''
            ? detail.driverInfo.id
            : '-',
        driverFirstName:
          detail &&
          detail.driverInfo &&
          detail.driverInfo.firstName &&
          detail.driverInfo.firstName !== null &&
          detail.driverInfo.firstName !== ''
            ? detail.driverInfo.firstName
            : '-',
        driverLastName:
          detail &&
          detail.driverInfo &&
          detail.driverInfo.lastName &&
          detail.driverInfo.lastName !== null &&
          detail.driverInfo.lastName !== ''
            ? detail.driverInfo.lastName
            : '-',
        driverRole:
          detail &&
          detail.driverInfo &&
          detail.driverInfo.role &&
          detail.driverInfo.role !== null &&
          detail.driverInfo.role !== ''
            ? detail.driverInfo.role
            : '-',
        disbursementId:
          detail &&
          detail.disbursement &&
          detail.disbursement.id &&
          detail.disbursement.id !== null &&
          detail.disbursement.id !== ''
            ? detail.disbursement.id
            : '-',
        disbursementNo:
          detail &&
          detail.disbursement &&
          detail.disbursement.disbursementNo &&
          detail.disbursement.disbursementNo !== null &&
          detail.disbursement.disbursementNo !== ''
            ? detail.disbursement.disbursementNo
            : '-',
        methodId:
          detail &&
          detail.withdrawalMethodDetail &&
          detail.withdrawalMethodDetail.id &&
          detail.withdrawalMethodDetail.id !== null &&
          detail.withdrawalMethodDetail.id !== ''
            ? detail.withdrawalMethodDetail.id
            : '-',
        methodName:
          detail &&
          detail.withdrawalMethodDetail &&
          detail.withdrawalMethodDetail.name &&
          detail.withdrawalMethodDetail.name !== null &&
          detail.withdrawalMethodDetail.name !== ''
            ? detail.withdrawalMethodDetail.name
            : '-',
        createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('DeliverymanDisbursementReport');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Disbursement Id', key: 'disbursementId' },
        { header: 'Disbursement Number', key: 'disbursementNo' },
        { header: 'Withdrawal Method Id', key: 'methodId' },
        { header: 'Withdrawal Method Name', key: 'methodName' },
        { header: 'Deliveryman Id', key: 'driverId' },
        { header: 'Deliveryman FirstName', key: 'driverFirstName' },
        { header: 'Deliveryman LastName', key: 'driverLastName' },
        { header: 'Deliveryman Role', key: 'driverRole' },
        { header: 'Payout Method', key: 'deliverymanPayoutMethod' },
        { header: 'Amount', key: 'amount' },
        { header: 'Status', key: 'status' },
        { header: 'Created At', key: 'createdAt' },
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
        'Disbursement Id':
          detail &&
          detail.disbursement &&
          detail.disbursement.id &&
          detail.disbursement.id !== null &&
          detail.disbursement.id !== ''
            ? detail.disbursement.id
            : '-',
        'Disbursement Number':
          detail &&
          detail.disbursement &&
          detail.disbursement.disbursementNo &&
          detail.disbursement.disbursementNo !== null &&
          detail.disbursement.disbursementNo !== ''
            ? detail.disbursement.disbursementNo
            : '-',
        'Withdrawal Method Id':
          detail &&
          detail.withdrawalMethodDetail &&
          detail.withdrawalMethodDetail.id &&
          detail.withdrawalMethodDetail.id !== null &&
          detail.withdrawalMethodDetail.id !== ''
            ? detail.withdrawalMethodDetail.id
            : '-',
        'Withdrawal Method Name':
          detail &&
          detail.withdrawalMethodDetail &&
          detail.withdrawalMethodDetail.name &&
          detail.withdrawalMethodDetail.name !== null &&
          detail.withdrawalMethodDetail.name !== ''
            ? detail.withdrawalMethodDetail.name
            : '-',
        'Deliveryman Id':
          detail &&
          detail.driverInfo &&
          detail.driverInfo.id &&
          detail.driverInfo.id !== null &&
          detail.driverInfo.id !== ''
            ? detail.driverInfo.id
            : '-',
        'Deliveryman FirstName':
          detail &&
          detail.driverInfo &&
          detail.driverInfo.firstName &&
          detail.driverInfo.firstName !== null &&
          detail.driverInfo.firstName !== ''
            ? detail.driverInfo.firstName
            : '-',
        'Deliveryman LastName':
          detail &&
          detail.driverInfo &&
          detail.driverInfo.lastName &&
          detail.driverInfo.lastName !== null &&
          detail.driverInfo.lastName !== ''
            ? detail.driverInfo.lastName
            : '-',
        'Deliveryman Role':
          detail &&
          detail.driverInfo &&
          detail.driverInfo.role &&
          detail.driverInfo.role !== null &&
          detail.driverInfo.role !== ''
            ? detail.driverInfo.role
            : '-',
        'Payout Method': detail.deliverymanPayoutMethod,
        Amount: detail.amount,
        Status: detail.status,
        'Created At': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result =
      await disbursementService.exportDeliverymanDisbursementReportRawCollection(options);
    const downloadPath = path.join(
      __dirname,
      `../templates/downloads/deliverymandisbursements.json`
    );
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'deliverymandisbursements.json', (err) => {
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
  create,
  get,
  update,
  restaurantDisbursement,
  deliverymanDisbursement,
  restaurantDisbursementReport,
  deliverymanDisbursementReport,
  restaurantDisbursementDetail,
  deliverymanDisbursementDetail,
  acceptRestaurantDisburment,
  rejectRestaurantDisburment,
  acceptDeliverymanDisbursment,
  rejectDeliverymanDisbursment,
  disbursementTransactionInitial,
  restaurantDisbursementTransactionReport,
  deliverymanDisbursementTransactionInitial,
  deliverymanDisbursementTransactionReport,
  vendorDisbursementList,
  deliverymanDisbursementList,
  cityzenRestaurantDisbursement,
  cityzenDeliverymanDisbursement,
  exportRestaurantCollection,
  exportDeliverymanCollection,
  exportRestaurantDisbursementCollection,
  exportDeliverymanDisbursementCollection,
  exportRestaurantDisbursementReportCollection,
  exportDeliverymanDisbursementReportCollection,
};

