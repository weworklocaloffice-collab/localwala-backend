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

const RealEstatePropertyDocument = require('../models/realestate.property.document.model');
const RealEstateProperty = require('../models/realestate.property.model');
const RealEstateSetting = require('../models/realestate.setting.model');
const { assertDocumentUpload } = require('../utils/realestate.document.rules');
const fcmNotificationService = require('../../../services/fcm.notification.service');

/**
 * Document service — vendor upload/list/remove, plus admin verify.
 *
 * Visibility filtering lives in `realestate.document.access.js`
 * middleware (BR-18), never here, so a mapper can never leak a
 * vendor PAN by forgetting a `.select()`.
 */

// --------------------------------------------------------------------- vendor

/**
 * Upload one document against a vendor's own property.
 *
 * The client is expected to have already uploaded the file bytes
 * through the existing `media.service` and received a URL — this
 * endpoint accepts the metadata and binds it to the property. The
 * multipart route on the gateway stack is for media; Real Estate
 * documents carry a visibility class and a category, so they are
 * modeled here rather than reused.
 *
 * `visibility` defaults to `INTERNAL` — the vendor is the one
 * exception (BR-18): the owning vendor may mark a document
 * `CUSTOMER_VISIBLE` if the customer needs to see it (e.g. a title
 * deed), but never `ADMIN_ONLY` or `BANK_VISIBLE` from a vendor
 * session.
 *
 * @param {object} args
 * @param {string} args.propertyId
 * @param {string} args.vendorId
 * @param {string} args.userId — the User behind the vendor session
 * @param {string} args.category
 * @param {string} args.title
 * @param {string} args.fileUrl
 * @param {string} [args.fileName]
 * @param {string} [args.mimeType]
 * @param {number} [args.sizeBytes]
 * @param {string} [args.checksum]
 * @param {string} [args.visibility]
 * @param {string} [args.notes]
 */
async function upload({
  propertyId,
  vendorId,
  userId,
  category,
  title,
  fileUrl,
  fileName,
  mimeType,
  sizeBytes,
  checksum,
  visibility,
  notes,
}) {
  const property = await RealEstateProperty.findOne({
    _id: propertyId,
    vendor: vendorId,
  }).select('_id vendor').lean();
  if (!property) {
    const e = new Error('Property not found for this vendor');
    e.code = 'PROPERTY_NOT_FOUND';
    throw e;
  }

  // Vendor may only set INTERNAL or CUSTOMER_VISIBLE; the other two
  // are reviewer/loan-officer classes and the vendor has no business
  // writing them. Enforced here (not in Joi) so a future validator
  // change cannot widen the surface.
  const allowedVisibility = ['INTERNAL', 'CUSTOMER_VISIBLE'];
  const finalVisibility = allowedVisibility.includes(visibility) ? visibility : 'INTERNAL';

  const settings = await RealEstateSetting.findOne()
    .select('documentMaxSizeBytes')
    .lean();
  const normalizedMimeType = assertDocumentUpload({
    category,
    mimeType,
    sizeBytes,
    maxSizeBytes: settings && settings.documentMaxSizeBytes,
  });

  const doc = await RealEstatePropertyDocument.create({
    property: propertyId,
    category,
    title,
    fileUrl,
    fileName,
    mimeType: normalizedMimeType,
    sizeBytes,
    checksum,
    visibility: finalVisibility,
    notes,
    uploadedBy: userId,
    status: 'PENDING',
  });
  return doc;
}

/**
 * List a property's documents, scoped to the owning vendor. A 404
 * is the right answer when the property belongs to someone else —
 * never a 403, so the endpoint cannot be used as an IDOR to
 * enumerate other vendors' document lists.
 */
async function listForProperty(propertyId, vendorId) {
  // Confirm ownership first; the same `findByIdForVendor` pattern
  // as the property service. The actual document query is by
  // property, which is already known to belong to this vendor.
  const property = await RealEstateProperty.findOne({
    _id: propertyId,
    vendor: vendorId,
  }).select('_id').lean();
  if (!property) return null;
  return RealEstatePropertyDocument.find({ property: propertyId })
    .sort({ createdAt: -1 })
    .lean();
}

/**
 * One document, scoped to the owning vendor. Returns null when the
 * document does not exist OR belongs to another vendor's property.
 */
async function findByIdForVendor(documentId, vendorId) {
  const doc = await RealEstatePropertyDocument.findById(documentId).lean();
  if (!doc) return null;
  // Confirm the document's property belongs to this vendor.
  const property = await RealEstateProperty.findOne({
    _id: doc.property,
    vendor: vendorId,
  }).select('_id').lean();
  if (!property) return null;
  return doc;
}

/**
 * Vendor-initiated removal of a document.
 *
 * ## Why an ACCEPTED document cannot be removed
 *
 * BR-21 says nothing with a lead, visit, hold, sale, commission or
 * settlement is ever hard-deleted. An ACCEPTED document is part of
 * the verification record of a property that may be sold, on hold,
 * or in a sale pipeline. Removing it would orphan the audit trail
 * of a deal that exists in the database.
 *
 * A REPLACED status is the right answer: upload a new document of
 * the same category, set the old one's `supersededBy`. The old row
 * stays, the index entries stay, the audit log stays.
 *
 * ## The PENDING branch
 *
 * A PENDING document (vendor uploaded, reviewer not yet acted) is
 * legitimately removeable — the vendor made a mistake, or is
 * reshuffling paperwork before review. That is a soft delete, not
 * BR-21 territory.
 */
async function removeForVendor(documentId, vendorId) {
  const doc = await RealEstatePropertyDocument.findById(documentId);
  if (!doc) return null;
  const property = await RealEstateProperty.findOne({
    _id: doc.property,
    vendor: vendorId,
  }).select('_id').lean();
  if (!property) return null;
  if (doc.status === 'ACCEPTED') {
    const e = new Error('An accepted document cannot be removed. Upload a replacement instead.');
    e.code = 'DOCUMENT_ACCEPTED';
    throw e;
  }
  await doc.deleteOne();
  return doc;
}

// --------------------------------------------------------------- admin verify

async function verify({ documentId, decision, verifiedBy }) {
  const doc = await RealEstatePropertyDocument.findById(documentId);
  if (!doc) throw new Error('Document not found');
  if (!['ACCEPTED', 'REJECTED'].includes(decision)) throw new Error('Decision must be ACCEPTED or REJECTED.');
  doc.status = decision;
  doc.verifiedAt = new Date();
  doc.verifiedBy = verifiedBy;
  await doc.save();
  // Phase 10: customer sees verification status. Never throws into verification.
  try {
    const prop = await RealEstateProperty.findById(doc.property).select('customer').lean();
    if (prop && prop.customer) {
      await fcmNotificationService.realEstateDocumentVerified({
        userId: prop.customer,
        recipientType: 'CUSTOMER',
        title: decision === 'ACCEPTED' ? 'Document verified' : 'Document rejected',
        body: `Your document "${doc.title || 'document'}" was ${decision.toLowerCase()}.`,
        data: { documentId: String(documentId), propertyId: String(doc.property) },
      });
    }
  } catch (e) {
    /* notify-only */
  }
  return doc;
}

const realEstateDocumentService = {
  upload,
  listForProperty,
  findByIdForVendor,
  removeForVendor,
  verify,
};

module.exports = realEstateDocumentService;
