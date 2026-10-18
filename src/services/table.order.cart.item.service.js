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
const {
  Food,
  TableOrderCartItem,
  RestaurantTable,
  BusinessSettings,
  RestaurantSettings,
  Restaurant,
  KitchenOrder,
} = require('../models');
const orderSettingService = require('./order.settings.service');
const fcmNotificationService = require('./fcm.notification.service');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const getCartItemForCheckout = async (vendor, tableId) => {
  const condition = {
    restaurant: new mongoose.Types.ObjectId(vendor),
    tableId: new mongoose.Types.ObjectId(tableId),
  };
  const inCartItems = await TableOrderCartItem.find(condition);
  const savedItemIds = inCartItems.map((item) => item.food.toString());
  let foodIds = lodash.uniq(savedItemIds);
  foodIds = foodIds.map((item) => new mongoose.Types.ObjectId(item));
  const foodItemListQuery = [
    {
      $match: {
        _id: {
          $in: foodIds,
        },
      },
    },
    {
      $lookup: {
        from: 'addons',
        localField: 'addons',
        foreignField: '_id',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              name: 1,
              inStock: 1,
              stockType: 1,
              stockNumber: 1,
              price: {
                $round: [{ $divide: ['$price', 100] }, 2],
              },
              translations: 1,
              status: 1,
            },
          },
        ],
        as: 'addons',
      },
    },
    {
      $lookup: {
        from: 'foodtaxations',
        localField: 'foodTax',
        foreignField: '_id',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              taxName: 1,
              taxAmount: {
                $round: [{ $divide: ['$taxAmount', 100] }, 2],
              },
              translations: 1,
            },
          },
        ],
        as: 'foodtaxations',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        shortDescription: 1,
        image: 1,
        restaurant: 1,
        foodType: 1,
        startTime: 1,
        endTime: 1,
        discountType: 1,
        purchaseLimit: 1,
        variations: 1,
        translations: 1,
        addons: 1,
        foodtaxations: 1,
        status: 1,
        inStock: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        isFavourite: 1,
        taxationEnable: 1,
        stockType: 1,
        stockNumber: 1,
      },
    },
  ];
  const foodInfoInCart = await Food.aggregate(foodItemListQuery);
  if (checkArrayNotEmpty(foodInfoInCart)) {
    return Promise.all([inCartItems, foodInfoInCart]).then(() => {
      const serverFoodIds = foodInfoInCart.map((item) => item.id.toString());
      const result = {
        inCartItems,
        foodInfoInCart,
        success: serverFoodIds.length === foodIds.length,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const addItemToCart = async (param, restaurant, tableId) => {
  await TableOrderCartItem.insertMany(param);
  const restaurantInfo = await Restaurant.findById(restaurant);
  if (
    restaurantInfo &&
    restaurantInfo !== null &&
    restaurantInfo.id &&
    restaurantInfo.id !== null &&
    restaurantInfo.id !== ''
  ) {
    let ownKitchen = false;
    if (
      restaurantInfo !== null &&
      restaurantInfo.type === 'derived' &&
      restaurantInfo.isOutlet === true &&
      restaurantInfo.outletManagerId !== null
    ) {
      const outletManager = await Restaurant.findById(restaurantInfo.outletManagerId);
      if (outletManager !== null && outletManager.id !== null) {
        ownKitchen = outletManager.ownKitchen;
      }
    } else {
      ownKitchen = restaurantInfo.ownKitchen;
    }
    if (ownKitchen === true || ownKitchen === 'true') {
      const orderSettings = await orderSettingService.getOrderSettingForCheckout(restaurant);
      const cartItems = await getCartItemForCheckout(restaurant, tableId);
      if (
        checkArrayNotEmpty(cartItems.inCartItems) &&
        checkArrayNotEmpty(cartItems.foodInfoInCart)
      ) {
        if (cartItems.success === true) {
          const cartItemJSON = [];
          cartItems.foodInfoInCart.forEach((foodInfoElement) => {
            cartItems.inCartItems.forEach((inCartItemElement) => {
              if (foodInfoElement.id.toString() === inCartItemElement.food.toString()) {
                const cartAddonJSON = [];
                const cartVariationJSON = [];
                const basePrice = Number(parseFloat(foodInfoElement.price).toFixed(2));
                let finalPrice = 0;
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
          const kitchenOrder = new KitchenOrder({
            orderFrom: 'table_order',
            restaurant: `${restaurant}`,
            regularOrder: null,
            posOrder: null,
            tableId: `${tableId}`,
            cartItemRaw: JSON.stringify(cartItemJSON),
            cookingInstruction: '',
            status: 'new',
          });
          await KitchenOrder.create(kitchenOrder);
          await fcmNotificationService.kitchenOwnerNewOrder('table_order', restaurant);
        }
      }
    }
  }
};

const waiterGetFoodList = async (foodIds) => {
  const foodItemListQuery = [
    {
      $match: {
        _id: {
          $in: foodIds,
        },
      },
    },
    {
      $lookup: {
        from: 'addons',
        localField: 'addons',
        foreignField: '_id',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              name: 1,
              inStock: 1,
              stockType: 1,
              stockNumber: 1,
              price: {
                $round: [{ $divide: ['$price', 100] }, 2],
              },
              translations: 1,
              status: 1,
            },
          },
        ],
        as: 'addons',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        name: 1,
        variations: 1,
        addons: 1,
        status: 1,
        inStock: 1,
        stockType: 1,
        stockNumber: 1,
      },
    },
  ];
  const foodInfoInCart = await Food.aggregate(foodItemListQuery);
  if (checkArrayNotEmpty(foodInfoInCart)) {
    return Promise.all([foodInfoInCart]).then(() => {
      const serverFoodIds = foodInfoInCart.map((item) => item.id.toString());
      const result = {
        foodInfoInCart,
        success: serverFoodIds.length === foodIds.length,
      };
      return Promise.resolve(result);
    });
  }
  return { success: false };
};

const ongoingTableItems = async (vendor, tableId) => {
  const itemQuery = [
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        tableId: new mongoose.Types.ObjectId(tableId),
      },
    },
    {
      $lookup: {
        from: 'foods',
        localField: 'food',
        foreignField: '_id',
        as: 'foods',
      },
    },
    {
      $lookup: {
        from: 'addons',
        localField: 'addons',
        foreignField: '_id',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              name: 1,
              price: {
                $round: [{ $divide: ['$price', 100] }, 2],
              },
              translations: 1,
            },
          },
        ],
        as: 'addons',
      },
    },
    {
      $unwind: {
        path: '$foods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'foodtaxations',
        localField: 'foods.foodTax',
        foreignField: '_id',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              taxAmount: {
                $round: [{ $divide: ['$taxAmount', 100] }, 2],
              },
            },
          },
        ],
        as: 'foodtaxations',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        uuid: 1,
        instruction: 1,
        quantity: 1,
        food: 1,
        variations: 1,
        addons: 1,
        foodtaxations: 1,
        foodInfo: {
          id: { $ifNull: ['$foods._id', ''] },
          name: { $ifNull: ['$foods.name', ''] },
          discountType: { $ifNull: ['$foods.discountType', ''] },
          foodVariations: { $ifNull: ['$foods.variations', []] },
          taxationEnable: { $ifNull: ['$foods.taxationEnable', false] },
          foodType: { $ifNull: ['$foods.foodType', ''] },
          price: {
            $round: [{ $divide: ['$foods.price', 100] }, 2],
          },
          discount: {
            $round: [{ $divide: ['$foods.discount', 100] }, 2],
          },
          translations: { $ifNull: ['$foods.translations', []] },
        },
      },
    },
  ];
  const items = await TableOrderCartItem.aggregate(itemQuery);
  return { items, success: true };
};

const ongoingTableOrder = async (vendor) => {
  const tableQuery = [
    {
      $match: { restaurant: new mongoose.Types.ObjectId(vendor), status: true },
    },
    {
      $lookup: {
        from: 'tableordercartitems',
        localField: '_id',
        foreignField: 'tableId',
        as: 'tableordercartitems',
      },
    },
    {
      $addFields: {
        occupied: {
          $cond: {
            if: { $eq: [{ $size: '$tableordercartitems' }, 0] },
            then: false,
            else: true,
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        tableNumber: 1,
        occupied: '$occupied',
      },
    },
  ];
  const tables = await RestaurantTable.aggregate(tableQuery);
  return { tables, success: true };
};

const vendorOngoingOrderDetail = async (vendor, tableId) => {
  const itemQuery = [
    {
      $match: {
        restaurant: new mongoose.Types.ObjectId(vendor),
        tableId: new mongoose.Types.ObjectId(tableId),
      },
    },
    {
      $lookup: {
        from: 'foods',
        localField: 'food',
        foreignField: '_id',
        as: 'foods',
      },
    },
    {
      $lookup: {
        from: 'addons',
        localField: 'addons',
        foreignField: '_id',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              name: 1,
              price: {
                $round: [{ $divide: ['$price', 100] }, 2],
              },
              translations: 1,
            },
          },
        ],
        as: 'addons',
      },
    },
    {
      $unwind: {
        path: '$foods',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'foodtaxations',
        localField: 'foods.foodTax',
        foreignField: '_id',
        pipeline: [
          {
            $project: {
              _id: 0,
              id: '$_id',
              taxAmount: {
                $round: [{ $divide: ['$taxAmount', 100] }, 2],
              },
            },
          },
        ],
        as: 'foodtaxations',
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        uuid: 1,
        instruction: 1,
        quantity: 1,
        food: 1,
        variations: 1,
        addons: 1,
        foodtaxations: 1,
        foodInfo: {
          id: { $ifNull: ['$foods._id', ''] },
          name: { $ifNull: ['$foods.name', ''] },
          discountType: { $ifNull: ['$foods.discountType', ''] },
          foodVariations: { $ifNull: ['$foods.variations', []] },
          taxationEnable: { $ifNull: ['$foods.taxationEnable', false] },
          foodType: { $ifNull: ['$foods.foodType', ''] },
          price: {
            $round: [{ $divide: ['$foods.price', 100] }, 2],
          },
          discount: {
            $round: [{ $divide: ['$foods.discount', 100] }, 2],
          },
          translations: { $ifNull: ['$foods.translations', []] },
        },
      },
    },
  ];
  const items = await TableOrderCartItem.aggregate(itemQuery);
  const businessSettings = await BusinessSettings.findOne(
    {},
    {
      includeTaxOnFood: 1,
      foodTaxName: 1,
      foodTaxAmount: 1,
      foodTaxType: 1,
      additionalServiceCharge: 1,
      additionalServiceName: 1,
      additionalServiceAmount: 1,
    }
  );
  const restaurantSettings = await RestaurantSettings.findOne(
    {},
    {
      havePackagingCharges: 1,
      packagingCharges: 1,
      includePackagesChargesInTax: 1,
      packagingChargesTax: 1,
    }
  );
  return Promise.all([items, businessSettings, restaurantSettings]).then(() => {
    const result = {
      items,
      business: businessSettings,
      packaging: restaurantSettings,
      success: true,
    };
    return Promise.resolve(result);
  });
};

const vendorDeleteCartItem = async (vendor, id) => {
  const item = await TableOrderCartItem.findOne({
    _id: new mongoose.Types.ObjectId(id),
    restaurant: new mongoose.Types.ObjectId(vendor),
  });
  if (!item) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Cart Item not found');
  }
  await item.deleteOne();
  return { success: true };
};

const clearCartItemAfterCheckout = async (vendor, tableId) => {
  const condition = {
    restaurant: new mongoose.Types.ObjectId(vendor),
    tableId: new mongoose.Types.ObjectId(tableId),
  };
  await TableOrderCartItem.deleteMany(condition);
};

module.exports = {
  addItemToCart,
  waiterGetFoodList,
  ongoingTableItems,
  ongoingTableOrder,
  vendorOngoingOrderDetail,
  vendorDeleteCartItem,
  getCartItemForCheckout,
  clearCartItemAfterCheckout,
};

