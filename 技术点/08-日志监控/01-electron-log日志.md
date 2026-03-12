# electron-log 日志

> Electron 应用日志库

---

## 一、技术简介

### 1.1 什么是 electron-log

`electron-log` 是专为 Electron 设计的日志库：

- **双进程支持**：主进程和渲染进程都可用
- **多输出目标**：控制台、文件、远程服务
- **自动轮转**：日志文件自动管理
- **格式化**：自定义日志格式

### 1.2 与 console.log 对比

```javascript
// console.log 的问题
console.log('用户登录');
// - 生产环境看不到
// - 不会保存到文件
// - 没有时间戳和级别

// electron-log 的优势
log.info('用户登录');
// - 同时输出到控制台和文件
// - 自动添加时间戳
// - 可配置日志级别
// - 支持远程上报
```

---

## 二、项目中的使用

### 2.1 使用位置

```
src/init/log.js    # 日志模块初始化和封装
```

### 2.2 完整配置

```javascript
// src/init/log.js

const log = require('electron-log');
const path = require('path');

// 配置控制台输出
log.transports.console.level = 'debug';
log.transports.console.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}';

// 配置文件输出
log.transports.file.level = 'info';
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}';
log.transports.file.maxSize = 10 * 1024 * 1024;  // 10MB
log.transports.file.fileName = 'app.log';

// 自定义日志路径
log.transports.file.resolvePath = () => {
    return path.join(app.getPath('userData'), 'logs', 'app.log');
};

module.exports = log;
```

### 2.3 封装的日志工具

```javascript
// src/init/log.js

const log = require('electron-log');
const slsLog = require('./slsLog');

const logUtil = {
    /**
     * 自定义日志输出
     */
    customLog: (message, options = {}) => {
        const { level = 'info', scope, wxId, taskId, error } = options;

        // 构建日志内容
        const logData = {
            message,
            scope,
            wxId,
            taskId,
            timestamp: new Date().toISOString()
        };

        // 本地日志
        if (error) {
            log.error(JSON.stringify(logData), error);
        } else {
            log[level](JSON.stringify(logData));
        }

        // 上报到阿里云 SLS（仅错误）
        if (level === 'error') {
            slsLog.reportError(logData);
        }
    },

    /**
     * 信息日志
     */
    info: (message, data) => {
        logUtil.customLog(message, { level: 'info', ...data });
    },

    /**
     * 警告日志
     */
    warn: (message, data) => {
        logUtil.customLog(message, { level: 'warn', ...data });
    },

    /**
     * 错误日志
     */
    error: (message, error, data) => {
        logUtil.customLog(message, { level: 'error', error, ...data });
    }
};

module.exports = logUtil;
```

### 2.4 业务中的使用

```javascript
const logUtil = require('../../init/log');

// 基础日志
logUtil.info('用户登录成功');
logUtil.warn('配置未找到，使用默认值');
logUtil.error('连接失败', error);

// 带上下文的日志
logUtil.customLog('发送消息成功', {
    level: 'info',
    wxId: 'wxid_xxx',
    taskId: 'task_123',
    scope: 'mqttChatService'
});

// 错误日志（会上报到 SLS）
logUtil.customLog('任务执行失败', {
    level: 'error',
    error: new Error('timeout'),
    wxId: 'wxid_xxx',
    taskId: 'task_123'
});
```

---

## 三、常用 API

### 3.1 日志级别

```javascript
const log = require('electron-log');

// 日志级别（从低到高）
log.silly('详细调试信息');
log.debug('调试信息');
log.verbose('详细信息');
log.info('一般信息');
log.warn('警告');
log.error('错误');
```

### 3.2 配置输出

```javascript
// 控制台配置
log.transports.console.level = 'debug';
log.transports.console.format = '{h}:{i}:{s} {level} > {text}';

// 文件配置
log.transports.file.level = 'info';
log.transports.file.maxSize = 5 * 1024 * 1024;  // 5MB

// 禁用某个输出
log.transports.console.level = false;
```

### 3.3 日志格式

```javascript
// 可用的格式变量
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

// {y}  - 年
// {m}  - 月
// {d}  - 日
// {h}  - 时
// {i}  - 分
// {s}  - 秒
// {ms} - 毫秒
// {level} - 日志级别
// {text}  - 日志内容
```

### 3.4 自定义输出

```javascript
// 添加自定义 transport
log.transports.myTransport = (message) => {
    // 自定义处理逻辑
    sendToServer(message);
};

log.transports.myTransport.level = 'error';
```

### 3.5 异常捕获

```javascript
// 自动捕获未处理异常
log.catchErrors({
    showDialog: true,  // 显示错误对话框
    onError: (error) => {
        // 上报到服务器
        reportError(error);
    }
});
```

---

## 四、日志文件管理

### 4.1 日志文件位置

```javascript
// 获取日志文件路径
const logPath = log.transports.file.getFile().path;
console.log(logPath);

// 默认位置：
// Windows: %USERPROFILE%\AppData\Roaming\{app}\logs\
// macOS:   ~/Library/Logs/{app}/
// Linux:   ~/.config/{app}/logs/
```

### 4.2 日志轮转

```javascript
// 按大小轮转
log.transports.file.maxSize = 10 * 1024 * 1024;  // 10MB

// 保留旧日志
// 会自动创建 app.old.log
```

### 4.3 清理日志

```javascript
// 清空日志文件
log.transports.file.getFile().clear();

// 手动归档
const fs = require('fs');
const logPath = log.transports.file.getFile().path;
fs.renameSync(logPath, logPath + '.backup');
```

---

## 五、与 React 开发对比

### 5.1 前端日志

```javascript
// React 前端通常用 console
console.log('组件渲染');
console.error('API 请求失败');

// 或用日志库如 loglevel
import log from 'loglevel';
log.setLevel('info');
log.info('用户操作');
```

### 5.2 关键区别

```
┌─────────────────────────────────────────────────────────────────┐
│                    前端 vs Electron 日志                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  React 前端：                                                   │
│  - console.log 输出到浏览器控制台                               │
│  - 用户刷新后日志消失                                           │
│  - 需要额外工具上报到服务器                                      │
│                                                                 │
│  Electron 应用：                                                │
│  - 日志保存到本地文件                                           │
│  - 应用崩溃后可以查看日志                                        │
│  - 可以自动上报错误                                             │
│  - 需要处理主进程和渲染进程的日志                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5.3 渲染进程中使用

```javascript
// 渲染进程（React 页面）
const log = require('electron-log');

// 直接使用
log.info('用户点击按钮');

// 或通过 IPC 发送到主进程
const { ipcRenderer } = require('electron');
ipcRenderer.send('log', { level: 'info', message: '...' });
```

---

## 六、调试技巧

### 6.1 开发环境详细日志

```javascript
if (process.env.NODE_ENV === 'development') {
    log.transports.console.level = 'debug';
    log.transports.file.level = 'debug';
} else {
    log.transports.console.level = false;  // 生产环境关闭控制台
    log.transports.file.level = 'info';
}
```

### 6.2 查找日志文件

```bash
# Windows
%USERPROFILE%\AppData\Roaming\galaxy-client\logs\

# macOS
~/Library/Logs/galaxy-client/
```

### 6.3 日志分析

```javascript
// 添加结构化日志便于分析
log.info(JSON.stringify({
    action: 'send_message',
    wxId: 'wxid_xxx',
    messageType: 'text',
    duration: 123,
    success: true
}));
```
