# 业务逻辑文档索引

> Galaxy-Client 核心业务逻辑详解

---

## 文档目录

| 序号 | 文档 | 描述 | 核心文件 |
|-----|------|------|---------|
| 1 | [消息发送业务](./01-消息发送业务.md) | 微信/企微消息发送完整流程 | `task-mqtt/mqttChatService.js` |
| 2 | [好友管理业务](./02-好友管理业务.md) | 通过/删除好友、修改备注等 | `convert-service/friendsListResponseService.js` |
| 3 | [群聊管理业务](./03-群聊管理业务.md) | 踢人、邀请、改群名、群公告 | `task-mqtt/mqttKickOutService.js` |
| 4 | [登录登出业务](./04-登录登出业务.md) | 微信/企微登录登出流程 | `convert-service/loginService.js` |
| 5 | [数据同步业务](./05-数据同步业务.md) | 🔄 好友/群列表数据流详解 | `handle/wxUserListResponseMsgHandler.js` |
| 6 | [任务回执机制](./06-任务回执机制.md) | 三段式消息追踪机制 | `handle/msgHandleBase.js` |
| 7 | [定时任务](./07-定时任务.md) | 心跳、任务检查等定时任务 | `timer/` |
| 8 | [MQTT任务类型](./08-MQTT任务类型.md) | 所有MQTT任务类型枚举 | `data-config/SunTaskType.js` |
| 9 | [微信与企微差异对比](./09-微信与企微差异对比.md) | 微信和企业微信实现差异 | 多个模块 |
| 10 | [错误处理与排错指南](./10-错误处理与排错指南.md) | 常见问题诊断与解决方案 | 日志系统 |
| 11 | [MQTT业务场景详解](./11-MQTT业务场景详解.md) | 云端任务下发与执行详解 | `task-mqtt/*.js` |
| 12 | [前端交互业务](./12-前端交互业务.md) | 🆕 Web前端与主进程交互 | `task-front/*.js` |
| 13 | [问题排查指南-好友列表空白](./13-问题排查指南-好友列表空白.md) | 🔧 排查模板+阿里云SLS查询指南 | 日志系统 |
| 20 | [修改群公告业务与排查指南](./20-修改群公告业务与排查指南.md) | 🔧 群公告链路+AI排查提示词+通用排查模板 | `announcementResponse.js` |
| 21 | [IPC双向通信架构详解](./21-IPC双向通信架构详解.md) | 🏗️ 下发/回收链路+连接管理+消息路由+日志速查 | `asyncSelectTask.js` `reverseSend.js` |
| 22 | [微信好友列表获取与上报链路](./22-微信好友列表获取与上报链路.md) | 🔧 好友列表完整链路+云端上报+阿里云分词问题+真实案例 | `wxUserListResponseMsgHandler.js` `asyncTask.js` |
| 23 | [企微群发消息排查指南](./23-企微群发消息排查指南.md) | 🔧 群发链路+重复发送分析+超长taskId查询+MQTT日志节点对照 | `mqttClientBase.js` `mqttWorkWxChatService.js` |
| 24 | [MQTT消息机制深度解析](./24-MQTT消息机制深度解析.md) | 🏗️ QoS/ACK双机制+持久会话+Broker补发+去重锁+延迟队列+排查速查表 | `mqttClientBase.js` `mqttHelper.js` `mqTask.js` |
| 25 | [群发消息发送失败排查实战](./25-群发消息发送失败排查实战.md) | 🔧 真实工单排查全过程+完整数据流+ID关系+三段式回执+前端状态逻辑 | `sendObjects.js` `helper.js` `mqttClientBase.js` |
| 26 | [微信助手工单排查通用方法论](./26-微信助手工单排查通用方法论.md) | 🔧 消息失败专项排查路径+通用分层排查思路+海量日志分析策略 | 日志系统+SLS |
| 27 | [好友群列表同步与群成员缓存链路分析](./27-好友群列表同步与群成员缓存链路分析.md) | 🔧 USERLIST→GET_USER_LIST 完整链路+场景隔离+踢私加好友失效根因 | `forwardTask.js` `wxUserListResponseMsgHandler.js` |
| 28 | [新增群发页面搜索功能与数据流分析](./28-新增群发页面搜索功能与数据流分析.md) | 🔍 Drawer三栏结构+PinyinMatch名称搜索+前端过滤链+误匹配根因分析 | `sendSetting/` `broadCast/store/thunks.js` |

---

## 业务架构总览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              业务流程总览                                     │
└─────────────────────────────────────────────────────────────────────────────┘

                          ┌──────────────────┐
                          │   瓦力云后台      │
                          │  (任务下发中心)   │
                          └────────┬─────────┘
                                   │ MQTT
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Galaxy-Client 消息中心                                  │
│                                                                             │
│  ┌─────────────┐  ┌─────────────────────┐  ┌─────────────────────────────┐  │
│  │ MQTT接收    │  │    任务路由分发      │  │      业务处理器              │  │
│  │mqttClientBase│─►│ mqttClientBase.js   │─►│  task-mqtt/*.js             │  │
│  │             │  │ (根据type路由)       │  │  (微信/企微消息处理)         │  │
│  └─────────────┘  └─────────────────────┘  └──────────────┬──────────────┘  │
│                                                           │                 │
│                                                           ▼                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        消息分发中心                                  │   │
│  │  dispatchInBound.js  ←→  reverseSend.js  ←→  dispatchOutBound.js   │   │
│  │     (入站分发)              (IPC发送)           (出站分发)           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                     │                                       │
│                                     │ IPC 管道                              │
│                                     ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        逆向消息处理                                  │   │
│  │  convert-service/*.js  ←→  msgHandleBase.js  ←→  cloudFlowOutBound │   │
│  │     (消息解析)              (三段式处理)          (云端上报)         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   │ IPC 管道
                                   ▼
                          ┌──────────────────┐
                          │  逆向服务 DLL    │
                          │  (操作微信进程)  │
                          └────────┬─────────┘
                                   │ DLL注入
                                   ▼
                          ┌──────────────────┐
                          │  微信/企业微信   │
                          │   PC客户端       │
                          └──────────────────┘
```

---

## 核心业务模块

### 1. 任务接收层 (MQTT)

```
src/msg-center/core/mq/
├── mqttClientBase.js      # MQTT客户端核心，负责连接、订阅、消息分发
├── mqttHelper.js          # MQTT连接辅助类
├── mqttConfig.js          # MQTT配置
└── mqttClass.js           # MQTT类封装
```

**职责**:
- 接收云端下发的任务消息
- 根据任务类型(type)路由到对应处理器
- 任务去重、过期检查

### 2. 任务处理层 (Business)

```
src/msg-center/business/
├── task-mqtt/             # MQTT任务处理器
│   ├── mqttChatService.js           # 群发消息
│   ├── mqttKickOutService.js        # 踢人
│   ├── mqttFriendPassService.js     # 通过好友
│   └── wkwx/                        # 企业微信专用
├── convert-service/       # 逆向返回消息处理
│   ├── loginService.js              # 登录处理
│   ├── recvMsgService.js            # 接收消息处理
│   └── friendsListResponseService.js # 好友列表处理
└── convert-response/      # 任务响应处理
```

**职责**:
- 解析MQTT任务参数
- 构建发送给逆向的任务格式
- 处理逆向返回的结果

### 3. 消息分发层 (Dispatch)

```
src/msg-center/dispatch-center/
├── dispatchInBound.js     # 入站消息分发（→逆向）
├── dispatchOutBound.js    # 出站消息分发（逆向→）
├── reverseSend.js         # 向逆向发送消息
├── mqttSend.js            # 向云端发送消息
├── frontSend.js           # 向前端发送消息
└── handle/
    ├── msgHandleBase.js   # 消息处理基类（三段式机制）
    ├── wxMsgHandle.js     # 微信消息处理
    └── workWxMsgHandle.js # 企微消息处理
```

**职责**:
- 统一消息入口/出口
- 任务状态跟踪（三段式机制）
- 多端消息路由（云端/前端/逆向）

### 4. 数据访问层 (DAO)

```
src/msg-center/business/
├── dao-model/             # 数据模型定义
└── dao-service/           # 数据服务
    ├── friendService.js              # 好友数据
    ├── chatroomInfoService.js        # 群信息
    ├── chatroomMemberinfoService.js  # 群成员
    └── workwx/                       # 企微数据服务
```

**职责**:
- 本地SQLite数据读写
- 数据缓存管理
- 数据同步到云端

---

## 快速定位指南

### 按功能查找

| 我想了解... | 查看文档 | 核心代码 |
|------------|---------|---------|
| 消息如何发送到微信 | [消息发送业务](./01-消息发送业务.md) | `task-mqtt/mqttChatService.js` |
| 如何踢人出群 | [群聊管理业务](./03-群聊管理业务.md) | `task-mqtt/mqttKickOutService.js` |
| 登录后做了什么 | [登录登出业务](./04-登录登出业务.md) | `convert-service/loginService.js` |
| 任务结果如何上报 | [任务回执机制](./06-任务回执机制.md) | `handle/msgHandleBase.js` |
| 所有任务类型有哪些 | [MQTT任务类型](./08-MQTT任务类型.md) | `data-config/SunTaskType.js` |

### 按代码路径查找

| 代码路径 | 功能说明 |
|---------|---------|
| `core/mq/` | MQTT通信相关 |
| `core/reverse/` | IPC逆向通信 |
| `core/front/` | WebSocket前端通信 |
| `business/task-mqtt/` | MQTT任务处理器 |
| `business/convert-service/` | 逆向返回消息处理 |
| `dispatch-center/` | 消息分发中心 |
| `business/timer/` | 定时任务 |
