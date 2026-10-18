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
 * verify.stores.cod.js — COD is policy, not a paymentMode flag.
 *
 * Run: node scripts/verify.stores.cod.js
 */

const basketService = require('../src/modules/stores/services/stores.basket.service');

let pass = 0;
let failures = 0;
const ck = (label, condition, detail) => {
  if (condition) {
    pass += 1;
    console.log('  PASS  ' + label);
  } else {
    failures += 1;
    console.log('  FAIL  ' + label + (detail !== undefined ? ' -> ' + detail : ''));
  }
};

console.log('\n=== COD checkout gate ===\n');

ck('online payment is allowed by default', basketService.assertCodCheckoutAllowed({ paymentMode: 'gateway', deliveryConfig: {}, verticalCodEnabled: true, grandTotalPaise: 10000 }) === true);
ck('COD is rejected when the platform switch is off', assertThrows(() => basketService.assertCodCheckoutAllowed({ paymentMode: 'cod', deliveryConfig: { codEnabled: true }, verticalCodEnabled: false, grandTotalPaise: 10000 })));
ck('COD is rejected when the outlet switch is off', assertThrows(() => basketService.assertCodCheckoutAllowed({ paymentMode: 'cod', deliveryConfig: { codEnabled: false }, verticalCodEnabled: true, grandTotalPaise: 10000 })));
ck('COD below codMinOrder is rejected', assertThrows(() => basketService.assertCodCheckoutAllowed({ paymentMode: 'cod', deliveryConfig: { codEnabled: true, codMinOrder: 100 }, verticalCodEnabled: true, grandTotalPaise: 5000 })));
ck('COD above codMaxOrder is rejected', assertThrows(() => basketService.assertCodCheckoutAllowed({ paymentMode: 'cod', deliveryConfig: { codEnabled: true, codMaxOrder: 100 }, verticalCodEnabled: true, grandTotalPaise: 15000 })));
ck('COD at the configured minimum passes', basketService.assertCodCheckoutAllowed({ paymentMode: 'cod', deliveryConfig: { codEnabled: true, codMinOrder: 50 }, verticalCodEnabled: true, grandTotalPaise: 5000 }) === true);
ck('COD at the configured maximum passes', basketService.assertCodCheckoutAllowed({ paymentMode: 'cod', deliveryConfig: { codEnabled: true, codMaxOrder: 100 }, verticalCodEnabled: true, grandTotalPaise: 10000 }) === true);
ck('online payment is rejected when the outlet is COD-only', assertThrows(() => basketService.assertCodCheckoutAllowed({ paymentMode: 'gateway', deliveryConfig: { onlinePaymentEnabled: false }, verticalCodEnabled: true, grandTotalPaise: 10000 })));

console.log('\n' + pass + '/' + (pass + failures) + ' checks passed');
if (failures === 0) {
  console.log('ALL STORES COD CHECKS PASSED');
} else {
  console.log(failures + ' COD CHECK(S) FAILED');
}
process.exit(failures === 0 ? 0 : 1);

function assertThrows(fn) {
  try {
    fn();
    return false;
  } catch (e) {
    return true;
  }
}
