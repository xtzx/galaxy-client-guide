# 14 日志系统设计（electron-log 与阿里云 SLS）

> **文档定位**：所有日志输出的路径、分级、格式、远程上报方式。  
> **核心技术栈**：`electron-log`（本地日志） + `ali-sls`（阿里云 SLS 远程日志） + `Habo`（行为埋点上报）

---

## 目录

1. [日志体系全景图](#1-日志体系全景图)
2. [日志初始化 initLog.js](#2-日志初始化-initlogjs)
3. [日志工具 log.js](#3-日志工具-logjs)
4. [阿里云 SLS 远程日志 slsLog.js](#4-阿里云-sls-远程日志-slslogjs)
5. [Habo 行为上报 habo.js](#5-habo-行为上报-habojs)
6. [主进程异常监控 monitor.js](#6-主进程异常监控-monitorjs)
7. [渲染进程日志（galaxy 前端端）](#7-渲染进程日志galaxy-前端端)
8. [SLS 配置与环境区分](#8-sls-配置与环境区分)
9. [日志使用全景分布](#9-日志使用全景分布)
10. [galaxy 旧版日志体系（对比参考）](#10-galaxy-旧版日志体系对比参考)
11. [日志调试技巧](#11-日志调试技巧)
12. [关键代码路径索引](#12-关键代码路径索引)

---

## 1. 日志体系全景图

Galaxy Client 的日志体系分为三条独立的管道，各司其职：

```
┌─────────────────────────────────────────────────────────┐
│                   galaxy-client 主进程                    │
│                                                         │
│  业务代码                                                │
│    │                                                    │
│    └──▶ logUtil.customLog(message, options)              │
│           │                                             │
│           ├──▶ electron-log ──▶ 本地日志文件              │
│           │     (仅 error 级别写入文件)                    │
│           │                                             │
│           └──▶ slsLogUtil.customLog() ──▶ 阿里云 SLS     │
│                 (所有级别远程上报)                          │
│                                                         │
│  埋点/事件上报                                            │
│    │                                                    │
│    └──▶ reportLog(data) ──▶ Habo HTTP 上报               │
│                            ──▶ 灵犀机器人告警（条件触发）   │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                   galaxy 前端渲染进程                      │
│                                                         │
│  WebSocket 消息日志                                       │
│    └──▶ createWsLogger() ──▶ console（仅开发调试）        │
│                                                         │
│  埋点上报                                                │
│    └──▶ window.habo / reportLog() ──▶ Habo HTTP 上报    │
│                                                         │
│  异常监控                                                │
│    └──▶ Sentry ──▶ Sentry 服务端                        │
└─────────────────────────────────────────────────────────┘
```

### 1.1 三条日志管道对比

| 管道 | 技术 | 作用 | 数据流向 |
|------|------|------|----------|
| 本地日志 | `electron-log` | 本地文件记录，供开发排查 | `userData/logs/` 目录 |
| 远程日志 | `ali-sls` | 阿里云 SLS，线上问题定位 | SLS Logstore |
| 行为埋点 | `Habo` | 用户行为/事件统计 | Habo 服务端 |

---

## 2. 日志初始化 initLog.js

**文件路径**：`galaxy-client/src/init/initLog.js`

```javascript
const log = require('electron-log');
const slsLogUtil = require('./slsLog.js');

function initLog() {
    log.transports.file.format = '{h}:{i}:{s}:{ms} {text}';
    log.transports.file.level = 'error';
    log.transports.file.maxSize = 1024*1024*100;
    slsLogUtil.initSlsLog();
}

module.exports = initLog;
```

### 2.1 配置详解

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `file.format` | `{h}:{i}:{s}:{ms} {text}` | 日志格式：`时:分:秒:毫秒 内容` |
| `file.level` | `error` | **仅 error 级别及以上写入文件** |
| `file.maxSize` | `1024*1024*100` (100MB) | 单个日志文件最大 100MB |

### 2.2 调用时机

在 `electron.js` 入口中，作为第一个初始化步骤调用：

```javascript
// galaxy-client/src/electron.js
global.readyStartTime = Date.now();
initLog();           // ← 最先初始化日志
setupRemoteDebug();
addAppEvent();
addIpcEvent();
addStoreEvent();
```

### 2.3 日志文件存储位置

`electron-log` 默认将日志写入 `app.getPath('userData')/logs/` 目录：

- Windows: `C:\Users\{user}\AppData\Roaming\{app-name}\logs\`
- 文件名格式: `main.log`

### 2.4 为什么只记录 error 级别

本地日志文件只记录 `error` 级别，是因为：
- `info` 级别日志量大，100MB 会很快写满
- 所有级别的日志都已通过 SLS 远程上报
- 本地日志主要用于无网络环境下的紧急排查

---

## 3. 日志工具 log.js

**文件路径**：`galaxy-client/src/init/log.js`

```javascript
const log = require('electron-log');
const slsLogUtil = require('./slsLog.js');

const logUtil = {
    customLog(message, options) {
        slsLogUtil.customLog(message);
        const {level = 'info', errorKey = ''} = options ?? {};
        if (level === 'error') {
            log[level](errorKey, message);
        }
        else {
            log[level](message);
        }
    },
};

module.exports = logUtil;
```

### 3.1 双通道写入机制

`customLog` 每次调用都会同时写入两个通道：

1. **SLS 远程日志**：`slsLogUtil.customLog(message)` — 所有日志都上报
2. **electron-log 本地日志**：`log[level](message)` — 根据 `initLog` 配置，只有 `error` 级别写入文件

### 3.2 参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `message` | `string` | 必填 | 日志内容 |
| `options.level` | `string` | `'info'` | 日志级别：`info` / `warn` / `error` |
| `options.errorKey` | `string` | `''` | 错误分类标签，仅 error 级别使用 |

### 3.3 使用示例

```javascript
// 普通信息日志
logUtil.customLog(`[wxid-${wxId}] 连接建立成功`);

// 错误日志，带分类标签
logUtil.customLog(
    `[codeError] [${error.message}] [${error.stack}]`,
    { level: 'error', errorKey: 'removePipeError' }
);

// 带业务上下文的日志
logUtil.customLog(`[wxid-${wxId}][mqttClientBase] removeMqtt success`);
```

### 3.4 被引用情况

`logUtil` 被 90+ 个文件引用，是项目中使用最广泛的日志工具，覆盖：

- `msg-center/` 下的 MQTT、逆向 IPC、消息调度等核心模块
- `event/` 下的 IPC 事件处理
- `common/` 下的通用工具
- `init/` 下的初始化模块

---

## 4. 阿里云 SLS 远程日志 slsLog.js

**文件路径**：`galaxy-client/src/init/slsLog.js`

```javascript
const SlsLogger = require("ali-sls");
const log = require("electron-log");
const { httpFetch } = require("../common/fetch");
const { access, decode } = require("../common/encryptUtil");
const ApplicationEnv = require("../msg-center/core/application-config/index");
const { clientVersion, clientSonVersion } = require("../common/urls");
const getStoreGid = require("../common/gid");
const store = require("../common/store");
const registryList =
    require("../msg-center/core/registry-config/registryList").getInstance();

const ossAccessKeyUrl = ApplicationEnv["sls.expiration.url"];
const slsStore = "gaotu-wxzs-client-node-log" || ApplicationEnv["sls.store"];
const END_POINT = "gaotu-new.cn-beijing-intranet.log.aliyuncs.com";
```

### 4.1 SLS 配置

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `endpoint` | `gaotu-new.cn-beijing-intranet.log.aliyuncs.com` | SLS 内网接入点（北京区域） |
| `logstore` | `gaotu-wxzs-client-node-log` | 日志存储库名称 |
| `accessKeyUrl` | 从 `ApplicationEnv` 读取 | 获取临时 AK/SK 的地址 |

### 4.2 临时凭证获取 getSlsAk

```javascript
const getSlsAk = async () => {
    try {
        let accessRes = await httpFetch({
            url: ossAccessKeyUrl,
            data: {
                access: access("arms-corp"),
            },
        });
        const res = JSON.parse(decode(accessRes.data));
        return res;
    } catch (error) {
        log.error(
            "getSlsAkError",
            `getMqttAccess [getSlsAk] Error: ${JSON.stringify(error)}`
        );
        return {};
    }
};
```

凭证获取流程：

1. 使用 `encryptUtil.access("arms-corp")` 生成加密访问令牌
2. 通过 HTTP 请求到凭证服务获取临时 `accessKey` / `secretKey`
3. 使用 `encryptUtil.decode()` 解密响应数据
4. 返回 `{ accessKey, secretKey }` 供 SLS 客户端使用

### 4.3 SLS 客户端初始化 initSlsLog

```javascript
const slsLogUtil = {
    slsClient: null,
    slsExpiration: 0,
    pedding: false,
    gid: getStoreGid(),

    async initSlsLog() {
        if (this.pedding) {
            return;
        }
        this.pedding = true;
        const { accessKey, secretKey } = await getSlsAk();
        if (!accessKey || !secretKey) {
            this.pedding = false;
            return;
        }
        this.slsClient = new SlsLogger({
            endpoint: END_POINT,
            accessKey,
            accessSecret: secretKey,
            logstore: slsStore,
        });
        this.pedding = false;
        return this.slsClient;
    },
```

**并发保护**：使用 `pedding` 标志防止多次并发初始化。

### 4.4 日志写入 customLog

```javascript
    async customLog(message, options) {
        if (!this.slsClient) {
            await this.initSlsLog();
        }
        const casUserInfo = store.getUserInfo();
        const registrys = registryList.getRegistryList();
        this.slsClient?.info(
            `[${casUserInfo?.user}] [${this.gid}] [${clientSonVersion}] [${clientVersion}] [号数量: ${registrys.length}] ${message}`
        );
    },
};
```

### 4.5 SLS 日志格式

每条日志的格式为：

```
[CAS用户ID] [设备GID] [子版本号] [主版本号] [号数量: N] 业务日志内容
```

示例：

```
[zhangsan] [abc123def456] [2.3.1.5] [2.3.1] [号数量: 3] [wxid-wxid_abc123][mqttClientBase] 消息处理完成
```

这种格式便于在 SLS 控制台中按用户、设备、版本号快速过滤和检索。

### 4.6 懒初始化机制

SLS 客户端采用懒初始化策略：

1. `initLog()` 时调用 `slsLogUtil.initSlsLog()` 首次初始化
2. 如果初始化失败（网络问题），`slsClient` 为 `null`
3. 后续每次 `customLog()` 调用时，检测到 `slsClient` 为 `null` 会重新尝试初始化
4. 使用 `?.` 操作符，`slsClient` 为 `null` 时静默跳过，不影响业务

---

## 5. Habo 行为上报 habo.js

**文件路径**：`galaxy-client/src/init/habo.js`

Habo 是项目使用的行为埋点系统，与 SLS 日志有本质区别：

| 维度 | SLS 日志 | Habo 埋点 |
|------|----------|-----------|
| 数据类型 | 运行时日志文本 | 结构化事件数据 |
| 触发方式 | 每行代码中的 `customLog` | 特定事件点的 `reportLog` |
| 用途 | 问题排查、链路追踪 | 数据统计、异常告警 |
| 格式 | 自由文本 | 固定字段 + JSON |

### 5.1 底层上报 haboReport

```javascript
const haboReport = params => {
    httpFetch({
        url: haboUrl,
        data: {
            name: 'gt-pinzeng-wxzs-pc',
            env: 9,
            t: Date.now().toString(36),
            ver: 'backend',
            ...params
        }
    })
};
```

### 5.2 上报上下文自动注入 eventReport

```javascript
const eventReport = (type = 'click', data = {}) => {
    const userInfo = store.getUserInfo() || {};
    const registrys = registryList.getRegistryList();
    const wxIdStr = registrys.map(registry => registry?.wxid).join(',');
    data.user_info = JSON.stringify(userInfo);
    data.client_version = clientVersion;
    data.gid = getStoreGid();
    data.user_number = userInfo.accoundId;
    data.wx_id_str = wxIdStr;
    data.app_start_time = global.startTime;
    haboReport(data);
}
```

每次上报自动注入的字段：

| 字段 | 来源 | 说明 |
|------|------|------|
| `user_info` | `store.getUserInfo()` | CAS 登录用户完整信息 |
| `client_version` | `urls.clientVersion` | 客户端版本号 |
| `gid` | `store.getGid()` | 设备唯一标识 |
| `user_number` | `userInfo.accoundId` | 用户账号 |
| `wx_id_str` | `registryList` | 所有微信实例 wxid |
| `app_start_time` | `global.startTime` | 应用启动时间戳 |

### 5.3 reportLog — 统一入口

```javascript
const reportLog = (data) => {
    eventReport('click', {
        other_data: JSON.stringify(data),
        event_id: '10694697655035904'
    });
    snedNotifyReport(data);
}
```

`reportLog` 同时完成两件事：
1. 向 Habo 发送事件数据
2. 根据事件类型触发灵犀告警

### 5.4 常见上报事件

| 事件名 | 触发场景 | 来源文件 |
|--------|----------|----------|
| `CRASH` | 客户端崩溃（心跳判断） | `recordActivityInfo.js` |
| `UNCAUGHT_EXCEPTION` | 主进程未捕获异常 | `monitor.js` |
| `REVERSE_BUG_REPORT` | 逆向程序 BUG | `inject.js` |
| `EXEC_ERROR` | 执行异常 | 多个业务文件 |
| `START_SUCCESS_COST` | 启动耗时统计 | `window.js` |
| `RESOURCE_USAGE` | 资源使用上报 | `processUsageReport.js` |

---

## 6. 主进程异常监控 monitor.js

**文件路径**：`galaxy-client/src/common/monitor.js`

### 6.1 全局异常捕获

```javascript
function processErrorMonitor() {
    process.on('uncaughtException', error => {
        crashOrErrorReport('UncaughtException', null, error);
    });
    process.on('unhandledRejection', (reason, promise) => {
        crashOrErrorReport('UnhandledRejection', null, reason);
    });
}
```

两个全局监听器确保所有未被 `try-catch` 捕获的异常都不会静默丢失：

| 事件 | 触发条件 | 说明 |
|------|----------|------|
| `uncaughtException` | 同步代码中未捕获的 throw | 最严重的异常类型 |
| `unhandledRejection` | Promise reject 未被 catch | 异步代码中的未处理错误 |

### 6.2 异常上报 crashOrErrorReport

```javascript
async function crashOrErrorReport(name, event, error) {
    if (error) {
        logUtil.customLog(
            `[${name}], ${error.name} ${error.message} ${error.stack}`,
            { level: 'error', errorKey: 'UncaughtException' }
        );
        reportLog({
            name: 'UNCAUGHT_EXCEPTION',
            errorName: name,
            errorMessage: error.message,
            errorStack: error.stack,
            errorStr: JSON.stringify(error),
        })
    } else if (event) {
        logUtil.customLog(`[${name}]`, {
            level: 'error',
            errorKey: 'RendererProcessCrashed'
        })
    }
}
```

异常上报包含完整的错误链：错误名称、错误消息、调用栈。

### 6.3 Sentry 的历史（已弃用）

代码中保留了大段被注释的 `@sentry/electron` 集成代码，说明项目曾使用 Sentry 做异常监控。当前已切换到 Habo + SLS 的方案。

---

## 7. 渲染进程日志（galaxy 前端端）

### 7.1 WebSocket 消息日志

**文件路径**：`galaxy/src/common/log.js`

```javascript
export function createWsLogger(toOrFrom, subOrMenu) {
    let getTitle = (count, channelId) => '未知消息';
    switch (toOrFrom + ' ' + subOrMenu) {
        case 'to sub':
            getTitle = (count, channelId) =>
                '⇲ sub' + channelId + ' [' + count[channelId] + ']';
            break;
        case 'from sub':
            getTitle = (count, channelId) =>
                'sub' + channelId + ' ⇱ [' + count[channelId] + ']';
            break;
        case 'to menu':
            getTitle = (count, channelId) =>
                '⇱ menu [' + count[channelId] + ']';
            break;
        case 'from menu':
            getTitle = (count, channelId) =>
                'menu ⇲ [' + count[channelId] + ']';
            break;
    }
    return (function (getTitle) {
        const count = {};
        getTitle = getTitle.bind(null, count);
        return news => {
            if (!project.getSwitch('debug.wsLogger')) return;
            let { body, channelId } = news;
            channelId = channelId || 0;
            const { type } = body || {};
            if (type === 'pong' || type === 'recvmsg' || type === 'filepath')
                return;
            if (!count[channelId]) count[channelId] = 0;
            count[channelId]++;
        };
    })(getTitle);
}
```

这是一个前端 WebSocket 消息调试工具：

- 受 `debug.wsLogger` 开关控制，仅在开启调试时生效
- 区分消息方向（`to`/`from`）和窗口（`sub`/`menu`）
- 过滤高频消息（`pong`、`recvmsg`、`filepath`）
- 按 `channelId` 计数

### 7.2 前端 Habo 上报

**文件路径**：`galaxy/src/common/report.js`

前端也有独立的 Habo 上报模块：

- `initHaboReport()`：初始化 Habo，挂载到 `window.habo`
- `reportLog()`：事件上报，使用与主进程相同的 `event_id`
- `reportMemoryInfo()`：性能/内存上报

### 7.3 前端 Sentry

**文件路径**：`galaxy/electron/common/monitor.js`

galaxy 前端使用 `@sentry/electron` 做异常监控（galaxy-client 已弃用 Sentry，但 galaxy 端仍在使用）。

---

## 8. SLS 配置与环境区分

### 8.1 不同环境的 SLS 配置

| 环境 | 配置文件 | `sls.store` |
|------|----------|-------------|
| 生产 | `applicationProd.js` | `qingzhou-prod-app` |
| 测试 | `applicationQa.js` | `qingzhou-noprod-app` |
| 开发 | `applicationRd.js` | 未配置（使用默认值） |

> **注意**：实际代码中 `slsStore` 的值被硬编码为 `"gaotu-wxzs-client-node-log"`（使用 `||` 运算符导致 `ApplicationEnv["sls.store"]` 永远不会生效，属于代码瑕疵）。

### 8.2 Habo URL 环境区分

```javascript
haboUrlMap: {
    prod: 'http://habo-i.gsxtj.com/backend/info',
    test: 'http://test-habo-i.gsxtj.com/backend/info',
    vt: 'http://test-habo-i.gsxtj.com/backend/info'
},
```

---

## 9. 日志使用全景分布

### 9.1 logUtil.customLog 的主要调用模块

| 模块 | 典型日志内容 |
|------|-------------|
| `msg-center/core/mq/` | MQTT 连接、订阅、消息收发 |
| `msg-center/core/reverse/` | Named Pipe 连接、消息发送 |
| `msg-center/dispatch-center/` | 消息路由、调度 |
| `msg-center/business/convert-service/` | 消息格式转换 |
| `msg-center/business/timer/` | 定时任务执行 |
| `event/app.js` / `event/ipc.js` | 应用事件、IPC 调用 |
| `init/window.js` | 窗口操作、启动耗时 |
| `common/inject.js` | DLL 注入操作 |

### 9.2 reportLog 的主要调用点

| 文件 | 上报事件 |
|------|----------|
| `recordActivityInfo.js` | `CRASH` |
| `monitor.js` | `UNCAUGHT_EXCEPTION` |
| `processUsageReport.js` | `RESOURCE_USAGE` |
| `window.js` | `START_SUCCESS_COST` |
| `inject.js` | 注入相关事件 |
| `dispatchOutBound.js` | 出站调度异常 |
| `sendToFrontUtil.js` | 前端推送异常 |
| `sqlite/entities/index.js` | 数据库操作异常 |

---

## 10. galaxy 旧版日志体系（对比参考）

### 10.1 旧版 electron-log 配置

**文件路径**：`galaxy/electron/init/log.js`

```javascript
const log = require('electron-log');

module.exports = () => {
    log.transports.console.level = 'silly';
    log.transports.file.level = 'silly';
    log.transports.ipc.level = false;
};
```

对比 galaxy-client 的日志配置：

| 配置项 | galaxy（旧） | galaxy-client（新） |
|--------|-------------|-------------------|
| console.level | `silly`（全部输出） | 默认（info 及以上） |
| file.level | `silly`（全部写入） | `error`（仅错误写入） |
| ipc.level | `false`（关闭） | 默认 |
| SLS 远程上报 | 无 | 有（ali-sls） |
| 日志格式 | 默认 | `{h}:{i}:{s}:{ms} {text}` |
| 最大文件大小 | 默认 | 100MB |

### 10.2 旧版监控

**文件路径**：`galaxy/electron/init/monitor.js`

旧版使用 `@sentry/electron` + `processErrorMonitor` 做异常监控，无 SLS/Habo 上报。

---

## 11. 日志调试技巧

### 11.1 查找本地日志

```
Windows: C:\Users\{user}\AppData\Roaming\{app-name}\logs\main.log
```

> 文件只包含 `error` 级别日志，适合快速定位严重错误。

### 11.2 SLS 查询技巧

在阿里云 SLS 控制台查询时，常用过滤方式：

```
# 按用户查询
[zhangsan]

# 按设备查询
[gid-abc123]

# 按版本查询
[2.3.1]

# 查找崩溃日志
客户端崩溃了

# 查找特定微信号的日志
[wxid-wxid_abc123]

# 查找 MQTT 相关日志
[mqttClientBase]
```

### 11.3 常见问题排查

| 问题 | 日志关键词 | 解释 |
|------|-----------|------|
| MQTT 消息丢失 | `mqttClientBase` + `onMessage` | 检查消息接收和路由 |
| Named Pipe 断连 | `removePipe` + `IpcClientClose` | 检查逆向连接状态 |
| 客户端崩溃 | `客户端崩溃了` | 检查崩溃前的资源使用情况 |
| 启动失败 | `startSuccessCost` | 检查启动耗时和初始化错误 |
| SLS 初始化失败 | `getSlsAkError` | 检查网络和凭证配置 |

---

## 12. 关键代码路径索引

| 文件路径 | 核心函数/类 | 职责 |
|---------|------------|------|
| `src/init/initLog.js` | `initLog()` | 日志系统初始化入口 |
| `src/init/log.js` | `logUtil.customLog()` | 日志工具（双通道写入） |
| `src/init/slsLog.js` | `slsLogUtil.initSlsLog()` / `customLog()` | SLS 客户端与远程上报 |
| `src/init/habo.js` | `reportLog()` / `eventReport()` | Habo 行为埋点上报 |
| `src/common/monitor.js` | `processErrorMonitor()` / `crashOrErrorReport()` | 主进程异常捕获 |
| `src/common/urls.js` | `haboUrlMap` / `haboUrl` | Habo URL 配置 |
| `src/common/notify.js` | `notify.crash()` 等 | 灵犀机器人告警 |
| `galaxy/src/common/log.js` | `createWsLogger()` | 前端 WS 消息调试日志 |
| `galaxy/src/common/report.js` | `reportLog()` | 前端 Habo 上报 |
| `galaxy/electron/init/log.js` | `initLog()` | 旧版日志配置（参考） |
| `galaxy/electron/init/monitor.js` | `initSentry()` | 旧版 Sentry 初始化 |

---

*文档生成时间：2026-03-13 | 基于 galaxy-client + galaxy 仓库实际代码分析*
