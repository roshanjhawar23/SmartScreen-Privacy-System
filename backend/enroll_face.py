import argparse
import json
import os
import sys

import cv2
import numpy as np


def fail(message: str) -> None:
    print(json.dumps({"ok": False, "error": message}), flush=True)
    raise SystemExit(1)


def normalize(feature: np.ndarray) -> np.ndarray:
    vector = feature.astype(np.float32).reshape(-1)
    norm = np.linalg.norm(vector)
    if norm <= 1e-8:
        raise ValueError("Face embedding normalization failed.")
    return vector / norm


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--detector", required=True)
    parser.add_argument("--recognizer", required=True)
    parser.add_argument("--image", action="append", required=True)
    args = parser.parse_args()

    if not hasattr(cv2, "FaceDetectorYN") or not hasattr(cv2, "FaceRecognizerSF"):
        fail("OpenCV face APIs are unavailable. Install opencv-contrib-python.")

    if len(args.image) != 5:
        fail("Exactly five images are required.")

    detector = cv2.FaceDetectorYN.create(
        args.detector,
        "",
        (320, 320),
        0.85,
        0.30,
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

    embeddings = []

    for index, image_path in enumerate(args.image, start=1):
        image = cv2.imread(image_path)
        if image is None:
            fail(f"Unable to read enrollment sample {index}.")

        height, width = image.shape[:2]
        if width < 240 or height < 240:
            fail(f"Enrollment sample {index} is too small.")

        detector.setInputSize((width, height))
        _, faces = detector.detect(image)

        if faces is None or len(faces) == 0:
            fail(f"No face detected in sample {index}.")
        if len(faces) != 1:
            fail(f"Sample {index} must contain exactly one face.")

        face = faces[0]
        score = float(face[-1])
        box_width = float(face[2])
        box_height = float(face[3])

        if score < 0.85:
            fail(f"Face quality is too low in sample {index}.")
        if box_width < 90 or box_height < 90:
            fail(f"Move closer to the camera for sample {index}.")

        aligned = recognizer.alignCrop(image, face[:-1])
        feature = recognizer.feature(aligned)
        embeddings.append(normalize(feature))

    template = normalize(np.mean(np.stack(embeddings), axis=0))

    print(
        json.dumps(
            {
                "ok": True,
                "embedding": template.tolist(),
                "sampleCount": len(embeddings),
            }
        ),
        flush=True,
    )


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:
        fail(str(exc))
