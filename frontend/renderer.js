let blurOn=false;
let focusOn=false;
let vignetteOn=false;
let aiEnabled=false;

let noUserTimer=null;
let intruderTimer=null;
let lockTimer=null;
let intruderActive=false;    // ← add this
let normalCooldown=null;     // ← add this
let appSettings = {};

const alertSound = new Audio("assets/alert.mp3");
const control=document.getElementById("control");
const overlay=document.getElementById("overlay");
const focusLayer=document.getElementById("focusLayer");
const vignetteLayer=document.getElementById("vignetteLayer");
const aiWarning=document.getElementById("aiWarning");

window.electronAPI.onSettingsLoaded((event,data)=>{
  appSettings = data;
});
// ---------------- ERROR SAFETY NET ----------------
window.addEventListener("error",()=>{
  aiWarning.style.opacity="0";
  if(blurOn) toggleBlur();
  if(focusOn) toggleFocus();
});
// ---------------- CONTROL PANEL CLICKABLE ----------------
if(control){
  control.addEventListener("mouseenter",()=>{
    window.electronAPI.setIgnoreMouse(false);
  });

  control.addEventListener("mouseleave",()=>{
    window.electronAPI.setIgnoreMouse(true);
  });
}

// ---------------- BLUR ----------------
function toggleBlur(){
  blurOn=!blurOn;
  overlay.style.opacity=blurOn?"1":"0";
}

// ---------------- FOCUS SPOTLIGHT ----------------
function toggleFocus(){
  focusOn=!focusOn;
  focusLayer.style.opacity=focusOn?"1":"0";
  if(focusOn) applyFocusGradient();
}
// ---------------- VIGNETTE ----------------
function toggleVignette(){
  vignetteOn=!vignetteOn;
  vignetteLayer.style.opacity=vignetteOn?"1":"0";
}

// ---------------- AI TOGGLE BUTTON ----------------
function toggleAI(){

  aiEnabled=!aiEnabled;

  const btn=document.getElementById("aiBtn");

  if(aiEnabled){
    btn.textContent="Disable AI Detection";
    window.electronAPI.notifyAIEnabled();
    window.electronAPI.startAI();
  }else{
    btn.textContent="Enable AI Detection";
    window.electronAPI.notifyAIDisabled();
    window.electronAPI.stopAI();

    // reset screen if AI disabled
    aiWarning.style.opacity="0";
    if(intruderTimer){
  clearTimeout(intruderTimer);
  intruderTimer=null;
}

if(lockTimer){
  clearTimeout(lockTimer);
  lockTimer=null;
}

intruderActive=false;

    if(blurOn) toggleBlur();
    if(focusOn) toggleFocus();
  }
}

// ---------------- FOLLOW CURSOR FOR FOCUS ----------------
let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;

function applyFocusGradient(){
  focusLayer.style.background=
  `radial-gradient(circle 120px at ${mouseX}px ${mouseY}px,
  transparent 0px,
  rgba(0,0,0,0.75) 150px)`;
}

document.addEventListener("mousemove",(e)=>{
  mouseX = e.clientX;
  mouseY = e.clientY;
  if(!focusOn) return;
  applyFocusGradient();
});

// ---------------- HOTKEY EVENTS ----------------
window.electronAPI.onHotkeyBlur(()=>toggleBlur());
window.electronAPI.onHotkeyFocus(()=>toggleFocus());
window.electronAPI.onHotkeyVignette(()=>toggleVignette());



// -------- INTRUDER DETECTED --------
window.electronAPI.onAIIntruder(()=>{

  if(!aiEnabled) return;

  // cancel pending normal reset
  if(normalCooldown){
    clearTimeout(normalCooldown);
    normalCooldown=null;
  }

  // ignore repeated intruder signals
  if(intruderActive) return;

  intruderActive=true;
window.electronAPI.notifyIntruderAlert();  // ← tray goes red
  aiWarning.style.opacity="1";
alertSound.currentTime = 0;
alertSound.play();
  if(focusOn) toggleFocus();
  if(!blurOn) toggleBlur();

  intruderTimer=setTimeout(()=>{
  console.log("3s timer fired → focus mode");

    aiWarning.style.opacity="0";

    if(blurOn) toggleBlur();
    if(!focusOn) toggleFocus();

 }, appSettings.intruderFocusDelay || 3000);

  lockTimer=setTimeout(()=>{
  console.log("5s timer fired → locking");
  if(!aiEnabled) return;
  if(!intruderActive) return;
  window.electronAPI.lockScreen();

}, appSettings.intruderLockDelay || 5000);
console.log("EVENT: INTRUDER");
});


// -------- NORMAL SIGNAL --------
window.electronAPI.onAINormal(()=>{

  if(!aiEnabled) return;
  if(!intruderActive) return;

  // clear any existing cooldown and restart it fresh
  if(normalCooldown){
    clearTimeout(normalCooldown);
    normalCooldown=null;
  }

  normalCooldown=setTimeout(()=>{

    intruderActive=false;
window.electronAPI.notifyIntruderCleared();  // ← tray goes green
    aiWarning.style.opacity="0";

    if(intruderTimer){
      clearTimeout(intruderTimer);
      intruderTimer=null;
    }

    if(lockTimer){
      clearTimeout(lockTimer);
      lockTimer=null;
    }

    if(blurOn) toggleBlur();
    if(focusOn) toggleFocus();

    normalCooldown=null;

  },1000);
console.log("EVENT: NORMAL");
});
const panel=document.getElementById("control");

let dragging=false;
let offsetX=0;
let offsetY=0;

panel.addEventListener("mousedown",(e)=>{
  dragging=true;
  offsetX=e.clientX-panel.offsetLeft;
  offsetY=e.clientY-panel.offsetTop;
});

document.addEventListener("mousemove",(e)=>{
  if(!dragging) return;
  panel.style.left=(e.clientX-offsetX)+"px";
  panel.style.top=(e.clientY-offsetY)+"px";
  panel.style.right="auto";
});

document.addEventListener("mouseup",()=>{
  dragging=false;
});
const mini=document.getElementById("miniToggle");
const panelBody=document.getElementById("panelBody");

let collapsed=false;

mini.addEventListener("click",(e)=>{
  e.stopPropagation();

  collapsed=!collapsed;

  if(collapsed){
    panelBody.style.display="none";
  }else{
    panelBody.style.display="flex";
  }
});
function setStatus(text){
  const el=document.getElementById("ai-status");
  if(el) el.textContent="AI: "+text;
}
window.electronAPI.onAIUser(()=>{

  if(!aiEnabled) return;

  // cancel walk-away timer
  if(noUserTimer){
    clearTimeout(noUserTimer);
    noUserTimer=null;
    console.log("User returned - cancel lock timer");
  }

  // existing normal reset logic
  if(!intruderActive) return;

  intruderActive=false;

  aiWarning.style.opacity="0";

  if(intruderTimer){
    clearTimeout(intruderTimer);
    intruderTimer=null;
  }

  if(lockTimer){
    clearTimeout(lockTimer);
    lockTimer=null;
  }

  if(blurOn) toggleBlur();
  if(focusOn) toggleFocus();

});

window.electronAPI.onAINoUser(()=>{

  if(!aiEnabled) return;

  // if already counting, don't restart
  if(noUserTimer) return;

  console.log("No user detected → starting lock timer");

  noUserTimer=setTimeout(()=>{

    console.log("Walk-away lock triggered");

    window.electronAPI.lockScreen();

  }, appSettings.walkAwayLockDelay || 6000); // change to 5000–7000 if you want

});
window.electronAPI.onAIUser(()=>{
  setStatus("User Present");
});

window.electronAPI.onAINoUser(()=>{
  setStatus("No User");
});

window.electronAPI.onAIIntruder(()=>{
  setStatus("⚠ Intruder Detected");
});
window.electronAPI.onAIStarting(()=>{
  setStatus("Initializing...");
});

window.electronAPI.onAIFailed(()=>{
  setStatus("AI Failed");
});

window.electronAPI.onAIStopped(()=>{
  setStatus("Stopped");
});
window.electronAPI.onAIStarting(()=> setStatus("Initializing..."));
window.electronAPI.onAIStopped(()=> setStatus("Stopped"));
window.electronAPI.onAIFailed(()=> setStatus("Failed"));