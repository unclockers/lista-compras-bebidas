const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:8766", browserName: "chromium" },
  webServer: {
    command: "node tests/start-server.cjs",
    url: "http://127.0.0.1:8766",
    reuseExistingServer: false,
  },
});
