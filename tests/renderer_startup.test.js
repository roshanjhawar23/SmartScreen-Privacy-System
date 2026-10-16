// Loads the real overlay scripts into a VM with a stub DOM and IPC bridge.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FRONTEND = path.join(__dirname, '..', 'frontend');
const SCRIPTS = ['privacy_state.js', 'intensity.js', 'overlay_effects.js', 'renderer.js'];

function stubElement(id) {
  const listeners = {};
  const classes = new Set();
  return {
    id,
    style: {},
    hidden: id === 'effectsPanel',
    disabled: false,
    value: id === 'intensitySlider' ? '50' : '',
    textContent: '',
    width: 1,
    height: 1,
    offsetLeft: 0,
    offsetTop: 0,
    offsetWidth: 292,
    offsetHeight: 300,
    listeners,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, on) => (on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c),
      contains: (c) => classes.has(c)
    },
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    setAttribute() {},
    setPointerCapture() {},
    replaceChildren() {},
    appendChild() {},
    append() {},
    contains: () => false,
    closest: () => null,
    getContext: () => ({ drawImage() {} })
  };
}

function loadOverlay(role) {
  const elements = new Map();
  const ipcListeners = {};
  const sent = [];
  const counters = { setInterval: 0 };

  const electronAPI = new Proxy({ overlayRole: role }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'string' && prop.startsWith('on')) {
        return (cb) => { (ipcListeners[prop] ||= []).push(cb); };
      }
      return (...args) => {
        sent.push([prop, ...args]);
        if (prop === 'getSecurityEvents') return Promise.resolve([]);
        if (prop === 'getBiometricStatus') return Promise.resolve({ enrolled: true });
        if (prop === 'getCaptureSource') return Promise.resolve({ ok: false });
        return undefined;
      };
    }
  });

  const document = {
    body: stubElement('body'),
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, stubElement(id));
      return elements.get(id);
    },
    createElement: (tag) => stubElement(tag),
    addEventListener() {},
    elementFromPoint: () => null
  };

  const context = {
    document,
    electronAPI,
    innerWidth: 1920,
    innerHeight: 1080,
    localStorage: { getItem: () => null, setItem() {} },
    navigator: { mediaDevices: {} },
    console: { info() {}, warn() {}, error() {}, log() {} },
    addEventListener() {},
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval: () => { counters.setInterval++; return 0; },
    clearInterval() {},
    Promise
  };
  context.window = context;
  vm.createContext(context);
  for (const file of SCRIPTS) {
    vm.runInContext(fs.readFileSync(path.join(FRONTEND, file), 'utf8'), context, { filename: file });
  }
  return { elements, ipcListeners, sent, counters, document };
}

test('primary overlay starts without errors and registers the refresh interval once', () => {
  const o = loadOverlay('primary');
  assert.equal(o.counters.setInterval, 1);
  assert.ok(o.sent.some(([name]) => name === 'getSecurityEvents'), 'initial event refresh ran');
  assert.ok(o.sent.some(([name]) => name === 'publishRenderState'), 'initial render state published');
  assert.equal(o.elements.get('intensityValue').textContent, '50');
});

test('biometric update does not re-run startup or stack intervals', () => {
  const o = loadOverlay('primary');
  for (let i = 0; i < 3; i++) o.ipcListeners.onBiometricUpdated.forEach((cb) => cb({}, { enrolled: true }));
  assert.equal(o.counters.setInterval, 1);
});

test('intensity slider drives the shared render state', () => {
  const o = loadOverlay('primary');
  const slider = o.elements.get('intensitySlider');
  slider.value = '90';
  slider.listeners.input.forEach((fn) => fn());
  const last = o.sent.filter(([name]) => name === 'publishRenderState').at(-1)[1];
  assert.equal(last.level, 90);
  assert.equal(o.elements.get('blackoutLayer').style.background, 'rgba(0,0,0,0.97)');
});

test('slider gesture keeps mouse capture after the pointer leaves the panel', () => {
  const o = loadOverlay('primary');
  const control = o.elements.get('control');
  const slider = o.elements.get('intensitySlider');
  const ignore = () => o.sent.filter(([n]) => n === 'setIgnoreMouse').at(-1)[1];

  control.listeners.pointerenter.forEach((fn) => fn({}));
  slider.listeners.pointerdown.forEach((fn) => fn({ pointerId: 1 }));
  control.listeners.pointerleave.forEach((fn) => fn({}));
  assert.equal(ignore(), false, 'click-through must stay off mid-drag');
  slider.listeners.pointerup.forEach((fn) => fn({ clientX: 5, clientY: 5 }));
  assert.equal(ignore(), true, 'click-through restored after release outside the panel');
});

test('dragging the slider does not move the panel', () => {
  const o = loadOverlay('primary');
  const header = o.elements.get('panelHeader');
  const control = o.elements.get('control');
  // Panel dragging is bound to the header only; the slider has no drag handler.
  assert.ok(header.listeners.pointerdown?.length);
  assert.equal(control.listeners.mousedown, undefined);
  assert.equal(control.listeners.pointerdown, undefined);
});

test('secondary overlay only mirrors render state', () => {
  const o = loadOverlay('secondary');
  assert.equal(o.counters.setInterval, 0);
  assert.ok(o.document.body.classList.contains('secondary-overlay'));
  assert.deepEqual(Object.keys(o.ipcListeners), ['onRenderState']);
  o.ipcListeners.onRenderState[0]({ blackout: true, level: 100 });
  assert.equal(o.elements.get('blackoutLayer').style.opacity, '1');
});
