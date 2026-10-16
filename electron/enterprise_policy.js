// Enterprise policy (Phase 4 scaffold). Pure: no Electron imports.
//
// A read-only JSON file written by an administrator (default %ProgramData%\SmartScreen\policy.json).
// SmartScreen never writes it. Unknown keys are ignored; invalid values are ignored. The policy is
// enforced in the main process; the UI only shows locked controls as locked.
//
// {
//   "minimumIntensity": 60,            // privacy intensity floor (0–100)
//   "presenceGateRequired": true,      // Presence Gate cannot be switched off
//   "allowDisableProtection": false,   // "Disable Protection" is refused
//   "allowQuit": false,                // tray Exit is refused while protection is on
//   "allowedProfiles": ["Office"],     // others are hidden; the first is the default
//   "maxWalkAwayLockDelayMs": 6000,    // profile walk-away delays are capped
//   "lockProfiles": true,              // no creating/editing/deleting profiles or rules
//   "lockTrustedPeople": true,         // no adding/renaming/removing trusted people
//   "lockImport": true                 // no settings import
// }

const DEFAULTS = Object.freeze({
  managed:false,
  minimumIntensity:0,
  presenceGateRequired:false,
  allowDisableProtection:true,
  allowQuit:true,
  allowedProfiles:null,
  maxWalkAwayLockDelayMs:null,
  lockProfiles:false,
  lockTrustedPeople:false,
  lockImport:false
});

function parsePolicy(text){
  if(text === null || text === undefined) return { ...DEFAULTS };
  let raw;
  try{ raw = JSON.parse(text); }catch{ return { ...DEFAULTS, managed:true, error:'Invalid policy file (ignored).' }; }
  if(!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULTS, managed:true, error:'Invalid policy file (ignored).' };

  const p = { ...DEFAULTS, managed:true };
  const bool = (key) => { if(typeof raw[key] === 'boolean') p[key] = raw[key]; };
  ['presenceGateRequired', 'allowDisableProtection', 'allowQuit', 'lockProfiles', 'lockTrustedPeople', 'lockImport'].forEach(bool);
  const level = Number(raw.minimumIntensity);
  if(Number.isFinite(level)) p.minimumIntensity = Math.min(100, Math.max(0, Math.round(level)));
  const maxDelay = Number(raw.maxWalkAwayLockDelayMs);
  if(Number.isFinite(maxDelay) && maxDelay >= 1000) p.maxWalkAwayLockDelayMs = Math.round(maxDelay);
  if(Array.isArray(raw.allowedProfiles)){
    const names = raw.allowedProfiles.filter((n) => typeof n === 'string' && n.length <= 32);
    if(names.length) p.allowedProfiles = names;
  }
  return p;
}

// Profiles visible under the policy (keeps order); never empty.
function allowedProfileNames(policy, names){
  if(!policy.allowedProfiles) return names;
  const allowed = names.filter((n) => policy.allowedProfiles.includes(n));
  return allowed.length ? allowed : names.slice(0, 1);
}

function clampIntensity(policy, level){
  return Math.max(policy.minimumIntensity, level);
}

function clampWalkAwayDelay(policy, ms){
  return policy.maxWalkAwayLockDelayMs ? Math.min(policy.maxWalkAwayLockDelayMs, ms) : ms;
}

// What the renderer needs to show locked controls.
function uiView(policy){
  return {
    managed:policy.managed,
    minimumIntensity:policy.minimumIntensity,
    presenceGateRequired:policy.presenceGateRequired,
    allowDisableProtection:policy.allowDisableProtection,
    lockProfiles:policy.lockProfiles,
    lockTrustedPeople:policy.lockTrustedPeople,
    lockImport:policy.lockImport,
    error:policy.error || null
  };
}

module.exports = { DEFAULTS, parsePolicy, allowedProfileNames, clampIntensity, clampWalkAwayDelay, uiView };
