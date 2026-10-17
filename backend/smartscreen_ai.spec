# -*- mode: python ; coding: utf-8 -*-
# PyInstaller build of the AI service: one folder (no per-launch unpacking, so the
# watchdog sees AI_READY quickly). Build: npm run build:ai
# Models are not bundled here; electron-builder ships them in resources/models.

a = Analysis(
    ['smartscreen_ai.py'],
    pathex=['.'],
    binaries=[],
    datas=[],
    hiddenimports=['cv2', 'face_detection', 'enroll_face'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'PIL', 'IPython', 'pytest', 'scipy', 'pandas'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='smartscreen_ai',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name='smartscreen_ai',
)
