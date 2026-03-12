# ali-sls 阿里云日志服务

> 阿里云日志服务 SDK

---

## 一、技术简介

### 1.1 什么是 SLS

SLS（Simple Log Service）是阿里云的日志服务：

- **日志采集**：从多个来源收集日志
- **实时查询**：支持 SQL 查询日志
- **可视化**：图表、仪表盘
- **告警**：基于日志触发告警

### 1.2 为什么需要云端日志

```
┌─────────────────────────────────────────────────────────────────┐
│                    本地日志 vs 云端日志                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  本地日志（electron-log）：                                      │
│  - 保存在用户电脑                                               │
│  - 需要用户手动上传                                             │
│  - 难以统一分析                                                 │
│                                                                 │
│  云端日志（SLS）：                                              │
│  - 自动上报到云端                                               │
│  - 可以集中查询分析                                             │
│  - 支持告警通知                                                 │
│  - 查看所有客户端的情况                                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、项目中的使用

### 2.1 使用位置

```
src/init/slsLog.js    # SLS 日志客户端初始化和上报
```

### 2.2 完整实现

```javascript
// src/init/slsLog.js

const SlsWebLogger = require('aliyun-sls-web-track');
const { httpFetch } = require('../common/fetch');
const store = require('../common/store');

let slsLogger = null;

/**
 * 初始化 SLS 客户端
 */
async function initSlsLogger() {
    try {
        // 从服务器获取 SLS 配置
        const config = await httpFetch({
            url: '/api/sls/config',
            data: {}
        });

        const {
            accessKeyId,
            accessKeySecret,
            securityToken,
            endpoint,
            project,
            logstore
        } = config.data;

        // 创建 SLS Logger 实例
        slsLogger = new SlsWebLogger({
            host: endpoint,
            project: project,
            logstore: logstore,
            accessKeyId: accessKeyId,
            accessKeySecret: accessKeySecret,
            securityToken: securityToken
        });

        console.log('[SLS] 初始化成功');

    } catch (error) {
        console.error('[SLS] 初始化失败:', error);
    }
}

/**
 * 上报日志
 */
function report(logData) {
    if (!slsLogger) {
        console.warn('[SLS] Logger 未初始化');
        return;
    }

    // 添加公共字段
    const enrichedLog = {
        ...logData,
        gid: store.getGid(),
        appVersion: require('../../package.json').version,
        platform: process.platform,
        timestamp: Date.now()
    };

    // 发送日志
    slsLogger.send(enrichedLog);
}

/**
 * 上报错误
 */
function reportError(errorInfo) {
    report({
        type: 'error',
        ...errorInfo,
        stack: errorInfo.error?.stack
    });
}

/**
 * 上报性能指标
 */
function reportPerformance(metrics) {
    report({
        type: 'performance',
        ...metrics
    });
}

/**
 * 上报业务事件
 */
function reportEvent(eventName, eventData) {
    report({
        type: 'event',
        event: eventName,
        ...eventData
    });
}

module.exports = {
    initSlsLogger,
    report,
    reportError,
    reportPerformance,
    reportEvent
};
```

### 2.3 业务中的使用

```javascript
const slsLog = require('../../init/slsLog');

// 上报错误
slsLog.reportError({
    error: new Error('连接超时'),
    wxId: 'wxid_xxx',
    taskId: 'task_123',
    scope: 'mqttClient'
});

// 上报业务事件
slsLog.reportEvent('message_sent', {
    wxId: 'wxid_xxx',
    messageType: 'text',
    targetType: 'group',
    success: true
});

// 上报性能指标
slsLog.reportPerformance({
    memoryUsage: process.memoryUsage().heapUsed,
    cpuUsage: cpuPercent,
    activeConnections: connectionCount
});
```

---

## 三、SLS 核心概念

### 3.1 数据结构

```
Project（项目）
├── Logstore（日志库）
│   ├── Shard（分片）
│   │   └── Log（日志）
│   └── Index（索引）
└── Dashboard（仪表盘）
```

### 3.2 日志格式

```javascript
// 每条日志是一个 key-value 对象
{
    "__time__": 1705900000,      // 时间戳（自动添加）
    "__source__": "192.168.1.1", // 来源（自动添加）

    // 自定义字段
    "type": "error",
    "message": "连接超时",
    "wxId": "wxid_xxx",
    "gid": "gid_123"
}
```

---

## 四、常用 API

### 4.1 初始化

```javascript
const SlsWebLogger = require('aliyun-sls-web-track');

const logger = new SlsWebLogger({
    host: 'cn-beijing.log.aliyuncs.com',
    project: 'my-project',
    logstore: 'my-logstore',
    accessKeyId: 'xxx',
    accessKeySecret: 'xxx',
    securityToken: 'xxx'  // STS 临时凭证
});
```

### 4.2 发送日志

```javascript
// 发送单条日志
logger.send({
    level: 'info',
    message: '用户登录',
    userId: '123'
});

// 批量发送
logger.sendBatch([
    { message: 'log1' },
    { message: 'log2' }
]);
```

### 4.3 STS 临时凭证

```javascript
// 项目中使用 STS 临时凭证（更安全）
async function refreshSlsCredentials() {
    const res = await httpFetch({ url: '/api/sls/sts' });

    // 更新凭证
    slsLogger.setCredentials({
        accessKeyId: res.accessKeyId,
        accessKeySecret: res.accessKeySecret,
        securityToken: res.securityToken
    });
}

// 定期刷新（凭证有效期前）
setInterval(refreshSlsCredentials, 30 * 60 * 1000);
```

---

## 五、日志查询（阿里云控制台）

### 5.1 SQL 查询

```sql
-- 查询最近1小时的错误
* | SELECT * FROM log WHERE type = 'error' ORDER BY __time__ DESC LIMIT 100

-- 按错误类型统计
* | SELECT message, COUNT(*) as count FROM log
    WHERE type = 'error'
    GROUP BY message
    ORDER BY count DESC

-- 查询特定用户
* | SELECT * FROM log WHERE wxId = 'wxid_xxx'
```

### 5.2 关键字搜索

```
# 搜索包含 "超时" 的日志
超时

# 搜索特定字段
type: error AND wxId: wxid_xxx

# 时间范围
type: error | SELECT * WHERE __time__ > now() - interval '1' hour
```

---

## 六、与本地日志配合

### 6.1 双写策略

```javascript
// src/init/log.js

const log = require('electron-log');
const slsLog = require('./slsLog');

const logUtil = {
    error: (message, error, data) => {
        // 1. 写入本地日志
        log.error(message, error);

        // 2. 上报到 SLS
        slsLog.reportError({
            message,
            error,
            ...data
        });
    }
};
```

### 6.2 分级上报

```javascript
// 只上报重要日志到 SLS（节省成本）
const logUtil = {
    info: (message) => {
        log.info(message);  // 仅本地
    },

    warn: (message) => {
        log.warn(message);  // 仅本地
    },

    error: (message, error) => {
        log.error(message, error);     // 本地
        slsLog.reportError({ message, error }); // 云端
    }
};
```

---

## 七、与 React 开发对比

### 7.1 前端日志上报

```javascript
// React 前端通常用 sentry 或自建服务
import * as Sentry from '@sentry/react';

Sentry.captureException(error);

// 或使用 SLS Web 版
import SlsTracker from '@aliyun-sls/web-track-browser';
const tracker = new SlsTracker({ /* config */ });
tracker.send({ message: 'click_button' });
```

### 7.2 关键区别

```
┌─────────────────────────────────────────────────────────────────┐
│                    前端 vs Electron 日志上报                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  React 前端：                                                   │
│  - 在浏览器中运行                                               │
│  - 通常用 Sentry/LogRocket                                      │
│  - 需要考虑用户网络                                             │
│                                                                 │
│  Electron 应用：                                                │
│  - 在用户电脑上运行                                             │
│  - 可以使用更多 SDK                                             │
│  - 可以批量缓存后上报                                           │
│  - 需要处理离线场景                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 八、注意事项

### 8.1 凭证安全

```javascript
// ❌ 不要硬编码 AK/SK
const logger = new SlsWebLogger({
    accessKeyId: 'LTAI...',  // 危险！
    // ...
});

// ✅ 使用 STS 临时凭证
const sts = await fetchStsFromServer();
const logger = new SlsWebLogger({
    accessKeyId: sts.accessKeyId,
    securityToken: sts.securityToken,
    // ...
});
```

### 8.2 日志脱敏

```javascript
function sanitizeLog(data) {
    const sanitized = { ...data };

    // 移除敏感信息
    delete sanitized.password;
    delete sanitized.token;

    // 脱敏手机号
    if (sanitized.phone) {
        sanitized.phone = sanitized.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
    }

    return sanitized;
}

slsLog.report(sanitizeLog(logData));
```

### 8.3 避免日志风暴

```javascript
// 限流：相同日志1分钟内只上报一次
const reported = new Map();

function rateLimitedReport(logData) {
    const key = JSON.stringify(logData);
    const now = Date.now();

    if (reported.has(key) && now - reported.get(key) < 60000) {
        return;  // 1分钟内已上报
    }

    reported.set(key, now);
    slsLog.report(logData);
}
```
