"""Regression: the with-a-face path of run_monitor (pose, liveness sample, tracker, smoothed
identity, periodic updates, STATS) end to end, with a fake detector and recognizer.

No test fixture contains a real face, so without this the code that runs when a face is in
view would only ever execute on the live webcam.
"""

import threading

import numpy as np

import face_detection
from face_detection import CameraError

TEMPLATE = np.ones(128, dtype=np.float32) / np.sqrt(128)


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t

    def sleep(self, seconds):
        self.t += seconds


class Camera:
    """30 fps of noisy frames for ``seconds``, then the camera stops."""

    def __init__(self, clock, seconds=10.0):
        self.clock, self.frames, self.reads = clock, int(seconds * 30), 0
        self.rng = np.random.default_rng(0)

    def read(self):
        self.reads += 1
        self.clock.t += 1 / 30
        if self.reads > self.frames:
            return False, None
        return True, self.rng.integers(60, 200, (480, 640, 3), dtype=np.uint8)


class Detector:
    """One face whose nose sways left/right (head movement → liveness evidence)."""

    def __init__(self, sway=8.0):
        self.calls, self.sway = 0, sway

    def setInputSize(self, size):
        pass

    def detect(self, frame):
        self.calls += 1
        dx = self.sway * np.sin(self.calls / 5)
        # x, y, w, h, right eye, left eye, nose, right mouth, left mouth, score
        face = [240, 140, 160, 180, 285, 210, 355, 210, 320 + dx, 250, 292, 290, 348, 290, 0.95]
        return 1, np.array([face], dtype=np.float32)


class Recognizer:
    def __init__(self, owner=True):
        self.owner = owner

    def alignCrop(self, frame, face):
        return frame[:112, :112]

    def feature(self, aligned):
        if self.owner:
            return (TEMPLATE * 0.9 + 0.1 / np.sqrt(128)).reshape(1, 128)
        other = np.zeros(128, dtype=np.float32)
        other[0] = 1.0
        return other.reshape(1, 128)


def run(tmp_path, monkeypatch, recognizer, detector=None, seconds=10.0):
    lines = []
    monkeypatch.setattr(face_detection, "emit", lines.append)
    clock = Clock()
    config = face_detection.parse_config({
        "template": TEMPLATE.tolist(), "processEveryN": 3, "confirmFrames": 3,
        "cameraFailureTimeout": 1.0, "logDir": str(tmp_path), "statsInterval": 5,
    })
    try:
        face_detection.run_monitor(Camera(clock, seconds), detector or Detector(), recognizer, config,
                                   threading.Event(), clock=clock, sleep=clock.sleep)
    except CameraError as err:
        lines.append(f"END|{err}")
    return lines


def states(lines):
    return [line for line in lines if line.startswith("STATE|")]


def test_owner_face_path_end_to_end(tmp_path, monkeypatch):
    lines = run(tmp_path, monkeypatch, Recognizer(owner=True))
    owner = states(lines)
    assert owner and all(s.startswith("STATE|OWNER_PRESENT|faces=1|owners=1|unknown=0") for s in owner)
    assert len(owner) >= 15  # periodic updates every ~0.4 s over ~10 s
    assert "|facing=FACING_SCREEN|" in owner[0]
    assert ":O:FACING_SCREEN:" in owner[0]
    assert owner[-1].split("|tracks=")[1].split(":")[8] == "L"  # head movement → LIVE
    assert any(line.startswith("STATS|fps=30.0|") for line in lines)
    assert "LIVENESS|track=1|state=LIVE|reason=head-movement" in lines
    assert lines[-1] == "END|CAMERA_ERROR|The camera stopped delivering frames."
    assert not any(line.startswith("PHOTO_SAVED|") for line in lines)


def test_unknown_face_path_saves_evidence_once(tmp_path, monkeypatch):
    lines = run(tmp_path, monkeypatch, Recognizer(owner=False), seconds=4.0)
    unknown = states(lines)
    assert unknown and all(s.startswith("STATE|UNKNOWN_PERSON|faces=1|owners=0|unknown=1") for s in unknown)
    assert ":U:FACING_SCREEN:" in unknown[0]
    assert sum(line.startswith("PHOTO_SAVED|") for line in lines) == 1
    assert len(list(tmp_path.iterdir())) == 1


def test_still_face_stays_liveness_unknown(tmp_path, monkeypatch):
    lines = run(tmp_path, monkeypatch, Recognizer(owner=True), detector=Detector(sway=0.0), seconds=6.0)
    last = states(lines)[-1]
    assert last.split("|tracks=")[1].split(":")[8] == "U"


def test_any_trusted_person_counts_as_owner(tmp_path, monkeypatch):
    """Phase 4: with several templates, the best match decides."""
    second = np.zeros(128, dtype=np.float32)
    second[0] = 1.0
    other_person = np.ones(128, dtype=np.float32) / np.sqrt(128)  # TEMPLATE: the first trusted person

    class SecondPerson(Recognizer):
        def feature(self, aligned):
            return second.reshape(1, 128)

    lines = []
    monkeypatch.setattr(face_detection, "emit", lines.append)
    clock = Clock()
    config = face_detection.parse_config({
        "templates": [other_person.tolist(), second.tolist()], "processEveryN": 3, "confirmFrames": 3,
        "cameraFailureTimeout": 1.0, "logDir": str(tmp_path),
    })
    try:
        face_detection.run_monitor(Camera(clock, 3.0), Detector(), SecondPerson(), config,
                                   threading.Event(), clock=clock, sleep=clock.sleep)
    except CameraError:
        pass
    found = states(lines)
    assert found and found[0].startswith("STATE|OWNER_PRESENT|faces=1|owners=1|unknown=0|best=1.0000")


def test_templates_config_validation():
    import pytest

    assert len(face_detection.parse_config({"templates": [[1.0, 0.0], [0.0, 1.0]]})["templates"]) == 2
    assert len(face_detection.parse_config({"template": [1.0, 0.0]})["templates"]) == 1
    with pytest.raises(RuntimeError):
        face_detection.parse_config({"templates": [[1.0, 0.0], [1.0, 0.0, 0.0]]})
    with pytest.raises(RuntimeError):
        face_detection.parse_config({"templates": [[]]})
