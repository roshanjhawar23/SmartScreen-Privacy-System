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

function describeEvent(raw){
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
  if(raw.startsWith('THREAT_LOCK_TIMER_EXPIRED')) return { type:'ACTION', title:'Threat lock timer expired' };
  if(raw.startsWith('LOCK_REQUESTED|')) return { type:'ACTION', title:'Screen lock requested', detail:field(raw,1,'reason=') };
  if(raw.startsWith('LOCK_COMMAND_COMPLETED|')) return { type:'ACTION', title:'Screen locked', detail:field(raw,1,'reason=') };
  if(raw.startsWith('LOCK_ERROR|')) return { type:'ERROR', title:'Screen lock failed' };
  if(raw === 'AI_READY') return { type:'SYSTEM', title:'Privacy recognition service ready' };
  if(raw.startsWith('AI_ERROR|CAMERA_ERROR')) return { type:'ERROR', title:'Camera unavailable' };
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
