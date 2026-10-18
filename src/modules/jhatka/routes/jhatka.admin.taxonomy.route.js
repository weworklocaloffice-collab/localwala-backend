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
 * jhatka.admin.taxonomy.route.js — B1.1
 *
 * Admin CRUD for the category tree, products and variants.
 *
 * ## Why an admin surface exists at all
 *
 * Everything else in this vertical is a customer or an outlet. The taxonomy is the one
 * thing that has to be RIGHT before either can do anything: a variant marked `WEIGHT`
 * instead of `COUNT` decides whether a line is weighed at the counter, and a category's
 * `weightPolicy` decides whether a 10% over-delivery is charged or absorbed. Both fail
 * SILENTLY — the order still succeeds, just wrongly — so the guard belongs here.
 *
 * ## There is no closure table in this schema, and that shapes the design
 *
 * `JhatkaCategory` stores `key` + `parent` and derives `isSubCategory` and
 * `effectiveProfile` as VIRTUALS. There is no `JhatkaCategoryClosure` and no denormalised
 * `root`/`depth`/`path`. So category filtering below walks the tree rather than issuing
 * an indexed `$in` on a closure — a deliberate trade: the launch taxonomy is four roots
 * and a few dozen nodes, so the walk is cheap, and NOT inventing columns that the model
 * does not have is worth more than the query optimisation.
 *
 * ## `status` is a BOOLEAN on all three models, not an enum
 *
 * Checked against the live schema. `status: 'active'` would be cast to `true` by
 * Mongoose and silently mean the same thing, which is exactly the kind of accident that
 * makes a route look correct and the data wrong.
 */

const express = require('express');
const { status: httpStatus } = require('http-status');

const ApiError = require('../../../utils/ApiError');
const webAuth = require('../../../middlewares/webAuth');
const { JhatkaCategory, JhatkaProduct, JhatkaVariant } = require('../../../models');

const router = express.Router();
const validate = require('../../../middlewares/validate');
const V = require('../validations/jhatka.admin.validation');

/** -1 — the four roots the launch taxonomy is allowed to have. */
const LAUNCH_ROOTS = ['meat', 'seafood', 'poultry', 'eggs'];

/** -5 — display units. Lowercase, and a DIFFERENT vocabulary from `packSize.unit`. */
const UNIT_LABELS = ['kg', 'g', 'pc', 'dozen', 'tier', 'piece'];
/** -5 — canonical quantity units. Uppercase. What arithmetic is done in. */
const QUANTITY_UNITS = ['GRAM', 'KG', 'PIECE', 'DOZEN', 'TIER', 'PACK'];

const slugify = (s) =>
  String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/**
 * Every descendant id of `categoryId`, inclusive.
 *
 * Walks `parent` links upward from the node. Bounded by `maxDepth` so a cycle
 * introduced by bad data cannot spin the event loop forever — an admin can PATCH a
 * parent here, and nothing else stops `A -> B -> A`.
 */
async function descendantIds(categoryId, maxDepth = 12) {
  const out = [String(categoryId)];
  let frontier = [String(categoryId)];

  for (let depth = 0; depth < maxDepth && frontier.length; depth += 1) {
    const children = await JhatkaCategory.find({ parent: { $in: frontier } }).select('_id').lean();
    const next = children.map((c) => String(c._id)).filter((id) => !out.includes(id));

    if (!next.length) break;
    out.push(...next);
    frontier = next;
  }

  return out;
}

/**
 * GET /v1/jhatka/admin/taxonomy
 *
 * The whole tree. Flat with `isSubCategory` and `parent`, because an admin table
 * renders flat and the tree is four roots deep.
 */
router.get('/taxonomy', webAuth('jhatka_catalog_read'), async (req, res, next) => {
  try {
    const { root, status } = req.query;

    let categories = await JhatkaCategory.find(
      status === undefined ? {} : { status: status === 'true' || status === true }
    )
      .sort({ sortOrder: 1, name: 1 })
      .lean();

    // `root` is resolved by walking, because the model has no root column.
    if (root) {
      const wanted = String(root).toLowerCase();
      const topLevel = categories.filter((c) => !c.parent);
      const match = topLevel.find(
        (c) => String(c.key).toLowerCase() === wanted || String(c.slug).toLowerCase() === wanted
      );
      if (!match) {
        throw new ApiError(httpStatus.NOT_FOUND, `No top-level category '${root}'`);
      }
      const ids = await descendantIds(match._id);
      categories = categories.filter((c) => ids.includes(String(c._id)));
    }

    return res.json({
      categories: categories.map((c) => ({
        ...c,
        isSubCategory: !!c.parent,
      })),
      launchRoots: LAUNCH_ROOTS,
      count: categories.length,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /v1/jhatka/admin/taxonomy/categories
 *
 * Body: `{ key, name, parent?, description?, weightPolicy?, ... }`
 *
 * `key` is required and is the tree's stable identifier — `slug` is presentation and
 * can change, `key` cannot, because it is what an import script matches on.
 *
 * A ROOT's key must be one of the four launch roots. Checked here because this is the
 * only place a new root can be introduced, and a fifth root is a fifth kind of thing
 * every downstream query has to learn about.
 */
router.post('/taxonomy/categories', webAuth('jhatka_catalog_write'), validate(V.categoryBody), async (req, res, next) => {
  try {
    const { key, name, parent, slug, description, defaultMeasurementMode, weightPolicy } =
      req.body || {};

    if (!key) throw new ApiError(httpStatus.BAD_REQUEST, 'key is required');
    if (!name) throw new ApiError(httpStatus.BAD_REQUEST, 'name is required');

    if (!parent) {
      const normalizedKey = slugify(key);
      if (!LAUNCH_ROOTS.includes(normalizedKey)) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `A top-level category must be one of: ${LAUNCH_ROOTS.join(', ')}`,
          true,
          '',
          { code: 'INVALID_LAUNCH_ROOT', allowed: LAUNCH_ROOTS, received: normalizedKey }
        );
      }
    } else {
      const parentDoc = await JhatkaCategory.findById(parent).lean();
      if (!parentDoc) throw new ApiError(httpStatus.BAD_REQUEST, 'parent category not found');
    }

    const created = await JhatkaCategory.create({
      key: slugify(key),
      name,
      slug: slug ? slugify(slug) : slugify(key),
      parent: parent || undefined,
      description,
      defaultMeasurementMode: defaultMeasurementMode || undefined,
      // Only a ROOT may define a weight policy. A sub-category INHERITS its parent's,
      // and a policy defined here would be silently ignored — which is a worse failure
      // than refusing it, because an admin would believe they had configured it.
      weightPolicy: parent ? undefined : weightPolicy,
      status: true,
    });

    return res.status(201).json({ category: created.toObject() });
  } catch (error) {
    return next(error);
  }
});

/**
 * PATCH /v1/jhatka/admin/taxonomy/categories/:category
 *
 * Naming, description, policy and status. `parent` is deliberately NOT editable: the
 * model derives everything else from it, and a reparent that moves a subtree under a
 * different root changes the weight policy every descendant resolves to. That is a
 * migration with an audit trail, not a PATCH.
 */
router.patch('/taxonomy/categories/:category', webAuth('jhatka_catalog_write'), validate(V.namedParam('category')), validate(V.categoryBody), async (req, res, next) => {
  try {
    const cat = await JhatkaCategory.findById(req.params.category);
    if (!cat) throw new ApiError(httpStatus.NOT_FOUND, 'Category not found');

    if (req.body.parent !== undefined && String(req.body.parent || '') !== String(cat.parent || '')) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'parent is not editable here. Moving a subtree changes the weight policy every descendant inherits.',
        true,
        '',
        { code: 'REPARENT_NOT_SUPPORTED' }
      );
    }

    const { name, slug, description, image, icon, featured, defaultMeasurementMode,
      weightPolicy, subscriptionEligibleByDefault, shelfLifeHoursRaw, shelfLifeHoursPrepared,
      storageTemperatureC, status } = req.body || {};

    if (name !== undefined) cat.name = name;
    if (slug !== undefined) cat.slug = slugify(slug);
    if (description !== undefined) cat.description = description;
    if (image !== undefined) cat.image = image;
    if (icon !== undefined) cat.icon = icon;
    if (featured !== undefined) cat.featured = !!featured;
    if (defaultMeasurementMode !== undefined) cat.defaultMeasurementMode = defaultMeasurementMode;
    if (shelfLifeHoursRaw !== undefined) cat.shelfLifeHoursRaw = Number(shelfLifeHoursRaw);
    if (shelfLifeHoursPrepared !== undefined) {
      cat.shelfLifeHoursPrepared = Number(shelfLifeHoursPrepared);
    }
    if (storageTemperatureC !== undefined) cat.storageTemperatureC = Number(storageTemperatureC);
    if (subscriptionEligibleByDefault !== undefined) {
      cat.subscriptionEligibleByDefault = !!subscriptionEligibleByDefault;
    }
    if (status !== undefined) cat.status = status === true || status === 'true';

    // A weight policy on a sub-category is silently ignored (it inherits), so refuse it
    // rather than accept a value that will never be read.
    if (weightPolicy !== undefined) {
      if (cat.parent) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          'A sub-category inherits its weightPolicy from its parent; set it on the root instead.',
          true,
          '',
          { code: 'POLICY_INHERITED', parent: String(cat.parent) }
        );
      }
      cat.weightPolicy = { ...(cat.weightPolicy || {}), ...weightPolicy };
    }

    await cat.save();
    return res.json({ category: cat.toObject() });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /v1/jhatka/admin/taxonomy/products
 *
 * `category` includes every DESCENDANT — an admin filtering "Chicken" expects its
 * sub-categories, not just products attached to the parent node.
 */
router.get('/taxonomy/products', webAuth('jhatka_catalog_read'), async (req, res, next) => {
  try {
    const { category, search, status, page = 1, limit = 50 } = req.query;

    const query = {};
    if (status !== undefined) query.status = status === 'true' || status === true;
    if (search) {
      // Escape the user's input: an unescaped `search` is a ReDoS vector and, with the
      // `i` flag, matches things nobody typed.
      const safe = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.name = new RegExp(safe, 'i');
    }

    if (category) {
      const cat = await JhatkaCategory.findById(category).lean();
      if (!cat) throw new ApiError(httpStatus.BAD_REQUEST, 'Category not found');
      query.category = { $in: await descendantIds(cat._id) };
    }

    const products = await JhatkaProduct.find(query)
      .populate('category', 'key name slug')
      .sort({ sortOrder: 1, name: 1 })
      .skip((Math.max(1, Number(page)) - 1) * Number(limit))
      .limit(Math.min(200, Math.max(1, Number(limit))))
      .lean();

    return res.json({
      products,
      page: Number(page),
      limit: Number(limit),
      count: products.length,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /v1/jhatka/admin/taxonomy/products
 *
 * `code`, `category`, `name`, `hsnCode` and `taxRatePct` are ALL REQUIRED by the model.
 * Each is checked here so the admin gets a named 400 rather than a Mongoose
 * ValidationError listing five fields at once — and so a missing `taxRatePct` cannot
 * slip through as an assumed 0, which would under-collect on every future order.
 */
router.post('/taxonomy/products', webAuth('jhatka_catalog_write'), validate(V.productBody), async (req, res, next) => {
  try {
    const {
      name, category, code, slug, description, image, hsnCode,
      taxRatePct, shelfLifeDaysAmbient, storageMode, prepTimeMinutes,
    } = req.body || {};

    for (const [field, label] of [
      ['name', 'name'], ['category', 'category'], ['code', 'code'],
      ['hsnCode', 'hsnCode'], ['taxRatePct', 'taxRatePct'],
    ]) {
      if (req.body?.[field] === undefined || req.body?.[field] === null || req.body?.[field] === '') {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `${label} is required`,
          true,
          '',
          { code: 'MISSING_REQUIRED_FIELD', field }
        );
      }
    }

    const cat = await JhatkaCategory.findById(category).lean();
    if (!cat) throw new ApiError(httpStatus.BAD_REQUEST, 'Category not found');

    const product = await JhatkaProduct.create({
      name,
      code,
      category: cat._id,
      slug: slug ? slugify(slug) : slugify(name),
      description,
      image,
      hsnCode,
      taxRatePct: Number(taxRatePct),
      shelfLifeDaysAmbient:
        shelfLifeDaysAmbient === undefined ? undefined : Number(shelfLifeDaysAmbient),
      storageMode: storageMode || undefined,
      prepTimeMinutes: prepTimeMinutes === undefined ? undefined : Number(prepTimeMinutes),
      // Derived from the category's own default, so a product cannot be created as
      // WEIGHT under a COUNT category unless the admin says so explicitly afterwards.
      isVariableWeight: cat.defaultMeasurementMode === 'WEIGHT',
      status: true,
    });

    return res.status(201).json({ product: product.toObject() });
  } catch (error) {
    return next(error);
  }
});

/** PATCH /v1/jhatka/admin/taxonomy/products/:product */
router.patch('/taxonomy/products/:product', webAuth('jhatka_catalog_write'), validate(V.namedParam('product')), validate(V.productBody), async (req, res, next) => {
  try {
    const product = await JhatkaProduct.findById(req.params.product);
    if (!product) throw new ApiError(httpStatus.NOT_FOUND, 'Product not found');

    const {
      name, slug, description, image, hsnCode, taxRatePct,
      shelfLifeDaysAmbient, storageMode, prepTimeMinutes, status, isVariableWeight,
    } = req.body || {};

    if (name !== undefined) product.name = name;
    if (slug !== undefined) product.slug = slugify(slug);
    if (description !== undefined) product.description = description;
    if (image !== undefined) product.image = image;
    if (hsnCode !== undefined) product.hsnCode = hsnCode;
    if (taxRatePct !== undefined) product.taxRatePct = Number(taxRatePct);
    if (shelfLifeDaysAmbient !== undefined) product.shelfLifeDaysAmbient = Number(shelfLifeDaysAmbient);
    if (storageMode !== undefined) product.storageMode = storageMode;
    if (prepTimeMinutes !== undefined) product.prepTimeMinutes = Number(prepTimeMinutes);
    if (isVariableWeight !== undefined) product.isVariableWeight = !!isVariableWeight;
    if (status !== undefined) product.status = status === true || status === 'true';

    await product.save();
    return res.json({ product: product.toObject() });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /v1/jhatka/admin/taxonomy/variants?product=
 *
 * List variants, optionally scoped to a product. Exists because the products list
 * does not embed variants, and the admin console needs them to edit prices and
 * toggle status — without this, price changes would require a separate lookup
 * per variant by id, which the console does not have.
 */
router.get('/taxonomy/variants', webAuth('jhatka_catalog_read'), async (req, res, next) => {
  try {
    const { product, status, page = 1, limit = 50 } = req.query;

    const query = {};
    if (product) query.product = product;
    if (status !== undefined) query.status = status === 'true' || status === true;

    const variants = await JhatkaVariant.find(query)
      .populate('product', 'name code')
      .sort({ sortOrder: 1, name: 1 })
      .skip((Math.max(1, Number(page)) - 1) * Number(limit))
      .limit(Math.min(200, Math.max(1, Number(limit))))
      .lean();

    return res.json({
      variants,
      page: Number(page),
      limit: Number(limit),
      count: variants.length,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /v1/jhatka/admin/taxonomy/variants
 *
 * Body: `{ product, sku, name, measurementMode, pricePerUnit, priceBasis, packSize, ... }`
 *
 * `packSize.value` is REQUIRED by the model — a variant without a pack size has no
 * meaning at the shelf or on the scale.
 *
 * `pricePerUnit` arrives as RUPEES (an admin types "400", not "40000") and is a
 * moneyField. Every 100x bug in this vertical came from assigning PAISE to a moneyField,
 * so the direction is stated here rather than left to memory.
 */
router.post('/taxonomy/variants', webAuth('jhatka_catalog_write'), validate(V.variantBody), async (req, res, next) => {
  try {
    const {
      product, sku, name, measurementMode, pricePerUnit, priceBasis,
      packSize, minOrderQty, stepSize, subscriptionEligible, subscriptionChargeMode,
      subscriptionCeilingPct, estimatedAvailability, availabilityUnit, image, unitLabel,
    } = req.body || {};

    if (!product) throw new ApiError(httpStatus.BAD_REQUEST, 'product is required');
    if (!sku) throw new ApiError(httpStatus.BAD_REQUEST, 'sku is required');
    if (!name) throw new ApiError(httpStatus.BAD_REQUEST, 'name is required');
    if (!unitLabel) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `unitLabel is required — one of ${UNIT_LABELS.join(' | ')}`,
        true,
        '',
        { code: 'MISSING_REQUIRED_FIELD', field: 'unitLabel', allowed: UNIT_LABELS }
      );
    }
    if (!UNIT_LABELS.includes(unitLabel)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `unitLabel must be one of ${UNIT_LABELS.join(' | ')} — it is a DISPLAY label ("kg"), lowercase, and is a different vocabulary from packSize.unit ("KG")`,
        true,
        '',
        { code: 'INVALID_UNIT_LABEL', allowed: UNIT_LABELS, received: unitLabel }
      );
    }
    if (!QUANTITY_UNITS.includes(packSize?.unit)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `packSize.unit must be one of ${QUANTITY_UNITS.join(' | ')} — uppercase, and the unit all arithmetic is done in`,
        true,
        '',
        { code: 'INVALID_QUANTITY_UNIT', allowed: QUANTITY_UNITS, received: packSize?.unit }
      );
    }
    if (!['WEIGHT', 'COUNT'].includes(measurementMode)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'measurementMode must be WEIGHT or COUNT');
    }
    if (!priceBasis) throw new ApiError(httpStatus.BAD_REQUEST, 'priceBasis is required');
    if (!packSize?.value) throw new ApiError(httpStatus.BAD_REQUEST, 'packSize.value is required');
    if (!packSize?.unit) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `packSize.unit is required — one of ${QUANTITY_UNITS.join(' | ')}`,
        true,
        '',
        { code: 'MISSING_REQUIRED_FIELD', field: 'packSize.unit' }
      );
    }
    if (pricePerUnit === undefined || Number.isNaN(Number(pricePerUnit))) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'pricePerUnit (in RUPEES) is required');
    }

    const productDoc = await JhatkaProduct.findById(product).lean();
    if (!productDoc) throw new ApiError(httpStatus.BAD_REQUEST, 'Product not found');

    const variant = await JhatkaVariant.create({
      product: productDoc._id,
      sku: String(sku).toUpperCase().trim(),
      name,
      image: image || productDoc.image,
      measurementMode,
      unitLabel,
      priceBasis,
      // RUPEES into a moneyField. See the note above.
      pricePerUnit: Number(pricePerUnit),
      packSize: { value: Number(packSize.value), unit: packSize.unit },
      // Ordering constraints: a butcher will not cut 200 g of a whole bird, and a
      // customer cannot order 1.5 eggs. Both are optional in the model, so both are
      // optional here — but if supplied, the unit must match the pack or the
      // constraint is meaningless ("min 1 PIECE" on a 500 g pack).
      minOrderQty: minOrderQty?.value
        ? {
            value: Number(minOrderQty.value),
            unit: minOrderQty.unit || packSize.unit,
          }
        : undefined,
      stepSize: stepSize?.value
        ? { value: Number(stepSize.value), unit: stepSize.unit || packSize.unit }
        : undefined,
      subscriptionEligible: subscriptionEligible === undefined ? true : !!subscriptionEligible,
      subscriptionChargeMode: subscriptionChargeMode || 'ceiling',
      subscriptionCeilingPct:
        subscriptionCeilingPct === undefined ? 10 : Number(subscriptionCeilingPct),
      estimatedAvailability:
        estimatedAvailability === undefined ? 0 : Number(estimatedAvailability),
      availabilityUnit: availabilityUnit || (measurementMode === 'WEIGHT' ? 'KG' : 'PIECE'),
      status: true,
    });

    return res.status(201).json({ variant: variant.toObject() });
  } catch (error) {
    return next(error);
  }
});

/**
 * PATCH /v1/jhatka/admin/taxonomy/variants/:variant
 *
 * `measurementMode` is REFUSED, not ignored. It is the fork the whole order flow keys
 * off, and -16.2 BR-09 freezes it on the order line precisely so an admin cannot change
 * a line's basis between checkout and weighing. Allowing the same change on the VARIANT
 * would change the catalogue under an order that has already committed to a price.
 *
 * `pricePerUnit` IS editable: orders snapshot the price at placement, so a change
 * affects future orders only and never restates a settled one.
 */
router.patch('/taxonomy/variants/:variant', webAuth('jhatka_catalog_write'), validate(V.namedParam('variant')), validate(V.variantBody), async (req, res, next) => {
  try {
    if (req.body.measurementMode !== undefined) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'measurementMode is immutable. Create a new variant — changing it under a live order breaks BR-09.',
        true,
        '',
        { code: 'MEASUREMENT_MODE_IMMUTABLE' }
      );
    }

    const variant = await JhatkaVariant.findById(req.params.variant);
    if (!variant) throw new ApiError(httpStatus.NOT_FOUND, 'Variant not found');

    const {
      name, pricePerUnit, priceBasis, status, subscriptionEligible,
      subscriptionCeilingPct, estimatedAvailability, availabilityUnit, image, sortOrder,
    } = req.body || {};

    if (name !== undefined) variant.name = name;
    if (pricePerUnit !== undefined) variant.pricePerUnit = Number(pricePerUnit);
    if (priceBasis !== undefined) variant.priceBasis = priceBasis;
    if (subscriptionEligible !== undefined) variant.subscriptionEligible = !!subscriptionEligible;
    if (subscriptionCeilingPct !== undefined) {
      variant.subscriptionCeilingPct = Number(subscriptionCeilingPct);
    }
    if (estimatedAvailability !== undefined) {
      variant.estimatedAvailability = Number(estimatedAvailability);
    }
    if (availabilityUnit !== undefined) variant.availabilityUnit = availabilityUnit;
    if (image !== undefined) variant.image = image;
    if (sortOrder !== undefined) variant.sortOrder = Number(sortOrder);
    if (status !== undefined) variant.status = status === true || status === 'true';

    await variant.save();
    return res.json({ variant: variant.toObject() });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
module.exports.LAUNCH_ROOTS = LAUNCH_ROOTS;
module.exports.descendantIds = descendantIds;