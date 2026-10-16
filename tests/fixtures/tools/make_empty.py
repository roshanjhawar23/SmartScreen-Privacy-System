"""Generate a synthetic empty-room clip (no person) as tests/fixtures/private/empty.mp4.

A recorded empty desk (``record_webcam.py empty``) is more realistic; this one
lets the harness run before any recording exists. Adds sensor-like noise so
every frame differs.
"""

import argparse

import cv2
import numpy as np

from fixture_io import FPS, SIZE, private_path, write_video


def background():
    w, h = SIZE
    y = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    x = np.linspace(0, 1, w, dtype=np.float32)[None, :]
    img = np.zeros((h, w, 3), dtype=np.float32)
    img[..., 0] = 120 + 40 * y + 10 * x  # wall
    img[..., 1] = 125 + 30 * y
    img[..., 2] = 130 + 20 * y
    img = img.astype(np.uint8)
    cv2.rectangle(img, (40, 330), (600, 480), (70, 80, 95), -1)  # desk
    cv2.rectangle(img, (420, 60), (560, 200), (180, 170, 150), -1)  # picture frame
    cv2.rectangle(img, (80, 120), (200, 330), (60, 60, 70), -1)  # door / shelf
    return img


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seconds", type=float, default=20.0)
    args = parser.parse_args()

    rng = np.random.default_rng(7)
    base = background().astype(np.int16)
    frames = []
    for _ in range(int(args.seconds * FPS)):
        noise = rng.normal(0, 3, base.shape).astype(np.int16)
        frames.append(np.clip(base + noise, 0, 255).astype(np.uint8))
    write_video(private_path("empty.mp4"), frames)


if __name__ == "__main__":
    main()
