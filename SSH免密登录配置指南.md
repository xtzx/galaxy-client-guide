# SSH 免密登录配置指南

> 本文档记录如何配置 SSH 密钥认证实现免密登录，以及 SSH Config 别名简化连接命令。

---

## 目录

1. [方案概述](#方案概述)
2. [环境信息](#环境信息)
3. [Mac 端配置（客户端）](#mac-端配置客户端)
4. [Windows 端配置（服务端）](#windows-端配置服务端)
5. [验证与测试](#验证与测试)
6. [故障排查](#故障排查)
7. [安全最佳实践](#安全最佳实践)

---

## 方案概述

### 什么是 SSH 密钥认证？

SSH 密钥认证使用**非对称加密**技术，通过公钥/私钥对进行身份验证，无需输入密码。

```
┌─────────────────┐                    ┌─────────────────┐
│     Mac 客户端   │                    │   Windows 服务端 │
│                 │                    │                 │
│  ┌───────────┐  │     SSH 连接       │  ┌───────────┐  │
│  │ 私钥       │  │ ─────────────────→ │  │ 公钥       │  │
│  │ (id_ed25519)│ │                    │  │ (authorized│  │
│  └───────────┘  │     验证成功 ✓      │  │  _keys)    │  │
│                 │ ←───────────────── │  └───────────┘  │
└─────────────────┘                    └─────────────────┘
```

### 方案组成

| 组件 | 作用 |
|------|------|
| **SSH 密钥认证** | 实现免密登录 |
| **SSH Config** | 简化连接命令（`ssh win` 替代 `ssh sshuser@100.78.98.6`） |

---

## 环境信息

| 角色 | 系统 | IP 地址 | 用户 |
|------|------|---------|------|
| 客户端 | macOS | 172.30.108.154 | bjhl |
| 服务端 | Windows 11 | 172.30.104.9 (局域网) / 100.78.98.6 (Tailscale) | sshuser |

### 已配置的公钥

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFn0hg9wF87858zMl5i70BYLUVsLo1NC2IkorF0TWmnP windows-ssh
```

**⚠️ 重要说明**：`sshuser` 是 Windows 管理员组成员，公钥需要存放在特殊位置。

---

## Mac 端配置（客户端）

### Step 1: 检查是否已有 SSH 密钥

```bash
# 查看是否已有密钥
ls -la ~/.ssh/

# 如果看到 id_ed25519 和 id_ed25519.pub，说明已有密钥，可跳到 Step 3
# 如果没有，继续 Step 2 生成新密钥
```

### Step 2: 生成 SSH 密钥（如果没有）

```bash
# 生成 Ed25519 密钥（推荐，更安全更快）
ssh-keygen -t ed25519 -C "your-email@example.com"

# 按提示操作：
# 1. 密钥保存位置：直接回车使用默认路径 (~/.ssh/id_ed25519)
# 2. 密码短语：可以直接回车留空，或设置一个密码（更安全）
```

**输出示例：**
```
Generating public/private ed25519 key pair.
Enter file in which to save the key (/Users/xxx/.ssh/id_ed25519):
Enter passphrase (empty for no passphrase):
Enter same passphrase again:
Your identification has been saved in /Users/xxx/.ssh/id_ed25519
Your public key has been saved in /Users/xxx/.ssh/id_ed25519.pub
```

### Step 3: 查看公钥内容

```bash
# 显示公钥内容（需要复制到 Windows）
cat ~/.ssh/id_ed25519.pub
```

**输出示例（实际配置）：**
```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFn0hg9wF87858zMl5i70BYLUVsLo1NC2IkorF0TWmnP windows-ssh开发使用
```

> **💡 提示**：`-C` 参数是注释（comment），可以是邮箱、名字或任何标识，不影响加密安全性。

### Step 4: 将公钥复制到 Windows

**⚠️ 由于 sshuser 是管理员用户，不能使用 ssh-copy-id，需要手动复制。**

```bash
# 方法 1: 复制公钥内容到剪贴板
cat ~/.ssh/id_ed25519.pub | pbcopy

# 然后 SSH 登录 Windows（这次还需要密码）
ssh sshuser@100.78.98.6

# 在 Windows PowerShell 中执行（将 YOUR_PUBLIC_KEY 替换为实际公钥）：
# Add-Content -Path "C:\ProgramData\ssh\administrators_authorized_keys" -Value "YOUR_PUBLIC_KEY"
```

```bash
# 方法 2: 一行命令完成（推荐）
cat ~/.ssh/id_ed25519.pub | ssh sshuser@100.78.98.6 'Add-Content -Path "C:\ProgramData\ssh\administrators_authorized_keys" -Value $input'
```

### Step 5: 配置 SSH Config

```bash
# 编辑 SSH 配置文件
nano ~/.ssh/config
# 或
code ~/.ssh/config
```

**添加以下内容：**

```ssh-config
# Windows 远程开发机 - 局域网 IP（当前使用）
Host win
    HostName 172.30.104.9
    User sshuser
    IdentityFile ~/.ssh/id_ed25519
    ServerAliveInterval 60
    ServerAliveCountMax 3

# 备用：使用 Tailscale IP（推荐，永不变化）
Host win-tailscale
    HostName 100.78.98.6
    User sshuser
    IdentityFile ~/.ssh/id_ed25519
    ServerAliveInterval 60
    ServerAliveCountMax 3
```

**配置说明：**

| 配置项 | 说明 |
|--------|------|
| `Host win` | 别名，连接时使用 `ssh win` |
| `HostName` | 服务器 IP 地址 |
| `User` | 登录用户名 |
| `IdentityFile` | 私钥文件路径 |
| `ServerAliveInterval` | 每 60 秒发送心跳，防止断开 |
| `ServerAliveCountMax` | 最多重试 3 次 |

### Step 6: 设置配置文件权限

```bash
# SSH 要求配置文件权限严格
chmod 600 ~/.ssh/config
chmod 600 ~/.ssh/id_ed25519
chmod 644 ~/.ssh/id_ed25519.pub
```

---

## Windows 端配置（服务端）

### 已完成的配置

以下配置已在 Windows 上完成：

#### 1. SSH 服务状态
```powershell
# 检查 SSH 服务
Get-Service sshd
# Status: Running ✅
```

#### 2. sshd_config 配置（⚠️ 关键！）

**文件位置**：`C:\ProgramData\ssh\sshd_config`

```
Port 22
ListenAddress 0.0.0.0

# 启用公钥认证
PubkeyAuthentication yes

# 密码认证（可选保留）
PasswordAuthentication yes

Subsystem sftp sftp-server.exe

# ⚠️ 管理员用户必须添加此配置！
Match Group administrators
    AuthorizedKeysFile __PROGRAMDATA__/ssh/administrators_authorized_keys
```

> **💡 重要知识点**：Windows OpenSSH 对管理员用户（Administrators 组成员）有特殊处理。
> 如果没有 `Match Group administrators` 配置，即使公钥正确也无法免密登录！

#### 3. 公钥存放位置

**⚠️ 重要**：由于 `sshuser` 是管理员组成员，Windows OpenSSH 要求公钥存放在：

```
C:\ProgramData\ssh\administrators_authorized_keys
```

而**不是**用户目录下的 `~/.ssh/authorized_keys`。

**检查用户是否为管理员：**
```powershell
net localgroup Administrators | Select-String "sshuser"
# 如果输出 sshuser，则是管理员
```

#### 4. 文件权限

```powershell
# 已设置的权限
icacls "C:\ProgramData\ssh\administrators_authorized_keys"
# 输出：
# NT AUTHORITY\SYSTEM:(F)
# BUILTIN\Administrators:(F)
```

### 手动添加公钥（Windows 端操作）

如果需要手动添加公钥，在 Windows PowerShell 中执行：

```powershell
# 方法 1: 使用 .NET 写入（推荐，确保无 BOM）
$pubkey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFn0hg9wF87858zMl5i70BYLUVsLo1NC2IkorF0TWmnP windows-ssh"
[System.IO.File]::WriteAllText("C:\ProgramData\ssh\administrators_authorized_keys", $pubkey + "`n", [System.Text.Encoding]::ASCII)

# 方法 2: 使用 echo（简单）
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFn0hg9wF87858zMl5i70BYLUVsLo1NC2IkorF0TWmnP windows-ssh" > "C:\ProgramData\ssh\administrators_authorized_keys"

# 设置权限
icacls "C:\ProgramData\ssh\administrators_authorized_keys" /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F"

# 重启 SSH 服务
Restart-Service sshd

# 验证公钥指纹
ssh-keygen -l -f "C:\ProgramData\ssh\administrators_authorized_keys"
# 输出: 256 SHA256:7IlOf29oO7TIHET9IhZR3VqjJIEAtEF5GquxsUYtij4 windows-ssh (ED25519) ✅
```

---

## 验证与测试

### 1. 测试免密登录

```bash
# Mac 上执行
ssh win

# 如果成功，会直接登录，不需要输入密码！
# 输出类似：
# Git Aliases Loaded! Type 'galias' for help
# PS C:\Users\sshuser>
```

### 2. 测试详细模式（排查问题）

```bash
# 如果登录失败，使用详细模式查看原因
ssh -vvv win
```

### 3. 测试 Cursor/VS Code 连接

1. 打开 Cursor/VS Code
2. `Cmd + Shift + P` → `Remote-SSH: Connect to Host...`
3. 选择 `win`
4. 应该直接连接成功，无需密码

---

## 故障排查

### 问题 1: 仍然要求输入密码（实际遇到并解决 ✅）

我们在配置过程中实际遇到了这个问题，以下是完整的排查和解决过程：

#### 🔍 诊断步骤

**Step 1: 在 Mac 上使用详细模式连接**
```bash
ssh -vvv sshuser@172.30.104.9
```

**关键日志分析：**
```
debug1: Offering public key: /Users/bjhl/.ssh/id_ed25519 ED25519 SHA256:7IlOf29oO7TIHET9IhZR3VqjJIEAtEF5GquxsUYtij4
debug1: Authentications that can continue: publickey,password,keyboard-interactive
```
↑ 这说明服务器**拒绝了公钥**，问题在 Windows 端。

**Step 2: 在 Windows 上查看 SSH 日志**
```powershell
Get-WinEvent -LogName "OpenSSH/Operational" -MaxEvents 20 | Select-Object TimeCreated, Message | Format-List
```

#### ❌ 原因 A: sshd_config 缺少管理员用户配置（根本原因）

**问题**：Windows OpenSSH 对管理员用户有特殊处理，必须在 `sshd_config` 中显式配置。

**检查配置：**
```powershell
Get-Content "C:\ProgramData\ssh\sshd_config"
```

**错误的配置（缺少关键部分）：**
```
Port 22
ListenAddress 0.0.0.0
PasswordAuthentication yes
Subsystem sftp sftp-server.exe
```

**正确的配置（必须添加）：**
```
Port 22
ListenAddress 0.0.0.0

# 启用公钥认证
PubkeyAuthentication yes

# 密码认证（可选保留）
PasswordAuthentication yes

Subsystem sftp sftp-server.exe

# ⚠️ 关键！管理员用户必须添加此配置
Match Group administrators
    AuthorizedKeysFile __PROGRAMDATA__/ssh/administrators_authorized_keys
```

**修复命令：**
```powershell
$sshdConfig = @"
Port 22
ListenAddress 0.0.0.0
PubkeyAuthentication yes
PasswordAuthentication yes
Subsystem sftp sftp-server.exe

Match Group administrators
    AuthorizedKeysFile __PROGRAMDATA__/ssh/administrators_authorized_keys
"@
$sshdConfig | Set-Content -Path "C:\ProgramData\ssh\sshd_config" -Encoding UTF8
Restart-Service sshd
```

#### ❌ 原因 B: 公钥文件编码问题

**问题**：Windows 创建的文本文件可能包含 BOM（字节顺序标记）或使用 UTF-16 编码，导致 SSH 无法识别公钥。

**验证公钥指纹是否匹配：**
```powershell
# Windows 端
ssh-keygen -l -f "C:\ProgramData\ssh\administrators_authorized_keys"
# 输出: 256 SHA256:7IlOf29oO7TIHET9IhZR3VqjJIEAtEF5GquxsUYtij4 windows-ssh (ED25519)
```

```bash
# Mac 端
ssh-keygen -l -f ~/.ssh/id_ed25519.pub
# 输出应该与上面一致
```

**修复方法（重建公钥文件，确保 ASCII 编码）：**
```powershell
# 删除旧文件
Remove-Item "C:\ProgramData\ssh\administrators_authorized_keys" -Force

# 使用 .NET 写入纯 ASCII 文件（无 BOM）
$pubkey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFn0hg9wF87858zMl5i70BYLUVsLo1NC2IkorF0TWmnP windows-ssh"
[System.IO.File]::WriteAllText("C:\ProgramData\ssh\administrators_authorized_keys", $pubkey + "`n", [System.Text.Encoding]::ASCII)

# 设置权限
icacls "C:\ProgramData\ssh\administrators_authorized_keys" /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F"

# 重启服务
Restart-Service sshd
```

#### ❌ 原因 C: 文件权限问题

```powershell
# 重新设置权限
icacls "C:\ProgramData\ssh\administrators_authorized_keys" /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F"
```

#### ❌ 原因 D: SSH 服务未重启

```powershell
# 修改配置后必须重启
Restart-Service sshd
```

### 问题 2: Permission denied (publickey)

**检查 Mac 端私钥权限：**

```bash
ls -la ~/.ssh/id_ed25519
# 应该是 -rw------- (600)

# 如果不对，修复：
chmod 600 ~/.ssh/id_ed25519
```

### 问题 3: 连接超时

**检查 Tailscale 状态：**

```bash
# Mac 上
tailscale status

# 确保 Windows 机器在线
```

### 问题 4: Host key verification failed

```bash
# 删除旧的 host key
ssh-keygen -R 100.78.98.6

# 重新连接
ssh win
```

---

## 安全最佳实践

### 1. 密钥保护

- ✅ 私钥文件权限设为 600（仅本人可读写）
- ✅ 可以为私钥设置密码短语（passphrase）
- ❌ 永远不要分享私钥

### 2. 定期轮换

```bash
# 建议每年更换一次密钥
ssh-keygen -t ed25519 -C "your-email@example.com" -f ~/.ssh/id_ed25519_2027
```

### 3. 使用 SSH Agent（可选）

如果私钥有密码，可以用 SSH Agent 避免重复输入：

```bash
# 启动 SSH Agent
eval "$(ssh-agent -s)"

# 添加私钥
ssh-add ~/.ssh/id_ed25519

# macOS 可以保存到钥匙串
ssh-add --apple-use-keychain ~/.ssh/id_ed25519
```

---

## 快速参考

### 常用命令

```bash
# 连接 Windows
ssh win

# 复制文件到 Windows
scp file.txt win:/path/to/destination/

# 从 Windows 复制文件
scp win:/path/to/file.txt ./

# 端口转发（例如转发 3000 端口）
ssh -L 3000:localhost:3000 win
```

### 配置文件位置

| 文件 | 位置 |
|------|------|
| Mac 私钥 | `~/.ssh/id_ed25519` |
| Mac 公钥 | `~/.ssh/id_ed25519.pub` |
| Mac SSH Config | `~/.ssh/config` |
| Windows 公钥 | `C:\ProgramData\ssh\administrators_authorized_keys` |
| Windows SSH 配置 | `C:\ProgramData\ssh\sshd_config` |

---

## 附录：SSH 密钥文件命名规则

### 文件名解析

```
id_ed25519
│   │
│   └── ed25519 = 加密算法名称
│
└── id = identity（身份）
```

### Ed25519 名称由来

| 部分 | 含义 |
|------|------|
| **Ed** | Edwards curve（爱德华曲线，一种椭圆曲线） |
| **25519** | 使用的素数 **2²⁵⁵ - 19** |

### SSH 支持的所有算法

| 算法 | 默认文件名 | 推荐度 | 说明 |
|------|-----------|--------|------|
| **Ed25519** | `id_ed25519` | ⭐⭐⭐⭐⭐ | 最新、最安全、最快、密钥最短 |
| RSA | `id_rsa` | ⭐⭐⭐ | 老牌算法，兼容性好，但密钥长 |
| ECDSA | `id_ecdsa` | ⭐⭐ | 椭圆曲线，但有争议 |
| DSA | `id_dsa` | ❌ | 已废弃，不安全 |

### 标准目录结构

```
~/.ssh/
├── id_ed25519          # 私钥（绝对保密！）
├── id_ed25519.pub      # 公钥（可以分享）
├── known_hosts         # 已信任的服务器指纹
├── authorized_keys     # 允许登录的公钥（服务端）
└── config              # SSH 配置文件
```

---

## 实际配置过程中遇到的问题总结

### 问题现象

配置完成后执行 `ssh win` 仍然提示输入密码。

### 排查过程

1. **Mac 端检查**：私钥权限正确（600），SSH Config 配置正确
2. **使用 `ssh -vvv` 详细模式**：发现服务器拒绝了公钥
3. **Windows 端检查日志**：`Get-WinEvent -LogName "OpenSSH/Operational"`
4. **检查 sshd_config**：发现缺少 `Match Group administrators` 配置

### 根本原因

Windows OpenSSH 对管理员用户有特殊处理机制：

| 用户类型 | 公钥文件位置 | 需要 Match 配置 |
|---------|-------------|----------------|
| 普通用户 | `~\.ssh\authorized_keys` | ❌ 不需要 |
| **管理员用户** | `C:\ProgramData\ssh\administrators_authorized_keys` | **✅ 必须** |

### 解决方案

在 `C:\ProgramData\ssh\sshd_config` 末尾添加：

```
Match Group administrators
    AuthorizedKeysFile __PROGRAMDATA__/ssh/administrators_authorized_keys
```

然后重启服务：`Restart-Service sshd`

### 经验教训

1. **管理员用户必须特殊配置** - 这是 Windows OpenSSH 的设计，与 Linux 不同
2. **注意文件编码** - Windows 创建的文本文件可能有 BOM，使用 ASCII 编码最安全
3. **善用调试工具** - `ssh -vvv` 和 Windows 事件日志是排查利器
4. **修改配置后必须重启** - `Restart-Service sshd`

---

## SSH 会话操作技巧

### 退出 SSH 会话

#### 常规退出

```bash
# 方法 1：输入 exit 命令
exit

# 方法 2：输入 logout 命令
logout

# 方法 3：快捷键 Ctrl+D（发送 EOF 信号）
# 在命令行空闲状态下按 Ctrl+D 即可退出
```

#### 强制断开（会话卡死/无响应时）

当远程主机卡死、网络断开导致终端无法正常输入时，普通的 `exit` 或 `Ctrl+C` 都不起作用。此时需要使用 **SSH 转义序列**：

```
按键顺序：Enter → ~ → .
```

即：先按一下**回车**，然后输入 `~.`（波浪号 + 英文句号）。

> 这是 SSH 客户端内置的紧急断开机制，直接由本地 SSH 客户端处理，不依赖远程主机响应。

#### SSH 转义序列完整列表

在 SSH 会话中，按下 `Enter` 后再输入 `~?` 可以查看所有转义命令：

| 按键序列 | 作用 |
|----------|------|
| `~.` | **强制断开连接**（最常用） |
| `~^Z` | 将 SSH 会话挂起到后台（`Ctrl+Z`） |
| `~#` | 列出所有转发的连接 |
| `~&` | 将 SSH 放到后台（等待转发/会话结束后退出） |
| `~?` | 显示转义字符帮助列表 |
| `~~` | 输入一个字面 `~` 字符 |

> **注意**：转义序列必须在**新行开头**输入才会生效，所以要先按 `Enter`。

---

### 常用快捷键

#### 会话控制

| 快捷键 | 作用 | 说明 |
|--------|------|------|
| `Ctrl+D` | 退出会话 | 发送 EOF，等同于 `exit` |
| `Ctrl+C` | 中断当前命令 | 终止正在运行的进程 |
| `Ctrl+Z` | 挂起当前命令 | 将前台进程放到后台暂停，用 `fg` 恢复 |
| `Ctrl+L` | 清屏 | 等同于 `clear` |

#### 命令行编辑

| 快捷键 | 作用 |
|--------|------|
| `Ctrl+A` | 光标移到行首 |
| `Ctrl+E` | 光标移到行尾 |
| `Ctrl+W` | 删除光标前一个单词 |
| `Ctrl+U` | 删除光标前到行首的所有内容 |
| `Ctrl+K` | 删除光标后到行尾的所有内容 |
| `Ctrl+R` | 搜索历史命令（输入关键词反向搜索） |
| `↑` / `↓` | 浏览历史命令 |

#### PowerShell 特有（连接 Windows 后）

Windows SSH 默认 shell 是 PowerShell，部分快捷键行为不同：

| 快捷键 | 作用 |
|--------|------|
| `Tab` | 自动补全（路径、命令、参数） |
| `Ctrl+C` | 中断当前命令 |
| `Ctrl+D` | 退出会话（PowerShell 7+） |
| `↑` / `↓` | 浏览历史命令 |

> **注意**：Windows PowerShell（5.x）中 `Ctrl+D` 不会退出，需要输入 `exit`。

---

### 实用技巧

#### 1. 执行单条命令后自动退出

不需要进入交互式会话，直接在 `ssh` 后面跟命令：

```bash
# 查看 Windows 上的进程
ssh win Get-Process

# 查看磁盘空间
ssh win Get-PSDrive C

# 执行多条命令（用分号分隔）
ssh win "Get-Service sshd; Get-Date"
```

#### 2. 保持长连接不断开

在 `~/.ssh/config` 中配置（当前配置已包含）：

```ssh-config
Host win
    ServerAliveInterval 60    # 每 60 秒发一次心跳
    ServerAliveCountMax 3     # 3 次无响应后才断开
```

#### 3. 连接复用（加速多次连接）

多次 `ssh win` 时，复用已有连接可以省去重复握手的时间：

```ssh-config
Host win
    ControlMaster auto
    ControlPath ~/.ssh/sockets/%r@%h-%p
    ControlPersist 600    # 退出后保持连接 10 分钟
```

需要先创建 socket 目录：

```bash
mkdir -p ~/.ssh/sockets
```

效果：第一次连接正常握手，后续连接**瞬间完成**（复用已有通道）。

#### 4. 端口转发（访问远程服务）

```bash
# 本地端口转发：将远程的 3000 端口映射到本地 3000
ssh -L 3000:localhost:3000 win

# 后台运行端口转发（不打开交互式 shell）
ssh -fNL 3000:localhost:3000 win

# 动态代理（SOCKS5 代理）
ssh -D 1080 win
```

#### 5. 传输文件

```bash
# 复制本地文件到远程
scp ./file.txt win:C:/Users/sshuser/Desktop/

# 复制远程文件到本地
scp win:C:/Users/sshuser/Desktop/file.txt ./

# 复制整个目录（-r 递归）
scp -r ./project win:C:/Users/sshuser/Desktop/

# 使用 rsync 增量同步（更高效，需要远程有 rsync）
rsync -avz ./project/ win:C:/Users/sshuser/Desktop/project/
```

#### 6. 跳板机连接（ProxyJump）

如果需要通过一台中转机器连接目标机器：

```ssh-config
Host target
    HostName 10.0.0.100
    User admin
    ProxyJump win    # 通过 win 跳转
```

```bash
ssh target    # 自动经过 win 跳转到 target
```

#### 7. 查看当前 SSH 配置解析结果

```bash
# 查看 ssh 实际使用的配置（调试 config 文件是否生效）
ssh -G win
```

---

## 更新记录

| 日期 | 更新内容 |
|------|----------|
| 2026-01-26 | 初始版本，配置 SSH 密钥认证和 Config 别名 |
| 2026-01-26 | 添加实际配置信息、密钥命名规则说明 |
| 2026-01-26 | 添加实际排查过程、sshd_config 关键配置、问题总结 |
| 2026-03-02 | 添加 SSH 会话退出方式、快捷键、转义序列、实用技巧 |