// Line protocol between Electron and the Python identity monitor.

const MAX_PENDING = 64 * 1024;

// Pipe chunks are not line-aligned: "STATE|OWNER_PR" can arrive in one chunk and
// "ESENT|..." in the next. Buffer partial lines and only emit complete ones.
function createLineSplitter(onLine){
  let pending = '';
  return {
    push(chunk){
      pending += chunk.toString();
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      if(pending.length > MAX_PENDING) pending = '';
      for(const line of lines){
        const msg = line.trim();
        if(msg) onLine(msg);
      }
    },
    flush(){
      const msg = pending.trim();
      pending = '';
      if(msg) onLine(msg);
    }
  };
}

const NUMERIC_KEYS = new Set(['faces','owners','unknown','best','ownerScore']);

function parseStateMessage(message){
  const parts = String(message).split('|');
  const data = { state: parts[1] || 'UNKNOWN' };
  for(const part of parts.slice(2)){
    const [key, value] = part.split('=');
    if(NUMERIC_KEYS.has(key)) data[key] = Number(value || 0);
  }
  return data;
}

function parseErrorMessage(message){
  const parts = String(message).split('|');
  return {
    kind: parts[1] || 'AI_UNAVAILABLE',
    message: parts.slice(2).join('|') || 'Privacy recognition service unavailable.'
  };
}

module.exports = { createLineSplitter, parseStateMessage, parseErrorMessage };
