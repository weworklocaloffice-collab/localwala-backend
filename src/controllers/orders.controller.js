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
const mongoose = require('mongoose');
const { chromium } = require('playwright');
const ExcelJS = require('exceljs');
const Papa = require('papaparse');
const fs = require('fs');
const path = require('path');
const lodash = require('lodash');
const { DateTime } = require('luxon');
const Handlebars = require('handlebars');
const catchAsync = require('../utils/catchAsync');
const pick = require('../utils/pick');
const { PaymentInitiation } = require('../models');
const {
  ordersService,
  paymentConfigService,
  paymentInitiationService,
  fcmNotificationService,
  userSettingService,
  loyaltyPointsService,
  couponService,
  walletService,
  transactionService,
  cartItemService,
  orderSettingsService,
  userAddressService,
  addonsService,
  foodService,
  userService,
  emailConfigService,
} = require('../services');
const apiLocaleTranslations = require('../utils/translate');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');
const uploadMiddleware = require('../middlewares/upload');
const config = require('../config/config');
const dispatchService = require('../services/dispatch.service');
const geographicService = require('../kernel/geographic/services/geographic.service');
const { regularOrderSchemakeys } = require('../utils/importCollectionSchema');

/**
 * Great-circle distance in metres. Delegates to the kernel so the checkout
 * delivery-area check and the rider payout calculation cannot disagree by the
 * 0.1% that separate a mean-earth radius from the WGS-84 equatorial one.
 */
function haversineDistance(coords1, coords2) {
  return geographicService.haversineMeters(coords1[0], coords1[1], coords2[0], coords2[1]);
}

const placeOrderFromApp = catchAsync(async (req, res) => {
  const {
    user,
    trackingId,
    restaurant,
    orderTo,
    deliveryAddress,
    deliveryTip,
    instantOrder,
    scheduleOrder,
    scheduleDate,
    scheduleTime,
    coupon,
    walletUsed,
    payment,
    cookingInstruction,
    deliveryInstruction,
    receiverName,
    countryCode,
    receiverContact,
    orderAt,
    localCartItem,
  } = req.body;
  await cartItemService.bulkUpdateBeforeCheckout(trackingId, localCartItem);
  const orderSettings = await orderSettingsService.getOrderSettingForCheckout(restaurant);
  let isValidScheduleDate = false;
  let couponInfo = null;
  let isCouponEnableForMe = false;
  if (coupon && coupon !== null && coupon !== '') {
    couponInfo = await couponService.getCouponInfoForCheckout(coupon);
    if (couponInfo && couponInfo !== null) {
      await couponService.redeemCoupon(user, coupon, trackingId, restaurant);
    }
    if (couponInfo && couponInfo.allRestaurants === true && couponInfo.allUsers === true) {
      isCouponEnableForMe = true;
    } else if (
      couponInfo.allRestaurants === false &&
      couponInfo.allUsers === false &&
      couponInfo.restaurant.includes(restaurant) &&
      coupon.user.includes(user)
    ) {
      isCouponEnableForMe = true;
    } else if (
      couponInfo.allRestaurants === true &&
      couponInfo.allUsers === false &&
      couponInfo.user.includes(user)
    ) {
      isCouponEnableForMe = true;
    } else if (
      couponInfo.allRestaurants === false &&
      couponInfo.restaurant.includes(restaurant) &&
      couponInfo.allUsers === true
    ) {
      isCouponEnableForMe = true;
    }
  }
  if (
    orderSettings &&
    orderSettings.orders &&
    orderSettings.orders.customerCanOrderWithinDays !== null &&
    scheduleOrder === true
  ) {
    const scheduleOrderRange = DateTime.now().plus({
      days: parseInt(orderSettings.orders.customerCanOrderWithinDays, 10) - 1,
    });
    const scheduleOrderDateString = `${DateTime.fromJSDate(new Date(scheduleDate)).toFormat('yyyy-MM-dd')} ${scheduleTime}`;

    const scheduleOrderDate = DateTime.fromFormat(scheduleOrderDateString, 'yyyy-MM-dd hh:mm a');

    if (scheduleOrderDate < scheduleOrderRange && scheduleOrderDate >= DateTime.now()) {
      isValidScheduleDate = true;
    }
  }
  let userRawAddress = '';
  let distance = 0;
  if (orderTo === 'homedelivery' && deliveryAddress !== '' && deliveryAddress !== null) {
    const userAddress = await userAddressService.getUserAddressDetailForCheckout(deliveryAddress);
    if (userAddress && userAddress !== null && userAddress.id === deliveryAddress) {
      userRawAddress = JSON.stringify(userAddress);
      const point1 = userAddress.location.coordinates;
      if (orderSettings && orderSettings.restaurant && orderSettings.restaurant.id === restaurant) {
        const point2 = orderSettings.restaurant.location.coordinates;
        const distanceInMeter = haversineDistance(point1, point2);
        const findMode =
          orderSettings &&
          orderSettings.business &&
          orderSettings.business.findMode &&
          orderSettings.business.findMode !== ''
            ? orderSettings.business.findMode
            : 'km';
        distance =
          findMode === 'km'
            ? parseFloat(distanceInMeter / 1000).toFixed(2)
            : parseFloat(distanceInMeter / 1609.34).toFixed(2);
      }
    }
  }
  if (orderSettings.canPlaceOrder === false) {
    res.status(400).send({ code: 400, message: 'Limit Crossed' });
  } else if (
    orderTo === 'homedelivery' &&
    (deliveryAddress === '' || deliveryAddress === null || !deliveryAddress)
  ) {
    res.status(400).send({ code: 400, message: 'Address is missing' });
  } else if (
    orderTo === 'homedelivery' &&
    (orderSettings.orders.homeDelivery === false ||
      orderSettings.restaurant.acceptHomeDelivery === false)
  ) {
    res.status(400).send({ code: 400, message: 'Home Delivery is disabled' });
  } else if (
    orderTo === 'selfpickup' &&
    (orderSettings.orders.takeaway === false || orderSettings.restaurant.takeAway === false)
  ) {
    res.status(400).send({ code: 400, message: 'Self Pickup is disabled' });
  } else if (instantOrder === true && orderSettings.orders.instantOrder === false) {
    res.status(400).send({ code: 400, message: 'Instant Order is disabled' });
  } else if (
    scheduleOrder === true &&
    (orderSettings.orders.scheduleDelivery === false ||
      orderSettings.restaurant.acceptScheduleDelivery === false)
  ) {
    res.status(400).send({ code: 400, message: 'Schedule Order is disabled' });
  } else if (scheduleOrder === true && isValidScheduleDate === false) {
    res.status(400).send({ code: 400, message: 'Schedule Date is invalid' });
  } else if (parseFloat(distance) > parseFloat(orderSettings.business.deliveryArea)) {
    res.status(400).send({ code: 400, message: 'Can not deliver order to this address' });
  } else if (coupon && coupon !== null && coupon !== '' && walletUsed === true) {
    res.status(400).send({
      code: 400,
      message: `Oops! Looks like you've applied a coupon code for your order.Please note that you can't use your wallet balance along with a coupon code`,
    });
  } else if (coupon && coupon !== null && coupon !== '' && isCouponEnableForMe === false) {
    res
      .status(400)
      .send({ code: 400, message: 'Opps, Sorry this coupon is not available for you.' });
  } else {
    const cartItems = await cartItemService.getCartItemForCheckout(trackingId, restaurant);
    if (checkArrayNotEmpty(cartItems.inCartItems) && checkArrayNotEmpty(cartItems.foodInfoInCart)) {
      if (cartItems.success === true) {
        let itemInStock = true;
        let itemOutOfStockName = '';
        let addonInStock = true;
        let addonOutOfStockName = '';
        let variationInStock = true;
        let variationOutOfStockName = '';
        const savedFoodTotal = [];
        const savedAddonTotal = [];
        const savedAddonIds = [];
        const serverAddonIds = [];
        const savedVariationsTotal = [];
        const savedVariationIds = [];
        const serverVariationIds = [];
        const serverFoodIds = [];
        const addonUpdateData = [];
        const foodUpdateData = [];
        let itemTotalPrice = 0;
        let itemRealTotalPrice = 0;
        let itemDiscountPrice = 0;
        let foodTaxPrice = 0;
        let serviceTaxPrice = 0;
        let packagePrice = 0;
        let packageTaxPrice = 0;
        let deliveryTipPrice = 0;
        let deliveryPrice = 0;
        let couponDiscount = 0;
        let walletAmount = 0;
        const cartItemJSON = [];
        const foodMetaUpdateJson = [];
        cartItems.inCartItems.forEach((inCartItemElement) => {
          const foodIdParam = {
            id: inCartItemElement.food.toString(),
            total: parseInt(inCartItemElement.quantity, 10),
          };
          const indexOfFoodId = savedFoodTotal.findIndex(
            (item) => item.id === inCartItemElement.food.toString()
          );
          if (indexOfFoodId === -1) {
            savedFoodTotal.push(foodIdParam);
            serverFoodIds.push(foodIdParam.id);
          } else {
            savedFoodTotal[indexOfFoodId].total += parseInt(inCartItemElement.quantity, 10);
          }

          if (
            inCartItemElement &&
            inCartItemElement.addons &&
            checkArrayNotEmpty(inCartItemElement.addons)
          ) {
            inCartItemElement.addons.forEach((addonElement) => {
              const addonParam = {
                id: addonElement.toString(),
                total: parseInt(inCartItemElement.quantity, 10),
              };
              const indexOfAddonId = savedAddonTotal.findIndex(
                (item) => item.id === addonElement.toString()
              );
              if (indexOfAddonId === -1) {
                savedAddonIds.push(addonElement.toString());
                savedAddonTotal.push(addonParam);
              } else {
                savedAddonTotal[indexOfAddonId].total += parseInt(inCartItemElement.quantity, 10);
              }
            });
          }
          if (
            inCartItemElement &&
            inCartItemElement.variations &&
            checkArrayNotEmpty(inCartItemElement.variations)
          ) {
            inCartItemElement.variations.forEach((variationElement) => {
              variationElement.selected.forEach((optionElement) => {
                const variationParam = {
                  id: `${variationElement.variation}-${optionElement}-${inCartItemElement.food}`,
                  total: parseInt(inCartItemElement.quantity, 10),
                };
                const indexOfVariationId = savedVariationsTotal.findIndex(
                  (item) =>
                    item.id ===
                    `${variationElement.variation}-${optionElement}-${inCartItemElement.food}`
                );
                if (indexOfVariationId === -1) {
                  savedVariationIds.push(
                    `${variationElement.variation}-${optionElement}-${inCartItemElement.food}`
                  );
                  savedVariationsTotal.push(variationParam);
                } else {
                  savedVariationsTotal[indexOfVariationId].total += parseInt(
                    inCartItemElement.quantity,
                    10
                  );
                }
              });
            });
          }
        });
        cartItems.foodInfoInCart.forEach((foodInfoElement) => {
          const indexOfSavedFoodId = savedFoodTotal.findIndex(
            (item) => item.id.toString() === foodInfoElement.id.toString()
          );
          if (
            (foodInfoElement.inStock !== true || foodInfoElement.status !== 'live') &&
            itemInStock === true
          ) {
            itemInStock = false;
            itemOutOfStockName = foodInfoElement.name;
          } else if (
            indexOfSavedFoodId !== -1 &&
            foodInfoElement.stockType !== 'unlimited' &&
            savedFoodTotal[indexOfSavedFoodId].total > parseInt(foodInfoElement.stockNumber, 10) &&
            itemInStock === true
          ) {
            itemInStock = false;
            itemOutOfStockName = foodInfoElement.name;
          }
          if (
            foodInfoElement &&
            foodInfoElement.addons &&
            checkArrayNotEmpty(foodInfoElement.addons)
          ) {
            foodInfoElement.addons.forEach((addonElement) => {
              const indexOfSavedAddonId = savedAddonTotal.findIndex(
                (item) => item.id.toString() === addonElement.id.toString()
              );
              if (!serverAddonIds.includes(addonElement.id.toString())) {
                serverAddonIds.push(addonElement.id.toString());
              }
              if (
                indexOfSavedAddonId !== -1 &&
                (addonElement.inStock === false || addonElement.status === false) &&
                addonInStock === true
              ) {
                addonInStock = false;
                addonOutOfStockName = addonElement.name;
              } else if (
                indexOfSavedAddonId !== -1 &&
                addonElement.stockType !== 'unlimited' &&
                savedAddonTotal[indexOfSavedAddonId].total > parseInt(addonElement.stockNumber, 10)
              ) {
                addonInStock = false;
                addonOutOfStockName = addonElement.name;
              }
            });
          }
          if (
            foodInfoElement &&
            foodInfoElement.variations &&
            checkArrayNotEmpty(foodInfoElement.variations)
          ) {
            foodInfoElement.variations.forEach((variationElement) => {
              if (
                variationElement &&
                variationElement.options &&
                checkArrayNotEmpty(variationElement.options)
              ) {
                variationElement.options.forEach((optionElement) => {
                  const indexOfVariationId = savedVariationsTotal.findIndex(
                    (item) =>
                      item.id.toString() ===
                      `${variationElement.title}-${optionElement.name}-${foodInfoElement.id}`
                  );
                  if (
                    !serverVariationIds.includes(
                      `${variationElement.title}-${optionElement.name}-${foodInfoElement.id}`
                    )
                  ) {
                    serverVariationIds.push(
                      `${variationElement.title}-${optionElement.name}-${foodInfoElement.id}`
                    );
                  }
                  if (
                    indexOfVariationId !== -1 &&
                    foodInfoElement.stockType !== 'unlimited' &&
                    savedVariationsTotal[indexOfVariationId].total >
                      parseInt(optionElement.stock, 10)
                  ) {
                    variationInStock = false;
                    variationOutOfStockName = optionElement.name;
                  }
                });
              }
            });
          }
          cartItems.inCartItems.forEach((inCartItemElement) => {
            if (foodInfoElement.id.toString() === inCartItemElement.food.toString()) {
              const cartAddonJSON = [];
              const cartVariationJSON = [];
              const basePrice = Number(parseFloat(foodInfoElement.price).toFixed(2));
              let finalPrice;
              let addonPrice = 0;
              let variationPrice = 0;
              let taxAmount = 0;
              if (foodInfoElement && foodInfoElement.taxationEnable === true) {
                foodInfoElement.foodtaxations.forEach((taxPrice) => {
                  taxAmount += parseFloat(taxPrice.taxAmount);
                });
                const taxAmountData = basePrice * (taxAmount / 100);
                finalPrice = parseFloat(basePrice + taxAmountData).toFixed(2);
              } else {
                finalPrice = parseFloat(basePrice).toFixed(2);
              }
              const indexOfSavedFoodTotalId = savedFoodTotal.findIndex(
                (x) => x.id.toString() === foodInfoElement.id.toString()
              );
              const indexOfSavedFoodUpdateId = foodUpdateData.findIndex(
                (x) => x.id.toString() === foodInfoElement.id.toString()
              );
              if (
                indexOfSavedFoodTotalId !== -1 &&
                indexOfSavedFoodUpdateId === -1 &&
                foodInfoElement.stockType !== 'unlimited'
              ) {
                const updatedFoodStockNumber = parseInt(
                  parseInt(foodInfoElement.stockNumber, 10) -
                    parseInt(savedFoodTotal[indexOfSavedFoodTotalId].total, 10),
                  10
                );
                const updateFoodParam = {
                  id: foodInfoElement.id.toString(),
                  name: foodInfoElement.name,
                  updateSet: {
                    stockNumber: updatedFoodStockNumber,
                    inStock: updatedFoodStockNumber > 0,
                  },
                };
                foodUpdateData.push(updateFoodParam);
              }
              if (
                foodInfoElement &&
                foodInfoElement.addons &&
                checkArrayNotEmpty(foodInfoElement.addons)
              ) {
                foodInfoElement.addons.forEach((addonElement) => {
                  if (
                    inCartItemElement &&
                    inCartItemElement.addons &&
                    checkArrayNotEmpty(inCartItemElement.addons)
                  ) {
                    if (inCartItemElement.addons.includes(addonElement.id)) {
                      const indexOfSavedAddonTotalId = savedAddonTotal.findIndex(
                        (x) => x.id.toString() === addonElement.id.toString()
                      );
                      const indexOfSavedAddonUpdateId = addonUpdateData.findIndex(
                        (x) => x.id.toString() === addonElement.id.toString()
                      );
                      if (
                        indexOfSavedAddonTotalId !== -1 &&
                        indexOfSavedAddonUpdateId === -1 &&
                        addonElement.stockType !== 'unlimited'
                      ) {
                        const updatedAddonStockNumber = parseInt(
                          parseInt(addonElement.stockNumber, 10) -
                            parseInt(savedAddonTotal[indexOfSavedAddonTotalId].total, 10),
                          10
                        );
                        const updateAddonParam = {
                          id: addonElement.id.toString(),
                          updateSet: {
                            stockNumber: updatedAddonStockNumber,
                            inStock: updatedAddonStockNumber > 0,
                          },
                        };
                        addonUpdateData.push(updateAddonParam);
                      }
                      addonPrice += Number(parseFloat(addonElement.price).toFixed(2));
                      cartAddonJSON.push(addonElement);
                    }
                  }
                });
              }
              if (
                foodInfoElement &&
                foodInfoElement.variations &&
                checkArrayNotEmpty(foodInfoElement.variations)
              ) {
                const updatedVariationParam = foodInfoElement.variations;
                foodInfoElement.variations.forEach((foodInfoElementVariation) => {
                  if (
                    inCartItemElement &&
                    inCartItemElement.variations &&
                    checkArrayNotEmpty(inCartItemElement.variations)
                  ) {
                    inCartItemElement.variations.forEach((inCartItemVariation) => {
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
                              if (
                                inCartItemVariation.selected.includes(foodInfoElementOption.name)
                              ) {
                                variationParam.options.push(foodInfoElementOption);
                                variationPrice += Number(
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
                const indexOfUpdateFoodId = foodUpdateData.findIndex(
                  (x) => x.id.toString() === foodInfoElement.id.toString()
                );
                if (indexOfUpdateFoodId !== -1) {
                  foodUpdateData[indexOfUpdateFoodId].updateSet.variations = updatedVariationParam;
                }
              }
              finalPrice = Number(
                parseFloat(
                  parseFloat(finalPrice) + parseFloat(addonPrice) + parseFloat(variationPrice)
                ).toFixed(2)
              );
              let realPrice = parseFloat(finalPrice);
              let itemDiscount = 0;
              if (parseFloat(foodInfoElement.discount) > 0) {
                if (foodInfoElement.discountType === '%') {
                  const discountAmount = parseFloat(
                    (finalPrice * foodInfoElement.discount) / 100
                  ).toFixed(2);
                  itemDiscount = parseFloat(discountAmount);
                  finalPrice = parseFloat(finalPrice - discountAmount).toFixed(2);
                } else {
                  itemDiscount = parseFloat(foodInfoElement.discount);
                  finalPrice = parseFloat(
                    parseFloat(finalPrice) - parseFloat(foodInfoElement.discount)
                  ).toFixed(2);
                }
              }
              const itemPrice = parseFloat(
                parseFloat(
                  parseFloat(finalPrice).toFixed(2) * parseInt(inCartItemElement.quantity, 10)
                ).toFixed(2)
              );
              realPrice = parseFloat(
                parseFloat(
                  parseFloat(realPrice).toFixed(2) * parseInt(inCartItemElement.quantity, 10)
                ).toFixed(2)
              );
              itemDiscount = parseFloat(
                parseFloat(
                  parseFloat(itemDiscount).toFixed(2) * parseInt(inCartItemElement.quantity, 10)
                ).toFixed(2)
              );
              itemTotalPrice += itemPrice;
              itemRealTotalPrice += realPrice;
              itemDiscountPrice += itemDiscount;
              cartItemJSON.push({
                name: foodInfoElement.name,
                uuid: inCartItemElement.uuid,
                addons: cartAddonJSON,
                variations: cartVariationJSON,
                discount: foodInfoElement.discount,
                discountType: foodInfoElement.discountType,
                endTime: foodInfoElement.endTime,
                foodType: foodInfoElement.foodType,
                foodtaxations: foodInfoElement.foodtaxations,
                id: foodInfoElement.id,
                image: foodInfoElement.image,
                inStock: foodInfoElement.inStock,
                price: parseFloat(foodInfoElement.price),
                purchaseLimit: parseInt(foodInfoElement.purchaseLimit, 10),
                quantity: parseInt(inCartItemElement.quantity, 10),
                restaurant: foodInfoElement.restaurant,
                restaurantInfo: {
                  cover: orderSettings.restaurant.cover,
                  id: orderSettings.restaurant.id,
                  logo: orderSettings.restaurant.logo,
                  name: orderSettings.restaurant.name,
                  slug: orderSettings.restaurant.slug,
                  translations: orderSettings.restaurant.translations,
                },
                shortDescription: foodInfoElement.shortDescription,
                startTime: foodInfoElement.startTime,
                status: foodInfoElement.status,
                taxationEnable: foodInfoElement.taxationEnable,
                realPrice: parseFloat(realPrice),
                itemDiscount: parseFloat(itemDiscount),
                singleProductPrice: parseFloat(finalPrice),
                totalPrice: parseFloat(itemPrice),
                instruction:
                  inCartItemElement &&
                  inCartItemElement.cookingInstruction &&
                  inCartItemElement.cookingInstruction !== null &&
                  inCartItemElement.cookingInstruction !== ''
                    ? inCartItemElement.cookingInstruction
                    : '',
                translations: foodInfoElement.translations,
              });
            }
          });
        });
        if (foodUpdateData !== null && checkArrayNotEmpty(foodUpdateData)) {
          foodUpdateData.forEach((foodItemUpdate) => {
            if (
              foodItemUpdate !== null &&
              foodItemUpdate.updateSet !== null &&
              foodItemUpdate.updateSet.variations !== null &&
              checkArrayNotEmpty(foodItemUpdate.updateSet.variations)
            ) {
              foodItemUpdate.updateSet.variations.forEach((foodUpdateVariation) => {
                if (
                  foodUpdateVariation !== null &&
                  foodUpdateVariation.options !== null &&
                  checkArrayNotEmpty(foodUpdateVariation.options)
                ) {
                  foodUpdateVariation.options.forEach((foodUpdateVariationOption) => {
                    const indexOfSavedVariationTotalId = savedVariationsTotal.findIndex(
                      (x) =>
                        x.id.toString() ===
                        `${foodUpdateVariation.title}-${foodUpdateVariationOption.name}-${foodItemUpdate.id}`
                    );
                    if (indexOfSavedVariationTotalId !== -1) {
                      const updatedOptionStockNumber = parseInt(
                        parseInt(foodUpdateVariationOption.stock, 10) -
                          parseInt(savedVariationsTotal[indexOfSavedVariationTotalId].total, 10),
                        10
                      );
                      foodUpdateVariationOption.stock = updatedOptionStockNumber.toString();
                    }
                  });
                }
              });
            }
          });
        }
        itemTotalPrice = parseFloat(itemTotalPrice).toFixed(2);
        const isAddonThere = savedAddonIds.every((item) => serverAddonIds.includes(item));
        const isVariationThere = savedVariationIds.every((item) =>
          serverVariationIds.includes(item)
        );
        if (
          coupon &&
          coupon !== null &&
          coupon !== '' &&
          parseFloat(itemTotalPrice) < couponInfo.minCartTotal
        ) {
          res.status(400).send({
            code: 400,
            message: `Opps, Sorry. you required minimum ##dynamic## on your cart.`,
            extra: `${couponInfo.minCartTotal}`,
          });
        } else if (
          parseFloat(itemTotalPrice) < parseFloat(orderSettings.restaurant.minOrderAmount)
        ) {
          res.status(400).send({
            code: 400,
            message: `Please note that a minimum order value of ##dynamic## is required to proceed with your order`,
            extra: `${orderSettings.restaurant.minOrderAmount}`,
          });
        } else if (itemInStock === true && addonInStock === true && variationInStock === true) {
          if (isAddonThere && isVariationThere) {
            if (
              orderSettings &&
              orderSettings.business &&
              orderSettings.business.includeTaxOnFood === true
            ) {
              if (orderSettings.business.foodTaxType === 'per') {
                foodTaxPrice = parseFloat(
                  (parseFloat(itemTotalPrice).toFixed(2) *
                    parseFloat(orderSettings.business.foodTaxAmount).toFixed(2)) /
                    100
                ).toFixed(2);
              } else {
                foodTaxPrice = parseFloat(orderSettings.business.foodTaxAmount);
              }
            }
            if (
              orderSettings &&
              orderSettings.business &&
              orderSettings.business.additionalServiceCharge === true
            ) {
              serviceTaxPrice = parseFloat(orderSettings.business.additionalServiceAmount).toFixed(
                2
              );
            }
            if (
              orderSettings &&
              orderSettings.packaging &&
              orderSettings.packaging.havePackagingCharges === true
            ) {
              packagePrice = parseFloat(orderSettings.packaging.packagingCharges).toFixed(2);
            }
            if (
              orderSettings &&
              orderSettings.packaging &&
              orderSettings.packaging.includePackagesChargesInTax === true
            ) {
              packageTaxPrice = parseFloat(
                (parseFloat(orderSettings.packaging.packagingCharges).toFixed(2) *
                  parseFloat(orderSettings.packaging.packagingChargesTax).toFixed(2)) /
                  100
              ).toFixed(2);
            }
            if (deliveryTip && deliveryTip !== null && deliveryTip !== '') {
              deliveryTipPrice = parseFloat(deliveryTip).toFixed(2);
            }
            if (
              coupon &&
              coupon !== null &&
              coupon !== '' &&
              (couponInfo.couponType === 'default' ||
                couponInfo.couponType === 'restaurant' ||
                couponInfo.couponType === 'firstorder')
            ) {
              if (couponInfo.discountType === 'amount') {
                couponDiscount = parseFloat(couponInfo.minDiscount);
              } else {
                const minCouponDiscount = parseFloat(
                  (parseFloat(itemTotalPrice).toFixed(2) *
                    parseFloat(couponInfo.minDiscount).toFixed(2)) /
                    100
                ).toFixed(2);
                const maxCouponDiscount = parseFloat(
                  (parseFloat(itemTotalPrice).toFixed(2) *
                    parseFloat(couponInfo.maxDiscount).toFixed(2)) /
                    100
                ).toFixed(2);
                const lengthOfCouponCode = parseInt(couponInfo.code.length, 10);
                if (lengthOfCouponCode % 2 === 0) {
                  couponDiscount = parseFloat(minCouponDiscount);
                } else {
                  couponDiscount = parseFloat(maxCouponDiscount);
                }
              }
            }
            if (
              orderTo === 'homedelivery' &&
              orderSettings &&
              orderSettings.business &&
              orderSettings.business.deliveryChargeMethod === 'distance'
            ) {
              const deliveryChargeAmount = parseFloat(orderSettings.business.deliveryChargeAmount);
              deliveryPrice = parseFloat(deliveryChargeAmount * parseFloat(distance)).toFixed(2);
            } else if (
              orderTo === 'homedelivery' &&
              orderSettings &&
              orderSettings.business &&
              orderSettings.business.deliveryChargeMethod !== 'distance'
            ) {
              const deliveryChargeAmount = parseFloat(orderSettings.business.deliveryChargeAmount);
              deliveryPrice = deliveryChargeAmount;
            }
            if (
              orderTo === 'homedelivery' &&
              orderSettings &&
              orderSettings.business &&
              orderSettings.business.haveFreeDeliveryInTotal === true &&
              parseFloat(orderSettings.business.freeDelivery) > 0 &&
              parseFloat(itemTotalPrice) >= parseFloat(orderSettings.business.freeDelivery)
            ) {
              deliveryPrice = 0;
            }
            if (
              orderTo === 'homedelivery' &&
              orderSettings &&
              orderSettings.business &&
              orderSettings.business.haveFreeDeliveryInDistance === true &&
              parseFloat(orderSettings.business.freeDeliveryInDistance) > 0 &&
              parseFloat(orderSettings.business.freeDeliveryInDistance) > parseFloat(distance)
            ) {
              deliveryPrice = 0;
            }
            if (orderTo === 'selfpickup') {
              deliveryPrice = 0;
            }
            if (
              coupon &&
              coupon !== null &&
              coupon !== '' &&
              couponInfo.couponType === 'freedelivery'
            ) {
              deliveryPrice = 0;
            }
            const walletInfo = await walletService.getWalletByUserId(user);
            if (walletUsed === true) {
              if (walletInfo && walletInfo !== null) {
                if (parseFloat(walletInfo.balance) <= parseFloat(itemTotalPrice)) {
                  walletAmount = parseFloat(walletInfo.balance).toFixed(2);
                } else {
                  walletAmount = parseFloat(itemTotalPrice).toFixed(2);
                }
              }
            }
            if (checkArrayNotEmpty(cartItemJSON)) {
              if (coupon && coupon !== null && coupon !== '' && couponInfo.couponType === 'bogo') {
                const singleQuantityItems = cartItemJSON.filter(
                  (x) => parseInt(x.quantity, 10) === 1
                );
                if (checkArrayNotEmpty(singleQuantityItems) && singleQuantityItems.length >= 2) {
                  const minTotalItem = singleQuantityItems.reduce((a, b) =>
                    parseFloat(a.totalPrice) < parseFloat(b.totalPrice) ? a : b
                  );
                  if (
                    minTotalItem !== null &&
                    minTotalItem.uuid !== null &&
                    minTotalItem.uuid !== ''
                  ) {
                    const indexOfMinTotalItem = cartItemJSON.findIndex(
                      (x) => x.uuid === minTotalItem.uuid
                    );
                    if (indexOfMinTotalItem !== -1) {
                      cartItemJSON[indexOfMinTotalItem].newTotalPrice = 0;
                    }
                  }
                }
              }
              let realPriceBeforeBOGO = 0;
              let itemTotalBeforeBOGO = 0;
              let itemDiscountBeforeBOGO = 0;
              let itemTotalAfterBOGO = 0;
              cartItemJSON.forEach((cartObj) => {
                const indexOfFoodMetaUpdateId = foodMetaUpdateJson.findIndex(
                  (x) => x.id === cartObj.id
                );
                if (indexOfFoodMetaUpdateId === -1) {
                  const foodMetaUpdateParam = {
                    id: cartObj.id,
                    name: cartObj.name,
                    qty: parseInt(cartObj.quantity, 10),
                    totalSoldAmount: parseFloat(cartObj.totalPrice),
                    discountAmountGiven: parseFloat(cartObj.itemDiscount),
                  };
                  foodMetaUpdateJson.push(foodMetaUpdateParam);
                } else {
                  foodMetaUpdateJson[indexOfFoodMetaUpdateId].qty += parseInt(cartObj.quantity, 10);
                  foodMetaUpdateJson[indexOfFoodMetaUpdateId].totalSoldAmount += parseFloat(
                    cartObj.totalPrice
                  );
                  foodMetaUpdateJson[indexOfFoodMetaUpdateId].discountAmountGiven += parseFloat(
                    cartObj.itemDiscount
                  );
                }
                if (indexOfFoodMetaUpdateId !== -1) {
                  foodMetaUpdateJson[indexOfFoodMetaUpdateId].totalSoldAmount = parseFloat(
                    foodMetaUpdateJson[indexOfFoodMetaUpdateId].totalSoldAmount
                  ).toFixed(2);
                  foodMetaUpdateJson[indexOfFoodMetaUpdateId].discountAmountGiven = parseFloat(
                    foodMetaUpdateJson[indexOfFoodMetaUpdateId].discountAmountGiven
                  ).toFixed(2);
                }

                if (
                  coupon &&
                  coupon !== null &&
                  coupon !== '' &&
                  couponInfo.couponType === 'bogo'
                ) {
                  const countTotal = (
                    parseFloat(itemTotalBeforeBOGO.toString()) +
                    parseFloat(cartObj.totalPrice.toString())
                  ).toFixed(2);
                  itemTotalBeforeBOGO = parseFloat(countTotal);
                  const realCountTotal = (
                    parseFloat(realPriceBeforeBOGO.toString()) +
                    parseFloat(cartObj.realPrice.toString())
                  ).toFixed(2);
                  realPriceBeforeBOGO = parseFloat(realCountTotal);
                  const itemDisountCountTotal = (
                    parseFloat(itemDiscountBeforeBOGO.toString()) +
                    parseFloat(cartObj.itemDiscount.toString())
                  ).toFixed(2);
                  itemDiscountBeforeBOGO = parseFloat(itemDisountCountTotal);
                  if (
                    coupon &&
                    coupon !== null &&
                    coupon !== '' &&
                    couponInfo.couponType === 'bogo'
                  ) {
                    if (parseInt(cartObj.quantity, 10) >= 2) {
                      const newTotalPriceString = parseFloat(
                        parseFloat(cartObj.totalPrice) - parseFloat(cartObj.singleProductPrice)
                      ).toFixed(2);
                      const indexOfTwoQuantityItem = cartItemJSON.findIndex(
                        (x) => x.uuid === cartObj.uuid
                      );
                      if (indexOfTwoQuantityItem !== -1) {
                        cartItemJSON[indexOfTwoQuantityItem].newTotalPrice =
                          parseFloat(newTotalPriceString);
                      }
                    }
                  }
                  const newTotalPriceAfterBOGO = Object.keys(cartObj).includes('newTotalPrice')
                    ? cartObj.newTotalPrice
                    : cartObj.totalPrice;
                  const countTotalOFBOGO = (
                    parseFloat(itemTotalAfterBOGO) + parseFloat(newTotalPriceAfterBOGO)
                  ).toFixed(2);
                  itemTotalAfterBOGO = parseFloat(countTotalOFBOGO);
                  delete cartObj.newTotalPrice;
                }
              });
              if (coupon && coupon !== null && coupon !== '' && couponInfo.couponType === 'bogo') {
                const couponDiscountAmountString = (
                  parseFloat(itemTotalBeforeBOGO) - parseFloat(itemTotalAfterBOGO)
                ).toFixed(2);
                couponDiscount = parseFloat(couponDiscountAmountString);
              }
            }
            const subTotal = parseFloat(
              parseFloat(itemTotalPrice) +
                parseFloat(foodTaxPrice) +
                parseFloat(serviceTaxPrice) +
                parseFloat(packagePrice) +
                parseFloat(packageTaxPrice) +
                parseFloat(deliveryTipPrice) +
                parseFloat(deliveryPrice)
            ).toFixed(2);
            const grandTotal = parseFloat(
              parseFloat(subTotal) - parseFloat(couponDiscount) - parseFloat(walletAmount)
            ).toFixed(2);
            const restaurantCommission = orderSettings.commission;
            const restaurantTotalEarning = parseFloat(
              parseFloat(itemTotalPrice) + parseFloat(packagePrice) + parseFloat(packageTaxPrice)
            ).toFixed(2);
            const adminCommission = parseFloat(
              (parseFloat(restaurantTotalEarning) * parseFloat(restaurantCommission)) / 100
            ).toFixed(2);
            let restaurantCampaign = '';
            let foodCampaign = '';
            const restaurantCampaignIndex = cartItems.inCartItems.findIndex(
              (x) => x.restaurantCampaign !== null
            );
            const foodCampaignIndex = cartItems.inCartItems.findIndex(
              (x) => x.foodCampaign !== null
            );
            if (restaurantCampaignIndex !== -1) {
              restaurantCampaign =
                cartItems.inCartItems[restaurantCampaignIndex].restaurantCampaign;
            }
            if (foodCampaignIndex !== -1) {
              foodCampaign = cartItems.inCartItems[foodCampaignIndex].foodCampaign;
            }
            const orderParam = {
              user: `${user}`,
              payment: `${payment}`,
              restaurant: `${restaurant}`,
              addons: serverAddonIds,
              foods: serverFoodIds,
              coupon: `${coupon}`,
              couponType:
                coupon && coupon !== null && coupon !== '' && couponInfo && couponInfo !== null
                  ? couponInfo.couponType
                  : '',
              orderTo: `${orderTo}`,
              cookingInstruction: `${cookingInstruction}`,
              deliveryInstruction: `${deliveryInstruction}`,
              deliveryAddress: `${deliveryAddress}`,
              deliveryAddressRaw:
                deliveryAddress &&
                deliveryAddress !== null &&
                deliveryAddress !== '' &&
                userRawAddress !== null &&
                userRawAddress !== ''
                  ? userRawAddress
                  : '',
              receiverName: `${receiverName}`,
              countryCode: `${countryCode}`,
              receiverContact: `${receiverContact}`,
              cartItemRaw: JSON.stringify(cartItemJSON),
              walletUsed: `${walletUsed}`,
              instantOrder: `${instantOrder}`,
              scheduleOrder: `${scheduleOrder}`,
              scheduleDate: `${scheduleDate}`,
              scheduleTime: `${scheduleTime}`,
              orderAt: `${orderAt}`,
              realTotal: parseFloat(itemRealTotalPrice),
              itemTotal: parseFloat(itemTotalPrice),
              itemDiscount: parseFloat(itemDiscountPrice),
              couponDiscountCharge: parseFloat(couponDiscount),
              deliveryCharge: parseFloat(deliveryPrice),
              foodServiceCharge: parseFloat(foodTaxPrice),
              serviceCharge: parseFloat(serviceTaxPrice),
              packageCharge: parseFloat(packagePrice),
              packageChargeTax: parseFloat(packageTaxPrice),
              deliveryTip: parseFloat(deliveryTipPrice),
              extraCharge: 0,
              walletAmount: parseFloat(walletAmount),
              grandTotal: parseFloat(grandTotal),
              status: 'pending_payments',
              orderFrom: 'app',
              restaurantCommission: adminCommission,
              deliveryCommission: 0,
              restaurantCampaign: `${restaurantCampaign}`,
              foodCampaign: `${foodCampaign}`,
            };
            const userSettings = await userSettingService.getLoyaltySettings();
            let loyalPoints = 0;
            const paymentInfo = await paymentConfigService.getPaymentById(payment);
            const order = await ordersService.createOrder(orderParam);
            await addonsService.updateAddonStockAfterOrder(addonUpdateData);
            await foodService.updateFooodStockAfterOrder(foodUpdateData);
            await foodService.updateFoodMetaAfterOrder(foodMetaUpdateJson);
            await cartItemService.removeCartItemByRestaurant(trackingId, restaurant);
            if (userSettings !== null && userSettings.canEarnLoyaltyPointOnOrder === true) {
              const requiredTotal = parseFloat(userSettings.loyaltyMinOrderTotal);
              const gainLoyalPoints = parseFloat(userSettings.loyaltyPointValue);
              if (requiredTotal <= parseFloat(grandTotal)) {
                const savePoints = {
                  user: `${user}`,
                  orderId: order.id,
                  coupon: null,
                  loyaltyPointValue: gainLoyalPoints,
                  redeemFrom: 'order',
                };
                await loyaltyPointsService.saveLoyaltyPoint(savePoints);
                loyalPoints += gainLoyalPoints;
              }
            }
            if (
              coupon &&
              coupon !== null &&
              coupon !== '' &&
              couponInfo &&
              couponInfo !== null &&
              couponInfo.couponType !== null &&
              couponInfo.couponType === 'loyality'
            ) {
              const gainLoyalPoints = parseFloat(couponInfo.loyalityPoints);
              const savePoints = {
                user: `${user}`,
                orderId: order.id,
                coupon: `${coupon}`,
                loyaltyPointValue: gainLoyalPoints,
                redeemFrom: 'coupon',
              };
              await loyaltyPointsService.saveLoyaltyPoint(savePoints);
              loyalPoints += gainLoyalPoints;
            }
            if (
              walletInfo !== null &&
              walletInfo.id !== null &&
              walletUsed === true &&
              walletAmount !== 0
            ) {
              const oldBalance = walletInfo.balance;
              const userWalletId = walletInfo.id;
              const newBalance = parseFloat(oldBalance) - parseFloat(walletAmount);
              await walletService.updateWallet(userWalletId, { balance: newBalance });
              await transactionService.saveTransation({
                payableId: user,
                walletId: userWalletId,
                type: 'withdrawal',
                amount: walletAmount,
                confirmed: true,
                meta: [{ reason: `withdrawal from order #${order.id}` }],
                status: true,
              });
            }
            if (paymentInfo !== null && paymentInfo.id !== '') {
              await ordersService.updateOrderStatus(order.id, {
                paymentMode: paymentInfo.paymentWay,
              });
              await emailConfigService.orderSummaryEmail(order.id);
              if (paymentInfo.paymentWay === 'offline') {
                await ordersService.updateOrderStatus(order.id, { status: 'created' });
                await fcmNotificationService.restaurantNewOrder(order.id, restaurant, user);
                res.status(201).send({
                  id: order.id,
                  success: true,
                  status: 'offline',
                  payLink: '',
                  points: loyalPoints,
                });
              } else {
                const paymentMeta = {
                  user: `${user}`,
                  payment: `${payment}`,
                  orders: order.id,
                  amount: parseFloat(grandTotal),
                  from: 'order',
                  ref: `order for #${order.id}`,
                };
                const paymentLink = await paymentInitiationService.initiatePayment(paymentMeta);
                if (paymentLink !== null && paymentLink.id !== '') {
                  // Enterprise: instant pending push with the 30-min window.
                  // Fire-and-forget — a push failure must not fail the order.
                  try {
                    fcmNotificationService.userPaymentPending(order.id, user, 30).catch(() => {});
                  } catch (pushErr) {
                    void pushErr;
                  }
                  res.status(201).send({
                    id: order.id,
                    success: true,
                    status: 'online',
                    payLink: paymentLink.id,
                    points: loyalPoints,
                  });
                } else {
                  res.status(400).send({
                    code: 400,
                    message: 'Something went wrong, please contact administrator',
                    extra: '',
                  });
                }
              }
            } else {
              res.status(400).send({
                code: 400,
                message: 'Something went wrong, please contact administrator',
                extra: '',
              });
            }
          } else {
            res
              .status(400)
              .send({ code: 400, message: 'One of the addon or variation is not available' });
          }
        } else {
          const nonEmptyStock = [
            itemOutOfStockName,
            addonOutOfStockName,
            variationOutOfStockName,
          ].filter((str) => str !== '');
          res.status(400).send({
            code: 400,
            message: `Sorry, ##dynamic## is currently out of stock and cannot be added to your order.`,
            extra: `${nonEmptyStock.join(',')}`,
          });
        }
      } else {
        res.status(400).send({ code: 400, message: 'One of the food is not available' });
      }
    } else {
      res.status(400).send({ code: 400, message: 'Cart is Empty' });
    }
  }
});

const placePOSAdminOrder = catchAsync(async (req, res) => {
  const {
    vendor,
    scheduleOrder,
    scheduleDate,
    scheduleTime,
    orderTo,
    address,
    instantOrder,
    cartItem,
    walletUsed,
    user,
    orderAt,
  } = req.body;
  const orderSettings = await orderSettingsService.getOrderSettingForCheckout(vendor);
  let isValidScheduleDate = false;
  if (
    orderSettings &&
    orderSettings.orders &&
    orderSettings.orders.customerCanOrderWithinDays !== null &&
    scheduleOrder === true
  ) {
    const scheduleOrderRange = DateTime.now().plus({
      days: parseInt(orderSettings.orders.customerCanOrderWithinDays, 10) - 1,
    });

    const scheduleOrderDateString = `${DateTime.fromJSDate(new Date(scheduleDate)).toFormat('yyyy-MM-dd')} ${scheduleTime}`;

    const scheduleOrderDate = DateTime.fromFormat(scheduleOrderDateString, 'yyyy-MM-dd hh:mm a');

    if (scheduleOrderDate < scheduleOrderRange && scheduleOrderDate >= DateTime.now()) {
      isValidScheduleDate = true;
    }
  }
  let distance = 0;
  if (orderTo === 'homedelivery') {
    const point1 = [address.longitude, address.latitude];
    if (orderSettings && orderSettings.restaurant && orderSettings.restaurant.id === vendor) {
      const point2 = orderSettings.restaurant.location.coordinates;
      const distanceInMeter = haversineDistance(point1, point2);
      const findMode =
        orderSettings &&
        orderSettings.business &&
        orderSettings.business.findMode &&
        orderSettings.business.findMode !== ''
          ? orderSettings.business.findMode
          : 'km';
      distance =
        findMode === 'km'
          ? parseFloat(distanceInMeter / 1000).toFixed(2)
          : parseFloat(distanceInMeter / 1609.34).toFixed(2);
    }
  }
  if (orderSettings.canPlaceOrder === false) {
    res.status(400).send({ code: 400, message: 'Limit Crossed' });
  } else if (
    orderTo === 'homedelivery' &&
    (address.flatHouse === '' || address.longitude === 0 || address.latitude === 0)
  ) {
    res.status(400).send({ code: 400, message: 'Address is missing' });
  } else if (
    orderTo === 'homedelivery' &&
    (orderSettings.orders.homeDelivery === false ||
      orderSettings.restaurant.acceptHomeDelivery === false)
  ) {
    res.status(400).send({ code: 400, message: 'Home Delivery is disabled' });
  } else if (
    orderTo === 'selfpickup' &&
    (orderSettings.orders.takeaway === false || orderSettings.restaurant.takeAway === false)
  ) {
    res.status(400).send({ code: 400, message: 'Self Pickup is disabled' });
  } else if (instantOrder === true && orderSettings.orders.instantOrder === false) {
    res.status(400).send({ code: 400, message: 'Instant Order is disabled' });
  } else if (
    scheduleOrder === true &&
    (orderSettings.orders.scheduleDelivery === false ||
      orderSettings.restaurant.acceptScheduleDelivery === false)
  ) {
    res.status(400).send({ code: 400, message: 'Schedule Order is disabled' });
  } else if (scheduleOrder === true && isValidScheduleDate === false) {
    res.status(400).send({ code: 400, message: 'Schedule Date is invalid' });
  } else if (parseFloat(distance) > parseFloat(orderSettings.business.deliveryArea)) {
    res.status(400).send({ code: 400, message: 'Can not deliver order to this address' });
  } else {
    try {
      if (checkArrayNotEmpty(cartItem)) {
        const savedItemIds = cartItem.map((item) => item.food.toString());
        let foodIds = lodash.uniq(savedItemIds);
        foodIds = foodIds.map((item) => new mongoose.Types.ObjectId(item));
        const cartItems = await cartItemService.vendorPosOrderFoodInfoForCheckout(foodIds);
        if (checkArrayNotEmpty(cartItems.foodInfoInCart)) {
          if (cartItems.success === true) {
            let itemInStock = true;
            let itemOutOfStockName = '';
            let addonInStock = true;
            let addonOutOfStockName = '';
            let variationInStock = true;
            let variationOutOfStockName = '';
            const savedFoodTotal = [];
            const savedAddonTotal = [];
            const savedAddonIds = [];
            const serverAddonIds = [];
            const savedVariationsTotal = [];
            const savedVariationIds = [];
            const serverVariationIds = [];
            const serverFoodIds = [];
            const addonUpdateData = [];
            const foodUpdateData = [];
            let itemTotalPrice = 0;
            let itemRealTotalPrice = 0;
            let itemDiscountPrice = 0;
            let foodTaxPrice = 0;
            let serviceTaxPrice = 0;
            let packagePrice = 0;
            let packageTaxPrice = 0;
            let deliveryPrice = 0;
            let walletAmount = 0;
            const cartItemJSON = [];
            const foodMetaUpdateJson = [];
            cartItem.forEach((inCartItemElement) => {
              let addonInItem = [];
              if (
                inCartItemElement &&
                inCartItemElement.addons &&
                inCartItemElement.addons !== null &&
                inCartItemElement.addons !== ''
              ) {
                addonInItem = inCartItemElement.addons.split(',');
              }
              const foodIdParam = {
                id: inCartItemElement.food.toString(),
                total: parseInt(inCartItemElement.quantity, 10),
              };
              const indexOfFoodId = savedFoodTotal.findIndex(
                (item) => item.id === inCartItemElement.food.toString()
              );
              if (indexOfFoodId === -1) {
                savedFoodTotal.push(foodIdParam);
                serverFoodIds.push(foodIdParam.id);
              } else {
                savedFoodTotal[indexOfFoodId].total += parseInt(inCartItemElement.quantity, 10);
              }
              if (checkArrayNotEmpty(addonInItem)) {
                addonInItem.forEach((addonElement) => {
                  const addonParam = {
                    id: addonElement.toString(),
                    total: parseInt(inCartItemElement.quantity, 10),
                  };
                  const indexOfAddonId = savedAddonTotal.findIndex(
                    (item) => item.id === addonElement.toString()
                  );
                  if (indexOfAddonId === -1) {
                    savedAddonIds.push(addonElement.toString());
                    savedAddonTotal.push(addonParam);
                  } else {
                    savedAddonTotal[indexOfAddonId].total += parseInt(
                      inCartItemElement.quantity,
                      10
                    );
                  }
                });
              }
              if (
                inCartItemElement &&
                inCartItemElement.variations &&
                checkArrayNotEmpty(inCartItemElement.variations)
              ) {
                inCartItemElement.variations.forEach((variationElement) => {
                  variationElement.selected.forEach((optionElement) => {
                    const variationParam = {
                      id: `${variationElement.variation}-${optionElement}-${inCartItemElement.food}`,
                      total: parseInt(inCartItemElement.quantity, 10),
                    };
                    const indexOfVariationId = savedVariationsTotal.findIndex(
                      (item) =>
                        item.id ===
                        `${variationElement.variation}-${optionElement}-${inCartItemElement.food}`
                    );
                    if (indexOfVariationId === -1) {
                      savedVariationIds.push(
                        `${variationElement.variation}-${optionElement}-${inCartItemElement.food}`
                      );
                      savedVariationsTotal.push(variationParam);
                    } else {
                      savedVariationsTotal[indexOfVariationId].total += parseInt(
                        inCartItemElement.quantity,
                        10
                      );
                    }
                  });
                });
              }
            });
            cartItems.foodInfoInCart.forEach((foodInfoElement) => {
              const indexOfSavedFoodId = savedFoodTotal.findIndex(
                (item) => item.id.toString() === foodInfoElement.id.toString()
              );
              if (
                (foodInfoElement.inStock !== true || foodInfoElement.status !== 'live') &&
                itemInStock === true
              ) {
                itemInStock = false;
                itemOutOfStockName = foodInfoElement.name;
              } else if (
                indexOfSavedFoodId !== -1 &&
                foodInfoElement.stockType !== 'unlimited' &&
                savedFoodTotal[indexOfSavedFoodId].total >
                  parseInt(foodInfoElement.stockNumber, 10) &&
                itemInStock === true
              ) {
                itemInStock = false;
                itemOutOfStockName = foodInfoElement.name;
              }
              if (
                foodInfoElement &&
                foodInfoElement.addons &&
                checkArrayNotEmpty(foodInfoElement.addons)
              ) {
                foodInfoElement.addons.forEach((addonElement) => {
                  const indexOfSavedAddonId = savedAddonTotal.findIndex(
                    (item) => item.id.toString() === addonElement.id.toString()
                  );
                  if (!serverAddonIds.includes(addonElement.id.toString())) {
                    serverAddonIds.push(addonElement.id.toString());
                  }
                  if (
                    indexOfSavedAddonId !== -1 &&
                    (addonElement.inStock === false || addonElement.status === false) &&
                    addonInStock === true
                  ) {
                    addonInStock = false;
                    addonOutOfStockName = addonElement.name;
                  } else if (
                    indexOfSavedAddonId !== -1 &&
                    addonElement.stockType !== 'unlimited' &&
                    savedAddonTotal[indexOfSavedAddonId].total >
                      parseInt(addonElement.stockNumber, 10)
                  ) {
                    addonInStock = false;
                    addonOutOfStockName = addonElement.name;
                  }
                });
              }
              if (
                foodInfoElement &&
                foodInfoElement.variations &&
                checkArrayNotEmpty(foodInfoElement.variations)
              ) {
                foodInfoElement.variations.forEach((variationElement) => {
                  if (
                    variationElement &&
                    variationElement.options &&
                    checkArrayNotEmpty(variationElement.options)
                  ) {
                    variationElement.options.forEach((optionElement) => {
                      const indexOfVariationId = savedVariationsTotal.findIndex(
                        (item) =>
                          item.id.toString() ===
                          `${variationElement.title}-${optionElement.name}-${foodInfoElement.id}`
                      );
                      if (
                        !serverVariationIds.includes(
                          `${variationElement.title}-${optionElement.name}-${foodInfoElement.id}`
                        )
                      ) {
                        serverVariationIds.push(
                          `${variationElement.title}-${optionElement.name}-${foodInfoElement.id}`
                        );
                      }
                      if (
                        indexOfVariationId !== -1 &&
                        foodInfoElement.stockType !== 'unlimited' &&
                        savedVariationsTotal[indexOfVariationId].total >
                          parseInt(optionElement.stock, 10)
                      ) {
                        variationInStock = false;
                        variationOutOfStockName = optionElement.name;
                      }
                    });
                  }
                });
              }
              cartItem.forEach((inCartItemElement) => {
                if (foodInfoElement.id.toString() === inCartItemElement.food.toString()) {
                  const cartAddonJSON = [];
                  const cartVariationJSON = [];
                  const basePrice = Number(parseFloat(foodInfoElement.price).toFixed(2));
                  let finalPrice;
                  let addonPrice = 0;
                  let variationPrice = 0;
                  let taxAmount = 0;
                  if (foodInfoElement && foodInfoElement.taxationEnable === true) {
                    foodInfoElement.foodtaxations.forEach((taxPrice) => {
                      taxAmount += parseFloat(taxPrice.taxAmount);
                    });
                    const taxAmountData = basePrice * (taxAmount / 100);
                    finalPrice = parseFloat(basePrice + taxAmountData).toFixed(2);
                  } else {
                    finalPrice = parseFloat(basePrice).toFixed(2);
                  }
                  const indexOfSavedFoodTotalId = savedFoodTotal.findIndex(
                    (x) => x.id.toString() === foodInfoElement.id.toString()
                  );
                  const indexOfSavedFoodUpdateId = foodUpdateData.findIndex(
                    (x) => x.id.toString() === foodInfoElement.id.toString()
                  );
                  if (
                    indexOfSavedFoodTotalId !== -1 &&
                    indexOfSavedFoodUpdateId === -1 &&
                    foodInfoElement.stockType !== 'unlimited'
                  ) {
                    const updatedFoodStockNumber = parseInt(
                      parseInt(foodInfoElement.stockNumber, 10) -
                        parseInt(savedFoodTotal[indexOfSavedFoodTotalId].total, 10),
                      10
                    );
                    const updateFoodParam = {
                      id: foodInfoElement.id.toString(),
                      name: foodInfoElement.name,
                      updateSet: {
                        stockNumber: updatedFoodStockNumber,
                        inStock: updatedFoodStockNumber > 0,
                      },
                    };
                    foodUpdateData.push(updateFoodParam);
                  }
                  if (
                    foodInfoElement &&
                    foodInfoElement.addons &&
                    checkArrayNotEmpty(foodInfoElement.addons)
                  ) {
                    foodInfoElement.addons.forEach((addonElement) => {
                      let addonInItem = [];
                      if (
                        inCartItemElement &&
                        inCartItemElement.addons &&
                        inCartItemElement.addons !== null &&
                        inCartItemElement.addons !== ''
                      ) {
                        addonInItem = inCartItemElement.addons.split(',');
                      }
                      if (checkArrayNotEmpty(addonInItem)) {
                        if (addonInItem.includes(addonElement.id.toString())) {
                          const indexOfSavedAddonTotalId = savedAddonTotal.findIndex(
                            (x) => x.id.toString() === addonElement.id.toString()
                          );
                          const indexOfSavedAddonUpdateId = addonUpdateData.findIndex(
                            (x) => x.id.toString() === addonElement.id.toString()
                          );
                          if (
                            indexOfSavedAddonTotalId !== -1 &&
                            indexOfSavedAddonUpdateId === -1 &&
                            addonElement.stockType !== 'unlimited'
                          ) {
                            const updatedAddonStockNumber = parseInt(
                              parseInt(addonElement.stockNumber, 10) -
                                parseInt(savedAddonTotal[indexOfSavedAddonTotalId].total, 10),
                              10
                            );
                            const updateAddonParam = {
                              id: addonElement.id.toString(),
                              updateSet: {
                                stockNumber: updatedAddonStockNumber,
                                inStock: updatedAddonStockNumber > 0,
                              },
                            };
                            addonUpdateData.push(updateAddonParam);
                          }
                          addonPrice += Number(parseFloat(addonElement.price).toFixed(2));
                          cartAddonJSON.push(addonElement);
                        }
                      }
                    });
                  }
                  if (
                    foodInfoElement &&
                    foodInfoElement.variations &&
                    checkArrayNotEmpty(foodInfoElement.variations)
                  ) {
                    const updatedVariationParam = foodInfoElement.variations;
                    foodInfoElement.variations.forEach((foodInfoElementVariation) => {
                      if (
                        inCartItemElement &&
                        inCartItemElement.variations &&
                        checkArrayNotEmpty(inCartItemElement.variations)
                      ) {
                        inCartItemElement.variations.forEach((inCartItemVariation) => {
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
                                  if (
                                    inCartItemVariation.selected.includes(
                                      foodInfoElementOption.name
                                    )
                                  ) {
                                    variationParam.options.push(foodInfoElementOption);
                                    variationPrice += Number(
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
                    const indexOfUpdateFoodId = foodUpdateData.findIndex(
                      (x) => x.id.toString() === foodInfoElement.id.toString()
                    );
                    if (indexOfUpdateFoodId !== -1) {
                      foodUpdateData[indexOfUpdateFoodId].updateSet.variations =
                        updatedVariationParam;
                    }
                  }
                  finalPrice = Number(
                    parseFloat(
                      parseFloat(finalPrice) + parseFloat(addonPrice) + parseFloat(variationPrice)
                    ).toFixed(2)
                  );
                  let realPrice = parseFloat(finalPrice);
                  let itemDiscount = 0;
                  if (parseFloat(foodInfoElement.discount) > 0) {
                    if (foodInfoElement.discountType === '%') {
                      const discountAmountOfFood = parseFloat(
                        (finalPrice * foodInfoElement.discount) / 100
                      ).toFixed(2);
                      itemDiscount = parseFloat(discountAmountOfFood);
                      finalPrice = parseFloat(finalPrice - discountAmountOfFood).toFixed(2);
                    } else {
                      itemDiscount = parseFloat(foodInfoElement.discount);
                      finalPrice = parseFloat(
                        parseFloat(finalPrice) - parseFloat(foodInfoElement.discount)
                      ).toFixed(2);
                    }
                  }
                  const itemPrice = parseFloat(
                    parseFloat(
                      parseFloat(finalPrice).toFixed(2) * parseInt(inCartItemElement.quantity, 10)
                    ).toFixed(2)
                  );
                  realPrice = parseFloat(
                    parseFloat(
                      parseFloat(realPrice).toFixed(2) * parseInt(inCartItemElement.quantity, 10)
                    ).toFixed(2)
                  );
                  itemDiscount = parseFloat(
                    parseFloat(
                      parseFloat(itemDiscount).toFixed(2) * parseInt(inCartItemElement.quantity, 10)
                    ).toFixed(2)
                  );
                  itemTotalPrice += itemPrice;
                  itemRealTotalPrice += realPrice;
                  itemDiscountPrice += itemDiscount;
                  cartItemJSON.push({
                    name: foodInfoElement.name,
                    uuid: inCartItemElement.uuid,
                    addons: cartAddonJSON,
                    variations: cartVariationJSON,
                    discount: foodInfoElement.discount,
                    discountType: foodInfoElement.discountType,
                    endTime: foodInfoElement.endTime,
                    foodType: foodInfoElement.foodType,
                    foodtaxations: foodInfoElement.foodtaxations,
                    id: foodInfoElement.id,
                    image: foodInfoElement.image,
                    inStock: foodInfoElement.inStock,
                    price: parseFloat(foodInfoElement.price),
                    purchaseLimit: parseInt(foodInfoElement.purchaseLimit, 10),
                    quantity: parseInt(inCartItemElement.quantity, 10),
                    restaurant: foodInfoElement.restaurant,
                    restaurantInfo: {
                      cover: orderSettings.restaurant.cover,
                      id: orderSettings.restaurant.id,
                      logo: orderSettings.restaurant.logo,
                      name: orderSettings.restaurant.name,
                      slug: orderSettings.restaurant.slug,
                      translations: orderSettings.restaurant.translations,
                    },
                    shortDescription: foodInfoElement.shortDescription,
                    startTime: foodInfoElement.startTime,
                    status: foodInfoElement.status,
                    taxationEnable: foodInfoElement.taxationEnable,
                    realPrice: parseFloat(realPrice),
                    itemDiscount: parseFloat(itemDiscount),
                    totalPrice: parseFloat(itemPrice),
                    translations: foodInfoElement.translations,
                    instruction: inCartItemElement.instruction,
                  });
                }
              });
            });
            if (foodUpdateData !== null && checkArrayNotEmpty(foodUpdateData)) {
              foodUpdateData.forEach((foodItemUpdate) => {
                if (
                  foodItemUpdate !== null &&
                  foodItemUpdate.updateSet !== null &&
                  foodItemUpdate.updateSet.variations !== null &&
                  checkArrayNotEmpty(foodItemUpdate.updateSet.variations)
                ) {
                  foodItemUpdate.updateSet.variations.forEach((foodUpdateVariation) => {
                    if (
                      foodUpdateVariation !== null &&
                      foodUpdateVariation.options !== null &&
                      checkArrayNotEmpty(foodUpdateVariation.options)
                    ) {
                      foodUpdateVariation.options.forEach((foodUpdateVariationOption) => {
                        const indexOfSavedVariationTotalId = savedVariationsTotal.findIndex(
                          (x) =>
                            x.id.toString() ===
                            `${foodUpdateVariation.title}-${foodUpdateVariationOption.name}-${foodItemUpdate.id}`
                        );
                        if (indexOfSavedVariationTotalId !== -1) {
                          const updatedOptionStockNumber = parseInt(
                            parseInt(foodUpdateVariationOption.stock, 10) -
                              parseInt(
                                savedVariationsTotal[indexOfSavedVariationTotalId].total,
                                10
                              ),
                            10
                          );
                          foodUpdateVariationOption.stock = updatedOptionStockNumber.toString();
                        }
                      });
                    }
                  });
                }
              });
            }
            itemTotalPrice = parseFloat(itemTotalPrice).toFixed(2);
            const isAddonThere = savedAddonIds.every((item) => serverAddonIds.includes(item));
            const isVariationThere = savedVariationIds.every((item) =>
              serverVariationIds.includes(item)
            );
            if (parseFloat(itemTotalPrice) < parseFloat(orderSettings.restaurant.minOrderAmount)) {
              res.status(400).send({
                code: 400,
                message: `Please note that a minimum order value of ##dynamic## is required to proceed with your order`,
                extra: `${orderSettings.restaurant.minOrderAmount}`,
              });
            } else if (itemInStock === true && addonInStock === true && variationInStock === true) {
              if (isAddonThere && isVariationThere) {
                if (
                  orderSettings &&
                  orderSettings.business &&
                  orderSettings.business.includeTaxOnFood === true
                ) {
                  if (orderSettings.business.foodTaxType === 'per') {
                    foodTaxPrice = parseFloat(
                      (parseFloat(itemTotalPrice).toFixed(2) *
                        parseFloat(orderSettings.business.foodTaxAmount).toFixed(2)) /
                        100
                    ).toFixed(2);
                  } else {
                    foodTaxPrice = parseFloat(orderSettings.business.foodTaxAmount);
                  }
                }
                if (
                  orderSettings &&
                  orderSettings.business &&
                  orderSettings.business.additionalServiceCharge === true
                ) {
                  serviceTaxPrice = parseFloat(
                    orderSettings.business.additionalServiceAmount
                  ).toFixed(2);
                }
                if (
                  orderSettings &&
                  orderSettings.packaging &&
                  orderSettings.packaging.havePackagingCharges === true
                ) {
                  packagePrice = parseFloat(orderSettings.packaging.packagingCharges).toFixed(2);
                }
                if (
                  orderSettings &&
                  orderSettings.packaging &&
                  orderSettings.packaging.includePackagesChargesInTax === true
                ) {
                  packageTaxPrice = parseFloat(
                    (parseFloat(orderSettings.packaging.packagingCharges).toFixed(2) *
                      parseFloat(orderSettings.packaging.packagingChargesTax).toFixed(2)) /
                      100
                  ).toFixed(2);
                }

                if (
                  orderTo === 'homedelivery' &&
                  orderSettings &&
                  orderSettings.business &&
                  orderSettings.business.deliveryChargeMethod === 'distance'
                ) {
                  const deliveryChargeAmount = parseFloat(
                    orderSettings.business.deliveryChargeAmount
                  );
                  deliveryPrice = parseFloat(deliveryChargeAmount * parseFloat(distance)).toFixed(
                    2
                  );
                } else if (
                  orderTo === 'homedelivery' &&
                  orderSettings &&
                  orderSettings.business &&
                  orderSettings.business.deliveryChargeMethod !== 'distance'
                ) {
                  const deliveryChargeAmount = parseFloat(
                    orderSettings.business.deliveryChargeAmount
                  );
                  deliveryPrice = deliveryChargeAmount;
                }
                if (
                  orderTo === 'homedelivery' &&
                  orderSettings &&
                  orderSettings.business &&
                  orderSettings.business.haveFreeDeliveryInTotal === true &&
                  parseFloat(orderSettings.business.freeDelivery) > 0 &&
                  parseFloat(itemTotalPrice) >= parseFloat(orderSettings.business.freeDelivery)
                ) {
                  deliveryPrice = 0;
                }
                if (
                  orderTo === 'homedelivery' &&
                  orderSettings &&
                  orderSettings.business &&
                  orderSettings.business.haveFreeDeliveryInDistance === true &&
                  parseFloat(orderSettings.business.freeDeliveryInDistance) > 0 &&
                  parseFloat(orderSettings.business.freeDeliveryInDistance) > parseFloat(distance)
                ) {
                  deliveryPrice = 0;
                }
                if (orderTo === 'selfpickup') {
                  deliveryPrice = 0;
                }
                const walletInfo = await walletService.getWalletByUserId(user);
                if (walletUsed === true) {
                  if (walletInfo && walletInfo !== null) {
                    if (parseFloat(walletInfo.balance) <= parseFloat(itemTotalPrice)) {
                      walletAmount = parseFloat(walletInfo.balance).toFixed(2);
                    } else {
                      walletAmount = parseFloat(itemTotalPrice).toFixed(2);
                    }
                  }
                }
                if (checkArrayNotEmpty(cartItemJSON)) {
                  cartItemJSON.forEach((cartObj) => {
                    const indexOfFoodMetaUpdateId = foodMetaUpdateJson.findIndex(
                      (x) => x.id === cartObj.id
                    );
                    if (indexOfFoodMetaUpdateId === -1) {
                      const foodMetaUpdateParam = {
                        id: cartObj.id,
                        name: cartObj.name,
                        qty: parseInt(cartObj.quantity, 10),
                        totalSoldAmount: parseFloat(cartObj.totalPrice),
                        discountAmountGiven: parseFloat(cartObj.itemDiscount),
                      };
                      foodMetaUpdateJson.push(foodMetaUpdateParam);
                    } else {
                      foodMetaUpdateJson[indexOfFoodMetaUpdateId].qty += parseInt(
                        cartObj.quantity,
                        10
                      );
                      foodMetaUpdateJson[indexOfFoodMetaUpdateId].totalSoldAmount += parseFloat(
                        cartObj.totalPrice
                      );
                      foodMetaUpdateJson[indexOfFoodMetaUpdateId].discountAmountGiven += parseFloat(
                        cartObj.itemDiscount
                      );
                    }
                    if (indexOfFoodMetaUpdateId !== -1) {
                      foodMetaUpdateJson[indexOfFoodMetaUpdateId].totalSoldAmount = parseFloat(
                        foodMetaUpdateJson[indexOfFoodMetaUpdateId].totalSoldAmount
                      ).toFixed(2);
                      foodMetaUpdateJson[indexOfFoodMetaUpdateId].discountAmountGiven = parseFloat(
                        foodMetaUpdateJson[indexOfFoodMetaUpdateId].discountAmountGiven
                      ).toFixed(2);
                    }
                  });
                }
                const subTotal = parseFloat(
                  parseFloat(itemTotalPrice) +
                    parseFloat(foodTaxPrice) +
                    parseFloat(serviceTaxPrice) +
                    parseFloat(packagePrice) +
                    parseFloat(packageTaxPrice) +
                    parseFloat(deliveryPrice)
                ).toFixed(2);
                const grandTotal = parseFloat(
                  parseFloat(subTotal) - parseFloat(walletAmount)
                ).toFixed(2);
                const restaurantCommission = orderSettings.posCommission;
                const restaurantTotalEarning = parseFloat(
                  parseFloat(itemTotalPrice) +
                    parseFloat(packagePrice) +
                    parseFloat(packageTaxPrice)
                ).toFixed(2);
                const adminCommission = parseFloat(
                  (parseFloat(restaurantTotalEarning) * parseFloat(restaurantCommission)) / 100
                ).toFixed(2);
                const codPaymentId = await paymentConfigService.codPaymentId();

                let deliveryAddress = '';
                let userRawAddress = '';
                let receiverName = '';
                let countryCode = '';
                let receiverContact = '';
                if (orderTo === 'homedelivery') {
                  receiverName = address.receiverName;
                  countryCode = address.countryCode;
                  receiverContact = address.receiverContact;
                  const addressParam = {
                    user: `${user}`,
                    title: 3,
                    receiverName: `${receiverName}`,
                    receiverContact: `${receiverContact}`,
                    countryCode: `${countryCode}`,
                    flatHouse: address.flatHouse,
                    locality: address.locality,
                    landmark: address.landmark,
                    type: 'Point',
                    longitude: address.longitude,
                    latitude: address.latitude,
                  };
                  const savedAddress = await userAddressService.saveAddress(addressParam);
                  if (savedAddress != null && savedAddress.id) {
                    deliveryAddress = savedAddress.id;
                    userRawAddress = JSON.stringify(savedAddress);
                  }
                } else {
                  const posAdminUserDetail = await userService.posAdminUserDetail(user);
                  receiverName = `${posAdminUserDetail.firstName} ${posAdminUserDetail.lastName}`;
                  countryCode = `${posAdminUserDetail.countryCode}`;
                  receiverContact = `${posAdminUserDetail.mobile}`;
                }

                const orderParam = {
                  user: `${user}`,
                  payment: `${codPaymentId}`,
                  restaurant: `${vendor}`,
                  addons: serverAddonIds,
                  foods: serverFoodIds,
                  coupon: null,
                  couponType: '',
                  orderTo: `${orderTo}`,
                  cookingInstruction: '',
                  deliveryInstruction: '',
                  deliveryAddress: `${deliveryAddress}`,
                  deliveryAddressRaw:
                    deliveryAddress &&
                    deliveryAddress !== null &&
                    deliveryAddress !== '' &&
                    userRawAddress !== null &&
                    userRawAddress !== ''
                      ? userRawAddress
                      : '',
                  receiverName: `${receiverName}`,
                  countryCode: `${countryCode}`,
                  receiverContact: `${receiverContact}`,
                  cartItemRaw: JSON.stringify(cartItemJSON),
                  walletUsed: `${walletUsed}`,
                  instantOrder: `${instantOrder}`,
                  scheduleOrder: `${scheduleOrder}`,
                  scheduleDate: `${scheduleDate}`,
                  scheduleTime: `${scheduleTime}`,
                  orderAt: `${orderAt}`,
                  realTotal: parseFloat(itemRealTotalPrice),
                  itemTotal: parseFloat(itemTotalPrice),
                  itemDiscount: parseFloat(itemDiscountPrice),
                  couponDiscountCharge: 0,
                  deliveryCharge: parseFloat(deliveryPrice),
                  foodServiceCharge: parseFloat(foodTaxPrice),
                  serviceCharge: parseFloat(serviceTaxPrice),
                  packageCharge: parseFloat(packagePrice),
                  packageChargeTax: parseFloat(packageTaxPrice),
                  deliveryTip: 0,
                  extraCharge: 0,
                  walletAmount: parseFloat(walletAmount),
                  grandTotal: parseFloat(grandTotal),
                  status: 'created',
                  orderFrom: 'app',
                  restaurantCommission: adminCommission,
                  deliveryCommission: 0,
                  restaurantCampaign: null,
                  foodCampaign: null,
                };
                const userSettings = await userSettingService.getLoyaltySettings();
                const order = await ordersService.createOrder(orderParam);
                await addonsService.updateAddonStockAfterOrder(addonUpdateData);
                await foodService.updateFooodStockAfterOrder(foodUpdateData);
                await foodService.updateFoodMetaAfterOrder(foodMetaUpdateJson);
                if (userSettings !== null && userSettings.canEarnLoyaltyPointOnOrder === true) {
                  const requiredTotal = parseFloat(userSettings.loyaltyMinOrderTotal);
                  const gainLoyalPoints = parseFloat(userSettings.loyaltyPointValue);
                  if (requiredTotal <= parseFloat(grandTotal)) {
                    const savePoints = {
                      user: `${user}`,
                      orderId: order.id,
                      coupon: null,
                      loyaltyPointValue: gainLoyalPoints,
                      redeemFrom: 'order',
                    };
                    await loyaltyPointsService.saveLoyaltyPoint(savePoints);
                  }
                }
                if (
                  walletInfo !== null &&
                  walletInfo.id !== null &&
                  walletUsed === true &&
                  walletAmount !== 0
                ) {
                  const oldBalance = walletInfo.balance;
                  const userWalletId = walletInfo.id;
                  const newBalance = parseFloat(oldBalance) - parseFloat(walletAmount);
                  await walletService.updateWallet(userWalletId, { balance: newBalance });
                  await transactionService.saveTransation({
                    payableId: user,
                    walletId: userWalletId,
                    type: 'withdrawal',
                    amount: walletAmount,
                    confirmed: true,
                    meta: [{ reason: `withdrawal from order #${order.id}` }],
                    status: true,
                  });
                }
                await fcmNotificationService.restaurantNewOrder(order.id, vendor, user);
                await emailConfigService.orderSummaryEmail(order.id);
                res.status(201).send({ id: order.id, success: true });
              } else {
                res
                  .status(400)
                  .send({ code: 400, message: 'One of the addon or variation is not available' });
              }
            } else {
              const nonEmptyStock = [
                itemOutOfStockName,
                addonOutOfStockName,
                variationOutOfStockName,
              ].filter((str) => str !== '');
              res.status(400).send({
                code: 400,
                message: `Sorry, ##dynamic## is currently out of stock and cannot be added to your order.`,
                extra: `${nonEmptyStock.join(',')}`,
              });
            }
          } else {
            res.status(400).send({ code: 400, message: 'One of the food is not available' });
          }
        } else {
          res.status(400).send({ code: 400, message: 'Cart is Empty' });
        }
      } else {
        res.status(400).send({ code: 400, message: 'Cart is Empty' });
      }
      // eslint-disable-next-line no-unused-vars
    } catch (error) {
      res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
    }
  }
});

const placePOSCityzenOrder = catchAsync(async (req, res) => {
  const {
    vendor,
    scheduleOrder,
    scheduleDate,
    scheduleTime,
    orderTo,
    address,
    instantOrder,
    cartItem,
    walletUsed,
    user,
    orderAt,
  } = req.body;
  const orderSettings = await orderSettingsService.getOrderSettingForCheckout(vendor);
  let isValidScheduleDate = false;
  if (
    orderSettings &&
    orderSettings.orders &&
    orderSettings.orders.customerCanOrderWithinDays !== null &&
    scheduleOrder === true
  ) {
    const now = DateTime.now();

    const scheduleOrderRange = now.plus({
      days: parseInt(orderSettings.orders.customerCanOrderWithinDays, 10) - 1,
    });

    const scheduleOrderDateString = `${DateTime.fromJSDate(new Date(scheduleDate)).toFormat('yyyy-MM-dd')} ${scheduleTime}`;

    const scheduleOrderDate = DateTime.fromFormat(scheduleOrderDateString, 'yyyy-MM-dd hh:mm a');

    if (scheduleOrderDate < scheduleOrderRange && scheduleOrderDate >= now) {
      isValidScheduleDate = true;
    }
  }
  let distance = 0;
  if (orderTo === 'homedelivery') {
    const point1 = [address.longitude, address.latitude];
    if (orderSettings && orderSettings.restaurant && orderSettings.restaurant.id === vendor) {
      const point2 = orderSettings.restaurant.location.coordinates;
      const distanceInMeter = haversineDistance(point1, point2);
      const findMode =
        orderSettings &&
        orderSettings.business &&
        orderSettings.business.findMode &&
        orderSettings.business.findMode !== ''
          ? orderSettings.business.findMode
          : 'km';
      distance =
        findMode === 'km'
          ? parseFloat(distanceInMeter / 1000).toFixed(2)
          : parseFloat(distanceInMeter / 1609.34).toFixed(2);
    }
  }
  if (orderSettings.canPlaceOrder === false) {
    res.status(400).send({ code: 400, message: 'Limit Crossed' });
  } else if (
    orderTo === 'homedelivery' &&
    (address.flatHouse === '' || address.longitude === 0 || address.latitude === 0)
  ) {
    res.status(400).send({ code: 400, message: 'Address is missing' });
  } else if (
    orderTo === 'homedelivery' &&
    (orderSettings.orders.homeDelivery === false ||
      orderSettings.restaurant.acceptHomeDelivery === false)
  ) {
    res.status(400).send({ code: 400, message: 'Home Delivery is disabled' });
  } else if (
    orderTo === 'selfpickup' &&
    (orderSettings.orders.takeaway === false || orderSettings.restaurant.takeAway === false)
  ) {
    res.status(400).send({ code: 400, message: 'Self Pickup is disabled' });
  } else if (instantOrder === true && orderSettings.orders.instantOrder === false) {
    res.status(400).send({ code: 400, message: 'Instant Order is disabled' });
  } else if (
    scheduleOrder === true &&
    (orderSettings.orders.scheduleDelivery === false ||
      orderSettings.restaurant.acceptScheduleDelivery === false)
  ) {
    res.status(400).send({ code: 400, message: 'Schedule Order is disabled' });
  } else if (scheduleOrder === true && isValidScheduleDate === false) {
    res.status(400).send({ code: 400, message: 'Schedule Date is invalid' });
  } else if (parseFloat(distance) > parseFloat(orderSettings.business.deliveryArea)) {
    res.status(400).send({ code: 400, message: 'Can not deliver order to this address' });
  } else {
    try {
      if (checkArrayNotEmpty(cartItem)) {
        const savedItemIds = cartItem.map((item) => item.food.toString());
        let foodIds = lodash.uniq(savedItemIds);
        foodIds = foodIds.map((item) => new mongoose.Types.ObjectId(item));
        const cartItems = await cartItemService.vendorPosOrderFoodInfoForCheckout(foodIds);
        if (checkArrayNotEmpty(cartItems.foodInfoInCart)) {
          if (cartItems.success === true) {
            let itemInStock = true;
            let itemOutOfStockName = '';
            let addonInStock = true;
            let addonOutOfStockName = '';
            let variationInStock = true;
            let variationOutOfStockName = '';
            const savedFoodTotal = [];
            const savedAddonTotal = [];
            const savedAddonIds = [];
            const serverAddonIds = [];
            const savedVariationsTotal = [];
            const savedVariationIds = [];
            const serverVariationIds = [];
            const serverFoodIds = [];
            const addonUpdateData = [];
            const foodUpdateData = [];
            let itemTotalPrice = 0;
            let itemRealTotalPrice = 0;
            let itemDiscountPrice = 0;
            let foodTaxPrice = 0;
            let serviceTaxPrice = 0;
            let packagePrice = 0;
            let packageTaxPrice = 0;
            let deliveryPrice = 0;
            let walletAmount = 0;
            const cartItemJSON = [];
            const foodMetaUpdateJson = [];
            cartItem.forEach((inCartItemElement) => {
              let addonInItem = [];
              if (
                inCartItemElement &&
                inCartItemElement.addons &&
                inCartItemElement.addons !== null &&
                inCartItemElement.addons !== ''
              ) {
                addonInItem = inCartItemElement.addons.split(',');
              }
              const foodIdParam = {
                id: inCartItemElement.food.toString(),
                total: parseInt(inCartItemElement.quantity, 10),
              };
              const indexOfFoodId = savedFoodTotal.findIndex(
                (item) => item.id === inCartItemElement.food.toString()
              );
              if (indexOfFoodId === -1) {
                savedFoodTotal.push(foodIdParam);
                serverFoodIds.push(foodIdParam.id);
              } else {
                savedFoodTotal[indexOfFoodId].total += parseInt(inCartItemElement.quantity, 10);
              }
              if (checkArrayNotEmpty(addonInItem)) {
                addonInItem.forEach((addonElement) => {
                  const addonParam = {
                    id: addonElement.toString(),
                    total: parseInt(inCartItemElement.quantity, 10),
                  };
                  const indexOfAddonId = savedAddonTotal.findIndex(
                    (item) => item.id === addonElement.toString()
                  );
                  if (indexOfAddonId === -1) {
                    savedAddonIds.push(addonElement.toString());
                    savedAddonTotal.push(addonParam);
                  } else {
                    savedAddonTotal[indexOfAddonId].total += parseInt(
                      inCartItemElement.quantity,
                      10
                    );
                  }
                });
              }
              if (
                inCartItemElement &&
                inCartItemElement.variations &&
                checkArrayNotEmpty(inCartItemElement.variations)
              ) {
                inCartItemElement.variations.forEach((variationElement) => {
                  variationElement.selected.forEach((optionElement) => {
                    const variationParam = {
                      id: `${variationElement.variation}-${optionElement}-${inCartItemElement.food}`,
                      total: parseInt(inCartItemElement.quantity, 10),
                    };
                    const indexOfVariationId = savedVariationsTotal.findIndex(
                      (item) =>
                        item.id ===
                        `${variationElement.variation}-${optionElement}-${inCartItemElement.food}`
                    );
                    if (indexOfVariationId === -1) {
                      savedVariationIds.push(
                        `${variationElement.variation}-${optionElement}-${inCartItemElement.food}`
                      );
                      savedVariationsTotal.push(variationParam);
                    } else {
                      savedVariationsTotal[indexOfVariationId].total += parseInt(
                        inCartItemElement.quantity,
                        10
                      );
                    }
                  });
                });
              }
            });
            cartItems.foodInfoInCart.forEach((foodInfoElement) => {
              const indexOfSavedFoodId = savedFoodTotal.findIndex(
                (item) => item.id.toString() === foodInfoElement.id.toString()
              );
              if (
                (foodInfoElement.inStock !== true || foodInfoElement.status !== 'live') &&
                itemInStock === true
              ) {
                itemInStock = false;
                itemOutOfStockName = foodInfoElement.name;
              } else if (
                indexOfSavedFoodId !== -1 &&
                foodInfoElement.stockType !== 'unlimited' &&
                savedFoodTotal[indexOfSavedFoodId].total >
                  parseInt(foodInfoElement.stockNumber, 10) &&
                itemInStock === true
              ) {
                itemInStock = false;
                itemOutOfStockName = foodInfoElement.name;
              }
              if (
                foodInfoElement &&
                foodInfoElement.addons &&
                checkArrayNotEmpty(foodInfoElement.addons)
              ) {
                foodInfoElement.addons.forEach((addonElement) => {
                  const indexOfSavedAddonId = savedAddonTotal.findIndex(
                    (item) => item.id.toString() === addonElement.id.toString()
                  );
                  if (!serverAddonIds.includes(addonElement.id.toString())) {
                    serverAddonIds.push(addonElement.id.toString());
                  }
                  if (
                    indexOfSavedAddonId !== -1 &&
                    (addonElement.inStock === false || addonElement.status === false) &&
                    addonInStock === true
                  ) {
                    addonInStock = false;
                    addonOutOfStockName = addonElement.name;
                  } else if (
                    indexOfSavedAddonId !== -1 &&
                    addonElement.stockType !== 'unlimited' &&
                    savedAddonTotal[indexOfSavedAddonId].total >
                      parseInt(addonElement.stockNumber, 10)
                  ) {
                    addonInStock = false;
                    addonOutOfStockName = addonElement.name;
                  }
                });
              }
              if (
                foodInfoElement &&
                foodInfoElement.variations &&
                checkArrayNotEmpty(foodInfoElement.variations)
              ) {
                foodInfoElement.variations.forEach((variationElement) => {
                  if (
                    variationElement &&
                    variationElement.options &&
                    checkArrayNotEmpty(variationElement.options)
                  ) {
                    variationElement.options.forEach((optionElement) => {
                      const indexOfVariationId = savedVariationsTotal.findIndex(
                        (item) =>
                          item.id.toString() ===
                          `${variationElement.title}-${optionElement.name}-${foodInfoElement.id}`
                      );
                      if (
                        !serverVariationIds.includes(
                          `${variationElement.title}-${optionElement.name}-${foodInfoElement.id}`
                        )
                      ) {
                        serverVariationIds.push(
                          `${variationElement.title}-${optionElement.name}-${foodInfoElement.id}`
                        );
                      }
                      if (
                        indexOfVariationId !== -1 &&
                        foodInfoElement.stockType !== 'unlimited' &&
                        savedVariationsTotal[indexOfVariationId].total >
                          parseInt(optionElement.stock, 10)
                      ) {
                        variationInStock = false;
                        variationOutOfStockName = optionElement.name;
                      }
                    });
                  }
                });
              }
              cartItem.forEach((inCartItemElement) => {
                if (foodInfoElement.id.toString() === inCartItemElement.food.toString()) {
                  const cartAddonJSON = [];
                  const cartVariationJSON = [];
                  const basePrice = Number(parseFloat(foodInfoElement.price).toFixed(2));
                  let finalPrice;
                  let addonPrice = 0;
                  let variationPrice = 0;
                  let taxAmount = 0;
                  if (foodInfoElement && foodInfoElement.taxationEnable === true) {
                    foodInfoElement.foodtaxations.forEach((taxPrice) => {
                      taxAmount += parseFloat(taxPrice.taxAmount);
                    });
                    const taxAmountData = basePrice * (taxAmount / 100);
                    finalPrice = parseFloat(basePrice + taxAmountData).toFixed(2);
                  } else {
                    finalPrice = parseFloat(basePrice).toFixed(2);
                  }
                  const indexOfSavedFoodTotalId = savedFoodTotal.findIndex(
                    (x) => x.id.toString() === foodInfoElement.id.toString()
                  );
                  const indexOfSavedFoodUpdateId = foodUpdateData.findIndex(
                    (x) => x.id.toString() === foodInfoElement.id.toString()
                  );
                  if (
                    indexOfSavedFoodTotalId !== -1 &&
                    indexOfSavedFoodUpdateId === -1 &&
                    foodInfoElement.stockType !== 'unlimited'
                  ) {
                    const updatedFoodStockNumber = parseInt(
                      parseInt(foodInfoElement.stockNumber, 10) -
                        parseInt(savedFoodTotal[indexOfSavedFoodTotalId].total, 10),
                      10
                    );
                    const updateFoodParam = {
                      id: foodInfoElement.id.toString(),
                      name: foodInfoElement.name,
                      updateSet: {
                        stockNumber: updatedFoodStockNumber,
                        inStock: updatedFoodStockNumber > 0,
                      },
                    };
                    foodUpdateData.push(updateFoodParam);
                  }
                  if (
                    foodInfoElement &&
                    foodInfoElement.addons &&
                    checkArrayNotEmpty(foodInfoElement.addons)
                  ) {
                    foodInfoElement.addons.forEach((addonElement) => {
                      let addonInItem = [];
                      if (
                        inCartItemElement &&
                        inCartItemElement.addons &&
                        inCartItemElement.addons !== null &&
                        inCartItemElement.addons !== ''
                      ) {
                        addonInItem = inCartItemElement.addons.split(',');
                      }
                      if (checkArrayNotEmpty(addonInItem)) {
                        if (addonInItem.includes(addonElement.id.toString())) {
                          const indexOfSavedAddonTotalId = savedAddonTotal.findIndex(
                            (x) => x.id.toString() === addonElement.id.toString()
                          );
                          const indexOfSavedAddonUpdateId = addonUpdateData.findIndex(
                            (x) => x.id.toString() === addonElement.id.toString()
                          );
                          if (
                            indexOfSavedAddonTotalId !== -1 &&
                            indexOfSavedAddonUpdateId === -1 &&
                            addonElement.stockType !== 'unlimited'
                          ) {
                            const updatedAddonStockNumber = parseInt(
                              parseInt(addonElement.stockNumber, 10) -
                                parseInt(savedAddonTotal[indexOfSavedAddonTotalId].total, 10),
                              10
                            );
                            const updateAddonParam = {
                              id: addonElement.id.toString(),
                              updateSet: {
                                stockNumber: updatedAddonStockNumber,
                                inStock: updatedAddonStockNumber > 0,
                              },
                            };
                            addonUpdateData.push(updateAddonParam);
                          }
                          addonPrice += Number(parseFloat(addonElement.price).toFixed(2));
                          cartAddonJSON.push(addonElement);
                        }
                      }
                    });
                  }
                  if (
                    foodInfoElement &&
                    foodInfoElement.variations &&
                    checkArrayNotEmpty(foodInfoElement.variations)
                  ) {
                    const updatedVariationParam = foodInfoElement.variations;
                    foodInfoElement.variations.forEach((foodInfoElementVariation) => {
                      if (
                        inCartItemElement &&
                        inCartItemElement.variations &&
                        checkArrayNotEmpty(inCartItemElement.variations)
                      ) {
                        inCartItemElement.variations.forEach((inCartItemVariation) => {
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
                                  if (
                                    inCartItemVariation.selected.includes(
                                      foodInfoElementOption.name
                                    )
                                  ) {
                                    variationParam.options.push(foodInfoElementOption);
                                    variationPrice += Number(
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
                    const indexOfUpdateFoodId = foodUpdateData.findIndex(
                      (x) => x.id.toString() === foodInfoElement.id.toString()
                    );
                    if (indexOfUpdateFoodId !== -1) {
                      foodUpdateData[indexOfUpdateFoodId].updateSet.variations =
                        updatedVariationParam;
                    }
                  }
                  finalPrice = Number(
                    parseFloat(
                      parseFloat(finalPrice) + parseFloat(addonPrice) + parseFloat(variationPrice)
                    ).toFixed(2)
                  );
                  let realPrice = parseFloat(finalPrice);
                  let itemDiscount = 0;
                  if (parseFloat(foodInfoElement.discount) > 0) {
                    if (foodInfoElement.discountType === '%') {
                      const discountAmountOfFood = parseFloat(
                        (finalPrice * foodInfoElement.discount) / 100
                      ).toFixed(2);
                      itemDiscount = parseFloat(discountAmountOfFood);
                      finalPrice = parseFloat(finalPrice - discountAmountOfFood).toFixed(2);
                    } else {
                      itemDiscount = parseFloat(foodInfoElement.discount);
                      finalPrice = parseFloat(
                        parseFloat(finalPrice) - parseFloat(foodInfoElement.discount)
                      ).toFixed(2);
                    }
                  }
                  const itemPrice = parseFloat(
                    parseFloat(
                      parseFloat(finalPrice).toFixed(2) * parseInt(inCartItemElement.quantity, 10)
                    ).toFixed(2)
                  );
                  realPrice = parseFloat(
                    parseFloat(
                      parseFloat(realPrice).toFixed(2) * parseInt(inCartItemElement.quantity, 10)
                    ).toFixed(2)
                  );
                  itemDiscount = parseFloat(
                    parseFloat(
                      parseFloat(itemDiscount).toFixed(2) * parseInt(inCartItemElement.quantity, 10)
                    ).toFixed(2)
                  );
                  itemTotalPrice += itemPrice;
                  itemRealTotalPrice += realPrice;
                  itemDiscountPrice += itemDiscount;
                  cartItemJSON.push({
                    name: foodInfoElement.name,
                    uuid: inCartItemElement.uuid,
                    addons: cartAddonJSON,
                    variations: cartVariationJSON,
                    discount: foodInfoElement.discount,
                    discountType: foodInfoElement.discountType,
                    endTime: foodInfoElement.endTime,
                    foodType: foodInfoElement.foodType,
                    foodtaxations: foodInfoElement.foodtaxations,
                    id: foodInfoElement.id,
                    image: foodInfoElement.image,
                    inStock: foodInfoElement.inStock,
                    price: parseFloat(foodInfoElement.price),
                    purchaseLimit: parseInt(foodInfoElement.purchaseLimit, 10),
                    quantity: parseInt(inCartItemElement.quantity, 10),
                    restaurant: foodInfoElement.restaurant,
                    restaurantInfo: {
                      cover: orderSettings.restaurant.cover,
                      id: orderSettings.restaurant.id,
                      logo: orderSettings.restaurant.logo,
                      name: orderSettings.restaurant.name,
                      slug: orderSettings.restaurant.slug,
                      translations: orderSettings.restaurant.translations,
                    },
                    shortDescription: foodInfoElement.shortDescription,
                    startTime: foodInfoElement.startTime,
                    status: foodInfoElement.status,
                    taxationEnable: foodInfoElement.taxationEnable,
                    realPrice: parseFloat(realPrice),
                    itemDiscount: parseFloat(itemDiscount),
                    totalPrice: parseFloat(itemPrice),
                    translations: foodInfoElement.translations,
                    instruction: inCartItemElement.instruction,
                  });
                }
              });
            });
            if (foodUpdateData !== null && checkArrayNotEmpty(foodUpdateData)) {
              foodUpdateData.forEach((foodItemUpdate) => {
                if (
                  foodItemUpdate !== null &&
                  foodItemUpdate.updateSet !== null &&
                  foodItemUpdate.updateSet.variations !== null &&
                  checkArrayNotEmpty(foodItemUpdate.updateSet.variations)
                ) {
                  foodItemUpdate.updateSet.variations.forEach((foodUpdateVariation) => {
                    if (
                      foodUpdateVariation !== null &&
                      foodUpdateVariation.options !== null &&
                      checkArrayNotEmpty(foodUpdateVariation.options)
                    ) {
                      foodUpdateVariation.options.forEach((foodUpdateVariationOption) => {
                        const indexOfSavedVariationTotalId = savedVariationsTotal.findIndex(
                          (x) =>
                            x.id.toString() ===
                            `${foodUpdateVariation.title}-${foodUpdateVariationOption.name}-${foodItemUpdate.id}`
                        );
                        if (indexOfSavedVariationTotalId !== -1) {
                          const updatedOptionStockNumber = parseInt(
                            parseInt(foodUpdateVariationOption.stock, 10) -
                              parseInt(
                                savedVariationsTotal[indexOfSavedVariationTotalId].total,
                                10
                              ),
                            10
                          );
                          foodUpdateVariationOption.stock = updatedOptionStockNumber.toString();
                        }
                      });
                    }
                  });
                }
              });
            }
            itemTotalPrice = parseFloat(itemTotalPrice).toFixed(2);
            const isAddonThere = savedAddonIds.every((item) => serverAddonIds.includes(item));
            const isVariationThere = savedVariationIds.every((item) =>
              serverVariationIds.includes(item)
            );
            if (parseFloat(itemTotalPrice) < parseFloat(orderSettings.restaurant.minOrderAmount)) {
              res.status(400).send({
                code: 400,
                message: `Please note that a minimum order value of ##dynamic## is required to proceed with your order`,
                extra: `${orderSettings.restaurant.minOrderAmount}`,
              });
            } else if (itemInStock === true && addonInStock === true && variationInStock === true) {
              if (isAddonThere && isVariationThere) {
                if (
                  orderSettings &&
                  orderSettings.business &&
                  orderSettings.business.includeTaxOnFood === true
                ) {
                  if (orderSettings.business.foodTaxType === 'per') {
                    foodTaxPrice = parseFloat(
                      (parseFloat(itemTotalPrice).toFixed(2) *
                        parseFloat(orderSettings.business.foodTaxAmount).toFixed(2)) /
                        100
                    ).toFixed(2);
                  } else {
                    foodTaxPrice = parseFloat(orderSettings.business.foodTaxAmount);
                  }
                }
                if (
                  orderSettings &&
                  orderSettings.business &&
                  orderSettings.business.additionalServiceCharge === true
                ) {
                  serviceTaxPrice = parseFloat(
                    orderSettings.business.additionalServiceAmount
                  ).toFixed(2);
                }
                if (
                  orderSettings &&
                  orderSettings.packaging &&
                  orderSettings.packaging.havePackagingCharges === true
                ) {
                  packagePrice = parseFloat(orderSettings.packaging.packagingCharges).toFixed(2);
                }
                if (
                  orderSettings &&
                  orderSettings.packaging &&
                  orderSettings.packaging.includePackagesChargesInTax === true
                ) {
                  packageTaxPrice = parseFloat(
                    (parseFloat(orderSettings.packaging.packagingCharges).toFixed(2) *
                      parseFloat(orderSettings.packaging.packagingChargesTax).toFixed(2)) /
                      100
                  ).toFixed(2);
                }
                if (
                  orderTo === 'homedelivery' &&
                  orderSettings &&
                  orderSettings.business &&
                  orderSettings.business.deliveryChargeMethod === 'distance'
                ) {
                  const deliveryChargeAmount = parseFloat(
                    orderSettings.business.deliveryChargeAmount
                  );
                  deliveryPrice = parseFloat(deliveryChargeAmount * parseFloat(distance)).toFixed(
                    2
                  );
                } else if (
                  orderTo === 'homedelivery' &&
                  orderSettings &&
                  orderSettings.business &&
                  orderSettings.business.deliveryChargeMethod !== 'distance'
                ) {
                  const deliveryChargeAmount = parseFloat(
                    orderSettings.business.deliveryChargeAmount
                  );
                  deliveryPrice = deliveryChargeAmount;
                }
                if (
                  orderTo === 'homedelivery' &&
                  orderSettings &&
                  orderSettings.business &&
                  orderSettings.business.haveFreeDeliveryInTotal === true &&
                  parseFloat(orderSettings.business.freeDelivery) > 0 &&
                  parseFloat(itemTotalPrice) >= parseFloat(orderSettings.business.freeDelivery)
                ) {
                  deliveryPrice = 0;
                }
                if (
                  orderTo === 'homedelivery' &&
                  orderSettings &&
                  orderSettings.business &&
                  orderSettings.business.haveFreeDeliveryInDistance === true &&
                  parseFloat(orderSettings.business.freeDeliveryInDistance) > 0 &&
                  parseFloat(orderSettings.business.freeDeliveryInDistance) > parseFloat(distance)
                ) {
                  deliveryPrice = 0;
                }
                if (orderTo === 'selfpickup') {
                  deliveryPrice = 0;
                }
                const walletInfo = await walletService.getWalletByUserId(user);
                if (walletUsed === true) {
                  if (walletInfo && walletInfo !== null) {
                    if (parseFloat(walletInfo.balance) <= parseFloat(itemTotalPrice)) {
                      walletAmount = parseFloat(walletInfo.balance).toFixed(2);
                    } else {
                      walletAmount = parseFloat(itemTotalPrice).toFixed(2);
                    }
                  }
                }
                if (checkArrayNotEmpty(cartItemJSON)) {
                  cartItemJSON.forEach((cartObj) => {
                    const indexOfFoodMetaUpdateId = foodMetaUpdateJson.findIndex(
                      (x) => x.id === cartObj.id
                    );
                    if (indexOfFoodMetaUpdateId === -1) {
                      const foodMetaUpdateParam = {
                        id: cartObj.id,
                        name: cartObj.name,
                        qty: parseInt(cartObj.quantity, 10),
                        totalSoldAmount: parseFloat(cartObj.totalPrice),
                        discountAmountGiven: parseFloat(cartObj.itemDiscount),
                      };
                      foodMetaUpdateJson.push(foodMetaUpdateParam);
                    } else {
                      foodMetaUpdateJson[indexOfFoodMetaUpdateId].qty += parseInt(
                        cartObj.quantity,
                        10
                      );
                      foodMetaUpdateJson[indexOfFoodMetaUpdateId].totalSoldAmount += parseFloat(
                        cartObj.totalPrice
                      );
                      foodMetaUpdateJson[indexOfFoodMetaUpdateId].discountAmountGiven += parseFloat(
                        cartObj.itemDiscount
                      );
                    }
                    if (indexOfFoodMetaUpdateId !== -1) {
                      foodMetaUpdateJson[indexOfFoodMetaUpdateId].totalSoldAmount = parseFloat(
                        foodMetaUpdateJson[indexOfFoodMetaUpdateId].totalSoldAmount
                      ).toFixed(2);
                      foodMetaUpdateJson[indexOfFoodMetaUpdateId].discountAmountGiven = parseFloat(
                        foodMetaUpdateJson[indexOfFoodMetaUpdateId].discountAmountGiven
                      ).toFixed(2);
                    }
                  });
                }
                const subTotal = parseFloat(
                  parseFloat(itemTotalPrice) +
                    parseFloat(foodTaxPrice) +
                    parseFloat(serviceTaxPrice) +
                    parseFloat(packagePrice) +
                    parseFloat(packageTaxPrice) +
                    parseFloat(deliveryPrice)
                ).toFixed(2);
                const grandTotal = parseFloat(
                  parseFloat(subTotal) - parseFloat(walletAmount)
                ).toFixed(2);
                const restaurantCommission = orderSettings.posCommission;
                const restaurantTotalEarning = parseFloat(
                  parseFloat(itemTotalPrice) +
                    parseFloat(packagePrice) +
                    parseFloat(packageTaxPrice)
                ).toFixed(2);
                const adminCommission = parseFloat(
                  (parseFloat(restaurantTotalEarning) * parseFloat(restaurantCommission)) / 100
                ).toFixed(2);
                const codPaymentId = await paymentConfigService.codPaymentId();

                let deliveryAddress = '';
                let userRawAddress = '';
                let receiverName = '';
                let countryCode = '';
                let receiverContact = '';
                if (orderTo === 'homedelivery') {
                  receiverName = address.receiverName;
                  countryCode = address.countryCode;
                  receiverContact = address.receiverContact;
                  const addressParam = {
                    user: `${user}`,
                    title: 3,
                    receiverName: `${receiverName}`,
                    receiverContact: `${receiverContact}`,
                    countryCode: `${countryCode}`,
                    flatHouse: address.flatHouse,
                    locality: address.locality,
                    landmark: address.landmark,
                    type: 'Point',
                    longitude: address.longitude,
                    latitude: address.latitude,
                  };
                  const savedAddress = await userAddressService.saveAddress(addressParam);
                  if (savedAddress != null && savedAddress.id) {
                    deliveryAddress = savedAddress.id;
                    userRawAddress = JSON.stringify(savedAddress);
                  }
                } else {
                  const posAdminUserDetail = await userService.posAdminUserDetail(user);
                  receiverName = `${posAdminUserDetail.firstName} ${posAdminUserDetail.lastName}`;
                  countryCode = `${posAdminUserDetail.countryCode}`;
                  receiverContact = `${posAdminUserDetail.mobile}`;
                }

                const orderParam = {
                  user: `${user}`,
                  payment: `${codPaymentId}`,
                  restaurant: `${vendor}`,
                  addons: serverAddonIds,
                  foods: serverFoodIds,
                  coupon: null,
                  couponType: '',
                  orderTo: `${orderTo}`,
                  cookingInstruction: '',
                  deliveryInstruction: '',
                  deliveryAddress: `${deliveryAddress}`,
                  deliveryAddressRaw:
                    deliveryAddress &&
                    deliveryAddress !== null &&
                    deliveryAddress !== '' &&
                    userRawAddress !== null &&
                    userRawAddress !== ''
                      ? userRawAddress
                      : '',
                  receiverName: `${receiverName}`,
                  countryCode: `${countryCode}`,
                  receiverContact: `${receiverContact}`,
                  cartItemRaw: JSON.stringify(cartItemJSON),
                  walletUsed: `${walletUsed}`,
                  instantOrder: `${instantOrder}`,
                  scheduleOrder: `${scheduleOrder}`,
                  scheduleDate: `${scheduleDate}`,
                  scheduleTime: `${scheduleTime}`,
                  orderAt: `${orderAt}`,
                  realTotal: parseFloat(itemRealTotalPrice),
                  itemTotal: parseFloat(itemTotalPrice),
                  itemDiscount: parseFloat(itemDiscountPrice),
                  couponDiscountCharge: 0,
                  deliveryCharge: parseFloat(deliveryPrice),
                  foodServiceCharge: parseFloat(foodTaxPrice),
                  serviceCharge: parseFloat(serviceTaxPrice),
                  packageCharge: parseFloat(packagePrice),
                  packageChargeTax: parseFloat(packageTaxPrice),
                  deliveryTip: 0,
                  extraCharge: 0,
                  walletAmount: parseFloat(walletAmount),
                  grandTotal: parseFloat(grandTotal),
                  status: 'created',
                  orderFrom: 'app',
                  restaurantCommission: adminCommission,
                  deliveryCommission: 0,
                  restaurantCampaign: null,
                  foodCampaign: null,
                };
                const userSettings = await userSettingService.getLoyaltySettings();
                const order = await ordersService.createOrder(orderParam);
                await addonsService.updateAddonStockAfterOrder(addonUpdateData);
                await foodService.updateFooodStockAfterOrder(foodUpdateData);
                await foodService.updateFoodMetaAfterOrder(foodMetaUpdateJson);
                if (userSettings !== null && userSettings.canEarnLoyaltyPointOnOrder === true) {
                  const requiredTotal = parseFloat(userSettings.loyaltyMinOrderTotal);
                  const gainLoyalPoints = parseFloat(userSettings.loyaltyPointValue);
                  if (requiredTotal <= parseFloat(grandTotal)) {
                    const savePoints = {
                      user: `${user}`,
                      orderId: order.id,
                      coupon: null,
                      loyaltyPointValue: gainLoyalPoints,
                      redeemFrom: 'order',
                    };
                    await loyaltyPointsService.saveLoyaltyPoint(savePoints);
                  }
                }
                if (
                  walletInfo !== null &&
                  walletInfo.id !== null &&
                  walletUsed === true &&
                  walletAmount !== 0
                ) {
                  const oldBalance = walletInfo.balance;
                  const userWalletId = walletInfo.id;
                  const newBalance = parseFloat(oldBalance) - parseFloat(walletAmount);
                  await walletService.updateWallet(userWalletId, { balance: newBalance });
                  await transactionService.saveTransation({
                    payableId: user,
                    walletId: userWalletId,
                    type: 'withdrawal',
                    amount: walletAmount,
                    confirmed: true,
                    meta: [{ reason: `withdrawal from order #${order.id}` }],
                    status: true,
                  });
                }
                await fcmNotificationService.restaurantNewOrder(order.id, vendor, user);
                await emailConfigService.orderSummaryEmail(order.id);
                res.status(201).send({ id: order.id, success: true });
              } else {
                res
                  .status(400)
                  .send({ code: 400, message: 'One of the addon or variation is not available' });
              }
            } else {
              const nonEmptyStock = [
                itemOutOfStockName,
                addonOutOfStockName,
                variationOutOfStockName,
              ].filter((str) => str !== '');
              res.status(400).send({
                code: 400,
                message: `Sorry, ##dynamic## is currently out of stock and cannot be added to your order.`,
                extra: `${nonEmptyStock.join(',')}`,
              });
            }
          } else {
            res.status(400).send({ code: 400, message: 'One of the food is not available' });
          }
        } else {
          res.status(400).send({ code: 400, message: 'Cart is Empty' });
        }
      } else {
        res.status(400).send({ code: 400, message: 'Cart is Empty' });
      }
      // eslint-disable-next-line no-unused-vars
    } catch (error) {
      res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
    }
  }
});

const getMyOrderList = catchAsync(async (req, res) => {
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const result = await ordersService.getMyOrderList(req.body.uid, options);
  res.send(result);
});

const getMyFavouriteOrders = catchAsync(async (req, res) => {
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const result = await ordersService.getMyFavouriteOrders(req.body.uid, options);
  res.send(result);
});

const getVendorOrder = catchAsync(async (req, res) => {
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const { vendorId, status } = req.body;
  const result = await ordersService.getVendorOrder(vendorId, status, options);
  res.send(result);
});

const prepareOrder = catchAsync(async (req, res) => {
  const result = await ordersService.prepareOrder(req.body.id, req.body);
  if (result !== null && result.id === req.body.id) {
    await fcmNotificationService.acceptPrepareOrder(
      req.body.id,
      req.body.vendorId,
      req.body.user,
      req.body.time
    );
  }
  if (
    result !== null &&
    result.id === req.body.id &&
    req.body &&
    req.body.driverId &&
    req.body.driverId !== null &&
    req.body.driverId !== ''
  ) {
    await fcmNotificationService.driverNewOrder(req.body.id, req.body.vendorId, req.body.driverId);
  } else if (
    result !== null &&
    result.id === req.body.id &&
    result.orderTo !== null &&
    result.orderTo === 'homedelivery'
  ) {
    if (req.body.driverId === null || req.body.driverId === '') {
      await fcmNotificationService.autoDriverNewOrder(req.body.id, req.body.vendorId);
    }
  }
  res.send({ success: true });
});

const acceptScheduleOrder = catchAsync(async (req, res) => {
  const result = await ordersService.acceptScheduleOrder(req.body.id, req.body.vendorId);
  if (result !== null && result.success === true) {
    await fcmNotificationService.scheduleOrder(req.body.id, req.body.vendorId, req.body.user);
  }
  res.send(result);
});

const orderReady = catchAsync(async (req, res) => {
  const result = await ordersService.orderReady(req.body.id, req.body.vendorId);
  res.send(result);
});

const getDriverNewOrderList = catchAsync(async (req, res) => {
  const result = await ordersService.getDriverNewOrderList(req.params.driverId);
  res.send(result);
});

const driverAcceptOrder = catchAsync(async (req, res) => {
  const { id, orderId, driver } = req.body;
  const result = await ordersService.driverAcceptOrder(id, orderId, driver);
  if (
    result !== null &&
    result.orderId !== null &&
    result.driver !== null &&
    result.restaurant !== null
  ) {
    await fcmNotificationService.driverAcceptOrder(
      result.orderId,
      result.restaurant,
      result.driver
    );
  }
  res.send({ success: true });
});

const driverRejectOrder = catchAsync(async (req, res) => {
  const result = await ordersService.driverRejectOrder(req.body.id, req.body.reason);
  if (
    result !== null &&
    result.driverOrder !== null &&
    result.driverOrder.orderFrom === 'manually'
  ) {
    await fcmNotificationService.driverRejectOrder(
      result.driverOrder.orderId,
      result.driverOrder.restaurant,
      result.driverOrder.driver
    );
  } else if (
    result !== null &&
    result.driverOrder !== null &&
    result.driverOrder.orderFrom === 'auto'
  ) {
    // Auto re-dispatch lives in the dispatch service, not here. It used to be a
    // direct call from the controller, which meant the expiry sweep, the decline
    // path and any future retry all needed their own copy of the orchestration.
    await dispatchService.onDriverRejected(
      result.driverOrder.orderId,
      result.driverOrder.restaurant
    );
  }
  res.send({ success: true });
});

const restaurantRejectOrder = catchAsync(async (req, res) => {
  const result = await ordersService.restaurantRejectOrder(
    req.body.id,
    req.body.reason,
    req.body.restaurant
  );
  if (
    result !== null &&
    result.status !== null &&
    result.status === 'rejected' &&
    result.user !== null
  ) {
    await fcmNotificationService.restaurantRejectOrder(
      req.body.id,
      req.body.restaurant,
      result.user
    );
  }
  res.send({ success: true });
});

const driverActiveOrder = catchAsync(async (req, res) => {
  const result = await ordersService.driverActiveOrders(req.params.driverId);
  res.send(result);
});

const driverOrderDetails = catchAsync(async (req, res) => {
  const result = await ordersService.driverOrderDetails(req.params.id);
  res.send(result);
});

const driverReachedRestaurant = catchAsync(async (req, res) => {
  const result = await ordersService.driverReachedRestaurant(req.params.id);
  if (
    result !== null &&
    result.orderId !== null &&
    result.driver !== null &&
    result.restaurant !== null
  ) {
    await fcmNotificationService.driverReachedRestaurant(
      result.orderId,
      result.restaurant,
      result.driver
    );
  }
  res.send({ success: true });
});

const restaurantOrderHandoverDriver = catchAsync(async (req, res) => {
  const result = await ordersService.restuarantOrderHandoverDriver(req.body.id, req.body.vendorId);
  if (result !== null && result.success === true) {
    await fcmNotificationService.restaurantOrderHandoverToDriver(req.body.id, req.body.user);
  }
  res.send(result);
});

const restaurantOrderHandoverCustomer = catchAsync(async (req, res) => {
  const result = await ordersService.restaurantOrderHandoverCustomer(
    req.body.id,
    req.body.vendorId
  );
  if (result !== null && result.success === true) {
    await fcmNotificationService.restaurantOrderHandoverToCustomer(req.body.id, req.body.user);
  }
  res.send(result);
});

const driverPickupOrder = catchAsync(async (req, res) => {
  const result = await ordersService.driverPickupOrder(req.body.id, req.body.vendorId);
  if (
    result !== null &&
    result.orderId !== null &&
    result.driver !== null &&
    result.restaurant !== null
  ) {
    await fcmNotificationService.driverOngoingOrder(result.orderId, req.body.user, result.driver);
  }
  res.send({ success: true });
});

const driverReachedCustomer = catchAsync(async (req, res) => {
  const result = await ordersService.driverReachedCustomer(req.body.id);
  if (
    result !== null &&
    result.orderId !== null &&
    result.driver !== null &&
    result.restaurant !== null
  ) {
    await fcmNotificationService.driverReachedCustomer(
      result.orderId,
      req.body.user,
      result.driver
    );
  }
  res.send({ success: true });
});

const driverDeliverOrder = catchAsync(async (req, res) => {
  const { id, driver, user } = req.body;
  const result = await ordersService.driverDeliverOrder(id, driver);
  if (
    result !== null &&
    result.orderId !== null &&
    result.driver !== null &&
    result.restaurant !== null
  ) {
    await fcmNotificationService.driverDeliveOrder(result.orderId, user, result.driver);
  }
  res.send({ success: true });
});

const getOrderCount = catchAsync(async (req, res) => {
  const result = await ordersService.getOrderCounts();
  res.send(result);
});

const cityzenOrderCounts = catchAsync(async (req, res) => {
  const { master } = req.params;
  const result = await ordersService.cityzenOrderCounts(master);
  res.send(result);
});

const getAdminOrderList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search', 'status']);
  const result = await ordersService.getAdminOrderList(options);
  res.send(result);
});

const cityzenOrderList = catchAsync(async (req, res) => {
  const { master } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await ordersService.cityzenOrderList(master, req.query.status, options);
  res.send(result);
});

const getAdminScheduleOrderList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await ordersService.getAdminScheduleOrderList(options);
  res.send(result);
});

const getAdminSubscriptionOrderList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await ordersService.getAdminSubscriptionOrderList(options);
  res.send(result);
});

const cityzenSubscriptionOrderList = catchAsync(async (req, res) => {
  const { master } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await ordersService.cityzenSubscriptionOrderList(master, options);
  res.send(result);
});

const getUserOrderDetail = catchAsync(async (req, res) => {
  const { id, user } = req.params;
  const result = await ordersService.getUserOrderDetail(id, user);
  res.send(result);
});

const repayPendingOrder = catchAsync(async (req, res) => {
  // Enterprise: hard-close the payment window server-side (app countdown is
  // display-only and trusts client time). Must match app + reminder window.
  const windowMin = parseInt(process.env.PAYMENTS_WINDOW_MIN || '30', 10);
  try {
    const { Orders } = require('../models');
    const mongoose = require('mongoose');
    if (mongoose.Types.ObjectId.isValid(req.body.orderId)) {
      const o = await Orders.findById(req.body.orderId, { createdAt: 1, status: 1 }).lean();
      if (!o) {
        return res.status(404).send({ code: 404, message: 'Order not found', extra: '' });
      }
      if (o.status !== 'pending_payments') {
        return res.status(400).send({ code: 400, message: 'Order is no longer pending payment', extra: '' });
      }
      const ageMin = (Date.now() - new Date(o.createdAt).getTime()) / 60000;
      if (ageMin > windowMin) {
        return res.status(400).send({ code: 400, message: 'Payment window expired. Please place a fresh order.', extra: '' });
      }
    }
  } catch (ageErr) {
    void ageErr;
    // Fall through to legacy flow when the check itself fails.
  }
  const result = await paymentInitiationService.deletePaymentIntentForRePayment(
    req.body.orderId,
    req.body.userId,
    req.body.payMethod
  );
  if (result !== null && result.user !== null) {
    const paymentMeta = {
      user: req.body.userId,
      payment: req.body.newPayMethod,
      orders: req.body.orderId,
      amount: result.amount,
      from: 'order',
      ref: `order for #${req.body.orderId}`,
    };
    const paymentLink = await paymentInitiationService.initiatePayment(paymentMeta);
    if (paymentLink !== null && paymentLink.id !== '') {
      await ordersService.updateOrderPayment(req.body.orderId, { payment: req.body.newPayMethod });
      res.status(201).send({
        id: req.body.orderId,
        success: true,
        status: 'online',
        payLink: paymentLink.id,
        points: 0,
      });
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

/**
 * Switch an online (Razorpay) initiation to COD from the payment screen.
 * Body: { paymentId: <PaymentInitiation _id> }.
 * Deletes the gateway intent, flips the order to cod/created + notifies
 * the restaurant — same end-state as placing with COD upfront.
 * Idempotent guards: already-paid or missing order/COD config rejected.
 */
const switchToCod = catchAsync(async (req, res) => {
  const info = await paymentInitiationService.paymentInfo(req.body.paymentId);
  if (!info || info.success !== true || !info.payments) {
    return res.status(404).send({ code: 404, message: 'Payment intent not found', extra: '' });
  }
  if (info.payments.status === 'paid') {
    return res.status(400).send({ code: 400, message: 'Payment already completed', extra: '' });
  }
  const orderId = info.payments.orders;
  if (!orderId) {
    return res.status(400).send({ code: 400, message: 'No order linked to this payment', extra: '' });
  }
  const codId = await paymentConfigService.codPaymentId();
  if (!codId) {
    return res.status(400).send({ code: 400, message: 'Cash on delivery is not available', extra: '' });
  }
  await PaymentInitiation.deleteOne({ _id: new mongoose.Types.ObjectId(req.body.paymentId) });
  await ordersService.updateOrderPayment(orderId, { payment: codId });
  await ordersService.updateOrderStatus(orderId, { status: 'created', paymentMode: 'offline' });
  try {
    const meta = await ordersService.getOrderMetaNotification(orderId);
    if (meta && meta.user && meta.restaurant) {
      const fcm = require('../services').fcmNotificationService;
      await fcm.restaurantNewOrder(orderId, meta.restaurant, meta.user);
    }
  } catch (notifyErr) {
    void notifyErr;
  }
  res.send({ success: true, id: orderId });
});

const cancelMyOrder = catchAsync(async (req, res) => {
  const result = await ordersService.cancelOrderByUser(req.body.orderId, req.body.reasonId);
  if (
    result !== null &&
    result.user !== null &&
    result.restaurant !== null &&
    result.status === 'cancelled'
  ) {
    await fcmNotificationService.userCancleOrder(result.id, result.restaurant, result.user);
  }
  res.send({ success: true });
});

const getOrderDetailsForComplaints = catchAsync(async (req, res) => {
  const result = await ordersService.getOrderDetailForComplaints(req.params.id);
  res.send(result);
});

const getOrderDetailForReview = catchAsync(async (req, res) => {
  const { id, user } = req.params;
  const result = await ordersService.getOrderDetailForReview(id, user);
  res.send(result);
});

const fetchDriverPhoneNumber = catchAsync(async (req, res) => {
  const { driver } = req.params;
  const result = await ordersService.fetchDriverPhoneNumber(driver);
  res.send(result);
});

const getAdminUnAssignedOrderList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await ordersService.getAdminUnAssignedOrderList(options);
  res.send(result);
});

const cityzenUnAssignedOrderList = catchAsync(async (req, res) => {
  const { master } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await ordersService.cityzenUnAssignedOrderList(master, options);
  res.send(result);
});

const fetchDriverNearToOrder = catchAsync(async (req, res) => {
  const { id, restaurant } = req.params;
  const result = await ordersService.fetchDriverNearToOrder(id, restaurant);
  res.send(result);
});

const assignDriverOrderAdmin = catchAsync(async (req, res) => {
  const { id, driver } = req.body;
  const result = await ordersService.assignDriverOrderAdmin(id, driver, req.user);
  if (result != null && result.restaurant !== null) {
    await fcmNotificationService.driverNewOrder(id, result.restaurant, driver);
  }
  res.send({ success: true });
});

const assignDriverOrderVendor = catchAsync(async (req, res) => {
  const { id, driver } = req.body;
  const result = await ordersService.assignDriverOrderVendor(id, driver, req.user);
  if (result != null && result.restaurant !== null) {
    await fcmNotificationService.driverNewOrder(id, result.restaurant, driver);
  }
  res.send({ success: true });
});

const vendorOrderCountWeb = catchAsync(async (req, res) => {
  const { vendorId } = req.params;
  const results = await ordersService.vendorOrderCountWeb(vendorId);
  res.send(results);
});

const vendorOrderListWeb = catchAsync(async (req, res) => {
  const { vendorId, orderStatus } = req.query;
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await ordersService.vendorOrderListWeb(vendorId, orderStatus, options);
  res.send(result);
});

const vendorOrderDetail = catchAsync(async (req, res) => {
  const { id, vendor } = req.params;
  const results = await ordersService.vendorOrderDetail(id, vendor);
  res.send(results);
});

const callCustomer = catchAsync(async (req, res) => {
  const { id, vendor } = req.params;
  const result = await ordersService.callCustomer(id, vendor);
  res.send(result);
});

const callDeliveryman = catchAsync(async (req, res) => {
  const { id, vendor } = req.params;
  const result = await ordersService.callDeliveryman(id, vendor);
  res.send(result);
});

const getOrderDetailAdmin = catchAsync(async (req, res) => {
  const { id } = req.params;
  const results = await ordersService.getOrderDetailAdmin(id);
  res.send(results);
});

const getOrderDetailsForRestaurantComplaints = catchAsync(async (req, res) => {
  const { id, vendor } = req.params;
  const result = await ordersService.getOrderDetailForRestaurantComplaint(id, vendor);
  res.send(result);
});

const vendorOrderBusinessInsight = catchAsync(async (req, res) => {
  const { vendor } = req.params;
  const result = await ordersService.vendorOrderBusinessInsight(vendor);
  res.send(result);
});

const vendorOrderCustomDateBusinessInsight = catchAsync(async (req, res) => {
  const { vendor, startDate, endDate } = req.body;
  const result = await ordersService.vendorOrderCustomDateBusinessInsight(
    vendor,
    startDate,
    endDate
  );
  res.send(result);
});

const vendorWebOverallDashboardBusinessInsight = catchAsync(async (req, res) => {
  const { vendor } = req.params;
  const result = await ordersService.vendorWebOverallDashboardBusinessInsight(vendor);
  res.send(result);
});

const vendorWebMonthlyDashboardBusinessInsight = catchAsync(async (req, res) => {
  const { vendor } = req.params;
  const result = await ordersService.vendorWebMonthlyDashboardBusinessInsight(vendor);
  res.send(result);
});

const vendorWebWeeklyDashboardBusinessInsight = catchAsync(async (req, res) => {
  const { vendor } = req.params;
  const result = await ordersService.vendorWebWeeklyDashboardBusinessInsight(vendor);
  res.send(result);
});

const vendorWebTodayDashboardBusinessInsight = catchAsync(async (req, res) => {
  const { vendor } = req.params;
  const result = await ordersService.vendorWebTodayDashboardBusinessInsight(vendor);
  res.send(result);
});

const driverOrderList = catchAsync(async (req, res) => {
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const result = await ordersService.driverOrderList(req.body.uid, options);
  res.send(result);
});

const downloadOrderSummary = catchAsync(async (req, res) => {
  try {
    const { id, user, locale } = req.params;
    const result = await ordersService.downloadOrderSummary(id, user);
    if (result.success) {
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
      let orderDateTime = '';
      if (result.details.scheduleOrder === true) {
        const formattedDate = DateTime.fromJSDate(new Date(result.details.scheduleDate)).toFormat(
          'dd LLLL yyyy'
        );
        orderDateTime = `${formattedDate}, ${result.details.scheduleTime}`;
      } else {
        const formattedDate = DateTime.fromISO(result.details.createdAt).toFormat('dd LLLL yyyy');
        orderDateTime = `${formattedDate}, ${result.details.orderAt}`;
      }
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
      let driverName = '';
      let deliveryAddress = '';
      if (
        result &&
        result.details &&
        result.details !== null &&
        result.details.orderTo === 'homedelivery'
      ) {
        const addr = result.details.deliveryAddressRaw;
        deliveryAddress = `${addr.flatHouse} ${addr.locality} ${addr.landmark}`;
      } else {
        deliveryAddress = '';
      }
      let itemTotal = '';
      let foodServiceCharge = '';
      let serviceCharge = '';
      let deliveryCharge = '';
      let packageCharge = '';
      let packageChargeTax = '';
      let couponDiscountCharge = '';
      let walletAmount = '';
      let deliveryTip = '';
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
      if (result && result.details.deliveryCharge) {
        deliveryCharge =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.deliveryCharge}`
            : `${result.details.deliveryCharge}${currencySymbol}`;
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
      if (result && result.details.couponDiscountCharge) {
        couponDiscountCharge =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.couponDiscountCharge}`
            : `${result.details.couponDiscountCharge}${currencySymbol}`;
      }
      if (result && result.details.walletAmount) {
        walletAmount =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.walletAmount}`
            : `${result.details.walletAmount}${currencySymbol}`;
      }
      if (result && result.details.deliveryTip) {
        deliveryTip =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.deliveryTip}`
            : `${result.details.deliveryTip}${currencySymbol}`;
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
      if (
        result &&
        result.details &&
        result.details !== null &&
        result.details.driverInfo !== null &&
        result.details.driverInfo.firstName !== ''
      ) {
        driverName = `${result.details.driverInfo.firstName} ${result.details.driverInfo.lastName}`;
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

      let orderSummaryKey = 'Order Summary';
      let orderIdKey = 'Order ID';
      let orderTimeKey = 'Order Time';
      let customerNameKey = 'Customer Name';
      let deliveryAddressKey = 'Delivery Address';
      let restaurantNameKey = 'Restaurant Name';
      let restaurantAddressKey = 'Restaurant Address';
      let driverNameKey = "Delivery partner's Name";
      let itemKey = 'Item';
      let quantityKey = 'Quantity';
      let unitPriceKey = 'Unit Price';
      let totalPriceKey = 'Total Price';
      let itemTotalKey = 'Item Total';
      let foodServiceChargeKey = 'Food Service Charge';
      let serviceChargeKey = 'Service Charge';
      let deliveryChargeKey = 'Delivery Charge';
      let deliveryTipKey = 'Delivery Tip';
      let packageChargeKey = 'Packaging Charge';
      let packageChargeTaxKey = 'Packaging Charge Tax';
      let extraChargeKey = 'Extra Charge';
      let discountChargeKey = 'Discount Amount';
      let walletChargeKey = 'Wallet Amount';
      let grandTotalKey = 'Grand Total';
      let licenseKey = 'Lic. No.';

      let direction = 'ltr';
      const wordTranslations = apiLocaleTranslations[locale];
      if (wordTranslations && wordTranslations !== null) {
        direction = wordTranslations.direction;
        const wordLocale = wordTranslations.orderSummary;
        if (wordLocale && wordLocale !== null) {
          orderSummaryKey = wordLocale.orderSummaryKey;
          orderIdKey = wordLocale.orderIdKey;
          orderTimeKey = wordLocale.orderTimeKey;
          customerNameKey = wordLocale.customerNameKey;
          deliveryAddressKey = wordLocale.deliveryAddressKey;
          restaurantNameKey = wordLocale.restaurantNameKey;
          restaurantAddressKey = wordLocale.restaurantAddressKey;
          driverNameKey = wordLocale.driverNameKey;
          itemKey = wordLocale.itemKey;
          quantityKey = wordLocale.quantityKey;
          unitPriceKey = wordLocale.unitPriceKey;
          totalPriceKey = wordLocale.totalPriceKey;
          itemTotalKey = wordLocale.itemTotalKey;
          foodServiceChargeKey = wordLocale.foodServiceChargeKey;
          serviceChargeKey = wordLocale.serviceChargeKey;
          deliveryChargeKey = wordLocale.deliveryChargeKey;
          deliveryTipKey = wordLocale.deliveryTipKey;
          packageChargeKey = wordLocale.packageChargeKey;
          packageChargeTaxKey = wordLocale.packageChargeTaxKey;
          extraChargeKey = wordLocale.extraChargeKey;
          discountChargeKey = wordLocale.discountChargeKey;
          walletChargeKey = wordLocale.walletChargeKey;
          grandTotalKey = wordLocale.grandTotalKey;
          licenseKey = wordLocale.licenseKey;
          if (deliveryAddress === '') {
            deliveryAddress = wordLocale.selfPickupKey;
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
      const htmlPath = path.join(__dirname, '../templates/other/order_summary.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');
      const template = Handlebars.compile(htmlContent);
      const templateData = {
        orderNo: result.details.orderNo,
        time: orderDateTime,
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
        driver: driverName,
        serviceChargeName: `${serviceChargeName}`,
        foodTaxName: `${foodTaxName}`,
        itemTotal: `${itemTotal}`,
        foodServiceCharge: `${foodServiceCharge}`,
        serviceCharge: `${serviceCharge}`,
        deliveryCharge: `${deliveryCharge}`,
        packageCharge: `${packageCharge}`,
        packageChargeTax: `${packageChargeTax}`,
        couponDiscountCharge: `${couponDiscountCharge}`,
        walletAmount: `${walletAmount}`,
        deliveryTip: `${deliveryTip}`,
        extraCharge: `${extraCharge}`,
        grandTotal: `${grandTotal}`,
        orderSummaryKey: `${orderSummaryKey}`,
        orderIdKey: `${orderIdKey}`,
        orderTimeKey: `${orderTimeKey}`,
        customerNameKey: `${customerNameKey}`,
        deliveryAddressKey: `${deliveryAddressKey}`,
        restaurantNameKey: `${restaurantNameKey}`,
        restaurantAddressKey: `${restaurantAddressKey}`,
        driverNameKey: `${driverNameKey}`,
        itemKey: `${itemKey}`,
        quantityKey: `${quantityKey}`,
        unitPriceKey: `${unitPriceKey}`,
        totalPriceKey: `${totalPriceKey}`,
        itemTotalKey: `${itemTotalKey}`,
        foodServiceChargeKey: `${foodServiceChargeKey}`,
        serviceChargeKey: `${serviceChargeKey}`,
        deliveryChargeKey: `${deliveryChargeKey}`,
        deliveryTipKey: `${deliveryTipKey}`,
        packageChargeKey: `${packageChargeKey}`,
        packageChargeTaxKey: `${packageChargeTaxKey}`,
        extraChargeKey: `${extraChargeKey}`,
        discountChargeKey: `${discountChargeKey}`,
        walletChargeKey: `${walletChargeKey}`,
        grandTotalKey: `${grandTotalKey}`,
        licenseKey: `${licenseKey}`,
        direction: `${direction}`,
      };
      const finalHtml = template(templateData);
      await page.setContent(finalHtml, {
        waitUntil: 'networkidle',
      });
      const downloadPath = path.join(
        __dirname,
        `../templates/downloads/Order_ID_${result.details.orderNo}.pdf`
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

const downloadVendorOrderSummary = catchAsync(async (req, res) => {
  try {
    const { id, vendor, locale } = req.params;
    const result = await ordersService.downloadVendorOrderSummary(id, vendor);
    if (result.success) {
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
      let orderDateTime = '';
      if (result.details.scheduleOrder === true) {
        const formattedDate = DateTime.fromISO(result.details.scheduleDate).toFormat(
          'dd LLLL yyyy'
        );
        orderDateTime = `${formattedDate}, ${result.details.scheduleTime}`;
      } else {
        const formattedDate = DateTime.fromISO(result.details.createdAt).toFormat('dd LLLL yyyy');
        orderDateTime = `${formattedDate}, ${result.details.orderAt}`;
      }
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
      let driverName = '';
      let deliveryAddress = '';
      if (
        result &&
        result.details &&
        result.details !== null &&
        result.details.orderTo === 'homedelivery'
      ) {
        const addr = result.details.deliveryAddressRaw;
        deliveryAddress = `${addr.flatHouse} ${addr.locality} ${addr.landmark}`;
      } else {
        deliveryAddress = '';
      }
      let itemTotal = '';
      let foodServiceCharge = '';
      let serviceCharge = '';
      let deliveryCharge = '';
      let packageCharge = '';
      let packageChargeTax = '';
      let couponDiscountCharge = '';
      let walletAmount = '';
      let deliveryTip = '';
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
      if (result && result.details.deliveryCharge) {
        deliveryCharge =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.deliveryCharge}`
            : `${result.details.deliveryCharge}${currencySymbol}`;
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
      if (result && result.details.couponDiscountCharge) {
        couponDiscountCharge =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.couponDiscountCharge}`
            : `${result.details.couponDiscountCharge}${currencySymbol}`;
      }
      if (result && result.details.walletAmount) {
        walletAmount =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.walletAmount}`
            : `${result.details.walletAmount}${currencySymbol}`;
      }
      if (result && result.details.deliveryTip) {
        deliveryTip =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.deliveryTip}`
            : `${result.details.deliveryTip}${currencySymbol}`;
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
      if (
        result &&
        result.details &&
        result.details !== null &&
        result.details.driverInfo !== null &&
        result.details.driverInfo.firstName !== ''
      ) {
        driverName = `${result.details.driverInfo.firstName} ${result.details.driverInfo.lastName}`;
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

      let orderSummaryKey = 'Order Summary';
      let orderIdKey = 'Order ID';
      let orderTimeKey = 'Order Time';
      let customerNameKey = 'Customer Name';
      let deliveryAddressKey = 'Delivery Address';
      let restaurantNameKey = 'Restaurant Name';
      let restaurantAddressKey = 'Restaurant Address';
      let driverNameKey = "Delivery partner's Name";
      let itemKey = 'Item';
      let quantityKey = 'Quantity';
      let unitPriceKey = 'Unit Price';
      let totalPriceKey = 'Total Price';
      let itemTotalKey = 'Item Total';
      let foodServiceChargeKey = 'Food Service Charge';
      let serviceChargeKey = 'Service Charge';
      let deliveryChargeKey = 'Delivery Charge';
      let deliveryTipKey = 'Delivery Tip';
      let packageChargeKey = 'Packaging Charge';
      let packageChargeTaxKey = 'Packaging Charge Tax';
      let extraChargeKey = 'Extra Charge';
      let discountChargeKey = 'Discount Amount';
      let walletChargeKey = 'Wallet Amount';
      let grandTotalKey = 'Grand Total';
      let licenseKey = 'Lic. No.';

      let direction = 'ltr';
      const wordTranslations = apiLocaleTranslations[locale];
      if (wordTranslations && wordTranslations !== null) {
        direction = wordTranslations.direction;
        const wordLocale = wordTranslations.orderSummary;
        if (wordLocale && wordLocale !== null) {
          orderSummaryKey = wordLocale.orderSummaryKey;
          orderIdKey = wordLocale.orderIdKey;
          orderTimeKey = wordLocale.orderTimeKey;
          customerNameKey = wordLocale.customerNameKey;
          deliveryAddressKey = wordLocale.deliveryAddressKey;
          restaurantNameKey = wordLocale.restaurantNameKey;
          restaurantAddressKey = wordLocale.restaurantAddressKey;
          driverNameKey = wordLocale.driverNameKey;
          itemKey = wordLocale.itemKey;
          quantityKey = wordLocale.quantityKey;
          unitPriceKey = wordLocale.unitPriceKey;
          totalPriceKey = wordLocale.totalPriceKey;
          itemTotalKey = wordLocale.itemTotalKey;
          foodServiceChargeKey = wordLocale.foodServiceChargeKey;
          serviceChargeKey = wordLocale.serviceChargeKey;
          deliveryChargeKey = wordLocale.deliveryChargeKey;
          deliveryTipKey = wordLocale.deliveryTipKey;
          packageChargeKey = wordLocale.packageChargeKey;
          packageChargeTaxKey = wordLocale.packageChargeTaxKey;
          extraChargeKey = wordLocale.extraChargeKey;
          discountChargeKey = wordLocale.discountChargeKey;
          walletChargeKey = wordLocale.walletChargeKey;
          grandTotalKey = wordLocale.grandTotalKey;
          licenseKey = wordLocale.licenseKey;
          if (deliveryAddress === '') {
            deliveryAddress = wordLocale.selfPickupKey;
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
      const htmlPath = path.join(__dirname, '../templates/other/order_summary.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');
      const template = Handlebars.compile(htmlContent);
      const templateData = {
        orderNo: result.details.orderNo,
        time: orderDateTime,
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
        driver: driverName,
        serviceChargeName: `${serviceChargeName}`,
        foodTaxName: `${foodTaxName}`,
        itemTotal: `${itemTotal}`,
        foodServiceCharge: `${foodServiceCharge}`,
        serviceCharge: `${serviceCharge}`,
        deliveryCharge: `${deliveryCharge}`,
        packageCharge: `${packageCharge}`,
        packageChargeTax: `${packageChargeTax}`,
        couponDiscountCharge: `${couponDiscountCharge}`,
        walletAmount: `${walletAmount}`,
        deliveryTip: `${deliveryTip}`,
        extraCharge: `${extraCharge}`,
        grandTotal: `${grandTotal}`,
        orderSummaryKey: `${orderSummaryKey}`,
        orderIdKey: `${orderIdKey}`,
        orderTimeKey: `${orderTimeKey}`,
        customerNameKey: `${customerNameKey}`,
        deliveryAddressKey: `${deliveryAddressKey}`,
        restaurantNameKey: `${restaurantNameKey}`,
        restaurantAddressKey: `${restaurantAddressKey}`,
        driverNameKey: `${driverNameKey}`,
        itemKey: `${itemKey}`,
        quantityKey: `${quantityKey}`,
        unitPriceKey: `${unitPriceKey}`,
        totalPriceKey: `${totalPriceKey}`,
        itemTotalKey: `${itemTotalKey}`,
        foodServiceChargeKey: `${foodServiceChargeKey}`,
        serviceChargeKey: `${serviceChargeKey}`,
        deliveryChargeKey: `${deliveryChargeKey}`,
        deliveryTipKey: `${deliveryTipKey}`,
        packageChargeKey: `${packageChargeKey}`,
        packageChargeTaxKey: `${packageChargeTaxKey}`,
        extraChargeKey: `${extraChargeKey}`,
        discountChargeKey: `${discountChargeKey}`,
        walletChargeKey: `${walletChargeKey}`,
        grandTotalKey: `${grandTotalKey}`,
        licenseKey: `${licenseKey}`,
        direction: `${direction}`,
      };
      const finalHtml = template(templateData);
      await page.setContent(finalHtml, {
        waitUntil: 'networkidle',
      });
      const downloadPath = path.join(
        __dirname,
        `../templates/downloads/Order_ID_${result.details.orderNo}.pdf`
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

const downloadOrderInvoice = catchAsync(async (req, res) => {
  try {
    const { id, user, locale } = req.params;
    const result = await ordersService.downloadOrderInvoice(id, user);
    if (result.success) {
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

      let invoiceDateTime = '';
      let legalName = '';
      let deliveryAddress = '';
      if (result.details.scheduleOrder === true) {
        const formattedDate = DateTime.fromISO(result.details.scheduleDate).toFormat(
          'dd LLLL yyyy'
        );
        invoiceDateTime = `${formattedDate}`;
      } else {
        const formattedDate = DateTime.fromISO(result.details.createdAt).toFormat('dd LLLL yyyy');
        invoiceDateTime = `${formattedDate}`;
      }
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
        const addr = result.details.deliveryAddressRaw;
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
      let deliveryCharge = '';
      let packageCharge = '';
      let packageChargeTax = '';
      let couponDiscountCharge = '';
      let walletAmount = '';
      let deliveryTip = '';
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
      if (result && result.details.deliveryCharge) {
        deliveryCharge =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.deliveryCharge}`
            : `${result.details.deliveryCharge}${currencySymbol}`;
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
      if (result && result.details.couponDiscountCharge) {
        couponDiscountCharge =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.couponDiscountCharge}`
            : `${result.details.couponDiscountCharge}${currencySymbol}`;
      }
      if (result && result.details.walletAmount) {
        walletAmount =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.walletAmount}`
            : `${result.details.walletAmount}${currencySymbol}`;
      }
      if (result && result.details.deliveryTip) {
        deliveryTip =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.deliveryTip}`
            : `${result.details.deliveryTip}${currencySymbol}`;
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

      let orderInvoiceKey = 'Order Invoice';
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
      let deliveryChargeKey = 'Delivery Charge';
      let deliveryTipKey = 'Delivery Tip';
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
      let direction = 'ltr';
      const wordTranslations = apiLocaleTranslations[locale];
      if (wordTranslations && wordTranslations !== null) {
        direction = wordTranslations.direction;
        const wordLocale = wordTranslations.orderInvoice;
        if (wordLocale && wordLocale !== null) {
          orderInvoiceKey = wordLocale.orderInvoiceKey;
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
          deliveryChargeKey = wordLocale.deliveryChargeKey;
          deliveryTipKey = wordLocale.deliveryTipKey;
          restaurantPackagingChargeKey = wordLocale.restaurantPackagingChargeKey;
          extraChargeKey = wordLocale.extraChargeKey;
          couponDiscountKey = wordLocale.couponDiscountKey;
          walletDiscountKey = wordLocale.walletDiscountKey;
          totalValueKey = wordLocale.totalValueKey;
          amountKey = wordLocale.amountKey;
          onlinePayDescriptionKey = wordLocale.onlinePayDescriptionKey;
          offlinePayDescriptionKey = wordLocale.offlinePayDescriptionKey;
          licenseKey = wordLocale.licenseKey;
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
      const htmlPath = path.join(__dirname, '../templates/other/order_invoice.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');
      const template = Handlebars.compile(htmlContent);
      const templateData = {
        id: result.details.id,
        orderNo: result.details.orderNo,
        cart: cartItem,
        legalName: `${legalName}`,
        company: result.businessSettings.companyName,
        invoiceDateTime: `${invoiceDateTime}`,
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
        deliveryCharge: `${deliveryCharge}`,
        packageCharge: `${packageCharge}`,
        packageChargeTax: `${packageChargeTax}`,
        packageChargeTotalValue: `${packageChargeTotalValue}`,
        couponDiscountCharge: `${couponDiscountCharge}`,
        walletAmount: `${walletAmount}`,
        deliveryTip: `${deliveryTip}`,
        extraCharge: `${extraCharge}`,
        grandTotal: `${grandTotal}`,
        direction: `${direction}`,
        orderInvoiceKey: `${orderInvoiceKey}`,
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
        deliveryChargeKey: `${deliveryChargeKey}`,
        deliveryTipKey: `${deliveryTipKey}`,
        restaurantPackagingChargeKey: `${restaurantPackagingChargeKey}`,
        extraChargeKey: `${extraChargeKey}`,
        couponDiscountKey: `${couponDiscountKey}`,
        walletDiscountKey: `${walletDiscountKey}`,
        totalValueKey: `${totalValueKey}`,
        amountKey: `${amountKey}`,
        onlinePayDescriptionKey: `${onlinePayDescriptionKey}`,
        offlinePayDescriptionKey: `${offlinePayDescriptionKey}`,
        licenseKey: `${licenseKey}`,
      };
      const finalHtml = template(templateData);
      await page.setContent(finalHtml, {
        waitUntil: 'networkidle',
      });
      const downloadPath = path.join(
        __dirname,
        `../templates/downloads/Invoice_${result.details.orderNo}.pdf`
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

const downloadVendorOrderInvoice = catchAsync(async (req, res) => {
  try {
    const { id, vendor, locale } = req.params;
    const result = await ordersService.downloadVendorOrderInvoice(id, vendor);
    if (result.success) {
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

      let invoiceDateTime = '';
      let legalName = '';
      let deliveryAddress = '';
      if (result.details.scheduleOrder === true) {
        const formattedDate = DateTime.fromJSDate(new Date(result.details.scheduleDate)).toFormat(
          'dd LLLL yyyy'
        );
        invoiceDateTime = `${formattedDate}`;
      } else {
        const formattedDate = DateTime.fromISO(result.details.createdAt).toFormat('dd LLLL yyyy');
        invoiceDateTime = `${formattedDate}`;
      }
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
        const addr = result.details.deliveryAddressRaw;
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
      let deliveryCharge = '';
      let packageCharge = '';
      let packageChargeTax = '';
      let couponDiscountCharge = '';
      let walletAmount = '';
      let deliveryTip = '';
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
      if (result && result.details.deliveryCharge) {
        deliveryCharge =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.deliveryCharge}`
            : `${result.details.deliveryCharge}${currencySymbol}`;
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
      if (result && result.details.couponDiscountCharge) {
        couponDiscountCharge =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.couponDiscountCharge}`
            : `${result.details.couponDiscountCharge}${currencySymbol}`;
      }
      if (result && result.details.walletAmount) {
        walletAmount =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.walletAmount}`
            : `${result.details.walletAmount}${currencySymbol}`;
      }
      if (result && result.details.deliveryTip) {
        deliveryTip =
          currencySide === 'left'
            ? `${currencySymbol}${result.details.deliveryTip}`
            : `${result.details.deliveryTip}${currencySymbol}`;
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

      let orderInvoiceKey = 'Order Invoice';
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
      let deliveryChargeKey = 'Delivery Charge';
      let deliveryTipKey = 'Delivery Tip';
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
      let direction = 'ltr';
      const wordTranslations = apiLocaleTranslations[locale];
      if (wordTranslations && wordTranslations !== null) {
        direction = wordTranslations.direction;
        const wordLocale = wordTranslations.orderInvoice;
        if (wordLocale && wordLocale !== null) {
          orderInvoiceKey = wordLocale.orderInvoiceKey;
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
          deliveryChargeKey = wordLocale.deliveryChargeKey;
          deliveryTipKey = wordLocale.deliveryTipKey;
          restaurantPackagingChargeKey = wordLocale.restaurantPackagingChargeKey;
          extraChargeKey = wordLocale.extraChargeKey;
          couponDiscountKey = wordLocale.couponDiscountKey;
          walletDiscountKey = wordLocale.walletDiscountKey;
          totalValueKey = wordLocale.totalValueKey;
          amountKey = wordLocale.amountKey;
          onlinePayDescriptionKey = wordLocale.onlinePayDescriptionKey;
          offlinePayDescriptionKey = wordLocale.offlinePayDescriptionKey;
          licenseKey = wordLocale.licenseKey;
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
      const htmlPath = path.join(__dirname, '../templates/other/order_invoice.html');
      const htmlContent = fs.readFileSync(htmlPath, 'utf8');
      const template = Handlebars.compile(htmlContent);
      const templateData = {
        id: result.details.id,
        orderNo: result.details.orderNo,
        cart: cartItem,
        legalName: `${legalName}`,
        company: result.businessSettings.companyName,
        invoiceDateTime: `${invoiceDateTime}`,
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
        deliveryCharge: `${deliveryCharge}`,
        packageCharge: `${packageCharge}`,
        packageChargeTax: `${packageChargeTax}`,
        packageChargeTotalValue: `${packageChargeTotalValue}`,
        couponDiscountCharge: `${couponDiscountCharge}`,
        walletAmount: `${walletAmount}`,
        deliveryTip: `${deliveryTip}`,
        extraCharge: `${extraCharge}`,
        grandTotal: `${grandTotal}`,
        direction: `${direction}`,
        orderInvoiceKey: `${orderInvoiceKey}`,
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
        deliveryChargeKey: `${deliveryChargeKey}`,
        deliveryTipKey: `${deliveryTipKey}`,
        restaurantPackagingChargeKey: `${restaurantPackagingChargeKey}`,
        extraChargeKey: `${extraChargeKey}`,
        couponDiscountKey: `${couponDiscountKey}`,
        walletDiscountKey: `${walletDiscountKey}`,
        totalValueKey: `${totalValueKey}`,
        amountKey: `${amountKey}`,
        onlinePayDescriptionKey: `${onlinePayDescriptionKey}`,
        offlinePayDescriptionKey: `${offlinePayDescriptionKey}`,
        licenseKey: `${licenseKey}`,
      };
      const finalHtml = template(templateData);
      await page.setContent(finalHtml, {
        waitUntil: 'networkidle',
      });
      const downloadPath = path.join(
        __dirname,
        `../templates/downloads/Invoice_${result.details.orderNo}.pdf`
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

const orderReports = catchAsync(async (req, res) => {
  const options = pick(req.query, [
    'restaurant',
    'filter',
    'filterDates',
    'search',
    'limit',
    'page',
    'search',
  ]);
  const result = await ordersService.orderReports(options);
  res.send(result);
});

const customerOrderList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['user', 'limit', 'page']);
  const result = await ordersService.customerOrderList(options);
  res.send(result);
});

const customerAllRefundRequest = catchAsync(async (req, res) => {
  const options = pick(req.query, ['user', 'limit', 'page']);
  const result = await ordersService.customerAllRefundRequest(options);
  res.send(result);
});

const customerOrderRefundList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['user', 'limit', 'page']);
  const result = await ordersService.customerOrderRefundList(options);
  res.send(result);
});

const customerTiffinRefundList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['user', 'limit', 'page']);
  const result = await ordersService.customerTiffinRefundList(options);
  res.send(result);
});

const customerBookingRefundList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['user', 'limit', 'page']);
  const result = await ordersService.customerBookingRefundList(options);
  res.send(result);
});

const vendorOrderList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'limit', 'page']);
  const result = await ordersService.vendorOrderList(options);
  res.send(result);
});

const vendorAllRefundRequest = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'limit', 'page']);
  const result = await ordersService.vendorAllRefundRequest(options);
  res.send(result);
});

const vendorOrderRefundRequest = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'limit', 'page']);
  const result = await ordersService.vendorOrderRefundRequest(options);
  res.send(result);
});

const vendorDiningRefundRequest = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'limit', 'page']);
  const result = await ordersService.vendorDiningRefundRequest(options);
  res.send(result);
});

const vendorTiffinRefundRequest = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'limit', 'page']);
  const result = await ordersService.vendorTiffinRefundRequest(options);
  res.send(result);
});

const deliverymanOrderList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['deliveryman', 'limit', 'page']);
  const result = await ordersService.deliverymanOrderList(options);
  res.send(result);
});

const adminDashboard = catchAsync(async (req, res) => {
  const result = await ordersService.adminDashboard();
  res.send(result);
});

const couponOrders = catchAsync(async (req, res) => {
  const { id } = req.params;
  const options = pick(req.query, ['limit', 'page']);
  const result = await ordersService.couponOrders(id, options);
  res.send(result);
});

const adminOrderInvoice = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await ordersService.adminOrderInvoice(id);
  res.send(result);
});

const vendorOrderInvoice = catchAsync(async (req, res) => {
  const { id, vendor } = req.params;
  const result = await ordersService.vendorOrderInvoice(id, vendor);
  res.send(result);
});

const supportTeamOrderDetail = catchAsync(async (req, res) => {
  const { id } = req.params;
  const results = await ordersService.supportTeamOrderDetail(id);
  res.send(results);
});

const accountantDashboard = catchAsync(async (req, res) => {
  const result = await ordersService.accountantDashboard();
  res.send(result);
});

const cityzenDashboard = catchAsync(async (req, res) => {
  const { master } = req.params;
  const result = await ordersService.cityzenDashboard(master);
  res.send(result);
});

const exportQueryCollection = catchAsync(async (req, res) => {
  const { type, status, search } = req.query;
  if (type !== 'raw') {
    const result = await ordersService.exportQueryCollection(status, search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
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
        orderTo: detail.orderTo === 'homedelivery' ? 'Home Delivery' : 'Self Pickup',
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
        instantOrder: detail.instantOrder ? 'Yes' : 'No',
        scheduleOrder: detail.scheduleOrder ? 'Yes' : 'No',
        scheduleDate:
          detail &&
          detail.scheduleDate &&
          detail.scheduleDate !== null &&
          detail.scheduleDate !== ''
            ? detail.scheduleDate
            : '-',
        orderAt:
          detail && detail.orderAt && detail.orderAt !== null && detail.orderAt !== ''
            ? detail.orderAt
            : '-',
        scheduleTime:
          detail &&
          detail.scheduleTime &&
          detail.scheduleTime !== null &&
          detail.scheduleTime !== ''
            ? detail.scheduleTime
            : '-',
        createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Orders');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Order No', key: 'orderNo' },
        { header: 'User Id', key: 'userId' },
        { header: 'User First Name', key: 'userFirstName' },
        { header: 'User Last Name', key: 'userLastName' },
        { header: 'Receiver Name', key: 'receiverName' },
        { header: 'Restaurant Id', key: 'restaurantId' },
        { header: 'Restaurant Name', key: 'restaurantName' },
        { header: 'Order To', key: 'orderTo' },
        { header: 'Country Code', key: 'countryCode' },
        { header: 'Receiver Contact', key: 'receiverContact' },
        { header: 'Grand Total', key: 'grandTotal' },
        { header: 'Payment Id', key: 'paymentId' },
        { header: 'Payment Name', key: 'paymentName' },
        { header: 'Payment Way', key: 'paymentWay' },
        { header: 'Payment Mode', key: 'paymentMode' },
        { header: 'Instant Order', key: 'instantOrder' },
        { header: 'Schedule Order', key: 'scheduleOrder' },
        { header: 'Schedule Date', key: 'scheduleDate' },
        { header: 'Order At', key: 'orderAt' },
        { header: 'Schedule Time', key: 'scheduleTime' },
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
        'User Id':
          detail &&
          detail.userInfo &&
          detail.userInfo.id &&
          detail.userInfo.id !== null &&
          detail.userInfo.id !== ''
            ? detail.userInfo.id
            : '-',
        'User First Name':
          detail &&
          detail.userInfo &&
          detail.userInfo.firstName &&
          detail.userInfo.firstName !== null &&
          detail.userInfo.firstName !== ''
            ? detail.userInfo.firstName
            : '-',
        'User Last Name':
          detail &&
          detail.userInfo &&
          detail.userInfo.lastName &&
          detail.userInfo.lastName !== null &&
          detail.userInfo.lastName !== ''
            ? detail.userInfo.lastName
            : '-',
        'Receiver Name': detail.receiverName,
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
        'Order To': detail.orderTo === 'homedelivery' ? 'Home Delivery' : 'Self Pickup',
        'Country Code': detail.countryCode,
        'Receiver Contact': detail.receiverContact,
        'Grand Total': detail.grandTotal,
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
        'Payment Mode': detail.paymentMode,
        'Instant Order': detail.instantOrder ? 'Yes' : 'No',
        'Schedule Order': detail.scheduleOrder ? 'Yes' : 'No',
        'Schedule Date':
          detail &&
          detail.scheduleDate &&
          detail.scheduleDate !== null &&
          detail.scheduleDate !== ''
            ? detail.scheduleDate
            : '-',
        'Order At':
          detail && detail.orderAt && detail.orderAt !== null && detail.orderAt !== ''
            ? detail.orderAt
            : '-',
        'Schedule Time':
          detail &&
          detail.scheduleTime &&
          detail.scheduleTime !== null &&
          detail.scheduleTime !== ''
            ? detail.scheduleTime
            : '-',
        'Created At': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
        Status: detail.status,
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await ordersService.exportQueryRawCollection(status, search);
    const downloadPath = path.join(__dirname, `../templates/downloads/orders.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'orders.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportUnAssignedOrderCollection = catchAsync(async (req, res) => {
  const { type, search } = req.query;
  if (type !== 'raw') {
    const result = await ordersService.exportUnAssignedOrderCollection(search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
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
        orderTo: detail.orderTo === 'homedelivery' ? 'Home Delivery' : 'Self Pickup',
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
        instantOrder: detail.instantOrder ? 'Yes' : 'No',
        scheduleOrder: detail.scheduleOrder ? 'Yes' : 'No',
        scheduleDate:
          detail &&
          detail.scheduleDate &&
          detail.scheduleDate !== null &&
          detail.scheduleDate !== ''
            ? detail.scheduleDate
            : '-',
        orderAt:
          detail && detail.orderAt && detail.orderAt !== null && detail.orderAt !== ''
            ? detail.orderAt
            : '-',
        scheduleTime:
          detail &&
          detail.scheduleTime &&
          detail.scheduleTime !== null &&
          detail.scheduleTime !== ''
            ? detail.scheduleTime
            : '-',
        createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Orders');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Order No', key: 'orderNo' },
        { header: 'User Id', key: 'userId' },
        { header: 'User First Name', key: 'userFirstName' },
        { header: 'User Last Name', key: 'userLastName' },
        { header: 'Receiver Name', key: 'receiverName' },
        { header: 'Restaurant Id', key: 'restaurantId' },
        { header: 'Restaurant Name', key: 'restaurantName' },
        { header: 'Order To', key: 'orderTo' },
        { header: 'Country Code', key: 'countryCode' },
        { header: 'Receiver Contact', key: 'receiverContact' },
        { header: 'Grand Total', key: 'grandTotal' },
        { header: 'Payment Id', key: 'paymentId' },
        { header: 'Payment Name', key: 'paymentName' },
        { header: 'Payment Way', key: 'paymentWay' },
        { header: 'Payment Mode', key: 'paymentMode' },
        { header: 'Instant Order', key: 'instantOrder' },
        { header: 'Schedule Order', key: 'scheduleOrder' },
        { header: 'Schedule Date', key: 'scheduleDate' },
        { header: 'Order At', key: 'orderAt' },
        { header: 'Schedule Time', key: 'scheduleTime' },
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
        'User Id':
          detail &&
          detail.userInfo &&
          detail.userInfo.id &&
          detail.userInfo.id !== null &&
          detail.userInfo.id !== ''
            ? detail.userInfo.id
            : '-',
        'User First Name':
          detail &&
          detail.userInfo &&
          detail.userInfo.firstName &&
          detail.userInfo.firstName !== null &&
          detail.userInfo.firstName !== ''
            ? detail.userInfo.firstName
            : '-',
        'User Last Name':
          detail &&
          detail.userInfo &&
          detail.userInfo.lastName &&
          detail.userInfo.lastName !== null &&
          detail.userInfo.lastName !== ''
            ? detail.userInfo.lastName
            : '-',
        'Receiver Name': detail.receiverName,
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
        'Order To': detail.orderTo === 'homedelivery' ? 'Home Delivery' : 'Self Pickup',
        'Country Code': detail.countryCode,
        'Receiver Contact': detail.receiverContact,
        'Grand Total': detail.grandTotal,
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
        'Payment Mode': detail.paymentMode,
        'Instant Order': detail.instantOrder ? 'Yes' : 'No',
        'Schedule Order': detail.scheduleOrder ? 'Yes' : 'No',
        'Schedule Date':
          detail &&
          detail.scheduleDate &&
          detail.scheduleDate !== null &&
          detail.scheduleDate !== ''
            ? detail.scheduleDate
            : '-',
        'Order At':
          detail && detail.orderAt && detail.orderAt !== null && detail.orderAt !== ''
            ? detail.orderAt
            : '-',
        'Schedule Time':
          detail &&
          detail.scheduleTime &&
          detail.scheduleTime !== null &&
          detail.scheduleTime !== ''
            ? detail.scheduleTime
            : '-',
        'Created At': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
        Status: detail.status,
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await ordersService.exportUnAssignedRawOrderCollection(search);
    const downloadPath = path.join(__dirname, `../templates/downloads/orders.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'orders.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportSubscriptionOrderCollection = catchAsync(async (req, res) => {
  const { type, search } = req.query;
  if (type !== 'raw') {
    const result = await ordersService.exportSubscriptionOrderQueryCollection(search);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
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
        orderTo: detail.orderTo === 'homedelivery' ? 'Home Delivery' : 'Self Pickup',
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
        instantOrder: detail.instantOrder ? 'Yes' : 'No',
        scheduleOrder: detail.scheduleOrder ? 'Yes' : 'No',
        scheduleDate:
          detail &&
          detail.scheduleDate &&
          detail.scheduleDate !== null &&
          detail.scheduleDate !== ''
            ? detail.scheduleDate
            : '-',
        orderAt:
          detail && detail.orderAt && detail.orderAt !== null && detail.orderAt !== ''
            ? detail.orderAt
            : '-',
        scheduleTime:
          detail &&
          detail.scheduleTime &&
          detail.scheduleTime !== null &&
          detail.scheduleTime !== ''
            ? detail.scheduleTime
            : '-',
        createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Orders');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Order No', key: 'orderNo' },
        { header: 'User Id', key: 'userId' },
        { header: 'User First Name', key: 'userFirstName' },
        { header: 'User Last Name', key: 'userLastName' },
        { header: 'Receiver Name', key: 'receiverName' },
        { header: 'Restaurant Id', key: 'restaurantId' },
        { header: 'Restaurant Name', key: 'restaurantName' },
        { header: 'Order To', key: 'orderTo' },
        { header: 'Country Code', key: 'countryCode' },
        { header: 'Receiver Contact', key: 'receiverContact' },
        { header: 'Grand Total', key: 'grandTotal' },
        { header: 'Payment Id', key: 'paymentId' },
        { header: 'Payment Name', key: 'paymentName' },
        { header: 'Payment Way', key: 'paymentWay' },
        { header: 'Payment Mode', key: 'paymentMode' },
        { header: 'Instant Order', key: 'instantOrder' },
        { header: 'Schedule Order', key: 'scheduleOrder' },
        { header: 'Schedule Date', key: 'scheduleDate' },
        { header: 'Order At', key: 'orderAt' },
        { header: 'Schedule Time', key: 'scheduleTime' },
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
        'User Id':
          detail &&
          detail.userInfo &&
          detail.userInfo.id &&
          detail.userInfo.id !== null &&
          detail.userInfo.id !== ''
            ? detail.userInfo.id
            : '-',
        'User First Name':
          detail &&
          detail.userInfo &&
          detail.userInfo.firstName &&
          detail.userInfo.firstName !== null &&
          detail.userInfo.firstName !== ''
            ? detail.userInfo.firstName
            : '-',
        'User Last Name':
          detail &&
          detail.userInfo &&
          detail.userInfo.lastName &&
          detail.userInfo.lastName !== null &&
          detail.userInfo.lastName !== ''
            ? detail.userInfo.lastName
            : '-',
        'Receiver Name': detail.receiverName,
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
        'Order To': detail.orderTo === 'homedelivery' ? 'Home Delivery' : 'Self Pickup',
        'Country Code': detail.countryCode,
        'Receiver Contact': detail.receiverContact,
        'Grand Total': detail.grandTotal,
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
        'Payment Mode': detail.paymentMode,
        'Instant Order': detail.instantOrder ? 'Yes' : 'No',
        'Schedule Order': detail.scheduleOrder ? 'Yes' : 'No',
        'Schedule Date':
          detail &&
          detail.scheduleDate &&
          detail.scheduleDate !== null &&
          detail.scheduleDate !== ''
            ? detail.scheduleDate
            : '-',
        'Order At':
          detail && detail.orderAt && detail.orderAt !== null && detail.orderAt !== ''
            ? detail.orderAt
            : '-',
        'Schedule Time':
          detail &&
          detail.scheduleTime &&
          detail.scheduleTime !== null &&
          detail.scheduleTime !== ''
            ? detail.scheduleTime
            : '-',
        'Created At': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
        Status: detail.status,
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await ordersService.exportSubscriptionOrderQueryRawCollection(search);
    const downloadPath = path.join(__dirname, `../templates/downloads/orders.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'orders.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportRegularOrderReportCollection = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'filter', 'filterDates', 'search']);
  const { type } = req.query;
  const result = await ordersService.exportRegularOrderReportCollection(options);
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
      userRole:
        detail &&
        detail.userInfo &&
        detail.userInfo.role &&
        detail.userInfo.role !== null &&
        detail.userInfo.role !== ''
          ? detail.userInfo.role
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
      orderTo: detail.orderTo === 'homedelivery' ? 'Home Delivery' : 'Self Pickup',
      instantOrder: detail.instantOrder ? 'Yes' : 'No',
      scheduleOrder: detail.scheduleOrder ? 'Yes' : 'No',
      scheduleDate:
        detail && detail.scheduleDate && detail.scheduleDate !== null && detail.scheduleDate !== ''
          ? detail.scheduleDate
          : '-',
      orderAt:
        detail && detail.orderAt && detail.orderAt !== null && detail.orderAt !== ''
          ? detail.orderAt
          : '-',
      scheduleTime:
        detail && detail.scheduleTime && detail.scheduleTime !== null && detail.scheduleTime !== ''
          ? detail.scheduleTime
          : '-',
      createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
    }));
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Orders');
    worksheet.columns = [
      { header: 'S. No.', key: 'serial' },
      { header: 'Id', key: 'id' },
      { header: 'Order No', key: 'orderNo' },
      { header: 'User Id', key: 'userId' },
      { header: 'User First Name', key: 'userFirstName' },
      { header: 'User Last Name', key: 'userLastName' },
      { header: 'Receiver Name', key: 'receiverName' },
      { header: 'Restaurant Id', key: 'restaurantId' },
      { header: 'Restaurant Name', key: 'restaurantName' },
      { header: 'Order To', key: 'orderTo' },
      { header: 'Country Code', key: 'countryCode' },
      { header: 'Receiver Contact', key: 'receiverContact' },
      { header: 'Real Total', key: 'realTotal' },
      { header: 'Item Total', key: 'itemTotal' },
      { header: 'Item Discount', key: 'itemDiscount' },
      { header: 'Coupon Discount Charge', key: 'couponDiscountCharge' },
      { header: 'Delivery Charge', key: 'deliveryCharge' },
      { header: 'Food Service Charge', key: 'foodServiceCharge' },
      { header: 'Service Charge', key: 'serviceCharge' },
      { header: 'Package Charge', key: 'packageCharge' },
      { header: 'Package Charge Tax', key: 'packageChargeTax' },
      { header: 'Delivery Tip', key: 'deliveryTip' },
      { header: 'Extra Charge', key: 'extraCharge' },
      { header: 'Wallet Amount', key: 'walletAmount' },
      { header: 'Refunded Amount', key: 'refundedAmount' },
      { header: 'Driver Earining', key: 'driverEarining' },
      { header: 'Delivery Commission', key: 'deliveryCommission' },
      { header: 'Restaurant Commission', key: 'restaurantCommission' },
      { header: 'Grand Total', key: 'grandTotal' },
      { header: 'Payment Id', key: 'paymentId' },
      { header: 'Payment Name', key: 'paymentName' },
      { header: 'Payment Way', key: 'paymentWay' },
      { header: 'Payment Mode', key: 'paymentMode' },
      { header: 'Instant Order', key: 'instantOrder' },
      { header: 'Schedule Order', key: 'scheduleOrder' },
      { header: 'Schedule Date', key: 'scheduleDate' },
      { header: 'Order At', key: 'orderAt' },
      { header: 'Schedule Time', key: 'scheduleTime' },
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
      'User Id':
        detail &&
        detail.userInfo &&
        detail.userInfo.id &&
        detail.userInfo.id !== null &&
        detail.userInfo.id !== ''
          ? detail.userInfo.id
          : '-',
      'User First Name':
        detail &&
        detail.userInfo &&
        detail.userInfo.firstName &&
        detail.userInfo.firstName !== null &&
        detail.userInfo.firstName !== ''
          ? detail.userInfo.firstName
          : '-',
      'User Last Name':
        detail &&
        detail.userInfo &&
        detail.userInfo.lastName &&
        detail.userInfo.lastName !== null &&
        detail.userInfo.lastName !== ''
          ? detail.userInfo.lastName
          : '-',
      'Receiver Name': detail.receiverName,
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
      'Order To': detail.orderTo === 'homedelivery' ? 'Home Delivery' : 'Self Pickup',
      'Country Code': detail.countryCode,
      'Receiver Contact': detail.receiverContact,
      'Real Total': detail.realTotal,
      'Item Total': detail.itemTotal,
      'Item Discount': detail.itemDiscount,
      'Coupon Discount Charge': detail.couponDiscountCharge,
      'Delivery Charge': detail.deliveryCharge,
      'Food Service Charge': detail.foodServiceCharge,
      'Service Charge': detail.serviceCharge,
      'Package Charge': detail.packageCharge,
      'Package Charge Tax': detail.packageChargeTax,
      'Delivery Tip': detail.deliveryTip,
      'Extra Charge': detail.extraCharge,
      'Wallet Amount': detail.walletAmount,
      'Refunded Amount': detail.refundedAmount,
      'Driver Earining': detail.driverEarining,
      'Delivery Commission': detail.deliveryCommission,
      'Restaurant Commission': detail.restaurantCommission,
      'Grand Total': detail.grandTotal,
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
      'Payment Mode': detail.paymentMode,
      'Instant Order': detail.instantOrder ? 'Yes' : 'No',
      'Schedule Order': detail.scheduleOrder ? 'Yes' : 'No',
      'Schedule Date':
        detail && detail.scheduleDate && detail.scheduleDate !== null && detail.scheduleDate !== ''
          ? detail.scheduleDate
          : '-',
      'Order At':
        detail && detail.orderAt && detail.orderAt !== null && detail.orderAt !== ''
          ? detail.orderAt
          : '-',
      'Schedule Time':
        detail && detail.scheduleTime && detail.scheduleTime !== null && detail.scheduleTime !== ''
          ? detail.scheduleTime
          : '-',
      'Created At': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      Status: detail.status,
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
              importKeys.length === regularOrderSchemakeys.length &&
              importKeys.every((item) => regularOrderSchemakeys.includes(item));
            if (validSchema) {
              const result = await ordersService.importCollection(records);
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
                    importKeys.length === regularOrderSchemakeys.length &&
                    importKeys.every((item) => regularOrderSchemakeys.includes(item));
                  if (validSchema) {
                    const result = await ordersService.importCollection(records);
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
  placeOrderFromApp,
  placePOSAdminOrder,
  getMyOrderList,
  getVendorOrder,
  prepareOrder,
  acceptScheduleOrder,
  orderReady,
  getDriverNewOrderList,
  driverAcceptOrder,
  driverRejectOrder,
  driverActiveOrder,
  driverOrderDetails,
  driverReachedRestaurant,
  restaurantOrderHandoverDriver,
  restaurantOrderHandoverCustomer,
  driverPickupOrder,
  driverReachedCustomer,
  driverDeliverOrder,
  getOrderCount,
  getAdminOrderList,
  getAdminScheduleOrderList,
  restaurantRejectOrder,
  getUserOrderDetail,
  repayPendingOrder,
  switchToCod,
  cancelMyOrder,
  getOrderDetailsForComplaints,
  getMyFavouriteOrders,
  getOrderDetailForReview,
  getAdminSubscriptionOrderList,
  fetchDriverPhoneNumber,
  getAdminUnAssignedOrderList,
  fetchDriverNearToOrder,
  assignDriverOrderAdmin,
  assignDriverOrderVendor,
  vendorOrderCountWeb,
  vendorOrderListWeb,
  vendorOrderDetail,
  callCustomer,
  callDeliveryman,
  getOrderDetailAdmin,
  getOrderDetailsForRestaurantComplaints,
  vendorOrderBusinessInsight,
  vendorOrderCustomDateBusinessInsight,
  vendorWebOverallDashboardBusinessInsight,
  vendorWebMonthlyDashboardBusinessInsight,
  vendorWebWeeklyDashboardBusinessInsight,
  vendorWebTodayDashboardBusinessInsight,
  driverOrderList,
  downloadOrderSummary,
  downloadVendorOrderSummary,
  downloadOrderInvoice,
  downloadVendorOrderInvoice,
  orderReports,
  customerOrderList,
  customerAllRefundRequest,
  customerOrderRefundList,
  customerTiffinRefundList,
  customerBookingRefundList,
  vendorOrderList,
  vendorAllRefundRequest,
  deliverymanOrderList,
  adminDashboard,
  couponOrders,
  adminOrderInvoice,
  vendorOrderInvoice,
  supportTeamOrderDetail,
  accountantDashboard,
  cityzenDashboard,
  placePOSCityzenOrder,
  cityzenOrderCounts,
  cityzenOrderList,
  cityzenUnAssignedOrderList,
  cityzenSubscriptionOrderList,
  vendorOrderRefundRequest,
  vendorDiningRefundRequest,
  vendorTiffinRefundRequest,
  exportQueryCollection,
  exportUnAssignedOrderCollection,
  exportSubscriptionOrderCollection,
  exportRegularOrderReportCollection,
  importCollection,
};

