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

const adminExpensesType = {
  COUPON: 'coupon',
  FREE_DELIVERY: 'free_delivery',
  WALLET_BONUS: 'wallet_bonus',
  LOYALTY_POINTS: 'loyalty_points',
  DINING_COUPON: 'dining_coupon',
  WALLET_CREDIT_CUSTOMER: 'wallet_credit_customer',
  WALLET_CREDIT_DELIVERYMAN: 'wallet_credit_deliveryman',
  IT_SUPPORT: 'it_support',
  SALES: 'sales_ads',
  EMPLOYEE: 'employees',
  OUTSOURCE: 'outsource_work',
  PAYMENT_GATEWAY: 'payment_gateway_charges',
  OTHERS: 'other',
};

const vendorExpensesType = {
  PRODUCT: 'product',
  COUPON: 'coupon',
  DINING_COUPON: 'dining_coupon',
  REFUND: 'order_refund',
  OTHER: 'other',
};

module.exports = {
  adminExpensesType,
  vendorExpensesType,
};

