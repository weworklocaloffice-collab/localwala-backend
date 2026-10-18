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
const { status: httpStatus } = require('http-status');
const catchAsync = require('../utils/catchAsync');
const pick = require('../utils/pick');
const {
  deliverymanJoiningRequestService,
  userService,
  cityService,
  vehicleService,
  emailConfigService,
  walletService,
  driverService,
} = require('../services');
const { Wallet } = require('../models');

const createRequest = catchAsync(async (req, res) => {
  const auth = await userService.checkUserRegisterStatus(req.body);
  if (auth && auth.success === true) {
    await deliverymanJoiningRequestService.createDeliverymanJoiningRequest(req.body);
    res.status(201).send({ success: true });
  } else {
    res.status(400).send({
      code: 400,
      message: 'Something went wrong, please contact administrator',
      extra: '',
    });
  }
});

const getJoiningRequestList = catchAsync(async (req, res) => {
  const { status } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await deliverymanJoiningRequestService.getJoiningRequestList(options, status);
  res.send(result);
});

const cityzentJoiningRequestList = catchAsync(async (req, res) => {
  const { status, master } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await deliverymanJoiningRequestService.cityzentJoiningRequestList(
    master,
    options,
    status
  );
  res.send(result);
});

const getDetail = catchAsync(async (req, res) => {
  const { id } = req.params;
  const info = await deliverymanJoiningRequestService.getDetail(id);
  const cities = await cityService.listAllCities();
  const vehicles = await vehicleService.listAllVehicle();
  res.send({ info, cities, vehicles });
});

const cityzenGetDetail = catchAsync(async (req, res) => {
  const { id } = req.params;
  const info = await deliverymanJoiningRequestService.getDetail(id);
  const vehicles = await vehicleService.listAllVehicle();
  res.send({ info, vehicles });
});

const deleteRequest = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await deliverymanJoiningRequestService.deleteRequest(id);
  res.send(result);
});

const rejectRequest = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { rejection } = req.body;
  const result = await deliverymanJoiningRequestService.rejectRequest(id);
  if (result !== null && result.id === id) {
    const { email, locale } = result;
    await emailConfigService.sendDeliverymanRegisterRequestRejectionEmail(email, locale, rejection);
  }
  res.send({ success: true });
});

const approveRequest = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await deliverymanJoiningRequestService.getDeepDetail(id);
  if (result !== null && result.password !== null) {
    req.body.password = result.password;
    // res.send(req.body);
    const user = await userService.createDriverAccount(req.body);
    const walletData = new Wallet({
      holderId: user.id,
    });
    await walletService.createWallet(walletData);
    req.body.userId = user.id;
    await driverService.createDriver(req.body);
    const { email, locale } = result;
    await deliverymanJoiningRequestService.deleteRequest(id);
    await emailConfigService.sendDeliverymanRegisterRequestApprovedEmail(email, locale);
    res.status(201).send({ success: true });
  } else {
    res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
  }
});

const cityzenApproveRequest = catchAsync(async (req, res) => {
  const { id, master } = req.params;
  const result = await deliverymanJoiningRequestService.getDeepDetail(id);
  if (result !== null && result.password !== null) {
    req.body.password = result.password;
    // res.send(req.body);
    const user = await userService.createDriverAccount(req.body);
    const walletData = new Wallet({
      holderId: user.id,
    });
    await walletService.createWallet(walletData);
    req.body.userId = user.id;
    await driverService.cityzenCreateDriver(master, req.body);
    const { email, locale } = result;
    await deliverymanJoiningRequestService.deleteRequest(id);
    await emailConfigService.sendDeliverymanRegisterRequestApprovedEmail(email, locale);
    res.status(201).send({ success: true });
  } else {
    res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
  }
});

const exportCollection = catchAsync(async (req, res) => {
  const { type, status, search } = req.query;
  if (type !== 'raw') {
    const result = await deliverymanJoiningRequestService.exportCollection(status, search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        status: detail.status ? 'Active' : 'Deactivated',
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
        vehicleId:
          detail &&
          detail.vehicleInfo &&
          detail.vehicleInfo.id &&
          detail.vehicleInfo.id !== null &&
          detail.vehicleInfo.id !== ''
            ? detail.vehicleInfo.id
            : '-',
        vehicleName:
          detail &&
          detail.vehicleInfo &&
          detail.vehicleInfo.name &&
          detail.vehicleInfo.name !== null &&
          detail.vehicleInfo.name !== ''
            ? detail.vehicleInfo.name
            : '-',
        createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
        dob: DateTime.fromISO(detail.dob).toFormat('dd LLL yyyy'),
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('DeliverymanJoiningRequest');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'First Name', key: 'firstName' },
        { header: 'Last Name', key: 'lastName' },
        { header: 'Email', key: 'email' },
        { header: 'Country Code', key: 'countryCode' },
        { header: 'Mobile', key: 'mobile' },
        { header: 'City Id', key: 'cityId' },
        { header: 'City Name', key: 'cityName' },
        { header: 'Locality Id', key: 'localityId' },
        { header: 'Locality Name', key: 'localityName' },
        { header: 'Latitude', key: 'latitude' },
        { header: 'Longitude', key: 'longitude' },
        { header: 'Vehicle Id', key: 'vehicleId' },
        { header: 'Vehicle Name', key: 'vehicleName' },
        { header: 'Cover', key: 'cover' },
        { header: 'Identity', key: 'identity' },
        { header: 'Identity Number', key: 'identityNumber' },
        { header: 'Identity Proof', key: 'identityProof' },
        { header: 'Driving License', key: 'drivingLicense' },
        { header: 'Age', key: 'age' },
        { header: 'Date Of Birth', key: 'dob' },
        { header: 'Type', key: 'type' },
        { header: 'Requested On', key: 'createdAt' },
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
        'First Name': detail.firstName,
        'Last Name': detail.lastName,
        Email: detail.email,
        'Country Code': detail.countryCode,
        Mobile: detail.mobile,
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
        'Vehicle Id':
          detail &&
          detail.vehicleInfo &&
          detail.vehicleInfo.id &&
          detail.vehicleInfo.id !== null &&
          detail.vehicleInfo.id !== ''
            ? detail.vehicleInfo.id
            : '-',
        'Vehicle Name':
          detail &&
          detail.vehicleInfo &&
          detail.vehicleInfo.name &&
          detail.vehicleInfo.name !== null &&
          detail.vehicleInfo.name !== ''
            ? detail.vehicleInfo.name
            : '-',
        Cover: detail.cover,
        Identity: detail.identity,
        'Identity Number': detail.identityNumber,
        'Identity Proof': detail.identityProof,
        'Driving License': detail.drivingLicense,
        Age: detail.age,
        'Date Of Birth': DateTime.fromISO(detail.dob).toFormat('dd LLL yyyy'),
        Type: detail.type,
        'Requested On': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
        Status: detail.status ? 'Active' : 'Deactivated',
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await deliverymanJoiningRequestService.exportRawCollection(status, search);
    const downloadPath = path.join(
      __dirname,
      `../templates/downloads/deliverymanjoiningrequests.json`
    );
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'deliverymanjoiningrequests.json', (err) => {
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
  createRequest,
  getJoiningRequestList,
  deleteRequest,
  getDetail,
  rejectRequest,
  approveRequest,
  cityzentJoiningRequestList,
  cityzenGetDetail,
  cityzenApproveRequest,
  exportCollection,
};

