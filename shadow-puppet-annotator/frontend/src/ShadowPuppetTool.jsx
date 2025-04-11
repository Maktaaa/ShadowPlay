import React, { useRef, useState, useEffect } from 'react';

// 计算两点间距离
function distance(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

export default function ShadowPuppetTool() {
  // 三个图层 Canvas（DOM中后出现的在上层）
  const baseCanvasRef = useRef(null);    // 底层：显示原图与 mask overlay
  const borderCanvasRef = useRef(null);  // 中间层：绘制选中 mask 的边缘（轮廓）
  const pointsCanvasRef = useRef(null);  // 顶层：绘制所有 mask 的中心点，并响应点击

  // 离屏 Canvas（不显示在DOM中）
  const maskCanvasRef = useRef(null);       // 用于可视化处理 mask（将非选区置透明，选区上色）
  const binaryMaskCanvasRef = useRef(null);   // 用于保存时使用的纯二值数据

  // 常规状态
  const [image, setImage] = useState(null); // 原图
  const [imageId, setImageId] = useState(null);
  const [box, setBox] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [editMode, setEditMode] = useState(null); // null: 框选模式; "add": 增加; "subtract": 删除
  const [brushSize, setBrushSize] = useState(10);
  const [cursorPos, setCursorPos] = useState(null);
  const [startPoint, setStartPoint] = useState(null);
  const [currentMaskId, setCurrentMaskId] = useState(null); // 当前框选区域标识（用于保存 mask）

  // 后端返回的 mask 信息：每项包含 mask_id、center、largest_contour（轮廓点数组，原图坐标）和 mask_url
  const [maskCenters, setMaskCenters] = useState([]);
  const [selectedMaskId, setSelectedMaskId] = useState(null);
  // 是否处于 overlay 模式
  const [showMasksMode, setShowMasksMode] = useState(false);
  // 存储后端返回的合并 mask 图像 URL（防缓存加时间戳）
  const [compositeMaskUrl, setCompositeMaskUrl] = useState(null);

  // 调整所有 Canvas 尺寸和比例，使各层一致
  const adjustAllCanvasSize = (width, height, scaleRatio) => {
    [baseCanvasRef, borderCanvasRef, pointsCanvasRef].forEach(ref => {
      if (ref.current) {
        ref.current.width = width;
        ref.current.height = height;
        ref.current.style.width = width + "px";
        ref.current.style.height = height + "px";
        ref.current.scaleRatio = scaleRatio;
      }
    });
  };

  // 调整底层 Canvas 尺寸并绘制原图
  const resizeCanvasToFit = (img) => {
    const container = baseCanvasRef.current.parentElement;
    const maxHeight = window.innerHeight - 200;
    const scale = Math.min(container.clientWidth / img.width, maxHeight / img.height);
    const width = img.width * scale;
    const height = img.height * scale;
    adjustAllCanvasSize(width, height, scale);
    const ctx = baseCanvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    setImage(img);
  };

  // 图片上传
  const handleImageUpload = async (e) => {
    try {
      await fetch("http://localhost:5000/api/clear_uploads", { method: "POST" });
      await fetch("http://localhost:5000/api/clear_masks", { method: "POST" });
    } catch (err) {
      console.error("清空服务器出错", err);
    }
    setMaskCenters([]);
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("image", file);
    const res = await fetch("http://localhost:5000/api/upload", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    setImageId(data.image_id);
    const img = new Image();
    img.onload = () => resizeCanvasToFit(img);
    img.onerror = () => console.error("加载图片失败");
    img.src = `http://localhost:5000/uploads/${data.image_id}.png`;
  };

  // 框选与预测：调用 /api/sam 获取纯二值 mask，更新离屏 Canvas
  const handlePredict = async () => {
    if (!imageId || !box) {
      alert("请先上传图片并框选区域");
      return;
    }
    const scale = baseCanvasRef.current.scaleRatio;
    const scaledBox = box.map(coord => coord / scale);
    const res = await fetch("http://localhost:5000/api/sam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_path: `backend/uploads/${imageId}.png`, box: scaledBox })
    });
    const blob = await res.blob();
    const maskImg = new Image();
    maskImg.onload = () => {
      const width = baseCanvasRef.current.width;
      const height = baseCanvasRef.current.height;
      // 更新离屏 maskCanvasRef
      if (!maskCanvasRef.current) {
        maskCanvasRef.current = document.createElement("canvas");
        maskCanvasRef.current.width = width;
        maskCanvasRef.current.height = height;
      }
      const maskCtx = maskCanvasRef.current.getContext("2d");
      maskCtx.clearRect(0, 0, width, height);
      maskCtx.drawImage(maskImg, 0, 0, width, height);
      // 更新离屏 binaryMaskCanvasRef
      if (!binaryMaskCanvasRef.current) {
        binaryMaskCanvasRef.current = document.createElement("canvas");
        binaryMaskCanvasRef.current.width = width;
        binaryMaskCanvasRef.current.height = height;
      }
      const binaryCtx = binaryMaskCanvasRef.current.getContext("2d");
      binaryCtx.clearRect(0, 0, width, height);
      binaryCtx.drawImage(maskImg, 0, 0, width, height);
      // 可视化处理：将非选区透明，选区区域以红/黄显示
      visualizeMask();
    };
    maskImg.src = URL.createObjectURL(blob);
  };

  // 可视化 mask：遍历 maskCanvasRef 像素数据，灰度 <128 设为透明；否则检查邻域，若为边缘则显示黄色，否则显示红色半透明
  const visualizeMask = () => {
    if (!maskCanvasRef.current) return;
    const canvas = maskCanvasRef.current;
    const ctx = canvas.getContext("2d");
    const { width, height } = canvas;
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    const threshold = 128;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const gray = data[idx];  // R=G=B
        if (gray < threshold) {
          data[idx+3] = 0;
        } else {
          let isEdge = false;
          for (let j = -1; j <= 1; j++) {
            for (let i = -1; i <= 1; i++) {
              const nx = x + i, ny = y + j;
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
                isEdge = true;
              } else {
                const nIdx = (ny * width + nx) * 4;
                if (data[nIdx] < threshold) {
                  isEdge = true;
                }
              }
            }
          }
          if (isEdge) {
            data[idx] = 255;
            data[idx+1] = 255;
            data[idx+2] = 0;
            data[idx+3] = 255;
          } else {
            data[idx] = 255;
            data[idx+1] = 0;
            data[idx+2] = 0;
            data[idx+3] = 150;
          }
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
    // 更新底层显示
    redrawBase();
  };

  // 底层绘制：在 baseCanvas 上绘制原图与 mask overlay（由 maskCanvasRef 合成）
  const redrawBase = () => {
    const canvas = baseCanvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (maskCanvasRef.current) {
      ctx.drawImage(maskCanvasRef.current, 0, 0, canvas.width, canvas.height);
    }
  };

  // 编辑 mask：同步更新离屏 canvas
  const updateMaskAt = (x, y) => {
    if (!maskCanvasRef.current || !binaryMaskCanvasRef.current) return;
    const maskCtx = maskCanvasRef.current.getContext("2d");
    maskCtx.save();
    if (editMode === "add") {
      maskCtx.globalCompositeOperation = "source-over";
      maskCtx.fillStyle = "white";
    } else if (editMode === "subtract") {
      maskCtx.globalCompositeOperation = "destination-out";
      maskCtx.fillStyle = "black";
    }
    maskCtx.beginPath();
    maskCtx.arc(x, y, brushSize, 0, 2 * Math.PI);
    maskCtx.fill();
    maskCtx.restore();
    visualizeMask();
    const binaryCtx = binaryMaskCanvasRef.current.getContext("2d");
    binaryCtx.save();
    binaryCtx.globalCompositeOperation = "source-over";
    if (editMode === "add") {
      binaryCtx.fillStyle = "white";
    } else if (editMode === "subtract") {
      binaryCtx.fillStyle = "black";
    }
    binaryCtx.beginPath();
    binaryCtx.arc(x, y, brushSize, 0, 2 * Math.PI);
    binaryCtx.fill();
    binaryCtx.restore();
  };

  // 鼠标事件处理（仅在非 overlay 模式下启用框选/编辑）
  const handleMouseDown = (e) => {
    if (!image || showMasksMode) return;
    const { left, top } = baseCanvasRef.current.getBoundingClientRect();
    const x = e.clientX - left;
    const y = e.clientY - top;
    if (editMode) {
      baseCanvasRef.current.isPainting = true;
      updateMaskAt(x, y);
    } else {
      setStartPoint({ x, y });
      setIsDragging(true);
    }
  };

  const handleMouseMove = (e) => {
    if (showMasksMode) return;
    const { left, top } = baseCanvasRef.current.getBoundingClientRect();
    const x = e.clientX - left;
    const y = e.clientY - top;
    setCursorPos({ x, y });
    if (editMode && baseCanvasRef.current.isPainting) {
      updateMaskAt(x, y);
    } else if (!editMode && isDragging && startPoint) {
      const ctx = baseCanvasRef.current.getContext("2d");
      ctx.clearRect(0, 0, baseCanvasRef.current.width, baseCanvasRef.current.height);
      ctx.drawImage(image, 0, 0, baseCanvasRef.current.width, baseCanvasRef.current.height);
      ctx.strokeStyle = "red";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        Math.min(startPoint.x, x),
        Math.min(startPoint.y, y),
        Math.abs(x - startPoint.x),
        Math.abs(y - startPoint.y)
      );
    }
  };

  const handleMouseUp = (e) => {
    if (showMasksMode) return;
    if (editMode) {
      baseCanvasRef.current.isPainting = false;
    } else if (image && isDragging && startPoint) {
      const { left, top } = baseCanvasRef.current.getBoundingClientRect();
      const x = e.clientX - left;
      const y = e.clientY - top;
      setIsDragging(false);
      setBox([
        Math.min(startPoint.x, x),
        Math.min(startPoint.y, y),
        Math.max(startPoint.x, x),
        Math.max(startPoint.y, y)
      ]);
      setCurrentMaskId(Date.now().toString());
    }
  };

  // 保存 mask：将 binaryMaskCanvasRef 数据放大至原图尺寸上传后端
  const saveMask = async () => {
    if (!binaryMaskCanvasRef.current || !image || !currentMaskId) {
      alert("当前无可导出的 mask");
      return;
    }
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = image.width;
    exportCanvas.height = image.height;
    const exportCtx = exportCanvas.getContext("2d");
    exportCtx.drawImage(binaryMaskCanvasRef.current, 0, 0, image.width, image.height);
    exportCanvas.toBlob(async (blob) => {
      const formData = new FormData();
      formData.append("mask", blob, `${currentMaskId}.png`);
      formData.append("mask_id", currentMaskId);
      const res = await fetch("http://localhost:5000/api/save_mask", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      alert("保存成功");
      fetchMaskCenters();
    }, "image/png");
  };

  // 获取 mask centers：调用 /api/mask_centers 获取所有 mask 的轮廓及中心点信息
  const fetchMaskCenters = async () => {
    const res = await fetch("http://localhost:5000/api/mask_centers");
    const data = await res.json();
    if (data.mask_centers) {
      setMaskCenters(data.mask_centers);
    }
  };

  // 获取合成 mask 图像：调用 /api/mask_composite，防止缓存加时间戳
  const fetchCompositeImage = () => {
    setCompositeMaskUrl(`http://localhost:5000/api/mask_composite?${Date.now()}`);
  };

  // 重绘 overlay：
  // 底层：baseCanvas 绘制原图和合成 mask overlay（如果有 compositeMaskUrl，则加载之）
  // 中间层：borderCanvas 绘制选中 mask 的真实轮廓（红色粗线），依据后端返回的 largest_contour 绘制轮廓路径
  // 顶层：pointsCanvas 绘制所有 mask 的中心点（蓝色圆点）
  const redrawOverlay = () => {
    const baseCanvas = baseCanvasRef.current;
    const baseCtx = baseCanvas.getContext("2d");
    baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
    baseCtx.drawImage(image, 0, 0, baseCanvas.width, baseCanvas.height);
    if (compositeMaskUrl) {
      const compImg = new Image();
      compImg.crossOrigin = "Anonymous";
      compImg.onload = () => {
        baseCtx.globalAlpha = 0.5;
        baseCtx.drawImage(compImg, 0, 0, baseCanvas.width, baseCanvas.height);
        baseCtx.globalAlpha = 1;
        redrawBorder();
        redrawPoints();
      };
      compImg.src = compositeMaskUrl;
    } else {
      redrawBorder();
      redrawPoints();
    }
  };

  // 重绘边界层（中间层）：绘制选中 mask 的轮廓（红色粗线）
  const redrawBorder = () => {
    const canvas = borderCanvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (selectedMaskId) {
      const mc = maskCenters.find(m => m.mask_id === selectedMaskId);
      if (mc && mc.largest_contour && mc.largest_contour.length > 0) {
        ctx.beginPath();
        const scale = canvas.scaleRatio;
        let [px, py] = mc.largest_contour[0];
        ctx.moveTo(px * scale, py * scale);
        for (let i = 1; i < mc.largest_contour.length; i++) {
          let [cx, cy] = mc.largest_contour[i];
          ctx.lineTo(cx * scale, cy * scale);
        }
        ctx.closePath();
        ctx.lineWidth = 4;
        ctx.strokeStyle = "red";
        ctx.stroke();
      }
    }
  };

  // 重绘点层（顶层）：绘制所有 mask 的中心点（蓝色圆点）
  const redrawPoints = () => {
    const canvas = pointsCanvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = canvas.scaleRatio;
    maskCenters.forEach(mc => {
      const [cx, cy] = mc.center;
      ctx.beginPath();
      ctx.arc(cx * scale, cy * scale, 5, 0, 2 * Math.PI);
      ctx.fillStyle = "blue";
      ctx.fill();
      ctx.strokeStyle = "blue";
      ctx.stroke();
    });
  };

  // 顶层点击：仅在 overlay 模式下，根据中心点判断是否点击
  const handleCanvasClick = (e) => {
    if (!showMasksMode || maskCenters.length === 0) return;
    const { left, top } = pointsCanvasRef.current.getBoundingClientRect();
    const x = e.clientX - left;
    const y = e.clientY - top;
    const scale = pointsCanvasRef.current.scaleRatio;
    let found = false;
    for (let mc of maskCenters) {
      const cx = mc.center[0] * scale;
      const cy = mc.center[1] * scale;
      if (distance(x, y, cx, cy) < 10) {
        setSelectedMaskId(mc.mask_id);
        found = true;
        break;
      }
    }
    if (!found) {
      setSelectedMaskId(null);
    }
    redrawOverlay();
  };

  // 切换 overlay 模式：Show Masks时获取 mask centers与复合 mask图像，启用 overlay
  const handleShowMasks = async () => {
    await fetchMaskCenters();
    fetchCompositeImage();
    setShowMasksMode(true);
    if (pointsCanvasRef.current) {
      pointsCanvasRef.current.style.pointerEvents = "auto";
    }
    redrawOverlay();
  };

  const handleHideMasks = () => {
    setShowMasksMode(false);
    setSelectedMaskId(null);
    if (pointsCanvasRef.current) {
      pointsCanvasRef.current.style.pointerEvents = "none";
    }
    // 恢复仅显示底层
    const ctx = baseCanvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, baseCanvasRef.current.width, baseCanvasRef.current.height);
    ctx.drawImage(image, 0, 0, baseCanvasRef.current.width, baseCanvasRef.current.height);
    if (maskCanvasRef.current) {
      ctx.drawImage(maskCanvasRef.current, 0, 0, baseCanvasRef.current.width, baseCanvasRef.current.height);
    }
    if (borderCanvasRef.current) {
      borderCanvasRef.current.getContext("2d").clearRect(0, 0, borderCanvasRef.current.width, borderCanvasRef.current.height);
    }
    if (pointsCanvasRef.current) {
      pointsCanvasRef.current.getContext("2d").clearRect(0, 0, pointsCanvasRef.current.width, pointsCanvasRef.current.height);
    }
  };

  useEffect(() => {
    if (showMasksMode) {
      redrawOverlay();
    }
  }, [maskCenters, image, showMasksMode]);

  return (
    <div className="p-4" style={{ display: "flex" }}>
      <div style={{ flex: 1, position: "relative" }}>
        {/* 工具栏 */}
        <div className="flex items-center gap-2 mb-2">
          <button onClick={() => setEditMode("add")}
            className="px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600">
            增加选区
          </button>
          <button onClick={() => setEditMode("subtract")}
            className="px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600">
            删除选区
          </button>
          <button onClick={() => setEditMode(null)}
            className="px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600">
            退出编辑
          </button>
          <label className="text-sm text-gray-700">
            笔刷大小:
            <input type="range" min="1" max="50" value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))} className="ml-2" />
          </label>
        </div>
        {/* 操作栏 */}
        <div className="flex items-center gap-2 mb-2">
          <button onClick={() => {
              setEditMode(null);
              setBox(null);
              const ctx = baseCanvasRef.current.getContext("2d");
              ctx.clearRect(0, 0, baseCanvasRef.current.width, baseCanvasRef.current.height);
              if (image)
                ctx.drawImage(image, 0, 0, baseCanvasRef.current.width, baseCanvasRef.current.height);
            }}
            className="px-2 py-1 bg-blue-400 text-white rounded hover:bg-blue-500">
            框选
          </button>
          <button onClick={handlePredict}
            className="px-2 py-1 bg-cyan-500 text-white rounded hover:bg-cyan-600">
            运行预测
          </button>
          <button onClick={saveMask}
            className="px-2 py-1 bg-purple-500 text-white rounded hover:bg-purple-600">
            保存 mask
          </button>
          { !showMasksMode ? (
            <button onClick={handleShowMasks}
              className="px-2 py-1 bg-indigo-500 text-white rounded hover:bg-indigo-600">
              Show Masks
            </button>
          ) : (
            <button onClick={handleHideMasks}
              className="px-2 py-1 bg-indigo-500 text-white rounded hover:bg-indigo-600">
              Hide Masks
            </button>
          )}
        </div>
        {/* 三个图层叠加 */}
        <div style={{ position: "relative" }}>
          <canvas ref={baseCanvasRef}
            className="border max-w-full h-auto max-h-screen"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp} />
          <canvas ref={borderCanvasRef} style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }} />
          <canvas ref={pointsCanvasRef} style={{ position: "absolute", top: 0, left: 0, pointerEvents: showMasksMode ? "auto" : "none" }}
            onClick={showMasksMode ? handleCanvasClick : undefined} />
        </div>
        {/* 上传区域 */}
        <div className="flex items-center gap-2 mt-2">
          <input type="file" accept="image/*" onChange={handleImageUpload} />
        </div>
      </div>
      <div style={{ marginLeft: "20px" }}>
        {/* 可扩展其他信息 */}
      </div>
    </div>
  );
}


