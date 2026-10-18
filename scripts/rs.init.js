// LocalWala — Local Commerce & Delivery Platform
// One-shot helper: initiate the rs0 replica set via the Node driver (mongosh is not installed).
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  // directConnection bypasses replica-set discovery, which would otherwise fail while
  // the set is still just configured but not initiated.
  const c = new mongoose.Connection();
  await c.openUri('mongodb://127.0.0.1:27017/admin?directConnection=true');
  const before = await c.db.admin().command({ hello: 1 }).catch((e) => ({ err: e.message }));
  console.log('before: setName=', before.setName, 'isWritablePrimary=', before.isWritablePrimary, before.err || '');

  try {
    const r = await c.db.admin().command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:27017' }] } });
    console.log('replSetInitiate ok:', r.ok);
  } catch (e) {
    console.log('replSetInitiate:', e.message);
  }

  let state = 'NOTREADY';
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 750));
    const h = await c.db.admin().command({ hello: 1 }).catch(() => ({}));
    state = h.setName ? (h.isWritablePrimary ? 'PRIMARY' : 'NOT-PRIMARY') : 'STANDALONE';
    if (state === 'PRIMARY') break;
  }
  console.log('final state:', state);
  await c.close();
  process.exit(state === 'PRIMARY' ? 0 : 1);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });