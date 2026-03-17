# 15 自动更新机制

> **文档定位**：完整讲解客户端自动更新的全流程，包括前端页面如何发起更新、客户端如何下载安装、涉及的技术原理，以及已知问题与优化建议。  
> **核心技术**：Apollo 远程配置 + 自定义 `DownloadFile`（文件下载） + `extract-zip`（解压） + `electron-updater`（安装重启） + NSIS 安装包

---

## 目录

1. [完整更新执行流程](#1-完整更新执行流程)
2. [更新时序图](#2-更新时序图)
3. [前端页面逻辑详解（galaxy）](#3-前端页面逻辑详解galaxy)
4. [客户端逻辑详解（galaxy-client）](#4-客户端逻辑详解galaxy-client)
5. [技术原理](#5-技术原理)
6. [涉及文件清单](#6-涉及文件清单)
7. [已知问题与优化建议](#7-已知问题与优化建议)

---

## 1. 完整更新执行流程

Galaxy Client 的自动更新采用**前端驱动、客户端执行**的混合方案。更新的决策逻辑（是否更新、更新到哪个版本、更新包地址）完全由前端页面通过接口和远程配置获取，客户端主进程仅负责下载和安装。

完整流程分为以下 8 个阶段：

```
1. 触发检查  →  用户登录 / 定时轮询 / 手动点击
2. 获取配置  →  HTTP 接口获取基础配置 + Apollo 获取版本更新配置
3. 版本比对  →  前端在本地计算当前版本与目标版本的关系
4. 更新决策  →  根据配置决定：静默更新 / 弹窗提示 / 强制更新 / 无需更新
5. 发起下载  →  前端通过 IPC 将下载地址发送给主进程
6. 执行下载  →  主进程使用 webContents.downloadURL 下载更新包
7. 后处理    →  .exe 直接可用；.zip 需先停止 DLL 注入 → 等待 → 解压
8. 安装重启  →  .exe 由系统安装器执行安装；.zip 通过应用重启生效
```

---

## 2. 更新时序图

### 2.1 完整更新时序（包含前端决策 + 下载 + 安装）

```
[前端页面 App.js]          [后端服务器]            [客户端主进程]           [更新服务器/OSS]
      │                        │                       │                       │
      │ ① 登录成功 / 定时轮询    │                       │                       │
      │                        │                       │                       │
      │ GET /app/updateConf ──▶│                       │                       │
      │◀── 返回基础配置 ────────│                       │                       │
      │                        │                       │                       │
      │ getWechatAssistApollo ─▶│                       │                       │
      │◀── Apollo 版本更新配置 ──│                       │                       │
      │                        │                       │                       │
      │ ② 前端本地计算目标版本    │                       │                       │
      │    比较 currentVersion  │                       │                       │
      │    与 versionConf 列表  │                       │                       │
      │                        │                       │                       │
      │ ③ 决策：需要更新         │                       │                       │
      │   （静默/弹窗/强制）     │                       │                       │
      │                        │                       │                       │
      │ IPC: checkDownloadFile(updateUrl) ────────────▶│                       │
      │                        │                       │                       │
      │◀───── updateStart ─────────────────────────────│                       │
      │                        │                       │ downloadURL(url) ────▶│
      │◀── downloadProgress ───────────────────────────│◀─── 数据流 ───────────│
      │◀── downloadProgress ───────────────────────────│◀─── 数据流 ───────────│
      │                        │                       │◀─── 下载完成 ─────────│
      │                        │                       │                       │
      │                        │                       │ [.zip → 停止DLL注入    │
      │                        │                       │  → 等待10秒            │
      │                        │                       │  → extractZip 解压]    │
      │                        │                       │                       │
      │◀── update-downloaded ──────────────────────────│                       │
      │                        │                       │                       │
      │ ④ 安装阶段              │                       │                       │
      │ [.exe] → open-file → app-exit                  │                       │
      │ [.zip] → stopInject → app-relaunch             │                       │
```

### 2.2 静默更新与非静默更新的区别

```
静默更新（silentUpdate = true）:
  Apollo 配置返回 → 直接调用 checkDownloadFile → 后台下载 → 自动重启

弹窗更新（silentUpdate = false）:
  Apollo 配置返回 → 显示更新弹窗（含版本说明）→ 用户点击"立即更新"→ 调用 checkDownloadFile

强制更新（isForceUpdate = true）:
  与弹窗更新相同，但弹窗不显示"稍后更新"按钮，用户无法跳过
```

---

## 3. 前端页面逻辑详解（galaxy）

前端更新逻辑集中在 `galaxy/src/entries/menu/App.js`，由 `handleUpdate` 函数承担核心决策。

### 3.1 更新检查的三个触发时机

| 触发时机 | 入口 | 说明 |
|----------|------|------|
| 用户登录 | `getUserInfo` 成功回调中调用 `handleUpdate()` | 应用启动后首次检查，在 `useEffect([], [])` 中执行 |
| 定时轮询 | `checkDailyUpdate()` 每 10 分钟执行 | 在同一个 `useEffect` 中通过 `setTimeout` 递归调用，间隔 `UPDATE_INTERVAL = 600000ms` |
| 手动触发 | 左侧导航栏点击更新按钮 → `checkUpdateVersion()` | 由 `Nav` 组件的 `onUpdateVersion` 回调触发 |

#### 登录触发的具体调用链

应用启动后，前端在 `useEffect` 中执行以下逻辑：

1. 从 URL 参数中获取 `userId`
2. 调用 `getUserInfo({ userId })` 获取当前登录用户信息
3. 获取成功后，调用 `handleUpdate({ username, majorVersion })` 检查更新
4. `handleUpdate` 返回的 Promise resolve 后，调用 `handleWsInit()` 连接 WebSocket

因此，更新检查发生在**用户信息获取成功之后、WebSocket 连接之前**。

#### 定时轮询的具体逻辑

`checkDailyUpdate` 函数的判断逻辑：

1. 先检查是否有已登录的用户信息（`localStorage` 中的 `userInfo`），若无则跳过本轮
2. 检查上次处理时间 `lastHandleTime`，若距今超过 24 小时，触发 `handleUpdate`
3. 检查 `delayUpdateTime`（延迟更新时间配置），若已到期则触发 `handleUpdate`
4. 以上都不满足，仍然调用 `handleUpdate`，但传入 `isCheckUpdate = true`（仅做检测不弹窗）

同时，只有客户端版本 >= 4.2 时才会启动定时轮询（兼容老版本）。

### 3.2 handleUpdate 核心决策函数

`handleUpdate` 接收参数 `(params, isLatestVersion, isCheckUpdate)`，执行以下步骤：

**第一步：版本兼容性检查**

若当前客户端版本 < 4.2，直接跳过更新。

**第二步：调用后端接口获取基础配置**

调用 `checkUpdate(params)` → HTTP GET `/tongbao/sales/tool/app/updateConf`，传入 `username`（CAS 用户名）和 `majorVersion`（客户端版本号）。返回的 `currentConf` 会通过 `setGlobalData('clientBaseInfo')` 存储并广播给所有 webview。

**第三步：获取 Apollo 版本更新配置**

调用 `getWechatAssistApollo('client.wxzs.update.conf')` 获取 Apollo 上的更新配置。该配置是一个 JSON 结构，包含：

| 字段 | 说明 |
|------|------|
| `versionConf` | 各目标版本的更新配置，键为目标版本号 |
| `versionConf[ver].sourceConf` | 各源版本到该目标版本的更新策略 |
| `versionConf[ver].grayUsersOrOrg` | 灰度用户/部门列表 |
| `versionConf[ver].excludeGrayUsersOrOrg` | 排除的灰度用户/部门列表 |
| `revertConf` | 回滚配置，键为需要回滚的版本号 |
| `lastUpdateTimeConf` | 各版本的强制更新截止时间 |

**第四步：确定目标版本**

1. 调用 `getAvailableMajorVersions(versionConf)` 获取当前用户有权限的版本列表（根据灰度配置过滤）
2. 根据参数决定目标版本：
   - `isLatestVersion = true` → 选择列表中的最新版本（`getLatestVersion`）
   - `isLatestVersion = false` → 选择最近的匹配版本（`findNearestMatchingVersion`），即 >= 当前版本的最小版本
3. 检查是否有回滚配置（`revertConf[currentVersion]`），若有则走回滚逻辑

**第五步：判断是否需要更新**

- 若目标版本 === 当前版本且不是回滚 → 检查是否有更高版本存在，更新 `latestVersionType` 状态（0=最新版本, 1=有新版本, 2=有大版本跳过）
- 若到了 `lastUpdateTimeConf` 配置的截止时间 → 强制 `isForceUpdate = true`

**第六步：获取更新策略**

从配置中提取当前源版本的更新策略（优先精确匹配 `sourceConf[currentVersion]`，否则使用 `sourceConf.default`）：

| 字段 | 说明 |
|------|------|
| `updateUrl` | 更新包的下载地址 |
| `tipsTitle` | 弹窗标题 |
| `tipsContent` | 弹窗内容（数组） |
| `isForceUpdate` | 是否强制更新 |
| `silentUpdate` | 是否静默更新 |
| `isReverseFile` | 是否为回滚文件 |
| `activeUpdatePrompt` | 导航栏更新提示文案 |
| `activeUpdateBtnText` | 导航栏更新按钮文案 |

**第七步：执行更新动作**

- 若 `silentUpdate && !isReverseFile` → 直接调用 `ipc.send('checkDownloadFile', updateUrl)` 开始后台下载；若当前无登录的微信号（`allConfig.length === 0`），下载完成后自动重启
- 否则 → 显示 Ant Design 的 `Modal.confirm` 弹窗，包含更新说明和操作按钮：
  - 非强制更新：显示"稍后更新"和"立即更新"
  - 强制更新：只显示"立即更新"
  - 用户点击"立即更新"→ 调用 `ipc.send('checkDownloadFile', updateUrl)`

### 3.3 前端 IPC 事件监听

在 App.js 的 `useEffect` 中注册了以下与更新相关的 IPC 监听：

| 事件名 | 来源 | 前端处理 |
|--------|------|---------|
| `updateStart` | 客户端主进程 | 显示下载进度条 UI（`setUpdateVisible(true)`） |
| `downloadProgress` | 客户端主进程 | 更新进度百分比；到达 100% 时显示"更新成功"提示 |
| `update-downloaded` | 客户端主进程 | 处理下载完成，根据文件类型执行不同安装逻辑（详见下文） |
| `updateError` | 客户端主进程 | 隐藏进度条，记录错误日志 |
| `wsKillJava` | 客户端主进程 | 通过 WebSocket 发送 `killAll` 指令关闭所有 Java 进程，4 秒后重试 `checkJava` |
| `killJavaFail` | 客户端主进程 | 显示"自动更新失败"警告 |

### 3.4 下载完成后的安装逻辑（update-downloaded 处理）

收到 `update-downloaded` 事件后，前端根据文件类型和配置执行不同的安装流程：

**① 判断文件类型**

- `filePath.indexOf('.exe') > -1` → 全量更新（.exe 安装包）
- 否则 → 增量更新（.zip 解压替换）
- 还会判断是否为微信/企业微信安装包（通过文件名正则 `(WeChatSetup|WeCom_)\d+\.\d+\.\d+\.\d+` 匹配）

**② .exe 全量更新**

1. 调用 `ipc.send('open-file', data.filePath)` → 主进程通过 `shell.openPath()` 打开安装包，系统弹出 NSIS 安装向导
2. 隐藏下载进度条
3. 调用 `ipc.send('stopBs64Inject')` 和 `ipc.send('stopBsInject')` 停止注入进程
4. 调用 `ipc.send('app-exit')` → 主进程执行 `app.quit()` 退出应用
5. 用户在安装向导中完成安装

**③ .zip 增量更新**

1. 隐藏下载进度条
2. 调用 `ipc.send('stopBs64Inject')` 和 `ipc.send('stopBsInject')` 停止注入进程
3. 调用 `ipc.send('app-relaunch')` → 主进程执行 `app.relaunch() + app.quit()`，重启应用

**④ 静默更新 + 自动重启**

若 `silentUpdate = true` 且 `autoReload = true`（当前无登录微信号）：

- 直接调用 `ipc.send('app-relaunch')` 重启，不做其他处理

**⑤ 微信/企业微信安装包**

若下载的是微信或企业微信的安装包（非客户端更新包）：

- 直接 `window.location.reload()` 刷新页面

---

## 4. 客户端逻辑详解（galaxy-client）

### 4.1 更新模块初始化

**入口文件**：`electron.js` → `app.js`（注册 ready 事件）→ `window.js`（初始化窗口）→ `initUpdater(callback)`

在 `window.js` 中，更新模块的初始化代码如下：

- 调用 `initUpdater(() => { updateFlag = true; })`
- 传入的回调函数用于在安装更新时设置 `updateFlag = true`
- 当 `updateFlag = true` 时，窗口的 `close` 事件会跳过确认对话框，直接退出应用

### 4.2 updater.js — 四个 IPC 事件处理器

#### ① setUpdateUrl（当前未被前端调用）

根据版本号和环境类型构建 `feedURL`，调用 `autoUpdater.setFeedURL(feedURL)` 设置更新源。

- 生产环境：`${updateUrl}/${version}`
- 测试环境：`${updateUrl}/${mainVersion}/${version}/${elfkey}`（多级目录，实现主版本隔离和产品线隔离）

> **注意**：当前前端已不再调用此事件。更新 URL 完全由 Apollo 配置提供，直接通过 `checkDownloadFile` 传递给客户端。此处代码为历史遗留。

#### ② checkForUpdate（当前未被前端调用）

调用 `autoUpdater.checkForUpdates()` 触发 electron-updater 的标准更新检查流程。

> **注意**：同样为历史遗留代码。当前前端不再使用 electron-updater 的检查机制。

#### ③ checkDownloadFile — 核心下载入口

收到前端传来的 `downloadUrl` 后：

1. 通过 `BrowserWindow.fromWebContents(event.sender)` 获取发送方所在窗口
2. 创建 `new DownloadFile(mainWindow, downloadUrl)` 实例
3. 调用 `.start()` 开始下载

#### ④ checkJava — 安装前进程检查

检查 `javaw.exe` 和 `weixin.exe` 进程是否仍在运行：

- 两个进程都已退出 → 执行 `callbackFun()`（设置 `updateFlag = true`）→ 调用 `autoUpdater.quitAndInstall()`
- 首次检查仍在运行 → 发送 `wsKillJava` 通知前端关闭进程
- 二次检查仍在运行 → 发送 `killJavaFail` 通知前端失败

> **注意**：在当前的前端代码中，`.exe` 更新走 `open-file` + `app-exit` 路径，`.zip` 更新走 `app-relaunch` 路径，均不经过 `checkJava`。`checkJava` → `quitAndInstall()` 这条路径在当前流程中实际未被主动触发。

### 4.3 autoUpdater 配置

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `autoInstallOnAppQuit` | `false` | 禁止 electron-updater 在应用退出时自动安装更新 |
| `message` 对象 | 包含 4 种状态消息 | **已定义但未使用**，项目未注册 electron-updater 的标准事件 |

### 4.4 DownloadFile 类 — 自定义下载流程

**文件路径**：`galaxy-client/src/event/downloadFile.js`

#### 为什么不使用 electron-updater 自带下载

- 需要支持 `.zip` 增量更新包（electron-updater 默认只支持 NSIS 安装包）
- 需要细粒度控制下载进度通知
- 需要在安装前执行额外操作（停止 DLL 注入、等待进程退出、解压等）

#### 构造函数

根据下载 URL 确定：
- **文件类型**：URL 中包含 `.zip` 则归类为 ZIP 更新，否则为 EXE 更新
- **保存路径**：ZIP 文件保存到应用的 `exe` 目录的父目录下；EXE 文件保存到系统的 `downloads` 目录的父目录下。文件名从 URL 最后一段提取

#### start() 方法执行流程

**阶段一：通知前端并检查历史文件**

- 发送 `updateStart` 通知前端显示进度条
- 使用 `fs-extra.stat` 检查同名文件是否已存在：
  - `.exe` 文件已存在 → 直接发送 `update-downloaded`（跳过下载，但不检查版本是否匹配）
  - `.zip` 文件已存在 → 删除后重新下载
  - 文件不存在 → 正常下载

**阶段二：启动下载**

- 调用 `mainWindow.webContents.downloadURL(downloadUrl)` 启动 Chromium 内建下载
- 监听 `session.on('will-download')` 事件获取下载项（`DownloadItem`）

**阶段三：下载进度追踪**

- 使用 `item.setSavePath(filePath)` 设置保存路径
- 监听 `item.on('updated')` 事件：
  - `progressing` 状态 → 计算百分比，发送 `downloadProgress` 给前端
  - 其他状态 → 发送 `updateError`，弹出系统错误对话框

**阶段四：下载完成处理**

监听 `item.once('done')` 事件：

- `completed`（成功）：
  - `.exe` 文件 → 直接发送 `update-downloaded`
  - `.zip` 文件 → 调用 `stopBsInject()` 和 `stopBs64Inject()` 停止 DLL 注入 → `setTimeout` 等待 10 秒 → 调用 `extractZip(filePath)` 解压 → 发送 `update-downloaded`
- `interrupted`（中断）→ 发送 `updateError`，弹出错误对话框

#### 发送给前端的事件汇总

| 事件 | 数据 | 时机 |
|------|------|------|
| `updateStart` | `true` | 开始下载前 |
| `downloadProgress` | 百分比字符串（如 `"45"`） | 下载进行中 |
| `update-downloaded` | `{ filePath }` | 下载完成（.exe）或解压完成（.zip） |
| `updateError` | 错误信息 | 下载失败或解压失败 |

### 4.5 extractZip.js — ZIP 解压

**文件路径**：`galaxy-client/src/event/extractZip.js`

- 使用 `extract-zip` 库
- 解压目标目录为 ZIP 文件的父目录，即覆盖应用安装目录下的 `extraResources/` 等文件
- 解压失败时发送 `updateError` 通知前端

ZIP 增量更新的用途：只替换 `extraResources/` 目录下的 DLL 和配置文件，无需重新安装整个应用。

### 4.6 停止 DLL 注入

在 ZIP 解压前需要停止正在运行的 BasicService 进程（32 位和 64 位），因为这些 DLL 文件正在被使用，无法直接覆盖。

停止方式（`inject.js` 中的 `stopBsInject` / `stopBs64Inject`）：
1. 先尝试 `wmic process where name="BasicService.exe" delete`
2. 再执行 `taskkill /f /t /im BasicService.exe` 强制终止

停止后等待 10 秒确保文件句柄释放，然后再执行解压。

### 4.7 更新地址配置（urls.js）

`updateUrl` 在 `urls.js` 中按环境配置：

| 环境 | updateUrl 值 |
|------|-------------|
| test | `oss://gh-fe/wxzs-client/test` |
| prod | `oss://gh-fe/wxzs-client/prod` |
| vt | `http://172.16.35.27:9091/salestool/vt` |

> **注意**：虽然 `urls.js` 定义了 `updateUrl`，但在当前流程中，实际下载地址由 Apollo 配置提供，`urls.js` 中的地址仅在 `setUpdateUrl` IPC 事件中被使用（该事件当前未被调用）。

### 4.8 electron-builder 发布配置

**文件路径**：`galaxy-client/config/weixinzhushou/build.yml`

#### publish 配置

| 字段 | 值 | 说明 |
|------|-----|------|
| `provider` | `generic` | 通用 HTTP 服务器 |
| `url` | `http://127.0.0.1` | 占位值，实际地址由运行时动态设置 |
| `channel` | `latest` | 更新通道 |

#### NSIS 安装包配置

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `oneClick` | `false` | 非一键安装，显示安装向导 |
| `allowToChangeInstallationDirectory` | `true` | 允许用户选择安装目录 |
| `perMachine` | `true` | 按机器安装（所有用户） |
| `deleteAppDataOnUninstall` | `false` | 卸载时保留用户数据 |
| `allowElevation` | `false` | 不允许提升权限 |
| `include: installer.nsh` | | 自定义 NSIS 安装脚本 |

#### Windows 签名配置

| 配置项 | 值 |
|--------|-----|
| `requestedExecutionLevel` | `requireAdministrator` |
| `verifyUpdateCodeSignature` | `true` |
| `publisherName` | 高途教育科技集团有限公司 |
| `signingHashAlgorithms` | `["sha256", "sha1"]` |
| `sign` | `sign-script/sign.js` |

#### 其他关键配置

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `asar` | `false` | 不使用 asar 打包，使 ZIP 增量更新可直接替换文件 |
| `artifactName` | `Weixinzhushou-${os}-${version}.${ext}` | 输出文件命名模板 |
| `productName` | 高途微信助手 | 产品名 |

### 4.9 与窗口关闭的联动

在 `window.js` 中，`initUpdater` 传入的回调设置 `updateFlag = true`。窗口 `close` 事件处理：

- `updateFlag = true` → 1 秒后直接退出，不显示确认对话框
- `updateFlag = false` → 弹出"是否确认关闭？"对话框，确认后 2 秒退出（等待清理完成）

---

## 5. 技术原理

### 5.1 electron-updater 与 autoUpdater.quitAndInstall()

`electron-updater` 是 `electron-builder` 配套的自动更新库。其标准流程为：

1. `autoUpdater.setFeedURL(url)` — 设置更新服务器地址
2. `autoUpdater.checkForUpdates()` — 向服务器请求 `latest.yml` 文件，比对版本号
3. 若有新版本，自动下载 NSIS 安装包
4. `autoUpdater.quitAndInstall()` — 退出应用并启动安装程序

`quitAndInstall()` 的底层实现：
- 调用 `app.quit()` 退出 Electron 应用
- 启动之前下载的 NSIS 安装包（`.exe`），NSIS 安装器会检测目标目录并覆盖安装
- 安装完成后根据 NSIS 配置可自动重启应用

> **本项目的实际情况**：项目仅使用了 `electron-updater` 的 `setFeedURL` 和 `checkForUpdates` 接口（且当前未调用），以及 `quitAndInstall` 方法（在 `checkJava` 路径中）。下载功能完全由自定义的 `DownloadFile` 类接管。

### 5.2 webContents.downloadURL() 下载机制

`webContents.downloadURL(url)` 是 Electron 基于 Chromium 的内建下载能力：

1. 调用后触发 `session.on('will-download')` 事件
2. 提供 `DownloadItem` 对象，支持：
   - `setSavePath(path)` — 设置保存路径（必须调用，否则弹出保存对话框）
   - `on('updated', callback)` — 监听下载进度
   - `once('done', callback)` — 监听下载完成
   - `getReceivedBytes()` / `getTotalBytes()` — 获取下载字节数
   - `pause()` / `resume()` / `cancel()` — 暂停/恢复/取消
3. 底层使用 Chromium 网络栈，自动处理 HTTP 重定向、分段下载等

### 5.3 NSIS 安装包原理

NSIS（Nullsoft Scriptable Install System）是 Windows 平台的安装包生成工具。`electron-builder` 使用 NSIS 生成 `.exe` 安装包：

- 安装包内嵌压缩后的应用文件
- 运行安装包时展示安装向导（由 NSIS 脚本控制界面）
- 支持自定义安装目录、创建快捷方式、注册卸载程序等
- 项目通过 `installer.nsh` 自定义了安装脚本

当执行全量更新时，前端通过 `shell.openPath(filePath)` 启动安装包，等同于用户双击 `.exe` 文件。系统弹出 NSIS 安装向导，用户按向导完成安装。

### 5.4 ZIP 增量更新原理

ZIP 增量更新只替换 `extraResources/` 目录下的文件（DLL、配置等），不重新安装整个应用：

1. 下载 `.zip` 更新包
2. 停止正在使用这些文件的 BasicService 进程（释放文件句柄）
3. 等待 10 秒确保进程完全退出和文件句柄释放
4. 使用 `extract-zip` 解压 ZIP 到应用目录，覆盖原有文件
5. 通过 `app.relaunch() + app.quit()` 重启应用，加载新文件

`asar: false` 的配置使这种增量更新成为可能，因为文件没有被打包进 asar 档案，可以直接在磁盘上替换。

### 5.5 Apollo 远程配置驱动更新

项目将更新策略从客户端硬编码转移到了 Apollo 远程配置平台，实现：

- **版本灰度发布**：通过 `grayUsersOrOrg` 控制哪些用户/部门可以收到更新
- **版本排除**：通过 `excludeGrayUsersOrOrg` 排除特定用户
- **强制更新截止**：通过 `lastUpdateTimeConf` 设置某版本的强制更新截止时间
- **回滚能力**：通过 `revertConf` 实现指定版本回滚到旧版本
- **差异化更新策略**：通过 `sourceConf` 为不同源版本配置不同的更新行为
- **静默更新**：`silentUpdate = true` 时不显示弹窗，后台自动完成

### 5.6 IPC 通信在更新中的作用

更新流程中涉及的 IPC 通信全貌：

| 方向 | 事件 | 用途 |
|------|------|------|
| 前端 → 主进程 | `checkDownloadFile` | 发起下载（携带 URL） |
| 前端 → 主进程 | `checkJava` | 检查进程是否可安全安装 |
| 前端 → 主进程 | `open-file` | 打开 .exe 安装包 |
| 前端 → 主进程 | `app-relaunch` | 重启应用（`app.relaunch() + app.quit()`） |
| 前端 → 主进程 | `app-exit` | 退出应用（`app.quit()`） |
| 前端 → 主进程 | `stopBsInject` | 停止 32 位 BasicService |
| 前端 → 主进程 | `stopBs64Inject` | 停止 64 位 BasicService |
| 主进程 → 前端 | `updateStart` | 通知开始下载 |
| 主进程 → 前端 | `downloadProgress` | 下载进度 |
| 主进程 → 前端 | `update-downloaded` | 下载/解压完成 |
| 主进程 → 前端 | `updateError` | 下载/解压出错 |
| 主进程 → 前端 | `wsKillJava` | 请求前端通过 WS 关闭 Java 进程 |
| 主进程 → 前端 | `killJavaFail` | 进程关闭失败 |

---

## 6. 涉及文件清单

### 6.1 前端页面（galaxy）

| 文件路径 | 职责 |
|---------|------|
| `galaxy/src/entries/menu/App.js` | 更新核心决策逻辑：触发检查、获取配置、版本比对、弹窗/静默更新、安装处理 |
| `galaxy/src/entries/menu/store/request.js` | `checkUpdate()` — 调用后端更新接口 |
| `galaxy/src/entries/menu/component/update/index.js` | `Update` 组件 — 下载进度条 UI |
| `galaxy/src/entries/menu/component/UpdateModal/index.js` | `UpdateModal` 组件 — 更新弹窗 UI |
| `galaxy/src/entries/menu/component/nav/Nav.js` | 导航栏更新按钮，触发手动检查 |
| `galaxy/src/entries/menu/store/actions.js` | `updateClientBaseInfo` — 更新状态管理 |
| `galaxy/src/entries/menu/store/reducer.js` | `clientUpdateInfo` — 更新状态存储 |
| `galaxy/src/api-new/common.js` | `getWechatAssistApollo()` — 获取 Apollo 远程配置 |
| `galaxy/src/common/compareVersion.js` | 版本号比较工具函数集 |
| `galaxy/src/common/globalData.js` | `clientVersion` — 客户端版本号存储 |
| `galaxy/src/common/ipc.js` | 前端 IPC 通信封装 |

### 6.2 客户端主进程（galaxy-client）

| 文件路径 | 职责 |
|---------|------|
| `src/electron.js` | 应用入口，初始化各模块 |
| `src/event/app.js` | 应用生命周期管理，`before-quit` 时停止 BasicService |
| `src/init/window.js` | 初始化更新模块（`initUpdater`），管理 `updateFlag` |
| `src/event/updater.js` | 更新 IPC 事件处理器（checkDownloadFile、checkJava 等） |
| `src/event/downloadFile.js` | `DownloadFile` 类 — 自定义文件下载与进度通知 |
| `src/event/extractZip.js` | ZIP 包解压 |
| `src/event/ipc.js` | IPC 事件注册（open-file、app-relaunch、app-exit、stopBsInject 等） |
| `src/common/urls.js` | 环境 URL 配置（包含 updateUrl） |
| `src/common/inject.js` | 进程管理（stopBsInject、stopBs64Inject、stopBasicService 等） |
| `src/utils.js` | 工具函数（sendToRenderMsg、judgeProcessExist） |
| `config/weixinzhushou/build.yml` | electron-builder 打包配置 |

---

## 7. 已知问题与优化建议

### 7.1 死代码与历史遗留

| 问题 | 位置 | 说明 |
|------|------|------|
| `setUpdateUrl` 和 `checkForUpdate` 未被调用 | `updater.js` | 前端已改用 Apollo 配置直接提供下载 URL，这两个 IPC 事件成为死代码 |
| `message` 对象未使用 | `updater.js` | 定义了更新状态消息但从未引用 |
| `reStartType` 参数未使用 | `updater.js` 的 `checkDownloadFile` | 接收了参数但未处理 |
| `checkJava` → `quitAndInstall()` 路径实际未触发 | `updater.js` + `App.js` | 前端处理 `update-downloaded` 后直接走 `open-file` / `app-relaunch`，不经过 `checkJava` |
| `checkZipStructure` 方法被注释 | `downloadFile.js` | 包含 `yauzl` 引入也被注释 |

### 7.2 安全问题

| 问题 | 位置 | 建议 |
|------|------|------|
| 证书密码明文存储 | `build.yml` 中 `certificatePassword: gaotuketang` | 使用环境变量 `CSC_KEY_PASSWORD` 替代 |
| `asar: false` 导致源码可见 | `build.yml` | 可考虑开启 asar 打包，同时调整增量更新策略 |
| `contextIsolation: false` + `nodeIntegration: true` | `window.js` | 存在安全风险，建议启用上下文隔离 |
| `allowRunningInsecureContent: true` | `window.js` | 允许 HTTPS 页面加载 HTTP 资源，存在中间人攻击风险 |

### 7.3 可靠性问题

| 问题 | 位置 | 建议 |
|------|------|------|
| 已存在的 .exe 直接触发 `update-downloaded` | `downloadFile.js` | 未校验文件完整性或版本，可能使用旧版安装包。建议增加文件哈希校验 |
| 10 秒硬编码等待 | `downloadFile.js` | 等待 BasicService 进程停止的时间可能不够或过长。建议改为轮询检测进程状态 |
| ZIP 解压无进度反馈 | `extractZip.js` | 大文件解压时用户无感知 |
| 解压失败无重试 | `extractZip.js` | 解压失败只发送 `updateError`，不清理残留文件 |
| 下载中断无自动重试 | `downloadFile.js` | 下载被中断后只弹出错误提示，不支持断点续传 |
| `callbackFun` 参数未使用 | `extractZip.js` | 定义了但未调用 |

### 7.4 代码质量问题

| 问题 | 位置 | 建议 |
|------|------|------|
| `log.error` 记录正常信息 | `downloadFile.js` 第 123 行 | 应使用 `log.info` |
| `exeFileType` 命名不准确 | `downloadFile.js` | 实际表示的是下载目录类型，不是文件类型 |
| `checkJava` 命名不准确 | `updater.js` | 实际检查的是 Java 和微信两个进程 |
| `stat` 回调与 `async/await` 混用 | `downloadFile.js` | 建议统一使用 `async/await` |
| 文件类型判断用 `indexOf('.zip') > -1` | `downloadFile.js` | 建议用 `endsWith('.zip')` |
| `appId` 末尾多了一个点号 | `build.yml` | `com.baijiahulian.tqclient.` 应为 `com.baijiahulian.tqclient` |
| `allowElevation: false` 与 `requestedExecutionLevel: requireAdministrator` 冲突 | `build.yml` | 两个配置含义矛盾 |
| 窗口图标路径拼写错误 | `window.js` | `extraResoources` 多了一个 `o` |
| 启动耗时计算减法顺序错误 | `window.js` | `global.readyStartTime - Date.now()` 结果为负数 |

### 7.5 架构优化建议

| 建议 | 说明 |
|------|------|
| 清理 electron-updater 死代码 | 移除 `setUpdateUrl`、`checkForUpdate`、`message` 对象等未使用代码，减少维护负担 |
| 统一安装路径 | 当前 `.exe` 和 `.zip` 走完全不同的安装路径，逻辑分散在前端和客户端。建议统一由客户端主进程控制安装流程 |
| 增加文件完整性校验 | 下载完成后校验文件的 MD5/SHA256，防止损坏的安装包被执行 |
| 改进 DLL 停止等待机制 | 将 10 秒硬编码改为轮询进程状态（如每秒检查一次，最多等待 30 秒） |
| 支持断点续传 | 利用 `DownloadItem.resume()` 在下载中断后恢复 |
| 增加更新回滚保护 | 解压前备份原有文件，解压失败时自动回滚 |

---

*文档生成时间：2026-03-17 | 基于 galaxy 和 galaxy-client 仓库实际代码分析*
