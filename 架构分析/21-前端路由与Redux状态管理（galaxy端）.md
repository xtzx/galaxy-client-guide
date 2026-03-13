# 21 前端路由与 Redux 状态管理（galaxy 端）

> **文档定位**：`galaxy` 前端的页面组织、路由跳转、全局状态管理。  
> **核心架构**：4 个入口各自独立的 Redux Store + `MemoryRouter` + `React.lazy` 动态加载。

---

## 目录

1. [多入口路由架构总览](#1-多入口路由架构总览)
2. [菜单配置 menu.config.js](#2-菜单配置-menuconfigjs)
3. [sub 入口路由设计](#3-sub-入口路由设计)
4. [menu 入口路由设计](#4-menu-入口路由设计)
5. [Redux Store 架构](#5-redux-store-架构)
6. [State 完整结构](#6-state-完整结构)
7. [Actions 定义](#7-actions-定义)
8. [Thunks 异步逻辑](#8-thunks-异步逻辑)
9. [WebSocket 消息路由](#9-websocket-消息路由)
10. [跨窗口状态同步](#10-跨窗口状态同步)
11. [入口挂载与初始化](#11-入口挂载与初始化)
12. [关键代码路径索引](#12-关键代码路径索引)

---

## 1. 多入口路由架构总览

Galaxy 前端有 4 个 HTML 入口，每个入口是一个独立的 React 应用，拥有自己的 Redux Store 和路由系统：

```
┌──────────────────────────────────────────────────────────┐
│                  Electron BrowserWindow                    │
│                                                          │
│  ┌──────────────────┐                                    │
│  │   menu.html      │  ← 主控面板                        │
│  │   MemoryRouter   │                                    │
│  │   Redux Store    │                                    │
│  │   WebSocket 管理  │                                    │
│  │                  │                                    │
│  │  ┌──── webview ──────────────────────────┐            │
│  │  │                                       │            │
│  │  │   sub.html (channelId=0)              │            │
│  │  │   MemoryRouter + 动态路由             │            │
│  │  │   独立 Redux Store                    │            │
│  │  │                                       │            │
│  │  │   ┌─────────────────────────────┐     │            │
│  │  │   │ React.lazy 动态加载模块      │     │            │
│  │  │   │ broadCast / contacts / ...  │     │            │
│  │  │   └─────────────────────────────┘     │            │
│  │  │                                       │            │
│  │  └───────────────────────────────────────┘            │
│  │                                                      │
│  │  ┌──── webview (channelId=N) ─────────┐              │
│  │  │   sub.html (更多实例)               │              │
│  │  └────────────────────────────────────┘              │
│  └──────────────────┘                                    │
│                                                          │
│  ┌──────────────────┐  ┌──────────────────┐              │
│  │   load.html      │  │   vpn.html       │              │
│  │   (启动加载页)    │  │   (VPN 登录)     │              │
│  └──────────────────┘  └──────────────────┘              │
└──────────────────────────────────────────────────────────┘
```

### 1.1 为什么使用 MemoryRouter

所有入口都使用 `MemoryRouter` 而非 `BrowserRouter` 或 `HashRouter`，原因是：

1. **Electron 环境无传统 URL**：页面通过 `file://` 协议或 `localhost:3000` 加载，URL 变化没有意义
2. **多 webview 并存**：每个 `<webview>` 是独立的渲染进程，URL 互不影响
3. **路由状态在内存中管理**：不需要 URL 同步，避免了 URL 编码/解码的复杂性

---

## 2. 菜单配置 menu.config.js

**文件路径**：`galaxy/src/config/menu.config.js`

### 2.1 完整菜单项定义

```javascript
const allMenu = [
    { key: 'homePage',             icon: 'wxzs-iconhome',           name: '工作台'     },
    { key: 'broadCast',            icon: 'wxzs-iconqunfa',          name: '群发'       },
    { key: 'groupReply',           icon: 'wxzs-iconjinqunhuifu',    name: '进群回复'   },
    { key: 'friendApply',          icon: 'wxzs-iconjieshouhaoyou',  name: '好友申请'   },
    { key: 'smartReply',           icon: 'wxzs-iconsmartreply',     name: '智能回复'   },
    { key: 'contacts',             icon: 'wxzs-icontongxunlu',      name: '好友列表'   },
    { key: 'groupManage',          icon: 'wxzs-iconqunliao',        name: '批量退群'   },
    { key: 'groupInvitation',      icon: 'wxzs-iconinvitation',     name: '多群邀请'   },
    { key: 'groupInvitationNew',   icon: 'wxzs-iconinvitation',     name: '邀请入群'   },
    { key: 'autoKickout',          icon: 'wxzs-icontirenshibie',    name: '自动踢人'   },
    { key: 'blackWhiteList',       icon: 'wxzs-iconheibaimingdan',  name: '黑白名单'   },
    { key: 'checkChatroom',        icon: 'wxzs-iconshandiaorenyuan', name: '群成员去重' },
    { key: 'keywordPullGroup',     icon: 'wxzs-iconguanjianci',     name: '关键词拉群' },
    { key: 'acceptGroupInvitation', icon: 'wxzs-iconjieshou',       name: '接受群邀请' },
    { key: 'privateAddFriends',    icon: 'wxzs-iconmimi',           name: '踢私加好友' },
    { key: 'AddGroupFriend',       icon: 'wxzs-iconjiaqunhaoyou',   name: '加群好友'   },
    { key: 'qyZombieManage',       icon: 'wxzs-iconjiangshi',       name: '僵尸粉'     },
    { key: 'myGroup',              icon: '',                         name: '我的群'     },
];
```

每个菜单项的 `key` 同时作为：
- sub 路由的 `path`
- `React.lazy` 动态加载的目录名
- 功能模块的唯一标识

### 2.2 微信/企微模块支持列表

```javascript
const qySupport = [
    'broadCast', 'groupReply', 'friendApply', 'smartReply',
    'qyZombieManage', 'checkChatroom', 'groupInvitationNew', 'myGroup'
];

const wxSupport = [
    'broadCast', 'groupReply', 'friendApply', 'smartReply', 'contacts',
    'groupManage', 'groupInvitation', 'autoKickout', 'blackWhiteList',
    'checkChatroom', 'keywordPullGroup', 'acceptGroupInvitation',
    'privateAddFriends', 'AddGroupFriend'
];
```

### 2.3 动态菜单过滤逻辑

```javascript
export default {
    get menu() {
        // 每3分钟请求一次后端模块配置
        if (!timeFlag || (new Date().getTime() - timeFlag) > 3 * 60 * 1000) {
            const timer = setInterval(() => {
                const casId = getGlobalData('casId');
                if (casId) {
                    clearTimeout(timer);
                    askAndSetModules();
                }
            }, 16);
            timeFlag = new Date().getTime();
        }

        const moduleList = project.getConfig('modules');

        // 企微模块映射
        const qyModuleList = moduleList
            .map(item => item === 'zombieManage' ? 'qyZombieManage' : item)
            .map(item => item === 'groupInvitation' ? 'groupInvitationNew' : item)
            .filter(item => qySupport.includes(item));

        const wxModuleList = moduleList.filter(item => wxSupport.includes(item));

        return allMenu.filter((item) => {
            if (item.key === 'homePage') return true;  // 工作台始终显示
            if (getGlobalData('qyFlag')) {
                return qyModuleList.includes(item.key);  // 企微模式
            }
            return wxModuleList.includes(item.key);       // 微信模式
        });
    },
};
```

菜单过滤的多层机制：

1. **服务端控制**：`modules` 配置从 `runtime.yml` 或 Apollo 获取，服务端可控制模块开关
2. **产品类型过滤**：`qyFlag` 区分微信/企微，展示不同的模块集合
3. **定时刷新**：每 3 分钟调用 `askAndSetModules()` 从服务端拉取最新模块列表

### 2.4 askAndSetModules 模块同步

```javascript
export function askAndSetModules() {
    getModuleByElfKey({
        elfKey: project.getConfig('elfkey'),
        userName: getGlobalData('casId'),
    }).then((res) => {
        if (res && res.code === 200 && res.data) {
            ipc.send('set-modules', res.data.extendModule);
        }
    });
}
```

通过 IPC 将后端返回的 `extendModule` 配置写入主进程，更新 `runtime` 配置中的 `modules` 字段。

---

## 3. sub 入口路由设计

**文件路径**：`galaxy/src/entries/sub/router/index.js`

```javascript
import React from 'react';
import { Switch, Route, withRouter } from 'react-router-dom';
import menuConfig from '@/config/menu.config';
import { Spin } from 'antd';
import styles from '../app.module.scss';

const RouteConfig = () => {
    const getComponent = (key) => {
        return React.lazy(() => import(`../${key}/index`).catch((err) => {
            return import('../homePage');
        }));
    };
    return (
        <React.Suspense fallback={
            <div className={styles["spin-wrap"]}><Spin /></div>
        }>
            <Switch>
                <Route
                    exact={true}
                    path="/"
                    key="default"
                    component={getComponent('homePage')}
                />
                {menuConfig.menu.map(item => (
                    <Route
                        exact={true}
                        key={item.key}
                        path={`/${item.key}`}
                        component={getComponent(item.key)}
                    />
                ))}
            </Switch>
        </React.Suspense>
    );
};

export default withRouter(RouteConfig);
```

### 3.1 路由 → 组件的映射关系

| 路由路径 | 组件路径 | 功能模块 |
|----------|----------|----------|
| `/` | `entries/sub/homePage/index` | 工作台 |
| `/broadCast` | `entries/sub/broadCast/index` | 群发 |
| `/groupReply` | `entries/sub/groupReply/index` | 进群回复 |
| `/friendApply` | `entries/sub/friendApply/index` | 好友申请 |
| `/smartReply` | `entries/sub/smartReply/index` | 智能回复 |
| `/contacts` | `entries/sub/contacts/index` | 好友列表 |
| `/groupManage` | `entries/sub/groupManage/index` | 批量退群 |
| ... | ... | ... |

### 3.2 动态加载与降级

```javascript
const getComponent = (key) => {
    return React.lazy(() => import(`../${key}/index`).catch((err) => {
        return import('../homePage');  // 加载失败降级到首页
    }));
};
```

- 使用 `React.lazy` + `import()` 实现代码分割
- 每个功能模块按需加载，首次访问时才下载对应的 JS chunk
- 如果模块路径不存在（如配置了但代码未实现），自动降级到 `homePage`

### 3.3 加载状态

```jsx
<React.Suspense fallback={<div className={styles["spin-wrap"]}><Spin /></div>}>
```

使用 antd 的 `Spin` 组件作为加载中状态。

---

## 4. menu 入口路由设计

menu 入口使用 `MemoryRouter` 作为路由容器，但实际路由逻辑相对简单：

**文件路径**：`galaxy/src/entries/menu/index.js`

```javascript
<MemoryRouter>
    <App />
</MemoryRouter>
```

menu 入口主要通过 EmbedSys（嵌入子系统）来管理多个 webview，而非传统的页面路由。路由切换实际上是通过 webview 的显示/隐藏来实现的（详见文档06）。

---

## 5. Redux Store 架构

### 5.1 Store 创建

**文件路径**：`galaxy/src/entries/menu/store/index.js`

```javascript
import { createStore, applyMiddleware, compose } from 'redux';
import thunk from 'redux-thunk';
import * as api from '@/common/api';
import defaultReducer from './reducer';

const composeEnhancers = window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose;
const store = createStore(
    defaultReducer,
    composeEnhancers(
        applyMiddleware(thunk.withExtraArgument(api))
    )
);

export default store;
```

### 5.2 技术栈选择

| 技术 | 说明 |
|------|------|
| `redux` | 状态管理核心 |
| `redux-thunk` | 异步 action 中间件 |
| `thunk.withExtraArgument(api)` | 注入 API 模块到 thunk |
| Redux DevTools | 开发调试支持 |

### 5.3 Store 目录结构

```
galaxy/src/entries/menu/store/
├── index.js          # createStore 入口
├── reducer.js        # 主 reducer
├── actions.js        # Action creators
├── constantes.js     # Action type 常量
├── thunks.js         # 异步 thunks（WebSocket、SOP 等）
├── initState.js      # SOP 相关初始状态
├── helper.js         # getAllConfigFilter 等工具
├── request.js        # HTTP 请求封装
└── group/            # 群相关子模块
    ├── reducer.js
    ├── actions.js
    └── constantes.js
```

---

## 6. State 完整结构

**文件路径**：`galaxy/src/entries/menu/store/reducer.js`

### 6.1 核心状态分类

```javascript
const defaultState = {
    // ===== 导航与菜单 =====
    menu_select_key: '',         // 当前选中的菜单项
    menu_list: [],               // 菜单列表

    // ===== 账号与配置 =====
    currentAccount: 0,           // 当前选中的微信账号 channelId
    previousAccount: 0,          // 上一个选中的账号
    allConfig: [],               // 所有微信实例配置列表
    isReceiveAllConfig: false,   // 是否已接收到配置
    userInfo: null,              // CAS 登录用户信息
    accountList: [],             // CAS 账号列表

    // ===== WebSocket =====
    wsMenu: null,                // WebSocket 实例引用
    news: {},                    // 最新消息（传递给子页面）

    // ===== 状态标记 =====
    javaCrash: false,            // Java 客户端崩溃标识
    heartbeatCount: 0,           // 心跳计数
    isLoading: false,            // 全局加载状态

    // ===== 企微相关 =====
    qywxVersionInfo: { visible: false, message: '', inited: false },
    loginedQywxList: [],         // 已登录企微列表

    // ===== 绑定与Modal =====
    bindModalVisible: false,     // 绑定弹窗
    bindWxid: '',                // 绑定的微信号
    bindWxidNickname: '',        // 绑定的微信昵称
    addModalVisile: false,       // 添加弹窗
    newLoginAccount: '',         // 新登录账号

    // ===== 群列表 =====
    groupListMap: {},            // 群列表缓存（按 wxid 分组）

    // ===== 语音与消息 =====
    voiceInfo: {},               // 语音消息信息
    atLinkInfo: {},              // @链接信息
    studentMessageToken: '',     // 学员消息缓存 key
    notificationList: [],        // 通知列表

    // ===== 版本更新 =====
    clientUpdateInfo: {
        latestVersionType: 0,    // 0最新 1最近主版本 2最新主版本
        activeUpdatePrompt: '',
        activeUpdateBtnText: '立即升级'
    },
    webBaseInfo: {},
    webVersionStatusInfo: {
        versionChanged: false,
        influencedModules: [],
    },

    // ===== SOP 顾问版 =====
    sopGlobalEditStatus: true,
    page: 'homePage',
    editInfo: initEditInfo,
    baseInfo: initBaseInfo,
    phaseInfo: {},
    monitorInfo: {},
    sopBackMemoryInfo: {},
    sopPublishStatus: 1,
    sopIsDel: false,
    canEditSop: true,
    // ...SOP 相关请求状态

    // ===== SOP 运营版 =====
    s_page: 'homePage',
    s_editInfo: initEditInfo,
    s_baseInfo: initBaseInfo,
    // ...运营 SOP 相关状态

    // ===== 群剧本 =====
    g_groupActorNumConfig: {},
    g_isHasGroupActorNum: false,
    g_isFirstScriptNeedScrollConfig: false,

    // ===== 其他 =====
    sendConfigLimit: {},
    variable: {},                // 变量权限
};
```

### 6.2 状态分类汇总

| 分类 | 状态数 | 说明 |
|------|--------|------|
| 导航与菜单 | 2 | 菜单选中状态 |
| 账号与配置 | 5 | 微信实例、用户信息 |
| WebSocket | 2 | 连接实例、消息分发 |
| 状态标记 | 3 | 加载、崩溃、心跳 |
| 企微专用 | 2 | 企微版本、登录列表 |
| 绑定/Modal | 5 | UI 弹窗状态 |
| 群相关 | 1 | 群列表缓存 |
| SOP 顾问版 | 15+ | SOP 编辑、配置、发布等 |
| SOP 运营版 | 10+ | 运营版 SOP 状态 |

---

## 7. Actions 定义

**文件路径**：`galaxy/src/entries/menu/store/actions.js`

### 7.1 Action Type 常量

**文件路径**：`galaxy/src/entries/menu/store/constantes.js`

共定义了 60+ 个 action type，按功能分类：

| 分类 | 典型常量 |
|------|----------|
| 菜单导航 | `SET_MENU_LIST`、`SET_MENU_SELECT_KEY` |
| 账号配置 | `SET_CURRENT_ACCOUNT`、`SET_ALL_CONFIG`、`SET_USERINFO` |
| WebSocket | `SET_WS_MENU`、`SET_NEWS` |
| 群列表 | `UPDATE_GROUP_LIST_MAP`、`UPDATE_GROUP_LIST_INFO`、`UPDATE_GROUP_LIST_HEADIMG` |
| 绑定 | `SET_BIND_MODAL_VISIBLE`、`SET_BIND_WXID` |
| SOP 顾问 | `SET_PAGE`、`SET_SOP_BASEINFO`、`SET_SOP_PHASEINFO`、`SET_SOP_PUBLISH_STATUS` |
| SOP 运营 | `S_SET_PAGE`、`S_SET_SOP_BASEINFO`、`S_SET_TIME_LINE_CONFIG` |
| 群剧本 | `G_SET_GROUP_ACTOR_NUM_CONFIG`、`G_IS_HAS_GROUP_ACTOR_NUM` |

### 7.2 Action Creator 示例

```javascript
export const setAllConfig = (payload) => ({
    type: actionTypes.SET_ALL_CONFIG,
    payload,
});

export const setCurrentAccount = (payload) => ({
    type: actionTypes.SET_CURRENT_ACCOUNT,
    payload,
});

export const setWsMenu = (payload) => ({
    type: actionTypes.SET_WS_MENU,
    payload,
});
```

---

## 8. Thunks 异步逻辑

**文件路径**：`galaxy/src/entries/menu/store/thunks.js`

### 8.1 核心 Thunk 列表

| Thunk 函数 | 功能 |
|------------|------|
| `wsInit` | WebSocket 初始化（获取端口 → 建立连接 → 监听消息） |
| `wsSend` | 通过 WebSocket 发送消息 |
| `wsSendTop` | 发送置顶消息 |
| `wsSendLogin` | 发送登录消息 |
| `handleGetAllConfig` | 处理 getAllConfig 响应（更新 allConfig 状态） |
| `addOneAccount` | 添加一个微信账号 |
| `askAndSetModules` | 从服务端拉取模块配置 |
| `bindDamai` | 大麦产品绑定微信 |
| `askAndBindTianquan` | 天权产品绑定微信 |
| `requestBasicConfigData` | SOP 基础配置数据请求 |
| `requestTimeLineData` | SOP 时间轴数据请求 |

### 8.2 wsInit — WebSocket 初始化

```javascript
async function init(dispatch, getState) {
    let port;
    try {
        port = await ipc.callMain('get-ws-port');
    } catch (error) {
        console.report('WsPortError', error.message, { error });
    }
    if (!port) {
        setTimeout(() => { init(dispatch, getState); }, delay);
        return;
    }

    let websocketURL = `ws://127.0.0.1:${port}/websocket`;

    // 防止死灰复燃：清理旧连接
    if (ws instanceof WebSocket) {
        ws.onopen = _.noop;
        ws.onclose = _.noop;
        ws.onerror = _.noop;
        ws.onmessage = _.noop;
        ws.close();
    }

    ws = window.ws = new WebSocket(websocketURL);
    dispatch(setWsMenu({ wsMenu: ws }));

    ws.onopen = () => {
        ws.send(JSON.stringify({ cmdId: 'getAllConfig' }));
    };

    ws.onclose = () => {
        setTimeout(() => { init(dispatch); }, delay);
    };

    ws.onerror = () => {
        // 所有在线微信标记为离线
    };

    ws.onmessage = (e) => {
        // 消息路由处理（见下一节）
    };
}

export const wsInit = () => (dispatch, getState) => {
    init(dispatch, getState);
};
```

关键设计：
1. **端口获取**：通过 IPC 从主进程获取 WebSocket 端口
2. **旧连接清理**：重连前先将旧 ws 实例的所有回调设为 `_.noop` 并关闭
3. **全局挂载**：`ws = window.ws = new WebSocket(url)` 供其他模块直接访问
4. **自动重连**：`onclose` 时延迟 `delay` 毫秒后重试

### 8.3 handleGetAllConfig — 核心配置更新

```javascript
function handleGetAllConfig(dispatch, msg) {
    const { body } = msg;
    dispatch(setIsReceiveAllConfig({ isReceiveAllConfig: true }));

    if (Array.isArray(body) && body.length) {
        // 关闭 loading
        if (store.getState().isLoading) {
            setTimeout(() => { dispatch(setIsLoading(false)); }, 800);
        }

        // 补充新旧配置差异
        body.forEach((item) => {
            if (item.channelId) {
                oldItem = getOldItem(item.channelId);
                if (!item.wxInfo && oldItem?.wxInfo) {
                    item.wxInfo = { ...oldItem.wxInfo, headimg: '' };
                }
                if (!oldItem) {
                    wsSendLogin(item.channelId);  // 新账号发送登录消息
                }
            }
        });

        if (!_.isEqual(oldConfig, body)) {
            dispatch(setAllConfig({ allConfig: body }));
        }
        oldConfig = body;
    }
}
```

### 8.4 wsSend — 通用消息发送

```javascript
export const wsSend = (news) => () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(news));
    }
};
```

---

## 9. WebSocket 消息路由

### 9.1 ws.onmessage 路由表

```javascript
ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    const { cmdId, channelId } = msg;

    switch (cmdId) {
        case 'getAllConfig':
            handleGetAllConfig(dispatch, msg);
            dispatch(setNews({ news: msg }));
            break;

        case 'sendNotice':
            dispatch(updateNoticeList({ ... }));
            break;

        case 'forward':
        case 'upload':
        case 'getMqttStatus':
        case 'uploadVoice':
            // 转发给子页面
            dispatch(setNews({ news: msg }));
            break;

        // ... 更多 cmdId 处理
    }
};
```

### 9.2 消息类型一览

| cmdId | 处理逻辑 |
|-------|----------|
| `getAllConfig` | 更新 allConfig、触发产品绑定、上报微信状态 |
| `sendNotice` | 更新通知列表 |
| `forward` | 转发到 sub 页面 |
| `upload` | 文件上传进度 |
| `getMqttStatus` | MQTT 状态查询结果 |
| `uploadVoice` | 语音上传进度 |

### 9.3 news 状态的桥梁作用

`news` 状态是 menu 窗口与 sub webview 通信的桥梁：

```
WebSocket onmessage
    │
    └──▶ dispatch(setNews({ news: msg }))
           │
           └──▶ reducer 更新 state.news
                  │
                  └──▶ menu App.js 监听 news 变化
                         │
                         └──▶ webviewBroadcast(msg)
                                │
                                └──▶ 所有 sub webview 收到消息
```

---

## 10. 跨窗口状态同步

### 10.1 问题：Redux Store 无法跨窗口共享

menu 和 sub 运行在不同的渲染进程中（webview 是独立进程），它们的 Redux Store 完全隔离。

### 10.2 解决方案：Electron IPC + WebSocket

```
┌──────────────────┐                    ┌──────────────────┐
│   menu App.js    │                    │   sub App.js     │
│   Redux Store    │                    │   Redux Store    │
│                  │   IPC / webview    │                  │
│  allConfig ──────┼──── 消息广播 ──────▶│  接收 allConfig  │
│  news ───────────┼──── 消息广播 ──────▶│  接收 news       │
│                  │                    │                  │
│  webviewBroadcast│                    │ ipc.on('parent-  │
│  webviewSendById │                    │  message')       │
└──────────────────┘                    └──────────────────┘
```

### 10.3 menu → sub 通信

menu App.js 通过 webview 的 `send` 方法向 sub 推送消息：

```javascript
// menu 端
webviewBroadcast(msg);   // 广播给所有 sub webview
webviewSendById(id, msg); // 定向发送给特定 sub
```

### 10.4 sub → menu 通信

sub 通过 Electron IPC 回传消息：

```javascript
// sub 端
ipc.on('parent-message', (event, data) => {
    // 处理来自 menu 的消息
});

ipc.on('web-go-page', (event, data) => {
    // 处理页面跳转指令
    history.push(data.path);
});
```

---

## 11. 入口挂载与初始化

### 11.1 menu 入口

**文件路径**：`galaxy/src/entries/menu/index.js`

```javascript
// 初始化 Sentry
// 初始化 message 配置
// 挂载 Redux Provider
<Provider store={store}>
    <ErrorBoundary>
        <MemoryRouter>
            <App />
        </MemoryRouter>
    </ErrorBoundary>
</Provider>

// 全局挂载 store
window.store = store;
```

### 11.2 sub 入口

**文件路径**：`galaxy/src/entries/sub/index.js`

```javascript
// 初始化 Sentry
// 初始化 Habo 上报
// 初始化 message 配置
// 写入 GID Cookie
<Provider store={store}>
    <ErrorBoundary>
        <ReportData />
        <App />
    </ErrorBoundary>
</Provider>
```

### 11.3 sub 入口的特殊处理

sub 入口额外包含：
- `ReportData` 组件：数据上报相关
- Habo 初始化：前端埋点
- GID Cookie 写入：设备标识

### 11.4 store 的全局挂载

```javascript
window.store = store;
```

menu 入口将 store 挂载到 `window.store`，方便调试和部分模块直接访问（如 thunks 中的 `store.getState()`）。

---

## 12. 关键代码路径索引

| 文件路径 | 核心导出 | 职责 |
|---------|---------|------|
| `galaxy/src/config/menu.config.js` | `menu` (getter) | 动态菜单配置 |
| `galaxy/src/entries/sub/router/index.js` | `RouteConfig` | sub 路由组件 |
| `galaxy/src/entries/menu/store/index.js` | `store` | Redux Store 实例 |
| `galaxy/src/entries/menu/store/reducer.js` | `defaultReducer` | 主 reducer（60+ state 字段） |
| `galaxy/src/entries/menu/store/actions.js` | 60+ action creators | 同步 action 定义 |
| `galaxy/src/entries/menu/store/constantes.js` | 60+ action types | 常量定义 |
| `galaxy/src/entries/menu/store/thunks.js` | `wsInit` / `handleGetAllConfig` 等 | 异步逻辑 |
| `galaxy/src/entries/menu/store/initState.js` | `initBaseInfo` / `initEditInfo` | SOP 初始状态 |
| `galaxy/src/entries/menu/store/helper.js` | `getAllConfigFilter` | 配置过滤工具 |
| `galaxy/src/entries/menu/store/request.js` | `userLogout` / `reportCasInfo` 等 | HTTP 请求 |
| `galaxy/src/entries/menu/index.js` | React 入口 | menu 挂载 |
| `galaxy/src/entries/sub/index.js` | React 入口 | sub 挂载 |
| `galaxy/src/entries/menu/App.js` | `App` | menu 主组件（webview 管理） |
| `galaxy/src/entries/sub/App.js` | `App` | sub 主组件（路由 + IPC 监听） |

---

*文档生成时间：2026-03-13 | 基于 galaxy + galaxy-client 仓库实际代码分析*
