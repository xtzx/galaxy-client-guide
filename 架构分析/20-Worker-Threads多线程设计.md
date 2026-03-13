# 20 Worker-Threads 多线程设计

> **文档定位**：哪些耗时操作被放到 Worker Thread，如何通信。  
> **核心模块**：`galaxy-client/src/msg-center/core/worker-threads/workerPool.js`

---

## 目录

1. [Worker Threads 适用场景](#1-worker-threads-适用场景)
2. [目录结构与文件清单](#2-目录结构与文件清单)
3. [WorkerPool 核心实现](#3-workerpool-核心实现)
4. [Worker 通信协议](#4-worker-通信协议)
5. [任务分发模式](#5-任务分发模式)
6. [业务 Worker：wkUserListWorker.js](#6-业务-workerwkuserlistworkerjs)
7. [线程池管理：reversePoolManager.js](#7-线程池管理-reversepoolmanagerjs)
8. [异常处理与 Worker 自动恢复](#8-异常处理与-worker-自动恢复)
9. [测试用例参考](#9-测试用例参考)
10. [与 child_process 的对比](#10-与-child_process-的对比)
11. [关键代码路径索引](#11-关键代码路径索引)

---

## 1. Worker Threads 适用场景

Node.js 的 Worker Threads 用于将 CPU 密集型任务从主线程卸载到独立线程，避免阻塞事件循环。在 Galaxy Client 中，以下场景使用了 Worker Threads：

| 场景 | Worker 文件 | 说明 |
|------|------------|------|
| 企微用户列表处理 | `wkUserListWorker.js` | 解析企微群成员和好友信息（大量 JSON 遍历） |
| 逆向 IPC 初始化 | `reversePoolManager.js` | 通过线程池并行初始化多个 IPC 连接 |

---

## 2. 目录结构与文件清单

```
galaxy-client/src/
├── msg-center/core/
│   ├── worker-threads/
│   │   └── workerPool.js               # 通用线程池实现（核心）
│   └── pool/
│       └── reversePoolManager.js        # 逆向 IPC 线程池管理
├── msg-center/dispatch-center/handle/
│   └── wkUserListWorker.js              # 企微用户列表 Worker
├── common/
│   └── worker.js                        # 基础 Worker 示例
└── test/
    ├── worker-threads/
    │   ├── worker-test.js               # Worker 测试脚本
    │   ├── pool-test1.js                # 基础 Worker 测试
    │   └── pool-test2.js                # 自定义线程池测试
    ├── worker1-test.js                  # Worker 测试
    └── async-hooks/
        ├── worker.js                    # 斐波那契计算 Worker
        ├── main.js                      # 基础 Worker 调用
        ├── main1.js                     # Worker 池调用
        └── main2.js                     # WorkerPool 测试
```

---

## 3. WorkerPool 核心实现

**文件路径**：`galaxy-client/src/msg-center/core/worker-threads/workerPool.js`

### 3.1 完整源码解析

```javascript
const { AsyncResource } = require('async_hooks');
const { EventEmitter } = require('events');
const { Worker, MessageChannel } = require('worker_threads');

const kTaskInfo = Symbol('kTaskInfo');
const kWorkerFreedEvent = Symbol('kWorkerFreedEvent');
const kWorkerChannel = Symbol('kWorkerChannel');

class WorkerPoolTaskInfo extends AsyncResource {
    constructor(callback) {
        super('WorkerPoolTaskInfo');
        this.callback = callback;
    }
    done(err, result) {
        this.runInAsyncScope(this.callback, null, err, result);
        this.emitDestroy();
    }
}

class WorkerPool extends EventEmitter {
    constructor(config) {
        const { workerFile, numThreads, isBufferChunk, isArrayChunk } = config;
        super();
        this.workerFile = workerFile;
        this.numThreads = numThreads;
        this.isBufferChunk = isBufferChunk;
        this.isArrayChunk = isArrayChunk;
        this.workers = [];
        this.freeWorkers = [];
        this.tasks = [];

        for (let i = 0; i < numThreads; i++)
            this.addNewWorker();

        this.on(kWorkerFreedEvent, () => {
            if (this.tasks.length > 0) {
                const { task, callback } = this.tasks.shift();
                this.runTask(task, callback);
            }
        });
    }
    // ... addNewWorker, runTask, close
}
```

### 3.2 构造参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `workerFile` | `string` | Worker 脚本文件路径 |
| `numThreads` | `number` | 线程池大小 |
| `isBufferChunk` | `boolean` | 是否使用 Buffer 分块传输 |
| `isArrayChunk` | `boolean` | 是否使用数组分块传输 |

### 3.3 核心设计模式

WorkerPool 基于**生产者-消费者**模式：

```
任务队列 (tasks[])
    │
    ▼
┌─────────────────────────────────────────┐
│           WorkerPool                     │
│                                         │
│  workers[]     freeWorkers[]  tasks[]   │
│  [W1, W2, W3]  [W2, W3]      [T4, T5] │
│                                         │
│  runTask(task, callback)                │
│    ├─ 有空闲 → freeWorkers.pop()       │
│    │           → 发送任务到 Worker      │
│    │                                    │
│    └─ 无空闲 → tasks.push({task, cb})  │
│                → 等待 kWorkerFreedEvent │
└─────────────────────────────────────────┘
```

---

## 4. Worker 通信协议

### 4.1 MessageChannel 双向通信

WorkerPool 使用 `MessageChannel` 而非直接的 `worker.postMessage`，提供更灵活的通信方式：

```javascript
addNewWorker() {
    const worker = new Worker(this.workerFile, { workerData: {} });
    const channel = new MessageChannel();
    worker[kWorkerChannel] = channel;

    // 初始化：将 port1 发送给 Worker
    worker.postMessage({ type: 'init', port: channel.port1 }, [channel.port1]);

    // 主线程通过 port2 接收 Worker 的结果
    channel.port2.on('message', (result) => {
        worker[kTaskInfo].done(null, result);
        worker[kTaskInfo] = null;
        this.freeWorkers.push(worker);
        this.emit(kWorkerFreedEvent);
    });
}
```

### 4.2 通信协议

**主线程 → Worker**：

| 消息类型 | 通道 | 数据格式 |
|----------|------|----------|
| `init` | `worker.postMessage` | `{ type: 'init', port: MessagePort }` |
| `run` | `channel.port2.postMessage` | `{ type: 'run', task: {...} }` |

**Worker → 主线程**：

| 通道 | 数据格式 |
|------|----------|
| `port.postMessage` | 任务执行结果 |

### 4.3 为什么使用 MessageChannel

- **隔离性**：每个 Worker 有独立的通信通道，避免消息混淆
- **灵活性**：可以在不同阶段传递不同类型的消息
- **性能**：`MessagePort` 支持 `Transferable` 对象的零拷贝传输

---

## 5. 任务分发模式

WorkerPool 支持四种任务分发模式：

### 5.1 普通模式（默认）

```javascript
channel.port2.postMessage({ type: 'run', task });
```

直接将整个任务对象发送给 Worker。

### 5.2 Buffer 分块模式（isBufferChunk）

```javascript
if (this.isBufferChunk) {
    const { buffer, chunkSize, ...rest } = task;
    channel.port2.postMessage({ task: rest, type: 'run' });
    for (let offset = 0; offset < buffer.length; offset += chunkSize) {
        const chunk = buffer.slice(offset, offset + chunkSize);
        // 写入临时文件，再通知 Worker
        fs.writeFile(filePath, chunk, (err) => {
            channel.port2.postMessage({ fileName, type: 'run' });
        });
    }
}
```

将大 Buffer 分成多个块，通过临时文件传递给 Worker。适用于大文件处理。

### 5.3 数组分块模式（isArrayChunk）

```javascript
if (this.isArrayChunk) {
    const { chunkList, chunkSize, ...rest } = task;
    channel.port2.postMessage({ task: rest, type: 'run' });
    for (const chunk of chunkList) {
        channel.port2.postMessage({ chunk, type: 'run' });
    }
}
```

将数组分成多个块逐个发送。适用于批量数据处理。

### 5.4 JSON 文件模式（isJsonFile）

```javascript
if (this.isJsonFile) {
    const { list, listAll, ...rest } = task;
    fs.writeFileSync(listFilePath, JSON.stringify(list));
    fs.writeFileSync(listAllFilePath, JSON.stringify(listAll));
    channel.port2.postMessage({ listFilePath, listAllFilePath, type: 'run' });
}
```

将大型 JSON 数据写入临时文件，只传递文件路径给 Worker。避免跨线程序列化大对象的性能问题。

---

## 6. 业务 Worker：wkUserListWorker.js

**文件路径**：`galaxy-client/src/msg-center/dispatch-center/handle/wkUserListWorker.js`

```javascript
const { parentPort } = require('worker_threads');
const fs = require('fs');

function handleChatRoomList(chatroomList, membersExternal) {
    for (const membersJson of membersExternal) {
        const chatroomId = membersJson.id;
        const chatroomMemberInfoDto = chatroomList.find(
            item => item.wxid == chatroomId
        );
        if (!chatroomMemberInfoDto) continue;
        chatroomMemberInfoDto.ownerwxid = membersJson.create_user_id;
        chatroomMemberInfoDto.nickname = membersJson.name;
        let users = membersJson.users;
        if (!users || users.length === 0) {
            chatroomMemberInfoDto.number = 0;
            continue;
        }
        let userIds = users.map(x => x.user_id);
        chatroomMemberInfoDto.simplelist = userIds.join("^G");
        chatroomMemberInfoDto.number = userIds.length;
        chatroomMemberInfoDto.users = JSON.stringify(membersJson);
    }
}

function handleRoomMembers(friendList, externalList) {
    for (const external of externalList) {
        try {
            const { user } = external;
            if (user) {
                const friendInfoDto = friendList.find(
                    item => item.wxid == user.id
                );
                if (!friendInfoDto) continue;
                const { remarks } = external;
                const { gender, name, avator_url, corp_id } = user;
                Object.assign(friendInfoDto, {
                    sex: gender, nickname: name, remark: remarks,
                    headimg: avator_url, bigheadimg: avator_url, corpId: corp_id
                });
            }
        } catch (error) {
            log.info('[appInit] 解析好友信息报错');
        }
    }
}

parentPort.on('message', (message) => {
    if (message.type === 'init') {
        const { port } = message;
        port.on('message', async workerData => {
            if (workerData.type === 'run') {
                const { busType, listFilePath, listAllFilePath } = workerData;
                const list = JSON.parse(fs.readFileSync(listFilePath, 'utf8'));
                const listAll = JSON.parse(fs.readFileSync(listAllFilePath, 'utf8'));
                if (busType === 'handleChatRoomList') {
                    handleChatRoomList(list, listAll);
                }
                if (busType === 'handleRoomMembers') {
                    handleRoomMembers(list, listAll);
                }
            }
        });
    }
});
```

### 6.1 两个处理函数

| 函数 | 输入 | 输出 | 用途 |
|------|------|------|------|
| `handleChatRoomList` | 群列表 + 外部群成员数据 | 合并后的群列表 | 企微群信息整合 |
| `handleRoomMembers` | 好友列表 + 外部联系人数据 | 合并后的好友列表 | 企微好友信息整合 |

### 6.2 通信流程

```
主线程                                   Worker
  │                                        │
  │ worker.postMessage({type:'init', port}) │
  ├───────────────────────────────────────▶│
  │                                        │ parentPort.on('message')
  │                                        │ 保存 port 引用
  │                                        │
  │ 写入 list.json, listAll.json           │
  │ port2.postMessage({                    │
  │   type:'run',                          │
  │   busType:'handleChatRoomList',        │
  │   listFilePath, listAllFilePath        │
  │ })                                     │
  ├───────────────────────────────────────▶│
  │                                        │ fs.readFileSync(listFilePath)
  │                                        │ fs.readFileSync(listAllFilePath)
  │                                        │ handleChatRoomList(list, listAll)
  │                                        │
  │◀── port.postMessage(result) ──────────│
```

---

## 7. 线程池管理：reversePoolManager.js

**文件路径**：`galaxy-client/src/msg-center/core/pool/reversePoolManager.js`

```javascript
const WorkerPool = require('../worker-threads/workerPool');
const os = require('os');

const ReverseThreadPoolManger = {
    pool: null,
    submitIpcInit(task) {
        if (!this.pool) {
            this.pool = new WorkerPool(os.cpus().length);
        }
        this.pool.runTask(task, (err, result) => {
            console.log(err, result);
        });
    },
    shoutDown() {
        this.pool.close();
    }
};
```

| 特性 | 说明 |
|------|------|
| 线程池大小 | `os.cpus().length`（CPU 核心数） |
| 懒初始化 | 首次调用 `submitIpcInit` 时创建 |
| 用途 | 并行初始化多个逆向 IPC 连接 |

---

## 8. 异常处理与 Worker 自动恢复

```javascript
worker.on('error', (err) => {
    if (worker[kTaskInfo]) {
        worker[kTaskInfo].done(err, null);   // 通知调用方任务失败
    } else {
        this.emit('error', err);              // 非任务相关错误
    }
    this.workers.splice(this.workers.indexOf(worker), 1);  // 移除故障 Worker
    this.addNewWorker();                                     // 创建新 Worker 替补
});
```

**自动恢复策略**：
1. Worker 发生未捕获异常时触发 `error` 事件
2. 如果 Worker 正在执行任务，将错误回调给任务发起方
3. 从 `workers` 列表中移除故障 Worker
4. 立即创建新 Worker 补充到线程池中

这保证了线程池始终维持 `numThreads` 个 Worker 的容量。

---

## 9. 测试用例参考

### 9.1 基础 Worker 测试

**文件路径**：`galaxy-client/src/test/worker-threads/pool-test1.js`

```javascript
const { Worker } = require('worker_threads');
const worker = new Worker(workerPath, { workerData: array });
worker.on('message', result => { ... });
worker.on('error', err => { ... });
worker.on('exit', code => { ... });
```

### 9.2 自定义线程池测试

**文件路径**：`galaxy-client/src/test/worker-threads/pool-test2.js`

定义了简化版 `ThreadPool` 类，用于验证线程池模式的可行性。

### 9.3 WorkerPool 集成测试

**文件路径**：`galaxy-client/src/test/async-hooks/main2.js`

使用 `WorkerPool` 类的集成测试，验证线程池的完整工作流。

---

## 10. 与 child_process 的对比

| 维度 | Worker Threads | child_process |
|------|---------------|---------------|
| **内存共享** | 可通过 `SharedArrayBuffer` 共享 | 独立进程空间，不共享 |
| **启动开销** | 较小（线程级别） | 较大（进程级别） |
| **通信方式** | `postMessage` / `MessageChannel` | `stdin/stdout` / IPC |
| **适用场景** | CPU 密集型计算 | I/O 密集型 / 独立服务 |
| **崩溃影响** | Worker 崩溃不影响主线程 | 子进程崩溃不影响主进程 |
| **Node.js API** | 完整支持 | 完整支持 |

Galaxy Client 选择 Worker Threads 的原因：
- 企微用户列表处理是 CPU 密集型（大量 JSON 遍历和对象合并）
- 需要较低的启动开销（频繁创建/销毁）
- 不需要独立进程空间

---

## 11. 关键代码路径索引

| 文件路径 | 核心类/函数 | 职责 |
|---------|------------|------|
| `core/worker-threads/workerPool.js` | `WorkerPool` | 通用线程池（支持多种任务分发模式） |
| `core/pool/reversePoolManager.js` | `ReverseThreadPoolManger` | 逆向 IPC 线程池管理 |
| `dispatch-center/handle/wkUserListWorker.js` | `handleChatRoomList` / `handleRoomMembers` | 企微用户列表处理 Worker |
| `test/worker-threads/worker-test.js` | Worker 测试 | 基础 Worker 通信测试 |
| `test/worker-threads/pool-test2.js` | `ThreadPool` | 简化版线程池测试 |
| `test/async-hooks/main2.js` | WorkerPool 测试 | 集成测试 |

---

*文档生成时间：2026-03-13 | 基于 galaxy-client 仓库实际代码分析*
