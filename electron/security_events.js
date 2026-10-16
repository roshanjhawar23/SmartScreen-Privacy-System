const fs = require('fs');

// Log line format: "<ISO timestamp> - <EVENT>|key=value|..."
const LINE_PATTERN = /^(\d{4}-\d{2}-\d{2}T[^ ]+) - (.+)$/;

// Values that reach the log can come from IPC or the AI process. Strip CR/LF so a
// value can never forge an extra log line that readSecurityEvents would trust.
function sanitizeLogValue(value){
  return String(value ?? '').replace(/[\r\n]+/g,' ').slice(0,2000);
}

function formatLogLine(event, date=new Date()){
  return `${date.toISOString()} - ${sanitizeLogValue(event)}\n`;
}

function field(raw, index, prefix){
  const value = raw.split('|')[index] || '';
  return prefix && value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

const GATE_CONCEALED_TITLES = [
  [/^threat-/, 'Screen concealed — unrecognized person'],
  [/^(owner-absent|no-user)$/, 'Screen concealed — owner absent'],
  [/^session-locked$/, 'Screen concealed — session locked'],
  [/^(session-unlocked|system-resumed)$/, 'Screen concealed — verifying owner'],
  [/^retry$/, 'Retrying owner verification'],
  [/./, 'Screen concealed — verifying owner']
];

function describeGateEvent(raw){
  const [, event, reasonField = ''] = raw.split('|');
  const reason = reasonField.replace(/^reason=/, '');
  switch(event){
    case 'REVEALED': return { type:'PRESENCE', title:'Screen revealed for owner' };
    case 'CONCEALED': return { type:'PRESENCE', title:GATE_CONCEALED_TITLES.find(([re]) => re.test(reason))[1] };
    case 'FAILSAFE': return { type:'ERROR', title:'Screen protected — verification unavailable', detail:reason };
    case 'FAILSAFE_LOCK': return { type:'ACTION', title:'Screen locked — verification unavailable' };
    case 'DISABLED': return reason === 'protection-disabled' ? { type:'SYSTEM', title:'Protection disabled' } : null;
    default: return null; // VERIFYING, ABSENCE_GRACE: too noisy for the history
  }
}

const TAMPER_TITLES = {
  'camera-covered':'Camera covered',
  'feed-frozen':'Camera feed frozen',
  'camera-device-changed':'Camera device changed',
  'config-modified':'Settings changed while protected',
  'ai-restart-loop':'Recognition service keeps restarting',
  'clock-jump':'System clock changed'
};

function describeEvent(raw){
  if(raw.startsWith('PRESENCE_GATE|')) return describeGateEvent(raw);
  if(raw.startsWith('TAMPER|')){
    const kind = field(raw,1);
    return { type:'TAMPER', title:TAMPER_TITLES[kind] || 'Tamper detected', detail:raw.split('|').slice(2).join(' ').slice(0,80) };
  }
  if(raw === 'BIOMETRIC_MIGRATED|people=1') return { type:'IDENTITY', title:'Owner moved to Trusted people' };
  if(raw === 'TRUSTED_PERSON_RENAMED') return { type:'IDENTITY', title:'Trusted person renamed' };
  if(raw === 'TRUSTED_PERSON_REMOVED') return { type:'IDENTITY', title:'Trusted person removed' };
  if(raw.startsWith('PROFILE_SAVED|')) return { type:'SYSTEM', title:`Profile saved: ${field(raw,1,'profile=')}` };
  if(raw.startsWith('PROFILE_DELETED|')) return { type:'SYSTEM', title:`Profile deleted: ${field(raw,1,'profile=')}` };
  if(raw.startsWith('ENTERPRISE_REFUSED|')) return { type:'SYSTEM', title:'Blocked by organization policy', detail:field(raw,1,'action=') };
  if(raw === 'EVIDENCE_FOLDER_OPENED') return { type:'EVIDENCE', title:'Security images folder opened' };
  if(raw.startsWith('SETTINGS_EXPORTED|')) return { type:'SYSTEM', title:'Settings exported' };
  if(raw.startsWith('SETTINGS_IMPORTED|')) return { type:'SYSTEM', title:'Settings imported' };
  if(raw.startsWith('CONFIG_CHANGED_SINCE_LAST_RUN|')) return { type:'SYSTEM', title:'Settings changed since last run', detail:field(raw,1,'file=') };
  if(raw === 'DEVICE_SETUP_COMPLETE') return { type:'SETUP', title:'Device setup completed' };
  if(raw.startsWith('BIOMETRIC_ENROLLED|')) return { type:'IDENTITY', title:'Owner identity enrolled', detail:field(raw,1,'samples=') };
  if(raw.startsWith('AI_STATE|STATE|OWNER_PRESENT')) return { type:'IDENTITY', title:'Owner verified' };
  if(raw.startsWith('AI_STATE|STATE|NO_USER')) return { type:'PRESENCE', title:'No person detected' };
  if(raw.startsWith('AI_STATE|STATE|UNKNOWN_PERSON')) return { type:'THREAT', title:'Unrecognized person detected' };
  if(raw.startsWith('AI_STATE|STATE|UNKNOWN_GROUP')) return { type:'THREAT', title:'Unrecognized people detected' };
  if(raw.startsWith('AI_STATE|STATE|OWNER_AND_UNKNOWN')) return { type:'THREAT', title:'Owner and unrecognized person detected' };
  if(raw.startsWith('PHOTO_SAVED|')) return { type:'EVIDENCE', title:'Security image captured' };
  if(raw.startsWith('WALK_AWAY_TIMER_ARMED')) return { type:'ACTION', title:'Walk-away protection armed', detail:field(raw,1,'delayMs=') };
  if(raw === 'WALK_AWAY_FOCUS_ACTIVATED') return { type:'ACTION', title:'Privacy focus activated' };
  if(raw === 'WALK_AWAY_TIMER_EXPIRED') return { type:'ACTION', title:'Walk-away timer expired' };
  if(raw === 'THREAT_FOCUS_ACTIVATED') return { type:'ACTION', title:'Privacy focus activated' };
  if(raw.startsWith('THREAT_LOCK_TIMER_EXPIRED')) return { type:'ACTION', title:'Threat lock timer expired' }; // logs before Phase 2
  if(raw === 'THREAT_LOCK_TRIGGERED') return { type:'ACTION', title:'Threat lock triggered' };
  if(raw.startsWith('POLICY_DECISION|')){
    const reason = raw.split('|').slice(2).join('|').replace(/^reason=/, '');
    return { type:'ACTION', title:reason || 'Privacy action', detail:field(raw,1,'action=') };
  }
  if(raw.startsWith('PROFILE_CHANGED|')) return { type:'SYSTEM', title:`Privacy profile: ${field(raw,1,'profile=')}` };
  if(raw.startsWith('LOCK_REQUESTED|')) return { type:'ACTION', title:'Screen lock requested', detail:field(raw,1,'reason=') };
  if(raw.startsWith('LOCK_COMMAND_COMPLETED|')) return { type:'ACTION', title:'Screen locked', detail:field(raw,1,'reason=') };
  if(raw.startsWith('TEST_LOCK_SIMULATED|')) return { type:'ACTION', title:'Screen lock simulated (test mode)', detail:field(raw,1,'reason=') };
  if(raw.startsWith('LOCK_ERROR|')) return { type:'ERROR', title:'Screen lock failed' };
  if(raw === 'AI_READY') return { type:'SYSTEM', title:'Privacy recognition service ready' };
  if(raw.startsWith('AI_ERROR|CAMERA_ERROR')) return { type:'ERROR', title:'Camera unavailable' };
  // code=null is our own STOP/kill on disable; code=0 a clean exit. Anything else is a crash.
  if(/^AI_EXIT\|code=(?!0$|null$)/.test(raw)) return { type:'ERROR', title:'Privacy recognition service stopped unexpectedly', detail:field(raw,1,'code=') };
  if(raw.startsWith('AI_ERROR|') || raw === 'AI_WATCHDOG_TIMEOUT') return { type:'ERROR', title:'Privacy recognition service unavailable' };
  return null;
}

function parseLogLine(line){
  const match = typeof line === 'string' ? line.match(LINE_PATTERN) : null;
  if(!match) return null;
  const described = describeEvent(match[2]);
  if(!described) return null;
  return { timestamp:match[1], type:described.type, title:described.title, detail:described.detail || '' };
}

function readSecurityEvents(file, limit=20){
  const max = Math.min(200, Math.max(1, Math.floor(Number(limit)) || 20));
  if(!file || !fs.existsSync(file)) return [];

  const lines = fs.readFileSync(file,'utf8').split(/\r?\n/);
  const events = [];
  for(let i=lines.length-1; i>=0 && events.length<max; i--){
    const event = parseLogLine(lines[i]);
    if(event) events.push(event);
  }
  return events;
}

module.exports = { sanitizeLogValue, formatLogLine, parseLogLine, readSecurityEvents, describeEvent };
