/**
 * 构建「纯静态版」页面（不需要任何服务器）
 *
 *   static/page-order.html   顾客点菜页：下单通过 MQTT 发布到公共中转
 *   static/admin-static.html 接单台：MQTT 订阅收单（已手写）
 *
 * 用法： node build-static.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'static');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

const log = [];
function must(cond, msg) { if (!cond) { console.error('✗ ' + msg); process.exit(1); } }

/* ============ 构建顾客点菜页 ============ */
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* 1. 注入 MQTT 客户端（放在业务脚本之前；幂等，重复构建不会重复注入） */
const mqttSrc = fs.readFileSync(path.join(ROOT, 'mqtt-client.js'), 'utf8');
if (html.includes('api = { Client: Client, utf8: utf8, utf8Decode: utf8Decode }')) {
  log.push('· 顾客页已含 MQTT 客户端，跳过注入');
} else {
  const scriptOpen = html.indexOf('<script>');
  must(scriptOpen > 0, '定位业务脚本');
  html = html.slice(0, scriptOpen) +
    '<script>' + mqttSrc + '</script>\n' +
    html.slice(scriptOpen);
  log.push('✓ 注入 MQTT 客户端');
}

/* 2. 下单方式：HTTP POST → MQTT 发布 */
const oldPost = `  /** 提交到接单后台；后台不可用时自动降级为本地下单，页面照常可用 */
  function postOrder(payload, cb) {
    var done = false;
    var finish = function (ok, data) {
      if (done) return;
      done = true;
      cb(ok, data);
    };
    // 3.5 秒超时保护，避免后台没开时页面卡住
    var timer = setTimeout(function () { finish(false, { local: true }); }, 3500);

    try {
      fetch(API_BASE + '/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (j) {
          clearTimeout(timer);
          finish(!!(j && j.ok), j || {});
        })
        .catch(function () { clearTimeout(timer); finish(false, { local: true }); });
    } catch (e) {
      clearTimeout(timer);
      finish(false, { local: true });
    }
  }`;
must(html.includes(oldPost), '定位 postOrder');

const newPost = `  /** 云端发布：把订单通过 MQTT 发到公共中转，店内接单台实时收到 */
  var MQTT_BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081/mqtt'
  ];
  var MQTT_NS = 'zishun/diancai/v1/';

  function postOrder(payload, cb) {
    var done = false;
    var finish = function (ok, data) {
      if (done) return;
      done = true;
      cb(ok, data);
    };
    // 10 秒超时（含建立连接时间）
    var timer = setTimeout(function () { finish(false, { local: true, reason: 'timeout' }); }, 10000);

    var topic = MQTT_NS + CHANNEL + '/orders';
    var body = JSON.stringify(payload);
    var bi = 0;

    function tryBroker() {
      if (bi >= MQTT_BROKERS.length) {
        clearTimeout(timer);
        return finish(false, { local: true, reason: 'all-brokers-failed' });
      }
      var url = MQTT_BROKERS[bi++];
      var cli;
      var settled = false;
      try {
        cli = new MQTTWS.Client({
          url: url,
          clientId: 'zishun-c-' + Math.random().toString(16).slice(2, 10),
          onOpen: function () {
            var ok = cli.publish(topic, body);
            settled = true;
            clearTimeout(timer);
            setTimeout(function () { try { cli.disconnect(); } catch (e) {} }, 300);
            finish(!!ok, { ok: !!ok, id: payload.id, broker: url });
          },
          onError: function () {
            if (settled) return;
            try { cli.disconnect(); } catch (e) {}
            tryBroker();
          }
        });
        cli.connect();
        // 单家 Broker 6 秒内没连上就换下一家
        setTimeout(function () {
          if (!settled) { try { cli.disconnect(); } catch (e) {} tryBroker(); }
        }, 6000);
      } catch (e) {
        tryBroker();
      }
    }
    tryBroker();
  }`;
html = html.replace(oldPost, newPost);
log.push('✓ 下单方式改为 MQTT 发布（3 个中转自动容错）');

/* 3. 顾客页不再需要服务端菜单接口 */
const oldApiGet = `  function apiGet(url) {
    return fetch(API_BASE + url).then(function (r) { return r.json(); });
  }

  apiGet('/api/menu').then(function (r) {
    if (!r || !r.ok || !Array.isArray(r.menu) || !r.menu.length) return;
    MENU = r.menu;
    renderMenu();
    restoreSteppers();
    renderCart();
  }).catch(function () { /* 静态打开时忽略，用内置菜单 */ });`;
must(html.includes(oldApiGet), '定位 apiGet 与菜单拉取');
html = html.replace(oldApiGet,
`  /* 静态版：菜单已内置在页面里，无需请求服务端 */`);
log.push('✓ 移除服务端菜单依赖（使用内置菜单）');

/* 4. 频道码：从 ?c= 读取 */
const oldCfg = "  var API_BASE = '';                               // 后台接口地址：空=当前域名；也可填 http://192.168.1.9:8080";
must(html.includes(oldCfg), '定位 API_BASE 配置块');
html = html.replace(oldCfg,
`  var API_BASE = '';                               // 静态版：不使用服务端
  /* 接单频道码：由接单台生成，写在顾客链接的 ?c= 后面。
     它是随机字符串，作用相当于「房间号」——只有知道它的接单台能收到这家店的订单。 */
  var CHANNEL = (function () {
    try {
      var q = new URLSearchParams(location.search);
      var c = (q.get('c') || q.get('channel') || '').trim();
      return c.replace(/[^0-9A-Za-z_-]/g, '').slice(0, 32) || 'DEFAULT';
    } catch (e) { return 'DEFAULT'; }
  })();`);
log.push('✓ 增加接单频道码读取');

/* 5. 提示文案调整 */
html = html.replace(
  "toast(ok ? '下单成功，后厨已接单' : '已提交（后台未连接，本地已记录）');",
  "toast(ok ? '下单成功，后厨已接单' : '已提交（网络不稳，已本地记录）');");
log.push('✓ 调整提示文案');

fs.writeFileSync(path.join(OUT, 'page-order.html'), html, 'utf8');
log.push('✓ static/page-order.html（' + Buffer.byteLength(html) + ' bytes）');

/* ============ 构建接单台（内联 MQTT 客户端，使其自包含） ============ */
let admin = fs.readFileSync(path.join(OUT, 'admin-static.html'), 'utf8');
const adminScriptTag = '<script src="mqtt-client.js"></script>';
if (admin.includes(adminScriptTag)) {
  admin = admin.replace(adminScriptTag, '<script>' + mqttSrc + '</script>');
  fs.writeFileSync(path.join(OUT, 'admin-static.html'), admin, 'utf8');
  log.push('✓ static/admin-static.html 内联 MQTT 客户端（' + Buffer.byteLength(admin) + ' bytes）');
} else if (admin.includes('api = { Client: Client, utf8: utf8, utf8Decode: utf8Decode }')) {
  log.push('· 接单台已含内联 MQTT 客户端，跳过');
} else {
  must(false, '接单台既无外部脚本引用也无内联客户端');
}

/* 6. 语法检查内嵌脚本 */
const { execFileSync } = require('child_process');
const tmp = path.join(OUT, '.syntax-check.js');
const scripts = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
let all = '';
scripts.forEach((s) => { all += s.replace(/^<script>/, '').replace(/<\/script>$/, '') + '\n;\n'; });
fs.writeFileSync(tmp, all, 'utf8');
try {
  execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
  log.push('✓ static/page-order.html 内嵌脚本语法通过');
} catch (e) {
  console.error('✗ 内嵌脚本语法错误:\n' + (e.stderr ? e.stderr.toString() : e.message));
  process.exit(1);
} finally {
  fs.unlinkSync(tmp);
}

console.log(log.join('\n'));
