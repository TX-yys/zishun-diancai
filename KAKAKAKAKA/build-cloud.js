/**
 * 构建脚本：把本地版页面改造成「Cloudflare 云端版」，并生成最终的 Worker 单文件。
 *
 *   cloud/page-order.html   顾客点菜页（纯静态，订单 POST 到同域 /api）
 *   cloud/page-admin.html   接单台（同域 /api，口令校验在服务端）
 *   cloud/worker.js         最终部署物：路由 + API + KV 存储 + 内联两个页面
 *
 * 用法： node build-cloud.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CLOUD = path.join(ROOT, 'cloud');
if (!fs.existsSync(CLOUD)) fs.mkdirSync(CLOUD);

const log = [];
function must(cond, msg) { if (!cond) { console.error('✗ ' + msg); process.exit(1); } }

/* ================================================================
   1. 顾客点菜页：把数据来源从「本地服务」改为「同域 /api」
   ================================================================ */
function buildOrderPage() {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  // 1) 接口基址留空（同域），并标注为云端版
  const oldCfg = "  var API_BASE = '';                               // 后台接口地址：空=当前域名；也可填 http://192.168.1.9:8080";
  must(html.includes(oldCfg), '定位 API_BASE 配置');
  html = html.replace(oldCfg,
    "  var API_BASE = '';                               // 云端版：与页面同域\n" +
    "  var CLOUD = true;                                // 云端版标记（订单存云端数据库）");

  // 2) 提交订单标题底部加「云端」提示（不改逻辑，只是标识）
  // 3) 云端条件下不写入 localStorage 的旧购物车（避免残留造成困惑）——保留即可，无副作用

  fs.writeFileSync(path.join(CLOUD, 'page-order.html'), html, 'utf8');
  log.push('✓ cloud/page-order.html（' + Buffer.byteLength(html) + ' bytes）');
}

/* ================================================================
   2. 接单台：同域 /api，口令通过 ?token= 传给服务端校验
   ================================================================ */
function buildAdminPage() {
  let html = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');

  // 现有实现已经是相对路径 /api/...，同域直接可用；
  // 只需把「实时同步」文案改成云端版，并让口令从 URL 读取（已有逻辑）。
  const oldLive = "$('liveText').textContent = ok ? ('实时同步中 · ' + new Date().toLocaleTimeString('zh-CN', { hour12: false })) : (txt || '已断开');";
  must(html.includes(oldLive), '定位 liveText 逻辑');
  html = html.replace(oldLive,
    "$('liveText').textContent = ok ? ('云端同步中 · ' + new Date().toLocaleTimeString('zh-CN', { hour12: false })) : (txt || '已断开');");

  fs.writeFileSync(path.join(CLOUD, 'page-admin.html'), html, 'utf8');
  log.push('✓ cloud/page-admin.html（' + Buffer.byteLength(html) + ' bytes）');
}

/* ================================================================
   3. 生成 Worker 单文件
   ================================================================ */
function escapeForTemplate(s) {
  // 放进 JS 模板字符串：转义反引号和 ${
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

/** 从 index.html 里抽出内置菜单，作为云端菜单的默认值 */
function extractMenu() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('var MENU = [');
  must(start > 0, '定位 MENU');
  const end = html.indexOf('\n  ];', start);
  must(end > start, '定位 MENU 结束');
  const arr = html.slice(start + 'var MENU = '.length, end + 4);
  // 该片段是合法 JS 数组字面量，直接内联
  return arr.replace(/;\s*$/, '');
}

function buildWorker() {
  const orderPage = fs.readFileSync(path.join(CLOUD, 'page-order.html'), 'utf8');
  const adminPage = fs.readFileSync(path.join(CLOUD, 'page-admin.html'), 'utf8');
  const qrSrc = fs.readFileSync(path.join(ROOT, 'qr.js'), 'utf8');
  const menuJs = extractMenu();

  const worker = `/**
 * 志顺小馆（小仝宝店）· 云端点菜 + 接单后端
 * Cloudflare Worker 单文件（由 build-cloud.js 自动生成，请勿手改）
 *
 * 路由：
 *   GET  /                顾客点菜页（任何网络可访问）
 *   GET  /admin           接单台（需 ?token= 口令）
 *   GET  /qr              扫码桌贴页
 *   GET  /api/menu        菜单
 *   POST /api/orders      顾客下单
 *   GET  /api/orders      取订单（需口令）
 *   PATCH /api/orders/:id 改状态/备注（需口令）
 *   DELETE /api/orders    清空已处理（需口令）
 *   GET  /api/health      健康检查
 *
 * 存储：KV 绑定名 ORDERS；密钥 ADMIN_TOKEN 为接单台口令
 */

const SHOP_NAME = '志顺小馆（小仝宝店）';
const MENU = ${menuJs};
const ORDER_PREFIX = 'order:';
const MAX_ORDERS = 500;

/* ---------------- 工具 ---------------- */
function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,X-Admin-Token',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS'
    }
  });
}
function html(body) {
  return new Response(body, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
function clean(s, max) {
  return String(s == null ? '' : s).replace(/[\\u0000-\\u001f]+/g, ' ').trim().slice(0, max || 200);
}
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function newId() {
  const d = new Date();
  const rnd = Math.floor(Math.random() * 900 + 100);
  return '' + d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) +
    pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + rnd;
}
function authed(url, req, env) {
  const need = env.ADMIN_TOKEN || '';
  if (!need) return true;
  const t = url.searchParams.get('token') || req.headers.get('X-Admin-Token') || '';
  return t === need;
}

/* ---------------- 订单存取（KV） ---------------- */
async function listOrders(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.ORDERS.list({ prefix: ORDER_PREFIX, cursor: cursor, limit: 1000 });
    for (const k of page.keys) {
      const raw = await env.ORDERS.get(k.name);
      if (raw) { try { out.push(JSON.parse(raw)); } catch (e) {} }
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return out;
}
async function putOrder(env, order) {
  await env.ORDERS.put(ORDER_PREFIX + order.id, JSON.stringify(order));
  // 控制总量：超出上限时删除最旧的已处理订单
  const all = await listOrders(env);
  if (all.length > MAX_ORDERS) {
    const done = all.filter((o) => o.status === 'done').sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const extra = all.length - MAX_ORDERS;
    for (let i = 0; i < Math.min(extra, done.length); i++) {
      await env.ORDERS.delete(ORDER_PREFIX + done[i].id);
    }
  }
}
async function getOrder(env, id) {
  const raw = await env.ORDERS.get(ORDER_PREFIX + id);
  return raw ? JSON.parse(raw) : null;
}

/* ---------------- 主入口 ---------------- */
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname.replace(/\\/+$/, '') || '/';
    const method = req.method.toUpperCase();

    if (method === 'OPTIONS') return json({ ok: true });

    /* ---------- 页面 ---------- */
    if (method === 'GET' && (p === '/' || p === '/index.html')) {
      return html(ORDER_PAGE);
    }
    if (method === 'GET' && (p === '/admin' || p === '/admin.html')) {
      if (!authed(url, req, env)) {
        return new Response('<meta charset="utf-8"><body style="font-family:sans-serif;padding:40px;text-align:center">' +
          '<h2>需要口令</h2><p style="color:#888">请在网址后加 <code>?token=你的口令</code> 再打开接单台</p></body>',
          { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
      return html(ADMIN_PAGE);
    }
    if (method === 'GET' && (p === '/qr' || p === '/qrcode')) {
      return html(qrPage(url.origin, env));
    }

    /* ---------- 菜单 ---------- */
    if (p === '/api/menu' && method === 'GET') {
      return json({ ok: true, shop: SHOP_NAME, menu: MENU });
    }

    /* ---------- 健康检查 ---------- */
    if (p === '/api/health' && method === 'GET') {
      const all = await listOrders(env);
      return json({
        ok: true, shop: SHOP_NAME, orders: all.length,
        pending: all.filter((o) => o.status !== 'done').length,
        time: new Date().toISOString()
      });
    }

    /* ---------- 下单 ---------- */
    if (p === '/api/orders' && method === 'POST') {
      let body;
      try { body = await req.json(); } catch (e) { return json({ ok: false, error: '请求体不合法' }, 400); }

      const items = Array.isArray(body.items) ? body.items.slice(0, 100).map((it) => ({
        n: clean(it && it.n, 40),
        p: Number(it && it.p) || 0,
        q: Math.max(1, Math.min(99, Number(it && it.q) || 1))
      })).filter((it) => it.n) : [];
      if (!items.length) return json({ ok: false, error: '订单没有菜品' }, 400);

      const now = new Date();
      const count = items.reduce((s, it) => s + it.q, 0);
      const order = {
        id: newId(),
        ts: now.getTime(),
        createdAt: now.toISOString(),
        date: now.getUTCFullYear() + '-' + pad2(now.getUTCMonth() + 1) + '-' + pad2(now.getUTCDate()),
        time: pad2(now.getUTCHours()) + ':' + pad2(now.getUTCMinutes()) + ':' + pad2(now.getUTCSeconds()),
        shop: SHOP_NAME,
        table: clean(body.table, 20) || '未填桌号',
        address: clean(body.address, 80),
        mode: clean(body.mode, 20) || '立即用餐',
        items: items,
        count: count,
        sub: Number(body.sub) || 0,
        pack: Number(body.pack) || 0,
        discount: Number(body.discount) || 0,
        total: Number(body.total) || 0,
        remark: clean(body.remark, 300),
        status: 'pending'
      };
      await putOrder(env, order);
      return json({ ok: true, id: order.id, count: count }, 201);
    }

    /* ---------- 取订单（需口令） ---------- */
    if (p === '/api/orders' && method === 'GET') {
      if (!authed(url, req, env)) return json({ ok: false, error: 'unauthorized' }, 401);
      const all = await listOrders(env);
      return json({
        ok: true, shop: SHOP_NAME, total: all.length,
        pending: all.filter((o) => o.status !== 'done').length,
        orders: all
      });
    }

    /* ---------- 改状态 / 备注（需口令） ---------- */
    if (p.indexOf('/api/orders/') === 0 && method === 'PATCH') {
      if (!authed(url, req, env)) return json({ ok: false, error: 'unauthorized' }, 401);
      const id = p.slice('/api/orders/'.length);
      const order = await getOrder(env, id);
      if (!order) return json({ ok: false, error: '订单不存在' }, 404);
      let body;
      try { body = await req.json(); } catch (e) { return json({ ok: false, error: 'bad' }, 400); }
      if (body.status && ['pending', 'cooking', 'done'].indexOf(body.status) >= 0) {
        order.status = body.status;
        order.statusAt = new Date().toISOString();
      }
      if (typeof body.remark === 'string') order.remark = clean(body.remark, 300);
      await env.ORDERS.put(ORDER_PREFIX + id, JSON.stringify(order));
      return json({ ok: true, order: order });
    }

    /* ---------- 清空已处理（需口令） ---------- */
    if (p === '/api/orders' && method === 'DELETE') {
      if (!authed(url, req, env)) return json({ ok: false, error: 'unauthorized' }, 401);
      const scope = url.searchParams.get('scope') || 'done';
      const all = await listOrders(env);
      const keep = scope === 'all' ? [] : all.filter((o) => o.status !== 'done');
      let removed = 0;
      for (const o of all) {
        if (!keep.some((k) => k.id === o.id)) { await env.ORDERS.delete(ORDER_PREFIX + o.id); removed++; }
      }
      return json({ ok: true, removed: removed, left: keep.length });
    }

    return json({ ok: false, error: 'not found' }, 404);
  }
};

/* ---------------- 二维码页（内联生成，无需外部服务） ---------------- */
function qrPage(origin, env) {
  const orderUrl = origin + '/';
  const adminUrl = origin + '/admin' + (env.ADMIN_TOKEN ? '?token=' + env.ADMIN_TOKEN : '');
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>扫码点菜 · ' + SHOP_NAME + '</title><style>' +
    'body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#F2F3F5;color:#222;padding:24px 18px;margin:0}' +
    '.hd{max-width:860px;margin:0 auto 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}' +
    '.hd h1{font-size:19px;margin:0}.hd .sub{font-size:12px;color:#999}.sp{flex:1}' +
    '.btn{height:36px;padding:0 16px;border-radius:18px;border:none;background:#FFD100;color:#5a4400;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}' +
    '.tip{max-width:860px;margin:0 auto 16px;background:#FFF8E1;border:1px solid #FFE9A8;border-radius:10px;padding:12px 15px;font-size:13px;color:#8a6a00;line-height:1.7}' +
    '.grid{max-width:860px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}' +
    '.card{background:#fff;border-radius:16px;padding:20px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.05)}' +
    '.card h2{font-size:16px;margin:0 0 4px}.card .role{display:inline-block;font-size:11px;border-radius:4px;padding:2px 8px;margin-bottom:12px}' +
    '.role.o{background:rgba(0,194,90,.12);color:#00A94E}.role.a{background:rgba(255,75,33,.12);color:#FF4B21}' +
    '.qrbox{width:100%;max-width:250px;margin:0 auto;aspect-ratio:1/1}.qrbox svg{display:block;width:100%;height:100%}' +
    '.url{margin-top:12px;font-size:13px;font-weight:600;word-break:break-all}' +
    '.foot{max-width:860px;margin:18px auto 0;font-size:12px;color:#999;line-height:1.8}' +
    '@media print{body{background:#fff;padding:0}.hd,.tip,.foot{display:none}.grid{display:block;max-width:none}' +
    '.card{page-break-after:always;box-shadow:none;border:2px dashed #ddd;margin:0;padding:40px 20px}.card:last-child{page-break-after:auto}.qrbox{max-width:420px}.url{font-size:20px}}' +
    '</style></head><body>' +
    '<div class="hd"><h1>📱 扫码点菜 · ' + SHOP_NAME + '</h1><span class="sub">' + origin.replace('https://', '') + '</span>' +
    '<span class="sp"></span><button class="btn" onclick="print()">🖨 打印桌贴</button></div>' +
    '<div class="tip"><b>这个链接是永久的公网地址：</b>顾客用手机流量、任何 WiFi 都能打开，不需要和店里连同一个网络。<br>' +
    '点「打印桌贴」后每张二维码单独占一页，裁下来贴在桌上即可。</div>' +
    '<div class="grid">' +
    '<div class="card"><h2>扫码点菜</h2><span class="role o">给顾客扫</span>' +
    '<div class="qrbox">' + qrSvg(orderUrl) + '</div><div class="url">' + orderUrl + '</div></div>' +
    '<div class="card"><h2>接单台</h2><span class="role a">仅店员使用</span>' +
    '<div class="qrbox">' + qrSvg(adminUrl) + '</div><div class="url">' + adminUrl.replace(/\\?token=.*/, '?token=***') + '</div></div>' +
    '</div>' +
    '<div class="foot">提示：接单台链接里带口令，请勿外贴。顾客点菜页不受影响，可以放心分享。</div>' +
    '</body></html>';
}

/* 内联二维码生成器（构建时注入，避免运行时依赖）
   注意：Worker 是 ES 模块，没有 window/self，因此这里把 UMD 包装换成直接赋值到本模块作用域变量 QR */
var QR = (function () {
${qrSrc
    .replace(/^\/\*\*[\s\S]*?\*\//, '')
    .replace(/\(function \(root, factory\) \{[\s\S]*?\}\)\(typeof self !== 'undefined' \? self : this, function \(\) \{/, '')
    .replace(/\}\);\s*$/, '')}
  return api;
})();

function qrSvg(text) { return QR.svg(text, { ec: 'M', quiet: 4 }); }

/* ---------------- 内联页面 ---------------- */
const ORDER_PAGE = \`${escapeForTemplate(orderPage)}\`;
const ADMIN_PAGE = \`${escapeForTemplate(adminPage)}\`;
`;

  fs.writeFileSync(path.join(CLOUD, 'worker.js'), worker, 'utf8');
  log.push('✓ cloud/worker.js（' + Buffer.byteLength(worker) + ' bytes）');
}

/* ================================================================
   执行
   ================================================================ */
buildOrderPage();
buildAdminPage();
buildWorker();

// 简单语法检查
const { execFileSync } = require('child_process');
try {
  execFileSync(process.execPath, ['--check', path.join(CLOUD, 'worker.js')], { stdio: 'pipe' });
  log.push('✓ cloud/worker.js 语法通过');
} catch (e) {
  console.error('✗ worker.js 语法错误:\n' + (e.stderr ? e.stderr.toString() : e.message));
  process.exit(1);
}

console.log(log.join('\n'));
