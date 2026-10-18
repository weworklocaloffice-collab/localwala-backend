const { expect, describe, it, before, run } = require('./verify.harness');

describe('Test', function () {
  it('should work', async function () {
    console.log('test running');
  });
});

run();