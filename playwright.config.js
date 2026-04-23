// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  timeout: 60000,  // 60s per test — Vercel preview cold starts can take 25-30s on first hit
  workers: 4,
  use: {
    // Pass the Vercel automation bypass header when running against a protected preview.
    // Set VERCEL_AUTOMATION_BYPASS_SECRET in repo secrets (Vercel → Project → Settings →
    // Deployment Protection → Protection Bypass for Automation).
    extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET }
      : {},
  },
});
