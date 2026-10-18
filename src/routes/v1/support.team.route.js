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

const UserValidation = require('../../validations/user.validation');
const ChatRoomValidation = require('../../validations/chat.room.validation');
const SupportEnterpriseController =
  require('../../controllers/support.enterprise.controller');
const SupportStatsController = require('../../controllers/support.stats.controller');
const OrdersValidation = require('../../validations/orders.validation');
const DiningBookingValidation = require('../../validations/dining.booking.validation');
const UserPurchasedTiffinSubscriptionValidation = require('../../validations/user.purchased.tiffin.subscriptions.validation');
const RestaurantValidation = require('../../validations/restaurant.validation');

const UserController = require('../../controllers/user.controller');
const SupportChatRoomController = require('../../controllers/support.chat.room.controller');
const OrdersController = require('../../controllers/orders.controller');
const DiningBookingController = require('../../controllers/dining.booking.controller');
const UserPurchasedTiffinSubscriptionController = require('../../controllers/user.purchased.tiffin.subscription.controller');
const RestaurantController = require('../../controllers/restaurant.controller');
const CityController = require('../../controllers/city.controller');
const DriverController = require('../../controllers/driver.controller');
const NotificationListController = require('../../controllers/notification.list.controller');

const router = express.Router();

router.get(
  '/web_guard/:id',
  webAuth('web_guard'),
  validate(UserValidation.webGuardValidation),
  UserController.supportTeamProfile
);

router.get('/dashboard', webAuth('support_chats'), SupportChatRoomController.filterChatList);
router.post(
  '/chat_message_initial',
  webAuth('support_chats'),
  validate(ChatRoomValidation.supportChatValidation),
  SupportChatRoomController.getInitialChatSupportMessages
);
router.post(
  '/fetche_more_result',
  webAuth('support_chats'),
  validate(ChatRoomValidation.supportChatValidation),
  SupportChatRoomController.fetchMoreSupportMessages
);
router.post(
  '/chat/send/',
  webAuth('support_chats'),
  // After webAuth so the limiter can key on the user id rather than a shared
  // carrier-NAT IP.
  rateLimiter.supportChatSendLimiter,
  validate(ChatRoomValidation.sendChatMessageValidation),
  SupportChatRoomController.saveSupportMessage
);
router.get(
  '/order_detail/:id',
  webAuth('order_detail'),
  validate(OrdersValidation.orderDetailSupportTeamValidation),
  OrdersController.supportTeamOrderDetail
);
router.get(
  '/booking_detail/:bookingId',
  webAuth('booking_detail'),
  validate(DiningBookingValidation.supportTeamDiningValidation),
  DiningBookingController.supportTeamBookingDetail
);
router.get(
  '/purchase_detail/:id',
  webAuth('purchase_detail'),
  validate(UserPurchasedTiffinSubscriptionValidation.supportTeamPurchaseDetailValidation),
  UserPurchasedTiffinSubscriptionController.supportTeamPurchaseDetail
);
router.post(
  '/resolve_support_chat',
  webAuth('support_chats'),
  validate(ChatRoomValidation.resolveSupportChatValidation),
  SupportChatRoomController.resolveSupportChat
);
router.get(
  '/export_chats/:id',
  webAuth('support_chats'),
  validate(ChatRoomValidation.exportSupportChatValidation),
  SupportChatRoomController.exportSupportChat
);
router.get(
  '/support_team_chat_list/:id',
  webAuth('support_chats'),
  validate(ChatRoomValidation.supportTeamChatValidation),
  SupportChatRoomController.supportTeamChat
);
router.get('/customer_list', webAuth('customer_list'), UserController.customerList);
router.get(
  '/customer_detail/:id',
  webAuth('customer_list'),
  validate(UserValidation.supportTeamCustomerDetailValidation),
  UserController.supportTeamCustomerDetail
);
router.get(
  '/restaurant_initial',
  webAuth('restaurant_list'),
  RestaurantController.restauratReportInitialFilter
);
router.get(
  '/restaurant_list',
  webAuth('restaurant_list'),
  RestaurantController.supportTeamRestaurantList
);
router.get(
  '/restaurant_detail/:id',
  webAuth('restaurant_list'),
  validate(RestaurantValidation.supportTeamRestaurantValidation),
  RestaurantController.supportTeamRestaurantDetail
);

router.get('/all_cities', webAuth('cities_list'), CityController.getAll);
router.get(
  '/deliveryman_list',
  webAuth('deliveryman_list'),
  DriverController.supportTeamDeliverymanList
);

router.get(
  '/support_team_profile/:id',
  webAuth('support_team_profile'),
  validate(UserValidation.supportTeamProfileValidation),
  UserController.getSupportTeamProfile
);
router.patch(
  '/update_support_team/:id',
  webAuth('update_support_team'),
  validate(UserValidation.updateSupportTeamProfileValidation),
  UserController.updateSupportTeamProfile
);
router.patch(
  '/update_support_team_password/:id',
  webAuth('update_support_team_password'),
  validate(UserValidation.updateSupportTeamPasswordValidation),
  UserController.updateSupportTeamPassword
);

router.get(
  '/support_team_header_content/:id',
  webAuth('support_team_header_content'),
  validate(UserValidation.supportTeamHeaderValidation),
  NotificationListController.supportTeamHeaderContent
);

// --- Enterprise: queue, macros, transfer, internal notes ---------------------
// Literal segments are registered BEFORE `/:id` routes below so they can never
// be swallowed by a future `/:id` sibling.
router.get(
  '/queue',
  webAuth('support_chats'),
  SupportEnterpriseController.agentQueue
);
router.get('/queues', webAuth('support_chats'), SupportEnterpriseController.listQueues);
router.patch(
  '/queues/:id',
  webAuth('support_supervise'),
  validate(ChatRoomValidation.queueUpdateValidation),
  SupportEnterpriseController.updateQueue
);
router.get('/agents/online', webAuth('support_chats'), SupportEnterpriseController.onlineAgents);
router.get('/agents/all', webAuth('support_supervise'), SupportEnterpriseController.allAgents);
router.patch(
  '/agents/:id/languages',
  webAuth('support_supervise'),
  validate(ChatRoomValidation.agentLanguagesValidation),
  SupportEnterpriseController.setAgentLanguages
);
router.get('/sla-policies', webAuth('support_supervise'), SupportEnterpriseController.listSlaPolicies);
router.patch(
  '/sla-policies/:id',
  webAuth('support_supervise'),
  validate(ChatRoomValidation.slaPolicyUpdateValidation),
  SupportEnterpriseController.updateSlaPolicy
);
router.get('/chat/search', webAuth('support_chats'), SupportEnterpriseController.searchMessages);
router.get(
  '/user/:userId/recent-orders',
  webAuth('support_chats'),
  validate(ChatRoomValidation.userIdParamValidation),
  SupportEnterpriseController.recentOrders
);
router.post(
  '/chat/:id/pin-subject',
  webAuth('support_chats'),
  validate(ChatRoomValidation.pinSubjectValidation),
  SupportEnterpriseController.pinSubject
);
router.post(
  '/push/web-token',
  webAuth('support_chats'),
  validate(ChatRoomValidation.webTokenValidation),
  SupportEnterpriseController.registerWebToken
);
router.get(
  '/chat/:id/export',
  webAuth('support_chats'),
  validate(ChatRoomValidation.transferAnswerValidation),
  SupportEnterpriseController.exportTranscript
);
router.get('/canned', webAuth('support_chats'), SupportEnterpriseController.listCanned);
router.post(
  '/canned',
  webAuth('support_chats'),
  validate(ChatRoomValidation.cannedCreateValidation),
  SupportEnterpriseController.createCanned
);
router.patch(
  '/canned/:id',
  webAuth('support_chats'),
  validate(ChatRoomValidation.cannedUpdateValidation),
  SupportEnterpriseController.updateCanned
);
router.get('/stats/bot-containment', webAuth('support_chats'), SupportEnterpriseController.botContainment);
router.get('/stats/overview', webAuth('support_chats'), SupportStatsController.statsOverview);
router.get('/stats/tickets/export', webAuth('support_chats'), SupportStatsController.ticketsExport);
router.post(
  '/chat/transfer/:id',
  webAuth('support_chats'),
  validate(ChatRoomValidation.transferValidation),
  SupportEnterpriseController.transfer
);
router.post(
  '/chat/transfer/:id/accept',
  webAuth('support_chats'),
  validate(ChatRoomValidation.transferAnswerValidation),
  SupportEnterpriseController.acceptTransfer
);
router.post(
  '/chat/transfer/:id/decline',
  webAuth('support_chats'),
  validate(ChatRoomValidation.transferAnswerValidation),
  SupportEnterpriseController.declineTransfer
);
router.post(
  '/chat/transfer/:id/cancel-offer',
  webAuth('support_supervise'),
  SupportEnterpriseController.cancelOffer
);
router.post(
  '/chat/:id/force-assign',
  webAuth('support_supervise'),
  validate(ChatRoomValidation.transferValidation),
  SupportEnterpriseController.forceAssign
);
router.post(
  '/chat/:id/force-resolve',
  webAuth('support_supervise'),
  validate(ChatRoomValidation.transferAnswerValidation),
  SupportEnterpriseController.forceResolve
);
router.post(
  '/chat/bulk',
  webAuth('support_supervise'),
  validate(ChatRoomValidation.bulkActionValidation),
  SupportEnterpriseController.bulkAction
);
router.post(
  '/broadcast',
  webAuth('support_supervise'),
  validate(ChatRoomValidation.broadcastValidation),
  SupportEnterpriseController.broadcast
);
router.post(
  '/chat/internal_note/:id',
  webAuth('support_chats'),
  validate(ChatRoomValidation.internalNoteValidation),
  SupportEnterpriseController.internalNote
);

// Presence: the assignment engine only rotates agents whose presence is fresh,
// and the cron clears stale flags. The workspace heartbeats on open and on
// close so a crashed tab stops receiving tickets.
router.post('/presence/heartbeat', webAuth('support_chats'), SupportEnterpriseController.presenceHeartbeat);
router.post('/presence/offline', webAuth('support_chats'), SupportEnterpriseController.presenceOffline);
router.post('/presence/leave-room', webAuth('support_chats'), SupportEnterpriseController.presenceLeaveRoom);
router.post(
  '/presence/status',
  webAuth('support_chats'),
  validate(ChatRoomValidation.presenceStatusValidation),
  SupportEnterpriseController.presenceStatus
);
router.get('/chat/viewers/:id', webAuth('support_chats'), SupportEnterpriseController.roomViewers);

// Supervisor forcing an agent's status from the roster (available/busy/offline).
router.post(
  '/agents/availability',
  webAuth('support_supervise'),
  SupportEnterpriseController.setAgentAvailability
);

// Shift coverage. One shift per agent (upsert), soft-deleted on removal.
router.get('/shifts', webAuth('support_supervise'), SupportEnterpriseController.listShifts);
router.post('/shifts/:agent', webAuth('support_supervise'), SupportEnterpriseController.setShift);
router.delete('/shifts/:agent', webAuth('support_supervise'), SupportEnterpriseController.deleteShift);
router.get('/coverage', webAuth('support_supervise'), SupportEnterpriseController.coverageBoard);

// Merge + duplicate detection. Detection is read-only and available to any
// agent; acting on it is supervisor-only, because a merge rewrites ownership
// for both tickets.
router.get('/chat/:id/duplicates', webAuth('support_chats'), SupportEnterpriseController.detectDuplicates);
router.post('/chat/:id/merge', webAuth('support_supervise'), SupportEnterpriseController.mergeTickets);
router.post('/chat/:id/unmerge', webAuth('support_supervise'), SupportEnterpriseController.unmergeTicket);

// Support QA. Sampling and reviewing are supervisor-only; an agent may read
// their OWN quality score and reviews, never a colleague's.
router.get('/qa/sample', webAuth('support_supervise'), SupportEnterpriseController.qaSample);
router.post('/qa/review', webAuth('support_supervise'), SupportEnterpriseController.qaReview);
router.get('/qa/quality', webAuth('support_chats'), SupportEnterpriseController.qaQuality);
router.get('/qa/reviews', webAuth('support_chats'), SupportEnterpriseController.qaReviews);

module.exports = router;

