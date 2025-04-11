import React, { useRef, useState, useEffect } from 'react';
import Toolbar from './components/Toolbar';
import CanvasLayers from './components/CanvasLayers';

// 工具函数
function distance(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

export default function ShadowPuppetTool() {
  const baseCanvasRef = useRef(null);
  const borderCanvasRef = useRef(null);
  const pointsCanvasRef = useRef(null);
  const maskCanvasRef = useRef(null);
  const binaryMaskCanvasRef = useRef(null);

  const [image, setImage] = useState(null);
  const [imageId, setImageId] = useState(null);
  const [box, setBox] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [editMode, setEditMode] = useState(null);
  const [brushSize, setBrushSize] = useState(10);
  const [cursorPos, setCursorPos] = useState(null);
  const [startPoint, setStartPoint] = useState(null);
  const [currentMaskId, setCurrentMaskId] = useState(null);
  const [maskCenters, setMaskCenters] = useState([]);
  const [selectedMaskId, setSelectedMaskId] = useState(null);
  const [showMasksMode, setShowMasksMode] = useState(false);

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
      if (!maskCanvasRef.current) {
        maskCanvasRef.current = document.createElement("canvas");
        maskCanvasRef.current.width = width;
        maskCanvasRef.current.height = height;
      }
      const maskCtx = maskCanvasRef.current.getContext("2d");
      maskCtx.clearRect(0, 0, width, height);
      maskCtx.drawImage(maskImg, 0, 0, width, height);

      if (!binaryMaskCanvasRef.current) {
        binaryMaskCanvasRef.current = document.createElement("canvas");
        binaryMaskCanvasRef.current.width = width;
        binaryMaskCanvasRef.current.height = height;
      }
      const binaryCtx = binaryMaskCanvasRef.current.getContext("2d");
      binaryCtx.clearRect(0, 0, width, height);
      binaryCtx.drawImage(maskImg, 0, 0, width, height);
      visualizeMask();
    };
    maskImg.src = URL.createObjectURL(blob);
  };

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
        const gray = data[idx];
        if (gray < threshold) {
          data[idx + 3] = 0;
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
            data[idx] = 255; data[idx + 1] = 255; data[idx + 2] = 0; data[idx + 3] = 255;
          } else {
            data[idx] = 255; data[idx + 1] = 0; data[idx + 2] = 0; data[idx + 3] = 150;
          }
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
    redrawBase();
  };

  const redrawBase = () => {
    const canvas = baseCanvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (maskCanvasRef.current) {
      ctx.drawImage(maskCanvasRef.current, 0, 0, canvas.width, canvas.height);
    }
  };

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
    binaryCtx.fillStyle = editMode === "add" ? "white" : "black";
    binaryCtx.beginPath();
    binaryCtx.arc(x, y, brushSize, 0, 2 * Math.PI);
    binaryCtx.fill();
    binaryCtx.restore();
  };

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

  const handleBoxSelect = () => {
    setEditMode(null);
    setBox(null);
    const ctx = baseCanvasRef.current.getContext("2d");
    ctx.clearRect(0, 0, baseCanvasRef.current.width, baseCanvasRef.current.height);
    if (image)
      ctx.drawImage(image, 0, 0, baseCanvasRef.current.width, baseCanvasRef.current.height);
  };

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
      await fetch("http://localhost:5000/api/save_mask", {
        method: "POST",
        body: formData,
      });
      alert("保存成功");
      fetchMaskCenters();
    }, "image/png");
  };

  const fetchMaskCenters = async () => {
    const res = await fetch("http://localhost:5000/api/mask_centers");
    const data = await res.json();
    if (data.mask_centers) {
      setMaskCenters(data.mask_centers);
    }
  };

  const redrawBorder = () => {
    const canvas = borderCanvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (selectedMaskId) {
      const mc = maskCenters.find(m => m.mask_id === selectedMaskId);
      if (mc?.largest_contour?.length > 0) {
        ctx.beginPath();
        const scale = canvas.scaleRatio;
        let [px, py] = mc.largest_contour[0];
        ctx.moveTo(px * scale, py * scale);
        mc.largest_contour.slice(1).forEach(([cx, cy]) =>
          ctx.lineTo(cx * scale, cy * scale)
        );
        ctx.closePath();
        ctx.lineWidth = 4;
        ctx.strokeStyle = "red";
        ctx.stroke();
      }
    }
  };

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

  const redrawOverlay = () => {
    redrawBase();
    redrawBorder();
    redrawPoints();
  };

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
    if (!found) setSelectedMaskId(null);
    redrawOverlay();
  };

  const handleShowMasks = async () => {
    await fetchMaskCenters();
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
    redrawBase();
    borderCanvasRef.current?.getContext("2d").clearRect(0, 0, borderCanvasRef.current.width, borderCanvasRef.current.height);
    pointsCanvasRef.current?.getContext("2d").clearRect(0, 0, pointsCanvasRef.current.width, pointsCanvasRef.current.height);
  };

  useEffect(() => {
    if (showMasksMode) {
      redrawOverlay();
    }
  }, [maskCenters, image, showMasksMode]);

  return (
    <div className="p-4" style={{ display: "flex" }}>
      <div style={{ flex: 1, position: "relative" }}>
        <Toolbar
          editMode={editMode}
          brushSize={brushSize}
          showMasksMode={showMasksMode}
          onSetEditMode={setEditMode}
          onSetBrushSize={setBrushSize}
          onBoxSelect={handleBoxSelect}
          onPredict={handlePredict}
          onSaveMask={saveMask}
          onShowMasks={handleShowMasks}
          onHideMasks={handleHideMasks}
        />
        <CanvasLayers
          baseCanvasRef={baseCanvasRef}
          borderCanvasRef={borderCanvasRef}
          pointsCanvasRef={pointsCanvasRef}
          showMasksMode={showMasksMode}
          handleMouseDown={handleMouseDown}
          handleMouseMove={handleMouseMove}
          handleMouseUp={handleMouseUp}
          handleCanvasClick={handleCanvasClick}
        />
        <div className="flex items-center gap-2 mt-2">
          <input type="file" accept="image/*" onChange={handleImageUpload} />
        </div>
      </div>
      <div style={{ marginLeft: "20px" }}></div>
    </div>
  );
}
