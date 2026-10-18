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
const webAuth = require('../../middlewares/webAuth');
const validate = require('../../middlewares/validate');

const CountryValidation = require('../../validations/country.validation');
const CityValidation = require('../../validations/city.validation');
const LocalityValidation = require('../../validations/locality.validation');
const CuisineValidation = require('../../validations/cuisine.validation');
const FileValidation = require('../../validations/file.validation');
const LanguageValidation = require('../../validations/language.validation');
const SubscriptionValidation = require('../../validations/subscription.validation');
const RestaurantTypeValidation = require('../../validations/restaurant.type.validation');
const RestaurantValidation = require('../../validations/restaurant.validation');
const CategoryValidation = require('../../validations/category.validation');
const SubCategoryValidation = require('../../validations/sub.category.validation');
const VehicleValidation = require('../../validations/vehicle.validation');
const DriverValidation = require('../../validations/driver.validation');
const DeliveryShiftScheduleValidation = require('../../validations/deliveryman.shift.schedule.validation');
const RestaurantCampaignValidation = require('../../validations/restaurant.campaign.validation');
const SubscriberValidation = require('../../validations/subscriber.validation');
const FoodCampaignValidation = require('../../validations/food.campaign.validation');
const AddonsValidation = require('../../validations/addons.validation');
const FoodValidation = require('../../validations/food.validation');
const VendorSubCategoryValidation = require('../../validations/vendor.sub.category.validation');
const BusinessSettingValidation = require('../../validations/business.settings.validation');
const OrderCancellationReasonValidation = require('../../validations/order.cancellation.reason.validation');
const OrderSettingsValidation = require('../../validations/order.setting.validation');
const RefundRequestReasonValidation = require('../../validations/refund.request.reason.validation');
const UserSettingsValidation = require('../../validations/user.settings.validation');
const RestaurantSettingsValidation = require('../../validations/restaurant.settings.validation');
const DriverSettingsValidation = require('../../validations/driver.settings.validation');
const DairySettingsValidation = require('../../validations/dairy.settings.validation');
const JhatkaSettingsValidation = require('../../validations/jhatka.settings.validation');
const DisbursementValidation = require('../../validations/disbursement.validation');
const AppPageValidation = require('../../validations/app.pages.validation');
const RestaurantCampaignRequestValidation = require('../../validations/restaurant.campaign.request.validation');
const FoodCampaignRequestValidation = require('../../validations/food.campaign.request.validation');
const BannersValidation = require('../../validations/banner.validation');
const AppWebSettingValidation = require('../../validations/app.web.settings.validation');
const EmailConfigValidation = require('../../validations/email.config.validation');
const EmailTemplateValidation = require('../../validations/email.templates.validation');
const RestaurantFoodLicenseValidation = require('../../validations/restaurant.food.license.validation');
const PaymentConfigValidation = require('../../validations/payment.config.validation');
const DeliveryInstructionValidation = require('../../validations/delivery.instruction.validation');
const DeliveryGratitudeValidation = require('../../validations/delivery.gratitude.validation');
const DeliveryConfigValidation = require('../../validations/delivery.config.validation');
const DeliveryZoneValidation = require('../../validations/delivery.zone.validation');
const CouponValidation = require('../../validations/coupon.validation');
const UserValidation = require('../../validations/user.validation');
const DriverIncentiveValidation = require('../../validations/driver.incentive.validation');
const DriverOfflineMessagesValidation = require('../../validations/driver.offline.messages.validation');
const OrderNotificationTranslationValidation = require('../../validations/order.notification.translation.validation');
const OrdersValidation = require('../../validations/orders.validation');
const RefundRequestValidation = require('../../validations/refund.request.validation');
const ComplaintsReasonValidation = require('../../validations/complaints.reason.validation');
const SmsProviderConfigValidation = require('../../validations/sms.provider.config.validation');
const ReportIssueRestaurantReasonValidation = require('../../validations/report.issue.restaurant.reason.validation');
const HideRestaurantReasonValidation = require('../../validations/hide.restaurant.reason.validation');
const OrderRatingMessageValidation = require('../../validations/order.ratings.message.validation');
const RestaurantNoticeValidation = require('../../validations/restaurant.notice.validation');
const SubscriptionTiffinPackageValidation = require('../../validations/subscription.tiffin.packages.validation');
const UserPurchasedTiffinSubscriptionValidation = require('../../validations/user.purchased.tiffin.subscriptions.validation');
const TiffinSubscriptionCancellationReasonValidation = require('../../validations/tiffin.subscription.cancellation.reason.validation');
const TiffinSubscriptionRefundRequestReasonValidation = require('../../validations/tiffin.subscription.refund.request.reason.validation');
const TiffinSubscriptionRefundRequestValidation = require('../../validations/tiffin.subscription.refund.request.validation');
const DiningSettingValidation = require('../../validations/dining.settings.validation');
const DiningCancellationReasonValidation = require('../../validations/dining.cancellation.reason.validation');
const DiningCategoryValidation = require('../../validations/dining.category.validation');
const DiningNoticeValidation = require('../../validations/dining.notice.validation');
const DiningCampaignValidation = require('../../validations/dining.campaign.validation');
const DiningCampaignRequestValidation = require('../../validations/dining.campaign.request.validation');
const RestaurantFacilitiesValidation = require('../../validations/restaurant.facilities.validation');
const DiningCouponValidation = require('../../validations/dining.coupon.validation');
const DiningBookingRefundRequestReasonValidation = require('../../validations/dining.booking.refund.request.reason.validation');
const DiningBookingRefundRequestValidation = require('../../validations/dining.booking.refund.request.validation');
const DiningBookingValidation = require('../../validations/dining.booking.validation');
const FeedbackFormValidation = require('../../validations/feedback.form.validation');
const ReportEmergencyValidation = require('../../validations/report.emergency.form.validation');
const UserAvatarValidation = require('../../validations/user.avatar.validation');
const SocialSignInValidation = require('../../validations/social.signin.validation');
const WaiterValidation = require('../../validations/waiter.validation');
const WaiterSettingValidation = require('../../validations/waiter.setting.validation');
const KitchenOwnerSettingValidation = require('../../validations/kitchen.owner.setting.validation');
const FoodTaxationValidation = require('../../validations/food.taxation.validation');
const CollectCashValidation = require('../../validations/collect.cash.validation');
const WithdrawalMethodValidation = require('../../validations/withdrawal.method.validation');
const WithdrawalRequestValidation = require('../../validations/withdrawal.request.validation');
const JoiningFormValidation = require('../../validations/joining.form.validation');
const RestaurantJoiningRequestValidation = require('../../validations/restaurant.joining.request.validation');
const DeliverymanJoiningRequestValidation = require('../../validations/deliveryman.joining.request.validation');
const InvoiceInstructionValidation = require('../../validations/invoice.instruction.validation');
const WalletBonusValidation = require('../../validations/wallet.bonus.validation');
const WalletValidation = require('../../validations/wallet.validation');
const PosOrTableOrderValidation = require('../../validations/pos.or.table.order.validation');
const TableOrderValidation = require('../../validations/table.order.validation');
const AdminExpenseValidation = require('../../validations/admin.expense.validation');
const AuthValidation = require('../../validations/auth.validation');
const UserAccountDeleteReasonValidation = require('../../validations/user.account.delete.reason.validation');
const KitchenOwnerValidation = require('../../validations/kitchen.owner.validation');
const ChatRoomValidation = require('../../validations/chat.room.validation');
const MediaStorageSettingValidation = require('../../validations/media.storage.setting.validation');
const LandingPageValidation = require('../../validations/landing.page.validation');

const CountryController = require('../../controllers/country.controller');
const CityController = require('../../controllers/city.controller');
const LocalityController = require('../../controllers/locality.controller');
const DeliveryZoneController = require('../../controllers/delivery.zone.controller');
const DispatchController = require('../../controllers/dispatch.controller');
const DispatchMetricsValidation = require('../../validations/dispatch.metrics.validation');
const CuisineController = require('../../controllers/cuisine.controller');
const MediaController = require('../../controllers/media.controller');
const LangaugeController = require('../../controllers/language.controller');
const SubscriptionController = require('../../controllers/subscription.controller');
const RestaurantTypeController = require('../../controllers/restaurant.type.controller');
const RestaurantController = require('../../controllers/restaurant.controller');
const CategoryController = require('../../controllers/category.controller');
const SubCategoryController = require('../../controllers/sub.category.controller');
const VehicleController = require('../../controllers/vehicle.controller');
const DriverController = require('../../controllers/driver.controller');
const DeliveryShiftScheduleController = require('../../controllers/deliveryman.shift.schedule.controller');
const RestaurantCampaignController = require('../../controllers/restaurant.campaign.controller');
const SubscriberController = require('../../controllers/subscriber.controller');
const FoodCampaignController = require('../../controllers/food.campaign.controller');
const AddonsController = require('../../controllers/addons.controller');
const FoodController = require('../../controllers/food.controller');
const VendorSubCategoryController = require('../../controllers/vendor.sub.category.controller');
const BusinessSettingController = require('../../controllers/business.settings.controller');
const OrderCancellationReasonController = require('../../controllers/order.cancellation.reason.controller');
const OrderSettingsController = require('../../controllers/order.settings.controller');
const RefundRequestReasonController = require('../../controllers/refund.request.reason.controller');
const UserSettingsController = require('../../controllers/user.settings.controller');
const RestaurantSettingsController = require('../../controllers/restaurant.settings.controller');
const DriverSettingsController = require('../../controllers/driver.settings.controller');
const DairySettingsController = require('../../controllers/dairy.settings.controller');
const JhatkaSettingsController = require('../../controllers/jhatka.settings.controller');
const DisbursementController = require('../../controllers/disbursement.controller');
const AppPageController = require('../../controllers/app.pages.controller');
const RestaurantCampaignRequestController = require('../../controllers/restaurant.campaign.request.controller');
const FoodCampaignRequestController = require('../../controllers/food.campaign.request.controller');
const BannersController = require('../../controllers/banners.controller');
const AppWebSettingController = require('../../controllers/app.web.setting.controller');
const EmailConfigController = require('../../controllers/email.config.controller');
const EmailTemplateController = require('../../controllers/email.templates.controller');
const RestaurantFoodLicenseController = require('../../controllers/restaurant.food.license.controller');
const PaymentConfigController = require('../../controllers/payment.config.controller');
const DeliveryInstructionController = require('../../controllers/delivery.instructions.controller');
const DeliveryGratitudeController = require('../../controllers/delivery.gratitude.controller');
const CouponController = require('../../controllers/coupon.controller');
const UserController = require('../../controllers/user.controller');
const DriverIncentiveController = require('../../controllers/driver.incentive.controller');
const DriverOfflineMessagesController = require('../../controllers/driver.offline.messages.controller');
const OrderNotificationTranslationController = require('../../controllers/order.notification.translation.controller');
const OrdersController = require('../../controllers/orders.controller');
const RefundRequestController = require('../../controllers/refund.request.controller');
const ComplaintsReasonController = require('../../controllers/complaints.reason.controller');
const ComplaintsController = require('../../controllers/complaints.controller');
const SmsProviderConfigController = require('../../controllers/sms.provider.config.controller');
const ReportIssueRestaurantReasonController = require('../../controllers/report.issue.restaurant.reason.controller');
const ReportIssueRestaurantController = require('../../controllers/report.issue.restaurant.controller');
const HideRestaurantReasonController = require('../../controllers/hide.restaurant.reason.controller');
const HideRestaurantController = require('../../controllers/hide.restaurant.controller');
const OrderRatingMessageController = require('../../controllers/order.ratings.message.controller');
const RestaurantNoticeController = require('../../controllers/restaurant.notice.controller');
const SubscriptionTiffinPackageController = require('../../controllers/subscription.tiffin.package.controller');
const CronJobSchedulerController = require('../../controllers/cron.job.scheduler.controller');
const UserPurchasedTiffinSubscriptionController = require('../../controllers/user.purchased.tiffin.subscription.controller');
const TiffinSubscriptionCancellationReasonController = require('../../controllers/tiffin.subscription.cacellation.reason.controller');
const TiffinSubscriptionRefundRequestReasonController = require('../../controllers/tiffin.subscription.refund.request.reason.controller');
const TiffinSubscriptionRefundRequestController = require('../../controllers/tiffin.subscription.refund.request.controller');
const DiningSettingController = require('../../controllers/dining.settings.controller');
const DiningCancellationReasonController = require('../../controllers/dining.cancellation.reason.controller');
const DiningCategoryController = require('../../controllers/dining.category.controller');
const DiningNoticeController = require('../../controllers/dining.notice.controller');
const DiningCampaignController = require('../../controllers/dining.campaign.controller');
const DiningCampaignRequestController = require('../../controllers/dining.campaign.request.controller');
const RestaurantFacilitiesController = require('../../controllers/restaurant.facilities.controller');
const DiningCouponController = require('../../controllers/dining.coupon.controller');
const DiningBookingRefundRequestReasonController = require('../../controllers/dining.booking.refund.request.reason.controller');
const DiningBookingRefundRequestController = require('../../controllers/dining.booking.refund.request.controller');
const DiningBookingController = require('../../controllers/dining.booking.controller');
const FeedbackFormController = require('../../controllers/feedback.form.controller');
const ReportEmergencyController = require('../../controllers/report.emergency.form.controller');
const UserAvatarController = require('../../controllers/user.avatar.controller');
const SocialSignInController = require('../../controllers/social.signin.controller');
const RestaurantComplaintsController = require('../../controllers/restaurant.complaints.controller');
const WaiterController = require('../../controllers/waiter.controller');
const WaiterSettingController = require('../../controllers/waiter.settings.controller');
const KitchenOwnerSettingController = require('../../controllers/kitchen.owner.setting.controller');
const FoodTaxationController = require('../../controllers/food.taxation.controller');
const CollectCashController = require('../../controllers/collect.cash.controller');
const WithdrawalMethodController = require('../../controllers/withdrawal.method.controller');
const WithdrawalRequestController = require('../../controllers/withdrawal.request.controller');
const JoiningFormController = require('../../controllers/joining.form.controller');
const RestaurantJoiningRequestController = require('../../controllers/restaurant.joining.request.controller');
const DeliverymanJoiningRequestController = require('../../controllers/deliveryman.joining.request.controller');
const InvoiceInstructionController = require('../../controllers/invoice.instruction.controller');
const WalletBonusController = require('../../controllers/wallet.bonus.controller');
const LoyaltyPointsController = require('../../controllers/loyalty.points.controller');
const WalletController = require('../../controllers/wallet.controller');
const PosOrTableOrderController = require('../../controllers/pos.or.table.order.controller');
const TableOrderController = require('../../controllers/table.order.controller');
const PaymentInitiationController = require('../../controllers/payment.initiation.controller');
const AdminExpenseController = require('../../controllers/admin.expense.controller');
const UserAddressController = require('../../controllers/user.address.controller');
const FavouriteController = require('../../controllers/favourite.controller');
const ReviewRatingController = require('../../controllers/review.ratings.controller');
const RestaurantPayoutMethodController = require('../../controllers/restaurant.payout.method.controller');
const DeliverymanPayoutMethodController = require('../../controllers/deliveryman.payout.method.controller');
const AuthController = require('../../controllers/auth.controller');
const UserDeleteAccountReasonController = require('../../controllers/user.delete.account.reason.controller');
const KitchenOwnerController = require('../../controllers/kitchen.owner.controller');
const FcmController = require('../../controllers/fcm.notification.controller');
const NotificationListController = require('../../controllers/notification.list.controller');
const ChatRoomController = require('../../controllers/chat.room.controller');
const SupportChatRoomController = require('../../controllers/support.chat.room.controller');
const MediaStorageSettingController = require('../../controllers/media.storage.setting.controller');
const LandingPageController = require('../../controllers/landing.page.controller');

const router = express.Router();

router.get(
  '/web_guard/:id',
  webAuth('web_guard'),
  validate(UserValidation.webGuardValidation),
  UserController.adminProfile
);

// Country Routes //
router.get('/dashboard', webAuth('dashboard'), OrdersController.adminDashboard);
router.post(
  '/country/save',
  webAuth('createCountry'),
  validate(CountryValidation.createCountry),
  CountryController.create
);
router.get('/country/getAll', webAuth('getCountries'), CountryController.get);
router.patch(
  '/country/update/:countryId',
  webAuth('updateCountry'),
  validate(CountryValidation.idValidation),
  CountryController.update
);
router.delete(
  '/country/delete/:countryId',
  webAuth('deleteCountry'),
  validate(CountryValidation.idValidation),
  CountryController.drop
);
// Country Routes //

// City Routes //
router.post(
  '/cities/save',
  webAuth('createCity'),
  validate(CityValidation.createCity),
  CityController.create
);
router.get(
  '/cities/getAll',
  webAuth('getCities'),
  validate(CityValidation.getAllCities),
  CityController.get
);
router.get('/cities/listAllCities', webAuth('getCities'), CityController.getAll);
router.patch(
  '/cities/update/:cityId',
  webAuth('updateCity'),
  validate(CityValidation.idValidation),
  CityController.update
);
router.patch(
  '/cities/updateStatus/:cityId',
  webAuth('updateCity'),
  validate(CityValidation.idValidation),
  CityController.updateStatus
);
router.delete(
  '/cities/delete/:cityId',
  webAuth('deleteCity'),
  validate(CityValidation.idValidation),
  CityController.drop
);

router.get(
  '/cities/map_dialog/:city',
  webAuth('getCities'),
  validate(RestaurantValidation.cityMapDialogValidation),
  RestaurantController.cityMapDialogData
);
// City Routes //

// Locality Routes //
router.post(
  '/localities/save',
  webAuth('createLocality'),
  validate(LocalityValidation.createLocality),
  LocalityController.create
);
router.get(
  '/localities/getAll',
  webAuth('getLocalities'),
  validate(LocalityValidation.allValidation),
  LocalityController.get
);
router.get(
  '/localities/getByCityId/:cityId',
  webAuth('getLocalities'),
  validate(CityValidation.idValidation),
  LocalityController.getByCityId
);
router.patch(
  '/localities/update/:localityId',
  webAuth('updateLocality'),
  validate(LocalityValidation.idValidation),
  LocalityController.update
);
router.patch(
  '/localities/updateStatus/:localityId',
  webAuth('updateLocality'),
  validate(LocalityValidation.idValidation),
  LocalityController.updateStatus
);
router.delete(
  '/localities/deleteLocality/:localityId',
  webAuth('deleteLocality'),
  validate(LocalityValidation.idValidation),
  LocalityController.drop
);
// Delivery zones (Batch B-2): named locality groups per city. Read/propose
// under the locality get right; publish/move under the update right —
// grouping is locality stewardship, so no new role is needed.
router.get(
  '/delivery-zones/by-city/:cityId',
  webAuth('getLocalities'),
  validate(DeliveryZoneValidation.cityZones),
  DeliveryZoneController.listByCity
);
router.get(
  '/delivery-zones/propose/:cityId',
  webAuth('getLocalities'),
  validate(DeliveryZoneValidation.proposeZones),
  DeliveryZoneController.propose
);
router.post(
  '/delivery-zones/publish/:cityId',
  webAuth('updateLocality'),
  validate(DeliveryZoneValidation.publishZones),
  DeliveryZoneController.publish
);
router.patch(
  '/delivery-zones/move/:localityId',
  webAuth('updateLocality'),
  validate(DeliveryZoneValidation.moveLocality),
  DeliveryZoneController.move
);
// Dispatch observability (Batch E-2): read-only dashboards over the audit
// trail. No writes, no side effects — safe for pollers.
router.get(
  '/dispatch/metrics',
  webAuth('getAllRestaurant'),
  validate(DispatchMetricsValidation.metricsQuery),
  DispatchController.getMetrics
);
router.get(
  '/delivery-zones/metrics/:cityId',
  webAuth('getLocalities'),
  validate(DispatchMetricsValidation.zoneMetricsParams),
  DispatchController.getZoneMetrics
);
router.get(
  '/delivery-zones/ungrouped/:cityId',
  webAuth('getLocalities'),
  validate(DispatchMetricsValidation.zoneMetricsParams),
  DispatchController.getUngrouped
);
// Locality Routes //

// Cuisine Routes //
router.post(
  '/cuisine/save',
  webAuth('createCuisine'),
  validate(CuisineValidation.createCuisine),
  CuisineController.create
);
router.get(
  '/cuisine/getAll',
  webAuth('getCuisines'),
  validate(CuisineValidation.allValidation),
  CuisineController.get
);
router.get('/cuisine/listAllCuisine', webAuth('getCuisines'), CuisineController.getAll);
router.patch(
  '/cuisine/update/:cuisineId',
  webAuth('updateCuisine'),
  validate(CuisineValidation.idValidation),
  CuisineController.update
);
router.patch(
  '/cuisine/updateStatus/:cuisineId',
  webAuth('updateCuisine'),
  validate(CuisineValidation.idValidation),
  CuisineController.updateStatus
);
router.delete(
  '/cuisine/delete/:cuisineId',
  webAuth('deleteCuisine'),
  validate(CuisineValidation.idValidation),
  CuisineController.drop
);
// Cuisine Routes //

// Files Routes //
router.delete(
  '/files/delete/:path',
  webAuth('deleteFile'),
  validate(FileValidation.pathValidation),
  MediaController.drop
);
// Files Routes //

// Language Routes //
router.post(
  '/language/save',
  webAuth('createLanguage'),
  validate(LanguageValidation.createLanguage),
  LangaugeController.create
);
router.get(
  '/language/getAll',
  webAuth('getLanguage'),
  validate(LanguageValidation.allValidation),
  LangaugeController.get
);
router.patch(
  '/language/update/:languageId',
  webAuth('updateLanguage'),
  validate(LanguageValidation.idValidation),
  LangaugeController.update
);
router.patch(
  '/language/updateDefault/:languageId',
  webAuth('updateDefault'),
  validate(LanguageValidation.idValidation),
  LangaugeController.updateDefault
);
router.delete(
  '/language/delete/:languageId',
  webAuth('deleteLanguage'),
  validate(LanguageValidation.idValidation),
  LangaugeController.drop
);
// Language Routes //

// Subscriptions Routes //
router.post(
  '/subscription/save',
  webAuth('createSubscription'),
  validate(SubscriptionValidation.createSubscription),
  SubscriptionController.create
);
router.get(
  '/subscription/getAll',
  webAuth('getSubscriptions'),
  validate(SubscriptionValidation.allValidation),
  SubscriptionController.getAdminSubscriptionList
);
router.get(
  '/subscription/get/:subscriptionId',
  webAuth('subscriptionGetById'),
  validate(SubscriptionValidation.idValidation),
  SubscriptionController.getById
);
router.patch(
  '/subscription/update/:subscriptionId',
  webAuth('updateSubscription'),
  validate(SubscriptionValidation.idValidation),
  SubscriptionController.update
);
router.patch(
  '/subscription/updateStatus/:subscriptionId',
  webAuth('updateSubscription'),
  validate(SubscriptionValidation.idValidation),
  SubscriptionController.updateStatus
);
router.delete(
  '/subscription/delete/:subscriptionId',
  webAuth('deleteSubscription'),
  validate(SubscriptionValidation.idValidation),
  SubscriptionController.drop
);
// Subscriptions Routes //

// Restaurant Type Routes //
router.post(
  '/restaurantType/save',
  webAuth('createRestaurantType'),
  validate(RestaurantTypeValidation.createRestaurantType),
  RestaurantTypeController.create
);
router.get(
  '/restaurantType/getAll',
  webAuth('getRestaurantType'),
  validate(RestaurantTypeValidation.allValidation),
  RestaurantTypeController.get
);
router.patch(
  '/restaurantType/update/:id',
  webAuth('updateRestaurantType'),
  validate(RestaurantTypeValidation.idValidation),
  RestaurantTypeController.update
);
router.patch(
  '/restaurantType/updateStatus/:id',
  webAuth('updateRestaurantType'),
  validate(RestaurantTypeValidation.idValidation),
  RestaurantTypeController.updateStatus
);
router.delete(
  '/restaurantType/delete/:id',
  webAuth('deleteRestaurantType'),
  validate(RestaurantTypeValidation.idValidation),
  RestaurantTypeController.drop
);
// Restaurant Type Routes //

// Restaurant Routes //
router.post(
  '/restaurant/save',
  webAuth('createRestaurant'),
  validate(RestaurantValidation.createVendor),
  RestaurantController.registerVendorAccount
);
router.get(
  '/restaurant/getBasicDataForNewRestaurant',
  webAuth('createRestaurant'),
  RestaurantController.getBasicDataForNewRestaurant
);
router.get(
  '/restaurant/getAll',
  webAuth('getAllRestaurant'),
  validate(RestaurantValidation.allValidation),
  RestaurantController.get
);
router.get(
  '/restaurant/getOutlets',
  webAuth('getAllRestaurant'),
  validate(RestaurantValidation.allValidation),
  RestaurantController.getOutlets
);
router.patch(
  '/restaurant/updateStatus/:restaurantId',
  webAuth('updateRestaurant'),
  validate(RestaurantValidation.idValidation),
  RestaurantController.updateStatus
);
router.get(
  '/restaurant/getById/:restaurantId',
  webAuth('getRestaurantById'),
  validate(RestaurantValidation.idValidation),
  RestaurantController.getById
);
router.patch(
  '/restaurant/update/:restaurantId',
  webAuth('updateRestaurant'),
  validate(RestaurantValidation.idValidation),
  RestaurantController.update
);
// Delivery coverage (Batch B-2): the Settings screen's override/reset API.
// Any subset of deliveryConfig fields plus optional clearKeys[] to restore
// inheritance per field. Same handler serves city-masters via cityzen.route.
router.patch(
  '/restaurant/delivery-config/:restaurantId',
  webAuth('updateRestaurant'),
  validate(DeliveryConfigValidation.deliveryConfigPatch),
  RestaurantController.updateDeliveryConfigHandler
);
// Effective policy read model (Batch B-3): values + sources for the screen.
router.get(
  '/restaurant/delivery-config/:restaurantId',
  webAuth('getRestaurantById'),
  validate(DeliveryConfigValidation.deliveryConfigParams),
  RestaurantController.getDeliveryConfigHandler
);
router.get(
  '/restaurant/getRestaurantByCityId/:cityId',
  webAuth('getRestaurantByCity'),
  validate(RestaurantValidation.cityIdValidation),
  RestaurantController.getRestaurantByCityId
);
router.get(
  '/restaurant/getRestaurantByCityIdLimitedData/:cityId',
  webAuth('getRestaurantByCity'),
  validate(RestaurantValidation.restaurantByCityIdLimitedDetailsValidation),
  RestaurantController.getRestaurantsByCityIdLimitedDetailsForAdmin
);
router.get(
  '/restaurant/getRestaurantByCityIdForTiffinPackages/:cityId',
  webAuth('getRestaurantByCity'),
  validate(RestaurantValidation.restaurantByCityIdLimitedDetailsValidation),
  RestaurantController.getRestaurantsByCityIdForTiffinPackagesAdmin
);
router.get(
  '/restaurant/getDiningSupportedRestaurantByCityId/:cityId',
  webAuth('getRestaurantByCity'),
  validate(RestaurantValidation.restaurantByCityIdLimitedDetailsValidation),
  RestaurantController.getDiningSupportedRestaurantByCityId
);
router.get(
  '/restaurant/map_dialog/:city',
  webAuth('getRestaurantByCity'),
  validate(RestaurantValidation.cityMapDialogValidation),
  RestaurantController.cityMapDialogRestaurants
);
router.get(
  '/restaurant/filter/:kind/:id',
  webAuth('getAllRestaurant'),
  validate(RestaurantValidation.filterValidation),
  RestaurantController.filterRestaurantList
);
router.get(
  '/restaurant/filter_data',
  webAuth('getAllRestaurant'),
  RestaurantController.filterQueryData
);
router.post(
  '/restaurant/filter_restaurant',
  webAuth('getAllRestaurant'),
  validate(RestaurantValidation.filterQueryValidation),
  RestaurantController.filterQuery
);
// Restaurant Routes //

// Category Routes //
router.post(
  '/category/save',
  webAuth('createCategory'),
  validate(CategoryValidation.createCategory),
  CategoryController.create
);
router.get(
  '/category/getAll',
  webAuth('getCategories'),
  validate(CategoryValidation.allValidation),
  CategoryController.get
);
router.get('/category/getCategoryList', webAuth('getCategories'), CategoryController.getAll);
router.patch(
  '/category/update/:categoryId',
  webAuth('updateCategory'),
  validate(CategoryValidation.idValidation),
  CategoryController.update
);
router.delete(
  '/category/delete/:categoryId',
  webAuth('deleteCategory'),
  validate(CategoryValidation.idValidation),
  CategoryController.drop
);
// Category Routes //

// Sub Category Routes //
router.post(
  '/subCategory/save',
  webAuth('createSubCategory'),
  validate(SubCategoryValidation.createSubCategory),
  SubCategoryController.create
);
router.get(
  '/subCategory/getAll',
  webAuth('getSubCategories'),
  validate(SubCategoryValidation.allValidation),
  SubCategoryController.get
);
router.patch(
  '/subCategory/update/:subCategoryId',
  webAuth('updateSubCategory'),
  validate(SubCategoryValidation.idValidation),
  SubCategoryController.update
);
router.delete(
  '/subCategory/delete/:subCategoryId',
  webAuth('deleteSubCategory'),
  validate(SubCategoryValidation.idValidation),
  SubCategoryController.drop
);
router.get(
  '/sub_category/getActive',
  webAuth('getActiveSubCategory'),
  SubCategoryController.getActive
);
router.get(
  '/sub_category/getByCategoryId/:category',
  webAuth('getActiveSubCategory'),
  SubCategoryController.getActiveByCategoryId
);

router.get(
  '/vendor_sub_category/getActiveByCategoryId/:category/:restaurant',
  webAuth('getVendorSubCategories'),
  validate(VendorSubCategoryValidation.mySubCategoryByCateIdValidation),
  VendorSubCategoryController.getAllSubCategoryById
);
// Sub Category Routes //

// Vehicle Routes //
router.post(
  '/vehicle/save',
  webAuth('createVehicle'),
  validate(VehicleValidation.createVehicle),
  VehicleController.create
);
router.get(
  '/vehicle/getAll',
  webAuth('getVehicle'),
  validate(VehicleValidation.allValidation),
  VehicleController.get
);
router.patch(
  '/vehicle/update/:vehicleId',
  webAuth('updateVehicle'),
  validate(VehicleValidation.idValidation),
  VehicleController.update
);
router.delete(
  '/vehicle/delete/:vehicleId',
  webAuth('updateVehicle'),
  validate(VehicleValidation.idValidation),
  VehicleController.drop
);
// Vehicle Routes //

// Driver Routes //
router.post(
  '/driver/save',
  webAuth('createDriver'),
  validate(DriverValidation.createDriver),
  DriverController.registerDriverAccount
);
router.get('/driver/getBasicData', webAuth('createDriver'), DriverController.getBasicData);
router.get(
  '/driver/getAll',
  webAuth('getDrivers'),
  validate(DriverValidation.allValidation),
  DriverController.get
);
router.get(
  '/driver/getAllVendorDeliveryman',
  webAuth('getDrivers'),
  validate(DriverValidation.allValidation),
  DriverController.getAllVendorDriverList
);
router.patch(
  '/driver/updateStatus/:driverId',
  webAuth('updateDriver'),
  validate(DriverValidation.idValidation),
  DriverController.updateStatus
);
router.get(
  '/driver/getById/:driverId',
  webAuth('getDriverById'),
  validate(DriverValidation.idValidation),
  DriverController.getById
);
router.patch(
  '/driver/update/:driverId',
  webAuth('updateDriver'),
  validate(DriverValidation.idValidation),
  DriverController.update
);
router.get(
  '/driver/getByCity/:city',
  webAuth('getDrivers'),
  validate(DriverValidation.driverByCityValidation),
  DriverController.getDeliverymanFromCity
);
router.get(
  '/driver/walletFundList',
  webAuth('walletFundList'),
  DriverController.deliverymanWalletFundList
);
router.get(
  '/driver/map_dialog/:city',
  webAuth('getDrivers'),
  validate(DriverValidation.driverByCityValidation),
  DriverController.cityMapDialogDeliveryman
);
// Driver Routes //

// Delivery Shift Schedule Routes //
router.post(
  '/deliveryShiftSchedule/save',
  webAuth('createDeliveryShiftSchedule'),
  validate(DeliveryShiftScheduleValidation.createScheduleValidation),
  DeliveryShiftScheduleController.create
);
router.get(
  '/deliveryShiftSchedule/get',
  webAuth('getDeliveryShiftSchedule'),
  validate(DeliveryShiftScheduleValidation.allValidation),
  DeliveryShiftScheduleController.get
);
router.patch(
  '/deliveryShiftSchedule/update/:id',
  webAuth('updateDeliveryShift'),
  validate(DeliveryShiftScheduleValidation.idValidation),
  DeliveryShiftScheduleController.update
);
router.delete(
  '/deliveryShiftSchedule/delete/:id',
  webAuth('deleteDeliveryShift'),
  validate(DeliveryShiftScheduleValidation.idValidation),
  DeliveryShiftScheduleController.drop
);
// Delivery Shift Schedule Routes //

// Restaurant Campaign Routes //
router.post(
  '/restaurant_campaign/save',
  webAuth('createRestaurantCampaign'),
  validate(RestaurantCampaignValidation.createRestaurantCampaign),
  RestaurantCampaignController.create
);
router.get(
  '/restaurant_campaign/getAll',
  webAuth('getRestaurantCampaigns'),
  validate(RestaurantCampaignValidation.allValidation),
  RestaurantCampaignController.get
);
router.get(
  '/restaurant_campaign/getBasicData',
  webAuth('createRestaurantCampaign'),
  RestaurantCampaignController.getBasicData
);
router.get(
  '/restaurant_campaign/getById/:campaignId',
  webAuth('getRestaurantCampaignById'),
  validate(RestaurantCampaignValidation.idValidation),
  RestaurantCampaignController.getById
);
router.patch(
  '/restaurant_campaign/update/:campaignId',
  webAuth('updateRestaurantCampaign'),
  validate(RestaurantCampaignValidation.idValidation),
  RestaurantCampaignController.update
);
router.patch(
  '/restaurant_campaign/updateStatus/:campaignId',
  webAuth('updateRestaurantCampaign'),
  validate(RestaurantCampaignValidation.idValidation),
  RestaurantCampaignController.updateStatus
);
router.delete(
  '/restaurant_campaign/delete/:campaignId',
  webAuth('deleteRestaurantCampaign'),
  validate(RestaurantCampaignValidation.idValidation),
  RestaurantCampaignController.drop
);
router.get(
  '/restaurant_campaign/getRestaurantByCityId/:cityId',
  webAuth('createRestaurantCampaign'),
  validate(RestaurantCampaignValidation.cityIdValidation),
  RestaurantCampaignController.getRestaurantByCityId
);
router.get(
  '/restaurant_campaign/detail/:id',
  webAuth('campaignDetail'),
  validate(RestaurantCampaignValidation.detailValidation),
  RestaurantCampaignController.detail
);
// Restaurant Campaign Routes //

// Food Campaign Routes //
router.post(
  '/food_campaign/save',
  webAuth('createFoodCampaign'),
  validate(FoodCampaignValidation.createFoodCampaign),
  FoodCampaignController.create
);
router.get(
  '/food_campaign/getAll',
  webAuth('getFoodCampaign'),
  validate(FoodCampaignValidation.allValidation),
  FoodCampaignController.get
);
router.patch(
  '/food_campaign/updateStatus/:campaignId',
  webAuth('updateFoodCampaign'),
  validate(FoodCampaignValidation.idValidation),
  FoodCampaignController.updateStatus
);
router.delete(
  '/food_campaign/delete/:campaignId',
  webAuth('deleteFoodCampaign'),
  validate(FoodCampaignValidation.idValidation),
  FoodCampaignController.drop
);
router.get(
  '/food_campaign/getBasicData',
  webAuth('createFoodCampaign'),
  FoodCampaignController.getBasicData
);
router.get(
  '/food_campaign/getRestaurantByCityId/:cityId',
  webAuth('createFoodCampaign'),
  validate(FoodCampaignValidation.cityIdValidation),
  FoodCampaignController.getRestaurantByCityId
);
router.get(
  '/food_campaign/getFoodByRestaurant/:restaurantId',
  webAuth('createFoodCampaign'),
  validate(FoodCampaignValidation.restaurantIdValidation),
  FoodCampaignController.getFoodByRestaurantId
);
router.get(
  '/food_campaign/getById/:campaignId',
  webAuth('getFoodCampaignById'),
  validate(FoodCampaignValidation.idValidation),
  FoodCampaignController.getById
);
router.patch(
  '/food_campaign/update/:campaignId',
  webAuth('updateFoodCampaign'),
  validate(FoodCampaignValidation.idValidation),
  FoodCampaignController.update
);
router.get(
  '/food_campaign/detail/:id',
  webAuth('campaignDetail'),
  validate(FoodCampaignValidation.detailValidation),
  FoodCampaignController.detail
);
// Food Campaign Routes //

// Media Routes //
router.get('/medias/getAll', webAuth('getMedias'), MediaController.get);
router.get('/medias/getMediaList', webAuth('getMediaList'), MediaController.getMediaListAdmin);
// Media Routes //

// Subscriber Routes //
router.post(
  '/subscriber/save',
  webAuth('createSubscriber'),
  validate(SubscriberValidation.createSubscriber),
  SubscriberController.create
);
router.get(
  '/subscriber/getAll',
  webAuth('getSubscriberList'),
  validate(SubscriberValidation.allValidation),
  SubscriberController.get
);
router.post(
  '/subscriber/extend_dates',
  webAuth('extendSubscription'),
  validate(SubscriberValidation.extendValidation),
  SubscriberController.extendSubscriptionDate
);
// Subscriber Routes //

// Addons Routes //
router.post(
  '/addons/save',
  webAuth('createAddons'),
  validate(AddonsValidation.createAddons),
  AddonsController.create
);
router.get(
  '/addons/getAll',
  webAuth('getAllAddons'),
  validate(AddonsValidation.allValidation),
  AddonsController.get
);
router.patch(
  '/addons/update/:addonId',
  webAuth('updateAddons'),
  validate(AddonsValidation.idValidation),
  AddonsController.update
);
router.delete(
  '/addons/delete/:addonId',
  webAuth('deleteAddons'),
  validate(AddonsValidation.idValidation),
  AddonsController.drop
);
// Addons Routes //

// Foods Routes //
router.get(
  '/foods/getAll',
  webAuth('getAllFoods'),
  validate(FoodValidation.allValidation),
  FoodController.adminFoodList
);
router.patch(
  '/foods/updateMetaInfo/:foodId',
  webAuth('updateFood'),
  validate(FoodValidation.idValidation),
  FoodController.updateMetaInfo
);
router.delete(
  '/foods/delete/:foodId',
  webAuth('deleteFood'),
  validate(FoodValidation.idValidation),
  FoodController.drop
);
router.get(
  '/foods/getFoodInfo/:foodId',
  webAuth('getFoodDetails'),
  validate(FoodValidation.idValidation),
  FoodController.getFoodInfoForAdmin
);
router.patch(
  '/foods/update/:foodId',
  webAuth('updateFood'),
  validate(FoodValidation.idValidation),
  FoodController.update
);
router.get(
  '/food/getRestaurantByCityId/:cityId',
  webAuth('createFood'),
  validate(RestaurantCampaignValidation.cityIdValidation),
  RestaurantCampaignController.getRestaurantByCityId
);
router.get(
  '/foods/getBasicData/:restaurant',
  webAuth('createFood'),
  validate(FoodValidation.myFoodValidation),
  FoodController.getBasicData
);
router.post(
  '/foods/save',
  webAuth('createFood'),
  validate(FoodValidation.createFood),
  FoodController.create
);
router.get(
  '/food/getFoodsByCity/:cityId',
  webAuth('getFoodsByCity'),
  validate(FoodValidation.cityValidation),
  FoodController.getFoodByCity
);
router.get(
  '/foods/detail/:foodId',
  webAuth('getFoodDetails'),
  validate(FoodValidation.idValidation),
  FoodController.adminFoodDetail
);
// Foods Routes //

// Business Settings Routes //
router.post(
  '/business_settings/save',
  webAuth('createBusinessSettings'),
  validate(BusinessSettingValidation.createSettings),
  BusinessSettingController.create
);
router.patch(
  '/business_settings/update/:businessId',
  webAuth('updateBusinessSettings'),
  validate(BusinessSettingValidation.idValidation),
  BusinessSettingController.update
);
router.get('/business_settings/get', webAuth('getSettings'), BusinessSettingController.get);
// Business Settings Routes //

// Social Sign In Route //
router.get('/social_signin/getList', webAuth('getSocialSignIn'), SocialSignInController.getList);
router.post(
  '/social_signin/save',
  webAuth('createSocialSignIn'),
  validate(SocialSignInValidation.createOrUpdateSocialSignin),
  SocialSignInController.create
);
router.patch(
  '/social_signin/update/:id',
  webAuth('updateSocialSignIn'),
  validate(SocialSignInValidation.idValidation),
  SocialSignInController.update
);
// Social Sign In Route //

// Order Settings Routes //
router.post(
  '/order_settings/save',
  webAuth('createOrderSettings'),
  validate(OrderSettingsValidation.createOrderSettings),
  OrderSettingsController.create
);
router.get('/order_settings/get', webAuth('getOrderSettingsInfo'), OrderSettingsController.get);
router.patch(
  '/order_settings/update/:settingId',
  webAuth('updateOrderSettings'),
  validate(OrderSettingsValidation.idValidation),
  OrderSettingsController.update
);
// Order Settings Routes //

// Order Cancellation Reason Routes //
router.get(
  '/order_cancel_reason/getAll',
  webAuth('getOrderCancelReason'),
  validate(OrderCancellationReasonValidation.allValidation),
  OrderCancellationReasonController.get
);
router.post(
  '/order_cancel_reason/save',
  webAuth('createOrderCancelReason'),
  validate(OrderCancellationReasonValidation.createCancellationReason),
  OrderCancellationReasonController.create
);
router.patch(
  '/order_cancel_reason/update/:reasonId',
  webAuth('updateOrderCancelReason'),
  validate(OrderCancellationReasonValidation.idValidation),
  OrderCancellationReasonController.update
);
router.delete(
  '/order_cancel_reason/delete/:reasonId',
  webAuth('deletetOrderCancelReason'),
  validate(OrderCancellationReasonValidation.idValidation),
  OrderCancellationReasonController.drop
);
// Order Cancellation Reason Routes //

// Refund Request Reason Routes //
router.get(
  '/refund_request_reason/getAll',
  webAuth('getRefundRequestReason'),
  validate(RefundRequestReasonValidation.allValidation),
  RefundRequestReasonController.get
);
router.post(
  '/refund_request_reason/save',
  webAuth('createRefundRequestReason'),
  validate(RefundRequestReasonValidation.createRefundRequestReason),
  RefundRequestReasonController.create
);
router.patch(
  '/refund_request_reason/update/:reasonId',
  webAuth('updateRefundRequestReason'),
  validate(RefundRequestReasonValidation.idValidation),
  RefundRequestReasonController.update
);
router.delete(
  '/refund_request_reason/delete/:reasonId',
  webAuth('deleteRefundRequestReason'),
  validate(RefundRequestReasonValidation.idValidation),
  RefundRequestReasonController.drop
);
// Refund Request Reason Routes //

// User Settings Routes //
router.get('/user_settings/get', webAuth('getUserSettings'), UserSettingsController.get);
router.post(
  '/user_settings/save',
  webAuth('createUserSettings'),
  validate(UserSettingsValidation.createSettings),
  UserSettingsController.create
);
router.patch(
  '/user_settings/update/:settingId',
  webAuth('updateUserSettings'),
  validate(UserSettingsValidation.idValidation),
  UserSettingsController.update
);
// User Settings Routes //

// Restaurant Settings Routes //
router.get(
  '/restaurant_settings/get',
  webAuth('getRestaurantSettings'),
  RestaurantSettingsController.get
);
router.post(
  '/restaurant_settings/save',
  webAuth('createRestaurantSettings'),
  validate(RestaurantSettingsValidation.createSettings),
  RestaurantSettingsController.create
);
router.patch(
  '/restaurant_settings/update/:settingId',
  webAuth('updateRestaurantSettings'),
  validate(RestaurantSettingsValidation.idValidation),
  RestaurantSettingsController.update
);
// Restaurant Settings Routes //

// Driver Settings Routes //
router.get('/driver_settings/get', webAuth('getDriverSettings'), DriverSettingsController.get);
router.post(
  '/driver_settings/save',
  webAuth('createDriverSettings'),
  validate(DriverSettingsValidation.createSettings),
  DriverSettingsController.create
);
router.patch(
  '/driver_settings/update/:settingId',
  webAuth('updateDriverSettings'),
  validate(DriverSettingsValidation.idValidation),
  DriverSettingsController.update
);
// Driver Settings Routes //

// Dairy Settings Routes //
router.get('/dairy_settings/get', webAuth('getDairySettings'), DairySettingsController.get);
router.post(
  '/dairy_settings/save',
  webAuth('createDairySettings'),
  validate(DairySettingsValidation.createSettings),
  DairySettingsController.create
);
router.patch(
  '/dairy_settings/update/:settingId',
  webAuth('updateDairySettings'),
  validate(DairySettingsValidation.updateSettings),
  DairySettingsController.update
);

// Jhatka Settings Routes //
router.get('/jhatka_settings/get', webAuth('getJhatkaSettings'), JhatkaSettingsController.get);
router.post(
  '/jhatka_settings/save',
  webAuth('createJhatkaSettings'),
  validate(JhatkaSettingsValidation.createSettings),
  JhatkaSettingsController.create
);
router.patch(
  '/jhatka_settings/update/:settingId',
  webAuth('updateJhatkaSettings'),
  validate(JhatkaSettingsValidation.updateSettings),
  JhatkaSettingsController.update
);

// Disbursement Setting Routes //
router.get(
  '/disbursement_settings/get',
  webAuth('getDisbursementSettings'),
  DisbursementController.get
);
router.post(
  '/disbursement_settings/save',
  webAuth('createDisbursementSettings'),
  validate(DisbursementValidation.createDisbursement),
  DisbursementController.create
);
router.patch(
  '/disbursement_settings/update/:disbursementId',
  webAuth('updateDisbursementSettings'),
  validate(DisbursementValidation.idValidation),
  DisbursementController.update
);
// Disbursement Setting Routes //

// App Page Route //
router.get(
  '/app_pages/get/:slug',
  webAuth('getPageInfo'),
  validate(AppPageValidation.idValidation),
  AppPageController.get
);
router.post(
  '/app_pages/save',
  webAuth('createPageInfo'),
  validate(AppPageValidation.createOrUpdatePage),
  AppPageController.create
);
router.patch(
  '/app_pages/update/:slug',
  webAuth('updatePageInfo'),
  validate(AppPageValidation.idValidation),
  AppPageController.update
);
// App Page Route //

// Restaurant Campaign Routes //
router.get(
  '/restaurant_campaign_request/get/:campaignId',
  webAuth('getRestaurantCampaignRequest'),
  validate(RestaurantCampaignRequestValidation.idValidation),
  RestaurantCampaignRequestController.get
);

router.get(
  '/restaurant_campaign_request/accept/:campaignId/:restaurantId',
  webAuth('acceptRestaurantCampaign'),
  validate(RestaurantCampaignValidation.leaveAndJoinCampaignValidation),
  RestaurantCampaignController.joinCampaign
);

router.delete(
  '/restaurant_campaign_request/reject/:campaignId',
  webAuth('rejectRestaurantCampaign'),
  validate(RestaurantCampaignRequestValidation.idValidation),
  RestaurantCampaignRequestController.drop
);
// Restaurant Campaign Routes //

// Food Campaign Request Routes //
router.get(
  '/food_campaign_request/get/:campaignId',
  webAuth('getFoodCampaignRequest'),
  validate(FoodCampaignRequestValidation.idValidation),
  FoodCampaignRequestController.get
);
router.delete(
  '/food_campaign_request/reject/:campaignId',
  webAuth('rejectFoodCampaignRequest'),
  validate(FoodCampaignRequestValidation.idValidation),
  FoodCampaignRequestController.drop
);
router.get(
  '/food_campaign_request/accept/:campaignId/:foodId',
  webAuth('acceptFoodCampaignRequest'),
  validate(FoodCampaignValidation.leaveAndJoinCampaignIdValidation),
  FoodCampaignController.joinCampaign
);
// Food Campaign Request Routes //

// Banners Routes //
router.get(
  '/banners/getAll',
  webAuth('getAllBanner'),
  validate(BannersValidation.allValidation),
  BannersController.get
);
router.post(
  '/banners/save',
  webAuth('createBanner'),
  validate(BannersValidation.createBanner),
  BannersController.create
);
router.patch(
  '/banners/update/:bannerId',
  webAuth('updateBanner'),
  validate(BannersValidation.idValidation),
  BannersController.update
);
router.patch(
  '/banners/updateStatus/:bannerId',
  webAuth('updateBanner'),
  validate(BannersValidation.idValidation),
  BannersController.updateStatus
);
router.delete(
  '/banners/delete/:bannerId',
  webAuth('deleteBanner'),
  validate(BannersValidation.idValidation),
  BannersController.drop
);
// Banners Routes //

// App Web Settings Routes //
router.get('/app_web_settings/get', webAuth('getAppWebSettings'), AppWebSettingController.get);
router.post(
  '/app_web_settings/save',
  webAuth('createOrUpdateAppWebSettings'),
  validate(AppWebSettingValidation.createOrUpdateAppWebSettings),
  AppWebSettingController.create
);
router.patch(
  '/app_web_settings/update/:settingId',
  webAuth('createOrUpdateAppWebSettings'),
  validate(AppWebSettingValidation.createOrUpdateAppWebSettings),
  AppWebSettingController.update
);
// App Web Settings Routes //

// Email Config Routes //
router.get('/email_config/get', webAuth('getEmailConfig'), EmailConfigController.get);
router.post(
  '/email_config/save',
  webAuth('createOrUpdateEmailConfig'),
  validate(EmailConfigValidation.createOrUpdateConfig),
  EmailConfigController.create
);
router.patch(
  '/email_config/update/:configId',
  webAuth('createOrUpdateEmailConfig'),
  validate(EmailConfigValidation.createOrUpdateConfig),
  EmailConfigController.update
);
router.get(
  '/email_config/sendDemo/:email',
  webAuth('sendDemoEmail'),
  validate(EmailConfigValidation.demoValidation),
  EmailConfigController.sendDemoMail
);
router.get(
  '/email_config/media_list',
  webAuth('getEmailConfig'),
  EmailConfigController.emailMediaConfig
);
router.patch(
  '/email_config/update_email_media',
  webAuth('createOrUpdateEmailConfig'),
  validate(EmailConfigValidation.emailMediaUrlValidation),
  EmailConfigController.saveEmailMediaConfig
);
// Email Config Routes //

// Email Template Routes //
router.get(
  '/email_templates/:slug',
  webAuth('getEmailTemplate'),
  validate(EmailTemplateValidation.idValidation),
  EmailTemplateController.get
);
router.post(
  '/email_templates/save',
  webAuth('createEmailTemplates'),
  validate(EmailTemplateValidation.createOrUpdateTemplate),
  EmailTemplateController.create
);
router.patch(
  '/email_templates/update/:slug',
  webAuth('updateEmailTemplates'),
  validate(EmailTemplateValidation.createOrUpdateTemplate),
  EmailTemplateController.update
);
// Email Template Routes //

// Restaurant Food License Routes //
router.get(
  '/restaurant_food_license/getAll',
  webAuth('getRestaurantFoodLicense'),
  validate(RestaurantFoodLicenseValidation.allValidation),
  RestaurantFoodLicenseController.get
);
router.post(
  '/restaurant_food_license/save',
  webAuth('createRestaurantFoodLicense'),
  validate(RestaurantFoodLicenseValidation.createRestaurantLicense),
  RestaurantFoodLicenseController.create
);
router.patch(
  '/restaurant_food_license/update/:licenseId',
  webAuth('updateRestaurantFoodLicense'),
  validate(RestaurantFoodLicenseValidation.idValidation),
  RestaurantFoodLicenseController.update
);
router.delete(
  '/restaurant_food_license/delete/:licenseId',
  webAuth('deleteRestaurantFoodLicense'),
  validate(RestaurantFoodLicenseValidation.idValidation),
  RestaurantFoodLicenseController.drop
);
// Restaurant Food License Routes //

// Payment Config Page Route //
router.get(
  '/payment_config/get/:slug',
  webAuth('getPaymentConfig'),
  validate(PaymentConfigValidation.idValidation),
  PaymentConfigController.get
);
router.post(
  '/payment_config/save',
  webAuth('createPaymentConfig'),
  validate(PaymentConfigValidation.createPaymentConfig),
  PaymentConfigController.create
);
router.patch(
  '/payment_config/update/:slug',
  webAuth('updatePaymentConfig'),
  validate(PaymentConfigValidation.idValidation),
  PaymentConfigController.update
);
// Payment Config Page Route //

// Delivery Instrunction Routes //
router.post(
  '/delivery_instruction/save',
  webAuth('createDeliveryInstruction'),
  validate(DeliveryInstructionValidation.createInstrunction),
  DeliveryInstructionController.create
);
router.get(
  '/delivery_instruction/get',
  webAuth('getDeliveryInstruction'),
  validate(DeliveryInstructionValidation.allValidation),
  DeliveryInstructionController.get
);
router.patch(
  '/delivery_instruction/update/:id',
  webAuth('updateDeliveryInstruction'),
  validate(DeliveryInstructionValidation.idValidation),
  DeliveryInstructionController.update
);
router.delete(
  '/delivery_instruction/delete/:id',
  webAuth('deleteDeliveryInstruction'),
  validate(DeliveryInstructionValidation.idValidation),
  DeliveryInstructionController.drop
);
// Delivery Instrunction Routes //

// Delivery Gratitude Routes //
router.post(
  '/gratitude/save',
  webAuth('createGratitude'),
  validate(DeliveryGratitudeValidation.createGratitude),
  DeliveryGratitudeController.create
);
router.get(
  '/gratitude/get',
  webAuth('getGratitude'),
  validate(DeliveryGratitudeValidation.allValidation),
  DeliveryGratitudeController.get
);
router.patch(
  '/gratitude/update/:id',
  webAuth('updateGratitude'),
  validate(DeliveryGratitudeValidation.idValidation),
  DeliveryGratitudeController.update
);
router.delete(
  '/gratitude/delete/:id',
  webAuth('deleteGratitude'),
  validate(DeliveryGratitudeValidation.idValidation),
  DeliveryGratitudeController.drop
);
// Delivery Gratitude Routes //

// Coupon Routes //
router.post(
  '/coupon/save',
  webAuth('createCoupon'),
  validate(CouponValidation.createCoupon),
  CouponController.create
);
router.get(
  '/coupon/get',
  webAuth('getCoupon'),
  validate(CouponValidation.allValidation),
  CouponController.get
);
router.get(
  '/coupon/getInfo/:id',
  webAuth('getCoupon'),
  validate(CouponValidation.idValidation),
  CouponController.getInfo
);
router.patch(
  '/coupon/update/:id',
  webAuth('updateCoupon'),
  validate(CouponValidation.idValidation),
  CouponController.update
);
router.patch(
  '/coupon/updateMeta/:id',
  webAuth('updateCoupon'),
  validate(CouponValidation.idValidation),
  CouponController.updateMeta
);
router.delete(
  '/coupon/delete/:id',
  webAuth('deleteCoupon'),
  validate(CouponValidation.idValidation),
  CouponController.drop
);
router.get(
  '/coupon/request',
  webAuth('getCoupon'),
  validate(CouponValidation.allValidation),
  CouponController.getVendorCouponRequest
);
router.get(
  '/coupon/detail/:id',
  webAuth('getCoupon'),
  validate(CouponValidation.detailValidation),
  CouponController.couponDetail
);
// Coupon Routes //

// User Routes //
router.get(
  '/users/search/:name',
  webAuth('searchUser'),
  validate(UserValidation.searchUser),
  UserController.findUserWithName
);
// User Routes //

// Driver Incetive Routes //
router.post(
  '/driver_incentive/save',
  webAuth('createDriverIncentive'),
  validate(DriverIncentiveValidation.createIncentive),
  DriverIncentiveController.create
);
router.get(
  '/driver_incentive/get',
  webAuth('getDriverIncentive'),
  validate(DriverIncentiveValidation.allValidation),
  DriverIncentiveController.get
);
router.patch(
  '/driver_incentive/update/:id',
  webAuth('updateDriverIncentive'),
  validate(DriverIncentiveValidation.updateIncentive),
  DriverIncentiveController.update
);
router.patch(
  '/driver_incentive/updateStatus/:id',
  webAuth('updateDriverIncentive'),
  validate(DriverIncentiveValidation.updateIncentiveStatus),
  DriverIncentiveController.updateStatus
);
router.delete(
  '/driver_incentive/delete/:id',
  webAuth('deleteDriverIncentive'),
  validate(DriverIncentiveValidation.idValidation),
  DriverIncentiveController.drop
);
// Driver Incetive Routes //

// Driver Offline Messages Routes //
router.post(
  '/driver_offline_messages/save',
  webAuth('createDriverOfflineMessage'),
  validate(DriverOfflineMessagesValidation.createOfflineMessage),
  DriverOfflineMessagesController.create
);
router.get(
  '/driver_offline_messages/get',
  webAuth('getDriverOfflineMessages'),
  validate(DriverOfflineMessagesValidation.allValidation),
  DriverOfflineMessagesController.get
);
router.patch(
  '/driver_offline_messages/update/:id',
  webAuth('updateDriverOfflineMessages'),
  validate(DriverOfflineMessagesValidation.idValidation),
  DriverOfflineMessagesController.update
);
router.delete(
  '/driver_offline_messages/delete/:id',
  webAuth('deleteOfflineMessages'),
  validate(DriverOfflineMessagesValidation.idValidation),
  DriverOfflineMessagesController.drop
);
// Driver Offline Messages Routes //

// Order Notification Translation Routes //
router.get(
  '/order_notification_translation/getBySlug/:slug',
  webAuth('getOrderNotificationTranslation'),
  validate(OrderNotificationTranslationValidation.getNotificationValidation),
  OrderNotificationTranslationController.getBySlug
);
router.post(
  '/order_notification_translation/save',
  webAuth('saveOrderNotificationTranslation'),
  validate(OrderNotificationTranslationValidation.saveOrderNotificationTranslationValidation),
  OrderNotificationTranslationController.createOrUpdate
);
// Order Notification Translation Routes //

// Orders Routes //
router.get('/orders/getOrderCount', webAuth('getOrderCount'), OrdersController.getOrderCount);
router.get(
  '/orders/getOrderList',
  webAuth('getOrderList'),
  validate(OrdersValidation.adminOrderValidation),
  OrdersController.getAdminOrderList
);
router.get(
  '/orders/getScheduleOrders',
  webAuth('getScheduleOrders'),
  validate(OrdersValidation.adminScheduleOrderValidation),
  OrdersController.getAdminScheduleOrderList
);
router.get(
  '/orders/getSubscriptionOrders',
  webAuth('getSubscriptionOrders'),
  validate(OrdersValidation.adminSubscriptionOrderValidation),
  OrdersController.getAdminSubscriptionOrderList
);
router.get(
  '/orders/getUnAssignedOrders',
  webAuth('getUnAssignedOrders'),
  validate(OrdersValidation.adminScheduleOrderValidation),
  OrdersController.getAdminUnAssignedOrderList
);
router.get(
  '/orders/fetchDriverNearToOrder/:id/:restaurant',
  webAuth('fetchDriverNearToOrder'),
  validate(OrdersValidation.findDriverValidation),
  OrdersController.fetchDriverNearToOrder
);
router.post(
  '/orders/assignDriverOrderAdmin',
  webAuth('assignDriverOrderAdmin'),
  validate(OrdersValidation.assignDriverOrderAdminValidation),
  OrdersController.assignDriverOrderAdmin
);
router.get(
  '/orders/detailAdmin/:id',
  webAuth('orderDetail'),
  validate(OrdersValidation.orderDetailAdminValidation),
  OrdersController.getOrderDetailAdmin
);
router.get(
  '/orders/coupon/:id',
  webAuth('getOrderList'),
  validate(OrdersValidation.couponValidation),
  OrdersController.couponOrders
);
router.get(
  '/orders/invoice/:id',
  webAuth('orderDetail'),
  validate(OrdersValidation.adminInvoiceValidation),
  OrdersController.adminOrderInvoice
);
// Orders Routes //

// POS Orders Routes //
router.get(
  '/posOrders/list',
  webAuth('posOrderList'),
  validate(PosOrTableOrderValidation.adminOrderValidation),
  PosOrTableOrderController.adminPosOrderList
);
router.get(
  '/posOrders/detail/:id',
  webAuth('posOrderDetail'),
  validate(PosOrTableOrderValidation.adminPosOrderDetailValidation),
  PosOrTableOrderController.adminPosOrderDetail
);
router.get(
  '/posOrders/invoice/:id',
  webAuth('posOrderDetail'),
  validate(PosOrTableOrderValidation.orderInvoiceValidation),
  PosOrTableOrderController.adminPOSOrderInvoice
);
// POS Orders Routes //

// Table Orders Routes //
router.get(
  '/tableOrders/list',
  webAuth('tableOrderList'),
  validate(TableOrderValidation.adminOrderValidation),
  TableOrderController.adminTableOrderList
);
router.get(
  '/tableOrders/detail/:id',
  webAuth('tableOrderDetail'),
  validate(TableOrderValidation.adminTableOrderDetailValidation),
  TableOrderController.adminTableOrderDetail
);
router.get(
  '/tableOrders/invoice/:id',
  webAuth('tableOrderDetail'),
  validate(TableOrderValidation.orderInvoiceValidation),
  TableOrderController.adminTableOrderInvoice
);
// Table Orders Routes //

// Refund Request Routes //
router.get(
  '/refund_request/active',
  webAuth('getActiveRefundRequest'),
  validate(RefundRequestValidation.adminListValidation),
  RefundRequestController.getActiveRefundRequest
);
router.get(
  '/refund_request/info/:requestId',
  webAuth('getRefundRequestInfo'),
  validate(RefundRequestValidation.getRefundRequestInfoValidation),
  RefundRequestController.getRefundRequestInfo
);
router.post(
  '/refund_request/cancel',
  webAuth('cancelRefundRequest'),
  validate(RefundRequestValidation.cancelRefundRequestValidation),
  RefundRequestController.cancelRefundRequest
);
router.post(
  '/refund_request/approve',
  webAuth('approveRefundRequest'),
  validate(RefundRequestValidation.approveRefundRequestValidation),
  RefundRequestController.approveRefundRequest
);
router.post(
  '/refund_request/refundFromMerchant',
  webAuth('refundFromMerchant'),
  validate(RefundRequestValidation.refundFromMerchantValidation),
  RefundRequestController.refundFromMerchant
);
// Refund Request Routes //

// Complaints Reason Routes //
router.get(
  '/complaints_reason/getAll',
  webAuth('getComplaintsReason'),
  validate(ComplaintsReasonValidation.allValidation),
  ComplaintsReasonController.get
);
router.post(
  '/complaints_reason/save',
  webAuth('createComplaintsReason'),
  validate(ComplaintsReasonValidation.createComplaintsReason),
  ComplaintsReasonController.create
);
router.patch(
  '/complaints_reason/update/:reasonId',
  webAuth('updateComplaintsReason'),
  validate(ComplaintsReasonValidation.idValidation),
  ComplaintsReasonController.update
);
router.delete(
  '/complaints_reason/delete/:reasonId',
  webAuth('deleteComplaintsReason'),
  validate(ComplaintsReasonValidation.idValidation),
  ComplaintsReasonController.drop
);
// Complaints Reason Routes //

// Complaints Routes //
router.get(
  '/complaints/get',
  webAuth('getComplaints'),
  validate(UserValidation.adminComplaintValidation),
  ComplaintsController.get
);
router.get(
  '/restaurant_complaints/get',
  webAuth('getComplaints'),
  validate(UserValidation.adminRestaurantComplaintValidation),
  RestaurantComplaintsController.get
);

// SMS Provider Config Routes //
router.get(
  '/sms_provider/get/:slug',
  webAuth('getSmsProviderConfig'),
  validate(SmsProviderConfigValidation.idValidation),
  SmsProviderConfigController.get
);
router.post(
  '/sms_provider/save',
  webAuth('createSmsProviderConfig'),
  validate(SmsProviderConfigValidation.createSMSProviderConfig),
  SmsProviderConfigController.create
);
router.patch(
  '/sms_provider/update/:slug',
  webAuth('updateSmsProviderConfig'),
  validate(SmsProviderConfigValidation.idValidation),
  SmsProviderConfigController.update
);
router.post(
  '/sms_provider/demoTwilio',
  webAuth('sendDemoSMS'),
  validate(SmsProviderConfigValidation.demoValidation),
  SmsProviderConfigController.sendTwilioDemoSMS
);
router.post(
  '/sms_provider/demoNexmo',
  webAuth('sendDemoSMS'),
  validate(SmsProviderConfigValidation.demoValidation),
  SmsProviderConfigController.sendNexmoDemoSMS
);
router.post(
  '/sms_provider/demo_sms_dot_to',
  webAuth('sendDemoSMS'),
  validate(SmsProviderConfigValidation.demoValidation),
  SmsProviderConfigController.sendSMStoDemoSMS
);
router.post(
  '/sms_provider/demo_2factor',
  webAuth('sendDemoSMS'),
  validate(SmsProviderConfigValidation.demoValidation),
  SmsProviderConfigController.send2FactorDemoSMS
);
router.post(
  '/sms_provider/demo_fast2sms',
  webAuth('sendDemoSMS'),
  validate(SmsProviderConfigValidation.demoValidation),
  SmsProviderConfigController.sendFast2SMSDemoSMS
);
// SMS Provider Config Routes //

// Report Issue Restaurant Reason Routes //
router.get(
  '/report_issue/restaurant/getAll',
  webAuth('getReportIssueRestaurant'),
  validate(ReportIssueRestaurantReasonValidation.allValidation),
  ReportIssueRestaurantReasonController.get
);
router.post(
  '/report_issue/restaurant/save',
  webAuth('createReportIssueRestaurant'),
  validate(ReportIssueRestaurantReasonValidation.createReportIssueRestaurantReason),
  ReportIssueRestaurantReasonController.create
);
router.patch(
  '/report_issue/restaurant/update/:reasonId',
  webAuth('updateReportIssueRestaurant'),
  validate(ReportIssueRestaurantReasonValidation.idValidation),
  ReportIssueRestaurantReasonController.update
);
router.delete(
  '/report_issue/restaurant/delete/:reasonId',
  webAuth('deleteReportIssueRestaurant'),
  validate(ReportIssueRestaurantReasonValidation.idValidation),
  ReportIssueRestaurantReasonController.drop
);
// Report Issue Restaurant Reason Routes //

// Report Issue Restaurant Routes //
router.get(
  '/report_issue_list/restaurant/get',
  webAuth('getReportIssueRestaurantList'),
  validate(ReportIssueRestaurantReasonValidation.reportValidation),
  ReportIssueRestaurantController.getReportsList
);
// Report Issue Restaurant Routes //

// Hidden Restaurant Routes //
router.get(
  '/hide/restaurant',
  webAuth('hiddenRestaurant'),
  validate(HideRestaurantReasonValidation.hiddenValidation),
  HideRestaurantController.getHiddenRestaurantList
);
// Hidden Restaurant Routes //

// Hide Restaurant Reason Routes //
router.get(
  '/hide_reason/restaurant/getAll',
  webAuth('getHideRestaurantReasonList'),
  validate(HideRestaurantReasonValidation.allValidation),
  HideRestaurantReasonController.get
);
router.post(
  '/hide_reason/restaurant/save',
  webAuth('createHideRestaurantReason'),
  validate(HideRestaurantReasonValidation.createHideRestaurantReason),
  HideRestaurantReasonController.create
);
router.patch(
  '/hide_reason/restaurant/update/:reasonId',
  webAuth('updateHideRestaurantReason'),
  validate(HideRestaurantReasonValidation.idValidation),
  HideRestaurantReasonController.update
);
router.delete(
  '/hide_reason/restaurant/delete/:reasonId',
  webAuth('deleteHideRestaurantReason'),
  validate(HideRestaurantReasonValidation.idValidation),
  HideRestaurantReasonController.drop
);
// Hide Restaurant Reason Routes //

// Order Rating Message Routes //
router.get(
  '/order_rating_message/getAll',
  webAuth('getOrderRatingMessages'),
  validate(OrderRatingMessageValidation.allValidation),
  OrderRatingMessageController.get
);
router.post(
  '/order_rating_message/save',
  webAuth('createOrderRatingMessage'),
  validate(OrderRatingMessageValidation.createRatingMessage),
  OrderRatingMessageController.create
);
router.patch(
  '/order_rating_message/update/:messageId',
  webAuth('updateOrderRatingMessage'),
  validate(OrderRatingMessageValidation.idValidation),
  OrderRatingMessageController.update
);
router.delete(
  '/order_rating_message/delete/:messageId',
  webAuth('deleteOrderRatingMessage'),
  validate(OrderRatingMessageValidation.idValidation),
  OrderRatingMessageController.drop
);
// Order Rating Message Routes //

// Restaurant Notice Routes //
router.get(
  '/restaurant/notice/getAll',
  webAuth('getRestaurantNotice'),
  validate(RestaurantNoticeValidation.allValidation),
  RestaurantNoticeController.get
);
router.post(
  '/restaurant/notice/save',
  webAuth('createRestaurantNotice'),
  validate(RestaurantNoticeValidation.createRestaurantNoticeReason),
  RestaurantNoticeController.create
);
router.patch(
  '/restaurant/notice/update/:noticeId',
  webAuth('updateRestaurantNotice'),
  validate(RestaurantNoticeValidation.idValidation),
  RestaurantNoticeController.update
);
router.delete(
  '/restaurant/notice/delete/:noticeId',
  webAuth('deleteRestaurantNotice'),
  validate(RestaurantNoticeValidation.idValidation),
  RestaurantNoticeController.drop
);
// Restaurant Notice Routes //

// Subscription Tiffin Package Routes //
router.get(
  '/tiffin_packages/getList',
  webAuth('getTiffinPackages'),
  validate(SubscriptionTiffinPackageValidation.allValidation),
  SubscriptionTiffinPackageController.getSubscriptionPackageListAdmin
);
router.patch(
  '/tiffin_packages/updateStatus/:id',
  webAuth('updatePackageStatus'),
  validate(SubscriptionTiffinPackageValidation.updateAdminStatusValidation),
  SubscriptionTiffinPackageController.updatePackageStatus
);
router.get(
  '/tiffin_packages/foods/:restaurant',
  webAuth('getTiffinPackageFoods'),
  validate(SubscriptionTiffinPackageValidation.getBasicValidation),
  SubscriptionTiffinPackageController.getBasic
);
router.post(
  '/tiffin_packages/create/',
  webAuth('createTiffinPackage'),
  validate(SubscriptionTiffinPackageValidation.createSubscriptionTiffinValidation),
  SubscriptionTiffinPackageController.create
);
router.delete(
  '/tiffin_packages/delete/:id',
  webAuth('deleteTiffinPackage'),
  validate(SubscriptionTiffinPackageValidation.deleteValidation),
  SubscriptionTiffinPackageController.drop
);
router.get(
  '/tiffin_packages/details/:id/:restaurant',
  webAuth('getPackageDetail'),
  validate(SubscriptionTiffinPackageValidation.idValidation),
  SubscriptionTiffinPackageController.getById
);
router.patch(
  '/tiffin_packages/update/:id',
  webAuth('updatePackageDetail'),
  validate(SubscriptionTiffinPackageValidation.updateValidation),
  SubscriptionTiffinPackageController.updatePackage
);
router.post(
  '/tiffin_packages/adminTiffinSubscriptionPurchased/',
  webAuth('adminTiffinSubscriptionPurchased'),
  validate(UserPurchasedTiffinSubscriptionValidation.purchasedSubscriptionListAdminValidation),
  UserPurchasedTiffinSubscriptionController.getPurchaseListForAdmin
);
router.get(
  '/tiffin_packages/getTiffinSubscriptionPurchaseDetail/:id',
  webAuth('getTiffinSubscriptionPurchaseDetail'),
  validate(UserPurchasedTiffinSubscriptionValidation.purchaseDetailValidation),
  UserPurchasedTiffinSubscriptionController.getPurchaseDetailAdmin
);
// Subscription Tiffin Package Routes //

// Cron Job Scheduler Controller Routes //
router.get(
  '/cronScheduler/start',
  webAuth('startScheduler'),
  CronJobSchedulerController.startScheduler
);
router.get(
  '/cronScheduler/stop',
  webAuth('stopScheduler'),
  CronJobSchedulerController.stopScheduler
);
router.get(
  '/cronScheduler/getInfo',
  webAuth('getSchedulerInfo'),
  CronJobSchedulerController.getSchedulerInfo
);
// Cron Job Scheduler Controller Routes //

// Tiffin Subscription Cancellation Reason Routes //
router.get(
  '/tiffin_subscription_cancel_reason/getAll',
  webAuth('getTiffinSubscriptionCancelReason'),
  validate(TiffinSubscriptionCancellationReasonValidation.allValidation),
  TiffinSubscriptionCancellationReasonController.get
);
router.post(
  '/tiffin_subscription_cancel_reason/save',
  webAuth('createTiffinSubscriptionCancelReason'),
  validate(TiffinSubscriptionCancellationReasonValidation.createCancellationReason),
  TiffinSubscriptionCancellationReasonController.create
);
router.patch(
  '/tiffin_subscription_cancel_reason/update/:reasonId',
  webAuth('updateTiffinSubscriptionCancelReason'),
  validate(TiffinSubscriptionCancellationReasonValidation.idValidation),
  TiffinSubscriptionCancellationReasonController.update
);
router.delete(
  '/tiffin_subscription_cancel_reason/delete/:reasonId',
  webAuth('deleteTiffinSubscriptionCancelReason'),
  validate(TiffinSubscriptionCancellationReasonValidation.idValidation),
  TiffinSubscriptionCancellationReasonController.drop
);
// Tiffin Subscription Cancellation Reason Routes //

// Tiffin Subscription Refund Request Reason Routes //
router.get(
  '/tiffin_subscription_refund_request_reason/getAll',
  webAuth('getTiffinSubscriptionRefundRequestReason'),
  validate(TiffinSubscriptionRefundRequestReasonValidation.allValidation),
  TiffinSubscriptionRefundRequestReasonController.get
);
router.post(
  '/tiffin_subscription_refund_request_reason/save',
  webAuth('createTiffinSubscriptionRefundRequestReason'),
  validate(TiffinSubscriptionRefundRequestReasonValidation.createRefundRequestReason),
  TiffinSubscriptionRefundRequestReasonController.create
);
router.patch(
  '/tiffin_subscription_refund_request_reason/update/:reasonId',
  webAuth('updateTiffinSubscriptionRefundRequestReason'),
  validate(TiffinSubscriptionRefundRequestReasonValidation.idValidation),
  TiffinSubscriptionRefundRequestReasonController.update
);
router.delete(
  '/tiffin_subscription_refund_request_reason/delete/:reasonId',
  webAuth('deleteTiffinSubscriptionRefundRequestReason'),
  validate(TiffinSubscriptionRefundRequestReasonValidation.idValidation),
  TiffinSubscriptionRefundRequestReasonController.drop
);
// Tiffin Subscription Refund Request Reason Routes //

// Tiffin Subscription Refund Request Routes //
router.get(
  '/tiffin_subscription_refund_request/active',
  webAuth('getActiveRefundRequest'),
  validate(TiffinSubscriptionRefundRequestValidation.adminListValidation),
  TiffinSubscriptionRefundRequestController.getActiveRefundRequest
);
router.get(
  '/tiffin_subscription_refund_request/info/:requestId',
  webAuth('getTiffinSubscriptionRefundRequestInfo'),
  validate(
    TiffinSubscriptionRefundRequestValidation.getTiffinSubscriptionRefundRequestInfoValidation
  ),
  TiffinSubscriptionRefundRequestController.getTiffinSubscriptionRefundRequestInfo
);
router.post(
  '/tiffin_subscription_refund_request/cancel',
  webAuth('cancelTiffinSubscriptionRefundRequest'),
  validate(TiffinSubscriptionRefundRequestValidation.cancelRefundRequestValidation),
  TiffinSubscriptionRefundRequestController.cancelRefundRequest
);
router.post(
  '/tiffin_subscription_refund_request/refundFromMerchant',
  webAuth('refundTiffinSubscriptionFromMerchant'),
  validate(TiffinSubscriptionRefundRequestValidation.refundFromMerchantValidation),
  TiffinSubscriptionRefundRequestController.refundFromMerchant
);
router.post(
  '/tiffin_subscription_refund_request/approve',
  webAuth('approveTiffinSubscriptionRefundRequest'),
  validate(TiffinSubscriptionRefundRequestValidation.approveRefundRequestValidation),
  TiffinSubscriptionRefundRequestController.approveRefundRequest
);
// Tiffin Subscription Refund Request Routes //

// Dining Settings Routes //
router.get('/dining_settings/get', webAuth('getDiningSettings'), DiningSettingController.get);
router.post(
  '/dining_settings/save',
  webAuth('createOrUpdateDiningSettings'),
  validate(DiningSettingValidation.createOrUpdateDiningSettings),
  DiningSettingController.create
);
router.patch(
  '/dining_settings/update/:settingId',
  webAuth('createOrUpdateDiningSettings'),
  validate(DiningSettingValidation.createOrUpdateDiningSettings),
  DiningSettingController.update
);
// Dining Settings Routes //

// Dining Cancellation Reason Routes //
router.get(
  '/dining_cancel_reason/getAll',
  webAuth('getDiningCancelReason'),
  validate(DiningCancellationReasonValidation.allValidation),
  DiningCancellationReasonController.get
);
router.post(
  '/dining_cancel_reason/save',
  webAuth('createDiningCancelReason'),
  validate(DiningCancellationReasonValidation.createCancellationReason),
  DiningCancellationReasonController.create
);
router.patch(
  '/dining_cancel_reason/update/:reasonId',
  webAuth('updateDiningCancelReason'),
  validate(DiningCancellationReasonValidation.idValidation),
  DiningCancellationReasonController.update
);
router.delete(
  '/dining_cancel_reason/delete/:reasonId',
  webAuth('deletetDiningCancelReason'),
  validate(DiningCancellationReasonValidation.idValidation),
  DiningCancellationReasonController.drop
);
// Dining Cancellation Reason Routes //

// Dining Category Routes //
router.post(
  '/dining_category/save',
  webAuth('createDiningCategory'),
  validate(DiningCategoryValidation.createCategory),
  DiningCategoryController.create
);
router.get(
  '/dining_category/getAll',
  webAuth('getDiningCategories'),
  validate(DiningCategoryValidation.allValidation),
  DiningCategoryController.get
);
router.patch(
  '/dining_category/update/:categoryId',
  webAuth('updateDiningCategory'),
  validate(DiningCategoryValidation.idValidation),
  DiningCategoryController.update
);
router.delete(
  '/dining_category/delete/:categoryId',
  webAuth('deleteDiningCategory'),
  validate(DiningCategoryValidation.idValidation),
  DiningCategoryController.drop
);
// Dining Category Routes //

// Dining Notice Routes //
router.get(
  '/dining/notice/getAll',
  webAuth('getDiningNotice'),
  validate(DiningNoticeValidation.allValidation),
  DiningNoticeController.get
);
router.post(
  '/dining/notice/save',
  webAuth('createDiningNotice'),
  validate(DiningNoticeValidation.createDiningNoticeReason),
  DiningNoticeController.create
);
router.patch(
  '/dining/notice/update/:noticeId',
  webAuth('updateDiningNotice'),
  validate(DiningNoticeValidation.idValidation),
  DiningNoticeController.update
);
router.delete(
  '/dining/notice/delete/:noticeId',
  webAuth('deleteDiningNotice'),
  validate(DiningNoticeValidation.idValidation),
  DiningNoticeController.drop
);
// Dining Notice Routes //

// Dining Campaign Routes //
router.post(
  '/dining_campaign/save',
  webAuth('createDiningCampaign'),
  validate(DiningCampaignValidation.createDiningCampaignValidation),
  DiningCampaignController.create
);
router.get(
  '/dining_campaign/getAll',
  webAuth('getDiningCampaigns'),
  validate(DiningCampaignValidation.allValidation),
  DiningCampaignController.get
);
router.patch(
  '/dining_campaign/updateStatus/:campaignId',
  webAuth('updateDiningCampaign'),
  validate(DiningCampaignValidation.idValidation),
  DiningCampaignController.updateStatus
);
router.delete(
  '/dining_campaign/delete/:campaignId',
  webAuth('deleteDiningCampaign'),
  validate(DiningCampaignValidation.idValidation),
  DiningCampaignController.drop
);
router.get(
  '/dining_campaign/getById/:campaignId',
  webAuth('getDiningCampaignById'),
  validate(DiningCampaignValidation.idValidation),
  DiningCampaignController.getById
);
router.patch(
  '/dining_campaign/update/:campaignId',
  webAuth('updateDiningCampaign'),
  validate(DiningCampaignValidation.idValidation),
  DiningCampaignController.update
);

router.get(
  '/dining_campaign_request/get/:campaignId',
  webAuth('getDiningCampaignRequest'),
  validate(DiningCampaignRequestValidation.idValidation),
  DiningCampaignRequestController.get
);
router.get(
  '/dining_campaign_request/accept/:campaignId/:restaurantId',
  webAuth('acceptDiningCampaign'),
  validate(DiningCampaignValidation.leaveAndJoinCampaignValidation),
  DiningCampaignController.joinCampaign
);
router.delete(
  '/dining_campaign_request/reject/:campaignId',
  webAuth('rejectDiningCampaign'),
  validate(DiningCampaignRequestValidation.idValidation),
  DiningCampaignRequestController.drop
);
router.get(
  '/dining_campaign/detail/:id',
  webAuth('campaignDetail'),
  validate(DiningCampaignValidation.detailValidation),
  DiningCampaignController.detail
);
// Dining Campaign Routes //

// Restaurant Facilities Routes //
router.get(
  '/restaurant/facilities/getAll',
  webAuth('getRestaurantFacility'),
  validate(RestaurantFacilitiesValidation.allValidation),
  RestaurantFacilitiesController.get
);
router.post(
  '/restaurant/facilities/save',
  webAuth('createRestaurantFacility'),
  validate(RestaurantFacilitiesValidation.createRestaurantFacility),
  RestaurantFacilitiesController.create
);
router.patch(
  '/restaurant/facilities/update/:id',
  webAuth('updateRestaurantFacility'),
  validate(RestaurantFacilitiesValidation.idValidation),
  RestaurantFacilitiesController.update
);
router.delete(
  '/restaurant/facilities/delete/:id',
  webAuth('deleteRestaurantFacility'),
  validate(RestaurantFacilitiesValidation.idValidation),
  RestaurantFacilitiesController.drop
);
// Restaurant Facilities Routes //

// Dining Coupon Routes //
router.post(
  '/dining_coupon/save',
  webAuth('createDiningCoupon'),
  validate(DiningCouponValidation.createCoupon),
  DiningCouponController.create
);
router.get(
  '/dining_coupon/get',
  webAuth('getDiningCoupon'),
  validate(DiningCouponValidation.allValidation),
  DiningCouponController.get
);
router.patch(
  '/dining_coupon/updateMeta/:id',
  webAuth('updateDiningCoupon'),
  validate(DiningCouponValidation.idValidation),
  DiningCouponController.updateMeta
);
router.delete(
  '/dining_coupon/delete/:id',
  webAuth('deleteDiningCoupon'),
  validate(DiningCouponValidation.idValidation),
  DiningCouponController.drop
);
router.get(
  '/dining_coupon/getInfo/:id',
  webAuth('getDiningCoupon'),
  validate(DiningCouponValidation.idValidation),
  DiningCouponController.getInfo
);
router.patch(
  '/dining_coupon/update/:id',
  webAuth('updateDiningCoupon'),
  validate(DiningCouponValidation.idValidation),
  DiningCouponController.update
);
router.get(
  '/dining_coupon/request',
  webAuth('getDiningCoupon'),
  validate(DiningCouponValidation.allValidation),
  DiningCouponController.getVendorCouponRequest
);
router.get(
  '/dining_coupon/detail/:id',
  webAuth('getDiningCoupon'),
  validate(DiningCouponValidation.detailValidation),
  DiningCouponController.couponDetail
);
// Dining Coupon Routes //

// Dining Booking Refund Request Reason Routes //
router.get(
  '/dining_booking_refund_request_reason/getAll',
  webAuth('getDiningBookingRefundRequestReason'),
  validate(DiningBookingRefundRequestReasonValidation.allValidation),
  DiningBookingRefundRequestReasonController.get
);
router.post(
  '/dining_booking_refund_request_reason/save',
  webAuth('createDiningBookingRefundRequestReason'),
  validate(DiningBookingRefundRequestReasonValidation.createRefundRequestReason),
  DiningBookingRefundRequestReasonController.create
);
router.patch(
  '/dining_booking_refund_request_reason/update/:reasonId',
  webAuth('updateDiningBookingRefundRequestReason'),
  validate(DiningBookingRefundRequestReasonValidation.idValidation),
  DiningBookingRefundRequestReasonController.update
);
router.delete(
  '/dining_booking_refund_request_reason/delete/:reasonId',
  webAuth('deleteDiningBookingRefundRequestReason'),
  validate(DiningBookingRefundRequestReasonValidation.idValidation),
  DiningBookingRefundRequestReasonController.drop
);
// Dining Booking Refund Request Reason Routes //

// Dining Refund Request Routes //
router.get(
  '/dining_booking_refund_request/active',
  webAuth('getActiveDiningBookingRefundRequest'),
  validate(DiningBookingRefundRequestValidation.adminListValidation),
  DiningBookingRefundRequestController.getActiveRefundRequest
);
router.get(
  '/dining_booking_refund_request/info/:requestId',
  webAuth('getDiningBookingRefundRequestInfo'),
  validate(DiningBookingRefundRequestValidation.getRefundRequestInfoValidation),
  DiningBookingRefundRequestController.getRefundRequestInfo
);
router.post(
  '/dining_booking_refund_request/cancel',
  webAuth('cancelDiningBookingRefundRequest'),
  validate(DiningBookingRefundRequestValidation.cancelRefundRequestValidation),
  DiningBookingRefundRequestController.cancelRefundRequest
);
router.post(
  '/dining_booking_refund_request/refundFromMerchant',
  webAuth('refundDiningBookingFromMerchant'),
  validate(DiningBookingRefundRequestValidation.refundFromMerchantValidation),
  DiningBookingRefundRequestController.refundFromMerchant
);
router.post(
  '/dining_booking_refund_request/approve',
  webAuth('approveDiningBookingRefundRequest'),
  validate(DiningBookingRefundRequestValidation.approveRefundRequestValidation),
  DiningBookingRefundRequestController.approveRefundRequest
);
// Dining Refund Request Routes //

/// Dining Booking Routes ///
router.get(
  '/dining_booking/getDiningBookingCount',
  webAuth('getDiningBookingCount'),
  DiningBookingController.adminDiningBookingCount
);
router.get(
  '/dining_booking/getDiningBookingList',
  webAuth('getDiningBookingList'),
  validate(DiningBookingValidation.adminBookingValidation),
  DiningBookingController.adminDiningBookingList
);
router.get(
  '/dining_booking/bookingInformation/:bookingId',
  webAuth('getDiningBookingInformation'),
  validate(DiningBookingValidation.bookingInformationAdminValidation),
  DiningBookingController.getDiningBookingInfoAdmin
);
router.get(
  '/dining_booking/coupon/:id',
  webAuth('getDiningBookingList'),
  validate(DiningBookingValidation.couponValidation),
  DiningBookingController.couponBooking
);
/// Dining Booking Routes ///

/// Feedback & Report Emergency Routes //
router.get(
  '/feedback/list',
  webAuth('getFeedbackList'),
  validate(FeedbackFormValidation.allValidation),
  FeedbackFormController.feedbackListAdmin
);
router.delete(
  '/feedback/delete/:id',
  webAuth('deleteFeedback'),
  validate(FeedbackFormValidation.deleteFeedbackValidation),
  FeedbackFormController.drop
);
router.patch(
  '/feedback/update/',
  webAuth('updateFeedback'),
  validate(FeedbackFormValidation.updateFeedbackValidation),
  FeedbackFormController.update
);

router.get(
  '/report_emergency/list',
  webAuth('getReportEmergencyList'),
  validate(ReportEmergencyValidation.allValidation),
  ReportEmergencyController.reportEmergencyListAdmin
);
router.delete(
  '/report_emergency/delete/:id',
  webAuth('deleteReportEmergency'),
  validate(ReportEmergencyValidation.deleteReportEmergencyValidation),
  ReportEmergencyController.drop
);
router.patch(
  '/report_emergency/update/',
  webAuth('updateReportEmergency'),
  validate(ReportEmergencyValidation.updateReportEmergencyValidation),
  ReportEmergencyController.update
);
/// Feedback & Report Emergency Routes //

// User Avatar Routes //
router.get('/user_avatar/list', webAuth('getAvatarList'), UserAvatarController.get);
router.post(
  '/user_avatar/save',
  webAuth('saveUserAvatar'),
  validate(UserAvatarValidation.saveAvatarValidation),
  UserAvatarController.create
);
router.patch(
  '/user_avatar/updateDefault/:id',
  webAuth('updateDefaultAvatar'),
  validate(UserAvatarValidation.idValidation),
  UserAvatarController.updateDefault
);
router.patch(
  '/user_avatar/update/:id',
  webAuth('updateAvatar'),
  validate(UserAvatarValidation.idValidation),
  UserAvatarController.update
);
router.delete(
  '/user_avatar/delete/:id',
  webAuth('deleteAvatar'),
  validate(UserAvatarValidation.idValidation),
  UserAvatarController.drop
);
// User Avatar Routes //

// Waiter Routes //
router.get(
  '/waiter/getAll',
  webAuth('getWaiter'),
  validate(WaiterValidation.allValidation),
  WaiterController.waiterListAdmin
);
router.patch(
  '/waiter/updateWaiterStatus/:waiterId',
  webAuth('updateWaiterInfo'),
  validate(WaiterValidation.updateWaiterStatusValidation),
  WaiterController.updateWaiterStatus
);
router.get(
  '/waiter/getById/:waiterId',
  webAuth('getWaiterById'),
  validate(WaiterValidation.idValidation),
  WaiterController.getById
);
router.patch(
  '/waiter/updateWaiterInfo/:userId',
  webAuth('updateWaiterInfo'),
  validate(WaiterValidation.updateWaiterInfoValidation),
  WaiterController.updateWaiterInfo
);
// Waiter Routes //

// Kitchen Owner Routes //
router.get(
  '/kitchen_owners/list',
  webAuth('get_kitchen_owner_list'),
  validate(KitchenOwnerValidation.allValidation),
  KitchenOwnerController.kitchenOwnerListAdmin
);
router.patch(
  '/kitchen_owner/update_kitchen_status/:kitchenId',
  webAuth('update_kitchen_status'),
  validate(KitchenOwnerValidation.updateKitchenOwnerStatusValidation),
  KitchenOwnerController.updateKitchenOwnerStatus
);
router.get(
  '/kitchen_owner/info/:kitchenId',
  webAuth('kitchen_owner_info'),
  validate(KitchenOwnerValidation.idValidation),
  KitchenOwnerController.getById
);
router.patch(
  '/kitchen_owner/update_detail/:userId',
  webAuth('update_kitchen_owner'),
  validate(KitchenOwnerValidation.updateKitchenOwnerInfoValidation),
  KitchenOwnerController.updateKitchenOwnerInfo
);
// Kitchen Owner Routes //

// Waiter Settings Routes //
router.get('/waiter_settings/get', webAuth('getWaiterSettings'), WaiterSettingController.get);
router.post(
  '/waiter_settings/save',
  webAuth('createWaiterSettings'),
  validate(WaiterSettingValidation.createSettings),
  WaiterSettingController.create
);
router.patch(
  '/waiter_settings/update/:settingId',
  webAuth('updateWaiterSettings'),
  validate(WaiterSettingValidation.idValidation),
  WaiterSettingController.update
);
// Waiter Settings Routes //

// Kitchen Owner Setting Routes //
router.get(
  '/kitchen_owner_setting/get',
  webAuth('get_kitchen_owner_setting'),
  KitchenOwnerSettingController.get
);
router.post(
  '/kitchen_owner_setting/save',
  webAuth('create_kitchen_owner_setting'),
  validate(KitchenOwnerSettingValidation.createSettings),
  KitchenOwnerSettingController.create
);
router.patch(
  '/kitchen_owner_setting/update/:settingId',
  webAuth('update_kitchen_owner_setting'),
  validate(KitchenOwnerSettingValidation.idValidation),
  KitchenOwnerSettingController.update
);
// Kitchen Owner Setting Routes //

// Food Taxation Routes //
router.get(
  '/food_taxation/getAll',
  webAuth('getFoodTaxationList'),
  validate(FoodTaxationValidation.allValidation),
  FoodTaxationController.getTaxationListAdmin
);
router.delete(
  '/food_taxation/delete_restaurant_taxation/:restaurant',
  webAuth('deleteFoodTaxation'),
  validate(FoodTaxationValidation.deleteAdminValidation),
  FoodTaxationController.deleteTaxationAdmin
);
// Food Taxation Routes //

// Cash In Hand Routes //
router.get(
  '/cashCollection/list',
  webAuth('cashCollectionList'),
  validate(CollectCashValidation.collectCashListValidation),
  CollectCashController.get
);
router.get(
  '/restaurant/getRestaurantByCityCollectCash/:cityId',
  webAuth('getRestaurantByCity'),
  validate(RestaurantValidation.restaurantByCityIdLimitedDetailsValidation),
  RestaurantController.getRestaurantByCityIdFromCollectCash
);
router.get(
  '/restaurant/cashInHand/:vendor',
  webAuth('getRestaurantCashInHand'),
  validate(RestaurantValidation.vendorCashInHandValidation),
  RestaurantController.getRestaurantCashInHand
);
router.post(
  '/restaurant/clearCashInHand',
  webAuth('clearCashInHand'),
  validate(RestaurantValidation.collectCashValidation),
  RestaurantController.clearCashInHandAndUpdateWallet
);
router.get(
  '/deliveryman/cashInHand/:deliveryman',
  webAuth('getDeliverymanCashInHand'),
  validate(DriverValidation.deliverymanCashInHandValidation),
  DriverController.getDeliverymanCashInHand
);
router.post(
  '/deliveryman/clearCashInHand',
  webAuth('clearCashInHand'),
  validate(DriverValidation.collectCashValidation),
  DriverController.clearCashInHand
);
// Cash In Hand Routes //

// Withdrawal Method Routes //
router.post(
  '/withdrawalMethod/create',
  webAuth('createWithdrawalMethod'),
  validate(WithdrawalMethodValidation.createWithdrawalMethodValidation),
  WithdrawalMethodController.create
);
router.get(
  '/withdrawalMethod/list',
  webAuth('getWithdrawalMethodList'),
  validate(WithdrawalMethodValidation.allValidation),
  WithdrawalMethodController.methodList
);
router.get(
  '/withdrawalMethod/detail/:methodId',
  webAuth('getWithdrawalMethodList'),
  validate(WithdrawalMethodValidation.idValidation),
  WithdrawalMethodController.withdrawalMethodDetail
);
router.patch(
  '/withdrawalMethod/update/:methodId',
  webAuth('updateWithdrawalMethod'),
  validate(WithdrawalMethodValidation.idValidation),
  WithdrawalMethodController.update
);
router.patch(
  '/withdrawalMethod/updateDefault/:methodId',
  webAuth('updateDefaultWithdrawalMethod'),
  validate(WithdrawalMethodValidation.idValidation),
  WithdrawalMethodController.updateDefault
);
router.delete(
  '/withdrawalMethod/delete/:methodId',
  webAuth('deleteWithdrawalMethod'),
  validate(WithdrawalMethodValidation.idValidation),
  WithdrawalMethodController.drop
);
// Withdrawal Method Routes //

// Withdrawal Request Routes //
router.get(
  '/withdrawalRequest/restaurant',
  webAuth('getRestaurantWithdrawalRequest'),
  validate(WithdrawalRequestValidation.allValidation),
  WithdrawalRequestController.getRestaurantWithdrawalRequest
);
router.get(
  '/withdrawalRequest/deliveryman',
  webAuth('getDeliverymanWithdrawalRequest'),
  validate(WithdrawalRequestValidation.allValidation),
  WithdrawalRequestController.getDeliverymanWithdrawalRequest
);
router.get(
  '/withdrawalRequest/detail/:id',
  webAuth('getWithdrawalRequestDetail'),
  validate(WithdrawalRequestValidation.idValidation),
  WithdrawalRequestController.withdrawalRequestDetail
);
router.post(
  '/withdrawalRequest/decline',
  webAuth('declineWithdrawalRequest'),
  validate(WithdrawalRequestValidation.declineWithdrawalRequestValidation),
  WithdrawalRequestController.declineWithdrawalRequest
);
router.post(
  '/withdrawalRequest/approve',
  webAuth('approveWithdrawalRequest'),
  validate(WithdrawalRequestValidation.approveWithdrawalRequestValidation),
  WithdrawalRequestController.approveWithdrawalRequest
);
// Withdrawal Request Routes //

// Joining Form Routes //
router.post(
  '/joining_form/restaurant',
  webAuth('saveJoiningForm'),
  validate(JoiningFormValidation.saveRestaurantJoiningFormValidation),
  JoiningFormController.saveRestaurantForm
);
router.post(
  '/joining_form/deliveryman',
  webAuth('saveJoiningForm'),
  validate(JoiningFormValidation.saveRestaurantJoiningFormValidation),
  JoiningFormController.saveDeliverymanForm
);
router.get(
  '/restaurant_joining_form',
  webAuth('getJoinigFormDetail'),
  JoiningFormController.getRestaurantForm
);
router.get(
  '/deliveryman_joining_form',
  webAuth('getJoinigFormDetail'),
  JoiningFormController.getDeliverymanForm
);
// Joining Form Routes //

// Joining Request Routes //
router.get(
  '/restaurant_request/list/:status',
  webAuth('getRestaurantJoiningRequest'),
  validate(RestaurantJoiningRequestValidation.statusValidation),
  RestaurantJoiningRequestController.getJoiningRequestList
);
router.delete(
  '/restaurant_request/delete/:id',
  webAuth('deleteRestaurantJoiningRequest'),
  validate(RestaurantJoiningRequestValidation.idValidation),
  RestaurantJoiningRequestController.deleteRequest
);
router.get(
  '/restaurant_request/detail/:id',
  webAuth('getRestaurantJoiningRequest'),
  validate(RestaurantJoiningRequestValidation.idValidation),
  RestaurantJoiningRequestController.getDetail
);
router.patch(
  '/restaurant_request/reject/:id',
  webAuth('rejectRestaurantJoiningRequest'),
  validate(RestaurantJoiningRequestValidation.rejectValidation),
  RestaurantJoiningRequestController.rejectRequest
);
router.post(
  '/restaurant_request/approve/:id',
  webAuth('acceptRestaurantJoiningRequest'),
  validate(RestaurantJoiningRequestValidation.approveValidation),
  RestaurantJoiningRequestController.approveRequest
);

router.get(
  '/deliveryman_request/list/:status',
  webAuth('getDeliverymanJoiningRequest'),
  validate(DeliverymanJoiningRequestValidation.statusValidation),
  DeliverymanJoiningRequestController.getJoiningRequestList
);
router.delete(
  '/deliveryman_request/delete/:id',
  webAuth('deleteDeliverymanJoiningRequest'),
  validate(DeliverymanJoiningRequestValidation.idValidation),
  DeliverymanJoiningRequestController.deleteRequest
);
router.get(
  '/deliveryman_request/detail/:id',
  webAuth('getDeliverymanJoiningRequest'),
  validate(DeliverymanJoiningRequestValidation.idValidation),
  DeliverymanJoiningRequestController.getDetail
);
router.patch(
  '/deliveryman_request/reject/:id',
  webAuth('rejectDeliverymanJoiningRequest'),
  validate(DeliverymanJoiningRequestValidation.rejectValidation),
  DeliverymanJoiningRequestController.rejectRequest
);
router.post(
  '/deliveryman_request/approve/:id',
  webAuth('acceptDeliverymanJoiningRequest'),
  validate(DeliverymanJoiningRequestValidation.approveValidation),
  DeliverymanJoiningRequestController.approveRequest
);
// Joining Request Routes //

// Invoice Instructions Routes //
router.get(
  '/invoice/instruction/getAll',
  webAuth('getInvoiceInstructions'),
  validate(InvoiceInstructionValidation.allValidation),
  InvoiceInstructionController.get
);
router.post(
  '/invoice/instruction/save',
  webAuth('createInvoiceInstruction'),
  validate(InvoiceInstructionValidation.createInvoiceInstructionValidation),
  InvoiceInstructionController.create
);
router.patch(
  '/invoice/instruction/update/:noticeId',
  webAuth('updateInvoiceInstruction'),
  validate(InvoiceInstructionValidation.idValidation),
  InvoiceInstructionController.update
);
router.delete(
  '/invoice/instruction/delete/:noticeId',
  webAuth('deleteInvoiceInstruction'),
  validate(InvoiceInstructionValidation.idValidation),
  InvoiceInstructionController.drop
);
// Invoice Instructions Routes //

// Customer Routes //
router.get('/customer/getList', webAuth('getCustomerList'), UserController.customerList);
router.patch(
  '/customer/update/:id',
  webAuth('updateCustomerStatus'),
  validate(UserValidation.updateStatusValidation),
  UserController.updateStatus
);
router.get(
  '/customer/loyaltyPointsReport',
  webAuth('loyaltyPointsReport'),
  validate(UserValidation.loyalityPointValidation),
  LoyaltyPointsController.loyalityPointReport
);
router.get(
  '/customer/walletFundList',
  webAuth('walletFundList'),
  UserController.customerWalletFundList
);
router.post(
  '/customer/wallet/addFund',
  webAuth('addWalletFund'),
  validate(WalletValidation.adminAddWalletFundValidation),
  WalletController.adminAddWalletFund
);
// Customer Routes //

// Wallet Bonus Routes //
router.post(
  '/wallet/bonus/save',
  webAuth('createWalletBonus'),
  validate(WalletBonusValidation.createBonusValidation),
  WalletBonusController.create
);
router.get(
  '/wallet/bonus/getAll',
  webAuth('getWalletBonus'),
  validate(WalletBonusValidation.allValidation),
  WalletBonusController.getAll
);
router.patch(
  '/wallet/bonus/updateStatus/:id',
  webAuth('updateWalletBonus'),
  validate(WalletBonusValidation.updateStatusValidation),
  WalletBonusController.updateStatus
);
router.delete(
  '/wallet/bonus/delete/:id',
  webAuth('deleteBonus'),
  validate(WalletBonusValidation.idValidation),
  WalletBonusController.drop
);
router.patch(
  '/wallet/bonus/update/:id',
  webAuth('updateWalletBonus'),
  validate(WalletBonusValidation.updateValidation),
  WalletBonusController.updateData
);
// Wallet Bonus Routes //

// Admin Expense Routes //
router.post(
  '/expense/save',
  webAuth('saveAdminExpense'),
  validate(AdminExpenseValidation.saveExpenseValidation),
  AdminExpenseController.create
);
// Admin Expense Routes //

// Report Routes //
router.get(
  '/reports/wallet_transaction/',
  webAuth('walletTransactionReport'),
  WalletController.getTransactionReport
);
router.get(
  '/reports/payment_transaction/',
  webAuth('paymentTransactionReport'),
  validate(PaymentConfigValidation.allPaymentValidation),
  PaymentInitiationController.getPaymentInitiateReport
);
router.get('/reports/food_report/', webAuth('foodReport'), FoodController.foodReport);
router.get(
  '/reports/restaurantInitial',
  webAuth('restaurantReport'),
  RestaurantController.restauratReportInitialFilter
);
router.get(
  '/reports/restaurant',
  webAuth('restaurantReport'),
  RestaurantController.restaurantReport
);
router.get('/reports/customer', webAuth('customerReport'), UserController.customerReport);
router.get(
  '/reports/deliveryman',
  webAuth('deliverymanReport'),
  DriverController.deliverymanReport
);
router.get(
  '/reports/orders',
  webAuth('orderReport'),
  validate(OrdersValidation.orderReportValidation),
  OrdersController.orderReports
);
router.get(
  '/reports/posOrders',
  webAuth('orderReport'),
  validate(OrdersValidation.orderReportValidation),
  PosOrTableOrderController.posOrderReport
);
router.get(
  '/reports/tableOrders',
  webAuth('orderReport'),
  validate(OrdersValidation.orderReportValidation),
  TableOrderController.tableOrderReport
);
router.get(
  '/reports/diningBooking',
  webAuth('orderReport'),
  DiningBookingController.diningBookingReport
);
router.get(
  '/reports/expenseInitial',
  webAuth('expenseReport'),
  AdminExpenseController.getInitialResponse
);
router.get('/reports/expense', webAuth('expenseReport'), AdminExpenseController.getExpenseList);
router.get(
  '/reports/disbursementReportInitial',
  webAuth('disbursementReport'),
  DisbursementController.disbursementTransactionInitial
);
router.get(
  '/reports/restaurantDisbursement',
  webAuth('disbursementReport'),
  DisbursementController.restaurantDisbursementTransactionReport
);
router.get(
  '/reports/deliverymanDisbursementReportInitial',
  webAuth('disbursementReport'),
  DisbursementController.deliverymanDisbursementTransactionInitial
);
router.get(
  '/reports/deliverymanDisbursement',
  webAuth('disbursementReport'),
  DisbursementController.deliverymanDisbursementTransactionReport
);
// Report Routes //

// Disbursement //
router.get(
  '/disbursement/restaurant',
  webAuth('restaurantDisbursement'),
  DisbursementController.restaurantDisbursement
);
router.get(
  '/disbursement/deliveryman',
  webAuth('deliverymanDisbursement'),
  DisbursementController.deliverymanDisbursement
);
router.get(
  '/disbursement/restaurantReport/:id',
  webAuth('restaurantDisbursement'),
  validate(DisbursementValidation.disbursementReportValidation),
  DisbursementController.restaurantDisbursementReport
);
router.get(
  '/disbursement/deliverymanReport/:id',
  webAuth('deliverymanDisbursement'),
  validate(DisbursementValidation.disbursementReportValidation),
  DisbursementController.deliverymanDisbursementReport
);
router.get(
  '/disbursement/restaurantDisbursementDetail/:id',
  webAuth('restaurantDisbursement'),
  validate(DisbursementValidation.disbursementReportValidation),
  DisbursementController.restaurantDisbursementDetail
);
router.get(
  '/disbursement/deliverymanDisbursementDetail/:id',
  webAuth('deliverymanDisbursement'),
  validate(DisbursementValidation.disbursementReportValidation),
  DisbursementController.deliverymanDisbursementDetail
);
router.get(
  '/disbursement/acceptRestaurantDisbursement/:id',
  webAuth('restaurantDisbursement'),
  validate(DisbursementValidation.disbursementReportValidation),
  DisbursementController.acceptRestaurantDisburment
);
router.get(
  '/disbursement/rejectRestaurantDisbursement/:id',
  webAuth('restaurantDisbursement'),
  validate(DisbursementValidation.disbursementReportValidation),
  DisbursementController.rejectRestaurantDisburment
);

router.get(
  '/disbursement/acceptDeliverymanDisbursement/:id',
  webAuth('deliverymanDisbursement'),
  validate(DisbursementValidation.disbursementReportValidation),
  DisbursementController.acceptDeliverymanDisbursment
);
router.get(
  '/disbursement/rejectDeliverymanDisbursement/:id',
  webAuth('deliverymanDisbursement'),
  validate(DisbursementValidation.disbursementReportValidation),
  DisbursementController.rejectDeliverymanDisbursment
);
// Disbursement //

// Customer Detail Routes //
router.get('/customer/orderList', webAuth('customerDetail'), OrdersController.customerOrderList);
router.get(
  '/customer/diningBookingList',
  webAuth('customerDetail'),
  DiningBookingController.customerDiningBooking
);
router.get(
  '/customer/deliveryAddressList',
  webAuth('customerDetail'),
  UserAddressController.customerAddressList
);
router.get(
  '/customer/purchasedTiffinPackages',
  webAuth('customerDetail'),
  UserPurchasedTiffinSubscriptionController.customerPurchasedPackages
);
router.get(
  '/customer/customerAllRefundRequest',
  webAuth('customerDetail'),
  OrdersController.customerAllRefundRequest
);
router.get(
  '/customer/customerOrderRefundList',
  webAuth('customerDetail'),
  OrdersController.customerOrderRefundList
);
router.get(
  '/customer/customerTiffinRefundList',
  webAuth('customerDetail'),
  OrdersController.customerTiffinRefundList
);
router.get(
  '/customer/customerBookingRefundList',
  webAuth('customerDetail'),
  OrdersController.customerBookingRefundList
);
router.get(
  '/customer/customerComplaintList',
  webAuth('customerDetail'),
  ComplaintsController.customerComplaintList
);
router.get(
  '/customer/customerAllFavourite',
  webAuth('customerDetail'),
  FavouriteController.customerAllFavourite
);
router.get(
  '/customer/customerFavouriteOrders',
  webAuth('customerDetail'),
  FavouriteController.customerFavouriteOrders
);
router.get(
  '/customer/customerFavouriteRestaurant',
  webAuth('customerDetail'),
  FavouriteController.customerFavouriteRestaurant
);
router.get(
  '/customer/customerFavouriteFood',
  webAuth('customerDetail'),
  FavouriteController.customerFavouriteFood
);
router.get(
  '/customer/customerHiddenRestaurants',
  webAuth('customerDetail'),
  HideRestaurantController.customerHiddenRestaurants
);
router.get(
  '/customer/detail/:user',
  webAuth('customerDetail'),
  validate(UserValidation.idValidation),
  UserController.customerDetail
);
router.get(
  '/customer/customerMediaFiles',
  webAuth('customerDetail'),
  MediaController.customerMediaFiles
);
router.get(
  '/customer/customerAllReviews',
  webAuth('customerDetail'),
  ReviewRatingController.customerAllReviews
);
router.get(
  '/customer/customerRestaurantReview',
  webAuth('customerDetail'),
  ReviewRatingController.customerRestaurantReview
);
router.get(
  '/customer/customerFoodReview',
  webAuth('customerDetail'),
  ReviewRatingController.customerFoodReview
);
router.get(
  '/customer/customerDeliverymanReview',
  webAuth('customerDetail'),
  ReviewRatingController.customerDeliverymanReview
);
router.get(
  '/customer/wallet_transactions',
  webAuth('customerDetail'),
  WalletController.customerTransactionList
);
// Customer Detail Routes //

// Restaurant Detail Routes //
router.get(
  '/vendor_detail/orderList',
  webAuth('restaurantDetail'),
  OrdersController.vendorOrderList
);
router.get(
  '/vendor_detail/pos_order_list',
  webAuth('restaurantDetail'),
  PosOrTableOrderController.vendorPosOrderList
);
router.get(
  '/vendor_detail/table_order_list',
  webAuth('restaurantDetail'),
  TableOrderController.vendorTableOrderList
);
router.get(
  '/vendor_detail/booking_list',
  webAuth('restaurantDetail'),
  DiningBookingController.vendorBookingList
);
router.get('/vendor_detail/food_list', webAuth('restaurantDetail'), FoodController.vendorFoodList);
router.get(
  '/vendor_detail/waiter_list',
  webAuth('restaurantDetail'),
  WaiterController.vendorWaiterList
);
router.get(
  '/vendor_detail/deliveryman_list',
  webAuth('restaurantDetail'),
  DriverController.vendorDeliverymanList
);
router.get(
  '/vendor_detail/tiffin_package_list',
  webAuth('restaurantDetail'),
  SubscriptionTiffinPackageController.vendorTiffinPackageList
);
router.get(
  '/vendor_detail/complaints',
  webAuth('restaurantDetail'),
  ComplaintsController.vendorComplaintList
);
router.get(
  '/vendor_detail/complaint_orders',
  webAuth('restaurantDetail'),
  ComplaintsController.vendorUserOrderComplaintList
);
router.get(
  '/vendor_detail/complaint_vendor',
  webAuth('restaurantDetail'),
  ComplaintsController.vendorOwnOrderComplaintList
);
router.get(
  '/vendor_detail/all_refund_request',
  webAuth('restaurantDetail'),
  OrdersController.vendorAllRefundRequest
);
router.get(
  '/vendor_detail/order_refund_request',
  webAuth('restaurantDetail'),
  OrdersController.vendorOrderRefundRequest
);
router.get(
  '/vendor_detail/dining_refund_request',
  webAuth('restaurantDetail'),
  OrdersController.vendorDiningRefundRequest
);
router.get(
  '/vendor_detail/tiffin_subscription_refund_request',
  webAuth('restaurantDetail'),
  OrdersController.vendorTiffinRefundRequest
);
router.get(
  '/vendor_detail/media_files',
  webAuth('restaurantDetail'),
  MediaController.vendorMediaFiles
);
router.get(
  '/vendor_detail/outlet_list',
  webAuth('restaurantDetail'),
  RestaurantController.vendorOutletList
);
router.get(
  '/vendor_detail/disbursement_list',
  webAuth('restaurantDetail'),
  DisbursementController.vendorDisbursementList
);
router.get(
  '/vendor_detail/collected_cash_list',
  webAuth('restaurantDetail'),
  CollectCashController.vendorCollectedCashList
);
router.get(
  '/vendor_detail/withdrawal_request_list',
  webAuth('restaurantDetail'),
  WithdrawalRequestController.vendorWithdrawalRequest
);
router.get(
  '/vendor_detail/payout_accounts',
  webAuth('restaurantDetail'),
  RestaurantPayoutMethodController.vendorPayoutAccounts
);
router.get(
  '/vendor_detail/all_reviews',
  webAuth('restaurantDetail'),
  ReviewRatingController.vendorAllReviews
);
router.get(
  '/vendor_detail/vendor_reviews',
  webAuth('restaurantDetail'),
  ReviewRatingController.vendorReviews
);
router.get(
  '/vendor_detail/vendor_food_reviews',
  webAuth('restaurantDetail'),
  ReviewRatingController.vendorFoodReviews
);
router.get(
  '/vendor_detail/information/:id',
  webAuth('restaurantDetail'),
  validate(RestaurantValidation.vendorInformationValidation),
  RestaurantController.vendorInformation
);
router.get(
  '/vendor_detail/wallet_transactions',
  webAuth('restaurantDetail'),
  WalletController.vendorTransactionList
);
router.get(
  '/vendor_detail/kitchen_owner_list',
  webAuth('restaurantDetail'),
  KitchenOwnerController.vendorKitchenOwnerList
);
// Restaurant Detail Routes //

// Deliveryman Detail Routes //
router.get(
  '/deliveryman_detail/information/:id',
  webAuth('deliverymanDetail'),
  validate(DriverValidation.deliverymanInformationValidation),
  DriverController.deliverymanInformation
);
router.get(
  '/deliveryman_detail/order_list',
  webAuth('deliverymanDetail'),
  OrdersController.deliverymanOrderList
);
router.get(
  '/deliveryman_detail/disbursement_list',
  webAuth('deliverymanDetail'),
  DisbursementController.deliverymanDisbursementList
);
router.get(
  '/deliveryman_detail/collected_cash_list',
  webAuth('deliverymanDetail'),
  CollectCashController.deliverymanCollectedCashList
);
router.get(
  '/deliveryman_detail/payout_accounts',
  webAuth('deliverymanDetail'),
  DeliverymanPayoutMethodController.deliverymanPayoutAccounts
);
router.get(
  '/deliveryman_detail/withdrawal_request_list',
  webAuth('deliverymanDetail'),
  WithdrawalRequestController.deliverymanWithdrawalRequest
);
router.get(
  '/deliveryman_detail/reviews',
  webAuth('deliverymanDetail'),
  ReviewRatingController.deliverymanReviews
);
router.get(
  '/deliveryman_detail/media_files',
  webAuth('deliverymanDetail'),
  MediaController.deliverymanMediaFiles
);
router.get(
  '/deliveryman_detail/complaints',
  webAuth('deliverymanDetail'),
  ComplaintsController.deliverymanComplaintList
);
router.get(
  '/deliveryman_detail/complaint_orders',
  webAuth('deliverymanDetail'),
  ComplaintsController.deliverymanUserOrderComplaintList
);
router.get(
  '/deliveryman_detail/complaint_vendor',
  webAuth('deliverymanDetail'),
  ComplaintsController.deliverymanRestaurantComplaintList
);
router.get(
  '/deliveryman_detail/wallet_transactions',
  webAuth('deliverymanDetail'),
  WalletController.deliverymanTransactionList
);
//
// Deliveryman Detail Routes //

// POS Routes //
router.get('/pos/initial', webAuth('posOrder'), CityController.posCities);
router.get(
  '/pos/restaurants/:cityId',
  webAuth('posOrder'),
  validate(RestaurantValidation.cityIdValidation),
  RestaurantController.posRestaurantListFromCity
);
router.get(
  '/pos/categories/:restaurantId',
  webAuth('posOrder'),
  validate(RestaurantValidation.idValidation),
  RestaurantController.posRestaurantData
);
router.post(
  '/pos/food_list/',
  webAuth('posOrder'),
  validate(RestaurantValidation.posFoodListWebValidation),
  RestaurantController.getPosFoodDataWeb
);
router.get(
  '/pos/search/:vendor/:searchQuery',
  webAuth('posOrder'),
  validate(RestaurantValidation.posFoodSearchValidation),
  RestaurantController.posFoodSearch
);
router.post(
  '/pos/createCustomer',
  webAuth('createCustomer'),
  validate(AuthValidation.adminAddCustomerValidation),
  UserController.adminCreateCustomer
);
router.get(
  '/pos/customer_detail/:user',
  webAuth('posOrder'),
  validate(UserValidation.idValidation),
  UserController.adminPosCustomerDetail
);
router.post(
  '/pos/place_order',
  webAuth('posOrder'),
  validate(OrdersValidation.adminPOSOrderValidation),
  OrdersController.placePOSAdminOrder
);
// POS Routes //

// Roles Routes //
router.get(
  '/auth_roles/role_account_list',
  webAuth('manage_role'),
  validate(AuthValidation.roleAccountListValidation),
  AuthController.getRoleAccountList
);
router.post(
  '/auth_roles/new_admin',
  webAuth('manage_role'),
  validate(AuthValidation.roleValidation),
  AuthController.addAdminAccount
);
router.get(
  '/auth_roles/detail/:id',
  webAuth('manage_role'),
  validate(AuthValidation.roleAccountDetailValidation),
  AuthController.roleAccountDetail
);
router.patch(
  '/auth_roles/update_status/:id',
  webAuth('manage_role'),
  validate(AuthValidation.updateRoleStatusValidation),
  AuthController.updateRoleStatus
);
router.patch(
  '/auth_roles/update_detail/:id',
  webAuth('manage_role'),
  validate(AuthValidation.updateRoleDetailValidation),
  AuthController.updateRoleDetail
);
router.post(
  '/auth_roles/new_accountant',
  webAuth('manage_role'),
  validate(AuthValidation.roleValidation),
  AuthController.addAccountantAccount
);
router.post(
  '/auth_roles/new_support_team',
  webAuth('manage_role'),
  validate(AuthValidation.roleValidation),
  AuthController.addSupportTeamAccount
);
router.get(
  '/auth_roles/city_master_list',
  webAuth('manage_role'),
  validate(AuthValidation.cityZenAccountListValidation),
  AuthController.cityMasterList
);
router.post(
  '/auth_roles/new_city_master',
  webAuth('manage_role'),
  validate(AuthValidation.cityRoleValidation),
  AuthController.addCityMaterAccount
);
router.get(
  '/auth_roles/city_master_detail/:id',
  webAuth('manage_role'),
  validate(AuthValidation.roleAccountDetailValidation),
  AuthController.cityMasterAccountDetail
);
router.patch(
  '/auth_roles/update_city_master/:id',
  webAuth('manage_role'),
  validate(AuthValidation.updateCityMasterValidation),
  AuthController.updateCityMasterDetail
);
// Roles Routes //

// Admin Profile //
router.get(
  '/admin_profile/:id',
  webAuth('admin_profile'),
  validate(UserValidation.adminProfileValidation),
  UserController.getAdminProfile
);
router.patch(
  '/update_admin/:id',
  webAuth('update_admin'),
  validate(UserValidation.updateAdminProfileValidation),
  UserController.updateAdminProfile
);
router.patch(
  '/update_admin_password/:id',
  webAuth('update_admin_password'),
  validate(UserValidation.updateAdminPasswordValidation),
  UserController.updateAdminPassword
);
// Admin Profile //

// User Account Delete Reason Routes //
router.post(
  '/delete_account_reason/save',
  webAuth('create_user_delete_account_reason'),
  validate(UserAccountDeleteReasonValidation.createAccountDeleteReasonValidation),
  UserDeleteAccountReasonController.create
);
router.patch(
  '/update_delete_account_reason/:reasonId',
  webAuth('update_delete_account_reason'),
  validate(UserAccountDeleteReasonValidation.idValidation),
  UserDeleteAccountReasonController.update
);
router.get(
  '/delete_account_reason_list',
  webAuth('delete_account_reason_list'),
  validate(UserAccountDeleteReasonValidation.allValidation),
  UserDeleteAccountReasonController.get
);
router.delete(
  '/drop_delete_account_reason/:reasonId',
  webAuth('drop_delete_account_reason'),
  validate(UserAccountDeleteReasonValidation.idValidation),
  UserDeleteAccountReasonController.drop
);
// User Account Delete Reason Routes //

// Deleted Account Routes //
router.get(
  '/customer/deleted_accounts',
  webAuth('customer_deleted_accounts'),
  validate(UserValidation.deletedAccountValidation),
  UserController.customerDeletedAccount
);
router.get(
  '/waiters/deleted_waiter',
  webAuth('waiter_deleted_accounts'),
  validate(UserValidation.deletedAccountValidation),
  UserController.waiterDeletedAccount
);
router.get(
  '/deliveryman/deleted_deliveryman',
  webAuth('deliveryman_deleted_accounts'),
  validate(UserValidation.deletedAccountValidation),
  UserController.deliverymanDeletedAccount
);
router.get(
  '/restaurants/deleted_restaurants',
  webAuth('restaurant_deleted_accounts'),
  validate(UserValidation.deletedAccountValidation),
  UserController.restaurantDeletedAccount
);
router.get(
  '/kitchen/deleted_kitchen_owner',
  webAuth('deleted_kitchen_owner'),
  validate(UserValidation.deletedAccountValidation),
  UserController.kitchenDeletedAccount
);
// Deleted Account Routes //

// Notification Routes //
router.post(
  '/send_notification',
  webAuth('send_notification'),
  validate(UserValidation.sendNotificationValidation),
  FcmController.adminSendNotification
);
router.get(
  '/admin_header_content',
  webAuth('admin_header_content'),
  NotificationListController.adminHeaderContent
);
router.get(
  '/notification_list',
  webAuth('notification_list'),
  NotificationListController.adminNotificationList
);
router.get('/regular_chat_list', webAuth('regular_chat_list'), ChatRoomController.adminChatList);
router.get(
  '/support_chat_list',
  webAuth('support_chat_list'),
  SupportChatRoomController.adminSupportChatList
);
router.get(
  '/regular_chat_messages/:id',
  webAuth('regular_chat_messages'),
  validate(ChatRoomValidation.adminChatMessagesValidation),
  ChatRoomController.adminGetChatMessages
);
router.get(
  '/support_chat_messages/:id',
  webAuth('support_chat_messages'),
  validate(ChatRoomValidation.adminChatMessagesValidation),
  SupportChatRoomController.adminChatMessages
);
router.post(
  '/chat_room/send_regular_message/',
  webAuth('send_regular_message'),
  validate(ChatRoomValidation.sendChatMessageValidation),
  ChatRoomController.saveNewMessage
);
router.post(
  '/chat_room/send_support_message/',
  webAuth('send_support_message'),
  validate(ChatRoomValidation.sendChatMessageValidation),
  SupportChatRoomController.saveSupportMessage
);
// Notification Routes //

// Admin User Contact Detail Routes //
router.get(
  '/user_contact_detail/:id',
  webAuth('user_contact_detail'),
  validate(UserValidation.adminUserContactDetailValidation),
  UserController.adminUserContactDetail
);
// Admin User Contact Detail Routes //
// Import & Export Routes //
router.get(
  '/cities/export/',
  webAuth('export_collection'),
  validate(CityValidation.exportValidation),
  CityController.exportCollection
);
router.get(
  '/localities/export/',
  webAuth('export_collection'),
  validate(LocalityValidation.exportValidation),
  LocalityController.exportCollection
);
router.get(
  '/cuisine/export/',
  webAuth('export_collection'),
  validate(CuisineValidation.exportValidation),
  CuisineController.exportCollection
);
router.get(
  '/report_issue/restaurant/export/',
  webAuth('export_collection'),
  validate(ReportIssueRestaurantReasonValidation.exportValidation),
  ReportIssueRestaurantReasonController.exportCollection
);
router.get(
  '/hide_reason/export/',
  webAuth('export_collection'),
  validate(HideRestaurantReasonValidation.exportValidation),
  HideRestaurantReasonController.exportCollection
);
router.get(
  '/restaurant_type/export/',
  webAuth('export_collection'),
  validate(RestaurantTypeValidation.exportValidation),
  RestaurantTypeController.exportCollection
);
router.get(
  '/restaurant_facilities/export/',
  webAuth('export_collection'),
  validate(RestaurantFacilitiesValidation.exportValidation),
  RestaurantFacilitiesController.exportCollection
);
router.get(
  '/category/export/',
  webAuth('export_collection'),
  validate(CategoryValidation.exportValidation),
  CategoryController.exportCollection
);
router.get(
  '/sub_category/export/',
  webAuth('export_collection'),
  validate(SubCategoryValidation.exportValidation),
  SubCategoryController.exportCollection
);
router.get(
  '/vehicle/export/',
  webAuth('export_collection'),
  validate(VehicleValidation.exportValidation),
  VehicleController.exportCollection
);
router.get(
  '/deliveryshift_schedule/export/',
  webAuth('export_collection'),
  validate(DeliveryShiftScheduleValidation.exportValidation),
  DeliveryShiftScheduleController.exportCollection
);
router.get(
  '/auth_roles/admin/export/',
  webAuth('export_collection'),
  validate(UserValidation.exportRoleValidation),
  AuthController.exportCollectionAdminRole
);
router.get(
  '/auth_roles/accountant/export/',
  webAuth('export_collection'),
  validate(UserValidation.exportRoleValidation),
  AuthController.exportCollectionAccountantRole
);
router.get(
  '/auth_roles/support_team/export/',
  webAuth('export_collection'),
  validate(UserValidation.exportRoleValidation),
  AuthController.exportCollectionSupportRole
);
router.get(
  '/auth_roles/cityzen/export/',
  webAuth('export_collection'),
  validate(UserValidation.exportRoleValidation),
  AuthController.exportCollectionCityzenRole
);
router.get(
  '/restaurant_all_data/export/',
  webAuth('export_collection'),
  validate(RestaurantValidation.exportValidation),
  RestaurantController.exportCollectionRestaurantAllData
);
router.get(
  '/outlet_all_data/export/',
  webAuth('export_collection'),
  validate(RestaurantValidation.exportValidation),
  RestaurantController.exportCollectionOutletAllData
);
router.get(
  '/report_issue_list/restaurant/export/',
  webAuth('export_collection'),
  validate(ReportIssueRestaurantReasonValidation.restaurantReportExportValidation),
  ReportIssueRestaurantController.exportCollection
);
router.get(
  '/hidden_restaurants/export/',
  webAuth('export_collection'),
  validate(HideRestaurantReasonValidation.exportValidation),
  HideRestaurantController.exportCollection
);
router.get(
  '/waiter/export/',
  webAuth('export_collection'),
  validate(WaiterValidation.exportValidation),
  WaiterController.exportCollection
);
router.get(
  '/kitchen_owners/export/',
  webAuth('export_collection'),
  validate(KitchenOwnerValidation.exportValidation),
  KitchenOwnerController.exportCollection
);
router.get(
  '/restaurant_request/export/',
  webAuth('export_collection'),
  validate(RestaurantJoiningRequestValidation.exportValidation),
  RestaurantJoiningRequestController.exportCollection
);
router.get(
  '/order_cancel_reason/export/',
  webAuth('export_collection'),
  validate(OrderCancellationReasonValidation.exportValidation),
  OrderCancellationReasonController.exportCollection
);
router.get(
  '/order_rating_message/export/',
  webAuth('export_collection'),
  validate(OrderRatingMessageValidation.exportValidation),
  OrderRatingMessageController.exportCollection
);
router.get(
  '/invoice_instruction/export/',
  webAuth('export_collection'),
  validate(InvoiceInstructionValidation.exportValidation),
  InvoiceInstructionController.exportCollection
);
router.get(
  '/restaurant_food_license/export/',
  webAuth('export_collection'),
  validate(RestaurantFoodLicenseValidation.exportValidation),
  RestaurantFoodLicenseController.exportCollection
);
router.get(
  '/restaurant_notice/export/',
  webAuth('export_collection'),
  validate(RestaurantNoticeValidation.exportValidation),
  RestaurantNoticeController.exportCollection
);
router.get(
  '/delivery_instruction/export/',
  webAuth('export_collection'),
  validate(DeliveryInstructionValidation.exportValidation),
  DeliveryInstructionController.exportCollection
);
router.get(
  '/gratitude/export/',
  webAuth('export_collection'),
  validate(DeliveryGratitudeValidation.exportValidation),
  DeliveryGratitudeController.exportCollection
);
router.get(
  '/driver_incentive/export/',
  webAuth('export_collection'),
  validate(DriverIncentiveValidation.exportValidation),
  DriverIncentiveController.exportCollection
);
router.get(
  '/driver_offline_messages/export/',
  webAuth('export_collection'),
  validate(DriverOfflineMessagesValidation.exportValidation),
  DriverOfflineMessagesController.exportCollection
);
router.get(
  '/delete_account_reason_list/export/',
  webAuth('export_collection'),
  validate(UserAccountDeleteReasonValidation.exportValidation),
  UserDeleteAccountReasonController.exportCollection
);
router.get(
  '/dining_category/export/',
  webAuth('export_collection'),
  validate(DiningCategoryValidation.exportValidation),
  DiningCategoryController.exportCollection
);
router.get(
  '/dining_cancel_reason/export/',
  webAuth('export_collection'),
  validate(DiningCancellationReasonValidation.exportValidation),
  DiningCancellationReasonController.exportCollection
);
router.get(
  '/dining_notice/export/',
  webAuth('export_collection'),
  validate(DiningNoticeValidation.exportValidation),
  DiningNoticeController.exportCollection
);
router.get(
  '/language/export/',
  webAuth('export_collection'),
  validate(LanguageValidation.exportValidation),
  LangaugeController.exportCollection
);
router.get(
  '/user_avatar/export/:type',
  webAuth('export_collection'),
  validate(UserValidation.exportValidation),
  UserAvatarController.exportCollection
);
router.get(
  '/addons/export/',
  webAuth('export_collection'),
  validate(AddonsValidation.exportValidation),
  AddonsController.exportCollection
);
router.get(
  '/food_taxation/export/',
  webAuth('export_collection'),
  validate(FoodTaxationValidation.exportValidation),
  FoodTaxationController.exportCollection
);
router.get(
  '/subscription/export/',
  webAuth('export_collection'),
  validate(SubscriptionValidation.exportValidation),
  SubscriptionController.exportCollection
);
router.get(
  '/subscriber/export/',
  webAuth('export_collection'),
  validate(SubscriberValidation.exportValidation),
  SubscriberController.exportCollection
);
router.get(
  '/foods/export/',
  webAuth('export_collection'),
  validate(FoodValidation.exportValidation),
  FoodController.exportCollection
);
router.get(
  '/feedback/export/',
  webAuth('export_collection'),
  validate(FeedbackFormValidation.exportValidation),
  FeedbackFormController.exportCollection
);
router.get(
  '/report_emergency/export/',
  webAuth('export_collection'),
  validate(ReportEmergencyValidation.exportValidation),
  ReportEmergencyController.exportCollection
);
router.get(
  '/wallet_bonus/export/',
  webAuth('export_collection'),
  validate(WalletBonusValidation.exportValidation),
  WalletBonusController.exportCollection
);
router.get(
  '/customer/deleted_accounts/export/',
  webAuth('export_collection'),
  validate(UserValidation.exportDeletedAccountValidation),
  UserController.exportCollectionCustomerDeletedAccounts
);
router.get(
  '/restaurants/deleted_restaurants/export/',
  webAuth('export_collection'),
  validate(UserValidation.exportDeletedAccountValidation),
  UserController.exportCollectionRestaurantDeletedAccounts
);
router.get(
  '/deliveryman/deleted_deliveryman/export/',
  webAuth('export_collection'),
  validate(UserValidation.exportDeletedAccountValidation),
  UserController.exportCollectionDeliverymanDeletedAccounts
);
router.get(
  '/waiters/deleted_waiter/export/',
  webAuth('export_collection'),
  validate(UserValidation.exportDeletedAccountValidation),
  UserController.exportCollectionWaiterDeletedAccounts
);
router.get(
  '/kitchen/deleted_kitchen_owner/export/',
  webAuth('export_collection'),
  validate(UserValidation.exportDeletedAccountValidation),
  UserController.exportCollectionKitchenOwnerDeletedAccounts
);
router.get(
  '/medias/export/:type',
  webAuth('export_collection'),
  validate(UserValidation.exportValidation),
  MediaController.exportCollection
);
router.get(
  '/restaurant_campaign/export/',
  webAuth('export_collection'),
  validate(RestaurantCampaignValidation.exportValidation),
  RestaurantCampaignController.exportCollection
);
router.get(
  '/dining_campaign/export/',
  webAuth('export_collection'),
  validate(DiningCampaignValidation.exportValidation),
  DiningCampaignController.exportCollection
);
router.get(
  '/food_campaign/export/',
  webAuth('export_collection'),
  validate(FoodCampaignValidation.exportValidation),
  FoodCampaignController.exportCollection
);
router.get(
  '/banners/export/',
  webAuth('export_collection'),
  validate(BannersValidation.exportValidation),
  BannersController.exportCollection
);
router.get(
  '/coupon/export/',
  webAuth('export_collection'),
  validate(CouponValidation.exportValidation),
  CouponController.exportCollection
);
router.get(
  '/dining_coupon/export/',
  webAuth('export_collection'),
  validate(DiningCouponValidation.exportValidation),
  DiningCouponController.exportCollection
);
router.get(
  '/cash_collected/export/',
  webAuth('export_collection'),
  validate(CollectCashValidation.exportValidation),
  CollectCashController.exportCollection
);
router.get(
  '/complaints_reason/export/',
  webAuth('export_collection'),
  validate(ComplaintsReasonValidation.exportValidation),
  ComplaintsReasonController.exportCollection
);
router.get(
  '/complaints/export/',
  webAuth('export_collection'),
  validate(UserValidation.adminComplaintExportValidation),
  ComplaintsController.exportCollection
);
router.get(
  '/restaurant_complaints/export/',
  webAuth('export_collection'),
  validate(UserValidation.adminRestaurantComplaintExportValidation),
  RestaurantComplaintsController.exportCollection
);
router.get(
  '/refund_request_reason/export/',
  webAuth('export_collection'),
  validate(RefundRequestReasonValidation.exportValidation),
  RefundRequestReasonController.exportCollection
);
router.get(
  '/tiffin_subscription_refund_request_reason/export/',
  webAuth('export_collection'),
  validate(TiffinSubscriptionRefundRequestReasonValidation.exportValidation),
  TiffinSubscriptionRefundRequestReasonController.exportCollection
);
router.get(
  '/dining_booking_refund_request_reason/export/',
  webAuth('export_collection'),
  validate(DiningBookingRefundRequestReasonValidation.exportValidation),
  DiningBookingRefundRequestReasonController.exportCollection
);
router.get(
  '/tiffin_subscription_cancel_reason/export/',
  webAuth('export_collection'),
  validate(TiffinSubscriptionCancellationReasonValidation.exportValidation),
  TiffinSubscriptionCancellationReasonController.exportCollection
);
router.get(
  '/orders/export/',
  webAuth('export_collection'),
  validate(OrdersValidation.exportValidation),
  OrdersController.exportQueryCollection
);
router.get(
  '/unassigned_orders/export/',
  webAuth('export_collection'),
  validate(OrdersValidation.exportUnassignedValidation),
  OrdersController.exportUnAssignedOrderCollection
);
router.get(
  '/subscription_orders/export/',
  webAuth('export_collection'),
  validate(OrdersValidation.exportUnassignedValidation),
  OrdersController.exportSubscriptionOrderCollection
);
router.get(
  '/pos_orders/export/',
  webAuth('export_collection'),
  validate(PosOrTableOrderValidation.exportValidation),
  PosOrTableOrderController.exportCollection
);
router.get(
  '/table_orders/export/',
  webAuth('export_collection'),
  validate(TableOrderValidation.exportValidation),
  TableOrderController.exportCollection
);
router.get(
  '/tiffin_packages/export',
  webAuth('export_collection'),
  validate(SubscriptionTiffinPackageValidation.exportValidation),
  SubscriptionTiffinPackageController.exportCollection
);
router.get(
  '/dining_booking/export/',
  webAuth('export_collection'),
  validate(DiningBookingValidation.exportValidation),
  DiningBookingController.exportCollection
);
router.get(
  '/refund_request/export/',
  webAuth('export_collection'),
  validate(RefundRequestValidation.exportValidation),
  RefundRequestController.exportQueryCollection
);
router.get(
  '/tiffin_subscription_refund_request/export/',
  webAuth('export_collection'),
  validate(TiffinSubscriptionRefundRequestValidation.exportValidation),
  TiffinSubscriptionRefundRequestController.exportQueryCollection
);
router.get(
  '/dining_booking_refund_request/export/',
  webAuth('export_collection'),
  validate(DiningBookingRefundRequestValidation.exportValidation),
  DiningBookingRefundRequestController.exportQueryCollection
);
router.get(
  '/system_deliveryman/export/',
  webAuth('export_collection'),
  validate(DriverValidation.exportValidation),
  DriverController.exportSystemDeliverymanCollection
);
router.get(
  '/vendor_deliveryman/export/',
  webAuth('export_collection'),
  validate(DriverValidation.exportValidation),
  DriverController.exportVendorDeliverymanCollection
);
router.get(
  '/withdrawal_method/export/',
  webAuth('export_collection'),
  validate(WithdrawalMethodValidation.exportValidation),
  WithdrawalMethodController.exportCollection
);
router.get(
  '/restaurant_withdrawal_request/export/',
  webAuth('export_collection'),
  validate(WithdrawalRequestValidation.exportValidation),
  WithdrawalRequestController.exportRestaurantRequestCollection
);
router.get(
  '/deliveryman_withdrawal_request/export/',
  webAuth('export_collection'),
  validate(WithdrawalRequestValidation.exportValidation),
  WithdrawalRequestController.exportDeliverymanRequestCollection
);
router.get(
  '/restaurant_disbursement/export/:type/:status',
  webAuth('export_collection'),
  validate(DisbursementValidation.exportValidation),
  DisbursementController.exportRestaurantCollection
);
router.get(
  '/deliveryman_disbursement/export/:type/:status',
  webAuth('export_collection'),
  validate(DisbursementValidation.exportValidation),
  DisbursementController.exportDeliverymanCollection
);
router.get(
  '/expense/export/:type/:status',
  webAuth('export_collection'),
  validate(AdminExpenseValidation.exportValidation),
  AdminExpenseController.exportQueryCollection
);
router.get(
  '/customer/export/',
  webAuth('export_collection'),
  validate(UserValidation.exportCustomerValidation),
  UserController.exportCustomerCollection
);
router.get(
  '/restaurant/filter/export/:type/:kind/:id',
  webAuth('export_collection'),
  validate(RestaurantValidation.exportFilterValidation),
  RestaurantController.exportRestaurantFilterTypeCollection
);
router.get(
  '/restaurant/filter_restaurant/export',
  webAuth('export_collection'),
  validate(RestaurantValidation.exportFilterQueryValidation),
  RestaurantController.exportRestaurantFilterQueryCollection
);
router.get(
  '/driver/wallet_fund/export/:type/:query',
  webAuth('export_collection'),
  validate(DriverValidation.fundExportValidation),
  DriverController.exportDeliverymanFundCollection
);
router.get(
  '/deliveryman_request/export/',
  webAuth('export_collection'),
  validate(DeliverymanJoiningRequestValidation.exportValidation),
  DeliverymanJoiningRequestController.exportCollection
);
router.get(
  '/customer/wallet_fund/export/:type/:query',
  webAuth('export_collection'),
  validate(UserValidation.exportWalletFundValidation),
  UserController.exportCustomerFundCollection
);
router.get(
  '/customer/loyalty_points/export',
  webAuth('export_collection'),
  validate(UserValidation.exportLoyalityPointsValidation),
  LoyaltyPointsController.exportCollection
);
router.get(
  '/disbursement/restaurant_report/export/:id/:type',
  webAuth('export_collection'),
  validate(DisbursementValidation.exportDisbursementReportValidation),
  DisbursementController.exportRestaurantDisbursementCollection
);
router.get(
  '/disbursement/deliveryman_report/export/:id/:type',
  webAuth('export_collection'),
  validate(DisbursementValidation.exportDisbursementReportValidation),
  DisbursementController.exportDeliverymanDisbursementCollection
);
router.get(
  '/reports/orders/export',
  webAuth('export_collection'),
  validate(OrdersValidation.exportOrderReportValidation),
  OrdersController.exportRegularOrderReportCollection
);
router.get(
  '/reports/pos_orders/export',
  webAuth('export_collection'),
  validate(OrdersValidation.exportOrderReportValidation),
  PosOrTableOrderController.exportPOSOrderReportCollection
);
router.get(
  '/reports/table_orders/export',
  webAuth('export_collection'),
  validate(TableOrderValidation.exportTableOrderValidation),
  TableOrderController.exportTableOrderReportCollection
);
router.get(
  '/reports/wallet_transaction/export',
  webAuth('export_collection'),
  validate(WalletValidation.exportTransactionValidation),
  WalletController.exportCollection
);
router.get(
  '/reports/payment_transaction/export',
  webAuth('export_collection'),
  validate(PaymentConfigValidation.exportPaymentValidation),
  PaymentInitiationController.exportCollection
);
router.get(
  '/reports/dining_booking/export',
  webAuth('export_collection'),
  validate(DiningBookingValidation.exportReportValidation),
  DiningBookingController.exportReportCollection
);
router.get(
  '/reports/food_report/export',
  webAuth('export_collection'),
  validate(FoodValidation.exportReportValidation),
  FoodController.exportReportCollection
);
router.get(
  '/reports/restaurant/export',
  webAuth('export_collection'),
  validate(RestaurantValidation.exportReportValidation),
  RestaurantController.exportRestaurantReportCollection
);
router.get(
  '/reports/customer/export',
  webAuth('export_collection'),
  validate(UserValidation.exportCustomerReportValidation),
  UserController.exportRawCustomerReportCollection
);
router.get(
  '/reports/deliveryman/export',
  webAuth('export_collection'),
  validate(DriverValidation.exportDeliverymanReportValidation),
  DriverController.exportDeliverymanReportCollection
);
router.get(
  '/reports/restaurant_disbursement/export',
  webAuth('export_collection'),
  validate(DisbursementValidation.exportRestaurantReportValidation),
  DisbursementController.exportRestaurantDisbursementReportCollection
);
router.get(
  '/reports/deliveryman_disbursement/export',
  webAuth('export_collection'),
  validate(DisbursementValidation.exportDeliverymanReportValidation),
  DisbursementController.exportDeliverymanDisbursementReportCollection
);
router.get(
  '/tiffin_packages/purchased/export/',
  webAuth('export_collection'),
  validate(UserPurchasedTiffinSubscriptionValidation.exportCollection),
  UserPurchasedTiffinSubscriptionController.exportCollection
);
router.get(
  '/regular_chat_list/export/',
  webAuth('export_collection'),
  validate(UserValidation.chatExportValidation),
  ChatRoomController.exportChatListCollection
);
router.get(
  '/regular_chat_message/export/',
  webAuth('export_collection'),
  validate(UserValidation.chatExportValidation),
  ChatRoomController.exportChatMessageCollection
);

router.get(
  '/support_chat_list/export/',
  webAuth('export_collection'),
  validate(UserValidation.chatExportValidation),
  SupportChatRoomController.exportChatListCollection
);
router.get(
  '/support_chat_message/export/',
  webAuth('export_collection'),
  validate(UserValidation.chatExportValidation),
  SupportChatRoomController.exportChatMessageCollection
);

router.get(
  '/download_import_sample/',
  webAuth('download_sample'),
  validate(UserValidation.downloadImportValidation),
  UserController.downloadImportFile
);
router.post(
  '/cities/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  CityController.importCollection
);
router.post(
  '/localities/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  LocalityController.importCollection
);
router.post(
  '/cuisine/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  CuisineController.importCollection
);
router.post(
  '/order_cancel_reason/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  OrderCancellationReasonController.importCollection
);
router.post(
  '/order_rating_message/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  OrderRatingMessageController.importCollection
);
router.post(
  '/invoice_instruction/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  InvoiceInstructionController.importCollection
);
router.post(
  '/restaurant_food_license/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  RestaurantFoodLicenseController.importCollection
);
router.post(
  '/restaurant_notice/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  RestaurantNoticeController.importCollection
);
router.post(
  '/delivery_instruction/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  DeliveryInstructionController.importCollection
);
router.post(
  '/gratitude/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  DeliveryGratitudeController.importCollection
);
router.post(
  '/driver_incentive/import_collection',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  DriverIncentiveController.importCollection
);
router.post(
  '/driver_offline_messages/import_collection',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  DriverOfflineMessagesController.importCollection
);
router.post(
  '/delete_account_reason/import_collection',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  UserDeleteAccountReasonController.importCollection
);
router.post(
  '/dining_category/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  DiningCategoryController.importCollection
);
router.post(
  '/dining_cancel_reason/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  DiningCancellationReasonController.importCollection
);
router.post(
  '/dining_notice/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  DiningNoticeController.importCollection
);
router.post(
  '/language/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  LangaugeController.importCollection
);
router.post(
  '/user_avatar/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  UserAvatarController.importCollection
);
router.post(
  '/subscription/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  SubscriptionController.importCollection
);
router.post(
  '/subscriber/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  SubscriberController.importCollection
);
router.post(
  '/report_issue_list/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  ReportIssueRestaurantController.importCollection
);
router.post(
  '/report_issue_restaurant/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  ReportIssueRestaurantReasonController.importCollection
);
router.post(
  '/customer/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  UserController.importCollection
);
router.post(
  '/loyality_points/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  LoyaltyPointsController.importCollection
);
router.post(
  '/hidden_restaurant/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  HideRestaurantController.importCollection
);
router.post(
  '/hide_restaurant_reason/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  HideRestaurantReasonController.importCollection
);
router.post(
  '/restaurant_type/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  RestaurantTypeController.importCollection
);
router.post(
  '/restaurant_facilities/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  RestaurantFacilitiesController.importCollection
);
router.post(
  '/vehicle/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  VehicleController.importCollection
);
router.post(
  '/delivery_shift_schedule/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  DeliveryShiftScheduleController.importCollection
);
router.post(
  '/auth_role/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importAuthRoleCollectionValidation),
  UserController.importAuthRoleCollection
);
router.post(
  '/customer_wallet_fund/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  UserController.importCustomerWalletFundCollection
);
router.post(
  '/wallet_bonus/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  WalletBonusController.importCollection
);
router.post(
  '/refund_request_reason/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  RefundRequestReasonController.importCollection
);
router.post(
  '/tiffin_subscription_refund_request_reason/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  TiffinSubscriptionRefundRequestReasonController.importCollection
);
router.post(
  '/dining_booking_refund_request_reason/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  DiningBookingRefundRequestReasonController.importCollection
);
router.post(
  '/complaints_reason/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  ComplaintsReasonController.importCollection
);
router.post(
  '/medias/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  MediaController.importCollection
);
router.post(
  '/addons/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  AddonsController.importCollection
);
router.post(
  '/category/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  CategoryController.importCollection
);
router.post(
  '/sub_category/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  SubCategoryController.importCollection
);
router.post(
  '/food_taxation/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  FoodTaxationController.importCollection
);
router.post(
  '/tiffin_subscription_cancel_reason/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  TiffinSubscriptionCancellationReasonController.importCollection
);
router.post(
  '/cash_collection/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  CollectCashController.importCollection
);
router.post(
  '/banners/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  BannersController.importCollection
);
router.post(
  '/deliveryman_wallet_fund/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  UserController.importDeliverymanWalletFundCollection
);
router.post(
  '/system_deliveryman/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  DriverController.importSystemDeliverymanCollection
);
router.post(
  '/vendor_deliveryman/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  DriverController.importVendorDeliverymanCollection
);
router.post(
  '/restaurant_waiters/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  WaiterController.importCollection
);
router.post(
  '/restaurant_kitchen_owner/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  KitchenOwnerController.importCollection
);
router.post(
  '/restaurants/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  RestaurantController.importRestaurantCollection
);
router.post(
  '/outlets/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  RestaurantController.importRestaurantOutletCollection
);
router.post(
  '/regular_chat_list/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  ChatRoomController.importChatListCollection
);
router.post(
  '/regular_chat_messages/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  ChatRoomController.importChatMessagesCollection
);
router.post(
  '/support_chat_list/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  SupportChatRoomController.importChatListCollection
);
router.post(
  '/support_chat_messages/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  SupportChatRoomController.importChatMessagesCollection
);
router.post(
  '/customer_complaints/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  ComplaintsController.importCollection
);
router.post(
  '/restaurant_complaints/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  RestaurantComplaintsController.importCollection
);
router.post(
  '/admin_expense/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  AdminExpenseController.importCollection
);
router.post(
  '/wallet_transactions/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  WalletController.importCollection
);
router.post(
  '/payment_transactions/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  PaymentInitiationController.importCollection
);
router.post(
  '/order_refund_request/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  RefundRequestController.importCollection
);
router.post(
  '/tiffin_refund_request/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  TiffinSubscriptionRefundRequestController.importCollection
);
router.post(
  '/dining_refund_request/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  DiningBookingRefundRequestController.importCollection
);
router.post(
  '/order_coupon/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  CouponController.importCollection
);
router.post(
  '/dining_coupon/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  DiningCouponController.importCollection
);
router.post(
  '/restaurant_campaign/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  RestaurantCampaignController.importCollection
);
router.post(
  '/dining_campaign/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  DiningCampaignController.importCollection
);
router.post(
  '/food_campaign/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  FoodCampaignController.importCollection
);
router.post(
  '/dining_booking/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  DiningBookingController.importCollection
);
router.post(
  '/withdrawal_methods/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  WithdrawalMethodController.importCollection
);
router.post(
  '/tiffin_packages_list/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  SubscriptionTiffinPackageController.importCollection
);
router.post(
  '/tiffin_purchased_list/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  UserPurchasedTiffinSubscriptionController.importCollection
);
router.post(
  '/foods/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  FoodController.importCollection
);
router.post(
  '/regular_orders/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  OrdersController.importCollection
);
router.post(
  '/vendor_pos_order_list/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  PosOrTableOrderController.importCollection
);
router.post(
  '/vendor_table_order_list/import_collection/',
  webAuth('download_sample'),
  validate(UserValidation.importCollectionValidation),
  TableOrderController.importCollection
);
// Import & Export Routes //

/// Chat Messages Routes //
router.post(
  '/chat_room/fetch_messages/',
  webAuth('regular_chat_messages'),
  validate(ChatRoomValidation.checkChatRoomValidation),
  ChatRoomController.checkChatRoom
);
/// Chat Messages Routes //

// Media Storage Setting Routes //
router.get(
  '/media_storage_setting/get',
  webAuth('media_storage_settings'),
  MediaStorageSettingController.get
);
router.post(
  '/media_storage_setting/save',
  webAuth('media_storage_settings'),
  validate(MediaStorageSettingValidation.createOrUpdateSettings),
  MediaStorageSettingController.create
);
router.patch(
  '/media_storage_setting/update/:settingId',
  webAuth('media_storage_settings'),
  validate(MediaStorageSettingValidation.createOrUpdateSettings),
  MediaStorageSettingController.update
);
// Media Storage Setting Routes //

// Landing Page Routes //
router.get('/landing_page/get_content', webAuth('save_landing'), LandingPageController.getContent);
router.post(
  '/landing_page/save_hero_content',
  webAuth('save_landing'),
  validate(LandingPageValidation.heroValidation),
  LandingPageController.saveHero
);
router.post(
  '/landing_page/save_service_content',
  webAuth('save_landing'),
  validate(LandingPageValidation.serviceValidation),
  LandingPageController.saveService
);
router.post(
  '/landing_page/save_faqs_content',
  webAuth('save_landing'),
  validate(LandingPageValidation.faqsValidation),
  LandingPageController.saveFaqs
);
router.post(
  '/landing_page/save_review_content',
  webAuth('save_landing'),
  validate(LandingPageValidation.reviewValidation),
  LandingPageController.saveReview
);
router.post(
  '/landing_page/save_scan_qr_content',
  webAuth('save_landing'),
  validate(LandingPageValidation.scanQrValidation),
  LandingPageController.saveScanQr
);
router.post(
  '/landing_page/save_app_feature_content',
  webAuth('save_landing'),
  validate(LandingPageValidation.appFeatureValidation),
  LandingPageController.saveAppFeatures
);
router.post(
  '/landing_page/save_feature_content',
  webAuth('save_landing'),
  validate(LandingPageValidation.projectFeatureValidation),
  LandingPageController.saveFeatures
);
// Landing Page Routes //

module.exports = router;

