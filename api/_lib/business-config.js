'use strict';
/**
 * Tenant-aware business configuration.
 * All values read from env vars with current Blu's BBQ values as defaults.
 * Future tenants override via env vars; eventually this will read from a tenants table.
 */
const businessConfig = {
  name:               process.env.BUSINESS_NAME               || "Blu's Barbeque",
  shortName:          process.env.BUSINESS_SHORT_NAME         || "Blu's BBQ",
  email:              process.env.BUSINESS_EMAIL              || 'info@blusbarbeque.com',
  phone:              process.env.BUSINESS_PHONE              || '214-514-8684',
  ownerName:          process.env.BUSINESS_OWNER_NAME         || 'Zach',
  staffName:          process.env.BUSINESS_STAFF_NAME         || 'Raul',
  city:               process.env.BUSINESS_CITY               || 'Dallas',
  state:              process.env.BUSINESS_STATE              || 'TX',
  brandColorPrimary:  process.env.BUSINESS_BRAND_COLOR        || '#ff8800',
  testEmail:          process.env.BUSINESS_TEST_EMAIL         || 'zak9494+bbqtest@gmail.com',
  salesTaxRate:       Number(process.env.BUSINESS_SALES_TAX_RATE)       || 0.0825,
  defaultDeliveryFee: Number(process.env.BUSINESS_DEFAULT_DELIVERY_FEE) || 50,
};

module.exports = { businessConfig };
