# MQTT 业务场景详解

> 云端任务下发与执行的完整业务流程

---

## 一、MQTT 业务定位

### 1.1 在系统中的角色

MQTT 是 Galaxy-Client 与云端（瓦力后台）之间的**任务通道**，负责：
- **接收**：云端下发的各类操作任务
- **上报**：任务执行结果、登录登出状态

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MQTT 在系统中的位置                                   │
└─────────────────────────────────────────────────────────────────────────────┘

    运营人员                     云端服务                   Galaxy-Client
    ┌─────────┐               ┌─────────┐               ┌─────────────┐
    │ 瓦力后台 │──创建任务────►│MQTT Broker│───推送任务───►│  消息中心    │
    │ (Web)   │               │          │               │ mqttClient │
    └─────────┘               └────┬─────┘               └──────┬──────┘
                                   │                           │
                                   │◄──────────上报结果────────┤
                                   │                           │
                                                               │ IPC
                                                               ▼
                                                        ┌─────────────┐
                                                        │  逆向服务    │
                                                        │ 操作微信     │
                                                        └─────────────┘
```

### 1.2 业务场景分类

| 场景类型 | 任务类型码 | 说明 |
|---------|-----------|------|
| **消息发送** | 1, 100, 152-154 | 群发、私聊、群发文字/图片/语音 |
| **好友管理** | 101-126 | 添加/删除/通过好友、修改备注 |
| **群聊管理** | 1-27 | 踢人、邀请、改群名、群公告 |
| **账号管理** | 300-305 | 修改昵称、头像、签名 |
| **朋友圈** | 143-151 | 发朋友圈、点赞、评论 |
| **系统管理** | 200-206 | 同步配置、重启、清空聊天 |

---

## 二、核心业务场景

### 2.1 消息发送（最常用）

#### 业务流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         消息发送业务流程                                      │
└─────────────────────────────────────────────────────────────────────────────┘

运营人员                云端                    Galaxy-Client              微信
    │                    │                           │                      │
    │ 1. 创建群发任务     │                           │                      │
    │ (选择机器人/目标)   │                           │                      │
    ├───────────────────►│                           │                      │
    │                    │                           │                      │
    │                    │ 2. MQTT下发任务            │                      │
    │                    │ type=100(私聊)/1(群发)    │                      │
    │                    ├──────────────────────────►│                      │
    │                    │                           │                      │
    │                    │                           │ 3. 解析任务           │
    │                    │                           │ - 过期检查(3h)       │
    │                    │                           │ - 去重检查           │
    │                    │                           │                      │
    │                    │                           │ 4. 下载媒体文件       │
    │                    │                           │ (如果是图片/视频)    │
    │                    │                           │                      │
    │                    │                           │ 5. IPC发送到逆向     │
    │                    │                           ├─────────────────────►│
    │                    │                           │                      │
    │                    │                           │                      │ 6. 执行发送
    │                    │                           │                      │
    │                    │                           │◄─────────────────────┤
    │                    │                           │ 7. 返回执行结果       │
    │                    │                           │                      │
    │                    │ 8. MQTT上报结果           │                      │
    │                    │◄──────────────────────────┤                      │
    │                    │                           │                      │
```

#### 核心代码

```javascript
// src/msg-center/business/task-mqtt/mqttChatService.js

const MqttChatService = {
    // 过滤器：判断是否处理该类型任务
    filter(serverTask) {
        return serverTask.type === SunTaskType.CHATROOM_SEND_MSG  // type=1
            || serverTask.type === SunTaskType.FRIEND_SEND_MSG;   // type=100
    },
    
    // 处理器：执行具体业务
    async operate(serverTask, wxId) {
        const { content, weChatMsgType } = serverTask;
        
        // 1. 构建客户端任务
        let task = ClientTaskFactory.getClientTask(serverTask, wxId);
        if (!task) {
            return false;
        }
        
        // 2. 处理媒体文件（图片、视频、文件、表情）
        if ([EMessage.TYPE__VIDEO, 
             EMessage.TYPE__MSG_CARD_FILE, 
             EMessage.TYPE__STICKER, 
             EMessage.TYPE__IMAGE].includes(weChatMsgType)) {
            
            let localPath = content;
            
            // 如果是URL，先下载到本地
            if (content.startsWith('http://') || content.startsWith('https://')) {
                const fileInfo = await FileDownloadUtil.downloadAsyncReturnFileInfo(
                    content, 
                    serverTask.ext  // 文件名
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
        
        // 3. 发送给逆向服务执行
        cloudFlowInBound(null, wxId, JSON.stringify(task));
        
        logUtil.customLog(`[wxid-${wxId}] 消息发送任务: ${JSON.stringify(task)}`);
        return true;
    }
};
```

#### 消息类型支持

| weChatMsgType | 类型 | 说明 |
|---------------|------|------|
| 1 | 文本 | 纯文字消息 |
| 3 | 图片 | 支持URL自动下载 |
| 34 | 语音 | 支持URL自动下载 |
| 43 | 视频 | 支持URL自动下载 |
| 47 | 表情 | 自定义表情 |
| 49 | 文件/链接 | 文件或小程序链接 |

---

### 2.2 通过好友申请

#### 业务流程

```
用户A申请加机器人为好友
        │
        ▼
微信服务器推送好友申请到机器人
        │
        ▼
逆向服务接收并上报客户端
        │
        ▼
客户端上报云端（有新好友申请）
        │
        ▼
云端下发 type=104 任务（同意好友）
        │
        ▼
客户端通过IPC让逆向执行"同意好友"
        │
        ▼
微信完成好友添加
        │
        ▼
触发后续任务：
    ├── 修改备注 (type=116)
    └── 发送欢迎消息 (type=100)
```

#### 核心代码

```javascript
// src/msg-center/business/task-mqtt/mqttFriendPassService.js

const MqttFriendPassService = {
    filter(serverTask) {
        return serverTask.type === SunTaskType.FRIEND_ACCEPT_REQUEST;  // type=104
    },
    
    async operate(serverTask, wxId) {
        const { ticket, content } = serverTask;
        
        // 构建同意好友任务
        const task = {
            type: 'agreefriend',
            wxId: wxId,
            taskId: serverTask.id,
            data: {
                ticket: ticket,       // 好友申请凭证
                encryptusername: content,  // 加密的用户名
            }
        };
        
        // 发送给逆向执行
        cloudFlowInBound(null, wxId, JSON.stringify(task));
        
        return true;
    }
};
```

---

### 2.3 踢人出群

#### 业务流程

```
运营人员选择要踢出的群成员
        │
        ▼
云端下发 type=3 任务
{
    "type": 3,
    "wxId": "机器人wxid",
    "chatroom": "群ID@chatroom",
    "toUsernames": ["被踢用户wxid1", "被踢用户wxid2"]
}
        │
        ▼
客户端解析并构建IPC任务
        │
        ▼
逆向服务执行踢人操作
        │
        ▼
返回执行结果上报云端
```

#### 核心代码

```javascript
// src/msg-center/business/task-mqtt/mqttKickOutService.js

const MqttKickOutService = {
    filter(serverTask) {
        return serverTask.type === SunTaskType.CHATROOM_KICK_OUT;  // type=3
    },
    
    async operate(serverTask, wxId) {
        const { chatroom, toUsernames } = serverTask;
        
        // 构建踢人任务
        const task = {
            type: 'delchatmenber',
            wxId: wxId,
            taskId: serverTask.id,
            data: {
                chatroom: chatroom,           // 群ID
                memberlist: toUsernames,      // 被踢成员列表
            }
        };
        
        cloudFlowInBound(null, wxId, JSON.stringify(task));
        
        return true;
    }
};
```

---

### 2.4 修改好友备注

#### 业务流程

```
云端下发 type=116 任务
{
    "type": 116,
    "wxId": "机器人wxid",
    "toUsernames": ["目标用户wxid"],
    "content": "新备注名称"
}
        │
        ▼
客户端构建并执行
        │
        ▼
逆向服务调用微信接口修改备注
```

#### 核心代码

```javascript
// src/msg-center/business/task-mqtt/mqttChangeRemarkService.js

const MqttChangeRemarkService = {
    filter(serverTask) {
        return serverTask.type === SunTaskType.MODIFY_FRIEND_REMARK;  // type=116
    },
    
    async operate(serverTask, wxId) {
        const { toUsernames, content } = serverTask;
        
        const task = {
            type: 'remark',
            wxId: wxId,
            taskId: serverTask.id,
            data: {
                wxid: toUsernames[0],  // 目标用户
                remark: content,        // 新备注
            }
        };
        
        cloudFlowInBound(null, wxId, JSON.stringify(task));
        
        return true;
    }
};
```

---

### 2.5 群公告/群名修改

```javascript
// 修改群公告 type=5
const MqttGroupAnnounceService = {
    filter(serverTask) {
        return serverTask.type === SunTaskType.CHATROOM_UPDATE_NOTICE;
    },
    
    async operate(serverTask, wxId) {
        const task = {
            type: 'roomannouncement',
            wxId: wxId,
            taskId: serverTask.id,
            data: {
                chatroom: serverTask.chatroom,
                announcement: serverTask.content,
            }
        };
        
        cloudFlowInBound(null, wxId, JSON.stringify(task));
        return true;
    }
};

// 修改群名 type=6
const MqttChatroomNameService = {
    filter(serverTask) {
        return serverTask.type === SunTaskType.CHATROOM_UPDATE_NAME;
    },
    
    async operate(serverTask, wxId) {
        const task = {
            type: 'groupname',
            wxId: wxId,
            taskId: serverTask.id,
            data: {
                chatroom: serverTask.chatroom,
                groupname: serverTask.content,
            }
        };
        
        cloudFlowInBound(null, wxId, JSON.stringify(task));
        return true;
    }
};
```

---

## 三、任务处理器列表

### 3.1 微信任务处理器

```javascript
// src/msg-center/business/task-mqtt/index.js

const WxConvertServiceList = [
    MqttAcceptChatroomInvite,      // 27 - 接受入群邀请
    MqttAddChatroomFriendWx4Service, // 126 - 群内加好友
    MqttBatchDeleteFriendService,   // 125 - 批量删除好友
    MqttChangeRemarkService,        // 116 - 修改备注
    MqttChatroomNameService,        // 6 - 修改群名
    MqttChatService,                // 1,100 - 发送消息
    MqttCleanUnreadMsg,             // 169 - 清除未读
    MqttDeleteFriendService,        // 101 - 删除好友
    MqttExitChatroomService,        // 7 - 退出群聊
    MqttFriendListService,          // 103 - 获取好友列表
    MqttFriendPassService,          // 104 - 通过好友申请
    MqttGetContactLabelListService, // 119 - 获取标签列表
    MqttGroupAnnounceService,       // 5 - 修改群公告
    MqttJoinChatroomService,        // 155 - 扫码入群
    MqttKickOutService,             // 3 - 踢人
    MqttReplaceFileService,         // 替换文件
];
```

### 3.2 企业微信任务处理器

```javascript
// 企业微信有部分专用处理器
const WorkWxConvertServiceList = [
    // 企微专用处理器
    WkMqttChatService,              // 企微消息发送
    WkMqttFriendPassService,        // 企微通过好友
    // ... 其他企微专用
];
```

---

## 四、任务类型完整列表

### 4.1 群聊相关 (1-27)

| 类型码 | 常量名 | 中文说明 |
|--------|--------|---------|
| 1 | CHATROOM_SEND_MSG | 群内发消息 |
| 2 | CHATROOM_INVITE | 邀请入群 |
| 3 | CHATROOM_KICK_OUT | 踢人出群 |
| 4 | CHATROOM_TRANSFER_OWNER | 转让群主 |
| 5 | CHATROOM_UPDATE_NOTICE | 修改群公告 |
| 6 | CHATROOM_UPDATE_NAME | 修改群名 |
| 7 | CHATROOM_LEAVE | 主动退群 |
| 8 | CHATROOM_ALTER_SELF_DISPLAYNAME | 修改群内昵称 |
| 11 | CHATROOM_PREPARE | 建群 |
| 14 | CHATROOM_OPEN_VERIFY_INVITATION | 打开邀请确认 |
| 15 | CHATROOM_CLOSE_VERIFY_INVITATION | 关闭邀请确认 |
| 16 | CHATROOM_DISABLE_QRCODE | 停用群二维码 |
| 17 | CHATROOM_ADD_ADMIN | 增加群管理员 |
| 18 | CHATROOM_REMOVE_ADMIN | 删除群管理员 |
| 27 | CHATROOM_INVITATION_ACCEPT | 接受邀请入群 |

### 4.2 好友相关 (100-126)

| 类型码 | 常量名 | 中文说明 |
|--------|--------|---------|
| 100 | FRIEND_SEND_MSG | 私聊发消息 |
| 101 | DELETE_FRIEND | 删除好友 |
| 102 | ADD_FRIEND | 添加好友(微信号) |
| 103 | UPLOAD_FRIEND_LIST | 上传好友列表 |
| 104 | FRIEND_ACCEPT_REQUEST | 同意好友申请 |
| 105 | FRIEND_ADD_LABEL | 给好友加标签 |
| 106 | FRIEND_REMOVE_LABEL | 移除好友标签 |
| 107 | UPDATE_SELF_QRCODE | 更新自己二维码 |
| 108 | ADD_FRIEND_BY_CARD | 添加好友(名片) |
| 111 | ADD_FRIEND_BY_PHONE | 添加好友(手机号) |
| 116 | MODIFY_FRIEND_REMARK | 修改好友备注 |
| 117 | ADD_LABEL_FOR_FRIEND | 给好友加多标签 |
| 119 | UPLOAD_ALL_LABEL_INFO | 上报标签信息 |
| 120 | CREATE_LABEL | 创建标签 |
| 121 | DELETE_LABEL | 删除标签 |
| 125 | DELETE_FRIEND_BATCH | 批量删除好友 |
| 126 | ADD_CHATROOM_FRIEND | 群内加好友 |

### 4.3 朋友圈相关 (143-157)

| 类型码 | 常量名 | 中文说明 |
|--------|--------|---------|
| 143 | REFRESH_TIMELINE | 刷新朋友圈 |
| 144 | DELETE_TIMELINE | 删除朋友圈 |
| 145 | TIMELINE_COMMENT | 朋友圈评论 |
| 146 | TIMELINE_DELETE_COMMENT | 删除朋友圈评论 |
| 147 | TIMELINE_LIKE | 朋友圈点赞 |
| 148 | TIMELINE_CANCEL_LIKE | 取消点赞 |
| 149 | TIMELINE_VIDEO | 发视频朋友圈 |
| 150 | TIMELINE_NORMAL | 发图文朋友圈 |
| 151 | TIMELINE_LINK | 发链接朋友圈 |
| 152 | BROADCAST_TEXT | 群发文字 |
| 153 | BROADCAST_IMAGE | 群发图片 |
| 154 | BROADCAST_VOICE | 群发语音 |
| 155 | SCAN_QRCODE_JOIN_CHATROOM | 扫码入群 |
| 156 | SCAN_QRCODE_ADD_FRIEND | 扫码加好友 |
| 157 | SET_TIMELINE_COVER | 设朋友圈封面 |

### 4.4 管理相关 (200-305)

| 类型码 | 常量名 | 中文说明 |
|--------|--------|---------|
| 200 | UPDATE_IP | 更新IP |
| 201 | CLEAR_CHAT_MSG | 清空聊天记录 |
| 202 | REBOOT | 重启 |
| 203 | SYNC_BASIC_INFO | 同步机器人信息 |
| 204 | SYNC_CONF | 同步配置 |
| 300 | ALTER_NICKNAME | 修改昵称 |
| 301 | ALTER_AVATAR | 修改头像 |
| 303 | ALTER_SIGNATURE | 修改签名 |
| 304 | ALTER_GENDER | 修改性别 |

---

## 五、任务消息格式

### 5.1 云端下发的任务消息

```javascript
// 通用结构
{
    "id": "task_123456789",       // 任务ID（唯一）
    "type": 100,                  // 任务类型
    "createTime": 1642000000,     // 创建时间（秒级时间戳）
    "wxId": "wxid_xxx",           // 执行机器人ID
    
    // 群聊相关
    "chatroom": "12345@chatroom", // 群ID
    
    // 目标用户
    "toUsernames": ["wxid_target1", "wxid_target2"],
    
    // 消息内容
    "content": "消息内容或文件URL",
    "contentList": ["消息1", "消息2"],  // 多段内容
    "weChatMsgType": 1,           // 微信消息类型
    "ext": "filename.jpg",        // 扩展信息
    
    // 好友相关
    "ticket": "v3_xxx",           // 好友申请凭证
    
    // @功能
    "atList": ["wxid_at1"],       // @用户列表
    
    // 其他
    "serialNo": 1,                // 序列号
    "priority": 1,                // 优先级
}
```

### 5.2 私聊消息示例

```json
{
    "id": "task_20240101_001",
    "type": 100,
    "createTime": 1704067200,
    "wxId": "wxid_robot123",
    "toUsernames": ["wxid_friend456"],
    "content": "您好，欢迎咨询！",
    "weChatMsgType": 1
}
```

### 5.3 群发图片示例

```json
{
    "id": "task_20240101_002",
    "type": 1,
    "createTime": 1704067200,
    "wxId": "wxid_robot123",
    "chatroom": "12345678@chatroom",
    "content": "https://oss.example.com/images/promo.jpg",
    "weChatMsgType": 3,
    "ext": "promo.jpg"
}
```

### 5.4 踢人示例

```json
{
    "id": "task_20240101_003",
    "type": 3,
    "createTime": 1704067200,
    "wxId": "wxid_robot123",
    "chatroom": "12345678@chatroom",
    "toUsernames": ["wxid_bad_user1", "wxid_bad_user2"]
}
```

---

## 六、任务执行结果上报

### 6.1 结果消息格式

```javascript
// 任务执行成功
{
    "type": "task_result",
    "taskId": "task_20240101_001",
    "wxId": "wxid_robot123",
    "status": 0,                     // 0=成功
    "msgSvrId": "12345678901234567890",  // 消息服务器ID
    "timestamp": 1704067210000,
}

// 任务执行失败
{
    "type": "task_result",
    "taskId": "task_20240101_001",
    "wxId": "wxid_robot123",
    "status": 1,                     // 1=失败
    "errorCode": "TIMEOUT",
    "errorMsg": "文件下载超时",
    "timestamp": 1704067210000,
}
```

### 6.2 登录状态上报

```javascript
// 登录成功
{
    "type": "robot_login",
    "username": "wxid_xxx",
    "robotLoginRecord": {
        "username": "wxid_xxx",
        "nickname": "机器人昵称",
        "headImg": "https://wx.qlogo.cn/...",
        "wxVersion": "3.8.0.18",
        "clientVersion": "5.4.2-release01",
        "clientType": 8,
        "clientMsgSource": 0
    }
}

// 登出
{
    "type": "logout",
    "username": "wxid_xxx",
    "timestamp": 1704067200
}
```

---

## 七、任务防重机制

### 7.1 过期检查

```javascript
// 默认3小时过期
const expireHours = apolloConfig.mqttTaskExpireHours || 3;
const expireTime = expireHours * 60 * 60 * 1000;

if (dataInfo.createTime * 1000 < Date.now() - expireTime) {
    logUtil.customLog(`任务过期（${expireHours}小时），跳过`);
    return;
}
```

### 7.2 去重锁

```javascript
// 去重锁 Map
let mqttTaskMapLock = new Map();

// 检查是否已处理
if (receiveId && mqttTaskMapLock.has(receiveId)) {
    logUtil.customLog(`任务重复，跳过`);
    return;
}

// 添加去重锁
mqttTaskMapLock.set(receiveId, {
    wxId: wxId,
    timestamp: Date.now(),
    processed: true
});

// 100分钟后自动清理
```

### 7.3 为什么需要去重？

MQTT 使用 QoS=1（至少一次投递），可能导致消息重复：
- 网络抖动时重发
- 客户端断线重连后重新投递

---

## 八、任务队列机制

### 8.1 消息发送队列

对于 type=100（私聊消息），使用队列控制发送频率：

```javascript
if (dataInfo.type === 100) {
    // 进入队列，按间隔执行
    executeWithDelay(wxId, () => {
        execute(wxId, serverTaskBO);
    });
} else {
    // 其他任务随机延迟后立即执行
    await sleep(Math.ceil(Math.random() * 1000));
    execute(wxId, serverTaskBO);
}
```

### 8.2 发送间隔配置

```javascript
// 从 Apollo 获取动态配置
const apolloConfig = {
    taskDefaultWaitTime: 200,  // 默认200ms间隔
};

// 使用
await sleep(apolloConfig.taskDefaultWaitTime);
```

---

## 九、错误处理

### 9.1 文件下载失败

```javascript
if (content.startsWith('http')) {
    const fileInfo = await FileDownloadUtil.downloadAsyncReturnFileInfo(content, ext);
    
    if (!fileInfo.filePath) {
        // 下载失败，上报超时
        TimeOutResponse.fileDownloadTimeOutResponse(serverTask, wxId);
        return true;
    }
}
```

### 9.2 机器人掉线

```javascript
const execute = (wxId, serverTaskBO) => {
    const registry = RegistryConfig.getRegistryByKey(wxId, 'wxid');
    
    if (!registry) {
        logUtil.customLog(`[wxid-${wxId}] 机器人掉线，任务无法下发`);
        return;
    }
    
    runTask(wxId, serverTaskBO, registry);
};
```

---

## 十、调试指南

### 10.1 日志关键字

| 关键字 | 含义 |
|-------|------|
| `[接收mqtt任务]` | 收到云端任务 |
| `[开始处理任务]` | 任务开始执行 |
| `消息过期` | 任务超过3小时未执行 |
| `消息重复` | 任务已被处理过 |
| `文件下载` | 媒体文件下载状态 |
| `机器人掉线` | 目标微信已断开 |

### 10.2 问题排查

```
任务没执行？
    │
    ├── 1. 搜索 "[接收mqtt任务]" 确认是否收到
    │
    ├── 2. 搜索 "消息过期" 或 "消息重复" 确认是否被过滤
    │
    ├── 3. 搜索 "机器人掉线" 确认机器人状态
    │
    └── 4. 搜索 "[发送逆向]" 确认是否发到逆向
```

---

## 十一、相关文档

- [08-MQTT任务类型.md](./08-MQTT任务类型.md) - 完整任务类型定义
- [01-消息发送业务.md](./01-消息发送业务.md) - 消息发送详细流程
- [技术架构/07-四大通信机制汇总.md](../技术架构/07-四大通信机制汇总.md) - 通信机制全景
- [技术点/04-MQTT消息队列.md](../技术点/04-MQTT消息队列.md) - MQTT技术详解
