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
const mongoose = require('mongoose');
const lodash = require('lodash');
const catchAsync = require('../utils/catchAsync');
const {
  tableOrderCartItemService,
  addonsService,
  foodService,
  orderSettingsService,
  restaurantService,
  tableOrderService,
  restaurantPosTableOrderCommissionService,
  restaurantExpenseService,
} = require('../services');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const addItemToCart = catchAsync(async (req, res) => {
  try {
    const { cartItem, tableId, tableNumber, restaurant, waiter } = req.body;
    const cartItemsRequest = cartItem;
    if (checkArrayNotEmpty(cartItemsRequest)) {
      const savedItemIds = cartItemsRequest.map((item) => item.food.toString());
      let foodIds = lodash.uniq(savedItemIds);
      foodIds = foodIds.map((item) => new mongoose.Types.ObjectId(item));
      const cartItems = await tableOrderCartItemService.waiterGetFoodList(foodIds);
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
          const isAddonThere = savedAddonIds.every((item) => serverAddonIds.includes(item));
          const isVariationThere = savedVariationIds.every((item) =>
            serverVariationIds.includes(item)
          );
          if (itemInStock === true && addonInStock === true && variationInStock === true) {
            if (isAddonThere && isVariationThere) {
              const cartInsertData = [];
              cartItemsRequest.forEach((element) => {
                const addonInItem =
                  element && element.addons && element.addons !== null && element.addons !== ''
                    ? element.addons.split(',')
                    : [];
                const cartObject = {
                  tableId: `${tableId}`,
                  tableNumber: `${tableNumber}`,
                  uuid: element.uuid,
                  addons: addonInItem,
                  food: element.food,
                  restaurant: `${restaurant}`,
                  quantity: element.quantity,
                  variations: element.variations,
                  instruction: element.instruction,
                  waiter: `${waiter}`,
                };
                cartInsertData.push(cartObject);
              });
              await tableOrderCartItemService.addItemToCart(cartInsertData, restaurant, tableId);
              await addonsService.updateAddonStockAfterOrder(addonUpdateData);
              await foodService.updateFooodStockAfterOrder(foodUpdateData);
              res.status(201).send({ success: true });
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

const ongoingTableItems = catchAsync(async (req, res) => {
  const { vendor, tableId } = req.params;
  const result = await tableOrderCartItemService.ongoingTableItems(vendor, tableId);
  res.send(result);
});

const ongoingTableOrder = catchAsync(async (req, res) => {
  const { vendor } = req.params;
  const result = await tableOrderCartItemService.ongoingTableOrder(vendor);
  res.send(result);
});

const vendorOngoingOrderDetail = catchAsync(async (req, res) => {
  const { vendor, tableId } = req.params;
  const result = await tableOrderCartItemService.vendorOngoingOrderDetail(vendor, tableId);
  res.send(result);
});

const vendorDeleteCartItem = catchAsync(async (req, res) => {
  const { id, vendor } = req.params;
  const result = await tableOrderCartItemService.vendorDeleteCartItem(vendor, id);
  res.send(result);
});

const vendorCompleteTableOrder = catchAsync(async (req, res) => {
  const {
    restaurant,
    tableId,
    discountType,
    discountAmount,
    foodServiceCharge,
    serviceCharge,
    packageCharge,
    packageChargeTax,
    extraCharge,
    paymentMode,
    customerType,
    customerName,
    customerCountryCode,
    customerMobileNumber,
  } = req.body;
  const permission = await restaurantService.checkTableOrderPermission(restaurant);
  const orderSettings = await orderSettingsService.getOrderSettingForCheckout(restaurant);
  if (
    permission &&
    permission.tableOrderPermission !== null &&
    permission.tableOrderPermission !== '' &&
    permission.tableOrderPermission === false
  ) {
    res.status(400).send({ code: 400, message: 'Table Order Permission Denied' });
  }
  try {
    const cartItems = await tableOrderCartItemService.getCartItemForCheckout(restaurant, tableId);
    if (checkArrayNotEmpty(cartItems.inCartItems) && checkArrayNotEmpty(cartItems.foodInfoInCart)) {
      if (cartItems.success === true) {
        let itemTotalPrice = 0;
        let itemRealTotalPrice = 0;
        let itemDiscountPrice = 0;
        let foodTaxPrice = 0;
        let serviceTaxPrice = 0;
        let packagePrice = 0;
        let packageTaxPrice = 0;
        const cartItemJSON = [];
        const serverFoodIds = [];
        const foodMetaUpdateJson = [];
        cartItems.foodInfoInCart.forEach((foodInfoElement) => {
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
                    addonInItem = inCartItemElement.addons;
                  }
                  if (checkArrayNotEmpty(addonInItem)) {
                    if (addonInItem.includes(addonElement.id.toString())) {
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
              serverFoodIds.push(foodInfoElement.id);
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
                instruction:
                  inCartItemElement &&
                  inCartItemElement.instruction &&
                  inCartItemElement.instruction !== null &&
                  inCartItemElement.instruction !== ''
                    ? inCartItemElement.instruction
                    : '',
                translations: foodInfoElement.translations,
              });
            }
          });
        });
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
          serviceTaxPrice = parseFloat(orderSettings.business.additionalServiceAmount).toFixed(2);
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
            (parseFloat(itemTotalPrice).toFixed(2) * parseFloat(discountAmount).toFixed(2)) / 100
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
        const grandTotal = parseFloat(parseFloat(subTotal) - parseFloat(discountCharge)).toFixed(2);
        const restaurantCommission = orderSettings.tableOrderCommission;
        const restaurantTotalEarning = parseFloat(
          parseFloat(itemTotalPrice) + parseFloat(packagePrice) + parseFloat(packageTaxPrice)
        ).toFixed(2);
        const adminCommission = parseFloat(
          (parseFloat(restaurantTotalEarning) * parseFloat(restaurantCommission)) / 100
        ).toFixed(2);
        const waiterList = [
          ...new Set(cartItems.inCartItems.map((item) => new mongoose.Types.ObjectId(item.waiter))),
        ];
        const orderParam = {
          restaurant: `${restaurant}`,
          tableNo: tableId,
          foods: serverFoodIds,
          paymentMode: `${paymentMode}`,
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
          waiters: waiterList,
        };
        const totalEarning = parseFloat(
          parseFloat(adminCommission) + parseFloat(foodTaxPrice) + parseFloat(serviceTaxPrice)
        ).toFixed(2);
        const order = await tableOrderService.createOrder(orderParam);
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
          await restaurantPosTableOrderCommissionService.saveTableOrderCommission(commissionParam);
        }
        if (parseFloat(orderParam.itemDiscount) > 0) {
          const tableOrderProductExpense = {
            expenseType: `table_order_product_discount`,
            restaurant: orderParam.restaurant,
            coupon: null,
            diningCoupon: null,
            diningBooking: null,
            posOrder: null,
            tableOrder: order.id,
            order: null,
            user: null,
            amount: orderParam.itemDiscount,
          };
          await restaurantExpenseService.saveExpense(tableOrderProductExpense);
        }
        if (parseFloat(orderParam.discountCharge) > 0) {
          const tableOrderDiscountExpense = {
            expenseType: `table_order_extra_discount`,
            restaurant: orderParam.restaurant,
            coupon: null,
            diningCoupon: null,
            diningBooking: null,
            posOrder: null,
            tableOrder: order.id,
            order: null,
            user: null,
            amount: orderParam.discountCharge,
          };
          await restaurantExpenseService.saveExpense(tableOrderDiscountExpense);
        }
        await foodService.updateFoodMetaAfterOrder(foodMetaUpdateJson);
        await tableOrderCartItemService.clearCartItemAfterCheckout(restaurant, tableId);
        res.status(201).send({ id: order.id, success: true });
      } else {
        res.status(400).send({ code: 400, message: 'One of the food is not available' });
      }
    } else {
      res.status(400).send({ code: 400, message: 'Cart is Empty' });
    }
    // eslint-disable-next-line no-unused-vars
  } catch (error) {
    res.status(400).send({ code: 400, message: 'Something went wrong', extra: '' });
  }
});

const customerAddItemToCart = catchAsync(async (req, res) => {
  try {
    const { cartItem, tableId, restaurant, tableNumber } = req.body;
    const cartItemsRequest = cartItem;
    if (checkArrayNotEmpty(cartItemsRequest)) {
      const savedItemIds = cartItemsRequest.map((item) => item.food.toString());
      let foodIds = lodash.uniq(savedItemIds);
      foodIds = foodIds.map((item) => new mongoose.Types.ObjectId(item));
      const cartItems = await tableOrderCartItemService.waiterGetFoodList(foodIds);
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
          const isAddonThere = savedAddonIds.every((item) => serverAddonIds.includes(item));
          const isVariationThere = savedVariationIds.every((item) =>
            serverVariationIds.includes(item)
          );
          if (itemInStock === true && addonInStock === true && variationInStock === true) {
            if (isAddonThere && isVariationThere) {
              const cartInsertData = [];
              cartItemsRequest.forEach((element) => {
                const addonInItem =
                  element && element.addons && element.addons !== null && element.addons !== ''
                    ? element.addons.split(',')
                    : [];
                const cartObject = {
                  tableId: `${tableId}`,
                  tableNumber: `${tableNumber}`,
                  uuid: element.uuid,
                  addons: addonInItem,
                  food: element.food,
                  restaurant: `${restaurant}`,
                  quantity: element.quantity,
                  variations: element.variations,
                  instruction: element.instruction,
                  waiter: null,
                };
                cartInsertData.push(cartObject);
              });
              await tableOrderCartItemService.addItemToCart(cartInsertData, restaurant, tableId);
              await addonsService.updateAddonStockAfterOrder(addonUpdateData);
              await foodService.updateFooodStockAfterOrder(foodUpdateData);
              res.status(201).send({ success: true });
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

module.exports = {
  addItemToCart,
  ongoingTableItems,
  ongoingTableOrder,
  vendorOngoingOrderDetail,
  vendorDeleteCartItem,
  vendorCompleteTableOrder,
  customerAddItemToCart,
};

