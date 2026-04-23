/**
 * quote-engine.js — Shared quote calculation engine for Blu's BBQ Dashboard.
 * Used by both the Quote Builder tab (Path A) and the Inquiry Detail quote
 * section (Path B). ONE change here updates both surfaces.
 *
 * Exposed as window globals so inline onclick handlers can call them.
 */

/* ── Constants ──────────────────────────────────────────────────────────── */
// Load from businessConfig global (browser) or require (Node.js tests); fall back to hardcoded defaults.
var _bc;
try {
  _bc = typeof businessConfig !== 'undefined' ? businessConfig
      : (typeof require === 'function' ? require('./business-config.js').businessConfig : null);
} catch(_e) { _bc = null; }
const QB_DELIVERY_FEE = (_bc && _bc.defaultDeliveryFee != null) ? _bc.defaultDeliveryFee : 50;
const SALES_TAX_RATE  = (_bc && _bc.salesTaxRate  != null) ? _bc.salesTaxRate  : 0.0825;

if (typeof window !== 'undefined') {
  window.QB_DELIVERY_FEE = QB_DELIVERY_FEE;
  window.SALES_TAX_RATE  = SALES_TAX_RATE;
}

/**
 * calcQuoteTotals
 * @param {number}  foodSubtotal  Sum of all line item subtotals
 * @param {number}  servicePct    Service charge percentage (e.g. 15 for 15%)
 * @param {number}  deliveryFee   Flat delivery fee (0 for pickup)
 * @param {boolean} taxExempt     Whether to zero out sales tax
 * @returns {{ serviceCharge, baseTax, displayTax, total }}
 */
function calcQuoteTotals(foodSubtotal, servicePct, deliveryFee, taxExempt) {
  const serviceCharge = Math.round(foodSubtotal * ((servicePct || 0) / 100) * 100) / 100;
  const baseTax       = Math.round(foodSubtotal * SALES_TAX_RATE * 100) / 100;
  const displayTax    = taxExempt ? 0 : baseTax;
  const fee           = deliveryFee || 0;
  const total         = Math.round((foodSubtotal + serviceCharge + displayTax + fee) * 100) / 100;
  return { serviceCharge, baseTax, displayTax, total };
}

if (typeof window !== 'undefined') {
  window.calcQuoteTotals = calcQuoteTotals;
}

if (typeof module !== 'undefined') {
  module.exports = { calcQuoteTotals, QB_DELIVERY_FEE, SALES_TAX_RATE };
}
