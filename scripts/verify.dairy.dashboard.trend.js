const assert = require('assert');
const { DairyOrder } = require('../src/models');
const { getSalesTrend } = require('../src/modules/dairy/services/dairy.dashboard.service');
const { dashboardValidation } = require('../src/modules/dairy/validations/dairy.dashboard.validation');

const originalAggregate = DairyOrder.aggregate;
let calls = 0;
DairyOrder.aggregate = () => {
  calls += 1;
  return Promise.resolve([
    { _id: '2026-11-06', orders: 2, revenue: 25000 },
    { _id: '2026-10-30', orders: 1, revenue: 10000 },
  ]);
};

(async () => {
  assert.strictEqual(dashboardValidation.query.validate({ period: '30d' }).error, undefined);
  assert(dashboardValidation.query.validate({ period: '365d' }).error);
  const trend = await getSalesTrend('business-1', 7, new Date(2026, 10, 6));
  assert.strictEqual(calls, 1);
  assert.strictEqual(trend.days.length, 7);
  assert.strictEqual(trend.totalOrders, 2);
  assert.strictEqual(trend.totalRevenue, 250);
  assert.strictEqual(trend.previousOrders, 1);
  assert.strictEqual(trend.previousRevenue, 100);
  assert.strictEqual(trend.days[6].date, '2026-11-06');
  console.log('Dairy dashboard trend checks passed.');
})().finally(() => {
  DairyOrder.aggregate = originalAggregate;
});
