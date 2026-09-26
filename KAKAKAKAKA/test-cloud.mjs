/**
 * 本地测试 Cloudflare Worker（模拟 env.ORDERS / env.ADMIN_TOKEN）
 * 覆盖：页面可访问、菜单、下单、口令校验、状态流转、清空
 */
import worker from './cloud/worker.js';

/* ---- 模拟 KV ---- */
class MockKV {
  constructor() { this.map = new Map(); }
  async get(k) { return this.map.has(k) ? this.map.get(k) : null; }
  async put(k, v) { this.map.set(k, v); }
  async delete(k) { this.map.delete(k); }
  async list(opts) {
    const prefix = (opts && opts.prefix) || '';
    const keys = Array.from(this.map.keys()).filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
    return { keys, list_complete: true, cursor: undefined };
  }
}

const env = { ORDERS: new MockKV(), ADMIN_TOKEN: 'test123' };
const ORIGIN = 'https://demo.workers.dev';

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + JSON.stringify(extra).slice(0, 220) : '')); }
}
async function req(path, opts) {
  const r = await worker.fetch(new Request(ORIGIN + path, opts), env);
  const ct = r.headers.get('Content-Type') || '';
  const body = ct.includes('json') ? await r.json() : await r.text();
  return { status: r.status, body, ct };
}

console.log('===== 1. 页面与静态资源 =====');
{
  const r = await req('/');
  check('GET / 返回 200 且是 HTML', r.status === 200 && r.ct.includes('html'), r.status);
  check('点菜页含店名', typeof r.body === 'string' && r.body.includes('志顺小馆（小仝宝店）'));
  check('点菜页含 0 元文案', typeof r.body === 'string' && r.body.includes('0 元'));

  const a = await req('/admin');
  check('GET /admin 无口令应 401', a.status === 401, a.status);
  const a2 = await req('/admin?token=test123');
  check('GET /admin 带口令 200', a2.status === 200, a2.status);
  check('接单台含店名', typeof a2.body === 'string' && a2.body.includes('志顺小馆（小仝宝店）'));

  const q = await req('/qr');
  check('GET /qr 返回 200', q.status === 200, q.status);
  check('QR 页含二维码 SVG', typeof q.body === 'string' && q.body.includes('<svg'));
  check('QR 页把口令打码', typeof q.body === 'string' && q.body.includes('token=***'));
  check('QR 页不含明文口令', typeof q.body === 'string' && !q.body.includes('token=test123'));
}

console.log('\n===== 2. 菜单接口 =====');
{
  const r = await req('/api/menu');
  check('GET /api/menu 200', r.status === 200);
  check('菜单非空', Array.isArray(r.body.menu) && r.body.menu.length > 0, r.body.menu && r.body.menu.length);
  check('菜单价格为 0', r.body.menu.every((g) => g.dishes.every((d) => d.p === 0)));
  const dishCount = r.body.menu.reduce((s, g) => s + g.dishes.length, 0);
  check('菜品数量 = 27', dishCount === 27, dishCount);
}

console.log('\n===== 3. 下单 =====');
let orderId = null;
{
  const bad = await req('/api/orders', { method: 'POST', body: JSON.stringify({ items: [] }) });
  check('空订单应 400', bad.status === 400, bad.status);

  const r = await req('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      table: 'A14', address: '天南海北路520仝宝广场-13分店', mode: '立即用餐',
      items: [{ n: '酸菜鱼（黑鱼）', p: 0, q: 2 }, { n: '米饭', p: 0, q: 3 }],
      total: 0, remark: '不要辣、不要香菜；老人小孩多'
    })
  });
  check('下单返回 201', r.status === 201, r.status);
  check('返回订单号', !!r.body.id, r.body);
  check('返回件数 = 5', r.body.count === 5, r.body.count);
  orderId = r.body.id;
}

console.log('\n===== 4. 取订单 / 口令校验 =====');
{
  const no = await req('/api/orders');
  check('无口令取单应 401', no.status === 401, no.status);
  const bad = await req('/api/orders?token=wrong');
  check('错误口令应 401', bad.status === 401, bad.status);

  const r = await req('/api/orders?token=test123');
  check('正确口令取单 200', r.status === 200, r.status);
  check('订单数 = 1', r.body.total === 1, r.body.total);
  const o = r.body.orders[0];
  check('桌号正确', o.table === 'A14', o.table);
  check('地址正确', o.address === '天南海北路520仝宝广场-13分店', o.address);
  check('备注正确', o.remark === '不要辣、不要香菜；老人小孩多', o.remark);
  check('状态为 pending', o.status === 'pending', o.status);
  check('菜品齐全', o.items.length === 2 && o.items[0].q === 2, o.items);
}

console.log('\n===== 5. 状态流转 / 改备注 =====');
{
  const r1 = await req('/api/orders/' + orderId + '?token=test123', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'cooking' })
  });
  check('改为制作中', r1.status === 200 && r1.body.order && r1.body.order.status === 'cooking', r1.body);

  const r2 = await req('/api/orders/' + orderId + '?token=test123', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remark: '已电话确认：微辣、加两份餐具' })
  });
  check('改备注成功', r2.body.order && r2.body.order.remark === '已电话确认：微辣、加两份餐具', r2.body);

  // 用请求头方式鉴权（接单台前端就是这种用法）
  const r2b = await req('/api/orders/' + orderId, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'test123' },
    body: JSON.stringify({ remark: '用请求头鉴权' })
  });
  check('请求头鉴权也可用', r2b.body.order && r2b.body.order.remark === '用请求头鉴权', r2b.body);

  const noAuth = await req('/api/orders/' + orderId, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'done' })
  });
  check('无口令改状态应 401', noAuth.status === 401, noAuth.status);

  const r3 = await req('/api/orders/' + orderId + '?token=test123', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'done' })
  });
  check('带口令改为已完成', r3.body.order.status === 'done', r3.body.order.status);
}

console.log('\n===== 6. 健康检查 / 清空 =====');
{
  const h = await req('/api/health');
  check('健康检查 200', h.status === 200);
  check('待处理归零（已全部完成）', h.body.pending === 0, h.body);

  const d = await req('/api/orders?scope=done&token=test123', { method: 'DELETE' });
  check('清空已处理', d.body.removed === 1, d.body);

  const after = await req('/api/orders?token=test123');
  check('清空后订单为 0', after.body.total === 0, after.body.total);
}

console.log('\n===== 7. 菜单接口与前端一致性 =====');
{
  const r = await req('/api/menu');
  const flat = [];
  r.body.menu.forEach((g) => g.dishes.forEach((d) => flat.push(d.n)));
  check('包含「酸菜鱼（黑鱼）」', flat.includes('酸菜鱼（黑鱼）'));
  check('包含「米饭」', flat.includes('米饭'));
  check('全部 27 道菜无重复', new Set(flat).size === flat.length, flat.length);
  const zero = r.body.menu.every((g) => g.dishes.every((d) => d.p === 0));
  check('云端菜单价格全 0', zero);
}

console.log('\n结果: 通过 ' + pass + ' / ' + (pass + fail) + (fail ? '  ✗ 存在失败' : '  ✓ 全部通过'));
process.exit(fail ? 1 : 0);
