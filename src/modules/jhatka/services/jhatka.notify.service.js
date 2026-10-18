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

/**
 * jhatka.notify.service.js — Jhatka's application of the shared push path.
 *
 * ## Why this file exists
 *
 * The implementation plan listed "~22 jhatka event functions" as additions to
 * `src/services/fcm.notification.service.js`. That was the wrong shape, and the plan
 * was wrong for the same reason `stores.notify.service.js` exists: the shared FCM
 * service is a 4,000-line file in which every event hard-codes its title, body,
 * user lookup and token lookup. Adding 22 more vertical-specific events to it makes
 * it larger and changes nothing about how a message is composed.
 *
 * So this is the stores shape copied deliberately: templates are DATA, one function
 * delivers them, and the shared file is not touched at all.
 *
 * ## The defect this closes
 *
 * Every Jhatka notification was previously a WRITE WITH NO DELIVERY. `BR-17` says an
 * unfulfillable subscription occurrence must "notify the customer, record the reason"
 * and must never skip silently. `§3.8` says the weight confirmation is a push
 * notification. `§12.4` says compliance expiry warns at 30 and 7 days. `§5.4` says a
 * recall notifies affected customers. All four wrote a database record — a
 * `JhatkaSubscriptionEvent`, a `recall.affectedCustomers` array, a `notifiedCount` —
 * and dispatched nothing.
 *
 * The worst of these was the recall: `recall.notifiedCount` was set to
 * `affectedCustomers.length`, i.e. the count of people we INTENDED to notify, and it
 * is the field an operator reads to decide whether the recall is finished. It claimed
 * notifications that had never been sent. `markNotified()` below is the only thing
 * allowed to write that field, and it writes it from what the transport returned.
 *
 * ## Invariants, on purpose
 *
 *   1. A failed push NEVER fails the business operation. The order is weighed, the
 *      batch is quarantined, the subscription is paused — those happened. Losing the
 *      push must not undo them.
 *   2. No token is not an error. A partner on a desktop, or a customer who has not
 *      opened the app since installing it, simply does not get a push.
 *   3. No Firebase admin app is not an error. Dev and staging have no service
 *      account; that is a configuration state, not a business failure.
 *   4. The caller is told what actually happened. Every deliverer resolves with a
 *      result describing what the TRANSPORT did, never what we hoped it would do.
 */

const mongoose = require('mongoose');
const admin = require('firebase-admin');
const { PushNotificationToken } = require('../../../models');
const { asMoney } = require('../utils/money');

/**
 * Every customer-facing Jhatka message, as data.
 *
 * `type` is the discriminator stored on the FCM payload and read by the Flutter
 * handler; `route` is the deep link inside the customer app. Keeping both here means
 * the app and the backend cannot disagree about which screen an event opens.
 *
 * Two of these carry the whole weight of a frozen business rule rather than a
 * courtesy:
 *
 *   - `weight_confirmed` is §3.8's answer to "customer approval". The customer is
 *     never asked to approve anything (§3.8: the meat is bagged before a rider
 *     exists). The message exists so the number at the door is the number they were
 *     told, and it must say plainly that they were NOT charged the difference.
 *   - `subscription_stock_failure` is BR-17's "never skip silently". It is the
 *     only channel by which a customer learns their week was not delivered.
 */
const JHATKA_CUSTOMER_NOTIFICATIONS = Object.freeze({
  order_paid: {
    type: 'jhatka.order.paid',
    title: 'Payment received',
    body: 'We have your payment for order {{orderNo}}. {{outletName}} is preparing it now.',
    route: '/jhatka/orders',
  },
  order_outlet_received: {
    type: 'jhatka.order.outlet_received',
    title: '{{outletName}} has your order',
    body: 'Order {{orderNo}} is at the counter. We will tell you the final weight before it leaves.',
    route: '/jhatka/tracking',
  },
  order_accepted: {
    type: 'jhatka.order.accepted',
    title: 'Order accepted',
    body: '{{outletName}} accepted order {{orderNo}}.',
    route: '/jhatka/tracking',
  },
  order_preparing: {
    type: 'jhatka.order.preparing',
    title: 'Being prepared',
    body: 'Order {{orderNo}} is being cut and prepared now.',
    route: '/jhatka/tracking',
  },
  weight_confirmed: {
    type: 'jhatka.order.weight_confirmed',
    title: 'Final weight confirmed',
    body:
      'Order {{orderNo}} weighs {{actualWeight}}. ' +
      'You were charged {{chargedAmount}} — {{adjustmentNote}}',
    route: '/jhatka/tracking',
  },
  order_packed: {
    type: 'jhatka.order.packed',
    title: 'Packed and cold',
    body: 'Order {{orderNo}} is packed and ready to go.',
    route: '/jhatka/tracking',
  },
  out_for_delivery: {
    type: 'jhatka.order.out_for_delivery',
    title: 'On the way',
    body: 'Order {{orderNo}} is out for delivery.',
    route: '/jhatka/tracking',
  },
  order_delivered: {
    type: 'jhatka.order.delivered',
    title: 'Delivered',
    body: 'Order {{orderNo}} was delivered. Keep it refrigerated and use within {{useWithin}}.',
    route: '/jhatka/tracking',
  },
  order_rejected: {
    type: 'jhatka.order.rejected',
    title: 'Order could not be fulfilled',
    body: '{{outletName}} could not fulfil order {{orderNo}}. {{reason}} Your refund is on its way.',
    route: '/jhatka/orders',
  },
  order_cancelled: {
    type: 'jhatka.order.cancelled',
    title: 'Order cancelled',
    body: 'Order {{orderNo}} was cancelled. {{refundNote}}',
    route: '/jhatka/orders',
  },
  /**
   * A payment FAILED. Distinct from `order_cancelled` because the order is still
   * there: the customer can retry, and the message has to read as an invitation to do
   * so rather than as a loss.
   */
  order_payment_failed: {
    type: 'jhatka.order.payment_failed',
    title: 'Payment for order {{orderNo}} did not go through',
    body: '{{reason}} Your order is still saved — you can try paying again.',
    route: '/jhatka/orders',
  },
  /**
   * The LAST refund on the order settled. Sent when the ORDER reaches REFUNDED, not
   * per-refund: a weight order with three line refunds must not text the customer
   * three times for what is, to them, one event.
   */
  order_refund_completed: {
    type: 'jhatka.order.refund_completed',
    title: 'Refund completed for order {{orderNo}}',
    body: 'Every refund on this order has been settled. The amounts are in your order history.',
    route: '/jhatka/orders',
  },
  weight_adjustment_refunded: {
    type: 'jhatka.order.weight_refunded',
    title: 'Refund processed for order {{orderNo}}',
    body: 'We weighed {{actualWeight}} against the {{requestedWeight}} you asked for and refunded {{refundAmount}}.',
    route: '/jhatka/orders',
  },
  order_on_hold: {
    type: 'jhatka.order.on_hold',
    title: 'Order {{orderNo}} is on hold',
    body: 'We have paused order {{orderNo}} for a quality check. {{reason}} We will call you if anything changes.',
    route: '/jhatka/tracking',
  },
  subscription_active: {
    type: 'jhatka.subscription.active',
    title: 'Subscription active',
    body: 'Your {{scheduleText}} delivery of {{itemSummary}} starts on {{startDate}}.',
    route: '/jhatka/subscriptions',
  },
  subscription_paused: {
    type: 'jhatka.subscription.paused',
    title: 'Subscription paused',
    body: 'Your {{itemSummary}} subscription is paused. {{reason}}',
    route: '/jhatka/subscriptions',
  },
  subscription_resumed: {
    type: 'jhatka.subscription.resumed',
    title: 'Subscription resumed',
    body: 'Your {{itemSummary}} subscription is active again.',
    route: '/jhatka/subscriptions',
  },
  subscription_cancelled: {
    type: 'jhatka.subscription.cancelled',
    title: 'Subscription cancelled',
    body: 'Your {{itemSummary}} subscription is cancelled. {{refundNote}}',
    route: '/jhatka/subscriptions',
  },
  subscription_stock_failure: {
    type: 'jhatka.subscription.stock_failure',
    title: '{{deliveryDate}} delivery could not be arranged',
    body:
      'We could not fulfil your {{itemSummary}} subscription for {{deliveryDate}}. ' +
      '{{reason}} Nothing has been charged. {{escalationNote}}',
    route: '/jhatka/subscriptions',
  },
  /**
   * A PREPAID occurrence is ready to be charged (§9.5).
   *
   * The amount is named as a CEILING and not as a price, because that is what it is:
   * the customer is quoted the top of the band and is never reconciled afterwards. If
   * this message said "your delivery costs X" and the meat came in at 0.9 kg, the
   * first thing a customer would do is ask for the difference — and §3.3's answer is
   * that there is no difference to give.
   */
  subscription_payment_due: {
    type: 'jhatka.subscription.payment_due',
    title: 'Pay {{amount}} for your {{deliveryDate}} delivery',
    body:
      'Your {{itemSummary}} subscription is prepaid, so the {{deliveryDate}} delivery ' +
      'needs paying first. The amount is the maximum for the weight you asked for — ' +
      'you are not charged more than this.',
    route: '/jhatka/subscriptions',
  },
  subscription_payment_reminder: {
    type: 'jhatka.subscription.payment_reminder',
    title: 'Still waiting on payment for {{deliveryDate}}',
    body:
      'Your {{itemSummary}} subscription for {{deliveryDate}} has not been paid yet. ' +
      'If we do not receive payment we will skip that delivery and credit the amount back.',
    route: '/jhatka/subscriptions',
  },
  subscription_price_changed: {
    type: 'jhatka.subscription.price_changed',
    title: 'Price change on your subscription',
    body: 'The price of {{itemSummary}} has changed to {{newPrice}}. Reply to this to continue, or your subscription pauses.',
    route: '/jhatka/subscriptions',
  },
  recall_notice: {
    type: 'jhatka.recall.notice',
    title: 'A batch you ordered is being recalled',
    body: 'Order {{orderNo}} included a batch we are recalling ({{batchNo}}). {{reason}} {{actionNote}}',
    route: '/jhatka/orders',
  },
  compliance_expiry: {
    type: 'jhatka.compliance.expiry',
    title: '{{documentName}} expires in {{daysLeft}} days',
    body: 'Your {{documentName}} expires on {{expiryDate}}. Upload a renewal to keep trading.',
    route: '/jhatka/settings',
  },
  complaint_raised: {
    type: 'jhatka.complaint.raised',
    title: 'We have your complaint',
    body: 'Complaint {{complaintNo}} on order {{orderNo}} is logged. We will call you within {{responseWindow}}.',
    route: '/jhatka/support',
  },
});

/** What the outlet and its staff hear. `route` points into the Partner app. */
const JHATKA_OUTLET_NOTIFICATIONS = Object.freeze({
  new_order: {
    type: 'jhatka.outlet.new_order',
    title: 'New order {{orderNo}}',
    body: '{{customerName}} ordered {{itemSummary}} for {{estimatedTotal}}. Accept before {{acceptBy}}.',
    route: '/jhatka/orders',
  },
  order_paid: {
    type: 'jhatka.outlet.order_paid',
    title: 'Order {{orderNo}} is paid',
    body: '{{estimatedTotal}} received for {{customerName}}. Start preparation when ready.',
    route: '/jhatka/orders',
  },
  weight_override_requested: {
    type: 'jhatka.outlet.weight_override',
    title: 'Manager override needed on order {{orderNo}}',
    body: 'A weigher reported {{actualWeight}} against {{requestedWeight}} requested. A manager must approve or re-weigh.',
    route: '/jhatka/weigh',
  },
  weight_variance_flagged: {
    type: 'jhatka.outlet.weight_variance',
    title: 'Weight variance flagged on order {{orderNo}}',
    body: 'A {{deviationPct}}% variance was overridden. This is the third this week — check the scale.',
    route: '/jhatka/orders',
  },
  stock_low: {
    type: 'jhatka.outlet.stock_low',
    title: '{{productName}} is low',
    body: '{{available}} left, below the reorder level of {{reorderLevel}}.',
    route: '/jhatka/inventory',
  },
  batch_expiring: {
    type: 'jhatka.outlet.batch_expiring',
    title: 'Batch {{batchNo}} expires today',
    body: '{{available}} of {{productName}} will be written off at close of business.',
    route: '/jhatka/inventory',
  },
  batch_quarantined: {
    type: 'jhatka.outlet.batch_quarantined',
    title: 'Batch {{batchNo}} is quarantined',
    body: '{{productName}} is off sale. {{reason}}',
    route: '/jhatka/inventory',
  },
  delivery_assigned: {
    type: 'jhatka.outlet.delivery_assigned',
    title: 'Rider assigned for {{orderNo}}',
    body: '{{driverName}} is collecting {{codAmount}} for order {{orderNo}}.',
    route: '/jhatka/delivery',
  },
  cold_chain_breach: {
    type: 'jhatka.outlet.cold_chain_breach',
    title: 'Cold-chain breach on order {{orderNo}}',
    body: 'Packed at {{pickedUpTemp}}°C, delivered at {{deliveredTemp}}°C. A complaint has been raised automatically.',
    route: '/jhatka/delivery',
  },
  compliance_expiry: {
    type: 'jhatka.outlet.compliance_expiry',
    title: '{{documentName}} expires in {{daysLeft}} days',
    body: 'Trading is blocked once this lapses. Upload the renewal today.',
    route: '/jhatka/compliance',
  },
  compliance_blocked: {
    type: 'jhatka.outlet.compliance_blocked',
    title: 'New orders are blocked',
    body: '{{documentName}} expired on {{expiryDate}}. Existing orders will still be delivered.',
    route: '/jhatka/compliance',
  },
  recall_opened: {
    type: 'jhatka.outlet.recall_opened',
    title: 'Recall opened on batch {{batchNo}}',
    body: '{{affectedOrders}} order(s) affected, {{heldOrders}} placed on hold. {{reason}}',
    route: '/jhatka/recalls',
  },
  payout_processed: {
    type: 'jhatka.outlet.payout',
    title: 'Payout {{payoutNo}} processed',
    body: '{{netPayout}} for {{periodLabel}} has been sent by {{payoutMethod}}.',
    route: '/jhatka/payouts',
  },
  payout_rolled_forward: {
    type: 'jhatka.outlet.payout_rollforward',
    title: 'Payout {{payoutNo}} carried forward',
    body: '{{netAmount}} is below the {{minimumNetPayout}} floor, so it moves to the next period rather than transferring.',
    route: '/jhatka/payouts',
  },
  subscription_due: {
    type: 'jhatka.outlet.subscription_due',
    title: '{{count}} subscription order(s) for tomorrow',
    body: 'Confirm you can cut {{itemSummary}} by {{cutoff}}. Stock failures pause subscriptions automatically.',
    route: '/jhatka/subscriptions',
  },
  subscription_stock_shortage: {
    type: 'jhatka.outlet.subscription_stock_shortage',
    title: 'Could not fulfil {{itemSummary}} for {{deliveryDate}}',
    body:
      'A prepaid subscription was short on stock and has been skipped. ' +
      '{{consecutiveFailures}} consecutive failure(s) so far. Buy or substitute before the next run.',
    route: '/jhatka/subscriptions',
  },
});

/** Lightweight template fill. Strings only, braces are an exact replace. */
const fill = (template, context = {}) =>
  String(template == null ? '' : template).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    const value = context[key];
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
  });

/**
 * Render a notification WITHOUT sending it.
 *
 * Exported so the in-app feed and the push are composed from one template and cannot
 * disagree, and so a caller that has its own delivery channel (an email, an SMS) can
 * take the same text.
 *
 * @param {'customer'|'outlet'} audience
 * @param {string} event key into JHATKA_CUSTOMER_NOTIFICATIONS / _OUTLET_NOTIFICATIONS
 * @param {object} context template variables
 * @returns {{title: string, body: string, type: string, route: string, data: object}}
 */
const buildNotification = (audience, event, context = {}) => {
  const table = audience === 'outlet' ? JHATKA_OUTLET_NOTIFICATIONS : JHATKA_CUSTOMER_NOTIFICATIONS;
  const template = table[event];
  if (!template) throw new Error(`Unknown jhatka notification event '${event}'`);

  return {
    title: fill(template.title, context),
    body: fill(template.body, context),
    type: template.type,
    route: template.route,
    data: {
      ...context,
      type: template.type,
      event,
      audience,
      vertical: 'jhatka',
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    },
  };
};

/**
 * True only when the Firebase admin SDK has somewhere to send a message.
 *
 * Dev and staging have no service account, and every `admin.messaging()` call there
 * throws "The default Firebase app does not exist." That is a configuration state, not
 * a business failure, so it surfaces as a deliberate skip rather than an exception.
 */
const adminReady = () => {
  try {
    return !!admin.app();
  } catch {
    return false;
  }
};

/** Every push token registered for a user. An empty array is a normal outcome. */
const tokensFor = async (userId) => {
  if (!userId) return [];
  try {
    const rows = await PushNotificationToken.find({ user: new mongoose.Types.ObjectId(String(userId)) })
      .select('token')
      .lean();
    return rows.map((t) => t.token).filter(Boolean);
  } catch {
    return [];
  }
};

/**
 * The single delivery primitive. Everything else in this file composes onto it.
 *
 * Resolves with what the TRANSPORT did. Never throws for an expected operating
 * state, and never for an unexpected one either — the caller is a business service
 * mid-transaction, and an FCM outage is not a reason to fail a weighed order.
 *
 * @returns {Promise<{sent: boolean, reason: string, attempted: number, delivered: number}>}
 */
const deliver = async (userIds, payload) => {
  const recipients = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean).map(String))];
  if (!recipients.length) return { sent: false, reason: 'no_recipient', attempted: 0, delivered: 0 };

  let tokens = [];
  for (const id of recipients) {
    tokens = tokens.concat(await tokensFor(id));
  }
  const unique = [...new Set(tokens)];
  if (!unique.length) return { sent: false, reason: 'no_token', attempted: recipients.length, delivered: 0 };

  if (!adminReady()) {
    return { sent: false, reason: 'no_admin_app', attempted: recipients.length, delivered: 0 };
  }

  try {
    const result = await admin.messaging().sendEachForMulticast({
      notification: { title: payload.title, body: payload.body },
      data: payload.data,
      android: {
        priority: 'high',
        notification: { channelId: 'high_importance_channel', clickAction: 'FLUTTER_NOTIFICATION_CLICK' },
      },
      tokens: unique,
    });
    return {
      sent: result.successCount > 0,
      reason: result.successCount > 0 ? 'sent' : 'send_failed',
      attempted: unique.length,
      delivered: result.successCount,
    };
  } catch {
    return { sent: false, reason: 'send_failed', attempted: unique.length, delivered: 0 };
  }
};

/**
 * Notify one customer about one event.
 *
 * @param {string} userId
 * @param {string} event  a key of JHATKA_CUSTOMER_NOTIFICATIONS
 * @param {object} context template variables
 * @returns {Promise<{sent: boolean, reason: string}>}
 */
const notifyCustomer = async (userId, event, context = {}) => {
  let payload;
  try {
    payload = buildNotification('customer', event, context);
  } catch {
    return { sent: false, reason: 'unknown_event' };
  }
  return deliver(userId, payload);
};

/**
 * Notify every active staff member of an outlet.
 *
 * Staff are resolved from `JhatkaTenantRoleAssignment`, NOT from a driver or owner
 * list, so a person who has been removed from the outlet stops receiving its orders.
 * `status` and `endedAt` are both honoured: a role that ended yesterday must not be
 * told about today's recalls.
 *
 * @param {string} outletId
 * @param {string} event
 * @param {object} context
 * @returns {Promise<{sent: boolean, reason: string, recipients: number}>}
 */
const notifyOutlet = async (outletId, event, context = {}) => {
  if (!outletId) return { sent: false, reason: 'no_recipient', recipients: 0 };

  let payload;
  try {
    payload = buildNotification('outlet', event, context);
  } catch {
    return { sent: false, reason: 'unknown_event', recipients: 0 };
  }

  let JhatkaTenantRoleAssignment;
  try {
    JhatkaTenantRoleAssignment = mongoose.model('JhatkaTenantRoleAssignment');
  } catch {
    return { sent: false, reason: 'model_unavailable', recipients: 0 };
  }

  let assignments;
  try {
    assignments = await JhatkaTenantRoleAssignment.find({
      status: 'active',
      outlets: outletId,
    })
      .select('user')
      .lean();
  } catch {
    return { sent: false, reason: 'lookup_failed', recipients: 0 };
  }

  const now = new Date();
  const userIds = assignments
    .filter((a) => a && a.user && (!a.endedAt || new Date(a.endedAt) > now))
    .map((a) => String(a.user));

  const result = await deliver(userIds, payload);
  return { ...result, recipients: userIds.length };
};

/**
 * Notify a set of customers — the recall fan-out, §5.4.
 *
 * ## Why this exists and what it refuses to do
 *
 * §5.4 is explicit: "Without `affectedCustomers` written down, 'we notified everyone'
 * is not a claim anyone can verify." The record is written; nothing was dispatched.
 *
 * The important part is what this does NOT do. It does not set `notifiedCount` itself
 * and it does not mark `notifiedAt`. The caller owns those, because only the caller
 * knows whether it has finished walking the whole affected set — a recall with 4,000
 * affected customers needs chunking and a resumable cursor, and a function that
 * quietly marked the first 500 as notified would turn a partial recall into a
 * permanent lie. See `markNotified` below for the only permitted writer.
 *
 * @param {Array<object>} affected `{ customer, order, deliveredAt }` entries
 * @param {object} context template variables shared by every recipient
 * @param {number} [batchSize] FCM accepts ~500 tokens per multicast; stay under it.
 * @returns {Promise<{attempted: number, delivered: number, failures: object[], reason: string}>}
 */
const notifyAffectedCustomers = async (affected, context = {}, batchSize = 400) => {
  const entries = (affected || []).filter((a) => a && a.customer);
  const summary = {
    attempted: 0,
    delivered: 0,
    deliveredCustomers: [],
    failures: [],
    reason: 'sent',
  };

  if (!entries.length) return { ...summary, reason: 'no_recipient' };

  let payload;
  try {
    payload = buildNotification('customer', 'recall_notice', context);
  } catch {
    return { ...summary, reason: 'unknown_event' };
  }

  if (!adminReady()) {
    // Reported as a failure for every recipient, never as a success. `no_admin_app`
    // is a configuration state, but it is NOT a delivered notification, and the
    // recall's notifiedCount must reflect that.
    return {
      attempted: entries.length,
      delivered: 0,
      deliveredCustomers: [],
      failures: entries.map((a) => ({ customer: String(a.customer), reason: 'no_admin_app' })),
      reason: 'no_admin_app',
    };
  }

  for (let i = 0; i < entries.length; i += batchSize) {
    const slice = entries.slice(i, i + batchSize);
    const userIds = slice.map((a) => String(a.customer));
    const perUser = await deliver(userIds, payload);

    summary.attempted += slice.length;
    summary.delivered += perUser.delivered || 0;

    if (perUser.reason === 'sent') {
      summary.deliveredCustomers = summary.deliveredCustomers.concat(userIds);
    } else {
      summary.reason = perUser.reason;
      summary.failures.push({ batch: i / batchSize, reason: perUser.reason, count: slice.length });
    }
  }

  return summary;
};

/**
 * The ONLY permitted writer of `recall.notifiedCount`.
 *
 * §5.4 made this field the operator's proof that a recall was communicated, and the
 * first implementation wrote `affectedCustomers.length` into it — the number we
 * intended to reach — before a single message left the process. An operator closing a
 * recall reads that field.
 *
 * So the rule is that it reflects what the TRANSPORT returned, never the size of the
 * input. A partial fan-out writes a partial number. That is uncomfortable and it is
 * correct: an under-reported recall gets finished, a over-reported one does not.
 *
 * @param {object} recall a JhatkaRecall document (saved by the caller)
 * @param {{attempted: number, delivered: number, reason: string}} result
 */
const markNotified = (recall, result) => {
  if (!recall) return recall;
  recall.notifiedCount = Number((result && result.delivered) || 0);
  recall.notificationAttemptedCount = Number((result && result.attempted) || 0);
  if (result && result.reason && result.reason !== 'sent') {
    recall.notificationFailureReason = result.reason;
  }
  return recall;
};

/**
 * Build the `weight_confirmed` context from a finished weigh.
 *
 * §3.3 is the rule this exists to state in plain language to a customer: inside the
 * tolerance band nothing happened; above it LocalWala absorbed the difference; below
 * it they are being refunded. The `adjustmentNote` is generated from the SAME numbers
 * the weigh service computed, so the message cannot claim an outcome the money did not
 * produce.
 *
 * ## UNITS — and the 100x bug this function had
 *
 * `@param {object} order` must be a HYDRATED document. A `moneyField` getter returns
 * RUPEES, so `order.paidAmount` here is already rupees.
 *
 * The first version ran it through `asMoney()` on the way into the template. `asMoney`
 * is paise -> rupees, so a ₹400 order was described to the customer as ₹4. This is
 * exactly the defect `utils/money.js` exists to prevent, written by the person who had
 * just read that file, and it was caught by the integration assertion
 * `...and still quotes what was charged` rather than by review.
 *
 * `summary.absorbedPaise` / `summary.refundedPaise` ARE paise — they come straight off
 * the weigh service's running PAISE totals — so those two DO go through `asMoney`. The
 * asymmetry is deliberate and is the whole reason the field names carry units.
 *
 * @param {object} summary `{ absorbedPaise, refundedPaise, toleranceApplied, actualGrams }`
 */
const buildWeightConfirmationContext = (order, summary = {}) => {
  const charged = Number(order?.paidAmount ?? order?.estimatedTotal ?? 0);
  const absorbedPaise = Number(summary.absorbedPaise || 0);
  const refundedPaise = Number(summary.refundedPaise || 0);

  let adjustmentNote = `You were charged the estimate, ${charged.toFixed(2)}.`;
  if (refundedPaise > 0) {
    adjustmentNote =
      `You were charged the estimate, ${charged.toFixed(2)}, and ${asMoney(refundedPaise)} is being refunded.`;
  } else if (absorbedPaise > 0) {
    adjustmentNote =
      `The extra ${asMoney(absorbedPaise)} is on us — you were charged the estimate, ${charged.toFixed(2)}.`;
  } else if (summary.toleranceApplied) {
    adjustmentNote = 'The weight was within tolerance, so nothing changed.';
  }

  return {
    orderNo: order?.orderNo,
    outletName: order?.outletSnapshot?.name,
    actualWeight: summary.actualGrams ? `${(Number(summary.actualGrams) / 1000).toFixed(3)} kg` : '',
    chargedAmount: charged.toFixed(2),
    adjustmentNote,
  };
};

module.exports = {
  JHATKA_CUSTOMER_NOTIFICATIONS,
  JHATKA_OUTLET_NOTIFICATIONS,
  buildNotification,
  notifyCustomer,
  notifyOutlet,
  notifyAffectedCustomers,
  markNotified,
  buildWeightConfirmationContext,
  _internal: { fill, deliver, adminReady, tokensFor },
};