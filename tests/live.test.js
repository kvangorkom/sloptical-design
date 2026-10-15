// optic_live.py's server: the watched file is readable from any page (CORS), the rest of the folder only by pages it
// serves itself, and only requests addressed to this computer are answered. Skipped when python3 isn't installed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const root = path.join(__dirname, '..');

const get = (port, p, host) =>
  new Promise((res, rej) => {
    const r = http.get({ host: '127.0.0.1', port, path: p, headers: host ? { Host: host } : {} }, m => {
      m.resume();
      m.on('end', () =>
        res({ status: m.statusCode, cors: m.headers['access-control-allow-origin'] ?? null }),
      );
    });
    r.on('error', rej);
  });

test(
  'live server: CORS for the watched file only; requests for other hosts refused',
  { skip: spawnSync('python3', ['--version']).status !== 0 && 'python3 not found' },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-'));
    const file = path.join(dir, 'w.json');
    fs.writeFileSync(file, '{"rows": [{}]}');
    const py = spawn(
      'python3',
      [
        '-u', // (unbuffered: its address arrives as soon as it's printed)
        '-c',
        'import sys, time; sys.path.insert(0, sys.argv[1]); import optic_live as ol; ol.serve(sys.argv[2], 8730, False); time.sleep(60)',
        root,
        file,
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    try {
      const port = await new Promise((res, rej) => {
        py.stdout.on('data', d => {
          const m = String(d).match(/http:\/\/localhost:(\d+)\//);
          if (m) res(+m[1]);
        });
        py.on('exit', c => rej(Error(`server exited (${c})`)));
      });
      assert.deepEqual(await get(port, '/live/w.json', `localhost:${port}`), { status: 200, cors: '*' });
      assert.deepEqual(await get(port, '/index.html', `localhost:${port}`), { status: 200, cors: null }); // same-origin only
      assert.deepEqual(await get(port, '/index.html', `127.0.0.1:${port}`), { status: 200, cors: null });
      assert.deepEqual(await get(port, '/index.html', `[::1]:${port}`), { status: 200, cors: null });
      assert.equal((await get(port, '/live/w.json', `attacker.example:${port}`)).status, 403); // DNS rebinding
      assert.equal((await get(port, '/index.html', 'localhost.attacker.example')).status, 403);
    } finally {
      py.kill();
    }
  },
);
