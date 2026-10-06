import { defineConfig } from 'vantage';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.VANTAGE_CHILD_BOUND_PORT);
if (!port) throw new Error('Run via test:child-bound-readiness.');
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  baseURL,
  routes: [{ name: 'control', path: '/' }],
  webServer: {
    command: `"${process.execPath}" child-bound-server.mjs`,
    url: baseURL,
    cwd: configDir,
    timeout: 5_000,
  },
  playwrightOverrides: {
    testDir: path.join(configDir, 'child-bound-tests'),
    retries: 0,
    workers: 1,
  },
});
