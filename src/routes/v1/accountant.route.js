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
const AdminExpenseValidation = require('../../validations/admin.expense.validation');
const RestaurantValidation = require('../../validations/restaurant.validation');
const DisbursementValidation = require('../../validations/disbursement.validation');
const CollectCashValidation = require('../../validations/collect.cash.validation');
const DriverValidation = require('../../validations/driver.validation');
const WithdrawalMethodValidation = require('../../validations/withdrawal.method.validation');
const WithdrawalRequestValidation = require('../../validations/withdrawal.request.validation');
const OrdersValidation = require('../../validations/orders.validation');
const PosOrTableOrderValidation = require('../../validations/pos.or.table.order.validation');
const TableOrderValidation = require('../../validations/table.order.validation');
const UserPurchasedTiffinSubscriptionValidation = require('../../validations/user.purchased.tiffin.subscriptions.validation');
const DiningBookingValidation = require('../../validations/dining.booking.validation');
const WalletValidation = require('../../validations/wallet.validation');
const PaymentConfigValidation = require('../../validations/payment.config.validation');
const FoodValidation = require('../../validations/food.validation');
const ChatRoomValidation = require('../../validations/chat.room.validation');

const UserController = require('../../controllers/user.controller');
const OrdersController = require('../../controllers/orders.controller');
const AdminExpenseController = require('../../controllers/admin.expense.controller');
const CityController = require('../../controllers/city.controller');
const RestaurantController = require('../../controllers/restaurant.controller');
const PosOrTableOrderController = require('../../controllers/pos.or.table.order.controller');
const TableOrderController = require('../../controllers/table.order.controller');
const WalletController = require('../../controllers/wallet.controller');
const PaymentInitiationController = require('../../controllers/payment.initiation.controller');
const DiningBookingController = require('../../controllers/dining.booking.controller');
const FoodController = require('../../controllers/food.controller');
const DriverController = require('../../controllers/driver.controller');
const DisbursementController = require('../../controllers/disbursement.controller');
const CollectCashController = require('../../controllers/collect.cash.controller');
const WithdrawalMethodController = require('../../controllers/withdrawal.method.controller');
const MediaController = require('../../controllers/media.controller');
const WithdrawalRequestController = require('../../controllers/withdrawal.request.controller');
const UserPurchasedTiffinSubscriptionController = require('../../controllers/user.purchased.tiffin.subscription.controller');
const NotificationListController = require('../../controllers/notification.list.controller');
const ChatRoomController = require('../../controllers/chat.room.controller');

const router = express.Router();

router.get(
  '/web_guard/:id',
  webAuth('web_guard'),
  validate(UserValidation.webGuardValidation),
  UserController.accountantProfile
);

router.get('/dashboard', webAuth('dashboard'), OrdersController.accountantDashboard);
router.get(
  '/expense_initial',
  webAuth('expense_report'),
  AdminExpenseController.getInitialResponse
);
router.get('/expense', webAuth('expense_report'), AdminExpenseController.getExpenseList);
router.post(
  '/save_expense',
  webAuth('expense_report'),
  validate(AdminExpenseValidation.saveExpenseValidation),
  AdminExpenseController.create
);

router.get('/city_list', webAuth('city_list'), CityController.getAll);
router.get(
  '/regular_order_report',
  webAuth('order_report'),
  validate(OrdersValidation.orderReportValidation),
  OrdersController.orderReports
);
router.get(
  '/restaurant_with_city/:cityId',
  webAuth('restaurant_list'),
  validate(RestaurantValidation.restaurantByCityIdLimitedDetailsValidation),
  RestaurantController.getRestaurantsByCityIdLimitedDetailsForAdmin
);
router.get(
  '/pos_order_report',
  webAuth('order_report'),
  validate(OrdersValidation.orderReportValidation),
  PosOrTableOrderController.posOrderReport
);
router.get(
  '/table_order_report',
  webAuth('order_report'),
  validate(OrdersValidation.orderReportValidation),
  TableOrderController.tableOrderReport
);
router.get(
  '/wallet_transaction_report/',
  webAuth('wallet_report'),
  WalletController.getTransactionReport
);
router.get(
  '/payment_transaction_report/',
  webAuth('payment_report'),
  PaymentInitiationController.getPaymentInitiateReport
);
router.get(
  '/dining_booking_report',
  webAuth('order_report'),
  DiningBookingController.diningBookingReport
);
router.get('/food_report/', webAuth('food_report'), FoodController.foodReport);
router.get(
  '/restaurant_report_initial',
  webAuth('restaurant_report'),
  RestaurantController.restauratReportInitialFilter
);
router.get(
  '/restaurant_report',
  webAuth('restaurant_report'),
  RestaurantController.restaurantReport
);
router.get('/customer_report', webAuth('customer_report'), UserController.customerReport);
router.get(
  '/deliveryman_report',
  webAuth('deliveryman_report'),
  DriverController.deliverymanReport
);

router.get(
  '/restaurant_initial_disbursement',
  webAuth('disbursement_report'),
  DisbursementController.disbursementTransactionInitial
);
router.get(
  '/restaurant_disbursement',
  webAuth('disbursement_report'),
  DisbursementController.restaurantDisbursementTransactionReport
);
router.get(
  '/restaurant_disbursement_detail/:id',
  webAuth('disbursement_report'),
  validate(DisbursementValidation.disbursementReportValidation),
  DisbursementController.restaurantDisbursementDetail
);
router.get(
  '/accept_restaurant_disbursement/:id',
  webAuth('disbursement_report'),
  validate(DisbursementValidation.disbursementReportValidation),
  DisbursementController.acceptRestaurantDisburment
);
router.get(
  '/deliveryman_initial_disbursement',
  webAuth('disbursement_report'),
  DisbursementController.deliverymanDisbursementTransactionInitial
);
router.get(
  '/deliveryman_disbursement',
  webAuth('disbursement_report'),
  DisbursementController.deliverymanDisbursementTransactionReport
);
router.get(
  '/deliveryman_disbursement_detail/:id',
  webAuth('disbursement_report'),
  validate(DisbursementValidation.disbursementReportValidation),
  DisbursementController.deliverymanDisbursementDetail
);
router.get(
  '/accept_deliveryman_disbursement/:id',
  webAuth('disbursement_report'),
  validate(DisbursementValidation.disbursementReportValidation),
  DisbursementController.acceptDeliverymanDisbursment
);
router.get(
  '/reject_restaurant_disbursement/:id',
  webAuth('disbursement_report'),
  validate(DisbursementValidation.disbursementReportValidation),
  DisbursementController.rejectRestaurantDisburment
);

router.get(
  '/collect_cash_list',
  webAuth('collect_cash'),
  validate(CollectCashValidation.collectCashListValidation),
  CollectCashController.get
);
router.get(
  '/deliveryman_with_city/:city',
  webAuth('deliveryman_list'),
  validate(DriverValidation.driverByCityValidation),
  DriverController.getDeliverymanFromCity
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
  webAuth('restaurant_cash_in_hand'),
  validate(RestaurantValidation.collectCashValidation),
  RestaurantController.clearCashInHandAndUpdateWallet
);
router.post(
  '/deliveryman_clear_cash_in_hand',
  webAuth('deliveryman_cash_in_hand'),
  validate(DriverValidation.collectCashValidation),
  DriverController.clearCashInHand
);

router.get(
  '/withdrawal_method_list',
  webAuth('withdrawal_method'),
  WithdrawalMethodController.methodList
);
router.delete(
  '/delete_withdrawal_method/:methodId',
  webAuth('delete_withdrawal_method'),
  validate(WithdrawalMethodValidation.idValidation),
  WithdrawalMethodController.drop
);
router.patch(
  '/update_withdrawal_method/:methodId',
  webAuth('update_withdrawal_method'),
  validate(WithdrawalMethodValidation.idValidation),
  WithdrawalMethodController.update
);
router.patch(
  '/update_default_withdrawal_method/:methodId',
  webAuth('update_withdrawal_method'),
  validate(WithdrawalMethodValidation.idValidation),
  WithdrawalMethodController.updateDefault
);
router.get(
  '/withdrawal_method_detail/:methodId',
  webAuth('withdrawal_method'),
  validate(WithdrawalMethodValidation.idValidation),
  WithdrawalMethodController.withdrawalMethodDetail
);
router.post(
  '/create_withdrawal_method',
  webAuth('create_withdrawal_method'),
  validate(WithdrawalMethodValidation.createWithdrawalMethodValidation),
  WithdrawalMethodController.create
);

router.get('/media_list', webAuth('media_list'), MediaController.get);

router.get(
  '/restaurant_withdrawal_request',
  webAuth('restaurant_withdrawal_request'),
  validate(WithdrawalRequestValidation.allValidation),
  WithdrawalRequestController.getRestaurantWithdrawalRequest
);
router.get(
  '/deliveryman_withdrawal_request',
  webAuth('deliveryman_withdrawal_request'),
  WithdrawalRequestController.getDeliverymanWithdrawalRequest
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
  '/restaurant_disbursement_list',
  webAuth('disbursement_report'),
  DisbursementController.restaurantDisbursement
);
router.get(
  '/restaurant_disbursement_report/:id',
  webAuth('disbursement_report'),
  validate(DisbursementValidation.disbursementReportValidation),
  DisbursementController.restaurantDisbursementReport
);
router.get(
  '/deliveryman_disbursement_list',
  webAuth('disbursement_report'),
  DisbursementController.deliverymanDisbursement
);
router.get(
  '/deliveryman_disbursement_report/:id',
  webAuth('disbursement_report'),
  validate(DisbursementValidation.disbursementReportValidation),
  DisbursementController.deliverymanDisbursementReport
);
router.get(
  '/reject_deliveryman_disbursement/:id',
  webAuth('disbursement_report'),
  validate(DisbursementValidation.disbursementReportValidation),
  DisbursementController.rejectDeliverymanDisbursment
);

router.get(
  '/regular_order_detail/:id',
  webAuth('order_detail'),
  validate(OrdersValidation.orderDetailAdminValidation),
  OrdersController.getOrderDetailAdmin
);
router.get(
  '/pos_order_detail/:id',
  webAuth('order_detail'),
  validate(PosOrTableOrderValidation.adminPosOrderDetailValidation),
  PosOrTableOrderController.adminPosOrderDetail
);
router.get(
  '/table_order_detail/:id',
  webAuth('order_detail'),
  validate(TableOrderValidation.adminTableOrderDetailValidation),
  TableOrderController.adminTableOrderDetail
);
router.get(
  '/tiffin_packages_purchase_detail/:id',
  webAuth('order_detail'),
  validate(UserPurchasedTiffinSubscriptionValidation.purchaseDetailValidation),
  UserPurchasedTiffinSubscriptionController.getPurchaseDetailAdmin
);
router.get(
  '/dining_booking_detail/:bookingId',
  webAuth('order_detail'),
  validate(DiningBookingValidation.bookingInformationAdminValidation),
  DiningBookingController.getDiningBookingInfoAdmin
);

router.get(
  '/customer_detail/:user',
  webAuth('customer_detail'),
  validate(UserValidation.idValidation),
  UserController.customerDetail
);
router.get(
  '/deliveryman_detail/:id',
  webAuth('deliveryman_detail'),
  validate(DriverValidation.deliverymanInformationValidation),
  DriverController.deliverymanInformation
);
router.get(
  '/restaurant_detail/:id',
  webAuth('restaurant_detail'),
  validate(RestaurantValidation.vendorInformationValidation),
  RestaurantController.vendorInformation
);
router.get(
  '/accountant_header_content',
  webAuth('accountant_header_content'),
  NotificationListController.accountantHeaderContent
);
router.get(
  '/accountant_profile/:id',
  webAuth('accountant_profile'),
  validate(UserValidation.accountantProfileValidation),
  UserController.getAccountantProfile
);
router.patch(
  '/update_accountant/:id',
  webAuth('update_accountant'),
  validate(UserValidation.updateAccountantProfileValidation),
  UserController.updateAccountantProfile
);
router.patch(
  '/update_accountant_password/:id',
  webAuth('update_accountant_password'),
  validate(UserValidation.updateAccountantPasswordValidation),
  UserController.updateAccountantPassword
);

// Import & Export Routes //
router.get(
  '/cash_collected/export/',
  webAuth('export_collection'),
  validate(CollectCashValidation.exportValidation),
  CollectCashController.exportCollection
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
  '/withdrawal_method/export/',
  webAuth('export_collection'),
  validate(WithdrawalMethodValidation.exportValidation),
  WithdrawalMethodController.exportCollection
);
router.get(
  '/restaurant_disbursement/export/:type/:status',
  webAuth('export_collection'),
  validate(DisbursementValidation.exportValidation),
  DisbursementController.exportRestaurantCollection
);
router.get(
  '/disbursement/restaurant_report/export/:id/:type',
  webAuth('export_collection'),
  validate(DisbursementValidation.exportDisbursementReportValidation),
  DisbursementController.exportRestaurantDisbursementCollection
);
router.get(
  '/deliveryman_disbursement/export/:type/:status',
  webAuth('export_collection'),
  validate(DisbursementValidation.exportValidation),
  DisbursementController.exportDeliverymanCollection
);
router.get(
  '/disbursement/deliveryman_report/export/:id/:type',
  webAuth('export_collection'),
  validate(DisbursementValidation.exportDisbursementReportValidation),
  DisbursementController.exportDeliverymanDisbursementCollection
);
router.get(
  '/expense/export/:type/:status',
  webAuth('export_collection'),
  validate(AdminExpenseValidation.exportValidation),
  AdminExpenseController.exportQueryCollection
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
  validate(PosOrTableOrderValidation.exportPOSOrderValidation),
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
// Import & Export Routes //

// Accountant User Contact Detail Routes //
router.get(
  '/user_contact_detail/:id',
  webAuth('user_contact_detail'),
  validate(UserValidation.adminUserContactDetailValidation),
  UserController.adminUserContactDetail
);
// Accountant User Contact Detail Routes //

/// Chat Messages Routes //
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

module.exports = router;

