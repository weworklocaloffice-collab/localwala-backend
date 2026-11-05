// Run with: node --test scripts/verify.stores.registration.routes.js
// Exercise the real router and Joi validators without sending SMS or creating users.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const express = require('express');

test('Stores signup URLs used by the Partner app reach validated handlers', async (t) => {
  const stub = (modulePath, exports) => {
    const id = require.resolve(modulePath);
    const previous = require.cache[id];
    require.cache[id] = { id, filename: id, loaded: true, exports };
    t.after(() => {
      if (previous) require.cache[id] = previous;
      else delete require.cache[id];
    });
  };
  const sent = [];
  stub('../src/services/sms.provider.config.service', {
    sendOTPSMS: async (...args) => {
      sent.push(args);
      return { id: 'otp-1', provider: `${args[0]},${args[1]},${args[2]}` };
    },
  });
  stub('../src/services/otp.verification.service', {
    verifyWithPhoneOTP: async (id) => id === 'otp-1'
      ? { id, provider: '+91,9876543210,+919876543210' }
      : null,
  });
  stub('../src/services/token.service', {
    generateAuthTokens: async () => ({ access: { token: 'access-1' }, refresh: { token: 'refresh-1' } }),
  });
  stub('../src/models', {
    User: {
      findOne: async () => null,
      create: async (body) => ({ id: 'user-1', ...body }),
    },
  });

  const index = fs.readFileSync(path.join(__dirname, '../src/routes/v1/index.js'), 'utf8');
  const mount = index.match(/path:\s*'([^']+)'\s*,\s*route:\s*storesAuthRoute/)[1];
  const dart = fs.readFileSync(
    path.join(__dirname, '../../Partner_app/lib/app/core/config/api_endpoints.dart'), 'utf8'
  );
  const endpoints = dart.match(/class StoresAuthEndpoints\s*\{([\s\S]*?)\n\}/)[1];
  const otpPath = endpoints.match(/registerSendOtp\s*=\s*'([^']+)'/)[1];
  const registerPath = endpoints.match(/registerPartner\s*=\s*'([^']+)'/)[1];

  const app = express();
  app.use(express.json());
  app.use(`/v1${mount}`, require('../src/modules/stores/routes/stores.auth.route'));
  app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ message: err.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (endpoint, body) => fetch(`${base}/${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const otp = { countryCode: '+91', mobileNumber: 9876543210, locale: 'en' };
  const signup = {
    id: 'otp-1', firstName: 'Test', lastName: 'Partner', countryCode: '+91',
    mobile: 9876543210, email: 'partner@example.com', password: 'Password123',
    locale: 'en', remember: true, userAgent: 'partner_app',
  };

  await t.test('OTP endpoint has a single auth prefix', async () => {
    const res = await post(otpPath, otp);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).id, 'otp-1');
    assert.equal(sent[0][2], '+919876543210');
    assert.equal(sent[0][6], 'register');
  });
  await t.test('account endpoint accepts the Stores signup fields', async () => {
    const res = await post(registerPath, signup);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.user.role, 'user');
    assert.equal(body.user.isMobileVerified, true);
    assert.deepEqual(body.verticals, ['stores']);
    assert.equal(body.tokens.access.token, 'access-1');
  });
  await t.test('role and dairy outlet fields remain rejected', async () => {
    assert.equal((await post(otpPath, { ...otp, role: 'dairyDriver' })).status, 400);
    assert.equal((await post(registerPath, { ...signup, role: 'user' })).status, 400);
    assert.equal((await post(registerPath, { ...signup, city: 'city-1' })).status, 400);
  });
  await t.test('missing OTP verification id remains rejected', async () => {
    const { id, ...unverified } = signup;
    assert.equal((await post(registerPath, unverified)).status, 400);
  });
  await t.test('an unverified OTP cannot create an account', async () => {
    assert.equal((await post(registerPath, { ...signup, id: 'unverified' })).status, 404);
  });
});
