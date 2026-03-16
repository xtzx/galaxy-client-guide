# 02 — publish 发布与自动更新配置详解

> `publish` 字段是 electron-builder 中控制自动更新的核心配置，决定了更新清单文件的生成方式和更新服务器的连接信息。

---

## 一、当前项目配置

```yaml
publish:
  provider: generic
  url: http://127.0.0.1
  channel: latest
```

---

## 二、字段含义

`publish` 配置告诉 electron-builder 两件事：

1. **构建时**：生成什么格式的更新清单文件（`latest.yml`）
2. **运行时**：`electron-updater` 去哪里检查和下载更新

> **重要**：`publish` 配置同时影响构建过程和运行时行为。构建时会将 publish 信息写入 `latest.yml`，运行时 `electron-updater` 会读取该清单中的信息来检查更新。

---

## 三、publish 内部字段详解

### 3.1 通用字段

所有 provider 类型共享的字段：

| 字段 | 类型 | 默认值 | 含义 |
|------|------|--------|------|
| `provider` | string | 必填 | 更新服务器类型，决定使用哪种协议获取更新 |
| `channel` | string | `"latest"` | 更新通道，用于实现灰度发布、beta 测试等 |
| `publishAutoUpdate` | boolean | `true` | 是否在打包时自动生成更新清单文件 |

### 3.2 provider 类型

electron-builder 支持以下 provider：

| provider | 说明 | 典型场景 |
|----------|------|---------|
| `generic` | 通用 HTTP 服务器 | 自建文件服务器、CDN、OSS |
| `github` | GitHub Releases | 开源项目 |
| `s3` | AWS S3（兼容协议） | 阿里云 OSS、腾讯云 COS、MinIO |
| `spaces` | DigitalOcean Spaces | DigitalOcean 用户 |
| `keygen` | Keygen.sh | 需要许可证管理的商业软件 |
| `custom` | 自定义 provider | 完全自控的更新逻辑 |

---

## 四、各 provider 详细配置

### 4.1 generic — 通用 HTTP 服务器

**最常用的 provider**，适合任何能提供静态文件服务的 HTTP 服务器。

```yaml
publish:
  provider: generic
  url: https://releases.example.com/updates/
  channel: latest
  useMultipleRangeRequest: true
```

| 字段 | 类型 | 默认值 | 含义 |
|------|------|--------|------|
| `url` | string | 必填 | 更新服务器的 URL，必须以 `/` 结尾或指向目录 |
| `channel` | string | `"latest"` | 更新通道名称 |
| `useMultipleRangeRequest` | boolean | `true` | 是否使用 HTTP Range 请求实现差量下载 |

**服务器端需要的文件结构**：

```
https://releases.example.com/updates/
├── latest.yml                              # Windows 更新清单
├── latest-mac.yml                          # macOS 更新清单
├── latest-linux.yml                        # Linux 更新清单
├── Weixinzhushou-win-5.5.0-release01.exe   # 安装包
├── Weixinzhushou-win-5.5.0-release01.exe.blockmap  # 差量更新映射
└── ...
```

**latest.yml 文件内容示例**：

```yaml
version: 5.5.0-release01
files:
  - url: Weixinzhushou-win-5.5.0-release01.exe
    sha512: <sha512_hash>
    size: 123456789
    blockMapSize: 12345
path: Weixinzhushou-win-5.5.0-release01.exe
sha512: <sha512_hash>
releaseDate: '2026-03-16T10:00:00.000Z'
```

### 4.2 github — GitHub Releases

```yaml
publish:
  provider: github
  owner: my-org
  repo: my-app
  releaseType: release
  private: false
  token: ${GH_TOKEN}
```

| 字段 | 类型 | 默认值 | 含义 |
|------|------|--------|------|
| `owner` | string | 从 package.json repository 推断 | GitHub 仓库所有者 |
| `repo` | string | 从 package.json name 推断 | GitHub 仓库名 |
| `releaseType` | string | `"draft"` | 发布类型：`draft`（草稿）/ `prerelease`（预发布）/ `release`（正式） |
| `private` | boolean | `false` | 是否为私有仓库（影响更新下载时是否需要 token） |
| `token` | string | `GH_TOKEN` 环境变量 | GitHub Personal Access Token |
| `vPrefixedTagName` | boolean | `true` | tag 是否带 v 前缀（如 `v1.0.0`） |

### 4.3 s3 — AWS S3 及兼容服务

```yaml
publish:
  provider: s3
  bucket: my-releases
  region: us-east-1
  acl: public-read
  path: /releases/${channel}
  endpoint: https://s3.amazonaws.com
```

| 字段 | 类型 | 默认值 | 含义 |
|------|------|--------|------|
| `bucket` | string | 必填 | S3 Bucket 名称 |
| `region` | string | 必填 | S3 Region |
| `acl` | string | `"public-read"` | 访问控制列表 |
| `path` | string | `"/"` | Bucket 内的路径前缀 |
| `endpoint` | string | AWS 默认 | S3 API 端点（阿里云 OSS 等兼容服务需要设置） |
| `storageClass` | string | `"STANDARD"` | 存储类型 |

**阿里云 OSS 使用 S3 兼容协议**：

```yaml
publish:
  provider: s3
  bucket: gh-fe
  endpoint: https://oss-cn-beijing.aliyuncs.com
  region: oss-cn-beijing
  acl: public-read
  path: /qz-wxzs/prod/
```

---

## 五、channel — 更新通道机制

### 5.1 通道的作用

通道是实现**灰度发布**和**多版本并行**的核心机制：

```
┌────────────────────────────────────────────────────────┐
│                   更新通道示意                          │
├────────────────────────────────────────────────────────┤
│                                                        │
│  stable 通道（默认）                                   │
│  └── latest.yml → 5.5.0-release01                     │
│                                                        │
│  beta 通道                                             │
│  └── beta.yml → 5.6.0-beta.1                          │
│                                                        │
│  alpha 通道                                            │
│  └── alpha.yml → 6.0.0-alpha.1                        │
│                                                        │
│  用户 A（stable）：5.5.0 → 检查 latest.yml → 无更新   │
│  用户 B（beta）  ：5.5.0 → 检查 beta.yml → 有 5.6.0  │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### 5.2 通道与清单文件的对应关系

| channel 值 | 生成的清单文件（Windows） | 生成的清单文件（macOS） |
|------------|-------------------------|----------------------|
| `latest`（默认） | `latest.yml` | `latest-mac.yml` |
| `beta` | `beta.yml` | `beta-mac.yml` |
| `alpha` | `alpha.yml` | `alpha-mac.yml` |
| 自定义名称 | `{channel}.yml` | `{channel}-mac.yml` |

### 5.3 运行时切换通道

在 `electron-updater` 中可以动态切换通道：

```javascript
const { autoUpdater } = require('electron-updater');

// 切换到 beta 通道
autoUpdater.channel = 'beta';

// 允许降级（从 beta 回到 stable）
autoUpdater.allowDowngrade = true;

autoUpdater.checkForUpdates();
```

---

## 六、多渠道发布

publish 支持数组形式，同时发布到多个目标：

```yaml
publish:
  - provider: github
    releaseType: draft
  - provider: generic
    url: https://releases.example.com/
  - provider: s3
    bucket: backup-releases
```

**用途**：
- 主要分发通过 CDN（generic）
- 同时备份到 GitHub Releases
- S3 作为灾备存储

---

## 七、publish 与 electron-updater 的关系

### 7.1 构建时

```
electron-builder 读取 publish 配置
        │
        ▼
生成 latest.yml（包含版本号、文件哈希、下载路径）
        │
        ▼
如果 -p always/onTag，自动上传到 publish 指定的服务器
如果 -p never，仅本地生成不上传
```

### 7.2 运行时

```
electron-updater.checkForUpdates()
        │
        ▼
从 publish.url 下载 latest.yml
        │
        ▼
比较 latest.yml 中的版本号与当前版本
        │
        ├── 版本更高 → 下载安装包 → 触发 update-available 事件
        └── 版本相同或更低 → 触发 update-not-available 事件
```

### 7.3 -p 参数含义

| 参数 | 含义 | 使用场景 |
|------|------|---------|
| `-p never` | 不上传，仅本地构建 | 本地开发、CI 打包但手动上传 |
| `-p always` | 始终上传 | CI/CD 自动发布 |
| `-p onTag` | 仅在 Git tag 时上传 | 基于 tag 的发布流程 |
| `-p onTagOrDraft` | tag 或 draft 时上传 | GitHub draft release 流程 |

---

## 八、当前配置分析

```yaml
publish:
  provider: generic
  url: http://127.0.0.1
  channel: latest
```

### 问题分析

| 问题 | 说明 | 影响 |
|------|------|------|
| `url: http://127.0.0.1` | 指向本地回环地址 | 自动更新功能**完全不可用** |
| 使用 HTTP 而非 HTTPS | 明文传输更新包 | 存在中间人攻击风险 |
| 单一 provider | 没有备份渠道 | 更新服务器宕机则无法更新 |

### 原因推测

该项目实际使用 `scripts/uploadFile.js` 手动上传到阿里云 OSS，自动更新可能通过运行时代码（`electron-updater`）动态设置 `feedURL`，而非依赖 build.yml 中的 publish 配置。这种情况下 `http://127.0.0.1` 只是一个占位符。

### 改进建议

即使运行时会动态覆盖更新地址，build.yml 中也建议配置正确的 URL：

```yaml
publish:
  provider: generic
  url: https://releases.example.com/qz-wxzs/prod/
  channel: latest
```

这样 `latest.yml` 中会包含正确的下载地址，方便排查更新问题。

---

## 九、注意事项

### 9.1 URL 末尾的斜杠

generic provider 的 url **必须**以 `/` 结尾或指向一个目录：

```yaml
# 正确
url: https://releases.example.com/updates/

# 错误 — 可能导致路径拼接异常
url: https://releases.example.com/updates
```

### 9.2 HTTPS 强烈推荐

更新包的传输**必须**使用 HTTPS：
- 防止中间人替换安装包
- 配合代码签名验证（`verifyUpdateCodeSignature: true`）形成双重安全保障

### 9.3 latest.yml 是自动生成的

不需要手动编写 `latest.yml`，每次 `electron-builder` 打包时会自动生成。如果手动修改了清单文件的哈希值或版本号，可能导致更新验证失败。

### 9.4 blockmap 差量更新

electron-builder 会自动生成 `.blockmap` 文件，`electron-updater` 利用它实现差量更新：

- 只下载变化的块，而非整个安装包
- 可以大幅减少更新下载量（通常减少 60-80%）
- 需要服务器支持 HTTP Range 请求

---

*文档生成时间：2026-03-16 | 基于 electron-builder 官方文档与项目实际配置分析*
