/**
 * LocalWala - Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright Ac 2026 WeWorkLocal Private Limited
 * https://weworklocal.in/
 *
 * WeWorkLocal Private Limited
 *
 * This source code is confidential.
 * Unauthorized copying, redistribution, resale, publication,
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

/**
 * verify.stores.postsale.js - customer reviews, returns and exchanges.
 *
 * Run: node scripts/verify.stores.postsale.js
 *
 * ## What this pins
 *
 *   BR-19  returns derive outlet, chain, price and refund from the ORDER. A
 *          customer cannot inflate `refundAmount` or return another customer's
 *          order.
 *   BR-20  exchanges derive the replacement name and price delta server-side;
 *          a same-item exchange costs nothing, a pricier replacement demands
 *          payment.
 *   A5.15  exactly one review per delivered order, owned by its customer.
 *   A5.9   the return window is counted from delivery and refuses late requests.
 *
 * The regression this suite exists to stop: the customer app sent only
 * `{order, reason}`. `createReturnRequest` called `items.reduce` on undefined,
 * so every return and exchange 500'd, while the review route stored no
 * `chain`/`outlet` and failed Mongoose validation. The API trusted prices from
 * the client as well. These checks make the customer surface both reachable
 * and safe.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const returnService = require('../src/modules/stores/services/stores.return.service');
const reviewService = require('../src/modules/stores/services/stores.review.service');
const V = require('../src/modules/stores/validations/stores.validation');

require('../src/modules/stores/models/store.order.model');
require('../src/modules/stores/models/store.return.request.model');
require('../src/modules/stores/models/store.exchange.request.model');
require('../src/modules/stores/models/store.review.model');
require('../src/modules/stores/models/store.policy.model');
require('../src/modules/stores/models/store.outlet.stock.item.model');
require('../src/modules/stores/models/chain.product.model');
require('../src/modules/stores/models/chain.product.variant.model');

const StoreOrder = mongoose.model('StoreOrder');
const StoreReturnRequest = mongoose.model('StoreReturnRequest');
const StoreExchangeRequest = mongoose.model('StoreExchangeRequest');
const StoreReview = mongoose.model('StoreReview');
const StoreOutletStockItem = mongoose.model('StoreOutletStockItem');
const ChainProduct = mongoose.model('ChainProduct');
const ChainProductVariant = mongoose.model('ChainProductVariant');

let failures = 0;
const ck = (label, condition, detail) => {
  if (condition) {
    console.log('  PASS  ' + label);
  } else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail !== undefined ? ' -> ' + detail : ''));
  }
};

const OUTLET = new mongoose.Types.ObjectId();
const CHAIN = new mongoose.Types.ObjectId();
const CUSTOMER = new mongoose.Types.ObjectId();
const OTHER_CUSTOMER = new mongoose.Types.ObjectId();
const PRODUCT = new mongoose.Types.ObjectId();
const VARIANT = new mongoose.Types.ObjectId();
const PRODUCT_2 = new mongoose.Types.ObjectId();
const VARIANT_2 = new mongoose.Types.ObjectId();
const CATEGORY = new mongoose.Types.ObjectId();

const nextOrderNo = () => 9700000 + Math.floor(Math.random() * 89999);

const makeOrder = (overrides = {}) =>
  StoreOrder.create({
    orderNo: nextOrderNo(),
    customer: CUSTOMER,
    outlet: OUTLET,
    chain: CHAIN,
    items: [
      {
        product: PRODUCT,
        variant: VARIANT,
        name: 'Cotton shirt',
        variantName: 'Medium',
        sku: 'SHIRT-M',
        quantity: 2,
        orderedQuantity: 2,
        fulfilledQuantity: 2,
        cancelledQuantity: 0,
        unitPrice: 100,
        discountAmount: 0,
        taxAmount: 36,
        lineTotal: 200,
        lineGrand: 236,
        fulfilment: 'picked',
      },
    ],
    itemsSubtotal: 200,
    deliveryFee: 40,
    grandTotal: 276,
    paymentMode: 'gateway',
    paymentStatus: 'paid',
    paidAmount: 276,
    lifecycle: 'delivered',
    deliveredAt: new Date(),
    invoiceStatus: 'issued',
    invoiceNo: 'POSTSALE-' + Date.now() + '-' + Math.floor(Math.random() * 100000),
    ...overrides,
  });

const expectCode = async (label, fn, code) => {
  try {
    await fn();
    ck(label, false, 'did not throw');
  } catch (error) {
    ck(label, String(error.message).includes(code), error.message);
  }
};

const cleanup = async () => {
  await StoreReview.deleteMany({ outlet: OUTLET });
  await StoreReturnRequest.deleteMany({ outlet: OUTLET });
  await StoreExchangeRequest.deleteMany({ outlet: OUTLET });
  await StoreOutletStockItem.deleteMany({ outlet: OUTLET });
  await StoreOrder.deleteMany({ outlet: OUTLET });
  await ChainProductVariant.deleteMany({ chain: CHAIN });
  await ChainProduct.deleteMany({ chain: CHAIN });
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL);

  await ChainProduct.create({
    _id: PRODUCT,
    chain: CHAIN,
    name: 'Cotton shirt',
    category: CATEGORY,
    status: 'active',
  });
  await ChainProduct.create({
    _id: PRODUCT_2,
    chain: CHAIN,
    name: 'Linen shirt',
    category: CATEGORY,
    status: 'active',
  });
  await ChainProductVariant.create({
    _id: VARIANT,
    chain: CHAIN,
    product: PRODUCT,
    sku: 'SHIRT-M',
    name: 'Medium',
    price: 100,
    priceInPaise: 10000,
    status: 'active',
  });
  await ChainProductVariant.create({
    _id: VARIANT_2,
    chain: CHAIN,
    product: PRODUCT_2,
    sku: 'LINEN-L',
    name: 'Large',
    price: 150,
    priceInPaise: 15000,
    status: 'active',
  });
  await StoreOutletStockItem.create({
    outlet: OUTLET,
    chain: CHAIN,
    product: PRODUCT,
    variant: VARIANT,
    onHand: 5,
    reserved: 0,
    availableQty: 5,
  });
  await StoreOutletStockItem.create({
    outlet: OUTLET,
    chain: CHAIN,
    product: PRODUCT_2,
    variant: VARIANT_2,
    onHand: 5,
    reserved: 0,
    availableQty: 5,
  });

  console.log('\n=== customer validation rejects client-owned money ===\n');
  const validReturnBody = {
    order: String(new mongoose.Types.ObjectId()),
    items: [{ product: String(PRODUCT), variant: String(VARIANT), quantity: 1 }],
    reason: 'damaged on arrival',
    reasonCategory: 'damaged_in_delivery',
  };
  ck(
    'a minimal customer return body validates',
    !V.customerReturnCreateValidation.body.validate(validReturnBody).error
  );
  ck(
    'a client-supplied refundAmount is rejected',
    !!V.customerReturnCreateValidation.body.validate({
      ...validReturnBody,
      items: [{ ...validReturnBody.items[0], refundAmount: 1 }],
    }).error
  );
  ck(
    'a review body validates without chain/outlet/product',
    !V.orderReviewValidation.body.validate({ rating: 5, comment: 'good' }).error
  );

  console.log('\n=== BR-19: returns derive money and ownership from the order ===\n');
  const returnOrder = await makeOrder();
  const created = await returnService.createCustomerReturnRequest({
    order: returnOrder._id,
    customer: CUSTOMER,
    items: [
      {
        product: PRODUCT,
        variant: VARIANT,
        quantity: 1,
        condition: 'damaged',
        refundAmount: 1,
      },
    ],
    reason: 'damaged on arrival',
    reasonCategory: 'damaged_in_delivery',
  });
  ck('the request starts as requested', created.status === 'requested', created.status);
  ck('the outlet comes from the order', String(created.outlet) === String(OUTLET));
  ck('the chain comes from the order', String(created.chain) === String(CHAIN));
  ck('the name is the order snapshot', created.items[0].name === 'Cotton shirt - Medium', created.items[0].name);
  ck('the refund is half of the two-unit lineGrand', created.items[0].refundAmount === 118, created.items[0].refundAmount);
  ck('the total refund is the sum of lines', created.totalRefundAmount === 118, created.totalRefundAmount);
  ck(
    'a client refundAmount cannot replace the derived one',
    created.items[0].refundAmount !== 1
  );

  await expectCode(
    'another customer cannot return the order',
    () =>
      returnService.createCustomerReturnRequest({
        order: returnOrder._id,
        customer: OTHER_CUSTOMER,
        items: [{ product: PRODUCT, variant: VARIANT, quantity: 1 }],
        reason: 'not mine',
      }),
    'ORDER_NOT_OWNED'
  );

  await expectCode(
    'only the remaining unit can be returned',
    () =>
      returnService.createCustomerReturnRequest({
        order: returnOrder._id,
        customer: CUSTOMER,
        items: [{ product: PRODUCT, variant: VARIANT, quantity: 2 }],
        reason: 'too many',
      }),
    'RETURN_QUANTITY_EXCEEDED'
  );

  const unpaidOrder = await makeOrder({ lifecycle: 'driver_assigned', deliveredAt: undefined });
  await expectCode(
    'an undelivered order cannot be returned',
    () =>
      returnService.createCustomerReturnRequest({
        order: unpaidOrder._id,
        customer: CUSTOMER,
        items: [{ product: PRODUCT, variant: VARIANT, quantity: 1 }],
        reason: 'too early',
      }),
    'ORDER_NOT_POST_SALE'
  );

  const staleOrder = await makeOrder({
    deliveredAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
  });
  await expectCode(
    'a return past the seven-day window is refused',
    () =>
      returnService.createCustomerReturnRequest({
        order: staleOrder._id,
        customer: CUSTOMER,
        items: [{ product: PRODUCT, variant: VARIANT, quantity: 1 }],
        reason: 'too late',
      }),
    'RETURN_WINDOW_CLOSED'
  );

  console.log('\n=== BR-20: exchanges derive the replacement and price delta ===\n');
  const evenOrder = await makeOrder();
  const even = await returnService.createCustomerExchangeRequest({
    order: evenOrder._id,
    customer: CUSTOMER,
    items: [{ originalProduct: PRODUCT, originalVariant: VARIANT, quantity: 1 }],
    reason: 'defective',
    reasonCategory: 'defective',
  });
  ck('a same-item exchange needs no payment', even.paymentRequired === false, even.paymentRequired);
  ck('and records paymentStatus not_required', even.paymentStatus === 'not_required', even.paymentStatus);
  ck('the replacement defaults to the purchased variant', String(even.items[0].exchangeForVariant) === String(VARIANT));
  ck('the replacement name is the order snapshot', even.items[0].exchangeForName === 'Cotton shirt - Medium');

  const upgradeOrder = await makeOrder();
  const upgrade = await returnService.createCustomerExchangeRequest({
    order: upgradeOrder._id,
    customer: CUSTOMER,
    items: [
      {
        originalProduct: PRODUCT,
        originalVariant: VARIANT,
        exchangeForProduct: PRODUCT_2,
        exchangeForVariant: VARIANT_2,
        quantity: 1,
      },
    ],
    reason: 'wanted a different fit',
    reasonCategory: 'size_fit',
  });
  ck('a pricier replacement requires payment', upgrade.paymentRequired === true, upgrade.paymentRequired);
  ck('the delta is computed from catalogue prices', upgrade.paymentAmount === 50, upgrade.paymentAmount);
  ck('the replacement name comes from the catalogue', upgrade.items[0].exchangeForName === 'Linen shirt - Large');
  ck('the original name comes from the order', upgrade.items[0].originalName === 'Cotton shirt - Medium');

  const unavailableOrder = await makeOrder();
  await expectCode(
    'an exchange with no replacement stock is refused',
    () =>
      returnService.createCustomerExchangeRequest({
        order: unavailableOrder._id,
        customer: CUSTOMER,
        items: [
          {
            originalProduct: PRODUCT,
            originalVariant: VARIANT,
            exchangeForProduct: PRODUCT_2,
            exchangeForVariant: new mongoose.Types.ObjectId(),
            quantity: 1,
          },
        ],
        reason: 'missing variant',
      }),
    'EXCHANGE_UNAVAILABLE'
  );

  console.log('\n=== BR-15: one review per delivered order ===\n');
  const reviewOrder = await makeOrder();
  const review = await reviewService.createOrderReview({
    order: reviewOrder._id,
    customer: CUSTOMER,
    rating: 5,
    comment: 'Arrived hot and on time',
  });
  ck('the review stores the order outlet', String(review.outlet) === String(OUTLET));
  ck('the review stores the order chain', String(review.chain) === String(CHAIN));
  ck('the review is a verified purchase', review.isVerifiedPurchase === true);
  ck('the review waits for moderation', review.status === 'pending', review.status);

  await expectCode(
    'a second review for the same order is refused',
    () =>
      reviewService.createOrderReview({
        order: reviewOrder._id,
        customer: CUSTOMER,
        rating: 1,
      }),
    'REVIEW_ALREADY_EXISTS'
  );

  await expectCode(
    'another customer cannot review the order',
    () =>
      reviewService.createOrderReview({
        order: reviewOrder._id,
        customer: OTHER_CUSTOMER,
        rating: 1,
      }),
    'ORDER_NOT_OWNED'
  );

  const earlyOrder = await makeOrder({ lifecycle: 'out_for_delivery', deliveredAt: undefined });
  await expectCode(
    'an undelivered order cannot be reviewed',
    () =>
      reviewService.createOrderReview({
        order: earlyOrder._id,
        customer: CUSTOMER,
        rating: 5,
      }),
    'ORDER_NOT_REVIEWABLE'
  );
};

run()
  .catch((error) => {
    failures += 1;
    console.error(error);
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (error) {
      failures += 1;
      console.error('cleanup failed', error);
    }
    await mongoose.disconnect();
    console.log('\n' + (failures === 0 ? 'ALL POST-SALE CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
    process.exit(failures === 0 ? 0 : 1);
  });
