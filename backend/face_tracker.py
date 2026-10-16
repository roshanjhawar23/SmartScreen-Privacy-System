"""Greedy IoU face tracker with stable track IDs and exposure timing. Pure, no OpenCV.

Each processed frame's detections (box, role, pose) are matched to existing tracks by
intersection-over-union. A track keeps its ID while it keeps overlapping; it is dropped
after ``max_age`` seconds without a match. Per track we measure, in milliseconds:
- ``present_ms``: since the track appeared;
- ``facing_ms``: continuous time FACING_SCREEN (0 when not facing);
- ``looking_ms``: continuous time FACING_SCREEN or GLANCING.
Phase 3 extends this with embeddings for identity stability.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from head_pose import AWAY, FACING_SCREEN, GLANCING

OWNER = "owner"
UNKNOWN = "unknown"


@dataclass
class Detection:
    box: tuple[float, float, float, float]  # x, y, w, h
    role: str = UNKNOWN
    facing: str = AWAY
    yaw: float = 0.0
    pitch: float = 0.0


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

    def encode(self) -> str:
        role = "O" if self.role == OWNER else "U"
        return (f"{self.id}:{role}:{self.facing}:{self.yaw:.1f}:{self.pitch:.1f}"
                f":{self.present_ms}:{self.facing_ms}:{self.looking_ms}")


@dataclass
class _Track:
    id: int
    box: tuple[float, float, float, float]
    detection: Detection
    first_seen: float
    last_seen: float
    facing_since: float | None = None
    looking_since: float | None = None


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
    _tracks: list[_Track] = field(default_factory=list)
    _next_id: int = 1

    def update(self, now: float, detections: list[Detection]) -> list[TrackView]:
        pairs = sorted(
            ((iou(t.box, d.box), ti, di) for ti, t in enumerate(self._tracks) for di, d in enumerate(detections)),
            reverse=True,
        )
        matched_tracks, matched_dets = set(), set()
        assignment: dict[int, int] = {}
        for score, ti, di in pairs:
            if score < self.iou_threshold:
                break
            if ti in matched_tracks or di in matched_dets:
                continue
            matched_tracks.add(ti)
            matched_dets.add(di)
            assignment[di] = ti

        for di, det in enumerate(detections):
            if di in assignment:
                track = self._tracks[assignment[di]]
                track.box, track.detection, track.last_seen = det.box, det, now
            else:
                track = _Track(self._next_id, det.box, det, now, now)
                self._next_id += 1
                self._tracks.append(track)
            facing = det.facing == FACING_SCREEN
            looking = det.facing in (FACING_SCREEN, GLANCING)
            track.facing_since = (track.facing_since if track.facing_since is not None else now) if facing else None
            track.looking_since = (track.looking_since if track.looking_since is not None else now) if looking else None

        self._tracks = [t for t in self._tracks if now - t.last_seen <= self.max_age]
        return [self._view(t, now) for t in self._tracks if t.last_seen == now]

    @staticmethod
    def _view(t: _Track, now: float) -> TrackView:
        ms = lambda since: int(round((now - since) * 1000)) if since is not None else 0  # noqa: E731
        d = t.detection
        return TrackView(t.id, d.role, d.facing, d.yaw, d.pitch, ms(t.first_seen), ms(t.facing_since), ms(t.looking_since))


def primary_track(views: list[TrackView]) -> TrackView | None:
    """The track that matters most for privacy: the most attentive unknown, else the owner."""
    unknown = [v for v in views if v.role != OWNER]
    pool = unknown or views
    if not pool:
        return None
    return max(pool, key=lambda v: (v.looking_ms, v.facing_ms, v.present_ms))
