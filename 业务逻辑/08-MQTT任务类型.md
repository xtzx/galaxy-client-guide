# MQTT任务类型详解

> 所有云端下发的任务类型枚举

---

## 一、任务类型总览

### 1.1 任务分类

| 分类 | 类型范围 | 说明 |
|-----|---------|-----|
| 群聊操作 | 1-30 | 群内发消息、踢人、邀请等 |
| 好友操作 | 100-170 | 私聊、加好友、删好友等 |
| 管理操作 | 200-210 | 更新IP、同步配置等 |
| 个人设置 | 300-310 | 修改昵称、头像等 |
| 系统任务 | 400-410 | 上报信息、下载补丁等 |
| 特殊任务 | 800-999 | 日志上传、监控等 |

---

## 二、群聊操作任务 (1-30)

### 2.1 完整列表

```javascript
// src/msg-center/core/data-config/SunTaskType.js

const ChatroomTaskTypes = {
    CHATROOM_SEND_MSG: 1,                    // 群内发消息
    CHATROOM_INVITE: 2,                       // 邀请入群
    CHATROOM_KICK_OUT: 3,                     // 踢人出群
    CHATROOM_TRANSFER_OWNER: 4,               // 转让群主
    CHATROOM_UPDATE_NOTICE: 5,                // 修改群公告
    CHATROOM_UPDATE_NAME: 6,                  // 修改群名称
    CHATROOM_LEAVE: 7,                        // 退出群聊
    CHATROOM_ALTER_SELF_DISPLAYNAME: 8,       // 修改群内昵称
    CHATROOM_CALLBACK_INVITE: 10,             // 邀请回调
    CHATROOM_PREPARE: 11,                     // 创建群聊
    CHATROOM_UPDATE_QRCODE_REL: 12,           // 更新群二维码
    CHATROOM_LEAVE_ALL: 13,                   // 退群(含群主)
    CHATROOM_OPEN_VERIFY_INVITATION: 14,      // 开启群验证
    CHATROOM_CLOSE_VERIFY_INVITATION: 15,     // 关闭群验证
    CHATROOM_DISABLE_QRCODE: 16,              // 停用群二维码
    CHATROOM_ADD_ADMIN: 17,                   // 设置管理员
    CHATROOM_REMOVE_ADMIN: 18,                // 取消管理员
    CHATROOM_INVITATION_ACCEPT: 27,           // 接受入群邀请
    REJECT_CHATROOM_ADD_FRIENDS: 28,          // 禁止群内加好友
    CHATROOM_KICK_BY_REVOKE: 33,              // 踢人(撤销邀请)
    
    // 特殊邀请类型
    CHATROOM_INVITE_LT40_DIRECT: 1002,        // 邀请入群 < 40人
    CHATROOM_INVITE_GT40_DIRECT: 1102,        // 邀请入群 > 40人
};
```

### 2.2 任务详情

| 类型 | 名称 | 参数 | 说明 |
|-----|-----|-----|-----|
| 1 | 群内发消息 | chatroom, content, weChatMsgType | 发送文本/图片/视频等 |
| 2 | 邀请入群 | chatroom, toUsernames | 邀请用户入群 |
| 3 | 踢人出群 | chatroom, toUsernames | 将用户移出群聊 |
| 4 | 转让群主 | chatroom, toUsernames[0] | 转让群主给指定用户 |
| 5 | 修改群公告 | chatroom, content | 设置群公告内容 |
| 6 | 修改群名称 | chatroom, content | 设置新群名 |
| 7 | 退出群聊 | chatroom | 机器人退出群聊 |
| 11 | 创建群聊 | toUsernames, content | 创建新群(content为群名) |

---

## 三、好友操作任务 (100-170)

### 3.1 完整列表

```javascript
const FriendTaskTypes = {
    FRIEND_SEND_MSG: 100,                     // 私聊发消息
    DELETE_FRIEND: 101,                       // 删除好友
    ADD_FRIEND: 102,                          // 添加好友[微信号]
    UPLOAD_FRIEND_LIST: 103,                  // 上传好友列表
    FRIEND_ACCEPT_REQUEST: 104,               // 通过好友申请
    FRIEND_ADD_LABEL: 105,                    // 批量添加标签
    FRIEND_REMOVE_LABEL: 106,                 // 批量移除标签
    UPDATE_SELF_QRCODE: 107,                  // 更新二维码
    ADD_FRIEND_BY_CARD: 108,                  // 添加好友[名片]
    UPLOAD_FOLLOWED_OFFICAL_ACCOUNTS: 109,    // 上传公众号列表
    FOLLOW_OFFICAL_ACCOUNT: 110,              // 关注公众号
    ADD_FRIEND_BY_PHONE: 111,                 // 添加好友[手机号]
    OPEN_ADD_FRINED_VERIFY: 112,              // 开启加好友验证
    CLOSE_ADD_FRIEND_VERIFY: 113,             // 关闭加好友验证
    SEARCH_FRIEND_BY_ALIAS: 114,              // 搜索好友[微信号]
    SEARCH_FRIEND_BY_PHONE: 115,              // 搜索好友[手机号]
    MODIFY_FRIEND_REMARK: 116,                // 修改好友备注
    ADD_LABEL_FOR_FRIEND: 117,                // 给好友加标签
    REMOVE_LABEL_FOR_FRIEND: 118,             // 删除好友标签
    UPLOAD_ALL_LABEL_INFO: 119,               // 上报所有标签
    CREATE_LABEL: 120,                        // 创建标签
    DELETE_LABEL: 121,                        // 删除标签
    DELETE_FRIEND_BATCH: 125,                 // 批量删除好友
    ADD_CHATROOM_FRIEND: 126,                 // 群内加好友
    
    // 朋友圈相关
    REFRESH_TIMELINE: 143,                    // 刷新朋友圈
    DELETE_TIMELINE: 144,                     // 删除朋友圈
    TIMELINE_COMMENT: 145,                    // 朋友圈评论
    TIMELINE_DELETE_COMMENT: 146,             // 删除评论
    TIMELINE_LIKE: 147,                       // 朋友圈点赞
    TIMELINE_CANCEL_LIKE: 148,                // 取消点赞
    TIMELINE_VIDEO: 149,                      // 发视频朋友圈
    TIMELINE_NORMAL: 150,                     // 发图文朋友圈
    TIMELINE_LINK: 151,                       // 发链接朋友圈
    
    // 群发相关
    BROADCAST_TEXT: 152,                      // 群发文字
    BROADCAST_IMAGE: 153,                     // 群发图片
    BROADCAST_VOICE: 154,                     // 群发语音
    
    // 扫码相关
    SCAN_QRCODE_JOIN_CHATROOM: 155,           // 扫码入群
    SCAN_QRCODE_ADD_FRIEND: 156,              // 扫码加好友
    SET_TIMELINE_COVER: 157,                  // 设置朋友圈封面
    SET_REGINO: 158,                          // 设置地域
    UPLOAD_WECHAT_MSG_COUNT: 159,             // 上报未读消息数
    DECODE_QRCODE: 160,                       // 二维码解码
    SCAN_QR_CODE_LOG_IN: 161,                 // 扫码登录
    LOG_OUT: 162,                             // 退出登录
    MARK_AS_READ: 169,                        // 消息置为已读
    REVOKE_MSG: 170,                          // 撤回消息
};
```

### 3.2 任务详情

| 类型 | 名称 | 参数 | 说明 |
|-----|-----|-----|-----|
| 100 | 私聊发消息 | toUsernames[0], content, weChatMsgType | 发送给单个好友 |
| 101 | 删除好友 | toUsernames[0] | 删除单个好友 |
| 104 | 通过好友 | toUsernames[0], ticket | 通过好友申请 |
| 116 | 修改备注 | toUsernames[0], content | content为新备注 |
| 125 | 批量删除 | toUsernames[] | 批量删除多个好友 |
| 126 | 群内加好友 | chatroom, toUsernames[0] | 添加群内成员 |

---

## 四、管理操作任务 (200-210)

### 4.1 完整列表

```javascript
const ManageTaskTypes = {
    UPDATE_IP: 200,                           // 更新IP
    CLEAR_CHAT_MSG: 201,                      // 清空聊天记录
    REBOOT: 202,                              // 重启
    SYNC_BASIC_INFO: 203,                     // 同步基本信息
    SYNC_CONF: 204,                           // 同步配置
    ACCEPT_ALL_INVITE: 205,                   // 接受所有入群邀请
    CHECK_RECEIVED_SELF: 206,                 // 收消息自检
};
```

---

## 五、个人设置任务 (300-310)

### 5.1 完整列表

```javascript
const PersonalTaskTypes = {
    ALTER_NICKNAME: 300,                      // 修改昵称
    ALTER_AVATAR: 301,                        // 修改头像
    CLOSE_SILENT_DOWNLOAD: 302,               // 关闭静默下载
    ALTER_SIGNATURE: 303,                     // 修改签名
    ALTER_GENDER: 304,                        // 修改性别
    ALTER_LOGIN_PASSWORD: 305,                // 修改登录密码
};
```

---

## 六、系统任务 (400-410)

### 6.1 完整列表

```javascript
const SystemTaskTypes = {
    UPLOAD_MSG_COUNT: 400,                    // 上传消息数
    DOWNLOAD_PLUGIN: 401,                     // 下载补丁包
    CHECK_URL_FOR_WECHAT: 402,                // 检测URL封禁
    UPLOAD_PROTOCOL: 403,                     // 上报协议信息
    UPLOAD_SAFE_DEVICES: 404,                 // 上报设备列表
    UPLOAD_CHATROOM_INFO: 405,                // 上报群信息
    UPLOAD_NEW_PASSWORD: 406,                 // 上报新密码
};
```

---

## 七、特殊任务 (800-999)

### 7.1 完整列表

```javascript
const SpecialTaskTypes = {
    REPLACE_FILE: 886,                        // 替换文件
    UPLOAD_USER_LOG: 888,                     // 上传日志
    GET_MONITOR_INF: 999,                     // 获取监控信息
};
```

---

## 八、消息类型枚举 (weChatMsgType)

### 8.1 消息类型

```javascript
// src/msg-center/core/data-config/emessage.js

const EMessage = {
    TYPE__TEXT: 1,                            // 文本消息
    TYPE__IMAGE: 3,                           // 图片消息
    TYPE__VOICE: 34,                          // 语音消息
    TYPE__VIDEO: 43,                          // 视频消息
    TYPE__STICKER: 47,                        // 表情消息
    TYPE__LOCATION: 48,                       // 位置消息
    TYPE__MSG_CARD_FILE: 49,                  // 文件消息
    TYPE__MSG_CARD_LINK: 5,                   // 链接卡片
    TYPE__CONTACT_CARD: 42,                   // 名片消息
    TYPE__MINI_PROGRAM: 33,                   // 小程序
    TYPE__WORK_FINDER: 67,                    // 视频号
    TYPE__WORK_LIVE: 70,                      // 直播
    TYPE__VOICE_CALL: 71,                     // 语音通话
    TYPE__VIDEO_CALL: 72,                     // 视频通话
};
```

### 8.2 消息类型说明

| 类型码 | 名称 | 微信 | 企微 | 说明 |
|-------|-----|-----|-----|-----|
| 1 | 文本 | ✅ | ✅ | 纯文本、@消息 |
| 3 | 图片 | ✅ | ✅ | jpg/png/gif |
| 5 | 链接 | ✅ | ✅ | 标题+描述+URL |
| 33 | 小程序 | ✅ | ✅ | 小程序卡片 |
| 34 | 语音 | ❌ | ✅ | silk/amr格式 |
| 42 | 名片 | ✅ | ✅ | 个人名片 |
| 43 | 视频 | ✅ | ✅ | mp4/avi等 |
| 47 | 表情 | ✅ | ❌ | 动态表情 |
| 49 | 文件 | ✅ | ✅ | 任意文件 |
| 67 | 视频号 | ❌ | ✅ | 视频号卡片 |
| 70 | 直播 | ❌ | ✅ | 直播卡片 |

---

## 九、任务类型集合

### 9.1 高优先级任务

需要优先处理的任务：

```javascript
const SET_HIGH_PRIORITY = new Set([
    CHATROOM_INVITE,               // 邀请入群
    CHATROOM_KICK_OUT,             // 踢人
    CHATROOM_TRANSFER_OWNER,       // 转群主
    CHATROOM_UPDATE_QRCODE_REL,    // 更新群二维码
    CHATROOM_UPDATE_NAME,          // 修改群名
    CHATROOM_CALLBACK_INVITE,      // 邀请回调
    CHATROOM_OPEN_VERIFY_INVITATION,
    CHATROOM_CLOSE_VERIFY_INVITATION,
    TIMELINE_NORMAL,               // 朋友圈
    CHATROOM_DISABLE_QRCODE,
    CHATROOM_LEAVE,
    CHATROOM_LEAVE_ALL,
    UPDATE_SELF_QRCODE,
]);
```

### 9.2 需要忽略的任务

这些任务不进行失败重试：

```javascript
const SET_IGNORE_TYPE = new Set([
    UPLOAD_FRIEND_LIST,            // 上传好友列表
    UPDATE_IP,                     // 更新IP
    REBOOT,                        // 重启
    SYNC_BASIC_INFO,               // 同步信息
    SYNC_CONF,                     // 同步配置
    UPLOAD_MSG_COUNT,              // 上传消息数
]);
```

### 9.3 包含消息内容的任务

这些任务有消息内容，可能需要混淆处理：

```javascript
const SET_HAVE_MESSAGE = new Set([
    TIMELINE_NORMAL,               // 朋友圈
    TIMELINE_LINK,                 // 朋友圈链接
    FRIEND_SEND_MSG,               // 私聊
    CHATROOM_SEND_MSG,             // 群聊
    CHATROOM_UPDATE_NOTICE,        // 群公告
    BROADCAST_TEXT,                // 群发文字
    BROADCAST_IMAGE,               // 群发图片
    BROADCAST_VOICE,               // 群发语音
]);
```

---

## 十、企微专用任务类型

### 10.1 GalaxyTaskType

```javascript
// src/msg-center/core/data-config/galaxyTaskType.js

const GalaxyTaskType = {
    // 发送消息类型
    SEND_TEXT: "sendmsg_sendtext",
    SEND_IMAG: "sendmsg_sendimage",
    SEND_VIDEO: "sendmsg_sendvideo",
    SEND_FILE: "sendmsg_sendfile",
    SEND_LINK: "sendmsg_sendlink",
    SEND_VOICE: "sendmsg_sendvoice",
    SEND_VOICE_LOCAL: "sendmsg_sendinstantvoice",
    SEND_FINDER_CARD: "sendmsg_sendfinder",
    SEND_QUOTE_MESSAGE: "sendquotemessage",
    SENDMSG_SENDPERSONALCARD: "sendmsg_sendpersonalcard",
    SENDMSG_SENDAPPLET: "sendmsg_sendapplet",
    
    // 极速群发
    QUICK_SEND_TYPE: "sendmsg_sendcrmgroupmessage",
    QUICK_SEND_REAL_TYPE: "sendmsg_sendcrmgroupmessageToUser",
    
    // 群操作
    WORK_KICK_OUT_MEMBER: "delconversationmember",
    WORK_ADD_MEMBER: "addconversationmember",
    WORK_MODIFY_CONVERSATION_NAME: "modifyconversationname",
    WORK_CREATE_NEW_CHATROOM: "createconversation",
    WORK_ADD_CHATROOM_ADMIN: "addconversationadmin",
    WORK_QUIT_CONVERSATION: "quitconversation",
    WORK_TRANSFER_CONVERSATION_LEADER: "transferroomleader",
    WORK_DISBAND_CONVERSATION: "desbandroom",
    WORK_MODIFY_NAME_IN_CONVERSATION: "modifychatroomnickname",
    WORK_BAN_CONVERSATION_NAME: "banchatroomname",
    
    // 好友操作
    WORK_AGREE_FRIEND: "agreefriend",
    WORK_WX_DELETE_FRIEND: "delfriend",
    WORK_CHANGE_REMARK: "changeremark",
    
    // 标签操作
    GET_CONTACT_LABEL_LIST: "getcontactlabellist",
    GET_CUSTOMER_LABEL: "getcustomerlabel",
    GET_LABEL_CONTACT_LIST: "getlabelcontactlist",
    INSERT_OR_DEL_LABEL: "insertordellabel",
    
    // 其他
    GET_CHATROOM_QRCODE: "fetchconversationqrcode",
    REJECT_CHATROOM_ADD_FRIENDS: "forbidaddfriend",
    REVOKE_MESSAGE: "revokemessage",
};
```

---

## 十一、任务处理器映射

### 11.1 微信任务处理器

```javascript
// 位于 mqttClientBase.js

const WxConvertServiceList = [
    MqttAcceptChatroomInvite,     // type: 27
    MqttAddChatroomFriendWx4Service, // type: 126
    MqttBatchDeleteFriendService,  // type: 125
    MqttChangeRemarkService,       // type: 116
    MqttChatroomNameService,       // type: 6
    MqttChatService,               // type: 1, 100
    MqttCleanUnreadMsg,            // type: 清除未读
    MqttDeleteFriendService,       // type: 101
    MqttExitChatroomService,       // type: 7
    MqttFriendListService,         // type: 103
    MqttFriendPassService,         // type: 104
    MqttGetContactLabelListService, // type: 119
    MqttGroupAnnounceService,      // type: 5
    MqttJoinChatroomService,       // type: 2
    MqttKickOutService,            // type: 3
    MqttReplaceFileService,        // type: 886
];
```

### 11.2 企微任务处理器

```javascript
const WorkWxConvertServiceList = [
    mqttWorkAddConversationFriendService,
    mqttWorkBanConversationName,
    mqttWorkDeleteFriendService,
    mqttWorkFriendPassService,
    mqttWorkModifyNameInChatroomService,
    mqttWorkQuickSendService,
    mqttWorkTransferChatroomOwnerService,
    mqttWorkWXGetContactLabelListService,
    mqttWorkWxAddConversationAdmin,
    mqttWorkWxAddFriendByPhoneService,
    mqttWorkWxChangeRemark,
    mqttWorkWxChatService,
    mqttWorkWxChatroomNameService,
    mqttWorkWxCreateConversation,
    mqttWorkWxDisbandConversationService,
    mqttWorkWxExitChatroomService,
    mqttWorkWxGroupAnnounceService,
    mqttWorkWxJoinChatroomService,
    mqttWorkWxKickOutService,
    mqttWorkWxModifyContactLabel,
    mqttWorkWxModifyContactLabelDetail,
    mqttWorkWxSearchFriendByPhoneService,
    MqttUpdateChatroomQrcode,
    MqttRejectChatroomAddFriends,
    MqttWorkWxRevokeMsgService,
];
```

---

## 十二、任务参数结构

### 12.1 通用任务参数

```typescript
interface ServerTask {
    id: string;              // 任务ID
    type: number;            // 任务类型
    wxId: string;            // 机器人wxid
    chatroom?: string;       // 群ID
    toUsernames?: string[];  // 目标用户列表
    content?: string;        // 消息内容
    contentList?: string[];  // 多段内容
    weChatMsgType?: number;  // 消息类型
    ext?: string;            // 扩展字段(文件名等)
    ticket?: string;         // 好友申请凭证
    serialNo?: number;       // 序列号
    createTime?: number;     // 创建时间
}
```

### 12.2 发送消息任务

```json
{
    "id": "task_123456",
    "type": 100,
    "wxId": "wxid_robot",
    "toUsernames": ["wxid_target"],
    "content": "消息内容",
    "weChatMsgType": 1,
    "createTime": 1642000000
}
```

### 12.3 踢人任务

```json
{
    "id": "task_123456",
    "type": 3,
    "wxId": "wxid_robot",
    "chatroom": "12345678@chatroom",
    "toUsernames": ["wxid_target1", "wxid_target2"],
    "createTime": 1642000000
}
```

### 12.4 通过好友任务

```json
{
    "id": "task_123456",
    "type": 104,
    "wxId": "wxid_robot",
    "toUsernames": ["wxid_applicant"],
    "ticket": "v3_xxx_yyy",
    "content": "验证消息",
    "createTime": 1642000000
}
```
