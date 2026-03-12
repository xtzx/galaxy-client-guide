# IPC 进程间通信详解

> 与逆向服务的通信机制

---

## 一、概述

### 1.1 什么是 IPC

IPC（Inter-Process Communication，进程间通信）是指在不同进程之间传递数据的技术。本项目中，Electron 主进程需要与逆向服务（BasicService.exe）进行双向通信。

### 1.2 通信架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       IPC 通信架构                                       │
└─────────────────────────────────────────────────────────────────────────┘

    Electron 主进程                              逆向服务
    ┌─────────────────┐                    ┌─────────────────┐
    │                 │                    │                 │
    │   initIpcTask   │  ◄─── 扫描进程 ──► │ BasicService.exe│
    │                 │                    │                 │
    │   clibrary.js   │  ◄─── IPC管道 ───► │  PipeCore.dll   │
    │   (ffi-napi)    │                    │                 │
    │                 │                    │  Galaxy.dll     │
    │ asyncSelectTask │  ◄─── 消息收发 ──► │                 │
    │                 │                    │                 │
    └─────────────────┘                    └─────────────────┘
            │                                      │
            │                                      │ DLL注入
            │                                      ▼
            │                              ┌─────────────────┐
            │                              │   WeChat.exe    │
            │ 转发消息                     │   WXWork.exe    │
            ▼                              └─────────────────┘
    ┌─────────────────┐
    │   MQTT / 前端   │
    └─────────────────┘
```

### 1.3 通信方式：命名管道

项目使用 Windows 命名管道（Named Pipes）进行 IPC 通信：

- **优点**：高效、可靠、支持双向通信
- **机制**：通过 DLL 封装管道操作

---

## 二、核心模块

### 2.1 文件结构

```
src/msg-center/core/reverse/
├── initIpcTask.js        # IPC 连接初始化和管理
├── asyncSelectTask.js    # 消息轮询接收
├── ipcConfig.js          # IPC 配置常量
├── ipcUtil.js            # IPC 工具函数
└── dll/
    ├── clibrary.js       # DLL 调用封装
    ├── PipeCore.dll      # 管道通信 DLL
    └── ReUtils64.dll     # 工具函数 DLL
```

### 2.2 模块职责

| 模块 | 职责 |
|-----|-----|
| initIpcTask | 扫描进程、建立连接、管理连接生命周期 |
| asyncSelectTask | 轮询管道、接收消息、分发处理 |
| clibrary | 封装 DLL 函数调用 |
| ipcConfig | 定义常量（超时、状态等） |
| ipcUtil | 工具函数（进程检测、数组比较等） |

---

## 三、连接建立流程

### 3.1 连接时序图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       IPC 连接建立流程                                   │
└─────────────────────────────────────────────────────────────────────────┘

  initIpcTask        ipcUtil          clibrary           BasicService
      │                │                  │                    │
      │  run()         │                  │                    │
      ├────────────────►                  │                    │
      │                │                  │                    │
      │  每5秒扫描     │                  │                    │
      ├────────────────►                  │                    │
      │  getProcessIds()                  │                    │
      │◄───────────────┤                  │                    │
      │  返回进程ID列表 │                  │                    │
      │                │                  │                    │
      │  检查进程是否可用                 │                    │
      ├───────────────────────────────────►                    │
      │                │   isUseProcess() │                    │
      │                │◄─────────────────┤                    │
      │                │                  │                    │
      │  建立管道连接   │                  │                    │
      ├───────────────────────────────────►                    │
      │                │ IpcConnectServer()                    │
      │                │──────────────────────────────────────►│
      │                │                  │      返回 pipeCode │
      │                │◄──────────────────────────────────────┤
      │                │                  │                    │
      │  保存注册信息   │                  │                    │
      │  RegistryConfig.add()             │                    │
      │                │                  │                    │
      │  启动消息轮询   │                  │                    │
      │  asyncSelectTask.run()            │                    │
```

### 3.2 核心代码：initIpcTask.js

```javascript
// src/msg-center/core/reverse/initIpcTask.js

const MyObject = (function () {
    let instance;
    
    function createInstance() {
        const obj = {
            // 启动应用后，每5秒钟一次的IPC连接扫描
            async run() {
                let processIdsAvaliableOld = [];
                let oldAllProcessIds = [];
                
                while(true) {
                    try {
                        // 1. 获取所有可用进程ID
                        let processIds = IpcUtil.getProcessIds();
                        
                        // 2. 过滤不可用的进程
                        const processIdsTemp = [];
                        processIds.forEach(processId => {
                            const isAvaliable = Clibrary.isUseProcess(processId);
                            if (isAvaliable) {
                                processIdsTemp.push(processId);
                            }
                        });
                        processIds = processIdsTemp;
                        
                        // 3. 检查当前注册的进程
                        let currProcessIds = RegistryConfig.getCurrProcessIds();
                        
                        // 4. 如果没有新进程，继续等待
                        if (processIds.length === 0) {
                            this.batchCheckAndExit(currProcessIds);
                            await sleep(5000);
                            continue;
                        }
                        
                        // 5. 比较进程列表，处理新增和退出
                        const isArrEqual = IpcUtil.arrayEquals(processIds, currProcessIds);
                        if (isArrEqual) {
                            await sleep(5000);
                            continue;
                        }
                        
                        // 6. 为新进程建立连接
                        for(let processId of processIds) {
                            if (currProcessIds.includes(processId)) {
                                currProcessIds = currProcessIds.filter(id => id !== processId);
                                continue;
                            }
                            
                            // 使用锁防止并发
                            lock.acquire(`ipcLock-${processId}`, (done) => {
                                // 建立管道连接
                                let pipeCode = Clibrary.IpcConnectServer(processId);
                                
                                if (pipeCode <= 0) {
                                    // 连接失败，尝试清理旧连接
                                    // ...
                                }
                                
                                // 创建注册信息
                                const pipeLineWrapper = {
                                    pipeCode,
                                    id: processId,
                                    processId,
                                    available: IpcConfig.NOT_AVAILABLE,
                                    workWx: IpcUtil.processMap[processId] || false,
                                    createTime: Date.now(),
                                };
                                
                                const registry = {
                                    pipeLineWrapper,
                                    sendToCloudFlag: IpcConfig.NOT_SEND_LOGIN_TO_CLOUD,
                                    id: processId,
                                    scanTime: Date.now(),
                                    workWx: IpcUtil.processMap[processId] || false,
                                };
                                
                                // 保存注册信息
                                RegistryConfig.add(registry);
                                
                                // 启动消息轮询
                                this.startSelectMessage(registry);
                                
                                done();
                            });
                        }
                        
                        // 7. 处理退出的进程
                        if (currProcessIds.length > 0) {
                            this.batchCheckAndExit(currProcessIds);
                        }
                        
                        await sleep(5000);
                    } catch(error) {
                        await sleep(5000);
                        logUtil.customLog(`[initIpcTask] 错误: ${error.message}`);
                    }
                }
            },
            
            // 批量检查并退出进程
            batchCheckAndExit(processIdList) {
                const exitList = [];
                for(let processId of processIdList) {
                    let existFlag = IpcUtil.isProcessExist(processId);
                    if (!existFlag) {
                        exitList.push(processId);
                        RegistryConfig.removePipe(processId);
                        frontSendService.sendGetAllConfig();
                    }
                }
                return exitList;
            },
            
            // 启动消息轮询
            startSelectMessage(registry) {
                AsyncSelectTask.run(registry.pipeLineWrapper);
            }
        };
        return obj;
    }
    
    return {
        getInstance() {
            if (!instance) {
                instance = createInstance();
            }
            return instance;
        },
    };
})();
```

---

## 四、消息收发

### 4.1 发送消息

```javascript
// src/msg-center/dispatch-center/reverseSend.js

const reverseSendObj = (function () {
    let instance;
    
    function createInstance() {
        const obj = {
            sendMessage(wxId, channelId, message) {
                // 1. 获取注册信息
                let registry = RegistryConfig.getRegistryByKey(wxId, 'wxid');
                if (!registry) {
                    registry = RegistryConfig.getRegistryByKey(channelId, 'id');
                }
                
                if (!registry || !registry.pipeLineWrapper) {
                    logUtil.customLog(`[reverseSend] 连接不存在: ${wxId}`);
                    return;
                }
                
                const { pipeCode } = registry.pipeLineWrapper;
                
                // 2. 发送消息到管道
                const result = Clibrary.IpcClientSendMessage(pipeCode, message);
                
                if (!result) {
                    logUtil.customLog(`[reverseSend] 发送失败: ${message}`);
                }
            }
        };
        return obj;
    }
    
    return {
        getInstance() {
            if (!instance) {
                instance = createInstance();
            }
            return instance;
        }
    };
})();
```

### 4.2 接收消息（轮询）

```javascript
// src/msg-center/core/reverse/asyncSelectTask.js

const AsyncSelectTask = {
    async run(pipeLineWrapper) {
        const { pipeCode, processId } = pipeLineWrapper;
        
        while(true) {
            try {
                // 1. 检查管道是否有消息
                const hasMessage = Clibrary.IpcSelectCltChannel(pipeCode);
                
                if (hasMessage > 0) {
                    // 2. 接收消息
                    const message = Clibrary.IpcClientRecvMessage(
                        pipeCode, 
                        bufferLength, 
                        pipeLineWrapper.wxid
                    );
                    
                    if (message) {
                        // 3. 分发处理
                        dispatchOutBound(message, pipeLineWrapper);
                    }
                }
                
                // 4. 短暂休眠，避免 CPU 占用过高
                await sleep(10);
                
            } catch(error) {
                // 连接断开，退出循环
                if (error.message.includes('pipe closed')) {
                    break;
                }
                await sleep(100);
            }
        }
    }
};
```

### 4.3 DLL 函数封装

```javascript
// src/msg-center/core/reverse/dll/clibrary.js

function IpcClientSendMessage(pipeCode, message) {
    try {
        let jsonObj = JSON.parse(message);
        if (jsonObj.type !== "ping") {
            logUtil.customLog(
                `[发送逆向] type=${jsonObj.type} wxid=${jsonObj.wxId} taskId=${jsonObj.taskId}`
            );
        }
        
        // 处理大数字（防止精度丢失）
        if (jsonObj.type === "getlabelcustomer" || jsonObj.type === "insertordellabel") {
            message = message.replace(/\"(\d{16,})\"/g, "$1");
        }
        
        // 转换为 Buffer
        const bytes = Buffer.from(message);
        const bufferLength = bytes.length;
        
        // 调用 DLL 发送
        return library.IpcClientSendMessage(bytes, bufferLength, pipeCode);
        
    } catch (error) {
        logUtil.customLog(`[IpcClientSendMessage] 错误: ${error.message}`);
    }
}

function IpcClientRecvMessage(pipeCode, bufferLength, wxid) {
    try {
        // 分配缓冲区
        const byteBuffer = Buffer.alloc(bufferLength);
        
        // 调用 DLL 接收
        const result = library.IpcClientRecvMessage(byteBuffer, bufferLength, pipeCode);
        
        if (result) {
            // 解析消息
            const resultStr = byteBuffer.toString("utf8");
            const replaceStr = resultStr.replace(/\x00/g, "");
            const messageInfo = JSON.parse(replaceStr);
            
            logUtil.customLog(
                `[接收逆向] type=${messageInfo.type} wxid=${wxid}`
            );
            
            // 检查错误类型
            if (messageInfo.type === "typeerror" || messageInfo.type === "jsonerror") {
                notify.nxPushError(wxid, messageInfo.type);
            }
            
            return replaceStr;
        }
        return null;
        
    } catch (error) {
        logUtil.customLog(`[IpcClientRecvMessage] 错误: ${error.message}`);
    }
}
```

---

## 五、连接管理

### 5.1 Registry 数据结构

```javascript
// 每个微信/企微连接的注册信息
const registry = {
    id: 12345,                    // 进程ID
    wxid: 'wxid_xxx',            // 微信ID
    workWx: false,               // 是否企业微信
    scanTime: Date.now(),        // 扫描时间
    loginTime: null,             // 登录时间
    sendToCloudFlag: false,      // 是否已上报云端
    
    pipeLineWrapper: {
        pipeCode: 67890,         // 管道代码
        id: 12345,               // 进程ID
        processId: 12345,        // 进程ID
        available: true,         // 是否可用
        workWx: false,           // 是否企业微信
        createTime: Date.now(),  // 创建时间
        wxid: 'wxid_xxx',        // 微信ID
        lastPongTime: null,      // 最后心跳时间
    },
    
    wxInfo: {                    // 用户信息
        wxid: 'wxid_xxx',
        nickname: '张三',
        headimg: 'http://...',
        // ...
    },
    
    mqttClient: null,            // MQTT 客户端实例
    isMqttConnecting: false,     // MQTT 是否正在连接
};
```

### 5.2 Registry 操作

```javascript
// src/msg-center/core/registry-config/index.js

const RegistryConfig = {
    // 添加注册信息
    add: registryList.addRegistry,
    
    // 移除注册信息
    remove: registryList.removeRegistry,
    
    // 按字段查询
    getRegistryByKey: registryList.getRegistryByKey,
    
    // 获取所有配置
    getAllConfig: registryList.getAllConfig,
    
    // 移除管道连接
    removePipe(processId, pipeCode) {
        let registry = this.getRegistryByKey(processId, 'id');
        
        if (!registry?.pipeLineWrapper?.pipeCode && !pipeCode) {
            return;
        }
        
        // 关闭 IPC 连接
        Clibrary.IpcClientClose(registry.pipeLineWrapper.pipeCode);
        
        // 清除 MQTT 连接
        this.forceClearMqtt(registry?.wxid, registry);
        
        // 移除注册信息
        this.remove(registry);
    },
    
    // 获取所有微信ID
    getAllWxId() {
        const registryList = this.getRegistryList();
        return registryList
            .filter(registry => registry.wxid)
            .map(registry => registry.wxid);
    },
    
    // 获取当前所有进程ID
    getCurrProcessIds() {
        const registryList = this.getRegistryList();
        if (registryList.length > 0) {
            return registryList.map(registry => registry.pipeLineWrapper.processId);
        }
        return [];
    },
};
```

---

## 六、心跳检测

### 6.1 Ping/Pong 机制

```javascript
// 发送 ping
function sendPing(registry) {
    const pingMessage = JSON.stringify({
        type: 'ping',
        channelId: registry.id,
        timestamp: Date.now()
    });
    
    Clibrary.IpcClientSendMessage(
        registry.pipeLineWrapper.pipeCode, 
        pingMessage
    );
}

// 处理 pong 响应
// src/msg-center/business/convert-service/pongService.js
const PongService = {
    filter(clientRecord) {
        return clientRecord.type === 'pong';
    },
    
    operate(clientRecord, pipeLineWrapper) {
        // 更新最后响应时间
        RegistryConfig.setPongTime(pipeLineWrapper.id);
        
        // 检查是否超时
        const lastPongTime = pipeLineWrapper.lastPongTime;
        if (lastPongTime && Date.now() - lastPongTime > 60000) {
            // 超过60秒没响应，认为连接断开
            RegistryConfig.removePipe(pipeLineWrapper.id);
        }
    }
};
```

---

## 七、消息格式

### 7.1 发送给逆向的消息

```json
{
    "type": "sendmessage",
    "channelId": 12345,
    "wxId": "wxid_xxx",
    "taskId": "task_123456",
    "data": {
        "wxid": "friend_wxid",
        "content": "Hello World",
        "msgType": 1
    }
}
```

### 7.2 逆向返回的消息

```json
{
    "type": "sendmessage",
    "channelId": 12345,
    "status": 0,
    "taskId": "task_123456",
    "reportId": "report_789",
    "data": {
        "msgSvrId": "12345678901234567890"
    }
}
```

### 7.3 常用消息类型

| type | 方向 | 说明 |
|------|-----|-----|
| ping | 发送 | 心跳请求 |
| pong | 接收 | 心跳响应 |
| login | 接收 | 登录成功 |
| logout | 接收 | 登出 |
| sendmessage | 双向 | 发送消息 |
| recvmsg | 接收 | 收到消息 |
| userlist | 双向 | 好友列表 |
| chatuserinfo | 双向 | 群成员信息 |

---

## 八、错误处理

### 8.1 连接断开

```javascript
// 检测连接断开
function checkConnectionLost(pipeLineWrapper) {
    const { pipeCode, processId } = pipeLineWrapper;
    
    // 检查进程是否存在
    const exists = IpcUtil.isProcessExist(processId);
    if (!exists) {
        // 进程已退出，清理连接
        RegistryConfig.removePipe(processId);
        frontSendService.sendGetAllConfig();
        return true;
    }
    
    // 检查管道是否可用
    try {
        const status = Clibrary.IpcSelectCltChannel(pipeCode);
        if (status < 0) {
            // 管道已关闭
            RegistryConfig.removePipe(processId);
            frontSendService.sendGetAllConfig();
            return true;
        }
    } catch (error) {
        // 异常，清理连接
        RegistryConfig.removePipe(processId);
        return true;
    }
    
    return false;
}
```

### 8.2 重连机制

```javascript
// initIpcTask 会每5秒扫描一次
// 如果发现新的进程ID，会自动建立连接
// 如果发现进程退出，会自动清理连接

// 扫描循环确保：
// 1. 新登录的微信能被自动发现
// 2. 退出的微信能被自动清理
// 3. 重新登录的微信能重新建立连接
```

---

## 九、性能优化

### 9.1 轮询间隔

```javascript
// asyncSelectTask 使用短间隔轮询
await sleep(10);  // 10ms

// initIpcTask 使用长间隔扫描
await sleep(5000);  // 5秒
```

### 9.2 异步锁

```javascript
// 使用 async-lock 防止并发操作
const lock = new AsyncLock();

lock.acquire(`ipcLock-${processId}`, async (done) => {
    // 这里的代码同一时间只有一个能执行
    // ...
    done();
});
```

### 9.3 缓存管理

```javascript
// 管道代码缓存，防止重复连接
const pipeCodeCache = require('../cache/common/pipeCodeCache');

pipeCodeCache.updatePipeCodeCache(processId, pipeCode);
const cachedPipeCode = pipeCodeCache.pipeCodeMap.get(processId);
```

---

## 十、调试技巧

### 10.1 日志关键字

```javascript
// 搜索这些关键字定位问题

// IPC 连接
"[initIpcTask]"
"建立ipc连接成功"
"删除ipc连接"

// 消息发送
"[发送逆向type]"
"[发送逆向]"

// 消息接收
"[接收逆向推送消息]"
"[接收逆向]"

// 错误
"[codeError]"
"[IpcClientSendMessage]"
"[IpcClientRecvMessage]"
```

### 10.2 调试步骤

1. 检查进程是否存在：`judgeProcessExist('BasicService.exe')`
2. 检查连接是否建立：查看 `RegistryConfig.getRegistryList()`
3. 检查消息是否发送：搜索 `[发送逆向type]` 日志
4. 检查消息是否接收：搜索 `[接收逆向推送消息]` 日志
