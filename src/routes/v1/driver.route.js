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

const DriverValidation = require('../../validations/driver.validation');
const OrdersValidation = require('../../validations/orders.validation');
const OrderDeliveryProofValidation = require('../../validations/order.delivery.proof.validation');
const UserValidation = require('../../validations/user.validation');
const ReviewRatingValidation = require('../../validations/review.ratings.validation');
const DeliverymanPayoutMethodValidation = require('../../validations/deliveryman.payout.method.validation');
const WalletValidation = require('../../validations/wallet.validation');
const WithdrawalRequestValidation = require('../../validations/withdrawal.request.validation');
const ChatRoomValidation = require('../../validations/chat.room.validation');
const UserNotificationSettingValidation = require('../../validations/user.notification.setting.validation');

const DriverController = require('../../controllers/driver.controller');
const RestaurantController = require('../../controllers/restaurant.controller');
const DriverOfflineMessageController = require('../../controllers/driver.offline.messages.controller');
const OrdersController = require('../../controllers/orders.controller');
const OrdersCancellationReasonController = require('../../controllers/order.cancellation.reason.controller');
const OrderDeliveryProofController = require('../../controllers/order.delivery.proof.controller');
const UserController = require('../../controllers/user.controller');
const ReviewRatingController = require('../../controllers/review.ratings.controller');
const DeliverymanPayoutMethodController = require('../../controllers/deliveryman.payout.method.controller');
const WithdrawalMethodController = require('../../controllers/withdrawal.method.controller');
const WalletController = require('../../controllers/wallet.controller');
const WithdrawalRequestController = require('../../controllers/withdrawal.request.controller');
const ChatRoomController = require('../../controllers/chat.room.controller');
const SupportChatRoomController = require('../../controllers/support.chat.room.controller');
const SupportEnterpriseController = require('../../controllers/support.enterprise.controller');
const UserNotificationSettingController = require('../../controllers/user.notification.setting.controller');
const UserDeleteAccountReasonController = require('../../controllers/user.delete.account.reason.controller');
const NotificationListController = require('../../controllers/notification.list.controller');

const router = express.Router();

// Restaurant Routes //
router.post(
  '/restaurant/trending',
  appAuth('trendingRestaurantNearMe'),
  validate(DriverValidation.driverNearTrendingRestaurantValidation),
  RestaurantController.driverNearTrendingRestaurant
);
// Restaurant Routes //

// Driver Offline Messages Routes //
router.get(
  '/driver_offline_messages/getMessagesList',
  appAuth('getOfflineMessages'),
  DriverOfflineMessageController.getOfflineMessageList
);
// Driver Offline Messages Routes //

// Driver Routes //
router.get(
  '/drivers/goOffline/:uid/:reasonId',
  appAuth('goOffline'),
  validate(DriverValidation.goOfflineValidation),
  DriverController.goOfflnie
);
router.get(
  '/drivers/goOnline/:uid',
  appAuth('goOnline'),
  validate(DriverValidation.goOnlineValidation),
  DriverController.goOnline
);
router.post(
  '/updateMyGeoLocation',
  appAuth('updateMyLocation'),
  validate(DriverValidation.updateMyLocationValidation),
  DriverController.updateMyLocation
);
// Rider's zone card (Batch G-4): current zone + live demand. No params —
// resolved from the authenticated driver. Display-only.
router.get('/drivers/myZone', appAuth('myZone'), DriverController.getMyZone);
// Driver Routes //

// Orders Route //
router.get(
  '/orders/newOrder/:driverId',
  appAuth('newOrders'),
  validate(OrdersValidation.driverValidation),
  OrdersController.getDriverNewOrderList
);
router.get(
  '/cancellation/driver',
  appAuth('cancellationReason'),
  OrdersCancellationReasonController.getDriverCancellationList
);
router.post(
  '/orders/acceptOrder',
  appAuth('acceptOrder'),
  validate(OrdersValidation.orderAcceptValidation),
  OrdersController.driverAcceptOrder
);
router.post(
  '/orders/rejectOrder/',
  appAuth('rejectOrder'),
  validate(OrdersValidation.orderDriverRejectValidation),
  OrdersController.driverRejectOrder
);
router.get(
  '/orders/activeOrder/:driverId',
  appAuth('activeOrder'),
  validate(OrdersValidation.driverValidation),
  OrdersController.driverActiveOrder
);
router.get(
  '/orders/orderDetails/:id',
  appAuth('driverOrderDetails'),
  validate(OrdersValidation.orderIdValidation),
  OrdersController.driverOrderDetails
);
router.get(
  '/orders/driverReachRestaurant/:id',
  appAuth('reachedRestaurant'),
  validate(OrdersValidation.orderIdValidation),
  OrdersController.driverReachedRestaurant
);
router.post(
  '/orders/driverPickupOrder',
  appAuth('driverPickupOrder'),
  validate(OrdersValidation.orderPickupValidation),
  OrdersController.driverPickupOrder
);
router.post(
  '/orders/driverReachCustomer',
  appAuth('reachedCustomer'),
  validate(OrdersValidation.driverReachedCustomerValidation),
  OrdersController.driverReachedCustomer
);
router.post(
  '/orders/driverDeliverOrder',
  appAuth('driverDeliverOrder'),
  validate(OrdersValidation.driverDeliverOrderValidation),
  OrdersController.driverDeliverOrder
);
router.post(
  '/orders/orderList/',
  appAuth('orderList'),
  validate(DriverValidation.orderListValidation),
  OrdersController.driverOrderList
);
// Orders Route //

// Order Delivery Proof Routes //
router.post(
  '/proof/save',
  appAuth('saveProof'),
  validate(OrderDeliveryProofValidation.saveProof),
  OrderDeliveryProofController.saveProof
);
// Order Delivery Proof Routes //

// Driver Profile Routes //
router.get(
  '/profile/me/:uid',
  appAuth('getDriverProfile'),
  validate(UserValidation.getDriverProfileValidation),
  UserController.getMyDriverProfile
);
router.patch(
  '/profile/update/:id',
  appAuth('updateDeliveryProfile'),
  validate(UserValidation.updateDeliverymanValidation),
  UserController.updateDeliverymanProfile
);
// Driver Profile Routes //

// Review Routes //
router.post(
  '/reviews/deliveryman',
  appAuth('getDeliverymanReviewList'),
  validate(ReviewRatingValidation.getDeliverymanReviewValidation),
  ReviewRatingController.getDeliverymanReviewList
);
// Review Routes //

// Deposite Routes //
router.get(
  '/depositeDetail/:deliveryman',
  appAuth('depositeDetail'),
  validate(DriverValidation.getDeliveryDepositeDetailValidation),
  DriverController.getDeliveryDepositeDetail
);
// Deposite Routes //

// Payout Method Routes //
router.get(
  '/payoutMethod/list',
  appAuth('payoutMethodList'),
  WithdrawalMethodController.withdrawalMethodListDeliveryman
);
router.post(
  '/payoutMethod/createPayoutMethod',
  appAuth('createPayoutMethod'),
  validate(DeliverymanPayoutMethodValidation.createPayoutMethodValidation),
  DeliverymanPayoutMethodController.create
);
router.get(
  '/payoutMethod/myPayoutList/:deliveryman',
  appAuth('getPayoutMethodList'),
  validate(DeliverymanPayoutMethodValidation.deliverymanValidation),
  DeliverymanPayoutMethodController.getMyPayoutMethodList
);
router.delete(
  '/payoutMethod/deleteMethod/:id/:deliveryman',
  appAuth('deletePayoutMethod'),
  validate(DeliverymanPayoutMethodValidation.deletePayoutMethodValidation),
  DeliverymanPayoutMethodController.deletePayoutMethod
);
router.get(
  '/payoutMethod/detail/:id/:deliveryman',
  appAuth('getPayoutMethodDetail'),
  validate(DeliverymanPayoutMethodValidation.payoutMethodDetailValidation),
  DeliverymanPayoutMethodController.getPayoutMethodDetail
);
router.patch(
  '/payoutMethod/updatePayoutMethod',
  appAuth('updatePayoutMethod'),
  validate(DeliverymanPayoutMethodValidation.updatePayoutMethodValidation),
  DeliverymanPayoutMethodController.updatePayoutMethodDetail
);
router.patch(
  '/payoutMethod/changeDefaultPayoutMethod',
  appAuth('updatePayoutMethod'),
  validate(DeliverymanPayoutMethodValidation.changeDefaultPayoutMethodValidation),
  DeliverymanPayoutMethodController.changeDefaultPayoutMethod
);
// Payout Method Routes //

// Wallet Routes //
router.get(
  '/wallet/getWalletTransaction/:user',
  appAuth('getWalletTransaction'),
  validate(UserValidation.idValidation),
  WalletController.deliverymanWalletTransaction
);
router.get(
  '/wallet/withdrawalDetail/:deliveryman',
  appAuth('withdrawalDetail'),
  validate(WalletValidation.deliverymanWalletWithdrawalDetailValidation),
  WalletController.deliverymanWalletWithdrawalDetail
);
// Wallet Routes //

// Withdrawal Routes //
router.post(
  '/wallet/requestWithdrawal',
  appAuth('withdrawalRequest'),
  validate(WithdrawalRequestValidation.createDeliverymanWithdrawalRequestValidation),
  WithdrawalRequestController.createDeliverymanWithdrawalRequest
);
router.get(
  '/wallet/withdrawalHistory/:deliveryman',
  appAuth('withdrawalHistory'),
  validate(WithdrawalRequestValidation.deliverymanHistoryValidation),
  WithdrawalRequestController.deliverymanWithdrawalHistory
);
// Withdrawal Routes //

// Deliveryman Insight //
router.get(
  '/insight/overall/:uid',
  appAuth('driverInsight'),
  validate(DriverValidation.deliverymanInsightValidation),
  DriverController.deliverymanInsight
);
// Deliveryman Insight //

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
  UserDeleteAccountReasonController.geDeliverymanActiveReason
);
router.post(
  '/account_setting/delete_account',
  appAuth('delete_account'),
  validate(UserValidation.deleteDeliverymanAccountValidation),
  UserController.deliverymanDeleteAccount
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

