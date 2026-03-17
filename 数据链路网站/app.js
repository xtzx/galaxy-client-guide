/**
 * Galaxy Client 数据链路分析 — 渲染引擎
 */
(function () {
  'use strict';

  var currentView = '__overview__';
  var currentPlatform = 'wx';
  var mermaidReady = false;
  var nodeRegistry = [];
  var hashUpdating = false;

  function getArchitecture() {
    return currentPlatform === 'wkwx' ? DATA.wkwxArchitecture : DATA.architecture;
  }
  function getMeta() {
    return currentPlatform === 'wkwx' ? (DATA.wkwxMeta || DATA.meta) : DATA.meta;
  }
  function getScenarios() {
    return currentPlatform === 'wkwx' ? (DATA.wkwxScenarios || []) : DATA.scenarios;
  }
  function getCategories() {
    return currentPlatform === 'wkwx' ? (DATA.wkwxCategories || DATA.categories) : DATA.categories;
  }
  function getMqttTaskCategories() {
    return currentPlatform === 'wkwx' ? (DATA.wkwxMqttTaskCategories || []) : (DATA.mqttTaskCategories || []);
  }
  function getUpstreamCategories() {
    return currentPlatform === 'wkwx' ? (DATA.wkwxUpstreamCategories || []) : [];
  }

  // ================================================================
  //  初始化
  // ================================================================

  document.addEventListener('DOMContentLoaded', function () {
    initMermaid();
    renderSidebar();
    bindEvents();

    var initTarget = parseHash();
    if (initTarget) {
      selectView(initTarget);
    } else {
      showOverview();
    }
  });

  function initMermaid() {
    if (typeof mermaid !== 'undefined') {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: {
          darkMode: true,
          background: '#1e2433',
          primaryColor: '#2a3a5c',
          primaryTextColor: '#e4e8f1',
          primaryBorderColor: '#4fc3f7',
          lineColor: '#5c6578',
          secondaryColor: '#1e3a2a',
          tertiaryColor: '#3a2a1e',
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
          fontSize: '13px',
        },
        flowchart: {
          useMaxWidth: true,
          htmlLabels: true,
          curve: 'basis',
        },
      });
      mermaidReady = true;
    }
  }

  // ================================================================
  //  侧边栏
  // ================================================================

  function renderSidebar() {
    var container = document.getElementById('sidebar-categories');
    var html = '';
    var cats = getCategories();
    var scenarios = getScenarios();

    cats.forEach(function (cat) {
      var items = scenarios.filter(function (s) { return s.category === cat.id; });
      html += '<div class="sidebar-category" data-category="' + cat.id + '">';
      html += '<div class="sidebar-category-title">' + cat.icon + ' ' + cat.name + '</div>';
      items.forEach(function (s) {
        html += '<button class="sidebar-item" data-id="' + s.id + '" data-tags="' + (s.tags || []).join(',') + '">';
        html += '<span class="sidebar-icon">›</span>';
        html += '<span class="sidebar-text">' + s.name + '</span>';
        html += '</button>';
      });
      html += '</div>';
    });

    container.innerHTML = html;
  }

  // ================================================================
  //  事件绑定
  // ================================================================

  function bindEvents() {
    document.getElementById('sidebar').addEventListener('click', function (e) {
      var btn = e.target.closest('.sidebar-item');
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      selectView(id);
    });

    document.getElementById('search-input').addEventListener('input', function (e) {
      filterSidebar(e.target.value.trim().toLowerCase());
    });

    document.getElementById('detail-close').addEventListener('click', closeDetail);
    document.getElementById('detail-overlay').addEventListener('click', function (e) {
      if (e.target === this) closeDetail();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDetail();
    });

    document.getElementById('platform-toggle').addEventListener('click', function (e) {
      var btn = e.target.closest('.platform-btn');
      if (!btn || btn.classList.contains('disabled')) return;
      var platform = btn.getAttribute('data-platform');
      if (platform === currentPlatform) return;
      currentPlatform = platform;
      document.querySelectorAll('.platform-btn').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-platform') === platform);
      });
      renderSidebar();
      updateHeaderBadges();
      selectView('__overview__');
    });

    window.addEventListener('hashchange', function () {
      if (hashUpdating) return;
      var target = parseHash();
      if (target && target !== currentView) {
        selectView(target);
      }
    });
  }

  function parseHash() {
    var hash = window.location.hash.replace(/^#\/?/, '');
    if (!hash) return null;
    if (hash === 'overview') return '__overview__';
    if (hash === 'sls') return '__sls__';
    if (hash.indexOf('scenario/') === 0) {
      return hash.substring('scenario/'.length);
    }
    return hash;
  }

  function updateHash(viewId) {
    var hash;
    if (viewId === '__overview__') {
      hash = '#overview';
    } else if (viewId === '__sls__') {
      hash = '#sls';
    } else {
      hash = '#scenario/' + viewId;
    }
    hashUpdating = true;
    window.location.hash = hash;
    hashUpdating = false;
  }

  function selectView(id) {
    currentView = id;
    updateHash(id);

    document.querySelectorAll('.sidebar-item').forEach(function (el) {
      el.classList.toggle('active', el.getAttribute('data-id') === id);
    });

    if (id === '__overview__') {
      showOverview();
    } else if (id === '__sls__') {
      showSlsGuide();
    } else {
      showScenario(id);
    }
  }

  function filterSidebar(query) {
    document.querySelectorAll('.sidebar-item[data-tags]').forEach(function (el) {
      if (!query) {
        el.classList.remove('hidden');
        return;
      }
      var name = el.querySelector('.sidebar-text').textContent.toLowerCase();
      var tags = (el.getAttribute('data-tags') || '').toLowerCase();
      var match = name.indexOf(query) !== -1 || tags.indexOf(query) !== -1;
      el.classList.toggle('hidden', !match);
    });
  }

  // ================================================================
  //  架构总览
  // ================================================================

  function showOverview() {
    nodeRegistry = [];
    var content = document.getElementById('content');
    var arch = getArchitecture();
    var meta = getMeta();

    var html = '';
    html += '<div class="overview-header">';
    html += '<h2>系统架构总览</h2>';
    html += '<p>' + meta.note + '</p>';
    if (meta.dirNote) {
      html += '<p class="overview-summary" style="font-size:12px;color:var(--text-muted)">' + escapeHtml(meta.dirNote) + '</p>';
    }
    html += '<p class="overview-summary">' + escapeHtml(arch.summary) + '</p>';
    html += '</div>';

    html += renderLinkTypesLegend();

    arch.links.forEach(function (link, li) {
      html += renderLinkCard(link, li);
    });

    content.innerHTML = html;

    arch.links.forEach(function (link, li) {
      var card = document.getElementById('link-card-' + li);
      if (!card) return;
      card.querySelector('.link-card-header').addEventListener('click', function () {
        toggleLinkCard(li);
      });
    });
  }

  function renderLinkCard(link, index) {
    var html = '';
    html += '<div class="link-card" id="link-card-' + index + '">';

    html += '<div class="link-card-header" role="button" tabindex="0">';
    html += '<span class="link-card-toggle">▶</span>';
    html += '<span class="link-card-color" style="background:' + (link.color || '#4fc3f7') + '"></span>';
    html += '<div class="link-card-title">' + escapeHtml(link.name) + '</div>';
    html += '<div class="link-card-desc">' + escapeHtml(link.description) + '</div>';
    html += '</div>';

    html += '<div class="link-card-body" style="display:none">';

    var mermaidId = 'link-mermaid-' + index;
    var asciiId = 'link-ascii-' + index;

    html += '<div class="link-body-layout">';

    // 左栏：流程图
    html += '<div class="link-body-left">';
    html += '<div class="view-toggle" data-flow="' + index + '">';
    html += '<button class="active" data-view="mermaid">Mermaid</button>';
    html += '<button data-view="ascii">ASCII</button>';
    html += '</div>';
    html += '<div id="' + mermaidId + '" class="diagram-container">';
    html += '<div class="mermaid">' + link.mermaid + '</div>';
    html += '</div>';
    html += '<div id="' + asciiId + '" class="ascii-container" style="display:none">';
    html += '<pre>' + escapeHtml(link.ascii) + '</pre>';
    html += '</div>';
    html += '</div>';

    // 右栏：节点列表
    html += '<div class="link-body-right">';
    html += '<h4 class="link-nodes-title">处理节点详情（点击查看完整信息）</h4>';
    html += '<div class="node-list">';
    var direction = link.direction || 'downstream';
    link.nodes.forEach(function (node, ni) {
      html += renderNodeItem(node, ni, link.nodes.length, direction);
      if (node.arrow && ni < link.nodes.length - 1) {
        html += renderNodeArrow(node.arrow);
      }
    });
    html += '</div>';
    html += '</div>';

    html += '</div>'; // end link-body-layout

    // 全宽区域：MQTT任务清单 / 上行处理器清单 / 说明注释
    if (link.id === 'link_downstream' || link.id === 'wkwx_link_downstream') {
      html += renderMqttTaskCategories();
    }
    if (link.id === 'wkwx_link_upstream' || link.id === 'wkwx_link_front_push' || link.id === 'wkwx_link_http_upload') {
      html += renderUpstreamCategories(link.id);
    }
    if (link.taskListNote) {
      html += '<div class="link-task-note">';
      html += '<span class="task-note-icon">ℹ</span>';
      html += '<span>' + escapeHtml(link.taskListNote) + '</span>';
      html += '</div>';
    }

    html += '</div>';
    html += '</div>';
    return html;
  }

  function toggleLinkCard(index) {
    var card = document.getElementById('link-card-' + index);
    if (!card) return;
    var body = card.querySelector('.link-card-body');
    var toggle = card.querySelector('.link-card-toggle');
    var isOpen = body.style.display !== 'none';

    if (isOpen) {
      body.style.display = 'none';
      toggle.textContent = '▶';
      card.classList.remove('expanded');
    } else {
      body.style.display = '';
      toggle.textContent = '▼';
      card.classList.add('expanded');

      var mermaidId = 'link-mermaid-' + index;
      var asciiId = 'link-ascii-' + index;
      bindViewToggle(mermaidId, asciiId);
      renderMermaidElements();
    }
  }

  // ================================================================
  //  MQTT 任务类型清单
  // ================================================================

  function renderMqttTaskCategories() {
    var cats = getMqttTaskCategories();
    if (!cats || cats.length === 0) return '';

    var isWkwx = currentPlatform === 'wkwx';
    var html = '';
    html += '<div class="mqtt-task-section">';
    html += '<h3 class="mqtt-task-title">MQTT 任务类型清单</h3>';
    html += '<p class="mqtt-task-subtitle">云端下发的全部任务类型（共 ' + countAllTasks(cats) + ' 种），点击大类展开查看</p>';
    html += '<div class="mqtt-dir-note">';
    if (isWkwx) {
      html += '<strong>处理器目录说明：</strong>';
      html += '<code>task-mqtt/wkwx/</code> — 企业微信处理器（25个，注册至 WorkWxConvertServiceList，由 mqttClientBase.js runTask() 中 registry.workWx=true 分支遍历调用）';
    } else {
      html += '<strong>处理器目录说明：</strong>';
      html += '<code>task-mqtt/wx/</code> — 个人微信处理器（16个，均已注册至 WxConvertServiceList）；';
      html += '<code>task-mqtt/wkwx/</code> — 企业微信处理器（注册至 WorkWxConvertServiceList，独立管理）；';
      html += '<code>task-mqtt/</code> 根目录含 <code>mqttChangeRemarkWx4Service.js</code>，状态待确认。';
    }
    html += '</div>';

    cats.forEach(function (cat, ci) {
      html += '<div class="mqtt-cat" id="mqtt-cat-' + ci + '">';
      html += '<div class="mqtt-cat-header" role="button" tabindex="0" onclick="APP.toggleMqttCat(' + ci + ')">';
      html += '<span class="mqtt-cat-toggle">▶</span>';
      html += '<span class="mqtt-cat-name">' + escapeHtml(cat.name) + '</span>';
      html += '<span class="mqtt-cat-range">' + escapeHtml(cat.typeRange) + '</span>';
      html += '<span class="mqtt-cat-count">' + cat.items.length + ' 种</span>';
      html += '</div>';

      html += '<div class="mqtt-cat-body" style="display:none">';
      html += '<table class="mqtt-task-table">';
      html += '<thead><tr>';
      html += '<th>Type</th><th>名称</th><th>处理器</th><th>详情</th>';
      html += '</tr></thead>';
      html += '<tbody>';
      cat.items.forEach(function (item) {
        html += '<tr>';
        html += '<td class="mqtt-type-code">' + item.type + '</td>';
        html += '<td>' + escapeHtml(item.name) + '</td>';
        html += '<td class="mqtt-handler">' + escapeHtml(item.handler) + '</td>';
        html += '<td>';
        if (item.scenarioId) {
          html += '<a class="mqtt-link" href="#scenario/' + item.scenarioId + '" onclick="APP.navigateTo(\'' + item.scenarioId + '\');return false;">查看链路 →</a>';
        } else {
          html += '<span class="mqtt-no-link">-</span>';
        }
        html += '</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
      html += '</div>';
      html += '</div>';
    });

    html += '</div>';
    return html;
  }

  function renderUpstreamCategories(linkId) {
    var allCats = getUpstreamCategories();
    if (!allCats || allCats.length === 0) return '';

    var filterMap = {
      'wkwx_link_upstream': ['wkwx_common_service', 'wkwx_convert_service', 'wkwx_convert_response'],
      'wkwx_link_front_push': ['wkwx_front_strategy'],
      'wkwx_link_http_upload': ['wkwx_http_endpoints'],
    };
    var allowedIds = filterMap[linkId] || [];
    var cats = allCats.filter(function (c) { return allowedIds.indexOf(c.id) !== -1; });
    if (cats.length === 0) return '';

    var titleMap = {
      'wkwx_link_upstream': '上行消息处理器清单（WorkWxConvertServiceList）',
      'wkwx_link_front_push': '企微前端推送策略清单（SendMsg2FrontStrategyList）',
      'wkwx_link_http_upload': '企微 HTTP 上报端点清单',
    };

    var html = '';
    html += '<div class="mqtt-task-section">';
    html += '<h3 class="mqtt-task-title">' + (titleMap[linkId] || '处理器清单') + '</h3>';
    html += '<p class="mqtt-task-subtitle">共 ' + countAllTasks(cats) + ' 个处理器，点击大类展开查看</p>';

    cats.forEach(function (cat, ci) {
      var catIdx = 'upstream-cat-' + linkId + '-' + ci;
      html += '<div class="mqtt-cat" id="' + catIdx + '">';
      html += '<div class="mqtt-cat-header" role="button" tabindex="0" onclick="APP.toggleUpstreamCat(\'' + catIdx + '\')">';
      html += '<span class="mqtt-cat-toggle">▶</span>';
      html += '<span class="mqtt-cat-name">' + escapeHtml(cat.name) + '</span>';
      html += '<span class="mqtt-cat-range">' + escapeHtml(cat.typeRange) + '</span>';
      html += '<span class="mqtt-cat-count">' + cat.items.length + ' 个</span>';
      html += '</div>';

      html += '<div class="mqtt-cat-body" style="display:none">';
      html += '<table class="mqtt-task-table">';
      html += '<thead><tr>';
      html += '<th>Type / 触发条件</th><th>名称</th><th>处理器文件</th>';
      html += '</tr></thead>';
      html += '<tbody>';
      cat.items.forEach(function (item) {
        html += '<tr>';
        html += '<td class="mqtt-type-code">' + escapeHtml(String(item.type)) + '</td>';
        html += '<td>' + escapeHtml(item.name) + '</td>';
        html += '<td class="mqtt-handler">' + escapeHtml(item.handler) + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
      html += '</div>';
      html += '</div>';
    });

    html += '</div>';
    return html;
  }

  function toggleUpstreamCat(catId) {
    var el = document.getElementById(catId);
    if (!el) return;
    var body = el.querySelector('.mqtt-cat-body');
    var toggle = el.querySelector('.mqtt-cat-toggle');
    var isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : '';
    toggle.textContent = isOpen ? '▶' : '▼';
  }

  function countAllTasks(cats) {
    var n = 0;
    cats.forEach(function (c) { n += c.items.length; });
    return n;
  }

  function toggleMqttCat(index) {
    var el = document.getElementById('mqtt-cat-' + index);
    if (!el) return;
    var body = el.querySelector('.mqtt-cat-body');
    var toggle = el.querySelector('.mqtt-cat-toggle');
    var isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : '';
    toggle.textContent = isOpen ? '▶' : '▼';
  }

  function updateHeaderBadges() {
    var versionBadge = document.querySelector('.badge-version');
    var noteBadge = document.querySelector('.badge-note');
    if (currentPlatform === 'wkwx') {
      if (versionBadge) versionBadge.textContent = '企业微信';
      if (noteBadge) noteBadge.textContent = '仅企业微信';
    } else {
      if (versionBadge) versionBadge.textContent = '微信 4.0';
      if (noteBadge) noteBadge.textContent = '仅个人微信';
    }
  }

  function renderLinkTypesLegend() {
    var html = '<div class="link-types-legend">';
    html += '<h3>数据链路类型</h3>';
    html += '<div class="link-types-list">';
    DATA.linkTypes.forEach(function (lt) {
      html += '<div class="link-type-item">';
      html += '<span class="link-type-dot" style="background:' + lt.color + '"></span>';
      html += '<span class="link-type-label">' + lt.arrow + ' ' + lt.name + '</span>';
      html += '</div>';
    });
    html += '</div></div>';
    return html;
  }

  // ================================================================
  //  SLS 日志查询指南
  // ================================================================

  function showSlsGuide() {
    var content = document.getElementById('content');
    var sls = DATA.meta.slsConfig;
    var apis = DATA.meta.keyApis;

    var html = '';
    html += '<div class="overview-header"><h2>阿里云日志查询指南</h2>';
    html += '<p>排查问题时使用的日志服务和查询方法</p></div>';

    html += '<div class="sls-section">';
    html += '<h3>SLS 日志服务配置</h3>';
    html += '<table class="sls-table">';
    html += '<tr><th>配置项</th><th>值</th></tr>';
    html += '<tr><td>Endpoint</td><td><code>' + sls.endpoint + '</code></td></tr>';
    html += '<tr><td>Logstore</td><td><code>' + sls.logstore + '</code></td></tr>';
    html += '<tr><td>日志格式</td><td><code>' + sls.logFormat + '</code></td></tr>';
    html += '</table></div>';

    html += '<div class="sls-section">';
    html += '<h3>常用 SLS 查询</h3>';
    html += '<table class="sls-table">';
    html += '<tr><th>场景</th><th>查询关键词</th><th>说明</th></tr>';
    sls.commonQueries.forEach(function (q) {
      html += '<tr><td>' + q.field + '</td><td><code>' + escapeHtml(q.query) + '</code></td><td>' + q.desc + '</td></tr>';
    });
    html += '</table></div>';

    html += '<div class="sls-section">';
    html += '<h3>哈勃 (Habo) 监控查询</h3>';
    html += '<table class="sls-table">';
    html += '<tr><th>场景</th><th>查询关键词</th><th>说明</th></tr>';
    sls.haboQueries.forEach(function (q) {
      html += '<tr><td>' + q.field + '</td><td><code>' + escapeHtml(q.query) + '</code></td><td>' + q.desc + '</td></tr>';
    });
    html += '</table></div>';

    html += '<div class="sls-section">';
    html += '<h3>关键 API 地址</h3>';
    html += '<table class="sls-table">';
    html += '<tr><th>用途</th><th>生产环境</th><th>测试环境</th></tr>';
    Object.keys(apis.prod).forEach(function (k) {
      html += '<tr><td>' + k + '</td><td><code>' + apis.prod[k] + '</code></td><td><code>' + apis.test[k] + '</code></td></tr>';
    });
    html += '</table></div>';

    html += '<div class="sls-section">';
    html += '<h3>排查流程建议</h3>';
    html += '<div class="detail-block-content">';
    html += '1. 确认用户的 wxid 和 GID\n';
    html += '2. 在 SLS 中按 wxid 搜索，缩小时间范围\n';
    html += '3. 查看对应时间段的日志，定位到具体链路节点\n';
    html += '4. 根据 taskId 追踪任务全链路\n';
    html += '5. 如有崩溃，同时查看哈勃 UNCAUGHT_EXCEPTION\n';
    html += '6. 如有 MQTT 问题，搜索 MqttClientUtil-send 或 MQTT_SEND_TIMEOUT\n';
    html += '7. 如有 IPC 问题，搜索 asyncSelectTask 或 IpcSelectCltChannel';
    html += '</div></div>';

    content.innerHTML = html;
  }

  // ================================================================
  //  场景视图
  // ================================================================

  function showScenario(id) {
    var scenarios = getScenarios();
    var scenario = scenarios.find(function (s) { return s.id === id; });
    if (!scenario) return;

    nodeRegistry = [];
    var content = document.getElementById('content');
    var html = '';

    html += '<div class="scenario-header">';
    html += '<div class="scenario-title">' + scenario.name + '</div>';
    html += '<div class="scenario-desc">' + scenario.description + '</div>';

    html += '<div class="scenario-meta">';
    if (scenario.mqttTaskType) {
      html += '<span class="meta-item"><strong>MQTT Task Type:</strong> ' + escapeHtml(scenario.mqttTaskType) + '</span>';
    }
    html += '</div>';

    html += '<div class="scenario-tags">';
    (scenario.tags || []).forEach(function (t) {
      html += '<span class="tag">' + t + '</span>';
    });
    html += '</div>';

    if (scenario.reverseApi) {
      html += '<div class="reverse-api-section">';
      html += '<div class="reverse-api-title">逆向端接口 (微信4.0)</div>';
      html += '<ul class="reverse-api-list">';
      scenario.reverseApi.types.forEach(function (t) {
        html += '<li><code>' + t.type + '</code> — ' + t.name + ' (' + t.ref + ')</li>';
      });
      html += '</ul></div>';
    }
    html += '</div>';

    scenario.flows.forEach(function (flow, fi) {
      html += renderFlowSection(flow, fi, scenario.id);
    });

    if (scenario.troubleshoot) {
      html += renderTroubleshoot(scenario.troubleshoot);
    }

    content.innerHTML = html;

    content.querySelectorAll('.view-toggle').forEach(function (toggle) {
      var fIdx = toggle.getAttribute('data-flow');
      var mermaidId = 'flow-mermaid-' + scenario.id + '-' + fIdx;
      var asciiId = 'flow-ascii-' + scenario.id + '-' + fIdx;
      bindViewToggle(mermaidId, asciiId);
    });

    renderMermaidElements();
  }

  function renderTroubleshoot(ts) {
    var html = '';
    html += '<div class="troubleshoot-section">';
    html += '<h3 class="troubleshoot-title">🔍 ' + escapeHtml(ts.title) + '</h3>';
    html += '<p class="troubleshoot-desc">' + escapeHtml(ts.description) + '</p>';

    if (ts.stateMachine) {
      html += '<div class="ts-state-machine">';
      html += '<h4 class="ts-sm-title">' + escapeHtml(ts.stateMachine.title) + '</h4>';
      html += '<p class="ts-sm-desc">' + escapeHtml(ts.stateMachine.description) + '</p>';
      html += '<div class="ts-sm-flow">';
      ts.stateMachine.states.forEach(function (s, i) {
        html += '<div class="ts-sm-state">';
        html += '<div class="ts-sm-value">' + escapeHtml(s.value) + '</div>';
        html += '<div class="ts-sm-label">' + escapeHtml(s.label) + '</div>';
        html += '<div class="ts-sm-desc-inner">' + escapeHtml(s.desc) + '</div>';
        html += '</div>';
        if (i < ts.stateMachine.states.length - 1) {
          html += '<div class="ts-sm-arrow">→</div>';
        }
      });
      html += '</div>';
      if (ts.stateMachine.note) {
        html += '<div class="ts-sm-note">' + escapeHtml(ts.stateMachine.note) + '</div>';
      }
      html += '</div>';
    }

    html += '<div class="ts-steps">';
    ts.steps.forEach(function (step, i) {
      html += '<div class="ts-step">';
      html += '<div class="ts-step-header">';
      html += '<span class="ts-step-num">' + (i + 1) + '</span>';
      html += '<span class="ts-step-name">' + escapeHtml(step.name) + '</span>';
      html += '</div>';
      html += '<div class="ts-step-body">';
      html += '<div class="ts-field"><label>SLS 查询：</label><code class="ts-query">' + escapeHtml(step.query) + '</code></div>';
      html += '<div class="ts-field ts-expect"><label>预期结果：</label><span>' + escapeHtml(step.expect) + '</span></div>';
      html += '<div class="ts-field ts-fail"><label>异常判断：</label><span>' + escapeHtml(step.fail) + '</span></div>';
      html += '<div class="ts-field ts-fix"><label>处理建议：</label><span>' + escapeHtml(step.fix) + '</span></div>';
      html += '</div>';
      html += '</div>';
    });
    html += '</div>';

    html += '</div>';
    return html;
  }

  function renderFlowSection(flow, flowIndex, scenarioId) {
    var direction = flow.direction || 'downstream';
    var html = '';

    html += '<div class="flow-section">';
    html += '<div class="flow-title ' + direction + '">';
    html += flow.name;
    html += '<span class="flow-direction-badge ' + direction + '">';
    html += getDirectionLabel(direction);
    html += '</span>';
    html += '</div>';

    var mermaidId = 'flow-mermaid-' + scenarioId + '-' + flowIndex;
    var asciiId = 'flow-ascii-' + scenarioId + '-' + flowIndex;

    html += '<div class="view-toggle" data-flow="' + flowIndex + '">';
    html += '<button class="active" data-view="mermaid">Mermaid</button>';
    html += '<button data-view="ascii">ASCII</button>';
    html += '</div>';

    html += '<div id="' + mermaidId + '" class="diagram-container">';
    html += '<div class="mermaid">' + generateMermaidCode(flow) + '</div>';
    html += '</div>';

    html += '<div id="' + asciiId + '" class="ascii-container" style="display:none">';
    html += '<pre>' + escapeHtml(generateAsciiDiagram(flow)) + '</pre>';
    html += '</div>';

    html += '<h4 style="font-size:14px;color:var(--text-muted);margin:16px 0 8px;font-weight:600">处理节点详情（点击查看完整信息）</h4>';

    html += '<div class="node-list">';
    flow.steps.forEach(function (step, si) {
      html += renderNodeItem(step, si, flow.steps.length, direction);
      if (step.arrow && si < flow.steps.length - 1) {
        html += renderNodeArrow(step.arrow);
      }
    });
    html += '</div>';

    html += '</div>';
    return html;
  }

  function renderNodeItem(step, index, total, direction) {
    var regIdx = nodeRegistry.length;
    nodeRegistry.push(step);

    var html = '';
    html += '<div class="node-item" role="button" tabindex="0" onclick="APP.showNodeDetail(' + regIdx + ')">';
    html += '<div class="node-dot ' + direction + '"></div>';
    html += '<div class="node-info">';
    html += '<div class="node-name">' + escapeHtml(step.name) + '</div>';
    html += renderCopyablePath(step.file, 'node-file');
    html += '<div class="node-func">' + escapeHtml(step.func) + '</div>';
    html += '<div class="node-summary">' + escapeHtml(step.summary) + '</div>';
    html += '</div>';
    html += '<span class="node-click-hint">点击查看详情 →</span>';
    html += '</div>';
    return html;
  }

  function renderNodeArrow(label) {
    return '<div class="node-arrow"><span class="node-arrow-text"><span class="node-arrow-icon">↓</span> ' + escapeHtml(label) + '</span></div>';
  }

  // ================================================================
  //  Mermaid 图生成
  // ================================================================

  function generateMermaidCode(flow) {
    var lines = ['graph TD'];
    var steps = flow.steps;

    steps.forEach(function (step, i) {
      var nodeId = 's' + i;
      var safeName = mermaidSafe(step.name);
      var safeFile = mermaidSafe(shortFile(step.file));
      var label = safeName + '<br/>' + safeFile;
      lines.push('    ' + nodeId + '["' + label + '"]');
    });

    for (var i = 0; i < steps.length - 1; i++) {
      var arrow = steps[i].arrow || '';
      if (arrow) {
        lines.push('    s' + i + ' -->|"' + mermaidSafe(arrow) + '"| s' + (i + 1));
      } else {
        lines.push('    s' + i + ' --> s' + (i + 1));
      }
    }

    steps.forEach(function (step, i) {
      var nodeId = 's' + i;
      if (i === 0 || i === steps.length - 1) {
        lines.push('    style ' + nodeId + ' fill:#1a3a5c,stroke:#4fc3f7,color:#e4e8f1');
      } else if (step.icon === 'handler') {
        lines.push('    style ' + nodeId + ' fill:#2a1a3a,stroke:#ab47bc,color:#e4e8f1');
      }
    });

    return lines.join('\n');
  }

  function mermaidSafe(str) {
    if (!str) return '';
    return str.replace(/"/g, "'").replace(/[[\]{}()]/g, ' ').replace(/</g, '').replace(/>/g, '');
  }

  function generateAsciiDiagram(flow) {
    var lines = [];
    var maxLen = 0;

    flow.steps.forEach(function (step) {
      var len = step.name.length + shortFile(step.file).length + 5;
      if (len > maxLen) maxLen = len;
    });

    var boxW = Math.max(maxLen, 50);

    flow.steps.forEach(function (step, i) {
      var name = step.name;
      var file = shortFile(step.file);
      var func = step.func;

      lines.push('┌' + repeat('─', boxW) + '┐');
      lines.push('│ ' + padRight(name, boxW - 2) + ' │');
      lines.push('│ ' + padRight('文件: ' + file, boxW - 2) + ' │');
      lines.push('│ ' + padRight('函数: ' + func, boxW - 2) + ' │');
      lines.push('└' + repeat('─', boxW) + '┘');

      if (step.arrow && i < flow.steps.length - 1) {
        var arrowText = '↓ ' + step.arrow;
        var pad = Math.floor((boxW - arrowText.length) / 2);
        lines.push(repeat(' ', Math.max(pad, 2)) + arrowText);
      }
    });

    return lines.join('\n');
  }

  // ================================================================
  //  详情面板
  // ================================================================

  function showNodeDetail(index) {
    var step = nodeRegistry[index];
    if (!step) return;
    var panel = document.getElementById('detail-content');
    var html = '';

    html += '<div class="detail-title">' + step.name + '</div>';
    html += renderCopyablePath(step.file, 'detail-file');
    html += renderCopyablePath(step.func, 'detail-func');

    if (step.lines) {
      html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:16px">代码行: ' + step.lines + '</div>';
    }

    html += renderDetailBlock('概述', step.summary);

    if (step.detail) {
      html += renderDetailBlock('处理逻辑详情', step.detail, true);
    }

    if (step.dataIn) {
      html += renderDetailBlock('输入数据', step.dataIn, true);
    }

    if (step.dataOut) {
      html += renderDetailBlock('输出数据', step.dataOut, true);
    }

    if (step.logKeywords && step.logKeywords.length > 0) {
      html += '<div class="detail-block">';
      html += '<div class="detail-block-title">SLS 日志搜索关键词</div>';
      html += '<div class="detail-keywords">';
      step.logKeywords.forEach(function (kw) {
        html += '<span class="detail-keyword">' + escapeHtml(kw) + '</span>';
      });
      html += '</div></div>';
    }

    if (step.logQuery) {
      html += renderDetailBlock('日志查询建议', step.logQuery, true);
    }

    if (step.cacheOps) {
      html += renderDetailBlock('缓存操作', step.cacheOps, true);
    }

    if (step.dbOps) {
      html += renderDetailBlock('数据库操作', step.dbOps, true);
    }

    panel.innerHTML = html;

    var overlay = document.getElementById('detail-overlay');
    overlay.classList.add('visible');
  }

  function closeDetail() {
    document.getElementById('detail-overlay').classList.remove('visible');
  }

  function renderDetailBlock(title, content, mono) {
    var html = '<div class="detail-block">';
    html += '<div class="detail-block-title">' + title + '</div>';
    html += '<div class="detail-block-content' + (mono ? ' mono' : '') + '">' + escapeHtml(content) + '</div>';
    html += '</div>';
    return html;
  }

  // ================================================================
  //  视图切换
  // ================================================================

  function bindViewToggle(mermaidId, asciiId) {
    var mermaidEl = document.getElementById(mermaidId);
    var asciiEl = document.getElementById(asciiId);
    if (!mermaidEl || !asciiEl) return;

    var toggle = mermaidEl.previousElementSibling;
    if (!toggle || !toggle.classList.contains('view-toggle')) return;

    toggle.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      var view = btn.getAttribute('data-view');

      toggle.querySelectorAll('button').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');

      if (view === 'mermaid') {
        mermaidEl.style.display = '';
        asciiEl.style.display = 'none';
      } else {
        mermaidEl.style.display = 'none';
        asciiEl.style.display = '';
      }
    });
  }

  // ================================================================
  //  Mermaid 渲染
  // ================================================================

  var mermaidCounter = 0;

  function renderMermaidElements() {
    if (!mermaidReady) return;

    var elements = document.querySelectorAll('.mermaid:not([data-processed])');
    if (elements.length === 0) return;

    elements.forEach(function (el) {
      el.setAttribute('data-processed', 'true');
      var code = el.textContent.trim();
      if (!code) return;

      var id = 'mermaid-svg-' + (mermaidCounter++);
      try {
        mermaid.render(id, code).then(function (result) {
          el.innerHTML = result.svg;
        }).catch(function (err) {
          console.warn('Mermaid render error:', err);
          el.innerHTML = '<pre style="color:var(--accent-red);font-size:12px">Mermaid 渲染失败，请检查网络连接\n' + escapeHtml(code) + '</pre>';
        });
      } catch (e) {
        console.warn('Mermaid error:', e);
        el.innerHTML = '<pre style="color:var(--text-secondary);font-size:12px">' + escapeHtml(code) + '</pre>';
      }
    });
  }

  // ================================================================
  //  工具函数
  // ================================================================

  function renderCopyablePath(text, className) {
    if (!text) return '<div class="' + className + '"></div>';
    var safeText = escapeHtml(text);
    var safeAttr = text.replace(/'/g, '&#39;').replace(/"/g, '&quot;');
    return '<div class="' + className + ' copyable-path">'
      + '<span class="copyable-path-text">' + safeText + '</span>'
      + '<span class="copy-btn" title="复制路径" onclick="event.stopPropagation();APP.copyText(\'' + safeAttr + '\', this)">&#xe901;</span>'
      + '</div>';
  }

  function copyText(text, triggerEl) {
    var decoded = text.replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(decoded).then(function () {
        showCopySuccess(triggerEl);
      }).catch(function () {
        fallbackCopy(decoded, triggerEl);
      });
    } else {
      fallbackCopy(decoded, triggerEl);
    }
  }

  function fallbackCopy(text, triggerEl) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showCopySuccess(triggerEl); } catch (e) {}
    document.body.removeChild(ta);
  }

  function showCopySuccess(el) {
    if (!el) return;
    el.classList.add('copied');
    setTimeout(function () { el.classList.remove('copied'); }, 1500);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function shortFile(filepath) {
    if (!filepath) return '';
    var parts = filepath.split('/');
    if (parts.length <= 2) return filepath;
    return parts.slice(-2).join('/');
  }

  function padRight(str, len) {
    var s = str || '';
    var cLen = getStringWidth(s);
    if (cLen >= len) return s;
    return s + repeat(' ', len - cLen);
  }

  function getStringWidth(str) {
    var w = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      w += (c > 0x7f) ? 2 : 1;
    }
    return w;
  }

  function repeat(ch, n) {
    if (n <= 0) return '';
    return new Array(n + 1).join(ch);
  }

  function getDirectionLabel(dir) {
    var map = {
      'downstream': '↓ 下行',
      'upstream': '↑ 上行',
      'upstream-event': '↑ 被动事件',
      'upstream-http': '↑ HTTP上报',
      'front-up': '↑ 前端推送',
      'front-down': '↓ 前端下行',
    };
    return map[dir] || dir;
  }

  window.APP = {
    showNodeDetail: showNodeDetail,
    navigateTo: function (scenarioId) { selectView(scenarioId); },
    toggleMqttCat: toggleMqttCat,
    toggleUpstreamCat: toggleUpstreamCat,
    copyText: copyText,
  };
})();
