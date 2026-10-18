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

// Reels consumes social via modules/social/index.js only. Nothing here is
// imported by social — see docs/social-reels-hybrid-monolith.md §2.
module.exports = {
  feedService: require('./services/reel.feed.service'),
  interactionService: require('./services/reel.interaction.service'),
  commentService: require('./services/reel.comment.service'),
  ReelInteraction: require('./models/reel.interaction.model'),
  ReelView: require('./models/reel.view.model'),
  ReelComment: require('./models/reel.comment.model'),
  ReelReport: require('./models/reel.report.model'),
};
