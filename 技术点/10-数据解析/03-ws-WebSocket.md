# ws WebSocket

> Node.js WebSocket 实现

---

## 一、技术简介

### 1.1 什么是 WebSocket

WebSocket 是全双工通信协议：

- **持久连接**：一次握手，持续通信
- **双向通信**：服务端可主动推送
- **低延迟**：无需轮询
- **轻量**：头部开销小

### 1.2 ws 库

`ws` 是 Node.js 最流行的 WebSocket 实现：

- **高性能**：C++ 实现核心功能
- **完整实现**：支持所有 WebSocket 特性
- **轻量**：无额外依赖

---

## 二、项目中的使用

### 2.1 使用位置

```
src/msg-center/core/websocket/index.js     # WebSocket 服务器
src/msg-center/core/front/frontServer.js   # 前端通信服务
src/msg-center/core/front/frontSend.js     # 消息发送
```

### 2.2 WebSocket 服务器实现

```javascript
// src/msg-center/core/websocket/index.js

const WebSocket = require('ws');
const logUtil = require('../../../init/log');

let wss = null;
let wsPort = null;

// 端口范围
const START_PORT = 19900;
const END_PORT = 19999;

/**
 * 初始化 WebSocket 服务器
 */
async function initWebSocketServer() {
    // 查找可用端口
    for (let port = START_PORT; port <= END_PORT; port++) {
        try {
            wss = new WebSocket.Server({ port });
            wsPort = port;
            logUtil.customLog(`[WebSocket] 服务启动在端口 ${port}`);
            break;
        } catch (error) {
            if (error.code === 'EADDRINUSE') {
                continue;  // 端口被占用，尝试下一个
            }
            throw error;
        }
    }

    if (!wss) {
        throw new Error('无法找到可用端口');
    }

    // 连接事件
    wss.on('connection', handleConnection);

    // 错误事件
    wss.on('error', (error) => {
        logUtil.error('[WebSocket] 服务器错误', error);
    });

    return { wss, wsPort };
}

/**
 * 处理新连接
 */
function handleConnection(ws, req) {
    const clientIp = req.socket.remoteAddress;
    logUtil.customLog(`[WebSocket] 新连接: ${clientIp}`);

    // 消息事件
    ws.on('message', (data) => {
        handleMessage(ws, data);
    });

    // 关闭事件
    ws.on('close', () => {
        logUtil.customLog(`[WebSocket] 连接关闭: ${clientIp}`);
    });

    // 错误事件
    ws.on('error', (error) => {
        logUtil.error(`[WebSocket] 客户端错误: ${clientIp}`, error);
    });

    // 发送欢迎消息
    ws.send(JSON.stringify({ type: 'welcome', port: wsPort }));
}

/**
 * 处理消息
 */
function handleMessage(ws, data) {
    try {
        const message = JSON.parse(data.toString());
        logUtil.customLog(`[WebSocket] 收到消息: ${message.type}`);

        // 分发到对应处理器
        dispatchMessage(ws, message);

    } catch (error) {
        logUtil.error('[WebSocket] 消息解析失败', error);
    }
}

/**
 * 广播消息
 */
function broadcast(message) {
    if (!wss) return;

    const data = JSON.stringify(message);

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

/**
 * 获取端口
 */
function getPort() {
    return wsPort;
}

module.exports = {
    initWebSocketServer,
    broadcast,
    getPort
};
```

### 2.3 前端通信服务

```javascript
// src/msg-center/core/front/frontServer.js

const WebSocket = require('ws');
const { dispatchOutBound } = require('../dispatch/dispatchOutBound');
const logUtil = require('../../../init/log');

let frontWs = null;

/**
 * 初始化前端 WebSocket 连接
 */
function initFrontServer(wss) {
    wss.on('connection', (ws) => {
        frontWs = ws;

        ws.on('message', (data) => {
            handleFrontMessage(ws, data);
        });

        ws.on('close', () => {
            frontWs = null;
        });
    });
}

/**
 * 处理前端消息
 */
async function handleFrontMessage(ws, data) {
    try {
        const message = JSON.parse(data.toString());

        switch (message.type) {
            case 'system':
                handleSystemMessage(message);
                break;

            case 'command':
                // 转发到消息中心处理
                await dispatchOutBound(message.data);
                break;

            default:
                logUtil.warn(`[FrontServer] 未知消息类型: ${message.type}`);
        }

    } catch (error) {
        logUtil.error('[FrontServer] 处理消息失败', error);
    }
}

/**
 * 处理系统消息
 */
function handleSystemMessage(message) {
    switch (message.action) {
        case 'online':
            logUtil.customLog('[FrontServer] 前端上线');
            break;
        case 'offline':
            logUtil.customLog('[FrontServer] 前端下线');
            break;
    }
}

module.exports = { initFrontServer };
```

### 2.4 向前端发送消息

```javascript
// src/msg-center/core/front/frontSend.js

const { getWss } = require('../websocket');
const WebSocket = require('ws');
const logUtil = require('../../../init/log');

/**
 * 向前端发送消息
 */
function sendToFront(message) {
    const wss = getWss();
    if (!wss) {
        logUtil.warn('[FrontSend] WebSocket 服务未就绪');
        return;
    }

    const data = JSON.stringify(message);

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

/**
 * 发送登录状态
 */
function sendLoginStatus(wxId, status) {
    sendToFront({
        type: 'loginStatus',
        data: { wxId, status }
    });
}

/**
 * 发送新消息
 */
function sendNewMessage(wxId, message) {
    sendToFront({
        type: 'newMessage',
        data: { wxId, message }
    });
}

/**
 * 发送任务结果
 */
function sendTaskResult(taskId, result) {
    sendToFront({
        type: 'taskResult',
        data: { taskId, result }
    });
}

module.exports = {
    sendToFront,
    sendLoginStatus,
    sendNewMessage,
    sendTaskResult
};
```

---

## 三、常用 API

### 3.1 创建服务器

```javascript
const WebSocket = require('ws');

// 指定端口
const wss = new WebSocket.Server({ port: 8080 });

// 使用 HTTP 服务器
const server = require('http').createServer();
const wss = new WebSocket.Server({ server });
server.listen(8080);

// 使用 Express
const app = require('express')();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });
```

### 3.2 服务器事件

```javascript
// 新连接
wss.on('connection', (ws, req) => {
    console.log('新客户端连接');
    console.log('IP:', req.socket.remoteAddress);
    console.log('URL:', req.url);
});

// 服务器错误
wss.on('error', (error) => {
    console.error('服务器错误:', error);
});

// 关闭
wss.on('close', () => {
    console.log('服务器关闭');
});
```

### 3.3 客户端事件

```javascript
wss.on('connection', (ws) => {
    // 收到消息
    ws.on('message', (data, isBinary) => {
        const message = isBinary ? data : data.toString();
        console.log('收到:', message);
    });

    // 连接关闭
    ws.on('close', (code, reason) => {
        console.log('关闭:', code, reason.toString());
    });

    // 错误
    ws.on('error', (error) => {
        console.error('错误:', error);
    });

    // Pong 响应
    ws.on('pong', () => {
        console.log('收到 pong');
    });
});
```

### 3.4 发送消息

```javascript
// 发送字符串
ws.send('Hello');

// 发送 JSON
ws.send(JSON.stringify({ type: 'message', data: 'hello' }));

// 发送 Buffer
ws.send(Buffer.from([1, 2, 3]));

// 带回调
ws.send('Hello', (error) => {
    if (error) console.error('发送失败:', error);
});
```

### 3.5 广播

```javascript
// 广播给所有客户端
function broadcast(data) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

// 广播给除发送者外的所有客户端
function broadcastExcept(sender, data) {
    wss.clients.forEach((client) => {
        if (client !== sender && client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}
```

---

## 四、心跳机制

### 4.1 为什么需要心跳

- 检测死连接
- 保持 NAT 映射
- 及时清理资源

### 4.2 服务端心跳

```javascript
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

// 心跳间隔
const HEARTBEAT_INTERVAL = 30000;

wss.on('connection', (ws) => {
    ws.isAlive = true;

    ws.on('pong', () => {
        ws.isAlive = true;
    });
});

// 定期检查
const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            return ws.terminate();  // 关闭死连接
        }

        ws.isAlive = false;
        ws.ping();  // 发送 ping
    });
}, HEARTBEAT_INTERVAL);

wss.on('close', () => {
    clearInterval(heartbeat);
});
```

### 4.3 客户端心跳

```javascript
// 客户端（浏览器）
const ws = new WebSocket('ws://localhost:8080');

ws.onopen = () => {
    // 定期发送心跳
    setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
        }
    }, 30000);
};
```

---

## 五、与 React 开发对比

### 5.1 浏览器 WebSocket

```javascript
// React 中使用原生 WebSocket
const ws = new WebSocket('ws://localhost:8080');

ws.onopen = () => console.log('连接成功');
ws.onmessage = (event) => console.log('收到:', event.data);
ws.onclose = () => console.log('连接关闭');
ws.onerror = (error) => console.error('错误:', error);

ws.send('Hello');
```

### 5.2 React Hook 封装

```javascript
function useWebSocket(url) {
    const [messages, setMessages] = useState([]);
    const wsRef = useRef(null);

    useEffect(() => {
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onmessage = (event) => {
            setMessages(prev => [...prev, JSON.parse(event.data)]);
        };

        return () => ws.close();
    }, [url]);

    const send = useCallback((data) => {
        wsRef.current?.send(JSON.stringify(data));
    }, []);

    return { messages, send };
}
```

### 5.3 关键区别

```
┌─────────────────────────────────────────────────────────────────┐
│                    前端 vs Node.js WebSocket                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  浏览器（客户端）：                                              │
│  - 使用原生 WebSocket API                                        │
│  - 连接到服务器                                                 │
│  - 页面关闭连接断开                                             │
│                                                                 │
│  Node.js（服务端）：                                            │
│  - 使用 ws 库创建服务器                                          │
│  - 管理多个客户端连接                                           │
│  - 处理广播、房间等逻辑                                          │
│  - 需要处理心跳、重连                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 六、项目中的消息协议

### 6.1 消息格式

```javascript
// 基础格式
{
    type: 'messageType',
    data: { ... }
}

// 具体类型
{
    type: 'loginStatus',
    data: {
        wxId: 'wxid_xxx',
        status: 'online'  // 'online' | 'offline' | 'expired'
    }
}

{
    type: 'newMessage',
    data: {
        wxId: 'wxid_xxx',
        message: { ... }
    }
}

{
    type: 'taskResult',
    data: {
        taskId: 'task_123',
        success: true,
        result: { ... }
    }
}
```

---

## 七、调试技巧

### 7.1 日志记录

```javascript
wss.on('connection', (ws) => {
    console.log(`[${new Date().toISOString()}] 新连接`);

    ws.on('message', (data) => {
        console.log(`[${new Date().toISOString()}] 收到:`, data.toString());
    });
});
```

### 7.2 使用 wscat 测试

```bash
# 安装
npm install -g wscat

# 连接服务器
wscat -c ws://localhost:8080

# 发送消息
> {"type": "ping"}
```

### 7.3 Chrome DevTools

```
1. 打开 DevTools
2. Network 标签
3. 筛选 WS
4. 查看消息收发
```
