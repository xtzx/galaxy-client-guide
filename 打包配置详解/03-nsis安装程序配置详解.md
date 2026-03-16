# 03 — nsis 安装程序配置详解

> NSIS（Nullsoft Scriptable Install System）是 Windows 平台最流行的安装程序生成工具。electron-builder 内置了 NSIS 支持，通过 `nsis` 字段可以精细控制安装向导的每一个行为。

---

## 一、当前项目配置

```yaml
nsis:
  allowToChangeInstallationDirectory: true
  deleteAppDataOnUninstall: false
  oneClick: false
  perMachine: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  allowElevation: false
  shortcutName: 高途微信助手
  uninstallDisplayName: 高途微信助手
  include: installer.nsh
```

---

## 二、NSIS 是什么

NSIS 是一个开源的脚本驱动的 Windows 安装程序生成系统。electron-builder 使用 NSIS 来生成 `.exe` 安装包，安装流程如下：

```
用户双击 .exe
    │
    ▼
┌─────────────────────────────┐
│  UAC 权限提升对话框          │  ← requestedExecutionLevel 控制
│  （如果需要管理员权限）      │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  安装向导 - 欢迎页          │  ← oneClick: false 时显示
│  选择安装目录                │  ← allowToChangeInstallationDirectory
│  选择组件（如果有）          │
│  确认安装                    │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  解压文件到安装目录          │
│  创建快捷方式                │  ← createDesktopShortcut
│  写入注册表                  │  ← createStartMenuShortcut
│  注册卸载程序                │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  安装完成                    │
│  □ 立即运行程序              │  ← runAfterFinish
└─────────────────────────────┘
```

---

## 三、NSIS 全量字段详解

### 3.1 安装模式控制

| 字段 | 类型 | 默认值 | 含义 |
|------|------|--------|------|
| `oneClick` | boolean | `true` | 是否一键安装（无安装向导） |
| `perMachine` | boolean | `false` | 是否为所有用户安装（安装到 Program Files） |
| `allowElevation` | boolean | `true` | 是否允许用户在安装时提升权限（UAC） |
| `allowToChangeInstallationDirectory` | boolean | `false` | 是否允许用户选择安装目录 |

**oneClick 模式对比**：

```
┌─────────────────────────────────────────────────────────────┐
│              oneClick: true（一键安装）                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  用户双击 .exe → 自动安装 → 完成                            │
│                                                             │
│  特点：                                                     │
│  • 无安装向导界面                                           │
│  • 默认安装到用户目录（%LOCALAPPDATA%）                     │
│  • 不需要管理员权限（perMachine: false 时）                 │
│  • 用户无法选择安装路径                                     │
│  • 适合普通用户、消费级应用                                 │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│              oneClick: false（向导安装）                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  用户双击 .exe → 安装向导 → 选择目录 → 安装 → 完成         │
│                                                             │
│  特点：                                                     │
│  • 显示完整的安装向导界面                                   │
│  • 可配合 allowToChangeInstallationDirectory 使用           │
│  • 适合企业应用、需要自定义安装路径的场景                   │
│  • 可以展示许可协议                                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**perMachine 与安装路径**：

| perMachine | 默认安装路径 | 需要管理员权限 |
|------------|-------------|--------------|
| `false` | `%LOCALAPPDATA%\Programs\{productName}\` | 否 |
| `true` | `C:\Program Files\{productName}\` | 是 |

> **当前项目**：`perMachine: true` + `oneClick: false` = 安装到 Program Files + 显示安装向导。这是企业级应用的典型配置。

### 3.2 allowElevation 与 requestedExecutionLevel 的关系

这是当前配置中存在的**潜在冲突**：

```yaml
nsis:
  allowElevation: false        # 不允许安装程序自行请求提权

win:
  requestedExecutionLevel: requireAdministrator  # 要求以管理员身份运行
```

**行为分析**：

```
┌────────────────────────────────────────────────────────────┐
│                权限提升机制                                 │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  requestedExecutionLevel: requireAdministrator             │
│  → 可执行文件的 manifest 声明需要管理员权限               │
│  → Windows 在启动 .exe 时自动弹出 UAC 对话框             │
│                                                            │
│  allowElevation: false                                     │
│  → NSIS 安装脚本内部不会调用 UAC 提权                     │
│  → 依赖外部已获得的管理员权限                             │
│                                                            │
│  二者配合的效果：                                          │
│  1. Windows 先因 manifest 弹出 UAC                        │
│  2. 用户确认后，安装程序以管理员身份运行                   │
│  3. NSIS 内部不再额外请求提权                             │
│                                                            │
│  ⚠ 如果 requestedExecutionLevel 不是 requireAdministrator │
│  且 allowElevation: false，则安装到 Program Files 会失败  │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 3.3 快捷方式配置

| 字段 | 类型 | 默认值 | 含义 |
|------|------|--------|------|
| `createDesktopShortcut` | boolean \| string | `true` | 是否创建桌面快捷方式。可选值：`true`/`false`/`"always"` |
| `createStartMenuShortcut` | boolean | `true` | 是否在开始菜单创建快捷方式 |
| `shortcutName` | string | `productName` | 快捷方式显示名称 |
| `menuCategory` | boolean \| string | `false` | 开始菜单中的文件夹分类 |

**createDesktopShortcut 的三个值**：

| 值 | 含义 |
|-----|------|
| `true` | 首次安装时创建，更新时保持用户选择 |
| `false` | 不创建 |
| `"always"` | 每次安装/更新都强制创建 |

### 3.4 卸载行为

| 字段 | 类型 | 默认值 | 含义 |
|------|------|--------|------|
| `deleteAppDataOnUninstall` | boolean | `false` | 卸载时是否删除应用数据目录（`%APPDATA%/{productName}`） |
| `uninstallDisplayName` | string | `productName` | 控制面板中「程序和功能」里显示的名称 |

> **当前项目**：`deleteAppDataOnUninstall: false`。卸载时保留用户数据（SQLite 数据库、electron-store 配置等），方便用户重装后恢复。

### 3.5 安装向导界面定制

| 字段 | 类型 | 默认值 | 含义 |
|------|------|--------|------|
| `installerIcon` | string | 应用图标 | 安装程序的图标（.ico 格式） |
| `uninstallerIcon` | string | 应用图标 | 卸载程序的图标 |
| `installerHeader` | string | 无 | 安装向导顶部横幅（150×57 BMP） |
| `installerHeaderIcon` | string | 无 | 安装向导顶部图标 |
| `installerSidebar` | string | 无 | 安装向导左侧边栏图片（164×314 BMP） |
| `uninstallerSidebar` | string | 无 | 卸载向导左侧边栏图片 |
| `license` | string | 无 | 许可协议文件路径（.txt/.rtf/.html） |
| `language` | string | 自动检测 | 安装界面语言代码 |
| `warningIcon` | string | 无 | 警告图标 |
| `displayLanguageSelector` | boolean | `false` | 是否显示语言选择器 |
| `unicode` | boolean | `true` | 是否使用 Unicode 版本的 NSIS |

**语言代码示例**：

| 代码 | 语言 |
|------|------|
| `1033` | 英语（美国） |
| `2052` | 简体中文 |
| `1028` | 繁体中文 |
| `1041` | 日语 |

### 3.6 安装完成行为

| 字段 | 类型 | 默认值 | 含义 |
|------|------|--------|------|
| `runAfterFinish` | boolean | `true` | 安装完成后是否自动运行应用 |

### 3.7 安装目录控制

| 字段 | 类型 | 默认值 | 含义 |
|------|------|--------|------|
| `installerLanguages` | string[] | 无 | 安装程序支持的语言列表 |
| `artifactName` | string | 继承顶层 | 安装包文件名模板 |
| `packElevateHelper` | boolean | `true` | 是否打包 UAC 提权辅助程序 |

### 3.8 自定义 NSIS 脚本

| 字段 | 类型 | 默认值 | 含义 |
|------|------|--------|------|
| `include` | string | 无 | 自定义 NSIS 脚本路径（`.nsh` 文件），**追加**到默认脚本中 |
| `script` | string | 无 | **完全替换**默认 NSIS 脚本（高级用法） |

> **当前项目**使用 `include: installer.nsh`，即在默认安装脚本基础上追加自定义逻辑。

---

## 四、include 与 script 的区别

### 4.1 include — 追加脚本

```yaml
nsis:
  include: installer.nsh
```

`include` 是在 electron-builder 生成的 NSIS 脚本中**插入额外代码**。可以使用以下 NSIS 回调函数：

```nsi
; installer.nsh 示例

; 自定义安装前的逻辑
!macro customHeader
  ; 检查是否已安装旧版本
  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\{appId}" "UninstallString"
  ${If} $0 != ""
    MessageBox MB_YESNO "检测到旧版本，是否先卸载？" IDYES uninstall
    Abort
    uninstall:
      ExecWait '$0 /S'
  ${EndIf}
!macroend

; 自定义安装完成后的逻辑
!macro customInstall
  ; 写入自定义注册表项
  WriteRegStr HKLM "Software\MyApp" "InstallPath" "$INSTDIR"
  
  ; 添加防火墙例外
  nsExec::Exec 'netsh advfirewall firewall add rule name="MyApp" dir=in action=allow program="$INSTDIR\MyApp.exe"'
!macroend

; 自定义卸载逻辑
!macro customUnInstall
  ; 清理注册表
  DeleteRegKey HKLM "Software\MyApp"
  
  ; 移除防火墙规则
  nsExec::Exec 'netsh advfirewall firewall delete rule name="MyApp"'
!macroend
```

**可用的宏回调**：

| 宏名 | 触发时机 |
|------|---------|
| `customHeader` | NSIS 脚本头部（最先执行） |
| `preInit` | 安装向导初始化前 |
| `customInit` | 安装向导初始化时 |
| `customInstall` | 文件安装完成后 |
| `customUnInit` | 卸载向导初始化时 |
| `customUnInstall` | 卸载文件删除后 |
| `customRemoveFiles` | 替换默认的文件删除逻辑 |

### 4.2 script — 完全替换

```yaml
nsis:
  script: custom-installer.nsi
```

使用完全自定义的 NSIS 脚本，electron-builder 不再生成默认脚本。**极少使用**，除非有非常特殊的安装需求。

---

## 五、当前配置逐字段分析

```yaml
nsis:
  allowToChangeInstallationDirectory: true   # ✅ 企业应用需要灵活的安装路径
  deleteAppDataOnUninstall: false            # ✅ 保留用户数据，合理
  oneClick: false                            # ✅ 显示安装向导，专业感
  perMachine: true                           # ✅ 安装到 Program Files
  createDesktopShortcut: true                # ✅ 方便用户启动
  createStartMenuShortcut: true              # ✅ 标准 Windows 体验
  allowElevation: false                      # ⚠️ 见下方分析
  shortcutName: 高途微信助手                 # ✅ 中文名称
  uninstallDisplayName: 高途微信助手          # ✅ 控制面板显示名称
  include: installer.nsh                     # ✅ 自定义安装逻辑
```

### allowElevation: false 的影响

在 `perMachine: true` 的情况下：
- 安装到 `C:\Program Files\` 需要管理员权限
- `allowElevation: false` 意味着 NSIS 脚本不会主动请求提权
- **依赖** `win.requestedExecutionLevel: requireAdministrator` 在 exe 启动时获取管理员权限

这种配置的实际效果是：
1. 用户双击安装包 → Windows UAC 弹窗（因为 manifest 要求管理员权限）
2. 用户确认 → 安装程序以管理员身份运行
3. NSIS 安装脚本正常写入 Program Files

虽然不是「冲突」，但逻辑不够清晰。建议改为 `allowElevation: true` 更符合语义。

---

## 六、缺失的推荐配置

当前配置缺少一些有用的字段：

```yaml
nsis:
  # 推荐补充的配置
  runAfterFinish: true              # 安装完成后自动运行
  installerIcon: build/icon.ico     # 安装程序图标
  uninstallerIcon: build/icon.ico   # 卸载程序图标
  license: LICENSE.txt              # 许可协议（如果有）
  language: 2052                    # 强制简体中文界面
```

---

## 七、注意事项

### 7.1 allowToChangeInstallationDirectory 需要 oneClick: false

```yaml
# ✅ 正确组合
oneClick: false
allowToChangeInstallationDirectory: true

# ❌ 无效 — oneClick: true 时此项被忽略
oneClick: true
allowToChangeInstallationDirectory: true
```

### 7.2 perMachine 与更新

当 `perMachine: true` 时：
- 安装到 Program Files 目录
- 自动更新（electron-updater）也需要管理员权限才能写入
- 如果应用以普通用户身份运行，更新可能失败

### 7.3 中文 shortcutName

NSIS Unicode 版本支持中文快捷方式名称（`unicode: true` 是默认值），但某些旧版 Windows 上可能出现乱码。建议确保：
- NSIS 使用 Unicode 模式（默认）
- 源文件使用 UTF-8 编码

### 7.4 include 文件的路径

`include: installer.nsh` 的路径是**相对于项目根目录**，不是相对于配置文件所在目录。所以 `installer.nsh` 应该放在 `galaxy-client/installer.nsh`。

---

*文档生成时间：2026-03-16 | 基于 electron-builder 官方文档与项目实际配置分析*
