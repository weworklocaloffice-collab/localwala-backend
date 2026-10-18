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

module.exports.Token = require('./token.model');
module.exports.User = require('./user.model');
module.exports.Visitor = require('./visitor.model');
module.exports.Country = require('./country.model');
module.exports.City = require('./city.model');
module.exports.Locality = require('./locality.model');
module.exports.Cuisine = require('./cuisine.model');
module.exports.Media = require('./media.model');
module.exports.Language = require('./languages.model');
module.exports.Subscriptions = require('./subscriptions.model');
module.exports.Wallet = require('./wallet.model');
module.exports.Transactions = require('./transactions.model');
module.exports.RestaurantType = require('./restaurant.type.model');
module.exports.RestaurantFacility = require('./restaurant.facilities.model');
module.exports.Restaurant = require('./restaurant.model');
module.exports.Category = require('./category.model');
module.exports.SubCategory = require('./sub.category.model');
module.exports.Vehicle = require('./vehicle.model');
module.exports.Driver = require('./driver.model');
module.exports.RestaurantCampaign = require('./restaurant.campaign.model');
module.exports.Addons = require('./addons.model');
module.exports.VendorCategory = require('./vendor.category.model');
module.exports.VendorSubCategory = require('./vendor.sub.category.model');
module.exports.Food = require('./food.model');
module.exports.Subscriber = require('./subscriber.model');
module.exports.FoodCampaign = require('./food.campaign.model');
module.exports.BusinessSettings = require('./bussiness.settings.model');
module.exports.OrderSettings = require('./order.settings.model');
module.exports.OrderCancellationReason = require('./order.cancellation.reason.model');
module.exports.RefundRequestReason = require('./refund.request.reason.model');
module.exports.UserSettings = require('./user.settings.model');
module.exports.RestaurantSettings = require('./restaurant.settings.model');
module.exports.DriverSettings = require('./driver.settings.model');
// Dairy platform settings, behind the `dairy_settings` tab in Business Setup.
module.exports.DairySettings = require('./dairy.settings.model');
module.exports.Disbursement = require('./disbursement.model');
module.exports.AppPage = require('./app.pages.model');
module.exports.RestaurantCampaignRequest = require('./restaurant.campaign.request.model');
module.exports.FoodCampaignRequest = require('./food.campaign.request.model');
module.exports.Banner = require('./banners.model');
module.exports.AppWebSetting = require('./app.web.settings.model');
module.exports.EmailConfig = require('./email.config.model');
module.exports.EmailTemplate = require('./email.templates.model');
module.exports.OtpVerification = require('./otp.verification.model');
module.exports.ReferralCode = require('./referral.codes.model');
module.exports.RedeemReferral = require('./redeem.referral.model');
module.exports.RestaurantFoodLicense = require('./restaurant.food.license.model');
module.exports.PaymentConfig = require('./payment.config.model');
module.exports.Favourite = require('./favourite.model');
module.exports.GuestUserInfo = require('./guest.user.info.model');
module.exports.UserAddress = require('./user.address.model');
module.exports.DeliveryInstruction = require('./delivery.instructions.model');
module.exports.DeliveryGratitude = require('./delivery.gratitude.model');
module.exports.DeliveryZone = require('./delivery.zone.model');
module.exports.DeliveryZoneHistory = require('./delivery.zone.history.model');
module.exports.Coupon = require('./coupons.model');
module.exports.CartItem = require('./cart.item.model');
module.exports.Orders = require('./orders.model');
module.exports.PaymentInitiation = require('./payment.initiation.model');
module.exports.DriverIncentive = require('./driver.incentive.model');
module.exports.PushNotificationToken = require('./push.notitication.token.model');
module.exports.DriverOfflineMessages = require('./driver.offline.messages.model');
module.exports.DriverNewOrderStatus = require('./driver.new.order.status.model');
module.exports.OrderNotificationTranslation = require('./order.notification.translation.model');
module.exports.OrderDeliveryProof = require('./order.delivery.proof.model');
module.exports.LoyaltyPoints = require('./loyalty.points.model');
module.exports.RefundRequest = require('./refund.request.model');
module.exports.ComplaintsReason = require('./complaints.reason.model');
module.exports.Complaints = require('./complaints.model');
module.exports.SmsProviderConfig = require('./sms.providers.config.model');
module.exports.HideRestaurant = require('./hide.restaurant.model');
module.exports.ReportIssueRestaurantReason = require('./report.issue.restaurant.reason.model');
module.exports.ReportIssueRestaurant = require('./report.issue.restaurant.model');
module.exports.HideRestaurantReason = require('./hide.restaurant.reason.model');
module.exports.FavouriteOrder = require('./favourite.orders.model');
module.exports.OrderRatingMessages = require('./order.ratings.messages.model');
module.exports.RestaurantOrderReview = require('./restaurant.order.reviews.model');
module.exports.FoodOrderReview = require('./food.order.review');
module.exports.DriverOrderReview = require('./driver.order.review.model');
module.exports.NotificationList = require('./notification.list.model');
module.exports.RestaurantNotice = require('./restaurant.notice.model');
module.exports.SubscriptionTiffinPackage = require('./subscription.tiffine.package.model');
module.exports.UserPurchasedTiffinSubscription = require('./user.purchased.tiffin.subscription.model');
module.exports.CronJobScheduler = require('./cron.job.scheduler.model');
module.exports.TiffinSubscriptionCancellationReason = require('./tiffin.subscription.cancellation.reason.model');
module.exports.TiffinSubscriptionRefundRequestReason = require('./tiffin.subscription.refund.request.reason.model');
module.exports.TiffinSubscriptionRefundRequest = require('./tiffin.subscription.refund.request.model');
module.exports.DiningSetting = require('./dining.settings.model');
module.exports.DiningCancellationReason = require('./dining.cancellation.reason.model');
module.exports.DiningCategory = require('./dining.category.model');
module.exports.DiningtNotice = require('./dining.notice.model');
module.exports.DiningCampaign = require('./dining.campaign.model');
module.exports.DiningCampaignRequest = require('./dining.campaign.request.model');
module.exports.RestaurantExtraDetail = require('./restaurant.extra.details.model');
module.exports.DiningCoupon = require('./dining.coupons.model');
module.exports.DiningBooking = require('./dining.booking.model');
module.exports.DiningBookingRefundRequestReason = require('./dining.booking.refund.request.reason.model');
module.exports.DiningBookingRefundRequest = require('./dining.booking.refund.request.model');
module.exports.ChatRoom = require('./chat.room.model');
module.exports.ChatConversion = require('./chat.conversion.model');
module.exports.FeedbackForm = require('./feedback.form.model');
module.exports.ReportEmergencyForm = require('./report.emergency.form.model');
module.exports.UserAvatar = require('./user.avatar.model');
module.exports.SocialSignin = require('./social.signin.model');
module.exports.FoodTaxation = require('./food.taxation.model');
module.exports.RestaurantComplaints = require('./restaurant.complaints.model');
module.exports.Waiter = require('./waiter.model');
module.exports.WaiterSettings = require('./waiter.settings.model');
module.exports.RestaurantTable = require('./restaurant.table.model');
module.exports.RestaurantCashInHand = require('./restaurant.cash.in.hand.model');
module.exports.DeliverymanCashInHand = require('./deliveryman.cash.in.hand.model');
module.exports.CollectCash = require('./collect.cash.model');
module.exports.WithdrawalMethod = require('./withdrawal.methods.model');
module.exports.RestaurantPayoutMethod = require('./restaurant.payout.method.model');
module.exports.WithdrawalRequest = require('./withdrawal.request.model');
module.exports.DeliverymanPayoutMethod = require('./deliveryman.payout.method.model');
module.exports.PosOrTableOrder = require('./pos.or.table.order.model');
module.exports.TableOrderCartItem = require('./table.order.cart.item.model');
module.exports.TableOrder = require('./table.order.model');
module.exports.JoiningForm = require('./joining.form.model');
module.exports.RestaurantJoiningRequest = require('./restaurant.joining.request.model');
module.exports.DeliverymanJoiningRequest = require('./deliveryman.joining.request.model');
module.exports.InvoiceInstruction = require('./invoice.instruction.model');
module.exports.WalletBonus = require('./wallet.bonus.model');
module.exports.RestaurantPosTableOrderCommission = require('./restaurant.pos.table.order.commission.model');
module.exports.DeliveryShiftSchedule = require('./deliveryman.shift.schedule.model');
module.exports.AdminExpense = require('./admin.expense.model');
module.exports.RestaurantExpense = require('./restaurant.expense.model');
module.exports.DisbursementData = require('./disbursement.data.model');
module.exports.RestaurantDisbursement = require('./restaurant.disbursement.model');
module.exports.DeliverymanDisbursement = require('./deliveryman.disbursement.model');
module.exports.SupportChatRoom = require('./support.chat.room.model');
module.exports.SupportChatConversion = require('./support.chat.conversion.model');
module.exports.UserDeleteAccountReason = require('./user.delete.account.reason.model');
module.exports.DeletedUserAccount = require('./deleted.user.account.model');
module.exports.UserNotificationSetting = require('./user.notification.setting.model');
module.exports.DeletedWaiterAccount = require('./deleted.waiter.account.model');
module.exports.DeletedDeliverymanAccount = require('./deleted.deliveryman.account.model');
module.exports.DeletedRestaurantAccount = require('./deleted.restaurant.account.model');
module.exports.DeletedKitchenAccount = require('./deleted.kitchen.account.model');
module.exports.KitchenOwner = require('./kitchen.owner.model');
module.exports.KitchenOwnerSetting = require('./kitchen.owner.setting.model');
module.exports.KitchenOrder = require('./kitchen.order.model');
module.exports.MediaStorageSetting = require('./media.storage.setting.model');
module.exports.LandingPage = require('./landing.page.model');
module.exports.OtpWebVerification = require('./otp.web.verification.model');

// Social + reels hybrid monolith (docs/social-reels-hybrid-monolith.md §12).
// Same Mongoose connection, no separate database.
module.exports.UserContactMatch = require('../modules/social/models/user.contact.match.model');
module.exports.SocialPrivacy = require('../modules/social/models/social.privacy.model');
module.exports.ReelInteraction = require('../modules/reels/models/reel.interaction.model');
module.exports.ReelView = require('../modules/reels/models/reel.view.model');
module.exports.ReelComment = require('../modules/reels/models/reel.comment.model');
module.exports.ReelReport = require('../modules/reels/models/reel.report.model');

// Kernel — vertical-agnostic shared capability
module.exports.Vertical = require('../kernel/vertical/models/vertical.model');
module.exports.Business = require('../kernel/business/models/business.model');
module.exports.DeliveryRun = require('../kernel/delivery/models/delivery.run.model');
module.exports.DeliveryStop = require('../kernel/delivery/models/delivery.stop.model');
module.exports.DeliveryPOD = require('../kernel/delivery/models/delivery.pod.model');
module.exports.DispatchAttempt = require('../kernel/dispatch/models/dispatch.attempt.model');
module.exports.OrderAssignmentEvent = require('../kernel/dispatch/models/order.assignment.event.model');
// Kernel — geography. Added for the Real Estate vertical, shared by any vertical that
// needs a service-area concept. `City`, `Locality` and `Restaurant` are deliberately
// NOT touched: `City` is referenced by 21 models and adding `state` to it is a
// platform change. See the Real Estate plan §4.2.2.
module.exports.State = require('../kernel/geographic/models/state.model');
module.exports.OperationalZone = require('../kernel/geographic/models/operational.zone.model');
module.exports.GeoBoundary = require('../kernel/geographic/models/geo.boundary.model');

// Modules — real estate vertical (Phase 2: catalogue)
module.exports.RealEstatePropertyCategory = require('../modules/realestate/models/realestate.property.category.model');
module.exports.RealEstateProperty = require('../modules/realestate/models/realestate.property.model');
module.exports.RealEstatePropertyDocument = require('../modules/realestate/models/realestate.property.document.model');
module.exports.RealEstatePropertyVerification = require('../modules/realestate/models/realestate.property.verification.model');

// Real estate audit trail (BR-20, F-2). Registered alongside the catalogue models because it
// spans all of them — an audit row points at a property, an order, an entitlement or a lead.
module.exports.RealEstateAuditLog = require('../modules/realestate/models/realestate.audit.log.model');

// Real estate financial core (Batch 2, Phase 7 — before holds). Append-only ledger,
// versioned commission rules, frozen commissions, ledger-based settlements.
module.exports.RealEstateLedgerEntry = require('../modules/realestate/models/realestate.ledger.entry.model');
module.exports.RealEstateCommissionRule = require('../modules/realestate/models/realestate.commission.rule.model');
module.exports.RealEstateCommission = require('../modules/realestate/models/realestate.commission.model');
module.exports.RealEstateSettlement = require('../modules/realestate/models/realestate.settlement.model');

// Real estate holds + sale (Batch 3, Phase 8). Policy versioned, hold
// carries the BR-12 partial unique, sale converts holds to consideration.
module.exports.RealEstateHoldPolicy = require('../modules/realestate/models/realestate.hold.policy.model');
module.exports.RealEstatePropertyHold = require('../modules/realestate/models/realestate.property.hold.model');
module.exports.RealEstateHoldPayment = require('../modules/realestate/models/realestate.hold.payment.model');
module.exports.RealEstateHoldRefund = require('../modules/realestate/models/realestate.hold.refund.model');
module.exports.RealEstateSale = require('../modules/realestate/models/realestate.sale.model');

// Real estate bank + loans (Batch 4, Phase 9). Bank sees only its own
// leads; SANCTIONED/REJECTED/DISBURSED are bank-only (BR-10).
module.exports.RealEstateBank = require('../modules/realestate/models/realestate.bank.model');
module.exports.RealEstateBankMember = require('../modules/realestate/models/realestate.bank.member.model');
module.exports.RealEstateBankAgreement = require('../modules/realestate/models/realestate.bank.agreement.model');
module.exports.RealEstateLoanRequest = require('../modules/realestate/models/realestate.loan.request.model');
module.exports.RealEstateLoanApplication = require('../modules/realestate/models/realestate.loan.application.model');
module.exports.RealEstateBankOffer = require('../modules/realestate/models/realestate.bank.offer.model');

// Real estate remainder (Batch 5, Phase 10). Vendor docs, notifications,
// promotions (deferred F-20), daily stats (F-19).
module.exports.RealEstateVendorDocument = require('../modules/realestate/models/realestate.vendor.document.model');
module.exports.RealEstateNotification = require('../modules/realestate/models/realestate.notification.model');
module.exports.RealEstatePropertyPromotion = require('../modules/realestate/models/realestate.property.promotion.model');
module.exports.RealEstatePropertyDailyStat = require('../modules/realestate/models/realestate.property.daily.stat.model');
module.exports.RealEstateSetting = require('../modules/realestate/models/realestate.setting.model');

// Modules — dairy vertical
module.exports.DairyDriver = require('../modules/dairy/models/dairy.driver.model');
module.exports.DairyDriverInvite = require('../modules/dairy/models/dairy.driver.invite.model');
module.exports.DairyNotification = require('../modules/dairy/models/dairy.notification.model');
module.exports.DairyJoiningRequest = require('../modules/dairy/models/dairy.joining.request.model');
module.exports.DairyCan = require('../modules/dairy/models/dairy.can.model');
module.exports.DairyCanLedger = require('../modules/dairy/models/dairy.can.ledger.model');
module.exports.DairyContainerAssignment = require('../modules/dairy/models/dairy.container.assignment.model');
module.exports.DairySku = require('../modules/dairy/models/dairy.sku.model');
module.exports.DairyCategory = require('../modules/dairy/models/dairy.category.model');
module.exports.DairySubCategory = require('../modules/dairy/models/dairy.sub.category.model');
module.exports.DairyBrand = require('../modules/dairy/models/dairy.brand.model');
module.exports.DairyProduct = require('../modules/dairy/models/dairy.product.model');
module.exports.DairySubscription = require('../modules/dairy/models/dairy.subscription.model');
module.exports.DairySubscriptionEvent = require('../modules/dairy/models/dairy.subscription.event.model');
module.exports.DairyRecurringOrder = require('../modules/dairy/models/dairy.recurring.order.model');
module.exports.DairyCartItem = require('../modules/dairy/models/dairy.cart.item.model');
module.exports.DairyOrder = require('../modules/dairy/models/dairy.order.model');
module.exports.DairyOrderStatusHistory = require('../modules/dairy/models/dairy.order.status.history.model');
module.exports.DairyMilkProvider = require('../modules/dairy/models/dairy.milk.provider.model');
module.exports.DairyMilkCollection = require('../modules/dairy/models/dairy.milk.collection.model');
module.exports.DairyMilkRejectionReason = require('../modules/dairy/models/dairy.milk.rejection.reason.model');
module.exports.DairyMilkBatch = require('../modules/dairy/models/dairy.milk.batch.model');
module.exports.DairyBatchLedger = require('../modules/dairy/models/dairy.batch.ledger.model');
module.exports.DairyPartner = require('../modules/dairy/models/dairy.partner.model');
module.exports.DairyFranchise = require('../modules/dairy/models/dairy.franchise.model');
module.exports.DairySettlement = require('../modules/dairy/models/dairy.settlement.model');
module.exports.DairyCompliance = require('../modules/dairy/models/dairy.compliance.model');
module.exports.DairyProviderPayable = require('../modules/dairy/models/dairy.provider.payable.model');

// Modules — stores vertical
module.exports.StoreChain = require('../modules/stores/models/store.chain.model');
module.exports.StoreOutlet = require('../modules/stores/models/store.outlet.model');
module.exports.StoreSubscription = require('../modules/stores/models/store.subscription.model');
module.exports.StoreRoleAssignment = require('../modules/stores/models/store.role.assignment.model');
module.exports.StoreOnboarding = require('../modules/stores/models/store.onboarding.model');
module.exports.StoreComplianceDocument = require('../modules/stores/models/store.compliance.document.model');
module.exports.TaxConfiguration = require('../modules/stores/models/tax.configuration.model');
module.exports.StoreCategory = require('../modules/stores/models/store.category.model');
module.exports.StoreSubcategory = require('../modules/stores/models/store.subcategory.model');
module.exports.StoreAttributeTemplate = require('../modules/stores/models/store.attribute.template.model');
module.exports.StoreBrand = require('../modules/stores/models/store.brand.model');
module.exports.StoreProduct = require('../modules/stores/models/store.product.model');
module.exports.StoreProductVariant = require('../modules/stores/models/store.product.variant.model');
module.exports.StoreOutletProduct = require('../modules/stores/models/store.outlet.product.model');
module.exports.ChainProduct = require('../modules/stores/models/chain.product.model');
module.exports.ChainProductVariant = require('../modules/stores/models/chain.product.variant.model');
module.exports.StoreOutletStockItem = require('../modules/stores/models/store.outlet.stock.item.model');
module.exports.StoreInventoryMovement = require('../modules/stores/models/store.inventory.movement.model');
module.exports.StoreStockReservation = require('../modules/stores/models/store.stock.reservation.model');
module.exports.StoreOrder = require('../modules/stores/models/store.order.model');
module.exports.StoreSubscription = require('../modules/stores/models/store.subscription.model');
module.exports.StoreSubscriptionPlan = require('../modules/stores/models/store.subscription.plan.model');
module.exports.StoreSubscriptionPayment = require('../modules/stores/models/store.subscription.payment.model');
module.exports.StoreDelivery = require('../modules/stores/models/store.delivery.model');
module.exports.StoreDriver = require('../modules/stores/models/store.driver.model');
module.exports.StoreDriverVehicle = require('../modules/stores/models/store.driver.vehicle.model');
module.exports.StoreDriverRemittance = require('../modules/stores/models/store.driver.remittance.model');
module.exports.StoreReturnRequest = require('../modules/stores/models/store.return.request.model');
module.exports.StoreExchangeRequest = require('../modules/stores/models/store.exchange.request.model');
module.exports.StoreWarrantyRequest = require('../modules/stores/models/store.warranty.request.model');
module.exports.StorePromotion = require('../modules/stores/models/store.promotion.model');
module.exports.StorePolicy = require('../modules/stores/models/store.policy.model');
module.exports.StoreReview = require('../modules/stores/models/store.review.model');
module.exports.StoreComplaint = require('../modules/stores/models/store.complaint.model');
module.exports.StoreCancellation = require('../modules/stores/models/store.cancellation.model');
module.exports.StoreCancellationAttempt = require('../modules/stores/models/store.cancellation.attempt.model');
module.exports.Settlement = require('../kernel/settlement/models/settlement.model');
module.exports.SettlementItem = require('../kernel/settlement/models/settlement.item.model');
module.exports.StoreCart = require('../modules/stores/models/store.cart.model');
module.exports.StoreRefund = require('../modules/stores/models/store.refund.model');
module.exports.StoreOrganicVerification = require('../modules/stores/models/store.organic.verification.model');
module.exports.StoreFeaturedPlacement = require('../modules/stores/models/store.featured.placement.model');
module.exports.StoreRecurringPlan = require('../modules/stores/models/store.recurring.plan.model');
module.exports.StoreCustomerSubscription = require('../modules/stores/models/store.customer.subscription.model');
module.exports.StoreRecurringOrder = require('../modules/stores/models/store.recurring.order.model');

// Modules - jhatka vertical (Phase 1, fresh meat / butcher).
//
// Registered as a flat block in DEPENDENCY order rather than alphabetically: a
// model's `ref:` strings are resolved lazily at populate time, not at load time, so
// order does not actually matter for correctness. It matters for a human reading
// this file after a MissingSchemaError, which is when they will read it.
//
// `jhatka.order.item.schema` is registered here even though its filename says
// `.schema` — it exports BOTH the `JhatkaOrderItem` model and `.schema`, because
// `JhatkaOrder` embeds the schema inside `items[]` and Mongoose rejects an array of
// models. One definition, two consumers, no drift.
//
// NOTHING above this line is modified. The kernel `Business`, `Vertical`,
// `DeliveryRun`, `DeliveryStop`, `DeliveryPOD`, `Settlement` and `SettlementItem`
// are all untouched by this vertical - see the implementation plan, which defers
// kernel settlement promotion to Phase 13.

// -- jhatka: catalogue and taxonomy -----------------------------------------
module.exports.JhatkaCategory = require('../modules/jhatka/models/jhatka.category.model');
module.exports.JhatkaProduct = require('../modules/jhatka/models/jhatka.product.model');
module.exports.JhatkaVariant = require('../modules/jhatka/models/jhatka.variant.model');
// Yield comes before variant in spirit: a prepared variant points at it. See BR-11.
module.exports.JhatkaYieldSpec = require('../modules/jhatka/models/jhatka.yield.spec.model');

// -- jhatka: partners and outlets (BR-04) -----------------------------------
module.exports.JhatkaOutlet = require('../modules/jhatka/models/jhatka.outlet.model');
module.exports.JhatkaPartner = require('../modules/jhatka/models/jhatka.partner.model');
module.exports.JhatkaFranchise = require('../modules/jhatka/models/jhatka.franchise.model');
module.exports.JhatkaPriceOverride = require('../modules/jhatka/models/jhatka.price.override.model');
// The SECOND authorization layer: what a person may do INSIDE an outlet. Kept out
// of `config/roles.js` on purpose — see `jhatka.tenant.role.assignment.model` for
// why a platform right must never imply business authority.
module.exports.JhatkaTenantRoleAssignment = require('../modules/jhatka/models/jhatka.tenant.role.assignment.model');

// -- jhatka: procurement, quality, traceability -----------------------------
module.exports.JhatkaSupplier = require('../modules/jhatka/models/jhatka.supplier.model');
module.exports.JhatkaSupplierDocument = require('../modules/jhatka/models/jhatka.supplier.document.model');
module.exports.JhatkaQualityRejectionReason = require('../modules/jhatka/models/jhatka.quality.rejection.reason.model');
module.exports.JhatkaPurchaseOrder = require('../modules/jhatka/models/jhatka.purchase.order.model');
module.exports.JhatkaProcurementReceipt = require('../modules/jhatka/models/jhatka.procurement.receipt.model');
module.exports.JhatkaBatch = require('../modules/jhatka/models/jhatka.batch.model');
module.exports.JhatkaBatchAllocation = require('../modules/jhatka/models/jhatka.batch.allocation.model');
module.exports.JhatkaCart = require('../modules/jhatka/models/jhatka.cart.model');
module.exports.JhatkaInventoryItem = require('../modules/jhatka/models/jhatka.inventory.item.model');
module.exports.JhatkaInventoryMovement = require('../modules/jhatka/models/jhatka.inventory.movement.model');
module.exports.JhatkaWastage = require('../modules/jhatka/models/jhatka.wastage.model');
module.exports.JhatkaRecall = require('../modules/jhatka/models/jhatka.recall.model');

// -- jhatka: orders and the variable-weight core (§3) ------------------------
module.exports.JhatkaOrderItem = require('../modules/jhatka/models/jhatka.order.item.schema');
module.exports.JhatkaOrder = require('../modules/jhatka/models/jhatka.order.model');
module.exports.JhatkaOrderStatusHistory = require('../modules/jhatka/models/jhatka.order.status.history.model');
module.exports.JhatkaWeightConfirmation = require('../modules/jhatka/models/jhatka.weight.confirmation.model');
module.exports.JhatkaPreparationTicket = require('../modules/jhatka/models/jhatka.preparation.ticket.model');
module.exports.JhatkaRefund = require('../modules/jhatka/models/jhatka.refund.model');
module.exports.JhatkaLabel = require('../modules/jhatka/models/jhatka.label.model');
module.exports.JhatkaOutletVarianceFlag = require('../modules/jhatka/models/jhatka.outlet.variance.flag.model');

// -- jhatka: subscriptions (BR-14, BR-15, BR-16, BR-17) ----------------------
module.exports.JhatkaSubscription = require('../modules/jhatka/models/jhatka.subscription.model');
module.exports.JhatkaSubscriptionEvent = require('../modules/jhatka/models/jhatka.subscription.event.model');
module.exports.JhatkaRecurringOrder = require('../modules/jhatka/models/jhatka.recurring.order.model');

// -- jhatka: delivery and cold chain (BR-12) --------------------------------
module.exports.JhatkaDriver = require('../modules/jhatka/models/jhatka.driver.model');
module.exports.JhatkaDelivery = require('../modules/jhatka/models/jhatka.delivery.model');
module.exports.JhatkaDeliveryPOD = require('../modules/jhatka/models/jhatka.delivery.pod.model');
module.exports.JhatkaDeliverySettlement = require('../modules/jhatka/models/jhatka.delivery.settlement.model');

// -- jhatka: money out (§10, BR-05, BR-26) ----------------------------------
module.exports.JhatkaCommissionRule = require('../modules/jhatka/models/jhatka.commission.rule.model');
module.exports.JhatkaOperatorPayout = require('../modules/jhatka/models/jhatka.operator.payout.model');
module.exports.JhatkaSupplierPayable = require('../modules/jhatka/models/jhatka.supplier.payable.model');
module.exports.JhatkaSettlement = require('../modules/jhatka/models/jhatka.settlement.model');

// -- jhatka: platform settings (Business Setup tab; every field is read) ---
module.exports.JhatkaSettings = require('../modules/jhatka/models/jhatka.settings.model');
// -- jhatka: compliance and customer surface --------------------------------
module.exports.JhatkaCompliance = require('../modules/jhatka/models/jhatka.compliance.model');
module.exports.JhatkaComplaint = require('../modules/jhatka/models/jhatka.complaint.model');
module.exports.JhatkaReview = require('../modules/jhatka/models/jhatka.review.model');
module.exports.JhatkaPromotion = require('../modules/jhatka/models/jhatka.promotion.model');

// -- local-services: revenue engine (Phase 1). Registered as flat block at END,
// never edit above lines (jhatka pattern). refs are lazy so order is for humans.
module.exports.LocalServiceRevenueRule = require('../modules/local-services/models/localservice.revenue.rule.model');
module.exports.LocalServiceRevenueEntry = require('../modules/local-services/models/localservice.revenue.entry.model');
// -- local-services: booking engine (Phase 2).
module.exports.LocalServiceBooking = require('../modules/local-services/models/localservice.booking.model');
module.exports.LocalServiceQuote = require('../modules/local-services/models/localservice.quote.model');
module.exports.LocalServiceResource = require('../modules/local-services/models/localservice.resource.model');
module.exports.LocalServiceReservation = require('../modules/local-services/models/localservice.reservation.model');
module.exports.LocalServiceStatusHistory = require('../modules/local-services/models/localservice.status.history.model');
// -- local-services: catalogue (Phase 3).
module.exports.LocalServiceCategory = require('../modules/local-services/models/localservice.category.model');
module.exports.LocalServiceFacet = require('../modules/local-services/models/localservice.facet.model');
module.exports.LocalServiceService = require('../modules/local-services/models/localservice.service.model');
module.exports.LocalServiceVariant = require('../modules/local-services/models/localservice.variant.model');
// -- local-services: provider + offering (Phase 4).
module.exports.LocalServiceProvider = require('../modules/local-services/models/localservice.provider.model');
module.exports.LocalServiceOffering = require('../modules/local-services/models/localservice.offering.model');
// -- local-services: recurring (Phase 5).
module.exports.LocalServiceRecurringAgreement = require('../modules/local-services/models/localservice.recurring.agreement.model');
module.exports.LocalServiceRecurringOccurrence = require('../modules/local-services/models/localservice.recurring.occurrence.model');
// -- local-services: leads (Phase 5).
module.exports.LocalServiceLead = require('../modules/local-services/models/localservice.lead.model');
// -- local-services: growth (plans + featured, Phase 5).
module.exports.LocalServiceSubscriptionPlan = require('../modules/local-services/models/localservice.growth.model').LocalServiceSubscriptionPlan;
module.exports.LocalServiceSubscription = require('../modules/local-services/models/localservice.growth.model').LocalServiceSubscription;
module.exports.LocalServiceFeaturedPlacement = require('../modules/local-services/models/localservice.growth.model').LocalServiceFeaturedPlacement;
// -- local-services: staff/availability/coverage (Phase 6).
module.exports.LocalServiceStaff = require('../modules/local-services/models/localservice.staff.model').LocalServiceStaff;
module.exports.LocalServiceAvailabilityRule = require('../modules/local-services/models/localservice.staff.model').LocalServiceAvailabilityRule;
module.exports.LocalServiceCoverage = require('../modules/local-services/models/localservice.staff.model').LocalServiceCoverage;
// -- local-services: fulfilment (assignment/invoice/review/complaint).
module.exports.LocalServiceAssignment = require('../modules/local-services/models/localservice.fulfilment.model').LocalServiceAssignment;
module.exports.LocalServiceInvoice = require('../modules/local-services/models/localservice.fulfilment.model').LocalServiceInvoice;
module.exports.LocalServiceReview = require('../modules/local-services/models/localservice.fulfilment.model').LocalServiceReview;
module.exports.LocalServiceComplaint = require('../modules/local-services/models/localservice.fulfilment.model').LocalServiceComplaint;
module.exports.LocalServiceDocument = require('../modules/local-services/models/localservice.document.model');
// -- local-services: catalogue ext (template/addon/configversion/refund).
module.exports.LocalServiceTemplate = require('../modules/local-services/models/localservice.catalog.ext.model').LocalServiceTemplate;
module.exports.LocalServiceAddon = require('../modules/local-services/models/localservice.catalog.ext.model').LocalServiceAddon;
module.exports.LocalServiceConfigVersion = require('../modules/local-services/models/localservice.catalog.ext.model').LocalServiceConfigVersion;
module.exports.LocalServiceRefundRequest = require('../modules/local-services/models/localservice.catalog.ext.model').LocalServiceRefundRequest;
module.exports.LocalServiceRuleHistory = require('../modules/local-services/models/localservice.rule.history.model');

// -- support-chat enterprise (bot-first -> human handover). Appended at END, never edit above.
module.exports.SupportQueue = require('./support.queue.model');
module.exports.SupportShift = require('./support.shift.model');
module.exports.SupportQaReview = require('./support.qa.review.model');
module.exports.SlaPolicy = require('./sla.policy.model');
module.exports.CannedResponse = require('./canned.response.model');
module.exports.AgentPresence = require('./agent.presence.model');

// -- header-banner (silver app bar + promotional banner slot). Appended at END, never edit above.
module.exports.HeaderBanner = require('../modules/header-banner/models/header.banner.model');
module.exports.HeaderBannerDraft = require('../modules/header-banner/models/header.banner.draft.model');
module.exports.HeaderBannerPublishHistory = require('../modules/header-banner/models/header.banner.publish.history.model');