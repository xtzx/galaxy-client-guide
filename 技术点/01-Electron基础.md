# Electron 技术详解

> 桌面应用开发框架

---

## 一、Electron 简介

### 1.1 什么是 Electron

Electron 是一个使用 Web 技术（HTML、CSS、JavaScript）构建跨平台桌面应用的框架。它结合了 Chromium 和 Node.js，让前端开发者能够开发桌面应用。

```
┌─────────────────────────────────────────────────────────────────┐
│                      Electron 架构                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    你的应用代码                          │   │
│  │        (HTML + CSS + JavaScript + Node.js)              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                       Electron                           │   │
│  │  ┌─────────────────┐       ┌─────────────────────────┐  │   │
│  │  │   Chromium      │       │       Node.js           │  │   │
│  │  │ (渲染网页)       │       │    (系统API访问)        │  │   │
│  │  └─────────────────┘       └─────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │               操作系统 (Windows/macOS/Linux)             │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 本项目使用的 Electron 版本

```json
{
  "electron": "20.0.2"
}
```

> ⚠️ **为什么锁定版本？**
> 
> 项目依赖 `ffi-napi` 调用 C++ DLL，该库与 Node.js 的 N-API 版本强相关。
> Electron 20.0.2 内置的 Node.js ABI 版本与 ffi-napi 兼容，升级可能导致 DLL 无法加载。

---

## 二、进程模型

### 2.1 主进程 vs 渲染进程

```
┌─────────────────────────────────────────────────────────────────┐
│                    Electron 进程模型                             │
└─────────────────────────────────────────────────────────────────┘

                    ┌─────────────────────────┐
                    │       主进程 (Main)       │
                    │    src/electron.js      │
                    │                         │
                    │  • 管理应用生命周期      │
                    │  • 创建/管理窗口         │
                    │  • 访问系统API          │
                    │  • 处理IPC通信          │
                    └───────────┬─────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
              ▼                 ▼                 ▼
    ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
    │ 渲染进程1       │ │ 渲染进程2       │ │ 渲染进程N       │
    │ (BrowserWindow) │ │ (BrowserWindow) │ │ (BrowserWindow) │
    │                 │ │                 │ │                 │
    │ • 显示网页内容  │ │ • 显示网页内容  │ │ • 显示网页内容  │
    │ • 运行前端代码  │ │ • 运行前端代码  │ │ • 运行前端代码  │
    └─────────────────┘ └─────────────────┘ └─────────────────┘
```

### 2.2 本项目的进程结构

```javascript
// 主进程入口: src/electron.js
// 主进程职责:
// 1. 启动应用、创建窗口
// 2. 处理 IPC 通信
// 3. 管理逆向服务连接
// 4. MQTT 消息收发
// 5. WebSocket 服务

// 渲染进程: 加载远程 Web 页面
// https://tongbao.umeng100.com/web5
```

---

## 三、本项目中 Electron 的使用

### 3.1 应用入口

```javascript
// src/electron.js
const { mode, type } = require('./common/urls');
const initLog = require('./init/initLog');
const addAppEvent = require('./event/app');
const addIpcEvent = require('./event/ipc');
const addStoreEvent = require('./event/store');
const AppStart = require('./msg-center/start/appStart');

initLog();

function bootstrap() {
    let isQuit = addAppEvent();  // 添加应用事件
    if (isQuit) return;
    
    addIpcEvent();               // 添加 IPC 事件
    addStoreEvent();             // 添加 Store 事件
    AppStart.run();              // 启动消息中心
}

bootstrap();
```

### 3.2 应用事件处理

```javascript
// src/event/app.js
const { app, dialog } = require('electron');

module.exports = () => {
    // 单实例锁：防止多开
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
        app.quit();
        return true;
    }
    
    // 处理第二实例启动
    app.on('second-instance', (event, argv) => {
        const { mainWindow } = app;
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
    
    // 应用就绪
    app.on('ready', async () => {
        initWindow();        // 创建窗口
        initRegedit();       // 初始化注册表
    });
    
    // 应用激活 (macOS)
    app.on('activate', () => {
        if (app.mainWindow === null) {
            initWindow();
        }
    });
    
    // 应用即将退出
    app.on('before-quit', event => {
        event.preventDefault();
        stopBasicService(() => {
            RegistryConfig.removeAll();
            app.exit();
        });
    });
    
    // 渲染进程崩溃
    app.on('render-process-gone', event => {
        crashOrErrorReport('RendererProcessCrashed', event);
    });
};
```

### 3.3 窗口创建

```javascript
// src/init/window.js
const { app, session, Menu } = require('electron');
const createStateWindow = require('../common/createStateWindow');

module.exports = () => {
    const mainWindow = app.mainWindow = createStateWindow({
        width: 1060,
        height: 680,
        minWidth: 1060,
        minHeight: 680,
        webPreferences: {
            sandbox: false,                    // 禁用沙箱（需要 Node.js API）
            preload: path.resolve(__dirname, '../../extraResources/load/inject.js'),
            nodeIntegration: true,             // 允许渲染进程使用 Node.js
            webviewTag: true,                  // 允许使用 webview 标签
            allowRunningInsecureContent: true, // 允许加载不安全内容
            enableRemoteModule: true,          // 启用 remote 模块
            contextIsolation: false,           // 禁用上下文隔离
        },
        show: false,                           // 先不显示，等加载完成
        icon: path.resolve(__dirname, '../../extraResources/icon.ico'),
    });
    
    // 移除默认菜单
    mainWindow.removeMenu();
    
    // 加载页面
    getLoadUrlAsync().then(url => {
        mainWindow.loadURL(url);
    });
    
    // 加载完成后显示窗口
    mainWindow.once('ready-to-show', () => {
        app.mainWindow.show();
    });
};
```

---

## 四、IPC 通信

### 4.1 IPC 通信模式

```
┌─────────────────────────────────────────────────────────────────┐
│                      IPC 通信模式                                │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────┐                         ┌─────────────────┐
│     主进程       │                         │     渲染进程     │
│                 │   ipcMain.on / handle   │                 │
│  ipcMain        │◄────────────────────────│  ipcRenderer    │
│                 │                         │                 │
│                 │   webContents.send      │                 │
│                 ├────────────────────────►│                 │
└─────────────────┘                         └─────────────────┘
```

### 4.2 本项目使用 electron-better-ipc

```javascript
// 安装更友好的 IPC 封装
// npm install electron-better-ipc

// src/event/ipc.js - 主进程
const ipc = require('electron-better-ipc/source/main');

module.exports = () => {
    // 同步监听
    ipc.on('get-app-config', (event) => {
        const appConfig = getAppConfig();
        event.returnValue = appConfig;  // 同步返回
    });
    
    // 异步监听
    ipc.on('runInject', () => {
        runInject();  // 启动逆向服务
    });
    
    // Promise 风格的异步处理
    ipc.answerRenderer('convert-base64-to-file', async arg => {
        const imageInfo = await convertBase64ToFile(arg);
        return imageInfo;
    });
    
    // 新版异步处理 (ipcMain.handle)
    ipc.handle('readFileAsBase64', async (event, filePath) => {
        return fs.readFileSync(filePath, 'base64');
    });
};

// 渲染进程调用（React 代码）
// const { ipcRenderer } = require('electron');
// const config = ipcRenderer.sendSync('get-app-config');
// const imageInfo = await ipcRenderer.invoke('convert-base64-to-file', data);
```

### 4.3 主进程向渲染进程发送消息

```javascript
// src/utils.js
exports.sendToRenderMsg = (msg, text) => {
    try {
        const { mainWindow } = app;
        mainWindow && mainWindow.webContents && mainWindow.webContents.send(msg, text);
    } catch (error) {
        log.error('SEND MESSAGE TO RENDER ERROR', error.message);
    }
};

// 使用示例
sendToRenderMsg('get-file-names', fileNames);
sendToRenderMsg('logout-notify');
sendToRenderMsg('web-awaken', url);
```

---

## 五、@electron/remote 模块

### 5.1 为什么需要 remote

从 Electron 14 开始，`remote` 模块被移除，需要单独安装 `@electron/remote`。
它允许渲染进程直接调用主进程模块。

```javascript
// 主进程初始化
// src/init/window.js
const remoteMain = require('@electron/remote/main');
remoteMain.initialize();

// 为窗口启用 remote
remoteMain.enable(mainWindow.webContents);

// 渲染进程使用
const { app, dialog } = require('@electron/remote');
const version = app.getVersion();
dialog.showMessageBox({ message: 'Hello' });
```

---

## 六、自动更新

### 6.1 electron-updater

```javascript
// src/event/updater.js
const { autoUpdater } = require('electron-updater');

module.exports = callbackFun => {
    autoUpdater.autoInstallOnAppQuit = false;
    
    // 设置更新地址
    ipc.on('setUpdateUrl', (event, version) => {
        const feedURL = `${updateUrl}/${version}`;
        autoUpdater.setFeedURL(feedURL);
    });
    
    // 执行更新检查
    ipc.on('checkForUpdate', () => {
        autoUpdater.checkForUpdates();
    });
    
    // 退出并安装更新
    ipc.on('checkJava', (event, flag) => {
        // 确保进程已关闭后安装更新
        callbackFun();
        autoUpdater.quitAndInstall();
    });
};
```

### 6.2 更新地址配置

```yaml
# config/weixinzhushou/build.yml
publish:
  provider: generic
  url: http://127.0.0.1   # 占位，实际通过代码设置
  channel: latest
```

---

## 七、数据持久化

### 7.1 electron-store

```javascript
// src/common/store.js
const Store = require('electron-store');
const store = new Store();

module.exports = {
    // 获取/设置 GID
    getGid: () => store.get('gid'),
    setGid: (gid) => store.set('gid', gid),
    
    // 用户ID
    getUserId: () => store.get('userId'),
    setUserId: (userId) => store.set('userId', userId),
    clearUserId: () => store.set('userId', ''),
    
    // 监听变化
    onUserIdChange: store.onDidChange.bind(store, 'userId'),
    
    // 用户信息
    setUserInfo: (info) => store.set('userInfo', info),
    getUserInfo: () => store.get('userInfo'),
    
    // 环境设置
    getEnvSettings: () => store.get('envSettings'),
    setEnvSettings: (settings) => store.set('envSettings', settings),
};

// 使用示例
store.setUserInfo({ user: 'zhangsan', id: '123' });
const userInfo = store.getUserInfo();
```

---

## 八、日志系统

### 8.1 electron-log

```javascript
// src/init/initLog.js
const log = require('electron-log');

function initLog() {
    // 文件日志格式
    log.transports.file.format = '{h}:{i}:{s}:{ms} {text}';
    
    // 只记录 error 级别到文件
    log.transports.file.level = 'error';
    
    // 日志文件最大大小：100MB
    log.transports.file.maxSize = 1024 * 1024 * 100;
}

// 使用示例
log.info('应用启动');
log.warn('警告信息');
log.error('错误信息', error);
```

### 8.2 日志文件位置

```
Windows: %APPDATA%\<app-name>\logs\
macOS:   ~/Library/Logs/<app-name>/
Linux:   ~/.config/<app-name>/logs/
```

---

## 九、构建打包

### 9.1 electron-builder 配置

```yaml
# config/weixinzhushou/build.yml
appId: com.baijiahulian.tqclient.
copyright: Copyright © 2021 PZTD
productName: 高途微信助手
artifactName: Weixinzhushou-${os}-${version}.${ext}
asar: false                # 不打包成 asar（因为需要加载 DLL）

files:
  - '**/*'
  - '!**/*.pfx'            # 排除证书
  - '!**/config'           # 排除配置目录
  - '!**/scripts'          # 排除脚本目录

directories:
  buildResources: build
  output: dist/weixinzhushou

nsis:
  allowToChangeInstallationDirectory: true
  deleteAppDataOnUninstall: false
  oneClick: false
  perMachine: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: 高途微信助手

win:
  target: nsis
  icon: extraResources/icon.ico
  requestedExecutionLevel: requireAdministrator  # 需要管理员权限
  verifyUpdateCodeSignature: true
  signAndEditExecutable: true
  signDlls: true
  publisherName: 高途教育科技集团有限公司
  certificateFile: newSignCert.pfx
  certificatePassword: xxxxxx
```

### 9.2 构建命令

```bash
# 测试环境构建
npm run app-build:test

# 生产环境构建
npm run app-build:prod

# 或使用脚本
node ./scripts/build.js
```

---

## 十、安全注意事项

### 10.1 当前配置的安全风险

```javascript
// ⚠️ 以下配置存在安全风险，但项目需要使用 Node.js API
webPreferences: {
    nodeIntegration: true,       // 渲染进程可访问 Node.js
    contextIsolation: false,     // 禁用上下文隔离
    enableRemoteModule: true,    // 启用 remote 模块
    allowRunningInsecureContent: true,
}
```

### 10.2 建议的安全改进

如果未来需要提升安全性：

1. 启用 `contextIsolation: true`
2. 使用 preload 脚本暴露安全的 API
3. 避免在渲染进程直接使用 Node.js
4. 使用 CSP（内容安全策略）

```javascript
// 更安全的配置示例
webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    preload: path.join(__dirname, 'preload.js'),
}

// preload.js - 只暴露必要的 API
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
    getConfig: () => ipcRenderer.invoke('get-app-config'),
    sendMessage: (msg) => ipcRenderer.send('send-message', msg),
});
```

---

## 十一、常见问题

### Q1: 为什么 Electron 版本不能升级？

A: 项目依赖 `ffi-napi` 调用 Windows DLL，该库与特定的 Node.js ABI 版本绑定。Electron 20.0.2 的 ABI 版本与当前 ffi-napi 兼容。

### Q2: 如何调试主进程？

```bash
# 启动时添加 --inspect 参数
npm run start:dev
# 对应命令: electron --inspect=5678 ./src/electron.js

# 在 Chrome 中打开
chrome://inspect
```

### Q3: 如何调试渲染进程？

```javascript
// 代码中打开 DevTools
mainWindow.webContents.openDevTools({
    mode: 'undocked',
    activate: false,
});

// 或使用快捷键 Ctrl+Shift+I
```

### Q4: 应用如何实现单实例？

```javascript
// src/event/app.js
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
    return true;
}
```

---

## 十二、学习资源

- [Electron 官方文档](https://www.electronjs.org/docs)
- [Electron API 演示](https://github.com/electron/electron-api-demos)
- [electron-builder 文档](https://www.electron.build/)
- [electron-store 文档](https://github.com/sindresorhus/electron-store)
- [electron-log 文档](https://github.com/megahertz/electron-log)
