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
const ApiError = require('../../../utils/ApiError');
const { withOptionalTransaction } = require('../../../utils/optionalTransaction');
const HeaderBanner = require('../models/header.banner.model');
const HeaderBannerDraft = require('../models/header.banner.draft.model');
const HeaderBannerPublishHistory = require('../models/header.banner.publish.history.model');

/**
 * Single source of truth for writable fields.
 *
 * The legacy `banners.service.js` repeats a hand written field list in six
 * places, which is exactly how the admin's already-sent fields ended up being
 * silently dropped. One array, used by every write path, cannot drift.
 */
const WRITABLE_FIELDS = [
  'campaignName',
  'title',
  'subtitle',
  'translations',
  'subtitleTranslations',
  'media',
  'mediaUrl',
  'image',
  'orientation',
  'aspectRatio',
  'heightMode',
  'maxHeight',
  'ctaText',
  'ctaAction',
  'ctaTarget',
  'deepLink',
  'enableOverlayText',
  'showCta',
  'ctaPreset',
  'ctaStyle',
  'ctaBackgroundColor',
  'ctaTextColor',
  'ctaCornerRadius',
  'ctaFontSize',
  'ctaPaddingX',
  'ctaPaddingY',
  'ctaFullWidth',
  'ctaShowArrow',
  'ctaAnimation',
  'ctaAnimationDuration',
  'ctaAnimationLoop',
  'displayDuration',
  'appBarBackgroundMode',
  'appBarBackgroundColor',
  'appBarGradientFrom',
  'appBarGradientTo',
  'extractedColors',
'collapsedHeight',
  'showMediaInAppBar',
  'showLocation',
  'showLanguageSelector',
  'showNotificationIcon',
  'lottieAutoPlay',
  'lottieLoop',
  'lottieSpeed',
  'lottieFit',
  'lottieAlignment',
  'mediaOffsetX',
  'mediaOffsetY',
  'overlayOffsetX',
  'overlayOffsetY',
  'ctaOffsetX',
  'ctaOffsetY',
  'mediaScale',
  'scheduleType',
  'startDate',
  'endDate',
  'startTime',
  'endTime',
  'timezone',
  'repeat',
  'city',
  'priority',
  'status',
  'isActive',
];

/**
 * Coerces the urlencoded admin payload into model-safe values.
 *
 * The Angular `ApiService` posts `application/x-www-form-urlencoded`, so
 * everything arrives as a string and arrays arrive bracket flattened
 * (`extractedColors[0]=...`). Booleans and numbers are coerced here rather than
 * trusting Mongoose's per-path casting.
 */
const normalizePayload = (param) => {
  const payload = {};

  WRITABLE_FIELDS.forEach((field) => {
    if (param[field] === undefined) return;
    payload[field] = param[field];
  });

  ['enableOverlayText', 'showLocation', 'showLanguageSelector', 'showNotificationIcon', 'lottieAutoPlay', 'lottieLoop', 'status', 'isActive'].forEach((field) => {
    if (payload[field] === undefined) return;
    payload[field] = payload[field] === true || payload[field] === 'true' || payload[field] === 1 || payload[field] === '1';
  });

  ['maxHeight', 'collapsedHeight', 'displayDuration', 'priority', 'aspectRatio', 'lottieSpeed', 'mediaOffsetX', 'mediaOffsetY', 'mediaScale'].forEach((field) => {
    if (payload[field] === undefined || payload[field] === null || payload[field] === '') return;
    const parsed = Number(payload[field]);
    if (!Number.isNaN(parsed)) payload[field] = parsed;
  });

  ['startDate', 'endDate'].forEach((field) => {
    if (payload[field] === undefined) return;
    if (payload[field] === null || payload[field] === '') {
      payload[field] = null;
      return;
    }
    const parsed = new Date(payload[field]);
    payload[field] = Number.isNaN(parsed.getTime()) ? null : parsed;
  });

  // Null city means "global". Empty string is the urlencoded form of null.
  if (payload.city === undefined) return payload;
  if (payload.city === null || payload.city === '') {
    payload.city = null;
    return payload;
  }
  payload.city = String(payload.city);
  return payload;
};

const toHistorySnapshot = (banner) => {
  if (!banner) return {};
  const plain = typeof banner.toObject === 'function' ? banner.toObject() : banner;
  delete plain.__v;
  return plain;
};

const recordHistory = async ({ banner, action, userId, note }) => {
  try {
    await HeaderBannerPublishHistory.create({
      headerBanner: banner ? banner._id : null,
      campaignName: banner ? banner.campaignName : null,
      action,
      snapshot: toHistorySnapshot(banner),
      note: note || null,
      publishedBy: userId || null,
      publishedAt: new Date(),
    });
  } catch (error) {
    // History must never block the mutation the admin actually asked for.
    console.error('[header-banner] failed to record publish history', error);
  }
};

const listHeaderBanners = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const filter = {};

  if (options.search) {
    const searchRegExp = RegExp(options.search, 'i');
    filter.$or = [
      { campaignName: searchRegExp },
      { title: searchRegExp },
      { translations: { $elemMatch: { value: searchRegExp } } },
      { subtitleTranslations: { $elemMatch: { value: searchRegExp } } },
    ];
  }

  if (options.status !== undefined && options.status !== null && options.status !== '') {
    filter.status = options.status === true || options.status === 'true';
  }

  if (options.city) {
    filter.$or = [...(filter.$or || []), { city: options.city }, { city: null }];
  }

  const [results, totalResults] = await Promise.all([
    HeaderBanner.find(filter)
      .populate('city', 'name translations')
      .populate('createdBy', 'name email')
      .sort({ priority: 1, createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    HeaderBanner.countDocuments(filter),
  ]);

  return {
    results,
    page,
    limit: Number(limit),
    totalPages: Math.ceil(totalResults / limit) || 1,
    totalResults,
  };
};

const getHeaderBannerById = async (id) => {
  // `city` is populated for parity with the list endpoint. Without it the admin edit
  // form receives a bare ObjectId string, its city autocomplete renders blank, and a
  // city-targeted banner reads as global to the operator.
  const banner = await HeaderBanner.findById(id).populate('city', 'name translations');
  if (!banner) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return banner;
};

const createHeaderBanner = async (param, userId) => {
  const payload = normalizePayload(param);

  if (!payload.campaignName) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Campaign name is required');
  }

  // The banner and its audit row are written together where the deployment supports
  // transactions. A standalone mongod refuses to commit one, so the optional helper
  // falls back to sequential writes: a missing audit row is tolerable, a 500 on every
  // create is not.
  return withOptionalTransaction(async (session) => {
    const banner = new HeaderBanner({ ...payload, createdBy: userId || null });
    await banner.save(session ? { session } : undefined);
    await recordHistory({ banner, action: 'create', userId });
    return banner;
  });
};

const updateHeaderBanner = async (id, param, userId) => {
  const banner = await getHeaderBannerById(id);
  const payload = normalizePayload(param);
  Object.assign(banner, payload);
  await banner.save();
  await recordHistory({ banner, action: 'update', userId });
  return banner;
};

const toggleHeaderBannerStatus = async (id, status, userId) => {
  const banner = await getHeaderBannerById(id);
  banner.status = status;
  await banner.save();
  await recordHistory({ banner, action: status ? 'publish' : 'unpublish', userId });
  return banner;
};

const deleteHeaderBanner = async (id, userId) => {
  const banner = await getHeaderBannerById(id);
  await HeaderBannerDraft.deleteMany({ headerBanner: banner._id });
  await recordHistory({ banner, action: 'delete', userId });
  await banner.deleteOne();
  return { success: true };
};

// ------------------------------------------------------------------ drafts

/**
 * Saves an unpublished working copy.
 *
 * Upserts on `headerBanner` so re-saving a draft never creates duplicates. A
 * brand new draft has no `headerBanner` yet, so it is matched on the client
 * supplied draft id instead.
 */
const saveDraft = async (param, userId) => {
  const payload = param && param.payload ? param.payload : {};
  const headerBannerId = param && param.headerBanner ? param.headerBanner : null;

  const existing = await HeaderBannerDraft.findOne({
    $or: [{ headerBanner: headerBannerId }, { _id: param && param.draftId ? param.draftId : null }],
  });

  if (existing) {
    existing.payload = payload;
    existing.campaignName = payload.campaignName || null;
    existing.updatedBy = userId || null;
    await existing.save();
    return existing;
  }

  return HeaderBannerDraft.create({
    headerBanner: headerBannerId,
    campaignName: payload.campaignName || null,
    payload,
    createdBy: userId || null,
    updatedBy: userId || null,
  });
};

const getDraft = async (id) => {
  const draft = await HeaderBannerDraft.findById(id);
  if (!draft) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  return draft;
};

const discardDraft = async (id) => {
  await HeaderBannerDraft.findByIdAndDelete(id);
  return { success: true };
};

/**
 * Promotes a draft into a live banner.
 *
 * The draft payload is re-normalized here rather than trusted, and the draft is
 * only deleted after the banner write succeeds.
 */
const publishDraft = async (draftId, param, userId) => {
  const draft = await getDraft(draftId);
  const payload = normalizePayload({ ...(draft.payload || {}), ...(param || {}) });

  if (!payload.campaignName) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Campaign name is required');
  }

  // Same transaction policy as `createHeaderBanner`. The draft is deleted after the
  // helper returns, so a failed banner write leaves the draft intact for a retry.
  const banner = await withOptionalTransaction(async (session) => {
    let target;
    if (draft.headerBanner) {
      target = await HeaderBanner.findById(draft.headerBanner);
      if (!target) {
        draft.headerBanner = null;
      }
    }

    if (target) {
      Object.assign(target, payload);
    } else {
      target = new HeaderBanner({ ...payload, createdBy: userId || null });
    }

    // No forced flags here. A brand new banner already inherits `status: true` and
    // `isActive: true` from the schema defaults, and an existing banner keeps
    // whatever the operator had chosen unless the payload carries the field. The
    // old unconditional assignment meant that re-publishing a banner that had been
    // deliberately switched off in the admin silently switched it back on for every
    // customer.
    await target.save(session ? { session } : undefined);

    draft.headerBanner = target._id;
    await draft.save(session ? { session } : undefined);

    await recordHistory({ banner: target, action: 'publish', userId });
    return target;
  });

  await HeaderBannerDraft.findByIdAndDelete(draftId);
  return banner;
};

// ----------------------------------------------------------------- history

const listPublishHistory = async (options) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;
  const filter = {};

  if (options.headerBanner) {
    filter.headerBanner = options.headerBanner;
  }

  const [results, totalResults] = await Promise.all([
    HeaderBannerPublishHistory.find(filter)
      .populate('publishedBy', 'name email')
      .sort({ publishedAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    HeaderBannerPublishHistory.countDocuments(filter),
  ]);

  return {
    results,
    page,
    limit: Number(limit),
    totalPages: Math.ceil(totalResults / limit) || 1,
    totalResults,
  };
};

module.exports = {
  WRITABLE_FIELDS,
  normalizePayload,
  listHeaderBanners,
  getHeaderBannerById,
  createHeaderBanner,
  updateHeaderBanner,
  toggleHeaderBannerStatus,
  deleteHeaderBanner,
  saveDraft,
  getDraft,
  discardDraft,
  publishDraft,
  listPublishHistory,
};