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

const { status: httpStatus } = require('http-status');
const multer = require('multer');
const ExcelJS = require('exceljs');
const Papa = require('papaparse');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { DateTime } = require('luxon');
const crypto = require('crypto');
const { Buffer } = require('buffer');
const Stripe = require('stripe');
const superagent = require('superagent');
const catchAsync = require('../utils/catchAsync');
const pick = require('../utils/pick');
const { paymentInitiationService, paymentConfigService } = require('../services');
// F-4: every gateway now dispatches the paid callback through one entry
// point. The vertical-specific bridges (stores, real-estate) and the six
// legacy handlers all live in `utils/payment.dispatch.js`. The gateway
// file stays vertical-agnostic and adds new paymentFrom values by
// adding a row to one of those — never by editing this file.
const { dispatchPaidCallback, dispatchFailedCallback } = require('../utils/payment.dispatch');
const { PaymentInitiation } = require('../models');
const checkArrayNotEmpty = require('../utils/arrayNotEmpty');
const uploadMiddleware = require('../middlewares/upload');
const config = require('../config/config');
const { paymentTransactionSchemaKeys } = require('../utils/importCollectionSchema');

const create = catchAsync(async (req, res) => {
  const result = await paymentInitiationService.initiatePayment(req.body);
  res.send(result);
});

const makePayment = catchAsync(async (req, res) => {
  const currentURL = new URL(`${req.protocol}://${req.get('host')}`);
  const successCallBackURL = `${currentURL}v1/public/payments/paid_success/${req.params.id}`;
  const failedCallBackURL = `${currentURL}v1/public/payments/paid_failed/${req.params.id}`;
  const paymentInfo = await paymentInitiationService.paymentInfo(req.params.id);
  if (paymentInfo !== null && paymentInfo.success === true) {
    const payData =
      paymentInfo.payments !== null && paymentInfo.payments.payments !== null
        ? paymentInfo.payments.payments
        : null;
    const currencyCode =
      paymentInfo.settings !== null &&
      paymentInfo.settings.currency !== null &&
      paymentInfo.settings.currency.cc !== null
        ? paymentInfo.settings.currency.cc
        : 'USD';
    const amountToPay =
      paymentInfo !== null && paymentInfo.payments !== null && paymentInfo.payments.amount !== null
        ? paymentInfo.payments.amount
        : 0;
    const appFullName =
      paymentInfo !== null &&
      paymentInfo.settings !== null &&
      paymentInfo.settings.companyName !== null
        ? paymentInfo.settings.companyName
        : 'FoodBite';
    let userEmail = 'noreply@noreply.com';
    if (
      paymentInfo &&
      paymentInfo.payments &&
      paymentInfo.payments.users &&
      paymentInfo.payments.users.email
    ) {
      userEmail = `${paymentInfo.payments.users.email}`;
    }
    let userFirstName = 'Unknown';
    if (
      paymentInfo &&
      paymentInfo.payments &&
      paymentInfo.payments.users &&
      paymentInfo.payments.users.firstName
    ) {
      userFirstName = `${paymentInfo.payments.users.firstName}`;
    }
    let userLastName = 'User';
    if (
      paymentInfo &&
      paymentInfo.payments &&
      paymentInfo.payments.users &&
      paymentInfo.payments.users.lastName
    ) {
      userLastName = `${paymentInfo.payments.users.lastName}`;
    }
    let userContryCode = '91';
    if (
      paymentInfo &&
      paymentInfo.payments &&
      paymentInfo.payments.users &&
      paymentInfo.payments.users.countryCode
    ) {
      userContryCode = `${paymentInfo.payments.users.countryCode}`;
    }
    let userPhoneNumber = '0000000000';
    if (
      paymentInfo &&
      paymentInfo.payments &&
      paymentInfo.payments.users &&
      paymentInfo.payments.users.mobile
    ) {
      userPhoneNumber = `${paymentInfo.payments.users.mobile}`;
    }
    if (payData !== null && payData.slug === 'stripe') {
      if (payData !== null && payData.credentials !== null && payData.credentials.secret !== null) {
        const stripePay = new Stripe(payData.credentials.secret);
        const toPay = parseFloat(amountToPay) * 100;
        const priceData = await stripePay.prices.create({
          currency: currencyCode,
          unit_amount: Math.round(toPay),

          product_data: {
            name: paymentInfo.payments.paymentRef,
          },
        });
        if (priceData !== null && priceData.id !== null) {
          const session = await stripePay.checkout.sessions.create({
            line_items: [
              {
                price: priceData.id,
                quantity: 1,
              },
            ],
            mode: 'payment',
            customer_email: userEmail,
            billing_address_collection: 'required',
            metadata: {
              customer_name: `${userFirstName} ${userLastName}`,
              customer_address: `${userFirstName} ${userLastName}`,
            },
            success_url: successCallBackURL,
            cancel_url: failedCallBackURL,
          });
          await paymentInitiationService.updatePaymentsInfo(req.params.id, {
            payResponse: session,
          });
          res.redirect(httpStatus.SEE_OTHER, session.url);
        } else {
          res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
        }
      } else {
        res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
      }
    } else if (payData !== null && payData.slug === 'razorpay') {
      if (payData !== null && payData.credentials !== null && payData.credentials.key !== null) {
        const brandLogo =
          paymentInfo.settings && paymentInfo.settings.logo && /^https?:\/\//.test(`${paymentInfo.settings.logo}`)
            ? `${paymentInfo.settings.logo}`
            : '';
        const contact10 = `${userPhoneNumber}`.replace(/\D/g, '').slice(-10);
        const respondWithOrder = (rzpId, rzpAmount, rzpCurrency) =>
          res.status(httpStatus.OK).json({
            success: true,
            order_id: rzpId,
            key: payData.credentials.key,
            amount: rzpAmount,
            currency: rzpCurrency,
            name: appFullName,
            // Help/Track: local order _id for support chat (type 'orders')
            // + history_detail. Empty for non-order subjects (wallet/dining).
            localOrderId: (paymentInfo.payments && paymentInfo.payments.orders) ? `${paymentInfo.payments.orders}` : '',
            paymentFrom: (paymentInfo.payments && paymentInfo.payments.paymentFrom) || '',
            // CustomUI branding: Razorpay activity shows `image` instead of
            // its default logo. Empty = no override (relative stored paths
            // are NOT absolute URLs, Razorpay would reject them).
            image: brandLogo,
            // CustomUI needs these — app SharedPrefs is often blank (guest/social login).
            contact: contact10,
            email: userEmail,
            contact_full: `${userContryCode}${userPhoneNumber}`,
          });
        // P0 idempotency: verify screens + retries re-hit this endpoint.
        // Creating a new gateway order per hit minted orphans (billed attempts
        // pile up, reconcile/webhook mapping ambiguous). Reuse the stored one.
        try {
          const existingOrderId =
            paymentInfo.payments && paymentInfo.payments.payResponse && paymentInfo.payments.payResponse.razorpay_order_id;
          if (existingOrderId) {
            const existing = await superagent
              .get(`https://api.razorpay.com/v1/orders/${existingOrderId}`)
              .auth(payData.credentials.key, payData.credentials.secret);
            if (existing && existing.body && existing.body.id) {
              return respondWithOrder(existing.body.id, existing.body.amount, existing.body.currency);
            }
          }
        } catch (reuseErr) {
          void reuseErr;
          // Fall through to create — stored order missing/expired at gateway.
        }
        try {
          const orderData = {
            amount: Math.round(parseFloat(amountToPay) * 100),
            currency: 'INR',
            receipt: req.params.id,
            payment_capture: 1,
          };
          const razorpayOrder = await superagent
            .post('https://api.razorpay.com/v1/orders')
            .auth(payData.credentials.key, payData.credentials.secret)
            .send(orderData);
          if (
            razorpayOrder !== null &&
            razorpayOrder.body !== null &&
            razorpayOrder.body.id !== null
          ) {
            // Enterprise: persist razorpay order_id so webhook + reconcile sweep
            // can map gateway callbacks back to this initiation (receipt = initiation id).
            try {
              await paymentInitiationService.updatePaymentsInfo(req.params.id, {
                payResponse: {
                  razorpay_order_id: razorpayOrder.body.id,
                  razorpay_receipt: razorpayOrder.body.receipt || req.params.id,
                  razorpay_status: razorpayOrder.body.status || 'created',
                },
              });
            } catch (persistErr) {
              // Non-blocking — order already created at gateway.
              void persistErr;
            }
            return respondWithOrder(razorpayOrder.body.id, razorpayOrder.body.amount, razorpayOrder.body.currency);
          }
          return res.status(httpStatus.BAD_REQUEST).json({ success: false, message: 'Failed to create order' });
          // eslint-disable-next-line no-unused-vars
        } catch (error) {
          res.status(httpStatus.BAD_REQUEST).json({ success: false, message: 'Order creation failed' });
        }
      } else {
        res.status(httpStatus.BAD_REQUEST).json({ success: false, message: 'Missing Razorpay credentials' });
      }
    } else if (payData !== null && payData.slug === 'paytm') {
      // TODO PAYTM
      res.send(paymentInfo);
    } else if (payData !== null && payData.slug === 'paystack') {
      if (payData !== null && payData.credentials !== null && payData.credentials.sk !== null) {
        try {
          const toPay = parseFloat(amountToPay) * 100;
          const paystackParam = {
            amount: Math.round(toPay),
            email: userEmail,
            callback_url: successCallBackURL,
          };
          const paystackResponse = await superagent
            .post('https://api.paystack.co/transaction/initialize')
            .set('Authorization', `Bearer ${payData.credentials.sk}`)
            .send(paystackParam);
          if (
            paystackResponse !== null &&
            paystackResponse.body !== null &&
            paystackResponse.body.data !== null &&
            paystackResponse.body.data.authorization_url !== null &&
            paystackResponse.body.data.authorization_url !== ''
          ) {
            res.redirect(httpStatus.SEE_OTHER, paystackResponse.body.data.authorization_url);
          } else {
            res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
          }
          // eslint-disable-next-line no-unused-vars
        } catch (error) {
          res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
        }
      } else {
        res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
      }
    } else if (payData !== null && payData.slug === 'paypal') {
      if (
        payData !== null &&
        payData.credentials &&
        payData.credentials !== null &&
        payData.credentials.secret !== null
      ) {
        const paypalDetail = await superagent
          .post(
            payData.environment === false
              ? `https://api-m.sandbox.paypal.com/v1/oauth2/token`
              : `https://api-m.paypal.com/v1/oauth2/token`
          )
          .auth(payData.credentials.id, payData.credentials.secret)
          .set('Content-Type', 'application/x-www-form-urlencoded')
          .send({ grant_type: 'client_credentials' });
        if (
          paypalDetail &&
          paypalDetail !== null &&
          paypalDetail.status === 200 &&
          paypalDetail.text !== ''
        ) {
          const payPaylAuth = JSON.parse(paypalDetail.text);
          if (payPaylAuth !== null && payPaylAuth.access_token && payPaylAuth.access_token !== '') {
            const paypalLinkResponse = await superagent
              .post(
                payData.environment === false
                  ? 'https://api-m.sandbox.paypal.com/v2/checkout/orders'
                  : 'https://api-m.paypal.com/v2/checkout/orders'
              )
              .set('Content-Type', 'application/json')
              .set('Authorization', `Bearer ${payPaylAuth.access_token}`)
              .send({
                intent: 'CAPTURE',
                purchase_units: [
                  {
                    amount: {
                      currency_code: 'USD',
                      value: amountToPay,
                    },
                  },
                ],
                application_context: {
                  return_url: successCallBackURL,
                  cancel_url: failedCallBackURL,
                },
              });
            if (
              paypalLinkResponse &&
              paypalLinkResponse !== null &&
              paypalLinkResponse.status === 201 &&
              paypalLinkResponse.body !== null
            ) {
              const approveLink = paypalLinkResponse.body.links.find(
                (link) => link.rel === 'approve'
              ).href;
              if (approveLink !== null && approveLink !== '') {
                res.redirect(httpStatus.SEE_OTHER, approveLink);
              } else {
                res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
              }
            } else {
              res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
            }
          } else {
            res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
          }
        } else {
          res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
        }
      } else {
        res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
      }
    } else if (payData !== null && payData.slug === 'instamojo') {
      if (payData !== null && payData.credentials !== null && payData.credentials.key !== null) {
        try {
          const paymentParam = {
            allow_repeated_payments: 'False',
            amount: amountToPay,
            buyer_name: `${userFirstName} ${userLastName}`,
            purpose: appFullName,
            redirect_url: successCallBackURL,
            phone: `+${userContryCode}${userPhoneNumber}`,
            send_email: 'True',
            webhook: successCallBackURL,
            send_sms: 'True',
            email: userEmail,
          };
          const instamojoPaymentLink =
            payData.environment === false
              ? 'https://test.instamojo.com/api/1.1/payment-requests/'
              : 'https://www.instamojo.com/api/1.1/payment-requests/';
          const instamojoLink = await superagent
            .post(instamojoPaymentLink)
            .set('X-Api-Key', payData.credentials.key)
            .set('X-Auth-Token', payData.credentials.token)
            .send(paymentParam);
          if (
            instamojoLink !== null &&
            instamojoLink.body !== null &&
            instamojoLink.body.payment_request !== null &&
            instamojoLink.body.payment_request.longurl !== null &&
            instamojoLink.body.payment_request.longurl !== ''
          ) {
            res.redirect(httpStatus.SEE_OTHER, instamojoLink.body.payment_request.longurl);
          } else {
            res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
          }
          // eslint-disable-next-line no-unused-vars
        } catch (error) {
          res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
        }
      } else {
        res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
      }
    } else if (payData !== null && payData.slug === 'flutterwave') {
      if (payData !== null && payData.credentials !== null && payData.credentials.secret !== null) {
        const flutterwavePayment = await superagent
          .post('https://api.flutterwave.com/v3/payments')
          .set('Authorization', `Bearer ${payData.credentials.secret}`)
          .set('Content-Type', 'application/json')
          .send({
            tx_ref: req.params.id,
            amount: amountToPay,
            currency: 'NGN',
            redirect_url: successCallBackURL,
            customer: {
              email: userEmail,
              name: `${userFirstName} ${userLastName}`,
              phone_number: `+${userContryCode}${userPhoneNumber}`,
            },
            customizations: {
              title: `${appFullName} Orders`,
              description: `Payment for ${appFullName} Orders`,
            },
          });
        if (
          flutterwavePayment &&
          flutterwavePayment !== null &&
          flutterwavePayment.status === 200 &&
          flutterwavePayment.body !== null
        ) {
          const payLink = flutterwavePayment.body.data.link;
          if (payLink !== null && payLink !== '') {
            res.redirect(httpStatus.SEE_OTHER, payLink);
          } else {
            res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
          }
        } else {
          res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
        }
      } else {
        res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
      }
    } else if (payData !== null && payData.slug === 'cashfree') {
      if (payData !== null && payData.credentials !== null && payData.credentials.appId !== null) {
        try {
          const param = {
            customer_details: {
              customer_email: userEmail,
              customer_name: `${userFirstName} ${userLastName}`,
              customer_phone: `+${userContryCode}${userPhoneNumber}`,
            },
            link_amount: amountToPay,
            link_auto_reminders: true,
            link_currency: currencyCode,
            link_expiry_time: DateTime.now()
              .plus({ minutes: 20 })
              .toFormat("yyyy-MM-dd'T'HH:mm:ssZZ"),
            link_id: req.params.id,
            link_meta: {
              notify_url: successCallBackURL,
              return_url: successCallBackURL,
              upi_intent: false,
            },
            link_notify: {
              send_email: true,
              send_sms: false,
            },
            link_partial_payments: false,
            link_purpose: `Payment for ${appFullName} Order`,
          };
          const link =
            payData.environment === true
              ? 'https://api.cashfree.com/pg/links'
              : 'https://sandbox.cashfree.com/pg/links';
          const cashFreeLinks = await superagent
            .post(link)
            .set('Content-Type', 'application/json')
            .set('x-api-version', payData.credentials.apiVersion)
            .set('x-client-id', payData.credentials.appId)
            .set('x-client-secret', payData.credentials.secretKey)
            .send(param);
          if (
            cashFreeLinks !== null &&
            cashFreeLinks.body !== null &&
            cashFreeLinks.body.link_url !== null &&
            cashFreeLinks.body.link_url !== ''
          ) {
            res.redirect(httpStatus.SEE_OTHER, cashFreeLinks.body.link_url);
          } else {
            res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
          }
          // eslint-disable-next-line no-unused-vars
        } catch (error) {
          res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
        }
      } else {
        res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
      }
    } else if (payData !== null && payData.slug === 'xendit') {
      if (
        payData !== null &&
        payData.credentials !== null &&
        payData.credentials.secretKey !== null
      ) {
        try {
          const payParam = {
            currency: 'IDR', // TEST CODE //
            // currency: currencyCode, /// LIVE CODE ///
            amount: Math.floor(amountToPay),
            payment_method: {
              type: 'EWALLET',
              reusability: 'ONE_TIME_USE',
              ewallet: {
                channel_code: 'SHOPEEPAY',
                channel_properties: {
                  success_return_url: successCallBackURL,
                },
              },
            },
          };
          const response = await superagent
            .post('https://api.xendit.co/payment_requests')
            .auth(payData.credentials.secretKey, '')
            .send(payParam);
          await paymentInitiationService.updatePaymentsInfo(req.params.id, {
            payResponse: response.body,
          });
          res.redirect(httpStatus.SEE_OTHER, response.body.actions[0].url);
          // eslint-disable-next-line no-unused-vars
        } catch (error) {
          res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
        }
      } else {
        res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
      }
    } else {
      res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
    }
  } else {
    res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
  }
});

const successPayment = catchAsync(async (req, res) => {
  const currentURL = new URL(`${req.protocol}://${req.get('host')}`);
  let redirectURL = `${currentURL}v1/public/payments/payment_processed`;
  const failedCallBackURL = `${currentURL}v1/public/payments/paid_failed/${req.params.id}`;
  const repeatedURL = `${currentURL}v1/public/payments/payment_repeated`;
  const payId = `${req.params.id}`;
  const paymentInfo = await paymentInitiationService.paymentInfo(req.params.id);
  if (paymentInfo !== null && paymentInfo.success === true) {
    if (
      paymentInfo &&
      paymentInfo.payments &&
      paymentInfo.payments.from &&
      paymentInfo.payments.from === 'web'
    ) {
      redirectURL = paymentInfo.payments.redirect;
    }
    if (
      paymentInfo != null &&
      paymentInfo.payments !== null &&
      paymentInfo.payments.status !== null &&
      paymentInfo.payments.status !== 'paid'
    ) {
      const payData =
        paymentInfo.payments !== null && paymentInfo.payments.payments !== null
          ? paymentInfo.payments.payments
          : null;
      if (payData !== null && payData.slug === 'stripe') {
        if (
          payData !== null &&
          payData.credentials !== null &&
          payData.credentials.secret !== null
        ) {
          if (
            paymentInfo !== null &&
            paymentInfo.payments !== null &&
            paymentInfo.payments.payResponse !== null &&
            paymentInfo.payments.payResponse.id !== null
          ) {
            const stripePay = new Stripe(payData.credentials.secret);
            const verifyPayment = await stripePay.checkout.sessions.retrieve(
              paymentInfo.payments.payResponse.id
            );
            if (
              verifyPayment !== null &&
              verifyPayment.id !== null &&
              verifyPayment.payment_status === 'paid'
            ) {
              await paymentInitiationService.updatePaymentsInfo(req.params.id, {
                status: 'paid',
                payResponse: verifyPayment,
              });
              // Local Stores subjects are handled (and the redirect left to run) before the food-vertical chain.
              await dispatchPaidCallback(paymentInfo.payments);
              res.redirect(httpStatus.SEE_OTHER, redirectURL);
            } else {
              res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
            }
          } else {
            res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
          }
        } else {
          res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
        }
      } else if (payData !== null && payData.slug === 'razorpay') {
        if (payData !== null && payData.credentials !== null && payData.credentials.key !== null) {
          if (req.method === 'POST') {
            const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
            // NOTE: failure push fires on every rejection. The app suppresses
            // it while a payment screen is open (modal already covers that);
            // killed/background cases get "failed — tap to repay" with nav.
            const pushFailed = (reason) => {
              try {
                const p = (paymentInfo && paymentInfo.payments) || {};
                const oid = p.orders || null;
                const uid = (p.users && (p.users.id || p.users._id)) || p.user || null;
                console.error(`[paid_success ${req.params.id}] pushFailed reason=${reason} oid=${oid} uid=${uid}`);
                if (!oid) return;
                const { fcmNotificationService } = require('../services');
                fcmNotificationService.userPaymentFailed(oid, uid, reason).catch(() => {});
              } catch (pushErr) {
                void pushErr;
              }
            };
            if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
              console.error(`[paid_success ${req.params.id}] missing fields body=${JSON.stringify(req.body)}`);
              res.locals.errorMessage = 'Missing payment verification fields';
              pushFailed('verify');
              return res.status(httpStatus.BAD_REQUEST).json({ success: false, message: 'Missing payment verification fields' });
            }
            const generatedSignature = crypto
              .createHmac('sha256', payData.credentials.secret)
              .update(`${razorpay_order_id}|${razorpay_payment_id}`)
              .digest('hex');
            if (razorpay_signature !== generatedSignature) {
              console.error(`[paid_success ${req.params.id}] invalid-sig got=${razorpay_signature} expect=${generatedSignature} oid=${razorpay_order_id} pid=${razorpay_payment_id}`);
              res.locals.errorMessage = 'Invalid signature';
              pushFailed('verify');
              return res.status(httpStatus.BAD_REQUEST).json({ success: false, message: 'Invalid signature' });
            }
            try {
              const verifyLink = `https://api.razorpay.com/v1/payments/${razorpay_payment_id}`;
              const verifyResponse = await superagent
                .get(verifyLink)
                .auth(payData.credentials.key, payData.credentials.secret);
              if (!verifyResponse.body || verifyResponse.body.status !== 'captured') {
                console.error(`[paid_success ${req.params.id}] not-captured status=${verifyResponse.body && verifyResponse.body.status} pid=${razorpay_payment_id} oid=${razorpay_order_id}`);
                res.locals.errorMessage = 'Payment not captured';
                pushFailed('not_captured');
                return res.status(httpStatus.BAD_REQUEST).json({ success: false, message: 'Payment not captured' });
              }
              if (verifyResponse.body.order_id !== razorpay_order_id) {
                console.error(`[paid_success ${req.params.id}] order-mismatch gateway=${verifyResponse.body.order_id} app=${razorpay_order_id} pid=${razorpay_payment_id}`);
                res.locals.errorMessage = 'Order mismatch';
                pushFailed('verify');
                return res.status(httpStatus.BAD_REQUEST).json({ success: false, message: 'Order mismatch' });
              }
              await paymentInitiationService.updatePaymentsInfo(req.params.id, {
                status: 'paid',
                payResponse: verifyResponse.body,
              });
              // Local Stores subjects are handled (and the redirect left to run) before the food-vertical chain.
              await dispatchPaidCallback(paymentInfo.payments);
              // Echo live references for the app success screen (no mocks).
              // method = gateway truth (upi/card/netbanking/wallet/emi); app
              // falls back to its locally-chosen label when absent.
              // orderId = local Mongo order _id for Track Order -> history_detail.
              let echoOrderNo = '';
              let echoOrderId = '';
              try {
                const linkedOrder = paymentInfo.payments && paymentInfo.payments.orders;
                const from = paymentInfo.payments && paymentInfo.payments.paymentFrom;
                if (from === 'order' && linkedOrder && ordersService && ordersService.getOrderById) {
                  const liveOrder = await ordersService.getOrderById(linkedOrder);
                  if (liveOrder && liveOrder.orderNo !== undefined && liveOrder.orderNo !== null) {
                    echoOrderNo = `${liveOrder.orderNo}`;
                  }
                  echoOrderId = `${linkedOrder}`;
                }
              } catch (echoErr) {
                void echoErr;
              }
              return res.status(httpStatus.OK).json({
                success: true,
                message: 'Payment verified',
                orderNo: echoOrderNo,
                orderId: echoOrderId,
                method: (verifyResponse.body && verifyResponse.body.method) || '',
              });
            } catch (error) {
              console.error(`[paid_success ${req.params.id}] verification-failed pid=${razorpay_payment_id} oid=${razorpay_order_id} err=${error && error.message} status=${error && error.status}`);
              res.locals.errorMessage = 'Verification failed';
              pushFailed('verify');
              return res.status(httpStatus.BAD_REQUEST).json({ success: false, message: 'Verification failed' });
            }
          } else {
            const queryItems = pick(req.query, ['razorpay_payment_id']);
            if (
              queryItems !== null &&
              queryItems !== '' &&
              queryItems.razorpay_payment_id !== null &&
              queryItems.razorpay_payment_id !== ''
            ) {
              try {
                const captureLink = `https://api.razorpay.com/v1/payments/${queryItems.razorpay_payment_id}`;
                const razorPayData = await superagent
                  .get(captureLink)
                  .auth(payData.credentials.key, payData.credentials.secret);
                if (
                  razorPayData !== null &&
                  razorPayData.body !== null &&
                  razorPayData.body.status !== null &&
                  razorPayData.body.status === 'captured'
                ) {
                  await paymentInitiationService.updatePaymentsInfo(req.params.id, {
                    status: 'paid',
                    payResponse: razorPayData.body,
                  });
                  // Local Stores subjects are handled (and the redirect left to run) before the food-vertical chain.
                  await dispatchPaidCallback(paymentInfo.payments);
                  res.redirect(httpStatus.SEE_OTHER, redirectURL);
                } else {
                  res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
                }
              } catch (error) {
                res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
              }
            } else {
              res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
            }
          }
        } else {
          res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
        }
      } else if (payData !== null && payData.slug === 'paytm') {
        // TODO
        res.send(paymentInfo);
      } else if (payData !== null && payData.slug === 'paystack') {
        // res.send(paymentInfo);
        if (payData !== null && payData.credentials !== null && payData.credentials.sk !== null) {
          const queryItems = pick(req.query, ['trxref', 'reference']);
          if (queryItems !== null && queryItems.reference !== null && queryItems.reference !== '') {
            // res.send(queryItems);
            const paystackResponse = await superagent
              .get(`https://api.paystack.co/transaction/verify/${queryItems.reference}`)
              .set('Authorization', `Bearer ${payData.credentials.sk}`);
            // res.send(paystackResponse.body);
            if (
              paystackResponse !== null &&
              paystackResponse.body !== null &&
              paystackResponse.body.data !== null &&
              paystackResponse.body.data.status !== null &&
              paystackResponse.body.data.status === 'success'
            ) {
              await paymentInitiationService.updatePaymentsInfo(req.params.id, {
                status: 'paid',
                payResponse: paystackResponse.body,
              });
              // Local Stores subjects are handled (and the redirect left to run) before the food-vertical chain.
              await dispatchPaidCallback(paymentInfo.payments);
              res.redirect(httpStatus.SEE_OTHER, redirectURL);
            } else {
              res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
            }
          } else {
            res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
          }
        } else {
          res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
        }
      } else if (payData !== null && payData.slug === 'paypal') {
        const ppQueryItems = pick(req.query, ['token', 'PayerID']);
        if (ppQueryItems !== null && ppQueryItems.token !== null && ppQueryItems.token !== '') {
          if (
            payData !== null &&
            payData.credentials &&
            payData.credentials !== null &&
            payData.credentials.secret !== null
          ) {
            const paypalDetail = await superagent
              .post(
                payData.environment === false
                  ? `https://api-m.sandbox.paypal.com/v1/oauth2/token`
                  : `https://api-m.paypal.com/v1/oauth2/token`
              )
              .auth(payData.credentials.id, payData.credentials.secret)
              .set('Content-Type', 'application/x-www-form-urlencoded')
              .send({ grant_type: 'client_credentials' });
            if (
              paypalDetail &&
              paypalDetail !== null &&
              paypalDetail.status === 200 &&
              paypalDetail.text !== ''
            ) {
              const payPaylAuth = JSON.parse(paypalDetail.text);
              if (
                payPaylAuth !== null &&
                payPaylAuth.access_token &&
                payPaylAuth.access_token !== ''
              ) {
                const paypalCapureResponse = await superagent
                  .post(
                    payData.environment === false
                      ? `https://api-m.sandbox.paypal.com/v2/checkout/orders/${ppQueryItems.token}/capture`
                      : `https://api-m.paypal.com/v2/checkout/orders/${ppQueryItems.token}/capture`
                  )
                  .set('Content-Type', 'application/json')
                  .set('Authorization', `Bearer ${payPaylAuth.access_token}`)
                  .send({});
                if (
                  paypalCapureResponse &&
                  paypalCapureResponse !== null &&
                  paypalCapureResponse.status === 201 &&
                  paypalCapureResponse.body !== null
                ) {
                  await paymentInitiationService.updatePaymentsInfo(req.params.id, {
                    status: 'paid',
                    payResponse: paypalCapureResponse.body,
                  });
                  // Local Stores subjects are handled (and the redirect left to run) before the food-vertical chain.
                  await dispatchPaidCallback(paymentInfo.payments);
                  res.redirect(httpStatus.SEE_OTHER, redirectURL);
                } else {
                  res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
                }
              } else {
                res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
              }
            } else {
              res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
            }
          } else {
            res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
          }
        } else {
          res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
        }

        // const queryItems = pick(req.query, ['pay_id']);
        // if (queryItems !== null && queryItems.pay_id !== null) {

        // } else {
        //   res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
        // }
      } else if (payData !== null && payData.slug === 'instamojo') {
        const queryItems = pick(req.query, ['payment_id', 'payment_request_id']);
        if (
          queryItems !== null &&
          queryItems.payment_id !== null &&
          queryItems.payment_id !== '' &&
          queryItems.payment_request_id !== null &&
          queryItems.payment_request_id !== ''
        ) {
          try {
            const instamojoPaymentLink =
              payData.environment === false
                ? `https://test.instamojo.com/api/1.1/payment-requests/${queryItems.payment_request_id}/${queryItems.payment_id}`
                : `https://www.instamojo.com/api/1.1/payment-requests/${queryItems.payment_request_id}/${queryItems.payment_id}`;
            const instamojoLink = await superagent
              .get(instamojoPaymentLink)
              .set('X-Api-Key', payData.credentials.key)
              .set('X-Auth-Token', payData.credentials.token);
            if (
              instamojoLink !== null &&
              instamojoLink.body !== null &&
              instamojoLink.body.payment_request !== null &&
              instamojoLink.body.payment_request.status !== null &&
              instamojoLink.body.payment_request.status === 'Completed'
            ) {
              await paymentInitiationService.updatePaymentsInfo(req.params.id, {
                status: 'paid',
                payResponse: instamojoLink.body,
              });
              // Local Stores subjects are handled (and the redirect left to run) before the food-vertical chain.
              await dispatchPaidCallback(paymentInfo.payments);

              res.redirect(httpStatus.SEE_OTHER, redirectURL);
            } else {
              res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
            }
            // eslint-disable-next-line no-unused-vars
          } catch (error) {
            res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
          }
        } else {
          res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
        }
      } else if (payData !== null && payData.slug === 'flutterwave') {
        if (
          payData !== null &&
          payData.credentials !== null &&
          payData.credentials.secret !== null
        ) {
          const fwqueryItems = pick(req.query, ['status', 'transaction_id', 'tx_ref']);
          if (fwqueryItems.status === 'successful') {
            const flutterwaveVerifed = await superagent
              .get(
                `https://api.flutterwave.com/v3/transactions/${fwqueryItems.transaction_id}/verify`
              )
              .set('Authorization', `Bearer ${payData.credentials.secret}`);
            if (
              flutterwaveVerifed &&
              flutterwaveVerifed !== null &&
              flutterwaveVerifed.status === 200 &&
              flutterwaveVerifed.body !== null
            ) {
              await paymentInitiationService.updatePaymentsInfo(req.params.id, {
                status: 'paid',
                payResponse: flutterwaveVerifed.body,
              });
              // Local Stores subjects are handled (and the redirect left to run) before the food-vertical chain.
              await dispatchPaidCallback(paymentInfo.payments);
              res.redirect(httpStatus.SEE_OTHER, redirectURL);
            } else {
              res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
            }
          } else {
            res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
          }
        } else {
          res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
        }
      } else if (payData !== null && payData.slug === 'cashfree') {
        if (payData !== null && payData.credentials !== null && payData.credentials.key !== null) {
          try {
            const link =
              payData.environment === true
                ? `https://api.cashfree.com/pg/links/${payId}/orders`
                : `https://sandbox.cashfree.com/pg/links/${payId}/orders`;
            const cashFreeLinks = await superagent
              .get(link)
              .set('Content-Type', 'application/json')
              .set('x-api-version', payData.credentials.apiVersion)
              .set('x-client-id', payData.credentials.appId)
              .set('x-client-secret', payData.credentials.secretKey);
            if (cashFreeLinks !== null && cashFreeLinks.body !== null) {
              if (checkArrayNotEmpty(cashFreeLinks.body)) {
                const verifyPayment = cashFreeLinks.body[0];
                if (
                  verifyPayment !== null &&
                  verifyPayment.order_status !== null &&
                  verifyPayment.order_status !== '' &&
                  verifyPayment.order_status === 'PAID'
                ) {
                  await paymentInitiationService.updatePaymentsInfo(req.params.id, {
                    status: 'paid',
                    payResponse: verifyPayment,
                  });
                  // Local Stores subjects are handled (and the redirect left to run) before the food-vertical chain.
                  await dispatchPaidCallback(paymentInfo.payments);
                  res.redirect(httpStatus.SEE_OTHER, redirectURL);
                } else {
                  res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
                }
              } else {
                res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
              }
            } else {
              res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
            }
            // eslint-disable-next-line no-unused-vars
          } catch (error) {
            res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
          }
        } else {
          res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
        }
      } else if (payData !== null && payData.slug === 'xendit') {
        if (
          payData !== null &&
          payData.credentials !== null &&
          payData.credentials.secretKey !== null
        ) {
          if (
            paymentInfo !== null &&
            paymentInfo.payments !== null &&
            paymentInfo.payments.payResponse !== null &&
            paymentInfo.payments.payResponse.id !== null &&
            paymentInfo.payments.payResponse.id !== ''
          ) {
            try {
              const response = await superagent
                .get(
                  `https://api.xendit.co/payment_requests/${paymentInfo.payments.payResponse.id}`
                )
                .auth(payData.credentials.secretKey, '');
              const verifyPayment = response.body;
              if (
                verifyPayment !== null &&
                verifyPayment.status !== null &&
                verifyPayment.status === 'SUCCEEDED'
              ) {
                await paymentInitiationService.updatePaymentsInfo(req.params.id, {
                  status: 'paid',
                  payResponse: verifyPayment,
                });
                // Local Stores subjects are handled (and the redirect left to run) before the food-vertical chain.
                await dispatchPaidCallback(paymentInfo.payments);
                res.redirect(httpStatus.SEE_OTHER, redirectURL);
              } else {
                res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
              }
              // eslint-disable-next-line no-unused-vars
            } catch (error) {
              res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
            }
          } else {
            res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
          }
        } else {
          res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
        }
      } else {
        res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
      }
    } else {
      res.redirect(httpStatus.SEE_OTHER, repeatedURL);
    }
  } else {
    res.redirect(httpStatus.SEE_OTHER, failedCallBackURL);
  }
});

const failedPayment = catchAsync(async (req, res) => {
  res.render('payments/failed');
});

const paymentProcessed = catchAsync(async (req, res) => {
  res.render('payments/success');
});

const repeatedPayment = catchAsync(async (req, res) => {
  res.render('payments/repeated');
});

const getUserOrderTransaction = catchAsync(async (req, res) => {
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const result = await paymentInitiationService.getUserOrderTransaction(req.body.uid, options);
  res.send(result);
});
const getUserDiningTransaction = catchAsync(async (req, res) => {
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const result = await paymentInitiationService.getUserDiningTransaction(req.body.uid, options);
  res.send(result);
});

const getUserFoodSubscriptionTransaction = catchAsync(async (req, res) => {
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const result = await paymentInitiationService.getUserFoodSubscriptionTransaction(
    req.body.uid,
    options
  );
  res.send(result);
});

const getPaymentInitiateReport = catchAsync(async (req, res) => {
  const options = pick(req.query, [
    'filter',
    'status',
    'kind',
    'filterDates',
    'search',
    'limit',
    'page',
    'search',
  ]);
  const result = await paymentInitiationService.getPaymentInitiateReport(options);
  res.send(result);
});

const exportCollection = catchAsync(async (req, res) => {
  const options = pick(req.query, ['filter', 'status', 'kind', 'filterDates', 'search']);
  const { type } = req.query;
  if (type !== 'raw') {
    const result = await paymentInitiationService.exportCollection(options);
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        userId:
          detail &&
          detail.userInfo &&
          detail.userInfo.id &&
          detail.userInfo.id !== null &&
          detail.userInfo.id !== ''
            ? detail.userInfo.id
            : '-',
        userFirstName:
          detail &&
          detail.userInfo &&
          detail.userInfo.firstName &&
          detail.userInfo.firstName !== null &&
          detail.userInfo.firstName !== ''
            ? detail.userInfo.firstName
            : '-',
        userLastName:
          detail &&
          detail.userInfo &&
          detail.userInfo.lastName &&
          detail.userInfo.lastName !== null &&
          detail.userInfo.lastName !== ''
            ? detail.userInfo.lastName
            : '-',
        userRole:
          detail &&
          detail.userInfo &&
          detail.userInfo.role &&
          detail.userInfo.role !== null &&
          detail.userInfo.role !== ''
            ? detail.userInfo.role
            : '-',
        paymentId:
          detail &&
          detail.payments &&
          detail.payments.id &&
          detail.payments.id !== null &&
          detail.payments.id !== ''
            ? detail.payments.id
            : '-',
        paymentName:
          detail &&
          detail.payments &&
          detail.payments.name &&
          detail.payments.name !== null &&
          detail.payments.name !== ''
            ? detail.payments.name
            : '-',
        orderId:
          detail &&
          detail.orderInfo &&
          detail.orderInfo.id &&
          detail.orderInfo.id !== null &&
          detail.orderInfo.id !== ''
            ? detail.orderInfo.id
            : '-',
        orderNo:
          detail &&
          detail.orderInfo &&
          detail.orderInfo.orderNo &&
          detail.orderInfo.orderNo !== null &&
          detail.orderInfo.orderNo !== ''
            ? detail.orderInfo.orderNo
            : '-',
        tiffinSubscription:
          detail &&
          detail.tiffinSubscription &&
          detail.tiffinSubscription !== null &&
          detail.tiffinSubscription !== ''
            ? detail.tiffinSubscription
            : '-',
        booking:
          detail && detail.booking && detail.booking !== null && detail.booking !== ''
            ? detail.booking
            : '-',
        restaurantRegisterRequest:
          detail &&
          detail.restaurantRegisterRequest &&
          detail.restaurantRegisterRequest !== null &&
          detail.restaurantRegisterRequest !== ''
            ? detail.restaurantRegisterRequest
            : '-',
        subscribeId:
          detail && detail.subscribeId && detail.subscribeId !== null && detail.subscribeId !== ''
            ? detail.subscribeId
            : '-',
        createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('PaymentTransactions');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Type', key: 'paymentFrom' },
        { header: 'Amount', key: 'amount' },
        { header: 'Payment Id', key: 'paymentId' },
        { header: 'Payment Name', key: 'paymentName' },
        { header: 'User Id', key: 'userId' },
        { header: 'User FirstName', key: 'userFirstName' },
        { header: 'User LastName', key: 'userLastName' },
        { header: 'User Role', key: 'userRole' },
        { header: 'Order Id', key: 'orderId' },
        { header: 'Order No', key: 'orderNo' },
        { header: 'Dining Booking Id', key: 'booking' },
        { header: 'Tiffin Subscription Id', key: 'tiffinSubscription' },
        { header: 'Restaurant Register Request Id', key: 'restaurantRegisterRequest' },
        { header: 'Renew Restaurant Subscription Id', key: 'subscribeId' },
        { header: 'Created At', key: 'createdAt' },
        { header: 'Status', key: 'status' },
      ];

      worksheet.addRows(mappedResult);

      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.font = {
            name: 'Verdana',
            size: 12,
            color: { argb: 'FF000000' }, // Black text
          };
          cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 3 };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFFFFF' }, // White background
          };
        });
      });

      const headerRow = worksheet.getRow(1);

      headerRow.eachCell((cell) => {
        cell.font = {
          name: 'Verdana',
          size: 12,
          bold: true,
          color: { argb: 'FF000000' },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 3 };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFDCE6F1' }, // Optional
        };
      });

      worksheet.columns.forEach((column) => {
        let maxLength = 0;

        column.eachCell({ includeEmpty: true }, (cell) => {
          let columnLength = 0;

          if (cell.value) {
            const rawValue =
              typeof cell.value === 'object' && cell.value.richText
                ? cell.value.richText.map((rt) => rt.text).join('')
                : cell.value.toString();

            // Account for line breaks and longest line in multi-line cells
            const lines = rawValue.split('\n');
            columnLength = Math.max(...lines.map((line) => line.length));
          }

          if (columnLength > maxLength) {
            maxLength = columnLength;
          }
        });

        column.width = maxLength + 10; // Add some padding
      });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename=users.xlsx');

      await workbook.xlsx.write(res);
      res.end();
    } else {
      const fieldItems = result.map((detail, index) => ({
        'S. No.': index + 1,
        Id: detail.id,
        Type: detail.paymentFrom,
        Amount: detail.amount,
        'Payment Id':
          detail &&
          detail.payments &&
          detail.payments.id &&
          detail.payments.id !== null &&
          detail.payments.id !== ''
            ? detail.payments.id
            : '-',
        'Payment Name':
          detail &&
          detail.payments &&
          detail.payments.name &&
          detail.payments.name !== null &&
          detail.payments.name !== ''
            ? detail.payments.name
            : '-',
        'User Id':
          detail &&
          detail.userInfo &&
          detail.userInfo.id &&
          detail.userInfo.id !== null &&
          detail.userInfo.id !== ''
            ? detail.userInfo.id
            : '-',
        'User FirstName':
          detail &&
          detail.userInfo &&
          detail.userInfo.firstName &&
          detail.userInfo.firstName !== null &&
          detail.userInfo.firstName !== ''
            ? detail.userInfo.firstName
            : '-',
        'User LastName':
          detail &&
          detail.userInfo &&
          detail.userInfo.lastName &&
          detail.userInfo.lastName !== null &&
          detail.userInfo.lastName !== ''
            ? detail.userInfo.lastName
            : '-',
        'User Role':
          detail &&
          detail.userInfo &&
          detail.userInfo.role &&
          detail.userInfo.role !== null &&
          detail.userInfo.role !== ''
            ? detail.userInfo.role
            : '-',
        'Order Id':
          detail &&
          detail.orderInfo &&
          detail.orderInfo.id &&
          detail.orderInfo.id !== null &&
          detail.orderInfo.id !== ''
            ? detail.orderInfo.id
            : '-',
        'Order No':
          detail &&
          detail.orderInfo &&
          detail.orderInfo.orderNo &&
          detail.orderInfo.orderNo !== null &&
          detail.orderInfo.orderNo !== ''
            ? detail.orderInfo.orderNo
            : '-',
        'Dining Booking Id':
          detail && detail.booking && detail.booking !== null && detail.booking !== ''
            ? detail.booking
            : '-',
        'Tiffin Subscription Id':
          detail &&
          detail.tiffinSubscription &&
          detail.tiffinSubscription !== null &&
          detail.tiffinSubscription !== ''
            ? detail.tiffinSubscription
            : '-',
        'Restaurant Register Request Id':
          detail &&
          detail.restaurantRegisterRequest &&
          detail.restaurantRegisterRequest !== null &&
          detail.restaurantRegisterRequest !== ''
            ? detail.restaurantRegisterRequest
            : '-',
        'Renew Restaurant Subscription Id':
          detail && detail.subscribeId && detail.subscribeId !== null && detail.subscribeId !== ''
            ? detail.subscribeId
            : '-',
        'Created At': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
        Status: detail.status,
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await paymentInitiationService.exportRawCollection(options);
    const downloadPath = path.join(__dirname, `../templates/downloads/paymentinitiations.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'paymentinitiations.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const importCollection = catchAsync(async (req, res) => {
  try {
    const upload = uploadMiddleware('local');
    upload.single('file')(req, res, async (err) => {
      if (!err) {
        if (req.file) {
          const ext = path.extname(req.file.originalname).toLowerCase();
          const { file } = req;
          if (req.body.type === 'excel' && ext === '.xlsx') {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(file.path);
            const worksheet = workbook.worksheets[0];
            const records = [];
            const headerRow = worksheet.getRow(1).values.slice(1);
            worksheet.eachRow((row, rowNumber) => {
              if (rowNumber === 1) return;

              const rowValues = row.values.slice(1);
              const obj = {};
              headerRow.forEach((header, index) => {
                obj[header] = rowValues[index];
              });

              records.push(obj);
            });
            fs.unlinkSync(file.path);
            const importKeys = [...new Set(records.flatMap(Object.keys))];
            const validSchema =
              importKeys.length === paymentTransactionSchemaKeys.length &&
              importKeys.every((item) => paymentTransactionSchemaKeys.includes(item));
            if (validSchema) {
              const result = await paymentInitiationService.importCollection(records);
              res.send(result);
            } else {
              res.status(400).send({ code: 400, message: 'Validation failed', extra: '' });
            }
          } else if (req.body.type === 'csv' && ext === '.csv') {
            const fileStream = fs.createReadStream(file.path);
            Papa.parse(fileStream, {
              header: true,
              skipEmptyLines: true,
              complete: async (results) => {
                try {
                  const records = results.data;
                  fs.unlinkSync(file.path);
                  const importKeys = [...new Set(records.flatMap(Object.keys))];
                  const validSchema =
                    importKeys.length === paymentTransactionSchemaKeys.length &&
                    importKeys.every((item) => paymentTransactionSchemaKeys.includes(item));
                  if (validSchema) {
                    const result = await paymentInitiationService.importCollection(records);
                    res.send(result);
                  } else {
                    res.status(400).send({ code: 400, message: 'Validation failed', extra: '' });
                  }
                } catch (papaError) {
                  fs.unlinkSync(file.path);
                  res
                    .status(
                      papaError.statusCode ? papaError.statusCode : httpStatus.INTERNAL_SERVER_ERROR
                    )
                    .send({ code: 400, message: papaError.message, extra: '' });
                }
              },
              error: () => {
                fs.unlinkSync(file.path);
                res.status(500).json({ code: 500, message: 'Failed to parse CSV', extra: '' });
              },
            });
          } else {
            fs.unlinkSync(file.path);
            res.status(400).send({ code: 400, message: 'Invalid file type', extra: '' });
          }
        } else {
          res
            .status(400)
            .send({ code: 400, message: 'Please select a file to upload!', extra: '' });
        }
      } else if (err instanceof multer.MulterError) {
        let { error } = err;
        if (err.code === 'LIMIT_FILE_SIZE') {
          error = `Maximum file size is ##dynamic## MB`;
        }
        const sizeCount = config.file.maxUploadSize / (1024 * 1024);
        res.status(400).send({ code: 400, message: error, extra: sizeCount });
      } else {
        res
          .status(err.statusCode ? err.statusCode : httpStatus.INTERNAL_SERVER_ERROR)
          .send({ code: 400, message: err.message, extra: '' });
      }
    });
  } catch (error) {
    res.status(400).send({ code: 400, message: error.message, extra: '' });
  }
});

/**
 * Enterprise: Razorpay webhook (CustomUI/Standard compatible).
 * Configure URL in Razorpay Dashboard:
 *   POST https://<api>/v1/public/payments/razorpay_webhook
 * Events: payment.captured, payment.failed, order.paid, refund.processed.
 * Verify: HMAC-SHA256(rawBody, webhookSecret) === x-razorpay-signature.
 * Secret: RAZORPAY_WEBHOOK_SECRET env, else PaymentConfig credentials.webhookSecret,
 * else credentials.secret (test fallback).
 * Idempotent: already-paid initiations return 200 without re-dispatch.
 */
const razorpayWebhook = catchAsync(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'] || req.headers['X-Razorpay-Signature'] || '';
  const rawBody = req.rawBody
    ? req.rawBody.toString('utf8')
    : typeof req.body === 'string'
      ? req.body
      : JSON.stringify(req.body || {});
  let event;
  try {
    event = typeof req.body === 'object' && !(req.body instanceof Buffer) ? req.body : JSON.parse(rawBody);
  } catch (parseErr) {
    void parseErr;
    return res.status(200).json({ success: false, message: 'bad payload' });
  }
  // Resolve secret without blocking the 200-ack path.
  let secret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
  try {
    if (!secret && paymentConfigService && paymentConfigService.getPaymentBySlug) {
      const cfg = await paymentConfigService.getPaymentBySlug('razorpay');
      if (cfg && cfg.credentials) {
        secret = cfg.credentials.webhookSecret || cfg.credentials.webhook_secret || cfg.credentials.secret || '';
      }
    }
  } catch (secretErr) {
    void secretErr;
  }
  if (secret) {
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    if (expected !== signature) {
      return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
    }
  }
  const eventName = event.event || '';
  const entity =
    (event.payload && event.payload.payment && event.payload.payment.entity) ||
    (event.payload && event.payload.order && event.payload.order.entity) ||
    (event.payload && event.payload.refund && event.payload.refund.entity) ||
    {};
  const rzpOrderId = entity.order_id || entity.orderId || '';
  const rzpPaymentId = entity.id || '';
  const rzpStatus = entity.status || '';
  if (!rzpOrderId && !rzpPaymentId) {
    return res.status(200).json({ success: true, message: 'ignored (no order/payment)' });
  }
  // Map gateway order -> initiation (stored at makePayment time).
  let initiation = null;
  try {
    if (rzpOrderId) {
      initiation = await PaymentInitiation.findOne({ 'payResponse.razorpay_order_id': rzpOrderId });
    }
    if (!initiation && rzpPaymentId) {
      initiation = await PaymentInitiation.findOne({ 'payResponse.id': rzpPaymentId });
    }
  } catch (lookupErr) {
    void lookupErr;
  }
  if (!initiation) {
    return res.status(200).json({ success: true, message: 'ignored (unknown order)' });
  }
  if (initiation.status === 'paid') {
    return res.status(200).json({ success: true, message: 'replay ignored' });
  }
  const isCapturedEvent = eventName === 'payment.captured' || eventName === 'order.paid' || rzpStatus === 'captured';
  const isFailedEvent = eventName === 'payment.failed' || rzpStatus === 'failed';
  if (isCapturedEvent) {
    // Server-to-server confirm before marking paid (never trust webhook alone).
    try {
      const cfg = await paymentConfigService.getPaymentBySlug('razorpay');
      if (cfg && cfg.credentials && cfg.credentials.key && rzpPaymentId) {
        const verifyResponse = await superagent
          .get(`https://api.razorpay.com/v1/payments/${rzpPaymentId}`)
          .auth(cfg.credentials.key, cfg.credentials.secret);
        if (!verifyResponse.body || verifyResponse.body.status !== 'captured') {
          return res.status(200).json({ success: true, message: 'not captured yet' });
        }
        if (verifyResponse.body.order_id && rzpOrderId && verifyResponse.body.order_id !== rzpOrderId) {
          return res.status(200).json({ success: true, message: 'order mismatch' });
        }
        await paymentInitiationService.updatePaymentsInfo(initiation.id, {
          status: 'paid',
          payResponse: verifyResponse.body,
        });
        const info = await paymentInitiationService.paymentInfo(initiation.id);
        if (info && info.success) await dispatchPaidCallback(info.payments);
        return res.status(200).json({ success: true, message: 'paid' });
      }
    } catch (verifyErr) {
      void verifyErr;
      return res.status(200).json({ success: false, message: 'verify failed, will retry' });
    }
    // Fallback when payment id missing (order.paid without payment entity).
    await paymentInitiationService.updatePaymentsInfo(initiation.id, {
      status: 'paid',
      payResponse: { ...(initiation.payResponse || {}), webhookEvent: eventName, webhookEntity: entity },
    });
    const info = await paymentInitiationService.paymentInfo(initiation.id);
    if (info && info.success) await dispatchPaidCallback(info.payments);
    return res.status(200).json({ success: true, message: 'paid (fallback)' });
  }
  if (isFailedEvent) {
    try {
      const info = await paymentInitiationService.paymentInfo(initiation.id);
      if (info && info.success) await dispatchFailedCallback(info.payments, `razorpay:${eventName || rzpStatus}`);
    } catch (failedErr) {
      void failedErr;
    }
    return res.status(200).json({ success: true, message: 'failed logged (retryable)' });
  }
  return res.status(200).json({ success: true, message: `ignored (${eventName || 'unknown'})` });
});

/**
 * Enterprise: reconcile stuck `initiated` Razorpay intents.
 * Finds initiations older than `olderThanMin` with a stored razorpay_order_id,
 * lists payments for the order, marks captured ones paid.
 * Used by cron + scripts/reconcile.stuck.payments.js. Idempotent.
 */
const reconcileStuckRazorpayPayments = async (olderThanMin = 30, limit = 50) => {
  const cutoff = new Date(Date.now() - olderThanMin * 60 * 1000);
  const stuck = await PaymentInitiation.find({
    status: 'initiated',
    createdAt: { $lt: cutoff },
    'payResponse.razorpay_order_id': { $exists: true, $ne: '' },
  })
    .sort({ createdAt: 1 })
    .limit(limit);
  if (!stuck || stuck.length === 0) return { checked: 0, paid: 0 };
  let cfg;
  try {
    cfg = await paymentConfigService.getPaymentBySlug('razorpay');
  } catch (cfgErr) {
    void cfgErr;
    cfg = null;
  }
  if (!cfg || !cfg.credentials || !cfg.credentials.key) return { checked: stuck.length, paid: 0, error: 'missing credentials' };
  let paid = 0;
  for (const row of stuck) {
    const rzpOrderId = row.payResponse && row.payResponse.razorpay_order_id;
    if (!rzpOrderId) continue;
    try {
      const list = await superagent
        .get(`https://api.razorpay.com/v1/orders/${rzpOrderId}/payments`)
        .auth(cfg.credentials.key, cfg.credentials.secret);
      const items = (list.body && (list.body.items || list.body.data)) || [];
      const captured = items.find((p) => p && p.status === 'captured');
      if (captured) {
        await paymentInitiationService.updatePaymentsInfo(row.id, { status: 'paid', payResponse: captured });
        const info = await paymentInitiationService.paymentInfo(row.id);
        if (info && info.success) await dispatchPaidCallback(info.payments);
        paid += 1;
      }
    } catch (sweepErr) {
      // Keep initiated — next sweep retries. Never throw out of cron.
      void sweepErr;
    }
  }
  return { checked: stuck.length, paid };
};

/**
 * Enterprise: remind pending-payment orders once, ~5 min before expiry.
 * Window math mirrors the app (30-min payPendingAmountBeforeMinutesOffCreation):
 * reminds orders aged [20,25) min so each order matches exactly one 5-min
 * sweep. Idempotent by window — no schema flag needed.
 */
const remindPendingPayments = async (windowMin = 30, remindAtMin = 25, limit = 100) => {
  const { Orders } = require('../models');
  const { fcmNotificationService } = require('../services');
  const now = Date.now();
  const olderThan = new Date(now - remindAtMin * 60 * 1000);
  const newerThan = new Date(now - (remindAtMin + 5) * 60 * 1000);
  const stuck = await Orders.find(
    { status: 'pending_payments', createdAt: { $gte: newerThan, $lt: olderThan } },
    { user: 1 }
  )
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();
  if (!stuck || stuck.length === 0) return { checked: 0, reminded: 0 };
  let reminded = 0;
  const minutesLeft = Math.max(windowMin - remindAtMin, 1);
  for (const row of stuck) {
    try {
      const r = await fcmNotificationService.userPaymentExpiring(row._id, row.user, minutesLeft);
      if (r && !r.skipped) reminded += 1;
    } catch (sweepErr) {
      // Keep pending — next sweep retries. Never throw out of cron.
      void sweepErr;
    }
  }
  return { checked: stuck.length, reminded };
};

module.exports = {
  create,
  makePayment,
  successPayment,
  failedPayment,
  paymentProcessed,
  repeatedPayment,
  razorpayWebhook,
  reconcileStuckRazorpayPayments,
  remindPendingPayments,
  getUserOrderTransaction,
  getUserDiningTransaction,
  getUserFoodSubscriptionTransaction,
  getPaymentInitiateReport,
  exportCollection,
  importCollection,
};

