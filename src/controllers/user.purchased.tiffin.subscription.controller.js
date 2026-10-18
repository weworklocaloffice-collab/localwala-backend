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
const { chromium } = require('playwright');
const Handlebars = require('handlebars');
const {
  userPurchasedTiffinSubscriptionService,
  paymentConfigService,
  paymentInitiationService,
  subscriptionTiffinPackageService,
  userAddressService,
} = require('../services');
const pick = require('../utils/pick');
const catchAsync = require('../utils/catchAsync');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');
const uploadMiddleware = require('../middlewares/upload');
const config = require('../config/config');
const { tiffinSubscriptionPurchasedSchemaKeys } = require('../utils/importCollectionSchema');
const apiLocaleTranslations = require('../utils/translate');
const geographicService = require('../kernel/geographic/services/geographic.service');

function randomUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Great-circle distance in metres. Delegates to the kernel (see note in orders.service.js). */
function haversineDistance(coords1, coords2) {
  return geographicService.haversineMeters(coords1[0], coords1[1], coords2[0], coords2[1]);
}

const purchaseTiffinSubscription = catchAsync(async (req, res) => {
  const {
    subscriptionPackage,
    deliveryAddress,
    slot,
    food,
    user,
    payment,
    cookingInstruction,
    deliveryInstruction,
    receiverName,
    countryCode,
    receiverContact,
  } = req.body;
  const slotTime = slot.split('-');
  const startTime = slotTime[0].replaceAll(' ', '');
  const endTime = slotTime[1].replaceAll(' ', '');
  const settings =
    await subscriptionTiffinPackageService.purchaseSubscriptionDetail(subscriptionPackage);
  const indexOfSlot = settings.details.timeSlots.findIndex(
    (x) => x.startTime === startTime && x.endTime === endTime
  );
  let userRawAddress = '';
  let distance = 0;
  const foodIdFromBody = [];
  const foodIdFromSubscription = settings.details.foods.map((m) => m.toString());
  const { canSelectAddon, canSelectVariation } = settings.details;
  let checkAddonIsOk = false;
  let checkVariationIsOk = false;
  const foodItemRaw = [];
  const addonId = [];
  const foodId = [];
  if (food && checkArrayNotEmpty(food)) {
    food.forEach((foodElement) => {
      foodIdFromBody.push(foodElement.id);
      if (canSelectAddon === false || foodElement.addon === '' || foodElement.addon === null) {
        checkAddonIsOk = true;
        foodElement.addonOk = true;
      }
      if (canSelectVariation === false || !checkArrayNotEmpty(foodElement.variations)) {
        checkVariationIsOk = true;
        foodElement.variationOk = true;
      }
      if (checkArrayNotEmpty(settings.foods)) {
        settings.foods.forEach((foodInSubscription) => {
          if (foodInSubscription.id.toString() === foodElement.id.toString()) {
            const cartAddonJSON = [];
            const cartVariationJSON = [];
            const basePrice = Number(parseFloat(foodInSubscription.price).toFixed(2));
            let addonInFoodParamPrice = 0;
            let variationInFoodParamPrice = 0;
            let finalPrice;
            let taxAmount = 0;
            if (foodInSubscription && foodInSubscription.taxationEnable === true) {
              foodInSubscription.foodtaxations.forEach((taxPrice) => {
                taxAmount += parseFloat(taxPrice.taxAmount);
              });
              const taxAmountData = basePrice * (taxAmount / 100);
              finalPrice = parseFloat(basePrice + taxAmountData).toFixed(2);
            } else {
              finalPrice = parseFloat(basePrice).toFixed(2);
            }
            if (canSelectAddon === true && foodElement.addon !== '' && foodElement.addon !== null) {
              const addonInFoodSubscription = [];
              const selectedAddon = foodElement.addon.split(',');
              foodInSubscription.addons.forEach((addonInFoodSubscriptionElement) => {
                addonInFoodSubscription.push(addonInFoodSubscriptionElement.id.toString());
                if (selectedAddon.includes(addonInFoodSubscriptionElement.id.toString())) {
                  const addonDetailInFoodParam = {
                    name: addonInFoodSubscriptionElement.name,
                    status: addonInFoodSubscriptionElement.status,
                    inStock: addonInFoodSubscriptionElement.inStock,
                    stockNumber: addonInFoodSubscriptionElement.stockNumber,
                    stockType: addonInFoodSubscriptionElement.stockType,
                    id: addonInFoodSubscriptionElement.id,
                    price: addonInFoodSubscriptionElement.price,
                    translations: addonInFoodSubscriptionElement.translations,
                  };
                  cartAddonJSON.push(addonDetailInFoodParam);
                  addonInFoodParamPrice += parseFloat(addonInFoodSubscriptionElement.price);
                  if (!addonId.includes(addonInFoodSubscriptionElement.id.toString())) {
                    addonId.push(addonInFoodSubscriptionElement.id.toString());
                  }
                }
              });
              const isAddonOk = selectedAddon.every((item) =>
                addonInFoodSubscription.includes(item)
              );
              foodElement.addonOk = isAddonOk;
            }
            if (canSelectVariation === true && checkArrayNotEmpty(foodElement.variations)) {
              const selectedVariation = [];
              const inFoodVariation = [];
              foodElement.variations.forEach((foodElementVariation) => {
                if (
                  foodElementVariation &&
                  foodElementVariation.selected !== null &&
                  checkArrayNotEmpty(foodElementVariation.selected)
                ) {
                  foodElementVariation.selected.forEach((foodElementVariationOption) => {
                    selectedVariation.push(
                      `${foodElementVariation.variation}-${foodElementVariationOption}`
                    );
                  });
                }
              });
              if (
                foodInSubscription &&
                foodInSubscription.variations &&
                checkArrayNotEmpty(foodInSubscription.variations)
              ) {
                foodInSubscription.variations.forEach((foodElementVariation) => {
                  if (
                    foodElementVariation &&
                    foodElementVariation.options !== null &&
                    checkArrayNotEmpty(foodElementVariation.options)
                  ) {
                    foodElementVariation.options.forEach((foodElementVariationOption) => {
                      inFoodVariation.push(
                        `${foodElementVariation.title}-${foodElementVariationOption.name}`
                      );
                    });
                  }
                });
              }
              const isVariationOk = selectedVariation.every((item) =>
                inFoodVariation.includes(item)
              );
              foodElement.variationOk = isVariationOk;
              foodInSubscription.variations.forEach((foodInfoElementVariation) => {
                if (
                  foodElement &&
                  foodElement.variations &&
                  checkArrayNotEmpty(foodElement.variations)
                ) {
                  foodElement.variations.forEach((inCartItemVariation) => {
                    if (foodInfoElementVariation.title === inCartItemVariation.variation) {
                      const variationParam = {
                        isRequired: foodInfoElementVariation.isRequired,
                        max: foodInfoElementVariation.max,
                        min: foodInfoElementVariation.min,
                        title: foodInfoElementVariation.title,
                        type: foodInfoElementVariation.type,
                        options: [],
                      };
                      cartVariationJSON.push(variationParam);
                      if (
                        foodInfoElementVariation &&
                        foodInfoElementVariation.options &&
                        checkArrayNotEmpty(foodInfoElementVariation.options)
                      ) {
                        foodInfoElementVariation.options.forEach((foodInfoElementOption) => {
                          if (
                            inCartItemVariation &&
                            inCartItemVariation.selected &&
                            checkArrayNotEmpty(inCartItemVariation.selected)
                          ) {
                            if (inCartItemVariation.selected.includes(foodInfoElementOption.name)) {
                              variationParam.options.push(foodInfoElementOption);
                              variationInFoodParamPrice += Number(
                                parseFloat(foodInfoElementOption.price).toFixed(2)
                              );
                            }
                          }
                        });
                      }
                    }
                  });
                }
              });
            }
            finalPrice = Number(
              parseFloat(
                parseFloat(finalPrice) +
                  parseFloat(addonInFoodParamPrice) +
                  parseFloat(variationInFoodParamPrice)
              ).toFixed(2)
            );
            if (parseFloat(foodInSubscription.discount) > 0) {
              if (foodInSubscription.discountType === '%') {
                const discountAmount = parseFloat(
                  (finalPrice * foodInSubscription.discount) / 100
                ).toFixed(2);
                finalPrice = parseFloat(finalPrice - discountAmount).toFixed(2);
              } else {
                finalPrice = parseFloat(
                  parseFloat(finalPrice) - parseFloat(foodInSubscription.discount)
                ).toFixed(2);
              }
            }
            const itemPrice = parseFloat(
              parseFloat(parseFloat(finalPrice).toFixed(2) * 1).toFixed(2)
            );
            const foodParam = {
              name: foodInSubscription.name,
              uuid: randomUUID(),
              addons: canSelectAddon === true ? cartAddonJSON : [],
              variations: canSelectVariation === true ? cartVariationJSON : [],
              discount: foodInSubscription.discount,
              discountType: foodInSubscription.discountType,
              endTime: foodInSubscription.endTime,
              foodType: foodInSubscription.foodType,
              id: foodInSubscription.id,
              foodtaxations: foodInSubscription.foodtaxations,
              image: foodInSubscription.image,
              inStock: foodInSubscription.inStock,
              price: foodInSubscription.price,
              purchaseLimit: foodInSubscription.purchaseLimit,
              quantity: 1,
              restaurant: foodInSubscription.restaurant,
              restaurantInfo: {
                cover: settings.details.restaurants.cover,
                id: settings.details.restaurants.id,
                logo: settings.details.restaurants.logo,
                name: settings.details.restaurants.name,
                slug: settings.details.restaurants.slug,
                translations: settings.details.restaurants.translations,
              },
              shortDescription: foodInSubscription.shortDescription,
              startTime: foodInSubscription.startTime,
              status: foodInSubscription.status,
              taxationEnable: foodInSubscription.taxationEnable,
              totalPrice: itemPrice,
              translations: foodInSubscription.translations,
            };
            foodItemRaw.push(foodParam);
            foodId.push(foodElement.id.toString());
          }
        });
      }
    });
    const validateAddonIndex = food.findIndex((x) => x.addonOk === false);
    const validateVariationIndex = food.findIndex((x) => x.variationOk === false);
    if (canSelectAddon === true && validateAddonIndex === -1) {
      checkAddonIsOk = true;
    }
    if (canSelectVariation === true && validateVariationIndex === -1) {
      checkVariationIsOk = true;
    }
  }
  const isFoodIsThere = foodIdFromBody.every((item) => foodIdFromSubscription.includes(item));
  if (
    settings &&
    settings.details &&
    settings.details !== null &&
    settings.details.orderTo === 'homedelivery' &&
    deliveryAddress !== '' &&
    deliveryAddress !== null
  ) {
    const userAddress = await userAddressService.getUserAddressDetailForCheckout(deliveryAddress);
    if (userAddress && userAddress !== null && userAddress.id === deliveryAddress) {
      userRawAddress = JSON.stringify(userAddress);
      const point1 = userAddress.location.coordinates;
      if (settings && settings.details && settings.details.restaurants) {
        const point2 = settings.details.restaurants.location.coordinates;
        const distanceInMeter = haversineDistance(point1, point2);
        const findMode =
          settings &&
          settings.businessSettings &&
          settings.businessSettings.findMode &&
          settings.businessSettings.findMode !== ''
            ? settings.businessSettings.findMode
            : 'km';
        distance =
          findMode === 'km'
            ? parseFloat(distanceInMeter / 1000).toFixed(2)
            : parseFloat(distanceInMeter / 1609.34).toFixed(2);
      }
    }
  }
  if (
    settings &&
    settings.details &&
    settings.details !== null &&
    settings.details.orderTo === 'homedelivery' &&
    (deliveryAddress === '' || deliveryAddress === null || !deliveryAddress)
  ) {
    res.status(400).send({ code: 400, message: 'Address is missing' });
  } else if (indexOfSlot === -1) {
    res.status(400).send({ code: 400, message: 'Invalid Slot' });
  } else if (parseFloat(distance) > parseFloat(settings.details.deliveryArea)) {
    res.status(400).send({ code: 400, message: 'Can not deliver order to this address' });
  } else if (isFoodIsThere === false) {
    res.status(400).send({ code: 400, message: 'One of the food is not available' });
  } else if (canSelectAddon === true && checkAddonIsOk === false) {
    res.status(400).send({ code: 400, message: 'One of the addon is not available' });
  } else if (canSelectVariation === true && checkVariationIsOk === false) {
    res.status(400).send({ code: 400, message: 'One of the variation is not available' });
  } else {
    let itemTotal;
    let foodServiceTax = 0;
    let serviceTax = 0;
    let packageCharge = 0;
    let packageChargeTax = 0;
    let grandTotal;
    if (settings && settings.details && settings.details.discount > 0) {
      if (settings && settings.details && settings.details.discountType === '%') {
        const discountAmount = parseFloat(
          (parseFloat(settings.details.price) * parseFloat(settings.details.discount)) / 100
        ).toFixed(2);
        itemTotal = parseFloat(parseFloat(settings.details.price) - discountAmount).toFixed(2);
      } else {
        itemTotal = parseFloat(
          parseFloat(settings.details.price) - parseFloat(settings.details.discount)
        ).toFixed(2);
      }
    } else {
      itemTotal = parseFloat(settings.details.price);
    }
    if (
      settings &&
      settings.orderSettings &&
      settings.orderSettings.includeChargesForSubscription === true
    ) {
      if (
        settings &&
        settings.businessSettings &&
        settings.businessSettings.includeTaxOnFood === true
      ) {
        if (
          settings &&
          settings.businessSettings &&
          settings.businessSettings.foodTaxType === 'per'
        ) {
          foodServiceTax = parseFloat(
            (parseFloat(itemTotal) * parseFloat(settings.businessSettings.foodTaxAmount)) / 100
          ).toFixed(2);
        } else {
          foodServiceTax = parseFloat(settings.businessSettings.foodTaxAmount);
        }
      }

      if (
        settings &&
        settings.businessSettings &&
        settings.businessSettings.additionalServiceCharge === true
      ) {
        serviceTax = parseFloat(
          parseFloat(settings.businessSettings.additionalServiceAmount) *
            parseInt(settings.details.totalOrder, 10)
        );
      }

      if (
        settings &&
        settings.restaurantSettings &&
        settings.restaurantSettings.havePackagingCharges === true
      ) {
        packageCharge = parseFloat(
          parseFloat(settings.restaurantSettings.packagingCharges) *
            parseInt(settings.details.totalOrder, 10)
        );
        if (
          settings &&
          settings.restaurantSettings &&
          settings.restaurantSettings.includePackagesChargesInTax === true
        ) {
          const totalTaxAmount = parseFloat(
            (parseFloat(settings.restaurantSettings.packagingCharges) *
              parseFloat(settings.restaurantSettings.packagingChargesTax)) /
              100
          ).toFixed(2);
          packageChargeTax = parseFloat(
            parseFloat(totalTaxAmount) * parseInt(settings.details.totalOrder, 10)
          );
        }
      }
      grandTotal = parseFloat(
        parseFloat(itemTotal) +
          parseFloat(foodServiceTax) +
          parseFloat(serviceTax) +
          parseFloat(packageCharge) +
          parseFloat(packageChargeTax)
      ).toFixed(2);
    } else {
      grandTotal = parseFloat(itemTotal);
      foodServiceTax = 0;
      serviceTax = 0;
      packageCharge = 0;
      packageChargeTax = 0;
    }
    const subscriptionParam = {
      user: `${user}`,
      addons: addonId,
      foods: foodId,
      subscriptionPackage: `${subscriptionPackage}`,
      payment: `${payment}`,
      slot: `${slot}`,
      orderAt: startTime,
      cookingInstruction: `${cookingInstruction}`,
      deliveryInstruction:
        settings.details.orderTo === 'homedelivery' &&
        deliveryInstruction !== null &&
        deliveryInstruction !== ''
          ? deliveryInstruction
          : null,
      deliveryAddress: settings.details.orderTo === 'homedelivery' ? `${deliveryAddress}` : null,
      deliveryAddressRaw: settings.details.orderTo === 'homedelivery' ? userRawAddress : '',
      receiverName: `${receiverName}`,
      countryCode: `${countryCode}`,
      receiverContact: `${receiverContact}`,
      cartItemRaw: JSON.stringify(foodItemRaw),
      itemTotal: `${itemTotal}`,
      foodServiceCharge: `${foodServiceTax}`,
      serviceCharge: `${serviceTax}`,
      packageCharge: `${packageCharge}`,
      packageChargeTax: `${packageChargeTax}`,
      extraCharge: 0,
      grandTotal: `${grandTotal}`,
    };
    const paymentInfo = await paymentConfigService.getPaymentById(payment);
    const result =
      await userPurchasedTiffinSubscriptionService.saveTiffinSubscription(subscriptionParam);
    if (paymentInfo !== null && paymentInfo.id !== '') {
      const paymentMeta = {
        user: `${user}`,
        payment: `${payment}`,
        tiffinSubscription: result.id,
        amount: `${grandTotal}`,
        from: 'tiffinsubscription',
        ref: `subscription for #${result.id}`,
      };
      const paymentLink = await paymentInitiationService.initiatePayment(paymentMeta);
      if (paymentLink !== null && paymentLink.id !== '') {
        res.status(201).send({ id: result.id, success: true, payLink: paymentLink.id });
      } else {
        res.status(400).send({
          code: 400,
          message: 'Something went wrong, please contact administrator',
          extra: '',
        });
      }
    } else {
      res.status(400).send({
        code: 400,
        message: 'Something went wrong, please contact administrator',
        extra: '',
      });
    }
  }
});

const getMyPurchasedSubscription = catchAsync(async (req, res) => {
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const result = await userPurchasedTiffinSubscriptionService.getMyPurchasedSubscription(
    req.body.uid,
    options
  );
  res.send(result);
});

const getPurchasedSubscriptionInfo = catchAsync(async (req, res) => {
  const { user, id } = req.body;
  const result = await userPurchasedTiffinSubscriptionService.getPurchasedSubscriptionInfo(
    user,
    id
  );
  res.send(result);
});

const repayPendingSubscriptionPackage = catchAsync(async (req, res) => {
  const result = await paymentInitiationService.deleteTiffinSubscriptionPaymentIntentForRePayment(
    req.body.packageId,
    req.body.userId,
    req.body.payMethod
  );
  if (result !== null && result.user !== null) {
    const paymentMeta = {
      user: req.body.userId,
      payment: req.body.newPayMethod,
      tiffinSubscription: req.body.packageId,
      amount: result.amount,
      from: 'tiffinsubscription',
      ref: `subscription for #${req.body.packageId}`,
    };
    const paymentLink = await paymentInitiationService.initiatePayment(paymentMeta);
    if (paymentLink !== null && paymentLink.id !== '') {
      await userPurchasedTiffinSubscriptionService.updateSubscriptionPayment(req.body.packageId, {
        payment: req.body.newPayMethod,
      });
      res.status(201).send({ id: result.id, success: true, payLink: paymentLink.id });
    } else {
      res.status(400).send({
        code: 400,
        message: 'Something went wrong, please contact administrator',
        extra: '',
      });
    }
  } else {
    res.status(400).send({
      code: 400,
      message: 'Something went wrong, please contact administrator',
      extra: '',
    });
  }
});

const getPurchaseListForVendor = catchAsync(async (req, res) => {
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const { id, vendor } = req.body;
  const result = await userPurchasedTiffinSubscriptionService.getPurchaseListForVendor(
    vendor,
    id,
    options
  );
  res.send(result);
});

const getPurchaseListForAdmin = catchAsync(async (req, res) => {
  const options = pick(req.body, ['sortBy', 'limit', 'page', 'search']);
  const { id } = req.body;
  const result = await userPurchasedTiffinSubscriptionService.getPurchaseListForAdmin(id, options);
  res.send(result);
});

const getPurchaseDetailAdmin = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userPurchasedTiffinSubscriptionService.getPurchaseDetailAdmin(id);
  res.send(result);
});

const getPurchaseDetailVendor = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userPurchasedTiffinSubscriptionService.getPurchaseDetailVendor(id);
  res.send(result);
});

const userCancelTiffinSubscription = catchAsync(async (req, res) => {
  const { id, user, cancellationId } = req.body;
  const result = await userPurchasedTiffinSubscriptionService.userCancelTiffinSubscription(
    user,
    id,
    cancellationId
  );
  res.send(result);
});

const userRequestOffDayOnSubscription = catchAsync(async (req, res) => {
  const { purchaseId, offDayDate } = req.body;
  const result = await userPurchasedTiffinSubscriptionService.userRequestOffDayOnSubscription(
    purchaseId,
    offDayDate
  );
  res.send(result);
});

const customerPurchasedPackages = catchAsync(async (req, res) => {
  const options = pick(req.query, ['user', 'limit', 'page']);
  const result = await userPurchasedTiffinSubscriptionService.customerPurchasedPackages(options);
  res.send(result);
});

const supportTeamPurchaseDetail = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await userPurchasedTiffinSubscriptionService.supportTeamPurchaseDetail(id);
  res.send(result);
});

const exportCollection = catchAsync(async (req, res) => {
  const options = pick(req.query, ['id', 'search']);
  const { type } = req.query;
  if (type !== 'raw') {
    const result = await userPurchasedTiffinSubscriptionService.exportCollection(options);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        startDate: DateTime.fromISO(detail.startDate).toFormat('dd LLL yyyy'),
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
        userId:
          detail &&
          detail.userInfo &&
          detail.userInfo.id &&
          detail.userInfo.id !== null &&
          detail.userInfo.id !== ''
            ? detail.userInfo.id
            : '-',
        userFirstName:
          detail &&
          detail.userInfo &&
          detail.userInfo.firstName &&
          detail.userInfo.firstName !== null &&
          detail.userInfo.firstName !== ''
            ? detail.userInfo.firstName
            : '-',
        userLastName:
          detail &&
          detail.userInfo &&
          detail.userInfo.lastName &&
          detail.userInfo.lastName !== null &&
          detail.userInfo.lastName !== ''
            ? detail.userInfo.lastName
            : '-',
        packageId:
          detail &&
          detail.package &&
          detail.package.id &&
          detail.package.id !== null &&
          detail.package.id !== ''
            ? detail.package.id
            : '-',
        packageName:
          detail &&
          detail.package &&
          detail.package.name &&
          detail.package.name !== null &&
          detail.package.name !== ''
            ? detail.package.name
            : '-',
        paymentId:
          detail &&
          detail.paymentInfo &&
          detail.paymentInfo.id &&
          detail.paymentInfo.id !== null &&
          detail.paymentInfo.id !== ''
            ? detail.paymentInfo.id
            : '-',
        paymentName:
          detail &&
          detail.paymentInfo &&
          detail.paymentInfo.name &&
          detail.paymentInfo.name !== null &&
          detail.paymentInfo.name !== ''
            ? detail.paymentInfo.name
            : '-',
        paymentWay:
          detail &&
          detail.paymentInfo &&
          detail.paymentInfo.paymentWay &&
          detail.paymentInfo.paymentWay !== null &&
          detail.paymentInfo.paymentWay !== ''
            ? detail.paymentInfo.paymentWay
            : '-',
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('UserPurchasedTiffinSubscription');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'User Id', key: 'userId' },
        { header: 'User FirstName', key: 'userFirstName' },
        { header: 'User LastName', key: 'userLastName' },
        { header: 'Package Id', key: 'packageId' },
        { header: 'Package Name', key: 'packageName' },
        { header: 'Restaurant Id', key: 'restaurantId' },
        { header: 'Restaurant Name', key: 'restaurantName' },
        { header: 'Payment Id', key: 'paymentId' },
        { header: 'Payment Name', key: 'paymentName' },
        { header: 'Payment Way', key: 'paymentWay' },
        { header: 'Order To', key: 'orderTo' },
        { header: 'Start Date', key: 'startDate' },
        { header: 'Order At', key: 'orderAt' },
        { header: 'Total Order', key: 'totalOrder' },
        { header: 'Grand Total', key: 'grandTotal' },
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
        'User Id':
          detail &&
          detail.userInfo &&
          detail.userInfo.id &&
          detail.userInfo.id !== null &&
          detail.userInfo.id !== ''
            ? detail.userInfo.id
            : '-',
        'User FirstName':
          detail &&
          detail.userInfo &&
          detail.userInfo.firstName &&
          detail.userInfo.firstName !== null &&
          detail.userInfo.firstName !== ''
            ? detail.userInfo.firstName
            : '-',
        'User LastName':
          detail &&
          detail.userInfo &&
          detail.userInfo.lastName &&
          detail.userInfo.lastName !== null &&
          detail.userInfo.lastName !== ''
            ? detail.userInfo.lastName
            : '-',
        'Package Id':
          detail &&
          detail.package &&
          detail.package.id &&
          detail.package.id !== null &&
          detail.package.id !== ''
            ? detail.package.id
            : '-',
        'Package Name':
          detail &&
          detail.package &&
          detail.package.name &&
          detail.package.name !== null &&
          detail.package.name !== ''
            ? detail.package.name
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
        'Payment Id':
          detail &&
          detail.paymentInfo &&
          detail.paymentInfo.id &&
          detail.paymentInfo.id !== null &&
          detail.paymentInfo.id !== ''
            ? detail.paymentInfo.id
            : '-',
        'Payment Name':
          detail &&
          detail.paymentInfo &&
          detail.paymentInfo.name &&
          detail.paymentInfo.name !== null &&
          detail.paymentInfo.name !== ''
            ? detail.paymentInfo.name
            : '-',
        'Payment Way':
          detail &&
          detail.paymentInfo &&
          detail.paymentInfo.paymentWay &&
          detail.paymentInfo.paymentWay !== null &&
          detail.paymentInfo.paymentWay !== ''
            ? detail.paymentInfo.paymentWay
            : '-',
        'Order To': detail.orderTo,
        'Start Date': DateTime.fromISO(detail.startDate).toFormat('dd LLL yyyy'),
        'Order At': detail.orderAt,
        'Total Order': detail.totalOrder,
        'Grand Total': detail.grandTotal,
        Status: detail.status,
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await userPurchasedTiffinSubscriptionService.exportRawCollection(options);
    const downloadPath = path.join(
      __dirname,
      `../templates/downloads/userpurchasedtiffinsubscriptions.json`
    );
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'userpurchasedtiffinsubscriptions.json', (err) => {
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
              importKeys.length === tiffinSubscriptionPurchasedSchemaKeys.length &&
              importKeys.every((item) => tiffinSubscriptionPurchasedSchemaKeys.includes(item));
            if (validSchema) {
              const result = await userPurchasedTiffinSubscriptionService.importCollection(records);
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
                    importKeys.length === tiffinSubscriptionPurchasedSchemaKeys.length &&
                    importKeys.every((item) =>
                      tiffinSubscriptionPurchasedSchemaKeys.includes(item)
                    );
                  if (validSchema) {
                    const result =
                      await userPurchasedTiffinSubscriptionService.importCollection(records);
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

const downloadSummary = catchAsync(async (req, res) => {
  try {
    const { id, user, locale } = req.params;
    const result = await userPurchasedTiffinSubscriptionService.downloadSummary(id, user);
    if (result.success) {
      let availableType = 'breakfast';
      if (
        result &&
        result.details &&
        result.details.package &&
        result.details.package.available &&
        result.details.package.available !== null
      ) {
        availableType = result.details.package.available;
      }
      const cartItem = [];
      const notice = [];
      let currencySymbol = '$';
      let currencySide = 'left';
      if (
        result &&
        result.businessSettings !== null &&
        result.businessSettings.currencySide !== ''
      ) {
        currencySide = result.businessSettings.currencySide;
      }
      if (
        result &&
        result.businessSettings !== null &&
        result.businessSettings.currency !== null &&
        result.businessSettings.currency.symbol !== ''
      ) {
        currencySymbol = result.businessSettings.currency.symbol;
      }
      const formattedDate = DateTime.fromJSDate(new Date(result.details.startDate)).toFormat(
        'dd LLLL yyyy'
      );
      const startDate = `${formattedDate}, ${result.details.slot}`;
      if (checkArrayNotEmpty(result.details.cartItem)) {
        result.details.cartItem.forEach((inCartItemElement) => {
          const basePrice = Number(parseFloat(inCartItemElement.price).toFixed(2));
          let finalPrice;
          let addonPrice = 0;
          let variationPrice = 0;
          let taxAmount = 0;
          if (inCartItemElement && inCartItemElement.taxationEnable === true) {
            inCartItemElement.foodtaxations.forEach((taxPrice) => {
              taxAmount += parseFloat(taxPrice.taxAmount);
            });
            const taxAmountData = basePrice * (taxAmount / 100);
            finalPrice = parseFloat(basePrice + taxAmountData).toFixed(2);
          } else {
            finalPrice = parseFloat(basePrice).toFixed(2);
          }
          if (
            inCartItemElement &&
            inCartItemElement.addons &&
            checkArrayNotEmpty(inCartItemElement.addons)
          ) {
            inCartItemElement.addons.forEach((addonElement) => {
              addonPrice += Number(parseFloat(addonElement.price).toFixed(2));
            });
          }
          if (
            inCartItemElement &&
            inCartItemElement.variations &&
            checkArrayNotEmpty(inCartItemElement.variations)
          ) {
            inCartItemElement.variations.forEach((foodInfoElementVariation) => {
              if (
                foodInfoElementVariation &&
                foodInfoElementVariation.options &&
                checkArrayNotEmpty(foodInfoElementVariation.options)
              ) {
                foodInfoElementVariation.options.forEach((foodInfoElementOption) => {
                  variationPrice += Number(parseFloat(foodInfoElementOption.price).toFixed(2));
                });
              }
            });
          }
          finalPrice = Number(
            parseFloat(
              parseFloat(finalPrice) + parseFloat(addonPrice) + parseFloat(variationPrice)
            ).toFixed(2)
          );
          if (parseFloat(inCartItemElement.discount) > 0) {
            if (inCartItemElement.discountType === '%') {
              const discountAmountOfFood = parseFloat(
                (finalPrice * inCartItemElement.discount) / 100
              ).toFixed(2);
              finalPrice = parseFloat(finalPrice - discountAmountOfFood).toFixed(2);
            } else {
              finalPrice = parseFloat(
                parseFloat(finalPrice) - parseFloat(inCartItemElement.discount)
              ).toFixed(2);
            }
          }
          let productName = inCartItemElement.name;
          if (
            inCartItemElement &&
            inCartItemElement.translations &&
            checkArrayNotEmpty(inCartItemElement.translations)
          ) {
            const translationIndex = inCartItemElement.translations.filter(
              (x) => x.code === locale
            );
            if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
              if (translationIndex[0].title !== '') {
                productName = translationIndex[0].title;
              }
            }
          }
          const itemParam = {
            name: productName,
            quantity: inCartItemElement.quantity,
            unit_price:
              currencySide === 'left'
                ? `${currencySymbol}${finalPrice}`
                : `${finalPrice}${currencySymbol}`,
            total_price:
              currencySide === 'left'
                ? `${currencySymbol}${inCartItemElement.totalPrice}`
                : `${inCartItemElement.totalPrice}${currencySymbol}`,
          };
          cartItem.push(itemParam);
        });
      }
      if (checkArrayNotEmpty(result.instructions)) {
        result.instructions.forEach((instructionElement) => {
          let instructionName = instructionElement.name;
          if (
            instructionElement &&
            instructionElement.translations &&
            checkArrayNotEmpty(instructionElement.translations)
          ) {
            const translationIndex = instructionElement.translations.filter(
              (x) => x.code === locale
            );
            if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
              if (translationIndex[0].value !== '') {
                instructionName = translationIndex[0].value;
              }
            }
          }
          notice.push({ name: instructionName });
        });
      }
      let deliveryAddress = '';
      if (
        result &&
        result.details &&
        result.details !== null &&
        result.details.orderTo === 'homedelivery'
      ) {
        const addr = result.details.deliveryAddress;
        deliveryAddress = `${addr.flatHouse} ${addr.locality} ${addr.landmark}`;
      } else {
        deliveryAddress = '';
      }
      let itemTotal = '';
      let foodServiceCharge = '';
      let serviceCharge = '';
      let packageCharge = '';
      let packageChargeTax = '';
      let extraCharge = '';
      let grandTotal = '';
      if (result && result.details.itemTotal) {
        itemTotal =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.itemTotal}`
            : `${result.details.itemTotal}${currencySymbol}`;
      }
      if (result && result.details.foodServiceCharge) {
        foodServiceCharge =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.foodServiceCharge}`
            : `${result.details.foodServiceCharge}${currencySymbol}`;
      }
      if (result && result.details.serviceCharge) {
        serviceCharge =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.serviceCharge}`
            : `${result.details.serviceCharge}${currencySymbol}`;
      }
      if (result && result.details.packageCharge) {
        packageCharge =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.packageCharge}`
            : `${result.details.packageCharge}${currencySymbol}`;
      }
      if (result && result.details.packageChargeTax) {
        packageChargeTax =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.packageChargeTax}`
            : `${result.details.packageChargeTax}${currencySymbol}`;
      }
      if (result && result.details.extraCharge) {
        extraCharge =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.extraCharge}`
            : `${result.details.extraCharge}${currencySymbol}`;
      }
      if (result && result.details.grandTotal) {
        grandTotal =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.grandTotal}`
            : `${result.details.grandTotal}${currencySymbol}`;
      }
      let serviceChargeName = '';
      if (
        result &&
        result.businessSettings &&
        result.businessSettings !== null &&
        result.businessSettings.additionalServiceName !== ''
      ) {
        serviceChargeName = result.businessSettings.additionalServiceName;
      }
      let foodTaxName = '';
      if (
        result &&
        result.businessSettings &&
        result.businessSettings !== null &&
        result.businessSettings.foodTaxName !== ''
      ) {
        foodTaxName = result.businessSettings.foodTaxName;
      }
      let restaurantName = '';
      let restaurantAddress = '';
      let licenseId = '';
      let restaurantLicenseName = '';
      if (result && result.restaurantDetail && result.restaurantDetail !== null) {
        restaurantName = result.restaurantDetail.name;
        restaurantAddress = result.restaurantDetail.address;
        licenseId = result.restaurantDetail.licenseId;
        if (
          result.restaurantDetail.translations &&
          checkArrayNotEmpty(result.restaurantDetail.translations)
        ) {
          const translationIndex = result.restaurantDetail.translations.filter(
            (x) => x.code === locale
          );
          if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
            if (translationIndex[0].title !== '') {
              restaurantName = translationIndex[0].title;
            }
            if (translationIndex[0].address !== '') {
              restaurantAddress = translationIndex[0].address;
            }
          }
        }
        if (
          result &&
          result.restaurantDetail &&
          result.restaurantDetail !== null &&
          result.restaurantDetail.license &&
          result.restaurantDetail.license.name !== ''
        ) {
          restaurantLicenseName = result.restaurantDetail.license.name;
          if (
            result.restaurantDetail.license.translations &&
            checkArrayNotEmpty(result.restaurantDetail.license.translations)
          ) {
            const translationIndex = result.restaurantDetail.license.translations.filter(
              (x) => x.code === locale
            );
            if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
              if (translationIndex[0].value !== '') {
                restaurantLicenseName = translationIndex[0].value;
              }
            }
          }
        }
      }
      let packageName = '';
      if (
        result &&
        result.details &&
        result.details.package &&
        result.details.package.id &&
        result.details.package.id !== null
      ) {
        packageName = result.details.package.name;
        if (
          result.details.package.translations &&
          checkArrayNotEmpty(result.details.package.translations)
        ) {
          const translationIndex = result.details.package.translations.filter(
            (x) => x.code === locale
          );
          if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
            if (translationIndex[0].title !== '') {
              packageName = translationIndex[0].title;
            }
          }
        }
      }

      let purchasedSummaryKey = 'Tiffin Subscription Purchase Summary';
      let purchasedIdKey = 'Purchased ID';
      let purchasedTimeKey = 'Purchased Time';
      let customerNameKey = 'Customer Name';
      let deliveryAddressKey = 'Delivery Address';
      let restaurantNameKey = 'Restaurant Name';
      let restaurantAddressKey = 'Restaurant Address';
      let itemKey = 'Item';
      let quantityKey = 'Quantity';
      let unitPriceKey = 'Unit Price';
      let totalPriceKey = 'Total Price';
      let itemTotalKey = 'Item Total';
      let foodServiceChargeKey = 'Food Service Charge';
      let serviceChargeKey = 'Service Charge';
      let packageChargeKey = 'Packaging Charge';
      let packageChargeTaxKey = 'Packaging Charge Tax';
      let extraChargeKey = 'Extra Charge';
      let grandTotalKey = 'Grand Total';
      let licenseKey = 'Lic. No.';
      let packageNameKey = 'Package Name';
      let totalOrderKey = 'Total Orders';
      let availableTypeKey = 'Breakfast';

      let direction = 'ltr';

      const wordTranslations = apiLocaleTranslations[locale];
      if (wordTranslations && wordTranslations !== null) {
        direction = wordTranslations.direction;
        const wordLocale = wordTranslations.tiffinSubscriptionSummary;
        if (wordLocale && wordLocale !== null) {
          purchasedSummaryKey = wordLocale.purchasedSummaryKey;
          purchasedIdKey = wordLocale.purchasedIdKey;
          purchasedTimeKey = wordLocale.purchasedTimeKey;
          customerNameKey = wordLocale.customerNameKey;
          deliveryAddressKey = wordLocale.deliveryAddressKey;
          restaurantNameKey = wordLocale.restaurantNameKey;
          restaurantAddressKey = wordLocale.restaurantAddressKey;
          itemKey = wordLocale.itemKey;
          quantityKey = wordLocale.quantityKey;
          unitPriceKey = wordLocale.unitPriceKey;
          totalPriceKey = wordLocale.totalPriceKey;
          itemTotalKey = wordLocale.itemTotalKey;
          foodServiceChargeKey = wordLocale.foodServiceChargeKey;
          serviceChargeKey = wordLocale.serviceChargeKey;
          packageChargeKey = wordLocale.packageChargeKey;
          packageChargeTaxKey = wordLocale.packageChargeTaxKey;
          extraChargeKey = wordLocale.extraChargeKey;
          grandTotalKey = wordLocale.grandTotalKey;
          licenseKey = wordLocale.licenseKey;
          packageNameKey = wordLocale.packageNameKey;
          totalOrderKey = wordLocale.totalOrderKey;
          if (availableType === 'breakfast') {
            availableTypeKey = wordLocale.breakfast;
          } else if (availableType === 'lunch') {
            availableTypeKey = wordLocale.lunch;
          } else if (availableType === 'dinner') {
            availableTypeKey = wordLocale.dinner;
          }
        }
      }

      const browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
      const context = await browser.newContext();
      const page = await context.newPage();
      const htmlPath = path.join(__dirname, '../templates/other/tiffin_subscription_summary.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');
      const template = Handlebars.compile(htmlContent);
      const templateData = {
        purchasedSummaryKey: `${purchasedSummaryKey}`,
        purchasedIdKey: `${purchasedIdKey}`,
        purchasedTimeKey: `${purchasedTimeKey}`,
        purchaseId: result.details.id,
        purchaseDate: startDate,
        totalOrder: result.details.totalOrder,
        packageName: `${packageName}`,
        cart: cartItem,
        company: result.businessSettings.companyName,
        restaurantName: `${restaurantName}`,
        restaurantAddress: `${restaurantAddress}`,
        instructions: notice,
        receiverName: result.details.receiverName,
        deliveryAddress: `${deliveryAddress}`,
        restaurantLicenseName: `${restaurantLicenseName}`,
        restaurantLicenseId: `${licenseId}`,
        businessLicenseName: result.businessSettings.foodLicenseName,
        businessLicenseNumber: result.businessSettings.foodLicense,
        serviceChargeName: `${serviceChargeName}`,
        foodTaxName: `${foodTaxName}`,
        itemTotal: `${itemTotal}`,
        foodServiceCharge: `${foodServiceCharge}`,
        serviceCharge: `${serviceCharge}`,
        packageCharge: `${packageCharge}`,
        packageChargeTax: `${packageChargeTax}`,
        extraCharge: `${extraCharge}`,
        grandTotal: `${grandTotal}`,
        customerNameKey: `${customerNameKey}`,
        deliveryAddressKey: `${deliveryAddressKey}`,
        restaurantNameKey: `${restaurantNameKey}`,
        restaurantAddressKey: `${restaurantAddressKey}`,
        itemKey: `${itemKey}`,
        quantityKey: `${quantityKey}`,
        unitPriceKey: `${unitPriceKey}`,
        totalPriceKey: `${totalPriceKey}`,
        itemTotalKey: `${itemTotalKey}`,
        foodServiceChargeKey: `${foodServiceChargeKey}`,
        serviceChargeKey: `${serviceChargeKey}`,
        packageChargeKey: `${packageChargeKey}`,
        packageChargeTaxKey: `${packageChargeTaxKey}`,
        extraChargeKey: `${extraChargeKey}`,
        grandTotalKey: `${grandTotalKey}`,
        licenseKey: `${licenseKey}`,
        direction: `${direction}`,
        packageNameKey: `${packageNameKey}`,
        totalOrderKey: `${totalOrderKey}`,
        availableTypeKey: `${availableTypeKey}`,
      };
      const finalHtml = template(templateData);
      await page.setContent(finalHtml, {
        waitUntil: 'networkidle',
      });
      const downloadPath = path.join(
        __dirname,
        `../templates/downloads/Tiffin_Subscription_ID_${result.details.id}.pdf`
      );
      await page.pdf({
        path: downloadPath,
        format: 'A4',
        printBackground: true,
      });
      await browser.close();
      if (fs.existsSync(downloadPath)) {
        res.download(downloadPath, (err) => {
          if (!err) {
            fs.unlink(downloadPath, () => {});
          }
        });
      } else {
        res.status(404).json({ success: false, message: 'File not found', extra: '' });
      }
    } else {
      res.status(404).json({ success: false, message: 'Something went wrong' });
    }
  } catch (error) {
    res.status(400).send({ code: 400, message: error.message, extra: '' });
  }
});

const downloadInvoice = catchAsync(async (req, res) => {
  try {
    const { id, user, locale } = req.params;
    const result = await userPurchasedTiffinSubscriptionService.downloadInvoice(id, user);
    if (result.success) {
      let availableType = 'breakfast';
      if (
        result &&
        result.details &&
        result.details.package &&
        result.details.package.available &&
        result.details.package.available !== null
      ) {
        availableType = result.details.package.available;
      }
      let currencySymbol = '$';
      let currencySide = 'left';
      if (
        result &&
        result.businessSettings !== null &&
        result.businessSettings.currencySide !== ''
      ) {
        currencySide = result.businessSettings.currencySide;
      }
      if (
        result &&
        result.businessSettings !== null &&
        result.businessSettings.currency !== null &&
        result.businessSettings.currency.symbol !== ''
      ) {
        currencySymbol = result.businessSettings.currency.symbol;
      }
      const cartItem = [];
      let itemGrossTotalInCart = 0;
      let discountTotalInCart = 0;
      let netTotalInCart = 0;
      let taxTotalInCart = 0;
      if (checkArrayNotEmpty(result.details.cartItem)) {
        result.details.cartItem.forEach((inCartItemElement) => {
          let productName = inCartItemElement.name;
          if (
            inCartItemElement &&
            inCartItemElement.translations &&
            checkArrayNotEmpty(inCartItemElement.translations)
          ) {
            const translationIndex = inCartItemElement.translations.filter(
              (x) => x.code === locale
            );
            if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
              if (translationIndex[0].title !== '') {
                productName = translationIndex[0].title;
              }
            }
          }

          const purchaseQuantity = parseInt(inCartItemElement.quantity, 10);
          const basePrice = parseFloat(inCartItemElement.price);
          let finalSingleProductPrice;
          let addonPrice = 0;
          let variationPrice = 0;
          let taxAmount = 0;
          let taxOnProductPrice = 0;
          const taxationNames = [];
          if (
            inCartItemElement &&
            inCartItemElement.foodtaxations &&
            checkArrayNotEmpty(inCartItemElement.foodtaxations) &&
            inCartItemElement.taxationEnable === true
          ) {
            inCartItemElement.foodtaxations.forEach((taxDetail) => {
              taxAmount += parseFloat(taxDetail.taxAmount);
              let taxName = taxDetail.name;
              if (
                taxDetail &&
                taxDetail.translations &&
                checkArrayNotEmpty(taxDetail.translations)
              ) {
                const translationIndex = taxDetail.translations.filter((x) => x.code === locale);
                if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
                  if (translationIndex[0].title !== '') {
                    taxName = translationIndex[0].title;
                  }
                }
              }
              const taxationParam = {
                name: `${taxName}`,
                taxation: `${taxDetail.taxAmount}%`,
              };
              taxationNames.push(taxationParam);
            });
            const taxAmountData = basePrice * (taxAmount / 100);
            taxOnProductPrice = parseFloat(taxAmountData).toFixed(2);
            finalSingleProductPrice = parseFloat(basePrice + taxAmountData).toFixed(2);
          } else {
            finalSingleProductPrice = parseFloat(basePrice).toFixed(2);
          }

          if (
            inCartItemElement &&
            inCartItemElement.addons &&
            checkArrayNotEmpty(inCartItemElement.addons)
          ) {
            inCartItemElement.addons.forEach((addonElement) => {
              addonPrice += Number(parseFloat(addonElement.price).toFixed(2));
            });
          }
          if (
            inCartItemElement &&
            inCartItemElement.variations &&
            checkArrayNotEmpty(inCartItemElement.variations)
          ) {
            inCartItemElement.variations.forEach((foodInfoElementVariation) => {
              if (
                foodInfoElementVariation &&
                foodInfoElementVariation.options &&
                checkArrayNotEmpty(foodInfoElementVariation.options)
              ) {
                foodInfoElementVariation.options.forEach((foodInfoElementOption) => {
                  variationPrice += Number(parseFloat(foodInfoElementOption.price).toFixed(2));
                });
              }
            });
          }
          finalSingleProductPrice = Number(
            parseFloat(
              parseFloat(finalSingleProductPrice) +
                parseFloat(addonPrice) +
                parseFloat(variationPrice)
            ).toFixed(2)
          );
          let discountAmountPrice = 0;
          if (parseFloat(inCartItemElement.discount) > 0) {
            if (inCartItemElement.discountType === '%') {
              const discountAmountOfFood = parseFloat(
                (finalSingleProductPrice * inCartItemElement.discount) / 100
              ).toFixed(2);
              discountAmountPrice = parseFloat(discountAmountOfFood);
              finalSingleProductPrice = parseFloat(
                finalSingleProductPrice - discountAmountOfFood
              ).toFixed(2);
            } else {
              finalSingleProductPrice = parseFloat(
                parseFloat(finalSingleProductPrice) - parseFloat(inCartItemElement.discount)
              ).toFixed(2);
              discountAmountPrice = parseFloat(inCartItemElement.discount);
            }
          } else {
            finalSingleProductPrice = parseFloat(finalSingleProductPrice).toFixed(2);
          }
          const totalPrice = parseFloat(
            parseFloat(finalSingleProductPrice) * purchaseQuantity
          ).toFixed(2);
          const totalValue =
            currencySide === 'left'
              ? `${currencySymbol}${totalPrice}`
              : `${totalPrice}${currencySymbol}`;
          const grossPriceBeforeTax = parseFloat(
            parseFloat(basePrice) + parseFloat(addonPrice) + parseFloat(variationPrice)
          ).toFixed(2);
          const grossPriceTotal = parseFloat(
            parseFloat(grossPriceBeforeTax) * purchaseQuantity
          ).toFixed(2);
          itemGrossTotalInCart = parseFloat(
            parseFloat(itemGrossTotalInCart) + parseFloat(grossPriceTotal)
          ).toFixed(2);
          const grossValue =
            currencySide === 'left'
              ? `${currencySymbol}${grossPriceTotal}`
              : `${grossPriceTotal}${currencySymbol}`;
          const discountPriceTotal = parseFloat(
            parseFloat(discountAmountPrice) * purchaseQuantity
          ).toFixed(2);
          discountTotalInCart = parseFloat(
            parseFloat(discountTotalInCart) + parseFloat(discountPriceTotal)
          ).toFixed(2);
          const netPriceTotal = parseFloat(
            parseFloat(grossPriceTotal) - parseFloat(discountPriceTotal)
          ).toFixed(2);
          netTotalInCart = parseFloat(
            parseFloat(netTotalInCart) + parseFloat(netPriceTotal)
          ).toFixed(2);
          const netValue =
            currencySide === 'left'
              ? `${currencySymbol}${netPriceTotal}`
              : `${netPriceTotal}${currencySymbol}`;
          const discountValue =
            currencySide === 'left'
              ? `${currencySymbol}${discountPriceTotal}`
              : `${discountPriceTotal}${currencySymbol}`;
          const totalTaxOnProduct = parseFloat(
            parseFloat(taxOnProductPrice) * purchaseQuantity
          ).toFixed(2);
          taxTotalInCart = parseFloat(
            parseFloat(taxTotalInCart) + parseFloat(totalTaxOnProduct)
          ).toFixed(2);
          const taxValue =
            currencySide === 'left'
              ? `${currencySymbol}${totalTaxOnProduct}`
              : `${totalTaxOnProduct}${currencySymbol}`;
          const itemParam = {
            name: productName,
            quantity: purchaseQuantity,
            grossValue: `${grossValue}`,
            discountValue: `${discountValue}`,
            netValue: `${netValue}`,
            taxValue: `${taxValue}`,
            totalValue: `${totalValue}`,
            taxations: taxationNames,
          };
          cartItem.push(itemParam);
        });
      }

      const formattedDate = DateTime.fromJSDate(new Date(result.details.startDate)).toFormat(
        'dd LLLL yyyy'
      );
      const startDate = `${formattedDate}, ${result.details.slot}`;

      let legalName = '';
      let deliveryAddress = '';

      if (
        result &&
        result.restaurantDetail &&
        result.restaurantDetail !== null &&
        result.restaurantDetail.ownerInfo &&
        result.restaurantDetail.ownerInfo.firstName !== ''
      ) {
        const { firstName, lastName } = result.restaurantDetail.ownerInfo;
        legalName = `${firstName} ${lastName}`;
      }

      if (
        result &&
        result.details &&
        result.details !== null &&
        result.details.orderTo === 'homedelivery'
      ) {
        const addr = result.details.deliveryAddress;
        deliveryAddress = `${addr.flatHouse} ${addr.locality} ${addr.landmark}`;
      } else {
        deliveryAddress = '';
      }

      let restaurantName = '';
      let restaurantAddress = '';
      let licenseId = '';
      let restaurantLicenseName = '';

      if (result && result.restaurantDetail && result.restaurantDetail !== null) {
        restaurantName = result.restaurantDetail.name;
        restaurantAddress = result.restaurantDetail.address;
        licenseId = result.restaurantDetail.licenseId;
        if (
          result.restaurantDetail.translations &&
          checkArrayNotEmpty(result.restaurantDetail.translations)
        ) {
          const translationIndex = result.restaurantDetail.translations.filter(
            (x) => x.code === locale
          );
          if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
            if (translationIndex[0].title !== '') {
              restaurantName = translationIndex[0].title;
            }
            if (translationIndex[0].address !== '') {
              restaurantAddress = translationIndex[0].address;
            }
          }
        }
        if (
          result &&
          result.restaurantDetail &&
          result.restaurantDetail !== null &&
          result.restaurantDetail.license &&
          result.restaurantDetail.license.name !== ''
        ) {
          restaurantLicenseName = result.restaurantDetail.license.name;
          if (
            result.restaurantDetail.license.translations &&
            checkArrayNotEmpty(result.restaurantDetail.license.translations)
          ) {
            const translationIndex = result.restaurantDetail.license.translations.filter(
              (x) => x.code === locale
            );
            if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
              if (translationIndex[0].value !== '') {
                restaurantLicenseName = translationIndex[0].value;
              }
            }
          }
        }
      }

      let paymentMode = 'online';

      if (
        result &&
        result.details &&
        result.details !== null &&
        result.details.paymentInfo &&
        result.details.paymentInfo !== null &&
        result.details.paymentInfo.paymentWay !== ''
      ) {
        paymentMode = result.details.paymentInfo.paymentWay;
      }
      const complianceForm = [];
      if (
        result &&
        result.businessSettings &&
        result.businessSettings !== null &&
        result.businessSettings.complianceForm &&
        checkArrayNotEmpty(result.businessSettings.complianceForm)
      ) {
        result.businessSettings.complianceForm.forEach((formElement) => {
          const formParam = {
            name: `${formElement.fieldName}`,
            value: `${formElement.fieldValue}`,
          };
          complianceForm.push(formParam);
        });
      }

      const itemGrossTotalInCartValue =
        currencySide === 'left'
          ? `${currencySymbol}${itemGrossTotalInCart}`
          : `${itemGrossTotalInCart}${currencySymbol}`;
      const discountTotalInCartValue =
        currencySide === 'left'
          ? `${currencySymbol}${discountTotalInCart}`
          : `${discountTotalInCart}${currencySymbol}`;
      const netTotalInCartValue =
        currencySide === 'left'
          ? `${currencySymbol}${netTotalInCart}`
          : `${netTotalInCart}${currencySymbol}`;
      const taxTotalInCartValue =
        currencySide === 'left'
          ? `${currencySymbol}${taxTotalInCart}`
          : `${taxTotalInCart}${currencySymbol}`;
      const itemTotalValue =
        currencySide === 'left'
          ? `${currencySymbol}${result.details.itemTotal}`
          : `${result.details.itemTotal}${currencySymbol}`;

      let foodServiceCharge = '';
      let serviceCharge = '';
      let packageCharge = '';
      let packageChargeTax = '';
      let extraCharge = '';
      let grandTotal = '';
      let packageChargeTotal = '';
      let packageChargeTotalValue = '';

      if (result && result.details.foodServiceCharge) {
        foodServiceCharge =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.foodServiceCharge}`
            : `${result.details.foodServiceCharge}${currencySymbol}`;
      }
      if (result && result.details.serviceCharge) {
        serviceCharge =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.serviceCharge}`
            : `${result.details.serviceCharge}${currencySymbol}`;
      }

      if (result && result.details.packageCharge) {
        packageCharge =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.packageCharge}`
            : `${result.details.packageCharge}${currencySymbol}`;
      }
      if (result && result.details.packageChargeTax) {
        packageChargeTax =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.packageChargeTax}`
            : `${result.details.packageChargeTax}${currencySymbol}`;
      }
      packageChargeTotal = parseFloat(
        parseFloat(result.details.packageCharge) + parseFloat(result.details.packageChargeTax)
      ).toFixed(2);
      if (parseFloat(packageChargeTotal) > 0) {
        packageChargeTotalValue =
          currencySide === 'left'
            ? `${currencySymbol}${packageChargeTotal}`
            : `${packageChargeTotal}${currencySymbol}`;
      }

      if (result && result.details.extraCharge) {
        extraCharge =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.extraCharge}`
            : `${result.details.extraCharge}${currencySymbol}`;
      }
      if (result && result.details.grandTotal) {
        grandTotal =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.grandTotal}`
            : `${result.details.grandTotal}${currencySymbol}`;
      }

      let serviceChargeName = '';
      if (
        result &&
        result.businessSettings &&
        result.businessSettings !== null &&
        result.businessSettings.additionalServiceName !== ''
      ) {
        serviceChargeName = result.businessSettings.additionalServiceName;
      }
      let foodTaxName = '';
      if (
        result &&
        result.businessSettings &&
        result.businessSettings !== null &&
        result.businessSettings.foodTaxName !== ''
      ) {
        foodTaxName = result.businessSettings.foodTaxName;
      }

      let packageName = '';
      if (
        result &&
        result.details &&
        result.details.package &&
        result.details.package.id &&
        result.details.package.id !== null
      ) {
        packageName = result.details.package.name;
        if (
          result.details.package.translations &&
          checkArrayNotEmpty(result.details.package.translations)
        ) {
          const translationIndex = result.details.package.translations.filter(
            (x) => x.code === locale
          );
          if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
            if (translationIndex[0].title !== '') {
              packageName = translationIndex[0].title;
            }
          }
        }
      }

      let purchaseInvoiceKey = 'Tiffin Subscription Purchase Invoice';
      let taxInvoiceKey = 'Tax Invoice';
      let digitalCopyKey = 'Digital Copy For Recipient';
      let taxBehalfKey = 'Tax Invoice on behalf of -';
      let legalNameKey = 'Legal Entity Name';
      let restaurantNameKey = 'Restaurant Name';
      let restaurantAddressKey = 'Restaurant Address';
      let restaurantLicenseKey = 'Restaurant License';
      let invoiceNumberKey = 'Invoice No.';
      let invoiceDateKey = 'Invoice Date';
      let customerNameKey = 'Customer Name';
      let deliveryAddressKey = 'Delivery Address';
      let serviceDescriptionKey = 'Service Description';
      let serviceDescriptionValue = 'Restaurant Service';
      let itemKey = 'Items';
      let grossValueKey = 'Gross Value';
      let discountKey = 'Discount';
      let netValueKey = 'Net Value';
      let taxNameKey = 'Tax Name';
      let taxValueKey = 'Tax Value';
      let totalKey = 'Total';
      let itemTotalKey = 'Item(s) Total';
      let foodServiceChargeKey = 'Food Service Charge';
      let serviceChargeKey = 'Service Charge';
      let restaurantPackagingChargeKey = 'Restaurant Packaging Charge';
      let extraChargeKey = 'Extra Charge';
      let couponDiscountKey = 'Coupon Discount';
      let walletDiscountKey = 'Wallet Discount';
      let totalValueKey = 'Total Value';
      let amountKey = 'Amount';
      let onlinePayDescriptionKey =
        'settled through digital payment received upon delivery against Order ID';
      let offlinePayDescriptionKey =
        'settled through cash payment received upon delivery against Order ID';
      let licenseKey = 'Lic.';
      let packageNameKey = 'Package Name';
      let totalOrderKey = 'Total Orders';
      let availableTypeKey = 'Breakfast';

      let direction = 'ltr';

      const wordTranslations = apiLocaleTranslations[locale];
      if (wordTranslations && wordTranslations !== null) {
        direction = wordTranslations.direction;
        const wordLocale = wordTranslations.tiffinSubscriptionInvoice;
        if (wordLocale && wordLocale !== null) {
          purchaseInvoiceKey = wordLocale.purchaseInvoiceKey;
          taxInvoiceKey = wordLocale.taxInvoiceKey;
          digitalCopyKey = wordLocale.digitalCopyKey;
          taxBehalfKey = wordLocale.taxBehalfKey;
          legalNameKey = wordLocale.legalNameKey;
          restaurantNameKey = wordLocale.restaurantNameKey;
          restaurantAddressKey = wordLocale.restaurantAddressKey;
          restaurantLicenseKey = wordLocale.restaurantLicenseKey;
          invoiceNumberKey = wordLocale.invoiceNumberKey;
          invoiceDateKey = wordLocale.invoiceDateKey;
          customerNameKey = wordLocale.customerNameKey;
          deliveryAddressKey = wordLocale.deliveryAddressKey;
          serviceDescriptionKey = wordLocale.serviceDescriptionKey;
          serviceDescriptionValue = wordLocale.serviceDescriptionValue;
          itemKey = wordLocale.itemKey;
          grossValueKey = wordLocale.grossValueKey;
          discountKey = wordLocale.discountKey;
          netValueKey = wordLocale.netValueKey;
          taxNameKey = wordLocale.taxNameKey;
          taxValueKey = wordLocale.taxValueKey;
          totalKey = wordLocale.totalKey;
          itemTotalKey = wordLocale.itemTotalKey;
          foodServiceChargeKey = wordLocale.foodServiceChargeKey;
          serviceChargeKey = wordLocale.serviceChargeKey;
          restaurantPackagingChargeKey = wordLocale.restaurantPackagingChargeKey;
          extraChargeKey = wordLocale.extraChargeKey;
          couponDiscountKey = wordLocale.couponDiscountKey;
          walletDiscountKey = wordLocale.walletDiscountKey;
          totalValueKey = wordLocale.totalValueKey;
          amountKey = wordLocale.amountKey;
          onlinePayDescriptionKey = wordLocale.onlinePayDescriptionKey;
          offlinePayDescriptionKey = wordLocale.offlinePayDescriptionKey;
          licenseKey = wordLocale.licenseKey;
          packageNameKey = wordLocale.packageNameKey;
          totalOrderKey = wordLocale.totalOrderKey;
          if (availableType === 'breakfast') {
            availableTypeKey = wordLocale.breakfast;
          } else if (availableType === 'lunch') {
            availableTypeKey = wordLocale.lunch;
          } else if (availableType === 'dinner') {
            availableTypeKey = wordLocale.dinner;
          }
        }
      }

      /// Working Code ///
      const browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
      const context = await browser.newContext();
      const page = await context.newPage();
      const htmlPath = path.join(__dirname, '../templates/other/tiffin_subscription_invoice.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');
      const template = Handlebars.compile(htmlContent);
      const templateData = {
        id: result.details.id,
        purchaseId: result.details.id,
        purchaseDate: startDate,
        totalOrder: result.details.totalOrder,
        packageName: `${packageName}`,
        cart: cartItem,
        legalName: `${legalName}`,
        company: result.businessSettings.companyName,
        purchaseInvoiceKey: `${purchaseInvoiceKey}`,
        invoiceDateTime: `${startDate}`,
        restaurantName: `${restaurantName}`,
        restaurantAddress: `${restaurantAddress}`,
        receiverName: result.details.receiverName,
        deliveryAddress: `${deliveryAddress}`,
        restaurantLicenseName: `${restaurantLicenseName}`,
        restaurantLicenseId: `${licenseId}`,
        isOnlinePayment: paymentMode === 'online',
        isOfflinePayment: paymentMode === 'offline',
        businessLicenseName: result.businessSettings.foodLicenseName,
        businessLicenseNumber: result.businessSettings.foodLicense,
        complianceFormElement: complianceForm,
        itemGrossTotalInCartValue: `${itemGrossTotalInCartValue}`,
        discountTotalInCartValue: `${discountTotalInCartValue}`,
        netTotalInCartValue: `${netTotalInCartValue}`,
        taxTotalInCartValue: `${taxTotalInCartValue}`,
        itemTotalValue: `${itemTotalValue}`,
        serviceChargeName: `${serviceChargeName}`,
        foodTaxName: `${foodTaxName}`,
        foodServiceCharge: `${foodServiceCharge}`,
        serviceCharge: `${serviceCharge}`,
        packageCharge: `${packageCharge}`,
        packageChargeTax: `${packageChargeTax}`,
        packageChargeTotalValue: `${packageChargeTotalValue}`,
        extraCharge: `${extraCharge}`,
        grandTotal: `${grandTotal}`,
        direction: `${direction}`,
        taxInvoiceKey: `${taxInvoiceKey}`,
        digitalCopyKey: `${digitalCopyKey}`,
        taxBehalfKey: `${taxBehalfKey}`,
        legalNameKey: `${legalNameKey}`,
        restaurantNameKey: `${restaurantNameKey}`,
        restaurantAddressKey: `${restaurantAddressKey}`,
        restaurantLicenseKey: `${restaurantLicenseKey}`,
        invoiceNumberKey: `${invoiceNumberKey}`,
        invoiceDateKey: `${invoiceDateKey}`,
        customerNameKey: `${customerNameKey}`,
        deliveryAddressKey: `${deliveryAddressKey}`,
        serviceDescriptionKey: `${serviceDescriptionKey}`,
        serviceDescriptionValue: `${serviceDescriptionValue}`,
        itemKey: `${itemKey}`,
        grossValueKey: `${grossValueKey}`,
        discountKey: `${discountKey}`,
        netValueKey: `${netValueKey}`,
        taxNameKey: `${taxNameKey}`,
        taxValueKey: `${taxValueKey}`,
        totalKey: `${totalKey}`,
        itemTotalKey: `${itemTotalKey}`,
        foodServiceChargeKey: `${foodServiceChargeKey}`,
        serviceChargeKey: `${serviceChargeKey}`,
        restaurantPackagingChargeKey: `${restaurantPackagingChargeKey}`,
        extraChargeKey: `${extraChargeKey}`,
        couponDiscountKey: `${couponDiscountKey}`,
        walletDiscountKey: `${walletDiscountKey}`,
        totalValueKey: `${totalValueKey}`,
        amountKey: `${amountKey}`,
        onlinePayDescriptionKey: `${onlinePayDescriptionKey}`,
        offlinePayDescriptionKey: `${offlinePayDescriptionKey}`,
        licenseKey: `${licenseKey}`,
        packageNameKey: `${packageNameKey}`,
        totalOrderKey: `${totalOrderKey}`,
        availableTypeKey: `${availableTypeKey}`,
      };
      const finalHtml = template(templateData);
      await page.setContent(finalHtml, {
        waitUntil: 'networkidle',
      });
      const downloadPath = path.join(
        __dirname,
        `../templates/downloads/Tiffin_Subscription_Invoice_${result.details.id}.pdf`
      );
      await page.pdf({
        path: downloadPath,
        format: 'A4',
        printBackground: true,
      });
      await browser.close();
      if (fs.existsSync(downloadPath)) {
        res.download(downloadPath, (err) => {
          if (!err) {
            fs.unlink(downloadPath, () => {});
          }
        });
      } else {
        res.status(404).json({ success: false, message: 'File not found', extra: '' });
      }
      /// Working Code ///
    } else {
      res.status(404).json({ success: false, message: 'Something went wrong' });
    }
  } catch (error) {
    res.status(400).send({ code: 400, message: error.message, extra: '' });
  }
});

module.exports = {
  purchaseTiffinSubscription,
  getMyPurchasedSubscription,
  getPurchasedSubscriptionInfo,
  repayPendingSubscriptionPackage,
  getPurchaseListForVendor,
  getPurchaseListForAdmin,
  getPurchaseDetailAdmin,
  getPurchaseDetailVendor,
  userCancelTiffinSubscription,
  userRequestOffDayOnSubscription,
  customerPurchasedPackages,
  supportTeamPurchaseDetail,
  exportCollection,
  importCollection,
  downloadSummary,
  downloadInvoice,
};

