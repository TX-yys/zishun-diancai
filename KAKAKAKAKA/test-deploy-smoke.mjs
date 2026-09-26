/**
 * 针对「即将部署到 Render 的 server.js」做端到端冒烟测试
 * 覆盖：点菜页 → 备注 → 下单 → 接单台 → 状态流转 → 二维码页
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const APP_PORT = 8231;
const CDP_PORT = 9933;
const BASE = 'http://127.0.0.1:' + APP_PORT;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const USER_DIR = path.join(os.tmpdir(), 'dsh-smoke-' + Date.now());
const ADMIN_TOKEN = 'smoketest';

/* ---------- 1. 启动待部署的服务（模拟 Render：PORT + ADMIN_TOKEN + DATA_DIR） ---------- */
const dataDir = path.join(os.tmpdir(), 'dsh-smoke-data-' + Date.now());
const srv = spawn(process.execPath, [path.join(process.cwd(), 'server.js')], {
  env: { ...process.env, PORT: String(APP_PORT), ADMIN_TOKEN, DATA_DIR: dataDir },
  stdio: 'ignore'
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (url) => new Promise((res, rej) => {
  http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 220) : '')); }
}

/* 等服务就绪 */
let ready = false;
for (let i = 0; i < 30; i++) {
  await wait(500);
  try { const h = await getJSON(BASE + '/api/health'); if (h.ok) { ready = true; break; } } catch (e) {}
}
if (!ready) { console.log('✗ 服务未启动'); srv.kill(); process.exit(1); }
console.log('待部署服务已就绪: ' + BASE + '（模拟 Render 环境）\n');

/* ---------- 2. 接口层检查 ---------- */
console.log('===== 接口层 =====');
{
  const h = await getJSON(BASE + '/api/health');
  check('健康检查 200 且含店名', h.ok && h.shop === '志顺小馆（小仝宝店）', h.shop);

  const menu = await getJSON(BASE + '/api/menu');
  check('菜单可下发', menu.ok === true);

  const res = await fetch(BASE + '/admin');
  check('无口令访问后台被拦截 (401)', res.status === 401, res.status);

  const qr = await fetch(BASE + '/qr');
  const html = await qr.text();
  check('二维码页可访问', qr.status === 200 && html.includes('<svg'), qr.status);
}

/* ---------- 3. 浏览器端到端 ---------- */
console.log('\n===== 浏览器真实流程 =====');
const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + USER_DIR, '--window-size=420,900', 'about:blank'],
  { stdio: 'ignore' });

let wsUrl = null;
for (let i = 0; i < 40; i++) {
  await wait(400);
  try { const v = await getJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); if (v.webSocketDebuggerUrl) { wsUrl = v.webSocketDebuggerUrl; break; } } catch (e) {}
}
if (!wsUrl) { console.log('✗ CDP 连接失败'); child.kill(); srv.kill(); process.exit(1); }

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
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
};
const nav = async (url) => {
  await send('Page.navigate', { url }, sessionId);
  for (let i = 0; i < 60; i++) { await wait(300); if (await evl('document.readyState') === 'complete') break; }
  await wait(800);
};

await nav(BASE + '/');
const info = await evl(`(function(){
  return {
    shop: document.querySelector('.shop__name span').textContent,
    dishes: document.querySelectorAll('.dish').length,
    price: document.querySelector('.dish .price').innerText.replace(/\\n/g,' ')
  };
})()`);
check('点菜页店名正确', info.shop === '志顺小馆（小仝宝店）', info.shop);
check('菜品已渲染', info.dishes > 0, info.dishes);
check('价格显示 0 元', info.price.includes('0 元'), info.price);

const cart = await evl(`(function(){
  var cards = document.querySelectorAll('.dish');
  cards[0].querySelector('.btn-add').click();
  cards[0].querySelector('.btn-add').click();
  document.getElementById('btnGo').click();
  document.getElementById('remarkRow').click();
  ['不要辣','多份餐具'].forEach(function(t){
    var b = document.querySelector('.rmk-tag[data-tag="'+t+'"]');
    if (b) b.click();
  });
  document.getElementById('rmkText').value = '主食最后上';
  document.getElementById('rmkOk').click();
  return {
    num: document.getElementById('cartNum').textContent,
    remark: document.getElementById('remarkShow').textContent,
    table: document.querySelector('.addr .l1').textContent,
    address: document.querySelector('.addr .l2').textContent,
    discount: (function(){
      var rows = document.querySelectorAll('.card__row');
      for (var i=0;i<rows.length;i++) if (rows[i].querySelector('.k') && rows[i].querySelector('.k').textContent==='优惠')
        return rows[i].querySelector('.v').textContent;
      return null;
    })()
  };
})()`);
check('购物车 2 件', cart.num === '2', cart.num);
check('备注已写入', cart.remark.includes('不要辣') && cart.remark.includes('主食最后上'), cart.remark);
check('桌号 A14', cart.table.includes('A14'), cart.table);
check('地址正确', cart.address.includes('天南海北路520仝宝广场-13分店'), cart.address);
check('优惠文案正确', cart.discount === '已享「满 1314 减 0」', cart.discount);

await evl(`document.getElementById('btnPay').click()`);
await wait(2500);
const done = await evl(`document.getElementById('doneCard').innerText.replace(/\\n/g,' | ')`);
check('下单成功并显示备注', done.includes('订单号') && done.includes('不要辣'), done);
check('接单状态正常', done.includes('已发送到后厨') || done.includes('后台未连接'), done);

await nav(BASE + '/admin?token=' + ADMIN_TOKEN);
await wait(1500);
const adm = await evl(`(function(){
  var o = document.querySelector('.order');
  return {
    cards: document.querySelectorAll('.order').length,
    pending: document.getElementById('sPending').textContent,
    table: o ? o.querySelector('.order__table').textContent : null,
    remark: o ? o.querySelector('.remark').innerText : null,
    hasCooking: !!document.querySelector('.order button[data-act="cooking"]')
  };
})()`);
check('接单台收到订单', adm.cards === 1, adm.cards);
check('待处理计数为 1', adm.pending === '1', adm.pending);
check('桌号带到后台', adm.table && adm.table.includes('A14'), adm.table);
check('备注带到后台', adm.remark && adm.remark.includes('不要辣') && adm.remark.includes('主食最后上'), adm.remark);
check('有「开始制作」按钮', adm.hasCooking === true);

await evl(`document.querySelector('.order button[data-act="cooking"]').click()`);
await wait(1800);
const after = await evl(`(function(){
  var o = document.querySelector('.order');
  return { badge: o.querySelector('.order__badge').textContent, pending: document.getElementById('sPending').textContent };
})()`);
check('状态流转为制作中', after.badge === '制作中', after);
check('待处理归零', after.pending === '0', after.pending);

check('全程无 JS 异常', exceptions.length === 0, exceptions.slice(0, 3));

/* ---------- 4. 清理 ---------- */
console.log('\n结果: 通过 ' + pass + ' / ' + (pass + fail) + (fail ? '  ✗ 存在失败' : '  ✓ 全部通过'));
ws.close(); child.kill(); srv.kill();
await wait(400);
try { fs.rmSync(USER_DIR, { recursive: true, force: true }); } catch (e) {}
try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
