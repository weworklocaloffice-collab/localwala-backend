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
 * modification, or use of this public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');

const storeOrderItemSchema = new mongoose.Schema(
  {
    _id: false,
    product: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ChainProduct',
      required: true,
    },
    variant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ChainProductVariant',
      required: true,
    },
    name: { type: String, required: true },
    variantName: { type: String },
    image: { type: String },
    attributes: [
      {
        _id: false,
        key: String,
        label: String,
        value: mongoose.SchemaTypes.Mixed,
      },
    ],
    sku: { type: String },
    unitPrice: { type: Number, required: true },
    discountAmount: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    taxPercentage: { type: Number, default: 0 },
    // BR-41: the line's tax, frozen at order time. `gstRate` is the rate that
    // was in force (not a pointer to today's table); the CGST/SGST/IGST
    // split records which side of the state line the sale fell on (§6.19).
    // Historical orders are never recalculated from current tax config.
    hsn: { type: String },
    gstRate: { type: Number, default: 0 },
    taxableValue: { type: Number, default: 0 },
    cgstAmount: { type: Number, default: 0 },
    sgstAmount: { type: Number, default: 0 },
    igstAmount: { type: Number, default: 0 },
    lineTotal: { type: Number, required: true },
    lineGrand: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
    fulfilledQuantity: { type: Number, default: 0 },
    cancelledQuantity: { type: Number, default: 0 },
    refundedQuantity: { type: Number, default: 0 },
    refundedAmount: { type: Number, default: 0 },
    isOrganic: { type: Boolean, default: false },
    organicBadge: { type: String },
    fulfilment: {
      type: String,
      default: 'pending',
      enum: ['pending', 'picked', 'partial', 'unavailable', 'substituted', 'cancelled'],
    },
    substituteVariant: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ChainProductVariant',
    },
    resolution: { type: String },
    resolutionNote: { type: String },
  },
  { _id: false }
);

const storeOrderSchema = mongoose.Schema(
  {
    orderNo: { type: Number, required: true },
    customer: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: true,
    },
    outlet: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreOutlet',
      required: true,
    },
    chain: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreChain',
      required: true,
    },
    items: [storeOrderItemSchema],
    address: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'UserAddress',
    },
    addressSnapshot: {
      name: String,
      contact: String,
      countryCode: String,
      line1: String,
      line2: String,
      area: String,
      city: String,
      locality: String,
      pincode: String,
      location: {
        type: { type: String, enum: ['Point'] },
        coordinates: [Number],
      },
    },
    itemsSubtotal: { type: Number, default: 0 },
    itemDiscountTotal: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    // Header roll-ups of the frozen per-line splits (BR-41, §6.19). Written
    // once at creation from the same basket the lines came from — never
    // recomputed, so the invoice always agrees with the lines.
    cgstTotal: { type: Number, default: 0 },
    sgstTotal: { type: Number, default: 0 },
    igstTotal: { type: Number, default: 0 },
    // Place of supply, frozen (§6.19). Decides CGST+SGST vs IGST on the
    // invoice; a null customerStateCode means intra-state local delivery.
    placeOfSupply: {
      outletStateCode: { type: String },
      customerStateCode: { type: String },
      intraState: { type: Boolean, default: true },
    },
    deliveryFee: { type: Number, default: 0 },
    deliveryTax: { type: Number, default: 0 },
    packagingFee: { type: Number, default: 0 },
    serviceFee: { type: Number, default: 0 },
    deliveryTip: { type: Number, default: 0 },
    discountTotal: { type: Number, default: 0 },
    grandTotal: { type: Number, required: true },
    codAmount: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 },
    refundedAmount: { type: Number, default: 0 },
    promo: {
      promotion: {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'StorePromotion',
      },
      title: String,
      discountAmount: { type: Number, default: 0 },
      freeDelivery: { type: Boolean, default: false },
    },
    coupon: {
      coupon: {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'Coupon',
      },
      title: String,
      discountAmount: { type: Number, default: 0 },
    },
    payment: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'PaymentConfig',
    },
    paymentMode: {
      type: String,
      enum: ['gateway', 'wallet', 'cod'],
    },
    paymentStatus: {
      type: String,
      default: 'pending',
      enum: ['pending', 'paid', 'failed', 'partially_refunded', 'refunded'],
    },
    paymentRef: { type: String },
    paidAt: { type: Date },
    // BR-43: the invoice number, server-controlled and per outlet. Issued on
    // the `paid` transition, never at creation; a cancelled-after-paid order
    // keeps its number with status `void` — numbers are never reused.
    invoiceNo: { type: String, sparse: true, unique: true },
    invoiceStatus: {
      type: String,
      default: 'none',
      enum: ['none', 'issued', 'void'],
    },
    lifecycle: {
      type: String,
      required: true,
      default: 'created',
      enum: [
        'created',
        'payment_pending',
        'paid',
        'store_received',
        'accepted',
        'picking',
        'packing',
        'ready',
        'driver_assigned',
        'picked_up',
        'out_for_delivery',
        'delivered',
        'completed',
        'rejected',
        'cancelled',
        'payment_failed',
      ],
    },
    postOrder: {
      type: String,
      default: 'none',
      enum: [
        'none',
        'return_requested',
        'return_approved',
        'returned',
        'exchange_requested',
        'exchanged',
        'refund_pending',
        'refunded',
        'warranty_open',
      ],
    },
    postOrderRef: {
      type: mongoose.SchemaTypes.ObjectId,
    },
    cancellation: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreCancellation',
    },
    picking: {
      startedAt: Date,
      completedAt: Date,
      by: {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'User',
      },
      byName: String,
      items: [
        {
          _id: false,
          item: {
            type: mongoose.SchemaTypes.ObjectId,
            ref: 'ChainProductVariant',
          },
          // The journal row records the pick DECISION, using the same status vocabulary as the
          // line it resolves. `substituted` was missing here while present on the line
          // (`fulfilment`), so every BR-31 substitution — the one flow that must be
          // recorded — died on validation at save time.
          status: {
            type: String,
            enum: ['picked', 'partial', 'unavailable', 'substituted'],
          },
          pickedQuantity: Number,
          resolution: {
            type: String,
            enum: ['remove', 'substitute', 'contact', 'cancel_item'],
          },
          substituteVariant: {
            type: mongoose.SchemaTypes.ObjectId,
            ref: 'ChainProductVariant',
          },
          note: String,
        },
      ],
    },
    packing: {
      completedAt: Date,
      packageCount: { type: Number, default: 1 },
      totalWeightGrams: Number,
      fragile: Boolean,
      specialHandling: String,
      note: String,
    },
    delivery: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'StoreDelivery',
    },
    instructions: {
      customerNote: String,
      storeNote: String,
    },
    placedAt: { type: Date, default: Date.now },
    acceptedAt: Date,
    readyAt: Date,
    pickedUpAt: Date,
    deliveredAt: Date,
    completedAt: Date,
    promisedDeliveryAt: Date,
    totalItems: { type: Number, default: 0 },
    totalQuantity: { type: Number, default: 0 },
    categorySnapshot: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'StoreCategory',
      },
    ],
  },
  {
    timestamps: true,
  }
);

storeOrderSchema.plugin(toJSON);
storeOrderSchema.plugin(paginate);

storeOrderSchema.index({ orderNo: 1 }, { unique: true });
storeOrderSchema.index({ outlet: 1, lifecycle: 1, createdAt: -1 });
storeOrderSchema.index({ customer: 1, createdAt: -1 });
storeOrderSchema.index({ outlet: 1, createdAt: -1, 'items.product': 1 });
storeOrderSchema.index({ 'promo.promotion': 1 }, { sparse: true });
storeOrderSchema.index({ chain: 1, lifecycle: 1 });

storeOrderSchema.statics.findByOutlet = async function (outletId, { lifecycle } = {}) {
  const filter = { outlet: outletId };
  if (lifecycle) filter.lifecycle = lifecycle;
  return this.find(filter).sort({ createdAt: -1 });
};

storeOrderSchema.statics.findByCustomer = async function (customerId) {
  return this.find({ customer: customerId }).sort({ createdAt: -1 });
};

module.exports = mongoose.model('StoreOrder', storeOrderSchema);