# Linux 构建与分发

> Linux 平台的 Electron 应用打包与分发指南

---

## 一、概述

### 1.1 Linux 发行版碎片化

```
┌─────────────────────────────────────────────────────────────────┐
│                    Linux 发行版生态                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Debian 系：                                                    │
│  ├── Ubuntu                                                    │
│  ├── Linux Mint                                                │
│  ├── Pop!_OS                                                   │
│  └── 使用 .deb 包                                              │
│                                                                 │
│  Red Hat 系：                                                   │
│  ├── Fedora                                                    │
│  ├── CentOS / Rocky Linux                                      │
│  ├── RHEL                                                      │
│  └── 使用 .rpm 包                                              │
│                                                                 │
│  其他：                                                         │
│  ├── Arch Linux (pacman)                                       │
│  ├── openSUSE (zypper)                                         │
│  └── 各种小众发行版                                             │
│                                                                 │
│  解决方案：                                                      │
│  ├── AppImage - 跨发行版便携格式                                │
│  ├── Snap - Ubuntu 主推的沙盒格式                               │
│  └── Flatpak - 另一种沙盒格式                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、目标格式

### 2.1 AppImage（推荐）

```yaml
# electron-builder.yml
linux:
  target:
    - AppImage

appImage:
  # 许可协议
  license: LICENSE.txt
  
  # 桌面集成类别
  category: Utility
```

**AppImage 特点**：

| 优点 | 缺点 |
|------|------|
| 跨发行版兼容 | 需要 FUSE 支持 |
| 无需安装，双击运行 | 无系统集成（菜单等） |
| 无需 root 权限 | 体积较大 |
| 自带所有依赖 | 某些发行版需配置 |

```bash
# 运行 AppImage
chmod +x MyApp.AppImage
./MyApp.AppImage

# 提取内容
./MyApp.AppImage --appimage-extract
```

### 2.2 deb（Debian/Ubuntu）

```yaml
linux:
  target:
    - deb

deb:
  # 依赖声明
  depends:
    - libgtk-3-0
    - libnotify4
    - libnss3
    - libxss1
    - libxtst6
    - xdg-utils
    - libatspi2.0-0
    - libuuid1
  
  # 推荐依赖
  recommends:
    - libappindicator3-1
  
  # 优先级
  priority: optional
  
  # 压缩
  compression: xz
  
  # 安装后脚本
  afterInstall: scripts/postinst.sh
  afterRemove: scripts/postrm.sh
```

```bash
# 安装 deb 包
sudo dpkg -i myapp_1.0.0_amd64.deb

# 解决依赖
sudo apt-get install -f

# 或使用 apt
sudo apt install ./myapp_1.0.0_amd64.deb
```

### 2.3 rpm（Fedora/RHEL）

```yaml
linux:
  target:
    - rpm

rpm:
  # 依赖
  depends:
    - gtk3
    - libnotify
    - nss
    - libXScrnSaver
    - libXtst
    - xdg-utils
    - at-spi2-core
    - libuuid
  
  # 压缩
  compression: xz
  
  # 安装后脚本
  afterInstall: scripts/postinst.sh
```

```bash
# 安装 rpm 包
sudo dnf install myapp-1.0.0.x86_64.rpm
# 或
sudo rpm -i myapp-1.0.0.x86_64.rpm
```

### 2.4 snap

```yaml
linux:
  target:
    - snap

snap:
  # 约束模式
  confinement: strict  # strict | classic | devmode
  
  # 级别
  grade: stable  # stable | devel
  
  # 插槽
  plugs:
    - default
    - desktop
    - desktop-legacy
    - home
    - x11
    - wayland
    - unity7
    - browser-support
    - network
    - gsettings
    - audio-playback
    - pulseaudio
```

### 2.5 flatpak

```yaml
linux:
  target:
    - flatpak

flatpak:
  # 运行时
  runtime: org.freedesktop.Platform
  runtimeVersion: '23.08'
  sdk: org.freedesktop.Sdk
  
  # 权限
  finishArgs:
    - '--share=ipc'
    - '--socket=x11'
    - '--socket=wayland'
    - '--socket=pulseaudio'
    - '--share=network'
```

---

## 三、Linux 基础配置

```yaml
# electron-builder.yml

linux:
  # 目标格式
  target:
    - AppImage
    - deb
    - rpm
  
  # 应用分类
  category: Utility
  # 可选值：
  # AudioVideo, Audio, Video, Development, Education,
  # Game, Graphics, Network, Office, Science, Settings,
  # System, Utility
  
  # 图标（目录，包含多尺寸 PNG）
  icon: build/icons
  
  # 可执行文件名
  executableName: myapp
  
  # 简介
  synopsis: "Short description"
  
  # 描述
  description: "Longer description of the application"
  
  # 维护者
  maintainer: "maintainer@example.com"
  
  # 厂商
  vendor: "My Company"
  
  # 桌面文件设置
  desktop:
    Name: My Application
    GenericName: Application
    Comment: My Application Description
    Keywords: app;tool;
    StartupNotify: true
    StartupWMClass: MyApp
```

---

## 四、桌面集成

### 4.1 .desktop 文件

```ini
# 自动生成的 .desktop 文件示例
[Desktop Entry]
Name=My Application
GenericName=Application
Comment=My Application Description
Exec=/opt/myapp/myapp %U
Icon=myapp
Type=Application
Categories=Utility;
Keywords=app;tool;
StartupNotify=true
StartupWMClass=MyApp
MimeType=x-scheme-handler/myapp;
```

### 4.2 图标安装

```
build/icons/
├── 16x16.png
├── 32x32.png
├── 48x48.png
├── 64x64.png
├── 128x128.png
├── 256x256.png
└── 512x512.png

# 安装到系统目录：
/usr/share/icons/hicolor/16x16/apps/myapp.png
/usr/share/icons/hicolor/32x32/apps/myapp.png
...
```

### 4.3 MIME 类型注册

```yaml
linux:
  mimeTypes:
    - x-scheme-handler/myapp
    - application/x-myapp
```

### 4.4 文件关联

```yaml
fileAssociations:
  - ext: myapp
    name: MyApp Document
    mimeType: application/x-myapp
    icon: document
```

---

## 五、常见问题

### 5.1 FUSE 依赖（AppImage）

```bash
# AppImage 需要 FUSE
# Ubuntu/Debian
sudo apt install libfuse2

# Fedora
sudo dnf install fuse

# 如果没有 FUSE，可以提取运行
./MyApp.AppImage --appimage-extract
./squashfs-root/AppRun
```

### 5.2 glibc 版本兼容

```
问题：老版本 Linux 运行失败
原因：glibc 版本过低

解决：
1. 在较老的系统上构建（如 Ubuntu 18.04）
2. 使用 Docker 容器构建
3. 提示用户升级系统

# 检查 glibc 版本
ldd --version
```

### 5.3 libstdc++ 兼容

```bash
# 某些系统可能需要
sudo apt install libstdc++6

# 或使用 AppImage（自带依赖）
```

### 5.4 图形库依赖

```bash
# 常见依赖
sudo apt install \
  libgtk-3-0 \
  libnotify4 \
  libnss3 \
  libxss1 \
  libxtst6 \
  libatspi2.0-0

# 图标/托盘支持
sudo apt install libappindicator3-1
```

### 5.5 沙盒权限（snap/flatpak）

```bash
# snap 权限管理
snap connections myapp
sudo snap connect myapp:home

# flatpak 权限
flatpak permission-list
flatpak run --command=sh com.example.myapp
```

### 5.6 AppArmor/SELinux

```bash
# 如果被安全模块阻止

# AppArmor (Ubuntu)
sudo aa-complain /path/to/myapp
# 或
sudo aa-disable /etc/apparmor.d/myapp

# SELinux (Fedora/RHEL)
sudo setenforce 0  # 临时禁用
# 或配置正确的 context
```

---

## 六、构建环境

### 6.1 本地构建

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y build-essential

# 构建
npm run dist:linux
```

### 6.2 Docker 构建

```dockerfile
# Dockerfile
FROM electronuserland/builder:wine

WORKDIR /app
COPY . .

RUN npm ci
RUN npm run dist:linux
```

```bash
# 构建
docker build -t myapp-builder .
docker run --rm -v $(pwd)/dist:/app/dist myapp-builder
```

### 6.3 GitHub Actions

```yaml
build-linux:
  runs-on: ubuntu-latest
  
  steps:
    - uses: actions/checkout@v4
    
    - uses: actions/setup-node@v4
      with:
        node-version: '18'
    
    - run: npm ci
    - run: npm run dist:linux
    
    - uses: actions/upload-artifact@v4
      with:
        name: linux-build
        path: |
          dist/*.AppImage
          dist/*.deb
```

---

## 七、分发渠道

### 7.1 官网下载

```
推荐提供：
1. AppImage - 通用便携版
2. deb - Ubuntu/Debian 用户
3. rpm - Fedora/RHEL 用户
```

### 7.2 Snap Store

```bash
# 发布到 Snap Store
snapcraft login
snapcraft upload myapp_1.0.0_amd64.snap
snapcraft release myapp 1 stable
```

### 7.3 Flathub

```bash
# 提交到 Flathub
# 需要创建 manifest 并提交 PR
# https://github.com/flathub/flathub
```

### 7.4 AUR（Arch Linux）

```bash
# 创建 PKGBUILD
# 提交到 AUR
# https://aur.archlinux.org/
```

---

## 八、完整配置示例

```yaml
# electron-builder.yml

appId: com.example.myapp
productName: My Application

linux:
  target:
    - target: AppImage
      arch: [x64]
    - target: deb
      arch: [x64]
    - target: rpm
      arch: [x64]
  
  category: Utility
  icon: build/icons
  executableName: myapp
  
  synopsis: "A great application"
  description: |
    My Application is a great tool for...
    Features include...
  
  maintainer: "support@example.com"
  vendor: "My Company"
  
  desktop:
    Name: My Application
    Comment: A great application
    Keywords: app;tool;utility;
    StartupNotify: true
    StartupWMClass: MyApp
  
  mimeTypes:
    - x-scheme-handler/myapp

appImage:
  license: LICENSE.txt

deb:
  depends:
    - libgtk-3-0
    - libnotify4
    - libnss3
    - libxss1
    - libxtst6
    - xdg-utils
    - libatspi2.0-0
  priority: optional
  compression: xz

rpm:
  depends:
    - gtk3
    - libnotify
    - nss
    - libXScrnSaver
    - libXtst
    - xdg-utils
    - at-spi2-core
  compression: xz
```

---

## 参考资源

- [electron-builder Linux 配置](https://www.electron.build/configuration/linux)
- [AppImage 文档](https://docs.appimage.org/)
- [Snap 开发指南](https://snapcraft.io/docs)
- [Flatpak 文档](https://docs.flatpak.org/)
- [FreeDesktop 规范](https://www.freedesktop.org/wiki/Specifications/)
