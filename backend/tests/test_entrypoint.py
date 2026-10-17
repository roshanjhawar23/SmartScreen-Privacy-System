import sys
import types

import smartscreen_ai


def _fake(monkeypatch, name, calls):
    module = types.ModuleType(name)
    module.run = lambda: calls.append((name, list(sys.argv)))
    monkeypatch.setitem(sys.modules, name, module)


def test_enroll_mode_strips_the_subcommand(monkeypatch):
    calls = []
    _fake(monkeypatch, "enroll_face", calls)
    _fake(monkeypatch, "face_detection", calls)
    monkeypatch.setattr(sys, "argv", list(sys.argv))
    smartscreen_ai.run(["exe", "enroll", "--detector", "d", "--image", "a.jpg"])
    assert calls == [("enroll_face", ["exe", "--detector", "d", "--image", "a.jpg"])]


def test_default_mode_is_the_monitor(monkeypatch):
    calls = []
    _fake(monkeypatch, "enroll_face", calls)
    _fake(monkeypatch, "face_detection", calls)
    monkeypatch.setattr(sys, "argv", list(sys.argv))
    smartscreen_ai.run(["exe", "--detector", "d", "--recognizer", "r"])
    assert calls == [("face_detection", ["exe", "--detector", "d", "--recognizer", "r"])]
