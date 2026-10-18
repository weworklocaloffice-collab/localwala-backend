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
const ExcelJS = require('exceljs');
const Papa = require('papaparse');
const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');
const catchAsync = require('../utils/catchAsync');
const pick = require('../utils/pick');
const {
  restaurantJoiningRequestService,
  subscriptionService,
  paymentInitiationService,
  cuisineService,
  cityService,
  restaurantFoodLicenseService,
  restaurantTypeService,
  restaurantFacilitiesService,
  emailConfigService,
  userService,
  walletService,
  restaurantService,
  subscriberService,
} = require('../services');
const { Wallet } = require('../models');

const createRequest = catchAsync(async (req, res) => {
  const { businessType, subscriptionId, paymentId } = req.body;
  if (req && req.body && req.body.cuisine && req.body.cuisine !== '') {
    req.body.cuisine = req.body.cuisine.split(',');
  } else {
    req.body.cuisine = [];
  }
  if (req && req.body && req.body.restaurantType && req.body.restaurantType !== '') {
    req.body.restaurantType = req.body.restaurantType.split(',');
  } else {
    req.body.restaurantType = [];
  }
  if (req && req.body && req.body.restaurantFacility && req.body.restaurantFacility !== '') {
    req.body.restaurantFacility = req.body.restaurantFacility.split(',');
  } else {
    req.body.restaurantFacility = [];
  }
  let payCharge = 0;
  let isValid = true;
  if (businessType === 'subscription') {
    const subscriptionInfo = await subscriptionService.getById(subscriptionId);
    if (paymentId === 'trial' && subscriptionInfo.haveTrial === true) {
      payCharge = 0;
    } else if (paymentId === 'trial' && subscriptionInfo.haveTrial === false) {
      isValid = false;
    } else if (paymentId !== 'trial') {
      if (parseFloat(subscriptionInfo.discount) > 0) {
        const payChargeAmount = parseFloat(
          (parseFloat(subscriptionInfo.price).toFixed(2) *
            parseFloat(subscriptionInfo.discount).toFixed(2)) /
            100
        ).toFixed(2);
        const payChargeFinalPrice = (
          parseFloat(subscriptionInfo.price) - parseFloat(payChargeAmount)
        ).toFixed(2);
        payCharge = parseFloat(payChargeFinalPrice);
      } else {
        payCharge = subscriptionInfo.price;
      }
    }
  }
  if (isValid === true) {
    const result = await restaurantJoiningRequestService.createRestaurantJoiningRequest(
      req.body,
      payCharge
    );
    if (payCharge !== 0) {
      const paymentMeta = {
        payment: `${paymentId}`,
        restaurantRegisterRequest: `${result.id}`,
        amount: parseFloat(payCharge),
        from: 'restaurant_register',
        ref: `restaurant register request for #${result.id}`,
        redirect:
          req &&
          req.body &&
          req.body.redirect &&
          req.body.redirect !== null &&
          req.body.redirect !== ''
            ? req.body.redirect
            : '',
      };
      const paymentLink = await paymentInitiationService.initiatePayment(paymentMeta);
      if (paymentLink !== null && paymentLink.id !== '') {
        res
          .status(201)
          .send({ id: result.id, success: true, status: 'online', payLink: paymentLink.id });
      } else {
        res.status(400).send({
          code: 400,
          message: 'Something went wrong, please contact administrator',
          extra: '',
        });
      }
    } else {
      res.status(201).send({ id: result.id, success: true, status: 'offline', payLink: '' });
    }
  } else {
    res.status(400).send({
      code: 400,
      message: `Oops! Looks like you've applied a trial subscription package, and it is not available as of now, please select payment method!`,
    });
  }
});

const getJoiningRequestList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const { status } = req.params;
  const result = await restaurantJoiningRequestService.getJoiningRequestList(options, status);
  res.send(result);
});

const cityzenJoiningRequestList = catchAsync(async (req, res) => {
  const { status, master } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await restaurantJoiningRequestService.cityzenJoiningRequestList(
    master,
    options,
    status
  );
  res.send(result);
});

const deleteRequest = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await restaurantJoiningRequestService.deleteRequest(id);
  res.send(result);
});

const getDetail = catchAsync(async (req, res) => {
  const { id } = req.params;
  const info = await restaurantJoiningRequestService.getDetail(id);
  const cuisine = await cuisineService.getCuisineListForNewRestaurant();
  const cities = await cityService.getCitiesListForNewRestaurant();
  const subscription = await subscriptionService.getSubscriptionListForNewRestaurant();
  const licenses = await restaurantFoodLicenseService.getLicenseListForNewRestaurant();
  const types = await restaurantTypeService.getRestaurantTypeListForNewRestaurant();
  const facilities = await restaurantFacilitiesService.getFacilitiesListForNewRestaurant();
  res.send({ cuisine, cities, subscription, info, licenses, types, facilities });
});

const cityzenGetDetail = catchAsync(async (req, res) => {
  const { id } = req.params;
  const info = await restaurantJoiningRequestService.getDetail(id);
  const cuisine = await cuisineService.getCuisineListForNewRestaurant();
  const subscription = await subscriptionService.getSubscriptionListForNewRestaurant();
  const licenses = await restaurantFoodLicenseService.getLicenseListForNewRestaurant();
  const types = await restaurantTypeService.getRestaurantTypeListForNewRestaurant();
  const facilities = await restaurantFacilitiesService.getFacilitiesListForNewRestaurant();
  res.send({ cuisine, subscription, info, licenses, types, facilities });
});

const rejectRequest = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { rejection } = req.body;
  const result = await restaurantJoiningRequestService.rejectRequest(id);
  if (result !== null && result.id === id) {
    const { email, locale } = result;
    await emailConfigService.sendRestaurantRegisterRequestRejectionEmail(email, locale, rejection);
  }
  res.send({ success: true });
});

const approveRequest = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await restaurantJoiningRequestService.getDeepDetail(id);
  if (result !== null && result.password !== null) {
    req.body.password = result.password;
    const user = await userService.createVendorAccount(req.body);
    const walletData = new Wallet({
      holderId: user.id,
    });
    await walletService.createWallet(walletData);
    req.body.userId = user.id;
    if (req && req.body && req.body.cuisine && req.body.cuisine !== '') {
      req.body.cuisine = req.body.cuisine.split(',');
    } else {
      req.body.cuisine = [];
    }
    if (req && req.body && req.body.restaurantType && req.body.restaurantType !== '') {
      req.body.restaurantType = req.body.restaurantType.split(',');
    } else {
      req.body.restaurantType = [];
    }
    if (req && req.body && req.body.restaurantFacility && req.body.restaurantFacility !== '') {
      req.body.restaurantFacility = req.body.restaurantFacility.split(',');
    } else {
      req.body.restaurantFacility = [];
    }
    const restaurant = await restaurantService.createRestaurant(req.body);
    let serverTrailStartDate;
    let serverTrailEndDate;
    let serverStartDate;
    let serverEndDate;
    if (result !== null && result.businessType === 'subscription' && result.paidAmount !== 0) {
      const subscription = await subscriptionService.getById(req.body.subscription);
      const now = DateTime.now();
      serverStartDate = now.toFormat('yyyy-MM-dd');
      serverEndDate = now.plus({ days: subscription.validity }).toFormat('yyyy-MM-dd');
      const subscriptionData = {
        subscriptions: req.body.subscription,
        restaurant: restaurant.id,
        trialStartDate: '',
        trialEndDate: '',
        startDate: serverStartDate,
        endDate: serverEndDate,
      };
      await subscriberService.createSubscriber(subscriptionData);
    } else if (
      result !== null &&
      result.businessType === 'subscription' &&
      result.paidAmount === 0
    ) {
      const subscription = await subscriptionService.getById(req.body.subscription);
      const now = DateTime.now();
      serverTrailStartDate = now.toFormat('yyyy-MM-dd');
      serverTrailEndDate = now.plus({ days: subscription.trialValidity }).toFormat('yyyy-MM-dd');
      const subscriptionData = {
        subscriptions: req.body.subscription,
        restaurant: restaurant.id,
        trialStartDate: serverTrailStartDate,
        trialEndDate: serverTrailEndDate,
        startDate: '',
        endDate: '',
      };
      await subscriberService.createSubscriber(subscriptionData);
    }
    const { email, locale } = result;
    await restaurantJoiningRequestService.deleteRequest(id);
    await emailConfigService.sendRestaurantRegisterRequestApprovedEmail(email, locale);
    res.send({ success: true });
  } else {
    res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
  }
});

const cityzenApproveRequest = catchAsync(async (req, res) => {
  const { id, master } = req.params;
  const result = await restaurantJoiningRequestService.getDeepDetail(id);
  if (result !== null && result.password !== null) {
    req.body.password = result.password;
    const user = await userService.createVendorAccount(req.body);
    const walletData = new Wallet({
      holderId: user.id,
    });
    await walletService.createWallet(walletData);
    req.body.userId = user.id;
    if (req && req.body && req.body.cuisine && req.body.cuisine !== '') {
      req.body.cuisine = req.body.cuisine.split(',');
    } else {
      req.body.cuisine = [];
    }
    if (req && req.body && req.body.restaurantType && req.body.restaurantType !== '') {
      req.body.restaurantType = req.body.restaurantType.split(',');
    } else {
      req.body.restaurantType = [];
    }
    if (req && req.body && req.body.restaurantFacility && req.body.restaurantFacility !== '') {
      req.body.restaurantFacility = req.body.restaurantFacility.split(',');
    } else {
      req.body.restaurantFacility = [];
    }
    const restaurant = await restaurantService.cityzenCreateRestaurant(master, req.body);
    let serverTrailStartDate;
    let serverTrailEndDate;
    let serverStartDate;
    let serverEndDate;
    if (result !== null && result.businessType === 'subscription' && result.paidAmount !== 0) {
      const subscription = await subscriptionService.getById(req.body.subscription);
      const now = DateTime.now();
      serverStartDate = now.toFormat('yyyy-MM-dd');
      serverEndDate = now.plus({ days: subscription.validity }).toFormat('yyyy-MM-dd');
      const subscriptionData = {
        subscriptions: req.body.subscription,
        restaurant: restaurant.id,
        trialStartDate: '',
        trialEndDate: '',
        startDate: serverStartDate,
        endDate: serverEndDate,
      };
      await subscriberService.createSubscriber(subscriptionData);
    } else if (
      result !== null &&
      result.businessType === 'subscription' &&
      result.paidAmount === 0
    ) {
      const subscription = await subscriptionService.getById(req.body.subscription);
      const now = DateTime.now();
      serverTrailStartDate = now.toFormat('yyyy-MM-dd');
      serverTrailEndDate = now.plus({ days: subscription.trialValidity }).toFormat('yyyy-MM-dd');
      const subscriptionData = {
        subscriptions: req.body.subscription,
        restaurant: restaurant.id,
        trialStartDate: serverTrailStartDate,
        trialEndDate: serverTrailEndDate,
        startDate: '',
        endDate: '',
      };
      await subscriberService.createSubscriber(subscriptionData);
    }
    const { email, locale } = result;
    await restaurantJoiningRequestService.deleteRequest(id);
    await emailConfigService.sendRestaurantRegisterRequestApprovedEmail(email, locale);
    res.send({ success: true });
  } else {
    res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
  }
});

const exportCollection = catchAsync(async (req, res) => {
  const { type, status, search } = req.query;
  if (type !== 'raw') {
    const result = await restaurantJoiningRequestService.exportCollection(status, search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        latitude: detail.location.coordinates[1] || 0,
        longitude: detail.location.coordinates[0] || 0,
        takeAway: detail.takeAway ? 'Yes' : 'No',
        acceptScheduleDelivery: detail.acceptScheduleDelivery ? 'Yes' : 'No',
        acceptHomeDelivery: detail.acceptHomeDelivery ? 'Yes' : 'No',
        cityName:
          detail &&
          detail.city &&
          detail.city.name &&
          detail.city.name !== null &&
          detail.city.name !== ''
            ? detail.city.name
            : '-',
        localityName:
          detail &&
          detail.locality &&
          detail.locality.name &&
          detail.locality.name !== null &&
          detail.locality.name !== ''
            ? detail.locality.name
            : '-',
        licenseName:
          detail &&
          detail.license &&
          detail.license.name &&
          detail.license.name !== null &&
          detail.license.name !== ''
            ? detail.license.name
            : '-',
        subscriptionName:
          detail &&
          detail.subscriptionInfo &&
          detail.subscriptionInfo.name &&
          detail.subscriptionInfo.name !== null &&
          detail.subscriptionInfo.name !== ''
            ? detail.subscriptionInfo.name
            : '-',
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('RestaurantJoiningRequest');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'First Name', key: 'firstName' },
        { header: 'Last Name', key: 'lastName' },
        { header: 'Country Code', key: 'countryCode' },
        { header: 'Mobile', key: 'mobile' },
        { header: 'Email', key: 'email' },
        { header: 'Name', key: 'name' },
        { header: 'Address', key: 'address' },
        { header: 'Logo', key: 'logo' },
        { header: 'Cover', key: 'cover' },
        { header: 'City', key: 'cityName' },
        { header: 'Locality', key: 'localityName' },
        { header: 'Latitude', key: 'latitude' },
        { header: 'Longitude', key: 'longitude' },
        { header: 'Accept Schedule Delivery', key: 'acceptScheduleDelivery' },
        { header: 'Accept Home Delivery', key: 'acceptHomeDelivery' },
        { header: 'TakeAway', key: 'takeAway' },
        { header: 'License Name', key: 'licenseName' },
        { header: 'License Id', key: 'licenseId' },
        { header: 'Appx Delivery Time', key: 'approxDeliveryTime' },
        { header: 'Dish Price For Two', key: 'dishPriceForTwo' },
        { header: 'Min Order Amount', key: 'minOrderAmount' },
        { header: 'Paid Amount', key: 'paidAmount' },
        { header: 'Facebook Handle', key: 'socialFacebook' },
        { header: 'Instagram Handle', key: 'socialInstagram' },
        { header: 'X Handle', key: 'socialX' },
        { header: 'Youtube Handle', key: 'socialYoutube' },
        { header: 'LinkedIn Handle', key: 'socialLinkedIn' },
        { header: 'Pinterest Handle', key: 'socialPinterest' },
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
        'Country Code': detail.countryCode,
        Mobile: detail.mobile,
        Email: detail.email,
        Name: detail.name,
        Address: detail.address,
        Logo: detail.logo,
        Cover: detail.cover,
        City:
          detail &&
          detail.city &&
          detail.city.name &&
          detail.city.name !== null &&
          detail.city.name !== ''
            ? detail.city.name
            : '-',
        Locality:
          detail &&
          detail.locality &&
          detail.locality.name &&
          detail.locality.name !== null &&
          detail.locality.name !== ''
            ? detail.locality.name
            : '-',
        Latitude: detail.location.coordinates[1] || 0,
        Longitude: detail.location.coordinates[0] || 0,
        'Accept Schedule Delivery': detail.acceptScheduleDelivery ? 'Yes' : 'No',
        'Accept Home Delivery': detail.acceptHomeDelivery ? 'Yes' : 'No',
        TakeAway: detail.takeAway ? 'Yes' : 'No',
        'License Name':
          detail &&
          detail.locality &&
          detail.locality.name &&
          detail.locality.name !== null &&
          detail.locality.name !== ''
            ? detail.locality.name
            : '-',
        'License Id': detail.licenseId,
        'Appx Delivery Time': detail.approxDeliveryTime,
        'Dish Price For Two': detail.dishPriceForTwo,
        'Min Order Amount': detail.minOrderAmount,
        'Paid Amount': detail.paidAmount,
        'Facebook Handle': detail.socialFacebook,
        'Instagram Handle': detail.socialInstagram,
        'X Handle': detail.socialX,
        'Youtube Handle': detail.socialYoutube,
        'LinkedIn Handle': detail.socialLinkedIn,
        'Pinterest Handle': detail.socialPinterest,
        Status: detail.status,
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await restaurantJoiningRequestService.exportRawCollection(status, search);
    const downloadPath = path.join(
      __dirname,
      `../templates/downloads/restaurantjoiningrequests.json`
    );
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'restaurantjoiningrequests.json', (err) => {
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
  cityzenJoiningRequestList,
  cityzenGetDetail,
  cityzenApproveRequest,
  exportCollection,
};

