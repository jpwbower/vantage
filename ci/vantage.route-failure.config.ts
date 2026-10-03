import { defineConfig } from 'vantage';

const baseURL = process.env.VANTAGE_ROUTE_FAILURE_URL;
if (!baseURL) throw new Error('Run via npm run test:route-failure.');

export default defineConfig({
  baseURL,
  routes: [{ name: 'members-commons', path: '/members/commons' }],
  webServer: false,
  // No retries needed for a deterministic local HTTP 500.
  playwrightOverrides: { retries: 0, workers: 1 },
});
