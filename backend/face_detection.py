import threading
import cv2
import mediapipe as mp
import os
import sys
import time
from datetime import datetime

# ---------------- LOG DIRECTORY ----------------
home_dir = os.path.expanduser("~")
log_dir = os.path.join(home_dir, "SmartScreen_Intruders")
os.makedirs(log_dir, exist_ok=True)

# ---------------- SAFE CAMERA INIT ----------------
def open_camera():
    # try multiple indexes
    for i in range(3):
        cap = cv2.VideoCapture(i, cv2.CAP_DSHOW)
        if cap.isOpened():
            print(f"CAMERA_READY_{i}", flush=True)
            return cap
    print("CAMERA_FAILED", flush=True)
    return None

cap = open_camera()
if cap is None:
    time.sleep(3)
    sys.exit(1)

# ---------------- MEDIAPIPE ----------------
mp_face = mp.solutions.face_detection
detector = mp_face.FaceDetection(min_detection_confidence=0.6)

# ---------------- STATE ----------------
snapshot_taken=False
last_status=None

no_user_frames=0
user_frames=0
intruder_frames=0

CONFIRM_FRAMES=12

print("AI_STARTED", flush=True)

running = True

# ---------------- STOP LISTENER ----------------
def listen_for_stop():
    global running
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        if line.strip() == "STOP":
            running = False
            break

threading.Thread(target=listen_for_stop, daemon=True).start()

# ---------------- MAIN LOOP ----------------
try:
    while running:

        ret,frame=cap.read()
        if not ret:
            time.sleep(0.1)
            continue

        rgb=cv2.cvtColor(frame,cv2.COLOR_BGR2RGB)
        results=detector.process(rgb)

        face_count=len(results.detections) if results.detections else 0
        status=None

        if face_count==0:
            no_user_frames+=1
            user_frames=0
            intruder_frames=0
            if no_user_frames>=CONFIRM_FRAMES:
                status="NO_USER"
                snapshot_taken=False

        elif face_count==1:
            user_frames+=1
            no_user_frames=0
            intruder_frames=0
            if user_frames>=CONFIRM_FRAMES:
                status="USER_PRESENT"
                snapshot_taken=False

        else:
            intruder_frames+=1
            user_frames=0
            no_user_frames=0
            if intruder_frames>=CONFIRM_FRAMES:
                status="INTRUDER"
                if not snapshot_taken:
                    filename=datetime.now().strftime("%Y%m%d_%H%M%S")+".png"
                    cv2.imwrite(os.path.join(log_dir,filename),frame)
                    snapshot_taken=True

        if status and status!=last_status:
            print(status,flush=True)
            last_status=status

        cv2.waitKey(1)
        time.sleep(0.03)

except Exception as e:
    print("PYTHON_ERROR", str(e), flush=True)

finally:
    if cap:
        cap.release()
    cv2.destroyAllWindows()
    time.sleep(0.8)  
    sys.exit(0)