// Run with: node --test scripts/verify.auth.refresh.js
// Checks the real refresh service and controller wrappers without a database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ApiError = require('../src/utils/ApiError');
const catchAsync = require('../src/utils/catchAsync');

const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8');
const serviceDefinition = read('../src/services/auth.service.js').match(
  /const refreshAuthApp = async \(refreshToken\) => \{[\s\S]*?\n\};/
);
const controllerDefinition = read('../src/controllers/auth.controller.js').match(
  /const refreshTokensApp = catchAsync\(async \(req, res\) => \{[\s\S]*?\n\}\);/
);
assert.ok(serviceDefinition, 'refreshAuthApp service was not found');
assert.ok(controllerDefinition, 'refreshTokensApp controller was not found');

let verifyRefresh;
let resolvedUser;
let deleted = 0;
const rotated = {
  access: { token: 'fresh-access', expires: new Date('2030-01-01') },
  refresh: { token: 'fresh-refresh', expires: new Date('2030-02-01') },
};
const serviceContext = {
  httpStatus: { UNAUTHORIZED: 401 },
  tokenTypes: { REFRESH: 'refresh' },
  ApiError,
  tokenService: {
    verifyToken: (...args) => verifyRefresh(...args),
    generateAuthTokens: async () => rotated,
  },
  userService: { getUserById: async () => resolvedUser },
};
vm.createContext(serviceContext);
vm.runInContext(`${serviceDefinition[0]}\nglobalThis.refreshAuthApp = refreshAuthApp;`, serviceContext);

test('invalid refresh credentials reject with an operational 401', async () => {
  verifyRefresh = async () => { throw new Error('jwt malformed'); };
  await assert.rejects(serviceContext.refreshAuthApp('malformed'), (error) => {
    assert.equal(error.statusCode, 401);
    assert.equal(error.message, 'Please authenticate');
    assert.equal(error.isOperational, true);
    return true;
  });
});

test('valid refresh credentials rotate both nested token objects', async () => {
  deleted = 0;
  const tokenRecord = { user: 'user-1', deleteOne: async () => { deleted++; } };
  verifyRefresh = async (value, type) => {
    assert.equal(value, 'old-refresh');
    assert.equal(type, 'refresh');
    return tokenRecord;
  };
  resolvedUser = { id: 'user-1' };

  assert.equal(await serviceContext.refreshAuthApp('old-refresh'), rotated);
  assert.equal(deleted, 1);
});

test('refresh controller forwards service failures to API error middleware', async () => {
  verifyRefresh = async () => { throw new Error('token not found'); };
  const controllerContext = { catchAsync, authService: { refreshAuthApp: serviceContext.refreshAuthApp } };
  vm.createContext(controllerContext);
  vm.runInContext(`${controllerDefinition[0]}\nglobalThis.refreshTokensApp = refreshTokensApp;`, controllerContext);

  const result = await new Promise((resolve) => {
    controllerContext.refreshTokensApp(
      { body: { refreshToken: 'invalid' } },
      { send: (body) => resolve({ status: 200, body }) },
      (error) => resolve({ status: error.statusCode, message: error.message }),
    );
  });
  assert.equal(result.status, 401);
  assert.equal(result.message, 'Please authenticate');
});
