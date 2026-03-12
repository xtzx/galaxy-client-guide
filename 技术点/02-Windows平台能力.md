# Windows 平台能力详解

> Node.js 访问 Windows 系统功能

---

## 一、概述

### 1.1 本项目使用的 Windows 能力

| 能力 | 依赖包 | 用途 |
|-----|-------|-----|
| 调用 DLL | ffi-napi | 与逆向服务通信 |
| 注册表操作 | regedit / winreg | 设置启动项、读取配置 |
| 进程管理 | child_process | 启动/停止进程 |
| 系统信息 | systeminformation | 获取系统资源信息 |

### 1.2 为什么只支持 Windows

```
┌─────────────────────────────────────────────────────────────────┐
│                    平台依赖关系                                  │
└─────────────────────────────────────────────────────────────────┘

    Galaxy-Client (Electron)
          │
          │ 调用
          ▼
    ┌─────────────────┐
    │   ffi-napi      │ ──────────► Windows DLL
    │                 │              ├── PipeCore.dll
    │                 │              └── ReUtils64.dll
    └─────────────────┘
          │
          │ 通信
          ▼
    ┌─────────────────┐
    │ BasicService.exe│ ──────────► Windows 进程
    │  (逆向服务)      │
    └─────────────────┘
          │
          │ DLL注入
          ▼
    ┌─────────────────┐
    │ WeChat.exe      │ ──────────► Windows 应用
    │ WXWork.exe      │
    └─────────────────┘
```

由于逆向服务（BasicService.exe）和相关 DLL 只有 Windows 版本，所以项目仅支持 Windows 平台。

---

## 二、ffi-napi：调用 DLL

### 2.1 什么是 ffi-napi

ffi-napi (Foreign Function Interface) 允许 Node.js 直接调用 C/C++ 编写的动态链接库（DLL）。

```
┌─────────────────────────────────────────────────────────────────┐
│                   ffi-napi 工作原理                              │
└─────────────────────────────────────────────────────────────────┘

    Node.js 代码
         │
         │ 调用 ffi.Library()
         ▼
    ┌─────────────────┐
    │    ffi-napi     │
    │  (N-API 绑定)   │
    └────────┬────────┘
             │ 加载 DLL
             ▼
    ┌─────────────────┐
    │   PipeCore.dll  │
    │  (C++ 编写)     │
    └────────┬────────┘
             │ 进程间通信
             ▼
    ┌─────────────────┐
    │ BasicService.exe│
    └─────────────────┘
```

### 2.2 项目中的 DLL 调用

```javascript
// src/msg-center/core/reverse/dll/clibrary.js

const ffi = require("ffi-napi");
const ref = require("ref-napi");
const path = require("path");

// DLL 文件路径
const dllPath = path.resolve(__dirname, "./PipeCore.dll");
const processUtilsPath = path.resolve(__dirname, "./ReUtils64.dll");

// 定义 DLL 函数签名
const functions = {
    // 连接 IPC 服务器，返回管道代码
    IpcConnectServer: [ref.types.size_t, ["int"]],
    
    // 检查管道是否有消息
    IpcSelectCltChannel: ["int", [ref.types.size_t]],
    
    // 发送消息到管道
    IpcClientSendMessage: ["bool", ["void*", "int", ref.types.size_t]],
    
    // 从管道接收消息
    IpcClientRecvMessage: ["bool", ["void*", "int", ref.types.size_t]],
    
    // 关闭管道连接
    IpcClientClose: ["bool", [ref.types.size_t]],
    
    // 检查进程是否有效
    IsValidProcess: ["bool", ["int"]],
};

// 工具函数签名
const utilsFunctions = {
    // 检查进程是否可连接
    CanConnectProcess: ["bool", ["int"]],
    
    // 检查是否有已登录账号
    HasLoginedAccount: ["bool", ["uint64"]],
    
    // 获取进程内存占用
    GetProcsPhysicalMmSize: ["pointer", ["uint64"]],
    
    // 获取子进程内存占用
    GetSubProcPhysicalMmSize: ["pointer", ["int"]],
};

// 加载 DLL
const library = ffi.Library(dllPath, functions);
const ProcessUtilsLibrary = ffi.Library(processUtilsPath, utilsFunctions);
```

### 2.3 DLL 函数使用示例

```javascript
// 连接 IPC 服务器
function IpcConnectServer(processId) {
    return library.IpcConnectServer(processId);
}

// 发送消息
function IpcClientSendMessage(pipeCode, message) {
    const bytes = Buffer.from(message);
    const bufferLength = bytes.length;
    return library.IpcClientSendMessage(bytes, bufferLength, pipeCode);
}

// 接收消息
function IpcClientRecvMessage(pipeCode, bufferLength) {
    const byteBuffer = Buffer.alloc(bufferLength);
    const result = library.IpcClientRecvMessage(byteBuffer, bufferLength, pipeCode);
    if (result) {
        return byteBuffer.toString("utf8").replace(/\x00/g, "");
    }
    return null;
}

// 关闭连接
function IpcClientClose(pipeCode) {
    return library.IpcClientClose(pipeCode);
}

// 检查进程是否可用
function isUseProcess(pid) {
    return ProcessUtilsLibrary.CanConnectProcess(pid);
}

module.exports = {
    IpcConnectServer,
    IpcClientSendMessage,
    IpcClientRecvMessage,
    IpcClientClose,
    isUseProcess,
};
```

### 2.4 数据类型映射

| C 类型 | ref-napi 类型 | JavaScript 类型 |
|-------|--------------|----------------|
| int | ref.types.int | number |
| bool | ref.types.bool | boolean |
| char* | ref.types.CString | string |
| void* | ref.refType('void') | Buffer |
| size_t | ref.types.size_t | number |
| uint64 | ref.types.uint64 | bigint/number |

---

## 三、注册表操作

### 3.1 regedit 模块

```javascript
// src/event/regedit.js
const regedit = require('regedit');

// 初始化注册表配置
function initRegedit() {
    // 设置 regedit 可执行文件路径
    const vbsPath = path.join(__dirname, '../node_modules/regedit/vbs');
    regedit.setExternalVBSLocation(vbsPath);
}

// 读取注册表
async function readRegistry(key) {
    return new Promise((resolve, reject) => {
        regedit.list(key, (err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
    });
}

// 写入注册表
async function writeRegistry(key, values) {
    return new Promise((resolve, reject) => {
        regedit.putValue({
            [key]: values
        }, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}
```

### 3.2 常用注册表操作

```javascript
// 读取微信安装路径
const wechatPath = 'HKCU\\Software\\Tencent\\WeChat';
regedit.list(wechatPath, (err, result) => {
    const installDir = result[wechatPath].values['InstallPath'].value;
    console.log('微信安装路径:', installDir);
});

// 设置调试标志
const debugKey = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\WXWork.exe';
regedit.putValue({
    [debugKey]: {
        GlobalFlag: {
            value: 0x00000200,
            type: 'REG_DWORD'
        }
    }
});
```

### 3.3 winreg 模块（替代方案）

```javascript
const Winreg = require('winreg');

// 读取注册表
const regKey = new Winreg({
    hive: Winreg.HKCU,
    key: '\\Software\\Tencent\\WeChat'
});

regKey.values((err, items) => {
    items.forEach(item => {
        console.log(item.name, item.value);
    });
});

// 写入注册表
regKey.set('MyValue', Winreg.REG_SZ, 'Hello', (err) => {
    if (err) console.error(err);
});
```

---

## 四、进程管理

### 4.1 启动进程

```javascript
// src/common/inject.js
const { exec, execFile } = require('child_process');
const iconv = require('iconv-lite');

// 启动逆向服务
function runInject() {
    const exePath = getPath('extraResources\\Inject\\BasicService.exe');
    
    exec(`"${exePath}" pcwx`, { encoding: null }, (error, stdout, stderr) => {
        if (error) {
            // Windows 命令行输出是 GBK 编码
            const errorMsg = iconv.decode(stderr, 'gb2312');
            console.error('启动失败:', errorMsg);
        }
    });
}

// 启动企业微信逆向
function runQyWxInject(accountId) {
    let cmd = `"${exePath}" qywx`;
    if (accountId) {
        cmd += ' --cfg';
    }
    exec(cmd, { encoding: null }, (error, stdout, stderr) => {
        if (error) {
            handleExecError('RUN QYWX INJECT ERROR', error, stderr);
        }
    });
}
```

### 4.2 停止进程

```javascript
// 使用 taskkill 命令
function stopBasicService(callback) {
    // 方式1: wmic delete
    exec('wmic process where name="BasicService.exe" delete', 
        { encoding: null }, 
        (error, stdout, stderr) => {
            if (error) {
                // 方式2: taskkill
                exec('taskkill -f -t -im BasicService.exe', 
                    (error, stdout, stderr) => {
                        callback && callback(error);
                    }
                );
                return;
            }
            callback && callback();
        }
    );
}

// 停止微信
function stopWeChat(callback) {
    exec('wmic process where name="weixin.exe" delete', 
        { encoding: null }, 
        (error, stdout, stderr) => {
            if (error) {
                exec('taskkill -f -t -im weixin.exe', callback);
                return;
            }
            callback && callback();
        }
    );
}
```

### 4.3 检查进程是否存在

```javascript
// src/utils.js
exports.judgeProcessExist = params => new Promise(resolve => {
    // 使用 tasklist 和 findstr 命令
    exec(`tasklist | findstr ${params}`, {}, error => {
        if (error) {
            resolve({ status: 0 });  // 不存在
        }
        resolve({ status: 1 });      // 存在
    });
});

// 使用示例
const result = await judgeProcessExist('javaw.exe');
if (result.status === 1) {
    console.log('Java 进程正在运行');
}
```

---

## 五、系统信息获取

### 5.1 systeminformation 模块

```javascript
const si = require('systeminformation');

// 获取 CPU 信息
const cpu = await si.cpu();
console.log('CPU:', cpu.manufacturer, cpu.brand);

// 获取内存信息
const mem = await si.mem();
console.log('内存总量:', mem.total);
console.log('可用内存:', mem.available);

// 获取进程列表
const processes = await si.processes();
processes.list.forEach(p => {
    console.log(p.name, p.pid, p.mem);
});
```

### 5.2 pidusage 模块

```javascript
const pidusage = require('pidusage');

// 获取指定进程的资源使用情况
const stats = await pidusage(12345);
console.log('CPU 使用率:', stats.cpu);
console.log('内存使用:', stats.memory);

// 批量获取
const statsAll = await pidusage([12345, 12346, 12347]);
```

---

## 六、文件系统操作

### 6.1 Hosts 文件操作

```javascript
// src/utils.js
// 检查 hosts 文件并阻止微信更新

exports.judgeHostsAndRunBat = () => {
    const hostsFilePath = 'C:\\Windows\\System32\\drivers\\etc\\hosts';
    const targetEntry = 'dldir1.qq.com';
    const batFilePath = path.resolve(app.getAppPath(), 
        app.isPackaged 
            ? './extraResources/prevent_wx_update.bat' 
            : '../extraResources/prevent_wx_update.bat'
    );
    
    fs.readFile(hostsFilePath, 'utf8', (err, data) => {
        if (err) {
            log.info('读取 hosts 文件出错:', err);
            return;
        }
        
        // 检查是否包含目标条目
        if (!data.includes(targetEntry)) {
            log.info(`${targetEntry} 不存在于 hosts 文件中，执行 bat 文件。`);
            
            // 执行 bat 文件
            execFile(batFilePath, (error, stdout, stderr) => {
                if (error) {
                    log.info('执行 bat 文件出错:', error);
                    return;
                }
                log.info(`bat 文件输出: ${stdout}`);
            });
        }
    });
};
```

### 6.2 fs-extra 增强操作

```javascript
const fse = require('fs-extra');

// 确保目录存在
await fse.ensureDir(logPath);

// 检查路径是否存在
const exists = await fse.pathExists(filePath);

// 复制文件/目录
await fse.copy(src, dest);

// 移动文件/目录
await fse.move(src, dest);

// 删除文件/目录
await fse.remove(filePath);

// 写入 JSON
await fse.writeJson(filePath, data, { spaces: 2 });

// 读取 JSON
const data = await fse.readJson(filePath);
```

---

## 七、编码处理

### 7.1 iconv-lite 处理中文

Windows 命令行默认使用 GBK 编码，需要转换：

```javascript
const iconv = require('iconv-lite');

// 执行命令并正确处理中文输出
exec('dir /b', { encoding: null }, (error, stdout, stderr) => {
    // 将 GBK 编码转换为 UTF-8
    const output = iconv.decode(stdout, 'gb2312');
    console.log(output);
    
    if (stderr) {
        const errorMsg = iconv.decode(stderr, 'gb2312');
        console.error(errorMsg);
    }
});

// 错误处理函数
function handleExecError(key, error, stderr) {
    error['_stderr'] = iconv.decode(stderr, 'gb2312');
    log.error(key, JSON.stringify(error));
}
```

---

## 八、常见问题

### Q1: node-gyp 编译失败怎么办？

```bash
# 安装 Windows 构建工具
npm install --global windows-build-tools

# 或手动安装
# 1. 安装 Python 3.10.x
# 2. 安装 Visual Studio 2017/2019 + Desktop development with C++
# 3. 设置环境变量
npm config set python python3
npm config set msvs_version 2019
```

### Q2: ffi-napi 加载 DLL 失败？

```javascript
// 1. 检查 DLL 路径是否正确
console.log('DLL 路径:', dllPath);
console.log('文件存在:', fs.existsSync(dllPath));

// 2. 检查 DLL 依赖
// 使用 Dependency Walker 工具检查 DLL 依赖

// 3. 检查 Node.js 架构
console.log('Node.js 架构:', process.arch);
// DLL 必须与 Node.js 架构匹配（x64 或 x86）
```

### Q3: 注册表操作需要管理员权限？

```yaml
# config/weixinzhushou/build.yml
win:
  requestedExecutionLevel: requireAdministrator
```

应用以管理员权限运行才能修改 HKLM 下的注册表键。

### Q4: 如何获取 Windows 版本信息？

```javascript
const os = require('os');

console.log('平台:', os.platform());     // 'win32'
console.log('版本:', os.release());      // '10.0.19041'
console.log('架构:', os.arch());         // 'x64'
console.log('主机名:', os.hostname());
console.log('用户目录:', os.homedir());
console.log('临时目录:', os.tmpdir());
```

---

## 九、学习资源

- [Node.js child_process 文档](https://nodejs.org/api/child_process.html)
- [ffi-napi GitHub](https://github.com/node-ffi-napi/node-ffi-napi)
- [regedit 文档](https://www.npmjs.com/package/regedit)
- [systeminformation 文档](https://systeminformation.io/)
- [iconv-lite 文档](https://github.com/ashtuchkin/iconv-lite)
