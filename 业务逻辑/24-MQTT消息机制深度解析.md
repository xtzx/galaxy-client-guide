# 24-MQTT 消息机制深度解析

> 从协议原理到 Galaxy-Client 实现：QoS、ACK、持久会话、重连补发、去重、过期、延迟队列的完整知识体系

---

## 一、本项目 MQTT 的两套 ACK 机制

Galaxy-Client 中存在**两套完全独立**的确认机制，解决不同层次的问题，混淆它们是所有排查困难的根源。

### 1.1 机制对比总览

```
┌─────────────────────────────────────────────────────────────────────┐
│  第一套：MQTT 协议级 ACK（自动、立即、不可控）                       │
│                                                                     │
│  Broker 发消息 → mqtt 库收到 → 自动发 PUBACK → Broker 删消息       │
│  整个过程在 mqtt.js 库内部完成，业务代码无感知                       │
│  ⏱️ 毫秒级，不等待任何业务逻辑                                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  第二套：业务级回执（手动、异步、分钟级）                             │
│                                                                     │
│  客户端发任务给逆向 → 逆向执行 → 三段式回执收齐                     │
│  → baseConvertResponse.wkTaskResponse()                             │
│  → MqttSendService.sendMessage() → MQTT publish 给云端              │
│  ⏱️ 秒~分钟级，取决于逆向执行速度                                   │
└─────────────────────────────────────────────────────────────────────┘
```

| 维度 | 协议级 ACK (PUBACK) | 业务级回执 (wkTaskResponse) |
|------|---------------------|---------------------------|
| 谁发 | `mqtt.js` 库自动 | 应用代码手动调用 |
| 发给谁 | MQTT Broker | 云端业务服务器 |
| 含义 | "我收到这条消息了" | "我执行完这个任务了" |
| 时机 | 收到消息立即 | 三段式回执收齐后 |
| 失败后果 | Broker 重新投递消息 | 云端可能重新下发任务 |
| 代码位置 | `mqtt.js` 库内部 | `baseConvertResponse.js` L492-L541 |

### 1.2 为什么需要两套？

```
场景：Broker 投递消息，客户端收到但任务执行失败

仅有第一套：Broker 认为已投递完成删除消息，但任务实际未完成 → 任务丢失
仅有第二套：Broker 不知道客户端是否收到消息，可能无限重试 → 永远重复

两套配合：
  第一套保证"消息到达客户端"（网络层可靠）
  第二套保证"任务执行完成"（业务层可靠）
```

---

## 二、MQTT QoS 深度解析

### 2.1 三种 QoS 级别

| QoS | 名称 | 投递保证 | 机制 | 适用场景 |
|-----|------|---------|------|---------|
| 0 | 最多一次 | 可能丢失 | 发了就忘 | 传感器数据（丢一条无所谓） |
| **1** | **至少一次** | **不丢但可能重复** | **PUBACK 确认** | **本项目使用** |
| 2 | 恰好一次 | 不丢不重复 | 四次握手 | 金融交易（但性能差） |

### 2.2 QoS 1 的完整交互流程

```
正常流程：
┌─────────┐                     ┌─────────┐
│  Broker  │                     │ Client  │
└────┬─────┘                     └────┬────┘
     │                                │
     │── PUBLISH (QoS=1, msgId=42) ──►│  ← Broker 发送消息
     │                                │
     │                                │  mqtt 库收到消息
     │                                │  ↓ 触发 client.on("message")
     │                                │  ↓ 同时：
     │◄── PUBACK (msgId=42) ──────────│  ← mqtt 库自动发 PUBACK
     │                                │
     │  Broker 收到 PUBACK            │  业务代码开始处理消息
     │  ↓ 从队列删除该消息             │  （去重、过期检查、执行任务……）
     │                                │
```

```
异常流程（PUBACK 未到达 Broker）：
┌─────────┐                     ┌─────────┐
│  Broker  │                     │ Client  │
└────┬─────┘                     └────┬────┘
     │                                │
     │── PUBLISH (QoS=1, msgId=42) ──►│
     │                                │  mqtt 库收到消息
     │◄── PUBACK (msgId=42) ────── ✕ ──│  ← TCP 连接在 PUBACK 到达前断开
     │                                │
     │  Broker 未收到 PUBACK          │  客户端掉线
     │  ↓ 消息保留在队列               │
     │                                │
     │  ......等待客户端重连......      │
     │                                │
     │── PUBLISH (QoS=1, msgId=42) ──►│  ← 重连后再次投递（DUP=1）
     │                                │
     │◄── PUBACK (msgId=42) ──────────│  ← 这次成功
     │                                │
```

### 2.3 本项目的 QoS 配置

```javascript
// mqttHelper.js L183 - 订阅时设置 QoS
const qos = [1, 1];

// mqttClientBase.js L360 - subscribe 时传入
client.subscribe(filterTopics, { qos: 1 }, ...)
```

QoS 1 保证**每条消息至少到达一次**，但可能重复到达——这是"同一个 taskId 收到多次"的根本原因。

---

## 三、持久会话 (Persistent Session) 机制

### 3.1 clean 参数的含义

```javascript
// mqttHelper.js L146
let options = {
    clean: false,    // ← 关键配置
};
```

| `clean` 值 | 含义 | 重连时行为 |
|-----------|------|---------|
| `true` | 临时会话 | 重连后 Broker 不保留任何状态，未确认的消息丢失 |
| **`false`** | **持久会话** | **重连后 Broker 恢复订阅 + 投递所有未确认的离线消息** |

### 3.2 持久会话下 Broker 保存什么？

```
客户端断线后，Broker 保存的内容：
┌─────────────────────────────────────────────────────┐
│  Session Store (按 clientId 存储)                     │
│                                                      │
│  1. 订阅列表：topic + QoS                            │
│  2. 未确认的 QoS 1/2 消息队列                         │
│  3. 客户端离线期间收到的新消息（匹配订阅的 topic）      │
│                                                      │
│  保留期限：取决于 Broker 配置                          │
│  (阿里云 MQTT 默认保留 7 天)                          │
└─────────────────────────────────────────────────────┘
```

### 3.3 本项目的 clientId 构成

```javascript
// mqttHelper.js L177
const clientId = groupId + CLINKID_CONNECTOR + wxId;
// 结果：GID_xxx@@@wxid_1688855216739728
```

**同一个 wxId 始终使用同一个 clientId**，确保 Broker 能匹配到之前的持久会话。

### 3.4 持久会话带来的"消息洪泛"

这是我们在日志中观察到的核心现象：

```
时间线：
Feb 27 22:23  后端发了一条消息
Feb 27 22:xx  客户端 MQTT 断线
              ↓ Broker 缓存这条消息 + 后续所有新消息
              ↓ 18 小时持续累积
Feb 28 15:49  客户端重连
              ↓ Broker 一次性投递 368 条积压消息
              ↓ 40 秒内全部到达
```

**真实日志数据验证**：

| 指标 | 数据 |
|------|------|
| 总积压消息 | 368 条 |
| createTime 跨度 | 18 小时（昨晚 21:32 ~ 当天 15:34）|
| 投递耗时 | 约 40 秒（15:49:20 ~ 15:49:57）|
| mqttTaskMapLock 峰值 | 328 条同时在锁中 |
| 其中过期消息 | 322 条（超 3 小时自动丢弃）|
| 有效消息 | 46 条 |

---

## 四、PUBACK 丢失与重复投递的深层机制

### 4.1 为什么"自动 ACK"仍然会导致重复？

```
mqtt 库的 ACK 流程（mqtt.js 源码层面）：

1. 收到 PUBLISH 包
2. 触发 client.on("message", handler)
3. 在 handler 调用之前或同时，将 PUBACK 写入 TCP 写缓冲区
4. 操作系统异步发送 TCP 数据

问题出在步骤 4：
- "写入缓冲区" ≠ "对方收到"
- 如果 TCP 连接在步骤 4 之前或期间断开
  → PUBACK 包还在本地缓冲区就被丢弃了
  → Broker 永远收不到这个 PUBACK
  → 下次重连时 Broker 重新投递
```

### 4.2 真实案例证据

```
后端服务器日志：MQBaseProducer 只发了 1 次
  → Feb 27 22:23:45 send msg {"id":"1265071790997111025",...}

客户端阿里云日志：收到 3 次
  → Feb 28 14:14:07  [接收mqtt任务] taskId= 1265071790997111025
  → Feb 28 15:18:14  [接收mqtt任务] taskId= 1265071790997111025
  → Feb 28 15:50:xx  [接收mqtt任务] taskId= 1265071790997111025

结论：后端 1 次 → Broker 投递 3 次
  第1次 14:14 → PUBACK 未到达 Broker（连接断了）
  第2次 15:18 → PUBACK 未到达 Broker（连接又断了）
  第3次 15:50 → PUBACK 成功到达 Broker（连接稳定了）
```

### 4.3 连接不稳定的根因

```javascript
// mqttClientBase.js L328
connectionOptions.reconnectPeriod = 0;  // ← 禁用自动重连
```

手动管理重连意味着：
- 断线后不会立即重连
- 重连依赖外部触发（心跳超时检测、登录验证等）
- 重连间隔可能长达几十分钟甚至数小时
- 每次重连后 Broker 补发积压消息，如果连接很快又断 → 恶性循环

---

## 五、客户端防护机制详解

### 5.1 过期检查

```javascript
// mqttClientBase.js L396-L404
const expireHours = apolloConfig.mqttTaskExpireHours || 3;  // 默认 3 小时
const expireTime = expireHours * 60 * 60 * 1000;

if (dataInfo.createTime * 1000 < Date.now() - expireTime) {
    logUtil.customLog(`[wxid-${wxId}] taskId=${receiveId}, 消息过期（${expireHours}小时），直接终止处理`, {
        level: "warn",
    });
    return;  // 直接丢弃，不执行
}
```

**配置**：Apollo 远程配置 `mqttTaskExpireHours`，默认 3 小时

**注意**：过期检查**在去重检查之前**，但**在打日志之后**。过期消息仍然会进入 `mqttTaskMapLock`，浪费内存。

### 5.2 去重锁 (mqttTaskMapLock)

```javascript
// mqttClientBase.js L146, L406-L424
let mqttTaskMapLock = new Map();  // 全局去重锁

// 去重检查
if (receiveId && mqttTaskMapLock.has(receiveId)) {
    logUtil.customLog(`[wxid-${wxId}] taskId=${receiveId}, 消息重复，直接终止处理`, {
        level: "warn",
    });
    return;  // 丢弃重复消息
} else if (receiveId) {
    mqttTaskMapLock.set(receiveId, {
        wxId: wxId,
        timestamp: Date.now(),
        processed: true
    });
    startCleanupTimerIfNeeded();  // 启动定期清理
}
```

**去重锁的生命周期**：

| 特性 | 值 |
|------|---|
| 存储位置 | 内存（Map） |
| 清理机制 | 定时器定期扫描过期条目 |
| 重启后 | **丢失**（非持久化） |
| 峰值容量 | 实测最高 328 条 |

**已知缺陷**：
- 纯内存存储，进程重启后去重能力丢失
- 过期清理后，同一 taskId 再次到来会被当作新消息
- 这正是"间隔 1 小时收到 3 次"的原因——每次重连时，锁可能已被清理

### 5.3 延迟队列 (TaskQueue)

```javascript
// mqTask.js
class TaskQueue {
    constructor() {
        this.queues = new Map();          // 按 wxId 分组
        this.lastExecutionTimes = new Map();
    }

    async runNextTask(wxId) {
        const timeSinceLastExecution = now - lastExecutionTime;
        if (timeSinceLastExecution < apolloConfig.taskDefaultWaitTime) {
            // 间隔不足，等待
            await new Promise(resolve => setTimeout(resolve,
                apolloConfig.taskDefaultWaitTime - timeSinceLastExecution));
        }
        const task = queue.shift();
        await task();  // 顺序执行
    }
}
```

**配置**：`taskDefaultWaitTime = 200ms`（Apollo 远程配置）

**效果**：同一 wxId 的任务间至少间隔 200ms

**计算**：46 条有效任务 × 200ms = 至少 9.2 秒才能全部执行完

---

## 六、消息处理完整链路（MQTT 接收到最终执行）

### 6.1 完整流程图

```
MQTT Broker
    │
    │ PUBLISH (QoS 1)
    ▼
┌─ mqttClientBase.js ──────────────────────────────────────────────────┐
│                                                                      │
│  ① client.on("message")                                             │
│     ↓ mqtt 库自动发 PUBACK（不等待业务逻辑）                          │
│                                                                      │
│  ② 日志：[接收mqtt任务] [messageType-xxx] taskId= xxx                │
│     （最早的入口日志，无论后续是否丢弃都有此日志）                     │
│                                                                      │
│  ③ 过期检查                                                          │
│     createTime 距今 > 3h → return（日志：消息过期）                   │
│                                                                      │
│  ④ 去重检查                                                          │
│     mqttTaskMapLock.has(taskId) → return（日志：消息重复）            │
│     否则加入锁                                                       │
│                                                                      │
│  ⑤ JSON 格式检查                                                     │
│     以 { 开头、以 } 结尾                                              │
│                                                                      │
│  ⑥ 日志：[mqttClientBase]:MQTT收到消息，msgId: xxx                   │
│                                                                      │
│  ⑦ 根据 type 路由                                                    │
│     type=100 → executeWithDelay（延迟队列）                           │
│     其他    → 随机延迟 0-1s 后直接 execute                            │
│                                                                      │
│  ⑧ execute() → runTask()                                            │
│     根据 registry.workWx 判断企微/个微                               │
│     遍历 ConvertServiceList，filter() 匹配 → operate() 执行         │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
    │
    │ 以企微群发消息 (type=100) 为例
    ▼
┌─ mqttWorkWxChatService.js ───────────────────────────────────────────┐
│                                                                      │
│  ⑨ 日志：work-wx-friend-chat - serverTask=[...]                     │
│     构建客户端任务 BO                                                │
│                                                                      │
│  ⑩ 调用 cloudFlowInBound(null, wxId, JSON.stringify(clientTaskBO))   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─ cloudFlowInBound.js ───────────────────────────────────────────────┐
│                                                                      │
│  ⑪ 日志：[CloudFlowHandler]:inBound, wxId=xxx                       │
│     添加 flowSource = CLOUND（标记来源为云端）                        │
│     调用 dispatchInBound()                                           │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─ dispatchInBound.js → reverseSend.js ───────────────────────────────┐
│                                                                      │
│  ⑫ 日志：[DispatchCenter]:下任务时往缓存里放任务                     │
│     三段式缓存记录 taskId + 状态                                     │
│                                                                      │
│  ⑬ 日志：[发送消息给逆向] wxid: [...] type=[sendmsg_xxx]            │
│     写入 IPC 管道 → 逆向 DLL                                        │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
    │
    │ IPC 管道
    ▼
┌─ 逆向 DLL ──────────────────────────────────────────────────────────┐
│                                                                      │
│  执行实际操作（发微信消息、操作群等）                                 │
│  返回三段式回执                                                      │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
    │
    │ IPC 管道返回
    ▼
┌─ msgHandleBase.js ──────────────────────────────────────────────────┐
│                                                                      │
│  收集三段式消息（第一条 → 第二条 → 第三条）                          │
│  第三条到达后触发 thirdMsgHandler()                                  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─ cloudFlowOutBound.js → wkFriendChatResponse.js ────────────────────┐
│                                                                      │
│  ⑭ wkTaskResponse()                                                 │
│     构建业务回执 BO                                                  │
│     MqttSendService.sendMessage(ownerWxId, clientMsgCloud)           │
│     日志：[MQTT发往云端数据成功]                                     │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 6.2 每个节点的日志关键字和阿里云查询方式

| 节点 | 日志关键字 | 阿里云查询 |
|------|-----------|----------|
| ② 最早入口 | `[接收mqtt任务]` | `"用户名" and "[接收mqtt任务]"` |
| ③ 过期丢弃 | `消息过期` | `"用户名" and "消息过期"` |
| ④ 去重丢弃 | `消息重复` | `"用户名" and "消息重复"` |
| ⑥ 通过检查 | `[mqttClientBase]:MQTT收到消息` | `"用户名" and "mqttClientBase" and "MQTT收到消息"` |
| ⑧ execute 后 | `[开始处理任务1]` | `"用户名" and "开始处理任务1"` |
| ⑨ 企微服务 | `work-wx-friend-chat` | `"用户名" and "work-wx-friend-chat"` |
| ⑪ cloudFlow | `[CloudFlowHandler]:inBound` | `"用户名" and "CloudFlowHandler" and "inBound"` |
| ⑫ 缓存入队 | `下任务时往缓存里放任务` | `"用户名" and "下任务时往缓存"` |
| ⑬ 发给逆向 | `[发送消息给逆向]` | `"用户名" and "发送消息给逆向"` |
| 超时监控 | `任务超时id` | `"用户名" and 任务超时id` |
| ⑭ 回执上报 | `MQTT发往云端数据成功` | `"用户名" and "MQTT发往云端数据成功"` |

---

## 七、重复消息问题的根因分析

### 7.1 两种重复的区别

| | MQTT Broker 补发 | 后端业务重发 |
|--|--|--|
| 原因 | QoS 1 PUBACK 未到达 Broker | 业务回执超时，云端认为任务未完成 |
| 后端日志 | `MQBaseProducer send msg` **只有 1 条** | **有多条** send msg |
| 客户端 taskId | **完全相同** | **完全相同**（同一业务任务） |
| 时间间隔 | 取决于重连时机（几分钟~几小时） | 取决于云端重试策略（通常 1 小时） |
| 判断方法 | 对比后端 Producer 日志和客户端接收日志 | 后端有多条发送记录 |

### 7.2 如何判断是哪种重复？

```
排查步骤：

第一步：查客户端接收次数
  "用户名" and "[接收mqtt任务]" and taskId前缀*

第二步：查后端发送次数
  在后端日志平台查询 MQBaseProducer send msg {"id":"taskId的值"...}

第三步：对比
  后端 1 条，客户端 N 条 → MQTT Broker 补发（连接不稳定）
  后端 N 条，客户端 N 条 → 后端业务重发（业务回执超时）
```

### 7.3 真实案例

#### 案例：`huanglimin02` 的 taskId `1265071790997111025`

| 来源 | 时间 | 次数 |
|------|------|------|
| 后端 Producer | Feb 27 22:23:45 | **1 次** |
| 客户端接收 | Feb 28 14:14 / 15:18 / 15:50 | **3 次** |

**结论**：MQTT Broker QoS 1 补发。客户端 MQTT 连接不稳定，PUBACK 未到达 Broker。

#### 日志中 mqttTaskMapLock 的变化验证

```
第1次 14:14 → mqttTaskMapLock 设置锁
第2次 15:18 → 距第1次 64 分钟，锁可能已被清理定时器删除
             → 当作新消息处理（任务已过期，被过期检查拦截）
第3次 15:50 → 距第2次 32 分钟，锁可能又被清理
             → 当作新消息处理
```

---

## 八、消息类型速查表

### 8.1 MQTT 任务 type 与 wechatMsgType 对照

| `type` | 含义 | 处理方式 |
|--------|------|---------|
| `100` | **群发消息**（企微私聊/群聊） | `executeWithDelay` 延迟队列 |
| 其他 | 非群发任务 | 随机 0-1s 延迟后直接执行 |

| `wechatMsgType` | 消息内容类型 | 逆向指令 |
|----------------|------------|---------|
| `1` | 纯文本 | `sendmsg_sendtext` |
| `3` | 图片 | `sendmsg_sendpic` |
| `43` | 视频 | `sendmsg_sendvideo` |
| `49` | 链接/小程序 | `sendmsg_sendapplet` |
| `68` | 企微小程序 | `sendmsg_sendapplet` |
| `69` | 视频号 (finder) | `sendmsg_sendfinder` |
| `602` | 企微小程序卡片 | `sendmsg_sendapplet` |

---

## 九、MQTT 连接管理与重连策略

### 9.1 当前连接配置

```javascript
// mqttHelper.js
const options = {
    username: `Signature|${accessKey}|${instanceId}`,
    clientId: `${groupId}@@@${wxId}`,
    connectTimeout: 5000,     // 连接超时 5 秒
    clean: false,             // 持久会话
};

// mqttClientBase.js
connectionOptions.reconnectPeriod = 0;  // 禁用自动重连
```

### 9.2 连接生命周期事件

```javascript
// mqttClientBase.js 事件处理
client.on("connect",   () => { /* 订阅 topic */ });
client.on("message",   () => { /* 消息处理 */ });
client.on("error",     () => { /* 清理连接 */ });
client.on("close",     () => { /* 通知、清理 */ });
client.on("reconnect", () => { /* 日志记录 */ });
client.on("offline",   () => { /* 日志记录 */ });
```

### 9.3 重连触发点

由于 `reconnectPeriod = 0`（禁用自动重连），重连依赖以下外部触发：

| 触发来源 | 代码位置 | 场景 |
|---------|---------|------|
| 心跳超时检测 | `HeartBeatTimer.js` | 定期检查连接状态 |
| 登录验证流程 | `mqExcuteMsg.js` L108 | MQTT 客户端为 null 时触发 |
| 手动重连 | 前端操作 | 用户手动点击 |

---

## 十、MQTT 补发管理器 (MakeUp Manager)

### 10.1 作用

当 MQTT 发送失败时（publish 到云端），消息会被保存到本地，等待连接恢复后重发。

```javascript
// mqExcuteMsg.js L96
MqttMakeUpManager.processSaveNotSend(wxId, msgObj);
```

```
文件位置：src/msg-center/core/mq/mqttMakeUpManager.js
定时器：ProcessMakeUpTaskTimer.js

流程：
  MqttSendService.sendMessage() 失败
  → MqttMakeUpManager.processSaveNotSend() 保存到本地
  → ProcessMakeUpTaskTimer 定期扫描
  → 连接恢复后重新 publish
```

---

## 十一、已知问题与优化建议

### 11.1 当前问题清单

| # | 问题 | 影响 | 严重程度 |
|---|------|------|---------|
| 1 | `mqttTaskMapLock` 内存存储，清理后同一 taskId 可被重复处理 | 消息重复执行 | ⚠️ 高 |
| 2 | `clean: false` + 连接不稳定 → Broker 积压大量消息 | 重连时消息洪泛 | ⚠️ 高 |
| 3 | 过期消息仍进入去重锁，浪费内存 | 峰值 328 条，实际有效仅 46 条 | 中 |
| 4 | `reconnectPeriod = 0`，重连不及时 | PUBACK 窗口期长，补发概率高 | ⚠️ 高 |
| 5 | 延迟队列无长度上限 | 极端情况下内存不可控 | 低 |
| 6 | 重连时无汇总日志 | 排查时需逐条分析 | 低 |

### 11.2 优化建议

```javascript
// 优化1：过期检查前置到去重检查之前（减少无效锁占用）
// 当前顺序：入口日志 → 过期检查 → 去重检查
// 建议顺序：入口日志 → 过期检查（直接return）→ 去重检查

// 优化2：去重锁持久化到 SQLite
// 进程重启或锁清理后仍可防重
const DEDUP_EXPIRE_HOURS = 24; // 持久化去重有效期

// 优化3：重连时打批量汇总日志
logUtil.customLog(`[MQTT重连] 积压: ${total}条, 过期: ${expired}条, 有效: ${valid}条, 重复: ${dup}条`);

// 优化4：启用自动重连（减少 PUBACK 丢失窗口）
connectionOptions.reconnectPeriod = 5000; // 5秒自动重连

// 优化5：延迟队列加长度上限告警
if (queue.length > 100) {
    logUtil.customLog(`[${wxId}] [TaskQueue] 队列积压过多: ${queue.length}`, {level: 'error'});
}
```

---

## 十二、排查速查表

### 12.1 "消息重复发送"排查

```
① 查客户端收到几次
   "用户名" and "[接收mqtt任务]" and taskId前缀*

② 查后端发了几次
   后端日志查询 MQBaseProducer send msg + taskId

③ 判断类型
   后端1次 客户端N次 → Broker QoS 1 补发
   后端N次 客户端N次 → 后端业务重发

④ 查去重是否生效
   "用户名" and "消息重复" and taskId前缀*

⑤ 查过期是否生效
   "用户名" and "消息过期" and taskId前缀*
```

### 12.2 "MQTT 断线"排查

```
① 查心跳日志（每 10s 一次）
   "用户名" and "HeartBeatTimer"
   → 心跳中断的时间段 = MQTT 断线时间段

② 查重连日志
   "用户名" and "mqttClientBase" and "mqtt init"

③ 查连接事件
   "用户名" and ("handleConnect" or "handleReconnectMqtt" or "handleClose")
```

### 12.3 "任务未执行"排查

```
① 确认是否收到
   "用户名" and "[接收mqtt任务]" and taskId前缀*

② 确认是否过期
   "用户名" and "消息过期" and taskId前缀*

③ 确认是否发给逆向
   "用户名" and "发送消息给逆向" and taskId前缀*

④ 确认是否超时
   "用户名" and 任务超时id and taskId前缀*

⑤ 确认是否上报
   "用户名" and "MQTT发往云端数据成功" and taskId前缀*
```

---

## 十三、相关文档

| 文档 | 内容 | 关系 |
|------|------|------|
| [04-MQTT消息队列](../技术点/04-MQTT消息队列.md) | MQTT 基础概念、连接配置、代码结构 | 基础知识 |
| [11-MQTT业务场景详解](./11-MQTT业务场景详解.md) | 所有业务场景分类、任务类型码 | 业务层面 |
| [23-企微群发消息排查指南](./23-企微群发消息排查指南.md) | 群发消息链路、重复发送分析、真实案例 | 排查实践 |
| [21-IPC双向通信架构详解](./21-IPC双向通信架构详解.md) | IPC 管道通信机制 | 下游通信 |
| [06-任务回执机制](./06-任务回执机制.md) | 三段式回执机制 | 业务回执 |
| [阿里云日志 §1.7](../阿里云日志查询指南/12-常见问题与解决方案.md) | 超长 taskId 查询问题 | 日志查询 |
