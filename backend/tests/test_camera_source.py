"""Test-only camera sources: gating, real-time pacing and end-of-source behaviour."""

import os
import threading

import numpy as np
import pytest

import camera_source
from camera_source import WEBCAM, FileCameraSource, PacedFrames, resolve_camera_source

cv2 = pytest.importorskip("cv2")


class FakeClock:
    def __init__(self):
        self.t = 100.0
        self.slept = []

    def __call__(self):
        return self.t

    def sleep(self, seconds):
        self.slept.append(seconds)
        self.t += seconds


# --- gating ---------------------------------------------------------------

def test_source_ignored_without_test_mode(tmp_path):
    assert resolve_camera_source(str(tmp_path), env={}) == WEBCAM
    assert resolve_camera_source(str(tmp_path), env={"SMARTSCREEN_TEST": "0"}) == WEBCAM
    assert resolve_camera_source(str(tmp_path), env={"SMARTSCREEN_TEST": "true"}) == WEBCAM


def test_source_used_in_test_mode(tmp_path):
    env = {"SMARTSCREEN_TEST": "1"}
    assert resolve_camera_source(str(tmp_path), env=env) == os.path.abspath(str(tmp_path))
    assert resolve_camera_source("webcam", env=env) == WEBCAM
    assert resolve_camera_source("", env=env) == WEBCAM
    assert resolve_camera_source(None, env=env) == WEBCAM


def test_parse_config_ignores_camera_source_in_real_mode(monkeypatch, tmp_path):
    import face_detection

    monkeypatch.delenv("SMARTSCREEN_TEST", raising=False)
    config = face_detection.parse_config({"template": [1.0, 0.0], "cameraSource": str(tmp_path)})
    assert config["cameraSource"] == WEBCAM


def test_parse_config_uses_camera_source_in_test_mode(monkeypatch, tmp_path):
    import face_detection

    monkeypatch.setenv("SMARTSCREEN_TEST", "1")
    config = face_detection.parse_config({"template": [1.0, 0.0], "cameraSource": str(tmp_path)})
    assert config["cameraSource"] == os.path.abspath(str(tmp_path))


# --- pacing ---------------------------------------------------------------

def test_paced_frames_wait_for_real_time():
    clock = FakeClock()
    pacer = PacedFrames(count=3, fps=10, clock=clock, sleep=clock.sleep)
    assert pacer.next() == 0
    assert pacer.next() == 1
    assert clock.slept == [pytest.approx(0.1)]
    assert pacer.next() == 2
    assert pacer.next() is None
    assert pacer.next() is None


def test_paced_frames_drop_late_frames():
    clock = FakeClock()
    pacer = PacedFrames(count=100, fps=10, clock=clock, sleep=clock.sleep)
    assert pacer.next() == 0
    clock.t += 1.05  # slow consumer: 1 s of frames passed
    assert pacer.next() == 10
    clock.t += 20  # far past the end
    assert pacer.next() is None


# --- file sources ---------------------------------------------------------

def write_video(path, frames, fps=20.0):
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (64, 48))
    for value in range(frames):
        writer.write(np.full((48, 64, 3), value * 10 % 255, dtype=np.uint8))
    writer.release()


def test_video_source_ends_like_a_stopped_camera(tmp_path):
    video = tmp_path / "clip.mp4"
    write_video(video, frames=6)
    clock = FakeClock()
    source = FileCameraSource(str(video), cv2, clock=clock, sleep=clock.sleep)

    results = [source.read() for _ in range(9)]
    source.release()

    assert [ok for ok, _ in results] == [True] * 6 + [False] * 3
    assert all(frame is None for ok, frame in results if not ok)


def test_image_folder_source(tmp_path):
    for i in range(3):
        cv2.imwrite(str(tmp_path / f"{i:03d}.png"), np.full((48, 64, 3), i * 50, dtype=np.uint8))
    (tmp_path / "notes.txt").write_text("ignored")
    clock = FakeClock()
    source = FileCameraSource(str(tmp_path), cv2, clock=clock, sleep=clock.sleep)

    frames = [source.read() for _ in range(4)]
    assert [ok for ok, _ in frames] == [True, True, True, False]
    assert [int(f[0, 0, 0]) for ok, f in frames if ok] == [0, 50, 100]


def test_missing_source_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        FileCameraSource(str(tmp_path / "missing.mp4"), cv2)
    with pytest.raises(FileNotFoundError):
        FileCameraSource(str(tmp_path), cv2)  # empty folder


def test_monitor_reports_camera_error_when_video_ends(tmp_path, monkeypatch):
    import face_detection
    from conftest import MODELS_DIR

    detector_path = os.path.join(MODELS_DIR, "face_detection_yunet_2023mar.onnx")
    recognizer_path = os.path.join(MODELS_DIR, "face_recognition_sface_2021dec.onnx")
    if not (os.path.exists(detector_path) and os.path.exists(recognizer_path)):
        pytest.skip("face models not downloaded")

    lines = []
    monkeypatch.setattr(face_detection, "emit", lines.append)
    video = tmp_path / "clip.mp4"
    write_video(video, frames=20)  # 1 s, longer than the no-user delay
    clock = FakeClock()
    config = face_detection.parse_config(
        {"template": [1.0] * 128, "processEveryN": 1, "confirmFrames": 1,
         "noUserDetectionDelay": 0.5, "cameraFailureTimeout": 1.0, "logDir": str(tmp_path)}
    )
    detector, recognizer = face_detection.create_models(detector_path, recognizer_path, 0.85)

    with pytest.raises(face_detection.CameraError) as err:
        face_detection.run_monitor(
            FileCameraSource(str(video), cv2, clock=clock, sleep=clock.sleep),
            detector, recognizer, config, threading.Event(), clock=clock, sleep=clock.sleep,
        )
    assert str(err.value).startswith("CAMERA_ERROR|")
    assert lines == ["STATE|NO_USER|faces=0|owners=0|unknown=0|best=0.0000"]


def test_module_has_no_default_test_mode(monkeypatch):
    monkeypatch.delenv("SMARTSCREEN_TEST", raising=False)
    assert camera_source.is_test_mode() is False
