// Encrypted settings export / import (Phase 4). Pure: Node crypto only.
//
// For moving preferences to another device. safeStorage is device-bound, so the bundle is
// encrypted with a passphrase instead: scrypt (N=2^15) → AES-256-GCM. Only an allow-listed set
// of preference keys can be exported or imported; biometric templates, logs and images are
// never part of a bundle (and are rejected if someone adds them by hand).

const crypto = require('crypto');

const FORMAT = 'smartscreen-settings';
const VERSION = 1;
const SCRYPT = { N:1 << 15, r:8, p:1, maxmem:64 * 1024 * 1024 };
const ALLOWED_KEYS = ['customProfiles', 'rules', 'autoSwitch', 'activeProfile', 'presenceGateEnabled', 'intensity'];
const FORBIDDEN = /embedding|template|biometric|\.enc|\.jpg|\.png|activity\.log/i;

function checkPassphrase(passphrase){
  if(typeof passphrase !== 'string' || passphrase.length < 8) throw new Error('Passphrase must be at least 8 characters.');
}

function pick(data){
  const out = {};
  for(const key of ALLOWED_KEYS) if(data && data[key] !== undefined) out[key] = data[key];
  if(FORBIDDEN.test(JSON.stringify(out))) throw new Error('Settings bundles never contain biometric data.');
  return out;
}

function key(passphrase, salt){
  return crypto.scryptSync(passphrase, salt, 32, SCRYPT);
}

function exportBundle(data, passphrase, { now = () => new Date() } = {}){
  checkPassphrase(passphrase);
  const payload = Buffer.from(JSON.stringify({ exportedAt:now().toISOString(), settings:pick(data) }), 'utf8');
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(passphrase, salt), iv);
  cipher.setAAD(Buffer.from(`${FORMAT}/${VERSION}`));
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  return JSON.stringify({
    format:FORMAT, version:VERSION, kdf:'scrypt', cipher:'aes-256-gcm',
    salt:salt.toString('base64'), iv:iv.toString('base64'),
    tag:cipher.getAuthTag().toString('base64'), data:ciphertext.toString('base64')
  }, null, 2);
}

function importBundle(text, passphrase){
  checkPassphrase(passphrase);
  let bundle;
  try{ bundle = JSON.parse(text); }catch{ throw new Error('Not a SmartScreen settings file.'); }
  if(bundle?.format !== FORMAT || bundle.version !== VERSION) throw new Error('Not a SmartScreen settings file.');
  let payload;
  try{
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(passphrase, Buffer.from(bundle.salt, 'base64')), Buffer.from(bundle.iv, 'base64'));
    decipher.setAAD(Buffer.from(`${FORMAT}/${VERSION}`));
    decipher.setAuthTag(Buffer.from(bundle.tag, 'base64'));
    payload = Buffer.concat([decipher.update(Buffer.from(bundle.data, 'base64')), decipher.final()]);
  }catch{
    throw new Error('Wrong passphrase or damaged file.');
  }
  const parsed = JSON.parse(payload.toString('utf8'));
  return { exportedAt:parsed.exportedAt, settings:pick(parsed.settings) };
}

module.exports = { exportBundle, importBundle, ALLOWED_KEYS };
