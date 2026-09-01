(function () {
  'use strict';

  // 系统框架为纯平台主体：不内置任何游戏引擎/逻辑，所有游戏均由插件通过 GameFramework 注册。
  // 系统级版本号：联机版本门控属于系统框架职责
  var APP_VERSION = '2.3.29';

  var G = {
    mode: null,
    state: null,
    myPlayerId: null,
    ws: null,
    room: null,
    isHost: false,
    mySeat: -1,
    animating: false,
    evQueue: [],
    dice: [1, 1],
    selectedStock: null
  };

  var $ = function (id) { return document.getElementById(id); };

  var UI = window.UI = {};

  // 暴露共享宿主状态给游戏插件（供插件读取 G.state/G.mode 等）
  window.G = G;
  window.__dshTools = {
    modal: function (o) { return modal(o); },
    toast: function (t, c) { toast(t, c); },
    escapeHtml: function (s) { return escapeHtml(s); },
    icon: function (n, s) { return icon(n, s); },
    $: function (id) { return $(id); },
    floatMsg: function (t, c) { floatMsg(t, c); },
    sendLan: function (msg) { sendLan(msg); },
    hostSend: function (connId, obj) { hostSend(connId, obj); },
    broadcastHost: function (obj) { broadcastHost(obj); },
    fmt: function (n) { return fmt(n); },
    playerById: function (state, id) { return playerById(state, id); },
    onAvatarClick: function (p) { onAvatarClick(p); },
    versionScore: function (v) { return versionScore(v); },
    getMode: function () { return G.mode; },
    setMode: function (m) { G.mode = m; },
    saveGame: function (gameId, slot) { return saveGame(gameId, slot); },
    listSaves: function (gameId) { return listSaves(gameId); },
    loadSave: function (gameId, slot) { return loadSave(gameId, slot); },
    deleteSave: function (gameId, slot) { deleteSave(gameId, slot); },
    formatSaveTime: function (t) { return formatSaveTime(t); },
    saveSlots: function () { return SAVE_SLOTS; },
    recordHistory: function (gameId) { recordGameHistory(gameId); },
    copyText: function (text, label) { copyText(text, label); },
    // 通用开发架构：插件读取系统设置（主题/浅色/亚克力）
    getSetting: function (key) {
      if (key === 'theme') return localStorage.getItem('theme') || 'yellow';
      if (key === 'light') return localStorage.getItem('light') === '1';
      if (key === 'acrylic') return localStorage.getItem('acrylic') !== '0';
      if (key === 'acrylicOpacity') return parseInt(localStorage.getItem('acrylic-opacity') || '40', 10);
      return localStorage.getItem(key);
    },
    // 亚克力材质作用于插件：返回当前亚克力状态供插件界面样式应用
    acrylicOn: function () { return localStorage.getItem('acrylic') !== '0'; },
    themeOn: function () { return localStorage.getItem('theme') || 'yellow'; },
    // 运行日志（debug）：插件可记录运行日志到设置页「运行日志」栏
    log: function (text, level) { addLog(text, level); },
    logs: function () { return loadLogs(); },
    logClear: function () { try { localStorage.removeItem(LOG_KEY); } catch (e) {} },
    // 游戏运行日志（通用接口）：记录某游戏的运行日志（game 为插件 id）
    logGame: function (game, text, level) { addLog(text, level, game); },
    gameLogs: function (game) {
      var all = loadLogs();
      if (!game) return all;
      return all.filter(function (e) { return e.g === game; });
    },
    // 标准开发日志：logEvent(level, module, desc, params)
    logEvent: function (level, module, desc, params, stack) { logEvent(level, module, desc, params, stack); },
    leaveLan: function () {
      if (G.isHostLobby) { UI.exitToMenu(); return; }
      if (G.ws) { try { G.ws.onclose = null; G.ws.close(); } catch (e) {} G.ws = null; }
      G.lobby = null;
      G.mode = null;
      G.selfReady = false;
    }
  };

  // ══════════════ 运行日志（标准开发日志）══════════════
  // 标准格式：[时间][等级][模块] 描述 | key=value, key2=value2；ERROR 追加堆栈。
  // 分级：INFO(关键业务节点) / DEBUG(入参/状态切换，可关闭) / WARN(非法/越界/重复) / ERROR(异常+堆栈)。
  // 环形缓冲上限 200 条。
  var LOG_KEY = 'app-log';
  var LOG_MAX = 200;
  function nowTime() {
    var d = new Date();
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
  }
  function loadLogs() {
    try {
      var raw = localStorage.getItem(LOG_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }
  function saveLogs(list) {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(-LOG_MAX))); } catch (e) {}
  }
  // 是否输出 DEBUG（可关闭）
  function debugEnabled() { return localStorage.getItem('log-debug') !== '0'; }
  // 结构化日志：level='info'|'debug'|'warn'|'error'；module=来源模块；params=上下文键值对象
  function addLog(text, level, game) {
    var list = loadLogs();
    var entry = { t: nowTime(), l: level || 'info', m: String(text).slice(0, 600) };
    if (game) entry.g = game; // 游戏来源（游戏id），无则为系统日志
    list.push(entry);
    saveLogs(list);
  }
  // 标准开发格式日志（带模块与参数）：GameFramework.logEvent(level, module, desc, params)
  var LOG_GAME_IDS = { poker: 1, sgs: 1, doudizhu: 1, monopoly: 1 };
  function logEvent(level, module, desc, params, stack) {
    level = level || 'info';
    if (level === 'debug' && !debugEnabled()) return;
    var text = '[' + (module || 'app') + '] ' + String(desc || '');
    if (params && typeof params === 'object') {
      var kvs = Object.keys(params).map(function (k) { return k + '=' + params[k]; });
      if (kvs.length) text += ' | ' + kvs.join(', ');
    }
    if (level === 'error' && stack) text += ' :: ' + stack;
    // 来源：module 为已知游戏 id 时作为游戏来源（便于筛选/显示游戏标签）
    var game = LOG_GAME_IDS[module] ? module : undefined;
    addLog(text, level, game);
  }
  // 拦截 console 输出（仅记录，不影响原输出）
  ['log', 'info', 'warn', 'error'].forEach(function (m) {
    var orig = console[m];
    console[m] = function () {
      try {
        var args = Array.prototype.slice.call(arguments);
        addLog(args.map(function (a) {
          if (a instanceof Error) return a.message;
          if (typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return String(a); } }
          return String(a);
        }).join(' '), m === 'error' ? 'err' : (m === 'warn' ? 'warn' : 'info'));
      } catch (e) {}
      if (orig) orig.apply(console, arguments);
    };
  });
  // 插件可调用：window.__dshTools.log('...', 'err'|'warn'|'ok'|'info')
  // 联机关键事件打点（由下方各流程调用 addLog）
  window.__dshLog = addLog;
  window.__dshLogs = loadLogs;
  window.__dshLogClear = function () { try { localStorage.removeItem(LOG_KEY); } catch (e) {} };

  // ── 线条矢量图标库（SVG stroke 风格，学习 YunX Material 图标）──
  // 统一用 currentColor + fill=none + stroke，随主题色联动
  function svgIcon(paths, size, viewBox) {
    var vb = viewBox || '0 0 24 24';
    var sz = size || 20;
    return '<svg width="' + sz + '" height="' + sz + '" viewBox="' + vb + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';
  }
  var ICONS = {
    game: svgIcon('<rect x="2" y="6" width="20" height="12" rx="4"/><path d="M8 12h0M14 9v6M10.5 10.5l-1.5 3M13.5 10.5l1.5 3"/>'),
    room: svgIcon('<path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>'),
    dice: svgIcon('<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.3"/><circle cx="16" cy="8" r="1.3"/><circle cx="8" cy="16" r="1.3"/><circle cx="16" cy="16" r="1.3"/><circle cx="12" cy="12" r="1.3"/>'),
    players: svgIcon('<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 4.8a3.5 3.5 0 010 6.4M17.5 14.3c2.2.8 3.5 2.6 3.5 5.7"/>'),
    chat: svgIcon('<path d="M21 12a8 8 0 01-8 8H4l2.3-2.9A8 8 0 1121 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/>'),
    bot: svgIcon('<rect x="4" y="8" width="16" height="11" rx="3"/><circle cx="9" cy="13" r="1.2"/><circle cx="15" cy="13" r="1.2"/><path d="M12 8V4M8 4h8"/>'),
    stock: svgIcon('<path d="M3 3v18h18"/><path d="M7 14l3-4 3 3 4-6"/>'),
    exit: svgIcon('<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>'),
    clock: svgIcon('<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 13.5"/>'),
    manage: svgIcon('<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/><path d="M9 11h.01M15 11h.01"/>'),
    trade: svgIcon('<path d="M7 7h13l-3 5H10l-3-5z"/><circle cx="10" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>'),
    trendUp: svgIcon('<polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/>'),
    trendDown: svgIcon('<polyline points="3 7 9 13 13 9 21 17"/><polyline points="15 17 21 17 21 11"/>'),
    save: svgIcon('<path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>'),
    trash: svgIcon('<path d="M3 6h18"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/>'),
    play: svgIcon('<polygon points="7 4 19 12 7 20 7 4" fill="currentColor" stroke="none"/>'),
    newGame: svgIcon('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'),
    folder: svgIcon('<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>'),
    cards: svgIcon('<rect x="3" y="6" width="13" height="16" rx="2" transform="rotate(8 3 6)"/><path d="M6 9h7M6 13h7M6 17h7"/><rect x="8" y="3" width="13" height="16" rx="2" transform="rotate(-6 8 3)"/><path d="M11 6h7M11 10h7M11 14h7"/>'),
    // 两把刀交锋（三国杀）
    swords: svgIcon('<path d="M4 20L11 13M11 13l-1.5-5.5L14 3l6 6-4.5 4.5L10 12"/><path d="M20 4l-6 6"/><path d="M5 15l2 2"/><path d="M8.5 20l2-2"/>')
  };
  // 图标到 SVG 的映射辅助
  function icon(name, size) {
    return ICONS[name] || ICONS.game;
  }

  // HTML 转义（防注入；框架通用工具）
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }


  function toast(text, color) {
    var root = $('toast-root');
    var el = document.createElement('div');
    el.className = 'toast';
    if (color) el.style.color = color;
    el.textContent = text;
    root.appendChild(el);
    setTimeout(function () { el.remove(); }, 2600);
  }

  function floatMsg(text, color) {
    var el = document.createElement('div');
    el.className = 'float-msg';
    el.textContent = text;
    el.style.color = color || '#fff';
    el.style.left = (40 + Math.random() * 20) + '%';
    el.style.top = (30 + Math.random() * 20) + '%';
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 1600);
  }

  function modal(opts) {
    var root = $('modal-root');
    var mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.dataset.dismissable = opts.dismissable === false ? 'false' : 'true';
    mask.innerHTML =
      '<div class="modal">' +
      '<h3>' + (opts.title || '') + '</h3>' +
      '<div class="modal-body">' + (opts.body || '') + '</div>' +
      '<div class="modal-btns">' + (opts.buttons || []).map(function (b, i) {
        return '<button class="modal-btn ' + (b.cls || '') + '" data-i="' + i + '">' + b.label + '</button>';
      }).join('') + '</div>' +
      '</div>';
    mask.addEventListener('click', function (e) {
      if (e.target === mask && opts.dismissable !== false) close();
    });
    root.appendChild(mask);
    function close() { mask.remove(); }
    var btns = mask.querySelectorAll('.modal-btn');
    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var i = parseInt(btn.getAttribute('data-i'), 10);
        var b = opts.buttons[i];
        if (b && b.onClick) {
          var r = b.onClick();
          if (r === false) return;
        }
        close();
      });
    });
    return { close: close, el: mask };
  }

  function trimZero(x) {
    var s = x.toFixed(2);
    return s.replace(/\.?0+$/, '');
  }

  // 将语义版本 "主.次.修订" 转为可比较整数（与 versionCode 同规则），解析失败返回 null
  function versionScore(v) {
    var m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
    if (!m) return null;
    return parseInt(m[1], 10) * 1000 + parseInt(m[2], 10) * 100 + parseInt(m[3], 10);
  }

  function fmt(n) {
    if (n === undefined || n === null || isNaN(n)) return '0';
    n = Math.round(n);
    var neg = n < 0;
    n = Math.abs(n);
    var s;
    if (n >= 100000000) s = trimZero(n / 100000000) + '亿';
    else if (n >= 10000) s = trimZero(n / 10000) + '万';
    else s = String(n);
    return (neg ? '-' : '') + s;
  }

  function playerById(state, id) {
    for (var i = 0; i < state.players.length; i++) {
      if (state.players[i].id === id) return state.players[i];
    }
    return null;
  }

  function renderLobby() {
    if (!G.lobby) return;
    var L = G.lobby;
    $('room-title').textContent = (L.name || '桌游房间') + ' · ' + L.code;
    var ips = (L.ips && L.ips.length) ? L.ips : [L.ip];
    // 多个 IP 整合为一个自定义二级菜单按钮（点击弹菜单选择），复制按钮独立右侧不挤压
    var ipsHtml = '<div class="mi-row"><span>IP地址</span>' +
      '<button class="mini-btn select-btn" id="rl-ip-btn" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
      escapeHtml(ips[0]) + ':' + L.port + ' ▾</button>' +
      '<button class="mini-btn" id="rl-copy-ip">复制</button></div>';
    if (ips.length > 1) {
      ipsHtml += '<p class="muted" style="font-size:12px;margin:4px 0 0 62px">异地联机（如UU加速器联机房）请让对方填写 10.x / 172.x 开头的虚拟IP</p>';
    }
    // 通用房间信息：只显示通用字段，不含任何游戏专属配置
    var infoHtml =
      '<div class="mi-row"><span>房间号</span><b style="letter-spacing:3px">' + L.code + '</b><button class="mini-btn" id="rl-copy-code">复制</button></div>' +
      ipsHtml +
      '<div class="mi-row"><span>密码</span><b>' + (L.hasPassword ? '已设置' : '无') + '</b></div>' +
      '<div class="mi-row"><span>人数</span><b>' + L.players.length + '/' + L.seats + '人</b></div>';
    $('room-info-card').innerHTML = infoHtml;
    var seatsEl = $('room-players');
    seatsEl.innerHTML = '';
    L.players.forEach(function (p) {
      var item = document.createElement('div');
      item.className = 'seat-item';
      item.innerHTML =
        '<span class="seat-no">' + (p.seat + 1) + '号</span>' +
        '<span style="flex:1;min-width:90px"><b>' + escapeHtml(p.name) + '</b>' + (p.isHost ? ' <span style="color:#fbbf24">房主</span>' : '') + '</span>' +
        '<span style="color:' + (p.ready ? '#4ade80' : '#f87171') + ';font-size:13px">' + (p.ready ? '已准备' : '未准备') + '</span>' +
        (G.isHostLobby && !p.isHost ? '<button class="mini-btn danger rl-kick" data-seat="' + p.seat + '">踢出</button>' : '');
      seatsEl.appendChild(item);
    });
    for (var i = L.players.length; i < L.seats; i++) {
      var empty = document.createElement('div');
      empty.className = 'seat-item';
      empty.style.opacity = '0.55';
      empty.innerHTML = '<span class="seat-no">' + (i + 1) + '号</span><span class="muted" style="flex:1">等待玩家加入（不足将AI补齐）</span>';
      seatsEl.appendChild(empty);
    }
    var isHost = G.isHostLobby;
    $('room-host-controls').classList.toggle('hidden', !isHost);
    if (isHost) {
      var seatsBtn = $('room-seats-btn');
      if (seatsBtn) seatsBtn.textContent = L.seats + '人';
      $('room-pass').value = L.password;
    }
    $('btn-room-ready').classList.toggle('hidden', isHost);
    $('btn-room-start').classList.toggle('hidden', !isHost);
    // 联机多人模式不支持从存档开局，隐藏读取存档按钮
    var loadBtn = $('btn-room-loadsave');
    if (loadBtn) loadBtn.classList.add('hidden');
    var allReady = L.players.every(function (p) { return p.isHost || p.ready; });
    if (isHost) {
      $('btn-room-start').disabled = !allReady;
      $('btn-room-start').textContent = allReady ? '开始游戏' : '等待玩家准备…';
    } else {
      $('btn-room-ready').textContent = G.selfReady ? '取消准备' : '准备';
    }
    setTimeout(function () {
      var cc = document.querySelector('#room-info-card #rl-copy-code');
      if (cc) cc.onclick = function () { copyText(L.code, '房间号'); };
      // 当前选中的 IP（默认第一个），供复制与提示
      var curIp = ips[0];
      var cip = document.querySelector('#room-info-card #rl-copy-ip');
      if (cip) cip.onclick = function () { copyText(curIp + ':' + L.port, 'IP'); };
      // IP 按钮：点击弹自定义二级菜单选择 IP
      var ipBtn = document.querySelector('#room-info-card #rl-ip-btn');
      if (ipBtn) ipBtn.onclick = function () {
        var items = ips.map(function (ip) {
          return '<button class="menu-func' + (ip === curIp ? ' seat-active' : '') + '" data-ip="' + escapeHtml(ip) + '">' +
            escapeHtml(ip) + ':' + L.port + '</button>';
        }).join('');
        var m = modal({ title: '选择IP地址', body: '<div class="menu-funcs">' + items + '</div>', buttons: [{ label: '取消' }] });
        setTimeout(function () {
          document.querySelectorAll('#modal-root .menu-func[data-ip]').forEach(function (b) {
            b.addEventListener('click', function () {
              curIp = b.getAttribute('data-ip');
              if (ipBtn) ipBtn.textContent = curIp + ':' + L.port + ' ▾';
              m.close();
            });
          });
        }, 50);
      };
      document.querySelectorAll('#room-players .rl-kick').forEach(function (b) {
        b.onclick = function () {
          handleHostMsg(null, { t: 'lobby_kick', seat: parseInt(b.getAttribute('data-seat'), 10) });
        };
      });
    }, 50);
  }

  function sendRoom(msg) {
    sendLan(msg);
  }

  var EMOJI_LIST = ['👍', '😂', '🎉', '😡', '😭', '❤️', '👏', '🤝', '💰', '🎲', '🔥', '💪', '💣', '💩', '🤡', '🤬', '😱', '🥳', '👻', '💀', '🍺', '🎁', '⚡', '😴'];

  function isSelfPlayer(p) {
    if (!p) return false;
    if (G.mode === 'lan' || G.mode === 'host') return p.id === G.myPlayerId;
    return !p.isAI;
  }

  function playEmojiFlight(fromId, toId, emoji) {
    var fromEl = document.querySelector('#player-cards .p-avatar[data-pid="' + fromId + '"]');
    var toEl = document.querySelector('#player-cards .p-avatar[data-pid="' + toId + '"]');
    if (!fromEl || !toEl) return;
    var r1 = fromEl.getBoundingClientRect();
    var r2 = toEl.getBoundingClientRect();
    var el = document.createElement('div');
    el.textContent = emoji;
    el.style.position = 'fixed';
    el.style.fontSize = '28px';
    el.style.left = (r1.left + r1.width / 2 - 14) + 'px';
    el.style.top = (r1.top + r1.height / 2 - 14) + 'px';
    el.style.zIndex = '300';
    el.style.pointerEvents = 'none';
    el.style.transition = 'left 0.8s cubic-bezier(0.3,0.7,0.4,1), top 0.8s cubic-bezier(0.3,0.7,0.4,1), transform 0.8s';
    document.body.appendChild(el);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        el.style.left = (r2.left + r2.width / 2 - 14) + 'px';
        el.style.top = (r2.top + r2.height / 2 - 14) + 'px';
        el.style.transform = 'scale(1.5)';
      });
    });
    setTimeout(function () {
      toEl.style.transition = 'transform 0.15s';
      toEl.style.transform = 'scale(1.7)';
      setTimeout(function () {
        toEl.style.transform = '';
      }, 220);
      el.remove();
    }, 820);
  }

  function onAvatarClick(p) {
    if (!p) return;
    if (isSelfPlayer(p)) {
      toast('这是你自己的头像，不能对自己互动');
      return;
    }
    var body = '<div class="emoji-grid">' + EMOJI_LIST.map(function (e) {
      return '<button class="emoji-item" data-e="' + e + '">' + e + '</button>';
    }).join('') + '</div>';
    var m = modal({ title: '向 ' + escapeHtml(p.name) + ' 发送互动', body: body, buttons: [{ label: '取消' }] });
    setTimeout(function () {
      document.querySelectorAll('#modal-root .emoji-item').forEach(function (b) {
        b.addEventListener('click', function () {
          var emoji = b.getAttribute('data-e');
          m.close();
          sendEmoji(p.id, emoji);
        });
      });
    }, 50);
  }

  function sendEmoji(toId, emoji) {
    if (!G.state) return;
    var fromId = null;
    if (G.mode === 'lan' || G.mode === 'host') {
      fromId = G.myPlayerId;
    } else {
      for (var i = 0; i < G.state.players.length; i++) {
        if (!G.state.players[i].isAI && G.state.players[i].alive) {
          fromId = G.state.players[i].id;
          break;
        }
      }
    }
    if (!fromId || fromId === toId) return;
    playEmojiFlight(fromId, toId, emoji);
    if (G.mode === 'host') {
      broadcastHost({ t: 'emoji', from: fromId, to: toId, emoji: emoji });
    } else if (G.mode === 'lan') {
      if (G.ws && G.ws.readyState === 1) {
        sendLan({ t: 'emoji', to: toId, emoji: emoji });
      }
    }
  }

  var THEME_OPTIONS = [
    { v: 'yellow', label: '黄色' },
    { v: 'blue', label: '蓝色' },
    { v: 'teal', label: '青绿' },
    { v: 'red', label: '红色' },
    { v: 'purple', label: '紫色' },
    { v: 'pink', label: '粉色' },
    { v: 'custom', label: '自定义' }
  ];

  function themeLabel(v) {
    for (var i = 0; i < THEME_OPTIONS.length; i++) {
      if (THEME_OPTIONS[i].v === v) return THEME_OPTIONS[i].label;
    }
    return '黄色';
  }

  // ── 颜色工具函数（HSL 转换，用于生成自定义 Material 色板）──
  function hexToRgb(hex) {
    if (!hex) return { r: 0, g: 0, b: 0 };
    var s = String(hex).trim();
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(s);
    if (m) return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
    var ms = /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(s);
    if (ms) return { r: parseInt(ms[1] + ms[1], 16), g: parseInt(ms[2] + ms[2], 16), b: parseInt(ms[3] + ms[3], 16) };
    var mr = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
    if (mr) return { r: parseInt(mr[1], 10), g: parseInt(mr[2], 10), b: parseInt(mr[3], 10) };
    return { r: 0, g: 0, b: 0 };
  }
  function rgbToHex(r, g, b) {
    r = Math.max(0, Math.min(255, Math.round(r)));
    g = Math.max(0, Math.min(255, Math.round(g)));
    b = Math.max(0, Math.min(255, Math.round(b)));
    return '#' + [r, g, b].map(function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
  }
  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(100, s)); l = Math.max(0, Math.min(100, l));
    var c = (1 - Math.abs(2 * l / 100 - 1)) * (s / 100);
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l / 100 - c / 2;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
  }
  // 根据主色生成整套 Material 风格色板（dark 基调，与预设主题一致）
  function buildCustomPalette(hex) {
    var rgb = hexToRgb(hex);
    var hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    var h = hsl.h, s = hsl.s, l = hsl.l;
    // 深色主题：主色用明亮色（l 高），容器色深，文字用深色保证对比
    var primary = hslToHex(h, Math.max(40, s), Math.max(68, Math.min(85, l + 15)));
    var onPrimary = hslToHex(h, Math.min(60, s * 0.6), 20);       // 主色上的深色文字
    var primaryContainer = hslToHex(h, Math.min(45, s * 0.7), 32); // 深容器色
    var onPrimaryContainer = hslToHex(h, Math.min(50, s * 0.8), 85); // 容器上浅色文字
    var secondary = hslToHex(h + 40, Math.min(40, s * 0.8), 78);
    var onSecondary = hslToHex(h + 40, Math.min(55, s * 0.5), 20);
    var secondaryContainer = hslToHex(h + 40, Math.min(35, s * 0.5), 34);
    var onSecondaryContainer = hslToHex(h + 40, Math.min(45, s * 0.6), 88);
    var tertiary = hslToHex(h + 80, Math.min(40, s * 0.7), 70);
    var onTertiary = hslToHex(h + 80, Math.min(60, s * 0.5), 20);
    var tertiaryContainer = hslToHex(h + 80, Math.min(45, s * 0.6), 30);
    var onTertiaryContainer = hslToHex(h + 80, Math.min(50, s * 0.6), 88);
    return {
      primary: primary, onPrimary: onPrimary,
      primaryContainer: primaryContainer, onPrimaryContainer: onPrimaryContainer,
      secondary: secondary, onSecondary: onSecondary,
      secondaryContainer: secondaryContainer, onSecondaryContainer: onSecondaryContainer,
      tertiary: tertiary, onTertiary: onTertiary,
      tertiaryContainer: tertiaryContainer, onTertiaryContainer: onTertiaryContainer
    };
  }
  // 应用自定义色板为 CSS 变量覆盖
  function applyCustomTheme(hex, light) {
    var pal = buildCustomPalette(hex);
    // 用 documentElement（:root）设置变量，确保覆盖全局（body.style 可能被 :root 覆盖）
    var s = document.documentElement.style;
    s.setProperty('--md-primary', pal.primary);
    s.setProperty('--md-on-primary', pal.onPrimary);
    s.setProperty('--md-primary-container', pal.primaryContainer);
    s.setProperty('--md-on-primary-container', pal.onPrimaryContainer);
    s.setProperty('--md-secondary', pal.secondary);
    s.setProperty('--md-on-secondary', pal.onSecondary);
    s.setProperty('--md-secondary-container', pal.secondaryContainer);
    s.setProperty('--md-on-secondary-container', pal.onSecondaryContainer);
    s.setProperty('--md-tertiary', pal.tertiary);
    s.setProperty('--md-on-tertiary', pal.onTertiary);
    s.setProperty('--md-tertiary-container', pal.tertiaryContainer);
    s.setProperty('--md-on-tertiary-container', pal.onTertiaryContainer);
  }
  // 清除自定义主题内联变量
  function clearCustomTheme() {
    var s = document.documentElement.style;
    ['--md-primary', '--md-on-primary', '--md-primary-container', '--md-on-primary-container',
     '--md-secondary', '--md-on-secondary', '--md-secondary-container', '--md-on-secondary-container',
     '--md-tertiary', '--md-on-tertiary', '--md-tertiary-container', '--md-on-tertiary-container'
    ].forEach(function (p) { s.removeProperty(p); });
  }
  // 应用亚克力材质
  function applyAcrylic() {
    // 亚克力默认开启：仅当明确存了 '0'(关) 时才关闭，未设置或 '1' 都视为开
    var on = localStorage.getItem('acrylic') !== '0';
    var opacity = parseInt(localStorage.getItem('acrylic-opacity') || '40', 10);
    document.body.classList.toggle('acrylic-on', on);
    var s = document.body.style;
    if (on) s.setProperty('--acrylic-alpha', String((100 - opacity) / 100));
    else s.removeProperty('--acrylic-alpha');
    var acEl = $('set-acrylic');
    if (acEl) acEl.checked = on;
    var opts = $('acrylic-opts');
    if (opts) opts.classList.toggle('hidden', !on);
    var range = $('acrylic-opacity');
    if (range) range.value = opacity;
    var label = $('acrylic-opacity-label');
    if (label) label.textContent = opacity + '%';
    // 滑块填充比例（随主题色联动）
    var s2 = document.body.style;
    if (range) s2.setProperty('--range-fill', opacity + '%');
  }

  function applyTheme() {
    var theme = localStorage.getItem('theme') || 'yellow';
    var light = localStorage.getItem('light') === '1';
    document.body.classList.remove('theme-yellow', 'theme-blue', 'theme-teal', 'theme-red', 'theme-purple', 'theme-pink', 'light-theme');
    document.body.classList.add('theme-' + theme);
    if (light) document.body.classList.add('light-theme');
    if (theme === 'custom') {
      var custom = localStorage.getItem('custom-color');
      if (custom) applyCustomTheme(custom, light);
    } else {
      clearCustomTheme();
    }
    applyAcrylic();
    var lightEl = $('set-light');
    if (lightEl) lightEl.checked = light;
    var themeBtn = $('theme-btn');
    if (themeBtn) themeBtn.textContent = themeLabel(theme);
  }

  UI.setTheme = function (t) {
    localStorage.setItem('theme', t);
    applyTheme();
  };

  UI.setCustomColor = function (hex) {
    localStorage.setItem('theme', 'custom');
    localStorage.setItem('custom-color', hex);
    applyTheme();
  };

  UI.openThemeMenu = function () {
    var cur = localStorage.getItem('theme') || 'yellow';
    var items = THEME_OPTIONS.map(function (o) {
      return '<button class="menu-func' + (o.v === cur ? ' seat-active' : '') + '" data-v="' + o.v + '">' + o.label + '</button>';
    }).join('');
    var m = modal({ title: '主题色', body: '<div class="menu-funcs">' + items + '</div>', buttons: [{ label: '取消' }] });
    setTimeout(function () {
      document.querySelectorAll('#modal-root .menu-func[data-v]').forEach(function (b) {
        b.addEventListener('click', function () {
          var v = b.getAttribute('data-v');
          if (v === 'custom') {
            m.close();
            UI.openColorPicker();
          } else {
            UI.setTheme(v);
            m.close();
          }
        });
      });
    }, 50);
  };

  UI.openColorPicker = function () {
    var cur = localStorage.getItem('custom-color') || '#F0C368';
    // 内置色块网格（覆盖常见色相）
    var SWATCHES = [
      '#F0C368', '#8AB4F8', '#7DD8C7', '#FFB4A8', '#D7BBFF', '#FFB1C8',
      '#EF4444', '#F97316', '#F59E0B', '#22C55E', '#10B981', '#14B8A6',
      '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6', '#A855F7', '#EC4899',
      '#84CC16', '#0EA5E9', '#2DD4BF', '#FB7185', '#FACC15', '#4ADE80'
    ];
    var swatchHtml = SWATCHES.map(function (c) {
      var active = c.toLowerCase() === cur.toLowerCase() ? ' active' : '';
      return '<button class="cp-swatch' + active + '" data-c="' + c + '" style="background:' + c + '"></button>';
    }).join('');
    var body =
      '<div class="color-picker">' +
      '<div class="cp-preview" id="cp-preview" style="background:' + cur + '"></div>' +
      '<div class="cp-grid">' + swatchHtml + '</div>' +
      '<button class="mini-btn primary cp-custom-btn" id="cp-openwheel" style="width:100%">自定义</button>' +
      '<div class="btn-row" style="margin-top:10px">' +
      '<button class="mini-btn primary" id="cp-apply">应用</button>' +
      '<button class="mini-btn" id="cp-cancel">取消</button>' +
      '</div>' +
      '</div>';
    var m = modal({ title: '自定义主题色', body: body, buttons: [] });
    var preview = document.querySelector('#cp-preview');
    function pick(c) {
      if (preview) preview.style.background = c;
      document.querySelectorAll('#modal-root .cp-swatch').forEach(function (s) {
        s.classList.toggle('active', s.getAttribute('data-c').toLowerCase() === c.toLowerCase());
      });
    }
    setTimeout(function () {
      document.querySelectorAll('#modal-root .cp-swatch').forEach(function (s) {
        s.addEventListener('click', function () { pick(s.getAttribute('data-c')); });
      });
      var wheelBtn = document.querySelector('#cp-openwheel');
      if (wheelBtn) wheelBtn.addEventListener('click', function () { m.close(); UI.openWheelPicker(); });
      var applyBtn = document.querySelector('#cp-apply');
      if (applyBtn) applyBtn.addEventListener('click', function () {
        var raw = (preview && preview.style.background) ? preview.style.background : cur;
        // 规范化颜色为十六进制，避免 rgb() 格式导致主题无法解析
        var rgb = hexToRgb(raw);
        var finalColor = rgbToHex(rgb.r, rgb.g, rgb.b);
        UI.setCustomColor(finalColor);
        m.close();
      });
      var cancelBtn = document.querySelector('#cp-cancel');
      if (cancelBtn) cancelBtn.addEventListener('click', function () { m.close(); });
    }, 50);
  };

  // 圆形调色盘（HSV 色轮：角度→色相，半径→明度，圆心白、边缘黑）
  UI.openWheelPicker = function () {
    var cur = localStorage.getItem('custom-color') || '#F0C368';
    var body =
      '<div class="wheel-picker">' +
      '<canvas id="cp-wheel" width="240" height="240"></canvas>' +
      '<div class="wheel-dot" id="cp-dot"></div>' +
      '<div class="cp-preview" id="cp-wpreview" style="background:' + cur + '"></div>' +
      '<div class="btn-row" style="margin-top:10px">' +
      '<button class="mini-btn primary" id="cp-wapply">确定</button>' +
      '<button class="mini-btn" id="cp-wcancel">取消</button>' +
      '</div>' +
      '</div>';
    var m = modal({ title: '圆形调色盘', body: body, buttons: [] });
    var canvas = document.querySelector('#cp-wheel');
    var dot = document.querySelector('#cp-dot');
    var preview = document.querySelector('#cp-wpreview');
    var size = 240, cx = size / 2, cy = size / 2, radius = size / 2 - 4;
    // 当前选中：angle(deg) 和 dist(0~1)
    var selAngle = 45, selDist = 0.6;
    var ctx = canvas.getContext('2d');
    var img = ctx.createImageData(size, size);
    function hsvToHex(h, s, v) {
      var c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), mm = v - c;
      var r = 0, g = 0, b = 0;
      if (h < 60) { r = c; g = x; }
      else if (h < 120) { r = x; g = c; }
      else if (h < 180) { g = c; b = x; }
      else if (h < 240) { g = x; b = c; }
      else if (h < 300) { r = x; b = c; }
      else { r = c; b = x; }
      return '#' + [r, g, b].map(function (v2) { return ('0' + Math.round((v2 + mm) * 255).toString(16)).slice(-2); }).join('');
    }
    // 绘制色轮：圆心白（dist=0 → s=0, v=1 纯白），边缘黑（dist=1 → v=0），角度定色相
    function drawWheel() {
      var data = img.data;
      for (var y = 0; y < size; y++) {
        for (var x = 0; x < size; x++) {
          var dx = x - cx, dy = y - cy;
          var dist = Math.sqrt(dx * dx + dy * dy) / radius;
          var idx = (y * size + x) * 4;
          if (dist > 1) { data[idx] = data[idx + 1] = data[idx + 2] = 0; data[idx + 3] = 0; continue; }
          var angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
          // 中心: s=0 纯白; 向外 s 增大, v 减小; 边缘 v→0 变黑
          var s = Math.min(1, dist * 1.2);
          var v = Math.max(0, 1 - dist);
          var col = hsvToHex(angle, s, v);
          data[idx] = parseInt(col.substr(1, 2), 16);
          data[idx + 1] = parseInt(col.substr(3, 2), 16);
          data[idx + 2] = parseInt(col.substr(5, 2), 16);
          data[idx + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }
    function colorAt(angle, dist) {
      var s = Math.min(1, dist * 1.2);
      var v = Math.max(0, Math.min(1, 1 - dist));
      return hsvToHex(angle, s, v);
    }
    function updateSelection() {
      if (!preview) return;
      preview.style.background = colorAt(selAngle, selDist);
    }
    function placeDot() {
      var rad = selDist * radius;
      var radA = selAngle * Math.PI / 180;
      if (dot) {
        dot.style.left = (cx + Math.cos(radA) * rad) + 'px';
        dot.style.top = (cy + Math.sin(radA) * rad) + 'px';
      }
    }
    function getPos(e) {
      var clientX, clientY;
      if (e.touches && e.touches[0]) { clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; }
      else { clientX = e.clientX; clientY = e.clientY; }
      var rect = canvas.getBoundingClientRect();
      var sx = clientX - rect.left;
      var sy = clientY - rect.top;
      var dx = sx - cx, dy = sy - cy;
      var dist = Math.sqrt(dx * dx + dy * dy) / radius;
      if (dist > 1) dist = 1;
      var angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      selAngle = angle; selDist = dist;
      updateSelection();
      placeDot();
    }
    drawWheel();
    // 初始化滑块位置（右上角区域）
    selAngle = 45; selDist = 0.6; placeDot(); updateSelection();
    // 拖动取色：支持鼠标与触摸
    var dragging = false;
    canvas.addEventListener('mousedown', function (e) { dragging = true; getPos(e); });
    window.addEventListener('mousemove', function (e) { if (dragging) getPos(e); });
    window.addEventListener('mouseup', function () { dragging = false; });
    canvas.addEventListener('touchstart', function (e) { e.preventDefault(); if (e.touches[0]) getPos(e); }, { passive: false });
    canvas.addEventListener('touchmove', function (e) { e.preventDefault(); if (e.touches[0]) getPos(e); }, { passive: false });
    canvas.addEventListener('touchend', function () {});
    setTimeout(function () {
      var applyBtn = document.querySelector('#cp-wapply');
      if (applyBtn) applyBtn.addEventListener('click', function () {
        var c = colorAt(selAngle, selDist);
        localStorage.setItem('theme', 'custom');
        localStorage.setItem('custom-color', c);
        applyTheme();
        m.close();
        UI.openColorPicker();
      });
      var cancelBtn = document.querySelector('#cp-wcancel');
      if (cancelBtn) cancelBtn.addEventListener('click', function () { m.close(); UI.openColorPicker(); });
    }, 50);
  };

  UI.setLightMode = function (v) {
    localStorage.setItem('light', v ? '1' : '0');
    applyTheme();
  };

  UI.setAcrylic = function (v) {
    localStorage.setItem('acrylic', v ? '1' : '0');
    applyAcrylic();
  };

  UI.setAcrylicOpacity = function (v) {
    localStorage.setItem('acrylic-opacity', String(v));
    applyAcrylic();
  };

  UI.showSettings = function () {
    ['screen-menu', 'screen-lan', 'screen-room', 'screen-settings'].forEach(function (id) {
      var el = $(id); if (el) el.classList.add('hidden');
    });
    $('screen-settings').classList.remove('hidden');
    applyTheme();
    renderLogFilter();
    renderLogPanel();
  };

  // ── 设置页 · 运行日志面板 ──
  // 标准开发格式：每条 = [时间] [级别] [模块] 描述 | key=value
  var LOG_LEVEL_NAME = { err: 'ERROR', warn: 'WARN', ok: 'OK', info: 'INFO', debug: 'DEBUG' };
  function fmtLogTime(t) {
    var now = new Date();
    var d = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);
    return d + ' ' + (t || '');
  }
  function renderLogPanel() {
    var panel = $('log-panel');
    if (!panel) return;
    var all = loadLogs();
    var filter = (window.__logFilter) || '';
    var list = filter ? all.filter(function (lg) { return (lg.g || 'system') === filter; }) : all;
    var cnt = $('log-count');
    if (cnt) cnt.textContent = list.length + ' 条';
    if (!list.length) {
      panel.innerHTML = '<p class="muted">暂无日志</p>';
      return;
    }
    // 游戏名映射（来源显示）
    var names = { poker: 'poker', sgs: 'sgs', doudizhu: 'doudizhu', monopoly: 'monopoly' };
    panel.innerHTML = list.slice(-80).map(function (lg) {
      var cls = lg.l === 'err' ? 'log-err' : (lg.l === 'warn' ? 'log-warn' : (lg.l === 'ok' ? 'log-ok' : ''));
      var src = lg.g ? (names[lg.g] || lg.g) : 'system';
      var lv = LOG_LEVEL_NAME[lg.l] || 'INFO';
      return '<div class="log-line ' + cls + '"><span class="log-time">' + escapeHtml(fmtLogTime(lg.t || '')) + '</span> <span class="log-level">[' + lv + ']</span> <span class="log-src">[' + escapeHtml(src) + ']</span> ' + escapeHtml(lg.m || '') + '</div>';
    }).join('');
    panel.scrollTop = panel.scrollHeight;
  }
  // 日志来源筛选（自定义按钮二级菜单，替代原生 select）
  function renderLogFilter() {
    var btn = $('log-filter-btn');
    if (!btn) return;
    var filter = window.__logFilter || '';
    var names = { poker: '德州扑克', sgs: '三国杀', doudizhu: '斗地主', monopoly: '大富翁', system: '系统' };
    var label = filter === '' ? '全部' : (names[filter] || filter);
    btn.textContent = label + ' ▾';
  }
  function openLogFilterMenu() {
    var games = window.GameFramework ? window.GameFramework.list() : [];
    var names = { poker: '德州扑克', sgs: '三国杀', doudizhu: '斗地主', monopoly: '大富翁' };
    var cur = window.__logFilter || '';
    var items = '<button class="menu-func' + (cur === '' ? ' seat-active' : '') + '" data-v="">全部</button>' +
      '<button class="menu-func' + (cur === 'system' ? ' seat-active' : '') + '" data-v="system">系统</button>';
    items += games.map(function (g) {
      return '<button class="menu-func' + (cur === g.id ? ' seat-active' : '') + '" data-v="' + escapeHtml(g.id) + '">' + escapeHtml(g.name) + '</button>';
    }).join('');
    var m = modal({ title: '筛选日志来源', body: '<div class="menu-funcs">' + items + '</div>', buttons: [{ label: '取消' }] });
    setTimeout(function () {
      document.querySelectorAll('#modal-root .menu-func[data-v]').forEach(function (b) {
        b.addEventListener('click', function () {
          window.__logFilter = b.getAttribute('data-v') || '';
          m.close();
          renderLogFilter();
          renderLogPanel();
        });
      });
    }, 50);
  }
  // 「日志」二级菜单：复制 / 导出 / 刷新 / 清空 / DEBUG开关
  function openLogMenu() {
    var debugOn = debugEnabled();
    var body =
      '<div class="menu-funcs">' +
      '<button class="menu-func" id="logop-copy"><span class="mf-ico">' + icon('save', 19) + '</span>复制日志</button>' +
      '<button class="menu-func" id="logop-export"><span class="mf-ico">' + icon('folder', 19) + '</span>导出文件</button>' +
      '<button class="menu-func" id="logop-refresh"><span class="mf-ico">' + icon('clock', 19) + '</span>刷新</button>' +
      '<button class="menu-func' + (debugOn ? ' seat-active' : '') + '" id="logop-debug"><span class="mf-ico">' + icon('bot', 19) + '</span>DEBUG 日志：' + (debugOn ? '开' : '关') + '</button>' +
      '<button class="menu-func" id="logop-clear"><span class="mf-ico">' + icon('trash', 19) + '</span>清空日志</button>' +
      '</div>';
    var m = modal({ title: '日志操作', body: body, buttons: [{ label: '取消' }] });
    setTimeout(function () {
      var copy = $('logop-copy');
      if (copy) copy.addEventListener('click', function () { m.close(); doCopyLog(); });
      var exp = $('logop-export');
      if (exp) exp.addEventListener('click', function () { m.close(); doExportLog(); });
      var ref = $('logop-refresh');
      if (ref) ref.addEventListener('click', function () { m.close(); renderLogFilter(); renderLogPanel(); });
      var dbg = $('logop-debug');
      if (dbg) dbg.addEventListener('click', function () {
        m.close();
        if (window.GameFramework && typeof window.GameFramework.setDebugLog === 'function') {
          window.GameFramework.setDebugLog(!debugOn);
        }
        renderLogPanel();
      });
      var clr = $('logop-clear');
      if (clr) clr.addEventListener('click', function () {
        m.close();
        window.__dshLogClear();
        renderLogFilter();
        renderLogPanel();
        toast('日志已清空');
      });
    }, 50);
  }

  UI.showMenu = function () {
    ['screen-menu', 'screen-lan', 'screen-room', 'screen-settings'].forEach(function (id) {
      var el = $(id); if (el) el.classList.add('hidden');
    });
    // 隐藏所有已注册插件的屏幕（返回主菜单时清空残留，避免 findActiveGame 误判）
    try {
      (window.GameFramework.list() || []).forEach(function (plg) {
        var ids = [];
        if (plg && plg.screenIds && plg.screenIds.length) ids = plg.screenIds;
        else if (plg && plg.screenId) ids = [plg.screenId];
        ids.forEach(function (sid) {
          var pel = $(sid);
          if (pel) pel.classList.add('hidden');
        });
      });
    } catch (e) {}
    $('screen-menu').classList.remove('hidden');
    renderGameList();
    updateClock();
    UI.switchTab('games');
    // 重置房间创建的游戏选择为已安装可联机插件的第一个（无则清空）
    G.roomGameId = defaultRoomGame();
    var rcBtn = $('rc-game-btn');
    if (rcBtn) {
      var def = window.GameFramework.get(G.roomGameId);
      rcBtn.textContent = (def ? def.name : '选择游戏') + ' ▾';
    }
  };

  // 系统框架 · 游戏插件注册表
  // 框架职责：导航/设置/主题/存档/联机大厅/弹窗提示/游戏列表。
  // 游戏插件职责：提供自己的启动/渲染/交互，并通过以下接口接入框架：
  //   - 卡片点击 → startGameEntry(gameId)（框架统一处理存档与入口）
  //   - 本机启动：插件 setup() 显示设置界面，startLocal() 开始本机游戏
  //   - 退出：UI.showMenu()（框架统一复位）
  // 容错：框架已安装全局错误隔离（window.onerror）与入口 try-catch，
  //       游戏插件运行异常会自动安全返回主菜单，不影响系统框架。
  // ══════════════ 游戏插件注册协议（GameFramework）══════════════
  // 游戏插件通过 GameFramework.register() 自我注册（含元数据与生命周期钩子），
  // 框架通过注册表统一调度，不硬编码任何游戏；后续支持从 GitHub 动态下载插件脚本
  // 后调用 register() 即可动态添加/删除游戏。
  // 插件对象规范：
  //   { id, name, icon, desc, canLan,
  //     setup(),            // 显示本机设置界面
  //     startLocal(),       // 开始本机游戏
  //     enter(),            // 进入游戏渲染（本机/联机共用）
  //     exit(),             // 游戏内退出确认（可选）——返回键/菜单「返回主菜单」调用
  //     restart(),          // 再来一局（可选）——菜单「再来一局」调用
  //     saveState(),        // 返回可序列化存档（可选）
  //     loadState(state),   // 恢复存档（可选）
  //     onLanMsg(msg),      // 客户端联机消息处理（可选）
  //     onHostMsg(connId, msg), // 房主联机消息处理（可选）
  //     onGameStarted(msg)  // 联机开局消息（可选）}
  var GAME_REGISTRY = [];
  window.GameFramework = window.GameFramework || {
    _registry: {},
    register: function (plugin) {
      if (!plugin || !plugin.id) return;
      this._registry[plugin.id] = plugin;
      if (GAME_REGISTRY.indexOf(plugin) < 0) {
        GAME_REGISTRY.push(plugin);
        // 插件可能在首屏渲染后（如斗地主插件文件末尾）注册，需刷新游戏列表
        if (typeof renderGameList === 'function') {
          try { renderGameList(); } catch (e) {}
        }
      }
    },
    unregister: function (id) {
      var p = this._registry[id];
      if (!p) return;
      delete this._registry[id];
      var i = GAME_REGISTRY.indexOf(p);
      if (i >= 0) GAME_REGISTRY.splice(i, 1);
      if (typeof renderGameList === 'function') {
        try { renderGameList(); } catch (e) {}
      }
    },
    get: function (id) { return this._registry[id]; },
    list: function () { return GAME_REGISTRY.slice(); },
    // 通用开发架构：插件可查询系统设置（主题/浅色/亚克力），实现风格自动接入
    getSetting: function (key) {
      if (key === 'theme') return localStorage.getItem('theme') || 'yellow';
      if (key === 'light') return localStorage.getItem('light') === '1';
      if (key === 'acrylic') return localStorage.getItem('acrylic') !== '0';
      if (key === 'acrylicOpacity') return parseInt(localStorage.getItem('acrylic-opacity') || '40', 10);
      return localStorage.getItem(key);
    },
    // 插件接入时读取当前主题/浅色/亚克力快照（供初始化样式）
    getThemeSnapshot: function () {
      return {
        theme: localStorage.getItem('theme') || 'yellow',
        light: localStorage.getItem('light') === '1',
        acrylic: localStorage.getItem('acrylic') !== '0',
        acrylicOpacity: parseInt(localStorage.getItem('acrylic-opacity') || '40', 10),
        customColor: localStorage.getItem('custom-color') || null
      };
    },
    // 动态加载插件脚本（后续对接 GitHub 仓库下载）
    loadScript: function (url) {
      return new Promise(function (resolve, reject) {
        var real = normalizeGithubUrl(url);
        var s = document.createElement('script');
        s.src = real;
        s.onload = function () { resolve(); };
        s.onerror = function () {
          reject(new Error(friendlyDownloadError('插件脚本加载失败: ' + url, null)));
        };
        document.head.appendChild(s);
      });
    },
    // ── 通用接口：返回 / 菜单 / 活动插件检测 ──
    // 判断当前是否有某游戏进行中（本地/联机均计），供返回键与菜单识别。
    // 纯框架不硬编码任何游戏：优先使用插件注册的 isGameActive 钩子，否则按插件声明的屏幕可见性兜底。
    isGameActive: function (id) {
      var g = this.get(id);
      if (!g) return false;
      if (typeof g.isGameActive === 'function') {
        try { return !!g.isGameActive(); } catch (e) {}
      }
      // 插件可声明单个 screenId 或多个 screenIds；任一屏幕可见即视为活动
      var ids = [];
      if (g.screenIds && g.screenIds.length) ids = g.screenIds;
      else if (g.screenId) ids = [g.screenId];
      for (var i = 0; i < ids.length; i++) {
        var el = $(ids[i]);
        if (el && !el.classList.contains('hidden')) return true;
      }
      return false;
    },
    // 通用返回处理：关闭弹窗 > 设置界面返回 > 游戏内退出确认 > 回主菜单
    back: function () {
      var root = $('modal-root');
      var masks = root.querySelectorAll('.modal-mask');
      if (masks.length > 0) {
        var last = masks[masks.length - 1];
        if (last.dataset.dismissable !== 'false') last.remove();
        return;
      }
      // 找到当前进行中的插件 → 调其 exit 确认
      var active = this.findActiveGame();
      if (active && typeof active.exit === 'function') { active.exit(); return; }
      // 游戏插件内部有自身返回处理时优先交给其处理；否则回主菜单
      if (window.__handleBack) { window.__handleBack(); return; }
      UI.showMenu();
    },
    // 找到当前进行中的游戏插件（本地/联机）：遍历注册表，不依赖任何具体游戏 id
    findActiveGame: function () {
      for (var i = 0; i < GAME_REGISTRY.length; i++) {
        if (this.isGameActive(GAME_REGISTRY[i].id)) return GAME_REGISTRY[i];
      }
      return null;
    },
    // ── 通用退出确认：本机可存档插件提供「保存并退出」，联机模式不调用存档接口 ──
    confirmExit: function (id) {
      var p = this.get(id);
      var name = p ? p.name : (id || '游戏');
      var isLocal = G.mode !== 'host' && G.mode !== 'lan'; // 本机模式才允许保存（联机不调用存档接口）
      var canSave = isLocal && this.canSave(id);
      var buttons = [];
      if (canSave) {
        buttons.push({
          label: '保存并退出', cls: 'primary',
          onClick: function () { if (window.UI.promptSaveThenExit) window.UI.promptSaveThenExit(id); }
        });
      }
      buttons.push({ label: '退出游戏', cls: 'danger', onClick: function () { UI.exitToMenu(); } });
      buttons.push({ label: '继续游戏' });
      modal({
        title: '退出游戏',
        body: '<p>' + (canSave ? '当前为单人游戏，退出前是否保存进度？' : '确定退出' + name + '并返回主菜单？') + '</p>',
        buttons: buttons
      });
    },
    // 通用游戏内菜单：继续游戏 / 存档管理(可存档插件) / 再来一局 / 返回主菜单
    openMenu: function (id) {
      var p = this.get(id);
      if (!p) return;
      var isOver = this.isGameOver(id);
      var isLocal = G.mode !== 'host' && G.mode !== 'lan';
      var canSave = isLocal && this.canSave(id); // 联机模式不显示存档管理
      var body =
        '<div class="menu-funcs">' +
        '<button class="menu-func" id="gf-m-continue"><span class="mf-ico">' + icon('play', 19) + '</span>继续游戏</button>' +
        (canSave ? '<button class="menu-func" id="gf-m-save"><span class="mf-ico">' + icon('folder', 19) + '</span>存档管理</button>' : '') +
        (isOver ? '<button class="menu-func" id="gf-m-again"><span class="mf-ico">' + icon('newGame', 19) + '</span>再来一局</button>' : '') +
        '<button class="menu-func" id="gf-m-exit"><span class="mf-ico">' + icon('exit', 19) + '</span>返回主菜单</button>' +
        '</div>';
      var m = modal({ title: p.name + ' · 菜单', body: body, buttons: [{ label: '取消' }] });
      setTimeout(function () {
        var cont = $('gf-m-continue');
        if (cont) cont.addEventListener('click', function () { m.close(); });
        var save = $('gf-m-save');
        if (save) save.addEventListener('click', function () { m.close(); UI.openSaveMenu(id); });
        var again = $('gf-m-again');
        if (again) again.addEventListener('click', function () {
          m.close();
          if (typeof p.restart === 'function') { try { p.restart(); } catch (e) { toast('再来一局失败', '#f87171'); } }
        });
        var ex = $('gf-m-exit');
        if (ex) ex.addEventListener('click', function () { m.close(); if (typeof p.exit === 'function') p.exit(); });
      }, 50);
    },
    // 检测插件对局是否已结束（供菜单显示「再来一局」）：优先使用插件注册的 isGameOver 钩子
    isGameOver: function (id) {
      var p = this.get(id);
      if (p && typeof p.isGameOver === 'function') {
        try { return !!p.isGameOver(); } catch (e) {}
      }
      return false;
    },
    // ── 通用存档入口：游戏分页卡片点击的存档检测与二级菜单（继续/新游戏/存档管理）──
    startGameEntry: function (gameId) { startGameEntry(gameId); },
    // 打开某游戏的存档管理弹窗
    openSaveMenu: function (gameId) { UI.openSaveMenu(gameId); },
    // 检测插件是否支持存档（提供 saveState 钩子）
    canSave: function (id) {
      var p = this.get(id);
      return !!(p && typeof p.saveState === 'function' && typeof p.loadState === 'function');
    },
    // ── 通用接口：游戏运行日志 ──
    // 记录某游戏的运行日志（game 为插件 id），与系统日志同缓冲但带来源标记
    logGame: function (id, text, level) { addLog(text, level, id); },
    // 读取某游戏的运行日志（不传 id 返回全部含系统）
    getGameLogs: function (id) {
      var all = loadLogs();
      if (!id) return all;
      return all.filter(function (e) { return e.g === id; });
    },
    // 清空某游戏的运行日志（不传 id 清空全部）
    clearGameLogs: function (id) {
      if (!id) { try { localStorage.removeItem(LOG_KEY); } catch (e) {} return; }
      var all = loadLogs();
      saveLogs(all.filter(function (e) { return e.g !== id; }));
    },
    // ── 通用接口：标准开发日志 ──
    // logEvent(level, module, desc, params[, stack])：level=info|debug|warn|error
    logEvent: function (level, module, desc, params, stack) { logEvent(level, module, desc, params, stack); },
    // DEBUG 日志开关（true 输出 DEBUG，false 关闭）
    setDebugLog: function (on) {
      localStorage.setItem('log-debug', on ? '1' : '0');
      addLog('[log] DEBUG 日志已' + (on ? '开启' : '关闭'), 'info');
    },
    debugLog: function () { return debugEnabled(); },
    // ══════════════ 通用接口：玩家卡互动（查看信息 / 发送emoji）══════════════
    // 游戏插件注册自身启用的玩家卡交互能力（不注册则不绑定，避免混用）：
    //   registerPlayerActions(gameId, { info:true, emoji:true })
    playerActions: {},
    registerPlayerActions: function (gameId, opts) {
      this.playerActions[gameId] = opts || {};
    },
    // 查询某游戏是否启用了某玩家卡交互能力
    playerActionEnabled: function (gameId, name) {
      var o = this.playerActions[gameId];
      return !!(o && o[name]);
    },
    // ── 玩家个人信息（按名字存 localStorage，可自行编辑，持久化）──
    // 读取玩家信息；无则返回默认结构 { name, note:'' }，绝不抛错
    getPlayerInfo: function (name) {
      var key = 'player-info-' + String(name || '');
      try {
        var raw = localStorage.getItem(key);
        if (raw) return JSON.parse(raw);
      } catch (e) {}
      return { name: String(name || ''), note: '' };
    },
    // 保存玩家信息（仅存允许字段）
    setPlayerInfo: function (name, info) {
      var key = 'player-info-' + String(name || '');
      var safe = { name: String(name || ''), note: String((info && info.note) || '').slice(0, 200) };
      try { localStorage.setItem(key, JSON.stringify(safe)); return true; } catch (e) { return false; }
    },
    // 打开某玩家的信息查看/编辑面板（通用能力，与 emoji 完全隔离）
    openPlayerInfo: function (gameId, name) {
      var self = this;
      var info = self.getPlayerInfo(name);
      var body =
        '<div class="form-row"><label>玩家</label><b>' + escapeHtml(name || '') + '</b></div>' +
        '<div class="form-row"><label>备注</label><textarea id="pinfo-note" rows="3">' + escapeHtml(info.note || '') + '</textarea></div>' +
        '<div class="form-tip">备注仅保存在本机，随玩家名字关联</div>';
      var m = modal({ title: '玩家信息', body: body, buttons: [
        { label: '取消' },
        { label: '保存', cls: 'primary', onClick: function () {
          var note = ($('pinfo-note') || {}).value || '';
          self.setPlayerInfo(name, { name: name, note: note });
          addLog('[player] 已保存玩家信息 | name=' + name, 'info');
        } }
      ] });
    },
    // 打开 emoji 选择面板（通用能力，与信息完全隔离）；cb(emoji) 由插件决定如何发送
    openEmojiPanel: function (gameId, targetName, cb) {
      var list = EMOJI_LIST;
      var body = '<div class="emoji-grid">' + list.map(function (e) {
        return '<button class="emoji-item" data-e="' + e + '">' + e + '</button>';
      }).join('') + '</div>';
      var m = modal({ title: '向 ' + escapeHtml(targetName || '玩家') + ' 发送互动', body: body, buttons: [{ label: '取消' }] });
      setTimeout(function () {
        document.querySelectorAll('#modal-root .emoji-item').forEach(function (b) {
          b.addEventListener('click', function () {
            var emoji = b.getAttribute('data-e');
            m.close();
            if (typeof cb === 'function') cb(emoji);
          });
        });
      }, 50);
    }
  };
  // 默认房间游戏：纯框架不内置任何游戏，取已安装的可联机插件列表中的第一个，无则返回 null
  function defaultRoomGame() {
    var lanGames = GAME_REGISTRY.filter(function (g) { return g.canLan !== false; });
    return lanGames.length ? lanGames[0].id : null;
  }
  // ══════════════ 游戏插件注册 ══════════════
  // 纯平台框架不内置/不注册任何游戏；第三方游戏插件通过 GameFramework.register() 自我注册接入。
  // 框架仅通过 GameFramework 注册表调度，不硬编码任何游戏。

  function renderGameList() {
    var grid = $('games-grid');
    if (!grid) return;
    grid.innerHTML = '';
    // 空态：注册表无插件时给出友好提示，引导去下载页安装
    if (!GAME_REGISTRY.length) {
      grid.innerHTML =
        '<div class="game-empty">' +
        '<div class="game-empty-icon">' + icon('game', 48) + '</div>' +
        '<div class="game-empty-title">暂无游戏</div>' +
        '<div class="game-empty-desc">还没有安装任何游戏插件，请到「下载」页安装插件。</div>' +
        '</div>';
      grid.classList.remove('single');
      return;
    }
    GAME_REGISTRY.forEach(function (g) {
      var card = document.createElement('div');
      card.className = 'game-card';
      card.innerHTML =
        '<div class="game-icon">' + icon(g.icon, 40) + '</div>' +
        '<div class="game-meta">' +
        '<div class="game-name">' + g.name + '</div>' +
        (g.desc ? '<div class="game-desc">' + g.desc + '</div>' : '') +
        '</div>';
      card.addEventListener('click', function () {
        try { startGameEntry(g.id); } catch (e) { toast('游戏启动失败，已返回主菜单', '#f87171'); UI.showMenu(); }
      });
      grid.appendChild(card);
    });
    // 单个游戏时居中
    grid.classList.toggle('single', GAME_REGISTRY.length === 1);
  }

  // 点击游戏卡片：若该游戏有存档，提示「继续上次 / 新游戏 / 存档管理」；否则直接开始新游戏
  function startGameEntry(gameId) {
    var plugin = window.GameFramework.get(gameId);
    if (!plugin) {
      toast('游戏插件未安装或不可用', '#f87171');
      return;
    }
    // 通用架构：框架统一在游戏启动时更新历史记录（插件无需自行调用）
    recordGameHistory(gameId);
    if (hasSaveFor(gameId)) {
      var saves = listSaves(gameId);
      var latest = saves.reduce(function (a, b) { return (b.savedAt > a.savedAt) ? b : a; }, saves[0]);
      var body =
        '<p style="margin-bottom:8px">检测到 ' + latest.name + ' 的存档（存档 ' + latest.slot + '，' + formatSaveTime(latest.savedAt) + '）</p>' +
        '<div class="menu-funcs">' +
        '<button class="menu-func seat-active" id="ge-continue"><span class="mf-ico">' + icon('play', 19) + '</span>继续上次游戏</button>' +
        '<button class="menu-func" id="ge-new"><span class="mf-ico">' + icon('newGame', 19) + '</span>开始新游戏</button>' +
        '<button class="menu-func" id="ge-saves"><span class="mf-ico">' + icon('folder', 19) + '</span>存档管理</button>' +
        '</div>';
      var m = modal({ title: '返回上次游戏？', body: body, buttons: [{ label: '取消' }], dismissable: false });
      setTimeout(function () {
        var cont = document.querySelector('#ge-continue');
        if (cont) cont.addEventListener('click', function () {
          m.close();
          try {
            var save = loadSave(gameId, latest.slot);
            if (save) applyLoadedState(gameId, save);
          } catch (e) { toast('读取存档失败', '#f87171'); UI.showMenu(); }
        });
        var neu = document.querySelector('#ge-new');
        if (neu) neu.addEventListener('click', function () {
          m.close();
          try {
            if (plugin.setup) plugin.setup();
            else if (plugin.startLocal) plugin.startLocal();
          } catch (e) { toast('游戏启动失败，已返回主菜单', '#f87171'); UI.showMenu(); }
        });
        var sav = document.querySelector('#ge-saves');
        if (sav) sav.addEventListener('click', function () {
          m.close();
          UI.openSaveMenu(gameId);
        });
      }, 50);
    } else {
      if (plugin.setup) plugin.setup();
      else if (plugin.startLocal) plugin.startLocal();
    }
  }

  // ── 存档系统（多槽）──
  var SAVE_SLOTS = 3;
  function saveKey(gameId, slot) { return 'game-save-' + gameId + '-' + slot; }
  function saveGame(gameId, slot) {
    // 多人模式不支持存档
    if (G.mode === 'host' || G.mode === 'lan') return null;
    try {
      var g = null;
      for (var i = 0; i < GAME_REGISTRY.length; i++) if (GAME_REGISTRY[i].id === gameId) g = GAME_REGISTRY[i];
      var name = g ? g.name : gameId;
      var state;
      var plugin = window.GameFramework ? window.GameFramework.get(gameId) : null;
      // 通用存档协议：优先调用插件注册的 saveState 钩子（第三方插件亦适用）；
      // 未提供钩子时回退为读取宿主全局状态 G.state
      if (plugin && typeof plugin.saveState === 'function') {
        state = plugin.saveState();
      } else {
        if (!G.state) return null;
        state = G.state;
      }
      if (!state) return null;
      var data = { gameId: gameId, name: name, slot: slot, savedAt: Date.now(), mode: G.mode, state: state };
      var json = JSON.stringify(data);
      if (!json) return null;
      localStorage.setItem(saveKey(gameId, slot), json);
      return data;
    } catch (e) {
      console.error('saveGame failed', e);
      return null;
    }
  }
  function listSaves(gameId) {
    var result = [];
    for (var s = 1; s <= SAVE_SLOTS; s++) {
      try {
        var raw = localStorage.getItem(saveKey(gameId, s));
        if (raw) {
          var d = JSON.parse(raw);
          // 联机（多人）模式存档不支持开局，不列出并清理
          if (d.mode && (d.mode === 'host' || d.mode === 'lan')) {
            localStorage.removeItem(saveKey(gameId, s));
            continue;
          }
          result.push({ gameId: gameId, slot: s, name: d.name, savedAt: d.savedAt, mode: d.mode, hasState: !!d.state });
        }
      } catch (e) {}
    }
    return result;
  }
  // 清理所有游戏的联机（多人）模式存档（一次性，启动时调用）：联机模式不支持从存档开局
  function cleanupMultiplayerSaves() {
    var games = window.GameFramework ? window.GameFramework.list() : [];
    if (!games.length) return;
    games.forEach(function (g) {
      for (var s = 1; s <= SAVE_SLOTS; s++) {
        try {
          var raw = localStorage.getItem(saveKey(g.id, s));
          if (raw) {
            var d = JSON.parse(raw);
            if (d.mode === 'host' || d.mode === 'lan') {
              localStorage.removeItem(saveKey(g.id, s));
            }
          }
        } catch (e) {}
      }
    });
  }
  function loadSave(gameId, slot) {
    try {
      var raw = localStorage.getItem(saveKey(gameId, slot));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }
  function deleteSave(gameId, slot) {
    localStorage.removeItem(saveKey(gameId, slot));
  }
  function formatSaveTime(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function applyLoadedState(gameId, save) {
    if (!save || !save.state) return;
    var plugin = window.GameFramework.get(gameId);
    if (plugin && plugin.loadState) {
      // 插件提供自己的读档恢复钩子
      try {
        G.mode = 'local';
        G.myPlayerId = null;
        G.room = null;
        G.animating = false;
        G.evQueue = [];
        plugin.loadState(save.state);
        return;
      } catch (e) { console.error('插件读档失败', e); }
    }
    G.state = save.state;
    G.mode = 'local';
    G.myPlayerId = null;
    G.room = null;
    // 读档后重置动画/事件状态，避免 AI 卡死
    G.animating = false;
    G.evQueue = [];
    // 插件读档后恢复：交给插件（进入渲染 + 若当前为 AI 则触发行动）
    if (window.UI.__monoAfterLoad) window.UI.__monoAfterLoad();
  }
  // 当前是否有该游戏存档（用于启动时提示）
  function hasSaveFor(gameId) {
    return listSaves(gameId).length > 0;
  }
  // 存档管理弹窗（菜单用）
  UI.openSaveMenu = function (gameId) {
    gameId = gameId || defaultRoomGame();
    var saves = listSaves(gameId);
    var plugin = window.GameFramework ? window.GameFramework.get(gameId) : null;
    // 通用存档协议：插件提供 saveState 钩子即可在存档菜单「保存当前对局」
    var canSaveNow = !!(plugin && typeof plugin.saveState === 'function');
    var body;
    if (canSaveNow) {
      var saveRow = '<div class="menu-funcs" style="margin-bottom:8px">' +
        '<button class="menu-func seat-active" id="si-save-now"><span class="mf-ico">' + icon('save', 19) + '</span>保存当前对局</button>' +
        '</div>';
      body = saveRow;
    } else {
      body = '';
    }
    if (saves.length === 0) {
      body += '<p class="muted" style="text-align:center;padding:16px 0">该游戏暂无存档</p>';
    } else {
      body += '<div class="history-list">' + saves.map(function (s) {
        return '<div class="save-item" data-slot="' + s.slot + '">' +
          '<div class="si-info">' +
          '<div class="si-name">存档 ' + s.slot + '</div>' +
          '<div class="si-time">保存于 ' + formatSaveTime(s.savedAt) + '</div>' +
          '</div>' +
          '<div class="si-actions">' +
          '<button class="mini-btn primary si-load" data-slot="' + s.slot + '">读取</button>' +
          '<button class="mini-btn danger si-del" data-slot="' + s.slot + '">删除</button>' +
          '</div>' +
          '</div>';
      }).join('') + '</div>';
    }
    var m = modal({ title: '游戏存档', body: body, buttons: [{ label: '关闭', cls: 'primary' }] });
    setTimeout(function () {
      var saveBtn = document.querySelector('#modal-root #si-save-now');
      if (saveBtn) saveBtn.addEventListener('click', function () {
        // 选择槽位保存
        var items = [];
        for (var slot = 1; slot <= SAVE_SLOTS; slot++) {
          var label = '存档 ' + slot;
          items.push('<button class="menu-func' + (saves.some(function (s) { return s.slot === slot; }) ? '' : '') + '" data-slot="' + slot + '">' + label + '</button>');
        }
        var sm = modal({ title: '保存到', body: '<div class="menu-funcs">' + items.join('') + '</div>', buttons: [{ label: '取消' }] });
        setTimeout(function () {
          document.querySelectorAll('#modal-root .menu-func[data-slot]').forEach(function (b) {
            b.addEventListener('click', function () {
              var slot = parseInt(b.getAttribute('data-slot'), 10);
              var r = saveGame(gameId, slot);
              sm.close();
              m.close();
              if (r) toast('已保存到存档 ' + slot);
              else toast('当前无进行中的对局可保存', '#f87171');
            });
          });
        }, 50);
      });
      document.querySelectorAll('#modal-root .si-load').forEach(function (b) {
        b.addEventListener('click', function () {
          var slot = parseInt(b.getAttribute('data-slot'), 10);
          var save = loadSave(gameId, slot);
          m.close();
          if (save) applyLoadedState(gameId, save);
        });
      });
      document.querySelectorAll('#modal-root .si-del').forEach(function (b) {
        b.addEventListener('click', function () {
          var slot = parseInt(b.getAttribute('data-slot'), 10);
          modal({ title: '删除存档', body: '<p>确定删除存档 ' + slot + ' 吗？此操作不可撤销。</p>', buttons: [
            { label: '取消' },
            { label: '删除', cls: 'danger', onClick: function () {
              deleteSave(gameId, slot);
              toast('已删除存档 ' + slot);
              m.close();
              UI.openSaveMenu(gameId);
            } }
          ] });
        });
      });
    }, 50);
  };

  // 游戏内的存档管理（保存到槽 / 读档 / 删除）
  UI.openInGameSaveMenu = function () {
    var gameId = G.roomGameId || defaultRoomGame();
    if (!G.state) { toast('当前无游戏进行中'); return; }
    var saves = listSaves(gameId);
    var slotsHtml = '';
    for (var s = 1; s <= SAVE_SLOTS; s++) {
      var sv = null;
      for (var i = 0; i < saves.length; i++) if (saves[i].slot === s) sv = saves[i];
      var info = sv ? '存档 ' + s + '（' + formatSaveTime(sv.savedAt) + '）' : '存档 ' + s + '（空）';
      slotsHtml += '<div class="save-item" data-slot="' + s + '">' +
        '<div class="si-info"><div class="si-name">' + info + '</div></div>' +
        '<div class="si-actions">' +
        (sv ? '<button class="mini-btn primary si-load" data-slot="' + s + '">读取</button>' : '') +
        '<button class="mini-btn si-save" data-slot="' + s + '">保存到此</button>' +
        (sv ? '<button class="mini-btn danger si-del" data-slot="' + s + '">删除</button>' : '') +
        '</div>' +
        '</div>';
    }
    var m = modal({ title: '存档管理', body: '<div class="history-list">' + slotsHtml + '</div>', buttons: [{ label: '关闭', cls: 'primary' }] });
    setTimeout(function () {
      document.querySelectorAll('#modal-root .si-save').forEach(function (b) {
        b.addEventListener('click', function () {
          var slot = parseInt(b.getAttribute('data-slot'), 10);
          // 已占用存档需二次确认覆盖
          var existing = loadSave(gameId, slot);
          if (existing) {
            modal({ title: '覆盖存档', body: '<p>存档 ' + slot + ' 已存在，确定覆盖吗？此操作不可撤销。</p>', buttons: [
              { label: '取消' },
              { label: '覆盖', cls: 'danger', onClick: function () {
                saveGame(gameId, slot);
                toast('已保存到存档 ' + slot, '#4ade80');
                m.close();
              } }
            ] });
          } else {
            saveGame(gameId, slot);
            toast('已保存到存档 ' + slot, '#4ade80');
            m.close();
          }
        });
      });
      document.querySelectorAll('#modal-root .si-load').forEach(function (b) {
        b.addEventListener('click', function () {
          var slot = parseInt(b.getAttribute('data-slot'), 10);
          var save = loadSave(gameId, slot);
          if (save && save.state) {
            var doLoad = function () {
              G.state = save.state;
              // 读档后重置动画/事件状态，避免 AI 卡死
              G.animating = false;
              G.evQueue = [];
              m.close();
              toast('已读取存档 ' + slot);
              if (window.UI.__monoAfterLoad) window.UI.__monoAfterLoad();
            };
            modal({ title: '读取存档', body: '<p>读取后将覆盖当前进度，确定继续？</p>', buttons: [
              { label: '确定', cls: 'danger', onClick: doLoad },
              { label: '取消' }
            ] });
          } else {
            toast('该存档无效');
          }
        });
      });
      document.querySelectorAll('#modal-root .si-del').forEach(function (b) {
        b.addEventListener('click', function () {
          var slot = parseInt(b.getAttribute('data-slot'), 10);
          modal({ title: '删除存档', body: '<p>确定删除存档 ' + slot + ' 吗？此操作不可撤销。</p>', buttons: [
            { label: '取消' },
            { label: '删除', cls: 'danger', onClick: function () {
              deleteSave(gameId, slot);
              toast('已删除存档 ' + slot);
              m.close();
              UI.openInGameSaveMenu();
            } }
          ] });
        });
      });
    }, 50);
  };

  // ── 时钟与历史游戏 ──
  function updateClock() {
    var el = $('clock-btn');
    if (el) el.setAttribute('data-time', new Date().toLocaleTimeString('zh-CN', { hour12: false }));
  }

  // 历史游戏二级菜单
  UI.openHistoryMenu = function () {
    var history = loadGameHistory();
    var body;
    if (history.length === 0) {
      body = '<p class="muted" style="text-align:center;padding:20px 0">暂无游玩记录</p>';
    } else {
      body = '<div class="history-list">' + history.map(function (h) {
        return '<div class="history-item">' +
          '<div class="hi-icon">' + icon(h.icon || 'dice', 30) + '</div>' +
          '<div class="hi-info">' +
          '<div class="hi-name">' + h.name + '</div>' +
          '<div class="hi-time">游玩：' + escapeHtml(h.lastPlayed) + '</div>' +
          '</div>' +
          '</div>';
      }).join('') + '</div>'
        + '<p class="muted" style="text-align:center;font-size:11px;margin-top:6px">共 ' + history.length + ' 条游玩记录</p>';
    }
    modal({ title: '历史游戏', body: body, buttons: [{ label: '关闭', cls: 'primary' }] });
  };

  function loadGameHistory() {
    try {
      var raw = localStorage.getItem('game-history');
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function recordGameHistory(gameId) {
    var g = null;
    for (var i = 0; i < GAME_REGISTRY.length; i++) if (GAME_REGISTRY[i].id === gameId) g = GAME_REGISTRY[i];
    if (!g) return;
    var history = loadGameHistory();
    var now = new Date();
    var timeStr = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2) + ' ' + ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
    // 相邻两条同游戏合并为一条（避免进入设置页即记录、开局又记录造成重复）
    if (history.length && history[0].id === gameId) {
      history[0].lastPlayed = timeStr;
    } else {
      history.unshift({ id: gameId, name: g.name, icon: g.icon, lastPlayed: timeStr });
    }
    if (history.length > 30) history = history.slice(0, 30);
    localStorage.setItem('game-history', JSON.stringify(history));
  }
  // 通用架构：插件通过 GameFramework.recordHistory 更新历史（供第三方插件接入）
  window.GameFramework.recordHistory = function (gameId) { recordGameHistory(gameId); };

  // ── Tab 切换 ──
  UI.switchTab = function (name) {
    ['games', 'room', 'downloads', 'settings'].forEach(function (t) {
      var el = $('home-tab-' + t);
      if (el) el.classList.toggle('hidden', t !== name);
    });
    document.querySelectorAll('.bottom-nav .nav-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === name);
    });
    if (name === 'downloads') renderDownloads();
    if (name === 'games') renderGameList();
  };

  // ── 下载页：插件市场（下载/卸载游戏插件）──
  // 已安装插件来自 GameFramework 注册表；下载通过 loadScript 动态加载插件脚本，
  // 插件脚本内部自行 register() 接入。此页为后续对接 GitHub 仓库的插件下载入口。
  function renderDownloads() {
    var list = $('dl-installed');
    if (!list) return;
    // 绑定 zip 文件选择 → 显示文件名（只绑定一次）
    var zipInput = $('dl-zip');
    if (zipInput && !zipInput._bound) {
      zipInput._bound = true;
      zipInput.addEventListener('change', function () {
        var name = $('dl-zip-name');
        if (name) name.textContent = (zipInput.files && zipInput.files[0]) ? zipInput.files[0].name : '未选择文件';
      });
    }
    var plugins = window.GameFramework ? window.GameFramework.list() : [];
    var installed = loadInstalledPlugins();
    // 合并：运行时注册的插件 + 本地记录的（含重启后未重新加载的 zip 插件）
    var shown = plugins.slice();
    installed.forEach(function (ip) {
      if (!shown.some(function (p) { return p.id === ip.id; })) shown.push(ip);
    });
    if (!shown.length) {
      list.innerHTML = '<p class="muted">暂无已安装插件</p>';
      return;
    }
    list.innerHTML = '';
    shown.forEach(function (p) {
      var isRecorded = !!loadInstalledPlugins().some(function (ip) { return ip.id === p.id; });
      var isLoaded = !!window.GameFramework.get(p.id);
      var item = document.createElement('div');
      item.className = 'dl-item';
      var badges =
        (p.canLan !== false ? '<span class="dl-badge lan">可联机</span>' : '') +
        '<span class="dl-badge builtin">v' + (p.version || '1.0') + '</span>' +
        (isRecorded && !isLoaded ? '<span class="dl-badge" style="background:#f87171;color:#fff">未加载</span>' : '');
      item.innerHTML =
        '<span class="dl-icon">' + icon(p.icon || 'game', 34) + '</span>' +
        '<div class="dl-meta">' +
        '<div class="dl-name">' + escapeHtml(p.name || p.id) + '</div>' +
        (p.desc ? '<div class="dl-desc">' + escapeHtml(p.desc) + '</div>' : '') +
        '<div class="dl-badges">' + badges + '</div>' +
        '</div>' +
        '<button class="mini-btn danger dl-uninstall" data-id="' + escapeHtml(p.id) + '">卸载</button>';
      list.appendChild(item);
      var btn = item.querySelector('.dl-uninstall');
      if (btn) btn.addEventListener('click', function () {
        var pid = btn.getAttribute('data-id');
        var target = window.GameFramework.get(pid);
        modal({
          title: '卸载插件',
          body: '<p>确定卸载「' + escapeHtml((target ? target.name : null) || pid) + '」吗？卸载后该游戏将从菜单移除，本地存档保留。</p>',
          buttons: [
            { label: '取消' },
            { label: '卸载', cls: 'danger', onClick: function () {
              try {
                window.GameFramework.unregister(pid);
                removeInstalledPlugin(pid);
                toast('已卸载插件 ' + pid, '#4ade80');
                renderDownloads();
              } catch (e) { toast('卸载失败：' + e.message, '#f87171'); }
            } }
          ]
        });
      });
    });
  }

  // 下载并安装插件：从 URL 加载插件脚本（脚本内部调用 GameFramework.register 完成接入）
  UI.downloadPlugin = function () {
    var url = ($('dl-url') ? $('dl-url').value.trim() : '');
    var status = $('dl-status');
    if (!url) {
      if (status) { status.textContent = '请填写插件脚本 URL'; status.className = 'dl-status err'; }
      return;
    }
    if (status) { status.textContent = '正在下载 ' + url + ' …'; status.className = 'dl-status'; }
    addLog('插件下载开始 | url=' + url, 'info');
    window.GameFramework.loadScript(url).then(function () {
      if (status) { status.textContent = '安装成功：插件已注册并出现在游戏列表'; status.className = 'dl-status ok'; }
      toast('插件安装成功', '#4ade80');
      addLog('插件下载安装成功 | url=' + url, 'info');
      renderDownloads();
      renderGameList();
    }).catch(function (e) {
      var emsg = friendlyDownloadError('下载失败', e);
      if (status) { status.textContent = emsg; status.className = 'dl-status err'; }
      toast('插件下载失败', '#f87171');
      addLog('插件下载失败 | url=' + url + ' :: ' + (e && e.message ? e.message : e), 'err');
    });
  };

  // ══════════════ 插件安装标准化（本地 zip 安装）══════════════
  // 插件包（zip）标准结构：
  //   plugin.zip
  //   ├── manifest.json   插件清单 { id, name, version, icon, entry, canLan, desc }
  //   └── <entry>         插件入口脚本（调用 GameFramework.register 接入）
  // 若 zip 无 manifest.json，则自动取首个根级 .js 文件作为入口，id 取文件名。
  // 通过 FileReader 读取 zip → JSZip 解压 → 执行入口脚本完成注册。

  // 本地选择 zip 并安装
  UI.installZipPlugin = function () {
    var input = $('dl-zip');
    var status = $('dl-status');
    var file = input && input.files && input.files[0];
    if (!file) {
      if (status) { status.textContent = '请先选择插件 zip 文件'; status.className = 'dl-status err'; }
      return;
    }
    if (!window.JSZip) {
      if (status) { status.textContent = '缺少解压组件（jszip），无法安装 zip 插件'; status.className = 'dl-status err'; }
      return;
    }
    if (status) { status.textContent = '正在解压 ' + file.name + ' …'; status.className = 'dl-status'; }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var zip = new window.JSZip();
        zip.loadAsync(reader.result).then(function (z) {
          return parsePluginZip(z);
        }).then(function (pluginScript) {
          installPluginScript(pluginScript, file.name, status);
        }).catch(function (e) {
          var emsg = (e && e.message ? e.message : String(e));
          if (status) { status.textContent = '安装失败：' + emsg; status.className = 'dl-status err'; }
          toast('插件安装失败', '#f87171');
          addLog('zip 插件解压/解析失败 | file=' + file.name + ' :: ' + emsg, 'err');
        });
      } catch (e) {
        var emsg2 = (e && e.message ? e.message : String(e));
        if (status) { status.textContent = '解压失败：' + emsg2; status.className = 'dl-status err'; }
        addLog('zip 插件解压异常 | file=' + file.name + ' :: ' + emsg2, 'err');
      }
    };
    reader.onerror = function () {
      if (status) { status.textContent = '读取文件失败'; status.className = 'dl-status err'; }
    };
    reader.readAsArrayBuffer(file);
  };

  // 从 URL 下载 zip 插件包并安装（如 GitHub Releases 资产）
  UI.installZipUrl = function () {
    var url = ($('dl-zip-url') ? $('dl-zip-url').value.trim() : '');
    var status = $('dl-status');
    if (!url) {
      if (status) { status.textContent = '请填写插件 zip 包 URL'; status.className = 'dl-status err'; }
      return;
    }
    if (!window.JSZip) {
      if (status) { status.textContent = '缺少解压组件（jszip），无法安装 zip 插件'; status.className = 'dl-status err'; }
      return;
    }
    if (status) { status.textContent = '正在下载 ' + url + ' …'; status.className = 'dl-status'; }
    addLog('zip 插件下载开始 | url=' + url, 'info');
    var fname = url.split('/').pop() || 'plugin.zip';
    // 解析 GitHub release 链接为实时资产 URL
    resolveZipUrl(url).catch(function () { return url; }).then(function (realUrl) {
      // 1) 优先用原生下载（Capacitor GdpiHostPlugin，绕过浏览器 CORS）
      return nativeDownloadZip(realUrl, fname).then(function (buf) {
        return { buf: buf, via: 'native' };
      }).catch(function (e) {
        // 2) 原生失败回退 fetch（浏览器环境）
        return fetchZip(realUrl).then(function (buf) {
          return { buf: buf, via: 'fetch' };
        }).catch(function (e2) {
          throw new Error('下载失败：' + (e2 && e2.message ? e2.message : e2) + '（原生:' + (e && e.message ? e.message : e) + '）');
        });
      });
    }).then(function (res) {
      var zip = new window.JSZip();
      return zip.loadAsync(res.buf).catch(function () {
        throw new Error('下载内容不是有效的 zip 文件（链接可能已过期，请用 github.com 的 release 下载链接）');
      }).then(function (z) { return parsePluginZip(z); });
    }).then(function (pluginScript) {
      installPluginScript(pluginScript, fname, status);
    }).catch(function (e) {
      var emsg = friendlyDownloadError('安装失败', e);
      if (status) { status.textContent = emsg; status.className = 'dl-status err'; }
      toast('插件安装失败', '#f87171');
      addLog('zip 插件下载解析失败 | url=' + url + ' :: ' + (e && e.message ? e.message : e), 'err');
    });
  };

  // 原生下载 zip（Capacitor GdpiHostPlugin.downloadFile → 读取缓存文件），返回 ArrayBuffer
  function nativeDownloadZip(url, fname) {
    var Cp = window.Capacitor;
    if (!Cp || !Cp.Plugins || !Cp.Plugins.GdpiHost || !Cp.Plugins.GdpiHost.downloadFile) {
      return Promise.reject(new Error('原生下载不可用'));
    }
    return Cp.Plugins.GdpiHost.downloadFile({ url: url, filename: fname }).then(function (res) {
      var path = res && res.path;
      if (!path) return Promise.reject(new Error('原生下载未返回文件'));
      // 用 Filesystem 读取缓存文件为 base64，转 ArrayBuffer
      return readFileToArrayBuffer(path);
    });
  }
  // 读取绝对路径文件为 ArrayBuffer（原生 Filesystem readFile base64 → Uint8Array）
  function readFileToArrayBuffer(path) {
    var Cp = window.Capacitor;
    return Cp.Plugins.Filesystem.readFile({ path: path }).then(function (res) {
      var b64 = res && res.data;
      if (!b64) return Promise.reject(new Error('读取文件失败'));
      var binary = atob(b64);
      var len = binary.length;
      var bytes = new Uint8Array(len);
      for (var i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
      return bytes.buffer;
    });
  }
  // fetch 下载 zip，返回 ArrayBuffer
  function fetchZip(url) {
    var opts = { method: 'GET' };
    if (/api\.github\.com\/.*\/assets\//.test(url)) opts.headers = { 'Accept': 'application/octet-stream' };
    return fetch(url, opts).then(function (resp) {
      if (!resp.ok) throw new Error('下载失败（HTTP ' + resp.status + '）');
      return resp.arrayBuffer();
    });
  }

  // 把 GitHub 页面/仓库链接规范化为可直接下载的直链
  // 支持：
  //   github.com/{o}/{r}/blob/{branch}/{path}  → raw.githubusercontent.com/{o}/{r}/{branch}/{path}
  //   github.com/{o}/{r}/raw/{branch}/{path}    → raw.githubusercontent.com/...（同上）
  //   raw.githubusercontent.com 原样返回
  //   releases/download / releases/tag 原样返回（走 resolveZipUrl 处理）
  function normalizeGithubUrl(url) {
    if (!url) return url;
    // blob 或 raw 形式 → raw.githubusercontent.com 直链
    var m = url.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/(?:blob|raw)\/([^\/]+)\/(.+)$/);
    if (m) return 'https://raw.githubusercontent.com/' + m[1] + '/' + m[2] + '/' + m[3] + '/' + m[4];
    return url;
  }

  // 把网络/URL 异常转成用户能看懂的提示（区分网络不可达与链接错误）
  function friendlyDownloadError(prefix, err) {
    var msg = err && err.message ? err.message : (err ? String(err) : '');
    var lower = (prefix + ' ' + msg).toLowerCase();
    if (/failed to fetch|networkerror|net::err|unable to connect|timeout|could not connect|econnreset|socketerror|基础连接|网络|net::/i.test(lower)) {
      return prefix + '：网络无法访问该地址，请检查网络连接（若需科学上网，请在系统/浏览器开启代理或 VPN）';
    }
    if (msg) return prefix + '：' + msg;
    return prefix;
  }

  // 把 GitHub release 下载链接解析为实时有效资产 URL
  // 输入支持：
  //   https://github.com/{owner}/{repo}/releases/download/{tag}/{asset}
  //   https://github.com/{owner}/{repo}/releases/tag/{tag}
  // 非 GitHub 链接原样返回
  function resolveZipUrl(url) {
    url = normalizeGithubUrl(url);
    // 匹配 download 形式：/releases/download/{tag}/{asset}
    var dl = url.match(/github\.com\/([^\/]+)\/([^\/]+)\/releases\/download\/([^\/?#]+)\/([^\/?#]+)/);
    if (dl) {
      var ownerD = dl[1], repoD = dl[2], tagD = dl[3], assetD = dl[4];
      return githubAssetUrl(ownerD, repoD, tagD, assetD);
    }
    // 匹配 tag 形式：/releases/tag/{tag}
    var tg = url.match(/github\.com\/([^\/]+)\/([^\/]+)\/releases\/tag\/([^\/?#]+)/);
    if (tg) {
      return githubAssetUrl(tg[1], tg[2], tg[3], '');
    }
    return Promise.resolve(url);
  }
  // 用 GitHub API 查某 release 的资产下载地址（返回 API 资产下载 URL，CORS 友好、不重定向）
  function githubAssetUrl(owner, repo, tag, wanted) {
    var apiUrl = 'https://api.github.com/repos/' + owner + '/' + repo + '/releases/tags/' + encodeURIComponent(tag);
    return fetch(apiUrl).then(function (r) {
      if (!r.ok) throw new Error('GitHub 查询失败（HTTP ' + r.status + '）');
      return r.json();
    }).then(function (data) {
      var assets = (data && data.assets) || [];
      var asset = assets.find(function (a) { return a.name === wanted; }) || assets.find(function (a) { return /\.zip$/i.test(a.name); }) || assets[0];
      if (!asset) return Promise.reject(new Error('未找到可下载的 zip 资产'));
      // 优先用 GitHub API 资产下载端点（支持 CORS，不重定向，避免 release-assets 跨域失败）
      if (asset.url) return asset.url;
      if (asset.browser_download_url) return asset.browser_download_url;
      return Promise.reject(new Error('资产缺少下载地址'));
    });
  }

  // 解析插件 zip：读取 manifest.json + 入口脚本，返回 { id, script }
  function parsePluginZip(z) {
    var files = z.file(/.*/);
    var names = files.filter(function (f) { return !f.dir; }).map(function (f) { return f.name; });
    var manifest = null;
    var mfFile = z.file('manifest.json');
    if (mfFile) {
      return mfFile.async('string').then(function (txt) {
        try { manifest = JSON.parse(txt); } catch (e) { manifest = null; }
        var entryName = manifest && manifest.entry;
        // 入口可以是 manifest 指定的，或根级唯一 .js
        var jsFile = entryName ? z.file(entryName) : null;
        if (!jsFile && !entryName) {
          jsFile = z.file(/\.[jJ][sS]$/).find(function (f) { return f.name.indexOf('/') < 0; }) || z.file(/\.[jJ][sS]$/).find(function () { return true; });
        }
        if (!jsFile) return Promise.reject(new Error('插件包缺少入口脚本（manifest.entry 或 .js 文件）'));
        return jsFile.async('string').then(function (code) {
          return { manifest: manifest, id: manifest ? manifest.id : jsFile.name.replace(/\.[jJ][sS]$/, ''), script: code };
        });
      });
    }
    // 无 manifest：自动找首个 .js 作为入口
    var firstJs = z.file(/\.[jJ][sS]$/).find(function (f) { return f.name.indexOf('/') < 0; }) || z.file(/\.[jJ][sS]$/).find(function () { return true; });
    if (!firstJs) return Promise.reject(new Error('插件包缺少 .js 入口脚本'));
    return firstJs.async('string').then(function (code) {
      return { manifest: null, id: firstJs.name.replace(/\.[jJ][sS]$/, ''), script: code };
    });
  }

  // 执行插件脚本并完成注册
  function installPluginScript(pkg, fileName, status) {
    // 已安装去重：同一 id 已注册时提示覆盖，避免反复安装
    var existing = window.GameFramework ? window.GameFramework.get(pkg.id) : null;
    if (existing) {
      var body = '<p>插件 <b>' + escapeHtml((existing.name || existing.id)) + '</b>（id=' + escapeHtml(pkg.id) + '）已安装。重新安装将覆盖当前版本。</p>';
      var m = modal({ title: '插件已存在', body: body, buttons: [
        { label: '取消' },
        { label: '覆盖安装', cls: 'danger', onClick: function () {
          m.close();
          // 先卸载旧插件再安装，避免重复注册
          try { window.GameFramework.unregister(pkg.id); } catch (e) {}
          removeInstalledPlugin(pkg.id);
          doInstallPluginScript(pkg, fileName, status);
        } }
      ] });
      return;
    }
    doInstallPluginScript(pkg, fileName, status);
  }
  // 实际执行插件安装
  function doInstallPluginScript(pkg, fileName, status) {
    try {
      // 执行插件脚本（脚本内部调用 GameFramework.register 完成接入）
      var fn = new Function('window', 'document', 'console', pkg.script + '\n//# sourceURL=' + (pkg.id || 'plugin') + '.js');
      fn(window, document, console);
      // 验证是否注册成功
      var reg = window.GameFramework.get(pkg.id);
      var okText = '插件安装成功';
      if (reg) {
        // manifest 的 version 是权威版本号，始终覆盖插件注册对象的 version
        if (pkg.manifest && pkg.manifest.version) {
          try { reg.version = pkg.manifest.version; } catch (e) {}
        }
        okText += '：' + (reg.name || pkg.id) + ' v' + (reg.version || '1.0');
        // 记录到已安装插件列表，持久化脚本源码供下次启动自动恢复
        addInstalledPlugin({ id: pkg.id, file: fileName, source: 'zip', script: pkg.script, version: (reg.version || pkg.manifest ? (pkg.manifest && pkg.manifest.version) : '1.0'), name: (reg.name || pkg.id) });
        addLog('插件安装成功 | id=' + pkg.id + ', name=' + (reg.name || '') + ', version=' + (reg.version || ''), 'info');
      } else if (pkg.manifest) {
        // 有 manifest 但未按约定 id 注册，提示
        okText += '（脚本已执行，但未以 id="' + pkg.id + '" 注册）';
        addLog('插件脚本已执行但未按清单 id 注册 | id=' + pkg.id, 'warn');
      }
      if (status) { status.textContent = okText; status.className = 'dl-status ok'; }
      toast(okText, '#4ade80');
      renderDownloads();
      renderGameList();
    } catch (e) {
      var emsg = (e && e.message ? e.message : String(e));
      if (status) { status.textContent = '安装失败：' + emsg; status.className = 'dl-status err'; }
      toast('插件安装失败', '#f87171');
      addLog('插件安装失败 | id=' + pkg.id + ', file=' + fileName + ' :: ' + emsg + (e && e.stack ? ' :: ' + e.stack : ''), 'err');
    }
  }

  // ── 已安装插件持久化（本地 zip 安装的插件，启动时自动恢复加载）──
  var INSTALLED_KEY = 'installed-plugins';
  function loadInstalledPlugins() {
    try { return JSON.parse(localStorage.getItem(INSTALLED_KEY) || '[]'); } catch (e) { return []; }
  }
  function addInstalledPlugin(p) {
    var list = loadInstalledPlugins();
    if (!list.some(function (x) { return x.id === p.id; })) list.push(p);
    try { localStorage.setItem(INSTALLED_KEY, JSON.stringify(list)); } catch (e) {}
  }
  function removeInstalledPlugin(id) {
    var list = loadInstalledPlugins();
    var next = list.filter(function (x) { return x.id !== id; });
    try { localStorage.setItem(INSTALLED_KEY, JSON.stringify(next)); } catch (e) {}
  }
  // 启动时自动恢复本地安装的插件：重新执行持久化的脚本源码完成注册
  function restoreInstalledPlugins() {
    var list = loadInstalledPlugins();
    var restored = 0, failed = 0;
    list.forEach(function (p) {
      // 已在运行时注册的跳过
      if (window.GameFramework && window.GameFramework.get(p.id)) return;
      if (!p.script) { failed++; return; } // 无脚本源码（旧记录），无法恢复
      try {
        var fn = new Function('window', 'document', 'console', p.script + '\n//# sourceURL=' + p.id + '-restore.js');
        fn(window, document, console);
        if (window.GameFramework && window.GameFramework.get(p.id)) {
          restored++;
          addLog('插件自动恢复加载 | id=' + p.id + ', name=' + (p.name || '') + ', version=' + (p.version || ''), 'info');
        } else {
          failed++;
          addLog('插件自动恢复失败（未注册）| id=' + p.id, 'warn');
        }
      } catch (e) {
        failed++;
        addLog('插件自动恢复失败 | id=' + p.id + ' :: ' + (e && e.message ? e.message : e), 'err');
      }
    });
    if (failed > 0) {
      setTimeout(function () { toast('有 ' + failed + ' 个插件自动加载失败，可到插件安装页重新安装', '#fbbf24'); }, 1500);
    }
    // 恢复后刷新游戏列表（若此时已渲染）
    if (restored > 0) {
      try { renderGameList(); } catch (e) {}
    }
  }

  // ── 房间页：创建/加入切换 ──
  UI.switchRoomMode = function (mode) {
    document.querySelectorAll('.room-tab-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-mode') === mode);
    });
    var track = $('room-pane-track');
    if (track) {
      var target = (mode === 'join') ? 1 : 0;
      track.scrollTo({ left: target * track.clientWidth, behavior: 'smooth' });
    }
  };

  // 初始化房间分页滑动切换 + 滚动同步 tab 高亮
  function initRoomPaneSwipe() {
    var track = $('room-pane-track');
    if (!track) return;
    track.addEventListener('scroll', function () {
      var idx = Math.round(track.scrollLeft / track.clientWidth);
      var mode = (idx === 1) ? 'join' : 'create';
      document.querySelectorAll('.room-tab-btn').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-mode') === mode);
      });
    }, { passive: true });
  }
  initRoomPaneSwipe();

  // 游戏选择二级菜单（可联机游戏，来自插件注册表，纯框架不硬编码任何游戏）
  UI.openGameSelect = function () {
    var lanAll = GAME_REGISTRY.filter(function (g) { return g.canLan !== false; });
    if (!lanAll.length) {
      modal({ title: '选择游戏', body: '<p class="muted" style="text-align:center;padding:16px 0">暂无可联机游戏插件，请先到「下载」页安装</p>', buttons: [{ label: '关闭', cls: 'primary' }] });
      return;
    }
    var body = '<div class="game-select-list">' + lanAll.map(function (g) {
      return '<button class="menu-func gs-item" data-id="' + g.id + '">' +
        '<span class="mf-ico">' + icon(g.icon, 19) + '</span>' + g.name + '</button>';
    }).join('') + '</div>';
    var m = modal({ title: '选择游戏', body: body, buttons: [{ label: '取消' }] });
    setTimeout(function () {
      document.querySelectorAll('#modal-root .gs-item').forEach(function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-id');
          var g = null;
          for (var i = 0; i < GAME_REGISTRY.length; i++) if (GAME_REGISTRY[i].id === id) g = GAME_REGISTRY[i];
          if (g) {
            var btn = $('rc-game-btn');
            if (btn) btn.textContent = g.name + ' ▾';
            G.roomGameId = id;
          }
          m.close();
        });
      });
    }, 50);
  };

  // 房间创建（第二页）→ 联机
  UI.roomCreate = function () {
    var myName = ($('rc-nickname').value.trim() || '房主').slice(0, 12);
    var roomName = ($('rc-roomname').value.trim() || '桌游房间').slice(0, 12);
    var password = $('rc-password').value.trim();
    // 端口：可自定义（参考加入房间的端口一栏），留空用默认 3001
    var portStr = $('rc-port') ? $('rc-port').value.trim() : '';
    var portNum = parseInt(portStr, 10);
    G.roomPort = (portStr && !isNaN(portNum) && portNum > 0 && portNum < 65536) ? portNum : 3001;
    // 写入老接口字段供 startHostRoom 读取
    if ($('lan-nickname')) $('lan-nickname').value = myName;
    if ($('lan-roomname')) $('lan-roomname').value = roomName;
    if ($('lan-createpass')) $('lan-createpass').value = password;
    localStorage.setItem('my-name', myName);
    G.roomGameId = G.roomGameId || defaultRoomGame();
    startHostRoom();
  };

  // 房间加入（第二页）
  // 拼接 IP 与端口：未填端口自动补 3001，填了以输入为准
  function buildHostWithPort(host, port) {
    host = String(host || '').trim();
    if (!host) return '';
    var p = String(port || '').trim();
    var defaultPort = '3001';
    // 若 IP 已带端口则不重复追加
    if (/:\d+$/.test(host)) return host;
    return host + ':' + (p || defaultPort);
  }

  UI.roomJoin = function () {
    var name = ($('rj-nickname').value.trim() || '玩家').slice(0, 12);
    var pass = $('rj-joinpass').value.trim();
    localStorage.setItem('my-name', name);
    if (G.joinMode === 'code') {
      var code = ($('rj-joincode').value.trim() || '').toUpperCase();
      if (!code) { toast('请输入5位房间号'); return; }
      joinByCodeWith(name, code, pass);
    } else {
      var host = $('rj-host').value.trim();
      if (!host) { toast('请填写房主IP'); return; }
      var port = $('rj-port') ? $('rj-port').value : '';
      connectLan(buildHostWithPort(host, port), '', pass);
    }
  };

  UI.showLanChoice = function () {
    $('lan-choice').classList.remove('hidden');
    $('lan-join').classList.add('hidden');
    $('lan-create').classList.add('hidden');
  };

  UI.showLanJoin = function () {
    $('lan-choice').classList.add('hidden');
    $('lan-join').classList.remove('hidden');
    $('lan-create').classList.add('hidden');
    var saved = localStorage.getItem('lan-server');
    if (saved && !$('lan-host').value) $('lan-host').value = saved;
  };

  UI.showLanCreate = function () {
    $('lan-choice').classList.add('hidden');
    $('lan-join').classList.add('hidden');
    $('lan-create').classList.remove('hidden');
  };

  UI.showLan = function () {
    ['screen-menu', 'screen-lan', 'screen-room', 'screen-settings'].forEach(function (id) {
      var el = $(id); if (el) el.classList.add('hidden');
    });
    $('screen-lan').classList.remove('hidden');
    $('lan-nickname').value = localStorage.getItem('my-name') || '';
    UI.showLanChoice();
  };

  UI.createRoom = function () {
    startHostRoom();
  };

  function udpSendRaw(obj) {
    var Cp = window.Capacitor;
    if (Cp && Cp.Plugins && Cp.Plugins.GdpiHost && Cp.Plugins.GdpiHost.udpSend) {
      Cp.Plugins.GdpiHost.udpSend({ msg: JSON.stringify(obj) });
    }
  }

  function sendLan(msg) {
    if (G.udpMode) {
      udpSendRaw(msg);
      return;
    }
    if (G.ws && G.ws.readyState === 1) {
      G.ws.send(JSON.stringify(msg));
    }
  }

  function udpFallback(host, joinCode, password) {
    var Cp = window.Capacitor;
    if (!Cp || !Cp.Plugins || !Cp.Plugins.GdpiHost || !Cp.Plugins.GdpiHost.udpConnect) {
      toast('无法连接房主：网络环境可能限制该连接', '#f87171');
      return;
    }
    // 端口策略：房主 UDP 数据通道固定 3001（发现/数据共用）。
    // IP直连自定义端口时，UDP 通道仍优先尝试自定义端口（若房主同端口有 UDP 服务），
    // 失败后自动回退 3001，保证自定义端口场景 UDP fallback 也能加入。
    var hostParts = String(host || '').split(':');
    var ip = hostParts[0];
    var customPort = parseInt(hostParts[1], 10);
    var portList = [];
    if (customPort && customPort !== 3001) portList.push(customPort);
    portList.push(3001);
    var tryPort = function (idx) {
      if (idx >= portList.length) {
        toast('UDP连接失败：请确认IP正确且双方网络互通', '#f87171');
        return;
      }
      var port = portList[idx];
      toast('TCP连接受限，尝试UDP通道（端口 ' + port + '）…');
      addLog('udpFallback 尝试端口 ' + port, 'warn');
      Cp.Plugins.GdpiHost.udpConnect({ ip: ip, port: port }).then(function () {
        addLog('UDP通道连接成功 ' + ip + ':' + port, 'ok');
        G.udpMode = true;
        G.mode = 'lan';
        G.joinWaiting = true;
        G.joinTimeoutAt = Date.now() + 8000;
        if (!G.udpListener) {
          G.udpListener = Cp.Plugins.GdpiHost.addListener('gdpiUdpEvent', function (e) {
            var msg;
            try {
              msg = JSON.parse(e.msg);
            } catch (err) {
              return;
            }
            if (msg.t === 'lobby_state' || msg.t === 'joined' || msg.t === 'game_started' || msg.t === 'join_reject') {
              G.joinWaiting = false;
            }
            try { handleLanMsg(msg); } catch (err) { console.error('udp msg error', err); }
          });
        }
        var myName = (localStorage.getItem('my-name') || '玩家').slice(0, 12);
        var joinMsg = { t: 'join_host', code: joinCode, name: myName, password: password || '', version: APP_VERSION };
        udpSendRaw(joinMsg);
        setTimeout(function () {
          if (G.joinWaiting && G.udpMode) udpSendRaw(joinMsg);
        }, 1500);
        setTimeout(function () {
          if (G.joinWaiting && G.udpMode) udpSendRaw(joinMsg);
        }, 3500);
        setTimeout(function () {
          if (G.joinWaiting && G.udpMode) {
            toast('加入失败：请确认IP正确且双方网络互通', '#f87171');
          }
        }, 8000);
      }).catch(function (e) {
        tryPort(idx + 1);
      });
    };
    tryPort(0);
  }

  function connectLan(host, joinCode, password) {
    if (!host) return;
    if (G.ws) {
      try { G.ws.onclose = null; G.ws.onerror = null; G.ws.close(); } catch (e) {}
      G.ws = null;
    }
    G.udpMode = false;
    var url = 'ws://' + host;
    if (!/:\d+$/.test(host)) url += ':3001';
    addLog('connectLan → ' + url + (joinCode ? '（房间号 ' + joinCode + '）' : ''), 'info');
    var ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      udpFallback(host, joinCode, password);
      return;
    }
    G.ws = ws;
    G.joinWaiting = true;
    G.joinTimeoutAt = Date.now() + 8000;
    var opened = false;
    var fallbackDone = false;
    var doFallback = function () {
      if (fallbackDone) return;
      fallbackDone = true;
      try { ws.onclose = null; ws.onerror = null; ws.close(); } catch (e) {}
      G.ws = null;
      udpFallback(host, joinCode, password);
    };
    toast('正在连接 ' + url + ' …');
    ws.onopen = function () {
      opened = true;
      G.mode = 'lan';
      var myName = (localStorage.getItem('my-name') || '玩家').slice(0, 12);
      ws.send(JSON.stringify({ t: 'join_host', code: joinCode, name: myName, password: password || '', version: APP_VERSION }));
    };
    ws.onerror = function () {
      if (!opened) {
        doFallback();
      } else {
        toast('连接中断', '#f87171');
      }
    };
    ws.onclose = function () {
      if (!opened) {
        doFallback();
        return;
      }
      if (G.joinWaiting) {
        toast('无法加入房间：连接被关闭', '#f87171');
      } else if (G.mode === 'lan' && G.state) {
        toast('与房主断开连接');
      }
      G.joinWaiting = false;
    };
    ws.onmessage = function (e) {
      var msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg.t === 'lobby_state' || msg.t === 'joined' || msg.t === 'game_started' || msg.t === 'join_reject') {
        G.joinWaiting = false;
      }
      // 客户端消息处理隔离：单个游戏消息异常不破坏连接与系统框架
      try { handleLanMsg(msg); }
      catch (err) { console.error('lan msg error', err); }
    };
    setTimeout(function () {
      if (!opened && !fallbackDone) {
        doFallback();
      }
    }, 3000);
  }

  var JOIN_MODES = [
    { v: 'ip', label: '房主IP直连' },
    { v: 'code', label: '房间号' }
  ];

  function syncJoinRows() {
    var isCode = G.joinMode === 'code';
    var ipRow = $('lan-join-ip-row');
    var codeRow = $('lan-join-code-row');
    var portRow = $('lan-join-port-row');
    if (ipRow) ipRow.classList.toggle('hidden', isCode);
    if (codeRow) codeRow.classList.toggle('hidden', !isCode);
    // 房间号模式无需手动端口，隐藏端口行（IP直连才显示）
    if (portRow) portRow.classList.toggle('hidden', isCode);
  }

  function attachJoinMode() {
    var btn = $('lan-joinmode-btn');
    if (!btn) return;
    G.joinMode = G.joinMode || 'ip';
    btn.textContent = G.joinMode === 'ip' ? '房主IP直连' : '房间号';
    btn.addEventListener('click', function () {
      var items = JOIN_MODES.map(function (o) {
        return '<button class="menu-func' + (G.joinMode === o.v ? ' seat-active' : '') + '" data-v="' + o.v + '">' + o.label + '</button>';
      }).join('');
      var m = modal({ title: '加入方式', body: '<div class="menu-funcs">' + items + '</div>', buttons: [{ label: '取消' }] });
      setTimeout(function () {
        document.querySelectorAll('#modal-root .menu-func[data-v]').forEach(function (b) {
          b.addEventListener('click', function () {
            G.joinMode = b.getAttribute('data-v');
            btn.textContent = G.joinMode === 'ip' ? '房主IP直连' : '房间号';
            syncJoinRows();
            m.close();
          });
        });
      }, 50);
    });
    syncJoinRows();
  }

  // 房间页（第二页）的加入方式切换（tab 房间页专用）
  function attachRoomJoinMode() {
    var btn = $('rj-joinmode-btn');
    if (!btn) return;
    G.joinMode = G.joinMode || 'ip';
    btn.textContent = G.joinMode === 'ip' ? '房主IP直连' : '房间号';
    btn.onclick = function () {
      var items = JOIN_MODES.map(function (o) {
        return '<button class="menu-func' + (G.joinMode === o.v ? ' seat-active' : '') + '" data-v="' + o.v + '">' + o.label + '</button>';
      }).join('');
      var m = modal({ title: '加入方式', body: '<div class="menu-funcs">' + items + '</div>', buttons: [{ label: '取消' }] });
      setTimeout(function () {
        document.querySelectorAll('#modal-root .menu-func[data-v]').forEach(function (b) {
          b.addEventListener('click', function () {
            G.joinMode = b.getAttribute('data-v');
            btn.textContent = G.joinMode === 'ip' ? '房主IP直连' : '房间号';
            var ipRow = $('rj-join-ip-row');
            var codeRow = $('rj-join-code-row');
            var portRow = $('rj-join-port-row');
            if (ipRow) ipRow.classList.toggle('hidden', G.joinMode === 'code');
            if (codeRow) codeRow.classList.toggle('hidden', G.joinMode !== 'code');
            // 房间号模式无需手动端口，隐藏端口行（IP直连才显示）
            if (portRow) portRow.classList.toggle('hidden', G.joinMode === 'code');
            m.close();
          });
        });
      }, 50);
    };
  }

  function joinByCodeWith(name, code, pass) {
    localStorage.setItem('my-name', name);
    code = String(code || '').toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) {
      toast('请输入5位房间号');
      return;
    }
    var Cp = window.Capacitor;
    if (Cp && Cp.Plugins && Cp.Plugins.GdpiHost && Cp.Plugins.GdpiHost.discoverRoom) {
      toast('正在自动匹配房间 ' + code + ' …');
      Cp.Plugins.GdpiHost.discoverRoom({ code: code }).then(function (res) {
        if (res && res.ip) {
          localStorage.setItem('lan-server', res.ip);
          connectLan(res.ip + ':' + res.port, code, pass);
        }
      }).catch(function (e) {
        toast((e && e.message ? e.message : '未找到该房间') + '；若使用UU加速器等异地联机工具，请改用房主IP直连', '#f87171');
      });
    } else {
      toast('当前设备不支持自动匹配，请使用房主IP直连方式', '#f87171');
    }
  }

  UI.joinByCode = function () {
    var name = ($('lan-nickname').value.trim() || '玩家').slice(0, 12);
    localStorage.setItem('my-name', name);
    var pass = $('lan-joinpass').value.trim();
    if (G.joinMode === 'code') {
      var code = $('lan-joincode').value.trim().toUpperCase();
      if (!/^[A-Z0-9]{5}$/.test(code)) {
        toast('请输入5位房间号');
        return;
      }
      var Cp = window.Capacitor;
      if (Cp && Cp.Plugins && Cp.Plugins.GdpiHost && Cp.Plugins.GdpiHost.discoverRoom) {
        toast('正在自动匹配房间 ' + code + ' …');
        Cp.Plugins.GdpiHost.discoverRoom({ code: code }).then(function (res) {
          if (res && res.ip) {
            localStorage.setItem('lan-server', res.ip);
            connectLan(res.ip + ':' + res.port, code, pass);
          }
        }).catch(function (e) {
          toast((e && e.message ? e.message : '未找到该房间') + '；若使用UU加速器等异地联机工具，请改用房主IP直连', '#f87171');
        });
      } else {
        toast('当前设备不支持自动匹配，请使用房主IP直连方式', '#f87171');
      }
      return;
    }
    var host = $('lan-host').value.trim();
    if (!host) {
      toast('请填写房主IP');
      return;
    }
    var port = $('lan-port') ? $('lan-port').value : '';
    var hostFull = buildHostWithPort(host, port);
    localStorage.setItem('lan-server', hostFull);
    connectLan(hostFull, '', pass);
  };

  function startHeartbeat() {
    if (G.heartbeatTimer) return;
    G.heartbeatTimer = setInterval(function () {
      if (G.mode === 'lan') sendLan({ t: 'ping' });
    }, 5000);
  }

  function handleLanMsg(msg) {
    // 通用插件分发：消息类型以某插件 id 为前缀（如 poker_/sgs_/monopoly_ 等）时，交给该插件 onLanMsg 钩子处理
    if (msg && msg.t && typeof msg.t === 'string') {
      var dot = msg.t.indexOf('_');
      if (dot > 0) {
        var prefix = msg.t.slice(0, dot);
        var pplug = window.GameFramework.get(prefix);
        if (pplug && typeof pplug.onLanMsg === 'function') {
          try { if (pplug.onLanMsg(msg)) return; } catch (e) { console.error(prefix + ' lan msg error', e); }
        }
      }
    }
    switch (msg.t) {
      case 'hello':
        break;
      case 'rooms':
        renderRooms(msg.list);
        break;
      case 'joined':
        G.joinWaiting = false;
        G.room = msg.room;
        G.isHost = msg.isHost;
        G.mySeat = msg.room.mySeat;
        G.mode = 'lan';
        ['screen-menu', 'screen-lan', 'screen-room', 'screen-settings'].forEach(function (id) {
          var el = $(id); if (el) el.classList.add('hidden');
        });
        $('screen-room').classList.remove('hidden');
        renderLobby();
        break;
      case 'room_info':
        G.room = msg.room;
        G.isHost = G.room.hostId === (G.ws && G.ws.clientId);
        if (!$('screen-room').classList.contains('hidden')) renderLobby();
        break;
      case 'error':
        if (msg.code === 'empty_seats') {
          modal({
            title: '确认开始游戏',
            body: '<p>还有 ' + msg.count + ' 个人类空位，确认后用 AI 玩家补齐并开始游戏？</p>',
            buttons: [
              { label: '用AI补齐并开始', cls: 'primary', onClick: function () { sendRoom({ t: 'start', fillAI: true }); } },
              { label: '取消' }
            ]
          });
        } else {
          toast(msg.msg, '#f87171');
        }
        break;
      case 'kicked':
        toast('你的座位被房主调整了', '#f87171');
        break;
      case 'game_started':
        G.mode = G.mode || 'lan';
        G.state = msg.state;
        if (msg.playerId) G.myPlayerId = msg.playerId;
        G.lobby = null;
        G.isHostLobby = false;
        startHeartbeat();
        // 通用插件分发：交给当前房间游戏的 onGameStarted 钩子（不硬编码任何游戏）
        if (G.roomGameId) {
          var startedPlug = window.GameFramework.get(G.roomGameId);
          if (startedPlug && typeof startedPlug.onGameStarted === 'function') {
            try { startedPlug.onGameStarted(msg); } catch (e) { console.error('onGameStarted error', e); }
          }
        }
        break;
      case 'joined_ok':
        break;
      case 'join_reject':
        toast(msg.msg || '加入失败', '#f87171');
        G.mode = null;
        // 顺序尝试下一 IP（搜索房间时同房间号多 IP）
        if (G.retryJoin && G.retryJoin.ips && G.retryJoin.idx + 1 < G.retryJoin.ips.length) {
          var rj = G.retryJoin;
          G.retryJoin = null;
          tryJoinRoomByIps(rj.ips, rj.idx + 1, rj.code, rj.pass);
        } else {
          G.retryJoin = null;
        }
        break;
      case 'lobby_state':
        var firstJoin = !G.lobby;
        G.lobby = msg.lobby;
        G.isHostLobby = false;
        G.mode = 'lan';
        if (firstJoin) G.selfReady = false;
        // 客户端防御性版本检查：与房主版本差异超过 3 个则提示并离开
        var hostV = versionScore(String((msg.lobby && msg.lobby.version) || ''));
        var myV = versionScore(APP_VERSION);
        if (hostV !== null && myV !== null && Math.abs(hostV - myV) > 3) {
          toast('版本与房主差异过大，请更新到 ' + (msg.lobby.version || '') + ' 附近版本', '#f87171');
          if (G.ws) { try { G.ws.onclose = null; G.ws.close(); } catch (e) {} G.ws = null; }
          G.lobby = null;
          G.mode = null;
          G.selfReady = false;
          UI.showLan();
          break;
        }
        startHeartbeat();
        showLobbyScreen();
        renderLobby();
        break;
      case 'kicked_lobby':
        toast('你已被房主移出房间', '#f87171');
        if (G.ws) {
          try { G.ws.onclose = null; G.ws.close(); } catch (e) {}
          G.ws = null;
        }
        G.lobby = null;
        G.mode = null;
        UI.showLan();
        break;
      case 'chat':
        appendChat(msg.name, msg.text);
        break;
      case 'info':
        toast(msg.msg || '', '#f87171');
        break;
      case 'emoji':
        playEmojiFlight(msg.from, msg.to, msg.emoji);
        break;
    }
  }

  function renderRooms(list) {
    var el = $('lan-rooms');
    if (!el) return;
    if (!list.length) {
      el.innerHTML = '<p class="muted">暂无房间，可自行创建</p>';
      return;
    }
    el.innerHTML = '';
    list.forEach(function (r) {
      var item = document.createElement('div');
      item.className = 'room-item';
      var stateTag = r.started ? '<span style="color:#f87171">进行中</span>' : '<span style="color:#4ade80">等待中</span>';
      item.innerHTML =
        '<div><div class="room-name">' + escapeHtml(r.name) + '　' + stateTag + '</div>' +
        '<div class="room-meta">房间号 <b style="color:#fbbf24;letter-spacing:2px">' + escapeHtml(r.code || '-') + '</b> · ' + r.players + '/' + r.maxSeats + ' 人</div></div>' +
        '<button class="mini-btn primary"' + (r.started ? ' disabled' : '') + '>' + (r.started ? '进行中' : '加入') + '</button>';
      if (!r.started) {
        item.querySelector('button').addEventListener('click', function () {
          var myName = (localStorage.getItem('my-name') || '玩家').slice(0, 12);
          sendRoom({ t: 'join_room', roomId: r.id, name: myName });
        });
      }
      el.appendChild(item);
    });
  }

  UI.createRoom = function () {
    startHostRoom();
  };

  function genRoomCode() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var c = '';
    for (var i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
    return c;
  }

  function hostSend(connId, obj) {
    var Cp = window.Capacitor;
    if (Cp && Cp.Plugins && Cp.Plugins.GdpiHost) {
      if (connId && String(connId).indexOf('udp:') === 0) {
        Cp.Plugins.GdpiHost.udpSendTo({ connId: connId, msg: JSON.stringify(obj) });
      } else {
        Cp.Plugins.GdpiHost.sendMsg({ connId: connId || '', msg: JSON.stringify(obj) });
      }
    }
  }

  function broadcastHost(obj) {
    hostSend(null, obj);
    var Cp = window.Capacitor;
    if (Cp && Cp.Plugins && Cp.Plugins.GdpiHost) {
      Object.keys(G.hostConns || {}).forEach(function (cid) {
        if (String(cid).indexOf('udp:') === 0) {
          Cp.Plugins.GdpiHost.udpSendTo({ connId: cid, msg: JSON.stringify(obj) });
        }
      });
    }
  }

  function findHostSeat() {
    if (!G.state || G.state.over) return -1;
    for (var i = 1; i < G.state.players.length; i++) {
      var pl = G.state.players[i];
      if (pl.isAI && pl.alive) return i;
    }
    return -1;
  }

  function getConnIp(connId) {
    if (!connId) return null;
    var s = String(connId);
    if (s.indexOf('udp:') === 0) {
      var parts = s.slice(4).split(':');
      return parts[0];
    }
    var c = G.hostConns[connId];
    if (c && c.ip) return c.ip;
    return null;
  }

  function onHostEvent(e) {
    if (e.type === 'open') {
      var ip = null;
      if (e.ip) {
        var m = String(e.ip).match(/\/([\d.]+):/);
        if (m) ip = m[1];
      }
      G.hostConns[e.connId] = { seat: -1, pendingSeat: -1, ip: ip };
      G.connLastSeen = G.connLastSeen || {};
      G.connLastSeen[e.connId] = Date.now();
    } else if (e.type === 'message') {
      G.connLastSeen = G.connLastSeen || {};
      G.connLastSeen[e.connId] = Date.now();
      var m;
      try { m = JSON.parse(e.msg); } catch (err) { return; }
      // 消息处理隔离：单个游戏/动作消息异常不中断宿主消息循环
      try { handleHostMsg(e.connId, m); }
      catch (err) { console.error('host msg error', err); }
    } else if (e.type === 'close') {
      var c = G.hostConns[e.connId];
      if (c) {
        delete G.hostConns[e.connId];
        if (G.lobby && !G.lobby.started) {
          var lp = G.lobby.players.find(function (p) { return p.connId === e.connId; });
          if (lp && !lp.isHost) {
            G.lobby.players = G.lobby.players.filter(function (p) { return p.connId !== e.connId; });
            broadcastLobby();
          }
        } else if (c.seat >= 0 && G.state) {
          var pl = G.state.players[c.seat];
          if (pl && !pl.isAI && pl.alive) {
            pl.online = false;
            toast(pl.name + ' 已离线（超过5回合将自动AI托管）', '#f87171');
            if (window.UI.__monoRenderAll) window.UI.__monoRenderAll();
          }
        }
      }
    }
  }

  function handleHostMsg(connId, m) {
    // 通用插件分发：消息类型以某插件 id 为前缀（如 poker_/sgs_/monopoly_ 等）时，交给该插件 onHostMsg 钩子处理
    if (m && m.t && typeof m.t === 'string') {
      var dot = m.t.indexOf('_');
      if (dot > 0) {
        var prefix = m.t.slice(0, dot);
        var pplug = window.GameFramework.get(prefix);
        if (pplug && typeof pplug.onHostMsg === 'function') {
          try { if (pplug.onHostMsg(connId, m)) return; } catch (e) { console.error(prefix + ' host msg error', e); }
        }
      }
    }
    if (m.t === 'ping') {
      G.connLastSeen = G.connLastSeen || {};
      G.connLastSeen[connId] = Date.now();
      return;
    }
    if (m.t === 'join_host') {
      if (!G.hostMode || !G.lobby) {
        hostSend(connId, { t: 'join_reject', msg: '房间不存在' });
        return;
      }
      var codeOk = !m.code || String(m.code).toUpperCase() === G.lobby.code;
      if (!codeOk) {
        hostSend(connId, { t: 'join_reject', msg: '房间号不正确' });
        return;
      }
      if (G.lobby.hasPassword && String(m.password || '') !== G.lobby.password) {
        hostSend(connId, { t: 'join_reject', msg: '密码错误' });
        return;
      }
      // 版本兼容门槛：客户端与房主版本差异超过 3 个则拒绝并提示更新
      var HOST_VERSION_MAX_DIFF = 3;
      var clientVer = versionScore(String(m.version || ''));
      var hostVer = versionScore(APP_VERSION);
      if (clientVer !== null && Math.abs(hostVer - clientVer) > HOST_VERSION_MAX_DIFF) {
        hostSend(connId, { t: 'join_reject', msg: '版本与房主差异过大，请更新到 ' + APP_VERSION + ' 附近版本' });
        return;
      }
      var name = String(m.name || '玩家').slice(0, 12);
      toast(name + ' 正在加入房间', '#4ade80');
      var joinIp = getConnIp(connId);
      var reclaimSeat = -1;
      if (G.state) {
        G.seatIps = G.seatIps || {};
        for (var i = 1; i < G.state.players.length; i++) {
          var pl0 = G.state.players[i];
          if (!pl0.isAI && pl0.alive && joinIp && G.seatIps[i] === joinIp) {
            reclaimSeat = i;
            break;
          }
        }
        if (reclaimSeat < 0) {
          for (var i2 = 1; i2 < G.state.players.length; i2++) {
            var pl1 = G.state.players[i2];
            if (!pl1.isAI && pl1.alive && pl1.online === false && pl1.name === name) {
              reclaimSeat = i2;
              break;
            }
          }
        }
      }
      if (reclaimSeat >= 0) {
        G.hostConns[connId] = G.hostConns[connId] || { seat: -1, pendingSeat: -1 };
        G.hostConns[connId].pendingSeat = reclaimSeat;
        G.hostConns[connId].seat = reclaimSeat;
        G.seatIps = G.seatIps || {};
        if (joinIp) G.seatIps[reclaimSeat] = joinIp;
        hostSend(connId, { t: 'reconnect_prompt', name: name, seat: reclaimSeat });
        return;
      }
      if (G.lobby.started || G.state) {
        var seat = findHostSeat();
        if (seat < 0) {
          hostSend(connId, { t: 'join_reject', msg: '房间已满' });
          return;
        }
        G.hostConns[connId] = G.hostConns[connId] || { seat: -1, pendingSeat: -1 };
        G.hostConns[connId].seat = seat;
        var pl = G.state.players[seat];
        pl.isAI = false;
        pl.online = true;
        pl.name = name;
        G.seatIps = G.seatIps || {};
        if (joinIp) G.seatIps[seat] = joinIp;
        hostSend(connId, { t: 'joined_ok', seat: seat, playerId: pl.id });
        hostSend(connId, { t: 'game_started', state: G.state, events: [{ type: 'joined' }], playerId: pl.id });
        broadcastHost({ t: 'state', state: G.state, events: [{ type: 'info', msg: pl.name + ' 加入了房间' }] });
        if (window.UI.__monoRenderAll) window.UI.__monoRenderAll();
        if (window.UI.__monoPumpHostAI) window.UI.__monoPumpHostAI();
        return;
      }
      var taken = G.lobby.players.length;
      var myIp = getConnIp(connId);
      var existIdx = -1;
      if (myIp) {
        for (var eIdx = 0; eIdx < G.lobby.players.length; eIdx++) {
          var ep0 = G.lobby.players[eIdx];
          if (ep0.isHost) continue;
          var epIp = ep0.connId ? getConnIp(ep0.connId) : null;
          if (epIp && epIp === myIp) { existIdx = eIdx; break; }
        }
      }
      if (existIdx < 0) {
        existIdx = G.lobby.players.findIndex(function (p) {
          return !p.isHost && p.name === name;
        });
      }
      if (existIdx >= 0) {
        G.lobby.players[existIdx].connId = connId;
        G.lobby.players[existIdx].name = name;
        var existSeat = G.lobby.players[existIdx].seat;
        G.hostConns[connId] = G.hostConns[connId] || { seat: -1, pendingSeat: -1 };
        G.hostConns[connId].seat = existSeat;
        G.seatIps = G.seatIps || {};
        if (joinIp) G.seatIps[existSeat] = joinIp;
        hostSend(connId, { t: 'lobby_state', lobby: lobbyPublic(), isHost: false });
        broadcastLobby();
        return;
      }
      if (taken >= G.lobby.seats) {
        hostSend(connId, { t: 'join_reject', msg: '房间已满' });
        return;
      }
      var usedSeats = G.lobby.players.map(function (p) { return p.seat; });
      var seat2 = -1;
      for (var s = 1; s < G.lobby.seats; s++) {
        if (usedSeats.indexOf(s) < 0) { seat2 = s; break; }
      }
      G.lobby.players.push({ seat: seat2, connId: connId, name: name, ready: false, isHost: false });
      G.hostConns[connId] = G.hostConns[connId] || { seat: -1, pendingSeat: -1 };
      G.hostConns[connId].seat = seat2;
      G.seatIps = G.seatIps || {};
      if (joinIp) G.seatIps[seat2] = joinIp;
      hostSend(connId, { t: 'lobby_state', lobby: lobbyPublic(), isHost: false });
      broadcastLobby();
    } else if (m.t === 'lobby_ready') {
      var lp = G.lobby ? G.lobby.players.find(function (p) { return p.connId === connId; }) : null;
      if (!lp) return;
      lp.ready = !!m.ready;
      broadcastLobby();
    } else if (m.t === 'lobby_kick') {
      if (!G.isHostLobby || !G.lobby) return;
      var targetSeat = parseInt(m.seat, 10);
      var lp2 = G.lobby.players.find(function (p) { return p.seat === targetSeat; });
      if (!lp2 || lp2.isHost) return;
      var tconn = lp2.connId;
      hostSend(tconn, { t: 'kicked_lobby' });
      G.lobby.players = G.lobby.players.filter(function (p) { return p.seat !== targetSeat; });
      if (G.hostConns[tconn]) delete G.hostConns[tconn];
      broadcastLobby();
    } else if (m.t === 'lobby_set_seats') {
      if (!G.isHostLobby || !G.lobby || G.lobby.started) return;
      // 通用房间：座位数范围 2~8（纯框架不按游戏硬编码，游戏可自行在开局时决定实际座位数）
      var lo = 2, hi = 8;
      var n = Math.min(Math.max(parseInt(m.count, 10) || lo, lo), hi);
      if (n < G.lobby.players.length) return;
      G.lobby.seats = n;
      broadcastLobby();
    } else if (m.t === 'lobby_set_pass') {
      if (!G.isHostLobby || !G.lobby || G.lobby.started) return;
      G.lobby.password = String(m.password || '');
      G.lobby.hasPassword = !!G.lobby.password;
      broadcastLobby();
    } else if (m.t === 'lobby_start') {
      if (!G.isHostLobby || !G.lobby || G.lobby.started) return;
      var allReady = G.lobby.players.every(function (p) { return p.isHost || p.ready; });
      if (!allReady) {
        toast('还有玩家未准备', '#f87171');
        return;
      }
      startGameFromLobby();
    } else if (m.t === 'chat') {
      var c2 = G.hostConns[connId];
      var name2 = c2 && c2.seat >= 0 && G.state ? G.state.players[c2.seat].name : (G.lobby ? (G.lobby.players.find(function (p) { return p.connId === connId; }) || {}).name : '访客');
      var text = String(m.text || '').slice(0, 100);
      broadcastHost({ t: 'chat', name: name2 || '访客', text: text });
      appendChat(name2 || '访客', text);
    } else if (m.t === 'emoji') {
      var c5 = G.hostConns[connId];
      if (!c5 || c5.seat < 0 || !G.state) return;
      var ep = G.state.players[c5.seat];
      if (!ep || !ep.alive) return;
      var toId = String(m.to || '');
      var emoji = String(m.emoji || '').slice(0, 4);
      if (!toId || !emoji) return;
      playEmojiFlight(ep.id, toId, emoji);
      broadcastHost({ t: 'emoji', from: ep.id, to: toId, emoji: emoji });
    }
  }

  function lobbyPublic() {
    return {
      code: G.lobby.code,
      name: G.lobby.name,
      version: APP_VERSION,
      ip: G.lobby.ip,
      ips: G.lobby.ips || [G.lobby.ip],
      port: G.lobby.port,
      hasPassword: G.lobby.hasPassword,
      seats: G.lobby.seats,
      gameId: G.lobby.gameId || defaultRoomGame(),
      started: G.lobby.started,
      players: G.lobby.players.map(function (p) {
        return { seat: p.seat, name: p.name, ready: p.ready, isHost: p.isHost };
      })
    };
  }

  function broadcastLobby() {
    if (!G.lobby) return;
    G.lobby.players.forEach(function (p) {
      if (!p.isHost) {
        hostSend(p.connId, { t: 'lobby_state', lobby: lobbyPublic(), isHost: false });
        if (p.connId && String(p.connId).indexOf('udp:') === 0) {
          setTimeout(function () { hostSend(p.connId, { t: 'lobby_state', lobby: lobbyPublic(), isHost: false }); }, 250);
          setTimeout(function () { hostSend(p.connId, { t: 'lobby_state', lobby: lobbyPublic(), isHost: false }); }, 500);
        }
      }
    });
    renderLobby();
  }

  function startGameFromLobby() {
    // 通用插件分发：由插件提供 startHost 钩子启动对应游戏联机
    var plug = window.GameFramework.get(G.lobby.gameId || '');
    if (plug && typeof plug.startHost === 'function') {
      plug.startHost();
      return;
    }
    // 无插件 startHost 的兜底
    toast('该游戏插件未提供联机开局能力', '#f87171');
  }

  function startHostRoom() {
    var myName = ($('lan-nickname').value.trim() || '房主').slice(0, 12);
    var roomName = ($('lan-roomname').value.trim() || '桌游房间').slice(0, 12);
    var password = $('lan-createpass').value.trim();
    localStorage.setItem('my-name', myName);
    var Cp = window.Capacitor;
    if (!Cp || !Cp.Plugins || !Cp.Plugins.GdpiHost) {
      toast('当前设备不支持创建房间');
      return;
    }
    var hostPort = G.roomPort || 3001;
    Cp.Plugins.GdpiHost.startHost({ port: hostPort }).then(function (res) {
      G.mode = 'host';
      G.hostMode = true;
      G.isHostLobby = true;
      G.hostIP = res.ip;
      G.hostPort = res.port || hostPort;
      G.hostCode = genRoomCode();
      G.hostConns = {};
      G.myPlayerId = null;
      G.state = null;
      G.selfReady = true;
      try {
        Cp.Plugins.GdpiHost.setRoomInfo({ code: G.hostCode, name: roomName });
      } catch (e) {}
      G.lobby = {
        code: G.hostCode,
        name: roomName,
        ip: res.ip,
        ips: (res.ips && res.ips.length) ? res.ips : [res.ip],
        port: G.hostPort,
        password: password,
        hasPassword: !!password,
        gameId: G.roomGameId || defaultRoomGame(),
        seats: 4,
        started: false,
        players: [{ seat: 0, connId: null, name: myName, ready: true, isHost: true }]
      };
      if (!G.hostListener) {
        G.hostListener = Cp.Plugins.GdpiHost.addListener('gdpiHostEvent', onHostEvent);
      }
      G.hostLastAction = {};
      showLobbyScreen();
      renderLobby();
    }).catch(function (e) {
      toast('本机房间启动失败：' + (e && e.message ? e.message : e));
    });
  }

  function showLobbyScreen() {
    ['screen-menu', 'screen-lan', 'screen-room', 'screen-settings'].forEach(function (id) {
      var el = $(id); if (el) el.classList.add('hidden');
    });
    $('screen-room').classList.remove('hidden');
    bindLobbyControls();
  }

  UI.openSeatsMenu = function () {
    var L = G.lobby;
    if (!L) return;
    // 通用房间：座位数范围 2~8（纯框架不按游戏硬编码）
    var items = '';
    var min = 2, max = 8;
    for (var n = min; n <= max; n++) {
      var disabled = n < L.players.length;
      items += '<button class="menu-func' + (n === L.seats ? ' seat-active' : '') + '" data-n="' + n + '"' + (disabled ? ' disabled' : '') + '>' +
        n + '人' + (disabled ? '（低于当前人数）' : '') + '</button>';
    }
    var m = modal({ title: '选择人数（' + min + '~' + max + '）', body: '<div class="menu-funcs">' + items + '</div>', buttons: [{ label: '取消' }] });
    setTimeout(function () {
      document.querySelectorAll('#modal-root .menu-func[data-n]').forEach(function (b) {
        b.addEventListener('click', function () {
          var v = parseInt(b.getAttribute('data-n'), 10);
          m.close();
          UI.lobbySetSeats(v);
        });
      });
    }, 50);
  };

  UI.lobbySetSeats = function (n) {
    var v = n || (G.lobby ? G.lobby.seats : 4);
    if (G.isHostLobby) {
      handleHostMsg(null, { t: 'lobby_set_seats', count: v });
    }
  };

  // 通用房间大厅：绑定基础控件（房间密码）。游戏专属配置由插件自行处理。
  function bindLobbyControls() {
    if (G.lobbyControlsBound) return;
    G.lobbyControlsBound = true;
    var passEl = $('room-pass');
    if (passEl) {
      passEl.addEventListener('change', function () {
        UI.lobbySetPass();
      });
    }
  }

  UI.showRoomList = function () {
    var Cp = window.Capacitor;
    if (!Cp || !Cp.Plugins || !Cp.Plugins.GdpiHost || !Cp.Plugins.GdpiHost.discoverRooms) {
      toast('当前设备不支持自动搜索', '#f87171');
      return;
    }
    toast('正在搜索局域网房间…');
    Cp.Plugins.GdpiHost.discoverRooms().then(function (res) {
      var rooms = res.rooms || [];
      if (rooms.length === 0) {
        toast('未发现局域网房间');
        return;
      }
      // 同一房间号不同 IP 去重：合并为一项，保留所有 IP 供顺序尝试
      var byCode = {};
      var order = [];
      rooms.forEach(function (r) {
        var code = String(r.code || '');
        if (!byCode[code]) {
          byCode[code] = { code: code, name: r.name || '房间', ips: [] };
          order.push(byCode[code]);
        }
        var ipStr = (r.ip || '') + ':' + (r.port || 3210);
        if (byCode[code].ips.indexOf(ipStr) < 0) byCode[code].ips.push(ipStr);
      });
      var items = order.map(function (grp) {
        return '<button class="menu-func room-list-item" data-code="' + escapeHtml(grp.code) + '" data-ips="' + escapeHtml(grp.ips.join(',')) + '">' +
          '<span class="mf-ico">' + icon('room', 19) + '</span>' + escapeHtml(grp.name) +
          ' <span style="color:#fbbf24;letter-spacing:2px;margin-left:8px">' + escapeHtml(grp.code || '-') + '</span>' +
          ' <span style="color:#94a3b8;font-size:11px">(' + grp.ips.length + ' 个IP)</span></button>';
      }).join('');
      var m = modal({ title: '局域网房间（' + order.length + '）', body: '<div class="menu-funcs">' + items + '</div>', buttons: [{ label: '取消' }] });
      setTimeout(function () {
        document.querySelectorAll('#modal-root .room-list-item').forEach(function (b) {
          b.addEventListener('click', function () {
            var code = b.getAttribute('data-code');
            var ips = (b.getAttribute('data-ips') || '').split(',').filter(Boolean);
            var pass = $('rj-joinpass') ? $('rj-joinpass').value.trim() : ($('lan-joinpass') ? $('lan-joinpass').value.trim() : '');
            m.close();
            // 按 IP 顺序依次尝试加入，直到成功
            tryJoinRoomByIps(ips, 0, code, pass);
          });
        });
      }, 50);
    }).catch(function (e) {
      toast(e && e.message ? e.message : '搜索失败', '#f87171');
    });
  };

  // 按 IP 顺序尝试加入，失败则尝试下一个
  function tryJoinRoomByIps(ips, idx, code, pass) {
    if (!ips || idx >= ips.length) {
      toast('所有IP均无法连接', '#f87171');
      return;
    }
    var host = ips[idx];
    // 记录密码用于重试
    G.retryJoin = { ips: ips, idx: idx, code: code, pass: pass };
    toast('尝试连接 ' + host + ' …');
    connectLan(host, code, pass);
    // connectLan 失败会走 udpFallback/关闭；这里通过 join_reject 后尝试下一个
    // 挂接：在 join_reject 处理里若仍有剩余 IP 则继续尝试
  }

  UI.lobbySetPass = function () {
    var pass = $('room-pass').value.trim();
    if (G.isHostLobby) {
      handleHostMsg(null, { t: 'lobby_set_pass', password: pass });
    }
  };

  UI.lobbyReady = function () {
    G.selfReady = !G.selfReady;
    var btn = $('btn-room-ready');
    if (btn) btn.textContent = G.selfReady ? '取消准备' : '准备';
    sendLan({ t: 'lobby_ready', ready: G.selfReady });
    setTimeout(function () {
      sendLan({ t: 'lobby_ready', ready: G.selfReady });
    }, 400);
    setTimeout(function () {
      sendLan({ t: 'lobby_ready', ready: G.selfReady });
    }, 900);
  };

  UI.roomStart = function () {
    if (G.isHostLobby) {
      handleHostMsg(null, { t: 'lobby_start' });
    }
  };

  // 房主在大厅读取存档作为开局状态（简化版：要求存档人数与房间座位匹配）
  UI.lobbyLoadSave = function () {
    var gameId = G.roomGameId || defaultRoomGame();
    var saves = listSaves(gameId);
    if (saves.length === 0) {
      toast('该游戏暂无存档');
      return;
    }
    var body = '<div class="history-list">' + saves.map(function (s) {
      return '<div class="save-item" data-slot="' + s.slot + '">' +
        '<div class="si-info"><div class="si-name">存档 ' + s.slot + '</div>' +
        '<div class="si-time">保存于 ' + formatSaveTime(s.savedAt) + '</div></div>' +
        '<div class="si-actions"><button class="mini-btn primary si-load" data-slot="' + s.slot + '">读取</button></div>' +
        '</div>';
    }).join('') + '</div>';
    var m = modal({ title: '读取存档开局', body: body, buttons: [{ label: '取消' }] });
    setTimeout(function () {
      document.querySelectorAll('#modal-root .si-load').forEach(function (b) {
        b.addEventListener('click', function () {
          var slot = parseInt(b.getAttribute('data-slot'), 10);
          var save = loadSave(gameId, slot);
          if (!save || !save.state) { toast('存档无效'); return; }
          var st = save.state;
          if (!st.players || st.players.length > (G.lobby ? G.lobby.seats : st.players.length)) {
            toast('存档人数与房间座位数不匹配', '#f87171');
            return;
          }
          // 用存档状态替换并广播
          G.state = st;
          G.lobby.started = true;
          G.myPlayerId = st.players[0].id;
          m.close();
          if (window.UI.__monoEnter) window.UI.__monoEnter();
          if (G.lobby && G.lobby.players) {
            G.lobby.players.forEach(function (p) {
              if (!p.isHost) {
                var target = st.players[p.seat];
                if (target) hostSend(p.connId, { t: 'game_started', state: st, events: [{ type: 'resumed' }], playerId: target.id });
              }
            });
          }
          broadcastHost({ t: 'state', state: st, events: [{ type: 'info', msg: '已从存档' + slot + '恢复游戏' }] });
          if (window.UI.__monoPumpHostAI) window.UI.__monoPumpHostAI();
        });
      });
    }, 50);
  };

  UI.leaveLobby = function () {
    if (G.isHostLobby) {
      UI.exitToMenu();
      return;
    }
    if (G.ws) {
      try { G.ws.onclose = null; G.ws.close(); } catch (e) {}
      G.ws = null;
    }
    G.lobby = null;
    G.mode = null;
    G.selfReady = false;
    UI.showMenu();
  };

  // 退出游戏确认：单人模式额外提供「保存并退出」
  UI.exitToMenu = function () {
    if (window.UI.__monoStopAuction) window.UI.__monoStopAuction();
    if (G.hostVoteTimer) {
      clearInterval(G.hostVoteTimer);
      G.hostVoteTimer = null;
    }
    if (G.hostConnTimer) {
      clearInterval(G.hostConnTimer);
      G.hostConnTimer = null;
    }
    if (G.heartbeatTimer) {
      clearInterval(G.heartbeatTimer);
      G.heartbeatTimer = null;
    }
    G.connLastSeen = null;
    G.seatIps = null;
    G.voteTarget = null;
    G.voteVotes = null;
    if (G.udpMode) {
      var Cp = window.Capacitor;
      if (Cp && Cp.Plugins && Cp.Plugins.GdpiHost && Cp.Plugins.GdpiHost.udpClose) {
        try { Cp.Plugins.GdpiHost.udpClose(); } catch (e) {}
      }
      G.udpMode = false;
    }
    if (G.ws) {
      try { G.ws.onclose = null; G.ws.close(); } catch (e) {}
      G.ws = null;
    }
    if (G.hostMode) {
      G.hostMode = false;
      G.hostConns = {};
      var Cp = window.Capacitor;
      if (Cp && Cp.Plugins && Cp.Plugins.GdpiHost) {
        try { Cp.Plugins.GdpiHost.stopHost(); } catch (e) {}
      }
    }
    G.state = null;
    G.lobby = null;
    G.isHostLobby = false;
    G.selfReady = false;
    G.mode = null;
    G.myPlayerId = null;
    G.animating = false;
    G.evQueue = [];
    // 隐藏所有已注册插件的屏幕（退出游戏时确保插件自建屏幕不残留）
    try {
      (window.GameFramework.list() || []).forEach(function (plg) {
        var ids = [];
        if (plg && plg.screenIds && plg.screenIds.length) ids = plg.screenIds;
        else if (plg && plg.screenId) ids = [plg.screenId];
        ids.forEach(function (sid) {
          var pel = $(sid);
          if (pel) pel.classList.add('hidden');
        });
        // 插件提供的显式屏幕隐藏钩子（可选）
        if (plg && typeof plg.hideScreen === 'function') {
          try { plg.hideScreen(); } catch (e) {}
        }
      });
    } catch (e) {}
    UI.showMenu();
  };

  function copyText(text, label) {
    var ok = function () { toast('已复制：' + (label || text), '#4ade80'); };
    var fail = function () { toast('复制失败，请手动记录', '#f87171'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok).catch(fail);
    } else {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        ok();
      } catch (e) {
        fail();
      }
    }
  }

  UI.toggleLog = function () {
    var box = $('log-box');
    if (box) box.classList.toggle('hidden');
  };

  function renderChatList() {
    var box = $('chat-messages');
    var modalBox = document.getElementById('chat-modal-msgs');
    var html = (G.chatLog || []).map(function (m) {
      return '<div><b style="color:#fbbf24">' + escapeHtml(m.name) + '：</b>' + escapeHtml(m.text) + '</div>';
    }).join('');
    if (box) {
      box.innerHTML = html;
      box.scrollTop = box.scrollHeight;
    }
    if (modalBox) {
      modalBox.innerHTML = html;
      modalBox.scrollTop = modalBox.scrollHeight;
    }
  }

  function appendChat(name, text) {
    G.chatLog = G.chatLog || [];
    G.chatLog.push({ name: name, text: text });
    if (G.chatLog.length > 100) G.chatLog.shift();
    renderChatList();
    if (G.state && G.state.log) {
      G.state.log.unshift({ round: G.state.round, text: '💬 ' + name + '：' + text });
      if (G.state.log.length > 500) G.state.log.pop();
      if (window.UI.__monoRenderLog) window.UI.__monoRenderLog();
    }
  }

  function sendChatText(text) {
    text = (text || '').trim().slice(0, 100);
    if (!text) return;
    if (G.mode === 'host') {
      var myName = localStorage.getItem('my-name') || '房主';
      appendChat(myName, text);
      broadcastHost({ t: 'chat', name: myName, text: text });
    } else {
      sendLan({ t: 'chat', text: text });
    }
  }

  UI.openChat = function () {
    if (G.mode !== 'lan' && G.mode !== 'host') {
      toast('仅联机模式支持聊天');
      return;
    }
    var body = '<div id="chat-modal-msgs" class="chat-messages" style="height:240px"></div>' +
      '<div class="chat-input-row"><input type="text" id="chat-modal-input" placeholder="输入消息…">' +
      '<button class="mini-btn primary" id="chat-modal-send">发送</button></div>';
    modal({ title: '聊天', body: body, buttons: [{ label: '关闭', cls: 'primary' }] });
    renderChatList();
    setTimeout(function () {
      var btn = document.getElementById('chat-modal-send');
      var inp = document.getElementById('chat-modal-input');
      if (btn && inp) {
        btn.addEventListener('click', function () {
          sendChatText(inp.value);
          inp.value = '';
        });
        inp.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            sendChatText(inp.value);
            inp.value = '';
          }
        });
      }
    }, 50);
  };

  UI.toggleChat = function () {
    UI.openChat();
  };

  UI.sendChat = function () {
    var inp = $('chat-input');
    if (!inp) return;
    var text = inp.value.trim();
    if (!text) return;
    sendChatText(text);
    inp.value = '';
  };

  UI.showHistory = function () {
    if (!G.state) return;
    var log = G.state.log || [];
    var body = '<div class="log-messages" style="max-height:420px;font-size:13px">' +
      log.map(function (l) {
        return '<div class="log-line"><b>[' + l.round + ']</b> ' + escapeHtml(l.text) + '</div>';
      }).join('') +
      (log.length === 0 ? '<p class="muted">暂无记录</p>' : '') + '</div>';
    modal({ title: '游戏历程（' + log.length + ' 条）', body: body, buttons: [{ label: '关闭' }] });
  };

  var vt = $('version-tag');
  if (vt && APP_VERSION) vt.textContent = 'v' + APP_VERSION;

  attachJoinMode();
  attachRoomJoinMode();
  applyTheme();
  var lightEl = $('set-light');
  if (lightEl) {
    lightEl.addEventListener('change', function () {
      UI.setLightMode(lightEl.checked);
    });
  }
  var acEl = $('set-acrylic');
  if (acEl) {
    acEl.addEventListener('change', function () {
      UI.setAcrylic(acEl.checked);
    });
  }
  var acRange = $('acrylic-opacity');
  if (acRange) {
    acRange.addEventListener('input', function () {
      UI.setAcrylicOpacity(acRange.value);
    });
  }
  // 设置页 · 日志栏：刷新 / 清空 / 复制 / 导出
  // 导出日志为文本（标准开发格式）
  function logsToText() {
    var all = loadLogs();
    var filter = window.__logFilter || '';
    var list = filter ? all.filter(function (lg) { return (lg.g || 'system') === filter; }) : all;
    var names = { poker: 'poker', sgs: 'sgs', doudizhu: 'doudizhu', monopoly: 'monopoly', system: 'system' };
    var lines = list.map(function (lg) {
      var lv = LOG_LEVEL_NAME[lg.l] || 'INFO';
      var src = lg.g ? (names[lg.g] || lg.g) : 'system';
      // 消息内已含 [模块]，来源标签仅用于筛选取向，导出时用模块统一
      return fmtLogTime(lg.t || '') + ' [' + lv + '] [' + src + '] ' + (lg.m || '');
    });
    lines.unshift('GameTool log v' + APP_VERSION + ' ' + new Date().toLocaleString() + (filter ? ' (filter: ' + (names[filter] || filter) + ')' : ''));
    lines.push('(' + list.length + ' entries)');
    return lines.join('\n');
  }
  function doCopyLog() {
    var text = logsToText();
    var done = function () { toast('日志已复制到剪贴板', '#4ade80'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }
  function fallbackCopy(text, done) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      if (done) done();
    } catch (e) {
      toast('复制失败，请使用导出文件', '#f87171');
    }
  }
  function doExportLog() {
    var text = logsToText();
    var ts = new Date();
    var fname = 'gametool-log-' + ts.getFullYear() + ('0' + (ts.getMonth() + 1)).slice(-2) + ('0' + ts.getDate()).slice(-2) + '-' + ('0' + ts.getHours()).slice(-2) + ('0' + ts.getMinutes()).slice(-2) + '.log';
    // 选择导出位置（预置公共目录 + 自定义文件名）
    var body =
      '<div class="form-row"><label>保存位置</label><button class="mini-btn select-btn" id="exp-loc-btn">应用文件</button></div>' +
      '<div class="form-row"><label>文件名</label><input type="text" id="exp-fname" value="' + fname + '"></div>' +
      '<div class="form-tip" id="exp-tip">应用文件最可靠（无需权限）；公共文档目录需存储权限</div>';
    var m = modal({ title: '导出日志', body: body, buttons: [{ label: '取消' }, { label: '导出', cls: 'primary', onClick: function () {
      var loc = (window.__expLoc) || 'app';
      var name = (($('exp-fname') || {}).value || fname).trim();
      m.close();
      doExportWrite(text, loc, name);
    } }] });
    var locs = { app: '应用文件', documents: '文档' };
    setTimeout(function () {
      var locBtn = $('exp-loc-btn');
      if (locBtn) locBtn.addEventListener('click', function () {
        var items = Object.keys(locs).map(function (k) {
          return '<button class="menu-func' + ((window.__expLoc || 'app') === k ? ' seat-active' : '') + '" data-v="' + k + '">' + locs[k] + '</button>';
        }).join('');
        var lm = modal({ title: '选择保存位置', body: '<div class="menu-funcs">' + items + '</div>', buttons: [{ label: '取消' }] });
        setTimeout(function () {
          document.querySelectorAll('#modal-root .menu-func[data-v]').forEach(function (b) {
            b.addEventListener('click', function () {
              window.__expLoc = b.getAttribute('data-v');
              lm.close();
              if (locBtn) locBtn.textContent = locs[window.__expLoc] || '下载';
            });
          });
        }, 50);
      });
    }, 50);
  }
  // 实际写入（Capacitor Filesystem 或浏览器回退）
  function doExportWrite(text, loc, fname) {
    var Cp = window.Capacitor;
    var FS = Cp && Cp.Plugins && Cp.Plugins.Filesystem;
    var dirMap = { documents: 'DOCUMENTS', app: 'DATA' };
    if (FS) {
      var dir = dirMap[loc] || 'DATA';
      // 文档（公共目录）导出到 GameTool_Log 子文件夹；recursive 自动创建，已存在不重复建
      var path = (dir === 'DOCUMENTS') ? 'GameTool_Log/' + fname : fname;
      // 公共目录需先获取存储权限，再写入
      var doWrite = function () {
        var options = { path: path, data: text, directory: dir, encoding: 'utf8', recursive: true };
        FS.writeFile(options).then(function () {
          FS.getUri({ path: path, directory: dir }).then(function (res) {
            toast('日志已导出：' + (res && res.uri ? res.uri : fname), '#4ade80');
          }).catch(function () { toast('日志已导出：' + fname, '#4ade80'); });
        }).catch(function (e) {
          toast('导出失败：' + (e && e.message ? e.message : e), '#f87171');
        });
      };
      var proceed = function () { doWrite(); };
      if (dir === 'DOCUMENTS') {
        if (typeof FS.requestPermissions === 'function') {
          FS.requestPermissions().then(function (st) {
            if (st && st.publicStorage === 'granted') {
              proceed();
            } else {
              toast('未获得存储权限，无法导出到公共目录', '#f87171');
            }
          }).catch(function (e) {
            toast('请求存储权限失败：' + (e && e.message ? e.message : e), '#f87171');
          });
        } else {
          proceed();
        }
      } else {
        proceed();
      }
      return;
    }
    // 浏览器回退：下载
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); document.body.removeChild(a); }, 300);
    toast('日志已导出为 ' + fname, '#4ade80');
  }
  // 「日志」二级菜单按钮 + 「筛选」按钮
  var logMenuBtn = $('log-menu-btn');
  if (logMenuBtn) logMenuBtn.addEventListener('click', function () { openLogMenu(); });
  var logFilterBtn = $('log-filter-btn');
  if (logFilterBtn) logFilterBtn.addEventListener('click', function () { openLogFilterMenu(); });
  addLog('系统启动 v' + APP_VERSION, 'ok');

  function handleBack() {
    var root = $('modal-root');
    var masks = root.querySelectorAll('.modal-mask');
    if (masks.length > 0) {
      var last = masks[masks.length - 1];
      if (last.dataset.dismissable !== 'false') {
        last.remove();
      }
      return;
    }
    // 通用插件返回：当前进行中的插件 → 调其 exit 钩子（注册 exit 即自动支持返回键）
    var fw = window.GameFramework;
    if (fw && typeof fw.findActiveGame === 'function') {
      var activePlugin = fw.findActiveGame();
      if (activePlugin && typeof activePlugin.exit === 'function') {
        try { activePlugin.exit(); } catch (e) { toast('返回失败', '#f87171'); }
        return;
      }
    }
    // 联机房间/游戏进行中状态 → 走通用退出流程
    if (G.state || G.lobby || G.hostMode) {
      if (window.UI.promptExitGame) window.UI.promptExitGame();
      return;
    }
    var menuVisible = !$('screen-menu').classList.contains('hidden');
    if (menuVisible) {
      modal({
        title: '退出应用',
        body: '<p>确定退出 桌游工具？</p>',
        buttons: [
          {
            label: '退出', cls: 'danger',
            onClick: function () {
              try {
                if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
                  window.Capacitor.Plugins.App.exitApp();
                }
              } catch (e) {}
            }
          },
          { label: '取消', cls: 'primary' }
        ]
      });
      return;
    }
    var lanVisible = !$('screen-lan').classList.contains('hidden');
    if (lanVisible) {
      var joinVisible = !$('lan-join').classList.contains('hidden');
      var createVisible = !$('lan-create').classList.contains('hidden');
      if (joinVisible || createVisible) {
        UI.showLanChoice();
      } else {
        UI.showMenu();
      }
      return;
    }
    // 游戏设置界面可见时返回主菜单（游戏插件自身的设置屏，非框架内置）
    UI.showMenu();
  }
  // 暴露返回处理，便于插件/真机排障（开发用）
  window.__handleBack = handleBack;

  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
    try {
      window.Capacitor.Plugins.App.addListener('backButton', handleBack);
    } catch (e) {}
  }

  // 初始化：主界面（screen-menu）默认显示时渲染游戏列表与时钟
  (function initHome() {
    try {
      cleanupMultiplayerSaves();
      restoreInstalledPlugins();
      var menu = $('screen-menu');
      if (menu && !menu.classList.contains('hidden')) {
        renderGameList();
        updateClock();
        UI.switchTab('games');
      }
    } catch (e) {}
  })();

  // ══════════════ 系统框架 · 全局容错隔离层 ══════════════
  // 游戏插件运行时的任何未捕获异常都不允许拖垮系统框架：
  // 捕获后安全复位到主菜单，清空游戏状态，保证导航/设置/列表始终可用。
  var lastErrTime = 0;
  // 错误来源归属：当前有活动游戏则归为对应游戏，否则为系统
  function errGame() {
    try {
      var fw = window.GameFramework;
      if (fw && typeof fw.findActiveGame === 'function') {
        var a = fw.findActiveGame();
        if (a && a.id) return a.id;
      }
    } catch (e) {}
    return undefined;
  }
  window.onerror = function (msg, src, line, col, err) {
    var now = Date.now();
    if (now - lastErrTime < 800) return true; // 防抖，避免连锁
    lastErrTime = now;
    var g = errGame();
    try { addLog('未捕获异常: ' + msg + ' (' + src + ':' + line + ')' + (err && err.stack ? ' :: ' + err.stack : ''), 'err', g); } catch (e) {}
    try {
      // 游戏插件异常时复位：若当前有活动插件，调用其 exit 复位；否则隐藏框架通用游戏屏
      var inGame = (g && g !== 'system') ||
        ($('screen-game') && !$('screen-game').classList.contains('hidden'));
      if (inGame) {
        // 复位游戏状态，避免残留影响下次进入
        G.state = null;
        G.room = null;
        G.mode = null;
        G.animating = false;
        G.evQueue = [];
        G.lobby = null;
        G.isHostLobby = false;
        var gameScreen = $('screen-game');
        if (gameScreen) gameScreen.classList.add('hidden');
        // 通用插件异常复位：调用其插件级 exit，避免残留状态
        if (g) {
          try {
            var p = window.GameFramework && window.GameFramework.get(g);
            if (p && typeof p.exit === 'function') p.exit();
          } catch (e2) {}
        }
        toast('游戏运行异常，已返回主菜单', '#f87171');
        UI.showMenu();
      }
    } catch (e2) {}
    return false; // 仍交给浏览器（若菜单也异常则提示）
  };
  // Promise 未处理拒绝（插件内异步异常）也记入日志并归属活动游戏
  window.addEventListener('unhandledrejection', function (ev) {
    var now = Date.now();
    if (now - lastErrTime < 800) return; // 与 onerror 共享防抖
    lastErrTime = now;
    var reason = ev && ev.reason;
    var msg = reason instanceof Error ? (reason.message + (reason.stack ? ' :: ' + reason.stack : '')) : String(reason);
    addLog('未处理的Promise拒绝: ' + msg, 'err', errGame());
  });
})();
