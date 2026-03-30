import cv2
import numpy as np
from PIL import Image

# Read image
img = cv2.imread('public/v_logo_transparent.png', cv2.IMREAD_UNCHANGED)

# Check colors
print("Shape:", img.shape)
if img.shape[2] == 4:
    unique_colors = np.unique(img.reshape(-1, 4), axis=0)
else:
    unique_colors = np.unique(img.reshape(-1, 3), axis=0)

num_colors = len(unique_colors)
print(f"Total unique colors: {num_colors}")

# Find most common colors to identify the checkerboard
pixels = img.reshape(-1, img.shape[2])
from collections import Counter
counts = Counter(map(tuple, pixels))
print("Most common colors:")
for color, count in counts.most_common(10):
    print(color, count)

