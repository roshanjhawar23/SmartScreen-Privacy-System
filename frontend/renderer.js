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

// Enterprise policy (Phase 4): main enforces it; the panel shows locked controls as locked.
let enterprisePolicy = { managed:false, minimumIntensity:0, presenceGateRequired:false, allowDisableProtection:true };

function setIntensity(level) {
  intensityLevel = Math.max(enterprisePolicy.minimumIntensity || 0, Intensity.clampLevel(level));
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
  if (gateBtn) gateBtn.disabled = Boolean(gate.active) || Boolean(enterprisePolicy.presenceGateRequired);
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
  if (aiEnabled && enterprisePolicy.allowDisableProtection === false) {
    showSecurityNotification('Protection cannot be disabled on this managed device');
    return;
  }
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

let biometricEnrolled = false;

async function refreshBiometricStatus() {
  if (!identityBtn) return;

  try {
    const status = await window.electronAPI.getBiometricStatus();
    biometricEnrolled = Boolean(status?.enrolled);
    identityBtn.textContent = biometricEnrolled ? 'Manage' : 'Enroll owner';
  } catch {
    identityBtn.textContent = 'Identity unavailable';
    identityBtn.disabled = true;
  }
}

// ---------------------------------------------------------------------------
// Manage: trusted people, profile editor, auto-switch rules, settings transfer (Phase 4).
const managePanel = document.getElementById('managePanel');
const manageMessage = document.getElementById('manageMessage');
const peopleList = document.getElementById('peopleList');
const peopleNote = document.getElementById('peopleNote');
const personName = document.getElementById('personName');
const addPersonBtn = document.getElementById('addPersonBtn');
const pfCurtain = document.getElementById('pfCurtain');
const pfSensitivity = document.getElementById('pfSensitivity');
const pfWalkAway = document.getElementById('pfWalkAway');
const pfGlancing = document.getElementById('pfGlancing');
const profileName = document.getElementById('profileName');
const profileNote = document.getElementById('profileNote');
const saveProfileBtn = document.getElementById('saveProfileBtn');
const deleteProfileBtn = document.getElementById('deleteProfileBtn');
const autoSwitchBtn = document.getElementById('autoSwitchBtn');
const rulesList = document.getElementById('rulesList');
const addWifiRuleBtn = document.getElementById('addWifiRuleBtn');
const transferPass = document.getElementById('transferPass');
const exportSettingsBtn = document.getElementById('exportSettingsBtn');
const importSettingsBtn = document.getElementById('importSettingsBtn');
let profileState = { active:'', names:[], custom:[], rules:[], autoSwitch:false, locked:false };
let currentProfileDetails = null;

function showManageMessage(text, isError = false) {
  if (!manageMessage) return;
  manageMessage.textContent = text || '';
  manageMessage.classList.toggle('is-error', Boolean(isError));
}

function handleResult(result, okText) {
  if (result?.ok) { showManageMessage(okText); return true; }
  if (!result?.cancelled) showManageMessage(result?.error || 'Not possible right now.', true);
  return false;
}

function button(label, onClick, disabled = false) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

function renderPeople(view) {
  if (!peopleList || !view) return;
  peopleList.replaceChildren();
  const blocked = view.blocked;
  if (peopleNote) peopleNote.textContent = blocked || '';
  for (const person of view.people || []) {
    const row = document.createElement('div');
    row.className = 'manage-row';
    const label = document.createElement('span');
    label.textContent = person.name;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = ` · ${person.sampleCount} samples`;
    label.appendChild(meta);
    const rename = button('Rename', () => startRename(row, person), Boolean(blocked));
    const reenroll = button('Re-enroll', async () => {
      handleResult(await window.electronAPI.enrollTrustedPerson({ mode:'reenroll', id:person.id }), `Re-enrolling ${person.name}…`);
    }, Boolean(blocked));
    const remove = button('Remove', async () => {
      const result = await window.electronAPI.removeTrustedPerson(person.id);
      if (handleResult(result, `${person.name} removed.`)) renderPeople(result);
    }, Boolean(blocked) || (view.people || []).length <= 1);
    row.append(label, rename, reenroll, remove);
    peopleList.appendChild(row);
  }
  if (personName) personName.disabled = Boolean(blocked);
  if (addPersonBtn) addPersonBtn.disabled = Boolean(blocked);
}

function startRename(row, person) {
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 40;
  input.value = person.name;
  input.setAttribute('aria-label', `New name for ${person.name}`);
  const save = button('OK', async () => {
    const result = await window.electronAPI.renameTrustedPerson(person.id, input.value);
    if (handleResult(result, 'Renamed.')) renderPeople(result);
  });
  const cancel = button('Cancel', () => refreshManage());
  row.replaceChildren(input, save, cancel);
  input.focus?.();
}

function describeRule(rule) {
  if (rule.type === 'wifi') return `Wi-Fi network → ${rule.profile}`;
  const days = (rule.days || []).length === 7 ? 'every day' : (rule.days || []).map((d) => 'SunMonTueWedThuFriSat'.slice(d * 3, d * 3 + 3)).join(' ');
  return `${rule.from}–${rule.to} ${days} → ${rule.profile}`;
}

function renderRules(info) {
  if (!info) return;
  profileState = { ...profileState, ...info };
  if (autoSwitchBtn) {
    autoSwitchBtn.textContent = profileState.autoSwitch ? 'On' : 'Off';
    updateButtonState(autoSwitchBtn, profileState.autoSwitch);
    autoSwitchBtn.disabled = Boolean(profileState.locked);
  }
  if (addWifiRuleBtn) addWifiRuleBtn.disabled = Boolean(profileState.locked);
  if (!rulesList) return;
  rulesList.replaceChildren();
  for (const rule of profileState.rules || []) {
    const row = document.createElement('div');
    row.className = 'manage-row';
    const label = document.createElement('span');
    label.textContent = describeRule(rule);
    const remove = button('Remove', async () => {
      const result = await window.electronAPI.removeRule(rule.id);
      if (handleResult(result, 'Rule removed.')) renderRules(result);
    }, Boolean(profileState.locked));
    row.append(label, remove);
    rulesList.appendChild(row);
  }
}

async function loadProfileEditor() {
  const details = await window.electronAPI.getProfileDetails(profileState.active || undefined);
  if (!details?.profile) return;
  currentProfileDetails = details.profile;
  if (pfWalkAway && pfWalkAway.childElementCount !== details.options.walkAwayMs.length) {
    pfWalkAway.replaceChildren();
    for (const ms of details.options.walkAwayMs) {
      const option = document.createElement('option');
      option.value = String(ms);
      option.textContent = `${ms / 1000} s`;
      pfWalkAway.appendChild(option);
    }
  }
  const p = details.profile;
  if (pfCurtain) pfCurtain.value = p.curtainEffect;
  if (pfSensitivity) pfSensitivity.value = p.sensitivity;
  if (pfWalkAway) pfWalkAway.value = String(p.walkAwayLockDelay);
  if (pfGlancing) pfGlancing.value = String(p.glancingCounts);
  if (profileName) profileName.value = p.readOnly ? '' : p.name;
  if (profileName) profileName.placeholder = p.readOnly ? 'New profile name' : 'Profile name';
  if (profileNote) profileNote.textContent = details.locked ? 'Managed by your organization' : (p.readOnly ? `${p.name} (built-in)` : p.name);
  for (const el of [pfCurtain, pfSensitivity, pfWalkAway, pfGlancing, profileName, saveProfileBtn]) if (el) el.disabled = details.locked;
  if (deleteProfileBtn) deleteProfileBtn.disabled = details.locked || p.readOnly;
}

async function refreshManage() {
  try {
    renderPeople(await window.electronAPI.getTrustedPeople());
    renderRules(await window.electronAPI.getProfiles());
    await loadProfileEditor();
  } catch (error) {
    showManageMessage('Manage is unavailable.', true);
  }
}

identityBtn?.addEventListener('click', async () => {
  if (!biometricEnrolled) {
    identityBtn.disabled = true;
    try { await window.electronAPI.enrollTrustedPerson({ mode:'add', name:'Owner' }); } finally { identityBtn.disabled = false; }
    return;
  }
  const open = Boolean(managePanel?.hidden);
  if (managePanel) managePanel.hidden = !open;
  identityBtn.setAttribute('aria-expanded', String(open));
  if (open) { showManageMessage(''); refreshManage(); }
});

addPersonBtn?.addEventListener('click', async () => {
  const name = personName?.value.trim();
  if (!name) { showManageMessage('Enter a name first.', true); return; }
  if (handleResult(await window.electronAPI.enrollTrustedPerson({ mode:'add', name }), `Enrolling ${name}…`) && personName) personName.value = '';
});

saveProfileBtn?.addEventListener('click', async () => {
  const name = profileName?.value.trim() || (currentProfileDetails && !currentProfileDetails.readOnly ? currentProfileDetails.name : '');
  if (!name) { showManageMessage('Built-in profiles are read-only: enter a name to save a new profile.', true); return; }
  const result = await window.electronAPI.saveProfile(name, {
    curtainEffect:pfCurtain?.value, sensitivity:pfSensitivity?.value,
    walkAwayLockDelay:Number(pfWalkAway?.value), glancingCounts:pfGlancing?.value === 'true'
  });
  if (handleResult(result, `Profile "${name}" saved.`)) { applyProfiles(result); renderRules(result); await loadProfileEditor(); }
});

deleteProfileBtn?.addEventListener('click', async () => {
  if (!currentProfileDetails || currentProfileDetails.readOnly) return;
  const result = await window.electronAPI.deleteProfile(currentProfileDetails.name);
  if (handleResult(result, `Profile "${currentProfileDetails.name}" deleted.`)) { applyProfiles(result); renderRules(result); await loadProfileEditor(); }
});

autoSwitchBtn?.addEventListener('click', async () => {
  const result = await window.electronAPI.setAutoSwitch(!profileState.autoSwitch);
  if (handleResult(result, result?.autoSwitch ? 'Auto-switch on.' : 'Auto-switch off.')) { renderRules(result); applyProfiles(result); }
});

addWifiRuleBtn?.addEventListener('click', async () => {
  const result = await window.electronAPI.addWifiRule();
  if (handleResult(result, `${profileState.active} will be used on this Wi-Fi network.`)) renderRules(result);
});

exportSettingsBtn?.addEventListener('click', async () => {
  const result = await window.electronAPI.exportSettings(transferPass?.value || '', { intensity:intensityLevel });
  if (handleResult(result, `Settings exported: ${result?.file}`) && transferPass) transferPass.value = '';
});

importSettingsBtn?.addEventListener('click', async () => {
  const result = await window.electronAPI.importSettings(transferPass?.value || '');
  if (!handleResult(result, 'Settings imported.')) return;
  if (transferPass) transferPass.value = '';
  if (result.preferences?.intensity !== null && result.preferences?.intensity !== undefined) {
    setIntensity(result.preferences.intensity);
    saveIntensity(intensityLevel);
  }
  try { window.localStorage.setItem(GATE_STORAGE_KEY, String(Boolean(result.preferences?.presenceGateEnabled))); } catch {}
  applyGate(await window.electronAPI.getPresenceGate());
  applyProfiles(result);
  renderRules(result);
  await loadProfileEditor();
});

async function applyEnterprisePolicy() {
  try {
    const policy = await window.electronAPI.getEnterprisePolicy();
    if (!policy) return;
    enterprisePolicy = policy;
    if (policy.managed) {
      const status = document.getElementById('deviceStatus');
      if (status) status.textContent = 'Managed by your organization';
    }
    if (intensitySlider) intensitySlider.min = String(policy.minimumIntensity || 0);
    if (intensityLevel < (policy.minimumIntensity || 0)) { setIntensity(policy.minimumIntensity); saveIntensity(intensityLevel); }
    if (policy.presenceGateRequired && gateBtn) gateBtn.title = 'Required by your organization';
    applyGate(gate); // redraw: the toggle's locked state depends on the policy
  } catch {}
}

window.electronAPI.onPolicyRefused((data) => {
  if (data?.action === 'disable-protection') {
    aiEnabled = true;
    if (aiBtn) aiBtn.textContent = 'Disable Protection';
    showSecurityNotification('Protection cannot be disabled on this managed device');
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
applyEnterprisePolicy();
refreshBiometricStatus();
refreshSecurityEvents();
setInterval(() => { if (aiEnabled) refreshSecurityEvents(); }, 5000);
}
