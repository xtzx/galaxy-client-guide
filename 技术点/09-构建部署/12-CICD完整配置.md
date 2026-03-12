# CI/CD 完整配置

> Electron 应用的自动化构建、签名与发布

---

## 一、概述

### 1.1 Electron CI/CD 特殊性

```
┌─────────────────────────────────────────────────────────────────┐
│                    Electron CI/CD 挑战                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 多平台构建                                                   │
│     ├── Windows / macOS / Linux                                │
│     ├── x64 / arm64 / ia32                                     │
│     └── 需要对应平台的构建机器                                   │
│                                                                 │
│  2. Native Modules                                              │
│     ├── 需要编译环境                                            │
│     └── 不能跨平台编译                                          │
│                                                                 │
│  3. 代码签名                                                    │
│     ├── Windows: 证书 (.pfx)                                   │
│     ├── macOS: Apple 证书 + 公证                               │
│     └── 安全存储与注入                                          │
│                                                                 │
│  4. 产物管理                                                    │
│     ├── 多个安装包文件                                          │
│     ├── 更新清单文件 (latest.yml)                               │
│     └── 版本管理与发布                                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 CI/CD 流程

```
┌─────────────────────────────────────────────────────────────────┐
│                    完整 CI/CD 流程                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  代码提交/Tag                                                   │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────┐                                           │
│  │   触发 CI       │                                           │
│  └────────┬────────┘                                           │
│           │                                                     │
│           ▼                                                     │
│  ┌─────────────────────────────────────────┐                   │
│  │            并行构建矩阵                  │                   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐   │                   │
│  │  │ Windows │ │  macOS  │ │  Linux  │   │                   │
│  │  └────┬────┘ └────┬────┘ └────┬────┘   │                   │
│  │       │           │           │         │                   │
│  │       ▼           ▼           ▼         │                   │
│  │    安装依赖    安装依赖    安装依赖      │                   │
│  │       │           │           │         │                   │
│  │       ▼           ▼           ▼         │                   │
│  │    构建应用    构建应用    构建应用      │                   │
│  │       │           │           │         │                   │
│  │       ▼           ▼           ▼         │                   │
│  │    代码签名    签名+公证    (无签名)    │                   │
│  │       │           │           │         │                   │
│  │       ▼           ▼           ▼         │                   │
│  │    生成产物    生成产物    生成产物      │                   │
│  └───────┼───────────┼───────────┼─────────┘                   │
│          │           │           │                              │
│          └───────────┼───────────┘                              │
│                      ▼                                          │
│          ┌─────────────────┐                                   │
│          │   上传产物      │                                   │
│          │  (Artifacts)    │                                   │
│          └────────┬────────┘                                   │
│                   │                                             │
│                   ▼                                             │
│          ┌─────────────────┐                                   │
│          │   发布 Release  │                                   │
│          │  / 上传 S3 等   │                                   │
│          └─────────────────┘                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、GitHub Actions 配置

### 2.1 基础工作流

```yaml
# .github/workflows/build.yml
name: Build Electron App

on:
  push:
    branches: [main, develop]
    tags:
      - 'v*'
  pull_request:
    branches: [main]

env:
  NODE_VERSION: '18'

jobs:
  # 构建 Windows
  build-windows:
    runs-on: windows-latest
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build
        run: npm run build
      
      - name: Package
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npm run dist:win
      
      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: windows-build
          path: |
            dist/*.exe
            dist/*.yml

  # 构建 macOS
  build-macos:
    runs-on: macos-latest
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build
        run: npm run build
      
      - name: Package
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npm run dist:mac
      
      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: macos-build
          path: |
            dist/*.dmg
            dist/*.zip
            dist/*.yml

  # 构建 Linux
  build-linux:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build
        run: npm run build
      
      - name: Package
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npm run dist:linux
      
      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: linux-build
          path: |
            dist/*.AppImage
            dist/*.deb
            dist/*.yml
```

### 2.2 矩阵策略

```yaml
jobs:
  build:
    strategy:
      fail-fast: false  # 一个失败不影响其他
      matrix:
        include:
          # Windows x64
          - os: windows-latest
            platform: win
            arch: x64
          
          # macOS Intel
          - os: macos-13
            platform: mac
            arch: x64
          
          # macOS Apple Silicon
          - os: macos-14  # M1 runner
            platform: mac
            arch: arm64
          
          # Linux x64
          - os: ubuntu-latest
            platform: linux
            arch: x64

    runs-on: ${{ matrix.os }}
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      
      - run: npm ci
      
      - run: npm run build
      
      - name: Package
        run: npm run dist:${{ matrix.platform }}
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      
      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.platform }}-${{ matrix.arch }}
          path: dist/*
```

---

## 三、签名密钥管理

### 3.1 Windows 证书处理

```yaml
jobs:
  build-windows:
    runs-on: windows-latest
    
    steps:
      # ... 前置步骤 ...
      
      - name: Import Windows certificate
        env:
          WIN_CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
          WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
        run: |
          # 方式一：证书通过 Base64 存储
          # 解码并保存证书
          $certBytes = [Convert]::FromBase64String($env:WIN_CSC_LINK)
          [IO.File]::WriteAllBytes("$pwd\certificate.pfx", $certBytes)
          
          # 设置环境变量供 electron-builder 使用
          echo "WIN_CSC_LINK=$pwd\certificate.pfx" >> $env:GITHUB_ENV
        shell: pwsh
      
      - name: Build and sign
        env:
          WIN_CSC_LINK: ${{ env.WIN_CSC_LINK }}
          WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
        run: npm run dist:win
      
      - name: Cleanup certificate
        if: always()
        run: Remove-Item -Path certificate.pfx -ErrorAction SilentlyContinue
        shell: pwsh
```

**准备 Windows 证书**：

```bash
# 将 .pfx 证书转为 Base64
# macOS/Linux
base64 -i certificate.pfx | tr -d '\n' > certificate_base64.txt

# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("certificate.pfx")) | Out-File certificate_base64.txt -NoNewline

# 将内容存入 GitHub Secrets: WIN_CSC_LINK
# 密码存入: WIN_CSC_KEY_PASSWORD
```

### 3.2 macOS 证书处理

```yaml
jobs:
  build-macos:
    runs-on: macos-latest
    
    steps:
      # ... 前置步骤 ...
      
      - name: Import macOS certificates
        env:
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          KEYCHAIN_PASSWORD: ${{ secrets.KEYCHAIN_PASSWORD }}
        run: |
          # 创建临时 keychain
          KEYCHAIN_PATH=$RUNNER_TEMP/app-signing.keychain-db
          
          security create-keychain -p "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH
          security set-keychain-settings -lut 21600 $KEYCHAIN_PATH
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH
          
          # 解码并导入证书
          echo "$APPLE_CERTIFICATE" | base64 --decode > certificate.p12
          security import certificate.p12 \
            -P "$APPLE_CERTIFICATE_PASSWORD" \
            -A -t cert -f pkcs12 \
            -k $KEYCHAIN_PATH
          
          # 将临时 keychain 添加到搜索列表
          security list-keychain -d user -s $KEYCHAIN_PATH
          
          # 允许 codesign 访问证书
          security set-key-partition-list \
            -S apple-tool:,apple:,codesign: \
            -s -k "$KEYCHAIN_PASSWORD" \
            $KEYCHAIN_PATH
          
          # 清理
          rm certificate.p12
      
      - name: Build, sign and notarize
        env:
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npm run dist:mac
```

**准备 macOS 证书**：

```bash
# 1. 从 Keychain Access 导出证书为 .p12

# 2. 转为 Base64
base64 -i Certificates.p12 | tr -d '\n' > certificate_base64.txt

# 3. 存入 GitHub Secrets:
#    APPLE_CERTIFICATE: Base64 内容
#    APPLE_CERTIFICATE_PASSWORD: 导出时设置的密码
#    KEYCHAIN_PASSWORD: 任意强密码
#    APPLE_ID: Apple 账户邮箱
#    APPLE_APP_SPECIFIC_PASSWORD: App 专用密码
#    APPLE_TEAM_ID: 10位 Team ID
```

### 3.3 使用 API Key（macOS 推荐）

```yaml
- name: Setup API Key
  env:
    APPLE_API_KEY: ${{ secrets.APPLE_API_KEY }}
  run: |
    mkdir -p ~/private_keys
    echo "$APPLE_API_KEY" > ~/private_keys/AuthKey_${{ secrets.APPLE_API_KEY_ID }}.p8

- name: Build and notarize
  env:
    APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
    APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
  run: npm run dist:mac
```

---

## 四、环境变量注入

### 4.1 构建时注入

```yaml
jobs:
  build:
    env:
      # 全局环境变量
      NODE_ENV: production
      
    steps:
      - name: Set build info
        run: |
          echo "BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> $GITHUB_ENV
          echo "BUILD_NUMBER=${{ github.run_number }}" >> $GITHUB_ENV
          echo "GIT_COMMIT=${{ github.sha }}" >> $GITHUB_ENV
      
      - name: Build with environment
        env:
          # API 地址
          VITE_API_URL: ${{ vars.API_URL }}
          
          # 渠道
          CHANNEL: ${{ github.ref_name == 'main' && 'stable' || 'beta' }}
          
          # Sentry
          SENTRY_DSN: ${{ secrets.SENTRY_DSN }}
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          
          # 功能开关
          ENABLE_ANALYTICS: true
        run: npm run build
```

### 4.2 运行时配置

```javascript
// 构建时将配置写入文件
// scripts/write-config.js
const fs = require('fs')
const path = require('path')

const config = {
  apiUrl: process.env.VITE_API_URL || 'https://api.example.com',
  sentryDsn: process.env.SENTRY_DSN || '',
  channel: process.env.CHANNEL || 'stable',
  buildTime: process.env.BUILD_TIME || new Date().toISOString(),
  buildNumber: process.env.BUILD_NUMBER || '0',
  gitCommit: process.env.GIT_COMMIT || 'unknown'
}

fs.writeFileSync(
  path.join(__dirname, '../dist/config.json'),
  JSON.stringify(config, null, 2)
)
```

---

## 五、缓存配置

### 5.1 npm 缓存

```yaml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '18'
    cache: 'npm'  # 自动缓存 npm
```

### 5.2 Electron 缓存

```yaml
- name: Cache Electron
  uses: actions/cache@v4
  with:
    path: |
      ~/.cache/electron
      ~/.cache/electron-builder
      ~/Library/Caches/electron
      ~/Library/Caches/electron-builder
      ~/AppData/Local/electron/Cache
      ~/AppData/Local/electron-builder/Cache
    key: ${{ runner.os }}-electron-${{ hashFiles('**/package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-electron-
```

### 5.3 完整缓存策略

```yaml
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
      
      # Node.js 和 npm 缓存
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      
      # Electron 二进制缓存
      - name: Cache Electron
        uses: actions/cache@v4
        with:
          path: |
            ~/.cache/electron
            ~/.cache/electron-builder
          key: electron-${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}
      
      # Native modules 缓存（如果不经常变化）
      - name: Cache native modules
        uses: actions/cache@v4
        with:
          path: |
            node_modules/.cache
          key: native-${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}
      
      - run: npm ci
      - run: npm run build
      - run: npm run dist
```

---

## 六、发布与产物管理

### 6.1 发布到 GitHub Releases

```yaml
jobs:
  release:
    needs: [build-windows, build-macos, build-linux]
    runs-on: ubuntu-latest
    if: startsWith(github.ref, 'refs/tags/v')
    
    steps:
      # 下载所有构建产物
      - name: Download Windows artifacts
        uses: actions/download-artifact@v4
        with:
          name: windows-build
          path: dist/
      
      - name: Download macOS artifacts
        uses: actions/download-artifact@v4
        with:
          name: macos-build
          path: dist/
      
      - name: Download Linux artifacts
        uses: actions/download-artifact@v4
        with:
          name: linux-build
          path: dist/
      
      # 创建 Release
      - name: Create Release
        uses: softprops/action-gh-release@v1
        with:
          files: dist/*
          draft: true
          generate_release_notes: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 6.2 上传到 S3/OSS

```yaml
- name: Upload to S3
  uses: jakejarvis/s3-sync-action@master
  with:
    args: --acl public-read --follow-symlinks
  env:
    AWS_S3_BUCKET: ${{ secrets.AWS_S3_BUCKET }}
    AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    AWS_REGION: us-east-1
    SOURCE_DIR: dist
    DEST_DIR: releases/${{ github.ref_name }}
```

```yaml
# 阿里云 OSS
- name: Upload to Aliyun OSS
  uses: manyuanrong/setup-ossutil@v2.0
  with:
    endpoint: oss-cn-hangzhou.aliyuncs.com
    access-key-id: ${{ secrets.OSS_ACCESS_KEY_ID }}
    access-key-secret: ${{ secrets.OSS_ACCESS_KEY_SECRET }}

- run: ossutil cp -r dist/ oss://my-bucket/releases/${{ github.ref_name }}/
```

### 6.3 electron-builder 自动发布

```yaml
# electron-builder.yml
publish:
  provider: github
  owner: my-org
  repo: my-app
  releaseType: draft

# 或 generic
publish:
  provider: generic
  url: https://releases.example.com/
```

```yaml
# CI 中使用 publish
- name: Build and publish
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: npm run dist -- --publish always
  # --publish always: 总是发布
  # --publish onTag: 仅 tag 时发布
  # --publish onTagOrDraft: tag 或草稿时发布
  # --publish never: 不发布
```

---

## 七、版本管理

### 7.1 自动版本号

```yaml
jobs:
  prepare:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.version.outputs.version }}
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Get version
        id: version
        run: |
          if [[ $GITHUB_REF == refs/tags/v* ]]; then
            VERSION=${GITHUB_REF#refs/tags/v}
          else
            VERSION=$(node -p "require('./package.json').version")-${{ github.run_number }}
          fi
          echo "version=$VERSION" >> $GITHUB_OUTPUT
          echo "Version: $VERSION"
```

### 7.2 更新 package.json 版本

```yaml
- name: Update version
  run: |
    npm version ${{ needs.prepare.outputs.version }} --no-git-tag-version
```

---

## 八、完整工作流示例

### 8.1 生产级配置

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'v*'

env:
  NODE_VERSION: '18'

jobs:
  # 准备阶段
  prepare:
    runs-on: ubuntu-latest
    outputs:
      version: ${{ steps.version.outputs.version }}
    steps:
      - uses: actions/checkout@v4
      
      - name: Get version from tag
        id: version
        run: |
          VERSION=${GITHUB_REF#refs/tags/v}
          echo "version=$VERSION" >> $GITHUB_OUTPUT

  # 构建 Windows
  build-windows:
    needs: prepare
    runs-on: windows-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - name: Cache Electron
        uses: actions/cache@v4
        with:
          path: |
            ~/AppData/Local/electron/Cache
            ~/AppData/Local/electron-builder/Cache
          key: electron-win-${{ hashFiles('**/package-lock.json') }}
      
      - name: Install dependencies
        run: npm ci
      
      - name: Update version
        run: npm version ${{ needs.prepare.outputs.version }} --no-git-tag-version
      
      - name: Import certificate
        env:
          WIN_CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
        run: |
          $certBytes = [Convert]::FromBase64String($env:WIN_CSC_LINK)
          [IO.File]::WriteAllBytes("$pwd\cert.pfx", $certBytes)
          echo "WIN_CSC_LINK=$pwd\cert.pfx" >> $env:GITHUB_ENV
        shell: pwsh
      
      - name: Build
        run: npm run build
      
      - name: Package
        env:
          WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npm run dist:win
      
      - name: Cleanup
        if: always()
        run: Remove-Item -Path cert.pfx -ErrorAction SilentlyContinue
        shell: pwsh
      
      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: windows-x64
          path: |
            dist/*.exe
            dist/*.exe.blockmap
            dist/latest.yml

  # 构建 macOS (Intel)
  build-macos-x64:
    needs: prepare
    runs-on: macos-13
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - name: Cache Electron
        uses: actions/cache@v4
        with:
          path: |
            ~/Library/Caches/electron
            ~/Library/Caches/electron-builder
          key: electron-mac-x64-${{ hashFiles('**/package-lock.json') }}
      
      - name: Install dependencies
        run: npm ci
      
      - name: Update version
        run: npm version ${{ needs.prepare.outputs.version }} --no-git-tag-version
      
      - name: Import certificates
        env:
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
        run: |
          KEYCHAIN_PATH=$RUNNER_TEMP/app-signing.keychain-db
          KEYCHAIN_PASSWORD=$(openssl rand -base64 32)
          
          security create-keychain -p "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH
          security set-keychain-settings -lut 21600 $KEYCHAIN_PATH
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH
          
          echo "$APPLE_CERTIFICATE" | base64 --decode > cert.p12
          security import cert.p12 -P "$APPLE_CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k $KEYCHAIN_PATH
          security list-keychain -d user -s $KEYCHAIN_PATH
          security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH
          
          rm cert.p12
      
      - name: Build
        run: npm run build
      
      - name: Package
        env:
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npm run dist:mac -- --arch x64
      
      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: macos-x64
          path: |
            dist/*.dmg
            dist/*.zip
            dist/*.blockmap
            dist/latest-mac.yml

  # 构建 macOS (Apple Silicon)
  build-macos-arm64:
    needs: prepare
    runs-on: macos-14  # M1 runner
    
    steps:
      # 类似 x64，只是 --arch arm64
      - uses: actions/checkout@v4
      # ... 其他步骤相同 ...
      
      - name: Package
        env:
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        run: npm run dist:mac -- --arch arm64
      
      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: macos-arm64
          path: |
            dist/*.dmg
            dist/*.zip

  # 构建 Linux
  build-linux:
    needs: prepare
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Update version
        run: npm version ${{ needs.prepare.outputs.version }} --no-git-tag-version
      
      - name: Build
        run: npm run build
      
      - name: Package
        run: npm run dist:linux
      
      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: linux-x64
          path: |
            dist/*.AppImage
            dist/*.deb
            dist/latest-linux.yml

  # 发布
  release:
    needs: [prepare, build-windows, build-macos-x64, build-macos-arm64, build-linux]
    runs-on: ubuntu-latest
    
    steps:
      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          path: dist
          merge-multiple: true
      
      - name: List artifacts
        run: ls -la dist/
      
      - name: Create Release
        uses: softprops/action-gh-release@v1
        with:
          name: v${{ needs.prepare.outputs.version }}
          files: dist/*
          draft: true
          generate_release_notes: true
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## 九、可重复构建

### 9.1 版本锁定

```yaml
# 锁定 Node.js 版本
- uses: actions/setup-node@v4
  with:
    node-version-file: '.nvmrc'  # 使用项目中的 .nvmrc

# 或精确版本
- uses: actions/setup-node@v4
  with:
    node-version: '18.18.0'
```

```
# .nvmrc
18.18.0
```

### 9.2 依赖锁定

```json
// package.json
{
  "engines": {
    "node": ">=18.0.0",
    "npm": ">=9.0.0"
  }
}
```

```yaml
# 使用 npm ci 而非 npm install
- run: npm ci
```

### 9.3 构建信息记录

```yaml
- name: Record build info
  run: |
    echo "Build Info:" > build-info.txt
    echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> build-info.txt
    echo "Commit: ${{ github.sha }}" >> build-info.txt
    echo "Node: $(node --version)" >> build-info.txt
    echo "npm: $(npm --version)" >> build-info.txt
    echo "Electron: $(node -p \"require('electron/package.json').version\")" >> build-info.txt
```

---

## 十、调试与问题排查

### 10.1 启用调试模式

```yaml
- name: Build with debug
  env:
    DEBUG: electron-builder
  run: npm run dist
```

### 10.2 SSH 调试（tmate）

```yaml
- name: Setup tmate session
  if: failure()
  uses: mxschmitt/action-tmate@v3
  timeout-minutes: 15
```

### 10.3 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| 证书导入失败 | Base64 编码问题 | 确保无换行符 |
| 签名失败 | 证书权限问题 | 检查 keychain 配置 |
| 公证超时 | Apple 服务慢 | 增加超时时间 |
| 缓存无效 | key 不匹配 | 检查 hashFiles 路径 |
| Native 模块错误 | 未在对应平台编译 | 确保平台匹配 |

---

## 参考资源

- [GitHub Actions 文档](https://docs.github.com/actions)
- [electron-builder CI 配置](https://www.electron.build/multi-platform-build)
- [action-gh-release](https://github.com/softprops/action-gh-release)
- [Electron Forge CI](https://www.electronforge.io/config/publishers)
