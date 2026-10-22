// 武器の定義。攻撃が当たるたびに onHit で能力値が成長する。
// stats() が返す値が画面下に表示される(動画の「Damage: 6」のような部分)。

import {
  ARENA,
  BASE_SPEED,
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
  if (Math.hypot(foe.x - p.x, foe.y - p.y) < radius + foe.r) {
    landHit(world, owner, foe, damage, { kind, x: foe.x, y: foe.y });
    knockback(p, foe, 140);
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
    stats: (b, world) => [['毒', fmt(world ? world.balls[1 - b.id].poison : 0)]],
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
      b.w = { range: 140, dps: 5.5, tick: 0, phase: 0, cur: 0 };
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
          landHit(world, me, foe, 1.3, { kind: 'orbital', x, y });
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
    en: 'Splodey',
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
      b.w = { dmg: 6, out: false, timer: 0.5 };
    },
    stats: (b) => [['ダメージ', fmt(b.w.dmg)]],
    update(world, me, foe, dt) {
      if (!me.w.out) me.angle = aimAt(me, foe);
      if (me.w.out) return;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.out = true;
      shoot(world, me, me.angle, 520, {
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
      me.w.dmg += 1.5;
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
      b.w = { thorns: 1.5 };
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
          landHit(world, owner, foe, 2, { kind: 'tornado', x: foe.x, y: foe.y });
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
          if (landHit(world, owner, foe, 1.2, { kind: 'bat', x: p.x, y: p.y }) > 0) heal(world, owner, 0.6);
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
      spin: 2.0,
      state: { dmg: 4 },
      blade: { rIn: 22, rOut: 110, w: 16, knock: 340, cd: 0.4 },
      damage: (w, me) => me.w.dmg,
    }),
    name: '大剣',
    en: 'Greatsword',
    color: '#6d7fa3',
    grow: '当たるたびに ダメージ +1.5(重くてゆっくり回る)',
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
