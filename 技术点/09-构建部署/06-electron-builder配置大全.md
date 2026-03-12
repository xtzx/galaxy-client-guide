# electron-builder 配置大全

> Electron 应用打包的核心工具，掌握配置是构建的关键

---

## 一、概述

electron-builder 是 Electron 应用最流行的打包和发布工具，支持：

- **多平台**：Windows、macOS、Linux
- **多格式**：NSIS、DMG、AppImage、deb、rpm、portable 等
- **自动更新**：配合 electron-updater
- **代码签名**：Windows 和 macOS
- **发布集成**：GitHub、S3、通用服务器

```
┌─────────────────────────────────────────────────────────────────┐
│                    electron-builder 工作流程                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  源码                                                           │
│   │                                                             │
│   ▼                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐     │
│  │ 前端构建    │ -> │ 主进程构建  │ -> │ electron-builder│     │
│  │ (Vite等)   │    │ (tsc/esbuild)│    │                 │     │
│  └─────────────┘    └─────────────┘    └────────┬────────┘     │
│                                                  │               │
│                     ┌────────────────────────────┼────────┐     │
│                     ▼                            ▼        ▼     │
│              ┌──────────┐    ┌──────────┐    ┌──────────┐      │
│              │  pack    │    │   dist   │    │ publish  │      │
│              │ (目录)   │    │ (安装包) │    │ (发布)   │      │
│              └──────────┘    └──────────┘    └──────────┘      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、配置文件格式与位置

### 2.1 支持的配置格式

| 格式 | 文件名 | 特点 |
|------|--------|------|
| YAML | `electron-builder.yml` | 最常用，可读性好 |
| JSON | `electron-builder.json` | 标准格式 |
| JSON5 | `electron-builder.json5` | 支持注释 |
| JS | `electron-builder.js` | 可动态计算 |
| TS | `electron-builder.ts` | TypeScript 支持 |
| package.json | `build` 字段 | 简单项目 |

### 2.2 配置文件位置

```
项目根目录/
├── electron-builder.yml          # 默认位置
├── config/
│   ├── electron-builder.yml      # 通过 --config 指定
│   ├── builder.dev.yml           # 开发环境配置
│   └── builder.prod.yml          # 生产环境配置
└── package.json                  # 或使用 build 字段
```

### 2.3 package.json 中的配置

```json
{
  "name": "my-app",
  "version": "1.0.0",
  "build": {
    "appId": "com.example.myapp",
    "productName": "My App",
    "extends": null
  }
}
```

### 2.4 配置继承（extends）

```yaml
# electron-builder.yml
extends: ./config/base.yml

# 覆盖基础配置
productName: "My App Pro"
```

```yaml
# config/base.yml
appId: com.example.myapp
directories:
  output: dist
  buildResources: build
```

### 2.5 多环境配置策略

```javascript
// electron-builder.js - 动态配置
const isProduction = process.env.NODE_ENV === 'production'
const channel = process.env.CHANNEL || 'default'

module.exports = {
  appId: `com.example.myapp.${channel}`,
  productName: channel === 'beta' ? 'My App Beta' : 'My App',
  
  publish: isProduction ? {
    provider: 's3',
    bucket: 'my-releases'
  } : null,
  
  // 根据渠道使用不同图标
  win: {
    icon: `build/icon-${channel}.ico`
  }
}
```

```bash
# 使用不同配置构建
CHANNEL=beta npm run dist
NODE_ENV=production npm run dist -- --config config/builder.prod.yml
```

---

## 三、核心配置项详解

### 3.1 应用标识

```yaml
# 应用唯一标识符 - 非常重要！
# 影响：用户数据目录、协议注册、更新识别
appId: com.company.productname

# 显示名称（安装后显示的名字）
productName: "My Application"

# 版权信息
copyright: "Copyright © 2024 My Company"

# 构建版本号（Windows 的 ProductVersion）
buildVersion: "1.0.0.100"
```

**appId 命名规范**：
```
格式：com.公司名.产品名
例如：com.microsoft.vscode
      com.electron.fiddle
      org.example.myapp
```

### 3.2 files - 文件包含/排除

控制哪些文件打包进 app.asar：

```yaml
files:
  # 包含 - 相对于项目根目录
  - "dist/**/*"           # 构建产物
  - "package.json"        # 必须包含
  - "node_modules/**/*"   # 依赖
  
  # 排除 - 使用 ! 前缀
  - "!**/*.{ts,tsx,map}"  # 排除源码
  - "!**/node_modules/*/{test,tests,__tests__,docs,documentation}/**"
  - "!**/node_modules/.bin/**"
  - "!**/*.{md,markdown}"
  - "!**/._*"             # macOS 临时文件
  - "!**/{.DS_Store,.git,.gitignore}"
  
  # 高级过滤
  - filter:
      - "**/*"
      - "!*.log"
    from: "src"
    to: "src"
```

**files 匹配规则**：
```
*           匹配任意字符（不含路径分隔符）
**          匹配任意字符（含路径分隔符）
?           匹配单个字符
[abc]       匹配 a、b 或 c
{a,b}       匹配 a 或 b
!pattern    排除匹配的文件
```

### 3.3 extraFiles vs extraResources

两者都用于复制额外文件，但目标位置不同：

```yaml
# extraFiles - 复制到安装目录根目录
# Windows: C:\Program Files\MyApp\
# macOS: /Applications/MyApp.app/Contents/
extraFiles:
  - from: "bin/ffmpeg.exe"
    to: "bin/ffmpeg.exe"
  - from: "config/default.json"
    to: "config/default.json"
    filter:
      - "**/*"

# extraResources - 复制到 resources 目录
# Windows: C:\Program Files\MyApp\resources\
# macOS: /Applications/MyApp.app/Contents/Resources/
extraResources:
  - from: "assets/"
    to: "assets/"
  - from: "locales/"
    to: "locales/"
```

**选择建议**：
```
┌────────────────────────────────────────────────────────────┐
│                 extraFiles vs extraResources               │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  extraFiles:                                               │
│  • 可执行文件（ffmpeg、工具等）                             │
│  • 需要直接访问的配置文件                                   │
│  • 驱动程序、DLL                                           │
│                                                            │
│  extraResources:                                           │
│  • 应用资源（图片、字体、模板）                             │
│  • 本地化文件                                              │
│  • 只读数据文件                                            │
│                                                            │
│  访问路径：                                                 │
│  extraFiles:     path.dirname(process.execPath)           │
│  extraResources: process.resourcesPath                    │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 3.4 asar 配置

```yaml
# 是否使用 asar 打包（推荐 true）
asar: true

# 需要从 asar 中解压的文件
# 常见场景：native 模块、需要动态加载的文件
asarUnpack:
  - "**/*.node"                    # 所有 native 模块
  - "**/node_modules/sharp/**"     # 图片处理库
  - "**/node_modules/sqlite3/**"   # SQLite
  - "**/node_modules/ffi-napi/**"  # FFI
  - "resources/bin/**"             # 可执行文件
```

**asar 优缺点**：
```
优点：
✓ 规避 Windows 路径长度限制（260字符）
✓ 文件组织更整洁
✓ 一定程度防止简单查看/篡改
✓ 略微加快文件读取（单文件 I/O）

缺点/限制：
✗ native 模块无法在 asar 中运行
✗ 需要动态执行的文件需要 unpack
✗ 不是真正的加密保护
✗ 某些文件系统操作需要特殊处理
```

### 3.5 directories 配置

```yaml
directories:
  # 构建产物输出目录
  output: dist
  
  # 构建资源目录（图标、安装背景等）
  buildResources: build
  
  # 应用源码目录（默认为项目根目录）
  # 如果前端构建输出在 app 目录，可以设置
  app: app
```

**buildResources 目录结构**：
```
build/
├── icon.ico              # Windows 图标
├── icon.icns             # macOS 图标
├── icon.png              # Linux 图标 (256x256 或更大)
├── background.png        # DMG 背景图
├── background@2x.png     # Retina DMG 背景
├── installerHeader.bmp   # NSIS 安装头部图 (150x57)
├── installerSidebar.bmp  # NSIS 侧边栏 (164x314)
├── entitlements.mac.plist   # macOS 权限
└── info.plist            # macOS 额外配置
```

### 3.6 artifactName - 产物命名

```yaml
# 默认命名模板
artifactName: "${productName}-${version}.${ext}"

# 常用模板变量
# ${productName} - 产品名称
# ${version}     - 版本号
# ${name}        - package.json 的 name
# ${arch}        - 架构 (x64, arm64, ia32)
# ${platform}    - 平台 (win, mac, linux)
# ${os}          - 同 platform
# ${ext}         - 扩展名

# 实际示例
artifactName: "${productName}-Setup-${version}-${arch}.${ext}"
# 输出：MyApp-Setup-1.0.0-x64.exe

# 包含渠道
artifactName: "${productName}-${channel}-${version}.${ext}"
```

### 3.7 compression - 压缩配置

```yaml
# 压缩级别
compression: normal  # store | normal | maximum

# store:   不压缩，构建最快
# normal:  默认，平衡速度和大小
# maximum: 最大压缩，构建较慢
```

**选择建议**：
- 开发/测试：`store`（快速构建）
- 正式发布：`normal` 或 `maximum`

### 3.8 其他常用配置

```yaml
# 是否自动 rebuild native 模块
npmRebuild: true

# 构建时的 npm 参数
npmArgs:
  - "--ignore-scripts"

# 使用的 node 版本
nodeVersion: current

# 协议注册（URL Scheme）
protocols:
  - name: "MyApp Protocol"
    schemes:
      - myapp
      - myapp-dev

# 文件关联
fileAssociations:
  - ext: myfile
    name: "MyApp Document"
    description: "MyApp 文档格式"
    mimeType: "application/x-myapp"
    icon: "document.ico"  # Windows
    role: Editor          # macOS
```

---

## 四、平台特定配置

### 4.1 Windows 配置 (win)

```yaml
win:
  # 目标格式
  target:
    - target: nsis
      arch:
        - x64
        - ia32
    - target: portable
      arch: x64
  
  # 图标 (256x256 或更大的 ico)
  icon: build/icon.ico
  
  # 发布者名称（显示在属性中）
  publisherName: "My Company"
  
  # 法律商标
  legalTrademarks: "MyApp is a trademark of My Company"
  
  # 请求的执行级别
  requestedExecutionLevel: asInvoker  # asInvoker | requireAdministrator | highestAvailable
  
  # 签名配置
  sign: null  # 自定义签名脚本路径
  signDlls: false  # 是否签名 DLL
  
  # 时间戳服务器
  timeStampServer: "http://timestamp.digicert.com"
  
  # 证书配置（如果使用证书文件）
  certificateFile: null
  certificatePassword: null
  certificateSubjectName: null
  certificateSha1: null

# NSIS 安装程序配置
nsis:
  oneClick: false                          # 一键安装
  allowToChangeInstallationDirectory: true # 允许选择目录
  allowElevation: true                     # 允许提升权限
  perMachine: false                        # 安装到系统目录
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: "My App"
  runAfterFinish: true
  installerIcon: build/icon.ico
  uninstallerIcon: build/icon.ico
  installerHeader: build/installerHeader.bmp
  installerSidebar: build/installerSidebar.bmp
  license: LICENSE.txt
  language: 2052  # 简体中文
  include: installer.nsh  # 自定义脚本
  deleteAppDataOnUninstall: false
```

### 4.2 macOS 配置 (mac)

```yaml
mac:
  # 目标格式
  target:
    - target: dmg
      arch:
        - x64
        - arm64
    - target: zip
      arch: universal
  
  # 应用分类
  category: public.app-category.productivity
  
  # 图标
  icon: build/icon.icns
  
  # 深色模式支持
  darkModeSupport: true
  
  # 最低系统版本
  minimumSystemVersion: "10.13"
  
  # 签名身份
  identity: null  # 自动检测或指定
  
  # 强化运行时
  hardenedRuntime: true
  
  # 网关助手
  gatekeeperAssess: false
  
  # 权限配置
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  
  # Helper 应用签名
  signIgnore: null
  
  # 公证
  notarize: false  # 或配置对象

# DMG 配置
dmg:
  # 背景图片
  background: build/background.png
  
  # 卷图标
  icon: build/volume.icns
  
  # 图标大小
  iconSize: 80
  
  # 窗口配置
  window:
    width: 540
    height: 380
  
  # 内容布局
  contents:
    - x: 130
      y: 220
      type: file
    - x: 410
      y: 220
      type: link
      path: /Applications
  
  # 格式
  format: UDZO  # UDRW | UDRO | UDCO | UDZO | UDBZ | ULFO
```

### 4.3 Linux 配置 (linux)

```yaml
linux:
  # 目标格式
  target:
    - AppImage
    - deb
    - rpm
  
  # 图标（推荐 512x512 PNG）
  icon: build/icons
  
  # 桌面分类
  category: Utility
  
  # 桌面文件名
  desktop:
    Name: My App
    Comment: My App Description
    Keywords: app;tool;
  
  # 可执行文件名
  executableName: myapp
  
  # 维护者
  maintainer: "maintainer@example.com"
  
  # 厂商
  vendor: "My Company"
  
  # 简介
  synopsis: "Short description"
  
  # 描述
  description: "Longer description of the application"

# AppImage 配置
appImage:
  license: LICENSE.txt

# deb 配置
deb:
  depends:
    - libgtk-3-0
    - libnotify4
    - libnss3
  priority: optional
  compression: xz
  
# rpm 配置  
rpm:
  depends:
    - gtk3
    - libnotify
    - nss
  compression: xz
```

---

## 五、publish 配置（自动更新发布）

### 5.1 通用服务器 (generic)

```yaml
publish:
  provider: generic
  url: "https://releases.example.com/"
  channel: latest  # latest | beta | alpha
  
  # 可选：使用不同的更新文件名
  useMultipleRangeRequest: true
```

**服务器目录结构**：
```
https://releases.example.com/
├── latest.yml              # Windows 更新清单
├── latest-mac.yml          # macOS 更新清单
├── latest-linux.yml        # Linux 更新清单
├── MyApp-1.0.0-Setup.exe
├── MyApp-1.0.0-Setup.exe.blockmap
├── MyApp-1.0.0.dmg
├── MyApp-1.0.0-mac.zip
└── MyApp-1.0.0.AppImage
```

### 5.2 GitHub Releases

```yaml
publish:
  provider: github
  owner: my-org
  repo: my-app
  releaseType: release  # draft | prerelease | release
  private: false
  
  # 使用 token（CI 环境）
  token: ${GH_TOKEN}
```

### 5.3 S3 / 阿里云 OSS

```yaml
# AWS S3
publish:
  provider: s3
  bucket: my-releases
  region: us-east-1
  acl: public-read
  path: /releases/${channel}
  
# 兼容 S3 的服务（如阿里云 OSS）
publish:
  provider: s3
  bucket: my-releases
  endpoint: https://oss-cn-hangzhou.aliyuncs.com
  region: oss-cn-hangzhou
  acl: public-read
```

### 5.4 多渠道发布

```yaml
publish:
  - provider: github
    releaseType: draft
  - provider: generic
    url: "https://releases.example.com/"
  - provider: s3
    bucket: backup-releases
```

### 5.5 私有仓库 / 自定义 provider

```javascript
// electron-builder.js
module.exports = {
  publish: {
    provider: 'custom',
    updateProvider: MyCustomProvider
  }
}
```

---

## 六、钩子函数

钩子函数允许在构建的不同阶段执行自定义逻辑。

### 6.1 可用钩子

| 钩子 | 时机 | 参数 |
|------|------|------|
| `beforeBuild` | 构建开始前 | context |
| `afterPack` | 打包完成后（安装包生成前） | context |
| `afterSign` | 签名完成后 | context |
| `afterAllArtifactBuild` | 所有产物生成后 | buildResult |
| `onNodeModuleFile` | 处理每个 node_module 文件 | file |
| `beforePack` | 打包前 | context |

### 6.2 配置方式

```yaml
# electron-builder.yml
afterPack: ./scripts/afterPack.js
afterSign: ./scripts/afterSign.js
afterAllArtifactBuild: ./scripts/afterBuild.js
```

### 6.3 钩子示例

```javascript
// scripts/afterPack.js
// 打包后注入额外文件
exports.default = async function(context) {
  const { appOutDir, packager, electronPlatformName } = context
  
  console.log('After pack:', appOutDir)
  console.log('Platform:', electronPlatformName)
  
  // 复制额外文件
  const fs = require('fs-extra')
  const path = require('path')
  
  // Windows 平台处理
  if (electronPlatformName === 'win32') {
    await fs.copy(
      path.join(__dirname, '../extra/win'),
      path.join(appOutDir, 'extra')
    )
  }
  
  // 写入构建信息
  const buildInfo = {
    buildTime: new Date().toISOString(),
    version: packager.appInfo.version,
    platform: electronPlatformName
  }
  
  await fs.writeJson(
    path.join(appOutDir, 'resources', 'build-info.json'),
    buildInfo
  )
}
```

```javascript
// scripts/afterSign.js
// macOS 公证
exports.default = async function(context) {
  const { electronPlatformName, appOutDir } = context
  
  if (electronPlatformName !== 'darwin') {
    return
  }
  
  const appName = context.packager.appInfo.productFilename
  const appPath = `${appOutDir}/${appName}.app`
  
  console.log('Notarizing:', appPath)
  
  const { notarize } = require('@electron/notarize')
  
  await notarize({
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_ID_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID
  })
  
  console.log('Notarization complete')
}
```

```javascript
// scripts/afterBuild.js
// 构建完成后上传到自定义服务器
exports.default = async function(buildResult) {
  console.log('Build complete!')
  console.log('Artifacts:', buildResult.artifactPaths)
  
  // 上传到服务器
  for (const artifact of buildResult.artifactPaths) {
    console.log('Would upload:', artifact)
    // await uploadToServer(artifact)
  }
  
  // 发送通知
  if (process.env.SLACK_WEBHOOK) {
    await sendSlackNotification(buildResult)
  }
}

async function sendSlackNotification(buildResult) {
  const fetch = require('node-fetch')
  await fetch(process.env.SLACK_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `构建完成: ${buildResult.artifactPaths.join(', ')}`
    })
  })
}
```

---

## 七、package.json scripts 最佳实践

### 7.1 标准脚本组织

```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev:renderer\" \"npm run dev:main\"",
    "dev:renderer": "vite",
    "dev:main": "electron .",
    
    "build": "npm run build:renderer && npm run build:main",
    "build:renderer": "vite build",
    "build:main": "tsc -p tsconfig.main.json",
    
    "pack": "npm run build && electron-builder --dir",
    "dist": "npm run build && electron-builder",
    "dist:win": "npm run build && electron-builder --win",
    "dist:mac": "npm run build && electron-builder --mac",
    "dist:linux": "npm run build && electron-builder --linux",
    
    "publish": "npm run build && electron-builder --publish always",
    
    "clean": "rimraf dist out",
    "rebuild": "electron-rebuild -f",
    
    "typecheck": "tsc --noEmit",
    "lint": "eslint src --ext .ts,.tsx"
  }
}
```

### 7.2 使用构建脚本统一管理

```javascript
// scripts/build.js
const { build } = require('electron-builder')
const path = require('path')

async function main() {
  const args = parseArgs()
  
  // 环境变量
  const channel = process.env.CHANNEL || 'stable'
  const isPublish = args.publish || false
  
  console.log(`Building channel: ${channel}`)
  console.log(`Publish: ${isPublish}`)
  
  // 构建配置
  const config = {
    config: {
      appId: `com.example.myapp.${channel}`,
      productName: channel === 'stable' ? 'My App' : `My App ${channel}`,
      
      extraMetadata: {
        channel: channel
      },
      
      publish: isPublish ? {
        provider: 'generic',
        url: `https://releases.example.com/${channel}/`
      } : null
    },
    
    // 目标平台
    win: args.win ? ['nsis'] : undefined,
    mac: args.mac ? ['dmg', 'zip'] : undefined,
    linux: args.linux ? ['AppImage'] : undefined,
    
    // 发布选项
    publish: isPublish ? 'always' : 'never'
  }
  
  try {
    const result = await build(config)
    console.log('Build complete:', result)
  } catch (error) {
    console.error('Build failed:', error)
    process.exit(1)
  }
}

function parseArgs() {
  const args = process.argv.slice(2)
  return {
    win: args.includes('--win') || args.includes('-w'),
    mac: args.includes('--mac') || args.includes('-m'),
    linux: args.includes('--linux') || args.includes('-l'),
    publish: args.includes('--publish') || args.includes('-p')
  }
}

main()
```

### 7.3 跨平台脚本兼容

```json
{
  "scripts": {
    "dist": "cross-env NODE_ENV=production node scripts/build.js",
    "dist:beta": "cross-env CHANNEL=beta npm run dist",
    "dist:win": "npm run dist -- --win",
    "dist:mac": "npm run dist -- --mac"
  },
  "devDependencies": {
    "cross-env": "^7.0.3"
  }
}
```

---

## 八、构建缓存与优化

### 8.1 缓存目录

electron-builder 使用以下缓存：

```
~/.cache/electron/                    # Electron 二进制
~/.cache/electron-builder/            # 构建工具缓存
  ├── nsis/                           # NSIS
  ├── nsis-resources/                 # NSIS 资源
  ├── winCodeSign/                    # Windows 签名工具
  └── wine/                           # Wine（Linux 构建 Windows）

node_modules/.cache/electron-builder/ # 项目级缓存
```

### 8.2 环境变量控制缓存

```bash
# 自定义缓存目录
export ELECTRON_BUILDER_CACHE=/path/to/cache

# 自定义 Electron 缓存
export ELECTRON_CACHE=/path/to/electron-cache

# 禁用 Electron 下载进度
export ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES=true
```

### 8.3 CI 缓存配置

```yaml
# GitHub Actions 缓存示例
- name: Cache electron-builder
  uses: actions/cache@v3
  with:
    path: |
      ~/.cache/electron
      ~/.cache/electron-builder
    key: ${{ runner.os }}-electron-${{ hashFiles('**/package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-electron-

- name: Cache node_modules
  uses: actions/cache@v3
  with:
    path: node_modules
    key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
```

### 8.4 构建速度优化

```yaml
# 开发/测试时的快速构建配置
asar: true
compression: store  # 不压缩，最快
npmRebuild: false   # 如果已经 rebuild 过

# 只构建当前平台
win:
  target:
    - target: dir   # 只输出目录，不打安装包
```

---

## 九、完整配置示例

### 9.1 标准项目配置

```yaml
# electron-builder.yml
appId: com.example.myapp
productName: My Application
copyright: Copyright © 2024 My Company

# 输出目录
directories:
  output: dist
  buildResources: build

# 文件配置
files:
  - "dist/**/*"
  - "package.json"
  - "!**/*.{ts,tsx,map}"
  - "!**/node_modules/*/{test,tests,__tests__}/**"

# 额外资源
extraResources:
  - from: "resources/"
    to: "."
    filter:
      - "**/*"

# asar 配置
asar: true
asarUnpack:
  - "**/*.node"
  - "**/node_modules/sharp/**"

# 压缩
compression: normal

# Windows
win:
  target:
    - target: nsis
      arch: [x64]
  icon: build/icon.ico
  publisherName: My Company

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: My App
  runAfterFinish: true
  license: LICENSE.txt

# macOS
mac:
  target:
    - target: dmg
      arch: [x64, arm64]
    - target: zip
      arch: [x64, arm64]
  category: public.app-category.productivity
  icon: build/icon.icns
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist

dmg:
  background: build/background.png
  iconSize: 80
  contents:
    - x: 130
      y: 220
      type: file
    - x: 410
      y: 220
      type: link
      path: /Applications

# Linux
linux:
  target:
    - AppImage
    - deb
  category: Utility
  icon: build/icons

# 发布配置
publish:
  provider: generic
  url: https://releases.example.com/

# 钩子
afterSign: scripts/notarize.js
```

### 9.2 多渠道配置

```javascript
// electron-builder.js
const channel = process.env.CHANNEL || 'stable'
const isCI = process.env.CI === 'true'

const channelConfig = {
  stable: {
    appId: 'com.example.myapp',
    productName: 'My App',
    icon: 'build/icon',
    publishUrl: 'https://releases.example.com/stable/'
  },
  beta: {
    appId: 'com.example.myapp.beta',
    productName: 'My App Beta',
    icon: 'build/icon-beta',
    publishUrl: 'https://releases.example.com/beta/'
  },
  dev: {
    appId: 'com.example.myapp.dev',
    productName: 'My App Dev',
    icon: 'build/icon-dev',
    publishUrl: null
  }
}

const config = channelConfig[channel] || channelConfig.stable

module.exports = {
  appId: config.appId,
  productName: config.productName,
  
  directories: {
    output: `dist/${channel}`,
    buildResources: 'build'
  },
  
  extraMetadata: {
    channel: channel
  },
  
  win: {
    target: 'nsis',
    icon: `${config.icon}.ico`
  },
  
  mac: {
    target: ['dmg', 'zip'],
    icon: `${config.icon}.icns`
  },
  
  publish: config.publishUrl ? {
    provider: 'generic',
    url: config.publishUrl
  } : null,
  
  // CI 环境才签名
  win: {
    sign: isCI ? undefined : null
  }
}
```

---

## 十、常见问题

### 10.1 构建失败排查

```bash
# 启用详细日志
DEBUG=electron-builder npm run dist

# 常见问题：
# 1. 图标格式不正确 - Windows 需要 ico，macOS 需要 icns
# 2. 依赖缺失 - 检查 package.json
# 3. native 模块未 rebuild - 运行 electron-rebuild
# 4. 缓存问题 - 清理 ~/.cache/electron-builder
```

### 10.2 配置验证

```bash
# 验证配置
npx electron-builder --help

# 查看将要打包的文件
npx electron-builder --dir --config.asar=false
```

### 10.3 产物过大

```yaml
# 排除不必要的文件
files:
  - "!**/*.map"
  - "!**/node_modules/**/*.md"
  - "!**/node_modules/*/{example,examples,test,tests,docs}/**"
  
# 使用 compression
compression: maximum
```

---

## 参考资源

- [electron-builder 官方文档](https://www.electron.build/)
- [配置选项完整列表](https://www.electron.build/configuration/configuration)
- [CLI 参数](https://www.electron.build/cli)
- [API 文档](https://www.electron.build/api/electron-builder)
