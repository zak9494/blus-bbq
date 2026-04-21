// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  use: {
    // Pass the Vercel automation bypass header when running against a protected preview.
    // Set VERCEL_AUTOMATION_BYPASS_SECRET in repo secrets (Vercel → Project → Settings →
    // Deployment Protection → Protection Bypass for Automation).
    extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET }
      : {},
  },
});
