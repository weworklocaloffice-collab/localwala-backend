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

const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');

/**
 * DairyOrder — a one-time dairy purchase.
 *
 * Deliberately a separate collection from `Orders`. `Orders.restaurant` is
 * `required: true` (`models/orders.model.js:45`) and `Food.restaurant` likewise
 * (`models/food.model.js:38`), and the order service that reads them is 441 KB with
 * no test coverage. Extending that model would mean touching hundreds of
 * `populate` calls, aggregation pipelines and ExcelJS exports for a vertical whose
 * catalogue is keyed on `DairySku`, not `Food`.
 *
 * Subscription occurrences do **not** create `DairyOrder` documents. They flow
 * `DairySubscription` → `DairyRecurringOrder` → `DeliveryStop`, so the two purchase
 * modes never contend for the same table and order numbering stays meaningful.
 */
const dairyOrderSchema = mongoose.Schema(
  {
    orderNo: {
      type: Number,
      required: true,
    },
    /**
     * Always `one_time` on this collection. Kept explicit so a future
     * subscription-with-immediate-delivery case is a deliberate change rather
     * than an ambiguity.
     */
    mode: {
      type: String,
      required: false,
      default: 'one_time',
    },
    user: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    business: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Business',
      required: true,
    },
    items: [
      {
        sku: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'DairySku',
          required: true,
        },
        name: {
          type: String,
          required: false,
        },
        packSize: {
          value: {
            type: String,
            required: false,
          },
          unit: {
            type: String,
            required: false,
          },
        },
        quantity: {
          type: Number,
          required: true,
        },
        /** Rupees, frozen at checkout. */
        price: {
          type: Number,
          required: false,
          get: (v) => Number((v / 100).toFixed(2)),
          set: (v) => Math.round(v * 100),
          default: 0,
        },
        /**
         * FEFO allocation. Set once raw-milk batches exist (procurement slice);
         * empty for packaged product, which is not batch tracked.
         */
        batchAllocation: {
          type: Array,
          default: [],
        },
        /** Cans attached to this line when the SKU is reusable. */
        canCodes: {
          type: [String],
          default: [],
        },
      },
    ],
    itemTotal: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    /**
     * Refundable can deposits for this order.
     *
     * This is **not revenue and not part of what the customer pays for goods**.
     * It is money held against reusable containers: taken from the wallet when the
     * cans are issued, and given back when the cans come home. It is kept out of
     * `grandTotal` for exactly that reason — see `codCollectionAmount`.
     */
    depositTotal: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    serviceCharge: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    taxAmount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    discountAmount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    /**
     * What the customer actually pays for this order: goods + delivery + tax −
     * discount. The can deposit is deliberately excluded, because it is refunded
     * on return and must never be treated as a sale.
     *
     * For a prepaid order this is debited from the wallet. For a COD order it is
     * the platform's income and the basis for outlet revenue and settlements.
     */
    grandTotal: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    /**
     * What the rider must collect in cash at the door: `grandTotal` plus the can
     * deposits, because cash-on-delivery has no wallet hold to lean on.
     *
     * Only meaningful for COD orders. This is the number on the rider's stop, so
     * keeping it separate is what stops a deposit being charged twice on prepaid
     * orders while still being collected in cash on COD ones.
     */
    codCollectionAmount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    address: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'UserAddress',
      required: false,
    },
    addressRaw: {
      type: String,
      required: false,
    },
    receiverName: {
      type: String,
      required: false,
    },
    receiverContact: {
      type: Number,
      required: false,
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: {
        type: [Number],
        required: false,
      },
    },
    deliverySlot: {
      startTime: {
        type: String,
        required: false,
      },
      endTime: {
        type: String,
        required: false,
      },
    },
    /**
     * Reused platform payment config, so dairy orders settle through the same
     * gateway and reconciliation as the rest of the platform.
     */
    payment: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'PaymentConfig',
      required: false,
    },
    paymentMode: {
      type: String,
      required: false,
      default: 'wallet', // wallet, cod, gateway
    },
    paymentStatus: {
      type: String,
      required: false,
      default: 'pending', // pending, paid, failed, refunded, partially_refunded
    },
    wallet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Wallet',
      required: false,
    },
    walletAmount: {
      type: Number,
      required: false,
      get: (v) => Number((v / 100).toFixed(2)),
      set: (v) => Math.round(v * 100),
      default: 0,
    },
    /** Set once the order has been folded into a delivery run. */
    run: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DeliveryRun',
      required: false,
    },
    stop: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DeliveryStop',
      required: false,
    },
    /**
     * Subscription provenance. A recurring order is not a special order type — it
     * is an ordinary order the platform raised on the customer's behalf, so it is
     * paid, delivered, refunded and settled through exactly the same path. These
     * two links are what let a subscription delivery be traced back to the plan
     * that caused it, and what stops a plan being billed twice for one date.
     */
    subscription: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairySubscription',
      required: false,
    },
    /** The occurrence this order bills. Unique, so one occurrence bills once. */
    recurringOrder: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DairyRecurringOrder',
      required: false,
    },
    /** Cans issued with this order, for deposit reconciliation. */
    cansIssued: {
      type: [String],
      default: [],
    },
    /**
     * Snapshotted cart contents at checkout, matching the `cartItemRaw`
     * convention used by `Orders` so support can reconstruct what was shown.
     */
    cartItemRaw: {
      type: String,
      required: false,
    },
    status: {
      type: String,
      required: false,
      default: 'pending_payments', // pending_payments, confirmed, preparing,
      // out_for_delivery, delivered, cancelled, refunded
    },
    cancellation: {
      cancelledAt: {
        type: Date,
        required: false,
      },
      cancelledBy: {
        type: String,
        required: false,
      },
      reason: {
        type: String,
        required: false,
      },
    },
    deliveredAt: {
      type: Date,
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

// add plugin that converts mongoose to json & convert to unique slug
dairyOrderSchema.plugin(toJSON);
dairyOrderSchema.plugin(paginate);
dairyOrderSchema.index({ orderNo: 1 }, { unique: true });
dairyOrderSchema.index({ user: 1, status: 1, createdAt: -1 });
dairyOrderSchema.index({ business: 1, status: 1, createdAt: -1 });
dairyOrderSchema.index({ 'items.sku': 1 });
dairyOrderSchema.index({ cansIssued: 1 });
// One occurrence bills exactly once, so the nightly job can be retried safely.
dairyOrderSchema.index({ recurringOrder: 1 }, { unique: true, sparse: true });
// Outlet subscription revenue, for statements and settlement runs.
dairyOrderSchema.index({ business: 1, mode: 1, deliveredAt: -1 });

/**
 * @typedef DairyOrder
 */
const DairyOrder = mongoose.model('DairyOrder', dairyOrderSchema);

module.exports = DairyOrder;