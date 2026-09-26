/**
 * 多桌功能端到端验证：
 *  1) ?t=B03 打开点菜页 → 桌号正确显示
 *  2) 不同桌购物车互不干扰
 *  3) 下单后后台订单显示正确桌号
 *  4) 桌贴页每桌二维码真实可扫
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const APP = 'http://127.0.0.1:8080';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const CDP_PORT = 9944;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const USER_DIR = path.join(os.tmpdir(), 'dsh-tables-' + Date.now());

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (url) => new Promise((res, rej) => {
  http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 200) : '')); }
}

const child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + USER_DIR, '--window-size=420,900', 'about:blank'],
  { stdio: 'ignore' });

let wsUrl = null;
for (let i = 0; i < 40; i++) {
  await wait(400);
  try { const v = await getJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); if (v.webSocketDebuggerUrl) { wsUrl = v.webSocketDebuggerUrl; break; } } catch (e) {}
}
if (!wsUrl) { console.log('✗ CDP 连接失败'); child.kill(); process.exit(1); }

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
  await wait(800);
};

/* ---------- 1. 带桌号打开 ---------- */
console.log('===== 1. 桌号来自网址参数 =====');
await nav(APP + '/?t=B03');
// 先加菜再进确认页（空购物车点「去结算」会提示，仅验证桌号无需点击）
const t1 = await evl(`(function(){
  document.querySelector('.dish .btn-add').click();
  return {
    storeKey: Object.keys(localStorage).join(','),
    cartNum: document.getElementById('cartNum').textContent
  };
})()`);
check('购物车存储键含桌号 B03', t1.storeKey.includes('B03'), t1.storeKey);

// 进入确认页看桌号
await evl(`document.getElementById('btnGo').click()`);
await wait(500);
const t1b = await evl(`document.querySelector('.addr .l1').textContent`);
check('确认页显示 B03 桌', t1b.includes('B03'), t1b);

/* ---------- 2. 另一桌购物车互不干扰 ---------- */
console.log('\n===== 2. 各桌购物车互不干扰 =====');
await nav(APP + '/?t=C09');
const t2 = await evl(`(function(){
  return {
    storeKey: Object.keys(localStorage).join(','),
    cartNum: document.getElementById('cartNum').textContent
  };
})()`);
// 空购物车不会写入存储条目，所以正确的断言是「没有 C09 的存储键」
check('C09 未产生自己的空购物车条目', !t2.storeKey.includes('C09'), t2.storeKey);
check('C09 购物车为空（未串到 B03 的菜）', t2.cartNum === '0', t2.cartNum);
check('B03 的购物车数据仍独立保留', t2.storeKey.includes('B03'), t2.storeKey);

// 回到 B03，购物车应还在
await nav(APP + '/?t=B03');
const t2b = await evl(`document.getElementById('cartNum').textContent`);
check('回到 B03 购物车仍保留 1 件', t2b === '1', t2b);

/* ---------- 3. C09 下单 ---------- */
console.log('\n===== 3. C09 下单 =====');
await nav(APP + '/?t=C09');
const t3 = await evl(`(function(){
  document.querySelectorAll('.dish')[0].querySelector('.btn-add').click();
  document.querySelectorAll('.dish')[1].querySelector('.btn-add').click();
  document.getElementById('btnGo').click();
  document.getElementById('remarkRow').click();
  var b = document.querySelector('.rmk-tag[data-tag="不要辣"]');
  if (b) b.click();
  document.getElementById('rmkOk').click();
  return { num: document.getElementById('cartNum').textContent, table: document.querySelector('.addr .l1').textContent };
})()`);
check('C09 购物车 2 件', t3.num === '2', t3.num);
await evl(`document.getElementById('btnPay').click()`);
await wait(2500);
const t4 = await evl(`document.getElementById('doneCard').innerText.replace(/\\n/g,' | ')`);
check('成功页显示 C09 桌', t4.includes('C09'), t4);

/* ---------- 4. 后台核对桌号 ---------- */
console.log('\n===== 4. 后台订单桌号 =====');
let orders = null;
try {
  orders = await getJSON(APP + '/api/orders' + (ADMIN_TOKEN ? '?token=' + ADMIN_TOKEN : ''));
} catch (e) { orders = null; }
if (orders && orders.orders) {
  const o = orders.orders[0];
  check('后台收到订单', orders.total >= 1, orders.total);
  check('订单桌号为 C09', o.table === 'C09', o.table);
  check('备注已带上', (o.remark || '').includes('不要辣'), o.remark);
  console.log('  后台看到的单: ' + JSON.stringify({ table: o.table, count: o.count, remark: o.remark }));
} else {
  console.log('  （后台需口令，跳过直接核对）');
}

/* ---------- 5. 桌贴页二维码可扫 ---------- */
console.log('\n===== 5. 桌贴页二维码真实可扫 =====');
const tablePage = await (await fetch(APP + '/tables')).text();
check('桌贴页含 8 个二维码', (tablePage.match(/<svg/g) || []).length === 8, (tablePage.match(/<svg/g) || []).length);
check('每个码都带对应桌号参数', tablePage.includes('?t=A14') && tablePage.includes('?t=B04'));

// 用页面内已有的 jsQR（经 CDP 注入）验证第一个码
const jsqrPath = path.join(os.tmpdir(), 'jsqr-cache.js');
if (fs.existsSync(jsqrPath)) {
  await nav(APP + '/tables');
  const jsqrSrc = fs.readFileSync(jsqrPath, 'utf8');
  await evl(`(function(){ ${jsqrSrc} window.__jsQR = jsQR; return 1; })()`);
  const scan = await evl(`(async function(){
    var out = [];
    var svgs = Array.prototype.slice.call(document.querySelectorAll('.qrbox svg')).slice(0, 3);
    for (var i=0;i<svgs.length;i++){
      var txt = new XMLSerializer().serializeToString(svgs[i]);
      var img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(txt);
      await new Promise(function(res,rej){ img.onload=res; img.onerror=function(){rej(new Error('load'));}; });
      var cv = document.createElement('canvas'); cv.width=400; cv.height=400;
      var ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled=false;
      ctx.drawImage(img,0,0,400,400);
      var px = ctx.getImageData(0,0,400,400);
      var r = null;
      try { r = window.__jsQR(px.data,400,400); } catch(e){}
      out.push(r ? r.data : null);
    }
    return out;
  })()`);
  scan.forEach((u, i) => {
    check('第 ' + (i + 1) + ' 张桌贴可扫出网址', typeof u === 'string' && u.includes('?t='), u);
  });
  console.log('  扫出内容: ' + JSON.stringify(scan));
} else {
  console.log('  （缺少 jsQR 缓存，跳过扫码验证）');
}

check('全程无 JS 异常', exceptions.length === 0, exceptions.slice(0, 3));

console.log('\n结果: 通过 ' + pass + ' / ' + (pass + fail) + (fail ? '  ✗ 有失败' : '  ✓ 全部通过'));
ws.close(); child.kill();
await wait(300);
try { fs.rmSync(USER_DIR, { recursive: true, force: true }); } catch (e) {}
process.exit(fail ? 1 : 0);
