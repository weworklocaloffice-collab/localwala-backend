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
  userService,
  walletService,
  cityService,
  driverService,
  vehicleService,
  restaurantService,
  deliverymanCashInHandService,
  joiningFormService,
  ordersService,
} = require('../services');
const { Wallet } = require('../models');
const uploadMiddleware = require('../middlewares/upload');
const config = require('../config/config');
const {
  systemDeliverymanSchemaKeys,
  vendorDeliverymanSchemaKeys,
} = require('../utils/importCollectionSchema');

const registerDriverAccount = catchAsync(async (req, res) => {
  const user = await userService.createDriverAccount(req.body);
  const walletData = new Wallet({
    holderId: user.id,
  });
  await walletService.createWallet(walletData);
  req.body.userId = user.id;
  await driverService.createDriver(req.body);
  res.status(201).send({ success: true });
});

const cityzenRegisterDriverAccount = catchAsync(async (req, res) => {
  const { master } = req.params;
  const user = await userService.cityzenCreateDriverAccount(req.body);
  const walletData = new Wallet({
    holderId: user.id,
  });
  await walletService.createWallet(walletData);
  req.body.userId = user.id;
  await driverService.cityzenCreateDriver(master, req.body);
  res.status(201).send({ success: true });
});

const registerVendorDriverAccount = catchAsync(async (req, res) => {
  const user = await userService.createVendorDriverAccount(req.body);
  const walletData = new Wallet({
    holderId: user.id,
  });
  await walletService.createWallet(walletData);
  req.body.userId = user.id;
  await driverService.createVendorDriver(req.body);
  res.status(201).send({ success: true });
});

const getBasicData = catchAsync(async (req, res) => {
  const cities = await cityService.listAllCities();
  const vehicles = await vehicleService.listAllVehicle();
  res.send({ cities, vehicles });
});

const cityzenBasicData = catchAsync(async (req, res) => {
  const { master } = req.params;
  const cityzen = await driverService.cityzenDetail(master);
  const vehicles = await vehicleService.listAllVehicle();
  res.send({ cityzen, vehicles });
});

const getVendorDriverBasicData = catchAsync(async (req, res) => {
  const { restaurant } = req.params;
  const vehicles = await vehicleService.listAllVehicle();
  const info = await restaurantService.getRestaurantInfoForNewDriver(restaurant);
  res.send({ vehicles, info });
});

const getById = catchAsync(async (req, res) => {
  const cities = await cityService.listAllCities();
  const vehicles = await vehicleService.listAllVehicle();
  const info = await driverService.getById(req.params.driverId);
  res.send({ cities, vehicles, info });
});

const cityzenDeliverymanGetById = catchAsync(async (req, res) => {
  const vehicles = await vehicleService.listAllVehicle();
  const info = await driverService.getById(req.params.driverId);
  res.send({ vehicles, info });
});

const get = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await driverService.getAllDriver(options);
  res.send(result);
});

const cityzenSystemDriver = catchAsync(async (req, res) => {
  const { master } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await driverService.cityzenSystemDriver(master, options);
  res.send(result);
});

const getAllVendorDriverList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await driverService.getAllVendorDriverList(options);
  res.send(result);
});

const cityzenVendorDriverList = catchAsync(async (req, res) => {
  const { master } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await driverService.cityzenVendorDriverList(master, options);
  res.send(result);
});

const getMyDriver = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await driverService.getAllVendorDriver(req.params.restaurant, options);
  res.send(result);
});

const updateStatus = catchAsync(async (req, res) => {
  const driver = await driverService.updateStatus(req.params.driverId, req.body);
  res.send(driver);
});

const update = catchAsync(async (req, res) => {
  const driver = await driverService.updateDriverById(req.params.driverId, req.body);
  res.send(driver);
});

const cityzenUpdate = catchAsync(async (req, res) => {
  const { master, driverId } = req.params;
  const driver = await driverService.cityzenUpdateDriverById(master, driverId, req.body);
  res.send(driver);
});

const goOfflnie = catchAsync(async (req, res) => {
  const driver = await driverService.goOffline(req.params.uid, req.params.reasonId);
  res.send(driver);
});

const goOnline = catchAsync(async (req, res) => {
  const driver = await driverService.goOnline(req.params.uid);
  res.send(driver);
});

const getNearMeActiveDriver = catchAsync(async (req, res) => {
  const driver = await driverService.getNearMeActiveDriver(req.params.vendorId);
  res.send(driver);
});

const updateMyLocation = catchAsync(async (req, res) => {
  const { id, latitude, longitude } = req.body;
  const result = await driverService.updateMyLocation(id, latitude, longitude);
  res.send(result);
});

/**
 * Rider's zone card (Batch G-4). Resolved from the authenticated driver —
 * no params, nothing client-supplied to mistrust. Display-only backing for
 * the home-screen zone chip (zone name, open orders, active riders).
 */
const getMyZone = catchAsync(async (req, res) => {
  const driverUserId = req.user && (req.user._id || req.user.id);
  const result = await driverService.getMyZoneSummary(String(driverUserId));
  res.send({ ...result, success: true });
});

const getDeliverymanFromCity = catchAsync(async (req, res) => {
  const { city } = req.params;
  const result = await driverService.getDeliverymanFromCity(city);
  res.send(result);
});

const cityzenDeliverymanList = catchAsync(async (req, res) => {
  const { master } = req.params;
  const result = await driverService.cityzenDeliverymanList(master);
  res.send(result);
});

const getDeliverymanCashInHand = catchAsync(async (req, res) => {
  const { deliveryman } = req.params;
  const result = await deliverymanCashInHandService.getDeliverymanCashInHand(deliveryman);
  res.send(result);
});

const clearCashInHand = catchAsync(async (req, res) => {
  const { deliveryman, method, reference } = req.body;
  const result = await deliverymanCashInHandService.clearCashInHand(deliveryman, method, reference);
  res.send(result);
});

const getDeliveryDepositeDetail = catchAsync(async (req, res) => {
  const { deliveryman } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await deliverymanCashInHandService.getDeliveryDepositeDetail(deliveryman, options);
  res.send(result);
});

const getBasicDataRegisterRequest = catchAsync(async (req, res) => {
  const cities = await cityService.getCitiesListForNewRestaurant();

  const vehicles = await vehicleService.listAllVehicle();
  const joiningForm = await joiningFormService.getDeliverymanJoiningField();
  res.send({ cities, vehicles, joiningForm, success: true });
});

const deliverymanInsight = catchAsync(async (req, res) => {
  const { uid } = req.params;
  const result = await ordersService.deliverymanInsight(uid);
  res.send(result);
});

const deliverymanWalletFundList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['limit', 'page', 'search']);
  const result = await driverService.deliverymanWalletFundList(options);
  res.send(result);
});

const deliverymanReport = catchAsync(async (req, res) => {
  const options = pick(req.query, ['kind', 'type', 'city', 'limit', 'page', 'search']);
  const result = await driverService.deliverymanReport(options);
  res.send(result);
});

const vendorDeliverymanList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'limit', 'page']);
  const result = await driverService.vendorDeliverymanList(options);
  res.send(result);
});

const deliverymanInformation = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await driverService.deliverymanInformation(id);
  res.send(result);
});

const cityMapDialogDeliveryman = catchAsync(async (req, res) => {
  const { city } = req.params;
  const options = pick(req.query, ['limit', 'page']);
  const result = await driverService.cityMapDialogDeliveryman(city, options);
  res.send(result);
});

const supportTeamDeliverymanList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['kind', 'type', 'city', 'limit', 'page', 'search']);
  const result = await driverService.supportTeamDeliverymanList(options);
  res.send(result);
});

const exportSystemDeliverymanCollection = catchAsync(async (req, res) => {
  const { type, search } = req.query;
  if (type !== 'raw') {
    const result = await driverService.exportSystemDeliverymanCollection(search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        latitude: detail.location.coordinates[1] || 0,
        longitude: detail.location.coordinates[0] || 0,
        cityId:
          detail &&
          detail.city &&
          detail.city.id &&
          detail.city.id !== null &&
          detail.city.id !== ''
            ? detail.city.id
            : '-',
        cityName:
          detail &&
          detail.city &&
          detail.city.name &&
          detail.city.name !== null &&
          detail.city.name !== ''
            ? detail.city.name
            : '-',
        localityId:
          detail &&
          detail.locality &&
          detail.locality.id &&
          detail.locality.id !== null &&
          detail.locality.id !== ''
            ? detail.locality.id
            : '-',
        localityName:
          detail &&
          detail.locality &&
          detail.locality.name &&
          detail.locality.name !== null &&
          detail.locality.name !== ''
            ? detail.locality.name
            : '-',
        driverId:
          detail &&
          detail.driverInfo &&
          detail.driverInfo.id &&
          detail.driverInfo.id !== null &&
          detail.driverInfo.id !== ''
            ? detail.driverInfo.id
            : 'Uknown',
        driverFirstName:
          detail &&
          detail.driverInfo &&
          detail.driverInfo.firstName &&
          detail.driverInfo.firstName !== null &&
          detail.driverInfo.firstName !== ''
            ? detail.driverInfo.firstName
            : 'Uknown',
        driverLastName:
          detail &&
          detail.driverInfo &&
          detail.driverInfo.lastName &&
          detail.driverInfo.lastName !== null &&
          detail.driverInfo.lastName !== ''
            ? detail.driverInfo.lastName
            : 'Uknown',
        driverImage:
          detail &&
          detail.driverInfo &&
          detail.driverInfo.image &&
          detail.driverInfo.image !== null &&
          detail.driverInfo.image !== ''
            ? detail.driverInfo.image
            : 'Uknown',
        driverCountryCode:
          detail &&
          detail.driverInfo &&
          detail.driverInfo.countryCode &&
          detail.driverInfo.countryCode !== null &&
          detail.driverInfo.countryCode !== ''
            ? detail.driverInfo.countryCode
            : 'Uknown',
        driverMobile:
          detail &&
          detail.driverInfo &&
          detail.driverInfo.mobile &&
          detail.driverInfo.mobile !== null &&
          detail.driverInfo.mobile !== ''
            ? detail.driverInfo.mobile
            : 'Uknown',
        driverEmail:
          detail &&
          detail.driverInfo &&
          detail.driverInfo.email &&
          detail.driverInfo.email !== null &&
          detail.driverInfo.email !== ''
            ? detail.driverInfo.email
            : 'Uknown',
        offlineReasonId:
          detail &&
          detail.offline &&
          detail.offline.id &&
          detail.offline.id !== null &&
          detail.offline.id !== ''
            ? detail.offline.id
            : '-',
        offlineReasonName:
          detail &&
          detail.offline &&
          detail.offline.name &&
          detail.offline.name !== null &&
          detail.offline.name !== ''
            ? detail.offline.name
            : '-',
        isBlocked: detail.isBlocked ? 'Yes' : 'No',
        activeStatus: detail.activeStatus ? 'Yes' : 'No',
        status: detail.status ? 'Active' : 'Deactivated',
        createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('SystemDeliveryman');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Deliveryman Id', key: 'driverId' },
        { header: 'Deliveryman FirstName', key: 'driverFirstName' },
        { header: 'Deliveryman LastName', key: 'driverLastName' },
        { header: 'Deliveryman CountryCode', key: 'driverCountryCode' },
        { header: 'Deliveryman Mobile', key: 'driverMobile' },
        { header: 'Deliveryman Email', key: 'driverEmail' },
        { header: 'Deliveryman Image', key: 'driverImage' },
        { header: 'City Id', key: 'cityId' },
        { header: 'City Name', key: 'cityName' },
        { header: 'Locality Id', key: 'localityId' },
        { header: 'Locality Name', key: 'localityName' },
        { header: 'Latitude', key: 'latitude' },
        { header: 'Longitude', key: 'longitude' },
        { header: 'Type', key: 'type' },
        { header: 'Order Handling', key: 'orderHandling' },
        { header: 'Is Blocked', key: 'isBlocked' },
        { header: 'Is Active', key: 'activeStatus' },
        { header: 'Rating', key: 'rating' },
        { header: 'Total Rating', key: 'totalRating' },
        { header: 'Offline Id', key: 'offlineReasonId' },
        { header: 'Offline Reason', key: 'offlineReasonName' },
        { header: 'Joining Date', key: 'createdAt' },
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
        'Deliveryman Id':
          detail &&
          detail.driverInfo &&
          detail.driverInfo.id &&
          detail.driverInfo.id !== null &&
          detail.driverInfo.id !== ''
            ? detail.driverInfo.id
            : 'Uknown',
        'Deliveryman FirstName':
          detail &&
          detail.driverInfo &&
          detail.driverInfo.firstName &&
          detail.driverInfo.firstName !== null &&
          detail.driverInfo.firstName !== ''
            ? detail.driverInfo.firstName
            : 'Uknown',
        'Deliveryman LastName':
          detail &&
          detail.driverInfo &&
          detail.driverInfo.lastName &&
          detail.driverInfo.lastName !== null &&
          detail.driverInfo.lastName !== ''
            ? detail.driverInfo.lastName
            : 'Uknown',
        'Deliveryman CountryCode':
          detail &&
          detail.driverInfo &&
          detail.driverInfo.countryCode &&
          detail.driverInfo.countryCode !== null &&
          detail.driverInfo.countryCode !== ''
            ? detail.driverInfo.countryCode
            : 'Uknown',
        'Deliveryman Mobile':
          detail &&
          detail.driverInfo &&
          detail.driverInfo.mobile &&
          detail.driverInfo.mobile !== null &&
          detail.driverInfo.mobile !== ''
            ? detail.driverInfo.mobile
            : 'Uknown',
        'Deliveryman Email':
          detail &&
          detail.driverInfo &&
          detail.driverInfo.email &&
          detail.driverInfo.email !== null &&
          detail.driverInfo.email !== ''
            ? detail.driverInfo.email
            : 'Uknown',
        'Deliveryman Image':
          detail &&
          detail.driverInfo &&
          detail.driverInfo.image &&
          detail.driverInfo.image !== null &&
          detail.driverInfo.image !== ''
            ? detail.driverInfo.image
            : 'Uknown',
        'City Id':
          detail &&
          detail.city &&
          detail.city.id &&
          detail.city.id !== null &&
          detail.city.id !== ''
            ? detail.city.id
            : '-',
        'City Name':
          detail &&
          detail.city &&
          detail.city.name &&
          detail.city.name !== null &&
          detail.city.name !== ''
            ? detail.city.name
            : '-',
        'Locality Id':
          detail &&
          detail.locality &&
          detail.locality.id &&
          detail.locality.id !== null &&
          detail.locality.id !== ''
            ? detail.locality.id
            : '-',
        'Locality Name':
          detail &&
          detail.locality &&
          detail.locality.name &&
          detail.locality.name !== null &&
          detail.locality.name !== ''
            ? detail.locality.name
            : '-',
        Latitude: detail.location.coordinates[1] || 0,
        Longitude: detail.location.coordinates[0] || 0,
        Type: detail.type,
        'Order Handling': detail.orderHandling,
        'Is Blocked': detail.isBlocked ? 'Yes' : 'No',
        'Is Active': detail.activeStatus ? 'Yes' : 'No',
        Rating: detail.rating,
        'Total Rating': detail.totalRating,
        'Offline Id':
          detail &&
          detail.offline &&
          detail.offline.id &&
          detail.offline.id !== null &&
          detail.offline.id !== ''
            ? detail.offline.id
            : '-',
        'Offline Reason':
          detail &&
          detail.offline &&
          detail.offline.name &&
          detail.offline.name !== null &&
          detail.offline.name !== ''
            ? detail.offline.name
            : '-',
        'Joining Date': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
        Status: detail.status ? 'Active' : 'Deactivated',
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await driverService.exportSystemDeliverymanRawCollection(search);
    const downloadPath = path.join(__dirname, `../templates/downloads/systemdeliverymans.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'systemdeliverymans.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportVendorDeliverymanCollection = catchAsync(async (req, res) => {
  const { type, search } = req.query;
  if (type !== 'raw') {
    const result = await driverService.exportVendorDeliverymanCollection(search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        latitude: detail.location.coordinates[1] || 0,
        longitude: detail.location.coordinates[0] || 0,
        cityId:
          detail &&
          detail.city &&
          detail.city.id &&
          detail.city.id !== null &&
          detail.city.id !== ''
            ? detail.city.id
            : '-',
        cityName:
          detail &&
          detail.city &&
          detail.city.name &&
          detail.city.name !== null &&
          detail.city.name !== ''
            ? detail.city.name
            : '-',
        localityId:
          detail &&
          detail.locality &&
          detail.locality.id &&
          detail.locality.id !== null &&
          detail.locality.id !== ''
            ? detail.locality.id
            : '-',
        localityName:
          detail &&
          detail.locality &&
          detail.locality.name &&
          detail.locality.name !== null &&
          detail.locality.name !== ''
            ? detail.locality.name
            : '-',
        driverId:
          detail &&
          detail.driverInfo &&
          detail.driverInfo.id &&
          detail.driverInfo.id !== null &&
          detail.driverInfo.id !== ''
            ? detail.driverInfo.id
            : 'Uknown',
        driverFirstName:
          detail &&
          detail.driverInfo &&
          detail.driverInfo.firstName &&
          detail.driverInfo.firstName !== null &&
          detail.driverInfo.firstName !== ''
            ? detail.driverInfo.firstName
            : 'Uknown',
        driverLastName:
          detail &&
          detail.driverInfo &&
          detail.driverInfo.lastName &&
          detail.driverInfo.lastName !== null &&
          detail.driverInfo.lastName !== ''
            ? detail.driverInfo.lastName
            : 'Uknown',
        driverImage:
          detail &&
          detail.driverInfo &&
          detail.driverInfo.image &&
          detail.driverInfo.image !== null &&
          detail.driverInfo.image !== ''
            ? detail.driverInfo.image
            : 'Uknown',
        driverCountryCode:
          detail &&
          detail.driverInfo &&
          detail.driverInfo.countryCode &&
          detail.driverInfo.countryCode !== null &&
          detail.driverInfo.countryCode !== ''
            ? detail.driverInfo.countryCode
            : 'Uknown',
        driverMobile:
          detail &&
          detail.driverInfo &&
          detail.driverInfo.mobile &&
          detail.driverInfo.mobile !== null &&
          detail.driverInfo.mobile !== ''
            ? detail.driverInfo.mobile
            : 'Uknown',
        driverEmail:
          detail &&
          detail.driverInfo &&
          detail.driverInfo.email &&
          detail.driverInfo.email !== null &&
          detail.driverInfo.email !== ''
            ? detail.driverInfo.email
            : 'Uknown',
        offlineReasonId:
          detail &&
          detail.offline &&
          detail.offline.id &&
          detail.offline.id !== null &&
          detail.offline.id !== ''
            ? detail.offline.id
            : '-',
        offlineReasonName:
          detail &&
          detail.offline &&
          detail.offline.name &&
          detail.offline.name !== null &&
          detail.offline.name !== ''
            ? detail.offline.name
            : '-',
        isBlocked: detail.isBlocked ? 'Yes' : 'No',
        activeStatus: detail.activeStatus ? 'Yes' : 'No',
        status: detail.status ? 'Active' : 'Deactivated',
        createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
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
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('VendorDeliveryman');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Deliveryman Id', key: 'driverId' },
        { header: 'Deliveryman FirstName', key: 'driverFirstName' },
        { header: 'Deliveryman LastName', key: 'driverLastName' },
        { header: 'Deliveryman CountryCode', key: 'driverCountryCode' },
        { header: 'Deliveryman Mobile', key: 'driverMobile' },
        { header: 'Deliveryman Email', key: 'driverEmail' },
        { header: 'Deliveryman Image', key: 'driverImage' },
        { header: 'Restaurant Id', key: 'restaurantId' },
        { header: 'Restaurant Name', key: 'restaurantName' },
        { header: 'City Id', key: 'cityId' },
        { header: 'City Name', key: 'cityName' },
        { header: 'Locality Id', key: 'localityId' },
        { header: 'Locality Name', key: 'localityName' },
        { header: 'Latitude', key: 'latitude' },
        { header: 'Longitude', key: 'longitude' },
        { header: 'Type', key: 'type' },
        { header: 'Order Handling', key: 'orderHandling' },
        { header: 'Is Blocked', key: 'isBlocked' },
        { header: 'Is Active', key: 'activeStatus' },
        { header: 'Rating', key: 'rating' },
        { header: 'Total Rating', key: 'totalRating' },
        { header: 'Offline Id', key: 'offlineReasonId' },
        { header: 'Offline Reason', key: 'offlineReasonName' },
        { header: 'Joining Date', key: 'createdAt' },
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
        'Deliveryman Id':
          detail &&
          detail.driverInfo &&
          detail.driverInfo.id &&
          detail.driverInfo.id !== null &&
          detail.driverInfo.id !== ''
            ? detail.driverInfo.id
            : 'Uknown',
        'Deliveryman FirstName':
          detail &&
          detail.driverInfo &&
          detail.driverInfo.firstName &&
          detail.driverInfo.firstName !== null &&
          detail.driverInfo.firstName !== ''
            ? detail.driverInfo.firstName
            : 'Uknown',
        'Deliveryman LastName':
          detail &&
          detail.driverInfo &&
          detail.driverInfo.lastName &&
          detail.driverInfo.lastName !== null &&
          detail.driverInfo.lastName !== ''
            ? detail.driverInfo.lastName
            : 'Uknown',
        'Deliveryman CountryCode':
          detail &&
          detail.driverInfo &&
          detail.driverInfo.countryCode &&
          detail.driverInfo.countryCode !== null &&
          detail.driverInfo.countryCode !== ''
            ? detail.driverInfo.countryCode
            : 'Uknown',
        'Deliveryman Mobile':
          detail &&
          detail.driverInfo &&
          detail.driverInfo.mobile &&
          detail.driverInfo.mobile !== null &&
          detail.driverInfo.mobile !== ''
            ? detail.driverInfo.mobile
            : 'Uknown',
        'Deliveryman Email':
          detail &&
          detail.driverInfo &&
          detail.driverInfo.email &&
          detail.driverInfo.email !== null &&
          detail.driverInfo.email !== ''
            ? detail.driverInfo.email
            : 'Uknown',
        'Deliveryman Image':
          detail &&
          detail.driverInfo &&
          detail.driverInfo.image &&
          detail.driverInfo.image !== null &&
          detail.driverInfo.image !== ''
            ? detail.driverInfo.image
            : 'Uknown',
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
        'City Id':
          detail &&
          detail.city &&
          detail.city.id &&
          detail.city.id !== null &&
          detail.city.id !== ''
            ? detail.city.id
            : '-',
        'City Name':
          detail &&
          detail.city &&
          detail.city.name &&
          detail.city.name !== null &&
          detail.city.name !== ''
            ? detail.city.name
            : '-',
        'Locality Id':
          detail &&
          detail.locality &&
          detail.locality.id &&
          detail.locality.id !== null &&
          detail.locality.id !== ''
            ? detail.locality.id
            : '-',
        'Locality Name':
          detail &&
          detail.locality &&
          detail.locality.name &&
          detail.locality.name !== null &&
          detail.locality.name !== ''
            ? detail.locality.name
            : '-',
        Latitude: detail.location.coordinates[1] || 0,
        Longitude: detail.location.coordinates[0] || 0,
        Type: detail.type,
        'Order Handling': detail.orderHandling,
        'Is Blocked': detail.isBlocked ? 'Yes' : 'No',
        'Is Active': detail.activeStatus ? 'Yes' : 'No',
        Rating: detail.rating,
        'Total Rating': detail.totalRating,
        'Offline Id':
          detail &&
          detail.offline &&
          detail.offline.id &&
          detail.offline.id !== null &&
          detail.offline.id !== ''
            ? detail.offline.id
            : '-',
        'Offline Reason':
          detail &&
          detail.offline &&
          detail.offline.name &&
          detail.offline.name !== null &&
          detail.offline.name !== ''
            ? detail.offline.name
            : '-',
        'Joining Date': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
        Status: detail.status ? 'Active' : 'Deactivated',
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await driverService.exportVendorDeliverymanRawCollection(search);
    const downloadPath = path.join(__dirname, `../templates/downloads/vendordeliverymans.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'vendordeliverymans.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportDeliverymanFundCollection = catchAsync(async (req, res) => {
  const { query, type } = req.params;
  if (type !== 'raw') {
    const result = await driverService.exportDeliverymanFundCollection(query);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        walletUUID:
          detail &&
          detail.wallets &&
          detail.wallets.uuid &&
          detail.wallets.uuid !== null &&
          detail.wallets.uuid !== ''
            ? detail.wallets.uuid
            : '-',
        walletId:
          detail &&
          detail.wallets &&
          detail.wallets.id &&
          detail.wallets.id !== null &&
          detail.wallets.id !== ''
            ? detail.wallets.id
            : '-',
        walletBalance:
          detail &&
          detail.wallets &&
          detail.wallets.balance &&
          detail.wallets.balance !== null &&
          detail.wallets.balance !== ''
            ? detail.wallets.balance
            : 0,
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('DeliverymanFunds');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'First Name', key: 'firstName' },
        { header: 'Last Name', key: 'lastName' },
        { header: 'Email', key: 'email' },
        { header: 'Role', key: 'role' },
        { header: 'Image', key: 'image' },
        { header: 'Wallet Balance', key: 'walletBalance' },
        { header: 'Wallet UUID', key: 'walletUUID' },
        { header: 'Wallet Id', key: 'walletId' },
        { header: 'Order Count', key: 'orderCount' },
        { header: 'Order Earning', key: 'orderEarning' },
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
        'First Name': detail.firstName,
        'Last Name': detail.lastName,
        Email: detail.email,
        Role: detail.role,
        Image: detail.image,
        'Wallet Balance':
          detail &&
          detail.wallets &&
          detail.wallets.balance &&
          detail.wallets.balance !== null &&
          detail.wallets.balance !== ''
            ? detail.wallets.balance
            : 0,
        'Wallet UUID':
          detail &&
          detail.wallets &&
          detail.wallets.uuid &&
          detail.wallets.uuid !== null &&
          detail.wallets.uuid !== ''
            ? detail.wallets.uuid
            : '-',
        'Wallet Id':
          detail &&
          detail.wallets &&
          detail.wallets.id &&
          detail.wallets.id !== null &&
          detail.wallets.id !== ''
            ? detail.wallets.id
            : '-',
        'Order Count': detail.orderEarning,
        'Order Earning': detail.orderEarning,
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await driverService.exportRawDeliverymanFundCollection(query);
    const downloadPath = path.join(__dirname, `../templates/downloads/deliverymanfunds.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'deliverymanfunds.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportDeliverymanReportCollection = catchAsync(async (req, res) => {
  const options = pick(req.query, ['kind', 'type', 'city', 'search']);
  const { exportType } = req.query;
  const result = await driverService.exportDeliverymanReportCollection(options);
  if (exportType === 'excel') {
    const mappedResult = result.map((detail, index) => ({
      ...detail,
      serial: index + 1,
      walletUUID:
        detail &&
        detail.wallets &&
        detail.wallets.uuid &&
        detail.wallets.uuid !== null &&
        detail.wallets.uuid !== ''
          ? detail.wallets.uuid
          : '-',
      walletId:
        detail &&
        detail.wallets &&
        detail.wallets.id &&
        detail.wallets.id !== null &&
        detail.wallets.id !== ''
          ? detail.wallets.id
          : '-',
      walletBalance:
        detail &&
        detail.wallets &&
        detail.wallets.balance &&
        detail.wallets.balance !== null &&
        detail.wallets.balance !== ''
          ? detail.wallets.balance
          : 0,
      cityId:
        detail && detail.city && detail.city.id && detail.city.id !== null && detail.city.id !== ''
          ? detail.city.id
          : '-',
      cityName:
        detail &&
        detail.city &&
        detail.city.name &&
        detail.city.name !== null &&
        detail.city.name !== ''
          ? detail.city.name
          : '-',
      localityId:
        detail &&
        detail.locality &&
        detail.locality.id &&
        detail.locality.id !== null &&
        detail.locality.id !== ''
          ? detail.locality.id
          : '-',
      localityName:
        detail &&
        detail.locality &&
        detail.locality.name &&
        detail.locality.name !== null &&
        detail.locality.name !== ''
          ? detail.locality.name
          : '-',
      driverId:
        detail &&
        detail.driverInfo &&
        detail.driverInfo.id &&
        detail.driverInfo.id !== null &&
        detail.driverInfo.id !== ''
          ? detail.driverInfo.id
          : '-',
      driverType:
        detail &&
        detail.driverInfo &&
        detail.driverInfo.type &&
        detail.driverInfo.type !== null &&
        detail.driverInfo.type !== ''
          ? detail.driverInfo.type
          : '-',
      driverRating:
        detail &&
        detail.driverInfo &&
        detail.driverInfo.rating &&
        detail.driverInfo.rating !== null &&
        detail.driverInfo.rating !== ''
          ? detail.driverInfo.rating
          : 0,
      createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
    }));
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('DeliverymanReport');
    worksheet.columns = [
      { header: 'S. No.', key: 'serial' },
      { header: 'Id', key: 'id' },
      { header: 'Driver Id', key: 'driverId' },
      { header: 'Driver Type', key: 'driverType' },
      { header: 'First Name', key: 'firstName' },
      { header: 'Last Name', key: 'lastName' },
      { header: 'Email', key: 'email' },
      { header: 'Country Code', key: 'countryCode' },
      { header: 'Mobile', key: 'mobile' },
      { header: 'Role', key: 'role' },
      { header: 'Wallet UUID', key: 'walletUUID' },
      { header: 'Wallet Id', key: 'walletId' },
      { header: 'Wallet Balance', key: 'walletBalance' },
      { header: 'City Id', key: 'cityId' },
      { header: 'City Name', key: 'cityName' },
      { header: 'Locality Id', key: 'localityId' },
      { header: 'Locality Name', key: 'localityName' },
      { header: 'Driver Rating', key: 'driverRating' },
      { header: 'Total Rating', key: 'totalRating' },
      { header: 'Total Earning', key: 'totalEarning' },
      { header: 'Tip Amount', key: 'tipAmount' },
      { header: 'Incentive Amount', key: 'incentiveAmount' },
      { header: 'Extra Earning On Shift Amount', key: 'extraEarningOnShiftAmount' },
      { header: 'Delivered Orders', key: 'deliveredOrders' },
      { header: 'Rejected Order', key: 'rejectedOrder' },
      { header: 'Cancelled Order', key: 'cancelledOrder' },
      { header: 'Delayed Order', key: 'delayedOrder' },
      { header: 'Joining Date', key: 'createdAt' },
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
      'Driver Id':
        detail &&
        detail.driverInfo &&
        detail.driverInfo.id &&
        detail.driverInfo.id !== null &&
        detail.driverInfo.id !== ''
          ? detail.driverInfo.id
          : '-',
      'Driver Type':
        detail &&
        detail.driverInfo &&
        detail.driverInfo.type &&
        detail.driverInfo.type !== null &&
        detail.driverInfo.type !== ''
          ? detail.driverInfo.type
          : '-',
      'First Name': detail.firstName,
      'Last Name': detail.lastName,
      Email: detail.email,
      'Country Code': detail.countryCode,
      Mobile: detail.mobile,
      Role: detail.role,
      'Wallet UUID':
        detail &&
        detail.wallets &&
        detail.wallets.uuid &&
        detail.wallets.uuid !== null &&
        detail.wallets.uuid !== ''
          ? detail.wallets.uuid
          : '-',
      'Wallet Id':
        detail &&
        detail.wallets &&
        detail.wallets.id &&
        detail.wallets.id !== null &&
        detail.wallets.id !== ''
          ? detail.wallets.id
          : '-',
      'Wallet Balance':
        detail &&
        detail.wallets &&
        detail.wallets.balance &&
        detail.wallets.balance !== null &&
        detail.wallets.balance !== ''
          ? detail.wallets.balance
          : 0,
      'City Id':
        detail && detail.city && detail.city.id && detail.city.id !== null && detail.city.id !== ''
          ? detail.city.id
          : '-',
      'City Name':
        detail &&
        detail.city &&
        detail.city.name &&
        detail.city.name !== null &&
        detail.city.name !== ''
          ? detail.city.name
          : '-',
      'Locality Id':
        detail &&
        detail.locality &&
        detail.locality.id &&
        detail.locality.id !== null &&
        detail.locality.id !== ''
          ? detail.locality.id
          : '-',
      'Locality Name':
        detail &&
        detail.locality &&
        detail.locality.name &&
        detail.locality.name !== null &&
        detail.locality.name !== ''
          ? detail.locality.name
          : '-',
      'Driver Rating':
        detail &&
        detail.driverInfo &&
        detail.driverInfo.rating &&
        detail.driverInfo.rating !== null &&
        detail.driverInfo.rating !== ''
          ? detail.driverInfo.rating
          : 0,
      'Total Rating': detail.totalRating,
      'Total Earning': detail.totalEarning,
      'Tip Amount': detail.tipAmount,
      'Incentive Amount': detail.incentiveAmount,
      'Extra Earning On Shift Amount': detail.extraEarningOnShiftAmount,
      'Delivered Orders': detail.deliveredOrders,
      'Rejected Order': detail.rejectedOrder,
      'Cancelled Order': detail.cancelledOrder,
      'Delayed Order': detail.delayedOrder,
      'Joining Date': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
    }));
    const csv = Papa.unparse(fieldItems);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
    res.send(csv);
  }
});

const importSystemDeliverymanCollection = catchAsync(async (req, res) => {
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
              importKeys.length === systemDeliverymanSchemaKeys.length &&
              importKeys.every((item) => systemDeliverymanSchemaKeys.includes(item));
            if (validSchema) {
              const result = await driverService.importSystemDeliverymanCollection(records);
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
                    importKeys.length === systemDeliverymanSchemaKeys.length &&
                    importKeys.every((item) => systemDeliverymanSchemaKeys.includes(item));
                  if (validSchema) {
                    const result = await driverService.importSystemDeliverymanCollection(records);
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

const importVendorDeliverymanCollection = catchAsync(async (req, res) => {
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
              importKeys.length === vendorDeliverymanSchemaKeys.length &&
              importKeys.every((item) => vendorDeliverymanSchemaKeys.includes(item));
            if (validSchema) {
              const result = await driverService.importVendorDeliverymanCollection(records);
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
                    importKeys.length === vendorDeliverymanSchemaKeys.length &&
                    importKeys.every((item) => vendorDeliverymanSchemaKeys.includes(item));
                  if (validSchema) {
                    const result = await driverService.importVendorDeliverymanCollection(records);
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
  registerDriverAccount,
  registerVendorDriverAccount,
  getBasicData,
  get,
  updateStatus,
  getById,
  update,
  getMyDriver,
  goOfflnie,
  goOnline,
  getNearMeActiveDriver,
  getVendorDriverBasicData,
  updateMyLocation,
  getMyZone,
  getAllVendorDriverList,
  getDeliverymanFromCity,
  getDeliverymanCashInHand,
  clearCashInHand,
  getDeliveryDepositeDetail,
  getBasicDataRegisterRequest,
  // getLocalitiesList,
  deliverymanInsight,
  deliverymanWalletFundList,
  deliverymanReport,
  vendorDeliverymanList,
  deliverymanInformation,
  cityMapDialogDeliveryman,
  supportTeamDeliverymanList,
  cityzenSystemDriver,
  cityzenVendorDriverList,
  cityzenBasicData,
  cityzenDeliverymanGetById,
  cityzenUpdate,
  cityzenRegisterDriverAccount,
  cityzenDeliverymanList,
  exportSystemDeliverymanCollection,
  exportVendorDeliverymanCollection,
  exportDeliverymanFundCollection,
  exportDeliverymanReportCollection,
  importSystemDeliverymanCollection,
  importVendorDeliverymanCollection,
};

