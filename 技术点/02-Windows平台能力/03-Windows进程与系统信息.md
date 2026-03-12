# Windows 进程与系统信息

> 进程管理与系统信息获取

---

## 一、技术简介

### 1.1 核心库

| 库 | 用途 |
|---|---|
| `systeminformation` | 获取系统信息（CPU、内存、磁盘等） |
| `pidusage` | 获取进程 CPU/内存使用率 |
| Node.js `child_process` | 启动/管理子进程 |

### 1.2 应用场景

- 监控应用性能
- 查找微信/企微进程
- 启动逆向服务
- 系统资源监控

---

## 二、进程管理

### 2.1 获取进程列表

```javascript
const si = require('systeminformation');

// 获取所有进程
async function getAllProcesses() {
    const processes = await si.processes();
    return processes.list;
    // [
    //   { pid: 1234, name: 'WeChat.exe', cpu: 1.2, mem: 50.5, ... },
    //   { pid: 5678, name: 'WXWork.exe', cpu: 0.5, mem: 30.2, ... },
    //   ...
    // ]
}

// 查找特定进程
async function findProcess(processName) {
    const all = await getAllProcesses();
    return all.filter(p =>
        p.name.toLowerCase().includes(processName.toLowerCase())
    );
}

// 查找微信进程
async function findWeChatProcesses() {
    const wechat = await findProcess('WeChat.exe');
    const wxwork = await findProcess('WXWork.exe');
    return { wechat, wxwork };
}
```

### 2.2 启动进程

```javascript
const { spawn, exec } = require('child_process');
const path = require('path');

// 启动微信
function launchWeChat(wechatPath) {
    return new Promise((resolve, reject) => {
        const process = spawn(wechatPath, [], {
            detached: true,      // 独立于父进程
            stdio: 'ignore'      // 不继承 stdio
        });

        process.unref();  // 允许父进程退出

        // 等待启动
        setTimeout(() => {
            resolve(process.pid);
        }, 2000);
    });
}

// 启动逆向服务
function launchReverseService(servicePath) {
    return new Promise((resolve, reject) => {
        const process = spawn(servicePath, [], {
            cwd: path.dirname(servicePath),
            detached: true,
            stdio: 'ignore'
        });

        process.on('error', reject);
        process.unref();

        setTimeout(() => {
            resolve(process.pid);
        }, 1000);
    });
}
```

### 2.3 终止进程

```javascript
const { exec } = require('child_process');

// 通过 PID 终止
function killByPid(pid) {
    return new Promise((resolve, reject) => {
        exec(`taskkill /F /PID ${pid}`, (error, stdout, stderr) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

// 通过进程名终止
function killByName(processName) {
    return new Promise((resolve, reject) => {
        exec(`taskkill /F /IM ${processName}`, (error, stdout, stderr) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

// 终止逆向服务
async function stopReverseService() {
    try {
        await killByName('BasicService.exe');
        console.log('逆向服务已停止');
    } catch (error) {
        console.log('逆向服务未运行');
    }
}
```

### 2.4 项目中的实现

```javascript
// src/common/inject.js

const { spawn } = require('child_process');
const path = require('path');

/**
 * 启动微信并注入 DLL
 */
async function runInject(wechatPath, workWx = false) {
    // 1. 获取逆向服务路径
    const servicePath = getServicePath(workWx);

    // 2. 启动逆向服务
    const serviceProcess = spawn(servicePath, [], {
        cwd: path.dirname(servicePath),
        detached: true,
        stdio: 'ignore'
    });
    serviceProcess.unref();

    // 3. 等待服务就绪
    await sleep(2000);

    // 4. 启动微信（DLL 会自动注入）
    const wechatProcess = spawn(wechatPath, [], {
        detached: true,
        stdio: 'ignore'
    });
    wechatProcess.unref();

    return wechatProcess.pid;
}
```

---

## 三、系统信息获取

### 3.1 CPU 信息

```javascript
const si = require('systeminformation');

// CPU 静态信息
async function getCpuInfo() {
    const cpu = await si.cpu();
    return {
        manufacturer: cpu.manufacturer,   // Intel
        brand: cpu.brand,                 // Core i7-9700
        speed: cpu.speed,                 // 3.0 GHz
        cores: cpu.cores,                 // 8
        physicalCores: cpu.physicalCores  // 8
    };
}

// CPU 当前负载
async function getCpuLoad() {
    const load = await si.currentLoad();
    return {
        avgLoad: load.avgLoad,            // 平均负载
        currentLoad: load.currentLoad,    // 当前负载 %
        currentLoadUser: load.currentLoadUser,
        currentLoadSystem: load.currentLoadSystem
    };
}
```

### 3.2 内存信息

```javascript
// 内存信息
async function getMemoryInfo() {
    const mem = await si.mem();
    return {
        total: mem.total,           // 总内存（字节）
        free: mem.free,             // 空闲内存
        used: mem.used,             // 已用内存
        active: mem.active,         // 活跃内存
        available: mem.available,   // 可用内存
        // 转换为 GB
        totalGB: (mem.total / 1024 / 1024 / 1024).toFixed(2),
        usedGB: (mem.used / 1024 / 1024 / 1024).toFixed(2)
    };
}
```

### 3.3 磁盘信息

```javascript
// 磁盘使用情况
async function getDiskInfo() {
    const disks = await si.fsSize();
    return disks.map(disk => ({
        fs: disk.fs,              // C:
        type: disk.type,          // NTFS
        size: disk.size,          // 总大小
        used: disk.used,          // 已用
        available: disk.available, // 可用
        use: disk.use             // 使用率 %
    }));
}
```

### 3.4 操作系统信息

```javascript
// 操作系统信息
async function getOsInfo() {
    const os = await si.osInfo();
    return {
        platform: os.platform,     // win32
        distro: os.distro,         // Microsoft Windows 10 Pro
        release: os.release,       // 10.0.19041
        arch: os.arch,             // x64
        hostname: os.hostname
    };
}
```

---

## 四、进程性能监控

### 4.1 使用 pidusage

```javascript
const pidusage = require('pidusage');

// 获取单个进程性能
async function getProcessStats(pid) {
    const stats = await pidusage(pid);
    return {
        cpu: stats.cpu,           // CPU 使用率 %
        memory: stats.memory,     // 内存使用（字节）
        ppid: stats.ppid,         // 父进程 ID
        elapsed: stats.elapsed,   // 运行时间（毫秒）
        timestamp: stats.timestamp
    };
}

// 获取多个进程性能
async function getMultiProcessStats(pids) {
    const stats = await pidusage(pids);
    // { pid1: {...}, pid2: {...}, ... }
    return stats;
}

// 清理历史数据
pidusage.clear();
```

### 4.2 监控当前应用

```javascript
// 监控 Electron 应用性能
async function monitorApp() {
    const stats = await pidusage(process.pid);
    const mem = process.memoryUsage();

    return {
        pid: process.pid,
        cpu: stats.cpu,
        memoryMB: {
            rss: (mem.rss / 1024 / 1024).toFixed(2),
            heapTotal: (mem.heapTotal / 1024 / 1024).toFixed(2),
            heapUsed: (mem.heapUsed / 1024 / 1024).toFixed(2),
            external: (mem.external / 1024 / 1024).toFixed(2)
        },
        uptime: process.uptime()
    };
}
```

### 4.3 项目中的监控实现

```javascript
// src/msg-center/timer/monitorTimer.js

const pidusage = require('pidusage');
const si = require('systeminformation');

class MonitorTimer {
    async collectMetrics() {
        // 1. 当前进程
        const processStats = await pidusage(process.pid);
        const memUsage = process.memoryUsage();

        // 2. 系统信息
        const sysMem = await si.mem();
        const sysLoad = await si.currentLoad();

        // 3. 汇总
        return {
            process: {
                cpu: processStats.cpu,
                memoryMB: memUsage.heapUsed / 1024 / 1024,
                uptime: process.uptime()
            },
            system: {
                cpuLoad: sysLoad.currentLoad,
                memoryUsedPercent: (sysMem.used / sysMem.total * 100).toFixed(2)
            },
            timestamp: Date.now()
        };
    }
}
```

---

## 五、子进程通信

### 5.1 spawn vs exec vs fork

```javascript
const { spawn, exec, fork } = require('child_process');

// spawn: 流式输出，适合长时间运行
const child = spawn('ping', ['127.0.0.1']);
child.stdout.on('data', (data) => {
    console.log(`stdout: ${data}`);
});

// exec: 缓冲输出，适合快速命令
exec('dir', (error, stdout, stderr) => {
    console.log(stdout);
});

// fork: 专门用于 Node.js 脚本
const worker = fork('worker.js');
worker.send({ type: 'start' });
worker.on('message', (msg) => {
    console.log('Worker says:', msg);
});
```

### 5.2 进程间通信

```javascript
// 主进程
const { fork } = require('child_process');
const worker = fork('./worker.js');

// 发送消息
worker.send({ action: 'process', data: [1, 2, 3] });

// 接收消息
worker.on('message', (result) => {
    console.log('结果:', result);
});

// 错误处理
worker.on('error', (error) => {
    console.error('Worker 错误:', error);
});

worker.on('exit', (code) => {
    console.log(`Worker 退出，代码: ${code}`);
});
```

```javascript
// worker.js
process.on('message', (msg) => {
    if (msg.action === 'process') {
        const result = msg.data.map(x => x * 2);
        process.send({ result });
    }
});
```

---

## 六、实际应用场景

### 6.1 检测微信是否运行

```javascript
async function isWeChatRunning() {
    const processes = await findProcess('WeChat.exe');
    return processes.length > 0;
}

async function isWorkWxRunning() {
    const processes = await findProcess('WXWork.exe');
    return processes.length > 0;
}
```

### 6.2 获取微信进程ID

```javascript
async function getWeChatPids() {
    const processes = await findProcess('WeChat.exe');
    return processes.map(p => p.pid);
}
```

### 6.3 资源警告

```javascript
async function checkResources() {
    const metrics = await monitorApp();

    // 内存警告
    if (metrics.process.memoryMB > 500) {
        console.warn('内存使用过高:', metrics.process.memoryMB, 'MB');
    }

    // CPU 警告
    if (metrics.process.cpu > 80) {
        console.warn('CPU 使用过高:', metrics.process.cpu, '%');
    }
}
```

---

## 七、注意事项

### 7.1 权限问题

```javascript
// 终止进程可能需要管理员权限
try {
    await killByPid(pid);
} catch (error) {
    if (error.message.includes('Access is denied')) {
        console.error('需要管理员权限');
    }
}
```

### 7.2 跨平台兼容

```javascript
// Windows 特有命令
if (process.platform === 'win32') {
    exec('tasklist', callback);
} else {
    exec('ps aux', callback);
}

// systeminformation 是跨平台的
// 但某些功能在 Windows 上更完整
```

### 7.3 性能考虑

```javascript
// pidusage 会保留历史数据用于计算
// 定期清理避免内存泄漏
setInterval(() => {
    pidusage.clear();
}, 5 * 60 * 1000);  // 每5分钟清理
```

---

## 八、与 React 开发对比

### 8.1 前端无法直接访问

```javascript
// 浏览器/React 无法访问系统进程
// 这是操作系统级别的能力

// 只能通过 Electron 主进程实现
```

### 8.2 Electron 中使用

```javascript
// 主进程
ipcMain.handle('get-processes', async () => {
    return await getAllProcesses();
});

ipcMain.handle('get-system-info', async () => {
    return {
        cpu: await getCpuInfo(),
        memory: await getMemoryInfo(),
        os: await getOsInfo()
    };
});

// 渲染进程
const processes = await ipcRenderer.invoke('get-processes');
const sysInfo = await ipcRenderer.invoke('get-system-info');
```
