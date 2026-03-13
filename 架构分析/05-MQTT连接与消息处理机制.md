# 05 MQTT连接与消息处理机制

> **适用仓库**：`galaxy-client`（Electron 主进程端）  
> **文档目标**：从获取 token 到消息落地，完整 MQTT 生命周期。  
> **核心目录**：`src/msg-center/core/mq/`

---

## 一、MQTT 在整体架构中的定位

### 1.1 角色定义

MQTT 在 galaxy-client 中扮演**双向通信通道**：

| 方向 | 用途 | 示例 |
|------|------|------|
| **云端→客户端**（下行） | 接收云端下发的控制任务 | 群发消息、加好友、拉群等指令 |
| **客户端→云端**（上行） | 上报执行结果和状态 | 任务完成、失败、微信状态变更 |

### 1.2 在数据流中的位置

```
┌───────────────────────────────────────────────────────────────────┐
│                        云端服务（阿里云 MQTT）                       │
│                                                                   │
│  Topic: robot-wx-win-issued-test01/p2p/GID-win-client-test-01@@@wxid│
└────────────────┬──────────────────────────────┬───────────────────┘
                 │ subscribe（下行）              │ publish（上行）
                 ▼                              ▲
┌────────────────────────────────────────────────────────────────────┐
│              galaxy-client 主进程                                    │
│                                                                    │
│  ┌────────────────┐                    ┌────────────────────┐      │
│  │ mqttClientBase  │    下行链路:       │ mqExcuteMsg        │      │
│  │ (接收 MQTT 消息) │───▶ execute() ──▶│ (发送 MQTT 上报)    │      │
│  └────────────────┘    ↓               └────────────────────┘      │
│                    runTask()                    ▲                   │
│                    ↓                           │                   │
│              dispatchInBound()           dispatchOutBound()         │
│                    ↓                           ↑                   │
│              reverseSend()              asyncSelectTask()           │
│                    ↓                           ↑                   │
│              ┌─────────────────────────────────┐                   │
│              │     微信/企微进程 (Named Pipe)    │                   │
│              └─────────────────────────────────┘                   │
└────────────────────────────────────────────────────────────────────┘
```

---

## 二、MQTT 配置常量

**文件路径**：`galaxy-client/src/msg-center/core/mq/mqttConfig.js`

```javascript
module.exports = {
    P2P_TOPIC: '/p2p/',
    ACCESS_URL: applicationConfig['mqtt.expiration.url'],
    groupId: applicationConfig['groupId'],
    taskIssuedTopic: applicationConfig['taskIssuedTopic'],
    CLINKID_CONNECTOR: '@@@',
    instanceId: applicationConfig['instanceId'],
    endPoint: applicationConfig['endPoint'],
    ACCOUNT: applicationConfig['mqtt.expiration.account'],
};
```

### 2.1 各环境配置值

| 配置项 | 测试环境（QA） | 生产环境（Prod） | 说明 |
|--------|---------------|-----------------|------|
| `instanceId` | `mqtt-cn-v0h1klv0a02` | （生产实例 ID） | 阿里云 MQTT 实例 |
| `endPoint` | `mqtt-cn-v0h1klv0a02.mqtt.aliyuncs.com` | （生产端点） | MQTT Broker 地址 |
| `groupId` | `GID-win-client-test-01` | （生产 Group ID） | 消费者组 |
| `taskIssuedTopic` | `robot-wx-win-issued-test01` | （生产 Topic） | 任务下发 Topic |
| `mqtt.expiration.url` | `https://test-api.umeng100.com/uqun/token/aly/open/access` | （生产 URL） | Token 获取地址 |
| `mqtt.expiration.account` | `uqun-tech-new` | 同 | 接入账号 |

### 2.2 P2P Topic 格式

```
{taskIssuedTopic}/p2p/{groupId}@@@{wxId}
```

示例：
```
robot-wx-win-issued-test01/p2p/GID-win-client-test-01@@@wxid_xxxxxx
```

每个微信账号订阅自己的 P2P Topic，确保消息精准投递。

### 2.3 配置来源

配置通过 `application-config/index.js` 根据环境加载：

```javascript
// src/msg-center/core/application-config/index.js
let env = process.env.ELECTRON_NODE_ENV || type;

if (env === 'dev')       application = { ...applicationRd };
else if (env === 'prod') application = { ...applicationProd };
else                     application = { ...applicationQa };
```

---

## 三、MQTT 连接流程 — mqttHelper.js

**文件路径**：`galaxy-client/src/msg-center/core/mq/mqttHelper.js`  
**总行数**：141 行

### 3.1 连接入口

```javascript
exports.connectMqtt = async ({ wxId, onRecieveMsg }) => {
    await lock.acquire(`loginLock-${wxId}`, async (done) => {
        // ① 获取阿里云 MQTT access token
        let { accessKey, secretKey } = await getMqttAccess(wxId);
        
        // ② 构造 clientId
        const clientId = groupId + CLINKID_CONNECTOR + wxId;
        // 例: "GID-win-client-test-01@@@wxid_xxxxxx"
        
        // ③ 构造订阅 Topic 列表
        const filterTopics = [taskIssuedTopic + P2P_TOPIC + clientId];
        // 例: "robot-wx-win-issued-test01/p2p/GID-win-client-test-01@@@wxid_xxxxxx"
        
        // ④ 生成连接参数（含 HmacSHA1 签名）
        const connectionOptions = getMqttConnectionOptions(instanceId, accessKey, secretKey, clientId);
        
        // ⑤ 初始化 MQTT 客户端
        initMqttClient(wxId, params, onRecieveMsg);
        done();
    });
};
```

### 3.2 Token 获取

```javascript
const getMqttAccess = async (wxId) => {
    // 缓存已获取的 token
    if (accessResCache.accessKey) {
        return accessResCache;
    }
    
    // HTTP 请求获取 token
    let accessRes = await httpFetch({
        url: ACCESS_URL,
        data: {
            access: access(ACCOUNT),  // 加密的账号信息
        },
    });
    
    // 解密响应
    const res = JSON.parse(decode(accessRes.data));
    accessResCache = res;
    return res;
};
```

### 3.3 HmacSHA1 签名

```javascript
const signHmacSha1 = (text, secretKey) => {
    const sha1 = crypto.HmacSHA1(text, secretKey);
    return Base64.stringify(sha1);
};

const getMqttConnectionOptions = (instanceId, accessKey, secretKey, clientId) => {
    return {
        username: `Signature|${accessKey}|${instanceId}`,
        clientId,
        password: signHmacSha1(clientId, secretKey),
        connectTimeout: 5000,
        clean: false,    // 非干净会话（断线时保留订阅）
    };
};
```

### 3.4 连接参数说明

| 参数 | 值 | 说明 |
|------|-----|------|
| `username` | `Signature\|accessKey\|instanceId` | 阿里云 MQTT 签名认证格式 |
| `password` | `HmacSHA1(clientId, secretKey)` | 基于 clientId 的签名 |
| `clientId` | `GID-xxx@@@wxid_xxx` | 唯一客户端标识 |
| `connectTimeout` | `5000` (ms) | 连接超时 5 秒 |
| `clean` | `false` | 持久会话，断线后服务端保留消息 |
| `reconnectPeriod` | `0` | 禁用自动重连（手动管理） |

### 3.5 客户端获取（带重试）

```javascript
exports.getMqttByWxId = (wxId) => {
    return new Promise((resolve, reject) => {
        if (getMqttClientByWxId(wxId)) {
            resolve(getMqttClientByWxId(wxId));
        } else {
            let limit = 20;       // 最多重试 20 次
            let count = 0;
            let timer = setInterval(() => {
                if (count >= limit) {
                    reject("timeout");
                } else {
                    let client = getMqttClientByWxId(wxId);
                    if (client) {
                        resolve(client);
                        clearInterval(timer);
                    }
                }
                count++;
            }, 100);              // 每 100ms 检查一次
        }
    });
};
```

总等待时间：最多 `20 × 100ms = 2秒`。

---

## 四、MQTT 客户端核心 — mqttClientBase.js

**文件路径**：`galaxy-client/src/msg-center/core/mq/mqttClientBase.js`  
**总行数**：445 行

### 4.1 连接初始化

```javascript
const initMqttClient = (wxId, params, onRecieveMsg) => {
    // ① 检查是否已有有效连接
    const registry = RegistryConfig.getRegistryByKey(wxId, "wxid");
    if (!registry) return;                          // 微信已退出
    if (registry.mqttClient?.connected) return;     // 已有有效连接
    if (registry.isMqttConnecting) return;          // 正在连接中
    
    // ② 清理无效连接
    if (registry.mqttClient && !registry.mqttClient.connected) {
        forceClearMqtt(wxId, registry);
    }
    
    // ③ 标记连接中
    registry.isMqttConnecting = true;
    
    // ④ 创建 MQTT 连接
    const { endPoint, connectionOptions } = params;
    connectionOptions.reconnectPeriod = 0;          // 禁用自动重连
    let client = mqtt.connect(`tcp://${endPoint}:1883`, connectionOptions);
    
    // ⑤ 注册到 registry
    registryMqtt(wxId, client);
};
```

### 4.2 连接成功 — 订阅 Topic

```javascript
client.on("connect", function () {
    client.subscribe(filterTopics, { qos: 1 }, function (err, granted) {
        if (!err) {
            logUtil.customLog(`[wxid-${wxId}] 订阅成功`);
        } else {
            logUtil.customLog(`[wxid-${wxId}] 订阅失败: ${err}`);
        }
    });
    registry.isMqttConnecting = false;
});
```

### 4.3 消息接收与处理

```javascript
client.on("message", async function (topic, message) {
    // ① 解析消息（处理大数字）
    let messageUtf8 = replaceLargeNumbers(message.toString("utf8"));
    const dataInfo = JSON.parse(messageUtf8);
    
    // ② 消息过期过滤（可配置，默认 3 小时）
    const expireHours = apolloConfig.mqttTaskExpireHours || 3;
    const expireTime = expireHours * 60 * 60 * 1000;
    if (dataInfo.createTime * 1000 < Date.now() - expireTime) {
        logUtil.customLog(`消息过期（${expireHours}小时），终止处理`);
        return;
    }
    
    // ③ taskId 去重锁（防止重复处理）
    let receiveId = dataInfo?.id;
    if (receiveId && mqttTaskMapLock.has(receiveId)) {
        logUtil.customLog(`消息重复，终止处理`);
        return;
    } else if (receiveId) {
        mqttTaskMapLock.set(receiveId, {
            wxId,
            timestamp: Date.now(),
            processed: true
        });
        startCleanupTimerIfNeeded();
    }
    
    // ④ 从 Topic 中提取 wxId
    if (topic.includes("@@@")) {
        const str = topic.split("@@@")[1];
        wxId = str.substring(0, str.length - 1);
    }
    
    // ⑤ 路由到业务处理
    const serverTaskBO = { ...ServerTaskBO, ...msgObjTemp };
    if (msgObjTemp.type === 100) {
        // 群发消息：延迟执行（通过内存队列）
        executeWithDelay(wxId, () => execute(wxId, serverTaskBO));
    } else {
        // 其他消息：随机延迟 0-1 秒后执行
        await sleep(Math.ceil(Math.random() * 1000));
        execute(wxId, serverTaskBO);
    }
});
```

### 4.4 任务执行与路由

```javascript
async function runTask(wxId, serverTaskBO, registry) {
    if (registry.workWx) {
        // 企微 → 遍历 WorkWxConvertServiceList
        for (let service of WorkWxConvertServiceList) {
            if (service.filter(serverTaskBO)) {
                service.operate(serverTaskBO, wxId);
            }
        }
    } else {
        // 微信 → 遍历 WxConvertServiceList
        for (let service of WxConvertServiceList) {
            if (service?.filter(serverTaskBO)) {
                service.operate(serverTaskBO, wxId);
            }
        }
    }
}

const execute = (wxId, serverTaskBO) => {
    const registry = RegistryConfig.getRegistryByKey(wxId, "wxid");
    if (!registry) return;
    runTask(wxId, serverTaskBO, registry);
};
```

### 4.5 微信服务路由表（WxConvertServiceList）

| 序号 | 服务 | 功能 |
|------|------|------|
| 1 | MqttAcceptChatroomInvite | 接受群邀请 |
| 2 | MqttAddChatroomFriendWx4Service | 群内加好友（微信4.0） |
| 3 | MqttBatchDeleteFriendService | 批量删除好友 |
| 4 | MqttChangeRemarkService | 修改备注 |
| 5 | MqttChatroomNameService | 修改群名称 |
| 6 | MqttChatService | 群发消息 |
| 7 | MqttCleanUnreadMsg | 清除未读消息 |
| 8 | MqttDeleteFriendService | 删除好友 |
| 9 | MqttExitChatroomService | 退出群聊 |
| 10 | MqttFriendListService | 获取好友列表 |
| 11 | MqttFriendPassService | 通过好友申请 |
| 12 | MqttGetContactLabelListService | 获取联系人标签 |
| 13 | MqttGroupAnnounceService | 群公告 |
| 14 | MqttJoinChatroomService | 拉入群聊 |
| 15 | MqttKickOutService | 踢出群聊 |
| 16 | MqttReplaceFileService | 替换文件 |

### 4.6 企微服务路由表（WorkWxConvertServiceList）

包含 24 个服务，覆盖企微的好友、群聊、标签、消息等操作。

### 4.7 去重锁机制

```javascript
let mqttTaskMapLock = new Map();
let mqttCleanupTimer = null;

// 每 10 分钟清理过期锁
function startCleanupTimerIfNeeded() {
    if (mqttCleanupTimer) return;
    if (mqttTaskMapLock.size > 0) {
        mqttCleanupTimer = setInterval(cleanupExpiredLocks, 600 * 1000);
    }
}

// 100 分钟过期
function cleanupExpiredLocks() {
    const expireTime = 6000 * 1000;
    for (const [taskId, lockInfo] of mqttTaskMapLock.entries()) {
        if (Date.now() - lockInfo.timestamp > expireTime) {
            mqttTaskMapLock.delete(taskId);
        }
    }
    stopCleanupTimerIfNotNeeded();
}
```

| 参数 | 值 | 说明 |
|------|-----|------|
| 锁结构 | `Map<taskId, {wxId, timestamp, processed}>` | 按 taskId 去重 |
| 锁过期时间 | 100 分钟 | 超过后自动清理 |
| 清理周期 | 10 分钟 | 定时器检查过期锁 |

### 4.8 错误处理

```javascript
client.on("error", (error) => {
    clearMqttConnection(wxId);
    // 失败后需要考虑顶号逻辑
});

client.on("close", function (e) {
    notify.onMqttClose(wxId);
    clearMqttByWxId(wxId);
});

client.on("reconnect", () => {
    logUtil.customLog(`reconnecting to MQTT broker`);
});

client.on("offline", () => {
    logUtil.customLog(`MQTT client is offline`);
});
```

---

## 五、加解密机制 — encryptUtil.js

**文件路径**：`galaxy-client/src/msg-center/core/mq/encryptUtil.js`  
**总行数**：89 行

### 5.1 加密流程

```
原始字符串
    │
    ▼
拼接时间戳 + TOKEN + UUID + 账号
    │ "{timestamp}##{TOKEN}##{uuid前4位}##{key}##{uuid后4位}"
    ▼
XOR 编码（与 TOKEN 的 hashCode 异或）
    │
    ▼
Hex 字符串
    │
    ▼
Base64 编码
    │
    ▼
最终加密字符串
```

### 5.2 核心函数

```javascript
const TOKEN = 'bjhl';

const access = (key) => {
    let timestamp = Math.floor(Date.now());
    const uuid = uuidv4().replaceAll('##', '');
    const str1 = uuid.substring(0, 4);
    const str2 = uuid.substring(4, 8);
    const str = `${timestamp}##${TOKEN}##${str1}${key ? '##' + key : ''}##${str2}`;
    return encode(str);
};

const encode = (str) => {
    str = XORencode(str, TOKEN);     // XOR 加密
    str = Base64Encode(str);         // Base64 编码
    return str;
};

const decode = (str) => {
    str = Base64Decode(str);         // Base64 解码
    str = XORdecode(str, TOKEN);     // XOR 解密
    return str;
};
```

### 5.3 XOR 编码

```javascript
const XORencode = (str, key = TOKEN) => {
    let bytes = Array.from(Buffer.from(str));
    const hashCode = getHashCode(key);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = bytes[i] ^ hashCode;
    }
    return Buffer.from(bytes).toString('hex');
};

const getHashCode = (str) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        let chr = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0;  // 转为 32 位整数
    }
    return hash;
};
```

---

## 六、MQTT 消息发送 — mqExcuteMsg.js

**文件路径**：`galaxy-client/src/msg-center/core/mq/mqExcuteMsg.js`  
**总行数**：61 行

### 6.1 发送流程

```javascript
function mqExcuteMsg(wxId, topic, msgObj, isRetry = true) {
    const message = JSON.stringify(msgObj);
    const payload = Buffer.from(message);
    
    // ① 检查 wxId 有效性
    if (!wxId) return;
    
    // ② 获取 registry 和 mqttClient
    let registry = RegistryConfig.getRegistryByKey(wxId, 'wxid');
    
    if (!registry || !registry.mqttClient) {
        // ③ MQTT 未初始化 → 存入补偿队列
        MqttMakeUpManager.processSaveNotSend(wxId, msgObj);
        
        // ④ 触发登录验证
        const clientTaskBO = {
            type: GalaxyTaskType.LOGIN,
            typeExt: FunctionDirectory.MQTT_CHECK,
        };
        cloudFlowInBound(null, wxId, JSON.stringify(clientTaskBO));
    } else {
        // ⑤ 正常发送
        registry.mqttClient.publish(topic, payload);
    }
}
```

### 6.2 发送失败处理

| 场景 | 处理 |
|------|------|
| `wxId` 为空 | 直接返回 |
| `registry` 不存在 | 存入补偿队列 + 触发登录验证 |
| `mqttClient` 未初始化 | 存入补偿队列 + 触发登录验证 |
| `publish` 抛出异常 | 存入补偿队列（如果 `isRetry=true`） |

---

## 七、消息补偿机制 — mqttMakeUpManager.js

**文件路径**：`galaxy-client/src/msg-center/core/mq/mqttMakeUpManager.js`  
**总行数**：23 行

### 7.1 实现

```javascript
const MAX_CAPICITY = 100;

const MqttMakeUpManager = {
    NOT_UPLOAD_MQTT_MESSAGE_QUEUE: [],
    
    processSaveNotSend(wxId, obj) {
        const makeUpMsg = {
            wxid: wxId,
            body: obj,
            timestamp: new Date().getTime(),
        };
        if (this.NOT_UPLOAD_MQTT_MESSAGE_QUEUE.length <= MAX_CAPICITY) {
            this.NOT_UPLOAD_MQTT_MESSAGE_QUEUE.push(makeUpMsg);
        }
    }
};
```

### 7.2 补偿参数

| 参数 | 值 | 说明 |
|------|-----|------|
| 队列容量 | 100 条 | 超出后丢弃新消息 |
| 补偿超时 | `makeUpTimeOut: 600000`（10分钟） | 超过 10 分钟的消息不再补发 |
| 补偿执行 | `ProcessMakeUpTaskTimer` | 由定时任务每 10 秒触发检查 |

### 7.3 补偿定时任务

由 `schedual.js` 中的 `ProcessMakeUpTaskTimer.taskMakeUpTask()` 执行：
1. 遍历 `NOT_UPLOAD_MQTT_MESSAGE_QUEUE`
2. 检查消息是否过期（超过 `makeUpTimeOut`）
3. 检查 MQTT 连接是否已恢复
4. 重新发送并从队列移除

---

## 八、入站调度 — dispatchInBound.js

**文件路径**：`galaxy-client/src/msg-center/dispatch-center/dispatchInBound.js`  
**总行数**：113 行

### 8.1 调度流程

```javascript
function dispatchInBound(channelId, wxId, message) {
    // ① 从注册表获取目标 registry
    let registry;
    if (wxId) {
        registry = RegistryConfig.getRegistryByKey(wxId, 'wxid');
    } else {
        registry = RegistryConfig.getRegistryByKey(channelId, 'id');
    }
    if (!registry) return;  // 未建立逆向连接
    
    // ② 解析消息类型
    const jsonObject = JSON.parse(message);
    const type = typeConvert(jsonObject.type || jsonObject.body.type);
    
    // ③ 判断是否需要任务状态追踪
    if (TaskCallBack.taskCallbackMap[type] || WkTaskCallBack.taskCallbackMap[type]) {
        // 需要追踪的任务 → 加锁、缓存任务状态
        lock.acquire(`galaxyTaskLock-${key}`, (done) => {
            GalaxyTaskCache.GALAXY_TASK_STATUS_MAP[taskId] = galaxyTaskStatus;
            inBoundAct(channelId, wxId, message);
            done();
        });
    } else {
        // 无需追踪 → 直接转发
        inBoundAct(channelId, wxId, message);
    }
}

function inBoundAct(channelId, wxId, message) {
    reverseSendService.sendMessage(wxId, channelId, message);
}
```

### 8.2 完整消息下行链路

```
云端 MQTT Broker
    │
    ▼ publish to P2P topic
mqttClientBase.on("message")
    │
    ▼ 过期过滤 + 去重
execute(wxId, serverTaskBO)
    │
    ▼ runTask()
WxConvertServiceList / WorkWxConvertServiceList
    │
    ▼ service.operate(serverTaskBO, wxId)
[具体业务服务处理]
    │
    ▼ 构造 clientTask
dispatchInBound(channelId, wxId, message)
    │
    ▼ reverseSend.sendMessage()
clibrary.IpcClientSendMessage()
    │
    ▼ Named Pipe
微信/企微进程执行命令
```

---

## 九、MQTT 断线重连机制

### 9.1 当前策略

MQTT 客户端设置 `reconnectPeriod: 0`，禁用了库自带的自动重连。断线重连由以下机制协同完成：

1. **close 事件处理**：清除 mqttClient 引用
2. **逆向登录上报**：微信重新连接时会重新触发 MQTT 连接
3. **心跳检测**：`HeartBeatTimer` 检测到连接异常时触发重连
4. **任务补偿**：`ProcessMakeUpTaskTimer` 补发发送失败的消息

### 9.2 重连触发链路

```
微信登录上报 (逆向 → dispatchOutBound)
    │
    ▼
loginService.operate()
    │
    ▼
mqttHelper.connectMqtt({ wxId, onRecieveMsg })
    │
    ▼
initMqttClient() → 重新建立 MQTT 连接
```

---

## 十、MQTT 消息过期过滤

### 10.1 过期时间

```javascript
const expireHours = apolloConfig.mqttTaskExpireHours || 3;
const expireTime = expireHours * 60 * 60 * 1000;

if (dataInfo.createTime * 1000 < Date.now() - expireTime) {
    // 消息过期，丢弃
    return;
}
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `mqttTaskExpireHours` | 3 小时 | 可通过 Apollo 动态配置 |
| `createTime` | 云端任务创建时间（秒级） | 乘以 1000 转毫秒比较 |

### 10.2 过期场景

- 客户端离线超过 3 小时后重新连接，会收到离线期间的积压消息
- 这些消息已经过期，直接丢弃避免执行过时的操作

---

## 十一、与 RegistryConfig 的协作

### 11.1 MQTT 连接与 registry 的生命周期绑定

```
Named Pipe 连接建立
    │
    ▼
RegistryConfig.add(registry)     → registry.mqttClient = null
    │
    ▼
微信登录信息上报
    │
    ▼
mqttHelper.connectMqtt()         → registry.mqttClient = client
    │
    ▼
正常工作...
    │
    ▼ Named Pipe 断开
logoutService.operate()
    │
    ▼
clearMqttConnection()            → registry.mqttClient = null
    │
    ▼
RegistryConfig.removePipe()      → 移除 registry
```

### 11.2 registry 中的 MQTT 相关字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `mqttClient` | `MqttClient \| null` | MQTT 客户端实例 |
| `isMqttConnecting` | `boolean` | 是否正在连接中（防重复初始化） |

---

## 十二、常见问题排查

### 12.1 MQTT 连接失败

| 症状 | 可能原因 | 排查方式 |
|------|----------|----------|
| `mqttOnError` | token 过期 | 检查 `getMqttAccess` 日志，清除 `accessResCache` |
| 连接超时 | 网络不通 | 检查 MQTT endPoint 可达性 |
| 认证失败 | 签名错误 | 检查 `signHmacSha1` 的 clientId 和 secretKey |
| 重复连接 | 并发初始化 | 检查 `isMqttConnecting` 标记 |

### 12.2 消息丢失

| 症状 | 可能原因 | 排查方式 |
|------|----------|----------|
| 收不到消息 | 订阅失败 | 检查 `subscribe` 回调中的 err |
| 消息被过滤 | 过期过滤 | 检查 `createTime` 与当前时间差 |
| 重复过滤 | 去重锁误判 | 检查 `mqttTaskMapLock` 大小 |
| MQTT 未初始化 | 连接时序问题 | 检查 `registry.mqttClient` 是否为 null |

### 12.3 日志关键词

| 关键词 | 含义 |
|--------|------|
| `[接收mqtt任务]` | 收到 MQTT 消息 |
| `[MqttClientUtil-send]` | MQTT 发送 |
| `MQTT client未初始化完毕` | 发送时 mqttClient 为 null |
| `消息过期` | 过期过滤生效 |
| `消息重复` | 去重锁生效 |
| `mqttOnError` | MQTT 连接错误 |
| `handleCloseMqtt` | MQTT 连接关闭 |
| `订阅成功` / `订阅失败` | Topic 订阅结果 |

---

## 十三、关键代码路径索引

| 功能 | 文件路径 |
|------|----------|
| MQTT 配置常量 | `src/msg-center/core/mq/mqttConfig.js` |
| MQTT 连接管理 | `src/msg-center/core/mq/mqttHelper.js` |
| MQTT 客户端核心 | `src/msg-center/core/mq/mqttClientBase.js` |
| MQTT 消息发送 | `src/msg-center/core/mq/mqExcuteMsg.js` |
| MQTT 消息补偿 | `src/msg-center/core/mq/mqttMakeUpManager.js` |
| 加解密工具 | `src/msg-center/core/mq/encryptUtil.js` |
| 入站调度 | `src/msg-center/dispatch-center/dispatchInBound.js` |
| 出站调度 | `src/msg-center/dispatch-center/dispatchOutBound.js` |
| 逆向发送 | `src/msg-center/dispatch-center/reverseSend.js` |
| MQTT 上报发送 | `src/msg-center/dispatch-center/mqttSend.js` |
| 任务补偿定时器 | `src/msg-center/business/timer/ProcessMakeUpTaskTimer.js` |
| Apollo 动态配置 | `src/msg-center/core/utils/getApolloConfig.js` |
| 环境配置(QA) | `src/msg-center/core/application-config/applicationQa.js` |
| 环境配置(Prod) | `src/msg-center/core/application-config/applicationProd.js` |
| 内存队列任务 | `src/msg-center/core/queue/mqTask.js` |

---

*文档生成时间：2026-03-13 | 基于 galaxy-client 仓库实际代码分析*
