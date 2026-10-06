import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';

const listen = (server, port) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => {
    server.removeListener('error', reject);
    resolve();
  });
});
const close = (server) => new Promise((resolve, reject) => {
  server.closeAllConnections?.();
  server.close((err) => err ? reject(err) : resolve());
});

// Reserve both neighbours simultaneously, retrying if the second is occupied.
async function reservePorts() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const first = net.createServer();
    await listen(first, 0);
    const port = first.address().port;
    const second = net.createServer();
    try {
      if (port === 65535) throw new Error('No next port');
      await listen(second, port + 1);
      return { port, first, second };
    } catch {
      await close(first);
    }
  }
  throw new Error('Could not reserve adjacent ports');
}

async function portIsFree(port) {
  // A probe bind can hit a Windows excluded port range (EACCES/EPERM with no
  // listener); retry so the cleanup assertion fails only on a real listener.
  for (let attempt = 0; ; attempt++) {
    const probe = net.createServer();
    try {
      await listen(probe, port);
      await close(probe);
      return true;
    } catch (err) {
      if (err.code === 'EADDRINUSE') return false;
      if ((err.code === 'EACCES' || err.code === 'EPERM') && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        continue;
      }
      throw err;
    }
  }
}

let failures = 0;
for (const [name, mode, foreign] of [
  ['S1', 'on-busy', true],
  ['S2', 'relocate', false],
  ['S3', 'honest', false],
  ['S4', 'foreign-then-relocate', false],
]) {
  const { port, first, second } = await reservePorts();
  let server;
  try {
    await close(first);
    if (foreign) {
      server = http.createServer((_req, res) => res.end('child-bound fixture'));
      await listen(server, port);
    }
    await close(second);
    const child = spawn(process.execPath, [
      'bin/vantage.mjs', '--config', 'ci/vantage.child-bound.config.ts',
      '--smoke', ...(name === 'S2' || name === 'S4' ? ['--no-reuse'] : ['--ci']),
    ], {
      env: {
        ...process.env,
        VANTAGE_CHILD_BOUND_PORT: String(port),
        VANTAGE_CHILD_BOUND_MODE: mode,
        FORCE_COLOR: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
    const watchdog = setTimeout(() => child.kill('SIGKILL'), 20_000);
    let code, signal;
    try {
      [code, signal] = await once(child, 'close');
    } finally {
      clearTimeout(watchdog);
    }
    process.stdout.write(output);
    assert.equal(signal, null, `${name}: CLI must exit within the watchdog`);
    if (name === 'S3') {
      assert.equal(code, 0, 'S3: honest child must complete GREEN');
      assert.match(output, /1 passed/, 'S3: control test must actually run');
      assert.equal(await portIsFree(port), true, 'S3: configured child must be killed');
    } else {
      assert.notEqual(code, 0, `${name}: foreign/relocated server must be RED`);
      assert.match(output, /\[vantage\] child-bound readiness:/, `${name}: refusal must name child-bound cause`);
      if (name === 'S1') assert.match(output, /configured port already served by a foreign process/);
      if (name === 'S2' || name === 'S4') {
        assert.match(output, /timeout/);
        assert.match(output, new RegExp(`observed port\\(s\\): ${port + 1}`));
      }
      // S4 is the card's composed case: the silent configured-port listener
      // must die with the child too, or a stale server survives the run.
      if (name === 'S4') {
        assert.equal(await portIsFree(port), true, 'S4: silent configured-port listener must be killed');
      }
    }
    if (name === 'S2' || name === 'S4') {
      assert.equal(await portIsFree(port + 1), true, `${name}: relocated child must be killed`);
    }
    console.log(`${name}: PASS (${name === 'S3' ? 'GREEN, child cleaned up' : 'RED, child-bound cause'})`);
  } catch (err) {
    failures++;
    console.error(`${name}: FAIL — ${err.message}`);
  } finally {
    if (server) await close(server);
  }
}
process.exitCode = failures ? 1 : 0;
