"""Shared helpers for the self-test fixtures (OpenCV only, no ffmpeg needed)."""

import os

import cv2
import numpy as np

REPO_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
PRIVATE_DIR = os.path.join(REPO_DIR, "tests", "fixtures", "private")
SCENARIO_DIR = os.path.join(PRIVATE_DIR, "scenarios")
MODELS_DIR = os.path.join(REPO_DIR, "models")
SIZE = (640, 480)
FPS = 30.0


def private_path(*parts):
    return os.path.join(PRIVATE_DIR, *parts)


def load_clip(path):
    """Returns (frames resized to SIZE, fps)."""
    capture = cv2.VideoCapture(path)
    if not capture.isOpened():
        raise SystemExit(f"Cannot open {path}")
    fps = capture.get(cv2.CAP_PROP_FPS) or FPS
    frames = []
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        if (frame.shape[1], frame.shape[0]) != SIZE:
            frame = cv2.resize(frame, SIZE, interpolation=cv2.INTER_AREA)
        frames.append(frame)
    capture.release()
    if not frames:
        raise SystemExit(f"No frames in {path}")
    return frames, float(fps)


def take(clip, seconds, start=0.0, out_fps=FPS):
    """Time-resample ``seconds`` of a clip at out_fps, looping if the clip is shorter."""
    frames, fps = clip
    count = int(round(seconds * out_fps))
    return [frames[int((start + i / out_fps) * fps) % len(frames)] for i in range(count)]


def write_video(path, frames, fps=FPS):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), fps, SIZE)
    if not writer.isOpened():
        raise SystemExit(f"Cannot write {path}")
    for frame in frames:
        writer.write(frame)
    writer.release()
    print(f"wrote {os.path.relpath(path, REPO_DIR)} ({len(frames) / fps:.1f}s)")


def side_by_side(left, right):
    """Centre 320px columns of two frames next to each other (faces keep full size)."""
    w, h = SIZE
    x0 = (w - w // 2) // 2
    out = np.empty((h, w, 3), dtype=np.uint8)
    out[:, : w // 2] = left[:, x0 : x0 + w // 2]
    out[:, w // 2 :] = right[:, x0 : x0 + w // 2]
    return out
