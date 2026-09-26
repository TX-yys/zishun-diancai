/**
 * 一键部署：推送代码到 GitHub 并给出 Render 部署链接
 * 用法： node deploy-render.mjs
 * 交互式询问 GitHub 令牌，不需要把令牌发到任何对话里。
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const REPO_NAME = 'zishun-diancai';
const DRY_RUN = process.argv.includes('--dry-run');
const NO_OPEN = process.argv.includes('--no-open') || DRY_RUN;
const FAKE_REPO = 'https://github.com/demo-user/' + REPO_NAME;

/** 隐藏输入（仅 TTY 下生效；非 TTY 回退为普通输入，避免崩溃） */
function askHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      // 非交互环境（管道/重定向）：用普通输入，保证不崩
      const rl = readline.createInterface({ input: stdin, output: process.stdout });
      rl.question(question, (a) => { rl.close(); resolve((a || '').trim()); });
      return;
    }
    process.stdout.write(question);
    const wasRaw = stdin.isRaw;
    try { stdin.setRawMode(true); } catch (e) { /* 不支持就算了 */ }
    stdin.resume();
    let buf = '';
    const onData = (chunk) => {
      const s = chunk.toString('utf8');
      for (const ch of s) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          cleanup();
          process.stdout.write('\n');
          resolve(buf.trim());
          return;
        }
        if (ch === '\u0003') { cleanup(); process.stdout.write('\n'); process.exit(1); }
        if (ch === '\u007f' || ch === '\b') { buf = buf.slice(0, -1); continue; }
        buf += ch;
      }
    };
    function cleanup() {
      stdin.removeListener('data', onData);
      try { stdin.setRawMode(wasRaw || false); } catch (e) {}
      stdin.pause();
    }
    stdin.on('data', onData);
  });
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => { rl.close(); resolve((a || '').trim()); });
  });
}

console.log('');
console.log('============================================================');
console.log('  志顺小馆（小仝宝店）· 一键部署到公网');
console.log('============================================================');
console.log('');

/* ---------- 1. 获取令牌 ---------- */
console.log('需要你的 GitHub 令牌（只用于推送本项目代码，随时可撤销）。');
console.log('获取步骤（约 2 分钟）：');
console.log('  1) 注册/登录 https://github.com/signup');
console.log('  2) 打开 https://github.com/settings/tokens?type=beta');
console.log('  3) Generate new token → Repository access: All repositories');
console.log('  4) Permissions 里设：Administration = Read and write、Contents = Read and write');
console.log('  5) Generate token，复制 github_pat_ 开头那串');
console.log('');
const token = DRY_RUN
  ? 'dry-run-token'
  : (process.env.GITHUB_TOKEN || await askHidden('请粘贴令牌后回车（输入时不显示）：'));
if (!token) { console.error('✗ 没有输入令牌，已取消'); process.exit(1); }
if (!DRY_RUN && !/^(github_pat_|ghp_)/.test(token)) {
  console.log('⚠ 令牌格式看起来不像 GitHub 令牌，仍会尝试…');
}

/* ---------- 2. 推送 ---------- */
console.log('');
console.log(DRY_RUN ? '【演练模式】跳过真实推送，仅校验链路与链接格式 …' : '正在推送代码到 GitHub …');
let out = '';
if (DRY_RUN) {
  // 演练模式：只做本地载荷校验，不触碰 GitHub
  const check = spawnSync(process.execPath, [path.join(ROOT, 'push-github.mjs'), 'dry-run'], {
    cwd: ROOT, encoding: 'utf8'
  });
  out = (check.stdout || '') + (check.stderr || '');
  out.split('\n').filter((l) => l.trim()).forEach((l) => console.log('  ' + l.trim()));
  if (check.status !== 0) { console.error('✗ 载荷校验失败'); process.exit(1); }
} else {
  const push = spawnSync(process.execPath, [path.join(ROOT, 'push-github.mjs'), token, REPO_NAME, 'public'], {
    cwd: ROOT, encoding: 'utf8'
  });
  out = (push.stdout || '') + (push.stderr || '');
  out.split('\n').filter((l) => l.trim()).forEach((l) => console.log('  ' + l.trim()));

  if (push.status !== 0) {
    console.error('');
    console.error('✗ 推送失败。常见原因：');
    console.error('  · 令牌权限不足（需要 Administration + Contents 读写权限）');
    console.error('  · 用户名下已存在同名仓库且令牌无权限访问 → 换个仓库名重试');
    console.error('  · 网络问题（本机访问 github.com 是否正常？）');
    process.exit(1);
  }
}

const m = out.match(/REPO_URL=(\S+)/);
const repoUrl = DRY_RUN ? FAKE_REPO : (m ? m[1] : null);
if (!repoUrl) { console.error('✗ 未拿到仓库地址'); process.exit(1); }

/* ---------- 3. 生成 Render 部署链接 ---------- */
const deeplink = 'https://dashboard.render.com/blueprint/new?repo=' + repoUrl;

console.log('');
console.log('============================================================');
console.log(DRY_RUN ? '  ✓ 演练完成（未真实推送）' : '  ✓ 代码已推送成功');
console.log('============================================================');
console.log('');
console.log('  仓库地址：' + repoUrl);
console.log('');
console.log('  下一步（只需点几下）：');
console.log('    1. 打开下面的链接（会自动带出本仓库的部署配置）');
console.log('    2. 用 GitHub 登录 Render（免费，不需要信用卡）');
console.log('    3. 在环境变量处填写接单台口令 ADMIN_TOKEN（例如 zishun2024）');
console.log('    4. 点 Apply，等 2–3 分钟');
console.log('');
console.log('  👉 ' + deeplink);
console.log('');

/* ---------- 4. 尝试自动打开浏览器 ---------- */
if (!NO_OPEN && process.platform === 'win32') {
  spawnSync('cmd', ['/c', 'start', '', deeplink], { stdio: 'ignore' });
  console.log('  （已尝试自动打开浏览器）');
}

fs.writeFileSync(path.join(ROOT, '部署链接.txt'),
  'GitHub 仓库：' + repoUrl + '\r\n\r\nRender 一键部署链接：\r\n' + deeplink + '\r\n\r\n' +
  '部署完成后地址形如： https://' + REPO_NAME + '.onrender.com\r\n' +
  '接单台： https://' + REPO_NAME + '.onrender.com/admin?token=你设的口令\r\n' +
  '桌贴页： https://' + REPO_NAME + '.onrender.com/tables\r\n', 'utf8');
console.log('  链接也保存到了：部署链接.txt');
console.log('');

if (!DRY_RUN) await ask('按回车键关闭…');
