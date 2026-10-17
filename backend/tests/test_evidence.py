"""Security images (opt-in): small in-memory JPEGs, owner masked, owner-confirmed events discarded."""

import base64
import threading

import numpy as np
import pytest

cv2 = pytest.importorskip("cv2")

import face_detection  # noqa: E402
from face_tracker import OWNER, UNKNOWN, TrackView  # noqa: E402
from monitor_core import EvidenceConfig, EvidenceEvents  # noqa: E402
from test_face_path import TEMPLATE, Camera, Clock, Detector, Recognizer  # noqa: E402


def track(track_id, role, box=None):
    return TrackView(track_id, role, "FACING_SCREEN", 0, 0, 1, 1, 1, box=box)


def test_config_is_opt_in_and_clamped():
    assert EvidenceConfig.from_dict(None).enabled is False
    assert EvidenceConfig.from_dict({"enabled": "yes"}).enabled is False  # only a real true enables
    cfg = EvidenceConfig.from_dict({"enabled": True, "maxWidth": 5000, "jpegQuality": "bad"})
    assert (cfg.enabled, cfg.max_width, cfg.jpeg_quality) == (True, 640, 70)


def test_snapshot_is_small_downscaled_and_masks_the_owner():
    frame = np.full((480, 640, 3), 200, dtype=np.uint8)
    data = face_detection.encode_snapshot(frame, EvidenceConfig(enabled=True), mask_boxes=[(100, 100, 100, 100)])
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    assert image.shape[:2] == (240, 320)
    assert len(data) < 20_000
    # owner box (100..200 px, padded 20 %) scaled by 0.5 → about 40..110 → black
    assert image[75, 75].max() < 30
    assert image[200, 300].min() > 150  # elsewhere untouched


def test_snapshot_quality_drops_until_it_fits():
    rng = np.random.default_rng(1)
    noisy = rng.integers(0, 255, (480, 640, 3), dtype=np.uint8)
    data = face_detection.encode_snapshot(noisy, EvidenceConfig(enabled=True, max_bytes=20_000))
    assert data is not None and len(data) <= 20_000


def test_events_are_discarded_when_a_track_is_confirmed_as_owner():
    events = EvidenceEvents(window=60)
    first = events.open(0.0, [5])
    second = events.open(1.0, [7])
    assert events.check(2.0, [track(5, UNKNOWN), track(7, UNKNOWN)]) == []
    assert events.check(3.0, [track(5, OWNER), track(7, UNKNOWN)]) == [first]
    assert events.check(4.0, [track(5, OWNER)]) == []  # reported once
    assert events.check(70.0, [track(7, OWNER)]) == []  # second expired after 60 s
    assert second == 2


def test_stdin_commands_toggle_security_images():
    stop, evidence = threading.Event(), threading.Event()
    assert face_detection.handle_command("EVIDENCE|1\n", stop, evidence) and evidence.is_set()
    assert face_detection.handle_command("EVIDENCE|0\n", stop, evidence) and not evidence.is_set()
    assert face_detection.handle_command("whatever\n", stop, evidence)
    assert not face_detection.handle_command("STOP\n", stop, evidence) and stop.is_set()
    assert not face_detection.handle_command("", threading.Event(), evidence)  # EOF


class LateOwner(Recognizer):
    """Unknown for the first calls (e.g. owner walking in, poorly lit), then the owner."""

    def __init__(self, unknown_calls):
        super().__init__(owner=False)
        self.calls, self.unknown_calls = 0, unknown_calls

    def feature(self, aligned):
        self.calls += 1
        self.owner = self.calls > self.unknown_calls
        return super().feature(aligned)


def test_photo_of_the_owner_is_discarded_by_a_later_recognition(tmp_path, monkeypatch):
    lines = []
    monkeypatch.setattr(face_detection, "emit", lines.append)
    clock = Clock()
    config = face_detection.parse_config({
        "template": TEMPLATE.tolist(), "processEveryN": 3, "confirmFrames": 3, "cameraFailureTimeout": 1.0,
        "logDir": str(tmp_path), "evidence": {"enabled": True},
    })
    with pytest.raises(face_detection.CameraError):
        face_detection.run_monitor(Camera(clock, 4.0), Detector(), LateOwner(unknown_calls=8), config,
                                   threading.Event(), clock=clock, sleep=clock.sleep)
    photos = [line for line in lines if line.startswith("PHOTO|")]
    discards = [line for line in lines if line.startswith("PHOTO_DISCARD|")]
    assert len(photos) == 1
    event_id = photos[0].split("|")[1]
    assert discards == [f"PHOTO_DISCARD|{event_id}|reason=owner-confirmed"]
    assert lines.index(discards[0]) > lines.index(photos[0])
    assert base64.b64decode(photos[0].split("|", 2)[2])[:2] == bytes([0xFF, 0xD8])


def test_runtime_switch_off_stops_new_images(tmp_path, monkeypatch):
    lines = []
    monkeypatch.setattr(face_detection, "emit", lines.append)
    clock = Clock()
    config = face_detection.parse_config({
        "template": TEMPLATE.tolist(), "processEveryN": 3, "confirmFrames": 3, "cameraFailureTimeout": 1.0,
        "logDir": str(tmp_path), "evidence": {"enabled": True},
    })
    evidence_on = threading.Event()  # main switched it off mid-session
    with pytest.raises(face_detection.CameraError):
        face_detection.run_monitor(Camera(clock, 3.0), Detector(), Recognizer(owner=False), config,
                                   threading.Event(), clock=clock, sleep=clock.sleep, evidence_on=evidence_on)
    assert not any(line.startswith("PHOTO") for line in lines)
