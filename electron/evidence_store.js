// Security images (opt-in intruder snapshots), encrypted at rest. Pure: no Electron imports.
// main.js injects encrypt/decrypt (Electron safeStorage, as for face templates) and fs.
//
// Files: <dir>/<YYYYMMDD-HHMMSS-mmm>_<run>-<event>.enc, each = base64(encrypt(base64 JPEG)).
// Images are only decrypted on request, for the in-app viewer. The newest `maxImages` are kept.
// `run` identifies one backend run (event ids restart per run), so an event can be discarded
// later ("never keep a photo of the owner").

const path = require('path');

const NAME = /^(\d{8}-\d{6}-\d{3})_([a-f0-9]{8})-(\d{1,6})\.enc$/;
const LEGACY_NAME = /^\d{8}_\d{6}_\d{3}\.jpg$/; // plaintext files of earlier versions
const MAX_JPEG_BYTES = 200 * 1024;

function stamp(date){
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}-${p(date.getMilliseconds(), 3)}`;
}

function takenAt(name){
  const m = NAME.exec(name);
  if(!m) return null;
  const [d, t, ms] = m[1].split('-');
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}.${ms}`;
}

function isJpeg(buffer){
  return Buffer.isBuffer(buffer) && buffer.length > 4 && buffer[0] === 0xFF && buffer[1] === 0xD8;
}

function createEvidenceStore({ dir, encrypt, decrypt, fs, now = () => new Date(), maxImages = () => 30 }){
  const names = () => {
    if(!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((n) => NAME.test(n)).sort(); // chronological
  };

  function prune(){
    const all = names();
    const keep = Math.max(1, Math.round(Number(maxImages()) || 30));
    for(const name of all.slice(0, Math.max(0, all.length - keep))) fs.unlinkSync(path.join(dir, name));
  }

  function write(name, jpeg){
    fs.mkdirSync(dir, { recursive:true });
    const tmp = path.join(dir, `${name}.tmp`);
    fs.writeFileSync(tmp, encrypt(jpeg.toString('base64')).toString('base64'), 'utf8');
    fs.renameSync(tmp, path.join(dir, name));
  }

  function read(name){
    if(!NAME.test(name)) throw new Error('Unknown image.');
    const raw = fs.readFileSync(path.join(dir, name), 'utf8').trim();
    const jpeg = Buffer.from(decrypt(Buffer.from(raw, 'base64')), 'base64');
    if(!isJpeg(jpeg)) throw new Error('Image could not be decrypted.');
    return jpeg;
  }

  return {
    // jpeg: Buffer from the backend. Returns the stored name.
    save({ run, event, jpeg, at = now() }){
      if(!/^[a-f0-9]{8}$/.test(run) || !/^\d{1,6}$/.test(String(event))) throw new Error('Invalid image event.');
      if(!isJpeg(jpeg) || jpeg.length > MAX_JPEG_BYTES) throw new Error('Not a small JPEG.');
      let name = `${stamp(at)}_${run}-${event}.enc`;
      for(let i = 1; fs.existsSync(path.join(dir, name)); i++) name = `${stamp(new Date(at.getTime() + i))}_${run}-${event}.enc`;
      write(name, jpeg);
      prune();
      return name;
    },
    // Never keep a photo of the owner: delete every image of that backend event.
    discardEvent(run, event){
      let removed = 0;
      for(const name of names()){
        const m = NAME.exec(name);
        if(m[2] === run && m[3] === String(event)){ fs.unlinkSync(path.join(dir, name)); removed++; }
      }
      return removed;
    },
    list(){
      return names().reverse().map((name) => ({ id:name, takenAt:takenAt(name) })); // newest first
    },
    count(){ return names().length; },
    read,
    remove(name){
      if(!NAME.test(name) || !fs.existsSync(path.join(dir, name))) throw new Error('Unknown image.');
      fs.unlinkSync(path.join(dir, name));
    },
    clear(){
      const all = names();
      for(const name of all) fs.unlinkSync(path.join(dir, name));
      return all.length;
    },
    prune,
    // Earlier versions stored plaintext JPEGs. Encrypt the newest `maxImages`, verify each by
    // reading it back, then delete every plaintext snapshot (ours only, by name).
    migrateLegacy(legacyDir){
      if(!fs.existsSync(legacyDir)) return { encrypted:0, deleted:0 };
      const legacy = fs.readdirSync(legacyDir).filter((n) => LEGACY_NAME.test(n)).sort();
      const keep = legacy.slice(-Math.max(1, Math.round(Number(maxImages()) || 30)));
      let encrypted = 0;
      for(const name of keep){
        const jpeg = fs.readFileSync(path.join(legacyDir, name));
        if(!isJpeg(jpeg) || jpeg.length > MAX_JPEG_BYTES * 4) continue;
        const [d, t, ms] = name.slice(0, -4).split('_');
        const stored = `${d}-${t}-${ms}_00000000-${encrypted + 1}.enc`;
        write(stored, jpeg);
        if(!read(stored).equals(jpeg)) throw new Error('Migration check failed; plaintext images kept.');
        encrypted++;
      }
      for(const name of legacy) fs.unlinkSync(path.join(legacyDir, name));
      prune();
      return { encrypted, deleted:legacy.length };
    }
  };
}

module.exports = { createEvidenceStore, NAME, isJpeg };
