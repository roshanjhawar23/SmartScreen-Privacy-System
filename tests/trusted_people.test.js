const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTrustedStore, validateName, MAX_PEOPLE } = require('../electron/trusted_people');

// Fake "safeStorage": reversible, but the file content is not plain JSON.
const encrypt = (text) => Buffer.from(Buffer.from(text, 'utf8').map((b) => b ^ 0x5a));
const decrypt = (buf) => Buffer.from(buf.map((b) => b ^ 0x5a)).toString('utf8');
const EMB = (seed) => Array.from({ length:128 }, (_, i) => Math.sin(seed + i));

function setup(){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trusted-'));
  let n = 0;
  let t = Date.parse('2026-10-16T10:00:00Z');
  const store = createTrustedStore({
    dir:path.join(dir, 'trusted'), encrypt, decrypt, fs,
    now:() => new Date(t += 1000),
    randomId:() => (++n).toString(16).padStart(16, '0')
  });
  return { dir, store };
}

test('add, list (no embeddings), templates, rename, re-enroll, remove', () => {
  const { dir, store } = setup();
  const a = store.add({ name:'  Roshan  ', embedding:EMB(1), sampleCount:5 });
  const b = store.add({ name:'Roshan (glasses)', embedding:EMB(2), sampleCount:5 });
  assert.equal(a.name, 'Roshan');
  assert.deepEqual(store.list().map((p) => p.name), ['Roshan', 'Roshan (glasses)']);
  assert.ok(!JSON.stringify(store.list()).includes('embedding'));
  assert.equal(store.templates().length, 2);
  assert.equal(store.templates()[1].embedding[0], EMB(2)[0]);

  store.rename(b.id, 'Second');
  assert.equal(store.list()[1].name, 'Second');
  store.reenroll(a.id, { embedding:EMB(9), sampleCount:5 });
  assert.equal(store.templates()[0].embedding[0], EMB(9)[0]);

  store.remove(b.id);
  assert.deepEqual(store.list().map((p) => p.id), [a.id]);
  // encrypted at rest
  const raw = fs.readFileSync(path.join(dir, 'trusted', `${a.id}.enc`), 'utf8');
  assert.ok(!raw.includes('Roshan') && !raw.includes('embedding'));
});

test('guards: last person, unknown ids, bad names and templates, maximum', () => {
  const { store } = setup();
  const a = store.add({ name:'Owner', embedding:EMB(1) });
  assert.throws(() => store.remove(a.id), /At least one/);
  assert.throws(() => store.rename('../../evil', 'x'), /Unknown/);
  assert.throws(() => store.add({ name:'', embedding:EMB(1) }), /Name/);
  assert.throws(() => store.add({ name:'<script>', embedding:EMB(1) }), /Name/);
  assert.throws(() => store.add({ name:'x'.repeat(41), embedding:EMB(1) }), /Name/);
  assert.throws(() => store.add({ name:'ok', embedding:[1, 2, 3] }), /template/);
  assert.throws(() => store.add({ name:'ok', embedding:EMB(1).map(() => NaN) }), /template/);
  for(let i = 1; i < MAX_PEOPLE; i++) store.add({ name:`P${i}`, embedding:EMB(i) });
  assert.throws(() => store.add({ name:'one too many', embedding:EMB(99) }), /At most/);
  assert.equal(validateName('a\tb'), 'a b');
});

test('migration of the legacy single-owner template', () => {
  const { store } = setup();
  const legacy = { embedding:EMB(4), sampleCount:5 };
  const result = store.migrateLegacy(legacy);
  assert.equal(result.migrated, true);
  assert.deepEqual(store.list().map((p) => [p.name, p.sampleCount]), [['Owner', 5]]);
  assert.deepEqual(store.templates()[0].embedding, EMB(4));
  // idempotent: never migrates twice or over existing people
  assert.equal(store.migrateLegacy(legacy).migrated, false);
  assert.equal(store.count(), 1);
});

test('migration with nothing to migrate', () => {
  const { store } = setup();
  assert.equal(store.migrateLegacy(null).migrated, false);
  assert.equal(store.count(), 0);
});

test('a corrupted or swapped template file is rejected', () => {
  const { dir, store } = setup();
  const a = store.add({ name:'A', embedding:EMB(1) });
  const b = store.add({ name:'B', embedding:EMB(2) });
  // copy B's file over A's name: ids no longer match
  fs.copyFileSync(path.join(dir, 'trusted', `${b.id}.enc`), path.join(dir, 'trusted', `${a.id}.enc`));
  assert.throws(() => store.list(), /does not match/);
});
