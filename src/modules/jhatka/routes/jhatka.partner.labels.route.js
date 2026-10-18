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

/**
 * jhatka.partner.labels.route.js — FSSAI labelling and batch traceability. -11.
 *
 * ## A label is a legal document, not a receipt
 *
 * -11 of the FSSAI standards requires a retail label to carry the product name,
 * net quantity, packed-on and use-by dates, the packer's licence number and the
 * consumer-care contact. `JhatkaLabel` reflects that by making FOURTEEN of those
 * fields REQUIRED rather than optional:
 *
 *   labelNo, orderItem, outlet, product, productName, packSize, netQuantity,
 *   packedOn, useBy, storageInstruction, fssaiLicenceNo, outletName,
 *   outletAddress, qrTraceBatch
 *
 * The two that do most of the work are `fssaiLicenceNo` and `qrTraceBatch`:
 *
 *   - `fssaiLicenceNo` comes from `JhatkaCompliance`, NOT from the order, so a
 *     label cannot be printed carrying a licence the shop does not hold.
 *   - `qrTraceBatch` is REQUIRED. A pack of chicken whose label does not name the
 *     batch it came from cannot be recalled, and -11's recall flow queries
 *     `{batch: 1}`. A label without traceability is not a label, it is a sticker.
 *
 * ## `useBy` is computed, never typed
 *
 * The caller does not supply it. It is derived from the BATCH expiry, and the
 * label's `useBy` is capped at it: a use-by later than the batch's own expiry
 * would put a date on the pack that the traceability record contradicts, which is
 * the specific failure -11 exists to prevent. `expiresAt` on the batch is a
 * raw-material date and `cutExpiresAt` is the post-cut date; a PREPARED line uses
 * the latter, since a curry-cut chicken has a shorter life than the whole bird.
 *
 * ## One label per line, not per order
 *
 * A two-item order needs two labels, because each item carries a different product
 * name, quantity and batch. `orderItem` is REQUIRED on the model for that reason.
 * `printOne` exists for the single-line case, which is most retail meat orders.
 */

const express = require('express');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const reservationService = require('../services/jhatka.reservation.service');
// Label generation. The `useBy` derivation and the batch resolution live here because
// the print route needs the same answers.
const labelService = require('../services/jhatka.label.service');
const validate = require('../../../middlewares/validate');
const V = require('../validations/jhatka.partner.labels.validation');
const { jhatkaAuth, requireActiveOutlet } = require('../middlewares/jhatka.tenant');
const profileService = require('../services/jhatka.profile.service');
const {
  JhatkaOrder,
  JhatkaLabel,
  JhatkaBatch,
  JhatkaOutlet,
  JhatkaProduct,
  JhatkaVariant,
  JhatkaCompliance,
} = require('../../../models');
const router = express.Router();

const labelAuth = [jhatkaAuth(), requireActiveOutlet];

const cap = (capability) => async (req, res, next) => {
  try {
    profileService.assertCan(req.role, capability);
    return next();
  } catch (error) {
    return next(error);
  }
};

const nextNumber = (prefix) => {
  const now = new Date();
  const stamp =
    String(now.getFullYear()).slice(2) +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  return `${prefix}${stamp}${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
};

/**
 * POST /jhatka/partner/labels
 *
 * Generate labels for an order. Body:
 *   {
 *     order: <orderId>,
 *     items: [{ orderItem, batch?, packedOn?, storageInstruction?, copies? }],
 *     storageInstruction?, customerCare?, qrImageUrl?
 *   }
 *
 * `printOne` (query) short-circuits to the first line, which is the common case.
 */
router.post('/', ...labelAuth, cap('labels.create'), validate(V.labelCreateBody), async (req, res, next) => {
  try {
    // The whole label SET commits together. This used to loop and save one label at a
    // time with no session, so a five-line order whose fourth line had no expiry left
    // three label documents behind a 409 - packs with labels and no record that the
    // request failed. See jhatka.label.service.js.
    const { order: orderId, items, storageInstruction, customerCare, qrImageUrl } = req.body || {};

    // The whole label SET commits together. This used to loop and save one label at a
    // time with no session, so a five-line order whose fourth line had no expiry left
    // three label documents behind a 409 - packs with labels and no record that the
    // request failed. See `jhatka.label.service.js`.
    const { labels } = await labelService.generateLabels({
      models: { JhatkaOrder, JhatkaLabel, JhatkaBatch, JhatkaOutlet, JhatkaProduct, JhatkaVariant, JhatkaCompliance },
      outletId: req.outletId,
      orderId,
      items,
      storageInstruction,
      customerCare,
      qrImageUrl,
      reservationService,
      nextNumber,
    });

    return res.status(httpStatus.CREATED).json({
      labels,
      nextStep: 'POST /jhatka/partner/labels/:label/print once printed',
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/', ...labelAuth, cap('labels.read'), async (req, res, next) => {
  try {
    const { order, status, page = 1, limit = 100 } = req.query;

    const filter = { outlet: req.outletId };
    if (order) filter.order = order;
    if (status) {
      if (!['draft', 'printed', 'applied', 'void'].includes(status)) {
        throw new ApiError(httpStatus.BAD_REQUEST, `Unknown label status '${status}'`);
      }
      filter.status = status;
    }

    const labels = await JhatkaLabel.find(filter)
      .populate('order', 'orderNo')
      .populate('batch', 'batchNo expiresAt status')
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Math.min(Number(limit), 500))
      .lean();

    return res.json({
      labels: labels.map((l) => ({
        id: String(l._id),
        labelNo: l.labelNo,
        order: l.order ? String(l.order._id) : null,
        orderNo: l.order?.orderNo,
        orderItem: String(l.orderItem),
        productName: l.productName,
        packSize: l.packSize,
        netQuantity: l.netQuantity,
        packedOn: l.packedOn,
        useBy: l.useBy,
        fssaiLicenceNo: l.fssaiLicenceNo,
        qrTraceBatch: l.qrTraceBatch,
        status: l.status,
        printedAt: l.printedAt,
        appliedAt: l.appliedAt,
      })),
      page: Number(page),
      limit: Number(limit),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/partner/labels/:label/print
 *
 * draft → printed. Idempotency is deliberately ABSENT here: printing twice is a
 * real event (a misprint, a re-run on a jam) and the model tracks `printedAt`
 * rather than refusing. The caller checks it and decides.
 */
router.post('/:label/print', ...labelAuth, cap('labels.print'), validate(V.labelParam), async (req, res, next) => {
  try {
    const label = await JhatkaLabel.findOne({
      _id: req.params.label,
      outlet: req.outletId,
    });
    if (!label) throw new ApiError(httpStatus.NOT_FOUND, 'Label not found for this outlet');
    if (label.status === 'void') {
      throw new ApiError(httpStatus.CONFLICT, 'A voided label cannot be printed');
    }

    const { printerId, reprint } = req.body || {};
    if (label.status === 'printed' && !reprint) {
      throw new ApiError(
        httpStatus.CONFLICT,
        'This label is already printed; pass reprint:true if this is a re-run',
        true,
        '',
        { code: 'ALREADY_PRINTED', printedAt: label.printedAt }
      );
    }

    label.status = 'printed';
    label.printedAt = new Date();
    await label.save();

    return res.json({
      label: {
        id: String(label._id),
        labelNo: label.labelNo,
        status: label.status,
        printedAt: label.printedAt,
        printerId,
      },
      // The two renderings the shop needs. ZPL for the 58mm thermal roll most
      // butcher counters actually have; the JSON body for anything that renders
      // its own template.
      render: {
        zpl: buildZpl(label),
        fields: {
          labelNo: label.labelNo,
          productName: label.productName,
          netQuantity: label.netQuantity,
          packedOn: label.packedOn,
          useBy: label.useBy,
          storageInstruction: label.storageInstruction,
          fssaiLicenceNo: label.fssaiLicenceNo,
          outletName: label.outletName,
          outletAddress: label.outletAddress,
          customerCare: label.customerCare,
          qrTraceBatch: label.qrTraceBatch,
        },
      },
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/partner/labels/:label/apply
 *
 * printed → applied: the label is on the pack. After this the pack is on a shelf
 * with a label pointing at one batch, so a second label for the same line is
 * refused at creation.
 */
router.post('/:label/apply', ...labelAuth, cap('labels.create'), validate(V.labelParam), async (req, res, next) => {
  try {
    const label = await JhatkaLabel.findOne({
      _id: req.params.label,
      outlet: req.outletId,
    });
    if (!label) throw new ApiError(httpStatus.NOT_FOUND, 'Label not found for this outlet');
    if (label.status !== 'printed') {
      throw new ApiError(
        httpStatus.CONFLICT,
        `Label is ${label.status}; only a printed label can be applied`,
        true,
        '',
        { status: label.status }
      );
    }

    label.status = 'applied';
    label.appliedAt = new Date();
    await label.save();

    return res.json({
      label: { id: String(label._id), labelNo: label.labelNo, status: label.status, appliedAt: label.appliedAt },
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /jhatka/partner/labels/:label/void
 *
 * A voided label is retained, never deleted — same reasoning as a revoked role
 * assignment: "who put this on a pack" is an audit question.
 */
router.post('/:label/void', ...labelAuth, cap('labels.create'), validate(V.labelParam), validate(V.voidBody), async (req, res, next) => {
  try {
    const label = await JhatkaLabel.findOne({
      _id: req.params.label,
      outlet: req.outletId,
    });
    if (!label) throw new ApiError(httpStatus.NOT_FOUND, 'Label not found for this outlet');
    if (label.status === 'void') {
      throw new ApiError(httpStatus.CONFLICT, 'Label is already void');
    }

    const { reason } = req.body || {};
    if (!reason) throw new ApiError(httpStatus.BAD_REQUEST, 'reason is required to void a label');

    label.status = 'void';
    label.voidedAt = new Date();
    label.voidedBy = req.user._id;
    await label.save();

    return res.json({
      label: { id: String(label._id), labelNo: label.labelNo, status: label.status, voidedAt: label.voidedAt },
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /jhatka/partner/labels/:label
 *
 * `:label` LAST among the literal routes above. -15.1.
 */
router.get('/:label', ...labelAuth, cap('labels.read'), validate(V.labelParam), async (req, res, next) => {
  try {
    const label = await JhatkaLabel.findById(req.params.label)
      .populate('order', 'orderNo lifecycle')
      .populate('batch', 'batchNo expiresAt cutExpiresAt status supplier')
      .lean();
    if (!label) throw new ApiError(httpStatus.NOT_FOUND, 'Label not found');
    if (String(label.outlet) !== req.outletId) {
      throw new ApiError(httpStatus.FORBIDDEN, 'Label not in this outlet');
    }

    return res.json({
      label: {
        id: String(label._id),
        labelNo: label.labelNo,
        orderNo: label.order?.orderNo,
        orderItem: String(label.orderItem),
        productName: label.productName,
        packSize: label.packSize,
        netQuantity: label.netQuantity,
        packedOn: label.packedOn,
        useBy: label.useBy,
        storageInstruction: label.storageInstruction,
        fssaiLicenceNo: label.fssaiLicenceNo,
        outletName: label.outletName,
        outletAddress: label.outletAddress,
        customerCare: label.customerCare,
        mrp: label.mrp,
        taxInclusive: label.taxInclusive,
        netWeightGrams: label.netWeightGrams,
        allergens: label.allergens,
        qrTraceBatch: label.qrTraceBatch,
        qrImageUrl: label.qrImageUrl,
        status: label.status,
        printedAt: label.printedAt,
        appliedAt: label.appliedAt,
        batch: label.batch
          ? { id: String(label.batch._id), batchNo: label.batch.batchNo, status: label.batch.status }
          : null,
      },
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * ZPL for a 58mm thermal roll.
 *
 * The narrow width is why the address is truncated rather than wrapped: a 58mm
 * roll fits roughly 32 characters, and a wrapped address pushes the use-by date
 * onto a second label, which is how the legally-required field goes missing.
 */
const buildZpl = (label) => {
  const esc = (s) => String(s || '').replace(/[\^~\\]/g, '\\$&');
  const d = (v) => (v ? new Date(v).toISOString().slice(0, 10) : 'N/A');
  return [
    '^XA',
    `^FO28,20^A0N,32,32^FD${esc(label.outletName)}^FS`,
    `^FO28,58^A0N,24,24^FD${esc(label.productName)}^FS`,
    `^FO28,88^A0N,28,28^FD${esc(label.netQuantity)}^FS`,
    `^FO28,122^A0N,20,20^FDPacked: ${d(label.packedOn)}^FS`,
    `^FO28,146^A0N,22,22^FDUSE BY: ${d(label.useBy)}^FS`,
    `^FO28,174^A0N,16,16^FD${esc(label.storageInstruction)}^FS`,
    `^FO28,194^A0N,16,16^FDFSSAI: ${esc(label.fssaiLicenceNo)}^FS`,
    `^FO28,214^A0N,16,16^FD${esc(label.outletAddress).substring(0, 34)}^FS`,
    `^FO28,234^A0N,16,16^FDCare: ${esc(label.customerCare)}^FS`,
    `^FO28,256^BY2^BCN,50,Y,N,N^FD${esc(label.qrTraceBatch)}^FS`,
    `^FO28,312^A0N,14,14^FDBatch ${esc(label.qrTraceBatch)}^FS`,
    '^XZ',
  ].join('\n');
};

module.exports = router;
