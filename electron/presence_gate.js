// Presence Gate: the screen is visible only while the enrolled owner is reliably recognized.
// Pure: no Electron imports. Clock, timers and side effects are injected.
//
// States: DISABLED, CONCEALED, VERIFYING, REVEALED, ABSENCE_GRACE, FAILSAFE.
// The curtain is up in CONCEALED, VERIFYING and FAILSAFE.
//
// The gate toggle controls hiding the screen while the owner is not verified. A monitoring
// failure while protection is active enters FAILSAFE even with the toggle off (fail closed).
// The gate never unlocks or authenticates Windows; `lock` only locks it.

const STATES = Object.freeze({
  DISABLED:'DISABLED',
  CONCEALED:'CONCEALED',
  VERIFYING:'VERIFYING',
  REVEALED:'REVEALED',
  ABSENCE_GRACE:'ABSENCE_GRACE',
  FAILSAFE:'FAILSAFE'
});
const CURTAIN_STATES = new Set([STATES.CONCEALED, STATES.VERIFYING, STATES.FAILSAFE]);
const THREAT_STATES = new Set(['UNKNOWN_PERSON','UNKNOWN_GROUP','OWNER_AND_UNKNOWN']);
const CURTAIN_EFFECTS = ['blackout','blur','pixelate'];

function num(value, fallback){
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

function gateSettings(settings = {}){
  const g = settings.presenceGate || {};
  const failsafeLockMs = num(g.failsafeLockMs, 0);
  return {
    enabled:g.enabled !== false,
    revealConfirmMs:Math.max(0, num(g.revealConfirmMs, 1200)),
    revealConfirmUpdates:Math.max(1, Math.round(num(g.revealConfirmUpdates, 3))),
    absenceGraceMs:Math.max(0, num(g.absenceGraceMs, 1500)),
    failsafeLockMs:failsafeLockMs > 0 ? failsafeLockMs : 0,
    curtainEffect:CURTAIN_EFFECTS.includes(g.curtainEffect) ? g.curtainEffect : 'blackout',
    requireLiveness:g.requireLiveness !== false,
    minOwnerScore:num(g.minOwnerScore, num(settings.recognitionThreshold, 0.363))
  };
}

function createPresenceGate(deps = {}){
  const {
    getSettings = () => ({}),
    onChange = () => {},
    log = () => {},
    lock = () => {},
    timers = { setTimeout, clearTimeout, now:() => performance.now() } // monotonic
  } = deps;

  let state = STATES.DISABLED;
  let reason = 'initial';
  let active = false;
  let sessionLocked = false; // never reveal behind a locked Windows session
  let enabled = gateSettings(getSettings()).enabled;
  let verifyCount = 0;
  let verifyStart = 0;
  let graceTimer = null;
  let failsafeTimer = null;

  const config = () => gateSettings(getSettings());

  function snapshot(){
    return {
      state,
      reason,
      curtain:CURTAIN_STATES.has(state),
      effect:config().curtainEffect,
      enabled,
      active
    };
  }

  function clearTimers(){
    if(graceTimer){ timers.clearTimeout(graceTimer); graceTimer = null; }
    if(failsafeTimer){ timers.clearTimeout(failsafeTimer); failsafeTimer = null; }
  }

  function transition(next, why){
    if(next === state) return;
    clearTimers();
    if(next !== STATES.VERIFYING) verifyCount = 0;
    state = next;
    reason = why;
    log(`PRESENCE_GATE|${next}|reason=${why}`);
    onChange(snapshot());
  }

  // Target once the owner is verified: REVEALED, or "off" when the toggle is off.
  const verifiedState = () => (enabled ? STATES.REVEALED : STATES.DISABLED);

  function conceal(why){
    if(state === STATES.FAILSAFE) return;
    if(!enabled && state === STATES.DISABLED) return;
    transition(STATES.CONCEALED, why);
  }

  function ownerUpdate(){
    const now = timers.now();
    if(sessionLocked) return;
    if(state === STATES.REVEALED || (state === STATES.DISABLED && !enabled)) return;
    if(state === STATES.ABSENCE_GRACE){
      transition(STATES.REVEALED, 'owner-returned');
      return;
    }
    if(state === STATES.CONCEALED){
      transition(STATES.VERIFYING, 'owner-detected');
      verifyCount = 1;
      verifyStart = now;
    }else if(state === STATES.VERIFYING){
      verifyCount += 1;
    }
    const c = config();
    if(state === STATES.VERIFYING && verifyCount >= c.revealConfirmUpdates && now - verifyStart >= c.revealConfirmMs){
      transition(verifiedState(), 'owner-verified');
    }
  }

  // Liveness of the owner's face (heuristic, Phase 3). Not required → treated as LIVE.
  function ownerLiveness(payload){
    if(!config().requireLiveness) return 'LIVE';
    const owners = (payload.tracks || []).filter((t) => t.role === 'owner');
    if(owners.length === 0) return 'MISSING';
    if(owners.some((t) => t.liveness === 'SUSPECT')) return 'SUSPECT';
    return owners.some((t) => t.liveness === 'LIVE') ? 'LIVE' : 'UNKNOWN';
  }

  function notOwner(why){
    if(state === STATES.VERIFYING) transition(STATES.CONCEALED, why);
    else if(state === STATES.REVEALED) startGrace(why);
  }

  function startGrace(why){
    transition(STATES.ABSENCE_GRACE, why);
    graceTimer = timers.setTimeout(() => {
      graceTimer = null;
      if(state === STATES.ABSENCE_GRACE) transition(STATES.CONCEALED, 'owner-absent');
    }, config().absenceGraceMs);
  }

  // Identity state from the backend (via main.js).
  function update(identityState, payload = {}){
    if(!active || state === STATES.FAILSAFE) return;

    if(identityState === 'OWNER_PRESENT'){
      const ownerOk = Number(payload.owners ?? 1) >= 1
        && Number(payload.unknown ?? 0) === 0
        && Number(payload.ownerScore ?? 0) >= config().minOwnerScore;
      if(!ownerOk){ notOwner('owner-score-below-threshold'); return; }
      const liveness = ownerLiveness(payload);
      if(liveness === 'SUSPECT') notOwner('liveness-suspect');
      else if(liveness === 'MISSING') notOwner('liveness-unavailable');
      else if(liveness === 'LIVE') ownerUpdate();
      // UNKNOWN: no evidence yet; neither count nor reset
    }else if(THREAT_STATES.has(identityState)){
      conceal(`threat-${identityState.toLowerCase()}`);
    }else if(identityState === 'NO_USER'){
      if(state === STATES.REVEALED) startGrace('no-user');
      else notOwner('owner-absent');
    }else if(identityState === 'STARTING'){
      // nothing to decide yet
    }else{
      failsafe(identityState === 'CAMERA_ERROR' || identityState === 'AI_UNAVAILABLE'
        ? identityState.toLowerCase().replace('_', '-')
        : `unknown-state-${identityState}`);
    }
  }

  function failsafe(why){
    if(!active) return;
    if(state === STATES.FAILSAFE) return;
    transition(STATES.FAILSAFE, why);
    const lockMs = config().failsafeLockMs;
    if(lockMs > 0){
      failsafeTimer = timers.setTimeout(() => {
        failsafeTimer = null;
        if(state !== STATES.FAILSAFE) return;
        log(`PRESENCE_GATE|FAILSAFE_LOCK|reason=${reason}`);
        lock('presence-gate-failsafe');
      }, lockMs);
    }
  }

  return {
    // Protection enabled: the curtain goes up before the camera starts.
    start(){
      active = true;
      enabled = config().enabled && enabled;
      if(enabled) transition(STATES.CONCEALED, 'protection-enabled');
      else onChange(snapshot());
    },
    // Protection disabled (confirmed) or app quit: the only manual way to remove the curtain.
    stop(why = 'protection-disabled'){
      active = false;
      transition(STATES.DISABLED, why);
    },
    update,
    failsafe,
    // Leaving FAILSAFE requires a retry followed by normal owner verification.
    retry(){
      if(state !== STATES.FAILSAFE) return false;
      transition(STATES.CONCEALED, 'retry');
      return true;
    },
    sessionLocked(){
      sessionLocked = true;
      if(active) conceal('session-locked');
    },
    sessionUnlocked(){
      sessionLocked = false;
      if(active) conceal('session-unlocked');
    },
    resumed(){ if(active) conceal('system-resumed'); },
    // The toggle can only change while protection is off (rule 6: no silent curtain removal).
    setEnabled(value){
      if(active) return false;
      enabled = Boolean(value);
      onChange(snapshot());
      return true;
    },
    // Settings changed (e.g. profile switch → curtain effect): re-publish the snapshot.
    refresh(){ onChange(snapshot()); },
    get state(){ return state; },
    get curtain(){ return CURTAIN_STATES.has(state); },
    snapshot
  };
}

module.exports = { createPresenceGate, gateSettings, STATES, CURTAIN_STATES };
