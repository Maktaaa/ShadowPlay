import React, { useRef, useState, useEffect } from 'react';

export default function ShadowPuppetTool() {
  const canvasRef = useRef(null);             // 主显示 Canvas
  const maskCanvasRef = useRef(null);           // 离屏 Canvas，用于前端可视化处理 mask（透明+彩色边缘效果）
  const binaryMaskCanvasRef = useRef(null);     // 离屏 Canvas，用于保存纯二值 mask 数据
  
  const [image, setImage] = useState(null);     // 原图对象（Image）
  const [imageId, setImageId] = useState(null);
  const [box, setBox] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [editMode, setEditMode] = useState(null); // null: 框选模式; "add": 增加选区; "subtract": 删除选区
  const [brushSize, setBrushSize] = useState(10);
  const [cursorPos, setCursorPos] = useState(null);
  const [startPoint, setStartPoint] = useState(null);
  const [currentMaskId, setCurrentMaskId] = useState(null); // 当前框选区域标识，用于保存 mask
  
  const [maskList, setMaskList] = useState([]);         // 后端返回的 mask URL 数组
  const [thumbnailUrl, setThumbnailUrl] = useState(null); // 组合后的缩略图 dataURL

  // 清空服务器数据（调用后端清空接口）
  const clearServerData = async () => {
    try {
      await fetch("http://localhost:5000/api/clear_uploads", { method: "POST" });
      await fetch("http://localhost:5000/api/clear_masks", { method: "POST" });
    } catch (err) {
      console.error("清空服务器数据出错:", err);
    }
  };

  // 调整 canvas 尺寸以适配上传的图片，并绘制原图
  const resizeCanvasToFit = (img) => {
    const canvas = canvasRef.current;
    const container = canvas.parentElement;
    const maxHeight = window.innerHeight - 200;
    const scale = Math.min(container.clientWidth / img.width, maxHeight / img.height);
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    canvas.scaleRatio = scale;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    setImage(img);
  };

  // 图片上传，清空服务器数据后上传图片，并初始化 canvas
  const handleImageUpload = async (e) => {
    await clearServerData();
    setMaskList([]);
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

  // 运行预测：调用 /api/sam 接口，返回纯二值 mask（0或255），更新离屏 canvas
  const handlePredict = async () => {
    if (!imageId || !box) {
      alert("请先上传图片并框选区域");
      return;
    }
    const scale = canvasRef.current.scaleRatio;
    const scaledBox = box.map(coord => coord / scale);
    const res = await fetch("http://localhost:5000/api/sam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_path: `backend/uploads/${imageId}.png`, box: scaledBox }),
    });
    const blob = await res.blob();
    const maskImg = new Image();
    maskImg.onload = () => {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      // 先绘制原图到主 canvas
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      // 不直接绘制 maskImg 到主 canvas，而是先更新离屏 canvas
      // 初始化 maskCanvasRef 用于可视化
      if (!maskCanvasRef.current) {
        maskCanvasRef.current = document.createElement("canvas");
        maskCanvasRef.current.width = canvas.width;
        maskCanvasRef.current.height = canvas.height;
      }
      const maskCtx = maskCanvasRef.current.getContext("2d");
      maskCtx.clearRect(0, 0, canvas.width, canvas.height);
      maskCtx.drawImage(maskImg, 0, 0, canvas.width, canvas.height);
      
      // 初始化 binaryMaskCanvasRef 用于保存
      if (!binaryMaskCanvasRef.current) {
        binaryMaskCanvasRef.current = document.createElement("canvas");
        binaryMaskCanvasRef.current.width = canvas.width;
        binaryMaskCanvasRef.current.height = canvas.height;
      }
      const binaryCtx = binaryMaskCanvasRef.current.getContext("2d");
      binaryCtx.clearRect(0, 0, canvas.width, canvas.height);
      binaryCtx.drawImage(maskImg, 0, 0, canvas.width, canvas.height);
      
      // 对 maskCanvasRef 进行可视化处理
      visualizeMask();
    };
    maskImg.src = URL.createObjectURL(blob);
  };

  // 可视化 mask：将 maskCanvasRef 内的像素数据进行阈值转换——
  // 如果灰度小于128，则将 alpha 设置为 0（透明），否则根据邻域判断是否为边缘（黄色）或内部（红色半透明）
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
        // 后端返回的 mask 理论上是纯二值，但可能有微小噪声，所以用 threshold 判断
        if (data[idx] < threshold) {
          // 非选区区域设为透明
          data[idx+3] = 0;
        } else {
          // 选区区域
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
            // 边缘：设为黄色全不透明
            data[idx]   = 255;
            data[idx+1] = 255;
            data[idx+2] = 0;
            data[idx+3] = 255;
          } else {
            // 内部：设为红色半透明
            data[idx]   = 255;
            data[idx+1] = 0;
            data[idx+2] = 0;
            data[idx+3] = 150;
          }
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
    // 重绘主 canvas：先绘制原图，再叠加处理后的 mask
    redrawComposite();
  };

  // 主 canvas 重绘：绘制原图，再叠加经过可视化处理的 maskCanvasRef
  const redrawComposite = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (maskCanvasRef.current) {
      ctx.drawImage(maskCanvasRef.current, 0, 0, canvas.width, canvas.height);
    }
  };

  // 编辑 mask：在 maskCanvasRef 与 binaryMaskCanvasRef 同步更新
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

  // 鼠标事件处理
  const handleMouseDown = (e) => {
    if (!image) return;
    const { left, top } = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - left;
    const y = e.clientY - top;
    if (editMode) {
      canvasRef.current.isPainting = true;
      updateMaskAt(x, y);
    } else {
      setStartPoint({ x, y });
      setIsDragging(true);
    }
  };

  const handleMouseMove = (e) => {
    const { left, top } = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - left;
    const y = e.clientY - top;
    setCursorPos({ x, y });
    if (editMode && canvasRef.current.isPainting) {
      updateMaskAt(x, y);
    } else if (!editMode && isDragging && startPoint) {
      const ctx = canvasRef.current.getContext("2d");
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      ctx.drawImage(image, 0, 0, canvasRef.current.width, canvasRef.current.height);
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
    if (editMode) {
      canvasRef.current.isPainting = false;
    } else if (image && isDragging && startPoint) {
      const { left, top } = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - left;
      const y = e.clientY - top;
      setIsDragging(false);
      setBox([
        Math.min(startPoint.x, x),
        Math.min(startPoint.y, y),
        Math.max(startPoint.x, x),
        Math.max(startPoint.y, y)
      ]);
      // 每次新的框选后生成新的 mask id
      setCurrentMaskId(Date.now().toString());
    }
  };

  // 保存 mask：使用 binaryMaskCanvasRef 中的二值数据（放大到原图尺寸）上传后端，传递 currentMaskId 作为文件名
  const saveMask = async () => {
    if (!binaryMaskCanvasRef.current || !image || !currentMaskId) {
      alert("当前无可导出的 mask");
      return;
    }
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = image.width;
    exportCanvas.height = image.height;
    const exportCtx = exportCanvas.getContext("2d");
    // 直接使用二值 mask canvas（不经过可视化处理）上传后端
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
      fetchMaskList();
    }, "image/png");
  };

  // 获取 mask 列表接口
  const fetchMaskList = async () => {
    const res = await fetch("http://localhost:5000/api/list_masks");
    const data = await res.json();
    if (data.mask_urls) {
      setMaskList(data.mask_urls);
    }
  };

  // 生成右侧缩略图：以原图缩略图为底，再依次叠加 mask 图片
  const updateThumbnail = () => {
    if (!image) return;
    const thumbnailWidth = 300;
    const scale = thumbnailWidth / image.width;
    const thumbnailHeight = image.height * scale;
    const offCanvas = document.createElement("canvas");
    offCanvas.width = thumbnailWidth;
    offCanvas.height = thumbnailHeight;
    const ctx = offCanvas.getContext("2d");
    ctx.drawImage(image, 0, 0, thumbnailWidth, thumbnailHeight);

    Promise.all(
      maskList.map((url) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = "Anonymous";
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = "http://localhost:5000" + url;
        })
      )
    )
      .then((maskImages) => {
        maskImages.forEach((maskImg) => {
          ctx.drawImage(maskImg, 0, 0, thumbnailWidth, thumbnailHeight);
        });
        setThumbnailUrl(offCanvas.toDataURL());
      })
      .catch((err) => console.error(err));
  };

  useEffect(() => {
    updateThumbnail();
  }, [maskList, image]);

  useEffect(() => {
    fetchMaskList();
    const interval = setInterval(() => {
      fetchMaskList();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-4" style={{ display: "flex" }}>
      {/* 左侧区域：按钮与 Canvas */}
      <div style={{ flex: 1 }}>
        {/* 第一行：工具栏 */}
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => setEditMode("add")}
            className="px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600"
          >
            增加选区
          </button>
          <button
            onClick={() => setEditMode("subtract")}
            className="px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600"
          >
            删除选区
          </button>
          <button
            onClick={() => setEditMode(null)}
            className="px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600"
          >
            退出编辑
          </button>
          <label className="text-sm text-gray-700">
            笔刷大小:
            <input
              type="range"
              min="1"
              max="50"
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="ml-2"
            />
          </label>
        </div>
        {/* 第二行：操作栏 —— 框选, 运行预测, 保存 mask */}
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => {
              setEditMode(null);
              setBox(null);
              const ctx = canvasRef.current.getContext("2d");
              ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
              if (image)
                ctx.drawImage(
                  image,
                  0,
                  0,
                  canvasRef.current.width,
                  canvasRef.current.height
                );
            }}
            className="px-2 py-1 bg-blue-400 text-white rounded hover:bg-blue-500"
          >
            框选
          </button>
          <button
            onClick={handlePredict}
            className="px-2 py-1 bg-cyan-500 text-white rounded hover:bg-cyan-600"
          >
            运行预测
          </button>
          <button
            onClick={saveMask}
            className="px-2 py-1 bg-purple-500 text-white rounded hover:bg-purple-600"
          >
            保存 mask
          </button>
        </div>
        {/* 第三行：主 Canvas 区域 */}
        <div style={{ position: "relative" }}>
          <canvas
            ref={canvasRef}
            className="border max-w-full h-auto max-h-screen"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          />
          {cursorPos && (
            <div
              style={{
                position: "absolute",
                top: `${cursorPos.y}px`,
                left: `${cursorPos.x}px`,
                width: brushSize * 2,
                height: brushSize * 2,
                borderRadius: "50%",
                pointerEvents: "none",
                border: `1px solid ${
                  editMode === "add"
                    ? "rgba(255,0,0,0.5)"
                    : editMode === "subtract"
                    ? "rgba(0,255,0,0.5)"
                    : "transparent"
                }`,
                zIndex: 50,
              }}
            />
          )}
        </div>
        {/* 第四行：Choose File 按钮 */}
        <div className="flex items-center gap-2 mt-2">
          <input type="file" accept="image/*" onChange={handleImageUpload} />
        </div>
      </div>
      {/* 右侧区域：显示组合后的缩略图 */}
      <div
        style={{
          flexBasis: "320px",
          marginLeft: "20px",
          overflowY: "auto",
          borderLeft: "1px solid #ccc",
          paddingLeft: "10px",
        }}
      >
        <h3>已分割 mask 缩略图</h3>
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt="Composite Thumbnail"
            style={{ maxWidth: "100%", display: "block" }}
          />
        ) : (
          <p>暂无数据</p>
        )}
      </div>
    </div>
  );
}




