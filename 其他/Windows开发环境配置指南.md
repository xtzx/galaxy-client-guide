# Windows 开发环境配置指南

> 本文档记录了在 Windows 电脑上配置开发环境的完整步骤，包括 Git、Node.js、npm 源配置以及 Cursor Remote Development 设置。

---

## 目录

1. [环境概览](#环境概览)
2. [Git 配置](#git-配置)
3. [Node.js 版本管理 (nvm)](#nodejs-版本管理-nvm)
4. [npm 源管理 (nrm)](#npm-源管理-nrm)
5. [VS Code / Cursor Remote Development 配置](#vs-code--cursor-remote-development-配置)
6. [常用命令速查](#常用命令速查)

---

## 环境概览

| 组件 | 版本 | 说明 |
|------|------|------|
| Windows | 10.0.22631 | 操作系统 |
| Git | 2.52.0.windows.1 | 版本控制 |
| nvm-windows | 1.2.2 | Node.js 版本管理器 |
| Node.js | 18.20.8 (当前激活) | JavaScript 运行时 |
| npm | 10.8.2 | 包管理器 |
| nrm | 最新版 | npm 源管理器 |
| OpenSSH | 8.6p1 | SSH 客户端/服务端 |

---

## Git 配置

### 当前配置

```bash
# 查看配置
git config --global user.name   # 输出: zhouming
git config --global user.email  # 输出: zhouming@baijiahulian.com
```

### 修改配置

```bash
# 设置用户名
git config --global user.name "你的用户名"

# 设置邮箱
git config --global user.email "你的邮箱@example.com"

# 查看所有配置
git config --global --list
```

### 凭据管理

Windows Git 使用 **Git Credential Manager** 管理 HTTPS 密码，首次 clone/push 会弹窗让你输入账号密码并自动保存。

```bash
# 查看凭据管理器
git config --global credential.helper

# 清除保存的凭据（如需重新登录）
# 方法1: 通过 Windows 凭据管理器
# 控制面板 -> 用户账户 -> 凭据管理器 -> Windows 凭据 -> 找到 git:http://git.baijia.com 删除

# 方法2: 命令行
git credential reject <<EOF
protocol=http
host=git.baijia.com
EOF
```

---

## Node.js 版本管理 (nvm)

### 什么是 nvm？

nvm (Node Version Manager) 允许你在同一台电脑上安装和切换多个 Node.js 版本，非常适合需要维护多个项目的开发者。

### 已安装的 Node.js 版本

```
16.20.2
18.20.8  ← 当前使用
20.20.0
```

### 常用命令

```bash
# 查看已安装的版本
nvm list

# 查看可安装的版本
nvm list available

# 安装特定版本
nvm install 20.20.0
nvm install 18.20.8
nvm install 16.20.2

# 切换版本（⚠️ 需要管理员权限的终端）
nvm use 18.20.8    # 切换到 Node 18
nvm use 16.20.2    # 切换到 Node 16
nvm use 20.20.0    # 切换到 Node 20

# 设置默认版本
nvm alias default 18.20.8

# 卸载版本
nvm uninstall 14.21.3

# 查看当前版本
nvm current
node --version
npm --version
```

### ⚠️ 重要提示

1. **nvm use 命令需要管理员权限**
   - 右键点击 PowerShell 或 CMD，选择"以管理员身份运行"
   - 然后执行 `nvm use 18.20.8`

2. **切换版本后全局包需要重新安装**
   - 每个 Node 版本有独立的全局包目录
   - 切换版本后需要重新安装 nrm 等全局包

---

## npm 源管理 (nrm)

### 什么是 nrm？

nrm (npm registry manager) 是一个 npm 源管理工具，可以快速切换不同的 npm 源（如官方源、淘宝源、公司私有源等）。

### 当前配置

```
  npm ---------- https://registry.npmjs.org/
  yarn --------- https://registry.yarnpkg.com/
  tencent ------ https://mirrors.tencent.com/npm/
  cnpm --------- https://r.cnpmjs.org/
  taobao ------- https://registry.npmmirror.com/
  npmMirror ---- https://skimdb.npmjs.com/registry/
  huawei ------- https://repo.huaweicloud.com/repository/npm/
* baijia ------- http://npm.baijia.com/   ← 当前使用
```

### 常用命令

```bash
# 查看所有源
nrm ls

# 切换源
nrm use baijia    # 切换到公司私有源
nrm use taobao    # 切换到淘宝镜像（速度快）
nrm use npm       # 切换到官方源

# 添加自定义源
nrm add <名称> <地址>
nrm add baijia http://npm.baijia.com/

# 删除源
nrm del <名称>

# 测试源速度
nrm test
nrm test baijia

# 查看当前源
npm config get registry
```

### 手动设置源（不使用 nrm）

```bash
# 直接设置 npm 源
npm config set registry http://npm.baijia.com/

# 恢复官方源
npm config set registry https://registry.npmjs.org/

# 查看当前源
npm config get registry
```

---

## VS Code / Cursor Remote Development 配置

### 方案说明

使用 **SSH Remote** 方案，让 Mac 电脑（主力机）通过 SSH 连接到 Windows 电脑进行远程开发。

**优势：**
- 代码运行在 Windows 上，Mac 只做编辑
- 利用 Windows 的 CPU/内存/GPU 资源
- 网络延迟低（局域网内）
- 支持完整的终端、调试、Git 操作

### 步骤 1: 在 Windows 上安装 OpenSSH Server（需管理员权限）

**方法 A: 通过 PowerShell（推荐）**

以管理员身份打开 PowerShell，执行：

```powershell
# 1. 安装 OpenSSH Server
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0

# 2. 启动 SSH 服务
Start-Service sshd

# 3. 设置开机自启
Set-Service -Name sshd -StartupType 'Automatic'

# 4. 确认防火墙规则（通常自动配置）
Get-NetFirewallRule -Name *ssh*

# 如果没有防火墙规则，手动添加：
New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
```

**方法 B: 通过设置界面**

1. 打开 **设置** → **应用** → **可选功能**
2. 点击 **添加功能**
3. 搜索 **OpenSSH 服务器**
4. 点击安装
5. 安装完成后，打开 **服务** (services.msc)
6. 找到 **OpenSSH SSH Server**，右键 → **属性**
7. 启动类型设为 **自动**，点击 **启动**

### 步骤 2: 获取 Windows IP 地址

```powershell
# 查看 IP 地址
ipconfig

# 找到 "以太网适配器" 或 "无线局域网适配器" 下的 IPv4 地址
# 例如: 192.168.1.100
```

### 步骤 3: 在 Mac 上配置 Cursor/VS Code

1. 安装 **Remote - SSH** 扩展
2. 按 `Cmd + Shift + P`，输入 `Remote-SSH: Connect to Host...`
3. 输入: `zhouming@<Windows-IP>`
   - 例如: `zhouming@192.168.1.100`
4. 首次连接会提示输入密码（Windows 登录密码）
5. 连接成功后，打开远程文件夹: `C:\Users\zhouming\Downloads\galaxy-client`

### 步骤 4: 配置 SSH 免密登录（可选但推荐）

**在 Mac 上执行：**

```bash
# 1. 生成 SSH 密钥（如果没有）
ssh-keygen -t ed25519 -C "你的邮箱"

# 2. 复制公钥到 Windows
# 方法 A: 手动复制
cat ~/.ssh/id_ed25519.pub
# 复制输出内容

# 方法 B: 使用 ssh-copy-id（如果支持）
ssh-copy-id zhouming@<Windows-IP>
```

**在 Windows 上执行（管理员 PowerShell）：**

```powershell
# 创建 .ssh 目录
mkdir C:\Users\zhouming\.ssh -Force

# 创建/编辑 authorized_keys 文件
notepad C:\Users\zhouming\.ssh\authorized_keys
# 粘贴 Mac 的公钥内容，保存

# 设置权限（重要！）
icacls C:\Users\zhouming\.ssh\authorized_keys /inheritance:r /grant "zhouming:F" /grant "SYSTEM:F"
```

### 网络环境说明

| 场景 | 解决方案 |
|------|----------|
| 同一局域网 | 直接使用内网 IP 连接 |
| 不同网络 | 使用 Tailscale / ZeroTier 组建虚拟局域网 |
| 公网访问 | 路由器端口映射（不推荐，安全风险） |

**推荐使用 Tailscale：**
1. 在 Windows 和 Mac 上都安装 Tailscale
2. 使用相同账号登录
3. 使用 Tailscale 分配的 IP 地址连接

---

## 常用命令速查

### Git 命令

```bash
# 克隆仓库
git clone http://git.baijia.com/pandora/tongbao/galaxy-client.git

# 查看状态
git status

# 拉取更新
git pull

# 提交代码
git add .
git commit -m "feat: 添加新功能"
git push

# 切换分支
git checkout <branch-name>
git checkout -b <new-branch>  # 创建并切换

# 查看分支
git branch -a
```

### Node.js / npm 命令

```bash
# 安装依赖
npm install
# 或
yarn install

# 运行开发环境
npm run dev
# 或
yarn dev

# 打包构建
npm run build
# 或
yarn build

# 清理缓存
npm cache clean --force
```

### 项目相关

```bash
# 进入项目目录
cd C:\Users\zhouming\Downloads\galaxy-client

# 安装依赖
npm install

# 查看 package.json 中的脚本
npm run
```

---

## 故障排查

### nvm use 报错 "需要管理员权限"

以管理员身份运行 PowerShell 或 CMD。

### npm install 报错 "network error"

1. 检查 npm 源: `npm config get registry`
2. 切换到公司源: `nrm use baijia`
3. 如果公司源不可用，临时使用淘宝源: `nrm use taobao`

### SSH 连接被拒绝

1. 确认 Windows 上 sshd 服务正在运行:
   ```powershell
   Get-Service sshd
   ```
2. 确认防火墙允许 22 端口
3. 确认 IP 地址正确

### Cursor Remote 连接后终端中 node 命令找不到

nvm 安装的 Node.js 路径可能未添加到系统 PATH。解决方法：

```powershell
# 以管理员身份运行
nvm use 18.20.8
```

---

## 更新记录

| 日期 | 更新内容 |
|------|----------|
| 2026-01-23 | 初始版本，完成基础环境配置 |

