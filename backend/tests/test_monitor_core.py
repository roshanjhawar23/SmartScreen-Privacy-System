import io
import os
import threading

from monitor_core import (
    CameraHealth,
    Emitter,
    FrameObservation,
    ImageHealth,
    LoopHeartbeat,
    StateTracker,
    default_log_dir,
)

OWNER = FrameObservation(owners=1, best_owner_score=0.71)
UNKNOWN = FrameObservation(unknown=1, best_unknown_score=0.12)
GROUP = FrameObservation(unknown=2, best_unknown_score=0.2)
MIXED = FrameObservation(owners=1, unknown=1, best_owner_score=0.6, best_unknown_score=0.1)
EMPTY = FrameObservation()


def feed(tracker, observations, start=0.0, step=0.1):
    events = []
    t = start
    for obs in observations:
        t += step
        event = tracker.update(t, obs)
        if event:
            events.append(event)
    return events


def test_owner_requires_confirm_frames():
    tracker = StateTracker(confirm_frames=3)
    assert tracker.update(0.1, OWNER) is None
    assert tracker.update(0.2, OWNER) is None
    event = tracker.update(0.3, OWNER)
    assert event.state == "OWNER_PRESENT"
    assert event.message.startswith("STATE|OWNER_PRESENT|faces=1|owners=1|unknown=0")
    assert "ownerScore=0.7100" in event.message
    assert not event.snapshot


def test_only_changes_are_emitted():
    events = feed(StateTracker(confirm_frames=2), [OWNER] * 10)
    assert [e.state for e in events] == ["OWNER_PRESENT"]


def test_unknown_resets_owner_streak():
    assert feed(StateTracker(confirm_frames=3), [OWNER, OWNER, UNKNOWN, OWNER, OWNER]) == []


def test_unknown_person_group_and_mixed_states():
    assert feed(StateTracker(confirm_frames=2), [UNKNOWN] * 2)[0].state == "UNKNOWN_PERSON"
    assert feed(StateTracker(confirm_frames=2), [GROUP] * 2)[0].state == "UNKNOWN_GROUP"
    assert feed(StateTracker(confirm_frames=2), [MIXED] * 2)[0].state == "OWNER_AND_UNKNOWN"


def test_snapshot_once_per_threat_entry():
    events = feed(StateTracker(confirm_frames=1), [UNKNOWN, UNKNOWN, OWNER, UNKNOWN])
    assert [(e.state, e.snapshot) for e in events] == [
        ("UNKNOWN_PERSON", True),
        ("OWNER_PRESENT", False),
        ("UNKNOWN_PERSON", True),
    ]


def test_no_user_waits_for_delay_and_is_emitted_once():
    tracker = StateTracker(confirm_frames=1, no_user_delay=1.0, start_time=0.0)
    assert tracker.update(0.1, OWNER).state == "OWNER_PRESENT"
    assert tracker.update(0.5, EMPTY) is None
    assert tracker.update(1.0, EMPTY) is None
    event = tracker.update(1.2, EMPTY)
    assert event.state == "NO_USER"
    assert event.message == "STATE|NO_USER|faces=0|owners=0|unknown=0|best=0.0000"
    assert tracker.update(2.0, EMPTY) is None


def test_no_user_flicker_is_absorbed():
    tracker = StateTracker(confirm_frames=1, no_user_delay=1.0)
    tracker.update(0.1, OWNER)
    assert tracker.update(0.6, EMPTY) is None
    assert tracker.update(0.7, OWNER) is None  # same state, nothing new
    assert tracker.update(1.5, EMPTY) is None  # presence refreshed at 0.7


def test_camera_health_reports_once_after_timeout():
    health = CameraHealth(failure_timeout=3.0)
    assert health.frame_failed(10.0) is False
    assert health.frame_failed(12.9) is False
    assert health.frame_failed(13.0) is True
    assert health.frame_failed(20.0) is False


def test_camera_health_recovers_on_good_frame():
    health = CameraHealth(failure_timeout=3.0)
    health.frame_failed(0.0)
    health.frame_ok()
    assert health.frame_failed(2.9) is False
    assert health.frame_failed(5.0) is False
    assert health.frame_failed(5.9) is True


def test_heartbeat_stops_when_loop_stalls():
    hb = LoopHeartbeat(stall_timeout=5.0, now=0.0)
    assert hb.should_beat(4.0)
    assert not hb.should_beat(5.5)
    hb.tick(6.0)
    assert hb.should_beat(7.0)


def test_emitter_writes_whole_lines_under_concurrency():
    stream = io.StringIO()
    emit = Emitter(stream)

    def writer(tag):
        for _ in range(500):
            emit(f"{tag}|" + "x" * 50)

    threads = [threading.Thread(target=writer, args=(t,)) for t in ("STATE", "AI_HEARTBEAT")]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    lines = stream.getvalue().splitlines()
    assert len(lines) == 1000
    assert all(line.endswith("x" * 50) and line.count("|") == 1 for line in lines)


def test_emitter_strips_embedded_newlines():
    stream = io.StringIO()
    Emitter(stream)("AI_ERROR|bad\nSTATE|OWNER_PRESENT")
    assert stream.getvalue() == "AI_ERROR|bad STATE|OWNER_PRESENT\n"


def test_default_log_dir_is_outside_repo():
    repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    assert not os.path.abspath(default_log_dir()).lower().startswith(repo.lower())


# --- ImageHealth: frames arrive but carry no real image -------------------

def test_image_health_live_noise_is_ok():
    health = ImageHealth(failure_timeout=3.0)
    for i in range(100):
        assert health.check(i * 0.1, mean=95.0, std=30.0, signature=bytes([i % 256])) is None


def test_image_health_frozen_frames_fail_once_after_timeout():
    health = ImageHealth(failure_timeout=3.0)
    assert health.check(0.0, 120.0, 40.0, b"same") is None
    assert health.check(0.1, 120.0, 40.0, b"same") is None  # frozen since 0.1
    assert health.check(3.0, 120.0, 40.0, b"same") is None
    assert health.check(3.1, 120.0, 40.0, b"same") == "frozen"
    assert health.check(4.0, 120.0, 40.0, b"same") is None  # reported once


def test_image_health_dark_uniform_frames_fail():
    health = ImageHealth(failure_timeout=3.0)
    results = [health.check(i * 0.5, mean=2.0, std=1.0, signature=bytes([i])) for i in range(8)]
    assert results[:6] == [None] * 6
    assert results[6] == "dark"


def test_image_health_recovers_before_timeout():
    health = ImageHealth(failure_timeout=3.0)
    health.check(0.0, 2.0, 1.0, b"a")
    health.check(2.0, 2.0, 1.0, b"b")
    assert health.check(2.5, 90.0, 25.0, b"c") is None  # real image again: timer reset
    assert health.check(4.0, 2.0, 1.0, b"d") is None
    assert health.check(6.9, 2.0, 1.0, b"e") is None
    assert health.check(7.0, 2.0, 1.0, b"f") == "dark"


def test_image_health_dark_but_textured_scene_is_ok():
    health = ImageHealth(failure_timeout=1.0)
    for i in range(50):
        assert health.check(i * 0.1, mean=8.0, std=9.0, signature=bytes([i])) is None
