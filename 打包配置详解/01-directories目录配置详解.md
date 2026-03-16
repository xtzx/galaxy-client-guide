# 01 — directories 目录配置详解

> electron-builder 中 `directories` 字段控制构建的输入/输出路径，是打包流程中最基础的路径配置。

---

## 一、当前项目配置

```yaml
directories:
  buildResources: build
  output: dist/weixinzhushou
```

---

## 二、字段含义

`directories` 是一个对象，包含以下三个可选字段：

| 字段 | 类型 | 默认值 | 含义 |
|------|------|--------|------|
| `buildResources` | string | `"build"` | 构建资源目录，存放图标、安装背景、权限声明等打包素材 |
| `output` | string | `"dist"` | 打包产物输出目录，最终的 .exe / .dmg / .AppImage 等文件生成于此 |
| `app` | string | 项目根目录 | 应用源码目录，指向包含 `package.json` 的应用目录 |

---

## 三、各字段详细说明

### 3.1 buildResources — 构建资源目录

**作用**：告诉 electron-builder 去哪里查找打包所需的素材文件。

**electron-builder 会自动从该目录查找以下文件**：

| 文件 | 用途 | 平台 |
|------|------|------|
| `icon.ico` | 应用图标 | Windows |
| `icon.icns` | 应用图标 | macOS |
| `icon.png` | 应用图标（256×256 或更大） | Linux |
| `background.png` | DMG 安装背景 | macOS |
| `background@2x.png` | Retina DMG 安装背景 | macOS |
| `installerHeader.bmp` | NSIS 安装向导头部图片（150×57） | Windows |
| `installerHeaderIcon.ico` | NSIS 安装向导头部图标 | Windows |
| `installerSidebar.bmp` | NSIS 安装向导侧边栏（164×314） | Windows |
| `uninstallerSidebar.bmp` | NSIS 卸载向导侧边栏 | Windows |
| `entitlements.mac.plist` | macOS 权限声明 | macOS |
| `entitlements.mac.inherit.plist` | macOS 子进程权限继承 | macOS |
| `info.plist` | macOS 额外 plist 配置 | macOS |

**当前项目**：

```yaml
buildResources: build
```

这意味着 electron-builder 会在项目根目录下的 `build/` 目录中查找上述素材。

> **注意**：当前项目的图标实际配置在 `win.icon: extraResources/icon.ico`，这会覆盖 buildResources 中的默认查找行为。但如果使用 NSIS 安装向导的背景图片、侧边栏等，仍然会从 `build/` 目录查找。

**推荐目录结构**：

```
build/
├── icon.ico                  # Windows 应用图标
├── icon.icns                 # macOS 应用图标（若需要）
├── icon.png                  # Linux 应用图标（若需要）
├── installerHeader.bmp       # NSIS 安装向导头部
├── installerSidebar.bmp      # NSIS 安装向导侧边栏
└── uninstallerSidebar.bmp    # NSIS 卸载向导侧边栏
```

### 3.2 output — 打包产物输出目录

**作用**：指定打包完成后 .exe、.blockmap、latest.yml 等文件的存放位置。

**当前项目**：

```yaml
output: dist/weixinzhushou
```

打包完成后的目录结构示例：

```
dist/weixinzhushou/
├── Weixinzhushou-win-5.5.0-release01.exe      # NSIS 安装包
├── Weixinzhushou-win-5.5.0-release01.exe.blockmap  # 差量更新映射
├── latest.yml                                  # 自动更新清单文件
└── win-unpacked/                               # 解压后的应用目录（--dir 模式时）
    ├── Weixinzhushou.exe
    ├── resources/
    └── ...
```

**多产品线设计**：

不同产品线使用不同的 output 目录，避免互相覆盖：

| 产品线 | output |
|--------|--------|
| weixinzhushou | `dist/weixinzhushou` |
| damai | `dist/damai` |
| tianquan | `dist/tianquan` |
| tongbao | `dist/tongbao` |

**路径解析规则**：

- 相对路径：相对于项目根目录（`package.json` 所在目录）
- 绝对路径：直接使用
- 支持环境变量插值（在 JS 配置中）

### 3.3 app — 应用源码目录

**作用**：指定包含应用 `package.json` 的目录。electron-builder 会从该目录读取应用的元信息（name、version 等），并将该目录作为打包的根目录。

**当前项目**：未配置（使用默认值 = 项目根目录）

**使用场景**：

当项目采用「双 package.json」结构时需要设置此字段：

```
my-app/
├── package.json          # 开发依赖（devDependencies）
├── app/                  # ← directories.app 指向这里
│   ├── package.json      # 运行时依赖（dependencies）
│   ├── main.js
│   └── index.html
└── node_modules/
```

```yaml
directories:
  app: app
```

> **说明**：「双 package.json」是 electron-builder 早期推荐的模式，用于将开发依赖和运行时依赖分离。现代项目通常使用单 `package.json` + `files` 字段过滤即可，不需要设置 `app`。

---

## 四、注意事项

### 4.1 buildResources 与 win.icon 的优先级

当同时配置了 `buildResources` 目录中的图标和 `win.icon` 时：

```yaml
directories:
  buildResources: build      # build/icon.ico 存在

win:
  icon: extraResources/icon.ico  # 显式指定了图标
```

**结果**：`win.icon` 优先。显式指定的平台图标会覆盖 buildResources 中的默认查找。

### 4.2 output 目录会被清空

electron-builder 在构建时**不会自动清空** output 目录。但在 CI/CD 环境中，通常会在构建前手动清理：

```json
"prebuild:weixinzhushou": "rimraf ./dist/weixinzhushou && node changename weixinzhushou"
```

### 4.3 路径中的中文和空格

- electron-builder 支持中文路径，但**强烈建议避免**
- Windows 上中文路径可能导致 NSIS 编译失败
- 路径中的空格需要正确引用

### 4.4 output 与 --dir 模式

```bash
# 仅打包为目录（不生成安装包），用于快速测试
electron-builder --dir

# 此时 output 下会生成 win-unpacked/ 目录
dist/weixinzhushou/
└── win-unpacked/
    ├── Weixinzhushou.exe
    ├── resources/
    ├── locales/
    └── ...
```

---

## 五、常见问题

### Q1：buildResources 目录不存在会怎样？

不会报错，但如果没有通过其他方式（如 `win.icon`）指定图标，打包时会使用 Electron 默认图标。

### Q2：能否将 output 设置为项目外的路径？

可以使用绝对路径，例如 `/tmp/build-output`。但不推荐，因为 CI/CD 环境中绝对路径不可移植。

### Q3：directories.app 与 files 字段的关系？

- `directories.app`：改变 electron-builder 查找 `package.json` 的根目录
- `files`：在确定的根目录下，控制哪些文件打包进 asar

两者是互补关系，`app` 决定「从哪里开始」，`files` 决定「包含/排除哪些文件」。

---

*文档生成时间：2026-03-16 | 基于 electron-builder 官方文档与项目实际配置分析*
