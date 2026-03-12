# 打包与 asar 机制

> 理解 Electron 应用的打包流程和 asar 归档格式

---

## 一、Electron 打包流程

### 1.1 从源码到可运行程序

```
┌─────────────────────────────────────────────────────────────────┐
│                    Electron 打包流程                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  源代码                                                         │
│  ├── src/main/        主进程代码                                │
│  ├── src/renderer/    渲染进程代码                               │
│  └── src/preload/     Preload 脚本                              │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    1. 构建阶段                            │   │
│  │  ├── TypeScript → JavaScript                             │   │
│  │  ├── Vite/Webpack → 静态资源                              │   │
│  │  └── 输出到 dist/                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    2. 打包阶段                            │   │
│  │  ├── 收集应用文件                                         │   │
│  │  ├── 处理 node_modules                                    │   │
│  │  ├── asar 归档                                            │   │
│  │  ├── 合并 Electron 二进制                                  │   │
│  │  └── native modules rebuild                               │   │
│  └─────────────────────────────────────────────────────────┘   │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    3. 制作安装包                          │   │
│  │  ├── NSIS / DMG / AppImage                                │   │
│  │  ├── 代码签名                                             │   │
│  │  └── 生成更新清单                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│       │                                                         │
│       ▼                                                         │
│  最终产物                                                       │
│  ├── MyApp-Setup.exe                                           │
│  ├── MyApp.dmg                                                 │
│  └── MyApp.AppImage                                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Electron Runtime 打包

electron-builder 会下载对应版本的 Electron 预编译二进制，然后将应用代码合并：

```
Electron 预编译包
├── electron.exe                  # Windows 可执行文件
├── electron                      # macOS/Linux 可执行文件
├── resources/
│   └── default_app.asar          # 默认应用（会被替换）
└── 其他运行时文件...

                ↓ 合并你的应用

最终应用
├── MyApp.exe                     # 重命名后的可执行文件
├── resources/
│   ├── app.asar                  # 你的应用代码
│   └── app.asar.unpacked/        # 解压的文件（native modules）
└── 其他运行时文件...
```

---

## 二、asar 归档格式

### 2.1 什么是 asar

asar (Atom Shell Archive) 是 Electron 专用的归档格式：

```
┌─────────────────────────────────────────────────────────────────┐
│                    asar 格式结构                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  app.asar 文件结构：                                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Header (JSON)                                           │   │
│  │  ├── 文件列表                                            │   │
│  │  ├── 文件大小                                            │   │
│  │  └── 偏移量                                              │   │
│  ├─────────────────────────────────────────────────────────│   │
│  │  File Contents                                           │   │
│  │  ├── index.js 内容                                       │   │
│  │  ├── package.json 内容                                   │   │
│  │  └── 其他文件内容...                                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  特点：                                                         │
│  ├── 类似 tar，不压缩                                          │
│  ├── 支持随机访问（通过偏移量）                                 │
│  ├── Node.js 可直接 require                                    │
│  └── 文件系统 API 透明访问                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 asar 工具使用

```bash
# 安装 asar 命令行工具
npm install -g @electron/asar

# 查看 asar 内容
asar list app.asar

# 提取 asar
asar extract app.asar ./extracted

# 打包目录为 asar
asar pack ./app app.asar

# 查看特定文件
asar extract-file app.asar package.json
```

### 2.3 asar 优缺点

```
┌─────────────────────────────────────────────────────────────────┐
│                    asar 优缺点分析                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  优点：                                                         │
│  ✓ 解决 Windows 路径长度限制（260字符）                         │
│    node_modules 路径经常超长，asar 内部不受此限制               │
│                                                                 │
│  ✓ 一定程度防止简单查看/篡改                                    │
│    不像普通目录那样直接暴露源码                                  │
│                                                                 │
│  ✓ 文件组织更整洁                                               │
│    单个文件替代数千个小文件                                      │
│                                                                 │
│  ✓ 略微加快文件读取                                             │
│    减少文件系统 I/O 开销                                        │
│                                                                 │
│  ────────────────────────────────────────────                   │
│                                                                 │
│  缺点/限制：                                                    │
│  ✗ Native 模块无法在 asar 中运行                                │
│    .node 文件需要 asarUnpack                                    │
│                                                                 │
│  ✗ 需要动态执行的文件需要解压                                   │
│    child_process.execFile 等需要真实文件                        │
│                                                                 │
│  ✗ 不是真正的加密/保护                                          │
│    可以轻易解包查看，仅是"障碍"                                 │
│                                                                 │
│  ✗ 某些文件系统操作需要特殊处理                                 │
│    如 fs.watch、某些路径判断                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 三、asarUnpack 详解

### 3.1 为什么需要 unpack

某些文件无法在 asar 虚拟文件系统中工作：

```javascript
// 这些场景需要 unpack：

// 1. Native 模块（.node 文件）
const sqlite = require('better-sqlite3')  // 内部加载 .node

// 2. 使用 execFile 执行的程序
const { execFile } = require('child_process')
execFile('/path/to/binary', [])  // 需要真实文件

// 3. 动态加载的 DLL/dylib
const ffi = require('ffi-napi')
ffi.Library('/path/to/lib.dll', {})

// 4. 某些第三方库的特殊要求
const sharp = require('sharp')  // 内部使用动态库
```

### 3.2 配置 asarUnpack

```yaml
# electron-builder.yml

asar: true

asarUnpack:
  # 所有 .node 文件
  - "**/*.node"
  
  # 动态库
  - "**/*.dll"
  - "**/*.dylib"
  - "**/*.so"
  - "**/*.so.*"
  
  # 可执行文件
  - "**/*.exe"
  - "**/bin/*"
  
  # 特定模块
  - "**/node_modules/sharp/**"
  - "**/node_modules/better-sqlite3/**"
  - "**/node_modules/sqlite3/**"
  - "**/node_modules/node-pty/**"
  - "**/node_modules/ffi-napi/**"
  - "**/node_modules/ref-napi/**"
  
  # 需要动态加载的资源
  - "**/resources/bin/**"
```

### 3.3 unpack 后的目录结构

```
resources/
├── app.asar                 # 主归档
└── app.asar.unpacked/       # 解压的文件
    └── node_modules/
        ├── sharp/
        │   └── build/
        │       └── Release/
        │           └── sharp-darwin-x64.node
        └── better-sqlite3/
            └── build/
                └── Release/
                    └── better_sqlite3.node
```

### 3.4 代码中访问 unpack 文件

```javascript
const path = require('path')
const { app } = require('electron')

function getUnpackedPath(relativePath) {
  if (app.isPackaged) {
    // 生产环境：从 app.asar.unpacked 获取
    const basePath = path.dirname(app.getAppPath())
    return path.join(basePath, 'app.asar.unpacked', relativePath)
  } else {
    // 开发环境：直接使用
    return path.join(__dirname, relativePath)
  }
}

// 示例：访问可执行文件
const ffmpegPath = getUnpackedPath('resources/bin/ffmpeg.exe')
```

---

## 四、资源路径处理

### 4.1 关键路径 API

```javascript
const { app } = require('electron')
const path = require('path')

// 应用路径（asar 内）
const appPath = app.getAppPath()
// 开发: /path/to/project
// 生产: /path/to/resources/app.asar

// 资源目录
const resourcesPath = process.resourcesPath
// 生产: /path/to/resources

// 可执行文件路径
const exePath = app.getPath('exe')
// 生产: /path/to/MyApp.exe

// 用户数据目录
const userDataPath = app.getPath('userData')
// Windows: C:\Users\xxx\AppData\Roaming\MyApp
// macOS: ~/Library/Application Support/MyApp
// Linux: ~/.config/MyApp

// 临时目录
const tempPath = app.getPath('temp')

// 桌面路径
const desktopPath = app.getPath('desktop')
```

### 4.2 开发/生产环境统一处理

```javascript
// utils/paths.js

const { app } = require('electron')
const path = require('path')

const isDev = !app.isPackaged

// 静态资源路径
function getStaticPath(relativePath) {
  if (isDev) {
    return path.join(__dirname, '..', relativePath)
  }
  return path.join(process.resourcesPath, relativePath)
}

// 应用内资源路径（在 asar 中）
function getAppPath(relativePath) {
  return path.join(app.getAppPath(), relativePath)
}

// 需要真实文件的资源路径
function getRealPath(relativePath) {
  if (isDev) {
    return path.join(__dirname, '..', relativePath)
  }
  // 生产环境从 unpacked 获取
  const basePath = path.dirname(app.getAppPath())
  return path.join(basePath, 'app.asar.unpacked', relativePath)
}

// 用户数据路径
function getUserDataPath(relativePath) {
  return path.join(app.getPath('userData'), relativePath)
}

module.exports = {
  isDev,
  getStaticPath,
  getAppPath,
  getRealPath,
  getUserDataPath
}
```

### 4.3 __dirname 在打包后的行为

```javascript
// 开发环境
__dirname === '/path/to/project/src/main'

// 生产环境（asar 打包后）
__dirname === '/path/to/resources/app.asar/src/main'
// 注意：这是虚拟路径！

// 正确的做法：使用 app API
const basePath = app.isPackaged 
  ? path.dirname(app.getAppPath())
  : path.join(__dirname, '..')
```

---

## 五、打包配置详解

### 5.1 files 配置

控制哪些文件打包进 asar：

```yaml
# electron-builder.yml

files:
  # 包含的文件/目录
  - "dist/**/*"           # 构建输出
  - "package.json"        # 必须包含
  - "node_modules/**/*"   # 依赖
  
  # 排除的文件（使用 ! 前缀）
  - "!**/*.ts"            # TypeScript 源文件
  - "!**/*.tsx"
  - "!**/*.map"           # Source Map
  - "!**/*.md"            # 文档
  - "!**/CHANGELOG*"
  - "!**/README*"
  - "!**/LICENSE*"
  
  # 排除 node_modules 中的无用文件
  - "!**/node_modules/*/{test,tests,__tests__}/**"
  - "!**/node_modules/*/{example,examples}/**"
  - "!**/node_modules/*/{doc,docs}/**"
  - "!**/node_modules/**/*.{md,markdown}"
  - "!**/node_modules/.bin/**"
  - "!**/{.git,.github,.gitignore}"
  - "!**/{.eslintrc,.prettierrc}*"
  - "!**/tsconfig*.json"
```

### 5.2 extraFiles vs extraResources

```yaml
# extraFiles: 复制到安装目录根目录
# Windows: C:\Program Files\MyApp\
# macOS: /Applications/MyApp.app/Contents/
extraFiles:
  - from: "bin/"
    to: "bin/"
    filter:
      - "**/*"

# extraResources: 复制到 resources 目录
# Windows: C:\Program Files\MyApp\resources\
# macOS: /Applications/MyApp.app/Contents/Resources/
extraResources:
  - from: "assets/"
    to: "assets/"
  - from: "config/default.json"
    to: "config/default.json"
```

```javascript
// 访问 extraResources
const resourcePath = path.join(process.resourcesPath, 'assets/image.png')

// 访问 extraFiles
const binPath = path.join(path.dirname(process.execPath), 'bin/tool.exe')
```

### 5.3 目录结构示例

```
打包后的 Windows 应用：
MyApp/
├── MyApp.exe                    # 主程序
├── resources/
│   ├── app.asar                 # 应用代码
│   ├── app.asar.unpacked/       # 解压的 native 模块
│   │   └── node_modules/
│   │       └── better-sqlite3/
│   ├── assets/                  # extraResources
│   │   └── image.png
│   └── config/
│       └── default.json
├── bin/                         # extraFiles
│   └── ffmpeg.exe
└── 其他 Electron 运行时文件...

打包后的 macOS 应用：
MyApp.app/
└── Contents/
    ├── MacOS/
    │   └── MyApp                # 主程序
    ├── Resources/
    │   ├── app.asar
    │   ├── app.asar.unpacked/
    │   ├── assets/              # extraResources
    │   └── config/
    ├── Frameworks/              # Electron 框架
    └── Info.plist
```

---

## 六、特殊情况处理

### 6.1 动态 require

```javascript
// 问题：动态 require 路径在打包后可能失效

// 不推荐
const module = require(`./plugins/${pluginName}`)

// 推荐：使用完整路径或映射
const plugins = {
  'plugin-a': require('./plugins/plugin-a'),
  'plugin-b': require('./plugins/plugin-b')
}
const module = plugins[pluginName]

// 或者使用 extraResources + 动态加载
const pluginPath = path.join(process.resourcesPath, 'plugins', `${pluginName}.js`)
const module = require(pluginPath)
```

### 6.2 fs.watch 限制

```javascript
// asar 内的文件不支持 fs.watch
const fs = require('fs')
const { app } = require('electron')

const filePath = path.join(app.getAppPath(), 'config.json')

// 这在 asar 中不工作
fs.watch(filePath, () => {})  // 可能报错或静默失败

// 解决：将需要 watch 的文件放到 userData 或 extraResources
const configPath = path.join(app.getPath('userData'), 'config.json')
fs.watch(configPath, () => {})  // 正常工作
```

### 6.3 判断路径是否在 asar 中

```javascript
const path = require('path')

function isInsideAsar(filePath) {
  return filePath.includes('.asar' + path.sep) || 
         filePath.includes('.asar/')
}

function getRealFilePath(filePath) {
  if (isInsideAsar(filePath)) {
    return filePath.replace('.asar', '.asar.unpacked')
  }
  return filePath
}
```

---

## 七、禁用 asar

某些情况可能需要禁用 asar：

```yaml
# electron-builder.yml

# 完全禁用 asar
asar: false

# 调试时禁用（仅生成目录）
# npx electron-builder --dir --config.asar=false
```

**禁用 asar 的场景**：
- 调试打包问题
- 应用有大量动态加载需求
- 性能测试对比

**注意**：禁用 asar 会暴露源码，且可能遇到 Windows 路径长度问题。

---

## 八、完整配置示例

```yaml
# electron-builder.yml

appId: com.example.myapp
productName: My Application

# asar 配置
asar: true
asarUnpack:
  - "**/*.node"
  - "**/*.dll"
  - "**/*.dylib"
  - "**/*.so"
  - "**/node_modules/sharp/**"
  - "**/node_modules/better-sqlite3/**"
  - "**/resources/bin/**"

# 文件包含/排除
files:
  - "dist/**/*"
  - "package.json"
  - "!**/*.ts"
  - "!**/*.map"
  - "!**/node_modules/**/*.md"
  - "!**/node_modules/*/{test,tests,docs}/**"

# 额外资源
extraResources:
  - from: "resources/"
    to: "."
    filter:
      - "**/*"
      - "!**/*.md"

extraFiles:
  - from: "bin/${os}/"
    to: "bin/"
    filter:
      - "**/*"

# 目录配置
directories:
  output: release
  buildResources: build

# 压缩
compression: normal
```

```javascript
// src/main/paths.js - 路径工具

const { app } = require('electron')
const path = require('path')

const isPacked = app.isPackaged

module.exports = {
  // 应用根路径
  appRoot: app.getAppPath(),
  
  // 资源路径
  resources: process.resourcesPath,
  
  // 用户数据
  userData: app.getPath('userData'),
  
  // 获取 extraResources 中的文件
  getResource(relativePath) {
    return path.join(process.resourcesPath, relativePath)
  },
  
  // 获取 extraFiles 中的文件
  getExtraFile(relativePath) {
    return path.join(path.dirname(process.execPath), relativePath)
  },
  
  // 获取 unpack 的文件
  getUnpacked(relativePath) {
    if (!isPacked) {
      return path.join(__dirname, '..', relativePath)
    }
    return path.join(
      path.dirname(app.getAppPath()),
      'app.asar.unpacked',
      relativePath
    )
  }
}
```

---

## 参考资源

- [Electron asar 文档](https://www.electronjs.org/docs/latest/tutorial/asar-archives)
- [@electron/asar](https://github.com/electron/asar)
- [electron-builder files 配置](https://www.electron.build/configuration/contents)
- [electron-builder extraResources](https://www.electron.build/configuration/contents#extraresources)
