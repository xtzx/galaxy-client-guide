# 04 — win Windows 平台配置详解

> `win` 字段是 electron-builder 中 Windows 平台的专属配置区块，控制打包目标格式、应用图标、权限级别、代码签名以及额外资源的复制。

---

## 一、当前项目配置

```yaml
win:
  target: nsis
  legalTrademarks: genshuixue
  icon: extraResources/icon.ico
  requestedExecutionLevel: requireAdministrator

  verifyUpdateCodeSignature: true
  signAndEditExecutable: true
  signDlls: true
  publisherName: 高途教育科技集团有限公司
  signingHashAlgorithms: ["sha256", "sha1"]
  certificateFile: newSignCert.pfx
  certificatePassword: gaotuketang
  sign: sign-script/sign.js

  extraResources:
    - from: extraResources
      to: app/extraResources
      filter:
        - '**/*'
        - '!IPCLIB.lib'
        - '!IPCLIB.pdb'
        - '!IPCService.pdb'
    - from: config/weixinzhushou/runtime.yml
      to: app-config.yml
```

---

## 二、win 字段总览

`win` 字段可以分为五个功能区块：

```
win
├── 打包目标（target）
├── 应用信息（icon, legalTrademarks, publisherName）
├── 权限控制（requestedExecutionLevel）
├── 代码签名（certificateFile, sign, signDlls 等）
└── 额外资源（extraResources, extraFiles）
```

---

## 三、各字段详细说明

### 3.1 打包目标

| 字段 | 类型 | 默认值 | 含义 |
|------|------|--------|------|
| `target` | string \| object \| array | `"nsis"` | 打包输出的格式 |

**target 支持的格式**：

| 格式 | 说明 | 产物 |
|------|------|------|
| `nsis` | NSIS 安装程序（最常用） | `.exe` 安装包 |
| `nsis-web` | NSIS Web 安装程序（在线安装） | 小体积 `.exe` + 在线下载 |
| `portable` | 免安装便携版 | `.exe` 直接运行 |
| `appx` | Windows Store 应用包 | `.appx` |
| `msi` | Windows Installer 包 | `.msi` |
| `squirrel` | Squirrel.Windows 安装程序 | `.exe` + `.nupkg` |
| `7z` | 7-Zip 压缩包 | `.7z` |
| `zip` | ZIP 压缩包 | `.zip` |
| `tar.gz` | tarball 压缩包 | `.tar.gz` |
| `dir` | 仅输出目录（不打包） | 文件夹 |

**高级写法**（指定架构）：

```yaml
# 字符串简写
target: nsis

# 对象形式（指定架构）
target:
  target: nsis
  arch:
    - x64
    - ia32
    - arm64

# 数组形式（多种格式）
target:
  - target: nsis
    arch: [x64]
  - target: portable
    arch: [x64]
  - target: zip
    arch: [x64, ia32]
```

**arch 架构说明**：

| 架构 | 说明 | 场景 |
|------|------|------|
| `x64` | 64 位（最常用） | 现代 Windows PC |
| `ia32` | 32 位 | 兼容旧系统 |
| `arm64` | ARM 64 位 | Surface Pro X 等 ARM 设备 |
| `universal` | 通用（x64 + ia32） | 单安装包兼容所有 |

### 3.2 应用信息

| 字段 | 类型 | 默认值 | 含义 |
|------|------|--------|------|
| `icon` | string | `build/icon.ico` | 应用图标文件路径（`.ico` 格式） |
| `legalTrademarks` | string | 无 | 法律商标信息（写入 exe 文件属性） |
| `publisherName` | string | 从证书提取 | 发布者名称（写入 exe 文件属性） |
| `fileVersion` | string | 从 package.json 读取 | 文件版本号 |
| `productVersion` | string | 从 package.json 读取 | 产品版本号 |
| `executableName` | string | `productName` | 可执行文件名 |

**icon 要求**：

```
格式：.ico（Windows 图标格式）
尺寸：必须包含 256×256，建议包含以下尺寸：
      16×16, 32×32, 48×48, 64×64, 128×128, 256×256
色深：32 位（含 alpha 通道）
```

> **当前项目**：`icon: extraResources/icon.ico` — 图标放在 extraResources 目录而非默认的 build 目录。

**文件属性效果**：

右键点击 exe → 属性 → 详细信息：

```
文件说明:     高途微信助手
文件版本:     5.5.0-release01
产品名称:     高途微信助手
产品版本:     5.5.0-release01
版权:         Copyright © 2021 PZTD
法律商标:     genshuixue
公司:         高途教育科技集团有限公司
```

### 3.3 权限控制

| 字段 | 类型 | 默认值 | 含义 |
|------|------|--------|------|
| `requestedExecutionLevel` | string | `"asInvoker"` | Windows 应用的执行权限级别 |

**执行权限级别**：

| 级别 | 说明 | UAC 弹窗 | 使用场景 |
|------|------|---------|---------|
| `asInvoker` | 继承父进程权限 | 不弹窗 | 普通应用（默认） |
| `highestAvailable` | 获取当前用户最高权限 | 管理员用户弹窗 | 需要可选管理员权限的应用 |
| `requireAdministrator` | 强制要求管理员权限 | 必定弹窗 | 需要系统级操作的应用 |

**当前项目使用 `requireAdministrator` 的原因**：

微信助手需要管理员权限来：
1. 安装到 `C:\Program Files\` 目录
2. 操作系统注册表
3. 进程注入相关操作（通过逆向 DLL）
4. 管理 Windows 防火墙规则
5. 操作其他进程

> **注意**：`requireAdministrator` 会导致每次启动应用都弹出 UAC 对话框，影响用户体验。如果只是安装时需要管理员权限，可以考虑使用 `asInvoker`，让安装程序处理权限提升。

---

## 四、代码签名配置详解

代码签名是 Windows 应用发布的重要环节，用于证明软件来源可信、未被篡改。

### 4.1 签名相关字段

| 字段 | 类型 | 默认值 | 含义 |
|------|------|--------|------|
| `certificateFile` | string | 无 | PFX/P12 证书文件路径 |
| `certificatePassword` | string | 无 | 证书密码 |
| `certificateSubjectName` | string | 无 | 证书主体名称（用于从证书存储中选择） |
| `certificateSha1` | string | 无 | 证书 SHA1 指纹（用于精确指定证书） |
| `sign` | string | 无 | 自定义签名脚本路径 |
| `signAndEditExecutable` | boolean | `true` | 是否签名并编辑可执行文件 |
| `signDlls` | boolean | `false` | 是否签名 DLL 文件 |
| `signingHashAlgorithms` | string[] | `["sha256"]` | 签名哈希算法 |
| `verifyUpdateCodeSignature` | boolean | `true` | electron-updater 下载更新包后是否验证签名 |
| `rfc3161TimeStampServer` | string | `"http://timestamp.digicert.com"` | RFC 3161 时间戳服务器 |
| `timeStampServer` | string | `"http://timestamp.digicert.com"` | Authenticode 时间戳服务器 |

### 4.2 签名流程

```
┌─────────────────────────────────────────────────────────────┐
│                    Windows 代码签名流程                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  electron-builder                                           │
│       │                                                     │
│       ▼                                                     │
│  是否配置了 sign 字段？                                     │
│       │                                                     │
│  ┌────┴────┐                                                │
│  │ 是      │ 否                                             │
│  ▼         ▼                                                │
│  调用自定义   使用内置签名逻辑                              │
│  签名脚本     │                                             │
│  (sign.js)   ▼                                              │
│       │      读取 certificateFile + certificatePassword     │
│       │      │                                              │
│       │      ▼                                              │
│       │      调用 signtool.exe                              │
│       │      │                                              │
│       └──────┤                                              │
│              ▼                                              │
│         对每个文件签名：                                     │
│         1. 主 exe 文件                                      │
│         2. 卸载程序 exe                                     │
│         3. DLL 文件（signDlls: true 时）                    │
│         4. 其他可执行文件                                    │
│              │                                              │
│              ▼                                              │
│         附加时间戳（防止证书过期后签名失效）                 │
│              │                                              │
│              ▼                                              │
│         完成签名 ✓                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 signingHashAlgorithms — 双重签名

```yaml
signingHashAlgorithms: ["sha256", "sha1"]
```

| 算法 | 兼容性 | 安全性 |
|------|--------|--------|
| SHA-1 | Windows 7 及以下 | 已弱化，2023 年后不再信任 |
| SHA-256 | Windows 8+ | 当前标准 |

**双重签名（dual signing）** 可以兼容所有 Windows 版本：
- 旧系统验证 SHA-1 签名
- 新系统验证 SHA-256 签名

> **当前项目配置 `["sha256", "sha1"]`** 是正确的做法，确保最大兼容性。

### 4.4 自定义签名脚本

```yaml
sign: sign-script/sign.js
```

当内置签名逻辑不满足需求时（如需要硬件令牌、远程签名服务），可以使用自定义签名脚本：

```javascript
// sign-script/sign.js
exports.default = async function(configuration) {
  // configuration 包含：
  // - path: 待签名文件的路径
  // - hash: 签名算法
  // - name: 产品名称
  // - site: 发布者网站

  const { path, hash } = configuration;

  // 示例：调用外部签名工具
  const { execSync } = require('child_process');
  execSync(`signtool sign /f cert.pfx /p password /fd ${hash} /tr http://timestamp.digicert.com "${path}"`);
}
```

### 4.5 证书密码安全

```yaml
certificatePassword: gaotuketang  # ⚠️ 明文存储
```

**安全风险**：密码明文存储在配置文件中，如果代码仓库泄露，证书也随之泄露。

**推荐方案**：

```yaml
# 方案 1：使用环境变量（推荐）
# 不在 build.yml 中配置 certificatePassword
# 通过环境变量传入
```

```bash
# CI/CD 环境中设置
export CSC_LINK=path/to/cert.pfx
export CSC_KEY_PASSWORD=your_password

# 或者 Windows 环境
set CSC_LINK=path/to/cert.pfx
set CSC_KEY_PASSWORD=your_password
```

```yaml
# 方案 2：使用 Windows 证书存储
win:
  certificateSubjectName: "高途教育科技集团有限公司"
  # 不需要 certificateFile 和 certificatePassword
```

### 4.6 verifyUpdateCodeSignature

```yaml
verifyUpdateCodeSignature: true
```

启用后，`electron-updater` 在下载更新包后会验证其数字签名：
- 确保更新包确实来自正确的发布者
- 防止中间人攻击替换安装包
- 签名验证失败会拒绝安装更新

> **强烈建议保持 `true`**，这是自动更新的重要安全保障。

---

## 五、extraResources 额外资源配置

### 5.1 字段说明

`extraResources` 定义需要复制到安装目录 `resources/` 下的额外文件。

```yaml
extraResources:
  - from: <源路径>        # 相对于项目根目录
    to: <目标路径>        # 相对于 resources/ 目录
    filter:               # 文件过滤规则（可选）
      - '**/*'           # 包含所有
      - '!*.pdb'         # 排除调试文件
```

### 5.2 当前项目的 extraResources 分析

**第一组：复制 extraResources 目录**

```yaml
- from: extraResources
  to: app/extraResources
  filter:
    - '**/*'
    - '!IPCLIB.lib'       # 排除：C++ 静态库（开发用）
    - '!IPCLIB.pdb'       # 排除：调试符号文件
    - '!IPCService.pdb'   # 排除：调试符号文件
```

安装后的路径：

```
C:\Program Files\高途微信助手\
└── resources\
    └── app\
        └── extraResources\
            ├── icon.ico
            ├── Inject\
            │   ├── PipeCore.dll
            │   ├── BasicService.exe
            │   └── ...
            └── ...
```

**第二组：复制运行时配置**

```yaml
- from: config/weixinzhushou/runtime.yml
  to: app-config.yml
```

安装后的路径：

```
C:\Program Files\高途微信助手\
└── resources\
    └── app-config.yml    # 运行时配置文件
```

这是多产品线机制的核心：不同产品线的 `runtime.yml` 都映射为统一的 `app-config.yml`，运行时代码只需要读取 `app-config.yml` 即可。

### 5.3 extraResources 与 extraFiles 的区别

| 对比项 | extraResources | extraFiles |
|--------|---------------|------------|
| **安装位置** | `{安装目录}/resources/` | `{安装目录}/` |
| **代码访问** | `process.resourcesPath` | `path.dirname(process.execPath)` |
| **典型用途** | 应用资源、配置文件、只读数据 | 可执行工具、驱动、DLL |
| **asar 关系** | 与 asar 同级别 | 在 asar 之外 |

```
安装目录/
├── 高途微信助手.exe              # 主程序
├── resources/                   # ← extraResources 的目标
│   ├── app.asar                 # 打包的应用代码
│   ├── app-config.yml           # extraResources 复制来的
│   └── app/
│       └── extraResources/      # extraResources 复制来的
└── extra-tools/                 # ← extraFiles 的目标（如果有）
```

### 5.4 运行时获取 extraResources 路径

```javascript
const path = require('path');

// 开发环境
const devPath = path.join(__dirname, '../extraResources');

// 生产环境（打包后）
const prodPath = path.join(process.resourcesPath, 'app/extraResources');

// 统一获取
const resourcesPath = app.isPackaged
  ? path.join(process.resourcesPath, 'app/extraResources')
  : path.join(__dirname, '../extraResources');
```

---

## 六、其他 win 可用字段

以下字段在当前配置中未使用，但可能有用：

| 字段 | 类型 | 默认值 | 含义 |
|------|------|--------|------|
| `additionalCertificateFile` | string | 无 | 额外证书文件（交叉签名） |
| `azureSignOptions` | object | 无 | Azure 云签名配置 |
| `signExts` | string[] | 无 | 需要签名的额外文件扩展名 |
| `electronUpdaterCompatibility` | string | 无 | electron-updater 兼容性模式 |

---

## 七、当前配置问题汇总

| 问题 | 位置 | 影响 | 建议 |
|------|------|------|------|
| 证书密码明文 | `certificatePassword` | 安全风险 | 改用环境变量 `CSC_KEY_PASSWORD` |
| requireAdministrator | `requestedExecutionLevel` | 每次启动弹 UAC | 评估是否可改为 `asInvoker` |
| legalTrademarks 过时 | `legalTrademarks: genshuixue` | 显示旧品牌名 | 更新为当前品牌 |
| signDlls: true | `signDlls` | 增加构建时间 | 确认是否所有 DLL 都需要签名 |

---

*文档生成时间：2026-03-16 | 基于 electron-builder 官方文档与项目实际配置分析*
