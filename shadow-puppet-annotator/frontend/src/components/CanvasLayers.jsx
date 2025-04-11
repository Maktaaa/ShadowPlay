// components/CanvasLayers.jsx
import React from 'react';

export default function CanvasLayers({
  baseCanvasRef,
  borderCanvasRef,
  pointsCanvasRef,
  showMasksMode,
  handleMouseDown,
  handleMouseMove,
  handleMouseUp,
  handleCanvasClick
}) {
  return (
    <div style={{ position: "relative" }}>
      {/* 底层 Canvas */}
      <canvas
        ref={baseCanvasRef}
        className="border max-w-full h-auto max-h-screen"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      />
      {/* 中间层 Canvas */}
      <canvas
        ref={borderCanvasRef}
        style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
      />
      {/* 顶层 Canvas */}
      <canvas
        ref={pointsCanvasRef}
        style={{ position: "absolute", top: 0, left: 0, pointerEvents: showMasksMode ? "auto" : "none" }}
        onClick={showMasksMode ? handleCanvasClick : undefined}
      />
    </div>
  );
}
