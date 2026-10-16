// Threat score 0–100 for the unknown faces in view. Pure; every point is explained.
//
// people     20 for the first unknown face, +10 for each further one (up to +30)
// attention  most attentive unknown: facing up to 30, glancing up to 18, not looking up to 5,
//            growing over 5 s of exposure
// distance   largest unknown face: close (≥ 25 % of frame width) 15, medium (≥ 12 %) 8, far 2;
//            unknown size counts as medium
// liveness   an unknown face that looks like a photo or screen (SUSPECT) +10
// app        a sensitive app in the foreground +15
// × the profile's threatMultiplier, clamped to 0–100.

const EXPOSURE_FULL_MS = 5000;

function attentionPoints(face, glancingCounts){
  const ramp = (ms) => Math.min(1, Math.max(0, ms) / EXPOSURE_FULL_MS);
  if(face.facing === 'FACING_SCREEN') return { points:30 * ramp(face.facingMs), label:'facing the screen' };
  if(face.facing === 'GLANCING' && glancingCounts) return { points:18 * ramp(face.lookingMs), label:'glancing at the screen' };
  return { points:5 * ramp(face.presentMs), label:'nearby, not looking' };
}

function distancePoints(size){
  if(!(size > 0)) return { points:8, label:'distance unknown' };
  if(size >= 0.25) return { points:15, label:'close to the screen' };
  if(size >= 0.12) return { points:8, label:'at medium distance' };
  return { points:2, label:'far away' };
}

function threatScore({ tracks = [], sensitiveApp = null, profile = {} } = {}){
  const unknowns = tracks.filter((t) => t.role !== 'owner');
  if(unknowns.length === 0) return { score:0, components:[] };

  const components = [];
  components.push({ name:'people', points:20 + 10 * Math.min(3, unknowns.length - 1),
    label:unknowns.length === 1 ? '1 unknown face' : `${unknowns.length} unknown faces` });

  const attention = unknowns
    .map((f) => attentionPoints(f, profile.glancingCounts !== false))
    .reduce((a, b) => (b.points > a.points ? b : a));
  components.push({ name:'attention', points:attention.points, label:attention.label });

  const distance = distancePoints(Math.max(...unknowns.map((f) => Number(f.size) || 0)));
  components.push({ name:'distance', points:distance.points, label:distance.label });

  if(unknowns.some((f) => f.liveness === 'SUSPECT')) components.push({ name:'liveness', points:10, label:'face looks like a photo or screen' });
  if(sensitiveApp) components.push({ name:'sensitiveApp', points:15, label:`${sensitiveApp.label.toLowerCase()} app open` });

  const multiplier = Number.isFinite(Number(profile.threatMultiplier)) ? Number(profile.threatMultiplier) : 1;
  const raw = components.reduce((sum, c) => sum + c.points, 0) * multiplier;
  return {
    score:Math.round(Math.min(100, Math.max(0, raw))),
    components:components.map((c) => ({ ...c, points:Math.round(c.points * 10) / 10 })),
    multiplier
  };
}

// Score band → action, with the profile's bands (defaults: blur 35, focus 55, lock 80).
function scoreAction(score, bands = {}){
  const b = { blur:35, focus:55, lock:80, ...bands };
  if(score >= b.lock) return 'LOCK';
  if(score >= b.focus) return 'FOCUS';
  if(score >= b.blur) return 'BLUR';
  return 'NONE';
}

module.exports = { threatScore, scoreAction };
