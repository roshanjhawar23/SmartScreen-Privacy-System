"""Single entry point for the packaged AI service (PyInstaller build).

    smartscreen_ai.exe --detector D --recognizer R           -> identity monitor
    smartscreen_ai.exe enroll --detector D --recognizer R ... -> owner enrollment

Dev mode runs face_detection.py / enroll_face.py directly; this file only
dispatches, so there is still one face-recognition pipeline.
"""

import sys


def run(argv=None) -> None:
    argv = list(sys.argv if argv is None else argv)
    if len(argv) > 1 and argv[1] == "enroll":
        import enroll_face

        sys.argv = [argv[0]] + argv[2:]
        enroll_face.run()
    else:
        import face_detection

        sys.argv = argv
        face_detection.run()


if __name__ == "__main__":
    run()
