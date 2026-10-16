const { defineConfig } = require('@playwright/test');
const path = require('path');

// The app opens fullscreen always-on-top overlays and runs the CPU vision loop,
// so scenarios run one at a time.
module.exports = defineConfig({
  testDir: __dirname,
  testMatch: '**/*.spec.js',
  timeout: 120000,
  expect: { timeout: 15000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: path.join(__dirname, 'artifacts', 'test-results')
});
