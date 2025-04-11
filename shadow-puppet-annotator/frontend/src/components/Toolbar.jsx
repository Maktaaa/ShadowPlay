// components/Toolbar.jsx
import React from 'react';

export default function Toolbar({
  editMode,
  brushSize,
  showMasksMode,
  onSetEditMode,
  onSetBrushSize,
  onBoxSelect,
  onPredict,
  onSaveMask,
  onShowMasks,
  onHideMasks
}) {
  return (
    <>
      {/* 编辑工具栏 */}
      <div className="flex items-center gap-2 mb-2">
        <button onClick={() => onSetEditMode("add")}
          className="px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600">
          增加选区
        </button>
        <button onClick={() => onSetEditMode("subtract")}
          className="px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600">
          删除选区
        </button>
        <button onClick={() => onSetEditMode(null)}
          className="px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600">
          退出编辑
        </button>
        <label className="text-sm text-gray-700">
          笔刷大小:
          <input
            type="range"
            min="1"
            max="50"
            value={brushSize}
            onChange={(e) => onSetBrushSize(Number(e.target.value))}
            className="ml-2"
          />
        </label>
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={onBoxSelect}
          className="px-2 py-1 bg-blue-400 text-white rounded hover:bg-blue-500">
          框选
        </button>
        <button
          onClick={onPredict}
          className="px-2 py-1 bg-cyan-500 text-white rounded hover:bg-cyan-600">
          运行预测
        </button>
        <button
          onClick={onSaveMask}
          className="px-2 py-1 bg-purple-500 text-white rounded hover:bg-purple-600">
          保存 mask
        </button>
        {!showMasksMode ? (
          <button
            onClick={onShowMasks}
            className="px-2 py-1 bg-indigo-500 text-white rounded hover:bg-indigo-600">
            Show Masks
          </button>
        ) : (
          <button
            onClick={onHideMasks}
            className="px-2 py-1 bg-indigo-500 text-white rounded hover:bg-indigo-600">
            Hide Masks
          </button>
        )}
      </div>
    </>
  );
}
