# Galaxy Client 工程化架构分析 · 内容清单

> 本清单覆盖 `galaxy-client`（Electron 主进程端）与 `galaxy`（React 前端渲染端）两个仓库的全部工程化设计，  
> 不含具体业务逻辑（群发、好友管理等），聚焦**架构骨架、基础设施、通用机制**。
>
> **已确认的关键前提**：  
> ① `galaxy` 仓库的 `electron/` 目录代码**已废弃**，Electron 主进程完全由 `galaxy-client` 承担；  
> ② `galaxy` 前端的 WebSocket 连接的是 `galaxy-client` 中的 `frontServer.js`（Node.js WebSocket Server），**不再连接旧的 Java 服务**。
>
> **文档生产规则**：每份文档 1000–1500 行（如果内容太多可以拆解为若干个小文档，避免生成长内容失败），需标注相关代码的文件路径与函数名。  
> **输出目录**：`galaxy-client-guide/架构分析/`

---

## 文档清单（共 24 篇）


| #   | 文档文件名                                     | 核心主题                                                 | 状态  |
| --- | ----------------------------------------- | ---------------------------------------------------- | --- |
| 01  | `01-工程目录结构与文件职责.md`                       | 两仓库完整目录树、每个模块/文件的职责速查                                | ✅ 已完成 |
| 02  | `02-本地开发环境启动流程.md`                        | 启动命令链路、webpack dev server、electron-start 配置          | ✅ 已完成 |
| 03  | `03-打包构建原理与多产品线机制.md`                     | webpack 构建、electron-builder、多产品线/多环境区分               | ✅ 已完成 |
| 04  | `04-主进程启动流程与初始化链路.md`                     | electron.js 启动链路、initLog、app 事件、AppStart.run()       | ✅ 已完成 |
| 05  | `05-MQTT连接与消息处理机制.md`                     | mqttHelper 连接、订阅、去重、过期过滤、消息调度                        | ✅ 已完成 |
| 06  | `06-前端多入口渲染机制与多Webview设计.md`              | 4 个 HTML 入口、EmbedSys、webview 标签、加载时序                 | ✅ 已完成 |
| 07  | `07-逆向程序加载与NamedPipe通信.md`                | ffi-napi、PipeCore.dll、initIpcTask 扫描循环               | ✅ 已完成 |
| 08  | `08-electron-store持久化存储机制.md`             | store.js 各字段、get/set/clear、变更监听模式                    | ✅ 已完成 |
| 09  | `09-前端WebSocket通信机制（galaxy端）.md`          | menu/store/thunks.js 连接、重连、onmessage 路由              | ✅ 已完成 |
| 10  | `10-Electron-IPC通信设计（渲染↔主进程）.md`          | electron-better-ipc、ipc.js 全量事件表、preload 桥接          | ✅ 已完成 |
| 11  | `11-定时任务系统设计.md`                          | node-cron 调度、5 个定时器职责、异常处理                           | ✅ 已完成 |
| 12  | `12-内存队列执行器设计（MemoryQueue）.md`            | 串行队列、CAS 并发保护、超时机制、背压丢弃                              | ✅ 已完成 |
| 13  | `13-崩溃检测与活动心跳记录.md`                       | recordActivityInfo、judgeCrashAndReport、setRecordInfo | ✅ 已完成 |
| 14  | `14-日志系统设计（electron-log与阿里云SLS）.md`       | initLog、日志分级、SLS 上报、日志文件路径                           | ✅ 已完成 |
| 15  | `15-自动更新机制（electron-updater）.md`          | updater.js、检查更新流程、强制/静默更新策略                          | ✅ 已完成 |
| 16  | `16-SQLite数据库层与Sequelize-ORM设计.md`        | 表结构、entities 定义、dao-service 查询封装                     | ✅ 已完成 |
| 17  | `17-消息调度层设计（dispatchInBound与OutBound）.md` | 入站/出站调度链路、reverseSend/frontSend/mqttSend             | ✅ 已完成 |
| 18  | `18-运行时配置管理（runtime.yml与Apollo）.md`       | runtime.yml 字段、app-config 读取、apollo 动态配置             | ✅ 已完成 |
| 19  | `19-缓存层与注册表管理设计.md`                       | core/cache 各缓存类、registry-config 微信实例管理               | ✅ 已完成 |
| 20  | `20-Worker-Threads多线程设计.md`               | worker-threads 使用场景、线程间通信、线程池设计                      | ✅ 已完成 |
| 21  | `21-前端路由与Redux状态管理（galaxy端）.md`           | sub/menu 路由设计、Redux store 结构、thunks 异步流              | ✅ 已完成 |
| 22  | `22-多窗口管理与渲染进程架构（galaxy端）.md`             | menu/sub/vpn/load 四个窗口、窗口创建/通信/生命周期                  | ✅ 已完成 |
| 23  | `23-错误处理与监控上报体系.md`                       | Habo 上报、SLS 错误日志、未捕获异常处理、性能监控                        | ✅ 已完成 |
| 24  | `24-安全配置与代码注入机制.md`                       | nodeIntegration、preload 脚本、inject.js、webviewPreload  | ✅ 已完成 |


---

## 各文档内容提纲

---

### 01 工程目录结构与文件职责

**目标**：两仓库目录树全量速查，让开发者看到文件名就知道去哪找代码。

**章节规划**：

1. `galaxy-client` 目录树（到三级）及各层说明
2. `src/common/` 各文件职责表
3. `src/event/` 各事件文件职责表
4. `src/init/` 初始化文件说明
5. `src/msg-center/` 分层架构说明（start / core / business / dispatch-center）
6. `src/sqlite/` 数据库相关文件说明
7. `config/` 多产品配置目录说明
8. `extraResources/` 额外资源说明（dll、脚本、silk2mp3 等）
9. `galaxy`（前端仓库）目录树及各层说明
10. `src/entries/` 四个入口目录详解
11. `electron/`（galaxy 端的旧 Electron 代码）说明
12. 关键文件快速定位索引表

**关键代码路径**：

- `galaxy-client/src/` 整体目录
- `galaxy/src/entries/` 多入口目录
- `galaxy/config/` 多产品配置

---

### 02 本地开发环境启动流程

**目标**：从零到运行，一步步拆解 `start:dev` 命令背后发生的事情。

**章节规划**：

1. 两个仓库的分工关系（galaxy-client 是 Electron 主进程；galaxy 是前端，由 CRA dev server 提供）
2. `galaxy` 前端侧：`yarn start` → CRA dev server 启动流程
  - `config-overrides.js` 如何覆盖 webpack 配置
  - 多入口 HTML 的生成原理（`HtmlWebpackPlugin`）
  - `webpack alias electron` 在开发时指向 `src/alias/electron.js`
3. `galaxy-client` 主进程侧：`start:dev` 命令
  - `ELECTRON_NODE_ENV=dev` 环境变量的含义
  - `--inspect=5678` 开启 Node.js 调试
  - webpack 打包主进程 → 输出 `public/electron.js`
  - Electron 加载 `public/electron.js` 作为主进程入口
4. 开发时如何加载前端页面（`loadUrl.js` 中的 `localhost:3000` 判断）
5. `runtime.dev.yml` vs `runtime.yml` 的配置差异（dev 环境特有配置）
6. 热更新机制：主进程代码变更后如何重启
7. 常见开发报错及解决方式

**关键代码路径**：

- `galaxy-client/package.json` 的 `scripts`
- `galaxy-client/webpack.electron.config.js`
- `galaxy-client/config/weixinzhushou/runtime.dev.yml`
- `galaxy/config-overrides.js`
- `galaxy/package.json` 的 `scripts`
- `galaxy/src/alias/electron.js` vs `electron.browser.js`

---

### 03 打包构建原理与多产品线机制

**目标**：理解从源码到最终 `.exe` 安装包的完整构建链路，以及如何区分测试/线上/多品牌。

**章节规划**：

1. 构建总流程图（pre-build → electron-builder → 安装包）
2. `scripts/build.js` 全流程脚本解析
3. `webpack.electron.config.js`：主进程打包配置详解
  - `target: electron-main`
  - externals 处理（native modules）
  - 输出 `public/electron.js`
4. `galaxy` 前端打包：CRA + react-app-rewired
  - `BUILD_PATH` 环境变量控制入口数量
  - 输出到 `build/` 目录结构
5. `electron-builder` 配置（`config/weixinzhushou/build.yml`）
  - `files`、`extraResources` 字段
  - `nsis` 安装包配置
  - `win.target` 打包目标
6. 多环境区分机制
  - `ELECTRON_NODE_ENV=test` vs `prod`
  - `runtime.yml` vs `runtime.dev.yml` 如何选择加载
  - `app-build:test` vs `app-build:prod` 差异
7. 多产品线机制（galaxy 端）
  - `config/weixinzhushou/` vs `config/damai/` vs `config/tianquan/` vs `config/tongbao/`
  - `PRODUCT` 环境变量与 `BUILD_PATH` 的组合
  - `yarn build:weixinzhushou` 命令链路
  - 条件编译（`conditional-loader.js`）的实现原理
8. `scripts/uploadFile.js`：构建产物上传 OSS
9. 版本管理（`scripts/versionConfig.json`）
10. `scripts/downloadDevFile.js`：开发时下载依赖文件（dll等）

**关键代码路径**：

- `galaxy-client/config/weixinzhushou/build.yml`
- `galaxy-client/config/weixinzhushou/runtime.yml`
- `galaxy-client/scripts/build.js`
- `galaxy-client/webpack.electron.config.js`
- `galaxy/config-overrides.js`
- `galaxy/conditional-loader.js`
- `galaxy/config/weixinzhushou/build.yml`

---

### 04 主进程启动流程与初始化链路

**目标**：从 `electron.js` 第一行到所有模块就绪，完整的初始化时序。

**章节规划**：

1. `src/electron.js` 全量解析（25行代码）
  - `global.readyStartTime = Date.now()` 的用途（性能计时）
  - 调用链顺序及每步含义
2. `src/init/log.js`（`initLog()`）：日志初始化（见文档14）
3. `src/init/remoteDebug.js`（`setupRemoteDebug()`）：开启远程调试窗口
4. `src/event/app.js`（`addAppEvent()`）：Electron app 生命周期事件注册
  - `app.whenReady()` 后的操作
  - `window-all-closed` / `before-quit` 事件
  - 单实例锁（`requestSingleInstanceLock`）
5. `src/event/ipc.js`（`addIpcEvent()`）：主进程 IPC 事件注册全览（见文档10）
6. `src/event/store.js`（`addStoreEvent()`）：store 变更事件监听
7. `AppStart.run()`（`src/msg-center/start/appStart.js`）
  - 并发启动四个子系统的顺序与依赖关系
  - `judgeCrashAndReport()` 崩溃检测（见文档13）
8. 前端页面加载时序（`src/renderer/index.js`）
  - `loadUrl.js` 如何判断加载本地 dev server 还是打包产物
9. 启动完成后的内存 & 性能基线指标
10. 关键启动错误的处理方式（DLL 加载失败、MQTT 连接失败等）

**关键代码路径**：

- `galaxy-client/src/electron.js`
- `galaxy-client/src/event/app.js`
- `galaxy-client/src/event/ipc.js`
- `galaxy-client/src/event/store.js`
- `galaxy-client/src/msg-center/start/appStart.js`
- `galaxy-client/src/renderer/index.js`
- `galaxy-client/src/common/loadUrl.js`（推测）

---

### 05 MQTT连接与消息处理机制

**目标**：从获取 token 到消息落地，完整 MQTT 生命周期。

**章节规划**：

1. MQTT 在整体架构中的定位（云端指令通道 + 状态上报通道）
2. `mqttConfig.js`：配置常量详解
  - P2P topic 格式（`{groupId}&{instanceId}&GID_xxx`）
  - 阿里云 MQTT 接入点配置
3. `mqttHelper.js`：连接流程
  - 调用服务端获取 token（HTTP 请求 + HmacSHA1 签名）
  - `initMqttClient()` 建立连接（`tcp://endPoint:1883`）
  - `encryptUtil.js` 加解密细节
4. `mqttClientBase.js`：客户端核心
  - 订阅 P2P topic
  - `onMessage` 回调：`taskId` 去重锁实现（防止重复处理）
  - 消息过期过滤（默认 3 小时，`createdAt` 字段判断）
  - 路由到 `WxConvertServiceList` vs `WorkWxConvertServiceList`
5. 消息补偿机制（`mqttMakeUpManager.js`）
  - 发送失败时的存储策略
  - `MqttMakeUpManager` 定时重试逻辑
6. `mqExcuteMsg.js`：MQTT 发送封装
  - `publish` 参数（`parentTopic`、QoS、retain）
  - 失败降级到补偿队列
7. 与 `dispatchInBound.js` 的协作关系（见文档17）
8. MQTT 断线重连机制
9. 常见 MQTT 问题排查（连接超时、token 过期、topic 错误）

**关键代码路径**：

- `galaxy-client/src/msg-center/core/mq/mqttConfig.js`
- `galaxy-client/src/msg-center/core/mq/mqttHelper.js`
- `galaxy-client/src/msg-center/core/mq/mqttClientBase.js`
- `galaxy-client/src/msg-center/core/mq/mqExcuteMsg.js`
- `galaxy-client/src/msg-center/core/mq/mqttMakeUpManager.js`
- `galaxy-client/src/msg-center/core/mq/encryptUtil.js`

---

### 06 前端多入口渲染机制与多Webview设计

**目标**：彻底搞清楚「为什么 debug 时看到多份 webview」以及各窗口的加载时序。

**章节规划**：

1. 整体窗口架构图（4个 HTML 入口 + Electron BrowserWindow 关系）
2. `load.html`（加载页）
  - 职责：显示启动动画、等待主进程就绪信号
  - 与主进程的 IPC 通信：何时跳转到主界面
3. `menu.html`（主控制面板）
  - 职责：全局状态管理、WebSocket 管理、导航框架
  - EmbedSys 嵌入子系统架构（COMP / IFRAME / WEBVIEW / ROUTE 四种类型）
  - 为什么用 `MemoryRouter`（不依赖 URL 的原因）
4. `sub.html`（功能子页窗口）
  - 职责：群发、好友申请等 15+ 功能模块
  - 动态路由原理（`menu.config.js` → `React.lazy(() => import(...))`）
  - 与 `menu.html` 的通信方式（Electron IPC / Redux store 无法跨窗口）
5. `vpn.html`（VPN 登录页）
  - 职责与加载时机
6. **多 Webview 的来源分析**（这是重点）
  - `webviewTag: true` 开启 Electron webview 标签
  - `EmbedSys` 中的 `webviewWeb` 组件：`<webview>` 标签 + `nodeIntegration=true`
  - `preload: extraResources/load/inject.js` 注入脚本的作用
  - `extraResources/load/webviewPreload.js` 的作用
  - 多个 Tab 对应多个 webview 实例的原因
  - DevTools 中看到多个 webview 的具体对应关系
7. 窗口管理：`electron/common/createStateWindow.js`（galaxy 端）
8. `extraResources/load/inject.js`：注入脚本详解
9. webview 通信：主进程 → webview / webview → 主进程
10. webview 安全配置（`allowRunningInsecureContent` 的含义与风险）

**关键代码路径**：

- `galaxy/config-overrides.js`（多入口定义）
- `galaxy/src/entries/menu/component/EmbedSys/`
- `galaxy/src/entries/menu/component/EmbedSys/menu.ts`
- `galaxy/src/entries/menu/component/EmbedSys/webviewWeb/index.tsx`
- `galaxy-client/src/renderer/index.js`（窗口创建，已废弃的 galaxy/electron/ 不再参考）
- `galaxy-client/extraResources/load/inject.js`
- `galaxy-client/extraResources/load/webviewPreload.js`

---

### 07 逆向程序加载与NamedPipe通信

**目标**：理解如何通过 DLL 注入与微信/企微进程进行 IPC 通信。

**章节规划**：

1. 逆向通信的整体设计思路（为什么需要注入而不是直接调 API）
2. 架构图：`Node.js 主进程` ↔ `PipeCore.dll（Named Pipe 服务端）` ↔ `微信.exe`
3. `src/msg-center/core/reverse/dll/clibrary.js`：ffi-napi 接口定义
  - `PipeCore.dll` 和 `ReUtils64.dll` 暴露的函数签名
  - `IpcConnectServer(pipeName, pid)`：建立连接
  - `IpcClientSendMessage(handle, buffer, len)`：发送消息
  - `IpcClientRecvMessage(handle, buffer, maxLen)`：接收消息
  - `IpcClientClose(handle)`：关闭连接
  - ffi-napi 类型映射（`int`、`string`、`Buffer` 的转换）
4. `initIpcTask.js`：进程扫描与连接管理
  - 每 5 秒扫描微信/企微进程 ID（`tasklist` 命令或 Windows API）
  - 新进程：`IpcConnectServer()` 建立 Named Pipe 连接
  - 进程消失：`IpcClientClose()` 关闭连接
  - 多账号场景：同时管理多个连接实例
5. `asyncSelectTask.js`：异步轮询接收消息
  - 轮询间隔与性能权衡
  - 消息帧的解析方式（`Buffer` → 对象）
  - 接收到消息后路由到 `dispatchOutBound`
6. `reverseSend.js`（调度层）：如何选择目标进程发送
7. 连接状态管理（`ipcConfig.js` 中的枚举）
8. `extraResources/prevent_wx_update.bat`：防微信自动更新的原理
9. 企微 DLL（`hasLoginedAccount`）的调用方式
10. 调试逆向 IPC 的方法与常见问题

**关键代码路径**：

- `galaxy-client/src/msg-center/core/reverse/dll/clibrary.js`
- `galaxy-client/src/msg-center/core/reverse/initIpcTask.js`
- `galaxy-client/src/msg-center/core/reverse/asyncSelectTask.js`
- `galaxy-client/src/msg-center/core/reverse/ipcConfig.js`
- `galaxy-client/src/msg-center/core/reverse/ipcUtil.js`
- `galaxy-client/src/msg-center/dispatch-center/reverseSend.js`

---

### 08 electron-store持久化存储机制

**目标**：所有持久化数据的读写方式、监听方式、数据结构。

**章节规划**：

1. `electron-store` 选型原因（vs SQLite vs localStorage）
2. `src/common/store.js` 全量解析
  - 实例创建（`new Store({ name, defaults })`）
  - `gid`：设备唯一 ID，生成规则
  - `userId`：当前登录用户 ID，变更监听（`onDidChange`）触发的副作用
  - `windowState`：窗口位置/大小持久化
  - `userInfo`：CAS 登录用户信息（含字段结构说明）
  - `autoCompleteInfo`：自动填充信息
  - `envSettings`：运行时可切换的环境配置（测试/线上域名等）
  - `isGray`：灰度标记，变更监听触发配置重载
  - `registryList`：注册表列表（所有已连接微信实例）
  - `activityInfo`：崩溃检测心跳记录
3. `src/event/store.js`（`addStoreEvent()`）：store 变更事件的广播机制
  - `userId` 变更 → 广播到渲染进程的 IPC 事件
  - `isGray` 变更 → 动态切换配置源
4. 渲染进程如何读写 store（IPC 调用主进程 get/set）
5. 数据存储位置（`userData` 路径）
6. 数据迁移策略（`migrations` 字段，版本升级时的数据兼容）
7. 与 `sqlite` 的职责边界（瞬态业务数据 vs 持久配置）

**关键代码路径**：

- `galaxy-client/src/common/store.js`
- `galaxy-client/src/event/store.js`
- `galaxy-client/src/event/ipc.js`（`get-env-settings` / `set-env-settings` 等）

---

### 09 前端WebSocket通信机制（galaxy ↔ frontServer）

**目标**：`galaxy` 前端如何连接 `galaxy-client` 的 `frontServer.js`，以及双向消息的完整处理链路。

> **架构说明**：`galaxy`（React 渲染进程）通过 WebSocket 连接到 `galaxy-client` 主进程侧的  
> `frontServer.js`（Node.js WebSocket Server）。这是**当前唯一的前端↔主进程实时消息通道**，  
> 旧的 Java 服务 WebSocket 已废弃。

**章节规划**：

1. 整体定位：WebSocket 在前端↔主进程通信中扮演的角色（区别于同步 IPC）
  - 同步请求用 `electron-better-ipc`（IPC）
  - 主进程主动推送用 WebSocket（frontServer → galaxy 前端）
2. `galaxy-client` 服务端（`frontServer.js`）
  - WebSocket Server 的创建与监听端口
  - `frontFlowInBound`：接收前端消息并路由处理
  - `frontSend.js`：主进程主动向前端推送消息
3. 端口获取流程（galaxy 前端侧）
  - `ipc.callMain('get-ws-port')` → `galaxy-client/src/event/ipc.js` 的 `get-ws-port` handler
  - 端口如何确定（固定端口 or 动态分配？写入 registry 的时机）
4. `galaxy/src/entries/menu/store/thunks.js`：WebSocket 连接建立
  - `connectWs()` Thunk 函数完整解析
  - 防止死灰复燃：旧连接的清理方式（`ws.onopen = _.noop; ws.close()`）
  - `ws = window.ws = new WebSocket(url)` 全局挂载原因
5. `ws.onopen`：连接建立后的初始化
  - 发送 `getAllConfig` 命令获取所有微信账号配置
  - 触发 Redux dispatch 更新全局状态
6. `ws.onmessage`：消息路由机制
  - 消息格式（JSON 格式、`type` 字段路由）
  - 路由表（各 type 对应的 handler）
  - 微信账号状态变更推送（登录/退出/断开）
7. `ws.onclose`：断线重连策略
  - 重连延迟递增算法（指数退避）
  - 重连时触发账号离线状态上报
8. `ws.onerror`：错误处理
9. `galaxy/src/entries/menu/App.js`：心跳状态监控
  - 检测 WS 连接异常并向各 webview 推送状态事件
10. 常见问题：端口获取失败、frontServer 未启动

**关键代码路径**：

- `galaxy-client/src/msg-center/start/frontStart.js`（启动 frontServer）
- `galaxy-client/src/msg-center/core/front/frontServer.js`（WebSocket Server）
- `galaxy-client/src/msg-center/dispatch-center/frontSend.js`（主→前端推送）
- `galaxy/src/entries/menu/store/thunks.js`（`connectWs` 函数）
- `galaxy/src/entries/menu/App.js`
- `galaxy-client/src/event/ipc.js`（`get-ws-port` handler）

---

### 10 Electron-IPC通信设计（渲染↔主进程）

**目标**：渲染进程（React 页面）与主进程之间所有 IPC 通道的完整文档。

**章节规划**：

1. IPC 通信技术选型（`electron-better-ipc` 的优势：Promise 化、自动序列化）
2. `src/preload/index.js`：preload 脚本的桥接作用
  - 在渲染进程上下文中暴露受控的 Node.js API
  - `contextBridge` 的使用（如有）
3. `src/event/ipc.js` 全量事件分类解析
  **用户认证类**：
  - `userLogin(token)` → CAS 登录，写 store，返回用户信息
  - `userLogout()` → 清理 store，重置状态
   **逆向控制类**：
  - `runInject(pid)` → 触发微信 Named Pipe 连接
  - `runQyWxInject(pid)` → 触发企微注入
  - `stop-wechat(pid)` / `stop-wxwork(pid)` / `stop-java()` → 停止各进程
   **配置读写类**：
  - `get-app-config()` → 同步返回运行时配置（含 modules 字段）
  - `get-env-settings()` / `set-env-settings(config)` → 环境配置
  - `set-user-info(info)` → 写入用户信息到 store
  - `set-is-gray(flag)` → 写入灰度标记
   **文件操作类**：
  - `exist-file(path)` → 检查文件是否存在
  - `copy-file(src, dst)` → 文件拷贝
  - `convert-base64-to-file(base64, path)` → 图片转换
  - `convert-urls-to-files(urls)` → 批量 URL 转文件
  - `readFileAsBase64(path)` → 读取文件为 base64
   **窗口系统类**：
  - `open-url(url)` → 打开外部浏览器
  - `open-file(path)` → 打开本地文件
  - `app-relaunch()` → 应用重启
  - `app-exit()` → 应用退出
   **Cookie/Session 类**：
  - `writeUqunCookie(cookie)` → 写入 uqun 站的 Session
  - `writeGidCookie(gid)` → 写入 gid Cookie
   **WebSocket 端口类**：
  - `get-ws-port()` → 从注册表读取 Java WS 端口
  - `hasLoginedAccount()` → 检测企微登录状态（调 DLL）
4. 渲染进程侧（`galaxy/src/common/ipc.js`）：调用封装
5. IPC 事件的错误处理约定（try/catch + 错误码返回）
6. 主进程主动推送渲染进程的事件（`ipcMain.send` 方向）
7. 多窗口场景下的广播 vs 定向发送

**关键代码路径**：

- `galaxy-client/src/event/ipc.js`
- `galaxy-client/src/preload/index.js`
- `galaxy/src/common/ipc.js`
- `galaxy/src/alias/electron.js`（IPC 适配层）

---

### 11 定时任务系统设计

**目标**：所有定时器的职责、调度策略、异常处理。

**章节规划**：

1. 定时任务框架：`node-cron` 选型分析
2. `src/msg-center/start/schedual.js`：定时任务注册入口
  - `scheduleRun()` 函数解析
  - cron 表达式说明（每 10 秒的写法）
3. 五个定时任务详解
  **HeartBeatTimer**（逆向 IPC 心跳）：
  - 职责：维持 Named Pipe 连接的心跳，防止超时断开
  - 调用链：`HeartBeatTimer.heartBeat()` → `reverseSend` → `IpcClientSendMessage`
  - 心跳间隔设计（`ipcConfig.js` 中的 `HEART_BEAT_TIME`）
   **delaySendFrontmsgTimer**（延迟补发前端消息）：
  - 职责：对发送失败的前端 WS 消息进行延迟重试
  - 存储机制（失败消息暂存到哪里）
  - 重试策略
   **PingTimer**（Ping 检测）：
  - 职责：检测网络连通性 / 服务可用性
  - Ping 目标与成功/失败处理
   **ProcessMakeUpTaskTimer**（任务补偿）：
  - 职责：对失败的 MQTT 任务进行周期性重试
  - 与 `mqttMakeUpManager.js` 的协作
  - 最大重试次数 & 过期清理
   **GalaxyTaskStatusTimer**（Galaxy 任务状态检查）：
  - 职责：周期性检查 Galaxy 任务的执行状态
  - 状态异常时的处理逻辑
4. `setRecordInfo(0)` 的触发时机（崩溃检测心跳，见文档13）
5. 定时任务的异常捕获模式（防止一个任务崩溃影响其他任务）
6. 定时任务的启停控制（开发 vs 生产）

**关键代码路径**：

- `galaxy-client/src/msg-center/start/schedual.js`
- `galaxy-client/src/msg-center/business/timer/HeartBeatTimer.js`
- `galaxy-client/src/msg-center/business/timer/delaySendFrontmsgTimer.js`
- `galaxy-client/src/msg-center/business/timer/PingTimer.js`
- `galaxy-client/src/msg-center/business/timer/ProcessMakeUpTaskTimer.js`
- `galaxy-client/src/msg-center/business/timer/GalaxyTaskStatusTimer.js`

---

### 12 内存队列执行器设计（MemoryQueue）

**目标**：理解 `MemoryQueueExecute.js` 的并发控制、背压、超时等设计细节。

**章节规划**：

1. 设计背景：为什么需要内存队列（MQTT 消息处理的串行化需求）
2. `MemoryQueueApplication.js`：单例启动入口
3. `MemoryQueueExecute.js` 完整解析
  **数据结构**：
  - `queue: Array`（任务队列）
  - `maxSize`（最大队列容量）
  - `timeOut`（单任务超时时间）
  - `isRunning: boolean`（执行状态标志）
   **核心方法**：
  - `put(workTask)` — 入队逻辑
    - 队满时的处理策略（丢弃 or 覆盖？）
    - 工作任务（workTask）的数据结构
  - `start()` — `while(true)` 异步执行循环
    - `await workTask.execute()` 的执行方式
    - `setTimeout(resolve, timeOut)` 超时强制跳过
    - `compareAndSet` CAS 保护的实现细节
  - `compareAndSet(expect, update)` — 简单 CAS 实现
4. 任务定义（`workTask` 的 interface）
5. 队列满时的监控告警（是否有 SLS 上报？）
6. 与 `MemoryQueueApplication` 的协作
7. 对比：为何不用 Node.js 的 `stream.Transform` 或 `p-queue` 等方案
8. 并发安全性分析（单线程 JS 下的"伪并发"问题）
9. 性能特征：队列深度与处理延迟的关系

**关键代码路径**：

- `galaxy-client/src/msg-center/core/queue/MemoryQueueExecute.js`
- `galaxy-client/src/msg-center/core/queue/MemoryQueueApplication.js`

---

### 13 崩溃检测与活动心跳记录

**目标**：理解客户端异常崩溃时的检测机制与上报流程。

**章节规划**：

1. 崩溃检测的设计思路（无进程守护情况下的心跳方案）
2. `src/common/recordActivityInfo.js` 完整解析
  `**judgeCrashAndReport()` — 启动时崩溃判断**：
  - 读取 store 中的 `activityInfo`
  - 判断条件：`status === 0`（正在运行）AND `now - lastTime > 30s`
  - 视为崩溃：上报 `CRASH` 事件到 SLS / Habo
  - 上报内容：上次运行的 wxid 列表、版本号、内存信息
   `**setRecordInfo(status)` — 运行中心跳写入**：
  - 由 `schedual.js` 每 10 秒调用一次（`status=0` 表示正在运行）
  - 正常退出时写入 `status=1`（`before-quit` 事件触发）
  - 写入字段：`status`、`timestamp`、`wxidList`、`version`、`memUsage`
3. 崩溃上报的数据链路（SLS / Habo 上报的参数结构）
4. `src/event/app.js` 中 `before-quit` 事件：正常退出时写入 status=1
5. 崩溃数据的清除时机（下次启动成功后清除）
6. 局限性分析（30s 检测窗口 → 最短崩溃检测延迟）
7. 与 Electron 内置 `crashReporter` 的关系

**关键代码路径**：

- `galaxy-client/src/common/recordActivityInfo.js`
- `galaxy-client/src/common/store.js`（`activityInfo` 字段）
- `galaxy-client/src/msg-center/start/schedual.js`（调用 `setRecordInfo`）
- `galaxy-client/src/event/app.js`（`before-quit` 事件）

---

### 14 日志系统设计（electron-log与阿里云SLS）

**目标**：所有日志输出的路径、分级、格式、远程上报方式。

**章节规划**：

1. 日志技术栈选型：`electron-log` + 阿里云 SLS
2. `src/init/log.js`（`initLog()`）：日志系统初始化
  - 日志文件路径（`userData/logs/`）
  - 日志级别配置（`info`、`warn`、`error`）
  - 日志格式配置（时间格式、前缀等）
  - 主进程 vs 渲染进程日志的统一
3. SLS 远程上报（`src/init/sls.js` 或类似文件）
  - SLS project / logstore 配置
  - 上报触发条件（ERROR 级别及以上自动上报）
  - 批量发送 vs 实时发送
  - 阿里云 SLS SDK 的使用方式
4. Habo 行为上报（埋点）
  - 与 SLS 的区别（用户行为 vs 系统日志）
  - 常见埋点事件（启动、崩溃、功能使用）
5. 渲染进程（React）的日志
  - `galaxy/src/common/log.js` 的实现
  - 渲染进程日志如何传递到主进程统一输出
6. 日志文件的轮转（`maxFiles`、`maxSize` 配置）
7. 开发模式下的日志输出（控制台 + 文件双输出）
8. 日志调试技巧（如何用日志排查 MQTT 消息丢失等问题）

**关键代码路径**：

- `galaxy-client/src/init/log.js`
- `galaxy-client/src/init/` 目录下其他初始化文件
- `galaxy/src/common/log.js`
- `galaxy/electron/init/log.js`

---

### 15 自动更新机制（electron-updater）

**目标**：客户端如何检测、下载、安装新版本。

**章节规划**：

1. `electron-updater` 工作原理概述
2. `src/event/updater.js`：更新事件注册
  - `checking-for-update` / `update-available` / `update-downloaded` 事件处理
  - 更新 UI 通知（向渲染进程发送 IPC 消息）
3. 更新服务器配置（`electron-builder.yml` 中的 `publish` 字段）
  - OSS bucket 地址 / GitHub Releases
4. 强制更新 vs 静默更新的判断逻辑
5. 增量更新 vs 全量更新
6. 更新失败的降级处理
7. 测试环境的更新通道隔离

**关键代码路径**：

- `galaxy-client/src/event/updater.js`
- `galaxy-client/config/weixinzhushou/build.yml`（publish 配置）

---

### 16 SQLite数据库层与Sequelize-ORM设计

**目标**：本地数据库的表结构设计、ORM 使用方式、查询服务封装。

**章节规划**：

1. SQLite 选型原因（轻量、嵌入式、不需要服务器进程）
2. 数据库文件存储位置（`userData/` 目录）
3. `src/sqlite/` 目录结构解析
  - `entities/` 各实体文件：`chatroom`、`friend`、`external_user`、`conversation`、`wk_`* 系列
  - 每张表的字段说明（主键、索引、外键关系）
4. Sequelize 初始化配置（`dialect: sqlite`、`storage: dbPath`）
5. 常用查询模式（CRUD 封装）
6. `src/msg-center/business/dao-service/` 各查询服务
  - 好友查询 / 群聊查询 / 消息记录查询 的封装模式
7. 数据库迁移策略（`sync({ alter: true })`）
8. 与 `electron-store` 的职责边界（结构化关系数据 vs 简单 KV 配置）
9. 数据库性能优化（索引设计、批量插入）

**关键代码路径**：

- `galaxy-client/src/sqlite/entities/`（各实体文件）
- `galaxy-client/src/msg-center/business/dao-service/`
- `galaxy-client/src/msg-center/business/dao-model/`

---

### 17 消息调度层设计（dispatchInBound与OutBound）

**目标**：MQTT → 逆向 IPC → 前端的完整消息流转路径。

**章节规划**：

1. 调度层在整体架构中的位置（位于 `dispatch-center/`）
2. 入站调度（`dispatchInBound.js`）
  - 云端 MQTT 下发任务 → 路由到对应业务 Service
  - `WxConvertServiceList`（微信）vs `WorkWxConvertServiceList`（企微）路由
  - `reverseSend.js`：向逆向 Named Pipe 发送命令
3. 出站调度（`dispatchOutBound.js`）
  - 逆向 IPC 接收到的微信消息 → 转换格式 → 上报云端 + 推送前端
  - `frontSend.js`：向前端 WebSocket 推送
  - `mqttSend.js`：向云端 MQTT 上报
4. `dispatch/` 子目录：细粒度调度子模块
5. `handle/` 子目录：微信/企微双系列消息 handler
6. 消息流的错误处理（哪个环节失败后的补偿机制）
7. 消息格式转换层（`convert-service/`、`convert-response/`）的介入点

**关键代码路径**：

- `galaxy-client/src/msg-center/dispatch-center/dispatchInBound.js`
- `galaxy-client/src/msg-center/dispatch-center/dispatchOutBound.js`
- `galaxy-client/src/msg-center/dispatch-center/reverseSend.js`
- `galaxy-client/src/msg-center/dispatch-center/frontSend.js`
- `galaxy-client/src/msg-center/dispatch-center/mqttSend.js`

---

### 18 运行时配置管理（runtime.yml与Apollo）

**目标**：运行时可配置项的加载、读取、动态更新机制。

**章节规划**：

1. 配置分层设计（编译时 vs 运行时 vs 动态配置）
2. `config/weixinzhushou/runtime.yml` 字段全解析
  - `mqttEndpoint`、`mqttGroupId`、`mqttInstanceId`（MQTT 接入点）
  - `apiBase`（后端 API 基础路径）
  - `modules`（功能模块开关，如 `wechat`、`wxwork`）
  - 其他字段
3. `runtime.dev.yml` 与 `runtime.yml` 的差异（开发/生产）
4. `src/msg-center/core/application-config/`：运行时配置读取封装
  - 启动时加载 yml 文件
  - `get-app-config` IPC 接口（同步返回到渲染进程）
5. Apollo 动态配置（`src/msg-center/core/utils/apolloConfig.js`？）
  - 与 `runtime.yml` 的关系（Apollo 可覆盖 yml 中的部分配置）
  - 定时拉取 Apollo 配置的机制
  - `isGray`（灰度标记）对配置源的影响
6. 环境配置的前端读取方式（`ipc.callMain('get-app-config')`）
7. 配置变更时的热更新（不重启客户端直接生效）

**关键代码路径**：

- `galaxy-client/config/weixinzhushou/runtime.yml`
- `galaxy-client/config/weixinzhushou/runtime.dev.yml`
- `galaxy-client/src/msg-center/core/application-config/`
- `galaxy-client/src/event/ipc.js`（`get-app-config` handler）
- `galaxy-client/src/common/store.js`（`envSettings` / `isGray`）

---

### 19 缓存层与注册表管理设计

**目标**：内存缓存的类型与用途，以及所有已连接微信实例的生命周期管理。

**章节规划**：

1. 缓存层总览（`src/msg-center/core/cache/` 目录）
  - 各 Cache 类的职责（好友缓存、群成员缓存、任务缓存等）
  - 缓存设计模式（Map、TTL、LRU 等）
2. 注册表管理（`src/msg-center/core/registry-config/`）
  - `registryList` 的数据结构（每个条目：pid、wxid、handle、type）
  - 微信实例的注册时机（Named Pipe 连接建立后）
  - 微信实例的注销时机（进程消失后）
  - 多账号场景下的并发访问保护
3. `src/common/store.js` 中的 `registryList` 与内存 registry 的同步
4. 对象池（`src/msg-center/core/pool/`）的设计
5. 工厂模式（`src/msg-center/core/factory/`）的使用场景

**关键代码路径**：

- `galaxy-client/src/msg-center/core/cache/`
- `galaxy-client/src/msg-center/core/registry-config/`
- `galaxy-client/src/msg-center/core/pool/`
- `galaxy-client/src/msg-center/core/factory/`

---

### 20 Worker-Threads多线程设计

**目标**：哪些耗时操作被放到 Worker Thread，如何通信。

**章节规划**：

1. Node.js Worker Threads 适用场景
2. `src/msg-center/core/worker-threads/` 目录解析
3. 具体哪些任务使用了 Worker（音频转换？文件加密？Protobuf 解析？）
4. 主线程与 Worker 的通信方式（`parentPort.postMessage`）
5. Worker 异常处理与重启策略
6. 与 `child_process` 的对比（为何选 Worker Threads）

**关键代码路径**：

- `galaxy-client/src/msg-center/core/worker-threads/`
- `galaxy-client/src/test/worker-threads/`（测试代码参考）

---

### 21 前端路由与Redux状态管理（galaxy端）

**目标**：`galaxy` 前端的页面组织、路由跳转、全局状态管理。

**章节规划**：

1. 多入口路由架构总览（4 个入口相互独立）
2. `sub` 入口路由（`src/entries/sub/router/index.js`）
  - `menu.config.js` 动态菜单配置
  - `React.lazy` 动态加载各功能模块
  - 路由 path 与模块目录名的对应关系
3. `menu` 入口路由
  - `MemoryRouter` 的使用原因
  - EmbedSys 内部路由（见文档06）
4. Redux Store 结构（`src/entries/menu/store/`）
  - `reducers/` 各 slice 的职责
  - `thunks.js`：异步 action 汇总
  - WebSocket 实例的存储方式（`wsMenu`）
5. 跨窗口状态同步问题（`menu.html` 与 `sub.html` 无法共享 Redux）
  - Electron IPC 作为跨窗口通信桥梁
  - `sub` 窗口如何获取 `menu` 窗口的账号列表
6. Redux DevTools 集成（开发调试）

**关键代码路径**：

- `galaxy/src/entries/sub/router/index.js`
- `galaxy/src/config/menu.config.js`
- `galaxy/src/entries/menu/store/`
- `galaxy/src/entries/menu/store/thunks.js`

---

### 22 多窗口管理与渲染进程架构

**目标**：4 个 BrowserWindow 的创建、通信、生命周期管理。

> **注意**：`galaxy` 仓库的 `electron/` 目录代码已废弃，窗口管理完全由 `galaxy-client` 主进程负责。

**章节规划**：

1. Electron 多窗口设计原则
2. `galaxy-client/src/renderer/index.js`：主窗口创建
  - 窗口尺寸与默认配置
  - `webPreferences` 关键配置（`nodeIntegration`、`webviewTag`、`preload`）
  - `loadURL` 加载哪个 HTML 入口（开发 vs 生产路径）
3. 4 个窗口的创建时机与触发条件（load → menu → sub → vpn 的先后关系）
4. 窗口间通信机制
  - `BrowserWindow.getAllWindows()` 广播
  - `webContents.send()` 定向发送
5. 窗口状态持久化（`windowState` 在 store 中的读写）
6. `src/common/screenAdapter.js`：屏幕自适应（高 DPI / 多显示器）
7. 窗口安全配置（`nodeIntegration: true` 的使用原因）

**关键代码路径**：

- `galaxy-client/src/renderer/index.js`
- `galaxy-client/src/event/app.js`（窗口生命周期）
- `galaxy-client/src/common/screenAdapter.js`

---

### 23 错误处理与监控上报体系

**目标**：异常捕获、用户行为上报、性能监控的完整链路。

**章节规划**：

1. 未捕获异常处理
  - Node.js 主进程：`process.on('uncaughtException')` / `unhandledRejection`
  - 渲染进程：`window.onerror` / React ErrorBoundary
2. Habo 埋点上报
  - 常见埋点点位（启动成功、崩溃、MQTT 连接失败等）
  - 上报 SDK 的使用方式
3. SLS 错误日志上报（见文档14）
4. 性能监控（`src/init/monitor.js` 或类似）
  - 内存占用监控
  - 主进程响应时间监控
5. `galaxy-client/src/common/recordActivityInfo.js`（见文档13）的上报调用

**关键代码路径**：

- `galaxy-client/src/init/`（monitor / habo 相关）
- `galaxy/electron/init/monitor.js`
- `galaxy/src/common/log.js`

---

### 24 安全配置与代码注入机制

**目标**：理解 `nodeIntegration`、`preload`、`inject.js`、`webviewPreload.js` 的安全设计。

**章节规划**：

1. Electron 安全最佳实践 vs 本项目的实际选择（`nodeIntegration: true` 的取舍）
2. `src/preload/index.js`（galaxy-client 端）
  - 在 `contextIsolation: false` 下运行的含义
  - 向渲染进程暴露的 API
3. `extraResources/load/inject.js`：主窗口 preload
  - 启动时注入到所有 BrowserWindow 的脚本
  - 提供哪些全局变量 / 函数
4. `extraResources/load/webviewPreload.js`：webview preload
  - 注入到 `<webview>` 标签内部的脚本
  - webview 内部如何调用主进程 API
5. `conditional-loader.js`（galaxy 端）
  - 浏览器模式下剔除 Electron 依赖的条件编译
  - `src/alias/electron.browser.js` 的 mock 实现
6. Cookie 注入（`writeUqunCookie`）的实现原理
7. CSP（Content Security Policy）配置（如有）

**关键代码路径**：

- `galaxy-client/src/preload/index.js`
- `galaxy-client/extraResources/load/inject.js`
- `galaxy-client/extraResources/load/webviewPreload.js`
- `galaxy/conditional-loader.js`
- `galaxy/src/alias/electron.js` / `electron.browser.js`
- `galaxy/electron/init/window.js`（`webPreferences`）

---

## 生产优先级建议

按「**理解整个系统的必要程度**」排序，建议按以下顺序生产：

**第一批（核心骨架，必须先读）**：

1. 文档01 — 目录结构
2. 文档04 — 主进程启动
3. 文档06 — 多Webview渲染
4. 文档07 — 逆向IPC
5. 文档05 — MQTT

**第二批（基础设施）**：
6. 文档02 — 本地开发
7. 文档03 — 打包构建
8. 文档10 — Electron IPC
9. 文档08 — electron-store
10. 文档17 — 消息调度层

**第三批（专项深挖）**：
11. 文档09 — 前端WebSocket
12. 文档11 — 定时任务
13. 文档12 — 内存队列
14. 文档16 — SQLite ORM
15. 文档18 — 运行时配置

**第四批（配套机制）**：
16. 文档13 — 崩溃检测
17. 文档14 — 日志系统
18. 文档19 — 缓存注册表
19. 文档21 — 前端路由Redux
20. 文档22 — 多窗口管理

**第五批（完整补全）**：
21. 文档15 — 自动更新
22. 文档20 — Worker Threads
23. 文档23 — 错误监控
24. 文档24 — 安全注入

---

*清单生成时间：2026-03-12 | 基于 galaxy-client + galaxy 仓库实际代码分析*