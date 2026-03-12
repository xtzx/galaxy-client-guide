# 08-API与SDK调用

> 程序化访问 SLS 日志服务

---

## 一、概述

### 1.1 访问方式

| 方式 | 适用场景 |
|-----|---------|
| Web 控制台 | 交互式查询、可视化 |
| REST API | 自定义集成、跨平台 |
| SDK | 应用程序集成 |
| CLI | 命令行操作 |

### 1.2 SDK 支持

| 语言 | SDK |
|-----|-----|
| Node.js | `ali-sls`、`@alicloud/log` |
| Python | `aliyun-log-python-sdk` |
| Java | `aliyun-log-java-sdk` |
| Go | `aliyun-log-go-sdk` |

---

## 二、API 认证

### 2.1 AccessKey

SLS API 使用 AccessKey 进行身份验证：

| 凭证 | 说明 |
|-----|-----|
| AccessKey ID | 身份标识 |
| AccessKey Secret | 签名密钥（需保密） |

### 2.2 获取 AccessKey

1. 登录阿里云控制台
2. 右上角头像 → AccessKey 管理
3. 创建 AccessKey
4. **安全保存** AccessKey ID 和 Secret

### 2.3 安全建议

- 不要将 AccessKey 硬编码在代码中
- 使用环境变量或配置中心
- 定期轮换 AccessKey
- 使用 RAM 用户而非主账号

### 2.4 STS 临时凭证

用于更安全的临时访问：

```javascript
const sts = new STS({
    accessKeyId: 'xxx',
    accessKeySecret: 'xxx'
});

const token = await sts.assumeRole(roleArn, policy, expiration);
// 使用 token.Credentials 访问 SLS
```

---

## 三、REST API

### 3.1 API 端点

```
https://{project}.{region}.log.aliyuncs.com
```

示例：

```
https://your-project.cn-beijing.log.aliyuncs.com
```

### 3.2 签名机制

SLS API 使用签名验证请求：

1. 构造待签名字符串
2. 使用 HMAC-SHA1 签名
3. 添加 Authorization 头

### 3.3 查询日志 API

**请求：**

```
GET /logstores/{logstoreName}?type=log&topic=&from={from}&to={to}&query={query}
```

**参数：**

| 参数 | 说明 | 示例 |
|-----|-----|-----|
| `from` | 开始时间（Unix 秒） | `1706000000` |
| `to` | 结束时间（Unix 秒） | `1706100000` |
| `query` | 查询语句（URL 编码） | `error` |
| `line` | 返回行数 | `100` |
| `offset` | 偏移量 | `0` |

**响应：**

```json
{
    "progress": "Complete",
    "count": 100,
    "logs": [
        {
            "__time__": "1706000000",
            "__source__": "10.0.0.1",
            "message": "..."
        }
    ]
}
```

### 3.4 写入日志 API

**请求：**

```
POST /logstores/{logstoreName}/shards/lb
Content-Type: application/x-protobuf
```

**请求体：** Protocol Buffers 格式的日志数据

---

## 四、Node.js SDK

### 4.1 安装

```bash
npm install ali-sls
```

或使用官方 SDK：

```bash
npm install @alicloud/log
```

### 4.2 初始化

```javascript
const SlsLogger = require('ali-sls');

const client = new SlsLogger({
    endpoint: 'cn-beijing.log.aliyuncs.com',  // 端点
    accessKey: 'your-access-key-id',           // AccessKey ID
    accessSecret: 'your-access-key-secret',    // AccessKey Secret
    logstore: 'your-logstore-name'             // Logstore 名称
});
```

### 4.3 写入日志

```javascript
// 写入单条日志
client.info('This is an info log');
client.warn('This is a warning');
client.error('This is an error');

// 写入带标签的日志
client.info('User login', { userId: '12345', action: 'login' });
```

### 4.4 查询日志

使用 `@alicloud/log` SDK：

```javascript
const ALY = require('@alicloud/log');

const client = new ALY.LOG({
    accessKeyId: 'xxx',
    accessKeySecret: 'xxx',
    endpoint: 'cn-beijing.log.aliyuncs.com'
});

// 查询日志
const result = await client.getLogs({
    projectName: 'your-project',
    logStoreName: 'your-logstore',
    from: Math.floor(Date.now() / 1000) - 3600,  // 1小时前
    to: Math.floor(Date.now() / 1000),            // 现在
    query: 'error',
    line: 100
});

console.log(result.body);
```

### 4.5 Galaxy 项目代码解析

**文件位置：** `src/init/slsLog.js`

```javascript
const SlsLogger = require("ali-sls");

// 日志存储配置
const slsStore = "gaotu-wxzs-client-node-log";
const END_POINT = "gaotu-new.cn-beijing-intranet.log.aliyuncs.com";

// 获取 AccessKey（从后端服务获取，更安全）
const getSlsAk = async () => {
    try {
        let accessRes = await httpFetch({
            url: ossAccessKeyUrl,
            data: { access: access("arms-corp") }
        });
        const res = JSON.parse(decode(accessRes.data));
        return res;  // { accessKey, secretKey }
    } catch (error) {
        log.error("getSlsAkError", error);
        return {};
    }
};

const slsLogUtil = {
    slsClient: null,

    // 初始化 SLS 客户端
    async initSlsLog() {
        if (this.pedding) return;
        this.pedding = true;

        const { accessKey, secretKey } = await getSlsAk();
        if (!accessKey || !secretKey) {
            this.pedding = false;
            return;
        }

        this.slsClient = new SlsLogger({
            endpoint: END_POINT,
            accessKey,
            accessSecret: secretKey,
            logstore: slsStore,
        });

        this.pedding = false;
        return this.slsClient;
    },

    // 写入日志
    async customLog(message) {
        if (!this.slsClient) {
            await this.initSlsLog();
        }

        const casUserInfo = store.getUserInfo();
        const registrys = registryList.getRegistryList();

        // 格式化日志内容
        this.slsClient?.info(
            `[${casUserInfo?.user}] [${this.gid}] [${clientSonVersion}] [${clientVersion}] [号数量: ${registrys.length}] ${message}`
        );
    },
};

module.exports = slsLogUtil;
```

**关键点：**

1. **AccessKey 从后端获取**：不硬编码在前端
2. **统一日志格式**：`[用户] [GID] [版本] [号数量] 消息`
3. **延迟初始化**：首次写入时才初始化客户端

---

## 五、Python SDK

### 5.1 安装

```bash
pip install aliyun-log-python-sdk
```

### 5.2 初始化

```python
from aliyun.log import LogClient

client = LogClient(
    endpoint='cn-beijing.log.aliyuncs.com',
    accessKeyId='your-access-key-id',
    accessKey='your-access-key-secret'
)
```

### 5.3 查询日志

```python
from aliyun.log import GetLogsRequest
import time

# 查询参数
project = 'your-project'
logstore = 'your-logstore'
from_time = int(time.time()) - 3600  # 1小时前
to_time = int(time.time())
query = 'error'

# 执行查询
request = GetLogsRequest(
    project=project,
    logstore=logstore,
    fromTime=from_time,
    toTime=to_time,
    query=query,
    line=100
)

response = client.get_logs(request)

# 处理结果
for log in response.get_logs():
    print(log.get_contents())
```

### 5.4 写入日志

```python
from aliyun.log import PutLogsRequest, LogItem
import time

# 创建日志项
log_item = LogItem()
log_item.set_time(int(time.time()))
log_item.set_contents([
    ('level', 'info'),
    ('message', 'Test log from Python')
])

# 写入日志
request = PutLogsRequest(
    project='your-project',
    logstore='your-logstore',
    topic='',
    source='python-client',
    logitems=[log_item]
)

client.put_logs(request)
```

### 5.5 批量查询脚本

```python
import time
from aliyun.log import LogClient

def query_logs(client, project, logstore, query, hours=1):
    """查询最近 N 小时的日志"""
    to_time = int(time.time())
    from_time = to_time - hours * 3600

    logs = []
    offset = 0

    while True:
        response = client.get_logs(
            project, logstore,
            from_time, to_time,
            query=query,
            line=100,
            offset=offset
        )

        logs.extend(response.get_logs())

        if response.is_completed():
            break

        offset += 100
        time.sleep(0.1)  # 避免请求过快

    return logs

# 使用示例
client = LogClient('cn-beijing.log.aliyuncs.com', 'xxx', 'xxx')
logs = query_logs(client, 'project', 'logstore', 'error', hours=24)
print(f'Found {len(logs)} error logs')
```

---

## 六、错误处理

### 6.1 常见错误码

| 错误码 | 说明 | 解决方案 |
|-------|-----|---------|
| `Unauthorized` | 认证失败 | 检查 AccessKey |
| `ProjectNotExist` | Project 不存在 | 检查 Project 名称 |
| `LogStoreNotExist` | Logstore 不存在 | 检查 Logstore 名称 |
| `InvalidAccessKeyId` | AccessKey ID 无效 | 重新获取 AccessKey |
| `SignatureNotMatch` | 签名不匹配 | 检查 AccessKey Secret |
| `WriteQuotaExceed` | 写入配额超限 | 降低写入频率 |
| `ReadQuotaExceed` | 查询配额超限 | 降低查询频率 |

### 6.2 重试机制

```javascript
async function queryWithRetry(client, params, maxRetries = 3) {
    let lastError;

    for (let i = 0; i < maxRetries; i++) {
        try {
            return await client.getLogs(params);
        } catch (error) {
            lastError = error;

            // 判断是否可重试
            if (error.code === 'ReadQuotaExceed') {
                await sleep(1000 * (i + 1));  // 递增等待
                continue;
            }

            throw error;  // 不可重试的错误直接抛出
        }
    }

    throw lastError;
}
```

### 6.3 日志写入失败处理

```javascript
const slsLogUtil = {
    failedLogs: [],

    async customLog(message) {
        try {
            await this.slsClient?.info(message);
        } catch (error) {
            // 写入失败，缓存到本地
            this.failedLogs.push({
                message,
                timestamp: Date.now(),
                error: error.message
            });

            // 同时写入本地日志
            console.error('SLS write failed:', error);
        }
    },

    // 定时重试失败的日志
    async retryFailedLogs() {
        const logs = this.failedLogs.splice(0, 100);
        for (const log of logs) {
            try {
                await this.slsClient?.info(log.message);
            } catch (error) {
                this.failedLogs.push(log);
            }
        }
    }
};
```

---

## 七、最佳实践

### 7.1 批量写入

```javascript
// 批量收集日志
const logBuffer = [];

function bufferLog(message) {
    logBuffer.push({
        time: Math.floor(Date.now() / 1000),
        contents: { message }
    });

    // 达到阈值或定时刷新
    if (logBuffer.length >= 100) {
        flushLogs();
    }
}

async function flushLogs() {
    if (logBuffer.length === 0) return;

    const logs = logBuffer.splice(0, logBuffer.length);
    await client.putLogs(logs);
}

// 定时刷新
setInterval(flushLogs, 5000);
```

### 7.2 异步写入

```javascript
// 使用队列异步写入，不阻塞主流程
const Queue = require('async-lock');
const queue = new Queue();

async function asyncLog(message) {
    // 立即返回，异步写入
    setImmediate(async () => {
        await queue.acquire('sls', async () => {
            await slsClient.info(message);
        });
    });
}
```

### 7.3 日志采样

对于高频日志，进行采样减少写入量：

```javascript
let logCounter = 0;
const SAMPLE_RATE = 10;  // 10% 采样

function sampledLog(message, level = 'info') {
    logCounter++;

    // 错误日志全量上报
    if (level === 'error') {
        slsClient.error(message);
        return;
    }

    // 其他日志采样
    if (logCounter % SAMPLE_RATE === 0) {
        slsClient[level](message);
    }
}
```

### 7.4 本地缓存

```javascript
const fs = require('fs');
const path = require('path');

const LOG_CACHE_FILE = path.join(app.getPath('userData'), 'sls-cache.json');

// 写入失败时缓存到本地文件
function cacheLogToFile(log) {
    try {
        const cache = JSON.parse(fs.readFileSync(LOG_CACHE_FILE, 'utf8') || '[]');
        cache.push(log);
        fs.writeFileSync(LOG_CACHE_FILE, JSON.stringify(cache));
    } catch (error) {
        // 文件操作失败，忽略
    }
}

// 启动时上传缓存的日志
async function uploadCachedLogs() {
    try {
        const cache = JSON.parse(fs.readFileSync(LOG_CACHE_FILE, 'utf8') || '[]');
        if (cache.length > 0) {
            for (const log of cache) {
                await slsClient.info(log.message);
            }
            fs.writeFileSync(LOG_CACHE_FILE, '[]');
        }
    } catch (error) {
        // 忽略
    }
}
```

---

## 八、API 限制

### 8.1 配额限制

| 限制项 | 默认值 |
|-------|-------|
| 单次查询返回行数 | 10000 |
| 查询并发数 | 100 |
| 写入 QPS | 500 MB/s |
| 单条日志大小 | 1 MB |

### 8.2 提高配额

如需提高配额，可以：

1. 提交工单申请
2. 使用多个 Logstore 分摊
3. 优化查询减少数据量

---

## 九、下一步

掌握 API 和 SDK 后，建议学习：

1. [09-性能优化与限制.md](./09-性能优化与限制.md) - 优化 API 调用
2. [10-安全与权限管理.md](./10-安全与权限管理.md) - AccessKey 安全管理
3. [13-与本地日志对比.md](./13-与本地日志对比.md) - 理解日志上报机制
