# 07 逆向程序加载与NamedPipe通信

> **适用仓库**：`galaxy-client`（Electron 主进程端）  
> **文档目标**：理解如何通过 DLL 注入与微信/企微进程进行 IPC 通信。  
> **核心目录**：`src/msg-center/core/reverse/`

---

## 一、逆向通信的整体设计思路

### 1.1 为什么需要逆向注入

微信/企微客户端没有公开的 API 接口。要实现自动化操作（群发消息、加好友、管理群聊等），需要：

1. **注入 DLL** 到微信/企微进程内部
2. **建立通信管道** 与注入的 DLL 进行双向通信
3. **发送控制指令** 实现自动化操作
4. **接收状态回报** 获取操作结果和消息推送

### 1.2 架构图

```
┌──────────────────────────────────────────────────────────────────────┐
│                     galaxy-client（Electron 主进程）                   │
│                                                                      │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────────────────┐ │
│  │ initIpcTask  │    │ reverseSend  │    │ asyncSelectTask         │ │
│  │ (进程扫描)   │    │ (发送命令)    │    │ (接收消息)              │ │
│  │              │    │              │    │                         │ │
│  │ while(true)  │    │ sendMessage()│    │ loop()                  │ │
│  │ 每5秒扫描    │    │              │    │ 无限循环轮询             │ │
│  └──────┬───────┘    └──────┬───────┘    └────────────┬────────────┘ │
│         │                   │                         │              │
│         ▼                   ▼                         ▲              │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                     clibrary.js (ffi-napi)                   │   │
│  │                                                              │   │
│  │  IpcConnectServer()    IpcClientSendMessage()                │   │
│  │  IpcSelectCltChannel() IpcClientRecvMessage()                │   │
│  │  IpcClientClose()      IsValidProcess()                      │   │
│  └──────────────────────────┬───────────────────────────────────┘   │
│                             │ ffi-napi 调用                         │
│                             ▼                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │               PipeCore.dll + ReUtils64.dll                    │   │
│  │               (C++ Native DLL)                                │   │
│  └──────────────────────────┬───────────────────────────────────┘   │
│                             │ Windows Named Pipe                    │
└─────────────────────────────┼───────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
         ┌─────────┐    ┌─────────┐    ┌─────────┐
         │ 微信.exe  │    │ 微信.exe │    │ WXWork  │
         │ (账号1)  │    │ (账号2)  │    │ (企微)   │
         │ PID:1234 │    │ PID:5678 │    │ PID:9012 │
         └─────────┘    └─────────┘    └─────────┘
```

### 1.3 通信流程概览

```
                     发送方向（主进程→微信）
  ┌──────────┐     ┌──────────────┐     ┌──────────────┐     ┌────────┐
  │ MQTT 任务 │────▶│dispatchInBound│────▶│ reverseSend  │────▶│ 微信.exe│
  │ (云端下发)│     │              │     │ (Named Pipe) │     │        │
  └──────────┘     └──────────────┘     └──────────────┘     └────────┘

                     接收方向（微信→主进程）
  ┌────────┐     ┌────────────────┐     ┌───────────────┐     ┌──────────┐
  │ 微信.exe│────▶│asyncSelectTask │────▶│dispatchOutBound│────▶│ MQTT/前端 │
  │        │     │ (Named Pipe)   │     │               │     │ (上报)    │
  └────────┘     └────────────────┘     └───────────────┘     └──────────┘
```

---

## 二、DLL 接口定义 — clibrary.js

**文件路径**：`galaxy-client/src/msg-center/core/reverse/dll/clibrary.js`  
**总行数**：150 行

### 2.1 依赖的 DLL 文件

| DLL 文件 | 位置 | 职责 |
|----------|------|------|
| `PipeCore.dll` | `src/msg-center/core/reverse/dll/PipeCore.dll` | Named Pipe 通信核心（连接、收发、关闭） |
| `ReUtils64.dll` | `src/msg-center/core/reverse/dll/ReUtils64.dll` | 进程工具（判断可连接性、检测登录状态、内存信息） |

### 2.2 ffi-napi 接口定义

```javascript
const ffi = require("ffi-napi");
const ref = require("ref-napi");

// PipeCore.dll 函数签名
const functions = {
    IpcConnectServer:     [ref.types.size_t, ["int"]],
    IpcSelectCltChannel:  ["int", [ref.types.size_t]],
    IpcClientSendMessage: ["bool", ["void*", "int", ref.types.size_t]],
    IpcClientRecvMessage: ["bool", ["void*", "int", ref.types.size_t]],
    IpcClientClose:       ["bool", [ref.types.size_t]],
    IsValidProcess:       ["bool", ["int"]],
};

// ReUtils64.dll 函数签名
const utilsFunctions = {
    CanConnectProcess:        ["bool", ["int"]],
    HasLoginedAccount:        ["bool", ["uint64"]],
    HasFangzhou:              ["bool", []],
    GetProcsPhysicalMmSize:   ["pointer", ["uint64"]],
    GetSubProcPhysicalMmSize: ["pointer", ["int"]],
};

let library = ffi.Library(dllPath, functions);
const ProcessUtilsLibrary = ffi.Library(processUtilsPath, utilsFunctions);
```

### 2.3 函数接口详解

#### PipeCore.dll 函数

| 函数 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `IpcConnectServer(pid)` | `int` PID | `size_t` pipeCode | 根据进程 PID 建立 Named Pipe 连接，返回管道句柄 |
| `IpcSelectCltChannel(pipeCode)` | `size_t` 管道句柄 | `int` selectCode | 轮询通道状态：`0`=无数据, `>0`=有数据(数据长度), `<0`=连接断开 |
| `IpcClientSendMessage(buffer, len, pipeCode)` | 缓冲区, 长度, 句柄 | `bool` 成功 | 通过 Named Pipe 发送消息 |
| `IpcClientRecvMessage(buffer, len, pipeCode)` | 缓冲区, 长度, 句柄 | `bool` 成功 | 从 Named Pipe 接收消息 |
| `IpcClientClose(pipeCode)` | `size_t` 管道句柄 | `bool` 成功 | 关闭 Named Pipe 连接 |
| `IsValidProcess(pid)` | `int` PID | `bool` 有效 | 检查进程是否存在且有效 |

#### ReUtils64.dll 函数

| 函数 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `CanConnectProcess(pid)` | `int` PID | `bool` 可连接 | 判断指定 PID 的管道是否可用 |
| `HasLoginedAccount(wxid)` | `uint64` wxid | `bool` 已登录 | 检测企微是否有已登录账号 |
| `HasFangzhou()` | 无 | `bool` | 检测方舟是否已启动 |
| `GetProcsPhysicalMmSize(appName)` | `uint64` 进程名 | `pointer` JSON | 获取指定进程名的物理内存占用 |
| `GetSubProcPhysicalMmSize(pid)` | `int` PID | `pointer` JSON | 获取指定 PID 及其子进程的内存占用 |

### 2.4 发送消息封装

```javascript
function IpcClientSendMessage(pipeCode, message) {
    let jsonObj = JSON.parse(message);
    
    // 特殊处理：标签操作中的大数字需要去除引号
    if (jsonObj.type === "getlabelcustomer" || jsonObj.type === "insertordellabel") {
        message = message.replace(/\"(\d{16,})\"/g, "$1");
    }
    
    const bytes = Buffer.from(message);
    const bufferLength = bytes.length;
    return library.IpcClientSendMessage(bytes, bufferLength, pipeCode);
}
```

### 2.5 接收消息封装

```javascript
function IpcClientRecvMessage(pipeCode, bufferLength, wxid) {
    const byteBuffer = Buffer.alloc(bufferLength);
    const result = library.IpcClientRecvMessage(byteBuffer, bufferLength, pipeCode);
    
    if (result) {
        const resultStr = byteBuffer.toString("utf8");
        const replaceStr = resultStr.replace(/\x00/g, "");   // 去除空字符
        const messageInfo = JSON.parse(replaceStr);
        
        // 检测逆向推送的错误类型
        if (messageInfo.type === "typeerror" || messageInfo.type === "jsonerror") {
            notify.nxPushError(wxid, messageInfo.type);
        }
        return replaceStr;
    }
    return null;
}
```

### 2.6 大数字处理

```javascript
function replaceLargeNumbers(json) {
    const regex = /(?<=:)\s*\d{17,}(?=[,\}])/g;
    return json.replace(regex, (match) => `"${match}"`);
}
```

微信/企微的消息中可能包含超过 JavaScript `Number.MAX_SAFE_INTEGER` 的数字（如微信 ID），需要将其转为字符串避免精度丢失。

---

## 三、进程扫描与连接管理 — initIpcTask.js

**文件路径**：`galaxy-client/src/msg-center/core/reverse/initIpcTask.js`  
**总行数**：216 行  
**设计模式**：单例（IIFE + `getInstance()`）

### 3.1 核心循环

```javascript
async run() {
    let processIdsAvaliableOld = [];
    let oldAllProcessIds = [];
    
    while(true) {
        try {
            // ① 扫描微信/企微进程 PID
            let processIds = IpcUtil.getProcessIds();
            
            // ② 检查进程 PID 是否有变化
            const processIdsNotChange = IpcUtil.arrayEquals(processIds, oldAllProcessIds);
            
            // ③ 无变化且已达最大连接数 → 跳过本轮
            if (processIds.length > 0 && processIdsNotChange && ...) {
                await sleep(5000);
                continue;
            }
            
            // ④ 过滤不可连接的进程
            processIds = processIds.filter(pid => {
                const isAvaliable = Clibrary.isUseProcess(pid);
                if (!isAvaliable) {
                    // 清理不可用管道
                    RegistryConfig.removePipe(processId);
                }
                return isAvaliable;
            });
            
            // ⑤ 对比当前注册表，找出新增和消失的进程
            let currProcessIds = RegistryConfig.getCurrProcessIds();
            
            // ⑥ 为新进程建立 Named Pipe 连接
            for (let processId of newProcessIds) {
                lock.acquire(`ipcLock-${processId}`, (done) => {
                    let pipeCode = Clibrary.IpcConnectServer(processId);
                    // 创建 registry 并注册
                    RegistryConfig.add(registry);
                    // 启动消息接收循环
                    this.startSelectMessage(registry);
                    done();
                });
            }
            
            // ⑦ 清理消失的进程
            this.batchCheckAndExit(currProcessIds);
            
            await sleep(5000);  // 每 5 秒一轮
        } catch(error) {
            await sleep(5000);
        }
    }
}
```

### 3.2 进程扫描详解

**文件路径**：`galaxy-client/src/msg-center/core/reverse/ipcUtil.js`

```javascript
const IpcUtil = {
    taskCmd: 'tasklist /fi "imagename eq weixin.exe" /fo list',
    taskCmdWork: 'tasklist /fi "imagename eq WXWork.exe" /fo list',
    processMap: {},   // PID → 是否企微
    
    getProcessIds() {
        const pids = [];
        
        // 扫描微信进程
        let output = execSync(this.taskCmd, { encoding: 'utf-8' });
        let lines = output.trim().split('\n');
        for (let line of lines) {
            if (line.trim().startsWith('PID:')) {
                const pid = parseInt(line.split(':')[1].trim());
                pids.push(pid);
                this.processMap[pid] = false;   // 标记为微信
            }
        }
        
        // 扫描企微进程
        output = execSync(this.taskCmdWork, { encoding: 'utf-8' });
        // ... 同样逻辑
        this.processMap[pid] = true;            // 标记为企微
        
        return pids;
    },
};
```

`processMap` 记录每个 PID 是微信（`false`）还是企微（`true`），后续建立连接时会用到。

### 3.3 Named Pipe 管道检测

```javascript
isPipeAvailable(pid) {
    const serverName = `\\\\.\\pipe\\{518861DF-35A2-4D98-B523-F0254EABDAE2}-${pid}`;
    try {
        localSocket = fs.openSync(serverName, 'r');
        fs.closeSync(localSocket);
        return true;
    } catch (error) {
        return false;
    }
}
```

Named Pipe 的名称格式为固定 GUID + 进程 PID：`\\.\pipe\{518861DF-35A2-4D98-B523-F0254EABDAE2}-{PID}`

### 3.4 连接建立流程

当发现新的微信/企微进程时：

```javascript
// 1. 通过 DLL 建立 Named Pipe 连接
let pipeCode = Clibrary.IpcConnectServer(processId);

// 2. 缓存 pipeCode（用于后续清理）
pipeCodeCache.updatePipeCodeCache(processId, pipeCode);

// 3. 创建管道包装对象
const pipeLineWrapper = {
    pipeCode,                       // Named Pipe 句柄
    id: processId,                  // 进程 PID
    processId,                      // 同上
    available: IpcConfig.NOT_AVAILABLE,  // 初始不可用
    workWx: IpcUtil.processMap[processId] || false,  // 是否企微
    createTime: new Date().getTime(),
    lastReportId: null,
    lastTimer: null,
};

// 4. 创建注册表条目
const registry = {
    pipeLineWrapper,
    sendToCloudFlag: IpcConfig.NOT_SEND_LOGIN_TO_CLOUD,
    id: processId,
    scanTime: new Date().getTime(),
    workWx: IpcUtil.processMap[processId] || false,
};

// 5. 注册到全局注册表
RegistryConfig.add(registry);

// 6. 通知前端更新账号列表
frontSendService.sendGetAllConfig();

// 7. 启动消息接收循环
this.startSelectMessage(registry);
```

### 3.5 连接断开处理

```javascript
batchCheckAndExit(processIdList) {
    for (let processId of processIdList) {
        let existFlag = IpcUtil.isProcessExist(processId);
        if (!existFlag) {
            // 进程已消失 → 清理注册表和管道
            RegistryConfig.removePipe(processId);
            frontSendService.sendGetAllConfig();
        }
    }
}
```

`RegistryConfig.removePipe()` 会执行：
1. `Clibrary.IpcClientClose(pipeCode)` — 关闭 Named Pipe
2. `forceClearMqtt(wxId, registry)` — 关闭 MQTT 连接
3. `this.remove(registry)` — 从注册表移除

### 3.6 并发保护

使用 `async-lock` 防止对同一进程 PID 并发建立连接：

```javascript
lock.acquire(`ipcLock-${processId}`, (done) => {
    if (!RegistryConfig.getCurrProcessIds().includes(processId)) {
        // 建立连接...
    }
    done();
});
```

---

## 四、异步轮询接收消息 — asyncSelectTask.js

**文件路径**：`galaxy-client/src/msg-center/core/reverse/asyncSelectTask.js`  
**总行数**：93 行

### 4.1 核心循环

```javascript
const AsyncSelectTask = {
    async loop(wrapper) {
        const createTime = new Date().getTime();
        const pipeCode = wrapper.pipeCode;
        
        // ① 轮询通道状态
        const selectCode = Clibrary.IpcSelectCltChannel(pipeCode);
        
        // ② 无数据 → 等待 200ms 后继续
        if (selectCode == 0) {
            await sleep(200);   // sleepTime = 200ms
            this.loop(wrapper);
            return;
        }
        
        // ③ 连接断开 → 处理退出
        if (selectCode < 0) {
            this.closeIpcConnect(pipeCode, selectCode, wrapper);
            return;
        }
        
        // ④ 有数据 → 接收并处理
        this.successIpcConnect(pipeCode, selectCode, createTime, wrapper);
        
        // ⑤ 继续循环
        this.loop(wrapper);
    },
    
    async run(wrapper) {
        this.loop(wrapper);
    },
};
```

### 4.2 selectCode 状态码

| 返回值 | 含义 | 处理 |
|--------|------|------|
| `0` | 通道中无数据 | 等待 200ms 后继续轮询 |
| `> 0` | 有数据，值为数据长度（字节） | 调用 `IpcClientRecvMessage` 读取 |
| `< 0` | 连接已断开 | 触发退出逻辑 |

### 4.3 消息接收与处理

```javascript
successIpcConnect(pipeCode, selectCode, createTime, wrapper) {
    try {
        // ① 接收消息（selectCode 即数据长度）
        let message = Clibrary.IpcClientRecvMessage(pipeCode, selectCode, wrapper.wxid);
        
        // ② 更新最后读取时间
        wrapper.lastReadTime = new Date().getTime();
        
        // ③ 大数字字符串化
        message = replaceLargeNumbers(message);
        
        // ④ 路由到出站调度
        dispatchOutBound(message, wrapper);
    } catch(error) {
        logUtil.customLog(`[逆向消息处理错误] [codeError] [wxid-${wrapper.wxid}]...`);
    }
},
```

### 4.4 连接关闭处理

```javascript
closeIpcConnect(pipeCode, selectCode, wrapper) {
    logUtil.customLog(`IPC-CONNECT-CLOSE [wxid-${wrapper.wxid}]...`);
    logoutService.operate(null, wrapper);
}
```

当 `selectCode < 0` 时，说明微信/企微进程已退出或管道断开。调用 `logoutService.operate()` 触发退出流程：
- 通知云端该账号离线
- 清理本地注册表
- 通知前端更新状态

### 4.5 轮询性能特征

| 参数 | 值 | 说明 |
|------|-----|------|
| 无数据时等待 | 200ms | `sleepTime = 200` |
| 有数据时等待 | 0ms | 立即处理后继续轮询 |
| 单次轮询开销 | 极低 | `IpcSelectCltChannel` 是非阻塞调用 |
| 多账号并发 | 每个账号独立循环 | N 个账号 = N 个独立的 `loop()` |

---

## 五、逆向发送 — reverseSend.js

**文件路径**：`galaxy-client/src/msg-center/dispatch-center/reverseSend.js`  
**总行数**：128 行  
**设计模式**：单例（IIFE + `getInstance()`）

### 5.1 定向发送

```javascript
sendMessage(wxId, channelId, message) {
    // ① 参数校验
    if ((!wxId && !channelId) || !message) return;
    
    // ② 从注册表获取目标 registry
    let registry;
    if (wxId) {
        registry = RegistryConfig.getRegistryByKey(wxId, "wxid");
    } else {
        registry = RegistryConfig.getRegistryByKey(channelId, "id");
    }
    if (!registry) return;
    
    // ③ taskId 去重锁（5 秒内同一 taskId 不重复发送）
    let { taskId, type } = JSON.parse(message) || {};
    let lockKey = `${registry.wxid}-${taskId}-${type}`;
    if (taskId && this.taskLock.has(lockKey)) return;
    
    // ④ 发送到 Named Pipe
    const pipeCode = registry.pipeLineWrapper.pipeCode;
    this.pipeLineSend(message, wxId, pipeCode);
    
    // ⑤ 设置去重锁（5 秒后自动释放）
    if (taskId) {
        this.taskLock.set(lockKey, true);
        setTimeout(() => this.taskLock.delete(lockKey), 5000);
    }
}
```

### 5.2 广播发送

```javascript
sendMessageAll(message) {
    const registryList = RegistryConfig.getRegistryList();
    registryList.forEach((registry) => {
        const { pipeCode, wxid } = registry.pipeLineWrapper;
        this.pipeLineSend(message, wxid, pipeCode);
    });
}
```

向所有已连接的微信/企微实例广播消息，用于心跳等场景。

### 5.3 底层发送

```javascript
pipeLineSend(message, wxid, pipeCode) {
    try {
        Clibrary.IpcClientSendMessage(pipeCode, message);
        logUtil.customLog(`[发送消息给逆向] wxid: [wxid-${wxid}] type=[${messageType}]...`);
    } catch (error) {
        logUtil.customLog(`[codeError] wxId:[wxid-${wxid}] sendMsgToReverseError...`);
    }
}
```

---

## 六、IPC 配置常量 — ipcConfig.js

**文件路径**：`galaxy-client/src/msg-center/core/reverse/ipcConfig.js`

```javascript
module.exports = {
    RETRY_TIME: 100,              // 重试间隔 100ms
    PING_TINE: 1,                 // Ping 间隔（秒）
    HEART_BEAT_OVER_TIME: 30,     // 心跳超时时间（秒）
    HEART_BEAT_CHECK_TIME: 10,    // 心跳检查间隔（秒）
    IPC_DESC: "IPC",              // IPC 描述标识
    SEND_LOGIN_TO_CLOUD: true,    // 需要上报登录状态到云端
    NOT_SEND_LOGIN_TO_CLOUD: false,
    AVAILABLE: true,              // 管道可用
    NOT_AVAILABLE: false,         // 管道不可用
};
```

---

## 七、IPC 工具函数 — ipcUtil.js

**文件路径**：`galaxy-client/src/msg-center/core/reverse/ipcUtil.js`  
**总行数**：154 行

### 7.1 函数清单

| 函数 | 说明 |
|------|------|
| `getProcessIds()` | 通过 `tasklist` 命令扫描 weixin.exe 和 WXWork.exe 进程 |
| `isPipeAvailable(pid)` | 检查指定 PID 的 Named Pipe 是否存在（通过 `fs.openSync`） |
| `checkMsgAvailable(javaStartTime, sendTime)` | 校验消息时间戳有效性 |
| `isProcessExist(processId)` | 通过 `tasklist /fi "PID eq xxx"` 检查进程是否存在 |
| `runInjectApp(app)` | 执行 `BasicService.exe` 注入程序 |
| `arrayEquals(array1, array2)` | 数组相等比较（排序后逐元素对比） |
| `killProcess(processInfo, callback)` | 通过 `taskkill` 命令结束进程（支持 PID 或进程名） |

### 7.2 进程扫描细节

```javascript
getProcessIds() {
    const pids = [];
    
    // 扫描 weixin.exe
    let output = execSync('tasklist /fi "imagename eq weixin.exe" /fo list', { encoding: 'utf-8' });
    // 解析输出：
    // 映像名称:   weixin.exe
    // PID:         1234
    // ...
    for (let line of lines) {
        if (line.trim().startsWith('PID:')) {
            const pid = parseInt(line.split(':')[1].trim());
            pids.push(pid);
            this.processMap[pid] = false;  // false = 微信
        }
    }
    
    // 扫描 WXWork.exe（企微）
    output = execSync('tasklist /fi "imagename eq WXWork.exe" /fo list', { encoding: 'utf-8' });
    // 同样解析，processMap[pid] = true（企微）
    
    return pids;
}
```

### 7.3 注入程序执行

```javascript
runInjectApp(app) {
    const INJECT_PATH = path.resolve(__dirname, '../../../../extraResources/inject/BasicService.exe');
    return new Promise((resolve, reject) => {
        exec(`"${INJECT_PATH}" ${app}`, (err, stdout, stderr) => {
            if (err) reject(err);
            else resolve();
        });
        setTimeout(() => resolve(), 1000);  // 最多等待 1 秒
    });
}
```

---

## 八、注册表管理 — RegistryConfig

**文件路径**：`galaxy-client/src/msg-center/core/registry-config/index.js`  
**总行数**：94 行

### 8.1 数据结构

每个 registry 条目代表一个已连接的微信/企微实例：

```javascript
{
    id: 1234,                      // 进程 PID
    wxid: "wxid_xxxxxx",          // 微信 ID（连接后由逆向上报）
    workWx: false,                 // 是否企微
    scanTime: 1710345600000,       // 扫描时间
    sendToCloudFlag: false,        // 是否已上报登录状态
    pipeLineWrapper: {
        pipeCode: 123456789,      // Named Pipe 句柄
        id: 1234,                  // 进程 PID
        processId: 1234,
        available: false,          // 管道可用性
        workWx: false,
        createTime: 1710345600000,
        lastReadTime: null,        // 最后读取时间
        lastPongTime: null,        // 最后心跳响应时间
        lastReportId: null,
        lastTimer: null,
        wxid: "wxid_xxxxxx",      // 连接后填充
    },
    mqttClient: null,             // MQTT 客户端实例（连接后填充）
    isMqttConnecting: false,      // MQTT 连接中标记
    wxInfo: null,                 // 微信用户信息（昵称等）
}
```

### 8.2 核心操作

| 方法 | 说明 |
|------|------|
| `add(registry)` | 添加新的注册表条目 |
| `remove(registry)` | 移除注册表条目 |
| `getRegistryByKey(value, key)` | 按字段查找（支持 wxid、id 等） |
| `getRegistryList()` | 获取所有注册表条目 |
| `getAllConfig()` | 获取所有配置（推送给前端） |
| `removePipe(processId)` | 关闭 IPC + MQTT 连接并移除条目 |
| `removeAll()` | 移除所有条目（应用退出时） |
| `getCurrProcessIds()` | 获取当前所有已连接的进程 PID |
| `getAllWxId()` | 获取所有已连接的微信 ID |
| `setPongTime(id)` | 更新心跳响应时间 |

### 8.3 removePipe — 完整清理流程

```javascript
removePipe(processId, pipeCode) {
    let registry = this.getRegistryByKey(processId, 'id');
    
    // 1. 关闭 Named Pipe 连接
    Clibrary.IpcClientClose(registry.pipeLineWrapper.pipeCode);
    
    // 2. 关闭 MQTT 连接
    this.forceClearMqtt(registry?.wxid, registry);
    
    // 3. 从注册表移除
    this.remove(registry);
}
```

---

## 九、连接状态管理

### 9.1 状态流转图

```
            ┌──────────┐
            │  未发现    │
            │  进程     │
            └─────┬────┘
                  │ tasklist 扫描到新进程
                  ▼
            ┌──────────┐
            │  建立连接  │ IpcConnectServer(pid)
            │  中...    │
            └─────┬────┘
                  │ pipeCode > 0
                  ▼
            ┌──────────┐
            │  已连接   │ registry.available = false
            │  待确认   │
            └─────┬────┘
                  │ 收到微信登录信息
                  ▼
            ┌──────────┐
            │  已激活   │ registry.available = true
            │  正常工作  │ registry.wxid = "wxid_xxx"
            └─────┬────┘
                  │ 进程退出 or selectCode < 0
                  ▼
            ┌──────────┐
            │  已断开   │ logoutService.operate()
            │  清理中   │
            └─────┬────┘
                  │ removePipe()
                  ▼
            ┌──────────┐
            │  已移除   │
            └──────────┘
```

### 9.2 多账号并发

系统支持同时管理多个微信/企微账号：

```
initIpcTask (单一扫描循环)
    │
    ├─ 发现 PID 1234 (微信账号1) → 建立连接 → asyncSelectTask.loop(wrapper1)
    ├─ 发现 PID 5678 (微信账号2) → 建立连接 → asyncSelectTask.loop(wrapper2)
    └─ 发现 PID 9012 (企微)     → 建立连接 → asyncSelectTask.loop(wrapper3)
```

每个账号有独立的：
- pipeCode（Named Pipe 句柄）
- asyncSelectTask 循环
- MQTT 连接
- registry 条目

---

## 十、防微信自动更新

**文件路径**：`galaxy-client/extraResources/prevent_wx_update.bat`

### 10.1 实现原理

通过修改 Windows `hosts` 文件，将微信更新服务器域名指向 127.0.0.1：

```
127.0.0.1 dldir1.qq.com
```

### 10.2 触发条件

```javascript
// galaxy-client/src/utils.js
exports.judgeHostsAndRunBat = () => {
    const hostsFilePath = 'C:\\Windows\\System32\\drivers\\etc\\hosts';
    const targetEntry = 'dldir1.qq.com';
    
    fs.readFile(hostsFilePath, 'utf8', (err, data) => {
        if (!data.includes(targetEntry)) {
            execFile(batFilePath, (error, stdout, stderr) => {
                // 执行 bat 文件添加 hosts 条目
            });
        }
    });
};
```

在 `app.on('ready')` 时自动检查并执行，确保微信不会自动更新到不支持的版本。

---

## 十一、调试逆向 IPC 的方法

### 11.1 日志关键词

| 关键词 | 含义 |
|--------|------|
| `[initIpcTask]` | 进程扫描相关 |
| `[发送消息给逆向]` | 主进程→微信发送 |
| `[接收逆向推送消息]` | 微信→主进程接收 |
| `IPC-CONNECT-SUCCESS` | Named Pipe 消息接收成功 |
| `IPC-CONNECT-CLOSE` | Named Pipe 连接关闭 |
| `建立ipc连接成功` | 新连接建立 |
| `删除ipc连接` | 连接清理 |

### 11.2 常见问题

| 问题 | 原因 | 排查方式 |
|------|------|----------|
| 扫描不到微信进程 | 微信未启动或 tasklist 命令失败 | 检查日志中 `getProcessIdsError` |
| pipeCode ≤ 0 | DLL 未正确加载或管道不可用 | 检查 DLL 文件是否存在 |
| 连接建立后立即断开 | 微信版本不支持 | 检查 `SUPPORTED_WX_VERSIONS` 配置 |
| 发送消息无响应 | 管道状态异常 | 检查 `selectCode` 值 |
| 大数字解析错误 | JSON 精度丢失 | 确认 `replaceLargeNumbers` 处理 |

---

## 十二、关键代码路径索引

| 功能 | 文件路径 |
|------|----------|
| ffi-napi DLL 接口 | `src/msg-center/core/reverse/dll/clibrary.js` |
| DLL 文件 | `src/msg-center/core/reverse/dll/PipeCore.dll` |
| 工具 DLL | `src/msg-center/core/reverse/dll/ReUtils64.dll` |
| 进程扫描/连接管理 | `src/msg-center/core/reverse/initIpcTask.js` |
| 消息接收循环 | `src/msg-center/core/reverse/asyncSelectTask.js` |
| IPC 常量配置 | `src/msg-center/core/reverse/ipcConfig.js` |
| 进程工具 | `src/msg-center/core/reverse/ipcUtil.js` |
| 逆向发送(调度层) | `src/msg-center/dispatch-center/reverseSend.js` |
| 注册表管理 | `src/msg-center/core/registry-config/index.js` |
| 注册表列表 | `src/msg-center/core/registry-config/registryList.js` |
| PipeCode 缓存 | `src/msg-center/core/cache/common/pipeCodeCache.js` |
| 逆向启动入口 | `src/msg-center/start/reverseStart.js` |
| 注入程序 | `extraResources/inject/BasicService.exe` |
| 防更新脚本 | `extraResources/prevent_wx_update.bat` |

---

*文档生成时间：2026-03-13 | 基于 galaxy-client 仓库实际代码分析*
