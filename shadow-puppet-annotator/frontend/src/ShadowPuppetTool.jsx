import React, { useRef, useState } from 'react';

export default function ShadowPuppetTool() {
  const canvasRef = useRef(null);                // 主显示 canvas
  const maskCanvasRef = useRef(null);            // 可视化 mask 离屏 canvas（内部红/边缘黄）
  const binaryMaskCanvasRef = useRef(null);      // 纯二值 mask 离屏 canvas（全白/全黑）
  
  const [image, setImage] = useState(null);        // 原图 Image 对象（自然尺寸）
  const [imageId, setImageId] = useState(null);
  const [box, setBox] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  // 当 editMode 为 null 为框选模式，'add' 表示增加选区、'subtract' 表示删除选区
  const [editMode, setEditMode] = useState(null);
  const [brushSize, setBrushSize] = useState(10);
  const [cursorPos, setCursorPos] = useState(null);
  const [startPoint, setStartPoint] = useState(null);

  // 根据上传图片自适应调整主 canvas 尺寸，并绘制原图
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

  // 图片上传：上传后调用后端接口获得 imageId，并初始化主 canvas
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

  // 运行预测：调用后端接口获取 mask，并初始化两个离屏 mask 图层
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
      // 绘制原图和初始 mask（视觉化效果）
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      ctx.drawImage(maskImg, 0, 0, canvas.width, canvas.height);
      // 初始化可视化 mask 离屏 canvas
      if (!maskCanvasRef.current) {
        maskCanvasRef.current = document.createElement('canvas');
        maskCanvasRef.current.width = canvas.width;
        maskCanvasRef.current.height = canvas.height;
      }
      const maskCtx = maskCanvasRef.current.getContext('2d');
      maskCtx.clearRect(0, 0, canvas.width, canvas.height);
      maskCtx.drawImage(maskImg, 0, 0, canvas.width, canvas.height);
      // 初始化纯二值 mask 离屏 canvas（不做可视化效果，仅保留原始二值数据）
      if (!binaryMaskCanvasRef.current) {
        binaryMaskCanvasRef.current = document.createElement('canvas');
        binaryMaskCanvasRef.current.width = canvas.width;
        binaryMaskCanvasRef.current.height = canvas.height;
      }
      const binaryCtx = binaryMaskCanvasRef.current.getContext('2d');
      binaryCtx.clearRect(0, 0, canvas.width, canvas.height);
      // 假设后端返回的 mask 图像为二值图像（白色选区，黑色背景），直接复制到 binary mask canvas
      binaryCtx.drawImage(maskImg, 0, 0, canvas.width, canvas.height);
      // 对可视化 mask 进行处理，使其内部显示为半透明红、边缘标为明黄
      visualizeMask();
    };
    maskImg.src = URL.createObjectURL(blob);
  };

  // 可视化 mask：使用 maskCanvasRef 更新可视化效果（内部红透明、边缘黄）
  const visualizeMask = () => {
    if (!maskCanvasRef.current) return;
    const canvas = maskCanvasRef.current;
    const width = canvas.width;
    const height = canvas.height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    const interior = new Uint8ClampedArray(data);
    const edge = new Uint8ClampedArray(data.length);
    
    // 遍历每个像素，假设 mask 为二值图像（R > 200 表示选中）
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        if (data[idx] > 200) {
          let isEdge = false;
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
            edge[idx] = 255;
            edge[idx + 1] = 255;
            edge[idx + 2] = 0;
            edge[idx + 3] = 255;
            interior[idx + 3] = 0;
          } else {
            interior[idx] = 255;
            interior[idx + 1] = 0;
            interior[idx + 2] = 0;
            interior[idx + 3] = 150;
          }
        } else {
          interior[idx + 3] = 0;
          edge[idx + 3] = 0;
        }
      }
    }
    const visData = new Uint8ClampedArray(data.length);
    for (let i = 0; i < data.length; i += 4) {
      visData[i] = interior[i];
      visData[i + 1] = interior[i + 1];
      visData[i + 2] = interior[i + 2];
      visData[i + 3] = interior[i + 3];
      if (edge[i + 3] === 255) {
        visData[i] = edge[i];
        visData[i + 1] = edge[i + 1];
        visData[i + 2] = edge[i + 2];
        visData[i + 3] = edge[i + 3];
      }
    }
    const visImgData = new ImageData(visData, width, height);
    ctx.putImageData(visImgData, 0, 0);
    redrawComposite();
  };

  // 重绘主 canvas：先绘制原图，再叠加可视化 mask离屏层
  const redrawComposite = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (maskCanvasRef.current) {
      ctx.globalAlpha = 1;
      ctx.drawImage(maskCanvasRef.current, 0, 0, canvas.width, canvas.height);
    }
  };

  // 更新编辑：在 mask 离屏层上以当前 brushSize 在 (x,y) 绘制“增加”或“删除”选区效果
  // 同时更新 binary mask 数据（直接绘制纯白或纯黑，不做可视化处理）
  const updateMaskAt = (x, y) => {
    if (!maskCanvasRef.current || !binaryMaskCanvasRef.current) return;
    // 更新可视化 mask
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
    visualizeMask(); // 重绘可视化效果

    // 更新二值 mask：直接用 source-over 绘制（add：填充纯白，subtract：填充纯黑）
    const binaryCtx = binaryMaskCanvasRef.current.getContext('2d');
    binaryCtx.save();
    binaryCtx.globalCompositeOperation = 'source-over';
    if (editMode === 'add') {
      binaryCtx.fillStyle = 'white';
    } else if (editMode === 'subtract') {
      binaryCtx.fillStyle = 'black';
    }
    binaryCtx.beginPath();
    binaryCtx.arc(x, y, brushSize, 0, 2 * Math.PI);
    binaryCtx.fill();
    binaryCtx.restore();
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

  // 导出 mask：利用二值 mask canvas 将内容放大为原图尺寸后导出为标准黑白 mask 图像
  const exportMask = () => {
    if (!binaryMaskCanvasRef.current || !image) {
      alert('当前无可导出的 mask');
      return;
    }
    // 创建新画布，尺寸设为原图自然尺寸
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = image.width;
    exportCanvas.height = image.height;
    const exportCtx = exportCanvas.getContext('2d');
    // 将二值 mask canvas 按比例放大到原图尺寸
    exportCtx.drawImage(binaryMaskCanvasRef.current, 0, 0, image.width, image.height);
    // 对放大后的图像数据再次进行阈值处理，确保纯黑或纯白
    const imgData = exportCtx.getImageData(0, 0, image.width, image.height);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      // 直接根据 R 分量进行判断（因为二值 mask 已由纯白或纯黑构成）
      if (data[i] > 128) {
        data[i] = data[i+1] = data[i+2] = 255;
        data[i+3] = 255;
      } else {
        data[i] = data[i+1] = data[i+2] = 0;
        data[i+3] = 255;
      }
    }
    exportCtx.putImageData(imgData, 0, 0);
    const dataURL = exportCanvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataURL;
    link.download = 'edited_mask.png';
    link.click();
  };

  return (
    <div className="p-4 space-y-4 overflow-hidden" style={{ position: 'relative' }}>
      {/* 工具控制栏 */}
      <div className="flex items-center gap-4 flex-wrap">
        <button
          onClick={() => {
            // 切换为框选模式，重置编辑状态和框选区域
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

      {/* 主 Canvas 与自定义光标预览 */}
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

      {/* 运行预测按钮 */}
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


