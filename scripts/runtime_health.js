const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const required = [
  ['package.json', path.join(root, 'package.json')],
  ['Electron main', path.join(root, 'electron', 'main.js')],
  ['AI backend', path.join(root, 'backend', 'face_detection.py')],
  ['YuNet model', path.join(root, 'models', 'face_detection_yunet_2023mar.onnx')],
  ['SFace model', path.join(root, 'models', 'face_recognition_sface_2021dec.onnx')],
  ['Settings', path.join(root, 'config', 'settings.json')]
];

let failed = false;
console.log('SmartScreen runtime health check');
console.log('--------------------------------');
for (const [name, file] of required) {
  const ok = fs.existsSync(file);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed = true;
}

const python = spawnSync('python', ['--version'], { encoding: 'utf8', windowsHide: true });
const pythonOutput = (python.stdout || python.stderr || '').trim();
if (python.status === 0) {
  console.log(`PASS  Python (${pythonOutput})`);
} else {
  console.log('WARN  Python command not available in PATH (development run may fail)');
}

const npm = process.platform === 'win32'
  ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm --version'], {
      encoding: 'utf8',
      windowsHide: true
    })
  : spawnSync('npm', ['--version'], {
      encoding: 'utf8',
      windowsHide: true
    });

if (npm.status === 0) {
  console.log(`PASS  npm (${(npm.stdout || '').trim()})`);
} else {
  console.log(`FAIL  npm command unavailable${npm.error ? `: ${npm.error.message}` : ''}`);
  failed = true;
}

console.log('--------------------------------');
process.exitCode = failed ? 1 : 0;
