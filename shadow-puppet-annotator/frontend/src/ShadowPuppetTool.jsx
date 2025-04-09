// Shadow Puppet Tool – 已修复 scaleRatio 放置位置并整理 box 传递逻辑
import React, { useRef, useState, useEffect } from 'react';

export default function ShadowPuppetTool() {
  const canvasRef = useRef(null);
  const [image, setImage] = useState(null);
  const [imageId, setImageId] = useState(null);
  const [startPoint, setStartPoint] = useState(null);
  const [box, setBox] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  const resizeCanvasToFit = (img) => {
    const canvas = canvasRef.current;
    const container = canvas.parentElement;
    const maxHeight = window.innerHeight - 200;
    const scale = Math.min(container.clientWidth / img.width, maxHeight / img.height);
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    canvas.scaleRatio = scale;
    const ctx = canvas.getContext('2d');
    console.log('🎯 Drawing image on canvas:', canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    setImage(img);
  };

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
    img.onload = () => {
      console.log('✅ Image loaded:', img.width, img.height);
      resizeCanvasToFit(img);
    };
    img.onerror = () => console.error('❌ Failed to load image');
    img.src = `http://localhost:5000/uploads/${data.image_id}.png`;
  };

  const handleMouseDown = (e) => {
    if (!image) return;
    const rect = canvasRef.current.getBoundingClientRect();
    setStartPoint({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setIsDragging(true);
  };

  const handleMouseMove = (e) => {
    if (!isDragging || !startPoint || !image) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 2;
    ctx.strokeRect(
      Math.min(startPoint.x, currentX),
      Math.min(startPoint.y, currentY),
      Math.abs(currentX - startPoint.x),
      Math.abs(currentY - startPoint.y)
    );
  };

  const handleMouseUp = (e) => {
    if (!startPoint) return;
    setIsDragging(false);
    const rect = canvasRef.current.getBoundingClientRect();
    const endX = e.clientX - rect.left;
    const endY = e.clientY - rect.top;
    const newBox = [
      Math.min(startPoint.x, endX),
      Math.min(startPoint.y, endY),
      Math.max(startPoint.x, endX),
      Math.max(startPoint.y, endY)
    ];
    setBox(newBox);
    setStartPoint(null);
  };

  const handlePredict = async () => {
    if (!imageId || !box) return alert('请先上传图片并拖拽框选区域');
    const scale = canvasRef.current.scaleRatio;
    const scaledBox = box.map(coord => coord / scale);

    const res = await fetch('http://localhost:5000/api/sam', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_path: `backend/uploads/${imageId}.png`, box: scaledBox }),
    });
    const blob = await res.blob();
    const maskImg = new Image();
    maskImg.onload = () => {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = canvas.width;
      maskCanvas.height = canvas.height;
      const maskCtx = maskCanvas.getContext('2d');
      maskCtx.drawImage(maskImg, 0, 0, canvas.width, canvas.height);

      const imageData = maskCtx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 0) {
          data[i] = 255;
          data[i + 1] = 0;
          data[i + 2] = 0;
          data[i + 3] = 100;
        } else {
          data[i + 3] = 0;
        }
      }
      maskCtx.putImageData(imageData, 0, 0);
      ctx.drawImage(maskCanvas, 0, 0);
      ctx.strokeStyle = 'black';
      ctx.lineWidth = 2;
      ctx.strokeRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
    };
    maskImg.src = URL.createObjectURL(blob);
  };

  return (
    <div className="p-4 space-y-4 overflow-hidden">
      <input type="file" accept="image/*" onChange={handleImageUpload} />
      <canvas
        ref={canvasRef}
        className="border max-w-full h-auto max-h-screen"
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
      />
      <button
        onClick={handlePredict}
        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
      >
        运行预测
      </button>
    </div>
  );
}


