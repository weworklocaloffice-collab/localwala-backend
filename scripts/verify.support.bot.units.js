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
 * verify.support.bot.units.js — bot intent resolver + reply builder (no DB).
 * Run: node scripts/verify.support.bot.units.js
 */

const { detectIntent, buildBotReply } = require('../src/services/support.bot.service');

let failures = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

// --- intent detection -------------------------------------------------------
ok('tracks "where is my order"', detectIntent('where is my order?').intent === 'where_is_my_order');
ok('tracks "track my order"', detectIntent('track my order').intent === 'where_is_my_order');
ok('tracks "order is late"', detectIntent('my order is late').intent === 'where_is_my_order');
ok('tracks "order status"', detectIntent('what is the order status').intent === 'where_is_my_order');
ok('detects refund', detectIntent('I want a refund').intent === 'refund');
ok('detects money back', detectIntent('where is my money back').intent === 'refund');
ok('detects cancel', detectIntent('cancel my order please').intent === 'cancel');
ok('detects coupon', detectIntent('do you have any coupon').intent === 'coupon');
ok('detects handover', detectIntent('let me talk to a human').intent === 'handover');
ok('detects escalation', detectIntent('connect me to an agent').intent === 'handover');
ok('detects greeting', detectIntent('hello').intent === 'greeting');
ok('unknown falls through', detectIntent('zzz qqq vvv').intent === 'unknown');
ok('empty text is safe', detectIntent('').intent === 'greeting');
ok('null text is safe', detectIntent(null).intent === 'greeting');
ok('undefined text is safe', detectIntent(undefined).intent === 'greeting');

// confidence ordering — a handover request must outrank a generic mention
ok('handover confidence is high', detectIntent('talk to a human').confidence >= 0.9);
ok('unknown confidence is low', detectIntent('zzz qqq').confidence < 0.5);

// --- reply builder ----------------------------------------------------------
const build = (intent, snapshot = null) => buildBotReply({ intent, snapshot, locale: 'en' });

(async () => {
  // A found order resolves into a card, never a dead end.
  const found = await build('where_is_my_order', {
    kind: 'orders',
    orderNo: 1234,
    status: 'ongoing',
    restaurantName: 'Tandoor',
  });
  ok('tracking with snapshot names the order', String(found.text).includes('1234'));
  ok('tracking with snapshot names the status', String(found.text).includes('ongoing'));
  ok('tracking with snapshot offers call rider', found.actions.includes('call_rider'));
  ok('tracking with snapshot keeps human reachable', found.actions.includes('talk_to_human'));

  // A missing order must NOT claim success — it has to escalate.
  const missing = await build('where_is_my_order', null);
  ok('missing order does not claim resolved', missing.resolved === false);
  ok('missing order offers picker', missing.actions.includes('pick_order'));
  ok('missing order offers human', missing.actions.includes('talk_to_human'));

  // Self-service intents close the ticket.
  ok('refund is self-serve', (await build('refund')).resolved === true);
  ok('cancel is self-serve', (await build('cancel')).resolved === true);
  ok('coupon is self-serve', (await build('coupon')).resolved === true);

  // A handover ask is never resolved by the bot.
  ok('handover is not resolved', (await build('handover')).resolved === false);
  ok('unknown is not resolved', (await build('unknown')).resolved === false);

  // Every reply must keep a route to a human, or the queue leaks tickets.
  for (const intent of ['where_is_my_order', 'refund', 'cancel', 'coupon', 'greeting', 'unknown']) {
    const r = await build(intent);
    ok(`${intent} always offers a human`, r.actions.includes('talk_to_human'));
    ok(`${intent} always returns text`, typeof r.text === 'string' && r.text.length > 0);
  }

  console.log(failures === 0 ? '\nAll support bot units passed.' : `\n${failures} FAILURES`);
  process.exitCode = failures === 0 ? 0 : 1;
})();