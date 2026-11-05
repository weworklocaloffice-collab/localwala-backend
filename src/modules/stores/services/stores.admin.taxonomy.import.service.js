/**
 * LocalWala - Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright c 2026 WeWorkLocal Private Limited
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

/**
 * Bulk import and export for the stores taxonomy.
 *
 * ## Why this is separate from the taxonomy CRUD service
 *
 * The CRUD surface lets an Admin rename a category. An import has to create the
 * same rows *by stable key*, resolve parents that may appear later in the file,
 * and either apply the whole file or none of it. Mixing that into the CRUD
 * service would make every ordinary create pay for import-only rules.
 *
 * ## All-or-nothing
 *
 * Every row is parsed and cross-referenced before the first write. A file with
 * one bad brand category changes nothing, and the error names the row. This is
 * the behaviour the Admin import screen can explain; a half-applied file cannot.
 *
 * ## Upsert, never delete
 *
 * Rows are matched by `key` (category, subcategory) or name/slug (brand). A
 * re-import is idempotent. Nothing in a file can delete a row, which keeps every
 * historical product reference resolvable (BR-25).
 */

const LIST_SEPARATOR = /[|,;]/;

const COLLECTIONS = {
  store_category: {
    modelName: 'StoreCategory',
    keys: schema.storeCategorySchemaKeys,
    label: 'store categories',
  },
  store_subcategory: {
    modelName: 'StoreSubcategory',
    keys: schema.storeSubcategorySchemaKeys,
    label: 'store subcategories',
  },
  store_brand: {
    modelName: 'StoreBrand',
    keys: schema.storeBrandSchemaKeys,
    label: 'store brands',
  },
};

const BRAND_STATUSES = ['pending', 'approved', 'rejected', 'archived'];

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

const parseSortOrder = (raw) => {
  const text = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!text) return 0;
  const value = Number(text);
  if (!Number.isInteger(value)) throw new Error(`sortOrder must be a whole number, got "${raw}"`);
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

const normalizeKey = (value) =>
  String(value === undefined || value === null ? '' : value)
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

const normalizeSlug = (value) => slugify(value);

const requiredText = (row, key, label) => {
  const value = readText(row, key);
  if (!value) throw new Error(`${label} is required`);
  return value;
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const throwRows = (errors) => {
  if (!errors.length) return;
  const shown = errors.slice(0, 5).join('; ');
  const more = errors.length > 5 ? ` (and ${errors.length - 5} more)` : '';
  throw new ApiError(httpStatus.BAD_REQUEST, `Import failed - ${shown}${more}`);
};

const assertHeaders = (collection, headers) => {
  const expected = COLLECTIONS[collection].keys;
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
      `Template columns do not match ${COLLECTIONS[collection].label} (${parts.join('; ')})`
    );
  }
};

const getCollection = (collection) => {
  const config = COLLECTIONS[collection];
  if (!config) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Unsupported stores import collection "${collection}"`);
  }
  return config;
};

// ---------------------------------------------------------------------------
// categories
// ---------------------------------------------------------------------------

const prepareCategories = (records) => {
  const errors = [];
  const rows = [];
  const seen = new Map();

  records.forEach((record, index) => {
    const rowNumber = index + 2;
    try {
      const name = requiredText(record, 'name', 'name');
      const rawKey = readText(record, 'key');
      const key = normalizeKey(rawKey || name);
      if (!key) throw new Error('key is required (or provide a name to derive one)');
      if (seen.has(key)) {
        throw new Error(`duplicate key "${key}" (also row ${seen.get(key).rowNumber})`);
      }

      const rawParent = readText(record, 'parent');
      const parentKey = rawParent ? normalizeKey(rawParent) : '';
      if (rawParent && !parentKey) throw new Error(`invalid parent "${rawParent}"`);

      const prepared = {
        rowNumber,
        key,
        name,
        description: readText(record, 'description'),
        icon: readText(record, 'icon'),
        sortOrder: parseSortOrder(record.sortOrder),
        parentKey,
        status: parseBoolean(record.status, true, 'status'),
      };

      seen.set(key, prepared);
      rows.push(prepared);
    } catch (error) {
      errors.push(`row ${rowNumber}: ${error.message}`);
    }
  });

  return { rows, seen, errors };
};

const importCategories = async (records) => {
  const StoreCategory = mongoose.model('StoreCategory');
  const { rows, seen, errors } = prepareCategories(records);

  const externalParents = [
    ...new Set(
      rows
        .filter((row) => row.parentKey && !seen.has(row.parentKey))
        .map((row) => row.parentKey)
    ),
  ];
  const existingParents = externalParents.length
    ? await StoreCategory.find({ key: { $in: externalParents } })
        .select('key')
        .lean()
    : [];
  const existingParentKeys = new Set(existingParents.map((parent) => parent.key));

  for (const row of rows) {
    if (!row.parentKey) continue;
    if (row.parentKey === row.key) {
      errors.push(`row ${row.rowNumber}: a category cannot be its own parent`);
    } else if (!seen.has(row.parentKey) && !existingParentKeys.has(row.parentKey)) {
      errors.push(
        `row ${row.rowNumber}: parent "${row.parentKey}" was not found in the file or the database`
      );
    }
  }

  throwRows(errors);

  const keys = rows.map((row) => row.key);
  const existing = await StoreCategory.find({ key: { $in: keys } })
    .select('key')
    .lean();
  const existingKeys = new Set(existing.map((row) => row.key));

  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const category = (await StoreCategory.findOne({ key: row.key })) || new StoreCategory({ key: row.key });
    category.name = row.name;
    category.description = row.description;
    category.icon = row.icon;
    category.sortOrder = row.sortOrder;
    category.status = row.status;
    await category.save();
    if (existingKeys.has(row.key)) updated += 1;
    else created += 1;
  }

  const withParent = rows.filter((row) => row.parentKey);
  if (withParent.length) {
    const parentKeys = [...new Set(withParent.map((row) => row.parentKey))];
    const parents = await StoreCategory.find({ key: { $in: parentKeys } })
      .select('_id key')
      .lean();
    const parentIdByKey = new Map(parents.map((parent) => [parent.key, parent._id]));

    for (const row of withParent) {
      await StoreCategory.updateOne(
        { key: row.key },
        { $set: { parent: parentIdByKey.get(row.parentKey) } }
      );
    }
  }

  return { created, updated, total: rows.length };
};

// ---------------------------------------------------------------------------
// subcategories
// ---------------------------------------------------------------------------

const categoryTokenMap = (categories) => {
  const tokens = new Map();
  for (const category of categories) {
    tokens.set(String(category.key).toLowerCase(), category._id);
    tokens.set(String(category.name || '').trim().toLowerCase(), category._id);
  }
  return tokens;
};

const prepareSubcategories = (records, tokens) => {
  const errors = [];
  const rows = [];
  const seen = new Map();

  records.forEach((record, index) => {
    const rowNumber = index + 2;
    try {
      const categoryToken = requiredText(record, 'category', 'category');
      const categoryId = tokens.get(categoryToken.toLowerCase());
      if (!categoryId) {
        throw new Error(
          `category "${categoryToken}" was not found (use the category key or exact name)`
        );
      }

      const name = requiredText(record, 'name', 'name');
      const rawKey = readText(record, 'key');
      const key = normalizeKey(rawKey || name);
      if (!key) throw new Error('key is required (or provide a name to derive one)');
      if (seen.has(key)) {
        throw new Error(`duplicate key "${key}" (also row ${seen.get(key).rowNumber})`);
      }

      const prepared = {
        rowNumber,
        key,
        categoryId,
        name,
        description: readText(record, 'description'),
        icon: readText(record, 'icon'),
        image: readText(record, 'image'),
        sortOrder: parseSortOrder(record.sortOrder),
        status: parseBoolean(record.status, true, 'status'),
      };

      seen.set(key, prepared);
      rows.push(prepared);
    } catch (error) {
      errors.push(`row ${rowNumber}: ${error.message}`);
    }
  });

  return { rows, errors };
};

const importSubcategories = async (records) => {
  const StoreCategory = mongoose.model('StoreCategory');
  const StoreSubcategory = mongoose.model('StoreSubcategory');
  const categories = await StoreCategory.find({}).select('_id key name').lean();
  const tokens = categoryTokenMap(categories);
  const { rows, errors } = prepareSubcategories(records, tokens);

  throwRows(errors);

  const keys = rows.map((row) => row.key);
  const existing = await StoreSubcategory.find({ key: { $in: keys } })
    .select('key')
    .lean();
  const existingKeys = new Set(existing.map((row) => row.key));

  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const subcategory =
      (await StoreSubcategory.findOne({ key: row.key })) || new StoreSubcategory({ key: row.key });
    subcategory.category = row.categoryId;
    subcategory.name = row.name;
    subcategory.description = row.description;
    subcategory.icon = row.icon;
    subcategory.image = row.image;
    subcategory.sortOrder = row.sortOrder;
    subcategory.status = row.status;
    await subcategory.save();
    if (existingKeys.has(row.key)) updated += 1;
    else created += 1;
  }

  return { created, updated, total: rows.length };
};

// ---------------------------------------------------------------------------
// brands
// ---------------------------------------------------------------------------

const prepareBrands = (records, categoryTokens, subcategoryTokens) => {
  const errors = [];
  const rows = [];

  records.forEach((record, index) => {
    const rowNumber = index + 2;
    try {
      const name = requiredText(record, 'name', 'name');
      const aliasList = parseList(record.aliases);
      const rawStatus = readText(record, 'status').toLowerCase() || 'pending';
      if (!BRAND_STATUSES.includes(rawStatus)) {
        throw new Error(`status must be one of ${BRAND_STATUSES.join(', ')}, got "${rawStatus}"`);
      }

      const categoryTokensRaw = parseList(record.categories);
      if (rawStatus === 'approved' && !categoryTokensRaw.length) {
        throw new Error('an approved brand needs at least one category');
      }

      const categories = categoryTokensRaw.map((token) => {
        const id = categoryTokens.get(token.toLowerCase());
        if (!id) {
          throw new Error(
            `category "${token}" was not found (use the category key or exact name)`
          );
        }
        return id;
      });

      const subcategoryTokensRaw = parseList(record.subcategories);
      const subcategories = subcategoryTokensRaw.map((token) => {
        const id = subcategoryTokens.get(token.toLowerCase());
        if (!id) {
          throw new Error(
            `subcategory "${token}" was not found (use the subcategory key or exact name)`
          );
        }
        return id;
      });

      rows.push({
        rowNumber,
        name,
        slug: normalizeSlug(name),
        aliases: aliasList,
        categories,
        subcategories,
        originCountry: readText(record, 'originCountry'),
        website: readText(record, 'website'),
        description: readText(record, 'description'),
        logo: readText(record, 'logo'),
        banner: readText(record, 'banner'),
        status: rawStatus,
      });
    } catch (error) {
      errors.push(`row ${rowNumber}: ${error.message}`);
    }
  });

  return { rows, errors };
};

const importBrands = async (records) => {
  const StoreBrand = mongoose.model('StoreBrand');
  const StoreCategory = mongoose.model('StoreCategory');
  const StoreSubcategory = mongoose.model('StoreSubcategory');

  const [categories, subcategories] = await Promise.all([
    StoreCategory.find({}).select('_id key name').lean(),
    StoreSubcategory.find({}).select('_id key name').lean(),
  ]);

  const categoryTokens = categoryTokenMap(categories);
  const subcategoryTokens = categoryTokenMap(subcategories);
  const { rows, errors } = prepareBrands(records, categoryTokens, subcategoryTokens);

  throwRows(errors);

  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const existing = await StoreBrand.findOne({
      $or: [{ slug: row.slug }, { name: new RegExp(`^${escapeRegex(row.name)}$`, 'i') }],
    });
    const brand = existing || new StoreBrand({ name: row.name });

    brand.name = row.name;
    brand.aliases = row.aliases;
    brand.categories = row.categories;
    brand.subcategories = row.subcategories;
    brand.originCountry = row.originCountry;
    brand.website = row.website;
    brand.description = row.description;
    if (row.logo) brand.logo = row.logo;
    if (row.banner) brand.banner = row.banner;
    brand.status = row.status;
    if (row.status === 'approved') brand.isVerified = true;

    await brand.save();
    if (existing) updated += 1;
    else created += 1;
  }

  return { created, updated, total: rows.length };
};

// ---------------------------------------------------------------------------
// public surface
// ---------------------------------------------------------------------------

const importCollection = async (collection, records, headers) => {
  const config = getCollection(collection);
  if (!Array.isArray(records) || !records.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'The uploaded file has no data rows');
  }

  if (headers) assertHeaders(collection, headers);

  const result =
    collection === 'store_category'
      ? await importCategories(records)
      : collection === 'store_subcategory'
        ? await importSubcategories(records)
        : await importBrands(records);

  return { collection, label: config.label, ...result };
};

const uniqueTokens = (values) => [...new Set(values.filter(Boolean))];

const exportCollection = async (collection) => {
  getCollection(collection);
  const keys = COLLECTIONS[collection].keys;

  if (collection === 'store_category') {
    const StoreCategory = mongoose.model('StoreCategory');
    const [categories, parents] = await Promise.all([
      StoreCategory.find({}).sort({ sortOrder: 1, name: 1 }).lean(),
      StoreCategory.find({}).select('_id key').lean(),
    ]);
    const keyById = new Map(parents.map((parent) => [String(parent._id), parent.key]));

    const rows = categories.map((category) => ({
      key: category.key,
      name: category.name,
      description: category.description || '',
      icon: category.icon || '',
      sortOrder: category.sortOrder === undefined ? 0 : category.sortOrder,
      parent: category.parent ? keyById.get(String(category.parent)) || '' : '',
      status: category.status !== false,
    }));

    return { keys, rows };
  }

  if (collection === 'store_subcategory') {
    const [StoreSubcategory, StoreCategory] = [
      mongoose.model('StoreSubcategory'),
      mongoose.model('StoreCategory'),
    ];
    const [subcategories, categories] = await Promise.all([
      StoreSubcategory.find({}).sort({ sortOrder: 1, name: 1 }).lean(),
      StoreCategory.find({}).select('_id key').lean(),
    ]);
    const keyById = new Map(categories.map((category) => [String(category._id), category.key]));

    const rows = subcategories.map((subcategory) => ({
      category: keyById.get(String(subcategory.category)) || '',
      key: subcategory.key,
      name: subcategory.name,
      description: subcategory.description || '',
      icon: subcategory.icon || '',
      image: subcategory.image || '',
      sortOrder: subcategory.sortOrder === undefined ? 0 : subcategory.sortOrder,
      status: subcategory.status !== false,
    }));

    return { keys, rows };
  }

  const [StoreBrand, StoreCategory, StoreSubcategory] = [
    mongoose.model('StoreBrand'),
    mongoose.model('StoreCategory'),
    mongoose.model('StoreSubcategory'),
  ];
  const [brands, categories, subcategories] = await Promise.all([
    StoreBrand.find({}).sort({ name: 1 }).lean(),
    StoreCategory.find({}).select('_id key').lean(),
    StoreSubcategory.find({}).select('_id key').lean(),
  ]);
  const categoryKeyById = new Map(categories.map((category) => [String(category._id), category.key]));
  const subcategoryKeyById = new Map(
    subcategories.map((subcategory) => [String(subcategory._id), subcategory.key])
  );

  const rows = brands.map((brand) => ({
    name: brand.name,
    aliases: (brand.aliases || []).join('|'),
    categories: uniqueTokens(
      (brand.categories || []).map((id) => categoryKeyById.get(String(id)))
    ).join('|'),
    subcategories: uniqueTokens(
      (brand.subcategories || []).map((id) => subcategoryKeyById.get(String(id)))
    ).join('|'),
    originCountry: brand.originCountry || '',
    website: brand.website || '',
    description: brand.description || '',
    logo: brand.logo || '',
    banner: brand.banner || '',
    status: brand.status || 'pending',
  }));

  return { keys, rows };
};

module.exports = {
  COLLECTIONS,
  importCollection,
  exportCollection,
  assertHeaders,
};
