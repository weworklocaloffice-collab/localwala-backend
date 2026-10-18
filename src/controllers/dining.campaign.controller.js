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
const { diningCampaignService, cityService, restaurantService } = require('../services');
const uploadMiddleware = require('../middlewares/upload');
const config = require('../config/config');
const { diningCampaignSchemaKeys } = require('../utils/importCollectionSchema');

const create = catchAsync(async (req, res) => {
  if (req && req.body && req.body.restaurant && req.body.restaurant !== '') {
    req.body.restaurant = req.body.restaurant.split(',');
  } else {
    req.body.restaurant = [];
  }
  const result = await diningCampaignService.createCampaign(req.body);
  res.send(result);
});

const cityzenCreateCampaign = catchAsync(async (req, res) => {
  if (req && req.body && req.body.restaurant && req.body.restaurant !== '') {
    req.body.restaurant = req.body.restaurant.split(',');
  } else {
    req.body.restaurant = [];
  }
  const { master } = req.params;
  const result = await diningCampaignService.cityzenCreateCampaign(master, req.body);
  res.send(result);
});

const get = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await diningCampaignService.getAllDiningCampaignAdmin(options);
  res.send(result);
});

const cityzenCampaignList = catchAsync(async (req, res) => {
  const { master } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await diningCampaignService.cityzenCampaignList(master, options);
  res.send(result);
});

const updateStatus = catchAsync(async (req, res) => {
  const result = await diningCampaignService.updateStatus(req.params.campaignId, req.body);
  res.send(result);
});

const drop = catchAsync(async (req, res) => {
  await diningCampaignService.deleteCampaignById(req.params.campaignId);
  res.send({ success: true });
});

const update = catchAsync(async (req, res) => {
  if (req && req.body && req.body.restaurant && req.body.restaurant !== '') {
    req.body.restaurant = req.body.restaurant.split(',');
  } else {
    req.body.restaurant = [];
  }
  const campaign = await diningCampaignService.updateCampaignById(req.params.campaignId, req.body);
  res.send(campaign);
});

const getById = catchAsync(async (req, res) => {
  const cities = await cityService.listAllCities();
  const info = await diningCampaignService.getById(req.params.campaignId);
  res.send({ cities, info });
});

const cityzenDeepDetail = catchAsync(async (req, res) => {
  const info = await diningCampaignService.getById(req.params.campaignId);
  res.send(info);
});

const getCampaignNearMe = catchAsync(async (req, res) => {
  const restaurant = await restaurantService.getMyInfo(req.params.restaurantId);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await diningCampaignService.getAllCampaign(restaurant.city, options);
  res.send(result);
});

const leaveCampaign = catchAsync(async (req, res) => {
  const result = await diningCampaignService.leaveCampaign(
    req.params.campaignId,
    req.params.restaurantId
  );
  res.send(result);
});

const joinCampaign = catchAsync(async (req, res) => {
  const result = await diningCampaignService.joinCampaign(
    req.params.campaignId,
    req.params.restaurantId
  );
  res.send(result);
});

const getDiningCampaign = catchAsync(async (req, res) => {
  const result = await diningCampaignService.getDiningCampaign(
    req.params.campaignId,
    req.body.latitude,
    req.body.longitude,
    req.body.uid
  );
  res.send(result);
});

const detail = catchAsync(async (req, res) => {
  const { id } = req.params;
  const options = pick(req.query, ['limit', 'page']);
  const result = await diningCampaignService.campaignDetail(id, options);
  res.send(result);
});

const exportCollection = catchAsync(async (req, res) => {
  const { type, search } = req.query;
  if (type !== 'raw') {
    const result = await diningCampaignService.exportCollection(search);
    if (type === 'excel') {
      const mappedResult = result.map((details, index) => ({
        ...details,
        serial: index + 1,
        status: details.status ? 'Active' : 'Deactivated',
        cityName:
          details &&
          details.city &&
          details.city.name &&
          details.city.name !== null &&
          details.city.name !== ''
            ? details.city.name
            : '-',
        startDate: DateTime.fromISO(details.startDate).toFormat('dd LLL yyyy'),
        endDate: DateTime.fromISO(details.endDate).toFormat('dd LLL yyyy'),
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('DiningCampaign');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Title', key: 'title' },
        { header: 'Short Description', key: 'shortDescription' },
        { header: 'Image', key: 'image' },
        { header: 'City', key: 'cityName' },
        { header: 'Restaurant In Campaign', key: 'restaurantCount' },
        { header: 'Joninng Request', key: 'request' },
        { header: 'Start Date', key: 'startDate' },
        { header: 'Start Time', key: 'startTime' },
        { header: 'End Date', key: 'endDate' },
        { header: 'End Time', key: 'endTime' },
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
      const fieldItems = result.map((details, index) => ({
        'S. No.': index + 1,
        Id: details.id,
        Title: details.title,
        'Short Description': details.shortDescription,
        Image: details.image,
        City:
          details &&
          details.city &&
          details.city.name &&
          details.city.name !== null &&
          details.city.name !== ''
            ? details.city.name
            : '-',
        'Restaurant In Campaign': details.restaurantCount,
        'Joninng Request': details.request,
        'Start Date': DateTime.fromISO(details.startDate).toFormat('dd LLL yyyy'),
        'Start Time': details.startTime,
        'End Date': DateTime.fromISO(details.endDate).toFormat('dd LLL yyyy'),
        'End Time': details.endTime,
        Status: details.status ? 'Active' : 'Deactivated',
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await diningCampaignService.exportRawCollection(search);
    const downloadPath = path.join(__dirname, `../templates/downloads/diningcampaigns.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'diningcampaigns.json', (err) => {
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
              importKeys.length === diningCampaignSchemaKeys.length &&
              importKeys.every((item) => diningCampaignSchemaKeys.includes(item));
            if (validSchema) {
              const result = await diningCampaignService.importCollection(records);
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
                    importKeys.length === diningCampaignSchemaKeys.length &&
                    importKeys.every((item) => diningCampaignSchemaKeys.includes(item));
                  if (validSchema) {
                    const result = await diningCampaignService.importCollection(records);
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
  updateStatus,
  drop,
  getById,
  update,
  getCampaignNearMe,
  leaveCampaign,
  joinCampaign,
  getDiningCampaign,
  detail,
  cityzenCampaignList,
  cityzenCreateCampaign,
  cityzenDeepDetail,
  exportCollection,
  importCollection,
};

