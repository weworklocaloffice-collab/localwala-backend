const assert = require('assert');
const { Business, DairyCoupon, DairyCouponRedemption } = require('../src/models');
const couponService = require('../src/modules/dairy/services/dairy.coupon.service');

const couponId = '690000000000000000000001';
const businessId = '690000000000000000000002';
const coupon = {
  _id: couponId,
  business: businessId,
  code: 'MILK10',
  title: 'Milk offer',
  status: 'active',
  startsAt: new Date('2026-11-01T00:00:00.000Z'),
  endsAt: new Date('2026-12-01T00:00:00.000Z'),
  maxRedemptions: 100,
  redeemedCount: 4,
  reservedCount: 2,
};

const originals = {
  couponFindOne: DairyCoupon.findOne,
  businessFindOne: Business.findOne,
  redemptionAggregate: DairyCouponRedemption.aggregate,
  redemptionCountDocuments: DairyCouponRedemption.countDocuments,
};

async function main() {
  let aggregateCalls = 0;
  DairyCoupon.findOne = (filter) => ({
    select: async () => filter._id === couponId && filter.business === businessId ? coupon : null,
  });
  Business.findOne = (filter) => ({
    select: async () => filter._id === businessId && filter.vertical === 'dairy'
      ? { dairyOperations: { timezone: 'Asia/Kolkata' } }
      : null,
  });
  DairyCouponRedemption.aggregate = async (pipeline) => {
    aggregateCalls += 1;
    const match = pipeline[0].$match;
    assert.strictEqual(String(match.coupon), couponId);
    assert.strictEqual(String(match.business), businessId);
    assert.strictEqual(match.status, 'redeemed');
    assert.ok(match.redeemedAt.$gte instanceof Date);
    assert.ok(match.redeemedAt.$lt instanceof Date);
    if (pipeline.some((stage) => stage.$sort)) {
      return [{ _id: '2026-11-05', redemptions: 2, discountPaise: 1250 }];
    }
    return [{ _id: null, redemptions: 2, discountPaise: 1250 }];
  };
  DairyCouponRedemption.countDocuments = async (filter) => {
    assert.strictEqual(String(filter.coupon), couponId);
    assert.strictEqual(String(filter.business), businessId);
    if (filter.status === 'reserved') return 2;
    if (filter.status === 'released' && filter.redeemedAt) return 1;
    if (filter.status === 'released') return 3;
    return 0;
  };

  const report = await couponService.getPartnerCouponReport({
    businessId,
    couponId,
    from: '2026-11-01T00:00:00.000Z',
    to: '2026-11-06T00:00:00.000Z',
  });
  assert.strictEqual(aggregateCalls, 2);
  assert.strictEqual(report.coupon.code, 'MILK10');
  assert.strictEqual(report.period.timezone, 'Asia/Kolkata');
  assert.strictEqual(report.summary.redemptions, 2);
  assert.strictEqual(report.summary.discountAmount, 12.5);
  assert.strictEqual(report.summary.averageDiscount, 6.25);
  assert.strictEqual(report.summary.reservedCount, 2);
  assert.strictEqual(report.summary.releasedCount, 3);
  assert.strictEqual(report.summary.cancelledAfterRedemptionCount, 1);
  assert.deepStrictEqual(report.daily, [{ date: '2026-11-05', redemptions: 2, discountAmount: 12.5 }]);
  assert.ok(!JSON.stringify(report).includes('user'));

  await assert.rejects(
    couponService.getPartnerCouponReport({
      businessId,
      couponId,
      from: '2025-10-01T00:00:00.000Z',
      to: '2026-11-06T00:00:00.000Z',
    }),
    /at most 366 days/
  );

  console.log('Dairy coupon redemption report checks passed.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    DairyCoupon.findOne = originals.couponFindOne;
    Business.findOne = originals.businessFindOne;
    DairyCouponRedemption.aggregate = originals.redemptionAggregate;
    DairyCouponRedemption.countDocuments = originals.redemptionCountDocuments;
  });
