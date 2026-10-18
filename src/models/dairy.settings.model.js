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
const { toJSON } = require('./plugins');

/**
 * Dairy platform settings — the `dairy_settings` tab in Business Setup.
 *
 * Follows the same shape as `restaurant.settings.model` and
 * `driver.settings.model`: one singleton document, every field optional with a
 * default, guarded by a service that allows only one to exist.
 *
 * ## Why this has two fields and not twenty
 *
 * The other verticals carry a dozen knobs each. Most of them are stored and never
 * read, which is worse than not having them: an operator changes a setting, sees
 * nothing happen, and loses trust in every other setting on the screen.
 *
 * So a field here earns its place by being read. `fefoWarningDays` replaces a
 * hardcoded `WARNING_DAYS = 30` in `dairy.compliance.service`, which was business
 * policy invisible in code. `selfRegistration` matches the house standard and is
 * carried for parity with the other five verticals — the admin screen labels it as
 * not yet enforced rather than pretending otherwise.
 *
 * The obvious next candidates — a delivery cutoff, a subscription skip cutoff, a
 * default delivery slot — are deliberately absent. There is no constant for any of
 * them to replace, so they are new *policy*, and picking a number would be inventing
 * a business rule. They need product decisions first.
 *
 * `verify.dairy.settings.js` fails if a field is added here without a reader, so
 * this cannot quietly grow back into a wall of dead switches.
 */
const dairySettingsSchema = mongoose.Schema(
  {
    // //// Operational settings — enforced ////

    /**
     * How many days before a licence expires an outlet is treated as "expiring".
     *
     * Read by `dairy.compliance.service` (the derived status, the summary, and the
     * default window for the admin expiring list). Replaces the `WARNING_DAYS = 30`
     * constant that was previously invisible.
     *
     * Clamped to 1-365: zero would classify everything as expiring immediately, and
     * a value beyond a year stops being a warning.
     */
    fefoWarningDays: {
      type: Number,
      required: false,
      default: 30,
      min: 1,
      max: 365,
    },

    // //// Operational settings — enforced ////

    /**
     * How many hours before the delivery slot a skip must arrive by.
     *
     * Read by `dairy.subscription.service` (`skipDate`). With the default 9 and the
     * standard 06:00 window, that makes 21:00 the night before the cutoff: the
     * rider's manifest for tomorrow's run is frozen then, so a skip arriving later
     * would not have time to be honoured. Past cutoff the skip is rejected with a
     * customer-friendly message rather than silently applied.
     *
     * 0 disables the cutoff (skip up to the slot itself); 48 allows skipping up to
     * two slots in advance only.
     */
    subscriptionSkipCutoffHours: {
      type: Number,
      required: false,
      default: 9,
      min: 0,
      max: 48,
    },

    // //// Platform settings — stored for parity, not yet enforced ////

    /**
     * Whether new dairy outlets may register themselves.
     *
     * Present because all five other verticals carry it, and an operator comparing
     * screens will look for it. **Not yet read by the registration flow** — dairy
     * partner registration is currently always open. Labelled as such in the admin
     * screen rather than implying it does something.
     */
    selfRegistration: {
      type: Boolean,
      required: false,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { getters: true },
  }
);

dairySettingsSchema.plugin(toJSON);

/**
 * @typedef DairySettings
 */
const DairySettings = mongoose.model('DairySettings', dairySettingsSchema);

module.exports = DairySettings;