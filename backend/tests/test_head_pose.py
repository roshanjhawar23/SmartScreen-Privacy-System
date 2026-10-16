"""Head-pose math on a synthetic 3D face projected with known angles."""

import math
import random

import pytest

from head_pose import AWAY, FACING_SCREEN, GLANCING, PoseConfig, classify, estimate_pose

CFG = PoseConfig()

# Generic face, IPD units: x right (image), y down, z towards the camera.
MODEL = [
    (-0.5, 0.0, 0.0),            # right eye (image left)
    (0.5, 0.0, 0.0),             # left eye
    (0.0, CFG.nose_drop, CFG.nose_depth),  # nose tip
    (-0.4, 1.1, 0.1),            # right mouth corner
    (0.4, 1.1, 0.1),             # left mouth corner
]


def project(yaw, pitch, roll=0.0, scale=110.0, cx=320.0, cy=240.0, model=MODEL):
    """Pitch (about x), then yaw (about y), orthographic projection, then roll in-plane."""
    p, y, r = math.radians(pitch), math.radians(yaw), math.radians(roll)
    out = []
    for x, yy, z in model:
        y1 = yy * math.cos(p) + z * math.sin(p)
        z1 = -yy * math.sin(p) + z * math.cos(p)
        x2 = x * math.cos(y) + z1 * math.sin(y)
        xr = x2 * math.cos(r) - y1 * math.sin(r)
        yr = x2 * math.sin(r) + y1 * math.cos(r)
        out += [cx + scale * xr, cy + scale * yr]
    return out


@pytest.mark.parametrize("yaw", [-50, -35, -20, -10, 0, 10, 20, 35, 50])
@pytest.mark.parametrize("pitch", [-30, -15, 0, 15, 30])
def test_recovers_yaw_and_pitch(yaw, pitch):
    pose = estimate_pose(project(yaw, pitch))
    assert pose.yaw == pytest.approx(yaw, abs=0.5)
    assert pose.pitch == pytest.approx(pitch, abs=0.5)


@pytest.mark.parametrize("roll", [-30, -10, 10, 30])
def test_roll_is_removed(roll):
    pose = estimate_pose(project(25, 10, roll=roll))
    assert pose.roll == pytest.approx(roll, abs=0.5)
    assert pose.yaw == pytest.approx(25, abs=0.5)
    assert pose.pitch == pytest.approx(10, abs=0.5)


def test_scale_and_position_do_not_matter():
    for scale, cx, cy in [(40, 50, 60), (300, 900, 500)]:
        pose = estimate_pose(project(-30, 12, scale=scale, cx=cx, cy=cy))
        assert pose.yaw == pytest.approx(-30, abs=0.5)
        assert pose.pitch == pytest.approx(12, abs=0.5)


def test_landmark_noise_stays_within_a_few_degrees():
    rng = random.Random(4)
    for yaw, pitch in [(0, 0), (30, -10), (-40, 20)]:
        for _ in range(50):
            noisy = [v + rng.uniform(-1.0, 1.0) for v in project(yaw, pitch, scale=120)]
            pose = estimate_pose(noisy)
            assert abs(pose.yaw - yaw) < 5
            assert abs(pose.pitch - pitch) < 6


def test_classification_bands():
    assert estimate_pose(project(5, 5)).facing == FACING_SCREEN
    assert estimate_pose(project(30, 0)).facing == GLANCING
    assert estimate_pose(project(0, 28)).facing == GLANCING
    assert estimate_pose(project(60, 0)).facing == AWAY
    assert classify(0, -40) == AWAY


def test_thresholds_and_pitch_offset_are_configurable():
    strict = PoseConfig(facing_yaw=5, glancing_yaw=10)
    assert estimate_pose(project(8, 0), strict).facing == GLANCING
    assert estimate_pose(project(15, 0), strict).facing == AWAY
    # Camera above the screen: the owner looks ~12° down while facing the screen.
    offset = PoseConfig(pitch_offset=12)
    assert estimate_pose(project(0, 12), offset).pitch == pytest.approx(0, abs=0.5)


def test_config_from_settings_dict():
    cfg = PoseConfig.from_dict({"facingYaw": 15, "pitchOffset": "8", "glancingYaw": "bad"})
    assert cfg.facing_yaw == 15
    assert cfg.pitch_offset == 8
    assert cfg.glancing_yaw == 45


def test_degenerate_input():
    assert estimate_pose([1, 1, 1, 1, 0, 0, 0, 0, 0, 0]) is None
    assert estimate_pose([1, 2, 3]) is None
