"""Smoke test: real YuNet/SFace models on a fake camera. Not an accuracy test."""

import os
import threading

import numpy as np
import pytest

from conftest import MODELS_DIR

cv2 = pytest.importorskip("cv2")
import face_detection  # noqa: E402

DETECTOR = os.path.join(MODELS_DIR, "face_detection_yunet_2023mar.onnx")
RECOGNIZER = os.path.join(MODELS_DIR, "face_recognition_sface_2021dec.onnx")

pytestmark = pytest.mark.skipif(
    not (os.path.exists(DETECTOR) and os.path.exists(RECOGNIZER)), reason="face models not downloaded"
)


class FakeClock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t

    def sleep(self, seconds):
        self.t += seconds


class FakeCamera:
    """Delivers ``good`` blank frames, then fails every read."""

    def __init__(self, clock, good, step=0.1):
        self.clock, self.good, self.step = clock, good, step
        self.reads = 0

    def read(self):
        self.reads += 1
        self.clock.t += self.step
        if self.reads <= self.good:
            return True, np.full((480, 640, 3), 90, dtype=np.uint8)
        return False, None


def make_config(tmp_path):
    return face_detection.parse_config(
        {
            "template": list(np.random.default_rng(0).normal(size=128)),
            "processEveryN": 1,
            "confirmFrames": 2,
            "noUserDetectionDelay": 0.5,
            "cameraFailureTimeout": 1.0,
            "logDir": str(tmp_path),
        }
    )


@pytest.fixture
def captured(monkeypatch):
    lines = []
    monkeypatch.setattr(face_detection, "emit", lines.append)
    return lines


@pytest.fixture(scope="module")
def models():
    return face_detection.create_models(DETECTOR, RECOGNIZER, 0.85)


def test_real_models_no_face_then_camera_error(tmp_path, captured, models):
    detector, recognizer = models
    clock = FakeClock()

    with pytest.raises(face_detection.CameraError) as err:
        face_detection.run_monitor(
            FakeCamera(clock, good=20), detector, recognizer, make_config(tmp_path),
            threading.Event(), clock=clock, sleep=clock.sleep,
        )

    assert str(err.value).startswith("CAMERA_ERROR|")
    assert captured == ["STATE|NO_USER|faces=0|owners=0|unknown=0|best=0.0000"]
    assert os.listdir(tmp_path) == []  # no snapshots for empty frames


def test_run_monitor_returns_on_stop_event(tmp_path, captured, models):
    detector, recognizer = models
    clock = FakeClock()
    stop = threading.Event()
    stop.set()
    face_detection.run_monitor(FakeCamera(clock, good=5), detector, recognizer, make_config(tmp_path), stop, clock=clock)
    assert captured == []


def test_parse_config_requires_template():
    with pytest.raises(RuntimeError):
        face_detection.parse_config({})


def test_parse_config_default_log_dir_not_in_repo():
    config = face_detection.parse_config({"template": [1.0, 0.0]})
    repo = os.path.dirname(MODELS_DIR)
    assert not os.path.abspath(config["logDir"]).lower().startswith(repo.lower())
