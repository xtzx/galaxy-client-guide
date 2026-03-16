/**
 * 企业微信数据链路 — 初始化与合并
 * 将 WKWX 命名空间中的数据合并到 window.DATA
 */
(function () {
  'use strict';

  var DATA = window.DATA;
  var WKWX = window.WKWX;

  if (!DATA || !WKWX) return;

  // ================================================================
  //  架构总览
  // ================================================================

  DATA.wkwxArchitecture = {
    summary: '企业微信系统包含 5 条核心数据链路，与个微共用底层通信框架（MQTT/IPC/WebSocket），通过 registry.workWx 标识在关键节点做分支路由，使用独立的处理器列表（WorkWxConvertServiceList）和消息处理中心（WkMsgHandlerCenter）',
    links: [
      WKWX.linkDownstream,
      WKWX.linkUpstream,
      WKWX.linkFrontPush,
      WKWX.linkFrontDown,
      WKWX.linkHttpUpload,
    ],
  };

  // ================================================================
  //  MQTT 下行任务类型分类
  // ================================================================

  DATA.wkwxMqttTaskCategories = WKWX.mqttTaskCategories || [];

  // ================================================================
  //  上行处理器清单（链路②③⑤共用）
  // ================================================================

  DATA.wkwxUpstreamCategories = WKWX.upstreamCategories || [];

  // ================================================================
  //  企微 Meta 信息
  // ================================================================

  DATA.wkwxMeta = {
    name: 'Galaxy Client 数据链路分析',
    version: '企业微信',
    note: '本视图覆盖企业微信(WXWork.exe)数据链路。企微与个微共用底层 MQTT/IPC/WebSocket 框架，通过 registry.workWx 标识在 runTask/dispatchOutBound/cloudFlowOutBound/SendFrontAspect 等关键节点做分支路由。',
    dirNote: '处理器目录说明：task-mqtt/wkwx/（25个MQTT下行处理器）；convert-service/workwx/（16个被动事件处理器）；convert-response/workwx/（21个任务结果处理器）；strategy-front/（3个前端推送策略）',
  };

  // ================================================================
  //  清理临时命名空间
  // ================================================================

  delete window.WKWX;
})();
