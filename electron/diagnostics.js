// Local telemetry: event counters and the latest performance numbers. Pure: no Electron imports.
// Nothing here leaves the device; exports are written only to a file the user chooses, and never
// contain images, embeddings or window titles.

const COUNTERS = [
  ['identityChanges', (e) => e.startsWith('AI_STATE|')],
  ['threats', (e) => /^AI_STATE\|STATE\|(UNKNOWN_PERSON|UNKNOWN_GROUP|OWNER_AND_UNKNOWN)/.test(e)],
  ['policyActions', (e) => e.startsWith('POLICY_DECISION|')],
  ['lockRequests', (e) => e.startsWith('LOCK_REQUESTED|')],
  ['reveals', (e) => e.startsWith('PRESENCE_GATE|REVEALED')],
  ['failsafes', (e) => e.startsWith('PRESENCE_GATE|FAILSAFE')],
  ['tamperEvents', (e) => e.startsWith('TAMPER|')],
  ['aiFailures', (e) => /^AI_EXIT\|code=(?!0$|null$)/.test(e) || e === 'AI_WATCHDOG_TIMEOUT' || e.startsWith('AI_ERROR|')],
  ['sensitiveAppActivations', (e) => e.startsWith('SENSITIVE_APP_ACTIVE|')]
];

function createDiagnostics({ now = () => Date.now() } = {}){
  const started = now();
  const counters = Object.fromEntries(COUNTERS.map(([name]) => [name, 0]));
  let backend = null;
  let backendAt = 0;

  return {
    record(event){
      const text = String(event || '');
      for(const [name, match] of COUNTERS) if(match(text)) counters[name]++;
    },
    setBackendStats(stats){
      backend = { ...stats };
      backendAt = now();
    },
    snapshot(electron = {}){
      return {
        generatedAt:new Date(now()).toISOString(),
        uptimeMs:now() - started,
        counters:{ ...counters },
        backend:backend ? { ...backend, ageMs:now() - backendAt } : null,
        electron:{ ...electron }
      };
    },
    // One compact log line (also used for the periodic DIAGNOSTICS entry).
    summaryLine(electron = {}){
      const b = backend || {};
      const fmt = (v) => (Number.isFinite(v) ? Number(v).toFixed(1) : 'na');
      return `DIAGNOSTICS|fps=${fmt(b.fps)}|recognitionMs=${fmt(b.recognitionMs)}|visionCpu=${fmt(b.cpu)}`
        + `|appCpu=${fmt(electron.cpuPercent)}|appMemMB=${fmt(electron.memoryMB)}`;
    }
  };
}

module.exports = { createDiagnostics };
