"""Frame sources for the identity monitor.

Production always uses the webcam. A video file or image folder can replace it,
but only when ``SMARTSCREEN_TEST=1`` is set (self-test harness); otherwise the
``cameraSource`` option is ignored.

A file source behaves like a live camera: frames are delivered at real-time pace
(late frames are dropped, early reads wait), and once the file ends every read
fails, so the monitor reports CAMERA_ERROR exactly as for a camera that stopped.
"""

from __future__ import annotations

import os
import time

WEBCAM = "webcam"
IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".bmp")
DEFAULT_IMAGE_FPS = 10.0


def is_test_mode(env=None) -> bool:
    env = os.environ if env is None else env
    return env.get("SMARTSCREEN_TEST") == "1"


def resolve_camera_source(raw, env=None) -> str:
    """Return ``"webcam"`` or the test source path. Non-webcam sources need test mode."""
    if not is_test_mode(env):
        return WEBCAM
    if not isinstance(raw, str) or not raw.strip() or raw.strip().lower() == WEBCAM:
        return WEBCAM
    return os.path.abspath(raw.strip())


class PacedFrames:
    """Real-time pacing over an indexed frame list. Pure: clock and sleep are injected."""

    def __init__(self, count: int, fps: float, clock=time.monotonic, sleep=time.sleep):
        self.count = max(0, int(count))
        self.fps = fps if fps and fps > 0 else DEFAULT_IMAGE_FPS
        self.clock = clock
        self.sleep = sleep
        self.start = None
        self.next_index = 0

    def next(self) -> int | None:
        """Index of the frame to deliver now, or None once the source has ended."""
        now = self.clock()
        if self.start is None:
            self.start = now
        due = self.start + self.next_index / self.fps
        if now < due:
            self.sleep(due - now)
            now = due
        # Drop frames we are late for, like a live camera would.
        index = max(self.next_index, int((now - self.start) * self.fps))
        if index >= self.count:
            self.next_index = self.count
            return None
        self.next_index = index + 1
        return index


class FileCameraSource:
    """cv2.VideoCapture-like reader (``read``/``release``) over a video file or image folder."""

    def __init__(self, path: str, cv2_module, clock=time.monotonic, sleep=time.sleep):
        self._cv2 = cv2_module
        self._video = None
        self._images: list[str] = []

        if os.path.isdir(path):
            self._images = sorted(
                os.path.join(path, name) for name in os.listdir(path) if name.lower().endswith(IMAGE_EXTENSIONS)
            )
            if not self._images:
                raise FileNotFoundError(f"No images in test camera folder: {path}")
            count, fps = len(self._images), DEFAULT_IMAGE_FPS
        elif os.path.isfile(path):
            self._video = cv2_module.VideoCapture(path)
            if not self._video.isOpened():
                raise FileNotFoundError(f"Unable to open test camera video: {path}")
            count = int(self._video.get(cv2_module.CAP_PROP_FRAME_COUNT))
            fps = float(self._video.get(cv2_module.CAP_PROP_FPS) or 0)
        else:
            raise FileNotFoundError(f"Test camera source not found: {path}")

        self._pacer = PacedFrames(count, fps, clock=clock, sleep=sleep)
        self._position = 0

    def read(self):
        index = self._pacer.next()
        if index is None:
            return False, None
        if self._images:
            frame = self._cv2.imread(self._images[index])
            return frame is not None, frame

        while self._position < index:
            if not self._video.grab():
                self._pacer.next_index = self._pacer.count
                return False, None
            self._position += 1
        ok, frame = self._video.read()
        self._position += 1
        return bool(ok), frame

    def release(self) -> None:
        if self._video is not None:
            self._video.release()
            self._video = None
