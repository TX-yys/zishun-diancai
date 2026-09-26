/**
 * 把项目推送到 GitHub（不需要安装 git，直接走 REST API）
 *
 * 用法：
 *   node push-github.mjs dry-run
 *       本地校验推送载荷（不需要令牌，用来确认一切就绪）
 *
 *   node push-github.mjs <PAT> [owner/repo] [public|private]
 *       真正推送。PAT 权限要求：
 *         Administration = Read and write（创建仓库）
 *         Contents       = Read and write（写入文件）
 *
 * 令牌获取：https://github.com/settings/tokens?type=beta
 */

/* ---------- 需要上传的文件（相对路径 → 仓库内路径） ---------- */
const FILES = [
  'index.html',
  'admin.html',
  'server.js',
  'qr.js',
  'qr-page.js',
  'package.json',
  'render.yaml',
  'README.md',
  '.gitignore',
  '.github/workflows/keep-alive.yml',
  'setup-shop.js',
  'mqtt-client.js',
  'build-static.js',
  'static/page-order.html',
  'static/admin-static.html',
  'data/menu.json',
  '启动点菜服务.bat',
  '停止服务.bat'
];

const API = 'https://api.github.com';

/** 请求头（延迟构造，因为令牌在运行时才解析） */
function headers(token) {
  return {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'zishun-deploy'
  };
}

async function gh(pathname, init, token) {
  const res = await fetch(API + pathname, {
    ...init,
    headers: { ...headers(token), ...((init && init.headers) || {}) }
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = { raw: text }; }
  return { status: res.status, ok: res.ok, body };
}

function fail(msg, body) {
  console.error('✗ ' + msg + (body ? '\n' + JSON.stringify(body).slice(0, 500) : ''));
  process.exit(1);
}

/* ---------- 独立的载荷构造（便于 dry-run 校验） ---------- */
async function buildTree() {
  const fs = await import('node:fs');
  const tree = [];
  const missing = [];
  for (const rel of FILES) {
    if (!fs.existsSync(rel)) { missing.push(rel); continue; }
    // 注意：GitHub 要求 base64 内不能有换行符，必须去掉
    const content = fs.readFileSync(rel).toString('base64').replace(/\n/g, '').replace(/\r/g, '');
    tree.push({ path: rel.replace(/\\/g, '/'), mode: '100644', type: 'blob', content });
  }
  return { tree, missing };
}

/* ---------- dry-run：本地校验推送载荷 ---------- */
async function dryRun() {
  const { tree, missing } = await buildTree();
  console.log('DRY_RUN_OK');
  console.log('  将上传 ' + tree.length + ' 个文件，合计 ' +
    tree.reduce((s, t) => s + t.content.length, 0) + ' 字符（base64）');
  const problems = [];
  for (const t of tree) {
    if (/[\r\n]/.test(t.content)) problems.push(t.path + ' 的 base64 含换行符（会导致上传失败）');
    // 校验 base64 可解码且解码结果非空
    const buf = Buffer.from(t.content, 'base64');
    if (!buf.length) problems.push(t.path + ' 内容为空');
    if (t.path.includes('\\')) problems.push(t.path + ' 路径分隔符未转正斜杠');
  }
  if (!tree.some((t) => t.path === 'server.js')) problems.push('缺少 server.js');
  if (!tree.some((t) => t.path === 'render.yaml')) problems.push('缺少 render.yaml（Render 部署必需）');
  if (!tree.some((t) => t.path === 'index.html')) problems.push('缺少 index.html');
  if (!tree.some((t) => t.path === 'package.json')) problems.push('缺少 package.json');
  tree.forEach((t) => console.log('    ✓ ' + t.path.padEnd(38) + Buffer.from(t.content, 'base64').length + ' bytes'));
  if (missing.length) console.log('  ⚠ 仓库中不存在（将跳过）: ' + missing.join(', '));
  if (problems.length) { console.error('\n✗ 校验未通过:\n  - ' + problems.join('\n  - ')); process.exit(1); }
  console.log('\n  ✓ 载荷校验通过，可以安全推送');
}

/* ---------- main ---------- */
const [cmd, token, repoArg, visArg] = process.argv.slice(2);

if (cmd === 'dry-run') {
  await dryRun();
} else {
  await main(cmd, repoArg, visArg);
}

async function main(PAT, REPO_ARG, VISIBILITY) {
  REPO_ARG = REPO_ARG || 'zishun-diancai';
  VISIBILITY = (VISIBILITY || 'public').toLowerCase();
  if (!PAT) {
    console.error('用法: node push-github.mjs <PAT> <owner/repo> [public|private]');
    console.error('      node push-github.mjs dry-run        （本地校验，不需要令牌）');
    process.exit(1);
  }
  await push(PAT, REPO_ARG, VISIBILITY);
}

/* ---------- 推送主流程 ---------- */
async function push(PAT, REPO_ARG, VISIBILITY) {
  /* 1. 确认身份 */
  const me = await gh('/user', null, PAT);
  if (!me.ok) fail('PAT 无效或权限不足', me.body);
  const login = me.body.login;
  console.log('✓ 已认证：' + login);

  /* 2. 解析 owner/repo */
  let owner = login, repo = REPO_ARG;
  if (REPO_ARG.includes('/')) {
    const parts = REPO_ARG.split('/');
    owner = parts[0]; repo = parts[1];
  }
  console.log('  目标仓库：' + owner + '/' + repo + '（' + VISIBILITY + '）');

  /* 3. 创建或复用仓库 */
  let repoInfo = await gh('/repos/' + owner + '/' + repo, null, PAT);
  if (!repoInfo.ok) {
    const created = await gh('/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: repo,
        private: VISIBILITY === 'private',
        auto_init: true,
        description: '志顺小馆（小仝宝店）· 在线点菜 + 接单后台'
      })
    }, PAT);
    if (!created.ok) fail('创建仓库失败（PAT 需要 Administration: Read and write 权限）', created.body);
    repoInfo = created;
    console.log('✓ 已创建仓库');
    await new Promise((r) => setTimeout(r, 2500)); // 等自动初始化的首个提交就绪
  } else {
    console.log('✓ 仓库已存在，将更新内容');
  }

  /* 4. 读取现有分支/提交 */
  const branch = 'main';
  let headSha = null;
  const ref = await gh('/repos/' + owner + '/' + repo + '/git/ref/heads/' + branch, null, PAT);
  if (ref.ok) {
    headSha = ref.body.object.sha;
  } else {
    const ref2 = await gh('/repos/' + owner + '/' + repo + '/git/ref/heads/master', null, PAT);
    if (ref2.ok) headSha = ref2.body.object.sha;
  }
  if (!headSha) console.log('  仓库为空，将创建首个提交');

  /* 5. 组装 tree */
  const { tree, missing } = await buildTree();
  if (!tree.length) fail('没有可上传的文件');
  if (missing.length) console.log('  跳过（不存在）: ' + missing.join(', '));
  console.log('  待上传文件：' + tree.length + ' 个');

  const treeRes = await gh('/repos/' + owner + '/' + repo + '/git/trees', {
    method: 'POST',
    body: JSON.stringify({ tree })
  }, PAT);
  if (!treeRes.ok) fail('创建 tree 失败', treeRes.body);

  /* 6. 创建提交 */
  const commitRes = await gh('/repos/' + owner + '/' + repo + '/git/commits', {
    method: 'POST',
    body: JSON.stringify({
      message: '志顺小馆（小仝宝店）在线点菜系统 · 部署更新',
      tree: treeRes.body.sha,
      parents: headSha ? [headSha] : []
    })
  }, PAT);
  if (!commitRes.ok) fail('创建提交失败', commitRes.body);
  console.log('✓ 提交已创建：' + commitRes.body.sha.slice(0, 8));

  /* 7. 更新分支 */
  const patchRes = await gh('/repos/' + owner + '/' + repo + '/git/refs/heads/' + branch, {
    method: headSha ? 'PATCH' : 'POST',
    body: JSON.stringify(
      headSha
        ? { sha: commitRes.body.sha, force: false }
        : { ref: 'refs/heads/' + branch, sha: commitRes.body.sha }
    )
  }, PAT);
  if (!patchRes.ok) fail('更新分支失败', patchRes.body);

  console.log('✓ 已推送到 ' + branch + ' 分支');
  console.log('');
  console.log('REPO_URL=https://github.com/' + owner + '/' + repo);
  console.log('CLONE_URL=https://github.com/' + owner + '/' + repo + '.git');
}
