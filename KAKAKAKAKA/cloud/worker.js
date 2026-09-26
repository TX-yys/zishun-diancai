/**
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
const MENU = [
    {
      name: '招牌热卖', icon: '🔥',
      dishes: [
        { n: '酸菜鱼（黑鱼）', d: '现杀黑鱼片，老坛酸菜，酸辣鲜香', p: 0, e: '🐟', bg: '#FFE9C7', tag: 'hot', sale: '点单免费' },
        { n: '麻婆豆腐', d: '牛肉末配嫩豆腐，麻辣烫口下饭首选', p: 0, e: '🍲', bg: '#FFD9CC', tag: 'hot', sale: '点单免费' },
        { n: '宫保鸡丁', d: '花生脆爽，鸡丁嫩滑，糊辣荔枝口', p: 0, e: '🍗', bg: '#FFE1B8', tag: 'rec', sale: '点单免费' },
        { n: '水煮牛肉', d: '厚切黄牛肉，麻辣鲜香，油亮不腻', p: 0, e: '🥩', bg: '#F6C9B4', tag: 'hot', sale: '点单免费' }
      ]
    },
    {
      name: '店长推荐', icon: '👍',
      dishes: [
        { n: '蒜蓉粉丝蒸扇贝', d: '6 只装，蒜香浓郁，粉丝吸汁', p: 0, e: '🦪', bg: '#DCEFFF', tag: 'rec', sale: '点单免费' },
        { n: '铁板黑椒牛柳', d: '现煎牛柳，黑椒汁滋滋作响', p: 0, e: '🍖', bg: '#E8D5C4', tag: 'rec', sale: '点单免费' },
        { n: '干锅有机花菜', d: '腊肉同炒，锅气十足', p: 0, e: '🥦', bg: '#DFF3D8', tag: 'rec', sale: '点单免费' }
      ]
    },
    {
      name: '经典热菜', icon: '🍳',
      dishes: [
        { n: '回锅肉', d: '二刀肉配蒜苗，郫县豆瓣香', p: 0, e: '🥓', bg: '#FFE0CC', sale: '点单免费' },
        { n: '鱼香肉丝', d: '酸甜微辣，配米饭绝佳', p: 0, e: '🥕', bg: '#FFE7C2', sale: '点单免费' },
        { n: '辣子鸡', d: '干煸酥脆，越嚼越香', p: 0, e: '🌶️', bg: '#FFCFC2', tag: 'hot', sale: '点单免费' },
        { n: '糖醋里脊', d: '外酥里嫩，酸甜开胃', p: 0, e: '🍤', bg: '#FFDCD1', sale: '点单免费' },
        { n: '红烧肉', d: '五花三层，入口即化', p: 0, e: '🍖', bg: '#F3D2B3', sale: '点单免费' },
        { n: '干煸四季豆', d: '肉末煸香，豆角入味', p: 0, e: '🫛', bg: '#E2F0CE', sale: '点单免费' }
      ]
    },
    {
      name: '凉菜小食', icon: '🥗',
      dishes: [
        { n: '夫妻肺片', d: '红油鲜香，麻辣爽口', p: 0, e: '🥗', bg: '#FFD6D0', sale: '点单免费' },
        { n: '蒜泥白肉', d: '薄如纸片，蒜香浓郁', p: 0, e: '🥒', bg: '#E6F3D4', sale: '点单免费' },
        { n: '拍黄瓜', d: '现拍现拌，清爽解腻', p: 0, e: '🥒', bg: '#DDF0C8', sale: '点单免费' },
        { n: '皮蛋豆腐', d: '嫩豆腐配溏心皮蛋', p: 0, e: '🥚', bg: '#EFF3DA', sale: '点单免费' }
      ]
    },
    {
      name: '汤品主食', icon: '🍚',
      dishes: [
        { n: '番茄鸡蛋汤', d: '现熬番茄，酸甜暖胃', p: 0, e: '🍅', bg: '#FFDCD2', sale: '点单免费' },
        { n: '老鸭汤（半只）', d: '慢炖 3 小时，汤色奶白', p: 0, e: '🍲', bg: '#F0E1C8', tag: 'rec', sale: '点单免费' },
        { n: '米饭', d: '东北五常大米，小碗装', p: 0, e: '🍚', bg: '#F2F2EC', sale: '点单免费' },
        { n: '担担面', d: '芝麻酱香，麻辣鲜香', p: 0, e: '🍜', bg: '#FFE4C4', sale: '点单免费' },
        { n: '手工水饺（12只）', d: '猪肉白菜馅，现包现煮', p: 0, e: '🥟', bg: '#F4EEDF', sale: '点单免费' }
      ]
    },
    {
      name: '饮品酒水', icon: '🥤',
      dishes: [
        { n: '鲜榨橙汁', d: '4 个赣南脐橙现榨，无添加', p: 0, e: '🧃', bg: '#FFE3BC', tag: 'new', sale: '点单免费' },
        { n: '酸梅汤（扎）', d: '解辣神器，冰镇更爽', p: 0, e: '🥤', bg: '#F5D6D1', sale: '点单免费' },
        { n: '冰镇啤酒', d: '500ml 瓶装，冰柜直取', p: 0, e: '🍺', bg: '#FFF0C2', sale: '点单免费' },
        { n: '王老吉', d: '310ml 罐装', p: 0, e: '🥫', bg: '#FFD9D9', sale: '点单免费' },
        { n: '茉莉花茶', d: '一壶两杯，热饮免费续水', p: 0, e: '🍵', bg: '#E1F1DE', sale: '点单免费' }
      ]
    }
  ];
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
  return String(s == null ? '' : s).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max || 200);
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
    const p = url.pathname.replace(/\/+$/, '') || '/';
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
    '<div class="qrbox">' + qrSvg(adminUrl) + '</div><div class="url">' + adminUrl.replace(/\?token=.*/, '?token=***') + '</div></div>' +
    '</div>' +
    '<div class="foot">提示：接单台链接里带口令，请勿外贴。顾客点菜页不受影响，可以放心分享。</div>' +
    '</body></html>';
}

/* 内联二维码生成器（构建时注入，避免运行时依赖）
   注意：Worker 是 ES 模块，没有 window/self，因此这里把 UMD 包装换成直接赋值到本模块作用域变量 QR */
var QR = (function () {


  'use strict';

  /* ---------------- GF(256) ---------------- */
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function initGF() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function gmul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  /** RS 生成多项式，最高次项已去掉（首项恒为 1） */
  function rsGenPoly(deg) {
    var poly = [1];
    for (var i = 0; i < deg; i++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= gmul(poly[j], 1);
        next[j + 1] ^= gmul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly.slice(1);
  }

  /** 计算纠错码字 */
  function rsEncode(data, ecLen) {
    var gen = rsGenPoly(ecLen);
    var res = new Array(ecLen).fill(0);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ res[0];
      res.shift();
      res.push(0);
      if (factor !== 0) {
        for (var j = 0; j < ecLen; j++) res[j] ^= gmul(gen[j], factor);
      }
    }
    return res;
  }

  /* ---------------- 版本 / 容量表 ---------------- */
  // 格式信息里的纠错等级编码（写成 2 位：L=01 M=00 Q=11 H=10）
  var EC_BITS = { L: 1, M: 0, Q: 3, H: 2 };
  // 分块表 BLOCKS 的列下标顺序是 [L, M, Q, H]，与上面的编码值无关，必须分开映射
  var EC_COL = { L: 0, M: 1, Q: 2, H: 3 };
  // 校正图形中心坐标（ISO/IEC 18004 附录 E）
  var ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46],
    10: [6, 28, 50], 11: [6, 30, 54], 12: [6, 32, 58], 13: [6, 34, 62],
    14: [6, 26, 46, 66], 15: [6, 26, 48, 70], 16: [6, 26, 50, 74],
    17: [6, 30, 54, 78], 18: [6, 30, 56, 82], 19: [6, 30, 58, 86],
    20: [6, 34, 62, 90], 21: [6, 28, 50, 72, 94], 22: [6, 26, 50, 74, 98],
    23: [6, 30, 54, 78, 102], 24: [6, 28, 54, 80, 106], 25: [6, 32, 58, 84, 110],
    26: [6, 30, 58, 86, 114], 27: [6, 34, 62, 90, 118], 28: [6, 26, 50, 74, 98, 122],
    29: [6, 30, 54, 78, 102, 126], 30: [6, 26, 52, 78, 104, 130],
    31: [6, 30, 56, 82, 108, 134], 32: [6, 34, 60, 86, 112, 138],
    33: [6, 30, 58, 86, 114, 142], 34: [6, 34, 62, 90, 118, 146],
    35: [6, 30, 54, 78, 102, 126, 150], 36: [6, 24, 50, 76, 102, 128, 154],
    37: [6, 28, 54, 80, 106, 132, 158], 38: [6, 32, 58, 84, 110, 136, 162],
    39: [6, 26, 54, 82, 110, 138, 166], 40: [6, 30, 58, 86, 114, 142, 170]
  };
  // [每块总码字, 数据码字, 块数] × L/M/Q/H
  var BLOCKS = {
     1: [[26, 19, 1], [26, 16, 1], [26, 13, 1], [26, 9, 1]],
     2: [[44, 34, 1], [44, 28, 1], [44, 22, 1], [44, 16, 1]],
     3: [[70, 55, 1], [70, 44, 1], [70, 34, 2], [70, 26, 2]],
     4: [[100, 80, 1], [100, 64, 2], [100, 48, 2], [100, 36, 4]],
     5: [[134, 108, 1], [134, 86, 2], [66, 30, 2], [66, 22, 2]],
     6: [[172, 136, 2], [172, 108, 4], [172, 76, 4], [172, 60, 4]],
     7: [[196, 156, 2], [196, 124, 4], [64, 28, 2], [156, 52, 4]],
     8: [[242, 194, 2], [120, 76, 2], [160, 72, 4], [160, 56, 4]],
     9: [[292, 232, 2], [174, 108, 3], [144, 64, 4], [144, 48, 4]],
    10: [[172, 136, 2], [276, 172, 4], [258, 114, 6], [258, 90, 6]],
    11: [[404, 324, 4], [80, 50, 1], [200, 88, 4], [108, 36, 3]],
    12: [[232, 184, 2], [348, 216, 6], [184, 80, 4], [294, 98, 7]],
    13: [[532, 428, 4], [472, 296, 8], [352, 160, 8], [396, 132, 12]],
    14: [[435, 345, 3], [256, 160, 4], [396, 176, 11], [396, 132, 11]],
    15: [[545, 435, 5], [325, 205, 5], [270, 120, 5], [396, 132, 11]],
    16: [[610, 490, 5], [511, 315, 7], [645, 285, 15], [135, 45, 3]]
  };
  var MAXVER = 16;

  function totalCodewords(v) { return BLOCKS[v][0][0]; }

  /** 该版本纠错块数与数据码字总量（表里可能是简写，这里按标准展开计算） */
  function blockInfo(v, ec) {
    var row = BLOCKS[v][EC_COL[ec]];
    if (!row) throw new Error('未知纠错等级: ' + ec);
    var total = row[0], dataCw = row[1], groups = row[2];
    // 标准展开：数据码字在 groups 个块间尽量均分，
    // 多出的 (dataCw % groups) 个码字给「后面的块」，即短块在前、长块在后
    var shortLen = Math.floor(dataCw / groups);
    var numLong = dataCw % groups;
    var ecPerBlock = Math.floor((total - dataCw) / groups);
    return { total: total, dataCw: dataCw, groups: groups, shortLen: shortLen, numLong: numLong, ecPerBlock: ecPerBlock };
  }

  /** 第 g 个块的数据码字数（短块在前） */
  function blockDataLen(info, g) {
    return info.shortLen + (g >= info.groups - info.numLong ? 1 : 0);
  }

  /* ---------------- 位流 ---------------- */
  function BitBuffer() { this.bits = []; }
  BitBuffer.prototype.put = function (value, len) {
    for (var i = len - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
    return this;
  };

  function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var c2 = str.charCodeAt(i + 1);
        var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        i++;
      } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  function capBits(v, ec) { return blockInfo(v, ec).dataCw * 8; }

  function chooseVersion(byteLen, ec) {
    for (var v = 1; v <= MAXVER; v++) {
      var lenBits = v <= 9 ? 8 : 16;
      if (4 + lenBits + byteLen * 8 <= capBits(v, ec)) return v;
    }
    return -1;
  }

  /* ---------------- 矩阵 ---------------- */
  function makeMatrix(size) {
    var m = [];
    for (var i = 0; i < size; i++) m.push(new Array(size).fill(null));
    return m;
  }

  function placeFinder(m, r, c) {
    for (var i = -1; i <= 7; i++) {
      for (var j = -1; j <= 7; j++) {
        var rr = r + i, cc = c + j;
        if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
        var inRing = (i >= 0 && i <= 6 && (j === 0 || j === 6)) || (j >= 0 && j <= 6 && (i === 0 || i === 6));
        var inCore = i >= 2 && i <= 4 && j >= 2 && j <= 4;
        m[rr][cc] = (inRing || inCore) ? 1 : 0;
      }
    }
  }

  function placeAlignment(m, cy, cx) {
    for (var i = -2; i <= 2; i++) {
      for (var j = -2; j <= 2; j++) {
        var ring = Math.max(Math.abs(i), Math.abs(j));
        m[cy + i][cx + j] = (ring === 1) ? 0 : 1;
      }
    }
  }

  function maskFn(k, r, c) {
    switch (k) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return false;
    }
  }

  function formatBits(ec, mask) {
    var data = (EC_BITS[ec] << 3) | mask;
    var rem = data << 10;
    for (var i = 14; i >= 10; i--) {
      if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
    }
    return ((data << 10) | rem) ^ 0x5412;
  }

  function versionBits(v) {
    var rem = v << 12;
    for (var i = 17; i >= 12; i--) {
      if ((rem >>> i) & 1) rem ^= 0x1f25 << (i - 12);
    }
    return (v << 12) | rem;
  }

  function buildMatrix(version, ec, codewords) {
    var size = version * 4 + 17;
    var m = makeMatrix(size);
    var fn = makeMatrix(size); // 1=功能图形（不参与掩码）

    placeFinder(m, 0, 0);
    placeFinder(m, size - 7, 0);
    placeFinder(m, 0, size - 7);
    for (var i = 0; i < size; i++) {
      if (m[6][i] === null) m[6][i] = (i % 2 === 0) ? 1 : 0;
      if (m[i][6] === null) m[i][6] = (i % 2 === 0) ? 1 : 0;
    }
    var al = ALIGN[version] || [];
    for (var a = 0; a < al.length; a++) {
      for (var b = 0; b < al.length; b++) {
        var cy = al[a], cx = al[b];
        if (m[cy][cx] !== null) continue; // 与定位图形重叠则跳过
        placeAlignment(m, cy, cx);
      }
    }

    // 预留格式信息区（先占位，稍后写真实值）
    for (var k = 0; k <= 8; k++) {
      if (k !== 6) { m[8][k] = 0; m[k][8] = 0; }
    }
    m[8][8] = 0;
    var si = size - 1;
    for (var t = 0; t < 8; t++) { m[8][si - t] = 0; m[si - t][8] = 0; }
    m[size - 8][8] = 1; // 固定暗模块

    // 版本信息（版本 >= 7）
    if (version >= 7) {
      var vb = versionBits(version);
      /* 与格式信息同样的落位规则：18 位串的最高位先写。
         版面：右上角 3 列 x 6 行 与 左下角 6 行 x 3 列（互为转置）。 */
      for (var vi = 0; vi < 18; vi++) {
        var vbit = (vb >> vi) & 1;          // 权威实现为 LSB-first 落位，与之保持一致
        var rIdx = Math.floor(vi / 3), cIdx = vi % 3;
        m[rIdx][size - 11 + cIdx] = vbit;   // 右上
        m[size - 11 + cIdx][rIdx] = vbit;   // 左下（转置）
      }
    }

    // 记录功能模块
    for (var r0 = 0; r0 < size; r0++) {
      for (var c0 = 0; c0 < size; c0++) {
        if (m[r0][c0] !== null) fn[r0][c0] = 1;
      }
    }
    // 被上面赋 0 的格式区也是功能模块
    for (var d = 0; d <= 8; d++) {
      if (d !== 6) { fn[8][d] = 1; fn[d][8] = 1; }
    }
    fn[8][8] = 1;
    for (var e = 0; e < 8; e++) { fn[8][size - 1 - e] = 1; fn[size - 1 - e][8] = 1; }
    fn[size - 8][8] = 1;
    if (version >= 7) {
      for (var vf = 0; vf < 18; vf++) {
        fn[Math.floor(vf / 3)][vf % 3 + size - 11] = 1;
        fn[vf % 3 + size - 11][Math.floor(vf / 3)] = 1;
      }
    }

    // 数据位流
    var dataBits = [];
    for (var w = 0; w < codewords.length; w++) {
      for (var bi = 7; bi >= 0; bi--) dataBits.push((codewords[w] >> bi) & 1);
    }

    // 之字形填充（跳过第 6 列）
    var idx = 0;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col = 5;
      for (var t2 = 0; t2 < size; t2++) {
        for (var s = 0; s < 2; s++) {
          var cc2 = col - s;
          var up = ((col + 1) & 2) === 0;
          var rr2 = up ? size - 1 - t2 : t2;
          if (fn[rr2][cc2]) continue;
          m[rr2][cc2] = (idx < dataBits.length) ? dataBits[idx++] : 0;
        }
      }
    }

    /* ---- 掩码评估：8 种取惩罚分最低 ---- */
    var best = null, bestScore = Infinity;
    for (var mk = 0; mk < 8; mk++) {
      var trial = m.map(function (row) { return row.slice(); });
      for (var r1 = 0; r1 < size; r1++) {
        for (var c1 = 0; c1 < size; c1++) {
          if (!fn[r1][c1] && maskFn(mk, r1, c1)) trial[r1][c1] ^= 1;
        }
      }
      applyFormat(trial, size, ec, mk);
      var score = penalty(trial, size);
      if (score < bestScore) { bestScore = score; best = trial; }
    }
    return best;
  }

  function applyFormat(m, size, ec, mask) {
    var fmt = formatBits(ec, mask);

    /* 位序：格式值是 15 位串，最高位(bit14)落在第一个坐标上（标准为 MSB-first 落位）。
       坐标分配（标准）：
         副本1（15 位）: (8,0)(8,1)(8,2)(8,3)(8,4)(8,5) (8,7) (8,8) (7,8) (5,8)(4,8)(3,8)(2,8)(1,8)(0,8)
                         ^ 依次为 bit14 ... bit0
         副本2（7+7 位 + 1 固定暗模块）:
           (n-1,8)(n-2,8)...(n-7,8)  -> bit14..bit8
           (n-8,8)                   -> 固定暗模块，恒为 1（等价于该位置的固定值）
           (8,n-7)(8,n-6)...(8,n-1)  -> bit7..bit1
         副本2 与副本1 比特序列互为反转，由 7+1+7 的排布自然满足。 */
    var bit = function (i) { return (fmt >> (14 - i)) & 1; };

    // 副本 1（左上）
    for (var i = 0; i <= 5; i++) m[8][i] = bit(i);
    m[8][7] = bit(6);
    m[8][8] = bit(7);
    m[7][8] = bit(8);
    for (var j = 9; j <= 14; j++) m[14 - j][8] = bit(j);

    // 副本 2：垂直 7 位 (n-1..n-7, 8)
    for (var k = 0; k <= 6; k++) m[size - 1 - k][8] = bit(k);
    // 中间 (n-8, 8) 为固定暗模块
    m[size - 8][8] = 1;
    // 水平 7 位 (8, n-7..n-1)
    for (var l = 8; l <= 14; l++) m[8][size - 7 + (l - 8)] = bit(l);
  }
  /* ---------------- 掩码惩罚分 ----------------
     为了与主流实现（以及各类扫码器）选出同一个掩码，这里完全按
     qrcode-generator / qrcode.js 的 getLostPoint 规则实现：
       1) 3x3 邻域同色数 > 5 时累加 (3 + sameCount - 5)
       2) 2x2 同色块 +3
       3) 行/列出现 1:1:3:1:1 定位图形样式 +40
       4) 暗色比例偏离 50% 每 5% 计 +10                                        */
  function penalty(m, size) {
    var score = 0, i, j;

    // 规则1
    for (i = 0; i < size; i++) {
      for (j = 0; j < size; j++) {
        var sameCount = 0;
        var dark = m[i][j];
        for (var r = -1; r <= 1; r++) {
          if (i + r < 0 || i + r >= size) continue;
          for (var c = -1; c <= 1; c++) {
            if (j + c < 0 || j + c >= size) continue;
            if (r === 0 && c === 0) continue;
            if (dark === m[i + r][j + c]) sameCount++;
          }
        }
        if (sameCount > 5) score += 3 + sameCount - 5;
      }
    }

    // 规则2
    for (i = 0; i < size - 1; i++) {
      for (j = 0; j < size - 1; j++) {
        var count = 0;
        if (m[i][j]) count++;
        if (m[i + 1][j]) count++;
        if (m[i][j + 1]) count++;
        if (m[i + 1][j + 1]) count++;
        if (count === 0 || count === 4) score += 3;
      }
    }

    // 规则3：1:1:3:1:1 样式（水平与垂直，仅匹配 7 位，不要求两侧留白）
    var pat = [1, 0, 1, 1, 1, 0, 1];
    for (i = 0; i < size; i++) {
      for (j = 0; j < size - 6; j++) {
        var okRow = true, okCol = true;
        for (var q = 0; q < 7; q++) {
          if (m[i][j + q] !== pat[q]) { okRow = false; }
          if (m[j + q][i] !== pat[q]) { okCol = false; }
          if (!okRow && !okCol) break;
        }
        if (okRow) score += 40;
        if (okCol) score += 40;
      }
    }

    // 规则4：暗色比例
    var darkCount = 0;
    for (i = 0; i < size; i++) for (j = 0; j < size; j++) if (m[i][j]) darkCount++;
    var ratio = (darkCount * 100) / (size * size);
    score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
    return score;
  }

  /* ---------------- 主入口 ---------------- */
  function encode(text, ecLevel) {
    var ec = EC_BITS[ecLevel] !== undefined ? ecLevel : 'M';
    var bytes = utf8Bytes(String(text));
    var version = chooseVersion(bytes.length, ec);
    if (version < 0) throw new Error('内容过长，超出版本 ' + MAXVER + ' 容量');

    var info = blockInfo(version, ec);
    var bb = new BitBuffer();
    bb.put(4, 4);                                   // 字节模式
    bb.put(bytes.length, version <= 9 ? 8 : 16);    // 字符计数
    for (var i = 0; i < bytes.length; i++) bb.put(bytes[i], 8);

    var cap = info.dataCw * 8;
    var term = Math.min(4, cap - bb.bits.length);
    bb.put(0, term);
    while (bb.bits.length % 8 !== 0) bb.bits.push(0);

    var dataCw = [];
    for (var b = 0; b < bb.bits.length; b += 8) {
      var byteVal = 0;
      for (var k = 0; k < 8; k++) byteVal = (byteVal << 1) | bb.bits[b + k];
      dataCw.push(byteVal);
    }
    var pad = [0xec, 0x11], p = 0;
    while (dataCw.length < info.dataCw) dataCw.push(pad[p++ % 2]);

    // 分块 + RS 纠错
    var blocks = [];
    var offset = 0;
    for (var g = 0; g < info.groups; g++) {
      var len = info.shortLen + (g >= info.groups - info.numLong ? 1 : 0);
      var blk = dataCw.slice(offset, offset + len);
      offset += len;
      blocks.push({ data: blk, ec: rsEncode(blk, info.ecPerBlock) });
    }

    // 交织
    var out = [];
    var maxLen = Math.max.apply(null, blocks.map(function (x) { return x.data.length; }));
    for (var c = 0; c < maxLen; c++) {
      for (var b2 = 0; b2 < blocks.length; b2++) {
        if (c < blocks[b2].data.length) out.push(blocks[b2].data[c]);
      }
    }
    for (var c2 = 0; c2 < info.ecPerBlock; c2++) {
      for (var b3 = 0; b3 < blocks.length; b3++) out.push(blocks[b3].ec[c2]);
    }
    if (out.length < info.total) out.push(0); // 剩余位补零

    var matrix = buildMatrix(version, ec, out);
    return { matrix: matrix, size: matrix.length, version: version, ec: ec };
  }

  /** 生成 SVG 字符串（二维码） */
  function svg(text, opts) {
    opts = opts || {};
    var quiet = opts.quiet === undefined ? 2 : opts.quiet;
    var dark = opts.dark || '#111111';
    var light = opts.light || '#ffffff';
    var r = encode(text, opts.ec || 'M');
    var n = r.size, total = n + quiet * 2;
    var parts = [];
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        if (r.matrix[y][x]) parts.push('M' + (x + quiet) + ' ' + (y + quiet) + 'h1v1h-1z');
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '" ' +
      'shape-rendering="crispEdges" width="100%" height="100%" role="img" aria-label="二维码">' +
      '<rect width="' + total + '" height="' + total + '" fill="' + light + '"/>' +
      '<path fill="' + dark + '" d="' + parts.join('') + '"/></svg>';
  }

  return {
    encode: encode,
    svg: svg,
    utf8Bytes: utf8Bytes,
    // 供自检使用
    _internals: {
      EC_BITS: EC_BITS, EC_COL: EC_COL, BLOCKS: BLOCKS, ALIGN: ALIGN,
      blockInfo: blockInfo, chooseVersion: chooseVersion,
      buildMatrix: buildMatrix, rsEncode: rsEncode, capBits: capBits, penalty: penalty
    }
  };

  return api;
})();

function qrSvg(text) { return QR.svg(text, { ec: 'M', quiet: 4 }); }

/* ---------------- 内联页面 ---------------- */
const ORDER_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
<meta name="theme-color" content="#FFD100" />
<meta name="format-detection" content="telephone=no" />
<title>志顺小馆（小仝宝店）· 在线点菜</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='22' fill='%23FFD100'/%3E%3Ctext y='72' x='50' text-anchor='middle' font-size='58'%3E%F0%9F%8D%9C%3C/text%3E%3C/svg%3E" />
<style>
/* ===================================================================
   美团风格在线点菜 · 视觉规范
   品牌黄 #FFD100 / 价格红 #FF4B21 / 下单绿 #00C25A / 文字 #222 #666 #999
   =================================================================== */
:root{
  --brand:#FFD100;
  --brand-deep:#FFC300;
  --price:#FF4B21;
  --green:#00C25A;
  --green-d:#00A94E;
  --t1:#222222;
  --t2:#666666;
  --t3:#999999;
  --line:#F0F0F0;
  --bg:#F5F5F5;
  --radius:10px;
  --safe: env(safe-area-inset-bottom, 0px);
}
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
html,body{height:100%;}
body{
  font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  background:#E9E9E9;color:var(--t1);font-size:14px;line-height:1.4;
  overflow:hidden;
}
button{font-family:inherit;border:none;background:none;cursor:pointer;color:inherit;}
img{display:block;}
a{color:inherit;text-decoration:none;}
ul,ol{list-style:none;}

/* ---------------- 手机壳 / 自适应 ---------------- */
#app{
  position:relative;width:100%;max-width:420px;height:100%;max-height:100dvh;
  margin:0 auto;background:var(--bg);display:flex;flex-direction:column;
  overflow:hidden;box-shadow:0 0 0 1px rgba(0,0,0,.06);
}
#app::before{ /* 大屏时手机两侧留白修饰 */
  content:"";position:fixed;inset:0;z-index:-1;
  background:linear-gradient(160deg,#2b2b2b,#4a4a4a 60%,#1f1f1f);
}

/* ---------------- 顶部店家头图 ---------------- */
.shop{
  flex:none;position:relative;height:158px;background:#333;overflow:hidden;
}
.shop__cover{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:brightness(.72);}
.shop__mask{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.45),rgba(0,0,0,.15) 45%,rgba(0,0,0,.72));}
.shop__nav{
  position:absolute;top:0;left:0;right:0;height:46px;display:flex;align-items:center;
  justify-content:space-between;padding:0 12px;padding-top:env(safe-area-inset-top,0px);
  color:#fff;font-size:20px;
}
.shop__nav .navbtn{
  width:30px;height:30px;border-radius:50%;display:grid;place-items:center;
  background:rgba(0,0,0,.32);color:#fff;font-size:15px;line-height:1;
}
.shop__nav .navbtn--capsule{
  width:auto;height:30px;border-radius:15px;padding:0 12px;gap:6px;display:flex;
  align-items:center;font-size:12px;
}
.shop__nav .navbtn--capsule i{font-style:normal;font-size:13px;}
.shop__info{position:absolute;left:14px;right:14px;bottom:12px;color:#fff;}
.shop__name{display:flex;align-items:center;gap:6px;font-size:19px;font-weight:700;letter-spacing:.2px;}
.shop__name .badge-self{
  font-size:10px;font-weight:400;background:var(--brand);color:#7a5a00;
  border-radius:3px;padding:1px 4px;flex:none;
}
.shop__meta{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:11px;color:rgba(255,255,255,.92);}
.shop__stars{display:flex;gap:1px;color:var(--brand);letter-spacing:-1px;font-size:11px;}
.shop__meta .dot{width:1px;height:10px;background:rgba(255,255,255,.45);}
.shop__notice{
  display:flex;align-items:center;gap:6px;margin-top:7px;font-size:11px;
  color:rgba(255,255,255,.95);
}
.shop__notice .pill{
  background:rgba(255,75,33,.92);border-radius:4px;padding:1px 5px;font-size:10px;flex:none;
}
.shop__notice .txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

/* ---------------- 主体：左分类 + 右菜品 ---------------- */
.body{flex:1;display:flex;min-height:0;background:#fff;}

/* 左侧分类栏 */
.cate{
  flex:none;width:88px;background:#F7F7F7;overflow-y:auto;overscroll-behavior:contain;
  -webkit-overflow-scrolling:touch;
}
.cate::-webkit-scrollbar{display:none;}
.cate__item{
  position:relative;display:flex;flex-direction:column;justify-content:center;align-items:center;
  min-height:56px;padding:8px 6px;font-size:13px;color:var(--t2);line-height:1.25;text-align:center;
  transition:background .15s;
}
.cate__item .cate__ico{font-size:14px;margin-bottom:3px;filter:grayscale(1);opacity:.55;}
.cate__item .cate__num{
  position:absolute;top:5px;right:9px;min-width:15px;height:15px;line-height:15px;
  background:var(--price);color:#fff;font-size:10px;border-radius:8px;padding:0 4px;text-align:center;
  transform:scale(0);transition:transform .18s cubic-bezier(.3,1.5,.6,1);
}
.cate__item.show-num .cate__num{transform:scale(1);}
.cate__item.active{background:#fff;color:var(--t1);font-weight:700;}
.cate__item.active::before{
  content:"";position:absolute;left:0;top:50%;transform:translateY(-50%);
  width:3px;height:16px;background:var(--brand);border-radius:0 2px 2px 0;
}
.cate__item.active .cate__ico{filter:none;opacity:1;}

/* 右侧菜品列表 */
.dishes{flex:1;min-width:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;}
.dishes::-webkit-scrollbar{width:0;}
.group__title{
  position:sticky;top:0;z-index:3;background:#fff;padding:11px 12px 7px;
  display:flex;align-items:center;gap:6px;
}
.group__title h2{font-size:14px;font-weight:700;color:var(--t1);}
.group__title span{font-size:11px;color:var(--t3);font-weight:400;}

.dish{display:flex;gap:10px;padding:12px;border-bottom:1px solid var(--line);position:relative;}
.dish:last-child{border-bottom:none;}
.dish__pic{width:78px;height:78px;border-radius:8px;overflow:hidden;flex:none;background:#f2f2f2;}
.dish__pic img{width:100%;height:100%;object-fit:cover;}
.dish__main{flex:1;min-width:0;display:flex;flex-direction:column;}
.dish__name{
  font-size:15px;font-weight:600;color:var(--t1);line-height:1.3;
  display:flex;align-items:center;gap:4px;flex-wrap:wrap;
}
.tag{
  font-size:10px;font-weight:400;border-radius:3px;padding:0 3px;line-height:15px;flex:none;
}
.tag--hot{color:#FF4B21;border:1px solid rgba(255,75,33,.5);}
.tag--new{color:#0AA45F;border:1px solid rgba(10,164,95,.5);}
.tag--rec{color:#B8860B;background:rgba(255,209,0,.35);}
.dish__desc{
  font-size:11px;color:var(--t3);margin-top:4px;line-height:1.35;
  overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
}
.dish__sale{font-size:11px;color:var(--t3);margin-top:5px;}
.dish__bottom{margin-top:auto;display:flex;align-items:flex-end;justify-content:space-between;padding-top:8px;}
.price{color:var(--price);font-weight:700;display:flex;align-items:baseline;gap:1px;}
.price .cur{font-size:11px;font-weight:500;}
.price .num{font-size:19px;line-height:1;}
.price .unit{font-size:11px;color:var(--t3);font-weight:400;margin-left:2px;}
.price .old{font-size:11px;color:var(--t3);text-decoration:line-through;font-weight:400;margin-left:5px;}

/* 加减控件 */
.stepper{display:flex;align-items:center;gap:8px;flex:none;}
.stepper .btn{
  width:23px;height:23px;border-radius:50%;display:grid;place-items:center;
  font-size:17px;line-height:1;font-weight:300;transition:transform .12s;
}
.stepper .btn:active{transform:scale(.86);}
.btn-add{background:var(--green);color:#fff;box-shadow:0 1px 4px rgba(0,194,90,.4);}
.btn-sub{border:1px solid #DCDCDC;color:#888;background:#fff;}
.stepper .qty{font-size:14px;font-weight:600;min-width:16px;text-align:center;}
.stepper .qty.zero{display:none;}
.stepper.hide-sub .btn-sub,
.stepper.hide-sub .qty{visibility:hidden;width:0;margin:0;padding:0;overflow:hidden;}
.dish__thumb-add{
  position:absolute;right:12px;bottom:12px;width:23px;height:23px;border-radius:50%;
  background:var(--green);color:#fff;display:none;place-items:center;font-size:17px;font-weight:300;
}

/* 加购抛物线小球 */
.jump-ball{
  position:fixed;z-index:90;width:16px;height:16px;border-radius:50%;background:var(--green);
  box-shadow:0 2px 8px rgba(0,194,90,.55);pointer-events:none;
}

/* ---------------- 底部购物车条 ---------------- */
.cartbar{
  flex:none;position:relative;height:52px;background:#3C3C3C;display:flex;align-items:center;
  padding:0 0 0 74px;z-index:20;
}
.cartbar__icon{
  position:absolute;left:12px;bottom:8px;width:50px;height:50px;border-radius:50%;
  background:#3C3C3C;display:grid;place-items:center;font-size:24px;
  border:3px solid #3C3C3C;transition:background .2s;
}
.cartbar.has .cartbar__icon{background:var(--green);}
.cartbar__icon .ico{font-size:24px;line-height:1;transform:translateY(-1px);}
.cartbar__num{
  position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;line-height:18px;
  background:#FF3B30;color:#fff;font-size:11px;border-radius:9px;padding:0 4px;text-align:center;
  border:2px solid #3C3C3C;transform:scale(0);transition:transform .18s cubic-bezier(.3,1.6,.6,1);
}
.cartbar.has .cartbar__num{transform:scale(1);}
.cartbar__price{flex:1;min-width:0;color:#fff;}
.cartbar__price .now{font-size:17px;font-weight:700;}
.cartbar__price .now .cur{font-size:12px;}
.cartbar__price .tip{font-size:10px;color:#B4B4B4;margin-top:1px;}
.cartbar__price.empty .now{font-size:14px;color:#9C9C9C;font-weight:400;}
.cartbar__go{
  flex:none;height:52px;padding:0 26px;background:var(--green);color:#fff;font-size:16px;font-weight:600;
  display:grid;place-items:center;transition:background .2s;
}
.cartbar__go.disabled{background:#5A5A5A;color:#A8A8A8;font-weight:400;}
.cartbar__poke{animation:poke .45s;}
@keyframes poke{0%,100%{transform:scale(1)}30%{transform:scale(1.18)}60%{transform:scale(.94)}}

/* 购物车明细面板 */
.drawer-mask{
  position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:30;opacity:0;visibility:hidden;
  transition:opacity .25s,visibility .25s;
}
.drawer-mask.on{opacity:1;visibility:visible;}
.drawer{
  position:fixed;left:50%;transform:translate(-50%,110%);bottom:0;width:100%;max-width:420px;
  background:#fff;border-radius:14px 14px 0 0;z-index:31;overflow:hidden;
  transition:transform .28s cubic-bezier(.32,.72,0,1);max-height:68vh;display:flex;flex-direction:column;
  padding-bottom:52px;
}
.drawer.on{transform:translate(-50%,0);}
.drawer__hd{
  flex:none;display:flex;align-items:center;justify-content:space-between;
  padding:12px 14px;background:#F7F7F7;border-bottom:1px solid var(--line);
}
.drawer__hd h3{font-size:14px;font-weight:600;}
.drawer__hd button{font-size:12px;color:var(--t3);display:flex;align-items:center;gap:3px;}
.drawer__list{flex:1;overflow-y:auto;padding:4px 14px 8px;}
.citem{display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid var(--line);}
.citem:last-child{border-bottom:none;}
.citem__name{flex:1;min-width:0;font-size:14px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.citem__price{color:var(--price);font-weight:700;font-size:14px;min-width:52px;text-align:right;}
.citem__price .cur{font-size:10px;}

/* ---------------- 全屏页：确认订单 / 下单成功 ---------------- */
.page{
  position:absolute;inset:0;background:var(--bg);z-index:50;display:flex;flex-direction:column;
  transform:translateX(100%);transition:transform .3s cubic-bezier(.32,.72,0,1);
}
.page.on{transform:translateX(0);}
.page__hd{
  flex:none;height:48px;display:flex;align-items:center;justify-content:center;position:relative;
  background:#fff;border-bottom:1px solid var(--line);padding-top:env(safe-area-inset-top,0px);
  height:calc(48px + env(safe-area-inset-top,0px));
}
.page__hd h1{font-size:16px;font-weight:600;}
.page__hd .back{position:absolute;left:8px;bottom:8px;width:32px;height:32px;display:grid;place-items:center;font-size:19px;color:#333;}
.page__bd{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-bottom:12px;}

.card{background:#fff;border-radius:var(--radius);margin:10px 12px;overflow:hidden;}
.card__row{display:flex;align-items:flex-start;gap:10px;padding:13px 14px;font-size:14px;}
.card__row + .card__row{border-top:1px solid var(--line);}
.card__row .k{color:var(--t3);flex:none;width:64px;font-size:13px;}
.card__row .v{flex:1;min-width:0;}
.card__row .v.strong{font-weight:600;}
.card__row .arrow{color:#CCC;font-size:14px;flex:none;}

.addr{
  display:flex;align-items:center;gap:10px;padding:14px;background:#fff;border-radius:var(--radius);
  margin:10px 12px 0;
}
.addr .ico{font-size:17px;color:var(--price);flex:none;}
.addr .info{flex:1;min-width:0;}
.addr .info .l1{font-size:15px;font-weight:600;}
.addr .info .l2{font-size:12px;color:var(--t3);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.addr .edit{font-size:12px;color:var(--t3);flex:none;}

.shopline{display:flex;align-items:center;gap:8px;padding:13px 14px;font-size:14px;font-weight:600;background:#fff;border-radius:var(--radius);margin:10px 12px 0;}
.shopline .m{font-size:12px;color:var(--t3);font-weight:400;margin-left:auto;}

.olist{background:#fff;border-radius:var(--radius);margin:10px 12px 0;overflow:hidden;}
.olist__hd{padding:13px 14px 6px;font-size:13px;color:var(--t3);}
.oline{display:flex;align-items:center;gap:10px;padding:9px 14px;}
.oline__img{width:44px;height:44px;border-radius:6px;overflow:hidden;flex:none;background:#f2f2f2;}
.oline__img img{width:100%;height:100%;object-fit:cover;}
.oline__name{flex:1;min-width:0;font-size:14px;}
.oline__name small{display:block;color:var(--t3);font-size:11px;margin-top:2px;}
.oline__qty{color:var(--t3);font-size:13px;width:34px;text-align:right;}
.oline__price{color:var(--t1);font-weight:600;font-size:14px;width:62px;text-align:right;}
.olist__ft{border-top:1px solid var(--line);padding:10px 14px;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--t3);}
.olist__ft .addbtn{margin-left:auto;color:var(--price);font-size:12px;}

.sum{background:#fff;border-radius:var(--radius);margin:10px 12px;padding:12px 14px;font-size:13px;color:var(--t2);}
.sum__row{display:flex;justify-content:space-between;padding:5px 0;}
.sum__row.total{border-top:1px solid var(--line);margin-top:7px;padding-top:10px;color:var(--t1);font-weight:600;font-size:15px;}
.sum__row.total .p{color:var(--price);font-size:19px;font-weight:700;}
.sum__row.total .p .cur{font-size:12px;}
.sum__row .p-red{color:var(--price);}

.paybar{
  flex:none;display:flex;align-items:center;gap:12px;padding:8px 12px;
  padding-bottom:calc(8px + var(--safe));background:#fff;border-top:1px solid var(--line);
}
.paybar__total{flex:1;min-width:0;font-size:13px;color:var(--t2);}
.paybar__total strong{color:var(--price);font-size:21px;font-weight:700;}
.paybar__total strong .cur{font-size:13px;}
.paybar__btn{
  flex:none;height:44px;padding:0 34px;border-radius:22px;background:var(--green);color:#fff;
  font-size:16px;font-weight:600;display:grid;place-items:center;
}
.paybar__btn:active{background:var(--green-d);}
.paybar__btn.disabled{background:#CFCFCF;}

.remark{display:flex;align-items:center;gap:10px;padding:13px 14px;background:#fff;border-radius:var(--radius);margin:10px 12px;font-size:13px;color:var(--t3);}
.remark input{flex:1;border:none;outline:none;font-size:13px;color:var(--t1);}
.remark input::placeholder{color:#C4C4C4;}

.timeline{background:#fff;border-radius:var(--radius);margin:10px 12px;}
.tl__tabs{display:flex;border-bottom:1px solid var(--line);}
.tl__tabs button{flex:1;padding:12px 0;font-size:13px;color:var(--t2);position:relative;}
.tl__tabs button.on{color:var(--price);font-weight:600;}
.tl__tabs button.on::after{content:"";position:absolute;left:50%;bottom:0;transform:translateX(-50%);width:22px;height:2px;background:var(--price);border-radius:2px;}
.tl__body{padding:14px;font-size:13px;color:var(--t3);}

/* 下单成功页 */
.done{flex:1;display:flex;flex-direction:column;align-items:center;background:#fff;overflow-y:auto;padding-top:18px;}
.done__ico{
  width:66px;height:66px;border-radius:50%;background:var(--green);color:#fff;display:grid;place-items:center;
  font-size:34px;margin:18px 0 14px;animation:pop .45s cubic-bezier(.3,1.6,.6,1);
}
@keyframes pop{0%{transform:scale(.4);opacity:0}100%{transform:scale(1);opacity:1}}
.done h2{font-size:19px;font-weight:700;color:var(--t1);}
.done p{font-size:12px;color:var(--t3);margin-top:8px;text-align:center;line-height:1.6;padding:0 30px;}
.done__card{
  width:calc(100% - 24px);margin:16px 12px 0;background:#FAFAFA;border-radius:12px;padding:14px 16px;
  font-size:13px;color:var(--t2);
}
.done__card .r{display:flex;justify-content:space-between;padding:5px 0;}
.done__card .r b{color:var(--t1);font-weight:600;}
.done__btns{display:flex;gap:12px;width:100%;padding:22px 24px 30px;margin-top:auto;}
.done__btns button{
  flex:1;height:44px;border-radius:22px;font-size:15px;font-weight:600;
  border:1px solid var(--brand);color:#8a6a00;background:rgba(255,209,0,.16);
}
.done__btns button.primary{background:var(--brand);color:#5a4400;border-color:var(--brand);}

/* Toast */
.toast{
  position:fixed;left:50%;top:50%;transform:translate(-50%,-50%) scale(.9);z-index:99;
  background:rgba(0,0,0,.8);color:#fff;font-size:13px;padding:10px 18px;border-radius:8px;
  opacity:0;visibility:hidden;transition:opacity .2s,transform .2s;max-width:70%;text-align:center;
}
.toast.on{opacity:1;visibility:visible;transform:translate(-50%,-50%) scale(1);}

/* 免费价格 */
.price--free{color:var(--green-d);font-size:15px;font-weight:700;display:flex;align-items:baseline;gap:4px;}
.price--free .unit{color:var(--green-d);opacity:.75;font-size:11px;font-weight:400;}
.free-tag{color:var(--green-d);font-size:19px;font-weight:700;}
.sum__note{margin-top:9px;font-size:11px;color:var(--t3);background:#F7F7F7;border-radius:6px;padding:7px 9px;}

/* 备注行 / 备注弹层 */
.remark{align-items:center;cursor:pointer;}
.remark__k{color:var(--t3);flex:none;}
.remark__v{flex:1;min-width:0;color:#C4C4C4;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.remark__v.filled{color:var(--t1);}
.remark .arrow{color:#CCC;font-size:14px;flex:none;}
.rmk{color:#FF4B21 !important;}

.rmk-mask{
  position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:60;opacity:0;visibility:hidden;
  transition:opacity .25s,visibility .25s;
}
.rmk-mask.on{opacity:1;visibility:visible;}
.rmk-sheet{
  position:fixed;left:50%;bottom:0;width:100%;max-width:420px;z-index:61;background:#fff;
  border-radius:14px 14px 0 0;transform:translate(-50%,110%);
  transition:transform .3s cubic-bezier(.32,.72,0,1);display:flex;flex-direction:column;max-height:78vh;
}
.rmk-sheet.on{transform:translate(-50%,0);}
.rmk-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 10px;}
.rmk-hd h3{font-size:16px;font-weight:600;}
.rmk-hd .close{color:#BBB;font-size:20px;line-height:1;padding:0 2px;}
.rmk-bd{flex:1;overflow-y:auto;padding:0 16px 6px;}
.rmk-grp{margin-bottom:16px;}
.rmk-grp__t{font-size:13px;color:var(--t2);font-weight:600;margin-bottom:9px;}
.rmk-tags{display:flex;flex-wrap:wrap;gap:8px;}
.rmk-tag{
  font-size:13px;color:var(--t2);background:#F5F5F5;border:1px solid #F5F5F5;border-radius:14px;
  padding:6px 13px;transition:all .15s;
}
.rmk-tag.on{background:rgba(255,209,0,.22);border-color:var(--brand);color:#8a6a00;font-weight:600;}
.rmk-input{
  width:100%;border:1px solid #EAEAEA;border-radius:8px;padding:10px 11px;font-size:13px;
  font-family:inherit;color:var(--t1);outline:none;resize:none;height:62px;background:#FAFAFA;
}
.rmk-input:focus{border-color:var(--brand);background:#fff;}
.rmk-ft{display:flex;gap:12px;padding:10px 16px calc(14px + var(--safe));border-top:1px solid var(--line);}
.rmk-ft button{flex:1;height:44px;border-radius:22px;font-size:15px;font-weight:600;}
.rmk-ft .cancel{background:#F5F5F5;color:var(--t2);}
.rmk-ft .ok{background:var(--green);color:#fff;}
.rmk-ft .ok:active{background:var(--green-d);}

/* 空状态 */
.empty-cart{text-align:center;padding:34px 0;color:var(--t3);font-size:13px;}
.empty-cart .e{font-size:34px;display:block;margin-bottom:8px;opacity:.5;}

@media (min-width:480px){
  #app{height:calc(100dvh - 40px);margin:20px auto;border-radius:16px;}
  .drawer{bottom:20px;border-radius:16px 16px 16px 16px;max-height:60vh;}
}
</style>
</head>
<body>

<div id="app">
  <!-- ===================== 店家头图 ===================== -->
  <header class="shop">
    <img class="shop__cover" id="shopCover" alt="" />
    <div class="shop__mask"></div>
    <div class="shop__nav">
      <button class="navbtn" id="btnBack" aria-label="返回">&#8249;</button>
      <button class="navbtn navbtn--capsule" id="btnShare">&#8943;<i>分享</i></button>
    </div>
    <div class="shop__info">
      <div class="shop__name">
        <span>志顺小馆（小仝宝店）</span>
        <span class="badge-self">堂食点餐</span>
      </div>
      <div class="shop__meta">
        <span class="shop__stars">★★★★★</span>
        <span>5.0</span>
        <span class="dot"></span>
        <span>已服务 3268 桌</span>
        <span class="dot"></span>
        <span>本店菜品 0 元</span>
      </div>
      <div class="shop__notice">
        <span class="pill">公告</span>
        <span class="txt">志顺小馆（小仝宝店）菜品全部 0 元，点好后提交订单并填写备注，后厨即刻接单～</span>
      </div>
    </div>
  </header>

  <!-- ===================== 点菜主体 ===================== -->
  <div class="body">
    <nav class="cate" id="cateList"></nav>
    <main class="dishes" id="dishList"></main>
  </div>

  <!-- ===================== 底部购物车 ===================== -->
  <div class="cartbar" id="cartbar">
    <div class="cartbar__icon" id="cartIcon">
      <span class="ico">🛒</span>
      <span class="cartbar__num" id="cartNum">0</span>
    </div>
    <div class="cartbar__price empty" id="cartPrice">
      <div class="now"><span class="cur">¥</span><span id="cartTotal">0</span></div>
      <div class="tip" id="cartTip">未选购商品，请先点菜</div>
    </div>
    <button class="cartbar__go disabled" id="btnGo">去结算</button>
  </div>

  <!-- ===================== 购物车面板 ===================== -->
  <div class="drawer-mask" id="drawerMask"></div>
  <section class="drawer" id="drawer">
    <div class="drawer__hd">
      <h3>已点菜品（<span id="drawerCount">0</span>）</h3>
      <button id="btnClear">🗑 清空</button>
    </div>
    <div class="drawer__list" id="drawerList"></div>
  </section>

  <!-- ===================== 确认订单页 ===================== -->
  <section class="page" id="pageConfirm">
    <div class="page__hd">
      <button class="back" id="backConfirm">&#8249;</button>
      <h1>确认订单</h1>
    </div>
    <div class="page__bd">
      <div class="addr">
        <span class="ico">📍</span>
        <div class="info">
          <div class="l1">堂食 · A14 号桌</div>
          <div class="l2">天南海北路520仝宝广场-13分店</div>
        </div>
        <span class="edit">修改</span>
      </div>

      <div class="shopline">
        <span id="confirmShopName">志顺小馆（小仝宝店）</span>
        <span class="m">后厨接单</span>
      </div>

      <div class="olist" id="orderList"></div>

      <div class="timeline">
        <div class="tl__tabs" id="tlTabs">
          <button class="on" data-type="now">立即用餐</button>
          <button data-type="later">预约用餐</button>
        </div>
        <div class="tl__body" id="tlBody">后厨预计 12 分钟内开始制作，出餐后服务员会为您上菜。</div>
      </div>

      <div class="card">
        <div class="card__row">
          <span class="k">餐具</span>
          <span class="v">按用餐人数提供餐具</span>
          <span class="arrow">›</span>
        </div>
        <div class="card__row">
          <span class="k">优惠</span>
          <span class="v p-red">已享「满 1314 减 0」</span>
          <span class="arrow">›</span>
        </div>
        <div class="card__row">
          <span class="k">发票</span>
          <span class="v">本单不开发票</span>
          <span class="arrow">›</span>
        </div>
      </div>

      <div class="remark" id="remarkRow">
        <span class="remark__k">备注</span>
        <span class="remark__v" id="remarkShow">口味、忌口、上菜顺序等要求，点这里填写</span>
        <span class="arrow">›</span>
      </div>

      <div class="sum" id="sumBox"></div>
    </div>
    <div class="paybar">
      <div class="paybar__total" id="payBarTotal">合计 <strong><span class="cur">¥</span><span id="payTotal">0.00</span></strong></div>
      <button class="paybar__btn" id="btnPay">提交订单</button>
    </div>
  </section>

  <!-- ===================== 下单成功页 ===================== -->
  <section class="page" id="pageDone">
    <div class="page__hd">
      <h1>订单详情</h1>
    </div>
    <div class="done">
      <div class="done__ico">✓</div>
      <h2>下单成功</h2>
      <p>后厨已收到您的订单<br />菜品制作完成后将为您上菜，请稍候～</p>
      <div class="done__card" id="doneCard"></div>
      <div class="done__btns">
        <button id="btnAgain">再来一单</button>
        <button class="primary" id="btnFinish">完成</button>
      </div>
    </div>
  </section>

  <div class="toast" id="toast"></div>
</div>

<script>
(function () {
  'use strict';

  /* ================================================================
     1. 菜品数据（改这里就能换成你自己的店）
     ================================================================ */
  var MENU = [
    {
      name: '招牌热卖', icon: '🔥',
      dishes: [
        { n: '酸菜鱼（黑鱼）', d: '现杀黑鱼片，老坛酸菜，酸辣鲜香', p: 0, e: '🐟', bg: '#FFE9C7', tag: 'hot', sale: '点单免费' },
        { n: '麻婆豆腐', d: '牛肉末配嫩豆腐，麻辣烫口下饭首选', p: 0, e: '🍲', bg: '#FFD9CC', tag: 'hot', sale: '点单免费' },
        { n: '宫保鸡丁', d: '花生脆爽，鸡丁嫩滑，糊辣荔枝口', p: 0, e: '🍗', bg: '#FFE1B8', tag: 'rec', sale: '点单免费' },
        { n: '水煮牛肉', d: '厚切黄牛肉，麻辣鲜香，油亮不腻', p: 0, e: '🥩', bg: '#F6C9B4', tag: 'hot', sale: '点单免费' }
      ]
    },
    {
      name: '店长推荐', icon: '👍',
      dishes: [
        { n: '蒜蓉粉丝蒸扇贝', d: '6 只装，蒜香浓郁，粉丝吸汁', p: 0, e: '🦪', bg: '#DCEFFF', tag: 'rec', sale: '点单免费' },
        { n: '铁板黑椒牛柳', d: '现煎牛柳，黑椒汁滋滋作响', p: 0, e: '🍖', bg: '#E8D5C4', tag: 'rec', sale: '点单免费' },
        { n: '干锅有机花菜', d: '腊肉同炒，锅气十足', p: 0, e: '🥦', bg: '#DFF3D8', tag: 'rec', sale: '点单免费' }
      ]
    },
    {
      name: '经典热菜', icon: '🍳',
      dishes: [
        { n: '回锅肉', d: '二刀肉配蒜苗，郫县豆瓣香', p: 0, e: '🥓', bg: '#FFE0CC', sale: '点单免费' },
        { n: '鱼香肉丝', d: '酸甜微辣，配米饭绝佳', p: 0, e: '🥕', bg: '#FFE7C2', sale: '点单免费' },
        { n: '辣子鸡', d: '干煸酥脆，越嚼越香', p: 0, e: '🌶️', bg: '#FFCFC2', tag: 'hot', sale: '点单免费' },
        { n: '糖醋里脊', d: '外酥里嫩，酸甜开胃', p: 0, e: '🍤', bg: '#FFDCD1', sale: '点单免费' },
        { n: '红烧肉', d: '五花三层，入口即化', p: 0, e: '🍖', bg: '#F3D2B3', sale: '点单免费' },
        { n: '干煸四季豆', d: '肉末煸香，豆角入味', p: 0, e: '🫛', bg: '#E2F0CE', sale: '点单免费' }
      ]
    },
    {
      name: '凉菜小食', icon: '🥗',
      dishes: [
        { n: '夫妻肺片', d: '红油鲜香，麻辣爽口', p: 0, e: '🥗', bg: '#FFD6D0', sale: '点单免费' },
        { n: '蒜泥白肉', d: '薄如纸片，蒜香浓郁', p: 0, e: '🥒', bg: '#E6F3D4', sale: '点单免费' },
        { n: '拍黄瓜', d: '现拍现拌，清爽解腻', p: 0, e: '🥒', bg: '#DDF0C8', sale: '点单免费' },
        { n: '皮蛋豆腐', d: '嫩豆腐配溏心皮蛋', p: 0, e: '🥚', bg: '#EFF3DA', sale: '点单免费' }
      ]
    },
    {
      name: '汤品主食', icon: '🍚',
      dishes: [
        { n: '番茄鸡蛋汤', d: '现熬番茄，酸甜暖胃', p: 0, e: '🍅', bg: '#FFDCD2', sale: '点单免费' },
        { n: '老鸭汤（半只）', d: '慢炖 3 小时，汤色奶白', p: 0, e: '🍲', bg: '#F0E1C8', tag: 'rec', sale: '点单免费' },
        { n: '米饭', d: '东北五常大米，小碗装', p: 0, e: '🍚', bg: '#F2F2EC', sale: '点单免费' },
        { n: '担担面', d: '芝麻酱香，麻辣鲜香', p: 0, e: '🍜', bg: '#FFE4C4', sale: '点单免费' },
        { n: '手工水饺（12只）', d: '猪肉白菜馅，现包现煮', p: 0, e: '🥟', bg: '#F4EEDF', sale: '点单免费' }
      ]
    },
    {
      name: '饮品酒水', icon: '🥤',
      dishes: [
        { n: '鲜榨橙汁', d: '4 个赣南脐橙现榨，无添加', p: 0, e: '🧃', bg: '#FFE3BC', tag: 'new', sale: '点单免费' },
        { n: '酸梅汤（扎）', d: '解辣神器，冰镇更爽', p: 0, e: '🥤', bg: '#F5D6D1', sale: '点单免费' },
        { n: '冰镇啤酒', d: '500ml 瓶装，冰柜直取', p: 0, e: '🍺', bg: '#FFF0C2', sale: '点单免费' },
        { n: '王老吉', d: '310ml 罐装', p: 0, e: '🥫', bg: '#FFD9D9', sale: '点单免费' },
        { n: '茉莉花茶', d: '一壶两杯，热饮免费续水', p: 0, e: '🍵', bg: '#E1F1DE', sale: '点单免费' }
      ]
    }
  ];

  var PACK_FEE = 0;                                // 餐盒费（免费活动期间为 0）
  var DISCOUNT_RULE = { min: 1314, off: 0 };       // 满减规则：满 1314 减 0
  var API_BASE = '';                               // 云端版：与页面同域
  var CLOUD = true;                                // 云端版标记（订单存云端数据库）
  var SHOP_NAME = '志顺小馆（小仝宝店）';
  var TABLE_NO = 'A14';                            // 桌号（改这里，确认页/订单/成功页一起变）
  var ADDRESS = '天南海北路520仝宝广场-13分店';       // 门店地址

  /* ================================================================
     2. 工具函数
     ================================================================ */
  var $ = function (id) { return document.getElementById(id); };

  /** 生成菜品示意图（内联 SVG，不依赖任何外部图片） */
  function dishImg(emoji, bg) {
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">' +
        '<defs>' +
          '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0" stop-color="#ffffff" stop-opacity=".75"/>' +
            '<stop offset="1" stop-color="#ffffff" stop-opacity="0"/>' +
          '</linearGradient>' +
        '</defs>' +
        '<rect width="160" height="160" fill="' + bg + '"/>' +
        '<circle cx="80" cy="80" r="62" fill="url(#g)"/>' +
        '<circle cx="34" cy="132" r="30" fill="#ffffff" fill-opacity=".18"/>' +
        '<circle cx="132" cy="30" r="24" fill="#ffffff" fill-opacity=".16"/>' +
        '<text x="80" y="80" font-size="76" text-anchor="middle" dominant-baseline="central">' + emoji + '</text>' +
      '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function money(n) { return n.toFixed(2); }
  function yuan(n) { return n % 1 === 0 ? String(n) : n.toFixed(2); }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 1500);
  }

  /* ================================================================
     3. 状态：购物车
     ================================================================ */
  var CART = {};        // key: "分类序号-菜品序号" -> 数量
  var STORE_KEY = 'meituan-order-cart-v1';

  function keyOf(ci, di) { return ci + '-' + di; }
  function dishOf(k) {
    var p = k.split('-');
    var g = MENU[+p[0]];
    return g ? g.dishes[+p[1]] : null;
  }

  function saveCart() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(CART)); } catch (e) {}
  }
  function loadCart() {
    try {
      var s = localStorage.getItem(STORE_KEY);
      if (!s) return;
      var o = JSON.parse(s);
      Object.keys(o).forEach(function (k) {
        if (dishOf(k) && o[k] > 0) CART[k] = o[k];
      });
    } catch (e) {}
  }

  function cartStat() {
    var count = 0, total = 0, kinds = 0;
    Object.keys(CART).forEach(function (k) {
      var d = dishOf(k);
      if (!d || !CART[k]) return;
      count += CART[k];
      total += d.p * CART[k];
      kinds++;
    });
    return { count: count, total: total, kinds: kinds };
  }

  /* ================================================================
     4. 渲染菜品区
     ================================================================ */
  var cateList = $('cateList');
  var dishList = $('dishList');

  function renderMenu() {
    var cateHtml = '', dishHtml = '';

    MENU.forEach(function (g, ci) {
      cateHtml +=
        '<div class="cate__item' + (ci === 0 ? ' active' : '') + '" data-ci="' + ci + '">' +
          '<span class="cate__num" data-num="' + ci + '">0</span>' +
          '<span class="cate__ico">' + g.icon + '</span>' +
          '<span>' + g.name + '</span>' +
        '</div>';

      dishHtml +=
        '<section class="group" id="group-' + ci + '" data-ci="' + ci + '">' +
          '<div class="group__title"><h2>' + g.name + '</h2><span>共 ' + g.dishes.length + ' 道</span></div>';

      g.dishes.forEach(function (d, di) {
        var tagHtml = '';
        if (d.tag === 'hot') tagHtml = '<span class="tag tag--hot">热销</span>';
        else if (d.tag === 'new') tagHtml = '<span class="tag tag--new">新品</span>';
        else if (d.tag === 'rec') tagHtml = '<span class="tag tag--rec">推荐</span>';

        var oldHtml = d.old ? '<span class="old">¥' + yuan(d.old) + '</span>' : '';

        dishHtml +=
          '<article class="dish" data-ci="' + ci + '" data-di="' + di + '">' +
            '<div class="dish__pic"><img loading="lazy" src="' + dishImg(d.e, d.bg) + '" alt="' + d.n + '" /></div>' +
            '<div class="dish__main">' +
              '<h3 class="dish__name">' + d.n + tagHtml + '</h3>' +
              '<p class="dish__desc">' + d.d + '</p>' +
              '<div class="dish__sale">' + (d.sale || '') + '</div>' +
              '<div class="dish__bottom">' +
                (d.p > 0
                  ? '<span class="price"><span class="cur">¥</span><span class="num">' + yuan(d.p) + '</span>' +
                    (d.unit ? '<span class="unit">' + d.unit + '</span>' : '') + oldHtml + '</span>'
                  : '<span class="price price--free">0 元<span class="unit">免费点</span></span>') +
                '<div class="stepper" data-ci="' + ci + '" data-di="' + di + '">' +
                  '<button class="btn btn-sub" data-act="sub" aria-label="减少">−</button>' +
                  '<span class="qty zero">0</span>' +
                  '<button class="btn btn-add" data-act="add" aria-label="增加">+</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</article>';
      });

      dishHtml += '</section>';
    });

    cateList.innerHTML = cateHtml;
    dishList.innerHTML = dishHtml;

    dishList.addEventListener('click', onDishClick);
    cateList.addEventListener('click', onCateClick);
    dishList.addEventListener('scroll', onDishScroll, { passive: true });
  }

  function onDishClick(e) {
    // a) 点到 +/− 按钮
    var btn = e.target.closest('.btn');
    if (btn) {
      var box = btn.closest('.stepper');
      changeQty(+box.dataset.ci, +box.dataset.di, btn.dataset.act === 'add' ? 1 : -1,
                btn.dataset.act === 'add' ? btn : null);
      return;
    }
    // b) 点到菜品卡右侧空白区 = 加一份（与美团一致）
    var card = e.target.closest('.dish');
    if (!card) return;
    var stepper = card.querySelector('.stepper');
    if (!stepper) return;
    var r = card.getBoundingClientRect();
    var s = stepper.getBoundingClientRect();
    var tapRight = e.clientX >= card.offsetWidth * 0.62 + r.left;  // 右半区
    if (tapRight || e.clientY < s.top) {
      changeQty(+card.dataset.ci, +card.dataset.di, 1, stepper.querySelector('.btn-add'));
    }
  }

  function onCateClick(e) {
    var item = e.target.closest('.cate__item');
    if (!item) return;
    var ci = +item.dataset.ci;
    var g = $('group-' + ci);
    if (g) dishList.scrollTo({ top: g.offsetTop - dishList.offsetTop, behavior: 'smooth' });
    setActiveCate(ci);
    lockScrollSpy = true;
    clearTimeout(lockTimer);
    lockTimer = setTimeout(function () { lockScrollSpy = false; }, 500);
  }

  var lockScrollSpy = false, lockTimer = null;
  function onDishScroll() {
    if (lockScrollSpy) return;
    var groups = dishList.querySelectorAll('.group');
    var top = dishList.scrollTop + 1;
    var cur = 0;
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].offsetTop - dishList.offsetTop <= top) cur = i;
    }
    setActiveCate(cur);
  }

  function setActiveCate(ci) {
    var items = cateList.querySelectorAll('.cate__item');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('active', i === ci);
    }
  }

  /* ================================================================
     5. 加减菜 + 抛物线动画
     ================================================================ */
  function changeQty(ci, di, delta, srcEl) {
    var k = keyOf(ci, di);
    var now = (CART[k] || 0) + delta;
    if (now <= 0) { delete CART[k]; now = 0; }
    else CART[k] = now;

    // 更新该菜品对应的数量显示
    var box = dishList.querySelector('.stepper[data-ci="' + ci + '"][data-di="' + di + '"]');
    if (box) {
      var qty = box.querySelector('.qty');
      qty.textContent = now;
      qty.classList.toggle('zero', now === 0);
      box.classList.toggle('hide-sub', now === 0);
    }

    if (delta > 0 && srcEl) flyBall(srcEl);
    saveCart();
    renderCart();
    updateBadges();
  }

  function flyBall(srcEl) {
    var from = srcEl.getBoundingClientRect();
    var to = $('cartIcon').getBoundingClientRect();
    var ball = document.createElement('div');
    ball.className = 'jump-ball';
    ball.style.left = (from.left + from.width / 2 - 8) + 'px';
    ball.style.top = (from.top + from.height / 2 - 8) + 'px';
    document.body.appendChild(ball);

    var t = 0, dur = 0.5;
    var sx = from.left + from.width / 2, sy = from.top + from.height / 2;
    var ex = to.left + to.width / 2, ey = to.top + to.height / 2;
    var cx = sx + (ex - sx) * 0.55, cy = sy - 90;

    function frame() {
      t += 1 / 60;
      if (t >= dur) { ball.remove(); cartPoke(); return; }
      var u = t / dur;
      var x = (1 - u) * (1 - u) * sx + 2 * (1 - u) * u * cx + u * u * ex;
      var y = (1 - u) * (1 - u) * sy + 2 * (1 - u) * u * cy + u * u * ey;
      ball.style.transform = 'translate(' + (x - sx) + 'px,' + (y - sy) + 'px) scale(' + (1 - u * 0.4) + ')';
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function cartPoke() {
    var ic = $('cartIcon');
    ic.classList.remove('cartbar__poke');
    void ic.offsetWidth;
    ic.classList.add('cartbar__poke');
  }

  /* ================================================================
     6. 底部购物车 & 分类角标
     ================================================================ */
  function renderCart() {
    var st = cartStat();
    var bar = $('cartbar');

    bar.classList.toggle('has', st.count > 0);
    $('cartNum').textContent = st.count;
    $('cartTotal').textContent = st.total % 1 === 0 ? st.total : money(st.total);
    $('cartPrice').classList.toggle('empty', st.count === 0);

    if (st.count === 0) {
      $('cartTip').textContent = '未选购商品，请先点菜';
      $('btnGo').classList.add('disabled');
      $('btnGo').textContent = '去结算';
    } else if (st.total === 0) {
      // 免费模式：不显示满减，改为下单引导
      $('cartTip').textContent = '已点 ' + st.count + ' 份 · 全部 0 元，填备注后提交';
      $('btnGo').classList.remove('disabled');
      $('btnGo').textContent = '去下单';
    } else {
      var need = DISCOUNT_RULE.min - st.total;
      $('cartTip').textContent = need > 0
        ? '还差 ¥' + money(need) + ' 可享满 ' + DISCOUNT_RULE.min + ' 减 ' + DISCOUNT_RULE.off
        : '已享满 ' + DISCOUNT_RULE.min + ' 减 ' + DISCOUNT_RULE.off + ' 优惠';
      $('btnGo').classList.remove('disabled');
      $('btnGo').textContent = '去结算';
    }

    renderDrawerList();
  }

  function renderDrawerList() {
    var html = '';
    var st = cartStat();
    $('drawerCount').textContent = st.count;

    var keys = Object.keys(CART);
    if (!keys.length) {
      $('drawerList').innerHTML = '<div class="empty-cart"><span class="e">🍽️</span>购物车还是空的，去点几道菜吧</div>';
      return;
    }
    keys.forEach(function (k) {
      var d = dishOf(k), q = CART[k];
      if (!d) return;
      html +=
        '<div class="citem">' +
          '<span class="citem__name">' + d.n + '</span>' +
          '<span class="citem__price">' + (d.p > 0 ? '<span class="cur">¥</span>' + yuan(d.p * q) : '免费') + '</span>' +
          '<div class="stepper" data-k="' + k + '">' +
            '<button class="btn btn-sub" data-act="sub">−</button>' +
            '<span class="qty">' + q + '</span>' +
            '<button class="btn btn-add" data-act="add">+</button>' +
          '</div>' +
        '</div>';
    });
    $('drawerList').innerHTML = html;
  }

  $('drawerList').addEventListener('click', function (e) {
    var btn = e.target.closest('.btn');
    if (!btn) return;
    var box = btn.closest('.stepper');
    var p = box.dataset.k.split('-');
    changeQty(+p[0], +p[1], btn.dataset.act === 'add' ? 1 : -1, btn.dataset.act === 'add' ? btn : null);
    if (cartStat().count === 0) closeDrawer();
  });

  function updateBadges() {
    MENU.forEach(function (g, ci) {
      var n = 0;
      g.dishes.forEach(function (d, di) { n += CART[keyOf(ci, di)] || 0; });
      var el = cateList.querySelector('[data-num="' + ci + '"]');
      if (el) {
        el.textContent = n;
        el.parentElement.classList.toggle('show-num', n > 0);
      }
    });
  }

  function restoreSteppers() {
    Object.keys(CART).forEach(function (k) {
      var p = k.split('-');
      var box = dishList.querySelector('.stepper[data-ci="' + p[0] + '"][data-di="' + p[1] + '"]');
      if (!box) return;
      var q = CART[k];
      var qty = box.querySelector('.qty');
      qty.textContent = q;
      qty.classList.remove('zero');
      box.classList.remove('hide-sub');
    });
    updateBadges();
  }

  /* ================================================================
     7. 购物车面板开合
     ================================================================ */
  function openDrawer() {
    if (cartStat().count === 0) { toast('请先点菜哦～'); return; }
    $('drawer').classList.add('on');
    $('drawerMask').classList.add('on');
  }
  function closeDrawer() {
    $('drawer').classList.remove('on');
    $('drawerMask').classList.remove('on');
  }
  $('cartIcon').addEventListener('click', function () {
    $('drawer').classList.contains('on') ? closeDrawer() : openDrawer();
  });
  $('cartPrice').addEventListener('click', openDrawer);
  $('drawerMask').addEventListener('click', closeDrawer);
  $('btnClear').addEventListener('click', function () {
    if (cartStat().count === 0) return;
    CART = {};
    saveCart();
    closeDrawer();
    dishList.querySelectorAll('.stepper').forEach(function (b) {
      b.querySelector('.qty').textContent = 0;
      b.querySelector('.qty').classList.add('zero');
      b.classList.add('hide-sub');
    });
    renderCart();
    updateBadges();
    toast('已清空');
  });

  /* ================================================================
     8. 去结算 → 确认订单
     ================================================================ */
  function orderDetail() {
    var st = cartStat();
    var discount = st.total >= DISCOUNT_RULE.min ? DISCOUNT_RULE.off : 0;
    var pack = st.kinds * PACK_FEE;
    var pay = st.total - discount + pack;
    if (pay < 0) pay = 0;
    return { st: st, discount: discount, pack: pack, pay: pay };
  }

  function openConfirm() {
    var o = orderDetail();
    if (o.st.count === 0) { toast('请先点菜哦～'); return; }
    closeDrawer();

    var listHtml = '';
    Object.keys(CART).forEach(function (k) {
      var d = dishOf(k), q = CART[k];
      if (!d) return;
      listHtml +=
        '<div class="oline">' +
          '<div class="oline__img"><img src="' + dishImg(d.e, d.bg) + '" alt=""></div>' +
          '<div class="oline__name">' + d.n + '<small>' + (d.d || '') + '</small></div>' +
          '<div class="oline__qty">x' + q + '</div>' +
          '<div class="oline__price">' + (d.p > 0 ? '¥' + money(d.p * q) : '免费') + '</div>' +
        '</div>';
    });
    listHtml += '<div class="olist__ft">共 ' + o.st.count + ' 件商品<span class="addbtn">+ 加菜</span></div>';
    $('orderList').innerHTML = listHtml;

    var isFree = o.st.total === 0;
    $('sumBox').innerHTML =
      '<div class="sum__row"><span>菜品小计</span><span class="p-red">' + (isFree ? '0 元（全部免费）' : '¥' + money(o.st.total)) + '</span></div>' +
      (isFree ? '' : '<div class="sum__row"><span>餐盒费（' + o.st.kinds + ' 项 × ¥' + money(PACK_FEE) + '）</span><span>¥' + money(o.pack) + '</span></div>') +
      (o.discount > 0 ? '<div class="sum__row"><span>满减优惠</span><span class="p-red">-' + money(o.discount) + '</span></div>' : '') +
      '<div class="sum__row total"><span>合计</span><span class="p">' + (isFree ? '<span class="free-tag">0 元 · 免费</span>' : '<span class="cur">¥</span>' + money(o.pay)) + '</span></div>' +
      (isFree ? '<div class="sum__note">本店本次点单全部 0 元，提交后后厨按备注制作</div>' : '');

    var remarkTxt = (state.remark.tags.length || state.remark.text)
      ? (state.remark.tags.join('、') + (state.remark.text ? '；' + state.remark.text : ''))
      : '';
    $('remarkShow').textContent = remarkTxt || '口味、忌口、上菜顺序等要求，点这里填写';
    $('remarkShow').classList.toggle('filled', !!remarkTxt);

    if (o.pay === 0) {
      $('payBarTotal').innerHTML = '合计 <strong><span style="font-size:17px">0 元 · 免费</span></strong>';
    } else {
      $('payBarTotal').innerHTML = '合计 <strong><span class="cur">¥</span><span id="payTotal">' + money(o.pay) + '</span></strong>';
    }
    $('pageConfirm').classList.add('on');
  }

  $('btnGo').addEventListener('click', openConfirm);
  $('backConfirm').addEventListener('click', function () { $('pageConfirm').classList.remove('on'); });
  $('orderList').addEventListener('click', function (e) {
    if (e.target.classList.contains('addbtn')) {
      $('pageConfirm').classList.remove('on');
      openDrawer();
    }
  });

  $('tlTabs').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    this.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
    b.classList.add('on');
    state.mode = b.dataset.type === 'now' ? '立即用餐' : '预约用餐';
    $('tlBody').textContent = b.dataset.type === 'now'
      ? '后厨预计 12 分钟内开始制作，出餐后服务员会为您上菜。'
      : '可选择 30 分钟后至 2 小时内的用餐时间，到店即可开餐。';
  });

  /* ================================================================
     9. 提交订单
     ================================================================ */
  var ORDER = null;

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function remarkText() {
    var t = state.remark.tags.join('、');
    if (state.remark.text) t += (t ? '；' : '') + state.remark.text;
    return t;
  }

  /** 提交到接单后台；后台不可用时自动降级为本地下单，页面照常可用 */
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
  }

  $('btnPay').addEventListener('click', function () {
    var o = orderDetail();
    if (o.st.count === 0) { toast('购物车是空的'); return; }

    var now = new Date();
    var no = '' + now.getFullYear() + pad2(now.getMonth() + 1) + pad2(now.getDate()) +
             pad2(now.getHours()) + pad2(now.getMinutes()) + pad2(now.getSeconds()) +
             Math.floor(Math.random() * 900 + 100);

    var dateStr = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
    var timeStr = pad2(now.getHours()) + ':' + pad2(now.getMinutes());

    ORDER = {
      no: no,
      ts: now.getTime(),
      date: dateStr,
      time: dateStr + ' ' + timeStr,
      table: TABLE_NO,
      address: ADDRESS,
      mode: state.mode,
      items: Object.keys(CART).map(function (k) {
        var d = dishOf(k);
        return { n: d.n, p: d.p, q: CART[k] };
      }),
      sub: o.st.total,
      pack: o.pack,
      discount: o.discount,
      total: o.pay,
      count: o.st.count,
      remark: remarkText(),
      shop: SHOP_NAME
    };

    $('btnPay').classList.add('disabled');
    $('btnPay').textContent = '提交中…';

    postOrder(ORDER, function (ok, res) {
      $('btnPay').classList.remove('disabled');
      $('btnPay').textContent = '提交订单';

      if (ok && res.id) ORDER.no = res.id;
      ORDER.synced = !!ok;

      showDone();
      CART = {};
      saveCart();
      state.remark.tags = [];
      state.remark.text = '';
      dishList.querySelectorAll('.stepper').forEach(function (b) {
        b.querySelector('.qty').textContent = 0;
        b.querySelector('.qty').classList.add('zero');
        b.classList.add('hide-sub');
      });
      renderCart();
      updateBadges();
      $('pageConfirm').classList.remove('on');
      toast(ok ? '下单成功，后厨已接单' : '已提交（后台未连接，本地已记录）');
    });
  });

  function showDone() {
    $('doneCard').innerHTML =
      '<div class="r"><span>订单号</span><b>' + ORDER.no + '</b></div>' +
      '<div class="r"><span>下单时间</span><b>' + ORDER.time + '</b></div>' +
      '<div class="r"><span>用餐方式</span><b>堂食 · ' + TABLE_NO + ' 号桌</b></div>' +
      '<div class="r"><span>菜品数量</span><b>' + ORDER.count + ' 件</b></div>' +
      (ORDER.remark ? '<div class="r"><span>备注</span><b class="rmk">' + esc(ORDER.remark) + '</b></div>' : '') +
      '<div class="r"><span>' + (ORDER.total === 0 ? '本单金额' : '实付金额') + '</span><b style="color:#FF4B21">' +
        (ORDER.total === 0 ? '0 元 · 免费' : '¥' + money(ORDER.total)) + '</b></div>' +
      '<div class="r"><span>接单状态</span><b style="color:' + (ORDER.synced ? '#00A94E' : '#999') + '">' +
        (ORDER.synced ? '已发送到后厨' : '后台未连接') + '</b></div>';
    $('pageDone').classList.add('on');
  }

  $('btnAgain').addEventListener('click', function () {
    $('pageDone').classList.remove('on');
    toast('已回到菜单，请继续点菜');
  });
  $('btnFinish').addEventListener('click', function () {
    $('pageDone').classList.remove('on');
    $('pageConfirm').classList.remove('on');
  });

  /* ================================================================
     10. 其它交互
     ================================================================ */
  $('btnBack').addEventListener('click', function () {
    if ($('pageDone').classList.contains('on')) { $('pageDone').classList.remove('on'); return; }
    if ($('pageConfirm').classList.contains('on')) { $('pageConfirm').classList.remove('on'); return; }
    toast('已是最外层页面');
  });
  $('btnShare').addEventListener('click', function () {
    var url = location.href;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { toast('点餐链接已复制'); },
        function () { toast('请手动复制地址栏链接'); });
    } else {
      toast('请手动复制地址栏链接');
    }
  });

  /* ================================================================
     11. 启动
     ================================================================ */
  $('shopCover').src = dishImg('🍜', '#7A4A2B');

  renderMenu();
  loadCart();
  restoreSteppers();
  renderCart();

  // 阻止 iOS 双指缩放 / 双击缩放
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });

  /* ================================================================
     12. 备注弹层（常用备注多选 + 自定义）
     ================================================================ */
  var REMARK_GROUPS = [
    { t: '口味', list: ['不要辣', '微辣', '中辣', '特辣', '少油', '少盐', '多放蒜', '加麻'] },
    { t: '忌口', list: ['不要香菜', '不要葱', '不要姜', '不要蒜', '不吃花生', '不吃牛肉', '无海鲜', '清真'] },
    { t: '做法', list: ['做软一点', '做脆一点', '免味精', '汤汁分开装', '打包带走', '一起上菜'] },
    { t: '餐具/其他', list: ['一份餐具', '多份餐具', '要打包盒', '先上凉菜', '最后上主食', '催一下单'] }
  ];
  var state = { remark: { tags: [], text: '' }, mode: '立即用餐' };
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  var rmkSheet = document.createElement('div');
  rmkSheet.innerHTML =
    '<div class="rmk-mask" id="rmkMask"></div>' +
    '<section class="rmk-sheet" id="rmkSheet">' +
      '<div class="rmk-hd">' +
        '<h3>添加备注</h3>' +
        '<button class="close" id="rmkClose">&times;</button>' +
      '</div>' +
      '<div class="rmk-bd">' +
        REMARK_GROUPS.map(function (g) {
          return '<div class="rmk-grp">' +
            '<div class="rmk-grp__t">' + g.t + '</div>' +
            '<div class="rmk-tags">' +
              g.list.map(function (x) {
                return '<button class="rmk-tag" data-tag="' + x + '">' + x + '</button>';
              }).join('') +
            '</div>' +
          '</div>';
        }).join('') +
        '<div class="rmk-grp">' +
          '<div class="rmk-grp__t">其他要求</div>' +
          '<textarea class="rmk-input" id="rmkText" maxlength="100" placeholder="例如：老人小孩多，请少放辣椒；先上凉菜，主食最后上"></textarea>' +
        '</div>' +
      '</div>' +
      '<div class="rmk-ft">' +
        '<button class="cancel" id="rmkCancel">取消</button>' +
        '<button class="ok" id="rmkOk">确定</button>' +
      '</div>' +
    '</section>';
  document.getElementById('app').appendChild(rmkSheet);
  /* 注意：本段落必须在原有 IIFE 内部，才能访问 API_BASE / renderMenu / $ 等 */

  var rmkMask = $('rmkMask'), rmkPanel = $('rmkSheet');

  function openRemark() {
    var cur = dishList.scrollTop;
    $('rmkText').value = state.remark.text;
    rmkPanel.querySelectorAll('.rmk-tag').forEach(function (b) {
      b.classList.toggle('on', state.remark.tags.indexOf(b.dataset.tag) >= 0);
    });
    rmkMask.classList.add('on');
    rmkPanel.classList.add('on');
    void cur;
  }
  function closeRemark() {
    rmkMask.classList.remove('on');
    rmkPanel.classList.remove('on');
  }

  $('remarkRow').addEventListener('click', openRemark);
  rmkMask.addEventListener('click', closeRemark);
  $('rmkClose').addEventListener('click', closeRemark);
  $('rmkCancel').addEventListener('click', closeRemark);
  rmkPanel.addEventListener('click', function (e) {
    var t = e.target.closest('.rmk-tag');
    if (!t) return;
    t.classList.toggle('on');
  });
  $('rmkOk').addEventListener('click', function () {
    state.remark.tags = [];
    rmkPanel.querySelectorAll('.rmk-tag.on').forEach(function (b) {
      state.remark.tags.push(b.dataset.tag);
    });
    state.remark.text = ($('rmkText').value || '').trim();
    var txt = remarkText();
    $('remarkShow').textContent = txt || '口味、忌口、上菜顺序等要求，点这里填写';
    $('remarkShow').classList.toggle('filled', !!txt);
    closeRemark();
    toast(txt ? '备注已添加' : '已清空备注');
  });

  /* ================================================================
     13. 菜单支持服务端下发（改了后台/menu.json，前台自动同步）
     ================================================================ */
  function apiGet(url) {
    return fetch(API_BASE + url).then(function (r) { return r.json(); });
  }

  apiGet('/api/menu').then(function (r) {
    if (!r || !r.ok || !Array.isArray(r.menu) || !r.menu.length) return;
    MENU = r.menu;
    renderMenu();
    restoreSteppers();
    renderCart();
  }).catch(function () { /* 静态打开时忽略，用内置菜单 */ });

  /* 订单实时同步给店员（后台页会轮询，这里只做本地提示） */
  window.addEventListener('online', function () { toast('网络已恢复'); });
})();
</script>
</body>
</html>
`;
const ADMIN_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>接单后台 · 志顺小馆（小仝宝店）</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='22' fill='%23FFD100'/%3E%3Ctext y='72' x='50' text-anchor='middle' font-size='58'%3E%F0%9F%94%94%3C/text%3E%3C/svg%3E" />
<style>
:root{
  --brand:#FFD100; --price:#FF4B21; --green:#00C25A; --green-d:#00A94E;
  --t1:#1f1f1f; --t2:#666; --t3:#999; --line:#EDEDED; --bg:#F2F3F5;
  --safe: env(safe-area-inset-bottom, 0px);
}
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
body{
  font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
  background:var(--bg);color:var(--t1);font-size:14px;
}
button{font-family:inherit;border:none;background:none;cursor:pointer;color:inherit;}

/* ---------- 顶栏 ---------- */
.top{
  position:sticky;top:0;z-index:20;background:#fff;border-bottom:1px solid var(--line);
  padding:12px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;
}
.top__brand{display:flex;align-items:center;gap:9px;font-size:16px;font-weight:700;}
.top__dot{width:9px;height:9px;border-radius:50%;background:var(--green);box-shadow:0 0 0 4px rgba(0,194,90,.15);}
.top__dot.off{background:#CCC;box-shadow:0 0 0 4px rgba(0,0,0,.05);}
.top__sub{font-size:12px;color:var(--t3);font-weight:400;}
.top__sp{flex:1;}
.btn{
  height:34px;padding:0 14px;border-radius:17px;font-size:13px;font-weight:600;
  background:#F4F4F4;color:var(--t2);display:inline-flex;align-items:center;gap:5px;
  transition:filter .15s,background .15s;
}
.btn:active{filter:brightness(.94);}
.btn--brand{background:var(--brand);color:#5a4400;}
.btn--green{background:var(--green);color:#fff;}
.btn--ghost{background:#fff;border:1px solid var(--line);}
.btn.on{background:var(--green);color:#fff;}
.btn--sm{height:30px;padding:0 12px;font-size:12px;border-radius:15px;}

/* ---------- 统计 ---------- */
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:14px 18px 4px;}
.stat{background:#fff;border-radius:12px;padding:13px 15px;}
.stat .k{font-size:12px;color:var(--t3);}
.stat .v{font-size:23px;font-weight:700;margin-top:4px;line-height:1.1;}
.stat .v.red{color:var(--price);}
.stat .v.green{color:var(--green-d);}

/* ---------- 过滤条 ---------- */
.tabs{display:flex;gap:8px;padding:14px 18px 10px;flex-wrap:wrap;align-items:center;}
.tab{
  height:32px;padding:0 15px;border-radius:16px;background:#fff;font-size:13px;color:var(--t2);
  border:1px solid transparent;font-weight:500;
}
.tab.on{background:#FFF6CC;border-color:var(--brand);color:#8a6a00;font-weight:700;}
.tab .n{font-size:11px;opacity:.7;margin-left:3px;}
.tabs__sp{flex:1;}

/* ---------- 订单卡片 ---------- */
.list{padding:0 18px 40px;display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px;}
.order{
  background:#fff;border-radius:14px;overflow:hidden;border:1px solid var(--line);
  display:flex;flex-direction:column;transition:box-shadow .18s,transform .18s;
}
.order.is-new{animation:flash 1.4s ease-out 2;border-color:var(--brand);}
@keyframes flash{0%{box-shadow:0 0 0 0 rgba(255,209,0,.85);}100%{box-shadow:0 0 0 16px rgba(255,209,0,0);}}
.order.pending{border-left:4px solid var(--price);}
.order.cooking{border-left:4px solid #FFA800;}
.order.done{border-left:4px solid #D8D8D8;opacity:.82;}

.order__hd{display:flex;align-items:center;gap:9px;padding:13px 15px 11px;border-bottom:1px dashed var(--line);}
.order__no{font-size:15px;font-weight:700;letter-spacing:.3px;}
.order__badge{font-size:11px;border-radius:4px;padding:2px 7px;font-weight:600;}
.b-pending{background:rgba(255,75,33,.12);color:var(--price);}
.b-cooking{background:rgba(255,168,0,.16);color:#B87700;}
.b-done{background:#F1F1F1;color:#999;}
.order__time{margin-left:auto;font-size:12px;color:var(--t3);text-align:right;line-height:1.35;}

.order__meta{display:flex;gap:16px;padding:11px 15px 4px;font-size:13px;color:var(--t2);flex-wrap:wrap;}
.order__meta b{color:var(--t1);font-weight:600;}
.order__table{font-size:15px;font-weight:700;color:var(--t1);}
.order__addr{padding:6px 15px 0;font-size:12px;color:var(--t3);}

.items{padding:8px 15px 4px;}
.item{display:flex;align-items:center;gap:10px;padding:5px 0;font-size:13.5px;}
.item__q{color:var(--price);font-weight:700;min-width:30px;}
.item__n{flex:1;min-width:0;}
.item__p{color:var(--t3);font-size:12px;}

.remark{
  margin:9px 15px 0;background:#FFF8E1;border:1px solid #FFE9A8;border-radius:9px;padding:9px 11px;
  font-size:13px;color:#8a6a00;line-height:1.5;word-break:break-all;
}
.remark.empty{background:#FAFAFA;border-color:var(--line);color:#B5B5B5;}
.remark b{color:#B87700;}

.order__ft{
  display:flex;align-items:center;gap:9px;padding:11px 15px 13px;margin-top:auto;
  border-top:1px solid var(--line);background:#FCFCFC;
}
.order__amt{font-size:13px;color:var(--t2);}
.order__amt b{font-size:17px;color:var(--price);font-weight:700;}

.empty{text-align:center;padding:70px 20px;color:var(--t3);grid-column:1/-1;}
.empty .e{font-size:46px;display:block;margin-bottom:12px;opacity:.45;}

/* ---------- 备注编辑弹层 ---------- */
.mask{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:50;opacity:0;visibility:hidden;transition:.22s;}
.mask.on{opacity:1;visibility:visible;}
.sheet{
  position:fixed;left:50%;top:50%;transform:translate(-50%,-46%) scale(.96);width:min(420px,92vw);
  background:#fff;border-radius:16px;z-index:51;opacity:0;visibility:hidden;transition:.22s;
  padding:20px;
}
.sheet.on{opacity:1;visibility:visible;transform:translate(-50%,-50%) scale(1);}
.sheet h3{font-size:16px;margin-bottom:4px;}
.sheet p{font-size:12px;color:var(--t3);margin-bottom:12px;}
.sheet textarea{
  width:100%;height:96px;border:1px solid var(--line);border-radius:10px;padding:11px;
  font-family:inherit;font-size:14px;resize:none;outline:none;background:#FAFAFA;
}
.sheet textarea:focus{border-color:var(--brand);background:#fff;}
.sheet__ft{display:flex;gap:10px;margin-top:14px;}
.sheet__ft button{flex:1;height:42px;border-radius:21px;font-size:15px;font-weight:600;}
.sheet__ft .c{background:#F4F4F4;color:var(--t2);}
.sheet__ft .o{background:var(--green);color:#fff;}

/* 新订单横幅 */
.banner{
  position:fixed;left:50%;top:14px;transform:translate(-50%,-140%);z-index:60;
  background:#fff;border-radius:12px;padding:12px 20px;box-shadow:0 8px 30px rgba(0,0,0,.18);
  display:flex;align-items:center;gap:11px;font-size:14px;font-weight:600;
  transition:transform .3s cubic-bezier(.3,1.4,.5,1);
}
.banner.on{transform:translate(-50%,0);}
.banner .ico{width:32px;height:32px;border-radius:50%;background:var(--price);color:#fff;display:grid;place-items:center;font-size:17px;}

.toast{
  position:fixed;left:50%;bottom:32px;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#fff;
  font-size:13px;padding:9px 17px;border-radius:8px;z-index:70;opacity:0;visibility:hidden;transition:.2s;
}
.toast.on{opacity:1;visibility:visible;}

/* 小屏（手机当接单器） */
@media (max-width:640px){
  .top{padding:10px 12px;gap:9px;}
  .top__brand{font-size:14px;width:100%;}
  .stats{grid-template-columns:repeat(2,1fr);padding:12px 12px 2px;}
  .tabs{padding:12px 12px 8px;}
  .list{padding:0 12px 40px;grid-template-columns:1fr;gap:11px;}
  .btn{height:32px;padding:0 12px;font-size:12px;}
}
</style>
</head>
<body>

<div class="top">
  <div class="top__brand">
    <span class="top__dot" id="liveDot"></span>
    <span>接单后台 · 志顺小馆（小仝宝店）</span>
    <span class="top__sub" id="liveText">连接中…</span>
  </div>
  <div class="top__sp"></div>
  <button class="btn btn--green on" id="btnSound">🔔 声音提醒：开</button>
  <button class="btn btn--ghost" id="btnNotify">桌面通知</button>
  <button class="btn btn--brand" id="btnRefresh">↻ 刷新</button>
</div>

<div class="stats">
  <div class="stat"><div class="k">待处理</div><div class="v red" id="sPending">0</div></div>
  <div class="stat"><div class="k">制作中</div><div class="v" id="sCooking">0</div></div>
  <div class="stat"><div class="k">已完成</div><div class="v green" id="sDone">0</div></div>
  <div class="stat"><div class="k">累计订单</div><div class="v" id="sTotal">0</div></div>
</div>

<div class="tabs">
  <button class="tab on" data-f="active">待处理 + 制作中<span class="n" id="nActive">0</span></button>
  <button class="tab" data-f="pending">仅待处理<span class="n" id="nPending">0</span></button>
  <button class="tab" data-f="done">已完成<span class="n" id="nDone">0</span></button>
  <button class="tab" data-f="all">全部<span class="n" id="nAll">0</span></button>
  <div class="tabs__sp"></div>
  <button class="btn btn--sm btn--ghost" id="btnClearDone">清空已完成</button>
</div>

<div class="list" id="list"></div>

<div class="banner" id="banner">
  <span class="ico">🔔</span><span id="bannerText">有新订单</span>
</div>

<div class="mask" id="mask"></div>
<div class="sheet" id="sheet">
  <h3>修改备注</h3>
  <p id="sheetNo">订单号 —</p>
  <textarea id="sheetText" maxlength="300" placeholder="填写顾客要求，如：少辣、不要香菜"></textarea>
  <div class="sheet__ft">
    <button class="c" id="sheetCancel">取消</button>
    <button class="o" id="sheetSave">保存</button>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
(function () {
  'use strict';

  /* 口令：优先 URL 的 ?token=，否则用上次记住的 */
  var qs = new URLSearchParams(location.search);
  if (qs.get('token')) { try { sessionStorage.setItem('adminToken', qs.get('token')); } catch (e) {} }
  var TOKEN = qs.get('token') || (function () { try { return sessionStorage.getItem('adminToken') || ''; } catch (e) { return ''; } })();

  var $ = function (id) { return document.getElementById(id); };
  var FILTER = 'active';
  var ORDERS = [];
  var SEEN = null;             // 已知订单号集合，用于识别新订单
  var SOUND = true;
  var editing = null;
  var TIMER = null;

  function headers(extra) {
    var h = extra || {};
    if (TOKEN) h['X-Admin-Token'] = TOKEN;
    return h;
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 1800);
  }

  /* ---------- 提示音（无需音频文件） ---------- */
  function beep(times) {
    if (!SOUND) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ctx = new AC();
      var n = times || 2;
      for (var i = 0; i < n; i++) {
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = i % 2 === 0 ? 880 : 1180;
        o.connect(g); g.connect(ctx.destination);
        var t0 = ctx.currentTime + i * 0.22;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.32, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
        o.start(t0); o.stop(t0 + 0.22);
      }
      setTimeout(function () { try { ctx.close(); } catch (e) {} }, 1200);
    } catch (e) {}
  }

  function banner(text) {
    $('bannerText').textContent = text;
    $('banner').classList.add('on');
    setTimeout(function () { $('banner').classList.remove('on'); }, 3800);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- 拉取订单 ---------- */
  function load(manual) {
    fetch('/api/orders', { headers: headers() })
      .then(function (r) {
        if (r.status === 401) throw new Error('unauthorized');
        return r.json();
      })
      .then(function (j) {
        if (!j || !j.ok) throw new Error('bad');
        setLive(true);
        var list = j.orders || [];

        if (SEEN === null) {
          // 首次加载：只把已有订单记为已见，不响铃
          SEEN = {};
          list.forEach(function (o) { SEEN[o.id] = 1; });
        } else {
          var fresh = list.filter(function (o) { return !SEEN[o.id]; });
          if (fresh.length) {
            fresh.forEach(function (o) { SEEN[o.id] = 1; FRESH[o.id] = 1; });
            beep(3);
            banner('新订单 ' + fresh.length + ' 单：桌号 ' + fresh.map(function (o) { return o.table; }).join('、'));
            if (window.Notification && Notification.permission === 'granted') {
              try {
                new Notification('志顺小馆 · 新订单', {
                  body: fresh.map(function (o) {
                    return '桌号 ' + o.table + ' ' + o.count + ' 件' + (o.remark ? '｜' + o.remark : '');
                  }).join('\\n')
                });
              } catch (e) {}
            }
          }
        }

        ORDERS = list;
        render();
        // 高亮动画只跑一次，渲染后清掉新订单标记
        FRESH = {};
        if (manual) toast('已刷新 · ' + list.length + ' 单');
      })
      .catch(function (e) {
        setLive(false, e.message === 'unauthorized' ? '口令不对' : '连接失败');
        if (manual) toast(e.message === 'unauthorized' ? '口令不正确' : '后台连接失败');
      });
  }

  var FRESH = {};

  function setLive(ok, txt) {
    $('liveDot').classList.toggle('off', !ok);
    $('liveText').textContent = ok ? ('云端同步中 · ' + new Date().toLocaleTimeString('zh-CN', { hour12: false })) : (txt || '已断开');
  }

  /* ---------- 渲染 ---------- */
  var STATUS = { pending: '待处理', cooking: '制作中', done: '已完成' };

  function render() {
    var pending = ORDERS.filter(function (o) { return o.status === 'pending'; });
    var cooking = ORDERS.filter(function (o) { return o.status === 'cooking'; });
    var done = ORDERS.filter(function (o) { return o.status === 'done'; });

    $('sPending').textContent = pending.length;
    $('sCooking').textContent = cooking.length;
    $('sDone').textContent = done.length;
    $('sTotal').textContent = ORDERS.length;
    $('nActive').textContent = pending.length + cooking.length;
    $('nPending').textContent = pending.length;
    $('nDone').textContent = done.length;
    $('nAll').textContent = ORDERS.length;

    var show = ORDERS;
    if (FILTER === 'active') show = pending.concat(cooking);
    else if (FILTER === 'pending') show = pending;
    else if (FILTER === 'done') show = done;

    if (!show.length) {
      $('list').innerHTML = '<div class="empty"><span class="e">🧾</span>' +
        (FILTER === 'done' ? '还没有已完成的订单' : '暂时没有新订单，等顾客下单吧～') + '</div>';
      return;
    }

    $('list').innerHTML = show.map(card).join('');
  }

  function card(o) {
    var items = (o.items || []).map(function (it) {
      return '<div class="item">' +
        '<span class="item__q">x' + it.q + '</span>' +
        '<span class="item__n">' + esc(it.n) + '</span>' +
        (it.p > 0 ? '<span class="item__p">¥' + (it.p * it.q) + '</span>' : '<span class="item__p">0 元</span>') +
      '</div>';
    }).join('');

    var rmk = o.remark
      ? '<div class="remark"><b>备注：</b>' + esc(o.remark) + '</div>'
      : '<div class="remark empty">备注：无（可点「加备注」补充）</div>';

    var isNew = FRESH[o.id] ? ' is-new' : '';

    var acts = '';
    if (o.status === 'pending') {
      acts = '<button class="btn btn--sm btn--brand" data-act="cooking" data-id="' + o.id + '">开始制作</button>' +
             '<button class="btn btn--sm btn--green" data-act="done" data-id="' + o.id + '">完成</button>';
    } else if (o.status === 'cooking') {
      acts = '<button class="btn btn--sm btn--green" data-act="done" data-id="' + o.id + '">完成出餐</button>' +
             '<button class="btn btn--sm btn--ghost" data-act="pending" data-id="' + o.id + '">退回待处理</button>';
    } else {
      acts = '<button class="btn btn--sm btn--ghost" data-act="pending" data-id="' + o.id + '">恢复未完成</button>';
    }

    return '<article class="order ' + o.status + isNew + '">' +
      '<div class="order__hd">' +
        '<span class="order__no">#' + esc(o.id) + '</span>' +
        '<span class="order__badge b-' + o.status + '">' + STATUS[o.status] + '</span>' +
        '<span class="order__time">' + esc(o.date || '') + '<br>' + esc(o.time || '') + '</span>' +
      '</div>' +
      '<div class="order__meta">' +
        '<span class="order__table">桌号 ' + esc(o.table || '未填') + '</span>' +
        '<span>方式 <b>' + esc(o.mode || '立即用餐') + '</b></span>' +
        '<span>共 <b>' + (o.count || 0) + '</b> 件</span>' +
      '</div>' +
      (o.address ? '<div class="order__addr">📍 ' + esc(o.address) + '</div>' : '') +
      '<div class="items">' + items + '</div>' +
      rmk +
      '<div class="order__ft">' +
        '<span class="order__amt">' + ((o.total || 0) === 0 ? '<b>0 元</b> 免费' : '金额 <b>¥' + o.total + '</b>') + '</span>' +
        '<button class="btn btn--sm btn--ghost" data-act="remark" data-id="' + o.id + '">加备注</button>' +
        '<span style="flex:1"></span>' +
        acts +
      '</div>' +
    '</article>';
  }

  /* ---------- 操作 ---------- */
  $('list').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var id = b.dataset.id, act = b.dataset.act;

    if (act === 'remark') {
      var o = ORDERS.filter(function (x) { return x.id === id; })[0];
      editing = id;
      $('sheetNo').textContent = '订单号 #' + id + '（桌号 ' + (o ? o.table : '') + '）';
      $('sheetText').value = (o && o.remark) || '';
      $('mask').classList.add('on');
      $('sheet').classList.add('on');
      setTimeout(function () { $('sheetText').focus(); }, 200);
      return;
    }

    fetch('/api/orders/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status: act })
    }).then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) throw new Error(j.error || 'fail');
        toast('已更新为「' + STATUS[act] + '」');
        load();
      })
      .catch(function () { toast('更新失败，请检查后台连接'); });
  });

  function closeSheet() {
    $('mask').classList.remove('on');
    $('sheet').classList.remove('on');
    editing = null;
  }
  $('mask').addEventListener('click', closeSheet);
  $('sheetCancel').addEventListener('click', closeSheet);
  $('sheetSave').addEventListener('click', function () {
    if (!editing) return;
    var txt = $('sheetText').value.trim();
    fetch('/api/orders/' + encodeURIComponent(editing), {
      method: 'PATCH',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ remark: txt })
    }).then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) throw new Error('fail');
        toast('备注已保存');
        closeSheet();
        load();
      })
      .catch(function () { toast('保存失败'); });
  });

  /* ---------- 过滤 / 工具按钮 ---------- */
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('on'); });
      t.classList.add('on');
      FILTER = t.dataset.f;
      render();
    });
  });

  $('btnRefresh').addEventListener('click', function () { load(true); });

  $('btnSound').addEventListener('click', function () {
    SOUND = !SOUND;
    this.textContent = SOUND ? '🔔 声音提醒：开' : '🔕 声音提醒：关';
    this.classList.toggle('on', SOUND);
    if (SOUND) beep(1);
  });

  $('btnNotify').addEventListener('click', function () {
    if (!window.Notification) return toast('当前浏览器不支持桌面通知');
    Notification.requestPermission().then(function (p) {
      toast(p === 'granted' ? '已开启桌面通知' : '通知未授权');
    });
  });

  $('btnClearDone').addEventListener('click', function () {
    var n = ORDERS.filter(function (o) { return o.status === 'done'; }).length;
    if (!n) return toast('没有已完成的订单');
    if (!confirm('确定清空 ' + n + ' 条已完成订单？此操作不可恢复。')) return;
    fetch('/api/orders?scope=done', { method: 'DELETE', headers: headers() })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) throw new Error('fail');
        toast('已清空 ' + j.removed + ' 条');
        SEEN = null;
        load();
      })
      .catch(function () { toast('清空失败'); });
  });

  /* ---------- 自动刷新：5 秒一轮，页面隐藏时暂停 ---------- */
  function startTimer() {
    if (TIMER) clearInterval(TIMER);
    TIMER = setInterval(function () {
      if (!document.hidden) load();
    }, 5000);
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) load();
  });

  load();
  startTimer();
})();
</script>
</body>
</html>
`;
