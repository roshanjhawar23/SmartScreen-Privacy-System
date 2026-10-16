// Foreground application (process path + window title) on Windows, via koffi (user32/kernel32).
// The title is returned to the caller for in-memory matching only; never log it.
//
// Test mode (SMARTSCREEN_TEST=1) can replace the reader with a JSON file
// (SMARTSCREEN_TEST_ACTIVE_APP = path to {"process": "...", "title": "..."}), re-read on
// every call so e2e tests can change the "foreground app" while the app runs.

const fs = require('fs');

function testReader(file){
  return () => {
    try{
      const app = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { process:String(app.process || ''), title:String(app.title || ''), pid:-1 };
    }catch{
      return null;
    }
  };
}

function createActiveWindowReader({ platform = process.platform, env = process.env, loadKoffi = () => require('koffi') } = {}){
  if(env.SMARTSCREEN_TEST === '1' && env.SMARTSCREEN_TEST_ACTIVE_APP) return { available:true, read:testReader(env.SMARTSCREEN_TEST_ACTIVE_APP) };
  if(platform !== 'win32') return { available:false, read:() => null };

  try{
    const koffi = loadKoffi();
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    const GetForegroundWindow = user32.func('__stdcall', 'GetForegroundWindow', 'uintptr_t', []);
    const GetWindowTextW = user32.func('__stdcall', 'GetWindowTextW', 'int', ['uintptr_t', 'void *', 'int']);
    const GetWindowThreadProcessId = user32.func('__stdcall', 'GetWindowThreadProcessId', 'uint32', ['uintptr_t', '_Out_ uint32 *']);
    const OpenProcess = kernel32.func('__stdcall', 'OpenProcess', 'void *', ['uint32', 'int', 'uint32']);
    const QueryFullProcessImageNameW = kernel32.func('__stdcall', 'QueryFullProcessImageNameW', 'int', ['void *', 'uint32', 'void *', '_Inout_ uint32 *']);
    const CloseHandle = kernel32.func('__stdcall', 'CloseHandle', 'int', ['void *']);
    const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

    return {
      available:true,
      read(){
        const hwnd = GetForegroundWindow();
        if(!hwnd) return null;
        const titleBuf = Buffer.alloc(1024);
        const titleLen = GetWindowTextW(hwnd, titleBuf, 512);
        const pid = [0];
        GetWindowThreadProcessId(hwnd, pid);
        let processPath = '';
        const handle = pid[0] ? OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid[0]) : null;
        if(handle){
          const pathBuf = Buffer.alloc(2048);
          const size = [1024];
          if(QueryFullProcessImageNameW(handle, 0, pathBuf, size)) processPath = pathBuf.toString('utf16le', 0, size[0] * 2);
          CloseHandle(handle);
        }
        return { process:processPath, title:titleBuf.toString('utf16le', 0, Math.max(0, titleLen) * 2), pid:pid[0] };
      }
    };
  }catch{
    return { available:false, read:() => null };
  }
}

module.exports = { createActiveWindowReader };
