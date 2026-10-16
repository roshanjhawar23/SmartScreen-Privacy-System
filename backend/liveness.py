"""Liveness heuristic per face track. Pure (numpy only), CPU-cheap, HONESTLY LIMITED.

This is not anti-spoofing. With an RGB webcam, 5 landmarks and ~10 processed frames per
second, it can only collect weak evidence:

LIVE (latched for the life of the track) needs positive evidence of a living face:
  - a blink: the eye regions briefly brighten (lids cover the dark iris) and recover; or
  - head movement: yaw/pitch range over the window above ``pose_range_deg`` — well above
    the pose jitter caused by landmark noise.
SUSPECT on a spoof cue:
  - frozen face: the face crop stays nearly identical (below camera sensor noise); or
  - screen texture (opt-in, ``moire_enabled``): strong isolated peaks in the face crop's spectrum.
    Off by default: in the 2026-10-16 live check it flagged a real face on the webcam within
    0.8 s (compression patterns), which blocked the owner.
UNKNOWN until there is enough evidence either way.

It stops a photo on a stand and frozen or still images. It does NOT reliably stop a
hand-held photo that is tilted, a replayed video, or a mask. See docs/SECURITY.md.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

import numpy as np

LIVE = "LIVE"
SUSPECT = "SUSPECT"
UNKNOWN = "UNKNOWN"


@dataclass(frozen=True)
class LivenessConfig:
    window: float = 3.0            # seconds of history considered
    pose_range_deg: float = 6.0    # yaw or pitch range that counts as real movement
    blink_rise: float = 0.18       # eye brightness rise vs. baseline that counts as closed
    blink_max_s: float = 0.6       # a blink must recover within this time
    frozen_diff: float = 0.35      # mean abs diff (0–255) of 32×32 face crops below = frozen
    frozen_s: float = 2.0
    moire_enabled: bool = False    # opt-in: false positives on real webcams (see module docstring)
    moire_ratio: float = 14.0      # spectral peak / median in the mid-high band
    moire_share: float = 0.6       # share of recent samples that must show the peak

    @classmethod
    def from_dict(cls, raw: dict | None) -> "LivenessConfig":
        names = {"poseRangeDeg": "pose_range_deg", "blinkRise": "blink_rise", "frozenDiff": "frozen_diff",
                 "frozenSeconds": "frozen_s", "moireRatio": "moire_ratio"}
        values = {}
        for key, attr in names.items():
            try:
                if raw and key in raw:
                    values[attr] = float(raw[key])
            except (TypeError, ValueError):
                pass
        if raw and isinstance(raw.get("moireEnabled"), bool):
            values["moire_enabled"] = raw["moireEnabled"]
        return cls(**values)


@dataclass
class LivenessSample:
    t: float
    yaw: float
    pitch: float
    crop: np.ndarray | None = None   # grayscale face crop (any size; resized to 32×32 / 64×64 here)
    eye_level: float | None = None   # mean brightness of both eye regions
    face_level: float | None = None  # mean brightness of the face crop


def moire_score(crop: np.ndarray) -> float:
    """Peak-to-median ratio of the spectrum in the mid/high band (screens show isolated peaks)."""
    g = _resize(crop, 64).astype(np.float32)
    g -= g.mean()
    win = np.outer(np.hanning(64), np.hanning(64)).astype(np.float32)
    spec = np.abs(np.fft.fftshift(np.fft.fft2(g * win)))
    yy, xx = np.mgrid[-32:32, -32:32]
    radius = np.hypot(yy, xx)
    band = spec[(radius >= 10) & (radius <= 30)]
    median = float(np.median(band)) or 1e-6
    return float(band.max() / median)


def _resize(img: np.ndarray, size: int) -> np.ndarray:
    """Nearest-neighbour resize (numpy only) for small crops."""
    img = np.asarray(img)
    if img.ndim == 3:
        img = img.mean(axis=2)
    h, w = img.shape[:2]
    ys = (np.arange(size) * h / size).astype(int)
    xs = (np.arange(size) * w / size).astype(int)
    return img[ys][:, xs]


@dataclass
class LivenessTracker:
    config: LivenessConfig = field(default_factory=LivenessConfig)
    samples: deque = field(default_factory=lambda: deque(maxlen=64))
    latched_live: bool = False
    reasons: list = field(default_factory=list)
    _frozen_since: float | None = None
    _blink_start: float | None = None
    _await_open: bool = False  # after an over-long closure the eyes must reopen first

    def update(self, s: LivenessSample) -> str:
        c = self.config
        prev = self.samples[-1] if self.samples else None
        self.samples.append(s)
        while self.samples and s.t - self.samples[0].t > c.window:
            self.samples.popleft()

        # --- spoof cues ----------------------------------------------------
        if s.crop is not None and prev is not None and prev.crop is not None:
            diff = float(np.abs(_resize(s.crop, 32).astype(np.float32) - _resize(prev.crop, 32).astype(np.float32)).mean())
            if diff < c.frozen_diff:
                self._frozen_since = self._frozen_since if self._frozen_since is not None else prev.t
            else:
                self._frozen_since = None
        if self._frozen_since is not None and s.t - self._frozen_since >= c.frozen_s:
            self.latched_live = False
            self.reasons = ["frozen-face"]
            return SUSPECT

        crops = [x.crop for x in self.samples if x.crop is not None] if c.moire_enabled else []
        if len(crops) >= 5:
            recent = crops[-8:]
            share = sum(moire_score(cr) >= c.moire_ratio for cr in recent) / len(recent)
            if share >= c.moire_share:
                self.latched_live = False
                self.reasons = ["screen-texture"]
                return SUSPECT

        # --- evidence of life ---------------------------------------------
        if self.latched_live:
            return LIVE
        yaws = [x.yaw for x in self.samples]
        pitches = [x.pitch for x in self.samples]
        if max(yaws) - min(yaws) >= c.pose_range_deg or max(pitches) - min(pitches) >= c.pose_range_deg:
            return self._live("head-movement")
        if self._blink(s):
            return self._live("blink")
        self.reasons = []
        return UNKNOWN

    def _live(self, reason: str) -> str:
        self.latched_live = True
        self.reasons = [reason]
        return LIVE

    def _blink(self, s: LivenessSample) -> bool:
        """Eyes brighten relative to the face (lids closed) and recover within blink_max_s."""
        rel = [(x.t, x.eye_level / max(x.face_level, 1.0)) for x in self.samples
               if x.eye_level is not None and x.face_level is not None]
        if len(rel) < 4:
            return False
        baseline = float(np.median([r for _, r in rel]))
        t, current = rel[-1]
        closed = current >= baseline * (1.0 + self.config.blink_rise)
        if self._await_open:
            if not closed:
                self._await_open = False
            return False
        if closed and self._blink_start is None:
            self._blink_start = t
            return False
        if not closed and self._blink_start is not None:
            duration = t - self._blink_start
            self._blink_start = None
            return duration <= self.config.blink_max_s
        if self._blink_start is not None and t - self._blink_start > self.config.blink_max_s:
            self._blink_start = None  # eyes closed too long: not a blink
            self._await_open = True
        return False
