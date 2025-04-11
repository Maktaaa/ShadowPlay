import os
import uuid
import numpy as np
import cv2
from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS
from PIL import Image
from sam_wrapper import predict_mask_from_box

app = Flask(__name__)
CORS(app)

# 文件夹设置
UPLOAD_FOLDER = "./uploads"
MASK_FOLDER = "./masks"  # 保存所有分割后的 mask 文件
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(MASK_FOLDER, exist_ok=True)

# 清空 uploads 文件夹接口
@app.route('/api/clear_uploads', methods=['POST'])
def clear_uploads():
    try:
        for filename in os.listdir(UPLOAD_FOLDER):
            file_path = os.path.join(UPLOAD_FOLDER, filename)
            if os.path.isfile(file_path):
                os.remove(file_path)
        return jsonify({"status": "uploads cleared"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# 清空 masks 文件夹接口
@app.route('/api/clear_masks', methods=['POST'])
def clear_masks():
    try:
        for filename in os.listdir(MASK_FOLDER):
            file_path = os.path.join(MASK_FOLDER, filename)
            if os.path.isfile(file_path):
                os.remove(file_path)
        return jsonify({"status": "masks cleared"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# 图片上传接口
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

# 掩码预测接口：返回纯黑白二值 mask（只有 0 和 255）
@app.route('/api/sam', methods=['POST'])
def sam_segment():
    data = request.json
    image_path = os.path.join(UPLOAD_FOLDER, os.path.basename(data["image_path"]))
    box = data["box"]

    # 调用 SAM 模型预测 mask
    mask = predict_mask_from_box(image_path, box)

    # 转换为 0-255 的二值图像
    mask_binary = (mask * 255).astype(np.uint8)
    # 提取主要轮廓并填充
    contours, _ = cv2.findContours(mask_binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if contours:
        longest = max(contours, key=lambda cnt: cv2.arcLength(cnt, True))
        clean_mask = np.zeros_like(mask_binary)
        cv2.drawContours(clean_mask, [longest], -1, 255, thickness=-1)
    else:
        clean_mask = mask_binary
    # 转换为严格的二值图像：像素值只有 0 或 255
    mask = (clean_mask > 0).astype(np.uint8)
    final_mask = (mask * 255).astype(np.uint8)
    img_to_send = Image.fromarray(final_mask, mode="L")
    
    out_path = os.path.join(UPLOAD_FOLDER, "mask_temp.png")
    img_to_send.save(out_path)
    return send_file(out_path, mimetype="image/png")

# 保存 mask 接口：接收前端上传的 mask 文件，将其转换为标准黑白二值 mask后保存
@app.route('/api/save_mask', methods=['POST'])
def save_mask():
    if 'mask' not in request.files:
        return jsonify({"error": "未提供 mask 文件"}), 400
    mask_file = request.files['mask']
    # 从表单读取 mask_id 参数（用于同一框选覆盖保存）
    mask_id = request.form.get("mask_id")
    if not mask_id:
        mask_id = str(uuid.uuid4())
    mask_filename = f"{mask_id}.png"
    mask_path = os.path.join(MASK_FOLDER, mask_filename)
    
    try:
        # 打开上传的 mask 文件，转换为灰度图
        img = Image.open(mask_file).convert("L")
        # 阈值处理，将大于等于 128 转为 255，否则为 0
        binary_img = img.point(lambda p: 255 if p >= 128 else 0)
        # 转换为二值（1位黑白图）
        binary_img = binary_img.convert("1")
        binary_img.save(mask_path)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({
        "mask_filename": mask_filename,
        "mask_url": f"/masks/{mask_filename}"
    })

# 获取 mask 列表接口：返回 MASK_FOLDER 中所有 mask 文件的 URL 列表
@app.route('/api/list_masks', methods=['GET'])
def list_masks():
    files = os.listdir(MASK_FOLDER)
    mask_urls = [f"/masks/{fname}" for fname in files if fname.lower().endswith('.png')]
    return jsonify({"mask_urls": mask_urls})

# 静态文件访问接口：上传图片
@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

# 静态文件访问接口：mask 文件
@app.route('/masks/<filename>')
def masks_file(filename):
    return send_from_directory(MASK_FOLDER, filename)

if __name__ == '__main__':
    app.run(debug=True)


