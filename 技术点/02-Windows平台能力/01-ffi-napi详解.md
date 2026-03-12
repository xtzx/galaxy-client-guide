# ffi-napi 详解

> Node.js 调用原生 DLL 的核心技术

---

## 一、技术简介

### 1.1 什么是 ffi-napi

`ffi-napi` (Foreign Function Interface) 是 Node.js 调用 C/C++ 动态链接库（DLL/so）的桥梁：

- **无需编写 C++ 代码**：直接调用现有 DLL
- **动态加载**：运行时加载 DLL
- **类型映射**：自动处理 JavaScript ↔ C 类型转换

### 1.2 为什么需要 ffi-napi

```
┌─────────────────────────────────────────────────────────────────┐
│                    项目通信架构                                  │
└─────────────────────────────────────────────────────────────────┘

  Node.js (Electron)              原生层                   微信
       │                            │                        │
       │  ffi-napi 调用             │                        │
       ├───────────────────────────►│                        │
       │                            │  PipeCore.dll          │
       │                            ├────────────────────────►
       │                            │  (命名管道通信)         │
       │◄───────────────────────────┤                        │
       │  接收响应                   │                        │
```

### 1.3 核心依赖

```javascript
const ffi = require('ffi-napi');   // FFI 主库
const ref = require('ref-napi');   // C 类型定义
```

---

## 二、项目中的使用

### 2.1 使用位置

```
src/msg-center/core/reverse/dll/clibrary.js    # DLL 调用封装
src/msg-center/core/reverse/initIpcTask.js     # IPC 连接初始化
src/msg-center/core/reverse/asyncSelectTask.js # 消息轮询
```

### 2.2 DLL 函数定义

```javascript
// src/msg-center/core/reverse/dll/clibrary.js

const ffi = require('ffi-napi');
const ref = require('ref-napi');
const path = require('path');

// DLL 路径
const dllPath = path.join(__dirname, '../../../../bin/PipeCore.dll');

// 定义 C 类型
const voidPtr = ref.refType(ref.types.void);
const charPtr = ref.refType(ref.types.char);

// 定义 DLL 函数签名
const functions = {
    // 连接 IPC 服务
    // size_t IpcConnectServer(int processId)
    IpcConnectServer: [ref.types.size_t, ['int']],

    // 发送消息
    // bool IpcClientSendMessage(void* buffer, int length, size_t pipeCode)
    IpcClientSendMessage: ['bool', [voidPtr, 'int', ref.types.size_t]],

    // 接收消息
    // bool IpcClientRecvMessage(void* buffer, int length, size_t pipeCode)
    IpcClientRecvMessage: ['bool', [voidPtr, 'int', ref.types.size_t]],

    // 关闭连接
    // bool IpcClientClose(size_t pipeCode)
    IpcClientClose: ['bool', [ref.types.size_t]],

    // 检查通道状态
    // int IpcSelectCltChannel(size_t pipeCode, int timeout)
    IpcSelectCltChannel: ['int', [ref.types.size_t, 'int']],
};

// 加载 DLL
let library = null;
try {
    library = ffi.Library(dllPath, functions);
    console.log('[DLL] PipeCore.dll 加载成功');
} catch (error) {
    console.error('[DLL] PipeCore.dll 加载失败:', error);
}

module.exports = library;
```

### 2.3 建立 IPC 连接

```javascript
// src/msg-center/core/reverse/initIpcTask.js

const Clibrary = require('./dll/clibrary');

/**
 * 连接到逆向服务
 * @param {number} processId - 微信进程ID
 * @returns {number} pipeCode - 管道代码（0表示失败）
 */
function connectToProcess(processId) {
    try {
        // 调用 DLL 函数建立连接
        const pipeCode = Clibrary.IpcConnectServer(processId);

        if (pipeCode === 0) {
            console.log(`[IPC] 连接失败: processId=${processId}`);
            return 0;
        }

        console.log(`[IPC] 连接成功: processId=${processId}, pipeCode=${pipeCode}`);
        return pipeCode;

    } catch (error) {
        console.error('[IPC] 连接异常:', error);
        return 0;
    }
}
```

### 2.4 发送消息

```javascript
// 发送消息到逆向服务

const ref = require('ref-napi');

function sendMessage(pipeCode, message) {
    // 1. 将 JSON 转为字符串
    const jsonStr = JSON.stringify(message);

    // 2. 转为 Buffer（UTF-8 编码）
    const buffer = Buffer.from(jsonStr, 'utf8');

    // 3. 创建足够大的缓冲区
    const sendBuffer = Buffer.alloc(buffer.length + 1);
    buffer.copy(sendBuffer);

    // 4. 调用 DLL 发送
    const success = Clibrary.IpcClientSendMessage(
        sendBuffer,
        sendBuffer.length,
        pipeCode
    );

    return success;
}
```

### 2.5 接收消息（轮询）

```javascript
// src/msg-center/core/reverse/asyncSelectTask.js

const BUFFER_SIZE = 1024 * 1024;  // 1MB 缓冲区
const POLL_TIMEOUT = 100;          // 100ms 超时

async function pollMessages(pipeCode) {
    while (true) {
        try {
            // 1. 检查是否有消息
            const status = Clibrary.IpcSelectCltChannel(pipeCode, POLL_TIMEOUT);

            if (status <= 0) {
                // 无消息或连接断开
                if (status < 0) {
                    console.log('[IPC] 连接断开');
                    break;
                }
                continue;
            }

            // 2. 接收消息
            const buffer = Buffer.alloc(BUFFER_SIZE);
            const success = Clibrary.IpcClientRecvMessage(
                buffer,
                BUFFER_SIZE,
                pipeCode
            );

            if (success) {
                // 3. 解析消息
                const nullIndex = buffer.indexOf(0);
                const jsonStr = buffer.toString('utf8', 0, nullIndex);
                const message = JSON.parse(jsonStr);

                // 4. 分发处理
                dispatchOutBound(message, pipeLineWrapper);
            }

        } catch (error) {
            console.error('[IPC] 轮询异常:', error);
            await sleep(1000);
        }
    }
}
```

---

## 三、类型系统详解

### 3.1 基本类型映射

```javascript
const ref = require('ref-napi');

// 基本类型
ref.types.void      // void
ref.types.int       // int (32位)
ref.types.uint      // unsigned int
ref.types.int64     // long long (64位)
ref.types.float     // float
ref.types.double    // double
ref.types.bool      // bool
ref.types.char      // char
ref.types.size_t    // size_t（平台相关）

// 使用示例
const functions = {
    add: ['int', ['int', 'int']],           // int add(int a, int b)
    getValue: ['double', []],                // double getValue()
    isValid: ['bool', ['int']],              // bool isValid(int id)
};
```

### 3.2 指针类型

```javascript
// 创建指针类型
const intPtr = ref.refType(ref.types.int);      // int*
const charPtr = ref.refType(ref.types.char);    // char*
const voidPtr = ref.refType(ref.types.void);    // void*

// 使用指针
const functions = {
    // void* malloc(size_t size)
    malloc: [voidPtr, [ref.types.size_t]],

    // void free(void* ptr)
    free: ['void', [voidPtr]],

    // int strlen(char* str)
    strlen: ['int', [charPtr]],
};
```

### 3.3 Buffer 作为指针

```javascript
// JavaScript 中用 Buffer 传递指针参数

// C 函数：void processData(void* data, int length)
const functions = {
    processData: ['void', [voidPtr, 'int']],
};

// 调用
const buffer = Buffer.from('Hello World');
library.processData(buffer, buffer.length);
```

### 3.4 结构体

```javascript
const StructType = require('ref-struct-napi');

// 定义结构体
const Point = StructType({
    x: ref.types.int,
    y: ref.types.int
});

// C 函数：void setPoint(Point* p)
const functions = {
    setPoint: ['void', [ref.refType(Point)]],
};

// 使用
const point = new Point({ x: 10, y: 20 });
library.setPoint(point.ref());
```

---

## 四、错误处理

### 4.1 DLL 加载失败

```javascript
let library = null;

try {
    library = ffi.Library(dllPath, functions);
} catch (error) {
    if (error.message.includes('not find')) {
        console.error('DLL 文件不存在:', dllPath);
    } else if (error.message.includes('not a valid')) {
        console.error('DLL 架构不匹配（32/64位）');
    } else {
        console.error('DLL 加载失败:', error);
    }
}
```

### 4.2 函数调用失败

```javascript
function safeCall(func, ...args) {
    try {
        return func(...args);
    } catch (error) {
        console.error('DLL 函数调用失败:', error);
        return null;
    }
}

// 使用
const result = safeCall(library.IpcConnectServer, processId);
```

### 4.3 内存管理

```javascript
// 注意：Buffer 由 Node.js GC 管理
// 但 DLL 分配的内存需要手动释放

const ptr = library.malloc(1024);
try {
    // 使用 ptr...
} finally {
    library.free(ptr);  // 释放内存
}
```

---

## 五、异步调用

### 5.1 使用 async 方法

```javascript
// ffi-napi 支持异步调用
const functions = {
    slowOperation: ['int', ['int']],
};

const library = ffi.Library(dllPath, functions);

// 同步调用（阻塞）
const result = library.slowOperation(100);

// 异步调用（非阻塞）
library.slowOperation.async(100, (err, result) => {
    if (err) {
        console.error('异步调用失败:', err);
        return;
    }
    console.log('结果:', result);
});
```

### 5.2 Promise 封装

```javascript
function asyncCall(func, ...args) {
    return new Promise((resolve, reject) => {
        func.async(...args, (err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
    });
}

// 使用
const result = await asyncCall(library.slowOperation, 100);
```

---

## 六、注意事项

### 6.1 Electron 版本限制

```javascript
// ffi-napi 依赖 Node.js N-API
// Electron 20.0.2 使用 Node.js 16.x，与 ffi-napi 兼容
// 升级 Electron 可能导致 ffi-napi 无法工作

// 检查 N-API 版本
console.log('N-API Version:', process.versions.napi);
```

### 6.2 32/64 位匹配

```javascript
// DLL 必须与 Electron 架构匹配
// Electron x64 → 需要 x64 的 DLL
// Electron x86 → 需要 x86 的 DLL

// 检查架构
console.log('架构:', process.arch);  // 'x64' 或 'ia32'
```

### 6.3 打包注意事项

```yaml
# electron-builder 配置
asarUnpack:
  - "**/node_modules/ffi-napi/**"
  - "**/node_modules/ref-napi/**"
  - "**/bin/*.dll"

extraResources:
  - from: "bin/"
    to: "bin/"
    filter:
      - "*.dll"
```

---

## 七、调试技巧

### 7.1 检查 DLL 是否正确加载

```javascript
console.log('DLL 函数列表:', Object.keys(library));
```

### 7.2 打印 Buffer 内容

```javascript
function debugBuffer(buffer, label = 'Buffer') {
    console.log(`[${label}]`);
    console.log('  Length:', buffer.length);
    console.log('  Hex:', buffer.toString('hex').substring(0, 100));
    console.log('  String:', buffer.toString('utf8').substring(0, 100));
}
```

### 7.3 跟踪 DLL 调用

```javascript
function wrapLibrary(lib) {
    const wrapped = {};
    for (const [name, func] of Object.entries(lib)) {
        wrapped[name] = (...args) => {
            console.log(`[DLL] ${name}(`, args, ')');
            const result = func(...args);
            console.log(`[DLL] ${name} =>`, result);
            return result;
        };
    }
    return wrapped;
}

const debugLibrary = wrapLibrary(library);
```

---

## 八、与 React 开发对比

### 8.1 前端无法直接调用

```javascript
// React（浏览器）无法使用 ffi-napi
// 只能通过后端 API 间接调用

// 前端
fetch('/api/native-operation', { method: 'POST' });

// 后端（Node.js）
app.post('/api/native-operation', (req, res) => {
    const result = library.nativeFunction();
    res.json({ result });
});
```

### 8.2 Electron 渲染进程

```javascript
// 渲染进程也不能直接调用 ffi-napi
// 需要通过 IPC 请求主进程

// 渲染进程
const { ipcRenderer } = require('electron');
const result = await ipcRenderer.invoke('native-operation', params);

// 主进程
ipcMain.handle('native-operation', async (event, params) => {
    return library.nativeFunction(params);
});
```
