# HTTP/REST 通信机制详解

> 本文档详细分析 galaxy-client 项目中 HTTP/REST 通信机制的设计、请求封装、涉及场景、端点清单和调试方法。

---

## 一、HTTP/REST 在项目中的角色

### 1.1 HTTP/REST 的定位

HTTP/REST 是 galaxy-client 中使用最广泛但最"低调"的通信机制。与 WebSocket、MQTT 等长连接通信不同，HTTP 采用传统的请求-响应模式，适用于一次性的数据查询、同步和上报操作。

在五大通信机制中，HTTP/REST 负责：

- **鉴权认证**：获取 MQTT 连接凭证、OSS 上传凭证
- **配置获取**：从 Apollo 获取动态配置、从云端获取机器人配置
- **数据同步**：好友列表上报、群成员上报、标签同步
- **日志上报**：SLS 日志收集、Habo 事件上报
- **文件操作**：OSS 文件上传/下载
- **网络检测**：CAS 登录页可达性检查

### 1.2 为什么还需要 HTTP

既然有了 MQTT 和 WebSocket，为什么还需要 HTTP？原因在于各通信机制的职责不同：

| 场景 | HTTP 的优势 |
|------|-----------|
| 鉴权 | 需要在 MQTT/WebSocket 连接之前完成，HTTP 是唯一选择 |
| 批量数据同步 | 好友列表可能几十 KB，HTTP 更适合大数据量传输 |
| 配置获取 | 一次性获取，不需要长连接 |
| 日志上报 | 无需实时性，HTTP 的请求-响应模式足够 |
| 文件上传 | OSS SDK 基于 HTTP 协议 |

### 1.3 技术选型

| 项目 | 选择 | 说明 |
|------|------|------|
| HTTP 客户端 | `node-fetch` | 主要的 HTTP 请求库，轻量级 |
| 辅助客户端 | `axios` | 少量场景使用（如跨域请求代理） |
| Electron HTTP | `electron.net` | 用于网络检测和文件下载 |
| OSS 客户端 | `ali-oss` | 阿里云对象存储 SDK |
| 日志客户端 | `ali-sls` | 阿里云简单日志服务 SDK |

---

## 二、HTTP 请求封装

### 2.1 核心封装（common/fetch.js）

项目提供了统一的 HTTP 请求封装函数 `httpFetch`：

**函数签名**：

```
httpFetch({
    url: string,           // 请求 URL
    data: object,          // 请求体数据
    headers: object,       // 请求头（可选）
    method: string         // 请求方法（默认 POST）
})
```

**处理逻辑**：

```
httpFetch 执行流程：
    │
    ├─ 步骤 1: 构建请求配置
    │    headers = {
    │        'Content-Type': 'application/json',
    │        ...自定义 headers
    │    }
    │    body = JSON.stringify(data)
    │
    ├─ 步骤 2: 发送请求
    │    fetch(url, {
    │        method: method || 'POST',
    │        headers,
    │        body
    │    })
    │
    ├─ 步骤 3: 解析响应
    │    根据 Content-Type 判断：
    │    ├─ application/json → response.json()
    │    └─ 其他 → response.text()
    │
    └─ 步骤 4: 返回数据
         return parsed data
```

**特点**：
- 默认使用 POST 方法
- 自动设置 `Content-Type: application/json`
- 自动根据响应类型解析 JSON 或文本
- 无超时设置（依赖 Node.js 默认行为）
- 无重试机制（调用方自行处理）

### 2.2 Electron Net 模块（common/net.js）

对于需要使用 Electron 特定能力的场景（如 Cookie 管理、证书处理），使用 `electron.net` 模块：

**网络检测**（`check()`）：

```
net.check() 执行流程：
    │
    ├─ 使用 net.request 请求 CAS 登录 URL
    │    url = loginUrl（如 https://tongbao.umeng100.com/web5）
    │    超时 = 10 秒
    │
    ├─ 如果请求成功（状态码 200）
    │    → 返回 true（网络可达）
    │
    └─ 如果请求失败或超时
         → 返回 false（网络不可达）
```

**文件下载**（`download()`）：

```
net.download(options) 执行流程：
    │
    ├─ 使用 net.request 下载文件
    │    url = 下载 URL
    │    目标路径 = 本地文件路径
    │
    ├─ 逐块写入本地文件
    │    response.on('data', chunk => {
    │        fs.write(chunk)
    │    })
    │
    └─ 下载完成或失败
         → 返回结果
```

### 2.3 Axios（event/ipc.js）

在跨域请求代理场景中使用 `axios`：

```
跨域请求代理流程：
    │
    ├─ 渲染进程通过 IPC 请求 'cross-origin-request'
    │    传入目标 URL
    │
    ├─ 主进程使用 axios.get(url) 发起请求
    │    Node.js 不受浏览器 CORS 限制
    │
    └─ 将响应数据返回给渲染进程
```

---

## 三、HTTP 端点清单

### 3.1 鉴权相关端点

| 端点 | 环境 | 方法 | 用途 |
|------|------|------|------|
| `https://api.umeng100.com/uqun/token/aly/open/access` | 生产 | POST | 获取 MQTT 连接凭证（accessKey、secretKey） |
| `https://test-api.umeng100.com/uqun/token/aly/open/access` | 测试 | POST | 同上 |
| OSS 鉴权 URL（`oss.expiration.url`） | 配置 | POST | 获取 OSS 上传凭证 |
| SLS 鉴权 URL（`sls.expiration.url`） | 配置 | POST | 获取 SLS 日志上传凭证 |

### 3.2 业务数据同步端点

| 端点 | 环境 | 方法 | 用途 |
|------|------|------|------|
| `http://qun-center.umeng100.com/window/task/friendInfos` | 生产 | POST | 上报好友列表 |
| `http://qun-center.umeng100.com/window/task/wkTagInfos` | 生产 | POST | 上报企微标签信息 |
| `http://qun-center.umeng100.com/window/task/updateServiceAccountSubscribe` | 生产 | POST | 更新服务号订阅 |
| `http://qun-center.umeng100.com/window/task/updateChatroomInfo` | 生产 | POST | 上报群成员信息 |

### 3.3 配置获取端点

| 端点 | 环境 | 方法 | 用途 |
|------|------|------|------|
| `https://qun.umeng100.com/wechat/assist/common/apollo/get` | 生产 | POST | 获取 Apollo 动态配置 |
| 云端机器人配置 URL（`robotCloudConfig`） | 配置 | GET/POST | 获取机器人运行配置 |

### 3.4 日志与监控端点

| 端点 | 环境 | 方法 | 用途 |
|------|------|------|------|
| `https://logdata.umeng100.com/log/collector/open/data/report.ajax` | 生产 | POST | Habo 事件上报 |
| 阿里云 SLS 端点 | 配置 | SDK | SLS 日志收集 |
| 灵犀告警 URL | 内网 | POST | 灵犀告警通知 |

### 3.5 CAS 认证端点

| 端点 | 环境 | 用途 |
|------|------|------|
| `https://tongbao.umeng100.com/web5` | 生产 | 通宝系统登录页 |
| `https://test-tongbao.umeng100.com/web5` | 测试 | 同上 |
| CAS SSO URL | — | CAS 单点登录认证 |

### 3.6 更新相关端点

| 端点 | 用途 |
|------|------|
| 更新 Feed URL（动态设置） | electron-updater 检查新版本 |
| 下载更新包 URL | 下载安装包 |

---

## 四、关键场景详解

### 4.1 场景一：MQTT 鉴权令牌获取

在建立 MQTT 连接之前，需要通过 HTTP 获取阿里云的访问凭证。

**完整流程**：

```
步骤 1: 编码请求参数
    plainText = "ACCOUNT"
    XOR 加密 → Base64 编码 → encodedAccess
    requestBody = { access: encodedAccess }

步骤 2: 发送 HTTP 请求
    httpFetch({
        url: "https://api.umeng100.com/uqun/token/aly/open/access",
        data: { access: encodedAccess },
        method: "POST"
    })

步骤 3: 解析响应
    response = { code: 200, data: "加密的响应字符串" }
    Base64 解码 → XOR 解密 → JSON 解析
    result = { accessKey: "xxx", secretKey: "yyy" }

步骤 4: 缓存凭证
    accessResCache = result
    后续 MQTT 连接复用缓存

步骤 5: 使用凭证建立 MQTT 连接
    username = "Signature|" + accessKey + "|" + instanceId
    password = HMAC-SHA1(clientId, secretKey)
    mqtt.connect(broker, { username, password })
```

**请求数据格式**：

```
请求:
POST https://api.umeng100.com/uqun/token/aly/open/access
Content-Type: application/json
Body: { "access": "Base64编码后的加密字符串" }

响应:
{
    "code": 200,
    "data": "Base64编码后的加密字符串",
    "msg": "success"
}

解密后:
{
    "accessKey": "LTAIxxxxxxxxxxx",
    "secretKey": "xxxxxxxxxxxxxxxxxxxxxxx"
}
```

**安全机制**：
- 请求参数经过 XOR + Base64 双重编码
- 响应数据同样经过加密
- 凭证有有效期，过期后需重新获取（由 `GetOssAccessKeyTimer` 定时刷新）

### 4.2 场景二：好友列表上报

微信账号登录后或好友列表变更时，需要将完整的好友列表同步到云端。

**完整流程**：

```
步骤 1: 逆向返回好友列表
    微信通过 Named Pipe 返回 USER_LIST 类型消息
    包含所有好友的信息

步骤 2: 数据处理
    friendsListResponseService.operate()
    ├─ 解析好友数据
    ├─ 与本地 SQLite 对比
    ├─ 更新本地数据库
    └─ 构建上报数据

步骤 3: HTTP 上报
    httpFetch({
        url: "http://qun-center.umeng100.com/window/task/friendInfos",
        data: {
            wxId: "wxid_abc123",
            friendInfos: [
                {
                    username: "wxid_friend1",
                    alias: "alias1",
                    nickname: "昵称1",
                    headUrl: "头像URL",
                    conRemark: "备注",
                    sex: 1,
                    city: "北京",
                    province: "北京"
                },
                ...
            ]
        }
    })

步骤 4: 处理响应
    云端返回确认
```

**数据量**：好友列表可能包含几百到几千条记录，单次请求体可能达到几十 KB 到几百 KB。

### 4.3 场景三：群成员信息上报

```
步骤 1: 触发上报
    chatroomMembersListDetails 或 uploadRoomMemberInfos 触发

步骤 2: 收集群成员数据
    从本地 SQLite 和逆向返回的数据中汇总

步骤 3: HTTP 上报
    httpFetch({
        url: uploadChatroomMembersUrl,
        data: {
            wxId: "wxid_abc123",
            chatroom: "xxx@chatroom",
            members: [
                {
                    username: "wxid_member1",
                    nickname: "成员1",
                    headimg: "头像URL",
                    remark: "备注"
                },
                ...
            ]
        }
    })
```

### 4.4 场景四：Apollo 配置获取

通过 HTTP 从 Apollo 配置中心获取动态配置，影响 MQTT、任务处理等行为。

**完整流程**：

```
步骤 1: 定时触发
    GetCloudConfigTimer 定时执行

步骤 2: 请求 Apollo 配置
    httpFetch({
        url: "https://qun.umeng100.com/wechat/assist/common/apollo/get",
        data: { namespace: "application" }
    })

步骤 3: 解析配置
    response = {
        "client.wxzs.mqtt.task.expire.hours": "3",
        "client.wxzs.taskFailWaitTime": "5000",
        "client.wxzs.taskDefaultWaitTime": "1000",
        ...
    }

步骤 4: 更新本地配置
    覆盖 applicationConfig 中的对应项
    影响后续任务处理行为
```

**配置项列表**：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `client.wxzs.mqtt.task.expire.hours` | MQTT 任务过期时间（小时） | 3 |
| `client.wxzs.taskFailWaitTime` | 任务失败等待时间（毫秒） | — |
| `client.wxzs.taskDefaultWaitTime` | 任务默认等待时间（毫秒） | — |
| `client.wxzs.mqttTaskExpireHours` | MQTT 任务过期小时数 | 3 |

### 4.5 场景五：Habo 事件上报

关键事件（如启动、崩溃、错误）通过 Habo 上报到统计平台。

**完整流程**：

```
步骤 1: 事件触发
    如应用启动、崩溃检测、逆向错误等

步骤 2: 构建上报数据
    haboReport({
        eventType: "APP_START",
        data: {
            version: "1.2.3",
            gid: "设备ID",
            timestamp: Date.now()
        }
    })

步骤 3: HTTP 上报
    httpFetch({
        url: "https://logdata.umeng100.com/log/collector/open/data/report.ajax",
        data: {
            eventType: "APP_START",
            ...eventData
        }
    })
```

**上报事件类型**：

| 事件类型 | 触发场景 |
|---------|---------|
| `APP_START` | 应用启动 |
| `REVERSE_BUG_REPORT` | 逆向错误报告 |
| `EXEC_ERROR` | 执行错误 |
| `CRASH` | 应用崩溃 |
| `INJECT_SUCCESS` | 注入成功 |
| `INJECT_FAIL` | 注入失败 |

### 4.6 场景六：OSS 文件上传

通过阿里云 OSS SDK 上传文件（如图片、视频、语音等）。

**完整流程**：

```
步骤 1: 获取 OSS 凭证
    ├─ 缓存有效 → 使用缓存
    └─ 缓存过期 → HTTP 请求新凭证
         httpFetch({
             url: oss.expiration.url,
             data: { access: encodedAccess }
         })
         → { accessKeyId, accessKeySecret, securityToken, bucket, region }

步骤 2: 创建 OSS 客户端
    new OSS({
        region: result.region,
        accessKeyId: result.accessKeyId,
        accessKeySecret: result.accessKeySecret,
        stsToken: result.securityToken,
        bucket: result.bucket
    })

步骤 3: 上传文件
    ossClient.put(objectKey, filePath)
    → 返回 OSS URL

步骤 4: 使用 OSS URL
    将 URL 传递给业务层（如发送图片消息时引用 OSS URL）
```

### 4.7 场景七：SLS 日志上报

通过阿里云 SLS（简单日志服务）上传运行日志。

**完整流程**：

```
步骤 1: 初始化 SLS 客户端
    slsLogUtil.initSlsLog()
    ├─ 获取 SLS 凭证（HTTP 请求）
    └─ 创建 SLS 实例

步骤 2: 日志记录
    slsLogUtil.customLog(logLevel, message, extra)
    ├─ 附加上下文信息：
    │    casUser, gid, version, accountCount
    └─ 发送到 SLS

步骤 3: SLS SDK 处理
    缓冲 → 批量上传 → 阿里云 SLS
```

### 4.8 场景八：灵犀告警

当系统检测到异常情况时，通过 HTTP 发送告警到灵犀平台。

**完整流程**：

```
步骤 1: 异常检测
    如 MQTT 频繁断开、Pong 超时、内存超限等

步骤 2: 构建告警消息
    notify.onMqttClose(wxId)
    → 构建告警内容

步骤 3: 发送告警
    httpFetch({
        url: "https://internal-ei.baijia.com/ei-serve-management-logic/internal/teamRobot/sendMessage?key=xxx",
        data: {
            msgtype: "text",
            text: {
                content: "告警内容..."
            }
        }
    })
```

**告警场景**：

| 场景 | 触发条件 | 告警级别 |
|------|---------|---------|
| MQTT 频繁断开 | 短时间内多次断开 | 高 |
| Pong 超时 | 心跳响应超时 | 高 |
| 内存/CPU 过高 | 超过 99% | 中 |
| 断网 | 网络不可达 | 中 |
| 逆向未返回 | 长时间无响应 | 高 |
| 应用崩溃 | 未捕获异常 | 高 |

### 4.9 场景九：网络检测

应用启动时检测网络是否可达，决定加载登录页还是离线页。

**完整流程**：

```
步骤 1: 调用 net.check()
    使用 electron.net.request 请求 CAS 登录 URL
    超时 10 秒

步骤 2: 判断结果
    ├─ 网络可达 → 加载正常的登录 URL
    │    loginUrl = "https://tongbao.umeng100.com/web5?..."
    │
    └─ 网络不可达 → 加载本地离线页
         offlineUrl = "file://...error.html"

步骤 3: 主窗口加载对应 URL
```

### 4.10 场景十：企微标签信息上报

```
步骤 1: 触发上报
    UploadWorkWxContactLabelTimer 定时触发
    或企微标签变更时触发

步骤 2: 收集标签数据
    从本地 SQLite 查询标签信息

步骤 3: HTTP 上报
    httpFetch({
        url: wkTagInfosUrl,
        data: {
            wxId: "wxid_abc123",
            wkTagInfos: [
                { tagId: "tag_001", tagName: "标签1", members: [...] },
                ...
            ]
        }
    })
```

---

## 五、HTTP 与其他通信机制的协作

### 5.1 HTTP → MQTT

- MQTT 连接前需要通过 HTTP 获取鉴权凭证
- Apollo 配置（通过 HTTP）影响 MQTT 的行为参数

```
HTTP (获取凭证) → MQTT (建立连接)
HTTP (获取配置) → MQTT (调整超时/过期策略)
```

### 5.2 HTTP → 逆向 IPC

- 某些任务在发送到逆向之前，需要先通过 HTTP 下载文件（如图片、视频）
- 例如：MQTT 下发"发图片消息"任务 → HTTP 下载图片到本地 → 通过 Named Pipe 发送本地路径给微信

```
MQTT (任务下发) → HTTP (下载文件) → 逆向 IPC (发送本地路径)
```

### 5.3 逆向 IPC → HTTP

- 逆向返回的数据需要通过 HTTP 同步到云端（好友列表、群成员等）
- 逆向返回的错误需要通过 HTTP 上报（Habo、SLS）

```
逆向 IPC (好友列表) → HTTP (上报到 qun-center)
逆向 IPC (错误信息) → HTTP (上报到 Habo/SLS)
```

### 5.4 WebSocket → HTTP

- 前端通过 WebSocket 发起文件上传请求 → 主进程通过 HTTP 上传到 OSS
- 前端通过 Electron IPC 请求跨域数据 → 主进程通过 HTTP (axios) 代理请求

```
WebSocket (上传请求) → HTTP (OSS 上传)
Electron IPC (跨域请求) → HTTP (代理请求)
```

---

## 六、环境配置与 URL 管理

### 6.1 环境区分

项目支持多个运行环境，通过环境变量区分：

| 环境变量 | 可选值 | 说明 |
|---------|--------|------|
| `ELECTRON_NODE_ENV` | `dev` | 开发环境 |
| `ENV_TYPE` | `prod`, `test`, `vt` | 部署环境 |
| `VERSION_TYPE` | — | 版本类型 |
| `SERVER` | — | 自定义服务器 |

### 6.2 URL 配置管理

`common/urls.js` 负责根据环境变量生成各种 URL：

**主要 URL**：

| URL 名称 | 生产环境 | 测试环境 |
|---------|---------|---------|
| `loginUrl` | `https://tongbao.umeng100.com/web5` | `https://test-tongbao.umeng100.com/web5` |
| `successUrl` | `https://tongbao.umeng100.com/web5` | `https://test-tongbao.umeng100.com/web5` |
| `offlineUrl` | 本地 error.html | 本地 error.html |
| `haboUrl` | `https://logdata.umeng100.com/...` | 同上 |
| `sentryUrl` | 配置中 | 配置中 |
| `devServerRoot` | — | `http://10.22.78.73:3000` |

### 6.3 Application Config 中的 URL

`msg-center/core/application-config/` 中按环境定义了更多 URL：

| 配置名 | 生产环境 | 说明 |
|--------|---------|------|
| `friendsListUrl` | `http://qun-center.umeng100.com/window/task/friendInfos` | 好友列表上报 |
| `wkTagInfosUrl` | `http://qun-center.umeng100.com/window/task/wkTagInfos` | 企微标签上报 |
| `fwUsersUrl` | `http://qun-center.umeng100.com/window/task/updateServiceAccountSubscribe` | 服务号订阅更新 |
| `uploadChatroomMembersUrl` | `http://qun-center.umeng100.com/window/task/updateChatroomInfo` | 群成员上报 |
| `getApolloConfigUrl` | `https://qun.umeng100.com/wechat/assist/common/apollo/get` | Apollo 配置 |
| `reportUrl` | `https://logdata.umeng100.com/log/collector/open/data/report.ajax` | Habo 上报 |
| `mqtt.expiration.url` | `https://api.umeng100.com/uqun/token/aly/open/access` | MQTT 鉴权 |
| `oss.expiration.url` | 配置中 | OSS 鉴权 |
| `sls.expiration.url` | 配置中 | SLS 鉴权 |
| `robotCloudConfig` | 配置中 | 机器人云端配置 |

---

## 七、数据格式详解

### 7.1 通用请求格式

大部分 HTTP 请求使用 JSON 格式：

```
请求头:
Content-Type: application/json

请求体:
{
    "field1": "value1",
    "field2": "value2",
    ...
}
```

### 7.2 通用响应格式

```
{
    "code": 200,        // 状态码
    "data": { ... },    // 响应数据
    "msg": "success"    // 消息
}
```

### 7.3 加密数据格式

鉴权相关的请求和响应使用加密：

```
加密过程:
    明文 → XOR 加密 → Base64 编码 → 密文

解密过程:
    密文 → Base64 解码 → XOR 解密 → 明文
```

XOR 加密使用 `common/encryptUtil.js` 中的 `access()` 和 `decode()` 函数。

### 7.4 好友列表数据格式

```
{
    "wxId": "wxid_abc123",
    "friendInfos": [
        {
            "username": "wxid_friend1",
            "alias": "alias_friend1",
            "nickname": "好友昵称",
            "headUrl": "https://wx.qlogo.cn/mmhead/...",
            "conRemark": "备注名",
            "sex": 1,
            "city": "北京",
            "province": "北京",
            "signature": "个性签名"
        },
        ...
    ]
}
```

### 7.5 群成员数据格式

```
{
    "wxId": "wxid_abc123",
    "chatroom": "12345678@chatroom",
    "chatroomMemberInfoList": [
        {
            "chatroom": "12345678@chatroom",
            "username": "wxid_member1",
            "own_robot": "wxid_abc123",
            "nickname": "成员昵称",
            "headimg": "https://wx.qlogo.cn/...",
            "remark": "备注"
        },
        ...
    ]
}
```

### 7.6 Apollo 配置响应格式

```
{
    "code": 200,
    "data": {
        "client.wxzs.mqtt.task.expire.hours": "3",
        "client.wxzs.taskFailWaitTime": "5000",
        "client.wxzs.taskDefaultWaitTime": "1000",
        "client.wxzs.wxCropsIdList": "corp1,corp2",
        ...
    }
}
```

### 7.7 Habo 上报数据格式

```
{
    "eventType": "APP_START",
    "version": "1.2.3",
    "gid": "设备唯一标识",
    "platform": "win32",
    "timestamp": 1710000000000,
    "extra": {
        // 事件特定数据
    }
}
```

---

## 八、定时 HTTP 请求

项目中有多个定时任务会触发 HTTP 请求：

| 定时任务 | 周期 | HTTP 操作 |
|---------|------|----------|
| `GetCloudConfigTimer` | 按配置 | 获取 Apollo 配置、机器人云端配置 |
| `GetOssAccessKeyTimer` | 按配置 | 刷新 OSS 上传凭证 |
| `ReportMonitorInfoTimer` | 按配置 | 上报监控信息 |
| `UploadWxContactLabelTimer` | 按配置 | 上报微信联系人标签 |
| `UploadWorkWxContactLabelTimer` | 按配置 | 上报企微联系人标签 |
| `CheckChatroomNewMemberTimer` | 按配置 | 检查新群成员并上报 |
| `processUsageReport` | 60 秒 | 上报进程资源使用情况（SLS） |

---

## 九、错误处理与容错

### 9.1 请求级错误处理

`httpFetch` 本身不包含重试逻辑，错误处理由调用方负责：

| 调用方 | 错误处理策略 |
|--------|------------|
| MQTT 鉴权 | 缓存机制——如果缓存有效，不重复请求 |
| 好友列表上报 | 记录日志，下次触发时重新上报 |
| Apollo 配置 | 使用默认值，下次定时任务重新获取 |
| Habo 上报 | 记录日志，不重试（非关键路径） |
| SLS 日志 | SDK 内部有缓冲和重试机制 |
| OSS 上传 | 记录日志，返回错误给调用方 |

### 9.2 网络不可达

当 `net.check()` 检测到网络不可达时：
- 加载本地离线页面（error.html）
- 离线页面提供"重新登录"按钮
- 用户点击后通过 IPC 触发 `userLogin`，重新检测网络

### 9.3 凭证过期

MQTT 和 OSS 的凭证有有效期：
- 定时任务（`GetOssAccessKeyTimer`）在凭证过期前主动刷新
- 如果使用过期凭证导致操作失败，触发重新获取凭证

### 9.4 大数据量处理

好友列表和群成员列表可能很大：
- 没有分页机制，单次请求传输全部数据
- 建议对超大列表实现分批上报

---

## 十、安全考虑

### 10.1 传输安全

| 端点类型 | 协议 | 安全性 |
|---------|------|--------|
| 鉴权端点 | HTTPS | 加密传输 |
| Apollo 配置 | HTTPS | 加密传输 |
| Habo 上报 | HTTPS | 加密传输 |
| 业务数据同步 | HTTP | 明文传输（内网） |

注意：`qun-center.umeng100.com` 的部分端点使用 HTTP 而非 HTTPS。如果这些端点需要在公网环境使用，建议升级为 HTTPS。

### 10.2 数据安全

- 鉴权凭证通过 XOR + Base64 加密传输（轻量级加密，非强安全）
- 好友列表等业务数据明文传输（在企业内网中可接受）
- 灵犀告警通过内网 URL 发送，不暴露到公网

### 10.3 Cookie 管理

- CAS 认证使用 CASTGC cookie
- U 群和 GID cookie 通过 IPC 写入 Electron Session
- 退出时清除 CASTGC cookie

---

## 十一、调试方法

### 11.1 日志排查

在主进程日志中搜索以下关键字：

| 关键字 | 说明 |
|--------|------|
| `httpFetch` | HTTP 请求执行 |
| `net.check` | 网络检测 |
| `apollo` | Apollo 配置获取 |
| `access` / `accessKey` | 鉴权凭证获取 |
| `friendInfos` | 好友列表上报 |
| `uploadChatroom` | 群成员上报 |
| `haboReport` | Habo 上报 |
| `slsLog` | SLS 日志 |
| `notify` / `灵犀` | 告警通知 |
| `oss` | OSS 操作 |

### 11.2 网络抓包

**使用 Fiddler/Charles**：
- 配置 Node.js 代理（如果需要）
- 查看所有 HTTP 请求和响应
- 检查请求头、请求体、响应状态码

**使用 Electron DevTools**：
- 渲染进程的 Network 标签可以看到部分请求（通过 preload 发起的）
- 主进程的请求需要通过日志或抓包工具查看

### 11.3 常见问题排查

**问题：MQTT 鉴权失败**
- 检查鉴权 URL 是否可达（`curl` 或浏览器访问）
- 检查加密/解密逻辑是否正确
- 检查返回的 accessKey/secretKey 是否有效
- 检查凭证是否过期

**问题：好友列表上报失败**
- 检查 `friendsListUrl` 是否正确
- 检查请求体格式是否符合后端要求
- 检查网络是否可达
- 查看后端返回的错误信息

**问题：Apollo 配置获取失败**
- 检查 `getApolloConfigUrl` 是否可达
- 使用默认值继续运行
- 下次定时任务会重试

**问题：OSS 上传失败**
- 检查 OSS 凭证是否有效
- 检查文件是否存在
- 检查 Bucket 和 Region 配置
- 查看 OSS SDK 的错误日志

---

## 十二、性能考虑

### 12.1 请求频率

HTTP 请求大部分是低频操作（定时任务、事件触发），不会造成性能瓶颈。

高频场景：
- SLS 日志上报：SDK 内部有缓冲机制，不会每条日志单独请求
- Habo 上报：事件触发型，频率取决于事件发生率

### 12.2 请求大小

大部分请求在几 KB 以内。可能较大的请求：
- 好友列表上报：几千个好友时可能达到几百 KB
- 群成员上报：大群可能有几百个成员
- 日志上报：批量日志可能较大

### 12.3 连接复用

`node-fetch` 默认使用 Node.js 的 HTTP Agent，支持连接复用（keep-alive）。对于同一个域名的多次请求，会复用 TCP 连接，减少连接建立的开销。

---

## 十三、总结

HTTP/REST 是 galaxy-client 中最基础但不可或缺的通信机制。它虽然不像 WebSocket 和 MQTT 那样承载核心业务数据流，但为其他通信机制提供了关键的基础设施支持。

**核心特征**：
- 基于 `node-fetch` 的统一 HTTP 封装
- 覆盖鉴权、配置、数据同步、日志上报等多种场景
- 与阿里云生态深度集成（OSS、SLS、MQ）
- 按环境区分 URL 配置

**在通信架构中的位置**：
- 为 MQTT 提供鉴权凭证（前置依赖）
- 为业务层提供数据同步能力（好友、群成员、标签）
- 为运维提供日志和监控上报
- 为安全提供网络检测和 CAS 认证

**改进空间**：
- 增加统一的超时和重试机制
- 对大数据量上报实现分页/分批
- 将 HTTP 端点统一升级为 HTTPS
- 考虑使用请求队列管理并发请求
