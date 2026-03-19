# MQTT 通信机制详解

> 本文档详细分析 galaxy-client 项目中 MQTT 通信机制的设计、连接管理、消息流转、任务处理和调试方法。

---

## 一、MQTT 在项目中的角色

### 1.1 MQTT 的定位

MQTT（Message Queuing Telemetry Transport）是 galaxy-client 与云端服务之间的核心异步通信通道。在五大通信机制中，MQTT 负责：

- **下行通信**（云端 → 客户端）：云端通过 MQTT 下发任务指令（发消息、加好友、改备注等）
- **上行通信**（客户端 → 云端）：客户端通过 MQTT 上报任务执行结果、登录状态、心跳信息等

MQTT 的发布/订阅（Pub/Sub）模型非常适合这种异步的、一对一的任务下发与结果上报场景。

### 1.2 为什么选择 MQTT

相比 HTTP 轮询或 WebSocket 长连接，MQTT 在此场景下的优势：

| 对比维度 | MQTT | HTTP 轮询 | WebSocket |
|---------|------|----------|-----------|
| 实时性 | 高（推送模式） | 低（依赖轮询频率） | 高 |
| 资源消耗 | 低（轻量协议） | 高（频繁请求） | 中 |
| 离线消息 | 支持（QoS + clean=false） | 不支持 | 不支持 |
| 多客户端管理 | 天然支持（Topic 路由） | 需自行实现 | 需自行实现 |
| 断线恢复 | 支持 | 需自行实现 | 需自行实现 |

galaxy-client 使用阿里云消息队列（MQ for MQTT）作为 Broker，利用其 P2P（点对点）消息能力实现对特定微信号的精确任务下发。

### 1.3 技术选型

| 项目 | 选择 | 说明 |
|------|------|------|
| MQTT 客户端库 | `mqtt` (npm) | Node.js 最主流的 MQTT 客户端库 |
| MQTT Broker | 阿里云 MQ for MQTT | 托管服务，无需自建 |
| 协议版本 | MQTT 3.1.1 | 标准协议 |
| 传输协议 | TCP | 端口 1883，非加密 |
| 鉴权方式 | HMAC-SHA1 签名 | 阿里云标准鉴权 |

---

## 二、MQTT 核心文件与架构

### 2.1 文件分布

| 文件 | 职责 |
|------|------|
| `msg-center/core/mq/mqttClientBase.js` | MQTT 客户端核心：连接管理、订阅、消息接收与分发 |
| `msg-center/core/mq/mqttHelper.js` | 连接入口：鉴权、参数构建、连接建立 |
| `msg-center/core/mq/mqttConfig.js` | MQTT 配置：Broker 地址、Topic、GroupId 等 |
| `msg-center/core/mq/mqExcuteMsg.js` | 消息发布：向 MQTT Broker 发送消息 |
| `msg-center/core/mq/mqttMakeUpManager.js` | 补偿管理：未发送消息的缓存与重试 |
| `msg-center/dispatch-center/mqttSend.js` | 上行消息封装：构建上报消息并发送 |
| `msg-center/dispatch-center/dispatch/cloudFlowInBound.js` | 下行入站：MQTT 任务 → 逆向转发 |
| `msg-center/dispatch-center/dispatch/cloudFlowOutBound.js` | 上行出站：逆向结果 → MQTT 上报 |
| `msg-center/business/task-mqtt/*.js` | MQTT 任务处理器（约 42 个文件） |

### 2.2 MQTT 在整体架构中的位置

```
┌──────────────────────────────────────────────────────┐
│                     阿里云 MQTT Broker                 │
│                                                      │
│  ┌─────────────────┐        ┌─────────────────────┐  │
│  │ P2P Topic       │        │ Parent Topic         │  │
│  │ (下行: 任务下发) │        │ (上行: 结果上报)     │  │
│  └────────┬────────┘        └──────────┬──────────┘  │
│           │                            │             │
└───────────┼────────────────────────────┼─────────────┘
            │ subscribe                  │ publish
            ▼                            ▲
┌───────────────────────────────────────────────────────┐
│                    Electron 主进程                      │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │ mqttClientBase (每个微信号一个实例)                │  │
│  │                                                 │  │
│  │  on('message') → 解析 → 去重 → 过期检查           │  │
│  │  → execute() → task-mqtt Service → cloudFlowIn   │  │
│  └──────────────────────┬──────────────────────────┘  │
│                         │                             │
│  ┌──────────────────────▼──────────────────────────┐  │
│  │ mqExcuteMsg / mqttSend                          │  │
│  │                                                 │  │
│  │  mqttClient.publish(topic, payload)              │  │
│  │  失败 → MqttMakeUpManager 缓存                   │  │
│  └─────────────────────────────────────────────────┘  │
│                                                       │
│  Registry: { wxId → { mqttClient, pipeCode, ... } }   │
│                                                       │
└───────────────────────────────────────────────────────┘
```

---

## 三、MQTT 连接管理

### 3.1 连接建立时机

**重要设计决策**：MQTT 连接不在应用启动时建立，而是在**微信/企微账号登录成功后**才建立。每个登录的微信号对应一个独立的 MQTT 客户端连接。

**连接建立触发链**：

```
微信进程通过 Named Pipe 返回登录成功消息
    │  type: "login", status: 0
    ▼
dispatchOutBound → cloudFlowOutBound
    │
    ▼
loginService.operate(wxId, clientMsgBO)
    │
    ├─ 步骤 1: 过滤检查
    │    - type 是否为 "login"
    │    - status 是否为 0（成功）
    │    - 是否已在处理中（防重复）
    │
    ├─ 步骤 2: 注册设备（HTTP）
    │    向云端上报登录信息
    │
    ├─ 步骤 3: 建立 MQTT 连接
    │    mqttHelper.connectMqtt(wxId)
    │    │
    │    ├─ 3a: 获取鉴权令牌
    │    │    HTTP POST → mqtt.expiration.url
    │    │    请求体: { access: XOR+Base64编码的 "ACCOUNT" }
    │    │    响应: { accessKey, secretKey }
    │    │
    │    ├─ 3b: 构建连接参数
    │    │    clientId = groupId + "@@@" + wxId
    │    │    username = "Signature|" + accessKey + "|" + instanceId
    │    │    password = HMAC-SHA1(clientId, secretKey) → Base64
    │    │
    │    ├─ 3c: 连接 MQTT Broker
    │    │    mqtt.connect("tcp://" + endPoint + ":1883", {
    │    │        clientId, username, password,
    │    │        connectTimeout: 5000,
    │    │        clean: false,
    │    │        reconnectPeriod: 0
    │    │    })
    │    │
    │    └─ 3d: 订阅 P2P Topic
    │         topic = taskIssuedTopic + "/p2p/" + clientId
    │         QoS = 1
    │
    ├─ 步骤 4: 绑定 MQTT 客户端
    │    registry.mqttClient = client
    │
    └─ 步骤 5: 通知前端
         通过 WebSocket 推送登录成功
```

### 3.2 Broker 连接参数

**Broker 地址（endPoint）**：

| 环境 | Broker 地址 | 端口 |
|------|------------|------|
| 生产环境 | `mqtt-cn-v0h1klv0a02.mqtt.aliyuncs.com` | 1883 |
| 测试环境 | 同上（通过 instanceId 区分） | 1883 |
| 开发环境 | 本地可使用 `mqtt://localhost:1883` | 1883 |

**实例 ID（instanceId）**：阿里云 MQ for MQTT 的实例标识，用于隔离不同环境的消息。

**连接参数详解**：

| 参数 | 值 | 说明 |
|------|-----|------|
| `clientId` | `GID-win-client-pro@@@wxid_xxx` | 格式: `{groupId}@@@{wxId}`，唯一标识一个客户端 |
| `username` | `Signature\|{accessKey}\|{instanceId}` | 阿里云 Signature 鉴权格式 |
| `password` | `Base64(HMAC-SHA1(clientId, secretKey))` | 签名认证 |
| `connectTimeout` | 5000 | 连接超时 5 秒 |
| `clean` | false | 不清除会话——Broker 会保留该 clientId 的订阅和离线消息 |
| `reconnectPeriod` | 0 | 禁用库的自动重连，由应用层手动管理 |

### 3.3 鉴权流程

MQTT 连接前需要获取阿里云的访问凭证，这通过 HTTP 请求实现：

**鉴权 URL**：

| 环境 | URL |
|------|-----|
| 生产 | `https://api.umeng100.com/uqun/token/aly/open/access` |
| 测试 | `https://test-api.umeng100.com/uqun/token/aly/open/access` |

**请求流程**：

```
步骤 1: 编码请求
    plainText = "ACCOUNT"
    encoded = XOR加密(plainText) → Base64编码
    requestBody = { access: encoded }

步骤 2: 发送 HTTP 请求
    POST 鉴权URL
    Content-Type: application/json
    Body: { access: "编码后的字符串" }

步骤 3: 解析响应
    response = { data: "加密的响应" }
    decoded = Base64解码 → XOR解密(response.data)
    result = JSON.parse(decoded)
    // result = { accessKey: "xxx", secretKey: "yyy" }

步骤 4: 缓存结果
    accessResCache = result
    后续连接复用缓存，避免重复请求
```

### 3.4 重连机制

项目禁用了 MQTT 库的自动重连（`reconnectPeriod: 0`），改为由应用层通过 `PingTimer` 定时检测和手动重连：

**检测逻辑**（每 10 秒执行）：

```
PingTimer.run()
    │
    ├─ 遍历 Registry 中所有微信号
    │
    ├─ 检查 mqttClient 状态
    │    │
    │    ├─ mqttClient 不存在 → 需要重连
    │    │
    │    ├─ mqttClient.connected === false → 需要重连
    │    │
    │    └─ mqttClient.connected === true → 正常
    │
    └─ 需要重连时：
         cloudFlowInBound(LOGIN, MQTT_CHECK)
         → loginService → mqttHelper.connectMqtt()
         → 重新建立 MQTT 连接
```

**重连策略的设计考虑**：

禁用自动重连的原因：
1. 阿里云 MQ for MQTT 的鉴权令牌可能过期，自动重连使用旧凭证会失败
2. 应用层需要感知连接断开事件，执行额外的状态更新
3. 某些断开可能是因为微信号登出，不应该自动重连

手动管理的好处：
1. 重连前可以重新获取鉴权令牌
2. 可以检查微信号是否仍在登录状态
3. 可以控制重连频率和策略

### 3.5 连接断开处理

**断开事件处理**：

```
mqttClient.on('close')
    │
    ├─ 记录日志
    │
    ├─ 触发告警
    │    notify.onMqttClose(wxId)
    │    如果短时间内频繁断开 → 发送灵犀告警
    │
    └─ 等待 PingTimer 下一次检测时重连
```

**错误事件处理**：

```
mqttClient.on('error')
    │
    ├─ 记录日志
    │
    └─ 不主动重连，等待 close 事件或 PingTimer
```

---

## 四、Topic 设计与消息路由

### 4.1 Topic 命名规范

MQTT 消息通过 Topic 进行路由。galaxy-client 使用两类 Topic：

**上行 Topic（客户端 → 云端）**：

| 环境 | parentTopic |
|------|-------------|
| 生产 | `robot-wx-win-pro` |
| 测试 | `robot-wx-win-test-01` |
| 开发 | `robot-wx-win-dev` |

所有上行消息发布到同一个 parentTopic，由云端消费者统一处理。

**下行 Topic（云端 → 客户端）**：

| 环境 | taskIssuedTopic |
|------|-----------------|
| 生产 | `robot-wx-win-issued-pro` |
| 测试 | `robot-wx-win-issued-test01` |

下行消息使用 P2P（点对点）Topic 精确投递到特定客户端。

### 4.2 P2P 消息机制

阿里云 MQ for MQTT 提供 P2P 消息能力，允许向特定 clientId 发送消息，无需该 clientId 预先订阅。

**P2P Topic 格式**：

```
{taskIssuedTopic}/p2p/{clientId}

示例:
robot-wx-win-issued-pro/p2p/GID-win-client-pro@@@wxid_abc123
```

**clientId 格式**：

```
{groupId}@@@{wxId}

其中:
- groupId: 阿里云 MQ 消费组 ID，如 "GID-win-client-pro"
- @@@: 分隔符（由 CLINKID_CONNECTOR 常量定义）
- wxId: 微信用户唯一标识

示例:
GID-win-client-pro@@@wxid_abc123
```

### 4.3 订阅策略

每个微信号在连接成功后订阅其专属的 P2P Topic：

```
subscribe(
    topic: "robot-wx-win-issued-pro/p2p/GID-win-client-pro@@@wxid_abc123",
    options: { qos: 1 }
)
```

- **QoS 1**（至少一次投递）：确保任务消息不会丢失。如果客户端未确认，Broker 会重发。
- 每个微信号只订阅自己的 Topic，不会收到其他微信号的消息。

---

## 五、下行通信：云端任务下发

### 5.1 下行消息格式

云端通过 MQTT 下发的任务消息为 JSON 格式，编码为 UTF-8 Buffer：

```
{
    "type": "CHATROOM_SEND_MSG",    // 任务类型
    "id": "task_123456",             // 任务 ID
    "createTime": 1710000000,        // 任务创建时间（秒级时间戳）
    "data": {
        "roomid": "xxx@chatroom",    // 群 ID
        "content": "你好",            // 消息内容
        "msgType": 1,                // 消息类型
        "from": "wxid_sender",       // 发送者
        "to": "wxid_receiver"        // 接收者
    },
    "accountId": "wxid_abc123",      // 目标微信号
    ...
}
```

**大数字处理**：由于 JavaScript 对大整数（≥17 位）的精度有限，消息接收后会将超长数字替换为字符串，避免精度丢失。

### 5.2 下行消息处理流程

```
步骤 1: MQTT 客户端接收消息
    mqttClientBase.on('message', (topic, payload) => { ... })
    │
    ├─ 将 payload 从 Buffer 转为 UTF-8 字符串
    ├─ 大数字处理（replaceLargeNumbers）
    └─ JSON 解析

步骤 2: 消息校验
    │
    ├─ 去重检查：mqttTaskMapLock[taskId]
    │    如果 taskId 已存在 → 丢弃（重复消息）
    │    如果不存在 → 记录 taskId，继续处理
    │
    ├─ 过期检查：
    │    if (createTime * 1000 < Date.now() - expireTime)
    │    默认 expireTime = 3 小时（可通过 Apollo 配置）
    │    过期 → 上报超时，丢弃
    │
    └─ 类型校验：检查任务类型是否合法

步骤 3: 任务路由
    execute(wxId, serverTaskBO)
    │
    ├─ 微信任务：遍历 WxConvertServiceList（约 17 个 Service）
    │    每个 Service 有 filter(serverTaskBO) 方法
    │    匹配的 Service 执行 operate(serverTaskBO, wxId)
    │
    └─ 企微任务：遍历 WorkWxConvertServiceList（约 25 个 Service）
         同上

步骤 4: 任务转换与下发
    task-mqtt/mqttXxxService.operate()
    │
    ├─ 参数校验
    ├─ 记录任务到 SQLite（TaskInfoService.receiveTask）
    ├─ 下载所需文件（如图片、视频 URL）
    ├─ 构造 ClientTaskBO
    └─ cloudFlowInBound → dispatchInBound → reverseSend
         通过 Named Pipe 发往微信执行
```

### 5.3 MQTT 任务类型清单

#### 微信任务（WxConvertServiceList）

| 任务类型 | Service | 功能 |
|---------|---------|------|
| `CHATROOM_SEND_MSG` | mqttChatService | 群聊发消息（文本/图片/视频/文件） |
| `FRIEND_SEND_MSG` | mqttChatService | 好友发消息 |
| `ADD_CHATROOM_FRIEND` | mqttAddChatroomFriendService | 加群好友 |
| `CHATROOM_KICK_OUT` | mqttKickOutService | 群聊踢人 |
| `CHATROOM_INVITE` | mqttJoinChatroomService | 邀请入群 |
| `LEAVE_CHATROOM` | mqttExitChatroomService | 退出群聊 |
| `DELETE_FRIEND` | mqttDeleteFriendService | 删除好友 |
| `ACCEPT_FRIEND` | mqttFriendPassService | 通过好友申请 |
| `MODIFY_FRIEND_REMARK` | mqttChangeRemarkService | 修改备注 |
| `CHATROOM_UPDATE_NOTICE` | mqttGroupAnnounceService | 修改群公告 |
| `CHATROOM_RENAME` | mqttChatroomNameService | 修改群名 |
| `ACCEPT_CHATROOM_INVITE` | mqttAcceptChatroomInvite | 接受入群邀请 |
| `BATCH_DELETE_FRIEND` | mqttBatchDeleteFriendService | 批量删除好友 |
| `CLEAN_UNREAD_MSG` | mqttCleanUnreadMsg | 清除未读消息 |
| `GET_CONTACT_LABEL_LIST` | mqttGetContactLabelListService | 获取联系人标签 |
| `UPLOAD_USER_LOG` | mqttUploadUserLogService | 上传用户日志 |
| `UPLOAD_MONITOR_INFO` | mqttUploadUserMonitorService | 上传监控信息 |

#### 企业微信任务（WorkWxConvertServiceList）

| 任务类型 | Service | 功能 |
|---------|---------|------|
| 企微发消息 | mqttWorkWxChatService | 支持文本、链接、视频号、语音、文件、图片、视频、小程序、引用消息 |
| 企微加好友 | mqttWorkWxAddFriendByPhoneService | 通过手机号加好友 |
| 企微踢人 | mqttWorkWxKickOutService | 群聊踢人 |
| 企微建群 | mqttWorkWxCreateChatroomService | 创建群聊 |
| 企微改备注 | mqttWorkWxChangeRemarkService | 修改联系人备注 |
| ... | ... | 共约 21 个 Service |

### 5.4 消息发送类型详解

`mqttChatService` 是最复杂的任务处理器，需要根据消息类型做不同处理：

| 消息类型 | 处理逻辑 |
|---------|---------|
| 文本消息 | 直接构造 ClientTaskBO，设置 content 字段 |
| 图片消息 | 下载图片 URL 到本地 → 设置 localpath → 发送 |
| 视频消息 | 下载视频 URL 到本地 → 设置 localpath → 发送 |
| 文件消息 | 下载文件 URL 到本地 → 设置 localpath → 发送 |
| 表情消息 | 提取表情资源 URL → 构造任务 |
| 链接消息 | 构造 XML 格式的链接卡片 → 发送 |
| 名片消息 | 构造名片 XML → 发送 |
| 小程序消息 | 构造小程序消息体 → 发送 |

---

## 六、上行通信：客户端结果上报

### 6.1 上行消息格式

上行消息使用 `ClientMsg` 数据结构：

```
ClientMsg = {
    "username": "wxid_abc123",           // 微信号
    "clientMsgSource": "WIN",            // 消息来源标识
    "type": "TASK_RESULT_MSG",           // 上报类型
    "chatroom": "",                      // 群聊 ID（如适用）
    "javaClientVersion": "1.0.0",        // 版本号
    "createTime": 1710000000000,         // 创建时间
    "currTime": 1710000000000,           // 当前时间
    
    // 以下字段根据 type 有不同的填充：
    "taskInfo": {                        // 任务结果
        "taskId": "task_001",
        "status": 3,                     // 3=成功
        "reason": "",
        "javaClient": "1.0.0"
    },
    "recordInfo": {                      // 消息记录
        "fromUsername": "wxid_abc",
        "toUsernames": "wxid_target",
        "chatroom": "xxx@chatroom",
        "content": "消息内容",
        "wechatMsgType": 1,
        "msgId": "msg_001"
    },
    "robotLoginRecord": {                // 登录记录
        "headimg": "url",
        "nickname": "昵称",
        "sex": 1
    },
    "heartBeatInfo": { ... },            // 心跳信息
    "friendInfos": [ ... ],              // 好友列表
    "chatroomMemberInfoList": [ ... ],   // 群成员列表
    "tagInfoList": [ ... ],              // 标签列表
    "monitorInfoBO": { ... }             // 监控信息
}
```

### 6.2 上行消息类型（PrismRecordType）

| 类型 | 说明 |
|------|------|
| `ROBOT_LOGIN` | 微信登录成功 |
| `ROBOT_LOGIN_FAIL` | 微信登录失败/登出 |
| `CHATROOM_MSG` | 群聊消息记录 |
| `FRIEND_MSG` | 好友消息记录 |
| `TASK_RESULT_MSG` | 任务执行结果 |
| `HEARTBEAT` | 心跳 |
| `LOGIC_WORKING_INFO` | 机器人工作状态 |
| `FRIEND_LIST` | 好友列表 |
| `CHATROOM_MEMBER_LIST` | 群成员列表 |
| `NEW_FRIEND` | 新好友通知 |
| `FRIEND_DELETE` | 好友删除通知 |
| `CHATROOM_UPDATE` | 群信息变更 |
| `TAG_INFO` | 标签信息 |
| `MONITOR_INFO` | 监控信息 |
| `BUG_REPORT` | 错误报告 |
| `MQTT_SEND_TIMEOUT` | MQTT 发送超时 |
| ... | 共约 100+ 种类型 |

### 6.3 上行消息发送流程

```
步骤 1: 业务层构建 ClientMsg
    例如：taskBoost.reportTaskResult()
    构建 ClientMsg，设置 type、taskInfo 等字段

步骤 2: 调用 mqttSend
    mqttSend.sendMessage(username, clientMsg)
    │
    ├─ 补全字段：
    │    clientMsg.clientMsgSource = "WIN"
    │    clientMsg.username = username
    │    clientMsg.javaClientVersion = 版本号
    │    clientMsg.createTime = Date.now()
    │    clientMsg.currTime = Date.now()
    │
    └─ 调用 mqExcuteMsg(username, topic, clientMsg)

步骤 3: 执行发送
    mqExcuteMsg(wxId, topic, clientMsg)
    │
    ├─ 通过 RegistryConfig 获取 registry
    │
    ├─ 如果 registry.mqttClient 不存在：
    │    MqttMakeUpManager.processSaveNotSend(message)
    │    → 缓存到未发送队列
    │    cloudFlowInBound(LOGIN, MQTT_CHECK)
    │    → 触发重新登录/重连检查
    │    return
    │
    ├─ 如果 registry.mqttClient 存在：
    │    payload = Buffer.from(JSON.stringify(clientMsg))
    │    registry.mqttClient.publish(
    │        topic,      // parentTopic，如 "robot-wx-win-pro"
    │        payload
    │    )
    │
    └─ 发送异常时：
         MqttMakeUpManager.processSaveNotSend(message)
         上报 MQTT_SEND_TIMEOUT
```

### 6.4 常见上行场景

**场景一：任务执行成功上报**

```
微信执行发消息成功
    → convert-response/sendTextmsgResponse.js
    → taskBoost.reportTaskResult(taskId, status=3)
    → 构建 ClientMsg { type: TASK_RESULT_MSG, taskInfo: { status: 3 } }
    → mqttSend.sendMessage(wxId, clientMsg)
    → MQTT publish 到 parentTopic
```

**场景二：新消息上报**

```
微信收到新消息
    → convert-boost/sendmsgReport.js
    → 构建 ClientMsg { type: CHATROOM_MSG/FRIEND_MSG, recordInfo: { ... } }
    → mqttSend.sendMessage(wxId, clientMsg)
    → MQTT publish 到 parentTopic
```

**场景三：心跳上报**

```
HeartBeatTimer 定时触发
    → 构建 ClientMsg { type: HEARTBEAT, heartBeatInfo: { ... } }
    → mqttSend.sendMessage(wxId, clientMsg)
    → MQTT publish 到 parentTopic
```

---

## 七、消息补偿机制

### 7.1 未发送消息队列

当 MQTT 连接不可用时，消息不会被丢弃，而是缓存到 `MqttMakeUpManager` 的内存队列中：

```
MqttMakeUpManager = {
    NOT_UPLOAD_MQTT_MESSAGE_QUEUE: [],  // 缓存队列
    MAX_SIZE: 100                       // 最大缓存数量
}
```

**入队逻辑**：
- 当 `mqExcuteMsg` 发现 `registry.mqttClient` 不存在或发送异常时
- 将消息添加到 `NOT_UPLOAD_MQTT_MESSAGE_QUEUE`
- 如果队列已满（100 条），不再缓存新消息（丢弃）

**出队逻辑**（`ProcessMakeUpTaskTimer`，每 10 秒执行）：
- 遍历队列中的消息
- 检查对应微信号的 MQTT 连接是否已恢复
- 如果已恢复，重新发送消息
- 如果消息缓存时间超过 10 分钟，丢弃
- 发送成功后从队列中移除

### 7.2 补偿的局限性

1. **队列上限**：最多 100 条。长时间断网可能导致重要消息丢失。
2. **内存存储**：应用重启后队列清空，未发送的消息永久丢失。
3. **超时丢弃**：10 分钟过期策略可能导致某些场景下的消息丢失。

---

## 八、MQTT 配置管理

### 8.1 静态配置（applicationConfig）

MQTT 相关的配置在 `msg-center/core/application-config/` 中按环境定义：

| 配置项 | 说明 | 生产环境示例 |
|--------|------|-------------|
| `mqtt.instanceId` | 阿里云 MQ 实例 ID | `mqtt-cn-xxx` |
| `mqtt.endPoint` | Broker 地址 | `mqtt-cn-v0h1klv0a02.mqtt.aliyuncs.com` |
| `mqtt.parentTopic` | 上行 Topic | `robot-wx-win-pro` |
| `mqtt.groupId` | 消费组 ID | `GID-win-client-pro` |
| `mqtt.taskIssuedTopic` | 下行 Topic | `robot-wx-win-issued-pro` |
| `mqtt.expiration.url` | 鉴权 URL | `https://api.umeng100.com/uqun/token/aly/open/access` |

### 8.2 动态配置（Apollo）

部分 MQTT 配置可通过 Apollo 配置中心动态调整：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `client.wxzs.mqtt.task.expire.hours` | 任务消息过期时间（小时） | 3 |
| `client.wxzs.taskFailWaitTime` | 任务失败等待时间（毫秒） | - |
| `client.wxzs.taskDefaultWaitTime` | 任务默认等待时间（毫秒） | - |

动态配置通过 `GetCloudConfigTimer` 定时从 Apollo 获取并更新。

---

## 九、MQTT 与其他通信机制的协作

### 9.1 MQTT ↔ 逆向 IPC

**下行方向**：MQTT 接收到云端任务 → task-mqtt Service 处理 → `cloudFlowInBound` → `dispatchInBound` → `reverseSend` → Named Pipe 发往微信

**上行方向**：微信通过 Named Pipe 返回结果 → `dispatchOutBound` → `cloudFlowOutBound` → convert-service/response/boost → `mqttSend` → MQTT publish 到云端

### 9.2 MQTT ↔ WebSocket

**状态查询**：前端通过 WebSocket 发送 `getMqttStatus` → `GetMqttConnectionStatusTask` 查询各微信号的 MQTT 连接状态 → 通过 WebSocket 返回

**间接协作**：前端发起的任务执行后，结果会同时推送到前端（WebSocket）和云端（MQTT）

### 9.3 MQTT ↔ HTTP

**鉴权**：MQTT 连接前通过 HTTP 获取 accessKey/secretKey
**配置**：通过 HTTP 从 Apollo 获取 MQTT 相关配置
**数据同步**：某些数据同时通过 HTTP 和 MQTT 上报（如好友列表通过 HTTP 同步，变更通过 MQTT 通知）

---

## 十、错误处理与容错

### 10.1 连接级错误

| 错误场景 | 处理方式 |
|---------|---------|
| 连接超时（5 秒） | 记录日志，等待 PingTimer 重试 |
| 鉴权失败 | 记录日志，重新获取鉴权令牌后重连 |
| Broker 不可达 | 记录日志，上报告警，等待 PingTimer 重试 |
| 连接被 Broker 断开 | `close` 事件触发，记录日志，PingTimer 重连 |
| clientId 冲突 | Broker 会断开旧连接（同一 clientId 只允许一个连接） |

### 10.2 消息级错误

| 错误场景 | 处理方式 |
|---------|---------|
| JSON 解析失败 | 记录日志，丢弃消息 |
| 重复消息 | `mqttTaskMapLock` 去重，丢弃 |
| 消息过期 | 上报 `TASK_RESULT_MSG`（状态：超时），丢弃 |
| 任务类型未知 | 记录日志，丢弃 |
| 发送失败 | 缓存到 `MqttMakeUpManager`，定时补发 |

### 10.3 告警机制

`common/notify.js` 中定义了 MQTT 相关的告警：

| 告警场景 | 告警方式 | 说明 |
|---------|---------|------|
| MQTT 频繁断开 | 灵犀告警 | 短时间内多次 `close` 事件 |
| Pong 超时 | 灵犀告警 | Named Pipe 心跳超时（间接影响 MQTT） |
| 发送超时 | 日志上报 | `MQTT_SEND_TIMEOUT` 指标 |

---

## 十一、性能与优化

### 11.1 消息吞吐量

上行消息量主要取决于：
- 在线微信号数量
- 每个微信号的消息活跃度
- 定时上报频率（心跳、状态）

下行消息量取决于：
- 云端下发的任务频率

由于使用阿里云托管 Broker，吞吐量受限于阿里云 MQ 实例的配额。

### 11.2 消息大小

大多数 MQTT 消息在几百字节到几 KB 之间。最大的消息可能是：
- 好友列表上报（包含所有好友信息）
- 群成员列表上报

MQTT 协议本身支持最大 256MB 的消息，但阿里云 MQ 可能有自己的限制（通常 64KB）。大消息建议拆分或通过 HTTP 上传。

### 11.3 QoS 选择

- 下行订阅使用 QoS 1（至少一次），配合客户端去重
- 上行发布未显式指定 QoS，默认 QoS 0（最多一次）

建议关键上行消息（如任务结果）也使用 QoS 1，确保投递可靠性。

---

## 十二、调试方法

### 12.1 日志排查

在主进程日志中搜索以下关键字：

| 关键字 | 说明 |
|--------|------|
| `mqttClientBase` | MQTT 客户端事件（connect、message、close、error） |
| `mqttHelper` | 连接建立流程 |
| `mqExcuteMsg` | 消息发送 |
| `mqttSend` | 上行消息构建 |
| `MqttMakeUpManager` | 消息补偿 |
| `PingTimer` | 连接检测与重连 |
| `task-mqtt` | 任务处理 |
| `MQTT_SEND_TIMEOUT` | 发送超时 |

### 12.2 前端查询 MQTT 状态

通过 WebSocket 发送 `{ cmdId: 'getMqttStatus' }`，可以查看各微信号的 MQTT 连接状态。

### 12.3 测试脚本

项目提供了 MQTT 测试脚本：

| 文件 | 用途 |
|------|------|
| `src/test/mqtt/consumer.js` | 本地 MQTT 消费者测试 |
| `src/test/mqtt/consumerTest1.js` | 消费者测试变体 |
| `src/test/mqtt/porducer.js` | 本地 MQTT 生产者测试 |
| `src/test/mqtt-test.js` | 接近生产环境的连接测试 |

本地测试使用 `mqtt://localhost:1883`，需要先启动本地 MQTT Broker（如 Mosquitto）。

### 12.4 常见问题排查

**问题：MQTT 连接失败**
- 检查鉴权 URL 是否可达
- 检查 accessKey/secretKey 是否有效
- 检查 clientId 格式是否正确
- 检查网络是否能访问 Broker 地址

**问题：消息发送失败**
- 检查 `registry.mqttClient` 是否存在
- 检查 `mqttClient.connected` 是否为 true
- 查看 `MqttMakeUpManager` 队列中是否有积压消息

**问题：任务未执行**
- 检查任务是否过期（createTime 超过 3 小时）
- 检查任务是否被去重（`mqttTaskMapLock`）
- 检查任务类型是否在 ServiceList 中有对应处理器
- 检查逆向 IPC 是否正常（Named Pipe 连接状态）

---

## 十三、总结

MQTT 是 galaxy-client 与云端服务之间的核心异步通信通道。它基于阿里云 MQ for MQTT 服务，使用 P2P 消息实现对特定微信号的精确任务下发。

**核心特征**：
- 每个微信号独立一个 MQTT 连接（延迟初始化，登录后才建立）
- HMAC-SHA1 签名鉴权，通过 HTTP 获取凭证
- P2P Topic 精确投递，QoS 1 保证至少一次投递
- 禁用自动重连，由 PingTimer 手动管理重连
- 消息补偿机制（MqttMakeUpManager）处理发送失败
- 约 42 个任务处理器覆盖微信和企微的各种业务场景

**在通信架构中的位置**：
- 下行：云端 → MQTT → task-mqtt → 逆向 IPC → 微信
- 上行：微信 → 逆向 IPC → convert → MQTT → 云端
