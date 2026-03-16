/**
 * 企业微信数据链路 — 上行消息处理器清单 (convert-service + convert-response)
 * 链路②中 cloudFlowOutBound 使用的 WorkWxConvertServiceList 完整清单
 */
(function () {
  'use strict';

  window.WKWX = window.WKWX || {};

  window.WKWX.upstreamCategories = [
    {
      id: 'wkwx_common_service',
      name: '通用服务（共享）',
      typeRange: 'login/logout/pong',
      items: [
        { type: 'login', name: '登录服务', handler: 'convert-service/loginService.js', scenarioId: null },
        { type: 'logout', name: '退出登录', handler: 'convert-service/logoutService.js', scenarioId: null },
        { type: 'pong', name: '心跳响应', handler: 'convert-service/pongService.js', scenarioId: null },
        { type: 'userInfoSync', name: '用户信息同步', handler: 'convert-service/userInfoSyncResponseService.js', scenarioId: null },
      ],
    },
    {
      id: 'wkwx_convert_service',
      name: '被动事件处理器 (convert-service/workwx)',
      typeRange: '逆向被动回报 → MQTT上报',
      items: [
        { type: 'userlist/getuserlist', name: '好友群列表拉取', handler: 'convert-service/workwx/workFriendsListResponse.js', scenarioId: null },
        { type: 'NotifyMessage(1017)', name: '好友申请', handler: 'convert-service/workwx/workWxAddFriendRequest.js', scenarioId: null },
        { type: 'MODIFY_ROOM_ANNOUNCEMENT', name: '群公告修改结果', handler: 'convert-service/workwx/workWxAnnouncementResponse.js', scenarioId: null },
        { type: 'RefreshConversations/UpdateConversationInfo', name: '群信息刷新/新成员', handler: 'convert-service/workwx/workWxConversationRefreshService.js', scenarioId: null },
        { type: 'WORK_CREATE_NEW_CHATROOM', name: '建群结果', handler: 'convert-service/workwx/workWxCreateRoomResponse.js', scenarioId: null },
        { type: 'filepath', name: '文件路径处理(上传OSS)', handler: 'convert-service/workwx/workWxFilePathService.js', scenarioId: null },
        { type: 'DeleteCustomers', name: '删除好友回调', handler: 'convert-service/workwx/workWxFriendDeleteService.js', scenarioId: null },
        { type: 'MultDataContact', name: '好友增量变化', handler: 'convert-service/workwx/workWxFriendMultData.js', scenarioId: null },
        { type: 'GetUserInfoWithCheckRsp', name: '群成员详情', handler: 'convert-service/workwx/workWxGetUserInfoWithCheckService.js', scenarioId: null },
        { type: 'recvmsg', name: '收到消息(私聊/群聊)', handler: 'convert-service/workwx/workWxMsgRecordService.js', scenarioId: null },
        { type: 'queryapplyuserid', name: '申请加好友列表', handler: 'convert-service/workwx/workWxQueryApplyUseridService.js', scenarioId: null },
        { type: 'QUICK_MSG_REPORT/QUICK_SEND', name: '极速群发结果', handler: 'convert-service/workwx/workWxQuickMsgRecordService.js', scenarioId: null },
        { type: 'GET_MEMBER_INFO', name: '群成员列表', handler: 'convert-service/workwx/workWxRoomMemberInfoService.js', scenarioId: null },
        { type: 'VOICE_OR_VIDEO_CALL', name: '语音/视频通话', handler: 'convert-service/workwx/workWxVoicecommunicationResponse.js', scenarioId: null },
        { type: 'revokemsgfinished', name: '撤回消息结果', handler: 'convert-service/workwx/workWxRevokeMsgService.js', scenarioId: null },
        { type: 'GET_ALL_SERVICE_IS_OPEN_NO_DISTURB', name: '服务免打扰配置', handler: 'convert-service/workwx/workWxGetFwUserService.js', scenarioId: null },
      ],
    },
    {
      id: 'wkwx_convert_response',
      name: '任务结果处理器 (convert-response/workwx)',
      typeRange: '主动任务执行结果 → MQTT回报',
      items: [
        { type: 'sendmsg_* (成功)', name: '发消息成功回报', handler: 'convert-taskreport/workwx/wkFriendChatResponse.js', scenarioId: null },
        { type: 'sendmsg_* (失败)', name: '发消息失败回报', handler: 'convert-taskreport/workwx/fail/workWxFriendChatResponseFail.js', scenarioId: null },
        { type: 'WORK_ADD_CHATROOM_ADMIN', name: '添加群管理员结果', handler: 'convert-response/workwx/workWxAddChatroomAdminTaskResponse.js', scenarioId: null },
        { type: 'WORK_KICK_OUT_MEMBER', name: '踢人结果', handler: 'convert-response/workwx/workWxKickOutTaskResponse.js', scenarioId: null },
        { type: 'OPERATE_CONTRACT_RSP(op=14)', name: '手机号加好友结果', handler: 'convert-response/workwx/workWxAddFriendByPhoneResonse.js', scenarioId: null },
        { type: 'addfriend', name: '加好友结果', handler: 'convert-response/workwx/workWxAddFriendTaskResponse.js', scenarioId: null },
        { type: 'SEARCH_USER_FROM_NET_TASK', name: '搜索/加好友(手机号)', handler: 'convert-response/workwx/workWxAddOrSearchFriendByPhoneTaskResponse.js', scenarioId: null },
        { type: 'WORK_BAN_CONVERSATION_NAME', name: '禁止改群名结果', handler: 'convert-response/workwx/workWxBanChatroomNameTaskResponse.js', scenarioId: null },
        { type: 'WORK_MODIFY_CONVERSATION_NAME', name: '改群名结果', handler: 'convert-response/workwx/workWxChangeChatroomNameResponse.js', scenarioId: null },
        { type: 'WORK_WX_DELETE_FRIEND', name: '删除好友结果', handler: 'convert-response/workwx/workWxDeleteFriendTaskResponse.js', scenarioId: null },
        { type: 'WORK_QUIT_CONVERSATION', name: '退群结果', handler: 'convert-response/workwx/workWxExitChatroomTaskResponse.js', scenarioId: null },
        { type: 'WORK_AGREE_FRIEND', name: '通过好友结果', handler: 'convert-response/workwx/workWxFriendPassResponse.js', scenarioId: null },
        { type: 'GET_CHATROOM_QRCODE', name: '获取群二维码结果', handler: 'convert-response/workwx/workWxGetChatroomQrcodeResult.js', scenarioId: null },
        { type: 'GET_CUSTOMER_LABEL', name: '客户标签列表结果', handler: 'convert-response/workwx/workWxGetContactLabelListTaskResponseService.js', scenarioId: null },
        { type: 'WORK_ADD_MEMBER', name: '邀请进群结果', handler: 'convert-response/workwx/workWxJoinChatroomTaskResponse.js', scenarioId: null },
        { type: 'INSERT_OR_DEL_LABEL', name: '标签增删结果', handler: 'convert-response/workwx/workWxModifyContactLabelDetailTaskResponse.js', scenarioId: null },
        { type: 'SET_LABLE_TASK', name: '设置标签结果', handler: 'convert-response/workwx/workWxModifyContactLabelTaskResponse.js', scenarioId: null },
        { type: 'SEND_QUOTE_MESSAGE', name: '引用消息结果', handler: 'convert-response/workwx/workWxQuoteMsgTaskResponse.js', scenarioId: null },
        { type: 'REJECT_CHATROOM_ADD_FRIENDS', name: '禁群内加好友结果', handler: 'convert-response/workwx/workWxRejectChatroomAddFriends.js', scenarioId: null },
        { type: 'WORK_CHANGE_REMARK', name: '修改备注结果', handler: 'convert-response/workwx/workWxRemarkTaskResponse.js', scenarioId: null },
        { type: 'REVOKE_MESSAGE', name: '撤回消息结果', handler: 'convert-response/workwx/workWxRevokeMsgTaskResponse.js', scenarioId: null },
        { type: 'searchContact', name: '搜索联系人结果', handler: 'convert-response/workwx/workWxSearchContactResultResponse.js', scenarioId: null },
        { type: 'WORK_QUIT_CONVERSATION(转群主)', name: '转让群主结果', handler: 'convert-response/workwx/workWxTransferChatroomLeaderTaskResponse.js', scenarioId: null },
      ],
    },
    {
      id: 'wkwx_front_strategy',
      name: '前端推送策略 (链路③ SendFrontAspect)',
      typeRange: '企微→前端类型转换',
      items: [
        { type: 'login', name: '登录信息转换', handler: 'strategy-front/SendLoginMsgFrontStrategy.js', scenarioId: null },
        { type: 'delconversationmember→delchatmenber', name: '踢人信息转换', handler: 'strategy-front/sendKickOutMsgFrontStrategy.js', scenarioId: null },
        { type: 'changeremark→remark', name: '备注信息转换', handler: 'strategy-front/SendRemarkMsgFrontStrategy.js', scenarioId: null },
      ],
    },
    {
      id: 'wkwx_http_endpoints',
      name: 'HTTP 上报端点 (链路⑤)',
      typeRange: '企微专属 HTTP API',
      items: [
        { type: '/window/task/wkTagInfos', name: '标签信息上报', handler: 'wkUserListResponseMsgHandler.js + workWxGetContactLabelListTaskResponseService.js', scenarioId: null },
        { type: '/window/task/updateChatroomList', name: '群列表上报', handler: 'wkUserListResponseMsgHandler.reportUploadChatroomList()', scenarioId: null },
        { type: '/window/task/updateChatroomInfo', name: '群成员列表上报', handler: 'wkUserListResponseMsgHandler.reportUpdateRoomInfo()', scenarioId: null },
        { type: '/window/task/updateWkChatroomMemberInfos', name: '群成员详情上报', handler: 'convert-service/workwx/uploadRoomMemberInfos.js', scenarioId: null },
        { type: '/window/task/updateServiceAccountSubscribe', name: '服务免打扰信息', handler: 'convert-service/workwx/workWxGetFwUserService.js', scenarioId: null },
      ],
    },
  ];
})();
