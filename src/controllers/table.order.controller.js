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

const { status: httpStatus } = require('http-status');
const multer = require('multer');
const ExcelJS = require('exceljs');
const Papa = require('papaparse');
const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');
const catchAsync = require('../utils/catchAsync');
const pick = require('../utils/pick');
const { tableOrderService } = require('../services');
const uploadMiddleware = require('../middlewares/upload');
const config = require('../config/config');
const { vendorTableOrderSchameKeys } = require('../utils/importCollectionSchema');

const getTableOrderOfVendor = catchAsync(async (req, res) => {
  const { vendor } = req.params;
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const result = await tableOrderService.getTableOrderOfVendor(vendor, options);
  res.send(result);
});

const adminTableOrderList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await tableOrderService.adminTableOrderList(options);
  res.send(result);
});

const cityzenTableOrderList = catchAsync(async (req, res) => {
  const { master } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await tableOrderService.cityzenTableOrderList(master, options);
  res.send(result);
});

const getTableOrderDetail = catchAsync(async (req, res) => {
  const { id, vendor } = req.params;
  const result = await tableOrderService.getTableOrderDetail(id, vendor);
  res.send(result);
});

const adminTableOrderDetail = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await tableOrderService.adminTableOrderDetail(id);
  res.send(result);
});

const cityzenTableOrderDetail = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await tableOrderService.cityzenTableOrderDetail(id);
  res.send(result);
});

const vendorTableOrderBusinessInsight = catchAsync(async (req, res) => {
  const { vendor } = req.params;
  const result = await tableOrderService.vendorTableOrderBusinessInsight(vendor);
  res.send(result);
});

const vendorCustomDateTableOrderBusinessInsight = catchAsync(async (req, res) => {
  const { vendor, startDate, endDate } = req.body;
  const result = await tableOrderService.vendorCustomDateTableOrderBusinessInsight(
    vendor,
    startDate,
    endDate
  );
  res.send(result);
});

const tableOrderReport = catchAsync(async (req, res) => {
  const options = pick(req.query, [
    'restaurant',
    'filter',
    'filterDates',
    'limit',
    'page',
    'search',
  ]);
  const result = await tableOrderService.tableOrderReport(options);
  res.send(result);
});

const vendorTableOrderList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'limit', 'page']);
  const result = await tableOrderService.vendorTableOrderList(options);
  res.send(result);
});

const adminTableOrderInvoice = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await tableOrderService.adminTableOrderInvoice(id);
  res.send(result);
});

const vendorTableOrderInvoice = catchAsync(async (req, res) => {
  const { id, vendor } = req.params;
  const result = await tableOrderService.vendorTableOrderInvoice(id, vendor);
  res.send(result);
});

const exportCollection = catchAsync(async (req, res) => {
  const { type, search } = req.query;
  if (type !== 'raw') {
    const result = await tableOrderService.exportCollection(search);
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
        createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
        status: detail.status ? 'Completed' : 'Pending',
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('TableOrders');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Order No', key: 'orderNo' },
        { header: 'Restaurant Id', key: 'restaurantId' },
        { header: 'Restaurant Name', key: 'restaurantName' },
        { header: 'Customer Type', key: 'customerType' },
        { header: 'Customer Name', key: 'customerName' },
        { header: 'Customer Country Code', key: 'customerCountryCode' },
        { header: 'Customer Mobile Number', key: 'customerMobileNumber' },
        { header: 'Grand Total', key: 'grandTotal' },
        { header: 'Total Earning', key: 'totalEarning' },
        { header: 'Real Total', key: 'realTotal' },
        { header: 'Item Total', key: 'itemTotal' },
        { header: 'Discount Type', key: 'discountType' },
        { header: 'Item Discount', key: 'itemDiscount' },
        { header: 'Discount Amount', key: 'discountAmount' },
        { header: 'Discount Charge', key: 'discountCharge' },
        { header: 'Food Service Charge', key: 'foodServiceCharge' },
        { header: 'Service Charge', key: 'serviceCharge' },
        { header: 'Package Charge', key: 'packageCharge' },
        { header: 'Package Charge Tax', key: 'packageChargeTax' },
        { header: 'Waiter Tip', key: 'waiterTip' },
        { header: 'Extra Charge', key: 'extraCharge' },
        { header: 'Restaurant Commission', key: 'restaurantCommission' },
        { header: 'Payment Mode', key: 'paymentMode' },
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
        'Order No': detail.orderNo,
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
        'Customer Type': detail.customerType,
        'Customer Name': detail.customerName,
        'Customer Country Code': detail.customerCountryCode,
        'Customer Mobile Number': detail.customerMobileNumber,
        'Grand Total': detail.grandTotal,
        'Total Earning': detail.totalEarning,
        'Real Total': detail.realTotal,
        'Item Total': detail.itemTotal,
        'Discount Type': detail.discountType,
        'Item Discount': detail.itemDiscount,
        'Discount Amount': detail.discountAmount,
        'Discount Charge': detail.discountCharge,
        'Food Service Charge': detail.foodServiceCharge,
        'Service Charge': detail.serviceCharge,
        'Package Charge': detail.packageCharge,
        'Package Charge Tax': detail.packageChargeTax,
        'Waiter Tip': detail.waiterTip,
        'Extra Charge': detail.extraCharge,
        'Restaurant Commission': detail.restaurantCommission,
        'Payment Mode': detail.paymentMode,
        'Created At': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
        Status: detail.status ? 'Completed' : 'Pending',
      }));

      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await tableOrderService.exportRawCollection(search);
    const downloadPath = path.join(__dirname, `../templates/downloads/tableorders.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'tableorders.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportTableOrderReportCollection = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'filter', 'filterDates', 'search']);
  const { type } = req.query;
  const result = await tableOrderService.exportTableOrderReportCollection(options);
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
          : 'Unknonwn',
      restaurantName:
        detail &&
        detail.restaurant &&
        detail.restaurant.name &&
        detail.restaurant.name !== null &&
        detail.restaurant.name !== ''
          ? detail.restaurant.name
          : 'Unknonwn',
      customerName:
        detail && detail.customerName && detail.customerName !== 'none' ? detail.customerName : '-',
      customerMobileNumber:
        detail && detail.customerName && detail.customerName !== 'none'
          ? detail.customerMobileNumber
          : '-',
      customerCountryCode:
        detail && detail.customerName && detail.customerName !== 'none'
          ? detail.customerCountryCode
          : '-',
      createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
    }));
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('TableOrders');
    worksheet.columns = [
      { header: 'S. No.', key: 'serial' },
      { header: 'Id', key: 'id' },
      { header: 'Order No', key: 'orderNo' },
      { header: 'Restaurant Id', key: 'restaurantId' },
      { header: 'Restaurant Name', key: 'restaurantName' },
      { header: 'Payment Mode', key: 'paymentMode' },
      { header: 'Customer Type', key: 'customerType' },
      { header: 'Customer Name', key: 'customerName' },
      { header: 'Customer Country Code', key: 'customerCountryCode' },
      { header: 'Customer Mobile Number', key: 'customerMobileNumber' },
      { header: 'Discount Type', key: 'discountType' },
      { header: 'Restaurant Commission', key: 'restaurantCommission' },
      { header: 'Real Total', key: 'realTotal' },
      { header: 'Item Total', key: 'itemTotal' },
      { header: 'Item Discount', key: 'itemDiscount' },
      { header: 'Discount Amount', key: 'discountAmount' },
      { header: 'Discount Charge', key: 'discountCharge' },
      { header: 'Food Service Charge', key: 'foodServiceCharge' },
      { header: 'Service Charge', key: 'serviceCharge' },
      { header: 'Package Charge', key: 'packageCharge' },
      { header: 'Package Charge Tax', key: 'packageChargeTax' },
      { header: 'Waiter Tip', key: 'waiterTip' },
      { header: 'Extra Charge', key: 'extraCharge' },
      { header: 'GrandTotal', key: 'grandTotal' },
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
      'Order No': detail.orderNo,
      'Restaurant Id':
        detail &&
        detail.restaurant &&
        detail.restaurant.id &&
        detail.restaurant.id !== null &&
        detail.restaurant.id !== ''
          ? detail.restaurant.id
          : 'Unknonwn',
      'Restaurant Name':
        detail &&
        detail.restaurant &&
        detail.restaurant.name &&
        detail.restaurant.name !== null &&
        detail.restaurant.name !== ''
          ? detail.restaurant.name
          : 'Unknonwn',
      'Payment Mode': detail.paymentMode,
      'Customer Type': detail.customerType,
      'Customer Name':
        detail && detail.customerName && detail.customerName !== 'none' ? detail.customerName : '-',
      'Customer Country Code':
        detail && detail.customerName && detail.customerName !== 'none'
          ? detail.customerCountryCode
          : '-',
      'Customer Mobile Number':
        detail && detail.customerName && detail.customerName !== 'none'
          ? detail.customerMobileNumber
          : '-',
      'Discount Type': detail.discountType,
      'Restaurant Commission': detail.restaurantCommission,
      'Real Total': detail.realTotal,
      'Item Total': detail.itemTotal,
      'Item Discount': detail.itemDiscount,
      'Discount Amount': detail.discountAmount,
      'Discount Charge': detail.discountCharge,
      'Food Service Charge': detail.foodServiceCharge,
      'Service Charge': detail.serviceCharge,
      'Package Charge': detail.packageCharge,
      'Package Charge Tax': detail.packageChargeTax,
      'Waiter Tip': detail.waiterTip,
      'Extra Charge': detail.extraCharge,
      GrandTotal: detail.grandTotal,
      'Created At': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
    }));
    const csv = Papa.unparse(fieldItems);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
    res.send(csv);
  }
});

const importCollection = catchAsync(async (req, res) => {
  try {
    const upload = uploadMiddleware('local');
    upload.single('file')(req, res, async (err) => {
      if (!err) {
        if (req.file) {
          const ext = path.extname(req.file.originalname).toLowerCase();
          const { file } = req;
          if (req.body.type === 'excel' && ext === '.xlsx') {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(file.path);
            const worksheet = workbook.worksheets[0];
            const records = [];
            const headerRow = worksheet.getRow(1).values.slice(1);
            worksheet.eachRow((row, rowNumber) => {
              if (rowNumber === 1) return;

              const rowValues = row.values.slice(1);
              const obj = {};
              headerRow.forEach((header, index) => {
                obj[header] = rowValues[index];
              });

              records.push(obj);
            });
            fs.unlinkSync(file.path);
            const importKeys = [...new Set(records.flatMap(Object.keys))];
            const validSchema =
              importKeys.length === vendorTableOrderSchameKeys.length &&
              importKeys.every((item) => vendorTableOrderSchameKeys.includes(item));
            if (validSchema) {
              const result = await tableOrderService.importCollection(records);
              res.send(result);
            } else {
              res.status(400).send({ code: 400, message: 'Validation failed', extra: '' });
            }
          } else if (req.body.type === 'csv' && ext === '.csv') {
            const fileStream = fs.createReadStream(file.path);
            Papa.parse(fileStream, {
              header: true,
              skipEmptyLines: true,
              complete: async (results) => {
                try {
                  const records = results.data;
                  fs.unlinkSync(file.path);
                  const importKeys = [...new Set(records.flatMap(Object.keys))];
                  const validSchema =
                    importKeys.length === vendorTableOrderSchameKeys.length &&
                    importKeys.every((item) => vendorTableOrderSchameKeys.includes(item));
                  if (validSchema) {
                    const result = await tableOrderService.importCollection(records);
                    res.send(result);
                  } else {
                    res.status(400).send({ code: 400, message: 'Validation failed', extra: '' });
                  }
                } catch (papaError) {
                  fs.unlinkSync(file.path);
                  res
                    .status(
                      papaError.statusCode ? papaError.statusCode : httpStatus.INTERNAL_SERVER_ERROR
                    )
                    .send({ code: 400, message: papaError.message, extra: '' });
                }
              },
              error: () => {
                fs.unlinkSync(file.path);
                res.status(500).json({ code: 500, message: 'Failed to parse CSV', extra: '' });
              },
            });
          } else {
            fs.unlinkSync(file.path);
            res.status(400).send({ code: 400, message: 'Invalid file type', extra: '' });
          }
        } else {
          res
            .status(400)
            .send({ code: 400, message: 'Please select a file to upload!', extra: '' });
        }
      } else if (err instanceof multer.MulterError) {
        let { error } = err;
        if (err.code === 'LIMIT_FILE_SIZE') {
          error = `Maximum file size is ##dynamic## MB`;
        }
        const sizeCount = config.file.maxUploadSize / (1024 * 1024);
        res.status(400).send({ code: 400, message: error, extra: sizeCount });
      } else {
        res
          .status(err.statusCode ? err.statusCode : httpStatus.INTERNAL_SERVER_ERROR)
          .send({ code: 400, message: err.message, extra: '' });
      }
    });
  } catch (error) {
    res.status(400).send({ code: 400, message: error.message, extra: '' });
  }
});

module.exports = {
  getTableOrderOfVendor,
  adminTableOrderList,
  getTableOrderDetail,
  adminTableOrderDetail,
  vendorTableOrderBusinessInsight,
  vendorCustomDateTableOrderBusinessInsight,
  tableOrderReport,
  vendorTableOrderList,
  adminTableOrderInvoice,
  vendorTableOrderInvoice,
  cityzenTableOrderList,
  cityzenTableOrderDetail,
  exportCollection,
  exportTableOrderReportCollection,
  importCollection,
};

