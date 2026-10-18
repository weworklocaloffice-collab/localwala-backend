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
 * jhatka.routes.partner.compliance.js — compliance, reviews, promotions. Phase 1j.
 *
 * All routes:
 *   - jhatkaAuth (outlet resolved)
 *   - requireActiveOutlet
 *   - role-based
 */

const express = require('express');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const { jhatkaAuth, requireActiveOutlet, requireRole, requireComplianceCurrent } = require('../middlewares/jhatka.tenant');
const { JhatkaCompliance, JhatkaComplaint, JhatkaReview, JhatkaPromotion, JhatkaOutlet } = require('../../../models');
const { deriveComplianceStatus } = require('../utils/compliance.arithmetic');
const validate = require('../../../middlewares/validate');
const V = require('../validations/jhatka.admin.validation');

const router = express.Router();

const compAuth = [jhatkaAuth(), requireActiveOutlet, requireComplianceCurrent];

/**
 * GET /jhatka/partner/compliance
 *
 * This outlet's compliance record (already in partner routes, but keeping here for completeness).
 */
router.get('/', compAuth, requireRole('compliance_officer', 'manager', 'owner'), async (req, res, next) => {
  try {
    const compliance = await JhatkaCompliance.findOne({ outlet: req.outletId }).lean();
    if (!compliance) {
      return res.json({
        outletId: req.outletId,
        fssai: null,
        status: 'missing',
        statusLabel: 'No FSSAI record on file',
      });
    }

    const now = new Date();
    const status = deriveComplianceStatus(compliance.fssai, now, 30);

    let statusLabel = status;
    if (status === 'expiring') {
      const days = Math.ceil((new Date(compliance.fssai.expiresAt) - now) / 86400000);
      statusLabel = `Expires in ${days} day${days === 1 ? '' : 's'}`;
    } else if (status === 'valid') {
      statusLabel = 'Valid';
    } else if (status === 'pending') {
      statusLabel = 'Submitted, awaiting approval';
    } else if (status === 'expired') {
      statusLabel = 'Expired';
    } else if (status === 'revoked') {
      statusLabel = 'Revoked';
    }

    res.json({
      outletId: req.outletId,
      fssai: compliance.fssai ? {
        licenceNumber: compliance.fssai.licenceNumber,
        expiresAt: compliance.fssai.expiresAt,
        documentUrl: compliance.fssai.documentUrl,
      } : null,
      status,
      statusLabel,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /jhatka/partner/compliance/fssai
 *
 * Create or update FSSAI record.
 * Body: { licenceNumber, expiresAt, documentUrl }
 * Role: compliance_officer, owner
 */
router.post('/fssai', compAuth, requireRole('compliance_officer', 'owner'), async (req, res, next) => {
  try {
    const { licenceNumber, expiresAt, documentUrl } = req.body;

    if (!licenceNumber || !expiresAt) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'licenceNumber and expiresAt required');
    }

    let compliance = await JhatkaCompliance.findOne({ outlet: req.outletId });
    if (!compliance) {
      compliance = new JhatkaCompliance({ outlet: req.outletId });
    }

    compliance.fssai = {
      licenceNumber,
      expiresAt: new Date(expiresAt),
      documentUrl,
      status: 'pending',
      submittedAt: new Date(),
      submittedBy: req.user._id,
    };
    compliance.updatedBy = req.user._id;
    await compliance.save();

    res.json({
      compliance: {
        id: String(compliance._id),
        fssai: compliance.fssai,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /jhatka/partner/complaints
 *
 * Complaints for this outlet.
 */
router.get('/complaints', compAuth, requireRole('compliance_officer', 'manager', 'owner'), async (req, res, next) => {
  try {
    const { status, customer, page = 1, limit = 50 } = req.query;

    const match = { outlet: req.outletId };
    if (status) match.status = status;
    if (customer) match.customer = customer;

    const complaints = await JhatkaComplaint.find(match)
      .populate('customer', 'name phone email')
      .populate('order', 'status estimatedTotalPaise')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.json({
      complaints: complaints.map((c) => ({
        ...c,
        id: String(c._id),
        outlet: String(c.outlet),
        customer: c.customer ? { ...c.customer, id: String(c.customer._id) } : null,
        order: c.order ? { ...c.order, id: String(c.order._id) } : null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /jhatka/partner/complaints/:id/respond
 *
 * Respond to a complaint.
 * Body: { response, status }
 * Role: compliance_officer, manager, owner
 */
router.post('/complaints/:id/respond', compAuth, requireRole('compliance_officer', 'manager', 'owner'), validate(V.namedParam('id')), async (req, res, next) => {
  try {
    const complaint = await JhatkaComplaint.findById(req.params.id);
    if (!complaint) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Complaint not found');
    }
    if (String(complaint.outlet) !== req.outletId) {
      throw new ApiError(httpStatus.FORBIDDEN, 'Complaint not in this outlet');
    }

    const { response, status } = req.body;

    if (response) {
      complaint.responses.push({
        message: response,
        respondedBy: req.user._id,
        respondedAt: new Date(),
      });
    }
    if (status) {
      complaint.status = status;
    }
    await complaint.save();

    res.json({
      complaint: {
        id: String(complaint._id),
        status: complaint.status,
        responses: complaint.responses,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /jhatka/partner/reviews
 *
 * Reviews for this outlet.
 */
router.get('/reviews', compAuth, requireRole('compliance_officer', 'manager', 'owner'), async (req, res, next) => {
  try {
    const { rating, page = 1, limit = 50 } = req.query;

    const match = { outlet: req.outletId };
    if (rating) match.rating = Number(rating);

    const reviews = await JhatkaReview.find(match)
      .populate('customer', 'name phone')
      .populate('order', 'status')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // Calculate average
    const allReviews = await JhatkaReview.find({ outlet: req.outletId }).select('rating').lean();
    const avgRating = allReviews.length ? allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length : 0;

    res.json({
      reviews: reviews.map((r) => ({
        ...r,
        id: String(r._id),
        outlet: String(r.outlet),
        customer: r.customer ? { ...r.customer, id: String(r.customer._id) } : null,
        order: r.order ? { ...r.order, id: String(r.order._id) } : null,
      })),
      summary: {
        total: allReviews.length,
        averageRating: Math.round(avgRating * 10) / 10,
        distribution: [1, 2, 3, 4, 5].map((star) => ({
          star,
          count: allReviews.filter((r) => r.rating === star).length,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /jhatka/partner/reviews/:id/respond
 *
 * Respond to a review (owner only).
 * Body: { response }
 */
router.post('/reviews/:id/respond', compAuth, requireRole('owner'), validate(V.namedParam('id')), async (req, res, next) => {
  try {
    const review = await JhatkaReview.findById(req.params.id);
    if (!review) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Review not found');
    }
    if (String(review.outlet) !== req.outletId) {
      throw new ApiError(httpStatus.FORBIDDEN, 'Review not in this outlet');
    }
    if (review.ownerResponse) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Review already has a response');
    }

    const { response } = req.body;
    if (!response) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'response required');
    }

    review.ownerResponse = {
      message: response,
      respondedBy: req.user._id,
      respondedAt: new Date(),
    };
    await review.save();

    res.json({
      review: {
        id: String(review._id),
        ownerResponse: review.ownerResponse,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /jhatka/partner/promotions
 *
 * Promotions available to this outlet.
 */
router.get('/promotions', compAuth, requireRole('order_staff', 'manager', 'owner'), async (req, res, next) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;

    const match = {
      $or: [
        { outlet: req.outletId },
        { outlet: { $exists: false } }, // business-wide promotions
      ],
    };
    if (status) match.status = status;

    const now = new Date();
    match.$and = [
      { validFrom: { $lte: now } },
      { $or: [{ validUntil: { $gte: now } }, { validUntil: { $exists: false } }] },
    ];

    const promotions = await JhatkaPromotion.find(match)
      .sort({ validFrom: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.json({
      promotions: promotions.map((p) => ({
        ...p,
        id: String(p._id),
        outlet: p.outlet ? String(p.outlet) : null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /jhatka/partner/promotions
 *
 * Create a promotion for this outlet.
 * Body: { code, name, description, type, value, minOrderValuePaise, maxDiscountPaise, usageLimit, validFrom, validUntil, applicableVariants, applicableCategories }
 * Role: owner only
 */
router.post('/promotions', compAuth, requireRole('owner'), async (req, res, next) => {
  try {
    const { code, name, description, type, value, minOrderValuePaise, maxDiscountPaise, usageLimit, validFrom, validUntil, applicableVariants, applicableCategories } = req.body;

    if (!code || !name || !type || value === undefined) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'code, name, type, value required');
    }

    // Check code uniqueness for this outlet
    const existing = await JhatkaPromotion.findOne({ code, outlet: req.outletId });
    if (existing) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Promotion code already exists for this outlet');
    }

    const promo = new JhatkaPromotion({
      outlet: req.outletId,
      code,
      name,
      description,
      type,
      value: Number(value),
      minOrderValuePaise: Number(minOrderValuePaise || 0),
      maxDiscountPaise: maxDiscountPaise ? Number(maxDiscountPaise) : null,
      usageLimit: Number(usageLimit || 0),
      validFrom: validFrom ? new Date(validFrom) : new Date(),
      validUntil: validUntil ? new Date(validUntil) : null,
      applicableVariants: applicableVariants || [],
      applicableCategories: applicableCategories || [],
      createdBy: req.user._id,
    });
    await promo.save();

    res.status(httpStatus.CREATED).json({
      promotion: { id: String(promo._id), code: promo.code, name: promo.name },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /jhatka/partner/outlet
 *
 * Get this outlet's details (for the partner app header).
 */
router.get('/outlet', compAuth, async (req, res, next) => {
  try {
    const outlet = await JhatkaOutlet.findById(req.outletId)
      .populate('partner', 'name code')
      .populate('franchise', 'name code')
      .lean();

    if (!outlet) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');
    }

    const compliance = await JhatkaCompliance.findOne({ outlet: req.outletId }).lean();
    let complianceStatus = 'missing';
    if (compliance?.fssai) {
      complianceStatus = deriveComplianceStatus(compliance.fssai, new Date(), 30);
    }

    res.json({
      outlet: {
        ...outlet,
        id: String(outlet._id),
        partner: outlet.partner ? { ...outlet.partner, id: String(outlet.partner._id) } : null,
        franchise: outlet.franchise ? { ...outlet.franchise, id: String(outlet.franchise._id) } : null,
        complianceStatus,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /jhatka/partner/outlet
 *
 * Update outlet details (owner only).
 * Body: { name, address, phone, email, operatingHours, deliveryRadiusKm, settings }
 */
router.patch('/outlet', compAuth, requireRole('owner'), async (req, res, next) => {
  try {
    const outlet = await JhatkaOutlet.findById(req.outletId);
    if (!outlet) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');
    }

    const { name, address, phone, email, operatingHours, deliveryRadiusKm, settings } = req.body;

    if (name) outlet.name = name;
    if (address) outlet.address = address;
    if (phone) outlet.phone = phone;
    if (email) outlet.email = email;
    if (operatingHours) outlet.operatingHours = operatingHours;
    if (deliveryRadiusKm !== undefined) outlet.deliveryRadiusKm = Number(deliveryRadiusKm);
    if (settings) outlet.settings = { ...outlet.settings, ...settings };

    outlet.updatedBy = req.user._id;
    await outlet.save();

    res.json({
      outlet: {
        id: String(outlet._id),
        name: outlet.name,
        address: outlet.address,
        phone: outlet.phone,
        email: outlet.email,
        operatingHours: outlet.operatingHours,
        deliveryRadiusKm: outlet.deliveryRadiusKm,
        settings: outlet.settings,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;