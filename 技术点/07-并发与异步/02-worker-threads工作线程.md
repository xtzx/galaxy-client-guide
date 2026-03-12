# Worker Threads 工作线程

> Node.js 多线程并行计算

---

## 一、概述

### 1.1 什么是 Worker Threads

Worker Threads 是 Node.js 内置的多线程模块，允许在独立线程中执行 JavaScript 代码，用于处理 CPU 密集型任务而不阻塞主线程。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Worker Threads 架构                                   │
└─────────────────────────────────────────────────────────────────────────────┘

    ┌─────────────────────────────────────────────────────────────────────┐
    │                        主线程 (Main Thread)                          │
    │                                                                     │
    │  • 运行 Electron 主进程                                              │
    │  • 处理 IPC 通信                                                     │
    │  • 管理 Worker 线程                                                  │
    │                                                                     │
    │     ┌─────────┐    ┌─────────┐    ┌─────────┐                       │
    │     │ Worker1 │    │ Worker2 │    │ Worker3 │   ← Worker Pool       │
    │     └────┬────┘    └────┬────┘    └────┬────┘                       │
    │          │              │              │                            │
    └──────────┼──────────────┼──────────────┼────────────────────────────┘
               │              │              │
               │  postMessage │  postMessage │  postMessage
               ▼              ▼              ▼
    ┌──────────────────────────────────────────────────────────────────────┐
    │                        独立 V8 实例                                   │
    │                                                                      │
    │  • 每个 Worker 有自己的 V8 引擎                                       │
    │  • 不共享内存（通过消息传递通信）                                      │
    │  • 真正的并行执行                                                     │
    └──────────────────────────────────────────────────────────────────────┘
```

### 1.2 与 React 开发对比

| Node.js | React/浏览器 | 说明 |
|---------|-------------|------|
| `worker_threads` | `Web Worker` | 多线程执行 |
| `parentPort` | `self.postMessage` | 向主线程发消息 |
| `workerData` | 构造参数 | 初始化数据 |
| `MessageChannel` | `MessageChannel` | 消息通道（相同API） |

### 1.3 为什么需要 Worker Threads

```
┌──────────────────────────────────────────────────────────────────────┐
│ 场景：处理企微用户列表（可能上万条数据）                                │
└──────────────────────────────────────────────────────────────────────┘

传统方式（单线程）：
┌─────────┐    处理10000条    ┌─────────┐    阻塞    ┌─────────┐
│ 收到数据 │───────────────►│ 处理中...│───────────►│ 其他任务 │
└─────────┘     5秒          └─────────┘    卡住!   └─────────┘

Worker 方式（多线程）：
┌─────────┐    postMessage   ┌─────────┐   继续执行   ┌─────────┐
│ 收到数据 │───────────────►│ Worker  │─────────────►│ 其他任务 │
└─────────┘      即时        │ 处理中  │   不阻塞!    └─────────┘
                            └────┬────┘
                                 │ 完成后回调
                                 ▼
                            ┌─────────┐
                            │ 处理结果 │
                            └─────────┘
```

---

## 二、项目中的实现

### 2.1 Worker Pool 架构

项目实现了一个 **Worker 线程池**，复用线程避免频繁创建销毁：

```javascript
// src/msg-center/core/worker-threads/workerPool.js

const { Worker, MessageChannel } = require('worker_threads');
const { AsyncResource } = require('async_hooks');
const { EventEmitter } = require('events');

class WorkerPool extends EventEmitter {
    constructor(config) {
        const { workerFile, numThreads } = config;
        super();
        this.workerFile = workerFile;      // Worker 脚本路径
        this.numThreads = numThreads;       // 线程数
        this.workers = [];                  // 所有 Worker
        this.freeWorkers = [];              // 空闲 Worker
        this.tasks = [];                    // 任务队列

        // 创建指定数量的 Worker
        for (let i = 0; i < numThreads; i++) {
            this.addNewWorker();
        }
        
        // 当有 Worker 空闲时，执行队列中的下一个任务
        this.on(kWorkerFreedEvent, () => {
            if (this.tasks.length > 0) {
                const { task, callback } = this.tasks.shift();
                this.runTask(task, callback);
            }
        });
    }

    addNewWorker() {
        const worker = new Worker(this.workerFile);
        
        // 创建消息通道
        const channel = new MessageChannel();
        worker[kWorkerChannel] = channel;
        
        // 发送初始化消息
        worker.postMessage({ type: 'init', port: channel.port1 }, [channel.port1]);
        
        // 监听 Worker 返回的结果
        channel.port2.on('message', (result) => {
            worker[kTaskInfo].done(null, result);
            worker[kTaskInfo] = null;
            this.freeWorkers.push(worker);   // 放回空闲池
            this.emit(kWorkerFreedEvent);
        });
        
        // 处理 Worker 错误
        worker.on('error', (err) => {
            if (worker[kTaskInfo]) {
                worker[kTaskInfo].done(err, null);
            }
            // 移除出错的 Worker，创建新的替代
            this.workers.splice(this.workers.indexOf(worker), 1);
            this.addNewWorker();
        });
        
        this.workers.push(worker);
        this.freeWorkers.push(worker);
    }

    runTask(task, callback) {
        if (this.freeWorkers.length === 0) {
            // 没有空闲 Worker，加入队列
            this.tasks.push({ task, callback });
            return;
        }

        const worker = this.freeWorkers.pop();
        worker[kTaskInfo] = new WorkerPoolTaskInfo(callback);
        
        const channel = worker[kWorkerChannel];
        channel.port2.postMessage({ type: 'run', task });
    }

    close() {
        for (const worker of this.workers) {
            worker.terminate();
        }
    }
}
```

### 2.2 Worker 脚本示例

```javascript
// src/msg-center/dispatch-center/handle/wkUserListWorker.js

const { parentPort } = require('worker_threads');
const fs = require('fs');

// 处理群列表数据
function handleChatRoomList(chatroomList, membersExternal) {
    for (const membersJson of membersExternal) {
        const chatroomId = membersJson.id;
        const chatroom = chatroomList.find(item => item.wxid == chatroomId);
        if (!chatroom) continue;
        
        chatroom.ownerwxid = membersJson.create_user_id;
        chatroom.nickname = membersJson.name;
        
        let users = membersJson.users;
        if (!users || users.length === 0) {
            chatroom.number = 0;
            continue;
        }
        
        let userIds = users.map(x => x.user_id);
        chatroom.simplelist = userIds.join("^G");
        chatroom.number = userIds.length;
        chatroom.users = JSON.stringify(membersJson);
    }
}

// 处理好友列表数据
function handleRoomMembers(friendList, externalList) {
    for (const external of externalList) {
        const { user, remarks } = external;
        if (!user) continue;
        
        const friend = friendList.find(item => item.wxid == user.id);
        if (!friend) continue;
        
        Object.assign(friend, {
            sex: user.gender,
            nickname: user.name,
            remark: remarks,
            headimg: user.avator_url,
            corpId: user.corp_id
        });
    }
}

// 监听主线程消息
parentPort.on('message', (message) => {
    if (message.type === 'init') {
        const { port } = message;
        
        port.on('message', async (workerData) => {
            if (workerData.type === 'run') {
                const { busType, listFilePath, listAllFilePath } = workerData;
                
                // 从文件读取数据（避免内存序列化开销）
                const list = JSON.parse(fs.readFileSync(listFilePath, 'utf8'));
                const listAll = JSON.parse(fs.readFileSync(listAllFilePath, 'utf8'));
                
                // 根据类型执行不同处理
                if (busType === 'handleChatRoomList') {
                    handleChatRoomList(list, listAll);
                }
                if (busType === 'handleRoomMembers') {
                    handleRoomMembers(list, listAll);
                }
                
                // 返回结果
                port.postMessage({ success: true, list });
            }
        });
    }
});
```

---

## 三、使用场景

### 3.1 项目中的应用

| 场景 | 文件 | 说明 |
|------|------|------|
| 企微用户列表处理 | `wkUserListWorker.js` | 处理大量用户/群数据 |
| 数据解析 | `workerPool.js` | 通用 Worker 线程池 |

### 3.2 适用场景

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        适用与不适用场景                                       │
└─────────────────────────────────────────────────────────────────────────────┘

✅ 适用场景（CPU密集型）：
┌──────────────────┬──────────────────────────────────────────────────────────┐
│ 场景             │ 说明                                                      │
├──────────────────┼──────────────────────────────────────────────────────────┤
│ 大数据量处理     │ 解析/转换上万条记录                                        │
│ 复杂计算         │ 加密/解密、哈希计算                                        │
│ 图片处理         │ 批量图片压缩/转换（配合 sharp）                             │
│ JSON 解析        │ 解析大型 JSON 文件                                         │
└──────────────────┴──────────────────────────────────────────────────────────┘

❌ 不适用场景（IO密集型）：
┌──────────────────┬──────────────────────────────────────────────────────────┐
│ 场景             │ 说明                                                      │
├──────────────────┼──────────────────────────────────────────────────────────┤
│ 网络请求         │ 已经是异步的，用 Worker 反而增加开销                        │
│ 文件IO           │ 已经是异步的，不会阻塞主线程                               │
│ 数据库查询       │ 已经是异步的                                              │
│ 简单任务         │ 线程创建开销 > 任务本身开销                                │
└──────────────────┴──────────────────────────────────────────────────────────┘
```

---

## 四、API 详解

### 4.1 主线程 API

```javascript
const { Worker, MessageChannel, isMainThread, workerData } = require('worker_threads');

// ═════════════════════════════════════════════════════════════════════
// 创建 Worker
// ═════════════════════════════════════════════════════════════════════
const worker = new Worker('./worker.js', {
    workerData: { name: 'task1' }    // 传递给 Worker 的初始数据
});

// ═════════════════════════════════════════════════════════════════════
// 发送消息给 Worker
// ═════════════════════════════════════════════════════════════════════
worker.postMessage({ type: 'run', data: [1, 2, 3] });

// ═════════════════════════════════════════════════════════════════════
// 接收 Worker 消息
// ═════════════════════════════════════════════════════════════════════
worker.on('message', (result) => {
    console.log('Worker 返回:', result);
});

// ═════════════════════════════════════════════════════════════════════
// 处理 Worker 错误
// ═════════════════════════════════════════════════════════════════════
worker.on('error', (err) => {
    console.error('Worker 错误:', err);
});

// ═════════════════════════════════════════════════════════════════════
// Worker 退出
// ═════════════════════════════════════════════════════════════════════
worker.on('exit', (code) => {
    console.log(`Worker 退出，code: ${code}`);
});

// ═════════════════════════════════════════════════════════════════════
// 终止 Worker
// ═════════════════════════════════════════════════════════════════════
await worker.terminate();
```

### 4.2 Worker 线程 API

```javascript
const { parentPort, workerData, isMainThread } = require('worker_threads');

// ═════════════════════════════════════════════════════════════════════
// 获取初始数据
// ═════════════════════════════════════════════════════════════════════
console.log('初始数据:', workerData);  // { name: 'task1' }

// ═════════════════════════════════════════════════════════════════════
// 监听主线程消息
// ═════════════════════════════════════════════════════════════════════
parentPort.on('message', (message) => {
    console.log('收到消息:', message);
    
    // 处理任务
    const result = processTask(message.data);
    
    // 返回结果
    parentPort.postMessage(result);
});

// ═════════════════════════════════════════════════════════════════════
// 判断是否在主线程
// ═════════════════════════════════════════════════════════════════════
if (isMainThread) {
    console.log('这是主线程');
} else {
    console.log('这是 Worker 线程');
}
```

### 4.3 MessageChannel（消息通道）

```javascript
const { MessageChannel } = require('worker_threads');

// 创建消息通道
const { port1, port2 } = new MessageChannel();

// port1 发送给 Worker
worker.postMessage({ port: port1 }, [port1]);

// port2 留在主线程接收消息
port2.on('message', (msg) => {
    console.log('收到:', msg);
});
```

---

## 五、数据传输方式

### 5.1 结构化克隆（默认）

```javascript
// 默认方式：数据会被复制
const data = { name: 'test', list: [1, 2, 3] };
worker.postMessage(data);  // data 被深拷贝

// ⚠️ 大数据量时效率低
```

### 5.2 Transferable Objects（零拷贝）

```javascript
// 使用 ArrayBuffer 实现零拷贝
const buffer = new ArrayBuffer(1024 * 1024);  // 1MB

// 转移所有权（发送后主线程不能再访问）
worker.postMessage({ buffer }, [buffer]);

// ✅ 大数据量时推荐
```

### 5.3 SharedArrayBuffer（共享内存）

```javascript
// 创建共享内存
const sharedBuffer = new SharedArrayBuffer(1024);
const view = new Int32Array(sharedBuffer);

// 发送共享内存引用
worker.postMessage({ sharedBuffer });

// ⚠️ 需要处理竞态条件（使用 Atomics）
```

### 5.4 文件传输（项目实践）

```javascript
// 项目实际使用的方式：通过文件传递大数据
// 避免内存序列化开销

// 主线程：写入文件
const listJson = JSON.stringify(bigDataList);
fs.writeFileSync('/tmp/list.json', listJson);

// 发送文件路径
channel.port2.postMessage({
    type: 'run',
    listFilePath: '/tmp/list.json'
});

// Worker：从文件读取
const list = JSON.parse(fs.readFileSync(listFilePath, 'utf8'));
```

---

## 六、最佳实践

### 6.1 线程池模式

```javascript
// 推荐：使用线程池复用 Worker
class WorkerPool {
    constructor(numThreads) {
        this.workers = [];
        this.freeWorkers = [];
        this.taskQueue = [];
        
        // 预创建 Worker
        for (let i = 0; i < numThreads; i++) {
            this.createWorker();
        }
    }
    
    createWorker() {
        const worker = new Worker('./worker.js');
        worker.on('message', () => {
            this.freeWorkers.push(worker);
            this.runNextTask();
        });
        this.workers.push(worker);
        this.freeWorkers.push(worker);
    }
    
    runTask(task) {
        return new Promise((resolve, reject) => {
            if (this.freeWorkers.length === 0) {
                this.taskQueue.push({ task, resolve, reject });
            } else {
                const worker = this.freeWorkers.pop();
                worker.once('message', resolve);
                worker.once('error', reject);
                worker.postMessage(task);
            }
        });
    }
    
    runNextTask() {
        if (this.taskQueue.length > 0) {
            const { task, resolve, reject } = this.taskQueue.shift();
            const worker = this.freeWorkers.pop();
            worker.once('message', resolve);
            worker.once('error', reject);
            worker.postMessage(task);
        }
    }
}

// 使用
const pool = new WorkerPool(4);  // 4个线程
await pool.runTask({ type: 'process', data: [...] });
```

### 6.2 错误处理

```javascript
// Worker 内部错误处理
parentPort.on('message', async (message) => {
    try {
        const result = await processTask(message);
        parentPort.postMessage({ success: true, result });
    } catch (error) {
        parentPort.postMessage({ success: false, error: error.message });
    }
});

// 主线程错误处理
worker.on('error', (err) => {
    console.error('Worker 崩溃:', err);
    // 重新创建 Worker
    this.recreateWorker();
});

worker.on('exit', (code) => {
    if (code !== 0) {
        console.error(`Worker 异常退出，code: ${code}`);
    }
});
```

---

## 七、调试技巧

### 7.1 Worker 内日志

```javascript
// Worker 中使用 console.log 会输出到主进程
parentPort.on('message', (message) => {
    console.log('[Worker] 收到消息:', message);  // 可以看到
});
```

### 7.2 性能分析

```javascript
// 测量任务耗时
const start = Date.now();
const result = await pool.runTask(task);
console.log(`任务耗时: ${Date.now() - start}ms`);
```

---

## 八、相关文档

- [01-async-lock并发控制.md](./01-async-lock并发控制.md) - 异步锁
- [技术架构/02-消息中心架构.md](../../技术架构/02-消息中心架构.md) - 使用场景
- [Node.js 官方文档](https://nodejs.org/api/worker_threads.html) - API 参考
