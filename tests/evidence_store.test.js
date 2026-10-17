const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createEvidenceStore } = require('../electron/evidence_store');

const encrypt = (text) => Buffer.from(Buffer.from(text, 'utf8').map((b) => b ^ 0x5a));
const decrypt = (buf) => Buffer.from(buf.map((b) => b ^ 0x5a)).toString('utf8');
const jpeg = (n) => Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.from(`image-${n}`), Buffer.from([0xFF, 0xD9])]);

function setup(maxImages = 30){
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-'));
  let t = new Date('2026-10-17T10:00:00.000');
  const store = createEvidenceStore({
    dir:path.join(root, 'evidence'), encrypt, decrypt, fs, now:() => (t = new Date(t.getTime() + 1000)), maxImages:() => maxImages
  });
  return { root, dir:path.join(root, 'evidence'), store };
}

test('images are encrypted at rest and decrypt for viewing', () => {
  const { dir, store } = setup();
  const name = store.save({ run:'0a1b2c3d', event:1, jpeg:jpeg(1) });
  const raw = fs.readFileSync(path.join(dir, name));
  assert.ok(!raw.includes(Buffer.from([0xFF, 0xD8])), 'no JPEG bytes on disk');
  assert.ok(!raw.toString().includes('image-1'));
  assert.deepEqual(store.read(name), jpeg(1));
  assert.deepEqual(store.list(), [{ id:name, takenAt:'2026-10-17T10:00:01.000' }]);
});

test('only the newest N are kept', () => {
  const { store } = setup(3);
  for(let i = 1; i <= 5; i++) store.save({ run:'0a1b2c3d', event:i, jpeg:jpeg(i) });
  assert.equal(store.count(), 3);
  assert.deepEqual(store.list().map((e) => store.read(e.id).toString().match(/image-\d/)[0]), ['image-5', 'image-4', 'image-3']);
});

test('discarding an event deletes only that run and event', () => {
  const { store } = setup();
  store.save({ run:'0a1b2c3d', event:1, jpeg:jpeg(1) });
  store.save({ run:'0a1b2c3d', event:2, jpeg:jpeg(2) });
  store.save({ run:'ffffffff', event:1, jpeg:jpeg(3) }); // same event id, other backend run
  assert.equal(store.discardEvent('0a1b2c3d', 1), 1);
  assert.deepEqual(store.list().map((e) => store.read(e.id).toString().match(/image-\d/)[0]), ['image-3', 'image-2']);
});

test('remove, clear and input validation', () => {
  const { dir, store } = setup();
  const a = store.save({ run:'0a1b2c3d', event:1, jpeg:jpeg(1) });
  store.save({ run:'0a1b2c3d', event:2, jpeg:jpeg(2) });
  fs.writeFileSync(path.join(dir, 'not-ours.txt'), 'x');
  assert.throws(() => store.read('../../etc/passwd'), /Unknown/);
  assert.throws(() => store.remove('not-ours.txt'), /Unknown/);
  store.remove(a);
  assert.equal(store.count(), 1);
  assert.equal(store.clear(), 1);
  assert.ok(fs.existsSync(path.join(dir, 'not-ours.txt')));
  assert.throws(() => store.save({ run:'0a1b2c3d', event:3, jpeg:Buffer.from('not a jpeg') }), /JPEG/);
  assert.throws(() => store.save({ run:'../x', event:3, jpeg:jpeg(3) }), /Invalid/);
  assert.throws(() => store.save({ run:'0a1b2c3d', event:3, jpeg:Buffer.concat([jpeg(3), Buffer.alloc(300 * 1024)]) }), /small JPEG/);
});

test('legacy plaintext images: newest N encrypted, every plaintext snapshot deleted', () => {
  const { root, store } = setup(2);
  const legacy = path.join(root, 'intruder_logs');
  fs.mkdirSync(legacy);
  ['20261016_090000_000.jpg', '20261016_100000_000.jpg', '20261016_110000_000.jpg'].forEach((n, i) => fs.writeFileSync(path.join(legacy, n), jpeg(i)));
  fs.writeFileSync(path.join(legacy, 'holiday.jpg'), 'not ours');
  const result = store.migrateLegacy(legacy);
  assert.deepEqual(result, { encrypted:2, deleted:3 });
  assert.deepEqual(fs.readdirSync(legacy), ['holiday.jpg']);
  assert.deepEqual(store.list().map((e) => e.takenAt), ['2026-10-16T11:00:00.000', '2026-10-16T10:00:00.000']);
  assert.deepEqual(store.migrateLegacy(path.join(root, 'missing')), { encrypted:0, deleted:0 });
});
