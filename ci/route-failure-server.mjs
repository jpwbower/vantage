import http from 'node:http';
import { once } from 'node:events';

// Match Astro's dev-server error document: no html lang, hence an axe trap
// if the route's HTTP status is ignored before judging its content.
export async function startRouteFailureServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/members/commons') {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end('<title>Error</title><script type="module" src="/@vite/client"></script>');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ready');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}
