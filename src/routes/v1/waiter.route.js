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

const express = require('express');
const appAuth = require('../../middlewares/appAuth');
const validate = require('../../middlewares/validate');

const WaiterValidation = require('../../validations/waiter.validation');
const RestaurantTableValidation = require('../../validations/restaurant.table.validation');
const TableOrderCartItemValidation = require('../../validations/table.order.cart.item.validation');
const AuthValidation = require('../../validations/auth.validation');
const UserNotificationSettingValidation = require('../../validations/user.notification.setting.validation');
const UserValidation = require('../../validations/user.validation');

const FoodController = require('../../controllers/food.controller');
const RestaurantTableController = require('../../controllers/restaurant.table.controller');
const WaiterController = require('../../controllers/waiter.controller');
const TableOrderCartItemController = require('../../controllers/table.order.cart.item.controller');
const AuthController = require('../../controllers/auth.controller');
const UserNotificationSettingController = require('../../controllers/user.notification.setting.controller');
const UserController = require('../../controllers/user.controller');
const UserDeleteAccountReasonController = require('../../controllers/user.delete.account.reason.controller');

const router = express.Router();

router.get(
  '/profile/user/:id',
  appAuth('waiter_profile'),
  validate(AuthValidation.profileValidation),
  AuthController.getMyProfile
);
router.patch(
  '/profile/update/:id',
  appAuth('update_waiter_profile'),
  validate(AuthValidation.updateProfileValidation),
  AuthController.updateMyProfile
);
router.get(
  '/foods/foodList/:restaurant',
  appAuth('foodList'),
  validate(WaiterValidation.foodListValidation),
  FoodController.getRestaurantFoodFromWaiter
);
router.get(
  '/restaurant/tableList/:vendor',
  appAuth('restaurantTableList'),
  validate(RestaurantTableValidation.waiterTableListValidation),
  RestaurantTableController.waiterTableList
);
router.get(
  '/foodListForOrder/:vendor',
  appAuth('waiterFoodListForOrders'),
  validate(WaiterValidation.foodListForOrderValidation),
  WaiterController.waiterFoodList
);
router.get(
  '/waiterInitialFoodSearch/:vendor',
  appAuth('waiterInitialFoodSearch'),
  validate(WaiterValidation.waiterInitialFoodValidation),
  WaiterController.waiterFoodSearchInitialData
);
router.get(
  '/waiterFoodSearch/:vendor/:searchQuery',
  appAuth('waiterFoodSearch'),
  validate(WaiterValidation.waiterFoodSearchValidation),
  WaiterController.waiterFoodSearch
);
router.post(
  '/addItemToCart/',
  appAuth('addItemToCart'),
  validate(TableOrderCartItemValidation.addItemToCartValidation),
  TableOrderCartItemController.addItemToCart
);
router.get(
  '/ongoingTableOrder/:vendor/:tableId',
  appAuth('ongoingTableOrder'),
  validate(TableOrderCartItemValidation.ongoingTableItemValidation),
  TableOrderCartItemController.ongoingTableItems
);

// Account Settings Routes//
router.patch(
  '/account_setting/update_password/:id',
  appAuth('update_password'),
  validate(UserValidation.updatePasswordValidation),
  UserController.updatePassword
);
router.patch(
  '/account_setting/update_email/:id',
  appAuth('update_email'),
  validate(UserValidation.updateEmailValidation),
  UserController.updateEmail
);
router.patch(
  '/account_setting/update_email_after_verification/:id',
  appAuth('update_email'),
  validate(UserValidation.updateEmailAfterVerificationValidation),
  UserController.updateEmailAfterVerification
);
router.patch(
  '/account_setting/update_mobile_number/:id',
  appAuth('update_mobile_number'),
  validate(UserValidation.updateMobileValidation),
  UserController.updateMobileNumber
);
router.patch(
  '/account_setting/update_mobile_number_after_verification/:id',
  appAuth('update_mobile_number'),
  validate(UserValidation.updateMobileAfterVerificationValidation),
  UserController.updateMobileAfterVerification
);
router.patch(
  '/account_setting/update_mobile_number_after_firebase_verification/:id',
  appAuth('update_mobile_number'),
  validate(UserValidation.updateMobileAfterFirebaseVerificationValidation),
  UserController.updateMobileAfterFirebaseVerification
);
router.get(
  '/account_setting/notification_setting/:id',
  appAuth('notification_setting'),
  validate(UserNotificationSettingValidation.idValidation),
  UserNotificationSettingController.getNotificationSettings
);
router.patch(
  '/account_setting/notification_setting/:id',
  appAuth('notification_setting'),
  validate(UserNotificationSettingValidation.updateSettingValidation),
  UserNotificationSettingController.updateNotificationSetting
);
router.get(
  '/delete_account_reason_list',
  appAuth('delete_account_reason_list'),
  UserDeleteAccountReasonController.geWaiterActiveReason
);
router.post(
  '/account_setting/delete_account',
  appAuth('delete_account'),
  validate(UserValidation.deleteUserAccountValidation),
  UserController.waiterDeleteAccount
);
router.patch(
  '/account_setting/update_locale/',
  appAuth('update_locale'),
  validate(UserValidation.updateLocaleValidation),
  UserController.updateUserLocale
);
// Account Settings Routes//

module.exports = router;

