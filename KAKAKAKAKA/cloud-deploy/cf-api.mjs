/**
 * Cloudflare 部署助手（零依赖，只用 Node 内置 fetch / FormData / Blob）
 *
 *   node cf-api.mjs verify <token>
 *   node cf-api.mjs deploy <token> <adminToken>
 *
 * 输出（deploy）：KV=... / URL=... / ADMIN=...
 */
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://api.cloudflare.com/client/v4';
const WORKER_NAME = 'zishun-diancai';
const KV_TITLE = 'zishun-orders';

function die(msg, extra) {
  console.error(msg + (extra ? '\n' + JSON.stringify(extra).slice(0, 600) : ''));
  process.exit(1);
}

async function cf(pathname, token, init) {
  const res = await fetch(API + pathname, {
    ...init,
    headers: {
      'Authorization': 'Bearer ' + token,
      ...(init && init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...((init && init.headers) || {})
    }
  });
  const text = await res.text();
  let j;
  try { j = JSON.parse(text); } catch (e) { die('Cloudflare 返回非 JSON（HTTP ' + res.status + '）', text.slice(0, 300)); }
  return { status: res.status, body: j };
}

/* ---------------- verify ---------------- */
async function verify(token) {
  const r = await cf('/user/tokens/verify', token);
  if (!r.body.success) die('Token 校验失败', r.body.errors);
  // 顺便取账号名，便于确认
  const acc = await cf('/accounts', token);
  const name = (acc.body.result && acc.body.result[0] && acc.body.result[0].name) || 'unknown';
  console.log(name);
}

/* ---------------- deploy ---------------- */
async function deploy(token, adminToken) {
  // 1. 取账号
  const acc = await cf('/accounts', token);
  if (!acc.body.success || !acc.body.result.length) die('读不到账号，Token 权限可能不足（需要 Account Settings: Read）', acc.body.errors);
  const accountId = acc.body.result[0].id;
  const accountName = acc.body.result[0].name;

  // 2. 找或建 KV 命名空间
  let kvId = null;
  const list = await cf('/accounts/' + accountId + '/storage/kv/namespaces?per_page=100', token);
  if (list.body.success) {
    const hit = list.body.result.find((n) => n.title === KV_TITLE);
    if (hit) kvId = hit.id;
  }
  if (!kvId) {
    const created = await cf('/accounts/' + accountId + '/storage/kv/namespaces', token, {
      method: 'POST',
      body: JSON.stringify({ title: KV_TITLE })
    });
    if (!created.body.success) die('创建 KV 命名空间失败（需要 Workers KV Storage: Edit）', created.body.errors);
    kvId = created.body.result.id;
  }

  // 3. 上传 Worker（multipart：metadata + 脚本）
  const scriptPath = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'worker.js');
  const scriptSrc = fs.readFileSync(scriptPath);
  const metadata = {
    main_module: 'worker.js',
    compatibility_date: '2025-01-01',
    bindings: [
      { type: 'kv_namespace', name: 'ORDERS', namespace_id: kvId },
      { type: 'plain_text', name: 'ADMIN_TOKEN', text: adminToken || '' }
    ]
  };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('worker.js', new Blob([scriptSrc], { type: 'application/javascript+module' }), 'worker.js');

  const up = await cf('/accounts/' + accountId + '/workers/scripts/' + WORKER_NAME, token, {
    method: 'PUT',
    body: form
  });
  if (!up.body.success) die('上传 Worker 失败', up.body.errors);

  // 4. 开启 workers.dev 子域
  const sub = await cf('/accounts/' + accountId + '/workers/subdomain', token);
  let subdomain = sub.body && sub.body.result && sub.body.result.subdomain;
  if (!subdomain) {
    // 需要用户设置过一次子域；尝试自动创建
    const name = 'zishun-' + Math.random().toString(36).slice(2, 7);
    const made = await cf('/accounts/' + accountId + '/workers/subdomain', token, {
      method: 'PUT', body: JSON.stringify({ subdomain: name })
    });
    subdomain = made.body && made.body.result && made.body.result.subdomain;
  }
  if (!subdomain) die('无法开启 workers.dev 子域，请在 Cloudflare 后台手动开启后重试', sub.body && sub.body.errors);

  // 5. 开启该 Worker 的 workers.dev 访问
  const en = await cf('/accounts/' + accountId + '/workers/scripts/' + WORKER_NAME + '/subdomain', token, {
    method: 'POST', body: JSON.stringify({ enabled: true, previews_enabled: false })
  });
  if (!en.body.success) die('开启 workers.dev 路由失败', en.body.errors);

  const url = 'https://' + WORKER_NAME + '.' + subdomain + '.workers.dev/';
  const adminUrl = url + 'admin' + (adminToken ? '?token=' + encodeURIComponent(adminToken) : '');

  console.log('ACCOUNT=' + accountName);
  console.log('KV=' + kvId);
  console.log('URL=' + url);
  console.log('ADMIN=' + adminUrl);
}

/* ---------------- 构造上传元数据（独立函数，便于 dry-run 校验） ---------------- */
function buildMetadata(kvId, adminToken) {
  return {
    main_module: 'worker.js',
    compatibility_date: '2025-01-01',
    bindings: [
      { type: 'kv_namespace', name: 'ORDERS', namespace_id: kvId },
      { type: 'plain_text', name: 'ADMIN_TOKEN', text: adminToken || '' }
    ]
  };
}
function workerScriptPath() {
  let p = new URL(import.meta.url).pathname;
  p = decodeURIComponent(p).replace(/^\/([A-Za-z]:)/, '$1');
  return path.join(path.dirname(p), 'worker.js');
}

/* ---------------- dry-run：本地校验上传载荷，不调用任何 API ---------------- */
async function dryRun(adminToken) {
  const scriptPath = workerScriptPath();
  if (!fs.existsSync(scriptPath)) die('缺少 worker.js：' + scriptPath + '\n请先运行 node build-cloud.js 并把 worker.js 复制到 cloud-deploy/');
  const src = fs.readFileSync(scriptPath);
  const meta = buildMetadata('dry-run-kv-id', adminToken || 'demo-token');
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('worker.js', new Blob([src], { type: 'application/javascript+module' }), 'worker.js');

  console.log('DRY_RUN_OK');
  console.log('  worker.js 路径 : ' + scriptPath);
  console.log('  worker.js 大小 : ' + src.length + ' bytes');
  console.log('  multipart 字段 : ' + Array.from(form.keys()).join(', '));
  console.log('  上传元数据     : ' + JSON.stringify(meta));
  // 基本健全性检查
  const problems = [];
  if (!meta.main_module.endsWith('.js')) problems.push('main_module 应以 .js 结尾');
  if (!meta.bindings.some((b) => b.type === 'kv_namespace' && b.name === 'ORDERS')) problems.push('缺少 ORDERS 的 kv_namespace 绑定');
  if (!meta.bindings.some((b) => b.name === 'ADMIN_TOKEN')) problems.push('缺少 ADMIN_TOKEN 绑定');
  if (src.length < 10000) problems.push('worker.js 过小，可能未构建');
  if (problems.length) die('  ✗ 校验未通过: ' + problems.join('；'));
  console.log('  ✓ 载荷校验通过');
}

/* ---------------- main ---------------- */
const [cmd, token, adminToken] = process.argv.slice(2);
if (!cmd) die('用法: node cf-api.mjs verify|deploy|dry-run <token> [adminToken]');

if (cmd === 'dry-run') await dryRun(adminToken);
else if (!token) die('缺少 token');
else if (cmd === 'verify') await verify(token);
else if (cmd === 'deploy') await deploy(token, adminToken);
else die('未知命令: ' + cmd);
