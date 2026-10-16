// Automatic protection escalation (walk-away and threat sequences).
// Pure: no Electron imports. Timers, clock and side effects are injected.

const THREAT_STATES = new Set(['UNKNOWN_PERSON','UNKNOWN_GROUP','OWNER_AND_UNKNOWN']);

function numberSetting(value, fallback){
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

function createProtectionSequence(deps){
  const {
    getSettings = () => ({}),
    isMonitoring = () => true,
    sendAction = () => {},
    sendWalkAwayStatus = () => {},
    log = () => {},
    lock = () => {},
    timers = {
      setTimeout, clearTimeout, setInterval, clearInterval, now: () => Date.now()
    }
  } = deps;

  let active = null;
  let walkAwayTimer = null;
  let walkAwayCountdownTimer = null;
  let walkAwayFocusTimer = null;
  let threatLockTimer = null;
  let threatFocusTimer = null;
  let walkAwayDeadline = 0;

  function clearWalkAwayTimers(){
    if(walkAwayTimer){ timers.clearTimeout(walkAwayTimer); walkAwayTimer=null; }
    if(walkAwayCountdownTimer){ timers.clearInterval(walkAwayCountdownTimer); walkAwayCountdownTimer=null; }
    if(walkAwayFocusTimer){ timers.clearTimeout(walkAwayFocusTimer); walkAwayFocusTimer=null; }
    walkAwayDeadline=0;
  }

  function cancel(reason='state-change'){
    clearWalkAwayTimers();
    if(threatFocusTimer){ timers.clearTimeout(threatFocusTimer); threatFocusTimer=null; }
    if(threatLockTimer){ timers.clearTimeout(threatLockTimer); threatLockTimer=null; }
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

  function startThreat(){
    const settings = getSettings();
    if(!isMonitoring() || active === 'THREAT') return;
    if(settings.intruderDetectionEnabled === false) return;
    cancel('new-threat');
    active='THREAT';

    const focusDelay=Math.max(0,numberSetting(settings.intruderFocusDelay,3000));
    const lockDelay=Math.max(focusDelay,numberSetting(settings.intruderLockDelay,5000));

    sendAction('BLUR','threat');
    threatFocusTimer=timers.setTimeout(()=>{
      threatFocusTimer=null;
      if(active !== 'THREAT') return;
      sendAction('FOCUS','threat');
      log('THREAT_FOCUS_ACTIVATED');
    },focusDelay);

    threatLockTimer=timers.setTimeout(()=>{
      threatLockTimer=null;
      if(active !== 'THREAT') return;
      sendAction('LOCKING','threat');
      log('THREAT_LOCK_TIMER_EXPIRED');
      lock('privacy-threat');
    },lockDelay);
  }

  function updateForState(state){
    if(state === 'NO_USER'){
      if(active !== 'WALK_AWAY') armWalkAway();
    }else if(state === 'OWNER_PRESENT'){
      // Owner alone again: a walk-away or a threat that has ended is cancelled
      // (owner decision 2026-10-16). The Presence Gate still re-verifies before revealing.
      if(active === 'WALK_AWAY' || active === 'THREAT') cancel('owner-returned');
      cancelWalkAway('owner-present');
    }else if(THREAT_STATES.has(state)){
      if(active === 'WALK_AWAY') cancel('privacy-threat');
      if(active !== 'THREAT') startThreat();
    }else{
      // CAMERA_ERROR, AI_UNAVAILABLE or an unknown state: monitoring is no longer reliable.
      handleMonitorFailure(`state-${state}`);
    }
  }

  // Called when monitoring fails (AI error, camera error, watchdog, unexpected exit).
  // Fail closed: timers stop, but the current effects stay on (no CLEAR). The
  // Presence Gate FAILSAFE curtain takes over concealment.
  function handleMonitorFailure(reason='ai-failed'){
    const hadTimers = Boolean(walkAwayTimer || walkAwayCountdownTimer || walkAwayFocusTimer || threatLockTimer || threatFocusTimer);
    clearWalkAwayTimers();
    if(threatFocusTimer){ timers.clearTimeout(threatFocusTimer); threatFocusTimer=null; }
    if(threatLockTimer){ timers.clearTimeout(threatLockTimer); threatLockTimer=null; }
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
