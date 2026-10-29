// オンライン(別々のスマホで同じ部屋に入る)のための通信。server/server.js とつながる。
// 試合の計算は各スマホがするので、送るのは「だれが何を選んだか」「試合の種」くらいの小さなメッセージだけ。

export class Net {
  constructor() {
    this.ws = null;
    this.listeners = new Set();
    this.you = null;
    this.room = null; // { code, host, members: [{ id, name }] }
  }

  get connected() {
    return !!this.ws && this.ws.readyState === 1;
  }

  get isHost() {
    return !!this.room && this.room.host === this.you;
  }

  // つなぐ。url は wss://〜(公開ページは https なので wss が必要)か、手元で試すときは ws://localhost:8787
  connect(url) {
    this.close();
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        reject(e);
        return;
      }
      this.ws = ws;
      const timer = setTimeout(() => {
        reject(new Error('つながりませんでした(時間切れ)'));
        ws.close();
      }, 6000);
      ws.onopen = () => {
        clearTimeout(timer);
        // ときどき ping を送って、つながりを保つ
        this.keep = setInterval(() => this.send({ t: 'ping' }), 25000);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('つながりませんでした'));
      };
      ws.onclose = () => {
        clearInterval(this.keep);
        if (this.ws === ws) {
          this.ws = null;
          this.room = null;
          this.emit({ t: 'closed' });
        }
      };
      ws.onmessage = (e) => {
        let m;
        try {
          m = JSON.parse(e.data);
        } catch {
          return;
        }
        if (m.t === 'room') {
          this.room = { code: m.code, host: m.host, members: m.members };
          if (m.you) this.you = m.you;
        }
        this.emit(m);
      };
    });
  }

  close() {
    if (!this.ws) return;
    const ws = this.ws;
    this.ws = null;
    this.room = null;
    clearInterval(this.keep);
    ws.close();
  }

  send(obj) {
    if (this.connected) this.ws.send(JSON.stringify(obj));
  }

  create(name) {
    this.send({ t: 'create', name });
  }

  join(code, name) {
    this.send({ t: 'join', code, name });
  }

  // 部屋の全員へ(自分にも届く)
  post(data) {
    this.send({ t: 'msg', data });
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(m) {
    for (const fn of this.listeners) fn(m);
  }
}
