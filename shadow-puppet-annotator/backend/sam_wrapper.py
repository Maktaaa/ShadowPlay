import torch
import numpy as np
from PIL import Image
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor

# 设置设备
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# 配置文件 & checkpoint 路径（按需修改）
CONFIG_PATH = "D:/sam2/sam2/configs/sam2.1/sam2.1_hiera_l.yaml"
CHECKPOINT_PATH = "D:/sam2/checkpoints/sam2.1_hiera_large.pt"

# 构建模型
sam2_model = build_sam2(CONFIG_PATH, CHECKPOINT_PATH, device=device)
predictor = SAM2ImagePredictor(sam2_model)


def predict_mask_from_box(image_path, input_box):
    image = Image.open(image_path).convert("RGB")
    image_np = np.array(image)
    predictor.set_image(image_np)

    input_box = np.array(input_box)

    masks, scores, _ = predictor.predict(
    point_coords=None,
    point_labels=None,
    box=input_box[None, :],
    multimask_output=False,)
    return masks[0]
