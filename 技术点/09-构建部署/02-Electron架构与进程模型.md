# Electron 架构与进程模型

> 理解 Electron 的进程架构是掌握构建的基础

---

## 一、Electron 是什么

Electron 是一个使用 Web 技术（HTML、CSS、JavaScript）构建跨平台桌面应用的框架。

```
┌─────────────────────────────────────────────────────────────┐
│                      Electron 应用                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐  │
│   │  Chromium   │  +  │   Node.js   │  +  │ Native APIs │  │
│   │  (渲染引擎)  │     │  (运行时)    │     │  (系统接口)  │  │
│   └─────────────┘     └─────────────┘     └─────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**核心组成**：
- **Chromium**：提供 Web 页面渲染能力
- **Node.js**：提供文件系统、网络等后端能力
- **Native APIs**：提供系统托盘、菜单、对话框、通知等原生能力

---

## 二、进程模型详解

### 2.1 多进程架构

Electron 继承了 Chromium 的多进程架构，这是理解 Electron 应用的关键：

```
┌─────────────────────────────────────────────────────────────────┐
│                         Electron 应用                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Main Process                          │   │
│  │                    (主进程 - 唯一)                        │   │
│  │                                                          │   │
│  │  • Node.js 完整访问权限                                   │   │
│  │  • 管理应用生命周期 (app)                                 │   │
│  │  • 创建/管理窗口 (BrowserWindow)                         │   │
│  │  • 系统级 API (Menu, Tray, Dialog, Notification...)     │   │
│  │  • 进程间通信中枢 (ipcMain)                              │   │
│  └──────────────┬───────────────────────┬───────────────────┘   │
│                 │ IPC                   │ IPC                   │
│                 ▼                       ▼                       │
│  ┌──────────────────────┐    ┌──────────────────────┐          │
│  │   Renderer Process   │    │   Renderer Process   │   ...    │
│  │   (渲染进程 1)        │    │   (渲染进程 2)        │          │
│  │                      │    │                      │          │
│  │  • Chromium 渲染引擎  │    │  • Chromium 渲染引擎  │          │
│  │  • 运行 Web 页面      │    │  • 运行 Web 页面      │          │
│  │  • 受限的 Node 访问   │    │  • 受限的 Node 访问   │          │
│  └──────────────────────┘    └──────────────────────┘          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Main 进程（主进程）

主进程是 Electron 应用的入口点，**有且只有一个**。

#### 职责

| 职责 | 说明 | 相关 API |
|------|------|----------|
| 应用生命周期 | 启动、退出、激活等事件 | `app` |
| 窗口管理 | 创建、销毁、控制窗口 | `BrowserWindow` |
| 系统集成 | 托盘、菜单、快捷键、对话框 | `Tray`, `Menu`, `dialog`, `globalShortcut` |
| IPC 通信 | 接收/响应渲染进程消息 | `ipcMain` |
| 原生模块 | 调用 C++ 扩展、系统 API | Node.js native modules |

#### 入口文件示例

```javascript
// main.js (或 src/main/index.js)
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

let mainWindow = null

// 应用生命周期
app.whenReady().then(() => {
  createWindow()
  
  // macOS 特殊处理：点击 dock 图标重新创建窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// 所有窗口关闭时退出（macOS 除外）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,    // 安全：隔离上下文
      nodeIntegration: false,    // 安全：禁用 Node
      sandbox: true              // 安全：启用沙箱
    }
  })
  
  // 开发环境加载 dev server，生产环境加载本地文件
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// IPC 处理
ipcMain.handle('get-app-version', () => {
  return app.getVersion()
})
```

#### 关键 API 速查

```javascript
// === app 模块：应用生命周期 ===
app.whenReady()              // Promise，应用就绪
app.quit()                   // 退出应用
app.getVersion()             // 获取版本号
app.getPath('userData')      // 获取用户数据目录
app.getPath('temp')          // 获取临时目录
app.requestSingleInstanceLock() // 单实例锁

// === BrowserWindow：窗口管理 ===
new BrowserWindow(options)   // 创建窗口
win.loadURL(url)             // 加载 URL
win.loadFile(path)           // 加载本地文件
win.show() / win.hide()      // 显示/隐藏
win.minimize() / win.maximize()
win.setFullScreen(true)
win.webContents              // 获取 webContents

// === 系统集成 ===
const { Menu, Tray, dialog, Notification, shell } = require('electron')
```

### 2.3 Renderer 进程（渲染进程）

每个 `BrowserWindow` 对应一个独立的渲染进程，运行 Web 页面。

#### 特点

| 特点 | 说明 |
|------|------|
| 独立进程 | 每个窗口一个进程，崩溃不影响其他窗口 |
| Web 环境 | 可使用所有 Web API（DOM、Canvas、WebGL 等） |
| 受限访问 | 默认不能直接访问 Node.js API |
| 通过 IPC 通信 | 需要通过 preload 与主进程交互 |

#### 与普通浏览器的区别

```
┌──────────────────────────────────────────────────────────────┐
│                    普通浏览器 vs Electron                     │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  普通浏览器:                                                  │
│  ┌─────────────┐                                             │
│  │  Web Page   │ ──X──> 文件系统、原生 API（被浏览器阻止）     │
│  └─────────────┘                                             │
│                                                              │
│  Electron:                                                   │
│  ┌─────────────┐      ┌──────────┐      ┌────────────────┐  │
│  │  Web Page   │ ───> │ Preload  │ ───> │ Main Process   │  │
│  │  (Renderer) │ IPC  │ (Bridge) │ IPC  │ (Full Node.js) │  │
│  └─────────────┘      └──────────┘      └────────────────┘  │
│                                              │               │
│                                              ▼               │
│                                    文件系统、原生 API ✓       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 2.4 Preload 脚本（安全桥梁）

Preload 是连接 Main 和 Renderer 的**安全桥梁**，这是 Electron 安全模型的核心。

#### 为什么需要 Preload

```
问题：渲染进程需要调用 Node.js API（如读取文件）

方案一：开启 nodeIntegration ❌ 危险！
  - 渲染进程可以执行任意 Node.js 代码
  - 如果加载恶意页面/脚本，可以完全控制用户电脑

方案二：使用 Preload + contextBridge ✓ 安全
  - Preload 有 Node.js 访问权限，但运行在隔离上下文
  - 只暴露明确定义的 API 给渲染进程
  - 最小权限原则
```

#### Preload 脚本示例

```javascript
// preload.js
const { contextBridge, ipcRenderer } = require('electron')

// 暴露安全的 API 到渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 获取应用版本
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // 打开文件对话框
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  
  // 保存文件
  saveFile: (content) => ipcRenderer.invoke('file:save', content),
  
  // 监听主进程消息
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update-available', (event, info) => callback(info))
  },
  
  // 移除监听器
  removeUpdateListener: () => {
    ipcRenderer.removeAllListeners('update-available')
  },
  
  // 获取平台信息
  platform: process.platform
})

// 不要这样做！暴露整个 ipcRenderer 是危险的
// contextBridge.exposeInMainWorld('ipc', ipcRenderer) ❌
```

#### 渲染进程使用

```javascript
// 在 React/Vue 组件中使用
async function handleClick() {
  // 通过 preload 暴露的 API 调用
  const version = await window.electronAPI.getVersion()
  console.log('App version:', version)
  
  // 打开文件
  const filePath = await window.electronAPI.openFile()
  if (filePath) {
    console.log('Selected:', filePath)
  }
}

// 监听主进程事件
useEffect(() => {
  window.electronAPI.onUpdateAvailable((info) => {
    console.log('Update available:', info.version)
  })
  
  return () => {
    window.electronAPI.removeUpdateListener()
  }
}, [])
```

#### Preload 的执行时机

```
┌─────────────────────────────────────────────────────────────┐
│                    Preload 执行时机                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 创建 BrowserWindow                                      │
│     │                                                       │
│  2. 开始加载页面                                             │
│     │                                                       │
│  3. ★ 执行 Preload 脚本 ★                                   │
│     │  - 可访问 Node.js API                                 │
│     │  - 可访问 DOM（但此时为空）                            │
│     │  - 使用 contextBridge 暴露 API                        │
│     │                                                       │
│  4. 页面 DOM 构建                                           │
│     │                                                       │
│  5. 页面脚本执行                                             │
│     │  - 只能访问 contextBridge 暴露的 API                  │
│     │  - 不能直接访问 Node.js                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、IPC 通信机制

IPC（Inter-Process Communication）是进程间通信的核心机制。

### 3.1 通信模式对比

| 模式 | 方向 | API | 特点 | 适用场景 |
|------|------|-----|------|----------|
| invoke/handle | Renderer → Main → Renderer | `invoke` / `handle` | Promise 返回，推荐 | 请求-响应 |
| send/on | Renderer → Main | `send` / `on` | 单向，无返回值 | 通知类消息 |
| send (to renderer) | Main → Renderer | `webContents.send` / `on` | 单向推送 | 主进程主动通知 |
| sendSync | Renderer → Main → Renderer | `sendSync` / `on` | 同步阻塞，**不推荐** | 特殊场景 |

### 3.2 invoke/handle 模式（推荐）

最常用的模式，基于 Promise，清晰且安全。

```javascript
// ========== 主进程 ==========
const { ipcMain, dialog } = require('electron')

// 注册处理器
ipcMain.handle('dialog:openFile', async (event, options) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: options?.filters || []
  })
  return result.filePaths[0] || null
})

ipcMain.handle('user:getData', async (event, userId) => {
  // 可以是异步操作
  const user = await database.getUser(userId)
  return user
})

// ========== Preload ==========
contextBridge.exposeInMainWorld('api', {
  openFile: (options) => ipcRenderer.invoke('dialog:openFile', options),
  getUserData: (id) => ipcRenderer.invoke('user:getData', id)
})

// ========== 渲染进程 ==========
const file = await window.api.openFile({ filters: [{ name: 'Text', extensions: ['txt'] }] })
const user = await window.api.getUserData(123)
```

### 3.3 主进程 → 渲染进程通信

```javascript
// ========== 主进程 ==========
function notifyRenderer(window, channel, data) {
  if (window && !window.isDestroyed()) {
    window.webContents.send(channel, data)
  }
}

// 发送更新进度
notifyRenderer(mainWindow, 'download-progress', { percent: 50 })

// 发送通知
notifyRenderer(mainWindow, 'notification', { 
  title: '下载完成', 
  body: '文件已保存' 
})

// ========== Preload ==========
contextBridge.exposeInMainWorld('api', {
  onDownloadProgress: (callback) => {
    const handler = (event, data) => callback(data)
    ipcRenderer.on('download-progress', handler)
    // 返回清理函数
    return () => ipcRenderer.removeListener('download-progress', handler)
  },
  
  onNotification: (callback) => {
    ipcRenderer.on('notification', (event, data) => callback(data))
  }
})

// ========== 渲染进程 ==========
useEffect(() => {
  const cleanup = window.api.onDownloadProgress((data) => {
    setProgress(data.percent)
  })
  return cleanup
}, [])
```

### 3.4 IPC 最佳实践

```javascript
// ✅ 好的实践

// 1. 使用类型安全的 channel 名称
const IPC_CHANNELS = {
  GET_VERSION: 'app:getVersion',
  OPEN_FILE: 'dialog:openFile',
  SAVE_FILE: 'file:save',
  UPDATE_AVAILABLE: 'update:available'
} as const

// 2. 统一的错误处理
ipcMain.handle('file:read', async (event, path) => {
  try {
    const content = await fs.promises.readFile(path, 'utf-8')
    return { success: true, data: content }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 3. 验证来源（安全考虑）
ipcMain.handle('sensitive:operation', async (event, data) => {
  // 验证请求来源
  const webContents = event.sender
  const url = webContents.getURL()
  
  if (!url.startsWith('file://') && !url.startsWith('http://localhost')) {
    throw new Error('Unauthorized')
  }
  
  // 执行操作...
})

// 4. 避免暴露过多 API
// ❌ 不好
contextBridge.exposeInMainWorld('electron', require('electron'))

// ✅ 好
contextBridge.exposeInMainWorld('api', {
  // 只暴露需要的功能
  openExternal: (url) => shell.openExternal(url)
})
```

### 3.5 通信性能与数据序列化

IPC 消息会经过序列化，需要注意：

```javascript
// 可传输的数据类型
// ✅ 支持
- 基本类型：string, number, boolean, null, undefined
- 对象和数组（会被 JSON 序列化）
- Buffer / Uint8Array
- Date（会转为 ISO string）
- Map / Set（Electron 12+ 支持）

// ❌ 不支持
- 函数
- Symbol
- DOM 元素
- 循环引用对象
- 类实例（会丢失方法）

// 大数据传输优化
// 方案1：分块传输
async function sendLargeData(data) {
  const chunks = splitIntoChunks(data, 1024 * 1024) // 1MB per chunk
  for (const chunk of chunks) {
    await ipcRenderer.invoke('data:chunk', chunk)
  }
  await ipcRenderer.invoke('data:complete')
}

// 方案2：使用 SharedArrayBuffer（需要特殊配置）
// 方案3：使用临时文件
```

---

## 四、安全模型

### 4.1 上下文隔离（contextIsolation）

**必须开启**，这是 Electron 安全的基石。

```javascript
// BrowserWindow 配置
new BrowserWindow({
  webPreferences: {
    contextIsolation: true,  // 必须为 true
  }
})
```

**工作原理**：

```
┌─────────────────────────────────────────────────────────────┐
│                 上下文隔离机制                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  contextIsolation: false ❌                                 │
│  ┌──────────────────────────────────────────┐              │
│  │          共享的 JavaScript 上下文          │              │
│  │  window.myAPI = ...    (Preload)         │              │
│  │  window.myAPI.xxx()    (Web Page)        │              │
│  │  ↓ 恶意脚本可以污染/替换 API               │              │
│  └──────────────────────────────────────────┘              │
│                                                             │
│  contextIsolation: true ✓                                  │
│  ┌─────────────────────┐   ┌─────────────────────┐         │
│  │   Preload Context   │   │   Web Page Context  │         │
│  │                     │   │                     │         │
│  │  Node.js 可用        │   │  只能访问           │         │
│  │  contextBridge 暴露  │──>│  暴露的 API         │         │
│  │                     │   │                     │         │
│  └─────────────────────┘   └─────────────────────┘         │
│         隔离的 JavaScript 上下文，互不干扰                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 沙箱模式（sandbox）

进一步限制 Preload 脚本的能力。

```javascript
new BrowserWindow({
  webPreferences: {
    sandbox: true,  // 启用沙箱
  }
})
```

| 设置 | Preload 能力 | 说明 |
|------|-------------|------|
| `sandbox: false` | 完整 Node.js | 可用 require、fs、child_process 等 |
| `sandbox: true` | 受限 Node.js | 只能用 electron 模块的部分 API |

```javascript
// sandbox: true 时的 Preload
const { contextBridge, ipcRenderer } = require('electron')

// ✅ 可用
contextBridge.exposeInMainWorld(...)
ipcRenderer.invoke(...)
ipcRenderer.on(...)

// ❌ 不可用
const fs = require('fs')        // Error: Cannot find module 'fs'
const { spawn } = require('child_process')  // Error
```

**推荐配置**：

```javascript
// 最安全的配置
new BrowserWindow({
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    preload: path.join(__dirname, 'preload.js')
  }
})
```

### 4.3 nodeIntegration（危险选项）

```javascript
// ❌ 危险配置 - 不要使用！
new BrowserWindow({
  webPreferences: {
    nodeIntegration: true,      // 允许渲染进程使用 Node.js
    contextIsolation: false,    // 通常会一起关闭
  }
})

// 渲染进程可以直接
const fs = require('fs')
fs.unlinkSync('/important/file')  // 删除任意文件！
require('child_process').exec('rm -rf /')  // 执行任意命令！
```

**何时可以考虑使用**：
- 本地工具类应用，不加载任何外部内容
- 完全信任的页面内容
- 旧项目迁移（应该逐步改造）

### 4.4 webSecurity 与 CSP

```javascript
// webSecurity 控制同源策略
new BrowserWindow({
  webPreferences: {
    webSecurity: true  // 默认 true，保持开启
  }
})

// webSecurity: false 的风险
// - 允许跨域请求
// - 允许加载 file:// 协议资源
// - 可能导致 XSS 攻击
```

**CSP（内容安全策略）配置**：

```html
<!-- 在 HTML 中设置 -->
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  connect-src 'self' https://api.example.com;
">
```

```javascript
// 或在主进程中设置
mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
  callback({
    responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': ["default-src 'self'"]
    }
  })
})
```

### 4.5 安全配置清单

```javascript
// ✅ 推荐的安全配置
const secureWindowOptions = {
  webPreferences: {
    // 核心安全设置
    contextIsolation: true,       // 隔离上下文
    nodeIntegration: false,       // 禁用 Node
    sandbox: true,                // 启用沙箱
    
    // 其他安全设置
    webSecurity: true,            // 启用同源策略
    allowRunningInsecureContent: false,  // 禁止 HTTPS 页面加载 HTTP 内容
    enableRemoteModule: false,    // 禁用 remote 模块（已废弃）
    
    // Preload 脚本
    preload: path.join(__dirname, 'preload.js')
  }
}

// 加载远程内容时的额外保护
if (loadingRemoteContent) {
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) {
      event.preventDefault()
    }
  })
  
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isTrustedUrl(url)) {
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })
}
```

---

## 五、Electron 版本管理

### 5.1 版本对应关系

Electron 绑定了特定版本的 Node.js 和 Chromium：

```bash
# 查看当前 Electron 的版本信息
npx electron --version
npx electron -p "process.versions"
```

常见版本对应（示例）：

| Electron | Node.js | Chromium | 发布时间 |
|----------|---------|----------|----------|
| 28.x | 18.18.x | 120 | 2023-12 |
| 27.x | 18.17.x | 118 | 2023-10 |
| 26.x | 18.16.x | 116 | 2023-08 |
| 25.x | 18.15.x | 114 | 2023-05 |

查看完整对应表：https://releases.electronjs.org/

### 5.2 版本升级影响评估

升级 Electron 前需要评估：

```
┌─────────────────────────────────────────────────────────────┐
│                   版本升级检查清单                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Breaking Changes                                        │
│     □ 查看 Release Notes                                    │
│     □ 废弃的 API                                            │
│     □ 行为变更                                              │
│                                                             │
│  2. Native Modules                                          │
│     □ 需要重新编译                                          │
│     □ ABI 版本是否兼容                                      │
│     □ 依赖是否支持新版本                                    │
│                                                             │
│  3. Node.js 版本变化                                        │
│     □ 语法特性差异                                          │
│     □ 内置模块变化                                          │
│     □ 依赖兼容性                                            │
│                                                             │
│  4. Chromium 版本变化                                       │
│     □ Web API 变化                                          │
│     □ 渲染行为变化                                          │
│     □ DevTools 变化                                         │
│                                                             │
│  5. 安全更新                                                │
│     □ 是否包含安全修复                                      │
│     □ 紧急程度                                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5.3 版本选择策略

```
                    Electron 版本选择
                    
┌─────────────────┬─────────────────┬─────────────────┐
│    生产项目      │    新项目       │    实验项目      │
├─────────────────┼─────────────────┼─────────────────┤
│                 │                 │                 │
│  稳定版本        │  最新稳定版     │  Beta/Alpha     │
│  (N-1 或 N-2)   │  (Latest)      │  (Canary)       │
│                 │                 │                 │
│  • 经过验证      │  • 新特性       │  • 最新特性      │
│  • 社区支持好    │  • 安全更新     │  • 可能不稳定    │
│  • 依赖兼容     │  • 性能改进     │  • API 可能变化  │
│                 │                 │                 │
└─────────────────┴─────────────────┴─────────────────┘

支持状态：
- Latest (最新稳定版): 完全支持
- Latest - 1: 仅安全更新
- Latest - 2: 仅关键安全更新
- 更早版本: 不再支持
```

**锁定版本的最佳实践**：

```json
// package.json
{
  "devDependencies": {
    "electron": "28.0.0"  // 使用精确版本，不用 ^
  }
}
```

```yaml
# .nvmrc 或 .node-version
18.18.0
```

---

## 六、进程间关系图总结

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Electron 应用架构全貌                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│    ┌─────────────────────────────────────────────────────────────┐     │
│    │                      Main Process                            │     │
│    │                                                              │     │
│    │   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │     │
│    │   │   app    │  │ ipcMain  │  │  Menu    │  │  Tray    │   │     │
│    │   └──────────┘  └────┬─────┘  └──────────┘  └──────────┘   │     │
│    │                      │                                      │     │
│    │   ┌──────────────────┴──────────────────┐                  │     │
│    │   │           BrowserWindow              │                  │     │
│    │   │  ┌─────────────────────────────┐    │                  │     │
│    │   │  │        webContents          │    │                  │     │
│    │   │  │   .send() / .loadURL()      │    │                  │     │
│    │   │  └─────────────┬───────────────┘    │                  │     │
│    │   └────────────────┼────────────────────┘                  │     │
│    │                    │ IPC                                    │     │
│    └────────────────────┼────────────────────────────────────────┘     │
│                         │                                               │
│    ┌────────────────────┼────────────────────────────────────────┐     │
│    │                    ▼                                         │     │
│    │   ┌─────────────────────────────────────────────────────┐   │     │
│    │   │                  Preload Script                      │   │     │
│    │   │                                                      │   │     │
│    │   │   contextBridge.exposeInMainWorld('api', {...})     │   │     │
│    │   │                                                      │   │     │
│    │   └──────────────────────┬──────────────────────────────┘   │     │
│    │                          │ contextBridge                     │     │
│    │                          ▼                                   │     │
│    │   ┌─────────────────────────────────────────────────────┐   │     │
│    │   │                 Renderer Process                     │   │     │
│    │   │                                                      │   │     │
│    │   │   window.api.xxx()   (只能访问暴露的 API)            │   │     │
│    │   │                                                      │   │     │
│    │   │   ┌───────────────────────────────────────────┐     │   │     │
│    │   │   │              Web Page                      │     │   │     │
│    │   │   │   HTML + CSS + JavaScript (React/Vue)     │     │   │     │
│    │   │   └───────────────────────────────────────────┘     │   │     │
│    │   │                                                      │   │     │
│    │   └─────────────────────────────────────────────────────┘   │     │
│    │                                                              │     │
│    │                      Renderer Process                        │     │
│    └──────────────────────────────────────────────────────────────┘     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 七、对构建的影响

理解进程模型对构建配置的影响：

| 模块 | 运行环境 | 构建目标 | 打包位置 |
|------|----------|----------|----------|
| main.js | Main 进程 | Node.js | app.asar 内 |
| preload.js | Preload | Node.js（受限） | app.asar 内 |
| renderer/ | Renderer | 浏览器 | app.asar 内或独立 |
| native modules | Main 进程 | Node.js | app.asar.unpacked |

**构建配置要点**：

```javascript
// vite.config.js (主进程)
export default {
  build: {
    target: 'node18',           // Node.js 环境
    lib: {
      entry: 'src/main/index.ts',
      formats: ['cjs']          // CommonJS
    },
    rollupOptions: {
      external: ['electron']    // 不打包 electron
    }
  }
}

// vite.config.js (渲染进程)
export default {
  base: './',                   // 相对路径，适配 file://
  build: {
    target: 'chrome120',        // 浏览器环境
    outDir: 'dist/renderer'
  }
}
```

---

## 参考资源

- [Electron 进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron 安全最佳实践](https://www.electronjs.org/docs/latest/tutorial/security)
- [Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [IPC 通信](https://www.electronjs.org/docs/latest/tutorial/ipc)
