/**
 * 扫码点菜页前端逻辑（由 server.js 内联进 /qr 页面返回）
 * 依赖同页注入的 window.QR（qr.js）
 *
 * 功能：列出本机所有可用局域网地址，为「顾客点菜」和「店员后台」生成二维码；
 *       支持一键打印（每张卡片一页，可裁成桌贴）。
 */
(function () {
  'use strict';

  var root = document.getElementById('qrRoot');
  var SHOP = '志顺小馆（小仝宝店）';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function render(addr) {
    var list = (addr.addresses || []);
    // 真实网卡优先：默认只展示第一张真实网卡，其余放在下面备选
    var real = list.filter(function (x) { return !x.virtual; });
    var virt = list.filter(function (x) { return x.virtual; });
    var main = real[0];

    if (!main) {
      root.innerHTML =
        '<div class="empty">没有检测到可用的局域网地址。<br>' +
        '请确认电脑已连接 WiFi 或网线，然后刷新本页。<br>' +
        '<button class="btn" style="margin-top:16px" onclick="location.reload()">重新检测</button></div>';
      return;
    }

    var cards = [
      { title: '扫码点菜', role: 'order', cls: 'order', url: main.order, note: '顾客手机连店内 WiFi 后扫码即可点菜', ec: 'M' },
      { title: '店员接单后台', role: 'admin', cls: 'admin', url: main.admin, note: '仅店员使用，请勿外贴', ec: 'M' }
    ];

    var html = '';
    html += '<div class="hd">' +
      '<h1>📱 扫码点菜 · ' + esc(addr.shop || SHOP) + '</h1>' +
      '<span class="sub">' + esc(main.name) + ' · ' + esc(main.ip) + ':' + addr.port + '</span>' +
      '<span class="sp"></span>' +
      '<button class="btn" id="btnPrint">🖨 打印桌贴</button>' +
      '<button class="btn ghost" id="btnRefresh">↻ 重新检测</button>' +
      '</div>';

    html += '<div class="tip">' +
      '<b>怎么用：</b>顾客和店员手机连「同一个 WiFi」，打开相机或微信扫下面二维码即可。' +
      '点「打印桌贴」后每张二维码会单独占一页，裁下来贴在桌上就行。<br>' +
      '<b>注意：</b>地址里的 IP 是电脑当前的局域网地址。<b>如果电脑换了 WiFi 或重启后 IP 变了，请重新打开本页打印一次。</b>' +
      '（把电脑的无线网卡 IP 设为「固定」可以避免这个问题）' +
      '</div>';

    html += '<div class="grid">';
    cards.forEach(function (c) {
      html += '<div class="card">' +
        '<h2>' + esc(c.title) + '</h2>' +
        '<span class="role ' + c.cls + '">' + (c.cls === 'order' ? '给顾客扫' : '店员专用') + '</span>' +
        '<div class="qrbox">' + window.QR.svg(c.url, { ec: c.ec, quiet: 4 }) + '</div>' +
        '<div class="url">' + esc(c.url) + '</div>' +
        '<div class="net">' + esc(c.note) + '</div>' +
        '</div>';
    });
    html += '</div>';

    if (real.length > 1 || virt.length) {
      html += '<div class="foot"><b>其他检测到的地址</b>（一般不用，当前用的是上面那个）：<br>' +
        list.map(function (x) {
          return '　· ' + esc(x.ip) + ' <span style="color:#bbb">[' + esc(x.name) +
            (x.virtual ? ' · 虚拟网卡，手机连不上' : '') + ']</span>';
        }).join('<br>') + '</div>';
    }

    html += '<div class="foot">提示：本页二维码由内置生成器实时绘制，不依赖外网。' +
      '若手机扫码后打不开，请检查手机与电脑是否在同一 WiFi、以及电脑防火墙是否放行 ' + addr.port + ' 端口。</div>';

    root.innerHTML = html;

    var p = document.getElementById('btnPrint');
    if (p) p.addEventListener('click', function () { window.print(); });
    var r = document.getElementById('btnRefresh');
    if (r) r.addEventListener('click', function () { location.reload(); });
  }

  fetch('/api/addresses')
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (j && j.ok) render(j);
      else throw new Error('bad');
    })
    .catch(function () {
      root.innerHTML = '<div class="empty">读取地址失败，请确认服务仍在运行。<br>' +
        '<button class="btn" style="margin-top:16px" onclick="location.reload()">重试</button></div>';
    });
})();
