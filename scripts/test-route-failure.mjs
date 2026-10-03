import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { startRouteFailureServer } from '../ci/route-failure-server.mjs';

const server = await startRouteFailureServer();
try {
  const address = server.address();
  const child = spawn(process.execPath, [
    'bin/vantage.mjs', '--config', 'ci/vantage.route-failure.config.ts',
    '--smoke', '--ci',
  ], {
    env: {
      ...process.env,
      VANTAGE_ROUTE_FAILURE_URL: `http://127.0.0.1:${address.port}`,
      FORCE_COLOR: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
  const [code, signal] = await once(child, 'close');
  process.stdout.write(output);
  assert.equal(signal, null, 'CLI must exit normally, not be killed');
  assert.notEqual(code, 0, 'HTTP 500 must fail the CLI run');
  assert.match(output, /route members-commons \(\/members\/commons\) returned HTTP 500/);
  assert.match(output, /no a11y verdict was taken; check the web server log/);
  assert.doesNotMatch(output, /axe violations|html-has-lang/);
  process.stdout.write('route-failure regression: PASS (HTTP 500 rejected before axe)\n');
} finally {
  server.closeAllConnections();
  await new Promise((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve());
  });
}
