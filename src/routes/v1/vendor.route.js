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
const rateLimiter = require('../../middlewares/rateLimiter');
const validate = require('../../middlewares/validate');

const AddonsValidation = require('../../validations/addons.validation');
const VendorCategoryValidation = require('../../validations/vendor.category.validation');
const VendorSubCategoryValidation = require('../../validations/vendor.sub.category.validation');
const FoodValidation = require('../../validations/food.validation');
const DriverValidation = require('../../validations/driver.validation');
const CityValidation = require('../../validations/city.validation');
const RestaurantValidation = require('../../validations/restaurant.validation');
const RestaurantCampaignValidation = require('../../validations/restaurant.campaign.validation');
const RestaurantCampaignRequestValidation = require('../../validations/restaurant.campaign.request.validation');
const FoodCampaignValidation = require('../../validations/food.campaign.validation');
const FoodCampaignRequestValidation = require('../../validations/food.campaign.request.validation');
const OrdersValidation = require('../../validations/orders.validation');
const CouponValidation = require('../../validations/coupon.validation');
const SubscriptionTiffinPackageValidation = require('../../validations/subscription.tiffin.packages.validation');
const UserPurchasedTiffinSubscriptionValidation = require('../../validations/user.purchased.tiffin.subscriptions.validation');
const DiningCampaignValidation = require('../../validations/dining.campaign.validation');
const DiningCampaignRequestValidation = require('../../validations/dining.campaign.request.validation');
const RestaurantExtraDetailValidation = require('../../validations/restaurant.extra.detail.validation');
const DiningCouponValidation = require('../../validations/dining.coupon.validation');
const DiningBookingValidation = require('../../validations/dining.booking.validation');
const FoodTaxationValidation = require('../../validations/food.taxation.validation');
const ReviewRatingValidation = require('../../validations/review.ratings.validation');
const UserValidation = require('../../validations/user.validation');
const FileUploadValidation = require('../../validations/file.validation');
const RestaurantComplaintValidation = require('../../validations/restaurant.complaint.validation');
const AuthValidation = require('../../validations/auth.validation');
const WaiterValidation = require('../../validations/waiter.validation');
const RestaurantTableValidation = require('../../validations/restaurant.table.validation');
const RestaurantPayoutMethodValidation = require('../../validations/restaurant.payout.method.validation');
const WalletValidation = require('../../validations/wallet.validation');
const WithdrawalRequestValidation = require('../../validations/withdrawal.request.validation');
const PosOrTableOrderValidation = require('../../validations/pos.or.table.order.validation');
const TableOrderCartItemValidation = require('../../validations/table.order.cart.item.validation');
const TableOrderValidation = require('../../validations/table.order.validation');
const RestaurantExpenseValidation = require('../../validations/restaurant.expense.validation');
const ChatRoomValidation = require('../../validations/chat.room.validation');
const UserNotificationSettingValidation = require('../../validations/user.notification.setting.validation');
const KitchenOwnerValidation = require('../../validations/kitchen.owner.validation');

const AddonsController = require('../../controllers/addons.controller');
const VendorCategoryController = require('../../controllers/vendor.category.controller');
const RestaurantController = require('../../controllers/restaurant.controller');
const DeliveryConfigValidation = require('../../validations/delivery.config.validation');
const CategoryController = require('../../controllers/category.controller');
const SubCategoryController = require('../../controllers/sub.category.controller');
const VendorSubCategoryController = require('../../controllers/vendor.sub.category.controller');
const MediaController = require('../../controllers/media.controller');
const FoodController = require('../../controllers/food.controller');
const DriverController = require('../../controllers/driver.controller');
const LocalityController = require('../../controllers/locality.controller');
const RestaurantCampaignController = require('../../controllers/restaurant.campaign.controller');
const RestaurantCampaignRequestController = require('../../controllers/restaurant.campaign.request.controller');
const FoodCampaignController = require('../../controllers/food.campaign.controller');
const FoodCampaignRequestController = require('../../controllers/food.campaign.request.controller');
const OrdersController = require('../../controllers/orders.controller');
const OrdersCancellationReasonController = require('../../controllers/order.cancellation.reason.controller');
const CouponController = require('../../controllers/coupon.controller');
const SubscriptionTiffinPackageController = require('../../controllers/subscription.tiffin.package.controller');
const UserPurchasedTiffinSubscriptionController = require('../../controllers/user.purchased.tiffin.subscription.controller');
const DiningCampaignController = require('../../controllers/dining.campaign.controller');
const DiningCampaignRequestController = require('../../controllers/dining.campaign.request.controller');
const RestaurantExtraDetailController = require('../../controllers/restaurant.extra.details.controller');
const DiningCategoryController = require('../../controllers/dining.category.controller');
const DiningSettingController = require('../../controllers/dining.settings.controller');
const DiningCouponController = require('../../controllers/dining.coupon.controller');
const DiningBookingController = require('../../controllers/dining.booking.controller');
const DiningBookingCancellationReasonController = require('../../controllers/dining.cancellation.reason.controller');
const FoodTaxationController = require('../../controllers/food.taxation.controller');
const ReviewRatingController = require('../../controllers/review.ratings.controller');
const UserController = require('../../controllers/user.controller');
const RestaurantComplaintController = require('../../controllers/restaurant.complaints.controller');
const AuthController = require('../../controllers/auth.controller');
const WaiterController = require('../../controllers/waiter.controller');
const RestaurantTableController = require('../../controllers/restaurant.table.controller');
const WalletController = require('../../controllers/wallet.controller');
const WithdrawalMethodController = require('../../controllers/withdrawal.method.controller');
const RestaurantPayoutMethodController = require('../../controllers/restaurant.payout.method.controller');
const WithdrawalRequestController = require('../../controllers/withdrawal.request.controller');
const OrderSettingsController = require('../../controllers/order.settings.controller');
const PosOrTableOrderController = require('../../controllers/pos.or.table.order.controller');
const TableOrderCartItemController = require('../../controllers/table.order.cart.item.controller');
const TableOrderController = require('../../controllers/table.order.controller');
const RestaurantExpenseController = require('../../controllers/restaurant.expense.controller');
const SupportChatRoomController = require('../../controllers/support.chat.room.controller');
const SupportEnterpriseController = require('../../controllers/support.enterprise.controller');
const ChatRoomController = require('../../controllers/chat.room.controller');
const UserNotificationSettingController = require('../../controllers/user.notification.setting.controller');
const UserDeleteAccountReasonController = require('../../controllers/user.delete.account.reason.controller');
const KitchenOwnerController = require('../../controllers/kitchen.owner.controller');
const NotificationListController = require('../../controllers/notification.list.controller');

const router = express.Router();

// Vendors Own Routes //
router.get('/getMyProfile/:userId', appAuth('getVendorProfile'), RestaurantController.getMyProfile);
// Vendors Own Routes //

// Addons Routes //
router.post(
  '/addons/save',
  appAuth('createAddons'),
  validate(AddonsValidation.createAddons),
  AddonsController.create
);
router.get(
  '/addons/getMyAddons/:restaurant',
  appAuth('getMyAddons'),
  validate(AddonsValidation.myAddonsValidation),
  AddonsController.getMyAddons
);
router.patch(
  '/addons/update/:addonId',
  appAuth('updateAddons'),
  validate(AddonsValidation.idValidation),
  AddonsController.update
);
router.delete(
  '/addons/delete/:addonId',
  appAuth('deleteAddons'),
  validate(AddonsValidation.idValidation),
  AddonsController.drop
);
// Addons Routes //

// Category Routes //
router.get('/category/getActive', appAuth('getActiveCategory'), CategoryController.getActive);
// Category Routes //

// Sub Category Routes //
router.get(
  '/sub_category/getActive',
  appAuth('getActiveSubCategory'),
  SubCategoryController.getActive
);
router.get(
  '/sub_category/getByCategoryId/:category',
  appAuth('getActiveSubCategory'),
  SubCategoryController.getActiveByCategoryId
);
// Sub Category Routes //

// Vendor Category Routes //
router.post(
  '/vendor_category/save',
  appAuth('createVendorCategory'),
  validate(VendorCategoryValidation.createCategory),
  VendorCategoryController.create
);
router.get(
  '/vendor_category/getMyCategories/:restaurant',
  appAuth('getMyVendorCategories'),
  validate(VendorCategoryValidation.myCategoryValidation),
  VendorCategoryController.getMyCategory
);
router.patch(
  '/vendor_category/update/:categoryId',
  appAuth('updateVendorCategory'),
  validate(VendorCategoryValidation.idValidation),
  VendorCategoryController.update
);
router.delete(
  '/vendor_category/delete/:categoryId',
  appAuth('deleteVendorCategory'),
  validate(VendorCategoryValidation.idValidation),
  VendorCategoryController.drop
);
router.get(
  '/vendor_category/getAllMyCategory/:restaurant',
  appAuth('getMyVendorCategories'),
  validate(VendorCategoryValidation.myCategoryValidation),
  VendorCategoryController.getMyAllCategory
);
// Vendor Category Routes //

// Vendor Sub Category Routes //
router.post(
  '/vendor_sub_category/save',
  appAuth('createVendorSubCategory'),
  validate(VendorSubCategoryValidation.createSubCategory),
  VendorSubCategoryController.create
);
router.get(
  '/vendor_sub_category/getMyCategories/:restaurant',
  appAuth('getMyVendorSubCategories'),
  validate(VendorSubCategoryValidation.mySubCategoryValidation),
  VendorSubCategoryController.getMyCategory
);
router.get(
  '/vendor_sub_category/getActiveByCategoryId/:category/:restaurant',
  appAuth('getMyVendorSubCategories'),
  validate(VendorSubCategoryValidation.mySubCategoryByCateIdValidation),
  VendorSubCategoryController.getAllSubCategoryById
);
router.patch(
  '/vendor_sub_category/update/:subCategoryId',
  appAuth('updateVendorSubCategory'),
  validate(VendorSubCategoryValidation.idValidation),
  VendorSubCategoryController.update
);
router.delete(
  '/vendor_sub_category/delete/:subCategoryId',
  appAuth('deleteVendorSubCategory'),
  validate(VendorSubCategoryValidation.idValidation),
  VendorSubCategoryController.drop
);
// Vendor Sub Category Routes //

// Food Routes //
router.get(
  '/foods/getBasicData/:restaurant',
  appAuth('createFood'),
  validate(FoodValidation.myFoodValidation),
  FoodController.getBasicData
);
router.post(
  '/foods/save',
  appAuth('createFood'),
  validate(FoodValidation.createFood),
  FoodController.create
);
router.get(
  '/foods/getMyFoods/:restaurant',
  appAuth('getMyFoods'),
  validate(FoodValidation.myFoodValidation),
  FoodController.getMyFoods
);
router.patch(
  '/foods/update/:foodId',
  appAuth('updateFood'),
  validate(FoodValidation.idValidation),
  FoodController.update
);
router.delete(
  '/foods/delete/:foodId',
  appAuth('deleteFood'),
  validate(FoodValidation.idValidation),
  FoodController.drop
);
router.patch(
  '/foods/updateMetaInfo/:foodId',
  appAuth('updateFood'),
  validate(FoodValidation.idValidation),
  FoodController.updateMetaInfo
);
router.get(
  '/foods/getFoodInfo/:foodId/:restaurant',
  appAuth('getMyFoods'),
  validate(FoodValidation.foodInfoValidation),
  FoodController.getFoodInfo
);
router.get(
  '/foods/getAllMainActiveCategories',
  appAuth('createFood'),
  FoodController.getAllMainActiveCategories
);
router.get(
  '/foods/getAllMyAddonsList/:restaurant',
  appAuth('createFood'),
  FoodController.getAllMyAddonsList
);
router.get('/foods/getMyFoodApp/:restaurant', appAuth('getMyFoods'), FoodController.getMyFoodApp);
router.get(
  '/foods/getFoodInfoVendorApp/:foodId/:restaurant',
  appAuth('getMyFoods'),
  validate(FoodValidation.foodInfoValidation),
  FoodController.getFoodIdVendorApp
);
router.get(
  '/foods/searchMenu/:vendor/:searchQuery',
  appAuth('searchMenu'),
  validate(FoodValidation.searchMenuValidation),
  FoodController.searchMenuFood
);
// Food Routes //

// Media Routes //
router.get(
  '/media/getVendorMedia/:userId',
  appAuth('getVendorMedia'),
  MediaController.getVendorMedia
);
// Media Routes //

// Driver Routes //
router.post(
  '/driver/save',
  appAuth('createDriver'),
  validate(DriverValidation.createVendorDriver),
  DriverController.registerVendorDriverAccount
);
router.get(
  '/driver/getBasicData/:restaurant',
  appAuth('createDriver'),
  validate(DriverValidation.restaurantValidation),
  DriverController.getVendorDriverBasicData
);
router.get(
  '/driver/getMyDriver/:restaurant',
  appAuth('getMyDriver'),
  validate(DriverValidation.restaurantValidation),
  DriverController.getMyDriver
);
router.patch(
  '/driver/updateStatus/:driverId',
  appAuth('updateDriver'),
  validate(DriverValidation.idValidation),
  DriverController.updateStatus
);
router.get(
  '/driver/getById/:driverId',
  appAuth('getDriverById'),
  validate(DriverValidation.idValidation),
  DriverController.getById
);
router.patch(
  '/driver/update/:driverId',
  appAuth('updateDriver'),
  validate(DriverValidation.idValidation),
  DriverController.update
);
// Driver Routes //

// Locality Routes //
router.get(
  '/localities/getByCityId/:cityId',
  appAuth('getLocalities'),
  validate(CityValidation.idValidation),
  LocalityController.getByCityId
);
// Locality Routes //

// Outlet Routes //
router.post(
  '/outlet/save',
  appAuth('createOutlet'),
  validate(RestaurantValidation.createOutlet),
  RestaurantController.registerOutletAccount
);
router.get(
  '/outlet/getBasicDataForNewOutlet',
  appAuth('createOutlet'),
  RestaurantController.getBasicDataForNewOutlet
);
router.get(
  '/outlet/getBasicDataForNewOutletForApp',
  appAuth('createOutlet'),
  RestaurantController.getBasicDataForNewOutletFromApp
);
router.get(
  '/outlet/getMyOutlets/:restaurantId',
  appAuth('getMyOutlets'),
  validate(RestaurantValidation.idValidation),
  RestaurantController.getMyOutlets
);
router.patch(
  '/outlet/updateStatus/:restaurantId',
  appAuth('updateOutlet'),
  validate(RestaurantValidation.idValidation),
  RestaurantController.updateStatus
);
router.get(
  '/outlet/getById/:restaurantId',
  appAuth('getOutletById'),
  validate(RestaurantValidation.idValidation),
  RestaurantController.getById
);
router.get(
  '/outlet/getByIdForApp/:id/:vendorId',
  appAuth('getOutletById'),
  validate(RestaurantValidation.getOutletDetailForAppValidation),
  RestaurantController.getOutletDetailForApp
);
router.patch(
  '/outlet/update/:restaurantId',
  appAuth('updateOutlet'),
  validate(RestaurantValidation.idValidation),
  RestaurantController.updateOutlet
);
// Outlet Routes //

// Restaurant Campaign Routes //
router.get(
  '/restaurant_campaign/near_me/:restaurantId',
  appAuth('getRestaurantCampaignNearMe'),
  validate(RestaurantCampaignValidation.restaurantIdValidation),
  RestaurantCampaignController.getCampaignNearMe
);
router.delete(
  '/restaurant_campaign/leave/:campaignId/:restaurantId',
  appAuth('leaveRestaurantCampaign'),
  validate(RestaurantCampaignValidation.leaveAndJoinCampaignValidation),
  RestaurantCampaignController.leaveCampaign
);

router.post(
  '/restaurant_campaign/join_request',
  appAuth('joinRestaurantCampaign'),
  validate(RestaurantCampaignRequestValidation.joinCampaignValidation),
  RestaurantCampaignRequestController.requestCampaign
);
// Restaurant Campaign Routes //

// Food Campaign Routes //
router.get(
  '/food_campaign/near_me/:restaurantId',
  appAuth('getFoodCampaignNearMe'),
  validate(FoodCampaignValidation.restaurantIdValidation),
  FoodCampaignController.getCampaignNearMe
);
router.get(
  '/food_campaign/getDetails/:campaignId/:restaurantId',
  appAuth('getFoodCampaignDetails'),
  validate(FoodCampaignValidation.restaurantAndCampaignIdValidation),
  FoodCampaignController.getDetailsForCampaignRequest
);
router.post(
  '/food_campaign/join_request',
  appAuth('joinFoodCampaign'),
  validate(FoodCampaignRequestValidation.joinCampaignValidation),
  FoodCampaignRequestController.requestCampaign
);

router.delete(
  '/food_campaign/leave/:campaignId/:foodId',
  appAuth('leaveFoodCampaign'),
  validate(FoodCampaignValidation.leaveAndJoinCampaignIdValidation),
  FoodCampaignController.leaveCampaign
);
// Food Campaign Routes //

// Restaurant Slots Routes //
router.get(
  '/getMySlots/:restaurantId',
  appAuth('getMySlots'),
  validate(RestaurantValidation.idValidation),
  RestaurantController.getSlot
);
router.patch(
  '/updateMySlots/:restaurantId',
  appAuth('updateSlots'),
  validate(RestaurantValidation.slotUpdateValidation),
  RestaurantController.updateSlot
);
// Restaurant Slots Routes //

// Orders Routes //
router.post(
  '/orders/getVendorOrders',
  appAuth('getVendorOrders'),
  validate(OrdersValidation.vendorOrderValidation),
  OrdersController.getVendorOrder
);
router.post(
  '/orders/prepareOrder',
  appAuth('updateOrder'),
  validate(OrdersValidation.prepareOrderValidation),
  OrdersController.prepareOrder
);
router.post(
  '/orders/acceptScheduleOrder',
  appAuth('updateOrder'),
  validate(OrdersValidation.acceptScheduleOrderValidation),
  OrdersController.acceptScheduleOrder
);
router.post(
  '/orders/orderReady',
  appAuth('updateOrder'),
  validate(OrdersValidation.orderReadyValidation),
  OrdersController.orderReady
);
router.get(
  '/drivers/activeDriver/:vendorId',
  appAuth('activeNearDriver'),
  validate(DriverValidation.nearActiveDriverValidation),
  DriverController.getNearMeActiveDriver
);
router.post(
  '/orders/handover_to_driver',
  appAuth('updateOrder'),
  validate(OrdersValidation.orderHandoverToDriverValidation),
  OrdersController.restaurantOrderHandoverDriver
);
router.post(
  '/orders/handover_to_customer',
  appAuth('updateOrder'),
  validate(OrdersValidation.orderHandoverToCustomerValidation),
  OrdersController.restaurantOrderHandoverCustomer
);
router.post(
  '/orders/rejectOrder/',
  appAuth('rejectOrder'),
  validate(OrdersValidation.orderRestaurantRejectValidation),
  OrdersController.restaurantRejectOrder
);
router.get(
  '/orders/fetchDriverNearToOrder/:id/:restaurant',
  appAuth('fetchDriverNearToOrder'),
  validate(OrdersValidation.findDriverValidation),
  OrdersController.fetchDriverNearToOrder
);
router.post(
  '/orders/assignDriverOrderVendor',
  appAuth('assignDriverOrderVendor'),
  validate(OrdersValidation.assignDriverOrderVendorValidation),
  OrdersController.assignDriverOrderVendor
);
router.get(
  '/orders/vendorOrderDetails/:id/:vendor',
  appAuth('vendorOrderDetails'),
  validate(OrdersValidation.vendorOrderDetailValidation),
  OrdersController.vendorOrderDetail
);
router.get(
  '/orders/callCustomer/:id/:vendor',
  appAuth('vendorCallCustomerDeliveryman'),
  validate(OrdersValidation.vendorCallCustomerDeliverymanValidation),
  OrdersController.callCustomer
);
router.get(
  '/orders/callDeliveryman/:id/:vendor',
  appAuth('vendorCallCustomerDeliveryman'),
  validate(OrdersValidation.vendorCallCustomerDeliverymanValidation),
  OrdersController.callDeliveryman
);
router.get(
  '/orders/summary/:id/:vendor/:locale',
  appAuth('downloadOrderReceipt'),
  validate(OrdersValidation.downloadVendorOrderReceiptValidation),
  OrdersController.downloadVendorOrderSummary
);
router.get(
  '/orders/invoice/:id/:vendor/:locale',
  appAuth('downloadOrderReceipt'),
  validate(OrdersValidation.downloadVendorOrderReceiptValidation),
  OrdersController.downloadVendorOrderInvoice
);
router.get(
  '/orders/print_invoice/:id/:vendor',
  appAuth('vendorOrderDetails'),
  validate(OrdersValidation.vendorInvoiceValidation),
  OrdersController.vendorOrderInvoice
);
// Orders Routes //

// Order Cancellation Reason Routes //
router.get(
  '/cancellation/restaurant',
  appAuth('cancellationReason'),
  OrdersCancellationReasonController.getRestaurantCancellationList
);
// Order Cancellation Reason Routes //

// Coupons Routes //
router.post(
  '/coupons/request_new/',
  appAuth('requestNewCoupon'),
  validate(CouponValidation.requestNewCouponValidation),
  CouponController.requestNewCoupon
);
router.get('/coupons/get', appAuth('getVendorCoupons'), CouponController.getVendorCoupons);
router.post(
  '/coupons/getInfo/',
  appAuth('getVendorCouponInfo'),
  validate(CouponValidation.vendorCouponInfoValidation),
  CouponController.getVendorCouponInfo
);
router.patch(
  '/coupons/update/:id',
  appAuth('updateVendorCoupon'),
  validate(CouponValidation.updateVendorCouponValidation),
  CouponController.updateVendorCoupon
);
router.delete(
  '/coupons/delete/:id/:userId',
  appAuth('deleteVendorCoupon'),
  validate(CouponValidation.deleteVendorCouponValidation),
  CouponController.deleteVendorCoupon
);
router.patch(
  '/coupons/updateMeta/:id',
  appAuth('updateVendorCoupon'),
  validate(CouponValidation.vendorCouponUpdateStatusValidation),
  CouponController.updateMeta
);
// Coupons Routes //

// Subscription Tiffin Package Routes //
router.get(
  '/tiffin_packages/get_basic/:restaurant',
  appAuth('getTiffinPackageBasicInfo'),
  validate(SubscriptionTiffinPackageValidation.getBasicValidation),
  SubscriptionTiffinPackageController.getBasic
);
router.post(
  '/tiffin_packages/create/',
  appAuth('createTiffinPackage'),
  validate(SubscriptionTiffinPackageValidation.createSubscriptionTiffinValidation),
  SubscriptionTiffinPackageController.create
);
router.get(
  '/tiffin_packages/getMyPackages/:restaurant',
  appAuth('getMyTiffinPackages'),
  validate(SubscriptionTiffinPackageValidation.getPackageListVendorValidation),
  SubscriptionTiffinPackageController.getMyPackagesList
);
router.get(
  '/tiffin_packages/details/:id/:restaurant',
  appAuth('getPackageDetail'),
  validate(SubscriptionTiffinPackageValidation.idValidation),
  SubscriptionTiffinPackageController.getById
);
router.patch(
  '/tiffin_packages/update/:id',
  appAuth('updatePackageDetail'),
  validate(SubscriptionTiffinPackageValidation.updateValidation),
  SubscriptionTiffinPackageController.updatePackage
);
router.patch(
  '/tiffin_packages/updateStatus/:id',
  appAuth('updatePackageStatus'),
  validate(SubscriptionTiffinPackageValidation.updateVendorStatusValidation),
  SubscriptionTiffinPackageController.updatePackageStatus
);
router.delete(
  '/tiffin_packages/delete/:id',
  appAuth('deleteTiffinPackage'),
  validate(SubscriptionTiffinPackageValidation.deleteValidation),
  SubscriptionTiffinPackageController.drop
);
router.post(
  '/tiffin_packages/vendorTiffinSubscriptionPurchased/',
  appAuth('vendorTiffinSubscriptionPurchased'),
  validate(UserPurchasedTiffinSubscriptionValidation.purchasedSubscriptionListVendorValidation),
  UserPurchasedTiffinSubscriptionController.getPurchaseListForVendor
);
router.get(
  '/tiffin_packages/userPurchasedTiffinSubscriptionInfo/:id',
  appAuth('userPurchasedTiffinSubscriptionInfo'),
  validate(UserPurchasedTiffinSubscriptionValidation.purchaseDetailValidation),
  UserPurchasedTiffinSubscriptionController.getPurchaseDetailVendor
);
// Subscription Tiffin Package Routes //

// Dining Campaign Routes //
router.get(
  '/dining_campaign/near_me/:restaurantId',
  appAuth('getDiningCampaignNearMe'),
  validate(DiningCampaignValidation.restaurantIdValidation),
  DiningCampaignController.getCampaignNearMe
);
router.delete(
  '/dining_campaign/leave/:campaignId/:restaurantId',
  appAuth('leaveDiningCampaign'),
  validate(DiningCampaignValidation.leaveAndJoinCampaignValidation),
  DiningCampaignController.leaveCampaign
);
router.post(
  '/dining_campaign/join_request',
  appAuth('joinDiningCampaign'),
  validate(DiningCampaignRequestValidation.joinCampaignValidation),
  DiningCampaignRequestController.requestCampaign
);
// Dining Campaign Routes //

// Restaurant Extra Detail Routes //
router.post(
  '/restaurant_extra_detail/saveGuestAvailability/:restaurant',
  appAuth('saveGuestAvailabilityValidation'),
  validate(RestaurantExtraDetailValidation.saveGuestAvailabilityValidation),
  RestaurantExtraDetailController.saveGuestAvailability
);
router.get(
  '/restaurant_extra_detail/getGuestAvailability/:restaurant',
  appAuth('getGuestAvailability'),
  validate(RestaurantExtraDetailValidation.idValidation),
  RestaurantExtraDetailController.getGuestAvailability
);
router.get(
  '/restaurant_extra_detail/getMyDiningSchedule/:restaurant',
  appAuth('getMyDiningSchedule'),
  validate(RestaurantExtraDetailValidation.idValidation),
  RestaurantExtraDetailController.getMyDiningSchedule
);
router.post(
  '/restaurant_extra_detail/saveDiningSchedule/:restaurant',
  appAuth('saveDiningSchedule'),
  validate(RestaurantExtraDetailValidation.idValidation),
  RestaurantExtraDetailController.saveDiningSchedule
);
router.get(
  '/restaurant_extra_detail/menu/:id',
  appAuth('restaurantMenuAndPhotos'),
  validate(RestaurantValidation.restaurantExtraInformation),
  RestaurantController.getRestaurantExtraInformation
);
router.patch(
  '/restaurant_extra_detail/updateMenu/:id',
  appAuth('restaurantMenuAndPhotos'),
  validate(RestaurantValidation.updateMenuAndPhotoInformation),
  RestaurantController.updateMenuAndPhotoInformation
);
// Restaurant Extra Detail Routes //

// Vendor Dining Information //
router.get(
  '/dining/getVendorDiningInformation/:id',
  appAuth('getVendorDiningInformation'),
  validate(RestaurantValidation.getVendorDiningInformation),
  RestaurantController.getVendorDiningInformation
);
router.get(
  '/dining/getDiningCategories',
  appAuth('getDiningCategories'),
  DiningCategoryController.getDiningCategoriesListForVendor
);
router.patch(
  '/dining/updateDiningInformation/:id',
  appAuth('updateDiningInformation'),
  validate(RestaurantValidation.updateDiningInformation),
  RestaurantController.updateDiningInformation
);
// Vendor Dining Information //

// Dining Coupon Routes //
router.get(
  '/dining/getSetting',
  appAuth('getDiningSetting'),
  DiningSettingController.getDiningSettingForVendor
);
router.post(
  '/dining_coupon/request_new/',
  appAuth('requestNewDiningCoupon'),
  validate(DiningCouponValidation.requestNewCouponValidation),
  DiningCouponController.requestNewCoupon
);
router.get(
  '/dining_coupon/vendorCoupons',
  appAuth('getVendorDiningCoupons'),
  DiningCouponController.getVendorCoupons
);
router.delete(
  '/dining_coupon/delete/:id/:userId',
  appAuth('deleteVendorDiningCoupon'),
  validate(DiningCouponValidation.deleteVendorCouponValidation),
  DiningCouponController.deleteVendorCoupon
);
router.patch(
  '/dining_coupon/updateMeta/:id',
  appAuth('updateVendorDiningCoupon'),
  validate(DiningCouponValidation.vendorCouponUpdateStatusValidation),
  DiningCouponController.updateMeta
);
router.post(
  '/dining_coupon/getInfo/',
  appAuth('getVendorDiningCouponInfo'),
  validate(DiningCouponValidation.vendorCouponInfoValidation),
  DiningCouponController.getVendorCouponInfo
);
router.patch(
  '/dining_coupon/update/:id',
  appAuth('updateVendorDiningCoupon'),
  validate(DiningCouponValidation.updateVendorCouponValidation),
  DiningCouponController.updateVendorCoupon
);
// Dining Coupon Routes //

/// Dining Booking Routes ///
router.post(
  '/dining_booking/list/',
  appAuth('getVendorDiningBooking'),
  validate(DiningBookingValidation.diningBookingByVendorIdValidation),
  DiningBookingController.getVendorDiningBookingList
);
router.post(
  '/dining_booking/accept/',
  appAuth('acceptDiningBooking'),
  validate(DiningBookingValidation.acceptDiningBookingValidation),
  DiningBookingController.acceptDiningBooking
);
router.get(
  '/dining_booking/cancellation/restaurant',
  appAuth('diningBookingCancellationReason'),
  DiningBookingCancellationReasonController.getRestaurantCancellationList
);
router.post(
  '/dining_booking/reject/',
  appAuth('rejectDiningBooking'),
  validate(DiningBookingValidation.rejectDiningBookingValidation),
  DiningBookingController.rejectDiningBooking
);
router.post(
  '/dining_booking/complete/',
  appAuth('completeDiningBooking'),
  validate(DiningBookingValidation.completeDiningBookingValidation),
  DiningBookingController.completeDiningBooking
);
router.get(
  '/dining_booking/detail/:bookingId/:vendorId',
  appAuth('diningBookingInformation'),
  validate(DiningBookingValidation.bookingInformationValidation),
  DiningBookingController.getDiningBookingInformation
);
router.get(
  '/dining_booking/callCustomer/:bookingId/:vendorId',
  appAuth('diningBookingCallCustomer'),
  validate(DiningBookingValidation.callCustomerValidation),
  DiningBookingController.callBookingCustomer
);
/// Dining Booking Routes ///

// Food Taxation Routes //
router.post(
  '/food_taxation/save/',
  appAuth('saveFoodTaxation'),
  validate(FoodTaxationValidation.saveFoodTaxationValidation),
  FoodTaxationController.saveFoodTaxation
);
router.get(
  '/food_taxation/getByRestaurant/:restaurant/',
  appAuth('getFoodTaxation'),
  validate(FoodTaxationValidation.restaurantValidation),
  FoodTaxationController.getVendorTaxationList
);
router.patch(
  '/food_taxation/update/:id/:restaurant',
  appAuth('updateFoodTaxation'),
  validate(FoodTaxationValidation.updateValidation),
  FoodTaxationController.updateTaxation
);
router.delete(
  '/food_taxation/delete/:id/:restaurant',
  appAuth('deleteFoodTaxation'),
  validate(FoodTaxationValidation.deleteValidation),
  FoodTaxationController.deleteTaxation
);
router.get(
  '/food_taxation/getAllMyTaxation/:restaurant/',
  appAuth('getFoodTaxation'),
  validate(FoodTaxationValidation.getAllMyTaxationValidation),
  FoodTaxationController.getAllMyTaxation
);
// Food Taxation Routes //

// Review Rating Routes //
router.post(
  '/restaurant/reviews',
  appAuth('restaurantReviewList'),
  validate(ReviewRatingValidation.restaurantReviewValidation),
  ReviewRatingController.getRestaurantReview
);
// Review Rating Routes //

// Call Routes //
router.get(
  '/customer/call/:userId',
  appAuth('callCustomer'),
  validate(UserValidation.callValidation),
  UserController.callCustomer
);
// Call Routes //

// Complaints Routes //
router.get(
  '/orders/forComplaint/:id/:vendor',
  appAuth('detailsForComplaint'),
  validate(OrdersValidation.orderComplaintRestaurantValidation),
  OrdersController.getOrderDetailsForRestaurantComplaints
);
router.post(
  '/complaints/save',
  appAuth('saveComplaints'),
  validate(RestaurantComplaintValidation.saveComplaintValidation),
  RestaurantComplaintController.save
);
// Complaints Routes //

router.post(
  '/media/deleteMyImage',
  appAuth('deleteMyImage'),
  validate(FileUploadValidation.userMediaDropValidation),
  MediaController.dropUserMedia
);

// Restaurant Detail Update App //
router.get(
  '/restaurant/edit_detail/:id/',
  appAuth('editRestaurantDetailApp'),
  validate(RestaurantValidation.getRestaurantDetailForUpdateAppValidation),
  RestaurantController.getRestaurantDetailForUpdateApp
);

router.patch(
  '/restaurant/updateDetail/:id',
  appAuth('updateRestaurantDetail'),
  validate(RestaurantValidation.updateRestaurantDetailValidation),
  RestaurantController.updateRestaurantDetail
);
// Self-narrowing (Batch D-2): the vendor shrinks their own coverage.
// No :id — the restaurant resolves from the authenticated vendor, and the
// service enforces shrink-only (widening is 422 → city-master approval).
router.patch(
  '/restaurant/delivery-config/narrow',
  appAuth('updateRestaurantDetail'),
  validate(DeliveryConfigValidation.vendorDeliveryConfigNarrow),
  RestaurantController.narrowDeliveryConfigHandler
);
router.get(
  '/restaurant/temporaryClose/:id',
  appAuth('updateRestaurantDetail'),
  validate(RestaurantValidation.temporaryClosedValidation),
  RestaurantController.closeTemporaryRestaurant
);
router.get(
  '/restaurant/reOpenTemporary/:id',
  appAuth('updateRestaurantDetail'),
  validate(RestaurantValidation.temporaryClosedValidation),
  RestaurantController.reOpenTemporaryRestaurant
);
// Restaurant Detail Update App //

// Edit Profile //
router.get(
  '/profile/user/:id',
  appAuth('getUserProfile'),
  validate(AuthValidation.profileValidation),
  AuthController.getMyProfile
);
router.patch(
  '/profile/update/:id',
  appAuth('updateUserProfile'),
  validate(AuthValidation.updateProfileValidation),
  AuthController.updateMyProfile
);
// Edit Profile //

// Waiter Routes //
router.post(
  '/waiter/save',
  appAuth('createWaiter'),
  validate(WaiterValidation.createWaiter),
  WaiterController.registerWaiterAccount
);
router.get(
  '/waiter/getMyWaiter/:restaurant',
  appAuth('getMyWaiter'),
  validate(WaiterValidation.restaurantValidation),
  WaiterController.getMyWaiter
);
router.get(
  '/waiter/getById/:waiterId',
  appAuth('getWaiterById'),
  validate(WaiterValidation.idValidation),
  WaiterController.getById
);
router.patch(
  '/waiter/updateWaiterInfo/:userId',
  appAuth('updateWaiterInfo'),
  validate(WaiterValidation.updateWaiterInfoValidation),
  WaiterController.updateWaiterInfo
);
router.patch(
  '/waiter/updateWaiterStatus/:waiterId',
  appAuth('updateWaiterInfo'),
  validate(WaiterValidation.updateWaiterStatusValidation),
  WaiterController.updateWaiterStatus
);
// Waiter Routes //

// Restaurant Table Routes //
router.post(
  '/restaurant_table/save',
  appAuth('createRestaurantTable'),
  validate(RestaurantTableValidation.createRestaurantTable),
  RestaurantTableController.create
);
router.get(
  '/restaurant_table/getList/:restaurant',
  appAuth('getMyTableList'),
  validate(RestaurantTableValidation.listValidation),
  RestaurantTableController.get
);
router.patch(
  '/restaurant_table/update/:id',
  appAuth('updateRestaurantTable'),
  validate(RestaurantTableValidation.updateTableValidation),
  RestaurantTableController.updateTable
);
router.patch(
  '/restaurant_table/updateStatus/:id',
  appAuth('updateRestaurantTable'),
  validate(RestaurantTableValidation.updateTableStatusValidation),
  RestaurantTableController.updateStatus
);
router.delete(
  '/restaurant_table/delete/:id',
  appAuth('deleteRestaurantTable'),
  validate(RestaurantTableValidation.idValidation),
  RestaurantTableController.drop
);
router.get(
  '/restaurant_table/qr_table_detail/:vendor',
  appAuth('restaurant_table_detail'),
  validate(RestaurantTableValidation.vendorTableQrDetailValidation),
  RestaurantController.vendorTableQrDetail
);
// Restaurant Table Routes //

// Restaurant Wallet Routes //
router.get(
  '/restaurant/wallet/:vendor',
  appAuth('getRestaurantWallet'),
  validate(RestaurantValidation.vendorWalletValidation),
  RestaurantController.restaurantWalletDetail
);
router.get(
  '/wallet/getWalletTransaction/:user',
  appAuth('getWalletTransaction'),
  validate(UserValidation.idValidation),
  WalletController.vendorWalletTransaction
);
router.get(
  '/cashInHandHistory/getHistory/:vendor',
  appAuth('getCashInHandHistory'),
  validate(RestaurantValidation.vendorCashInHandValidation),
  RestaurantController.cashOnHandHistory
);
router.get(
  '/collectedCashInHandHistory/getHistory/:vendor',
  appAuth('getCollectedCashInHandHistory'),
  validate(RestaurantValidation.vendorCollectedCashInHandValidation),
  RestaurantController.cashCollectedHistory
);
router.get(
  '/cashInHandHistory/posAndTableOrderCommission/:vendor',
  appAuth('getPosAndTableOrderCommission'),
  validate(RestaurantValidation.vendorCashInHandValidation),
  RestaurantController.posAndTableOrderCommissionHistory
);
// Restaurant Wallet Routes //

// Payout Method Routes //
router.get(
  '/payoutMethod/list',
  appAuth('payoutMethodList'),
  WithdrawalMethodController.withdrawalMethodListVendor
);
router.post(
  '/payoutMethod/createPayoutMethod',
  appAuth('createPayoutMethod'),
  validate(RestaurantPayoutMethodValidation.createPayoutMethodValidation),
  RestaurantPayoutMethodController.create
);
router.get(
  '/payoutMethod/myPayoutList/:vendor',
  appAuth('getPayoutMethodList'),
  validate(RestaurantPayoutMethodValidation.vendorValidation),
  RestaurantPayoutMethodController.getMyPayoutMethodList
);
router.delete(
  '/payoutMethod/deleteMethod/:id/:vendor',
  appAuth('deletePayoutMethod'),
  validate(RestaurantPayoutMethodValidation.deletePayoutMethodValidation),
  RestaurantPayoutMethodController.deletePayoutMethod
);
router.get(
  '/payoutMethod/detail/:id/:vendor',
  appAuth('getPayoutMethodDetail'),
  validate(RestaurantPayoutMethodValidation.payoutMethodDetailValidation),
  RestaurantPayoutMethodController.getPayoutMethodDetail
);
router.patch(
  '/payoutMethod/updatePayoutMethod',
  appAuth('updatePayoutMethod'),
  validate(RestaurantPayoutMethodValidation.updatePayoutMethodValidation),
  RestaurantPayoutMethodController.updatePayoutMethodDetail
);
router.patch(
  '/payoutMethod/updateDefault/',
  appAuth('updatePayoutMethod'),
  validate(RestaurantPayoutMethodValidation.changeDefaultPayoutMethodValidation),
  RestaurantPayoutMethodController.changeDefaultPayoutMethod
);
// Payout Method Routes //

// Withdrawal Routes //
router.get(
  '/wallet/withdrawalDetail/:vendor',
  appAuth('withdrawalDetail'),
  validate(WalletValidation.vendorWalletWithdrawalDetailValidation),
  WalletController.vendorWalletWithdrawalDetail
);
router.post(
  '/wallet/requestWithdrawal',
  appAuth('withdrawalRequest'),
  validate(WithdrawalRequestValidation.createRestaurantWithdrawalRequestValidation),
  WithdrawalRequestController.createRestaurantWithdrawalRequest
);
router.get(
  '/wallet/withdrawalHistory/:vendor',
  appAuth('withdrawalHistory'),
  validate(WithdrawalRequestValidation.vendorHistoryValidation),
  WithdrawalRequestController.restaurantWithdrawalHistory
);
// Withdrawal Routes //

// POS Routes //
router.get(
  '/restaurant/posData/:vendor',
  appAuth('restaurantPosData'),
  validate(RestaurantValidation.posDataValidation),
  RestaurantController.getPosData
);
router.get(
  '/restaurant/posFoodInitialSearch/:vendor',
  appAuth('restaurantPosInitialFoodSearch'),
  validate(RestaurantValidation.posInitialFoodValidation),
  RestaurantController.posFoodSearchInitialData
);
router.get(
  '/restaurant/posFoodSearch/:vendor/:searchQuery',
  appAuth('restaurantPosFoodSearch'),
  validate(RestaurantValidation.posFoodSearchValidation),
  RestaurantController.posFoodSearch
);
router.get(
  '/restaurant/posOrderSettings/',
  appAuth('posOrderSettings'),
  OrderSettingsController.posOrderSettings
);
router.post(
  '/restaurant/posPlaceOrder/',
  appAuth('posPlaceOrder'),
  validate(PosOrTableOrderValidation.vendorPlaceOrderValidation),
  PosOrTableOrderController.vendorPlaceOrder
);
router.get(
  '/restaurant/posOrders/:vendor/',
  appAuth('posOrdersList'),
  validate(PosOrTableOrderValidation.vendorPosOrderValidation),
  PosOrTableOrderController.getPosOrderOfVendor
);
router.get(
  '/restaurant/posOrderDetail/:id/:vendor/',
  appAuth('posOrderDetail'),
  validate(PosOrTableOrderValidation.vendorPosOrderDetailValidation),
  PosOrTableOrderController.getPosOrderDetail
);
router.get(
  '/restaurant/pos_invoice_print/:id/:vendor/',
  appAuth('posOrderDetail'),
  validate(PosOrTableOrderValidation.vendorInvoiceValidation),
  PosOrTableOrderController.vendorPOSOrderInvoice
);
// POS Routes //

// Table Order Routes //
router.get(
  '/table_order/ongoing/:vendor/',
  appAuth('onGoingTableOrder'),
  validate(TableOrderCartItemValidation.ongoingTableOrderValidation),
  TableOrderCartItemController.ongoingTableOrder
);
router.get(
  '/table_order/ongoingOrderDetail/:vendor/:tableId/',
  appAuth('onGoingTableOrderDetail'),
  validate(TableOrderCartItemValidation.vendorOngoingTableOrderValidation),
  TableOrderCartItemController.vendorOngoingOrderDetail
);
router.delete(
  '/table_order/deleteTableOrderCartItem/:vendor/:id/',
  appAuth('deleteTableOrderCartItem'),
  validate(TableOrderCartItemValidation.vendorDeleteCartItemValidation),
  TableOrderCartItemController.vendorDeleteCartItem
);
router.post(
  '/table_order/completeTableOrder',
  appAuth('completeTableOrder'),
  validate(TableOrderCartItemValidation.vendorCompleteTableOrderValidation),
  TableOrderCartItemController.vendorCompleteTableOrder
);
router.get(
  '/table_order/completedTableOrderList/:vendor/',
  appAuth('completedTableOrderList'),
  validate(TableOrderValidation.vendorTableOrderValidation),
  TableOrderController.getTableOrderOfVendor
);
router.get(
  '/table_order/tableOrderDetail/:vendor/:id/',
  appAuth('tableOrderDetail'),
  validate(TableOrderValidation.vendorTableOrderDetailValidation),
  TableOrderController.getTableOrderDetail
);
router.get(
  '/table_order/invoice_print/:id/:vendor/',
  appAuth('tableOrderDetail'),
  validate(TableOrderValidation.vendorOrderInvoiceValidation),
  TableOrderController.vendorTableOrderInvoice
);
// Table Order Routes //

// Business Insight Routes //
router.get(
  '/business/insight/:vendor/',
  appAuth('businessInsight'),
  validate(OrdersValidation.vendorBusinessInsightValidation),
  OrdersController.vendorOrderBusinessInsight
);
router.post(
  '/business/insight/custom/',
  appAuth('businessInsight'),
  validate(OrdersValidation.vendorBusinessCustomDateInsightValidation),
  OrdersController.vendorOrderCustomDateBusinessInsight
);
router.get(
  '/pos/insight/:vendor/',
  appAuth('businessInsight'),
  validate(PosOrTableOrderValidation.vendorBusinessInsightValidation),
  PosOrTableOrderController.vendorPosBusinessInsight
);
router.post(
  '/pos/insight/custom/',
  appAuth('businessInsight'),
  validate(PosOrTableOrderValidation.vendorBusinessCustomDateInsightValidation),
  PosOrTableOrderController.vendorCustomDatePosOrderBusinessInsight
);
router.get(
  '/table_order/insight/:vendor/',
  appAuth('businessInsight'),
  validate(TableOrderValidation.vendorBusinessInsightValidation),
  TableOrderController.vendorTableOrderBusinessInsight
);
router.post(
  '/table_order/insight/custom/',
  appAuth('businessInsight'),
  validate(TableOrderValidation.vendorBusinessCustomDateInsightValidation),
  TableOrderController.vendorCustomDateTableOrderBusinessInsight
);
// Business Insight Routes //

// Subscription Routes //
router.get(
  '/restaurant/subscription_status/:vendor',
  appAuth('getSubscriptionInfo'),
  RestaurantController.getVendorSubscriptionStatus
);
router.get(
  '/restaurant/subscription/:vendor',
  appAuth('getSubscriptionInfo'),
  RestaurantController.vendorSubscriptionInfo
);
router.post(
  '/restaurant/renew_subscription/',
  appAuth('renewSubscription'),
  validate(RestaurantValidation.renewSubscriptionValidation),
  RestaurantController.vendorRenewSubscription
);
// Subscription Routes //

// Expense Routes //
router.post(
  '/expense/save/',
  appAuth('saveExpense'),
  validate(RestaurantExpenseValidation.saveExpenseValidation),
  RestaurantExpenseController.create
);
router.get(
  '/reports/expenseInitial',
  appAuth('expenseReport'),
  RestaurantExpenseController.getInitialResponse
);
router.get(
  '/reports/expense',
  appAuth('expenseReport'),
  RestaurantExpenseController.getExpenseList
);
router.get(
  '/reports/expense/export',
  appAuth('export_collection'),
  validate(RestaurantExpenseValidation.exportValidation),
  RestaurantExpenseController.exportCollection
);
// Expense Routes //

/// Chat Messages Routes //
router.post(
  '/chat_room/fetchMessages/',
  appAuth('fetchChatMessages'),
  validate(ChatRoomValidation.checkChatRoomValidation),
  ChatRoomController.checkChatRoom
);
router.post(
  '/support_chat_room/sendMessage/',
  appAuth('sendChatMessage'),
  rateLimiter.supportChatSendLimiter,
  validate(ChatRoomValidation.sendChatMessageValidation),
  SupportChatRoomController.saveNewMessage
);
router.get(
  '/chat_room/list/:user',
  appAuth('getChatList'),
  validate(ChatRoomValidation.chatListValidation),
  ChatRoomController.getMyConversionList
);
router.post(
  '/chat_room/conversion',
  appAuth('getChatConversion'),
  validate(ChatRoomValidation.getChatConversionValidation),
  ChatRoomController.getChatConversion
);
router.post(
  '/chat_room/fetch_messages/',
  appAuth('regular_chat_messages'),
  validate(ChatRoomValidation.checkChatRoomValidation),
  ChatRoomController.checkChatRoom
);
router.get(
  '/regular_chat_messages/:id',
  appAuth('regular_chat_messages'),
  validate(ChatRoomValidation.cityzenChatMessagesValidation),
  ChatRoomController.cityzenGetChatMessages
);
router.post(
  '/chat_room/send_regular_message/',
  appAuth('send_regular_message'),
  validate(ChatRoomValidation.sendChatMessageValidation),
  ChatRoomController.saveNewMessage
);
/// Chat Messages Routes //

// Support Chat Message Routes //
router.post(
  '/support_chat_room/fetchMessages/',
  appAuth('fetchChatMessages'),
  validate(ChatRoomValidation.supportChatRoomValidation),
  SupportChatRoomController.checkChatRoom
);
router.get(
  '/support_chat_room/list/:user',
  appAuth('getChatList'),
  validate(ChatRoomValidation.chatListValidation),
  SupportChatRoomController.mySupportChat
);
router.post(
  '/support_chat_room/sendMessage/',
  appAuth('sendChatMessage'),
  rateLimiter.supportChatSendLimiter,
  validate(ChatRoomValidation.sendChatMessageValidation),
  SupportChatRoomController.saveNewMessage
);
router.post(
  '/support_chat_room/conversion',
  appAuth('getChatConversion'),
  validate(ChatRoomValidation.getChatConversionValidation),
  SupportChatRoomController.getChatConversion
);
// Support Chat Message Routes //

// --- Enterprise: bot-first -> human handover (mirrors user.route) ---------
// Literal segments FIRST, so `/:id` below can never swallow them.
router.post(
  '/support_chat_room/bot/start',
  appAuth('fetchChatMessages'),
  validate(ChatRoomValidation.botStartValidation),
  SupportEnterpriseController.botStart
);
router.post(
  '/support_chat_room/bot/message',
  appAuth('sendChatMessage'),
  rateLimiter.supportChatSendLimiter,
  validate(ChatRoomValidation.botMessageValidation),
  SupportEnterpriseController.botMessage
);
router.get(
  '/support_chat_room/queue/:id',
  appAuth('fetchChatMessages'),
  validate(ChatRoomValidation.roomIdParamValidation),
  SupportEnterpriseController.queueStatus
);
router.post(
  '/support_chat_room/handover/:id',
  appAuth('sendChatMessage'),
  validate(ChatRoomValidation.handoverValidation),
  SupportEnterpriseController.handover
);
router.post(
  '/support_chat_room/csat/:id',
  appAuth('sendChatMessage'),
  validate(ChatRoomValidation.csatValidation),
  SupportEnterpriseController.submitCsat
);
router.post(
  '/support_chat_room/reopen/:id',
  appAuth('sendChatMessage'),
  validate(ChatRoomValidation.reopenValidation),
  SupportEnterpriseController.reopen
);

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
  UserDeleteAccountReasonController.geRestaurantActiveReason
);
router.post(
  '/account_setting/delete_account',
  appAuth('delete_account'),
  validate(UserValidation.deleteRestaurantAccountValidation),
  UserController.restaurantDeleteAccount
);
router.patch(
  '/account_setting/update_locale/',
  appAuth('update_locale'),
  validate(UserValidation.updateLocaleValidation),
  UserController.updateUserLocale
);
// Account Settings Routes//

// Kitchen Owner Routes //
router.post(
  '/kitchen_owner/save',
  appAuth('create_kitchen_owner'),
  validate(KitchenOwnerValidation.createKitchenOwner),
  KitchenOwnerController.registerKitchenOwnerAccount
);
router.get(
  '/kitchen_owner/list/:restaurant',
  appAuth('kitchen_owner_list'),
  validate(KitchenOwnerValidation.restaurantValidation),
  KitchenOwnerController.getKitchenOwners
);
router.get(
  '/kitchen_owner/info/:kitchenId',
  appAuth('kitchen_owner_info'),
  validate(KitchenOwnerValidation.idValidation),
  KitchenOwnerController.getById
);
router.patch(
  '/kitchen_owner/update_detail/:userId',
  appAuth('update_kitchen_owner'),
  validate(KitchenOwnerValidation.updateKitchenOwnerInfoValidation),
  KitchenOwnerController.updateKitchenOwnerInfo
);
router.patch(
  '/kitchen_owner/update_kitchen_status/:kitchenId',
  appAuth('update_kitchen_status'),
  validate(KitchenOwnerValidation.updateKitchenOwnerStatusValidation),
  KitchenOwnerController.updateKitchenOwnerStatus
);
// Kitchen Owner Routes //

// Vendor Profile //
router.get(
  '/vendor_profile/:id',
  appAuth('vendor_profile'),
  validate(UserValidation.vendorProfileValidation),
  UserController.getVendorProfile
);
router.patch(
  '/update_vendor/:id',
  appAuth('update_vendor'),
  validate(UserValidation.updateVendorProfileValidation),
  UserController.updateVendorProfile
);
router.patch(
  '/update_vendor_password/:id',
  appAuth('update_vendor_password'),
  validate(UserValidation.updateVendorPasswordValidation),
  UserController.updateVendorPassword
);

router.post(
  '/notification_list/',
  appAuth('notification_list'),
  validate(UserValidation.notificationListValidation),
  NotificationListController.getMyNotificationList
);
router.get(
  '/read_all_notification/:user',
  appAuth('read_all_notification'),
  validate(UserValidation.idValidation),
  NotificationListController.readAllNotification
);

router.get(
  '/vendor_header_content/:id',
  appAuth('vendor_header_content'),
  validate(UserValidation.vendorHeaderValidation),
  NotificationListController.vendorHeaderContent
);
// Vendor Profile //

// Vendor User Contact Detail Routes //
router.get(
  '/user_contact_detail/:id',
  appAuth('user_contact_detail'),
  validate(UserValidation.adminUserContactDetailValidation),
  UserController.adminUserContactDetail
);
// Vendor User Contact Detail Routes //

module.exports = router;

