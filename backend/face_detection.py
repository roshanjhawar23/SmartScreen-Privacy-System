import argparse
import json
import os
import sys
import threading
import time
from datetime import datetime

import cv2
import numpy as np

from camera_source import WEBCAM, FileCameraSource, resolve_camera_source
from face_tracker import OWNER, UNKNOWN, Detection, FaceTracker
from head_pose import AWAY, PoseConfig, estimate_pose
from liveness import LivenessConfig, LivenessSample
from monitor_core import (
    CameraHealth,
    Emitter,
    FrameObservation,
    ImageHealth,
    StatsAccumulator,
    apply_track_identity,
    LoopHeartbeat,
    StateTracker,
    default_log_dir,
)


STOP_EVENT = threading.Event()
emit = Emitter()

HEARTBEAT_INTERVAL = 2.0
# The vision loop must make progress within this window or heartbeats stop.
LOOP_STALL_TIMEOUT = 5.0
# Consecutive failed camera reads for this long are reported as CAMERA_ERROR.
CAMERA_FAILURE_TIMEOUT = 3.0


class CameraError(RuntimeError):
    pass


def emit_error(message: str) -> None:
    emit(f"AI_ERROR|{message}")


def normalize(feature: np.ndarray) -> np.ndarray:
    vector = np.asarray(feature, dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(vector))
    if norm <= 1e-8:
        raise ValueError("Face embedding normalization failed.")
    return vector / norm


def open_camera() -> cv2.VideoCapture | None:
    for index in range(3):
        camera = cv2.VideoCapture(index, cv2.CAP_DSHOW)
        if camera.isOpened():
            camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            camera.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            return camera
        camera.release()
    return None


def parse_config(raw: dict) -> dict:
    config = dict(raw)
    template = config.get("template")
    if not isinstance(template, list) or not template:
        raise RuntimeError("Owner biometric template is missing.")

    config["template"] = normalize(np.asarray(template, dtype=np.float32)).tolist()
    config["threshold"] = float(config.get("threshold", 0.363))
    config["detectionThreshold"] = float(config.get("detectionThreshold", 0.85))
    config["processEveryN"] = max(1, int(config.get("processEveryN", 3)))
    config["confirmFrames"] = max(1, int(config.get("confirmFrames", 5)))
    config["minFaceSize"] = max(40, int(config.get("minFaceSize", 70)))
    config["noUserDetectionDelay"] = max(0.5, float(config.get("noUserDetectionDelay", 1.5)))
    config["stateUpdateInterval"] = max(0.0, float(config.get("stateUpdateInterval", 0.4)))
    config["cameraFailureTimeout"] = max(0.5, float(config.get("cameraFailureTimeout", CAMERA_FAILURE_TIMEOUT)))
    config["headPose"] = PoseConfig.from_dict(config.get("headPose") if isinstance(config.get("headPose"), dict) else None)
    config["liveness"] = LivenessConfig.from_dict(config.get("liveness") if isinstance(config.get("liveness"), dict) else None)
    config["statsInterval"] = max(1.0, float(config.get("statsInterval", 10.0)))
    config["logDir"] = str(config.get("logDir") or default_log_dir())
    # Test-only: ignored (always "webcam") unless SMARTSCREEN_TEST=1.
    config["cameraSource"] = resolve_camera_source(config.get("cameraSource"))
    return config


def read_startup_config() -> dict:
    line = sys.stdin.readline()
    if not line:
        raise RuntimeError("AI configuration was not received.")

    try:
        raw = json.loads(line)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid AI configuration: {exc}") from exc
    return parse_config(raw)


def stop_listener() -> None:
    while not STOP_EVENT.is_set():
        line = sys.stdin.readline()
        # EOF means the Electron parent is gone; release the camera instead of running orphaned.
        if not line or line.strip() == "STOP":
            STOP_EVENT.set()
            return


def save_intruder_snapshot(frame: np.ndarray, log_dir: str) -> str | None:
    os.makedirs(log_dir, exist_ok=True)
    filename = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3] + ".jpg"
    path = os.path.join(log_dir, filename)
    if cv2.imwrite(path, frame, [int(cv2.IMWRITE_JPEG_QUALITY), 88]):
        return path
    return None


def heartbeat_loop(heartbeat: LoopHeartbeat, stop_event: threading.Event, clock=time.monotonic) -> None:
    while not stop_event.wait(HEARTBEAT_INTERVAL):
        if heartbeat.should_beat(clock()):
            emit("AI_HEARTBEAT")


def image_stats(frame) -> tuple[float, float, bytes]:
    """Mean, std and a signature of a small grayscale copy (cheap, every frame)."""
    small = cv2.resize(frame, (80, 60), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY) if small.ndim == 3 else small
    return float(gray.mean()), float(gray.std()), gray.tobytes()


def liveness_sample(gray, face, pose, now) -> LivenessSample:
    """Face crop and eye-region brightness for the liveness heuristic (cheap, per face)."""
    height, width = gray.shape[:2]
    x, y, w, h = (int(round(float(v))) for v in face[:4])
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(width, x + w), min(height, y + h)
    crop = cv2.resize(gray[y0:y1, x0:x1], (64, 64), interpolation=cv2.INTER_AREA) if x1 > x0 and y1 > y0 else None
    eye_dist = float(np.hypot(face[6] - face[4], face[7] - face[5]))
    half = max(2, int(round(eye_dist * 0.18)))
    levels = []
    for ex, ey in ((face[4], face[5]), (face[6], face[7])):
        cx, cy = int(round(float(ex))), int(round(float(ey)))
        patch = gray[max(0, cy - half):min(height, cy + half), max(0, cx - half):min(width, cx + half)]
        if patch.size:
            levels.append(float(patch.mean()))
    return LivenessSample(
        now,
        pose.yaw if pose else 0.0,
        pose.pitch if pose else 0.0,
        crop,
        sum(levels) / len(levels) if levels else None,
        float(crop.mean()) if crop is not None else None,
    )


def observe_frame(frame, detector, recognizer, owner_template, config, now=0.0) -> FrameObservation:
    height, width = frame.shape[:2]
    detector.setInputSize((width, height))
    _, faces = detector.detect(frame)

    obs = FrameObservation()
    if faces is None:
        return obs
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame

    for face in faces:
        w, h = float(face[2]), float(face[3])
        detection_score = float(face[-1])
        if detection_score < config["detectionThreshold"] or w < config["minFaceSize"] or h < config["minFaceSize"]:
            continue

        aligned = recognizer.alignCrop(frame, face[:-1])
        feature = normalize(recognizer.feature(aligned))
        similarity = float(np.dot(owner_template, feature))

        if similarity >= config["threshold"]:
            obs.owners += 1
            obs.best_owner_score = max(obs.best_owner_score, similarity)
            role = OWNER
        else:
            obs.unknown += 1
            obs.best_unknown_score = max(obs.best_unknown_score, similarity)
            role = UNKNOWN

        pose = estimate_pose(face[4:14], config["headPose"])
        obs.detections.append(Detection(
            (float(face[0]), float(face[1]), w, h), role,
            pose.facing if pose else AWAY, pose.yaw if pose else 0.0, pose.pitch if pose else 0.0,
            similarity=similarity, embedding=feature, size=w / max(1, width),
            liveness=liveness_sample(gray, face, pose, now),
        ))
    return obs


def run_monitor(camera, detector, recognizer, config, stop_event, heartbeat=None, clock=time.monotonic, sleep=time.sleep):
    """Vision loop. Returns normally on stop; raises CameraError when frames stop arriving."""
    owner_template = np.asarray(config["template"], dtype=np.float32)
    process_every_n = int(config["processEveryN"])
    tracker = StateTracker(
        confirm_frames=int(config["confirmFrames"]),
        no_user_delay=float(config["noUserDetectionDelay"]),
        start_time=clock(),
        update_interval=float(config["stateUpdateInterval"]),
    )
    camera_health = CameraHealth(failure_timeout=float(config["cameraFailureTimeout"]))
    image_health = ImageHealth(failure_timeout=float(config["cameraFailureTimeout"]))
    face_tracker = FaceTracker(owner_threshold=float(config["threshold"]), liveness_config=config["liveness"])
    stats = StatsAccumulator(float(config["statsInterval"]), now=clock(), cpu_now=time.process_time())
    frame_counter = 0

    while not stop_event.is_set():
        ok, frame = camera.read()
        now = clock()

        if not ok or frame is None:
            if camera_health.frame_failed(now):
                raise CameraError("CAMERA_ERROR|The camera stopped delivering frames.")
            # Still making progress (the read returned), so keep the heartbeat alive
            # until CameraHealth decides the camera is lost.
            if heartbeat:
                heartbeat.tick(now)
            sleep(0.05)
            continue

        camera_health.frame_ok()
        if heartbeat:
            heartbeat.tick(now)

        stats.frame()
        line = stats.poll(now, time.process_time())
        if line:
            emit(line)

        mean, std, signature = image_stats(frame)
        blocked = image_health.check(now, mean, std, signature)
        if blocked:
            emit(f"TAMPER|{'camera-covered' if blocked == 'dark' else 'feed-frozen'}|mean={mean:.1f}|std={std:.1f}")
            raise CameraError(
                f"CAMERA_ERROR|The camera image is blocked or frozen ({blocked}, mean={mean:.1f}, std={std:.1f})."
            )

        frame_counter += 1
        if frame_counter % process_every_n != 0:
            continue

        started = time.perf_counter()
        obs = observe_frame(frame, detector, recognizer, owner_template, config, now)
        obs.tracks = face_tracker.update(now, obs.detections)
        for track_id, state, reason in face_tracker.pop_liveness_changes():
            emit(f"LIVENESS|track={track_id}|state={state}|reason={reason}")
        apply_track_identity(obs)
        stats.processed((time.perf_counter() - started) * 1000.0)
        event = tracker.update(now, obs)
        if event is None:
            continue

        emit(event.message)
        if event.snapshot:
            snapshot_path = save_intruder_snapshot(frame, config["logDir"])
            if snapshot_path:
                emit(f"PHOTO_SAVED|{snapshot_path}")
            else:
                emit("PHOTO_SAVE_FAILED")


def create_models(detector_path: str, recognizer_path: str, detection_threshold: float):
    if not hasattr(cv2, "FaceDetectorYN") or not hasattr(cv2, "FaceRecognizerSF"):
        raise RuntimeError("OpenCV face APIs are unavailable. Install opencv-contrib-python>=4.10.")
    if not os.path.exists(detector_path):
        raise RuntimeError(f"Face detector model not found: {detector_path}")
    if not os.path.exists(recognizer_path):
        raise RuntimeError(f"Face recognition model not found: {recognizer_path}")

    detector = cv2.FaceDetectorYN.create(
        detector_path,
        "",
        (320, 320),
        detection_threshold,
        0.3,
        5000,
        cv2.dnn.DNN_BACKEND_OPENCV,
        cv2.dnn.DNN_TARGET_CPU,
    )
    recognizer = cv2.FaceRecognizerSF.create(
        recognizer_path,
        "",
        cv2.dnn.DNN_BACKEND_OPENCV,
        cv2.dnn.DNN_TARGET_CPU,
    )
    return detector, recognizer


def main() -> None:
    parser = argparse.ArgumentParser(description="SmartScreen CPU-first identity monitor")
    parser.add_argument("--detector", required=True)
    parser.add_argument("--recognizer", required=True)
    args = parser.parse_args()

    config = read_startup_config()
    detector, recognizer = create_models(args.detector, args.recognizer, config["detectionThreshold"])

    if config["cameraSource"] == WEBCAM:
        camera = open_camera()
    else:
        try:
            camera = FileCameraSource(config["cameraSource"], cv2)
        except FileNotFoundError as exc:
            raise CameraError(f"CAMERA_ERROR|{exc}") from exc
    if camera is None:
        raise CameraError("CAMERA_ERROR|No accessible camera was found.")

    heartbeat = LoopHeartbeat(stall_timeout=LOOP_STALL_TIMEOUT, now=time.monotonic())
    emit("AI_READY")
    threading.Thread(target=stop_listener, daemon=True).start()
    threading.Thread(target=heartbeat_loop, args=(heartbeat, STOP_EVENT), daemon=True).start()

    try:
        run_monitor(camera, detector, recognizer, config, STOP_EVENT, heartbeat)
    finally:
        camera.release()


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:
        message = str(exc)
        if message.startswith("CAMERA_ERROR|"):
            emit_error(message)
        else:
            emit_error(f"AI_UNAVAILABLE|{message}")
        raise SystemExit(1)
