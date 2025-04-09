from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS
from sam_wrapper import predict_mask_from_box
import os
import uuid
from PIL import Image

app = Flask(__name__)
CORS(app)

# 上传文件目录
UPLOAD_FOLDER = "./uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# 上传图片接口
@app.route('/api/upload', methods=['POST'])
def upload():
    file = request.files['image']
    image_id = str(uuid.uuid4())
    path = os.path.join(UPLOAD_FOLDER, f"{image_id}.png")
    file.save(path)
    return jsonify({
        "image_id": image_id,
        "image_path": f"/uploads/{image_id}.png"  # 可用于展示
    })

# 分割预测接口
@app.route('/api/sam', methods=['POST'])
def sam_segment():
    data = request.json
    image_path = os.path.join(UPLOAD_FOLDER, os.path.basename(data['image_path']))
    box = data['box']
    mask = predict_mask_from_box(image_path, box)

    out_path = os.path.join(UPLOAD_FOLDER, "mask_temp.png")
    Image.fromarray((mask.astype("uint8")) * 255).save(out_path)
    return send_file(out_path, mimetype='image/png')

# 静态图片访问接口
@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

if __name__ == '__main__':
    app.run(debug=True)

