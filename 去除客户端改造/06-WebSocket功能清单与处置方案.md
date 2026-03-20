# 06 - WebSocket 功能清单与处置方案

> 文档状态：讨论稿  
> 创建时间：2026-03-20  
> 适用项目：galaxy（前端）

---

## 一、概述

### 1.1 当前 WebSocket 通信全景

galaxy 前端通过 WebSocket 连接本地 galaxy-client（Electron 客户端），端口 13323-13423，进行双向通信。去除客户端后，这条 WebSocket 通信链路**完全废弃**。

本文档对所有 WebSocket 功能逐一列出，分析每个功能的业务价值和替代方案。

### 1.2 WebSocket 连接基本信息

| 属性 | 值 |
|------|-----|
| **连接 URL** | `ws://127.0.0.1:{port}/websocket` |
| **端口来源** | Windows 注册表 `HKEY_CURRENT_USER\Software\{elfkey}\StartPort` 的 `FrontServerPort` |
| **端口获取方式** | `ipc.callMain('get-ws-port')` |
| **连接建立文件** | `src/entries/menu/store/thunks.js`（约 268-318 行） |
| **全局引用** | `window.ws` |
| **消息格式** | JSON `{ cmdId, channelId?, body }` |
| **自动重连** | 无内置重连，端口获取失败时定时重试 |

### 1.3 消息流向

```
sub 页面 (webview/iframe)
    │
    │ ipc.sendToHost('sub-message', { cmdId, channelId, body })
    │
    ▼
menu 页面
    │
    │ window.ws.send(JSON.stringify({ cmdId, channelId, body }))
    │
    ▼
galaxy-client (WebSocket Server)
    │
    │ → dispatchInBound → reverseSend → IPC 管道 → 逆向程序
    │ 或
    │ → mqttSend → MQTT → 云端
    │
    ▼
逆向程序 / 云端
    │
    │ 返回结果
    │
    ▼
galaxy-client
    │
    │ ws.send(JSON.stringify({ cmdId, body }))
    │
    ▼
menu 页面
    │
    │ ws.onmessage → 按 cmdId 分发
    │
    ▼
sub 页面 (通过 webview.send / postMessage)
```

---

## 二、发送类命令完整清单

### 2.1 getAllConfig - 获取所有账号配置

| 属性 | 详情 |
|------|------|
| **cmdId** | `getAllConfig` |
| **方向** | 前端 → 客户端 → 前端（请求-响应） |
| **发送时机** | 1. WebSocket 连接建立时（`ws.onopen`）<br>2. sub 页面定时重试（`circleGetConfig()`） |
| **发送数据** | `{ cmdId: 'getAllConfig' }` |
| **发送位置** | `menu/store/thunks.js`、`sub/App.js` |
| **响应数据** | `{ cmdId: 'getAllConfig', body: [...] }` |
| **body 内容** | 微信账号配置数组，每项含：`channelId`（进程 ID）、`wxInfo`（微信信息）、`workWx`（是否企微）、`wxid`、`nickName`、`headUrl` 等 |

#### 业务价值分析

- **核心程度**：极高 - 这是获取所有微信账号列表的唯一方式
- **使用频率**：页面加载时必须调用
- **数据来源**：galaxy-client 的内存缓存（来自逆向程序扫描结果）

#### 数据流详情

```
前端 getAllConfig
    ↓
galaxy-client 接收
    ↓
从内存缓存读取 allConfig
（allConfig 由逆向程序定期上报更新）
    ↓
返回给前端
```

#### 处置方案

**替换为云端 HTTP API + SSE 推送**

```
方案一：HTTP 轮询
GET /api/wx/accounts
→ 返回 [{ channelId, wxId, nickName, headUrl, status, workWx, ... }]
→ 前端定时轮询（30s）

方案二：HTTP + SSE（推荐）
GET /api/wx/accounts（首次加载）
SSE /api/events/stream → 事件 account-update（状态变化时推送）
```

#### 需要云端配合

| 接口 | 说明 |
|------|------|
| `GET /api/wx/accounts` | 返回当前用户绑定的所有微信账号及状态 |
| SSE `account-update` 事件 | 账号上线/下线/状态变化时推送 |

#### 前端改造代码示例

```javascript
// menu/store/thunks.js 改造
// 当前
function initWebSocket() {
  const port = await ipc.callMain('get-ws-port');
  const ws = new WebSocket(`ws://127.0.0.1:${port}/websocket`);
  ws.onopen = () => ws.send(JSON.stringify({ cmdId: 'getAllConfig' }));
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.cmdId === 'getAllConfig') {
      dispatch(handleGetAllConfig(msg.body));
    }
  };
}

// 改造后
async function initData() {
  // 1. HTTP 获取初始数据
  const accounts = await api.get('/api/wx/accounts');
  dispatch(handleGetAllConfig(accounts));
  
  // 2. SSE 监听实时更新
  const eventSource = new EventSource('/api/events/stream?token=' + getToken());
  eventSource.addEventListener('account-update', (event) => {
    const data = JSON.parse(event.data);
    dispatch(handleGetAllConfig(data));
  });
}
```

---

### 2.2 forward - 下发指令到逆向程序

`forward` 是一个容器命令，通过 `body.type` 区分不同的操作类型。

#### 2.2.1 forward + login（查询登录状态）

| 属性 | 详情 |
|------|------|
| **body.type** | `login` |
| **发送数据** | `{ cmdId: 'forward', channelId, body: { type: 'login' } }` |
| **发送位置** | `sub/App.js`、`sub/store/base/thunks.js` |
| **响应 body** | `{ type: 'login', wxid, nickName, headImgUrl, version, ... }` |
| **业务价值** | 高 - 查询微信登录状态和用户基本信息 |
| **使用频率** | sub 页面初始化时调用 |

**处置方案**：`GET /api/wx/accounts/{channelId}/status`

**响应示例**：
```json
{
  "channelId": 12345,
  "wxid": "wxid_xxx",
  "nickName": "张三",
  "headImgUrl": "https://...",
  "status": "online",
  "version": "3.9.x",
  "workWx": false
}
```

---

#### 2.2.2 forward + userlist（获取好友/群列表）

| 属性 | 详情 |
|------|------|
| **body.type** | `userlist` |
| **发送数据** | `{ cmdId: 'forward', channelId, body: { type: 'userlist' } }` |
| **发送位置** | `sub/store/base/thunks.js`、`nav.js`、`groupManage/content.js` |
| **响应 body** | `{ type: 'userlist', friendList: [...], chatroomList: [...] }` |
| **业务价值** | 极高 - 好友列表和群聊列表是大量功能的基础数据 |
| **使用频率** | sub 页面初始化 + 多个业务模块按需请求 |

**处置方案**：`GET /api/wx/accounts/{channelId}/contacts`

**响应示例**：
```json
{
  "friendList": [
    { "wxid": "wxid_xxx", "nickName": "张三", "remark": "张三备注", "headUrl": "..." },
    ...
  ],
  "chatroomList": [
    { "chatroomId": "xxx@chatroom", "nickName": "群名", "memberCount": 100, "headUrl": "..." },
    ...
  ]
}
```

**特殊说明**：
- 好友/群列表数据量可能很大（数千好友、数百群）
- 建议支持分页或增量更新
- 云端需要逆向程序定期同步最新的联系人数据

---

#### 2.2.3 forward + getcustomerlabel（获取标签列表）

| 属性 | 详情 |
|------|------|
| **body.type** | `getcustomerlabel` |
| **发送数据** | `{ cmdId: 'forward', channelId, body: { type: 'getcustomerlabel' } }` |
| **发送位置** | `tagSelectDialog`、`autoTag`、`nav.js` |
| **响应 body** | 标签列表数组 |
| **业务价值** | 中 - 标签选择器使用 |
| **使用频率** | 打开标签选择器时 |

**处置方案**：`GET /api/wx/accounts/{channelId}/labels`

---

#### 2.2.4 forward + getlabelcustomer（按标签获取客户）

| 属性 | 详情 |
|------|------|
| **body.type** | `getlabelcustomer` |
| **发送数据** | `{ cmdId: 'forward', channelId, body: { type: 'getlabelcustomer', ids: [...] } }` |
| **发送位置** | `condition.js` |
| **响应 body** | 客户列表 |
| **业务价值** | 中 - 条件筛选使用 |

**处置方案**：`POST /api/wx/accounts/{channelId}/labels/customers` body: `{ labelIds: [...] }`

---

#### 2.2.5 forward + getconversationimage（获取群头像）

| 属性 | 详情 |
|------|------|
| **body.type** | `getconversationimage` |
| **发送数据** | `{ cmdId: 'forward', channelId, body: { type: 'getconversationimage', ids: [...] } }` |
| **发送位置** | `sub/store/base/thunks.js` |
| **响应 body** | 群头像 URL 列表 |
| **业务价值** | 低 - 仅用于展示群头像 |

**处置方案**：`POST /api/wx/accounts/{channelId}/chatroom-avatars` body: `{ chatroomIds: [...] }`

---

#### 2.2.6 forward + windowtop（置顶微信窗口）

| 属性 | 详情 |
|------|------|
| **body.type** | `windowtop` 或 `TOP` |
| **发送数据** | `{ cmdId: 'forward', channelId, body: { type: 'windowtop' } }` |
| **发送位置** | `wxModal`、`Menu.js` |
| **业务价值** | 低 - 便捷操作，非核心功能 |

**处置方案**：

| 选项 | 说明 |
|------|------|
| **A. 废弃** | 浏览器无法控制远端 Windows 窗口 |
| **B. 云端下发** | `POST /api/wx/accounts/{channelId}/window-top` → 云端 MQTT → 逆向程序 |

推荐 **A（废弃）**，除非业务上强需求。

---

#### 2.2.7 forward + logout（退出微信登录）

| 属性 | 详情 |
|------|------|
| **body.type** | `logout` |
| **发送数据** | `{ cmdId: 'forward', channelId, body: { type: 'logout' } }` |
| **发送位置** | `nav.js` |
| **业务价值** | 中 - 用户主动退出微信登录 |

**处置方案**：`POST /api/wx/accounts/{channelId}/logout`

**流程**：
1. 前端调用 API
2. 云端下发 MQTT 退出指令给 C++ 客户端
3. C++ 客户端通知逆向程序退出
4. 状态通过 SSE 推送给前端

---

#### 2.2.8 forward + delchatmenber（踢群成员）

| 属性 | 详情 |
|------|------|
| **body.type** | `delchatmenber` |
| **发送数据** | `{ cmdId: 'forward', channelId, body: { type: 'delchatmenber', data: { to, array } } }` |
| **发送位置** | `autoKickout` |
| **响应** | emitter 事件回调 |
| **业务价值** | 中 - 自动踢人功能 |

**处置方案**：`POST /api/wx/chatroom/kick-member`

```json
{
  "channelId": 12345,
  "chatroomId": "xxx@chatroom",
  "memberIds": ["wxid_1", "wxid_2"]
}
```

**响应**：
```json
{
  "taskId": "task-xxx",
  "status": "submitted"
}
```

前端通过 SSE 或轮询获取执行结果。

---

#### 2.2.9 forward + chatuserinfolist（群成员详情）

| 属性 | 详情 |
|------|------|
| **body.type** | `chatuserinfolist` |
| **发送数据** | `{ cmdId: 'forward', channelId, body: { type: 'chatuserinfolist', data: { flag, array } } }` |
| **发送位置** | `blackWhiteList`、`useGetNotFriendList`（加群好友） |
| **响应 body** | 群成员详细信息列表 |
| **业务价值** | 中 - 黑白名单和加群好友功能依赖 |

**处置方案**：`POST /api/wx/accounts/{channelId}/member-info`

```json
{
  "userIds": ["wxid_1", "wxid_2"],
  "flag": 0
}
```

---

#### 2.2.10 forward + batchgetcontact（僵尸粉检测）

| 属性 | 详情 |
|------|------|
| **body.type** | `batchgetcontact` |
| **发送数据** | `{ cmdId: 'forward', channelId, body: { type: 'batchgetcontact', data: { array } } }` |
| **发送位置** | `zombieManage` |
| **响应 body** | `MM.GetContactResponse`（通过 emitter 回调） |
| **业务价值** | 中 - 僵尸粉检测功能 |

**处置方案**：`POST /api/wx/accounts/{channelId}/zombie-check`

**特殊处理**：
- 僵尸粉检测是批量异步操作
- 当前通过 emitter 等待 `MM.GetContactResponse` 回调
- 改造后需要：
  1. 提交检测任务，获得 taskId
  2. 通过 SSE 接收检测进度和结果
  3. 或轮询 `GET /api/tasks/{taskId}/status`

```javascript
// 当前
async function checkZombie(contacts) {
  for (const batch of chunks(contacts, 50)) {
    sendMessage({ type: 'batchgetcontact', data: { array: batch } }, 'forward');
    const result = await waitForEmitter('onCheck');
    processResult(result);
  }
}

// 改造后
async function checkZombie(contacts) {
  const { taskId } = await api.post(`/api/wx/accounts/${channelId}/zombie-check`, {
    wxIds: contacts.map(c => c.wxid)
  });
  
  // SSE 监听结果
  const handleResult = (event) => {
    const data = JSON.parse(event.data);
    if (data.taskId === taskId) {
      processResult(data.result);
      if (data.status === 'completed') {
        eventSource.removeEventListener('zombie-check-result', handleResult);
      }
    }
  };
  eventSource.addEventListener('zombie-check-result', handleResult);
}
```

---

#### 2.2.11 forward + queryuserinfotask（查询用户信息）

| 属性 | 详情 |
|------|------|
| **body.type** | `queryuserinfotask` |
| **发送数据** | `{ cmdId: 'forward', channelId, body: { type: 'queryuserinfotask', room, userid, usertype } }` |
| **发送位置** | `menu/store/thunks.js` |
| **业务价值** | 低 - 按需查询单个用户信息 |

**处置方案**：`GET /api/wx/accounts/{channelId}/user-info?wxId={wxId}&room={room}`

---

### 2.3 upload - 文件上传

| 属性 | 详情 |
|------|------|
| **cmdId** | `upload` |
| **发送数据** | `{ cmdId: 'upload', body: { type: 'file', path: '/local/file/path', hook: 'callback-id' } }` |
| **发送位置** | `common/send.js`（uploadAsync）、`common/upload.js`、`image.js`、`file.js`、`UploadImg`、`filterList` |
| **响应数据** | `{ cmdId: 'upload', body: { ossUrl: 'https://cdn.xxx.com/file', path, hook } }` |
| **业务价值** | 极高 - 所有文件/图片上传的基础 |
| **使用频率** | 每次用户上传文件/图片时 |

#### 当前流程详解

```
前端选择文件
    ↓
获取本地文件路径（Electron dialog 或剪贴板）
    ↓
ws.send({ cmdId: 'upload', body: { type: 'file', path, hook } })
    ↓
galaxy-client 接收
    ↓
读取本地文件 → 上传到阿里云 OSS
    ↓
ws.send({ cmdId: 'upload', body: { ossUrl, path, hook } })
    ↓
前端通过 hook 匹配回调，获得 ossUrl
```

#### 处置方案详解

**浏览器直传 OSS 方案**：

```
用户选择文件（<input type="file">）
    ↓
获取 File 对象
    ↓
前端调用 GET /api/oss/sts-token 获取临时凭证
    ↓
前端使用 ali-oss 浏览器版 SDK 直传 OSS
    ↓
获得 ossUrl
```

#### 改造涉及的文件清单

| 文件 | 当前逻辑 | 改造内容 |
|------|---------|---------|
| `common/send.js` | `uploadAsync(msg)` → ws.send upload → 等待 onFile 回调 | 改为调用新的 `uploadFile(file)` 方法 |
| `common/upload.js` | 上传工具封装 | 重写为 ali-oss 浏览器版 |
| `sub/component/sendSetting/component/messageContent/image.js` | 图片选择和上传 | `<input type="file" accept="image/*">` + `uploadFile()` |
| `sub/component/sendSetting/component/messageContent/file.js` | 文件选择和上传 | `<input type="file">` + `uploadFile()` |
| `sub/component/UploadImg/index.jsx` | `ipc.callMain('open-dialog')` → upload | `<input type="file">` + `uploadFile()` |
| `sub/blackWhiteList/filterList/` | 文件上传 | `uploadFile()` |

#### 改造后代码

```javascript
// common/upload.js 改造后
import OSS from 'ali-oss';
import api from './ajax';

let cachedClient = null;
let tokenExpireAt = 0;

async function getOSSClient() {
  const now = Date.now();
  if (cachedClient && now < tokenExpireAt) {
    return cachedClient;
  }
  
  const tokenData = await api.get('/api/oss/sts-token');
  cachedClient = new OSS({
    region: tokenData.region,
    accessKeyId: tokenData.accessKeyId,
    accessKeySecret: tokenData.accessKeySecret,
    stsToken: tokenData.stsToken,
    bucket: tokenData.bucket,
  });
  tokenExpireAt = new Date(tokenData.expiration).getTime() - 60000;
  
  return cachedClient;
}

export async function uploadFile(file, { onProgress } = {}) {
  const client = await getOSSClient();
  const ext = file.name.split('.').pop();
  const objectKey = `uploads/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  
  const result = await client.put(objectKey, file, {
    progress: onProgress ? (p) => onProgress(Math.round(p * 100)) : undefined,
  });
  
  return result.url;
}

// common/send.js 改造
export async function uploadAsync(file) {
  const ossUrl = await uploadFile(file);
  return { ossUrl };
}
```

---

### 2.4 uploadVoice - 语音处理

| 属性 | 详情 |
|------|------|
| **cmdId** | `uploadVoice` |
| **方向** | 客户端 → 前端（主动推送） |
| **接收位置** | `menu/store/thunks.js`（onmessage handler）→ `setVoiceInfo` |
| **业务价值** | 低 - 语音消息处理 |
| **使用频率** | 低 |

**处置方案**：**待确认** - 需确认语音功能是否保留。如保留，通过 SSE 推送语音消息。

---

### 2.5 getMqttStatus - MQTT 状态查询

| 属性 | 详情 |
|------|------|
| **cmdId** | `getMqttStatus` |
| **方向** | 前端 → 客户端 → 前端 |
| **接收位置** | `menu/store/thunks.js` → 转发给 sub → `sub/store/base/reducer.js` SET_MQTT_STATUS |
| **业务价值** | 低 - 仅用于展示 MQTT 连接状态 |

**处置方案**：**废弃** - 前端不再关心 MQTT 连接状态。

如业务需要展示设备连接状态，改为：`GET /api/device/{deviceId}/status` → 返回 C++ 客户端的在线状态。

---

### 2.6 frontInfo - 前端信息上报

| 属性 | 详情 |
|------|------|
| **cmdId** | `frontInfo` |
| **发送数据** | `{ body: { cas, clientVersion, galaxyDir }, cmdId: 'frontInfo' }` |
| **发送位置** | `menu/store/thunks.js`（sendFrontInfo - **已被注释**） |
| **业务价值** | 无 - 已废弃 |

**处置方案**：**删除** - 直接删除相关代码。

---

### 2.7 reportLogicWorking - 逻辑运行状态上报

| 属性 | 详情 |
|------|------|
| **cmdId** | `reportLogicWorking` |
| **发送数据** | `{ cmdId: 'reportLogicWorking', body: {...} }` |
| **发送位置** | `menu/store/thunks.js`（wsReportLogicWorking - 已定义但未找到调用处） |
| **业务价值** | 极低 - 可能已废弃 |

**处置方案**：**删除**。

---

### 2.8 killAll / killJava - 杀进程

| 属性 | 详情 |
|------|------|
| **cmdId** | `killAll` / `killJava` |
| **发送数据** | `{ cmdId: 'killAll' }` / `{ cmdId: 'killJava' }` |
| **发送位置** | `menu/App.js`（监听 `wsKillJava`、`ws-kill-java-only` IPC 事件后发送） |
| **业务价值** | 低 - 仅在自动更新前使用 |

**处置方案**：**废弃** - Web 应用无自动更新，不再需要杀进程。

---

## 三、接收类消息完整清单

### 3.1 onmessage 分发逻辑

```javascript
// menu/store/thunks.js ws.onmessage
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  
  switch(msg.cmdId) {
    case 'getAllConfig':
      handleGetAllConfig(msg.body);
      break;
    case 'sendNotice':
      updateNoticeList(msg.body);
      break;
    case 'forward':
      dispatch(setNews(msg));  // 转发给 sub
      break;
    case 'upload':
      window.newEmitter.emit('onNewFile', msg.body);
      break;
    case 'uploadVoice':
      setVoiceInfo(msg.body);
      break;
    case 'getMqttStatus':
      // 转发给 sub
      break;
  }
};
```

### 3.2 接收消息处置方案

| cmdId | 当前处理 | 改造后处理 |
|-------|---------|-----------|
| `getAllConfig` | 更新 allConfig、用户列表 | SSE `account-update` 事件 |
| `sendNotice` | 更新通知列表 | SSE `notification` 事件 |
| `forward` | 转发给 sub 按 body.type 处理 | 各 sub 直接调 HTTP API |
| `upload` | 触发 emitter 回调 | 浏览器直传 OSS 后直接获得 URL |
| `uploadVoice` | 设置语音信息 | SSE 推送或废弃 |
| `getMqttStatus` | 更新 MQTT 状态 | 废弃 |

### 3.3 forward 接收消息的 body.type 处理

sub 页面接收到 forward 消息后，按 `body.type` 分发处理：

| body.type | 处理函数 | 业务说明 | 改造后来源 |
|-----------|---------|---------|-----------|
| `login` | `handleLoginNews` | 登录状态更新 | SSE `login-status` 或 HTTP API 返回值 |
| `logout` | `handleLogoutNews` | 登出通知 | SSE `account-update` |
| `remark` | `handleRemarkNews` | 备注修改结果 | HTTP API 操作结果 |
| `userlist` | `handleUserlistNews` | 好友/群列表更新 | HTTP API 返回值 |
| `getcustomerlabel` | `handleLabelListNews` | 标签列表更新 | HTTP API 返回值 |
| `getlabelcustomer` | `handleLabelListFriendNews` | 按标签查客户结果 | HTTP API 返回值 |
| `getconversationimage` | `handleConversationImage` | 群头像 | HTTP API 返回值 |
| `chatroomUpdate` | `handleChatroomUpdateNews` | 群成员变更通知 | SSE `chatroom-update` |
| `chatuserinfolist` | `handleChatUserInfoListNews` | 群成员详情 | HTTP API 返回值 |
| `friendUpdate` | `handleFriendUpdateNews` | 好友/群列表变更通知 | SSE `contact-update` |
| `delchatmenber` | `emitter.emit('onMessage')` | 踢人结果 | SSE `task-result` |
| `MM.GetContactResponse` | `handleCheckZombieEnd` | 僵尸粉检测结果 | SSE `zombie-check-result` |

---

## 四、异步 WebSocket 封装分析

### 4.1 SendDecorator（common/send.js）

当前封装了异步请求-响应模式：

```javascript
class SendDecorator {
  constructor(emitter) {
    this.emitter = emitter;
  }
  
  // 发送消息并等待响应
  sendAsync(msg, cmdId) {
    return new Promise((resolve) => {
      this.emitter.once('onMessage', (data) => {
        resolve(data);
      });
      sendMessage(msg, cmdId);
    });
  }
  
  // 上传文件并等待响应
  uploadAsync(msg) {
    return new Promise((resolve) => {
      this.emitter.once('onFile', (data) => {
        resolve(data);
      });
      sendMessage(msg, 'upload');
    });
  }
}
```

#### 改造后

这个封装在改造后**不再需要**，因为 HTTP API 天然是请求-响应模式：

```javascript
// 当前（WebSocket 异步模式）
const result = await sendDecorator.sendAsync({ type: 'userlist' }, 'forward');

// 改造后（HTTP API 直接返回）
const result = await api.get(`/api/wx/accounts/${channelId}/contacts`);
```

### 4.2 僵尸粉检测的 emitter 模式

当前僵尸粉检测使用 emitter 等待异步回调：

```javascript
// 当前
const sendDeco = new SendDecorator(emitter);
sendDeco.sendAsync({ type: 'batchgetcontact', data: { array: batch } }, 'forward');
// 等待 emitter.emit('onCheck') 被 forward 接收处理触发
```

**改造后**：改为提交任务 + SSE 监听结果（见 2.2.10 节）。

---

## 五、SSE 事件设计汇总

### 5.1 需要的 SSE 事件

| 事件名 | 替代的 WebSocket 功能 | 数据内容 | 推送时机 |
|--------|---------------------|---------|---------|
| `account-update` | `getAllConfig` 推送 | 账号列表变化 | 账号上线/下线/状态变化 |
| `login-status` | `forward` + `login` 推送 | 登录状态 | 微信登录/退出 |
| `contact-update` | `forward` + `friendUpdate` | 好友/群变更 | 好友增减/群变化 |
| `chatroom-update` | `forward` + `chatroomUpdate` | 群成员变更 | 群成员增减 |
| `task-result` | `forward` + `delchatmenber` 等 | 任务执行结果 | 操作完成 |
| `zombie-check-result` | `forward` + `MM.GetContactResponse` | 僵尸粉检测结果 | 检测完成 |
| `notification` | `sendNotice` | 系统通知 | 有新通知 |

### 5.2 SSE 连接管理

```javascript
// src/common/sse.js
class SSEManager {
  constructor() {
    this.eventSource = null;
    this.handlers = new Map();
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
  }

  connect(token) {
    if (this.eventSource) {
      this.eventSource.close();
    }
    
    this.eventSource = new EventSource(`/api/events/stream?token=${token}`);
    
    this.eventSource.onopen = () => {
      this.reconnectDelay = 1000;
      console.log('SSE connected');
    };
    
    this.eventSource.onerror = () => {
      console.warn('SSE error, will auto-reconnect');
      // EventSource 会自动重连
    };
    
    // 注册所有事件处理器
    for (const [eventName, callbacks] of this.handlers) {
      for (const callback of callbacks) {
        this.eventSource.addEventListener(eventName, callback);
      }
    }
  }

  on(eventName, callback) {
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, []);
    }
    this.handlers.get(eventName).push(callback);
    
    if (this.eventSource) {
      this.eventSource.addEventListener(eventName, callback);
    }
  }

  off(eventName, callback) {
    const callbacks = this.handlers.get(eventName);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) callbacks.splice(index, 1);
    }
    
    if (this.eventSource) {
      this.eventSource.removeEventListener(eventName, callback);
    }
  }

  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}

export const sseManager = new SSEManager();
```

---

## 六、需要新增的云端 API 完整清单

### 6.1 查询类 API

| 序号 | API | 方法 | 替代 | 优先级 | 说明 |
|------|-----|------|------|--------|------|
| 1 | `/api/wx/accounts` | GET | `getAllConfig` | P0 | 获取所有微信账号列表 |
| 2 | `/api/wx/accounts/{id}/status` | GET | `forward`+`login` | P0 | 获取账号登录状态 |
| 3 | `/api/wx/accounts/{id}/contacts` | GET | `forward`+`userlist` | P0 | 获取好友/群列表 |
| 4 | `/api/wx/accounts/{id}/labels` | GET | `forward`+`getcustomerlabel` | P1 | 获取标签列表 |
| 5 | `/api/wx/accounts/{id}/user-info` | GET | `forward`+`queryuserinfotask` | P2 | 查询用户信息 |
| 6 | `/api/device/{id}/status` | GET | `getMqttStatus` | P2 | 设备在线状态 |

### 6.2 操作类 API

| 序号 | API | 方法 | 替代 | 优先级 | 说明 |
|------|-----|------|------|--------|------|
| 7 | `/api/wx/accounts/{id}/logout` | POST | `forward`+`logout` | P1 | 退出微信登录 |
| 8 | `/api/wx/chatroom/kick-member` | POST | `forward`+`delchatmenber` | P1 | 踢群成员 |
| 9 | `/api/wx/accounts/{id}/labels/customers` | POST | `forward`+`getlabelcustomer` | P1 | 按标签查客户 |
| 10 | `/api/wx/accounts/{id}/member-info` | POST | `forward`+`chatuserinfolist` | P1 | 群成员详情 |
| 11 | `/api/wx/accounts/{id}/chatroom-avatars` | POST | `forward`+`getconversationimage` | P2 | 群头像 |
| 12 | `/api/wx/accounts/{id}/zombie-check` | POST | `forward`+`batchgetcontact` | P1 | 僵尸粉检测 |
| 13 | `/api/wx/accounts/{id}/window-top` | POST | `forward`+`windowtop` | P3 | 置顶窗口（可选） |

### 6.3 基础设施 API

| 序号 | API | 方法 | 替代 | 优先级 | 说明 |
|------|-----|------|------|--------|------|
| 14 | `/api/oss/sts-token` | GET | `upload` WebSocket | P0 | OSS 上传临时凭证 |
| 15 | `/api/events/stream` | SSE | WebSocket 推送 | P0 | SSE 事件流 |
| 16 | `/api/config/app` | GET | `get-app-config` IPC | P0 | 应用配置 |
| 17 | `/api/proxy/link-preview` | POST | `cross-origin-request` IPC | P2 | 链接预览代理 |

### 6.4 API 总数

| 优先级 | 数量 | 说明 |
|--------|------|------|
| P0 | 5 个 | 阻塞基本运行 |
| P1 | 6 个 | 影响核心功能 |
| P2 | 4 个 | 影响辅助功能 |
| P3 | 2 个 | 可选 |
| **总计** | **17 个** | |

---

## 七、改造验证清单

改造完成后，需验证以下场景：

### 7.1 基础功能

- [ ] 页面能在浏览器中正常打开
- [ ] 无 WebSocket 连接错误
- [ ] 无 IPC 相关错误
- [ ] 账号列表能正常加载
- [ ] 账号状态能正常显示

### 7.2 业务功能

- [ ] 好友列表加载正常
- [ ] 群列表加载正常
- [ ] 标签列表加载正常
- [ ] 群发消息配置正常
- [ ] 图片/文件上传正常
- [ ] 链接预览正常
- [ ] 进群回复配置正常
- [ ] 好友申请规则配置正常
- [ ] 智能回复配置正常
- [ ] 自动踢人配置正常
- [ ] 黑白名单管理正常
- [ ] 僵尸粉检测正常
- [ ] 批量退群正常
- [ ] 多群邀请正常

### 7.3 实时性

- [ ] 账号上线/下线能及时反映
- [ ] 登录状态变化能及时反映
- [ ] 好友/群列表变更能及时反映
- [ ] 操作执行结果能及时返回
- [ ] 系统通知能及时收到

### 7.4 异常场景

- [ ] SSE 断连后自动重连
- [ ] API 请求失败有友好提示
- [ ] Token 过期自动跳转登录
- [ ] 网络恢复后数据自动刷新

---

## 八、总结

### 8.1 WebSocket 命令处置汇总

| cmdId | 子类型 | 处置 | 替代方案 |
|-------|--------|------|---------|
| getAllConfig | - | HTTP + SSE | `/api/wx/accounts` + SSE `account-update` |
| forward | login | HTTP | `/api/wx/accounts/{id}/status` |
| forward | userlist | HTTP | `/api/wx/accounts/{id}/contacts` |
| forward | getcustomerlabel | HTTP | `/api/wx/accounts/{id}/labels` |
| forward | getlabelcustomer | HTTP | `/api/wx/accounts/{id}/labels/customers` |
| forward | getconversationimage | HTTP | `/api/wx/accounts/{id}/chatroom-avatars` |
| forward | windowtop | 废弃 | - |
| forward | logout | HTTP | `/api/wx/accounts/{id}/logout` |
| forward | delchatmenber | HTTP + SSE | `/api/wx/chatroom/kick-member` + SSE |
| forward | chatuserinfolist | HTTP | `/api/wx/accounts/{id}/member-info` |
| forward | batchgetcontact | HTTP + SSE | `/api/wx/accounts/{id}/zombie-check` + SSE |
| forward | queryuserinfotask | HTTP | `/api/wx/accounts/{id}/user-info` |
| upload | - | 浏览器直传 OSS | ali-oss SDK + `/api/oss/sts-token` |
| uploadVoice | - | 待确认 | SSE 推送或废弃 |
| getMqttStatus | - | 废弃 | - |
| frontInfo | - | 废弃（已注释） | 删除 |
| reportLogicWorking | - | 废弃 | 删除 |
| killAll | - | 废弃 | 删除 |
| killJava | - | 废弃 | 删除 |
| sendNotice | - | SSE | SSE `notification` |
