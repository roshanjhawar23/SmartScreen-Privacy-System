(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SmartScreenPrivacyState = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function() {
  const STATES = Object.freeze({
    INACTIVE: 'INACTIVE',
    STARTING: 'STARTING',
    OWNER_PRESENT: 'OWNER_PRESENT',
    UNKNOWN_PERSON: 'UNKNOWN_PERSON',
    UNKNOWN_GROUP: 'UNKNOWN_GROUP',
    OWNER_AND_UNKNOWN: 'OWNER_AND_UNKNOWN',
    NO_USER: 'NO_USER',
    AI_UNAVAILABLE: 'AI_UNAVAILABLE',
    CAMERA_ERROR: 'CAMERA_ERROR'
  });

  const THREAT_STATES = new Set([
    STATES.UNKNOWN_PERSON,
    STATES.UNKNOWN_GROUP,
    STATES.OWNER_AND_UNKNOWN
  ]);

  const KNOWN_STATES = new Set(Object.values(STATES));

  function normalizeState(state) {
    const value = typeof state === 'string' ? state.trim().toUpperCase() : '';
    return KNOWN_STATES.has(value) ? value : STATES.AI_UNAVAILABLE;
  }

  function isThreatState(state) {
    return THREAT_STATES.has(normalizeState(state));
  }

  function classify(state) {
    const normalized = normalizeState(state);

    if (normalized === STATES.OWNER_PRESENT) return 'OWNER';
    if (normalized === STATES.NO_USER) return 'AWAY';
    if (isThreatState(normalized)) return 'THREAT';
    if (normalized === STATES.STARTING) return 'STARTING';
    if (normalized === STATES.INACTIVE) return 'INACTIVE';
    if (normalized === STATES.CAMERA_ERROR) return 'CAMERA_ERROR';
    return 'UNAVAILABLE';
  }

  function normalizePayload(payload) {
    if (!payload || typeof payload !== 'object') {
      return { state: STATES.AI_UNAVAILABLE, category: 'UNAVAILABLE' };
    }

    const state = normalizeState(payload.state);
    return {
      ...payload,
      state,
      category: classify(state)
    };
  }

  return Object.freeze({
    STATES,
    THREAT_STATES,
    normalizeState,
    normalizePayload,
    isThreatState,
    classify
  });
});
