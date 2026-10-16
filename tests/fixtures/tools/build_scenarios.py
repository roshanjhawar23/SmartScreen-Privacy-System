"""Join private clips into scenario videos under tests/fixtures/private/scenarios/.

    python tests/fixtures/tools/build_scenarios.py

Scenarios needing a missing clip are skipped with a message. Timings assume the
default settings (confirm 5 processed frames, no-user delay 1.5 s, walk-away
lock 6 s, threat lock 5 s): returns happen well before a lock, locks well after.
"""

import os

from fixture_io import SCENARIO_DIR, load_clip, private_path, side_by_side, take, write_video


def clip(name):
    path = private_path(f"{name}.mp4")
    return load_clip(path) if os.path.exists(path) else None


def main():
    owner, empty, unknown, away = clip("owner"), clip("empty"), clip("unknown"), clip("owner_away")

    def both(seconds, start=0.0):
        return [side_by_side(o, u) for o, u in zip(take(owner, seconds, start), take(unknown, seconds))]

    scenarios = {
        # name: (needed clips, builder)
        "empty_only": ((empty,), lambda: take(empty, 16)),
        "owner_then_stop": ((owner,), lambda: take(owner, 10)),
        "walkaway_return": ((owner, empty), lambda: take(owner, 6) + take(empty, 4) + take(owner, 10, start=6)),
        "walkaway_lock": ((owner, empty), lambda: take(owner, 6) + take(empty, 16)),
        "threat_lock": ((owner, unknown), lambda: take(owner, 6) + take(unknown, 12)),
        "threat_recovery": ((owner, unknown), lambda: take(owner, 6) + take(unknown, 2.5) + take(owner, 10, start=6)),
        "owner_and_unknown": ((owner, unknown), lambda: take(owner, 6) + both(10, start=6)),
        "owner_away": ((owner, away), lambda: take(owner, 6) + take(away, 8) + take(owner, 6, start=6)),
    }

    for name, (needs, build) in scenarios.items():
        if any(c is None for c in needs):
            print(f"skip {name}: missing clip")
            continue
        write_video(os.path.join(SCENARIO_DIR, f"{name}.mp4"), build())


if __name__ == "__main__":
    main()
