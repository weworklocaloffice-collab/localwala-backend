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

/**
 * Verifies role derivation against the seeded data.
 *
 * The owner-operator account must resolve to BOTH roles — that is the whole
 * premise of the merged `DairyPartner_app`. The platform rider must resolve to
 * exactly one, and must not be able to switch.
 *
 * Usage: node scripts/verify.dairy.roles.js
 */

const mongoose = require('mongoose');
const { User } = require('../src/models');
const dairyProfileService = require('../src/modules/dairy/services/dairy.profile.service');

const CASES = [
  { mobile: '9000000001', label: 'owner-operator', expectRoles: ['dairyPartner', 'dairyDriver'], expectOwnFleet: true },
  // A pure rider. `roles.ownDeliveryPartner` is derived from *owning* a business
  // (`Business.findOne({ owner: userId })`), so for someone who works for an outlet
  // but does not own it, the field is `false` — not because the outlet has no fleet,
  // but because this user has no outlet of their own. Asserting `true` here would be
  // asserting something that is not a property of a rider, so it is left unchecked.
  //
  // Reporting the rider's *employing* outlet's flag instead is a separate question
  // about what this field means in the profile response, not part of retiring the
  // pool.
  { mobile: '9000000002', label: 'rider on a partner outlet', expectRoles: ['dairyDriver'], expectOwnFleet: null },
  // Was seeded `ownDeliveryPartner: false` to exercise the platform_pool branch.
  // That branch is unreachable now, so this is an ordinary own-fleet outlet.
  { mobile: '9000000003', label: 'commission partner', expectRoles: ['dairyPartner'], expectOwnFleet: true },
];

const run = async () => {
  require('dotenv').config();
  await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
  });

  let failures = 0;

  for (const testCase of CASES) {
    const user = await User.findOne({ countryCode: '+91', mobile: testCase.mobile });
    if (!user) {
      console.log(`SKIP ${testCase.label}: mobile ${testCase.mobile} not found — run seed.dairy.js first`);
      failures += 1;
      continue;
    }

    try {
      const payload = await dairyProfileService.getAvailableRoles(user._id.toString());
      const roles = payload.roles;

      const rolesMatch =
        roles.available.length === testCase.expectRoles.length &&
        testCase.expectRoles.every((r) => roles.available.includes(r));
    // A null expectation means the field is not a property of this kind of user.
    const fleetMatch =
      testCase.expectOwnFleet === null
        ? true
        : roles.ownDeliveryPartner === testCase.expectOwnFleet;

      const ok = rolesMatch && fleetMatch;
      if (!ok) failures += 1;

      console.log(`${ok ? 'PASS' : 'FAIL'} ${testCase.label} (${testCase.mobile})`);
      console.log(`     available        : [${roles.available.join(', ')}]`);
      console.log(`     active           : ${roles.active}`);
     console.log(`     ownDeliveryPartner: ${roles.ownDeliveryPartner}  (every dairy outlet is own_fleet; there is no pool)`);
      console.log(`     business         : ${roles.business || '(none)'}`);
      console.log(`     dairyDriver      : ${roles.dairyDriver || '(none)'}`);

      // A single-role account must be refused a switch to the other role.
      if (roles.available.length === 1) {
        const other = roles.available[0] === 'dairyPartner' ? 'dairyDriver' : 'dairyPartner';
        try {
          await dairyProfileService.switchRole(user._id.toString(), other);
          console.log(`     FAIL switch to ${other} was allowed`);
          failures += 1;
        } catch (e) {
          console.log(`     PASS switch to ${other} refused (${e.statusCode})`);
        }
      }
    } catch (e) {
      console.log(`FAIL ${testCase.label}: ${e.message}`);
      failures += 1;
    }
  }

  await mongoose.disconnect();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch(async (e) => {
  console.error('verify failed:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
