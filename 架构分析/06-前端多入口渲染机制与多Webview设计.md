# 06 前端多入口渲染机制与多Webview设计

> **适用仓库**：`galaxy`（React 前端渲染端）+ `galaxy-client`（Electron 主进程端）  
> **文档目标**：彻底搞清楚「为什么 debug 时看到多份 webview」以及各窗口的加载时序。  
> **前提**：`galaxy` 仓库的 `electron/` 目录代码已废弃，窗口管理完全由 `galaxy-client` 承担。

---

## 一、整体窗口架构

### 1.1 架构图

```
┌──────────────────────────────────────────────────────────────────────┐
│                  galaxy-client（Electron 主进程）                      │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │       BrowserWindow（主窗口）                                  │    │
│  │       preload: extraResources/load/inject.js                 │    │
│  │       nodeIntegration: true                                  │    │
│  │       webviewTag: true                                       │    │
│  │                                                              │    │
│  │  ┌──────────────────────────────────────────────────────┐    │    │
│  │  │              前端页面（galaxy 仓库打包产物）             │    │    │
│  │  │                                                      │    │    │
│  │  │  初始加载：load.html（或 CAS 登录页）                  │    │    │
│  │  │      ↓ 登录成功后                                     │    │    │
│  │  │  menu.html（主控面板）                                │    │    │
│  │  │  ┌────────────────────────────────────────────┐      │    │    │
│  │  │  │            EmbedSys 嵌入式子系统             │      │    │    │
│  │  │  │                                            │      │    │    │
│  │  │  │  ┌─────────┐  ┌──────────┐  ┌──────────┐ │      │    │    │
│  │  │  │  │ COMP    │  │ IFRAME   │  │ ROUTE    │ │      │    │    │
│  │  │  │  │ (React) │  │ (<iframe>│  │ (Router) │ │      │    │    │
│  │  │  │  │ 工作台   │  │  SOP等)  │  │ 群发等   │ │      │    │    │
│  │  │  │  └─────────┘  └──────────┘  └──────────┘ │      │    │    │
│  │  │  │                                            │      │    │    │
│  │  │  │  ┌──────────────────────────────────────┐ │      │    │    │
│  │  │  │  │ WEBVIEW (<webview> 标签)              │ │      │    │    │
│  │  │  │  │ preload: webviewPreload.js           │ │      │    │    │
│  │  │  │  │ 独立渲染进程                          │ │      │    │    │
│  │  │  │  └──────────────────────────────────────┘ │      │    │    │
│  │  │  └────────────────────────────────────────────┘      │    │    │
│  │  └──────────────────────────────────────────────────────┘    │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  另外 3 个 HTML 入口（sub.html / vpn.html / load.html）              │
│  通过同一个 BrowserWindow 的 loadURL 切换加载                         │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.2 4 个 HTML 入口

| 入口 | 文件 | 职责 | 加载时机 |
|------|------|------|----------|
| `load.html` | `galaxy/src/entries/load/` | 加载页/启动动画，等待主进程就绪 | 最先加载（未登录时） |
| `menu.html` | `galaxy/src/entries/menu/` | ★ 主控制面板，全局状态管理、WebSocket、EmbedSys | 登录成功后加载 |
| `sub.html` | `galaxy/src/entries/sub/` | 功能子页（群发、好友申请等15+模块） | 按需加载（旧架构） |
| `vpn.html` | `galaxy/src/entries/vpn/` | VPN 登录页 | 特定网络环境下加载 |

---

## 二、多入口构建机制

### 2.1 config-overrides.js 入口定义

**文件路径**：`galaxy/config-overrides.js`

```javascript
function createEntry(name) {
    const isBrowserBuild = process.env.BUILD_PATH === 'browser' || process.env.BUILD_PATH === 'browserDev';
    const browserEntryPath = path.resolve(__dirname, `src/entries/${name}/index.browser.js`);
    const entryFile = isBrowserBuild && fs.existsSync(browserEntryPath)
        ? `src/entries/${name}/index.browser.js`
        : `src/entries/${name}/index.js`;
    return {
        entry: entryFile,
        template: isBrowserBuild ? 'public/browser.html' : 'public/index.html',
        outPath: `/${isBrowserBuild ? 'index' : name}.html`,
    };
}

const sub = createEntry('sub');
const menu = createEntry('menu');
const vpn = createEntry('vpn');
const load = createEntry('load');
```

### 2.2 BUILD_PATH 与入口选择

| `BUILD_PATH` | 入口列表 | 说明 |
|--------------|----------|------|
| `browser` | `[menu]` | 浏览器模式，仅 menu 入口 |
| `browserDev` | `[menu]` | 浏览器开发模式 |
| `web` | `[menu, sub, vpn, load]` | 完整 Web 构建（4 个入口） |
| `build` | `[vpn, load]` | 仅构建 vpn 和 load |
| 默认（未设置） | `[vpn, load, menu, sub]` | 开发模式，全量入口 |

### 2.3 构建产物

每个入口生成独立的 HTML 文件和对应的 JS/CSS bundle：

```
build/
├── menu.html       # 主控面板
├── sub.html        # 功能子页
├── vpn.html        # VPN 登录
├── load.html       # 加载页
└── static/
    ├── js/         # 各入口 JS bundle
    └── css/        # 各入口 CSS bundle
```

### 2.4 关键 Webpack 别名

```javascript
addWebpackAlias({
    '@': path.join(__dirname, './src'),
    '@staging': path.join(__dirname, './src/entries/menu/component/staging'),
    'electron': path.join(__dirname, './src/alias/electron'),
})
```

`electron` 别名指向 `src/alias/electron.js`，这是在浏览器环境下对 Electron API 的 mock 适配层。在 Electron 环境中，`inject.js` 已经通过 `window.require('electron')` 暴露了真实的 Electron 模块。

### 2.5 条件编译

**浏览器模式构建**时，`conditional-loader.js` 被启用：

```javascript
const addConditionalLoader = () => (config) => {
    const isBrowserBuild = process.env.BUILD_PATH === 'browser';
    if (isBrowserBuild) {
        // 在 babel-loader 之后追加 conditional-loader
        // 用于剔除 Electron 专属代码
    }
};
```

这使得同一份前端代码可以同时运行在 Electron 和浏览器环境中。

---

## 三、load.html — 加载入口

**入口文件**：`galaxy/src/entries/load/index.js`

### 3.1 职责

1. 显示启动动画（Loading 界面）
2. 等待主进程就绪信号
3. 作为 CAS 登录流程的承载页

### 3.2 加载时机

```
Electron 启动
    │
    ▼
getLoadUrlAsync()
    │
    ├─ userId 不存在 → loginUrl (CAS 登录页)
    │     └─ 登录成功后重定向 → menu.html
    │
    └─ userId 存在 → successUrl (menu.html)
```

### 3.3 与主进程的通信

主进程 `initWindow()` 中监听 CAS 登录成功的重定向：

```javascript
session.defaultSession.webRequest.onBeforeRedirect({ urls: [] }, details => {
    const { redirectURL } = details;
    const redirectHost = getHostName(redirectURL);
    if (['www.baijiahulian.com', 'www.baijia.com'].includes(redirectHost)) {
        const nextUrl = getLoadUrl();  // → menu.html
        app.mainWindow.loadURL(nextUrl);
    }
});
```

---

## 四、menu.html — 主控制面板

**入口文件**：`galaxy/src/entries/menu/index.js`

### 4.1 职责

1. **全局状态管理**：Redux Store（账号列表、配置、UI 状态）
2. **WebSocket 管理**：连接 galaxy-client 的 frontServer，接收实时消息推送
3. **导航框架**：侧边栏 + EmbedSys 嵌入式子系统
4. **多 Tab 管理**：TabNav + TabView 实现多标签页切换

### 4.2 使用 MemoryRouter 的原因

menu.html 使用 React Router 的 `MemoryRouter` 而非 `BrowserRouter`：
- Electron 中 URL 是 `file://` 协议或远程 HTTPS，不依赖浏览器地址栏
- `MemoryRouter` 将路由状态保存在内存中，不修改 URL
- 避免页面刷新时路由状态丢失

### 4.3 EmbedSys 组件架构

**文件路径**：`galaxy/src/entries/menu/component/EmbedSys/index.tsx`

```jsx
const EmbedSys = (props: IProps) => {
    return (
        <Antd5ConfigProvider locale={locale} prefixCls="ant5">
            <AntdConfigProvider locale={zhCN}>
                <ErrorBoundary>
                    <StyleProvider>
                        <TabProvider>
                            <Layout className="embedSys">
                                <TabNav />          {/* 左侧标签导航 */}
                                <Content>
                                    <TabView />     {/* 右侧内容区域 */}
                                </Content>
                            </Layout>
                        </TabProvider>
                    </StyleProvider>
                </ErrorBoundary>
            </AntdConfigProvider>
        </Antd5ConfigProvider>
    );
};
```

架构层次：
- `TabProvider`：标签上下文，管理当前激活标签
- `TabNav`：左侧导航栏，渲染菜单列表
- `TabView`：右侧内容区，根据当前标签类型渲染对应组件

---

## 五、EmbedSys 嵌入类型详解

### 5.1 类型定义

**文件路径**：`galaxy/src/entries/menu/component/EmbedSys/types.ts`

```typescript
export enum EmbedTypeEnum {
    ROUTE = 'route',      // React Router 内部路由
    IFRAME = 'iframe',    // <iframe> 嵌入
    WEBVIEW = 'webview',  // Electron <webview> 标签
    COMP = 'comp',        // React 组件直接渲染
}

export type IMenuItem = {
    key: string;           // 唯一标识
    path: string;          // 路由路径
    name: string;          // 显示名称
    icon: string;          // 图标类名
    embedType: EmbedTypeEnum;  // 嵌入类型
    embedPath?: string;    // 嵌入路径（IFRAME/WEBVIEW 使用）
    refreshKey?: string;   // 刷新键
    meta?: any;            // 元信息
    style?: string;        // 样式类名
};
```

### 5.2 菜单配置

**文件路径**：`galaxy/src/entries/menu/component/EmbedSys/menu.ts`

```typescript
export const allMenus: IMenuItem[] = [
    {
        key: 'homeEmbed',
        name: '工作台',
        embedType: EmbedTypeEnum.COMP,        // ★ React 组件
    },
    {
        key: 'friendApplication',
        name: '加好友方案',
        embedType: EmbedTypeEnum.IFRAME,       // ★ iframe 嵌入
        embedPath: '/aiSopFe/staging/friendApplication',
    },
    {
        key: 'sop',
        name: '顾问sop',
        embedType: EmbedTypeEnum.IFRAME,
        embedPath: '/aiSopFe/staging/sop',
    },
    {
        key: 'operationsSop',
        name: '销转运营管理',
        embedType: EmbedTypeEnum.IFRAME,
        embedPath: '/aiSopFe/staging/operationsSop',
    },
    {
        key: 'imisChat',
        name: '消息管理',
        embedType: EmbedTypeEnum.ROUTE,        // ★ 内部路由
        embedPath: '/imis-chat/custom',
    },
    {
        key: 'groupMessage',
        name: '群发',
        embedType: EmbedTypeEnum.ROUTE,
    },
    {
        key: 'smartReply',
        name: '智能应答',
        embedType: EmbedTypeEnum.ROUTE,
    },
    {
        key: 'joinGroupReply',
        name: '进群欢迎语',
        embedType: EmbedTypeEnum.ROUTE,
    },
];
```

### 5.3 四种嵌入类型的渲染方式

#### COMP — React 组件直接渲染

```
menu.html 页面
└── EmbedSys
    └── TabView
        └── homeEmbed/index.tsx（React 组件，直接在当前进程渲染）
```

特点：
- 最轻量，与主页面共享 Redux Store
- 适用于简单的仪表盘/概览页

#### IFRAME — `<iframe>` 嵌入外部页面

```
menu.html 页面
└── EmbedSys
    └── TabView
        └── iframeWeb/index.tsx
            └── <iframe src="https://domain/aiSopFe/staging/friendApplication?..." />
```

特点：
- 加载外部部署的独立前端应用（如 aiSopFe）
- 与主页面完全隔离（独立 JS 执行上下文）
- 通过 URL 参数传递 userId、from 等信息

#### ROUTE — React Router 内部路由

```
menu.html 页面
└── EmbedSys
    └── TabView
        └── React.lazy(() => import('./groupMessage'))
            └── 群发功能模块组件
```

特点：
- 代码分割（`React.lazy` + 动态 `import()`）
- 与主页面共享 Redux Store 和 WebSocket 连接
- 适用于需要实时数据的业务模块

#### WEBVIEW — Electron `<webview>` 标签

```
menu.html 页面
└── EmbedSys
    └── TabView
        └── webviewWeb/index.tsx
            └── <webview src="https://domain/page?..."
                         preload="webviewPreload.js" />
```

特点：
- 每个 `<webview>` 是一个独立的 Chromium 渲染进程
- 在 DevTools 中会看到独立的 webContents
- 有独立的 preload 脚本（webviewPreload.js）
- 当前菜单配置中**未使用**（imisChat 已从 WEBVIEW 改为 ROUTE）

---

## 六、多 Webview 的来源分析

### 6.1 为什么 DevTools 中会看到多个渲染进程

在 Electron 的任务管理器或 Chrome DevTools 中可能看到多个渲染进程，来源有：

| 来源 | 数量 | 说明 |
|------|------|------|
| BrowserWindow 主窗口 | 1 个 | 加载 menu.html 的主渲染进程 |
| `<iframe>` 标签 | N 个 | 每个 iframe 共享主渲染进程（同进程不同上下文） |
| `<webview>` 标签 | N 个 | ★ 每个 webview 是独立渲染进程 |
| DevTools 窗口 | 0-1 个 | 如果打开了开发者工具 |

### 6.2 webviewTag: true 的作用

在 `galaxy-client/src/init/window.js` 中：

```javascript
webPreferences: {
    webviewTag: true,  // 允许在渲染进程中使用 <webview> 标签
}
```

这使得 `galaxy` 前端代码可以在 HTML 中直接使用 `<webview>` 标签嵌入独立的子页面。

### 6.3 webviewWeb 组件实现

**文件路径**：`galaxy/src/entries/menu/component/EmbedSys/webviewWeb/index.tsx`

关键代码：

```tsx
const WebviewWeb: React.FC<IProps> = props => {
    const { iframeKey, path: pagePath, pathKey, refreshKey, pathParams, selectedKey } = props;
    const targetRef = useRef(null);
    const casId = getGlobalData('casId');
    
    // 构建 webview URL
    const domain = config.uqunUrl;
    let webviewUrl = `${domain}${pagePath}?from=tongbao`;
    if (userIdTemp) {
        webviewUrl += `&userId=${userIdTemp}&grayCasId=${casId}`;
    }
    
    // preload 路径来自 inject.js 注入的全局变量
    const filePath = window?.preloadWebviewPath;
    let webPreferencesStr = 'allowRunningInsecureContent, enableRemoteModule, contextIsolation=true, nodeIntegration=true';
    
    return (
        <div className={styles.webviewWeb}>
            <Button onClick={toggleWebviewConsole} />  {/* DevTools 开关 */}
            {loading && <Spin />}
            <webview
                id={`webview-${iframeKey}`}
                ref={targetRef}
                key={compKey}
                webpreferences={webPreferencesStr}
                src={webviewUrl}
                preload={filePath}
            />
        </div>
    );
};
```

### 6.4 webview 生命周期事件

```typescript
useEffect(() => {
    const webview = targetRef.current;
    if (webview) {
        webview.addEventListener('did-start-loading', () => setLoading(true));
        webview.addEventListener('did-stop-loading', () => setLoading(false));
        webview.addEventListener('did-fail-load', () => setLoading(false));
    }
}, [compKey]);
```

### 6.5 webview 刷新机制

通过 React 的 `key` 属性控制刷新：

```typescript
const [compKey, setCompKey] = useState(iframeKey);

useEffect(() => {
    debouncedEffect();  // 200ms 防抖
}, [debouncedUpdate, iframeKey, refreshKey]);

// refreshKey 变化 → compKey 变化 → React 销毁旧 webview 并创建新的
const keyTemp = `${iframeKey}-${refreshKey}`;
setCompKey(keyTemp);
```

---

## 七、inject.js — 主窗口 Preload 注入脚本

**文件路径**：`galaxy-client/extraResources/load/inject.js`

### 7.1 全局变量注入

```javascript
window.__injected = true;                    // 标记已注入
window.require = require;                    // 暴露 Node.js require
window.preloadPath = path.join('file://', path.join(__dirname, './inject.js'));
window.eleRemote = require('@electron/remote');           // 暴露 Electron Remote
window.eleRemoteMain = require('@electron/remote/main');
window.isDev = !eleRemote.app.isPackaged;                 // 开发模式标记
window.preloadWebviewPath = path.join('file://', path.join(__dirname, './webviewPreload.js'));
```

这些全局变量使得 `galaxy` 前端代码可以：
- 直接使用 `window.require()` 加载 Node.js 模块
- 通过 `window.eleRemote` 访问主进程 API
- 获取 `window.preloadWebviewPath` 作为 webview 的 preload 路径

### 7.2 CAS 自动填充

```javascript
(function () {
    const DELAY = 1000;
    const ipc = require('electron').ipcRenderer;
    
    window.addEventListener('DOMContentLoaded', function () {
        // CAS 登录页：自动填充用户名
        if (~location.href.indexOf('cas')) {
            ipc.on('cas-auto-complete-info', (event, data) => {
                username = data.username;
                // 使用 nativeInputValueSetter 设置 input 值
                // 并触发 input 事件使 React 感知到变化
            });
            setInterval(() => {
                ipc.send('cas-auto-complete-info');
            }, DELAY);
        }
        
        // 登录信息页：检测错误并自动退出
        if (~location.href.indexOf('userLoginInfo')) {
            if (isError) {
                ipc.send('userLogout');
            }
        }
    });
})();
```

### 7.3 nativeInputValueSetter 技巧

```javascript
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
).set;
nativeInputValueSetter.call(input, username);
const event = new Event('input', { bubbles: true });
input.dispatchEvent(event);
```

React 会劫持 `input.value` 的 setter，直接赋值不会触发 React 的 onChange。使用原生 setter + 手动派发事件可以绕过这个问题。

---

## 八、webviewPreload.js — Webview Preload 脚本

**文件路径**：`galaxy-client/extraResources/load/webviewPreload.js`

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    readFileAsBase64: (filePath) => {
        return ipcRenderer.invoke('readFileAsBase64', filePath);
    }
});
```

### 8.1 与 inject.js 的区别

| 特性 | inject.js（主窗口 preload） | webviewPreload.js（webview preload） |
|------|---------------------------|-------------------------------------|
| 目标 | BrowserWindow 主渲染进程 | `<webview>` 标签内部 |
| `contextIsolation` | `false` | `true`（webview 默认） |
| API 暴露方式 | 直接挂载到 `window` | 通过 `contextBridge.exposeInMainWorld` |
| 暴露范围 | 完整的 `require`、`@electron/remote` | 仅 `electronAPI.readFileAsBase64` |
| 安全性 | 较低（完全暴露 Node.js） | 较高（最小化 API 暴露） |

### 8.2 webview 内部调用主进程

webview 内嵌页面通过以下方式调用主进程：

```javascript
// webview 内部的 JavaScript
const base64Data = await window.electronAPI.readFileAsBase64('/path/to/file');
```

这会触发 `galaxy-client/src/event/ipc.js` 中的 handler：

```javascript
ipc.handle('readFileAsBase64', async (event, filePath) => {
    const formatPath = filePath.replace(/%20/g, ' ');
    return new Promise((resolve, reject) => {
        fs.readFile(formatPath, (err, bitmap) => {
            const base64Data = `data:image/png;base64,${Buffer.from(bitmap, 'binary').toString('base64')}`;
            resolve(base64Data);
        });
    });
});
```

---

## 九、sub.html — 功能子页窗口

**入口文件**：`galaxy/src/entries/sub/index.js`

### 9.1 职责

承载群发、好友申请等 15+ 功能模块，每个模块通过动态路由加载。

### 9.2 动态路由原理

`menu.config.js` 定义菜单配置，通过 `React.lazy(() => import(...))` 实现代码分割：

```javascript
// galaxy/src/config/menu.config.js
const menus = [
    { key: 'groupMessage', component: React.lazy(() => import('../entries/sub/pages/groupMessage')) },
    { key: 'smartReply', component: React.lazy(() => import('../entries/sub/pages/smartReply')) },
    // ... 更多模块
];
```

### 9.3 与 menu.html 的通信

`sub.html` 与 `menu.html` 运行在不同的渲染进程上下文中（不同的 HTML 页面），**无法直接共享 Redux Store**。

通信方式：
1. **Electron IPC**：通过 `ipcRenderer.send()` / `ipcRenderer.on()` 与主进程通信
2. **主进程中转**：主进程收到消息后通过 `webContents.send()` 转发给目标窗口

### 9.4 sub 窗口的现状

在当前架构中，`sub.html` 的大部分功能已迁移到 `menu.html` 的 EmbedSys 中通过 ROUTE 类型实现。sub.html 主要保留向后兼容性。

---

## 十、vpn.html — VPN 登录页

**入口文件**：`galaxy/src/entries/vpn/index.js`

### 10.1 职责

当网络连通性检查失败时，显示 VPN 登录/配置页面。

### 10.2 加载时机

```javascript
// galaxy-client/src/common/loadUrl.js
async function getLoadUrlAsync() {
    const result = await net.check();
    if (result) {
        return getLoadUrl();   // 网络正常 → 登录/主页
    }
    return offlineUrl;         // 网络异常 → 离线页(error.html)
}
```

当前实现中 `offlineUrl` 指向 `error.html` 而非 `vpn.html`，vpn.html 通过特定条件触发加载。

---

## 十一、页面加载时序

### 11.1 首次启动（未登录）

```
1. Electron 启动 → electron.js
2. initWindow() → createStateWindow()
3. getLoadUrlAsync()
   └─ userId 不存在 → loginUrl (CAS 登录页)
4. mainWindow.loadURL(loginUrl)
   └─ 页面: https://cas.baijia.com/cas/login?service=...&userId=xxx
5. inject.js 执行 → CAS 自动填充用户名
6. 用户登录成功 → CAS 重定向
7. onBeforeRedirect 拦截 → 检测到 baijia.com 重定向
8. mainWindow.loadURL(successUrl)
   └─ 页面: https://tongbao.umeng100.com/web5/menu.html?userId=xxx
9. menu.html 加载 → EmbedSys 初始化
10. WebSocket 连接 galaxy-client frontServer
11. ready-to-show → 窗口可见
```

### 11.2 再次启动（已登录）

```
1. Electron 启动 → electron.js
2. initWindow() → createStateWindow()
3. getLoadUrlAsync()
   └─ userId 存在 → successUrl (menu.html)
4. mainWindow.loadURL(successUrl)
   └─ 页面: https://tongbao.umeng100.com/web5/menu.html?userId=xxx
5. inject.js 执行
6. menu.html 加载 → EmbedSys 初始化
7. WebSocket 连接 galaxy-client frontServer
8. ready-to-show → 窗口可见
```

### 11.3 网络异常启动

```
1. Electron 启动 → electron.js
2. initWindow() → createStateWindow()
3. getLoadUrlAsync()
   └─ net.check() 返回 false → offlineUrl
4. mainWindow.loadURL(offlineUrl)
   └─ 页面: file://...error.html
```

---

## 十二、安全配置分析

### 12.1 当前安全配置

| 配置 | 值 | 风险等级 | 说明 |
|------|-----|---------|------|
| `nodeIntegration` | `true` | ⚠️ 高 | 渲染进程可直接使用 Node.js API |
| `contextIsolation` | `false` | ⚠️ 高 | preload 和页面共享全局作用域 |
| `sandbox` | `false` | ⚠️ 中 | 渲染进程无沙箱限制 |
| `webviewTag` | `true` | ⚠️ 中 | 允许创建 webview（独立渲染进程） |
| `allowRunningInsecureContent` | `true` | ⚠️ 中 | HTTPS 页面可加载 HTTP 资源 |
| `enableRemoteModule` | `true` | ⚠️ 中 | 渲染进程可通过 @electron/remote 调用主进程 |

### 12.2 为什么选择这种配置

这是一个内部工具（非面向公众），且需要：
1. 前端代码直接调用 Electron API（`ipcRenderer`、`@electron/remote`）
2. 加载的页面是内部域名（`tongbao.umeng100.com`）
3. webview 内嵌页面需要访问文件系统（`readFileAsBase64`）

### 12.3 webview 安全配置

webview 标签的 `webpreferences` 属性：

```
allowRunningInsecureContent, enableRemoteModule, contextIsolation=true, nodeIntegration=true
```

尽管 webview 内部开启了 `contextIsolation=true`（比主窗口更安全），但 `nodeIntegration=true` 仍然允许 webview 内部页面访问 Node.js API。

---

## 十三、DevTools 中的多进程对应关系

在 Chrome DevTools 的任务管理器中，开发者可能看到：

| 进程名 | 对应组件 | PID 标识 |
|--------|----------|---------|
| Browser (主进程) | galaxy-client Node.js 主进程 | Electron 主进程 PID |
| Renderer (webContents #1) | BrowserWindow → menu.html | 主渲染进程 |
| Renderer (webContents #N) | `<webview>` 标签 (如有) | 每个 webview 独立进程 |
| GPU Process | Chromium GPU 进程 | — |
| Utility Process | 网络、存储等辅助进程 | — |

如果 EmbedSys 中有 3 个 WEBVIEW 类型的 Tab 被激活，就会看到 3 个额外的 Renderer 进程。`<iframe>` 类型的嵌入不会产生额外进程（与主渲染进程共享）。

---

## 十四、关键代码路径索引

| 功能 | 文件路径 |
|------|----------|
| 多入口定义 | `galaxy/config-overrides.js` |
| EmbedSys 主入口 | `galaxy/src/entries/menu/component/EmbedSys/index.tsx` |
| 嵌入类型定义 | `galaxy/src/entries/menu/component/EmbedSys/types.ts` |
| 菜单配置 | `galaxy/src/entries/menu/component/EmbedSys/menu.ts` |
| Webview 容器 | `galaxy/src/entries/menu/component/EmbedSys/webviewWeb/index.tsx` |
| iframe 容器 | `galaxy/src/entries/menu/component/EmbedSys/iframeWeb/index.tsx` |
| 工作台组件 | `galaxy/src/entries/menu/component/EmbedSys/homeEmbed/index.tsx` |
| 标签导航 | `galaxy/src/entries/menu/component/EmbedSys/TabNav/` |
| 标签内容 | `galaxy/src/entries/menu/component/EmbedSys/TabView/` |
| 标签上下文 | `galaxy/src/entries/menu/component/EmbedSys/TabContext.tsx` |
| 主窗口创建 | `galaxy-client/src/init/window.js` |
| 主窗口 preload | `galaxy-client/extraResources/load/inject.js` |
| Webview preload | `galaxy-client/extraResources/load/webviewPreload.js` |
| 条件编译 loader | `galaxy/conditional-loader.js` |
| Electron 别名 | `galaxy/src/alias/electron.js` |

---

*文档生成时间：2026-03-13 | 基于 galaxy-client + galaxy 仓库实际代码分析*
