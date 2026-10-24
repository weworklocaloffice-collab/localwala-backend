/**
 * LocalWala — Local Commerce & Delivery Platform
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

/**
 * stores.notify.service.js
 *
 * The store vertical's application of the shared push path.
 *
 * `src/services/fcm.notification.service.js` carries every per-restaurant message
 * inline, which is why it has reached 4,183 lines: each restaurant event hard-codes the
 * title, body, the restaurant lookup, the user lookup, and the translation lookup. The
 * order lifecycle is a blank page with a new event's details spilled onto it. Approvals,
 * rejections, and the new order lifecycle should ship in days, not re-derive that page.
 *
 * This module is deliberately the opposite shape: templates are data, one function
 * delivers them. Changing an application status from "you are rejected" to "your
 * application needs one more document" is a text edit, not a code change.
 *
 * ## Invariants, on purpose
 *
 *   1. A failed push NEVER fails the business operation. `submit`, `approveAndCommit`,
 *      and `requestChanges` write their real records and only ASKEW the push. Swapping
 *      the order — a push failure rolling back the application state — would be
 *      nonsense, because the application happened.
 *
 *   2. No token must not become an error. A partner on a desktop behind a corporate
 *      network that strips the FCM header is not a broken applicant; they simply do not
 *      get a push, and the in-app feed is the fallback.
 *
 *   3. There is no admin SDK by default in dev. Asking FCM for a token it does not have
 *      is a safe no-op, not a crash. Everything is wrapped, because the same lack of
 *      credentials in staging must not take the request down.
 */

const mongoose = require('mongoose');
const admin = require('firebase-admin');
const { PushNotificationToken } = require('../../../models');

/**
 * The application-status notifications a partner can be told about during onboarding
 * and review. Every one is transactionally meaning: a partner MUST know their
 * application moved, and the in-app feed is the secondary channel.
 *
 * `type` is the message-type discriminator stored on the FCM payload and read by the
 * Flutter handler. `route` is the deep link inside the store partner app.
 */
const STORE_APPLICATION_NOTIFICATIONS = Object.freeze({
  application_submitted: {
    type: 'store.application.submitted',
    title: 'Application received',
    body: 'Your store application for {{storeName}} is in review. We will notify you when it moves.',
    route: '/application',
  },
  changes_requested: {
    type: 'store.application.changes_requested',
    title: 'Changes needed on your application',
    body: 'Reviewers need a quick revision on {{storeName}} before they can approve it.',
    route: '/application',
  },
  application_approved: {
    type: 'store.application.approved',
    title: 'Application approved',
    body: '{{storeName}} is approved. Activate your outlet settings to start taking orders.',
    route: '/application',
  },
  application_rejected: {
    type: 'store.application.rejected',
    title: 'Application rejected',
    body: 'Your application for {{storeName}} was rejected. Open it for the reason and a fresh start.',
    route: '/application',
  },
});

/** Lightweight template fill. Strings only, and braces are an exact replace. */
const fill = (template, context = {}) =>
  String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const value = context[key];
    return value === undefined || value === null ? '' : String(value);
  });

/**
 * True only when the Firebase admin SDK has somewhere to send a message.
 *
 * In dev and in tests there is no service account, and every call to
 * `admin.messaging()` would throw "The default Firebase app does not exist." That is
 * NOT an application problem, not a partner problem, and certainly not a stores problem,
 * so it surfaces as a deliberate 'no_admin' skip rather than an exception.
 */
const adminReady = () => {
  try {
    return !!admin.app();
  } catch {
    return false;
  }
};

/**
 * Build the notification record for an application-status event.
 *
 * Exported for tests AND for the channel that ALWAYS wants the text but has no token —
 * the store partner app derives its in-app message from the same template, so the push
 * and the feed can never disagree.
 *
 * @param {object|string} application a StoreOnboarding document
 * @param {string}        event       one of STORE_APPLICATION_NOTIFICATIONS
 * @returns {{title: string, body: string, type: string, route: string, data: object}}
 */
const buildApplicationNotification = (application, event) => {
  const template = STORE_APPLICATION_NOTIFICATIONS[event];
  if (!template) {
    throw new Error(`Unknown store notification event '${event}'`);
  }

  const storeName =
    (application && application.storeInfo && application.storeInfo.name) ||
    (application && application.businessInfo && application.businessInfo.legalName) ||
    'your store';

  return {
    title: fill(template.title, { storeName }),
    body: fill(template.body, { storeName }),
    type: template.type,
    route: template.route,
    data: {
      type: template.type,
      applicationId: application ? String(application._id) : '',
      status: application ? application.status : '',
      vertical: 'stores',
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    },
  };
};

/**
 * Deliver a notification to every token registered for a user.
 *
 * Resolves with a DETAILED result and NEVER throws for expected operating states. A
 * push subsystem failure must not roll back the business action that triggered it.
 *
 * @param {object|string} userId      a User id
 * @param {object|string} application a StoreOnboarding document (for the template)
 * @param {string}        event       the event key
 * @returns {Promise<{sent:boolean, reason?:string, tokenCount:number, checked:number}>}
 */
const dbReady = () => mongoose.connection.readyState === 1;

const deliverPush = async (userId, payload) => {
  if (!dbReady()) {
    return { sent: false, reason: 'no_db', tokenCount: 0, checked: 0 };
  }

  let tokens;
  try {
    tokens = await PushNotificationToken.find({ user: new mongoose.Types.ObjectId(String(userId)) })
      .select('token')
      .lean()
      .map((t) => t.token);
  } catch {
    tokens = [];
  }

  if (!tokens.length) {
    return { sent: false, reason: 'no_token', tokenCount: 0, checked: 0 };
  }

  if (!adminReady()) {
    return { sent: false, reason: 'no_admin_app', tokenCount: tokens.length, checked: 0 };
  }

  try {
    const result = await admin.messaging().sendEachForMulticast({
      notification: { title: payload.title, body: payload.body },
      data: payload.data,
      android: { priority: 'high', notification: { channelId: 'high_importance_channel', clickAction: 'FLUTTER_NOTIFICATION_CLICK' } },
      tokens,
    });
    return { sent: result.successCount > 0, reason: result.successCount ? undefined : 'send_failed', tokenCount: tokens.length, checked: result.successCount + result.failureCount };
  } catch {
    return { sent: false, reason: 'send_failed', tokenCount: tokens.length, checked: 0 };
  }
};

const notifyApplication = async (userId, application, event) => {
  let payload;
  try {
    payload = buildApplicationNotification(application, event);
  } catch (error) {
    // An unknown event key is a bug in the CALLER. Surfacing 'unknown_event' rather than
    // throwing keeps the onboarding transaction alive; the retry for the caller's own
    // call site should be the one that throws.
    return { sent: false, reason: 'unknown_event', tokenCount: 0, checked: 0 };
  }

  return deliverPush(userId, payload);
};

/**
 * Payment and lifecycle events that carry money. Same delivery contract as the
 * application events above: a failed push never fails the payment that
 * already happened, and no token is a normal operating state, not an error.
 */
const STORE_PAYMENT_NOTIFICATIONS = Object.freeze({
  order_payment_received: {
    type: 'store.order.payment_received',
    title: 'Payment received',
    body: 'Payment of {{amount}} for order {{orderNo}} is confirmed. The store has been notified.',
    route: '/orders',
  },
  subscription_payment_received: {
    type: 'store.subscription.payment_received',
    title: 'Subscription payment confirmed',
    body: 'Payment of {{amount}} is confirmed. Your store subscription stays active.',
    route: '/subscription',
  },
});

const buildStoreEventNotification = (event, context = {}) => {
  const template = STORE_PAYMENT_NOTIFICATIONS[event];
  if (!template) {
    throw new Error(`Unknown store notification event '${event}'`);
  }
  return {
    title: fill(template.title, context),
    body: fill(template.body, context),
    type: template.type,
    route: template.route,
    data: {
      type: template.type,
      vertical: 'stores',
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    },
  };
};

/**
 * Deliver a stores money-event notification. Never throws for expected
 * operating states (no token, no admin SDK, send failure) — the payment
 * already happened and must not be rolled back by a push failure.
 */
const notifyStoreEvent = async (userId, event, context = {}) => {
  let payload;
  try {
    payload = buildStoreEventNotification(event, context);
  } catch {
    return { sent: false, reason: 'unknown_event', tokenCount: 0, checked: 0 };
  }

  return deliverPush(userId, payload);
};

const STORE_ORDER_NOTIFICATIONS = Object.freeze({
  new_order: {
    type: 'store.order.new',
    title: 'New order {{orderNo}}',
    body: '{{outletName}} has a new order worth {{amount}}. Accept it in Orders.',
    route: '/orders',
    audience: ['partner'],
  },
  order_accepted: {
    type: 'store.order.accepted',
    title: 'Order {{orderNo}} accepted',
    body: '{{outletName}} accepted your order. We will tell you when it is ready.',
    route: '/orders',
    audience: ['customer'],
  },
  order_rejected: {
    type: 'store.order.rejected',
    title: 'Order {{orderNo}} declined',
    body: '{{outletName}} could not take your order. {{reason}}',
    route: '/orders',
    audience: ['customer'],
  },
  order_ready: {
    type: 'store.order.ready',
    title: 'Order {{orderNo}} is ready',
    body: '{{outletName}} has packed your order and it is waiting for pickup.',
    route: '/orders',
    audience: ['customer'],
  },
  driver_assigned: {
    type: 'store.order.driver_assigned',
    title: 'Driver assigned to order {{orderNo}}',
    body: '{{driverName}} will deliver your order from {{outletName}}.',
    route: '/orders',
    audience: ['customer', 'driver'],
  },
  driver_on_the_way: {
    type: 'store.order.driver_on_the_way',
    title: 'Driver is on the way',
    body: '{{driverName}} has accepted order {{orderNo}} and is on the way to {{outletName}}.',
    route: '/orders',
    audience: ['customer'],
  },
  out_for_delivery: {
    type: 'store.order.out_for_delivery',
    title: 'Order {{orderNo}} is out for delivery',
    body: 'Your order from {{outletName}} is on the way.',
    route: '/orders',
    audience: ['customer'],
  },
  order_delivered: {
    type: 'store.order.delivered',
    title: 'Order {{orderNo}} delivered',
    body: 'Order {{orderNo}} from {{outletName}} has been delivered.',
    route: '/orders',
    audience: ['customer', 'partner'],
  },
  order_cancelled: {
    type: 'store.order.cancelled',
    title: 'Order {{orderNo}} cancelled',
    body: 'Order {{orderNo}} from {{outletName}} was cancelled. {{reason}}',
    route: '/orders',
    audience: ['customer', 'partner'],
  },
  payment_failed: {
    type: 'store.order.payment_failed',
    title: 'Payment failed for order {{orderNo}}',
    body: 'We could not confirm payment for your order from {{outletName}}. Please retry in the app.',
    route: '/orders',
    audience: ['customer'],
  },
  delivery_failed: {
    type: 'store.order.delivery_failed',
    title: 'Delivery failed for order {{orderNo}}',
    body: 'Delivery for order {{orderNo}} from {{outletName}} could not be completed. {{reason}}',
    route: '/orders',
    audience: ['customer', 'partner'],
  },
});

const buildOrderNotification = async (order, event, context = {}) => {
  const template = STORE_ORDER_NOTIFICATIONS[event];
  if (!template) throw new Error(`Unknown store order notification event '${event}'`);

  let title = template.title;
  let body = template.body;

  if (dbReady()) {
    try {
      const translation = await mongoose
        .model('OrderNotificationTranslation')
        .findOne({ slug: `store_${event}` })
        .lean();
      const first = Array.isArray(translation?.translations) ? translation.translations[0] : null;
      if (first?.title) title = first.title;
      if (first?.description) body = first.description;
    } catch {
      // A missing translation collection or row falls back to the built-in English text.
    }
  }

  let outletName = context.outletName;
  if (!outletName && order.outlet && dbReady()) {
    try {
      const outlet = await mongoose.model('StoreOutlet').findById(order.outlet).select('name').lean();
      outletName = outlet?.name;
    } catch {
      outletName = undefined;
    }
  }

  const reason = context.reason ? `Reason: ${context.reason}` : '';
  const values = {
    orderNo: order.orderNo != null ? String(order.orderNo) : '',
    outletName: outletName || 'The store',
    amount: order.grandTotal != null ? `INR ${order.grandTotal}` : '',
    driverName: context.driverName || 'Your driver',
    reason,
  };

  return {
    title: fill(title, values),
    body: fill(body, values),
    type: template.type,
    route: template.route,
    audience: template.audience,
    data: {
      type: template.type,
      orderId: order._id ? String(order._id) : '',
      orderNo: values.orderNo,
      lifecycle: order.lifecycle || '',
      vertical: 'stores',
      route: template.route,
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    },
  };
};

const resolveOrderRecipients = async (order, audience = []) => {
  if (!dbReady()) return [];

  const ids = new Set();

  if (audience.includes('customer') && order.customer) {
    ids.add(String(order.customer));
  }

  if (audience.includes('partner') && order.chain) {
    try {
      const assignments = await mongoose
        .model('StoreRoleAssignment')
        .find({
          chain: order.chain,
          status: 'active',
          role: { $in: ['owner', 'manager', 'order_manager', 'dispatcher'] },
          $or: [
            { scopeType: 'chain' },
            { scopeType: 'business' },
            { scopeType: 'outlet', outlets: order.outlet },
          ],
        })
        .select('user')
        .lean();
      assignments.forEach((row) => {
        if (row.user) ids.add(String(row.user));
      });
    } catch {
      // No assignment collection means no partner recipient, not a failed order.
    }
  }

  if (audience.includes('driver') && order._id) {
    try {
      const delivery = await mongoose
        .model('StoreDelivery')
        .findOne({ order: order._id })
        .select('driver')
        .lean();
      if (delivery?.driver) {
        const driver = await mongoose
          .model('StoreDriver')
          .findById(delivery.driver)
          .select('user')
          .lean();
        if (driver?.user) ids.add(String(driver.user));
      }
    } catch {
      // Delivery can be absent for pickup orders.
    }
  }

  return Array.from(ids);
};

const notifyOrderLifecycle = async (order, event, context = {}) => {
  if (!order) return { sent: false, reason: 'no_order', recipients: 0, results: [] };

  let payload;
  try {
    payload = await buildOrderNotification(order, event, context);
  } catch {
    return { sent: false, reason: 'unknown_event', recipients: 0, results: [] };
  }

  const recipients = await resolveOrderRecipients(order, payload.audience);
  const results = [];

  for (const userId of recipients) {
    let feedWritten = false;
    try {
      await mongoose.model('NotificationList').create({
        user: userId,
        title: payload.title,
        content: payload.body,
        payload: { ...payload.data, route: payload.route },
        kind: 'store_order',
        order: order._id ? String(order._id) : '',
      });
      feedWritten = true;
    } catch {
      feedWritten = false;
    }

    const push = await deliverPush(userId, payload);
    results.push({ userId, feedWritten, ...push });
  }

  return {
    sent: results.some((row) => row.sent),
    recipients: results.length,
    results,
  };
};

module.exports = {
  STORE_APPLICATION_NOTIFICATIONS,
  STORE_PAYMENT_NOTIFICATIONS,
  STORE_ORDER_NOTIFICATIONS,
  buildApplicationNotification,
  buildStoreEventNotification,
  buildOrderNotification,
  fill,
  notifyApplication,
  notifyStoreEvent,
  notifyOrderLifecycle,
  adminReady,
};