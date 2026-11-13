const catchAsync = require('../../../utils/catchAsync');
const reportService = require('../services/dairy.report.service');

const csvCell = (value) => {
  let text = value == null ? '' : String(value);
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
const renderSalesCsv = (rows) => {
  const headers = ['Order no', 'Created at (UTC)', 'Outlet', 'Status', 'Item total', 'Discount', 'Service charge', 'Tax', 'Grand total', 'Payment mode', 'Payment status', 'Coupon'];
  const lines = [headers.map(csvCell).join(',')];
  rows.forEach((row) => lines.push([
    row.orderNo,
    row.createdAt?.toISOString?.() || row.createdAt,
    row.business?.name,
    row.status,
    Number((Number(row.itemTotal || 0) / 100).toFixed(2)),
    Number((Number(row.discountAmount || 0) / 100).toFixed(2)),
    Number((Number(row.serviceCharge || 0) / 100).toFixed(2)),
    Number((Number(row.taxAmount || 0) / 100).toFixed(2)),
    Number((Number(row.grandTotal || 0) / 100).toFixed(2)),
    row.paymentMode,
    row.paymentStatus,
    row.couponCode,
  ].map(csvCell).join(',')));
  return `\uFEFF${lines.join('\r\n')}`;
};

const salesSummary = catchAsync(async (req, res) => {
  const result = await reportService.salesSummary({ from: req.query.from, to: req.query.to, businessId: req.query.business });
  res.send({ report: result });
});

const partnerSales = catchAsync(async (req, res) => {
  const result = await reportService.partnerSalesReport({ businessId: req.outletId, from: req.query.from, to: req.query.to });
  res.send({ report: result });
});

const exportSales = catchAsync(async (req, res) => {
  const rows = await reportService.salesExportRows({ businessId: req.outletId || req.query.business, from: req.query.from, to: req.query.to });
  const from = new Date(req.query.from).toISOString().slice(0, 10);
  const to = new Date(req.query.to).toISOString().slice(0, 10);
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="dairy-sales-${from}-${to}.csv"`,
    'Cache-Control': 'no-store',
  });
  res.send(renderSalesCsv(rows));
});

const complianceSummary = catchAsync(async (req, res) => {
  const result = await reportService.complianceSummary();
  res.send({ report: result });
});

const settlementSummary = catchAsync(async (req, res) => {
  const result = await reportService.settlementSummary({
    from: req.query.from,
    to: req.query.to,
    status: req.query.status,
  });
  res.send({ report: result });
});

module.exports = { salesSummary, partnerSales, exportSales, complianceSummary, settlementSummary };
