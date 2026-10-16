// Windows virtual desktops: keep our overlay windows on the desktop the user is looking at.
// Electron's setVisibleOnAllWorkspaces() is a no-op on Windows, so without this a curtain
// raised on Desktop 1 leaves Desktop 2 uncovered.
//
// Uses the documented IVirtualDesktopManager COM interface through koffi (FFI).
// MoveWindowToDesktop only works for windows owned by the calling process, which our
// overlays are. Every call fails soft: on any error `available` is false and nothing moves.

const CLSID_VirtualDesktopManager = 'AA509086-5CA9-4C25-8F95-589D3C07B48A';
const IID_IVirtualDesktopManager = 'A5CD92FF-29BE-454C-8D04-D82879FB3F1B';

function parseGuid(text){
  const hex = text.replace(/-/g, '');
  const bytes = Buffer.alloc(16);
  bytes.writeUInt32LE(parseInt(hex.slice(0, 8), 16), 0);
  bytes.writeUInt16LE(parseInt(hex.slice(8, 12), 16), 4);
  bytes.writeUInt16LE(parseInt(hex.slice(12, 16), 16), 6);
  Buffer.from(hex.slice(16), 'hex').copy(bytes, 8);
  return bytes;
}

function handleToNumber(handle){
  if(Buffer.isBuffer(handle)) return handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
  return BigInt(handle);
}

function createVirtualDesktops({ platform = process.platform, loadKoffi = () => require('koffi') } = {}){
  const unavailable = { available:false, isOnCurrentDesktop:() => true, moveToCurrentDesktop:() => false };
  if(platform !== 'win32') return unavailable;

  try{
    const koffi = loadKoffi();
    const ole32 = koffi.load('ole32.dll');
    const user32 = koffi.load('user32.dll');

    const CoInitializeEx = ole32.func('__stdcall', 'CoInitializeEx', 'int32', ['void *', 'uint32']);
    const CoCreateInstance = ole32.func('__stdcall', 'CoCreateInstance', 'int32',
      ['void *', 'void *', 'uint32', 'void *', '_Out_ void **']);
    const GetForegroundWindow = user32.func('__stdcall', 'GetForegroundWindow', 'uintptr_t', []);

    CoInitializeEx(null, 2); // STA; S_FALSE / RPC_E_CHANGED_MODE when already initialised are fine

    const out = [null];
    const hr = CoCreateInstance(parseGuid(CLSID_VirtualDesktopManager), null, 0x17, parseGuid(IID_IVirtualDesktopManager), out);
    if(hr < 0 || !out[0]) return unavailable;
    const manager = out[0];

    const vtable = koffi.decode(manager, 'void *');
    const slots = koffi.decode(vtable, koffi.array('void *', 6));
    const IsOnCurrent = koffi.proto('__stdcall', 'IsWindowOnCurrentVirtualDesktop', 'int32', ['void *', 'uintptr_t', '_Out_ int *']);
    const GetDesktopId = koffi.proto('__stdcall', 'GetWindowDesktopId', 'int32', ['void *', 'uintptr_t', 'void *']);
    const MoveToDesktop = koffi.proto('__stdcall', 'MoveWindowToDesktop', 'int32', ['void *', 'uintptr_t', 'void *']);
    const isOnCurrent = koffi.decode(slots[3], IsOnCurrent);
    const getDesktopId = koffi.decode(slots[4], GetDesktopId);
    const moveToDesktop = koffi.decode(slots[5], MoveToDesktop);

    return {
      available:true,
      isOnCurrentDesktop(handle){
        const result = [0];
        const status = isOnCurrent(manager, handleToNumber(handle), result);
        return status < 0 ? true : result[0] !== 0; // unknown → assume visible, don't thrash
      },
      // Moves our window to the desktop of the current foreground window.
      moveToCurrentDesktop(handle){
        const foreground = GetForegroundWindow();
        if(!foreground) return false;
        const desktop = Buffer.alloc(16);
        if(getDesktopId(manager, foreground, desktop) < 0 || desktop.equals(Buffer.alloc(16))) return false;
        return moveToDesktop(manager, handleToNumber(handle), desktop) >= 0;
      }
    };
  }catch{
    return unavailable;
  }
}

// One polling step: move any overlay that is not on the current desktop. Returns moves made.
function followCurrentDesktop(windows, desktops, log = () => {}){
  if(!desktops.available) return 0;
  let moved = 0;
  for(const win of windows){
    try{
      if(win.isDestroyed() || desktops.isOnCurrentDesktop(win.getNativeWindowHandle())) continue;
      const ok = desktops.moveToCurrentDesktop(win.getNativeWindowHandle());
      log(`OVERLAY_DESKTOP_FOLLOW|moved=${ok}`);
      if(ok) moved++;
    }catch(error){
      log(`OVERLAY_DESKTOP_FOLLOW_ERROR|${error.message}`);
    }
  }
  return moved;
}

module.exports = { createVirtualDesktops, followCurrentDesktop, parseGuid, handleToNumber };
