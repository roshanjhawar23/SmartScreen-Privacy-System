"""Pure, camera-free logic for the SmartScreen identity monitor.

Everything here is deterministic and takes time as an argument so it can be
unit-tested without OpenCV, a webcam or real sleeps.
"""

from __future__ import annotations

import os
import sys
import threading
from dataclasses import dataclass, field

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

    @property
    def faces(self) -> int:
        return self.owners + self.unknown


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
    - only state *changes* are emitted;
    - a snapshot is requested once per entry into a threat state.
    """

    confirm_frames: int = 5
    no_user_delay: float = 1.5
    start_time: float = 0.0
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
        if streak < self.confirm_frames or candidate == self.last_state:
            return None

        best = obs.best_owner_score if obs.owners > 0 else obs.best_unknown_score
        message = (
            f"STATE|{candidate}|faces={obs.faces}|owners={obs.owners}|unknown={obs.unknown}"
            f"|best={best:.4f}|ownerScore={max(obs.best_owner_score, 0.0):.4f}"
        )
        self.last_state = candidate

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
