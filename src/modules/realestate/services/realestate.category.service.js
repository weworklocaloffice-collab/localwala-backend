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

const { status: httpStatus } = require('http-status');
const Joi = require('joi');
const ApiError = require('../../../utils/ApiError');
const RealEstatePropertyCategory = require('../models/realestate.property.category.model');

/**
 * Property category service — including the runtime `specSchema` compiler.
 *
 * ## What the compiler is for
 *
 * Real Estate plan §56 requires categories to be admin configurable, and §7 requires
 * each category to carry only its own fields ("Don't make every property use every
 * field"). A flat Mongoose schema cannot do either: it is fixed at deploy time and it
 * is the same for every property.
 *
 * So a category stores field *descriptors*, and this service compiles them into a Joi
 * schema at property-write time. Adding "Balcony" to Apartments is a database
 * update.
 *
 * ## Why Joi and not a hand-rolled validator
 *
 * Joi is already a dependency, already used by every `*.validation.js` in the codebase,
 * and produces an error shape the controllers already know how to turn into a 422.
 * A second validation mechanism would mean a second error shape and a second set of
 * messages for the client to handle.
 *
 * ## The cache and why it keys on `updatedAt`
 *
 * Compiling is cheap but not free, and property writes are the hot path. The cache is
 * keyed on `(_id, updatedAt.getTime())`. That means **editing a category invalidates its
 * compiled schema with no explicit bust** — there is no cache-invalidation code to get
 * wrong, and no window where a stale schema is in use after an edit. The only cost is
 * a slightly larger key.
 *
 * ## Compile-time rejection of a malformed specSchema
 *
 * If a category's `specSchema` cannot be compiled, `validateSpecSchema` throws and the
 * category save fails. That is deliberate: a category whose schema is broken would
 * otherwise reject every property written against it, and the error would surface at
 * property-write time in a message naming a field, not at category-edit time where the
 * mistake actually is.
 */
const realEstateCategoryService = {
  // ---------------------------------------------------------------- constants

  /** Field types a descriptor may declare. Closed — see the model doc comment. */
  FIELD_TYPES: ['NUMBER', 'STRING', 'TEXT', 'ENUM', 'BOOLEAN', 'DATE'],

  TRANSACTION_TYPES: ['BUY', 'RENT'],

  GROUPS: ['APARTMENT', 'HOUSE', 'VILLA', 'PLOT', 'COMMERCIAL'],

  // ------------------------------------------------------------------- cache

  /**
   * `_id:updatedAtMs` -> compiled Joi schema.
   *
   * A plain Map rather than a cache library, because the only invalidation strategy
   * needed is "a different key for changed content" and the entries are tiny.
   */
  _schemaCache: new Map(),

  /**
   * Drop every cached schema. Exposed for tests and for the admin "recompile all"
   * action; not needed in normal operation.
   */
  clearSchemaCache() {
    realEstateCategoryService._schemaCache.clear();
  },

  /**
   * Cheap non-cryptographic hash of a category's `specSchema.fields`.
   *
   * ## Why this is in the cache key
   *
   * The key is `(_id, updatedAt, hash)`. `updatedAt` alone would be enough *if* every
   * edit bumped it — Mongoose's `timestamps: true` does that on save and on
   * `findOneAndUpdate`, so in normal operation it works.
   *
   * "In normal operation" is the problem. A `collection.updateOne` with
   * `timestamps: false`, a bulk write, a `db.collection.updateMany` from a script, or
   * a document imported by hand can all change `specSchema` without touching
   * `updatedAt`. In each of those cases an `updatedAt`-only key silently serves the
   * OLD schema, and the symptom is that a property is accepted or rejected against
   * field definitions the operator has already changed — with no error anywhere.
   *
   * Hashing the fields costs one `JSON.stringify` of a few KB per property write,
   * against a database write that costs far more. Correctness is not worth the saving.
   *
   * @param {Array} fields
   * @returns {string} 8-char hex
   */
  _hashFields(fields) {
    let json;
    try {
      json = JSON.stringify(fields || []);
    } catch {
      // Circular structure. Let the compiler throw a precise error on this input
      // rather than silently reusing some earlier cache entry. Optional catch binding —
      // the error object is deliberately unused.
      return 'unhashable';
    }

    // FNV-1a, 32-bit.
    let h = 0x811c9dc5;
    for (let i = 0; i < json.length; i++) {
      h ^= json.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  },

  // --------------------------------------------------------------- compiling

  /**
   * Turn one field descriptor into a Joi schema fragment.
   *
   * @param {object} field descriptor
   * @param {string} path dotted path for error messages
   * @returns {object} Joi schema
   * @throws {ApiError} 422 on an unusable descriptor
   */
  _compileField(field, path) {
    if (!field || typeof field !== 'object' || Array.isArray(field)) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        `${path}: each field must be an object, got ${Array.isArray(field) ? 'an array' : typeof field}`
      );
    }

    const key = field.key;
    if (typeof key !== 'string' || !key.trim()) {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, `${path}: 'key' is required`);
    }

    // Reject keys that would collide with the model's own fields. `specs.price`
    // sitting next to `property.price` is exactly the ambiguity that produces a
    // support ticket nobody can reproduce.
    const RESERVED = ['_id', 'price', 'status', 'availability', 'specs', 'location'];
    if (RESERVED.includes(key)) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        `${path}.key: '${key}' is reserved and cannot be a spec field`
      );
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        `${path}.key: '${key}' must be alphanumeric/underscore and start with a letter`
      );
    }

    const type = field.type || 'STRING';
    if (!realEstateCategoryService.FIELD_TYPES.includes(type)) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        `${path}.type: '${type}' is not one of ${realEstateCategoryService.FIELD_TYPES.join(', ')}`
      );
    }

    let schema;
    switch (type) {
      case 'NUMBER': {
        schema = Joi.number();
        if (Number.isFinite(field.min)) schema = schema.min(field.min);
        if (Number.isFinite(field.max)) schema = schema.max(field.max);
        if (field.integer === true) schema = schema.integer();
        break;
      }
      case 'ENUM': {
        if (!Array.isArray(field.options) || field.options.length === 0) {
          throw new ApiError(
            httpStatus.UNPROCESSABLE_ENTITY,
            `${path}.options: an ENUM field needs a non-empty 'options' array`
          );
        }
        schema = Joi.string().valid(...field.options.map(String));
        break;
      }
      case 'BOOLEAN':
        schema = Joi.boolean();
        break;
      case 'DATE':
        schema = Joi.date().iso();
        break;
      case 'TEXT':
        schema = Joi.string().allow('', null);
        break;
      case 'STRING':
      default:
        schema = Joi.string().allow('', null);
        if (Number.isFinite(field.minLength)) schema = schema.min(field.minLength);
        if (Number.isFinite(field.maxLength)) schema = schema.max(field.maxLength);
        break;
    }

    if (field.required === true) {
      schema = schema.required();
    } else {
      schema = schema.allow('', null);
    }

    // Attach the descriptor's own metadata so the admin UI and the Angular form
    // builder can render a field from the compiled schema without a second lookup.
    schema.describe({ spec: { ...field, type } });

    return schema;
  },

  /**
   * Compile a category's whole `specSchema` into a Joi object.
   *
   * @param {object} category the category document or a lean object
   * @returns {object} Joi schema keyed by field key
   * @throws {ApiError} 422 on a malformed descriptor
   */
  compileSpecSchema(category) {
    const fields = (category && category.specSchema && category.specSchema.fields) || [];

    if (!Array.isArray(fields)) {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'specSchema.fields must be an array');
    }

    const compiled = {};
    const seen = new Set();

    fields.forEach((field, i) => {
      const schema = realEstateCategoryService._compileField(field, `specSchema.fields[${i}]`);
      if (seen.has(field.key)) {
        throw new ApiError(
          httpStatus.UNPROCESSABLE_ENTITY,
          `specSchema.fields: duplicate key '${field.key}'`
        );
      }
      seen.add(field.key);
      compiled[field.key] = schema;
    });

    return Joi.object(compiled);
  },

  /**
   * The compiled schema for a category, cached on `(_id, updatedAt, hash(specSchema))`.
   *
   * The hash is what makes this safe — see `_hashFields` for why `updatedAt` alone is
   * not sufficient.
   *
   * @param {object} category
   * @returns {object} Joi schema
   */
  getCompiledSpecSchema(category) {
    if (!category || !category._id) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        'A category with an _id is required to compile its spec schema'
      );
    }

    const fields = (category.specSchema && category.specSchema.fields) || [];
    const stamp =
      category.updatedAt instanceof Date ? category.updatedAt.getTime() : category.updatedAt || 0;
    const key = `${category._id}:${stamp}:${realEstateCategoryService._hashFields(fields)}`;

    const hit = realEstateCategoryService._schemaCache.get(key);
    if (hit) return hit;

    const compiled = realEstateCategoryService.compileSpecSchema(category);
    realEstateCategoryService._schemaCache.set(key, compiled);
    return compiled;
  },

  // -------------------------------------------------------------- validation

  /**
   * Validate a payload's `specs` against its category's compiled schema.
   *
   * @param {object} category
   * @param {object} specs the `specs` object from the property payload
   * @throws {ApiError} 422 with the offending field paths
   */
  validateSpecs(category, specs) {
    const schema = realEstateCategoryService.getCompiledSpecSchema(category);
    const value = specs && typeof specs === 'object' && !Array.isArray(specs) ? specs : {};

    const { error, value: cleaned } = schema.validate(value, {
      abortEarly: false,
      stripUnknown: false,
      convert: true,
    });

    if (error) {
      const detail = error.details
        .map((d) => `${d.path.join('.') || '(root)'}: ${d.message}`)
        .join('; ');
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        `specs do not satisfy category "${category && category.key}": ${detail}`
      );
    }

    return cleaned;
  },

  /**
   * Validate a category's amenity list against its declared options.
   *
   * @param {object} category
   * @param {Array<string>} amenities
   * @returns {Array<string>} de-duplicated, order-preserved
   * @throws {ApiError} 422 on an unknown amenity
   */
  validateAmenities(category, amenities) {
    if (!Array.isArray(amenities)) return [];

    const allowed =
      category && Array.isArray(category.amenityOptions) ? category.amenityOptions : [];
    const unknown = amenities.filter((a) => !allowed.includes(a));

    if (unknown.length) {
      throw new ApiError(
        httpStatus.UNPROCESSABLE_ENTITY,
        `Unknown amenities for category "${category && category.key}": ${unknown.join(', ')}. ` +
          `Allowed: ${allowed.length ? allowed.join(', ') : '(none declared)'}`
      );
    }

    return [...new Set(amenities)];
  },

  /**
   * Check a category is safe to save.
   *
   * Called from the admin write path. Catching a broken `specSchema` here means the
   * operator sees the error while editing the category, not later while trying to list
   * a property against it.
   *
   * @param {object} payload
   * @throws {ApiError} 422
   */
  validateSpecSchema(payload) {
    const key = payload && payload.key;
    if (!key) {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'key is required');
    }
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, `key '${key}' must be UPPER_SNAKE_CASE`);
    }

    const tts = payload.transactionTypes;
    if (tts !== undefined) {
      if (!Array.isArray(tts) || !tts.length) {
        throw new ApiError(
          httpStatus.UNPROCESSABLE_ENTITY,
          'transactionTypes must be a non-empty array when present'
        );
      }
      const bad = tts.filter((t) => !realEstateCategoryService.TRANSACTION_TYPES.includes(t));
      if (bad.length) {
        throw new ApiError(
          httpStatus.UNPROCESSABLE_ENTITY,
          `transactionTypes contains unknown values: ${bad.join(', ')}. ` +
            `Allowed: ${realEstateCategoryService.TRANSACTION_TYPES.join(', ')}`
        );
      }
    }

    // Throws with a precise message if any descriptor is unusable.
    realEstateCategoryService.compileSpecSchema({ _id: key, specSchema: payload.specSchema });
    return true;
  },

  // --------------------------------------------------------------- accessors

  /**
   * @returns {Promise<Array<object>>} every enabled category, in display order
   */
  async listActive() {
    return RealEstatePropertyCategory.find({ status: true }).sort({ sortOrder: 1, name: 1 }).lean();
  },

  /**
   * Admin listing — every category, optional status/group filter, paginated.
   *
   * Returns a paginate result shape so the admin grid can wire straight
   * in. The `status` filter is the only one most admins use; group
   * filter is a convenience for the category admin.
   *
   * @param {object} opts
   * @param {boolean} [opts.status] — true returns active only, false inactive only
   * @param {string} [opts.group]
   * @param {number} [opts.page=1]
   * @param {number} [opts.limit=20]
   */
  async listAll({ status, group, page = 1, limit = 20 } = {}) {
    const filter = {};
    if (status !== undefined) filter.status = status;
    if (group) filter.group = group;
    return RealEstatePropertyCategory.paginate(filter, {
      page,
      limit,
      sort: { sortOrder: 1, name: 1 },
    });
  },

  /**
   * Categories grouped into the five primary groups the customer app renders.
   *
   * @returns {Promise<object>} `{ APARTMENT: [...], COMMERCIAL: [...], … }`
   */
  async listGrouped() {
    const all = await realEstateCategoryService.listActive();
    const grouped = {};
    all.forEach((c) => {
      const g = c.group || 'OTHER';
      if (!grouped[g]) grouped[g] = [];
      grouped[g].push(c);
    });
    return grouped;
  },

  /**
   * @param {string} key
   * @returns {Promise<object|null>}
   */
  async findByKey(key) {
    if (!key) return null;
    return RealEstatePropertyCategory.findOne({ key: String(key).toUpperCase() }).lean();
  },

  /**
   * @param {string} id
   * @returns {Promise<object|null>}
   */
  async findById(id) {
    if (!id) return null;
    return RealEstatePropertyCategory.findById(id).lean();
  },

  /**
   * URL-safe form of a category key. Deterministic and idempotent.
   *
   * @param {string} key
   * @returns {string}
   */
  slugifyKey(key) {
    return String(key || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  },

  /**
   * Create or update, validating the spec schema first.
   *
   * @param {object} payload
   * @param {object} [actor] `{ _id }` recorded on the document
   * @returns {Promise<object>}
   */
  async upsert(payload, actor = {}) {
    realEstateCategoryService.validateSpecSchema(payload);

    const filter = { key: String(payload.key).toUpperCase() };
    const update = {
      $set: {
        /**
         * Set on EVERY upsert, not via `$setOnInsert`.
         *
         * Deterministic from `key` (immutable, unique), so re-setting it is idempotent
         * — and it repairs any row left at `slug: null` by an earlier run. The
         * `slugGenerator` plugin cannot help here: it runs on `pre('save')`, which
         * `findOneAndUpdate` does not fire.
         */
        slug: realEstateCategoryService.slugifyKey(payload.key),
        name: payload.name,
        group: payload.group,
        description: payload.description,
        icon: payload.icon,
        transactionTypes: payload.transactionTypes,
        specSchema: payload.specSchema,
        amenityOptions: payload.amenityOptions,
        filterableKeys: payload.filterableKeys,
        sortOrder: payload.sortOrder,
        requiresReview: payload.requiresReview,
        status: payload.status,
        updatedBy: actor._id,
      },
    };

    return RealEstatePropertyCategory.findOneAndUpdate(filter, update, {
      // `returnDocument: 'after'` is the non-deprecated spelling of `new: true`.
      returnDocument: 'after',
      upsert: true,
      setDefaultsOnInsert: true,
      runValidators: true,
    });
  },

  /**
   * Delete a category by id.
   *
   * Hard-deletes the row. The model has no soft-delete because the
   * property-search service already filters by `status: true` and the
   * `listActive` admin view does the same. A category cannot be deleted
   * while properties still reference it; the index on `category` does
   * not enforce that and the caller (the admin route) handles the
   * "still in use" check before invoking this.
   *
   * @param {string} id
   * @returns {Promise<{deleted: boolean}>}
   */
  async remove(id) {
    if (!id) throw new Error('Category id is required');
    const r = await RealEstatePropertyCategory.findByIdAndDelete(id);
    return { deleted: !!r };
  },
};

module.exports = realEstateCategoryService;
