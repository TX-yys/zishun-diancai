/**
 * 交互式推送：提示输入 GitHub 令牌（隐藏输入），然后推送代码。
 *   node push-interactive.mjs
 * 令牌只在本机内存中使用，不会写入任何文件、也不会上传别处。
 */
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const OWNER = process.env.GH_OWNER || 'TX-yys';
const REPO = process.env.GH_REPO || 'zishun-diancai';
const TARGET = OWNER + '/' + REPO;

/** 隐藏输入（非 TTY 时回退普通输入，保证不崩） */
function askHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      const rl = readline.createInterface({ input: stdin, output: process.stdout });
      rl.question(question, (a) => { rl.close(); resolve((a || '').trim()); });
      return;
    }
    process.stdout.write(question);
    const wasRaw = stdin.isRaw;
    try { stdin.setRawMode(true); } catch (e) {}
    stdin.resume();
    let buf = '';
    const cleanup = () => {
      stdin.removeListener('data', onData);
      try { stdin.setRawMode(wasRaw || false); } catch (e) {}
      stdin.pause();
    };
    const onData = (chunk) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          cleanup(); process.stdout.write('\n'); resolve(buf.trim()); return;
        }
        if (ch === '\u0003') { cleanup(); process.stdout.write('\n'); process.exit(1); }
        if (ch === '\u007f' || ch === '\b') { buf = buf.slice(0, -1); continue; }
        buf += ch;
      }
    };
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
console.log('  把「志顺小馆（小仝宝店）」点菜系统推送到 GitHub');
console.log('============================================================');
console.log('');
console.log('  目标仓库：' + TARGET);
console.log('');
console.log('  请准备一个新的 GitHub 令牌（旧的那个已被 GitHub 自动吊销）：');
console.log('    1) 打开 https://github.com/settings/tokens?type=beta');
console.log('    2) Generate new token');
console.log('    3) Repository access 选 All repositories');
console.log('    4) Permissions → Repository permissions 里把这两项设为 Read and write：');
console.log('         Administration');
console.log('         Contents');
console.log('    5) Generate token，复制 github_pat_ 开头那串');
console.log('');
console.log('  ⚠ 只粘贴到本窗口，不要发到聊天/群里——GitHub 会检测到并自动吊销。');
console.log('');

const token = await askHidden('请粘贴令牌后回车（输入时不显示）：');
if (!token) {
  console.error('✗ 没有输入令牌，已取消');
  await ask('按回车关闭…');
  process.exit(1);
}
if (!/^github_pat_|^ghp_/.test(token)) {
  console.log('⚠ 令牌格式看起来不像 GitHub 令牌，仍会尝试…');
}

console.log('');
console.log('正在推送（19 个文件）…');
console.log('');

const r = spawnSync(process.execPath, [
  path.join(ROOT, 'push-files-api.mjs'), TARGET, token, 'public'
], { cwd: ROOT, encoding: 'utf8', stdio: 'inherit' });

if (r.status === 0) {
  console.log('');
  console.log('============================================================');
  console.log('  ✓ 推送成功！');
  console.log('============================================================');
  console.log('');
  console.log('  仓库地址： https://github.com/' + TARGET);
  console.log('');
  console.log('  下一步：双击「一键部署到公网.bat」，');
  console.log('  它会打开 Render 的部署页面，你点几下就能拿到公网链接。');
  console.log('');
} else {
  console.log('');
  console.log('✗ 推送失败。常见原因：');
  console.log('  · 令牌权限不足（需要 Administration 与 Contents 的 Read and write）');
  console.log('  · 令牌已过期或被吊销');
  console.log('  · 网络问题（本机能否打开 github.com？）');
  console.log('');
}
await ask('按回车关闭…');
