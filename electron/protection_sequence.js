// Automatic protection escalation (walk-away and threat sequences).
// Pure: no Electron imports. Timers, clock and side effects are injected.
//
// Threat escalation is decided by the policy engine (Phase 2): while a threat lasts, the
// latest backend update is re-evaluated every 250 ms and the sequence only escalates
// (BLUR → FOCUS → LOCK). Each escalation is logged with its reason.

const { decide, ACTIONS } = require('./policy_engine');

const THREAT_STATES = new Set(['UNKNOWN_PERSON','UNKNOWN_GROUP','OWNER_AND_UNKNOWN']);
const THREAT_TICK_MS = 250;

function numberSetting(value, fallback){
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

// Default evaluator (no profiles): Phase 1 timings from settings, with track data if present.
function settingsEvaluator(getSettings){
  return ({ state, payload, threatMs, ageMs }) => {
    const s = getSettings();
    const focusMs = Math.max(0, numberSetting(s.intruderFocusDelay, 3000));
    const lockMs = Math.max(focusMs, numberSetting(s.intruderLockDelay, 5000));
    const t = { blurMs:0, focusMs, lockMs };
    const profile = { glancingCounts:true, escalation:t, sensitiveEscalation:t, notLooking:t };
    return decide({ state, tracks:payload?.tracks, profile, profileName:'Default', threatMs, ageMs });
  };
}

function createProtectionSequence(deps){
  const {
    getSettings = () => ({}),
    isMonitoring = () => true,
    sendAction = () => {},
    sendWalkAwayStatus = () => {},
    log = () => {},
    lock = () => {},
    evaluateThreat = null,
    // Monotonic clock: deadlines and threat durations must not move with the system clock.
    timers = {
      setTimeout, clearTimeout, setInterval, clearInterval, now: () => performance.now()
    }
  } = deps;

  let active = null;
  let walkAwayTimer = null;
  let walkAwayCountdownTimer = null;
  let walkAwayFocusTimer = null;
  let threatTick = null;
  let threatStart = 0;
  let threatStage = 'NONE';
  let threatState = null;
  let threatPayload = null;
  let threatPayloadAt = 0;
  let walkAwayDeadline = 0;
  const evaluate = evaluateThreat || settingsEvaluator(getSettings);

  function clearThreatTick(){
    if(threatTick){ timers.clearInterval(threatTick); threatTick=null; }
  }

  function clearWalkAwayTimers(){
    if(walkAwayTimer){ timers.clearTimeout(walkAwayTimer); walkAwayTimer=null; }
    if(walkAwayCountdownTimer){ timers.clearInterval(walkAwayCountdownTimer); walkAwayCountdownTimer=null; }
    if(walkAwayFocusTimer){ timers.clearTimeout(walkAwayFocusTimer); walkAwayFocusTimer=null; }
    walkAwayDeadline=0;
  }

  function cancel(reason='state-change'){
    clearWalkAwayTimers();
    clearThreatTick();
    if(active){
      log(`PROTECTION_SEQUENCE_CANCELLED|type=${active}|reason=${reason}`);
      active=null;
      sendAction('CLEAR', reason);
    }
  }

  function cancelWalkAway(reason='state-change'){
    if(walkAwayTimer || walkAwayCountdownTimer || walkAwayFocusTimer){
      clearWalkAwayTimers();
      log(`WALK_AWAY_TIMER_CANCELLED|reason=${reason}`);
      sendWalkAwayStatus('CANCELLED',0);
    }
  }

  function armWalkAway(){
    const settings = getSettings();
    if(!isMonitoring() || active === 'WALK_AWAY') return;
    if(settings.noUserLockEnabled === false) return;
    cancel('new-walk-away');

    const delay = Math.max(1000, numberSetting(settings.walkAwayLockDelay, 6000));
    const focusDelay = Math.min(delay - 250, Math.max(0, numberSetting(settings.walkAwayFocusDelay, 3000)));

    active='WALK_AWAY';
    sendAction('BLUR','walk-away');
    log(`WALK_AWAY_TIMER_ARMED|delayMs=${delay}|focusDelayMs=${focusDelay}`);
    walkAwayDeadline=timers.now()+delay;
    sendWalkAwayStatus('ARMED',delay);

    walkAwayFocusTimer=timers.setTimeout(()=>{
      walkAwayFocusTimer=null;
      if(active !== 'WALK_AWAY') return;
      sendAction('FOCUS','walk-away');
      log('WALK_AWAY_FOCUS_ACTIVATED');
    },focusDelay);

    walkAwayCountdownTimer=timers.setInterval(()=>{
      const remainingMs=Math.max(0,walkAwayDeadline-timers.now());
      sendWalkAwayStatus('COUNTDOWN',remainingMs);
      if(remainingMs<=0 && walkAwayCountdownTimer){
        timers.clearInterval(walkAwayCountdownTimer);
        walkAwayCountdownTimer=null;
      }
    },250);

    walkAwayTimer=timers.setTimeout(()=>{
      walkAwayTimer=null;
      clearWalkAwayTimers();
      if(active !== 'WALK_AWAY') return;
      log('WALK_AWAY_TIMER_EXPIRED');
      sendWalkAwayStatus('EXPIRED',0);
      sendAction('LOCKING','walk-away');
      lock('walk-away');
    },delay);
  }

  function evaluateCurrentThreat(){
    if(active !== 'THREAT') return;
    const now = timers.now();
    const decision = evaluate({
      state:threatState, payload:threatPayload, threatMs:now - threatStart, ageMs:now - threatPayloadAt
    });
    if(ACTIONS.indexOf(decision.action) <= ACTIONS.indexOf(threatStage)) return;
    threatStage = decision.action;
    log(`POLICY_DECISION|action=${decision.action}|reason=${decision.reason}`);
    if(decision.action === 'BLUR'){
      sendAction('BLUR','threat');
    }else if(decision.action === 'FOCUS'){
      sendAction('FOCUS','threat');
      log('THREAT_FOCUS_ACTIVATED');
    }else if(decision.action === 'LOCK'){
      clearThreatTick();
      sendAction('LOCKING','threat');
      log('THREAT_LOCK_TRIGGERED');
      lock('privacy-threat');
    }
  }

  function startThreat(state, payload){
    const settings = getSettings();
    if(!isMonitoring() || active === 'THREAT') return;
    if(settings.intruderDetectionEnabled === false) return;
    cancel('new-threat');
    active='THREAT';
    threatStart=timers.now();
    threatStage='NONE';
    threatState=state;
    threatPayload=payload;
    threatPayloadAt=threatStart;
    evaluateCurrentThreat();
    if(active === 'THREAT' && threatStage !== 'LOCK') threatTick=timers.setInterval(evaluateCurrentThreat, THREAT_TICK_MS);
  }

  function updateForState(state, payload = {}){
    if(state === 'NO_USER'){
      if(active !== 'WALK_AWAY') armWalkAway();
    }else if(state === 'OWNER_PRESENT'){
      // Owner alone again: a walk-away or a threat that has ended is cancelled
      // (owner decision 2026-10-16). The Presence Gate still re-verifies before revealing.
      if(active === 'WALK_AWAY' || active === 'THREAT') cancel('owner-returned');
      cancelWalkAway('owner-present');
    }else if(THREAT_STATES.has(state)){
      if(active === 'WALK_AWAY') cancel('privacy-threat');
      if(active !== 'THREAT') startThreat(state, payload);
      else{
        threatState=state;
        threatPayload=payload;
        threatPayloadAt=timers.now();
        evaluateCurrentThreat();
      }
    }else{
      // CAMERA_ERROR, AI_UNAVAILABLE or an unknown state: monitoring is no longer reliable.
      handleMonitorFailure(`state-${state}`);
    }
  }

  // Called when monitoring fails (AI error, camera error, watchdog, unexpected exit).
  // Fail closed: timers stop, but the current effects stay on (no CLEAR). The
  // Presence Gate FAILSAFE curtain takes over concealment.
  function handleMonitorFailure(reason='ai-failed'){
    const hadTimers = Boolean(walkAwayTimer || walkAwayCountdownTimer || walkAwayFocusTimer || threatTick);
    clearWalkAwayTimers();
    clearThreatTick();
    if(active || hadTimers){
      log(`PROTECTION_SEQUENCE_HALTED|type=${active || 'NONE'}|reason=${reason}`);
      sendWalkAwayStatus('CANCELLED',0);
    }
    active=null;
  }

  // Called when the user deliberately disables protection.
  function stop(reason='ai-stopped'){
    cancel(reason);
    cancelWalkAway(reason);
  }

  return {
    updateForState,
    cancel,
    cancelWalkAway,
    handleMonitorFailure,
    stop,
    get active(){ return active; }
  };
}

module.exports = { createProtectionSequence, THREAT_STATES };
