"""Liveness heuristic on synthetic sequences (10 processed frames per second)."""

import numpy as np

from liveness import LIVE, SUSPECT, UNKNOWN, LivenessConfig, LivenessSample, LivenessTracker, moire_score

RNG = np.random.default_rng(3)
FACE = (np.add.outer(np.linspace(60, 160, 64), np.linspace(0, 40, 64))).astype(np.uint8)  # smooth "face"


def noisy(img, sigma=3.0):
    return np.clip(img + RNG.normal(0, sigma, img.shape), 0, 255).astype(np.uint8)


def feed(tracker, n, yaw=lambda i: 0.0, pitch=lambda i: 0.0, crop=lambda i: noisy(FACE), eye=lambda i: 50.0):
    states = []
    for i in range(n):
        states.append(tracker.update(LivenessSample(i * 0.1, yaw(i), pitch(i), crop(i), eye(i), 100.0)))
    return states


def test_still_photo_with_detector_jitter_stays_unknown():
    jitter = lambda i: RNG.uniform(-1.5, 1.5)  # pose jitter from landmark noise
    states = feed(LivenessTracker(), 60, yaw=jitter, pitch=jitter)
    assert states[-1] == UNKNOWN
    assert LIVE not in states


def test_head_movement_is_live_and_latched():
    t = LivenessTracker()
    states = feed(t, 30, yaw=lambda i: 5 * np.sin(i / 4))  # ±5° sway
    assert states[-1] == LIVE
    assert t.reasons == ["head-movement"]
    assert feed(t, 40)[-1] == LIVE  # sitting still afterwards: stays live


def test_blink_is_live():
    t = LivenessTracker()
    eye = lambda i: 70.0 if i in (20, 21) else 50.0 + RNG.uniform(-1, 1)  # 0.2 s blink
    states = feed(t, 30, eye=eye)
    assert states[-1] == LIVE
    assert t.reasons == ["blink"]


def test_eyes_closed_for_long_is_not_a_blink():
    eye = lambda i: 70.0 if 10 <= i < 25 else 50.0
    assert feed(LivenessTracker(), 30, eye=eye)[-1] == UNKNOWN


def test_frozen_face_is_suspect_even_after_movement():
    t = LivenessTracker()
    feed(t, 20, yaw=lambda i: 8 * np.sin(i))
    frozen = noisy(FACE)
    states = []
    for i in range(20, 50):
        states.append(t.update(LivenessSample(i * 0.1, 0, 0, frozen, 50.0, 100.0)))
    assert states[-1] == SUSPECT
    assert t.reasons == ["frozen-face"]


def test_screen_moire_is_suspect():
    yy, xx = np.mgrid[0:64, 0:64]
    grating = (FACE.astype(float) + 40 * np.sin(xx * 2 * np.pi / 3.2) * np.sin(yy * 2 * np.pi / 3.7)).clip(0, 255).astype(np.uint8)
    assert moire_score(grating) > moire_score(noisy(FACE)) * 3
    states = feed(LivenessTracker(), 15, yaw=lambda i: 8 * np.sin(i), crop=lambda i: noisy(grating, 2))
    assert states[-1] == SUSPECT


def test_real_face_texture_is_not_moire():
    cfg = LivenessConfig()
    assert all(moire_score(noisy(FACE)) < cfg.moire_ratio for _ in range(20))


def test_config_from_dict():
    cfg = LivenessConfig.from_dict({"poseRangeDeg": 10, "moireRatio": "bad"})
    assert cfg.pose_range_deg == 10
    assert cfg.moire_ratio == LivenessConfig().moire_ratio
