/**
 * LocalWala - Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright (c) 2026 WeWorkLocal Private Limited
 * https://weworklocal.in/
 *
 * WeWorkLocal Private Limited
 *
 * This source code is confidential. Unauthorized copying, redistribution, resale,
 * publication, modification, or use of this source code is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const { status: httpStatus } = require('http-status');
const ApiError = require('../../../utils/ApiError');
const schema = require('../../../utils/importCollectionSchema');
const { slugify } = require('./stores.admin.taxonomy.service');
const brandRequestService = require('./stores.brand.request.service');

/**
 * Chain product bulk import.
 *
 * The file is parsed and cross-referenced before the first product is written.
 * A bad row changes no product, matching the taxonomy importer's all-or-nothing
 * contract.
 *
 * Brand handling follows §5.7.7:
 *   - approved brand -> attach it;
 *   - pending/rejected/archived brand -> reject the row;
 *   - unknown name -> create a pending brand REQUEST (never a StoreBrand) and
 *     reject the row.
 *
 * The request is a side effect of a rejected attempt, not catalogue data. It is
 * still created when the rest of the file has errors so the chain can see what
 * it needs Admin to approve.
 */

const LIST_SEPARATOR = /[|,;]/;
const BRAND_REQUEST_NOTE = 'Requested by bulk product import';

const readText = (row, key) => {
  const value = row[key];
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const parseBoolean = (raw, fallback, label) => {
  const text = String(raw === undefined || raw === null ? '' : raw)
    .trim()
    .toLowerCase();
  if (!text) return fallback;
  if (['true', '1', 'yes', 'y', 'active', 'enabled'].includes(text)) return true;
  if (['false', '0', 'no', 'n', 'inactive', 'disabled'].includes(text)) return false;
  throw new Error(`${label} must be true or false, got "${raw}"`);
};

const parseNumber = (raw, label, { fallback = 0, min = 0, max, integer = false } = {}) => {
  const text = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!text) return fallback;
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error(`${label} must be a number, got "${raw}"`);
  if (integer && !Number.isInteger(value)) throw new Error(`${label} must be a whole number`);
  if (value < min) throw new Error(`${label} must be at least ${min}`);
  if (max !== undefined && value > max) throw new Error(`${label} must be at most ${max}`);
  return value;
};

const parseList = (raw) => {
  const text = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!text) return [];
  return text
    .split(LIST_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);
};

const requiredText = (row, key, label) => {
  const value = readText(row, key);
  if (!value) throw new Error(`${label} is required`);
  return value;
};

const throwRows = (errors) => {
  if (!errors.length) return;
  const shown = errors.slice(0, 5).join('; ');
  const more = errors.length > 5 ? ` (and ${errors.length - 5} more)` : '';
  throw new ApiError(httpStatus.BAD_REQUEST, `Import failed - ${shown}${more}`);
};

const assertHeaders = (headers) => {
  const expected = schema.chainProductSchemaKeys;
  const actual = (headers || [])
    .map((header) => String(header === undefined || header === null ? '' : header).trim())
    .filter(Boolean);

  if (!actual.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'The uploaded file has no header row');
  }

  const missing = expected.filter((key) => !actual.includes(key));
  const unexpected = actual.filter((key) => !expected.includes(key));

  if (missing.length || unexpected.length || actual.length !== expected.length) {
    const parts = [];
    if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
    if (unexpected.length) parts.push(`unexpected: ${unexpected.join(', ')}`);
    if (!missing.length && !unexpected.length) parts.push('duplicate columns');
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Template columns do not match chain products (${parts.join('; ')})`
    );
  }
};

const buildTaxonomy = async () => {
  const StoreCategory = mongoose.model('StoreCategory');
  const StoreSubcategory = mongoose.model('StoreSubcategory');

  const [categories, subcategories] = await Promise.all([
    StoreCategory.find({ status: true }).select('key name').lean(),
    StoreSubcategory.find({ status: true }).select('key name slug category categoryDefaults').lean(),
  ]);

  const categoryMap = new Map();
  for (const category of categories) {
    categoryMap.set(category.key.toLowerCase(), category);
    categoryMap.set(category.name.toLowerCase(), category);
  }

  const subcategoryMap = new Map();
  for (const subcategory of subcategories) {
    subcategoryMap.set(subcategory.key.toLowerCase(), subcategory);
    subcategoryMap.set(subcategory.name.toLowerCase(), subcategory);
    if (subcategory.slug) subcategoryMap.set(subcategory.slug.toLowerCase(), subcategory);
  }

  return { categories, subcategories, categoryMap, subcategoryMap };
};

const buildBrandIndex = async () => {
  const StoreBrand = mongoose.model('StoreBrand');
  const StoreBrandRequest = mongoose.model('StoreBrandRequest');

  const [brands, requests] = await Promise.all([
    StoreBrand.find({}).select('name slug aliases status categories subcategories').lean(),
    StoreBrandRequest.find({ status: { $in: ['pending', 'rejected'] } })
      .select('name slug status')
      .lean(),
  ]);

  const brandMap = new Map();
  for (const brand of brands) {
    const tokens = [brand.name, brand.slug, ...(brand.aliases || [])];
    for (const token of tokens) {
      if (!token) continue;
      const key = String(token).toLowerCase();
      const current = brandMap.get(key);
      if (!current || (current.status !== 'approved' && brand.status === 'approved')) {
        brandMap.set(key, brand);
      }
    }
  }

  const requestMap = new Map();
  for (const request of requests) {
    requestMap.set(String(request.name).toLowerCase(), request);
    requestMap.set(String(request.slug).toLowerCase(), request);
  }

  return { brandMap, requestMap };
};

const resolveBrand = ({ token, brandMap, requestMap }) => {
  const key = token.toLowerCase();
  const brand = brandMap.get(key);
  if (brand) {
    if (brand.status === 'approved') return { brand };
    return { error: `brand "${token}" is ${brand.status} and cannot be used` };
  }

  const request = requestMap.get(key);
  if (request) {
    if (request.status === 'rejected') {
      return { error: `brand "${token}" has a rejected request` };
    }
    return { error: `brand "${token}" is awaiting Admin approval` };
  }

  return { unknown: true };
};

const importProducts = async ({ chain, by, records, headers }) => {
  assertHeaders(headers);

  const ChainProduct = mongoose.model('ChainProduct');
  const StoreBrand = mongoose.model('StoreBrand');

  const { categoryMap, subcategoryMap } = await buildTaxonomy();
  const { brandMap, requestMap } = await buildBrandIndex();

  const errors = [];
  const rows = [];
  const seenSlugs = new Map();
  const requestCandidates = new Map();

  records.forEach((record, index) => {
    const rowNumber = index + 2;
    try {
      const name = requiredText(record, 'name', 'name');
      const slug = slugify(name);
      if (!slug) throw new Error('name must contain letters or numbers');
      if (seenSlugs.has(slug)) {
        throw new Error(`duplicate product "${name}" (also row ${seenSlugs.get(slug)})`);
      }

      const rawCategory = requiredText(record, 'category', 'category');
      const category = categoryMap.get(rawCategory.toLowerCase());
      if (!category) throw new Error(`category "${rawCategory}" was not found`);

      let subcategory = null;
      const rawSubcategory = readText(record, 'subcategory');
      if (rawSubcategory) {
        subcategory = subcategoryMap.get(rawSubcategory.toLowerCase());
        if (!subcategory) throw new Error(`subcategory "${rawSubcategory}" was not found`);
        if (String(subcategory.category) !== String(category._id)) {
          throw new Error(`subcategory "${rawSubcategory}" does not belong to category "${rawCategory}"`);
        }
      }

      const defaults = (subcategory && subcategory.categoryDefaults) || {};

      const basePrice = parseNumber(record.basePrice, 'basePrice', { fallback: 0, min: 0 });
      const baseMrp = parseNumber(record.baseMrp, 'baseMrp', {
        fallback: undefined,
        min: 0,
      });
      if (baseMrp !== undefined && baseMrp < basePrice) {
        throw new Error('baseMrp cannot be less than basePrice');
      }

      const taxPercentage = parseNumber(record.taxPercentage, 'taxPercentage', {
        fallback: 0,
        min: 0,
        max: 28,
      });
      const tax = readText(record, 'tax').toLowerCase() || 'inclusive';
      if (!['inclusive', 'exclusive', 'none'].includes(tax)) {
        throw new Error('tax must be inclusive, exclusive or none');
      }

      const hsn = readText(record, 'hsn');
      if (defaults.hsnRequired && !hsn) throw new Error('hsn is required for this subcategory');

      const warrantyMonths = parseNumber(record.warrantyMonths, 'warrantyMonths', {
        fallback: 0,
        min: 0,
        integer: true,
      });
      const warrantyProvider = readText(record, 'warrantyProvider');
      const warrantyType = readText(record, 'warrantyType').toLowerCase();
      if (
        warrantyType &&
        !['manufacturer', 'store', 'manufacturer_service_centre'].includes(warrantyType)
      ) {
        throw new Error(
          'warrantyType must be manufacturer, store or manufacturer_service_centre'
        );
      }
      if (defaults.warrantyRequired && !warrantyMonths) {
        throw new Error('warrantyMonths is required for this subcategory');
      }

      let brand = null;
      const brandToken = readText(record, 'brand');
      if (brandToken) {
        const resolved = resolveBrand({ token: brandToken, brandMap, requestMap });
        if (resolved.brand) {
          brand = resolved.brand;
        } else if (resolved.error) {
          throw new Error(resolved.error);
        } else {
          const candidateKey = slugify(brandToken);
          if (!requestCandidates.has(candidateKey)) {
            requestCandidates.set(candidateKey, {
              name: brandToken,
              category: category._id,
              subcategory: subcategory?._id,
            });
          }
          throw new Error(
            `brand "${brandToken}" is not approved; a pending brand request was created`
          );
        }
      } else if (defaults.brandRequired) {
        throw new Error('brand is required for this subcategory');
      }

      const status = (readText(record, 'status') || 'active').toLowerCase();
      if (!['active', 'inactive'].includes(status)) {
        throw new Error('status must be active or inactive');
      }

      const prepared = {
        rowNumber,
        slug,
        name,
        description: readText(record, 'description'),
        category: category._id,
        subcategory: subcategory?._id,
        brand: brand?._id,
        brandSubcategory: brand && subcategory ? subcategory._id : null,
        images: parseList(record.images),
        videoUrl: readText(record, 'videoUrl'),
        basePrice,
        baseMrp,
        tax,
        taxPercentage,
        hsn,
        tags: parseList(record.tags),
        searchTerms: parseList(record.searchTerms),
        isOrganic: parseBoolean(record.isOrganic, false, 'isOrganic'),
        warranty:
          warrantyMonths || warrantyProvider || warrantyType
            ? {
                months: warrantyMonths,
                provider: warrantyProvider || undefined,
                type: warrantyType || undefined,
              }
            : undefined,
        status,
      };

      seenSlugs.set(slug, rowNumber);
      rows.push(prepared);
    } catch (error) {
      errors.push(`row ${rowNumber}: ${error.message}`);
    }
  });

  for (const candidate of requestCandidates.values()) {
    try {
      await brandRequestService.requestBrand({
        chain: chain._id,
        by,
        name: candidate.name,
        category: candidate.category,
        subcategory: candidate.subcategory,
        note: BRAND_REQUEST_NOTE,
      });
    } catch (error) {
      if (error.statusCode !== httpStatus.CONFLICT) throw error;
    }
  }

  throwRows(errors);

  const slugs = rows.map((row) => row.slug);
  const existing = await ChainProduct.find({ chain: chain._id, slug: { $in: slugs } })
    .select('slug')
    .lean();
  const existingSlugs = new Set(existing.map((row) => row.slug));

  const approvalRequired =
    !!chain.settings?.productApprovalRequired || chain.status !== 'active';

  let created = 0;
  let updated = 0;
  const touchedBrands = new Map();

  for (const row of rows) {
    const product =
      (await ChainProduct.findOne({ chain: chain._id, slug: row.slug })) ||
      new ChainProduct({
        chain: chain._id,
        slug: row.slug,
        createdBy: by,
      });

    product.name = row.name;
    product.description = row.description;
    product.category = row.category;
    product.subcategory = row.subcategory;
    product.brand = row.brand;
    product.images = row.images;
    product.videoUrl = row.videoUrl || undefined;
    product.basePrice = row.basePrice;
    product.baseMrp = row.baseMrp;
    product.tax = row.tax;
    product.taxType = row.tax;
    product.taxPercentage = row.taxPercentage;
    product.hsn = row.hsn || undefined;
    product.tags = row.tags;
    product.searchTerms = row.searchTerms;
    product.isOrganic = row.isOrganic;
    product.warranty = row.warranty;
    product.hasVariants = false;
    product.variantsEnabled = false;
    product.status = row.status;

    if (!product.approval || product.approval.status === 'not_required') {
      product.approval = { status: approvalRequired ? 'pending' : 'not_required' };
    }

    await product.save();

    if (existingSlugs.has(row.slug)) updated += 1;
    else created += 1;

    if (row.brand && row.brandSubcategory) {
      const key = String(row.brand);
      if (!touchedBrands.has(key)) touchedBrands.set(key, new Set());
      touchedBrands.get(key).add(String(row.brandSubcategory));
    }
  }

  for (const [brandId, subcategoryIds] of touchedBrands) {
    await StoreBrand.updateOne(
      { _id: brandId },
      { $addToSet: { subcategories: { $each: [...subcategoryIds] } } }
    );
  }

  return {
    collection: 'chain_product',
    created,
    updated,
    total: rows.length,
  };
};

module.exports = {
  importProducts,
  assertHeaders,
};
