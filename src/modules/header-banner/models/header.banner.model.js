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

const mongoose = require('mongoose');
const { toJSON, paginate } = require('../../../models/plugins');

const BANNER_HEIGHT_MIN = 130;
const BANNER_HEIGHT_MAX = 210;
const BANNER_HEIGHT_DEFAULT = 170;
const COLLAPSED_HEIGHT_MIN = 48;
const COLLAPSED_HEIGHT_MAX = 120;
const COLLAPSED_HEIGHT_DEFAULT = 64;
const HORIZONTAL_ASPECT_RATIO = 16 / 9;
const VERTICAL_ASPECT_RATIO = 3 / 4;
// Zoom bounds for the media layer. `1` is the untouched render; the ceiling is
// well past "fill the frame" so an operator can crop hard without hitting a wall.
const MEDIA_SCALE_MIN = 1;
const MEDIA_SCALE_MAX = 3;
const MEDIA_SCALE_DEFAULT = 1;

/**
 * Header banner ("Silver App Bar" + promotional banner slot).
 *
 * Deliberately separate from the legacy `Banner` model: legacy banners are
 * city-mandatory, image-mandatory and reference a single restaurant or food,
 * none of which fit a header banner that may be global, may be Lottie, and may
 * target an arbitrary destination. Legacy import also enforces an exact column
 * count, so extending it would have broken existing templates.
 *
 * Flat field names (not nested subdocuments) because the customer contract
 * mirrors them 1:1 - see Customer_app `HeaderBannerModel`.
 */
const headerBannerSchema = mongoose.Schema(
  {
    campaignName: {
      type: String,
      required: true,
      trim: true,
    },

    // ---------------------------------------------------------------- overlay
    title: {
      type: String,
      required: false,
      trim: true,
    },
    subtitle: {
      type: String,
      required: false,
      trim: true,
    },
    translations: {
      type: Array,
      default: [],
    },
    // Separate from `translations` so the legacy `$elemMatch: { value: <regex> }`
    // title search pattern is never applied to the subtitle.
    subtitleTranslations: {
      type: Array,
      default: [],
    },

    // ------------------------------------------------------------------ media
    // image | lottie | video. Media renders in the banner slot ONLY, never in
    // the app bar.
    media: {
      type: String,
      required: false,
      enum: ['image', 'lottie', 'video'],
      default: 'image',
    },
    mediaUrl: {
      type: String,
      required: false,
      trim: true,
    },
    // Poster frame. Required for `image`, used as the fallback for the others.
    image: {
      type: String,
      required: false,
      trim: true,
    },

    // ----------------------------------------------------------------- layout
    // horizontal (16:9) | vertical (3:4)
    orientation: {
      type: String,
      required: false,
      enum: ['horizontal', 'vertical'],
      default: 'horizontal',
    },
    aspectRatio: {
      type: Number,
      required: false,
    },
    // responsive | fixed
    heightMode: {
      type: String,
      required: false,
      enum: ['responsive', 'fixed'],
      default: 'responsive',
    },
    maxHeight: {
      type: Number,
      required: false,
      default: BANNER_HEIGHT_DEFAULT,
      min: BANNER_HEIGHT_MIN,
      max: BANNER_HEIGHT_MAX,
    },

    // ------------------------------------------------------------------- cta
    ctaText: {
      type: String,
      required: false,
      trim: true,
    },
    ctaAction: {
      type: String,
      required: false,
      trim: true,
      // Enum rather than a free string: an unrecognised action used to save cleanly and
      // then no-op silently on tap, which reads to an operator as a broken banner rather
      // than a typo. `restaurant_list` is accepted alongside `open_restaurant_list`
      // because the client has always honoured both spellings.
      enum: [
        '',
        'open_restaurant_list',
        'restaurant_list',
        'open_search',
        'category',
        'restaurant',
        'food',
      ],
      default: '',
    },
    ctaTarget: {
      type: String,
      required: false,
      trim: true,
    },
    deepLink: {
      type: String,
      required: false,
      trim: true,
    },
    enableOverlayText: {
      type: Boolean,
      default: true,
    },
    // The CTA button, independent of the title/subtitle overlay. Without this the only
    // way to hide the button was to blank `ctaText`, which throws away copy the operator
    // may want back - and turning the whole overlay off also hides the title.
    showCta: {
      type: Boolean,
      default: true,
    },
    // --------------------------------------------------------------- CTA appearance
    // `ctaPreset` is a convenience that writes the fields below in one action; the fields
    // stay independently editable so a single tweak never has to be re-presetted. The
    // numeric ones are stored rather than derived from the preset so the admin preview and
    // the Flutter renderer read the same number instead of keeping two mapping tables.
    ctaPreset: {
      type: String,
      required: false,
      trim: true,
      enum: ['default', 'compact', 'pill', 'outline', 'minimal'],
      default: 'default',
    },
    ctaStyle: {
      type: String,
      required: false,
      trim: true,
      enum: ['solid', 'outline', 'ghost'],
      default: 'solid',
    },
    // Null means "use the app's primary colour", which is how the CTA looked before any
    // of this was configurable. Storing a resolved colour per banner would go stale on a
    // rebrand, so the theme is deliberately left as the default.
    ctaBackgroundColor: {
      type: String,
      required: false,
      trim: true,
    },
    ctaTextColor: {
      type: String,
      required: false,
      trim: true,
    },
    ctaCornerRadius: {
      type: Number,
      required: false,
      default: 6,
      min: 0,
      // Upper bound is deliberately far above any real radius: a pill button wants a
      // value larger than its own height, which both renderers clamp to a full round
      // automatically. Capping at a "sensible" 40 made the `pill` preset unsaveable.
      max: 999,
    },
    ctaFontSize: {
      type: Number,
      required: false,
      default: 12,
      min: 10,
      max: 24,
    },
    ctaPaddingX: {
      type: Number,
      required: false,
      default: 14,
      min: 0,
      max: 40,
    },
    ctaPaddingY: {
      type: Number,
      required: false,
      default: 9,
      min: 0,
      max: 40,
    },
    ctaFullWidth: {
      type: Boolean,
      default: false,
    },
    ctaShowArrow: {
      type: Boolean,
      default: true,
    },
    // ---------------------------------------------------------------- CTA motion
    // Defaults to `none` and non-looping on purpose: this button sits above the fold of
    // the home screen and is seen on every app open, so motion is opt-in per banner.
    //
    // The list is split by behaviour rather than by alphabet. Entrance effects (bounce,
    // fadeIn, slideUp, zoomIn, flipIn) are one-shot by design - the panel refuses to let
    // an operator loop them, because a repeating entrance reads as a glitch. The remaining
    // values are attention/festive effects that repeat cleanly, plus `pressDown`, which is
    // driven by touch rather than a timer.
    ctaAnimation: {
      type: String,
      required: false,
      trim: true,
      enum: [
        'none',
        // attention
        'pulse',
        'heartbeat',
        'wiggle',
        'shake',
        'glow',
        'shimmer',
        'arrowSlide',
        'borderRunner',
        // entrance (one-shot; loop is not offered)
        'bounce',
        'fadeIn',
        'slideUp',
        'zoomIn',
        'flipIn',
        // interaction
        'pressDown',
        // festive
        'rainbow',
        'goldenShine',
      ],
      default: 'none',
    },
    ctaAnimationDuration: {
      type: Number,
      required: false,
      default: 1200,
      min: 200,
      max: 5000,
    },
    ctaAnimationLoop: {
      type: Boolean,
      default: false,
    },
    displayDuration: {
      type: Number,
      required: false,
      default: 5,
      min: 0,
    },

    // ------------------------------------------------- silver app bar surface
    // auto | manual | gradient. In `auto` the colour is taken from the banner
    // media by the client when the server has not resolved one.
    appBarBackgroundMode: {
      type: String,
      required: false,
      enum: ['auto', 'manual', 'gradient'],
      default: 'auto',
    },
    appBarBackgroundColor: {
      type: String,
      required: false,
      trim: true,
    },
    appBarGradientFrom: {
      type: String,
      required: false,
      trim: true,
    },
    appBarGradientTo: {
      type: String,
      required: false,
      trim: true,
    },
    // Palette sampled from the banner media at publish time.
    extractedColors: {
      type: Array,
      default: [],
    },
// Pinned toolbar height of the app bar above the banner.
    collapsedHeight: {
      type: Number,
      required: false,
      default: COLLAPSED_HEIGHT_DEFAULT,
      min: COLLAPSED_HEIGHT_MIN,
      max: COLLAPSED_HEIGHT_MAX,
    },
    // Paint the same media in the app bar as well as the banner slot.
    //
    // The app bar previously only ever took a colour or a gradient, which is why the panel
    // hint said so. Off by default: the two surfaces normally read as one continuous
    // header sweep (the gradient is windowed across the seam), and putting artwork in the
    // app bar replaces that with a crop of the same asset at a very different aspect.
    // For Lottie it also means a second composition decoding alongside the banner's, which
    // is a deliberate cost of asking for the same animation in both places.
    showMediaInAppBar: {
      type: Boolean,
      default: false,
    },
    // Parallax. `parallaxIntensity` is a fraction of the header's own height that the
    // artwork is allowed to lag behind the surface by, so it scales with the banner rather
    // than being a pixel distance that would behave differently at every screen size.
    parallaxEnabled: {
      type: Boolean,
      default: false,
    },
    parallaxIntensity: {
      type: Number,
      default: 0.18,
      min: 0,
      max: 0.5,
    },
    showLocation: {
      type: Boolean,
      default: true,
    },
    showLanguageSelector: {
      type: Boolean,
      default: true,
    },
    showNotificationIcon: {
      type: Boolean,
      default: true,
    },

    // ----------------------------------------------------------------- lottie
    lottieAutoPlay: {
      type: Boolean,
      default: true,
    },
    lottieLoop: {
      type: Boolean,
      default: true,
    },
    lottieSpeed: {
      type: Number,
      required: false,
      default: 1,
      min: 0.1,
      max: 4,
    },
    lottieFit: {
      type: String,
      required: false,
      enum: ['contain', 'fill', 'cover', 'fitWidth', 'fitHeight', 'none', 'scaleDown'],
      default: 'cover',
    },
    lottieAlignment: {
      type: String,
      required: false,
      enum: [
        'topLeft',
        'topCenter',
        'topRight',
        'centerLeft',
        'center',
        'centerRight',
        'bottomLeft',
        'bottomCenter',
        'bottomRight',
      ],
      default: 'center',
    },

    // ----------------------------------------------------------------- placement
    // Manual nudge applied on top of `lottieFit` / `lottieAlignment`, set by
    // dragging the banner in the admin preview. Stored as a fraction of the banner
    // box (-0.5 .. 0.5) rather than pixels so the same value holds on every screen
    // size. Zero means "no nudge", which keeps the default rendering untouched.
    mediaOffsetX: {
      type: Number,
      required: false,
      default: 0,
      min: -0.5,
      max: 0.5,
    },
    mediaOffsetY: {
      type: Number,
      required: false,
      default: 0,
      min: -0.5,
      max: 0.5,
    },
    // Nudge for the title/subtitle block and for the CTA button, dragged separately in
    // the admin preview. Same units and bounds as the media nudge - a fraction of the
    // banner box - so one gesture means the same thing on a 360px phone and a 768px
    // tablet. Kept apart from `mediaOffset` because they move independently: cropping the
    // artwork must not drag the button with it.
    overlayOffsetX: {
      type: Number,
      required: false,
      default: 0,
      min: -0.5,
      max: 0.5,
    },
    overlayOffsetY: {
      type: Number,
      required: false,
      default: 0,
      min: -0.5,
      max: 0.5,
    },
    ctaOffsetX: {
      type: Number,
      required: false,
      default: 0,
      min: -0.5,
      max: 0.5,
    },
    ctaOffsetY: {
      type: Number,
      required: false,
      default: 0,
      min: -0.5,
      max: 0.5,
    },
    // Zoom applied to the media layer on top of the nudge. `1` is the untouched
    // render; higher values crop into the artwork. Set by dragging the zoom rail
    // in the admin preview, and unitless so it means the same thing on a phone and
    // on a tablet.
    mediaScale: {
      type: Number,
      required: false,
      default: MEDIA_SCALE_DEFAULT,
      min: MEDIA_SCALE_MIN,
      max: MEDIA_SCALE_MAX,
    },

    // -------------------------------------------------------------- scheduling
    // alwaysOn | dateRange
    scheduleType: {
      type: String,
      required: false,
      enum: ['alwaysOn', 'dateRange'],
      default: 'alwaysOn',
    },
    startDate: {
      type: Date,
      required: false,
    },
    endDate: {
      type: Date,
      required: false,
    },
    startTime: {
      type: String,
      required: false,
      trim: true,
    },
    endTime: {
      type: String,
      required: false,
      trim: true,
    },
    timezone: {
      type: String,
      required: false,
      trim: true,
    },
    repeat: {
      type: String,
      required: false,
      trim: true,
    },

    // -------------------------------------------------------------- targeting
    // Null means "global" - the fallback when no city specific banner resolves.
    city: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'City',
      required: false,
      default: null,
    },
    // Lower number wins. Single winner, so the app bar always has exactly one
    // colour to paint.
    priority: {
      type: Number,
      required: false,
      default: 999,
    },

    // `status` is the kill switch used by every legacy read path. `isActive` is
    // the admin toggle. Both must be true for the banner to reach a customer.
    status: {
      type: Boolean,
      default: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

// Customer resolution: city match then global fallback, both inside the
// schedule window, both ordered by priority.
headerBannerSchema.index({ status: 1, isActive: 1, city: 1, startDate: 1, endDate: 1, priority: 1 });
headerBannerSchema.index({ campaignName: 'text' });

headerBannerSchema.virtual('effectiveAspectRatio').get(function effectiveAspectRatio() {
  if (this.aspectRatio && this.aspectRatio > 0) return this.aspectRatio;
  return this.orientation === 'vertical' ? VERTICAL_ASPECT_RATIO : HORIZONTAL_ASPECT_RATIO;
});

headerBannerSchema.plugin(toJSON);
headerBannerSchema.plugin(paginate);

/**
 * @typedef HeaderBanner
 */
const HeaderBanner = mongoose.models.HeaderBanner || mongoose.model('HeaderBanner', headerBannerSchema);

module.exports = HeaderBanner;
module.exports.BANNER_HEIGHT_MIN = BANNER_HEIGHT_MIN;
module.exports.BANNER_HEIGHT_MAX = BANNER_HEIGHT_MAX;
module.exports.BANNER_HEIGHT_DEFAULT = BANNER_HEIGHT_DEFAULT;
module.exports.COLLAPSED_HEIGHT_MIN = COLLAPSED_HEIGHT_MIN;
module.exports.COLLAPSED_HEIGHT_MAX = COLLAPSED_HEIGHT_MAX;
module.exports.COLLAPSED_HEIGHT_DEFAULT = COLLAPSED_HEIGHT_DEFAULT;
module.exports.HORIZONTAL_ASPECT_RATIO = HORIZONTAL_ASPECT_RATIO;
module.exports.VERTICAL_ASPECT_RATIO = VERTICAL_ASPECT_RATIO;
module.exports.MEDIA_SCALE_MIN = MEDIA_SCALE_MIN;
module.exports.MEDIA_SCALE_MAX = MEDIA_SCALE_MAX;
module.exports.MEDIA_SCALE_DEFAULT = MEDIA_SCALE_DEFAULT;