"""Pure, camera-free logic for the SmartScreen identity monitor.

Everything here is deterministic and takes time as an argument so it can be
unit-tested without OpenCV, a webcam or real sleeps.
"""

from __future__ import annotations

import os
import sys
import threading
from dataclasses import dataclass, field

from face_tracker import OWNER, primary_track

THREAT_STATES = ("UNKNOWN_PERSON", "UNKNOWN_GROUP", "OWNER_AND_UNKNOWN")


class Emitter:
    """Thread-safe line writer.

    ``print(msg, flush=True)`` performs two writes (text, newline); with the
    heartbeat thread and the vision loop printing concurrently, lines could
    interleave and corrupt the protocol. One locked write per line prevents it.
    """

    def __init__(self, stream=None):
        self._stream = stream if stream is not None else sys.stdout
        self._lock = threading.Lock()

    def __call__(self, message: str) -> None:
        line = str(message).replace("\r", " ").replace("\n", " ") + "\n"
        with self._lock:
            self._stream.write(line)
            self._stream.flush()


@dataclass
class FrameObservation:
    """Recognition result for one processed frame (faces that passed quality gates)."""

    owners: int = 0
    unknown: int = 0
    best_owner_score: float = -1.0
    best_unknown_score: float = -1.0
    detections: list = field(default_factory=list)  # face_tracker.Detection per face
    tracks: list = field(default_factory=list)      # face_tracker.TrackView per face

    @property
    def faces(self) -> int:
        return self.owners + self.unknown


def pose_fields(tracks) -> str:
    """STATE suffix: pose of the most attentive unknown (else owner) plus every track."""
    primary = primary_track(tracks)
    if primary is None:
        return ""
    encoded = ",".join(t.encode() for t in tracks)
    return f"|facing={primary.facing}|yaw={primary.yaw:.1f}|pitch={primary.pitch:.1f}|tracks={encoded}"


def apply_track_identity(obs: FrameObservation) -> FrameObservation:
    """Owner/unknown counts and best scores from smoothed track identities (Phase 3).

    Tracks only carry a score when recognition similarities were recorded; without them the
    per-frame counts are kept as they are.
    """
    if not obs.tracks or any(t.score < 0 for t in obs.tracks):
        return obs
    owners = [t for t in obs.tracks if t.role == OWNER]
    unknown = [t for t in obs.tracks if t.role != OWNER]
    obs.owners, obs.unknown = len(owners), len(unknown)
    obs.best_owner_score = max((t.score for t in owners), default=-1.0)
    obs.best_unknown_score = max((t.score for t in unknown), default=-1.0)
    return obs


class StatsAccumulator:
    """Local performance counters, emitted as one STATS line per interval (nothing leaves the device)."""

    def __init__(self, interval: float = 10.0, now: float = 0.0, cpu_now: float = 0.0):
        self.interval = float(interval)
        self._reset(now, cpu_now)

    def _reset(self, now: float, cpu_now: float) -> None:
        self.start, self.cpu_start = now, cpu_now
        self.frames, self.recognition_ms = 0, []

    def frame(self) -> None:
        self.frames += 1

    def processed(self, recognition_ms: float) -> None:
        self.recognition_ms.append(float(recognition_ms))

    def poll(self, now: float, cpu_now: float) -> str | None:
        elapsed = now - self.start
        if elapsed < self.interval or elapsed <= 0:
            return None
        rec = sorted(self.recognition_ms)
        avg = sum(rec) / len(rec) if rec else 0.0
        p95 = rec[min(len(rec) - 1, int(0.95 * len(rec)))] if rec else 0.0
        cpu = 100.0 * (cpu_now - self.cpu_start) / elapsed
        line = (f"STATS|fps={self.frames / elapsed:.1f}|processedFps={len(rec) / elapsed:.1f}"
                f"|recognitionMs={avg:.1f}|recognitionP95Ms={p95:.1f}|cpu={cpu:.1f}")
        self._reset(now, cpu_now)
        return line


@dataclass
class StateEvent:
    state: str
    message: str
    snapshot: bool = False


@dataclass
class StateTracker:
    """Debounces per-frame observations into stable identity states.

    Behaviour matches the original loop in face_detection.main():
    - a face state must be seen for ``confirm_frames`` processed frames;
    - NO_USER is reported once nobody valid has been seen for
      ``no_user_delay`` seconds;
    - state *changes* are emitted; with ``update_interval`` > 0 the current face
      state is also re-emitted at most every ``update_interval`` seconds while it
      stays stable (the Presence Gate counts these owner updates);
    - a snapshot is requested once per entry into a threat state.
    """

    confirm_frames: int = 5
    no_user_delay: float = 1.5
    start_time: float = 0.0
    update_interval: float = 0.0
    last_emit_time: float = field(default=0.0)
    owner_streak: int = 0
    unknown_streak: int = 0
    last_state: str | None = None
    snapshot_state: str | None = None
    last_presence_time: float = field(default=0.0)

    def __post_init__(self) -> None:
        self.confirm_frames = max(1, int(self.confirm_frames))
        self.no_user_delay = max(0.0, float(self.no_user_delay))
        self.last_presence_time = float(self.start_time)

    def _no_user(self, now: float) -> StateEvent | None:
        self.owner_streak = 0
        self.unknown_streak = 0
        if now - self.last_presence_time >= self.no_user_delay and self.last_state != "NO_USER":
            self.last_state = "NO_USER"
            self.snapshot_state = None
            return StateEvent("NO_USER", "STATE|NO_USER|faces=0|owners=0|unknown=0|best=0.0000")
        return None

    def update(self, now: float, obs: FrameObservation) -> StateEvent | None:
        if obs.faces == 0:
            return self._no_user(now)

        self.last_presence_time = now

        if obs.unknown > 0 and obs.owners > 0:
            candidate = "OWNER_AND_UNKNOWN"
            self.owner_streak += 1
            self.unknown_streak += 1
        elif obs.unknown > 0:
            candidate = "UNKNOWN_GROUP" if obs.unknown > 1 else "UNKNOWN_PERSON"
            self.unknown_streak += 1
            self.owner_streak = 0
        else:
            candidate = "OWNER_PRESENT"
            self.owner_streak += 1
            self.unknown_streak = 0

        streak = self.owner_streak if candidate == "OWNER_PRESENT" else self.unknown_streak
        if streak < self.confirm_frames:
            return None

        best = obs.best_owner_score if obs.owners > 0 else obs.best_unknown_score
        message = (
            f"STATE|{candidate}|faces={obs.faces}|owners={obs.owners}|unknown={obs.unknown}"
            f"|best={best:.4f}|ownerScore={max(obs.best_owner_score, 0.0):.4f}"
        ) + pose_fields(obs.tracks)

        if candidate == self.last_state:
            if self.update_interval <= 0 or now - self.last_emit_time < self.update_interval:
                return None
            self.last_emit_time = now
            return StateEvent(candidate, message, False)  # periodic update, never a new snapshot

        self.last_state = candidate
        self.last_emit_time = now

        snapshot = False
        if candidate in THREAT_STATES:
            if self.snapshot_state != candidate:
                snapshot = True
                self.snapshot_state = candidate
        else:
            self.snapshot_state = None

        return StateEvent(candidate, message, snapshot)


@dataclass
class CameraHealth:
    """Detects a camera that is open but no longer delivering frames."""

    failure_timeout: float = 3.0
    first_failure_time: float | None = None
    failed: bool = False

    def frame_ok(self) -> None:
        self.first_failure_time = None

    def frame_failed(self, now: float) -> bool:
        """Record a failed read; returns True exactly once when the camera is considered lost."""
        if self.failed:
            return False
        if self.first_failure_time is None:
            self.first_failure_time = now
            return False
        if now - self.first_failure_time >= self.failure_timeout:
            self.failed = True
            return True
        return False


@dataclass
class ImageHealth:
    """Detects a camera that delivers frames, but no real image.

    When Windows revokes camera access (or a driver shows a placeholder), reads keep
    succeeding with black or constant frames, which would otherwise look like an
    empty room. Real sensors always add noise, so:
    - ``frozen``: consecutive frames are byte-identical (on a downsampled view);
    - ``dark``: the image is near-black and uniform (blocked access, covered lens).
    Either condition lasting ``failure_timeout`` seconds is a camera failure.
    """

    failure_timeout: float = 3.0
    dark_mean: float = 10.0
    uniform_std: float = 4.0
    bad_since: float | None = None
    last_signature: bytes | None = None
    failed: bool = False

    def classify(self, mean: float, std: float, signature: bytes) -> str | None:
        frozen = self.last_signature is not None and signature == self.last_signature
        self.last_signature = signature
        if frozen:
            return "frozen"
        if mean < self.dark_mean and std < self.uniform_std:
            return "dark"
        return None

    def check(self, now: float, mean: float, std: float, signature: bytes) -> str | None:
        """Returns the reason exactly once when the image is considered lost."""
        reason = self.classify(mean, std, signature)
        if reason is None:
            self.bad_since = None
            return None
        if self.failed:
            return None
        if self.bad_since is None:
            self.bad_since = now
            return None
        if now - self.bad_since >= self.failure_timeout:
            self.failed = True
            return reason
        return None


class LoopHeartbeat:
    """Heartbeat that is only emitted while the vision loop is making progress.

    The vision loop calls ``tick()``; the heartbeat thread calls ``should_beat()``.
    If the loop hangs (e.g. a blocking camera read), beats stop and the Electron
    watchdog fires.
    """

    def __init__(self, stall_timeout: float, now: float):
        self.stall_timeout = float(stall_timeout)
        self._last_tick = float(now)
        self._lock = threading.Lock()

    def tick(self, now: float) -> None:
        with self._lock:
            self._last_tick = float(now)

    def should_beat(self, now: float) -> bool:
        with self._lock:
            return (now - self._last_tick) <= self.stall_timeout


def default_log_dir() -> str:
    """Per-user fallback directory for intruder snapshots. Never inside the repository."""
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("XDG_STATE_HOME") or os.path.expanduser("~")
    return os.path.join(base, "SmartScreen", "intruder_logs")
