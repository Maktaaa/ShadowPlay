import os
import uuid
import numpy as np
import cv2
from io import BytesIO
from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS
from PIL import Image
from sam_wrapper import predict_mask_from_box

app = Flask(__name__)
CORS(app)

# 文件夹设置
UPLOAD_FOLDER = "./uploads"
MASK_FOLDER = "./masks"  # 保存所有 mask 文件
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(MASK_FOLDER, exist_ok=True)

def clear_folder(folder):
    for filename in os.listdir(folder):
        file_path = os.path.join(folder, filename)
        if os.path.isfile(file_path):
            os.remove(file_path)

@app.route('/api/clear_uploads', methods=['POST'])
def clear_uploads():
    try:
        clear_folder(UPLOAD_FOLDER)
        return jsonify({"status": "uploads cleared"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/clear_masks', methods=['POST'])
def clear_masks():
    try:
        clear_folder(MASK_FOLDER)
        return jsonify({"status": "masks cleared"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/upload', methods=['POST'])
def upload():
    file = request.files['image']
    image_id = str(uuid.uuid4())
    path = os.path.join(UPLOAD_FOLDER, f"{image_id}.png")
    file.save(path)
    return jsonify({
        "image_id": image_id,
        "image_path": f"/uploads/{image_id}.png"
    })

def process_mask(mask):
    # mask: 预测输出浮点数数组，范围 [0,1]
    mask_binary = (mask * 255).astype(np.uint8)
    contours, _ = cv2.findContours(mask_binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if contours:
        largest = max(contours, key=cv2.contourArea)
        clean_mask = np.zeros_like(mask_binary)
        cv2.drawContours(clean_mask, [largest], -1, 255, thickness=-1)
    else:
        clean_mask = mask_binary
    return (clean_mask > 0).astype(np.uint8) * 255

@app.route('/api/sam', methods=['POST'])
def sam_segment():
    data = request.json
    image_path = os.path.join(UPLOAD_FOLDER, os.path.basename(data["image_path"]))
    box = data["box"]

    mask = predict_mask_from_box(image_path, box)
    mask_final = process_mask(mask)
    img_out = Image.fromarray(mask_final, mode="L")
    out_path = os.path.join(UPLOAD_FOLDER, "mask_temp.png")
    img_out.save(out_path)
    return send_file(out_path, mimetype="image/png")

@app.route('/api/save_mask', methods=['POST'])
def save_mask():
    if 'mask' not in request.files:
        return jsonify({"error": "未提供 mask 文件"}), 400
    mask_file = request.files['mask']
    mask_id = request.form.get("mask_id") or str(uuid.uuid4())
    mask_filename = f"{mask_id}.png"
    mask_path = os.path.join(MASK_FOLDER, mask_filename)
    
    try:
        img = Image.open(mask_file).convert("L")
        img_np = np.array(img)
        _, thresh = cv2.threshold(img_np, 128, 255, cv2.THRESH_BINARY)
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if contours:
            largest = max(contours, key=cv2.contourArea)
            clean_mask = np.zeros_like(thresh)
            cv2.drawContours(clean_mask, [largest], -1, 255, thickness=-1)
        else:
            clean_mask = thresh
        result_img = Image.fromarray(clean_mask, mode="L").convert("1")
        result_img.save(mask_path)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({
        "mask_filename": mask_filename,
        "mask_url": f"/masks/{mask_filename}"
    })

@app.route('/api/mask_centers', methods=['GET'])
def mask_centers():
    centers = []
    for fname in os.listdir(MASK_FOLDER):
        if not fname.lower().endswith(".png"):
            continue
        path = os.path.join(MASK_FOLDER, fname)
        mask = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
        if mask is None:
            continue
        _, thresh = cv2.threshold(mask, 128, 255, cv2.THRESH_BINARY)
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        c = max(contours, key=cv2.contourArea)
        M = cv2.moments(c)
        if M["m00"] != 0:
            cx = M["m10"] / M["m00"]
            cy = M["m01"] / M["m00"]
        else:
            x, y, w, h = cv2.boundingRect(c)
            cx, cy = x + w/2, y + h/2
        epsilon = 1.0
        approx = cv2.approxPolyDP(c, epsilon, True)
        contour_points = approx.reshape(-1, 2).tolist()
        centers.append({
            "mask_id": fname.replace(".png", ""),
            "center": [cx, cy],
            "largest_contour": contour_points,
            "mask_url": f"/masks/{fname}"
        })
    return jsonify({"mask_centers": centers})

@app.route('/api/mask_composite', methods=['GET'])
def mask_composite():
    # 合成所有 mask 图像，采用 alpha-blend 半透明叠加后，
    # 再在上面用各个 mask 自身代表的颜色给每个 mask 增加边缘描边，使边缘更实更粗
    mask_files = [f for f in os.listdir(MASK_FOLDER) if f.lower().endswith('.png')]
    if not mask_files:
        composite = np.zeros((100, 100, 4), dtype=np.float32)
        composite[:, :, 3] = 0
        im = Image.fromarray((composite[:, :, :3]*255).astype(np.uint8), mode="RGB")
        buf = BytesIO()
        im.save(buf, format="PNG")
        buf.seek(0)
        return send_file(buf, mimetype="image/png")
    
    # 预定义颜色列表（RGB），归一化到 [0,1]
    base_colors = [
        (255, 0, 0),    # 红
        (0, 255, 0),    # 绿
        (0, 0, 255),    # 蓝
        (255, 255, 0),  # 黄
        (255, 0, 255),  # 紫
        (0, 255, 255),  # 青
        (255, 165, 0),  # 橙
        (128, 0, 128),  # 紫罗兰
    ]
    norm_colors = [np.array(c, dtype=np.float32) / 255.0 for c in base_colors]
    
    # 读取第一张 mask 获取尺寸，假设所有尺寸一致
    first = cv2.imread(os.path.join(MASK_FOLDER, mask_files[0]), cv2.IMREAD_GRAYSCALE)
    h, w = first.shape
    # 建立 composite 数组，4 通道 float32（R,G,B,alpha）
    composite = np.zeros((h, w, 4), dtype=np.float32)
    
    # 固定 alpha 值（半透明）
    alpha_val = 0.5
    
    for idx, f in enumerate(mask_files):
        path = os.path.join(MASK_FOLDER, f)
        mask = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
        if mask is None:
            continue
        _, mask_thresh = cv2.threshold(mask, 128, 255, cv2.THRESH_BINARY)
        mask_bool = (mask_thresh == 255)
        color = norm_colors[idx % len(norm_colors)]
        rgba = np.zeros((h, w, 4), dtype=np.float32)
        rgba[mask_bool, 0] = color[0]
        rgba[mask_bool, 1] = color[1]
        rgba[mask_bool, 2] = color[2]
        rgba[mask_bool, 3] = alpha_val
        # Alpha blend 公式：out = fg + bg * (1 - fg_alpha)
        composite = rgba + composite * (1 - rgba[:, :, 3:4])
    
    # 将 composite 的 RGB 分量转换为 8 位图像
    composite_rgb = np.clip(composite[:, :, :3] * 255, 0, 255).astype(np.uint8)
    
    # 为每个 mask 在 composite_rgb 上绘制边缘描边，线宽设为 6，使边缘更实
    for idx, f in enumerate(mask_files):
        path = os.path.join(MASK_FOLDER, f)
        mask = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
        if mask is None:
            continue
        _, mask_thresh = cv2.threshold(mask, 128, 255, cv2.THRESH_BINARY)
        contours, _ = cv2.findContours(mask_thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if contours:
            largest = max(contours, key=cv2.contourArea)
            # 使用该 mask 自身代表的颜色进行描边，不再固定为黑色
            border_color = base_colors[idx % len(base_colors)]
            cv2.drawContours(composite_rgb, [largest], -1, border_color, thickness=6)
    
    im = Image.fromarray(composite_rgb, mode="RGB")
    buf = BytesIO()
    im.save(buf, format="PNG")
    buf.seek(0)
    return send_file(buf, mimetype="image/png")

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

@app.route('/masks/<filename>')
def masks_file(filename):
    return send_from_directory(MASK_FOLDER, filename)

if __name__ == '__main__':
    app.run(debug=True)
