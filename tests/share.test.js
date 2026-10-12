// Designs in links (src/app/share.js): packed and unpacked unchanged, and much shorter than their JSON. Run: node --test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { packDesign, unpackDesign } = require('../src/app/share.js');

test('a design survives a link, in URL-safe text shorter than its JSON', async () => {
  const sys = {
    name: 'Relay µm (test).json',
    fields: [0, 0.5, [0.2, -0.1]],
    lambda: 0.55,
    rows: [
      { R: 0, t: 300, ap: 25 },
      { name: 'OAP 1', type: 'mirror', R: -1000, k: -1, d: 150, tilt: 0, t: 511.25, n: 1, ap: 0 },
      { name: 'Focus', type: 'refract', R: 0, k: 0, d: 0, tilt: 0, t: 511.25, n: 1, ap: 0 },
    ],
  };
  const t = await packDesign(sys);
  assert.match(t, /^[\w-]+$/);
  assert.ok(t.length < JSON.stringify(sys).length);
  assert.deepEqual(await unpackDesign(t), sys);
  await assert.rejects(unpackDesign(t.slice(0, 20)));
});
