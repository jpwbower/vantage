import http from 'node:http';

const configuredPort = Number(process.env.VANTAGE_CHILD_BOUND_PORT);
const mode = process.env.VANTAGE_CHILD_BOUND_MODE;
const server = http.createServer((_req, res) => res.end('child-bound fixture'));
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
