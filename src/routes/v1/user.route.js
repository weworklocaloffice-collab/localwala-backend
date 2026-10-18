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

const UserValidation = require('../../validations/user.validation');
const FavouriteValidation = require('../../validations/favourite.validation');
const UserAddressValidation = require('../../validations/user.address.validation');
const OrderSettingValidation = require('../../validations/order.setting.validation');
const CouponValidation = require('../../validations/coupon.validation');
const OrdersValidation = require('../../validations/orders.validation');
const PaymentInitiationValidation = require('../../validations/payment.initiation.validation');
const LoyaltyPointValidation = require('../../validations/loyalty.points.validation');
const RefundRequestValidation = require('../../validations/refund.request.validation');
const FileUploadValidation = require('../../validations/file.validation');
const ComplaintsValidation = require('../../validations/complaints.validation');
const HideRestaurantValidation = require('../../validations/hide.restaurant.validation');
const ReportIssueRestaurantValidation = require('../../validations/report.issue.restaurant.validation');
const FavouriteOrderValidation = require('../../validations/favourite.orders.validation');
const ReviewRatingValidation = require('../../validations/review.ratings.validation');
const SubscriptionTiffinPackageValidation = require('../../validations/subscription.tiffin.packages.validation');
const UserPurchasedTiffinSubscriptionValidation = require('../../validations/user.purchased.tiffin.subscriptions.validation');
const TiffinSubscriptionRefundRequestValidation = require('../../validations/tiffin.subscription.refund.request.validation');
const DiningBookingValidation = require('../../validations/dining.booking.validation');
const DiningBookingRefundRequestValidation = require('../../validations/dining.booking.refund.request.validation');
const DiningCouponValidation = require('../../validations/dining.coupon.validation');
const ChatRoomValidation = require('../../validations/chat.room.validation');
const AuthValidation = require('../../validations/auth.validation');
const RestaurantValidation = require('../../validations/restaurant.validation');
const UserNotificationSettingValidation = require('../../validations/user.notification.setting.validation');

const WalletController = require('../../controllers/wallet.controller');
const FavouriteController = require('../../controllers/favourite.controller');
const UserAddressController = require('../../controllers/user.address.controller');
const OrderSettingsController = require('../../controllers/order.settings.controller');
const CouponController = require('../../controllers/coupon.controller');
const OrdersController = require('../../controllers/orders.controller');
const PaymentConfigController = require('../../controllers/payment.config.controller');
const PaymentInitiationController = require('../../controllers/payment.initiation.controller');
const LoyaltyPointController = require('../../controllers/loyalty.points.controller');
const OrdersCancellationReasonController = require('../../controllers/order.cancellation.reason.controller');
const RefundRequestReasonController = require('../../controllers/refund.request.reason.controller');
const RefundRequestController = require('../../controllers/refund.request.controller');
const MediaController = require('../../controllers/media.controller');
const ComplaintsController = require('../../controllers/complaints.controller');
const HideRestaurantController = require('../../controllers/hide.restaurant.controller');
const ReportIssueRestaurantController = require('../../controllers/report.issue.restaurant.controller');
const ReportIssueRestaurantReasonController = require('../../controllers/report.issue.restaurant.reason.controller');
const HideRestaurantReasonController = require('../../controllers/hide.restaurant.reason.controller');
const FavouriteOrderController = require('../../controllers/favourite.orders.controller');
const ReviewRatingController = require('../../controllers/review.ratings.controller');
const NotificationListController = require('../../controllers/notification.list.controller');
const SubscriptionTiffinPackageController = require('../../controllers/subscription.tiffin.package.controller');
const UserPurchasedTiffinSubscriptionController = require('../../controllers/user.purchased.tiffin.subscription.controller');
const TiffinSubscriptionCancellationReasonController = require('../../controllers/tiffin.subscription.cacellation.reason.controller');
const TiffinSubscriptionRefundRequestReasonController = require('../../controllers/tiffin.subscription.refund.request.reason.controller');
const TiffinSubscriptionRefundRequestController = require('../../controllers/tiffin.subscription.refund.request.controller');
const DiningBookingController = require('../../controllers/dining.booking.controller');
const RestaurantController = require('../../controllers/restaurant.controller');
const DiningCancellationReasonController = require('../../controllers/dining.cancellation.reason.controller');
const DiningBookingRefundRequestReasonController = require('../../controllers/dining.booking.refund.request.reason.controller');
const DiningBookingRefundRequestController = require('../../controllers/dining.booking.refund.request.controller');
const DiningCouponController = require('../../controllers/dining.coupon.controller');
const ChatRoomController = require('../../controllers/chat.room.controller');
const AuthController = require('../../controllers/auth.controller');
const UserAvatarController = require('../../controllers/user.avatar.controller');
const UserController = require('../../controllers/user.controller');
const SupportChatRoomController = require('../../controllers/support.chat.room.controller');
const SupportEnterpriseController = require('../../controllers/support.enterprise.controller');
const UserDeleteAccountReasonController = require('../../controllers/user.delete.account.reason.controller');
const UserNotificationSettingController = require('../../controllers/user.notification.setting.controller');

const router = express.Router();

// Profile Routes ///
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
router.get('/profile/user_avatar', appAuth('getAvatarList'), UserAvatarController.getAvatarList);
router.get(
  '/media/photos/:uid',
  appAuth('getMyMediaFiles'),
  validate(AuthValidation.getMyMediaFilesValidation),
  MediaController.getMyMediaFiles
);
router.get(
  '/profile/getReferralCode/:userId',
  appAuth('getReferralCode'),
  validate(UserValidation.getReferralCodeValidation),
  UserController.getMyReferralCode
);
// Profile Routes ///

// Favourite Routes //
router.post(
  '/favourite/save',
  appAuth('saveFavourite'),
  validate(FavouriteValidation.saveFavourite),
  FavouriteController.saveFavourite
);
router.post(
  '/favourite/restaurants',
  appAuth('getFavouriteRestaurants'),
  validate(FavouriteValidation.getFavouriteRestaurants),
  FavouriteController.getFavouriteRestaurants
);
router.post(
  '/favourite/foods',
  appAuth('getFavouriteFoods'),
  validate(FavouriteValidation.getFavouriteFoods),
  FavouriteController.getFavouriteFoods
);
router.delete(
  '/favourite/foods/:foodId/:userId',
  appAuth('deleteFavouriteFoods'),
  validate(FavouriteValidation.deleteFavouriteFoodValidation),
  FavouriteController.deleteFavouriteFood
);
router.delete(
  '/favourite/restaurants/:restaurantId/:userId',
  appAuth('deleteFavouriteRestaurant'),
  validate(FavouriteValidation.deleteFavouriteRestaurantValidation),
  FavouriteController.deleteFavouriteRestaurant
);
// Favourite Routes //

// Cart Routes //

// Cart Routes //

// User Address Routes //
router.post(
  '/address/save',
  appAuth('saveAddress'),
  validate(UserAddressValidation.saveAddress),
  UserAddressController.saveAddress
);
router.get(
  '/address/deliveryAddressList/:id',
  appAuth('getMyAddress'),
  validate(UserAddressValidation.myAddressValidation),
  UserAddressController.getDeliveryAddressList
);
router.patch(
  '/address/update/:id',
  appAuth('updateAddress'),
  validate(UserAddressValidation.updateValidation),
  UserAddressController.updateAddress
);
router.delete(
  '/address/delete/:id',
  appAuth('deleteAddress'),
  validate(UserAddressValidation.idValidation),
  UserAddressController.drop
);
router.post(
  '/address/myAddressListFromRestaurant',
  appAuth('getMyAddress'),
  validate(UserAddressValidation.myAddressFromRestaurantValidation),
  UserAddressController.getMyAddressListFromRestaurant
);
// User Address Routes //

// Orders Routes //
router.post(
  '/orders/orderSettings/',
  appAuth('getOrderSettings'),
  validate(OrderSettingValidation.settingValidation),
  OrderSettingsController.getOrderSettings
);
router.post(
  '/orders/placeOrderApp/',
  appAuth('createOrder'),
  validate(OrdersValidation.createOrderValidation),
  OrdersController.placeOrderFromApp
);
router.post(
  '/orders/getMyOrderList/',
  appAuth('getMyOrderList'),
  validate(OrdersValidation.orderListValidation),
  OrdersController.getMyOrderList
);
router.post(
  '/orders/getMyFavouriteOrderList/',
  appAuth('getMyFavouriteOrderList'),
  validate(OrdersValidation.favuoriteOrderListValidation),
  OrdersController.getMyFavouriteOrders
);
router.get(
  '/orders/userOrderDetail/:id/:user',
  appAuth('userOrderDetail'),
  validate(OrdersValidation.userOrderIdValidation),
  OrdersController.getUserOrderDetail
);
router.post(
  '/orders/repayPendingOrder/',
  appAuth('repayPendingOrder'),
  validate(OrdersValidation.repayPendingOrderValidation),
  OrdersController.repayPendingOrder
);
router.post(
  '/orders/switchToCod/',
  appAuth('repayPendingOrder'),
  validate(OrdersValidation.switchToCodValidation),
  OrdersController.switchToCod
);
router.post(
  '/orders/cancelMyOrder/',
  appAuth('cancelMyOrder'),
  validate(OrdersValidation.cancleUserOrderValidation),
  OrdersController.cancelMyOrder
);
router.get(
  '/orders/forComplaint/:id',
  appAuth('detailsForComplaint'),
  validate(OrdersValidation.orderIdValidation),
  OrdersController.getOrderDetailsForComplaints
);
router.get(
  '/orders/getOrderDetailsForReview/:id/:user',
  appAuth('getOrderDetailsForReview'),
  validate(OrdersValidation.userOrderIdValidation),
  OrdersController.getOrderDetailForReview
);
router.get(
  '/orders/summary/:id/:user/:locale',
  appAuth('downloadOrderReceipt'),
  validate(OrdersValidation.downloadOrderReceiptValidation),
  OrdersController.downloadOrderSummary
);
router.get(
  '/orders/invoice/:id/:user/:locale',
  appAuth('downloadOrderReceipt'),
  validate(OrdersValidation.downloadOrderReceiptValidation),
  OrdersController.downloadOrderInvoice
);
// Orders Routes //

// Coupon Routes //
router.post(
  '/coupon/userCoupon/',
  appAuth('getUserCoupon'),
  validate(CouponValidation.userValidation),
  CouponController.getUserCoupon
);
router.post(
  '/coupon/redeem',
  appAuth('redeeemCoupon'),
  validate(CouponValidation.redeemValidation),
  CouponController.redeemCoupon
);
// Coupon Routes //

// Wallet & Loyality Routes //
router.get(
  '/wallet/getMyWalletData/:user',
  appAuth('getWallet'),
  validate(UserValidation.idValidation),
  WalletController.getMyWalletData
);
router.get(
  '/payments/walletList',
  appAuth('getPaymentList'),
  PaymentConfigController.getWalletPaymentList
);
router.post(
  '/payments/initiate/',
  appAuth('initiatePayment'),
  validate(PaymentInitiationValidation.paymentInitiationValidation),
  PaymentInitiationController.create
);
router.get(
  '/loyaltyPoints/getMyLoyaltyPoints/:user',
  appAuth('getLoyaltyPoints'),
  validate(LoyaltyPointValidation.idValidation),
  LoyaltyPointController.getLoyaltyPointsData
);
router.post(
  '/loyaltyPoints/redeemPoints/',
  appAuth('redeemPoints'),
  validate(LoyaltyPointValidation.redeemValidation),
  LoyaltyPointController.redeemLoyaltyPoints
);
// Wallet & Loyality Routes //

// Order Cancellation Reason Routes //
router.get(
  '/cancellation/user',
  appAuth('cancellationReason'),
  OrdersCancellationReasonController.getCustomerCancellationList
);
// Order Cancellation Reason Routes //

// Refund Request Reason List Routes //
router.get('/refund/reasons', appAuth('getRefundReason'), RefundRequestReasonController.getReasons);
router.post(
  '/refund/request/',
  appAuth('createRefundRequest'),
  validate(RefundRequestValidation.saveRefundRequestValidation),
  RefundRequestController.saveRefundRequest
);
// Refund Request Reason List Routes //

// Media Routes //
router.post(
  '/media/deleteMyImage',
  appAuth('deleteMyImage'),
  validate(FileUploadValidation.userMediaDropValidation),
  MediaController.dropUserMedia
);
// Media Routes //

// Reel Routes — removed: `reelRoute` was never required here, so this line
// threw ReferenceError at boot and crashed every route mount. Reels are served
// by the dedicated `/v1/reels` mount in routes/v1/index.js.
// Reel Routes //

// Complaints Routes //
router.post(
  '/complaints/save',
  appAuth('saveComplaints'),
  validate(ComplaintsValidation.saveComplaintValidation),
  ComplaintsController.save
);
// Complaints Routes //

// Hide Restaurant Routes //
router.post(
  '/hide/restaurant',
  appAuth('hideRestaurant'),
  validate(HideRestaurantValidation.hideRestaurantValidation),
  HideRestaurantController.hideRestauarant
);
router.patch(
  '/hide_reason/restaurant/update_reason/',
  appAuth('updateHideReasonRestaurant'),
  validate(HideRestaurantValidation.updateHideReasonValidation),
  HideRestaurantController.updateHideReason
);
router.post(
  '/hide/showHiddenRestaurant',
  appAuth('showHiddenRestaurant'),
  validate(HideRestaurantValidation.showRestaurantValidation),
  HideRestaurantController.showRestaurant
);
router.get(
  '/hide_reason/restaurant/',
  appAuth('getRestaurantHideReason'),
  HideRestaurantReasonController.getReasons
);
router.post(
  '/hide/restaurants/get',
  appAuth('getMyHiddenRestaurants'),
  validate(HideRestaurantValidation.getMyHiddenRestaurantsValidation),
  HideRestaurantController.getMyHiddenRestaurants
);
// Hide Restaurant Routes //

// Report Issue Restaurant Routes //
router.get(
  '/report/reasons',
  appAuth('getReportReasons'),
  ReportIssueRestaurantReasonController.getReasons
);
router.post(
  '/report/restaurant',
  appAuth('reportRestaurant'),
  validate(ReportIssueRestaurantValidation.saveIssueValidation),
  ReportIssueRestaurantController.create
);
// Report Issue Restaurant Routes //

// Favourite Orders Routes //
router.post(
  '/favouriteOrders/save/',
  appAuth('saveFavouriteOrder'),
  validate(FavouriteOrderValidation.saveFavouriteOrderValidation),
  FavouriteOrderController.saveFavourite
);
router.post(
  '/favouriteOrders/remove/',
  appAuth('removeFavouriteOrder'),
  validate(FavouriteOrderValidation.removeFavouriteOrderValidation),
  FavouriteOrderController.removeFavourite
);
// Favourite Orders Routes //

// Review & Ratings Routes //
router.post(
  '/review/save/',
  appAuth('saveOrderReview'),
  validate(ReviewRatingValidation.saveReviewValidation),
  ReviewRatingController.saveOrderReview
);
router.get(
  '/review/restaurant/direct/:restaurant',
  appAuth('getRestaurantInfoForDirectReview'),
  validate(RestaurantValidation.getRestaurantInfoForDirectReviewValidation),
  RestaurantController.getRestaurantInfoForDirectReview
);
router.post(
  '/review/restaurant/direct/save',
  appAuth('saveDirectRestaurantReview'),
  validate(ReviewRatingValidation.savePublicRestaurantReviewValidation),
  ReviewRatingController.savePublicRestaurantReview
);
router.get(
  '/review/myReviewList/:uid',
  appAuth('myReviewList'),
  validate(ReviewRatingValidation.getMyReviewListValidation),
  ReviewRatingController.getMyReviewList
);
router.post(
  '/review/search/restaurants/',
  appAuth('searchRestaurantForReview'),
  validate(RestaurantValidation.globalRestaurantSearchForReviewValidation),
  RestaurantController.globalRestaurantSearchForReview
);
// Review & Ratings Routes //

// Notification Routes //
router.get(
  '/notification/count/:user',
  appAuth('getNotificationCount'),
  validate(UserValidation.idValidation),
  NotificationListController.get
);
router.post(
  '/notification/list/',
  appAuth('getNotificationList'),
  validate(UserValidation.notificationListValidation),
  NotificationListController.getMyNotificationList
);
router.get(
  '/notification/readAll/:user',
  appAuth('readAllNotification'),
  validate(UserValidation.idValidation),
  NotificationListController.readAllNotification
);
// Notification Routes //

// Subscription Tiffin Package Routes //
router.get(
  '/tiffin_packages/buy/:id/',
  appAuth('buyTiffinSubscription'),
  validate(SubscriptionTiffinPackageValidation.getDetailValidation),
  SubscriptionTiffinPackageController.buySubscriptionDetails
);
router.post(
  '/tiffin_packages/purchase_tiffin_package/',
  appAuth('purchaseTiffinSubscription'),
  validate(UserPurchasedTiffinSubscriptionValidation.buyTiffinSubscriptionValidation),
  UserPurchasedTiffinSubscriptionController.purchaseTiffinSubscription
);
router.post(
  '/tiffin_packages/purchased/',
  appAuth('purchasedTiffinSubscriptionList'),
  validate(UserPurchasedTiffinSubscriptionValidation.purchasedSubscriptionListValidation),
  UserPurchasedTiffinSubscriptionController.getMyPurchasedSubscription
);
router.post(
  '/tiffin_packages/purchased/info/',
  appAuth('purchasedTiffinSubscriptionInfo'),
  validate(UserPurchasedTiffinSubscriptionValidation.purchasedSubscriptionInfoValidation),
  UserPurchasedTiffinSubscriptionController.getPurchasedSubscriptionInfo
);
router.post(
  '/tiffin_packages/repayPendingSubscriptionPackage/',
  appAuth('repayPendingSubscriptionPackage'),
  validate(
    UserPurchasedTiffinSubscriptionValidation.repayPendingSubscriptionTiffinPackageValidation
  ),
  UserPurchasedTiffinSubscriptionController.repayPendingSubscriptionPackage
);
router.post(
  '/tiffin_packages/userCancelTiffinSubscription/',
  appAuth('userCancelTiffinSubscription'),
  validate(UserPurchasedTiffinSubscriptionValidation.userCancelTiffinSubscriptionValidation),
  UserPurchasedTiffinSubscriptionController.userCancelTiffinSubscription
);
router.post(
  '/tiffin_packages/requestOffDay/',
  appAuth('userRequestOffDayTiffinSubscription'),
  validate(UserPurchasedTiffinSubscriptionValidation.userRequestOffDayOnSubscriptionValidation),
  UserPurchasedTiffinSubscriptionController.userRequestOffDayOnSubscription
);
router.get(
  '/tiffin_packages/summary/:id/:user/:locale',
  appAuth('download_tiffin_packages_receipt'),
  validate(UserPurchasedTiffinSubscriptionValidation.downloadBookingReceiptValidation),
  UserPurchasedTiffinSubscriptionController.downloadSummary
);
router.get(
  '/tiffin_packages/invoice/:id/:user/:locale',
  appAuth('download_tiffin_packages_receipt'),
  validate(UserPurchasedTiffinSubscriptionValidation.downloadBookingReceiptValidation),
  UserPurchasedTiffinSubscriptionController.downloadInvoice
);
// Subscription Tiffin Package Routes //

// Tiffin Subscription Cancellation Reason Routes //
router.get(
  '/tiffin_subscription_cancel_reason/user',
  appAuth('tiffinSubscriptionCancellationReason'),
  TiffinSubscriptionCancellationReasonController.getCustomerCancellationList
);
// Tiffin Subscription Cancellation Reason Routes //

/// Tiffin Subscription Refund Routes //
router.get(
  '/tiffin_subscription_refund/reasons',
  appAuth('getTiffinSubscriptionRefundReason'),
  TiffinSubscriptionRefundRequestReasonController.getReasons
);
router.post(
  '/tiffin_subscription_refund/sendRefundRequest/',
  appAuth('sendTiffinSubscriptionRefundRequest'),
  validate(TiffinSubscriptionRefundRequestValidation.saveRefundRequestValidation),
  TiffinSubscriptionRefundRequestController.saveRefundRequest
);
/// Tiffin Subscription Refund Routes //

/// Dining Bookings Routes //
router.post(
  '/dining_booking/confirm/',
  appAuth('confirmDiningBooking'),
  validate(DiningBookingValidation.diningBookingConfirmValidation),
  RestaurantController.getDiningBookingConfirmInformation
);
router.get(
  '/dining_coupon/redeem/:user/:coupon',
  appAuth('redeeemDiningCoupon'),
  validate(DiningCouponValidation.redeemValidation),
  DiningCouponController.redeemCoupon
);
router.post(
  '/dining_booking/create/',
  appAuth('createDiningBooking'),
  validate(DiningBookingValidation.createBookingValidation),
  DiningBookingController.createBooking
);
router.get(
  '/dining_booking/search/:uid/:query',
  appAuth('searchDiningBooking'),
  validate(DiningBookingValidation.queryValidation),
  DiningBookingController.searchDiningBooking
);
router.post(
  '/dining_booking/list/',
  appAuth('diningBookingList'),
  validate(DiningBookingValidation.diningBookingByUserIdValidation),
  DiningBookingController.getDiningBookingWithUserId
);
router.post(
  '/dining_booking/information/',
  appAuth('diningBookingInformation'),
  validate(DiningBookingValidation.getUserDiningBookingInformationValidation),
  DiningBookingController.getUserDiningBookingInformation
);
router.post(
  '/dining_booking/repayPendingBooking/',
  appAuth('repayPendingBooking'),
  validate(DiningBookingValidation.repayPendingBookingValidation),
  DiningBookingController.repayPendingBooking
);
router.get(
  '/dining_booking/cancellation/user',
  appAuth('diningBookingCancellationReason'),
  DiningCancellationReasonController.getCustomerCancellationList
);
router.post(
  '/dining_booking/cancelMyDiningBooking/',
  appAuth('cancelMyDiningBooking'),
  validate(DiningBookingValidation.cancleUserDiningBookingValidation),
  DiningBookingController.cancelMyDiningBooking
);
router.get(
  '/dining_booking_refund/reasons',
  appAuth('getDiningBookingRefundReason'),
  DiningBookingRefundRequestReasonController.getReasons
);
router.post(
  '/dining_booking_refund/request/',
  appAuth('createDiningBookingRefundRequest'),
  validate(DiningBookingRefundRequestValidation.saveRefundRequestValidation),
  DiningBookingRefundRequestController.saveRefundRequest
);
router.get(
  '/dining_booking/summary/:id/:user/:locale',
  appAuth('download_booking_receipt'),
  validate(DiningBookingValidation.downloadBookingReceiptValidation),
  DiningBookingController.downloadBookingSummary
);
router.get(
  '/dining_booking/invoice/:id/:user/:locale',
  appAuth('download_booking_receipt'),
  validate(DiningBookingValidation.downloadBookingReceiptValidation),
  DiningBookingController.downloadBookingInvoice
);
/// Dining Bookings Routes //

// Payment Transaction Routes //
router.post(
  '/transaction/orders/',
  appAuth('getUserOrderTransactions'),
  validate(PaymentInitiationValidation.getUserOrderTransactionsValidation),
  PaymentInitiationController.getUserOrderTransaction
);
router.post(
  '/transaction/booking/',
  appAuth('getUserDiningTransactions'),
  validate(PaymentInitiationValidation.getUserDiningransactionsValidation),
  PaymentInitiationController.getUserDiningTransaction
);
router.post(
  '/transaction/food_subscription/',
  appAuth('getFoodSubscriptionTransactions'),
  validate(PaymentInitiationValidation.getUserFoodSubscriptionTransactionsValidation),
  PaymentInitiationController.getUserFoodSubscriptionTransaction
);
// Payment Transaction Routes //

// Phone Number Call Routes //
router.get(
  '/driver/call/:driver',
  appAuth('fetchDriverPhoneNumber'),
  validate(OrdersValidation.fetchDriverPhoneNumberValidation),
  OrdersController.fetchDriverPhoneNumber
);
// Phone Number Call Routes //

/// Chat Messages Routes //
router.post(
  '/chat_room/fetchMessages/',
  appAuth('fetchChatMessages'),
  validate(ChatRoomValidation.checkChatRoomValidation),
  ChatRoomController.checkChatRoom
);
router.post(
  '/chat_room/sendMessage/',
  appAuth('sendChatMessage'),
  validate(ChatRoomValidation.sendChatMessageValidation),
  ChatRoomController.saveNewMessage
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

// --- Enterprise: bot-first -> human handover -------------------------------
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

// Reopen a resolved ticket within 48h instead of forking a duplicate. Literal
// segment first so `/:id` siblings below can never swallow it.
router.post(
  '/support_chat_room/reopen/:id',
  appAuth('sendChatMessage'),
  validate(ChatRoomValidation.reopenValidation),
  SupportEnterpriseController.reopen
);
router.get(
  '/support_chat_room/chips',
  appAuth('fetchChatMessages'),
  SupportEnterpriseController.customerChips
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
  '/delete_account_reason_list',
  appAuth('delete_account_reason_list'),
  UserDeleteAccountReasonController.getUserActiveReason
);
router.post(
  '/account_setting/delete_account',
  appAuth('delete_account'),
  validate(UserValidation.deleteUserAccountValidation),
  UserController.deleteUserAccount
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
  '/account_setting/update_locale/',
  appAuth('update_locale'),
  validate(UserValidation.updateLocaleValidation),
  UserController.updateUserLocale
);
// Account Settings Routes//

module.exports = router;

