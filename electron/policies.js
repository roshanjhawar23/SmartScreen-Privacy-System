// Privacy profiles and sensitive-application categories (config/policies.json).
// Pure: no Electron imports. The active profile name is persisted by main.js in userData.

const CURTAIN_EFFECTS = ['blackout','blur','pixelate'];

function num(value, fallback){
  if(value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function thresholds(raw, fallback){
  const t = raw && typeof raw === 'object' ? raw : {};
  return {
    blurMs:num(t.blurMs, fallback.blurMs),
    focusMs:num(t.focusMs, fallback.focusMs),
    lockMs:t.lockMs === null ? null : num(t.lockMs, fallback.lockMs)
  };
}

// Built-in profile used when policies.json is missing or a profile is invalid:
// matches the Phase 1 threat timings (blur at once, focus 3 s, lock 5 s).
const BASE_PROFILE = Object.freeze({
  glancingCounts:true,
  curtainEffect:'blackout',
  walkAwayLockDelay:6000,
  escalation:{ blurMs:0, focusMs:3000, lockMs:5000 },
  sensitiveEscalation:{ blurMs:0, focusMs:1000, lockMs:3000 },
  notLooking:{ blurMs:2000, lockMs:20000 }
});

function normalizeProfile(raw, base = BASE_PROFILE){
  const p = raw && typeof raw === 'object' ? raw : {};
  return {
    glancingCounts:typeof p.glancingCounts === 'boolean' ? p.glancingCounts : base.glancingCounts,
    curtainEffect:CURTAIN_EFFECTS.includes(p.curtainEffect) ? p.curtainEffect : base.curtainEffect,
    walkAwayLockDelay:Math.max(1000, num(p.walkAwayLockDelay, base.walkAwayLockDelay)),
    escalation:thresholds(p.escalation, base.escalation),
    sensitiveEscalation:thresholds(p.sensitiveEscalation, base.sensitiveEscalation),
    notLooking:thresholds(p.notLooking, base.notLooking)
  };
}

function normalizeApps(list){
  if(!Array.isArray(list)) return [];
  return list.filter((a) => a && typeof a.label === 'string').map((a) => ({
    id:String(a.id || a.label),
    label:a.label,
    processes:Array.isArray(a.processes) ? a.processes.map((p) => String(p).toLowerCase()) : [],
    titleKeywords:Array.isArray(a.titleKeywords) ? a.titleKeywords.map((k) => String(k).toLowerCase()).filter(Boolean) : []
  }));
}

function normalizePolicies(raw){
  const src = raw && typeof raw === 'object' ? raw : {};
  const profiles = {};
  for(const [name, profile] of Object.entries(src.profiles || {})){
    if(/^[\w .-]{1,32}$/.test(name)) profiles[name] = normalizeProfile(profile);
  }
  if(Object.keys(profiles).length === 0) profiles.Default = normalizeProfile({});
  const names = Object.keys(profiles);
  return {
    defaultProfile:names.includes(src.defaultProfile) ? src.defaultProfile : names[0],
    profiles,
    sensitiveApps:normalizeApps(src.sensitiveApps)
  };
}

function resolveProfileName(policies, requested){
  return Object.prototype.hasOwnProperty.call(policies.profiles, requested) ? requested : policies.defaultProfile;
}

function globToRegExp(glob){
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

// Friendly app name from the executable: "C:\...\OUTLOOK.EXE" → "Outlook".
function appDisplayName(processPath){
  const base = String(processPath || '').split(/[\\/]/).pop().replace(/\.exe$/i, '');
  return base ? base.charAt(0).toUpperCase() + base.slice(1).toLowerCase() : '';
}

// app: { process, title }. The title is only matched here, never stored or logged.
function matchSensitiveApp(app, sensitiveApps){
  if(!app || (!app.process && !app.title)) return null;
  const exe = String(app.process || '').split(/[\\/]/).pop().toLowerCase();
  const title = String(app.title || '').toLowerCase();
  for(const category of sensitiveApps){
    const byProcess = exe && category.processes.some((p) => globToRegExp(p).test(exe));
    const byTitle = title && category.titleKeywords.some((k) => title.includes(k));
    if(byProcess || byTitle) return { id:category.id, label:category.label, name:appDisplayName(app.process) || category.label };
  }
  return null;
}

module.exports = {
  BASE_PROFILE, normalizePolicies, normalizeProfile, resolveProfileName, matchSensitiveApp, appDisplayName, globToRegExp
};
