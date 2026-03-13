# 09 — 前端 WebSocket 通信机制（galaxy ↔ frontServer）

> **文档定位**：`galaxy`（React 渲染进程）通过 WebSocket 连接到 `galaxy-client` 主进程侧的 `frontServer.js`（Node.js WebSocket Server）。  
> 这是**当前唯一的前端↔主进程实时消息通道**，旧的 Java 服务 WebSocket 已废弃。  
> 同步请求（如配置读写、文件操作）使用 `electron-better-ipc`（IPC），WebSocket 只负责**异步/主动推送**场景。

---

## 1. 整体定位：WebSocket 在前端↔主进程通信中的角色

```
┌─────────────────────────────────────────────────────────────────────┐
│  galaxy（React 渲染进程）                                            │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐         │
│  │ menu.html│   │ sub.html │   │ load.html│   │ vpn.html │         │
│  └────┬─────┘   └────┬─────┘   └──────────┘   └──────────┘         │
│       │              │                                              │
│       │  WebSocket   │ ipc.sendToHost('sub-message')                │
│       │  ws://127.0.0.1:port/websocket                              │
│       ▼              ▼                                              │
│  ┌───────────────────────┐                                          │
│  │ thunks.js (menu 入口) │ ← 唯一 WebSocket 管理者                   │
│  └───────────┬───────────┘                                          │
└──────────────┼──────────────────────────────────────────────────────┘
               │ WebSocket 连接
┌──────────────▼──────────────────────────────────────────────────────┐
│  galaxy-client（Electron 主进程）                                     │
│  ┌──────────────────────┐                                           │
│  │ frontServer.js       │ ← WebSocket Server                       │
│  │ (port: 13323~13423)  │                                           │
│  └──────┬───────────────┘                                           │
│         ├─→ frontFlowInBound  → 路由到业务 task-front                 │
│         ├─→ frontFlowOutBound → sendToFront → 推送回前端               │
│         └─→ frontSend.js      → 主动推送 (getAllConfig, userlist…)    │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.1 与 IPC 的职责边界

| 维度 | electron-better-ipc | WebSocket (frontServer) |
|------|---------------------|-------------------------|
| 方向 | 渲染进程 → 主进程（请求/响应） | 双向（主进程主动推送为主） |
| 模式 | Promise 化同步调用 | 异步消息流 |
| 典型场景 | 配置读写、文件操作、端口获取 | 账号列表推送、消息转发、状态变更 |
| 连接对象 | BrowserWindow webContents | WebSocket.Server 连接 |
| 适用窗口 | 所有窗口 | 仅 menu.html 直连 |

---

## 2. galaxy-client 服务端

### 2.1 WebSocket Server 创建

**文件**：`galaxy-client/src/msg-center/core/websocket/index.js`

```javascript
const WebSocket = require('ws');
const frontConnection = require('../data-config/frontConnection');

const portRange = [13323, 13423];
const Host = '0.0.0.0';

const WebSocketServer = {
  port: null,
  server: null,
  async startServer() {
    let port = null;
    let portIndex = 0;
    const portList = this.getPortList();
    while (!port) {
      const candidatePort = portList[portIndex];
      try {
        this.server = new WebSocket.Server({ host: Host, port: candidatePort });
        this.server.on('connection', this.handleConnection.bind(this));
        await new Promise(resolve => this.server.once('listening', resolve));
        port = candidatePort;
      } catch (error) {
        // 端口被占用，尝试下一个端口
      }
      portIndex += 1;
    }
    this.port = port;
    global.port = port;  // 挂载到 global，供 IPC 读取
  },
  handleConnection(connection) {
    this.client = connection;
    frontConnection.channel = connection;
    connection.send('欢迎连接到websocket服务器');
    connection.on('close', () => {
      this.client = null;
      frontConnection.channel = null;
    });
  },
};
```

关键设计：

- **端口探测**：从 13323 到 13423，逐个尝试绑定，遇端口占用自动跳下一个
- **单连接模型**：`frontConnection.channel` 只保存最后一个连接，前端只有 menu 一个 WebSocket 客户端
- **全局端口**：`global.port` 用于 IPC 的 `get-ws-port` handler 读取

### 2.2 frontServer.js — 消息分发入口

**文件**：`galaxy-client/src/msg-center/core/front/frontServer.js`

```javascript
const FrontServer = {
    start() {
        WebSocketServer.startServer().then(() => {
            console.log(WebSocketServer.port);
        });
        WebSocketServer.server?.on('connection', (connection) => {
            connection.on('message', message => {
                const msgObj = message ? JSON.parse(message) : null;
                if (msgObj) {
                    if (msgObj.cmdId === 'system') {
                        if (msgObj.body === 'online') {
                            frontConnection.channel = connection;
                            frontConnection.isLogin = true;
                        } else if (msgObj.body === 'offline') {
                            frontConnection.channel = null;
                            frontConnection.isLogin = false;
                        }
                    }
                    else if(msgObj.cmdId === 'webtest') {
                        wsPushTest.onMessage(msgObj);
                    }
                    else {
                        frontFlowInBound(message);
                    }
                }
            })
        });
    },
};
```

消息分类路由：

| cmdId | 处理方式 | 说明 |
|-------|---------|------|
| `system` + `online` | 设置 `frontConnection.channel/isLogin` | 前端上线通知 |
| `system` + `offline` | 清空连接引用 | 前端下线通知 |
| `webtest` | `wsPushTest.onMessage` | WebSocket 推送测试 |
| 其他 | `frontFlowInBound(message)` | 交由调度层处理 |

### 2.3 frontConnection — 连接状态单例

**文件**：`galaxy-client/src/msg-center/core/data-config/frontConnection.js`

```javascript
const frontConnection = {
    login: false,
    channel: null,  // WebSocket 连接实例
};
module.exports = frontConnection;
```

全局引用位置：

| 文件 | 用途 |
|------|------|
| `frontServer.js` | 设置 `channel` 和 `isLogin` |
| `websocket/index.js` | 连接建立/断开时更新 `channel` |
| `sendToFrontUtil.js` | 通过 `channel.send()` 发消息 |
| `PingTimer.js` | 读取 `login` 判断设备在线状态 |
| `killAppTask.js` | 关闭时调用 `channel?.close()` |
| `frontLoginTask.js` | 设置 `login = true` |
| `FrontLogoutTask.js` | 设置 `login = false` |

### 2.4 frontFlowInBound — 前端消息路由

**文件**：`galaxy-client/src/msg-center/dispatch-center/dispatch/frontFlowInBound.js`

前端发来的消息通过 `cmdId` 映射到具体任务处理器：

| cmdId | 处理器 | 说明 |
|-------|--------|------|
| `getAllConfig` | GET_ALL_CONFIG handler | 获取所有微信实例配置 |
| `forward` | FORWARD handler | 转发指令到逆向 IPC |
| `upload` | UPLOAD handler | 文件上传请求 |
| `frontLogin` | FRONT_LOGIN handler | 前端登录 |
| `frontLogout` | FRONT_LOGOUT handler | 前端退出 |
| `getMqttStatus` | GET_MQTT_STATUS handler | 获取 MQTT 连接状态 |
| `killAll` | KILL_ALL handler | 停止所有进程 |
| `killJava` | KILL_JAVA handler | 停止 Java 进程 |
| `reportLogicWorking` | REPORT_LOGIC_WORKING handler | 上报逻辑工作状态 |

所有消息处理使用 `AsyncLock` 进行并发保护，避免同一消息被重复处理。

### 2.5 frontFlowOutBound — 逆向消息推送到前端

**文件**：`galaxy-client/src/msg-center/dispatch-center/dispatch/frontFlowOutBound.js`

处理从逆向 IPC（微信/企微）回来的消息，决定是否推送给前端：

1. `SendFrontAspect.beforeSendMessageToFront` 做前置处理
2. 排除 `GalaxyTaskType.RECVMSG` 类型
3. 其它消息调用 `sendToFront` 推送

### 2.6 sendToFront — 消息格式化与过滤

**文件**：`galaxy-client/src/msg-center/core/front/sendToFront.js`

```
消息格式：
{
    cmdId: 'forward' | 'upload' | ...,
    channelId: '<微信实例ID>',
    wxid: '<微信ID>',
    body: { type: '...', data: {...} }
}
```

过滤规则：

- `NOT_SEND_MSG_TYPE` 中定义的消息类型不发送
- `noSendFrontType` 标记的消息不发送

### 2.7 sendToFrontUtil — 底层发送

**文件**：`galaxy-client/src/msg-center/core/front/sendToFrontUtil.js`

```javascript
const SendToFrontUtil = {
    FILTER_SET: new Set([GalaxyCallBackType.PONG, GalaxyCallBackType.CDNONERROR]),
    sendResponse2Front(taskType, response) {
        const message = JSON.stringify(response);
        if (!this.isFilter(JSON.stringify(bodyTemp))) return;
        if (frontConnection.channel) {
            frontConnection.channel.send(message, error => {
                if (error) {
                    reportLog({ name: 'SEND_FRONT_ERROR', ... });
                }
            });
        }
    },
    isFilter(message) {
        const {type} = JSON.parse(message);
        if (!type && this.FILTER_SET.has(type)) return false;
        return true;
    }
};
```

过滤 PONG、CDNONERROR 等心跳/状态类消息，避免无意义推送。

### 2.8 frontSend — 主动推送封装

**文件**：`galaxy-client/src/msg-center/dispatch-center/frontSend.js`

单例服务，封装多种主动推送接口：

| 方法 | 说明 |
|------|------|
| `sendMessageToFront(type, msg, channelId, wxId)` | 通用消息推送 |
| `sendGetAllConfig()` | 推送所有微信实例配置 |
| `sendFriendList(channelId, wxId)` | 推送好友列表（从 SQLite 查询后推送） |
| `sendWxFrinedList(channelId, wxId)` | 推送微信好友列表 |
| `sendWkFrinedList(channelId, wxId)` | 推送企微好友列表 |
| `sendJoinChatroom(...)` | 推送加群结果 |

---

## 3. galaxy 前端侧

### 3.1 端口获取流程

**文件**：`galaxy/src/entries/menu/store/thunks.js`

```javascript
async function init(dispatch, getState) {
    let port;
    try {
        port = await ipc.callMain('get-ws-port');
    } catch (error) {
        console.report('WsPortError', error.message, { error });
    }
    if (!port) {
        setTimeout(() => { init(dispatch, getState); }, delay);
        return;
    }
    // ...
}
```

流程：
1. 通过 `ipc.callMain('get-ws-port')` 调用主进程
2. 主进程 `ipc.js` 中的 handler 返回 `global.port`
3. 如果获取失败，延迟后重试（开发环境延迟极长防止错误刷屏）

### 3.2 WebSocket URL 构建

```javascript
let websocketURL = null;
if (window.process.platform === 'win32') {
    websocketURL = `ws://127.0.0.1:${port}/websocket`;
} else {
    // 开发环境（macOS）直连远程 Windows 机器
    websocketURL = 'ws://10.22.13.245:13323/websocket';
}
```

- **生产环境**（Windows）：`ws://127.0.0.1:{port}/websocket`
- **开发环境**（macOS）：写死远程 Windows 机器 IP（因为逆向 DLL 只能在 Windows 运行）

### 3.3 连接建立 — 防止死灰复燃

```javascript
if (ws instanceof WebSocket) {
    ws.onopen = _.noop;
    ws.onclose = _.noop;
    ws.onerror = _.noop;
    ws.onmessage = _.noop;
    ws.close();
}
ws = window.ws = new WebSocket(websocketURL);
dispatch(setWsMenu({ wsMenu: ws }));
```

重连前先将旧连接的所有事件处理器置为空函数再关闭，避免旧连接的 `onclose` 事件触发再次重连导致连接风暴。

### 3.4 ws.onopen — 初始化

```javascript
ws.onopen = (res) => {
    ws.send(JSON.stringify({ cmdId: 'getAllConfig' }));
};
```

连接建立后立即发送 `getAllConfig` 命令，获取所有已连接微信实例的配置信息。

### 3.5 ws.onclose — 断线重连

```javascript
ws.onclose = () => {
    setTimeout(() => {
        init(dispatch);
    }, delay);
};
```

- **生产环境**：`delay = 100ms`，快速重连
- **开发环境**：`delay = 1000000000`（约 11.5 天），避免开发时无服务端导致重连刷屏

注意：这是固定延迟重连，不是指数退避。因为本地 WebSocket 连接极其稳定，断线通常意味着主进程重启。

### 3.6 ws.onerror — 全量离线上报

```javascript
ws.onerror = () => {
    const allConfig = store.getState().allConfig;
    allConfig.forEach((config) => {
        if (config.wxInfo?.wxid) {
            httpReportWxOffline(config.wxInfo.wxid);
        }
    });
};
```

WebSocket 连接出错时，将所有微信账号标记为离线并上报服务端。

### 3.7 ws.onmessage — 消息路由

```javascript
ws.onmessage = (e) => {
    const { data } = e;
    if (isJson(data)) {
        const msg = JSON.parse(data);
        const { cmdId, channelId } = msg;
        if (cmdId === 'getAllConfig') {
            handleGetAllConfig(dispatch, msg);
            dispatch(setNews({ news: msg }));
        } else if (cmdId === 'sendNotice') {
            // 推送通知消息
            store.dispatch(updateNoticeList({ ... }));
        } else if (cmdId === 'forward' || cmdId === 'upload' || ...) {
            // 消息类型子路由
            if (msg.body?.type === 'login') { ... }
            if (msg.body?.type === 'bugreport') { ... }
            if (msg.body?.type === 'userlist') { ... }
            if (msg.body?.type === 'chatroomUpdate') { ... }
            // ...
            dispatch(setNews({ news: msg }));
        }
    }
};
```

消息路由表：

| cmdId | body.type | 处理 |
|-------|-----------|------|
| `getAllConfig` | — | 更新全局配置，广播给子页面 |
| `sendNotice` | — | 更新通知列表 |
| `forward` | `login` | 更新微信登录状态 |
| `forward` | `bugreport` | 标记客户端崩溃 |
| `forward` | `userlist` | 更新好友/群列表 |
| `forward` | `chatroomUpdate` | 更新群信息 |
| `forward` | `getconversationimage` | 更新群头像 |
| `forward` | `getcustomerlabel` | 更新标签列表 |
| `forward` | `getlabelcustomer` | 更新标签成员 |
| `upload` | — | 触发文件上传事件 |
| `uploadVoice` | — | 更新语音信息 |
| `getMqttStatus` | — | 转发给子页面 |

### 3.8 handleGetAllConfig — 配置更新处理

```javascript
function handleGetAllConfig(dispatch, msg) {
    const { body } = msg;
    dispatch(setIsReceiveAllConfig({ isReceiveAllConfig: true }));
    if (Array.isArray(body) && body.length) {
        if (store.getState().isLoading) {
            setTimeout(() => dispatch(setIsLoading(false)), 800);
        }
        body.forEach((item) => {
            if (item.channelId) {
                oldItem = getOldItem(item.channelId);
                if (!oldItem) {
                    topList.push(item.channelId);
                    wsSendLogin(item.channelId);  // 新账号自动查询登录状态
                }
            }
        });
        if (topList.length === 1) {
            wsSendTop(topList[0]);  // 单个新增时自动置顶
        }
        if (!_.isEqual(oldConfig, body)) {
            dispatch(setAllConfig({ allConfig: body }));
        }
        oldConfig = body;
    }
}
```

关键逻辑：
- 新增微信实例时自动发送 `login` 查询
- 仅当配置真正变化时才触发 Redux dispatch（`_.isEqual` 比较）
- `oldConfig` 用于变化检测和微信上下线上报

### 3.9 wsSend — 安全发送封装

```javascript
export function wsSend(msg) {
    return () => {
        if (ws && ws.send && ws.readyState === 1) {
            if (msg?.body?.type === 'login') {
                const channelId = msg.channelId;
                const sendTime = Date.now();
                if (loginSendCache[channelId] && sendTime - loginSendCache[channelId] < 3000) {
                    return;  // 3 秒内不重复发送 login
                }
                loginSendCache[channelId] = sendTime;
            }
            ws.send(JSON.stringify(msg));
        }
    };
}
```

特点：
- 返回 thunk 函数，可通过 `store.dispatch(wsSend(msg))` 调用
- 检查 `readyState === 1` 确保连接处于 OPEN 状态
- `login` 消息有 3 秒去重保护

---

## 4. sub 窗口的消息转发机制

sub.html 窗口不直接连接 WebSocket，而是通过 webview IPC 与 menu 通信：

```
sub.html (webview)
    │
    │ ipc.sendToHost('sub-message', params)
    ▼
menu.html (App.js)
    │
    │ handleWsSend(msg) → wsSend(msg)
    ▼
galaxy-client (frontServer)
    │
    │ 处理后通过 frontSend 推送
    ▼
menu.html (App.js)
    │
    │ webviewSendById(channelId, 'parent-message', msg)
    │ or webviewBroadcast('parent-message', msg)
    ▼
sub.html (webview)
```

**文件**：`galaxy/src/entries/menu/App.js`

- `handleWsSend(msg)`：接收 sub 页面通过 `sub-message` 传来的消息，转发到 WebSocket
- 收到 WebSocket 消息后，通过 `webviewSendById` 或 `webviewBroadcast` 分发给对应 webview

---

## 5. 消息协议格式

### 5.1 前端 → 主进程

```json
{
    "cmdId": "forward",
    "channelId": "1234567890",
    "body": {
        "type": "queryuserinfotask",
        "userid": "wxid_xxx",
        "usertype": 7,
        "room": ""
    }
}
```

### 5.2 主进程 → 前端

```json
{
    "cmdId": "forward",
    "channelId": "1234567890",
    "wxid": "wxid_xxx",
    "body": {
        "type": "userlist",
        "friendList": [...],
        "data": { "wxid": "wxid_xxx" }
    }
}
```

### 5.3 getAllConfig 响应

```json
{
    "cmdId": "getAllConfig",
    "body": [
        {
            "channelId": "1234567890",
            "wxid": "wxid_xxx",
            "available": true,
            "workWx": false,
            "lastPongTime": 1710000000000,
            "wxInfo": {
                "wxid": "wxid_xxx",
                "nickname": "测试账号",
                "headimg": "https://...",
                "username": "xxx",
                "ver": 1879048192
            }
        }
    ]
}
```

---

## 6. 启动时序

```
1. AppStart.run()
    └─→ FrontStart.run()
        └─→ FrontServer.start()
            └─→ WebSocketServer.startServer()  → 绑定端口
            └─→ server.on('connection')         → 监听连接

2. galaxy menu.html 加载完成
    └─→ App.js → handleWsInit() → wsInit()
        └─→ thunks.js → init(dispatch)
            └─→ ipc.callMain('get-ws-port')     → 获取端口
            └─→ new WebSocket(url)              → 建立连接
            └─→ ws.onopen → send('getAllConfig') → 请求配置
            └─→ ws.onmessage                    → 开始收消息
```

---

## 7. 连接状态监控

### 7.1 前端心跳

galaxy 前端通过 `system` + `online/offline` 消息通知主进程连接状态：

```javascript
// 上线
ws.send(JSON.stringify({ cmdId: 'system', body: 'online' }));
// 下线
ws.send(JSON.stringify({ cmdId: 'system', body: 'offline' }));
```

### 7.2 主进程侧状态使用

- `PingTimer.js` 中通过 `frontConnection.login` 判断设备状态（`deviceStatus: frontConnection.login ? 1 : 0`）
- 影响 MQTT 心跳上报的 `heartBeatInfo.deviceStatus` 字段

---

## 8. 错误处理

### 8.1 WebSocket 发送错误

`sendToFrontUtil.js` 中 `channel.send()` 的回调检测错误：

```javascript
frontConnection.channel.send(message, error => {
    if (error) {
        reportLog({
            name: 'SEND_FRONT_ERROR',
            wxid: response.wxid,
            errorName: error.name,
            errorMessage: error.message,
            errorStack: error.stack
        });
    }
});
```

### 8.2 前端重连机制

- `ws.onclose` 触发固定延迟重连
- `ws.onerror` 将所有微信标记为离线并上报
- 获取端口失败时延迟重试

### 8.3 连接为空保护

所有发送前都检查 `frontConnection.channel` 是否存在：

```javascript
if (frontConnection.channel) {
    frontConnection.channel.send(message, ...);
} else {
    logUtil.customLog('通知前端失败, channel 为空');
}
```

---

## 9. 常见问题排查

### 9.1 端口获取失败

**现象**：前端一直显示 loading，无法获取微信列表

**排查**：
1. 检查 `galaxy-client` 是否正常启动（frontServer.start 日志）
2. 检查 `global.port` 是否被赋值（`ipc.js` 中 `get-ws-port` handler 日志）
3. 检查端口范围 13323-13423 是否全部被占用

### 9.2 消息推送到前端无响应

**排查**：
1. `frontConnection.channel` 是否为 null（前端未连接或已断开）
2. `frontConnection.isLogin` / `frontConnection.login` 状态
3. 消息类型是否在 `NOT_SEND_MSG_TYPE` 或 `FILTER_SET` 中被过滤

### 9.3 开发环境 WebSocket 连接不上

**原因**：开发时 galaxy 在 macOS 上运行，galaxy-client 在 Windows 上运行

**解决**：修改 `thunks.js` 中 `websocketURL` 为 Windows 机器的 IP:Port

---

## 10. 关键文件索引

| 文件 | 路径 | 职责 |
|------|------|------|
| WebSocket Server | `galaxy-client/src/msg-center/core/websocket/index.js` | 创建 WS 服务端，端口探测 |
| frontServer | `galaxy-client/src/msg-center/core/front/frontServer.js` | 消息分发入口 |
| frontConnection | `galaxy-client/src/msg-center/core/data-config/frontConnection.js` | 连接状态单例 |
| sendToFrontUtil | `galaxy-client/src/msg-center/core/front/sendToFrontUtil.js` | 底层发送+过滤 |
| sendToFront | `galaxy-client/src/msg-center/core/front/sendToFront.js` | 消息格式化 |
| frontSend | `galaxy-client/src/msg-center/dispatch-center/frontSend.js` | 主动推送封装 |
| frontFlowInBound | `galaxy-client/src/msg-center/dispatch-center/dispatch/frontFlowInBound.js` | 前端消息路由 |
| frontFlowOutBound | `galaxy-client/src/msg-center/dispatch-center/dispatch/frontFlowOutBound.js` | 逆向消息推送 |
| thunks.js | `galaxy/src/entries/menu/store/thunks.js` | 前端 WS 管理 |
| App.js | `galaxy/src/entries/menu/App.js` | 消息转发到子页面 |
| frontStart.js | `galaxy-client/src/msg-center/start/frontStart.js` | 启动入口 |

---

*文档生成时间：2026-03-13 | 基于 galaxy-client + galaxy 仓库实际代码分析*
