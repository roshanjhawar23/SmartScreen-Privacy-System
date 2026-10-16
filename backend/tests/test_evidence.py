"""Intruder snapshots: small files, bounded count, never touching other files."""

import os
import threading

import numpy as np
import pytest

cv2 = pytest.importorskip("cv2")

import face_detection  # noqa: E402
from monitor_core import EvidenceConfig, evidence_to_delete  # noqa: E402


def test_only_the_oldest_of_our_own_files_are_deleted():
    names = [
        "20261016_101500_001.jpg", "20261016_101500_002.jpg", "20261016_090000_000.jpg",
        "notes.txt", "holiday.jpg", "20261016_1015.jpg",
    ]
    assert evidence_to_delete(names, keep=2) == ["20261016_090000_000.jpg"]
    assert evidence_to_delete(names, keep=10) == []
    assert evidence_to_delete(names, keep=0) == ["20261016_090000_000.jpg", "20261016_101500_001.jpg"]  # keeps >= 1


def test_config_defaults_and_clamps():
    assert EvidenceConfig.from_dict(None) == EvidenceConfig(True, 30, 320, 70)
    cfg = EvidenceConfig.from_dict({"enabled": False, "maxImages": 99999, "maxWidth": 10, "jpegQuality": "bad"})
    assert cfg == EvidenceConfig(False, 1000, 160, 70)


def test_snapshot_is_small_and_retention_applies(tmp_path):
    rng = np.random.default_rng(0)
    frame = rng.integers(0, 255, (480, 640, 3), dtype=np.uint8)
    (tmp_path / "keep-me.txt").write_text("not ours")
    cfg = EvidenceConfig(max_images=3)
    paths = []
    for i in range(5):
        # distinct names: write with explicit timestamps by renaming afterwards
        path = face_detection.save_intruder_snapshot(frame, str(tmp_path), cfg)
        new = tmp_path / f"20261016_10000{i}_000.jpg"
        os.replace(path, new)
        paths.append(new)
        face_detection.prune_evidence(str(tmp_path), cfg.max_images)
    jpgs = sorted(p.name for p in tmp_path.glob("*.jpg"))
    assert jpgs == ["20261016_100002_000.jpg", "20261016_100003_000.jpg", "20261016_100004_000.jpg"]
    assert (tmp_path / "keep-me.txt").exists()
    img = cv2.imread(str(paths[-1]))
    assert img.shape[1] == 320 and img.shape[0] == 240
    smooth = np.full((480, 640, 3), 120, dtype=np.uint8)
    small = face_detection.save_intruder_snapshot(smooth, str(tmp_path), cfg)
    assert os.path.getsize(small) < 20_000


def test_disabled_evidence_saves_nothing(tmp_path, monkeypatch):
    from test_face_path import Camera, Clock, Detector, Recognizer, TEMPLATE

    lines = []
    monkeypatch.setattr(face_detection, "emit", lines.append)
    clock = Clock()
    config = face_detection.parse_config({
        "template": TEMPLATE.tolist(), "processEveryN": 3, "confirmFrames": 3, "cameraFailureTimeout": 1.0,
        "logDir": str(tmp_path), "evidence": {"enabled": False},
    })
    with pytest.raises(face_detection.CameraError):
        face_detection.run_monitor(Camera(clock, 3.0), Detector(), Recognizer(owner=False), config,
                                   threading.Event(), clock=clock, sleep=clock.sleep)
    assert any(line.startswith("STATE|UNKNOWN_PERSON") for line in lines)
    assert not any(line.startswith("PHOTO_SAVED|") for line in lines)
    assert list(tmp_path.glob("*.jpg")) == []
