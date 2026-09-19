# SmartScreen face models

SmartScreen Phase 1B uses OpenCV's YuNet face detector and SFace face recognizer. Both are designed for the OpenCV DNN face pipeline and can run with the CPU backend. The recognition pipeline uses cosine similarity.

Download these two ONNX files into this folder:

- `face_detection_yunet_2023mar.onnx`
- `face_recognition_sface_2021dec.onnx`

The model sources are the official OpenCV Zoo repositories:

- https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet
- https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface

OpenCV's SFace implementation documents the cosine threshold baseline as 0.363; SmartScreen Phase 1B only creates the owner template. The live matching threshold will be calibrated in Phase 1C on the target laptop rather than assuming one universal value.
