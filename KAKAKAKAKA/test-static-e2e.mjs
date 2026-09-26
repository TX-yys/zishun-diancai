/**
 * 静态版端到端验证（真实浏览器 + 真实公共 MQTT 中转，全程无服务器）
 *
 *   测试 A：顾客点菜页下单 → Node 作为接单方订阅 → 校验收到的订单内容
 *   测试 B：Node 发布订单 → 浏览器接单台收到并显示
 *   测试 C：接单台点击状态流转
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import MQTTWS from './mqtt-client.js';

const APP_PORT = 8266;
const CDP_PORT = 9966;
const BASE = 'http://127.0.0.1:' + APP_PORT;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const USER_DIR = path.join(os.tmpdir(), 'dsh-static-e2e-' + Date.now());
const CHANNEL = 'TESTCH' + Math.random().toString(36).slice(2, 6).toUpperCase();
const NS = 'zishun/diancai/v1/';
const TOPIC = NS + CHANNEL + '/orders';
const BROKER = 'wss://broker.emqx.io:8084/mqtt';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (url) => new Promise((res, rej) => {
  http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 260) : '')); }
}

/* ---------- 静态文件服务器 ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/' || p === '') p = '/page-order.html';
  const full = path.join(process.cwd(), 'static', p.replace(/^\/+/, ''));
  if (!full.startsWith(path.join(process.cwd(), 'static')) || !fs.existsSync(full)) {
    res.writeHead(404); return res.end('404');
  }
  const ext = path.extname(full).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(full));
});
await new Promise((r) => server.listen(APP_PORT, '127.0.0.1', r));
console.log('静态文件服务: ' + BASE + '（仅用于本次测试，生产环境用任意静态托管）');
console.log('接单频道: ' + CHANNEL);
console.log('');

/* ---------- 浏览器 ---------- */
const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + USER_DIR, '--window-size=420,900', 'about:blank'],
  { stdio: 'ignore' });

let wsUrl = null;
for (let i = 0; i < 40; i++) {
  await wait(400);
  try { const v = await getJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); if (v.webSocketDebuggerUrl) { wsUrl = v.webSocketDebuggerUrl; break; } } catch (e) {}
}
if (!wsUrl) { console.log('✗ CDP 连接失败'); child.kill(); server.close(); process.exit(1); }

const ws = new WebSocket(wsUrl);
const on = (ev, fn) => ws.addEventListener(ev, fn);
let id = 0; const pending = new Map(); const exceptions = [];
on('message', (e) => {
  const m = JSON.parse(e.data.toString());
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id); pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  } else if (m.method === 'Runtime.exceptionThrown') {
    exceptions.push((m.params.exceptionDetails.text || '') + ' ' + ((m.params.exceptionDetails.exception || {}).description || ''));
  }
});
const send = (m, p, s) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: mid, method: m, params: p || {}, sessionId: s })); });
await new Promise((r) => on('open', r));

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 2, mobile: true }, sessionId);

const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
};
const nav = async (url) => {
  await send('Page.navigate', { url }, sessionId);
  for (let i = 0; i < 60; i++) { await wait(300); if (await evl('document.readyState') === 'complete') break; }
  await wait(900);
};

/* ============================================================
   测试 A：顾客下单 → MQTT
   ============================================================ */
console.log('===== A. 顾客点菜页（静态版）下单 =====');
const received = [];
let subClient = null;
const subReady = new Promise((resolve) => {
  subClient = new MQTTWS.Client({
    url: BROKER,
    clientId: 'zishun-test-sub-' + Math.random().toString(16).slice(2, 10),
    onOpen() { subClient.subscribe(TOPIC); resolve(true); },
    onMessage(topic, payload) {
      if (topic !== TOPIC) return;
      try { received.push(JSON.parse(payload)); } catch (e) {}
    },
    onError() {}
  });
  subClient.connect();
});
await Promise.race([subReady, wait(20000)]);
console.log('  （Node 接单方已订阅 ' + TOPIC + '）');

await nav(BASE + '/page-order.html?t=A14&c=' + CHANNEL);
const pageInfo = await evl(`(function(){
  return {
    shop: document.querySelector('.shop__name span').textContent,
    dishes: document.querySelectorAll('.dish').length,
    hasMqtt: typeof window.MQTTWS === 'object' && typeof window.MQTTWS.Client === 'function'
  };
})()`);
check('点菜页加载正常', pageInfo.dishes > 0, pageInfo);
check('店名正确', pageInfo.shop === '志顺小馆（小仝宝店）', pageInfo.shop);
check('MQTT 客户端已注入', pageInfo.hasMqtt === true, pageInfo.hasMqtt);

// 点菜 + 备注 + 下单
const orderInfo = await evl(`(function(){
  var cards = document.querySelectorAll('.dish');
  cards[0].querySelector('.btn-add').click();
  cards[0].querySelector('.btn-add').click();
  cards[1].querySelector('.btn-add').click();
  document.getElementById('btnGo').click();
  document.getElementById('remarkRow').click();
  ['不要辣','不要香菜'].forEach(function(t){
    var b = document.querySelector('.rmk-tag[data-tag="'+t+'"]');
    if (b) b.click();
  });
  document.getElementById('rmkText').value = '主食最后上';
  document.getElementById('rmkOk').click();
  return {
    table: document.querySelector('.addr .l1').textContent,
    num: document.getElementById('cartNum').textContent
  };
})()`);
check('桌号 A14', orderInfo.table.includes('A14'), orderInfo.table);
check('购物车 3 件', orderInfo.num === '3', orderInfo.num);

await evl(`document.getElementById('btnPay').click()`);
// 等 MQTT 送达
for (let i = 0; i < 24 && !received.length; i++) await wait(500);
const doneCard = await evl(`document.getElementById('doneCard').innerText.replace(/\\n/g,' | ')`);

check('MQTT 收到订单', received.length >= 1, received.length);
if (received.length) {
  const o = received[0];
  check('订单桌号正确', o.table === 'A14', o.table);
  check('菜品数量正确', o.count === 3, o.count);
  check('备注完整送达', (o.remark || '').includes('不要辣') && (o.remark || '').includes('主食最后上'), o.remark);
  check('金额为 0（免费）', o.total === 0, o.total);
  check('订单号存在', !!o.id, o.id);
  console.log('  收到的订单: ' + JSON.stringify({ id: o.id, table: o.table, count: o.count, remark: o.remark, total: o.total }));
}
check('页面显示已发送成功', doneCard.includes('已发送到后厨'), doneCard);

/* ============================================================
   测试 B：Node 发布 → 浏览器接单台
   ============================================================ */
console.log('\n===== B. 接单台（静态版）收单 =====');
await nav(BASE + '/admin-static.html?c=' + CHANNEL);
await wait(3000);
const admState = await evl(`(function(){
  var st = document.getElementById('setup');
  return {
    setupHidden: !st || st.style.display === 'none',
    mainShown: document.getElementById('main').style.display !== 'none',
    live: document.getElementById('liveText').textContent,
    hasMqtt: typeof window.MQTTWS === 'object'
  };
})()`);
check('接单台跳过设置（频道码来自网址）', admState.setupHidden === true, admState);
check('主界面已显示', admState.mainShown === true, admState);

// 等连接建立
let connected = false;
for (let i = 0; i < 20; i++) {
  const txt = await evl(`document.getElementById('liveText').textContent`);
  if (txt.includes('已连接')) { connected = true; break; }
  await wait(500);
}
check('接单台已连接 MQTT', connected, await evl(`document.getElementById('liveText').textContent`));

// Node 发布一条订单
const testOrder = {
  id: 'TEST' + Date.now(),
  table: 'C07',
  mode: '立即用餐',
  items: [{ n: '麻婆豆腐', p: 0, q: 2 }, { n: '米饭', p: 0, q: 2 }],
  count: 4,
  total: 0,
  remark: '少油、多放蒜',
  date: new Date().toISOString().slice(0, 10),
  time: new Date().toTimeString().slice(0, 8),
  ts: Date.now()
};
await new Promise((resolve) => {
  const pub = new MQTTWS.Client({
    url: BROKER,
    clientId: 'zishun-test-pub-' + Math.random().toString(16).slice(2, 10),
    onOpen() { pub.publish(TOPIC, JSON.stringify(testOrder)); setTimeout(() => { pub.disconnect(); resolve(); }, 400); },
    onError() { resolve(); }
  });
  pub.connect();
});
await wait(2500);

const got = await evl(`(function(){
  var o = document.querySelector('.order');
  return {
    cards: document.querySelectorAll('.order').length,
    pending: document.getElementById('sPending').textContent,
    table: o ? o.querySelector('.order__table').textContent : null,
    remark: o ? (o.querySelector('.remark') || {}).innerText : null,
    items: o ? Array.from(o.querySelectorAll('.item')).map(function(i){return i.innerText.replace(/\\n/g,' ');}) : [],
    badge: o ? o.querySelector('.order__badge').textContent : null
  };
})()`);
check('接单台显示订单卡片', got.cards >= 1, got.cards);
check('桌号 C07 正确显示', got.table && got.table.includes('C07'), got.table);
check('备注显示正确', got.remark && got.remark.includes('少油'), got.remark);
check('菜品显示正确', got.items.length === 2, got.items);
check('状态为待处理', got.badge === '待处理', got.badge);
console.log('  接单台显示: ' + JSON.stringify({ table: got.table, items: got.items, remark: got.remark }));

/* ============================================================
   测试 C：状态流转
   ============================================================ */
console.log('\n===== C. 接单台状态流转 =====');
await evl(`document.querySelector('.order button[data-act="cooking"]').click()`);
await wait(600);
const afterCook = await evl(`(function(){
  var o = document.querySelector('.order');
  return { badge: o.querySelector('.order__badge').textContent, pending: document.getElementById('sPending').textContent, cooking: document.getElementById('sCooking').textContent };
})()`);
check('流转为制作中', afterCook.badge === '制作中', afterCook);
check('待处理归零', afterCook.pending === '0', afterCook.pending);
check('制作中 = 1', afterCook.cooking === '1', afterCook.cooking);

await evl(`document.querySelector('.order button[data-act="done"]').click()`);
await wait(600);
const afterDone = await evl(`document.getElementById('sDone').textContent`);
check('流转为已完成', afterDone === '1', afterDone);

check('全程无 JS 异常', exceptions.length === 0, exceptions.slice(0, 3));

console.log('\n结果: 通过 ' + pass + ' / ' + (pass + fail) + (fail ? '  ✗ 有失败' : '  ✓ 全部通过'));

try { subClient.disconnect(); } catch (e) {}
ws.close(); child.kill(); server.close();
await wait(500);
try { fs.rmSync(USER_DIR, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
