/**
 * 志顺小馆（小仝宝店）· 点菜 + 接单后台  服务端
 * 零依赖（只用 Node 内置模块）
 *
 * 页面：
 *   /            顾客点菜页
 *   /admin       店员接单后台
 * 接口：
 *   POST   /api/orders              顾客下单
 *   GET    /api/orders              后台取订单列表
 *   PATCH  /api/orders/:id          改状态 / 改备注
 *   DELETE /api/orders?scope=done   清空已处理订单
 *   GET    /api/menu                前台取菜单（data/menu.json 有内容时）
 *   GET    /api/health              健康检查
 *
 * 用法： node server.js [端口]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { URL } = require('url');

const ROOT = __dirname;
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const HOST = '0.0.0.0';

/**
 * 数据目录：
 *   本机运行时用 ./data；
 *   云平台（如 Render）可用环境变量 DATA_DIR 覆盖到挂载盘
 */
const DATA_DIR = process.env.DATA_DIR
  ? (path.isAbsolute(process.env.DATA_DIR) ? process.env.DATA_DIR : path.join(ROOT, process.env.DATA_DIR))
  : path.join(ROOT, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const MENU_FILE = path.join(DATA_DIR, 'menu.json');
const SHOP_NAME = '志顺小馆（小仝宝店）';
const MAX_ORDERS = 800;

/** 运行环境标识：云平台会给 PORT 环境变量 */
const IS_CLOUD = !!process.env.PORT || !!process.env.RENDER;

/** 店员口令：设置后后台才需要登录（默认空 = 谁都能看，方便内网试跑） */
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

/**
 * 桌号列表：用于「多桌二维码页」(/tables)，一桌一码。
 * 可用环境变量 TABLES 覆盖，逗号分隔，例如： TABLES=A01,A02,B01
 */
const TABLES = (process.env.TABLES
  ? process.env.TABLES.split(',')
  : ['A14', 'A15', 'A16', 'A17', 'B01', 'B02', 'B03', 'B04'])
  .map((s) => s.trim()).filter(Boolean);

/** HTML 转义 */
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 生成二维码 SVG（延迟加载 qr.js，避免模块顶部强依赖） */
let _qrMod = null;
function qrSvgNode(text) {
  if (!_qrMod) _qrMod = require(path.join(ROOT, 'qr.js'));
  return _qrMod.svg(text, { ec: 'M', quiet: 4 });
}

/** 扫码点菜页样式（服务端内联，保证单文件可打印） */
const QR_PAGE_CSS = [
  '*{margin:0;padding:0;box-sizing:border-box;}',
  'body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;background:#F2F3F5;color:#222;padding:22px 18px 60px;}',
  '.hd{max-width:1000px;margin:0 auto 18px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;}',
  '.hd h1{font-size:19px;font-weight:700;}',
  '.hd .sub{font-size:12px;color:#999;}',
  '.hd .sp{flex:1;}',
  '.btn{height:36px;padding:0 16px;border-radius:18px;border:none;background:#FFD100;color:#5a4400;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;}',
  '.btn.ghost{background:#fff;color:#666;border:1px solid #E5E5E5;}',
  '.tip{max-width:1000px;margin:0 auto 16px;background:#FFF8E1;border:1px solid #FFE9A8;border-radius:10px;padding:12px 15px;font-size:13px;color:#8a6a00;line-height:1.7;}',
  '.grid{max-width:1000px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;}',
  '.card{background:#fff;border-radius:16px;padding:20px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.05);}',
  '.card h2{font-size:16px;font-weight:700;margin-bottom:4px;}',
  '.card .role{display:inline-block;font-size:11px;border-radius:4px;padding:2px 8px;margin-bottom:14px;}',
  '.role.order{background:rgba(0,194,90,.12);color:#00A94E;}',
  '.role.admin{background:rgba(255,75,33,.12);color:#FF4B21;}',
  '.qrbox{width:100%;max-width:260px;margin:0 auto;aspect-ratio:1/1;background:#fff;border-radius:12px;padding:6px;}',
  '.qrbox svg{display:block;width:100%;height:100%;}',
  '.url{margin-top:12px;font-size:13px;font-weight:600;word-break:break-all;color:#222;}',
  '.net{font-size:11px;color:#999;margin-top:4px;}',
  '.empty{max-width:1000px;margin:0 auto;background:#fff;border-radius:14px;padding:34px;text-align:center;color:#999;font-size:14px;line-height:1.8;}',
  '.foot{max-width:1000px;margin:20px auto 0;font-size:12px;color:#999;line-height:1.8;}',
  '@media print{',
  '  body{background:#fff;padding:0;}',
  '  .hd,.tip,.foot{display:none;}',
  '  .grid{display:block;max-width:none;}',
  '  .card{page-break-after:always;box-shadow:none;border:2px dashed #ddd;margin-bottom:0;padding:40px 20px;}',
  '  .card:last-child{page-break-after:auto;}',
  '  .qrbox{max-width:420px;}',
  '  .url{font-size:20px;}',
  '  .net{font-size:14px;}',
  '}'
].join('\n');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

/* ---------------- 数据持久化 ---------------- */
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readOrders() {
  try {
    const raw = fs.readFileSync(ORDERS_FILE, 'utf8');
    const j = JSON.parse(raw);
    return Array.isArray(j.orders) ? j.orders : [];
  } catch (e) {
    return [];
  }
}

let saveQueue = Promise.resolve();
function writeOrders(orders) {
  ensureDir();
  const tmp = ORDERS_FILE + '.tmp';
  const body = JSON.stringify({ orders: orders.slice(0, MAX_ORDERS), savedAt: new Date().toISOString() }, null, 2);
  // 原子写：先写临时文件再改名，避免断电/并发写坏文件
  saveQueue = saveQueue.then(() => new Promise((resolve) => {
    fs.writeFile(tmp, body, 'utf8', (err) => {
      if (err) { console.error('写订单失败: ' + err.message); return resolve(); }
      fs.rename(tmp, ORDERS_FILE, () => resolve());
    });
  }));
  return saveQueue;
}

/* ---------------- 工具 ---------------- */
function sendJSON(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS'
  });
  res.end(body);
}

function sendFile(res, full, code) {
  fs.readFile(full, (err, data) => {
    if (err) return sendJSON(res, 404, { ok: false, error: 'not found' });
    const ext = path.extname(full).toLowerCase();
    res.writeHead(code || 200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > (limit || 256 * 1024)) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

function newOrderId() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) +
    crypto.randomInt(100, 999);
}

function clean(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max || 200);
}

/* ---------------- 路由 ---------------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(u.pathname);
  const method = req.method.toUpperCase();

  if (method === 'OPTIONS') return sendJSON(res, 204, {});

  /* ---- 顾客下单 ---- */
  if (pathname === '/api/orders' && method === 'POST') {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return sendJSON(res, 400, { ok: false, error: '请求体不合法' });
    }

    const items = Array.isArray(body.items) ? body.items.slice(0, 100).map((it) => ({
      n: clean(it && it.n, 40),
      p: Number(it && it.p) || 0,
      q: Math.max(1, Math.min(99, Number(it && it.q) || 1))
    })).filter((it) => it.n) : [];

    if (!items.length) return sendJSON(res, 400, { ok: false, error: '订单没有菜品' });

    const now = new Date();
    const p2 = (n) => (n < 10 ? '0' + n : '' + n);
    const count = items.reduce((s, it) => s + it.q, 0);
    const sub = items.reduce((s, it) => s + it.p * it.q, 0);

    const order = {
      id: newOrderId(),
      createdAt: now.toISOString(),
      date: now.getFullYear() + '-' + p2(now.getMonth() + 1) + '-' + p2(now.getDate()),
      time: p2(now.getHours()) + ':' + p2(now.getMinutes()) + ':' + p2(now.getSeconds()),
      shop: SHOP_NAME,
      table: clean(body.table, 20) || '未填桌号',
      address: clean(body.address, 80),
      mode: clean(body.mode, 20) || '立即用餐',
      items: items,
      count: count,
      sub: sub,
      pack: Number(body.pack) || 0,
      discount: Number(body.discount) || 0,
      total: Number(body.total) || 0,
      remark: clean(body.remark, 300),
      status: 'pending',           // pending 待处理 / cooking 制作中 / done 已完成
      ip: (req.socket.remoteAddress || '').replace('::ffff:', '')
    };

    const orders = readOrders();
    orders.unshift(order);
    await writeOrders(orders);

    console.log(`[新订单] #${order.id} 桌号:${order.table} ${order.count}件 备注:${order.remark || '无'}`);
    return sendJSON(res, 201, { ok: true, id: order.id, count: order.count });
  }

  /* ---- 后台：订单列表 ---- */
  if (pathname === '/api/orders' && method === 'GET') {
    if (!checkAdmin(u, req)) return sendJSON(res, 401, { ok: false, error: 'unauthorized' });
    const orders = readOrders();
    const pending = orders.filter((o) => o.status !== 'done').length;
    return sendJSON(res, 200, { ok: true, shop: SHOP_NAME, total: orders.length, pending: pending, orders: orders });
  }

  /* ---- 后台：改状态 / 改备注 ---- */
  if (pathname.indexOf('/api/orders/') === 0 && method === 'PATCH') {
    if (!checkAdmin(u, req)) return sendJSON(res, 401, { ok: false, error: 'unauthorized' });
    const id = pathname.slice('/api/orders/'.length);
    let body;
    try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { ok: false, error: 'bad' }); }

    const orders = readOrders();
    const idx = orders.findIndex((o) => o.id === id);
    if (idx < 0) return sendJSON(res, 404, { ok: false, error: '订单不存在' });

    if (body.status && ['pending', 'cooking', 'done'].indexOf(body.status) >= 0) {
      orders[idx].status = body.status;
      orders[idx].statusAt = new Date().toISOString();
      console.log(`[状态] #${id} -> ${body.status}`);
    }
    if (typeof body.remark === 'string') orders[idx].remark = clean(body.remark, 300);
    await writeOrders(orders);
    return sendJSON(res, 200, { ok: true, order: orders[idx] });
  }

  /* ---- 后台：清空已处理 ---- */
  if (pathname === '/api/orders' && method === 'DELETE') {
    if (!checkAdmin(u, req)) return sendJSON(res, 401, { ok: false, error: 'unauthorized' });
    const scope = u.searchParams.get('scope') || 'done';
    let orders = readOrders();
    const before = orders.length;
    orders = scope === 'all' ? [] : orders.filter((o) => o.status !== 'done');
    await writeOrders(orders);
    console.log(`[清理] ${scope} 删除 ${before - orders.length} 条`);
    return sendJSON(res, 200, { ok: true, removed: before - orders.length, left: orders.length });
  }

  /* ---- 菜单下发 ---- */
  if (pathname === '/api/menu' && method === 'GET') {
    try {
      const j = JSON.parse(fs.readFileSync(MENU_FILE, 'utf8'));
      if (Array.isArray(j.menu) && j.menu.length) {
        return sendJSON(res, 200, { ok: true, shop: j.shop || SHOP_NAME, menu: j.menu });
      }
    } catch (e) { /* 无自定义菜单 */ }
    return sendJSON(res, 200, { ok: true, shop: SHOP_NAME, menu: [] });
  }

  if (pathname === '/api/health') {
    const orders = readOrders();
    return sendJSON(res, 200, {
      ok: true, shop: SHOP_NAME,
      orders: orders.length,
      pending: orders.filter((o) => o.status !== 'done').length,
      time: new Date().toISOString()
    });
  }

  /* ---- 地址清单（供二维码页使用） ---- */
  if (pathname === '/api/addresses' && method === 'GET') {
    return sendJSON(res, 200, {
      ok: true, shop: SHOP_NAME, port: PORT, token: ADMIN_TOKEN,
      addresses: listAddresses()
    });
  }

  /* ---- 多桌二维码页（一桌一码，贴在对应桌上） ---- */
  if (pathname === '/tables' || pathname === '/tables/') {
    // 用访问者实际使用的地址（Host 头）生成二维码，保证手机扫了能打开
    const host = req.headers.host || ((listAddresses()[0] || {}).ip + ':' + PORT);
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const base = proto + '://' + host + '/';
    const tables = TABLES.slice(0, 200);
    const cards = tables.map((t) => {
      const url = base + '?t=' + encodeURIComponent(t);
      return '<div class="card"><h2>' + escHtml(t) + ' 号桌</h2>' +
        '<span class="role o">扫码点菜</span>' +
        '<div class="qrbox">' + qrSvgNode(url) + '</div>' +
        '<div class="url">' + escHtml(url) + '</div></div>';
    }).join('');
    const page = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>桌贴二维码 · ' + SHOP_NAME + '</title>' +
      '<style>' + QR_PAGE_CSS + '</style></head><body>' +
      '<div class="hd"><h1>📋 桌贴二维码 · ' + SHOP_NAME + '</h1>' +
      '<span class="sub">共 ' + tables.length + ' 张桌 · ' + escHtml(base) + '</span>' +
      '<span class="sp"></span><button class="btn" onclick="print()">🖨 打印全部桌贴</button></div>' +
      '<div class="tip"><b>用法：</b>点「打印全部桌贴」，每张桌的二维码单独占一页，' +
      '裁下来贴到对应桌号上。顾客扫码后点菜页会自动带上该桌桌号，订单里直接显示是哪桌。</div>' +
      '<div class="grid">' + cards + '</div>' +
      '<div class="foot">桌号来自服务端配置（环境变量 <code>TABLES</code>，逗号分隔）。当前：' +
      escHtml(TABLES.join('、')) + '</div>' +
      '</body></html>';
    const buf = Buffer.from(page, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
    return res.end(buf);
  }

  /* ---- 扫码点菜二维码页 ---- */
  if (pathname === '/qr' || pathname === '/qr/' || pathname === '/qrcode') {
    let qrSrc;
    try {
      qrSrc = fs.readFileSync(path.join(ROOT, 'qr.js'), 'utf8');
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<meta charset="utf-8"><body style="font-family:sans-serif;padding:40px">缺少 qr.js 文件</body>');
    }
    let pageSrc;
    try {
      pageSrc = fs.readFileSync(path.join(ROOT, 'qr-page.js'), 'utf8');
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<meta charset="utf-8"><body style="font-family:sans-serif;padding:40px">缺少 qr-page.js 文件</body>');
    }
    const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>扫码点菜 · ' + SHOP_NAME + '</title>' +
      '<style>' + QR_PAGE_CSS + '</style></head><body>' +
      '<div id="qrRoot"></div>' +
      '<script>' + qrSrc + '</script>' +
      '<script>' + pageSrc + '</script>' +
      '</body></html>';
    const buf = Buffer.from(html, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
    return res.end(buf);
  }

  /* ---- 静态页面 ---- */
  if (method !== 'GET') return sendJSON(res, 405, { ok: false, error: 'method not allowed' });

  if (pathname === '/' || pathname === '/index.html') return sendFile(res, path.join(ROOT, 'index.html'));
  if (pathname === '/admin' || pathname === '/admin/' || pathname === '/admin.html') {
    if (!checkAdmin(u, req, true)) {
      res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<meta charset="utf-8"><body style="font-family:sans-serif;padding:40px;text-align:center">' +
        '<h2>需要口令</h2><p style="color:#888">请在网址后加 <code>?token=你的口令</code> 再打开后台</p></body>');
    }
    return sendFile(res, path.join(ROOT, 'admin.html'));
  }
  if (pathname === '/favicon.ico') return sendFile(res, path.join(ROOT, 'favicon.ico'));

  return sendJSON(res, 404, { ok: false, error: 'not found' });
});

/** 口令校验：ADMIN_TOKEN 为空时不校验（内网试跑） */
function checkAdmin(u, req, pageMode) {
  if (!ADMIN_TOKEN) return true;
  const t = u.searchParams.get('token') ||
    (req.headers['x-admin-token'] || '');
  return t === ADMIN_TOKEN;
}

/** 虚拟网卡匹配（手机连不上这类地址） */
const VIRTUAL_RE = /vmware|virtualbox|vethernet|hyper-v|loopback|docker|wsl|tap|tun|zerotier|tailscale/i;

/** 列出本机可用局域网地址，真实网卡优先 */
function listAddresses() {
  const nets = os.networkInterfaces();
  const lan = [];
  Object.keys(nets).forEach((name) => {
    (nets[name] || []).forEach((n) => {
      if (n.family === 'IPv4' && !n.internal) lan.push({ ip: n.address, name: name });
    });
  });
  lan.sort((a, b) => {
    const av = VIRTUAL_RE.test(a.name) ? 1 : 0;
    const bv = VIRTUAL_RE.test(b.name) ? 1 : 0;
    if (av !== bv) return av - bv;
    const priv = /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01])\.)/;
    return (priv.test(a.ip) ? 0 : 1) - (priv.test(b.ip) ? 0 : 1);
  });
  return lan.map((x) => ({
    ip: x.ip, name: x.name,
    virtual: VIRTUAL_RE.test(x.name),
    order: 'http://' + x.ip + ':' + PORT + '/',
    admin: 'http://' + x.ip + ':' + PORT + '/admin' + (ADMIN_TOKEN ? '?token=' + ADMIN_TOKEN : '')
  }));
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log('端口 ' + PORT + ' 已被占用，换个端口：  node server.js 8081');
  } else {
    console.log('服务错误: ' + e.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  ensureDir();
  const lan = listAddresses();
  const real = lan.filter((x) => !x.virtual);
  const best = real.length ? real[0] : (lan[0] || { ip: '127.0.0.1', name: '本机' });
  const bar = '='.repeat(58);
  console.log(bar);
  console.log('  ' + SHOP_NAME + ' · 点菜 + 接单后台 已启动');
  console.log(bar);
  console.log('  顾客点菜 :  ' + best.order);
  console.log('  店员后台 :  ' + best.admin);
  console.log('  扫码点菜 :  http://' + best.ip + ':' + PORT + '/qr     ← 打开它按 Ctrl+P 打印桌贴');
  console.log('  本机打开 :  http://127.0.0.1:' + PORT + '/');
  if (lan.length) {
    console.log('');
    console.log('  全部可用地址（手机请用 WLAN 那条）：');
    lan.forEach((x) => {
      console.log('    ' + x.order + '   [' + x.name + ' · ' + (x.virtual ? '虚拟网卡，手机连不上' : '可扫码点菜') + ']');
    });
  }
  console.log('');
  console.log('  订单文件 :  data/orders.json');
  console.log(bar);
  console.log(ADMIN_TOKEN ? '  后台口令 : 已开启' : '  后台口令 : 未设置（内网试跑模式，谁都能看）');
  console.log('  手机与电脑连同一 WiFi，即可用上面的地址点菜 / 接单');
  console.log('  Ctrl + C 停止');
  console.log(bar);
});
