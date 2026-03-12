# 03-SQL分析语法

> 使用 SQL 对日志进行结构化分析

---

## 一、概述

### 1.1 查询与分析

SLS 查询语句格式：

```
搜索条件 | SQL 分析语句
```

| 部分 | 作用 | 执行顺序 |
|-----|-----|---------|
| 搜索条件 | 从海量日志中筛选匹配的日志 | 先执行 |
| SQL 分析语句 | 对筛选后的日志进行统计分析 | 后执行 |

### 1.2 SQL 方言

SLS 使用的 SQL 语法基于 **Presto SQL**，与标准 SQL 类似但有一些差异。

### 1.3 基本结构

```sql
搜索条件 | SELECT 字段
                FROM log  -- 可省略
                WHERE 条件
                GROUP BY 分组字段
                HAVING 聚合条件
                ORDER BY 排序字段
                LIMIT 数量
```

---

## 二、SELECT 子句

### 2.1 选择所有字段

```sql
* | SELECT *
```

### 2.2 选择特定字段

```sql
* | SELECT message, __time__
```

```sql
* | SELECT message, level, __source__
```

### 2.3 使用别名

```sql
* | SELECT message AS msg, __time__ AS log_time
```

### 2.4 计算字段

```sql
* | SELECT message, __time__ + 3600 AS future_time
```

```sql
* | SELECT message, __time__ - 28800 AS beijing_time
```

### 2.5 常量

```sql
* | SELECT message, 'galaxy-client' AS app_name
```

### 2.6 DISTINCT 去重

```sql
* | SELECT DISTINCT level
```

```sql
* | SELECT DISTINCT __source__
```

---

## 三、WHERE 子句

### 3.1 等于

```sql
* | SELECT * WHERE level = 'error'
```

### 3.2 不等于

```sql
* | SELECT * WHERE level != 'info'
```

```sql
* | SELECT * WHERE level <> 'info'
```

### 3.3 比较运算

```sql
* | SELECT * WHERE __time__ > 1706000000
```

```sql
* | SELECT * WHERE __time__ >= 1706000000 AND __time__ < 1706100000
```

### 3.4 IN 列表

```sql
* | SELECT * WHERE level IN ('error', 'warn')
```

### 3.5 NOT IN

```sql
* | SELECT * WHERE level NOT IN ('debug', 'info')
```

### 3.6 BETWEEN 范围

```sql
* | SELECT * WHERE __time__ BETWEEN 1706000000 AND 1706100000
```

### 3.7 IS NULL / IS NOT NULL

```sql
* | SELECT * WHERE errorKey IS NOT NULL
```

```sql
* | SELECT * WHERE errorKey IS NULL
```

### 3.8 组合条件

```sql
* | SELECT * WHERE level = 'error' AND __time__ > 1706000000
```

```sql
* | SELECT * WHERE level = 'error' OR level = 'warn'
```

```sql
* | SELECT * WHERE (level = 'error' OR level = 'warn') AND __time__ > 1706000000
```

---

## 四、LIKE 模糊匹配

### 4.1 基本语法

```sql
* | SELECT * WHERE message LIKE '%关键词%'
```

| 通配符 | 含义 |
|-------|-----|
| `%` | 匹配任意多个字符 |
| `_` | 匹配单个字符 |

### 4.2 包含匹配

```sql
* | SELECT * WHERE message LIKE '%error%'
```

```sql
* | SELECT * WHERE message LIKE '%handleSendFriendToFront%'
```

### 4.3 前缀匹配

```sql
* | SELECT * WHERE message LIKE 'mqtt%'
```

### 4.4 后缀匹配

```sql
* | SELECT * WHERE message LIKE '%error'
```

### 4.5 单字符匹配

```sql
* | SELECT * WHERE message LIKE 'wxid______'
```

### 4.6 NOT LIKE

```sql
* | SELECT * WHERE message NOT LIKE '%debug%'
```

### 4.7 中文匹配

```sql
* | SELECT * WHERE message LIKE '%群总数%'
```

```sql
* | SELECT * WHERE message LIKE '%无数据需要发送到前端%'
```

---

## 五、ORDER BY 排序

### 5.1 升序（ASC）

```sql
* | SELECT * ORDER BY __time__ ASC
```

### 5.2 降序（DESC）

```sql
* | SELECT * ORDER BY __time__ DESC
```

### 5.3 多字段排序

```sql
* | SELECT * ORDER BY level ASC, __time__ DESC
```

### 5.4 按聚合结果排序

```sql
* | SELECT level, COUNT(*) AS cnt GROUP BY level ORDER BY cnt DESC
```

### 5.5 NULL 值排序

```sql
* | SELECT * ORDER BY errorKey NULLS FIRST
```

```sql
* | SELECT * ORDER BY errorKey NULLS LAST
```

---

## 六、LIMIT 和 OFFSET

### 6.1 限制返回数量

```sql
* | SELECT * LIMIT 100
```

### 6.2 分页查询

```sql
-- 第一页（1-100）
* | SELECT * ORDER BY __time__ DESC LIMIT 100 OFFSET 0

-- 第二页（101-200）
* | SELECT * ORDER BY __time__ DESC LIMIT 100 OFFSET 100

-- 第三页（201-300）
* | SELECT * ORDER BY __time__ DESC LIMIT 100 OFFSET 200
```

### 6.3 默认限制

- 不指定 LIMIT 时，默认返回 100 条
- 最大返回 10000 条

---

## 七、GROUP BY 分组

### 7.1 单字段分组

```sql
* | SELECT level, COUNT(*) AS cnt GROUP BY level
```

### 7.2 多字段分组

```sql
* | SELECT level, __source__, COUNT(*) AS cnt GROUP BY level, __source__
```

### 7.3 时间分组

```sql
* | SELECT date_trunc('hour', __time__) AS hour, COUNT(*) AS cnt
    GROUP BY date_trunc('hour', __time__)
    ORDER BY hour
```

### 7.4 GROUP BY 别名

```sql
* | SELECT level AS log_level, COUNT(*) AS cnt GROUP BY log_level
```

---

## 八、HAVING 子句

过滤聚合后的结果：

### 8.1 基本用法

```sql
* | SELECT level, COUNT(*) AS cnt
    GROUP BY level
    HAVING COUNT(*) > 100
```

### 8.2 使用别名

```sql
* | SELECT level, COUNT(*) AS cnt
    GROUP BY level
    HAVING cnt > 100
```

### 8.3 多条件

```sql
* | SELECT level, COUNT(*) AS cnt
    GROUP BY level
    HAVING cnt > 10 AND cnt < 1000
```

---

## 九、聚合函数

### 9.1 计数

```sql
-- 总行数
* | SELECT COUNT(*) AS total

-- 非空值计数
* | SELECT COUNT(errorKey) AS error_count

-- 去重计数
* | SELECT COUNT(DISTINCT __source__) AS unique_sources
```

### 9.2 求和

```sql
* | SELECT SUM(duration) AS total_duration
```

### 9.3 平均值

```sql
* | SELECT AVG(duration) AS avg_duration
```

### 9.4 最大/最小值

```sql
* | SELECT MAX(__time__) AS latest, MIN(__time__) AS earliest
```

### 9.5 近似去重

```sql
-- 性能更好，适合大数据量
* | SELECT approx_distinct(__source__) AS unique_sources
```

### 9.6 百分位数

```sql
* | SELECT approx_percentile(duration, 0.5) AS p50,
           approx_percentile(duration, 0.9) AS p90,
           approx_percentile(duration, 0.99) AS p99
```

### 9.7 数组聚合

```sql
* | SELECT array_agg(DISTINCT level) AS levels
```

---

## 十、字符串函数

### 10.1 长度

```sql
* | SELECT LENGTH(message) AS msg_len, message
```

### 10.2 截取

```sql
-- SUBSTR(字符串, 起始位置, 长度)
* | SELECT SUBSTR(message, 1, 100) AS short_msg
```

### 10.3 拼接

```sql
* | SELECT CONCAT('[', level, '] ', message) AS formatted
```

```sql
-- 使用 || 操作符
* | SELECT level || ': ' || message AS formatted
```

### 10.4 替换

```sql
* | SELECT REPLACE(message, 'error', 'ERROR') AS msg
```

### 10.5 大小写转换

```sql
* | SELECT LOWER(level) AS level_lower
```

```sql
* | SELECT UPPER(level) AS level_upper
```

### 10.6 去除空白

```sql
* | SELECT TRIM(message) AS msg
```

```sql
* | SELECT LTRIM(message) AS msg  -- 左侧
* | SELECT RTRIM(message) AS msg  -- 右侧
```

### 10.7 分割

```sql
-- SPLIT(字符串, 分隔符)
* | SELECT SPLIT(message, ' ') AS parts
```

```sql
-- SPLIT_PART(字符串, 分隔符, 索引)
* | SELECT SPLIT_PART(message, ' ', 1) AS first_part
```

### 10.8 查找位置

```sql
* | SELECT STRPOS(message, 'error') AS error_pos
```

### 10.9 正则提取（简单）

```sql
* | SELECT REGEXP_EXTRACT(message, 'wxid_[a-z0-9]+') AS wxid
```

---

## 十一、时间函数

### 11.1 当前时间

```sql
* | SELECT NOW() AS current_time
```

```sql
* | SELECT CURRENT_DATE AS today
```

```sql
* | SELECT CURRENT_TIMESTAMP AS now
```

### 11.2 Unix 时间戳转换

```sql
-- 时间戳 → 日期时间
* | SELECT FROM_UNIXTIME(__time__) AS datetime
```

```sql
-- 日期时间 → 时间戳
* | SELECT TO_UNIXTIME(NOW()) AS timestamp
```

### 11.3 时间格式化

```sql
* | SELECT DATE_FORMAT(FROM_UNIXTIME(__time__), '%Y-%m-%d %H:%i:%s') AS datetime
```

常用格式：

| 格式符 | 说明 | 示例 |
|-------|-----|-----|
| `%Y` | 四位年 | 2026 |
| `%m` | 两位月 | 01 |
| `%d` | 两位日 | 27 |
| `%H` | 24小时制时 | 14 |
| `%i` | 分钟 | 30 |
| `%s` | 秒 | 45 |

### 11.4 时间截断

```sql
-- 按分钟截断
* | SELECT DATE_TRUNC('minute', __time__) AS minute, COUNT(*)
    GROUP BY DATE_TRUNC('minute', __time__)
```

可用单位：
- `second` - 秒
- `minute` - 分钟
- `hour` - 小时
- `day` - 天
- `week` - 周
- `month` - 月
- `year` - 年

### 11.5 时间加减

```sql
-- 加 1 小时
* | SELECT DATE_ADD('hour', 1, FROM_UNIXTIME(__time__)) AS plus_1h
```

```sql
-- 减 1 天
* | SELECT DATE_ADD('day', -1, FROM_UNIXTIME(__time__)) AS minus_1d
```

### 11.6 时间差

```sql
* | SELECT DATE_DIFF('hour', FROM_UNIXTIME(start_time), FROM_UNIXTIME(end_time)) AS hours
```

### 11.7 时间解析

```sql
* | SELECT DATE_PARSE('2026-01-27 14:30:00', '%Y-%m-%d %H:%i:%s') AS parsed
```

---

## 十二、类型转换

### 12.1 CAST 强制转换

```sql
* | SELECT CAST(__time__ AS VARCHAR) AS time_str
```

```sql
* | SELECT CAST(duration AS BIGINT) AS duration_int
```

常用类型：
- `VARCHAR` - 字符串
- `BIGINT` - 长整数
- `DOUBLE` - 双精度浮点
- `BOOLEAN` - 布尔
- `TIMESTAMP` - 时间戳

### 12.2 TRY_CAST 安全转换

转换失败返回 NULL，不报错：

```sql
* | SELECT TRY_CAST(duration AS BIGINT) AS duration_int
```

---

## 十三、NULL 处理

### 13.1 COALESCE

返回第一个非 NULL 值：

```sql
* | SELECT COALESCE(errorKey, 'no_error') AS error
```

```sql
* | SELECT COALESCE(duration, 0) AS duration
```

### 13.2 NULLIF

两值相等时返回 NULL：

```sql
* | SELECT NULLIF(level, 'debug') AS level
```

### 13.3 IF 函数

```sql
* | SELECT IF(level = 'error', 'ERROR', 'OTHER') AS category
```

### 13.4 IFNULL

```sql
* | SELECT IFNULL(errorKey, 'none') AS error
```

---

## 十四、条件表达式

### 14.1 CASE WHEN

```sql
* | SELECT
        CASE level
            WHEN 'error' THEN '错误'
            WHEN 'warn' THEN '警告'
            WHEN 'info' THEN '信息'
            ELSE '其他'
        END AS level_cn
```

```sql
* | SELECT
        CASE
            WHEN level = 'error' THEN 1
            WHEN level = 'warn' THEN 2
            ELSE 3
        END AS priority
```

### 14.2 嵌套 CASE

```sql
* | SELECT
        CASE
            WHEN level = 'error' THEN
                CASE
                    WHEN message LIKE '%timeout%' THEN 'timeout_error'
                    ELSE 'other_error'
                END
            ELSE 'not_error'
        END AS error_type
```

---

## 十五、数学函数

### 15.1 基本运算

```sql
* | SELECT duration / 1000.0 AS duration_seconds
```

```sql
* | SELECT duration * 2 AS double_duration
```

### 15.2 取整

```sql
* | SELECT FLOOR(duration / 1000.0) AS seconds  -- 向下取整
* | SELECT CEIL(duration / 1000.0) AS seconds   -- 向上取整
* | SELECT ROUND(duration / 1000.0, 2) AS seconds  -- 四舍五入保留2位
```

### 15.3 绝对值

```sql
* | SELECT ABS(offset) AS abs_offset
```

### 15.4 取模

```sql
* | SELECT MOD(__time__, 3600) AS seconds_in_hour
```

---

## 十六、完整查询示例

### 16.1 查询某用户最近100条日志

```sql
lixiaolu02 | SELECT * ORDER BY __time__ DESC LIMIT 100
```

### 16.2 统计各级别日志数量

```sql
* | SELECT level, COUNT(*) AS cnt GROUP BY level ORDER BY cnt DESC
```

### 16.3 按小时统计日志趋势

```sql
* | SELECT
        DATE_FORMAT(FROM_UNIXTIME(__time__), '%Y-%m-%d %H:00') AS hour,
        COUNT(*) AS cnt
    GROUP BY DATE_FORMAT(FROM_UNIXTIME(__time__), '%Y-%m-%d %H:00')
    ORDER BY hour
```

### 16.4 查询错误日志并格式化

```sql
level:error | SELECT
    DATE_FORMAT(FROM_UNIXTIME(__time__), '%Y-%m-%d %H:%i:%s') AS time,
    SUBSTR(message, 1, 200) AS short_message
    ORDER BY __time__ DESC
    LIMIT 50
```

### 16.5 统计错误率

```sql
* | SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) AS error_count,
        ROUND(SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) AS error_rate
```

### 16.6 Top 10 错误类型

```sql
level:error | SELECT
        SUBSTR(message, 1, 100) AS error_msg,
        COUNT(*) AS cnt
    GROUP BY SUBSTR(message, 1, 100)
    ORDER BY cnt DESC
    LIMIT 10
```

---

## 十七、下一步

掌握了 SQL 基础后，建议学习：

1. [04-高级查询技巧.md](./04-高级查询技巧.md) - 正则表达式、JSON 解析、窗口函数
2. [05-聚合统计分析.md](./05-聚合统计分析.md) - 更复杂的数据分析
3. [14-速查手册.md](./14-速查手册.md) - 函数快速参考
