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
const { CartItem, Food } = require('../models');
const ApiError = require('../utils/ApiError');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');

const addToCart = async (param) => {
  const sortAddonIds = param.addons
    .map((id) => new mongoose.Types.ObjectId(id))
    .sort((a, b) => {
      return a.toString().localeCompare(b.toString());
    });
  const sortedOptions = param.variations
    .map((option) => ({
      ...option,
      selected: option.selected.sort(),
    }))
    .sort((a, b) => a.variation.localeCompare(b.variation));
  const exists = await CartItem.findOne({
    trackingId: param.trackingId,
    food: param.food,
    addons: sortAddonIds,
    variations: sortedOptions,
  });
  if (exists) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Item already exist in cart');
  }
  const foodInfoQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(param.food) } },
    { $limit: 1 },
    {
      $lookup: {
        from: 'addons',
        localField: 'addons',
        foreignField: '_id',
        pipeline: [
          { $match: { status: true, inStock: true } },
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
        discountType: 1,
        purchaseLimit: 1,
        variations: 1,
        status: 1,
        inStock: 1,
        addons: 1,
        foodtaxations: 1,
        price: {
          $round: [{ $divide: ['$price', 100] }, 2],
        },
        discount: {
          $round: [{ $divide: ['$discount', 100] }, 2],
        },
        taxationEnable: 1,
        stockType: 1,
        stockNumber: 1,
      },
    },
  ];
  const foodInfo = await Food.aggregate(foodInfoQuery);
  if (!foodInfo[0]) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Something went wrong');
  }
  const foodData = foodInfo[0];
  const addonInFood = [];
  let isAddonOk = false;
  const variationInFood = [];
  let isVariationOK = false;
  if (foodData !== null && foodData.addons !== null && checkArrayNotEmpty(foodData.addons)) {
    foodData.addons.forEach((addonElement) => {
      addonInFood.push(addonElement.id.toString());
    });
  }
  if (checkArrayNotEmpty(addonInFood) && checkArrayNotEmpty(sortAddonIds)) {
    const addonFromParamCheck = sortAddonIds.map((x) => x.toString());
    isAddonOk = addonFromParamCheck.every((item) => addonInFood.includes(item));
  } else {
    isAddonOk = true;
  }
  if (isAddonOk === false) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'One of the addon is not available');
  }
  if (
    foodData !== null &&
    foodData.variations !== null &&
    checkArrayNotEmpty(foodData.variations)
  ) {
    foodData.variations.forEach((variationElement) => {
      if (
        variationElement &&
        variationElement.options &&
        variationElement.options !== null &&
        checkArrayNotEmpty(variationElement.options)
      ) {
        variationElement.options.forEach((variationElementOption) => {
          variationInFood.push(`${variationElement.title}-${variationElementOption.name}`);
        });
      }
    });
  }
  if (checkArrayNotEmpty(variationInFood) && checkArrayNotEmpty(sortedOptions)) {
    const variationFromParamCheck = [];
    sortedOptions.forEach((variationElement) => {
      if (
        variationElement &&
        variationElement.selected &&
        variationElement.selected !== null &&
        checkArrayNotEmpty(variationElement.selected)
      ) {
        variationElement.selected.forEach((variationElementOption) => {
          variationFromParamCheck.push(`${variationElement.variation}-${variationElementOption}`);
        });
      }
    });
    isVariationOK = variationFromParamCheck.every((item) => variationInFood.includes(item));
  } else {
    isVariationOK = true;
  }
  if (isVariationOK === false) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'One of the variation is not available');
  }
  let taxAmount = 0;
  let addonPrice = 0;
  let variationPrice = 0;
  const basePrice = parseFloat(foodData.price);
  let finalPrice = 0;
  if (foodData.taxationEnable) {
    foodData.foodtaxations.forEach((taxPrice) => {
      taxAmount += parseFloat(taxPrice.taxAmount);
    });
    const taxAmountData = basePrice * (taxAmount / 100);
    finalPrice = parseFloat(basePrice + taxAmountData).toFixed(2);
  } else {
    finalPrice = parseFloat(basePrice).toFixed(2);
  }
  if (foodData && foodData.addons && foodData.addons.length > 0) {
    foodData.addons.forEach((element) => {
      const addonFromParamCheck = sortAddonIds.map((x) => x.toString());
      if (addonFromParamCheck.includes(element.id.toString())) {
        addonPrice += parseFloat(element.price);
      }
    });
  }
  if (foodData && foodData.variations && foodData.variations.length > 0) {
    foodData.variations.forEach((foodVariation) => {
      sortedOptions.forEach((savedVariation) => {
        if (foodVariation.title === savedVariation.variation) {
          foodVariation.options.forEach((foodVariationOption) => {
            savedVariation.selected.forEach((savedVariationOption) => {
              if (foodVariationOption.name === savedVariationOption) {
                variationPrice += parseFloat(foodVariationOption.price);
              }
            });
          });
        }
      });
    });
  }
  finalPrice = parseFloat(
    parseFloat(finalPrice) + parseFloat(addonPrice) + parseFloat(variationPrice)
  ).toFixed(2);
  if (foodData.discount > 0) {
    if (foodData.discountType === '%') {
      const discountAmount = parseFloat((finalPrice * foodData.discount) / 100).toFixed(2);
      finalPrice = parseFloat(finalPrice - discountAmount).toFixed(2);
    } else {
      finalPrice = parseFloat(parseFloat(finalPrice) - parseFloat(foodData.discount)).toFixed(2);
    }
  }
  const grandTotal = parseFloat(parseFloat(finalPrice) * parseInt(param.quantity, 10)).toFixed(2);
  const cartData = new CartItem({
    user: param && param.user && param.user !== null && param.user !== '' ? param.user : null,
    trackingId:
      param && param.trackingId && param.trackingId !== null && param.trackingId !== ''
        ? param.trackingId
        : null,
    uuid: param && param.uuid && param.uuid !== null && param.uuid !== '' ? param.uuid : null,
    addons: sortAddonIds,
    food: param && param.food && param.food !== null && param.food !== '' ? param.food : null,
    restaurant:
      param && param.restaurant && param.restaurant !== null && param.restaurant !== ''
        ? param.restaurant
        : null,
    quantity:
      param && param.quantity && param.quantity !== null && param.quantity !== ''
        ? param.quantity
        : 1,
    variations: sortedOptions,
    itemTotal: parseFloat(finalPrice).toFixed(2),
    grandTotal: parseFloat(grandTotal).toFixed(2),
    foodCampaign:
      param &&
      param.campaignId &&
      param.campaignId !== null &&
      param.campaignId !== '' &&
      param.campaignType === 'food'
        ? param.campaignId
        : null,
    restaurantCampaign:
      param &&
      param.campaignId &&
      param.campaignId !== null &&
      param.campaignId !== '' &&
      param.campaignType === 'restaurant'
        ? param.campaignId
        : null,
    cookingInstruction:
      param &&
      param.cookingInstruction &&
      param.cookingInstruction !== null &&
      param.cookingInstruction !== ''
        ? param.cookingInstruction
        : '',
  });
  const itemResponse = await CartItem.create(cartData);
  return itemResponse;
};

const removeCartItemByRestaurant = async (userTracking, restaurantId) => {
  const condition = {
    trackingId: new mongoose.Types.ObjectId(userTracking),
    restaurant: new mongoose.Types.ObjectId(restaurantId),
  };
  await CartItem.deleteMany(condition);
};

const removeCartItemByTrackingId = async (userTracking) => {
  const condition = {
    trackingId: new mongoose.Types.ObjectId(userTracking),
  };
  await CartItem.deleteMany(condition);
};

const removeFromCartWithUuid = async (userTracking, foodUuid, foodId) => {
  const condition = {
    trackingId: new mongoose.Types.ObjectId(userTracking),
    uuid: foodUuid,
    food: new mongoose.Types.ObjectId(foodId),
  };
  await CartItem.deleteOne(condition);
};

const removeFromCartWithFoodId = async (userTracking, foodId) => {
  const condition = {
    trackingId: new mongoose.Types.ObjectId(userTracking),
    food: new mongoose.Types.ObjectId(foodId),
  };
  await CartItem.deleteOne(condition);
};

const updateFoodQuantity = async (userTracking, foodId, newQuantity) => {
  const condition = {
    trackingId: new mongoose.Types.ObjectId(userTracking),
    food: new mongoose.Types.ObjectId(foodId),
  };
  const foodItemInCart = await CartItem.findOne(condition);
  if (!foodItemInCart) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Not found');
  }
  const grandTotal = parseFloat(
    parseFloat(foodItemInCart.itemTotal) * parseInt(newQuantity, 10)
  ).toFixed(2);
  const updateBody = {
    quantity: newQuantity,
    grandTotal: parseFloat(grandTotal).toFixed(2),
  };
  Object.assign(foodItemInCart, updateBody);
  await foodItemInCart.save();
  return foodItemInCart;
};

const updateFoodVariationQuantity = async (userTracking, foodUuid, foodId, newQuantity) => {
  const condition = {
    trackingId: new mongoose.Types.ObjectId(userTracking),
    food: new mongoose.Types.ObjectId(foodId),
    uuid: foodUuid,
  };
  const foodItemInCart = await CartItem.findOne(condition);
  if (!foodItemInCart) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Not found');
  }
  const grandTotal = parseFloat(
    parseFloat(foodItemInCart.itemTotal) * parseInt(newQuantity, 10)
  ).toFixed(2);
  const updateBody = {
    quantity: newQuantity,
    grandTotal: parseFloat(grandTotal).toFixed(2),
  };
  Object.assign(foodItemInCart, updateBody);
  await foodItemInCart.save();
  return foodItemInCart;
};

const getCartItemForCheckout = async (userTracking, restaurantId) => {
  const condition = {
    trackingId: new mongoose.Types.ObjectId(userTracking),
    restaurant: new mongoose.Types.ObjectId(restaurantId),
  };
  const inCartItems = await CartItem.find(condition);
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

const vendorPosOrderFoodInfoForCheckout = async (foodIds) => {
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

const checkBOGOOffer = async (trackingId, restaurant) => {
  const query = [
    {
      $match: {
        trackingId: new mongoose.Types.ObjectId(trackingId),
        restaurant: new mongoose.Types.ObjectId(restaurant),
      },
    },
    {
      $group: {
        _id: null,
        totalQuantity: { $sum: '$quantity' },
      },
    },
  ];
  const quantityItems = await CartItem.aggregate(query);
  if (quantityItems !== null && quantityItems.length > 0 && checkArrayNotEmpty(quantityItems)) {
    const details = quantityItems[0];
    return { quantity: details.totalQuantity };
  }
  return { quantity: 0 };
};

const bulkUpdateBeforeCheckout = async (trackingId, items) => {
  const quantityMap = new Map(items.map((i) => [i.uuid, parseInt(i.quantity, 10)]));
  const cartItems = await CartItem.find({
    trackingId: new mongoose.Types.ObjectId(trackingId),
    uuid: { $in: [...quantityMap.keys()] },
  });
  const bulkOps = cartItems
    .map((item) => {
      const quantity = quantityMap.get(item.uuid);

      if (!quantity || quantity < 1) return null;

      return {
        updateOne: {
          filter: { _id: item._id },
          update: {
            $set: {
              quantity,
              grandTotal: item.itemTotal * quantity, // setter handles cents
            },
          },
        },
      };
    })
    .filter(Boolean);
  await CartItem.bulkWrite(bulkOps);
  return { success: true };
};

module.exports = {
  addToCart,
  removeCartItemByRestaurant,
  removeCartItemByTrackingId,
  removeFromCartWithUuid,
  removeFromCartWithFoodId,
  updateFoodQuantity,
  updateFoodVariationQuantity,
  getCartItemForCheckout,
  vendorPosOrderFoodInfoForCheckout,
  checkBOGOOffer,
  bulkUpdateBeforeCheckout,
};

