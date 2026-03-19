# WebSocket 通信机制详解

> 本文档详细分析 galaxy-client 项目中 WebSocket 通信机制的设计、运行流程、消息协议、涉及场景和调试方法。

---

## 一、WebSocket 在项目中的角色

### 1.1 为什么需要 WebSocket

在 galaxy-client 的架构中，前端 UI 并非由 Electron 渲染进程的本地代码直接渲染，而是通过加载远程 Web 应用（通宝系统，URL 如 `https://tongbao.umeng100.com/web5`）来实现。这种设计使得前端可以独立开发和部署，不需要每次修改 UI 都更新 Electron 客户端。

然而，远程 Web 应用面临一个关键挑战：**它无法直接使用 Electron 的 IPC 机制来与主进程通信**。虽然主窗口的预加载脚本注入了 `window.require`，但业务层面的通信需要一个更结构化、更灵活的通道。

因此，galaxy-client 在主进程中启动了一个 WebSocket 服务器，远程 Web 应用通过标准的浏览器 WebSocket API 连接到这个服务器。这样，前端 Web 应用就可以：
- 向主进程发送业务指令（如转发消息、上传文件、获取配置）
- 接收主进程推送的业务数据（如微信消息、登录状态、好友列表变更）

### 1.2 WebSocket 的定位

在五大通信机制中，WebSocket 是**主进程与前端 Web 应用之间的核心业务通道**：

```
                    Electron IPC
前端 UI ◄──────────────────────────► 主进程 (系统级交互)
                    
                    WebSocket
前端 UI ◄══════════════════════════► 主进程 (业务数据交互)
```

Electron IPC 处理系统级交互（文件操作、窗口控制等），WebSocket 处理业务级交互（消息收发、任务管理等）。两者互补，共同构成前端与主进程之间的完整通信层。

### 1.3 技术选型

| 项目 | 选择 | 说明 |
|------|------|------|
| 服务端库 | `ws` (^8.13.0) | Node.js 最流行的 WebSocket 库，轻量高效 |
| 客户端 | 浏览器原生 WebSocket API | 无需额外依赖 |
| 协议 | ws:// (非 wss://) | 本地通信，无需 TLS |
| 数据格式 | JSON 字符串 | 统一的结构化数据交换格式 |

---

## 二、WebSocket 服务端实现

### 2.1 服务端架构

WebSocket 服务端的实现分布在以下文件中：

| 文件 | 职责 |
|------|------|
| `msg-center/core/websocket/index.js` | WebSocket 服务器核心：启动、监听、端口管理 |
| `msg-center/core/front/frontServer.js` | 服务启动入口、连接事件处理、消息分发 |
| `msg-center/core/data-config/frontConnection.js` | 全局连接状态管理 |
| `msg-center/core/front/sendToFrontUtil.js` | 向前端发送消息的工具类 |
| `msg-center/core/front/wsPushTest.js` | 测试辅助模块 |
| `msg-center/start/frontStart.js` | 服务启动调度 |

### 2.2 启动流程

WebSocket 服务在 `AppStart.run()` 中由 `FrontStart.run()` 启动，这是所有业务模块启动的第一步。

**启动序列**：

```
AppStart.run()
    │
    ├─ 步骤 1: FrontStart.run()
    │    │
    │    └─ FrontServer.start()
    │         │
    │         ├─ wsServer.startServer()
    │         │    │
    │         │    ├─ 尝试端口 13323
    │         │    │    └─ 成功 → 记录端口到 global.port
    │         │    │    └─ 失败（端口被占用）→ 尝试 13324
    │         │    │         └─ 失败 → 尝试 13325
    │         │    │              └─ ... 直到 13423
    │         │    │
    │         │    └─ new WebSocket.Server({
    │         │         host: '0.0.0.0',
    │         │         port: 当前尝试的端口
    │         │       })
    │         │
    │         └─ 注册 connection 事件处理
    │
    ├─ 步骤 2: ReverseStart.run()
    │    └─ ...
    └─ ...
```

### 2.3 端口管理

**端口范围**：13323 ~ 13423（共 101 个候选端口）

**端口选择策略**：从 13323 开始逐个尝试，遇到端口被占用（EADDRINUSE）则尝试下一个，直到找到可用端口或超出范围。

**端口存储**：成功监听后，端口号保存到 `global.port`。渲染进程可以通过 Electron IPC 的 `get-ws-port` 通道获取这个端口。

**监听地址**：`0.0.0.0`（所有网络接口）。虽然 WebSocket 只用于本地通信，但监听 `0.0.0.0` 而非 `127.0.0.1` 可以使得同网络的其他设备也能连接（用于调试场景）。

### 2.4 连接管理

WebSocket 服务器维护的连接信息存储在全局对象 `frontConnection` 中：

```
frontConnection = {
    login: false,      // 前端是否已发送 online 消息
    channel: null       // 当前活跃的 WebSocket 连接实例
}
```

**重要设计特点**：`frontConnection.channel` 只保存最后一个连接。这意味着系统只支持**单个前端连接**。如果有新连接接入，旧连接的引用会被覆盖。

**连接生命周期**：

```
前端 WebSocket 连接到服务器
    │
    ├─ 服务器发送欢迎消息
    │
    ├─ 前端发送 { cmdId: 'system', body: 'online' }
    │    │
    │    └─ 服务器处理：
    │         frontConnection.channel = connection
    │         frontConnection.login = true
    │
    ├─ 正常通信阶段
    │    ├─ 前端 → 服务器：业务请求
    │    └─ 服务器 → 前端：业务推送
    │
    └─ 连接关闭
         │
         ├─ 前端发送 { cmdId: 'system', body: 'offline' }
         │    └─ 服务器处理：
         │         frontConnection.channel = null
         │         frontConnection.login = false
         │
         └─ connection.on('close')
              └─ frontConnection.channel = null
```

---

## 三、WebSocket 消息协议

### 3.1 消息格式

所有 WebSocket 消息都使用 JSON 字符串格式。请求和响应有统一的结构：

**请求格式（WsRequest）**：

```
{
    "cmdId": "forward",          // 命令标识，决定消息路由
    "channelId": "channel_xxx",  // 通道 ID，标识目标微信/企微账号
    "wxid": "wxid_xxx",          // 微信 ID
    "body": "..."                // 业务数据（JSON 字符串或普通字符串）
}
```

**响应格式（WsResponse）**：

```
{
    "cmdId": "forward",          // 命令标识
    "channelId": "channel_xxx",  // 通道 ID
    "wxid": "wxid_xxx",          // 微信 ID
    "body": "..."                // 业务响应数据
}
```

### 3.2 cmdId 命令清单

| cmdId | 常量名 | 方向 | 功能描述 |
|-------|--------|------|---------|
| `system` | — | 前端→主进程 | 系统控制（online/offline） |
| `forward` | FORWARD | 前端→主进程 | 转发指令到逆向（核心业务通道） |
| `upload` | UPLOAD | 前端→主进程 | 上传文件到 OSS |
| `getAllConfig` | GET_ALL_CONFIG | 前端→主进程 | 获取所有逆向配置 |
| `frontLogin` | FRONT_LOGIN | 前端→主进程 | 前端登录 |
| `frontLogout` | FRONT_LOGOUT | 前端→主进程 | 前端登出 |
| `getMqttStatus` | GET_MQTT_STATUS | 前端→主进程 | 获取 MQTT 连接状态 |
| `killAll` | KILL_ALL | 前端→主进程 | 停止所有进程 |
| `killJava` | KILL_JAVA | 前端→主进程 | 停止 Java 进程 |
| `uploadMetric` | UPLOAD_METRIC | 前端→主进程 | 上报指标 |
| `reportLogicWorking` | REPORT_LOGIC_WORKING | 前端→主进程 | 上报机器人工作状态 |
| `uploadVoice` | UPLOAD_VOICE | 前端→主进程 | 上传语音消息 |
| `webtest` | — | 前端→主进程 | 测试通道 |

### 3.3 system 命令详解

`system` 命令用于连接生命周期管理：

**online 消息**：

```
{
    "cmdId": "system",
    "body": "online"
}
```

前端在 WebSocket 连接建立后立即发送此消息，表示"我已准备好接收业务数据"。主进程收到后将当前连接设为活跃连接（`frontConnection.channel = connection`），并标记前端为已登录状态。

**offline 消息**：

```
{
    "cmdId": "system",
    "body": "offline"
}
```

前端在页面卸载或主动断开时发送，通知主进程清空连接引用。但实际上，当 WebSocket 连接已断开时，这条消息往往无法成功发送——这是一个已知的逻辑缺陷。

### 3.4 forward 命令详解

`forward` 是最核心的命令，承载了所有微信/企微的业务指令。

**请求示例 — 发送文本消息**：

```
{
    "cmdId": "forward",
    "channelId": "channel_001",
    "wxid": "wxid_abc123",
    "body": "{
        \"type\": \"SEND_MESSAGE\",
        \"data\": {
            \"type\": 1,
            \"content\": \"你好\",
            \"to\": \"wxid_target\"
        },
        \"taskId\": \"task_001\",
        \"flowSource\": 1
    }"
}
```

**请求示例 — 置顶窗口**：

```
{
    "cmdId": "forward",
    "body": "windowtop",
    "channelId": "channel_001"
}
```

**请求示例 — 触发登录**：

```
{
    "cmdId": "forward",
    "body": "login",
    "channelId": "channel_001"
}
```

**响应示例 — 消息接收推送**：

```
{
    "cmdId": "forward",
    "channelId": "channel_001",
    "wxid": "wxid_abc123",
    "body": "{
        \"type\": \"recvmsg\",
        \"data\": {
            \"from\": \"wxid_sender\",
            \"content\": \"收到一条新消息\",
            \"msgType\": 1,
            \"createTime\": 1710000000
        }
    }"
}
```

### 3.5 消息过滤机制

并非所有逆向返回的消息都需要推送给前端。`sendFrontWsType.js` 定义了 `NOT_SEND_MSG_TYPE` 集合，包含约 30 种不需要发送给前端的消息类型：

| 过滤类型 | 说明 |
|---------|------|
| `recvmsg` | 原始接收消息（已有处理后的版本） |
| `pong` | 心跳响应 |
| `SendMsgResponseNew` | 发送消息的原始响应 |
| `OplogResponse` | 操作日志响应 |
| `cdnonsucceed` | CDN 上传成功回调 |
| `GetUserInfoWithCheckRsp` | 用户信息查询响应 |
| ... | 其他约 25 种内部处理类型 |

此外，`sendToFrontUtil.js` 中还有 `FILTER_SET`，包含 `PONG`、`CDNONERROR` 等额外过滤类型。

过滤逻辑确保前端只收到它需要的业务数据，减少了 WebSocket 的传输负担和前端的处理压力。

---

## 四、消息流转详解

### 4.1 前端 → 主进程（入站流）

**完整流转路径**：

```
步骤 1: 前端发送 WebSocket 消息
    前端 JavaScript
    ws.send(JSON.stringify({
        cmdId: 'forward',
        channelId: 'ch_001',
        wxid: 'wxid_abc',
        body: '{"type":"SEND_MESSAGE",...}'
    }))

步骤 2: frontServer 接收
    connection.on('message', message => { ... })
    解析 JSON

步骤 3: 系统消息判断
    if (cmdId === 'system') {
        // online → 设置 frontConnection
        // offline → 清空 frontConnection
        return
    }

步骤 4: 测试消息判断
    if (cmdId === 'webtest') {
        wsPushTest.onMessage(message)
        return
    }

步骤 5: 业务消息路由
    frontFlowInBound(message)

步骤 6: 命令分发
    frontFlowInBound 内部：
    AsyncLock 加锁
    解析 message → request.cmdId
    frontTask = frontHandlerMap[cmdId]
    frontTask({request, message})

步骤 7: 任务执行
    以 forward 为例：
    forwardTask.execute({request, message})
        → 解析 body 为 ClientTaskBO
        → dispatchInBound(channelId, wxId, message)
        → reverseSend.sendMessage()
        → Clibrary.IpcClientSendMessage()
        → 通过 Named Pipe 发往微信
```

**frontHandlerMap 路由表**：

| cmdId | 处理模块 | 功能 |
|-------|---------|------|
| `GET_ALL_CONFIG` | getAllConfigTask | 触发向所有已登录微信号请求配置，将结果推送给前端 |
| `UPLOAD` | uploadTask | 上传文件到阿里云 OSS，返回 OSS URL |
| `FORWARD` | forwardTask | 核心转发任务——将前端指令转发到逆向（微信/企微） |
| `FRONT_LOGOUT` | frontLogoutTask | 前端登出处理 |
| `FRONT_LOGIN` | frontLoginTask | 前端登录处理（设置 frontConnection.login = true，3 秒防抖） |
| `GET_MQTT_STATUS` | getMqttConnectionStatusTask | 查询各微信号的 MQTT 连接状态，返回给前端 |
| `KILL_ALL` | killTask | 停止所有微信/企微/Java 进程，关闭 WebSocket 连接 |
| `KILL_JAVA` | killAppTask | 仅停止 Java 进程 |
| `REPORT_LOGIC_WORKING` | reportLogicWorkingTask | 上报机器人工作状态到云端 |

### 4.2 主进程 → 前端（出站流）

**完整流转路径**：

```
步骤 1: 逆向返回消息
    asyncSelectTask.loop()
    → IpcClientRecvMessage()
    → 得到微信返回的 JSON 消息

步骤 2: 出站调度
    dispatchOutBound(message, pipeLineWrapper)
    → WxMsgHandle.outBoundMsg() 或 WkMsgHandle.outBoundMsg()

步骤 3: 三段式消息处理
    messageHandler()
    → 匹配第一条/第二条/第三条消息
    → 组装完整业务结果

步骤 4: 业务处理器路由
    businessHandler()
    → 判断 flowSource
    → flowSource = 1 (FRONT) → frontFlowOutBound
    → flowSource = 2 (CLOUD) → cloudFlowOutBound
    → 无 flowSource → 同时发送前端和云端 (outBoundByBroadcast)

步骤 5: 前端出站处理
    frontFlowOutBound(message, pipeLineWrapper)
    → SendFrontAspect.beforeSendMessageToFront() // 前置切面
    → 过滤 RECVMSG 类型
    → sendToFront(message, channelId, wxid)

步骤 6: 构建响应
    sendToFront() 内部：
    → 检查 NOT_SEND_MSG_TYPE，过滤不需要的类型
    → 构建 WsResponse { cmdId, channelId, wxid, body }
    → SendToFrontUtil.sendResponse2Front(response)

步骤 7: 发送 WebSocket 消息
    SendToFrontUtil.sendResponse2Front() 内部：
    → 检查 frontConnection.channel 是否存在
    → 检查 FILTER_SET 二次过滤
    → frontConnection.channel.send(JSON.stringify(response))
    → 发送回调中处理错误（上报 SEND_FRONT_ERROR）
```

### 4.3 前置切面处理（SendFrontAspect）

在消息发送给前端之前，`SendFrontAspect` 会进行一些转换和增强：

**好友/群列表转换**（`beforeSendFriendList`）：
- 企业微信的好友列表和群列表格式与前端期望的格式不同
- 切面将企微格式转换为前端标准格式

**策略处理**（`beforeSendMessageToFront`）：
- 登录消息策略（`SendLoginMsgFrontStrategy`）：将逆向的登录信息转换为前端需要的格式 `{data: {headimg, sex, nickname, wxid}}`
- 备注变更策略（`SendRemarkMsgFrontStrategy`）：处理备注修改的消息格式
- 踢人策略（`sendKickOutMsgFrontStrategy`）：处理踢人结果的消息格式

---

## 五、前端客户端实现

### 5.1 连接建立

前端 WebSocket 客户端的实现位于通宝 Web 应用中。在项目的 `index.html` 中有一个参考实现：

**连接地址**：`ws://localhost:13323`

注意：`index.html` 中硬编码了端口 13323，但实际上端口可能在 13323-13423 范围内变化。生产环境中，前端应通过 Electron IPC 的 `get-ws-port` 通道动态获取端口。

**连接建立后的初始化**：
1. WebSocket 连接成功（open 事件触发）
2. 前端立即发送 `{ cmdId: 'system', body: 'online' }` 注册连接
3. 主进程将此连接设为活跃连接
4. 前端开始发送和接收业务消息

### 5.2 前端发送封装

前端提供了以下发送方法：

**通用发送**：
- `wsSend(msg)`：将消息对象 JSON 序列化后通过 WebSocket 发送

**置顶窗口**：
- `wsSendTop(channelId)`：发送 `{ cmdId: 'forward', body: 'windowtop', channelId }`
- 用于将指定微信账号的聊天窗口置顶

**触发登录**：
- `wsSendLogin(channelId)`：发送 `{ cmdId: 'forward', body: 'login', channelId }`
- 用于触发指定微信号的登录流程

**查询用户信息**：
- `queryUserInfo(channelId, wxId, workWx)`：发送用户信息查询请求

### 5.3 连接断开处理

当前实现中，WebSocket 连接断开时：
- `close` 事件中尝试发送 `{ cmdId: 'system', body: 'offline' }`
- 但此时连接已经关闭，`ws.send()` 实际上无法成功发送
- **没有自动重连逻辑**

这是一个已知的架构缺陷。在实际生产环境中，如果 WebSocket 连接断开（如页面刷新、网络波动），前端将失去与主进程的业务通信能力，直到页面重新加载建立新连接。

---

## 六、关键场景详解

### 6.1 场景一：前端发送微信文本消息

用户在前端 UI 中编辑一条文本消息并点击发送。

**完整流程**：

1. **前端构建请求**：
   - 组装 ClientTaskBO 对象，包含消息类型（SEND_MESSAGE）、内容、接收方等
   - 将 ClientTaskBO 序列化为 JSON 字符串作为 body
   - 构建 WsRequest：`{ cmdId: 'forward', channelId, wxid, body }`
   - 通过 WebSocket 发送

2. **主进程接收并路由**：
   - `frontFlowInBound` 解析 cmdId 为 `forward`
   - 路由到 `forwardTask`
   - `forwardTask` 解析 body，识别任务类型为 `SEND_MESSAGE`

3. **任务处理**：
   - `forwardTask` 提取 `SEND_TEXT` 子类型
   - 调用 `dispatchInBound(channelId, wxId, message)`
   - `dispatchInBound` 查找 Registry 获取 pipeCode
   - 通过 `reverseSend.sendMessage()` 发往微信

4. **微信执行并返回**：
   - 微信进程通过 Named Pipe 返回执行结果
   - 经过三段式消息匹配
   - 最终结果通过 `frontFlowOutBound` → `sendToFront` 推送给前端

5. **前端接收结果**：
   - WebSocket `onmessage` 事件触发
   - 解析响应，更新 UI（显示发送成功/失败）

### 6.2 场景二：微信消息实时推送

微信收到一条新消息时的处理流程。

**完整流程**：

1. **逆向接收**：微信进程通过 DLL 钩子捕获新消息，通过 Named Pipe 发送给 Electron

2. **消息进入出站调度**：
   - `asyncSelectTask` 轮询到新消息
   - `dispatchOutBound` 路由到 `WxMsgHandle`
   - 识别为 `recvmsg` 类型

3. **消息处理**：
   - `recvMsgService` 处理消息内容
   - 判断 `flowSource`——对于接收的消息，通常同时发给前端和云端

4. **推送给前端**：
   - `frontFlowOutBound` → `sendToFront`
   - 检查消息类型是否在 `NOT_SEND_MSG_TYPE` 中
   - 构建 WsResponse，通过 WebSocket 推送

5. **前端展示**：
   - 前端解析消息内容
   - 根据消息类型（文本、图片、视频等）选择不同的渲染方式
   - 更新聊天记录列表

### 6.3 场景三：获取所有账号配置

前端初始化时需要获取所有已登录微信号的配置信息。

**完整流程**：

1. 前端发送 `{ cmdId: 'getAllConfig' }`
2. `getAllConfigTask` 触发 `frontSendService.sendGetAllConfig()`
3. 遍历 Registry 中所有已登录的微信号
4. 对每个微信号，收集其配置信息（微信 ID、昵称、头像、在线状态、MQTT 状态等）
5. 将配置信息打包为 WsResponse，逐个推送给前端
6. 前端收到后更新侧边栏的账号列表

### 6.4 场景四：上传文件到 OSS

前端需要上传文件（如图片）到阿里云 OSS。

**完整流程**：

1. 前端发送 `{ cmdId: 'upload', body: { filePath, fileType, ... } }`
2. `uploadTask` 接收到请求
3. 读取本地文件
4. 调用阿里云 OSS SDK 上传文件
5. 获取 OSS URL
6. 通过 WebSocket 返回 `{ body: { ossUrl: '...' } }` 给前端
7. 前端使用 OSS URL 继续业务流程（如发送图片消息）

### 6.5 场景五：查询 MQTT 连接状态

运维人员需要检查各微信号的 MQTT 连接是否正常。

**完整流程**：

1. 前端发送 `{ cmdId: 'getMqttStatus' }`
2. `getMqttConnectionStatusTask` 遍历 Registry
3. 对每个微信号检查 `registry.mqttClient` 是否存在且连接正常
4. 构建状态列表 `[{ wxId, isOk: true/false }, ...]`
5. 通过 WebSocket 返回状态列表
6. 前端展示各微信号的 MQTT 连接状态

### 6.6 场景六：停止所有进程

用户需要停止所有微信/企微进程和 Java 辅助进程。

**完整流程**：

1. 前端发送 `{ cmdId: 'killAll' }`
2. `killTask` 执行：
   - 遍历 Registry，对每个微信号发送退出指令
   - 调用 `inject.stopJava()` 停止 Java 进程
   - 调用 `inject.stopWeChat()` 停止微信进程
   - 调用 `inject.stopWxwork()` 停止企微进程
   - 调用 `inject.stopBasicService()` 停止辅助进程
   - 关闭 WebSocket 连接：`frontConnection.channel?.close()`
   - 清空连接引用

---

## 七、WebSocket 与其他通信机制的协作

### 7.1 WebSocket ↔ Electron IPC

**端口获取**：前端通过 Electron IPC 的 `get-ws-port` 获取 WebSocket 端口，然后建立 WebSocket 连接。

**互补关系**：Electron IPC 处理系统级操作（文件、窗口），WebSocket 处理业务级操作（消息、任务）。部分场景两者都可实现，但按职责分工。

### 7.2 WebSocket ↔ 逆向 IPC

**入站方向**：前端通过 WebSocket 发送 `forward` 指令 → `forwardTask` → `dispatchInBound` → `reverseSend` → Named Pipe 发往微信

**出站方向**：微信通过 Named Pipe 返回 → `dispatchOutBound` → `frontFlowOutBound` → `sendToFront` → WebSocket 推送前端

WebSocket 和逆向 IPC 之间通过 dispatch-center 解耦，互不直接依赖。

### 7.3 WebSocket ↔ MQTT

**状态查询**：前端可以通过 WebSocket 查询 MQTT 连接状态（`getMqttStatus`）

**间接关系**：前端的某些操作（如发消息）最终会触发 MQTT 上报（通过 `cloudFlowOutBound` → `mqttSend`），但这个过程对前端是透明的。

### 7.4 WebSocket ↔ HTTP

**上传流程**：前端通过 WebSocket 发起文件上传请求 → 主进程通过 HTTP 上传到 OSS → 通过 WebSocket 返回 URL

**配置刷新**：定时任务通过 HTTP 获取云端配置 → 配置变更通过 WebSocket 推送前端

---

## 八、错误处理与容错

### 8.1 服务端错误处理

**端口被占用**：

启动时逐个尝试端口，最多尝试 101 次（13323-13423）。如果所有端口都被占用，WebSocket 服务将无法启动，业务通信完全瘫痪。这种情况在实际中极为罕见（需要同时有 101 个端口被占用）。

**消息发送失败**：

`frontConnection.channel.send()` 的回调函数中处理发送错误：
- 记录日志
- 上报 `SEND_FRONT_ERROR` 指标

**连接异常关闭**：

`connection.on('close')` 事件中清空 `frontConnection.channel`，避免后续尝试向已断开的连接发送消息。

### 8.2 客户端错误处理

当前实现中，前端 WebSocket 客户端的错误处理非常薄弱：
- 没有 `onerror` 事件处理
- 没有自动重连逻辑
- `close` 事件中的 offline 消息无法成功发送

### 8.3 已知问题

1. **单连接限制**：`frontConnection.channel` 只保存最后一个连接。如果多个标签页或窗口同时连接，只有最后一个能正常接收推送。

2. **无重连机制**：WebSocket 断开后，前端需要刷新页面才能重新建立连接。建议实现自动重连：
   - 检测到连接断开后，延迟 1-5 秒尝试重连
   - 使用指数退避策略避免频繁重连
   - 重连成功后重新发送 online 消息

3. **端口硬编码**：部分前端代码硬编码了 13323 端口，应统一使用 `get-ws-port` 动态获取。

4. **无心跳保活**：WebSocket 连接没有心跳机制。长时间没有数据传输时，某些网络设备可能会关闭空闲连接。建议实现 ping/pong 心跳。

---

## 九、测试机制

### 9.1 wsPushTest 测试模块

项目提供了一个测试辅助模块 `wsPushTest.js`，通过 `cmdId: 'webtest'` 触发：

**支持的测试操作**：

| 操作 | body | 功能 |
|------|------|------|
| 备注测试 | `remark` | 模拟备注修改消息，广播给所有 WebSocket 客户端 |
| 群更新测试 | `chatroomUpdate` | 模拟群成员变更消息，广播给所有客户端 |

**广播机制**：测试消息会发送给 `wsServer.server.clients`（所有连接的客户端），而非仅发送给 `frontConnection.channel`（单一活跃连接）。这说明 WebSocket 服务器底层支持多连接，只是业务层限制为单连接。

### 9.2 调试方法

**浏览器 DevTools**：
- 打开渲染进程的 DevTools（`Ctrl+Shift+I`）
- 切换到 Network 标签 → WS 子标签
- 可以看到所有 WebSocket 帧的内容和时间戳

**手动发送测试消息**：
- 在 DevTools Console 中：
  ```
  ws.send(JSON.stringify({ cmdId: 'webtest', body: 'remark' }))
  ```
  可以触发测试消息广播

**日志排查**：
- 主进程日志中搜索以下关键字：
  - `frontFlowInBound`：前端请求的入站处理
  - `sendToFront`、`sendResponse2Front`：推送到前端的消息
  - `SEND_FRONT_ERROR`：发送失败
  - `frontConnection`：连接状态变更

**端口确认**：
- 在终端执行 `netstat -ano | findstr 1332` 查看 WebSocket 服务占用的端口
- 或通过 Electron IPC `get-ws-port` 获取

---

## 十、性能考虑

### 10.1 消息吞吐量

WebSocket 主要的性能瓶颈在于消息量——当多个微信号同时在线，每个号都在接收消息时，WebSocket 可能需要高频推送大量数据给前端。

缓解措施：
- `NOT_SEND_MSG_TYPE` 过滤掉不必要的消息
- `FILTER_SET` 二次过滤
- `delaySendFrontmsgTimer` 合并群更新和好友更新消息，减少推送频率

### 10.2 消息大小

大部分 WebSocket 消息在几百字节到几十 KB 之间。最大的消息可能是好友列表（`USER_LIST`），包含所有好友的完整信息。

对于大消息，没有分片或压缩机制。如果好友数量非常多（如几千个），单条 WebSocket 消息可能达到几百 KB。

### 10.3 连接稳定性

WebSocket 连接的稳定性取决于：
- 主进程的运行稳定性
- 渲染进程的页面生命周期
- 操作系统的网络栈状态

由于是本地连接（localhost），网络波动的影响很小。主要风险来自页面刷新、主进程崩溃或系统休眠。

---

## 十一、总结

WebSocket 是 galaxy-client 中连接前端 UI 与核心业务逻辑的关键通道。它解决了远程 Web 应用无法直接使用 Electron IPC 的限制，提供了全双工的业务数据通信能力。

**核心特征**：
- 服务端在主进程中运行，端口范围 13323-13423
- JSON 格式的消息协议，以 cmdId 为路由依据
- 通过 dispatch-center 与逆向 IPC、MQTT 等通信机制解耦协作
- 单连接模型，只维护一个活跃前端连接
- 消息过滤机制减少不必要的数据传输

**改进空间**：
- 增加客户端自动重连逻辑
- 统一端口获取方式，消除硬编码
- 增加心跳保活机制
- 考虑多连接支持，提升可靠性

---

## 十二、WebSocket 消息完整流转矩阵

### 12.1 前端入站消息处理矩阵

以下矩阵展示每种 cmdId 消息从接收到最终处理的完整路径：

| cmdId | 解析 | 锁 | 处理模块 | 下游通信 | 响应方式 |
|-------|------|-----|---------|---------|---------|
| `system:online` | JSON | 无 | frontServer 直接处理 | 无 | 设置 frontConnection |
| `system:offline` | JSON | 无 | frontServer 直接处理 | 无 | 清空 frontConnection |
| `webtest` | JSON | 无 | wsPushTest | WebSocket 广播 | 广播到所有客户端 |
| `getAllConfig` | JSON | AsyncLock | getAllConfigTask | Named Pipe | WebSocket 推送配置 |
| `upload` | JSON | AsyncLock | uploadTask | HTTP(OSS) | WebSocket 返回 URL |
| `forward` | JSON | AsyncLock | forwardTask | Named Pipe | 异步 WebSocket 推送 |
| `frontLogin` | JSON | AsyncLock | frontLoginTask | 无 | 设置登录状态 |
| `frontLogout` | JSON | AsyncLock | frontLogoutTask | 无 | 清除状态 |
| `getMqttStatus` | JSON | AsyncLock | getMqttConnectionStatusTask | 无 | WebSocket 返回状态 |
| `killAll` | JSON | AsyncLock | killTask | Named Pipe + 进程管理 | 关闭所有连接 |
| `killJava` | JSON | AsyncLock | killAppTask | 进程管理 | 停止 Java |
| `reportLogicWorking` | JSON | AsyncLock | reportLogicWorkingTask | MQTT | 上报到云端 |

### 12.2 前端出站消息类型矩阵

以下矩阵展示主进程推送给前端的主要消息类型及其来源：

| 推送消息类型 | 触发来源 | 频率 | 数据量 | 延迟要求 |
|------------|---------|------|--------|---------|
| 登录状态 | 逆向 IPC → loginService | 低 | 小 | 中 |
| 登出通知 | 逆向 IPC → logoutService | 低 | 小 | 中 |
| 消息通知 | 逆向 IPC → recvMsgService | 高 | 中 | 高 |
| 好友列表更新 | 逆向 IPC → friendsListResponseService | 低 | 大 | 低 |
| 群更新通知 | 定时器 → delaySendFrontmsgTimer | 中 | 中 | 中 |
| 好友更新通知 | 定时器 → delaySendFrontmsgTimer | 中 | 中 | 中 |
| 发消息结果 | 逆向 IPC → 三段式匹配 | 高 | 小 | 高 |
| 备注变更 | 逆向 IPC → SendRemarkMsgFrontStrategy | 低 | 小 | 中 |
| 踢人结果 | 逆向 IPC → sendKickOutMsgFrontStrategy | 低 | 小 | 中 |
| 配置信息 | getAllConfig 触发 | 低 | 大 | 低 |
| MQTT 状态 | getMqttStatus 触发 | 低 | 小 | 低 |

### 12.3 消息延迟合并机制

为了避免高频推送导致前端渲染压力，某些消息类型采用延迟合并策略：

**群更新合并**：
- `delaySendFrontmsgTimer` 每 10 秒执行一次
- 收集这 10 秒内的所有群成员变更（加入、退出、信息修改）
- 合并为一条消息推送给前端
- 使用 `ChatroomUpdateVo` 封装：
  ```
  {
      chatroom: "xxx@chatroom",
      nickname: "群名",
      ownerwxid: "wxid_owner",
      newMemberArray: [...],
      leaveMemberArray: [...],
      type: "update"
  }
  ```

**好友更新合并**：
- 同样由 `delaySendFrontmsgTimer` 管理
- 收集好友信息变更
- 合并推送

这种设计在实时性和性能之间取得了平衡——10 秒的延迟对用户来说几乎无感知，但大大减少了 WebSocket 消息的发送频率。

---

## 十三、WebSocket 安全考虑

### 13.1 连接安全

当前 WebSocket 使用 `ws://`（非加密）协议，监听在 `0.0.0.0`（所有网络接口）。这意味着：

- 同一网络中的其他设备可以连接到这个 WebSocket 服务
- 连接无身份验证——任何知道端口号的程序都可以连接
- 数据传输为明文

### 13.2 风险评估

| 风险 | 影响 | 可能性 | 当前缓解 |
|------|------|--------|---------|
| 局域网窃听 | 业务数据泄露 | 低 | 无 |
| 恶意连接 | 发送伪造指令 | 中 | 无 |
| 端口扫描 | 发现服务存在 | 中 | 端口范围较大 |

### 13.3 安全建议

1. **监听地址**：将 `0.0.0.0` 改为 `127.0.0.1`，限制为本机连接
2. **连接鉴权**：在 `online` 消息中加入 token 验证
3. **消息签名**：对关键业务消息添加签名校验
4. **使用 wss://**：虽然是本地通信，但加密可以防止本机恶意程序窃听
