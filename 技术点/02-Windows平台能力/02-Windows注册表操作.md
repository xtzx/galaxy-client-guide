# Windows 注册表操作

> 读写 Windows 系统注册表

---

## 一、技术简介

### 1.1 什么是 Windows 注册表

Windows 注册表（Registry）是系统的配置数据库：

- **存储配置**：系统设置、应用配置
- **层级结构**：键（Key）和值（Value）
- **根键**：HKLM、HKCU、HKCR 等

### 1.2 使用的库

| 库 | 用途 |
|---|---|
| `regedit` | 批量读写注册表 |
| `winreg` | 单个键值操作 |

---

## 二、注册表基础

### 2.1 根键说明

| 简称 | 全称 | 用途 |
|------|------|------|
| HKLM | HKEY_LOCAL_MACHINE | 系统级配置（所有用户） |
| HKCU | HKEY_CURRENT_USER | 当前用户配置 |
| HKCR | HKEY_CLASSES_ROOT | 文件类型关联 |
| HKU | HKEY_USERS | 所有用户配置 |
| HKCC | HKEY_CURRENT_CONFIG | 当前硬件配置 |

### 2.2 值类型

| 类型 | 说明 | 示例 |
|------|------|------|
| REG_SZ | 字符串 | `"Hello"` |
| REG_DWORD | 32位整数 | `0x00000001` |
| REG_QWORD | 64位整数 | `0x0000000000000001` |
| REG_BINARY | 二进制数据 | `[0x01, 0x02, 0x03]` |
| REG_MULTI_SZ | 多行字符串 | `["line1", "line2"]` |
| REG_EXPAND_SZ | 可扩展字符串 | `"%PATH%"` |

---

## 三、项目中的使用

### 3.1 使用位置

```
src/event/regedit.js    # 注册表操作
src/common/inject.js    # 逆向服务相关
```

### 3.2 使用 regedit 库

```javascript
// src/event/regedit.js

const regedit = require('regedit');
const path = require('path');

// 设置 vbs 脚本路径（打包后需要）
regedit.setExternalVBSLocation(
    path.join(__dirname, '../../node_modules/regedit/vbs')
);

/**
 * 读取注册表值
 */
async function readRegistryKey(keyPath) {
    return new Promise((resolve, reject) => {
        regedit.list([keyPath], (err, result) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(result[keyPath]);
        });
    });
}

/**
 * 写入注册表值
 */
async function writeRegistryKey(keyPath, values) {
    return new Promise((resolve, reject) => {
        regedit.putValue({
            [keyPath]: values
        }, (err) => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
}

/**
 * 删除注册表键
 */
async function deleteRegistryKey(keyPath) {
    return new Promise((resolve, reject) => {
        regedit.deleteKey([keyPath], (err) => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
}
```

### 3.3 企业微信调试标志

```javascript
// 设置企业微信调试标志（用于逆向注入）

const WXWORK_IFEO_KEY = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\WXWork.exe';

/**
 * 启用企业微信调试模式
 */
async function enableWXWorkDebug() {
    await writeRegistryKey(WXWORK_IFEO_KEY, {
        GlobalFlag: {
            value: 0x00000200,
            type: 'REG_DWORD'
        }
    });
    console.log('[Registry] 企业微信调试模式已启用');
}

/**
 * 禁用企业微信调试模式
 */
async function disableWXWorkDebug() {
    await deleteRegistryKey(WXWORK_IFEO_KEY);
    console.log('[Registry] 企业微信调试模式已禁用');
}
```

### 3.4 获取微信安装路径

```javascript
// 从注册表读取微信安装路径

const WECHAT_UNINSTALL_KEY = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\WeChat';

async function getWeChatInstallPath() {
    try {
        const result = await readRegistryKey(WECHAT_UNINSTALL_KEY);

        if (result && result.values && result.values.InstallLocation) {
            return result.values.InstallLocation.value;
        }

        return null;
    } catch (error) {
        console.error('[Registry] 获取微信路径失败:', error);
        return null;
    }
}
```

---

## 四、regedit 库详解

### 4.1 读取注册表

```javascript
const regedit = require('regedit');

// 读取单个键
regedit.list(['HKCU\\Software\\Microsoft'], (err, result) => {
    console.log(result);
    // {
    //   'HKCU\\Software\\Microsoft': {
    //     exists: true,
    //     keys: ['Windows', 'Office', ...],
    //     values: { ... }
    //   }
    // }
});

// 读取多个键
regedit.list([
    'HKCU\\Software\\App1',
    'HKCU\\Software\\App2'
], (err, result) => {
    console.log(result);
});
```

### 4.2 写入注册表

```javascript
// 写入值
regedit.putValue({
    'HKCU\\Software\\MyApp': {
        // 字符串值
        Name: {
            value: 'MyApplication',
            type: 'REG_SZ'
        },
        // 整数值
        Version: {
            value: 1,
            type: 'REG_DWORD'
        },
        // 二进制值
        Data: {
            value: [0x01, 0x02, 0x03],
            type: 'REG_BINARY'
        }
    }
}, (err) => {
    if (err) console.error('写入失败:', err);
    else console.log('写入成功');
});
```

### 4.3 创建键

```javascript
// 创建注册表键
regedit.createKey([
    'HKCU\\Software\\MyApp',
    'HKCU\\Software\\MyApp\\Settings'
], (err) => {
    if (err) console.error('创建失败:', err);
    else console.log('创建成功');
});
```

### 4.4 删除键和值

```javascript
// 删除值
regedit.deleteValue([
    'HKCU\\Software\\MyApp\\Name'
], (err) => {
    if (err) console.error('删除值失败:', err);
});

// 删除键（包括所有子键和值）
regedit.deleteKey([
    'HKCU\\Software\\MyApp'
], (err) => {
    if (err) console.error('删除键失败:', err);
});
```

---

## 五、winreg 库详解

### 5.1 基本使用

```javascript
const Registry = require('winreg');

// 创建注册表对象
const regKey = new Registry({
    hive: Registry.HKCU,
    key: '\\Software\\MyApp'
});

// 读取所有值
regKey.values((err, items) => {
    items.forEach(item => {
        console.log(`${item.name}: ${item.value}`);
    });
});

// 读取单个值
regKey.get('Name', (err, item) => {
    console.log('Name:', item.value);
});
```

### 5.2 写入值

```javascript
// 设置字符串值
regKey.set('Name', Registry.REG_SZ, 'MyApplication', (err) => {
    if (err) console.error('设置失败:', err);
});

// 设置整数值
regKey.set('Version', Registry.REG_DWORD, 1, (err) => {
    if (err) console.error('设置失败:', err);
});
```

### 5.3 枚举子键

```javascript
// 获取所有子键
regKey.keys((err, keys) => {
    keys.forEach(key => {
        console.log('子键:', key.key);
    });
});
```

---

## 六、常见应用场景

### 6.1 开机自启动

```javascript
const STARTUP_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

// 添加开机启动
async function addToStartup(appName, exePath) {
    await writeRegistryKey(STARTUP_KEY, {
        [appName]: {
            value: `"${exePath}"`,
            type: 'REG_SZ'
        }
    });
}

// 移除开机启动
async function removeFromStartup(appName) {
    // 使用 deleteValue
    return new Promise((resolve, reject) => {
        regedit.deleteValue([`${STARTUP_KEY}\\${appName}`], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}
```

### 6.2 文件关联

```javascript
// 注册自定义协议处理器
const PROTOCOL_KEY = 'HKCU\\Software\\Classes\\myapp';

async function registerProtocol(exePath) {
    // 1. 创建协议键
    await writeRegistryKey(PROTOCOL_KEY, {
        '': {
            value: 'URL:MyApp Protocol',
            type: 'REG_SZ'
        },
        'URL Protocol': {
            value: '',
            type: 'REG_SZ'
        }
    });

    // 2. 设置命令
    await writeRegistryKey(`${PROTOCOL_KEY}\\shell\\open\\command`, {
        '': {
            value: `"${exePath}" "%1"`,
            type: 'REG_SZ'
        }
    });
}
```

### 6.3 读取系统信息

```javascript
// 读取 Windows 版本
const OS_KEY = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion';

async function getWindowsVersion() {
    const result = await readRegistryKey(OS_KEY);
    return {
        productName: result.values.ProductName?.value,
        currentBuild: result.values.CurrentBuild?.value,
        displayVersion: result.values.DisplayVersion?.value
    };
}
```

---

## 七、权限问题

### 7.1 UAC 提权

```javascript
// HKLM 需要管理员权限
// 如果没有权限，会报错

try {
    await writeRegistryKey('HKLM\\...', values);
} catch (error) {
    if (error.message.includes('Access is denied')) {
        console.error('需要管理员权限');
        // 可以提示用户以管理员身份运行
    }
}
```

### 7.2 使用 sudo-prompt

```javascript
const sudo = require('sudo-prompt');

function runAsAdmin(command) {
    return new Promise((resolve, reject) => {
        sudo.exec(command, { name: 'MyApp' }, (err, stdout, stderr) => {
            if (err) reject(err);
            else resolve(stdout);
        });
    });
}
```

---

## 八、注意事项

### 8.1 打包配置

```yaml
# electron-builder 配置
extraResources:
  - from: "node_modules/regedit/vbs"
    to: "vbs"
    filter:
      - "**/*"
```

```javascript
// 运行时设置 VBS 路径
const { app } = require('electron');
const path = require('path');

if (app.isPackaged) {
    regedit.setExternalVBSLocation(
        path.join(process.resourcesPath, 'vbs')
    );
}
```

### 8.2 32/64 位注册表

```javascript
// 64位系统上，32位程序访问的注册表会被重定向
// HKLM\SOFTWARE → HKLM\SOFTWARE\WOW6432Node

// 明确指定访问原始位置
const KEY_WOW64_64KEY = 0x0100;

// 或使用正确的路径
const key32 = 'HKLM\\SOFTWARE\\WOW6432Node\\MyApp';
const key64 = 'HKLM\\SOFTWARE\\MyApp';
```

### 8.3 错误处理

```javascript
async function safeReadRegistry(keyPath) {
    try {
        return await readRegistryKey(keyPath);
    } catch (error) {
        if (error.message.includes('does not exist')) {
            return null;  // 键不存在
        }
        throw error;
    }
}
```

---

## 九、与 React 开发对比

### 9.1 前端无法访问

```javascript
// 浏览器/React 无法访问系统注册表
// 这是操作系统级别的操作

// 只能通过后端或 Electron 主进程实现
```

### 9.2 Electron 中使用

```javascript
// 主进程
const { ipcMain } = require('electron');

ipcMain.handle('read-registry', async (event, keyPath) => {
    return await readRegistryKey(keyPath);
});

// 渲染进程
const { ipcRenderer } = require('electron');

const result = await ipcRenderer.invoke('read-registry', 'HKCU\\Software\\MyApp');
```
