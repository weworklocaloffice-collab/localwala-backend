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
const { couponService, ordersService } = require('../services');
const uploadMiddleware = require('../middlewares/upload');
const config = require('../config/config');
const { orderCouponSchemaKeys } = require('../utils/importCollectionSchema');

const create = catchAsync(async (req, res) => {
  if (req && req.body && req.body.restaurant && req.body.restaurant !== '') {
    req.body.restaurant = req.body.restaurant.split(',');
  } else {
    req.body.restaurant = [];
  }
  if (req && req.body && req.body.user && req.body.user !== '') {
    req.body.user = req.body.user.split(',');
  } else {
    req.body.user = [];
  }
  const result = await couponService.createCoupon(req.body);
  res.send(result);
});

const cityzenCreateCoupon = catchAsync(async (req, res) => {
  if (req && req.body && req.body.restaurant && req.body.restaurant !== '') {
    req.body.restaurant = req.body.restaurant.split(',');
  } else {
    req.body.restaurant = [];
  }
  if (req && req.body && req.body.user && req.body.user !== '') {
    req.body.user = req.body.user.split(',');
  } else {
    req.body.user = [];
  }
  const { master } = req.params;
  const result = await couponService.cityzenCreateCoupon(master, req.body);
  res.send(result);
});

const requestNewCoupon = catchAsync(async (req, res) => {
  const coupon = await couponService.requestNewCoupon(req.body);
  if (coupon && coupon !== null && coupon.id && coupon.id !== null && coupon.id !== '') {
    res.send({ success: true });
  } else {
    res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
  }
});

const get = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await couponService.getAllCoupon(options);
  res.send(result);
});

const cityzenCouponList = catchAsync(async (req, res) => {
  const { master } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await couponService.cityzenCouponList(master, options);
  res.send(result);
});

const update = catchAsync(async (req, res) => {
  if (req && req.body && req.body.restaurant && req.body.restaurant !== '') {
    req.body.restaurant = req.body.restaurant.split(',');
  } else {
    req.body.restaurant = [];
  }
  if (req && req.body && req.body.user && req.body.user !== '') {
    req.body.user = req.body.user.split(',');
  } else {
    req.body.user = [];
  }
  const result = await couponService.updateCoupon(req.params.id, req.body);
  res.send(result);
});

const cityzenUpdateCoupon = catchAsync(async (req, res) => {
  if (req && req.body && req.body.restaurant && req.body.restaurant !== '') {
    req.body.restaurant = req.body.restaurant.split(',');
  } else {
    req.body.restaurant = [];
  }
  if (req && req.body && req.body.user && req.body.user !== '') {
    req.body.user = req.body.user.split(',');
  } else {
    req.body.user = [];
  }
  const result = await couponService.cityzenUpdateCoupon(req.params.id, req.body);
  res.send(result);
});

const updateVendorCoupon = catchAsync(async (req, res) => {
  const result = await couponService.updateVendorCoupon(req.params.id, req.body);
  res.send(result);
});

const updateMeta = catchAsync(async (req, res) => {
  const result = await couponService.updateMetaInfo(req.params.id, req.body);
  res.send(result);
});

const drop = catchAsync(async (req, res) => {
  await couponService.deleteCoupon(req.params.id);
  res.send({ success: true });
});

const deleteVendorCoupon = catchAsync(async (req, res) => {
  await couponService.deleteVendorCoupon(req.params.id, req.params.userId);
  res.send({ success: true });
});

const getInfo = catchAsync(async (req, res) => {
  const result = await couponService.getInfo(req.params.id);
  res.send(result);
});

const cityzenCouponDetail = catchAsync(async (req, res) => {
  const result = await couponService.cityzenCouponDetail(req.params.id);
  res.send(result);
});

const getUserCoupon = catchAsync(async (req, res) => {
  const { latitude, longitude } = req.body;
  const result = await couponService.getUserCoupon(latitude, longitude);
  res.send(result);
});

const redeemCoupon = catchAsync(async (req, res) => {
  const { user, coupon, tracking, restaurant } = req.body;
  const result = await couponService.redeemCoupon(user, coupon, tracking, restaurant);
  res.send(result);
});

const getVendorCoupons = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'vendorId', 'userId']);
  const result = await couponService.getVendorCoupons(options);
  res.send(result);
});

const getVendorCouponInfo = catchAsync(async (req, res) => {
  const result = await couponService.getVendorCouponInfo(req.body);
  res.send(result);
});

const getVendorCouponRequest = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await couponService.getVendorCouponRequest(options);
  res.send(result);
});

const cityzenCouponRequest = catchAsync(async (req, res) => {
  const { master } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await couponService.cityzenCouponRequest(master, options);
  res.send(result);
});

const couponDetail = catchAsync(async (req, res) => {
  const { id } = req.params;
  const options = pick(req.query, ['limit', 'page']);
  const detail = await couponService.couponDetail(id);
  const orderList = await ordersService.couponOrders(id, options);
  res.send({ detail, orderList });
});

const exportCollection = catchAsync(async (req, res) => {
  const { type, status, search } = req.query;
  const isRequested = status === true || status === 'true';
  if (type !== 'raw') {
    const result = await couponService.exportCollection(isRequested, search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        cityName:
          detail &&
          detail.city &&
          detail.city.name &&
          detail.city.name !== null &&
          detail.city.name !== ''
            ? detail.city.name
            : '-',
        start: DateTime.fromISO(detail.start).toFormat('dd LLL yyyy'),
        expires: DateTime.fromISO(detail.expires).toFormat('dd LLL yyyy'),
        allRestaurants: detail.allRestaurants ? 'Yes' : 'No',
        allUsers: detail.allUsers ? 'Yes' : 'No',
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('OrderCoupons');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Name', key: 'name' },
        { header: 'Coupon Code', key: 'code' },
        { header: 'Coupon Type', key: 'couponType' },
        { header: 'City', key: 'cityName' },
        { header: 'Start', key: 'start' },
        { header: 'Expire', key: 'expires' },
        { header: 'For All Restaurants', key: 'allRestaurants' },
        { header: 'For All Users', key: 'allUsers' },
        { header: 'Discount Type', key: 'discountType' },
        { header: 'Restaurant In Coupon', key: 'restaurantCount' },
        { header: 'User In Coupon', key: 'userCount' },
        { header: 'Limit', key: 'limitSameUser' },
        { header: 'Loyality Points', key: 'loyalityPoints' },
        { header: 'Max Discount', key: 'maxDiscount' },
        { header: 'Min Cart Total', key: 'minCartTotal' },
        { header: 'Min Discount', key: 'minDiscount' },
        { header: 'Redeem Count', key: 'redeem' },
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
        Name: detail.name,
        'Coupon Code': detail.code,
        'Coupon Type': detail.couponType,
        City:
          detail &&
          detail.city &&
          detail.city.name &&
          detail.city.name !== null &&
          detail.city.name !== ''
            ? detail.city.name
            : '-',
        Start: DateTime.fromISO(detail.start).toFormat('dd LLL yyyy'),
        Expire: DateTime.fromISO(detail.expires).toFormat('dd LLL yyyy'),
        'For All Restaurants': detail.allRestaurants ? 'Yes' : 'No',
        'For All Users': detail.allUsers ? 'Yes' : 'No',
        'Discount Type': detail.discountType,
        'Restaurant In Coupon': detail.restaurantCount,
        'User In Coupon': detail.userCount,
        Limit: detail.limitSameUser,
        'Loyality Points': detail.loyalityPoints,
        'Max Discount': detail.maxDiscount,
        'Min Cart Total': detail.minCartTotal,
        'Min Discount': detail.minDiscount,
        'Redeem Count': detail.redeem,
        Status: detail.status,
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await couponService.exportRawCollection(isRequested, search);
    const downloadPath = path.join(__dirname, `../templates/downloads/coupons.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'coupons.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
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
              importKeys.length === orderCouponSchemaKeys.length &&
              importKeys.every((item) => orderCouponSchemaKeys.includes(item));
            if (validSchema) {
              const result = await couponService.importCollection(records);
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
                    importKeys.length === orderCouponSchemaKeys.length &&
                    importKeys.every((item) => orderCouponSchemaKeys.includes(item));
                  if (validSchema) {
                    const result = await couponService.importCollection(records);
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
  create,
  get,
  update,
  drop,
  updateMeta,
  getInfo,
  getUserCoupon,
  redeemCoupon,
  requestNewCoupon,
  getVendorCoupons,
  getVendorCouponInfo,
  updateVendorCoupon,
  deleteVendorCoupon,
  getVendorCouponRequest,
  couponDetail,
  cityzenCouponList,
  cityzenCreateCoupon,
  cityzenCouponDetail,
  cityzenUpdateCoupon,
  cityzenCouponRequest,
  exportCollection,
  importCollection,
};

