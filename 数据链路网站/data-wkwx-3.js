/**
 * 企业微信数据链路 — MQTT 下行任务类型清单（25个处理器）
 */
(function () {
  'use strict';

  window.WKWX = window.WKWX || {};

  window.WKWX.mqttTaskCategories = [
    {
      id: 'wkwx_cat_message',
      name: '消息类',
      typeRange: 'type 1,100,170,100010,200011',
      items: [
        { type: 1, name: '群内发消息', handler: 'task-mqtt/wkwx/mqttWorkWxChatService.js', scenarioId: null },
        { type: 100, name: '私聊发消息', handler: 'task-mqtt/wkwx/mqttWorkWxChatService.js', scenarioId: null },
        { type: 170, name: '撤回消息', handler: 'task-mqtt/wkwx/mqttWorkWxRevokeMsgService.js', scenarioId: null },
        { type: 100010, name: '极速群发(好友)', handler: 'task-mqtt/wkwx/mqttWorkQuickSendService.js', scenarioId: null },
        { type: 200011, name: '极速群发(群聊)', handler: 'task-mqtt/wkwx/mqttWorkQuickSendService.js', scenarioId: null },
      ],
    },
    {
      id: 'wkwx_cat_chatroom',
      name: '群聊操作',
      typeRange: 'type 2-28,100011-100012',
      items: [
        { type: 2, name: '邀请入群', handler: 'task-mqtt/wkwx/mqttWorkWxJoinChatroomService.js', scenarioId: null },
        { type: 3, name: '踢人出群', handler: 'task-mqtt/wkwx/mqttWorkWxKickOutService.js', scenarioId: null },
        { type: 4, name: '转让群主', handler: 'task-mqtt/wkwx/mqttWorkTransferChatroomOwnerService.js', scenarioId: null },
        { type: 5, name: '更新群公告', handler: 'task-mqtt/wkwx/mqttWorkWxGroupAnnounceService.js', scenarioId: null },
        { type: 6, name: '更新群名称', handler: 'task-mqtt/wkwx/mqttWorkWxChatroomNameService.js', scenarioId: null },
        { type: 7, name: '退群', handler: 'task-mqtt/wkwx/mqttWorkWxExitChatroomService.js', scenarioId: null },
        { type: 11, name: '建群', handler: 'task-mqtt/wkwx/mqttWorkWxCreateConversation.js', scenarioId: null },
        { type: 12, name: '更新群二维码', handler: 'task-mqtt/wkwx/mqttUpdateChatroomQrcode.js', scenarioId: null },
        { type: 17, name: '添加群管理员', handler: 'task-mqtt/wkwx/mqttWorkWxAddConversationAdmin.js', scenarioId: null },
        { type: 28, name: '禁止群内加好友', handler: 'task-mqtt/wkwx/mqttRejectChatroomAddFriends.js', scenarioId: null },
        { type: 100011, name: '修改群内昵称', handler: 'task-mqtt/wkwx/mqttWorkModifyNameInChatroomService.js', scenarioId: null },
        { type: 100012, name: '禁止修改群名/解散群(冲突)', handler: 'task-mqtt/wkwx/mqttWorkBanConversationName.js + mqttWorkWxDisbandConversationService.js', scenarioId: null },
      ],
    },
    {
      id: 'wkwx_cat_friend',
      name: '好友操作',
      typeRange: 'type 101-126',
      items: [
        { type: 101, name: '删除好友', handler: 'task-mqtt/wkwx/mqttWorkDeleteFriendService.js', scenarioId: null },
        { type: 104, name: '通过好友请求', handler: 'task-mqtt/wkwx/mqttWorkFriendPassService.js', scenarioId: null },
        { type: 111, name: '手机号加好友', handler: 'task-mqtt/wkwx/mqttWorkWxAddFriendByPhoneService.js', scenarioId: null },
        { type: 115, name: '手机号搜好友', handler: 'task-mqtt/wkwx/mqttWorkWxSearchFriendByPhoneService.js', scenarioId: null },
        { type: 116, name: '修改好友备注', handler: 'task-mqtt/wkwx/mqttWorkWxChangeRemark.js', scenarioId: null },
        { type: 126, name: '群内加好友', handler: 'task-mqtt/wkwx/mqttWorkAddConversationFriendService.js', scenarioId: null },
      ],
    },
    {
      id: 'wkwx_cat_label',
      name: '标签操作',
      typeRange: 'type 105,106,119-121',
      items: [
        { type: 105, name: '标签内添加好友', handler: 'task-mqtt/wkwx/mqttWorkWxModifyContactLabelDetail.js', scenarioId: null },
        { type: 106, name: '标签内移除好友', handler: 'task-mqtt/wkwx/mqttWorkWxModifyContactLabelDetail.js', scenarioId: null },
        { type: 119, name: '上报所有标签信息', handler: 'task-mqtt/wkwx/mqttWorkWXGetContactLabelListService.js', scenarioId: null },
        { type: 120, name: '创建标签', handler: 'task-mqtt/wkwx/mqttWorkWxModifyContactLabel.js', scenarioId: null },
        { type: 121, name: '删除标签', handler: 'task-mqtt/wkwx/mqttWorkWxModifyContactLabel.js', scenarioId: null },
      ],
    },
  ];
})();
