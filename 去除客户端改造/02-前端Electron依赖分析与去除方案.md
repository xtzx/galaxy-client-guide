# 02 - 前端 Electron 依赖分析与去除方案

> 文档状态：讨论稿  
> 创建时间：2026-03-20  
> 适用项目：galaxy（前端）

---

## 一、概述

galaxy 前端项目当前深度依赖 Electron 环境，涉及 IPC 通信、Electron remote API、本地文件操作、窗口管理等能力。本文档对所有 Electron 依赖点进行**完整清点**，按分类列出每个依赖的文件位置、业务用途、替换方案。

### 1.1 依赖规模统计

| 依赖类型 | 涉及文件数 | 严重程度 |
|----------|-----------|---------|
| `@/common/ipc` 引用 | 31+ 个 | 高 - 需全面替换 |
| `@/common/project` 引用 | 24+ 个 | 高 - 需改为 Web 配置 |
| Electron remote 使用 | 8+ 个 | 中 - 需去除 |
| webview 标签使用 | 3 处 | 高 - 需改架构 |
| Electron 主进程代码 | `electron/` 整目录 | 直接删除 |
| 构建配置 | 5+ 个 | 需简化 |

### 1.2 已有浏览器适配层

galaxy 项目之前已做过部分浏览器兼容工作：

| 文件 | 说明 |
|------|------|
| `src/common/ipc.browser.js` | IPC 浏览器占位（Proxy，所有方法返回 `Promise.resolve()`） |
| `src/common/project.browser.js` | 项目配置浏览器版（返回固定配置对象） |
| `src/alias/electron.browser.js` | Electron 模块占位（导出空对象 `{}`） |
| `conditional-loader.js` | 构建时按环境替换 `.js` → `.browser.js` |
| `conditional-dev-loader.js` | 开发时替换为 `.browserDev.js` |

**重要说明**：这些适配层只是**让代码不报错的占位**，并非真正的功能替换。例如 `ipc.browser.js` 中所有 IPC 调用都返回空 Promise，意味着依赖 IPC 返回值的功能在浏览器中**不会正常工作**。这次改造需要将每个依赖点**真正替换为浏览器可用的方案**。

---

## 二、IPC 依赖完整清单

### 2.1 ipc.callMain（异步调用主进程）

#### 2.1.1 get-ws-port

| 属性 | 值 |
|------|-----|
| **文件** | `src/entries/menu/store/thunks.js` |
| **调用** | `ipc.callMain('get-ws-port')` |
| **用途** | 获取 WebSocket 端口（从 Windows 注册表读取） |
| **返回值** | 端口号（如 13323） |
| **业务影响** | WebSocket 连接的基础，整个通信链路的入口 |
| **替换方案** | **废弃** - 去除 WebSocket 后不再需要 |

#### 2.1.2 get-window-ip

| 属性 | 值 |
|------|-----|
| **文件** | `src/entries/menu/store/thunks.js` |
| **调用** | `ipc.callMain('get-window-ip')` |
| **用途** | 获取本机 IP 地址（非 Windows 环境时用于 WebSocket 连接） |
| **返回值** | IP 地址字符串 |
| **业务影响** | 仅在非 Windows 开发环境使用 |
| **替换方案** | **废弃** - 去除 WebSocket 后不再需要 |

#### 2.1.3 cross-origin-request

| 属性 | 值 |
|------|-----|
| **文件** | `src/entries/sub/component/sendSetting/component/messageContent/LinkContent/LinkModal/index.jsx` |
|  | `src/entries/sub/component/sendSetting/component/LinkContent/LinkModal/index.jsx` |
|  | `src/entries/menu/component/staging/component/messageContent/LinkContent/LinkModal/index.jsx` |
| **调用** | `ipc.callMain('cross-origin-request', { url })` |
| **用途** | 通过 Electron 主进程发起跨域 GET 请求，抓取链接预览信息（标题、描述、图片） |
| **返回值** | HTML 内容 |
| **业务影响** | 链接消息卡片的预览功能 |
| **替换方案** | **A. 云端代理**：新增后端 API `/api/proxy/fetch-link-preview`，后端抓取目标页面信息返回 |
|  | **B. CORS 配置**：如果目标站点支持 CORS，直接前端 fetch |
|  | 推荐 A 方案，因为大部分外部网站不支持 CORS |

#### 2.1.4 open-dialog

| 属性 | 值 |
|------|-----|
| **文件** | `src/entries/sub/component/UploadImg/index.jsx` |
| **调用** | `ipc.callMain('open-dialog', { filters })` |
| **用途** | 打开 Electron 文件选择对话框，选择图片文件 |
| **返回值** | 文件路径数组 |
| **业务影响** | 图片上传功能 |
| **替换方案** | 使用浏览器原生 `<input type="file" accept="image/*">` 替换 |

#### 2.1.5 get-app-metrics

| 属性 | 值 |
|------|-----|
| **文件** | `src/common/report.js` |
| **调用** | `ipc.callMain('get-app-metrics')` |
| **用途** | 获取 Electron 进程性能指标 |
| **返回值** | 进程 CPU、内存等指标 |
| **业务影响** | 性能监控上报 |
| **替换方案** | 使用浏览器 `Performance API`（`performance.memory`、`navigator.deviceMemory` 等）替代 |

#### 2.1.6 convert-urls-to-files

| 属性 | 值 |
|------|-----|
| **文件** | `src/common/paste.js`、`src/common/downloadFile.js` |
| **调用** | `ipc.callMain('convert-urls-to-files', urls)` |
| **用途** | 将 URL 下载为本地文件 |
| **返回值** | 本地文件路径 |
| **业务影响** | 粘贴网络图片时转为本地文件 |
| **替换方案** | 使用浏览器 `fetch()` + `Blob` + `URL.createObjectURL()` 实现 |

#### 2.1.7 convert-base64-to-file

| 属性 | 值 |
|------|-----|
| **文件** | `src/common/paste.js` |
| **调用** | `ipc.callMain('convert-base64-to-file', base64)` |
| **用途** | 将 base64 编码的数据转为本地文件 |
| **返回值** | 本地文件路径 |
| **业务影响** | 粘贴 base64 图片时转为文件 |
| **替换方案** | 使用浏览器 `atob()` + `Blob` + `File` 构造器实现 |

#### 2.1.8 exist-file / copy-file

| 属性 | 值 |
|------|-----|
| **文件** | `src/common/asyncValidator.js` |
| **调用** | `ipc.callMain('exist-file', path)`、`ipc.callMain('copy-file', { src, dest })` |
| **用途** | 检查文件是否存在、复制文件到临时目录 |
| **返回值** | 布尔值 / 新文件路径 |
| **业务影响** | 文件上传前的验证和处理 |
| **替换方案** | **废弃** - 浏览器环境通过 `<input type="file">` 选择文件后直接使用 File 对象，无需检查路径 |

---

### 2.2 ipc.sendSync（同步调用主进程）

#### 2.2.1 get-app-config

| 属性 | 值 |
|------|-----|
| **文件** | `src/common/project.js`（被 24+ 个文件间接依赖） |
| **调用** | `ipc.sendSync('get-app-config')` |
| **用途** | 获取应用配置（type、report、debug、modules 等） |
| **返回值** | 配置对象 |
| **业务影响** | 核心配置，影响所有模块 |
| **替换方案** | 改用 `project.browser.js` 作为基础，从以下来源获取配置：|
|  | 1. 环境变量（`REACT_APP_*`） |
|  | 2. 云端配置 API |
|  | 3. `localStorage` 缓存 |

#### 2.2.2 get-is-gray / set-is-gray

| 属性 | 值 |
|------|-----|
| **文件** | `src/entries/menu/component/Header.js` |
| **调用** | `ipc.sendSync('get-is-gray')`、`ipc.sendSync('set-is-gray', value)` |
| **用途** | 获取/设置是否为体验版（灰度发布） |
| **返回值** | 布尔值 |
| **业务影响** | 体验版标识显示 |
| **替换方案** | 使用 `localStorage` 存储，或通过云端 API 获取灰度状态 |

---

### 2.3 ipc.invoke（invoke/handle 模式）

#### 2.3.1 get-env-settings

| 属性 | 值 |
|------|-----|
| **文件** | `src/entries/menu/component/nav/EnvSettingsButton.tsx` |
| **调用** | `ipc.invoke('get-env-settings')` |
| **用途** | 获取环境配置 |
| **替换方案** | 使用 `localStorage` 或云端配置 API |

#### 2.3.2 hasLoginedAccount

| 属性 | 值 |
|------|-----|
| **文件** | `src/entries/menu/component/numberManage/component/wechatTab/index.js` |
| **调用** | `ipc.invoke('hasLoginedAccount')` |
| **用途** | 检测企微是否已登录（调用 ReUtils64.dll） |
| **业务影响** | 号管理页面的企微登录检测 |
| **替换方案** | **废弃** - 此功能依赖本地 DLL，浏览器无法实现。改为通过云端 API 查询账号状态 |

#### 2.3.3 startFangzhou / hasFangzhouStarted

| 属性 | 值 |
|------|-----|
| **文件** | `src/entries/menu/component/numberManage/component/wechatTab/index.js` |
| **调用** | `ipc.invoke('startFangzhou')`、`ipc.invoke('hasFangzhouStarted')` |
| **用途** | 启动/检测方舟程序 |
| **业务影响** | 号管理页面的方舟控制 |
| **替换方案** | **废弃** - 由 C++ 客户端自行管理，前端不再控制 |

---

### 2.4 ipc.send（单向发送到主进程）

以下按功能分组：

#### A. 登录/登出相关

| IPC 通道 | 文件 | 用途 | 替换方案 |
|----------|------|------|---------|
| `userLogin` | `vpn/App.js` | VPN 页面触发登录 | 浏览器直接跳转登录页 |
| `userLogout` | `menu/component/Header.js`、`menu/App.js`、`load/App.js` | 触发登出 | 调用云端登出 API + 清除浏览器 Cookie/Token |

#### B. 进程注入相关

| IPC 通道 | 文件 | 用途 | 替换方案 |
|----------|------|------|---------|
| `runInject` | `menu/store/thunks.js` | 启动个微注入 | **废弃** - C++ 客户端自行管理 |
| `runQyWxInject` | `menu/store/thunks.js` | 启动企微注入 | **废弃** - C++ 客户端自行管理 |
| `stopBsInject` | `menu/App.js` | 停止 32 位注入 | **废弃** |
| `stopBs64Inject` | `menu/App.js` | 停止 64 位注入 | **废弃** |
| `checkJava` | `menu/App.js` | 检查 Java 状态 | **废弃** |

#### C. 文件操作相关

| IPC 通道 | 文件 | 用途 | 替换方案 |
|----------|------|------|---------|
| `get-file-path` | `menu/App.js`、多个 sub 组件 | 获取剪贴板文件路径 | 使用浏览器 Clipboard API（`navigator.clipboard.read()`） |
| `get-file-entity` | `menu/App.js`、多个 sub 组件 | 获取文件实体信息 | 使用浏览器 File API |
| `open-file` | `menu/App.js` | 打开本地文件 | 使用 `window.open(url)` 或 `<a download>` |
| `copy-file` | `common/asyncValidator.js` | 复制文件 | **废弃** - 浏览器无此需求 |
| `checkDownloadFile` | `menu/App.js`、`menu/component/Version.js`、`sub/component/Version/index.js` | 检查更新下载 | **废弃** - Web 应用无需下载更新 |

#### D. 外部链接相关

| IPC 通道 | 文件 | 用途 | 替换方案 |
|----------|------|------|---------|
| `open-url` | `sub/component/Version/index.js`、`menu/component/tutuButton/index.js`、`menu/component/Version.js`、`menu/component/UpdateModal/index.js`、`menu/component/BindModal.js` | 打开外部链接 | 使用 `window.open(url, '_blank')` |

#### E. 应用控制相关

| IPC 通道 | 文件 | 用途 | 替换方案 |
|----------|------|------|---------|
| `app-relaunch` | `menu/App.js` | 重启应用 | 使用 `location.reload()` 或 `location.href = '/'` |
| `app-exit` | `menu/App.js` | 退出应用 | **废弃** - Web 应用无此概念，可提供登出按钮 |

#### F. 配置和状态相关

| IPC 通道 | 文件 | 用途 | 替换方案 |
|----------|------|------|---------|
| `set-modules` | `menu/store/thunks.js` | 设置功能模块配置 | 存储到 `localStorage` 或云端 |
| `set-env-settings` | `menu/component/nav/EnvSettingsButton.tsx` | 设置环境配置 | 使用 `localStorage` |
| `set-user-info` | `menu/App.js` | 设置用户信息到主进程 | **废弃** - 前端自行管理用户状态 |
| `global-wxid` | `menu/App.js` | 设置全局 wxid | 使用 Redux store 或 Context |
| `writeUqunCookie` | `menu/App.js` | 写入 U 群 Cookie | 使用 `document.cookie` 或云端设置 |
| `writeGidCookie` | `sub/index.js` | 写入 GID Cookie | 使用 `document.cookie` |

#### G. CAS 登录注入

| IPC 通道 | 文件 | 用途 | 替换方案 |
|----------|------|------|---------|
| `cas-auto-complete-info` | `extraResources/load/inject.js` | CAS 登录页自动填充 | **废弃** - Web 应用使用标准 CAS 登录流程 |

---

### 2.5 ipc.sendToHost（webview → 父窗口）

这部分是 sub 页面（运行在 webview 中）向 menu 页面发送消息的通道，改造后需要替换为 `postMessage` 或其他方案。

#### A. 业务消息

| IPC 通道 | 文件 | 用途 | 替换方案 |
|----------|------|------|---------|
| `sub-message` | `sub/store/base/thunks.js` | sub 业务消息（getAllConfig、forward、upload 等） | postMessage / 全局事件总线 / 直接 HTTP API |
| `wxid-chatrooms` | `sub/store/base/thunks.js` | wxid 与群聊映射数据 | postMessage |
| `version-info` | `sub/store/base/thunks.js` | 版本信息上报 | postMessage |

#### B. 跨进程文件操作

| IPC 通道 | 文件 | 用途 | 替换方案 |
|----------|------|------|---------|
| `get-file-entity` | `sub/smartReply/`、`sub/groupReply/`、`sub/friendApply/`、`sub/component/sendSetting/` | 获取文件信息 | 使用浏览器 File API |
| `get-file-path` | 同上 | 获取剪贴板文件路径 | 使用浏览器 Clipboard API |

#### C. 跨页面操作

| IPC 通道 | 文件 | 用途 | 替换方案 |
|----------|------|------|---------|
| `go-account` | `sub/homePage/index.js` | 跳转到号管理页面 | postMessage → 父页面路由跳转 |
| `add-one-account` | `sub/component/wxModal/index.js` | 添加一个账号 | postMessage → 父页面处理 |
| `show-migrate-modal` | `sub/component/wxModal/index.js` | 显示迁移弹窗 | postMessage → 父页面处理 |
| `toggle-devtools` | `sub/component/devButton/index.js` | 切换开发者工具 | **废弃** - 浏览器自带 DevTools |
| `open-env-settings` | `sub/App.js` | 打开环境设置 | postMessage → 父页面处理 |

---

### 2.6 ipc.on（渲染进程监听主进程消息）

#### A. sub 页面监听的通道

| IPC 通道 | 文件 | 用途 | 替换方案 |
|----------|------|------|---------|
| `parent-message` | `sub/App.js` | 接收父窗口下发的业务消息 | `window.addEventListener('message', ...)` |
| `set-global-data` | `sub/App.js` | 接收全局数据 | postMessage 或共享 Context |
| `set-client-base-info` | `sub/App.js` | 接收客户端基础信息 | postMessage 或共享 Context |
| `set-web-base-info` | `sub/App.js` | 接收 Web 基础信息 | postMessage 或共享 Context |
| `set-cas-user-info` | `sub/App.js` | 接收 CAS 用户信息 | postMessage 或共享 Context |
| `heart-modal-error-code` | `sub/App.js` | 接收心跳错误码 | postMessage |
| `heart-modal-java-client-ws-error` | `sub/App.js`、`sub/AddGroupFriend/index.jsx` | Java 客户端 WS 错误 | **废弃** - 不再有 Java 客户端 |
| `set-dev-buttons-visible` | `sub/App.js` | 开发按钮显隐 | postMessage 或 URL 参数 |
| `copy-file-names` | `sub/App.js` | 复制文件名 | **废弃** |
| `web-go-page` | `sub/App.js` | 页面跳转指令 | postMessage → 路由跳转 |
| `qywx-login` | `sub/App.js` | 企微登录通知 | postMessage |
| `get-config-succ` | `sub/App.js` | 配置获取成功通知 | postMessage |
| `wx-offline` | `sub/AddGroupFriend/index.jsx` | 微信离线通知 | postMessage |
| `logout-notify` | `sub/component/nav/nav.js` | 登出通知 | postMessage |
| `get-file-entities` | 多个 sub 组件 | 文件实体（ipc.once） | **废弃** - 使用浏览器 File API |

#### B. menu 页面监听的通道

| IPC 通道 | 文件 | 用途 | 替换方案 |
|----------|------|------|---------|
| `updateStart` | `menu/App.js` | 更新开始 | **废弃** - Web 应用无需自动更新 |
| `downloadProgress` | `menu/App.js` | 下载进度 | **废弃** |
| `update-downloaded` | `menu/App.js` | 更新已下载 | **废弃** |
| `updateError` | `menu/App.js` | 更新错误 | **废弃** |
| `wsKillJava` | `menu/App.js` | 杀 Java 进程 | **废弃** |
| `killJavaFail` | `menu/App.js` | 杀 Java 失败 | **废弃** |
| `ws-kill-java-only` | `menu/App.js` | 仅杀 Java | **废弃** |
| `crash-report` | `menu/App.js` | 崩溃上报 | 使用浏览器 `window.onerror` / `ErrorBoundary` |
| `global-wxid` | `menu/App.js` | 全局 wxid | 使用 Redux store |
| `set-dev-buttons-visible` | `menu/App.js` | 开发按钮 | URL 参数或 localStorage |
| `get-file-names` | `menu/App.js` | 剪贴板文件名 | 浏览器 Clipboard API |
| `get-file-entity` | `menu/App.js` | 文件信息 | 浏览器 File API |
| `web-awaken` | `menu/App.js` | Web 唤醒 | **废弃** |
| `logout-notify` | `menu/App.js` | 登出通知 | 云端 API 或 Token 过期处理 |
| `is-basic-service-connect` | `menu/App.js` | 基础服务连接状态 | 通过云端 API 查询 |
| `is-init-bs-connecting` | `menu/App.js` | BS 初始化连接中 | 通过云端 API 查询 |

---

## 三、Electron Remote API 依赖

### 3.1 remote 模块使用

| 文件 | 用法 | 用途 | 替换方案 |
|------|------|------|---------|
| `src/common/remote.js` | `import electron from 'electron'` → `electron.remote` | remote 入口 | 浏览器构建用空对象替代 |
| `src/entries/menu/store/thunks.js` | `require('electron')?.remote` / `window.eleRemote` | 获取 app 路径、版本 | 从环境变量或云端 API 获取 |
| `src/component/SysActions/event.ts` | `remote.BrowserWindow.getFocusedWindow()` | 窗口最小化/最大化/关闭 | **废弃** - Web 应用无窗口控制 |
| `src/component/SysHeader/index.tsx` | `remote.getCurrentWindow()` | 判断是否无边框窗口 | **废弃** - 始终使用浏览器标题栏 |
| `src/common/cookie.ts` | `remote.session` | Cookie 读写 | 使用 `document.cookie` 或 `js-cookie` 库 |
| `src/entries/sub/store/base/reducer.js` | `isDev` from remote | 判断开发环境 | 使用 `process.env.NODE_ENV` |
| `src/entries/menu/component/staging/imisChat/index.js` | `isDev` from remote | 判断开发环境 | 使用 `process.env.NODE_ENV` |
| `src/entries/menu/component/EmbedSys/webviewWeb/index.tsx` | `isDev` from remote | 判断开发环境 | 使用 `process.env.NODE_ENV` |

### 3.2 SysActions 组件（窗口控制）

`src/component/SysActions/event.ts` 实现了自定义窗口控制按钮（最小化、最大化、关闭）：

```
当前：Electron 自定义无边框窗口 + 自定义控制按钮
改造后：浏览器标准窗口，SysActions 组件直接废弃
```

**影响的文件**：
- `src/component/SysActions/` - 整个目录废弃
- `src/component/SysHeader/` - 需要简化，去除窗口控制逻辑

---

## 四、Electron 主进程代码（直接删除）

### 4.1 electron/ 目录

以下文件在改造后**全部删除**：

```
electron/
├── electron.js              # 主进程入口
├── utils.js                 # 工具函数
├── event/
│   ├── ipc.js              # IPC 事件处理（所有 ipc.answerMain / ipc.handle 注册）
│   ├── updater.js          # 自动更新
│   └── downloadFile.js     # 文件下载
├── common/
│   ├── createStateWindow.js # 窗口创建
│   ├── screenAdapter.js    # 屏幕适配
│   ├── monitor.js          # 监控
│   └── net.js              # 网络
└── init/
    └── ...                  # 初始化
```

### 4.2 extraResources/ 目录

```
extraResources/
└── load/
    ├── inject.js            # 主窗口 preload（CAS 登录注入） - 废弃
    └── webviewPreload.js    # webview preload - 废弃
```

---

## 五、构建系统改造

### 5.1 当前构建配置

| 文件 | 说明 |
|------|------|
| `config-overrides.js` | Webpack 覆盖配置，包含多入口、conditional-loader 等 |
| `conditional-loader.js` | 浏览器构建时替换 `.browser.js` |
| `conditional-dev-loader.js` | 开发时替换 `.browserDev.js` |
| `webpack.electron.config.js` | Electron 主进程打包配置 |
| `package.json` | scripts 中有 Electron 相关命令 |

### 5.2 BUILD_PATH 环境变量

当前构建根据 `BUILD_PATH` 变量决定入口和加载器：

| BUILD_PATH | 入口 | 说明 |
|------------|------|------|
| `browser` | `[menu]` | 浏览器构建（仅 menu） |
| `browserDev` | `[menu]` | 浏览器开发（仅 menu） |
| `web` | `[menu, sub, vpn, load]` | Web 构建（全入口） |
| `build` | `[vpn, load]` | Electron 打包（仅 vpn + load） |
| 默认 | `[vpn, load, menu, sub]` | 开发（全入口） |

### 5.3 目标构建配置

改造后只需保留 Web 构建模式：

| 变更项 | 当前 | 目标 |
|--------|------|------|
| 入口 | 多种模式 | 仅 `[menu]`（如果 sub 改为 iframe 则保留 `[menu, sub]`） |
| conditional-loader | 按环境替换 `.browser.js` | 直接使用 `.browser.js` 或统一实现 |
| webpack.electron.config.js | Electron 主进程打包 | **删除** |
| Electron 依赖 | `electron`、`electron-builder` 等 | **删除** |
| 构建命令 | `electron-start`、`electron-pack` 等 | **删除** |

### 5.4 需要清理的 npm 依赖

以下 Electron 相关依赖在改造后应删除：

```json
{
  "devDependencies": {
    "electron": "删除",
    "electron-builder": "删除",
    "electron-builder-squirrel-windows": "删除",
    "electron-devtools-installer": "删除",
    "electron-log": "删除（改用浏览器日志）",
    "electron-updater": "删除",
    "electron-better-ipc": "删除",
    "electron-store": "删除（改用 localStorage）",
    "electron-dl": "删除"
  }
}
```

---

## 六、替换方案汇总表

### 6.1 按替换类型分类

#### 类型一：直接废弃（功能不再需要）

| 功能 | 原因 |
|------|------|
| 进程注入控制（runInject、stopBsInject 等） | C++ 客户端自行管理 |
| Java 进程管理（killAll、killJava、checkJava） | 不再有 Java 进程 |
| 自动更新（updateStart、downloadProgress 等） | Web 应用无需客户端更新 |
| WebSocket 端口获取（get-ws-port） | 去除 WebSocket |
| 本地 IP 获取（get-window-ip） | 去除 WebSocket |
| 方舟控制（startFangzhou 等） | C++ 客户端自行管理 |
| 窗口控制（SysActions） | 浏览器标准窗口 |
| CAS 注入（cas-auto-complete-info） | Web 标准登录 |
| 应用退出（app-exit） | Web 应用无此概念 |
| 开发者工具切换（toggle-devtools） | 浏览器自带 |
| 崩溃上报（crash-report） | 改用 ErrorBoundary |

#### 类型二：浏览器 API 替换

| 原功能 | 替换方案 |
|--------|---------|
| `ipc.callMain('open-dialog')` | `<input type="file">` |
| `ipc.send('open-url', url)` | `window.open(url, '_blank')` |
| `ipc.send('app-relaunch')` | `location.reload()` |
| `convert-urls-to-files` | `fetch()` + `Blob` |
| `convert-base64-to-file` | `atob()` + `Blob` + `File` |
| `remote.session` (Cookie) | `document.cookie` / `js-cookie` |
| `isDev` from remote | `process.env.NODE_ENV` |
| `get-file-path` (剪贴板) | `navigator.clipboard.read()` |
| `get-file-entity` (文件) | `File` API |
| 性能指标（get-app-metrics） | `Performance API` |

#### 类型三：云端 API 替换

| 原功能 | 需要新增的云端 API |
|--------|-------------------|
| `get-app-config` | `GET /api/config/app` |
| `cross-origin-request` | `POST /api/proxy/fetch` |
| `hasLoginedAccount` | `GET /api/account/status` |
| `getAllConfig`（WebSocket） | `GET /api/wx/config/all` |
| `forward` + `userlist`（WebSocket） | `GET /api/wx/contacts` |
| `forward` + `login`（WebSocket） | `GET /api/wx/login-status` |
| 文件上传（upload WebSocket） | `POST /api/file/upload`（直传 OSS） |
| 灰度状态（get-is-gray） | `GET /api/config/gray-status` |

#### 类型四：前端状态管理替换

| 原功能 | 替换方案 |
|--------|---------|
| `set-modules` | `localStorage.setItem('modules', ...)` |
| `set-env-settings` | `localStorage.setItem('envSettings', ...)` |
| `global-wxid` | Redux store `dispatch(setGlobalWxid(wxid))` |
| `set-user-info` | Redux store |

#### 类型五：postMessage 替换（webview IPC → iframe postMessage）

| 原功能 | 替换方案 |
|--------|---------|
| `ipc.sendToHost('sub-message', data)` | `parent.postMessage({ type: 'sub-message', data }, origin)` |
| `ipc.on('parent-message', handler)` | `window.addEventListener('message', handler)` |
| `webview.send('parent-message', data)` | `iframe.contentWindow.postMessage({ type: 'parent-message', data }, origin)` |
| `webview.addEventListener('ipc-message', handler)` | `window.addEventListener('message', handler)` |

---

## 七、改造优先级建议

### 7.1 第一步：构建系统改造

1. 修改 `config-overrides.js`，默认使用浏览器构建
2. 删除 `webpack.electron.config.js`
3. 确保 `conditional-loader` 正确替换所有 `.browser.js` 文件
4. 验证 `npm run build` 产出纯 Web 应用

### 7.2 第二步：核心 IPC 替换

1. 改造 `project.js` / `project.browser.js`，确保配置正确获取
2. 替换所有 `ipc.send('open-url')` 为 `window.open()`
3. 替换所有 `ipc.send('userLogout')` 为云端 API 调用
4. 废弃进程注入相关 IPC

### 7.3 第三步：页面架构改造

1. webview → iframe 改造（详见 04 文档）
2. `ipc.sendToHost` → `postMessage` 改造
3. `ipc.on` → `window.addEventListener('message')` 改造

### 7.4 第四步：清理

1. 删除 `electron/` 目录
2. 删除 `extraResources/` 目录
3. 清理 Electron 相关 npm 依赖
4. 删除废弃的 IPC 通道代码

---

## 八、影响评估矩阵

| 文件 | 依赖类型 | 影响程度 | 改造工作量 |
|------|---------|---------|-----------|
| `menu/App.js` | IPC send/on、webview、WS | 极高 | 大 - 核心文件，大量改造 |
| `menu/store/thunks.js` | IPC callMain/send、WS、remote | 极高 | 大 - 通信核心 |
| `sub/App.js` | IPC on/sendToHost | 极高 | 大 - 需全面改为 postMessage |
| `sub/store/base/thunks.js` | IPC sendToHost | 高 | 中 - 消息发送改造 |
| `common/project.js` | IPC sendSync | 高 | 小 - 已有 browser 版本 |
| `common/ipc.js` | electron-better-ipc | 高 | 小 - 已有 browser 版本 |
| `common/paste.js` | IPC callMain | 中 | 小 - 改用 Blob/File |
| `common/downloadFile.js` | IPC callMain | 中 | 小 - 改用 fetch + Blob |
| `common/asyncValidator.js` | IPC callMain | 中 | 小 - 废弃文件路径检查 |
| `common/cookie.ts` | remote.session | 中 | 小 - 改用 document.cookie |
| `common/report.js` | IPC callMain | 低 | 小 - 改用 Performance API |
| `common/remote.js` | electron | 中 | 小 - 已有 browser 版本 |
| `component/SysActions/` | remote.BrowserWindow | 中 | 小 - 废弃 |
| `component/SysHeader/` | remote.getCurrentWindow | 低 | 小 - 去除窗口判断 |
| `entries/load/App.js` | IPC send | 中 | 中 - 登录流程改造 |
| `entries/vpn/App.js` | IPC send | 低 | 小 - 可能整个入口废弃 |
| `numberManage/wechatTab/` | IPC invoke | 高 | 中 - 号管理改为云端 API |
| `EmbedSys/webviewWeb/` | webview、remote | 高 | 中 - 改为 iframe |
| `staging/imisChat/` | webview、remote | 中 | 中 - 改为 iframe |
| 多个 sub 组件（文件操作） | IPC sendToHost | 中 | 中 - 改为浏览器 File API |
| `Header.js` | IPC sendSync | 低 | 小 - 灰度状态改造 |
| `nav/EnvSettingsButton.tsx` | IPC invoke/send | 低 | 小 - 改用 localStorage |
