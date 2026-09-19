const PrivacyState = window.SmartScreenPrivacyState;
const STATES = PrivacyState.STATES;

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
let appSettings = {
  noUserLockEnabled: true,
  walkAwayLockDelay: 6000,
  intruderFocusDelay: 3000,
  intruderLockDelay: 5000
};

const control = document.getElementById('control');
const overlay = document.getElementById('overlay');
const pixelateLayer = document.getElementById('pixelateLayer');
const blackoutLayer = document.getElementById('blackoutLayer');
const focusLayer = document.getElementById('focusLayer');
const vignetteLayer = document.getElementById('vignetteLayer');
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
const blurStrength = document.getElementById('blurStrength');
const blurStrengthValue = document.getElementById('blurStrengthValue');
const focusIntensity = document.getElementById('focusIntensity');
const focusIntensityValue = document.getElementById('focusIntensityValue');
const pixelateStrength = document.getElementById('pixelateStrength');
const pixelateValue = document.getElementById('pixelateValue');
const blackoutOpacity = document.getElementById('blackoutOpacity');
const blackoutValue = document.getElementById('blackoutValue');

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

function renderProtectionLayers() {
  overlay.style.opacity = (blurOn || automaticBlurOn) ? '1' : '0';
  pixelateLayer.style.opacity = pixelateOn ? '1' : '0';
  blackoutLayer.style.opacity = blackoutOn ? String((Number(blackoutOpacity?.value || 94)) / 100) : '0';
  focusLayer.style.opacity = (focusOn || automaticFocusOn) ? '1' : '0';
  if (pixelateLayer) {
    const block = Math.max(6, Math.min(32, Number(pixelateStrength?.value || 12)));
    pixelateLayer.style.backgroundSize = `${block}px ${block}px`;
  }
  if (focusOn || automaticFocusOn) applyFocusGradient();
  updateButtonState(blurBtn, blurOn);
  updateButtonState(pixelateBtn, pixelateOn);
  updateButtonState(blackoutBtn, blackoutOn);
  updateButtonState(focusBtn, focusOn);
  updateButtonState(vignetteBtn, vignetteOn);
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
  if (focusValue) focusValue.textContent = focusOn ? 'On' : 'Off';
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

function setVignette(enabled) {
  vignetteOn = Boolean(enabled);
  if (vignetteValue) vignetteValue.textContent = vignetteOn ? 'On' : 'Off';
  vignetteLayer.style.opacity = vignetteOn ? '1' : '0';
}

function updatePixelateStrength(){
  const value = Math.max(6, Math.min(32, Number(pixelateStrength?.value || 12)));
  if (pixelateValue) pixelateValue.textContent = `${value} px`;
  if (pixelateLayer) pixelateLayer.style.backgroundSize = `${value}px ${value}px`;
}

function updateBlackoutOpacity(){
  const value = Math.max(70, Math.min(100, Number(blackoutOpacity?.value || 94)));
  if (blackoutValue) blackoutValue.textContent = `${value}%`;
  if (blackoutOn && blackoutLayer) blackoutLayer.style.opacity = String(value / 100);
}

function updateBlurStrength(){
  const value = Math.max(4, Number(blurStrength?.value || 15));
  overlay.style.backdropFilter = `blur(${value}px)`;
  overlay.style.webkitBackdropFilter = `blur(${value}px)`;
  if (blurStrengthValue) blurStrengthValue.textContent = `${value} px`;
}

function updateFocusIntensity(){
  const value = Math.min(95, Math.max(20, Number(focusIntensity?.value || 76)));
  const alpha = (value / 100).toFixed(2);
  focusLayer.style.background = `radial-gradient(circle 120px at ${mouseX}px ${mouseY}px, transparent 0, rgba(0,0,0,${alpha}) 150px)`;
  if (focusIntensityValue) focusIntensityValue.textContent = `${value}%`;
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
      clearAutomaticProtection();
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

if (control) {
  control.addEventListener('mouseenter', () => window.electronAPI.setIgnoreMouse(false));
  control.addEventListener('mouseleave', () => window.electronAPI.setIgnoreMouse(true));
}

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
blurStrength?.addEventListener('input', updateBlurStrength);
pixelateStrength?.addEventListener('input', () => { updatePixelateStrength(); renderProtectionLayers(); });
blackoutOpacity?.addEventListener('input', () => { updateBlackoutOpacity(); renderProtectionLayers(); });
focusIntensity?.addEventListener('input', () => { updateFocusIntensity(); if (focusOn || automaticFocusOn) applyFocusGradient(); });

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

let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;

function applyFocusGradient() {
  const value = Math.min(95, Math.max(20, Number(focusIntensity?.value || 76)));
  const alpha = (value / 100).toFixed(2);
  focusLayer.style.background = `radial-gradient(circle 120px at ${mouseX}px ${mouseY}px, transparent 0px, rgba(0,0,0,${alpha}) 150px)`;
  if (focusIntensityValue) focusIntensityValue.textContent = `${value}%`;
}

document.addEventListener('mousemove', (event) => {
  mouseX = event.clientX;
  mouseY = event.clientY;
  if (focusOn) applyFocusGradient();
});

window.electronAPI.onHotkeyBlur(() => toggleBlur());
window.electronAPI.onHotkeyFocus(() => toggleFocus());
window.electronAPI.onHotkeyVignette(() => toggleVignette());

window.electronAPI.onWalkAwayStatus((data) => {
  refreshSecurityEvents();
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

  aiEnabled = false;
  aiBtn.textContent = 'Enable Protection';
  window.electronAPI.notifyAIDisabled();
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

let dragging = false;
let offsetX = 0;
let offsetY = 0;

control?.addEventListener('mousedown', (event) => {
  if (event.target.closest('button')) return;
  dragging = true;
  offsetX = event.clientX - control.offsetLeft;
  offsetY = event.clientY - control.offsetTop;
});

document.addEventListener('mousemove', (event) => {
  if (!dragging) return;
  control.style.left = `${event.clientX - offsetX}px`;
  control.style.top = `${event.clientY - offsetY}px`;
  control.style.right = 'auto';
});

document.addEventListener('mouseup', () => {
  dragging = false;
});

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

window.electronAPI.onBiometricUpdated((_event, status) => {
  if (status?.enrolled) updateBlurStrength();
updatePixelateStrength();
updateBlackoutOpacity();
updateFocusIntensity();
refreshBiometricStatus();
refreshSecurityEvents();
setInterval(() => { if (aiEnabled) refreshSecurityEvents(); }, 5000);
});

updateBlurStrength();
updatePixelateStrength();
updateBlackoutOpacity();
updateFocusIntensity();
refreshBiometricStatus();
