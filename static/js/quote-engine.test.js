'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { calcQuoteTotals, SALES_TAX_RATE, QB_DELIVERY_FEE, DEFAULT_DEPOSIT_PCT, DEFAULT_SETUP_FEE } = require('./quote-engine.js');

describe('constants', () => {
  it('SALES_TAX_RATE is 8.25%', () => assert.equal(SALES_TAX_RATE, 0.0825));
  it('QB_DELIVERY_FEE is $50', () => assert.equal(QB_DELIVERY_FEE, 50));
  it('DEFAULT_DEPOSIT_PCT is 50', () => assert.equal(DEFAULT_DEPOSIT_PCT, 50));
  it('DEFAULT_SETUP_FEE is 0', () => assert.equal(DEFAULT_SETUP_FEE, 0));
});

describe('calcQuoteTotals', () => {
  describe('basic subtotal — no service, no delivery, not tax-exempt', () => {
    it('$1,000 subtotal → tax=$82.50, total=$1,082.50', () => {
      const r = calcQuoteTotals(1000, 0, 0, false);
      assert.equal(r.serviceCharge, 0);
      assert.equal(r.baseTax, 82.50);
      assert.equal(r.displayTax, 82.50);
      assert.equal(r.total, 1082.50);
    });
    it('discountAmt and discountedSubtotal present with defaults', () => {
      const r = calcQuoteTotals(1000, 0, 0, false);
      assert.equal(r.discountAmt, 0);
      assert.equal(r.discountedSubtotal, 1000);
    });
  });

  describe('service charge', () => {
    it('15% service on $1,000 → serviceCharge=$150', () => {
      const r = calcQuoteTotals(1000, 15, 0, false);
      assert.equal(r.serviceCharge, 150);
    });
    it('service charge is applied to food subtotal only (not added before tax)', () => {
      const r = calcQuoteTotals(1000, 15, 0, false);
      // total = 1000 + 150 (service) + 82.50 (tax on food) + 0 (delivery)
      assert.equal(r.total, 1232.50);
    });
  });

  describe('delivery fee', () => {
    it('flat $50 delivery adds to total', () => {
      const r = calcQuoteTotals(1000, 0, 50, false);
      assert.equal(r.total, 1132.50);
    });
    it('zero delivery fee passes through correctly', () => {
      const r = calcQuoteTotals(1000, 0, 0, false);
      assert.equal(r.total, 1082.50);
    });
  });

  describe('tax exempt', () => {
    it('displayTax is 0 when taxExempt=true', () => {
      const r = calcQuoteTotals(1000, 0, 0, true);
      assert.equal(r.displayTax, 0);
    });
    it('baseTax is still computed when taxExempt=true', () => {
      const r = calcQuoteTotals(1000, 0, 0, true);
      assert.equal(r.baseTax, 82.50);
    });
    it('total excludes tax when taxExempt=true', () => {
      const r = calcQuoteTotals(1000, 0, 0, true);
      assert.equal(r.total, 1000);
    });
  });

  describe('combined — service + delivery + tax', () => {
    it('$1,000 + 15% service + $50 delivery + tax', () => {
      const r = calcQuoteTotals(1000, 15, 50, false);
      assert.equal(r.serviceCharge, 150);
      assert.equal(r.baseTax, 82.50);
      assert.equal(r.total, 1282.50);
    });
  });

  describe('rounding', () => {
    it('rounds to 2 decimal places', () => {
      // $333.33 * 8.25% = 27.499725 → rounds to $27.50
      const r = calcQuoteTotals(333.33, 0, 0, false);
      assert.equal(r.baseTax, 27.50);
    });
    it('zero subtotal → all zeros', () => {
      const r = calcQuoteTotals(0, 15, 50, false);
      assert.equal(r.serviceCharge, 0);
      assert.equal(r.baseTax, 0);
      assert.equal(r.total, 50);
    });
  });

  describe('falsy/missing params', () => {
    it('undefined servicePct treated as 0', () => {
      const r = calcQuoteTotals(1000, undefined, 0, false);
      assert.equal(r.serviceCharge, 0);
    });
    it('undefined deliveryFee treated as 0', () => {
      const r = calcQuoteTotals(1000, 0, undefined, false);
      assert.equal(r.total, 1082.50);
    });
  });

  describe('Wave-2 opts — discount', () => {
    it('$100 discount on $1,000 subtotal: discountedSubtotal=$900, tax on $900', () => {
      const r = calcQuoteTotals(1000, 0, 0, false, { discountAmt: 100 });
      assert.equal(r.discountAmt, 100);
      assert.equal(r.discountedSubtotal, 900);
      assert.equal(r.baseTax, Math.round(900 * 0.0825 * 100) / 100);
      assert.equal(r.total, Math.round((900 + r.baseTax) * 100) / 100);
    });
    it('service charge applies to discounted subtotal', () => {
      const r = calcQuoteTotals(1000, 10, 0, false, { discountAmt: 200 });
      // discounted = 800; service = 80; tax = 66
      assert.equal(r.discountedSubtotal, 800);
      assert.equal(r.serviceCharge, 80);
    });
    it('discount clamped to subtotal — cannot produce negative discountedSubtotal', () => {
      const r = calcQuoteTotals(100, 0, 0, false, { discountAmt: 999 });
      assert.equal(r.discountAmt, 100);
      assert.equal(r.discountedSubtotal, 0);
      assert.equal(r.total, 0);
    });
    it('negative discountAmt ignored (treated as 0)', () => {
      const r = calcQuoteTotals(1000, 0, 0, false, { discountAmt: -50 });
      assert.equal(r.discountAmt, 0);
      assert.equal(r.discountedSubtotal, 1000);
    });
  });

  describe('Wave-2 opts — setup fee', () => {
    it('$75 setup fee added to total, not taxed', () => {
      const r = calcQuoteTotals(1000, 0, 0, false, { setupFee: 75 });
      // total = 1000 + 82.50 (tax) + 75 (setup)
      assert.equal(r.total, 1000 + 82.50 + 75);
    });
    it('setup fee + delivery fee both apply', () => {
      const r = calcQuoteTotals(1000, 0, 50, false, { setupFee: 75 });
      assert.equal(r.total, 1000 + 82.50 + 50 + 75);
    });
  });

  describe('Wave-2 opts — tax rate override', () => {
    it('custom 6% tax rate used instead of 8.25%', () => {
      const r = calcQuoteTotals(1000, 0, 0, false, { taxRate: 0.06 });
      assert.equal(r.baseTax, 60);
      assert.equal(r.displayTax, 60);
    });
    it('0% tax rate (tax-free state)', () => {
      const r = calcQuoteTotals(1000, 0, 0, false, { taxRate: 0 });
      assert.equal(r.baseTax, 0);
      assert.equal(r.total, 1000);
    });
  });

  describe('Wave-2 opts — combined discount + setup fee + custom tax', () => {
    it('all opts together compute correctly', () => {
      // food=1000, discount=100 → discounted=900
      // service=10% on 900 → 90; tax=7% on 900 → 63; delivery=50; setup=75
      // total = 900 + 90 + 63 + 50 + 75 = 1178
      const r = calcQuoteTotals(1000, 10, 50, false, { discountAmt: 100, setupFee: 75, taxRate: 0.07 });
      assert.equal(r.discountedSubtotal, 900);
      assert.equal(r.serviceCharge, 90);
      assert.equal(r.baseTax, 63);
      assert.equal(r.total, 1178);
    });
  });
});
