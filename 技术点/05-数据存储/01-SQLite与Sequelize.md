# SQLite 与 Sequelize ORM

> 本地数据持久化方案

---

## 一、技术简介

### 1.1 SQLite

SQLite 是一个轻量级的嵌入式关系型数据库：

- **无需服务器**：直接读写本地文件
- **零配置**：不需要安装和管理
- **跨平台**：数据库就是一个文件
- **适用于**：桌面应用、移动应用的本地存储

### 1.2 Sequelize

Sequelize 是 Node.js 的 ORM（对象关系映射）框架：

```
┌─────────────────────────────────────────────────────────────────┐
│                    Sequelize 工作原理                           │
└─────────────────────────────────────────────────────────────────┘

    JavaScript 对象              SQL 语句                数据库
    ┌──────────────┐          ┌──────────────┐      ┌──────────────┐
    │   Friend     │  ─────►  │ INSERT INTO  │  ──► │   sqlite     │
    │   {          │  ORM映射 │ friends ...  │  执行 │   数据库     │
    │     name,    │  ◄─────  │              │  ◄── │              │
    │     wxid     │          │ SELECT * ... │      │              │
    │   }          │          │              │      │              │
    └──────────────┘          └──────────────┘      └──────────────┘
```

**优点**：
- 用 JavaScript 对象操作数据库，不用写 SQL
- 自动处理类型转换、关联关系
- 支持多种数据库（SQLite、MySQL、PostgreSQL）

---

## 二、项目中的使用

### 2.1 使用位置

```
src/sqlite/
├── index.js              # 数据库初始化（空文件，可能使用Sequelize自动同步）
├── schema.sql            # 数据库表结构
├── automate.json         # 自动化配置
│
├── entities/             # 数据模型定义
│   ├── friend.js         # 好友模型
│   ├── friend_relation.js # 好友关系
│   ├── chatroom_info.js  # 群聊信息
│   ├── chatroom_member_info.js # 群成员
│   ├── conversation.js   # 会话
│   ├── external_user.js  # 外部用户
│   └── ...
│
└── task/                 # 数据访问任务
    ├── FriendRelation.js
    ├── chatroomInfo.js
    └── chatroomMemberInfo.js
```

### 2.2 数据模型示例

```javascript
// src/sqlite/entities/friend.js

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Friend = sequelize.define('Friend', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        wxid: {
            type: DataTypes.STRING,
            allowNull: false,
            comment: '微信ID'
        },
        nickname: {
            type: DataTypes.STRING,
            comment: '昵称'
        },
        alias: {
            type: DataTypes.STRING,
            comment: '微信号'
        },
        avatar: {
            type: DataTypes.STRING,
            comment: '头像URL'
        },
        remark: {
            type: DataTypes.STRING,
            comment: '备注名'
        },
        ownerWxid: {
            type: DataTypes.STRING,
            allowNull: false,
            comment: '所属机器人wxid'
        },
        createTime: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        },
        updateTime: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        }
    }, {
        tableName: 'friends',
        timestamps: true,
        createdAt: 'createTime',
        updatedAt: 'updateTime'
    });

    return Friend;
};
```

### 2.3 业务中的使用

```javascript
// src/msg-center/business/dao-service/FriendService.js

const { Friend } = require('../../../sqlite/entities');

const FriendService = {
    /**
     * 保存或更新好友
     */
    async saveOrUpdate(friendData, ownerWxid) {
        const { wxid, nickname, alias, avatar, remark } = friendData;

        const [friend, created] = await Friend.findOrCreate({
            where: { wxid, ownerWxid },
            defaults: {
                nickname,
                alias,
                avatar,
                remark,
                ownerWxid
            }
        });

        if (!created) {
            // 已存在，更新信息
            await friend.update({ nickname, alias, avatar, remark });
        }

        return friend;
    },

    /**
     * 批量保存好友
     */
    async batchSave(friendList, ownerWxid) {
        const data = friendList.map(f => ({
            ...f,
            ownerWxid
        }));

        return Friend.bulkCreate(data, {
            updateOnDuplicate: ['nickname', 'alias', 'avatar', 'remark', 'updateTime']
        });
    },

    /**
     * 查询好友列表
     */
    async findByOwner(ownerWxid) {
        return Friend.findAll({
            where: { ownerWxid },
            order: [['updateTime', 'DESC']]
        });
    },

    /**
     * 删除好友
     */
    async deleteByWxid(wxid, ownerWxid) {
        return Friend.destroy({
            where: { wxid, ownerWxid }
        });
    }
};

module.exports = FriendService;
```

---

## 三、常用操作

### 3.1 CRUD 操作

```javascript
const { Friend, Chatroom } = require('./entities');

// ═══════════════════════════════════════════════════════════════════
// 创建 (Create)
// ═══════════════════════════════════════════════════════════════════

// 单条创建
const friend = await Friend.create({
    wxid: 'wxid_xxx',
    nickname: '张三',
    ownerWxid: 'wxid_robot'
});

// 批量创建
await Friend.bulkCreate([
    { wxid: 'wxid_1', nickname: '张三', ownerWxid: 'wxid_robot' },
    { wxid: 'wxid_2', nickname: '李四', ownerWxid: 'wxid_robot' }
]);

// ═══════════════════════════════════════════════════════════════════
// 查询 (Read)
// ═══════════════════════════════════════════════════════════════════

// 主键查询
const friend = await Friend.findByPk(1);

// 条件查询
const friend = await Friend.findOne({
    where: { wxid: 'wxid_xxx' }
});

// 查询所有
const friends = await Friend.findAll({
    where: { ownerWxid: 'wxid_robot' }
});

// 分页查询
const { count, rows } = await Friend.findAndCountAll({
    where: { ownerWxid: 'wxid_robot' },
    limit: 20,
    offset: 0,
    order: [['createTime', 'DESC']]
});

// ═══════════════════════════════════════════════════════════════════
// 更新 (Update)
// ═══════════════════════════════════════════════════════════════════

// 实例更新
friend.nickname = '新昵称';
await friend.save();

// 条件更新
await Friend.update(
    { nickname: '新昵称' },
    { where: { wxid: 'wxid_xxx' } }
);

// ═══════════════════════════════════════════════════════════════════
// 删除 (Delete)
// ═══════════════════════════════════════════════════════════════════

// 实例删除
await friend.destroy();

// 条件删除
await Friend.destroy({
    where: { wxid: 'wxid_xxx' }
});
```

### 3.2 查询条件

```javascript
const { Op } = require('sequelize');

// 等于
{ wxid: 'wxid_xxx' }

// 不等于
{ status: { [Op.ne]: 0 } }

// 大于/小于
{ age: { [Op.gt]: 18 } }
{ age: { [Op.lt]: 60 } }

// 包含
{ wxid: { [Op.in]: ['wxid_1', 'wxid_2'] } }

// 模糊匹配
{ nickname: { [Op.like]: '%张%' } }

// 组合条件（AND）
{
    ownerWxid: 'wxid_robot',
    status: 1
}

// 组合条件（OR）
{
    [Op.or]: [
        { nickname: '张三' },
        { alias: 'zhangsan' }
    ]
}
```

---

## 四、项目中的数据表

### 4.1 主要表结构

| 表名 | 用途 | 对应模型 |
|-----|-----|---------|
| `friends` | 好友信息 | Friend |
| `friend_relations` | 好友关系（哪个机器人的好友） | FriendRelation |
| `chatroom_info` | 群聊信息 | ChatroomInfo |
| `chatroom_member_info` | 群成员信息 | ChatroomMemberInfo |
| `conversations` | 会话列表 | Conversation |
| `external_users` | 外部联系人（企微） | ExternalUser |
| `task_info` | 任务信息 | TaskInfo |

### 4.2 数据库文件位置

```javascript
// Electron 应用数据目录
// Windows: C:\Users\{用户名}\AppData\Roaming\{应用名}\
// macOS: ~/Library/Application Support/{应用名}/

const { app } = require('electron');
const dbPath = path.join(app.getPath('userData'), 'database.sqlite');
```

---

## 五、对比 React 开发

### 5.1 与 LocalStorage 的区别

| 特性 | LocalStorage | SQLite |
|-----|-------------|--------|
| 数据结构 | Key-Value | 关系型表 |
| 查询能力 | 只能按Key | 支持复杂SQL |
| 数据量 | 5MB限制 | 无限制 |
| 类型支持 | 只支持字符串 | 多种类型 |
| 适用场景 | 简单配置 | 复杂业务数据 |

### 5.2 React 开发者快速上手

```javascript
// 如果你熟悉 React Query 或 SWR
// Sequelize 类似于后端的 ORM

// React Query 风格
const { data } = useQuery('friends', fetchFriends);

// Sequelize 风格（后端）
const friends = await Friend.findAll({ where: { ownerWxid } });

// 两者都是声明式的数据获取
// 区别在于一个在前端运行，一个在后端（这里是Electron主进程）
```

---

## 六、调试技巧

### 6.1 查看数据库文件

```bash
# 使用 SQLite 命令行工具
sqlite3 "C:\Users\xxx\AppData\Roaming\weixinzhushou\database.sqlite"

# 查看所有表
.tables

# 查看表结构
.schema friends

# 查询数据
SELECT * FROM friends LIMIT 10;
```

### 6.2 开启 SQL 日志

```javascript
// 初始化 Sequelize 时开启日志
const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: dbPath,
    logging: console.log  // 打印所有SQL
});
```
