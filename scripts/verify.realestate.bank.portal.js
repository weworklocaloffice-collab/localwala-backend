/**
 * verify.realestate.bank.portal.js — the bank portal parity gate.
 *
 * Plan §13.2 lists two bank-portal dialogs that did not exist:
 * `dialog-document-request` and `dialog-application-status`. Both
 * needed backend surface that did not exist either, so this gate covers
 * the whole slice:
 *
 *   - the loan application STATUS HISTORY (a new append-only collection
 *     written on every transition, read back for the timeline dialog)
 *   - the DOCUMENT REQUEST flow (a bank asks the customer for a
 *     document; the customer answers; the bank reviews the answer)
 *   - the portal defects that made the screens unusable: rows rendered
 *     as raw ObjectId hex, money served in paise, a queue that could not
 *     open a file, a sanction that skipped the dialog, and a commission
 *     page that divided rupees by 100
 *
 * Run: node scripts/verify.realestate.bank.portal.js
 */

const fs = require('fs');
const path = require('path');

const API_ROOT = path.resolve(__dirname, '..');
const APP_ROOT = path.resolve(API_ROOT, '..', 'Admin_panel');
const CUSTOMER_ROOT = path.resolve(API_ROOT, '..', 'Customer_app');

const BANK_ROUTE = path.join(API_ROOT, 'src/modules/realestate/routes/realestate.bank.route.js');
const BANK_CONTROLLER = path.join(
  API_ROOT,
  'src/modules/realestate/controllers/realestate.bank.controller.js'
);
const BANK_VALIDATION = path.join(
  API_ROOT,
  'src/modules/realestate/validations/realestate.bank.validation.js'
);
const CUSTOMER_ROUTE = path.join(
  API_ROOT,
  'src/modules/realestate/routes/realestate.customer.route.js'
);
const CUSTOMER_CONTROLLER = path.join(
  API_ROOT,
  'src/modules/realestate/controllers/realestate.customer.controller.js'
);
const LOAN_SERVICE = path.join(
  API_ROOT,
  'src/modules/realestate/services/realestate.loan.service.js'
);
const DOC_REQUEST_SERVICE = path.join(
  API_ROOT,
  'src/modules/realestate/services/realestate.document.request.service.js'
);
const DOC_REQUEST_MODEL = path.join(
  API_ROOT,
  'src/modules/realestate/models/realestate.document.request.model.js'
);
const HISTORY_MODEL = path.join(
  API_ROOT,
  'src/modules/realestate/models/realestate.loan.application.status.history.model.js'
);
const NOTIFICATION_MODEL = path.join(
  API_ROOT,
  'src/modules/realestate/models/realestate.notification.model.js'
);
const FCM = path.join(API_ROOT, 'src/services/fcm.notification.service.js');

const PORTAL = path.join(APP_ROOT, 'src/app/pages/bank-team');
const CUSTOMER_PAGES = path.join(CUSTOMER_ROOT, 'lib/app/presentation/pages/real_estate');

const read = (p) => fs.readFileSync(p, 'utf8');

const bankRouteText = read(BANK_ROUTE);
const bankControllerText = read(BANK_CONTROLLER);
const bankValidationText = read(BANK_VALIDATION);
const customerRouteText = read(CUSTOMER_ROUTE);
const customerControllerText = read(CUSTOMER_CONTROLLER);
const loanServiceText = read(LOAN_SERVICE);
const docRequestServiceText = read(DOC_REQUEST_SERVICE);
const docRequestModelText = read(DOC_REQUEST_MODEL);
const historyModelText = read(HISTORY_MODEL);
const notificationModelText = read(NOTIFICATION_MODEL);
const fcmText = read(FCM);

const checks = [];
const assert = (label, ok, detail = '') => {
  checks.push({ label, ok, detail });
};

// ------------------------------------------------- [1] the status history

assert(
  '[1a] a loan application status-history model exists',
  /RealEstateLoanApplicationStatusHistory/.test(historyModelText) &&
    /application:[\s\S]{0,120}RealEstateLoanApplication/.test(historyModelText)
);
assert(
  '[1b] the history is append-only and indexed for a timeline read',
  /timestamps: true/.test(historyModelText) &&
    /index\(\{ application: 1, createdAt: 1 \}\)/.test(historyModelText)
);
assert(
  '[1c] the history records the actor, so "who moved this file" is answerable',
  /actorType/.test(historyModelText) && /actor/.test(historyModelText)
);
assert(
  '[1d] the loan service records a history row on every transition',
  /async function recordStatusHistory/.test(loanServiceText) &&
    (loanServiceText.match(/recordStatusHistory\(\{/g) || []).length >= 4,
  `${(loanServiceText.match(/recordStatusHistory\(\{/g) || []).length} call site(s)`
);
assert(
  '[1e] a failed history write never rolls back a transition',
  /loan status history skipped/.test(loanServiceText)
);
assert(
  '[1f] the bank can read the timeline of its own application',
  /getApplicationStatusHistory/.test(bankRouteText) &&
    /getApplicationStatusHistory/.test(bankControllerText)
);
assert(
  '[1g] the timeline read is scoped to the bank (a foreign application is 404)',
  /findOne\(\{[\s\S]{0,120}_id: req\.params\.id,[\s\S]{0,60}bank: req\.bankId/.test(
    bankControllerText
  )
);

// ---------------------------------------------- [2] the document requests

assert(
  '[2a] a document-request model exists with a closed category enum',
  /RealEstateDocumentRequest/.test(docRequestModelText) &&
    /enum: \[[\s\S]{0,200}'SALARY_SLIP'[\s\S]{0,200}'OTHER'/.test(docRequestModelText)
);
assert(
  '[2b] the request carries the customer, the bank and the application',
  /customer:[\s\S]{0,80}ref: 'User'/.test(docRequestModelText) &&
    /bank:[\s\S]{0,80}ref: 'RealEstateBank'/.test(docRequestModelText) &&
    /loanApplication:[\s\S]{0,80}ref: 'RealEstateLoanApplication'/.test(
      docRequestModelText
    )
);
assert(
  '[2c] the customer\'s answer lives on the request, not on a property document',
  /fileUrl/.test(docRequestModelText) &&
    !/require\('\.\.\/models\/realestate\.property\.document\.model'\)/.test(docRequestModelText)
);
assert(
  '[2d] one open request per category per application (partial unique index)',
  /one_open_request_per_category/.test(docRequestModelText) &&
    /partialFilterExpression: \{ status: \{ \$in: \['REQUESTED', 'SUBMITTED'\] \} \}/.test(
      docRequestModelText
    )
);
assert(
  '[2e] only the owning bank may ask',
  /findOne\(\{[\s\S]{0,120}_id: applicationId,[\s\S]{0,60}bank: bankId/.test(
    docRequestServiceText
  )
);
assert(
  '[2f] a second ask for the same category is a 409, not a second row',
  /CONFLICT/.test(docRequestServiceText) && /11000/.test(docRequestServiceText)
);
assert(
  '[2g] documents are only requested while the bank is underwriting',
  /REQUESTABLE_STATUSES = \['DOCUMENTS_PENDING', 'UNDER_BANK_REVIEW'\]/.test(
    docRequestServiceText
  )
);
assert(
  '[2h] only the customer may answer their own request',
  /findOne\(\{[\s\S]{0,120}_id: requestId,[\s\S]{0,60}customer: customerId/.test(
    docRequestServiceText
  )
);
assert(
  '[2i] the bank creates, lists and reviews document requests',
  /createApplicationDocumentRequest/.test(bankRouteText) &&
    /listApplicationDocumentRequests/.test(bankRouteText) &&
    /reviewDocumentRequest/.test(bankRouteText)
);
assert(
  '[2j] the customer can list and answer their document requests',
  /listMyDocumentRequests/.test(customerRouteText) &&
    /submitMyDocumentRequest/.test(customerRouteText) &&
    /listMyDocumentRequests/.test(customerControllerText)
);
assert(
  '[2k] the customer\'s document-request routes are behind appAuth()',
  customerRouteText
    .split('router.')
    .filter((block) => block.includes("'/document-requests"))
    .every((block) => block.includes('appAuth()'))
);
assert(
  '[2l] the request body is validated in the { params } / { body } shape',
  /documentRequestSubmit: \{ params: documentRequestParams, body: documentRequestSubmitBody \}/.test(
    read(path.join(API_ROOT, 'src/modules/realestate/validations/realestate.customer.validation.js'))
  ) &&
    /createDocumentRequest/.test(bankValidationText) &&
    /reviewDocumentRequest/.test(bankValidationText)
);
{
  // The answer's file url: an absolute http(s) url or a relative media
  // path - but never a path that walks up the tree.
  const V = require(path.join(
    API_ROOT,
    'src/modules/realestate/validations/realestate.customer.validation'
  ));
  const accepted = (v) => !V.documentRequestSubmit.body.validate({ fileUrl: v }).error;
  assert(
    '[2l2] the answer file url accepts an http(s) url and a relative media path',
    accepted('https://host/storage/uploads/a.jpg') &&
      accepted('uploads/abc.jpg') &&
      accepted('http://host/a.pdf')
  );
  assert(
    '[2l3] the answer file url rejects a path traversal and a non-http scheme',
    !accepted('../../etc/passwd') &&
      !accepted('javascript:alert(1)') &&
      !accepted('')
  );
}
assert(
  '[2m] the document-request events are real notification types',
  /'DOCUMENT_REQUESTED'/.test(notificationModelText) &&
    /'DOCUMENT_SUBMITTED'/.test(notificationModelText) &&
    /'DOCUMENT_REVIEWED'/.test(notificationModelText) &&
    /realEstateDocumentRequested/.test(fcmText) &&
    /realEstateDocumentSubmitted/.test(fcmText) &&
    /realEstateDocumentReviewed/.test(fcmText)
);

// ------------------------------------- [3] the portal screens themselves

const dialogStatusTs = read(path.join(PORTAL, 'dialog-application-status/dialog-application-status.ts'));
const dialogStatusHtml = read(
  path.join(PORTAL, 'dialog-application-status/dialog-application-status.html')
);
const dialogRequestTs = read(
  path.join(PORTAL, 'dialog-document-request/dialog-document-request.ts')
);
const dialogRequestHtml = read(
  path.join(PORTAL, 'dialog-document-request/dialog-document-request.html')
);
const applicationDetailTs = read(path.join(PORTAL, 'application-detail/application-detail.ts'));
const applicationDetailHtml = read(
  path.join(PORTAL, 'application-detail/application-detail.html')
);
const applicationsTs = read(path.join(PORTAL, 'applications/applications.ts'));
const applicationsHtml = read(path.join(PORTAL, 'applications/applications.html'));
const commissionsTs = read(path.join(PORTAL, 'commissions/commissions.ts'));
const commissionsHtml = read(path.join(PORTAL, 'commissions/commissions.html'));
const offerFormTs = read(path.join(PORTAL, 'offer-form/offer-form.ts'));
const offerFormHtml = read(path.join(PORTAL, 'offer-form/offer-form.html'));
const dialogOfferTs = read(
  path.join(PORTAL, 'dialog-offer-create/dialog-offer-create.ts')
);

assert(
  '[3a] the application-status dialog exists and renders the timeline',
  /DialogApplicationStatus/.test(dialogStatusTs) &&
    /status-history/.test(dialogStatusTs) &&
    /document-requests/.test(dialogStatusTs) &&
    /matColumnDef="status"/.test(dialogStatusHtml)
);
assert(
  '[3b] the document-request dialog exists and collects a category and a title',
  /DialogDocumentRequest/.test(dialogRequestTs) &&
    /DOCUMENT_REQUEST_CATEGORIES/.test(dialogRequestTs) &&
    /bank_document_request_submit/.test(dialogRequestHtml)
);
assert(
  '[3c] the application detail opens both dialogs',
  /openStatusDialog/.test(applicationDetailTs) &&
    /openDocumentRequestDialog/.test(applicationDetailTs) &&
    /DialogApplicationStatus/.test(applicationDetailTs) &&
    /DialogDocumentRequest/.test(applicationDetailTs)
);
assert(
  '[3d] the application detail shows the document requests it can review',
  /reviewDocument/.test(applicationDetailTs) &&
    /bank_document_requests_title/.test(applicationDetailHtml)
);

// ------------------------------------------- [4] the portal defect fixes

assert(
  '[4a] the applications list links to the detail screen (it was a dead end)',
  /routerLink/.test(applicationsHtml) && /bank-team\/u\/applications/.test(applicationsHtml)
);
assert(
  '[4b] the queue opens the same sanction / reject / disburse dialogs as the detail screen',
  /DialogSanction/.test(applicationsTs) &&
    /DialogReject/.test(applicationsTs) &&
    /DialogDisburse/.test(applicationsTs)
);
assert(
  '[4c] the queue no longer auto-fills a sanction amount behind the banker\'s back',
  !/body\.sanctionedAmount = row\.requestedAmount/.test(applicationsTs)
);
assert(
  '[4d] a rejection from the queue carries a reason',
  /rejectionReason: result\.rejectionReason/.test(applicationsTs)
);
assert(
  '[4e] the commissions page no longer divides rupees by 100',
  !/\(paise \/ 100\)/.test(commissionsTs) &&
    /Number\(rupees\)\.toLocaleString\('en-IN'\)/.test(commissionsTs)
);
assert(
  '[4f] the commissions page shows the frozen rule snapshot it promises',
  /ruleSummary/.test(commissionsTs) && /ruleSummary\(element\)/.test(commissionsHtml)
);
assert(
  '[4g] the offer form defaults the amount from the requested amount, not a field that does not exist',
  /selectedApplication\.requestedAmount/.test(offerFormTs) &&
    !/selectedApplication\.loanAmount/.test(offerFormTs)
);
assert(
  '[4h] the offer surfaces carry the "other terms" the API already accepts',
  /otherTerms/.test(offerFormTs) &&
    /th_other_terms/.test(offerFormHtml) &&
    /otherTerms/.test(dialogOfferTs)
);
assert(
  '[4i] the portal reads the id defensively (_id or id), never one shape only',
  /row\?\._id \|\| row\?\.id/.test(applicationsTs) &&
    /row\?\._id \|\| row\?\.id/.test(offerFormTs)
);

// -------------------------------------------- [5] the money edge (paise)

const bankListBlock = bankControllerText.slice(
  bankControllerText.indexOf('const listApplications'),
  bankControllerText.indexOf('const getApplication')
);
assert(
  '[5a] the bank application list is hydrated, so money arrives in rupees',
  /toObject\(\{ getters: true \}\)/.test(bankListBlock) &&
    !/\.lean\(\)/.test(bankListBlock),
  'no .lean() in the list read'
);
const bankDetailBlock = bankControllerText.slice(
  bankControllerText.indexOf('const getApplication ='),
  bankControllerText.indexOf('const getApplicationStatusHistory')
);
assert(
  '[5b] the bank application detail is hydrated too (it used to ship paise)',
  /toObject\(\{ getters: true \}\)/.test(bankDetailBlock) &&
    !/\.lean\(\)/.test(bankDetailBlock),
  'no .lean() in the detail read'
);
assert(
  '[5c] the bank list joins the customer and the property',
  /populate\('customer'/.test(bankListBlock) && /populate\('property'/.test(bankListBlock)
);
assert(
  '[5d] the bank sees the income the loan was priced against',
  /populate\('loanRequest'/.test(bankControllerText)
);
assert(
  '[5e] the customer count is a real count, not a hard-coded 1',
  !/applicationCount: 1, latestStatus/.test(bankControllerText) &&
    /row\.applicationCount \+= 1/.test(bankControllerText)
);

// ------------------------------------------- [6] the customer-side surface

const customerLoanDetail = read(
  path.join(CUSTOMER_PAGES, 'loan_application_detail.dart')
);
const customerRepo = read(
  path.join(CUSTOMER_ROOT, 'lib/app/core/repositories/real_estate_repository.dart')
);
const customerModels = read(
  path.join(CUSTOMER_ROOT, 'lib/app/core/models/real_estate_property_model.dart')
);
const customerL10n = read(
  path.join(CUSTOMER_PAGES, 'real_estate_l10n.dart')
);

assert(
  '[6a] the customer loan screen lists the document requests',
  /myDocumentRequests/.test(customerRepo) &&
    /re_doc_requests_title/.test(customerLoanDetail)
);
assert(
  '[6b] the customer can answer a request with an uploaded file',
  /uploadDocumentFile/.test(customerRepo) &&
    /submitDocumentRequest/.test(customerRepo) &&
    /_answer\(/.test(customerLoanDetail)
);
assert(
  '[6c] the customer model parses a document request',
  /class DocumentRequestModel/.test(customerModels) &&
    /needsAnswer/.test(customerModels)
);
assert(
  '[6d] the document-request statuses are localized',
  /documentRequestStatus/.test(customerL10n)
);

// ------------------------------------------------------------------- report

let failed = 0;
console.log('Bank portal parity — gate');
console.log('==========================');
for (const c of checks) {
  const mark = c.ok ? 'OK  ' : 'FAIL';
  console.log(`  [${mark}] ${c.label}${c.detail ? '  — ' + c.detail : ''}`);
  if (!c.ok) failed += 1;
}
console.log('');
if (failed) {
  console.log(`${failed} of ${checks.length} checks FAILED`);
  process.exit(1);
}
console.log(`ALL ${checks.length} BANK PORTAL CHECKS PASSED`);
