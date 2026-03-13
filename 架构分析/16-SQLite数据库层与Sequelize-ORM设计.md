# 16 — SQLite 数据库层与 Sequelize ORM 设计

> **文档定位**：深入分析 `galaxy-client` 的本地数据库设计，包括表结构、ORM 映射、  
> 三层数据访问架构（entity → dao-model → dao-service），以及内存模型的混合使用。  
> SQLite 承担**结构化关系数据**的持久化，与 `electron-store`（简单 KV）形成互补。

---

## 1. 技术选型

### 1.1 SQLite 选型原因

| 对比维度 | SQLite | LevelDB | IndexedDB | electron-store |
|---------|--------|---------|-----------|----------------|
| 查询能力 | SQL 完整支持 | KV 查询 | 索引查询 | KV 查询 |
| 关系模型 | 支持 | 不支持 | 有限 | 不支持 |
| 嵌入式 | ✅ | ✅ | ✅ | ✅ |
| 跨进程访问 | ✅（文件锁） | ❌ | ❌（渲染进程） | ✅ |
| ORM 支持 | Sequelize | ❌ | ❌ | ❌ |
| 适用场景 | 好友/群/会话等关系数据 | 缓存 | 浏览器端 | 配置项 |

### 1.2 Sequelize 版本

```json
// package.json
"sequelize": "^7.0.0-alpha.2"
```

使用 alpha 版 Sequelize 7，支持更现代的 API。配合 `sqlite3` 驱动。

### 1.3 职责边界

| 存储 | 数据类型 | 示例 |
|------|---------|------|
| SQLite | 结构化关系数据 | 好友列表、群信息、群成员、外部联系人、任务记录 |
| electron-store | 简单配置/状态 | 用户ID、窗口状态、灰度标记、设备ID |
| 内存 (Map) | 高频读写的热数据 | 群信息缓存、群成员缓存 |

---

## 2. 数据库文件与初始化

### 2.1 存储位置

```javascript
// galaxy-client/src/sqlite/entities/index.js
const DB_PATH = path.resolve(app.getPath('userData'), './sqlite.db');
```

`app.getPath('userData')` 在 Windows 上通常为：
```
C:\Users\{用户名}\AppData\Roaming\{应用名}\sqlite.db
```

### 2.2 初始化流程

**文件**：`galaxy-client/src/sqlite/entities/index.js`

```javascript
// 1. 检查数据库文件是否存在
let flag = fs.existsSync(DB_PATH);
if (!flag) {
    fs.writeFileSync(DB_PATH, '');  // 创建空文件
}

// 2. 创建 Sequelize 实例
const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: DB_PATH,
    dialectOptions: {
        dateStrings: true,
        typeCast: true,
    },
    query: { raw: true },        // 默认返回原始数据（非 Model 实例）
    benchmark: true,              // 开启 SQL 执行计时
    logging(msg, timing) {
        if (timing > 3000) {      // 仅记录超过 3 秒的慢查询
            logUtil.customLog(`sequlizeTiming: ${timing}, SQL: ${msg}`);
            reportLog({ name: 'SQL_EXECUTION_TIME', timeCost: timing, sql: msg });
        }
    }
});

// 3. 读取 schema.sql 建表
let sql = fs.readFileSync(CREATE_SQL_FILEPATH).toString().replace('\n', '');
let sqlArr = sql.split(';');
createTb(sqlArr, sequelize).then(() => runMigrations(sequelize));

// 4. 初始化模型
module.exports = initModels(sequelize);
module.exports.sequelize = sequelize;
```

关键设计：
- **不使用 `sequelize.sync()`**：完全依赖 `schema.sql` 手动建表
- **`query.raw = true`**：默认查询返回纯 JSON 对象，减少 Sequelize 模型实例的开销
- **慢查询监控**：超过 3 秒的查询自动上报到 Habo

### 2.3 数据库迁移

```javascript
const DB_MIGRATIONS = [
    `ALTER TABLE wk_external_users ADD COLUMN alias VARCHAR(128)`,
];

async function runMigrations(seq) {
    for (const migrationSql of DB_MIGRATIONS) {
        try {
            await seq.query(migrationSql);
        } catch (e) {
            if (!e.message?.includes('duplicate column')) {
                log.warn('[migration] warn:', migrationSql, e.message);
            }
        }
    }
}
```

迁移策略：
- 启动时执行 `ALTER TABLE` 语句
- 列已存在时忽略 `duplicate column` 错误
- 简单但有效，适合桌面应用的单库场景

---

## 3. 模型聚合初始化

**文件**：`galaxy-client/src/sqlite/entities/init-models.js`

```javascript
function initModels(sequelize) {
  var chatroomInfo = _chatroomInfo(sequelize, DataTypes);
  var chatroomMemberInfo = _chatroomMemberInfo(sequelize, DataTypes);
  var conversation = _conversation(sequelize, DataTypes);
  var conversationMember = _conversationMember(sequelize, DataTypes);
  var corp = _corp(sequelize, DataTypes);
  var externalUser = _externalUser(sequelize, DataTypes);
  var externalUserRelation = _externalUserRelation(sequelize, DataTypes);
  var friend = _friend(sequelize, DataTypes);
  var friendRelation = _friendRelation(sequelize, DataTypes);
  var roomMembersExternal = _roomMembersExternal(sequelize, DataTypes);
  var roomMembersUser = _roomMembersUser(sequelize, DataTypes);
  var taskInfo = _taskInfo(sequelize, DataTypes);
  var wkConversations = _wkConversations(sequelize, DataTypes);
  var wkExternalUsers = _wkExternalUsers(sequelize, DataTypes);
  var wkCrops = _wkCrops(sequelize, DataTypes);

  return { chatroomInfo, chatroomMemberInfo, conversation, ... };
}
```

共 **15 个模型**，统一通过 `initModels` 注册到 Sequelize 实例。

---

## 4. 完整表结构

### 4.1 微信好友相关

#### friend — 好友基本信息

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK, autoIncrement | 自增主键 |
| username | VARCHAR(128) | NOT NULL, UNIQUE | 微信 ID（唯一标识） |
| alias | VARCHAR(255) | | 微信号（用户自设） |
| city | VARCHAR(255) | | 城市 |
| con_remark | VARCHAR(255) | | 备注名 |
| ext | VARCHAR(255) | | 扩展信息 |
| head_url | VARCHAR(255) | | 头像 URL |
| nickname | VARCHAR(128) | | 昵称 |
| province | VARCHAR(255) | | 省份 |
| sex | TINYINT | | 性别 |
| create_time | TIMESTAMP | NOT NULL, DEFAULT NOW | 创建时间 |
| update_time | TIMESTAMP | DEFAULT NOW | 更新时间 |

索引：`friend_wxid_index` UNIQUE ON (username)

#### friend_relation — 好友关系

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK | 自增主键 |
| friend_remark | VARCHAR(128) | | 好友备注 |
| friend_wxid | VARCHAR(128) | NOT NULL | 好友微信 ID |
| owner_wxid | VARCHAR(128) | NOT NULL | 所属机器人微信 ID |
| report_flag | TINYINT | NOT NULL | 是否已上报（0/1） |
| friend_record_time | INTEGER | NOT NULL | 好友记录时间 |
| create_time | TIMESTAMP | NOT NULL | 创建时间 |
| update_time | TIMESTAMP | | 更新时间 |

唯一约束：UNIQUE (owner_wxid, friend_wxid)

### 4.2 群聊相关

#### chatroom_info — 群基本信息

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK | 自增主键 |
| chatroom | VARCHAR(128) | NOT NULL, UNIQUE | 群 ID |
| nickname | VARCHAR(128) | | 群名称 |
| headimg | VARCHAR(500) | | 群头像 |
| notice | VARCHAR(2048) | | 群公告 |
| leader_wxid | VARCHAR(50) | | 群主微信 ID |
| admin_list | VARCHAR(120) | | 管理员列表 |
| create_time | TIMESTAMP | NOT NULL | 创建时间 |
| update_time | TIMESTAMP | | 更新时间 |

#### chatroom_member_info — 群成员信息

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK | 自增主键 |
| chatroom | VARCHAR(128) | NOT NULL | 群 ID |
| headimg | VARCHAR(500) | | 头像 |
| nickname | VARCHAR(128) | | 昵称 |
| alias | VARCHAR(255) | | 微信号 |
| username | VARCHAR(128) | NOT NULL | 微信 ID |
| own_robot | VARCHAR(128) | NOT NULL | 所属机器人 |
| sex | TINYINT | | 性别 |
| remark | VARCHAR(255) | | 备注 |
| create_time | TIMESTAMP | NOT NULL | 创建时间 |
| update_time | TIMESTAMP | | 更新时间 |

唯一约束：UNIQUE (chatroom, own_robot, username)

### 4.3 任务信息

#### task_info — 任务记录

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK | 自增主键 |
| username | VARCHAR(128) | NOT NULL | 微信 ID |
| task_id | VARCHAR(128) | NOT NULL | 任务 ID |
| server_task | TEXT | | 服务端任务 JSON |
| status | TINYINT(3) | NOT NULL, DEFAULT 2 | 任务状态 |
| type | INTEGER | NOT NULL | 任务类型 |
| reason | VARCHAR(1024) | NOT NULL, DEFAULT '' | 失败原因 |
| source_desc | VARCHAR(32) | DEFAULT '' | 来源描述 |
| received_time | TIMESTAMP | NOT NULL | 接收时间 |
| report_time | TIMESTAMP | NOT NULL | 上报时间 |
| create_time | TIMESTAMP | NOT NULL | 创建时间 |
| update_time | TIMESTAMP | | 更新时间 |

注意：`schema.sql` 中每次启动会 `DROP TABLE IF EXISTS task_info` 后重建，即任务记录不跨重启保留。

### 4.4 企微相关

#### wk_external_users — 企微外部联系人

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK | 自增主键 |
| account_id | VARCHAR(128) | NOT NULL | 登录账号 ID |
| wxid | VARCHAR(128) | NOT NULL | 好友 ID |
| alias | VARCHAR(128) | | 微信号（迁移新增） |
| sex | TINYINT | | 性别 |
| nickname | VARCHAR(255) | | 昵称 |
| remark | VARCHAR(255) | | 备注 |
| headimg | VARCHAR(255) | | 小头像 |
| bigheadimg | VARCHAR(255) | | 大头像 |
| corp_id | VARCHAR(128) | | 企业 ID |
| city | VARCHAR(128) | | 城市 |
| country | VARCHAR(128) | | 国家 |
| province | VARCHAR(128) | | 省份 |
| add_customer_time | INTEGER | | 添加时间 |
| report_flag | TINYINT | NOT NULL, DEFAULT 0 | 是否已上报 |

#### wk_conversations — 企微会话

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK | 自增主键 |
| account_id | VARCHAR(128) | NOT NULL | 账号 ID |
| wxid | VARCHAR(128) | NOT NULL | 会话 ID |
| ownerwxid | VARCHAR(128) | | 所有者 |
| nickname | VARCHAR(255) | | 会话名称 |
| headimg | VARCHAR(255) | | 头像 |
| simplelist | VARCHAR(255) | | 简要成员列表 |
| number | INTEGER | | 成员数量 |
| users | VARCHAR(255) | | 用户列表 |
| create_time | INTEGER | | 创建时间 |

#### wk_corps — 企微企业

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | INTEGER | PK | 自增主键 |
| account_id | VARCHAR(128) | | 账号 ID |
| admin_vid | VARCHAR(128) | | 管理员 VID |
| admin_name | VARCHAR(255) | | 管理员名称 |
| auth_type | INTEGER | | 认证类型 |
| claim_name | VARCHAR(255) | | 认证名称 |
| corpany_id | VARCHAR(128) | | 公司 ID |
| name | VARCHAR(255) | | 企业名称 |
| create_time | TIMESTAMP | | 创建时间 |

### 4.5 其他表

#### conversation / conversation_member — 通用会话

用于存储通用会话信息和会话成员，主要服务于企微场景。

#### corp — 企业信息

存储企业基本信息，通过 `admin_vid` 唯一标识。

#### external_user / external_user_relation — 外部用户

存储外部用户（非企微好友）信息及其关系。

#### room_members_external / room_members_user — 群成员（企微）

存储企微群聊中的外部成员和内部成员。

---

## 5. Entity 定义模式

**文件**：`galaxy-client/src/sqlite/entities/friend.js`（示例）

```javascript
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('friend', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: true,
      primaryKey: true
    },
    username: {
      type: DataTypes.STRING(128),
      allowNull: false,
      unique: true
    },
    conRemark: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'con_remark'       // JS 驼峰 → DB 下划线
    },
    // ...
  }, {
    sequelize,
    tableName: 'friend',
    timestamps: false,           // 不使用 Sequelize 自动时间戳
    indexes: [{
      name: "friend_wxid_index",
      unique: true,
      fields: [{ name: "username" }],
    }]
  });
};
```

通用特征：
- 使用工厂函数模式：`module.exports = function(sequelize, DataTypes) {...}`
- `timestamps: false`：不自动管理 `createdAt`/`updatedAt`（手动管理）
- 字段映射：JS 驼峰命名 → DB 下划线命名（通过 `field` 属性）
- 唯一索引在 `indexes` 中定义

---

## 6. 三层数据访问架构

```
┌─────────────────────────────────────────┐
│  业务逻辑层 (convert-service, timer, etc)│
│           │                             │
│           ▼                             │
│  ┌───────────────────┐                  │
│  │ dao-service        │ ← 业务查询封装    │
│  │ (friendService,   │                  │
│  │  chatroomInfoSvc) │                  │
│  └────────┬──────────┘                  │
│           │                             │
│           ▼                             │
│  ┌───────────────────┐                  │
│  │ dao-model          │ ← 数据访问层     │
│  │ (friendModel,     │                  │
│  │  chatroomInfoModel)│                  │
│  └────────┬──────────┘                  │
│           │                             │
│           ▼                             │
│  ┌───────────────────┐                  │
│  │ entities           │ ← ORM 模型定义   │
│  │ (Sequelize Model) │                  │
│  └────────┬──────────┘                  │
│           │                             │
│           ▼                             │
│     SQLite 数据库文件                    │
└─────────────────────────────────────────┘
```

### 6.1 dao-model — 数据访问层

#### 模式 A：直接使用 Sequelize

```javascript
// friendModel.js
const {friend} = require('../../../sqlite/entities/index');

const FriendModel = {
    save(entity) {
        if (entity.id) {
            return friend.update(entity, { where: { id: entity.id } });
        }
        return friend.create(entity);
    },
    findFriendByUsername(wxid) {
        return friend.findOne({ where: { username: wxid } });
    },
    deleteFriendById(id) {
        return friend.destroy({ where: { id: id } });
    },
    async saveAll(entitys) {
        const insertList = [];
        const promiseList = [];
        for (let entity of entitys) {
            if (entity.id) {
                promiseList.push(friend.update(entity, { where: { id: entity.id } }));
            } else {
                insertList.push(entity);
            }
        }
        await Promise.all(promiseList);
        if (insertList.length > 0) {
            await friend.bulkCreate(insertList);
        }
        return entitys.length;
    },
};
```

特点：
- 有 ID 则 `update`，无 ID 则 `create`
- 批量保存：更新并发执行（`Promise.all`），新增批量插入（`bulkCreate`）

#### 模式 B：内存模型 + 可选持久化

```javascript
// chatroomInfoModel.js
class ChatroomInfoMemory {
    constructor() {
        this.chatroomInfoMap = new Map();
        // 定时持久化到 DB（当前已注释）
        // cron.schedule('*/10 * * * *', () => { this.saveMapDataToDB(); });
    }

    save(entity) {
        if (this.chatroomInfoMap.has(entity.chatroom)) {
            const currentData = this.chatroomInfoMap.get(entity.chatroom);
            this.chatroomInfoMap.set(entity.chatroom, { ...currentData, ...entity });
        } else {
            this.chatroomInfoMap.set(entity.chatroom, entity);
        }
        return entity;
    }

    findByChatroom(chatroom) {
        return this.chatroomInfoMap.get(chatroom) || null;
    }

    insertOrUpdateIfUniqueConflict(leaderWxid, announcement, nickname, chatroom, headimg, adminList) {
        const updateInfo = this.filterEmptyProperties({ leaderWxid, notice: announcement, ... });
        if (this.chatroomInfoMap.has(chatroom)) {
            const currentData = this.chatroomInfoMap.get(chatroom);
            this.chatroomInfoMap.set(chatroom, { ...currentData, ...updateInfo });
        } else {
            this.chatroomInfoMap.set(chatroom, updateInfo);
        }
    }
}
module.exports = new ChatroomInfoMemory();  // 单例
```

特点：
- 使用 `Map` 存储数据，**纯内存操作**
- `loadDataToMap()` 和 `saveMapDataToDB()` 已注释，当前不持久化
- 适用于高频读写场景（群信息频繁变更）
- **应用重启后数据丢失**

受影响的表：
- `chatroom_info` → 使用 `ChatroomInfoMemory`
- `chatroom_member_info` → 使用 `ChatroomMemberInfoMemory`

#### 模式 C：原生 SQL

某些复杂查询直接使用原生 SQL：

```javascript
// externalUserModel.js
async insertOrUpdateIfUniqueConflict(wxid, nickname, sex, headimg, ...) {
    await sequelize.query(
        `INSERT INTO wk_external_users (...) VALUES (...) 
         ON CONFLICT (wxid) DO UPDATE SET ...`,
        { type: QueryTypes.INSERT }
    );
}

// taskinfoModel.js
async findByTaskIdAndChatroom(taskId, chatroom) {
    return sequelize.query(
        `SELECT * FROM task_info WHERE task_id = :taskId 
         AND json_extract(server_task, '$.chatroom') = :chatroom`,
        { replacements: { taskId, chatroom }, type: QueryTypes.SELECT }
    );
}

// friendRelationModel.js
async findDistinctFriendWxidByOwnerWxid(ownerWxid) {
    return sequelize.query(
        `SELECT DISTINCT * FROM friend_relation WHERE owner_wxid = :ownerWxid`,
        { replacements: { ownerWxid }, type: QueryTypes.SELECT }
    );
}
```

使用原生 SQL 的场景：
- SQLite 的 `ON CONFLICT ... DO UPDATE`（Upsert）
- `json_extract()` 函数查询 JSON 字段
- `SELECT DISTINCT` 去重查询

### 6.2 dao-service — 业务查询封装

```javascript
// friendService.js
const FriendService = {
    async findByFriendWx(wxid) {
        const result = await FriendModel.findFriendByUsername(wxid);
        return result ?? {};  // 空值保护
    },
    async save(friend) {
        return FriendModel.save(friend);
    },
    async saveOrUpdate(friendList) {
        return FriendModel.saveAll(friendList);
    },
    async deleteFriendById(id) {
        return FriendModel.deleteFriendById(id);
    },
};
```

Service 层的职责：
- 对 Model 层的简单封装
- 空值保护（`?? {}`）
- 业务组合（先查后写等）

---

## 7. 完整文件清单

### 7.1 entities（15 个模型）

| 文件 | 表名 | 主键 | 唯一约束 |
|------|------|------|----------|
| `friend.js` | friend | id | username |
| `friend_relation.js` | friend_relation | id | (owner_wxid, friend_wxid) |
| `chatroom_info.js` | chatroom_info | id | chatroom |
| `chatroom_member_info.js` | chatroom_member_info | id | (chatroom, own_robot, username) |
| `task_info.js` | task_info | id | — |
| `conversation.js` | conversation | id | conversation_id |
| `conversation_member.js` | conversation_member | id | (conversation_id, user_id) |
| `corp.js` | corp | id | admin_vid |
| `external_user.js` | external_user | id | wxid |
| `external_user_relation.js` | external_user_relation | id | (owner_wxid, friend_wxid) |
| `room_members_external.js` | room_members_external | id | wxid |
| `room_members_user.js` | room_members_user | id | wxid |
| `wk_conversations.js` | wk_conversations | id | wxid |
| `wk_external_users.js` | wk_external_users | id | wxid |
| `wk_crops.js` | wk_corps | id | admin_vid |

### 7.2 dao-model（15 个模型）

| 文件 | 数据源 | 说明 |
|------|--------|------|
| `friendModel.js` | Sequelize ORM | 好友 CRUD |
| `friendRelationModel.js` | Sequelize ORM + 原生 SQL | 好友关系，含 DISTINCT 查询 |
| `chatroomInfoModel.js` | **内存 Map** | 群信息（高频读写） |
| `chatrooMemberInfoModel.js` | **内存 Map** | 群成员（高频读写，注意拼写） |
| `taskinfoModel.js` | Sequelize ORM + 原生 SQL | 任务记录，含 JSON 查询 |
| `workwx/wkExternalUsersModel.js` | Sequelize ORM + 原生 SQL | 企微外部用户，含 Upsert |
| `workwx/wkCropsModel.js` | Sequelize ORM | 企微企业 |
| `workwx/wkConversationModel.js` | Sequelize ORM | 企微会话 |
| `workwx/roomMembersUserModel.js` | Sequelize ORM + 原生 SQL | 企微群成员（内部） |
| `workwx/roomMembersExternalModel.js` | Sequelize ORM + 原生 SQL | 企微群成员（外部） |
| `workwx/externalUserModel.js` | Sequelize ORM + 原生 SQL | 外部用户 |
| `workwx/externalUserRelationModel.js` | Sequelize ORM | 外部用户关系 |
| `workwx/cropsModel.js` | Sequelize ORM | 企业 |
| `workwx/conversationModel.js` | Sequelize ORM + 原生 SQL | 会话，含 Upsert |
| `workwx/conversationMemberModel.js` | Sequelize ORM + 原生 SQL | 会话成员 |

### 7.3 dao-service（15 个服务）

| 文件 | 说明 |
|------|------|
| `friendService.js` | 好友查询/保存 |
| `friendRelationService.js` | 好友关系查询 |
| `chatroomInfoService.js` | 群信息 insertAndUpdate |
| `chatroomMemberinfoService.js` | 群成员查询/保存 |
| `taskinfoService.js` | 任务记录查询 |
| `workwx/wkExternalUserService.js` | 企微外部用户 |
| `workwx/wkCropsService.js` | 企微企业 |
| `workwx/wkConversationService.js` | 企微会话 |
| `workwx/roomMembersUserService.js` | 企微群成员（内部） |
| `workwx/roomMembersExternalService.js` | 企微群成员（外部） |
| `workwx/externalUserService.js` | 外部用户 |
| `workwx/externalUserRelationService.js` | 外部用户关系 |
| `workwx/cropsService.js` | 企业 |
| `workwx/conversationService.js` | 会话 |
| `workwx/conversationMemberService.js` | 会话成员 |

---

## 8. 常用查询模式

### 8.1 Upsert（有则更新、无则插入）

#### 方式 A：Model 层先查后写

```javascript
// chatroomInfoService.js
insertAndUpdate(chatroomInfoPO) {
    const old = ChatroomInfoModel.findByChatroom(chatroomInfoPO.chatroom);
    if (!old) {
        return ChatroomInfoModel.save(chatroomInfoPO);
    } else {
        chatroomInfoPO.id = old.id;
        return ChatroomInfoModel.save(chatroomInfoPO);
    }
}
```

#### 方式 B：原生 SQL ON CONFLICT

```javascript
// wkExternalUsersModel.js
await sequelize.query(
    `INSERT INTO wk_external_users (wxid, nickname, ...) 
     VALUES (:wxid, :nickname, ...)
     ON CONFLICT (wxid) DO UPDATE SET 
         nickname = COALESCE(:nickname, wk_external_users.nickname), ...`,
    { replacements: { wxid, nickname, ... }, type: QueryTypes.INSERT }
);
```

### 8.2 批量操作

```javascript
// friendModel.js
async saveAll(entitys) {
    const insertList = [];
    const promiseList = [];
    for (let entity of entitys) {
        if (entity.id) {
            promiseList.push(friend.update(entity, { where: { id: entity.id } }));
        } else {
            insertList.push(entity);
        }
    }
    await Promise.all(promiseList);  // 更新并发执行
    if (insertList.length > 0) {
        await friend.bulkCreate(insertList);  // 新增批量插入
    }
}
```

### 8.3 JSON 字段查询

```javascript
// taskinfoModel.js
sequelize.query(
    `SELECT * FROM task_info 
     WHERE task_id = :taskId 
     AND json_extract(server_task, '$.chatroom') = :chatroom`,
    { replacements: { taskId, chatroom }, type: QueryTypes.SELECT }
);
```

利用 SQLite 的 `json_extract()` 函数从 TEXT 字段中提取 JSON 属性。

---

## 9. 性能优化

### 9.1 内存模型加速

`chatroom_info` 和 `chatroom_member_info` 使用内存 Map 替代 SQLite 查询：

| 操作 | SQLite | 内存 Map |
|------|--------|---------|
| 单条查询 | ~1-5ms | ~0.01ms |
| 全量遍历 | ~10-50ms | ~0.1ms |
| 写入 | ~2-10ms | ~0.01ms |

代价：应用重启后群信息需要重新从逆向 IPC 获取。

### 9.2 慢查询监控

```javascript
logging(msg, timing) {
    if (timing > 3000) {
        logUtil.customLog(`sequlizeTiming: ${timing}, SQL: ${msg}`);
        reportLog({ name: 'SQL_EXECUTION_TIME', timeCost: timing, sql: msg });
    }
}
```

超过 3 秒的查询自动上报到 Habo，便于排查性能问题。

### 9.3 raw 查询

```javascript
query: { raw: true }  // 全局开启
```

返回纯 JSON 对象，跳过 Sequelize 模型实例化，减少内存和 CPU 开销。

### 9.4 索引设计

| 表 | 索引 | 类型 |
|---|------|------|
| friend | username | UNIQUE |
| friend_relation | (owner_wxid, friend_wxid) | UNIQUE |
| chatroom_info | chatroom | UNIQUE |
| chatroom_member_info | (chatroom, own_robot, username) | UNIQUE |
| wk_external_users | wxid | UNIQUE |

所有唯一索引同时服务于查询加速和数据去重。

---

## 10. schema.sql 中的已知问题

### 10.1 字段定义错误

```sql
-- external_user 表
name   corpany_id varchar(128),   -- 字段名和下一个字段混在一起

-- room_members_external 表（同样问题）
name   corpany_id varchar(128),

-- room_members_user 表（同样问题）
name   corpany_id varchar(128),
```

`name` 字段的类型缺失，`corpany_id` 被错误地拼接。这可能导致这些表的 `name` 字段无法正常使用。

### 10.2 拼写错误

- `chatrooMemberInfoModel.js`：文件名中 `chatroo` 应为 `chatroom`
- `avator_url`：多处使用，应为 `avatar_url`
- `corpany_id`：应为 `company_id`

### 10.3 task_info 重建

```sql
drop table if exists task_info;
create table if not exists task_info (...);
```

每次启动都会**删除并重建** `task_info` 表，意味着任务记录不跨重启保留。

---

## 11. 关键文件索引

| 文件 | 路径 | 职责 |
|------|------|------|
| 数据库初始化 | `galaxy-client/src/sqlite/entities/index.js` | Sequelize 实例创建、建表、迁移 |
| 模型聚合 | `galaxy-client/src/sqlite/entities/init-models.js` | 注册所有模型 |
| 建表 SQL | `galaxy-client/src/sqlite/schema.sql` | DDL 定义 |
| Entity 目录 | `galaxy-client/src/sqlite/entities/` | 15 个 ORM 模型 |
| dao-model 目录 | `galaxy-client/src/msg-center/business/dao-model/` | 数据访问层 |
| dao-service 目录 | `galaxy-client/src/msg-center/business/dao-service/` | 业务查询封装 |
| 内存群模型 | `galaxy-client/src/msg-center/business/dao-model/chatroomInfoModel.js` | Map 缓存 |
| 内存成员模型 | `galaxy-client/src/msg-center/business/dao-model/chatrooMemberInfoModel.js` | Map 缓存 |

---

*文档生成时间：2026-03-13 | 基于 galaxy-client 仓库实际代码分析*
