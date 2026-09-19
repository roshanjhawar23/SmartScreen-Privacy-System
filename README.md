# SmartScreen Privacy Suite

Local privacy protection for Windows using Electron and on-device computer vision.

## Phase 1B

Phase 1B adds owner face enrollment using OpenCV YuNet + SFace. Enrollment captures five camera samples, creates a normalized face embedding locally, and stores the resulting biometric template using Electron's OS-backed `safeStorage` encryption.

### Development requirements

- Windows 10/11 64-bit
- Node.js/npm
- Python 3.10+
- Webcam
- `opencv-contrib-python`
- NumPy
- YuNet and SFace ONNX model files in `models/`

Install Python dependencies:

```powershell
python -m pip install -r backend\requirements-phase1b.txt
```

Download models:

```powershell
powershell -ExecutionPolicy Bypass -File .\models\download_face_models.ps1
```

Run:

```powershell
npm install
npm start
```

## Privacy architecture

Camera frames used for enrollment are processed locally. Temporary enrollment images are deleted after processing. The stored owner template is encrypted using the Windows-backed Electron `safeStorage` mechanism.
