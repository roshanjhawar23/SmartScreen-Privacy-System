"""Face tracker with stable IDs, identity smoothing, liveness and exposure timing. Pure (numpy).

Matching: greedy intersection-over-union between existing tracks and the frame's detections.
Unmatched detections are re-identified against tracks lost within ``reid_window`` seconds by
SFace embedding similarity, so a person who briefly leaves the frame keeps their ID.

Identity: a track is the owner when the *median* of its last ``history`` owner similarities is
at or above the threshold, so owner/unknown does not flicker per frame. Without similarity
data the detection's own role is used.

Exposure per track, in milliseconds: ``present_ms`` since the track appeared; ``facing_ms``
continuous FACING_SCREEN; ``looking_ms`` continuous FACING_SCREEN or GLANCING.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from statistics import median

import numpy as np

from head_pose import AWAY, FACING_SCREEN, GLANCING
from liveness import UNKNOWN as LIVENESS_UNKNOWN
from liveness import LivenessConfig, LivenessSample, LivenessTracker

OWNER = "owner"
UNKNOWN = "unknown"
LIVENESS_CODES = {"LIVE": "L", "SUSPECT": "S", "UNKNOWN": "U"}


@dataclass
class Detection:
    box: tuple[float, float, float, float]  # x, y, w, h
    role: str = UNKNOWN
    facing: str = AWAY
    yaw: float = 0.0
    pitch: float = 0.0
    similarity: float | None = None          # cosine similarity to the owner template
    embedding: np.ndarray | None = None      # normalized SFace feature
    size: float = 0.0                        # face width / frame width (distance proxy)
    liveness: LivenessSample | None = None


@dataclass
class TrackView:
    id: int
    role: str
    facing: str
    yaw: float
    pitch: float
    present_ms: int
    facing_ms: int
    looking_ms: int
    liveness: str = LIVENESS_UNKNOWN
    size: float = 0.0
    score: float = -1.0  # median owner similarity (not encoded)

    def encode(self) -> str:
        role = "O" if self.role == OWNER else "U"
        return (f"{self.id}:{role}:{self.facing}:{self.yaw:.1f}:{self.pitch:.1f}"
                f":{self.present_ms}:{self.facing_ms}:{self.looking_ms}"
                f":{LIVENESS_CODES.get(self.liveness, 'U')}:{self.size:.3f}")


@dataclass
class _Track:
    id: int
    box: tuple[float, float, float, float]
    detection: Detection
    first_seen: float
    last_seen: float
    similarities: deque = field(default_factory=lambda: deque(maxlen=5))
    embedding: np.ndarray | None = None
    liveness: LivenessTracker | None = None
    liveness_state: str = LIVENESS_UNKNOWN
    facing_since: float | None = None
    looking_since: float | None = None
    lost_at: float | None = None
    role: str | None = None          # last reported role
    role_since: float | None = None  # when it last changed


def iou(a, b) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix = max(0.0, min(ax + aw, bx + bw) - max(ax, bx))
    iy = max(0.0, min(ay + ah, by + bh) - max(ay, by))
    inter = ix * iy
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


@dataclass
class FaceTracker:
    iou_threshold: float = 0.3
    max_age: float = 0.6
    owner_threshold: float = 0.363
    reid_window: float = 2.0
    reid_similarity: float = 0.5
    liveness_config: LivenessConfig = field(default_factory=LivenessConfig)
    _tracks: list[_Track] = field(default_factory=list)
    _lost: list[_Track] = field(default_factory=list)
    _next_id: int = 1
    _liveness_changes: list = field(default_factory=list)

    def pop_liveness_changes(self) -> list[tuple[int, str, str]]:
        """(track id, new state, reason) for every liveness change since the last call."""
        changes, self._liveness_changes = self._liveness_changes, []
        return changes

    def update(self, now: float, detections: list[Detection]) -> list[TrackView]:
        pairs = sorted(
            ((iou(t.box, d.box), ti, di) for ti, t in enumerate(self._tracks) for di, d in enumerate(detections)),
            reverse=True,
        )
        matched_tracks, assignment = set(), {}
        for score, ti, di in pairs:
            if score < self.iou_threshold:
                break
            if ti in matched_tracks or di in assignment:
                continue
            matched_tracks.add(ti)
            assignment[di] = self._tracks[ti]

        self._lost = [t for t in self._lost if now - t.lost_at <= self.reid_window]
        for di, det in enumerate(detections):
            track = assignment.get(di) or self._reidentify(det) or self._new_track(det, now)
            self._observe(track, det, now)

        for t in self._tracks:
            if now - t.last_seen > self.max_age:
                t.lost_at = now
                self._lost.append(t)
        self._tracks = [t for t in self._tracks if now - t.last_seen <= self.max_age]
        return [self._view(t, now) for t in self._tracks if t.last_seen == now]

    def _new_track(self, det: Detection, now: float) -> _Track:
        track = _Track(self._next_id, det.box, det, now, now, liveness=LivenessTracker(self.liveness_config))
        self._next_id += 1
        self._tracks.append(track)
        return track

    def _reidentify(self, det: Detection) -> _Track | None:
        if det.embedding is None:
            return None
        best, best_sim = None, self.reid_similarity
        for t in self._lost:
            if t.embedding is None:
                continue
            sim = float(np.dot(t.embedding, det.embedding))
            if sim >= best_sim:
                best, best_sim = t, sim
        if best is None:
            return None
        self._lost.remove(best)
        best.lost_at = None
        self._tracks.append(best)
        return best

    def _observe(self, track: _Track, det: Detection, now: float) -> None:
        track.box, track.detection, track.last_seen = det.box, det, now
        if det.similarity is not None:
            track.similarities.append(det.similarity)
        if det.embedding is not None:
            track.embedding = det.embedding
        if det.liveness is not None and track.liveness is not None:
            previous = track.liveness_state
            track.liveness_state = track.liveness.update(det.liveness)
            if track.liveness_state != previous:
                reason = ",".join(track.liveness.reasons) or "insufficient-evidence"
                self._liveness_changes.append((track.id, track.liveness_state, reason))
        facing = det.facing == FACING_SCREEN
        looking = det.facing in (FACING_SCREEN, GLANCING)
        track.facing_since = (track.facing_since if track.facing_since is not None else now) if facing else None
        track.looking_since = (track.looking_since if track.looking_since is not None else now) if looking else None

    def _role(self, t: _Track) -> tuple[str, float]:
        if not t.similarities:
            return t.detection.role, -1.0
        score = float(median(t.similarities))
        return (OWNER if score >= self.owner_threshold else UNKNOWN), score

    def _view(self, t: _Track, now: float) -> TrackView:
        d = t.detection
        role, score = self._role(t)
        if role != t.role:
            t.role, t.role_since = role, now
        # Exposure counts from the later of "started facing" and "became this role": a face
        # re-classified from owner to unknown starts its threat timeline now, not when the
        # (same) track first appeared. Live check 2026-10-16: 85 s carried over → instant lock.
        start = lambda since: None if since is None else max(since, t.role_since)  # noqa: E731
        ms = lambda since: int(round((now - since) * 1000)) if since is not None else 0  # noqa: E731
        return TrackView(t.id, role, d.facing, d.yaw, d.pitch, ms(start(t.first_seen)), ms(start(t.facing_since)),
                         ms(start(t.looking_since)), t.liveness_state, d.size, score)


def primary_track(views: list[TrackView]) -> TrackView | None:
    """The track that matters most for privacy: the most attentive unknown, else the owner."""
    unknown = [v for v in views if v.role != OWNER]
    pool = unknown or views
    if not pool:
        return None
    return max(pool, key=lambda v: (v.looking_ms, v.facing_ms, v.present_ms))
