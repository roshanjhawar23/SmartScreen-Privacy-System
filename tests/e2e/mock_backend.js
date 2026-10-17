// Scripted stand-in for backend/face_detection.py (self-test harness only).
// main.js spawns it when SMARTSCREEN_TEST=1 and SMARTSCREEN_MOCK_BACKEND=<scenario.json>.
//
// Speaks the same line protocol: reads one JSON config line on stdin, then STOP
// (or EOF), and emits AI_READY / AI_HEARTBEAT / STATE|... / PHOTO|... / AI_ERROR|...
// Snapshots follow the real backend: sent only while security images are on (config
// evidence.enabled, or "EVIDENCE|1" / "EVIDENCE|0" on stdin), as PHOTO|<event>|<base64 JPEG>.
//
// Scenario file:
// {
//   "heartbeatMs": 2000,               // AI_HEARTBEAT interval while heartbeats are on
//   "stateUpdateMs": 400,              // face states are re-emitted like the real backend (0 = off)
//   "autoTracks": true,                // face states without "tracks" get default tracks (owner LIVE)
//   "steps": [
//     { "at": 0,    "emit": "AI_READY" },
//     { "at": 300,  "state": "OWNER_PRESENT" },          // formatted like the real backend
//     { "at": 2000, "state": "UNKNOWN_PERSON", "snapshot": true },
//     { "at": 2000, "state": "UNKNOWN_PERSON", "tracks": [{ "id": 2, "role": "unknown", "facing": "AWAY", "yaw": 60 }] },
//        // tracks: exposure (presentMs/facingMs/lookingMs) grows from the step's start, like face_tracker.py
//     { "at": 4000, "heartbeat": false },                // simulate a hung vision loop (all output stops)
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

// 8×8 grey JPEG (valid file, tiny).
const TINY_JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAAIAAgBAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+iiigD//Z';

function formatState(state, overrides = {}){
  const counts = { ...(STATE_COUNTS[state] || { faces:1, owners:0, unknown:1 }), ...overrides };
  if(state === 'NO_USER') return 'STATE|NO_USER|faces=0|owners=0|unknown=0|best=0.0000';
  const ownerScore = counts.owners > 0 ? Number(overrides.ownerScore ?? 0.62) : 0;
  const best = counts.owners > 0 ? ownerScore : Number(overrides.best ?? 0.12);
  return `STATE|${state}|faces=${counts.faces}|owners=${counts.owners}|unknown=${counts.unknown}`
    + `|best=${best.toFixed(4)}|ownerScore=${ownerScore.toFixed(4)}`;
}

// Default tracks like the real backend emits for each face state.
const DEFAULT_TRACKS = {
  OWNER_PRESENT:[{ id:1, role:'owner' }],
  UNKNOWN_PERSON:[{ id:2, role:'unknown' }],
  UNKNOWN_GROUP:[{ id:2, role:'unknown' }, { id:3, role:'unknown' }],
  OWNER_AND_UNKNOWN:[{ id:1, role:'owner' }, { id:2, role:'unknown' }]
};

// tracks=... suffix like monitor_core.pose_fields; exposure grows with elapsedMs.
function formatTracks(tracks, elapsedMs){
  if(!Array.isArray(tracks) || tracks.length === 0) return '';
  const views = tracks.map((t) => {
    const facing = t.facing || 'FACING_SCREEN';
    const present = Math.round(elapsedMs + (t.presentOffsetMs || 0));
    return {
      id:t.id ?? 1, role:t.role === 'owner' ? 'O' : 'U', facing, yaw:Number(t.yaw ?? 0), pitch:Number(t.pitch ?? 0),
      presentMs:present,
      facingMs:facing === 'FACING_SCREEN' ? present : 0,
      lookingMs:facing === 'AWAY' ? 0 : present,
      liveness:({ LIVE:'L', SUSPECT:'S', UNKNOWN:'U' })[t.liveness || 'LIVE'] || 'U',
      size:Number(t.size ?? 0.15)
    };
  });
  const unknown = views.filter((v) => v.role === 'U');
  const primary = (unknown.length ? unknown : views).reduce((a, b) => (b.lookingMs > a.lookingMs ? b : a));
  const encoded = views.map((v) => `${v.id}:${v.role}:${v.facing}:${v.yaw.toFixed(1)}:${v.pitch.toFixed(1)}:${v.presentMs}:${v.facingMs}:${v.lookingMs}:${v.liveness}:${v.size.toFixed(3)}`).join(',');
  return `|facing=${primary.facing}|yaw=${primary.yaw.toFixed(1)}|pitch=${primary.pitch.toFixed(1)}|tracks=${encoded}`;
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
  return {
    heartbeatMs:Math.max(100, Number(scenario.heartbeatMs ?? 2000)),
    stateUpdateMs:Math.max(0, Number(scenario.stateUpdateMs ?? 400)),
    autoTracks:scenario.autoTracks !== false,
    steps
  };
}

// Pure scheduler: timers and output are injected so it can be unit-tested.
function runScenario(scenario, { emit, exit, timers = { setTimeout, clearTimeout, setInterval, clearInterval }, evidence = { on:false } }){
  const handles = [];
  let photoEvent = 0;
  let heartbeat = null;
  let repeat = null;
  let stopped = false;

  // Face states (not NO_USER) are re-emitted while stable, like StateTracker.update_interval.
  function stopRepeat(){
    if(repeat){ timers.clearInterval(repeat); repeat = null; }
  }
  function emitState(step){
    stopRepeat();
    const tracks = step.tracks || (scenario.autoTracks ? DEFAULT_TRACKS[step.state] : null);
    const line = (elapsedMs) => formatState(step.state, step.counts) + formatTracks(tracks, elapsedMs);
    emit(line(0));
    if(step.snapshot && evidence.on) emit(`PHOTO|${++photoEvent}|${TINY_JPEG}`);
    if(scenario.stateUpdateMs > 0 && step.state !== 'NO_USER'){
      let count = 0;
      repeat = timers.setInterval(() => emit(line(++count * scenario.stateUpdateMs)), scenario.stateUpdateMs);
    }
  }

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
    stopRepeat();
    handles.forEach((h) => timers.clearTimeout(h));
    exit(code);
  }

  startHeartbeat();
  for(const step of scenario.steps){
    handles.push(timers.setTimeout(() => {
      if(stopped) return;
      if('emit' in step){
        if(String(step.emit).startsWith('AI_ERROR|')) stopRepeat();
        emit(String(step.emit));
      }else if('state' in step) emitState(step);
      else if('heartbeat' in step){
        if(step.heartbeat) startHeartbeat();
        else { stopHeartbeat(); stopRepeat(); }
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
  const evidence = { on:false };
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
          evidence.on = config.evidence?.enabled === true;
          // Phase 4: one template per trusted person ("templates"); "template" is the older form.
          const templates = Array.isArray(config.templates) ? config.templates : (Array.isArray(config.template) ? [config.template] : []);
          if(templates.length === 0 || !templates.every((t) => Array.isArray(t) && t.length > 0)) throw new Error('template missing');
        }catch(error){
          out(`AI_ERROR|AI_UNAVAILABLE|Invalid AI configuration: ${error.message}`);
          process.exit(1);
        }
        run = runScenario(scenario, { emit:out, exit:(code) => process.exit(code), evidence });
      }else if(line.trim() === 'EVIDENCE|1' || line.trim() === 'EVIDENCE|0'){
        evidence.on = line.trim() === 'EVIDENCE|1';
      }else if(line.trim() === 'STOP'){
        run?.stop(0);
      }
    }
  });
  // EOF: the Electron parent is gone.
  process.stdin.on('end', () => (run ? run.stop(0) : process.exit(0)));
}

if(require.main === module) main();

module.exports = { formatState, formatTracks, parseScenario, runScenario, TINY_JPEG };
