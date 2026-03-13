# 15 自动更新机制（electron-updater）

> **文档定位**：客户端如何检测、下载、安装新版本。  
> **核心技术**：`electron-updater`（检查更新 + 安装重启） + 自定义 `DownloadFile`（文件下载） + `extract-zip`（解压）

---

## 目录

1. [更新机制总览](#1-更新机制总览)
2. [updater.js 完整解析](#2-updaterjs-完整解析)
3. [更新地址配置与环境区分](#3-更新地址配置与环境区分)
4. [自定义下载流程 downloadFile.js](#4-自定义下载流程-downloadfilejs)
5. [ZIP 解压 extractZip.js](#5-zip-解压-extractzipjs)
6. [electron-builder 发布配置](#6-electron-builder-发布配置)
7. [NSIS 安装包配置](#7-nsis-安装包配置)
8. [前端触发更新的流程](#8-前端触发更新的流程)
9. [安装前的进程检查](#9-安装前的进程检查)
10. [与窗口关闭的联动](#10-与窗口关闭的联动)
11. [完整更新时序图](#11-完整更新时序图)
12. [关键代码路径索引](#12-关键代码路径索引)

---

## 1. 更新机制总览

Galaxy Client 的更新采用**混合方案**：

- 使用 `electron-updater` 进行**更新检查**和**安装重启**
- 使用自定义 `DownloadFile` 类通过 `webContents.downloadURL` 进行**文件下载**
- 支持两种更新包格式：`.exe` 安装包和 `.zip` 增量包

```
前端渲染进程                      主进程 (updater.js)                  更新服务器
    │                                │                                  │
    │ ipc: setUpdateUrl(version)     │                                  │
    ├───────────────────────────────▶│                                  │
    │                                │ autoUpdater.setFeedURL(url)      │
    │                                │                                  │
    │ ipc: checkForUpdate            │                                  │
    ├───────────────────────────────▶│                                  │
    │                                │ autoUpdater.checkForUpdates() ──▶│
    │                                │                                  │
    │ ipc: checkDownloadFile(url)    │                                  │
    ├───────────────────────────────▶│                                  │
    │                                │ webContents.downloadURL(url) ───▶│
    │                                │◀──── 下载进度 ─────────────────── │
    │◀── downloadProgress ──────────│                                  │
    │◀── update-downloaded ─────────│                                  │
    │                                │                                  │
    │ ipc: checkJava                 │                                  │
    ├───────────────────────────────▶│                                  │
    │                                │ 检查进程 → quitAndInstall()      │
```

---

## 2. updater.js 完整解析

**文件路径**：`galaxy-client/src/event/updater.js`

```javascript
const { autoUpdater } = require('electron-updater');
const ipc = require('electron-better-ipc/source/main');
const DownloadFile = require('./downloadFile');

module.exports = callbackFun => {
    const message = {
        error: { status: -1, msg: '更新出错' },
        checking: { status: 0, msg: '正在检查更新……' },
        updateAva: { status: 1, msg: '检测到新版本，正在下载……' },
        updateNotAva: { status: 2, msg: '现在使用的就是最新版本，不用更新' },
    };

    autoUpdater.autoInstallOnAppQuit = false;

    ipc.on('setUpdateUrl', (event, version) => { ... });
    ipc.on('checkForUpdate', () => { ... });
    ipc.on('checkDownloadFile', (event, downloadUrl) => { ... });
    ipc.on('checkJava', (event, flag) => { ... });
};
```

### 2.1 初始化参数

| 参数 | 来源 | 说明 |
|------|------|------|
| `callbackFun` | `window.js` 传入 | 更新安装前的回调，设置 `updateFlag = true` |

### 2.2 autoInstallOnAppQuit = false

禁止 electron-updater 在应用退出时自动安装更新。由应用自身控制安装时机（需先确保 Java 和微信进程已退出）。

### 2.3 message 对象（未使用）

代码中定义了 `message` 对象包含各种更新状态消息，但实际**未被使用**。项目也**未注册** electron-updater 的标准事件（`checking-for-update`、`update-available`、`update-downloaded`），说明更新的 UI 反馈完全由自定义下载流程控制。

### 2.4 四个 IPC 监听器

| IPC 事件 | 触发来源 | 功能 |
|----------|----------|------|
| `setUpdateUrl` | 前端渲染进程 | 根据版本号和环境设置更新源地址 |
| `checkForUpdate` | 前端渲染进程 | 调用 `autoUpdater.checkForUpdates()` |
| `checkDownloadFile` | 前端渲染进程 | 使用自定义 `DownloadFile` 下载更新包 |
| `checkJava` | 前端渲染进程 | 检查 Java/微信进程是否已退出，然后安装 |

---

## 3. 更新地址配置与环境区分

### 3.1 setUpdateUrl 逻辑

```javascript
ipc.on('setUpdateUrl', (event, version) => {
    let feedURL = '';
    if (type === 'prod') {
        feedURL = `${updateUrl}/${version}`;
    } else {
        let mainVersion;
        const match = version.match(/^\d+\.\d+\.\d+/);
        if (match) {
            mainVersion = match[0];
        }
        if (mainVersion) {
            feedURL = `${updateUrl}/${mainVersion}/${version}/${appConfig.elfkey}`;
        }
    }
    autoUpdater.setFeedURL(feedURL);
});
```

### 3.2 URL 格式

| 环境 | URL 格式 | 示例 |
|------|----------|------|
| 生产 | `${updateUrl}/${version}` | `https://oss.example.com/2.3.1` |
| 测试 | `${updateUrl}/${mainVersion}/${version}/${elfkey}` | `https://oss.example.com/2.3.1/2.3.1.5/weixinzhushou` |

测试环境的 URL 多了 `mainVersion` 和 `elfkey` 两个层级，用于实现：
- **主版本隔离**：不同主版本的更新包存放在不同目录
- **产品线隔离**：`elfkey` 区分微信助手/大麦/天权等产品线

### 3.3 updateUrl 配置

**文件路径**：`galaxy-client/src/common/urls.js`

`updateUrl` 根据环境配置不同的 OSS 地址，指向存放更新包的对象存储路径。

---

## 4. 自定义下载流程 downloadFile.js

**文件路径**：`galaxy-client/src/event/downloadFile.js`

### 4.1 为什么不用 electron-updater 自带下载

项目选择自定义下载，原因包括：
- 需要支持 `.zip` 增量更新包（electron-updater 默认只支持 NSIS 安装包）
- 需要细粒度控制下载进度通知
- 需要在安装前执行额外操作（停止 DLL 注入、解压等）

### 4.2 DownloadFile 类

```javascript
class Main {
    constructor(mainWindow, downloadUrl) {
        this.version = app.getVersion();
        this.exeFileType = downloadUrl.indexOf('.zip') > -1 ? 'exe' : 'downloads';
        const downloadFileName = downloadUrl.substr(downloadUrl.lastIndexOf('/') + 1);
        this.historyFilePath = join(dirname(app.getPath(this.exeFileType)), downloadFileName);
        this.mainWindow = mainWindow;
        this.downloadUrl = downloadUrl;
    }

    start() {
        utils.sendToRenderMsg('updateStart', true);
        // 检查历史文件 → 下载 → 进度通知 → 完成处理
    }
}
```

### 4.3 下载流程详解

1. **通知前端开始**：`sendToRenderMsg('updateStart', true)`
2. **检查历史文件**：
   - `.exe` 文件已存在 → 直接发送 `update-downloaded`
   - `.zip` 文件已存在 → 删除后重新下载
3. **启动下载**：`mainWindow.webContents.downloadURL(downloadUrl)`
4. **进度通知**：`sendToRenderMsg('downloadProgress', percent)`
5. **下载完成**：
   - `.exe` → 直接通知 `update-downloaded`
   - `.zip` → 先停止 DLL 注入 → 等待 10 秒 → 解压 → 通知 `update-downloaded`

### 4.4 发送给前端的事件

| 事件 | 数据 | 时机 |
|------|------|------|
| `updateStart` | `true` | 开始下载 |
| `downloadProgress` | `"45"` (百分比字符串) | 下载进行中 |
| `update-downloaded` | `{ filePath }` | 下载/解压完成 |
| `updateError` | 错误信息 | 下载失败 |

---

## 5. ZIP 解压 extractZip.js

**文件路径**：`galaxy-client/src/event/extractZip.js`

```javascript
const extract = require('extract-zip');

module.exports = async (filePath, callbackFun) => {
    try {
        await extract(filePath, { dir: dirname(filePath) });
    } catch(err) {
        utils.sendToRenderMsg('updateError', { err, dir: dirname(filePath), filePath });
    }
}
```

ZIP 包解压到与下载文件相同的目录。解压失败时向前端发送 `updateError`。

### 5.1 ZIP 更新包的用途

ZIP 更新包用于**增量更新**场景——只替换 `extraResources/` 目录下的 DLL 和配置文件，无需重新安装整个应用。

### 5.2 安装前停止 DLL

```javascript
// downloadFile.js
stopBsInject();      // 停止 32 位注入
stopBs64Inject();    // 停止 64 位注入
setTimeout(async () => {
    await extractZip(filePath);
    utils.sendToRenderMsg('update-downloaded', data);
}, 10000);           // 等待 10 秒确保 DLL 已释放
```

---

## 6. electron-builder 发布配置

**文件路径**：`galaxy-client/config/weixinzhushou/build.yml`

### 6.1 publish 配置

```yaml
publish:
  provider: generic
  url: http://127.0.0.1
  channel: latest
```

| 字段 | 值 | 说明 |
|------|-----|------|
| `provider` | `generic` | 通用 HTTP 服务器（非 GitHub/S3） |
| `url` | `http://127.0.0.1` | 占位值，实际通过 `setFeedURL` 动态设置 |
| `channel` | `latest` | 更新通道 |

> `url` 为占位值因为实际更新地址由前端通过 `setUpdateUrl` IPC 动态传入。

### 6.2 应用基本信息

```yaml
appId: com.baijiahulian.tqclient.
productName: 高途微信助手
artifactName: Weixinzhushou-${os}-${version}.${ext}
asar: false
```

| 字段 | 说明 |
|------|------|
| `asar: false` | 不使用 asar 打包，方便 ZIP 增量更新直接替换文件 |
| `artifactName` | 输出文件名格式 |

---

## 7. NSIS 安装包配置

```yaml
nsis:
  allowToChangeInstallationDirectory: true
  deleteAppDataOnUninstall: false
  oneClick: false
  perMachine: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  allowElevation: false
  shortcutName: 高途微信助手
  uninstallDisplayName: 高途微信助手
  include: installer.nsh
```

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `oneClick` | `false` | 非一键安装（显示安装向导） |
| `allowToChangeInstallationDirectory` | `true` | 允许用户选择安装目录 |
| `perMachine` | `true` | 按机器安装（所有用户） |
| `deleteAppDataOnUninstall` | `false` | 卸载时保留用户数据 |
| `allowElevation` | `false` | 不允许提升权限 |
| `include: installer.nsh` | | 自定义 NSIS 脚本 |

### 7.1 Windows 签名配置

```yaml
win:
  requestedExecutionLevel: requireAdministrator
  verifyUpdateCodeSignature: true
  signAndEditExecutable: true
  signDlls: true
  publisherName: 高途教育科技集团有限公司
  signingHashAlgorithms: ["sha256", "sha1"]
  certificateFile: newSignCert.pfx
  certificatePassword: gaotuketang
  sign: sign-script/sign.js
```

---

## 8. 前端触发更新的流程

前端（`galaxy/src/entries/menu/App.js`）通过 IPC 驱动更新流程：

```
1. 获取版本信息 → ipc.send('setUpdateUrl', version)
2. 检查更新     → ipc.send('checkForUpdate')
3. 发现新版本   → 前端显示更新提示 UI
4. 用户确认     → ipc.send('checkDownloadFile', downloadUrl)
5. 下载进度     → 监听 'downloadProgress' 事件
6. 下载完成     → 监听 'update-downloaded' 事件
7. 安装重启     → ipc.send('checkJava', 'first')
```

---

## 9. 安装前的进程检查

```javascript
ipc.on('checkJava', (event, flag) => {
    const judgeJava = utils.judgeProcessExist('javaw.exe');
    const judgeWechat = utils.judgeProcessExist('weixin.exe');
    Promise.all([judgeJava, judgeWechat])
        .then(result => {
            if (result[0].status === 0 && result[1].status === 0) {
                callbackFun();                // 设置 updateFlag
                autoUpdater.quitAndInstall(); // 退出并安装
                return;
            }
            flag === 'first'
                ? utils.sendToRenderMsg('wsKillJava')
                : utils.sendToRenderMsg('killJavaFail');
        });
});
```

安装流程：
1. 检查 `javaw.exe` 和 `weixin.exe` 是否还在运行
2. 如果都已退出 → 执行 `callbackFun()`（设置 `updateFlag = true`）→ `quitAndInstall()`
3. 如果仍在运行：
   - 首次（`flag === 'first'`）→ 通知前端发送 `wsKillJava` 尝试关闭
   - 再次尝试失败 → 通知前端 `killJavaFail`

---

## 10. 与窗口关闭的联动

在 `window.js` 中初始化 updater 时传入回调：

```javascript
initUpdater(() => {
    updateFlag = true;
});
```

当 `updateFlag = true` 时，窗口关闭逻辑会跳过确认对话框直接退出（见文档22）。

---

## 11. 完整更新时序图

```
[前端]                    [主进程 updater.js]              [服务器]
  │                              │                           │
  │ setUpdateUrl(version)        │                           │
  ├─────────────────────────────▶│                           │
  │                              │ setFeedURL(feedURL)       │
  │                              │                           │
  │ checkForUpdate               │                           │
  ├─────────────────────────────▶│                           │
  │                              │ checkForUpdates() ───────▶│
  │                              │◀──── latest.yml ─────────│
  │                              │                           │
  │ checkDownloadFile(url)       │                           │
  ├─────────────────────────────▶│                           │
  │                              │ DownloadFile.start()      │
  │◀── updateStart ─────────────│                           │
  │                              │ downloadURL(url) ────────▶│
  │◀── downloadProgress(45%) ───│◀──── 数据流 ──────────────│
  │◀── downloadProgress(100%) ──│◀──── 完成 ────────────────│
  │                              │                           │
  │                              │ [.zip → 停止DLL → 解压]   │
  │◀── update-downloaded ───────│                           │
  │                              │                           │
  │ checkJava('first')           │                           │
  ├─────────────────────────────▶│                           │
  │                              │ judgeProcessExist()       │
  │                              │ [进程已退出]               │
  │                              │ callbackFun()             │
  │                              │ quitAndInstall() ─────── 安装并重启
```

---

## 12. 关键代码路径索引

| 文件路径 | 核心函数/类 | 职责 |
|---------|------------|------|
| `src/event/updater.js` | `initUpdater(callbackFun)` | 更新检查、下载、安装入口 |
| `src/event/downloadFile.js` | `DownloadFile` 类 | 自定义文件下载与进度通知 |
| `src/event/extractZip.js` | `extractZip()` | ZIP 包解压 |
| `src/init/window.js` | `initUpdater(() => { updateFlag = true })` | 初始化更新模块 |
| `src/common/urls.js` | `updateUrl` | 更新服务器地址配置 |
| `config/weixinzhushou/build.yml` | `publish` / `nsis` / `win` | electron-builder 构建与发布配置 |

---

*文档生成时间：2026-03-13 | 基于 galaxy-client 仓库实际代码分析*
