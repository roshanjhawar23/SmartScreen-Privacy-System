"""Head pose (yaw / pitch / roll) from YuNet's 5 landmarks. Pure, no OpenCV.

Model: a generic face in units of the inter-ocular distance (IPD). Eyes at (±0.5, 0, 0);
the nose tip sits ``nose_drop`` below the eye line and ``nose_depth`` in front of it.
Under orthographic projection the nose's horizontal offset from the eye midpoint gives
yaw, and its drop below the eye line gives pitch. Roll is the eye-line angle and is
removed first. Both constants are configurable (``headPose`` settings) because real faces
and camera placement differ; estimates are approximate (a few degrees), which is enough
to tell "facing the screen" from "turned away".

Conventions: yaw > 0 = nose towards image right; pitch > 0 = looking down.
YuNet landmark order: right eye, left eye, nose tip, right mouth corner, left mouth corner
(the subject's right eye appears on the image left).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

FACING_SCREEN = "FACING_SCREEN"
GLANCING = "GLANCING"
AWAY = "AWAY"


@dataclass(frozen=True)
class PoseConfig:
    nose_drop: float = 0.55     # nose tip below the eye line, in IPD units
    nose_depth: float = 0.60    # nose tip in front of the eye plane, in IPD units
    pitch_offset: float = 0.0   # neutral pitch when looking at the screen (camera placement)
    facing_yaw: float = 20.0    # |yaw| ≤ this (and pitch) → FACING_SCREEN
    facing_pitch: float = 20.0
    glancing_yaw: float = 45.0  # |yaw| ≤ this (and pitch) → GLANCING, else AWAY
    glancing_pitch: float = 35.0

    @classmethod
    def from_dict(cls, raw: dict | None) -> "PoseConfig":
        raw = raw or {}
        names = {"noseDrop": "nose_drop", "noseDepth": "nose_depth", "pitchOffset": "pitch_offset",
                 "facingYaw": "facing_yaw", "facingPitch": "facing_pitch",
                 "glancingYaw": "glancing_yaw", "glancingPitch": "glancing_pitch"}
        values = {}
        for key, attr in names.items():
            if key in raw:
                try:
                    values[attr] = float(raw[key])
                except (TypeError, ValueError):
                    pass
        return cls(**values)


@dataclass(frozen=True)
class Pose:
    yaw: float
    pitch: float
    roll: float
    facing: str


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def estimate_pose(landmarks, config: PoseConfig = PoseConfig()) -> Pose | None:
    """landmarks: 10 numbers (x, y) × 5 in YuNet order. Returns None if degenerate."""
    try:
        pts = [(float(landmarks[i]), float(landmarks[i + 1])) for i in range(0, 10, 2)]
    except (IndexError, TypeError, ValueError):
        return None
    (rex, rey), (lex, ley), (nx, ny) = pts[0], pts[1], pts[2]

    roll = math.atan2(ley - rey, lex - rex)
    mx, my = (rex + lex) / 2.0, (rey + ley) / 2.0
    cos_r, sin_r = math.cos(-roll), math.sin(-roll)

    def derotate(x: float, y: float) -> tuple[float, float]:
        dx, dy = x - mx, y - my
        return dx * cos_r - dy * sin_r, dx * sin_r + dy * cos_r

    eye_dist = math.hypot(lex - rex, ley - rey)
    if eye_dist < 1e-6:
        return None
    nose_x, nose_y = derotate(nx, ny)
    # Image-plane offsets of the nose relative to the eye distance. With unknown scale s:
    #   eye_dist = s·cos(yaw);  nose_x = s·Z·sin(yaw);  nose_y = s·A
    # where A = drop·cos(pitch) + depth·sin(pitch), Z = depth·cos(pitch) − drop·sin(pitch),
    # and A² + Z² = R². With q = cos²(yaw): v²q² − (u² + v² + R²)q + R² = 0.
    u = nose_x / eye_dist
    v = nose_y / eye_dist

    drop, depth = config.nose_drop, config.nose_depth
    radius_sq = drop * drop + depth * depth
    radius = math.sqrt(radius_sq)
    alpha = math.atan2(drop, depth)

    total = u * u + v * v + radius_sq
    if v * v < 1e-9:
        q = radius_sq / (u * u + radius_sq)
    else:
        q = (total - math.sqrt(max(0.0, total * total - 4.0 * v * v * radius_sq))) / (2.0 * v * v)
    cos_yaw = math.sqrt(_clamp(q, 0.0, 1.0))
    yaw = math.copysign(math.acos(cos_yaw), u)
    pitch = math.asin(_clamp(v * cos_yaw / radius, -1.0, 1.0)) - alpha

    yaw_deg = math.degrees(yaw)
    pitch_deg = math.degrees(pitch) - config.pitch_offset
    return Pose(yaw_deg, pitch_deg, math.degrees(roll), classify(yaw_deg, pitch_deg, config))


def classify(yaw: float, pitch: float, config: PoseConfig = PoseConfig()) -> str:
    if abs(yaw) <= config.facing_yaw and abs(pitch) <= config.facing_pitch:
        return FACING_SCREEN
    if abs(yaw) <= config.glancing_yaw and abs(pitch) <= config.glancing_pitch:
        return GLANCING
    return AWAY
