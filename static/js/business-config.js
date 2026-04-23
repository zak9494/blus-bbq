/**
 * Tenant-aware business configuration — browser module.
 * Values are baked in at deploy time; override per tenant via a future
 * tenant-settings page. Mirrors api/_lib/business-config.js defaults.
 */
/* exported businessConfig */
const businessConfig = {
  name:               "Blu's Barbeque",
  shortName:          "Blu's BBQ",
  email:              'info@blusbarbeque.com',
  phone:              '214-514-8684',
  ownerName:          'Zach',
  staffName:          'Raul',
  city:               'Dallas',
  state:              'TX',
  brandColorPrimary:  '#ff8800',
  testEmail:          'zak9494+bbqtest@gmail.com',
  salesTaxRate:       0.0825,
  defaultDeliveryFee: 50,
};

if (typeof window !== 'undefined') {
  window.businessConfig = businessConfig;
}

if (typeof module !== 'undefined') {
  module.exports = { businessConfig };
}
