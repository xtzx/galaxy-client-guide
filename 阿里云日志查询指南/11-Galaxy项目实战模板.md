# 11-Galaxy项目实战模板

> Galaxy-Client 项目常用日志查询模板

---

## 一、项目日志结构

### 1.1 日志配置

| 配置项 | 值 |
|-------|---|
| Logstore | `gaotu-wxzs-client-node-log` |
| Endpoint | `gaotu-new.cn-beijing-intranet.log.aliyuncs.com` |

### 1.2 日志格式

每条日志的 `message` 字段格式：

```
[用户名] [GID] [sonVersion] [version] [号数量: X] 实际日志内容
```

### 1.3 字段说明

| 字段位置 | 说明 | 示例 |
|---------|-----|-----|
| 第1个 [] | CAS 用户名 | `lixiaolu02` |
| 第2个 [] | 客户端 GID | `YYDwStXQ...` |
| 第3个 [] | 子版本号 | `sonVersion1` |
| 第4个 [] | 客户端版本 | `5.4.2-release01` |
| 第5个 [] | 登录的微信号数量 | `号数量: 1` |
| 后续内容 | 实际日志信息 | `[初始化] ...` |

### 1.4 提取字段

```sql
-- 提取用户名
REGEXP_EXTRACT(message, '\[([^\]]+)\]', 1) AS username

-- 提取版本
REGEXP_EXTRACT(message, '\[(\d+\.\d+\.\d+-[^\]]+)\]', 1) AS version

-- 提取微信号数量
REGEXP_EXTRACT(message, '号数量:\s*(\d+)', 1) AS wx_count
```

---

## 二、用户与登录

### 2.1 查询某用户所有日志

```sql
lixiaolu02 | SELECT * ORDER BY __time__ DESC LIMIT 100
```

### 2.2 查询某用户最近错误

```sql
lixiaolu02 and level:error | SELECT * ORDER BY __time__ DESC LIMIT 50
```

### 2.3 用户登录日志

```sql
lixiaolu02 and (login or 登录) | SELECT * ORDER BY __time__ DESC LIMIT 50
```

### 2.4 登录成功统计

```sql
(login or 登录) and (success or 成功) | SELECT
    DATE_FORMAT(FROM_UNIXTIME(__time__), '%Y-%m-%d %H:00') AS hour,
    COUNT(*) AS login_count
GROUP BY DATE_FORMAT(FROM_UNIXTIME(__time__), '%Y-%m-%d %H:00')
ORDER BY hour
```

### 2.5 登录失败统计

```sql
(login or 登录) and (fail or 失败 or error) | SELECT
    REGEXP_EXTRACT(message, '\[([^\]]+)\]', 1) AS username,
    COUNT(*) AS fail_count
GROUP BY REGEXP_EXTRACT(message, '\[([^\]]+)\]', 1)
ORDER BY fail_count DESC
LIMIT 20
```

### 2.6 活跃用户统计

```sql
* | SELECT
    REGEXP_EXTRACT(message, '\[([^\]]+)\]', 1) AS username,
    COUNT(*) AS log_count,
    MIN(__time__) AS first_seen,
    MAX(__time__) AS last_seen
GROUP BY REGEXP_EXTRACT(message, '\[([^\]]+)\]', 1)
ORDER BY log_count DESC
LIMIT 50
```

### 2.7 用户版本分布

```sql
* | SELECT
    REGEXP_EXTRACT(message, '\[(\d+\.\d+\.\d+-[^\]]+)\]', 1) AS version,
    COUNT(DISTINCT REGEXP_EXTRACT(message, '\[([^\]]+)\]', 1)) AS user_count
GROUP BY REGEXP_EXTRACT(message, '\[(\d+\.\d+\.\d+-[^\]]+)\]', 1)
ORDER BY user_count DESC
```

---

## 三、消息与任务

### 3.1 MQTT 任务日志

```sql
lixiaolu02 and mqtt | SELECT * ORDER BY __time__ DESC LIMIT 100
```

### 3.2 MQTT 任务统计

```sql
mqtt and "接收mqtt任务" | SELECT
    DATE_FORMAT(FROM_UNIXTIME(__time__), '%Y-%m-%d %H:00') AS hour,
    COUNT(*) AS task_count
GROUP BY DATE_FORMAT(FROM_UNIXTIME(__time__), '%Y-%m-%d %H:00')
ORDER BY hour
```

### 3.3 消息发送日志

```sql
lixiaolu02 and (sendmsg or 发送消息) | SELECT * ORDER BY __time__ DESC LIMIT 100
```

### 3.4 消息发送成功率

```sql
sendmsg | SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN message LIKE '%success%' OR message LIKE '%成功%' THEN 1 ELSE 0 END) AS success_count,
    ROUND(SUM(CASE WHEN message LIKE '%success%' OR message LIKE '%成功%' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) AS success_rate
```

### 3.5 任务超时统计

```sql
(timeout or 超时) | SELECT
    DATE_FORMAT(FROM_UNIXTIME(__time__), '%Y-%m-%d %H:00') AS hour,
    COUNT(*) AS timeout_count
GROUP BY DATE_FORMAT(FROM_UNIXTIME(__time__), '%Y-%m-%d %H:00')
ORDER BY hour
```

### 3.6 任务类型分布

```sql
"接收mqtt任务" | SELECT
    REGEXP_EXTRACT(message, 'type[=:]([a-zA-Z]+)', 1) AS task_type,
    COUNT(*) AS cnt
GROUP BY REGEXP_EXTRACT(message, 'type[=:]([a-zA-Z]+)', 1)
ORDER BY cnt DESC
LIMIT 20
```

---

## 四、好友与群组

### 4.1 好友列表获取日志

```sql
lixiaolu02 and handlerGetUserList | SELECT * ORDER BY __time__ DESC LIMIT 50
```

### 4.2 好友列表数据流排查

按时间顺序排查好友列表获取流程：

**第一步：初始数据**

```sql
lixiaolu02 and handlerGetUserList and "逆向返回" | SELECT message, __time__
ORDER BY __time__ DESC LIMIT 10
```

**第二步：分页请求**

```sql
lixiaolu02 and fetchRoomMembers | SELECT message, __time__
ORDER BY __time__ DESC LIMIT 20
```

**第三步：数据分类**

```sql
lixiaolu02 and "群总数" | SELECT message, __time__
ORDER BY __time__ DESC LIMIT 10
```

**第四步：发送前端**

```sql
lixiaolu02 and handleSendFriendToFront | SELECT message, __time__
ORDER BY __time__ DESC LIMIT 10
```

### 4.3 群成员同步日志

```sql
lixiaolu02 and (chatroomMember or 群成员) | SELECT * ORDER BY __time__ DESC LIMIT 50
```

### 4.4 数据同步错误

```sql
lixiaolu02 and (friendList or chatroomList or 同步) and error | SELECT * ORDER BY __time__ DESC LIMIT 50
```

### 4.5 WebSocket 发送前端

```sql
lixiaolu02 and "发送前端WS消息" | SELECT * ORDER BY __time__ DESC LIMIT 50
```

---

## 五、错误排查

### 5.1 所有错误日志

```sql
level:error | SELECT * ORDER BY __time__ DESC LIMIT 100
```

### 5.2 某用户错误日志

```sql
lixiaolu02 and (error or Error or codeError) | SELECT * ORDER BY __time__ DESC LIMIT 100
```

### 5.3 错误类型统计

```sql
level:error | SELECT
    SUBSTR(message, 1, 100) AS error_type,
    COUNT(*) AS cnt
GROUP BY SUBSTR(message, 1, 100)
ORDER BY cnt DESC
LIMIT 20
```

### 5.4 错误率趋势

```sql
* | SELECT
    DATE_FORMAT(FROM_UNIXTIME(__time__), '%Y-%m-%d %H:00') AS hour,
    COUNT(*) AS total,
    SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) AS errors,
    ROUND(SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) AS error_rate
GROUP BY DATE_FORMAT(FROM_UNIXTIME(__time__), '%Y-%m-%d %H:00')
ORDER BY hour
```

### 5.5 错误用户排名

```sql
level:error | SELECT
    REGEXP_EXTRACT(message, '\[([^\]]+)\]', 1) AS username,
    COUNT(*) AS error_count
GROUP BY REGEXP_EXTRACT(message, '\[([^\]]+)\]', 1)
ORDER BY error_count DESC
LIMIT 20
```

### 5.6 特定错误搜索

```sql
-- IPC 错误
lixiaolu02 and ipc and error | SELECT * ORDER BY __time__ DESC LIMIT 50

-- MQTT 错误
lixiaolu02 and mqtt and error | SELECT * ORDER BY __time__ DESC LIMIT 50

-- WebSocket 错误
lixiaolu02 and (websocket or ws) and error | SELECT * ORDER BY __time__ DESC LIMIT 50
```

---

## 六、通信模块

### 6.1 MQTT 连接日志

```sql
lixiaolu02 and mqtt and (connect or 连接) | SELECT * ORDER BY __time__ DESC LIMIT 50
```

### 6.2 MQTT 断连日志

```sql
lixiaolu02 and mqtt and (disconnect or 断开 or 断连) | SELECT * ORDER BY __time__ DESC LIMIT 50
```

### 6.3 IPC 通信日志

```sql
lixiaolu02 and (ipc or 逆向) | SELECT * ORDER BY __time__ DESC LIMIT 50
```

### 6.4 IPC 接收消息

```sql
lixiaolu02 and "接收逆向" | SELECT * ORDER BY __time__ DESC LIMIT 50
```

### 6.5 WebSocket 日志

```sql
lixiaolu02 and (websocket or ws or frontServer) | SELECT * ORDER BY __time__ DESC LIMIT 50
```

### 6.6 通信错误汇总

```sql
(mqtt or ipc or websocket or 逆向) and error | SELECT
    CASE
        WHEN message LIKE '%mqtt%' THEN 'MQTT'
        WHEN message LIKE '%ipc%' OR message LIKE '%逆向%' THEN 'IPC'
        WHEN message LIKE '%websocket%' OR message LIKE '%ws%' THEN 'WebSocket'
        ELSE 'Other'
    END AS module,
    COUNT(*) AS error_count
GROUP BY
    CASE
        WHEN message LIKE '%mqtt%' THEN 'MQTT'
        WHEN message LIKE '%ipc%' OR message LIKE '%逆向%' THEN 'IPC'
        WHEN message LIKE '%websocket%' OR message LIKE '%ws%' THEN 'WebSocket'
        ELSE 'Other'
    END
ORDER BY error_count DESC
```

---

## 七、性能监控

### 7.1 日志量趋势

```sql
* | SELECT
    DATE_FORMAT(FROM_UNIXTIME(__time__), '%Y-%m-%d %H:00') AS hour,
    COUNT(*) AS log_count
GROUP BY DATE_FORMAT(FROM_UNIXTIME(__time__), '%Y-%m-%d %H:00')
ORDER BY hour
```

### 7.2 日志级别分布

```sql
* | SELECT
    level,
    COUNT(*) AS cnt,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) AS percentage
GROUP BY level
ORDER BY cnt DESC
```

### 7.3 高频日志内容

```sql
* | SELECT
    SUBSTR(message, 1, 80) AS log_pattern,
    COUNT(*) AS cnt
GROUP BY SUBSTR(message, 1, 80)
ORDER BY cnt DESC
LIMIT 20
```

### 7.4 来源 IP 分布

```sql
* | SELECT
    __source__,
    COUNT(*) AS log_count
GROUP BY __source__
ORDER BY log_count DESC
LIMIT 20
```

---

## 八、运维监控

### 8.1 在线用户数

```sql
* | SELECT
    COUNT(DISTINCT REGEXP_EXTRACT(message, '\[([^\]]+)\]', 1)) AS online_users
```

### 8.2 版本分布

```sql
* | SELECT
    REGEXP_EXTRACT(message, '\[(\d+\.\d+\.\d+-[^\]]+)\]', 1) AS version,
    COUNT(*) AS cnt,
    COUNT(DISTINCT REGEXP_EXTRACT(message, '\[([^\]]+)\]', 1)) AS user_count
GROUP BY REGEXP_EXTRACT(message, '\[(\d+\.\d+\.\d+-[^\]]+)\]', 1)
ORDER BY cnt DESC
```

### 8.3 微信号数量分布

```sql
* | SELECT
    REGEXP_EXTRACT(message, '号数量:\s*(\d+)', 1) AS wx_count,
    COUNT(DISTINCT REGEXP_EXTRACT(message, '\[([^\]]+)\]', 1)) AS user_count
GROUP BY REGEXP_EXTRACT(message, '号数量:\s*(\d+)', 1)
ORDER BY wx_count
```

### 8.4 异常断连检测

```sql
(disconnect or 断开 or offline or 离线) | SELECT
    DATE_FORMAT(FROM_UNIXTIME(__time__), '%Y-%m-%d %H:00') AS hour,
    COUNT(*) AS disconnect_count
GROUP BY DATE_FORMAT(FROM_UNIXTIME(__time__), '%Y-%m-%d %H:00')
HAVING COUNT(*) > 10
ORDER BY hour
```

### 8.5 服务健康检查

```sql
-- 最近10分钟是否有日志
* | SELECT
    COUNT(*) AS recent_logs,
    CASE WHEN COUNT(*) > 0 THEN 'HEALTHY' ELSE 'UNHEALTHY' END AS status
```

---

## 九、问题排查流程

### 9.1 好友列表空白排查

按顺序执行以下查询：

```sql
-- 1. 检查初始数据
用户名 and handlerGetUserList | SELECT message ORDER BY __time__ DESC LIMIT 5

-- 2. 检查分页请求
用户名 and fetchRoomMembers | SELECT message ORDER BY __time__ DESC LIMIT 5

-- 3. 检查数据分类
用户名 and "群总数" | SELECT message ORDER BY __time__ DESC LIMIT 5

-- 4. 检查发送状态
用户名 and handleSendFriendToFront | SELECT message ORDER BY __time__ DESC LIMIT 5

-- 5. 检查错误日志
用户名 and error | SELECT message ORDER BY __time__ DESC LIMIT 10
```

### 9.2 消息发送失败排查

```sql
-- 1. 查看发送任务
用户名 and sendmsg | SELECT message ORDER BY __time__ DESC LIMIT 10

-- 2. 查看任务结果
用户名 and (sendmsgresult or response) | SELECT message ORDER BY __time__ DESC LIMIT 10

-- 3. 查看错误信息
用户名 and sendmsg and error | SELECT message ORDER BY __time__ DESC LIMIT 10
```

### 9.3 登录问题排查

```sql
-- 1. 查看登录请求
用户名 and login | SELECT message ORDER BY __time__ DESC LIMIT 10

-- 2. 查看 MQTT 连接
用户名 and mqtt and connect | SELECT message ORDER BY __time__ DESC LIMIT 10

-- 3. 查看错误
用户名 and (login or mqtt) and error | SELECT message ORDER BY __time__ DESC LIMIT 10
```

---

## 十、告警查询模板

### 10.1 错误率监控

```sql
* | SELECT
    ROUND(SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) AS error_rate
```

告警条件：`error_rate > 5`

### 10.2 错误数量监控

```sql
level:error | SELECT COUNT(*) AS error_count
```

告警条件：`error_count > 100`

### 10.3 MQTT 断连监控

```sql
mqtt and (disconnect or 断开) | SELECT COUNT(*) AS disconnect_count
```

告警条件：`disconnect_count > 10`

### 10.4 日志断流监控

```sql
* | SELECT COUNT(*) AS log_count
```

告警条件：`log_count < 10`（10分钟内日志少于10条）

---

## 十一、一行命令速查

| 场景 | 查询 |
|-----|-----|
| 某用户所有日志 | `用户名 \| SELECT * ORDER BY __time__ DESC LIMIT 100` |
| 某用户错误日志 | `用户名 and level:error \| SELECT * ORDER BY __time__ DESC LIMIT 50` |
| 错误率统计 | `* \| SELECT ROUND(SUM(CASE WHEN level='error' THEN 1 ELSE 0 END)*100.0/COUNT(*),2) AS error_rate` |
| 活跃用户数 | `* \| SELECT COUNT(DISTINCT REGEXP_EXTRACT(message, '\[([^\]]+)\]', 1))` |
| 日志量趋势 | `* \| SELECT DATE_FORMAT(FROM_UNIXTIME(__time__),'%H:00') AS hour, COUNT(*) GROUP BY 1 ORDER BY 1` |
| 错误类型 TOP10 | `level:error \| SELECT SUBSTR(message,1,80),COUNT(*) AS cnt GROUP BY 1 ORDER BY cnt DESC LIMIT 10` |

---

## 十二、下一步

掌握项目实战模板后，建议学习：

1. [12-常见问题与解决方案.md](./12-常见问题与解决方案.md) - 问题排查
2. [14-速查手册.md](./14-速查手册.md) - 语法速查
3. [13-与本地日志对比.md](./13-与本地日志对比.md) - 本地日志配合
