/**
 * 云端版本地端到端测试：
 *   1) 启动一个本地服务，把请求交给 cloud/worker.js 处理（模拟 Cloudflare 环境）
 *   2) 用真实浏览器打开「点菜页」，走完整流程：点菜 → 备注 → 下单
 *   3) 打开「接单台」，确认收到订单、状态流转正常
 */
import worker from './cloud/worker.js';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/* ---------- 模拟 KV ---------- */
class MockKV {
  constructor() { this.map = new Map(); }
  async get(k) { return this.map.has(k) ? this.map.get(k) : null; }
  async put(k, v) { this.map.set(k, v); }
  async delete(k) { this.map.delete(k); }
  async list(o) {
    const p = (o && o.prefix) || '';
    return { keys: Array.from(this.map.keys()).filter((k) => k.startsWith(p)).map((name) => ({ name })), list_complete: true };
  }
}
const env = { ORDERS: new MockKV(), ADMIN_TOKEN: 'test123' };
const APP_PORT = 8199;
const CDP_PORT = 9911;
const BASE = 'http://127.0.0.1:' + APP_PORT;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

/* ---------- 1. 本地 worker 宿主 ---------- */
const server = http.createServer(async (req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const body = Buffer.concat(chunks);
    const init = { method: req.method, headers: req.headers };
    if (body.length && req.method !== 'GET' && req.method !== 'HEAD') init.body = body;
    try {
      const r = await worker.fetch(new Request(BASE + req.url, init), env);
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      res.writeHead(500); res.end('worker error: ' + e.message);
    }
  });
});
await new Promise((r) => server.listen(APP_PORT, '127.0.0.1', r));
console.log('本地 Worker 宿主已启动: ' + BASE);

/* ---------- 2. 浏览器 ---------- */
const USER_DIR = path.join(os.tmpdir(), 'dsh-cloud-e2e-' + Date.now());
const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + USER_DIR, '--window-size=420,900', 'about:blank'],
  { stdio: 'ignore' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (url) => new Promise((res, rej) => {
  http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 240) : '')); }
}

let wsUrl = null;
for (let i = 0; i < 40; i++) {
  await wait(400);
  try { const v = await getJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); if (v.webSocketDebuggerUrl) { wsUrl = v.webSocketDebuggerUrl; break; } } catch (e) {}
}
if (!wsUrl) { console.log('CDP_CONNECT_FAILED'); child.kill(); server.close(); process.exit(1); }

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
const send = (method, params, sessionId) => new Promise((resolve, reject) => {
  const mid = ++id; pending.set(mid, { resolve, reject });
  ws.send(JSON.stringify({ id: mid, method, params: params || {}, sessionId }));
});
await new Promise((r) => on('open', r));

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 2, mobile: true }, sessionId);

const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
};
const nav = async (url) => {
  await send('Page.navigate', { url }, sessionId);
  for (let i = 0; i < 60; i++) { await wait(300); if (await evl('document.readyState') === 'complete') break; }
  await wait(900);
};

/* ---------- 3. 顾客流程 ---------- */
console.log('\n===== A. 顾客点菜页（云端版） =====');
await nav(BASE + '/');
const shopInfo = await evl(`(function(){
  return {
    title: document.title,
    shop: document.querySelector('.shop__name span').textContent,
    dishCount: document.querySelectorAll('.dish').length,
    price: document.querySelector('.dish .price').innerText.replace(/\\n/g,' ')
  };
})()`);
check('标题为云端点菜页', shopInfo.title.includes('在线点菜'), shopInfo.title);
check('店名正确', shopInfo.shop === '志顺小馆（小仝宝店）', shopInfo.shop);
check('菜品已渲染', shopInfo.dishCount > 0, shopInfo.dishCount);
check('价格为 0 元', shopInfo.price.includes('0 元'), shopInfo.price);

console.log('\n===== B. 加菜 + 填备注 =====');
const cartInfo = await evl(`(function(){
  var cards = document.querySelectorAll('.dish');
  cards[0].querySelector('.btn-add').click();
  cards[0].querySelector('.btn-add').click();
  cards[1].querySelector('.btn-add').click();
  document.getElementById('btnGo').click();
  document.getElementById('remarkRow').click();
  ['不要辣','不要香菜','多份餐具'].forEach(function(t){
    var b = document.querySelector('.rmk-tag[data-tag="'+t+'"]');
    if (b) b.click();
  });
  document.getElementById('rmkText').value = '先上凉菜，主食最后上';
  document.getElementById('rmkOk').click();
  return {
    cartNum: document.getElementById('cartNum').textContent,
    sum: document.getElementById('sumBox').innerText.replace(/\\n/g,' | '),
    payBar: document.getElementById('payBarTotal').innerText.replace(/\\n/g,' '),
    remark: document.getElementById('remarkShow').textContent
  };
})()`);
check('购物车 3 件', cartInfo.cartNum === '3', cartInfo.cartNum);
check('费用全免费', cartInfo.sum.includes('0 元'), cartInfo.sum);
check('备注已写入', cartInfo.remark.includes('不要辣') && cartInfo.remark.includes('先上凉菜'), cartInfo.remark);

console.log('\n===== C. 提交订单到云端 =====');
await evl(`document.getElementById('btnPay').click()`);
await wait(2500);
const doneInfo = await evl(`(function(){
  return {
    card: document.getElementById('doneCard').innerText.replace(/\\n/g,' | '),
    toast: document.getElementById('toast').textContent,
    cart: document.getElementById('cartNum').textContent
  };
})()`);
check('下单成功页出现', doneInfo.card.includes('下单成功') || doneInfo.card.includes('订单号'), doneInfo.card);
check('显示已发送到后厨', doneInfo.card.includes('已发送到后厨'), doneInfo.card);
check('显示备注', doneInfo.card.includes('不要辣'), doneInfo.card);
check('购物车已清空', doneInfo.cart === '0', doneInfo.cart);
console.log('  下单小票: ' + doneInfo.card);

/* ---------- 4. 店员流程 ---------- */
console.log('\n===== D. 接单台（云端版） =====');
await nav(BASE + '/admin?token=test123');
await wait(1500);
const adminInfo = await evl(`(function(){
  var o = document.querySelector('.order');
  return {
    cards: document.querySelectorAll('.order').length,
    pending: document.getElementById('sPending').textContent,
    total: document.getElementById('sTotal').textContent,
    live: document.getElementById('liveText').textContent,
    table: o ? o.querySelector('.order__table').textContent : null,
    remark: o ? o.querySelector('.remark').innerText : null,
    items: o ? Array.from(o.querySelectorAll('.item')).map(function(i){return i.innerText.replace(/\\n/g,' ');}) : [],
    buttons: o ? Array.from(o.querySelectorAll('button[data-act]')).map(function(b){return b.textContent;}) : []
  };
})()`);
check('接单台显示订单卡片', adminInfo.cards === 1, adminInfo.cards);
check('待处理 = 1', adminInfo.pending === '1', adminInfo.pending);
check('显示云端同步', adminInfo.live.includes('云端同步'), adminInfo.live);
check('桌号正确', adminInfo.table && adminInfo.table.includes('A14'), adminInfo.table);
check('备注带到后台', adminInfo.remark && adminInfo.remark.includes('不要辣') && adminInfo.remark.includes('先上凉菜'), adminInfo.remark);
check('菜品显示', adminInfo.items.length === 2, adminInfo.items);
console.log('  后台看到: ' + JSON.stringify({ table: adminInfo.table, items: adminInfo.items, remark: adminInfo.remark }));

console.log('\n===== E. 后台流转状态 =====');
await evl(`document.querySelector('.order button[data-act="cooking"]').click()`);
await wait(1800);
const afterCook = await evl(`(function(){
  var o = document.querySelector('.order');
  return { badge: o.querySelector('.order__badge').textContent, pending: document.getElementById('sPending').textContent, cooking: document.getElementById('sCooking').textContent };
})()`);
check('状态变为制作中', afterCook.badge === '制作中', afterCook);
check('待处理归零', afterCook.pending === '0', afterCook.pending);
check('制作中 = 1', afterCook.cooking === '1', afterCook.cooking);

await evl(`document.querySelector('.order button[data-act="done"]').click()`);
await wait(1800);
const afterDone = await evl(`(function(){
  var o = document.querySelector('.order');
  return { badge: o ? o.querySelector('.order__badge').textContent : null, done: document.getElementById('sDone').textContent };
})()`);
check('状态变为已完成', afterDone.done === '1', afterDone);

console.log('\n===== F. 口令保护 =====');
await nav(BASE + '/admin');
const guard = await evl(`document.body.innerText.slice(0, 80)`);
check('无口令进入被拦截', guard.includes('需要口令'), guard);

console.log('\n===== G. 页面异常检查 =====');
check('无 JS 异常', exceptions.length === 0, exceptions.slice(0, 3));

console.log('\n结果: 通过 ' + pass + ' / ' + (pass + fail) + (fail ? '  ✗ 存在失败' : '  ✓ 全部通过'));

ws.close(); child.kill(); server.close();
await wait(400);
try { fs.rmSync(USER_DIR, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
