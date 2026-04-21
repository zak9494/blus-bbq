'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { calcQuoteTotals, SALES_TAX_RATE, QB_DELIVERY_FEE } = require('./quote-engine.js');

describe('constants', () => {
  it('SALES_TAX_RATE is 8.25%', () => assert.equal(SALES_TAX_RATE, 0.0825));
  it('QB_DELIVERY_FEE is $50', () => assert.equal(QB_DELIVERY_FEE, 50));
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
});
