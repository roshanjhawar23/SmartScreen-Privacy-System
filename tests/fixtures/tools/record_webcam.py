"""Record a private webcam fixture into tests/fixtures/private/ (gitignored).

    python tests/fixtures/tools/record_webcam.py owner --seconds 15
    python tests/fixtures/tools/record_webcam.py owner_away --seconds 10

A preview window shows a countdown, then recording starts. Press Esc to abort.
Only record people who have consented.
"""

import argparse
import time

import cv2

from fixture_io import FPS, SIZE, private_path, write_video


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("name", help="fixture name, e.g. owner, owner_away, empty")
    parser.add_argument("--seconds", type=float, default=15.0)
    parser.add_argument("--countdown", type=float, default=3.0)
    parser.add_argument("--camera", type=int, default=0)
    args = parser.parse_args()

    camera = cv2.VideoCapture(args.camera, cv2.CAP_DSHOW)
    camera.set(cv2.CAP_PROP_FRAME_WIDTH, SIZE[0])
    camera.set(cv2.CAP_PROP_FRAME_HEIGHT, SIZE[1])
    if not camera.isOpened():
        raise SystemExit("No camera")

    frames, start, recording = [], time.monotonic(), False
    try:
        while True:
            ok, frame = camera.read()
            if not ok:
                raise SystemExit("Camera stopped delivering frames")
            frame = cv2.resize(frame, SIZE)
            elapsed = time.monotonic() - start
            preview = frame.copy()
            if elapsed < args.countdown:
                label = f"Recording in {args.countdown - elapsed:.0f}s"
            else:
                if not recording:
                    recording, rec_start = True, time.monotonic()
                frames.append((time.monotonic() - rec_start, frame))
                left = args.seconds - (time.monotonic() - rec_start)
                label = f"REC {left:.0f}s"
                if left <= 0:
                    break
            cv2.putText(preview, label, (16, 36), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 255), 2)
            cv2.imshow("SmartScreen fixture recorder", preview)
            if cv2.waitKey(1) == 27:
                raise SystemExit("Aborted")
    finally:
        camera.release()
        cv2.destroyAllWindows()

    # Re-time to a constant FPS so playback speed matches real time.
    out, i = [], 0
    for n in range(int(args.seconds * FPS)):
        t = n / FPS
        while i + 1 < len(frames) and frames[i + 1][0] <= t:
            i += 1
        out.append(frames[i][1])
    write_video(private_path(f"{args.name}.mp4"), out)


if __name__ == "__main__":
    main()
