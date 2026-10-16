from face_tracker import OWNER, UNKNOWN, Detection, FaceTracker, TrackView, iou, primary_track
from head_pose import AWAY, FACING_SCREEN, GLANCING


def det(x, role=UNKNOWN, facing=FACING_SCREEN, y=100, size=100):
    return Detection((x, y, size, size), role, facing, yaw=1.5, pitch=-2.0)


def test_iou():
    assert iou((0, 0, 10, 10), (0, 0, 10, 10)) == 1.0
    assert iou((0, 0, 10, 10), (20, 20, 5, 5)) == 0.0
    assert round(iou((0, 0, 10, 10), (5, 0, 10, 10)), 3) == round(50 / 150, 3)


def test_stable_ids_while_moving_slowly():
    t = FaceTracker()
    ids = [t.update(i * 0.1, [det(100 + i * 5)])[0].id for i in range(20)]
    assert set(ids) == {1}


def test_two_people_keep_their_ids():
    t = FaceTracker()
    for i in range(10):
        views = t.update(i * 0.1, [det(400 - i * 2, OWNER), det(50 + i * 2)])
    roles = {v.id: v.role for v in views}
    assert roles == {1: OWNER, 2: UNKNOWN}


def test_new_id_after_track_is_lost():
    t = FaceTracker(max_age=0.5)
    assert t.update(0.0, [det(100)])[0].id == 1
    t.update(0.3, [])
    assert t.update(0.4, [det(100)])[0].id == 1  # within max_age
    t.update(0.5, [])
    t.update(1.2, [])
    assert t.update(1.3, [det(100)])[0].id == 2


def test_exposure_timing():
    t = FaceTracker()
    seq = [FACING_SCREEN] * 5 + [GLANCING] * 3 + [AWAY] * 2 + [FACING_SCREEN] * 2
    views = []
    for i, facing in enumerate(seq):
        views.append(t.update(i * 0.5, [det(100, facing=facing)])[0])
    assert views[4].facing_ms == 2000 and views[4].looking_ms == 2000
    assert views[7].facing_ms == 0 and views[7].looking_ms == 3500  # glancing continues "looking"
    assert views[9].looking_ms == 0  # away resets
    assert views[11].facing_ms == 500
    assert views[11].present_ms == 5500


def test_encoding():
    v = TrackView(3, UNKNOWN, GLANCING, -12.34, 5.0, 2100, 0, 1500, "SUSPECT", 0.21)
    assert v.encode() == "3:U:GLANCING:-12.3:5.0:2100:0:1500:S:0.210"
    assert TrackView(1, OWNER, FACING_SCREEN, 0, 0, 10, 10, 10).encode().startswith("1:O:")


def test_primary_track_prefers_attentive_unknown():
    owner = TrackView(1, OWNER, FACING_SCREEN, 0, 0, 9000, 9000, 9000)
    passer = TrackView(2, UNKNOWN, AWAY, 60, 0, 3000, 0, 0)
    watcher = TrackView(3, UNKNOWN, FACING_SCREEN, 5, 0, 2000, 1500, 1500)
    assert primary_track([owner, passer, watcher]).id == 3
    assert primary_track([owner]).id == 1
    assert primary_track([]) is None


# --- Phase 3: identity smoothing, re-identification, liveness ------------------

import numpy as np  # noqa: E402

from liveness import LivenessSample  # noqa: E402


def unit(seed):
    v = np.random.default_rng(seed).normal(size=128)
    return v / np.linalg.norm(v)


def det_sim(x, sim, emb=None):
    return Detection((x, 100, 100, 100), UNKNOWN, FACING_SCREEN, similarity=sim, embedding=emb, size=0.15)


def test_identity_is_smoothed_by_median():
    t = FaceTracker(owner_threshold=0.363)
    sims = [0.6, 0.62, 0.1, 0.61, 0.59, 0.15, 0.6]  # occasional bad frames
    roles = [t.update(i * 0.1, [det_sim(100, s)])[0].role for i, s in enumerate(sims)]
    assert roles == [OWNER] * len(sims)


def test_impostor_with_one_lucky_frame_stays_unknown():
    t = FaceTracker(owner_threshold=0.363)
    sims = [0.1, 0.12, 0.4, 0.11, 0.13]
    roles = [t.update(i * 0.1, [det_sim(100, s)])[0].role for i, s in enumerate(sims)]
    assert OWNER not in roles


def test_track_score_is_the_median():
    t = FaceTracker()
    for i, s in enumerate([0.5, 0.7, 0.6]):
        view = t.update(i * 0.1, [det_sim(100, s)])[0]
    assert view.score == 0.6


def test_reidentification_after_a_short_gap():
    t = FaceTracker(max_age=0.3, reid_window=2.0)
    alice = unit(1)
    assert t.update(0.0, [det_sim(100, 0.6, alice)])[0].id == 1
    t.update(0.5, [])  # lost
    view = t.update(1.2, [det_sim(400, 0.6, alice)])[0]  # far away box: IoU 0, same embedding
    assert view.id == 1
    assert view.present_ms == 1200


def test_no_reidentification_for_a_different_person_or_after_the_window():
    t = FaceTracker(max_age=0.3, reid_window=1.0)
    t.update(0.0, [det_sim(100, 0.6, unit(1))])
    t.update(0.5, [])
    assert t.update(0.8, [det_sim(400, 0.1, unit(2))])[0].id == 2
    t.update(1.2, [])
    t.update(3.0, [])
    assert t.update(3.1, [det_sim(100, 0.6, unit(1))])[0].id == 3


def test_liveness_is_tracked_per_face():
    t = FaceTracker()
    for i in range(20):
        d = det_sim(100, 0.6)
        d.liveness = LivenessSample(i * 0.1, 6 * np.sin(i), 0.0)
        view = t.update(i * 0.1, [d])[0]
    assert view.liveness == "LIVE"
    assert view.encode().endswith(":L:0.150")
