// ⚡ 操作バトル(オンライン): 試合の途中で、各自が自分のボールに「ダッシュ・ガード・覚醒」を指示できる。
// 見ている人は応援でエネルギーを送れる。DOM非依存(Nodeのテストからそのまま動く)。
//
// 同じ試合を全員のスマホで同じに保つしくみ(ロックステップ):
//   - 時計はホーム(部屋を作った人)。ホームは 0.1秒ごとに「ここまで進めてよい(upto)」と、
//     そのあいだに届いた操作を「何コマ目に効かせるか(f)」付きで全員に送る(tick)。
//   - 各スマホは upto より先へは進めない。操作は前の tick の upto のコマに効かせるので、
//     どのスマホもまだそのコマを計算していない → 全員が同じコマで同じ操作をする → 同じ結果になる。
//   - エネルギーが足りるかは試合の中で調べる(全員が同じ判定をする)。

import { step, foeOf, DT } from './engine.js';

export const LIVE_MAX_EN = 5;
export const LIVE_START_EN = 1;
export const LIVE_REGEN = 1 / 3; // 1秒あたり
export const LIVE_HURT_EN = 0.04; // 受けたダメージ1あたり
export const LIVE_CHEER_EN = 0.3;
export const LIVE_LEAD = 30; // ホームの時計より何コマ先まで進めてよいか(ふつうは liveLead で速さに合わせる)
export const LIVE_LEAD_SEC = 0.35; // 通信の遅れをこれくらい(実際の秒)までは止まらずに吸収する
export const LIVE_TICK_MS = 100;
export const CHECK_EVERY = 120; // 何コマごとに試合の中身をくらべるか

export const ACTIONS = {
  dash: { name: 'ダッシュ', icon: '💨', cost: 1, color: '#2f7de1', desc: 'いちばん近い相手へ突っこむ' },
  guard: { name: 'ガード', icon: '🛡️', cost: 2, color: '#2fa84f', desc: '1.5秒 受けるダメージ -75%' },
  rage: { name: '覚醒', icon: '🔥', cost: 3, color: '#e8484d', desc: '4秒 与えるダメージ ×1.6・攻撃速度 ×1.3' },
};
const GUARD_T = 1.5;
const RAGE_T = 4;
const RAGE_HASTE = 1.3;

// 操作バトルの力(カードの代わりにスキルのしくみで効かせる。HUDのカード欄には出さない)
const LIVE_SKILL = {
  id: 'live',
  hidden: true,
  incoming(world, me, src, amount, opts, st) {
    if (st.guard > 0) amount *= 0.25;
    if (src && src !== me) st.en = Math.min(LIVE_MAX_EN, st.en + amount * LIVE_HURT_EN);
    return amount;
  },
  outgoing(world, me, target, amount, opts, st) {
    return st.rage > 0 ? amount * 1.6 : amount;
  },
  update(world, me, foe, dt, st) {
    st.en = Math.min(LIVE_MAX_EN, st.en + LIVE_REGEN * dt);
    if (st.guard > 0) st.guard = Math.max(0, st.guard - dt);
    if (st.rage > 0) {
      st.rage -= dt;
      if (st.rage <= 0) {
        st.rage = 0;
        me.haste /= RAGE_HASTE;
      }
    }
  },
};

// 速さ(×1/×2/×4)に合わせた先読みのコマ数
export function liveLead(speed) {
  return Math.round((LIVE_LEAD_SEC * speed) / DT);
}

// 試合の全員に操作バトルの力を付ける(試合を始める前に1回)
export function enableLive(world) {
  for (const b of world.balls) {
    const st = { en: LIVE_START_EN, guard: 0, rage: 0, used: 0 };
    b.live = st;
    b.skills.push({ def: LIVE_SKILL, st });
  }
}

// 操作を試合に効かせる。効いたら true(エネルギー不足・倒れている・効果中は false)
export function applyAction(world, i, a, to = -1) {
  if (a === 'cheer') {
    const b = world.balls[to];
    if (!b || b.dead || !b.live) return false;
    b.live.en = Math.min(LIVE_MAX_EN, b.live.en + LIVE_CHEER_EN);
    world.events.push({ type: 'live', target: b.id, a, x: b.x, y: b.y });
    return true;
  }
  const b = world.balls[i];
  const act = ACTIONS[a];
  if (!b || b.dead || !b.live || !act || b.live.en < act.cost) return false;
  const st = b.live;
  if (a === 'guard' && st.guard > 0) return false;
  if (a === 'rage' && st.rage > 0) return false;
  st.en -= act.cost;
  st.used++;
  if (a === 'dash') {
    const foe = foeOf(world, b);
    if (foe) {
      const dx = foe.x - b.x;
      const dy = foe.y - b.y;
      const d = Math.hypot(dx, dy) || 1;
      b.vx = (dx / d) * 1100;
      b.vy = (dy / d) * 1100;
    }
  } else if (a === 'guard') {
    st.guard = GUARD_T;
  } else if (a === 'rage') {
    st.rage = RAGE_T;
    b.haste *= RAGE_HASTE;
  }
  world.events.push({ type: 'live', target: b.id, a, x: b.x, y: b.y });
  return true;
}

// 試合の中身の短い要約(スマホどうしでずれていないかをくらべる)
export function checksum(world) {
  let h = Math.round(world.t * 120);
  for (const b of world.balls) {
    h = (Math.imul(h, 31) + Math.round(b.hp * 100)) | 0;
    h = (Math.imul(h, 31) + Math.round(b.x * 10)) | 0;
    h = (Math.imul(h, 31) + Math.round(b.y * 10)) | 0;
  }
  return h;
}

// 各スマホ: 受け取った tick のとおりに試合を進める
export class LiveClock {
  constructor(world) {
    this.world = world;
    this.frame = 0;
    this.upto = 0;
    this.queue = new Map(); // コマ → [操作]
    this.sums = new Map(); // コマ → checksum
    this.check = null; // ホームから届いた { f, cs }
    this.desync = false;
  }

  receive(tick) {
    for (const a of tick.acts || []) {
      // すでに過ぎたコマの操作は効かせられない(ふつうは起きない)
      if (a.f < this.frame) continue;
      if (!this.queue.has(a.f)) this.queue.set(a.f, []);
      this.queue.get(a.f).push(a);
    }
    if (tick.upto > this.upto) this.upto = tick.upto;
    if (tick.check) {
      this.check = tick.check;
      this.compare();
    }
  }

  canStep() {
    return this.frame < this.upto && !this.world.over;
  }

  // 1コマ進める
  step() {
    const acts = this.queue.get(this.frame);
    if (acts) {
      this.queue.delete(this.frame);
      for (const a of acts) applyAction(this.world, a.i, a.a, a.to);
    }
    step(this.world, DT);
    this.frame++;
    if (this.frame % CHECK_EVERY === 0) {
      this.sums.set(this.frame, checksum(this.world));
      if (this.sums.size > 20) this.sums.delete(this.sums.keys().next().value);
      this.compare();
    }
  }

  compare() {
    const c = this.check;
    if (!c || !this.sums.has(c.f)) return;
    if (this.sums.get(c.f) !== c.cs) this.desync = true;
    this.check = null;
  }

  // 自分のコマ数と、ホームの時計(upto)とのずれ
  get behind() {
    return this.upto - this.frame;
  }
}

// ホーム: 時計を進めて、届いた操作にコマ番号を付けて配る
export class LiveHost {
  constructor(startFrame = 0, lead = LIVE_LEAD) {
    this.sent = startFrame;
    this.lead = lead;
    this.pending = [];
  }

  add(act) {
    this.pending.push(act);
  }

  // targetFrame: ホームの時計で「今」何コマ目か
  tick(targetFrame, clock = null) {
    const f = this.sent;
    const acts = this.pending.map((a) => ({ ...a, f }));
    this.pending = [];
    this.sent = Math.max(this.sent, Math.floor(targetFrame) + this.lead);
    const msg = { upto: this.sent, acts };
    // ホーム自身の最新の要約を付ける(ほかのスマホは同じコマでくらべる)
    if (clock && clock.sums.size) {
      const lastF = [...clock.sums.keys()].pop();
      msg.check = { f: lastF, cs: clock.sums.get(lastF) };
    }
    return msg;
  }
}
