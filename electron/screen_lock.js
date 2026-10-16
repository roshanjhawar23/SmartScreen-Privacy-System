// Windows session lock. Pure: no Electron imports; exec, env and log are injected.
// SmartScreen may lock Windows but never unlocks it.
//
// Test mode (SMARTSCREEN_TEST=1, self-test harness only) logs the request and
// TEST_LOCK_SIMULATED instead of locking, so automated runs never lock the PC.

const LOCK_COMMAND = 'rundll32.exe user32.dll,LockWorkStation';

function isTestMode(env = process.env){
  return env?.SMARTSCREEN_TEST === '1';
}

function createScreenLocker({ exec, log = () => {}, env = process.env, onError = () => {} }){
  const testMode = isTestMode(env);

  return function lockScreen(reason = 'manual'){
    log(`LOCK_REQUESTED|reason=${reason}`);

    if(testMode){
      log(`TEST_LOCK_SIMULATED|reason=${reason}`);
      return;
    }

    exec(LOCK_COMMAND, (error, _stdout, stderr) => {
      if(error){
        log(`LOCK_ERROR|reason=${reason}|${error.message}`);
        onError(error);
        return;
      }
      if(stderr?.trim()) log(`LOCK_STDERR|reason=${reason}|${stderr.trim()}`);
      log(`LOCK_COMMAND_COMPLETED|reason=${reason}`);
    });
  };
}

module.exports = { createScreenLocker, isTestMode, LOCK_COMMAND };
