/**
 * 向 GitHub 仓库上传/更新单个文件（不需要 git）
 * 配合最小权限令牌使用：只需该仓库的 Contents: Read and write
 *
 * 用法：
 *   node update-file.mjs dry-run <本地路径> <仓库内路径>
 *   node update-file.mjs <所有者/仓库> <本地路径> <仓库内路径> <分支>
 *
 * 令牌通过环境变量 GITHUB_TOKEN 传入（避免出现在命令行历史里）
 */

const API = 'https://api.github.com';

function headers(token) {
  return {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'zishun-update'
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

const args = process.argv.slice(2);
const mode = args[0];

/* ---------- dry-run：本地校验 ---------- */
if (mode === 'dry-run') {
  const localPath = args[1];
  const repoPath = args[2] || localPath;
  const fs = await import('node:fs');
  if (!localPath || !fs.existsSync(localPath)) fail('找不到本地文件: ' + localPath);
  const content = fs.readFileSync(localPath).toString('base64').replace(/[\r\n]/g, '');
  const decoded = Buffer.from(content, 'base64');
  const problems = [];
  if (!content) problems.push('内容为空');
  if (Buffer.from(content, 'base64').length !== fs.statSync(localPath).size) problems.push('base64 往返长度不一致');
  console.log('DRY_RUN_OK');
  console.log('  本地文件 : ' + localPath + '（' + decoded.length + ' bytes）');
  console.log('  仓库路径 : ' + repoPath);
  console.log('  base64 长度: ' + content.length + '（无换行符: ' + !/[\r\n]/.test(content) + '）');
  if (problems.length) die('校验未通过: ' + problems.join('；'));
  console.log('  ✓ 校验通过');
  process.exit(0);

  function die(m) { console.error('✗ ' + m); process.exit(1); }
}

/* ---------- 真正上传 ---------- */
const [repo, localPath, repoPath, branchArg] = args;
const token = process.env.GITHUB_TOKEN;
if (!repo || !localPath || !token) {
  console.error('用法: GITHUB_TOKEN=xxx node update-file.mjs <owner/repo> <本地路径> <仓库内路径> [分支]');
  process.exit(1);
}
const branch = branchArg || 'main';

const fs = await import('node:fs');
if (!fs.existsSync(localPath)) fail('找不到本地文件: ' + localPath);
const contentB64 = fs.readFileSync(localPath).toString('base64').replace(/[\r\n]/g, '');
const target = repoPath || localPath.replace(/\\/g, '/');

// 取当前 sha（更新已存在文件时必须提供）
const cur = await gh('/repos/' + repo + '/contents/' + encodeURI(target) + '?ref=' + branch, null, token);
const sha = cur.ok && cur.body && cur.body.sha ? cur.body.sha : null;
if (!cur.ok && cur.status !== 404) fail('读取文件信息失败（检查令牌权限与仓库名）', cur.body);

const put = await gh('/repos/' + repo + '/contents/' + encodeURI(target), {
  method: 'PUT',
  body: JSON.stringify({
    message: (sha ? '更新 ' : '新增 ') + target,
    content: contentB64,
    branch: branch,
    ...(sha ? { sha } : {})
  })
}, token);

if (!put.ok) fail('上传失败', put.body);
console.log('✓ 已' + (sha ? '更新' : '新增') + '：' + target);
console.log('  ' + (put.body.commit && put.body.commit.html_url ? put.body.commit.html_url : ''));
