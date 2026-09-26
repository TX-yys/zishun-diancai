/**
 * 构建 GitHub Pages 发布目录（docs/）
 *
 * GitHub Pages 只能从「仓库根目录」或「/docs 目录」发布，
 * 因此这里把 static/ 的产物复制到 docs/，并生成一个入口页。
 *
 * 用法： node build-pages.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'static');
const OUT = path.join(ROOT, 'docs');

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(SRC)) {
  console.error('✗ 缺少 static/ 目录，请先运行 node build-static.js');
  process.exit(1);
}

const log = [];

/* ---------- 1. 复制静态产物 ---------- */
const COPY = ['page-order.html', 'admin-static.html', 'tables.html'];
for (const f of COPY) {
  const s = path.join(SRC, f);
  if (!fs.existsSync(s)) { log.push('· 跳过（不存在）: ' + f); continue; }
  fs.copyFileSync(s, path.join(OUT, f));
  log.push('✓ docs/' + f + '（' + fs.statSync(s).size + ' bytes）');
}

/* ---------- 2. 入口页：用 ?t= 与 ?c= 参数直接进点菜页 ---------- */
const index = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>志顺小馆（小仝宝店）· 在线点菜</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
       background:#F5F5F5;color:#222;display:grid;place-items:center;min-height:100vh;padding:24px}
  .box{background:#fff;border-radius:16px;padding:28px 24px;max-width:380px;width:100%;text-align:center;
       box-shadow:0 4px 20px rgba(0,0,0,.06)}
  h1{font-size:19px;margin-bottom:6px}
  p{font-size:13px;color:#888;line-height:1.8;margin-bottom:18px}
  a.btn{display:block;height:46px;line-height:46px;border-radius:23px;background:#00C25A;color:#fff;
        text-decoration:none;font-size:16px;font-weight:600;margin-bottom:10px}
  a.ghost{background:#F4F4F4;color:#666}
</style>
</head>
<body>
  <div class="box">
    <h1>志顺小馆（小仝宝店）</h1>
    <p id="tip">正在进入点菜页…</p>
    <a class="btn" id="go" href="page-order.html">去点菜</a>
    <a class="btn ghost" href="admin-static.html">接单台（仅店员）</a>
  </div>
<script>
(function () {
  var q = new URLSearchParams(location.search);
  var t = q.get('t'), c = q.get('c');
  // 带了桌号或频道码，直接进点菜页（扫码场景）
  if (t || c) {
    location.replace('page-order.html' + location.search);
    return;
  }
  document.getElementById('tip').textContent =
    '请在桌贴二维码上扫码进入，或点下方按钮直接点菜';
  document.getElementById('go').href = 'page-order.html';
})();
</script>
</body>
</html>`;
fs.writeFileSync(path.join(OUT, 'index.html'), index, 'utf8');
log.push('✓ docs/index.html（入口页，带 ?t=/?c= 时自动跳转点菜页）');

/* ---------- 3. 禁止 Jekyll 处理（避免下划线开头文件被忽略） ---------- */
fs.writeFileSync(path.join(OUT, '.nojekyll'), '', 'utf8');
log.push('✓ docs/.nojekyll');

console.log(log.join('\n'));
console.log('');
console.log('发布目录就绪: docs/');
console.log('GitHub Pages 设置：Settings → Pages → Source 选 “Deploy from a branch” → 分支 main、目录 /docs');
