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

const UserValidation = require('../../validations/user.validation');
const OrdersValidation = require('../../validations/orders.validation');
const LocalityValidation = require('../../validations/locality.validation');
const RestaurantValidation = require('../../validations/restaurant.validation');
const RestaurantJoiningRequestValidation = require('../../validations/restaurant.joining.request.validation');
const WaiterValidation = require('../../validations/waiter.validation');
const DriverValidation = require('../../validations/driver.validation');
const DeliverymanJoiningRequestValidation = require('../../validations/deliveryman.joining.request.validation');
const CityValidation = require('../../validations/city.validation');
const AuthValidation = require('../../validations/auth.validation');
const PosOrTableOrderValidation = require('../../validations/pos.or.table.order.validation');
const TableOrderValidation = require('../../validations/table.order.validation');
const FoodValidation = require('../../validations/food.validation');
const VendorSubCategoryValidation = require('../../validations/vendor.sub.category.validation');
const AddonsValidation = require('../../validations/addons.validation');
const FoodTaxationValidation = require('../../validations/food.taxation.validation');
const SubscriptionTiffinPackageValidation = require('../../validations/subscription.tiffin.packages.validation');
const UserPurchasedTiffinSubscriptionValidation = require('../../validations/user.purchased.tiffin.subscriptions.validation');
const RefundRequestValidation = require('../../validations/refund.request.validation');
const TiffinSubscriptionRefundRequestValidation = require('../../validations/tiffin.subscription.refund.request.validation');
const DiningBookingRefundRequestValidation = require('../../validations/dining.booking.refund.request.validation');
const DiningBookingValidation = require('../../validations/dining.booking.validation');
const RestaurantCampaignValidation = require('../../validations/restaurant.campaign.validation');
const RestaurantCampaignRequestValidation = require('../../validations/restaurant.campaign.request.validation');
const DiningCampaignValidation = require('../../validations/dining.campaign.validation');
const DiningCampaignRequestValidation = require('../../validations/dining.campaign.request.validation');
const FoodCampaignValidation = require('../../validations/food.campaign.validation');
const FoodCampaignRequestValidation = require('../../validations/food.campaign.request.validation');
const FileValidation = require('../../validations/file.validation');
const BannersValidation = require('../../validations/banner.validation');
const CouponValidation = require('../../validations/coupon.validation');
const DiningCouponValidation = require('../../validations/dining.coupon.validation');
const CollectCashValidation = require('../../validations/collect.cash.validation');
const WithdrawalRequestValidation = require('../../validations/withdrawal.request.validation');
const DisbursementValidation = require('../../validations/disbursement.validation');
const KitchenOwnerValidation = require('../../validations/kitchen.owner.validation');
const ChatRoomValidation = require('../../validations/chat.room.validation');
const ReportIssueRestaurantReasonValidation = require('../../validations/report.issue.restaurant.reason.validation');
const HideRestaurantReasonValidation = require('../../validations/hide.restaurant.reason.validation');
const DeliveryConfigValidation = require('../../validations/delivery.config.validation');
const DeliveryZoneValidation = require('../../validations/delivery.zone.validation');

const UserController = require('../../controllers/user.controller');
const OrdersController = require('../../controllers/orders.controller');
const LocalityController = require('../../controllers/locality.controller');
const RestaurantController = require('../../controllers/restaurant.controller');
const RestaurantJoiningRequestController = require('../../controllers/restaurant.joining.request.controller');
const WaiterController = require('../../controllers/waiter.controller');
const ReportIssueRestaurantController = require('../../controllers/report.issue.restaurant.controller');
const HideRestaurantController = require('../../controllers/hide.restaurant.controller');
const DeliveryZoneController = require('../../controllers/delivery.zone.controller');
const DispatchController = require('../../controllers/dispatch.controller');
const DispatchMetricsValidation = require('../../validations/dispatch.metrics.validation');
const DriverController = require('../../controllers/driver.controller');
const DeliverymanJoiningRequestController = require('../../controllers/deliveryman.joining.request.controller');
const MediaController = require('../../controllers/media.controller');
const CityController = require('../../controllers/city.controller');
const PosOrTableOrderController = require('../../controllers/pos.or.table.order.controller');
const TableOrderController = require('../../controllers/table.order.controller');
const FoodController = require('../../controllers/food.controller');
const SubCategoryController = require('../../controllers/sub.category.controller');
const VendorSubCategoryController = require('../../controllers/vendor.sub.category.controller');
const AddonsController = require('../../controllers/addons.controller');
const FoodTaxationController = require('../../controllers/food.taxation.controller');
const SubscriptionTiffinPackageController = require('../../controllers/subscription.tiffin.package.controller');
const UserPurchasedTiffinSubscriptionController = require('../../controllers/user.purchased.tiffin.subscription.controller');
const RefundRequestController = require('../../controllers/refund.request.controller');
const TiffinSubscriptionRefundRequestController = require('../../controllers/tiffin.subscription.refund.request.controller');
const DiningBookingRefundRequestController = require('../../controllers/dining.booking.refund.request.controller');
const ComplaintsController = require('../../controllers/complaints.controller');
const RestaurantComplaintsController = require('../../controllers/restaurant.complaints.controller');
const DiningBookingController = require('../../controllers/dining.booking.controller');
const RestaurantCampaignController = require('../../controllers/restaurant.campaign.controller');
const RestaurantCampaignRequestController = require('../../controllers/restaurant.campaign.request.controller');
const DiningCampaignController = require('../../controllers/dining.campaign.controller');
const DiningCampaignRequestController = require('../../controllers/dining.campaign.request.controller');
const FoodCampaignController = require('../../controllers/food.campaign.controller');
const FoodCampaignRequestController = require('../../controllers/food.campaign.request.controller');
const BannersController = require('../../controllers/banners.controller');
const CouponController = require('../../controllers/coupon.controller');
const DiningCouponController = require('../../controllers/dining.coupon.controller');
const CollectCashController = require('../../controllers/collect.cash.controller');
const WithdrawalRequestController = require('../../controllers/withdrawal.request.controller');
const DisbursementController = require('../../controllers/disbursement.controller');
const RestaurantPayoutMethodController = require('../../controllers/restaurant.payout.method.controller');
const WalletController = require('../../controllers/wallet.controller');
const ReviewRatingController = require('../../controllers/review.ratings.controller');
const DeliverymanPayoutMethodController = require('../../controllers/deliveryman.payout.method.controller');
const UserAddressController = require('../../controllers/user.address.controller');
const FavouriteController = require('../../controllers/favourite.controller');
const KitchenOwnerController = require('../../controllers/kitchen.owner.controller');
const FcmController = require('../../controllers/fcm.notification.controller');
const NotificationListController = require('../../controllers/notification.list.controller');
const ChatRoomController = require('../../controllers/chat.room.controller');
const SupportChatRoomController = require('../../controllers/support.chat.room.controller');

const router = express.Router();

router.get(
  '/web_guard/:id',
  webAuth('web_guard'),
  validate(UserValidation.webGuardValidation),
  UserController.cityMasterTeamProfile
);

router.get(
  '/dashboard/:master',
  webAuth('dashboard'),
  validate(AuthValidation.cityMasterValidation),
  OrdersController.cityzenDashboard
);

router.post(
  '/localities/save/:master',
  webAuth('create_locality'),
  validate(LocalityValidation.createLocalityCityzenValidation),
  LocalityController.createFromCityzen
);
router.get(
  '/localities/getAll/:master',
  webAuth('localities'),
  validate(LocalityValidation.cityMasterValidation),
  LocalityController.getByCityzen
);
router.patch(
  '/localities/update/:localityId',
  webAuth('update_locality'),
  validate(LocalityValidation.idValidation),
  LocalityController.updateFromCityzen
);
router.patch(
  '/localities/update_status/:localityId',
  webAuth('update_locality'),
  validate(LocalityValidation.idValidation),
  LocalityController.updateStatus
);
router.delete(
  '/localities/delete_locality/:localityId',
  webAuth('delete_locality'),
  validate(LocalityValidation.idValidation),
  LocalityController.drop
);

router.get('/media_files/:userId', webAuth('media_files'), MediaController.getVendorMedia);

router.get(
  '/restaurant_list/:master',
  webAuth('restaurant_list'),
  validate(RestaurantValidation.cityMasterValidation),
  RestaurantController.cityzenRestaurants
);
router.patch(
  '/update_restaurant_status/:restaurantId',
  webAuth('update_restaurant'),
  validate(RestaurantValidation.idValidation),
  RestaurantController.updateStatus
);
router.get(
  '/outlet_list/:master',
  webAuth('restaurant_list'),
  validate(RestaurantValidation.cityMasterValidation),
  RestaurantController.cityzenOutlets
);

router.get(
  '/restaurant_register_request_list/:status/:master',
  webAuth('restaurant_register_request_list'),
  validate(RestaurantJoiningRequestValidation.cityzenStatusValidation),
  RestaurantJoiningRequestController.cityzenJoiningRequestList
);
router.delete(
  '/delete_restaurant_register_request/:id',
  webAuth('delete_restaurant_register_request'),
  validate(RestaurantJoiningRequestValidation.idValidation),
  RestaurantJoiningRequestController.deleteRequest
);

router.get(
  '/filter_restaurant_data',
  webAuth('restaurant_list'),
  RestaurantController.cityzenFilterQueryData
);
router.post(
  '/filter_restaurant',
  webAuth('restaurant_list'),
  validate(RestaurantValidation.cityzenFilterQueryValidation),
  RestaurantController.cityzenFilterQuery
);

router.get(
  '/waiter_list/:master',
  webAuth('waiter_list'),
  validate(WaiterValidation.cityMasterValidation),
  WaiterController.cityzenWaiterList
);
router.patch(
  '/update_waiter_status/:waiterId',
  webAuth('update_waiter'),
  validate(WaiterValidation.updateWaiterStatusValidation),
  WaiterController.updateWaiterStatus
);

// Kitchen Owner Routes //
router.get(
  '/kitchen_owners_list/:master',
  webAuth('get_kitchen_owner_list'),
  validate(KitchenOwnerValidation.cityMasterValidation),
  KitchenOwnerController.cityzenKitchenOwnerList
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

router.get(
  '/restaurant_report_issue_list/:master',
  webAuth('restaurant_report_issue_list'),
  validate(ReportIssueRestaurantReasonValidation.cityMasterValidation),
  ReportIssueRestaurantController.cityzenReportsList
);
router.get(
  '/hidden_restaurant_list/:master',
  webAuth('hidden_restaurant_list'),
  validate(HideRestaurantReasonValidation.cityMasterValidation),
  HideRestaurantController.cityzentHiddenRestaurantList
);
router.get(
  '/system_deliveryman_list/:master',
  webAuth('deliveryman_list'),
  validate(DriverValidation.cityMasterValidation),
  DriverController.cityzenSystemDriver
);
router.patch(
  '/update_status_deliveryman/:driverId',
  webAuth('update_deliveryman'),
  validate(DriverValidation.idValidation),
  DriverController.updateStatus
);
router.get(
  '/vendor_deliveyman_list/:master',
  webAuth('deliveryman_list'),
  validate(DriverValidation.cityMasterValidation),
  DriverController.cityzenVendorDriverList
);

router.get(
  '/deliveryman_joining_request/:status/:master',
  webAuth('deliveryman_joining_request'),
  validate(DeliverymanJoiningRequestValidation.cityzenValidation),
  DeliverymanJoiningRequestController.cityzentJoiningRequestList
);
router.delete(
  '/delete_deliveryman_request/:id',
  webAuth('delete_deliveryman_request'),
  validate(DeliverymanJoiningRequestValidation.idValidation),
  DeliverymanJoiningRequestController.deleteRequest
);

router.get('/media_list', webAuth('media_list'), MediaController.get);

router.get(
  '/waiter_detail/:waiterId',
  webAuth('waiter_detail'),
  validate(WaiterValidation.idValidation),
  WaiterController.getById
);
router.patch(
  '/update_waiter_detail/:userId',
  webAuth('update_waiter'),
  validate(WaiterValidation.updateWaiterInfoValidation),
  WaiterController.updateWaiterInfo
);

router.get(
  '/basic_data_for_new_restaurant/:master',
  webAuth('create_restaurant'),
  validate(AuthValidation.cityMasterValidation),
  RestaurantController.cityzenBasicDataForNewRestaurant
);
router.get(
  '/restaurant_deep_detail/:restaurantId',
  webAuth('restaurant_detail'),
  validate(RestaurantValidation.idValidation),
  RestaurantController.cityzenRestuarantGetById
);
router.patch(
  '/update_restaurant_detail/:restaurantId/:master',
  webAuth('update_restaurant'),
  validate(RestaurantValidation.cityzenUpdateValidation),
  RestaurantController.cityzenUpdateRestaurant
);
// Delivery coverage (Batch B-2): city-master override/reset per restaurant.
// Same handler as the admin route; the `:master` param only scopes auth.
router.patch(
  '/update_restaurant_delivery_config/:restaurantId/:master',
  webAuth('update_restaurant'),
  validate(DeliveryConfigValidation.cityzenDeliveryConfigPatch),
  RestaurantController.cityzenUpdateDeliveryConfigHandler
);
router.get(
  '/restaurant_delivery_config/:restaurantId/:master',
  webAuth('restaurant_detail'),
  validate(DeliveryConfigValidation.cityzenDeliveryConfigPatch),
  RestaurantController.cityzenGetDeliveryConfigHandler
);
// Delivery zones (Batch B-2, scoped D-1): review (list/propose) and
// publish/move for the city-master's own cities — `:master` is enforced
// against the city at the service, cross-city access is 403.
router.get(
  '/delivery_zones/:master/by_city/:cityId',
  webAuth('localities'),
  validate(DeliveryZoneValidation.cityzenCityZones),
  DeliveryZoneController.cityzenListByCity
);
router.get(
  '/delivery_zones/:master/propose/:cityId',
  webAuth('localities'),
  validate(DeliveryZoneValidation.cityzenProposeZones),
  DeliveryZoneController.cityzenPropose
);
router.post(
  '/delivery_zones/:master/publish/:cityId',
  webAuth('update_locality'),
  validate(DeliveryZoneValidation.cityzenPublishZones),
  DeliveryZoneController.cityzenPublish
);
router.patch(
  '/delivery_zones/:master/move/:localityId',
  webAuth('update_locality'),
  validate(DeliveryZoneValidation.cityzenMoveLocality),
  DeliveryZoneController.cityzenMove
);
router.get(
  '/delivery_zones/:master/my_city',
  webAuth('localities'),
  validate(DeliveryZoneValidation.cityzenMaster),
  DeliveryZoneController.cityzenMyCity
);
// Dispatch observability (Batch E-2, scoped D-1): same read models as admin,
// additionally scoped to the master's city/restaurant.
router.get(
  '/dispatch/metrics/:master',
  webAuth('restaurant_detail'),
  validate(DispatchMetricsValidation.cityzenMetricsQuery),
  DispatchController.cityzenGetMetrics
);
router.get(
  '/delivery_zones/:master/metrics/:cityId',
  webAuth('localities'),
  validate(DispatchMetricsValidation.cityzenZoneMetricsParams),
  DispatchController.cityzenGetZoneMetrics
);
router.get(
  '/delivery_zones/:master/ungrouped/:cityId',
  webAuth('localities'),
  validate(DispatchMetricsValidation.cityzenZoneMetricsParams),
  DispatchController.cityzenGetUngrouped
);
router.post(
  '/create_restaurant/:master',
  webAuth('create_restaurant'),
  validate(RestaurantValidation.cityzenCreateVendor),
  RestaurantController.cityzenRegisterVendorAccount
);

router.get(
  '/localities_from_city/:cityId',
  webAuth('localities'),
  validate(CityValidation.idValidation),
  LocalityController.getByCityId
);

router.get(
  '/restaurant_register_request_detail/:id',
  webAuth('restaurant_register_request_detail'),
  validate(RestaurantJoiningRequestValidation.idValidation),
  RestaurantJoiningRequestController.cityzenGetDetail
);
router.patch(
  '/reject_restaurant_register_request/:id',
  webAuth('reject_restaurant_register_request'),
  validate(RestaurantJoiningRequestValidation.rejectValidation),
  RestaurantJoiningRequestController.rejectRequest
);
router.post(
  '/accept_restaurant_register_request/:id/:master',
  webAuth('accept_restaurant_register_request'),
  validate(RestaurantJoiningRequestValidation.cityzenApproveValidation),
  RestaurantJoiningRequestController.cityzenApproveRequest
);

router.get(
  '/deliveryman_basic_data/:master',
  webAuth('create_deliveryman'),
  validate(AuthValidation.cityMasterValidation),
  DriverController.cityzenBasicData
);
router.get(
  '/deliveryman_detail/:driverId',
  webAuth('deliveryman_detail'),
  validate(DriverValidation.idValidation),
  DriverController.cityzenDeliverymanGetById
);
router.patch(
  '/update_deliveryman_detail/:driverId/:master',
  webAuth('update_deliveryman'),
  validate(DriverValidation.cityzenUpdateValidation),
  DriverController.cityzenUpdate
);
router.post(
  '/create_deliveryman/:master',
  webAuth('create_deliveryman'),
  validate(DriverValidation.cityzenCreateDriver),
  DriverController.cityzenRegisterDriverAccount
);
router.get(
  '/deliveryman_joining_detail/:id',
  webAuth('deliveryman_joining_detail'),
  validate(DeliverymanJoiningRequestValidation.idValidation),
  DeliverymanJoiningRequestController.cityzenGetDetail
);
router.patch(
  '/reject_deliveryman_register_request/:id',
  webAuth('reject_deliveryman_register_request'),
  validate(DeliverymanJoiningRequestValidation.rejectValidation),
  DeliverymanJoiningRequestController.rejectRequest
);
router.post(
  '/approve_deliveryman_register_request/:id/:master',
  webAuth('approve_deliveryman_register_request'),
  validate(DeliverymanJoiningRequestValidation.cityzenApproveValidation),
  DeliverymanJoiningRequestController.cityzenApproveRequest
);

router.get(
  '/pos_initial/:master',
  webAuth('pos_order'),
  validate(AuthValidation.cityMasterValidation),
  CityController.cityzenPos
);
router.get(
  '/pos_categories/:restaurantId',
  webAuth('pos_order'),
  validate(RestaurantValidation.idValidation),
  RestaurantController.posRestaurantData
);
router.post(
  '/pos_food_list/',
  webAuth('pos_order'),
  validate(RestaurantValidation.posFoodListWebValidation),
  RestaurantController.getPosFoodDataWeb
);
router.get(
  '/pos_search/:vendor/:searchQuery',
  webAuth('pos_order'),
  validate(RestaurantValidation.posFoodSearchValidation),
  RestaurantController.posFoodSearch
);
router.get(
  '/pos_customer_detail/:user',
  webAuth('pos_order'),
  validate(UserValidation.idValidation),
  UserController.adminPosCustomerDetail
);

router.get(
  '/search_customer/:name',
  webAuth('search_customer'),
  validate(UserValidation.searchUser),
  UserController.findUserWithName
);
router.post(
  '/pos_create_customer',
  webAuth('create_customer'),
  validate(AuthValidation.cityzenAddCustomerValidation),
  UserController.cityzenCreateCustomer
);
router.post(
  '/pos_place_order',
  webAuth('pos_order'),
  validate(OrdersValidation.cityzenPOSOrderValidation),
  OrdersController.placePOSCityzenOrder
);

router.get(
  '/orders_count/:master',
  webAuth('order_list'),
  validate(AuthValidation.cityMasterValidation),
  OrdersController.cityzenOrderCounts
);
router.get(
  '/order_list/:master',
  webAuth('order_list'),
  validate(OrdersValidation.cityzenOrderValidation),
  OrdersController.cityzenOrderList
);
router.get(
  '/cityzen_order_detail/:id',
  webAuth('order_detail'),
  validate(OrdersValidation.orderDetailAdminValidation),
  OrdersController.getOrderDetailAdmin
);
router.get(
  '/cityzen_order_invoice/:id',
  webAuth('order_detail'),
  validate(OrdersValidation.adminInvoiceValidation),
  OrdersController.adminOrderInvoice
);
router.get(
  '/un_assinged_order_list/:master',
  webAuth('order_list'),
  validate(OrdersValidation.cityzenUnAssignedOrderValidation),
  OrdersController.cityzenUnAssignedOrderList
);
router.get(
  '/fetch_deliveryman_near_order/:id/:restaurant',
  webAuth('fetch_deliveryman_near_order'),
  validate(OrdersValidation.findDriverValidation),
  OrdersController.fetchDriverNearToOrder
);
router.post(
  '/assign_order_deliveryman',
  webAuth('assign_order_deliveryman'),
  validate(OrdersValidation.assignDriverOrderAdminValidation),
  OrdersController.assignDriverOrderAdmin
);

router.get(
  '/pos_order_list/:master',
  webAuth('pos_order_list'),
  validate(PosOrTableOrderValidation.cityMasterValidation),
  PosOrTableOrderController.cityzenPosOrderList
);
router.get(
  '/cityzen_pos_order_detail/:id',
  webAuth('pos_order_detail'),
  validate(PosOrTableOrderValidation.cityzenPosOrderDetailValidation),
  PosOrTableOrderController.cityzenPosOrderDetail
);
router.get(
  '/cityzen_pos_order_invoice/:id',
  webAuth('pos_order_detail'),
  validate(PosOrTableOrderValidation.orderInvoiceValidation),
  PosOrTableOrderController.adminPOSOrderInvoice
);

router.get(
  '/table_order_list/:master',
  webAuth('table_order_list'),
  validate(TableOrderValidation.cityMasterValidation),
  TableOrderController.cityzenTableOrderList
);
router.get(
  '/cityzen_table_order_detail/:id',
  webAuth('table_order_detail'),
  validate(TableOrderValidation.cityzenTableOrderDetailValidation),
  TableOrderController.cityzenTableOrderDetail
);
router.get(
  '/cityzen_table_order_invoice/:id',
  webAuth('table_order_detail'),
  validate(TableOrderValidation.orderInvoiceValidation),
  TableOrderController.adminTableOrderInvoice
);

router.get(
  '/food_list/:master',
  webAuth('food_list'),
  validate(FoodValidation.cityMasterValidation),
  FoodController.cityzenFoodList
);
router.patch(
  '/update_food_meta_detail/:foodId',
  webAuth('update_food'),
  validate(FoodValidation.idValidation),
  FoodController.updateMetaInfo
);
router.get(
  '/food_detail/:foodId',
  webAuth('food_detail'),
  validate(FoodValidation.idValidation),
  FoodController.adminFoodDetail
);

router.get(
  '/restaurant_cityzen/:master',
  webAuth('restaurant_cityzen'),
  validate(AuthValidation.cityMasterValidation),
  RestaurantController.cityzenRestaurantsLimitedDetails
);
router.get(
  '/food_get_basic_data/:restaurant',
  webAuth('create_food'),
  validate(FoodValidation.myFoodValidation),
  FoodController.getBasicData
);
router.get(
  '/sub_cateories_list/:category',
  webAuth('categories_list'),
  SubCategoryController.getActiveByCategoryId
);
router.get(
  '/vendor_sub_categories_list/:category/:restaurant',
  webAuth('categories_list'),
  validate(VendorSubCategoryValidation.mySubCategoryByCateIdValidation),
  VendorSubCategoryController.getAllSubCategoryById
);
router.post(
  '/create_food',
  webAuth('create_food'),
  validate(FoodValidation.createFood),
  FoodController.create
);
router.get(
  '/food_deep_detail/:foodId',
  webAuth('food_detail'),
  validate(FoodValidation.idValidation),
  FoodController.getFoodInfoForAdmin
);
router.patch(
  '/update_food_detail/:foodId',
  webAuth('update_food'),
  validate(FoodValidation.idValidation),
  FoodController.update
);
router.delete(
  '/delete_food/:foodId',
  webAuth('delete_food'),
  validate(FoodValidation.idValidation),
  FoodController.drop
);

router.get(
  '/addons_list/:master',
  webAuth('addon_list'),
  validate(AddonsValidation.cityMasterValidation),
  AddonsController.cityzenAddonList
);
router.patch(
  '/update_addons/:addonId',
  webAuth('update_addon'),
  validate(AddonsValidation.idValidation),
  AddonsController.update
);
router.post(
  '/create_addon',
  webAuth('create_addon'),
  validate(AddonsValidation.createAddons),
  AddonsController.create
);
router.delete(
  '/delete_addons/:addonId',
  webAuth('delete_addons'),
  validate(AddonsValidation.idValidation),
  AddonsController.drop
);

router.get(
  '/restaurant_food_taxation_list/:master',
  webAuth('restaurant_food_taxation_list'),
  validate(FoodTaxationValidation.cityMasterValidation),
  FoodTaxationController.cityzenTaxationList
);
router.delete(
  '/delete_food_taxation/:restaurant',
  webAuth('delete_food_taxation'),
  validate(FoodTaxationValidation.deleteAdminValidation),
  FoodTaxationController.deleteTaxationAdmin
);

router.get(
  '/tiffin_packages_list/:master',
  webAuth('tiffin_packages'),
  validate(SubscriptionTiffinPackageValidation.cityMasterValidation),
  SubscriptionTiffinPackageController.cityzenPackageList
);
router.get(
  '/food_list_for_tiffin_packages/:restaurant',
  webAuth('tiffin_packages'),
  validate(SubscriptionTiffinPackageValidation.getBasicValidation),
  SubscriptionTiffinPackageController.getBasic
);
router.post(
  '/create_tiffin_package/',
  webAuth('create_tiffin_package'),
  validate(SubscriptionTiffinPackageValidation.createSubscriptionTiffinValidation),
  SubscriptionTiffinPackageController.create
);
router.get(
  '/tiffin_package_details/:id/:restaurant',
  webAuth('tiffin_packages'),
  validate(SubscriptionTiffinPackageValidation.idValidation),
  SubscriptionTiffinPackageController.getById
);
router.patch(
  '/update_tiffin_package/:id',
  webAuth('update_tiffin_package'),
  validate(SubscriptionTiffinPackageValidation.updateValidation),
  SubscriptionTiffinPackageController.updatePackage
);
router.patch(
  '/update_tiffin_package_status/:id',
  webAuth('update_tiffin_package'),
  validate(SubscriptionTiffinPackageValidation.updateAdminStatusValidation),
  SubscriptionTiffinPackageController.updatePackageStatus
);
router.delete(
  '/delete_tiffin_package/:id',
  webAuth('delete_tiffin_package'),
  validate(SubscriptionTiffinPackageValidation.deleteValidation),
  SubscriptionTiffinPackageController.drop
);
router.post(
  '/customer_purchased_tiffin_package_list/',
  webAuth('tiffin_packages'),
  validate(UserPurchasedTiffinSubscriptionValidation.purchasedSubscriptionListAdminValidation),
  UserPurchasedTiffinSubscriptionController.getPurchaseListForAdmin
);
router.get(
  '/customer_purchased_tiffin_package_detail/:id',
  webAuth('tiffin_packages'),
  validate(UserPurchasedTiffinSubscriptionValidation.purchaseDetailValidation),
  UserPurchasedTiffinSubscriptionController.getPurchaseDetailAdmin
);
router.get(
  '/tiffin_subscription_order_list/:master',
  webAuth('order_list'),
  validate(OrdersValidation.cityzenSubscriptionOrderValidation),
  OrdersController.cityzenSubscriptionOrderList
);

router.get(
  '/order_refund_request/:master',
  webAuth('order_refund_request'),
  validate(RefundRequestValidation.cityMasterValidation),
  RefundRequestController.cityzenRefundRequest
);
router.get(
  '/order_refund_request_detail/:requestId',
  webAuth('order_refund_request'),
  validate(RefundRequestValidation.getRefundRequestInfoValidation),
  RefundRequestController.getRefundRequestInfo
);
router.post(
  '/refund_request/refundFromMerchant',
  webAuth('refund_from_merchant'),
  validate(RefundRequestValidation.refundFromMerchantValidation),
  RefundRequestController.refundFromMerchant
);
router.post(
  '/refund_request/approve',
  webAuth('approve_refund_request'),
  validate(RefundRequestValidation.approveRefundRequestValidation),
  RefundRequestController.approveRefundRequest
);
router.post(
  '/refund_request/cancel',
  webAuth('cancel_refund_request'),
  validate(RefundRequestValidation.cancelRefundRequestValidation),
  RefundRequestController.cancelRefundRequest
);

router.get(
  '/tiffin_subscription_refund_request_list/:master',
  webAuth('tiffin_subscription_refund_request'),
  validate(TiffinSubscriptionRefundRequestValidation.cityMasterValidation),
  TiffinSubscriptionRefundRequestController.cityzenRefundRequest
);
router.get(
  '/tiffin_subscription_refund_request_detail/:requestId',
  webAuth('tiffin_subscription_refund_request'),
  validate(
    TiffinSubscriptionRefundRequestValidation.getTiffinSubscriptionRefundRequestInfoValidation
  ),
  TiffinSubscriptionRefundRequestController.getTiffinSubscriptionRefundRequestInfo
);
router.post(
  '/tiffin_subscription_refund_request/refundFromMerchant',
  webAuth('refund_tiffin_subscription_from_merchant'),
  validate(TiffinSubscriptionRefundRequestValidation.refundFromMerchantValidation),
  TiffinSubscriptionRefundRequestController.refundFromMerchant
);
router.post(
  '/tiffin_subscription_refund_request/approve',
  webAuth('approve_tiffin_subscription_refund_request'),
  validate(TiffinSubscriptionRefundRequestValidation.approveRefundRequestValidation),
  TiffinSubscriptionRefundRequestController.approveRefundRequest
);
router.post(
  '/tiffin_subscription_refund_request/cancel',
  webAuth('cancel_tiffin_subscription_refund_request'),
  validate(TiffinSubscriptionRefundRequestValidation.cancelRefundRequestValidation),
  TiffinSubscriptionRefundRequestController.cancelRefundRequest
);

router.get(
  '/dining_booking_refund_request_list/:master',
  webAuth('dining_booking_refund_request'),
  validate(DiningBookingRefundRequestValidation.cityMasterValidation),
  DiningBookingRefundRequestController.cityzenRefundRequest
);
router.get(
  '/dining_booking_refund_request/info/:requestId',
  webAuth('dining_booking_refund_request'),
  validate(DiningBookingRefundRequestValidation.getRefundRequestInfoValidation),
  DiningBookingRefundRequestController.getRefundRequestInfo
);
router.post(
  '/dining_booking_refund_request/refundFromMerchant',
  webAuth('refund_dining_booking_from_merchant'),
  validate(DiningBookingRefundRequestValidation.refundFromMerchantValidation),
  DiningBookingRefundRequestController.refundFromMerchant
);
router.post(
  '/dining_booking_refund_request/approve',
  webAuth('approve_dining_booking_refund_request'),
  validate(DiningBookingRefundRequestValidation.approveRefundRequestValidation),
  DiningBookingRefundRequestController.approveRefundRequest
);
router.post(
  '/dining_booking_refund_request/cancel',
  webAuth('cancel_dining_booking_refund_request'),
  validate(DiningBookingRefundRequestValidation.cancelRefundRequestValidation),
  DiningBookingRefundRequestController.cancelRefundRequest
);

router.get(
  '/orders_complaint_list/:master',
  webAuth('orders_complaint'),
  validate(UserValidation.cityzenComplaintValidation),
  ComplaintsController.cityzenComplaints
);
router.get(
  '/restaurant_complaints_list/:master',
  webAuth('restaurant_complaint'),
  validate(UserValidation.cityzenRestaurantComplaintValidation),
  RestaurantComplaintsController.cityzenComplaints
);

router.get(
  '/dining_booking_count/:master',
  webAuth('dining_booking_list'),
  validate(AuthValidation.cityMasterValidation),
  DiningBookingController.cityzenDiningBookingCount
);
router.get(
  '/dining_booking_list/:master',
  webAuth('dining_booking_list'),
  validate(DiningBookingValidation.cityzenBookingValidation),
  DiningBookingController.cityzenDiningBookingList
);
router.get(
  '/dining_booking_detail/:bookingId',
  webAuth('dining_booking_detail'),
  validate(DiningBookingValidation.bookingInformationAdminValidation),
  DiningBookingController.getDiningBookingInfoAdmin
);

router.get(
  '/restaurant_campaign_list/:master',
  webAuth('restaurant_campaign'),
  validate(RestaurantCampaignValidation.cityMasterValidation),
  RestaurantCampaignController.cityzenCampaignList
);
router.patch(
  '/update_restaurant_campaign_status/:campaignId',
  webAuth('update_restaurant_campaign'),
  validate(RestaurantCampaignValidation.idValidation),
  RestaurantCampaignController.updateStatus
);
router.get(
  '/restaurant_campaign_request_list/:campaignId',
  webAuth('restaurant_campaign_request'),
  validate(RestaurantCampaignRequestValidation.idValidation),
  RestaurantCampaignRequestController.get
);
router.get(
  '/accept_restaurant_campaign_request/:campaignId/:restaurantId',
  webAuth('accept_restaurant_campaign_request'),
  validate(RestaurantCampaignValidation.leaveAndJoinCampaignValidation),
  RestaurantCampaignController.joinCampaign
);
router.delete(
  '/reject_restaurant_campaign_request/:campaignId',
  webAuth('reject_restaurant_campaign_request'),
  validate(RestaurantCampaignRequestValidation.idValidation),
  RestaurantCampaignRequestController.drop
);
router.get(
  '/restaurant_campaign_detail/:id',
  webAuth('restaurant_campaign'),
  validate(RestaurantCampaignValidation.detailValidation),
  RestaurantCampaignController.detail
);
router.post(
  '/create_restaurant_campaign/:master',
  webAuth('create_restaurant_campaign'),
  validate(RestaurantCampaignValidation.cityzenCreateRestaurantCampaign),
  RestaurantCampaignController.cityzenCreateCampaign
);
router.get(
  '/restaurant_campaign_deep_detail/:campaignId',
  webAuth('restaurant_campaign'),
  validate(RestaurantCampaignValidation.idValidation),
  RestaurantCampaignController.cityzenCampaignById
);
router.patch(
  '/update_restaurant_campaign/:campaignId',
  webAuth('update_restaurant_campaign'),
  validate(RestaurantCampaignValidation.idValidation),
  RestaurantCampaignController.update
);
router.delete(
  '/delete_restaurant_campaign/:campaignId',
  webAuth('delete_restaurant_campaign'),
  validate(RestaurantCampaignValidation.idValidation),
  RestaurantCampaignController.drop
);

router.get(
  '/dining_campaign_list/:master',
  webAuth('dining_campaign'),
  validate(DiningCampaignValidation.cityMasterValidation),
  DiningCampaignController.cityzenCampaignList
);
router.patch(
  '/update_dining_campaign_status/:campaignId',
  webAuth('update_dining_campaign'),
  validate(DiningCampaignValidation.idValidation),
  DiningCampaignController.updateStatus
);

router.get(
  '/dining_campaign_request_list/:campaignId',
  webAuth('dining_campaign_request'),
  validate(DiningCampaignRequestValidation.idValidation),
  DiningCampaignRequestController.get
);
router.get(
  '/accept_dining_campaign_request/:campaignId/:restaurantId',
  webAuth('accept_dining_campaign_request'),
  validate(DiningCampaignValidation.leaveAndJoinCampaignValidation),
  DiningCampaignController.joinCampaign
);
router.delete(
  '/reject_dining_campaign_request/:campaignId',
  webAuth('reject_dining_campaign_request'),
  validate(DiningCampaignRequestValidation.idValidation),
  DiningCampaignRequestController.drop
);
router.get(
  '/dining_campaign_detail/:id',
  webAuth('dining_campaign'),
  validate(DiningCampaignValidation.detailValidation),
  DiningCampaignController.detail
);

router.post(
  '/create_dining_campaign/:master',
  webAuth('create_dining_campaign'),
  validate(DiningCampaignValidation.cityzenCreateDiningCampaignValidation),
  DiningCampaignController.cityzenCreateCampaign
);
router.get(
  '/dining_campaign_deep_detail/:campaignId',
  webAuth('dining_campaign'),
  validate(DiningCampaignValidation.idValidation),
  DiningCampaignController.cityzenDeepDetail
);
router.patch(
  '/update_dining_campaign/:campaignId',
  webAuth('update_dining_campaign'),
  validate(DiningCampaignValidation.idValidation),
  DiningCampaignController.update
);
router.delete(
  '/delete_dining_campaign/:campaignId',
  webAuth('delete_dining_campaign'),
  validate(DiningCampaignValidation.idValidation),
  DiningCampaignController.drop
);

router.get(
  '/food_campaign_list/:master',
  webAuth('food_campaign'),
  validate(FoodCampaignValidation.cityMasterValidation),
  FoodCampaignController.cityzenCampaignList
);
router.patch(
  '/update_food_campaign_status/:campaignId',
  webAuth('update_food_campaign'),
  validate(FoodCampaignValidation.idValidation),
  FoodCampaignController.updateStatus
);
router.get(
  '/food_campaign_detail/:id',
  webAuth('food_campaign'),
  validate(FoodCampaignValidation.detailValidation),
  FoodCampaignController.detail
);

router.get(
  '/food_campaign_request_list/:campaignId',
  webAuth('food_campaign_request'),
  validate(FoodCampaignRequestValidation.idValidation),
  FoodCampaignRequestController.get
);
router.get(
  '/accept_food_campaign_request/:campaignId/:foodId',
  webAuth('accept_food_campaign_request'),
  validate(FoodCampaignValidation.leaveAndJoinCampaignIdValidation),
  FoodCampaignController.joinCampaign
);
router.delete(
  '/reject_food_campaign_request/:campaignId',
  webAuth('reject_food_campaign_request'),
  validate(FoodCampaignRequestValidation.idValidation),
  FoodCampaignRequestController.drop
);
router.get(
  '/food_list_for_campaign/:restaurantId',
  webAuth('food_list_for_campaign'),
  validate(FoodCampaignValidation.restaurantIdValidation),
  FoodCampaignController.getFoodByRestaurantId
);
router.post(
  '/create_food_campaign/:master',
  webAuth('create_food_campaign'),
  validate(FoodCampaignValidation.cityzenCreateFoodCampaign),
  FoodCampaignController.cityzenCreateCampaign
);
router.get(
  '/food_campaign_deep_detail/:campaignId',
  webAuth('food_campaign'),
  validate(FoodCampaignValidation.idValidation),
  FoodCampaignController.cityzenDeepDetail
);
router.patch(
  '/update_food_campaign/:campaignId',
  webAuth('update_food_campaign'),
  validate(FoodCampaignValidation.idValidation),
  FoodCampaignController.update
);
router.delete(
  '/delete_food_campaign/:campaignId',
  webAuth('delete_food_campaign'),
  validate(FoodCampaignValidation.idValidation),
  FoodCampaignController.drop
);

router.get(
  '/media_files_list/:master',
  webAuth('media_files_list'),
  validate(AuthValidation.cityMasterValidation),
  MediaController.cityzenMediaFiles
);
router.delete(
  '/delete_media_files/:path',
  webAuth('delete_media_files'),
  validate(FileValidation.pathValidation),
  MediaController.drop
);

router.get(
  '/banners_list/:master',
  webAuth('banners_list'),
  validate(BannersValidation.cityMasterValidation),
  BannersController.cityzenBannerList
);
router.patch(
  '/update_banner_status/:bannerId',
  webAuth('update_banner'),
  validate(BannersValidation.idValidation),
  BannersController.updateStatus
);

router.get(
  '/food_list_from_city/:master',
  webAuth('food_list_from_city'),
  validate(AuthValidation.cityMasterValidation),
  FoodController.cityzenFoodListForBanner
);
router.post(
  '/create_banner/:master',
  webAuth('create_banner'),
  validate(BannersValidation.cityzenCreateBanner),
  BannersController.cityzenCreateBanner
);
router.patch(
  '/update_banner/:bannerId/:master',
  webAuth('update_banner'),
  validate(BannersValidation.cityzenUpdateValidation),
  BannersController.cityzenUpdate
);
router.delete(
  '/delete_banner/:bannerId',
  webAuth('delete_banner'),
  validate(BannersValidation.idValidation),
  BannersController.drop
);

router.get(
  '/coupon_list/:master',
  webAuth('coupon_list'),
  validate(CouponValidation.cityMasterValidation),
  CouponController.cityzenCouponList
);
router.patch(
  '/update_meta_coupon/:id',
  webAuth('update_coupon'),
  validate(CouponValidation.idValidation),
  CouponController.updateMeta
);
router.get(
  '/coupon_detail/:id',
  webAuth('coupon_list'),
  validate(CouponValidation.detailValidation),
  CouponController.couponDetail
);
router.get(
  '/redeem_order_list/:id',
  webAuth('redeem_order_list'),
  validate(OrdersValidation.couponValidation),
  OrdersController.couponOrders
);

router.get(
  '/search_customer/:name',
  webAuth('search_customer'),
  validate(UserValidation.searchUser),
  UserController.findUserWithName
);
router.post(
  '/create_coupon/:master',
  webAuth('create_coupon'),
  validate(CouponValidation.cityzenCreateCoupon),
  CouponController.cityzenCreateCoupon
);
router.get(
  '/coupon_deep_detail/:id',
  webAuth('coupon_list'),
  validate(CouponValidation.idValidation),
  CouponController.cityzenCouponDetail
);
router.patch(
  '/update_coupon/:id',
  webAuth('update_coupon'),
  validate(CouponValidation.idValidation),
  CouponController.cityzenUpdateCoupon
);
router.delete(
  '/delete_coupon/:id',
  webAuth('delete_coupon'),
  validate(CouponValidation.idValidation),
  CouponController.drop
);

router.get(
  '/new_coupon_request/:master',
  webAuth('new_coupon_request'),
  validate(CouponValidation.cityMasterValidation),
  CouponController.cityzenCouponRequest
);

router.get(
  '/dining_coupon_list/:master',
  webAuth('dining_coupon_list'),
  validate(DiningCouponValidation.cityMasterValidation),
  DiningCouponController.cityzenCouponList
);
router.patch(
  '/update_dining_coupon_meta/:id',
  webAuth('update_dining_coupon'),
  validate(DiningCouponValidation.idValidation),
  DiningCouponController.updateMeta
);
router.get(
  '/dining_coupon_detail/:id',
  webAuth('dining_coupon_list'),
  validate(DiningCouponValidation.detailValidation),
  DiningCouponController.couponDetail
);
router.get(
  '/coupon_dining_booking/:id',
  webAuth('dining_booking_list'),
  validate(DiningBookingValidation.couponValidation),
  DiningBookingController.couponBooking
);
router.post(
  '/create_dining_coupon/:master',
  webAuth('create_dining_coupon'),
  validate(DiningCouponValidation.cityzenCreateCoupon),
  DiningCouponController.cityzenCreateCoupon
);
router.get(
  '/dining_coupon_deep_detail/:id',
  webAuth('dining_coupon_list'),
  validate(DiningCouponValidation.idValidation),
  DiningCouponController.cityzenDeepDetail
);
router.patch(
  '/update_dining_coupon/:id',
  webAuth('update_dining_coupon'),
  validate(DiningCouponValidation.idValidation),
  DiningCouponController.cityzenUpdateCoupon
);
router.delete(
  '/delete_dining_coupon/:id',
  webAuth('delete_dining_coupon'),
  validate(DiningCouponValidation.idValidation),
  DiningCouponController.drop
);
router.get(
  '/new_dining_coupon_request/:master',
  webAuth('new_dining_coupon_request'),
  validate(DiningCouponValidation.cityMasterValidation),
  DiningCouponController.cityzenCouponRequest
);

router.get(
  '/cash_collection_list/:master',
  webAuth('cash_collection'),
  validate(CollectCashValidation.cityzenCollectCashListValidation),
  CollectCashController.cityzenCollectionList
);

router.get(
  '/deliveryman_with_city/:master',
  webAuth('deliveryman_with_city'),
  validate(AuthValidation.cityMasterValidation),
  DriverController.cityzenDeliverymanList
);
router.get(
  '/restaurant_cash_in_hand/:vendor',
  webAuth('restaurant_cash_in_hand'),
  validate(RestaurantValidation.vendorCashInHandValidation),
  RestaurantController.getRestaurantCashInHand
);
router.get(
  '/deliveryman_cash_in_hand/:deliveryman',
  webAuth('deliveryman_cash_in_hand'),
  validate(DriverValidation.deliverymanCashInHandValidation),
  DriverController.getDeliverymanCashInHand
);
router.post(
  '/restaurant_clear_cash_in_hand',
  webAuth('restaurant_clear_cash_in_hand'),
  validate(RestaurantValidation.collectCashValidation),
  RestaurantController.clearCashInHandAndUpdateWallet
);
router.post(
  '/deliveryman_clear_cash_in_hand',
  webAuth('deliveryman_clear_cash_in_hand'),
  validate(DriverValidation.collectCashValidation),
  DriverController.clearCashInHand
);
router.get(
  '/restaurant_withdrawal_request/:master',
  webAuth('restaurant_withdrawal_request'),
  validate(WithdrawalRequestValidation.cityMasterValidation),
  WithdrawalRequestController.cityzenRestaurantWithdrawal
);
router.get(
  '/deliveryman_withdrawal_request/:master',
  webAuth('deliveryman_withdrawal_request'),
  validate(WithdrawalRequestValidation.cityMasterValidation),
  WithdrawalRequestController.cityzenDeliverymanWithdrawalRequest
);
router.get(
  '/withdrawal_request_detail/:id',
  webAuth('withdrawal_request_detail'),
  validate(WithdrawalRequestValidation.idValidation),
  WithdrawalRequestController.withdrawalRequestDetail
);
router.post(
  '/approve_withdrawal_request',
  webAuth('approve_withdrawal_request'),
  validate(WithdrawalRequestValidation.approveWithdrawalRequestValidation),
  WithdrawalRequestController.approveWithdrawalRequest
);
router.post(
  '/decline_withdrawal_request',
  webAuth('decline_withdrawal_request'),
  validate(WithdrawalRequestValidation.declineWithdrawalRequestValidation),
  WithdrawalRequestController.declineWithdrawalRequest
);

router.get(
  '/restaurant_disbursement_list/:master',
  webAuth('restaurant_disbursement'),
  validate(DisbursementValidation.cityMasterValidation),
  DisbursementController.cityzenRestaurantDisbursement
);
router.get(
  '/restaurant_disbursement_detail/:id',
  webAuth('restaurant_disbursement'),
  validate(DisbursementValidation.disbursementReportValidation),
  DisbursementController.restaurantDisbursementDetail
);
router.get(
  '/accept_restaurant_disbursement/:id',
  webAuth('accept_restaurant_disbursement'),
  validate(DisbursementValidation.disbursementReportValidation),
  DisbursementController.acceptRestaurantDisburment
);
router.get(
  '/decline_restaurant_disbursement/:id',
  webAuth('decline_restaurant_disbursement'),
  validate(DisbursementValidation.disbursementReportValidation),
  DisbursementController.rejectRestaurantDisburment
);

router.get(
  '/deliveryman_disbursement_list/:master',
  webAuth('deliveryman_disbursement_list'),
  validate(DisbursementValidation.cityMasterValidation),
  DisbursementController.cityzenDeliverymanDisbursement
);
router.get(
  '/deliveryman_disbursement_detail/:id',
  webAuth('deliveryman_disbursement_detail'),
  validate(DisbursementValidation.disbursementReportValidation),
  DisbursementController.deliverymanDisbursementDetail
);
router.get(
  '/accept_deliveryman_disbursement/:id',
  webAuth('accept_deliveryman_disbursement'),
  validate(DisbursementValidation.disbursementReportValidation),
  DisbursementController.acceptDeliverymanDisbursment
);
router.get(
  '/decline_deliveryman_disbursement/:id',
  webAuth('decline_deliveryman_disbursement'),
  validate(DisbursementValidation.disbursementReportValidation),
  DisbursementController.rejectDeliverymanDisbursment
);

router.get(
  '/restaurant_detail_info/:id',
  webAuth('restaurant_detail'),
  validate(RestaurantValidation.vendorInformationValidation),
  RestaurantController.vendorInformation
);
router.get(
  '/restaurant_detail_order_list',
  webAuth('restaurant_detail'),
  OrdersController.vendorOrderList
);
router.get(
  '/restaurant_detail_pos_order_list',
  webAuth('restaurant_detail'),
  PosOrTableOrderController.vendorPosOrderList
);
router.get(
  '/restaurant_detail_table_order_list',
  webAuth('restaurant_detail'),
  TableOrderController.vendorTableOrderList
);
router.get(
  '/restaurant_detail_booking_list',
  webAuth('restaurant_detail'),
  DiningBookingController.vendorBookingList
);
router.get(
  '/restaurant_detail_food_list',
  webAuth('restaurant_detail'),
  FoodController.vendorFoodList
);
router.get(
  '/restaurant_detail_waiter_list',
  webAuth('restaurant_detail'),
  WaiterController.vendorWaiterList
);
router.get(
  '/restaurant_detail_deliveryman_list',
  webAuth('restaurant_detail'),
  DriverController.vendorDeliverymanList
);
router.get(
  '/restaurant_detail_tiffin_packages_list',
  webAuth('restaurant_detail'),
  SubscriptionTiffinPackageController.vendorTiffinPackageList
);
router.get(
  '/restaurant_detail_all_refund_request',
  webAuth('restaurant_detail'),
  OrdersController.vendorAllRefundRequest
);
router.get(
  '/restaurant_detail_order_refund_request',
  webAuth('restaurant_detail'),
  OrdersController.vendorOrderRefundRequest
);
router.get(
  '/restaurant_detail_tiffin_subscription_refund_request',
  webAuth('restaurant_detail'),
  OrdersController.vendorTiffinRefundRequest
);
router.get(
  '/restaurant_detail_dining_refund_request',
  webAuth('restaurant_detail'),
  OrdersController.vendorDiningRefundRequest
);
router.get(
  '/restaurant_detail_complaint_list',
  webAuth('restaurant_detail'),
  ComplaintsController.vendorComplaintList
);
router.get(
  '/restaurant_detail_order_complaint_list',
  webAuth('restaurant_detail'),
  ComplaintsController.vendorUserOrderComplaintList
);
router.get(
  '/restaurant_detail_own_complaint_list',
  webAuth('restaurant_detail'),
  ComplaintsController.vendorOwnOrderComplaintList
);
router.get(
  '/restaurant_detail_outlet_list',
  webAuth('restaurant_detail'),
  RestaurantController.vendorOutletList
);
router.get(
  '/restaurant_detail_disbursement_list',
  webAuth('restaurant_detail'),
  DisbursementController.vendorDisbursementList
);
router.get(
  '/restaurant_detail_collected_cash_list',
  webAuth('restaurant_detail'),
  CollectCashController.vendorCollectedCashList
);
router.get(
  '/restaurant_detail_payout_accounts',
  webAuth('restaurant_detail'),
  RestaurantPayoutMethodController.vendorPayoutAccounts
);
router.get(
  '/restaurant_detail_withdrawal_request_list',
  webAuth('restaurant_detail'),
  WithdrawalRequestController.vendorWithdrawalRequest
);
router.get(
  '/restaurant_detail_wallet_transactions',
  webAuth('restaurant_detail'),
  WalletController.vendorTransactionList
);
router.get(
  '/restaurant_detail_all_reviews',
  webAuth('restaurant_detail'),
  ReviewRatingController.vendorAllReviews
);
router.get(
  '/restaurant_detail_vendor_food_reviews',
  webAuth('restaurant_detail'),
  ReviewRatingController.vendorFoodReviews
);
router.get(
  '/restaurant_detail_own_reviews',
  webAuth('restaurant_detail'),
  ReviewRatingController.vendorReviews
);
router.get(
  '/restaurant_detail_media_files',
  webAuth('restaurant_detail'),
  MediaController.vendorMediaFiles
);
router.get(
  '/vendor_detail/kitchen_owner_list',
  webAuth('restaurant_detail'),
  KitchenOwnerController.vendorKitchenOwnerList
);

router.get(
  '/deliveryman_detail_info/:id',
  webAuth('deliveryman_detail'),
  validate(DriverValidation.deliverymanInformationValidation),
  DriverController.deliverymanInformation
);
router.get(
  '/deliveryman_detail_order_list',
  webAuth('deliveryman_detail'),
  OrdersController.deliverymanOrderList
);
router.get(
  '/deliveryman_detail_complaints',
  webAuth('deliveryman_detail'),
  ComplaintsController.deliverymanComplaintList
);
router.get(
  '/deliveryman_detail_complaint_vendor',
  webAuth('deliveryman_detail'),
  ComplaintsController.deliverymanRestaurantComplaintList
);
router.get(
  '/deliveryman_detail_complaint_orders',
  webAuth('deliveryman_detail'),
  ComplaintsController.deliverymanUserOrderComplaintList
);
router.get(
  '/deliveryman_detail_disbursement_list',
  webAuth('deliveryman_detail'),
  DisbursementController.deliverymanDisbursementList
);
router.get(
  '/deliveryman_detail_collected_cash_list',
  webAuth('deliveryman_detail'),
  CollectCashController.deliverymanCollectedCashList
);
router.get(
  '/deliveryman_detail_payout_accounts',
  webAuth('deliveryman_detail'),
  DeliverymanPayoutMethodController.deliverymanPayoutAccounts
);
router.get(
  '/deliveryman_detail_withdrawal_request_list',
  webAuth('deliveryman_detail'),
  WithdrawalRequestController.deliverymanWithdrawalRequest
);
router.get(
  '/deliveryman_detail_wallet_transactions',
  webAuth('deliveryman_detail'),
  WalletController.deliverymanTransactionList
);
router.get(
  '/deliveryman_detail_reviews',
  webAuth('deliveryman_detail'),
  ReviewRatingController.deliverymanReviews
);
router.get(
  '/deliveryman_detail_media_files',
  webAuth('deliveryman_detail'),
  MediaController.deliverymanMediaFiles
);

router.get(
  '/customer_detail_info/:user',
  webAuth('customer_detail'),
  validate(UserValidation.idValidation),
  UserController.customerDetail
);
router.get(
  '/customer_detail_order_list',
  webAuth('customer_detail'),
  OrdersController.customerOrderList
);
router.get(
  '/customer_detail_dining_booking_list',
  webAuth('customer_detail'),
  DiningBookingController.customerDiningBooking
);
router.get(
  '/customer_detail_purchased_tiffin_packages',
  webAuth('customer_detail'),
  UserPurchasedTiffinSubscriptionController.customerPurchasedPackages
);
router.get(
  '/customer_detail_delivery_address_list',
  webAuth('customer_detail'),
  UserAddressController.customerAddressList
);
router.get(
  '/customer_detail_refund_request_list',
  webAuth('customer_detail'),
  OrdersController.customerAllRefundRequest
);
router.get(
  '/customer_detail_order_refund_request',
  webAuth('customer_detail'),
  OrdersController.customerOrderRefundList
);
router.get(
  '/customer_detail_tiffin_refund_request',
  webAuth('customer_detail'),
  OrdersController.customerTiffinRefundList
);
router.get(
  '/customer_detail_dining_refund_request',
  webAuth('customer_detail'),
  OrdersController.customerBookingRefundList
);
router.get(
  '/customer_detail_order_complaint_list',
  webAuth('customer_detail'),
  ComplaintsController.customerComplaintList
);
router.get(
  '/customer_detail_favourite_list',
  webAuth('customer_detail'),
  FavouriteController.customerAllFavourite
);
router.get(
  '/customer_detail_favourite_orders',
  webAuth('customer_detail'),
  FavouriteController.customerFavouriteOrders
);
router.get(
  '/customer_detail_favourite_restaurants',
  webAuth('customer_detail'),
  FavouriteController.customerFavouriteRestaurant
);
router.get(
  '/customer_detail_favourite_foods',
  webAuth('customer_detail'),
  FavouriteController.customerFavouriteFood
);
router.get(
  '/customer_detail_hidden_restaurants',
  webAuth('customer_detail'),
  HideRestaurantController.customerHiddenRestaurants
);
router.get(
  '/customer_detail_wallet_transactions',
  webAuth('customer_detail'),
  WalletController.customerTransactionList
);
router.get(
  '/customer_detail_all_reviews',
  webAuth('customer_detail'),
  ReviewRatingController.customerAllReviews
);
router.get(
  '/customer_detail_food_reviews',
  webAuth('customer_detail'),
  ReviewRatingController.customerFoodReview
);
router.get(
  '/customer_detail_restaurant_reviews',
  webAuth('customer_detail'),
  ReviewRatingController.customerRestaurantReview
);
router.get(
  '/customer_detail_deliveryman_reviews',
  webAuth('customer_detail'),
  ReviewRatingController.customerDeliverymanReview
);
router.get(
  '/customer_detail_media_files',
  webAuth('customer_detail'),
  MediaController.customerMediaFiles
);

router.post(
  '/send_notification/:id',
  webAuth('send_notification'),
  validate(UserValidation.cityzenSendNotificationValidation),
  FcmController.cityzenSendNotificaiton
);

router.get(
  '/cityzen_profile/:id',
  webAuth('cityzen_profile'),
  validate(UserValidation.cityzenProfileValidation),
  UserController.getCityzenProfile
);
router.patch(
  '/update_cityzen/:id',
  webAuth('update_cityzen'),
  validate(UserValidation.updateCityzenProfileValidation),
  UserController.updateCityzenProfile
);
router.patch(
  '/update_cityzen_password/:id',
  webAuth('update_cityzen_password'),
  validate(UserValidation.updateCityzenPasswordValidation),
  UserController.updateCityzenPassword
);

router.get(
  '/cityzen_team_header_content/:id',
  webAuth('cityzen_team_header_content'),
  validate(UserValidation.cityzenTeamHeaderValidation),
  NotificationListController.cityzenHeaderContent
);

router.get(
  '/notification_list/:id',
  webAuth('notification_list'),
  validate(UserValidation.cityzenNotificationValidation),
  NotificationListController.cityzenNotificationList
);

router.get(
  '/regular_chat_list/:id',
  webAuth('regular_chat_list'),
  validate(UserValidation.cityzenChatListValidation),
  ChatRoomController.cityzenChatList
);
router.get(
  '/support_chat_list/:id',
  webAuth('support_chat_list'),
  validate(UserValidation.cityzenChatListValidation),
  SupportChatRoomController.cityzenSupportChatList
);

router.get(
  '/regular_chat_messages/:id',
  webAuth('regular_chat_messages'),
  validate(ChatRoomValidation.cityzenChatMessagesValidation),
  ChatRoomController.cityzenGetChatMessages
);
router.get(
  '/support_chat_messages/:id',
  webAuth('support_chat_messages'),
  validate(ChatRoomValidation.cityzenChatMessagesValidation),
  SupportChatRoomController.cityzenChatMessages
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

// Cityzen User Contact Detail Routes //
router.get(
  '/user_contact_detail/:id',
  webAuth('user_contact_detail'),
  validate(UserValidation.adminUserContactDetailValidation),
  UserController.adminUserContactDetail
);
// Cityzen User Contact Detail Routes //

/// Chat Messages Routes //
router.post(
  '/chat_room/fetch_messages/',
  webAuth('regular_chat_messages'),
  validate(ChatRoomValidation.checkChatRoomValidation),
  ChatRoomController.checkChatRoom
);
/// Chat Messages Routes //

module.exports = router;

