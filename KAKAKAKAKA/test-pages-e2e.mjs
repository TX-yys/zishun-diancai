/**
 * 验证 GitHub Pages 发布目录（docs/）里的页面可用：
 *   - 入口页跳转逻辑
 *   - 顾客点菜页下单（真实公共 MQTT）
 *   - 接单台收单
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import MQTTWS from './mqtt-client.js';

const APP_PORT = 8311;
const CDP_PORT = 10022;
const BASE = 'http://127.0.0.1:' + APP_PORT;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const USER_DIR = path.join(os.tmpdir(), 'dsh-pages-' + Date.now());
const CHANNEL = 'PAGES' + Math.random().toString(36).slice(2, 6).toUpperCase();
const NS = 'zishun/diancai/v1/';
const TOPIC = NS + CHANNEL + '/orders';
const BROKER = 'wss://broker.emqx.io:8084/mqtt';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (url) => new Promise((res, rej) => {
  http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 220) : '')); } };

/* 模拟 GitHub Pages：把 docs/ 当根目录提供 */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/' || p === '') p = '/index.html';
  const full = path.join(process.cwd(), 'docs', p.replace(/^\/+/, ''));
  if (!full.startsWith(path.join(process.cwd(), 'docs')) || !fs.existsSync(full)) {
    res.writeHead(404); return res.end('404');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(fs.readFileSync(full));
});
await new Promise((r) => server.listen(APP_PORT, '127.0.0.1', r));
console.log('模拟 GitHub Pages 根目录: ' + BASE);
console.log('频道码: ' + CHANNEL);
console.log('');

const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + USER_DIR, '--window-size=420,900', 'about:blank'],
  { stdio: 'ignore' });

let wsUrl = null;
for (let i = 0; i < 40; i++) {
  await wait(400);
  try { const v = await getJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); if (v.webSocketDebuggerUrl) { wsUrl = v.webSocketDebuggerUrl; break; } } catch (e) {}
}
if (!wsUrl) { console.log('✗ CDP 失败'); child.kill(); server.close(); process.exit(1); }

const ws = new WebSocket(wsUrl);
const on = (ev, fn) => ws.addEventListener(ev, fn);
let id = 0; const pending = new Map(); const exceptions = [];
on('message', (e) => {
  const m = JSON.parse(e.data.toString());
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id); pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  } else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    exceptions.push(((d.exception && d.exception.description) || d.text || '').split('\n')[0]);
  }
});
const send = (m, p, s) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: mid, method: m, params: p || {}, sessionId: s })); });
await new Promise((r) => on('open', r));

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: true }, sessionId);

const evl = async (expr, awaitP) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitP }, sessionId);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 250));
  return r.result.value;
};
const nav = async (url) => {
  await send('Page.navigate', { url }, sessionId);
  for (let i = 0; i < 60; i++) { await wait(300); if (await evl('document.readyState') === 'complete') break; }
  await wait(1000);
};

/* ---- A. 入口页 ---- */
console.log('===== A. 入口页 =====');
await nav(BASE + '/');
const home = await evl(`(function(){ return { title: document.title, hasBtn: !!document.getElementById('go'), body: document.body.innerText.slice(0,60) }; })()`);
check('入口页正常显示', home.title.includes('志顺小馆'), home);

await nav(BASE + '/?t=A14&c=' + CHANNEL);
await wait(1500);
const jumped = await evl(`(function(){ return { url: location.pathname + location.search, dishes: document.querySelectorAll('.dish').length }; })()`);
check('带 ?t= 时自动跳到点菜页', jumped.url.includes('page-order.html'), jumped.url);
check('点菜页渲染正常', jumped.dishes > 0, jumped.dishes);

/* ---- B. 下单 ---- */
console.log('\n===== B. 点菜页下单（docs/ 版本）=====');
const received = [];
let sub = null;
await new Promise((resolve) => {
  sub = new MQTTWS.Client({
    url: BROKER,
    clientId: 'pages-sub-' + Math.random().toString(16).slice(2, 8),
    onOpen() { sub.subscribe(TOPIC); resolve(); },
    onMessage(t, p) { if (t === TOPIC) { try { received.push(JSON.parse(p)); } catch (e) {} } },
    onError() { resolve(); }
  });
  sub.connect();
  setTimeout(resolve, 8000);
});
console.log('  （已订阅 ' + TOPIC + '）');

await nav(BASE + '/page-order.html?t=B02&c=' + CHANNEL);
const info = await evl(`(function(){
  var cards = document.querySelectorAll('.dish');
  cards[0].querySelector('.btn-add').click();
  cards[1].querySelector('.btn-add').click();
  document.getElementById('btnGo').click();
  document.getElementById('remarkRow').click();
  var b = document.querySelector('.rmk-tag[data-tag="不要辣"]');
  if (b) b.click();
  document.getElementById('rmkOk').click();
  return {
    table: document.querySelector('.addr .l1').textContent,
    num: document.getElementById('cartNum').textContent,
    remark: document.getElementById('remarkShow').textContent
  };
})()`);
check('桌号 B02 正确', info.table.includes('B02'), info.table);
check('购物车 2 件', info.num === '2', info.num);
check('备注已填', info.remark.includes('不要辣'), info.remark);

await evl(`document.getElementById('btnPay').click()`);
for (let i = 0; i < 24 && !received.length; i++) await wait(500);
check('公共通道收到订单', received.length >= 1, received.length);
if (received.length) {
  const o = received[0];
  check('桌号正确', o.table === 'B02', o.table);
  check('备注完整', (o.remark || '').includes('不要辣'), o.remark);
  check('订单号存在', !!o.id || !!o.no, { id: o.id, no: o.no });
  console.log('  收到: ' + JSON.stringify({ id: o.id || o.no, table: o.table, count: o.count, remark: o.remark }));
}

/* ---- C. 接单台 ---- */
console.log('\n===== C. 接单台（docs/ 版本）=====');
await nav(BASE + '/admin-static.html?c=' + CHANNEL);
let connected = false;
for (let i = 0; i < 24; i++) {
  const t = await evl(`document.getElementById('liveText').textContent`);
  if (t.includes('已连接')) { connected = true; break; }
  await wait(500);
}
check('接单台已连接', connected, await evl(`document.getElementById('liveText').textContent`));

const testOrder = {
  id: 'PG' + Date.now(), table: 'C11', mode: '立即用餐',
  items: [{ n: '宫保鸡丁', p: 0, q: 1 }, { n: '米饭', p: 0, q: 2 }],
  count: 3, total: 0, remark: '少油、多放蒜',
  date: new Date().toISOString().slice(0, 10), time: new Date().toTimeString().slice(0, 8), ts: Date.now()
};
await new Promise((resolve) => {
  const pub = new MQTTWS.Client({
    url: BROKER,
    clientId: 'pages-pub-' + Math.random().toString(16).slice(2, 8),
    onOpen() { pub.publish(TOPIC, JSON.stringify(testOrder)); setTimeout(() => { pub.disconnect(); resolve(); }, 400); },
    onError() { resolve(); }
  });
  pub.connect();
  setTimeout(resolve, 8000);
});
await wait(2500);
const adm = await evl(`(function(){
  var o = document.querySelector('.order');
  return {
    cards: document.querySelectorAll('.order').length,
    table: o ? o.querySelector('.order__table').textContent : null,
    remark: o ? (o.querySelector('.remark') || {}).innerText : null,
    badge: o ? o.querySelector('.order__badge').textContent : null
  };
})()`);
check('接单台显示订单', adm.cards >= 1, adm.cards);
check('桌号 C11 正确', adm.table && adm.table.includes('C11'), adm.table);
check('备注显示', adm.remark && adm.remark.includes('少油'), adm.remark);

check('无 JS 异常', exceptions.length === 0, exceptions.slice(0, 3));

console.log('\n结果: 通过 ' + pass + ' / ' + (pass + fail) + (fail ? '  ✗' : '  ✓ 全部通过'));
try { sub.disconnect(); } catch (e) {}
ws.close(); child.kill(); server.close();
await wait(400);
try { fs.rmSync(USER_DIR, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
