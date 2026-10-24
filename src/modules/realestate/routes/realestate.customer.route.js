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
 * modification, or use of this source code in a public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const express = require('express');
const appAuth = require('../../../middlewares/appAuth');
const validate = require('../../../middlewares/validate');
const controller = require('../controllers/realestate.customer.controller');
const V = require('../validations/realestate.customer.validation');
const holdController = require('../controllers/realestate.hold.controller');
const HV = require('../validations/realestate.hold.validation');

const router = express.Router();

/**
 * Customer Real Estate routes. Mounted at `/v1/realestate/customer`.
 *
 * ## `appAuth()` on every route, including the enquiry
 *
 * An enquiry creates a Lead carrying a customer id, and the customer comes from the token
 * (doc §7.1: "Customer: `appAuth()` + `user` rights. Tenant is `req.user`"). There is no
 * guest enquiry: an anonymous enquiry has no owner to appear in a history, and a stored
 * contact message is exactly what BR-06 forbids.
 *
 * ## Two mounted paths, one prefix
 *
 * `/properties/:id/enquiry` is declared here so the path reads as doc §7.3 writes it —
 * `POST /v1/realestate/customer/properties/:id/enquiry`. It could equally have sat on the
 * public route file behind `appAuth`, but that file is deliberately guest-accessible and
 * adding an authenticated route to it would blur that.
 *
 * ## Ordering
 *
 * `/leads/:id/activity` before `/leads/:id`, since both match a single trailing segment
 * difference — declared this way so `activity` is never read as an id and rejected as a
 * malformed ObjectId.
 */

// The doc §7.3 named route.
router.post(
  '/properties/:id/enquiry',
  appAuth(),
  validate(V.enquiry),
  controller.createEnquiry
);

router.get('/leads', appAuth(), validate(V.list), controller.listMyLeads);

router.get(
  '/leads/:id/activity',
  appAuth(),
  validate(V.leadParams),
  controller.getMyLeadActivity
);

router.get('/leads/:id', appAuth(), validate(V.leadParams), controller.getMyLead);

router.patch(
  '/leads/:id/withdraw',
  appAuth(),
  validate(V.withdraw),
  controller.withdrawEnquiry
);

// Site visits (Flow 11). The customer requests; the assignment engine
// assigns. `/visits` is declared before `/visits/:id` so the literal
// path is never read as an id and rejected as a malformed ObjectId.
router.post('/visits', appAuth(), validate(V.createVisit), controller.createVisitRequest);
router.get('/visits', appAuth(), validate(V.visitList), controller.listMyVisits);
router.get('/visits/:id', appAuth(), validate(V.visitParams), controller.getMyVisit);

// Loans (Flow 12). POST distributes the request to every ACTIVE bank
// as a LOAN_LEAD_CREATED application; GET returns requests with their
// applications + offers nested so the compare screen is one call.
// Same literal-before-param ordering as `/visits`.
router.post('/loans', appAuth(), validate(V.createLoan), controller.createLoanRequest);
router.get('/loans', appAuth(), validate(V.loanList), controller.listMyLoans);
router.post(
  '/loans/:id/offers/:offerId/accept',
  appAuth(),
  validate(V.acceptLoanOffer),
  controller.acceptLoanOffer
);
router.get('/loans/:id', appAuth(), validate(V.loanParams), controller.getMyLoan);

// Holds — customer money in trust (BR-13). Create → pay via the
// `property_hold` payment branch → ACTIVE. Cancel creates the PENDING
// refund; the `property_hold_refund` branch completes it.
router.post('/holds', appAuth(), validate(HV.createHold), holdController.createHold);
router.get('/holds', appAuth(), holdController.listMyHolds);
router.get('/holds/:id', appAuth(), validate(HV.holdParams), holdController.getMyHold);
router.post('/holds/:id/pay', appAuth(), validate(HV.payHold), holdController.payHold);
router.post('/holds/:id/cancel', appAuth(), validate(HV.holdParams), holdController.cancelHold);

// Named route (doc §7.3): principal becomes consideration, never revenue.
router.post(
  '/holds/:id/convert_to_sale',
  appAuth(),
  validate(HV.convertToSale),
  holdController.convertToSale
);

// Document requests (Flow 12 underwriting). A bank asks the customer
// for a document; the customer answers with an uploaded file. The
// requests are the customer's own - the tenant is `req.user`.
router.get('/document-requests', appAuth(), controller.listMyDocumentRequests);
router.post(
  '/document-requests/:id/submit',
  appAuth(),
  validate(V.documentRequestSubmit),
  controller.submitMyDocumentRequest
);

// Purchases (sale history). A purchase is a recorded sale against a
// property the customer bought - it is created by the hold conversion,
// never by the customer. `/purchases` is declared before `/purchases/:id`
// so the literal path is never read as an id.
router.get('/purchases', appAuth(), validate(V.purchaseList), controller.listMyPurchases);
router.get('/purchases/:id', appAuth(), validate(V.purchaseParams), controller.getMyPurchase);

// Saved properties (Favourite with type: 'property'). Reuses the shared
// Favourite model; the Real Estate module only owns the route surface and
// the model the favourites join against on read.
router.get('/saved-properties', appAuth(), validate(V.savedPropertyList), controller.listMySavedProperties);
router.get('/saved-properties/:propertyId/status', appAuth(), validate(V.savedPropertyParams), controller.isPropertyFavourited);
router.post('/saved-properties/:propertyId', appAuth(), validate(V.savedPropertyParams), controller.savePropertyFavourite);
router.delete('/saved-properties/:propertyId', appAuth(), validate(V.savedPropertyParams), controller.removePropertyFavourite);

module.exports = router;