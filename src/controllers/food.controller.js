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
const {
  foodService,
  addonsService,
  categoryService,
  vendorCategoryService,
  restaurantService,
  foodTaxationService,
} = require('../services');
const uploadMiddleware = require('../middlewares/upload');
const config = require('../config/config');
const { foodSchemaKeys } = require('../utils/importCollectionSchema');

const create = catchAsync(async (req, res) => {
  if (req && req.body && req.body.addons && req.body.addons !== '') {
    req.body.addons = req.body.addons.split(',');
  } else {
    req.body.addons = [];
  }

  if (req && req.body && req.body.foodTax && req.body.foodTax !== '') {
    req.body.foodTax = req.body.foodTax.split(',');
  } else {
    req.body.foodTax = [];
  }

  const result = await foodService.createFood(req.body);
  res.send(result);
});

const getMyFoods = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await foodService.getAllFood(req.params.restaurant, options);
  res.send(result);
});

const update = catchAsync(async (req, res) => {
  if (req && req.body && req.body.addons && req.body.addons !== '') {
    req.body.addons = req.body.addons.split(',');
  } else {
    req.body.addons = [];
  }
  if (req && req.body && req.body.foodTax && req.body.foodTax !== '') {
    req.body.foodTax = req.body.foodTax.split(',');
  } else {
    req.body.foodTax = [];
  }
  const result = await foodService.updateFoodById(req.params.foodId, req.body);
  res.send(result);
});

const kitchenOwnerUpdateFood = catchAsync(async (req, res) => {
  const { id, owner } = req.params;
  if (req && req.body && req.body.addons && req.body.addons !== '') {
    req.body.addons = req.body.addons.split(',');
  } else {
    req.body.addons = [];
  }
  const result = await foodService.kitchenOwnerUpdateFood(id, owner, req.body);
  res.send(result);
});

const drop = catchAsync(async (req, res) => {
  await foodService.deleteFoodById(req.params.foodId);
  res.send({ success: true });
});

const getAll = catchAsync(async (req, res) => {
  const result = await foodService.getAllFoodList();
  res.send(result);
});

const getBasicData = catchAsync(async (req, res) => {
  const addons = await addonsService.getAllMyAddons(req.params.restaurant);
  const category = await categoryService.getAllActiveCategory();
  const vendorCategory = await vendorCategoryService.getAllList(req.params.restaurant);
  const taxation = await foodTaxationService.getAllMyTaxation(req.params.restaurant);
  res.send({ addons, category, vendorCategory, taxation });
});

const updateMetaInfo = catchAsync(async (req, res) => {
  const result = await foodService.updateMetaInfo(req.params.foodId, req.body);
  res.send(result);
});

const getFoodInfo = catchAsync(async (req, res) => {
  const addons = await addonsService.getAllMyAddons(req.params.restaurant);
  const category = await categoryService.getAllActiveCategory();
  const vendorCategory = await vendorCategoryService.getAllList(req.params.restaurant);
  const foodInfo = await foodService.getFoodId(req.params.foodId);
  const taxations = await foodTaxationService.getAllMyTaxation(req.params.restaurant);
  res.send({ addons, category, vendorCategory, foodInfo, taxations });
});

const getFoodIdVendorApp = catchAsync(async (req, res) => {
  const { foodId, restaurant } = req.params;
  const foodInfo = await foodService.getFoodIdVendorApp(foodId, restaurant);
  res.send({ foodInfo });
});

const adminFoodList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await foodService.adminFoodList(options);
  res.send(result);
});

const cityzenFoodList = catchAsync(async (req, res) => {
  const { master } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await foodService.cityzenFoodList(master, options);
  res.send(result);
});

const getFoodInfoForAdmin = catchAsync(async (req, res) => {
  const foodInfo = await foodService.getFoodId(req.params.foodId);
  const addons = await addonsService.getAllMyAddons(foodInfo.restaurant);
  const category = await categoryService.getAllActiveCategory();
  const vendorCategory = await vendorCategoryService.getAllList(foodInfo.restaurant);
  const restDetails = await restaurantService.getRestaurantLimitedDetails(foodInfo.restaurant);
  const taxation = await foodTaxationService.getAllMyTaxation(foodInfo.restaurant);
  res.send({ addons, category, vendorCategory, foodInfo, restDetails, taxation });
});

const getFoodByCity = catchAsync(async (req, res) => {
  const result = await foodService.getFoodByCity(req.params.cityId);
  res.send(result);
});

const cityzenFoodListForBanner = catchAsync(async (req, res) => {
  const result = await foodService.cityzenFoodListForBanner(req.params.master);
  res.send(result);
});

const getAllMainActiveCategories = catchAsync(async (req, res) => {
  const result = await categoryService.getAllActiveCategory();
  res.send(result);
});

const getAllMyAddonsList = catchAsync(async (req, res) => {
  const result = await addonsService.getAllMyAddons(req.params.restaurant);
  res.send(result);
});

const kitchenOwnerAddonList = catchAsync(async (req, res) => {
  const { owner } = req.params;
  const result = await addonsService.kitchenOwnerAddonList(owner);
  res.send(result);
});

const getMyFoodApp = catchAsync(async (req, res) => {
  const result = await foodService.getMyFoodApp(req.params.restaurant);
  res.send(result);
});

const getRestaurantFoodFromWaiter = catchAsync(async (req, res) => {
  const result = await foodService.getRestaurantFoodFromWaiter(req.params.restaurant);
  res.send(result);
});

const getSingleFoodInfo = catchAsync(async (req, res) => {
  const result = await foodService.getSingleFoodInfo(req.body.foodId, req.body.uid);
  res.send(result);
});

const searchMenuFood = catchAsync(async (req, res) => {
  const { vendor, searchQuery } = req.params;
  const result = await foodService.searchMenuFood(vendor, searchQuery);
  res.send(result);
});

const foodReport = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'filter', 'kind', 'search', 'limit', 'page']);
  const result = await foodService.foodReport(options);
  res.send(result);
});

const vendorFoodList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'limit', 'page']);
  const result = await foodService.vendorFoodList(options);
  res.send(result);
});

const adminFoodDetail = catchAsync(async (req, res) => {
  const { foodId } = req.params;
  const options = pick(req.query, ['limit', 'page']);
  const result = await foodService.adminFoodDetail(foodId, options);
  res.send(result);
});

const kitchenOwnerFoodList = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await foodService.kitchenOwnerFoodList(id);
  res.send(result);
});

const kitchenOwnerFoodDetail = catchAsync(async (req, res) => {
  const { id, owner } = req.params;
  const result = await foodService.kitchenOwnerFoodDetail(id, owner);
  res.send(result);
});

const exportCollection = catchAsync(async (req, res) => {
  const { type, search } = req.query;
  if (type !== 'raw') {
    const result = await foodService.exportCollection(search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        restaurantName:
          detail &&
          detail.restaurants &&
          detail.restaurants.name &&
          detail.restaurants.name !== null &&
          detail.restaurants.name !== ''
            ? detail.restaurants.name
            : '-',
        categoryName:
          detail &&
          detail.category &&
          detail.category.name &&
          detail.category.name !== null &&
          detail.category.name !== ''
            ? detail.category.name
            : '-',
        subCategoryName:
          detail &&
          detail.subCategory &&
          detail.subCategory.name &&
          detail.subCategory.name !== null &&
          detail.subCategory.name !== ''
            ? detail.subCategory.name
            : '-',
        customCategoryName:
          detail &&
          detail.customCategory &&
          detail.customCategory.name &&
          detail.customCategory.name !== null &&
          detail.customCategory.name !== ''
            ? detail.customCategory.name
            : '-',
        customSubCategoryName:
          detail &&
          detail.customSubCategory &&
          detail.customSubCategory.name &&
          detail.customSubCategory.name !== null &&
          detail.customSubCategory.name !== ''
            ? detail.customSubCategory.name
            : '-',
        recommended: detail.recommended ? 'Yes' : 'No',
        inStock: detail.inStock ? 'Yes' : 'No',
        stockNumber: detail.stockNumber !== -1 ? detail.stockNumber : 'Unlimited',
        taxationEnable: detail.taxationEnable ? 'Yes' : 'No',
        discountType: detail.discountType === '%' ? 'Percentage' : 'Amount',
        purchaseLimit: detail.purchaseLimit !== -1 ? detail.purchaseLimit : 'Unlimited',
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Foods');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Name', key: 'name' },
        { header: 'Restaurant Name', key: 'restaurantName' },
        { header: 'Price', key: 'price' },
        { header: 'Discount Type', key: 'discountType' },
        { header: 'Discount', key: 'discount' },
        { header: 'Food Type', key: 'foodType' },
        { header: 'Category', key: 'categoryName' },
        { header: 'Sub Category', key: 'subCategoryName' },
        { header: 'Custom Category', key: 'customCategoryName' },
        { header: 'Custom Sub Category', key: 'customSubCategoryName' },
        { header: 'Image', key: 'image' },
        { header: 'Start Time', key: 'startTime' },
        { header: 'End Time', key: 'endTime' },
        { header: 'Purchase Limit', key: 'purchaseLimit' },
        { header: 'Recommended', key: 'recommended' },
        { header: 'Rating', key: 'rating' },
        { header: 'Total Rating', key: 'totalRating' },
        { header: 'In Stock', key: 'inStock' },
        { header: 'Stock Type', key: 'stockType' },
        { header: 'Stock Number', key: 'stockNumber' },
        { header: 'Taxation Enable', key: 'taxationEnable' },
        { header: 'Order Sold Count', key: 'orderSoldCount' },
        { header: 'Total Sold Amount', key: 'totalSoldAmount' },
        { header: 'Discount Amount Given', key: 'discountAmountGiven' },
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
        'Restaurant Name':
          detail &&
          detail.restaurants &&
          detail.restaurants.name &&
          detail.restaurants.name !== null &&
          detail.restaurants.name !== ''
            ? detail.restaurants.name
            : '-',
        Price: detail.price,
        'Discount Type': detail.discountType === '%' ? 'Percentage' : 'Amount',
        Discount: detail.discount,
        'Food Type': detail.foodType,
        Category:
          detail &&
          detail.category &&
          detail.category.name &&
          detail.category.name !== null &&
          detail.category.name !== ''
            ? detail.category.name
            : '-',
        'Sub Category':
          detail &&
          detail.subCategory &&
          detail.subCategory.name &&
          detail.subCategory.name !== null &&
          detail.subCategory.name !== ''
            ? detail.subCategory.name
            : '-',
        'Custom Category':
          detail &&
          detail.customCategory &&
          detail.customCategory.name &&
          detail.customCategory.name !== null &&
          detail.customCategory.name !== ''
            ? detail.customCategory.name
            : '-',
        'Custom Sub Category':
          detail &&
          detail.customSubCategory &&
          detail.customSubCategory.name &&
          detail.customSubCategory.name !== null &&
          detail.customSubCategory.name !== ''
            ? detail.customSubCategory.name
            : '-',
        Image: detail.image,
        'Start Time': detail.startTime,
        'End Time': detail.endTime,
        'Purchase Limit': detail.purchaseLimit !== -1 ? detail.purchaseLimit : 'Unlimited',
        Recommended: detail.recommended ? 'Yes' : 'No',
        Rating: detail.rating,
        'Total Rating': detail.totalRating,
        'In Stock': detail.inStock ? 'Yes' : 'No',
        'Stock Type': detail.stockType,
        'Stock Number': detail.stockNumber !== -1 ? detail.stockNumber : 'Unlimited',
        'Taxation Enable': detail.taxationEnable ? 'Yes' : 'No',
        'Order Sold Count': detail.orderSoldCount,
        'Total Sold Amount': detail.totalSoldAmount,
        'Discount Amount Given': detail.discountAmountGiven,
        Status: detail.status,
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await foodService.exportRawCollection(search);
    const downloadPath = path.join(__dirname, `../templates/downloads/foods.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'foods.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportReportCollection = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'filter', 'kind', 'search']);
  const { type } = req.query;
  const result = await foodService.exportReportCollection(options);
  if (type === 'excel') {
    const mappedResult = result.map((detail, index) => ({
      ...detail,
      serial: index + 1,
      restaurantId:
        detail &&
        detail.restaurants &&
        detail.restaurants.id &&
        detail.restaurants.id !== null &&
        detail.restaurants.id !== ''
          ? detail.restaurants.id
          : '-',
      restaurantName:
        detail &&
        detail.restaurants &&
        detail.restaurants.name &&
        detail.restaurants.name !== null &&
        detail.restaurants.name !== ''
          ? detail.restaurants.name
          : '-',
      createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
    }));
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('FoodReport');
    worksheet.columns = [
      { header: 'S. No.', key: 'serial' },
      { header: 'Id', key: 'id' },
      { header: 'Name', key: 'name' },
      { header: 'Restaurant Id', key: 'restaurantId' },
      { header: 'Restaurant Name', key: 'restaurantName' },
      { header: 'Food Type', key: 'foodType' },
      { header: 'Price', key: 'price' },
      { header: 'Total Sold Amount', key: 'totalSoldAmount' },
      { header: 'Discount Amount Given', key: 'discountAmountGiven' },
      { header: 'Order Sold Count', key: 'orderSoldCount' },
      { header: 'Average Sell', key: 'averageSell' },
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
      Name: detail.name,
      'Restaurant Id':
        detail &&
        detail.restaurants &&
        detail.restaurants.id &&
        detail.restaurants.id !== null &&
        detail.restaurants.id !== ''
          ? detail.restaurants.id
          : '-',
      'Restaurant Name':
        detail &&
        detail.restaurants &&
        detail.restaurants.name &&
        detail.restaurants.name !== null &&
        detail.restaurants.name !== ''
          ? detail.restaurants.name
          : '-',
      'Food Type': detail.foodType,
      Price: detail.price,
      'Total Sold Amount': detail.totalSoldAmount,
      'Discount Amount Given': detail.discountAmountGiven,
      'Order Sold Count': detail.orderSoldCount,
      'Average Sell': detail.averageSell,
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
              importKeys.length === foodSchemaKeys.length &&
              importKeys.every((item) => foodSchemaKeys.includes(item));
            if (validSchema) {
              const result = await foodService.importCollection(records);
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
                    importKeys.length === foodSchemaKeys.length &&
                    importKeys.every((item) => foodSchemaKeys.includes(item));
                  if (validSchema) {
                    const result = await foodService.importCollection(records);
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
  getMyFoods,
  update,
  drop,
  getAll,
  getBasicData,
  updateMetaInfo,
  getFoodInfo,
  adminFoodList,
  getFoodInfoForAdmin,
  getFoodByCity,
  getAllMainActiveCategories,
  getAllMyAddonsList,
  getMyFoodApp,
  getFoodIdVendorApp,
  getSingleFoodInfo,
  searchMenuFood,
  getRestaurantFoodFromWaiter,
  foodReport,
  vendorFoodList,
  adminFoodDetail,
  cityzenFoodList,
  cityzenFoodListForBanner,
  kitchenOwnerFoodList,
  kitchenOwnerFoodDetail,
  kitchenOwnerAddonList,
  kitchenOwnerUpdateFood,
  exportCollection,
  exportReportCollection,
  importCollection,
};

