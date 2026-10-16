// Anomaly and tamper detection helpers. Pure: no Electron imports; clocks are injected.
//
// Each kind is its own event (TAMPER|<kind>|...). Kinds in FAILSAFE_KINDS put the Presence
// Gate into FAILSAFE while protection is on.

const crypto = require('crypto');

const FAILSAFE_KINDS = new Set([
  'camera-covered', 'feed-frozen', 'camera-device-changed', 'config-modified', 'ai-restart-loop', 'clock-jump'
]);
const MAJOR_CLOCK_JUMP_MS = 5 * 60 * 1000;

// HMAC-SHA256 of a config file's bytes. The key is random per installation and stored
// encrypted (safeStorage) by main.js, so a stored digest can't be forged without it.
function configDigest(key, buffer){
  return crypto.createHmac('sha256', key).update(buffer).digest('hex');
}

// Wall clock vs. monotonic clock. A difference beyond thresholdMs between two checks means the
// system clock was changed. Call reset() around sleep/resume (monotonic time may pause).
function createClockMonitor({ wallNow = () => Date.now(), monoNow = () => performance.now(), thresholdMs = 30000 } = {}){
  let wall = wallNow();
  let mono = monoNow();
  return {
    check(){
      const w = wallNow(), m = monoNow();
      const jumpMs = (w - wall) - (m - mono);
      wall = w; mono = m;
      if(Math.abs(jumpMs) < thresholdMs) return null;
      return { jumpMs:Math.round(jumpMs), major:Math.abs(jumpMs) >= MAJOR_CLOCK_JUMP_MS };
    },
    reset(){ wall = wallNow(); mono = monoNow(); }
  };
}

// Repeated AI failures: trips once when `limit` failures fall inside `windowMs`.
function createRestartLoopDetector({ windowMs = 10 * 60 * 1000, limit = 3 } = {}){
  let failures = [];
  let tripped = false;
  return {
    record(now){
      failures = failures.filter((t) => now - t < windowMs).concat(now);
      if(failures.length < limit){ tripped = false; return false; }
      if(tripped) return false;
      tripped = true;
      return true;
    },
    get count(){ return failures.length; }
  };
}

// Video input set change (device unplugged, swapped or added) as compact counts.
function diffDevices(baseline, current){
  const before = new Set(baseline), after = new Set(current);
  const added = [...after].filter((d) => !before.has(d)).length;
  const removed = [...before].filter((d) => !after.has(d)).length;
  return added || removed ? { added, removed } : null;
}

module.exports = { FAILSAFE_KINDS, MAJOR_CLOCK_JUMP_MS, configDigest, createClockMonitor, createRestartLoopDetector, diffDevices };
