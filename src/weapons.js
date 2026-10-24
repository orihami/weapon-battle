// 武器の定義。攻撃が当たるたびに onHit で能力値が成長する。
// stats() が返す値が画面下に表示される(動画の「Damage: 6」のような部分)。

import {
  ARENA,
  BASE_SPEED,
  foeOf,
  GRAVITY,
  makeBlade,
  landHit,
  dealDamage,
  heal,
  knockback,
  spawnProjectile,
  segPointDist,
} from './engine.js';

const TAU = Math.PI * 2;
const BOMB_RADIUS = 70;
const BOMB_DAMAGE = 0.9;
const BOMB_MAX = 30;
const SONIC_RANGE = 170;

function fmt(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function aimAt(me, foe) {
  return Math.atan2(foe.y - me.y, foe.x - me.x);
}

function setSpin(b, speed) {
  b.spin = Math.sign(b.spin || 1) * speed;
}

function shoot(world, me, angle, speed, extra) {
  spawnProjectile(world, me, {
    x: me.x + Math.cos(angle) * (me.r + 8),
    y: me.y + Math.sin(angle) * (me.r + 8),
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    angle,
    ...extra,
  });
}

// 成長に上限は付けない。見た目や仕組みの都合で限界(cap)がある値は、
// それを超えた分を「威力」(この武器が与えるダメージの倍率)に変えて伸ばし続ける
// over: 限界を超えた分がどれだけ威力に効くか(当たる回数が多い武器ほど小さくする)
function growStat(me, key, step, cap, over = 1) {
  const total = (me.w[key + 'T'] ?? me.w[key]) + step;
  me.w[key + 'T'] = total;
  me.w[key] = Math.min(total, cap);
  me.power = Math.max(me.power, 1 + Math.max(0, total - cap) / cap * over);
}

// 表示用: 上限を超えた分も含めた本当の値
function shown(b, key) {
  return b.w[key + 'T'] ?? b.w[key];
}

// 相手の方へ向きを変えながら進む(turn: 1秒に曲がれる角度)
function homing(p, foe, turn, dt, speed) {
  const want = Math.atan2(foe.y - p.y, foe.x - p.x);
  const cur = Math.atan2(p.vy, p.vx);
  const diff = ((want - cur + Math.PI) % TAU + TAU) % TAU - Math.PI;
  const a = cur + Math.max(-turn * dt, Math.min(turn * dt, diff));
  const sp = speed ?? Math.hypot(p.vx, p.vy);
  p.vx = Math.cos(a) * sp;
  p.vy = Math.sin(a) * sp;
  p.angle = a;
}

// 雷を1本落とす。delay 秒後に落ち、当たれば chain 回まで相手を追って連鎖する
function strike(world, me, x, y, delay, chain, big = true) {
  spawnProjectile(world, me, {
    x,
    y,
    kind: 'zap',
    r: big ? 46 : 38,
    life: delay,
    wall: 'stop',
    blockable: false,
    onExpire(world, p, owner, foe) {
      world.events.push({ type: 'zap', x: p.x, y: p.y, big });
      if (Math.hypot(foe.x - p.x, foe.y - p.y) < p.r + foe.r) {
        landHit(world, owner, foe, big ? 4 : 2, { kind: 'zap', x: foe.x, y: foe.y });
        foe.stun = Math.max(foe.stun, 0.2);
        knockback(p, foe, 180);
        if (chain > 0) strike(world, owner, foe.x + foe.vx * 0.15, foe.y + foe.vy * 0.15, 0.16, chain - 1, false);
      }
    },
  });
}

// スライム: 跳ねながら進み、当たると小さいスライム2匹に分裂する(小さいものは分裂しない)
function slimeBlob(world, me, x, y, angle, r, big) {
  spawnProjectile(world, me, {
    x,
    y,
    vx: Math.cos(angle) * (big ? 300 : 220),
    vy: Math.sin(angle) * (big ? 300 : 220) - 150,
    kind: 'slime',
    r,
    life: big ? 3 : 2,
    gravity: 0.7,
    wall: 'bounce',
    bounces: big ? 3 : 2,
    blockable: false,
    onTouch(world, p, owner, foe) {
      p.dead = true;
      // 分裂した小さいスライムは成長に数えない
      if (big) landHit(world, owner, foe, 1.2, { kind: 'slime', x: p.x, y: p.y });
      else dealDamage(world, owner, foe, 0.5, { kind: 'slime', x: p.x, y: p.y });
      if (big) for (const s of [-1, 1]) slimeBlob(world, owner, p.x, p.y, -Math.PI / 2 + s * 0.9, r * 0.65, false);
    },
  });
}

// 鏡の光の矢: (x, y) から相手に向けて撃つ
function mirrorBolt(world, me, foe, x, y) {
  const a = Math.atan2(foe.y - y, foe.x - x);
  spawnProjectile(world, me, {
    x,
    y,
    vx: Math.cos(a) * 620,
    vy: Math.sin(a) * 620,
    angle: a,
    kind: 'mirrorbolt',
    r: 6,
    blockGrace: 0.15,
    life: 1.5,
    damage: me.w.dmg,
    blockable: true,
    onTouch: hitOnce(),
  });
}

// 磁石が奪える弾(持ち主の状態を使わない、まっすぐ飛ぶ弾だけ)
const STEALABLE = new Set(['arrow', 'bolt', 'bullet', 'knife', 'shuriken', 'needle', 'fireball', 'icicle', 'mirrorbolt', 'arcane', 'feather', 'spiritsword', 'orbbullet', 'raindrop']);

// レーザーが壁で跳ね返る道すじ(線分の配列)
function traceBeam(x, y, angle, bounces) {
  const segs = [];
  let dx = Math.cos(angle);
  let dy = Math.sin(angle);
  for (let i = 0; i <= bounces; i++) {
    // 次に当たる壁までの距離
    const tx = dx > 0 ? (ARENA - x) / dx : dx < 0 ? -x / dx : Infinity;
    const ty = dy > 0 ? (ARENA - y) / dy : dy < 0 ? -y / dy : Infinity;
    const t = Math.min(tx, ty);
    const nx = x + dx * t;
    const ny = y + dy * t;
    segs.push([x, y, nx, ny]);
    x = nx;
    y = ny;
    if (tx <= ty) dx = -dx;
    if (ty <= tx) dy = -dy;
  }
  return segs;
}

// 一度だけ当たって消える弾
function hitOnce(info = {}) {
  return (world, p, owner, foe) => {
    p.dead = true;
    landHit(world, owner, foe, p.damage, { kind: p.kind, x: p.x, y: p.y, projectile: p, ...info });
  };
}

// 範囲ダメージ(爆発・ポーション)
function explode(world, p, owner, foe, radius, damage, kind) {
  p.dead = true;
  world.events.push({ type: 'boom', x: p.x, y: p.y, radius, kind });
  // 範囲に入った相手全員に当たる(1対1では相手1人だけ)
  for (const o of world.balls) {
    if (o === owner || o.dead) continue;
    if (Math.hypot(o.x - p.x, o.y - p.y) < radius + o.r) {
      landHit(world, owner, o, damage, { kind, x: o.x, y: o.y });
      knockback(p, o, 140);
    }
  }
}

// 分裂キューブ: 壁か相手に当たると2つに割れる(gen が残っている間)
function cube(world, me, x, y, angle, r, gen) {
  spawnProjectile(world, me, {
    x: Math.max(r, Math.min(ARENA - r, x)),
    y: Math.max(r, Math.min(ARENA - r, y)),
    vx: Math.cos(angle) * 380,
    vy: Math.sin(angle) * 380,
    angle,
    kind: 'cube',
    r,
    gen,
    life: 3,
    wall: 'bounce',
    bounces: 0,
    damage: 1.5,
    blockable: false,
    update(world, p, owner, foe, dt) {
      p.angle += dt * 5;
    },
    onTouch(world, p, owner, o) {
      p.dead = true;
      landHit(world, owner, o, p.damage, { kind: 'cube', x: p.x, y: p.y });
      splitCube(world, p, owner, o);
    },
    onExpire: (world, p, owner, foe) => splitCube(world, p, owner, foe),
  });
}

function splitCube(world, p, owner, foe) {
  if (p.gen <= 1 || p.age < 0.05) return;
  const a = Math.atan2(foe.y - p.y, foe.x - p.x);
  for (const s of [-0.6, 0.6]) cube(world, owner, p.x, p.y, a + s, p.r * 0.8, p.gen - 1);
}

// 風船が割れたら矢を3本
function popBalloon(world, p, owner, foe) {
  world.events.push({ type: 'boom', x: p.x, y: p.y, radius: 26, kind: 'potion' });
  const a = Math.atan2(foe.y - p.y, foe.x - p.x);
  for (const s of [-0.25, 0, 0.25]) {
    spawnProjectile(world, owner, {
      x: p.x,
      y: p.y,
      vx: Math.cos(a + s) * 520,
      vy: Math.sin(a + s) * 520,
      angle: a + s,
      kind: 'dart',
      r: 4,
      life: 1.4,
      damage: 0.7,
      onTouch: hitOnce(),
    });
  }
}

// 回転する近接武器の共通定義
function melee(id, o) {
  return {
    id,
    kind: 'melee',
    init(b) {
      b.w = { ...o.state };
      setSpin(b, o.spin);
      // 動画に合わせて武器を長め(ボールの直径くらい外へ出る)にする。盾は体に沿わせるので除く
      const reach = id === 'shield' ? 0 : 26;
      b.blades = [makeBlade({ sprite: id, ...o.blade, rOut: o.blade.rOut + reach, damage: o.damage })];
      if (o.after) o.after(b);
    },
    ...o.extra,
  };
}

export const WEAPONS = [
  {
    ...melee('sword', {
      spin: 4,
      state: { dmg: 1 },
      blade: { rIn: 22, rOut: 96, w: 10 },
      damage: (w, me) => me.w.dmg,
    }),
    name: '剣',
    en: 'Sword',
    color: '#e8484d',
    grow: '当たるたびに ダメージ +1',
    stats: (b) => [['ダメージ', fmt(b.w.dmg)]],
    onHit(world, me) {
      me.w.dmg += 1;
    },
  },
  {
    ...melee('dagger', {
      spin: 10,
      state: { dmg: 2, spd: 10 },
      blade: { rIn: 20, rOut: 68, w: 8, cd: 0.1 },
      damage: (w, me) => me.w.dmg,
    }),
    name: '短剣',
    en: 'Dagger',
    color: '#2fc23a',
    grow: '当たるたびに 回転速度 アップ',
    stats: (b) => [['回転速度', fmt(Math.round(shown(b, 'spd') * 30))]],
    onHit(world, me) {
      growStat(me, 'spd', 2.2, 40);
      setSpin(me, me.w.spd);
    },
  },
  {
    ...melee('spear', {
      spin: 3.6,
      state: {},
      blade: { rIn: 20, rOut: 120, w: 8 },
      damage: 4,
    }),
    name: '槍',
    en: 'Spear',
    color: '#3f7fd9',
    grow: '当たるたびに 長さ +10',
    stats: (b) => [['長さ', fmt(b.w.lenT ?? b.blades[0].rOut)]],
    onHit(world, me) {
      me.w.len ??= me.blades[0].rOut;
      growStat(me, 'len', 10, 300);
      me.blades[0].rOut = me.w.len;
    },
  },
  {
    ...melee('axe', {
      spin: 2.8,
      state: { dmg: 3 },
      blade: { rIn: 22, rOut: 92, w: 14, knock: 200 },
      damage: (w, me) => me.w.dmg,
    }),
    name: '斧',
    en: 'Axe',
    color: '#a0662b',
    grow: '当たるたびに ダメージ +1.5(ただし回転が少し遅くなる)',
    stats: (b) => [
      ['ダメージ', fmt(b.w.dmg)],
      ['回転速度', fmt(Math.round(Math.abs(b.spin) * 30))],
    ],
    onHit(world, me) {
      me.w.dmg += 1.5;
      setSpin(me, Math.max(1.2, Math.abs(me.spin) * 0.92));
    },
  },
  {
    ...melee('hammer', {
      spin: 3.4,
      state: { stun: 0.3 },
      blade: { rIn: 22, rOut: 90, w: 16, knock: 320 },
      damage: 7,
    }),
    name: 'ハンマー',
    en: 'Hammer',
    color: '#7d7f86',
    grow: '当たるたびに 気絶時間 +0.1秒',
    stats: (b) => [['気絶', fmt(Math.round(shown(b, 'stun') * 10) / 10) + '秒']],
    onHit(world, me, foe) {
      foe.stun = Math.max(foe.stun, me.w.stun);
      growStat(me, 'stun', 0.1, 1.5);
    },
  },
  {
    ...melee('katana', {
      spin: 4.6,
      state: { crit: 10 },
      blade: { rIn: 22, rOut: 100, w: 7 },
      damage(world, me) {
        const crit = world.rng() * 100 < me.w.crit;
        me.w.lastCrit = crit;
        return crit ? 12 : 4;
      },
    }),
    name: '刀',
    en: 'Katana',
    color: '#c01f6b',
    grow: '当たるたびに 会心率 +5%(会心は3倍。100%を超えると威力が上がる)',
    stats: (b) => [['会心率', fmt(shown(b, 'crit')) + '%']],
    onHit(world, me) {
      growStat(me, 'crit', 5, 100);
    },
  },
  {
    ...melee('scythe', {
      spin: 3.6,
      state: {},
      blade: { rIn: 22, rOut: 94, w: 10 },
      damage: 1,
    }),
    name: '鎌',
    en: 'Scythe',
    color: '#8b3fe0',
    grow: '当たるたびに 毒 +1(毒はずっと続く)',
    stats: (b, world) => [['毒', fmt(world ? foeOf(world, b).poison : 0)]],
    onHit(world, me, foe) {
      foe.poison += 1;
      foe.poisonSrc = me.id;
    },
  },
  {
    ...melee('whip', {
      spin: 4,
      state: {},
      blade: { rIn: 26, rOut: 120, w: 7, knock: 80, parry: false },
      damage: 3,
    }),
    name: 'ムチ',
    en: 'Whip',
    color: '#c47a2c',
    grow: '当たるたびに 長さ +10(刃で防がれない)',
    stats: (b) => [['長さ', fmt(b.w.lenT ?? b.blades[0].rOut)]],
    onHit(world, me) {
      me.w.len ??= me.blades[0].rOut;
      growStat(me, 'len', 10, 320);
      me.blades[0].rOut = me.w.len;
    },
  },
  {
    ...melee('trident', {
      spin: 3.4,
      state: { dmg: 1, pull: 1 },
      blade: { rIn: 22, rOut: 100, w: 10 },
      damage: (w, me) => me.w.dmg,
    }),
    name: '三叉槍',
    en: 'Trident',
    color: '#3341a8',
    grow: '当たるたびに ダメージと引き寄せ +1',
    stats: (b) => [['ダメージ/引力', fmt(b.w.dmg)]],
    update(world, me, foe, dt) {
      // 渦: 相手を自分の方へ引き寄せる
      const dx = me.x - foe.x;
      const dy = me.y - foe.y;
      const d = Math.hypot(dx, dy) || 1;
      const acc = me.w.pull * 45;
      foe.vx += (dx / d) * acc * dt;
      foe.vy += (dy / d) * acc * dt;
    },
    onHit(world, me) {
      me.w.dmg += 1;
      me.w.pull += 1;
    },
  },
  {
    ...melee('scepter', {
      spin: 4,
      state: { heal: 3 },
      blade: { rIn: 22, rOut: 88, w: 10 },
      damage: 6,
    }),
    name: '王笏',
    en: 'Scepter',
    color: '#e86bc4',
    grow: '当たるたびに 回復量 +1(当てると回復)',
    stats: (b) => [['吸収/回復', fmt(b.w.heal)]],
    onHit(world, me) {
      heal(world, me, me.w.heal);
      me.w.heal += 1;
    },
  },
  {
    ...melee('lance', {
      spin: 0,
      state: { joust: 2 },
      blade: { rIn: 20, rOut: 120, w: 8, cd: 0.6, knock: 220 },
      damage(world, me) {
        const sp = Math.hypot(me.vx, me.vy);
        return Math.max(1, Math.round(me.w.joust * (sp / (BASE_SPEED * 2))));
      },
    }),
    name: 'ランス',
    en: 'Lance',
    color: '#d9c25b',
    grow: '当たるたびに 突撃ダメージ +0.5(速いほど痛い・進む向きに構える)',
    stats: (b) => [['突撃ダメージ', fmt(b.w.joust)]],
    update(world, me, foe, dt) {
      // 進行方向へ槍先を向ける
      const target = Math.atan2(me.vy, me.vx);
      let diff = ((target - me.angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
      me.angle += diff * Math.min(1, dt * 8);
    },
    onParry(world, me) {
      me.vx = -me.vx;
      me.vy = -me.vy;
    },
    onHit(world, me) {
      me.w.joust += 0.5;
    },
  },
  {
    ...melee('shield', {
      spin: 2.4,
      state: { width: 2.5, reflect: 1 },
      blade: { rIn: 40, rOut: 54, w: 35, knock: 260 },
      damage: 1,
    }),
    name: '盾',
    en: 'Shield',
    color: '#b8860b',
    grow: '防ぐたびに 幅+0.25・反射ダメージ+1',
    stats: (b) => [
      ['幅', fmt(shown(b, 'width'))],
      ['反射ダメージ', fmt(b.w.reflect)],
    ],
    onParry(world, me, foe) {
      dealDamage(world, me, foe, me.w.reflect, { kind: 'reflect' });
      grow(me);
    },
    onBlock(world, me, foe) {
      dealDamage(world, me, foe, me.w.reflect, { kind: 'reflect' });
      grow(me);
    },
    onHit(world, me) {
      grow(me);
    },
  },
  {
    id: 'orb',
    kind: 'aura',
    name: 'オーブ',
    en: 'Orb',
    color: '#5ad6c4',
    grow: '広がる光の輪の中の相手にダメージ。当たるたびに 範囲とDPSが成長',
    init(b) {
      // 光の輪は 0 → range まで広がって消える、をくり返す
      b.w = { range: 160, dps: 6.5, tick: 0, phase: 0, cur: 0 };
      setSpin(b, 2);
    },
    stats: (b) => [
      ['DPS', fmt(Math.round(b.w.dps * 10) / 10)],
      ['範囲', fmt(Math.round(shown(b, 'range')))],
    ],
    update(world, me, foe, dt) {
      me.w.phase = (me.w.phase + dt / 1.4) % 1;
      me.w.cur = me.w.range * Math.min(1, me.w.phase * 1.25);
      me.w.tick += dt;
      if (me.w.tick >= 0.25) {
        me.w.tick -= 0.25;
        if (Math.hypot(foe.x - me.x, foe.y - me.y) < me.w.cur + foe.r) {
          landHit(world, me, foe, me.w.dps * 0.25, { kind: 'aura' });
        }
      }
    },
    onHit(world, me) {
      growStat(me, 'range', 3, 300);
      me.w.dps += 0.35;
    },
  },
  {
    id: 'orbital',
    kind: 'orbital',
    name: 'オービタル',
    en: 'Orbital',
    color: '#119c9c',
    grow: '2回当たるたびに 周回する玉 +1',
    init(b) {
      b.w = { n: 2, cds: [0, 0], dist: 95 };
      setSpin(b, 3);
    },
    stats: (b) => [['周回玉', fmt(Math.floor(shown(b, 'n')))]],
    orbiters(b) {
      const out = [];
      const n = Math.floor(b.w.n);
      for (let i = 0; i < n; i++) {
        const a = b.angle + (i * TAU) / n;
        out.push([b.x + Math.cos(a) * b.w.dist, b.y + Math.sin(a) * b.w.dist]);
      }
      return out;
    },
    update(world, me, foe, dt) {
      const pts = this.orbiters(me);
      for (let i = 0; i < pts.length; i++) {
        if (me.w.cds[i] > 0) {
          me.w.cds[i] -= dt;
          continue;
        }
        const [x, y] = pts[i];
        if (Math.hypot(foe.x - x, foe.y - y) < foe.r + 9) {
          me.w.cds[i] = 0.6;
          landHit(world, me, foe, 1.4, { kind: 'orbital', x, y });
        }
      }
    },
    onHit(world, me) {
      growStat(me, 'n', 0.5, 10, 0.3);
      while (me.w.cds.length < me.w.n) me.w.cds.push(0.3);
    },
  },
  {
    id: 'flail',
    kind: 'flail',
    name: 'フレイル',
    en: 'Flail',
    color: '#e0725a',
    grow: '当たるたびに ダメージ +2・トゲ球が大きくなる',
    init(b) {
      b.w = { dmg: 4.5, size: 14, len: 115, hx: b.x + 95, hy: b.y, hvx: 0, hvy: 0, cd: 0 };
      setSpin(b, 4);
    },
    stats: (b) => [['ダメージ/大きさ', fmt(b.w.dmg)]],
    update(world, me, foe, dt) {
      const w = me.w;
      // 鎖の先の鉄球: 持ち主のまわりを振り回す力 + 鎖の長さの拘束
      let dx = w.hx - me.x;
      let dy = w.hy - me.y;
      let d = Math.hypot(dx, dy) || 1;
      const tx = (-dy / d) * Math.sign(me.spin);
      const ty = (dx / d) * Math.sign(me.spin);
      w.hvx += tx * 1400 * dt;
      w.hvy += ty * 1400 * dt;
      w.hvy += GRAVITY * 0.5 * dt;
      w.hvx *= 1 - Math.min(1, dt * 1.5);
      w.hvy *= 1 - Math.min(1, dt * 1.5);
      w.hx += w.hvx * dt;
      w.hy += w.hvy * dt;
      dx = w.hx - me.x;
      dy = w.hy - me.y;
      d = Math.hypot(dx, dy) || 1;
      if (d > w.len) {
        const nx = dx / d;
        const ny = dy / d;
        w.hx = me.x + nx * w.len;
        w.hy = me.y + ny * w.len;
        const radial = w.hvx * nx + w.hvy * ny;
        if (radial > 0) {
          w.hvx -= radial * nx;
          w.hvy -= radial * ny;
        }
      }
      me.angle = Math.atan2(w.hy - me.y, w.hx - me.x);
      if (w.cd > 0) {
        w.cd -= dt;
        return;
      }
      if (Math.hypot(foe.x - w.hx, foe.y - w.hy) < foe.r + w.size) {
        w.cd = 0.35;
        landHit(world, me, foe, w.dmg, { kind: 'flail', x: w.hx, y: w.hy });
        knockback({ x: w.hx - w.hvx, y: w.hy - w.hvy }, foe, 160);
      }
    },
    onHit(world, me) {
      me.w.dmg += 2;
      growStat(me, 'size', 1.5, 30);
    },
  },
  {
    id: 'bomb',
    kind: 'ranged',
    name: '爆弾',
    en: 'Bomb',
    color: '#f59a0c',
    grow: '爆発が2回当たるたびに 投げる数 +1(近くの爆弾に誘爆する)',
    init(b) {
      b.w = { bombs: 2, timer: 1 };
    },
    stats: (b) => [['爆弾', fmt(Math.floor(shown(b, 'bombs')))]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2.3;
      const dist = Math.hypot(foe.x - me.x, foe.y - me.y);
      for (let i = 0; i < Math.floor(me.w.bombs); i++) {
        // 相手のあたりに散らばるように投げる(少し上向きに放る)
        const a = me.angle + (world.rng() - 0.5) * 1.6 - 0.25;
        const sp = Math.max(140, Math.min(480, dist * (0.7 + world.rng() * 0.6)));
        shoot(world, me, a, sp, {
          kind: 'bomb',
          r: 9,
          life: 1.2 + world.rng() * 0.4,
          gravity: 0.35,
          wall: 'bounce',
          blockable: false,
          update(world, p, owner, foe, dt) {
            p.vx *= 1 - Math.min(1, dt * 1.2);
          },
          // 相手に触れたらその場で爆発
          onTouch: (world, p) => (p.life = Math.min(p.life, p.age)),
          onExpire(world, p, owner, foe) {
            explode(world, p, owner, foe, BOMB_RADIUS, BOMB_DAMAGE, 'bomb');
            // 誘爆: 近くにある自分の爆弾もすぐ爆発する
            for (const q of world.projectiles) {
              if (q !== p && !q.dead && q.owner === p.owner && q.kind === 'bomb' && Math.hypot(q.x - p.x, q.y - p.y) < BOMB_RADIUS) {
                q.life = Math.min(q.life, q.age + 0.08);
              }
            }
          },
        });
      }
    },
    onHit(world, me) {
      growStat(me, 'bombs', 0.5, BOMB_MAX);
    },
  },
  {
    id: 'crossbow',
    kind: 'ranged',
    name: 'クロスボウ',
    en: 'Crossbow',
    color: '#6fae2a',
    grow: '矢が当たるたびに ダメージ +1',
    init(b) {
      b.w = { dmg: 2, timer: 0.6 };
    },
    stats: (b) => [['ダメージ', fmt(b.w.dmg)]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.2;
      shoot(world, me, me.angle, 650, { kind: 'bolt', r: 5, life: 2, damage: me.w.dmg, onTouch: hitOnce() });
    },
    onHit(world, me) {
      me.w.dmg += 1;
    },
  },
  {
    id: 'bow',
    kind: 'ranged',
    name: '弓',
    en: 'Bow',
    color: '#9a6b3d',
    grow: '矢が2回当たるたびに 同時に撃つ矢 +1',
    init(b) {
      b.w = { arrows: 1, timer: 0.8 };
    },
    stats: (b) => [['矢の数', fmt(Math.floor(shown(b, 'arrows')))]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.1;
      const n = Math.floor(me.w.arrows);
      for (let i = 0; i < n; i++) {
        const a = me.angle + (i - (n - 1) / 2) * 0.12;
        shoot(world, me, a, 520, { kind: 'arrow', r: 4, life: 2, damage: 1, onTouch: hitOnce() });
      }
    },
    onHit(world, me) {
      growStat(me, 'arrows', 0.5, 10, 0.4);
    },
  },
  {
    id: 'potion',
    kind: 'ranged',
    name: 'ポーション',
    en: 'Potion',
    color: '#d6335a',
    grow: '当たるたびに 威力倍率 +0.35',
    init(b) {
      b.w = { buff: 1, timer: 0.8 };
    },
    stats: (b) => [['威力倍率', fmt(b.w.buff)]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.6;
      const dmg = 4 * me.w.buff;
      shoot(world, me, me.angle + (world.rng() - 0.5) * 0.3, 380, {
        kind: 'potion',
        r: 8,
        blockable: false,
        life: 0.9,
        spinRate: 10,
        update(world, p, owner, foe, dt) {
          p.angle += p.spinRate * dt;
        },
        onTouch: (world, p, owner, foe) => explode(world, p, owner, foe, 70, dmg, 'potion'),
        onExpire: (world, p, owner, foe) => explode(world, p, owner, foe, 70, dmg, 'potion'),
      });
    },
    onHit(world, me) {
      me.w.buff += 0.35;
    },
  },
  {
    id: 'wand',
    kind: 'ranged',
    name: '炎の杖',
    en: 'Fire Wand',
    color: '#ff6a1a',
    grow: '当たるたびに 火の玉のダメージ +1(やけど付き)',
    init(b) {
      b.w = { dmg: 2, timer: 0.8 };
    },
    stats: (b) => [['ダメージ', fmt(b.w.dmg)]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2.6;
      shoot(world, me, me.angle + (world.rng() - 0.5) * 1.2, 300, {
        kind: 'fireball',
        r: 8,
        life: 4,
        wall: 'bounce',
        damage: me.w.dmg,
        update(world, p, owner, foe, dt) {
          // ゆるく追尾する
          const want = Math.atan2(foe.y - p.y, foe.x - p.x);
          const cur = Math.atan2(p.vy, p.vx);
          let diff = ((want - cur + Math.PI) % TAU + TAU) % TAU - Math.PI;
          const turn = Math.max(-2.5 * dt, Math.min(2.5 * dt, diff));
          const sp = Math.hypot(p.vx, p.vy);
          p.vx = Math.cos(cur + turn) * sp;
          p.vy = Math.sin(cur + turn) * sp;
          p.angle = cur + turn;
        },
        onTouch(world, p, owner, foe) {
          p.dead = true;
          if (landHit(world, owner, foe, p.damage, { kind: 'fireball', x: p.x, y: p.y }) > 0) {
            foe.burnT = 3;
            foe.burnDps = 1;
            foe.burnSrc = owner.id;
          }
        },
      });
    },
    onHit(world, me) {
      me.w.dmg += 1;
    },
  },
  {
    id: 'ice',
    kind: 'ranged',
    name: '氷の杖',
    en: 'Ice Staff',
    color: '#58b7ff',
    grow: '当たるたびに 相手を遅くする量 +5%',
    init(b) {
      b.w = { slow: 20, timer: 0.6 };
    },
    stats: (b) => [['減速', fmt(shown(b, 'slow')) + '%']],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.0;
      shoot(world, me, me.angle, 460, {
        kind: 'frost',
        r: 7,
        blockable: false,
        life: 2,
        damage: 5,
        onTouch(world, p, owner, foe) {
          p.dead = true;
          const slow = owner.w.slow / 100;
          if (landHit(world, owner, foe, p.damage, { kind: 'frost', x: p.x, y: p.y }) > 0) {
            foe.slow = Math.max(foe.slow, slow);
            foe.slowT = 2.5;
          }
        },
      });
    },
    onHit(world, me) {
      growStat(me, 'slow', 5, 60);
    },
  },
  {
    id: 'boomerang',
    kind: 'ranged',
    name: 'ブーメラン',
    en: 'Boomerang',
    color: '#d1a03f',
    grow: '当たるたびに ダメージ +1.5(戻ってくる)',
    init(b) {
      b.w = { dmg: 7, out: false, timer: 0.5 };
    },
    stats: (b) => [['ダメージ', fmt(b.w.dmg)]],
    update(world, me, foe, dt) {
      if (!me.w.out) me.angle = aimAt(me, foe);
      if (me.w.out) return;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.out = true;
      shoot(world, me, me.angle, 600, {
        kind: 'boomerang',
        r: 10,
        life: 6,
        wall: 'bounce',
        blockable: false,
        damage: me.w.dmg,
        hitDone: false,
        update(world, p, owner, foe, dt) {
          p.angle += 18 * dt;
          if (p.age > 0.55) {
            // 持ち主へ戻る
            const dx = owner.x - p.x;
            const dy = owner.y - p.y;
            const d = Math.hypot(dx, dy) || 1;
            p.vx += (dx / d) * 1600 * dt;
            p.vy += (dy / d) * 1600 * dt;
            const sp = Math.hypot(p.vx, p.vy);
            if (sp > 560) {
              p.vx *= 560 / sp;
              p.vy *= 560 / sp;
            }
            if (d < owner.r + p.r) p.dead = true;
          }
          if (p.dead) {
            owner.w.out = false;
            owner.w.timer = 0.3;
          }
        },
        onExpire(world, p, owner) {
          owner.w.out = false;
          owner.w.timer = 0.3;
        },
        onTouch(world, p, owner, foe) {
          if (p.hitDone) return;
          p.hitDone = true;
          landHit(world, owner, foe, p.damage, { kind: 'boomerang', x: p.x, y: p.y });
          knockback(p, foe, 120);
        },
      });
    },
    onHit(world, me) {
      me.w.dmg += 1.2;
    },
  },
  {
    id: 'unarmed',
    kind: 'body',
    name: '素手',
    en: 'Unarmed',
    color: '#9aa0a6',
    grow: '体当たりが当たるたびに 最高速度 アップ(速いほど痛い)',
    init(b) {
      b.w = { spd: 1.1 };
      b.speedMul = 1.1;
    },
    stats: (b) => [
      ['最高速度', fmt(Math.round(shown(b, 'spd') * 10) / 10)],
      ['ダメージ', fmt(Math.round(b.speedMul * 1.8))],
    ],
    onContact(world, me, foe) {
      landHit(world, me, foe, Math.round(me.speedMul * 1.8), { kind: 'punch' });
      knockback(me, foe, 160);
    },
    update(world, me) {
      me.angle = Math.atan2(me.vy, me.vx);
    },
    onHit(world, me) {
      growStat(me, 'spd', 0.1, 3);
      me.speedMul = me.w.spd;
    },
  },
  {
    id: 'spike',
    kind: 'body',
    name: 'トゲトゲ',
    en: 'Spikes',
    color: '#5c6b2e',
    grow: 'ぶつかるたびに トゲダメージ +0.25(近接攻撃を受けると反撃)',
    init(b) {
      b.w = { thorns: 2 };
      b.speedMul = 1.0;
      setSpin(b, 1.5);
    },
    stats: (b) => [['トゲ', fmt(b.w.thorns)]],
    onContact(world, me, foe) {
      landHit(world, me, foe, me.w.thorns, { kind: 'thorns' });
      knockback(me, foe, 120);
    },
    onTakeDamage(world, me, src, amount, opts) {
      if (src && opts.kind === 'melee') dealDamage(world, me, src, Math.ceil(me.w.thorns / 3), { kind: 'reflect' });
      return amount;
    },
    onHit(world, me) {
      me.w.thorns += 0.25;
    },
  },
  {
    id: 'cluster',
    kind: 'ranged',
    name: 'クラスター',
    en: 'Cluster Bomb',
    color: '#e0662a',
    grow: '2回当たるたびに 分裂する子爆弾 +1',
    init(b) {
      b.w = { split: 2, timer: 1.2 };
    },
    stats: (b) => [['子爆弾', fmt(Math.floor(shown(b, 'split')))]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2.6;
      const split = Math.floor(me.w.split);
      const dist = Math.hypot(foe.x - me.x, foe.y - me.y);
      shoot(world, me, me.angle - 0.15, 380, {
        kind: 'bomb',
        r: 11,
        life: Math.max(0.3, Math.min(1.1, dist / 380)),
        gravity: 0.4,
        wall: 'bounce',
        blockable: false,
        onTouch: (world, p) => (p.life = p.age),
        onExpire(world, p, owner, foe) {
          explode(world, p, owner, foe, 50, 3, 'bomb');
          for (let i = 0; i < split; i++) {
            const a = (i / split) * TAU + world.rng() * 0.5;
            const sp = 120 + world.rng() * 160;
            spawnProjectile(world, owner, {
              x: p.x,
              y: p.y,
              vx: Math.cos(a) * sp,
              vy: Math.sin(a) * sp - 120,
              kind: 'minibomb',
              r: 6,
              life: 0.5 + world.rng() * 0.4,
              gravity: 0.6,
              wall: 'bounce',
              blockable: false,
              onTouch: (world, q) => (q.life = Math.min(q.life, q.age)),
              onExpire: (world, q, owner, foe) => explode(world, q, owner, foe, 42, 1.5, 'bomb'),
            });
          }
        },
      });
    },
    onHit(world, me) {
      growStat(me, 'split', 0.5, 12, 0.4);
    },
  },
  {
    id: 'mine',
    kind: 'ranged',
    name: '地雷',
    en: 'Mines',
    color: '#7b8a3a',
    grow: '当たるたびに 置ける地雷の数 +1',
    init(b) {
      b.w = { max: 1, timer: 0.5 };
    },
    stats: (b) => [['地雷', fmt(shown(b, 'max'))]],
    update(world, me, foe, dt) {
      me.angle += dt * 2;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.0;
      const mine = world.projectiles.filter((p) => p.owner === me.id && p.kind === 'mine');
      if (mine.length >= me.w.max) mine[0].dead = true; // 一番古いものを消して置き直す
      spawnProjectile(world, me, {
        kind: 'mine',
        r: 10,
        life: 40,
        wall: 'stop',
        blockable: false,
        onTouch(world, p, owner, foe) {
          if (p.age < 0.6) return; // 置いてすぐは作動しない
          explode(world, p, owner, foe, 60, 4, 'bomb');
        },
      });
    },
    onHit(world, me) {
      growStat(me, 'max', 1, 12);
    },
  },
  {
    id: 'meteor',
    kind: 'ranged',
    name: '隕石',
    en: 'Meteor',
    color: '#b5482b',
    grow: '当たるたびに 降らせる隕石 +1',
    init(b) {
      b.w = { n: 1, timer: 1 };
    },
    stats: (b) => [['隕石', fmt(shown(b, 'n'))]],
    update(world, me, foe, dt) {
      me.angle = -Math.PI / 2;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2.2;
      for (let i = 0; i < me.w.n; i++) {
        // 相手のいるあたりの上空から、少しずつずらして降らせる
        const x = Math.max(20, Math.min(ARENA - 20, foe.x + (world.rng() - 0.5) * 260));
        spawnProjectile(world, me, {
          x,
          y: 14,
          vx: (world.rng() - 0.5) * 60,
          vy: 60 + i * 25,
          kind: 'meteor',
          r: 12,
          life: 3,
          gravity: 0.8,
          wall: 'die',
          blockable: false,
          onTouch: (world, p, owner, foe) => explode(world, p, owner, foe, 45, 3, 'bomb'),
          onExpire: (world, p, owner, foe) => explode(world, p, owner, foe, 45, 3, 'bomb'),
        });
      }
    },
    onHit(world, me) {
      growStat(me, 'n', 1, 14);
    },
  },
  {
    id: 'missile',
    kind: 'ranged',
    name: 'ミサイル',
    en: 'Missiles',
    color: '#5f6f86',
    grow: '当たるたびに 同時に撃つミサイル +1',
    init(b) {
      b.w = { n: 1, timer: 0.8 };
    },
    stats: (b) => [['ミサイル', fmt(shown(b, 'n'))]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2.0;
      for (let i = 0; i < me.w.n; i++) {
        const a = me.angle + Math.PI + (i - (me.w.n - 1) / 2) * 0.35;
        shoot(world, me, a, 220, {
          kind: 'missile',
          r: 6,
          life: 3.5,
          wall: 'die',
          damage: 2,
          update: (world, p, owner, foe, dt) => homing(p, foe, 3.2, dt, 420),
          onTouch: (world, p, owner, foe) => explode(world, p, owner, foe, 30, 1.5, 'bomb'),
        });
      }
    },
    onHit(world, me) {
      growStat(me, 'n', 1, 12);
    },
  },
  {
    id: 'shuriken',
    kind: 'ranged',
    name: '手裏剣',
    en: 'Shuriken',
    color: '#4a4e69',
    grow: '当たるたびに 投げる手裏剣 +1(壁で跳ね返る)',
    init(b) {
      b.w = { n: 1, timer: 0.6 };
    },
    stats: (b) => [['手裏剣', fmt(shown(b, 'n'))]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.9;
      for (let i = 0; i < me.w.n; i++) {
        const a = me.angle + (i - (me.w.n - 1) / 2) * 0.25;
        shoot(world, me, a, 480, {
          kind: 'shuriken',
          r: 7,
          life: 3,
          wall: 'bounce',
          bounces: 1,
          damage: 1,
          update(world, p, owner, foe, dt) {
            p.angle += 20 * dt;
          },
          onTouch: hitOnce(),
        });
      }
    },
    onHit(world, me) {
      growStat(me, 'n', 1, 14, 0.5);
    },
  },
  {
    id: 'bees',
    kind: 'ranged',
    name: 'ハチの巣',
    en: 'Beehive',
    color: '#e8b321',
    grow: '刺すたびに ハチ +1(しばらく飛び回る)',
    init(b) {
      b.w = { n: 1, timer: 0.5 };
    },
    stats: (b) => [['ハチ', fmt(shown(b, 'n'))]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 0.6;
      const alive = world.projectiles.filter((p) => p.owner === me.id && p.kind === 'bee').length;
      if (alive >= me.w.n) return;
      shoot(world, me, world.rng() * TAU, 200, {
        kind: 'bee',
        r: 5,
        life: 6,
        wall: 'bounce',
        blockable: true,
        stingCd: 0,
        wobble: world.rng() * TAU,
        update(world, p, owner, foe, dt) {
          p.wobble += dt * 9;
          homing(p, foe, 4, dt, 260 + Math.sin(p.wobble) * 60);
          if (p.stingCd > 0) p.stingCd -= dt;
        },
        onTouch(world, p, owner, foe) {
          if (p.stingCd > 0) return;
          p.stingCd = 1.0;
          landHit(world, owner, foe, 0.8, { kind: 'bee', x: p.x, y: p.y });
          // 刺したら少し離れる
          p.vx = -p.vx;
          p.vy = -p.vy;
        },
      });
    },
    onHit(world, me) {
      growStat(me, 'n', 1, 25);
    },
  },
  {
    id: 'gatling',
    kind: 'ranged',
    name: 'ガトリング',
    en: 'Gatling',
    color: '#5a6b5d',
    grow: '当たるたびに 連射速度 アップ',
    init(b) {
      b.w = { rate: 1.5, timer: 0.5 };
    },
    stats: (b) => [['連射/秒', fmt(Math.round(shown(b, 'rate') * 10) / 10)]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1 / me.w.rate;
      shoot(world, me, me.angle + (world.rng() - 0.5) * 0.25, 700, { kind: 'bullet', r: 3.5, life: 1.5, damage: 1, onTouch: hitOnce() });
    },
    onHit(world, me) {
      growStat(me, 'rate', 0.18, 14);
    },
  },
  {
    id: 'lightning',
    kind: 'ranged',
    name: '雷',
    en: 'Lightning',
    color: '#4f8ef0',
    grow: '当たるたびに 落ちる雷 +1・連鎖 +0.25(当たった雷は相手を追ってもう一度落ちる)',
    init(b) {
      b.w = { n: 1, chain: 0.5, timer: 0.6 };
    },
    stats: (b) => [
      ['雷', fmt(shown(b, 'n'))],
      ['連鎖', fmt(Math.floor(shown(b, 'chain')))],
    ],
    update(world, me, foe, dt) {
      me.angle = -Math.PI / 2;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2.0;
      for (let i = 0; i < me.w.n; i++) {
        // 予告の円が出てから落ちる。相手が動いた先を少し読む
        const lead = 0.25 + world.rng() * 0.2;
        strike(
          world,
          me,
          Math.max(10, Math.min(ARENA - 10, foe.x + foe.vx * lead + (world.rng() - 0.5) * 150)),
          Math.max(10, Math.min(ARENA - 10, foe.y + foe.vy * lead + (world.rng() - 0.5) * 150)),
          0.45 + i * 0.06,
          Math.floor(me.w.chain),
        );
      }
    },
    onHit(world, me) {
      growStat(me, 'n', 1, 12, 0.5);
      growStat(me, 'chain', 0.25, 6, 0.5);
    },
  },
  {
    id: 'saw',
    kind: 'ranged',
    name: 'ノコギリ',
    en: 'Sawblade',
    color: '#8c99a6',
    grow: '2回当たるたびに 跳ね回る丸ノコ +1',
    init(b) {
      b.w = { n: 1, timer: 0.4 };
    },
    stats: (b) => [['丸ノコ', fmt(Math.floor(shown(b, 'n')))]],
    update(world, me, foe, dt) {
      me.angle += dt * 6;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 0.5;
      const alive = world.projectiles.filter((p) => p.owner === me.id && p.kind === 'saw').length;
      if (alive >= Math.floor(me.w.n)) return;
      shoot(world, me, world.rng() * TAU, 300, {
        kind: 'saw',
        r: 13,
        life: 8,
        wall: 'bounce',
        bounces: 6,
        blockable: true,
        hitCd: 0,
        update(world, p, owner, foe, dt) {
          p.angle += 25 * dt;
          if (p.hitCd > 0) p.hitCd -= dt;
        },
        onTouch(world, p, owner, foe) {
          if (p.hitCd > 0) return;
          p.hitCd = 0.5;
          landHit(world, owner, foe, 2, { kind: 'saw', x: p.x, y: p.y });
        },
      });
    },
    onHit(world, me) {
      growStat(me, 'n', 0.5, 10, 0.5);
    },
  },
  {
    id: 'flame',
    kind: 'ranged',
    name: '火炎放射',
    en: 'Flamethrower',
    color: '#ff4e1f',
    grow: '当たるたびに 炎の届く距離 アップ(やけど付き)',
    init(b) {
      b.w = { range: 110, timer: 0, burst: 0 };
      setSpin(b, 0);
    },
    stats: (b) => [['射程', fmt(Math.round(shown(b, 'range')))]],
    update(world, me, foe, dt) {
      const want = aimAt(me, foe);
      let diff = ((want - me.angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
      me.angle += diff * Math.min(1, dt * 6);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 0.07;
      const sp = 360;
      shoot(world, me, me.angle + (world.rng() - 0.5) * 0.35, sp, {
        kind: 'flame',
        r: 8,
        life: me.w.range / sp,
        wall: 'die',
        blockable: false,
        onTouch(world, p, owner, foe) {
          p.dead = true;
          if (landHit(world, owner, foe, 0.75, { kind: 'flame', x: p.x, y: p.y }) > 0) {
            foe.burnT = 2;
            foe.burnDps = Math.max(foe.burnDps, 1);
            foe.burnSrc = owner.id;
          }
        },
      });
    },
    onHit(world, me) {
      growStat(me, 'range', 3, 320);
    },
  },
  {
    id: 'gas',
    kind: 'ranged',
    name: '毒ガス',
    en: 'Poison Gas',
    color: '#6fbf3f',
    grow: '吸わせるたびに ガスの雲が大きくなる',
    init(b) {
      b.w = { size: 30, timer: 0.3 };
      b.speedMul = 1.05;
    },
    stats: (b) => [['雲の大きさ', fmt(Math.round(shown(b, 'size')))]],
    update(world, me, foe, dt) {
      me.angle += dt;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 0.45;
      // 自分の通った跡にガスの雲を残す
      spawnProjectile(world, me, {
        kind: 'gas',
        r: me.w.size,
        life: 2.6,
        wall: 'stop',
        blockable: false,
        tick: 0,
        update(world, p, owner, foe, dt) {
          p.tick -= dt;
        },
        onTouch(world, p, owner, foe) {
          if (p.tick > 0) return;
          p.tick = 0.5;
          landHit(world, owner, foe, 0.6, { kind: 'gas', x: foe.x, y: foe.y });
        },
      });
    },
    onHit(world, me) {
      growStat(me, 'size', 1.5, 110);
    },
  },
  {
    id: 'dual',
    ...melee('dual', {
      spin: 3.6,
      state: { n: 2 },
      blade: { rIn: 22, rOut: 84, w: 9, cd: 0.3 },
      damage: 1,
      after(b) {
        b.blades.push({ ...b.blades[0], off: Math.PI, cdLeft: 0 });
      },
    }),
    name: '剣の嵐',
    en: 'Blade Storm',
    color: '#d94f8a',
    grow: '2回当たるたびに 回る剣 +1(6本を超えると威力が上がる)',
    stats: (b) => [['剣の数', fmt(Math.floor(shown(b, 'n')))]],
    onHit(world, me) {
      growStat(me, 'n', 0.5, 6, 0.3);
      if (me.blades.length >= Math.floor(me.w.n)) return;
      me.blades.push({ ...me.blades[0], cdLeft: 0.2 });
      me.blades.forEach((bl, i) => (bl.off = (i / me.blades.length) * TAU));
    },
  },
  {
    id: 'blackhole',
    kind: 'ranged',
    name: 'ブラックホール',
    en: 'Black Hole',
    color: '#3b2463',
    grow: '吸い込むたびに 穴が大きく・強くなる',
    init(b) {
      b.w = { size: 55, timer: 1 };
    },
    stats: (b) => [['大きさ', fmt(Math.round(shown(b, 'size')))]],
    update(world, me, foe, dt) {
      me.angle += dt * 3;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 3;
      const size = me.w.size;
      spawnProjectile(world, me, {
        x: Math.max(40, Math.min(ARENA - 40, foe.x + (world.rng() - 0.5) * 120)),
        y: Math.max(40, Math.min(ARENA - 40, foe.y + (world.rng() - 0.5) * 120)),
        kind: 'hole',
        r: size,
        life: 2.4,
        wall: 'stop',
        blockable: false,
        tick: 0,
        update(world, p, owner, foe, dt) {
          // 周りのものを引き寄せる(近いほど強い)
          const dx = p.x - foe.x;
          const dy = p.y - foe.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d < p.r * 3.5) {
            const acc = 2600 * (1 - d / (p.r * 3.5));
            foe.vx += (dx / d) * acc * dt;
            foe.vy += (dy / d) * acc * dt;
          }
          p.tick -= dt;
        },
        onTouch(world, p, owner, foe) {
          if (p.tick > 0) return;
          p.tick = 0.25;
          landHit(world, owner, foe, 2, { kind: 'hole', x: foe.x, y: foe.y });
        },
      });
    },
    onHit(world, me) {
      growStat(me, 'size', 1.2, 130, 0.5);
    },
  },
  {
    id: 'fireworks',
    kind: 'ranged',
    name: '花火',
    en: 'Fireworks',
    color: '#ff3f8e',
    grow: '火花が当たるたびに 火花の数 +1',
    init(b) {
      b.w = { sparks: 8, timer: 0.8 };
    },
    stats: (b) => [['火花', fmt(Math.floor(shown(b, 'sparks')))]],
    update(world, me, foe, dt) {
      me.angle = -Math.PI / 2;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.8;
      const n = Math.floor(me.w.sparks);
      // 相手の上あたりで弾けるように打ち上げる
      const tx = foe.x + (world.rng() - 0.5) * 100;
      spawnProjectile(world, me, {
        x: me.x,
        y: me.y - me.r,
        vx: (tx - me.x) / 0.7,
        vy: -560,
        kind: 'rocketup',
        r: 6,
        life: 0.7,
        gravity: 0.5,
        wall: 'bounce',
        blockable: false,
        onExpire(world, p, owner, foe) {
          const hue = Math.floor(world.rng() * 360);
          world.events.push({ type: 'burst', x: p.x, y: p.y, hue });
          for (let i = 0; i < n; i++) {
            const a = (i / n) * TAU;
            const sp = 260 + world.rng() * 60;
            spawnProjectile(world, owner, {
              x: p.x,
              y: p.y,
              vx: Math.cos(a) * sp,
              vy: Math.sin(a) * sp,
              kind: 'spark',
              hue: (hue + i * 12) % 360,
              r: 5,
              life: 0.75,
              gravity: 0.35,
              wall: 'die',
              blockable: false,
              damage: 1.5,
              onTouch: hitOnce(),
            });
          }
        },
      });
    },
    onHit(world, me) {
      growStat(me, 'sparks', 1, 40, 0.3);
    },
  },
  {
    id: 'laser',
    kind: 'ranged',
    name: 'レーザー',
    en: 'Laser',
    color: '#e8233f',
    grow: '当たるたびに ビームのダメージ +1.5・太さアップ',
    init(b) {
      b.w = { dmg: 6, width: 10, timer: 1 };
      setSpin(b, 0);
    },
    stats: (b) => [
      ['ダメージ', fmt(b.w.dmg)],
      ['太さ', fmt(Math.round(shown(b, 'width')))],
    ],
    update(world, me, foe, dt) {
      if (!world.projectiles.some((p) => p.owner === me.id && p.kind === 'laser')) {
        const want = aimAt(me, foe);
        const diff = ((want - me.angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
        me.angle += diff * Math.min(1, dt * 8);
      }
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2.4;
      const dmg = me.w.dmg;
      const width = me.w.width;
      spawnProjectile(world, me, {
        kind: 'laser',
        r: 1,
        life: 0.95,
        charge: 0.6, // この時間だけ狙いを付けてから撃つ
        width,
        fired: false,
        wall: 'stop',
        blockable: false,
        update(world, p, owner, foe, dt) {
          p.x = owner.x;
          p.y = owner.y;
          if (p.age < p.charge) {
            // 溜めている間はゆっくり相手を追う
            const want = Math.atan2(foe.y - owner.y, foe.x - owner.x);
            const diff = ((want - owner.angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
            owner.angle += diff * Math.min(1, dt * 10);
            p.angle = owner.angle;
            return;
          }
          p.angle = owner.angle;
          if (p.fired) return;
          p.fired = true;
          world.events.push({ type: 'laser', x: p.x, y: p.y, angle: p.angle, width: p.width });
          const ex = p.x + Math.cos(p.angle) * 1000;
          const ey = p.y + Math.sin(p.angle) * 1000;
          if (segPointDist(p.x, p.y, ex, ey, foe.x, foe.y) < foe.r + p.width / 2) {
            landHit(world, owner, foe, dmg, { kind: 'laser', x: foe.x, y: foe.y });
            knockback(owner, foe, 260);
          }
        },
      });
    },
    onHit(world, me) {
      me.w.dmg += 1.5;
      growStat(me, 'width', 3, 60, 0.3);
    },
  },
  {
    id: 'slime',
    kind: 'ranged',
    name: 'スライム',
    en: 'Slime',
    color: '#4fd36b',
    grow: '3回当たるたびに 投げるスライム +1(当たると分裂する)',
    init(b) {
      b.w = { n: 1, timer: 0.7 };
    },
    stats: (b) => [['スライム', fmt(Math.floor(shown(b, 'n')))]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2.4;
      for (let i = 0; i < Math.floor(me.w.n); i++) slimeBlob(world, me, me.x, me.y, me.angle + (world.rng() - 0.5) * 1.2 - 0.3, 11, true);
    },
    onHit(world, me) {
      growStat(me, 'n', 0.34, 12, 0.4);
    },
  },
  {
    id: 'tornado',
    kind: 'ranged',
    name: '竜巻',
    en: 'Tornado',
    color: '#9fb4c7',
    grow: '巻き込むたびに 竜巻が大きくなる',
    init(b) {
      b.w = { size: 45, timer: 0.8 };
    },
    stats: (b) => [['大きさ', fmt(Math.round(shown(b, 'size')))]],
    update(world, me, foe, dt) {
      me.angle += dt * 8;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2.6;
      spawnProjectile(world, me, {
        x: me.x,
        y: Math.min(ARENA - me.w.size, me.y + 20),
        vx: Math.sign(foe.x - me.x || 1) * 140,
        vy: 0,
        kind: 'tornado',
        r: me.w.size,
        life: 3.6,
        wall: 'bounce',
        blockable: false,
        tick: 0,
        update(world, p, owner, foe, dt) {
          // 相手のほうへゆっくり寄っていく
          p.vx += Math.sign(foe.x - p.x) * 260 * dt;
          p.vy += Math.sign(foe.y - p.y) * 260 * dt;
          p.vx = Math.max(-260, Math.min(260, p.vx));
          p.vy = Math.max(-260, Math.min(260, p.vy));
          p.angle += dt * 14;
          p.tick -= dt;
        },
        onTouch(world, p, owner, foe) {
          // 巻き上げる
          foe.vy -= 1400 * (1 / 120);
          foe.vx += (p.x - foe.x) * 0.05;
          if (p.tick > 0) return;
          p.tick = 0.3;
          landHit(world, owner, foe, 2.5, { kind: 'tornado', x: foe.x, y: foe.y });
        },
      });
    },
    onHit(world, me) {
      growStat(me, 'size', 1.5, 120, 0.5);
    },
  },
  {
    id: 'yoyo',
    kind: 'ranged',
    name: 'ヨーヨー',
    en: 'Yo-yo',
    color: '#e04848',
    grow: '当たるたびに ひもの長さ +10・ダメージ +0.3',
    init(b) {
      b.w = { len: 150, dmg: 2.5, out: false };
    },
    stats: (b) => [
      ['ひもの長さ', fmt(Math.round(shown(b, 'len')))],
      ['ダメージ', fmt(b.w.dmg)],
    ],
    update(world, me, foe, dt) {
      if (me.w.out) return;
      me.angle = aimAt(me, foe);
      me.w.out = true;
      const len = me.w.len;
      shoot(world, me, me.angle, 700, {
        kind: 'yoyo',
        r: 12,
        life: 5,
        wall: 'bounce',
        blockable: false,
        back: false,
        hitCd: 0,
        update(world, p, owner, foe, dt) {
          p.angle += 20 * dt;
          if (p.hitCd > 0) p.hitCd -= dt;
          const dx = owner.x - p.x;
          const dy = owner.y - p.y;
          const d = Math.hypot(dx, dy) || 1;
          if (!p.back && (d >= len || p.age > 0.7)) p.back = true;
          if (p.back) {
            p.vx = (dx / d) * 800;
            p.vy = (dy / d) * 800;
            if (d < owner.r) {
              p.dead = true;
              owner.w.out = false;
            }
          }
        },
        onExpire(world, p, owner) {
          owner.w.out = false;
        },
        onTouch(world, p, owner, foe) {
          if (p.hitCd > 0) return;
          p.hitCd = 0.3;
          landHit(world, owner, foe, owner.w.dmg, { kind: 'yoyo', x: p.x, y: p.y });
          knockback(p, foe, 140);
        },
      });
    },
    onHit(world, me) {
      growStat(me, 'len', 10, 420, 0.6);
      me.w.dmg += 0.3;
    },
  },
  {
    id: 'bats',
    kind: 'ranged',
    name: 'コウモリ',
    en: 'Bats',
    color: '#5b3a6e',
    grow: 'かむたびに コウモリが増える(かむと少し回復)',
    init(b) {
      b.w = { n: 2, timer: 0.4 };
    },
    stats: (b) => [['コウモリ', fmt(Math.floor(shown(b, 'n')))]],
    update(world, me, foe, dt) {
      me.angle += dt * 4;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 0.5;
      const alive = world.projectiles.filter((p) => p.owner === me.id && p.kind === 'bat').length;
      if (alive >= Math.floor(me.w.n)) return;
      shoot(world, me, world.rng() * TAU, 240, {
        kind: 'bat',
        r: 7,
        life: 7,
        wall: 'bounce',
        blockable: true,
        biteCd: 0,
        flap: world.rng() * TAU,
        update(world, p, owner, foe, dt) {
          p.flap += dt * 16;
          homing(p, foe, 3, dt, 240 + Math.sin(p.flap * 0.4) * 80);
          if (p.biteCd > 0) p.biteCd -= dt;
        },
        onTouch(world, p, owner, foe) {
          if (p.biteCd > 0) return;
          p.biteCd = 1;
          if (landHit(world, owner, foe, 1, { kind: 'bat', x: p.x, y: p.y }) > 0) heal(world, owner, 0.6);
          p.vx = -p.vx;
          p.vy = -p.vy;
        },
      });
    },
    onHit(world, me) {
      growStat(me, 'n', 0.4, 20, 0.4);
    },
  },
  {
    id: 'ricochet',
    kind: 'ranged',
    name: '跳弾',
    en: 'Ricochet',
    color: '#c9a227',
    grow: '当たるたびに 弾が跳ね返る回数 +1(何度でも当たる)',
    init(b) {
      b.w = { bounces: 3, timer: 0.5 };
    },
    stats: (b) => [['跳ね返り', fmt(Math.floor(shown(b, 'bounces')))]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.3;
      shoot(world, me, me.angle + (world.rng() - 0.5) * 0.3, 620, {
        kind: 'ricochet',
        r: 5,
        life: 8,
        wall: 'bounce',
        bounces: Math.floor(me.w.bounces),
        blockable: true,
        hitCd: 0,
        update(world, p, owner, foe, dt) {
          if (p.hitCd > 0) p.hitCd -= dt;
        },
        onTouch(world, p, owner, foe) {
          if (p.hitCd > 0) return;
          p.hitCd = 0.4;
          landHit(world, owner, foe, 3, { kind: 'ricochet', x: p.x, y: p.y });
        },
      });
    },
    onHit(world, me) {
      growStat(me, 'bounces', 1, 30, 0.4);
    },
  },
  {
    ...melee('greatsword', {
      spin: 1.8,
      state: { dmg: 3.5 },
      blade: { rIn: 22, rOut: 110, w: 16, knock: 340, cd: 0.4 },
      damage: (w, me) => me.w.dmg,
    }),
    name: '大剣',
    en: 'Greatsword',
    color: '#6d7fa3',
    grow: '当たるたびに ダメージ +1.2(重くてゆっくり回る)',
    stats: (b) => [['ダメージ', fmt(b.w.dmg)]],
    onHit(world, me) {
      me.w.dmg += 1.5;
    },
  },
  {
    id: 'rocket',
    kind: 'ranged',
    name: 'ロケット',
    en: 'Rocket',
    color: '#d1452f',
    grow: '当たるたびに ダメージ +1・爆発の大きさ +8',
    init(b) {
      b.w = { blast: 60, dmg: 7, timer: 0.8 };
    },
    stats: (b) => [
      ['ダメージ', fmt(b.w.dmg)],
      ['爆発範囲', fmt(Math.round(shown(b, 'blast')))],
    ],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2.3;
      const blast = me.w.blast;
      const dmg = me.w.dmg;
      shoot(world, me, me.angle, 260, {
        kind: 'rocket',
        r: 8,
        life: 3,
        wall: 'die',
        blockable: true,
        update(world, p, owner, foe, dt) {
          // だんだん加速しながら少しだけ追う
          homing(p, foe, 1.2, dt, Math.min(720, Math.hypot(p.vx, p.vy) + 900 * dt));
        },
        onTouch: (world, p, owner, foe) => explode(world, p, owner, foe, blast, dmg, 'bomb'),
        onBlocked: (world, p, owner, foe) => explode(world, p, owner, foe, blast, dmg, 'bomb'),
        onExpire: (world, p, owner, foe) => explode(world, p, owner, foe, blast, dmg, 'bomb'),
      });
    },
    onHit(world, me) {
      growStat(me, 'blast', 8, 260, 0.5);
      me.w.dmg += 1;
    },
  },
  {
    id: 'sonic',
    kind: 'ranged',
    name: '音波',
    en: 'Sonic Wave',
    color: '#4ac6e0',
    grow: '2回当たるたびに 一度に出す音波 +1(届くのは近くだけ)',
    init(b) {
      b.w = { waves: 1, timer: 0.5 };
    },
    stats: (b) => [['音波', fmt(Math.floor(shown(b, 'waves')))]],
    update(world, me, foe, dt) {
      me.angle += dt * 2;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2.0;
      for (let i = 0; i < Math.floor(me.w.waves); i++) {
        spawnProjectile(world, me, {
          kind: 'wave',
          r: 1,
          life: 2,
          delay: i * 0.12,
          wall: 'stop',
          blockable: false,
          hit: false,
          ring: 0,
          update(world, p, owner, foe, dt) {
            p.x = owner.x;
            p.y = owner.y;
            p.ring = Math.max(0, p.age - p.delay) * 380;
            if (p.ring > SONIC_RANGE) p.dead = true;
            if (p.hit) return;
            const d = Math.hypot(foe.x - p.x, foe.y - p.y);
            if (p.ring > 0 && Math.abs(d - p.ring) < foe.r + 6) {
              p.hit = true;
              landHit(world, owner, foe, 1.2, { kind: 'wave', x: foe.x, y: foe.y });
              knockback(owner, foe, 200);
            }
          },
        });
      }
    },
    onHit(world, me) {
      growStat(me, 'waves', 0.5, 10, 0.4);
    },
  },
  {
    id: 'snowball',
    kind: 'ranged',
    name: '雪玉',
    en: 'Snowball',
    color: '#d6ecff',
    grow: '当たるたびに 雪玉が大きく・重くなる(飛びながら大きくなる)',
    init(b) {
      b.w = { size: 8, timer: 0.6 };
    },
    stats: (b) => [['雪玉', fmt(Math.round(shown(b, 'size')))]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.3;
      const base = me.w.size;
      shoot(world, me, me.angle - 0.25, 430, {
        kind: 'snow',
        r: base,
        life: 2.5,
        gravity: 0.45,
        wall: 'bounce',
        bounces: 1,
        blockable: false,
        update(world, p, owner, foe, dt) {
          p.r = Math.min(base * 2.2, p.r + base * 1.2 * dt);
        },
        onTouch(world, p, owner, foe) {
          p.dead = true;
          world.events.push({ type: 'boom', x: p.x, y: p.y, radius: p.r * 1.5, kind: 'snow' });
          if (landHit(world, owner, foe, p.r / 4, { kind: 'snow', x: p.x, y: p.y }) > 0) {
            foe.slow = Math.max(foe.slow, 0.2);
            foe.slowT = 1;
            knockback(p, foe, 100 + p.r * 6);
          }
        },
      });
    },
    onHit(world, me) {
      growStat(me, 'size', 1, 40, 0.5);
    },
  },
  {
    id: 'clone',
    kind: 'ranged',
    name: '分身',
    en: 'Clones',
    color: '#8a7fd6',
    grow: '2回当たるたびに 跳ね回る分身 +1',
    init(b) {
      b.w = { n: 1, timer: 0.5 };
    },
    stats: (b) => [['分身', fmt(Math.floor(shown(b, 'n')))]],
    update(world, me, foe, dt) {
      me.angle += dt * 4;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.2;
      const alive = world.projectiles.filter((p) => p.owner === me.id && p.kind === 'clone').length;
      if (alive >= Math.floor(me.w.n)) return;
      spawnProjectile(world, me, {
        x: me.x,
        y: me.y,
        vx: (world.rng() < 0.5 ? -1 : 1) * (180 + world.rng() * 120),
        vy: -520,
        kind: 'clone',
        color: me.def.color,
        r: 22,
        life: 7,
        gravity: 1,
        wall: 'bounce',
        blockable: false,
        hitCd: 0,
        update(world, p, owner, foe, dt) {
          p.angle += 10 * dt;
          if (p.hitCd > 0) p.hitCd -= dt;
        },
        onTouch(world, p, owner, foe) {
          if (p.hitCd > 0) return;
          p.hitCd = 0.6;
          landHit(world, owner, foe, 2, { kind: 'clone', x: p.x, y: p.y });
          knockback(p, foe, 150);
          p.vy = -Math.abs(p.vy) - 200;
        },
      });
    },
    onHit(world, me) {
      growStat(me, 'n', 0.5, 8, 0.4);
    },
  },
  {
    id: 'curse',
    kind: 'ranged',
    name: '呪いの人形',
    en: 'Voodoo Doll',
    color: '#7a2f5c',
    grow: '針が刺さるたびに 呪い +1(呪い1つで相手が受けるダメージ +5%・何からでも)',
    init(b) {
      b.w = { timer: 0.6 };
    },
    stats: (b, world) => [['呪い', fmt(world ? foeOf(world, b).curse : 0)]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.1;
      for (const s of [-0.3, 0.3]) {
        shoot(world, me, me.angle + s, 380, {
          kind: 'needle',
          r: 4,
          life: 2.5,
          damage: 1.5,
          update: (world, p, owner, foe, dt) => homing(p, foe, 2.2, dt),
          onTouch: hitOnce(),
        });
      }
    },
    onHit(world, me, foe) {
      foe.curse += 1;
    },
  },
  {
    id: 'blizzard',
    kind: 'ranged',
    name: '吹雪',
    en: 'Blizzard',
    color: '#9fd3f5',
    grow: '当たるたびに 降るつらら +1(当たると少し遅くなる)',
    init(b) {
      b.w = { n: 1, timer: 0.8 };
    },
    stats: (b) => [['つらら', fmt(Math.floor(shown(b, 'n')))]],
    update(world, me, foe, dt) {
      me.angle = -Math.PI / 2;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.6;
      const wind = world.rng() < 0.5 ? -1 : 1;
      for (let i = 0; i < Math.floor(me.w.n); i++) {
        const x = foe.x - wind * 160 + (world.rng() - 0.5) * 280;
        spawnProjectile(world, me, {
          x: Math.max(10, Math.min(ARENA - 10, x)),
          y: 12 + world.rng() * 40,
          vx: wind * 170,
          vy: 420 + world.rng() * 120,
          kind: 'icicle',
          r: 6,
          life: 2,
          wall: 'die',
          blockable: true,
          onTouch(world, p, owner, foe) {
            p.dead = true;
            if (landHit(world, owner, foe, 1.1, { kind: 'icicle', x: p.x, y: p.y }) > 0) {
              foe.slow = Math.max(foe.slow, 0.12);
              foe.slowT = 1;
            }
          },
        });
      }
    },
    onHit(world, me) {
      growStat(me, 'n', 1, 20, 0.4);
    },
  },
  {
    id: 'hook',
    kind: 'ranged',
    name: 'フック',
    en: 'Grappling Hook',
    color: '#8d6e4a',
    grow: '引っかけるたびに ダメージ +1.5(相手を引き寄せる)',
    init(b) {
      b.w = { dmg: 5, out: false, timer: 0.5 };
    },
    stats: (b) => [['ダメージ', fmt(b.w.dmg)]],
    update(world, me, foe, dt) {
      if (me.w.out) return;
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.out = true;
      shoot(world, me, me.angle, 760, {
        kind: 'hook',
        r: 9,
        life: 1.6,
        wall: 'stop',
        blockable: true,
        back: false,
        update(world, p, owner, foe, dt) {
          const dx = owner.x - p.x;
          const dy = owner.y - p.y;
          const d = Math.hypot(dx, dy) || 1;
          if (!p.back && (p.age > 0.5 || p.x <= p.r + 1 || p.x >= ARENA - p.r - 1 || p.y <= p.r + 1 || p.y >= ARENA - p.r - 1)) p.back = true;
          if (p.back) {
            p.vx = (dx / d) * 900;
            p.vy = (dy / d) * 900;
            if (d < owner.r) p.dead = true;
          }
          p.angle = Math.atan2(-dy, -dx);
          if (p.dead) {
            owner.w.out = false;
            owner.w.timer = 0.9;
          }
        },
        onBlocked(world, p, owner) {
          owner.w.out = false;
          owner.w.timer = 0.9;
        },
        onExpire(world, p, owner) {
          owner.w.out = false;
          owner.w.timer = 0.9;
        },
        onTouch(world, p, owner, foe) {
          if (p.back) return;
          p.back = true;
          landHit(world, owner, foe, owner.w.dmg, { kind: 'hook', x: p.x, y: p.y });
          // 引き寄せる
          const dx = owner.x - foe.x;
          const dy = owner.y - foe.y;
          const d = Math.hypot(dx, dy) || 1;
          foe.vx = (dx / d) * 900;
          foe.vy = (dy / d) * 900;
        },
      });
    },
    onHit(world, me) {
      me.w.dmg += 1.5;
    },
  },
  {
    id: 'snake',
    kind: 'ranged',
    name: '毒ヘビ',
    en: 'Viper',
    color: '#3f8f3a',
    grow: '3回かむたびに ヘビ +1(かまれると毒がたまる)',
    init(b) {
      b.w = { n: 1, timer: 0.5 };
    },
    stats: (b) => [['ヘビ', fmt(Math.floor(shown(b, 'n')))]],
    update(world, me, foe, dt) {
      me.angle += dt * 3;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 0.9;
      const alive = world.projectiles.filter((p) => p.owner === me.id && p.kind === 'snake').length;
      if (alive >= Math.floor(me.w.n)) return;
      spawnProjectile(world, me, {
        x: me.x,
        y: me.y,
        vx: Math.sign(foe.x - me.x || 1) * 160,
        vy: 0,
        kind: 'snake',
        r: 9,
        life: 7,
        gravity: 1,
        wall: 'bounce',
        blockable: true,
        biteCd: 0,
        wig: 0,
        update(world, p, owner, foe, dt) {
          p.wig += dt * 12;
          if (p.biteCd > 0) p.biteCd -= dt;
          // 床をはって相手の下へ。真上近くに来たら飛びかかる
          p.vx += Math.sign(foe.x - p.x) * 500 * dt;
          p.vx = Math.max(-260, Math.min(260, p.vx));
          const onFloor = p.y >= ARENA - p.r - 2;
          if (onFloor) p.vy = Math.min(p.vy, 0) * 0.3;
          if (onFloor && Math.abs(foe.x - p.x) < 90 && foe.y > ARENA - 300 && p.biteCd <= 0) p.vy = -650;
        },
        onTouch(world, p, owner, foe) {
          if (p.biteCd > 0) return;
          p.biteCd = 1;
          if (landHit(world, owner, foe, 0.6, { kind: 'snake', x: p.x, y: p.y }) > 0) {
            foe.poison += 1;
            foe.poisonSrc = owner.id;
          }
        },
      });
    },
    onHit(world, me) {
      growStat(me, 'n', 0.34, 10, 0.4);
    },
  },
  {
    id: 'knives',
    kind: 'ranged',
    name: '投げナイフ',
    en: 'Throwing Knives',
    color: '#b0b8c4',
    grow: '2回当たるたびに 投げるナイフ +1',
    init(b) {
      b.w = { n: 2, timer: 0.5 };
    },
    stats: (b) => [['ナイフ', fmt(Math.floor(shown(b, 'n')))]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.4;
      const n = Math.floor(me.w.n);
      for (let i = 0; i < n; i++) {
        const a = me.angle + (i - (n - 1) / 2) * 0.16;
        shoot(world, me, a, 640, { kind: 'knife', r: 5, life: 1.5, damage: 1.5, onTouch: hitOnce() });
      }
    },
    onHit(world, me) {
      growStat(me, 'n', 0.5, 16, 0.4);
    },
  },
  {
    ...melee('squeaky', {
      spin: 3.6,
      state: { slamMul: 0.8 },
      blade: { rIn: 22, rOut: 92, w: 18, knock: 650, cd: 0.4 },
      damage: 1,
    }),
    name: 'ピコハン',
    en: 'Squeaky Hammer',
    color: '#ff7eb6',
    grow: '吹き飛ばした相手が壁にぶつかると大ダメージ(壁ドン)。当たるたびに 壁ドンの威力アップ',
    stats: (b) => [['壁ドン威力', '×' + fmt(Math.round(b.w.slamMul * 10) / 10)]],
    onHit(world, me, foe, info) {
      if (info.kind === 'melee') {
        foe.slamT = 0.9;
        foe.slamBy = me.id;
      }
      me.w.slamMul += 0.08;
    },
  },
  {
    id: 'dice',
    kind: 'ranged',
    name: 'サイコロ',
    en: 'Dice',
    color: '#f2f2f2',
    grow: '当たるたびに サイコロの目が増える(1〜最大の目のダメージ)',
    init(b) {
      b.w = { sides: 6, timer: 0.6 };
    },
    stats: (b) => [['最大の目', fmt(Math.floor(b.w.sides))]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.3;
      const sides = Math.floor(me.w.sides);
      shoot(world, me, me.angle - 0.3, 470, {
        kind: 'die',
        r: 11,
        life: 3,
        gravity: 0.6,
        wall: 'bounce',
        bounces: 3,
        blockable: true,
        face: 1,
        update(world, p, owner, foe, dt) {
          p.angle += 12 * dt;
          if (world.rng() < dt * 12) p.face = 1 + Math.floor(world.rng() * Math.min(6, sides));
        },
        onTouch(world, p, owner, foe) {
          p.dead = true;
          const roll = 1 + Math.floor(world.rng() * sides);
          world.events.push({ type: 'roll', x: p.x, y: p.y, value: roll, max: sides });
          landHit(world, owner, foe, roll, { kind: 'dice', x: p.x, y: p.y });
        },
      });
    },
    onHit(world, me) {
      me.w.sides += 1;
    },
  },
  {
    id: 'javelin',
    kind: 'ranged',
    name: '槍投げ',
    en: 'Javelin',
    color: '#b3863c',
    grow: '3回当たるたびに 一度に投げる槍 +1(外れた槍は壁に刺さって残る)',
    init(b) {
      b.w = { n: 1, timer: 0.6 };
    },
    stats: (b) => [['槍', fmt(Math.floor(shown(b, 'n')))]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.7;
      const n = Math.floor(me.w.n);
      for (let i = 0; i < n; i++) {
        shoot(world, me, me.angle - 0.12 + (i - (n - 1) / 2) * 0.2, 700, {
          kind: 'javelin',
          r: 6,
          life: 5,
          gravity: 0.35,
          wall: 'stop',
          blockable: true,
          stuck: false,
          hitCd: 0,
          update(world, p, owner, foe, dt) {
            if (p.hitCd > 0) p.hitCd -= dt;
            if (p.stuck) {
              p.vx = p.vy = 0;
              return;
            }
            p.angle = Math.atan2(p.vy, p.vx);
            if (p.x <= p.r + 1 || p.x >= ARENA - p.r - 1 || p.y <= p.r + 1 || p.y >= ARENA - p.r - 1) {
              // 壁に刺さって、しばらくトゲとして残る
              p.stuck = true;
              p.gravity = 0;
              p.vx = p.vy = 0;
              p.life = p.age + 3.5;
            }
          },
          onTouch(world, p, owner, foe) {
            if (p.hitCd > 0) return;
            if (p.stuck) {
              p.hitCd = 0.6;
              landHit(world, owner, foe, 1.5, { kind: 'javelin', x: p.x, y: p.y });
              return;
            }
            p.dead = true;
            landHit(world, owner, foe, 4, { kind: 'javelin', x: p.x, y: p.y });
            knockback(p, foe, 160);
          },
        });
      }
    },
    onHit(world, me) {
      growStat(me, 'n', 0.34, 8, 0.4);
    },
  },
  {
    ...melee('drill', {
      spin: 0,
      state: { dmg: 1.2 },
      blade: { rIn: 22, rOut: 96, w: 12, cd: 0.1, knock: 30 },
      damage: (w, me) => me.w.dmg,
    }),
    name: 'ドリル',
    en: 'Drill',
    color: '#c9a227',
    grow: '当たるたびに 削る力 +0.1(相手に向けて構え、当たっている間ずっと削る)',
    stats: (b) => [['削る力', fmt(Math.round(b.w.dmg * 100) / 100)]],
    update(world, me, foe, dt) {
      const want = aimAt(me, foe);
      const diff = ((want - me.angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
      me.angle += diff * Math.min(1, dt * 3);
    },
    onHit(world, me) {
      me.w.dmg += 0.1;
    },
  },
  {
    id: 'spellbook',
    kind: 'ranged',
    name: '魔導書',
    en: 'Spellbook',
    color: '#6a4fc9',
    grow: '3回当たるたびに 一度に唱える呪文 +1(炎・氷・雷・光の矢からランダム)',
    init(b) {
      b.w = { n: 1, timer: 0.6 };
    },
    stats: (b) => [['呪文', fmt(Math.floor(shown(b, 'n')))]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.9;
      for (let i = 0; i < Math.floor(me.w.n); i++) {
        const spell = Math.floor(world.rng() * 4);
        const a = me.angle + (world.rng() - 0.5) * 0.8;
        if (spell === 0) {
          shoot(world, me, a, 320, {
            kind: 'fireball',
            r: 8,
            life: 3,
            damage: 2.5,
            update: (world, p, owner, foe, dt) => homing(p, foe, 2.5, dt),
            onTouch(world, p, owner, foe) {
              p.dead = true;
              if (landHit(world, owner, foe, p.damage, { kind: 'fireball', x: p.x, y: p.y }) > 0) {
                foe.burnT = 2;
                foe.burnDps = Math.max(foe.burnDps, 1);
                foe.burnSrc = owner.id;
              }
            },
          });
        } else if (spell === 1) {
          shoot(world, me, a, 480, {
            kind: 'frost',
            r: 7,
            life: 2,
            damage: 2.5,
            blockable: false,
            onTouch(world, p, owner, foe) {
              p.dead = true;
              if (landHit(world, owner, foe, p.damage, { kind: 'frost', x: p.x, y: p.y }) > 0) {
                foe.slow = Math.max(foe.slow, 0.25);
                foe.slowT = 1.5;
              }
            },
          });
        } else if (spell === 2) {
          strike(world, me, foe.x + (world.rng() - 0.5) * 100, foe.y + (world.rng() - 0.5) * 100, 0.5, 0, false);
        } else {
          shoot(world, me, a, 560, { kind: 'arcane', r: 5, life: 2, damage: 2, update: (world, p, owner, foe, dt) => homing(p, foe, 4, dt), onTouch: hitOnce() });
        }
      }
    },
    onHit(world, me) {
      growStat(me, 'n', 0.34, 10, 0.4);
    },
  },
  {
    id: 'water',
    kind: 'ranged',
    name: '水鉄砲',
    en: 'Water Gun',
    color: '#3aa0ff',
    grow: '当たるたびに 水圧アップ(押し流して壁にぶつけると壁ドン)',
    init(b) {
      b.w = { pressure: 1, timer: 0, slamMul: 0.3 };
      setSpin(b, 0);
    },
    stats: (b) => [['水圧', fmt(Math.round(b.w.pressure * 10) / 10)]],
    update(world, me, foe, dt) {
      const want = aimAt(me, foe);
      const diff = ((want - me.angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
      me.angle += diff * Math.min(1, dt * 7);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 0.06;
      const pr = me.w.pressure;
      shoot(world, me, me.angle + (world.rng() - 0.5) * 0.12, 560, {
        kind: 'water',
        r: 6,
        life: 0.7,
        gravity: 0.35,
        wall: 'die',
        blockable: true,
        onTouch(world, p, owner, foe) {
          p.dead = true;
          landHit(world, owner, foe, 0.2 * pr, { kind: 'water', x: p.x, y: p.y });
          foe.vx += (p.vx / 560) * 40 * pr;
          foe.vy += (p.vy / 560) * 40 * pr;
          foe.slamT = 0.5;
          foe.slamBy = owner.id;
        },
      });
    },
    onHit(world, me) {
      me.w.pressure += 0.02;
    },
  },
  {
    ...melee('kusarigama', {
      spin: 3.6,
      state: { dmg: 2, len: 100, t: 0 },
      blade: { rIn: 22, rOut: 100, w: 10, knock: 140 },
      damage: (w, me) => me.w.dmg,
    }),
    name: '鎖鎌',
    en: 'Kusarigama',
    color: '#6b5b4a',
    grow: '当たるたびに ダメージ +1・鎖が長くなる(伸び縮みしながら回る)',
    stats: (b) => [
      ['ダメージ', fmt(b.w.dmg)],
      ['鎖', fmt(Math.round(shown(b, 'len')))],
    ],
    update(world, me, foe, dt) {
      // 鎖が伸びたり縮んだりする
      me.w.t += dt;
      me.blades[0].rOut = 60 + (me.w.len - 30) * (0.55 + 0.45 * Math.sin(me.w.t * 2.6));
    },
    onHit(world, me) {
      me.w.dmg += 1;
      growStat(me, 'len', 6, 240, 0.4);
    },
  },
  {
    ...melee('mirror', {
      spin: 2.6,
      state: { dmg: 2, timer: 1 },
      blade: { rIn: 40, rOut: 54, w: 34, knock: 200 },
      damage: 1,
    }),
    name: '鏡',
    en: 'Mirror',
    color: '#9fc8d8',
    grow: '飛び道具や刃を受け止めると 光の矢で撃ち返す。当たるたびに 光の矢のダメージ +1',
    stats: (b) => [['光の矢', fmt(b.w.dmg)]],
    update(world, me, foe, dt) {
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2;
      mirrorBolt(world, me, foe, me.x, me.y);
    },
    onBlock(world, me, foe, p) {
      mirrorBolt(world, me, foe, p.x, p.y);
    },
    onParry(world, me, foe) {
      mirrorBolt(world, me, foe, me.x, me.y);
    },
    onHit(world, me) {
      me.w.dmg += 1;
    },
  },
  {
    id: 'sticky',
    kind: 'ranged',
    name: 'くっつき爆弾',
    en: 'Sticky Bomb',
    color: '#d97a2b',
    grow: '2回当たるたびに 投げる数 +1(相手にくっついて少しあとに爆発する)',
    init(b) {
      b.w = { n: 1, timer: 0.6 };
    },
    stats: (b) => [['くっつき爆弾', fmt(Math.floor(shown(b, 'n')))]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.6;
      const n = Math.floor(me.w.n);
      for (let i = 0; i < n; i++) {
        shoot(world, me, me.angle + (i - (n - 1) / 2) * 0.25, 460, {
          kind: 'sticky',
          r: 7,
          life: 2.5,
          wall: 'die',
          blockable: true,
          stuck: false,
          update(world, p, owner, foe) {
            if (!p.stuck) return;
            p.x = p.on.x + p.ox;
            p.y = p.on.y + p.oy;
            p.vx = p.vy = 0;
          },
          onTouch(world, p, owner, foe) {
            if (p.stuck) return;
            p.stuck = true;
            p.on = foe;
            p.blockable = false;
            p.wall = 'stop';
            const a = Math.atan2(p.y - foe.y, p.x - foe.x);
            p.ox = Math.cos(a) * foe.r;
            p.oy = Math.sin(a) * foe.r;
            p.life = p.age + 1.3;
          },
          onExpire(world, p, owner, foe) {
            if (!p.stuck) return;
            world.events.push({ type: 'boom', x: p.x, y: p.y, radius: 45, kind: 'bomb' });
            landHit(world, owner, p.on, 3, { kind: 'sticky', x: p.x, y: p.y });
          },
        });
      }
    },
    onHit(world, me) {
      growStat(me, 'n', 0.5, 10, 0.4);
    },
  },
  {
    id: 'web',
    kind: 'ranged',
    name: '蜘蛛の巣',
    en: 'Spider Web',
    color: '#c8c8d0',
    grow: '捕まえるたびに 巣が大きくなる(巣の中はとても遅くなり、少しずつダメージ)',
    init(b) {
      b.w = { size: 60, timer: 0.6 };
    },
    stats: (b) => [['巣の大きさ', fmt(Math.round(shown(b, 'size')))]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.8;
      const size = me.w.size;
      const dist = Math.hypot(foe.x - me.x, foe.y - me.y);
      shoot(world, me, me.angle, 420, {
        kind: 'webball',
        r: 7,
        life: Math.max(0.2, Math.min(1.2, dist / 420)),
        wall: 'die',
        blockable: true,
        onTouch: (world, p) => (p.life = p.age),
        onExpire(world, p, owner) {
          spawnProjectile(world, owner, {
            x: p.x,
            y: p.y,
            kind: 'web',
            r: size,
            life: 4,
            wall: 'stop',
            blockable: false,
            tick: 0,
            update(world, q, owner, foe, dt) {
              q.tick -= dt;
            },
            onTouch(world, q, owner, foe) {
              foe.slow = Math.max(foe.slow, 0.65);
              foe.slowT = 0.3;
              if (q.tick > 0) return;
              q.tick = 0.3;
              landHit(world, owner, foe, 1.2, { kind: 'web', x: foe.x, y: foe.y });
            },
          });
        },
      });
    },
    onHit(world, me) {
      growStat(me, 'size', 1, 160, 0.4);
    },
  },
  {
    ...melee('clock', {
      spin: 5,
      state: { stop: 0.35, timer: 2 },
      blade: { rIn: 20, rOut: 84, w: 9, cd: 0.25 },
      damage: 3,
      after(b) {
        // 短い針をもう1本
        b.blades.push({ ...b.blades[0], off: Math.PI * 0.6, rOut: 62, cdLeft: 0 });
      },
    }),
    name: '時計',
    en: 'Clock',
    color: '#e0c36a',
    grow: 'ときどき相手の時間を止める。当たるたびに 止める時間 +0.04秒',
    stats: (b) => [['時間停止', fmt(Math.round(shown(b, 'stop') * 100) / 100) + '秒']],
    update(world, me, foe, dt) {
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2.2;
      foe.freeze = Math.max(foe.freeze, me.w.stop);
      foe.stun = Math.max(foe.stun, me.w.stop);
      world.events.push({ type: 'timestop', x: foe.x, y: foe.y, target: foe.id });
    },
    onHit(world, me) {
      growStat(me, 'stop', 0.04, 1.4, 0.4);
    },
  },
  {
    id: 'vine',
    kind: 'ranged',
    name: 'ツタ',
    en: 'Thorn Vine',
    color: '#4c9a3a',
    grow: '当たるたびに 床から生えるツタが高くなる',
    init(b) {
      b.w = { h: 200, timer: 0.8 };
    },
    stats: (b) => [['高さ', fmt(Math.round(shown(b, 'h')))]],
    update(world, me, foe, dt) {
      me.angle = Math.PI / 2;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.2;
      const h = me.w.h;
      spawnProjectile(world, me, {
        x: Math.max(20, Math.min(ARENA - 20, foe.x + foe.vx * 0.35)),
        y: ARENA - 2,
        kind: 'vine',
        r: 2,
        height: 0,
        maxH: h,
        life: 1.9,
        wall: 'stop',
        blockable: false,
        hitCd: 0,
        update(world, p, owner, foe, dt) {
          // 0.4秒で伸びて、しばらく残る
          p.height = Math.min(p.maxH, p.height + p.maxH * dt / 0.4);
          if (p.hitCd > 0) p.hitCd -= dt;
          if (p.hitCd <= 0 && Math.abs(foe.x - p.x) < foe.r + 12 && foe.y + foe.r > ARENA - p.height) {
            p.hitCd = 0.5;
            landHit(world, owner, foe, 3, { kind: 'vine', x: p.x, y: foe.y });
            foe.vy = Math.min(foe.vy, -500);
          }
        },
      });
    },
    onHit(world, me) {
      growStat(me, 'h', 12, 540, 0.5);
    },
  },
  {
    id: 'revolver',
    kind: 'ranged',
    name: 'リボルバー',
    en: 'Revolver',
    color: '#7b6650',
    grow: '当たるたびに 1発のダメージ +0.3(6連射して弾を込め直す)',
    init(b) {
      b.w = { dmg: 1.8, ammo: 6, timer: 0.6 };
    },
    stats: (b) => [
      ['ダメージ', fmt(b.w.dmg)],
      ['弾', b.w.ammo + '/6'],
    ],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      if (me.w.ammo <= 0) {
        me.w.ammo = 6;
        me.w.timer = 0.2;
        return;
      }
      me.w.ammo--;
      me.w.timer = me.w.ammo === 0 ? 2 : 0.32;
      shoot(world, me, me.angle + (world.rng() - 0.5) * 0.1, 950, { kind: 'bullet', r: 4, life: 1.2, damage: me.w.dmg, onTouch: hitOnce() });
    },
    onHit(world, me) {
      me.w.dmg += 0.3;
    },
  },
  {
    id: 'shark',
    kind: 'ranged',
    name: 'サメ',
    en: 'Shark',
    color: '#5c7ea8',
    grow: '当たるたびに かみつきダメージ +1.5(床を泳いで飛びかかる)',
    init(b) {
      b.w = { bite: 5, timer: 0.3 };
    },
    stats: (b) => [['かみつき', fmt(b.w.bite)]],
    update(world, me, foe, dt) {
      me.angle += dt * 2;
      if (world.projectiles.some((p) => p.owner === me.id && p.kind === 'shark')) return;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 0.8;
      spawnProjectile(world, me, {
        x: me.x,
        y: ARENA - 14,
        vx: Math.sign(foe.x - me.x || 1) * 200,
        vy: 0,
        kind: 'shark',
        r: 16,
        life: 8,
        gravity: 1,
        wall: 'bounce',
        blockable: false,
        biteCd: 0,
        update(world, p, owner, foe, dt) {
          if (p.biteCd > 0) p.biteCd -= dt;
          const onFloor = p.y >= ARENA - p.r - 2;
          if (onFloor) {
            p.vy = 0;
            p.vx += Math.sign(foe.x - p.x) * 700 * dt;
            p.vx = Math.max(-300, Math.min(300, p.vx));
            if (Math.abs(foe.x - p.x) < 110 && foe.y > ARENA - 330 && p.biteCd <= 0) p.vy = -900;
          }
          p.angle = Math.atan2(p.vy, p.vx || 1);
        },
        onTouch(world, p, owner, foe) {
          if (p.biteCd > 0) return;
          p.biteCd = 1.2;
          landHit(world, owner, foe, owner.w.bite, { kind: 'shark', x: p.x, y: p.y });
          knockback(p, foe, 200);
        },
      });
    },
    onHit(world, me) {
      me.w.bite += 1.5;
    },
  },
  {
    id: 'copycat',
    kind: 'copy',
    name: 'ものまね',
    en: 'Copycat',
    color: '#b9b9b9',
    grow: '相手と同じ武器になって戦う(成長のしかたも相手と同じ)',
    init(b, world) {
      const foe = foeOf(world, b);
      let src = foe.def.id === 'copycat' ? WEAPON_BY_ID.sword : foe.def;
      // 相手の武器の動きをそのまま使い、見た目の色だけ灰色にする
      b.def = Object.assign(Object.create(src), { color: '#b9b9b9', copyOf: src.id });
      src.init(b, world);
      b.copySpin = b.spin;
    },
    stats: () => [['まね', '?']],
  },
  {
    id: 'counter',
    kind: 'body',
    name: 'カウンター',
    en: 'Counter',
    color: '#d65a5a',
    grow: '受けたダメージをためて衝撃波で返す(近くだけ)。当たるたびに 返す倍率 +0.05',
    init(b) {
      b.w = { rage: 0, mul: 0.7, timer: 2 };
    },
    stats: (b) => [
      ['ため', fmt(Math.round(b.w.rage * 10) / 10)],
      ['倍率', '×' + fmt(Math.round(b.w.mul * 10) / 10)],
    ],
    onTakeDamage(world, me, src, amount, opts) {
      if (src && src !== me) me.w.rage += amount;
      return amount;
    },
    onContact(world, me, foe) {
      landHit(world, me, foe, 1, { kind: 'punch' });
    },
    update(world, me, foe, dt) {
      me.angle += dt * 3;
      me.w.timer -= dt;
      if (me.w.timer > 0 || me.w.rage <= 0) return;
      me.w.timer = 1.8;
      const dmg = Math.max(2, me.w.rage * me.w.mul);
      me.w.rage = 0;
      spawnProjectile(world, me, {
        kind: 'cwave',
        r: 1,
        life: 0.8,
        wall: 'stop',
        blockable: false,
        hit: false,
        ring: 0,
        update(world, p, owner, foe) {
          p.x = owner.x;
          p.y = owner.y;
          p.ring = p.age * 360;
          if (p.ring > 220) p.dead = true;
          if (p.hit) return;
          const d = Math.hypot(foe.x - p.x, foe.y - p.y);
          if (Math.abs(d - p.ring) < foe.r + 8) {
            p.hit = true;
            landHit(world, owner, foe, dmg, { kind: 'counter', x: foe.x, y: foe.y });
            knockback(owner, foe, 320);
          }
        },
      });
    },
    onHit(world, me) {
      me.w.mul += 0.05;
    },
  },
  {
    id: 'gravity',
    kind: 'ranged',
    name: '重力反転',
    en: 'Gravity Flip',
    color: '#7a5fd1',
    grow: '当たった相手の重力を逆にして天井にたたきつける。当たるたびに 逆さの時間と壁ドン威力アップ',
    init(b) {
      b.w = { dur: 1, slamMul: 0.8, timer: 0.8 };
    },
    stats: (b) => [['逆さ時間', fmt(Math.round(shown(b, 'dur') * 10) / 10) + '秒']],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.8;
      shoot(world, me, me.angle, 420, {
        kind: 'gorb',
        r: 9,
        life: 2.5,
        damage: 1.5,
        blockable: true,
        update: (world, p, owner, foe, dt) => homing(p, foe, 1.8, dt),
        onTouch(world, p, owner, foe) {
          p.dead = true;
          if (landHit(world, owner, foe, p.damage, { kind: 'gorb', x: p.x, y: p.y }) > 0) {
            foe.gravFlip = Math.max(foe.gravFlip, owner.w.dur);
            foe.slamT = owner.w.dur + 0.3;
            foe.slamBy = owner.id;
          }
        },
      });
    },
    onHit(world, me) {
      growStat(me, 'dur', 0.05, 2.5, 0.4);
      me.w.slamMul += 0.05;
    },
  },
  {
    ...melee('saber', {
      spin: 4.6,
      state: { dmg: 1.5 },
      blade: { rIn: 26, rOut: 122, w: 7, knock: 90, parry: false },
      damage: (w, me) => me.w.dmg,
    }),
    name: '光の剣',
    en: 'Light Saber',
    color: '#3fd0ff',
    grow: '当たるたびに ダメージ +0.6(刃で防がれず、すり抜けて斬る)',
    stats: (b) => [['ダメージ', fmt(Math.round(b.w.dmg * 10) / 10)]],
    onHit(world, me) {
      me.w.dmg += 0.6;
    },
  },
  {
    id: 'drones',
    kind: 'ranged',
    name: 'ドローン',
    en: 'Drones',
    color: '#5f7d8c',
    grow: '2回当たるたびに ドローン +1(まわりを飛んで弾を撃つ)',
    init(b) {
      b.w = { n: 2, timer: 0.6, dist: 70 };
      setSpin(b, 2);
    },
    stats: (b) => [['ドローン', fmt(Math.floor(shown(b, 'n')))]],
    drones(b) {
      const n = Math.floor(b.w.n);
      return Array.from({ length: n }, (_, i) => {
        const a = b.angle + (i * TAU) / n;
        return [b.x + Math.cos(a) * b.w.dist, b.y + Math.sin(a) * b.w.dist];
      });
    },
    update(world, me, foe, dt) {
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.1;
      for (const [x, y] of this.drones(me)) {
        const a = Math.atan2(foe.y - y, foe.x - x);
        spawnProjectile(world, me, { x, y, vx: Math.cos(a) * 560, vy: Math.sin(a) * 560, angle: a, kind: 'bullet', r: 3.5, life: 1.4, damage: 1.2, onTouch: hitOnce() });
      }
    },
    onHit(world, me) {
      growStat(me, 'n', 0.5, 10, 0.3);
    },
  },
  {
    id: 'quake',
    kind: 'body',
    name: '地震',
    en: 'Earthquake',
    color: '#8a6a45',
    grow: '着地のたびに床を揺らし、床の近くの相手にダメージ。当たるたびに 揺れのダメージ +0.6',
    init(b) {
      b.w = { dmg: 5.5, cd: 0 };
      b.speedMul = 1.05;
    },
    stats: (b) => [['衝撃波', fmt(Math.round(b.w.dmg * 10) / 10)]],
    update(world, me, foe, dt) {
      me.angle += dt * 2;
      if (me.w.cd > 0) me.w.cd -= dt;
      const onFloor = me.y >= ARENA - me.r - 2 && me.vy < 0;
      if (!onFloor || me.w.cd > 0) return;
      me.w.cd = 0.45;
      world.events.push({ type: 'quake', x: me.x, y: ARENA });
      // 床の近くにいる相手は揺れでダメージを受けて跳ね上がる
      if (foe.y + foe.r > ARENA - 260) {
        landHit(world, me, foe, me.w.dmg, { kind: 'quake', x: foe.x, y: foe.y + foe.r });
        foe.vy = Math.min(foe.vy, -650);
      }
    },
    onHit(world, me) {
      me.w.dmg += 0.6;
    },
  },
  {
    id: 'phoenix',
    kind: 'ranged',
    name: '不死鳥',
    en: 'Phoenix',
    color: '#ff7a1a',
    grow: '1度だけよみがえる。当たるたびに よみがえる時のHP +0.5・羽のダメージ +0.2',
    init(b) {
      b.w = { rebirth: 5, revived: false, dmg: 0.9, timer: 0.6 };
    },
    stats: (b) => [
      [b.w.revived ? '復活ずみ' : '復活HP', b.w.revived ? '✓' : fmt(Math.round(b.w.rebirth))],
      ['羽', fmt(Math.round(b.w.dmg * 10) / 10)],
    ],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.4;
      for (const s of [-0.25, 0.25]) {
        shoot(world, me, me.angle + s, 420, {
          kind: 'feather',
          r: 5,
          life: 1.8,
          damage: me.w.dmg,
          update: (world, p, owner, foe, dt) => homing(p, foe, 1.4, dt),
          onTouch(world, p, owner, foe) {
            p.dead = true;
            if (landHit(world, owner, foe, p.damage, { kind: 'feather', x: p.x, y: p.y }) > 0) {
              foe.burnT = 1.5;
              foe.burnDps = Math.max(foe.burnDps, 0.8);
              foe.burnSrc = owner.id;
            }
          },
        });
      }
    },
    onLethal(world, me) {
      if (me.w.revived) return false;
      me.w.revived = true;
      me.hp = Math.min(me.maxHp, me.w.rebirth);
      me.poison = 0;
      me.burnT = 0;
      world.events.push({ type: 'rebirth', x: me.x, y: me.y, target: me.id });
      return true;
    },
    onHit(world, me) {
      if (!me.w.revived) me.w.rebirth += 0.5;
      me.w.dmg += 0.2;
    },
  },
  {
    id: 'magnet',
    kind: 'ranged',
    name: '磁石',
    en: 'Magnet',
    color: '#d64545',
    grow: '近くの飛び道具を奪って撃ち返す。当たるたびに 磁力の範囲アップ',
    init(b) {
      b.w = { range: 140, timer: 0.8 };
    },
    stats: (b) => [['磁力', fmt(Math.round(shown(b, 'range')))]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      // 相手の飛び道具を奪う(持ち主の状態を持たない、単純な弾だけ)
      for (const p of world.projectiles) {
        if (p.owner === me.id || p.dead || !STEALABLE.has(p.kind)) continue;
        if (Math.hypot(p.x - me.x, p.y - me.y) > me.w.range) continue;
        p.owner = me.id;
        const a = Math.atan2(foe.y - p.y, foe.x - p.x);
        const sp = Math.max(300, Math.hypot(p.vx, p.vy));
        p.vx = Math.cos(a) * sp;
        p.vy = Math.sin(a) * sp;
        p.angle = a;
        p.blockGrace = p.age + 0.15;
        world.events.push({ type: 'magnet', x: p.x, y: p.y });
      }
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.1;
      // 砂鉄を飛ばす
      for (const s of [-0.2, 0, 0.2]) shoot(world, me, me.angle + s, 520, { kind: 'bullet', r: 3.5, life: 1.3, damage: 2.6, onTouch: hitOnce() });
    },
    onHit(world, me) {
      growStat(me, 'range', 4, 260, 0.4);
    },
  },
  {
    id: 'star',
    kind: 'ranged',
    name: '流れ星',
    en: 'Shooting Star',
    color: '#f5d742',
    grow: '当たるたびに 弾ける小さな星 +1',
    init(b) {
      b.w = { k: 4, timer: 0.8 };
    },
    stats: (b) => [['小さな星', fmt(Math.floor(shown(b, 'k')))]],
    update(world, me, foe, dt) {
      me.angle = -Math.PI / 2;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.2;
      const k = Math.floor(me.w.k);
      const side = world.rng() < 0.5 ? 0 : ARENA;
      const sx = side + (side ? -20 : 20);
      const a = Math.atan2(foe.y - 20, foe.x - sx);
      spawnProjectile(world, me, {
        x: sx,
        y: 20,
        vx: Math.cos(a) * 640,
        vy: Math.sin(a) * 640,
        angle: a,
        kind: 'star',
        r: 10,
        life: 2,
        wall: 'die',
        blockable: false,
        damage: 4,
        onTouch(world, p, owner, foe) {
          p.dead = true;
          landHit(world, owner, foe, p.damage, { kind: 'star', x: p.x, y: p.y });
          world.events.push({ type: 'burst', x: p.x, y: p.y, hue: 50 });
          for (let i = 0; i < k; i++) {
            const b = (i / k) * TAU;
            spawnProjectile(world, owner, {
              x: p.x + Math.cos(b) * (foe.r + 14),
              y: p.y + Math.sin(b) * (foe.r + 14),
              vx: Math.cos(b) * 300,
              vy: Math.sin(b) * 300,
              kind: 'ministar',
              r: 5,
              life: 1.2,
              wall: 'bounce',
              blockable: false,
              damage: 1.5,
              update: (world, q, owner, foe, dt) => {
                if (q.age > 0.3) homing(q, foe, 5, dt, 340);
              },
              onTouch: hitOnce(),
            });
          }
        },
      });
    },
    onHit(world, me, foe, info) {
      if (info.kind === 'star') growStat(me, 'k', 1, 24, 0.3);
    },
  },
  {
    id: 'axethrow',
    kind: 'ranged',
    name: '斧投げ',
    en: 'Throwing Axes',
    color: '#9c5a2b',
    grow: '3回当たるたびに 投げる斧 +1(重くて痛い)',
    init(b) {
      b.w = { n: 1, timer: 0.6 };
    },
    stats: (b) => [['斧', fmt(Math.floor(shown(b, 'n')))]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.6;
      const n = Math.floor(me.w.n);
      for (let i = 0; i < n; i++) {
        shoot(world, me, me.angle - 0.35 + (i - (n - 1) / 2) * 0.22, 560, {
          kind: 'axe',
          r: 11,
          life: 2.5,
          gravity: 0.6,
          wall: 'die',
          blockable: true,
          damage: 4,
          update(world, p, owner, foe, dt) {
            p.angle += 16 * dt;
          },
          onTouch(world, p, owner, foe) {
            p.dead = true;
            landHit(world, owner, foe, p.damage, { kind: 'axe', x: p.x, y: p.y });
            knockback(p, foe, 220);
          },
        });
      }
    },
    onHit(world, me) {
      growStat(me, 'n', 0.34, 8, 0.4);
    },
  },
  {
    id: 'danmaku',
    kind: 'ranged',
    name: '弾幕',
    en: 'Bullet Hell',
    color: '#e04fd0',
    grow: '当たるたびに 一度にばらまく弾 +1(うずまき状に広がる)',
    init(b) {
      b.w = { k: 8, timer: 0.6, rot: 0 };
    },
    stats: (b) => [['弾', fmt(Math.floor(shown(b, 'k')))]],
    update(world, me, foe, dt) {
      me.angle += dt * 3;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.4;
      me.w.rot += 0.35;
      const k = Math.floor(me.w.k);
      const hue = Math.floor(world.rng() * 360);
      for (let i = 0; i < k; i++) {
        const a = me.w.rot + (i / k) * TAU;
        shoot(world, me, a, 260, {
          kind: 'orbbullet',
          hue,
          r: 5,
          life: 2.4,
          damage: 0.8,
          curve: 0.9,
          update(world, p, owner, foe, dt) {
            // ゆっくり曲がってうずまきに
            const c = Math.cos(p.curve * dt);
            const s = Math.sin(p.curve * dt);
            [p.vx, p.vy] = [p.vx * c - p.vy * s, p.vx * s + p.vy * c];
          },
          onTouch: hitOnce(),
        });
      }
    },
    onHit(world, me) {
      growStat(me, 'k', 1, 48, 0.3);
    },
  },
  {
    id: 'wrecking',
    kind: 'ranged',
    name: '鉄球',
    en: 'Wrecking Ball',
    color: '#4a4a52',
    grow: '天井からつるした大きな鉄球が振り子で揺れる。当たるたびに ダメージ +1',
    init(b) {
      b.w = { dmg: 3.5, theta: 0.88, omega: 0, len: 380, cd: 0, hx: 300, hy: 380 };
    },
    stats: (b) => [['ダメージ', fmt(b.w.dmg)]],
    update(world, me, foe, dt) {
      const w = me.w;
      // 振り子。振れ幅がいつも約50度(壁の手前まで)になるよう、速さを少しずつ合わせる
      const g = GRAVITY / w.len;
      w.omega += -g * Math.sin(w.theta) * dt;
      w.theta += w.omega * dt;
      const want = 2 * g * (Math.cos(w.theta) - Math.cos(0.88));
      if (want > 0.01) {
        const sp = Math.sqrt(want) * (Math.sign(w.omega) || 1);
        w.omega += (sp - w.omega) * Math.min(1, dt * 2);
      }
      w.hx = ARENA / 2 + Math.sin(w.theta) * w.len;
      w.hy = Math.cos(w.theta) * w.len;
      me.angle = Math.PI / 2;
      if (w.cd > 0) {
        w.cd -= dt;
        return;
      }
      if (Math.hypot(foe.x - w.hx, foe.y - w.hy) < foe.r + 30) {
        w.cd = 0.6;
        landHit(world, me, foe, w.dmg, { kind: 'wreck', x: w.hx, y: w.hy });
        foe.vx += Math.cos(w.theta) * w.omega * w.len * 1.2;
        foe.vy -= 200;
        foe.slamT = 0.8;
        foe.slamBy = me.id;
      }
    },
    onHit(world, me, foe, info) {
      if (info.kind === 'wreck') me.w.dmg += 1;
    },
  },
  {
    id: 'storm',
    kind: 'ranged',
    name: '雷雲',
    en: 'Storm Cloud',
    color: '#5b6d8a',
    grow: '相手の上に雨雲がついてくる。当たるたびに 雨の勢いアップ(ときどき落雷)',
    init(b) {
      b.w = { rain: 4, timer: 0, bolt: 1.5, cx: b.x, cy: 60 };
    },
    stats: (b) => [['雨', fmt(Math.round(b.w.rain * 10) / 10)]],
    update(world, me, foe, dt) {
      me.angle = -Math.PI / 2;
      const w = me.w;
      // 雲は相手の上空をゆっくり追う
      w.cx += (foe.x - w.cx) * Math.min(1, dt * 1.6);
      w.cy += (Math.max(50, foe.y - 200) - w.cy) * Math.min(1, dt * 1.2);
      w.timer -= dt;
      if (w.timer <= 0) {
        w.timer = 1 / w.rain;
        spawnProjectile(world, me, {
          x: w.cx + (world.rng() - 0.5) * 80,
          y: w.cy + 20,
          vx: 0,
          vy: 520,
          kind: 'raindrop',
          r: 3,
          life: 1.5,
          wall: 'die',
          blockable: true,
          damage: 1,
          onTouch: hitOnce(),
        });
      }
      w.bolt -= dt;
      if (w.bolt <= 0) {
        w.bolt = 1.6;
        strike(world, me, foe.x, foe.y, 0.45, 0, true);
      }
    },
    onHit(world, me) {
      me.w.rain += 0.2;
    },
  },
  {
    id: 'giant',
    kind: 'body',
    name: '巨大化',
    en: 'Giant',
    color: '#c27a4a',
    grow: '体当たりが当たるたびに 体が大きくなる(大きいほど痛い)',
    init(b) {
      b.w = { size: b.r };
    },
    stats: (b) => [['大きさ', fmt(Math.round(shown(b, 'size')))]],
    onContact(world, me, foe) {
      landHit(world, me, foe, me.r / 9, { kind: 'punch' });
      knockback(me, foe, 150 + me.r * 2);
    },
    update(world, me) {
      me.angle = Math.atan2(me.vy, me.vx);
    },
    onHit(world, me) {
      growStat(me, 'size', 2, 95, 0.5);
      me.r = me.w.size;
    },
  },
  {
    ...melee('vampire', {
      spin: 3.8,
      state: { steal: 2, dmg: 4 },
      blade: { rIn: 22, rOut: 84, w: 10 },
      damage: (w, me) => me.w.dmg,
    }),
    name: '吸命の牙',
    en: 'Life Drain',
    color: '#8c1c3a',
    grow: '当たるたびに 相手の最大HPを2奪って自分のものにする・ダメージ +0.8',
    stats: (b) => [
      ['最大HP', fmt(Math.round(b.maxHp))],
      ['ダメージ', fmt(Math.round(b.w.dmg * 10) / 10)],
    ],
    onHit(world, me, foe, info) {
      if (info.kind === 'pre') {
        me.w.dmg += 0.8;
        return;
      }
      const s = Math.min(me.w.steal, Math.max(0, foe.maxHp - 20));
      foe.maxHp -= s;
      foe.hp = Math.min(foe.hp, foe.maxHp);
      me.maxHp += s;
      heal(world, me, s);
      me.w.dmg += 0.8;
    },
  },
  {
    id: 'spirit',
    kind: 'ranged',
    name: '霊剣',
    en: 'Spirit Swords',
    color: '#8fd9ff',
    grow: '2回当たるたびに 浮かぶ剣 +1(順番に飛んでいって刺さる)',
    init(b) {
      b.w = { n: 2, timer: 0.5, next: 0 };
      setSpin(b, 2.5);
    },
    stats: (b) => [['霊剣', fmt(Math.floor(shown(b, 'n')))]],
    update(world, me, foe, dt) {
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      const n = Math.floor(me.w.n);
      me.w.timer = 2.0 / n;
      const i = me.w.next++ % n;
      const a = me.angle + (i * TAU) / n;
      const x = me.x + Math.cos(a) * 58;
      const y = me.y + Math.sin(a) * 58;
      const b = Math.atan2(foe.y - y, foe.x - x);
      spawnProjectile(world, me, {
        x,
        y,
        vx: Math.cos(b) * 200,
        vy: Math.sin(b) * 200,
        angle: b,
        kind: 'spiritsword',
        r: 6,
        life: 1.8,
        blockable: true,
        damage: 0.75,
        update(world, p, owner, foe, dt) {
          homing(p, foe, 3, dt, Math.min(760, Math.hypot(p.vx, p.vy) + 1400 * dt));
        },
        onTouch: hitOnce(),
      });
    },
    onHit(world, me) {
      growStat(me, 'n', 0.5, 12, 0.3);
    },
  },
  {
    id: 'lava',
    kind: 'ranged',
    name: '溶岩',
    en: 'Lava Floor',
    color: '#e8461a',
    grow: 'ときどき床を溶岩にする(自分は平気)。当たるたびに 溶岩の時間 +0.1秒',
    init(b) {
      b.w = { dur: 1.6, timer: 1.5, ball: 0.8 };
    },
    stats: (b) => [['溶岩', fmt(Math.round(shown(b, 'dur') * 10) / 10) + '秒']],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.ball -= dt;
      if (me.w.ball <= 0) {
        me.w.ball = 1.6;
        shoot(world, me, me.angle - 0.4, 420, {
          kind: 'magma',
          r: 8,
          life: 2,
          gravity: 0.6,
          wall: 'die',
          damage: 3,
          onTouch: hitOnce(),
        });
      }
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2.6;
      spawnProjectile(world, me, {
        x: ARENA / 2,
        y: ARENA - 4,
        kind: 'lava',
        r: 1,
        life: me.w.dur,
        wall: 'stop',
        blockable: false,
        tick: 0,
        update(world, p, owner, foe, dt) {
          p.tick -= dt;
          if (p.tick <= 0 && foe.y + foe.r >= ARENA - 10) {
            p.tick = 0.25;
            if (landHit(world, owner, foe, 3, { kind: 'lava', x: foe.x, y: ARENA - 10 }) > 0) {
              foe.burnT = 1.5;
              foe.burnDps = Math.max(foe.burnDps, 1);
              foe.burnSrc = owner.id;
            }
          }
        },
      });
    },
    onHit(world, me, foe, info) {
      growStat(me, 'dur', 0.1, 3.5, 0.4);
    },
  },
  {
    id: 'gears',
    kind: 'ranged',
    name: '歯車',
    en: 'Gears',
    color: '#a88b4a',
    grow: '2回当たるたびに 壁をつたって走る歯車 +1',
    init(b) {
      b.w = { n: 2, timer: 0.3 };
    },
    stats: (b) => [['歯車', fmt(Math.floor(shown(b, 'n')))]],
    update(world, me, foe, dt) {
      me.angle += dt * 5;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 0.7;
      const alive = world.projectiles.filter((p) => p.owner === me.id && p.kind === 'gear').length;
      if (alive >= Math.floor(me.w.n)) return;
      const dir = world.rng() < 0.5 ? 1 : -1;
      spawnProjectile(world, me, {
        x: 0,
        y: 0,
        kind: 'gear',
        r: 18,
        life: 9,
        wall: 'stop',
        blockable: false,
        s: world.rng() * 4 * (ARENA - 36),
        dir,
        hitCd: 0,
        update(world, p, owner, foe, dt) {
          // 四角い壁ぞいを一周し続ける(s は周の上の位置)
          const side = ARENA - 2 * p.r;
          const per = 4 * side;
          p.s = (p.s + p.dir * 400 * dt + per) % per;
          const k = Math.floor(p.s / side);
          const t = p.s - k * side;
          const lo = p.r;
          const hi = ARENA - p.r;
          [p.x, p.y] = k === 0 ? [lo + t, lo] : k === 1 ? [hi, lo + t] : k === 2 ? [hi - t, hi] : [lo, hi - t];
          p.vx = p.vy = 0;
          p.angle += p.dir * 10 * dt;
          if (p.hitCd > 0) p.hitCd -= dt;
        },
        onTouch(world, p, owner, foe) {
          if (p.hitCd > 0) return;
          p.hitCd = 0.5;
          landHit(world, owner, foe, 4, { kind: 'gear', x: p.x, y: p.y });
          knockback(p, foe, 220);
        },
      });
    },
    onHit(world, me) {
      growStat(me, 'n', 0.5, 10, 0.4);
    },
  },
  {
    id: 'kamaitachi',
    kind: 'ranged',
    name: '鎌鼬',
    en: 'Wind Blades',
    color: '#7fd6b0',
    grow: '2回当たるたびに 飛ばす風の刃 +1(刃をすり抜ける)',
    init(b) {
      b.w = { n: 1, timer: 0.5 };
    },
    stats: (b) => [['風の刃', fmt(Math.floor(shown(b, 'n')))]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.3;
      const n = Math.floor(me.w.n);
      for (let i = 0; i < n; i++) {
        shoot(world, me, me.angle + (i - (n - 1) / 2) * 0.3, 520, {
          kind: 'wind',
          r: 13,
          life: 1.4,
          wall: 'die',
          blockable: false,
          damage: 1.6,
          onTouch: hitOnce(),
        });
      }
    },
    onHit(world, me) {
      growStat(me, 'n', 0.5, 12, 0.4);
    },
  },
  {
    id: 'bumper',
    kind: 'ranged',
    name: 'バンパー',
    en: 'Bumpers',
    color: '#ff5fa2',
    grow: '2回当たるたびに 置けるバンパー +1(ぶつかると大きく弾かれて壁ドン)',
    init(b) {
      b.w = { n: 1, timer: 0.4, slamMul: 0.2 };
    },
    stats: (b) => [['バンパー', fmt(Math.floor(shown(b, 'n')))]],
    update(world, me, foe, dt) {
      me.angle += dt * 3;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2;
      const mine = world.projectiles.filter((p) => p.owner === me.id && p.kind === 'bumper');
      if (mine.length >= Math.floor(me.w.n)) mine[0].dead = true;
      spawnProjectile(world, me, {
        x: 80 + world.rng() * (ARENA - 160),
        y: 80 + world.rng() * (ARENA - 220),
        kind: 'bumper',
        r: 22,
        life: 12,
        wall: 'stop',
        blockable: false,
        hitCd: 0,
        pop: 0,
        update(world, p, owner, foe, dt) {
          if (p.hitCd > 0) p.hitCd -= dt;
          if (p.pop > 0) p.pop -= dt;
        },
        onTouch(world, p, owner, foe) {
          if (p.hitCd > 0) return;
          p.hitCd = 0.4;
          p.pop = 0.15;
          const a = Math.atan2(foe.y - p.y, foe.x - p.x);
          foe.vx = Math.cos(a) * 750;
          foe.vy = Math.sin(a) * 750;
          foe.slamT = 0.7;
          foe.slamBy = owner.id;
          landHit(world, owner, foe, 0.8, { kind: 'bumper', x: p.x, y: p.y });
        },
      });
    },
    onHit(world, me) {
      growStat(me, 'n', 0.5, 9, 0.4);
    },
  },
  {
    id: 'prism',
    kind: 'ranged',
    name: 'プリズム',
    en: 'Prism Laser',
    color: '#b07cff',
    grow: '3回当たるたびに レーザーが壁で跳ね返る回数 +1',
    init(b) {
      b.w = { bounces: 1, timer: 1 };
      setSpin(b, 0);
    },
    stats: (b) => [['反射', fmt(Math.floor(shown(b, 'bounces')))]],
    update(world, me, foe, dt) {
      const want = aimAt(me, foe);
      const diff = ((want - me.angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
      me.angle += diff * Math.min(1, dt * 6);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.8;
      const bounces = Math.floor(me.w.bounces);
      spawnProjectile(world, me, {
        kind: 'prismcharge',
        r: 1,
        life: 0.5,
        wall: 'stop',
        blockable: false,
        update(world, p, owner) {
          p.x = owner.x;
          p.y = owner.y;
          p.angle = owner.angle;
        },
        onExpire(world, p, owner, foe) {
          const segs = traceBeam(owner.x, owner.y, owner.angle, bounces);
          world.events.push({ type: 'prism', segs });
          if (segs.some(([x1, y1, x2, y2]) => segPointDist(x1, y1, x2, y2, foe.x, foe.y) < foe.r + 8)) {
            landHit(world, owner, foe, 9, { kind: 'prism', x: foe.x, y: foe.y });
          }
        },
      });
    },
    onHit(world, me) {
      growStat(me, 'bounces', 0.34, 8, 0.4);
    },
  },
  {
    id: 'ghost',
    kind: 'ranged',
    name: 'ゴースト',
    en: 'Ghosts',
    color: '#d8d8f0',
    grow: '2回おどかすたびに ゴースト +1(何でもすり抜け、触れた相手を遅くする)',
    init(b) {
      b.w = { n: 1, timer: 0.4 };
    },
    stats: (b) => [['ゴースト', fmt(Math.floor(shown(b, 'n')))]],
    update(world, me, foe, dt) {
      me.angle += dt * 2;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 0.8;
      const alive = world.projectiles.filter((p) => p.owner === me.id && p.kind === 'ghost').length;
      if (alive >= Math.floor(me.w.n)) return;
      shoot(world, me, world.rng() * TAU, 120, {
        kind: 'ghost',
        r: 14,
        life: 7,
        wall: 'stop',
        blockable: false,
        hitCd: 0,
        wob: world.rng() * TAU,
        update(world, p, owner, foe, dt) {
          p.wob += dt * 3;
          homing(p, foe, 1.5, dt, 150 + Math.sin(p.wob) * 40);
          if (p.hitCd > 0) p.hitCd -= dt;
        },
        onTouch(world, p, owner, foe) {
          if (p.hitCd > 0) return;
          p.hitCd = 1;
          if (landHit(world, owner, foe, 1.5, { kind: 'ghost', x: p.x, y: p.y }) > 0) {
            foe.slow = Math.max(foe.slow, 0.35);
            foe.slowT = 0.8;
          }
        },
      });
    },
    onHit(world, me) {
      growStat(me, 'n', 0.5, 10, 0.4);
    },
  },
  // ---- 102種への追加分 ----
  {
    id: 'sakura',
    kind: 'ranged',
    name: '桜吹雪',
    en: 'Cherry Blossom',
    color: '#f49ac1',
    grow: '当たるたびに 花びら +1(うずを巻いて相手へ流れていく)',
    init(b) {
      b.w = { n: 3, timer: 0.5 };
    },
    stats: (b) => [['花びら', fmt(shown(b, 'n'))]],
    update(world, me, foe, dt) {
      me.angle += dt;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.5;
      const n = Math.floor(me.w.n);
      for (let i = 0; i < n; i++) {
        shoot(world, me, me.angle + (i * TAU) / n, 220, {
          kind: 'petal',
          r: 6,
          life: 2.6,
          damage: 0.45,
          spin: world.rng() * TAU,
          update(world, p, owner, foe, dt) {
            p.spin += dt * 6;
            if (p.age < 0.45) {
              // はじめは渦を巻くように曲がる
              const a = Math.atan2(p.vy, p.vx) + dt * 2.2;
              const sp = Math.hypot(p.vx, p.vy);
              p.vx = Math.cos(a) * sp;
              p.vy = Math.sin(a) * sp;
            } else {
              homing(p, foe, 1.6, dt, 260);
            }
          },
          onTouch: hitOnce(),
        });
      }
    },
    onHit(world, me) {
      growStat(me, 'n', 1, 40, 0.25);
    },
  },
  {
    id: 'pinball',
    kind: 'ranged',
    name: 'ピンボール',
    en: 'Pinball',
    color: '#8d99ae',
    grow: '3回当たるたびに 鉄の玉 +1(壁や相手で何度も跳ね返る)',
    init(b) {
      b.w = { n: 1, timer: 0.6 };
    },
    stats: (b) => [['鉄の玉', fmt(Math.floor(shown(b, 'n')))]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2.4;
      const n = Math.floor(me.w.n);
      for (let i = 0; i < n; i++) {
        shoot(world, me, me.angle + (i - (n - 1) / 2) * 0.3, 560, {
          kind: 'pinball',
          r: 9,
          life: 4,
          gravity: 0.6,
          wall: 'bounce',
          bounces: 4,
          damage: 1,
          blockable: false,
          hitCd: 0,
          left: 2,
          update(world, p, owner, foe, dt) {
            if (p.hitCd > 0) p.hitCd -= dt;
          },
          onTouch(world, p, owner, o) {
            if (p.hitCd > 0) return;
            p.hitCd = 0.35;
            landHit(world, owner, o, p.damage, { kind: 'pinball', x: p.x, y: p.y });
            // 相手から跳ね返る
            const d = Math.hypot(p.x - o.x, p.y - o.y) || 1;
            const sp = Math.max(420, Math.hypot(p.vx, p.vy));
            p.vx = ((p.x - o.x) / d) * sp;
            p.vy = ((p.y - o.y) / d) * sp - 120;
            if (--p.left <= 0) p.dead = true;
          },
        });
      }
    },
    onHit(world, me) {
      growStat(me, 'n', 0.34, 6, 0.5);
    },
  },
  {
    id: 'splitter',
    kind: 'ranged',
    name: '分裂キューブ',
    en: 'Splitter Cube',
    color: '#5fbf77',
    grow: '3回当たるたびに 分裂する回数 +1(壁や相手に当たると2つに割れる。数が倍々に増える)',
    init(b) {
      b.w = { gen: 1, timer: 0.8 };
    },
    stats: (b) => [['分裂', fmt(Math.floor(shown(b, 'gen')))]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2.6;
      cube(world, me, me.x + Math.cos(me.angle) * (me.r + 14), me.y + Math.sin(me.angle) * (me.r + 14), me.angle, 13, Math.floor(me.w.gen));
    },
    onHit(world, me) {
      growStat(me, 'gen', 0.34, 5, 0.6);
    },
  },
  {
    id: 'frog',
    kind: 'melee',
    name: 'カエル',
    en: 'Frog',
    color: '#4caf50',
    grow: '当たるたびに 舌が長くなる(相手に向けて舌をのばして叩く)',
    init(b) {
      b.w = { len: 90, timer: 0.5, lash: 0 };
      setSpin(b, 0);
      b.blades = [makeBlade({ sprite: 'tongue', rIn: b.r - 6, rOut: b.r, w: 14, damage: 3, knock: 260, cd: 0.45, parry: false })];
    },
    stats: (b) => [['舌の長さ', fmt(Math.round(shown(b, 'len')))]],
    update(world, me, foe, dt) {
      const w = me.w;
      const bl = me.blades[0];
      w.timer -= dt;
      if (w.lash <= 0) me.angle = aimAt(me, foe);
      if (w.timer <= 0 && w.lash <= 0) {
        w.timer = 0.9;
        w.lash = 0.4;
      }
      if (w.lash > 0) {
        w.lash -= dt;
        const k = Math.sin(Math.PI * Math.min(1, 1 - w.lash / 0.4));
        bl.rOut = me.r + Math.max(0, k) * w.len;
      } else {
        bl.rOut = me.r;
      }
      bl.rIn = me.r - 6;
    },
    onHit(world, me) {
      growStat(me, 'len', 12, 300, 0.8);
    },
  },
  {
    id: 'balloon',
    kind: 'ranged',
    name: '風船',
    en: 'Balloons',
    color: '#ff5c8a',
    grow: '3回当たるたびに 風船 +1(ふわふわ上がって、割れると矢が飛び出す)',
    init(b) {
      b.w = { n: 1, timer: 0.7 };
    },
    stats: (b) => [['風船', fmt(Math.floor(shown(b, 'n')))]],
    update(world, me, foe, dt) {
      me.angle = -Math.PI / 2;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2.4;
      const n = Math.floor(me.w.n);
      for (let i = 0; i < n; i++) {
        spawnProjectile(world, me, {
          x: me.x + (i - (n - 1) / 2) * 18,
          y: me.y - me.r - 12,
          vx: (world.rng() - 0.5) * 140,
          vy: -80,
          kind: 'balloon',
          r: 12,
          life: 2.2 + world.rng() * 1.2,
          gravity: -0.22,
          wall: 'die',
          blockable: false,
          hue: Math.floor(world.rng() * 360),
          onTouch(world, p, owner, o) {
            p.dead = true;
            popBalloon(world, p, owner, o);
          },
          onExpire: (world, p, owner, foe) => popBalloon(world, p, owner, foe),
        });
      }
    },
    onHit(world, me) {
      growStat(me, 'n', 0.34, 10, 0.5);
    },
  },
  {
    id: 'cards',
    kind: 'ranged',
    name: 'トランプ',
    en: 'Playing Cards',
    color: '#c0392b',
    grow: '2回当たるたびに 投げるカード +1(♠大ダメージ ♥回復 ♦やけど ♣しびれ)',
    init(b) {
      b.w = { n: 2, timer: 0.6 };
    },
    stats: (b) => [['カード', fmt(Math.floor(shown(b, 'n')))]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.6;
      const n = Math.floor(me.w.n);
      for (let i = 0; i < n; i++) {
        shoot(world, me, me.angle + (i - (n - 1) / 2) * 0.18, 560, {
          kind: 'card',
          r: 6,
          life: 1.6,
          suit: Math.floor(world.rng() * 4),
          onTouch(world, p, owner, o) {
            p.dead = true;
            const info = { kind: 'card', x: p.x, y: p.y };
            if (p.suit === 0) landHit(world, owner, o, 2.2, info);
            else if (landHit(world, owner, o, 1, info) > 0) {
              if (p.suit === 1) heal(world, owner, 1.5);
              if (p.suit === 2) {
                o.burnT = 1.5;
                o.burnDps = Math.max(o.burnDps, 1.5);
                o.burnSrc = owner.id;
              }
              if (p.suit === 3) o.stun = Math.max(o.stun, 0.15);
            }
          },
        });
      }
    },
    onHit(world, me) {
      growStat(me, 'n', 0.5, 12, 0.5);
    },
  },
  {
    id: 'skeleton',
    kind: 'ranged',
    name: '骸骨使い',
    en: 'Necromancer',
    color: '#9c8f7a',
    grow: '3回当たるたびに 呼び出す骸骨 +1(床を歩いて相手に飛びかかる)',
    init(b) {
      b.w = { n: 1, timer: 1 };
    },
    stats: (b) => [['骸骨', fmt(Math.floor(shown(b, 'n')))]],
    update(world, me, foe, dt) {
      me.angle = Math.PI / 2;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 3;
      const n = Math.floor(me.w.n);
      for (let i = 0; i < n; i++) {
        spawnProjectile(world, me, {
          x: Math.max(20, Math.min(ARENA - 20, me.x + (i - (n - 1) / 2) * 26)),
          y: me.y,
          vx: 0,
          vy: 0,
          kind: 'skeleton',
          r: 11,
          life: 5,
          gravity: 1,
          wall: 'stop',
          blockable: false,
          hitCd: 0,
          jump: world.rng() * 0.5,
          update(world, p, owner, foe, dt) {
            if (p.hitCd > 0) p.hitCd -= dt;
            const onFloor = p.y >= ARENA - p.r - 1;
            const dx = foe.x - p.x;
            if (onFloor) {
              if (p.vy > 0) p.vy = 0;
              p.vx = Math.sign(dx) * 120;
              p.jump -= dt;
              if (p.jump <= 0 && Math.abs(dx) < 160) {
                p.jump = 1;
                p.vy = -520;
                p.vx = Math.sign(dx) * 220;
              }
            }
          },
          onTouch(world, p, owner, o) {
            if (p.hitCd > 0) return;
            p.hitCd = 0.6;
            landHit(world, owner, o, 1, { kind: 'skeleton', x: p.x, y: p.y });
          },
        });
      }
    },
    onHit(world, me) {
      growStat(me, 'n', 0.34, 8, 0.5);
    },
  },
  {
    id: 'firecracker',
    kind: 'ranged',
    name: '爆竹',
    en: 'Firecrackers',
    color: '#e5383b',
    grow: '当たるたびに 連なる爆竹 +1(相手に向かってパパパッと連続で爆発)',
    init(b) {
      b.w = { n: 3, timer: 1 };
    },
    stats: (b) => [['爆竹', fmt(shown(b, 'n'))]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2.2;
      const n = Math.floor(me.w.n);
      // 相手の少し手前から、相手を通りすぎるように一列に並べる(長くなると折れ曲がる)
      const a = me.angle;
      for (let i = 0; i < n; i++) {
        const d = (i - 1.5) * 26;
        const bend = Math.floor(i / 6) * 0.9;
        // 爆発するころに相手がいそうな場所をねらう
        const delay = 0.15 + i * 0.07;
        const x = Math.max(16, Math.min(ARENA - 16, foe.x + foe.vx * delay + Math.cos(a + bend) * d));
        const y = Math.max(16, Math.min(ARENA - 16, foe.y + foe.vy * delay + Math.sin(a + bend) * d));
        spawnProjectile(world, me, {
          x,
          y,
          kind: 'cracker',
          r: 6,
          life: 0.15 + i * 0.07,
          wall: 'stop',
          blockable: false,
          onExpire: (world, p, owner, foe) => explode(world, p, owner, foe, 48, 2.2, 'bomb'),
        });
      }
    },
    onHit(world, me) {
      growStat(me, 'n', 1, 30, 0.3);
    },
  },
  {
    id: 'urchin',
    kind: 'ranged',
    name: 'ウニ',
    en: 'Sea Urchin',
    color: '#3d2c5e',
    grow: '当たるたびに 全方向に飛ばすトゲ +2',
    init(b) {
      b.w = { n: 6, timer: 0.8 };
    },
    stats: (b) => [['トゲ', fmt(shown(b, 'n'))]],
    update(world, me, foe, dt) {
      me.angle += dt * 0.7;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.5;
      const n = Math.floor(me.w.n);
      for (let i = 0; i < n; i++) {
        shoot(world, me, me.angle + (i * TAU) / n, 480, { kind: 'spine', r: 5, life: 1.6, damage: 1.1, blockable: false, onTouch: hitOnce() });
      }
    },
    onHit(world, me) {
      growStat(me, 'n', 2, 36, 0.3);
    },
  },
  {
    id: 'plasma',
    kind: 'ranged',
    name: 'プラズマ球',
    en: 'Plasma Orb',
    color: '#7b5cff',
    grow: '当たるたびに 電気の届く範囲が広がる(ゆっくり進む球が、近くの相手全員に放電)',
    init(b) {
      b.w = { reach: 90, timer: 0.5 };
    },
    stats: (b) => [['放電範囲', fmt(Math.round(shown(b, 'reach')))]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 3;
      shoot(world, me, me.angle, 160, {
        kind: 'plasma',
        r: 14,
        life: 4,
        wall: 'bounce',
        blockable: false,
        reach: me.w.reach,
        tick: 0.2,
        update(world, p, owner, foe, dt) {
          homing(p, foe, 1.4, dt, 170);
          p.tick -= dt;
          if (p.tick > 0) return;
          p.tick = 0.5;
          for (const o of world.balls) {
            if (o === owner || o.dead) continue;
            if (Math.hypot(o.x - p.x, o.y - p.y) < p.reach + o.r) {
              landHit(world, owner, o, 1.7, { kind: 'plasma', x: o.x, y: o.y });
            }
          }
        },
      });
    },
    onHit(world, me) {
      growStat(me, 'reach', 7, 240, 0.6);
    },
  },
  {
    id: 'chakram',
    kind: 'ranged',
    name: '円月輪',
    en: 'Chakram',
    color: '#e0b03a',
    grow: '2回当たるたびに 跳ね返って当たり直す回数 +1',
    init(b) {
      b.w = { n: 2, timer: 0.5 };
    },
    stats: (b) => [['跳ね返り', fmt(Math.floor(shown(b, 'n')))]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2.2;
      shoot(world, me, me.angle, 600, {
        kind: 'chakram',
        r: 11,
        life: 4,
        wall: 'bounce',
        damage: 2,
        hitCd: 0,
        left: Math.floor(me.w.n),
        update(world, p, owner, foe, dt) {
          p.angle += dt * 18;
          if (p.hitCd > 0) p.hitCd -= dt;
          else homing(p, foe, 4, dt, 600);
        },
        onTouch(world, p, owner, o) {
          if (p.hitCd > 0) return;
          p.hitCd = 0.3;
          landHit(world, owner, o, p.damage, { kind: 'chakram', x: p.x, y: p.y });
          if (--p.left < 0) {
            p.dead = true;
            return;
          }
          // 当たった相手から跳ね返る(少しして、また相手に向かってくる)
          const d = Math.hypot(p.x - o.x, p.y - o.y) || 1;
          p.vx = ((p.x - o.x) / d) * 600;
          p.vy = ((p.y - o.y) / d) * 600;
        },
      });
    },
    onHit(world, me) {
      growStat(me, 'n', 0.5, 12, 0.5);
    },
  },
  {
    id: 'butterfly',
    kind: 'ranged',
    name: '蝶',
    en: 'Butterflies',
    color: '#5ec8e5',
    grow: '3回当たるたびに 蝶 +1(ひらひら飛んで、刺すと少し回復)',
    init(b) {
      b.w = { n: 1, timer: 0.6 };
    },
    stats: (b) => [['蝶', fmt(Math.floor(shown(b, 'n')))]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2.5;
      const n = Math.floor(me.w.n);
      for (let i = 0; i < n; i++) {
        shoot(world, me, me.angle + (i - (n - 1) / 2) * 0.5 + (world.rng() - 0.5), 160, {
          kind: 'butterfly',
          r: 8,
          life: 4.5,
          wall: 'bounce',
          blockable: false,
          hitCd: 0,
          wob: world.rng() * TAU,
          update(world, p, owner, foe, dt) {
            p.wob += dt * 5;
            homing(p, foe, 1.8, dt, 150 + Math.sin(p.wob) * 60);
            if (p.hitCd > 0) p.hitCd -= dt;
          },
          onTouch(world, p, owner, o) {
            if (p.hitCd > 0) return;
            p.hitCd = 0.9;
            if (landHit(world, owner, o, 0.5, { kind: 'butterfly', x: p.x, y: p.y }) > 0) heal(world, owner, 0.25);
          },
        });
      }
    },
    onHit(world, me) {
      growStat(me, 'n', 0.34, 12, 0.4);
    },
  },
];

function grow(me) {
  growStat(me, 'width', 0.25, 7);
  me.w.reflect += 1;
  me.blades[0].w = me.w.width * 14;
}

export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

// 安全のため: どの武器も必要な項目を持っているか(テストでも使う)
export function validateWeapon(def) {
  const missing = ['id', 'name', 'en', 'color', 'grow', 'init', 'stats'].filter((k) => !def[k]);
  return missing;
}

export { ARENA };
