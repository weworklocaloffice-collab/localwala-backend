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
 * wire.support.queues.js — put real agents into the support queues.
 *
 * `seed.support.enterprise.js` creates queues with `members: []` on purpose:
 * it cannot know your user ids. Until a queue has members, `assignAgent` finds
 * nothing eligible and every handover sits in `queued` forever.
 *
 * Usage:
 *   node scripts/wire.support.queues.js --list
 *       Show every support-capable user and the current state of every queue.
 *
 *   node scripts/wire.support.queues.js --auto
 *       Put EVERY supportTeam/cityzen user into EVERY active queue.
 *
 *   node scripts/wire.support.queues.js --agent <id> [--agent <id>] --queue <name>
 *       Put specific users into one specific queue.
 *
 *   node scripts/wire.support.queues.js --bootstrap
 *       If NO support user exists, create one and print a generated password
 *       ONCE. Refuses to run if any support user already exists, so it can
 *       never silently mint a second admin-ish account.
 *
 * Nothing is written without --auto / --agent / --bootstrap. --list is read-only.
 */

require('dotenv').config();

const crypto = require('crypto');
const mongoose = require('mongoose');
const config = require('../src/config/config');
const { User, SupportQueue, AgentPresence } = require('../src/models');

const AGENT_ROLES = ['supportTeam', 'cityzen'];

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const i = argv.indexOf(f);
  return i > -1 && argv[i + 1] ? argv[i + 1] : null;
};
const all = (f) =>
  argv.reduce((acc, a, i) => (a === f && argv[i + 1] ? [...acc, argv[i + 1]] : acc), []);

const printState = async () => {
  const users = await User.find({ role: { $in: AGENT_ROLES } })
    .select('_id firstName lastName email role')
    .lean();
  const queues = await SupportQueue.find({}).sort({ name: 1 }).lean();
  const presence = await AgentPresence.find({ online: true }).select('agentId').lean();
  const online = new Set(presence.map((p) => String(p.agentId)));

  console.log(`\nSupport-capable users: ${users.length}`);
  if (!users.length) {
    console.log('  (none) — nothing can be assigned until a support user exists.');
    console.log('      Create one with:  node scripts/wire.support.queues.js --bootstrap');
  }
  for (const u of users) {
    console.log(
      `  ${u.id}  ${(u.firstName || '') + ' ' + (u.lastName || '')}`.padEnd(46) +
        `${String(u.role).padEnd(14)}${online.has(String(u._id)) ? 'ONLINE' : 'offline'}`
    );
  }

  console.log(`\nQueues: ${queues.length}`);
  let staffed = 0;
  for (const q of queues) {
    const n = q.members.length;
    if (n > 0) staffed += 1;
    console.log(
      `  ${String(q.name).padEnd(22)} skills=${(q.skills || []).join('|') || '-'}`.padEnd(68) +
        ` wip=${String(q.wipLimit).padEnd(4)} members=${n}${q.isActive ? '' : '  (INACTIVE)'}`
    );
    for (const m of q.members) {
      const u = users.find((x) => String(x._id) === String(m));
      console.log(`      - ${u ? (u.firstName || '') + ' ' + (u.lastName || '') : '(not a support user)'}`);
    }
  }

  if (queues.length && !staffed) {
    console.log('\n  WARNING: no queue has any member. Every handover will queue unassigned.');
  }
};

const bootstrap = async () => {
  const existing = await User.countDocuments({ role: { $in: AGENT_ROLES } });
  if (existing > 0) {
    console.log(`Refusing to bootstrap: ${existing} support user(s) already exist.`);
    console.log('Use --list, --auto, or --agent to wire the existing ones.');
    return 1;
  }
  // Random, printed once. Never a default password.
  const password = `${crypto.randomBytes(9).toString('base64url')}Aa1!`;
  const stamp = Date.now().toString().slice(-6);
  const user = await User.create({
    firstName: 'Support',
    lastName: 'Agent',
    email: `support.agent.${stamp}@weworklocal.in`,
    mobile: '9000000000',
    countryCode: 91,
    role: 'supportTeam',
    password,
  });
  console.log('\nCreated a supportTeam user. Save the password now — it is not stored anywhere.');
  console.log(`  email    ${user.email}`);
  console.log(`  password ${password}\n`);
  await printState();
  return 0;
};

const wire = async (userIds, queueName) => {
  const ids = userIds.map((id) => new mongoose.Types.ObjectId(id));

  const users = await User.find({ _id: { $in: ids } }).select('_id role').lean();
  if (users.length !== ids.length) {
    console.error('One or more agent ids do not exist.');
    return 1;
  }
  const bad = users.filter((u) => !AGENT_ROLES.includes(u.role));
  if (bad.length) {
    // A non-support user in a support queue would be handed customer PII and
    // the order side-panel. Refuse rather than silently accept.
    console.error(
      `Refusing: ${bad.length} id(s) are not supportTeam/cityzen. Allowed roles: ${AGENT_ROLES.join(', ')}`
    );
    return 1;
  }

  const filter = queueName ? { name: queueName } : { isActive: true };
  const queues = await SupportQueue.find(filter);
  if (!queues.length) {
    console.error(queueName ? `No queue named "${queueName}".` : 'No active queues. Run seed.support.enterprise.js first.');
    return 1;
  }
  for (const q of queues) {
    // $addToSet, not $set: re-running must not drop agents already wired.
    await SupportQueue.updateOne({ _id: q._id }, { $addToSet: { members: { $each: ids } } });
    console.log(`wired ${ids.length} agent(s) into "${q.name}"`);
  }
  await printState();
  return 0;
};

const main = async () => {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);
  let code = 0;

  if (has('--bootstrap')) {
    code = await bootstrap();
  } else {
    const agents = all('--agent');
    if (has('--auto')) {
      const users = await User.find({ role: { $in: AGENT_ROLES } }).select('_id').lean();
      if (!users.length) {
        console.error('No supportTeam/cityzen users found. Run --bootstrap first.');
        code = 1;
      } else {
        code = await wire(
          users.map((u) => String(u._id)),
          null
        );
      }
    } else if (agents.length) {
      code = await wire(agents, val('--queue'));
    } else {
      await printState();
      console.log('\nRead-only. Use --auto, --agent/--queue, or --bootstrap to write.\n');
    }
  }

  await mongoose.disconnect();
  process.exit(code);
};

main().catch(async (e) => {
  console.error('wire.support.queues failed:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});