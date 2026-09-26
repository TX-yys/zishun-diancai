/**
 * 店铺设置生成器：一条命令生成「接单频道码 + 顾客二维码桌贴」
 *
 *   node setup-shop.js                 # 生成新频道码，输出桌贴页
 *   node setup-shop.js ZS7K2M9QP4      # 使用指定频道码
 *
 * 产物：static/tables.html   （可打印的桌贴页，一桌一码）
 *       static/channel.txt   （频道码与各链接，便于保存）
 */
const fs = require('fs');
const path = require('path');
const QR = require('./qr.js');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'static');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

/* 频道码：去除易混字符（0/O、1/I/L） */
function newChannel() {
  const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += ABC[Math.floor(Math.random() * ABC.length)];
  return s;
}

const CHANNEL = (process.argv[2] || newChannel()).replace(/[^0-9A-Za-z_-]/g, '').slice(0, 32);
const TABLES = (process.env.TABLES || 'A14,A15,A16,A17,B01,B02,B03,B04').split(',').map((s) => s.trim()).filter(Boolean);

/* 顾客链接的基地址：
   - 若设置了 PUBLIC_BASE 环境变量，则用它（部署到公网后填写）
   - 否则留占位符，方便你部署后替换 */
const PUBLIC_BASE = (process.env.PUBLIC_BASE || '').replace(/\/+$/, '');

function urlFor(table) {
  const base = PUBLIC_BASE || '（部署后替换为你的公网地址）';
  return PUBLIC_BASE
    ? PUBLIC_BASE + '/page-order.html?t=' + encodeURIComponent(table) + '&c=' + CHANNEL
    : 'https://你的地址/page-order.html?t=' + encodeURIComponent(table) + '&c=' + CHANNEL;
}

const adminUrl = PUBLIC_BASE
  ? PUBLIC_BASE + '/admin-static.html?c=' + CHANNEL
  : 'https://你的地址/admin-static.html?c=' + CHANNEL;

const cards = TABLES.map((t) => {
  const u = urlFor(t);
  return '<div class="card">' +
    '<h2>' + t + ' 号桌</h2>' +
    '<span class="role o">扫码点菜</span>' +
    '<div class="qrbox">' + QR.svg(u, { ec: 'M', quiet: 4 }) + '</div>' +
    '<div class="url" style="font-size:11px">' + u.replace(/&/g, '&amp;') + '</div>' +
    '</div>';
}).join('');

const adminQr = PUBLIC_BASE
  ? '<div class="card"><h2>接单台</h2><span class="role a">仅店员使用</span>' +
    '<div class="qrbox">' + QR.svg(adminUrl, { ec: 'M', quiet: 4 }) + '</div>' +
    '<div class="url" style="font-size:11px">' + adminUrl.replace(/&/g, '&amp;') + '</div></div>'
  : '';

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>桌贴二维码 · 志顺小馆（小仝宝店）</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#F2F3F5;color:#222;padding:24px 18px}
.hd{max-width:1000px;margin:0 auto 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.hd h1{font-size:19px;margin:0}.hd .sub{font-size:12px;color:#999}.sp{flex:1}
.btn{height:36px;padding:0 16px;border-radius:18px;border:none;background:#FFD100;color:#5a4400;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}
.tip{max-width:1000px;margin:0 auto 16px;background:#FFF8E1;border:1px solid #FFE9A8;border-radius:10px;padding:12px 15px;font-size:13px;color:#8a6a00;line-height:1.8}
.grid{max-width:1000px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}
.card{background:#fff;border-radius:16px;padding:20px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.05)}
.card h2{font-size:16px;margin:0 0 6px}
.card .role{display:inline-block;font-size:11px;border-radius:4px;padding:2px 8px;margin-bottom:12px}
.role.o{background:rgba(0,194,90,.12);color:#00A94E}
.role.a{background:rgba(255,75,33,.12);color:#FF4B21}
.qrbox{width:100%;max-width:230px;margin:0 auto;aspect-ratio:1/1}
.qrbox svg{display:block;width:100%;height:100%}
.url{margin-top:10px;word-break:break-all;color:#666}
.foot{max-width:1000px;margin:18px auto 0;font-size:12px;color:#999;line-height:2}
code{background:#F0F0F0;padding:2px 6px;border-radius:4px}
@media print{body{background:#fff;padding:0}.hd,.tip,.foot{display:none}
.grid{display:block;max-width:none}
.card{page-break-after:always;box-shadow:none;border:2px dashed #ddd;margin:0;padding:40px 20px}
.card:last-child{page-break-after:auto}.qrbox{max-width:400px}.url{font-size:14px}}
</style></head><body>
<div class="hd"><h1>📋 桌贴二维码 · 志顺小馆（小仝宝店）</h1>
<span class="sub">接单频道码：<b>${CHANNEL}</b></span>
<span class="sp"></span><button class="btn" onclick="print()">🖨 打印全部桌贴</button></div>
<div class="tip">
<b>接单频道码：<code>${CHANNEL}</code></b>（请妥善保存，接单台需要它）<br>
${PUBLIC_BASE
    ? '点「打印全部桌贴」后每张二维码单独占一页，裁下来贴到对应桌上即可。'
    : '当前还没设置公网地址，二维码里的链接是占位符。<br>部署到公网后重新运行本脚本并加上 <code>PUBLIC_BASE</code> 即可生成真实二维码。'}
</div>
<div class="grid">${cards}${adminQr}</div>
<div class="foot">
接单台打开方式：${PUBLIC_BASE ? '<code>' + adminUrl + '</code><br>' : ''}
即使没有公网，也可直接双击 <code>static/admin-static.html</code> 打开接单台，首次会提示填写频道码 <code>${CHANNEL}</code>。
</div>
</body></html>`;

fs.writeFileSync(path.join(OUT, 'tables.html'), html, 'utf8');

const info = [
  '志顺小馆（小仝宝店）· 店铺设置',
  '生成时间：' + new Date().toLocaleString('zh-CN'),
  '',
  '【接单频道码】' + CHANNEL,
  '（相当于房间号，只有知道它的接单台能收到本店订单；请妥善保存）',
  '',
  '【接单台】',
  PUBLIC_BASE ? PUBLIC_BASE + '/admin-static.html?c=' + CHANNEL : '（部署后替换域名）',
  '没有公网时：直接双击 static/admin-static.html，填频道码 ' + CHANNEL,
  '',
  '【各桌顾客链接】'
].concat(TABLES.map((t) => '  ' + t + ' 号桌：' + urlFor(t))).join('\r\n');

fs.writeFileSync(path.join(OUT, 'channel.txt'), info, 'utf8');

console.log('✓ 已生成桌贴页： static/tables.html');
console.log('✓ 已生成设置信息：static/channel.txt');
console.log('');
console.log('  接单频道码：' + CHANNEL);
console.log('  桌号数量  ：' + TABLES.length + '（' + TABLES.join('、') + '）');
console.log('');
if (!PUBLIC_BASE) {
  console.log('  ⚠ 未设置公网地址，二维码中的链接为占位符。');
  console.log('    部署到公网后这样重新生成：');
  console.log('      set PUBLIC_BASE=https://你的地址 && node setup-shop.js ' + CHANNEL);
} else {
  console.log('  顾客链接示例：' + urlFor(TABLES[0]));
  console.log('  接单台地址  ：' + adminUrl);
}
