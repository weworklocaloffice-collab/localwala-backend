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

// The customer resolver is exported separately from the admin service so the
// home feed can pull it in without dragging the draft/history plumbing along.
module.exports = {
  adminService: require('./services/header.banner.service'),
  resolverService: require('./services/header.banner.resolver.service'),
  HeaderBanner: require('./models/header.banner.model'),
  HeaderBannerDraft: require('./models/header.banner.draft.model'),
  HeaderBannerPublishHistory: require('./models/header.banner.publish.history.model'),
};