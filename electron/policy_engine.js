// Explainable privacy decisions. Pure: no Electron imports, no clock.
//
// decide({ state, tracks, app, profile, profileName, threatMs, ageMs })
//   → { action: NONE|BLUR|FOCUS|LOCK, reason, factors[] }
//
// For every unknown face the attention time (facing, or facing+glancing when the profile
// counts glancing) is compared with the profile's escalation thresholds — the stricter
// "sensitive" thresholds while a sensitive app is in the foreground. An unknown face that is
// present but not looking escalates on presence time with the gentler `notLooking` thresholds.
// The strongest action over all unknown faces wins.
//
// Without track data (older backend) every unknown is assumed to have faced the screen
// since the threat began, which reproduces the Phase 1 fixed timings.

const THREAT_STATES = new Set(['UNKNOWN_PERSON','UNKNOWN_GROUP','OWNER_AND_UNKNOWN']);
const ACTIONS = ['NONE','BLUR','FOCUS','LOCK'];
const VERBS = { BLUR:'Blurred', FOCUS:'Focus mode', LOCK:'Locking' };

const rank = (action) => ACTIONS.indexOf(action);
const seconds = (ms) => `${(Math.max(0, ms) / 1000).toFixed(1)} s`;

function stageFor(ms, t){
  if(t.lockMs !== null && t.lockMs !== undefined && ms >= t.lockMs) return 'LOCK';
  if(ms >= t.focusMs) return 'FOCUS';
  if(ms >= t.blurMs) return 'BLUR';
  return 'NONE';
}

// Tracks come from the last backend update; age them to "now" for timer-driven re-evaluation.
function ageTrack(track, ageMs){
  if(!ageMs) return track;
  const grow = (v) => (v > 0 ? v + ageMs : 0);
  return { ...track, presentMs:track.presentMs + ageMs, facingMs:grow(track.facingMs), lookingMs:grow(track.lookingMs) };
}

function describeFace(face, looking){
  if(!looking) return 'unknown person nearby, not looking at the screen';
  return face.facing === 'GLANCING' ? 'unknown person glancing at the screen' : 'unknown person facing the screen';
}

function decide({ state, tracks, app = null, profile, profileName = 'Default', threatMs = 0, ageMs = 0 }){
  if(!THREAT_STATES.has(state)) return { action:'NONE', reason:'No unrecognized person', factors:[] };

  const sensitive = app && app.label ? app : null;
  const escalation = sensitive ? profile.sensitiveEscalation : profile.escalation;
  let unknowns = (tracks || []).filter((t) => t.role !== 'owner').map((t) => ageTrack(t, ageMs));
  const assumed = unknowns.length === 0;
  if(assumed){
    unknowns = [{ id:0, role:'unknown', facing:'FACING_SCREEN', presentMs:threatMs, facingMs:threatMs, lookingMs:threatMs }];
  }

  let best = null;
  for(const face of unknowns){
    // Whether the face counts as looking comes from its pose now, not from elapsed time
    // (a face that has just turned to the screen has 0 ms of attention but is looking).
    const looking = face.facing === 'FACING_SCREEN' || (profile.glancingCounts && face.facing === 'GLANCING');
    const attentionMs = profile.glancingCounts ? face.lookingMs : face.facingMs;
    const action = looking ? stageFor(attentionMs, escalation) : stageFor(face.presentMs, profile.notLooking);
    const exposureMs = looking ? attentionMs : face.presentMs;
    if(!best || rank(action) > rank(best.action) || (action === best.action && exposureMs > best.exposureMs)){
      best = { action, face, looking, exposureMs };
    }
  }

  const factors = [
    { name:'unknownFaces', value:unknowns.length },
    { name:'facing', value:best.face.facing },
    { name:'exposureMs', value:Math.round(best.exposureMs) },
    { name:'looking', value:best.looking },
    { name:'sensitiveApp', value:sensitive ? sensitive.label : null },
    { name:'profile', value:profileName },
    { name:'glancingCounts', value:profile.glancingCounts }
  ];
  if(assumed) factors.push({ name:'trackData', value:'unavailable — assumed facing since the threat began' });

  const who = unknowns.length > 1 ? `${unknowns.length} unknown people; nearest: ` : '';
  const what = `${who}${describeFace(best.face, best.looking)} for ${seconds(best.exposureMs)}`;
  const where = sensitive ? ` while ${sensitive.name} (${sensitive.label.toLowerCase()}) is active` : '';
  const verb = VERBS[best.action];
  const reason = verb
    ? `${verb}: ${what}${where} (${profileName} profile)`
    : `Watching: ${what}${where} (${profileName} profile)`;
  return { action:best.action, reason, factors };
}

module.exports = { decide, stageFor, ageTrack, ACTIONS, THREAT_STATES };
