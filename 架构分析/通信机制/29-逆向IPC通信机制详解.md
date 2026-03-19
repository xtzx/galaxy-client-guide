# 逆向 IPC（Named Pipe）通信机制详解

> 本文档详细分析 galaxy-client 项目中逆向 IPC 通信机制的设计、DLL 调用、消息收发流程、涉及场景和调试方法。

---

## 一、逆向 IPC 在项目中的角色

### 1.1 什么是逆向 IPC

逆向 IPC 是 galaxy-client 项目中最核心、最底层的通信机制。它实现了 Electron 主进程与微信/企业微信进程之间的双向数据通信。

"逆向"指的是通过 DLL 注入技术将自定义代码注入到微信/企微进程中，从而在微信/企微内部建立通信管道。这种技术使得 galaxy-client 能够：
- 控制微信/企微执行各种操作（发消息、加好友、改备注等）
- 接收微信/企微的实时事件（收到消息、好友申请、群成员变更等）
- 获取微信/企微的内部数据（好友列表、群信息等）

### 1.2 技术栈

| 组件 | 技术 | 说明 |
|------|------|------|
| 通信方式 | Windows Named Pipe | 操作系统级进程间通信 |
| DLL 调用 | ffi-napi + ref-napi | Node.js 调用 C/C++ DLL 的 FFI 库 |
| 核心 DLL | PipeCore.dll | 封装了 Named Pipe 操作的 C 动态链接库 |
| 注入工具 | BasicService.exe | 将 DLL 注入到微信/企微进程 |
| 数据格式 | JSON 字符串 | 所有通信数据为 JSON |

### 1.3 逆向 IPC 在架构中的位置

```
┌──────────────────────────────────────────────────────────────┐
│                      Electron 主进程                          │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ msg-center/core/reverse/                             │    │
│  │                                                      │    │
│  │  ┌───────────────┐  ┌──────────────────────────┐     │    │
│  │  │ initIpcTask   │  │ asyncSelectTask          │     │    │
│  │  │ (连接建立)    │  │ (消息轮询接收)           │     │    │
│  │  └───────┬───────┘  └────────────┬─────────────┘     │    │
│  │          │                       │                    │    │
│  │  ┌───────▼───────────────────────▼─────────────┐     │    │
│  │  │ dll/clibrary.js (FFI 封装)                  │     │    │
│  │  │                                             │     │    │
│  │  │  IpcConnectServer()   → 建立管道连接          │     │    │
│  │  │  IpcSelectCltChannel() → 检查是否有新数据    │     │    │
│  │  │  IpcClientRecvMessage() → 接收消息           │     │    │
│  │  │  IpcClientSendMessage() → 发送消息           │     │    │
│  │  │  IpcClientClose()      → 关闭管道            │     │    │
│  │  └─────────────────────┬───────────────────────┘     │    │
│  │                        │ FFI 调用                     │    │
│  └────────────────────────┼─────────────────────────────┘    │
│                           │                                  │
│                           ▼                                  │
│                    ┌──────────────┐                           │
│                    │ PipeCore.dll │                           │
│                    └──────┬───────┘                           │
│                           │ Windows Named Pipe                │
└───────────────────────────┼──────────────────────────────────┘
                            │
                  \\.\pipe\{518861DF-35A2-4D98-B523-F0254EABDAE2}-{pid}
                            │
               ┌────────────▼────────────────┐
               │  微信 / 企微进程              │
               │  (已注入 DLL)                │
               │                              │
               │  通过注入的 DLL 响应管道命令   │
               │  返回执行结果和实时事件        │
               └──────────────────────────────┘
```

---

## 二、Named Pipe 基础

### 2.1 什么是 Named Pipe

Windows Named Pipe（命名管道）是 Windows 操作系统提供的进程间通信（IPC）机制。它允许两个进程通过一个命名的"管道"交换数据，类似于 Unix 的 socket，但更加轻量。

**管道名称格式**：

```
\\.\pipe\{518861DF-35A2-4D98-B523-F0254EABDAE2}-{pid}
```

其中：
- `\\.\pipe\` 是 Windows Named Pipe 的标准前缀
- `{518861DF-35A2-4D98-B523-F0254EABDAE2}` 是固定的 GUID，标识 galaxy-client 项目
- `{pid}` 是目标微信/企微进程的进程 ID（PID）

每个微信/企微进程对应一个独立的管道，通过 PID 区分。

### 2.2 Named Pipe vs 其他 IPC 机制

| 特性 | Named Pipe | TCP Socket | Shared Memory |
|------|-----------|------------|---------------|
| 适用范围 | 本机进程间 | 本机或网络 | 本机进程间 |
| 性能 | 高 | 中 | 极高 |
| 安全性 | 高（ACL 控制） | 中 | 低 |
| 编程复杂度 | 低 | 中 | 高 |
| 数据格式 | 字节流/消息 | 字节流 | 自定义 |
| Windows 特色 | 原生支持 | 通用 | 通用 |

选择 Named Pipe 的原因：
1. 安全性——可以通过 ACL 限制访问权限
2. 性能——比 TCP Socket 开销更小
3. 简洁——Windows 原生支持，API 简单
4. 可靠——操作系统保证数据完整性

---

## 三、DLL 接口与 FFI 封装

### 3.1 PipeCore.dll 接口

PipeCore.dll 是一个 C/C++ 编写的动态链接库，封装了 Named Pipe 的操作。Electron 主进程通过 `ffi-napi` 库调用其导出函数。

**核心导出函数**：

| 函数名 | 参数 | 返回值 | 功能 |
|--------|------|--------|------|
| `IpcConnectServer` | `processId: int` | `pipeCode: int` | 连接到指定进程的管道。返回管道连接码（pipeCode），后续所有操作使用此连接码。 |
| `IpcSelectCltChannel` | `pipeCode: int` | `selectCode: int` | 检查管道是否有待读取的数据。返回值 >0 表示有数据（值为数据长度），=0 表示无数据，<0 表示连接已断开。 |
| `IpcClientRecvMessage` | `pipeCode: int, bufferLength: int, wxid: string` | `message: string` | 从管道读取一条消息。bufferLength 为之前 SelectCltChannel 返回的长度。 |
| `IpcClientSendMessage` | `pipeCode: int, message: string` | `result: int` | 向管道发送一条消息。message 为 JSON 字符串。 |
| `IpcClientClose` | `pipeCode: int` | `void` | 关闭管道连接。 |
| `GetSubProcPhysicalMmSize` | — | `memSize: long` | 获取子进程物理内存大小（用于监控）。 |

### 3.2 FFI 封装层

`dll/clibrary.js` 使用 `ffi-napi` 和 `ref-napi` 将 DLL 函数封装为 JavaScript 可调用的接口：

**封装架构**：

```
JavaScript 调用
    │
    ▼
clibrary.js (ffi-napi 封装)
    │  - 类型映射（int, string, Buffer）
    │  - 错误处理
    │  - 日志记录
    │
    ▼
PipeCore.dll (C/C++ 实现)
    │  - Named Pipe 操作
    │  - 消息序列化/反序列化
    │  - 进程通信管理
    │
    ▼
Windows Named Pipe API
    │  - CreateNamedPipe
    │  - ConnectNamedPipe
    │  - ReadFile / WriteFile
    │  - DisconnectNamedPipe
    │
    ▼
微信/企微进程 (注入 DLL)
```

### 3.3 DLL 文件位置

PipeCore.dll 位于 `extraResources` 目录中，打包后随应用分发：

```
extraResources/
├── dll/
│   ├── PipeCore.dll          ← 32 位版本
│   ├── PipeCore64.dll        ← 64 位版本
│   ├── galaxy.dll            ← 微信注入 DLL
│   ├── sirius.dll            ← 另一个注入 DLL
│   └── BasicService.exe      ← 注入工具
└── ...
```

---

## 四、连接建立流程

### 4.1 启动入口

逆向 IPC 的初始化在 `AppStart.run()` 中由 `ReverseStart.run()` 启动：

```
AppStart.run()
    │
    ├─ FrontStart.run()         ← WebSocket 先启动
    │
    └─ ReverseStart.run()       ← 逆向 IPC 启动
         │
         └─ initIpcTaskService.run()
              │
              └─ 启动进程扫描循环
```

### 4.2 进程扫描与连接

`initIpcTask` 的核心逻辑是一个定时扫描循环，每 5 秒执行一次：

```
initIpcTask 扫描循环（每 5 秒）
    │
    ├─ 步骤 1: 检测微信/企微进程
    │    使用 IpcUtil 扫描系统中运行的微信/企微进程
    │    获取进程 PID 列表
    │
    ├─ 步骤 2: 过滤已连接的进程
    │    对比 RegistryConfig 中已存在的连接
    │    排除已经建立管道连接的进程
    │
    ├─ 步骤 3: 建立新连接
    │    对每个新发现的进程：
    │    │
    │    ├─ Clibrary.IpcConnectServer(processId)
    │    │    → 返回 pipeCode（管道连接码）
    │    │
    │    ├─ 如果 pipeCode > 0（连接成功）：
    │    │    │
    │    │    ├─ 创建 pipeLineWrapper 对象
    │    │    │    {
    │    │    │        id: channelId,
    │    │    │        processId: pid,
    │    │    │        pipeCode: pipeCode,
    │    │    │        workWx: isWorkWx,
    │    │    │        wxid: null,  // 登录后填充
    │    │    │        lastPongTime: Date.now()
    │    │    │    }
    │    │    │
    │    │    ├─ RegistryConfig.add(pipeLineWrapper)
    │    │    │
    │    │    └─ startSelectMessage(pipeLineWrapper)
    │    │         → 启动 AsyncSelectTask 循环
    │    │
    │    └─ 如果 pipeCode <= 0（连接失败）：
    │         记录日志，等待下次扫描
    │
    └─ 步骤 4: 检测已断开的连接
         对比进程列表和 Registry
         清理已不存在的进程条目
```

### 4.3 连接参数

| 参数 | 说明 |
|------|------|
| `processId` | 微信/企微进程的 PID |
| `pipeCode` | 管道连接码，由 `IpcConnectServer` 返回，后续所有操作使用此码 |
| `channelId` | 前端标识此连接的通道 ID |
| `workWx` | 是否为企业微信进程 |

### 4.4 注入流程

在进程扫描之前，需要先将 DLL 注入到微信/企微进程中：

**微信注入**：

```
前端点击"启动微信"
    → IPC: runInject
    → inject.runInject()
    → 启动 BasicService.exe
    → BasicService.exe 执行以下操作：
         1. 检测微信进程
         2. 将 galaxy.dll 注入到微信进程
         3. galaxy.dll 在微信内部创建 Named Pipe 服务端
         4. 等待 Electron 主进程连接
```

**企业微信注入**：

```
前端点击"启动企微"
    → IPC: runQyWxInject(accountId)
    → inject.runQyWxInject(accountId)
    → 启动对应的注入程序
    → 注入 DLL 到企微进程
```

---

## 五、消息接收流程

### 5.1 轮询机制

消息接收使用轮询（polling）模式而非事件驱动。`AsyncSelectTask` 为每个管道连接维护一个循环：

```
AsyncSelectTask.loop(pipeLineWrapper)
    │
    └─ while (true) {
         │
         ├─ 步骤 1: 检查管道状态
         │    selectCode = Clibrary.IpcSelectCltChannel(pipeCode)
         │
         ├─ 步骤 2: 根据返回值处理
         │    │
         │    ├─ selectCode > 0 → 有数据，进入接收流程
         │    │
         │    ├─ selectCode === 0 → 无数据，短暂等待后继续循环
         │    │
         │    └─ selectCode < 0 → 连接断开，进入清理流程
         │
         └─ 步骤 3: 循环间隔
              短暂 sleep 后继续下一轮
       }
```

### 5.2 消息接收处理（selectCode > 0）

```
selectCode > 0（有数据可读）
    │
    ├─ 步骤 1: 读取消息
    │    message = Clibrary.IpcClientRecvMessage(
    │        pipeCode,
    │        selectCode,    // 数据长度
    │        wxid           // 微信 ID（可能为空）
    │    )
    │
    ├─ 步骤 2: 预处理
    │    replaceLargeNumbers(message)
    │    → 将 ≥17 位的大数字替换为字符串，避免 JSON 精度丢失
    │
    ├─ 步骤 3: 解析 JSON
    │    parsedMessage = JSON.parse(message)
    │
    └─ 步骤 4: 入站调度
         dispatchOutBound(parsedMessage, pipeLineWrapper)
         → 进入消息调度中心的出站处理流程
```

### 5.3 连接断开处理（selectCode < 0）

```
selectCode < 0（管道连接断开）
    │
    ├─ 步骤 1: 关闭管道
    │    Clibrary.IpcClientClose(pipeCode)
    │
    ├─ 步骤 2: 清理 Registry
    │    RegistryConfig.removePipe(pipeCode)
    │    → 从注册表中移除该连接
    │
    ├─ 步骤 3: 上报登出
    │    logoutService.operate(wxId)
    │    → 如果该连接已登录微信号
    │    → 通过 MQTT 上报 ROBOT_LOGIN_FAIL
    │    → 通知前端（WebSocket）
    │
    └─ 步骤 4: 退出循环
         AsyncSelectTask.loop() 结束
         该管道的轮询线程终止
```

### 5.4 无数据处理（selectCode === 0）

```
selectCode === 0（管道正常但无数据）
    │
    └─ 短暂等待（避免 CPU 空转）
         → 继续下一轮 IpcSelectCltChannel 检查
```

---

## 六、消息发送流程

### 6.1 发送入口

消息发送通过 `dispatch-center/reverseSend.js` 实现：

```
reverseSend.sendMessage(wxId, channelId, message)
    │
    ├─ 步骤 1: 查找 Registry
    │    registry = RegistryConfig.getRegistryByKey(wxId 或 channelId)
    │    如果找不到 → 记录日志，返回
    │
    ├─ 步骤 2: 去重检查
    │    key = taskId + "-" + type
    │    如果 5 秒内已发送过相同 key 的消息 → 丢弃
    │    否则记录 key，继续
    │
    ├─ 步骤 3: 获取 pipeCode
    │    pipeCode = registry.pipeCode
    │
    └─ 步骤 4: 发送
         pipeLineSend(message, wxid, pipeCode)
         → Clibrary.IpcClientSendMessage(pipeCode, message)
```

### 6.2 广播发送

```
reverseSend.sendMessageAll(message)
    │
    └─ 遍历 RegistryConfig 中所有连接
         │
         └─ 对每个 registry:
              pipeLineSend(message, wxid, registry.pipeCode)
```

广播发送用于需要通知所有微信号的场景，如心跳、配置更新等。

### 6.3 发送数据格式

发送到微信/企微的消息是 JSON 字符串，主要包含以下结构：

**ClientTaskBO（微信任务）**：

```
{
    "type": "SEND_MESSAGE",
    "data": {
        "type": 1,              // 消息类型（1=文本，3=图片等）
        "content": "你好",       // 消息内容
        "to": "wxid_target",    // 接收方
        "roomid": "",           // 群 ID（如有）
        "localpath": "",        // 本地文件路径（如有）
        "uselocal": 0           // 是否使用本地文件
    },
    "taskId": "task_001",
    "flowSource": 1,            // 1=前端，2=云端，3=内部
    "flag": "",
    "logicId": "logic_001",
    "status": 0
}
```

**WorkWxClientTaskBO（企微任务）**：

```
{
    "type": "WORK_SEND_MESSAGE",
    "room": "conversation_xxx",
    "userid": "user_001",
    "usertype": 1,
    "msg_items": [...],
    "conversationid": "conv_001",
    "taskId": "task_002",
    "logicId": "logic_002",
    "packageId": "pkg_001",
    "serialNo": 1
}
```

---

## 七、出站消息处理（逆向 → 业务层）

### 7.1 出站调度流程

当 `asyncSelectTask` 接收到逆向返回的消息后，进入 `dispatchOutBound` 处理：

```
dispatchOutBound(message, pipeLineWrapper)
    │
    ├─ 步骤 1: 预处理
    │    ├─ 检查 bugreport 类型 → 特殊处理
    │    ├─ 检查 error 类型 → 错误上报
    │    └─ 更新 GalaxyVersionCache
    │
    ├─ 步骤 2: 按账号类型路由
    │    │
    │    ├─ 企业微信 (pipeLineWrapper.workWx === true)
    │    │    → WkMsgHandlerCenter.outBoundMsg(message, pipeLineWrapper)
    │    │
    │    └─ 微信
    │         → WxMsgHandlerCenter.outBoundMsg(message, pipeLineWrapper)
    │
    └─ 步骤 3: 特殊任务延迟
         如果是 THIRD_CALLBACKS 中的任务类型，且 status !== 0
         → 延迟 taskFailWaitTime 后再处理
```

### 7.2 三段式消息匹配

微信返回的消息通常分多条到达，需要通过"三段式"机制将它们组合为完整的业务结果。

**微信消息的三段匹配**：

| 段落 | 典型类型 | 含义 |
|------|---------|------|
| 第一条 | `sendmessage`、`SendMsgResponseNew` | 微信已接收到指令 |
| 第二条 | `recvmsg`、`msgreport` | 消息已发出或操作已执行 |
| 第三条 | `MM.*`、CDN 相关 | 最终结果（文件上传完成等） |

**匹配机制**：

```
消息到达
    │
    ├─ 步骤 1: 生成 key
    │    key = 基于 taskId、type 等字段生成唯一标识
    │    微信 4.0 使用 getWx4AssociationKey 生成
    │
    ├─ 步骤 2: 查找缓存
    │    msgResNode = msgResNodeMap.get(key)
    │
    ├─ 步骤 3: 填充消息段落
    │    │
    │    ├─ 如果是第一条 → msgResNode.first = message
    │    ├─ 如果是第二条 → msgResNode.second = message
    │    └─ 如果是第三条 → msgResNode.third = message
    │
    └─ 步骤 4: 检查完整性
         │
         ├─ 如果三条都已收齐（或某些任务只需一/两条）
         │    → thirdMsgHandler(msgResNode)
         │    → 进入 businessHandler
         │    → 清理 msgResNodeMap 中的缓存
         │
         └─ 如果未收齐
              → 等待后续消息
              → GalaxyTaskStatusTimer 会定期检查超时
```

### 7.3 业务处理器路由

消息匹配完成后，`businessHandler` 根据 `flowSource` 决定将结果发往何处：

```
businessHandler(msgResNode)
    │
    ├─ flowSource = 1 (FRONT)
    │    → frontFlowOutBound(message, pipeLineWrapper)
    │    → 通过 WebSocket 推送给前端
    │
    ├─ flowSource = 2 (CLOUD)
    │    → cloudFlowOutBound(message, pipeLineWrapper)
    │    → 通过 convert-service/response → MQTT 上报云端
    │
    ├─ flowSource = 3 (OWNER)
    │    → 内部处理，不外发
    │
    └─ 无 flowSource（广播）
         → outBoundByBroadcast
         → 同时发送到前端（WebSocket）和云端（MQTT）
```

### 7.4 特殊消息类型

| 类型 | 处理方式 |
|------|---------|
| `login` | 登录消息 → loginService → MQTT 连接 → 通知前端 |
| `logout` / `LOGOUT` | 登出消息 → logoutService → MQTT 上报 → 清理 Registry |
| `pong` | 心跳响应 → 更新 lastPongTime |
| `bugreport` | 逆向错误报告 → 日志记录 → 告警 |
| `error` | 错误消息 → 错误上报 |
| `recvmsg` | 收到消息 → 消息记录 → 前端推送 → 云端上报 |
| `oplog` | 操作日志 → 处理好友/群变更 |

---

## 八、关键场景详解

### 8.1 场景一：微信登录检测

**流程**：

1. `initIpcTask` 扫描发现微信进程（已被注入 DLL）
2. 调用 `IpcConnectServer(pid)` 建立管道连接
3. `asyncSelectTask` 开始轮询
4. 微信进程通过管道发送登录状态消息：
   ```
   { "type": "login", "status": 0, "data": { "wxid": "wxid_abc", "nickname": "张三", "headimg": "url" } }
   ```
5. `dispatchOutBound` → `cloudFlowOutBound` → `loginService.operate()`
6. `loginService` 执行：
   - 注册设备到云端（HTTP）
   - 建立 MQTT 连接
   - 更新 Registry（绑定 wxId、wxInfo）
   - 通知前端（WebSocket）

### 8.2 场景二：发送文本消息

**流程**：

1. 前端发送 WebSocket 消息（`forward` 命令，body 包含发消息任务）
2. `forwardTask` 解析任务，构造 ClientTaskBO
3. `dispatchInBound` 查找 Registry，获取 pipeCode
4. `reverseSend.pipeLineSend()` 发送：
   ```
   IpcClientSendMessage(pipeCode, JSON.stringify({
       type: "SEND_MESSAGE",
       data: { type: 1, content: "你好", to: "wxid_target" },
       taskId: "task_001"
   }))
   ```
5. 微信进程执行发送
6. 微信通过管道返回第一条消息（sendmessage 响应）
7. 微信通过管道返回第二条消息（recvmsg）
8. 微信通过管道返回第三条消息（msgreport）
9. 三段式匹配完成，`businessHandler` 分发：
   - 前端：WebSocket 推送发送成功通知
   - 云端：MQTT 上报消息记录

### 8.3 场景三：接收新消息

**流程**：

1. 微信收到一条新消息
2. 注入的 DLL 捕获消息事件
3. 通过 Named Pipe 发送消息数据：
   ```
   {
       "type": "recvmsg",
       "data": {
           "from": "wxid_sender",
           "to": "wxid_me",
           "content": "新消息内容",
           "msgType": 1,
           "createTime": 1710000000,
           "msgId": "12345678"
       }
   }
   ```
4. `asyncSelectTask` 轮询到数据
5. `IpcClientRecvMessage` 读取消息
6. `dispatchOutBound` → `WxMsgHandle`
7. `recvMsgService` 处理消息：
   - 判断消息类型（文本、图片、视频等）
   - 存储到 SQLite
   - 通知前端（WebSocket）
   - 上报云端（MQTT）

### 8.4 场景四：微信进程退出

**流程**：

1. 用户关闭微信或微信进程崩溃
2. Named Pipe 连接断开
3. `asyncSelectTask` 的 `IpcSelectCltChannel` 返回 < 0
4. 进入 `closeIpcConnect` 处理：
   - 关闭管道：`IpcClientClose(pipeCode)`
   - 移除 Registry 条目
   - 触发登出：`logoutService.operate()`
   - MQTT 上报登出
   - 通知前端

### 8.5 场景五：心跳检测

**流程**：

1. `HeartBeatTimer` 每 10 秒检查所有连接
2. 通过 `reverseSend.sendMessageAll()` 向所有管道发送 Ping
3. 微信/企微进程返回 Pong
4. `asyncSelectTask` 接收到 Pong → 更新 `lastPongTime`
5. 如果超过指定时间未收到 Pong：
   - 标记连接为 `NOT_AVAILABLE`
   - 从 Registry 移除管道
   - 触发登出流程
   - 通知前端

---

## 九、Registry 配置管理

### 9.1 Registry 的数据结构

每个管道连接在 Registry 中对应一个条目（pipeLineWrapper）：

```
pipeLineWrapper = {
    id: "channel_001",              // 通道 ID（前端使用）
    processId: 12345,               // 微信/企微进程 PID
    pipeCode: 67890,                // Named Pipe 连接码
    workWx: false,                  // 是否企业微信
    wxid: "wxid_abc123",            // 微信 ID（登录后填充）
    wxInfo: {                       // 微信号信息
        nickname: "张三",
        headimg: "url",
        sex: 1
    },
    mqttClient: MqttClient,         // MQTT 客户端实例（登录后绑定）
    ipcClientStatus: "AVAILABLE",   // IPC 连接状态
    cloudSendStatus: "SENT",        // 云端同步状态
    lastPongTime: 1710000000000     // 最后心跳时间
}
```

### 9.2 Registry 操作

| 操作 | 方法 | 触发时机 |
|------|------|---------|
| 添加 | `RegistryConfig.add(wrapper)` | 管道连接建立成功 |
| 查询 | `RegistryConfig.getRegistryByKey(key, field)` | 消息路由时查找目标连接 |
| 更新 | 直接修改 wrapper 属性 | 登录成功（绑定 wxId、mqttClient） |
| 移除管道 | `RegistryConfig.removePipe(pipeCode)` | 管道断开 |
| 移除条目 | `RegistryConfig.remove(key)` | 微信号登出 |
| 清空全部 | `RegistryConfig.removeAll()` | 应用退出 |

### 9.3 多账号并发

一台电脑可以同时运行多个微信/企微实例，每个实例对应一个 Registry 条目和一个独立的 `AsyncSelectTask` 轮询循环。

```
微信进程 1 (PID: 1001) ←→ pipeCode: 101 ←→ AsyncSelectTask 线程 1
微信进程 2 (PID: 1002) ←→ pipeCode: 102 ←→ AsyncSelectTask 线程 2
企微进程 1 (PID: 2001) ←→ pipeCode: 201 ←→ AsyncSelectTask 线程 3
```

每个轮询循环独立运行，互不干扰。消息通过 pipeCode 精确路由到对应的微信号。

---

## 十、IPC 配置与常量

### 10.1 IPC 状态常量（ipcConstant）

| 常量 | 值 | 说明 |
|------|-----|------|
| `SEND_LOGIN_TO_CLOUD` | — | 已向云端发送登录 |
| `NOT_SEND_LOGIN_TO_CLOUD` | — | 未向云端发送登录 |
| `AVAILABLE` | — | IPC 连接可用 |
| `NOT_AVAILABLE` | — | IPC 连接不可用 |

### 10.2 IPC 配置（ipcConfig）

| 配置项 | 说明 |
|--------|------|
| 扫描间隔 | 5 秒 |
| 心跳超时 | 根据 HeartBeatTimer 配置 |
| 重试次数 | 连接失败后等待下次扫描 |
| 轮询间隔 | AsyncSelectTask 的 sleep 间隔 |

---

## 十一、错误处理与容错

### 11.1 管道连接错误

| 错误场景 | 处理方式 |
|---------|---------|
| 进程不存在 | `IpcConnectServer` 返回 ≤ 0，跳过 |
| DLL 未注入 | 管道无法建立，`IpcConnectServer` 返回 ≤ 0 |
| 管道断开 | `IpcSelectCltChannel` 返回 < 0，执行清理流程 |
| 发送失败 | `IpcClientSendMessage` 返回错误码，记录日志 |
| 接收超时 | 轮询模式无超时，但心跳检测会发现无响应 |

### 11.2 进程崩溃

| 崩溃方 | 影响 | 处理 |
|--------|------|------|
| 微信崩溃 | Named Pipe 断开 | `selectCode < 0` 触发清理和登出 |
| Electron 崩溃 | 所有管道连接丢失 | 重启后 `initIpcTask` 重新扫描和建连 |
| BasicService 崩溃 | 无法注入新微信 | 需要手动重启注入 |

### 11.3 内存管理

- `msgResNodeMap` 缓存的消息片段可能占用内存
- `GalaxyTaskStatusTimer` 每 10 秒检查超时任务，清理过期缓存
- 默认超时时间由 `over_time.galaxy.task.status` 配置

---

## 十二、性能考虑

### 12.1 轮询开销

`AsyncSelectTask` 使用轮询模式接收消息，在多账号场景下可能消耗较多 CPU。缓解措施：
- 无数据时短暂 sleep，避免 CPU 空转
- 每个管道独立一个轮询循环，可利用多核

### 12.2 消息吞吐

Named Pipe 的消息吞吐量取决于：
- 管道缓冲区大小
- 消息大小
- 轮询频率

对于微信消息收发场景，Named Pipe 的性能绑定足够。瓶颈更可能在后续的业务处理（如文件下载、数据库写入）。

### 12.3 大消息处理

某些消息可能很大（如好友列表、群成员列表，可能包含几百甚至几千条记录）。`IpcClientRecvMessage` 的 `bufferLength` 参数由 `IpcSelectCltChannel` 返回的长度决定，确保缓冲区足够。

---

## 十三、调试方法

### 13.1 日志排查

在主进程日志中搜索以下关键字：

| 关键字 | 说明 |
|--------|------|
| `initIpcTask` | 进程扫描和连接建立 |
| `IpcConnectServer` | 管道连接建立 |
| `asyncSelectTask` | 消息轮询 |
| `IpcClientRecvMessage` | 消息接收 |
| `IpcClientSendMessage` | 消息发送 |
| `dispatchOutBound` | 出站调度 |
| `reverseSend` | 入站发送 |
| `pipeCode` | 管道连接码 |
| `closeIpcConnect` | 连接关闭 |
| `RegistryConfig` | Registry 操作 |

### 13.2 管道连接状态检查

- 检查 Registry 中的连接列表
- 通过日志搜索 `AVAILABLE` / `NOT_AVAILABLE` 确认连接状态
- 使用 Windows 进程管理器确认微信/企微进程是否在运行

### 13.3 消息收发调试

**接收调试**：
- 在 `asyncSelectTask` 的消息接收处添加日志
- 搜索 `dispatchOutBound` 查看接收到的消息内容

**发送调试**：
- 在 `reverseSend.pipeLineSend` 处查看发送内容
- 检查 pipeCode 是否有效
- 确认 Registry 中对应条目存在

### 13.4 常见问题排查

**问题：微信无法连接**
- 检查微信进程是否在运行
- 检查 DLL 是否成功注入（BasicService 是否正常启动）
- 检查 `IpcConnectServer` 返回值
- 确认 PipeCore.dll 文件存在且版本正确

**问题：消息发送但微信无响应**
- 检查 pipeCode 是否有效（管道是否仍然连接）
- 检查消息格式是否正确（JSON 合法性）
- 确认微信版本与 DLL 版本兼容

**问题：消息接收不完整**
- 检查三段式匹配是否正常（`msgResNodeMap` 中的状态）
- 检查 `GalaxyTaskStatusTimer` 是否将任务标记为超时
- 确认 `bufferLength` 是否足够

---

## 十四、安全考虑

### 14.1 DLL 注入风险

DLL 注入是一种敏感的技术操作：
- 可能被安全软件拦截或标记
- 微信/企微的更新可能导致 DLL 不兼容
- 需要管理员权限

### 14.2 管道安全

Named Pipe 使用固定的 GUID 作为管道名称，理论上其他程序也可以连接到同一管道。建议：
- 使用 ACL 限制管道访问权限
- 在通信协议中加入身份验证

### 14.3 数据安全

通过管道传输的数据为明文 JSON，没有加密。在本机进程间通信场景下，加密不是强需求，但如果消息中包含敏感信息（如用户密码），应考虑加密传输。

---

## 十五、总结

逆向 IPC（Named Pipe）是 galaxy-client 中最核心的通信机制，它实现了 Electron 主进程与微信/企业微信进程之间的双向数据通信。

**核心特征**：
- 基于 Windows Named Pipe，通过 FFI 调用 PipeCore.dll
- 每个微信/企微进程对应一个独立的管道连接和轮询循环
- 使用三段式消息匹配机制处理微信的异步响应
- 通过 Registry 管理多账号并发连接
- 定时扫描机制自动发现和连接新进程

**在通信架构中的核心地位**：
- 所有微信/企微的操作都必须通过 Named Pipe 执行
- 前端（WebSocket）和云端（MQTT）的指令最终都汇聚到 Named Pipe 发送
- 微信/企微的所有响应都从 Named Pipe 出发，分发到前端和云端
- 是整个系统的"最后一公里"通信通道
