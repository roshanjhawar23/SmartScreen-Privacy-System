import argparse
import json
import os
import sys
import threading
import time
from datetime import datetime

import cv2
import numpy as np


STOP_EVENT = threading.Event()


def emit(message: str) -> None:
    print(message, flush=True)


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


def read_startup_config() -> dict:
    line = sys.stdin.readline()
    if not line:
        raise RuntimeError("AI configuration was not received.")

    try:
        config = json.loads(line)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid AI configuration: {exc}") from exc

    template = config.get("template")
    if not isinstance(template, list) or not template:
        raise RuntimeError("Owner biometric template is missing.")

    vector = normalize(np.asarray(template, dtype=np.float32))
    config["template"] = vector.tolist()
    config["threshold"] = float(config.get("threshold", 0.363))
    config["detectionThreshold"] = float(config.get("detectionThreshold", 0.85))
    config["processEveryN"] = max(1, int(config.get("processEveryN", 3)))
    config["confirmFrames"] = max(1, int(config.get("confirmFrames", 5)))
    config["minFaceSize"] = max(40, int(config.get("minFaceSize", 70)))
    config["noUserDetectionDelay"] = max(0.5, float(config.get("noUserDetectionDelay", 1.5)))
    config["logDir"] = str(config.get("logDir", os.path.join(os.path.dirname(os.path.dirname(__file__)), "Intruder_Logs")))
    return config


def stop_listener() -> None:
    while not STOP_EVENT.is_set():
        line = sys.stdin.readline()
        if not line:
            return
        if line.strip() == "STOP":
            STOP_EVENT.set()
            return


def save_intruder_snapshot(frame: np.ndarray, log_dir: str) -> str | None:
    os.makedirs(log_dir, exist_ok=True)
    filename = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3] + ".jpg"
    path = os.path.join(log_dir, filename)
    if cv2.imwrite(path, frame, [int(cv2.IMWRITE_JPEG_QUALITY), 88]):
        return path
    return None


def heartbeat_loop() -> None:
    while not STOP_EVENT.wait(2.0):
        emit("AI_HEARTBEAT")


def main() -> None:
    parser = argparse.ArgumentParser(description="SmartScreen CPU-first identity monitor")
    parser.add_argument("--detector", required=True)
    parser.add_argument("--recognizer", required=True)
    args = parser.parse_args()

    if not hasattr(cv2, "FaceDetectorYN") or not hasattr(cv2, "FaceRecognizerSF"):
        raise RuntimeError("OpenCV face APIs are unavailable. Install opencv-contrib-python>=4.10.")

    if not os.path.exists(args.detector):
        raise RuntimeError(f"Face detector model not found: {args.detector}")
    if not os.path.exists(args.recognizer):
        raise RuntimeError(f"Face recognition model not found: {args.recognizer}")

    config = read_startup_config()
    owner_template = np.asarray(config["template"], dtype=np.float32)
    threshold = float(config["threshold"])
    detection_threshold = float(config["detectionThreshold"])
    process_every_n = int(config["processEveryN"])
    confirm_frames = int(config["confirmFrames"])
    min_face_size = int(config["minFaceSize"])
    log_dir = config["logDir"]

    detector = cv2.FaceDetectorYN.create(
        args.detector,
        "",
        (320, 320),
        detection_threshold,
        0.3,
        5000,
        cv2.dnn.DNN_BACKEND_OPENCV,
        cv2.dnn.DNN_TARGET_CPU,
    )

    recognizer = cv2.FaceRecognizerSF.create(
        args.recognizer,
        "",
        cv2.dnn.DNN_BACKEND_OPENCV,
        cv2.dnn.DNN_TARGET_CPU,
    )

    camera = open_camera()
    if camera is None:
        raise RuntimeError("CAMERA_ERROR|No accessible camera was found.")

    emit("AI_READY")
    threading.Thread(target=stop_listener, daemon=True).start()
    threading.Thread(target=heartbeat_loop, daemon=True).start()

    owner_streak = 0
    unknown_streak = 0
    no_face_streak = 0
    last_state = None
    frame_counter = 0
    snapshot_state = None
    last_presence_time = time.monotonic()
    no_user_detection_delay = float(config["noUserDetectionDelay"])

    try:
        while not STOP_EVENT.is_set():
            ok, frame = camera.read()
            if not ok:
                time.sleep(0.05)
                continue

            frame_counter += 1
            now = time.monotonic()

            if frame_counter % process_every_n != 0:
                continue

            height, width = frame.shape[:2]
            detector.setInputSize((width, height))
            _, faces = detector.detect(frame)

            if faces is None or len(faces) == 0:
                no_face_streak += 1
                owner_streak = 0
                unknown_streak = 0
                if now - last_presence_time >= no_user_detection_delay and last_state != "NO_USER":
                    emit("STATE|NO_USER|faces=0|owners=0|unknown=0|best=0.0000")
                    last_state = "NO_USER"
                    snapshot_state = None
                continue

            no_face_streak = 0
            owners = 0
            unknown = 0
            best_owner_score = -1.0
            best_unknown_score = -1.0

            for face in faces:
                x, y, w, h = [float(v) for v in face[:4]]
                detection_score = float(face[-1])
                if detection_score < detection_threshold or w < min_face_size or h < min_face_size:
                    continue

                aligned = recognizer.alignCrop(frame, face[:-1])
                feature = normalize(recognizer.feature(aligned))
                similarity = float(np.dot(owner_template, feature))

                if similarity >= threshold:
                    owners += 1
                    best_owner_score = max(best_owner_score, similarity)
                else:
                    unknown += 1
                    best_unknown_score = max(best_unknown_score, similarity)

            if owners == 0 and unknown == 0:
                no_face_streak += 1
                owner_streak = 0
                unknown_streak = 0
                if now - last_presence_time >= no_user_detection_delay and last_state != "NO_USER":
                    emit("STATE|NO_USER|faces=0|owners=0|unknown=0|best=0.0000")
                    last_state = "NO_USER"
                    snapshot_state = None
                continue

            no_face_streak = 0
            last_presence_time = now

            if unknown > 0 and owners > 0:
                candidate_state = "OWNER_AND_UNKNOWN"
                owner_streak += 1
                unknown_streak += 1
            elif unknown > 0:
                candidate_state = "UNKNOWN_GROUP" if unknown > 1 else "UNKNOWN_PERSON"
                unknown_streak += 1
                owner_streak = 0
            else:
                candidate_state = "OWNER_PRESENT"
                owner_streak += 1
                unknown_streak = 0

            if candidate_state in ("OWNER_PRESENT",):
                stable = owner_streak >= confirm_frames
            elif candidate_state in ("UNKNOWN_PERSON", "UNKNOWN_GROUP", "OWNER_AND_UNKNOWN"):
                stable = unknown_streak >= confirm_frames
            else:
                stable = False

            if not stable:
                continue

            best_score = best_owner_score if owners > 0 else best_unknown_score
            state = candidate_state
            if state != last_state:
                emit(
                    f"STATE|{state}|faces={owners + unknown}|owners={owners}|unknown={unknown}|best={best_score:.4f}|ownerScore={max(best_owner_score, 0.0):.4f}"
                )
                last_state = state

                if state in ("UNKNOWN_PERSON", "UNKNOWN_GROUP", "OWNER_AND_UNKNOWN"):
                    if snapshot_state != state:
                        snapshot_path = save_intruder_snapshot(frame, log_dir)
                        if snapshot_path:
                            emit(f"PHOTO_SAVED|{snapshot_path}")
                        else:
                            emit("PHOTO_SAVE_FAILED")
                        snapshot_state = state
                else:
                    snapshot_state = None

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
