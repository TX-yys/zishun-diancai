/**
 * 零依赖 MQTT over WebSocket 客户端（浏览器 / Node 通用）
 * 只实现收发订单所需的最小集合：CONNECT / CONNACK / SUBSCRIBE / SUBACK /
 * PUBLISH(QoS0) / PINGREQ / PINGRESP / DISCONNECT
 *
 * 用途：让「顾客点菜页」与「接单台」都是纯静态网页，无需任何服务器。
 */
(function (root) {
  'use strict';

  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    return new Uint8Array(Buffer.from(str, 'utf8'));
  }
  function utf8Decode(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
    return Buffer.from(bytes).toString('utf8');
  }
  function concat(arrays) {
    let len = 0;
    arrays.forEach((a) => { len += a.length; });
    const out = new Uint8Array(len);
    let off = 0;
    arrays.forEach((a) => { out.set(a, off); off += a.length; });
    return out;
  }
  /** MQTT 剩余长度变长编码 */
  function encodeLength(n) {
    const out = [];
    do {
      let b = n % 128;
      n = Math.floor(n / 128);
      if (n > 0) b |= 0x80;
      out.push(b);
    } while (n > 0);
    return new Uint8Array(out);
  }
  function decodeLength(bytes, pos) {
    let mul = 1, value = 0, i = pos;
    for (;;) {
      if (i >= bytes.length) return null;
      const b = bytes[i++];
      value += (b & 127) * mul;
      if ((b & 128) === 0) break;
      mul *= 128;
      if (mul > 128 * 128 * 128) return null;
    }
    return { value, next: i };
  }

  function Client(opts) {
    this.url = opts.url;
    this.clientId = opts.clientId || ('mqttjs_' + Math.random().toString(16).slice(2, 10));
    this.keepalive = opts.keepalive || 45;
    this.onMessage = opts.onMessage || function () {};
    this.onOpen = opts.onOpen || function () {};
    this.onClose = opts.onClose || function () {};
    this.onError = opts.onError || function () {};
    this.ws = null;
    this.connected = false;
    this._pingTimer = null;
    this._retry = 0;
    this._closedByUser = false;
  }

  Client.prototype.connect = function () {
    const self = this;
    this._closedByUser = false;
    let ws;
    try { ws = new WebSocket(this.url, ['mqtt']); } catch (e) { this.onError(e); return; }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = function () {
      const idBytes = utf8(self.clientId);
      const variable = new Uint8Array([
        0x00, 0x04, 0x4d, 0x51, 0x54, 0x54,   // 协议名 "MQTT"
        0x04,                                  // 协议级别 4
        0x02,                                  // 连接标志：clean session
        (self.keepalive >> 8) & 0xff, self.keepalive & 0xff
      ]);
      const payload = concat([new Uint8Array([(idBytes.length >> 8) & 0xff, idBytes.length & 0xff]), idBytes]);
      const body = concat([variable, payload]);
      ws.send(concat([new Uint8Array([0x10]), encodeLength(body.length), body]));
    };

    ws.onmessage = function (ev) {
      let bytes;
      if (ev.data instanceof ArrayBuffer) bytes = new Uint8Array(ev.data);
      else if (typeof Blob !== 'undefined' && ev.data instanceof Blob) {
        const fr = new FileReader();
        fr.onload = function () { self._handle(new Uint8Array(fr.result)); };
        fr.readAsArrayBuffer(ev.data);
        return;
      } else bytes = new Uint8Array(ev.data);
      self._handle(bytes);
    };

    ws.onerror = function (e) { self.onError(e); };
    ws.onclose = function () {
      self.connected = false;
      if (self._pingTimer) { clearInterval(self._pingTimer); self._pingTimer = null; }
      self.onClose();
      if (!self._closedByUser) {
        // 自动重连（指数退避，最长 30 秒）
        self._retry++;
        const delay = Math.min(30000, 1000 * Math.pow(1.6, Math.min(self._retry, 8)));
        setTimeout(function () { if (!self._closedByUser) self.connect(); }, delay);
      }
    };
  };

  Client.prototype._handle = function (bytes) {
    const type = bytes[0] >> 4;
    if (type === 2) {                     // CONNACK
      const rc = bytes[3];
      if (rc === 0) {
        this.connected = true;
        this._retry = 0;
        this._startPing();
        this.onOpen();
      } else {
        this.onError(new Error('MQTT 连接被拒，返回码 ' + rc));
      }
      return;
    }
    if (type === 3) {                     // PUBLISH (QoS0)
      const len = decodeLength(bytes, 1);
      if (!len) return;
      const pktEnd = len.next + len.value;   // 剩余长度字段之后 + 剩余长度 = 报文结束位置
      let pos = len.next;
      const topicLen = (bytes[pos] << 8) | bytes[pos + 1];
      pos += 2;
      const topic = utf8Decode(bytes.subarray(pos, pos + topicLen));
      pos += topicLen;
      const qos = (bytes[0] >> 1) & 3;
      if (qos > 0) pos += 2;              // 包标识符
      const payload = utf8Decode(bytes.subarray(pos, pktEnd));
      this.onMessage(topic, payload);
      return;
    }
    if (type === 13) return;               // PINGRESP
    if (type === 9) {                      // SUBACK
      return;
    }
  };

  Client.prototype._startPing = function () {
    const self = this;
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._pingTimer = setInterval(function () {
      if (self.ws && self.ws.readyState === 1) {
        self.ws.send(new Uint8Array([0xc0, 0x00]));   // PINGREQ
      }
    }, Math.max(10, this.keepalive - 10) * 1000);
  };

  /** 订阅主题，qos 固定 0 */
  Client.prototype.subscribe = function (topic) {
    if (!this.connected) return false;
    const t = utf8(topic);
    const payload = concat([new Uint8Array([0x00, 0x01]), new Uint8Array([(t.length >> 8) & 0xff, t.length & 0xff]), t, new Uint8Array([0x00])]);
    this.ws.send(concat([new Uint8Array([0x82]), encodeLength(payload.length), payload]));
    return true;
  };

  /** 发布消息，qos 固定 0；retain=true 时服务端保留最后一条（可用于补单） */
  Client.prototype.publish = function (topic, message, retain) {
    if (!this.connected) return false;
    const t = utf8(topic);
    const m = utf8(message);
    const body = concat([new Uint8Array([(t.length >> 8) & 0xff, t.length & 0xff]), t, m]);
    const header = 0x30 | (retain ? 0x01 : 0x00);
    this.ws.send(concat([new Uint8Array([header]), encodeLength(body.length), body]));
    return true;
  };

  Client.prototype.disconnect = function () {
    this._closedByUser = true;
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
    try { if (this.ws && this.ws.readyState === 1) this.ws.send(new Uint8Array([0xe0, 0x00])); } catch (e) {}
    try { if (this.ws) this.ws.close(); } catch (e) {}
  };

  const api = { Client: Client, utf8: utf8, utf8Decode: utf8Decode };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MQTTWS = api;
})(typeof self !== 'undefined' ? self : this);
