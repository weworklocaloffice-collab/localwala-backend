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

const catchAsync = require('../../../utils/catchAsync');
const pick = require('../../../utils/pick');
const partnerService = require('../services/dairy.partner.service');
const settlementService = require('../services/dairy.settlement.service');

// //// Partner agreements ////

const partnerCreate = catchAsync(async (req, res) => {
  const partner = await partnerService.createPartner(req.body);
  res.send({ partner });
});

const partnerList = catchAsync(async (req, res) => {
  const result = await partnerService.listPartners(req.query);
  res.send(pick(result, ['partners', 'totalResults', 'page', 'limit']));
});

const partnerUpdate = catchAsync(async (req, res) => {
  const partner = await partnerService.updatePartnerTerms(req.params.partner, req.body);
  res.send({ partner });
});

const partnerStatus = catchAsync(async (req, res) => {
  const partner = await partnerService.setPartnerStatus(req.params.partner, req.params.status, req.body);
  res.send({ partner });
});

// //// Franchise agreements ////

const franchiseCreate = catchAsync(async (req, res) => {
  const franchise = await partnerService.createFranchise(req.body);
  res.send({ franchise });
});

const franchiseList = catchAsync(async (req, res) => {
  const result = await partnerService.listFranchises(req.query);
  res.send(pick(result, ['franchises', 'totalResults', 'page', 'limit']));
});

/** Candidate operators for the create dialog's picker. */
const franchiseOperatorList = catchAsync(async (req, res) => {
  const result = await partnerService.listFranchiseOperators(req.query);
  res.send(result);
});

const franchiseStatus = catchAsync(async (req, res) => {
  const franchise = await partnerService.setFranchiseStatus(
    req.params.franchise,
    req.params.status,
    req.body
  );
  res.send({ franchise });
});

// //// Settlements ////

/**
 * Builds a draft settlement for whichever agreement is named.
 *
 * Remains a draft so a partner can raise a dispute against the figures before
 * the platform closes the period.
 */
const settlementGenerate = catchAsync(async (req, res) => {
  const settlement = req.body.partner
    ? await settlementService.createCommissionSettlement({
        partnerId: req.body.partner,
        period: req.body.period,
        reference: req.body.reference,
        from: req.body.from,
        to: req.body.to,
      })
    : await settlementService.createFranchiseSettlement({
        franchiseId: req.body.franchise,
        period: req.body.period,
        reference: req.body.reference,
        from: req.body.from,
        to: req.body.to,
      });
  res.send({ settlement });
});

/** Preview only — writes nothing, so a statement can be shown before closing. */
const settlementPreview = catchAsync(async (req, res) => {
  const preview = await settlementService.previewSettlement(req.body);
  res.send({ preview });
});

const settlementDetail = catchAsync(async (req, res) => {
  const settlement = await settlementService.getSettlement(req.params.settlement);
  res.send({ settlement });
});

const settlementList = catchAsync(async (req, res) => {
    const result = await settlementService.listSettlements({
      ...req.query,
      // Last write wins, so a `?business=` in the query cannot widen the list.
      business: req.outletId,
    });
    res.send(pick(result, ['settlements', 'totalResults', 'page', 'limit']));
  });

const settlementStatus = catchAsync(async (req, res) => {
  const settlement = await settlementService.updateSettlementStatus(
    req.params.settlement,
    req.params.status,
    { ...req.body, actor: req.user._id }
  );
  res.send({ settlement });
});

const settlementPay = catchAsync(async (req, res) => {
  const settlement = await settlementService.paySettlement(req.params.settlement, req.body);
  res.send({ settlement });
});

const settlementSummary = catchAsync(async (req, res) => {
  const summary = await settlementService.getSettlementSummary(req.query);
  res.send({ summary });
});

module.exports = {
  partnerCreate,
  partnerList,
  partnerUpdate,
  partnerStatus,
  franchiseCreate,
  franchiseList,
  franchiseOperatorList,
  franchiseStatus,
  settlementGenerate,
  settlementPreview,
  settlementDetail,
  settlementList,
  settlementStatus,
  settlementPay,
  settlementSummary,
};
