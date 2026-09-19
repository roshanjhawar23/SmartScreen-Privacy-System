const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');

function getBiometricDirectory(userDataPath) {
  return path.join(userDataPath, 'biometric');
}

function getTemplateFile(userDataPath) {
  return path.join(getBiometricDirectory(userDataPath), 'owner_face.enc');
}

function saveTemplate(userDataPath, template) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-backed encryption is unavailable.');
  }

  const directory = getBiometricDirectory(userDataPath);
  fs.mkdirSync(directory, { recursive: true });

  const encrypted = safeStorage.encryptString(JSON.stringify(template));
  fs.writeFileSync(getTemplateFile(userDataPath), encrypted.toString('base64'), 'utf8');
}

function readTemplate(userDataPath) {
  const file = getTemplateFile(userDataPath);

  if (!fs.existsSync(file)) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-backed encryption is unavailable.');
  }

  const encoded = fs.readFileSync(file, 'utf8').trim();
  if (!encoded) return null;

  const encrypted = Buffer.from(encoded, 'base64');
  return JSON.parse(safeStorage.decryptString(encrypted));
}

function hasTemplate(userDataPath) {
  return fs.existsSync(getTemplateFile(userDataPath));
}

module.exports = {
  saveTemplate,
  readTemplate,
  hasTemplate,
  getTemplateFile
};
