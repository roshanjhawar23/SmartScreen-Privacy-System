// Plans one overlay window per display. Pure: inputs are plain objects.
//
// displays:  [{ id, bounds:{x,y,width,height} }]
// primaryId: id of the primary display
// windows:   [{ id, role:'primary'|'secondary', displayId, bounds }]
//
// Returns { updates:[{id, displayId, bounds}], creates:[{displayId, bounds}], removes:[id] }.
// The primary window (it hosts the control panel) is never removed; it follows
// the primary display.

function sameBounds(a, b){
  return Boolean(a && b) && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function planOverlayWindows(displays, primaryId, windows){
  const plan = { updates:[], creates:[], removes:[] };
  const byId = new Map(displays.map((d) => [d.id, d]));
  const primaryDisplay = byId.get(primaryId) || displays[0];
  if(!primaryDisplay) return plan;

  const primaryWindow = windows.find((w) => w.role === 'primary');
  if(primaryWindow && (primaryWindow.displayId !== primaryDisplay.id || !sameBounds(primaryWindow.bounds, primaryDisplay.bounds))){
    plan.updates.push({ id:primaryWindow.id, displayId:primaryDisplay.id, bounds:{ ...primaryDisplay.bounds } });
  }

  const covered = new Set([primaryDisplay.id]);
  for(const w of windows){
    if(w.role !== 'secondary') continue;
    const display = byId.get(w.displayId);
    if(!display || covered.has(display.id)){
      plan.removes.push(w.id);
      continue;
    }
    covered.add(display.id);
    if(!sameBounds(w.bounds, display.bounds)){
      plan.updates.push({ id:w.id, displayId:display.id, bounds:{ ...display.bounds } });
    }
  }

  for(const display of displays){
    if(!covered.has(display.id)){
      covered.add(display.id);
      plan.creates.push({ displayId:display.id, bounds:{ ...display.bounds } });
    }
  }
  return plan;
}

module.exports = { planOverlayWindows, sameBounds };
