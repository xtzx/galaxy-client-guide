# Electron IPC 通信机制详解

> 本文档详细分析 galaxy-client 项目中 Electron IPC 通信机制的设计、运行流程、涉及场景和调试方法。

---

## 一、Electron IPC 概述

### 1.1 什么是 Electron IPC

Electron 应用由两类进程组成：主进程（Main Process）和渲染进程（Renderer Process）。主进程运行 Node.js，拥有完整的系统访问能力；渲染进程运行 Chromium，负责 UI 渲染。两者之间通过 IPC（Inter-Process Communication）通道进行数据交换。

在 galaxy-client 中，Electron IPC 主要用于以下职责：

- 渲染进程向主进程请求系统级操作（文件读写、打开外部链接、获取配置等）
- 主进程向渲染进程推送状态变更（更新进度、登出通知、协议唤醒等）
- 预加载脚本（Preload）中桥接渲染进程与主进程的 API 调用

### 1.2 技术选型

galaxy-client 使用了两种 Electron IPC 实现：

| 实现方式 | 库/API | 使用位置 | 特点 |
|---------|--------|---------|------|
| electron-better-ipc | 第三方库 | 主进程 event/ipc.js、event/updater.js | 简化 API，支持 `ipc.on`、`ipc.answerRenderer`、`ipc.handle` |
| 原生 ipcMain/ipcRenderer | Electron 内置 | preload、renderer、window.js | 最基础的 IPC API |

`electron-better-ipc` 是对原生 IPC 的封装，提供了更友好的请求-响应模式。在 galaxy-client 中，大部分 IPC 通道使用 `electron-better-ipc` 注册。

### 1.3 IPC 在整体架构中的位置

```
┌─────────────────────────┐
│     渲染进程 (Chromium)   │
│                          │
│  ┌────────────────────┐  │
│  │ inject.js (preload)│  │
│  │ - window.require   │  │
│  │ - ipcRenderer      │  │
│  └────────┬───────────┘  │
│           │              │
│  ┌────────▼───────────┐  │
│  │ 通宝 Web 应用      │  │
│  │ (通过 window.      │  │
│  │  require 调用 IPC) │  │
│  └────────────────────┘  │
└───────────┬──────────────┘
            │ Electron IPC
            │ (ipcMain ↔ ipcRenderer)
┌───────────▼──────────────┐
│     主进程 (Node.js)      │
│                          │
│  ┌────────────────────┐  │
│  │ event/ipc.js       │  │
│  │ - ipc.on / handle  │  │
│  │ - ipc.answer...    │  │
│  └────────────────────┘  │
│                          │
│  ┌────────────────────┐  │
│  │ event/updater.js   │  │
│  │ - 更新相关 IPC     │  │
│  └────────────────────┘  │
│                          │
│  ┌────────────────────┐  │
│  │ utils.js           │  │
│  │ - sendToRenderMsg  │  │
│  └────────────────────┘  │
└──────────────────────────┘
```

---

## 二、IPC 通道注册与初始化

### 2.1 初始化时机

IPC 通道在应用启动的 `bootstrap()` 阶段注册，由 `addIpcEvent()` 函数完成。这个函数在 `electron.js` 中被调用，时机在 `app.ready` 事件之后、窗口创建之前。

```
app.on('ready')
    → bootstrap()
        → addAppEvent()      ← 应用事件
        → addIpcEvent()      ← IPC 通道注册（此处）
        → addStoreEvent()    ← Store 监听
        → AppStart.run()     ← 业务启动
```

这个初始化顺序确保了：当窗口创建并加载页面后，所有 IPC 通道已经就绪，渲染进程可以立即开始通信。

### 2.2 注册文件分布

IPC 通道的注册分布在以下文件中：

| 文件 | 注册数量 | 职责范围 |
|------|---------|---------|
| `src/event/ipc.js` | 约 35 个 | 核心业务 IPC（文件、配置、注入、账号等） |
| `src/event/updater.js` | 4 个 | 自动更新相关 IPC |
| `src/init/window.js` | 间接（通过 sendToRenderMsg） | 窗口事件通知 |

### 2.3 三种注册方式

**方式一：ipc.on（事件监听）**

这是最基本的监听方式。渲染进程发送消息后，主进程执行处理逻辑，不自动返回结果。如果需要回传数据，必须手动调用 `sendToRenderMsg()` 或 `event.returnValue`。

适用场景：
- 触发型操作（启动注入、停止进程、打开链接等）
- 需要手动回传数据的操作（获取文件路径、CAS 自动补全等）
- 同步返回简单数据的操作（获取应用配置 `get-app-config` 使用 `event.returnValue`）

**方式二：ipc.answerRenderer（请求-响应）**

`electron-better-ipc` 提供的便捷方式。渲染进程发送请求后，主进程处理并返回 Promise 结果，渲染进程自动接收返回值。

适用场景：
- 需要返回值的操作（检查文件是否存在、复制文件、获取 WebSocket 端口等）
- 需要异步等待结果的操作（跨域请求、打开对话框等）

**方式三：ipc.handle（异步处理）**

Electron 原生的 `ipcMain.handle` 方式，通过 `ipcRenderer.invoke` 调用。返回 Promise。

适用场景：
- 异步操作（读取文件为 Base64、检查账号是否登录等）
- 需要明确的 async/await 语义的操作

---

## 三、完整 IPC 通道清单

### 3.1 核心业务 IPC（event/ipc.js）

以下是所有在 `event/ipc.js` 中注册的 IPC 通道，按功能分类：

#### 3.1.1 用户认证类

| 通道名 | 注册方式 | 方向 | 功能描述 |
|--------|---------|------|---------|
| `userLogin` | ipc.on | 渲染→主 | 员工重新登录。接收到此消息后，主进程会调用 `getLoadUrlAsync()` 获取登录 URL，然后让主窗口加载该 URL。用于从错误页或已登出状态恢复登录。 |
| `userLogout` | ipc.on | 渲染→主 | 员工退出登录。清除 CASTGC cookie（CAS 认证凭证），调用 `store.clearUserId()` 清空持久化的用户 ID，然后重新加载登录 URL。 |
| `set-user-info` | ipc.on | 渲染→主 | 保存用户信息。前端登录成功后，将用户信息（姓名、ID 等）传递给主进程持久化到 electron-store。 |
| `cas-auto-complete-info` | ipc.on | 渲染→主 | CAS 登录自动填充。渲染进程请求 CAS 自动补全信息，主进程从 store 读取已保存的自动补全数据，通过 `sendToRenderMsg` 回传给渲染进程。 |

#### 3.1.2 进程管理类

| 通道名 | 注册方式 | 方向 | 功能描述 |
|--------|---------|------|---------|
| `runInject` | ipc.on | 渲染→主 | 启动微信逆向注入。调用 `inject.runInject()` 启动 BasicService.exe，开始微信 DLL 注入流程。 |
| `runQyWxInject` | ipc.on | 渲染→主 | 启动企业微信逆向注入。可带 `accountId` 参数指定要注入的企微账号。调用 `inject.runQyWxInject(accountId)`。 |
| `stop-java` | ipc.on | 渲染→主 | 停止 Java 辅助进程。调用 `inject.stopJava()`。 |
| `stop-wxwork` | ipc.on | 渲染→主 | 停止企业微信进程。调用 `inject.stopWxwork()`。 |
| `stop-wechat` | ipc.on | 渲染→主 | 停止微信进程。调用 `inject.stopWeChat()`。 |
| `stopBsInject` | ipc.on | 渲染→主 | 停止 BasicService 注入（32 位）。调用 `inject.stopBasicService()`。 |
| `stopBs64Inject` | ipc.on | 渲染→主 | 停止 BasicService 注入（64 位）。调用 `inject.stopBasicService64()`。 |

#### 3.1.3 文件操作类

| 通道名 | 注册方式 | 方向 | 功能描述 |
|--------|---------|------|---------|
| `get-file-path` | ipc.on | 渲染→主 | 获取剪贴板中的文件路径。主进程读取剪贴板内容，提取文件名列表，通过 `sendToRenderMsg('get-file-names', paths)` 回传。 |
| `get-file-entity` | ipc.on | 渲染→主 | 获取文件摘要信息（大小、MD5 等）。主进程调用 `getFileEntity()` 计算文件属性，通过 `sendToRenderMsg('get-file-entity', result)` 回传。 |
| `exist-file` | ipc.answerRenderer | 渲染→主→渲染 | 检查本地文件是否存在。返回布尔值。 |
| `copy-file` | ipc.answerRenderer | 渲染→主→渲染 | 将指定文件复制到临时目录。返回临时文件路径。 |
| `convert-base64-to-file` | ipc.answerRenderer | 渲染→主→渲染 | 将 Base64 编码的数据转为本地文件。返回文件路径。 |
| `convert-urls-to-files` | ipc.answerRenderer | 渲染→主→渲染 | 将 URL 列表下载为本地文件。返回文件路径数组。 |
| `readFileAsBase64` | ipc.handle | 渲染→主→渲染 | 读取本地文件并返回 Base64 编码内容。 |
| `open-file` | ipc.on | 渲染→主 | 使用系统默认应用打开本地文件。调用 `shell.openPath()`。 |
| `open-dialog` | ipc.answerRenderer | 渲染→主→渲染 | 打开系统文件选择对话框。返回选中的文件路径。 |

#### 3.1.4 配置与环境类

| 通道名 | 注册方式 | 方向 | 功能描述 |
|--------|---------|------|---------|
| `get-app-config` | ipc.on | 渲染→主 | 获取运行时配置。使用 `event.returnValue` 同步返回配置对象（包含 mode、type、version 等）。这是一个同步 IPC 调用，渲染进程会阻塞等待结果。 |
| `set-env-settings` | ipc.on | 渲染→主 | 设置环境配置。前端可以修改某些运行时环境参数，主进程将其保存到 electron-store。 |
| `get-env-settings` | ipc.handle | 渲染→主→渲染 | 异步获取环境配置。 |
| `set-is-gray` | ipc.on | 渲染→主 | 设置是否为体验版（灰度版）。主进程将标记保存到 store。 |
| `get-is-gray` | ipc.on | 渲染→主 | 获取是否为体验版。通过 `event.returnValue` 同步返回。 |
| `set-modules` | ipc.on | 渲染→主 | 设置模块配置。用于动态启用/禁用某些功能模块。 |
| `get-ws-port` | ipc.answerRenderer | 渲染→主→渲染 | 获取 WebSocket 服务端口。仅在 Windows 平台返回端口号，其他平台返回空。这个通道是 Electron IPC 与 WebSocket 通信机制的桥梁。 |

#### 3.1.5 应用控制类

| 通道名 | 注册方式 | 方向 | 功能描述 |
|--------|---------|------|---------|
| `open-url` | ipc.on | 渲染→主 | 用系统默认浏览器打开 URL。调用 `shell.openExternal(url)`。 |
| `app-relaunch` | ipc.on | 渲染→主 | 重启应用。调用 `app.relaunch()` 然后 `app.exit(0)`。 |
| `app-exit` | ipc.on | 渲染→主 | 退出应用。直接调用 `app.exit(0)`。 |

#### 3.1.6 系统信息类

| 通道名 | 注册方式 | 方向 | 功能描述 |
|--------|---------|------|---------|
| `get-app-metrics` | ipc.answerRenderer | 渲染→主→渲染 | 获取应用性能指标。调用 `app.getAppMetrics()` 返回各进程的 CPU、内存使用情况。 |
| `get-window-ip` | ipc.answerRenderer | 渲染→主→渲染 | 获取本机 IP 地址。 |
| `cross-origin-request` | ipc.answerRenderer | 渲染→主→渲染 | 执行跨域 GET 请求。由于渲染进程受同源策略限制，通过主进程（Node.js）转发 HTTP 请求。使用 axios.get 实现。 |

#### 3.1.7 Cookie 与账号类

| 通道名 | 注册方式 | 方向 | 功能描述 |
|--------|---------|------|---------|
| `writeUqunCookie` | ipc.on | 渲染→主 | 写入 U 群 cookie。通过 `session.defaultSession.cookies.set()` 将 cookie 写入 Electron 会话。 |
| `writeGidCookie` | ipc.on | 渲染→主 | 写入 GID cookie。GID 是设备唯一标识，写入 cookie 后前端 Web 应用可以使用。 |
| `addLocalAccount` | ipc.on | 渲染→主 | 添加本地企微账号。调用 `backupLoginFile()` 备份企微登录信息到本地。 |
| `getLocalAccounts` | ipc.on | 渲染→主 | 获取本地已保存的企微账号列表。通过 `sendToRenderMsg('get-local-accounts-notify', accounts)` 回传。 |
| `hasLoginedAccount` | ipc.handle | 渲染→主→渲染 | 检查是否有已登录的企微账号。 |

#### 3.1.8 方舟相关（预留）

| 通道名 | 注册方式 | 方向 | 功能描述 |
|--------|---------|------|---------|
| `startFangzhou` | ipc.handle | 渲染→主→渲染 | 启动方舟。当前实现直接返回 `false`，为预留接口。 |
| `hasFangzhouStarted` | ipc.handle | 渲染→主→渲染 | 检查方舟是否已启动。当前直接返回 `false`。 |

### 3.2 更新相关 IPC（event/updater.js）

| 通道名 | 注册方式 | 方向 | 功能描述 |
|--------|---------|------|---------|
| `setUpdateUrl` | ipc.on | 渲染→主 | 设置更新 Feed URL。前端传入更新服务器地址，主进程用该地址检查新版本。 |
| `checkForUpdate` | ipc.on | 渲染→主 | 触发检查更新。主进程使用 electron-updater 检查是否有新版本。 |
| `checkDownloadFile` | ipc.on | 渲染→主 | 下载更新文件。主进程下载更新包并解压。 |
| `checkJava` | ipc.on | 渲染→主 | 检查 Java/微信进程状态，决定是否安装更新。如果 Java 或微信进程仍在运行，需要先等待它们退出。 |

### 3.3 主进程 → 渲染进程通知

这些不是注册的 IPC 通道，而是主进程主动向渲染进程发送的消息。通过 `sendToRenderMsg(channel, data)` 实现，底层调用 `mainWindow.webContents.send(channel, data)`。

| 通道名 | 触发来源 | 功能描述 |
|--------|---------|---------|
| `get-file-names` | event/ipc.js | 返回剪贴板中的文件路径列表 |
| `cas-auto-complete-info` | event/ipc.js | 返回 CAS 自动补全信息 |
| `get-file-entity` | event/ipc.js | 返回文件摘要信息 |
| `get-local-accounts-notify` | event/ipc.js | 返回本地企微账号列表 |
| `web-awaken` | event/app.js | 协议唤醒通知。当用户通过自定义协议（如 `emailPrefix://xxx`）打开应用时，主进程将协议 URL 传递给渲染进程处理。 |
| `set-dev-buttons-visible` | init/window.js | 控制开发工具按钮的显示/隐藏。在测试环境下显示。 |
| `ws-kill-java-only` | init/window.js | 通知前端需要关闭 Java 进程。在窗口关闭确认后触发。 |
| `logout-notify` | init/window.js | 登出通知。在窗口关闭时通知前端当前正在登出。 |
| `wsKillJava` | event/updater.js | 更新前通知前端关闭 Java 进程。 |
| `killJavaFail` | event/updater.js | 关闭 Java 进程失败的通知。 |
| `updateError` | event/extractZip.js, downloadFile.js | 更新错误通知。 |
| `updateStart` | event/downloadFile.js | 开始更新下载的通知。 |
| `update-downloaded` | event/downloadFile.js | 更新包下载完成的通知。 |
| `downloadProgress` | event/downloadFile.js | 下载进度通知。包含已下载大小、总大小、速度等。 |

---

## 四、预加载脚本（Preload）机制

### 4.1 主窗口预加载脚本

galaxy-client 的主窗口使用自定义的预加载脚本，路径为 `extraResources/load/inject.js`（注意项目中目录名有拼写错误 `extraResoources`）。

这个预加载脚本的核心职责：

**暴露 Node.js 能力**

预加载脚本在渲染进程中运行，但拥有对 Node.js API 的访问权限。它将以下对象注入到 `window` 全局对象中：

- `window.require`：Node.js 的 require 函数。这使得远程加载的通宝 Web 应用可以在渲染进程中直接使用 Node.js 模块（如 `ipcRenderer`、`path` 等）。
- `window.eleRemote`：Electron remote 模块的引用。
- `window.preloadPath`：预加载脚本的路径。
- `window.preloadWebviewPath`：WebView 预加载脚本的路径。

**CAS 登录自动补全**

预加载脚本中包含一个定时逻辑：每隔一定时间向主进程发送 `cas-auto-complete-info` 消息，请求 CAS 登录自动补全信息。当主进程返回信息后，预加载脚本将用户名填入登录页面的表单中。

**错误页面处理**

当页面加载失败（如网络断开），预加载脚本会检测页面是否为错误页面。如果检测到 `error` 或 `获取人员登陆信息失败` 字样，会自动触发 `userLogout` IPC 事件，重新加载登录页面。

### 4.2 WebView 预加载脚本

对于嵌入的 WebView 页面（如企业微信的内嵌页面），使用另一个预加载脚本 `extraResources/load/webviewPreload.js`。

这个脚本使用 Electron 推荐的 `contextBridge` 方式暴露 API：

- 通过 `contextBridge.exposeInMainWorld('electronAPI', { ... })` 安全地暴露有限的 API
- 目前只暴露了 `readFileAsBase64(filePath)` 方法
- 该方法通过 `ipcRenderer.invoke('readFileAsBase64', filePath)` 调用主进程读取文件

这种设计遵循了最小权限原则——WebView 中的页面只能访问被明确暴露的 API，无法直接访问 Node.js 或 Electron 的其他能力。

### 4.3 两种预加载方式的对比

| 特性 | 主窗口 inject.js | WebView webviewPreload.js |
|-----|-----------------|--------------------------|
| API 暴露方式 | 直接挂载到 window | contextBridge |
| 安全性 | 较低（暴露了 require） | 较高（最小权限） |
| 可用 API | 完整的 Node.js | 仅 readFileAsBase64 |
| 适用场景 | 自有 Web 应用（通宝） | 第三方嵌入页面 |

---

## 五、IPC 数据流分析

### 5.1 同步 IPC 流（event.returnValue）

```
渲染进程                           主进程
   │                                │
   │  ipcRenderer.sendSync          │
   │  ('get-app-config')            │
   │  ─────────────────────────►    │
   │                                │  构建配置对象 {
   │                                │    mode, type, version,
   │                                │    appMetrics, gid, hostname,
   │  event.returnValue = config    │    windowIp, isGray
   │  ◄─────────────────────────    │  }
   │                                │
   │  直接拿到返回值                  │
   ▼                                ▼
```

同步 IPC 的特点是渲染进程会阻塞等待主进程返回。在 galaxy-client 中，只有 `get-app-config`、`get-is-gray` 使用了同步方式。这些配置数据在页面初始化时需要立即使用，所以采用同步方式避免异步等待。

但同步 IPC 有性能风险——如果主进程处理时间过长，渲染进程的 UI 会冻结。因此应仅用于快速、简单的数据读取。

### 5.2 异步请求-响应流（ipc.answerRenderer）

```
渲染进程                           主进程
   │                                │
   │  ipc.callMain                  │
   │  ('exist-file', filePath)      │
   │  ─────────────────────────►    │
   │                                │  fs.existsSync(filePath)
   │  Promise<boolean>              │
   │  ◄─────────────────────────    │  return true/false
   │                                │
   │  .then(exists => { ... })      │
   ▼                                ▼
```

`ipc.answerRenderer` 在主进程中注册一个 handler，当渲染进程调用 `ipc.callMain(channel, data)` 时，handler 的返回值会自动作为 Promise 的结果回传给渲染进程。

### 5.3 事件通知流（ipc.on + sendToRenderMsg）

```
渲染进程                           主进程
   │                                │
   │  ipcRenderer.send              │
   │  ('get-file-path')             │
   │  ─────────────────────────►    │
   │                                │  读取剪贴板文件
   │                                │  提取文件路径
   │                                │
   │  ipcRenderer.on                │  sendToRenderMsg(
   │  ('get-file-names', callback)  │    'get-file-names', paths
   │  ◄─────────────────────────    │  )
   │                                │
   │  callback(paths)               │
   ▼                                ▼
```

这种模式下，请求和响应使用不同的通道名。渲染进程发送 `get-file-path` 请求，但需要监听 `get-file-names` 事件来接收结果。这增加了前端的编码复杂度，但在历史代码中较为常见。

### 5.4 主动推送流

```
                                   主进程
                                    │
                                    │  检测到协议唤醒
                                    │  url = parseUrl(argv)
                                    │
渲染进程                            │  sendToRenderMsg(
   │                                │    'web-awaken', url
   │  ipcRenderer.on                │  )
   │  ('web-awaken', callback)      │
   │  ◄─────────────────────────    │
   │                                │
   │  处理唤醒 URL                   │
   ▼                                ▼
```

主进程可以在任意时刻主动向渲染进程推送消息，无需渲染进程先发起请求。这用于系统事件通知、状态变更推送等场景。

---

## 六、关键场景详解

### 6.1 场景一：应用启动时获取配置

当通宝 Web 应用在渲染进程中加载后，首先需要获取客户端的运行时配置信息。

**流程**：
1. 通宝 Web 应用加载完成，执行初始化逻辑
2. 通过 `window.require('electron').ipcRenderer` 获取 IPC 引用
3. 调用 `ipcRenderer.sendSync('get-app-config')` 同步获取配置
4. 主进程收到请求，构建配置对象：
   - `mode`：运行模式（dev/test/prod）
   - `type`：版本类型
   - `version`：应用版本号
   - `appMetrics`：应用性能指标
   - `gid`：设备唯一标识
   - `hostname`：计算机名
   - `windowIp`：本机 IP
   - `isGray`：是否体验版
5. 通过 `event.returnValue` 同步返回配置
6. 前端根据配置初始化各功能模块

**涉及数据格式**：
```
返回值: {
    mode: "prod" | "test" | "dev",
    type: "prod" | "test" | "vt",
    version: "1.2.3",
    appMetrics: [...],
    gid: "xxxxxxxx_win32_10.0.19045",
    hostname: "DESKTOP-XXX",
    windowIp: "192.168.1.100",
    isGray: false
}
```

### 6.2 场景二：启动微信注入

用户在前端点击"启动微信"按钮后，触发微信逆向注入流程。

**流程**：
1. 前端通过 WebSocket 发送启动指令到主进程
2. 主进程的 WebSocket 处理逻辑将指令转发为 IPC 调用（或前端直接通过 inject.js 暴露的 require 使用 ipcRenderer）
3. 渲染进程发送 `ipcRenderer.send('runInject')` 到主进程
4. 主进程 `ipc.on('runInject')` 处理：
   - 调用 `inject.runInject()`
   - 启动 BasicService.exe 子进程
   - BasicService 负责将 DLL 注入到微信进程
5. 注入成功后，逆向 IPC（Named Pipe）开始工作
6. 微信进程的登录状态通过 Named Pipe → 出站调度 → 前端 WebSocket 通知给前端

**错误处理**：
- 如果 BasicService.exe 启动失败（如文件不存在、权限不足），`handleExecError` 会解码错误信息（GB2312 编码），记录到日志并上报。

### 6.3 场景三：自动更新流程

应用检测到新版本后的完整更新流程。

**流程**：
1. 前端发送 `setUpdateUrl` → 主进程设置更新 Feed URL
2. 前端发送 `checkForUpdate` → 主进程使用 electron-updater 检查新版本
3. 如果有新版本，主进程通知前端
4. 前端发送 `checkDownloadFile` → 主进程开始下载更新包
5. 下载过程中：主进程通过 `sendToRenderMsg('downloadProgress', progress)` 实时推送进度
6. 下载完成：主进程通过 `sendToRenderMsg('update-downloaded')` 通知前端
7. 前端收到完成通知，调用 `checkJava` → 主进程检查 Java/微信进程是否已退出
8. 如果进程仍在运行，主进程发送 `wsKillJava` 通知前端关闭 Java
9. 前端关闭 Java 后再次调用 `checkJava` → 主进程执行 `quitAndInstall()` 安装更新

**异常处理**：
- 下载失败：发送 `updateError` 通知前端
- 解压失败：同样发送 `updateError`
- Java 关闭失败：发送 `killJavaFail`

### 6.4 场景四：WebSocket 端口获取

前端需要知道 WebSocket 服务器的端口才能建立连接。

**流程**：
1. 前端通过 `ipc.callMain('get-ws-port')` 请求端口
2. 主进程判断平台是否为 Windows
3. 如果是 Windows：
   - 调用 `getWsPortAsync()` 获取端口
   - `getWsPortAsync` 从 `global.port` 读取端口值
   - 如果 `global.port` 尚未设置（WebSocket 服务还在启动），等待 1 秒后重试
   - 返回端口号
4. 如果非 Windows：返回空值
5. 前端收到端口号后，用 `ws://localhost:{port}` 建立 WebSocket 连接

这个场景体现了 Electron IPC 与 WebSocket 两种通信机制的桥接——IPC 用于获取 WebSocket 的连接参数。

### 6.5 场景五：跨域请求代理

远程加载的通宝 Web 应用受同源策略限制，无法直接访问某些 API。

**流程**：
1. 前端需要访问跨域 API，但浏览器 CORS 策略阻止
2. 前端通过 IPC 调用 `cross-origin-request`，传递 URL 参数
3. 主进程收到请求，使用 `axios.get(url)` 在 Node.js 环境中发起请求（Node.js 不受浏览器 CORS 限制）
4. 将响应数据返回给渲染进程
5. 前端拿到数据，继续业务处理

这是 Electron 架构的一个常见模式——利用主进程的 Node.js 能力绕过渲染进程的浏览器安全限制。

### 6.6 场景六：窗口关闭确认

用户点击窗口关闭按钮时的处理流程。

**流程**：
1. 用户点击关闭按钮
2. 主进程（`init/window.js`）拦截 `close` 事件
3. 弹出确认对话框
4. 用户确认关闭后：
   - 调用 `sendToRenderMsg('logout-notify')` 通知前端正在退出
   - 调用 `sendToRenderMsg('ws-kill-java-only')` 通知前端关闭 Java
   - 调用 `setRecordInfo(1)` 记录活动状态为"退出"
5. 前端收到通知后执行清理逻辑
6. 等待清理完成后，应用退出

---

## 七、IPC 通信中的数据格式

### 7.1 请求数据

大多数 IPC 请求的数据格式较为简单：

| 类型 | 格式 | 示例 |
|------|------|------|
| 无参数 | 无 | `runInject`、`app-relaunch` |
| 字符串 | 单个字符串 | `open-url` 传入 URL |
| 对象 | JSON 对象 | `set-user-info` 传入 `{ name, id, ... }` |
| 文件路径 | 字符串 | `readFileAsBase64` 传入 `filePath` |
| URL | 字符串 | `setUpdateUrl` 传入 Feed URL |

### 7.2 响应数据

| 通道 | 返回格式 | 说明 |
|------|---------|------|
| `get-app-config` | 配置对象 | `{ mode, type, version, gid, ... }` |
| `exist-file` | 布尔值 | `true` 或 `false` |
| `copy-file` | 字符串 | 临时文件路径 |
| `get-ws-port` | 数字 | WebSocket 端口号 |
| `get-app-metrics` | 数组 | Electron 进程指标数组 |
| `get-window-ip` | 字符串 | IP 地址 |
| `cross-origin-request` | 任意 | HTTP 响应数据 |

---

## 八、错误处理与边界情况

### 8.1 渲染进程崩溃

当渲染进程发生崩溃（`render-process-gone` 事件）时：

1. 主进程捕获崩溃事件
2. 调用 `crashOrErrorReport()` 记录崩溃信息
3. 上报到 SLS 日志和 Habo 统计
4. 如果配置了自动重启，重新创建窗口

IPC 通道在渲染进程重启后需要重新建立——渲染进程的 `ipcRenderer.on` 监听器在进程崩溃后失效，新的渲染进程需要重新注册监听。

### 8.2 主进程未捕获异常

主进程的未捕获异常通过 `common/monitor.js` 处理：

1. `process.on('uncaughtException')` 捕获同步异常
2. `process.on('unhandledRejection')` 捕获未处理的 Promise 拒绝
3. 记录到日志、上报监控
4. 异常不会导致 IPC 通道失效（除非进程退出）

### 8.3 IPC 调用超时

`electron-better-ipc` 的 `ipc.answerRenderer` 和 `ipc.handle` 没有内置超时机制。如果主进程的处理函数长时间不返回，渲染进程的 Promise 会一直 pending。

在 galaxy-client 中，以下操作可能耗时较长：
- `convert-urls-to-files`：需要下载多个 URL
- `cross-origin-request`：依赖外部 API 的响应时间
- `get-ws-port`：如果 WebSocket 服务还在启动，会重试等待

目前没有统一的超时处理机制，建议在关键路径上增加超时逻辑。

---

## 九、调试方法

### 9.1 渲染进程调试

**打开 DevTools**：
- 使用快捷键 `Ctrl+Shift+I` 打开渲染进程的开发者工具
- 这个快捷键在 `common/shortcut.js` 中注册

**查看 IPC 调用**：
- 在 DevTools Console 中可以直接调用 IPC：`require('electron').ipcRenderer.send('channel', data)`
- 使用 `Electron DevTools Extension`（如果安装）可以看到 IPC 消息

### 9.2 主进程调试

**日志查看**：
- electron-log 的日志文件位于 `%APPDATA%/{appName}/logs/`
- 搜索关键字如 `ipc.on`、通道名 来查找特定 IPC 的处理日志

**远程调试**：
- 启动参数加 `--remote-debug`
- 主进程 Node Inspector 端口：9229
- 使用 Chrome `chrome://inspect` 连接

**断点调试**：
- 在 `event/ipc.js` 的具体 handler 中设置断点
- 通过远程 Inspector 连接后可以步进调试

### 9.3 常见问题排查

**问题：渲染进程无法收到主进程推送**
- 检查 `mainWindow` 是否有效（未关闭、未崩溃）
- 检查 `sendToRenderMsg` 中的 `mainWindow.webContents` 是否存在
- 确认渲染进程的 `ipcRenderer.on(channel)` 监听已注册

**问题：ipc.answerRenderer 返回 undefined**
- 确认主进程 handler 有返回值
- 检查 handler 中是否有未捕获的异常
- 确认渲染进程使用的是 `ipc.callMain` 而非 `ipcRenderer.send`

**问题：get-app-config 返回空**
- 检查 `event.returnValue` 赋值是否在异步操作之前
- 确认 global 变量（如 `global.port`）已初始化

---

## 十、安全考虑

### 10.1 当前安全模型

galaxy-client 的安全模型相对宽松：

- 主窗口的预加载脚本直接暴露了 `window.require`，这意味着远程加载的 Web 页面可以使用任意 Node.js 模块
- `nodeIntegration` 在主窗口中可能处于启用状态
- 这种设计是为了让通宝 Web 应用能够方便地调用本地能力

### 10.2 安全风险

1. **XSS 攻击风险**：如果通宝 Web 应用存在 XSS 漏洞，攻击者可以通过 `window.require` 访问 Node.js，执行任意系统命令
2. **中间人攻击**：如果 HTTPS 证书验证被绕过，攻击者可以注入恶意脚本

### 10.3 安全建议

1. 对 WebView 使用 `contextBridge`（已实现）
2. 对主窗口也迁移到 `contextBridge` 模式，替代直接暴露 `window.require`
3. 启用 `contextIsolation` 和 `sandbox` 选项
4. 对 IPC 通道增加来源验证

---

## 十一、总结

Electron IPC 是 galaxy-client 中最基础的通信机制，共注册了约 40 个通道，覆盖了用户认证、进程管理、文件操作、配置管理、应用控制、系统信息查询等功能。它是渲染进程（UI 层）与主进程（业务逻辑层）之间的桥梁。

主要特点：
- 使用 `electron-better-ipc` 简化 API
- 三种注册方式（on、answerRenderer、handle）适应不同场景
- 主进程主动推送能力（sendToRenderMsg）用于状态通知
- 预加载脚本（inject.js）为远程 Web 应用提供本地能力桥接
- 与 WebSocket 通信机制存在桥接关系（get-ws-port）

在整体架构中，Electron IPC 主要处理 UI 层面的交互需求，而核心业务数据（微信消息、云端任务）则通过 WebSocket、MQTT 和逆向 IPC 传输。

---

## 十二、IPC 通道分类统计

### 12.1 按功能分类

| 功能分类 | 通道数量 | 典型通道 |
|---------|---------|---------|
| 用户认证 | 4 | `userLogin`, `userLogout`, `set-user-info`, `cas-auto-complete-info` |
| 进程管理 | 7 | `runInject`, `runQyWxInject`, `stop-java`, `stop-wxwork`, `stop-wechat`, `stopBsInject`, `stopBs64Inject` |
| 文件操作 | 8 | `get-file-path`, `exist-file`, `copy-file`, `convert-base64-to-file`, `convert-urls-to-files`, `readFileAsBase64`, `open-file`, `open-dialog` |
| 配置环境 | 7 | `get-app-config`, `set-env-settings`, `get-env-settings`, `set-is-gray`, `get-is-gray`, `set-modules`, `get-ws-port` |
| 应用控制 | 3 | `open-url`, `app-relaunch`, `app-exit` |
| 系统信息 | 3 | `get-app-metrics`, `get-window-ip`, `cross-origin-request` |
| Cookie/账号 | 5 | `writeUqunCookie`, `writeGidCookie`, `addLocalAccount`, `getLocalAccounts`, `hasLoginedAccount` |
| 更新相关 | 4 | `setUpdateUrl`, `checkForUpdate`, `checkDownloadFile`, `checkJava` |
| 预留接口 | 2 | `startFangzhou`, `hasFangzhouStarted` |
| 主进程推送 | 14 | `get-file-names`, `web-awaken`, `downloadProgress`, `update-downloaded` 等 |

### 12.2 按注册方式分类

| 注册方式 | 数量 | 特点 |
|---------|------|------|
| `ipc.on` | 约 25 | 事件监听，需手动回传数据 |
| `ipc.answerRenderer` | 约 8 | 请求-响应，自动回传 |
| `ipc.handle` | 约 5 | 异步处理，Promise 模式 |
| `sendToRenderMsg` | 约 14 | 主进程主动推送 |

### 12.3 按数据方向分类

| 方向 | 数量 | 说明 |
|------|------|------|
| 渲染→主（单向） | 约 15 | 触发型操作，无需返回值 |
| 渲染→主→渲染 | 约 18 | 请求-响应模式 |
| 主→渲染（推送） | 约 14 | 主进程主动通知 |

---

## 十三、IPC 与 WebSocket 的职责边界

### 13.1 为什么同时使用 IPC 和 WebSocket

在 galaxy-client 架构中，Electron IPC 和 WebSocket 都用于前端与主进程的通信，但它们的职责有明确的边界：

**Electron IPC 的职责**：
- 系统级操作（文件读写、打开链接、窗口控制）
- 应用级配置（获取配置、设置环境）
- 进程管理（启动/停止注入）
- 一次性的数据查询（文件是否存在、IP 地址）
- 更新管理
- 需要 Electron 特定 API 的操作（dialog、shell、clipboard）

**WebSocket 的职责**：
- 业务消息的实时传输（微信消息推送）
- 业务指令的双向传递（发消息、加好友）
- 多账号状态管理（MQTT 状态查询）
- 高频的业务数据推送（群更新、好友变更）
- 需要长连接保持的场景

### 13.2 决策依据

选择使用 IPC 还是 WebSocket 的判断标准：

| 判断维度 | 选 Electron IPC | 选 WebSocket |
|---------|----------------|-------------|
| 是否需要系统 API | 是 | 否 |
| 是否需要长连接 | 否 | 是 |
| 数据传输频率 | 低频（用户触发） | 高频（实时推送） |
| 数据流向 | 主要是请求-响应 | 双向实时 |
| 是否需要路由到逆向 | 否 | 是 |
| 前端触发方式 | preload 注入的 require | 浏览器原生 WebSocket |

### 13.3 潜在的重构方向

目前部分功能在 IPC 和 WebSocket 之间的划分不够清晰。例如：
- `get-ws-port` 通过 IPC 获取 WebSocket 端口，这是合理的
- 但 `get-file-entity` 通过 IPC 传输可能较大的数据，如果数据量增大，可能考虑走 WebSocket

长远来看，如果通宝 Web 应用迁移到使用 `contextBridge` 方式（不再暴露 `window.require`），那么前端将无法直接使用 `ipcRenderer`，所有前端通信都需要通过 WebSocket 或 preload 暴露的有限 API 完成。这将影响 IPC 通道的设计。

---

## 十四、完整 IPC 通道索引表

以下是所有 IPC 通道的快速索引，方便查阅：

| 通道名 | 文件 | 方式 | 方向 | 说明 |
|--------|------|------|------|------|
| `userLogin` | event/ipc.js | on | R→M | 重新登录 |
| `userLogout` | event/ipc.js | on | R→M | 退出登录 |
| `runInject` | event/ipc.js | on | R→M | 启动微信注入 |
| `runQyWxInject` | event/ipc.js | on | R→M | 启动企微注入 |
| `stop-java` | event/ipc.js | on | R→M | 停止 Java |
| `stop-wxwork` | event/ipc.js | on | R→M | 停止企微 |
| `stop-wechat` | event/ipc.js | on | R→M | 停止微信 |
| `stopBsInject` | event/ipc.js | on | R→M | 停止 BS 注入 |
| `stopBs64Inject` | event/ipc.js | on | R→M | 停止 BS64 注入 |
| `get-file-path` | event/ipc.js | on | R→M | 获取剪贴板文件 |
| `cas-auto-complete-info` | event/ipc.js | on | R→M | CAS 自动填充 |
| `get-file-entity` | event/ipc.js | on | R→M | 文件摘要 |
| `get-app-config` | event/ipc.js | on | R→M | 获取配置（同步） |
| `set-user-info` | event/ipc.js | on | R→M | 保存用户信息 |
| `set-is-gray` | event/ipc.js | on | R→M | 设置体验版 |
| `get-is-gray` | event/ipc.js | on | R→M | 获取体验版 |
| `set-env-settings` | event/ipc.js | on | R→M | 设置环境 |
| `get-env-settings` | event/ipc.js | handle | R→M→R | 获取环境 |
| `open-url` | event/ipc.js | on | R→M | 打开链接 |
| `open-file` | event/ipc.js | on | R→M | 打开文件 |
| `app-relaunch` | event/ipc.js | on | R→M | 重启应用 |
| `app-exit` | event/ipc.js | on | R→M | 退出应用 |
| `set-modules` | event/ipc.js | on | R→M | 设置模块 |
| `writeUqunCookie` | event/ipc.js | on | R→M | 写入 U 群 cookie |
| `writeGidCookie` | event/ipc.js | on | R→M | 写入 GID cookie |
| `addLocalAccount` | event/ipc.js | on | R→M | 添加本地账号 |
| `getLocalAccounts` | event/ipc.js | on | R→M | 获取本地账号 |
| `exist-file` | event/ipc.js | answer | R→M→R | 文件是否存在 |
| `copy-file` | event/ipc.js | answer | R→M→R | 复制文件 |
| `get-app-metrics` | event/ipc.js | answer | R→M→R | 应用指标 |
| `get-ws-port` | event/ipc.js | answer | R→M→R | WebSocket 端口 |
| `convert-base64-to-file` | event/ipc.js | answer | R→M→R | Base64 转文件 |
| `convert-urls-to-files` | event/ipc.js | answer | R→M→R | URL 转文件 |
| `cross-origin-request` | event/ipc.js | answer | R→M→R | 跨域请求 |
| `open-dialog` | event/ipc.js | answer | R→M→R | 文件选择框 |
| `get-window-ip` | event/ipc.js | answer | R→M→R | 获取 IP |
| `readFileAsBase64` | event/ipc.js | handle | R→M→R | 读文件 Base64 |
| `hasLoginedAccount` | event/ipc.js | handle | R→M→R | 是否有已登录账号 |
| `startFangzhou` | event/ipc.js | handle | R→M→R | 启动方舟 |
| `hasFangzhouStarted` | event/ipc.js | handle | R→M→R | 方舟是否启动 |
| `setUpdateUrl` | event/updater.js | on | R→M | 设置更新 URL |
| `checkForUpdate` | event/updater.js | on | R→M | 检查更新 |
| `checkDownloadFile` | event/updater.js | on | R→M | 下载更新 |
| `checkJava` | event/updater.js | on | R→M | 检查 Java 退出 |
| `get-file-names` | utils.js → send | push | M→R | 剪贴板文件路径 |
| `cas-auto-complete-info` | utils.js → send | push | M→R | CAS 信息 |
| `get-file-entity` | utils.js → send | push | M→R | 文件摘要 |
| `get-local-accounts-notify` | utils.js → send | push | M→R | 本地账号列表 |
| `web-awaken` | event/app.js | push | M→R | 协议唤醒 |
| `set-dev-buttons-visible` | init/window.js | push | M→R | 开发按钮显隐 |
| `ws-kill-java-only` | init/window.js | push | M→R | 关闭 Java |
| `logout-notify` | init/window.js | push | M→R | 登出通知 |
| `wsKillJava` | event/updater.js | push | M→R | 更新前关闭 Java |
| `killJavaFail` | event/updater.js | push | M→R | 关闭 Java 失败 |
| `updateError` | event/extractZip.js | push | M→R | 更新错误 |
| `updateStart` | event/downloadFile.js | push | M→R | 开始更新 |
| `update-downloaded` | event/downloadFile.js | push | M→R | 更新下载完成 |
| `downloadProgress` | event/downloadFile.js | push | M→R | 下载进度 |
