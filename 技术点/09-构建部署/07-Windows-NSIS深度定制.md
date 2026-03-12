# Windows NSIS 深度定制

> Windows 平台打包的核心：NSIS 安装程序配置与自定义脚本

---

## 一、NSIS 概述

NSIS (Nullsoft Scriptable Install System) 是 Windows 平台最流行的安装程序制作工具，electron-builder 默认使用 NSIS 创建 Windows 安装包。

```
┌─────────────────────────────────────────────────────────────┐
│                    NSIS 安装包生成流程                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  electron-builder                                           │
│       │                                                     │
│       ▼                                                     │
│  ┌─────────────────┐                                       │
│  │  NSIS 配置      │  ← electron-builder.yml 中的 nsis 节   │
│  │  (builder配置)  │                                       │
│  └────────┬────────┘                                       │
│           │                                                 │
│           ▼                                                 │
│  ┌─────────────────┐                                       │
│  │  installer.nsh  │  ← 自定义 NSIS 脚本（可选）            │
│  │  (自定义脚本)   │                                       │
│  └────────┬────────┘                                       │
│           │                                                 │
│           ▼                                                 │
│  ┌─────────────────┐                                       │
│  │  NSIS 编译器    │  → 生成 .exe 安装包                   │
│  └─────────────────┘                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、NSIS 配置项全解

### 2.1 基础配置

```yaml
nsis:
  # === 安装模式 ===
  
  # 一键安装（无界面直接安装）
  oneClick: false
  # true:  直接安装到默认位置，无确认界面
  # false: 显示安装向导，可选择安装位置
  
  # 允许选择安装目录
  allowToChangeInstallationDirectory: true
  # 仅在 oneClick: false 时有效
  
  # 允许提升权限（UAC）
  allowElevation: true
  # 如果需要安装到 Program Files 需要此权限
  
  # 安装范围
  perMachine: false
  # false: 安装到当前用户 (C:\Users\xxx\AppData\Local\Programs\)
  # true:  安装到系统目录 (C:\Program Files\)，需要管理员权限
```

### 2.2 快捷方式配置

```yaml
nsis:
  # 创建桌面快捷方式
  createDesktopShortcut: true
  # always: 总是创建
  # true:   默认勾选
  # false:  不创建
  
  # 创建开始菜单快捷方式
  createStartMenuShortcut: true
  
  # 快捷方式名称（默认使用 productName）
  shortcutName: "My Application"
  
  # 菜单链接（开始菜单中的文件夹名）
  menuCategory: false
  # false: 直接放在开始菜单
  # true:  使用 productName 作为文件夹名
  # "CategoryName": 自定义文件夹名
```

### 2.3 安装完成行为

```yaml
nsis:
  # 安装后运行程序
  runAfterFinish: true
  
  # 卸载时删除应用数据
  deleteAppDataOnUninstall: false
  # 注意：这会删除用户配置，谨慎使用
  
  # 卸载时显示的显示名称
  uninstallDisplayName: "${productName} ${version}"
```

### 2.4 界面定制

```yaml
nsis:
  # 安装图标
  installerIcon: build/icon.ico
  
  # 卸载图标
  uninstallerIcon: build/icon.ico
  
  # 安装向导头部图片（150x57 BMP）
  installerHeader: build/installerHeader.bmp
  
  # 安装向导头部图标（用于标题栏）
  installerHeaderIcon: build/icon.ico
  
  # 安装向导侧边栏图片（164x314 BMP）
  installerSidebar: build/installerSidebar.bmp
  
  # 卸载向导侧边栏
  uninstallerSidebar: build/uninstallerSidebar.bmp
  
  # 许可协议文件
  license: LICENSE.txt
  # 支持格式：txt, rtf, html
```

**图片规格要求**：
```
┌─────────────────────────────────────────────────────────────┐
│                    NSIS 界面图片规格                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  installerHeader:     150 x 57  像素，24位 BMP              │
│  installerSidebar:    164 x 314 像素，24位 BMP              │
│  icon:                256 x 256 像素（或更大），ICO格式      │
│                                                             │
│  ┌────────────────────────────────────────┐                │
│  │  ┌──────────────────────┐ [Header]    │                │
│  │  │                      │  150x57     │                │
│  │  └──────────────────────┘             │                │
│  │  ┌────┐                               │                │
│  │  │    │                               │                │
│  │  │Side│                               │                │
│  │  │bar │                               │                │
│  │  │164 │       安装内容区域              │                │
│  │  │x   │                               │                │
│  │  │314 │                               │                │
│  │  │    │                               │                │
│  │  └────┘                               │                │
│  └────────────────────────────────────────┘                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.5 语言配置

```yaml
nsis:
  # 使用 Unicode NSIS（支持中文等）
  unicode: true
  
  # 安装语言（LCID）
  language: 2052
  # 2052: 简体中文
  # 1033: 英语
  # 1028: 繁体中文
  
  # 多语言支持
  installerLanguages:
    - en_US
    - zh_CN
```

**常用语言 LCID**：
| 语言 | LCID |
|------|------|
| 英语 (US) | 1033 |
| 简体中文 | 2052 |
| 繁体中文 | 1028 |
| 日语 | 1041 |
| 韩语 | 1042 |
| 德语 | 1031 |
| 法语 | 1036 |

### 2.6 高级配置

```yaml
nsis:
  # 自定义 NSIS 脚本
  include: installer.nsh
  # 包含自定义脚本文件
  
  # 脚本内联
  script: installer.nsh
  # 使用完整的自定义脚本（替代默认脚本）
  
  # 额外的 NSIS 插件目录
  customNsisBinary: null
  
  # 压缩方式
  # lzma | zlib | default
  
  # 安装目录变量
  # $INSTDIR 默认值由 perMachine 决定
  
  # 是否显示安装详情
  displayLanguageSelector: false
  
  # 差分更新包
  differentialPackage: true
  # 生成 blockmap 用于增量更新
```

---

## 三、win 平台配置

### 3.1 target 类型

```yaml
win:
  target:
    # NSIS 标准安装包
    - target: nsis
      arch:
        - x64       # 64位
        - ia32      # 32位
        - arm64     # ARM64
    
    # 便携版（绿色版）
    - target: portable
      arch: x64
    
    # 在线安装包
    - target: nsis-web
      arch: x64
```

**各 target 对比**：

| Target | 说明 | 特点 |
|--------|------|------|
| `nsis` | 标准安装包 | 最常用，功能完整 |
| `nsis-web` | 在线安装包 | 小体积安装器，运行时下载 |
| `portable` | 便携版 | 无需安装，直接运行 |
| `appx` | Windows Store | UWP 格式 |
| `msi` | MSI 安装包 | 企业部署 |
| `squirrel` | Squirrel 框架 | 自动更新集成 |
| `dir` | 仅目录 | 调试用 |

### 3.2 执行权限

```yaml
win:
  # 请求的执行级别
  requestedExecutionLevel: asInvoker
  
  # asInvoker:          普通权限（默认）
  # requireAdministrator: 需要管理员权限
  # highestAvailable:   最高可用权限
```

**选择建议**：
```
┌─────────────────────────────────────────────────────────────┐
│                   执行级别选择指南                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  asInvoker（推荐）:                                         │
│  • 普通应用                                                 │
│  • 不需要修改系统设置                                        │
│  • 用户体验最好（无 UAC 弹窗）                               │
│                                                             │
│  highestAvailable:                                          │
│  • 系统工具类应用                                           │
│  • 需要时才提升权限                                         │
│                                                             │
│  requireAdministrator:                                      │
│  • 系统级安装程序                                           │
│  • 驱动安装                                                 │
│  • 注意：每次运行都弹 UAC                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 签名配置

```yaml
win:
  # 证书文件路径
  certificateFile: path/to/cert.pfx
  
  # 证书密码（环境变量）
  certificatePassword: ${WIN_CSC_KEY_PASSWORD}
  
  # 或使用证书主题名
  certificateSubjectName: "My Company"
  
  # 或使用 SHA1 指纹
  certificateSha1: "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
  
  # 时间戳服务器
  timeStampServer: "http://timestamp.digicert.com"
  
  # 签名算法
  signingHashAlgorithms:
    - sha256
  
  # 是否签名 DLL
  signDlls: false
  
  # 额外签名参数
  additionalCertificateFile: null
```

### 3.4 其他 win 配置

```yaml
win:
  # 图标
  icon: build/icon.ico
  
  # 发布者名称（显示在属性中）
  publisherName: "My Company"
  
  # 法律商标
  legalTrademarks: "MyApp™ is a trademark"
  
  # 文件关联
  fileAssociations:
    - ext: myapp
      name: "MyApp Document"
      description: "MyApp Document File"
      icon: document.ico
      role: Editor
  
  # 协议注册（URL Scheme）
  protocols:
    - name: "MyApp Protocol"
      schemes:
        - myapp
```

---

## 四、installer.nsh 自定义脚本

### 4.1 NSIS 脚本基础

```nsis
# NSIS 脚本语法基础

# 变量定义
Var MyVariable

# 函数定义
Function MyFunction
  ; 函数体
  StrCpy $MyVariable "value"
FunctionEnd

# 宏定义
!macro MyMacro param1 param2
  ; 宏体
  DetailPrint "param1=${param1}, param2=${param2}"
!macroend

# 调用宏
!insertmacro MyMacro "arg1" "arg2"

# 条件判断
${If} $MyVariable == "value"
  ; do something
${ElseIf} $MyVariable == "other"
  ; do other
${Else}
  ; default
${EndIf}

# 比较运算符
# ==, !=, <, >, <=, >=
# S==, S!=, S<, S> (字符串比较)

# 文件操作
SetOutPath "$INSTDIR"
File "myfile.txt"
Delete "$INSTDIR\oldfile.txt"
RMDir /r "$INSTDIR\olddir"

# 注册表操作
WriteRegStr HKCU "Software\MyApp" "InstallPath" "$INSTDIR"
ReadRegStr $0 HKCU "Software\MyApp" "InstallPath"
DeleteRegKey HKCU "Software\MyApp"

# 消息框
MessageBox MB_OK|MB_ICONINFORMATION "安装完成！"
MessageBox MB_YESNO "是否继续？" IDYES yes IDNO no
yes:
  ; 用户点击了是
  Goto done
no:
  ; 用户点击了否
done:
```

### 4.2 electron-builder 提供的宏

electron-builder 在 NSIS 脚本中预定义了一些宏，可以在 `installer.nsh` 中使用：

```nsis
# 可用的钩子宏
!macro preInit           # 初始化之前
!macro customInit        # 安装向导初始化
!macro customHeader      # 自定义头部
!macro customInstall     # 安装完成后执行
!macro customUnInstall   # 卸载时执行
!macro customRemoveFiles # 删除文件前
!macro customInstallMode # 自定义安装模式

# 可用的变量
$INSTDIR        # 安装目录
$APPDATA        # 用户应用数据目录
$LOCALAPPDATA   # 本地应用数据
$DESKTOP        # 桌面路径
$STARTMENU      # 开始菜单路径
$PROGRAMFILES   # Program Files 目录
$PROGRAMFILES64 # Program Files (x64)
```

### 4.3 常用自定义脚本示例

#### 检测程序是否运行

```nsis
# installer.nsh

!macro customInit
  # 检测程序是否正在运行
  nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq ${PRODUCT_FILENAME}.exe" /NH'
  Pop $0  # 返回码
  Pop $1  # 输出
  
  ${If} $1 != ""
  ${AndIf} $1 != "信息: 没有运行的任务匹配指定标准。"
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION \
      "检测到 ${PRODUCT_NAME} 正在运行。$\r$\n$\r$\n请关闭程序后重试，或点击确定自动关闭。" \
      IDOK killApp IDCANCEL abortInstall
    
    killApp:
      # 强制结束进程
      nsExec::Exec 'taskkill /F /IM "${PRODUCT_FILENAME}.exe"'
      Sleep 1000
      Goto done
    
    abortInstall:
      Abort "安装已取消"
    
    done:
  ${EndIf}
!macroend
```

#### 检测并卸载旧版本

```nsis
!macro customInit
  # 读取旧版本安装路径
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "UninstallString"
  
  ${If} $0 != ""
    MessageBox MB_YESNO|MB_ICONQUESTION \
      "检测到已安装的旧版本。$\r$\n$\r$\n是否先卸载旧版本？" \
      IDYES uninstallOld IDNO skipUninstall
    
    uninstallOld:
      # 提取卸载程序路径
      ${GetParent} $0 $1
      
      # 静默卸载
      ExecWait '"$0" /S _?=$1'
      
      # 等待卸载完成
      Sleep 2000
      
      # 删除卸载程序本身
      Delete "$0"
      RMDir "$1"
    
    skipUninstall:
  ${EndIf}
!macroend
```

#### 系统要求检查

```nsis
!macro customInit
  # 检查 Windows 版本
  ${If} ${AtMostWinVista}
    MessageBox MB_OK|MB_ICONSTOP \
      "此程序需要 Windows 7 或更高版本。"
    Abort
  ${EndIf}
  
  # 检查 64 位系统
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP \
      "此程序需要 64 位操作系统。"
    Abort
  ${EndIf}
  
  # 检查可用磁盘空间（需要 500MB）
  ${GetRoot} "$INSTDIR" $0
  ${DriveSpace} $0 "/D=F /S=M" $1
  ${If} $1 < 500
    MessageBox MB_OK|MB_ICONSTOP \
      "磁盘空间不足，至少需要 500MB 可用空间。"
    Abort
  ${EndIf}
!macroend
```

#### 安装后执行自定义操作

```nsis
!macro customInstall
  # 写入自定义注册表
  WriteRegStr HKCU "Software\${PRODUCT_NAME}" "InstallTime" "$_CLICK_INSTALL_TIME"
  WriteRegStr HKCU "Software\${PRODUCT_NAME}" "Version" "${VERSION}"
  
  # 创建程序数据目录
  CreateDirectory "$APPDATA\${PRODUCT_NAME}"
  
  # 复制默认配置文件（如果不存在）
  ${IfNot} ${FileExists} "$APPDATA\${PRODUCT_NAME}\config.json"
    CopyFiles /SILENT "$INSTDIR\resources\default-config.json" "$APPDATA\${PRODUCT_NAME}\config.json"
  ${EndIf}
  
  # 注册为开机启动（可选）
  ; WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_NAME}" "$INSTDIR\${PRODUCT_FILENAME}.exe"
  
  # 添加到 PATH 环境变量（谨慎使用）
  ; EnVar::AddValue "PATH" "$INSTDIR\bin"
!macroend
```

#### 自定义卸载

```nsis
!macro customUnInstall
  # 结束正在运行的程序
  nsExec::Exec 'taskkill /F /IM "${PRODUCT_FILENAME}.exe"'
  Sleep 500
  
  # 删除注册表
  DeleteRegKey HKCU "Software\${PRODUCT_NAME}"
  
  # 询问是否删除用户数据
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "是否删除用户数据和配置文件？$\r$\n$\r$\n位置：$APPDATA\${PRODUCT_NAME}" \
    IDYES deleteData IDNO keepData
  
  deleteData:
    RMDir /r "$APPDATA\${PRODUCT_NAME}"
  
  keepData:
  
  # 移除开机启动
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_NAME}"
!macroend
```

#### 协议注册（URL Scheme）

```nsis
!macro customInstall
  # 注册 myapp:// 协议
  WriteRegStr HKCU "Software\Classes\myapp" "" "URL:MyApp Protocol"
  WriteRegStr HKCU "Software\Classes\myapp" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\myapp\DefaultIcon" "" "$INSTDIR\${PRODUCT_FILENAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\myapp\shell\open\command" "" '"$INSTDIR\${PRODUCT_FILENAME}.exe" "%1"'
!macroend

!macro customUnInstall
  # 移除协议注册
  DeleteRegKey HKCU "Software\Classes\myapp"
!macroend
```

#### 文件关联

```nsis
!macro customInstall
  # 注册 .myapp 文件关联
  WriteRegStr HKCU "Software\Classes\.myapp" "" "MyApp.Document"
  WriteRegStr HKCU "Software\Classes\MyApp.Document" "" "MyApp Document"
  WriteRegStr HKCU "Software\Classes\MyApp.Document\DefaultIcon" "" "$INSTDIR\${PRODUCT_FILENAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\MyApp.Document\shell\open\command" "" '"$INSTDIR\${PRODUCT_FILENAME}.exe" "%1"'
  
  # 刷新图标缓存
  System::Call 'shell32.dll::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
!macroend

!macro customUnInstall
  # 移除文件关联
  DeleteRegKey HKCU "Software\Classes\.myapp"
  DeleteRegKey HKCU "Software\Classes\MyApp.Document"
  
  # 刷新图标缓存
  System::Call 'shell32.dll::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
!macroend
```

### 4.4 完整的 installer.nsh 示例

```nsis
# installer.nsh - 完整示例

# ==============================
# 安装前检查
# ==============================
!macro preInit
  # 设置安装日志
  SetDetailsPrint both
!macroend

!macro customInit
  # 检测程序运行
  !insertmacro CheckAppRunning
  
  # 检测旧版本
  !insertmacro CheckOldVersion
  
  # 系统要求检查
  !insertmacro CheckSystemRequirements
!macroend

# 检测程序运行的宏
!macro CheckAppRunning
  FindWindow $0 "" "${PRODUCT_NAME}"
  ${If} $0 != 0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION \
      "${PRODUCT_NAME} 正在运行。$\r$\n$\r$\n点击确定关闭程序并继续安装。" \
      IDOK closeApp IDCANCEL abortInst
    
    closeApp:
      nsExec::Exec 'taskkill /F /IM "${PRODUCT_FILENAME}.exe"'
      Sleep 1000
      Goto checkDone
    
    abortInst:
      Abort
    
    checkDone:
  ${EndIf}
!macroend

# 检测旧版本的宏
!macro CheckOldVersion
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "QuietUninstallString"
  
  ${If} $R0 != ""
    ReadRegStr $R1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "DisplayVersion"
    
    MessageBox MB_YESNOCANCEL|MB_ICONQUESTION \
      "检测到已安装版本 $R1$\r$\n$\r$\n是否卸载旧版本后继续安装？" \
      IDYES doUninstall IDNO skipUninstall IDCANCEL abortInstall
    
    doUninstall:
      ExecWait '$R0'
      Sleep 1000
      Goto uninstallDone
    
    skipUninstall:
      Goto uninstallDone
    
    abortInstall:
      Abort
    
    uninstallDone:
  ${EndIf}
!macroend

# 系统要求检查的宏
!macro CheckSystemRequirements
  # Windows 7+
  ${If} ${AtMostWinVista}
    MessageBox MB_OK|MB_ICONSTOP "需要 Windows 7 或更高版本"
    Abort
  ${EndIf}
!macroend

# ==============================
# 安装后操作
# ==============================
!macro customInstall
  # 写入安装信息
  WriteRegStr HKCU "Software\${PRODUCT_NAME}" "InstallPath" "$INSTDIR"
  WriteRegStr HKCU "Software\${PRODUCT_NAME}" "Version" "${VERSION}"
  
  # 创建数据目录
  CreateDirectory "$APPDATA\${PRODUCT_NAME}\logs"
  CreateDirectory "$APPDATA\${PRODUCT_NAME}\cache"
  
  # 注册协议
  !insertmacro RegisterProtocol
  
  # 注册文件关联（如果需要）
  ; !insertmacro RegisterFileAssociation
!macroend

!macro RegisterProtocol
  WriteRegStr HKCU "Software\Classes\${PRODUCT_NAME}" "" "URL:${PRODUCT_NAME} Protocol"
  WriteRegStr HKCU "Software\Classes\${PRODUCT_NAME}" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\${PRODUCT_NAME}\DefaultIcon" "" "$INSTDIR\${PRODUCT_FILENAME}.exe,0"
  WriteRegStr HKCU "Software\Classes\${PRODUCT_NAME}\shell\open\command" "" '"$INSTDIR\${PRODUCT_FILENAME}.exe" "%1"'
!macroend

# ==============================
# 卸载操作
# ==============================
!macro customUnInstall
  # 关闭运行中的程序
  nsExec::Exec 'taskkill /F /IM "${PRODUCT_FILENAME}.exe"'
  Sleep 500
  
  # 询问是否删除数据
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "是否删除用户数据？$\r$\n$\r$\n数据位置：$APPDATA\${PRODUCT_NAME}" \
    IDYES removeData IDNO keepData
  
  removeData:
    RMDir /r "$APPDATA\${PRODUCT_NAME}"
  
  keepData:
  
  # 清理注册表
  DeleteRegKey HKCU "Software\${PRODUCT_NAME}"
  DeleteRegKey HKCU "Software\Classes\${PRODUCT_NAME}"
  
  # 刷新系统
  System::Call 'shell32.dll::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
!macroend
```

---

## 五、单实例控制

### 5.1 应用层单实例

在 Electron 主进程中实现：

```javascript
// main.js
const { app } = require('electron')

// 请求单实例锁
const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  // 另一个实例已在运行
  app.quit()
} else {
  // 当第二个实例启动时触发
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // 聚焦到主窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      mainWindow.focus()
      
      // 处理命令行参数（如协议链接）
      const url = commandLine.find(arg => arg.startsWith('myapp://'))
      if (url) {
        handleProtocolUrl(url)
      }
    }
  })
  
  // 正常初始化应用...
  app.whenReady().then(createWindow)
}
```

### 5.2 安装时检测

在 installer.nsh 中检测已运行实例：

```nsis
!macro customInit
  # 使用互斥锁检测
  System::Call 'kernel32::CreateMutex(i 0, i 0, t "${PRODUCT_NAME}Mutex") ?e'
  Pop $0
  
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION \
      "${PRODUCT_NAME} 正在运行，请先关闭后再安装。"
    Abort
  ${EndIf}
!macroend
```

---

## 六、Windows 特殊问题处理

### 6.1 长路径问题（MAX_PATH 260 限制）

**问题**：Windows 默认路径长度限制 260 字符，node_modules 容易超出。

**解决方案**：

1. **使用 asar 打包**（推荐）：
```yaml
asar: true  # asar 内部不受 260 限制
```

2. **Windows 10+ 启用长路径**：
```nsis
!macro customInstall
  # 启用长路径支持（需要管理员权限）
  WriteRegDWORD HKLM "SYSTEM\CurrentControlSet\Control\FileSystem" "LongPathsEnabled" 1
!macroend
```

3. **安装到较短路径**：
```yaml
nsis:
  perMachine: false  # 安装到用户目录（路径较短）
```

### 6.2 中文路径问题

**问题**：某些 native 模块在中文路径下加载失败。

**解决方案**：

```javascript
// main.js - 检测并警告
const path = require('path')
const appPath = app.getAppPath()

if (/[^\x00-\x7F]/.test(appPath)) {
  dialog.showErrorBox(
    '路径警告',
    '应用安装路径包含中文字符，可能导致部分功能异常。\n建议安装到纯英文路径。'
  )
}

// 或使用 8.3 短路径
const { execSync } = require('child_process')
function getShortPath(longPath) {
  try {
    const result = execSync(`for %I in ("${longPath}") do @echo %~sI`, {
      encoding: 'utf8',
      shell: 'cmd.exe'
    })
    return result.trim()
  } catch {
    return longPath
  }
}
```

### 6.3 杀毒软件误报

**问题**：新发布的程序可能被杀毒软件误报。

**解决方案**：

1. **使用代码签名**（最重要）：
```yaml
win:
  certificateFile: cert.pfx
  certificatePassword: ${WIN_CSC_KEY_PASSWORD}
```

2. **提交到杀毒软件厂商**：
   - Microsoft: https://www.microsoft.com/wdsi/filesubmission
   - 360: https://open.soft.360.cn/
   - 腾讯: https://guanjia.qq.com/

3. **发布前扫描**：
   - https://www.virustotal.com/

### 6.4 SmartScreen 警告

**问题**：Windows SmartScreen 显示"无法识别的应用"警告。

**解决方案**：

1. **EV 代码签名证书**（最有效）：
   - Extended Validation 证书立即获得信誉
   - 普通 OV 证书需要积累下载量

2. **积累下载信誉**：
   - 使用同一证书持续发布
   - 用户量增加后警告会消失

3. **用户指引**：
```
当出现 SmartScreen 警告时：
1. 点击"更多信息"
2. 点击"仍要运行"
```

### 6.5 UAC 处理

**问题**：UAC 弹窗影响用户体验。

**最佳实践**：

```yaml
# 尽量避免需要管理员权限
win:
  requestedExecutionLevel: asInvoker

nsis:
  perMachine: false  # 安装到用户目录，不需要管理员权限
  allowElevation: true  # 但允许用户选择提升
```

```javascript
// 在应用中按需提升权限
const { exec } = require('child_process')

function runAsAdmin(command) {
  return new Promise((resolve, reject) => {
    exec(`powershell -Command "Start-Process cmd -ArgumentList '/c ${command}' -Verb RunAs"`, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}
```

---

## 七、调试 NSIS 脚本

### 7.1 启用详细日志

```bash
# 安装时显示详细信息
# 按住 Ctrl+Alt+T 查看日志

# 或使用命令行参数
MyApp-Setup.exe /D=C:\MyApp /S /LOG=install.log
```

### 7.2 NSIS 命令行参数

```bash
# 静默安装
MyApp-Setup.exe /S

# 指定安装目录
MyApp-Setup.exe /D=C:\CustomPath

# 组合使用
MyApp-Setup.exe /S /D=C:\MyApp

# 卸载
MyApp-Uninstaller.exe /S
```

### 7.3 调试宏

```nsis
!macro customInstall
  # 调试输出
  DetailPrint "INSTDIR: $INSTDIR"
  DetailPrint "APPDATA: $APPDATA"
  DetailPrint "VERSION: ${VERSION}"
  
  # 暂停查看
  MessageBox MB_OK "Debug: Check variables"
!macroend
```

---

## 八、完整配置示例

```yaml
# electron-builder.yml - Windows 完整配置

appId: com.example.myapp
productName: My Application

win:
  target:
    - target: nsis
      arch: [x64]
    - target: portable
      arch: [x64]
  
  icon: build/icon.ico
  publisherName: My Company
  legalTrademarks: "MyApp is a trademark of My Company"
  requestedExecutionLevel: asInvoker
  
  # 签名
  certificateFile: ${WIN_CERT_FILE}
  certificatePassword: ${WIN_CERT_PASSWORD}
  timeStampServer: http://timestamp.digicert.com

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  allowElevation: true
  perMachine: false
  
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: My Application
  
  runAfterFinish: true
  deleteAppDataOnUninstall: false
  
  installerIcon: build/icon.ico
  uninstallerIcon: build/icon.ico
  installerHeader: build/installerHeader.bmp
  installerSidebar: build/installerSidebar.bmp
  
  license: LICENSE.txt
  language: 2052
  unicode: true
  
  include: installer.nsh
  
  differentialPackage: true
```

---

## 参考资源

- [NSIS 官方文档](https://nsis.sourceforge.io/Docs/)
- [NSIS 函数参考](https://nsis.sourceforge.io/Docs/Chapter4.html)
- [electron-builder NSIS 配置](https://www.electron.build/configuration/nsis)
- [NSIS 插件列表](https://nsis.sourceforge.io/Category:Plugins)
