# IPC 双向通信架构详解

> 本文档详细说明 galaxy-client 与逆向客户端之间的双向 IPC 通信架构，包括连接建立、任务下发（galaxy-client → 逆向）、消息回收（逆向 → galaxy-client）的完整链路。

## 目录

- [1. 架构总览](#1-架构总览)
- [2. 核心概念](#2-核心概念)
- [3. IPC 连接建立](#3-ipc-连接建立)
- [4. 下发链路：galaxy-client → 逆向](#4-下发链路galaxy-client--逆向)
- [5. 回收链路：逆向 → galaxy-client](#5-回收链路逆向--galaxy-client)
- [6. 消息路由机制](#6-消息路由机制)
- [7. 完整代码文件索引](#7-完整代码文件索引)
- [8. 关键日志速查](#8-关键日志速查)
- [9. 常见问题](#9-常见问题)

---

## 1. 架构总览

### 1.1 系统分层

galaxy-client 是一个 Electron 应用，通过 IPC 命名管道与微信/企业微信进程中的逆向 DLL 通信。整个通信架构分为 5 层：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         galaxy-client (Electron 主进程)                      │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ 第1层：消息来源                                                        │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │ │
│  │  │ 云端 MQTT     │  │ 前端页面      │  │ 本地定时任务  │                │ │
│  │  │ (flowSource=2)│  │ (flowSource=1)│  │ (flowSource=3)│                │ │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                │ │
│  └─────────┼─────────────────┼─────────────────┼────────────────────────┘ │
│            │                 │                 │                           │
│  ┌─────────▼─────────────────▼─────────────────▼────────────────────────┐ │
│  │ 第2层：业务处理层                                                      │ │
│  │  task-mqtt/*.js          task-front/*.js        timer/*.js            │ │
│  │  (MQTT任务处理)          (前端请求处理)          (定时任务)             │ │
│  └──────────────────────────────┬────────────────────────────────────────┘ │
│                                 │                                          │
│  ┌──────────────────────────────▼────────────────────────────────────────┐ │
│  │ 第3层：消息分发中心 (dispatch-center)                                   │ │
│  │                                                                        │ │
│  │  下发方向 ──────────────────┐  ┌────────────────── 回收方向            │ │
│  │  cloudFlowInBound.js       │  │  cloudFlowOutBound.js                 │ │
│  │       ↓                    │  │       ↑                                │ │
│  │  dispatchInBound.js        │  │  msgHandleBase.js                     │ │
│  │       ↓                    │  │       ↑                                │ │
│  │  reverseSend.js ──────────IPC管道──── dispatchOutBound.js             │ │
│  │                            │  │                                        │ │
│  └────────────────────────────┘  └────────────────────────────────────────┘ │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ 第4层：IPC 通信层                                                      │ │
│  │  ┌──────────────────────┐  ┌──────────────────────┐                   │ │
│  │  │ initIpcTask.js       │  │ asyncSelectTask.js   │                   │ │
│  │  │ (连接管理/生命周期)   │  │ (消息接收循环)        │                   │ │
│  │  └──────────┬───────────┘  └──────────┬───────────┘                   │ │
│  │             │                         │                                │ │
│  │  ┌──────────▼─────────────────────────▼───────────┐                   │ │
│  │  │ clibrary.js (FFI 桥接层)                        │                   │ │
│  │  │   ffi-napi ←→ PipeCore.dll / ReUtils64.dll     │                   │ │
│  │  └────────────────────────┬───────────────────────┘                   │ │
│  └───────────────────────────┼───────────────────────────────────────────┘ │
└──────────────────────────────┼───────────────────────────────────────────────┘
                               │ Windows Named Pipe (命名管道)
┌──────────────────────────────▼───────────────────────────────────────────────┐
│  第5层：逆向客户端 (注入到微信/企微进程中的 DLL)                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │ 微信客户端 (weixin.exe / WXWork.exe)                                    │ │
│  │   └── 逆向 DLL：接收任务指令，操作微信 API，返回执行结果                  │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 双向通信概览

```
         下发（任务下达）                     回收（结果返回）
    ━━━━━━━━━━━━━━━━━━━━━━              ━━━━━━━━━━━━━━━━━━━━━━
    
    云端/前端/本地                        逆向客户端
         │                                    │
         ▼                                    ▼
    业务处理层                            asyncSelectTask.loop()
    (task-mqtt/task-front)                 (IPC轮询接收)
         │                                    │
         ▼                                    ▼
    cloudFlowInBound                     dispatchOutBound
    (添加来源标记 flowSource)             (按微信类型路由)
         │                                    │
         ▼                                    ▼
    dispatchInBound                      msgHandleBase.outBoundMsg
    (调度+任务状态缓存)                   (三段式处理+消息转换)
         │                                    │
         ▼                                    ▼
    reverseSend.pipeLineSend             businessHandler
    (IPC发送)                            (按 flowSource 路由)
         │                                    │
         ▼                               ┌────┴────┐
    PipeCore.dll                         ▼         ▼
    IpcClientSendMessage            cloudFlow   frontFlow
         │                          OutBound    OutBound
         ▼                          (→云端)     (→前端)
    命名管道 ───────→ 逆向               │         │
                                        ▼         ▼
                                    MQTT上报   WebSocket
```

---

## 2. 核心概念

### 2.1 关键对象

| 对象 | 定义文件 | 说明 |
|------|----------|------|
| **pipeLineWrapper** | `initIpcTask.js` 创建 | IPC 连接的核心上下文对象，贯穿整个通信链路 |
| **registry** | `registryList.js` 管理 | 包含 pipeLineWrapper + wxId + mqttClient 的注册信息 |
| **flowSource** | `flowSourceEnum.js` | 消息来源标记：1=前端、2=云端、3=本地 |
| **pipeCode** | `IpcConnectServer()` 返回 | IPC 管道句柄，唯一标识一个管道连接 |

### 2.2 pipeLineWrapper 结构

```javascript
pipeLineWrapper = {
    id: processId,           // 微信进程 PID
    pipeCode: pipeCode,      // IPC 管道句柄（由 DLL 返回）
    processId: processId,    // 微信进程 PID
    wxid: null,              // 登录后填充的微信 ID
    workWx: false,           // 是否是企业微信
    lastReadTime: 0,         // 最后读取消息的时间戳
}
```

### 2.3 flowSource 消息来源

任务下发时通过 `flowSource` 字段标记消息来源，逆向返回结果后，系统根据这个标记决定将结果路由到哪里：

| flowSource | 含义 | 下发入口 | 结果路由到 |
|------------|------|----------|-----------|
| 1 (FRONT) | 前端页面发起 | `frontFlowInBound.js` | `frontFlowOutBound.js` → 前端 WebSocket |
| 2 (CLOUND) | 云端 MQTT 下发 | `cloudFlowInBound.js` | `cloudFlowOutBound.js` → Service 处理 → MQTT 上报 |
| 3 (OWNER) | 本地自发 | 业务代码直接调用 | 对应的处理器 |
| 无 | 逆向主动推送 | 无（逆向主动推送） | 广播到所有处理器 |

---

## 3. IPC 连接建立

### 3.1 启动链路

```
electron.js  →  appStart.js  →  reverseStart.js  →  initIpcTask.getInstance().run()
```

### 3.2 连接建立流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     initIpcTask.run() - 无限循环                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ① 扫描进程（每 5 秒一次）                                                  │
│     IpcUtil.getProcessIds()                                                 │
│     执行 tasklist 命令，查找 weixin.exe / WXWork.exe                        │
│        │                                                                    │
│        ▼                                                                    │
│  ② 过滤可连接进程                                                           │
│     Clibrary.isUseProcess(pid)                                              │
│     检查进程是否已注入逆向 DLL 且管道可用                                     │
│        │                                                                    │
│        ▼                                                                    │
│  ③ 对比已连接列表                                                           │
│     RegistryConfig.getCurrProcessIds()                                      │
│     找出"新进程"和"已退出进程"                                               │
│        │                                                                    │
│        ├── 已退出进程 → batchCheckAndExit() → 清理连接                      │
│        │                                                                    │
│        ▼                                                                    │
│  ④ 建立 IPC 连接（针对新进程）                                               │
│     pipeCode = Clibrary.IpcConnectServer(processId)                         │
│     返回管道句柄 pipeCode                                                    │
│        │                                                                    │
│        ▼                                                                    │
│  ⑤ 创建 pipeLineWrapper 对象                                                │
│     { id, pipeCode, processId, wxid: null, workWx: false, ... }             │
│        │                                                                    │
│        ▼                                                                    │
│  ⑥ 注册连接                                                                 │
│     RegistryConfig.add(registry)                                            │
│     将连接信息存入全局注册表                                                  │
│        │                                                                    │
│        ▼                                                                    │
│  ⑦ 启动消息接收循环                                                          │
│     startSelectMessage(registry)                                            │
│       → AsyncSelectTask.run(pipeLineWrapper)                                │
│         → loop(wrapper)  ← 进入无限循环监听 IPC 消息                         │
│                                                                             │
│  ⑧ 通知前端                                                                 │
│     frontSendService.sendGetAllConfig()                                     │
│                                                                             │
│  ⑨ sleep(5000)，回到 ①                                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 底层通信原理

```
galaxy-client (Node.js 进程)              微信客户端 (微信进程)
         │                                        │
         │  ffi-napi (FFI 调用)                    │ 逆向 DLL 注入
         ▼                                        ▼
    ┌─────────────┐                         ┌─────────────┐
    │ PipeCore.dll │◄─── Named Pipe ───────►│ PipeCore.dll │
    │ (客户端)     │    (Windows 命名管道)    │ (服务端)     │
    └─────────────┘                         └─────────────┘

通信协议（推测）：
┌──────────┬────────────────────────────────┐
│  4 bytes │           N bytes              │
│  消息长度 │           消息体(JSON)          │
└──────────┴────────────────────────────────┘

数据编码流向：
  发送：JS对象 → JSON.stringify → Buffer(UTF-8) → DLL → Named Pipe
  接收：Named Pipe → DLL → Buffer(UTF-8) → JSON.parse → JS对象
```

### 3.4 DLL 核心函数

| 函数 | 作用 | 调用方 |
|------|------|--------|
| `IpcConnectServer(pid)` | 根据进程 PID 建立管道连接，返回 pipeCode | `initIpcTask.js` |
| `IpcSelectCltChannel(pipeCode)` | 检测管道是否有数据：>0 有数据(字节数)，=0 无，<0 关闭 | `asyncSelectTask.js` |
| `IpcClientRecvMessage(pipeCode, length, wxid)` | 从管道读取消息，返回 JSON 字符串 | `asyncSelectTask.js` |
| `IpcClientSendMessage(pipeCode, message)` | 向管道写入消息（Buffer → DLL → 管道） | `reverseSend.js` |
| `IpcClientClose(pipeCode)` | 关闭管道连接 | `RegistryConfig.remove()` |
| `IsValidProcess(pid)` | 检测进程是否存在 | `initIpcTask.js` |
| `CanConnectProcess(pid)` | 检测进程是否可连接（管道是否就绪） | `initIpcTask.js` |

---

## 4. 下发链路：galaxy-client → 逆向

### 4.1 下发链路全景图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      任务下发完整链路                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  消息来源（三种入口）                                                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                                  │
│  │ 云端MQTT  │  │ 前端页面  │  │ 本地定时  │                                  │
│  │ type=5   │  │ WebSocket │  │ 任务      │                                  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                                  │
│       │              │              │                                        │
│       ▼              ▼              ▼                                        │
│  ┌─────────────────────────────────────────┐                                │
│  │ 业务处理层 (task-mqtt / task-front)       │                                │
│  │ 示例：mqttGroupAnnounceService.operate() │                                │
│  │ → 构建 clientTask 对象                   │                                │
│  │ → type, taskId, data 等字段              │                                │
│  └──────────────────┬──────────────────────┘                                │
│                     │                                                        │
│                     ▼                                                        │
│  ┌──────────────────────────────────────────┐                               │
│  │ cloudFlowInBound(channelId, wxId, msg)   │  ← 添加来源标记                │
│  │                                          │                                │
│  │ 职责：                                    │                                │
│  │ 1. JSON.parse(message)                   │                                │
│  │ 2. 添加 flowSource = 2 (云端)            │                                │
│  │ 3. 调用 dispatchInBound()                │                                │
│  └──────────────────┬───────────────────────┘                               │
│                     │                                                        │
│                     ▼                                                        │
│  ┌──────────────────────────────────────────┐                               │
│  │ dispatchInBound(channelId, wxId, msg)    │  ← 调度+状态管理               │
│  │                                          │                                │
│  │ 职责：                                    │                                │
│  │ 1. 获取 registry（逆向注册信息）          │                                │
│  │ 2. 如果 registry 不存在 → 打印日志返回    │                                │
│  │ 3. 解析消息类型 type                      │                                │
│  │ 4. 判断是否需要任务状态管理               │                                │
│  │    ├── 是：加锁 → 缓存任务状态 → 发送    │                                │
│  │    └── 否：直接发送                       │                                │
│  │ 5. 调用 inBoundAct() → reverseSend       │                                │
│  │                                          │                                │
│  │ 日志：                                    │                                │
│  │ "[dispatchInBound] 开始执行"              │                                │
│  │ "[DispatchCenter]:下任务时往缓存里放任务"  │                                │
│  └──────────────────┬───────────────────────┘                               │
│                     │                                                        │
│                     ▼                                                        │
│  ┌──────────────────────────────────────────┐                               │
│  │ reverseSend.sendMessage(wxId, ch, msg)   │  ← IPC 发送                   │
│  │                                          │                                │
│  │ 职责：                                    │                                │
│  │ 1. 根据 wxId 或 channelId 获取 registry  │                                │
│  │ 2. 重复任务检测（taskLock，5秒去重）      │                                │
│  │ 3. 获取 pipeCode                         │                                │
│  │ 4. 调用 pipeLineSend()                   │                                │
│  │                                          │                                │
│  │ 日志：                                    │                                │
│  │ "ReverseSendService message:"            │                                │
│  └──────────────────┬───────────────────────┘                               │
│                     │                                                        │
│                     ▼                                                        │
│  ┌──────────────────────────────────────────┐                               │
│  │ pipeLineSend(message, wxid, pipeCode)    │  ← 底层发送                   │
│  │                                          │                                │
│  │ 职责：                                    │                                │
│  │ 1. JSON.parse 获取 type（日志用）         │                                │
│  │ 2. 大数字处理（标签相关 type）            │                                │
│  │ 3. Buffer.from(message) 转 UTF-8 字节    │                                │
│  │ 4. Clibrary.IpcClientSendMessage()       │                                │
│  │    → DLL → Named Pipe → 逆向             │                                │
│  │                                          │                                │
│  │ 日志：                                    │                                │
│  │ "[发送逆向type]=xxx"                      │                                │
│  │ "[发送消息给逆向] wxid: type= message:"   │                                │
│  └──────────────────────────────────────────┘                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 任务状态缓存（三段式机制）

`dispatchInBound` 在发送任务前，会为**需要跟踪回执**的任务创建状态缓存：

```javascript
GalaxyTaskCache.GALAXY_TASK_STATUS_MAP[taskId] = {
    firstMessageStatus:  'NOT_RECEIVE',    // 第一阶段回执状态
    secondMessageStatus: 'NOT_RECEIVE',    // 第二阶段回执状态
    thirdMessageStatus:  'NOT_RECEIVE',    // 第三阶段回执状态
    username: wxId,
    taskId: taskId,
    createTime: Date.now()
};
```

这个缓存用于后续回收链路中，匹配逆向返回的回执消息。

---

## 5. 回收链路：逆向 → galaxy-client

### 5.1 回收链路全景图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      消息回收完整链路                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────────────────────────┐                               │
│  │ asyncSelectTask.loop(wrapper) - 无限循环  │  ← IPC 轮询                  │
│  │                                          │                                │
│  │ while (true):                            │                                │
│  │   selectCode = IpcSelectCltChannel()     │                                │
│  │   ├── =0: sleep(200ms) → 继续 loop      │                                │
│  │   ├── <0: closeIpcConnect() → 退出      │                                │
│  │   └── >0: successIpcConnect() → 处理    │                                │
│  └──────────────────┬───────────────────────┘                               │
│                     │ selectCode > 0                                         │
│                     ▼                                                        │
│  ┌──────────────────────────────────────────┐                               │
│  │ successIpcConnect(pipe, code, time, wrap) │  ← 读取消息                  │
│  │                                          │                                │
│  │ 职责：                                    │                                │
│  │ 1. IpcClientRecvMessage(pipe, code, wxid)│                                │
│  │    → DLL 读取管道数据                     │                                │
│  │    → Buffer → UTF-8 字符串               │                                │
│  │    → 去除 \x00 空字符                     │                                │
│  │ 2. replaceLargeNumbers(message)          │                                │
│  │    → 处理 JS 大数字精度问题               │                                │
│  │ 3. dispatchOutBound(message, wrapper)    │                                │
│  │                                          │                                │
│  │ 日志：                                    │                                │
│  │ "接收到IPC消息:{...}"                     │                                │
│  │ "[接收逆向推送消息] messageType-xxx"       │                                │
│  └──────────────────┬───────────────────────┘                               │
│                     │                                                        │
│                     ▼                                                        │
│  ┌──────────────────────────────────────────┐                               │
│  │ dispatchOutBound(message, wrapper)       │  ← 出站调度                   │
│  │                                          │                                │
│  │ 职责：                                    │                                │
│  │ 1. JSON.parse(message)                   │                                │
│  │ 2. 过滤 pong（心跳）消息                  │                                │
│  │ 3. 处理 bugreport/error 类型上报          │                                │
│  │ 4. 更新 Galaxy 版本号缓存                 │                                │
│  │ 5. 根据 wrapper.workWx 路由：            │                                │
│  │    ├── true  → WkMsgHandlerCenter        │                                │
│  │    └── false → WxMsgHandlerCenter        │                                │
│  │ 6. 失败的第三阶段任务延迟处理              │                                │
│  │                                          │                                │
│  │ 日志：                                    │                                │
│  │ "[DispatchCenter]:接收逆向type=xxx"       │                                │
│  └──────────────┬──────────┬────────────────┘                               │
│                 │          │                                                  │
│        微信 ────┘          └──── 企微                                        │
│                 │          │                                                  │
│                 ▼          ▼                                                  │
│  ┌──────────────────────────────────────────┐                               │
│  │ msgHandleBase.outBoundMsg()              │  ← 消息处理核心               │
│  │                                          │                                │
│  │ 三步处理：                                │                                │
│  │ 1. messageHandler()                      │                                │
│  │    → 三段式消息匹配（第一/二/三条回执）    │                                │
│  │    → 识别消息类型、关联 taskId             │                                │
│  │                                          │                                │
│  │ 2. responseMsgHandler()                  │                                │
│  │    → 好友列表/群列表等特殊消息处理         │                                │
│  │    → wxUserListResponseMsgHandler        │                                │
│  │                                          │                                │
│  │ 3. send() → businessHandler()            │                                │
│  │    → 根据 flowSource 路由到对应出口       │                                │
│  └──────────────────┬───────────────────────┘                               │
│                     │                                                        │
│                     ▼                                                        │
│  ┌──────────────────────────────────────────┐                               │
│  │ businessHandler(jsonObject, msg, wrapper) │  ← 来源路由                  │
│  │                                          │                                │
│  │ 路由规则：                                │                                │
│  │ ├── flowSource=2 → cloudFlowOutBound     │                                │
│  │ │                  → Service 处理         │                                │
│  │ │                  → MQTT 上报云端        │                                │
│  │ │                                        │                                │
│  │ ├── flowSource=1 → frontFlowOutBound     │                                │
│  │ │                  → WebSocket 发给前端   │                                │
│  │ │                                        │                                │
│  │ ├── flowSource=无 → outBoundByBroadcast  │                                │
│  │ │                  → 广播到所有处理器     │                                │
│  │ │                  （逆向主动推送的消息）   │                                │
│  │ │                                        │                                │
│  │ └── 特殊类型:                             │                                │
│  │     userlist/quicksend → 直接走云端       │                                │
│  └──────────────────────────────────────────┘                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 cloudFlowOutBound 服务列表遍历

逆向返回的消息通过 `cloudFlowOutBound` 进入服务层时，会**遍历服务列表**，每个 Service 通过 `filter()` 判断是否处理该消息：

```
cloudFlowOutBound(message, wrapper)
         │
         ▼
    解析 JSON，获取 type
         │
         ▼
    遍历 ConvertServiceList（70+ 个服务）
    for (service of list) {
        if (service.filter(jsonObj)) {   // 每个 Service 自行判断
            service.operate(msg, wrapper); // 匹配则处理
        }
    }
```

**微信 Service 列表（部分示例）**：

| Service | filter 匹配条件 | 处理内容 |
|---------|-----------------|----------|
| `AnnouncementResponse` | type=roomannouncement 或 SetChatRoomAnnouncementResponse | 群公告响应 |
| `SendTextMsgResponse` | type=MM.SendMsgResponseNew | 文本消息发送回执 |
| `FriendsListResponceService` | type=userinfolist | 好友列表数据 |
| `LoginService` | type=login | 登录状态处理 |
| `RecvMsgService` | type=recvmsg | 接收消息处理 |
| `KickOutTaskResponse` | typeExt=kickout | 踢人回执 |

> 注意：服务列表遍历没有 break，同一消息可能被多个 Service 处理。

### 5.3 三段式消息处理

对于任务回执类消息（如发消息、改群名等），系统使用**三段式处理机制**来跟踪任务完成状态：

```
任务下发后，逆向会返回最多三次回执：

第一条回执：逆向确认收到任务
  → messageHandler() 中 isFirstMsg() 匹配
  → 更新 firstMessageStatus = RECEIVED

第二条回执：逆向开始执行
  → messageHandler() 中 isSecondMsg() 匹配
  → 更新 secondMessageStatus = RECEIVED

第三条回执：执行结果（成功/失败）
  → messageHandler() 中 isThirdMsg() 匹配
  → 更新 thirdMessageStatus = RECEIVED
  → 触发结果上报
```

---

## 6. 消息路由机制

### 6.1 路由总览

```
逆向返回的消息
       │
       ▼
  dispatchOutBound
       │
       ├── wrapper.workWx === true  → WkMsgHandlerCenter（企微）
       │
       └── wrapper.workWx === false → WxMsgHandlerCenter（微信）
                                            │
                                            ▼
                                      outBoundMsg()
                                            │
                                       messageHandler()
                                       (三段式匹配)
                                            │
                                       responseMsgHandler()
                                       (好友/群列表特殊处理)
                                            │
                                       send() → businessHandler()
                                            │
                              ┌─────────────┼─────────────┐
                              │             │             │
                         flowSource=2  flowSource=1    无source
                              │             │             │
                              ▼             ▼             ▼
                     cloudFlowOutBound  frontFlow    outBoundBy
                              │         OutBound     Broadcast
                              │             │             │
                     遍历 Service 列表  发送到前端   广播到所有
                     filter() + operate()            处理器
```

### 6.2 FLOW_HANDLER_MAP

消息出口的路由映射定义在 `msgHandleBase.js` 中：

```javascript
const FLOW_HANDLER_MAP = {
    '1': frontFlowOutBound,   // flowSource=1 → 发给前端
    '2': cloudFlowOutBound,   // flowSource=2 → 发给云端 Service 处理
};
```

### 6.3 逆向主动推送的消息

有些消息不是任务回执，而是逆向**主动推送**的（如收到新消息、好友变动等），这些消息没有 `flowSource` 字段，会通过 `outBoundByBroadcast` 广播到所有处理器（前端 + 云端）。

---

## 7. 完整代码文件索引

### 7.1 IPC 通信层

| 文件 | 职责 | 关键方法 |
|------|------|----------|
| `src/msg-center/start/reverseStart.js` | IPC 服务启动入口 | `run()` |
| `src/msg-center/core/reverse/initIpcTask.js` | IPC 连接生命周期管理 | `run()` 扫描进程建立连接 |
| `src/msg-center/core/reverse/asyncSelectTask.js` | IPC 消息接收循环 | `loop()` 轮询、`successIpcConnect()` 读取 |
| `src/msg-center/core/reverse/dll/clibrary.js` | FFI 桥接层，Node.js ↔ DLL | 所有 IPC 函数封装 |
| `src/msg-center/core/registry-config/index.js` | 连接注册表管理 | `add()` `remove()` `getRegistryByKey()` |
| `src/msg-center/core/registry-config/registryList.js` | 注册表数据存储 | 全局连接列表 |

### 7.2 下发链路（galaxy-client → 逆向）

| 文件 | 职责 | 关键方法 |
|------|------|----------|
| `src/msg-center/dispatch-center/dispatch/cloudFlowInBound.js` | 云端入站，添加 flowSource=2 | `cloudFlowInBound()` |
| `src/msg-center/dispatch-center/dispatchInBound.js` | 入站调度、任务状态缓存 | `dispatchInBound()` `processInBoundTask()` |
| `src/msg-center/dispatch-center/reverseSend.js` | IPC 发送封装（单例） | `sendMessage()` `pipeLineSend()` |

### 7.3 回收链路（逆向 → galaxy-client）

| 文件 | 职责 | 关键方法 |
|------|------|----------|
| `src/msg-center/dispatch-center/dispatchOutBound.js` | 出站调度、按微信类型路由 | `dispatchOutBound()` |
| `src/msg-center/dispatch-center/handle/msgHandleBase.js` | 消息处理核心（三段式+路由） | `outBoundMsg()` `messageHandler()` `businessHandler()` |
| `src/msg-center/dispatch-center/handle/wxMsgHandle.js` | 微信消息处理中心 | 继承 msgHandleBase |
| `src/msg-center/dispatch-center/handle/workWxMsgHandle.js` | 企微消息处理中心 | 继承 msgHandleBase |
| `src/msg-center/dispatch-center/dispatch/cloudFlowOutBound.js` | 云端出站，遍历 Service 列表处理 | `cloudFlowOutBound()` |
| `src/msg-center/dispatch-center/dispatch/frontFlowOutBound.js` | 前端出站，发送到前端 WebSocket | `frontFlowOutBound()` |

### 7.4 数据配置

| 文件 | 内容 |
|------|------|
| `src/msg-center/core/data-config/flowSourceEnum.js` | 消息来源枚举：FRONT=1, CLOUND=2, OWNER=3 |
| `src/msg-center/core/data-config/galaxyTaskType.js` | 发送给逆向的任务类型 |
| `src/msg-center/core/data-config/galaxyCallBackType.js` | 逆向返回的回调类型 |
| `src/msg-center/core/data-config/taskCallback.js` | 微信任务回调配置（三段式） |
| `src/msg-center/core/data-config/wkTaskCallback.js` | 企微任务回调配置 |
| `src/msg-center/core/data-config/callbackClassify.js` | 回调分类（第一/二/三阶段） |
| `src/msg-center/core/cache/galaxyTaskCache.js` | 任务状态缓存 |

---

## 8. 关键日志速查

### 8.1 连接阶段

| 日志关键字 | 来源 | 说明 |
|-----------|------|------|
| `启动ipc连接` | reverseStart.js | IPC 服务启动 |
| `[initIpcTask] 建立ipc连接成功` | initIpcTask.js | 连接建立成功 |
| `[initIpcTask] 删除ipc连接` | initIpcTask.js | 进程退出，清理连接 |
| `[initIpcTask] 将要退出进程id为空` | initIpcTask.js | 没有检测到目标进程 |

### 8.2 下发阶段

| 日志关键字 | 来源 | 说明 |
|-----------|------|------|
| `[CloudFlowHandler]:inBound` | cloudFlowInBound.js | 云端入站处理 |
| `[dispatchInBound] 开始执行` | dispatchInBound.js | 调度器执行 |
| `[DispatchCenter]:下任务时往缓存里放任务` | dispatchInBound.js | 任务状态缓存 |
| `ReverseSendService message:` | reverseSend.js | 准备发送 |
| `[发送逆向type]=xxx` | clibrary.js | DLL 发送（记录 type） |
| `[发送消息给逆向] wxid: type= message:` | clibrary.js | DLL 发送（记录完整消息） |
| `taskId已经存在 已经被锁` | reverseSend.js | 重复任务被拦截 |
| `[发送给逆向时参数错误]` | reverseSend.js | 参数缺失 |
| `IPC尚未连接成功` | reverseSend.js | 逆向未注册 |
| `尚未和逆向建立注册信息` | dispatchInBound.js | registry 不存在 |

### 8.3 回收阶段

| 日志关键字 | 来源 | 说明 |
|-----------|------|------|
| `接收到IPC消息:{...}` | asyncSelectTask.js | IPC 收到消息 |
| `[接收逆向推送消息] messageType-xxx` | clibrary.js | 消息类型记录 |
| `[DispatchCenter]:接收逆向type=xxx` | dispatchOutBound.js | 出站调度 |
| `[DispatchCenter] [msgHandleBase]: outBoundMsg sendType=` | msgHandleBase.js | 消息处理入口 |
| `[CloudFlowHandler]:outBound执行convert-service:` | cloudFlowOutBound.js | 进入 Service 遍历 |
| `[DispatchCenter] [msgHandleBase] businessHandler-逆向消息处理,source=` | msgHandleBase.js | flowSource 路由 |
| `[DispatchCenter] [msgHandleBase] outBoundByBroadcast` | msgHandleBase.js | 无 source，广播处理 |

### 8.4 错误日志

| 日志关键字 | 来源 | 说明 |
|-----------|------|------|
| `sendMsgToReverseError` | reverseSend.js | IPC 发送失败 |
| `IpcClientSendMessageError` | clibrary.js | DLL 发送异常 |
| `IpcClientRecvMessageError` | clibrary.js | DLL 接收异常 |
| `dispatchInBoundError` | dispatchInBound.js | 入站调度异常 |
| `dispatchOutBoundError` | dispatchOutBound.js | 出站调度异常 |
| `outBoundMsgError` | msgHandleBase.js | 消息处理异常 |
| `galaxyTaskLockError` | dispatchInBound.js | 任务锁异常 |
| `initIpcTaskError` | initIpcTask.js | 连接管理异常 |
| `[逆向消息处理错误]` | asyncSelectTask.js | 消息接收处理异常 |

---

## 9. 常见问题

### 9.1 为什么下发和回收是解耦的？

下发通过 `dispatchInBound → reverseSend` 直接发送，回收通过 `asyncSelectTask.loop()` 独立轮询。两者通过 `taskId` 和 `type` 关联。这种设计的原因：

1. **IPC 管道是双向的**：同一个 Named Pipe 支持双向通信
2. **异步解耦**：发送后不阻塞等待，通过回调/缓存匹配结果
3. **逆向可能主动推送**：不是所有消息都是任务回执，逆向会主动推送收到的微信消息

### 9.2 消息如何关联？

- **任务回执**：通过 `taskId` 关联。下发时携带 taskId，逆向返回时原样带回
- **消息类型**：通过 `type` 关联。发送 type=roomannouncement，逆向返回同样的 type
- **三段式**：通过 `GalaxyTaskCache` 中缓存的任务状态，按 type 匹配第一/二/三条回执

### 9.3 一个微信进程对应一个 IPC 连接？

是的。每个微信/企微进程有一个独立的 Named Pipe，对应一个 `pipeCode`、一个 `pipeLineWrapper`、一个 `registry`、一个独立的 `loop()` 循环。

### 9.4 逆向断开后怎么处理？

1. `asyncSelectTask.loop()` 中 `selectCode < 0` 时触发 `closeIpcConnect()`
2. `initIpcTask.run()` 每 5 秒扫描进程，发现进程不存在时触发 `batchCheckAndExit()`
3. 两者都会调用 `RegistryConfig.remove()` 清理连接和资源

---

## 相关文档

- [15-IPC通信机制建立流程.md](./15-IPC通信机制建立流程.md) - IPC 连接建立的详细流程
- [16-IPC消息处理链路详解.md](./16-IPC消息处理链路详解.md) - IPC 消息处理链路
- [17-IPC架构总览.md](./17-IPC架构总览.md) - IPC 架构总览
- [06-任务回执机制.md](./06-任务回执机制.md) - 三段式回执机制详解
- [01-消息发送业务.md](./01-消息发送业务.md) - 消息发送完整流程
- [14-ModContactRemarkResponse消息处理链路分析.md](./14-ModContactRemarkResponse消息处理链路分析.md) - 回收链路的具体案例
