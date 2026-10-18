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
router.get('/getMyProfile/:userId', webAuth('getVendorProfile'), RestaurantController.getMyProfile);
// Vendors Own Routes //

// Addons Routes //
router.post(
  '/addons/save',
  webAuth('createAddons'),
  validate(AddonsValidation.createAddons),
  AddonsController.create
);
router.get(
  '/addons/getMyAddons/:restaurant',
  webAuth('getMyAddons'),
  validate(AddonsValidation.myAddonsValidation),
  AddonsController.getMyAddons
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

// Category Routes //
router.get('/category/getActive', webAuth('getActiveCategory'), CategoryController.getActive);
// Category Routes //

// Sub Category Routes //
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
// Sub Category Routes //

// Vendor Category Routes //
router.post(
  '/vendor_category/save',
  webAuth('createVendorCategory'),
  validate(VendorCategoryValidation.createCategory),
  VendorCategoryController.create
);
router.get(
  '/vendor_category/getMyCategories/:restaurant',
  webAuth('getMyVendorCategories'),
  validate(VendorCategoryValidation.myCategoryValidation),
  VendorCategoryController.getMyCategory
);
router.patch(
  '/vendor_category/update/:categoryId',
  webAuth('updateVendorCategory'),
  validate(VendorCategoryValidation.idValidation),
  VendorCategoryController.update
);
router.delete(
  '/vendor_category/delete/:categoryId',
  webAuth('deleteVendorCategory'),
  validate(VendorCategoryValidation.idValidation),
  VendorCategoryController.drop
);
router.get(
  '/vendor_category/getAllMyCategory/:restaurant',
  webAuth('getMyVendorCategories'),
  validate(VendorCategoryValidation.myCategoryValidation),
  VendorCategoryController.getMyAllCategory
);
// Vendor Category Routes //

// Vendor Sub Category Routes //
router.post(
  '/vendor_sub_category/save',
  webAuth('createVendorSubCategory'),
  validate(VendorSubCategoryValidation.createSubCategory),
  VendorSubCategoryController.create
);
router.get(
  '/vendor_sub_category/getMyCategories/:restaurant',
  webAuth('getMyVendorSubCategories'),
  validate(VendorSubCategoryValidation.mySubCategoryValidation),
  VendorSubCategoryController.getMyCategory
);
router.get(
  '/vendor_sub_category/getActiveByCategoryId/:category/:restaurant',
  webAuth('getMyVendorSubCategories'),
  validate(VendorSubCategoryValidation.mySubCategoryByCateIdValidation),
  VendorSubCategoryController.getAllSubCategoryById
);
router.patch(
  '/vendor_sub_category/update/:subCategoryId',
  webAuth('updateVendorSubCategory'),
  validate(VendorSubCategoryValidation.idValidation),
  VendorSubCategoryController.update
);
router.delete(
  '/vendor_sub_category/delete/:subCategoryId',
  webAuth('deleteVendorSubCategory'),
  validate(VendorSubCategoryValidation.idValidation),
  VendorSubCategoryController.drop
);
// Vendor Sub Category Routes //

// Food Routes //
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
  '/foods/getMyFoods/:restaurant',
  webAuth('getMyFoods'),
  validate(FoodValidation.myFoodValidation),
  FoodController.getMyFoods
);
router.patch(
  '/foods/update/:foodId',
  webAuth('updateFood'),
  validate(FoodValidation.idValidation),
  FoodController.update
);
router.delete(
  '/foods/delete/:foodId',
  webAuth('deleteFood'),
  validate(FoodValidation.idValidation),
  FoodController.drop
);
router.patch(
  '/foods/updateMetaInfo/:foodId',
  webAuth('updateFood'),
  validate(FoodValidation.idValidation),
  FoodController.updateMetaInfo
);
router.get(
  '/foods/getFoodInfo/:foodId/:restaurant',
  webAuth('getMyFoods'),
  validate(FoodValidation.foodInfoValidation),
  FoodController.getFoodInfo
);
router.get(
  '/foods/getAllMainActiveCategories',
  webAuth('createFood'),
  FoodController.getAllMainActiveCategories
);
router.get(
  '/foods/getAllMyAddonsList/:restaurant',
  webAuth('createFood'),
  FoodController.getAllMyAddonsList
);
router.get('/foods/getMyFoodApp/:restaurant', webAuth('getMyFoods'), FoodController.getMyFoodApp);
router.get(
  '/foods/getFoodInfoVendorApp/:foodId/:restaurant',
  webAuth('getMyFoods'),
  validate(FoodValidation.foodInfoValidation),
  FoodController.getFoodIdVendorApp
);
router.get(
  '/foods/searchMenu/:vendor/:searchQuery',
  webAuth('searchMenu'),
  validate(FoodValidation.searchMenuValidation),
  FoodController.searchMenuFood
);
// Food Routes //

// Media Routes //
router.get(
  '/media/getVendorMedia/:userId',
  webAuth('getVendorMedia'),
  MediaController.getVendorMedia
);
// Media Routes //

// Driver Routes //
router.post(
  '/driver/save',
  webAuth('createDriver'),
  validate(DriverValidation.createVendorDriver),
  DriverController.registerVendorDriverAccount
);
router.get(
  '/driver/getBasicData/:restaurant',
  webAuth('createDriver'),
  validate(DriverValidation.restaurantValidation),
  DriverController.getVendorDriverBasicData
);
router.get(
  '/driver/getMyDriver/:restaurant',
  webAuth('getMyDriver'),
  validate(DriverValidation.restaurantValidation),
  DriverController.getMyDriver
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
// Driver Routes //

// Locality Routes //
router.get(
  '/localities/getByCityId/:cityId',
  webAuth('getLocalities'),
  validate(CityValidation.idValidation),
  LocalityController.getByCityId
);
// Locality Routes //

// Outlet Routes //
router.post(
  '/outlet/save',
  webAuth('createOutlet'),
  validate(RestaurantValidation.createOutlet),
  RestaurantController.registerOutletAccount
);
router.get(
  '/outlet/getBasicDataForNewOutlet',
  webAuth('createOutlet'),
  RestaurantController.getBasicDataForNewOutlet
);
router.get(
  '/outlet/getBasicDataForNewOutletForApp',
  webAuth('createOutlet'),
  RestaurantController.getBasicDataForNewOutletFromApp
);
router.get(
  '/outlet/getMyOutlets/:restaurantId',
  webAuth('getMyOutlets'),
  validate(RestaurantValidation.idValidation),
  RestaurantController.getMyOutlets
);
router.patch(
  '/outlet/updateStatus/:restaurantId',
  webAuth('updateOutlet'),
  validate(RestaurantValidation.idValidation),
  RestaurantController.updateStatus
);
router.get(
  '/outlet/getById/:restaurantId',
  webAuth('getOutletById'),
  validate(RestaurantValidation.idValidation),
  RestaurantController.getById
);
router.get(
  '/outlet/getByIdForApp/:id/:vendorId',
  webAuth('getOutletById'),
  validate(RestaurantValidation.getOutletDetailForAppValidation),
  RestaurantController.getOutletDetailForApp
);
router.patch(
  '/outlet/update/:restaurantId',
  webAuth('updateOutlet'),
  validate(RestaurantValidation.idValidation),
  RestaurantController.updateOutlet
);
// Outlet Routes //

// Restaurant Campaign Routes //
router.get(
  '/restaurant_campaign/near_me/:restaurantId',
  webAuth('getRestaurantCampaignNearMe'),
  validate(RestaurantCampaignValidation.restaurantIdValidation),
  RestaurantCampaignController.getCampaignNearMe
);
router.delete(
  '/restaurant_campaign/leave/:campaignId/:restaurantId',
  webAuth('leaveRestaurantCampaign'),
  validate(RestaurantCampaignValidation.leaveAndJoinCampaignValidation),
  RestaurantCampaignController.leaveCampaign
);

router.post(
  '/restaurant_campaign/join_request',
  webAuth('joinRestaurantCampaign'),
  validate(RestaurantCampaignRequestValidation.joinCampaignValidation),
  RestaurantCampaignRequestController.requestCampaign
);
// Restaurant Campaign Routes //

// Food Campaign Routes //
router.get(
  '/food_campaign/near_me/:restaurantId',
  webAuth('getFoodCampaignNearMe'),
  validate(FoodCampaignValidation.restaurantIdValidation),
  FoodCampaignController.getCampaignNearMe
);
router.get(
  '/food_campaign/getDetails/:campaignId/:restaurantId',
  webAuth('getFoodCampaignDetails'),
  validate(FoodCampaignValidation.restaurantAndCampaignIdValidation),
  FoodCampaignController.getDetailsForCampaignRequest
);
router.post(
  '/food_campaign/join_request',
  webAuth('joinFoodCampaign'),
  validate(FoodCampaignRequestValidation.joinCampaignValidation),
  FoodCampaignRequestController.requestCampaign
);

router.delete(
  '/food_campaign/leave/:campaignId/:foodId',
  webAuth('leaveFoodCampaign'),
  validate(FoodCampaignValidation.leaveAndJoinCampaignIdValidation),
  FoodCampaignController.leaveCampaign
);
// Food Campaign Routes //

// Restaurant Slots Routes //
router.get(
  '/getMySlots/:restaurantId',
  webAuth('getMySlots'),
  validate(RestaurantValidation.idValidation),
  RestaurantController.getSlot
);
router.patch(
  '/updateMySlots/:restaurantId',
  webAuth('updateSlots'),
  validate(RestaurantValidation.slotUpdateValidation),
  RestaurantController.updateSlot
);
router.patch(
  '/updateMySlotsWeb/:restaurantId',
  webAuth('updateSlots'),
  validate(RestaurantValidation.slotUpdateValidation),
  RestaurantController.updateSlotWeb
);
// Restaurant Slots Routes //

// Orders Routes //
router.post(
  '/orders/getVendorOrders',
  webAuth('getVendorOrders'),
  validate(OrdersValidation.vendorOrderValidation),
  OrdersController.getVendorOrder
);
router.post(
  '/orders/prepareOrder',
  webAuth('updateOrder'),
  validate(OrdersValidation.prepareOrderValidation),
  OrdersController.prepareOrder
);
router.post(
  '/orders/acceptScheduleOrder',
  webAuth('updateOrder'),
  validate(OrdersValidation.acceptScheduleOrderValidation),
  OrdersController.acceptScheduleOrder
);
router.post(
  '/orders/orderReady',
  webAuth('updateOrder'),
  validate(OrdersValidation.orderReadyValidation),
  OrdersController.orderReady
);
router.get(
  '/drivers/activeDriver/:vendorId',
  webAuth('activeNearDriver'),
  validate(DriverValidation.nearActiveDriverValidation),
  DriverController.getNearMeActiveDriver
);
router.post(
  '/orders/handover_to_driver',
  webAuth('updateOrder'),
  validate(OrdersValidation.orderHandoverToDriverValidation),
  OrdersController.restaurantOrderHandoverDriver
);
router.post(
  '/orders/handover_to_customer',
  webAuth('updateOrder'),
  validate(OrdersValidation.orderHandoverToCustomerValidation),
  OrdersController.restaurantOrderHandoverCustomer
);
router.post(
  '/orders/rejectOrder/',
  webAuth('rejectOrder'),
  validate(OrdersValidation.orderRestaurantRejectValidation),
  OrdersController.restaurantRejectOrder
);
router.get(
  '/orders/fetchDriverNearToOrder/:id/:restaurant',
  webAuth('fetchDriverNearToOrder'),
  validate(OrdersValidation.findDriverValidation),
  OrdersController.fetchDriverNearToOrder
);
router.post(
  '/orders/assignDriverOrderVendor',
  webAuth('assignDriverOrderVendor'),
  validate(OrdersValidation.assignDriverOrderVendorValidation),
  OrdersController.assignDriverOrderVendor
);
router.get(
  '/orders/countWeb/:vendorId',
  webAuth('orderCountWeb'),
  validate(OrdersValidation.vendorOrderCountWebValidation),
  OrdersController.vendorOrderCountWeb
);
router.get(
  '/orders/webList',
  webAuth('orderWebList'),
  validate(OrdersValidation.vendorOrderWebValidation),
  OrdersController.vendorOrderListWeb
);
router.get(
  '/orders/vendorOrderDetails/:id/:vendor',
  webAuth('vendorOrderDetails'),
  validate(OrdersValidation.vendorOrderDetailValidation),
  OrdersController.vendorOrderDetail
);
router.get(
  '/orders/callCustomer/:id/:vendor',
  webAuth('vendorCallCustomerDeliveryman'),
  validate(OrdersValidation.vendorCallCustomerDeliverymanValidation),
  OrdersController.callCustomer
);
router.get(
  '/orders/callDeliveryman/:id/:vendor',
  webAuth('vendorCallCustomerDeliveryman'),
  validate(OrdersValidation.vendorCallCustomerDeliverymanValidation),
  OrdersController.callDeliveryman
);
router.get(
  '/orders/summary/:id/:vendor/:locale',
  webAuth('downloadOrderReceipt'),
  validate(OrdersValidation.downloadVendorOrderReceiptValidation),
  OrdersController.downloadVendorOrderSummary
);
router.get(
  '/orders/invoice/:id/:vendor/:locale',
  webAuth('downloadOrderReceipt'),
  validate(OrdersValidation.downloadVendorOrderReceiptValidation),
  OrdersController.downloadVendorOrderInvoice
);
router.get(
  '/orders/print_invoice/:id/:vendor',
  webAuth('vendorOrderDetails'),
  validate(OrdersValidation.vendorInvoiceValidation),
  OrdersController.vendorOrderInvoice
);
// Orders Routes //

// Order Cancellation Reason Routes //
router.get(
  '/cancellation/restaurant',
  webAuth('cancellationReason'),
  OrdersCancellationReasonController.getRestaurantCancellationList
);
// Order Cancellation Reason Routes //

// Coupons Routes //
router.post(
  '/coupons/request_new/',
  webAuth('requestNewCoupon'),
  validate(CouponValidation.requestNewCouponValidation),
  CouponController.requestNewCoupon
);
router.get('/coupons/get', webAuth('getVendorCoupons'), CouponController.getVendorCoupons);
router.post(
  '/coupons/getInfo/',
  webAuth('getVendorCouponInfo'),
  validate(CouponValidation.vendorCouponInfoValidation),
  CouponController.getVendorCouponInfo
);
router.patch(
  '/coupons/update/:id',
  webAuth('updateVendorCoupon'),
  validate(CouponValidation.updateVendorCouponValidation),
  CouponController.updateVendorCoupon
);
router.delete(
  '/coupons/delete/:id/:userId',
  webAuth('deleteVendorCoupon'),
  validate(CouponValidation.deleteVendorCouponValidation),
  CouponController.deleteVendorCoupon
);
router.patch(
  '/coupons/updateMeta/:id',
  webAuth('updateVendorCoupon'),
  validate(CouponValidation.vendorCouponUpdateStatusValidation),
  CouponController.updateMeta
);
// Coupons Routes //

// Subscription Tiffin Package Routes //
router.get(
  '/tiffin_packages/get_basic/:restaurant',
  webAuth('getTiffinPackageBasicInfo'),
  validate(SubscriptionTiffinPackageValidation.getBasicValidation),
  SubscriptionTiffinPackageController.getBasic
);
router.post(
  '/tiffin_packages/create/',
  webAuth('createTiffinPackage'),
  validate(SubscriptionTiffinPackageValidation.createSubscriptionTiffinValidation),
  SubscriptionTiffinPackageController.create
);
router.get(
  '/tiffin_packages/getMyPackages/:restaurant',
  webAuth('getMyTiffinPackages'),
  validate(SubscriptionTiffinPackageValidation.getPackageListVendorValidation),
  SubscriptionTiffinPackageController.getMyPackagesList
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
router.patch(
  '/tiffin_packages/updateStatus/:id',
  webAuth('updatePackageStatus'),
  validate(SubscriptionTiffinPackageValidation.updateVendorStatusValidation),
  SubscriptionTiffinPackageController.updatePackageStatus
);
router.delete(
  '/tiffin_packages/delete/:id',
  webAuth('deleteTiffinPackage'),
  validate(SubscriptionTiffinPackageValidation.deleteValidation),
  SubscriptionTiffinPackageController.drop
);
router.post(
  '/tiffin_packages/vendorTiffinSubscriptionPurchased/',
  webAuth('vendorTiffinSubscriptionPurchased'),
  validate(UserPurchasedTiffinSubscriptionValidation.purchasedSubscriptionListVendorValidation),
  UserPurchasedTiffinSubscriptionController.getPurchaseListForVendor
);
router.get(
  '/tiffin_packages/userPurchasedTiffinSubscriptionInfo/:id',
  webAuth('userPurchasedTiffinSubscriptionInfo'),
  validate(UserPurchasedTiffinSubscriptionValidation.purchaseDetailValidation),
  UserPurchasedTiffinSubscriptionController.getPurchaseDetailVendor
);
// Subscription Tiffin Package Routes //

// Dining Campaign Routes //
router.get(
  '/dining_campaign/near_me/:restaurantId',
  webAuth('getDiningCampaignNearMe'),
  validate(DiningCampaignValidation.restaurantIdValidation),
  DiningCampaignController.getCampaignNearMe
);
router.delete(
  '/dining_campaign/leave/:campaignId/:restaurantId',
  webAuth('leaveDiningCampaign'),
  validate(DiningCampaignValidation.leaveAndJoinCampaignValidation),
  DiningCampaignController.leaveCampaign
);
router.post(
  '/dining_campaign/join_request',
  webAuth('joinDiningCampaign'),
  validate(DiningCampaignRequestValidation.joinCampaignValidation),
  DiningCampaignRequestController.requestCampaign
);
// Dining Campaign Routes //

// Restaurant Extra Detail Routes //
router.post(
  '/restaurant_extra_detail/saveGuestAvailability/:restaurant',
  webAuth('saveGuestAvailabilityValidation'),
  validate(RestaurantExtraDetailValidation.saveGuestAvailabilityValidation),
  RestaurantExtraDetailController.saveGuestAvailability
);
router.get(
  '/restaurant_extra_detail/getGuestAvailability/:restaurant',
  webAuth('getGuestAvailability'),
  validate(RestaurantExtraDetailValidation.idValidation),
  RestaurantExtraDetailController.getGuestAvailability
);
router.get(
  '/restaurant_extra_detail/getMyDiningSchedule/:restaurant',
  webAuth('getMyDiningSchedule'),
  validate(RestaurantExtraDetailValidation.idValidation),
  RestaurantExtraDetailController.getMyDiningSchedule
);
router.post(
  '/restaurant_extra_detail/saveDiningSchedule/:restaurant',
  webAuth('saveDiningSchedule'),
  validate(RestaurantExtraDetailValidation.idValidation),
  RestaurantExtraDetailController.saveDiningSchedule
);
router.post(
  '/restaurant_extra_detail/saveDiningScheduleWeb/:restaurant',
  webAuth('saveDiningSchedule'),
  validate(RestaurantExtraDetailValidation.idValidation),
  RestaurantExtraDetailController.saveDiningScheduleWeb
);
router.get(
  '/restaurant_extra_detail/menu/:id',
  webAuth('restaurantMenuAndPhotos'),
  validate(RestaurantValidation.restaurantExtraInformation),
  RestaurantController.getRestaurantExtraInformation
);
router.patch(
  '/restaurant_extra_detail/updateMenu/:id',
  webAuth('restaurantMenuAndPhotos'),
  validate(RestaurantValidation.updateMenuAndPhotoInformation),
  RestaurantController.updateMenuAndPhotoInformation
);
// Restaurant Extra Detail Routes //

// Vendor Dining Information //
router.get(
  '/dining/getVendorDiningInformation/:id',
  webAuth('getVendorDiningInformation'),
  validate(RestaurantValidation.getVendorDiningInformation),
  RestaurantController.getVendorDiningInformation
);
router.get(
  '/dining/getVendorDiningInformationWeb/:id',
  webAuth('getVendorDiningInformation'),
  validate(RestaurantValidation.getVendorDiningInformation),
  RestaurantController.getVendorDiningInformationWeb
);
router.get(
  '/dining/getDiningCategories',
  webAuth('getDiningCategories'),
  DiningCategoryController.getDiningCategoriesListForVendor
);
router.patch(
  '/dining/updateDiningInformation/:id',
  webAuth('updateDiningInformation'),
  validate(RestaurantValidation.updateDiningInformation),
  RestaurantController.updateDiningInformation
);
// Vendor Dining Information //

// Dining Coupon Routes //
router.get(
  '/dining/getSetting',
  webAuth('getDiningSetting'),
  DiningSettingController.getDiningSettingForVendor
);
router.post(
  '/dining_coupon/request_new/',
  webAuth('requestNewDiningCoupon'),
  validate(DiningCouponValidation.requestNewCouponValidation),
  DiningCouponController.requestNewCoupon
);
router.get(
  '/dining_coupon/vendorCoupons',
  webAuth('getVendorDiningCoupons'),
  DiningCouponController.getVendorCoupons
);
router.delete(
  '/dining_coupon/delete/:id/:userId',
  webAuth('deleteVendorDiningCoupon'),
  validate(DiningCouponValidation.deleteVendorCouponValidation),
  DiningCouponController.deleteVendorCoupon
);
router.patch(
  '/dining_coupon/updateMeta/:id',
  webAuth('updateVendorDiningCoupon'),
  validate(DiningCouponValidation.vendorCouponUpdateStatusValidation),
  DiningCouponController.updateMeta
);
router.post(
  '/dining_coupon/getInfo/',
  webAuth('getVendorDiningCouponInfo'),
  validate(DiningCouponValidation.vendorCouponInfoValidation),
  DiningCouponController.getVendorCouponInfo
);
router.patch(
  '/dining_coupon/update/:id',
  webAuth('updateVendorDiningCoupon'),
  validate(DiningCouponValidation.updateVendorCouponValidation),
  DiningCouponController.updateVendorCoupon
);
// Dining Coupon Routes //

/// Dining Booking Routes ///
router.post(
  '/dining_booking/list/',
  webAuth('getVendorDiningBooking'),
  validate(DiningBookingValidation.diningBookingByVendorIdValidation),
  DiningBookingController.getVendorDiningBookingList
);
router.post(
  '/dining_booking/accept/',
  webAuth('acceptDiningBooking'),
  validate(DiningBookingValidation.acceptDiningBookingValidation),
  DiningBookingController.acceptDiningBooking
);
router.get(
  '/dining_booking/cancellation/restaurant',
  webAuth('diningBookingCancellationReason'),
  DiningBookingCancellationReasonController.getRestaurantCancellationList
);
router.post(
  '/dining_booking/reject/',
  webAuth('rejectDiningBooking'),
  validate(DiningBookingValidation.rejectDiningBookingValidation),
  DiningBookingController.rejectDiningBooking
);
router.post(
  '/dining_booking/complete/',
  webAuth('completeDiningBooking'),
  validate(DiningBookingValidation.completeDiningBookingValidation),
  DiningBookingController.completeDiningBooking
);
router.get(
  '/dining_booking/detail/:bookingId/:vendorId',
  webAuth('diningBookingInformation'),
  validate(DiningBookingValidation.bookingInformationValidation),
  DiningBookingController.getDiningBookingInformation
);
router.get(
  '/dining_booking/callCustomer/:bookingId/:vendorId',
  webAuth('diningBookingCallCustomer'),
  validate(DiningBookingValidation.callCustomerValidation),
  DiningBookingController.callBookingCustomer
);
router.post(
  '/dining_booking/list/web/',
  webAuth('getVendorDiningBooking'),
  validate(DiningBookingValidation.diningBookingByVendorIdValidation),
  DiningBookingController.getVendorWebDiningBookingList
);
/// Dining Booking Routes ///

// Food Taxation Routes //
router.post(
  '/food_taxation/save/',
  webAuth('saveFoodTaxation'),
  validate(FoodTaxationValidation.saveFoodTaxationValidation),
  FoodTaxationController.saveFoodTaxation
);
router.get(
  '/food_taxation/getByRestaurant/:restaurant/',
  webAuth('getFoodTaxation'),
  validate(FoodTaxationValidation.restaurantValidation),
  FoodTaxationController.getVendorTaxationList
);
router.patch(
  '/food_taxation/update/:id/:restaurant',
  webAuth('updateFoodTaxation'),
  validate(FoodTaxationValidation.updateValidation),
  FoodTaxationController.updateTaxation
);
router.delete(
  '/food_taxation/delete/:id/:restaurant',
  webAuth('deleteFoodTaxation'),
  validate(FoodTaxationValidation.deleteValidation),
  FoodTaxationController.deleteTaxation
);
router.get(
  '/food_taxation/getAllMyTaxation/:restaurant/',
  webAuth('getFoodTaxation'),
  validate(FoodTaxationValidation.getAllMyTaxationValidation),
  FoodTaxationController.getAllMyTaxation
);
// Food Taxation Routes //

// Review Rating Routes //
router.post(
  '/restaurant/reviews',
  webAuth('restaurantReviewList'),
  validate(ReviewRatingValidation.restaurantReviewValidation),
  ReviewRatingController.getRestaurantReview
);
// Review Rating Routes //

// Call Routes //
router.get(
  '/customer/call/:userId',
  webAuth('callCustomer'),
  validate(UserValidation.callValidation),
  UserController.callCustomer
);
// Call Routes //

// Complaints Routes //
router.get(
  '/orders/forComplaint/:id/:vendor',
  webAuth('detailsForComplaint'),
  validate(OrdersValidation.orderComplaintRestaurantValidation),
  OrdersController.getOrderDetailsForRestaurantComplaints
);
router.post(
  '/complaints/save',
  webAuth('saveComplaints'),
  validate(RestaurantComplaintValidation.saveComplaintValidation),
  RestaurantComplaintController.save
);
// Complaints Routes //

router.post(
  '/media/deleteMyImage',
  webAuth('deleteMyImage'),
  validate(FileUploadValidation.userMediaDropValidation),
  MediaController.dropUserMedia
);

// Restaurant Detail Update App //
router.get(
  '/restaurant/getDetailForWebUpdate/:restaurantId',
  webAuth('updateRestaurantDetail'),
  validate(RestaurantValidation.idValidation),
  RestaurantController.getRestaurantDetailWebForUpdate
);
router.get(
  '/restaurant/edit_detail/:id/',
  webAuth('editRestaurantDetailApp'),
  validate(RestaurantValidation.getRestaurantDetailForUpdateAppValidation),
  RestaurantController.getRestaurantDetailForUpdateApp
);

router.patch(
  '/restaurant/updateDetail/:id',
  webAuth('updateRestaurantDetail'),
  validate(RestaurantValidation.updateRestaurantDetailValidation),
  RestaurantController.updateRestaurantDetail
);
router.get(
  '/restaurant/temporaryClose/:id',
  webAuth('updateRestaurantDetail'),
  validate(RestaurantValidation.temporaryClosedValidation),
  RestaurantController.closeTemporaryRestaurant
);
router.get(
  '/restaurant/reOpenTemporary/:id',
  webAuth('updateRestaurantDetail'),
  validate(RestaurantValidation.temporaryClosedValidation),
  RestaurantController.reOpenTemporaryRestaurant
);
// Restaurant Detail Update App //

// Edit Profile //
router.get(
  '/profile/user/:id',
  webAuth('getUserProfile'),
  validate(AuthValidation.profileValidation),
  AuthController.getMyProfile
);
router.patch(
  '/profile/update/:id',
  webAuth('updateUserProfile'),
  validate(AuthValidation.updateProfileValidation),
  AuthController.updateMyProfile
);
// Edit Profile //

// Waiter Routes //
router.post(
  '/waiter/save',
  webAuth('createWaiter'),
  validate(WaiterValidation.createWaiter),
  WaiterController.registerWaiterAccount
);
router.get(
  '/waiter/getMyWaiter/:restaurant',
  webAuth('getMyWaiter'),
  validate(WaiterValidation.restaurantValidation),
  WaiterController.getMyWaiter
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
router.patch(
  '/waiter/updateWaiterStatus/:waiterId',
  webAuth('updateWaiterInfo'),
  validate(WaiterValidation.updateWaiterStatusValidation),
  WaiterController.updateWaiterStatus
);
// Waiter Routes //

// Restaurant Table Routes //
router.post(
  '/restaurant_table/save',
  webAuth('createRestaurantTable'),
  validate(RestaurantTableValidation.createRestaurantTable),
  RestaurantTableController.create
);
router.get(
  '/restaurant_table/getList/:restaurant',
  webAuth('getMyTableList'),
  validate(RestaurantTableValidation.listValidation),
  RestaurantTableController.get
);
router.patch(
  '/restaurant_table/update/:id',
  webAuth('updateRestaurantTable'),
  validate(RestaurantTableValidation.updateTableValidation),
  RestaurantTableController.updateTable
);
router.patch(
  '/restaurant_table/updateStatus/:id',
  webAuth('updateRestaurantTable'),
  validate(RestaurantTableValidation.updateTableStatusValidation),
  RestaurantTableController.updateStatus
);
router.delete(
  '/restaurant_table/delete/:id',
  webAuth('deleteRestaurantTable'),
  validate(RestaurantTableValidation.idValidation),
  RestaurantTableController.drop
);
router.get(
  '/restaurant_table/qr_table_detail/:vendor',
  webAuth('restaurant_table_detail'),
  validate(RestaurantTableValidation.vendorTableQrDetailValidation),
  RestaurantController.vendorTableQrDetail
);
// Restaurant Table Routes //

// Restaurant Wallet Routes //
router.get(
  '/restaurant/wallet/:vendor',
  webAuth('getRestaurantWallet'),
  validate(RestaurantValidation.vendorWalletValidation),
  RestaurantController.restaurantWalletDetail
);
router.get(
  '/wallet/getWalletTransaction/:user',
  webAuth('getWalletTransaction'),
  validate(UserValidation.idValidation),
  WalletController.vendorWalletTransaction
);
router.get(
  '/cashInHandHistory/getHistory/:vendor',
  webAuth('getCashInHandHistory'),
  validate(RestaurantValidation.vendorCashInHandValidation),
  RestaurantController.cashOnHandHistory
);
router.get(
  '/collectedCashInHandHistory/getHistory/:vendor',
  webAuth('getCollectedCashInHandHistory'),
  validate(RestaurantValidation.vendorCollectedCashInHandValidation),
  RestaurantController.cashCollectedHistory
);
router.get(
  '/cashInHandHistory/posAndTableOrderCommission/:vendor',
  webAuth('getPosAndTableOrderCommission'),
  validate(RestaurantValidation.vendorCashInHandValidation),
  RestaurantController.posAndTableOrderCommissionHistory
);
// Restaurant Wallet Routes //

// Payout Method Routes //
router.get(
  '/payoutMethod/list',
  webAuth('payoutMethodList'),
  WithdrawalMethodController.withdrawalMethodListVendor
);
router.post(
  '/payoutMethod/createPayoutMethod',
  webAuth('createPayoutMethod'),
  validate(RestaurantPayoutMethodValidation.createPayoutMethodValidation),
  RestaurantPayoutMethodController.create
);
router.get(
  '/payoutMethod/myPayoutList/:vendor',
  webAuth('getPayoutMethodList'),
  validate(RestaurantPayoutMethodValidation.vendorValidation),
  RestaurantPayoutMethodController.getMyPayoutMethodList
);
router.delete(
  '/payoutMethod/deleteMethod/:id/:vendor',
  webAuth('deletePayoutMethod'),
  validate(RestaurantPayoutMethodValidation.deletePayoutMethodValidation),
  RestaurantPayoutMethodController.deletePayoutMethod
);
router.get(
  '/payoutMethod/detail/:id/:vendor',
  webAuth('getPayoutMethodDetail'),
  validate(RestaurantPayoutMethodValidation.payoutMethodDetailValidation),
  RestaurantPayoutMethodController.getPayoutMethodDetail
);
router.patch(
  '/payoutMethod/updatePayoutMethod',
  webAuth('updatePayoutMethod'),
  validate(RestaurantPayoutMethodValidation.updatePayoutMethodValidation),
  RestaurantPayoutMethodController.updatePayoutMethodDetail
);
router.patch(
  '/payoutMethod/updateDefault/',
  webAuth('updatePayoutMethod'),
  validate(RestaurantPayoutMethodValidation.changeDefaultPayoutMethodValidation),
  RestaurantPayoutMethodController.changeDefaultPayoutMethod
);
// Payout Method Routes //

// Withdrawal Routes //
router.get(
  '/wallet/withdrawalDetail/:vendor',
  webAuth('withdrawalDetail'),
  validate(WalletValidation.vendorWalletWithdrawalDetailValidation),
  WalletController.vendorWalletWithdrawalDetail
);
router.post(
  '/wallet/requestWithdrawal',
  webAuth('withdrawalRequest'),
  validate(WithdrawalRequestValidation.createRestaurantWithdrawalRequestValidation),
  WithdrawalRequestController.createRestaurantWithdrawalRequest
);
router.get(
  '/wallet/withdrawalHistory/:vendor',
  webAuth('withdrawalHistory'),
  validate(WithdrawalRequestValidation.vendorHistoryValidation),
  WithdrawalRequestController.restaurantWithdrawalHistory
);
// Withdrawal Routes //

// POS Routes //
router.get(
  '/restaurant/posData/:vendor',
  webAuth('restaurantPosData'),
  validate(RestaurantValidation.posDataValidation),
  RestaurantController.getPosData
);
router.get(
  '/restaurant/posFoodInitialSearch/:vendor',
  webAuth('restaurantPosInitialFoodSearch'),
  validate(RestaurantValidation.posInitialFoodValidation),
  RestaurantController.posFoodSearchInitialData
);
router.get(
  '/restaurant/posFoodSearch/:vendor/:searchQuery',
  webAuth('restaurantPosFoodSearch'),
  validate(RestaurantValidation.posFoodSearchValidation),
  RestaurantController.posFoodSearch
);
router.get(
  '/restaurant/posOrderSettings/',
  webAuth('posOrderSettings'),
  OrderSettingsController.posOrderSettings
);
router.post(
  '/restaurant/posPlaceOrder/',
  webAuth('posPlaceOrder'),
  validate(PosOrTableOrderValidation.vendorPlaceOrderValidation),
  PosOrTableOrderController.vendorPlaceOrder
);
router.get(
  '/restaurant/posOrders/:vendor/',
  webAuth('posOrdersList'),
  validate(PosOrTableOrderValidation.vendorPosOrderValidation),
  PosOrTableOrderController.getPosOrderOfVendor
);
router.get(
  '/restaurant/posOrderDetail/:id/:vendor/',
  webAuth('posOrderDetail'),
  validate(PosOrTableOrderValidation.vendorPosOrderDetailValidation),
  PosOrTableOrderController.getPosOrderDetail
);
router.get(
  '/restaurant/posDataWeb/:vendor',
  webAuth('restaurantPosData'),
  validate(RestaurantValidation.posDataValidation),
  RestaurantController.getPosDataWeb
);
router.post(
  '/restaurant/posFoodListWeb/',
  webAuth('restaurantPosData'),
  validate(RestaurantValidation.posFoodListWebValidation),
  RestaurantController.getPosFoodDataWeb
);
router.get(
  '/restaurant/pos_invoice_print/:id/:vendor/',
  webAuth('posOrderDetail'),
  validate(PosOrTableOrderValidation.vendorInvoiceValidation),
  PosOrTableOrderController.vendorPOSOrderInvoice
);
// POS Routes //

// Table Order Routes //
router.get(
  '/table_order/ongoing/:vendor/',
  webAuth('onGoingTableOrder'),
  validate(TableOrderCartItemValidation.ongoingTableOrderValidation),
  TableOrderCartItemController.ongoingTableOrder
);
router.get(
  '/table_order/ongoingOrderDetail/:vendor/:tableId/',
  webAuth('onGoingTableOrderDetail'),
  validate(TableOrderCartItemValidation.vendorOngoingTableOrderValidation),
  TableOrderCartItemController.vendorOngoingOrderDetail
);
router.delete(
  '/table_order/deleteTableOrderCartItem/:vendor/:id/',
  webAuth('deleteTableOrderCartItem'),
  validate(TableOrderCartItemValidation.vendorDeleteCartItemValidation),
  TableOrderCartItemController.vendorDeleteCartItem
);
router.post(
  '/table_order/completeTableOrder',
  webAuth('completeTableOrder'),
  validate(TableOrderCartItemValidation.vendorCompleteTableOrderValidation),
  TableOrderCartItemController.vendorCompleteTableOrder
);
router.get(
  '/table_order/completedTableOrderList/:vendor/',
  webAuth('completedTableOrderList'),
  validate(TableOrderValidation.vendorTableOrderValidation),
  TableOrderController.getTableOrderOfVendor
);
router.get(
  '/table_order/tableOrderDetail/:vendor/:id/',
  webAuth('tableOrderDetail'),
  validate(TableOrderValidation.vendorTableOrderDetailValidation),
  TableOrderController.getTableOrderDetail
);
router.get(
  '/table_order/invoice_print/:id/:vendor/',
  webAuth('tableOrderDetail'),
  validate(TableOrderValidation.vendorOrderInvoiceValidation),
  TableOrderController.vendorTableOrderInvoice
);
// Table Order Routes //

// Business Insight Routes //
router.get(
  '/business/insight/:vendor/',
  webAuth('businessInsight'),
  validate(OrdersValidation.vendorBusinessInsightValidation),
  OrdersController.vendorOrderBusinessInsight
);
router.post(
  '/business/insight/custom/',
  webAuth('businessInsight'),
  validate(OrdersValidation.vendorBusinessCustomDateInsightValidation),
  OrdersController.vendorOrderCustomDateBusinessInsight
);
router.get(
  '/pos/insight/:vendor/',
  webAuth('businessInsight'),
  validate(PosOrTableOrderValidation.vendorBusinessInsightValidation),
  PosOrTableOrderController.vendorPosBusinessInsight
);
router.post(
  '/pos/insight/custom/',
  webAuth('businessInsight'),
  validate(PosOrTableOrderValidation.vendorBusinessCustomDateInsightValidation),
  PosOrTableOrderController.vendorCustomDatePosOrderBusinessInsight
);
router.get(
  '/table_order/insight/:vendor/',
  webAuth('businessInsight'),
  validate(TableOrderValidation.vendorBusinessInsightValidation),
  TableOrderController.vendorTableOrderBusinessInsight
);
router.post(
  '/table_order/insight/custom/',
  webAuth('businessInsight'),
  validate(TableOrderValidation.vendorBusinessCustomDateInsightValidation),
  TableOrderController.vendorCustomDateTableOrderBusinessInsight
);
router.get(
  '/business/web_overall_insight/:vendor/',
  webAuth('businessInsight'),
  validate(OrdersValidation.vendorBusinessInsightValidation),
  OrdersController.vendorWebOverallDashboardBusinessInsight
);
router.get(
  '/business/web_monthly_insight/:vendor/',
  webAuth('businessInsight'),
  validate(OrdersValidation.vendorBusinessInsightValidation),
  OrdersController.vendorWebMonthlyDashboardBusinessInsight
);
router.get(
  '/business/web_weekly_insight/:vendor/',
  webAuth('businessInsight'),
  validate(OrdersValidation.vendorBusinessInsightValidation),
  OrdersController.vendorWebWeeklyDashboardBusinessInsight
);
router.get(
  '/business/web_today_insight/:vendor/',
  webAuth('businessInsight'),
  validate(OrdersValidation.vendorBusinessInsightValidation),
  OrdersController.vendorWebTodayDashboardBusinessInsight
);
// Business Insight Routes //

// Subscription Routes //
router.get(
  '/restaurant/subscription_status/:vendor',
  webAuth('getSubscriptionInfo'),
  RestaurantController.getVendorSubscriptionStatus
);
router.get(
  '/restaurant/subscription/:vendor',
  webAuth('getSubscriptionInfo'),
  RestaurantController.vendorSubscriptionInfo
);
router.post(
  '/restaurant/renew_subscription/',
  webAuth('renewSubscription'),
  validate(RestaurantValidation.renewSubscriptionValidation),
  RestaurantController.vendorRenewSubscription
);
// Subscription Routes //

// Expense Routes //
router.post(
  '/expense/save/',
  webAuth('saveExpense'),
  validate(RestaurantExpenseValidation.saveExpenseValidation),
  RestaurantExpenseController.create
);
router.get(
  '/reports/expenseInitial',
  webAuth('expenseReport'),
  RestaurantExpenseController.getInitialResponse
);
router.get(
  '/reports/expense',
  webAuth('expenseReport'),
  RestaurantExpenseController.getExpenseList
);
router.get(
  '/reports/expense/export',
  webAuth('export_collection'),
  validate(RestaurantExpenseValidation.exportValidation),
  RestaurantExpenseController.exportCollection
);
// Expense Routes //

/// Chat Messages Routes //
router.post(
  '/chat_room/fetchMessages/',
  webAuth('fetchChatMessages'),
  validate(ChatRoomValidation.checkChatRoomValidation),
  ChatRoomController.checkChatRoom
);
router.post(
  '/chat_room/sendMessage/',
  webAuth('sendChatMessage'),
  validate(ChatRoomValidation.sendChatMessageValidation),
  ChatRoomController.saveNewMessage
);
router.get(
  '/chat_room/list/:user',
  webAuth('getChatList'),
  validate(ChatRoomValidation.chatListValidation),
  ChatRoomController.getMyConversionList
);
router.post(
  '/chat_room/conversion',
  webAuth('getChatConversion'),
  validate(ChatRoomValidation.getChatConversionValidation),
  ChatRoomController.getChatConversion
);
router.post(
  '/chat_room/fetch_messages/',
  webAuth('regular_chat_messages'),
  validate(ChatRoomValidation.checkChatRoomValidation),
  ChatRoomController.checkChatRoom
);
router.get(
  '/regular_chat_messages/:id',
  webAuth('regular_chat_messages'),
  validate(ChatRoomValidation.cityzenChatMessagesValidation),
  ChatRoomController.cityzenGetChatMessages
);
router.post(
  '/chat_room/send_regular_message/',
  webAuth('send_regular_message'),
  validate(ChatRoomValidation.sendChatMessageValidation),
  ChatRoomController.saveNewMessage
);
/// Chat Messages Routes //

// Support Chat Message Routes //
router.post(
  '/support_chat_room/fetchMessages/',
  webAuth('fetchChatMessages'),
  validate(ChatRoomValidation.supportChatRoomValidation),
  SupportChatRoomController.checkChatRoom
);
router.get(
  '/support_chat_room/list/:user',
  webAuth('getChatList'),
  validate(ChatRoomValidation.chatListValidation),
  SupportChatRoomController.mySupportChat
);
router.post(
  '/support_chat_room/sendMessage/',
  webAuth('sendChatMessage'),
  rateLimiter.supportChatSendLimiter,
  validate(ChatRoomValidation.sendChatMessageValidation),
  SupportChatRoomController.saveNewMessage
);
router.post(
  '/support_chat_room/conversion',
  webAuth('getChatConversion'),
  validate(ChatRoomValidation.getChatConversionValidation),
  SupportChatRoomController.getChatConversion
);
// Support Chat Message Routes //

// --- Enterprise: bot-first -> human handover (mirrors user.route) ---------
// webAuth here, not appAuth: this router serves the vendor web dashboard.
// Literal segments FIRST, so `/:id` below can never swallow them.
router.post(
  '/support_chat_room/bot/start',
  webAuth('fetchChatMessages'),
  validate(ChatRoomValidation.botStartValidation),
  SupportEnterpriseController.botStart
);
router.post(
  '/support_chat_room/bot/message',
  webAuth('sendChatMessage'),
  rateLimiter.supportChatSendLimiter,
  validate(ChatRoomValidation.botMessageValidation),
  SupportEnterpriseController.botMessage
);
router.get(
  '/support_chat_room/queue/:id',
  webAuth('fetchChatMessages'),
  validate(ChatRoomValidation.roomIdParamValidation),
  SupportEnterpriseController.queueStatus
);
router.post(
  '/support_chat_room/handover/:id',
  webAuth('sendChatMessage'),
  validate(ChatRoomValidation.handoverValidation),
  SupportEnterpriseController.handover
);
router.post(
  '/support_chat_room/csat/:id',
  webAuth('sendChatMessage'),
  validate(ChatRoomValidation.csatValidation),
  SupportEnterpriseController.submitCsat
);
router.post(
  '/support_chat_room/reopen/:id',
  webAuth('sendChatMessage'),
  validate(ChatRoomValidation.reopenValidation),
  SupportEnterpriseController.reopen
);

// Account Settings Routes//
router.patch(
  '/account_setting/update_password/:id',
  webAuth('update_password'),
  validate(UserValidation.updatePasswordValidation),
  UserController.updatePassword
);
router.get(
  '/account_setting/notification_setting/:id',
  webAuth('notification_setting'),
  validate(UserNotificationSettingValidation.idValidation),
  UserNotificationSettingController.getNotificationSettings
);
router.patch(
  '/account_setting/notification_setting/:id',
  webAuth('notification_setting'),
  validate(UserNotificationSettingValidation.updateSettingValidation),
  UserNotificationSettingController.updateNotificationSetting
);
router.patch(
  '/account_setting/update_email/:id',
  webAuth('update_email'),
  validate(UserValidation.updateEmailValidation),
  UserController.updateEmail
);
router.patch(
  '/account_setting/update_email_after_verification/:id',
  webAuth('update_email'),
  validate(UserValidation.updateEmailAfterVerificationValidation),
  UserController.updateEmailAfterVerification
);
router.patch(
  '/account_setting/update_mobile_number/:id',
  webAuth('update_mobile_number'),
  validate(UserValidation.updateMobileValidation),
  UserController.updateMobileNumber
);
router.patch(
  '/account_setting/update_mobile_number_after_verification/:id',
  webAuth('update_mobile_number'),
  validate(UserValidation.updateMobileAfterVerificationValidation),
  UserController.updateMobileAfterVerification
);
router.patch(
  '/account_setting/update_mobile_number_after_firebase_verification/:id',
  webAuth('update_mobile_number'),
  validate(UserValidation.updateMobileAfterFirebaseVerificationValidation),
  UserController.updateMobileAfterFirebaseVerification
);
router.get(
  '/delete_account_reason_list',
  webAuth('delete_account_reason_list'),
  UserDeleteAccountReasonController.geRestaurantActiveReason
);
router.post(
  '/account_setting/delete_account',
  webAuth('delete_account'),
  validate(UserValidation.deleteRestaurantAccountValidation),
  UserController.restaurantDeleteAccount
);
router.patch(
  '/account_setting/update_locale/',
  webAuth('update_locale'),
  validate(UserValidation.updateLocaleValidation),
  UserController.updateUserLocale
);
// Account Settings Routes//

// Kitchen Owner Routes //
router.post(
  '/kitchen_owner/save',
  webAuth('create_kitchen_owner'),
  validate(KitchenOwnerValidation.createKitchenOwner),
  KitchenOwnerController.registerKitchenOwnerAccount
);
router.get(
  '/kitchen_owner/list/:restaurant',
  webAuth('kitchen_owner_list'),
  validate(KitchenOwnerValidation.restaurantValidation),
  KitchenOwnerController.getKitchenOwners
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
router.patch(
  '/kitchen_owner/update_kitchen_status/:kitchenId',
  webAuth('update_kitchen_status'),
  validate(KitchenOwnerValidation.updateKitchenOwnerStatusValidation),
  KitchenOwnerController.updateKitchenOwnerStatus
);
// Kitchen Owner Routes //

// Vendor Profile //
router.get(
  '/vendor_profile/:id',
  webAuth('vendor_profile'),
  validate(UserValidation.vendorProfileValidation),
  UserController.getVendorProfile
);
router.patch(
  '/update_vendor/:id',
  webAuth('update_vendor'),
  validate(UserValidation.updateVendorProfileValidation),
  UserController.updateVendorProfile
);
router.patch(
  '/update_vendor_password/:id',
  webAuth('update_vendor_password'),
  validate(UserValidation.updateVendorPasswordValidation),
  UserController.updateVendorPassword
);

router.post(
  '/notification_list/',
  webAuth('notification_list'),
  validate(UserValidation.notificationListValidation),
  NotificationListController.getMyNotificationList
);
router.get(
  '/read_all_notification/:user',
  webAuth('read_all_notification'),
  validate(UserValidation.idValidation),
  NotificationListController.readAllNotification
);

router.get(
  '/vendor_header_content/:id',
  webAuth('vendor_header_content'),
  validate(UserValidation.vendorHeaderValidation),
  NotificationListController.vendorHeaderContent
);
// Vendor Profile //

// Vendor User Contact Detail Routes //
router.get(
  '/user_contact_detail/:id',
  webAuth('user_contact_detail'),
  validate(UserValidation.adminUserContactDetailValidation),
  UserController.adminUserContactDetail
);
// Vendor User Contact Detail Routes //

module.exports = router;

