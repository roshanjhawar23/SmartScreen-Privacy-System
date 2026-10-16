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
    v = TrackView(3, UNKNOWN, GLANCING, -12.34, 5.0, 2100, 0, 1500)
    assert v.encode() == "3:U:GLANCING:-12.3:5.0:2100:0:1500"
    assert TrackView(1, OWNER, FACING_SCREEN, 0, 0, 10, 10, 10).encode().startswith("1:O:")


def test_primary_track_prefers_attentive_unknown():
    owner = TrackView(1, OWNER, FACING_SCREEN, 0, 0, 9000, 9000, 9000)
    passer = TrackView(2, UNKNOWN, AWAY, 60, 0, 3000, 0, 0)
    watcher = TrackView(3, UNKNOWN, FACING_SCREEN, 5, 0, 2000, 1500, 1500)
    assert primary_track([owner, passer, watcher]).id == 3
    assert primary_track([owner]).id == 1
    assert primary_track([]) is None
