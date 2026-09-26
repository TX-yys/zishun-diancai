/**
 * 零依赖 QR 码生成器（字节模式 / UTF-8）
 * 支持版本 1–16、纠错等级 L/M/Q/H，自动选最小版本并做掩码评估
 *
 * 同时兼容两种用法：
 *   Node   :  const QR = require('./qr.js');  QR.svg('https://...', opts)
 *   浏览器 :  由 server.js 内联注入本文件后，使用 window.QR.svg(...)
 *
 * 算法：ISO/IEC 18004。GF(256) 以 0x11D 为本原多项式，RS 纠错 + 8 种掩码取最低惩罚分。
 * 注意：本文件会被内联进 HTML，因此正文中不得出现脚本标签的字面写法。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QR = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- GF(256) ---------------- */
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function initGF() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function gmul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  /** RS 生成多项式，最高次项已去掉（首项恒为 1） */
  function rsGenPoly(deg) {
    var poly = [1];
    for (var i = 0; i < deg; i++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= gmul(poly[j], 1);
        next[j + 1] ^= gmul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly.slice(1);
  }

  /** 计算纠错码字 */
  function rsEncode(data, ecLen) {
    var gen = rsGenPoly(ecLen);
    var res = new Array(ecLen).fill(0);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ res[0];
      res.shift();
      res.push(0);
      if (factor !== 0) {
        for (var j = 0; j < ecLen; j++) res[j] ^= gmul(gen[j], factor);
      }
    }
    return res;
  }

  /* ---------------- 版本 / 容量表 ---------------- */
  // 格式信息里的纠错等级编码（写成 2 位：L=01 M=00 Q=11 H=10）
  var EC_BITS = { L: 1, M: 0, Q: 3, H: 2 };
  // 分块表 BLOCKS 的列下标顺序是 [L, M, Q, H]，与上面的编码值无关，必须分开映射
  var EC_COL = { L: 0, M: 1, Q: 2, H: 3 };
  // 校正图形中心坐标（ISO/IEC 18004 附录 E）
  var ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46],
    10: [6, 28, 50], 11: [6, 30, 54], 12: [6, 32, 58], 13: [6, 34, 62],
    14: [6, 26, 46, 66], 15: [6, 26, 48, 70], 16: [6, 26, 50, 74],
    17: [6, 30, 54, 78], 18: [6, 30, 56, 82], 19: [6, 30, 58, 86],
    20: [6, 34, 62, 90], 21: [6, 28, 50, 72, 94], 22: [6, 26, 50, 74, 98],
    23: [6, 30, 54, 78, 102], 24: [6, 28, 54, 80, 106], 25: [6, 32, 58, 84, 110],
    26: [6, 30, 58, 86, 114], 27: [6, 34, 62, 90, 118], 28: [6, 26, 50, 74, 98, 122],
    29: [6, 30, 54, 78, 102, 126], 30: [6, 26, 52, 78, 104, 130],
    31: [6, 30, 56, 82, 108, 134], 32: [6, 34, 60, 86, 112, 138],
    33: [6, 30, 58, 86, 114, 142], 34: [6, 34, 62, 90, 118, 146],
    35: [6, 30, 54, 78, 102, 126, 150], 36: [6, 24, 50, 76, 102, 128, 154],
    37: [6, 28, 54, 80, 106, 132, 158], 38: [6, 32, 58, 84, 110, 136, 162],
    39: [6, 26, 54, 82, 110, 138, 166], 40: [6, 30, 58, 86, 114, 142, 170]
  };
  // [每块总码字, 数据码字, 块数] × L/M/Q/H
  var BLOCKS = {
     1: [[26, 19, 1], [26, 16, 1], [26, 13, 1], [26, 9, 1]],
     2: [[44, 34, 1], [44, 28, 1], [44, 22, 1], [44, 16, 1]],
     3: [[70, 55, 1], [70, 44, 1], [70, 34, 2], [70, 26, 2]],
     4: [[100, 80, 1], [100, 64, 2], [100, 48, 2], [100, 36, 4]],
     5: [[134, 108, 1], [134, 86, 2], [66, 30, 2], [66, 22, 2]],
     6: [[172, 136, 2], [172, 108, 4], [172, 76, 4], [172, 60, 4]],
     7: [[196, 156, 2], [196, 124, 4], [64, 28, 2], [156, 52, 4]],
     8: [[242, 194, 2], [120, 76, 2], [160, 72, 4], [160, 56, 4]],
     9: [[292, 232, 2], [174, 108, 3], [144, 64, 4], [144, 48, 4]],
    10: [[172, 136, 2], [276, 172, 4], [258, 114, 6], [258, 90, 6]],
    11: [[404, 324, 4], [80, 50, 1], [200, 88, 4], [108, 36, 3]],
    12: [[232, 184, 2], [348, 216, 6], [184, 80, 4], [294, 98, 7]],
    13: [[532, 428, 4], [472, 296, 8], [352, 160, 8], [396, 132, 12]],
    14: [[435, 345, 3], [256, 160, 4], [396, 176, 11], [396, 132, 11]],
    15: [[545, 435, 5], [325, 205, 5], [270, 120, 5], [396, 132, 11]],
    16: [[610, 490, 5], [511, 315, 7], [645, 285, 15], [135, 45, 3]]
  };
  var MAXVER = 16;

  function totalCodewords(v) { return BLOCKS[v][0][0]; }

  /** 该版本纠错块数与数据码字总量（表里可能是简写，这里按标准展开计算） */
  function blockInfo(v, ec) {
    var row = BLOCKS[v][EC_COL[ec]];
    if (!row) throw new Error('未知纠错等级: ' + ec);
    var total = row[0], dataCw = row[1], groups = row[2];
    // 标准展开：数据码字在 groups 个块间尽量均分，
    // 多出的 (dataCw % groups) 个码字给「后面的块」，即短块在前、长块在后
    var shortLen = Math.floor(dataCw / groups);
    var numLong = dataCw % groups;
    var ecPerBlock = Math.floor((total - dataCw) / groups);
    return { total: total, dataCw: dataCw, groups: groups, shortLen: shortLen, numLong: numLong, ecPerBlock: ecPerBlock };
  }

  /** 第 g 个块的数据码字数（短块在前） */
  function blockDataLen(info, g) {
    return info.shortLen + (g >= info.groups - info.numLong ? 1 : 0);
  }

  /* ---------------- 位流 ---------------- */
  function BitBuffer() { this.bits = []; }
  BitBuffer.prototype.put = function (value, len) {
    for (var i = len - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
    return this;
  };

  function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var c2 = str.charCodeAt(i + 1);
        var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        i++;
      } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  function capBits(v, ec) { return blockInfo(v, ec).dataCw * 8; }

  function chooseVersion(byteLen, ec) {
    for (var v = 1; v <= MAXVER; v++) {
      var lenBits = v <= 9 ? 8 : 16;
      if (4 + lenBits + byteLen * 8 <= capBits(v, ec)) return v;
    }
    return -1;
  }

  /* ---------------- 矩阵 ---------------- */
  function makeMatrix(size) {
    var m = [];
    for (var i = 0; i < size; i++) m.push(new Array(size).fill(null));
    return m;
  }

  function placeFinder(m, r, c) {
    for (var i = -1; i <= 7; i++) {
      for (var j = -1; j <= 7; j++) {
        var rr = r + i, cc = c + j;
        if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
        var inRing = (i >= 0 && i <= 6 && (j === 0 || j === 6)) || (j >= 0 && j <= 6 && (i === 0 || i === 6));
        var inCore = i >= 2 && i <= 4 && j >= 2 && j <= 4;
        m[rr][cc] = (inRing || inCore) ? 1 : 0;
      }
    }
  }

  function placeAlignment(m, cy, cx) {
    for (var i = -2; i <= 2; i++) {
      for (var j = -2; j <= 2; j++) {
        var ring = Math.max(Math.abs(i), Math.abs(j));
        m[cy + i][cx + j] = (ring === 1) ? 0 : 1;
      }
    }
  }

  function maskFn(k, r, c) {
    switch (k) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return false;
    }
  }

  function formatBits(ec, mask) {
    var data = (EC_BITS[ec] << 3) | mask;
    var rem = data << 10;
    for (var i = 14; i >= 10; i--) {
      if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
    }
    return ((data << 10) | rem) ^ 0x5412;
  }

  function versionBits(v) {
    var rem = v << 12;
    for (var i = 17; i >= 12; i--) {
      if ((rem >>> i) & 1) rem ^= 0x1f25 << (i - 12);
    }
    return (v << 12) | rem;
  }

  function buildMatrix(version, ec, codewords) {
    var size = version * 4 + 17;
    var m = makeMatrix(size);
    var fn = makeMatrix(size); // 1=功能图形（不参与掩码）

    placeFinder(m, 0, 0);
    placeFinder(m, size - 7, 0);
    placeFinder(m, 0, size - 7);
    for (var i = 0; i < size; i++) {
      if (m[6][i] === null) m[6][i] = (i % 2 === 0) ? 1 : 0;
      if (m[i][6] === null) m[i][6] = (i % 2 === 0) ? 1 : 0;
    }
    var al = ALIGN[version] || [];
    for (var a = 0; a < al.length; a++) {
      for (var b = 0; b < al.length; b++) {
        var cy = al[a], cx = al[b];
        if (m[cy][cx] !== null) continue; // 与定位图形重叠则跳过
        placeAlignment(m, cy, cx);
      }
    }

    // 预留格式信息区（先占位，稍后写真实值）
    for (var k = 0; k <= 8; k++) {
      if (k !== 6) { m[8][k] = 0; m[k][8] = 0; }
    }
    m[8][8] = 0;
    var si = size - 1;
    for (var t = 0; t < 8; t++) { m[8][si - t] = 0; m[si - t][8] = 0; }
    m[size - 8][8] = 1; // 固定暗模块

    // 版本信息（版本 >= 7）
    if (version >= 7) {
      var vb = versionBits(version);
      /* 与格式信息同样的落位规则：18 位串的最高位先写。
         版面：右上角 3 列 x 6 行 与 左下角 6 行 x 3 列（互为转置）。 */
      for (var vi = 0; vi < 18; vi++) {
        var vbit = (vb >> vi) & 1;          // 权威实现为 LSB-first 落位，与之保持一致
        var rIdx = Math.floor(vi / 3), cIdx = vi % 3;
        m[rIdx][size - 11 + cIdx] = vbit;   // 右上
        m[size - 11 + cIdx][rIdx] = vbit;   // 左下（转置）
      }
    }

    // 记录功能模块
    for (var r0 = 0; r0 < size; r0++) {
      for (var c0 = 0; c0 < size; c0++) {
        if (m[r0][c0] !== null) fn[r0][c0] = 1;
      }
    }
    // 被上面赋 0 的格式区也是功能模块
    for (var d = 0; d <= 8; d++) {
      if (d !== 6) { fn[8][d] = 1; fn[d][8] = 1; }
    }
    fn[8][8] = 1;
    for (var e = 0; e < 8; e++) { fn[8][size - 1 - e] = 1; fn[size - 1 - e][8] = 1; }
    fn[size - 8][8] = 1;
    if (version >= 7) {
      for (var vf = 0; vf < 18; vf++) {
        fn[Math.floor(vf / 3)][vf % 3 + size - 11] = 1;
        fn[vf % 3 + size - 11][Math.floor(vf / 3)] = 1;
      }
    }

    // 数据位流
    var dataBits = [];
    for (var w = 0; w < codewords.length; w++) {
      for (var bi = 7; bi >= 0; bi--) dataBits.push((codewords[w] >> bi) & 1);
    }

    // 之字形填充（跳过第 6 列）
    var idx = 0;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col = 5;
      for (var t2 = 0; t2 < size; t2++) {
        for (var s = 0; s < 2; s++) {
          var cc2 = col - s;
          var up = ((col + 1) & 2) === 0;
          var rr2 = up ? size - 1 - t2 : t2;
          if (fn[rr2][cc2]) continue;
          m[rr2][cc2] = (idx < dataBits.length) ? dataBits[idx++] : 0;
        }
      }
    }

    /* ---- 掩码评估：8 种取惩罚分最低 ---- */
    var best = null, bestScore = Infinity;
    for (var mk = 0; mk < 8; mk++) {
      var trial = m.map(function (row) { return row.slice(); });
      for (var r1 = 0; r1 < size; r1++) {
        for (var c1 = 0; c1 < size; c1++) {
          if (!fn[r1][c1] && maskFn(mk, r1, c1)) trial[r1][c1] ^= 1;
        }
      }
      applyFormat(trial, size, ec, mk);
      var score = penalty(trial, size);
      if (score < bestScore) { bestScore = score; best = trial; }
    }
    return best;
  }

  function applyFormat(m, size, ec, mask) {
    var fmt = formatBits(ec, mask);

    /* 位序：格式值是 15 位串，最高位(bit14)落在第一个坐标上（标准为 MSB-first 落位）。
       坐标分配（标准）：
         副本1（15 位）: (8,0)(8,1)(8,2)(8,3)(8,4)(8,5) (8,7) (8,8) (7,8) (5,8)(4,8)(3,8)(2,8)(1,8)(0,8)
                         ^ 依次为 bit14 ... bit0
         副本2（7+7 位 + 1 固定暗模块）:
           (n-1,8)(n-2,8)...(n-7,8)  -> bit14..bit8
           (n-8,8)                   -> 固定暗模块，恒为 1（等价于该位置的固定值）
           (8,n-7)(8,n-6)...(8,n-1)  -> bit7..bit1
         副本2 与副本1 比特序列互为反转，由 7+1+7 的排布自然满足。 */
    var bit = function (i) { return (fmt >> (14 - i)) & 1; };

    // 副本 1（左上）
    for (var i = 0; i <= 5; i++) m[8][i] = bit(i);
    m[8][7] = bit(6);
    m[8][8] = bit(7);
    m[7][8] = bit(8);
    for (var j = 9; j <= 14; j++) m[14 - j][8] = bit(j);

    // 副本 2：垂直 7 位 (n-1..n-7, 8)
    for (var k = 0; k <= 6; k++) m[size - 1 - k][8] = bit(k);
    // 中间 (n-8, 8) 为固定暗模块
    m[size - 8][8] = 1;
    // 水平 7 位 (8, n-7..n-1)
    for (var l = 8; l <= 14; l++) m[8][size - 7 + (l - 8)] = bit(l);
  }
  /* ---------------- 掩码惩罚分 ----------------
     为了与主流实现（以及各类扫码器）选出同一个掩码，这里完全按
     qrcode-generator / qrcode.js 的 getLostPoint 规则实现：
       1) 3x3 邻域同色数 > 5 时累加 (3 + sameCount - 5)
       2) 2x2 同色块 +3
       3) 行/列出现 1:1:3:1:1 定位图形样式 +40
       4) 暗色比例偏离 50% 每 5% 计 +10                                        */
  function penalty(m, size) {
    var score = 0, i, j;

    // 规则1
    for (i = 0; i < size; i++) {
      for (j = 0; j < size; j++) {
        var sameCount = 0;
        var dark = m[i][j];
        for (var r = -1; r <= 1; r++) {
          if (i + r < 0 || i + r >= size) continue;
          for (var c = -1; c <= 1; c++) {
            if (j + c < 0 || j + c >= size) continue;
            if (r === 0 && c === 0) continue;
            if (dark === m[i + r][j + c]) sameCount++;
          }
        }
        if (sameCount > 5) score += 3 + sameCount - 5;
      }
    }

    // 规则2
    for (i = 0; i < size - 1; i++) {
      for (j = 0; j < size - 1; j++) {
        var count = 0;
        if (m[i][j]) count++;
        if (m[i + 1][j]) count++;
        if (m[i][j + 1]) count++;
        if (m[i + 1][j + 1]) count++;
        if (count === 0 || count === 4) score += 3;
      }
    }

    // 规则3：1:1:3:1:1 样式（水平与垂直，仅匹配 7 位，不要求两侧留白）
    var pat = [1, 0, 1, 1, 1, 0, 1];
    for (i = 0; i < size; i++) {
      for (j = 0; j < size - 6; j++) {
        var okRow = true, okCol = true;
        for (var q = 0; q < 7; q++) {
          if (m[i][j + q] !== pat[q]) { okRow = false; }
          if (m[j + q][i] !== pat[q]) { okCol = false; }
          if (!okRow && !okCol) break;
        }
        if (okRow) score += 40;
        if (okCol) score += 40;
      }
    }

    // 规则4：暗色比例
    var darkCount = 0;
    for (i = 0; i < size; i++) for (j = 0; j < size; j++) if (m[i][j]) darkCount++;
    var ratio = (darkCount * 100) / (size * size);
    score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
    return score;
  }

  /* ---------------- 主入口 ---------------- */
  function encode(text, ecLevel) {
    var ec = EC_BITS[ecLevel] !== undefined ? ecLevel : 'M';
    var bytes = utf8Bytes(String(text));
    var version = chooseVersion(bytes.length, ec);
    if (version < 0) throw new Error('内容过长，超出版本 ' + MAXVER + ' 容量');

    var info = blockInfo(version, ec);
    var bb = new BitBuffer();
    bb.put(4, 4);                                   // 字节模式
    bb.put(bytes.length, version <= 9 ? 8 : 16);    // 字符计数
    for (var i = 0; i < bytes.length; i++) bb.put(bytes[i], 8);

    var cap = info.dataCw * 8;
    var term = Math.min(4, cap - bb.bits.length);
    bb.put(0, term);
    while (bb.bits.length % 8 !== 0) bb.bits.push(0);

    var dataCw = [];
    for (var b = 0; b < bb.bits.length; b += 8) {
      var byteVal = 0;
      for (var k = 0; k < 8; k++) byteVal = (byteVal << 1) | bb.bits[b + k];
      dataCw.push(byteVal);
    }
    var pad = [0xec, 0x11], p = 0;
    while (dataCw.length < info.dataCw) dataCw.push(pad[p++ % 2]);

    // 分块 + RS 纠错
    var blocks = [];
    var offset = 0;
    for (var g = 0; g < info.groups; g++) {
      var len = info.shortLen + (g >= info.groups - info.numLong ? 1 : 0);
      var blk = dataCw.slice(offset, offset + len);
      offset += len;
      blocks.push({ data: blk, ec: rsEncode(blk, info.ecPerBlock) });
    }

    // 交织
    var out = [];
    var maxLen = Math.max.apply(null, blocks.map(function (x) { return x.data.length; }));
    for (var c = 0; c < maxLen; c++) {
      for (var b2 = 0; b2 < blocks.length; b2++) {
        if (c < blocks[b2].data.length) out.push(blocks[b2].data[c]);
      }
    }
    for (var c2 = 0; c2 < info.ecPerBlock; c2++) {
      for (var b3 = 0; b3 < blocks.length; b3++) out.push(blocks[b3].ec[c2]);
    }
    if (out.length < info.total) out.push(0); // 剩余位补零

    var matrix = buildMatrix(version, ec, out);
    return { matrix: matrix, size: matrix.length, version: version, ec: ec };
  }

  /** 生成 SVG 字符串（二维码） */
  function svg(text, opts) {
    opts = opts || {};
    var quiet = opts.quiet === undefined ? 2 : opts.quiet;
    var dark = opts.dark || '#111111';
    var light = opts.light || '#ffffff';
    var r = encode(text, opts.ec || 'M');
    var n = r.size, total = n + quiet * 2;
    var parts = [];
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        if (r.matrix[y][x]) parts.push('M' + (x + quiet) + ' ' + (y + quiet) + 'h1v1h-1z');
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '" ' +
      'shape-rendering="crispEdges" width="100%" height="100%" role="img" aria-label="二维码">' +
      '<rect width="' + total + '" height="' + total + '" fill="' + light + '"/>' +
      '<path fill="' + dark + '" d="' + parts.join('') + '"/></svg>';
  }

  return {
    encode: encode,
    svg: svg,
    utf8Bytes: utf8Bytes,
    // 供自检使用
    _internals: {
      EC_BITS: EC_BITS, EC_COL: EC_COL, BLOCKS: BLOCKS, ALIGN: ALIGN,
      blockInfo: blockInfo, chooseVersion: chooseVersion,
      buildMatrix: buildMatrix, rsEncode: rsEncode, capBits: capBits, penalty: penalty
    }
  };
});
