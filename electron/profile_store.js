// User profiles (Phase 4): custom profiles and auto-switch rules, stored in userData/profiles.json
// next to the read-only built-in profiles of config/policies.json. Pure: no Electron imports.
//
// Custom profiles are edited with four choices only (no sliders): curtain effect, sensitivity
// (relaxed / normal / strict = the Home / Office / Public timings), walk-away lock delay and
// whether glancing counts. The full profile is built from the built-in base for the sensitivity.

const { normalizeProfile } = require('./policies');

const SENSITIVITY_BASE = Object.freeze({ relaxed:'Home', normal:'Office', strict:'Public' });
const WALK_AWAY_OPTIONS = Object.freeze([4000, 6000, 10000, 15000, 30000]);
const CURTAINS = ['blackout', 'blur', 'pixelate'];
const NAME_PATTERN = /^[\w .-]{1,32}$/;

function emptyUserProfiles(){
  return { version:1, custom:{}, rules:[], autoSwitch:false };
}

function validateEditable(raw = {}){
  return {
    curtainEffect:CURTAINS.includes(raw.curtainEffect) ? raw.curtainEffect : 'blackout',
    sensitivity:Object.prototype.hasOwnProperty.call(SENSITIVITY_BASE, raw.sensitivity) ? raw.sensitivity : 'normal',
    walkAwayLockDelay:WALK_AWAY_OPTIONS.includes(Number(raw.walkAwayLockDelay)) ? Number(raw.walkAwayLockDelay) : 6000,
    glancingCounts:raw.glancingCounts !== false
  };
}

function normalizeUserProfiles(raw){
  const src = raw && typeof raw === 'object' ? raw : {};
  const custom = {};
  for(const [name, editable] of Object.entries(src.custom || {})){
    if(NAME_PATTERN.test(name)) custom[name] = validateEditable(editable);
  }
  const rules = (Array.isArray(src.rules) ? src.rules : []).map(normalizeRule).filter(Boolean);
  return { version:1, custom, rules, autoSwitch:src.autoSwitch === true };
}

function normalizeRule(rule){
  if(!rule || typeof rule.profile !== 'string') return null;
  const id = typeof rule.id === 'string' && /^[\w-]{1,40}$/.test(rule.id) ? rule.id : null;
  if(!id) return null;
  if(rule.type === 'wifi' && typeof rule.ssid === 'string' && rule.ssid.length > 0 && rule.ssid.length <= 32){
    return { id, type:'wifi', profile:rule.profile, ssid:rule.ssid };
  }
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if(rule.type === 'time' && hhmm.test(rule.from) && hhmm.test(rule.to)){
    const days = Array.isArray(rule.days) ? [...new Set(rule.days.map(Number).filter((d) => d >= 0 && d <= 6))] : [0, 1, 2, 3, 4, 5, 6];
    return { id, type:'time', profile:rule.profile, from:rule.from, to:rule.to, days:days.length ? days : [0, 1, 2, 3, 4, 5, 6] };
  }
  return null;
}

// Full profile for a custom definition, from its built-in base.
function buildCustomProfile(editable, builtIns){
  const base = builtIns[SENSITIVITY_BASE[editable.sensitivity]] || Object.values(builtIns)[0];
  return normalizeProfile({
    ...base,
    curtainEffect:editable.curtainEffect,
    walkAwayLockDelay:editable.walkAwayLockDelay,
    glancingCounts:editable.glancingCounts
  });
}

// Built-in policies + custom profiles (custom names never replace built-ins).
function mergePolicies(policies, user){
  const profiles = { ...policies.profiles };
  for(const [name, editable] of Object.entries(user.custom)){
    if(!Object.prototype.hasOwnProperty.call(policies.profiles, name)) profiles[name] = buildCustomProfile(editable, policies.profiles);
  }
  return { ...policies, profiles };
}

// What the panel editor shows for any profile; built-ins are read-only.
function describeProfile(name, policies, user){
  if(Object.prototype.hasOwnProperty.call(user.custom, name)) return { name, readOnly:false, ...user.custom[name] };
  const p = policies.profiles[name];
  if(!p) return null;
  const sensitivity = Object.entries(SENSITIVITY_BASE).find(([, base]) => base === name)?.[0] || 'normal';
  return { name, readOnly:true, curtainEffect:p.curtainEffect, sensitivity, walkAwayLockDelay:p.walkAwayLockDelay, glancingCounts:p.glancingCounts };
}

function saveCustom(user, name, editable, builtInNames){
  const clean = String(name || '').trim();
  if(!NAME_PATTERN.test(clean)) throw new Error('Profile name: 1–32 letters, digits, space, dot or dash.');
  if(builtInNames.includes(clean)) throw new Error('Built-in profiles cannot be changed; save under a new name.');
  return { ...user, custom:{ ...user.custom, [clean]:validateEditable(editable) } };
}

function deleteCustom(user, name){
  if(!Object.prototype.hasOwnProperty.call(user.custom, name)) throw new Error('Only custom profiles can be deleted.');
  const custom = { ...user.custom };
  delete custom[name];
  return { ...user, custom, rules:user.rules.filter((r) => r.profile !== name) };
}

module.exports = {
  SENSITIVITY_BASE, WALK_AWAY_OPTIONS, emptyUserProfiles, normalizeUserProfiles, normalizeRule,
  validateEditable, buildCustomProfile, mergePolicies, describeProfile, saveCustom, deleteCustom
};
