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
 * modification, or use of this source code in a public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const RealEstateListingPackage = require('../models/realestate.listing.package.model');

/**
 * Package service — catalogue operations.
 *
 * Exported functions:
 *   - listAll()                              → all packages, active retired
 *   - findByCode(code)                       → look up by stable code
 *   - createPackage(payload)                 → admin adds a new catalogue item
 *   - setRecommended(code, isRecommended)    → highlight one package
 *   - getPackageDetails(code)                → return package + limits info
 */

 /**
 * List all packages in the catalogue.
 *
 * @param {Object} [filter] — optional { status: true } to show only active
 * @returns {Promise<Array>} package documents
 */
async function listAll(filter = {}) {
  const criteria = { ...filter };
  // Hydrated — `price` is a moneyField. See the money-edges gate:
  // lean reads ship paise.
  const docs = await RealEstateListingPackage.find(criteria).sort({ sortOrder: 1, code: 1 });
  return docs.map((d) => d.toObject({ getters: true }));
}

/**
 * Find a package by its stable machine‑readable code.
 *
 * @param {string} code — e.g. 'BASIC', 'PROFESSIONAL'
 * @returns {Promise<Object|null>} package doc or null
 */
async function findByCode(code) {
  return RealEstateListingPackage.findOne({ code: code.trim().toUpperCase() })
    .lean();
}

/**
 * Admin: create a new package entry in the catalogue.
 *
 * The package is immutable as regards `code` and `price`.  Only `name`,
 * `features`, `limits`, `sortOrder`, and `status` may be edited after
 * creation.  This preserves the historical guarantee that an ORDER's
 * `packageSnapshot` remains true to what the vendor actually paid for.
 *
 * @param {Object} payload — { code, name, description, price, listingCount,
 *   durationDays, features?, limits?, sortOrder?, status? }
 * @returns {Promise<Object>} the saved package document
 */
async function createPackage(payload) {
  const code = payload.code.trim().toUpperCase();
  const name = payload.name.trim();

  // Basic validation
  if (!code || !name) {
    throw new Error('Package code and name are required.');
  }

  // Check for duplicate code
  const existing = await RealEstateListingPackage.findOne({ code }).lean();
  if (existing) {
    throw new Error(`Package code "${code}" already exists.`);
  }

  const packageDoc = new RealEstateListingPackage({
    code,
    name,
    description: payload.description,
    price: payload.price, // stored as paise via money.field
    listingCount: payload.listingCount, // null = unlimited
    durationDays: payload.durationDays,
    features: payload.features,
    limits: payload.limits,
    sortOrder: payload.sortOrder ?? 0,
    status: payload.status !== false, // default true
    recommended: false, // only one may be recommended at a time
  });

  await packageDoc.save();
  return packageDoc;
}

const UPDATABLE_PACKAGE_FIELDS = ['name', 'description', 'features', 'limits', 'sortOrder', 'status'];

/**
 * Admin: edit a catalogue item in place.
 *
 * `code` and `price` are immutable after creation (see model doc):
 * changing what a vendor already bought would rewrite history, and
 * orders/entitlements carry their own `packageSnapshot` (BR-15). Only
 * `name`, `description`, `features`, `limits`, `sortOrder` and `status`
 * may change. Retiring (`status: false`) stops new sales; existing
 * entitlements keep running.
 */
async function updatePackage(code, patch = {}) {
  const doc = await RealEstateListingPackage.findOne({ code: String(code).trim().toUpperCase() });
  if (!doc) throw new Error(`Package "${code}" not found.`);
  for (const k of UPDATABLE_PACKAGE_FIELDS) {
    if (patch[k] !== undefined) doc[k] = patch[k];
  }
  await doc.save();
  return doc.toObject({ getters: true });
}

/**
 * Admin: set the highlighted/recommended package.
 *
 * Only one package may have `recommended: true` at any time.  This method
 * clears the previous recommendation before setting the new one, rather than
 * relying on a partial unique index (which would fail momentarily with zero
 * recommended packages — an acceptable transient state).
 *
 * @param {string} code — the package code to highlight
 */
async function setRecommended(code) {
  // Clear all current recommendations
  await RealEstateListingPackage.updateMany({}, { recommended: false });

  // Set the new one
  await RealEstateListingPackage.updateOne({ code }, { $set: { recommended: true } });
}

/**
 * Return package details including limits info for the vendor app.
 *
 * @param {string} code
 * @returns {Promise<Object|null>} package doc with limits breakdown, or null
 */
async function getPackageDetails(code) {
  const pkg = await RealEstateListingPackage.findOne({ code: code.trim().toUpperCase() });

  if (!pkg) return null;

  const out = pkg.toObject({ getters: true });
  return {
    code: out.code,
    name: out.name,
    description: out.description,
    price: out.price, // rupees (moneyField getter)
    listingCount: out.listingCount, // null = unlimited
    durationDays: out.durationDays,
    features: out.features,
    limits: out.limits,
    recommended: out.recommended,
    sortOrder: out.sortOrder,
  };
}

module.exports = {
  listAll,
  findByCode,
  createPackage,
  updatePackage,
  UPDATABLE_PACKAGE_FIELDS,
  setRecommended,
  getPackageDetails,
};