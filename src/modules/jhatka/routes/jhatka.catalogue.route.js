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
 * jhatka.routes.catalogue.js — catalogue read routes. Phase 1j.
 *
 * All routes:
 *   - use jhatkaScope (no outlet required, scope from token)
 *   - filter by caller's permittedOutletIds via PriceOverride scope
 *   - read-only; no compliance/active-outlet checks needed
 */

const express = require('express');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const { jhatkaScope } = require('../middlewares/jhatka.tenant');
const { JhatkaCategory, JhatkaProduct, JhatkaVariant, JhatkaYieldSpec, JhatkaPriceOverride } = require('../../../models');

const router = express.Router();
const validate = require('../../../middlewares/validate');
const V = require('../validations/jhatka.catalogue.validation');

/**
 * GET /jhatka/catalogue/categories
 *
 * Category tree for the UI. Returns roots with children nested.
 *
 * Query:
 *   - includeInactive: false (default) — include draft/suspended categories?
 *   - outletHint: optional — if provided, only categories with active products
 *     in that outlet's scope are returned (for the customer picker)
 */
router.get('/categories', jhatkaScope(), async (req, res, next) => {
  try {
    const { includeInactive, outletHint } = req.query;

    const match = { parent: { $exists: false } };
    if (includeInactive !== 'true') {
      match.status = 'active';
    }

    const roots = await JhatkaCategory.find(match).lean();

    // Build full tree recursively
    const buildTree = async (cats) => {
      const result = [];
      for (const cat of cats) {
        const children = await JhatkaCategory.find({ parent: cat._id }).lean();
        const node = { ...cat, id: String(cat._id), children: [] };
        if (children.length) {
          node.children = await buildTree(children);
        }
        result.push(node);
      }
      return result;
    };

    const tree = await buildTree(roots);

    // If outletHint provided, prune branches without active products in that outlet
    if (outletHint && req.permittedOutletIds.includes(outletHint)) {
      const hasProducts = async (cat) => {
        const products = await JhatkaProduct.find({
          category: cat.id,
          status: 'active',
        }).select('_id').lean();
        if (products.length) return true;
        if (cat.children?.length) {
          for (const child of cat.children) {
            if (await hasProducts(child)) return true;
          }
        }
        return false;
      };

      const prune = async (cats) => {
        const kept = [];
        for (const cat of cats) {
          const childKept = cat.children?.length ? await prune(cat.children) : [];
          if (childKept.length || await hasProducts(cat)) {
            kept.push({ ...cat, children: childKept });
          }
        }
        return kept;
      };

      const pruned = await prune(tree);
      return res.json({ categories: pruned });
    }

    res.json({ categories: tree });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /jhatka/catalogue/categories/:id
 *
 * Single category with its active products (summary).
 */
router.get('/categories/:id', jhatkaScope(), validate(V.idParam), async (req, res, next) => {
  try {
    const cat = await JhatkaCategory.findById(req.params.id).lean();
    if (!cat) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Category not found');
    }

    const products = await JhatkaProduct.find({
      category: cat._id,
      status: 'active',
    })
      .select('_id name description images baseUnit displayOrder')
      .sort({ displayOrder: 1 })
      .lean();

    res.json({
      category: { ...cat, id: String(cat._id) },
      products: products.map((p) => ({ ...p, id: String(p._id) })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /jhatka/catalogue/products
 *
 * List products with variant summaries, optionally filtered by category.
 *
 * Query:
 *   - category: category ID
 *   - outlet: outlet ID (must be in permittedOutletIds)
 *   - status: active|inactive (default active)
 *   - page, limit
 */
router.get('/products', jhatkaScope(), async (req, res, next) => {
  try {
    const { category, outlet, status = 'active', page = 1, limit = 50 } = req.query;

    if (outlet && !req.permittedOutletIds.includes(outlet)) {
      throw new ApiError(httpStatus.FORBIDDEN, 'Outlet not in your scope');
    }

    const match = { status };
    if (category) match.category = category;

    const products = await JhatkaProduct.find(match)
      .select('_id name description images baseUnit category displayOrder status')
      .sort({ displayOrder: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // Get variant summaries for each product
    const productIds = products.map((p) => p._id);
    const variants = await JhatkaVariant.find({ product: { $in: productIds }, status: 'active' })
      .select('_id product name sku priceMrp priceSale unit weightGrams measurementMode status subscriptionEligible')
      .lean();

    const variantsByProduct = variants.reduce((m, v) => {
      const pid = String(v.product);
      if (!m[pid]) m[pid] = [];
      m[pid].push({ ...v, id: String(v._id), product: String(v.product) });
      return m;
    }, {});

    // If outlet specified, get price overrides
    let overridesByVariant = {};
    if (outlet) {
      const overrides = await JhatkaPriceOverride.find({ outlet, variant: { $in: variants.map((v) => v._id) } })
        .select('variant priceMrp priceSale')
        .lean();
      overridesByVariant = overrides.reduce((m, o) => {
        m[String(o.variant)] = { priceMrp: o.priceMrp, priceSale: o.priceSale };
        return m;
      }, {});
    }

    const data = products.map((p) => {
      const pid = String(p._id);
      const productVariants = (variantsByProduct[pid] || []).map((v) => {
        const ov = overridesByVariant[v.id];
        return {
          ...v,
          priceMrp: ov?.priceMrp ?? v.priceMrp,
          priceSale: ov?.priceSale ?? v.priceSale,
        };
      });
      return { ...p, id: pid, variants: productVariants };
    });

    res.json({ products: data });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /jhatka/catalogue/products/:id
 *
 * Single product with full variant details and yield specs.
 */
router.get('/products/:id', jhatkaScope(), validate(V.idParam), async (req, res, next) => {
  try {
    const product = await JhatkaProduct.findById(req.params.id)
      .select('_id name description images baseUnit category displayOrder status')
      .lean();
    if (!product) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');
    }

    const variants = await JhatkaVariant.find({ product: product._id, status: 'active' })
      .select('_id name sku priceMrp priceSale unit weightGrams measurementMode status subscriptionEligible')
      .sort({ displayOrder: 1 })
      .lean();

    const variantIds = variants.map((v) => v._id);
    const yieldSpecs = await JhatkaYieldSpec.find({ variant: { $in: variantIds } }).lean();

    const yieldByVariant = yieldSpecs.reduce((m, y) => {
      m[String(y.variant)] = y;
      return m;
    }, {});

    const data = {
      ...product,
      id: String(product._id),
      variants: variants.map((v) => ({
        ...v,
        id: String(v._id),
        product: String(v.product),
        yieldSpec: yieldByVariant[String(v._id)] || null,
      })),
    };

    res.json({ product: data });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /jhatka/catalogue/variants/:id
 *
 * Single variant with yield spec and applicable price overrides across outlets
 * in the caller's scope.
 */
router.get('/variants/:id', jhatkaScope(), validate(V.idParam), async (req, res, next) => {
  try {
    const variant = await JhatkaVariant.findById(req.params.id)
      .select('_id product name sku priceMrp priceSale unit weightGrams measurementMode status subscriptionEligible')
      .lean();
    if (!variant) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Variant not found');
    }

    const yieldSpec = await JhatkaYieldSpec.findOne({ variant: variant._id }).lean();

    const overrides = await JhatkaPriceOverride.find({ variant: variant._id, outlet: { $in: req.permittedOutletIds } })
      .select('outlet priceMrp priceSale')
      .lean();

    const overridesMap = overrides.reduce((m, o) => {
      m[String(o.outlet)] = { priceMrp: o.priceMrp, priceSale: o.priceSale };
      return m;
    }, {});

    res.json({
      variant: {
        ...variant,
        id: String(variant._id),
        product: String(variant.product),
        yieldSpec,
      },
      priceOverrides: overridesMap,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /jhatka/catalogue/yield-specs/variant/:variantId
 *
 * Get the yield spec for a variant (convenience endpoint).
 */
router.get('/yield-specs/variant/:variantId', jhatkaScope(), validate(V.variantIdParam), async (req, res, next) => {
  try {
    const yieldSpec = await JhatkaYieldSpec.findOne({ variant: req.params.variantId }).lean();
    if (!yieldSpec) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Yield spec not found');
    }
    res.json({ yieldSpec: { ...yieldSpec, id: String(yieldSpec._id), variant: String(yieldSpec.variant) } });
  } catch (error) {
    next(error);
  }
});

module.exports = router;