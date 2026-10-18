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

const UserValidation = require('../../validations/user.validation');
const UserNotificationSettingValidation = require('../../validations/user.notification.setting.validation');
const FoodValidation = require('../../validations/food.validation');
const KitchenOwnerValidation = require('../../validations/kitchen.owner.validation');

const UserController = require('../../controllers/user.controller');
const UserNotificationSettingController = require('../../controllers/user.notification.setting.controller');
const UserDeleteAccountReasonController = require('../../controllers/user.delete.account.reason.controller');
const FoodController = require('../../controllers/food.controller');
const KitchenOwnerController = require('../../controllers/kitchen.owner.controller');
const NotificationListController = require('../../controllers/notification.list.controller');

const router = express.Router();

// Kitchen Profile Routes //
router.get(
  '/profile/me/:uid',
  appAuth('kitchen_owner_detail'),
  validate(UserValidation.getKitchenOwnerProfileValidation),
  UserController.kitchenOwnerProfile
);
router.patch(
  '/profile/update/:id',
  appAuth('update_kitchen_owner_detail'),
  validate(UserValidation.updateKitchenOwnerValidation),
  UserController.updateKitchenOwnerProfile
);
// Kitchen Profile Routes //

// Foods Routes //
router.get(
  '/food_list/:id',
  appAuth('food_list'),
  validate(FoodValidation.kitchenOwnerFoodListValidation),
  FoodController.kitchenOwnerFoodList
);
router.get(
  '/foods/kitchen_food_detail/:id/:owner',
  appAuth('kitchen_food_detail'),
  validate(FoodValidation.kitchenOwnerFoodDetailValidation),
  FoodController.kitchenOwnerFoodDetail
);
router.patch(
  '/foods/update_meta_detail/:foodId',
  appAuth('update_food'),
  validate(FoodValidation.idValidation),
  FoodController.updateMetaInfo
);
router.get(
  '/foods/addon_list/:owner',
  appAuth('kitchen_food_detail'),
  validate(FoodValidation.kitchenOwnerAddonValidation),
  FoodController.kitchenOwnerAddonList
);
router.patch(
  '/foods/update/:id/:owner',
  appAuth('update_food'),
  validate(FoodValidation.kitchenUpdateStockValidation),
  FoodController.kitchenOwnerUpdateFood
);
// Foods Routes //

// Orders Routes //
router.post(
  '/orders/list',
  appAuth('order_list'),
  validate(KitchenOwnerValidation.kitchenOrderValidation),
  KitchenOwnerController.kitchenOrder
);
router.patch(
  '/orders/prepare/:order/:owner',
  appAuth('prepare_order'),
  validate(KitchenOwnerValidation.prepareKitchenOrderValidation),
  KitchenOwnerController.preparingKitchenOrder
);
router.patch(
  '/orders/complete/:order/:owner',
  appAuth('complete_order'),
  validate(KitchenOwnerValidation.completeKitchenOrderValidation),
  KitchenOwnerController.completeKitchenOrder
);
router.get(
  '/orders/order_detail/:order/:owner',
  appAuth('kitchen_order_detail'),
  validate(KitchenOwnerValidation.kitchenOrderDetailValidation),
  KitchenOwnerController.kitchenOrderDetail
);
// Orders Routes //

// Account Settings Routes//
router.patch(
  '/account_setting/update_password/:id',
  appAuth('update_password'),
  validate(UserValidation.updatePasswordValidation),
  UserController.updatePassword
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
  '/delete_account_reason_list',
  appAuth('delete_account_reason_list'),
  UserDeleteAccountReasonController.getKitchenActionReason
);
router.post(
  '/account_setting/delete_account',
  appAuth('delete_account'),
  validate(UserValidation.deleteUserAccountValidation),
  UserController.kitchenDeleteAccount
);
router.patch(
  '/account_setting/update_locale/',
  appAuth('update_locale'),
  validate(UserValidation.updateLocaleValidation),
  UserController.updateUserLocale
);
// Account Settings Routes//

// Notification Routes //
router.post(
  '/notification/list/',
  appAuth('notification_list'),
  validate(UserValidation.notificationListValidation),
  NotificationListController.getMyNotificationList
);
router.get(
  '/notification/readAll/:user',
  appAuth('mark_all_read'),
  validate(UserValidation.idValidation),
  NotificationListController.readAllNotification
);
// Notification Routes //

module.exports = router;

