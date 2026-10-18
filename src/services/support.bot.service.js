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

const mongoose = require('mongoose');
const {
  SupportChatConversion,
  SupportChatRoom,
  Orders,
  DiningBooking,
  UserPurchasedTiffinSubscription,
  Complaints,
  CannedResponse,
  PaymentInitiation,
} = require('../models');

// Rule-based intent detection (no LLM dependency for v1).
// Returns { intent, confidence }.
// payment_failed BEFORE refund: "payment failed" belongs to payments,
// generic "refund/where is my money" stays refund. refund_status answers
// "when/where is my refund" without re-triaging as a new failure.
const detectIntent = (text = '') => {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return { intent: 'greeting', confidence: 0.4 };
  if (/(money.*(deducted|debited|charged|gone)|paid.*(fail|deduct)|payment.*(fail|deduct|stuck|pending|not.*(confirm|success)|status)|upi.*(pending|fail|stuck)|wallet.*deduct|amount.*deduct|deducted.*(order|payment)|charged.*not.*(order|confirm)|check.*payment.*status)/.test(t))
    return { intent: 'payment_failed', confidence: 0.93 };
  // Issue taxonomy (order matters: specific before generic location/help).
  if (/(wrong.*(order|item|food|dish)|incorrect.*(order|item)|missing.*item|item.*missing|food.*(cold|spoiled|stale|bad)|bad.*quality|quality.*(bad|poor))/.test(t))
    return { intent: 'wrong_order', confidence: 0.9 };
  if (/(not.*(received|delivered|arrived)|never.*(arrived|came|received)|order.*not.*(come|came|arrive|deliver)|didn.?t.*(receive|get).*order|no.*order.*received)/.test(t))
    return { intent: 'not_received', confidence: 0.9 };
  if (/(restaurant.*(not.*respond|no.*respon|not.*accept|not.*confirm|ignoring)|no.*response.*restaurant|restaurant.*unreachable)/.test(t))
    return { intent: 'restaurant_no_response', confidence: 0.9 };
  if (/(rider.*(rude|behav|unreachable|not.*(pick|answer|respond)|late|complaint)|delivery.*(partner|boy|person).*(rude|unreachable|behav|late)|complaint.*(rider|delivery))/i.test(t))
    return { intent: 'rider_issue', confidence: 0.9 };
  if (/(refund.*(status|when|where|timeline|how long)|where.*refund|when.*refund|refund.*(initiated|processed))/.test(t))
    return { intent: 'refund_status', confidence: 0.9 };
  if (/(rider|delivery\s*(boy|partner|person|agent)|where.*(rider|delivery\s*person)|contact.*rider|call.*rider)/.test(t))
    return { intent: 'rider', confidence: 0.9 };
  // Booking variants route to the same tracker; snapshot kind shapes reply.
  if (/(where.*(booking|table|reservation|tiffin|subscription)|track.*(booking|tiffin)|booking.*(status|late|confirm)|tiffin.*status|wher.*my (booking|tiffin))/.test(t))
    return { intent: 'where_is_my_order', confidence: 0.9 };
  if (/(where.*(order|food)|track.*order|order.*(status|late|delay)|wher.*my order)/.test(t))
    return { intent: 'where_is_my_order', confidence: 0.92 };
  if (/(refund|money back|return.*(money|amount))/.test(t))
    return { intent: 'refund', confidence: 0.88 };
  if (/(cancel.*(order|booking|tiffin)|i want.*cancel)/.test(t))
    return { intent: 'cancel', confidence: 0.88 };
  if (/(coupon|promo|offer|discount|code)/.test(t)) return { intent: 'coupon', confidence: 0.85 };
  if (/(human|agent|person|real.*(person|human)|talk.*(human|agent)|handover|escalate)/.test(t))
    return { intent: 'handover', confidence: 0.95 };
  if (/^(hi|hello|hey|namaste|good (morning|evening|afternoon))\b/.test(t))
    return { intent: 'greeting', confidence: 0.8 };
  return { intent: 'unknown', confidence: 0.35 };
};

// Money is stored in paise; .lean() skips getters, so convert here.
// Without this the card shows 2000.00 for a Rs 20 order.
const paiseToRs = (v) => (v == null || v === '' ? null : Number((Number(v) / 100).toFixed(2)));

// Fetch live entity for orderSnapshot card. Never throws — returns null on miss.
const getLiveSnapshot = async (type, typeId) => {
  if (mongoose.connection.readyState !== 1) return null;
  try {
    if (!typeId || !mongoose.Types.ObjectId.isValid(typeId)) return null;
    const id = new mongoose.Types.ObjectId(typeId);
    if (type === 'orders') {
      const o = await Orders.findById(id)
        .select('orderNo status orderTo grandTotal totalAmount createdAt updatedAt driver restaurant')
        .populate('restaurant', 'name image')
        .lean();
      if (!o) return null;
      // Enterprise payment pre-questions: latest initiation for this order
      // (status/amount/method/gateway ids). Never throws — null on miss.
      let payment = null;
      try {
        const p = await PaymentInitiation.findOne({ orders: id })
          .sort({ updatedAt: -1 })
          .select('status amount paymentFrom payResponse createdAt updatedAt')
          .lean();
        if (p) {
          const pr = p.payResponse || {};
          payment = {
            status: p.status,
            amount: paiseToRs(p.amount),
            paymentFrom: p.paymentFrom,
            method: pr.method || null,
            razorpayOrderId: pr.razorpay_order_id || pr.order_id || null,
            razorpayPaymentId: pr.id || null,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          };
        }
      } catch {
        payment = null;
      }
      return {
        kind: 'orders',
        orderNo: o.orderNo,
        status: o.status,
        orderTo: o.orderTo,
        total: paiseToRs(o.grandTotal ?? o.totalAmount ?? null),
        driverId: o.driver || null,
        // Enterprise tracking card: rider attached? how long since placed?
        // Lets the reply say "rider on the way" vs "kitchen still has it".
        hasRider: !!o.driver,
        elapsedMins: o.createdAt ? Math.max(Math.round((Date.now() - new Date(o.createdAt).getTime()) / 60000), 0) : null,
        restaurantName: o.restaurant?.name || null,
        updatedAt: o.updatedAt,
        payment,
      };
    }
    if (type === 'dining') {
      const b = await DiningBooking.findById(id)
        .select('bookingNo status bookingDate bookingTime noOfGuests createdAt updatedAt')
        .lean();
      if (!b) return null;
      const elapsedMins = b.createdAt
        ? Math.max(Math.round((Date.now() - new Date(b.createdAt).getTime()) / 60000), 0)
        : null;
      return { kind: 'dining', elapsedMins, ...b };
    }
    if (type === 'tiffin_subscription') {
      const s = await UserPurchasedTiffinSubscription.findById(id)
        .select('status planName startDate endDate createdAt updatedAt')
        .lean();
      if (!s) return null;
      const elapsedMins = s.createdAt
        ? Math.max(Math.round((Date.now() - new Date(s.createdAt).getTime()) / 60000), 0)
        : null;
      return { kind: 'tiffin_subscription', elapsedMins, ...s };
    }
    if (type === 'complaints') {
      const c = await Complaints.findById(id).select('status subject createdAt updatedAt').lean();
      if (!c) return null;
      return { kind: 'complaints', ...c };
    }
    return null;
  } catch {
    return null;
  }
};

const getCannedReply = async (intent, locale = 'en') => {
  // Mongoose BUFFERS queries when the connection is not ready and only rejects
  // after `bufferCommands` times out (10s default). A disconnected DB must make
  // the bot fall through to its built-in copy INSTANTLY, not stall the chat.
  if (mongoose.connection.readyState !== 1) return null;
  try {
    const doc = await CannedResponse.findOne({ intent, locale, isActive: true }).lean();
    return doc ? doc.body : null;
  } catch {
    return null;
  }
};

// Build bot reply. resolved=true means bot fully handled, no human needed.
const buildBotReply = async ({ intent, snapshot, locale = 'en' }) => {
  const canned = await getCannedReply(intent, locale);
  // Template fill for DB-driven copy: {{orderNo}} {{payStatus}} {{payMethod}}
  // {{paymentId}}. Lets product edit wording without a deploy; code copy
  // below stays as the fallback when no canned row exists.
  const fill = (tpl, map) => {
    let out = String(tpl || '');
    for (const [k, v] of Object.entries(map || {})) {
      out = out.split(`{{${k}}}`).join(v == null || v === '' ? '—' : `${v}`);
    }
    return out;
  };
  const cannedFor = async (subIntent) => getCannedReply(subIntent, locale);
  // DB template wins; code copy is fallback only. Keeps product wording
  // editable without a deploy while staying safe with no seed row.
  const tplOr = async (subIntent, map, fallback) => {
    const tpl = await cannedFor(subIntent);
    return tpl ? fill(tpl, map) : fallback;
  };
  const pay = snapshot && snapshot.payment ? snapshot.payment : null;
  const orderNo = snapshot && snapshot.orderNo ? `#${snapshot.orderNo} ` : '';
  switch (intent) {
    case 'payment_failed': {
      // Enterprise payment triage: distinguish captured-vs-stuck using the
      // live initiation (no guessing). Captured = verify/reconcile path;
      // initiated = retry/repay path; paid+created = lookup mistake.
      if (pay && pay.status === 'paid') {
        return {
          text: await tplOr(
            'payment_failed_paid',
            payMap,
            `Good news — payment for order ${orderNo}is confirmed (${pay.method || 'online'}${pay.razorpayPaymentId ? `, ${pay.razorpayPaymentId}` : ''}). If the order still shows pending, pull-to-refresh Orders; the 15-min reconcile also auto-heals it. Type "human" if it stays stuck.`
          ),
          actions: ['track_order', 'talk_to_human'],
          resolved: false,
        };
      }
      if (pay && pay.status === 'initiated') {
        return {
          text:
            (await tplOr('payment_failed_pending', payMap, null)) ||
            `Your payment for order ${orderNo}has not confirmed yet at the gateway${pay.razorpayOrderId ? ` (${pay.razorpayOrderId})` : ''} — no money is held by us in this state. If money left your bank/UPI/wallet, it auto-reverses or our 15-min reconcile marks it paid on capture. Tap Repay on the order to retry with the same order (no re-cart), or type "human" with the payment ID.`,
          actions: ['check_payment_status', 'request_refund', 'talk_to_human'],
          resolved: false,
        };
      }
      return {
        text:
            (await tplOr('payment_failed_missing', payMap, null)) ||
          `For order ${orderNo}I could not find a payment attempt. If money was deducted, share the UPI/payment ID + amount + time — or tap Repay on the order to try again. Type "human" to reach an agent with full context.`,
        actions: ['check_payment_status', 'talk_to_human'],
        resolved: false,
      };
    }
    case 'refund_status':
      return {
        text:
          canned ||
          `Refunds go to source in 3–5 working days after approval (UPI/wallet faster, cards slowest). ${pay && pay.razorpayPaymentId ? `Your payment ${pay.razorpayPaymentId} is currently: ${pay.status}. ` : ''}Raise it from Orders → Refund on ${orderNo ? `order ${orderNo}` : 'the order'} if not yet raised. Type "human" if past 5 days.`,
        actions: ['request_refund', 'talk_to_human'],
        resolved: true,
      };
    case 'rider': {
      if (!snapshot || !snapshot.hasRider) {
        return {
          text:
            canned ||
            `No rider is attached ${orderNo ? `to order ${orderNo}` : 'yet'} — one is assigned after the kitchen hands the order over. Type "human" if this looks wrong.`,
          actions: ['track_order', 'talk_to_human'],
          resolved: false,
        };
      }
      return {
        text: `A rider is on order ${orderNo || 'your order'} right now. Call or message from order detail → rider card for the fastest response. Type "human" if unreachable.`,
        actions: ['track_order', 'talk_to_human'],
        resolved: false,
      };
    }
    case 'wrong_order': {
      const items = snapshot && snapshot.kind === 'orders';
      return {
        text:
          canned ||
          `Sorry about that${orderNo ? ` with order ${orderNo}` : ''}. For a wrong, missing or bad-quality item: raise it from Orders → select order → Refund/Complaint with a photo if possible — quality claims need it. Refunds land in 3–5 working days. Type "human" to escalate now.`,
        actions: items ? ['request_refund', 'talk_to_human'] : ['talk_to_human'],
        resolved: false,
      };
    }
    case 'not_received': {
      const st = snapshot ? `${snapshot.status || ''}` : '';
      const base =
        st === 'delivered'
          ? `Order ${orderNo}shows delivered but you have nothing — first check with neighbours/security and the delivery photo/PIN if shown.`
          : `Order ${orderNo ? `${orderNo}` : 'your order'} is currently ${st || 'being traced'}.`;
      return {
        text:
          canned ||
          `${base} If still missing, raise it from Orders → Complaint so the trip is investigated with the rider. Type "human" for priority help.`,
        actions: ['talk_to_human'],
        resolved: false,
      };
    }
    case 'restaurant_no_response': {
      return {
        text:
          canned ||
          `If ${orderNo ? `order ${orderNo}` : 'the restaurant'} is not accepting: kitchens confirm within a few minutes at peak. If it stays stuck, cancel free before preparation starts, or type "human" and we will nudge the outlet / reassign.`,
        actions: ['cancel_order', 'talk_to_human'],
        resolved: false,
      };
    }
    case 'rider_issue': {
      return {
        text:
          canned ||
          `Noted${orderNo ? ` for order ${orderNo}` : ''} — rider behaviour issues are taken seriously and go on the partner's record. Share what happened in one line, or type "human" to report to an agent now. For immediate help call the rider from order detail.`,
        actions: ['talk_to_human'],
        resolved: false,
      };
    }
    case 'where_is_my_order': {      if (!snapshot) {
        return {
          text:
            canned ||
            'I could not find that order. Please pick the order from your Orders list, or share the order number — or type "human" to talk to an agent.',
          actions: ['pick_order', 'talk_to_human'],
          resolved: false,
        };
      }
      // Dining / tiffin share the tracker with kind-shaped replies.
      if (snapshot.kind === 'dining') {
        const age = snapshot.elapsedMins == null ? '' : ` (requested ${snapshot.elapsedMins} min ago)`;
        const when = snapshot.bookingDate || snapshot.bookingTime
          ? ` for ${snapshot.bookingDate || ''} ${snapshot.bookingTime || ''}`.trim()
          : '';
        return {
          text: `Booking ${snapshot.bookingNo || ''}${age}${when ? ` ${when}` : ''}: currently ${snapshot.status || 'received'}. The restaurant confirms shortly; you will be notified on action. Type "human" for help.`,
          actions: ['talk_to_human'],
          resolved: false,
        };
      }
      if (snapshot.kind === 'tiffin_subscription') {
        return {
          text: `Subscription ${snapshot.planName || ''}: currently ${snapshot.status || 'active'}. Plan runs ${snapshot.startDate || '?'} to ${snapshot.endDate || '?'}. Type "human" for changes or refund.`,
          actions: ['talk_to_human'],
          resolved: false,
        };
      }
      // Enterprise: live DB state translated to plain language with elapsed
      // time + next step + ETA hint. Dynamic snapshot wins over generic
      // canned here — canned would hide the live state this intent exists for.
      {
        const st = `${snapshot.status || ''}`;
        const age = snapshot.elapsedMins == null ? '' : ` (placed ${snapshot.elapsedMins} min ago)`;
        const rest = snapshot.restaurantName ? ` from ${snapshot.restaurantName}` : '';
        const head = `Order #${snapshot.orderNo}${age}${rest}:`;
        const human = ` Type "human" anytime for an agent.`;
        if (st === 'pending_payments') {
          return {
            text: `${head} payment hasn't confirmed yet${pay ? ` (${pay.status})` : ''} — the kitchen hasn't received it. ${pay && pay.status === 'initiated' ? 'If money left your account it auto-reverses or reconcile marks it paid; otherwise tap Repay.' : 'Tap Repay on the order to confirm it.'}${human}`,
            actions: ['payment_failed', 'check_payment_status', 'talk_to_human'],
            resolved: false,
          };
        }
        if (st === 'created') {
          return {
            text: `${head} placed and waiting for the restaurant to accept.${human}`,
            actions: ['cancel_order', 'talk_to_human'],
            resolved: false,
          };
        }
        if (st === 'accepted') {
          return {
            text: `${head} accepted — the kitchen starts preparing next. Usual prep is 15–25 min.${human}`,
            actions: ['cancel_order', 'talk_to_human'],
            resolved: false,
          };
        }
        if (st === 'preparing' || st === 'ready') {
          return {
            text: `${head} being prepared${st === 'ready' ? ' and packed' : ''}. A rider is assigned next; typical doorstep ETA from here is 20–35 min.${human}`,
            actions: ['cancel_order', 'talk_to_human'],
            resolved: false,
          };
        }
        if (st === 'handover' || st === 'ongoing') {
          return {
            text: snapshot.hasRider
              ? `${head} on the way — the rider has it. Track live on the order card or call the rider from order detail.${human}`
              : `${head} handed over and awaiting rider pickup. A rider is being assigned now.${human}`,
            actions: ['call_rider', 'talk_to_human'],
            resolved: false,
          };
        }
        if (st === 'delivered') {
          return {
            text: `${head} delivered. Enjoy! Missing items? Raise a refund within the window.${human}`,
            actions: ['request_refund', 'talk_to_human'],
            resolved: false,
          };
        }
        if (st === 'cancelled' || st === 'rejected' || st === 'refunded') {
          return {
            text: `${head} ${st}. Refunds (if paid) return to source in 3–5 working days.${human}`,
            actions: ['check_refund_status', 'talk_to_human'],
            resolved: false,
          };
        }
        return {
          text: `${head} currently: ${st}.${human}`,
          actions: ['talk_to_human'],
          resolved: false,
        };
      }
    }
    case 'refund':
      return {
        text:
          canned ||
          'For refunds: go to Orders → select order → Refund. Amount returns to source in 3–5 days. Type "human" if the refund failed.',
        actions: ['request_refund', 'talk_to_human'],
        resolved: true,
      };
    case 'cancel':
      return {
        text:
          canned ||
          'You can cancel from Orders → Cancel before preparation starts. Cancellation fees may apply per policy. Type "human" for help.',
        actions: ['cancel_order', 'talk_to_human'],
        resolved: true,
      };
    case 'coupon':
      return {
        text: canned || 'Apply coupons at checkout. Invalid coupon usually means expired or min-order not met. Type "human" for a manual check.',
        actions: ['view_coupons', 'talk_to_human'],
        resolved: true,
      };
    case 'greeting': {
      // Payment-context greeting: order stuck in pending_payments (or
      // initiation still initiated) gets payment pre-questions first.
      const needsPayHelp =
        snapshot && (snapshot.status === 'pending_payments' || (pay && pay.status === 'initiated'));
      if (needsPayHelp) {
        return {
          text:
            canned ||
            `Hi! I see order ${orderNo}has a payment that hasn't confirmed${pay && pay.method ? ` (${pay.method})` : ''}. Is money deducted? Pick below — or track, refund, or talk to a human.`,
          actions: ['payment_failed', 'check_refund_status', 'track_order', 'talk_to_human'],
          resolved: false,
        };
      }
      return {
        text: canned || 'Hi! I can track your order, help with refund/cancel/coupon — or connect you to a human agent. What do you need?',
        actions: ['track_order', 'talk_to_human'],
        resolved: false,
      };
    }
    case 'handover':
      return { text: 'Connecting you to a human agent with full context…', actions: [], resolved: false };
    default:
      return {
        text:
          canned ||
          'Got it. I can track orders, or help with refund/cancel/coupon. Type "human" anytime to reach an agent.',
        actions: ['track_order', 'talk_to_human'],
        resolved: false,
      };
  }
};

// Persist bot message(s) into room. Returns reply payload.
const handleBotTurn = async ({ roomId, userMessage, type, typeId, locale = 'en' }) => {
  const { intent, confidence } = detectIntent(userMessage);
  const snapshot = await getLiveSnapshot(type, typeId);
  const reply = await buildBotReply({ intent, snapshot, locale });

  const room = await SupportChatRoom.findById(roomId);
  if (room && snapshot) {
    room.orderSnapshot = snapshot;
    await room.save();
  }

  // System sender: use room userId as sender placeholder with senderRole bot
  // (keeps senderId required constraint without inventing a bot user).
  const senderId = room ? room.userId : new mongoose.Types.ObjectId();
  await SupportChatConversion.create({
    roomId,
    senderId,
    message: reply.text,
    messageType: 'text',
    senderRole: 'bot',
    visibility: 'public',
    readStatus: 'sent',
    meta: { intent, botConfidence: confidence, actions: reply.actions, snapshot: snapshot || null },
  });

  if (room) {
    room.lastMessage = reply.text;
    room.lastMessageType = 'text';
    room.audit = room.audit || [];
    room.audit.push({ action: `bot:${intent}`, at: new Date(), meta: { confidence } });
    // Enterprise triage: money-moving failures jump the queue. Priority
    // drives SLA + assignment order; reconciled on every bot turn so a
    // ticket that becomes a payment issue mid-thread still escalates.
    if (intent === 'payment_failed' || intent === 'not_received') {
      room.priority = 'high';
    }
    await room.save();
  }

  return { intent, confidence, snapshot, ...reply };
};

module.exports = {
  detectIntent,
  getLiveSnapshot,
  buildBotReply,
  handleBotTurn,
};
