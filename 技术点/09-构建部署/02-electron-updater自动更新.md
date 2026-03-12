# electron-updater 自动更新

> Electron 应用自动更新

---

## 一、技术简介

### 1.1 什么是 electron-updater

`electron-updater` 是 electron-builder 配套的自动更新模块：

- **差量更新**：只下载变化的部分
- **后台下载**：不影响用户使用
- **多平台**：Windows、macOS、Linux
- **多来源**：HTTP、S3、GitHub

### 1.2 更新流程

```
┌─────────────────────────────────────────────────────────────────┐
│                    自动更新流程                                  │
└─────────────────────────────────────────────────────────────────┘

应用启动
   │
   ▼
检查更新 ────────────► 无更新 ────► 正常运行
   │
   ▼ 有更新
下载更新包
   │
   ▼
下载完成
   │
   ▼
提示用户 ────────────► 稍后 ────► 下次启动时提示
   │
   ▼ 立即安装
退出并安装
   │
   ▼
启动新版本
```

---

## 二、项目中的使用

### 2.1 使用位置

```
src/event/updater.js    # 自动更新逻辑
```

### 2.2 完整实现

```javascript
// src/event/updater.js

const { autoUpdater } = require('electron-updater');
const { ipcMain, dialog, BrowserWindow } = require('electron');
const log = require('electron-log');

// 配置日志
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

// 禁用自动下载（手动控制）
autoUpdater.autoDownload = false;

// 允许降级（测试用）
autoUpdater.allowDowngrade = false;

/**
 * 初始化自动更新
 */
function initUpdater() {
    // 设置更新服务器地址
    autoUpdater.setFeedURL({
        provider: 'generic',
        url: 'https://update.example.com/releases/'
    });

    // 监听更新事件
    setupEventListeners();

    // 启动时检查更新
    setTimeout(() => {
        checkForUpdates();
    }, 10000);  // 延迟10秒，等应用稳定
}

/**
 * 检查更新
 */
async function checkForUpdates() {
    try {
        log.info('[Updater] 检查更新...');
        await autoUpdater.checkForUpdates();
    } catch (error) {
        log.error('[Updater] 检查更新失败:', error);
    }
}

/**
 * 设置事件监听
 */
function setupEventListeners() {
    // 检查到更新
    autoUpdater.on('update-available', (info) => {
        log.info('[Updater] 发现新版本:', info.version);

        // 通知渲染进程
        const win = BrowserWindow.getFocusedWindow();
        if (win) {
            win.webContents.send('update-available', info);
        }

        // 询问用户
        dialog.showMessageBox({
            type: 'info',
            title: '发现新版本',
            message: `发现新版本 ${info.version}，是否下载更新？`,
            buttons: ['下载', '稍后']
        }).then(({ response }) => {
            if (response === 0) {
                autoUpdater.downloadUpdate();
            }
        });
    });

    // 没有更新
    autoUpdater.on('update-not-available', () => {
        log.info('[Updater] 当前已是最新版本');
    });

    // 下载进度
    autoUpdater.on('download-progress', (progress) => {
        log.info(`[Updater] 下载进度: ${Math.round(progress.percent)}%`);

        const win = BrowserWindow.getFocusedWindow();
        if (win) {
            win.webContents.send('download-progress', progress);
        }
    });

    // 下载完成
    autoUpdater.on('update-downloaded', (info) => {
        log.info('[Updater] 更新下载完成');

        dialog.showMessageBox({
            type: 'info',
            title: '更新就绪',
            message: '更新已下载完成，是否立即重启安装？',
            buttons: ['立即安装', '稍后']
        }).then(({ response }) => {
            if (response === 0) {
                autoUpdater.quitAndInstall();
            }
        });
    });

    // 错误处理
    autoUpdater.on('error', (error) => {
        log.error('[Updater] 更新错误:', error);
    });
}

// IPC：手动检查更新
ipcMain.handle('check-for-updates', async () => {
    await checkForUpdates();
});

// IPC：下载更新
ipcMain.handle('download-update', async () => {
    await autoUpdater.downloadUpdate();
});

// IPC：安装更新
ipcMain.handle('install-update', () => {
    autoUpdater.quitAndInstall();
});

module.exports = { initUpdater, checkForUpdates };
```

---

## 三、服务器端配置

### 3.1 更新文件结构

```
https://update.example.com/releases/
├── latest.yml              # Windows 更新清单
├── latest-mac.yml          # macOS 更新清单
├── galaxy-client-1.0.0.exe # Windows 安装包
├── galaxy-client-1.0.0.exe.blockmap  # 差量更新用
└── galaxy-client-1.0.0.dmg # macOS 安装包
```

### 3.2 latest.yml 格式

```yaml
version: 1.0.0
files:
  - url: galaxy-client-1.0.0.exe
    sha512: abc123...
    size: 123456789
path: galaxy-client-1.0.0.exe
sha512: abc123...
releaseDate: '2024-01-22T00:00:00.000Z'
```

### 3.3 Nginx 配置

```nginx
server {
    listen 80;
    server_name update.example.com;

    location /releases/ {
        alias /var/www/releases/;
        autoindex on;

        # CORS（如果需要）
        add_header Access-Control-Allow-Origin *;
    }
}
```

---

## 四、常用 API

### 4.1 autoUpdater 方法

```javascript
const { autoUpdater } = require('electron-updater');

// 设置更新源
autoUpdater.setFeedURL({
    provider: 'generic',
    url: 'https://update.example.com/'
});

// 检查更新
autoUpdater.checkForUpdates();

// 检查并下载
autoUpdater.checkForUpdatesAndNotify();

// 下载更新
autoUpdater.downloadUpdate();

// 退出并安装
autoUpdater.quitAndInstall();
```

### 4.2 autoUpdater 属性

```javascript
// 自动下载
autoUpdater.autoDownload = false;

// 自动安装退出时
autoUpdater.autoInstallOnAppQuit = true;

// 允许降级
autoUpdater.allowDowngrade = false;

// 当前版本
autoUpdater.currentVersion;
```

### 4.3 事件

```javascript
// 检查更新中
autoUpdater.on('checking-for-update', () => {});

// 有更新
autoUpdater.on('update-available', (info) => {
    console.log(info.version);
    console.log(info.releaseNotes);
});

// 无更新
autoUpdater.on('update-not-available', () => {});

// 下载进度
autoUpdater.on('download-progress', (progress) => {
    console.log(progress.percent);
    console.log(progress.bytesPerSecond);
    console.log(progress.transferred);
    console.log(progress.total);
});

// 下载完成
autoUpdater.on('update-downloaded', (info) => {});

// 错误
autoUpdater.on('error', (error) => {});
```

---

## 五、差量更新

### 5.1 工作原理

```
全量更新：下载整个安装包（100MB）

差量更新（blockmap）：
┌─────────────────────────────────────────────────────────────────┐
│ 旧版本        │ Block1 │ Block2 │ Block3 │ Block4 │            │
│              │   ✓    │   ✗    │   ✓    │   ✗    │            │
│ 新版本        │ Block1 │ Block2'│ Block3 │ Block4'│            │
│              │  跳过  │  下载   │  跳过  │  下载   │            │
└─────────────────────────────────────────────────────────────────┘
只下载变化的 Block（例如 20MB）
```

### 5.2 生成 blockmap

```yaml
# electron-builder 会自动生成
# 输出：xxx.exe.blockmap
```

---

## 六、灰度发布

### 6.1 分阶段发布

```javascript
// 服务器端控制
async function checkForUpdates() {
    // 获取当前用户信息
    const userId = store.getUserId();

    // 请求服务器（带用户信息）
    autoUpdater.setFeedURL({
        provider: 'generic',
        url: `https://update.example.com/releases/?userId=${userId}`
    });

    await autoUpdater.checkForUpdates();
}
```

### 6.2 服务器端逻辑

```javascript
// 服务器判断是否返回新版本
app.get('/releases/latest.yml', (req, res) => {
    const userId = req.query.userId;

    // 10% 用户先升级
    if (parseInt(userId, 16) % 10 === 0) {
        res.sendFile('/releases/v2.0.0/latest.yml');
    } else {
        res.sendFile('/releases/v1.0.0/latest.yml');
    }
});
```

---

## 七、与 React 开发对比

### 7.1 前端更新

```javascript
// React 前端：用户刷新页面即可获取最新版本
// 或使用 Service Worker 缓存更新
```

### 7.2 关键区别

```
┌─────────────────────────────────────────────────────────────────┐
│                    前端 vs Electron 更新                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  React 前端：                                                   │
│  - 刷新页面获取最新版本                                         │
│  - Service Worker 后台更新                                      │
│  - 无需用户操作                                                 │
│                                                                 │
│  Electron 应用：                                                │
│  - 需要下载完整安装包                                           │
│  - 需要重启应用                                                 │
│  - 需要管理员权限（某些情况）                                    │
│  - 需要考虑网络和存储空间                                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 八、调试技巧

### 8.1 本地测试更新

```javascript
// 开发环境跳过签名检查
if (process.env.NODE_ENV === 'development') {
    autoUpdater.updateConfigPath = path.join(__dirname, 'dev-app-update.yml');
}
```

```yaml
# dev-app-update.yml
provider: generic
url: http://localhost:8080/releases/
```

### 8.2 日志查看

```javascript
autoUpdater.logger = require('electron-log');
autoUpdater.logger.transports.file.level = 'debug';

// 日志位置：
// Windows: %USERPROFILE%\AppData\Roaming\{app}\logs\
```

### 8.3 常见问题

```javascript
// 问题：检测不到更新
// 检查：版本号是否正确递增
// 检查：latest.yml 的 version 字段

// 问题：下载失败
// 检查：网络连接
// 检查：服务器 CORS 设置
// 检查：文件 hash 是否匹配

// 问题：安装失败
// 检查：Windows 权限
// 检查：安装包是否损坏
```
