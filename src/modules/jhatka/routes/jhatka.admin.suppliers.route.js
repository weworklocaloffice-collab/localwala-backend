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
 * jhatka.admin.suppliers.route.js — B1.3
 *
 * Admin CRUD for suppliers and their compliance documents. -11.
 *
 * ## Schema verified against `docs/JHATKA-ADMIN-SCHEMA-SURVEY.md`
 *
 *   JhatkaSupplier   required : code, name
 *                    status   : active | suspended | terminated   (no `draft`)
 *   JhatkaSupplierDocument
 *                    required : supplier, type
 *                    type     : fssai | gst_registration | trade_licence | msme |
 *                               lab_report | insurance | other
 *                    status   : pending | valid | expiring | expired | rejected
 *
 * ## `isBlocking` is the field that matters
 *
 * A supplier document marked `isBlocking` GATES the outlet: `compliance.arithmetic`
 * reads it to decide whether stock can be sold. An admin can therefore lock every
 * outlet that buys from this supplier by rejecting one document — which is exactly the
 * intent, and exactly why a rejection here is never silent: `rejectedReason` is
 * REQUIRED whenever `status: 'rejected'`, so the supplier can be told why.
 *
 * That requirement is enforced HERE rather than in the model, because a document with
 * no reason reads as an oversight to the supplier and as a decision to an auditor.
 */

const express = require('express');
const { status: httpStatus } = require('http-status');

const ApiError = require('../../../utils/ApiError');
const webAuth = require('../../../middlewares/webAuth');
const { JhatkaSupplier, JhatkaSupplierDocument } = require('../../../models');

const router = express.Router();
const validate = require('../../../middlewares/validate');
const V = require('../validations/jhatka.admin.validation');

const SUPPLIER_STATUS = ['active', 'suspended', 'terminated'];
const DOCUMENT_TYPES = [
  'fssai', 'gst_registration', 'trade_licence', 'msme',
  'lab_report', 'insurance', 'other',
];
const DOCUMENT_STATUS = ['pending', 'valid', 'expiring', 'expired', 'rejected'];

const SUPPLIER_TRANSITIONS = {
  active: ['suspended', 'terminated'],
  suspended: ['active', 'terminated'],
  terminated: [],
};

/**
 * GET /v1/jhatka/admin/suppliers/expiring-documents
 *
 * Declared BEFORE `/suppliers/:supplier`, and that ordering is load-bearing.
 *
 * Express matches in registration order, so `GET /suppliers/expiring-documents`
 * declared after `GET /suppliers/:supplier` is UNREACHABLE — `:supplier` matches the
 * literal first. This was caught by `verify.jhatka.vertical.js` rather than by reading,
 * which is the entire argument for that suite: the code looked fine and the ordering
 * bug was invisible without executing the router.
 */
router.get('/suppliers/expiring-documents', webAuth('jhatka_procurement_read'), async (req, res, next) => {
  try {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const until = new Date(Date.now() + days * 86400000);

    const documents = await JhatkaSupplierDocument.find({
      expiresAt: { $ne: null, $lte: until },
      status: { $in: ['valid', 'expiring', 'pending'] },
    })
      .populate('supplier', 'code name')
      .sort({ expiresAt: 1 })
      .lean();

    return res.json({
      days,
      documents,
      count: documents.length,
      expired: documents.filter((d) => new Date(d.expiresAt) < new Date()),
    });
  } catch (error) {
    return next(error);
  }
});

/** GET /v1/jhatka/admin/suppliers */
router.get('/suppliers', webAuth('jhatka_procurement_read'), async (req, res, next) => {
  try {
    const { status, search, page = 1, limit = 50 } = req.query;

    const query = {};
    if (status) query.status = status;
    if (search) {
      const safe = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [{ name: new RegExp(safe, 'i') }, { code: new RegExp(safe, 'i') }];
    }

    const [suppliers, total] = await Promise.all([
      JhatkaSupplier.find(query)
        .sort({ createdAt: -1 })
        .skip((Math.max(1, Number(page)) - 1) * Number(limit))
        .limit(Math.min(200, Math.max(1, Number(limit))))
        .lean(),
      JhatkaSupplier.countDocuments(query),
    ]);

    return res.json({ suppliers, page: Number(page), limit: Number(limit), total, count: suppliers.length });
  } catch (error) {
    return next(error);
  }
});

/** GET /v1/jhatka/admin/suppliers/:supplier — with its documents and blocking state. */
router.get('/suppliers/:supplier', webAuth('jhatka_procurement_read'), validate(V.namedParam('supplier')), async (req, res, next) => {
  try {
    const supplier = await JhatkaSupplier.findById(req.params.supplier).lean();
    if (!supplier) throw new ApiError(httpStatus.NOT_FOUND, 'Supplier not found');

    const documents = await JhatkaSupplierDocument.find({ supplier: supplier._id })
      .sort({ createdAt: -1 })
      .lean();

    // Computed here rather than stored: it changes as documents are added, and a
    // denormalised "compliant" flag on the supplier is exactly the sort of field that
    // goes stale and then lies.
    const blockingFailures = documents.filter(
      (d) => d.isBlocking && ['expired', 'rejected'].includes(d.status)
    );

    return res.json({
      supplier,
      documents,
      compliant: blockingFailures.length === 0,
      blockingFailures: blockingFailures.map((d) => ({
        id: String(d._id),
        type: d.type,
        status: d.status,
        expiresAt: d.expiresAt,
        rejectedReason: d.rejectedReason,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /v1/jhatka/admin/suppliers
 *
 * Created `active` because a supplier is not customer-facing: an inactive supplier
 * simply cannot be picked on a purchase order. Gating happens through DOCUMENTS, which
 * is where the compliance actually lives.
 */
router.post('/suppliers', webAuth('jhatka_procurement_write'), validate(V.supplierBody), async (req, res, next) => {
  try {
    const {
      code, name, legalName, categories, contact, address, location,
      fssai, gstin, creditTermDays, bank, qualityRating,
    } = req.body || {};

    if (!code) throw new ApiError(httpStatus.BAD_REQUEST, 'code is required', true, '', {
      code: 'MISSING_REQUIRED_FIELD', field: 'code',
    });
    if (!name) throw new ApiError(httpStatus.BAD_REQUEST, 'name is required', true, '', {
      code: 'MISSING_REQUIRED_FIELD', field: 'name',
    });

    if (fssai?.category && !['registration', 'state_licence', 'central_licence'].includes(fssai.category)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'fssai.category must be registration | state_licence | central_licence',
        true, '', { code: 'INVALID_FSSAI_CATEGORY', received: fssai.category }
      );
    }

    const supplier = await JhatkaSupplier.create({
      code: String(code).toUpperCase().trim(),
      name,
      legalName: legalName || undefined,
      categories: Array.isArray(categories) ? categories : undefined,
      contact,
      address,
      location,
      fssai,
      gstin: gstin ? String(gstin).toUpperCase() : undefined,
      creditTermDays: creditTermDays === undefined ? undefined : Number(creditTermDays),
      bank,
      qualityRating: qualityRating === undefined ? undefined : Number(qualityRating),
      status: 'active',
    });

    return res.status(201).json({ supplier: supplier.toObject() });
  } catch (error) {
    return next(error);
  }
});

/** PATCH /v1/jhatka/admin/suppliers/:supplier */
router.patch('/suppliers/:supplier', webAuth('jhatka_procurement_write'), validate(V.namedParam('supplier')), validate(V.supplierBody), async (req, res, next) => {
  try {
    const supplier = await JhatkaSupplier.findById(req.params.supplier);
    if (!supplier) throw new ApiError(httpStatus.NOT_FOUND, 'Supplier not found');

    const {
      name, legalName, categories, contact, address, location, fssai,
      gstin, creditTermDays, bank, qualityRating, status, statusReason,
    } = req.body || {};

    if (status !== undefined && status !== supplier.status) {
      if (!SUPPLIER_STATUS.includes(status)) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `status must be one of ${SUPPLIER_STATUS.join(' | ')}`,
          true, '', { code: 'INVALID_STATUS', allowed: SUPPLIER_STATUS, received: status }
        );
      }

      const allowed = SUPPLIER_TRANSITIONS[supplier.status] || [];
      if (!allowed.includes(status)) {
        throw new ApiError(
          httpStatus.CONFLICT,
          `A supplier cannot go from ${supplier.status} to ${status}`,
          true, '',
          { code: 'ILLEGAL_STATUS_TRANSITION', from: supplier.status, to: status, allowed }
        );
      }

      // Terminating a supplier does NOT delete its receipts or payables — those are
      // financial records with an audit trail. History survives the relationship.
      supplier.status = status;
      supplier.statusReason = statusReason;
      if (status === 'suspended') supplier.suspendedAt = new Date();
    }

    if (name !== undefined) supplier.name = name;
    if (legalName !== undefined) supplier.legalName = legalName;
    if (categories !== undefined) supplier.categories = categories;
    if (contact !== undefined) supplier.contact = { ...(supplier.contact || {}), ...contact };
    if (address !== undefined) supplier.address = { ...(supplier.address || {}), ...address };
    if (location !== undefined) supplier.location = location;
    if (fssai !== undefined) supplier.fssai = { ...(supplier.fssai || {}), ...fssai };
    if (gstin !== undefined) supplier.gstin = String(gstin).toUpperCase();
    if (creditTermDays !== undefined) supplier.creditTermDays = Number(creditTermDays);
    if (bank !== undefined) supplier.bank = { ...(supplier.bank || {}), ...bank };
    if (qualityRating !== undefined) supplier.qualityRating = Number(qualityRating);

    await supplier.save();
    return res.json({ supplier: supplier.toObject() });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /v1/jhatka/admin/suppliers/:supplier/documents
 *
 * Body: `{ type, reference, issuedAt, expiresAt, fileUrl, isBlocking }`
 *
 * New documents start `pending`. A document that arrives already `valid` skips the
 * review that the `pending` state exists to record.
 */
router.post('/suppliers/:supplier/documents', webAuth('jhatka_procurement_write'), async (req, res, next) => {
  try {
    const supplier = await JhatkaSupplier.findById(req.params.supplier).lean();
    if (!supplier) throw new ApiError(httpStatus.NOT_FOUND, 'Supplier not found');

    const { type, reference, issuedAt, expiresAt, fileUrl, isBlocking, notes } = req.body || {};

    if (!type) throw new ApiError(httpStatus.BAD_REQUEST, 'type is required', true, '', {
      code: 'MISSING_REQUIRED_FIELD', field: 'type',
    });
    if (!DOCUMENT_TYPES.includes(type)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `type must be one of ${DOCUMENT_TYPES.join(' | ')}`,
        true, '', { code: 'INVALID_DOCUMENT_TYPE', allowed: DOCUMENT_TYPES, received: type }
      );
    }

    const doc = await JhatkaSupplierDocument.create({
      supplier: supplier._id,
      type,
      reference: reference || undefined,
      issuedAt: issuedAt ? new Date(issuedAt) : undefined,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      fileUrl: fileUrl || undefined,
      // Defaults to BLOCKING. A supplier licence that lapses should stop an outlet,
      // and making safety the default means the failure mode of forgetting is
      // "slightly strict", not "silently illegal".
      isBlocking: isBlocking === undefined ? true : !!isBlocking,
      status: 'pending',
      uploadedBy: req.user._id,
      notes,
    });

    return res.status(201).json({ document: doc.toObject() });
  } catch (error) {
    return next(error);
  }
});

/**
 * PATCH /v1/jhatka/admin/suppliers/:supplier/documents/:document
 *
 * `status: 'rejected'` REQUIRES `rejectedReason`. Enforced here because an unexplained
 * rejection is indistinguishable from an administrative mistake, and the supplier is
 * entitled to know which it is.
 */
router.patch('/suppliers/:supplier/documents/:document', webAuth('jhatka_procurement_write'), async (req, res, next) => {
  try {
    const doc = await JhatkaSupplierDocument.findOne({
      _id: req.params.document,
      supplier: req.params.supplier,
    });
    if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Document not found for this supplier');

    const {
      reference, issuedAt, expiresAt, fileUrl, isBlocking, status,
      rejectedReason, notes,
    } = req.body || {};

    if (status !== undefined) {
      if (!DOCUMENT_STATUS.includes(status)) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `status must be one of ${DOCUMENT_STATUS.join(' | ')}`,
          true, '', { code: 'INVALID_STATUS', allowed: DOCUMENT_STATUS, received: status }
        );
      }
      if (status === 'rejected' && !(rejectedReason || doc.rejectedReason)) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'rejectedReason is required when rejecting a document — the supplier must be told why',
          true, '',
          { code: 'REJECTION_REASON_REQUIRED' }
        );
      }
      doc.status = status;
      doc.statusEvaluatedAt = new Date();
    }

    if (reference !== undefined) doc.reference = reference;
    if (issuedAt !== undefined) doc.issuedAt = new Date(issuedAt);
    if (expiresAt !== undefined) doc.expiresAt = new Date(expiresAt);
    if (fileUrl !== undefined) doc.fileUrl = fileUrl;
    if (isBlocking !== undefined) doc.isBlocking = !!isBlocking;
    if (rejectedReason !== undefined) doc.rejectedReason = rejectedReason;
    if (notes !== undefined) doc.notes = notes;

    // `verifiedBy` is stamped once, on the transition INTO a verified state, and
    // never re-stamped. A document that was valid then expired then re-validated keeps
    // the truth that someone looked at it.
    if (status === 'valid' && !doc.verifiedAt) {
      doc.verifiedAt = new Date();
      doc.verifiedBy = req.user._id;
      doc.verifiedByName = req.user.name;
    }

    await doc.save();
    return res.json({ document: doc.toObject() });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
module.exports.DOCUMENT_TYPES = DOCUMENT_TYPES;
module.exports.SUPPLIER_TRANSITIONS = SUPPLIER_TRANSITIONS;
