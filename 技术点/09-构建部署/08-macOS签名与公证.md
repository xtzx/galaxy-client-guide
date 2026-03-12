# macOS 签名与公证

> macOS 应用分发的必要流程：代码签名与 Apple 公证

---

## 一、为什么需要签名与公证

### 1.1 macOS 安全机制

```
┌─────────────────────────────────────────────────────────────────┐
│                    macOS 安全层级                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Gatekeeper（守门人）                                            │
│  ├── 检查应用是否签名                                            │
│  ├── 验证签名是否有效                                            │
│  ├── 检查是否经过 Apple 公证                                     │
│  └── 阻止未知开发者的应用                                        │
│                                                                 │
│  用户看到的提示：                                                 │
│  ┌────────────────────────────────────────────┐                 │
│  │  未签名:     "xxx 已损坏，无法打开"         │                 │
│  │  签名但未公证: "无法验证开发者"             │                 │
│  │  签名且公证:   正常打开 ✓                   │                 │
│  └────────────────────────────────────────────┘                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 签名 vs 公证

| 概念 | 说明 | 必要性 |
|------|------|--------|
| **代码签名 (Code Signing)** | 使用开发者证书对应用签名，证明来源 | macOS 10.8+ 必须 |
| **公证 (Notarization)** | 提交给 Apple 审查，确认无恶意软件 | macOS 10.15+ 必须 |
| **Stapling** | 将公证凭证附加到应用，离线可验证 | 推荐 |

---

## 二、证书类型与获取

### 2.1 证书类型

```
┌─────────────────────────────────────────────────────────────────┐
│                    Apple 开发者证书类型                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Developer ID Application                                    │
│     用途：App Store 外分发                                       │
│     场景：官网下载、企业分发                                      │
│     ★ 最常用                                                    │
│                                                                 │
│  2. Developer ID Installer                                      │
│     用途：签名 .pkg 安装包                                       │
│     场景：需要 pkg 格式时                                        │
│                                                                 │
│  3. Mac Developer / Apple Development                           │
│     用途：开发和调试                                             │
│     场景：本地开发测试                                           │
│                                                                 │
│  4. 3rd Party Mac Developer Application                         │
│     用途：Mac App Store 上架                                     │
│     场景：MAS 分发                                               │
│                                                                 │
│  5. 3rd Party Mac Developer Installer                           │
│     用途：MAS 的 pkg 包                                          │
│     场景：MAS 分发                                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 获取证书

1. **加入 Apple Developer Program**（$99/年）
   - https://developer.apple.com/programs/

2. **创建证书**：
   - 登录 Apple Developer 后台
   - Certificates, Identifiers & Profiles
   - 创建 "Developer ID Application" 证书

3. **下载并安装到 Keychain**：
```bash
# 双击 .cer 文件安装
# 或使用命令行
security import certificate.cer -k ~/Library/Keychains/login.keychain-db

# 验证安装
security find-identity -v -p codesigning
```

### 2.3 导出 .p12 证书（CI 使用）

```bash
# 从 Keychain 导出
# Keychain Access -> 选择证书 -> 右键导出 -> .p12 格式

# 设置一个强密码（CI 中使用）
```

---

## 三、electron-builder macOS 配置

### 3.1 基础配置

```yaml
# electron-builder.yml

mac:
  # 应用分类（App Store 和 Launchpad）
  category: public.app-category.productivity
  # 常用分类：
  # public.app-category.developer-tools
  # public.app-category.utilities
  # public.app-category.productivity
  # public.app-category.business
  
  # 图标（1024x1024 的 icns）
  icon: build/icon.icns
  
  # 深色模式支持
  darkModeSupport: true
  
  # 最低系统版本
  minimumSystemVersion: "10.13"
  
  # 构建目标
  target:
    - target: dmg
      arch:
        - x64
        - arm64
    - target: zip
      arch:
        - x64
        - arm64
```

### 3.2 签名配置

```yaml
mac:
  # 签名身份（证书名称或 SHA1）
  identity: "Developer ID Application: My Company (TEAMID)"
  # 留空则自动检测 Keychain 中的证书
  # 设为 null 则不签名
  
  # 强化运行时（公证必须）
  hardenedRuntime: true
  
  # Gatekeeper 评估（构建时验证签名）
  gatekeeperAssess: false
  
  # 权限配置文件
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  
  # 跳过签名的文件
  signIgnore:
    - "**/*.framework/Versions/A/Libraries/libsqlite3.dylib"
  
  # 额外的签名参数
  # extraArgs: []
```

### 3.3 公证配置

```yaml
mac:
  # 方式一：使用 notarize 配置
  notarize:
    teamId: "XXXXXXXXXX"  # 10位 Team ID
  
  # Apple ID 通过环境变量传入：
  # APPLE_ID=your@email.com
  # APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
  # 或
  # APPLE_API_KEY=XXXXXXXXXX
  # APPLE_API_KEY_ID=XXXXXXXXXX
  # APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

**推荐方式：使用 afterSign 钩子**：

```yaml
mac:
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist

afterSign: scripts/notarize.js
```

---

## 四、entitlements.plist 配置

### 4.1 标准权限文件

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- 允许 JIT 编译（V8 需要） -->
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    
    <!-- 允许加载未签名的动态库 -->
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    
    <!-- 禁用库验证（加载第三方库） -->
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
</dict>
</plist>
```

### 4.2 常用权限说明

```xml
<!-- Electron 应用必需 -->
<key>com.apple.security.cs.allow-jit</key>
<true/>
<key>com.apple.security.cs.allow-unsigned-executable-memory</key>
<true/>
<key>com.apple.security.cs.disable-library-validation</key>
<true/>

<!-- 网络访问 -->
<key>com.apple.security.network.client</key>
<true/>
<key>com.apple.security.network.server</key>
<true/>

<!-- 文件访问 -->
<key>com.apple.security.files.user-selected.read-write</key>
<true/>
<key>com.apple.security.files.downloads.read-write</key>
<true/>

<!-- 摄像头/麦克风 -->
<key>com.apple.security.device.camera</key>
<true/>
<key>com.apple.security.device.audio-input</key>
<true/>

<!-- USB 设备访问 -->
<key>com.apple.security.device.usb</key>
<true/>

<!-- 蓝牙 -->
<key>com.apple.security.device.bluetooth</key>
<true/>

<!-- Apple Events（自动化） -->
<key>com.apple.security.automation.apple-events</key>
<true/>
```

### 4.3 Hardened Runtime 兼容

```
┌─────────────────────────────────────────────────────────────────┐
│              Hardened Runtime 与 Entitlements                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Hardened Runtime 限制：                                        │
│  ✗ 禁止 JIT 编译                                               │
│  ✗ 禁止加载未签名库                                            │
│  ✗ 禁止调试器附加                                              │
│  ✗ 禁止代码注入                                                │
│                                                                 │
│  Electron 需要放宽的权限：                                       │
│  ✓ allow-jit                 (V8 JIT 编译)                     │
│  ✓ allow-unsigned-executable-memory  (native 模块)            │
│  ✓ disable-library-validation (加载第三方 dylib)              │
│                                                                 │
│  注意：过多权限可能导致公证被拒                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 五、公证（Notarization）

### 5.1 准备工作

1. **创建 App-Specific Password**：
   - 访问 https://appleid.apple.com/
   - 安全 → App 专用密码 → 生成
   - 保存密码（格式：xxxx-xxxx-xxxx-xxxx）

2. **或创建 API Key**（推荐 CI）：
   - Apple Developer → Users and Access → Keys
   - 创建 App Store Connect API Key
   - 下载 .p8 文件

### 5.2 使用 @electron/notarize

```javascript
// scripts/notarize.js
const { notarize } = require('@electron/notarize')
const path = require('path')

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  
  if (electronPlatformName !== 'darwin') {
    return
  }
  
  // 开发环境跳过
  if (process.env.SKIP_NOTARIZE === 'true') {
    console.log('Skipping notarization')
    return
  }
  
  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(appOutDir, `${appName}.app`)
  
  console.log(`Notarizing ${appPath}...`)
  
  try {
    // 方式一：使用 Apple ID
    await notarize({
      appPath,
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: process.env.APPLE_TEAM_ID
    })
    
    // 方式二：使用 API Key（推荐）
    // await notarize({
    //   appPath,
    //   appleApiKey: process.env.APPLE_API_KEY,
    //   appleApiKeyId: process.env.APPLE_API_KEY_ID,
    //   appleApiIssuer: process.env.APPLE_API_ISSUER
    // })
    
    console.log('Notarization complete!')
  } catch (error) {
    console.error('Notarization failed:', error)
    throw error
  }
}
```

### 5.3 安装依赖

```bash
npm install --save-dev @electron/notarize
```

### 5.4 环境变量配置

```bash
# .env 或 CI secrets
APPLE_ID=your@email.com
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
APPLE_TEAM_ID=XXXXXXXXXX

# 或使用 API Key
APPLE_API_KEY_ID=XXXXXXXXXX
APPLE_API_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

### 5.5 公证流程

```
┌─────────────────────────────────────────────────────────────────┐
│                       公证流程                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 应用签名完成                                                 │
│     │                                                           │
│  2. afterSign 钩子触发                                          │
│     │                                                           │
│  3. 创建 ZIP 压缩应用                                           │
│     │                                                           │
│  4. 上传到 Apple 公证服务                                        │
│     │ (几分钟到几十分钟)                                        │
│     │                                                           │
│  5. Apple 扫描检查                                              │
│     │  ├── 恶意软件检测                                         │
│     │  ├── 签名验证                                             │
│     │  └── 权限检查                                             │
│     │                                                           │
│  6. 返回公证结果                                                 │
│     │  ├── 成功 → Stapling                                     │
│     │  └── 失败 → 查看错误日志                                  │
│     │                                                           │
│  7. Stapling（将凭证附加到应用）                                 │
│     │                                                           │
│  8. 完成                                                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5.6 手动公证命令

```bash
# 使用 notarytool（Xcode 13+）

# 上传公证
xcrun notarytool submit MyApp.zip \
  --apple-id "your@email.com" \
  --password "@keychain:AC_PASSWORD" \
  --team-id "XXXXXXXXXX" \
  --wait

# 查看历史
xcrun notarytool history \
  --apple-id "your@email.com" \
  --password "@keychain:AC_PASSWORD" \
  --team-id "XXXXXXXXXX"

# 查看详情
xcrun notarytool log <submission-id> \
  --apple-id "your@email.com" \
  --password "@keychain:AC_PASSWORD" \
  --team-id "XXXXXXXXXX"

# Stapling
xcrun stapler staple MyApp.app
xcrun stapler staple MyApp.dmg

# 验证 stapling
xcrun stapler validate MyApp.app
```

### 5.7 公证失败排查

```bash
# 查看详细错误日志
xcrun notarytool log <submission-id> \
  --apple-id "your@email.com" \
  --password "@keychain:AC_PASSWORD" \
  --team-id "XXXXXXXXXX" \
  developer_log.json

# 常见失败原因：
# 1. 签名无效或缺失
# 2. Hardened Runtime 未启用
# 3. Entitlements 配置错误
# 4. 包含恶意软件特征的代码
# 5. 时间戳问题
```

**常见错误与解决**：

| 错误 | 原因 | 解决 |
|------|------|------|
| The signature is invalid | 签名损坏或证书过期 | 重新签名 |
| The executable does not have the hardened runtime enabled | 未启用 hardenedRuntime | 配置 `hardenedRuntime: true` |
| The signature of the binary is invalid | 某个二进制文件未签名 | 检查所有 .dylib 和 .node 文件 |
| Code signature is invalid for... | 签名不匹配 | 清理后重新构建 |

---

## 六、DMG 配置

### 6.1 基础 DMG 配置

```yaml
dmg:
  # 背景图片
  background: build/background.png
  # 推荐尺寸：540x380 或 660x400
  # Retina: 使用 @2x 版本
  
  # 卷图标
  icon: build/volume.icns
  
  # 图标大小
  iconSize: 80
  
  # 窗口大小和位置
  window:
    width: 540
    height: 380
    x: 400
    y: 100
  
  # 图标布局
  contents:
    - x: 130
      y: 220
      type: file   # 应用图标
    - x: 410
      y: 220
      type: link
      path: /Applications  # Applications 快捷方式
  
  # DMG 格式
  format: UDZO
  # UDRW: 读写
  # UDRO: 只读
  # UDCO: ADC 压缩
  # UDZO: zlib 压缩（默认）
  # UDBZ: bzip2 压缩
  # ULFO: lzfse 压缩
  
  # 是否写入更新块
  writeUpdateInfo: true
```

### 6.2 自定义背景制作

```
DMG 背景图制作指南：

1. 尺寸：540x380（1x）或 1080x760（@2x）
2. 格式：PNG
3. 内容建议：
   - 左侧留空给应用图标
   - 右侧留空给 Applications 文件夹
   - 中间可放箭头指示
   - 底部可放版权信息

┌────────────────────────────────────────┐
│                                        │
│   ┌─────┐          →          📁      │
│   │ App │      拖动到这里    Applications│
│   └─────┘                              │
│                                        │
│         MyApp v1.0.0 © 2024           │
└────────────────────────────────────────┘
```

### 6.3 更多内容项

```yaml
dmg:
  contents:
    # 应用图标
    - x: 130
      y: 180
      type: file
    
    # Applications 链接
    - x: 410
      y: 180
      type: link
      path: /Applications
    
    # 额外文件
    - x: 270
      y: 300
      type: file
      path: README.md
    
    # 自定义链接
    - x: 270
      y: 340
      type: link
      path: "https://example.com"
      name: "官方网站"
```

---

## 七、Universal Binary（Apple Silicon）

### 7.1 架构选项

```yaml
mac:
  target:
    - target: dmg
      arch:
        - x64      # Intel
        - arm64    # Apple Silicon
        - universal # 通用二进制（两者合一）
```

### 7.2 Universal Binary 说明

```
┌─────────────────────────────────────────────────────────────────┐
│                    架构选择策略                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  分开发布（x64 + arm64）：                                       │
│  ✓ 下载体积小（用户只下载需要的版本）                             │
│  ✓ 更新包小                                                    │
│  ✗ 需要维护两个版本                                             │
│  ✗ 用户需要选择正确版本                                         │
│                                                                 │
│  Universal Binary：                                             │
│  ✓ 用户无需选择                                                 │
│  ✓ 单一安装包                                                  │
│  ✗ 体积约为 x2                                                 │
│  ✗ native 模块需要都支持                                       │
│                                                                 │
│  推荐：分开发布 + 自动检测下载                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7.3 native 模块处理

```javascript
// 检测架构
const arch = process.arch // 'x64' 或 'arm64'

// 确保 native 模块支持当前架构
// 构建时需要在对应架构的机器上 rebuild
```

```yaml
# 分别构建
mac:
  target:
    - target: dmg
      arch: x64    # 在 Intel Mac 上构建
    - target: dmg
      arch: arm64  # 在 M1/M2 Mac 上构建
```

---

## 八、Mac App Store（MAS）

### 8.1 MAS 与直接分发的区别

| 方面 | 直接分发 | Mac App Store |
|------|----------|---------------|
| 证书 | Developer ID | 3rd Party Mac Developer |
| 沙盒 | 可选 | 必须 |
| 权限 | 较宽松 | 严格限制 |
| 公证 | 需要 | Apple 处理 |
| 更新 | 自己实现 | App Store 处理 |
| 分成 | 无 | 15-30% |

### 8.2 MAS 配置

```yaml
mac:
  target:
    - target: mas
      arch: [x64, arm64]
  
  # MAS 专用证书
  identity: "3rd Party Mac Developer Application: My Company (TEAMID)"
  
  # MAS 必须使用沙盒
  entitlements: build/entitlements.mas.plist
  entitlementsInherit: build/entitlements.mas.inherit.plist

mas:
  # 签名身份
  identity: "3rd Party Mac Developer Application: My Company (TEAMID)"
  
  # 安装包签名
  signingIdentity: "3rd Party Mac Developer Installer: My Company (TEAMID)"
  
  # 权限文件
  entitlements: build/entitlements.mas.plist
  entitlementsInherit: build/entitlements.mas.inherit.plist
  
  # provisioning profile
  provisioningProfile: build/embedded.provisionprofile
```

### 8.3 MAS 沙盒权限

```xml
<!-- entitlements.mas.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- 沙盒（必须） -->
    <key>com.apple.security.app-sandbox</key>
    <true/>
    
    <!-- 基本权限 -->
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
</dict>
</plist>
```

---

## 九、签名验证

### 9.1 验证命令

```bash
# 验证签名
codesign --verify --deep --strict --verbose=2 MyApp.app

# 显示签名信息
codesign --display --verbose=4 MyApp.app

# 检查权限
codesign -d --entitlements :- MyApp.app

# 验证公证状态
spctl -a -vvv -t install MyApp.app

# 检查 Gatekeeper 评估
spctl --assess --type execute --verbose MyApp.app

# 验证 DMG
spctl -a -t open --context context:primary-signature MyApp.dmg
```

### 9.2 常见签名问题

```bash
# 问题：签名无效
# 解决：重新签名
codesign --force --deep --sign "Developer ID Application: ..." MyApp.app

# 问题：库未签名
# 解决：逐个签名
find MyApp.app -name "*.dylib" -exec codesign --force --sign "Developer ID Application: ..." {} \;
find MyApp.app -name "*.node" -exec codesign --force --sign "Developer ID Application: ..." {} \;

# 问题：时间戳验证失败
# 解决：使用 --timestamp 选项
codesign --force --deep --sign "..." --timestamp MyApp.app
```

---

## 十、CI/CD 配置

### 10.1 GitHub Actions 示例

```yaml
# .github/workflows/build-mac.yml
name: Build macOS

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    runs-on: macos-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Import certificates
        env:
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
        run: |
          # 创建临时 keychain
          KEYCHAIN_PATH=$RUNNER_TEMP/app-signing.keychain-db
          KEYCHAIN_PASSWORD=$(openssl rand -base64 32)
          
          security create-keychain -p "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH
          security set-keychain-settings -lut 21600 $KEYCHAIN_PATH
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH
          
          # 导入证书
          echo "$APPLE_CERTIFICATE" | base64 --decode > certificate.p12
          security import certificate.p12 -P "$APPLE_CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k $KEYCHAIN_PATH
          security list-keychain -d user -s $KEYCHAIN_PATH
          
          # 允许 codesign 访问
          security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH
      
      - name: Build and notarize
        env:
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        run: |
          npm run dist:mac
      
      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: macos-build
          path: |
            dist/*.dmg
            dist/*.zip
```

### 10.2 证书 Base64 编码

```bash
# 导出证书为 Base64（存入 GitHub Secrets）
base64 -i certificate.p12 | pbcopy

# 或保存到文件
base64 -i certificate.p12 -o certificate.txt
```

---

## 十一、完整配置示例

```yaml
# electron-builder.yml

appId: com.example.myapp
productName: My Application

mac:
  category: public.app-category.productivity
  icon: build/icon.icns
  darkModeSupport: true
  minimumSystemVersion: "10.13"
  
  target:
    - target: dmg
      arch: [x64, arm64]
    - target: zip
      arch: [x64, arm64]
  
  hardenedRuntime: true
  gatekeeperAssess: false
  
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  
  notarize:
    teamId: XXXXXXXXXX

dmg:
  background: build/background.png
  icon: build/volume.icns
  iconSize: 80
  window:
    width: 540
    height: 380
  contents:
    - x: 130
      y: 220
      type: file
    - x: 410
      y: 220
      type: link
      path: /Applications
  format: UDZO

afterSign: scripts/notarize.js
```

```xml
<!-- build/entitlements.mac.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
</dict>
</plist>
```

---

## 参考资源

- [Apple Code Signing 文档](https://developer.apple.com/documentation/security/code_signing_services)
- [Apple Notarization 文档](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [electron-builder macOS 配置](https://www.electron.build/configuration/mac)
- [@electron/notarize](https://github.com/electron/notarize)
- [Hardened Runtime](https://developer.apple.com/documentation/security/hardened_runtime)
