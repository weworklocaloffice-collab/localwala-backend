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
const moneyField = require('../../../utils/money.field');
const { quantitySchema } = require('../utils/quantity');

/**
 * JhatkaCart — the customer's working basket, before an order exists.
 *
 * ## A cart is NOT an order, and the differences are the whole design
 *
 * | | Cart | Order |
 * |---|---|---|
 * | money | indicative, recomputed on read | frozen at checkout |
 * | price | live from the catalogue | snapshotted |
 * | stock | not reserved | reserved |
 * | tax | estimated | authoritative |
 * | line identity | client-local | server |
 *
 * The most important consequence: **a cart line has no `finalAmount`, no
 * `actualQuantity`, no `weightConfirmation` and no tax that anyone is liable for.**
 * A cart is a wish. The moment an order exists, `JhatkaOrderItem` takes over and the
 * two money contracts diverge — `estimatedAmount` on the cart is a DISPLAY figure
 * that is recomputed on every read, while on an order it is FROZEN and is the number
 * the customer was actually charged against. Conflating them is how a cart
 * quantity silently becomes a settled price.
 *
 * ## Money is recomputed on READ, never trusted from the client
 *
 * `estimatedTotal` here is derived from live catalogue prices every time the cart is
 * read. A client that POSTs its own total is ignored. This is the opposite of the
 * order contract on purpose: an order is a historical record that must not move, a
 * cart is a live view that must reflect today's prices. BR-06 is enforced at
 * checkout, where the numbers are frozen — not here, where nothing is owed yet.
 *
 * ## `subtotal` vs `estimatedTotal`
 *
 * `subtotal` is goods only. `taxTotal` is the tax on those goods. `estimatedTotal`
 * is what the customer would pay TODAY if they checked out right now, and it exists
 * so the customer app can render a number without re-deriving the arithmetic — with
 * the understanding that it can change until the order exists.
 *
 * ## One cart per (customer, outlet)
 *
 * Uniquely indexed. A basket spanning two butchers has no fulfilment story — the
 * first shop prepares it, the second shop's stock is never reserved, and the weight
 * reconciliation only works per outlet. Changing outlet therefore starts a new cart
 * rather than silently merging two shops' stock into one order.
 */
const jhatkaCartItemSchema = mongoose.Schema(
  {
    // ---- what was chosen ----
    product: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaProduct',
      required: true,
    },
    variant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaVariant',
      required: true,
    },

    // Snapshot for display. Cheap to refresh, and a renamed SKU must not make the
    // customer's own basket unreadable.
    sku: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    image: {
      type: String,
      required: false,
      trim: true,
    },

    /**
     * What the customer asked for.
     *
     * COUNT lines carry `PIECE`. WEIGHT lines carry `KG` or `GRAM` with an integer
     * value — the same integer-only rule as the order, so a cart cannot hold the
     * `1.5 KG` that the order path would reject. Integer quantities are a domain
     * rule here, not a UI convenience.
     */
    quantity: {
      type: quantitySchema,
      required: true,
    },

    /**
     * `WEIGHT` or `COUNT`, frozen from the variant at add time — the same BR-09
     * reasoning as `JhatkaOrderItem.isVariableWeight`. A cart line that changed basis
     * between add and checkout would be priced per kilo on one screen and per piece
     * on the next.
     */
    measurementMode: {
      type: String,
      required: true,
      enum: ['WEIGHT', 'COUNT'],
    },

    // ---- indicative money, RECOMPUTED ON READ ----
    /** Live price from the catalogue at read time, rupees. Never client-supplied. */
    unitPrice: moneyField(0),

    /** `unitPrice x quantity`, rupees. Derived, not authoritative. */
    lineTotal: moneyField(0),

    /**
     * Captured at add time so the customer can be told when a price MOVED before they
     * check out. Without it the app has no basis on which to say "this got cheaper".
     */
    unitPriceAtAdd: moneyField(0),

    /**
     * The live tax rate from the product, recomputed on read alongside `unitPrice`.
     *
     * Stored per LINE rather than on the cart because a basket can hold two GST rates,
     * and because F-1 requires the rate be snapshotted at order time — the cart copy is
     * what gets snapshotted.
     */
    taxRatePct: {
      type: Number,
      required: false,
      default: 0,
      min: 0,
      max: 100,
    },

    /** Tax on this line, rupees. Indicative until the order freezes it. */
    taxAmount: moneyField(0),

    /**
     * Set when the variant or product was archived/deactivated after this line was
     * added. The line is KEPT, not deleted: the customer needs to see which item is
     * blocking checkout and why, rather than finding their basket quietly shrunk.
     */
    unavailable: {
      type: Boolean,
      required: false,
      default: false,
    },

    /**
     * True when the live catalogue price differs from `unitPriceAtAdd`.
     *
     * This is the hook for the "price changed" notice at checkout. Without it the app
     * can only discover the change by comparing two numbers it may not both have.
     */
    priceChanged: {
      type: Boolean,
      required: false,
      default: false,
    },

    addedAt: {
      type: Date,
      required: false,
      default: Date.now,
    },
  },
  { _id: true }
);

const jhatkaCartSchema = mongoose.Schema(
  {
    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /**
     * REQUIRED. A cart without an outlet has no catalogue to price against, no stock
     * to check and no weight policy to apply, so it could not be checked out at all.
     */
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOutlet',
      required: true,
      index: true,
    },

    items: {
      type: [jhatkaCartItemSchema],
      default: [],
    },

    // ---- indicative totals: all recomputed on read ----
    /** Sum of `lineTotal`. Goods only, before tax. */
    subtotal: moneyField(0),

    /** Tax on `subtotal`, at the outlet's current rate. */
    taxTotal: moneyField(0),

    /** `subtotal + taxTotal` + fees. What checkout would cost RIGHT NOW. */
    estimatedTotal: moneyField(0),

    deliveryFee: moneyField(0),
    packagingFee: moneyField(0),

    /**
     * `pickup` or `delivery`. Pickup is not an afterthought: the COD ceiling, the
     * weight policy and the driver dispatch all differ, so the mode is part of the
     * cart's price rather than something decided after it is placed.
     */
    fulfilmentMode: {
      type: String,
      required: false,
      enum: ['delivery', 'pickup'],
      default: 'delivery',
    },

    /**
     * Delivery address, referenced not embedded. Address book entries are edited and
     * deleted independently; a cart holding a frozen copy of an address the customer
     * has since corrected is a delivery to the wrong house.
     */
    address: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'UserAddress',
      required: false,
    },

    instructions: {
      customerNote: { type: String, required: false, trim: true, maxlength: 500 },
    },

    /**
     * Abandoned-cart expiry. A cart older than this is treated as gone by
     * `purgeStaleCarts`, which exists because carts are never deleted on their own
     * and an abandoned basket is not an order, a reservation or a liability.
     */
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 7 * 86400000),
    },

    lastActivityAt: {
      type: Date,
      required: false,
      default: Date.now,
    },

    // Converted to an order, once. A cart may be checked out exactly once.
    convertedToOrder: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'JhatkaOrder',
      required: false,
    },
    convertedAt: {
      type: Date,
      required: false,
    },
  },
  {
    timestamps: true,
    toJSON,
    toObject: { virtuals: true },
    plugins: [paginate],
  }
);

/**
 * ONE cart per customer per outlet.
 *
 * Not cosmetic. Two carts for one customer means two baskets, and checkout must
 * choose one and leave the other — so the customer loses items without being told.
 * The unique index makes that state unreachable instead of merely unlikely.
 */
jhatkaCartSchema.index({ customer: 1, outlet: 1 }, { unique: true });

/** The purge sweep: `expiresAt < now`. Bounded by this index, not a collection scan. */
jhatkaCartSchema.index({ expiresAt: 1 });

/** "My carts", newest activity first — the common read after checkout creates one. */
jhatkaCartSchema.index({ customer: 1, lastActivityAt: -1 });

module.exports = mongoose.models.JhatkaCart ||
  mongoose.model('JhatkaCart', jhatkaCartSchema);
module.exports.schema = jhatkaCartSchema;
module.exports.itemSchema = jhatkaCartItemSchema;