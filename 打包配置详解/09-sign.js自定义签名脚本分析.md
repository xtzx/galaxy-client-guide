# 09 — sign.js 自定义签名脚本分析

> `sign-script/sign.js` 是 electron-builder 打包时使用的自定义代码签名脚本，通过 `build.yml` 中 `win.sign: sign-script/sign.js` 引入。它使用硬件 USB Token（eToken）进行数字签名。

---

## 一、引入方式

**build.yml 配置**：

```yaml
win:
  sign: sign-script/sign.js     # 自定义签名脚本
  certificateFile: newSignCert.pfx
  certificatePassword: gaotuketang
  signingHashAlgorithms: ["sha256", "sha1"]
```

当配置了 `win.sign` 字段时，electron-builder **不使用内置签名逻辑**，转而调用自定义脚本对每个需要签名的文件执行签名操作。

---

## 二、完整代码分析

```javascript
// sign-script/sign.js
const { execSync } = require("child_process");

async function customSign({ path }) {
    console.log(`sign start: ${path}`);
    const signCmd = `C:\\Users\\gaotu\\AppData\\Local\\electron-builder\\Cache\\winCodeSign\\winCodeSign-2.6.0\\windows-10\\x64\\signtool.exe sign /f sign.cer /tr http://timestamp.digicert.com /td sha256 /fd sha256 /csp "eToken Base Cryptographic Provider" /k "[{{gaotuketang}}]=p11#d00227ab28d4c2e3" ${path}`;
    try {
        execSync(signCmd, { stdio: 'inherit' });
        console.log(`sign success: ${path}`);
    } catch (error) {
        console.error(`sign error: ${error}`);
    }
}

exports.default = function(signingOptions) {
    customSign(signingOptions);
};
```

---

## 三、逐行解析

### 3.1 导出函数

```javascript
exports.default = function(signingOptions) {
    customSign(signingOptions);
};
```

electron-builder 要求签名脚本导出一个 `default` 函数。打包时，electron-builder 会对每个需要签名的文件调用此函数。

**signingOptions 参数结构**：

```javascript
{
  path: "C:\\...\\dist\\win-unpacked\\高途微信助手.exe",  // 待签名文件路径
  hash: "sha256",                                         // 签名哈希算法
  name: "高途微信助手",                                   // 产品名称
  site: undefined,                                        // 发布网站
  options: { ... }                                        // 完整的 win 配置
}
```

> **⚠️ 注意**：当前脚本只从 signingOptions 中取了 `path` 字段，忽略了 `hash` 等参数。这意味着不管 `signingHashAlgorithms` 配置了什么，脚本内部始终使用 `/fd sha256`。

### 3.2 signtool.exe 路径

```
C:\Users\gaotu\AppData\Local\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0\windows-10\x64\signtool.exe
```

| 路径段 | 说明 |
|--------|------|
| `C:\Users\gaotu` | CI 构建机器的用户目录（硬编码） |
| `AppData\Local\electron-builder\Cache` | electron-builder 的缓存目录 |
| `winCodeSign\winCodeSign-2.6.0` | Windows 代码签名工具包版本 |
| `windows-10\x64` | Windows 10 64 位版本 |
| `signtool.exe` | Microsoft SignTool 工具 |

**⚠️ 硬编码问题**：路径中包含 `C:\Users\gaotu`（特定用户），只能在该构建机器上运行。

### 3.3 signtool.exe 参数详解

```
signtool.exe sign
  /f sign.cer                              # 证书文件
  /tr http://timestamp.digicert.com        # RFC 3161 时间戳服务器
  /td sha256                               # 时间戳摘要算法
  /fd sha256                               # 文件摘要算法
  /csp "eToken Base Cryptographic Provider" # 加密服务提供程序
  /k "[{{gaotuketang}}]=p11#d00227ab28d4c2e3"  # 密钥容器名
  ${path}                                  # 待签名文件路径
```

**各参数详解**：

| 参数 | 全称 | 说明 |
|------|------|------|
| `/f` | file | 证书文件路径（`.cer` 公钥证书，不含私钥） |
| `/tr` | timestamp RFC | RFC 3161 时间戳服务器 URL |
| `/td` | timestamp digest | 时间戳使用的摘要算法 |
| `/fd` | file digest | 对文件签名使用的摘要算法 |
| `/csp` | cryptographic service provider | 密码学服务提供程序名称 |
| `/k` | key container | 密钥容器名称（存储在硬件 Token 中） |

### 3.4 eToken 硬件签名机制

这是理解该脚本最关键的部分：

```
┌─────────────────────────────────────────────────────────────────────┐
│                   eToken 硬件签名机制                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  传统签名：                                                         │
│  ┌──────────┐                                                      │
│  │ .pfx 文件 │ = 公钥证书 + 私钥（用密码保护）                     │
│  │          │ → 直接用 signtool /f cert.pfx /p password 签名      │
│  └──────────┘                                                      │
│  风险：pfx 文件可复制，密码可泄露                                  │
│                                                                     │
│  eToken 硬件签名：                                                  │
│  ┌──────────┐     ┌──────────────┐                                 │
│  │ .cer 文件 │     │ USB eToken   │                                 │
│  │（公钥证书）│     │（存储私钥）  │                                 │
│  └──────────┘     └──────────────┘                                 │
│       │                    │                                        │
│       └──────┬─────────────┘                                        │
│              ▼                                                      │
│     signtool 通过 CSP 接口访问 eToken 中的私钥                     │
│     私钥永远不离开硬件设备                                          │
│     签名操作在 eToken 内部完成                                      │
│                                                                     │
│  优势：                                                             │
│  ✓ 私钥不可导出，无法被复制                                        │
│  ✓ 签名需要物理 USB Token 在位                                     │
│  ✓ 满足 EV 代码签名证书要求                                       │
│  ✓ Windows SmartScreen 信任度更高                                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**关键参数解读**：

```
/csp "eToken Base Cryptographic Provider"
```
- CSP（Cryptographic Service Provider）是 Windows 密码学体系的插件接口
- "eToken Base Cryptographic Provider" 是 SafeNet eToken 驱动注册的 CSP 名称
- 通过此 CSP，signtool 可以访问 USB Token 中的私钥

```
/k "[{{gaotuketang}}]=p11#d00227ab28d4c2e3"
```
- `/k` 指定密钥容器的名称
- `gaotuketang` 是 Token 的 PIN 码（登录密码）
- `p11#d00227ab28d4c2e3` 是 PKCS#11 密钥标识符
- 这个复合字符串让 signtool 能够自动登录 Token 并选择正确的密钥

### 3.5 时间戳服务器

```
/tr http://timestamp.digicert.com
/td sha256
```

**时间戳的作用**：

```
没有时间戳：
  证书有效期 2024-01 至 2025-12
  → 2025-12 之后签名失效
  → 用户安装时 Windows 报「签名已过期」

有时间戳：
  证书有效期 2024-01 至 2025-12
  签名时间 2024-06（由 DigiCert 时间戳服务器证明）
  → 2025-12 之后签名仍然有效
  → 因为签名是在证书有效期内做的
  → 只要时间戳证书本身有效（通常 10+ 年）
```

### 3.6 错误处理

```javascript
try {
    execSync(signCmd, { stdio: 'inherit' });
    console.log(`sign success: ${path}`);
} catch (error) {
    console.error(`sign error: ${error}`);
    // process.exit(1);  ← 被注释掉了！
}
```

**⚠️ 严重问题**：`process.exit(1)` 被注释掉了。签名失败时：
- 仅打印错误日志
- 不终止构建流程
- 最终产出**未签名的安装包**
- 用户安装时会收到 Windows Defender SmartScreen 警告

---

## 四、被注释的旧版签名逻辑

脚本中还有一段被注释的旧版代码：

```javascript
// const signCmd = `C:\\Users\\Administrator\\AppData\\Local\\electron-builder\\Cache\\...\\signtool.exe
//   sign /f newSignCert.cer
//   /tr http://timestamp.digicert.com
//   /td sha256 /fd sha256
//   /csp "eToken Base Cryptographic Provider"
//   /k "[{{gaotuketang}}]=p11#d00227ab28d4c2e3"
//   ${filePath}`;
```

**与当前版本的区别**：

| 对比项 | 旧版（注释掉的） | 当前版本 |
|--------|-----------------|---------|
| 用户路径 | `C:\Users\Administrator` | `C:\Users\gaotu` |
| 证书文件 | `newSignCert.cer` | `sign.cer` |
| 参数名 | `filePath` | `path` |

说明 CI 构建机器从 `Administrator` 用户迁移到了 `gaotu` 用户，证书文件也更换了。

---

## 五、签名流程在整个构建中的位置

```
electron-builder 构建流程
    │
    ▼
打包文件到 win-unpacked/
    │
    ▼
┌─ 签名阶段 ───────────────────────────────────────────┐
│                                                       │
│  遍历需要签名的文件：                                 │
│    ① 高途微信助手.exe（主程序）                       │
│    ② Uninstall 高途微信助手.exe（卸载程序）           │
│    ③ *.dll（signDlls: true 时）                      │
│    ④ 其他 .exe 文件                                  │
│                                                       │
│  对每个文件调用 sign.js：                             │
│    exports.default({ path: "xxx.exe", hash: "sha256" })│
│    → execSync(signtool ...)                           │
│    → 签名成功 / 失败                                  │
│                                                       │
└───────────────────────────────────────────────────────┘
    │
    ▼
生成 NSIS 安装包（.exe）
    │
    ▼
对安装包本身签名（再次调用 sign.js）
    │
    ▼
生成 latest.yml（更新清单）
    │
    ▼
构建完成
```

---

## 六、sign.js 与 build.yml 签名配置的关系

当同时配置了 `win.sign` 和 `certificateFile`/`certificatePassword` 时：

```yaml
win:
  sign: sign-script/sign.js           # 自定义签名脚本
  certificateFile: newSignCert.pfx     # 证书文件
  certificatePassword: gaotuketang     # 证书密码
```

**优先级**：`win.sign` 优先。当配置了自定义签名脚本时：
- `certificateFile` 和 `certificatePassword` **不再被 electron-builder 内部使用**
- 它们会作为 `signingOptions.options` 的一部分传入自定义脚本
- 但当前脚本**忽略了这些参数**，直接硬编码了证书路径和签名命令

实际上，`build.yml` 中的 `certificateFile: newSignCert.pfx` 和 `certificatePassword: gaotuketang` 是**冗余配置**——它们可能是切换到 eToken 签名之前遗留的，当前不再生效。

---

## 七、问题汇总与改进建议

| 编号 | 问题 | 严重程度 | 建议 |
|------|------|---------|------|
| 1 | signtool 路径硬编码用户目录 | 🔴 高 | 使用环境变量或自动检测路径 |
| 2 | 签名失败不终止构建 | 🔴 高 | 取消注释 `process.exit(1)` 或抛出异常 |
| 3 | eToken PIN 码硬编码在脚本中 | 🟡 中 | 通过环境变量传入 |
| 4 | 没有使用 signingOptions.hash | 🟡 中 | 根据传入的 hash 参数动态设置 /fd |
| 5 | 没有 async/await 正确处理 | 🟢 低 | exports.default 应返回 Promise |
| 6 | 证书文件名硬编码 | 🟢 低 | 从 signingOptions 获取 |
| 7 | build.yml 中的冗余签名配置 | 🟢 低 | 移除不再使用的 certificateFile/Password |

**改进后的脚本参考**：

```javascript
const { execSync } = require("child_process");
const path = require("path");

const SIGNTOOL_PATH = process.env.SIGNTOOL_PATH
  || path.join(
    process.env.LOCALAPPDATA,
    "electron-builder/Cache/winCodeSign/winCodeSign-2.6.0/windows-10/x64/signtool.exe"
  );

const CERT_FILE = process.env.SIGN_CERT || "sign.cer";
const TOKEN_PIN = process.env.ETOKEN_PIN || "[{{gaotuketang}}]=p11#d00227ab28d4c2e3";
const TIMESTAMP_SERVER = "http://timestamp.digicert.com";

async function customSign({ path: filePath, hash = "sha256" }) {
    console.log(`sign start: ${filePath}`);

    const signCmd = [
        `"${SIGNTOOL_PATH}"`,
        "sign",
        `/f "${CERT_FILE}"`,
        `/tr ${TIMESTAMP_SERVER}`,
        `/td ${hash}`,
        `/fd ${hash}`,
        '/csp "eToken Base Cryptographic Provider"',
        `/k "${TOKEN_PIN}"`,
        `"${filePath}"`,
    ].join(" ");

    try {
        execSync(signCmd, { stdio: "inherit" });
        console.log(`sign success: ${filePath}`);
    } catch (error) {
        console.error(`sign error: ${filePath}`, error.message);
        throw error;  // 让 electron-builder 知道签名失败
    }
}

exports.default = async function (signingOptions) {
    await customSign(signingOptions);
};
```

---

## 八、验证签名是否成功

签名完成后，可以通过以下方式验证：

```bash
# 方法 1：使用 signtool 验证
signtool verify /pa "高途微信助手.exe"

# 方法 2：右键 → 属性 → 数字签名
# 应该能看到：
#   签名者：高途教育科技集团有限公司
#   摘要算法：sha256
#   时间戳：由 DigiCert 签发

# 方法 3：PowerShell
Get-AuthenticodeSignature "高途微信助手.exe" | Format-List
```

---

*文档生成时间：2026-03-16 | 基于 galaxy-client/sign-script/sign.js 实际代码分析*
