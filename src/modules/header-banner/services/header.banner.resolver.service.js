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

const HeaderBanner = require('../models/header.banner.model');
const { Category, Food, Restaurant } = require('../../../models');
const { HORIZONTAL_ASPECT_RATIO, VERTICAL_ASPECT_RATIO } = require('../models/header.banner.model');

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

/**
 * Builds the `$or` clause that keeps a banner inside its schedule window.
 *
 * A banner with no dates is always in window, matching how campaigns behave
 * today. `scheduleType: alwaysOn` bypasses dates entirely even if they are set.
 */
const scheduleWindow = (now = new Date()) => ({
  $or: [
    { scheduleType: 'alwaysOn' },
    { scheduleType: { $exists: false } },
    {
      scheduleType: 'dateRange',
      $or: [
        { startDate: null, endDate: null },
        { startDate: { $lte: now }, endDate: { $gte: now } },
        { startDate: { $lte: now }, endDate: null },
        { startDate: null, endDate: { $gte: now } },
      ],
    },
  ],
});

const baseEligibility = () => ({
  status: true,
  isActive: { $ne: false },
});

/**
 * Resolves the single winning header banner for a customer.
 *
 * City specific banner wins over a global one, then the lowest `priority`
 * number wins inside that scope. Returns `null` rather than throwing when
 * nothing resolves - the client then renders its default header, which is the
 * same header it renders today.
 *
 * @param {string} [cityId] City ObjectId string.
 * @returns {Promise<object|null>} Customer facing payload, or null.
 */
const resolveActiveHeaderBanner = async (cityId) => {
  const now = new Date();
  const base = { ...baseEligibility(now), ...scheduleWindow(now) };
  const sort = { priority: 1, createdAt: -1 };

  let banner = null;

  if (cityId) {
    banner = await HeaderBanner.findOne({ ...base, city: cityId }).sort(sort);
  }

  if (!banner) {
    banner = await HeaderBanner.findOne({ ...base, city: null }).sort(sort);
  }

  if (!banner) return null;

  const ctaTargetDetail = await resolveCtaTarget(banner.ctaAction, banner.ctaTarget);

  return toCustomerPayload(banner, ctaTargetDetail);
};

/**
 * Resolves `ctaTarget` into something the client can navigate with.
 *
 * The client routes are argument based - `/restaurants_by_category` needs
 * `[name, slug, citySlug]`, not a bare id - so a raw ObjectId from the admin form
 * is not actionable. Mirrors the `$lookup` shape the legacy banners already use for
 * `restaurants` / `foods`.
 *
 * `ctaAction` decides the model to look in; anything unrecognised, or a target that
 * is not an ObjectId (i.e. a URL), resolves to null and the client falls back to its
 * URL handling. The resolvable actions are `restaurant`, `category` and `food`; the
 * rest (`open_restaurant_list`, `open_search`, empty) need no lookup.
 */
const resolveCtaTarget = async (ctaAction, ctaTarget) => {
  if (!ctaTarget || typeof ctaTarget !== 'string') return null;
  const value = ctaTarget.trim();
  if (!OBJECT_ID_PATTERN.test(value)) return null;

  const action = (ctaAction || '').trim().toLowerCase();

  try {
    if (action === 'restaurant') {
      const restaurant = await Restaurant.findById(value, 'name slug status').lean();
      if (!restaurant) return null;
      return { type: 'restaurant', id: restaurant._id, name: restaurant.name, slug: restaurant.slug };
    }

    if (action === 'category') {
      const category = await Category.findById(value, 'name slug status').lean();
      if (!category) return null;
      return { type: 'category', id: category._id, name: category.name, slug: category.slug };
    }

    // A food modal is opened with [id, name] rather than a route argument object, so the
    // name is not decoration here - it is what the client shows as the modal title.
    // `restaurant` is carried through because the customer app needs it to price the
    // item, and because an operator who picked a food should see which kitchen it is from.
    if (action === 'food') {
      const food = await Food.findById(value, 'name status restaurant')
        .lean();
      if (!food || food.status !== 'live') return null;
      return {
        type: 'food',
        id: food._id,
        name: food.name,
        restaurantId: food.restaurant,
      };
    }
  } catch (error) {
    // A malformed or stale target must not break the header feed.
    console.error('[header-banner] failed to resolve ctaTarget', error);
    return null;
  }

  return null;
};

/**
 * Projects a banner onto the customer contract.
 *
 * Deliberately explicit rather than a spread: this is the surface the Flutter
 * `HeaderBannerModel` parses, so an added field here is a client change too.
 */
const toCustomerPayload = (banner, ctaTargetDetail = null) => {
  const isVertical = banner.orientation === 'vertical';
  const aspectRatio = banner.aspectRatio && banner.aspectRatio > 0 ? banner.aspectRatio : isVertical ? VERTICAL_ASPECT_RATIO : HORIZONTAL_ASPECT_RATIO;

  return {
    id: banner._id,
    campaignName: banner.campaignName,
    title: banner.title,
    subtitle: banner.subtitle,
    translations: banner.translations || [],
    subtitleTranslations: banner.subtitleTranslations || [],

    media: banner.media || 'image',
    mediaUrl: banner.mediaUrl || null,
    image: banner.image || null,

    orientation: banner.orientation || 'horizontal',
    aspectRatio,
    heightMode: banner.heightMode || 'responsive',
    maxHeight: banner.maxHeight,

    ctaText: banner.ctaText || null,
    ctaAction: banner.ctaAction || null,
    ctaTarget: banner.ctaTarget || null,
    ctaTargetDetail,
    deepLink: banner.deepLink || null,
    enableOverlayText: banner.enableOverlayText !== false,
    showCta: banner.showCta !== false,
    ctaPreset: banner.ctaPreset || 'default',
    ctaStyle: banner.ctaStyle || 'solid',
    ctaBackgroundColor: banner.ctaBackgroundColor || null,
    ctaTextColor: banner.ctaTextColor || null,
    // `??` rather than `||` throughout: a stored 0 is meaningful here (the `minimal`
    // preset has square corners, and zero padding is legal), so only a genuinely absent
    // value should fall back. `Number(x) || 0` collapsed every pre-feature record to a
    // button with no padding at all.
    ctaCornerRadius: Number(banner.ctaCornerRadius ?? 6),
    ctaFontSize: Number(banner.ctaFontSize ?? 12),
    ctaPaddingX: Number(banner.ctaPaddingX ?? 14),
    ctaPaddingY: Number(banner.ctaPaddingY ?? 9),
    ctaFullWidth: banner.ctaFullWidth === true,
    ctaShowArrow: banner.ctaShowArrow !== false,
    ctaAnimation: banner.ctaAnimation || 'none',
    ctaAnimationDuration: Number(banner.ctaAnimationDuration ?? 1200),
    ctaAnimationLoop: banner.ctaAnimationLoop === true,
    displayDuration: banner.displayDuration || 5,

    appBarBackgroundMode: banner.appBarBackgroundMode || 'auto',
    appBarBackgroundColor: banner.appBarBackgroundColor || null,
    appBarGradientFrom: banner.appBarGradientFrom || null,
    appBarGradientTo: banner.appBarGradientTo || null,
    extractedColors: banner.extractedColors || [],
    collapsedHeight: banner.collapsedHeight || 64,
    showLocation: banner.showLocation !== false,
    showLanguageSelector: banner.showLanguageSelector !== false,
    showNotificationIcon: banner.showNotificationIcon !== false,

    lottieAutoPlay: banner.lottieAutoPlay !== false,
    lottieLoop: banner.lottieLoop !== false,
    lottieSpeed: banner.lottieSpeed || 1,
    lottieFit: banner.lottieFit || 'cover',
    lottieAlignment: banner.lottieAlignment || 'center',
    mediaOffsetX: Number(banner.mediaOffsetX) || 0,
    mediaOffsetY: Number(banner.mediaOffsetY) || 0,
    overlayOffsetX: Number(banner.overlayOffsetX) || 0,
    overlayOffsetY: Number(banner.overlayOffsetY) || 0,
    ctaOffsetX: Number(banner.ctaOffsetX) || 0,
    ctaOffsetY: Number(banner.ctaOffsetY) || 0,
    // `|| 1` matters here: a stored 0 is not a legal scale, and defaulting to it
    // would collapse the artwork to nothing on the client.
    mediaScale: Number(banner.mediaScale) || 1,

    scheduleType: banner.scheduleType || 'alwaysOn',
    startDate: banner.startDate || null,
    endDate: banner.endDate || null,

    priority: banner.priority === undefined ? 999 : banner.priority,
    city: banner.city || null,
  };
};

module.exports = {
  resolveActiveHeaderBanner,
  resolveCtaTarget,
  toCustomerPayload,
  scheduleWindow,
  baseEligibility,
};