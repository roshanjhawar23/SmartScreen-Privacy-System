const fs = require('fs');
const path = require('path');
const os = require('os');

function getProfileFile(userDataPath) {
  return path.join(userDataPath, 'device_profile.json');
}

function readProfile(userDataPath) {
  const file = getProfileFile(userDataPath);

  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('Device profile is unreadable.');
  }
}

function isConfigured(userDataPath) {
  const profile = readProfile(userDataPath);
  return Boolean(profile?.setupComplete);
}

function createProfile(userDataPath) {
  const file = getProfileFile(userDataPath);
  const tempFile = `${file}.tmp`;

  const profile = {
    version: 1,
    setupComplete: true,
    windowsUser: os.userInfo().username,
    createdAt: new Date().toISOString(),
    biometric: {
      enrolled: false,
      version: 1,
      templateType: 'sface-cosine'
    }
  };

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tempFile, JSON.stringify(profile, null, 2), 'utf8');
  fs.renameSync(tempFile, file);

  return profile;
}

function markBiometricEnrolled(userDataPath, metadata = {}) {
  const profile = readProfile(userDataPath);
  if (!profile?.setupComplete) {
    throw new Error('Device profile is not configured.');
  }

  profile.biometric = {
    ...(profile.biometric || {}),
    enrolled: true,
    version: 1,
    templateType: 'sface-cosine',
    enrolledAt: new Date().toISOString(),
    sampleCount: Number(metadata.sampleCount || 0)
  };

  const file = getProfileFile(userDataPath);
  const tempFile = `${file}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(profile, null, 2), 'utf8');
  fs.renameSync(tempFile, file);
  return profile;
}

module.exports = {
  readProfile,
  isConfigured,
  createProfile,
  markBiometricEnrolled
};
