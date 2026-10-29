// ウェポンバトルのオンライン用サーバー(部屋ごとのリアルタイム中継)。
// Node.js だけで動く(追加のパッケージ不要)。ラズパイやNASでも動かせる。
//
//   node server/server.js              … ポート 8787 で待ち受け
//   PORT=9000 node server/server.js    … ポートを変える
//
// しくみ: スマホ同士は WebSocket でこのサーバーにつなぎ、4文字の「部屋コード」で同じ部屋に入る。
// サーバーは部屋の中のメッセージを全員に配るだけ(試合の計算は各スマホがする。同じ種なら同じ試合になる)。
// 送れるもの(JSON):
//   { t: 'create', name }        部屋を作る → { t: 'room', code, you, host, members }
//   { t: 'join', code, name }    部屋に入る → 全員に { t: 'room', ... }
//   { t: 'msg', data }           部屋の全員へ → { t: 'msg', from, data }(自分にも届く)
//   { t: 'ping' }                → { t: 'pong' }
// 部屋から抜けると全員に { t: 'room', ... } が届く。ホストが抜けると次の人がホストになる。

import { createServer } from 'node:http';
import { createHash, randomInt } from 'node:crypto';

const PORT = Number(process.env.PORT || 8787);
const MAX_MEMBERS = 8;
const MAX_MESSAGE = 64 * 1024;
const MAX_ROOMS = 500;

const rooms = new Map(); // code → { code, members: Map<id, client>, host }
let nextId = 1;

function newCode() {
  // まぎらわしい文字(0/O, 1/I)を使わない4文字
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += chars[randomInt(chars.length)];
    if (!rooms.has(c)) return c;
  }
}

// ---- WebSocket(RFC 6455)の最小限の実装 ----

function encodeFrame(text) {
  const data = Buffer.from(text);
  const len = data.length;
  let head;
  if (len < 126) head = Buffer.from([0x81, len]);
  else if (len < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x81;
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x81;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, data]);
}

function send(client, obj) {
  if (client.closed) return;
  try {
    client.socket.write(encodeFrame(JSON.stringify(obj)));
  } catch {
    client.closed = true;
  }
}

// 受け取ったバイト列からフレームを取り出す(足りなければ待つ)
function readFrames(client, chunk) {
  client.buf = client.buf.length ? Buffer.concat([client.buf, chunk]) : chunk;
  for (;;) {
    const b = client.buf;
    if (b.length < 2) return;
    const op = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (b.length < 4) return;
      len = b.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (b.length < 10) return;
      len = Number(b.readBigUInt64BE(2));
      off = 10;
    }
    if (len > MAX_MESSAGE) return close(client);
    const need = off + (masked ? 4 : 0) + len;
    if (b.length < need) return;
    let data = b.subarray(off + (masked ? 4 : 0), need);
    if (masked) {
      const mask = b.subarray(off, off + 4);
      data = Buffer.from(data.map((v, i) => v ^ mask[i % 4]));
    }
    client.buf = b.subarray(need);
    if (op === 0x8) return close(client);
    if (op === 0x9) {
      // ping → pong
      client.socket.write(Buffer.concat([Buffer.from([0x8a, data.length]), data]));
      continue;
    }
    if (op === 0x1) onMessage(client, data.toString('utf8'));
  }
}

// ---- 部屋 ----

function roomInfo(room) {
  return {
    t: 'room',
    code: room.code,
    host: room.host,
    members: [...room.members.values()].map((c) => ({ id: c.id, name: c.name })),
  };
}

function broadcast(room, obj) {
  for (const c of room.members.values()) send(c, obj);
}

function leave(client) {
  const room = client.room && rooms.get(client.room);
  client.room = null;
  if (!room) return;
  room.members.delete(client.id);
  if (!room.members.size) {
    rooms.delete(room.code);
    return;
  }
  if (room.host === client.id) room.host = room.members.keys().next().value;
  broadcast(room, roomInfo(room));
}

const cleanName = (s) => String(s || 'ななし').replace(/[\u0000-\u001f<>]/g, '').slice(0, 12) || 'ななし';

function onMessage(client, text) {
  let m;
  try {
    m = JSON.parse(text);
  } catch {
    return;
  }
  if (!m || typeof m !== 'object') return;
  if (m.t === 'ping') return send(client, { t: 'pong' });
  if (m.t === 'create') {
    leave(client);
    if (rooms.size >= MAX_ROOMS) return send(client, { t: 'error', text: 'サーバーが混んでいます' });
    const room = { code: newCode(), members: new Map(), host: client.id };
    rooms.set(room.code, room);
    client.name = cleanName(m.name);
    client.room = room.code;
    room.members.set(client.id, client);
    send(client, { ...roomInfo(room), you: client.id });
    return;
  }
  if (m.t === 'join') {
    const room = rooms.get(String(m.code || '').toUpperCase().trim());
    if (!room) return send(client, { t: 'error', text: 'その部屋は見つかりませんでした' });
    if (room.members.size >= MAX_MEMBERS) return send(client, { t: 'error', text: '部屋がいっぱいです' });
    leave(client);
    client.name = cleanName(m.name);
    client.room = room.code;
    room.members.set(client.id, client);
    send(client, { ...roomInfo(room), you: client.id });
    broadcast(room, roomInfo(room));
    return;
  }
  if (m.t === 'msg') {
    const room = client.room && rooms.get(client.room);
    if (room) broadcast(room, { t: 'msg', from: client.id, data: m.data });
  }
}

function close(client) {
  if (client.closed) return;
  client.closed = true;
  leave(client);
  try {
    client.socket.end();
  } catch {
    // すでに切れている
  }
}

// ---- HTTP サーバー(WebSocket への切りかえ) ----

const server = createServer((req, res) => {
  // 動いているかの確認用
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(`weapon-battle server: rooms ${rooms.size}\n`);
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') return socket.destroy();
  const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '', ''].join('\r\n'));
  const client = { id: nextId++, socket, buf: Buffer.alloc(0), name: '', room: null, closed: false };
  socket.setNoDelay(true);
  socket.on('data', (chunk) => readFrames(client, chunk));
  socket.on('close', () => close(client));
  socket.on('error', () => close(client));
});

server.listen(PORT, () => console.log(`weapon-battle server: port ${PORT}`));

export { server, rooms };
