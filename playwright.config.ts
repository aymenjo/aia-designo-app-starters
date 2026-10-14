import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

loadEnvConfig(process.cwd());

const CI = Boolean(process.env.CI);
const URL_APP = "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "e2e",
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: URL_APP,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // En CI, l'app est construite avant (`npm run build`).
    command: CI ? "npm run start -- -H 127.0.0.1 -p 3000" : "npm run dev -- -H 127.0.0.1 -p 3000",
    url: `${URL_APP}/connexion`,
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
});
