# 08 — electron-store 持久化存储机制

> **文档定位**：所有持久化数据的读写方式、监听方式、数据结构。  
> **关联仓库**：`galaxy-client`（Electron 主进程）

---

## 目录

1. [electron-store 选型原因](#1-electron-store-选型原因)
2. [store.js 全量解析](#2-storejs-全量解析)
3. [各字段详细说明](#3-各字段详细说明)
4. [store 变更事件广播机制](#4-store-变更事件广播机制)
5. [渲染进程读写 store](#5-渲染进程读写-store)
6. [数据存储位置与文件格式](#6-数据存储位置与文件格式)
7. [与 SQLite 的职责边界](#7-与-sqlite-的职责边界)
8. [createStateWindow 中的 store 应用](#8-createstatewindow-中的-store-应用)

---

## 1. electron-store 选型原因

### 1.1 技术对比

| 方案 | 数据结构 | 读写性能 | 适合场景 | 弊端 |
|------|---------|---------|---------|------|
| **electron-store** | Key-Value（JSON 文件） | 极快（同步读写） | 配置项、状态标记、少量结构化数据 | 不适合大量关系型数据 |
| SQLite | 关系型表 | 较慢（需查询） | 好友列表、群聊列表、消息记录 | 初始化需要建表 |
| localStorage | Key-Value | 快 | 仅渲染进程可用 | 主进程无法访问 |
| 内存变量 | 任意 | 最快 | 运行时缓存 | 进程退出即丢失 |

### 1.2 选择 electron-store 的原因

1. **主进程可用**：不依赖渲染进程的 DOM/BOM 环境
2. **文件持久化**：数据存储在 JSON 文件中，进程退出不丢失
3. **变更监听**：原生支持 `onDidChange` 回调，方便实现响应式更新
4. **原子操作**：读写操作是同步的，不存在并发问题
5. **轻量级**：无需额外服务进程或编译原生模块

---

## 2. store.js 全量解析

**文件路径**：`galaxy-client/src/common/store.js`

### 2.1 完整代码

```javascript
const Store = require('electron-store');

const store = new Store();

module.exports = {
    // ========== gid（设备唯一ID）==========
    getGid()          { return store.get('gid'); },
    setGid(gid)       { store.set('gid', gid); },

    // ========== userId（当前登录用户ID）==========
    getUserId()       { return store.get('userId'); },
    setUserId(userId) { store.set('userId', userId); },
    clearUserId()     { store.set('userId', ''); },
    onUserIdChange:   store.onDidChange.bind(store, 'userId'),

    // ========== windowState（窗口位置/大小）==========
    getWindowState()             { return store.get('windowState'); },
    setWindowState(windowState)  { store.set('windowState', windowState); },
    clearWindowState()           { store.set('windowState', {}); },

    // ========== userInfo（CAS登录用户信息）==========
    setUserInfo(info)   { store.set('userInfo', info); },
    getUserInfo()       { return store.get('userInfo'); },
    clearUserInfo()     { store.set('userInfo', {}); },

    // ========== autoCompleteInfo（CAS自动填充信息）==========
    setAutoCompleteInfo(info)  { store.set('autoCompleteInfo', info); },
    getAutoCompleteInfo()      { return store.get('autoCompleteInfo'); },
    clearAutoCompleteInfo()    { store.set('autoCompleteInfo', {}); },

    // ========== envSettings（运行时环境配置）==========
    getEnvSettings()            { return store.get('envSettings'); },
    setEnvSettings(settings)    { store.set('envSettings', settings); },

    // ========== isGray（灰度标记）==========
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

    // ========== windowIp（本机IP）==========
    getWindowIp()  { return store.get('windowIp'); },

    // ========== registryList（已连接微信实例列表）==========
    setRegistryList(registryList) { store.set('registryList', registryList); },
    getRegistryList()             { return store.get('registryList'); },

    // ========== activityInfo（崩溃检测心跳记录）==========
    getActivityInfo()               { return store.get('activityInfo'); },
    setActivityInfo(activityInfo)   { store.set('activityInfo', activityInfo); },
};
```

### 2.2 实例化方式

```javascript
const store = new Store();
```

使用默认配置创建实例：
- **文件名**：`config.json`
- **存储路径**：`{userData}/config.json`
- **无默认值**：字段不存在时返回 `undefined`
- **无加密**：明文 JSON 存储

---

## 3. 各字段详细说明

### 3.1 gid — 设备唯一 ID

| 属性 | 值 |
|------|-----|
| 存储键 | `gid` |
| 数据类型 | `string` |
| 生成规则 | `{32位随机字符串}_{系统信息}` |
| 生成时机 | 首次读取且不存在时自动生成 |
| 持久性 | 永久保留（除非手动清除） |

**文件路径**：`galaxy-client/src/common/gid.js`

```javascript
function getStoreGid() {
    let gid = store.getGid();
    if (!gid) {
        gid = `${randomString(32)}_${getSystemInfo()}`;
        store.setGid(gid);
    }
    return gid;
}
```

**使用场景**：
- SLS 日志上报时作为设备标识
- Habo 埋点中的 `gid` 字段
- Cookie 写入（`writeGidCookie`）
- 崩溃检测记录

### 3.2 userId — 当前登录用户 ID

| 属性 | 值 |
|------|-----|
| 存储键 | `userId` |
| 数据类型 | `string` |
| 写入时机 | CAS 登录成功后 |
| 清除时机 | 用户登出时（`clearUserId`） |
| 变更监听 | `onUserIdChange` → 触发页面重载 |

**变更副作用**：

```
userId 变更
    │
    ▼
onUserIdChange 回调触发
    │
    ├── userId === '' (登出)
    │   └── getLoadUrlAsync() → mainWindow.loadURL(loginUrl)
    │
    └── userId !== '' (登录)
        └── （目前无额外处理）
```

### 3.3 windowState — 窗口位置/大小持久化

| 属性 | 值 |
|------|-----|
| 存储键 | `windowState` |
| 数据类型 | `object` |
| 数据结构 | `{ x, y, width, height, max }` |
| 写入时机 | 窗口关闭或移动时 |
| 读取时机 | 窗口创建时 |

**数据结构**：

```javascript
{
    x: 100,       // 窗口左上角 X 坐标
    y: 200,       // 窗口左上角 Y 坐标
    width: 1200,  // 窗口宽度
    height: 800,  // 窗口高度
    max: 0        // 是否最大化（0=否, 1=是）
}
```

**文件路径**：`galaxy-client/src/common/createStateWindow.js`

```javascript
// 恢复窗口状态
const restore = () => {
    const restoredState = store.getWindowState();
    return { ...defaultSize, ...restoredState };
};

// 保存窗口状态
const saveState = () => {
    if (!win.isMinimized() && !win.isMaximized()) {
        Object.assign(state, getCurrentPosition(), { max: 0 });
    } else if (win.isMaximized()) {
        Object.assign(state, { max: 1 });
    }
    store.setWindowState(state);
};

// 窗口关闭时保存
win.on('close', saveState);
```

### 3.4 userInfo — CAS 登录用户信息

| 属性 | 值 |
|------|-----|
| 存储键 | `userInfo` |
| 数据类型 | `object` |
| 写入时机 | 渲染进程调用 `ipc.send('set-user-info', info)` |
| 读取场景 | SLS 上报、Habo 埋点、崩溃检测 |

**典型数据结构**：

```javascript
{
    user: "zhangsan",          // CAS 用户名
    name: "张三",              // 显示名称
    department: "创新技术部",   // 部门
    accoundId: "12345"         // 账号 ID
}
```

**使用场景**：
```javascript
// SLS 日志中携带用户信息
const casUserInfo = store.getUserInfo();
slsClient.info(`[${casUserInfo?.user}] [${gid}] [${version}] ${message}`);

// 崩溃检测记录 CAS ID
const casUserInfo = store.getUserInfo() || {};
recordInfo.casId = casUserInfo.user;
```

### 3.5 autoCompleteInfo — CAS 自动填充信息

| 属性 | 值 |
|------|-----|
| 存储键 | `autoCompleteInfo` |
| 数据类型 | `object` |
| 写入时机 | 登录成功后由 `inject.js` 触发 |
| 使用场景 | CAS 登录页自动填入用户名 |

**数据结构**：
```javascript
{
    username: "zhangsan"   // 上次登录的用户名
}
```

配合 `inject.js` 中的 CAS 自动填充逻辑：
```javascript
// inject.js 检测到 CAS 登录页后
// 通过 IPC 获取 autoCompleteInfo
// 使用 nativeInputValueSetter 填入用户名
```

### 3.6 envSettings — 运行时环境配置

| 属性 | 值 |
|------|-----|
| 存储键 | `envSettings` |
| 数据类型 | `object` |
| 写入方式 | 渲染进程调用 `ipc.send('set-env-settings', settings)` |
| 读取方式 | `ipc.callMain('get-env-settings')` |

**数据结构**：
```javascript
{
    ingressTrafficEnv: "gray",  // 入口流量环境标识
    trafficEnv: "test"          // 流量环境标识
}
```

**特殊用途**：`createStateWindow.js` 中拦截 HTTP 请求头注入环境标识：

```javascript
ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const envSettings = store.getEnvSettings();
    if (envSettings && envSettings.ingressTrafficEnv) {
        details.requestHeaders['ingress-traffic-env'] = envSettings.ingressTrafficEnv;
    }
    if (envSettings && envSettings.trafficEnv) {
        details.requestHeaders['traffic-env'] = envSettings.trafficEnv;
    }
    callback({ requestHeaders: details.requestHeaders });
});
```

这使得通过 BrowserWindow 发出的所有 HTTP 请求都会自动携带环境路由头。

### 3.7 isGray — 灰度标记

| 属性 | 值 |
|------|-----|
| 存储键 | `isGray` |
| 数据类型 | `boolean` |
| 默认值 | `false` |
| 写入方式 | `ipc.on('set-is-gray')` |
| 类型校验 | 只接受 `boolean` 类型 |
| 变更监听 | `onIsGrayChange` → 触发页面重载 |

**变更副作用**：
```javascript
store.onIsGrayChange(() => {
    getLoadUrlAsync().then(url => {
        const { mainWindow } = app;
        log.info('LOAD AFTER GRAY CHANGED', url);
        mainWindow && mainWindow.loadURL(url);
    });
});
```

灰度标记变更后会重新加载页面 URL，可能导致加载不同的配置源（灰度 vs 正式）。

### 3.8 registryList — 已连接微信实例列表

| 属性 | 值 |
|------|-----|
| 存储键 | `registryList` |
| 数据类型 | `array` |
| 写入时机 | Named Pipe 连接建立/断开时 |
| 持久化目的 | 进程重启后可恢复连接信息 |

**数据结构**：
```javascript
[
    {
        id: "pipe_12345",       // 管道连接 ID
        wxid: "wxid_abc123",    // 微信 ID
        workWx: false,          // 是否企业微信
        wxInfo: {               // 微信账号详情
            nickname: "张三",
            username: "zhangsan_wx",
            headUrl: "https://..."
        }
    }
]
```

### 3.9 activityInfo — 崩溃检测心跳记录

| 属性 | 值 |
|------|-----|
| 存储键 | `activityInfo` |
| 数据类型 | `object` |
| 写入频率 | 每 10 秒（由定时任务触发）|
| 写入条件 | 距上次写入 > 6 秒 |
| 检测逻辑 | 启动时读取，若 `status=0` 且 `now - time > 30s` 则视为崩溃 |

**数据结构**：
```javascript
{
    status: 0,                    // 0=运行中，1=正常退出
    time: 1678901234567,          // 写入时间戳
    timeStr: "2026-03-13 10:00",  // 格式化时间
    appStartTime: 1678900000000,  // 应用启动时间
    appStartTimeStr: "2026-03-13 09:30",
    casId: "zhangsan",            // CAS 用户 ID
    clientVersion: "5.5.0-release01",  // 客户端版本
    wxIdStr: "wxid_abc,wxid_def", // 所有连接的微信 ID
    // ...memoryInfo 内存信息
}
```

**崩溃检测流程**（`recordActivityInfo.js`）：

```
启动时
    │
    ▼
读取 store.getActivityInfo()
    │
    ├── status === 0 (上次在运行中)
    │   AND now - time > 30s (超过 30 秒没更新)
    │   AND clientVersion 一致
    │   │
    │   ▼
    │   判定为崩溃 → reportLog({ name: 'CRASH', ...lastRecord })
    │
    └── status === 1 或其他
        └── 正常退出，无需上报

运行中（每 10 秒）
    │
    ▼
setRecordInfo(0)  → 写入 status=0

正常退出时（before-quit）
    │
    ▼
setRecordInfo(1)  → 写入 status=1
```

---

## 4. store 变更事件广播机制

**文件路径**：`galaxy-client/src/event/store.js`

### 4.1 完整代码

```javascript
module.exports = () => {
    // userId 变更 → 重载登录页
    store.onUserIdChange(userId => {
        if (userId === '') {
            getLoadUrlAsync().then(url => {
                const { mainWindow } = app;
                mainWindow && mainWindow.loadURL(url);
            });
        }
    });

    // isGray 变更 → 重载配置页
    store.onIsGrayChange(() => {
        getLoadUrlAsync().then(url => {
            const { mainWindow } = app;
            mainWindow && mainWindow.loadURL(url);
        });
    });
};
```

### 4.2 变更事件注册时序

```
electron.js → bootstrap()
    │
    ├── addStoreEvent()  ← 在这里注册变更监听
    │   ├── onUserIdChange → 处理登出
    │   └── onIsGrayChange → 处理灰度切换
    │
    ├── addIpcEvent()    ← 这里注册 IPC 写入通道
    │   ├── set-user-info → store.setUserInfo()
    │   ├── set-is-gray → store.setIsGray() → 触发 onIsGrayChange
    │   └── userLogout → store.clearUserId() → 触发 onUserIdChange
    │
    └── AppStart.run()
```

### 4.3 onDidChange 机制

`electron-store` 的 `onDidChange` 基于 JSON 文件监控：

```
store.set('userId', 'zhangsan')
    │
    ▼
写入 config.json 文件
    │
    ▼
触发 onDidChange('userId') 回调
    │
    ▼
回调接收 (newValue, oldValue) 参数
```

**注意**：`onDidChange` 只在值真正发生变化时触发（deep equal 比较）。

---

## 5. 渲染进程读写 store

### 5.1 通过 IPC 间接读写

渲染进程**不直接**访问 `electron-store`，而是通过 IPC 调用主进程：

| 操作 | IPC 事件 | 模式 |
|------|---------|------|
| 获取配置 | `get-app-config` | 同步 (`event.returnValue`) |
| 设置用户信息 | `set-user-info` | 单向 (`ipc.on`) |
| 设置灰度标记 | `set-is-gray` | 同步 (`event.returnValue`) |
| 获取灰度标记 | `get-is-gray` | 同步 (`event.returnValue`) |
| 设置环境配置 | `set-env-settings` | 单向 (`ipc.on`) |
| 获取环境配置 | `get-env-settings` | 异步 (`ipc.handle`) |

### 5.2 通过 @electron/remote 直接读写

由于 `nodeIntegration: true` 和 `inject.js` 注入了 `window.eleRemote`，渲染进程理论上可以直接 `require('electron-store')` 创建新实例访问同一文件。但项目中统一通过 IPC 封装。

---

## 6. 数据存储位置与文件格式

### 6.1 存储路径

| 平台 | 路径 |
|------|------|
| Windows | `C:\Users\{user}\AppData\Roaming\{appName}\config.json` |
| macOS | `~/Library/Application Support/{appName}/config.json` |

其中 `{appName}` 来自 `package.json` 的 `name` 字段（`weixinzhushou`）。

### 6.2 文件格式

```json
{
    "gid": "a1b2c3d4e5f6...DESKTOP-ABC123_Windows_10",
    "userId": "zhangsan",
    "windowState": {
        "x": 100,
        "y": 200,
        "width": 1200,
        "height": 800,
        "max": 0
    },
    "userInfo": {
        "user": "zhangsan",
        "name": "张三",
        "department": "创新技术部"
    },
    "autoCompleteInfo": {
        "username": "zhangsan"
    },
    "envSettings": {
        "ingressTrafficEnv": "",
        "trafficEnv": ""
    },
    "isGray": false,
    "registryList": [],
    "activityInfo": {
        "status": 1,
        "time": 1678901234567,
        "clientVersion": "5.5.0-release01"
    }
}
```

### 6.3 安全注意事项

- 文件为**明文 JSON**，不含加密
- 存储在用户 AppData 目录下，普通用户可直接读取
- **不应存储敏感信息**（密码、Token 等）
- `userInfo` 中仅包含 CAS 用户名和部门信息

---

## 7. 与 SQLite 的职责边界

### 7.1 职责对比

| 维度 | electron-store | SQLite (Sequelize) |
|------|---------------|-------------------|
| 数据类型 | 配置项、状态标记、简单对象 | 结构化关系数据 |
| 数据量 | 数十个 Key | 数千~数万条记录 |
| 查询需求 | 按 Key 精确读取 | 需要 WHERE、JOIN、分页 |
| 更新频率 | 低~中（秒级） | 高（毫秒级批量） |
| 持久性 | 应用全生命周期 | 与微信会话生命周期绑定 |
| 访问方式 | 同步读写 | 异步 Promise |

### 7.2 数据分布

```
electron-store (config.json)
├── gid                    ← 设备标识
├── userId                 ← 当前登录用户
├── windowState            ← 窗口位置
├── userInfo               ← CAS 用户信息
├── autoCompleteInfo       ← 自动填充
├── envSettings            ← 环境配置
├── isGray                 ← 灰度标记
├── registryList           ← 微信连接列表
└── activityInfo           ← 崩溃检测心跳

SQLite (data.db)
├── chatrooms              ← 群聊信息
├── friends                ← 好友信息
├── external_users         ← 外部用户
├── conversations          ← 会话列表
├── wk_*                   ← 企微相关表
└── ...                    ← 其他业务表
```

### 7.3 选择原则

- **用 electron-store**：应用级配置、用户偏好、全局状态标记
- **用 SQLite**：业务实体数据、需要复杂查询的数据、大量结构化数据

---

## 8. createStateWindow 中的 store 应用

**文件路径**：`galaxy-client/src/common/createStateWindow.js`

### 8.1 窗口状态管理

```javascript
module.exports = options => {
    // 1. 恢复上次窗口位置
    state = ensureVisibleOnSomeDisplay(restore());

    // 2. 创建窗口
    win = new BrowserWindow({ ...options, ...state });

    // 3. 如果上次是最大化状态，恢复最大化
    if (state.max) {
        win.maximize();
    }

    // 4. 窗口关闭时保存位置
    win.on('close', saveState);

    return win;
};
```

### 8.2 多显示器适配

```javascript
const ensureVisibleOnSomeDisplay = windowState => {
    const visible = screen.getAllDisplays().some(
        display => windowWithinBounds(windowState, display.bounds)
    );
    if (!visible) {
        return resetToDefaults();  // 回退到主显示器中心
    }
    return windowState;
};
```

当用户拔掉外接显示器后，窗口可能位于不可见区域。`ensureVisibleOnSomeDisplay` 检测所有显示器，如果窗口不在任何显示器范围内，则重置到主显示器中心。

### 8.3 HTTP 请求头注入

```javascript
const ses = win.webContents.session;
ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const envSettings = store.getEnvSettings();
    if (envSettings?.ingressTrafficEnv) {
        details.requestHeaders['ingress-traffic-env'] = envSettings.ingressTrafficEnv;
    }
    if (envSettings?.trafficEnv) {
        details.requestHeaders['traffic-env'] = envSettings.trafficEnv;
    }
    callback({ requestHeaders: details.requestHeaders });
});
```

通过 `webRequest` API 拦截所有 HTTP 请求，注入 `envSettings` 中的流量环境标识头，实现动态流量路由。

---

## 附录 A：store 方法速查表

| 方法 | 操作 | 返回类型 |
|------|------|---------|
| `getGid()` | 读取 gid | `string \| undefined` |
| `setGid(gid)` | 写入 gid | `void` |
| `getUserId()` | 读取 userId | `string \| undefined` |
| `setUserId(userId)` | 写入 userId | `void` |
| `clearUserId()` | 清空 userId | `void` |
| `onUserIdChange` | 监听 userId 变更 | `Function` (注册回调) |
| `getWindowState()` | 读取窗口状态 | `object \| undefined` |
| `setWindowState(state)` | 写入窗口状态 | `void` |
| `clearWindowState()` | 清空窗口状态 | `void` |
| `setUserInfo(info)` | 写入用户信息 | `void` |
| `getUserInfo()` | 读取用户信息 | `object \| undefined` |
| `clearUserInfo()` | 清空用户信息 | `void` |
| `setAutoCompleteInfo(info)` | 写入自动填充 | `void` |
| `getAutoCompleteInfo()` | 读取自动填充 | `object \| undefined` |
| `clearAutoCompleteInfo()` | 清空自动填充 | `void` |
| `getEnvSettings()` | 读取环境配置 | `object \| undefined` |
| `setEnvSettings(settings)` | 写入环境配置 | `void` |
| `setIsGray(bool)` | 设置灰度标记 | `void` |
| `getIsGray()` | 获取灰度标记 | `boolean` |
| `onIsGrayChange` | 监听灰度变更 | `Function` (注册回调) |
| `getWindowIp()` | 获取本机 IP | `string \| undefined` |
| `setRegistryList(list)` | 写入微信连接列表 | `void` |
| `getRegistryList()` | 读取微信连接列表 | `array \| undefined` |
| `getActivityInfo()` | 读取崩溃检测记录 | `object \| undefined` |
| `setActivityInfo(info)` | 写入崩溃检测记录 | `void` |

## 附录 B：关键文件路径索引

| 功能 | 文件路径 |
|------|---------|
| store 核心模块 | `galaxy-client/src/common/store.js` |
| store 变更事件 | `galaxy-client/src/event/store.js` |
| GID 生成逻辑 | `galaxy-client/src/common/gid.js` |
| 崩溃检测记录 | `galaxy-client/src/common/recordActivityInfo.js` |
| 窗口状态管理 | `galaxy-client/src/common/createStateWindow.js` |
| IPC 读写通道 | `galaxy-client/src/event/ipc.js` |
| 主进程初始化入口 | `galaxy-client/src/electron.js` |

---

*文档生成时间：2026-03-13 | 基于 galaxy-client 仓库实际代码分析*
