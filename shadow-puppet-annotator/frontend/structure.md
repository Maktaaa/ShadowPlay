frontend/                           # 项目根目录
├── node_modules/                   # Node.js 依赖包，自动生成，勿手动修改
├── public/
│   └── favicon.ico                 # 网站图标文件（此处仅示例，可能还有其他静态资源）
├── src/                            # 前端源代码目录
│   ├── assets/                     # 静态资源目录（图像、SVG 等）
│   │   └── react.svg               # React 图标示例文件
│   ├── components/
│   │   ├── CanvasLayers.jsx         # 画布展示组件，保持不变
│   │   ├── Toolbar.jsx              # 工具栏组件，保持不变
│   │   └── ShadowPuppetTool.jsx     # 重构后的容器组件：主要管理整体状态和调用 Hook
│   ├── hooks/                       # 新增：自定义 Hooks，用于拆分 ShadowPuppetTool.jsx 内部逻辑
│   │   ├── useCanvasController.js   # 画布控制与重绘逻辑 (可包含 resize、redrawBase、visualizeMask 等)
│   │   ├── useCanvasEvents.js       # 画布鼠标事件逻辑 (handleMouseDown/Move/Up/Click 等)
│   │   └── useApi.js                # (可选) 封装图片上传、mask 预测、保存、获取等 API 调用
│   ├── App.css                     # App.jsx 对应的全局样式
│   ├── App.jsx                     # 根组件示例，可能包含路由或全局布局
│   ├── index.css                   # 全局样式文件，通常用于重置或基础样式定义
│   ├── main.jsx                    # 入口文件，将 React 根组件挂载到页面
│   ├── ShadowPuppetTool.jsx        # 当前的主要逻辑组件，集成画布、事件和图像处理逻辑
│   └── structure.md                # 项目结构描述文件（你提供的文档示例）
├── .gitignore                      # Git 忽略文件配置
├── eslint.config.js                # ESLint 配置，用于代码规范检查
├── index.html                      # 前端单页面入口模版
├── package-lock.json               # npm 自动生成的锁定文件，用于锁定依赖版本
├── package.json                    # 项目依赖配置，脚本命令等
├── postcss.config.js               # PostCSS 配置文件，配合 TailwindCSS 等工具使用
├── README.md                       # 项目说明文档
├── tailwind.config.js             # TailwindCSS 配置文件
└──  vite.config.js                  # Vite 构建工具配置文件