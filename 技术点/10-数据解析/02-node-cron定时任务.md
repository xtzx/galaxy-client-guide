# node-cron 定时任务

> Node.js 定时任务调度器

---

## 一、技术简介

### 1.1 什么是 node-cron

`node-cron` 是基于 cron 表达式的任务调度器：

- **Cron 语法**：沿用 Unix cron 格式
- **精确调度**：秒级精度
- **轻量**：无外部依赖
- **灵活**：支持启停控制

### 1.2 Cron 表达式

```
┌──────────── 秒 (0-59)
│ ┌────────── 分 (0-59)
│ │ ┌──────── 时 (0-23)
│ │ │ ┌────── 日 (1-31)
│ │ │ │ ┌──── 月 (1-12)
│ │ │ │ │ ┌── 周几 (0-7, 0和7都是周日)
│ │ │ │ │ │
* * * * * *
```

常用表达式：
| 表达式 | 含义 |
|-------|------|
| `* * * * * *` | 每秒 |
| `0 * * * * *` | 每分钟 |
| `0 0 * * * *` | 每小时 |
| `0 0 0 * * *` | 每天 0 点 |
| `0 30 8 * * *` | 每天 8:30 |
| `0 0 */2 * * *` | 每 2 小时 |
| `0 0 9-18 * * *` | 9-18 点每小时 |

---

## 二、项目中的使用

### 2.1 使用位置

```
src/msg-center/timer/schedual.js    # 定时任务调度中心
```

### 2.2 完整实现

```javascript
// src/msg-center/timer/schedual.js

const cron = require('node-cron');
const HeartBeatTimer = require('./HeartBeatTimer');
const PingTimer = require('./PingTimer');
const TaskStatusTimer = require('./TaskStatusTimer');
const CloudConfigTimer = require('./CloudConfigTimer');
const MonitorTimer = require('./MonitorTimer');
const logUtil = require('../../init/log');

const tasks = [];

/**
 * 初始化所有定时任务
 */
function initScheduleTasks() {
    logUtil.customLog('[Schedule] 初始化定时任务');

    // 心跳任务 - 每30秒
    const heartbeatTask = cron.schedule('*/30 * * * * *', () => {
        HeartBeatTimer.execute();
    });
    tasks.push({ name: 'heartbeat', task: heartbeatTask });

    // Ping 任务 - 每60秒
    const pingTask = cron.schedule('0 * * * * *', () => {
        PingTimer.execute();
    });
    tasks.push({ name: 'ping', task: pingTask });

    // 任务状态检查 - 每5分钟
    const taskStatusTask = cron.schedule('0 */5 * * * *', () => {
        TaskStatusTimer.execute();
    });
    tasks.push({ name: 'taskStatus', task: taskStatusTask });

    // 云配置同步 - 每小时
    const cloudConfigTask = cron.schedule('0 0 * * * *', () => {
        CloudConfigTimer.execute();
    });
    tasks.push({ name: 'cloudConfig', task: cloudConfigTask });

    // 性能监控 - 每分钟
    const monitorTask = cron.schedule('0 * * * * *', () => {
        MonitorTimer.execute();
    });
    tasks.push({ name: 'monitor', task: monitorTask });

    // OSS 凭证刷新 - 每30分钟
    const ossRefreshTask = cron.schedule('0 */30 * * * *', () => {
        require('../core/utils/aliyunOssManagerUtil').refreshAccess();
    });
    tasks.push({ name: 'ossRefresh', task: ossRefreshTask });

    logUtil.customLog(`[Schedule] 已启动 ${tasks.length} 个定时任务`);
}

/**
 * 停止所有任务
 */
function stopAllTasks() {
    tasks.forEach(({ name, task }) => {
        task.stop();
        logUtil.customLog(`[Schedule] 停止任务: ${name}`);
    });
}

/**
 * 获取任务状态
 */
function getTasksStatus() {
    return tasks.map(({ name, task }) => ({
        name,
        running: task.running
    }));
}

module.exports = {
    initScheduleTasks,
    stopAllTasks,
    getTasksStatus
};
```

### 2.3 具体任务实现

```javascript
// src/msg-center/timer/HeartBeatTimer.js

const RegistryConfig = require('../core/registry-config');
const { httpFetch } = require('../../common/fetch');
const logUtil = require('../../init/log');

class HeartBeatTimer {
    /**
     * 执行心跳
     */
    async execute() {
        const bots = RegistryConfig.getAllBots();

        if (bots.length === 0) {
            return;
        }

        logUtil.customLog(`[Heartbeat] 发送心跳, 在线机器人: ${bots.length}`);

        for (const bot of bots) {
            try {
                await this.sendHeartbeat(bot.wxId);
            } catch (error) {
                logUtil.error(`[Heartbeat] 心跳失败: ${bot.wxId}`, error);
            }
        }
    }

    /**
     * 发送单个心跳
     */
    async sendHeartbeat(wxId) {
        await httpFetch({
            url: '/api/bot/heartbeat',
            data: {
                wxId,
                timestamp: Date.now()
            }
        });
    }
}

module.exports = new HeartBeatTimer();
```

---

## 三、常用 API

### 3.1 创建任务

```javascript
const cron = require('node-cron');

// 基础用法
const task = cron.schedule('* * * * *', () => {
    console.log('每分钟执行');
});

// 带选项
const task = cron.schedule('* * * * *', () => {
    console.log('执行任务');
}, {
    scheduled: true,    // 立即开始调度
    timezone: 'Asia/Shanghai'  // 时区
});
```

### 3.2 任务控制

```javascript
// 停止任务
task.stop();

// 启动任务
task.start();

// 销毁任务（停止并移除）
task.destroy();
```

### 3.3 验证表达式

```javascript
// 验证 cron 表达式是否有效
const isValid = cron.validate('*/5 * * * *');
console.log(isValid);  // true

const isInvalid = cron.validate('invalid');
console.log(isInvalid);  // false
```

---

## 四、Cron 表达式详解

### 4.1 基础语法

```
┌──────────── 秒 (0-59) [可选]
│ ┌────────── 分 (0-59)
│ │ ┌──────── 时 (0-23)
│ │ │ ┌────── 日 (1-31)
│ │ │ │ ┌──── 月 (1-12)
│ │ │ │ │ ┌── 周几 (0-7)
│ │ │ │ │ │
* * * * * *
```

### 4.2 特殊字符

| 字符 | 含义 | 示例 |
|-----|------|-----|
| `*` | 任意值 | `* * * * *` 每分钟 |
| `,` | 列举 | `1,15 * * * *` 第1和15分钟 |
| `-` | 范围 | `1-5 * * * *` 第1-5分钟 |
| `/` | 步长 | `*/5 * * * *` 每5分钟 |

### 4.3 常用示例

```javascript
// 每秒
cron.schedule('* * * * * *', fn);

// 每5秒
cron.schedule('*/5 * * * * *', fn);

// 每分钟
cron.schedule('0 * * * * *', fn);

// 每5分钟
cron.schedule('0 */5 * * * *', fn);

// 每小时整点
cron.schedule('0 0 * * * *', fn);

// 每天 8:30
cron.schedule('0 30 8 * * *', fn);

// 每周一 9:00
cron.schedule('0 0 9 * * 1', fn);

// 每月1号 0:00
cron.schedule('0 0 0 1 * *', fn);

// 工作日 9-18 点每小时
cron.schedule('0 0 9-18 * * 1-5', fn);
```

---

## 五、与 setInterval 对比

### 5.1 setInterval 的问题

```javascript
// setInterval 方式
setInterval(() => {
    console.log('每5分钟执行');
}, 5 * 60 * 1000);

// 问题：
// 1. 不是精确的"每5分钟"（0, 5, 10...）
// 2. 无法指定具体时间点
// 3. 时间漂移问题
```

### 5.2 node-cron 的优势

```javascript
// node-cron 方式
cron.schedule('0 */5 * * * *', () => {
    console.log('每5分钟执行');
});

// 优势：
// 1. 精确在 0, 5, 10... 分钟执行
// 2. 可以指定具体时间
// 3. 符合直觉的表达式
```

### 5.3 选择建议

```
┌─────────────────────────────────────────────────────────────────┐
│                    选择 setInterval 还是 node-cron              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  使用 setInterval：                                             │
│  - 简单的间隔执行                                               │
│  - 不需要精确时间点                                             │
│  - 短间隔（< 1分钟）                                            │
│                                                                 │
│  使用 node-cron：                                               │
│  - 需要在特定时间执行                                           │
│  - 需要精确的时间点                                             │
│  - 复杂的调度规则                                               │
│  - 长间隔任务                                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 六、项目中的定时任务列表

| 任务 | 表达式 | 说明 |
|-----|-------|------|
| 心跳 | `*/30 * * * * *` | 每30秒 |
| Ping | `0 * * * * *` | 每分钟 |
| 任务状态 | `0 */5 * * * *` | 每5分钟 |
| 云配置 | `0 0 * * * *` | 每小时 |
| OSS刷新 | `0 */30 * * * *` | 每30分钟 |
| 监控 | `0 * * * * *` | 每分钟 |

---

## 七、与 React 开发对比

### 7.1 前端定时任务

```javascript
// React 中通常用 setInterval
useEffect(() => {
    const timer = setInterval(() => {
        fetchData();
    }, 5000);

    return () => clearInterval(timer);
}, []);
```

### 7.2 关键区别

```
┌─────────────────────────────────────────────────────────────────┐
│                    前端 vs Node.js 定时任务                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  React 前端：                                                   │
│  - 页面关闭后任务停止                                           │
│  - 主要用于轮询、动画                                           │
│  - setInterval / setTimeout                                     │
│                                                                 │
│  Node.js 后端：                                                 │
│  - 进程持续运行                                                 │
│  - 需要精确调度                                                 │
│  - 使用 cron 表达式                                             │
│  - 任务之间可能有依赖                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 八、调试技巧

### 8.1 日志记录

```javascript
cron.schedule('* * * * *', () => {
    console.log(`[${new Date().toISOString()}] 任务执行`);
    doTask();
});
```

### 8.2 错误处理

```javascript
cron.schedule('* * * * *', async () => {
    try {
        await doTask();
    } catch (error) {
        console.error('任务执行失败:', error);
        // 上报错误
        reportError(error);
    }
});
```

### 8.3 任务状态监控

```javascript
const tasks = new Map();

function createTask(name, schedule, fn) {
    const task = cron.schedule(schedule, async () => {
        tasks.set(name, { lastRun: new Date(), status: 'running' });
        try {
            await fn();
            tasks.set(name, { lastRun: new Date(), status: 'success' });
        } catch (e) {
            tasks.set(name, { lastRun: new Date(), status: 'error', error: e });
        }
    });

    return task;
}

// 查看状态
function getTaskStatus() {
    return Object.fromEntries(tasks);
}
```
