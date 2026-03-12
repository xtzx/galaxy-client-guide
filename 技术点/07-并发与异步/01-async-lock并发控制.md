# async-lock 并发控制

> 异步锁管理库

---

## 一、技术简介

### 1.1 什么是并发问题

```javascript
// 问题场景：多个请求同时修改同一数据
async function updateBalance(userId, amount) {
    const balance = await getBalance(userId);     // 读取余额
    await setBalance(userId, balance + amount);   // 更新余额
}

// 并发调用
updateBalance('user1', 100);  // 读到 1000，写入 1100
updateBalance('user1', 200);  // 也读到 1000，写入 1200

// 结果：余额变成 1200，丢失了 100
```

### 1.2 async-lock 解决方案

```javascript
const AsyncLock = require('async-lock');
const lock = new AsyncLock();

async function updateBalance(userId, amount) {
    // 用 userId 作为锁的 key
    return lock.acquire(userId, async () => {
        const balance = await getBalance(userId);
        await setBalance(userId, balance + amount);
    });
}

// 现在并发调用会排队执行
updateBalance('user1', 100);  // 先执行，1000 → 1100
updateBalance('user1', 200);  // 等待，1100 → 1300
```

---

## 二、项目中的使用

### 2.1 使用位置

```
src/common/file.js                          # 文件操作锁
src/msg-center/core/utils/asyncLockUtil.js  # 异步锁工具封装
```

### 2.2 文件操作中的使用

```javascript
// src/common/file.js

const AsyncLock = require('async-lock');
const lock = new AsyncLock();

/**
 * 将 Base64 数据写入文件（带锁）
 */
async function writeBase64ToFile(base64Data, filePath) {
    // 以文件路径为 key 加锁
    return lock.acquire(filePath, async () => {
        const buffer = Buffer.from(base64Data, 'base64');
        await fse.writeFile(filePath, buffer);
        return filePath;
    });
}

/**
 * 下载文件到本地（带锁）
 */
async function downloadFile(url, filePath) {
    return lock.acquire(filePath, async () => {
        // 避免重复下载
        if (await fse.pathExists(filePath)) {
            return filePath;
        }

        const response = await fetch(url);
        const buffer = await response.buffer();
        await fse.writeFile(filePath, buffer);
        return filePath;
    });
}
```

### 2.3 封装的异步锁工具

```javascript
// src/msg-center/core/utils/asyncLockUtil.js

const AsyncLock = require('async-lock');

class AsyncLockUtil {
    constructor() {
        this.lock = new AsyncLock({
            timeout: 30000,     // 30秒超时
            maxPending: 1000    // 最大等待数
        });
    }

    /**
     * 获取锁并执行
     * @param {string} key - 锁的标识
     * @param {Function} fn - 要执行的函数
     */
    async acquire(key, fn) {
        return this.lock.acquire(key, fn);
    }

    /**
     * 检查是否正在被锁定
     */
    isBusy(key) {
        return this.lock.isBusy(key);
    }
}

// 导出单例
module.exports = new AsyncLockUtil();
```

---

## 三、常用 API

### 3.1 基本使用

```javascript
const AsyncLock = require('async-lock');
const lock = new AsyncLock();

// 获取锁
await lock.acquire('myKey', async () => {
    // 临界区代码
    await doSomething();
});

// 同步函数也可以
lock.acquire('myKey', (done) => {
    doSomethingSync();
    done();  // 必须调用 done
});
```

### 3.2 配置选项

```javascript
const lock = new AsyncLock({
    timeout: 5000,          // 获取锁超时时间（毫秒）
    maxPending: 1000,       // 最大等待队列长度
    maxOccupationTime: 10000, // 最大占用时间
    maxExecutionTime: 5000,   // 最大执行时间
    Promise: require('bluebird')  // 自定义 Promise 实现
});
```

### 3.3 多个 key

```javascript
// 同时锁多个 key
await lock.acquire(['key1', 'key2'], async () => {
    // 两个资源都锁定后才执行
    await updateResource1();
    await updateResource2();
});
```

### 3.4 超时处理

```javascript
try {
    await lock.acquire('myKey', async () => {
        await longRunningTask();
    }, { timeout: 5000 });
} catch (error) {
    if (error.message === 'async-lock timed out') {
        console.error('获取锁超时');
    }
}
```

### 3.5 检查状态

```javascript
// 检查某个 key 是否正在被锁定
if (lock.isBusy('myKey')) {
    console.log('资源正忙');
}

// 检查是否有任何锁正在使用
if (lock.isBusy()) {
    console.log('有锁正在使用');
}
```

---

## 四、应用场景

### 4.1 文件写入冲突

```javascript
// 问题：多个地方同时写入同一文件
async function saveConfig(config) {
    await lock.acquire('config-file', async () => {
        await fse.writeJson('config.json', config);
    });
}
```

### 4.2 数据库操作序列化

```javascript
// 问题：读取-修改-写入需要原子操作
async function incrementCounter(name) {
    return lock.acquire(`counter:${name}`, async () => {
        const current = await db.get(name);
        await db.set(name, current + 1);
        return current + 1;
    });
}
```

### 4.3 API 请求去重

```javascript
// 问题：相同请求同时发起多次
async function fetchUserInfo(userId) {
    return lock.acquire(`user:${userId}`, async () => {
        // 检查缓存
        const cached = cache.get(userId);
        if (cached) return cached;

        // 请求接口
        const user = await api.getUser(userId);
        cache.set(userId, user);
        return user;
    });
}
```

### 4.4 资源初始化

```javascript
// 问题：初始化过程可能被多次触发
let db = null;

async function getDb() {
    if (db) return db;

    return lock.acquire('db-init', async () => {
        // 再次检查（双重检查锁定）
        if (db) return db;

        db = await initDatabase();
        return db;
    });
}
```

---

## 五、与 React 开发对比

### 5.1 前端并发控制

```javascript
// React 中通常用状态控制
const [isLoading, setIsLoading] = useState(false);

async function handleClick() {
    if (isLoading) return;  // 简单的"锁"

    setIsLoading(true);
    try {
        await doSomething();
    } finally {
        setIsLoading(false);
    }
}
```

### 5.2 后端需要更严格

```javascript
// Node.js 后端需要处理真正的并发
// 多个请求可能同时到达

// 前端：用户点击 → 禁用按钮 → 完成 → 启用按钮
// 后端：请求1、请求2、请求3 同时到达 → 需要真正的锁
```

### 5.3 关键区别

```
┌─────────────────────────────────────────────────────────────────┐
│                    前端 vs 后端 并发控制                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  React 前端：                                                   │
│  - 单用户操作                                                   │
│  - 用 UI 状态控制（loading、disabled）                          │
│  - 防抖、节流                                                   │
│                                                                 │
│  Node.js 后端：                                                 │
│  - 多用户并发请求                                               │
│  - 需要真正的锁机制                                             │
│  - 保证数据一致性                                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 六、注意事项

### 6.1 避免死锁

```javascript
// ❌ 嵌套获取相同的锁会死锁
await lock.acquire('key', async () => {
    await lock.acquire('key', async () => {
        // 永远不会执行
    });
});

// ✅ 重入锁（如果需要嵌套）
const lock = new AsyncLock({ maxPending: 1000 });
// 或者重构代码避免嵌套
```

### 6.2 锁的粒度

```javascript
// ❌ 粒度太大，所有用户排队
await lock.acquire('users', async () => {
    await updateUser(userId);
});

// ✅ 粒度合适，只锁单个用户
await lock.acquire(`user:${userId}`, async () => {
    await updateUser(userId);
});
```

### 6.3 超时设置

```javascript
// 设置合理的超时，避免永久等待
const lock = new AsyncLock({
    timeout: 30000  // 30秒
});

// 处理超时
try {
    await lock.acquire('key', fn);
} catch (e) {
    if (e.message.includes('timed out')) {
        // 超时处理
    }
}
```
