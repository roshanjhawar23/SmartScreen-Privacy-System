import os
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_DIR = os.path.dirname(BACKEND_DIR)
MODELS_DIR = os.path.join(REPO_DIR, "models")

if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)
