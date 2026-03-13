# 10 — Electron IPC 通信设计（渲染↔主进程）

> **文档定位**：渲染进程（React 页面）与主进程之间所有 IPC 通道的完整文档。  
> **关联仓库**：`galaxy-client`（Electron 主进程） + `galaxy`（React 前端渲染端）

---

## 目录

1. [IPC 通信技术选型](#1-ipc-通信技术选型)
2. [Preload 脚本与桥接机制](#2-preload-脚本与桥接机制)
3. [ipc.js 全量事件分类解析](#3-ipcjs-全量事件分类解析)
4. [渲染进程侧调用封装](#4-渲染进程侧调用封装)
5. [IPC 事件错误处理约定](#5-ipc-事件错误处理约定)
6. [主进程主动推送渲染进程](#6-主进程主动推送渲染进程)
7. [多窗口场景下的通信](#7-多窗口场景下的通信)
8. [IPC 与 WebSocket 的职责边界](#8-ipc-与-websocket-的职责边界)

---

## 1. IPC 通信技术选型

### 1.1 electron-better-ipc

本项目使用 `electron-better-ipc`（v2.0.1）替代原生 `ipcMain`/`ipcRenderer`。

**优势**：

| 特性 | 原生 IPC | electron-better-ipc |
|------|---------|-------------------|
| API 风格 | 回调模式 | Promise 化 |
| 序列化 | 手动 JSON | 自动序列化/反序列化 |
| 双向通信 | 需要手动 reply | `answerRenderer` 自动回复 |
| 错误传播 | 需要手动 catch | 自动传播 |
| 主进程 API | `ipcMain.on/handle` | `ipc.on/answerRenderer` |
| 渲染进程 API | `ipcRenderer.send/invoke` | `ipc.callMain/send` |

### 1.2 两种通信模式

```
模式一：渲染进程 → 主进程（单向，无返回值）
┌──────────────────┐    ipc.send('channel')     ┌──────────────────┐
│  渲染进程(galaxy) │ ─────────────────────────→ │  主进程(g-client) │
│                  │                             │  ipc.on('channel')│
└──────────────────┘                             └──────────────────┘

模式二：渲染进程 → 主进程 → 渲染进程（双向，有返回值）
┌──────────────────┐  ipc.callMain('channel')   ┌──────────────────┐
│  渲染进程(galaxy) │ ─────────────────────────→ │  主进程(g-client) │
│                  │                             │  answerRenderer() │
│  await result ←  │ ←──── Promise<result> ───── │  return result    │
└──────────────────┘                             └──────────────────┘

模式三：同步调用（渲染进程阻塞等待）
┌──────────────────┐  ipc.send('channel')       ┌──────────────────┐
│  渲染进程(galaxy) │ ─────────────────────────→ │  主进程(g-client) │
│                  │                             │  event.returnValue│
│  同步返回 ←      │ ←──── returnValue ───────── │  = result         │
└──────────────────┘                             └──────────────────┘
```

---

## 2. Preload 脚本与桥接机制

### 2.1 主窗口 webPreferences

**文件路径**：`galaxy-client/src/init/window.js`

```javascript
mainWindow = createStateWindow({
    webPreferences: {
        nodeIntegration: true,       // 渲染进程可访问 Node.js API
        webviewTag: true,            // 允许 <webview> 标签
        contextIsolation: false,     // 不隔离上下文（预置脚本共享 window）
        sandbox: false,              // 不启用沙箱
        preload: path.join(extraResourcesDir, 'load/inject.js'),
    }
});
```

### 2.2 inject.js — 主窗口预载脚本

**文件路径**：`galaxy-client/extraResources/load/inject.js`

```javascript
// 注入全局变量供 galaxy 前端使用
window.require = require;                    // Node.js require
window.eleRemote = require('@electron/remote'); // electron remote
window.isDev = !app.isPackaged;              // 是否开发模式
window.preloadWebviewPath = path.join(       // webview 预载路径
    extraResourcesDir, 'load/webviewPreload.js'
);
```

**安全说明**：由于 `contextIsolation: false`，预载脚本与渲染进程共享同一个 `window` 对象。这意味着渲染进程可以直接访问 `window.require`、`window.eleRemote` 等注入的全局变量。

### 2.3 preload/index.js — 标准预载脚本

**文件路径**：`galaxy-client/src/preload/index.js`

```javascript
// 仅用于展示 Electron/Node/Chromium 版本信息
window.addEventListener('DOMContentLoaded', () => {
    for (const dependency of ['chrome', 'node', 'electron']) {
        const element = document.getElementById(`${dependency}-version`);
        if (element) element.innerText = process.versions[dependency];
    }
});
```

### 2.4 webviewPreload.js — Webview 预载脚本

**文件路径**：`galaxy-client/extraResources/load/webviewPreload.js`

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    readFileAsBase64: (filePath) => ipcRenderer.invoke('readFileAsBase64', filePath)
});
```

与主窗口不同，webview 使用 `contextBridge` 提供受控的 API 暴露，安全性更高。

### 2.5 三层预载体系

```
┌──────────────────────────────────────────────────┐
│ 主窗口 (BrowserWindow)                           │
│  preload: inject.js                              │
│  nodeIntegration: true                           │
│  contextIsolation: false                         │
│                                                  │
│  window.require = require                        │
│  window.eleRemote = remote                       │
│  window.isDev = !isPackaged                      │
│                                                  │
│  ┌─────────────────────────────────────────────┐ │
│  │ <webview> 标签内部                          │ │
│  │  preload: webviewPreload.js                │ │
│  │  contextIsolation: true (webview 默认)     │ │
│  │                                            │ │
│  │  window.electronAPI.readFileAsBase64()     │ │
│  │  (通过 contextBridge 暴露)                  │ │
│  └─────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

---

## 3. ipc.js 全量事件分类解析

**文件路径**：`galaxy-client/src/event/ipc.js`

### 3.1 事件分类总览

| 分类 | 数量 | 通信模式 |
|------|------|---------|
| 用户认证类 | 2 | 单向 `ipc.on` |
| 逆向控制类 | 5 | 单向 `ipc.on` |
| 配置读写类 | 7 | 混合模式 |
| 文件操作类 | 5 | 双向 `answerRenderer` |
| 窗口系统类 | 4 | 单向 `ipc.on` |
| Cookie/Session 类 | 4 | 单向 `ipc.on` |
| WebSocket 端口类 | 2 | 双向 `answerRenderer` |
| 系统信息类 | 2 | 双向 `answerRenderer/handle` |
| 方舟/扩展类 | 2 | 双向 `handle` |

### 3.2 用户认证类

| 事件名 | 方向 | 模式 | 说明 |
|--------|------|------|------|
| `userLogin` | 渲染→主 | `ipc.on` | CAS 登录成功后调用，重新加载页面 URL |
| `userLogout` | 渲染→主 | `ipc.on` | 登出，清除 CASTGC Cookie + 清空 userId |

**userLogin 处理流程**：
```javascript
ipc.on('userLogin', () => {
    getLoadUrlAsync().then(url => {
        app.mainWindow && app.mainWindow.loadURL(url);
    });
});
```

**userLogout 处理流程**：
```javascript
ipc.on('userLogout', () => {
    const url = loginUrl.replace(/login.*$/, '');
    session.defaultSession.cookies
        .remove(url, 'CASTGC')
        .then(() => { store.clearUserId(); })
        .catch(() => { store.clearUserId(); });
});
```

### 3.3 逆向控制类

| 事件名 | 方向 | 模式 | 说明 |
|--------|------|------|------|
| `runInject` | 渲染→主 | `ipc.on` | 拉起微信 Named Pipe 注入（执行 `BasicService.exe pcwx`） |
| `runQyWxInject` | 渲染→主 | `ipc.on` | 拉起企微注入（可选传入 `accountId`） |
| `stop-java` | 渲染→主 | `ipc.on` | 终止 Java 服务进程 |
| `stop-wxwork` | 渲染→主 | `ipc.on` | 终止企业微信进程 |
| `stop-wechat` | 渲染→主 | `ipc.on` | 终止微信进程 |
| `stopBsInject` | 渲染→主 | `ipc.on` | 终止 BasicService 进程 |
| `stopBs64Inject` | 渲染→主 | `ipc.on` | 终止 BasicService64 进程 |

**runQyWxInject 关键逻辑**：
```javascript
ipc.on('runQyWxInject', async (event, accountId) => {
    if (accountId) {
        await replaceAccountFile(accountId);  // 替换账号配置文件
        runQyWxInject(accountId);             // 带配置注入
    } else {
        runQyWxInject();                      // 默认注入
    }
});
```

### 3.4 配置读写类

| 事件名 | 方向 | 模式 | 返回值 | 说明 |
|--------|------|------|--------|------|
| `get-app-config` | 渲染→主 | `ipc.on` (同步) | `event.returnValue` | 同步返回运行时配置 |
| `set-user-info` | 渲染→主 | `ipc.on` | 无 | 写入 CAS 用户信息到 store |
| `set-is-gray` | 渲染→主 | `ipc.on` (同步) | `'ok'` | 设置灰度标记 |
| `get-is-gray` | 渲染→主 | `ipc.on` (同步) | `boolean` | 获取灰度标记 |
| `set-env-settings` | 渲染→主 | `ipc.on` | 无 | 写入环境配置 |
| `get-env-settings` | 渲染→主 | `ipc.handle` | `Promise<object>` | 异步获取环境配置 |
| `set-modules` | 渲染→主 | `ipc.on` | 无 | 设置功能模块配置 |
| `cas-auto-complete-info` | 渲染→主 | `ipc.on` | 无 | 获取 CAS 自动填充信息（通过 `sendToRenderMsg` 返回） |

**get-app-config 关键实现**（同步模式）：
```javascript
ipc.on('get-app-config', (event) => {
    const appConfig = getAppConfig();
    const moreConfig = { devServerRoot, server, type, mode, version };
    if (Array.isArray(app.modules)) {
        Object.assign(appConfig, moreConfig, { modules: app.modules });
    } else {
        Object.assign(appConfig, moreConfig);
    }
    event.returnValue = appConfig;  // 同步返回！
});
```

### 3.5 文件操作类

| 事件名 | 方向 | 模式 | 返回值 | 说明 |
|--------|------|------|--------|------|
| `exist-file` | 渲染→主 | `answerRenderer` | `boolean[]` | 批量检查文件是否存在 |
| `copy-file` | 渲染→主 | `answerRenderer` | `string` | 复制文件到临时目录 |
| `convert-base64-to-file` | 渲染→主 | `answerRenderer` | `object` | Base64 转文件 |
| `convert-urls-to-files` | 渲染→主 | `answerRenderer` | `object[]` | 批量 URL 下载为本地文件 |
| `readFileAsBase64` | 渲染→主 | `ipc.handle` | `string` | 读取文件并转为 Base64 |
| `open-dialog` | 渲染→主 | `answerRenderer` | `object[]` | 打开文件选择对话框 |
| `get-file-entity` | 渲染→主 | `ipc.on` | 无 | 获取文件摘要（通过 `sendToRenderMsg` 返回） |

**readFileAsBase64 实现**：
```javascript
ipc.handle('readFileAsBase64', async (event, filePath) => {
    const formatPath = filePath.replace(/%20/g, ' ');
    return new Promise((resolve, reject) => {
        fs.readFile(formatPath, (err, bitmap) => {
            if (err) { reject(err); return; }
            const base64Data = `data:image/png;base64,${
                Buffer.from(bitmap, 'binary').toString('base64')
            }`;
            resolve(base64Data);
        });
    });
});
```

### 3.6 窗口系统类

| 事件名 | 方向 | 模式 | 说明 |
|--------|------|------|------|
| `open-url` | 渲染→主 | `ipc.on` | 使用系统默认浏览器打开 URL |
| `open-file` | 渲染→主 | `ipc.on` | 使用系统默认程序打开本地文件 |
| `app-relaunch` | 渲染→主 | `ipc.on` | 重启应用（`app.relaunch() + app.quit()`） |
| `app-exit` | 渲染→主 | `ipc.on` | 退出应用（`app.quit()`） |

### 3.7 Cookie/Session 类

| 事件名 | 方向 | 模式 | 说明 |
|--------|------|------|------|
| `writeUqunCookie` | 渲染→主 | `ipc.on` | 写入 U群 站的 Cookie（`isFromTongBao` + `tongBaoUserId`） |
| `writeGidCookie` | 渲染→主 | `ipc.on` | 写入 GID Cookie |
| `addLocalAccount` | 渲染→主 | `ipc.on` | 备份本地登录账号文件 |
| `getLocalAccounts` | 渲染→主 | `ipc.on` | 获取本地账号列表（通过 `sendToRenderMsg` 返回） |

**writeUqunCookie 实现**：
```javascript
ipc.on('writeUqunCookie', async (event, message) => {
    await session.defaultSession.cookies.set({
        url: message.uqunUrl + '/',
        name: 'isFromTongBao', value: 'true'
    });
    await session.defaultSession.cookies.set({
        url: message.uqunUrl + '/',
        name: 'tongBaoUserId', value: message.userId
    });
});
```

### 3.8 WebSocket 端口与系统信息类

| 事件名 | 方向 | 模式 | 返回值 | 说明 |
|--------|------|------|--------|------|
| `get-ws-port` | 渲染→主 | `answerRenderer` | `number` | 获取 WebSocket 端口 |
| `get-window-ip` | 渲染→主 | `answerRenderer` | `string` | 获取本机 IP |
| `get-app-metrics` | 渲染→主 | `answerRenderer` | `object[]` | 获取进程内存指标 |
| `cross-origin-request` | 渲染→主 | `answerRenderer` | `any` | 跨域 GET 请求代理 |

### 3.9 DLL 调用类

| 事件名 | 方向 | 模式 | 返回值 | 说明 |
|--------|------|------|--------|------|
| `hasLoginedAccount` | 渲染→主 | `ipc.handle` | `boolean` | 检测企微是否有已登录账号（调用 `Clibrary.hasLoginedAccount`） |
| `startFangzhou` | 渲染→主 | `ipc.handle` | `boolean` | 启动方舟（目前已废弃，返回 `false`） |
| `hasFangzhouStarted` | 渲染→主 | `ipc.handle` | `boolean` | 检测方舟是否启动（已废弃，返回 `false`） |

---

## 4. 渲染进程侧调用封装

### 4.1 galaxy/src/common/ipc.js

```javascript
import ipc from 'electron-better-ipc/source/renderer';
export default ipc;
```

所有 IPC 调用统一通过此模块导入。

### 4.2 galaxy/src/common/remote.js

```javascript
import electron from 'electron';
let remote = electron?.remote || window.eleRemote;
export const isDev = !remote?.app?.isPackaged || window.isDev;
export default remote;
```

通过 `@electron/remote`（或 `inject.js` 注入的 `window.eleRemote`）访问主进程模块。

### 4.3 渲染进程调用示例

**获取运行时配置（同步）**：
```javascript
import ipc from '@/common/ipc';

// 同步调用，直接返回结果
const appConfig = ipc.sendSync('get-app-config');
```

**异步调用示例（thunks.js）**：
```javascript
// 获取 WebSocket 端口
const port = await ipc.callMain('get-ws-port');

// 获取本机 IP
const windowIp = await ipc.callMain('get-window-ip');

// 触发注入
ipc.send(type === 'qywx' ? 'runQyWxInject' : 'runInject');
```

**设置用户信息**：
```javascript
ipc.send('set-user-info', { user: casId, department: dept });
```

**检测企微登录状态**：
```javascript
const hasLogged = await ipc.callMain('hasLoginedAccount', wxid);
```

### 4.4 浏览器模式适配

**文件路径**：`galaxy/src/common/ipc.browser.js`

在 `BUILD_PATH=browser` 模式下，`conditional-loader` 会将 `ipc.js` 替换为 `ipc.browser.js`：

```javascript
// 返回一个 Proxy，所有方法调用都返回 Promise.resolve()
const proxy = new Proxy({}, {
    get: () => (...args) => Promise.resolve()
});
export default proxy;
```

这样前端代码在浏览器中运行时不会因为缺少 Electron IPC 而报错。

---

## 5. IPC 事件错误处理约定

### 5.1 主进程侧

```javascript
// answerRenderer 模式：异常通过 Promise reject 传播到渲染进程
ipc.answerRenderer('copy-file', async arg => {
    try {
        return await copyFileToTemp(arg);
    } catch (error) {
        log.error('COPY FILE ERROR', error.message);
        throw error;  // 渲染进程会收到 rejection
    }
});

// ipc.on 模式：异常仅在主进程记录日志
ipc.on('open-file', (event, url) => {
    try {
        shell.openPath(url);
    } catch (error) {
        log.error('OPEN FILE ERROR', error);
        // 渲染进程不知道操作是否成功
    }
});
```

### 5.2 错误处理模式总结

| 通信模式 | 错误传播 | 渲染进程感知 |
|---------|---------|-------------|
| `answerRenderer` | throw → 渲染进程 catch | 可以感知并处理 |
| `ipc.handle` | throw → 渲染进程 catch | 可以感知并处理 |
| `ipc.on`（单向） | 仅主进程日志 | 无法感知 |
| `ipc.on`（同步 returnValue） | 返回 undefined | 间接感知 |

---

## 6. 主进程主动推送渲染进程

### 6.1 sendToRenderMsg 机制

**文件路径**：`galaxy-client/src/utils.js`

```javascript
function sendToRenderMsg(channel, data) {
    const { mainWindow } = app;
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send(channel, data);
    }
}
```

### 6.2 使用场景

| 推送事件 | 触发时机 | 数据内容 |
|---------|---------|---------|
| `cas-auto-complete-info` | 渲染进程请求时 | `{ username }` |
| `get-file-entity` | 渲染进程请求时 | 文件摘要信息 |
| `get-file-names` | 渲染进程请求时 | 剪贴板文件列表 |
| `get-local-accounts-notify` | 渲染进程请求时 | 本地账号列表 |

### 6.3 渲染进程监听

```javascript
// galaxy 前端侧
import { ipcRenderer } from 'electron';

ipcRenderer.on('cas-auto-complete-info', (event, info) => {
    // 处理自动填充信息
    setAutoCompleteInfo(info);
});
```

---

## 7. 多窗口场景下的通信

### 7.1 窗口架构

```
┌──────────────────────────┐
│       主进程              │
│   (galaxy-client)         │
│                          │
│   ┌── mainWindow         │
│   │   (menu.html)        │
│   │                      │
│   ├── subWindow          │
│   │   (sub.html)         │
│   │                      │
│   └── vpnWindow          │
│       (vpn.html)         │
└──────────────────────────┘
```

### 7.2 广播 vs 定向

```javascript
// 广播到所有窗口
BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('broadcast-event', data);
});

// 定向发送到主窗口
app.mainWindow.webContents.send('targeted-event', data);
```

### 7.3 跨窗口限制

- **Redux 不共享**：`menu.html` 和 `sub.html` 各有独立的 Redux Store
- **WebSocket 不共享**：只有 `menu.html` 维护与 `frontServer` 的 WebSocket 连接
- **通信方式**：`sub.html` 需要通过 Electron IPC 与主进程交互，无法直接与 `menu.html` 通信

---

## 8. IPC 与 WebSocket 的职责边界

### 8.1 两种通信通道的分工

```
┌───────────────────────────────────────────────────────┐
│                    通信架构                            │
│                                                       │
│  ┌─────────┐  Electron IPC  ┌──────────────────┐    │
│  │ galaxy  │ ◄────────────► │ galaxy-client     │    │
│  │ (渲染)  │  (同步请求/    │ (主进程)          │    │
│  │         │   配置读写/     │                   │    │
│  │         │   文件操作)     │                   │    │
│  │         │                │                   │    │
│  │         │  WebSocket     │ frontServer.js    │    │
│  │         │ ◄────────────► │ (WS Server)       │    │
│  │         │  (实时推送/     │                   │    │
│  │         │   业务消息/     │                   │    │
│  │         │   状态变更)     │                   │    │
│  └─────────┘                └──────────────────┘    │
└───────────────────────────────────────────────────────┘
```

### 8.2 职责对照表

| 通道 | 使用场景 | 特点 |
|------|---------|------|
| **Electron IPC** | 配置读写、文件操作、登录登出、窗口控制、DLL 调用 | 同步/异步、请求-响应模式、安全可靠 |
| **WebSocket** | 微信/企微消息推送、账号状态变更、实时通知 | 异步推送、服务端主动推送、高频消息 |

### 8.3 选择原则

- **一次性请求**用 IPC：如获取配置、读取文件、触发动作
- **持续推送**用 WebSocket：如消息流、状态变更、心跳
- **同步数据**用 IPC：如 `get-app-config` 使用 `event.returnValue`
- **大量数据**用 WebSocket：如好友列表、群聊列表的实时更新

---

## 附录 A：IPC 事件全量速查表

| # | 事件名 | 模式 | 方向 | 分类 |
|---|--------|------|------|------|
| 1 | `userLogin` | `on` | 渲→主 | 认证 |
| 2 | `userLogout` | `on` | 渲→主 | 认证 |
| 3 | `runInject` | `on` | 渲→主 | 逆向 |
| 4 | `runQyWxInject` | `on` | 渲→主 | 逆向 |
| 5 | `stop-java` | `on` | 渲→主 | 逆向 |
| 6 | `stop-wxwork` | `on` | 渲→主 | 逆向 |
| 7 | `stop-wechat` | `on` | 渲→主 | 逆向 |
| 8 | `stopBsInject` | `on` | 渲→主 | 逆向 |
| 9 | `stopBs64Inject` | `on` | 渲→主 | 逆向 |
| 10 | `get-app-config` | `on`(同步) | 渲→主 | 配置 |
| 11 | `set-user-info` | `on` | 渲→主 | 配置 |
| 12 | `set-is-gray` | `on`(同步) | 渲→主 | 配置 |
| 13 | `get-is-gray` | `on`(同步) | 渲→主 | 配置 |
| 14 | `set-env-settings` | `on` | 渲→主 | 配置 |
| 15 | `get-env-settings` | `handle` | 渲→主 | 配置 |
| 16 | `set-modules` | `on` | 渲→主 | 配置 |
| 17 | `cas-auto-complete-info` | `on` | 渲→主 | 配置 |
| 18 | `exist-file` | `answerRenderer` | 渲↔主 | 文件 |
| 19 | `copy-file` | `answerRenderer` | 渲↔主 | 文件 |
| 20 | `convert-base64-to-file` | `answerRenderer` | 渲↔主 | 文件 |
| 21 | `convert-urls-to-files` | `answerRenderer` | 渲↔主 | 文件 |
| 22 | `readFileAsBase64` | `handle` | 渲↔主 | 文件 |
| 23 | `open-dialog` | `answerRenderer` | 渲↔主 | 文件 |
| 24 | `get-file-entity` | `on` | 渲→主 | 文件 |
| 25 | `open-url` | `on` | 渲→主 | 窗口 |
| 26 | `open-file` | `on` | 渲→主 | 窗口 |
| 27 | `app-relaunch` | `on` | 渲→主 | 窗口 |
| 28 | `app-exit` | `on` | 渲→主 | 窗口 |
| 29 | `writeUqunCookie` | `on` | 渲→主 | Cookie |
| 30 | `writeGidCookie` | `on` | 渲→主 | Cookie |
| 31 | `addLocalAccount` | `on` | 渲→主 | Cookie |
| 32 | `getLocalAccounts` | `on` | 渲→主 | Cookie |
| 33 | `get-ws-port` | `answerRenderer` | 渲↔主 | 系统 |
| 34 | `get-window-ip` | `answerRenderer` | 渲↔主 | 系统 |
| 35 | `get-app-metrics` | `answerRenderer` | 渲↔主 | 系统 |
| 36 | `cross-origin-request` | `answerRenderer` | 渲↔主 | 系统 |
| 37 | `hasLoginedAccount` | `handle` | 渲↔主 | DLL |
| 38 | `startFangzhou` | `handle` | 渲↔主 | DLL |
| 39 | `hasFangzhouStarted` | `handle` | 渲↔主 | DLL |

## 附录 B：关键文件路径索引

| 功能 | 文件路径 |
|------|---------|
| 主进程 IPC 事件注册 | `galaxy-client/src/event/ipc.js` |
| 渲染进程 IPC 封装 | `galaxy/src/common/ipc.js` |
| 浏览器模式 IPC 空实现 | `galaxy/src/common/ipc.browser.js` |
| Electron 别名 | `galaxy/src/alias/electron.js` |
| remote 封装 | `galaxy/src/common/remote.js` |
| 主窗口预载脚本 | `galaxy-client/extraResources/load/inject.js` |
| Webview 预载脚本 | `galaxy-client/extraResources/load/webviewPreload.js` |
| 标准预载脚本 | `galaxy-client/src/preload/index.js` |
| store 变更事件 | `galaxy-client/src/event/store.js` |
| 工具函数 (sendToRenderMsg) | `galaxy-client/src/utils.js` |

---

*文档生成时间：2026-03-13 | 基于 galaxy-client + galaxy 仓库实际代码分析*
