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

const express = require('express');
const authRoute = require('./auth.route');
const userRoute = require('./user.route');
const adminRoute = require('./admin.route');
const fileRoute = require('./file.route');
const driverRoute = require('./driver.route');
const publicRoute = require('./public.route');
const vendorRoute = require('./vendor.route');
const vendorWebRoute = require('./vendor_web.route');
const waiterRoute = require('./waiter.route');
const accontantRoute = require('./accountant.route');
const supportTeamRoute = require('./support.team.route');
const cityZenRoute = require('./cityzen.route');
const kitchenRoute = require('./kitchen.route');
const dairyRoute = require('../../modules/dairy/routes/dairy.route');
const storesRoute = require('../../modules/stores/routes/stores.route');
const storesAdminRoute = require('../../modules/stores/routes/stores.admin.route');
const headerBannerAdminRoute = require('../../modules/header-banner/routes/header.banner.admin.route');
// Jhatka. Route FILES are named per §15.1 of the plan — `jhatka.<actor>.route.js`.
// The MOUNT PATHS are per §15.2: one surface per actor.
//
// `/jhatka/customer` (not `/jhatka/orders`) — the earlier mount put customer
// order endpoints at the actor-less `/jhatka/orders`, which gave the customer
// surface no actor prefix and left nowhere to hang the cart, subscription and
// complaint routes §15.2 lists alongside it.
//
// `/jhatka/partner` is mounted ONCE. It was previously mounted twice — once for
// jhatka.routes.partner.js and again for jhatka.routes.labels.js — and Express
// does not complain about a repeated `use()`; the second mount is simply dead for
// any path the first one answered, which is the §15.1 shadowing trap.
const jhatkaPublicRoute = require('../../modules/jhatka/routes/jhatka.public.route');
const jhatkaCustomerRoute = require('../../modules/jhatka/routes/jhatka.customer.route');
const jhatkaCatalogueRoute = require('../../modules/jhatka/routes/jhatka.catalogue.route');
const jhatkaPartnerRoute = require('../../modules/jhatka/routes/jhatka.partner.route');
const jhatkaPartnerOrdersRoute = require('../../modules/jhatka/routes/jhatka.partner.orders.route');
const jhatkaPartnerSubscriptionsRoute = require('../../modules/jhatka/routes/jhatka.partner.subscriptions.route');
const jhatkaPartnerInventoryRoute = require('../../modules/jhatka/routes/jhatka.partner.inventory.route');
const jhatkaPartnerMoneyRoute = require('../../modules/jhatka/routes/jhatka.partner.money.route');
const jhatkaPartnerComplianceRoute = require('../../modules/jhatka/routes/jhatka.partner.compliance.route');
const jhatkaPartnerLabelsRoute = require('../../modules/jhatka/routes/jhatka.partner.labels.route');
const jhatkaDriverRoute = require('../../modules/jhatka/routes/jhatka.driver.route');
const jhatkaAdminTaxonomyRoute = require('../../modules/jhatka/routes/jhatka.admin.taxonomy.route');
const jhatkaAdminOutletsRoute = require('../../modules/jhatka/routes/jhatka.admin.outlets.route');
const jhatkaAdminSuppliersRoute = require('../../modules/jhatka/routes/jhatka.admin.suppliers.route');
const jhatkaAdminInventoryRoute = require('../../modules/jhatka/routes/jhatka.admin.inventory.route');
const jhatkaAdminOperationsRoute = require('../../modules/jhatka/routes/jhatka.admin.operations.route');
const jhatkaAdminSettlementsRoute = require('../../modules/jhatka/routes/jhatka.admin.settlements.route');
const jhatkaAdminOrdersRoute = require('../../modules/jhatka/routes/jhatka.admin.orders.route');
const jhatkaAdminComplianceRoute = require('../../modules/jhatka/routes/jhatka.admin.compliance.route');
const reelRoute = require('./reel.route');
const socialRoute = require('../../modules/social/routes/social.route');
const reelsAdminRoute = require('../../modules/reels/routes/reels.admin.route');
const realEstatePublicRoute = require('../../modules/realestate/routes/realestate.public.route');
const realEstateCustomerRoute = require('../../modules/realestate/routes/realestate.customer.route');
const realEstateVendorRoute = require('../../modules/realestate/routes/realestate.vendor.route');
const realEstateExecutiveRoute = require('../../modules/realestate/routes/realestate.executive.route');
const realEstateAdminRoute = require('../../modules/realestate/routes/realestate.admin.route');
const realEstateBankRoute = require('../../modules/realestate/routes/realestate.bank.route');

const router = express.Router();

const defaultRoutes = [
  {
    path: '/auth',
    route: authRoute,
  },
  {
    path: '/users',
    route: userRoute,
  },
  {
    path: '/admin',
    route: adminRoute,
  },
  {
    path: '/vendor',
    route: vendorRoute,
  },
  {
    path: '/vendor_web',
    route: vendorWebRoute,
  },
  {
    path: '/driver',
    route: driverRoute,
  },
  {
    path: '/file',
    route: fileRoute,
  },
  {
    path: '/public',
    route: publicRoute,
  },
  {
    path: '/waiter',
    route: waiterRoute,
  },
  {
    path: '/accountant',
    route: accontantRoute,
  },
  {
    path: '/support_team',
    route: supportTeamRoute,
  },
  {
    path: '/cityzen',
    route: cityZenRoute,
  },
  {
    path: '/kitchen',
    route: kitchenRoute,
  },
{
    path: '/dairy',
    route: dairyRoute,
  },
  {
    path: '/stores',
    route: storesRoute,
  },
  // Local-services is mid-scaffold (its tree has landed incomplete more
  // than once, taking down the whole boot). Load opportunistically: the
  // mount is skipped with a warning when the module is ABSENT, and returns
  // on its own the moment the tree is back — no other vertical is affected.
  // Any other error (syntax error, bad import inside the module) still
  // throws, so real breakage stays loud.
  ...(() => {
    try {
      return [{ path: '/local-services', route: require('../../modules/local-services') }];
    } catch (e) {
      if (!e || e.code !== 'MODULE_NOT_FOUND') throw e;
      console.warn(
        '[routes/v1] local-services module absent — /local-services unmounted until it lands.'
      );
      return [];
    }
  })(),
  // ---- Jhatka (fresh meat vertical) ----------------------------------------
  //
  // ORDER IS LOAD-BEARING. §15.1: "Literal segments before `:param` siblings,
  // always. Express matches in registration order."
  //
  // `/jhatka/partner` (the bare actor mount, which answers `/outlets`,
  // `/session/outlet`, `/scope`) is registered BEFORE the seven sub-paths below
  // it. It has no `/:id` route today, so the order is currently harmless — but
  // the moment someone adds `router.get('/:id')` to jhatka.partner.route.js it
  // silently swallows every sub-path, and the failure looks like a 404 from the
  // wrong router rather than a mount-order bug. `/recalls` is listed BEFORE
  // `/batches` for the same reason: it is a literal that would otherwise be
  // captured by a future `/batches/:batch`.
  //
  // KNOWN SHADOWING, not yet fixed: INSIDE jhatka.partner.inventory.route.js,
  // `GET /:id` is declared before `GET /batches` and `GET /recalls`, so those two
  // literals are unreachable and a request to either is read as `id: 'batches'`.
  // `node scripts/list.jhatka.routes.js` reports it. It is fixed when that file
  // is rewritten against the real schemas; the route carries a banner saying so.
  {
    path: '/jhatka/public',
    route: jhatkaPublicRoute,
  },
  {
    path: '/jhatka/catalogue',
    route: jhatkaCatalogueRoute,
  },
  {
    path: '/jhatka/customer',
    route: jhatkaCustomerRoute,
  },
  // ---- Jhatka admin (B1) ----------------------------------------------------
  //
  // Mounted at `/jhatka/admin`, `webAuth('jhatka_*')` — NOT `jhatkaAuth`, because
  // admin is cross-outlet and has no single outlet to scope tenancy against. That is
  // the whole distinction: `jhatkaAuth` exists to confine a request to ONE outlet, and
  // an admin console is deliberately not confined.
  //
  // Each admin FILE mounts separately so the eight can grow independently. Currently
  // two of eight exist (taxonomy, outlets); the vertical suite asserts the set that
  // is present rather than the set that was planned.
  {
    path: '/jhatka/admin',
    route: jhatkaAdminTaxonomyRoute,
  },
{
    path: '/jhatka/admin',
    route: jhatkaAdminOutletsRoute,
  },
  {
    path: '/jhatka/admin',
    route: jhatkaAdminSuppliersRoute,
  },
  {
    path: '/jhatka/admin',
    route: jhatkaAdminInventoryRoute,
  },
  {
    path: '/jhatka/admin',
    route: jhatkaAdminOperationsRoute,
  },
  {
    path: '/jhatka/admin',
    route: jhatkaAdminSettlementsRoute,
  },
  {
    path: '/jhatka/admin',
    route: jhatkaAdminOrdersRoute,
  },
  {
    path: '/jhatka/admin',
    route: jhatkaAdminComplianceRoute,
  },
  // Bare actor mount FIRST among the partner family — see the order note above.
  {
    path: '/jhatka/partner',
    route: jhatkaPartnerRoute,
  },
  {
    path: '/jhatka/partner/orders',
    route: jhatkaPartnerOrdersRoute,
  },
  {
    path: '/jhatka/partner/subscriptions',
    route: jhatkaPartnerSubscriptionsRoute,
  },
  {
    path: '/jhatka/partner/inventory',
    route: jhatkaPartnerInventoryRoute,
  },
  {
    path: '/jhatka/partner/money',
    route: jhatkaPartnerMoneyRoute,
  },
  {
    path: '/jhatka/partner/compliance',
    route: jhatkaPartnerComplianceRoute,
  },
  // Labels last: it is the only partner sub-path with no `/:id` sibling, so it
  // cannot shadow anything, but it also cannot shadow anything itself.
  {
    path: '/jhatka/partner/labels',
    route: jhatkaPartnerLabelsRoute,
  },
  {
    path: '/jhatka/driver',
    route: jhatkaDriverRoute,
  },
  {
    path: '/reels',
    route: reelRoute,
  },
  {
    path: '/social',
    route: socialRoute,
  },
  // Reels admin publishing — mounted AFTER `/admin` on the same fall-through
  // basis as `/admin/stores` (see note there). Kept out of admin.route.js per
  // the dairy precedent. Every route carries webAuth rights (docs §15).
  {
    path: '/admin/reels',
    route: reelsAdminRoute,
  },
  // Real Estate public browsing. Guest-accessible on purpose — a customer searches
  // before signing in, so these carry no auth middleware. Only `/properties` and its
  // siblings return data, and the service hardcodes `status: PUBLISHED` into every
  // filter. See realestate.public.route.js.
  {
    path: '/realestate/public',
    route: realEstatePublicRoute,
  },
  // Real Estate customer routes — enquiries and the customer's own leads. `appAuth()`
  // on every route, so the customer id always comes from the token.
  {
    path: '/realestate/customer',
    route: realEstateCustomerRoute,
  },
  // Real Estate vendor routes — authenticated vendor, tenant resolved from the token.
  {
    path: '/realestate/vendor',
    route: realEstateVendorRoute,
  },
  // Real Estate executive routes. `executiveAuth` resolves the actor from the token and
  // 403s a vendor session, so the two roles stay mutually exclusive even though both
  // live in the Partner app.
  {
    path: '/realestate/executive',
    route: realEstateExecutiveRoute,
  },
  // Real Estate admin routes. Separate from the vendor file because every route here
  // carries a webAuth rights string — see realestate.admin.route.js on DEFECT-2.
  {
    path: '/realestate/admin',
    route: realEstateAdminRoute,
  },
  // Real Estate bank routes. `bankAuth` on every route — the bank is
  // resolved from the token, never from a URL param. SANCTIONED /
  // REJECTED / DISBURSED live ONLY here (BR-10).
  {
    path: '/realestate/bank',
    route: realEstateBankRoute,
  },
  // Mounted AFTER `/admin` on purpose. Express falls through a router when nothing
  // matches, so `/admin/stores/*` reaches here — which is only true because
  // admin.route.js has no catch-all. See stores.admin.route.js for the full note.
{
    path: '/admin/stores',
    route: storesAdminRoute,
  },
  // Header banner ("Silver App Bar" + promotional banner slot). Mounted AFTER
  // `/admin` for the same fall-through reason as `/admin/stores` — admin.route.js
  // has no catch-all, so `/admin/header-banner/*` reaches this router.
  {
    path: '/admin/header-banner',
    route: headerBannerAdminRoute,
  },
];

defaultRoutes.forEach((route) => {
  router.use(route.path, route.route);
});

module.exports = router;
