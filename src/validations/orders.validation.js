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

const Joi = require('joi');
const { objectId } = require('./custom.validation');

const createOrder = {
  body: Joi.object().keys({
    user: Joi.string().custom(objectId).required(),
    payment: Joi.string().custom(objectId).required(),
    restaurant: Joi.string().custom(objectId).required().allow(null, ''),
    addons: Joi.string().allow(null, ''),
    foods: Joi.string().allow(null, ''),
    coupon: Joi.string().custom(objectId).required().allow(null, ''),
    couponType: Joi.string().allow(null, ''),
    orderTo: Joi.string().allow('homedelivery', 'selfpickup'),
    cookingInstruction: Joi.string().allow(null, ''),
    deliveryInstruction: Joi.string().custom(objectId).allow(null, ''),
    deliveryAddress: Joi.string().custom(objectId).allow(null, ''),
    deliveryAddressRaw: Joi.string().allow(null, ''),
    receiverName: Joi.string().allow(null, ''),
    countryCode: Joi.number().allow(null, ''),
    receiverContact: Joi.string().allow(null, ''),
    cartItemRaw: Joi.string().required(),
    walletUsed: Joi.boolean(),
    instantOrder: Joi.boolean(),
    scheduleOrder: Joi.boolean(),
    scheduleDate: Joi.date().allow(null, ''),
    scheduleTime: Joi.string().allow(null, ''),
    orderAt: Joi.string().required(),
    itemTotal: Joi.number().required().allow(0),
    couponDiscountCharge: Joi.number().required().allow(0),
    deliveryCharge: Joi.number().required().allow(0),
    foodServiceCharge: Joi.number().required().allow(0),
    serviceCharge: Joi.number().required().allow(0),
    packageCharge: Joi.number().required().allow(0),
    packageChargeTax: Joi.number().required().allow(0),
    deliveryTip: Joi.number().required().allow(0),
    extraCharge: Joi.number().required().allow(0),
    walletAmount: Joi.number().required().allow(0),
    grandTotal: Joi.number().required().allow(0),
    locale: Joi.string().required(),
    orderFrom: Joi.string().required().allow('app', 'web'),
  }),
};

const customerCartItemArraySchema = Joi.object({
  uuid: Joi.string(),
  quantity: Joi.number().required(),
});

const createOrderValidation = {
  body: Joi.object().keys({
    user: Joi.string().custom(objectId).required(),
    payment: Joi.string().custom(objectId).required(),
    restaurant: Joi.string().custom(objectId).required(),
    trackingId: Joi.string().custom(objectId).required(),
    coupon: Joi.string().custom(objectId).required().allow(null, ''),
    orderTo: Joi.string().valid('homedelivery', 'selfpickup').required(),
    cookingInstruction: Joi.string().allow(null, ''),
    deliveryInstruction: Joi.string().custom(objectId).allow(null, ''),
    deliveryAddress: Joi.string().custom(objectId).allow(null, ''),
    receiverName: Joi.string().required(),
    countryCode: Joi.number().required(),
    receiverContact: Joi.string().required(),
    walletUsed: Joi.boolean(),
    instantOrder: Joi.boolean(),
    scheduleOrder: Joi.boolean(),
    scheduleDate: Joi.date().allow(null, ''),
    scheduleTime: Joi.string().allow(null, ''),
    orderAt: Joi.string().required(),
    locale: Joi.string().required(),
    deliveryTip: Joi.number().required().allow(0),
    localCartItem: Joi.array().items(customerCartItemArraySchema).required(),
  }),
};

const orderListValidation = {
  body: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    uid: Joi.string().custom(objectId).required(),
  }),
};

const favuoriteOrderListValidation = {
  body: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    uid: Joi.string().custom(objectId).required(),
  }),
};

const orderIdValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const orderAcceptValidation = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    orderId: Joi.string().custom(objectId).required(),
    driver: Joi.string().custom(objectId).required(),
  }),
};

const findDriverValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    restaurant: Joi.string().custom(objectId).required(),
  }),
};

const userOrderIdValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    user: Joi.string().custom(objectId).required(),
  }),
};

const orderDriverRejectValidation = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    reason: Joi.string().custom(objectId).required(),
  }),
};

const driverValidation = {
  params: Joi.object().keys({
    driverId: Joi.string().custom(objectId).required(),
  }),
};

const vendorOrderValidation = {
  body: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    vendorId: Joi.string().custom(objectId).required(),
    status: Joi.string()
      .required()
      .allow('new', 'preparing', 'ready', 'ongoing', 'delivered', 'rejected'),
  }),
};

const prepareOrderValidation = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    time: Joi.number().required(),
    vendorId: Joi.string().custom(objectId).required(),
    driverId: Joi.string().custom(objectId).allow(null, ''),
    user: Joi.string().custom(objectId).required(),
  }),
};

const acceptScheduleOrderValidation = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    vendorId: Joi.string().custom(objectId).required(),
    user: Joi.string().custom(objectId).required(),
  }),
};

const orderReadyValidation = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    vendorId: Joi.string().custom(objectId).required(),
    user: Joi.string().custom(objectId).required(),
  }),
};

const orderHandoverToDriverValidation = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    vendorId: Joi.string().custom(objectId).required(),
    user: Joi.string().custom(objectId).required(),
  }),
};

const orderHandoverToCustomerValidation = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    vendorId: Joi.string().custom(objectId).required(),
    user: Joi.string().custom(objectId).required(),
  }),
};

const orderPickupValidation = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    vendorId: Joi.string().custom(objectId).required(),
    user: Joi.string().custom(objectId).required(),
  }),
};

const driverReachedCustomerValidation = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    user: Joi.string().custom(objectId).required(),
  }),
};

const driverDeliverOrderValidation = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    user: Joi.string().custom(objectId).required(),
    driver: Joi.string().custom(objectId).required(),
  }),
};

const adminOrderValidation = {
  query: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    status: Joi.string()
      .required()
      .allow(
        'all',
        'created',
        'accepted',
        'preparing',
        'ready',
        'handover',
        'ongoing',
        'delivered',
        'cancelled',
        'rejected',
        'refunded',
        'partially_refunded',
        'pending_payments'
      ),
    search: Joi.string().allow(null, ''),
  }),
};

const cityzenOrderValidation = {
  params: Joi.object().keys({
    master: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    status: Joi.string()
      .required()
      .allow(
        'all',
        'created',
        'accepted',
        'preparing',
        'ready',
        'handover',
        'ongoing',
        'delivered',
        'cancelled',
        'rejected',
        'refunded',
        'partially_refunded',
        'pending_payments',
        'schedule'
      ),
    search: Joi.string().allow(null, ''),
  }),
};

const adminScheduleOrderValidation = {
  query: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    search: Joi.string().allow(null, ''),
  }),
};

const cityzenUnAssignedOrderValidation = {
  params: Joi.object().keys({
    master: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    search: Joi.string().allow(null, ''),
  }),
};

const adminSubscriptionOrderValidation = {
  query: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    search: Joi.string().allow(null, ''),
  }),
};

const cityzenSubscriptionOrderValidation = {
  params: Joi.object().keys({
    master: Joi.string().custom(objectId).required(),
  }),
  query: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    search: Joi.string().allow(null, ''),
  }),
};

const orderRestaurantRejectValidation = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    reason: Joi.string().custom(objectId).required(),
    restaurant: Joi.string().custom(objectId).required(),
  }),
};

const repayPendingOrderValidation = {
  body: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
    userId: Joi.string().custom(objectId).required(),
    payMethod: Joi.string().custom(objectId).required(),
    newPayMethod: Joi.string().custom(objectId).required(),
  }),
};

const switchToCodValidation = {
  body: Joi.object().keys({
    paymentId: Joi.string().custom(objectId).required(),
  }),
};

const cancleUserOrderValidation = {
  body: Joi.object().keys({
    orderId: Joi.string().custom(objectId).required(),
    reasonId: Joi.string().custom(objectId).required(),
  }),
};

const fetchDriverPhoneNumberValidation = {
  params: Joi.object().keys({
    driver: Joi.string().custom(objectId).required(),
  }),
};

const assignDriverOrderAdminValidation = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    driver: Joi.string().custom(objectId).required(),
  }),
};

const assignDriverOrderVendorValidation = {
  body: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    driver: Joi.string().custom(objectId).required(),
  }),
};

const vendorOrderCountWebValidation = {
  params: Joi.object().keys({
    vendorId: Joi.string().custom(objectId).required(),
  }),
};

const vendorOrderWebValidation = {
  query: Joi.object().keys({
    vendorId: Joi.string().custom(objectId).required(),
    limit: Joi.number().required(),
    page: Joi.number().required(),
    orderStatus: Joi.string()
      .required()
      .allow('new', 'preparing', 'ready', 'handover', 'ongoing', 'delivered', 'rejected'),
  }),
};

const vendorOrderDetailValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    vendor: Joi.string().custom(objectId).required(),
  }),
};

const vendorCallCustomerDeliverymanValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    vendor: Joi.string().custom(objectId).required(),
  }),
};

const orderDetailAdminValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const orderComplaintRestaurantValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    vendor: Joi.string().custom(objectId).required(),
  }),
};

const vendorBusinessInsightValidation = {
  params: Joi.object().keys({
    vendor: Joi.string().custom(objectId).required(),
  }),
};

const vendorBusinessCustomDateInsightValidation = {
  body: Joi.object().keys({
    vendor: Joi.string().custom(objectId).required(),
    startDate: Joi.string().required(),
    endDate: Joi.string().required(),
  }),
};

const downloadOrderReceiptValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    user: Joi.string().custom(objectId).required(),
    locale: Joi.string().required(),
  }),
};

const downloadVendorOrderReceiptValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    vendor: Joi.string().custom(objectId).required(),
    locale: Joi.string().required(),
  }),
};

const posVariationItemSchema = Joi.object({
  variation: Joi.string(),
  selected: Joi.array().items(Joi.string()),
});

const posCartItemArraySchema = Joi.object({
  uuid: Joi.string(),
  addons: Joi.string().allow(null, ''),
  food: Joi.string().custom(objectId).required(),
  quantity: Joi.number().required(),
  variations: Joi.array().items(posVariationItemSchema),
  instruction: Joi.string().allow(null, ''),
});

const adminPOSOrderValidation = {
  body: Joi.object().keys({
    vendor: Joi.string().custom(objectId).required(),
    user: Joi.string().custom(objectId).required(),
    cartItem: Joi.array().items(posCartItemArraySchema).required(),
    orderTo: Joi.string().valid('homedelivery', 'selfpickup').required(),
    walletUsed: Joi.boolean(),
    instantOrder: Joi.boolean(),
    scheduleOrder: Joi.boolean(),
    scheduleDate: Joi.date().allow(null, ''),
    scheduleTime: Joi.string().allow(null, ''),
    orderAt: Joi.string().required(),
    address: Joi.object({
      receiverName: Joi.string().allow(null, ''),
      flatHouse: Joi.string().allow(null, ''),
      locality: Joi.string().allow(null, ''),
      countryCode: Joi.string().allow(null, ''),
      receiverContact: Joi.string().allow(null, ''),
      landmark: Joi.string().allow(null, ''),
      longitude: Joi.number().allow(null, 0),
      latitude: Joi.number().allow(null, 0),
    }),
  }),
};

const cityzenPOSOrderValidation = {
  body: Joi.object().keys({
    vendor: Joi.string().custom(objectId).required(),
    user: Joi.string().custom(objectId).required(),
    cartItem: Joi.array().items(posCartItemArraySchema).required(),
    orderTo: Joi.string().valid('homedelivery', 'selfpickup').required(),
    walletUsed: Joi.boolean(),
    instantOrder: Joi.boolean(),
    scheduleOrder: Joi.boolean(),
    scheduleDate: Joi.date().allow(null, ''),
    scheduleTime: Joi.string().allow(null, ''),
    orderAt: Joi.string().required(),
    address: Joi.object({
      receiverName: Joi.string().allow(null, ''),
      flatHouse: Joi.string().allow(null, ''),
      locality: Joi.string().allow(null, ''),
      countryCode: Joi.string().allow(null, ''),
      receiverContact: Joi.string().allow(null, ''),
      landmark: Joi.string().allow(null, ''),
      longitude: Joi.number().allow(null, 0),
      latitude: Joi.number().allow(null, 0),
    }),
  }),
};

const couponValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const adminInvoiceValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const vendorInvoiceValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
    vendor: Joi.string().custom(objectId).required(),
  }),
};

const orderDetailSupportTeamValidation = {
  params: Joi.object().keys({
    id: Joi.string().custom(objectId).required(),
  }),
};

const exportValidation = {
  query: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    status: Joi.string()
      .required()
      .allow(
        'all',
        'created',
        'accepted',
        'preparing',
        'ready',
        'handover',
        'ongoing',
        'delivered',
        'cancelled',
        'rejected',
        'refunded',
        'partially_refunded',
        'pending_payments',
        'schedule'
      ),
    search: Joi.string().allow(null, ''),
  }),
};

const exportUnassignedValidation = {
  query: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    search: Joi.string().allow(null, ''),
  }),
};

const exportOrderReportValidation = {
  query: Joi.object().keys({
    type: Joi.string().required().valid('excel', 'csv', 'raw'),
    filter: Joi.boolean(),
    search: Joi.string().allow(null, ''),
    restaurant: Joi.string().allow(null, ''),
    filterDates: Joi.string().allow(null, ''),
  }),
};

const orderReportValidation = {
  query: Joi.object().keys({
    limit: Joi.number().required(),
    page: Joi.number().required(),
    filter: Joi.boolean(),
    search: Joi.string().allow(null, ''),
    restaurant: Joi.string().custom(objectId).allow(null, ''),
    filterDates: Joi.string().allow(null, ''),
  }),
};

module.exports = {
  createOrder,
  createOrderValidation,
  orderListValidation,
  orderIdValidation,
  orderAcceptValidation,
  vendorOrderValidation,
  prepareOrderValidation,
  acceptScheduleOrderValidation,
  orderReadyValidation,
  driverValidation,
  orderDriverRejectValidation,
  orderHandoverToDriverValidation,
  orderHandoverToCustomerValidation,
  orderPickupValidation,
  driverReachedCustomerValidation,
  driverDeliverOrderValidation,
  adminOrderValidation,
  adminScheduleOrderValidation,
  orderRestaurantRejectValidation,
  repayPendingOrderValidation,
  switchToCodValidation,
  cancleUserOrderValidation,
  userOrderIdValidation,
  favuoriteOrderListValidation,
  adminSubscriptionOrderValidation,
  fetchDriverPhoneNumberValidation,
  findDriverValidation,
  assignDriverOrderAdminValidation,
  assignDriverOrderVendorValidation,
  vendorOrderCountWebValidation,
  vendorOrderWebValidation,
  vendorOrderDetailValidation,
  vendorCallCustomerDeliverymanValidation,
  orderDetailAdminValidation,
  orderComplaintRestaurantValidation,
  vendorBusinessInsightValidation,
  vendorBusinessCustomDateInsightValidation,
  downloadOrderReceiptValidation,
  downloadVendorOrderReceiptValidation,
  adminPOSOrderValidation,
  couponValidation,
  adminInvoiceValidation,
  vendorInvoiceValidation,
  orderDetailSupportTeamValidation,
  cityzenPOSOrderValidation,
  cityzenOrderValidation,
  cityzenUnAssignedOrderValidation,
  cityzenSubscriptionOrderValidation,
  exportValidation,
  exportUnassignedValidation,
  exportOrderReportValidation,
  orderReportValidation,
};

