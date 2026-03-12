# MQTT 消息队列详解

> 与云端服务的实时通信

---

## 一、MQTT 简介

### 1.1 什么是 MQTT

MQTT（Message Queuing Telemetry Transport）是一种轻量级的发布/订阅消息协议，特别适合物联网和移动应用场景。

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       MQTT 发布/订阅模型                                 │
└─────────────────────────────────────────────────────────────────────────┘

    发布者 (Publisher)                     订阅者 (Subscriber)
    ┌─────────────┐                        ┌─────────────┐
    │  瓦力云后台  │                        │Galaxy-Client│
    │             │                        │             │
    │ 发布任务消息 │                        │ 接收任务消息 │
    └──────┬──────┘                        └──────▲──────┘
           │                                      │
           │ 发布 (Publish)          订阅 (Subscribe)
           │                                      │
           ▼                                      │
    ┌─────────────────────────────────────────────┴───────┐
    │                    MQTT Broker                       │
    │                                                      │
    │    主题 (Topic): task/wxid_xxx                       │
    │                                                      │
    │    消息路由：根据主题将消息分发给订阅者               │
    └──────────────────────────────────────────────────────┘
```

### 1.2 MQTT 核心概念

| 概念 | 说明 |
|-----|-----|
| **Broker** | 消息代理服务器，负责接收和分发消息 |
| **Topic** | 主题，消息的分类标识 |
| **Publish** | 发布消息到指定主题 |
| **Subscribe** | 订阅主题，接收该主题的消息 |
| **QoS** | 服务质量等级（0/1/2） |
| **Client ID** | 客户端唯一标识 |

### 1.3 项目使用的 MQTT 库

```json
{
  "mqtt": "^4.3.7"
}
```

---

## 二、项目中的 MQTT 架构

### 2.1 通信架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       项目 MQTT 架构                                     │
└─────────────────────────────────────────────────────────────────────────┘

                              云端
    ┌────────────────────────────────────────────────────┐
    │                                                    │
    │  ┌─────────────┐          ┌─────────────┐         │
    │  │  瓦力云后台  │──发布──►│ MQTT Broker │         │
    │  └─────────────┘          └──────┬──────┘         │
    │                                  │                │
    └──────────────────────────────────┼────────────────┘
                                       │
                                       │ 订阅/发布
                                       │
    ┌──────────────────────────────────▼────────────────────────────────┐
    │                        Galaxy-Client                              │
    │                                                                   │
    │  ┌─────────────────────────────────────────────────────────────┐ │
    │  │                      mqttClientBase.js                       │ │
    │  │                                                              │ │
    │  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │ │
    │  │  │ 微信1 MQTT   │  │ 微信2 MQTT   │  │ 微信N MQTT   │      │ │
    │  │  │ wxid_xxx     │  │ wxid_yyy     │  │ wxid_zzz     │      │ │
    │  │  └──────────────┘  └──────────────┘  └──────────────┘      │ │
    │  │                                                              │ │
    │  │  订阅主题: task/{wxid}                                       │ │
    │  │  发布主题: result/{wxid}                                     │ │
    │  └─────────────────────────────────────────────────────────────┘ │
    │                                                                   │
    └───────────────────────────────────────────────────────────────────┘

特点：每个微信账号对应一个独立的 MQTT 连接
```

### 2.2 文件结构

```
src/msg-center/core/mq/
├── mqttClientBase.js     # MQTT 客户端管理（核心）
├── mqttConfig.js         # MQTT 配置
├── mqttHelper.js         # MQTT 辅助函数
├── mqttMakeUpManager.js  # MQTT 补偿机制
└── encryptUtil.js        # 加密工具
```

---

## 三、MQTT 连接管理

### 3.1 建立连接

```javascript
// src/msg-center/core/mq/mqttClientBase.js

const mqtt = require("mqtt");

const initMqttClient = (wxId, params, onRecieveMsg) => {
    // 1. 检查是否已有连接
    const registry = RegistryConfig.getRegistryByKey(wxId, "wxid");
    if (!registry) {
        return; // 微信已退出
    }
    
    if (registry?.mqttClient?.connected) {
        return; // 已有有效连接
    }
    
    if (registry.isMqttConnecting) {
        return; // 正在连接中
    }
    
    // 2. 解构连接参数
    const {
        endPoint,          // Broker 地址
        clientId,          // 客户端ID
        accessKey,         // 访问密钥
        secretKey,         // 密钥
        filterTopics,      // 订阅主题
        instanceId,        // 实例ID
        connectionOptions, // 连接选项
        qos,              // 服务质量
    } = params;
    
    // 3. 禁用自动重连（手动控制）
    connectionOptions.reconnectPeriod = 0;
    
    // 4. 建立连接
    registry.isMqttConnecting = true;
    const client = mqtt.connect(`tcp://${endPoint}:1883`, connectionOptions);
    
    // 5. 注册到 Registry
    registry.mqttClient = client;
    
    // 6. 事件处理
    setupMqttEvents(client, wxId, filterTopics, registry);
};
```

### 3.2 事件处理

```javascript
function setupMqttEvents(client, wxId, filterTopics, registry) {
    
    // 连接成功
    client.on("connect", function () {
        logUtil.customLog(`[wxid-${wxId}] MQTT 连接成功`);
        
        // 订阅主题
        client.subscribe(filterTopics, { qos: 1 }, function (err, granted) {
            if (!err) {
                logUtil.customLog(`[wxid-${wxId}] MQTT 订阅成功`);
            } else {
                logUtil.customLog(`[wxid-${wxId}] MQTT 订阅失败: ${err}`);
            }
        });
        
        registry.isMqttConnecting = false;
    });
    
    // 接收消息
    client.on("message", async function (topic, message) {
        await handleMqttMessage(wxId, topic, message);
    });
    
    // 连接错误
    client.on("error", (error) => {
        logUtil.customLog(`[wxid-${wxId}] MQTT 错误: ${error.message}`);
        clearMqttConnection(wxId);
    });
    
    // 连接关闭
    client.on("close", function () {
        logUtil.customLog(`[wxid-${wxId}] MQTT 连接关闭`);
        notify.onMqttClose(wxId);
        clearMqttByWxId(wxId);
    });
    
    // 重连
    client.on("reconnect", () => {
        logUtil.customLog(`[wxid-${wxId}] MQTT 正在重连`);
    });
    
    // 离线
    client.on("offline", () => {
        logUtil.customLog(`[wxid-${wxId}] MQTT 离线`);
    });
}
```

### 3.3 连接清理

```javascript
// 强制清理 MQTT 连接
const forceClearMqtt = (wxId, registry) => {
    registry?.mqttClient?.end?.(true, {}, () => {
        if (registry) {
            registry.mqttClient = null;
        }
        logUtil.customLog(`[wxid-${wxId}] MQTT 连接已清理`);
    });
};

// 清理连接状态
const clearMqttConnection = (wxId) => {
    const registry = RegistryConfig.getRegistryByKey(wxId, "wxid");
    if (registry) {
        registry.isMqttConnecting = false;
    }
    if (registry?.mqttClient) {
        forceClearMqtt(wxId, registry);
    }
};

// 按 wxId 清理
const clearMqttByWxId = (wxId) => {
    const registry = RegistryConfig.getRegistryByKey(wxId, "wxid");
    if (registry) {
        registry.isMqttConnecting = false;
        registry.mqttClient = null;
    }
};
```

---

## 四、消息接收与处理

### 4.1 消息接收流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       MQTT 消息处理流程                                  │
└─────────────────────────────────────────────────────────────────────────┘

    MQTT Broker
         │
         │ 消息推送
         ▼
    client.on("message")
         │
         │ 1. 解析消息
         ▼
    ┌─────────────────┐
    │ 过期检查        │ ──── 超过3小时 ──► 丢弃
    │ (默认3小时)     │
    └────────┬────────┘
             │ 未过期
             ▼
    ┌─────────────────┐
    │ 去重检查        │ ──── 已处理过 ──► 丢弃
    │ mqttTaskMapLock │
    └────────┬────────┘
             │ 未处理
             ▼
    ┌─────────────────┐
    │ 解析任务类型    │
    │ serverTaskBO    │
    └────────┬────────┘
             │
             │ 根据 type 路由
             ▼
    ┌─────────────────────────────────────────┐
    │           task-mqtt 处理器              │
    │                                         │
    │  type=100 ──► MqttChatService          │
    │  type=101 ──► MqttKickOutService       │
    │  type=102 ──► MqttFriendPassService    │
    │  ...                                    │
    └─────────────────────────────────────────┘
```

### 4.2 消息处理代码

```javascript
// src/msg-center/core/mq/mqttClientBase.js

async function handleMqttMessage(wxId, topic, message) {
    // 1. 解析消息（处理大数字）
    let messageUtf8 = replaceLargeNumbers(message.toString("utf8"));
    const dataInfo = JSON.parse(messageUtf8);
    
    logUtil.customLog(
        `[wxid-${wxId}] [接收mqtt任务] type=${dataInfo.type}, taskId=${dataInfo.id}`
    );
    
    // 2. 过期检查（可配置，默认3小时）
    const expireHours = apolloConfig.mqttTaskExpireHours || 3;
    const expireTime = expireHours * 60 * 60 * 1000;
    if (dataInfo.createTime * 1000 < Date.now() - expireTime) {
        logUtil.customLog(`[wxid-${wxId}] taskId=${dataInfo.id}, 消息过期，跳过`);
        return;
    }
    
    // 3. 去重检查
    const receiveId = dataInfo?.id;
    if (receiveId && mqttTaskMapLock.has(receiveId)) {
        logUtil.customLog(`[wxid-${wxId}] taskId=${receiveId}, 消息重复，跳过`);
        return;
    }
    
    // 4. 记录去重锁
    if (receiveId) {
        mqttTaskMapLock.set(receiveId, {
            wxId: wxId,
            timestamp: Date.now(),
            processed: true
        });
        startCleanupTimerIfNeeded();
    }
    
    // 5. 解析主题获取 wxId
    let preWxId = "";
    if (topic.includes("@@@")) {
        const str = topic.split("@@@")[1];
        preWxId = str.substring(0, str.length - 1);
    }
    
    // 6. 构建任务对象
    const serverTaskBO = { ...ServerTaskBO, ...dataInfo };
    
    // 7. 分发处理
    if (dataInfo.type === 100) {
        // 群发消息：使用队列处理
        executeWithDelay(wxId, () => {
            execute(wxId, serverTaskBO);
        });
    } else {
        // 其他任务：延迟1秒后处理
        await sleep(Math.ceil(Math.random() * 1000));
        execute(wxId, serverTaskBO);
    }
}
```

### 4.3 任务执行

```javascript
// 执行任务
async function runTask(wxId, serverTaskBO, registry) {
    // 企业微信任务
    if (registry.workWx) {
        for (let service of WorkWxConvertServiceList) {
            if (service.filter(serverTaskBO)) {
                service.operate(serverTaskBO, wxId);
            }
        }
    } 
    // 微信任务
    else {
        for (let service of WxConvertServiceList) {
            if (service?.filter(serverTaskBO)) {
                service.operate(serverTaskBO, wxId);
            }
        }
    }
}

const execute = (wxId, serverTaskBO) => {
    const registry = RegistryConfig.getRegistryByKey(wxId, "wxid");
    if (!registry) {
        logUtil.customLog(`[wxid-${wxId}] 机器人掉线，任务无法下发`);
        return;
    }
    runTask(wxId, serverTaskBO, registry);
};
```

---

## 五、任务处理器

### 5.1 处理器模式

```javascript
// 所有处理器都实现相同的接口
const MqttXxxService = {
    // 过滤：判断是否处理该类型任务
    filter(serverTask) {
        return serverTask.type === SunTaskType.XXX;
    },
    
    // 操作：执行具体业务
    async operate(serverTask, wxId) {
        // 1. 解析任务参数
        // 2. 处理业务逻辑
        // 3. 发送给逆向
    }
};
```

### 5.2 群发消息处理器示例

```javascript
// src/msg-center/business/task-mqtt/mqttChatService.js

const MqttChatService = {
    filter(serverTask) {
        return serverTask.type === SunTaskType.CHATROOM_SEND_MSG 
            || serverTask.type === SunTaskType.FRIEND_SEND_MSG;
    },
    
    async operate(serverTask, wxId) {
        const { content, weChatMsgType } = serverTask;
        
        // 1. 构建任务
        let task = ClientTaskFactory.getClientTask(serverTask, wxId);
        if (!task) {
            return false;
        }
        
        // 2. 处理媒体文件
        if (weChatMsgType == EMessage.TYPE__VIDEO
            || weChatMsgType == EMessage.TYPE__MSG_CARD_FILE
            || weChatMsgType == EMessage.TYPE__STICKER
            || weChatMsgType == EMessage.TYPE__IMAGE) {
            
            let localPath = content;
            
            // 如果是 URL，需要先下载
            if (content.startsWith("http://") || content.startsWith("https://")) {
                const fileInfo = await FileDownloadUtil.downloadAsyncReturnFileInfo(
                    content, 
                    serverTask.ext
                );
                localPath = fileInfo.filePath;
                
                if (!localPath) {
                    // 下载失败，上报超时
                    TimeOutResponse.fileDownloadTimeOutResponse(serverTask, wxId);
                    return true;
                }
                
                task.oldFileUrl = content;
            }
            
            task.data.content = localPath;
        }
        
        // 3. 发送给逆向
        cloudFlowInBound(null, wxId, JSON.stringify(task));
        
        logUtil.customLog(`[wxid-${wxId}] 群发消息任务: ${JSON.stringify(task)}`);
        return true;
    }
};
```

### 5.3 任务类型映射

```javascript
// 微信任务处理器列表
const WxConvertServiceList = [
    MqttAcceptChatroomInvite,      // 接受入群邀请
    MqttAddChatroomFriendWx4Service, // 群内加好友
    MqttBatchDeleteFriendService,   // 批量删除好友
    MqttChangeRemarkService,        // 修改备注
    MqttChatroomNameService,        // 修改群名
    MqttChatService,                // 发送消息
    MqttCleanUnreadMsg,             // 清除未读
    MqttDeleteFriendService,        // 删除好友
    MqttExitChatroomService,        // 退出群聊
    MqttFriendListService,          // 获取好友列表
    MqttFriendPassService,          // 通过好友申请
    MqttGetContactLabelListService, // 获取标签列表
    MqttGroupAnnounceService,       // 修改群公告
    MqttJoinChatroomService,        // 加入群聊
    MqttKickOutService,             // 踢人
    MqttReplaceFileService,         // 替换文件
];

// 企业微信任务处理器列表
const WorkWxConvertServiceList = [
    // ... 企微专用处理器
];
```

---

## 六、消息发送

### 6.1 发送消息到云端

```javascript
// src/msg-center/dispatch-center/mqttSend.js

const mqttSendObj = (function () {
    let instance;
    
    function createInstance() {
        const obj = {
            // 发送消息
            sendMessage(wxId, message) {
                const registry = RegistryConfig.getRegistryByKey(wxId, "wxid");
                
                if (!registry?.mqttClient?.connected) {
                    logUtil.customLog(`[wxid-${wxId}] MQTT 未连接，无法发送`);
                    return;
                }
                
                const topic = `result/${wxId}`;
                const payload = JSON.stringify(message);
                
                registry.mqttClient.publish(topic, payload, { qos: 1 }, (err) => {
                    if (err) {
                        logUtil.customLog(`[wxid-${wxId}] MQTT 发送失败: ${err}`);
                    } else {
                        logUtil.customLog(`[wxid-${wxId}] MQTT 发送成功`);
                    }
                });
            }
        };
        return obj;
    }
    
    return {
        getInstance() {
            if (!instance) {
                instance = createInstance();
            }
            return instance;
        }
    };
})();
```

### 6.2 上报任务结果

```javascript
// 任务执行成功后上报
function reportTaskResult(wxId, taskId, status, data) {
    const message = {
        type: 'task_result',
        taskId: taskId,
        wxId: wxId,
        status: status,  // 0=成功, 1=失败
        data: data,
        timestamp: Date.now()
    };
    
    MqttSendService.sendMessage(wxId, message);
}
```

---

## 七、去重与防重

### 7.1 去重锁机制

```javascript
// 去重锁 Map
let mqttTaskMapLock = new Map();
let mqttCleanupTimer = null;

// 添加去重锁
function addDuplicateLock(taskId, wxId) {
    mqttTaskMapLock.set(taskId, {
        wxId: wxId,
        timestamp: Date.now(),
        processed: true
    });
    startCleanupTimerIfNeeded();
}

// 检查是否重复
function isDuplicate(taskId) {
    return mqttTaskMapLock.has(taskId);
}
```

### 7.2 定期清理

```javascript
// 启动清理定时器
function startCleanupTimerIfNeeded() {
    if (mqttCleanupTimer) return;
    
    if (mqttTaskMapLock.size > 0) {
        mqttCleanupTimer = setInterval(() => {
            cleanupExpiredLocks();
        }, 600 * 1000); // 每10分钟清理一次
    }
}

// 清理过期的锁
function cleanupExpiredLocks() {
    const now = Date.now();
    const expireTime = 6000 * 1000; // 100分钟过期
    let cleanedCount = 0;
    
    for (const [taskId, lockInfo] of mqttTaskMapLock.entries()) {
        if (typeof lockInfo === 'object' && lockInfo.timestamp) {
            if (now - lockInfo.timestamp > expireTime) {
                mqttTaskMapLock.delete(taskId);
                cleanedCount++;
            }
        }
    }
    
    if (cleanedCount > 0) {
        logUtil.customLog(`[mqttTaskMapLock] 清理过期锁 ${cleanedCount} 个`);
    }
    
    stopCleanupTimerIfNotNeeded();
}

// 停止清理定时器
function stopCleanupTimerIfNotNeeded() {
    if (mqttTaskMapLock.size === 0 && mqttCleanupTimer) {
        clearInterval(mqttCleanupTimer);
        mqttCleanupTimer = null;
    }
}
```

---

## 八、消息格式

### 8.1 任务消息（云端下发）

```json
{
    "id": "task_123456789",
    "type": 100,
    "createTime": 1705912800,
    "wxId": "wxid_xxx",
    "chatroomId": "12345678@chatroom",
    "content": "Hello World",
    "weChatMsgType": 1,
    "ext": "",
    "priority": 1
}
```

### 8.2 结果消息（客户端上报）

```json
{
    "type": "task_result",
    "taskId": "task_123456789",
    "wxId": "wxid_xxx",
    "status": 0,
    "msgSvrId": "12345678901234567890",
    "timestamp": 1705912810000,
    "error": null
}
```

### 8.3 登录消息

```json
{
    "username": "wxid_xxx",
    "type": "robot_login",
    "robotLoginRecord": {
        "username": "wxid_xxx",
        "nickname": "张三",
        "headImg": "http://wx.qlogo.cn/xxx",
        "wxVersion": "3.8.0.18",
        "clientVersion": "5.4.2-release01",
        "clientType": 8,
        "clientMsgSource": 0
    }
}
```

---

## 九、QoS 服务质量

### 9.1 QoS 级别

| 级别 | 名称 | 说明 |
|-----|-----|-----|
| 0 | 最多一次 | 消息可能丢失 |
| 1 | 至少一次 | 消息不丢失，可能重复 |
| 2 | 恰好一次 | 消息不丢失不重复 |

### 9.2 项目使用

```javascript
// 订阅使用 QoS 1
client.subscribe(filterTopics, { qos: 1 });

// 发布使用 QoS 1
client.publish(topic, payload, { qos: 1 });

// 因为使用 QoS 1，消息可能重复，所以需要去重机制
```

---

## 十、错误处理

### 10.1 连接错误

```javascript
client.on("error", (error) => {
    logUtil.customLog(
        `[wxid-${wxId}] MQTT 错误: ${error.message}`,
        { level: "error" }
    );
    
    // 清理连接
    clearMqttConnection(wxId);
    
    // 可以在这里实现重连逻辑
});
```

### 10.2 连接断开

```javascript
client.on("close", function () {
    logUtil.customLog(`[wxid-${wxId}] MQTT 连接关闭`);
    
    // 通知相关模块
    notify.onMqttClose(wxId);
    
    // 清理状态
    clearMqttByWxId(wxId);
});
```

### 10.3 消息处理错误

```javascript
client.on("message", async function (topic, message) {
    try {
        await handleMqttMessage(wxId, topic, message);
    } catch (error) {
        logUtil.customLog(
            `[wxid-${wxId}] MQTT 消息处理错误: ${error.message}`,
            { level: "error" }
        );
    }
});
```

---

## 十一、调试技巧

### 11.1 日志关键字

```javascript
// 连接相关
"[mqttClientBase]"
"MQTT 连接成功"
"MQTT 订阅成功"
"MQTT 连接关闭"

// 消息相关
"[接收mqtt任务]"
"消息过期"
"消息重复"

// 去重相关
"[mqttTaskMapLock]"
"清理过期锁"

// 错误相关
"[codeError]"
"MQTT 错误"
```

### 11.2 调试步骤

1. 检查 MQTT 是否连接：`registry.mqttClient.connected`
2. 检查订阅是否成功：搜索 `MQTT 订阅成功` 日志
3. 检查消息是否接收：搜索 `[接收mqtt任务]` 日志
4. 检查任务是否执行：搜索对应处理器的日志

---

## 十二、学习资源

- [MQTT.js GitHub](https://github.com/mqttjs/MQTT.js)
- [MQTT 协议规范](https://mqtt.org/mqtt-specification/)
- [Eclipse Mosquitto](https://mosquitto.org/) - 开源 MQTT Broker
- [MQTT Explorer](https://mqtt-explorer.com/) - MQTT 调试工具
