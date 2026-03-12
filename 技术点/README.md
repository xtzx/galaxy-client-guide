# 技术点详解

> 面向 React 前端开发者的技术栈说明

---

## 文档索引

本目录包含项目中使用的各种技术点详解，帮助 React 前端开发者快速理解 Electron/Node.js 开发中的常用技术。

---

### 📋 依赖与风险

| 文档 | 说明 |
|-----|-----|
| [00-依赖总览与版本风险.md](./00-依赖总览与版本风险.md) | 🆕 项目所有依赖分类与版本风险评估 |

---

### 📦 基础技术

| 文档 | 说明 |
|-----|-----|
| [01-Electron基础.md](./01-Electron基础.md) | Electron 框架核心概念 |
| [02-Windows平台能力.md](./02-Windows平台能力.md) | ffi-napi、注册表、进程管理概述 |
| [03-IPC进程通信.md](./03-IPC进程通信.md) | 与逆向服务的命名管道通信 |
| [04-MQTT消息队列.md](./04-MQTT消息队列.md) | 与云端的消息队列通信 |

---

### 🖥️ 02-Windows平台能力（详细）

| 文档 | 说明 |
|-----|-----|
| [01-ffi-napi详解.md](./02-Windows平台能力/01-ffi-napi详解.md) | 🆕 Node.js 调用原生 DLL 核心技术 |
| [02-Windows注册表操作.md](./02-Windows平台能力/02-Windows注册表操作.md) | 🆕 注册表读写详细操作 |
| [03-Windows进程与系统信息.md](./02-Windows平台能力/03-Windows进程与系统信息.md) | 🆕 进程管理与系统监控 |

---

### 💾 05-数据存储

| 文档 | 说明 | React 中类似概念 |
|-----|-----|----------------|
| [01-SQLite与Sequelize.md](./05-数据存储/01-SQLite与Sequelize.md) | 本地嵌入式数据库 | IndexedDB |
| [02-electron-store.md](./05-数据存储/02-electron-store.md) | 键值对持久化存储 | LocalStorage |

---

### 📂 06-文件处理

| 文档 | 说明 | React 中类似概念 |
|-----|-----|----------------|
| [01-fluent-ffmpeg.md](./06-文件处理/01-fluent-ffmpeg.md) | 视频处理（缩略图、转码） | - |
| [02-sharp图片处理.md](./06-文件处理/02-sharp图片处理.md) | 图片压缩、格式转换 | Canvas API |
| [03-ali-oss云存储.md](./06-文件处理/03-ali-oss云存储.md) | 阿里云对象存储 | 前端直传 OSS |
| [04-fs-extra文件操作.md](./06-文件处理/04-fs-extra文件操作.md) | 文件系统操作增强 | File API |
| [05-crypto-js加密.md](./06-文件处理/05-crypto-js加密.md) | 加密算法库 | Web Crypto API |

---

### ⚡ 07-并发与异步

| 文档 | 说明 | React 中类似概念 |
|-----|-----|----------------|
| [01-async-lock并发控制.md](./07-并发与异步/01-async-lock并发控制.md) | 异步锁管理 | loading 状态 |
| [02-worker-threads工作线程.md](./07-并发与异步/02-worker-threads工作线程.md) | 🆕 多线程并行计算 | Web Worker |

---

### 📊 08-日志监控

| 文档 | 说明 | React 中类似概念 |
|-----|-----|----------------|
| [01-electron-log日志.md](./08-日志监控/01-electron-log日志.md) | 本地日志记录 | console.log |
| [02-ali-sls阿里云日志.md](./08-日志监控/02-ali-sls阿里云日志.md) | 云端日志上报 | Sentry |
| [03-性能监控.md](./08-日志监控/03-性能监控.md) | CPU/内存监控 | Performance API |

---

### 📦 09-构建部署

| 文档 | 说明 | React 中类似概念 |
|-----|-----|----------------|
| [01-electron-builder打包.md](./09-构建部署/01-electron-builder打包.md) | 应用打包发布 | npm run build |
| [02-electron-updater自动更新.md](./09-构建部署/02-electron-updater自动更新.md) | 应用自动更新 | Service Worker |

---

### 🔄 10-数据解析

| 文档 | 说明 | React 中类似概念 |
|-----|-----|----------------|
| [01-fast-xml-parser.md](./10-数据解析/01-fast-xml-parser.md) | XML 解析器 | DOMParser |
| [02-node-cron定时任务.md](./10-数据解析/02-node-cron定时任务.md) | Cron 定时任务 | setInterval |
| [03-ws-WebSocket.md](./10-数据解析/03-ws-WebSocket.md) | WebSocket 服务端 | WebSocket 客户端 |

---

## 快速导航

### 按场景查找

| 场景 | 推荐文档 |
|-----|---------|
| 需要存储数据 | SQLite 或 electron-store |
| 需要处理图片 | sharp |
| 需要处理视频 | fluent-ffmpeg |
| 需要上传文件 | ali-oss |
| 需要加密数据 | crypto-js |
| 需要记录日志 | electron-log |
| 需要监控性能 | 性能监控 |
| 需要定时执行 | node-cron |
| 需要打包应用 | electron-builder |
| 需要自动更新 | electron-updater |

### 与 React 开发对比

每个技术点文档都包含"与 React 开发对比"章节，帮助你快速理解：

- **LocalStorage** → **electron-store**：持久化存储
- **IndexedDB** → **SQLite + Sequelize**：结构化数据
- **File API** → **fs-extra**：文件操作
- **Canvas** → **sharp**：图片处理
- **Performance API** → **pidusage**：性能监控
- **setInterval** → **node-cron**：定时任务
- **WebSocket 客户端** → **ws 服务端**：WebSocket

---

## 学习建议

### 优先级高（常用）

1. **electron-store** - 最简单的数据存储
2. **fs-extra** - 文件操作必备
3. **electron-log** - 日志记录
4. **crypto-js** - 加密常用

### 优先级中（特定场景）

5. **SQLite + Sequelize** - 大量数据存储
6. **ali-oss** - 文件上传
7. **sharp** - 图片处理
8. **ws** - WebSocket

### 优先级低（了解即可）

9. **fluent-ffmpeg** - 视频处理
10. **async-lock** - 并发控制
11. **worker-threads** - 多线程（CPU密集型任务）
12. **node-cron** - 定时任务
13. **electron-builder/updater** - 打包发布

---

*文档持续更新中，如有问题请联系项目负责人。*
