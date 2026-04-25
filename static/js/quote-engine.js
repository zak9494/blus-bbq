/**
 * quote-engine.js — Shared quote calculation engine for Blu's BBQ Dashboard.
 * Used by both the Quote Builder tab (Path A) and the Inquiry Detail quote
 * section (Path B). ONE change here updates both surfaces.
 *
 * Exposed as window globals so inline onclick handlers can call them.
 */

/* ── Constants ──────────────────────────────────────────────────────────── */
const QB_DELIVERY_FEE    = 50;    // flat delivery fee, dollars
const SALES_TAX_RATE     = 0.0825; // Texas sales tax (8.25%) — overridable per-quote via opts.taxRate
const DEFAULT_DEPOSIT_PCT = 50;   // default deposit percentage (env DEFAULT_DEPOSIT_PCT, default 50)
const DEFAULT_SETUP_FEE  = 0;     // default setup fee (env DEFAULT_SETUP_FEE, default 0)

if (typeof window !== 'undefined') {
  window.QB_DELIVERY_FEE    = QB_DELIVERY_FEE;
  window.SALES_TAX_RATE     = SALES_TAX_RATE;
  window.DEFAULT_DEPOSIT_PCT = DEFAULT_DEPOSIT_PCT;
  window.DEFAULT_SETUP_FEE  = DEFAULT_SETUP_FEE;
}

/**
 * calcQuoteTotals
 * @param {number}  foodSubtotal  Sum of all line item subtotals
 * @param {number}  servicePct    Service charge percentage (e.g. 15 for 15%)
 * @param {number}  deliveryFee   Flat delivery fee (0 for pickup)
 * @param {boolean} taxExempt     Whether to zero out sales tax
 * @param {object}  [opts]        Optional Wave-2 extensions:
 *   opts.discountAmt  {number}  Flat $ discount applied to food subtotal before tax & service charge
 *   opts.setupFee     {number}  Flat $ setup fee added to total (distinct from delivery)
 *   opts.taxRate      {number}  Override tax rate (0–1 decimal, e.g. 0.0825). Defaults to SALES_TAX_RATE.
 * @returns {{ serviceCharge, baseTax, displayTax, total, discountAmt, discountedSubtotal }}
 */
function calcQuoteTotals(foodSubtotal, servicePct, deliveryFee, taxExempt, opts) {
  const discountAmt        = Math.min(Math.max((opts && opts.discountAmt) || 0, 0), foodSubtotal || 0);
  const discountedSubtotal = Math.round(((foodSubtotal || 0) - discountAmt) * 100) / 100;
  const taxRate            = (opts && typeof opts.taxRate === 'number') ? opts.taxRate : SALES_TAX_RATE;
  const setupFee           = Math.max((opts && opts.setupFee) || 0, 0);

  const serviceCharge = Math.round(discountedSubtotal * ((servicePct || 0) / 100) * 100) / 100;
  const baseTax       = Math.round(discountedSubtotal * taxRate * 100) / 100;
  const displayTax    = taxExempt ? 0 : baseTax;
  const fee           = deliveryFee || 0;
  const total         = Math.round((discountedSubtotal + serviceCharge + displayTax + fee + setupFee) * 100) / 100;

  return { serviceCharge, baseTax, displayTax, total, discountAmt, discountedSubtotal };
}

if (typeof window !== 'undefined') {
  window.calcQuoteTotals = calcQuoteTotals;
}

if (typeof module !== 'undefined') {
  module.exports = { calcQuoteTotals, QB_DELIVERY_FEE, SALES_TAX_RATE, DEFAULT_DEPOSIT_PCT, DEFAULT_SETUP_FEE };
}
