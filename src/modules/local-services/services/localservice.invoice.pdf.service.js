const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');

Handlebars.registerHelper('add', (value, increment) => Number(value) + Number(increment));

const money = (value) =>
  new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const dateText = (value) =>
  new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(value ? new Date(value) : new Date());

let compiled;

function template() {
  if (!compiled) {
    const file = path.join(__dirname, '../../../templates/other/localservice_invoice.html');
    compiled = Handlebars.compile(fs.readFileSync(file, 'utf8'));
  }
  return compiled;
}

function renderInvoiceHtml(invoice) {
  const data = invoice && invoice.toObject ? invoice.toObject() : { ...invoice };
  const lines = (data.lines || []).map((line) => ({
    ...line,
    amountText: money(line.amount),
  }));
  const taxRows = [];
  if (Number(data.igst || 0) > 0) {
    taxRows.push({ label: 'IGST', rate: data.taxPercent, amountText: money(data.igst) });
  } else {
    taxRows.push({ label: 'CGST', rate: Number(data.taxPercent || 0) / 2, amountText: money(data.cgst) });
    taxRows.push({ label: 'SGST', rate: Number(data.taxPercent || 0) / 2, amountText: money(data.sgst) });
  }
  return template()({
    ...data,
    lines,
    taxRows,
    issuedAtText: dateText(data.issuedAt),
    totalText: money(data.total),
    taxableValueText: money(data.taxableValue),
    taxTotalText: money(data.taxTotal),
    isVoid: data.status === 'void',
  });
}

async function renderInvoicePdf(invoice) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(renderInvoiceHtml(invoice), { waitUntil: 'load' });
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', right: '12mm', bottom: '14mm', left: '12mm' },
    });
  } finally {
    await browser.close();
  }
}

module.exports = { renderInvoiceHtml, renderInvoicePdf, money, dateText };
