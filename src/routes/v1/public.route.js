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
const { Buffer } = require('buffer');

const PublicValidation = require('../../validations/public.validation');
const EmailConfigValidation = require('../../validations/email.config.validation');
const AppPageValidation = require('../../validations/app.pages.validation');
const FoodCampaignValidation = require('../../validations/food.campaign.validation');
const RestaurantCampaignValidation = require('../../validations/restaurant.campaign.validation');
const FoodValidation = require('../../validations/food.validation');
const PaymentInitiationValidation = require('../../validations/payment.initiation.validation');
const PushNotificationTokenValidation = require('../../validations/push.notification.token.validation');
const AuthValidation = require('../../validations/auth.validation');
const SubscriptionTiffinPackageValidation = require('../../validations/subscription.tiffin.packages.validation');
const DiningCampaignValidation = require('../../validations/dining.campaign.validation');
const FeedbackFormValidation = require('../../validations/feedback.form.validation');
const ReportEmergencyValidation = require('../../validations/report.emergency.form.validation');
const CartItemValidation = require('../../validations/cart.item.validation');
const RestaurantJoiningRequestValidation = require('../../validations/restaurant.joining.request.validation');
const DeliverymanJoiningRequestValidation = require('../../validations/deliveryman.joining.request.validation');
const SmsProviderConfigValidation = require('../../validations/sms.provider.config.validation');
const RestaurantValidation = require('../../validations/restaurant.validation');
const TableOrderCartItemValidation = require('../../validations/table.order.cart.item.validation');
const LocalityValidation = require('../../validations/locality.validation');

const PublicController = require('../../controllers/public.controller');
const LocalityController = require('../../controllers/locality.controller');
  const CityController = require('../../controllers/city.controller');
const RestaurantController = require('../../controllers/restaurant.controller');
const BusinessSettingsController = require('../../controllers/business.settings.controller');
const EmailConfigController = require('../../controllers/email.config.controller');
const AppPageController = require('../../controllers/app.pages.controller');
const FoodCampaignController = require('../../controllers/food.campaign.controller');
const RestaurantCampaignController = require('../../controllers/restaurant.campaign.controller');
const FoodController = require('../../controllers/food.controller');
const PaymentInitiationController = require('../../controllers/payment.initiation.controller');
const PushNotificationTokenController = require('../../controllers/push.notification.token.controller');
const AuthController = require('../../controllers/auth.controller');
const ReviewRatingController = require('../../controllers/review.ratings.controller');
const SubscriptionTiffinPackageController = require('../../controllers/subscription.tiffin.package.controller');
const DiningCampaignController = require('../../controllers/dining.campaign.controller');
const FeedbackFormController = require('../../controllers/feedback.form.controller');
const ReportEmergencyController = require('../../controllers/report.emergency.form.controller');
const CartItemController = require('../../controllers/cart.item.controller');
const FileController = require('../../controllers/file.controller');
const CuisineController = require('../../controllers/cuisine.controller');
const RestaurantTypeController = require('../../controllers/restaurant.type.controller');
const RestaurantFacilitiesController = require('../../controllers/restaurant.facilities.controller');
const RestaurantJoiningRequestController = require('../../controllers/restaurant.joining.request.controller');
const DriverController = require('../../controllers/driver.controller');
const DeliverymanJoiningRequestController = require('../../controllers/deliveryman.joining.request.controller');
const TableOrderCartItemController = require('../../controllers/table.order.cart.item.controller');
const LandingPageController = require('../../controllers/landing.page.controller');

const validate = require('../../middlewares/validate');

const router = express.Router();

// Settings Routes //
router.post(
  '/getDefaultSettings/',
  validate(PublicValidation.visitorTrackingValidation),
  PublicController.getDefaultSettings
);
router.get('/get_web_settings/', PublicController.getDefaultWebSettings);
router.get('/getVendorSettings', BusinessSettingsController.getVendorSettings);
router.get('/getDriverSettings', PublicController.getDriverDefaultSettings);
router.get('/getWaiterSettings', PublicController.getWaiterDefaultSettings);
router.get('/getKitchenSetting', PublicController.getKitchenDefaultSettings);
router.get('/customer_header_content', PublicController.publicHeaderContent);
// Settings Routes //

// Restaurant Routes //
router.post(
  '/restaurant/near',
  validate(PublicValidation.nearMeRestaurants),
  RestaurantController.getNearMeRestaurants
);
router.post(
  '/restaurant/find_with_cuisine/',
  validate(PublicValidation.restaurantsByCuisine),
  RestaurantController.getRestaurantsByCuisine
);
router.post(
  '/restaurant/find_with_category/',
  validate(PublicValidation.restaurantsByCategory),
  RestaurantController.getRestaurantsByCategory
);
router.post(
  '/restaurant/find_with_brands/',
  validate(PublicValidation.restaurantsByBrands),
  RestaurantController.getRestaurantsByBrand
);
router.post(
  '/restaurant/get_restaurant_info/',
  validate(PublicValidation.getRestaurantInfo),
  RestaurantController.getRestaurantsInfo
);
router.post(
  '/restaurant/find_with_localities/',
  validate(PublicValidation.restaurantsByLocalities),
  RestaurantController.getRestaurantsByLocalities
);
router.post(
  '/dining_restaurant/near',
  validate(PublicValidation.nearMeDiningRestaurants),
  RestaurantController.getNearMeDiningRestaurants
);
router.post(
  '/dining_restaurant/near_on_map',
  validate(PublicValidation.nearMeDiningRestaurantOnMap),
  RestaurantController.getNearMeDiningRestaurantOnMap
);
router.post(
  '/campaign/dining_campaign/:campaignId/',
  validate(DiningCampaignValidation.infoValidation),
  DiningCampaignController.getDiningCampaign
);
router.post(
  '/dining_restaurant/find_with_category',
  validate(PublicValidation.diningByCategory),
  RestaurantController.getDiningByCategory
);
router.post(
  '/restaurant/detail_information/',
  validate(PublicValidation.restaurantDetailInformation),
  RestaurantController.getRestaurantDetailInformation
);
// Restaurant Routes //

// Cart Item Routes //
router.post(
  '/cart/addToCart/',
  validate(CartItemValidation.addItemToCartValidation),
  CartItemController.addToCart
);
router.post(
  '/cart/removeCartItemByRestaurant/',
  validate(CartItemValidation.removeCartItemByRestaurantValidation),
  CartItemController.removeCartItemByRestaurant
);
router.delete(
  '/cart/removeCartItemByTracking/:trackingId',
  validate(CartItemValidation.removeCartItemByTrackingValidation),
  CartItemController.removeCartItemByTrackingId
);
router.post(
  '/cart/removeFromCartWithUuid/',
  validate(CartItemValidation.removeFromCartWithUuidValidation),
  CartItemController.removeFromCartWithUuid
);
router.post(
  '/cart/removeFromCartWithFoodId/',
  validate(CartItemValidation.removeFromCartWithFoodIdValidation),
  CartItemController.removeFromCartWithFoodId
);
router.post(
  '/cart/updateFoodQuantity/',
  validate(CartItemValidation.updateFoodQuantityValidation),
  CartItemController.updateFoodQuantity
);
router.post(
  '/cart/updateFoodVariationQuantity/',
  validate(CartItemValidation.updateFoodVariationQuantityValidation),
  CartItemController.updateFoodVariationQuantity
);
// Cart Item Routes //

// Search Routes //
router.post(
  '/search/global/initial/',
  validate(PublicValidation.globalSearchInitial),
  RestaurantController.globalSearchInitial
);
router.post(
  '/search/global_dining/initial/',
  validate(PublicValidation.globalSearchInitial),
  RestaurantController.globalDiningSearchInitial
);
router.post(
  '/search/global/',
  validate(PublicValidation.globalSearch),
  RestaurantController.globalSearch
);
router.post(
  '/search/global_dining/',
  validate(PublicValidation.globalSearch),
  RestaurantController.globalDiningSearch
);
router.post(
  '/search/food/initial',
  validate(PublicValidation.foodSearchInitial),
  RestaurantController.foodSearchInitial
);
router.post(
  '/search/food/',
  validate(PublicValidation.foodSearch),
  RestaurantController.foodSearch
);
// Search Routes //

// Foods Routes //
router.post(
  '/foods/find_foods_with_category/',
  validate(PublicValidation.restaurantsFoodsByCategory),
  RestaurantController.getFoodsNearMeByCategory
);
router.post(
  '/foods/single_food/',
  validate(FoodValidation.singleFoodInfoValidation),
  FoodController.getSingleFoodInfo
);
// Foods Routes //

// Pages Routes //
router.get(
  '/app_pages/content/:slug',
  validate(AppPageValidation.idValidation),
  AppPageController.getContent
);
router.get(
  '/app_pages/getContent/:slug',
  validate(AppPageValidation.idValidation),
  AppPageController.getPageContent
);
// Pages Routes //

// Campaign Routes //
router.post(
  '/campaign/food_campaign/:campaignId/',
  validate(FoodCampaignValidation.contentValidation),
  FoodCampaignController.getFoodCampaign
);
router.post(
  '/campaign/restaurant_campaign/:campaignId/',
  validate(RestaurantCampaignValidation.infoValidation),
  RestaurantCampaignController.getRestaurantCampaign
);
// Campaign Routes //

// Test Routes ///
router.get(
  '/email_config/userEmailVerification/:email/:locale',
  validate(EmailConfigValidation.demoTestValidation),
  EmailConfigController.sendVerificationEmail
);
// Test Route ///

// Payment Routes //
router.get(
  '/payments/makePayment/:id',
  validate(PaymentInitiationValidation.idValidation),
  PaymentInitiationController.makePayment
);
router.get(
  '/payments/paid_success/:id',
  validate(PaymentInitiationValidation.idValidation),
  PaymentInitiationController.successPayment
);
router.post(
  '/payments/paid_success/:id',
  validate(PaymentInitiationValidation.idValidation),
  PaymentInitiationController.successPayment
);
router.get('/payments/payment_processed/', PaymentInitiationController.paymentProcessed);
router.get('/payments/payment_repeated/', PaymentInitiationController.repeatedPayment);
router.get(
  '/payments/paid_failed/:id',
  validate(PaymentInitiationValidation.idValidation),
  PaymentInitiationController.failedPayment
);
// Enterprise: Razorpay webhook must see the RAW body for HMAC verify.
// express.json() already ran globally, so capture raw bytes here only.
router.post(
  '/payments/razorpay_webhook',
  express.raw({ type: '*/*', limit: '1mb' }),
  (req, res, next) => {
    try {
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
      req.rawBody = buf;
      req.body = buf.length ? JSON.parse(buf.toString('utf8')) : {};
    } catch (err) {
      req.rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
      req.body = {};
      void err;
    }
    next();
  },
  PaymentInitiationController.razorpayWebhook
);
// Payment Routes //

// Push Notification Tokens
router.post(
  '/pushTokens/save',
  validate(PushNotificationTokenValidation.saveTokenValidation),
  PushNotificationTokenController.save
);
router.post(
  '/pushTokens/update',
  validate(PushNotificationTokenValidation.saveTokenValidation),
  PushNotificationTokenController.update
);
// Push Notification Tokens

// Web OTP Verification //
router.get(
  '/verification/otp/:locale/:id',
  validate(AuthValidation.verifyWebSMSOTPValidation),
  AuthController.verifyWebSMSOTP
);
router.get(
  '/verification/otp_web_version/:id',
  validate(AuthValidation.verifyWebVersionSMSOTPValidation),
  AuthController.verifyWebVersionSMSOTP
);
router.get(
  '/verification/otp_web_reset_password_version/',
  validate(AuthValidation.verifyWebVersionSMSOTPValidation),
  AuthController.verifyWebVersionResetPasswordSMSOTP
);
router.get(
  '/verification/firebase_otp_web_version/',
  validate(AuthValidation.verifyFirebaseWebVersionSMSOTPValidation),
  AuthController.verifyFirebaseWebVersionSMSOTP
);
router.get(
  '/verification/firebase_reset_password_otp_web_version/',
  validate(AuthValidation.verifyFirebaseWebVersionSMSOTPValidation),
  AuthController.verifyFirebaseWebVersionResetPasswordSMSOTP
);
router.get(
  '/otp/verify/:id',
  validate(AuthValidation.verificationIdValidation),
  AuthController.smsVerification
);
router.get(
  '/otp/verify_web/:id',
  validate(AuthValidation.smsVerificationWebValidation),
  AuthController.smsWebVersionVerification
);
router.get(
  '/otp/verify_reset_password_web/',
  validate(AuthValidation.smsVerificationWebValidation),
  AuthController.smsWebVersionResetPasswordVerification
);
router.get(
  '/otp/success/:id',
  validate(AuthValidation.verificationIdValidation),
  AuthController.smsVerificationSuccess
);
router.get(
  '/otp/failed/:id',
  validate(AuthValidation.verificationIdValidation),
  AuthController.smsVerificationFailed
);
// Web OTP Verification //

// Review Ratings Routes //
router.post(
  '/restaurant/reviews',
  validate(PublicValidation.restaurantReview),
  ReviewRatingController.getRestaurantReview
);
router.post(
  '/food/reviews',
  validate(PublicValidation.foodReview),
  ReviewRatingController.getFoodReview
);
// Review Ratings Routes //

// Subscription Tiffin Package Routes //
router.get(
  '/tiffin_packages/info/:id/',
  validate(SubscriptionTiffinPackageValidation.getDetailValidation),
  SubscriptionTiffinPackageController.getSubscriptionPackageDetailCustomer
);
router.post(
  '/tiffin_packages/from_restaurant/',
  validate(SubscriptionTiffinPackageValidation.getSubscriptionPackageFromVendorValidation),
  SubscriptionTiffinPackageController.getSubscriptionPackageFromVendor
);
// Subscription Tiffin Package Routes //

/// Dining Booking Routes ///
router.post(
  '/dining_booking/info/',
  validate(PublicValidation.diningBookingInformationValidation),
  RestaurantController.getDiningBookingInformation
);

/// Dining Booking Routes ///

///  Phone Call Routes ///
router.get(
  '/restaurant/call/:restaurant',
  validate(PublicValidation.fetchRestaurantCallNumberValidation),
  RestaurantController.fetchResturantPhoneNumber
);
///  Phone Call Routes ///

// Feedback Form Routes //
router.post(
  '/feedback_form/save/',
  validate(FeedbackFormValidation.saveFeedback),
  FeedbackFormController.saveFeedback
);
router.post(
  '/report_emergency/save/',
  validate(ReportEmergencyValidation.saveReportEmergencyValidation),
  ReportEmergencyController.saveReportEmergency
);
// Feedback Form Routes //

// Locality Routes //
router.get(
  '/localities_from_city/:id',
  validate(PublicValidation.cityValidation),
  LocalityController.getLocalitiesList
);
// Pin → locality suggestion for registration forms (Restaurant-app
// auto-detect). Public for the same reason as the dropdown above:
// registration happens before an account exists. Suggest-only —
// `{ locality: null }` means "manual select", never an error.
router.get(
  '/localities_nearest',
  validate(LocalityValidation.nearestLocality),
  LocalityController.getNearest
);
// Locality Routes //

// Coverage pre-check (Batch E-1): "does this kitchen deliver to my pin?"
// Public so the customer app can warn in the address form before checkout.
// Read-only; the enforcing gate lives in createOrder.
router.get(
  '/restaurants/covers/:restaurantId',
  validate(RestaurantValidation.coverageCheckValidation),
  RestaurantController.getCoverageHandler
);

// Dairy registration — the city list the outlet form's dropdown needs.
//
// Public because registration happens *before* an account exists: the form is
// filled first, the phone is verified after. That is why the restaurant
// equivalent above is also public. Reuses `CityController.getAll`, which
// projects only `id`, `name`, `location` and `translations` and filters to
// active cities — the delivery footprint is visible, but nothing else is.
//
// The matching `localities_from_city/:id` above serves the second dropdown, so
// the cascade needs no new endpoint for the locality half.
router.get('/register/getBasicDataDairyRequest', CityController.getAll);

// Restaurant Register Request Routes //
router.get(
  '/register/getBasicDataRestaurantRequest',
  RestaurantController.getBasicDataRegisterRequest
);
router.get(
  '/register/restaurant_web_self_register_detail',
  RestaurantController.getBasicDataRegisterRequestWeb
);
router.get('/restaurant/activeCuisine/', CuisineController.getActiveCuisine);
router.get('/restaurant/activeType/', RestaurantTypeController.getActiveRestaurantType);
router.get('/restaurant/activeFacility/', RestaurantFacilitiesController.getActiveFacilities);
router.post('/uploadImage', FileController.uploadImage);
router.post(
  '/restaurant_joining/request/',
  validate(RestaurantJoiningRequestValidation.createRequestValidation),
  RestaurantJoiningRequestController.createRequest
);
// Restaurant Register Request Routes //

// Deliveryman Register Request Routes //
router.get(
  '/deliveryman_joining/getBasicDataDeliverymanRequest',
  DriverController.getBasicDataRegisterRequest
);
router.post(
  '/deliveryman_joining/request/',
  validate(DeliverymanJoiningRequestValidation.createRequestValidation),
  DeliverymanJoiningRequestController.createRequest
);
// Deliveryman Register Request Routes //

// Firebase Auth Test //
router.get(
  '/sms_provider/demo_firebase/',
  validate(SmsProviderConfigValidation.firebaseWebDemoValidation),
  AuthController.adminDemoFirebaseSMS
);
// Firebase Auth Test //
// MSG91 Auth Test //
router.get(
  '/sms_provider/demo_msg91/',
  validate(SmsProviderConfigValidation.firebaseWebDemoValidation),
  AuthController.adminDemoMSG91SMS
);
// MSG91 Auth Test //

// Customer Table Order Menu Routes //
router.get(
  '/qr_code_menu/:restaurant/:table',
  validate(RestaurantValidation.userTableQrMenuValidation),
  RestaurantController.userTableQrMenu
);
router.post(
  '/qr_code_menu/add_to_cart/',
  validate(TableOrderCartItemValidation.customerAddItemToCartValidation),
  TableOrderCartItemController.customerAddItemToCart
);
// Customer Table Order Menu Routes //

// Landing Page Routes //
router.get('/landing_page/get_content', LandingPageController.getContent);
// Landing Page Routes //
module.exports = router;

