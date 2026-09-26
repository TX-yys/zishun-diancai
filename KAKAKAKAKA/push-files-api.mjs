/**
 * 用 GitHub Contents API 逐文件推送（不需要 git，也不依赖仓库初始化时序）
 *
 * 用法：
 *   node push-files-api.mjs dry-run
 *   node push-files-api.mjs <owner>/<repo> <token> [public|private]
 */
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://api.github.com';

/* ---------- 要上传的文件 ---------- */
const FILES = [
  'index.html',
  'admin.html',
  'server.js',
  'qr.js',
  'qr-page.js',
  'mqtt-client.js',
  'build-static.js',
  'setup-shop.js',
  'package.json',
  'render.yaml',
  'README.md',
  '.gitignore',
  '.github/workflows/keep-alive.yml',
  'static/page-order.html',
  'static/admin-static.html',
  'data/menu.json',
  '启动点菜服务.bat',
  '停止服务.bat',
  '一键部署到公网.bat'
];

function headers(token) {
  return {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'zishun-deploy'
  };
}

async function gh(p, init, token) {
  const res = await fetch(API + p, {
    ...init,
    headers: { ...headers(token), ...((init && init.headers) || {}) }
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = { raw: text }; }
  return { status: res.status, ok: res.ok, body };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- dry-run ---------- */
function dryRun() {
  let total = 0;
  const missing = [];
  console.log('DRY_RUN_OK');
  for (const rel of FILES) {
    if (!fs.existsSync(rel)) { missing.push(rel); continue; }
    const size = fs.statSync(rel).size;
    total += size;
    console.log('    ✓ ' + rel.padEnd(40) + String(size).padStart(8) + ' bytes');
  }
  console.log('  合计 ' + total + ' bytes');
  if (missing.length) console.log('  ⚠ 不存在（跳过）: ' + missing.join(', '));
  const need = ['index.html', 'server.js', 'render.yaml', 'static/page-order.html'];
  const absent = need.filter((f) => !fs.existsSync(f));
  if (absent.length) { console.error('✗ 缺少必需文件: ' + absent.join(', ')); process.exit(1); }
  console.log('  ✓ 载荷校验通过');
}

const argv = process.argv.slice(2);
if (argv[0] === 'dry-run') { dryRun(); process.exit(0); }

const [repoArg, token, visArg] = argv;
if (!repoArg || !token) {
  console.error('用法: node push-files-api.mjs <owner>/<repo> <token> [public|private]');
  process.exit(1);
}
if (!/^[^/\s]+\/[^/\s]+$/.test(repoArg)) {
  console.error('✗ 仓库名格式必须是 owner/repo，收到: "' + repoArg + '"');
  process.exit(1);
}
const [owner, repo] = repoArg.split('/');
const visibility = (visArg || 'public').toLowerCase();

/* ---------- 1. 校验身份与目标 ---------- */
const me = await gh('/user', null, token);
if (!me.ok) { console.error('✗ 令牌无效'); process.exit(1); }
const login = me.body.login;
console.log('✓ 已认证：' + login);
if (owner !== login) console.log('  注意：目标所有者 ' + owner + ' 与登录用户 ' + login + ' 不同（组织仓库？）');

/* ---------- 2. 确保仓库存在 ---------- */
let repoRes = await gh('/repos/' + owner + '/' + repo, null, token);
if (!repoRes.ok) {
  console.log('· 仓库不存在，正在创建 ' + owner + '/' + repo + ' …');
  const created = await gh('/user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name: repo,
      private: visibility === 'private',
      auto_init: true,
      description: '志顺小馆（小仝宝店）· 在线点菜 + 接单后台'
    })
  }, token);
  if (!created.ok) {
    console.error('✗ 创建仓库失败: ' + JSON.stringify(created.body).slice(0, 300));
    process.exit(1);
  }
  console.log('✓ 仓库已创建');
  // 等 auto_init 的首个提交就绪
  for (let i = 0; i < 15; i++) {
    await wait(1000);
    const r = await gh('/repos/' + owner + '/' + repo + '/contents/README.md', null, token);
    if (r.ok) break;
  }
} else {
  console.log('✓ 仓库已存在');
}

/* ---------- 3. 逐文件上传 ---------- */
let okCount = 0, failCount = 0;
const failed = [];
for (const rel of FILES) {
  if (!fs.existsSync(rel)) { console.log('  · 跳过（不存在）: ' + rel); continue; }
  const target = rel.replace(/\\/g, '/');
  const content = fs.readFileSync(rel).toString('base64').replace(/[\r\n]/g, '');

  // 取当前 sha（更新用）
  let sha = null;
  const cur = await gh('/repos/' + owner + '/' + repo + '/contents/' + encodeURI(target), null, token);
  if (cur.ok && cur.body && cur.body.sha) sha = cur.body.sha;

  let put = await gh('/repos/' + owner + '/' + repo + '/contents/' + encodeURI(target), {
    method: 'PUT',
    body: JSON.stringify({
      message: (sha ? '更新 ' : '新增 ') + target,
      content,
      branch: 'main',
      ...(sha ? { sha } : {})
    })
  }, token);

  // 首次推送时 main 分支可能还不存在，重试几次
  if (!put.ok && /branch|reference|not found/i.test(JSON.stringify(put.body))) {
    for (let i = 0; i < 5 && !put.ok; i++) {
      await wait(1500);
      const again = await gh('/repos/' + owner + '/' + repo + '/contents/' + encodeURI(target), {
        method: 'PUT',
        body: JSON.stringify({ message: '新增 ' + target, content, branch: 'main' })
      }, token);
      if (again.ok) { put = again; break; }
    }
  }

  if (put.ok) {
    okCount++;
    console.log('  ✓ ' + target);
  } else {
    failCount++;
    failed.push({ file: target, err: JSON.stringify(put.body).slice(0, 200) });
    console.log('  ✗ ' + target + '  → ' + JSON.stringify(put.body).slice(0, 140));
  }
}

console.log('');
console.log('上传完成：成功 ' + okCount + ' 个，失败 ' + failCount + ' 个');
if (failed.length) {
  console.log('失败明细:');
  failed.forEach((f) => console.log('  ' + f.file + ': ' + f.err));
}
console.log('');
console.log('REPO_URL=https://github.com/' + owner + '/' + repo);
process.exit(failCount ? 1 : 0);
