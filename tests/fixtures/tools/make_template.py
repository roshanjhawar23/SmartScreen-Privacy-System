"""Build the owner template for e2e tests from owner.mp4 using the real enrollment code.

    python tests/fixtures/tools/make_template.py

Picks 5 well-spread frames that pass the enrollment quality gates, runs
backend/enroll_face.py on them and writes tests/fixtures/private/owner_template.json.
"""

import json
import os
import subprocess
import sys
import tempfile

import cv2

from fixture_io import MODELS_DIR, REPO_DIR, load_clip, private_path

DETECTOR = os.path.join(MODELS_DIR, "face_detection_yunet_2023mar.onnx")
RECOGNIZER = os.path.join(MODELS_DIR, "face_recognition_sface_2021dec.onnx")


def good_frames(frames):
    detector = cv2.FaceDetectorYN.create(DETECTOR, "", (320, 320), 0.85, 0.3, 5000)
    for index, frame in enumerate(frames):
        detector.setInputSize((frame.shape[1], frame.shape[0]))
        _, faces = detector.detect(frame)
        if faces is not None and len(faces) == 1 and faces[0][2] >= 90 and faces[0][3] >= 90:
            yield index


def main():
    frames, _ = load_clip(private_path("owner.mp4"))
    candidates = list(good_frames(frames))
    if len(candidates) < 5:
        raise SystemExit(f"Only {len(candidates)} usable frames in owner.mp4; re-record closer to the camera.")
    picks = [candidates[round(i * (len(candidates) - 1) / 4)] for i in range(5)]

    with tempfile.TemporaryDirectory() as tmp:
        paths = []
        for i, index in enumerate(picks):
            path = os.path.join(tmp, f"sample_{i}.jpg")
            cv2.imwrite(path, frames[index])
            paths.append(path)
        cmd = [sys.executable, os.path.join(REPO_DIR, "backend", "enroll_face.py"),
               "--detector", DETECTOR, "--recognizer", RECOGNIZER]
        for path in paths:
            cmd += ["--image", path]
        result = subprocess.run(cmd, capture_output=True, text=True)

    payload = json.loads(result.stdout.strip().splitlines()[-1])
    if not payload.get("ok"):
        raise SystemExit(f"Enrollment failed: {payload.get('error')}")
    with open(private_path("owner_template.json"), "w", encoding="utf-8") as fh:
        json.dump({"embedding": payload["embedding"], "sampleCount": payload["sampleCount"], "frames": picks}, fh)
    print(f"wrote owner_template.json from frames {picks}")


if __name__ == "__main__":
    main()
