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
 * jhatka.routes.public.js — public customer browse routes. Phase 6.
 *
 * All routes:
 *   - NO authentication required (guest accessible)
 *   - Scope by customer location (lat/lng or address)
 *   - Only outlets with active status and valid compliance
 */

const express = require('express');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const { JhatkaOutlet, JhatkaCategory, JhatkaProduct, JhatkaVariant, JhatkaPriceOverride, JhatkaCompliance } = require('../../../models');
const { deriveComplianceStatus } = require('../utils/compliance.arithmetic');

const router = express.Router();
const validate = require('../../../middlewares/validate');
const V = require('../validations/jhatka.catalogue.validation');

/**
 * GET /jhatka/public/outlets/nearby
 *
 * Find outlets serving a customer location.
 * Query: lat, lng, radiusKm (default 10), category (optional filter)
 */
router.get('/outlets/nearby', validate(V.nearbyQuery), async (req, res, next) => {
  try {
    const { lat, lng, radiusKm = 10, category } = req.query;

    if (!lat || !lng) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'lat and lng are required');
    }

    const latitude = Number(lat);
    const longitude = Number(lng);
    const radius = Number(radiusKm);

    if (isNaN(latitude) || isNaN(longitude) || isNaN(radius)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid lat/lng/radius');
    }

    // Find outlets within radius using geospatial query
    // Assumes JhatkaOutlet has a 2dsphere index on location.coordinates [lng, lat]
    const match = {
      status: 'active',
      'location.coordinates': {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: [longitude, latitude] },
          $maxDistance: radius * 1000, // meters
        },
      },
    };

    const outlets = await JhatkaOutlet.find(match)
      .select('_id name address phone operatingHours deliveryRadiusKm location settings')
      .lean();

    // Filter by compliance (only valid/expiring outlets can accept new orders)
    const now = new Date();
    const validOutlets = [];
    for (const outlet of outlets) {
      const compliance = await JhatkaCompliance.findOne({ outlet: outlet._id }).lean();
      let complianceStatus = 'missing';
      if (compliance?.fssai) {
        complianceStatus = deriveComplianceStatus(compliance.fssai, now, 30);
      }
      // Only include if compliance allows new orders
      if (complianceStatus === 'valid' || complianceStatus === 'expiring') {
        validOutlets.push({
          ...outlet,
          id: String(outlet._id),
          complianceStatus,
        });
      }
    }

    // If category filter, only include outlets that have products in that category
    if (category && validOutlets.length) {
      const categoryDoc = await JhatkaCategory.findOne({ code: category }).lean();
      if (categoryDoc) {
        const productsInCategory = await JhatkaProduct.find({ category: categoryDoc._id, status: 'active' })
          .select('_id')
          .lean();
        const productIds = new Set(productsInCategory.map((p) => String(p._id)));

        const variants = await JhatkaVariant.find({ product: { $in: [...productIds] }, status: 'active' })
          .select('_id product')
          .lean();
        const variantIds = new Set(variants.map((v) => String(v._id)));

        const priceOverrides = await JhatkaPriceOverride.find({ variant: { $in: [...variantIds] } })
          .select('outlet variant')
          .lean();

        const outletsWithCategory = new Set();
        for (const po of priceOverrides) {
          outletsWithCategory.add(String(po.outlet));
        }

        const filtered = validOutlets.filter((o) => outletsWithCategory.has(o.id));
        return res.json({ outlets: filtered });
      }
    }

    res.json({ outlets: validOutlets });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /jhatka/public/outlets/:id
 *
 * Single outlet detail for customer.
 */
router.get('/outlets/:id', validate(V.idParam), async (req, res, next) => {
  try {
    const outlet = await JhatkaOutlet.findById(req.params.id)
      .select('_id name address phone operatingHours deliveryRadiusKm location settings')
      .lean();

    if (!outlet) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Outlet not found');
    }

    if (outlet.status !== 'active') {
      throw new ApiError(httpStatus.FORBIDDEN, 'Outlet not accepting orders');
    }

    const compliance = await JhatkaCompliance.findOne({ outlet: outlet._id }).lean();
    let complianceStatus = 'missing';
    if (compliance?.fssai) {
      complianceStatus = deriveComplianceStatus(compliance.fssai, new Date(), 30);
    }
    if (complianceStatus !== 'valid' && complianceStatus !== 'expiring') {
      throw new ApiError(httpStatus.FORBIDDEN, 'Outlet compliance not valid');
    }

    res.json({
      outlet: {
        ...outlet,
        id: String(outlet._id),
        complianceStatus,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /jhatka/public/catalogue
 *
 * Browse products for a customer location.
 * Query: lat, lng, radiusKm, category, page, limit
 */
router.get('/catalogue', async (req, res, next) => {
  try {
    const { lat, lng, radiusKm = 10, category, page = 1, limit = 50 } = req.query;

    if (!lat || !lng) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'lat and lng are required');
    }

    const latitude = Number(lat);
    const longitude = Number(lng);
    const radius = Number(radiusKm);

    // Find serving outlets
    const outlets = await JhatkaOutlet.find({
      status: 'active',
      'location.coordinates': {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: [longitude, latitude] },
          $maxDistance: radius * 1000,
        },
      },
    }).select('_id').lean();

    const outletIds = outlets.map((o) => o._id);
    if (!outletIds.length) {
      return res.json({ categories: [], products: [] });
    }

    // Build category tree with only active products available in these outlets
    const match = { parent: { $exists: false }, status: 'active' };
    const roots = await JhatkaCategory.find(match).lean();

    const buildTree = async (cats) => {
      const result = [];
      for (const cat of cats) {
        const children = await JhatkaCategory.find({ parent: cat._id, status: 'active' }).lean();
        const node = { ...cat, id: String(cat._id), children: [] };
        if (children.length) {
          node.children = await buildTree(children);
        }
        result.push(node);
      }
      return result;
    };

    const tree = await buildTree(roots);

    // Filter categories that have products in serving outlets
    const filterCategories = async (cats) => {
      const kept = [];
      for (const cat of cats) {
        const products = await JhatkaProduct.find({
          category: cat.id,
          status: 'active',
        }).select('_id').lean();

        if (products.length) {
          const productIds = products.map((p) => p._id);
          const variants = await JhatkaVariant.find({
            product: { $in: productIds },
            status: 'active',
          }).select('_id').lean();

          if (variants.length) {
            const variantIds = variants.map((v) => v._id);
            const overrides = await JhatkaPriceOverride.find({
              outlet: { $in: outletIds },
              variant: { $in: variantIds },
            }).select('outlet').lean();

            if (overrides.length) {
              const childKept = cat.children?.length ? await filterCategories(cat.children) : [];
              if (childKept.length) {
                kept.push({ ...cat, children: childKept });
              } else {
                // Category has products but children filtered out - keep the category anyway
                kept.push({ ...cat, children: childKept });
              }
            }
          }
        } else if (cat.children?.length) {
          const childKept = await filterCategories(cat.children);
          if (childKept.length) {
            kept.push({ ...cat, children: childKept });
          }
        }
      }
      return kept;
    };

    const filteredTree = await filterCategories(tree);

    // Get products for the first category or all
    let products = [];
    const targetCategory = category || (filteredTree[0]?.id);

    if (targetCategory) {
      const prods = await JhatkaProduct.find({
        category: targetCategory,
        status: 'active',
      })
        .select('_id name description images baseUnit displayOrder')
        .sort({ displayOrder: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      const productIds = prods.map((p) => p._id);
      const variants = await JhatkaVariant.find({
        product: { $in: productIds },
        status: 'active',
      })
        .select('_id product name sku priceMrp priceSale unit weightGrams measurementMode status')
        .lean();

      const variantIds = variants.map((v) => v._id);
      const overrides = await JhatkaPriceOverride.find({
        outlet: { $in: outletIds },
        variant: { $in: variantIds },
      }).select('outlet variant priceMrp priceSale').lean();

      const overrideMap = overrides.reduce((m, o) => {
        const key = `${o.outlet}-${o.variant}`;
        m[key] = { priceMrp: o.priceMrp, priceSale: o.priceSale };
        return m;
      }, {});

      const variantsByProduct = variants.reduce((m, v) => {
        const pid = String(v.product);
        if (!m[pid]) m[pid] = [];
        m[pid].push(v);
        return m;
      }, {});

      products = prods.map((p) => {
        const pid = String(p._id);
        const productVariants = (variantsByProduct[pid] || []).map((v) => {
          // For public, show the BEST price across serving outlets
          let bestPriceSale = v.priceSale;
          let bestPriceMrp = v.priceMrp;
          for (const oid of outletIds) {
            const key = `${oid}-${v._id}`;
            const ov = overrideMap[key];
            if (ov) {
              if (ov.priceSale !== undefined && (bestPriceSale === undefined || ov.priceSale < bestPriceSale)) {
                bestPriceSale = ov.priceSale;
              }
              if (ov.priceMrp !== undefined && (bestPriceMrp === undefined || ov.priceMrp < bestPriceMrp)) {
                bestPriceMrp = ov.priceMrp;
              }
            }
          }
          return {
            ...v,
            id: String(v._id),
            product: String(v.product),
            priceMrp: bestPriceMrp,
            priceSale: bestPriceSale,
          };
        });
        return { ...p, id: pid, variants: productVariants };
      });
    }

    res.json({
      categories: filteredTree,
      products,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /jhatka/public/products/:id
 *
 * Single product detail with variants and prices for serving outlets.
 */
router.get('/products/:id', validate(V.idParam), async (req, res, next) => {
  try {
    const { lat, lng, radiusKm = 10 } = req.query;

    if (!lat || !lng) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'lat and lng are required');
    }

    const latitude = Number(lat);
    const longitude = Number(lng);
    const radius = Number(radiusKm);

    const outlets = await JhatkaOutlet.find({
      status: 'active',
      'location.coordinates': {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: [longitude, latitude] },
          $maxDistance: radius * 1000,
        },
      },
    }).select('_id').lean();

    const outletIds = outlets.map((o) => o._id);
    if (!outletIds.length) {
      throw new ApiError(httpStatus.NOT_FOUND, 'No outlets serving this location');
    }

    const product = await JhatkaProduct.findById(req.params.id)
      .select('_id name description images baseUnit category displayOrder status')
      .lean();

    if (!product || product.status !== 'active') {
      throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');
    }

    const variants = await JhatkaVariant.find({ product: product._id, status: 'active' })
      .select('_id name sku priceMrp priceSale unit weightGrams measurementMode status')
      .sort({ displayOrder: 1 })
      .lean();

    const variantIds = variants.map((v) => v._id);
    const overrides = await JhatkaPriceOverride.find({
      outlet: { $in: outletIds },
      variant: { $in: variantIds },
    }).select('outlet variant priceMrp priceSale').lean();

    const overrideMap = overrides.reduce((m, o) => {
      const key = `${o.outlet}-${o.variant}`;
      m[key] = { priceMrp: o.priceMrp, priceSale: o.priceSale };
      return m;
    }, {});

    const data = {
      ...product,
      id: String(product._id),
      variants: variants.map((v) => {
        // Show price per outlet
        const prices = {};
        for (const oid of outletIds) {
          const key = `${oid}-${v._id}`;
          const ov = overrideMap[key];
          prices[String(oid)] = {
            priceMrp: ov?.priceMrp ?? v.priceMrp,
            priceSale: ov?.priceSale ?? v.priceSale,
          };
        }
        return {
          ...v,
          id: String(v._id),
          product: String(v.product),
          prices,
        };
      }),
    };

    res.json({ product: data });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /jhatka/public/checkout/quote
 *
 * Get a price quote for a cart before authentication.
 * Body: { lat, lng, items: [{ variantId, qty }], paymentMode: 'COD'|'ONLINE' }
 */
router.post('/checkout/quote', async (req, res, next) => {
  try {
    const { lat, lng, items, paymentMode = 'COD' } = req.body;

    if (!lat || !lng) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'lat and lng are required');
    }
    if (!items || !items.length) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'items required');
    }

    const latitude = Number(lat);
    const longitude = Number(lng);

    // Find nearest active outlet
    const outlet = await JhatkaOutlet.findOne({
      status: 'active',
      'location.coordinates': {
        $nearSphere: {
          $geometry: { type: 'Point', coordinates: [longitude, latitude] },
          $maxDistance: 10000, // 10km default
        },
      },
    }).select('_id').lean();

    if (!outlet) {
      throw new ApiError(httpStatus.NOT_FOUND, 'No outlet serving this location');
    }

    // Verify compliance
    const compliance = await JhatkaCompliance.findOne({ outlet: outlet._id }).lean();
    let complianceStatus = 'missing';
    if (compliance?.fssai) {
      complianceStatus = deriveComplianceStatus(compliance.fssai, new Date(), 30);
    }
    if (complianceStatus !== 'valid' && complianceStatus !== 'expiring') {
      throw new ApiError(httpStatus.FORBIDDEN, 'Nearest outlet compliance not valid');
    }

    const variantIds = items.map((i) => i.variantId);
    const variants = await JhatkaVariant.find({ _id: { $in: variantIds }, status: 'active' })
      .select('_id product name sku priceMrp priceSale unit weightGrams measurementMode')
      .lean();

    const variantMap = variants.reduce((m, v) => { m[String(v._id)] = v; return m; }, {});

    const overrides = await JhatkaPriceOverride.find({ outlet: outlet._id, variant: { $in: variantIds } })
      .select('variant priceMrp priceSale')
      .lean();
    const overrideMap = overrides.reduce((m, o) => { m[String(o.variant)] = o; return m; }, {});

    let subtotalPaise = 0;
    const lineItems = [];

    for (const item of items) {
      const variant = variantMap[item.variantId];
      if (!variant) {
        throw new ApiError(httpStatus.BAD_REQUEST, `Variant ${item.variantId} not found or inactive`);
      }

      const ov = overrideMap[item.variantId];
      const priceMrp = ov?.priceMrp ?? variant.priceMrp;
      const priceSale = ov?.priceSale ?? variant.priceSale;
      const unitPrice = priceSale ?? priceMrp;

      const qty = Number(item.qty || 1);
      if (qty <= 0) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Quantity must be positive');
      }

      let estimatedWeightGrams = 0;
      if (variant.measurementMode === 'WEIGHT') {
        estimatedWeightGrams = qty * (variant.weightGrams || 0);
      }

      const lineEstimatedPaise = unitPrice * qty;
      subtotalPaise += lineEstimatedPaise;

      lineItems.push({
        variantId: String(variant._id),
        variantName: variant.name,
        variantSku: variant.sku,
        qty,
        unit: variant.unit,
        unitPrice,
        priceMrp,
        priceSale: priceSale ?? null,
        measurementMode: variant.measurementMode,
        weightGrams: variant.weightGrams,
        estimatedWeightGrams,
        estimatedAmountPaise: lineEstimatedPaise,
      });
    }

    // COD ceiling 110%
    const codCeilingPaise = paymentMode === 'COD' ? Math.round(subtotalPaise * 1.10) : 0;
    const preAuthPaise = paymentMode === 'ONLINE' ? Math.round(subtotalPaise * 1.10) : 0;

    res.json({
      outlet: { id: String(outlet._id) },
      items: lineItems,
      subtotalPaise,
      taxPaise: 0,
      totalPaise: subtotalPaise,
      payment: {
        mode: paymentMode,
        codCeilingPaise,
        preAuthPaise,
        note: 'Final amount for variable-weight items will be adjusted after delivery based on actual weight',
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;