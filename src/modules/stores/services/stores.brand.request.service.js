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
const { slugify } = require('./stores.admin.taxonomy.service');

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const resolveTaxonomy = async ({ category, subcategory }) => {
  const StoreCategory = mongoose.model('StoreCategory');
  const StoreSubcategory = mongoose.model('StoreSubcategory');

  let categoryDoc = null;
  if (category) {
    categoryDoc = await StoreCategory.findById(category).lean();
    if (!categoryDoc) throw new ApiError(httpStatus.BAD_REQUEST, 'Category not found');
  }

  let subcategoryDoc = null;
  if (subcategory) {
    subcategoryDoc = await StoreSubcategory.findById(subcategory).lean();
    if (!subcategoryDoc) throw new ApiError(httpStatus.BAD_REQUEST, 'Subcategory not found');
    if (categoryDoc && String(subcategoryDoc.category) !== String(categoryDoc._id)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Subcategory does not belong to the selected category');
    }
    if (!categoryDoc) categoryDoc = await StoreCategory.findById(subcategoryDoc.category).lean();
  }

  return { category: categoryDoc?._id, subcategory: subcategoryDoc?._id };
};

/**
 * Create (or return) the pending request for a brand name.
 *
 * The unique slug is the deduplication key. Two chains asking for "Acme" must not
 * produce two Admin decisions, and a re-import of the same file must not produce a
 * second request.
 */
const requestBrand = async ({ chain, by, name, category, subcategory, note }) => {
  const StoreBrand = mongoose.model('StoreBrand');
  const StoreBrandRequest = mongoose.model('StoreBrandRequest');

  const cleanName = String(name || '').trim();
  if (!cleanName) throw new ApiError(httpStatus.BAD_REQUEST, 'Brand name is required');
  const slug = slugify(cleanName);
  if (!slug) throw new ApiError(httpStatus.BAD_REQUEST, 'Brand name must contain letters or numbers');

  const taxonomy = await resolveTaxonomy({ category, subcategory });

  const existingBrand = await StoreBrand.findOne({
    $or: [{ slug }, { name: new RegExp(`^${escapeRegex(cleanName)}$`, 'i') }],
  }).lean();
  if (existingBrand) {
    throw new ApiError(httpStatus.CONFLICT, 'Brand already exists');
  }

  const existingRequest = await StoreBrandRequest.findOne({ slug });
  if (existingRequest) {
    if (existingRequest.status === 'rejected') {
      throw new ApiError(httpStatus.CONFLICT, 'This brand request was rejected');
    }
    return { request: existingRequest, created: false };
  }

  const request = await StoreBrandRequest.create({
    name: cleanName,
    slug,
    requestedByChain: chain,
    requestedBy: by,
    category: taxonomy.category,
    subcategory: taxonomy.subcategory,
    note,
    status: 'pending',
  });

  return { request, created: true };
};

const listOwnRequests = async ({ chain, status, page = 1, limit = 20 }) => {
  const StoreBrandRequest = mongoose.model('StoreBrandRequest');
  const filter = { requestedByChain: chain };
  if (status && status !== 'all') filter.status = status;

  const [requests, total] = await Promise.all([
    StoreBrandRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('category', 'name key')
      .populate('subcategory', 'name key')
      .lean(),
    StoreBrandRequest.countDocuments(filter),
  ]);

  return { requests, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

const listRequests = async ({ status = 'pending', search, page = 1, limit = 20 }) => {
  const StoreBrandRequest = mongoose.model('StoreBrandRequest');
  const filter = {};
  if (status && status !== 'all') filter.status = status;
  if (search) filter.name = { $regex: escapeRegex(search), $options: 'i' };

  const [requests, total] = await Promise.all([
    StoreBrandRequest.find(filter)
      .sort({ createdAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('requestedByChain', 'name slug')
      .populate('requestedBy', 'name email')
      .populate('category', 'name key')
      .populate('subcategory', 'name key')
      .populate('brand', 'name slug status')
      .lean(),
    StoreBrandRequest.countDocuments(filter),
  ]);

  return { requests, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
};

/**
 * Approve creates the canonical `StoreBrand`; reject never does. The request row
 * is kept in both cases so the chain can see why a name is unavailable.
 */
const reviewRequest = async ({ requestId, status, note, by }) => {
  if (!['approved', 'rejected'].includes(status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'status must be approved or rejected');
  }

  const StoreBrand = mongoose.model('StoreBrand');
  const StoreBrandRequest = mongoose.model('StoreBrandRequest');

  const request = await StoreBrandRequest.findById(requestId);
  if (!request) throw new ApiError(httpStatus.NOT_FOUND, 'Brand request not found');
  if (request.status !== 'pending') {
    throw new ApiError(httpStatus.CONFLICT, `Brand request is already ${request.status}`);
  }

  if (status === 'rejected') {
    request.status = 'rejected';
    request.decision = { by, at: new Date(), note };
    await request.save();
    return request;
  }

  if (!request.category) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'A category is required before this brand request can be approved'
    );
  }

  let brand = await StoreBrand.findOne({ slug: request.slug });
  if (brand) {
    brand.status = 'approved';
    if (request.category && !brand.categories.some((id) => String(id) === String(request.category))) {
      brand.categories.push(request.category);
    }
    if (
      request.subcategory &&
      !brand.subcategories.some((id) => String(id) === String(request.subcategory))
    ) {
      brand.subcategories.push(request.subcategory);
    }
  } else {
    brand = new StoreBrand({
      name: request.name,
      slug: request.slug,
      categories: [request.category],
      subcategories: request.subcategory ? [request.subcategory] : [],
      status: 'approved',
      requester: {
        chain: request.requestedByChain,
        by: request.requestedBy,
        at: request.createdAt,
      },
    });
  }

  brand.approval = { by, at: new Date(), note };
  await brand.save();

  request.status = 'approved';
  request.brand = brand._id;
  request.decision = { by, at: new Date(), note };
  await request.save();

  return request;
};

module.exports = {
  requestBrand,
  listOwnRequests,
  listRequests,
  reviewRequest,
};
