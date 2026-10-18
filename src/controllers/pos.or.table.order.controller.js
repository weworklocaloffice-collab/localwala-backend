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
const mongoose = require('mongoose');
const lodash = require('lodash');
const catchAsync = require('../utils/catchAsync');
const pick = require('../utils/pick');
const {
  restaurantService,
  orderSettingsService,
  cartItemService,
  posOrTableOrderService,
  addonsService,
  foodService,
  restaurantPosTableOrderCommissionService,
  restaurantExpenseService,
} = require('../services');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');
const uploadMiddleware = require('../middlewares/upload');
const config = require('../config/config');
const { vendorPOSOrderSchemaKeys } = require('../utils/importCollectionSchema');

const vendorPlaceOrder = catchAsync(async (req, res) => {
  const {
    restaurant,
    paymentMode,
    customerType,
    customerName,
    customerCountryCode,
    customerMobileNumber,
    cartItemRaw,
    discountType,
    discountAmount,
    foodServiceCharge,
    serviceCharge,
    packageCharge,
    packageChargeTax,
    extraCharge,
  } = req.body;
  const permission = await restaurantService.checkPosPermissionOfRestaurant(restaurant);
  const orderSettings = await orderSettingsService.getOrderSettingForCheckout(restaurant);
  if (
    permission &&
    permission.posPermission !== null &&
    permission.posPermission !== '' &&
    permission.posPermission === false
  ) {
    res.status(400).send({ code: 400, message: 'Pos Permission Denied' });
  }
  try {
    const cartItemsRequest = JSON.parse(cartItemRaw);
    if (checkArrayNotEmpty(cartItemsRequest)) {
      const savedItemIds = cartItemsRequest.map((item) => item.food.toString());
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
          const cartItemJSON = [];
          const foodMetaUpdateJson = [];
          cartItemsRequest.forEach((inCartItemElement) => {
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
            cartItemsRequest.forEach((inCartItemElement) => {
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
          if (itemInStock === true && addonInStock === true && variationInStock === true) {
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
              if (foodServiceCharge === 0 || foodServiceCharge === '0') {
                foodTaxPrice = 0;
              }
              if (serviceCharge === 0 || serviceCharge === '0') {
                serviceTaxPrice = 0;
              }
              if (packageCharge === 0 || packageCharge === '0') {
                packagePrice = 0;
              }
              if (packageChargeTax === 0 || packageChargeTax === '0') {
                packageTaxPrice = 0;
              }
              let discountCharge = 0;
              if (discountType === 'per') {
                discountCharge = parseFloat(
                  (parseFloat(itemTotalPrice).toFixed(2) * parseFloat(discountAmount).toFixed(2)) /
                    100
                ).toFixed(2);
              } else {
                discountCharge = parseFloat(discountAmount).toFixed(2);
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
                  parseFloat(extraCharge)
              ).toFixed(2);
              const grandTotal = parseFloat(
                parseFloat(subTotal) - parseFloat(discountCharge)
              ).toFixed(2);
              const restaurantCommission = orderSettings.posCommission;
              const restaurantTotalEarning = parseFloat(
                parseFloat(itemTotalPrice) + parseFloat(packagePrice) + parseFloat(packageTaxPrice)
              ).toFixed(2);
              const adminCommission = parseFloat(
                (parseFloat(restaurantTotalEarning) * parseFloat(restaurantCommission)) / 100
              ).toFixed(2);
              const orderParam = {
                restaurant: `${restaurant}`,
                paymentMode: `${paymentMode}`,
                foods: serverFoodIds,
                customerType: `${customerType}`,
                customerName: `${customerName}`,
                customerCountryCode: `${customerCountryCode}`,
                customerMobileNumber: `${customerMobileNumber}`,
                cartItemRaw: JSON.stringify(cartItemJSON),
                realTotal: parseFloat(itemRealTotalPrice),
                itemDiscount: parseFloat(itemDiscountPrice),
                itemTotal: parseFloat(itemTotalPrice),
                discountType: `${discountType}`,
                discountAmount: `${discountAmount}`,
                discountCharge: parseFloat(discountCharge),
                foodServiceCharge: parseFloat(foodTaxPrice),
                serviceCharge: parseFloat(serviceTaxPrice),
                packageCharge: parseFloat(packagePrice),
                packageChargeTax: parseFloat(packageTaxPrice),
                extraCharge: parseFloat(extraCharge),
                grandTotal: parseFloat(grandTotal),
                restaurantCommission: adminCommission,
                tableOrder: false,
                orderFrom: 'vendor',
                status: 'completed',
              };

              const order = await posOrTableOrderService.createOrder(orderParam);
              const totalEarning = parseFloat(
                parseFloat(adminCommission) + parseFloat(foodTaxPrice) + parseFloat(serviceTaxPrice)
              ).toFixed(2);
              if (parseFloat(adminCommission) > 0) {
                const commissionParam = {
                  id: order.id,
                  restaurant: `${restaurant}`,
                  orderCommission: adminCommission,
                  commission: restaurantCommission,
                  foodServiceCharge: parseFloat(foodTaxPrice),
                  serviceCharge: parseFloat(serviceTaxPrice),
                  totalEarning: parseFloat(totalEarning),
                };
                await restaurantPosTableOrderCommissionService.savePOSCommission(commissionParam);
              }
              if (parseFloat(orderParam.itemDiscount) > 0) {
                const posProductExpense = {
                  expenseType: `pos_order_product_discount`,
                  restaurant: orderParam.restaurant,
                  coupon: null,
                  diningCoupon: null,
                  diningBooking: null,
                  posOrder: order.id,
                  tableOrder: null,
                  order: null,
                  user: null,
                  amount: orderParam.itemDiscount,
                };
                await restaurantExpenseService.saveExpense(posProductExpense);
              }

              if (parseFloat(orderParam.discountCharge) > 0) {
                const posDiscountExpense = {
                  expenseType: `pos_order_extra_discount`,
                  restaurant: orderParam.restaurant,
                  coupon: null,
                  diningCoupon: null,
                  diningBooking: null,
                  posOrder: order.id,
                  tableOrder: null,
                  order: null,
                  user: null,
                  amount: orderParam.discountCharge,
                };
                await restaurantExpenseService.saveExpense(posDiscountExpense);
              }
              await addonsService.updateAddonStockAfterOrder(addonUpdateData);
              await foodService.updateFooodStockAfterOrder(foodUpdateData);
              await foodService.updateFoodMetaAfterOrder(foodMetaUpdateJson);
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
});

const getPosOrderOfVendor = catchAsync(async (req, res) => {
  const { vendor } = req.params;
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const result = await posOrTableOrderService.getPosOrderOfVendor(vendor, options);
  res.send(result);
});

const adminPosOrderList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await posOrTableOrderService.adminPosOrderList(options);
  res.send(result);
});

const cityzenPosOrderList = catchAsync(async (req, res) => {
  const { master } = req.params;
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'search']);
  const result = await posOrTableOrderService.cityzenPosOrderList(master, options);
  res.send(result);
});

const getPosOrderDetail = catchAsync(async (req, res) => {
  const { id, vendor } = req.params;
  const result = await posOrTableOrderService.getPosOrderDetail(id, vendor);
  res.send(result);
});

const adminPosOrderDetail = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await posOrTableOrderService.adminPosOrderDetail(id);
  res.send(result);
});

const cityzenPosOrderDetail = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await posOrTableOrderService.cityzenPosOrderDetail(id);
  res.send(result);
});

// "FB|RJ|2026|ENVATO|FOODBITE|ECITAW15071997"

const vendorPosBusinessInsight = catchAsync(async (req, res) => {
  const { vendor } = req.params;
  const result = await posOrTableOrderService.vendorPosBusinessInsight(vendor);
  res.send(result);
});

const vendorCustomDatePosOrderBusinessInsight = catchAsync(async (req, res) => {
  const { vendor, startDate, endDate } = req.body;
  const result = await posOrTableOrderService.vendorCustomDatePosOrderBusinessInsight(
    vendor,
    startDate,
    endDate
  );
  res.send(result);
});

const posOrderReport = catchAsync(async (req, res) => {
  const options = pick(req.query, [
    'restaurant',
    'filter',
    'filterDates',
    'limit',
    'page',
    'search',
  ]);
  const result = await posOrTableOrderService.posOrderReport(options);
  res.send(result);
});

const vendorPosOrderList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'limit', 'page']);
  const result = await posOrTableOrderService.vendorPosOrderList(options);
  res.send(result);
});

const adminPOSOrderInvoice = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await posOrTableOrderService.adminPOSOrderInvoice(id);
  res.send(result);
});

const vendorPOSOrderInvoice = catchAsync(async (req, res) => {
  const { id, vendor } = req.params;
  const result = await posOrTableOrderService.vendorPOSOrderInvoice(id, vendor);
  res.send(result);
});

const exportCollection = catchAsync(async (req, res) => {
  const { type, search } = req.query;
  if (type !== 'raw') {
    const result = await posOrTableOrderService.exportCollection(search);
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
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Cities');
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
        { header: 'Order From', key: 'orderFrom' },
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
        'Order From': detail.orderFrom,
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
        Status: detail.status,
      }));

      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await posOrTableOrderService.exportRawCollection(search);
    const downloadPath = path.join(__dirname, `../templates/downloads/posortableorders.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'posortableorders.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportPOSOrderReportCollection = catchAsync(async (req, res) => {
  const options = pick(req.query, ['restaurant', 'filter', 'filterDates', 'search']);
  const { type } = req.query;
  const result = await posOrTableOrderService.exportPOSOrderReportCollection(options);
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
    const worksheet = workbook.addWorksheet('POSOrders');
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
      { header: 'status', key: 'status' },
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
      status: detail.id,
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
              importKeys.length === vendorPOSOrderSchemaKeys.length &&
              importKeys.every((item) => vendorPOSOrderSchemaKeys.includes(item));
            if (validSchema) {
              const result = await posOrTableOrderService.importCollection(records);
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
                    importKeys.length === vendorPOSOrderSchemaKeys.length &&
                    importKeys.every((item) => vendorPOSOrderSchemaKeys.includes(item));
                  if (validSchema) {
                    const result = await posOrTableOrderService.importCollection(records);
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
  vendorPlaceOrder,
  getPosOrderOfVendor,
  adminPosOrderList,
  getPosOrderDetail,
  adminPosOrderDetail,
  vendorPosBusinessInsight,
  vendorCustomDatePosOrderBusinessInsight,
  posOrderReport,
  vendorPosOrderList,
  adminPOSOrderInvoice,
  vendorPOSOrderInvoice,
  cityzenPosOrderList,
  cityzenPosOrderDetail,
  exportCollection,
  exportPOSOrderReportCollection,
  importCollection,
};

