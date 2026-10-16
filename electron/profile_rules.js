// Automatic profile switching (Phase 4). Pure: the Wi-Fi name and clock are injected.
//
// Rules are checked in order; the first match wins. A switch happens only when the matching
// rule changes (context change), so a manual profile choice holds until, for example, the
// Wi-Fi network or the time window changes.

function minutes(hhmm){
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function matchRule(rule, { ssid, now }){
  if(rule.type === 'wifi') return Boolean(ssid) && ssid === rule.ssid;
  if(rule.type === 'time'){
    const day = now.getDay();
    const t = now.getHours() * 60 + now.getMinutes();
    const from = minutes(rule.from), to = minutes(rule.to);
    if(from <= to) return rule.days.includes(day) && t >= from && t < to;
    // Overnight window (e.g. 22:00–06:00): the part after midnight belongs to the previous day.
    if(t >= from) return rule.days.includes(day);
    if(t < to) return rule.days.includes((day + 6) % 7);
    return false;
  }
  return false;
}

function resolveRule(rules, context, availableProfiles){
  return rules.find((r) => availableProfiles.includes(r.profile) && matchRule(r, context)) || null;
}

function createAutoSwitcher({ getRules, getContext, isEnabled, getAvailableProfiles, getCurrent, apply }){
  let lastKey = null;
  return {
    async evaluate(){
      if(!isEnabled()){ lastKey = null; return null; }
      const context = await getContext();
      const rule = resolveRule(getRules(), context, getAvailableProfiles());
      const key = rule ? rule.id : 'none';
      if(key === lastKey) return null; // same context: respect a manual choice
      lastKey = key;
      if(rule && rule.profile !== getCurrent()){
        apply(rule.profile, rule);
        return rule;
      }
      return null;
    },
    reset(){ lastKey = null; }
  };
}

// `netsh wlan show interfaces` → connected SSID (not BSSID), or null.
function parseNetshSsid(output){
  const match = String(output || '').match(/^\s*SSID\s*:\s*(.+?)\s*$/m);
  return match ? match[1] : null;
}

module.exports = { matchRule, resolveRule, createAutoSwitcher, parseNetshSsid };
