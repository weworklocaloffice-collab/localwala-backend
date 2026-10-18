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
 * seed.support.enterprise.js — idempotent seed for the bot-first -> human
 * handover stack.
 *
 * Creates the SupportQueue / SlaPolicy / CannedResponse rows that
 * `support.assignment.service` and `support.bot.service` read. Without these
 * the queue stays empty and `assignAgent` always returns `no-eligible-queue`.
 *
 * Idempotent: re-running upserts on the natural keys (queue name, sla
 * supportType+priority, canned intent+locale) and leaves agent `members` alone
 * once set — members are user ids that only an operator can know.
 *
 * Run: node scripts/seed.support.enterprise.js
 *       node scripts/seed.support.enterprise.js --dry-run
 */

const mongoose = require('mongoose');
const config = require('../src/config/config');
const { SupportQueue, SlaPolicy, CannedResponse, User } = require('../src/models');

const DRY_RUN = process.argv.includes('--dry-run');

const QUEUES = [
  { name: 'order-help', skills: ['orders'], wipLimit: 3 },
  { name: 'dining-help', skills: ['dining'], wipLimit: 3 },
  { name: 'tiffin-help', skills: ['tiffin_subscription'], wipLimit: 3 },
  { name: 'complaints', skills: ['complaints', 'reports', 'restaurant_complaints'], wipLimit: 3 },
];

// firstResponseSec is ALWAYS 30: the thread countdown, the Breached tab and
// the policy read the same rule. Only resolution varies by priority.
const SLA_MATRIX = {
  urgent: { firstResponseSec: 30, resolutionSec: 900 },
  high: { firstResponseSec: 30, resolutionSec: 1800 },
  medium: { firstResponseSec: 30, resolutionSec: 3600 },
  low: { firstResponseSec: 30, resolutionSec: 14400 },
};

const SUPPORT_TYPES = ['orders', 'dining', 'tiffin_subscription', 'complaints'];

const CANNED = [
  {
    intent: 'greeting',
    title: 'Greeting',
    body:
      'Hi! I can track your order, help with refund, cancel or coupon questions, or connect you to a human agent. What do you need?',
  },
  {
    intent: 'where_is_my_order',
    title: 'Order tracking',
    body:
      'Here is the live status of your order. You can track it in real time from the order card above.',
  },
  {
    intent: 'where_is_my_order_missing',
    title: 'Order not found',
    body:
      'I could not find that order. Please pick it from your Orders list, or share the order number. You can also talk to a human agent.',
  },
  {
    intent: 'refund',
    title: 'Refund help',
    body:
      'To request a refund open Orders, select the order and choose Refund. The amount returns to the original payment method in 3-5 working days. If the refund did not arrive, talk to a human agent.',
  },
  // Payment triage templates. Placeholders filled live per ticket:
  // {{orderNo}} {{payStatus}} {{payMethod}} {{paymentId}}.
  // Code keeps built-in fallbacks; product wording lives here (no deploy).
  {
    intent: 'payment_failed_paid',
    title: 'Payment confirmed',
    body:
      'Good news — payment for order {{orderNo}} is confirmed ({{payMethod}}, {{paymentId}}). If the order still shows pending, pull-to-refresh Orders; the 15-minute reconcile also auto-heals it. Type "human" if it stays stuck.',
  },
  {
    intent: 'payment_failed_pending',
    title: 'Payment not confirmed',
    body:
      'Your payment for order {{orderNo}} has not confirmed yet at the gateway ({{paymentId}}). No money is held by us in this state. If money left your bank/UPI/wallet, it auto-reverses or our 15-minute reconcile marks it paid on capture. Tap Repay on the order to retry with the same order, or type "human" with the payment ID.',
  },
  {
    intent: 'payment_failed_missing',
    title: 'No payment found',
    body:
      'For order {{orderNo}} I could not find a payment attempt. If money was deducted, share the UPI/payment ID, amount and time — or tap Repay on the order to try again. Type "human" to reach an agent with full context.',
  },
  {
    intent: 'refund_status',
    title: 'Refund status',
    body:
      'Refunds go to source in 3–5 working days after approval (UPI and wallets are faster, cards slowest). Raise it from Orders, then Refund if not yet raised. Type "human" if it has been more than 5 days.',
  },
  {
    intent: 'wrong_order',
    title: 'Wrong item',
    body:
      'Sorry about that. For a wrong, missing or bad-quality item: raise it from Orders, select the order, then Refund or Complaint with a photo if possible. Refunds land in 3–5 working days. Type "human" to escalate now.',
  },
  {
    intent: 'not_received',
    title: 'Order not received',
    body:
      'If an order shows delivered but nothing arrived, check with neighbours and security first, then raise it from Orders, then Complaint so the trip is investigated. Type "human" for priority help.',
  },
  {
    intent: 'restaurant_no_response',
    title: 'Restaurant not responding',
    body:
      'Kitchens confirm within a few minutes at peak. If it stays stuck, cancel free before preparation starts, or type "human" and we will nudge the outlet.',
  },
  {
    intent: 'rider_issue',
    title: 'Rider issue',
    body:
      'Rider behaviour issues go on the partner record. Share what happened in one line, or type "human" to report to an agent now. For immediate help call the rider from order detail.',
  },
  {
    intent: 'cancel',
    title: 'Cancel help',
    body:
      'You can cancel an order from Orders before preparation begins. A cancellation fee may apply as per policy. Talk to a human agent if you need help.',
  },
  {
    intent: 'coupon',
    title: 'Coupon help',
    body:
      'Coupons are applied at checkout. If a coupon is rejected it is usually expired or the minimum order value was not met. I can connect you to a human agent for a manual check.',
  },
  {
    intent: 'handover',
    title: 'Handover',
    body: 'I am connecting you to a human agent now. Please hold on.',
  },
  {
    intent: 'unknown',
    title: 'Fallback',
    body:
      'I want to make sure I help correctly. I can track orders, or help with refund, cancel and coupon questions. You can also talk to a human agent anytime.',
  },
];

// Agent macros for the workspace (used by the Admin macros picker).
const MACROS = [
  { intent: 'macro_order_delivered_soon', title: 'On the way', body: 'Your order is on the way and will reach you shortly.' },
  { intent: 'macro_refund_initiated', title: 'Refund initiated', body: 'Your refund has been initiated and will reflect in 3-5 working days.' },
  { intent: 'macro_need_details', title: 'Need details', body: 'Could you please share your order number so we can check this for you?' },
  { intent: 'macro_resolved', title: 'Closing', body: 'Glad we could help. Please rate your support experience below.' },
];

// Customer-facing quick replies (human-state chips in the app).
const CHIPS = [
  { intent: 'chip_still_waiting', title: 'Still waiting', body: 'I am still waiting. Any update?' },
  { intent: 'chip_cancel', title: 'Cancel request', body: 'I want to cancel. Please help.' },
  { intent: 'chip_call_me', title: 'Call me', body: 'Please call me to resolve this faster.' },
  { intent: 'chip_paid', title: 'I have paid', body: 'I have completed the payment. Please confirm.' },
  { intent: 'chip_pay_failed', title: 'Payment failed', body: 'My payment failed. Please help.' },
  { intent: 'chip_refund', title: 'Request refund', body: 'I want a refund for my order.' },
  { intent: 'chip_refund_status', title: 'Refund status', body: 'What is my refund status?' },
];

const seedQueues = async () => {
  for (const q of QUEUES) {
    if (DRY_RUN) {
      console.log(`  [dry] queue ${q.name} skills=${q.skills.join('|')}`);
      continue;
    }
    // $setOnInsert so re-running never clobbers `members` an operator set.
    await SupportQueue.updateOne(
      { name: q.name },
      { $setOnInsert: { ...q, members: [], isActive: true } },
      { upsert: true }
    );
    console.log(`  queue       ${q.name}`);
  }
};

const seedSla = async () => {
  for (const type of SUPPORT_TYPES) {
    for (const [priority, secs] of Object.entries(SLA_MATRIX)) {
      if (DRY_RUN) {
        console.log(`  [dry] sla ${type}/${priority}`);
        continue;
      }
      await SlaPolicy.updateOne(
        { supportType: type, priority },
        { $set: { firstResponseSec: secs.firstResponseSec, resolutionSec: secs.resolutionSec, isActive: true } },
        { upsert: true }
      );
    }
  }
  if (!DRY_RUN) console.log(`  sla         ${SUPPORT_TYPES.length * Object.keys(SLA_MATRIX).length} policies`);
};

const seedCanned = async () => {
  // Backfill: rows seeded before `audience` existed carry no value and are
  // invisible to BOTH surfaces. Default them to agent, then upsert known rows.
  if (!DRY_RUN) {
    await CannedResponse.updateMany(
      { audience: { $exists: false } },
      { $set: { audience: 'agent' } }
    );
  }
  for (const locale of ['en', 'hi', 'ar', 'es']) {
    for (const c of [...CANNED, ...MACROS]) {
      if (DRY_RUN) continue;
      await CannedResponse.updateOne(
        { intent: c.intent, locale },
        { $set: { title: c.title, body: c.body, locale, isActive: true, audience: 'agent' } },
        { upsert: true }
      );
    }
    for (const c of CHIPS) {
      if (DRY_RUN) continue;
      await CannedResponse.updateOne(
        { intent: c.intent, locale },
        { $set: { title: c.title, body: c.body, locale, isActive: true, audience: 'customer' } },
        { upsert: true }
      );
    }
  }
  if (!DRY_RUN) console.log(`  canned      ${(CANNED.length + MACROS.length + CHIPS.length) * 4} entries`);
};

// Queue members are support/cityzen users. Reported, never guessed — a wrong
// id here silently removes a real agent from rotation.
const reportQueueMembers = async () => {
  const queues = await SupportQueue.find({ isActive: true }).select('name members').lean();
  const agentRoles = ['supportTeam', 'cityzen'];
  const eligible = await User.find({ role: { $in: agentRoles } }).select('_id role').lean();
  console.log(`\n  Agent users found: ${eligible.length}`);
  for (const q of queues) {
    const status = q.members.length ? `${q.members.length} member(s)` : 'EMPTY — needs assignment';
    console.log(`  queue ${q.name.padEnd(22)} ${status}`);
  }
  console.log(
    '\n  Wire members with, e.g.:\n' +
      "    db.supportqueues.updateOne({name:'order-help'},\n" +
      '      {$set:{members:[<supportTeamUserObjectId>]}})\n'
  );
};

const main = async () => {
  if (DRY_RUN) console.log('DRY RUN — nothing written.\n');
  await mongoose.connect(config.mongoose.url, config.mongoose.options);
  console.log('Connected to MongoDB.\n');

  await seedQueues();
  await seedSla();
  await seedCanned();

  if (!DRY_RUN) await reportQueueMembers();

  await mongoose.disconnect();
  console.log('\nSeed complete.');
};

main().catch(async (e) => {
  console.error('Seed FAILED:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});