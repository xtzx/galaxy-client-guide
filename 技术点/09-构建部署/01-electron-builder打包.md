# electron-builder 打包

> Electron 应用打包工具

---

## 一、技术简介

### 1.1 什么是 electron-builder

`electron-builder` 是 Electron 应用的打包和发布工具：

- **跨平台**：Windows、macOS、Linux
- **多格式**：EXE、DMG、AppImage、NSIS 安装包
- **代码签名**：支持 Windows 和 macOS 签名
- **自动更新**：配合 electron-updater

### 1.2 打包流程

```
源代码
   │
   ▼
┌─────────────┐
│  npm build  │  ← 编译/打包资源
└─────────────┘
   │
   ▼
┌─────────────┐
│ electron-   │  ← 打包 Electron 应用
│ builder     │
└─────────────┘
   │
   ▼
┌─────────────┐
│   安装包    │  ← .exe / .dmg / .AppImage
└─────────────┘
```

---

## 二、项目中的配置

### 2.1 配置文件位置

```
package.json          # 主配置
config/builder.yml    # electron-builder 配置
```

### 2.2 package.json 配置

```json
{
  "name": "galaxy-client",
  "version": "1.0.0",
  "main": "src/main.js",

  "scripts": {
    "start": "electron .",
    "build": "electron-builder",
    "build:win": "electron-builder --win",
    "build:mac": "electron-builder --mac",
    "pack": "electron-builder --dir"
  },

  "build": {
    "extends": "config/builder.yml"
  },

  "devDependencies": {
    "electron": "^25.0.0",
    "electron-builder": "^24.0.0"
  }
}
```

### 2.3 builder.yml 配置

```yaml
# config/builder.yml

appId: com.company.galaxy-client
productName: Galaxy Client
copyright: Copyright © 2024

# 输出目录
directories:
  output: dist
  buildResources: build

# 包含的文件
files:
  - src/**/*
  - package.json
  - node_modules/**/*
  - "!node_modules/*/{test,tests,__tests__}/**"
  - "!**/*.{md,ts,map}"

# 额外资源（会复制到 Resources 目录）
extraResources:
  - from: extraResources/
    to: ./
    filter:
      - "**/*"

# Windows 配置
win:
  target:
    - target: nsis
      arch:
        - x64
  icon: build/icon.ico
  requestedExecutionLevel: asInvoker

# NSIS 安装程序配置
nsis:
  oneClick: false              # 非一键安装
  allowToChangeInstallationDirectory: true  # 允许选择安装目录
  createDesktopShortcut: true  # 创建桌面快捷方式
  createStartMenuShortcut: true # 创建开始菜单
  perMachine: false            # 安装到用户目录
  installerIcon: build/icon.ico
  uninstallerIcon: build/icon.ico

# macOS 配置
mac:
  target:
    - target: dmg
      arch:
        - x64
        - arm64
  icon: build/icon.icns
  category: public.app-category.productivity

# 发布配置（用于自动更新）
publish:
  provider: generic
  url: https://update.example.com/

# 代码签名（可选）
# win:
#   certificateFile: ./cert.pfx
#   certificatePassword: ${WIN_CSC_KEY_PASSWORD}
```

---

## 三、常用命令

### 3.1 打包命令

```bash
# 打包当前平台
npm run build

# 打包 Windows
npm run build:win
# 或
npx electron-builder --win

# 打包 macOS
npm run build:mac
# 或
npx electron-builder --mac

# 打包 Linux
npx electron-builder --linux

# 只生成目录（不打包安装程序，用于测试）
npx electron-builder --dir
```

### 3.2 指定架构

```bash
# 64位
npx electron-builder --win --x64

# 32位
npx electron-builder --win --ia32

# macOS ARM
npx electron-builder --mac --arm64
```

### 3.3 指定格式

```bash
# Windows 便携版
npx electron-builder --win portable

# Windows 安装包
npx electron-builder --win nsis

# macOS DMG
npx electron-builder --mac dmg

# macOS ZIP
npx electron-builder --mac zip
```

---

## 四、配置详解

### 4.1 files - 包含文件

```yaml
files:
  # 包含所有 src 文件
  - src/**/*

  # 包含 package.json
  - package.json

  # 排除测试文件
  - "!**/{test,tests,__tests__}/**"

  # 排除源码映射
  - "!**/*.map"

  # 排除 TypeScript 源文件
  - "!**/*.ts"
```

### 4.2 extraResources - 额外资源

```yaml
# 会复制到 app.asar 外部
extraResources:
  # 复制 DLL 文件
  - from: bin/
    to: bin/
    filter:
      - "*.dll"
      - "*.node"

  # 复制配置文件
  - from: config/
    to: config/
```

### 4.3 asar - 打包设置

```yaml
# asar 是 Electron 的归档格式
asar: true

# 排除不打包到 asar 的文件（原生模块需要）
asarUnpack:
  - "**/*.node"
  - "**/node_modules/sharp/**"
  - "**/node_modules/ffi-napi/**"
```

### 4.4 nsis - Windows 安装程序

```yaml
nsis:
  # 一键安装（无界面）
  oneClick: false

  # 允许选择目录
  allowToChangeInstallationDirectory: true

  # 安装后运行
  runAfterFinish: true

  # 自定义安装脚本
  include: scripts/installer.nsh

  # 卸载时删除用户数据
  deleteAppDataOnUninstall: true
```

---

## 五、原生模块处理

### 5.1 问题说明

```
原生模块（如 ffi-napi、sharp）需要针对 Electron 重新编译：
- Node.js 版本不同
- Electron 使用的 V8 版本不同
- 需要使用 electron-rebuild
```

### 5.2 配置 rebuild

```json
// package.json
{
  "scripts": {
    "postinstall": "electron-rebuild"
  },
  "devDependencies": {
    "electron-rebuild": "^3.2.9"
  }
}
```

### 5.3 asarUnpack 配置

```yaml
# 原生模块不能打包到 asar
asarUnpack:
  - "**/node_modules/ffi-napi/**"
  - "**/node_modules/ref-napi/**"
  - "**/node_modules/sharp/**"
  - "**/*.node"
```

---

## 六、代码签名

### 6.1 为什么需要签名

- Windows SmartScreen 警告
- macOS Gatekeeper 阻止
- 用户信任度

### 6.2 Windows 签名

```yaml
# builder.yml
win:
  signingHashAlgorithms:
    - sha256
  certificateFile: ./cert.pfx
  certificatePassword: ${WIN_CSC_KEY_PASSWORD}
```

```bash
# 环境变量设置密码
export WIN_CSC_KEY_PASSWORD=your_password
```

### 6.3 macOS 签名

```yaml
# builder.yml
mac:
  identity: "Developer ID Application: Your Company (XXXXXXXXXX)"
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
```

---

## 七、自动更新配置

### 7.1 publish 配置

```yaml
# 使用通用 HTTP 服务器
publish:
  provider: generic
  url: https://update.example.com/

# 或使用 GitHub Releases
publish:
  provider: github
  owner: your-org
  repo: your-repo
```

### 7.2 生成的更新文件

```
dist/
├── galaxy-client-1.0.0-setup.exe
├── galaxy-client-1.0.0-setup.exe.blockmap
└── latest.yml    # 更新清单
```

---

## 八、与 React 开发对比

### 8.1 前端打包

```javascript
// React 前端通常用 webpack/vite
npm run build
// 输出静态文件到 build/ 或 dist/
```

### 8.2 关键区别

```
┌─────────────────────────────────────────────────────────────────┐
│                    前端 vs Electron 打包                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  React 前端：                                                   │
│  - 输出 HTML/CSS/JS 静态文件                                    │
│  - 部署到 Web 服务器                                            │
│  - 用户访问 URL 使用                                            │
│                                                                 │
│  Electron 应用：                                                │
│  - 输出可执行文件/安装包                                         │
│  - 用户下载安装                                                 │
│  - 需要处理原生模块、签名                                        │
│  - 需要考虑多平台                                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 九、调试技巧

### 9.1 查看打包内容

```bash
# 只生成目录，不打包
npx electron-builder --dir

# 查看 asar 内容
npx asar list dist/win-unpacked/resources/app.asar
```

### 9.2 调试安装过程

```bash
# NSIS 详细日志
# 安装时按 Ctrl+Alt+T 查看日志
```

### 9.3 常见问题

```yaml
# 问题：原生模块加载失败
# 解决：添加到 asarUnpack
asarUnpack:
  - "**/*.node"

# 问题：文件太大
# 解决：排除不需要的文件
files:
  - "!**/test/**"
  - "!**/*.map"

# 问题：打包很慢
# 解决：使用缓存
npmRebuild: false  # 已经 rebuild 过
```
