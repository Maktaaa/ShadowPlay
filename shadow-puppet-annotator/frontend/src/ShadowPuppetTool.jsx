import React, { useRef, useState } from 'react';

export default function ShadowPuppetTool() {
  const canvasRef = useRef(null);
  const maskCanvasRef = useRef(null); // 离屏 mask 图层
  const [image, setImage] = useState(null);
  const [imageId, setImageId] = useState(null);
  const [box, setBox] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  // 当 editMode 为 null 时为框选模式；为 'add' 或 'subtract' 时进入编辑 mask 模式
  const [editMode, setEditMode] = useState(null);
  const [brushSize, setBrushSize] = useState(10);
  const [cursorPos, setCursorPos] = useState(null);
  const [startPoint, setStartPoint] = useState(null);

  // 根据图片尺寸自适应调整主 canvas 尺寸，并绘制原图
  const resizeCanvasToFit = (img) => {
    const canvas = canvasRef.current;
    const container = canvas.parentElement;
    const maxHeight = window.innerHeight - 200;
    const scale = Math.min(container.clientWidth / img.width, maxHeight / img.height);
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    canvas.scaleRatio = scale;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    setImage(img);
  };

  // 图片上传，上传后调用后端接口获得 imageId，并初始化主 canvas
  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append('image', file);
    const res = await fetch('http://localhost:5000/api/upload', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    setImageId(data.image_id);
    const img = new Image();
    img.onload = () => resizeCanvasToFit(img);
    img.onerror = () => console.error('加载图片失败');
    img.src = `http://localhost:5000/uploads/${data.image_id}.png`;
  };

  // 运行预测：调用后端接口获取 mask，并将结果初始化到离屏 mask 图层
  const handlePredict = async () => {
    if (!imageId || !box) {
      alert('请先上传图片并框选区域');
      return;
    }
    const scale = canvasRef.current.scaleRatio;
    const scaledBox = box.map(coord => coord / scale);
    const res = await fetch('http://localhost:5000/api/sam', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_path: `backend/uploads/${imageId}.png`, box: scaledBox })
    });
    const blob = await res.blob();
    const maskImg = new Image();
    maskImg.onload = () => {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      // 绘制原图与 mask 结果
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      ctx.drawImage(maskImg, 0, 0, canvas.width, canvas.height);
      // 初始化离屏 mask 图层，用于后续编辑和可视化
      if (!maskCanvasRef.current) {
        maskCanvasRef.current = document.createElement('canvas');
        maskCanvasRef.current.width = canvas.width;
        maskCanvasRef.current.height = canvas.height;
      }
      const maskCtx = maskCanvasRef.current.getContext('2d');
      maskCtx.clearRect(0, 0, canvas.width, canvas.height);
      maskCtx.drawImage(maskImg, 0, 0, canvas.width, canvas.height);
      // 对 mask 进行可视化处理
      visualizeMask();
    };
    maskImg.src = URL.createObjectURL(blob);
  };

  // 可视化 mask：内部区域显示为半透明红色，边缘显示为明黄
  const visualizeMask = () => {
    if (!maskCanvasRef.current) return;
    const maskCanvas = maskCanvasRef.current;
    const width = maskCanvas.width;
    const height = maskCanvas.height;
    const maskCtx = maskCanvas.getContext('2d');
    const imgData = maskCtx.getImageData(0, 0, width, height);
    const data = imgData.data;
    // 创建两个数组保存 interior 和 edge 的数据
    const interior = new Uint8ClampedArray(data);
    const edge = new Uint8ClampedArray(data.length);
    
    // 遍历每个像素，假设 mask 为二值图像：白色区域为 mask
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        // 判断是否为 mask 内部像素（这里简单判断红色通道 > 200）
        if (data[idx] > 200) {
          let isEdge = false;
          // 检查8邻域
          for (let j = -1; j <= 1; j++) {
            for (let i = -1; i <= 1; i++) {
              const nx = x + i, ny = y + j;
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
                isEdge = true;
              } else {
                const nIdx = (ny * width + nx) * 4;
                if (data[nIdx] <= 200) {
                  isEdge = true;
                }
              }
            }
          }
          if (isEdge) {
            // 边缘：明黄
            edge[idx] = 255;     // R
            edge[idx + 1] = 255; // G
            edge[idx + 2] = 0;   // B
            edge[idx + 3] = 255; // 完全不透明
            // 内部保持原色，这里置为透明
            interior[idx + 3] = 0;
          } else {
            // 内部：设为红色半透明
            interior[idx] = 255;     // R
            interior[idx + 1] = 0;   // G
            interior[idx + 2] = 0;   // B
            interior[idx + 3] = 150; // 半透明
          }
        } else {
          // 非 mask 区域置为透明
          interior[idx + 3] = 0;
          edge[idx + 3] = 0;
        }
      }
    }
    // 将 interior 和 edge 合成到一个 ImageData 对象中
    const visData = new Uint8ClampedArray(data.length);
    for (let i = 0; i < data.length; i += 4) {
      // 先填 interior
      visData[i] = interior[i];
      visData[i + 1] = interior[i + 1];
      visData[i + 2] = interior[i + 2];
      visData[i + 3] = interior[i + 3];
      // 如果 edge 不透明，则覆盖
      if (edge[i + 3] === 255) {
        visData[i] = edge[i];
        visData[i + 1] = edge[i + 1];
        visData[i + 2] = edge[i + 2];
        visData[i + 3] = edge[i + 3];
      }
    }
    const visImgData = new ImageData(visData, width, height);
    // 将处理后的可视化结果更新回 maskCanvas
    maskCtx.putImageData(visImgData, 0, 0);
    // 更新主 canvas 显示
    redrawComposite();
  };

  // 重绘主 canvas：先绘制原图，再叠加处理后的 mask
  const redrawComposite = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (maskCanvasRef.current) {
      ctx.globalAlpha = 1;
      ctx.drawImage(maskCanvasRef.current, 0, 0, canvas.width, canvas.height);
    }
  };

  // 导出编辑后的 mask：将 maskCanvas 转为图片下载
  const exportMask = () => {
    if (!maskCanvasRef.current) return alert('当前无编辑后的 mask 可导出');
    const dataURL = maskCanvasRef.current.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataURL;
    link.download = 'edited_mask.png';
    link.click();
  };

  // 更新编辑：在 mask 离屏层上绘制增加或删除选区的效果
  const updateMaskAt = (x, y) => {
    if (!maskCanvasRef.current) return;
    const maskCtx = maskCanvasRef.current.getContext('2d');
    maskCtx.save();
    if (editMode === 'add') {
      maskCtx.globalCompositeOperation = 'source-over';
      maskCtx.fillStyle = 'white';
    } else if (editMode === 'subtract') {
      maskCtx.globalCompositeOperation = 'destination-out';
      maskCtx.fillStyle = 'black';
    }
    maskCtx.beginPath();
    maskCtx.arc(x, y, brushSize, 0, 2 * Math.PI);
    maskCtx.fill();
    maskCtx.restore();
    // 每次编辑后重新可视化 mask
    visualizeMask();
  };

  // 鼠标事件：区分框选与编辑模式
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
      const ctx = canvasRef.current.getContext('2d');
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      ctx.drawImage(image, 0, 0, canvasRef.current.width, canvasRef.current.height);
      // 框选预览：绘制红色矩形边框
      ctx.strokeStyle = 'red';
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
    }
  };

  return (
    <div className="p-4 space-y-4 overflow-hidden" style={{ position: 'relative' }}>
      {/* 工具控制 */}
      <div className="flex items-center gap-4 flex-wrap">
        <button
          onClick={() => {
            // 切换为框选模式，重置编辑状态、清除 mask 显示
            setEditMode(null);
            setBox(null);
            const ctx = canvasRef.current.getContext('2d');
            ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            if (image) ctx.drawImage(image, 0, 0, canvasRef.current.width, canvasRef.current.height);
          }}
          className="px-2 py-1 bg-blue-400 text-white rounded hover:bg-blue-500"
        >
          框选
        </button>
        <button
          onClick={() => setEditMode('add')}
          className="px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600"
        >
          增加选区
        </button>
        <button
          onClick={() => setEditMode('subtract')}
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
          笔刷大小：
          <input
            type="range"
            min="1"
            max="50"
            value={brushSize}
            onChange={e => setBrushSize(Number(e.target.value))}
            className="ml-2"
          />
        </label>
      </div>

      {/* 图片上传 */}
      <div className="flex items-center gap-2 mt-2">
        <input type="file" accept="image/*" onChange={handleImageUpload} />
      </div>

      {/* Canvas 与光标预览 */}
      <div style={{ position: 'relative' }}>
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
              position: 'absolute',
              top: `${cursorPos.y}px`,
              left: `${cursorPos.x}px`,
              width: brushSize * 2,
              height: brushSize * 2,
              borderRadius: '50%',
              pointerEvents: 'none',
              border: `1px solid ${
                editMode === 'add'
                  ? 'rgba(255,0,0,0.5)'
                  : editMode === 'subtract'
                  ? 'rgba(0,255,0,0.5)'
                  : 'transparent'
              }`,
              zIndex: 50,
            }}
          />
        )}
      </div>

      {/* 运行预测按钮放置在 canvas 下方 */}
      <div className="mt-4">
        <button
          onClick={handlePredict}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          运行预测
        </button>
      </div>

      {/* 导出 mask 按钮 */}
      <div className="mt-2">
        <button
          onClick={exportMask}
          className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700"
        >
          导出 mask
        </button>
      </div>
    </div>
  );
}

