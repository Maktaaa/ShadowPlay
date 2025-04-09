# backend/mask_edit.py
import numpy as np
import cv2
from PIL import Image

def edit_mask(original_mask_path, polygon, mode):
    mask = np.array(Image.open(original_mask_path).convert("L"))
    h, w = mask.shape
    overlay = np.zeros((h, w), dtype=np.uint8)
    points = np.array([[(int(p["x"]), int(p["y"])) for p in polygon]])
    cv2.fillPoly(overlay, points, 255)
    if mode == 'add':
        result = cv2.bitwise_or(mask, overlay)
    else:
        result = cv2.bitwise_and(mask, cv2.bitwise_not(overlay))
    return Image.fromarray(result)
