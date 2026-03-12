# electron-store 配置存储

> Electron 应用的持久化配置存储

---

## 一、技术简介

### 1.1 什么是 electron-store

`electron-store` 是 Electron 应用中用于存储配置和少量数据的工具：

- **类似 LocalStorage**：但用于 Electron 主进程
- **JSON 文件存储**：数据保存为 JSON 文件
- **自动持久化**：修改后自动保存
- **类型安全**：支持 TypeScript

```
┌─────────────────────────────────────────────────────────────────┐
│                electron-store 工作原理                          │
└─────────────────────────────────────────────────────────────────┘

    JavaScript                    JSON 文件
    ┌──────────────┐             ┌──────────────┐
    │  store.set   │  ─────────► │ config.json  │
    │  ('key',     │   写入      │ {            │
    │   value)     │             │   "key":     │
    │              │             │   "value"    │
    │  store.get   │  ◄───────── │ }            │
    │  ('key')     │   读取      │              │
    └──────────────┘             └──────────────┘
                                      │
                                      ▼
                            存储在应用数据目录
                            %APPDATA%/{app}/
```

### 1.2 与 LocalStorage 对比

| 特性 | LocalStorage | electron-store |
|-----|-------------|----------------|
| 运行环境 | 渲染进程（浏览器） | 主进程（Node.js） |
| 存储位置 | 浏览器存储 | 文件系统 |
| 数据类型 | 只能字符串 | 任意 JSON 类型 |
| 容量限制 | 5MB | 无限制 |
| 变化监听 | 不支持 | ✅ 支持 |
| 加密 | 不支持 | ✅ 支持 |

---

## 二、项目中的使用

### 2.1 使用位置

```
src/common/store.js    # 主要封装文件
```

### 2.2 完整实现

```javascript
// src/common/store.js

const Store = require('electron-store');

// 创建 store 实例
const store = new Store();

module.exports = {
    // ═══════════════════════════════════════════════════════════════
    // GID（全局唯一标识）
    // ═══════════════════════════════════════════════════════════════
    getGid() {
        return store.get('gid');
    },
    setGid(gid) {
        store.set('gid', gid);
    },

    // ═══════════════════════════════════════════════════════════════
    // 用户ID
    // ═══════════════════════════════════════════════════════════════
    getUserId() {
        return store.get('userId');
    },
    setUserId(userId) {
        store.set('userId', userId);
    },
    clearUserId() {
        store.set('userId', '');
    },

    // 监听用户ID变化
    onUserIdChange: store.onDidChange.bind(store, 'userId'),

    // ═══════════════════════════════════════════════════════════════
    // 窗口状态（位置、大小）
    // ═══════════════════════════════════════════════════════════════
    getWindowState() {
        return store.get('windowState');
    },
    setWindowState(windowState) {
        store.set('windowState', windowState);
    },
    clearWindowState() {
        store.set('windowState', {});
    },

    // ═══════════════════════════════════════════════════════════════
    // CAS登录用户信息
    // ═══════════════════════════════════════════════════════════════
    setUserInfo(info) {
        store.set('userInfo', info);
    },
    getUserInfo() {
        return store.get('userInfo');
    },
    clearUserInfo() {
        store.set('userInfo', {});
    },

    // ═══════════════════════════════════════════════════════════════
    // 登录自动填充信息
    // ═══════════════════════════════════════════════════════════════
    setAutoCompleteInfo(info) {
        store.set('autoCompleteInfo', info);
    },
    getAutoCompleteInfo() {
        return store.get('autoCompleteInfo');
    },
    clearAutoCompleteInfo() {
        store.set('autoCompleteInfo', {});
    },

    // ═══════════════════════════════════════════════════════════════
    // 环境设置
    // ═══════════════════════════════════════════════════════════════
    getEnvSettings() {
        return store.get('envSettings');
    },
    setEnvSettings(settings) {
        store.set('envSettings', settings);
    },

    // ═══════════════════════════════════════════════════════════════
    // 灰度标识（是否体验版）
    // ═══════════════════════════════════════════════════════════════
    setIsGray(bool) {
        if (typeof bool === 'boolean') {
            store.set('isGray', bool);
        }
    },
    getIsGray() {
        const isGray = store.get('isGray');
        return typeof isGray === 'boolean' ? isGray : false;
    },
    onIsGrayChange: store.onDidChange.bind(store, 'isGray'),

    // ═══════════════════════════════════════════════════════════════
    // 注册列表（机器人列表）
    // ═══════════════════════════════════════════════════════════════
    setRegistryList(registryList) {
        store.set('registryList', registryList);
    },
    getRegistryList() {
        return store.get('registryList');
    },

    // ═══════════════════════════════════════════════════════════════
    // 活动信息（崩溃检测用）
    // ═══════════════════════════════════════════════════════════════
    getActivityInfo() {
        return store.get('activityInfo');
    },
    setActivityInfo(activityInfo) {
        store.set('activityInfo', activityInfo);
    },
};
```

---

## 三、常用 API

### 3.1 基础操作

```javascript
const Store = require('electron-store');
const store = new Store();

// 设置值
store.set('unicorn', '🦄');

// 获取值
console.log(store.get('unicorn'));  // 🦄

// 获取值（带默认值）
console.log(store.get('unknown', 'default'));  // default

// 检查是否存在
store.has('unicorn');  // true

// 删除
store.delete('unicorn');

// 清空所有
store.clear();
```

### 3.2 嵌套对象

```javascript
// 设置嵌套对象
store.set('user', {
    name: '张三',
    age: 25,
    settings: {
        theme: 'dark'
    }
});

// 获取嵌套值（使用点号）
store.get('user.name');           // 张三
store.get('user.settings.theme'); // dark

// 设置嵌套值
store.set('user.settings.theme', 'light');
```

### 3.3 监听变化

```javascript
// 监听特定 key 变化
const unsubscribe = store.onDidChange('userId', (newValue, oldValue) => {
    console.log(`userId changed from ${oldValue} to ${newValue}`);
});

// 监听任意变化
store.onDidAnyChange((newStore, oldStore) => {
    console.log('Store changed');
});

// 取消监听
unsubscribe();
```

### 3.4 高级配置

```javascript
const store = new Store({
    // 配置文件名
    name: 'config',

    // 加密（敏感数据）
    encryptionKey: 'your-encryption-key',

    // 默认值
    defaults: {
        userId: '',
        windowState: { width: 1060, height: 680 },
        isGray: false
    },

    // 数据校验
    schema: {
        userId: { type: 'string' },
        windowState: {
            type: 'object',
            properties: {
                width: { type: 'number' },
                height: { type: 'number' }
            }
        }
    }
});
```

---

## 四、项目中的应用场景

### 4.1 窗口状态保存

```javascript
// src/common/createStateWindow.js

const store = require('./store');
const { BrowserWindow } = require('electron');

function createStateWindow(options) {
    // 恢复上次的窗口状态
    const savedState = store.getWindowState() || {};

    const win = new BrowserWindow({
        ...options,
        width: savedState.width || options.width,
        height: savedState.height || options.height,
        x: savedState.x,
        y: savedState.y,
    });

    // 保存窗口状态
    const saveState = () => {
        const bounds = win.getBounds();
        store.setWindowState({
            width: bounds.width,
            height: bounds.height,
            x: bounds.x,
            y: bounds.y,
        });
    };

    win.on('resize', saveState);
    win.on('move', saveState);

    return win;
}
```

### 4.2 用户登录状态

```javascript
// 登录时保存用户信息
function onLoginSuccess(userInfo) {
    store.setUserId(userInfo.id);
    store.setUserInfo(userInfo);
}

// 退出时清除
function onLogout() {
    store.clearUserId();
    store.clearUserInfo();
}

// 启动时检查登录状态
function checkLoginStatus() {
    const userId = store.getUserId();
    if (userId) {
        // 已登录，恢复会话
    } else {
        // 未登录，跳转登录页
    }
}
```

### 4.3 崩溃检测

```javascript
// src/common/recordActivityInfo.js

const store = require('./store');

// 记录活动状态
function setRecordInfo(status) {
    store.setActivityInfo({
        status,           // 0=运行中, 1=正常退出
        lastActiveTime: Date.now(),
        pid: process.pid
    });
}

// 检测是否崩溃
function judgeCrashAndReport() {
    const info = store.getActivityInfo();

    if (info && info.status !== 1) {
        // 上次没有正常退出，说明崩溃了
        reportCrash(info);
    }

    // 标记为运行中
    setRecordInfo(0);
}
```

---

## 五、存储文件位置

### 5.1 默认位置

```
Windows: C:\Users\{用户名}\AppData\Roaming\{应用名}\config.json
macOS:   ~/Library/Application Support/{应用名}/config.json
Linux:   ~/.config/{应用名}/config.json
```

### 5.2 查看存储内容

```javascript
// 获取存储文件路径
console.log(store.path);

// 获取所有存储内容
console.log(store.store);
```

---

## 六、与 React 开发对比

### 6.1 类比理解

```javascript
// React 中的 LocalStorage
localStorage.setItem('user', JSON.stringify({ name: '张三' }));
const user = JSON.parse(localStorage.getItem('user'));

// Electron 中的 electron-store
store.set('user', { name: '张三' });  // 自动序列化
const user = store.get('user');        // 自动反序列化
```

### 6.2 为什么不直接用 LocalStorage

```
React App (浏览器)                 Electron App
┌──────────────────┐               ┌──────────────────┐
│   渲染进程       │               │   主进程         │
│                  │               │   (Node.js)      │
│  LocalStorage ✓  │               │   无浏览器API ✗  │
│                  │               │                  │
└──────────────────┘               │  electron-store ✓│
                                   └──────────────────┘

主进程运行在 Node.js 环境，没有浏览器 API，
所以需要 electron-store 来实现持久化存储。
```
