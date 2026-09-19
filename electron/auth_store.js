const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };

function getAuthFile(userDataPath) {
  return path.join(userDataPath, 'auth.json');
}

function readAuth(userDataPath) {
  const file = getAuthFile(userDataPath);

  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('Authentication data is unreadable.');
  }
}

function writeAuth(userDataPath, data) {
  const file = getAuthFile(userDataPath);
  const tempFile = `${file}.tmp`;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempFile, file);
}

function validateCredentials(username, password) {
  if (
    typeof username !== 'string' ||
    !/^[A-Za-z0-9._-]{3,32}$/.test(username.trim())
  ) {
    return 'Username must be 3–32 characters and use only letters, numbers, dot, underscore, or hyphen.';
  }

  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return 'Password must be 8–128 characters.';
  }

  return null;
}

function derivePassword(password, saltHex) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      Buffer.from(saltHex, 'hex'),
      KEY_LENGTH,
      SCRYPT_OPTIONS,
      (error, derivedKey) => {
        if (error) return reject(error);
        resolve(derivedKey);
      }
    );
  });
}

async function register(userDataPath, username, password) {
  const normalizedUsername = typeof username === 'string' ? username.trim() : '';
  const validationError = validateCredentials(normalizedUsername, password);

  if (validationError) return { ok: false, error: validationError };
  if (readAuth(userDataPath)) {
    return { ok: false, error: 'An account already exists on this device.' };
  }

  const salt = crypto.randomBytes(SALT_BYTES);
  const derivedKey = await derivePassword(password, salt.toString('hex'));

  writeAuth(userDataPath, {
    version: 1,
    username: normalizedUsername,
    salt: salt.toString('hex'),
    passwordHash: derivedKey.toString('hex'),
    createdAt: new Date().toISOString()
  });

  return { ok: true, username: normalizedUsername };
}

async function login(userDataPath, username, password) {
  const record = readAuth(userDataPath);

  if (!record) return { ok: false, error: 'No account is registered yet.' };

  const normalizedUsername = typeof username === 'string' ? username.trim() : '';
  if (normalizedUsername !== record.username) {
    return { ok: false, error: 'Invalid username or password.' };
  }

  if (
    typeof record.salt !== 'string' ||
    typeof record.passwordHash !== 'string'
  ) {
    return { ok: false, error: 'Authentication data is invalid.' };
  }

  try {
    const derivedKey = await derivePassword(password, record.salt);
    const expected = Buffer.from(record.passwordHash, 'hex');

    if (expected.length !== derivedKey.length || !crypto.timingSafeEqual(expected, derivedKey)) {
      return { ok: false, error: 'Invalid username or password.' };
    }
  } catch (error) {
    return { ok: false, error: 'Unable to verify the account.' };
  }

  return { ok: true, username: record.username };
}

function hasAccount(userDataPath) {
  return Boolean(readAuth(userDataPath));
}

module.exports = {
  register,
  login,
  hasAccount
};
