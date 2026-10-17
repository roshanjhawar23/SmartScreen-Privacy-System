// Where the AI service lives and which environment it gets. Pure: no Electron imports.
//
// Dev runs the Python scripts with the system `python`. The installed app runs the
// PyInstaller build (one exe, two modes: monitor and `enroll`) from resources.
// Self-test switches (SMARTSCREEN_TEST and friends) only work in dev: an installed
// copy must not let an environment variable disable locking or swap the camera.

const path = require('path');

const PACKAGED_EXE = path.join('backend', 'smartscreen_ai', 'smartscreen_ai.exe');
const SCRIPTS = { monitor:'face_detection.py', enroll:'enroll_face.py' };

function resolveAiCommand({ packaged, resourcesPath, appDir, mode }){
  if(!SCRIPTS[mode]) throw new Error(`Unknown AI mode: ${mode}`);
  if(packaged){
    return { command:path.join(resourcesPath, PACKAGED_EXE), args:mode === 'enroll' ? ['enroll'] : [] };
  }
  return { command:'python', args:[path.join(appDir, 'backend', SCRIPTS[mode])] };
}

function effectiveTestMode({ packaged, env = process.env }){
  return !packaged && env?.SMARTSCREEN_TEST === '1';
}

// Environment for child processes: test switches removed unless test mode is on.
function childEnv({ testMode, env = process.env }){
  if(testMode) return env;
  const out = {};
  for(const [key, value] of Object.entries(env || {})){
    if(!key.toUpperCase().startsWith('SMARTSCREEN_')) out[key] = value;
  }
  return out;
}

module.exports = { PACKAGED_EXE, resolveAiCommand, effectiveTestMode, childEnv };
