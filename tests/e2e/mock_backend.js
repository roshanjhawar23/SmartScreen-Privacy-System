// Scripted stand-in for backend/face_detection.py (self-test harness only).
// main.js spawns it when SMARTSCREEN_TEST=1 and SMARTSCREEN_MOCK_BACKEND=<scenario.json>.
//
// Speaks the same line protocol: reads one JSON config line on stdin, then STOP
// (or EOF), and emits AI_READY / AI_HEARTBEAT / STATE|... / PHOTO_SAVED|... / AI_ERROR|...
//
// Scenario file:
// {
//   "heartbeatMs": 2000,               // AI_HEARTBEAT interval while heartbeats are on
//   "steps": [
//     { "at": 0,    "emit": "AI_READY" },
//     { "at": 300,  "state": "OWNER_PRESENT" },          // formatted like the real backend
//     { "at": 2000, "state": "UNKNOWN_PERSON", "snapshot": true },
//     { "at": 4000, "heartbeat": false },                // simulate a hung vision loop
//     { "at": 5000, "emit": "AI_ERROR|CAMERA_ERROR|..." },
//     { "at": 5050, "exit": 1 }
//   ]
// }

const STATE_COUNTS = {
  OWNER_PRESENT:{ faces:1, owners:1, unknown:0 },
  NO_USER:{ faces:0, owners:0, unknown:0 },
  UNKNOWN_PERSON:{ faces:1, owners:0, unknown:1 },
  UNKNOWN_GROUP:{ faces:2, owners:0, unknown:2 },
  OWNER_AND_UNKNOWN:{ faces:2, owners:1, unknown:1 }
};

function formatState(state, overrides = {}){
  const counts = { ...(STATE_COUNTS[state] || { faces:1, owners:0, unknown:1 }), ...overrides };
  if(state === 'NO_USER') return 'STATE|NO_USER|faces=0|owners=0|unknown=0|best=0.0000';
  const ownerScore = counts.owners > 0 ? Number(overrides.ownerScore ?? 0.62) : 0;
  const best = counts.owners > 0 ? ownerScore : Number(overrides.best ?? 0.12);
  return `STATE|${state}|faces=${counts.faces}|owners=${counts.owners}|unknown=${counts.unknown}`
    + `|best=${best.toFixed(4)}|ownerScore=${ownerScore.toFixed(4)}`;
}

function parseScenario(raw){
  const scenario = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if(!scenario || !Array.isArray(scenario.steps)) throw new Error('Scenario needs a steps array.');
  const steps = scenario.steps.map((step, i) => {
    const at = Number(step.at);
    if(!Number.isFinite(at) || at < 0) throw new Error(`Step ${i}: "at" must be a non-negative number.`);
    const kinds = ['emit', 'state', 'heartbeat', 'exit'].filter((k) => k in step);
    if(kinds.length !== 1) throw new Error(`Step ${i}: exactly one of emit/state/heartbeat/exit.`);
    return { ...step, at };
  }).sort((a, b) => a.at - b.at);
  return { heartbeatMs:Math.max(100, Number(scenario.heartbeatMs ?? 2000)), steps };
}

// Pure scheduler: timers and output are injected so it can be unit-tested.
function runScenario(scenario, { emit, exit, timers = { setTimeout, clearTimeout, setInterval, clearInterval } }){
  const handles = [];
  let heartbeat = null;
  let stopped = false;

  function startHeartbeat(){
    if(!heartbeat) heartbeat = timers.setInterval(() => emit('AI_HEARTBEAT'), scenario.heartbeatMs);
  }
  function stopHeartbeat(){
    if(heartbeat){ timers.clearInterval(heartbeat); heartbeat = null; }
  }
  function stop(code = 0){
    if(stopped) return;
    stopped = true;
    stopHeartbeat();
    handles.forEach((h) => timers.clearTimeout(h));
    exit(code);
  }

  startHeartbeat();
  for(const step of scenario.steps){
    handles.push(timers.setTimeout(() => {
      if(stopped) return;
      if('emit' in step) emit(String(step.emit));
      else if('state' in step){
        emit(formatState(step.state, step.counts));
        if(step.snapshot) emit(`PHOTO_SAVED|mock-snapshot-${step.at}.jpg`);
      }else if('heartbeat' in step){
        if(step.heartbeat) startHeartbeat(); else stopHeartbeat();
      }else if('exit' in step) stop(Number(step.exit) || 0);
    }, step.at));
  }
  return { stop };
}

function main(){
  const fs = require('fs');
  const scenario = parseScenario(fs.readFileSync(process.argv[2], 'utf8'));
  const out = (line) => process.stdout.write(`${line}\n`);
  let pending = '';
  let configured = false;
  let run = null;

  process.stdin.on('data', (chunk) => {
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop();
    for(const line of lines){
      if(!configured){
        configured = true;
        try{
          const config = JSON.parse(line);
          if(!Array.isArray(config.template) || config.template.length === 0) throw new Error('template missing');
        }catch(error){
          out(`AI_ERROR|AI_UNAVAILABLE|Invalid AI configuration: ${error.message}`);
          process.exit(1);
        }
        run = runScenario(scenario, { emit:out, exit:(code) => process.exit(code) });
      }else if(line.trim() === 'STOP'){
        run?.stop(0);
      }
    }
  });
  // EOF: the Electron parent is gone.
  process.stdin.on('end', () => (run ? run.stop(0) : process.exit(0)));
}

if(require.main === module) main();

module.exports = { formatState, parseScenario, runScenario };
