/**
 * One-off: drive a full support ticket lifecycle over real HTTP against a
 * running API. This is the closest thing to a UI click-through available
 * here — it exercises routes, auth, validation, controllers and services end
 * to end, not just service functions.
 *
 * Prereqs: server running (`node src/index.js`), queues seeded + wired.
 * Creates an ephemeral customer, mints JWTs with the server's own secret, sets
 * the bootstrap agent online for the duration, then removes everything it made
 * (including the presence row it added — prior state is restored).
 *
 * Run: node scripts/clickthrough.support.ticket.js
 */

require('dotenv').config();

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const config = require('../src/config/config');
const M = require('../src/models');

const BASE = `http://127.0.0.1:${config.port}`;
const STAMP = Date.now().toString().slice(-8);

let fail = 0;
const ok = (label, cond, detail) => {
  if (cond) console.log('  PASS  ' + label);
  else {
    fail += 1;
    console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : ''));
  }
};

const mintAppToken = (userId) =>
  jwt.sign({ sub: String(userId), type: 'access' }, config.jwt.secret, { expiresIn: '15m' });

const call = async (method, path, { token, cookieUser, body } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookieUser) headers.Cookie = `${config.jwt.cookieName}=${mintAppToken(cookieUser)}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
};

(async () => {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);
  console.log('DB connected. API:', BASE);

  // --- fixtures -----------------------------------------------------------
  const customer = await M.User.create({
    firstName: 'Click',
    lastName: 'Through',
    email: `clickthrough.${STAMP}@example.com`,
    mobile: `7${STAMP}`,
    countryCode: 91,
    role: 'user',
    password: 'ClickThrough123',
  });
  const agent = await M.User.findOne({ role: 'supportTeam' }).select('_id');
  if (!agent) throw new Error('no supportTeam user — run wire.support.queues.js --bootstrap first');
  // Presence for the duration only; removed in cleanup.
  await M.AgentPresence.create({ agentId: agent._id, online: true, lastSeen: new Date() });

  const custToken = mintAppToken(customer._id);
  const typeId = new mongoose.Types.ObjectId().toString();
  let roomId = null;

  try {
    console.log('\n--- 1. bot start (POST /v1/users/...) ---');
    let r = await call('POST', '/v1/users/support_chat_room/bot/start', {
      token: custToken,
      body: { user: String(customer._id), type: 'orders', typeId },
    });
    ok('bot/start 200', r.status === 200, `got ${r.status}`);
    roomId = r.json && (r.json.roomId || r.json.roomID);
    ok('room id returned', !!roomId);
    ok('bot greeted', !!(r.json && r.json.text));

    console.log('\n--- 2. bot message (where is my order) ---');
    r = await call('POST', '/v1/users/support_chat_room/bot/message', {
      token: custToken,
      body: { roomId, message: 'where is my order?' },
    });
    ok('bot/message 200', r.status === 200, `got ${r.status}`);
    ok('intent detected', r.json && !!r.json.intent, JSON.stringify(r.json && r.json.intent));

    console.log('\n--- 3. handover to human ---');
    r = await call('POST', `/v1/users/support_chat_room/handover/${roomId}`, {
      token: custToken,
      body: { reason: 'clickthrough' },
    });
    ok('handover 200', r.status === 200, `got ${r.status} ${JSON.stringify(r.json)}`);
    ok('handover assigned', r.json && r.json.assigned === true, JSON.stringify(r.json));

    console.log('\n--- 4. queue status ---');
    r = await call('GET', `/v1/users/support_chat_room/queue/${roomId}`, { token: custToken });
    ok('queue status 200', r.status === 200, `got ${r.status}`);
    ok('agent attached', r.json && !!r.json.assignedAgent, JSON.stringify(r.json && r.json.assignedAgent));

    console.log('\n--- 5. agent reply (support_team, cookie auth) ---');
    r = await call('POST', '/v1/support_team/chat/send/', {
      cookieUser: agent._id,
      body: { room: roomId, sender: String(agent._id), msg: 'On the way, clickthrough check.', msgType: 'text' },
    });
    ok('agent reply 200', r.status === 200, `got ${r.status} ${JSON.stringify(r.json)}`);

    console.log('\n--- 6. agent queue (support_team) ---');
    r = await call('GET', `/v1/support_team/queue?view=mine&agent=${agent._id}&limit=5&page=1`, {
      cookieUser: agent._id,
    });
    ok('agent queue 200', r.status === 200, `got ${r.status}`);
    ok('ticket visible in Mine', r.json && Array.isArray(r.json.chats) && r.json.chats.some((c) => String(c._id || c.id) === String(roomId)), `chats=${r.json && r.json.chats && r.json.chats.length}`);

    console.log('\n--- 7. resolve ---');
    r = await call('POST', '/v1/support_team/resolve_support_chat/', {
      cookieUser: agent._id,
      body: { id: roomId, team: String(agent._id) },
    });
    ok('resolve 200', r.status === 200, `got ${r.status} ${JSON.stringify(r.json)}`);

    console.log('\n--- 8. CSAT ---');
    r = await call('POST', `/v1/users/support_chat_room/csat/${roomId}`, {
      token: custToken,
      body: { score: 5, comment: 'clickthrough' },
    });
    ok('csat 200', r.status === 200, `got ${r.status}`);

    console.log('\n--- 9. reopen ---');
    r = await call('POST', `/v1/users/support_chat_room/reopen/${roomId}`, {
      token: custToken,
      body: { user: String(customer._id) },
    });
    ok('reopen 200', r.status === 200, `got ${r.status} ${JSON.stringify(r.json)}`);
    ok('reopened to open', r.json && r.json.status === 'open');
  } catch (e) {
    fail += 1;
    console.log('  FAIL  harness threw -> ' + e.message);
  } finally {
    console.log('\n--- cleanup ---');
    if (roomId) {
      await M.SupportChatConversion.deleteMany({ roomId: new mongoose.Types.ObjectId(roomId) });
      await M.SupportChatRoom.deleteMany({ _id: new mongoose.Types.ObjectId(roomId) });
    }
    await M.AgentPresence.deleteMany({ agentId: agent._id });
    await M.User.deleteMany({ _id: customer._id });
    const left = await M.SupportChatRoom.countDocuments({ userId: customer._id });
    ok('fixtures removed', left === 0, String(left));
  }

  await mongoose.disconnect();
  console.log(fail === 0 ? '\nCLICKTHROUGH PASSED end to end over HTTP.' : `\n${fail} FAILURES`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('clickthrough failed:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(2);
});
