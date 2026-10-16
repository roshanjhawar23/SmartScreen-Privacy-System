const PrivacyState = window.SmartScreenPrivacyState;
const Intensity = window.SmartScreenIntensity;
const STATES = PrivacyState.STATES;
const isSecondaryOverlay = window.electronAPI.overlayRole === 'secondary';

// Secondary displays only mirror the primary window's render state.
if (isSecondaryOverlay) {
  document.body.classList.add('secondary-overlay');
  // Cursor is usually on another display: darken everything until it arrives.
  const effects = window.SmartScreenEffects.create({ api: window.electronAPI, initialPointer: { x: -10000, y: -10000 } });
  window.electronAPI.onRenderState((state) => effects.apply(state));
  window.electronAPI.onPresenceCurtain((curtain) => effects.apply({ curtain }));
} else {
  startPrimaryOverlay();
}

function startPrimaryOverlay() {
const effects = window.SmartScreenEffects.create({ api: window.electronAPI });
const INTENSITY_STORAGE_KEY = 'smartscreen.privacyIntensity';
const GATE_STORAGE_KEY = 'smartscreen.presenceGate';
window.electronAPI.onPresenceCurtain((curtain) => effects.apply({ curtain }));

let blurOn = false;
let pixelateOn = false;
let blackoutOn = false;
let focusOn = false;
let vignetteOn = false;
let aiEnabled = false;
let intruderActive = false;
let currentState = STATES.INACTIVE;
let previousState = STATES.INACTIVE;
let intruderTimer = null;
let lockTimer = null;
let normalCooldown = null;
let notificationTimer = null;
let automaticBlurOn = false;
let automaticFocusOn = false;
let intensityLevel = loadIntensity();
let gate = { state: 'DISABLED', reason: '', curtain: false, enabled: true, active: false };
let appSettings = {
  noUserLockEnabled: true,
  walkAwayLockDelay: 6000,
  intruderFocusDelay: 3000,
  intruderLockDelay: 5000
};

const control = document.getElementById('control');
const panelHeader = document.getElementById('panelHeader');
const aiWarning = document.getElementById('aiWarning');
const aiStatus = document.getElementById('ai-status');
const identityLive = document.getElementById('identity-live');
const identityBtn = document.getElementById('identityBtn');
const eventList = document.getElementById('eventList');
const panelBody = document.getElementById('panelBody');
const mini = document.getElementById('miniToggle');
const aiBtn = document.getElementById('aiBtn');
const blurBtn = document.getElementById('blurBtn');
const pixelateBtn = document.getElementById('pixelateBtn');
const blackoutBtn = document.getElementById('blackoutBtn');
const effectsBtn = document.getElementById('effectsBtn');
const effectsPanel = document.getElementById('effectsPanel');
const focusBtn = document.getElementById('focusBtn');
const vignetteBtn = document.getElementById('vignetteBtn');
const focusValue = document.getElementById('focusValue');
const vignetteValue = document.getElementById('vignetteValue');
const intensitySlider = document.getElementById('intensitySlider');
const intensityValue = document.getElementById('intensityValue');
const gateStatus = document.getElementById('gate-status');
const gateBtn = document.getElementById('gateBtn');
const retryBtn = document.getElementById('retryBtn');

function loadIntensity() {
  try {
    const stored = window.localStorage.getItem(INTENSITY_STORAGE_KEY);
    if (stored !== null) return Intensity.clampLevel(stored);
  } catch {}
  return Intensity.DEFAULT_LEVEL;
}

function saveIntensity(level) {
  try { window.localStorage.setItem(INTENSITY_STORAGE_KEY, String(level)); } catch {}
}

function setStatus(text) {
  if (aiStatus) aiStatus.textContent = text;
}

function setLiveIdentity(text) {
  if (identityLive) identityLive.textContent = text;
}

function showSecurityNotification(message) {
  if (!aiWarning) return;
  if (notificationTimer) clearTimeout(notificationTimer);
  aiWarning.textContent = message;
  aiWarning.style.opacity = '1';
  notificationTimer = setTimeout(() => {
    aiWarning.style.opacity = '0';
    notificationTimer = null;
  }, 3500);
}

function clearTimer(name) {
  if (name === 'intruder' && intruderTimer) {
    clearTimeout(intruderTimer);
    intruderTimer = null;
  }
  if (name === 'lock' && lockTimer) {
    clearTimeout(lockTimer);
    lockTimer = null;
  }
  if (name === 'normal' && normalCooldown) {
    clearTimeout(normalCooldown);
    normalCooldown = null;
  }
}

function clearAllTimers() {
  clearTimer('intruder');
  clearTimer('lock');
  clearTimer('normal');
}

function updateButtonState(button, active) {
  if (!button) return;
  button.classList.toggle('is-active', Boolean(active));
  button.setAttribute('aria-pressed', String(Boolean(active)));
}

function currentRenderState() {
  return {
    blur: blurOn || automaticBlurOn,
    pixelate: pixelateOn,
    blackout: blackoutOn,
    focus: focusOn || automaticFocusOn,
    vignette: vignetteOn,
    level: intensityLevel
  };
}

function renderProtectionLayers() {
  const state = currentRenderState();
  effects.apply(state);
  window.electronAPI.publishRenderState(state);
  updateButtonState(blurBtn, blurOn);
  updateButtonState(pixelateBtn, pixelateOn);
  updateButtonState(blackoutBtn, blackoutOn);
  updateButtonState(focusBtn, focusOn);
  updateButtonState(vignetteBtn, vignetteOn);
  if (focusValue) focusValue.textContent = focusOn ? 'On' : 'Off';
  if (vignetteValue) vignetteValue.textContent = vignetteOn ? 'On' : 'Off';
}

function setBlur(enabled) {
  blurOn = Boolean(enabled);
  renderProtectionLayers();
}

function setPixelate(enabled) {
  pixelateOn = Boolean(enabled);
  if (pixelateOn) blackoutOn = false;
  renderProtectionLayers();
}

function setBlackout(enabled) {
  blackoutOn = Boolean(enabled);
  if (blackoutOn) pixelateOn = false;
  renderProtectionLayers();
}

function setFocus(enabled) {
  focusOn = Boolean(enabled);
  renderProtectionLayers();
}

function setVignette(enabled) {
  vignetteOn = Boolean(enabled);
  renderProtectionLayers();
}

function setAutomaticBlur(enabled) {
  automaticBlurOn = Boolean(enabled);
  renderProtectionLayers();
}

function setAutomaticFocus(enabled) {
  automaticFocusOn = Boolean(enabled);
  renderProtectionLayers();
}

function clearAutomaticProtection() {
  automaticBlurOn = false;
  automaticFocusOn = false;
  renderProtectionLayers();
}

function setIntensity(level) {
  intensityLevel = Intensity.clampLevel(level);
  if (intensitySlider && Number(intensitySlider.value) !== intensityLevel) intensitySlider.value = String(intensityLevel);
  if (intensityValue) intensityValue.textContent = String(intensityLevel);
  renderProtectionLayers();
}

function toggleBlur() {
  setBlur(!blurOn);
}

function toggleFocus() {
  setFocus(!focusOn);
}

function toggleVignette() {
  setVignette(!vignetteOn);
}

function clearProtection() {
  const hadThreat = intruderActive;
  intruderActive = false;
  clearTimer('intruder');
  clearTimer('lock');
  clearTimer('normal');
  clearAutomaticProtection();
  if (hadThreat) window.electronAPI.notifyIntruderCleared();
}

function applyState(payload) {
  const normalized = PrivacyState.normalizePayload(payload);
  const state = normalized.state;
  const changed = state !== currentState;

  if (changed) {
    previousState = currentState;
    currentState = state;
  }

  switch (state) {
    case STATES.STARTING:
      clearAllTimers();
      setStatus('Starting');
      setLiveIdentity('Verifying');
      break;

    case STATES.OWNER_PRESENT:
      setLiveIdentity('Owner verified');
      setStatus('Owner verified');

      if (intruderActive) {
        clearTimer('normal');
        normalCooldown = setTimeout(() => {
          normalCooldown = null;
          if (currentState === STATES.OWNER_PRESENT) clearProtection();
        }, 800);
      }
      break;

    case STATES.NO_USER:
      setLiveIdentity('No person detected');
      setStatus('User away');

      if (intruderActive) {
        clearTimer('normal');
        normalCooldown = setTimeout(() => {
          normalCooldown = null;
          if (currentState === STATES.NO_USER) clearProtection();
        }, 800);
      }

      break;

    case STATES.UNKNOWN_PERSON:
    case STATES.UNKNOWN_GROUP:
    case STATES.OWNER_AND_UNKNOWN: {
      const label = state === STATES.OWNER_AND_UNKNOWN
        ? 'Owner + unrecognized person'
        : state === STATES.UNKNOWN_GROUP
          ? 'Unrecognized people'
          : 'Unrecognized person';
      setLiveIdentity(label);
      setStatus('Privacy threat detected');
      if (changed || !intruderActive) {
        intruderActive = true;
        window.electronAPI.notifyIntruderAlert();
        if (changed) showSecurityNotification('Privacy threat detected — protection activated');
      }
      break;
    }

    case STATES.CAMERA_ERROR:
      clearAllTimers();
      setStatus('Camera unavailable');
      setLiveIdentity('Camera unavailable');
      break;

    case STATES.AI_UNAVAILABLE:
      clearAllTimers();
      // Fail closed: automatic effects stay on; the Presence Gate FAILSAFE curtain conceals.
      setStatus('Protection unavailable');
      setLiveIdentity('Verification unavailable');
      break;

    case STATES.INACTIVE:
    default:
      clearAllTimers();
      setStatus('Inactive');
      setLiveIdentity('Not monitored');
      break;
  }

  if (changed) {
    console.info(`Privacy state: ${previousState} -> ${currentState}`);
    refreshSecurityEvents();
  }
}

window.electronAPI.onSettingsLoaded((_event, data) => {
  appSettings = data || {};
});

window.addEventListener('error', () => {
  if (aiWarning) aiWarning.style.opacity = '0';
});

// Click-through management. The overlay ignores the mouse except over the panel.
// While a pointer gesture (panel drag or slider drag) is in progress we must not
// switch back to click-through, or the gesture is cut off when the pointer leaves
// the panel.
let pointerOverPanel = false;
let pointerGestureActive = false;

function updateMouseCapture() {
  window.electronAPI.setIgnoreMouse(!(pointerOverPanel || pointerGestureActive));
}

function beginPointerGesture(event, target) {
  pointerGestureActive = true;
  try { target.setPointerCapture(event.pointerId); } catch {}
  updateMouseCapture();
}

function endPointerGesture(event) {
  if (!pointerGestureActive) return;
  pointerGestureActive = false;
  pointerOverPanel = control ? control.contains(document.elementFromPoint(event.clientX, event.clientY)) : false;
  updateMouseCapture();
}

if (control) {
  control.addEventListener('pointerenter', () => { pointerOverPanel = true; updateMouseCapture(); });
  control.addEventListener('pointerleave', () => { pointerOverPanel = false; updateMouseCapture(); });
}

intensitySlider?.addEventListener('pointerdown', (event) => beginPointerGesture(event, intensitySlider));
intensitySlider?.addEventListener('pointerup', endPointerGesture);
intensitySlider?.addEventListener('pointercancel', endPointerGesture);
intensitySlider?.addEventListener('input', () => {
  setIntensity(intensitySlider.value);
  saveIntensity(intensityLevel);
});

blurBtn?.addEventListener('click', toggleBlur);
focusBtn?.addEventListener('click', toggleFocus);
vignetteBtn?.addEventListener('click', toggleVignette);

pixelateBtn?.addEventListener('click', () => setPixelate(!pixelateOn));
blackoutBtn?.addEventListener('click', () => setBlackout(!blackoutOn));
effectsBtn?.addEventListener('click', () => {
  const open = !effectsPanel?.hidden;
  if (effectsPanel) effectsPanel.hidden = open;
  effectsBtn?.setAttribute('aria-expanded', String(!open));
});

function gateStatusText(snapshot) {
  const reason = snapshot.reason || '';
  switch (snapshot.state) {
    case 'CONCEALED':
      if (reason.startsWith('threat-')) return 'Screen concealed — unrecognized person';
      if (reason === 'owner-absent' || reason === 'no-user') return 'Screen concealed — owner absent';
      if (reason.startsWith('session-') || reason === 'system-resumed') return 'Screen concealed — verify to reveal';
      return 'Screen concealed — verifying owner';
    case 'VERIFYING': return 'Verifying owner…';
    case 'REVEALED': return 'Screen visible — owner verified';
    case 'ABSENCE_GRACE': return 'Owner not visible — concealing';
    case 'FAILSAFE':
      if (reason === 'camera-error') return 'Camera unavailable — screen protected';
      if (reason.startsWith('tamper-')) return 'Tamper detected — screen protected';
      return 'Verification unavailable — screen protected';
    default:
      return snapshot.enabled ? 'Presence Gate ready' : 'Presence Gate off';
  }
}

function applyGate(snapshot) {
  if (!snapshot) return;
  gate = { ...gate, ...snapshot };
  if (gateStatus) {
    gateStatus.textContent = gateStatusText(gate);
    gateStatus.classList.toggle('is-concealed', Boolean(gate.curtain));
    gateStatus.classList.toggle('is-failsafe', gate.state === 'FAILSAFE');
  }
  updateButtonState(gateBtn, gate.enabled);
  // The toggle cannot remove the curtain: it only changes while protection is off.
  if (gateBtn) gateBtn.disabled = Boolean(gate.active);
  if (retryBtn) retryBtn.hidden = gate.state !== 'FAILSAFE';
  if (gate.state === 'FAILSAFE') {
    // Protection stays on in FAILSAFE: leaving it needs Retry or a confirmed Disable.
    aiEnabled = true;
    if (aiBtn) aiBtn.textContent = 'Disable Protection';
  }
}

function loadGatePreference() {
  try {
    const stored = window.localStorage.getItem(GATE_STORAGE_KEY);
    if (stored !== null) return stored === 'true';
  } catch {}
  return true;
}

async function setGateEnabled(enabled) {
  const result = await window.electronAPI.setPresenceGate(Boolean(enabled));
  if (result?.ok) {
    try { window.localStorage.setItem(GATE_STORAGE_KEY, String(Boolean(enabled))); } catch {}
  }
  applyGate(result?.snapshot);
}

gateBtn?.addEventListener('click', () => {
  if (gate.active) return;
  setGateEnabled(!gate.enabled);
});

retryBtn?.addEventListener('click', () => {
  if (gate.state !== 'FAILSAFE') return;
  applyState({ state: STATES.STARTING });
  window.electronAPI.retryProtection();
});

const profileSelect = document.getElementById('profileSelect');

function applyProfiles(info) {
  if (!profileSelect || !info || !Array.isArray(info.names)) return;
  const current = Array.from(profileSelect.options || []).map((o) => o.value).join('|');
  if (current !== info.names.join('|')) {
    profileSelect.replaceChildren();
    for (const name of info.names) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      profileSelect.appendChild(option);
    }
  }
  profileSelect.value = info.active;
}

profileSelect?.addEventListener('change', async () => {
  applyProfiles(await window.electronAPI.setProfile(profileSelect.value));
  refreshSecurityEvents();
});

window.electronAPI.onProfileChanged((info) => {
  applyProfiles(info);
  refreshSecurityEvents();
});

// Video input devices (ids only) so main can detect a swapped or removed camera.
async function reportVideoDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    window.electronAPI.reportVideoDevices(devices.filter((d) => d.kind === 'videoinput').map((d) => d.deviceId));
  } catch {}
}
try { navigator.mediaDevices?.addEventListener?.('devicechange', reportVideoDevices); } catch {}

// Diagnostics (local only).
const diagBtn = document.getElementById('diagBtn');
const diagPanel = document.getElementById('diagPanel');
const diagExportBtn = document.getElementById('diagExportBtn');
let diagTimer = null;

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

async function refreshDiagnostics() {
  try {
    const d = await window.electronAPI.getDiagnostics();
    if (!d) return;
    const b = d.backend;
    const c = d.counters || {};
    const n = (v, digits = 1) => (Number.isFinite(v) ? Number(v).toFixed(digits) : '—');
    setText('diagCamera', b ? `${n(b.fps)} fps · ${n(b.processedFps)} analysed/s` : '—');
    setText('diagRecognition', b ? `${n(b.recognitionMs)} ms · p95 ${n(b.recognitionP95Ms)} ms` : '—');
    setText('diagCpu', `${b ? n(b.cpu, 0) : '—'} % / ${n(d.electron?.cpuPercent, 0)} %`);
    setText('diagThreats', `${c.threats ?? 0} / ${c.lockRequests ?? 0}`);
    setText('diagTamper', `${c.failsafes ?? 0} / ${c.tamperEvents ?? 0}`);
  } catch {}
}

diagBtn?.addEventListener('click', () => {
  const open = diagPanel?.hidden;
  if (diagPanel) diagPanel.hidden = !open;
  diagBtn.setAttribute('aria-expanded', String(Boolean(open)));
  if (open) {
    refreshDiagnostics();
    diagTimer = setInterval(refreshDiagnostics, 2000);
  } else if (diagTimer) {
    clearInterval(diagTimer);
    diagTimer = null;
  }
});

diagExportBtn?.addEventListener('click', async () => {
  diagExportBtn.disabled = true;
  try {
    const result = await window.electronAPI.exportDiagnostics();
    if (result?.ok) showSecurityNotification(`Diagnostics saved: ${result.file}`);
  } finally {
    diagExportBtn.disabled = false;
  }
});

window.electronAPI.onPresenceGate((snapshot) => {
  applyGate(snapshot);
  refreshSecurityEvents();
});

async function toggleAI() {
  if (aiEnabled) {
    const confirmed = await window.electronAPI.confirmProtectedAction({
      title: 'Disable protection',
      message: 'SmartScreen will stop privacy monitoring until protection is enabled again. Continue?'
    });
    if (!confirmed) return;

    aiEnabled = false;
    aiBtn.textContent = 'Enable Protection';
    window.electronAPI.notifyAIDisabled();
    window.electronAPI.stopAI();
    clearAllTimers();
    clearProtection();
    applyState({ state: STATES.INACTIVE });
    return;
  }

  const status = await window.electronAPI.getBiometricStatus();
  if (!status?.enrolled) {
    setStatus('Owner identity required');
    setLiveIdentity('Not enrolled');
    return;
  }

  aiEnabled = true;
  aiBtn.textContent = 'Disable Protection';
  window.electronAPI.notifyAIEnabled();
  applyState({ state: STATES.STARTING });
  window.electronAPI.startAI();
}

aiBtn?.addEventListener('click', toggleAI);

window.electronAPI.onHotkeyBlur(() => toggleBlur());
window.electronAPI.onHotkeyFocus(() => toggleFocus());
window.electronAPI.onHotkeyVignette(() => toggleVignette());

window.electronAPI.onWalkAwayStatus((data) => {
  if (data?.phase !== 'COUNTDOWN') refreshSecurityEvents();
  if (!aiEnabled) return;
  const remainingMs = Math.max(0, Number(data?.remainingMs || 0));
  const seconds = Math.ceil(remainingMs / 1000);
  if (data?.phase === 'ARMED' || data?.phase === 'COUNTDOWN') {
    if (currentState === STATES.NO_USER) setStatus(`User away — locking in ${seconds}s`);
  } else if (data?.phase === 'EXPIRED') {
    setStatus('Locking screen');
  } else if (data?.phase === 'CANCELLED' && currentState === STATES.OWNER_PRESENT) {
    setStatus('Owner verified');
  }
});

window.electronAPI.onPrivacyAction((action) => {
  refreshSecurityEvents();
  switch (action?.action) {
    case 'BLUR':
      setAutomaticBlur(true);
      break;
    case 'FOCUS':
      setAutomaticBlur(true);
      setAutomaticFocus(true);
      break;
    case 'CLEAR':
      clearAutomaticProtection();
      break;
    case 'LOCKING':
      setAutomaticBlur(true);
      setAutomaticFocus(true);
      setStatus('Locking screen');
      break;
    default:
      break;
  }
});

window.electronAPI.onAIState((payload) => {
  applyState(payload);
});

window.electronAPI.onAIStarting(() => {
  applyState({ state: STATES.STARTING });
});

window.electronAPI.onAIReady(() => {
  if (!aiEnabled) return;
  setStatus('Active');
  setLiveIdentity('Verifying');
});

window.electronAPI.onAIFailed((_event, failure) => {
  const kind = typeof failure === 'object' && failure ? failure.kind : 'AI_UNAVAILABLE';
  const message = typeof failure === 'object' && failure ? failure.message : failure;
  const state = kind === 'CAMERA_ERROR' ? STATES.CAMERA_ERROR : STATES.AI_UNAVAILABLE;

  // Protection stays on: main has put the Presence Gate in FAILSAFE (screen concealed).
  applyState({ state });

  if (message) console.error(message);
});

window.electronAPI.onAIStopped(() => {
  aiEnabled = false;
  aiBtn.textContent = 'Enable Protection';

  if (currentState === STATES.AI_UNAVAILABLE || currentState === STATES.CAMERA_ERROR) return;
  applyState({ state: STATES.INACTIVE });
});

window.electronAPI.onAIPhotoSaved(() => {});

// Panel dragging: only from the header (not the slider or buttons), with pointer
// capture so the drag keeps tracking outside the panel.
let dragging = false;
let offsetX = 0;
let offsetY = 0;

panelHeader?.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || event.target.closest('button, input, select')) return;
  dragging = true;
  offsetX = event.clientX - control.offsetLeft;
  offsetY = event.clientY - control.offsetTop;
  panelHeader.classList.add('is-dragging');
  beginPointerGesture(event, panelHeader);
});

panelHeader?.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  const maxLeft = Math.max(0, window.innerWidth - control.offsetWidth);
  const maxTop = Math.max(0, window.innerHeight - control.offsetHeight);
  control.style.left = `${Math.min(maxLeft, Math.max(0, event.clientX - offsetX))}px`;
  control.style.top = `${Math.min(maxTop, Math.max(0, event.clientY - offsetY))}px`;
  control.style.right = 'auto';
});

function endDrag(event) {
  if (!dragging) return;
  dragging = false;
  panelHeader.classList.remove('is-dragging');
  endPointerGesture(event);
}

panelHeader?.addEventListener('pointerup', endDrag);
panelHeader?.addEventListener('pointercancel', endDrag);

let collapsed = false;
mini?.addEventListener('click', (event) => {
  event.stopPropagation();
  collapsed = !collapsed;
  panelBody.style.display = collapsed ? 'none' : 'flex';
});


function formatEventTime(timestamp){
  const date = new Date(timestamp);
  if(Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'});
}

async function refreshSecurityEvents(){
  if(!eventList) return;

  try{
    const events = await window.electronAPI.getSecurityEvents(3);
    eventList.replaceChildren();

    if(!Array.isArray(events) || events.length === 0){
      const empty = document.createElement('div');
      empty.className = 'event-empty';
      empty.textContent = 'No security events recorded.';
      eventList.appendChild(empty);
      return;
    }

    events.forEach((event) => {
      const row = document.createElement('div');
      row.className = 'event-item';

      const title = document.createElement('div');
      title.className = 'event-item-title';
      title.textContent = event.title || 'Security event';

      const meta = document.createElement('div');
      meta.className = 'event-item-meta';
      const time = formatEventTime(event.timestamp);
      meta.textContent = event.detail ? `${time} · ${event.detail}` : time;

      row.append(title, meta);
      eventList.appendChild(row);
    });
  }catch(error){
    console.error('Security event history unavailable:', error);
  }
}

async function refreshBiometricStatus() {
  if (!identityBtn) return;

  try {
    const status = await window.electronAPI.getBiometricStatus();
    if (status.enrolled) {
      identityBtn.textContent = 'Re-enroll Owner';
    } else {
      identityBtn.textContent = 'Enroll Owner';
    }
  } catch {
    identityBtn.textContent = 'Identity unavailable';
    identityBtn.disabled = true;
  }
}

identityBtn?.addEventListener('click', async () => {
  identityBtn.disabled = true;
  try {
    await window.electronAPI.openEnrollment();
  } finally {
    identityBtn.disabled = false;
  }
});

window.electronAPI.onBiometricUpdated(() => {
  refreshBiometricStatus();
  refreshSecurityEvents();
});

// Startup — runs exactly once.
setIntensity(intensityLevel);
setGateEnabled(loadGatePreference());
Promise.resolve(window.electronAPI.getProfiles()).then(applyProfiles).catch(() => {});
reportVideoDevices();
refreshBiometricStatus();
refreshSecurityEvents();
setInterval(() => { if (aiEnabled) refreshSecurityEvents(); }, 5000);
}
