/**
 * Galaxy Client 数据链路分析 - 最终导出
 * 依赖：data-infra.js、data-scenarios.js、data-architecture.js（需全部先加载）
 * 导出：window.DATA（清理 window._GCData 临时命名空间）
 */
(function () {
  'use strict';

  var d = window._GCData;

  window.DATA = {
    meta: {
      name: 'Galaxy Client 数据链路分析',
      version: '微信 4.0 / 企业微信',
      note: '本文档覆盖微信4.0（个人微信）和企业微信的数据链路，平台差异以 [微信]/[企微]/[共用] 标签标注',
      slsConfig: {
        endpoint: 'gaotu-new.cn-beijing-intranet.log.aliyuncs.com',
        logstore: 'gaotu-wxzs-client-node-log',
        logFormat: '[用户名] [GID] [sonVersion3] [版本号] [号数量: N] 消息内容',
        commonQueries: [
          { field: '按用户', query: '[张三]', desc: '搜索操作用户' },
          { field: '按GID', query: '[abc123]', desc: '搜索设备标识' },
          { field: '按wxid', query: 'wxid_xxx', desc: '搜索微信号' },
          { field: '按taskId', query: 'taskId=12345', desc: '搜索任务ID' },
          { field: '按错误', query: '[codeError]', desc: '搜索代码错误' },
          { field: 'MQTT异常', query: 'MQTT client未初始化', desc: 'MQTT未初始化' },
          { field: '崩溃', query: 'UncaughtException', desc: '未捕获异常' },
        ],
        haboEndpoint: 'habo-i.gsxtj.com/backend/info',
        haboQueries: [
          { field: '崩溃', query: 'UNCAUGHT_EXCEPTION', desc: '应用崩溃' },
          { field: '逆向崩溃', query: 'REVERSE_BUG_REPORT', desc: '逆向端崩溃' },
          { field: '资源', query: 'RESOURCE_USAGE', desc: '资源使用报告' },
        ],
      },
      keyApis: {
        prod: {
          mqtt: 'MQTT Broker (阿里云IoT)',
          qunCenter: 'qun-center.umeng100.com',
          api: 'api.umeng100.com',
          logdata: 'logdata.umeng100.com',
        },
        test: {
          mqtt: 'MQTT Broker (阿里云IoT测试)',
          qunCenter: 'test-qun-center.umeng100.com',
          api: 'test-api.umeng100.com',
          logdata: 'test-logdata.umeng100.com',
        },
      },
    },

    architecture: {
      summary: '系统包含 3 条核心数据链路：① MQTT下行任务 ② 上行回报与前端推送（含HTTP上报）③ 前端指令下行。微信和企微共用同一套架构，差异以标签标注。',
      links: d.architectureLinks,
    },

    categories: [
      { id: 'message', name: '消息类', icon: '💬' },
      { id: 'friend', name: '好友类', icon: '👤' },
      { id: 'group', name: '群聊类', icon: '👥' },
      { id: 'system', name: '系统类', icon: '⚙️' },
    ],

    linkTypes: [
      { id: 'downstream', name: '① 云端MQTT → 逆向（下行任务）', color: '#4fc3f7', arrow: '↓' },
      { id: 'upstream', name: '② 逆向 → 云端/前端（上行回报与推送）', color: '#81c784', arrow: '↑' },
      { id: 'front-down', name: '③ 前端 → 逆向（前端指令下行）', color: '#90caf9', arrow: '↓' },
    ],

    mqttTaskCategories: d.mqttTaskCategories,

    upstreamCategories: d.upstreamCategories,
    frontCmdCategories: d.frontCmdCategories,

    scenarios: d.scenarios,
  };

  // 清理临时命名空间
  delete window._GCData;
})();
