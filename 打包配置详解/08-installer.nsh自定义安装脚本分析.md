# 08 — installer.nsh 自定义安装脚本分析

> `installer.nsh` 是 NSIS 自定义安装脚本，通过 `build.yml` 中 `nsis.include: installer.nsh` 引入。它在安装程序初始化阶段执行，负责清理旧进程、删除旧数据和阻止微信自动更新。

---

## 一、引入方式

**build.yml 配置**：

```yaml
nsis:
  include: installer.nsh    # 引入自定义 NSIS 脚本
```

`include` 的含义是：在 electron-builder 自动生成的 NSIS 安装脚本中**插入**自定义代码。与 `script`（完全替换）不同，`include` 是追加模式。

**文件路径**：`galaxy-client/installer.nsh`（项目根目录，不是 config 目录）

---

## 二、NSIS 脚本基础语法

在分析脚本前，先了解 NSIS 的基本语法：

| 语法元素 | 说明 | 示例 |
|----------|------|------|
| `;` | 注释（单行） | `; 这是注释` |
| `!macro ... !macroend` | 定义宏（代码块） | `!macro customInit ... !macroend` |
| `$0` - `$9` | 寄存器变量 | `FileOpen $0 "file" w` |
| `$temp` | 系统临时目录 | `C:\Users\xxx\AppData\Local\Temp` |
| `$INSTDIR` | 安装目标目录 | `C:\Program Files\高途微信助手` |
| `$PROFILE` | 用户主目录 | `C:\Users\xxx` |
| `FileOpen` / `FileClose` | 打开/关闭文件 | `FileOpen $0 "path" w` |
| `Sleep` | 等待（毫秒） | `Sleep 4000` |
| `ExecWait` | 执行外部命令并等待 | `ExecWait "taskkill ..."` |
| `Delete` | 删除文件 | `Delete "path\file.db"` |

---

## 三、完整脚本逐行分析

```nsi
!macro customInit
```

### 宏定义

`customInit` 是 electron-builder 预定义的宏名称。该宏在**安装向导初始化阶段**执行，即用户看到安装界面之前。

electron-builder 支持的宏回调：

| 宏名 | 执行时机 |
|------|---------|
| `customHeader` | 脚本最开始 |
| `preInit` | 初始化前 |
| **`customInit`** | **初始化时（当前使用）** |
| `customInstall` | 文件安装完成后 |
| `customUnInit` | 卸载初始化时 |
| `customUnInstall` | 卸载完成后 |

---

### 步骤 1：创建安装标记文件

```nsi
FileOpen $0 "$temp\suicideMark" w
FileClose $0
```

**作用**：在系统临时目录创建一个空文件 `suicideMark`。

**执行效果**：

```
创建文件：C:\Users\{user}\AppData\Local\Temp\suicideMark
```

**设计意图**：

```
┌────────────────────────────────────────────────────────────┐
│  suicideMark 标记文件的用途                                │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  当「高途微信助手」主程序运行时，它会定期检查             │
│  $temp/suicideMark 文件是否存在。                         │
│                                                            │
│  如果存在 → 说明安装程序正在运行（正在升级/覆盖安装）     │
│  → 主程序主动退出，释放文件锁                             │
│  → 安装程序可以正常覆盖文件                               │
│                                                            │
│  这是一种「协作退出」机制：                               │
│  安装程序放置标记 → 运行中的主程序发现标记 → 自行退出     │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

**相关代码**（主进程检测逻辑）：

在 `galaxy-client/src` 中有对应的检测代码，主程序启动后会监控该标记文件，发现后执行自杀流程（故名 "suicideMark"）。

---

### 步骤 2：等待进程响应

```nsi
Sleep 4000
```

**作用**：等待 4 秒（4000 毫秒）。

**设计意图**：

1. 给主程序检测 suicideMark 并自行退出留出时间
2. 如果主程序没有自动退出，后续的 taskkill 强制终止

**问题**：

- 4 秒是硬编码值，不够灵活
- 如果主程序退出较慢（如正在保存数据），4 秒可能不够
- 如果主程序已经不在运行，4 秒的等待是浪费

---

### 步骤 3：强制终止冲突进程

```nsi
ExecWait "taskkill -f -t -im javaw.exe"
ExecWait "taskkill -f -t -im weixinzhushou.exe"
ExecWait "taskkill -f -t -im WeChat.exe"
ExecWait "taskkill -f -t -im 高途微信助手.exe"
ExecWait "taskkill -f -t -im BasicService.exe"
ExecWait "taskkill -f -t -im BasicService64.exe"
ExecWait "taskkill -f -t -im InjectHelp.exe"
```

**taskkill 参数说明**：

| 参数 | 含义 |
|------|------|
| `-f` | 强制终止（force），不等待进程优雅退出 |
| `-t` | 终止整个进程树（包括子进程） |
| `-im` | 按映像名称（进程名）匹配 |

**各进程说明**：

| 进程 | 说明 | 终止原因 |
|------|------|---------|
| `javaw.exe` | Java 无窗口进程 | 逆向服务通过 Java 运行，升级时需要重启 |
| `weixinzhushou.exe` | 旧版微信助手主程序 | 避免旧版进程占用文件 |
| `WeChat.exe` | 微信主程序 | ⚠️ 注入 DLL 后微信需要重启才能加载新版本 |
| `高途微信助手.exe` | 新版微信助手主程序 | 覆盖安装时需要释放文件锁 |
| `BasicService.exe` | 基础服务进程（32位） | 逆向桥接服务，需要随主程序一起更新 |
| `BasicService64.exe` | 基础服务进程（64位） | 同上 |
| `InjectHelp.exe` | 注入辅助进程 | DLL 注入辅助工具 |

**执行流程**：

```
ExecWait "taskkill -f -t -im javaw.exe"
   │
   ├── 进程存在 → 强制终止 → taskkill 返回 0
   └── 进程不存在 → taskkill 返回错误码（128）→ ExecWait 忽略
   │
   ▼
ExecWait "taskkill -f -t -im weixinzhushou.exe"
   │
   ▼
  ... 依次执行每个 taskkill 命令
```

**⚠️ 风险分析**：

| 风险 | 说明 | 影响 |
|------|------|------|
| 强制终止微信 | `WeChat.exe` 被 `-f` 强杀 | 用户正在进行的聊天会中断，未发送的消息可能丢失 |
| 强制终止 Java | `javaw.exe` 被强杀 | 可能正在处理任务的 Java 进程数据丢失 |
| 没有用户确认 | 直接终止所有进程 | 用户可能不知道微信被关闭了 |
| 没有错误处理 | taskkill 失败时无处理 | 如果进程被占用无法终止，安装可能会覆盖失败 |
| javaw.exe 范围过大 | 所有 Java 进程都会被终止 | 如果用户有其他 Java 程序在运行，也会被误杀 |

---

### 步骤 4：清理旧版本数据库

```nsi
Delete $PROFILE\AppData\Roaming\weixinzhushou\data.db
Delete $PROFILE\AppData\Roaming\weixinzhushou\sqlite.db
```

**路径展开**：

```
$PROFILE = C:\Users\{username}
完整路径：C:\Users\{username}\AppData\Roaming\weixinzhushou\data.db
完整路径：C:\Users\{username}\AppData\Roaming\weixinzhushou\sqlite.db
```

**说明**：

| 文件 | 用途 | 删除原因 |
|------|------|---------|
| `data.db` | electron-store 导出的数据文件 | 新版本数据结构可能变化，清除旧数据避免兼容性问题 |
| `sqlite.db` | SQLite 数据库文件 | 新版本表结构可能变化（Sequelize migration） |

**⚠️ 风险分析**：

| 风险 | 说明 |
|------|------|
| 数据不可恢复 | 删除后用户的历史数据（好友列表缓存、群信息等）全部丢失 |
| 没有备份机制 | 删除前未创建备份文件 |
| 每次安装都执行 | 即使是小版本更新也会删除数据库 |

**改进建议**：

```nsi
; 备份而非删除
Rename $PROFILE\AppData\Roaming\weixinzhushou\data.db $PROFILE\AppData\Roaming\weixinzhushou\data.db.bak
Rename $PROFILE\AppData\Roaming\weixinzhushou\sqlite.db $PROFILE\AppData\Roaming\weixinzhushou\sqlite.db.bak
```

---

### 步骤 5：执行阻止微信更新脚本

```nsi
ExecWait '"$INSTDIR\resources\app\extraResources\prevent_wx_update.bat"'
```

**作用**：运行 `prevent_wx_update.bat` 批处理脚本，通过修改系统 hosts 文件阻止微信自动更新。

**为什么要阻止微信更新**：

```
┌────────────────────────────────────────────────────────────┐
│  阻止微信更新的原因                                        │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  微信助手通过 DLL 注入与特定版本的微信配合工作。          │
│  每个客户端版本绑定特定的微信版本：                       │
│                                                            │
│  runtime.yml 中定义了支持的版本：                         │
│  SUPPORTED_WX_VERSIONS:                                   │
│    - 3.7.5.31                                             │
│    - 3.8.0.18                                             │
│                                                            │
│  如果微信自动更新到不支持的版本：                         │
│  → DLL 注入会失败                                         │
│  → 接口地址偏移量不匹配                                   │
│  → 微信助手功能完全失效                                   │
│                                                            │
│  因此，必须锁定微信版本，防止其自动更新。                 │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

**⚠️ 路径问题**：

```
$INSTDIR = C:\Program Files\高途微信助手

脚本路径：C:\Program Files\高途微信助手\resources\app\extraResources\prevent_wx_update.bat
```

- **首次安装时**：`$INSTDIR` 目录可能还不存在（安装目录在安装阶段才创建），此时该脚本执行会失败（静默失败）
- **覆盖安装时**：旧版本的文件仍在，脚本可以正常执行

---

### 步骤 6：等待脚本完成

```nsi
Sleep 2000
!macroend
```

等待 2 秒，确保 `prevent_wx_update.bat` 执行完毕。

---

## 四、执行时序总图

```
用户双击安装包 (.exe)
    │
    ▼
Windows UAC 弹窗（requireAdministrator）
    │ 用户确认
    ▼
NSIS 安装程序启动
    │
    ▼
┌─ customInit 宏执行 ──────────────────────────────────────┐
│                                                          │
│  ① 创建 suicideMark 标记文件                            │
│     → %TEMP%\suicideMark                                │
│     │                                                    │
│  ② Sleep 4000 (等待主程序自行退出)                       │
│     │                                                    │
│  ③ taskkill 强制终止冲突进程                             │
│     → javaw.exe                                         │
│     → weixinzhushou.exe                                 │
│     → WeChat.exe                                        │
│     → 高途微信助手.exe                                   │
│     → BasicService.exe / BasicService64.exe             │
│     → InjectHelp.exe                                    │
│     │                                                    │
│  ④ 删除旧版数据库                                       │
│     → weixinzhushou/data.db                             │
│     → weixinzhushou/sqlite.db                           │
│     │                                                    │
│  ⑤ 执行阻止微信更新脚本                                 │
│     → prevent_wx_update.bat                             │
│     │                                                    │
│  ⑥ Sleep 2000 (等待脚本完成)                             │
│                                                          │
└──────────────────────────────────────────────────────────┘
    │
    ▼
显示安装向导（选择安装目录等）
    │ 用户点击安装
    ▼
NSIS 解压文件到 $INSTDIR
    │
    ▼
创建快捷方式、写入注册表
    │
    ▼
安装完成
```

---

## 五、问题汇总与改进建议

| 编号 | 问题 | 建议 |
|------|------|------|
| 1 | `Sleep 4000` 硬编码 | 使用循环检测进程是否退出，而非固定等待 |
| 2 | 强制关闭微信无用户确认 | 添加 `MessageBox` 提示用户保存工作 |
| 3 | `javaw.exe` 范围过大 | 通过窗口标题或命令行参数精确匹配 |
| 4 | 数据库直接删除无备份 | 先 Rename 备份，再删除旧备份 |
| 5 | 首次安装时 bat 路径不存在 | 添加 `IfFileExists` 判断后再执行 |
| 6 | suicideMark 未清理 | 安装完成后删除标记文件 |
| 7 | taskkill 错误未处理 | 检查返回码，必要时重试或提示用户 |

**改进后的脚本参考**：

```nsi
!macro customInit
    ; 创建安装标记
    FileOpen $0 "$temp\suicideMark" w
    FileClose $0
    
    ; 等待主程序检测标记并退出
    Sleep 4000
    
    ; 提示用户将关闭微信
    MessageBox MB_OK|MB_ICONINFORMATION "安装程序将关闭微信及相关进程，请确保已保存重要信息。"
    
    ; 强制终止进程
    ExecWait "taskkill -f -t -im javaw.exe"
    ExecWait "taskkill -f -t -im weixinzhushou.exe"
    ExecWait "taskkill -f -t -im WeChat.exe"
    ExecWait "taskkill -f -t -im 高途微信助手.exe"
    ExecWait "taskkill -f -t -im BasicService.exe"
    ExecWait "taskkill -f -t -im BasicService64.exe"
    ExecWait "taskkill -f -t -im InjectHelp.exe"
    
    ; 备份旧数据库（而非删除）
    IfFileExists "$PROFILE\AppData\Roaming\weixinzhushou\data.db" 0 +2
        Rename "$PROFILE\AppData\Roaming\weixinzhushou\data.db" "$PROFILE\AppData\Roaming\weixinzhushou\data.db.bak"
    IfFileExists "$PROFILE\AppData\Roaming\weixinzhushou\sqlite.db" 0 +2
        Rename "$PROFILE\AppData\Roaming\weixinzhushou\sqlite.db" "$PROFILE\AppData\Roaming\weixinzhushou\sqlite.db.bak"
    
    ; 仅在文件存在时执行阻止微信更新脚本
    IfFileExists "$INSTDIR\resources\app\extraResources\prevent_wx_update.bat" 0 +2
        ExecWait '"$INSTDIR\resources\app\extraResources\prevent_wx_update.bat"'
    
    Sleep 2000
    
    ; 清理安装标记
    Delete "$temp\suicideMark"
!macroend
```

---

*文档生成时间：2026-03-16 | 基于 galaxy-client/installer.nsh 实际代码分析*
