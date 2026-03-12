# Windows OpenSSH Server 配置问题排查实践总结

> 本文档记录了在 Windows 企业域环境下配置 OpenSSH Server 的完整过程，重点总结遇到的问题及解决方案。

---

## 背景

- **目标**：在 Windows 电脑上配置 SSH 服务，允许 Mac 通过 Cursor Remote Development 连接
- **环境**：Windows 11 企业域环境（用户：`baijiahulian\zhouming`）
- **挑战**：企业域环境带来的各种限制和权限问题

---

## 问题一：Windows 内置 OpenSSH 安装失败

### 现象

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
# 错误: 0x800f0907
```

### 原因

企业环境下 WSUS（Windows Server Update Services）组策略限制了从 Windows Update 下载可选功能。

### 解决方案

从 GitHub 手动下载 Win32-OpenSSH：

```powershell
# 下载
$url = "https://github.com/PowerShell/Win32-OpenSSH/releases/download/v9.5.0.0p1-Beta/OpenSSH-Win64.zip"
Invoke-WebRequest -Uri $url -OutFile "$env:USERPROFILE\Downloads\OpenSSH-Win64.zip"

# 解压
Expand-Archive -Path "$env:USERPROFILE\Downloads\OpenSSH-Win64.zip" -DestinationPath "$env:USERPROFILE\Downloads"
```

### 经验总结

- 企业环境下优先考虑手动安装方案
- 保留安装包备份，方便后续部署

---

## 问题二：域用户 SID 查找失败

### 现象

```
debug1: get_passwd: lookup_sid() failed: 1332.
Connection reset by x.x.x.x port 22
```

### 原因

Win32-OpenSSH 在查找域用户（如 `baijiahulian\zhouming`）的 SID 时失败。错误 1332 表示"无法在账户名和安全 ID 之间建立映射"。

### 解决方案

创建**本地用户**专门用于 SSH 连接：

```powershell
# 创建本地用户
$Password = Read-Host -AsSecureString "Enter password"
New-LocalUser -Name "sshuser" -Password $Password -FullName "SSH User"

# 添加到管理员组（可选）
Add-LocalGroupMember -Group "Administrators" -Member "sshuser"
```

### 经验总结

- Win32-OpenSSH 对域用户支持有限
- 建议使用本地账户进行 SSH 认证
- 本地账户名称避免与域用户重复

---

## 问题三：配置文件权限过严

### 现象

```
debug3: Failed to open file:C:/ProgramData/ssh/sshd_config error:13
__PROGRAMDATA__\ssh/sshd_config: Permission denied
```

### 原因

运行 `FixHostFilePermissions.ps1` 脚本后，配置文件权限被设置得过于严格，导致：
1. 当前用户无法读取配置文件
2. 某些情况下 SYSTEM 账户也无法访问

### 解决方案

手动设置合理的权限：

```powershell
# 重置目录权限
icacls "C:\ProgramData\ssh" /inheritance:r `
    /grant "NT AUTHORITY\SYSTEM:(OI)(CI)(F)" `
    /grant "BUILTIN\Administrators:(OI)(CI)(F)"

# Host key 私钥需要更严格的权限
icacls "C:\ProgramData\ssh\ssh_host_*_key" /inheritance:r `
    /grant "NT AUTHORITY\SYSTEM:(F)" `
    /grant "BUILTIN\Administrators:(F)"
```

### 经验总结

- `FixHostFilePermissions.ps1` 脚本可能过度限制权限
- 关键文件权限要求：
  - `sshd_config`：SYSTEM 和 Administrators 可读
  - `ssh_host_*_key`（私钥）：仅 SYSTEM 和 Administrators 可读
  - `ssh_host_*_key.pub`（公钥）：可以更宽松

---

## 问题四：调试模式下无法创建用户进程

### 现象

认证成功后连接立即断开：

```
Accepted password for sshuser from x.x.x.x port xxxxx ssh2
debug1: Not running as SYSTEM: skipping loading user profile
CreateProcessAsUserW failed error:1314
fork of unprivileged child failed
```

### 原因

错误 1314 是 "A required privilege is not held by the client"。

- **调试模式**（`sshd -d`）以当前用户身份运行
- 域用户没有 `SeAssignPrimaryTokenPrivilege` 权限
- 因此无法以其他用户（sshuser）身份创建进程

### 解决方案

必须以**服务模式**运行 sshd，而不是调试模式：

```powershell
# 安装服务
.\install-sshd.ps1

# 启动服务（以 LocalSystem 身份运行）
Start-Service sshd
```

### 经验总结

- 调试模式（`sshd -d`）仅用于查看日志，不能用于实际连接
- 服务模式以 LocalSystem 身份运行，拥有完整权限
- 排查时先用调试模式看日志，确认后切换到服务模式测试

---

## 问题五：服务模式下仍然连接重置

### 现象

```powershell
Get-Service sshd  # Status: Running
ssh sshuser@localhost
# Connection reset by 127.0.0.1 port 22
```

### 原因

OpenSSH 安装在用户目录下（`C:\Users\zhouming\Downloads\OpenSSH-Win64`），虽然服务以 LocalSystem 身份运行，但可能存在路径访问或权限问题。

### 解决方案

将 OpenSSH 移动到标准系统路径：

```powershell
# 停止并删除旧服务
Stop-Service sshd -Force
sc.exe delete sshd
sc.exe delete ssh-agent

# 复制到 Program Files
Copy-Item "C:\Users\zhouming\Downloads\OpenSSH-Win64" "C:\Program Files\OpenSSH" -Recurse -Force

# 重新安装服务
cd "C:\Program Files\OpenSSH"
.\install-sshd.ps1

# 设置权限
icacls "C:\Program Files\OpenSSH" /inheritance:r `
    /grant "NT AUTHORITY\SYSTEM:(OI)(CI)(RX)" `
    /grant "BUILTIN\Administrators:(OI)(CI)(F)" `
    /grant "BUILTIN\Users:(OI)(CI)(RX)"

# 启动服务
Start-Service sshd
```

### 经验总结

- 系统服务的可执行文件应放在系统目录（如 `C:\Program Files`）
- 避免使用用户目录作为服务程序路径
- 确保 SYSTEM 账户对程序目录有执行权限

---

## 最终成功配置清单

### 目录结构

```
C:\Program Files\OpenSSH\          # OpenSSH 程序目录
├── sshd.exe
├── ssh.exe
├── ssh-keygen.exe
├── sftp-server.exe
└── ...

C:\ProgramData\ssh\                # SSH 配置和密钥目录
├── sshd_config                    # 服务端配置文件
├── ssh_host_rsa_key              # RSA 私钥
├── ssh_host_rsa_key.pub          # RSA 公钥
├── ssh_host_ecdsa_key            # ECDSA 私钥
├── ssh_host_ecdsa_key.pub        # ECDSA 公钥
├── ssh_host_ed25519_key          # ED25519 私钥
├── ssh_host_ed25519_key.pub      # ED25519 公钥
└── logs\                          # 日志目录
```

### 最简 sshd_config

```
Port 22
ListenAddress 0.0.0.0
PasswordAuthentication yes
Subsystem sftp sftp-server.exe
```

### 服务配置

```powershell
# 查看服务配置
sc.exe qc sshd

# 应显示：
# BINARY_PATH_NAME: "C:\Program Files\OpenSSH\sshd.exe"
# SERVICE_START_NAME: LocalSystem
```

---

## 调试技巧

### 1. 使用调试模式查看详细日志

```powershell
# 停止服务
Stop-Service sshd -Force

# 调试模式运行（-d 越多日志越详细）
& "C:\Program Files\OpenSSH\sshd.exe" -d -d -d
```

### 2. 客户端详细日志

```bash
ssh -v sshuser@192.168.1.100
# -v: 详细模式
# -vv: 更详细
# -vvv: 最详细
```

### 3. 检查端口监听

```powershell
netstat -ano | Select-String ":22 "
```

### 4. 检查服务状态

```powershell
Get-Service sshd
sc.exe qc sshd
```

### 5. 检查文件权限

```powershell
icacls "C:\ProgramData\ssh\sshd_config"
icacls "C:\ProgramData\ssh\ssh_host_ed25519_key"
```

---

## 常见错误速查表

| 错误 | 可能原因 | 解决方案 |
|------|----------|----------|
| `0x800f0907` | WSUS 限制 | 手动下载安装 |
| `lookup_sid() failed: 1332` | 域用户不支持 | 创建本地用户 |
| `Permission denied` (error 13) | 文件权限问题 | 修复 icacls 权限 |
| `error:1314` | 权限不足 | 以服务模式运行 |
| `Connection reset` | 多种可能 | 检查日志定位 |

---

## 总结

在企业域环境下配置 Windows OpenSSH Server 的关键点：

1. **手动安装**：企业环境可能限制在线安装，需手动下载
2. **本地用户**：使用本地用户而非域用户进行 SSH 认证
3. **标准路径**：将程序安装到 `C:\Program Files` 而非用户目录
4. **权限配置**：确保 SYSTEM 账户有足够权限
5. **服务模式**：必须以服务模式运行，调试模式仅用于排查

---

## 问题六：Cursor Remote 连接后 Git 报 dubious ownership

### 现象

通过 Mac Cursor 远程连接后，在终端执行 Git 命令报错：

```
fatal: detected dubious ownership in repository at 'C:/Users/zhouming/Downloads/galaxy-client'
'C:/Users/zhouming/Downloads/galaxy-client' is owned by:
        BAIJIAHULIAN/zhouming (S-1-5-21-xxx)
but the current user is:
        L10004481/sshuser (S-1-5-21-xxx)
```

### 原因

- 仓库目录由 `zhouming` 用户创建，所有者是 `zhouming`
- SSH 登录使用的是 `sshuser` 用户
- Git 2.35.2+ 版本增加了安全检查，检测到目录所有者与当前用户不匹配

### 解决方案

告诉 Git 信任这个目录：

```powershell
git config --global --add safe.directory C:/Users/zhouming/Downloads/galaxy-client
```

如果有多个项目，可以添加多个目录，或者使用通配符（不推荐，有安全风险）：

```powershell
# 添加多个目录
git config --global --add safe.directory C:/Users/zhouming/Downloads/project1
git config --global --add safe.directory C:/Users/zhouming/Downloads/project2

# 或信任所有目录（不推荐）
git config --global --add safe.directory "*"
```

### 经验总结

- 这是 Git 的安全特性，不是 bug
- 使用不同用户访问同一仓库时会触发
- 按需添加 safe.directory 是最安全的做法

---

## 问题七：IP 地址变化导致连接失败

### 现象

Windows 电脑重启或网络变化后，IP 地址改变，Mac 无法连接。

### 解决方案

**方案 A：使用 Tailscale（推荐）**

Tailscale 分配固定的虚拟 IP，永不改变：

```bash
# Windows Tailscale IP（示例）
100.78.98.6

# Mac 上连接
ssh sshuser@100.78.98.6
```

**方案 B：设置静态 IP**

```powershell
# 查看网络适配器
Get-NetIPConfiguration

# 设置静态 IP（需要管理员权限，需根据实际网络环境修改）
New-NetIPAddress -InterfaceAlias "以太网" -IPAddress 172.30.104.9 -PrefixLength 24 -DefaultGateway 172.30.104.1
```

**方案 C：使用计算机名**

```bash
# 查看计算机名
hostname  # 例如：L10004481

# Mac 上连接（同一局域网）
ssh sshuser@L10004481
```

**方案 D：Mac SSH Config**

在 Mac 的 `~/.ssh/config` 中配置：

```
Host windows-dev
    HostName 100.78.98.6  # Tailscale IP
    User sshuser
    Port 22
```

然后使用 `ssh windows-dev` 或在 Cursor 中连接 `windows-dev`。

### 经验总结

- Tailscale 是最可靠的方案，跨网络也能连接
- 企业网络可能不允许设置静态 IP
- SSH Config 可以简化连接命令

---

## 完整连接流程总结

### Windows 端配置

1. 安装 OpenSSH Server 到 `C:\Program Files\OpenSSH`
2. 创建本地用户 `sshuser`
3. 启动 sshd 服务
4. 配置防火墙允许端口 22
5. （可选）安装 Tailscale

### Mac 端配置

1. 配置 `~/.ssh/config`
2. （可选）安装 Tailscale 并登录同一账号
3. 使用 Cursor Remote-SSH 连接

### 连接后配置

1. 添加 Git safe.directory
2. 验证 Node.js、npm 等环境
3. 打开项目目录开始开发

---

## 问题八：Cursor 终端 SSH 连接失败但本机终端正常

### 现象

Mac 本机终端（Terminal.app / iTerm）可以正常 `ssh win` 连接远程 Windows，但在 Cursor IDE 的集成终端中执行同样的命令失败：

```bash
# Cursor 终端
ssh win
ssh: connect to host 172.30.104.9 port 22: No route to host

# 本机终端
ssh win echo "test"
test  # ✅ 正常
```

`ping` 在 Cursor 终端中同样 100% 丢包：

```bash
# Cursor 终端
ping -c 2 172.30.104.9
2 packets transmitted, 0 packets received, 100.0% packet loss
```

### 排查过程

**1. 对比路由表** — 两个终端结果完全一致：

```bash
route get 172.30.104.9
# 两边输出相同：
#    route to: localhost
# destination: localhost
#   interface: en0
```

**2. 对比 Shell 环境** — 完全一致：

```bash
echo $SHELL        # 相同
env | grep -i proxy # 相同
echo $SSH_AUTH_SOCK # 相同
```

**3. 验证本机终端是否能新建连接** — 可以：

```bash
# 本机终端（全新连接，非复用旧会话）
ssh win echo "test"
test  # ✅
```

路由表相同、环境变量相同、SSH 配置相同，但一个能连一个不能连 — 问题不在网络配置层面。

### 原因

**macOS「本地网络」权限未授予 Cursor。**

从 macOS Monterey（12.0）开始，系统引入了按应用控制「本地网络」访问的权限机制。`172.30.x.x` 属于内网/局域网 IP 范围，macOS 将其归类为「本地网络」。

- **Terminal.app / iTerm**：系统默认信任或已授权，可以正常访问局域网
- **Cursor**：作为第三方应用，未被授予「本地网络」权限，macOS 在网络层**静默丢弃**了所有从 Cursor 进程（包括其集成终端子进程）发出的到局域网 IP 的数据包

关键特征：macOS 不会弹出任何提示或报错，只是静默丢包，导致表现为 `No route to host` 或 `Request timeout`。

### 解决方案

**系统设置 → 隐私与安全性 → 本地网络** → 找到 **Cursor** → 打开开关

```bash
# 授权后验证
ping -c 2 172.30.104.9
# 2 packets transmitted, 2 packets received, 0.0% packet loss ✅
```

### 经验总结

- macOS 的「本地网络」权限是**按应用**控制的，与系统路由表、防火墙无关
- 被限制时系统**静默丢包**，不会弹窗提示，排查时容易误判为网络问题
- 所有第三方应用（VS Code、Cursor、Warp 等）首次访问局域网时都可能需要授权
- 如果 `route get`、`env` 等全部一致但就是不通，优先检查这个权限

---

## 补充知识：macOS 网络相关权限一览

macOS 对应用的网络访问有多层控制，排查连接问题时需要逐一检查：

| 权限位置 | 作用 | 影响范围 |
|----------|------|----------|
| **隐私与安全性 → 本地网络** | 控制应用是否可以访问局域网设备 | 局域网 IP（10.x、172.16-31.x、192.168.x） |
| **隐私与安全性 → 防火墙** | 控制传入连接 | 所有入站连接 |
| **防火墙 → 选项 → 应用列表** | 按应用允许/阻止传入连接 | 特定应用的入站连接 |
| **第三方防火墙**（Little Snitch、Lulu 等） | 控制出站连接 | 所有出站连接 |

### SSH 连接故障排查顺序

当 SSH 连接失败时，建议按以下顺序排查：

```
1. ping 目标 IP          → 不通？检查网络/VPN/路由
2. 对比不同终端           → 部分终端不通？检查 macOS 应用权限
3. telnet IP 22          → 端口不通？检查目标防火墙
4. ssh -vvv user@host    → 握手失败？检查 SSH 配置/密钥
5. 查看服务端日志          → 认证失败？检查用户/权限
```

### 常用诊断命令

```bash
# 检查路由
route get <目标IP>

# 检查网络可达性
ping -c 3 <目标IP>

# 检查端口可达性（不依赖 ICMP）
nc -zv <目标IP> 22

# 检查 VPN 虚拟网卡是否存在
ifconfig | grep -A 2 utun

# 检查 SSH 详细日志
ssh -vvv <host>

# 检查当前 SSH 配置解析结果
ssh -G <host>
```

---

## 更新记录

| 日期 | 更新内容 |
|------|----------|
| 2026-01-23 | 初始版本，记录完整排查过程 |
| 2026-01-23 | 添加 Git dubious ownership、IP 变化问题及解决方案 |
| 2026-03-02 | 添加 macOS 本地网络权限导致 Cursor 终端 SSH 失败的问题及排查过程 |

