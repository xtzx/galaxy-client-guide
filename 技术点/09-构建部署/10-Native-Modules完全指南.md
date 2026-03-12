# Native Modules 完全指南

> Electron 中最容易踩坑的领域：原生模块的编译与使用

---

## 一、什么是 Native Modules

### 1.1 概念

Native Modules（原生模块）是使用 C/C++ 编写的 Node.js 扩展，编译为 `.node` 文件（本质是动态链接库）。

```
┌─────────────────────────────────────────────────────────────────┐
│                    Native Modules 架构                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  JavaScript 代码                                                │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────┐                                           │
│  │   Node.js API   │                                           │
│  │   (require)     │                                           │
│  └────────┬────────┘                                           │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────┐                                           │
│  │  Native Module  │  ← .node 文件（动态库）                    │
│  │  (C/C++ 扩展)   │                                           │
│  └────────┬────────┘                                           │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────┐                                           │
│  │  系统/硬件资源   │  ← 文件系统、网络、GPU、硬件设备等         │
│  └─────────────────┘                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 常见 Native Modules

| 模块 | 用途 | 使用场景 |
|------|------|----------|
| `sqlite3` | SQLite 数据库 | 本地数据存储 |
| `better-sqlite3` | SQLite（同步 API） | 高性能本地存储 |
| `sharp` | 图片处理 | 缩略图、格式转换 |
| `node-pty` | 伪终端 | 终端模拟器 |
| `keytar` | 系统密钥链 | 安全存储凭证 |
| `ffi-napi` | FFI 调用 | 调用系统 DLL/dylib |
| `ref-napi` | 内存指针操作 | 配合 ffi-napi |
| `robotjs` | 桌面自动化 | 模拟键鼠操作 |
| `serialport` | 串口通信 | 硬件设备通信 |
| `usb` | USB 设备访问 | USB 设备控制 |
| `node-hid` | HID 设备 | 游戏手柄、特殊输入设备 |

### 1.3 N-API vs NAN

```
┌─────────────────────────────────────────────────────────────────┐
│                    Native Module API 对比                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  NAN (Native Abstractions for Node.js)：                        │
│  ├── 较旧的抽象层                                               │
│  ├── 每个 Node.js 版本可能需要重新编译                          │
│  └── 逐渐被 N-API 取代                                         │
│                                                                 │
│  N-API (Node-API)：                                             │
│  ├── Node.js 8.0+ 引入                                         │
│  ├── ABI 稳定，跨 Node.js 版本兼容                              │
│  ├── 不需要为每个版本重新编译                                   │
│  └── 推荐使用                                                  │
│                                                                 │
│  N-API 版本对应：                                               │
│  ├── N-API 1: Node.js 8.0+                                     │
│  ├── N-API 3: Node.js 10.0+                                    │
│  ├── N-API 4: Node.js 10.16+                                   │
│  ├── N-API 5: Node.js 10.17+                                   │
│  ├── N-API 6: Node.js 10.20+                                   │
│  ├── N-API 7: Node.js 10.23+                                   │
│  ├── N-API 8: Node.js 12.19+                                   │
│  └── N-API 9: Node.js 18.17+                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、为什么需要 Rebuild

### 2.1 ABI 不兼容问题

```
问题根源：
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  Native Module 编译时绑定特定的：                                │
│  1. Node.js 版本 (ABI 版本)                                     │
│  2. 操作系统 (Windows/macOS/Linux)                              │
│  3. CPU 架构 (x64/arm64/ia32)                                   │
│  4. 编译器版本 (VS/GCC/Clang)                                   │
│                                                                 │
│  Electron 内置的 Node.js 与系统 Node.js 版本不同：              │
│  ├── 系统 Node.js: v18.18.0                                    │
│  ├── Electron 28 内置: v18.18.2 (但 ABI 可能不同)              │
│  └── 需要针对 Electron 重新编译                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 典型错误

```javascript
// 未 rebuild 时的错误
Error: The module '/path/to/module.node'
was compiled against a different Node.js version using
NODE_MODULE_VERSION 108. This version of Node.js requires
NODE_MODULE_VERSION 116. Please try re-compiling or re-installing
the module.

// 或
Error: Module did not self-register.

// 或
Error: A dynamic link library (DLL) initialization routine failed.
```

---

## 三、重编译方案

### 3.1 electron-rebuild（推荐）

最常用的重编译工具：

```bash
# 安装
npm install --save-dev @electron/rebuild

# 运行
npx electron-rebuild

# 指定 Electron 版本
npx electron-rebuild -v 28.0.0

# 仅重编译特定模块
npx electron-rebuild -o sqlite3,sharp

# 强制重编译
npx electron-rebuild -f

# 指定架构
npx electron-rebuild --arch x64
npx electron-rebuild --arch arm64
```

### 3.2 package.json 集成

```json
{
  "scripts": {
    "postinstall": "electron-rebuild",
    "rebuild": "electron-rebuild -f"
  },
  "devDependencies": {
    "@electron/rebuild": "^3.6.0",
    "electron": "^28.0.0"
  }
}
```

### 3.3 electron-rebuild 参数

```bash
npx electron-rebuild [options]

选项：
  -v, --version       Electron 版本
  -m, --module-dir    模块目录（默认 node_modules）
  -o, --only          仅编译指定模块（逗号分隔）
  -e, --electron-prebuilt-dir  Electron 预编译目录
  -d, --dist-url      Electron 头文件下载地址
  -t, --types         模块类型 (prod, dev, optional)
  -f, --force         强制重编译
  -a, --arch          目标架构 (x64, ia32, arm64)
  -p, --parallel      并行编译
  --debug             调试模式
```

### 3.4 electron-builder 内置 rebuild

electron-builder 可以在打包时自动 rebuild：

```yaml
# electron-builder.yml
npmRebuild: true  # 默认 true

# 控制 rebuild 参数
electronCompile: false
nodeGypRebuild: false
buildDependenciesFromSource: false
```

### 3.5 prebuild-install 机制

某些模块提供预编译二进制，避免本地编译：

```
┌─────────────────────────────────────────────────────────────────┐
│                    prebuild 工作流程                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  npm install some-native-module                                 │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────┐                                           │
│  │ prebuild-install│                                           │
│  └────────┬────────┘                                           │
│           │                                                     │
│           ▼                                                     │
│  尝试下载预编译二进制                                            │
│  (GitHub Releases / npm registry)                               │
│       │                                                         │
│       ├── 成功 → 直接使用                                       │
│       │                                                         │
│       └── 失败 → 回退到本地编译                                 │
│                  │                                              │
│                  ▼                                              │
│             node-gyp build                                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**支持 prebuild 的模块**：
- `better-sqlite3`
- `sharp`
- `@serialport/bindings-cpp`
- `node-pty`

---

## 四、node-gyp 环境配置

node-gyp 是 Node.js 原生模块的编译工具，需要特定的编译环境。

### 4.1 Windows 环境

```bash
# 方式一：使用 windows-build-tools（需要管理员权限）
npm install --global windows-build-tools

# 方式二：手动安装
# 1. 安装 Visual Studio Build Tools
#    https://visualstudio.microsoft.com/visual-cpp-build-tools/
#    选择 "C++ 桌面开发" 工作负载

# 2. 安装 Python 3.x
#    https://www.python.org/downloads/

# 配置 npm
npm config set msvs_version 2022
npm config set python /path/to/python.exe

# 验证
npm config list
node-gyp --version
```

**Windows 常见问题**：

| 错误 | 原因 | 解决 |
|------|------|------|
| `MSBuild.exe not found` | 未安装 VS Build Tools | 安装 Visual Studio Build Tools |
| `gyp ERR! find Python` | 未找到 Python | 安装 Python 3.x 并配置 |
| `gyp ERR! find VS` | VS 版本不匹配 | 设置 `msvs_version` |
| `node-pre-gyp error` | 预编译下载失败 | 检查网络或使用镜像 |

### 4.2 macOS 环境

```bash
# 安装 Xcode Command Line Tools
xcode-select --install

# 验证
xcode-select -p
# 输出: /Library/Developer/CommandLineTools

# 如果遇到问题，重置
sudo xcode-select --reset
```

### 4.3 Linux 环境

```bash
# Debian/Ubuntu
sudo apt-get update
sudo apt-get install -y build-essential python3 python3-pip

# CentOS/RHEL
sudo yum groupinstall "Development Tools"
sudo yum install python3

# Arch Linux
sudo pacman -S base-devel python

# 验证
gcc --version
python3 --version
make --version
```

---

## 五、asarUnpack 策略

### 5.1 为什么需要 unpack

Native modules (`.node` 文件) 不能在 asar 归档中运行，必须解压到文件系统：

```
┌─────────────────────────────────────────────────────────────────┐
│                    asar 与 Native Modules                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  app.asar (虚拟文件系统)                                        │
│  ├── index.js ✓                                                │
│  ├── package.json ✓                                            │
│  └── node_modules/                                              │
│      └── sqlite3/                                               │
│          ├── lib/sqlite3.js ✓                                  │
│          └── build/Release/                                     │
│              └── sqlite3.node ✗ (无法在 asar 中执行)           │
│                                                                 │
│  解决：asarUnpack                                               │
│  ├── app.asar                                                  │
│  └── app.asar.unpacked/                                         │
│      └── node_modules/sqlite3/build/Release/sqlite3.node       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 配置 asarUnpack

```yaml
# electron-builder.yml
asar: true

asarUnpack:
  # 所有 .node 文件
  - "**/*.node"
  
  # 特定模块整体 unpack
  - "**/node_modules/sharp/**"
  - "**/node_modules/sqlite3/**"
  - "**/node_modules/better-sqlite3/**"
  - "**/node_modules/node-pty/**"
  - "**/node_modules/ffi-napi/**"
  - "**/node_modules/ref-napi/**"
  
  # DLL 文件
  - "**/*.dll"
  - "**/*.dylib"
  - "**/*.so"
  
  # 可执行文件
  - "**/bin/*"
  - "**/*.exe"
```

### 5.3 路径处理

```javascript
// 在代码中处理 unpack 路径
const path = require('path')

// 获取正确的 native 模块路径
function getNativeModulePath(moduleName) {
  const basePath = app.getAppPath()
  
  // 开发环境
  if (!app.isPackaged) {
    return require.resolve(moduleName)
  }
  
  // 生产环境：需要处理 asar.unpacked 路径
  const unpackedPath = basePath.replace('app.asar', 'app.asar.unpacked')
  return path.join(unpackedPath, 'node_modules', moduleName)
}

// 示例：加载 sharp
const sharpPath = getNativeModulePath('sharp')
```

### 5.4 体积影响

```
权衡：
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  过度 unpack：                                                  │
│  ✗ 增加安装包体积                                               │
│  ✗ 增加安装时间                                                 │
│  ✗ 文件散落在多处                                               │
│                                                                 │
│  不足 unpack：                                                  │
│  ✗ 运行时 native 模块加载失败                                   │
│  ✗ 动态加载文件失败                                             │
│                                                                 │
│  最佳实践：                                                      │
│  ✓ 只 unpack 必要的 .node 文件                                  │
│  ✓ 整个模块有多个 native 文件时，整体 unpack                    │
│  ✓ 测试确认后再确定配置                                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 六、跨平台编译

### 6.1 无法交叉编译

**重要限制**：Native modules 无法交叉编译！

```
┌─────────────────────────────────────────────────────────────────┐
│                    编译限制                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ✗ 不能在 macOS 上编译 Windows 的 native module                │
│  ✗ 不能在 Windows 上编译 macOS 的 native module                │
│  ✗ 不能在 x64 上编译 arm64 的 native module（通常）            │
│                                                                 │
│  必须：                                                         │
│  ✓ Windows 版本在 Windows 机器上构建                            │
│  ✓ macOS 版本在 macOS 机器上构建                                │
│  ✓ Linux 版本在 Linux 机器上构建                                │
│  ✓ arm64 版本在 arm64 机器上构建（或使用模拟器）                │
│                                                                 │
│  CI 策略：                                                      │
│  使用多平台构建矩阵（见 CI/CD 章节）                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 使用预编译二进制

一些模块提供多平台预编译：

```bash
# 安装时跳过编译，使用预编译
npm install sharp --ignore-scripts

# 然后手动下载对应平台的预编译
# 或让 prebuild-install 处理
```

### 6.3 多架构构建

```yaml
# 构建 x64 和 arm64
mac:
  target:
    - target: dmg
      arch:
        - x64
        - arm64

# 需要在对应架构的机器上分别构建
# 或使用 Rosetta 2（macOS）
```

---

## 七、常见问题排查

### 7.1 MODULE_NOT_FOUND

```javascript
// 错误
Error: Cannot find module 'xxx'

// 原因及解决
// 1. 模块未安装
npm install xxx

// 2. 路径问题（asar）
// 检查 asarUnpack 配置

// 3. 打包时被排除
// 检查 electron-builder files 配置
```

### 7.2 版本不匹配

```javascript
// 错误
Error: The module was compiled against a different Node.js version

// 解决
npm rebuild
// 或
npx electron-rebuild -f
```

### 7.3 编译失败

```bash
# 错误
gyp ERR! build error

# 排查步骤
# 1. 检查编译环境
node-gyp --version
python --version

# 2. 清理后重试
npm cache clean --force
rm -rf node_modules
npm install

# 3. 查看详细日志
npm install --verbose

# 4. 手动编译查看错误
cd node_modules/problematic-module
node-gyp rebuild --verbose
```

### 7.4 运行时加载失败

```javascript
// 错误
Error: A dynamic link library (DLL) initialization routine failed

// 常见原因
// 1. 缺少依赖的系统库
// 2. 编译时与运行时架构不匹配
// 3. VC++ Redistributable 未安装（Windows）

// Windows 解决
// 安装 VC++ Redistributable
// https://aka.ms/vs/17/release/vc_redist.x64.exe
```

### 7.5 调试技巧

```javascript
// 打印模块搜索路径
console.log(module.paths)

// 打印 native 模块信息
const binding = require('bindings')
console.log(binding.getRoot('native-module'))

// 检查模块是否正确加载
try {
  const nativeModule = require('some-native-module')
  console.log('Loaded successfully')
} catch (err) {
  console.error('Load failed:', err.message)
  console.error('Expected path:', require.resolve.paths('some-native-module'))
}
```

---

## 八、特定模块处理

### 8.1 sqlite3 / better-sqlite3

```yaml
# electron-builder.yml
asarUnpack:
  - "**/node_modules/sqlite3/**"
  - "**/node_modules/better-sqlite3/**"
```

```json
// package.json
{
  "scripts": {
    "postinstall": "electron-rebuild -o sqlite3"
  }
}
```

### 8.2 sharp

```yaml
asarUnpack:
  - "**/node_modules/sharp/**"
```

```bash
# sharp 使用 prebuild，但可能需要指定平台
npm install --platform=darwin --arch=x64 sharp
npm install --platform=win32 --arch=x64 sharp
```

### 8.3 node-pty

```yaml
asarUnpack:
  - "**/node_modules/node-pty/**"
```

```javascript
// 使用时注意 shell 路径
const os = require('os')
const pty = require('node-pty')

const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash'
const ptyProcess = pty.spawn(shell, [], {
  name: 'xterm-color',
  cols: 80,
  rows: 30,
  cwd: process.env.HOME,
  env: process.env
})
```

### 8.4 ffi-napi / ref-napi

```yaml
asarUnpack:
  - "**/node_modules/ffi-napi/**"
  - "**/node_modules/ref-napi/**"
  - "**/node_modules/ref-struct-di/**"
```

```javascript
// 示例：调用 Windows API
const ffi = require('ffi-napi')
const ref = require('ref-napi')

const user32 = ffi.Library('user32', {
  'MessageBoxW': ['int', ['pointer', 'pointer', 'pointer', 'int']]
})
```

---

## 九、最佳实践

### 9.1 依赖管理

```json
{
  "dependencies": {
    "better-sqlite3": "^9.0.0"
  },
  "optionalDependencies": {
    "sharp": "^0.32.0"
  },
  "devDependencies": {
    "@electron/rebuild": "^3.6.0"
  }
}
```

### 9.2 构建脚本

```javascript
// scripts/rebuild.js
const { rebuild } = require('@electron/rebuild')
const path = require('path')

async function main() {
  const electronVersion = require('electron/package.json').version
  
  console.log(`Rebuilding native modules for Electron ${electronVersion}...`)
  
  await rebuild({
    buildPath: path.resolve(__dirname, '..'),
    electronVersion,
    force: true
  })
  
  console.log('Rebuild complete!')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
```

### 9.3 检查脚本

```javascript
// scripts/check-native.js
const fs = require('fs')
const path = require('path')

const nativeModules = [
  'better-sqlite3',
  'sharp',
  // 添加你的 native 模块
]

function checkModule(name) {
  try {
    const modulePath = require.resolve(name)
    const nodeFiles = findNodeFiles(path.dirname(modulePath))
    
    console.log(`✓ ${name}`)
    nodeFiles.forEach(f => console.log(`  - ${f}`))
    return true
  } catch (err) {
    console.error(`✗ ${name}: ${err.message}`)
    return false
  }
}

function findNodeFiles(dir) {
  const results = []
  const files = fs.readdirSync(dir, { withFileTypes: true })
  
  for (const file of files) {
    const fullPath = path.join(dir, file.name)
    if (file.isDirectory()) {
      results.push(...findNodeFiles(fullPath))
    } else if (file.name.endsWith('.node')) {
      results.push(fullPath)
    }
  }
  
  return results
}

console.log('Checking native modules...\n')
const results = nativeModules.map(checkModule)
const failed = results.filter(r => !r).length

if (failed > 0) {
  console.log(`\n${failed} module(s) failed`)
  process.exit(1)
} else {
  console.log('\nAll modules OK')
}
```

### 9.4 CI 配置要点

```yaml
# GitHub Actions 示例

jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Rebuild native modules
        run: npx electron-rebuild
      
      - name: Build
        run: npm run dist:win

  build-mac:
    runs-on: macos-latest
    steps:
      # 类似配置
      
  build-linux:
    runs-on: ubuntu-latest
    steps:
      - name: Install build dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y build-essential
      
      # 类似配置
```

---

## 十、完整配置示例

```yaml
# electron-builder.yml

appId: com.example.myapp
productName: My App

asar: true

asarUnpack:
  # 所有 native 模块
  - "**/*.node"
  - "**/*.dll"
  - "**/*.dylib"
  - "**/*.so"
  
  # 特定模块
  - "**/node_modules/better-sqlite3/**"
  - "**/node_modules/sharp/**"
  - "**/node_modules/node-pty/**"

files:
  - "dist/**/*"
  - "node_modules/**/*"
  - "package.json"
  
  # 排除不需要的文件
  - "!**/node_modules/**/{test,tests,__tests__}/**"
  - "!**/node_modules/**/*.{md,ts,map}"
  - "!**/node_modules/.bin/**"

npmRebuild: true
```

```json
// package.json
{
  "scripts": {
    "postinstall": "electron-rebuild",
    "rebuild": "electron-rebuild -f",
    "check-native": "node scripts/check-native.js",
    "dist": "npm run check-native && electron-builder"
  },
  "devDependencies": {
    "@electron/rebuild": "^3.6.0",
    "electron": "^28.0.0",
    "electron-builder": "^24.9.0"
  }
}
```

---

## 参考资源

- [Node.js N-API 文档](https://nodejs.org/api/n-api.html)
- [@electron/rebuild](https://github.com/electron/rebuild)
- [node-gyp](https://github.com/nodejs/node-gyp)
- [prebuild](https://github.com/prebuild/prebuild)
- [electron-builder Native 模块处理](https://www.electron.build/native)
