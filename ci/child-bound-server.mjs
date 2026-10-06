import http from 'node:http';

const configuredPort = Number(process.env.VANTAGE_CHILD_BOUND_PORT);
const mode = process.env.VANTAGE_CHILD_BOUND_MODE;
const fixture = (_req, res) => res.end('child-bound fixture');

if (mode === 'foreign-then-relocate') {
  // Composed hazard (CARD-20260927-11): the configured port is held by a
  // listener that never advertises it (a foreign leftover), while this child
  // relocates and advertises only port+1. One stub plays both roles so the
  // scenario stays deterministic: on base, readiness resolves on the silent
  // port (false GREEN); under the child-bound stdio gate only port+1 is ever
  // observed, so readiness times out RED.
  const silent = http.createServer(fixture);
  const relocated = http.createServer(fixture);
  relocated.listen(configuredPort + 1, '127.0.0.1', () => {
    console.log(`  Local  http://127.0.0.1:${relocated.address().port}/`);
    silent.listen(configuredPort, '127.0.0.1');
  });
} else {
  const server = http.createServer(fixture);
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && mode === 'on-busy') {
      server.listen(configuredPort + 1, '127.0.0.1');
    } else {
      throw err;
    }
  });
  server.on('listening', () => {
    console.log(`  Local  http://127.0.0.1:${server.address().port}/`);
  });
  server.listen(configuredPort + (mode === 'relocate' ? 1 : 0), '127.0.0.1');
}
