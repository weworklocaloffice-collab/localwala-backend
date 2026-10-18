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

// The ONLY import surface reels (and food/property/service later) may use.
// Social never imports from reels — dependency flows one way (docs §2).
module.exports = {
  contactsService: require('./contacts/contacts.service'),
  privacyService: require('./privacy/privacy.service'),
  socialProofService: require('./social-proof/social-proof.service'),
  UserContactMatch: require('./models/user.contact.match.model'),
  SocialPrivacy: require('./models/social.privacy.model'),
};
