// 武器の定義。攻撃が当たるたびに onHit で能力値が成長する。
// stats() が返す値が画面下に表示される(動画の「Damage: 6」のような部分)。

import {
  ARENA,
  BALL_R,
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
  bladeSegment,
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

// 相手の方へ少しずつ向きを変える(rate: 1秒あたりどれだけ追いつくか)
function turnTo(me, want, dt, rate) {
  me.angle += ((((want - me.angle + Math.PI) % TAU) + TAU) % TAU - Math.PI) * Math.min(1, dt * rate);
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
function strike(world, me, x, y, delay, chain, big = true, mul = 1) {
  spawnProjectile(world, me, {
    x,
    y,
    kind: 'zap',
    r: big ? 46 : 38,
    life: delay,
    wall: 'stop',
    blockable: false,
    onExpire(world, p, owner) {
      world.events.push({ type: 'zap', x: p.x, y: p.y, big });
      // 落ちた所にいる相手全員に当たる(3人以上の試合で、ねらった相手以外にも)
      for (const foe of world.balls) {
        if (foe === owner || foe.dead || Math.hypot(foe.x - p.x, foe.y - p.y) >= p.r + foe.r) continue;
        landHit(world, owner, foe, (big ? 4 : 2) * mul, { kind: 'zap', x: foe.x, y: foe.y });
        foe.stun = Math.max(foe.stun, 0.08);
        knockback(p, foe, 150);
        if (chain > 0) strike(world, owner, foe.x + foe.vx * 0.15, foe.y + foe.vy * 0.15, 0.16, chain - 1, false, mul);
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

// 爆竹の束が弾けた: n 本がまわりに飛び散り、少しずつ時間をずらしてパパパッと爆発する
function crackerBurst(world, p, me, n) {
  const x = Math.max(12, Math.min(ARENA - 12, p.x));
  const y = Math.max(12, Math.min(ARENA - 12, p.y));
  for (let i = 0; i < n; i++) {
    const a = world.rng() * TAU;
    const sp = 50 + world.rng() * 110;
    spawnProjectile(world, me, {
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 120,
      kind: 'cracker',
      r: 6,
      life: 0.12 + i * 0.06,
      wall: 'bounce',
      blockable: false,
      // 飛び散りながら、近くの相手の方へ寄っていく
      update: (world, q, owner, foe, dt) => homing(q, foe, 5, dt, 160),
      onExpire: (world, q, owner, foe) => explode(world, q, owner, foe, 44, 3, 'bomb'),
    });
  }
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

// 大器晩成の武器: 当てた回数(xp)が needs に届くたびに次の姿(names)へ進化する。進化すると 'evolve' の演出
function evolveStep(world, me, needs, names) {
  const w = me.w;
  w.xp++;
  if (w.stage >= needs.length || w.xp < needs[w.stage]) return false;
  w.stage++;
  world.events.push({ type: 'evolve', target: me.id, x: me.x, y: me.y, text: names[w.stage] });
  return true;
}
// 3人以上の試合では当てる相手が多くて早く育ちすぎるので、進化に必要な回数を増やす
const needsFor = (world, needs, k) => (world.balls.length > 2 ? needs.map((n) => Math.round(n * k)) : needs);
const EGG_NAMES = ['たまご', 'ひよこ', 'ニワトリ', 'ドラゴン'];
const eggDamage = (b) => b.w.dmg + [0, 0.9, 2.2, 3.8][b.w.stage];
const FORGE_NAMES = ['木の棒', '銅の剣', '鉄の剣', '鋼の剣', '伝説の剣'];
const FORGE_LEN = [70, 74, 80, 88, 98];
const forgeDamage = (b) => [1, 3, 6, 11, 18][b.w.stage] + b.w.bonus;
const PEBBLE_NAMES = ['小石', '石', '岩', '大岩'];
const APPRENTICE_SPELLS = ['火花', 'ファイア', 'アイス', 'サンダー', 'メテオ'];
const MOON_NAMES = ['三日月', '半月', '十三夜', '満月'];
const EMBER_NAMES = ['火種', 'たき火', '大火', '業火'];
const SEED_NAMES = ['種', '芽', 'つぼみ', '花', '大樹'];
const SEED_LEN = [56, 62, 70, 78, 92];
const seedDamage = (b) => [0.8, 2.5, 5, 8, 13][b.w.stage] + b.w.bonus;
const MONK_SKILLS = [[1, '正拳突き'], [3, '回し蹴り'], [5, '気功波'], [7, '百裂拳']];
const monkDamage = (b) => 1 + b.w.lv * 0.6;

// 月の刃: n 枚の刃を並べて弧(三日月)にする。12枚でぐるっと一周(満月)
function moonBlades(b) {
  const n = b.w.n;
  b.blades = [];
  for (let i = 0; i < n; i++) {
    b.blades.push(makeBlade({ sprite: 'crescent', off: (i - (n - 1) / 2) * (TAU / 12), rIn: b.r + 2, rOut: b.r + 30, w: 14, damage: moonHit, cd: 0.35, knock: 130, parry: i === 0 }));
  }
}
// 何枚の刃が同時にふれても1回だけ当たる(全部の刃を同じ待ち時間にする)
function moonHit(world, me) {
  for (const bl of me.blades) bl.cdLeft = bl.cd;
  return me.w.dmg;
}

export const WEAPONS = [
  {
    ...melee('sword', {
      spin: 4,
      state: { dmg: 2 },
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
      damage: 8,
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
    grow: '当たるたびに 会心率 +6%(会心は3倍。100%を超えると威力が上がる)',
    stats: (b) => [['会心率', fmt(shown(b, 'crit')) + '%']],
    onHit(world, me) {
      growStat(me, 'crit', 6, 100);
    },
  },
  {
    ...melee('scythe', {
      spin: 3.6,
      state: {},
      blade: { rIn: 22, rOut: 94, w: 10 },
      damage: 2,
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
      damage: 7.5,
    }),
    name: '王笏',
    en: 'Scepter',
    color: '#e86bc4',
    grow: '当たるたびに 回復量 +1(当てると回復)',
    stats: (b) => [['吸収/回復', fmt(b.w.heal)]],
    onHit(world, me) {
      // 3人以上の試合では何人にも当てて回復しすぎるので半分
      heal(world, me, me.w.heal * (world.balls.length > 2 ? 0.5 : 1));
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
    grow: '当たるたびに 突撃ダメージ +0.7(速いほど痛い・進む向きに構える)',
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
      me.w.joust += 0.7;
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
      me.w.timer = 1.0;
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
      growStat(me, 'spd', 0.12, 3);
      me.speedMul = me.w.spd;
    },
  },
  {
    id: 'spike',
    kind: 'body',
    name: 'トゲトゲ',
    en: 'Spikes',
    color: '#5c6b2e',
    grow: 'ぶつかるたびに トゲダメージ +0.3(近接攻撃を受けると反撃)',
    init(b) {
      b.w = { thorns: 2.6 };
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
      me.w.thorns += 0.3;
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
      growStat(me, 'n', 1, 8, 1.2);
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
        life: 4.5,
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
          landHit(world, owner, foe, 0.55, { kind: 'bee', x: p.x, y: p.y });
          // 刺したら少し離れる
          p.vx = -p.vx;
          p.vy = -p.vy;
        },
      });
    },
    onHit(world, me) {
      growStat(me, 'n', 1, 10, 0.5);
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
    grow: '2回当たるたびに 落ちる雷 +1・連鎖 +0.25(当たった雷は相手を追ってもう一度落ちる)',
    init(b) {
      b.w = { n: 1, chain: 0.5, timer: 0.6 };
    },
    stats: (b) => [
      ['雷', fmt(Math.floor(shown(b, 'n')))],
      ['連鎖', fmt(Math.floor(shown(b, 'chain')))],
    ],
    update(world, me, foe, dt) {
      me.angle = -Math.PI / 2;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2.0;
      for (let i = 0; i < Math.floor(me.w.n); i++) {
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
      growStat(me, 'n', 0.5, 12, 0.5);
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
      growStat(me, 'sparks', 1, 20, 1.1);
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
      growStat(me, 'n', 0.34, 6, 0.4);
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
      growStat(me, 'n', 0.4, 8, 0.4);
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
      me.w.timer = 1.4;
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
      growStat(me, 'n', 1, 10, 0.4);
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
      me.w.slamMul += 0.06;
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
            landHit(world, owner, foe, 3.2, { kind: 'javelin', x: p.x, y: p.y });
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
      me.w.timer = 2.1;
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
      for (const s of [-0.2, 0, 0.2]) shoot(world, me, me.angle + s, 520, { kind: 'bullet', r: 3.5, life: 1.3, damage: 3.2, onTouch: hitOnce() });
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
      growStat(me, 'k', 1, 20, 0.7);
    },
  },
  {
    id: 'wrecking',
    kind: 'ranged',
    name: '鉄球',
    en: 'Wrecking Ball',
    color: '#4a4a52',
    grow: '天井からつるした大きな鉄球が振り子で揺れる。当たるたびに ダメージ +0.8',
    init(b) {
      b.w = { dmg: 3, theta: 0.88, omega: 0, len: 380, cd: 0, hx: 300, hy: 380 };
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
      if (info.kind === 'wreck') me.w.dmg += 0.8;
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
          damage: 1.2,
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
      me.w.rain += 0.26;
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
      growStat(me, 'n', 1, 20, 0.6);
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
      growStat(me, 'n', 0.34, 5, 0.5);
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
    grow: '2回当たるたびに 爆竹 +1(束を投げると、当たった所で飛び散ってパパパッと連続で爆発)',
    init(b) {
      b.w = { n: 4, timer: 1 };
    },
    stats: (b) => [['爆竹', fmt(Math.floor(shown(b, 'n')))]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.8;
      // 爆竹の束を、相手が動く先をねらって投げる
      const n = Math.floor(me.w.n);
      const burst = (world, p) => crackerBurst(world, p, me, n);
      const lead = Math.hypot(foe.x - me.x, foe.y - me.y) / 600;
      const a = Math.atan2(foe.y + foe.vy * lead - me.y, foe.x + foe.vx * lead - me.x);
      shoot(world, me, a, 600, {
        kind: 'bundle',
        r: 10,
        life: 2,
        wall: 'die',
        // 少しだけ相手を追いかける(まっすぐ投げると跳ね回る相手にほとんど当たらない)
        update: (world, p, owner, foe, dt) => homing(p, foe, 2.2, dt, 560),
        onTouch(world, p, owner, o) {
          p.dead = true;
          landHit(world, owner, o, 1.5, { kind: 'bundle', x: p.x, y: p.y });
          burst(world, p);
        },
        onBlocked: burst,
        onExpire: burst,
      });
    },
    onHit(world, me) {
      growStat(me, 'n', 0.5, 12, 0.4);
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
      growStat(me, 'n', 2, 20, 0.6);
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
      growStat(me, 'n', 0.34, 6, 0.4);
    },
  },
  // ---- 117種への追加分: 弾をばらまかず、1発の重さや動きそのもので戦う武器 ----
  {
    id: 'cannon',
    kind: 'ranged',
    name: '大砲',
    en: 'Cannon',
    color: '#4a4f57',
    grow: '当たるたびに 砲弾のダメージ +1・大きさアップ(重い1発で吹き飛ばして壁ドン)',
    init(b) {
      b.w = { dmg: 6, size: 14, timer: 1 };
    },
    stats: (b) => [
      ['ダメージ', fmt(b.w.dmg)],
      ['大きさ', fmt(Math.round(shown(b, 'size')))],
    ],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2.6;
      world.events.push({ type: 'shock', x: me.x + Math.cos(me.angle) * (me.r + 20), y: me.y + Math.sin(me.angle) * (me.r + 20), r: 40, color: '#9aa3ad' });
      shoot(world, me, me.angle, 520, {
        kind: 'cannonball',
        r: me.w.size,
        life: 3.5,
        wall: 'bounce',
        bounces: 2,
        blockable: false,
        damage: me.w.dmg,
        onTouch(world, p, owner, o) {
          p.dead = true;
          world.events.push({ type: 'boom', x: p.x, y: p.y, radius: p.r + 20, kind: 'bomb' });
          if (landHit(world, owner, o, p.damage, { kind: 'cannon', x: p.x, y: p.y }) > 0) {
            knockback(p, o, 460);
            o.slamT = 0.7;
            o.slamBy = owner.id;
          }
        },
      });
    },
    onHit(world, me, foe, info) {
      if (info.kind !== 'cannon') return;
      me.w.dmg += 1;
      growStat(me, 'size', 1, 30, 0.4);
    },
  },
  {
    id: 'charger',
    kind: 'body',
    name: '突進',
    en: 'Charger',
    color: '#b5562a',
    grow: '突進が当たるたびに ダメージ +0.5・突進の速さアップ',
    init(b) {
      b.w = { dmg: 4, timer: 1.2, dash: 0, speed: 950, hit: false };
      setSpin(b, 0);
    },
    stats: (b) => [
      ['ダメージ', fmt(Math.round(b.w.dmg * 10) / 10)],
      ['速さ', fmt(Math.round(shown(b, 'speed')))],
    ],
    update(world, me, foe, dt) {
      const w = me.w;
      if (w.dash > 0) {
        w.dash -= dt;
        me.angle = Math.atan2(me.vy, me.vx);
        if (!w.hit && Math.hypot(foe.x - me.x, foe.y - me.y) < me.r + foe.r + 6) {
          w.hit = true;
          w.dash = 0;
          if (landHit(world, me, foe, w.dmg, { kind: 'charge', x: foe.x, y: foe.y }) > 0) {
            knockback(me, foe, 520);
            foe.slamT = 0.6;
            foe.slamBy = me.id;
          }
        }
        return;
      }
      me.angle = aimAt(me, foe);
      w.timer -= dt;
      if (w.timer > 0) return;
      // 相手めがけて一直線に突っこむ
      w.timer = 1.7;
      w.dash = 0.5;
      w.hit = false;
      me.vx = Math.cos(me.angle) * w.speed;
      me.vy = Math.sin(me.angle) * w.speed;
      world.events.push({ type: 'shock', x: me.x, y: me.y, r: 60, color: '#ffb07a' });
    },
    onHit(world, me, foe, info) {
      if (info.kind !== 'charge') return;
      me.w.dmg += 0.5;
      growStat(me, 'speed', 50, 1500, 0.5);
    },
  },
  {
    id: 'lasso',
    kind: 'ranged',
    name: '投げ縄',
    en: 'Lasso',
    color: '#c2924f',
    grow: '捕まえるたびに 投げる勢いアップ(捕まえた相手を振り回して壁にたたきつける)',
    init(b) {
      b.w = { throw: 1050, timer: 1, hold: 0, spin: 0, caught: null };
    },
    stats: (b) => [['投げる勢い', fmt(Math.round(shown(b, 'throw')))]],
    update(world, me, foe, dt) {
      const w = me.w;
      if (w.caught) {
        const o = w.caught;
        if (o.dead) {
          w.caught = null;
          return;
        }
        // 捕まえた相手を自分のまわりで振り回す
        w.hold -= dt;
        w.spin += dt * 11;
        o.x = Math.max(o.r, Math.min(ARENA - o.r, me.x + Math.cos(w.spin) * 120));
        o.y = Math.max(o.r, Math.min(ARENA - o.r, me.y + Math.sin(w.spin) * 120));
        o.vx = o.vy = 0;
        o.stun = Math.max(o.stun, 0.05);
        me.angle = w.spin;
        if (w.hold <= 0) {
          // 回っている向きに放り投げる → 壁に当たると壁ドン
          const sp = Math.min(w.throw, 1700);
          o.vx = -Math.sin(w.spin) * sp;
          o.vy = Math.cos(w.spin) * sp;
          o.slamT = 1.2;
          o.slamBy = me.id;
          w.caught = null;
          w.timer = 1.8;
        }
        return;
      }
      me.angle = aimAt(me, foe);
      w.timer -= dt;
      if (w.timer > 0) return;
      w.timer = 1.8;
      shoot(world, me, me.angle, 600, {
        kind: 'loop',
        r: 16,
        life: 1.1,
        update: (world, p, owner, foe, dt) => homing(p, foe, 2, dt, 600),
        onTouch(world, p, owner, o) {
          p.dead = true;
          if (owner.w.caught || landHit(world, owner, o, 1, { kind: 'lasso', x: p.x, y: p.y }) <= 0) return;
          owner.w.caught = o;
          owner.w.hold = 0.55;
          owner.w.spin = Math.atan2(o.y - owner.y, o.x - owner.x);
        },
      });
    },
    onHit(world, me, foe, info) {
      if (info.kind === 'lasso') growStat(me, 'throw', 70, 1700, 0.6);
    },
  },
  {
    id: 'timebomb',
    kind: 'ranged',
    name: '時限爆弾',
    en: 'Time Bomb',
    color: '#d63b3b',
    grow: '爆発が当たるたびに 爆発のダメージ +1.5(相手にくっつけて3秒後にドカン)',
    init(b) {
      b.w = { dmg: 10, timer: 0.8, active: false };
    },
    stats: (b) => [['爆発', fmt(b.w.dmg)]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      if (me.w.active) return;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1;
      me.w.active = true;
      const done = (world, p, owner) => (owner.w.active = false);
      shoot(world, me, me.angle, 640, {
        kind: 'timebomb',
        r: 9,
        life: 1.4,
        on: null,
        fuse: 0,
        update(world, p, owner, foe, dt) {
          if (!p.on) return homing(p, foe, 2.5, dt, 640);
          p.x = p.on.x + p.ox;
          p.y = p.on.y + p.oy;
          p.vx = p.vy = 0;
          p.fuse = Math.max(0, p.life - p.age);
        },
        onTouch(world, p, owner, o) {
          if (p.on) return;
          p.on = o;
          p.blockable = false;
          p.wall = 'stop';
          const a = Math.atan2(p.y - o.y, p.x - o.x);
          p.ox = Math.cos(a) * o.r;
          p.oy = Math.sin(a) * o.r;
          p.life = p.age + 3;
        },
        onExpire(world, p, owner, foe) {
          done(world, p, owner);
          if (p.on) explode(world, p, owner, foe, 80, owner.w.dmg, 'timebomb');
        },
        onBlocked: done,
      });
    },
    onHit(world, me, foe, info) {
      if (info.kind === 'timebomb') me.w.dmg += 1.5;
    },
  },
  {
    id: 'spring',
    kind: 'body',
    name: 'ばね',
    en: 'Spring',
    color: '#7cc242',
    grow: '踏みつけが当たるたびに ダメージ +1(相手の上から急降下して踏みつける)',
    init(b) {
      b.w = { dmg: 8, cd: 0, diving: false };
      setSpin(b, 0);
    },
    stats: (b) => [['踏みつけ', fmt(b.w.dmg)]],
    update(world, me, foe, dt) {
      const w = me.w;
      me.angle = Math.PI / 2;
      if (w.cd > 0) w.cd -= dt;
      if (w.diving) {
        if (Math.hypot(foe.x - me.x, foe.y - me.y) < me.r + foe.r + 6 && me.y < foe.y) {
          w.diving = false;
          w.cd = 0.5;
          if (landHit(world, me, foe, w.dmg, { kind: 'stomp', x: foe.x, y: foe.y - foe.r }) > 0) {
            foe.stun = Math.max(foe.stun, 0.3);
            foe.vy = Math.abs(foe.vy) + 400;
            world.events.push({ type: 'shock', x: foe.x, y: foe.y - foe.r, r: 80, color: '#7cc242' });
          }
          me.vy = -1000; // ばねで高く跳ね上がる
        } else if (me.y >= ARENA - me.r - 2 || me.vy < 0) {
          w.diving = false;
        }
        return;
      }
      // 相手の真上あたりにいたら急降下
      if (w.cd <= 0 && me.y < foe.y - 40 && Math.abs(foe.x - me.x) < 220) {
        w.diving = true;
        me.vy = 1150;
        me.vx = (foe.x - me.x) * 2;
      }
      // 床で跳ねるときに、ばねで少し高く跳ぶ
      if (me.y >= ARENA - me.r - 2 && me.vy < 0) me.vy -= 90;
    },
    onHit(world, me, foe, info) {
      if (info.kind === 'stomp') me.w.dmg += 1;
    },
  },
  {
    id: 'shadow',
    kind: 'body',
    name: '影',
    en: 'Shadow',
    color: '#3b2a5c',
    grow: '不意打ちが当たるたびに ダメージ +0.6(ときどき相手の背後にワープして切りつける)',
    init(b) {
      b.w = { dmg: 3.5, timer: 1.5 };
      setSpin(b, 0);
    },
    stats: (b) => [['不意打ち', fmt(Math.round(b.w.dmg * 10) / 10)]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2.6;
      // 相手が進んでいる向きの反対側(背後)にワープ
      const sp = Math.hypot(foe.vx, foe.vy) || 1;
      const d = foe.r + me.r + 8;
      world.events.push({ type: 'shock', x: me.x, y: me.y, r: 50, color: '#3b2a5c' });
      me.x = Math.max(me.r, Math.min(ARENA - me.r, foe.x - (foe.vx / sp) * d));
      me.y = Math.max(me.r, Math.min(ARENA - me.r, foe.y - (foe.vy / sp) * d));
      me.vx = foe.vx * 0.5;
      me.vy = foe.vy * 0.5;
      world.events.push({ type: 'shock', x: me.x, y: me.y, r: 60, color: '#8a6fd1' });
      if (landHit(world, me, foe, me.w.dmg, { kind: 'shadow', x: foe.x, y: foe.y }) > 0) {
        foe.stun = Math.max(foe.stun, 0.2);
        knockback(me, foe, 200);
      }
    },
    onHit(world, me, foe, info) {
      if (info.kind === 'shadow') me.w.dmg += 0.6;
    },
  },
  {
    id: 'swap',
    kind: 'ranged',
    name: '入れかえ',
    en: 'Swap',
    color: '#e07ad1',
    grow: '爆発が当たるたびに ダメージ +1(自分の場所に爆弾を置いて、相手と場所を入れかえる)',
    init(b) {
      b.w = { dmg: 6, timer: 1.5 };
    },
    stats: (b) => [['爆発', fmt(b.w.dmg)]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 3.2;
      // 今いる場所に爆弾 → 相手と場所(と勢い)を入れかえる → 相手が爆弾の上に
      spawnProjectile(world, me, {
        x: me.x,
        y: me.y,
        kind: 'swapbomb',
        r: 10,
        life: 0.35,
        wall: 'stop',
        blockable: false,
        onExpire: (world, p, owner, foe) => explode(world, p, owner, foe, 70, owner.w.dmg, 'swap'),
      });
      for (const [x, y] of [[me.x, me.y], [foe.x, foe.y]]) world.events.push({ type: 'shock', x, y, r: 55, color: '#e07ad1' });
      [me.x, foe.x] = [foe.x, me.x];
      [me.y, foe.y] = [foe.y, me.y];
      [me.vx, foe.vx] = [foe.vx, 0];
      [me.vy, foe.vy] = [foe.vy, 0];
      // 入れかわった相手は一瞬止まる(爆弾の上から逃げにくい)
      foe.stun = Math.max(foe.stun, 0.3);
      foe.freeze = Math.max(foe.freeze, 0.2);
    },
    onHit(world, me, foe, info) {
      if (info.kind === 'swap') me.w.dmg += 1;
    },
  },
  {
    id: 'tesla',
    kind: 'ranged',
    name: '電撃柵',
    en: 'Tesla Fence',
    color: '#3fb6e0',
    grow: '感電させるたびに 電撃のダメージ +0.2(自分の通り道に柱を立て、柱どうしの間に電気が走る)',
    init(b) {
      b.w = { dmg: 1.2, timer: 0.5, posts: [], tick: 0 };
    },
    stats: (b) => [['電撃', fmt(Math.round(b.w.dmg * 10) / 10)]],
    update(world, me, foe, dt) {
      const w = me.w;
      me.angle = -Math.PI / 2;
      w.posts = w.posts.filter((p) => !p.dead);
      w.timer -= dt;
      if (w.timer <= 0) {
        w.timer = 1.4;
        spawnProjectile(world, me, { x: me.x, y: me.y, kind: 'post', r: 7, life: 4.5, wall: 'stop', blockable: false });
        w.posts = [...w.posts, world.projectiles[world.projectiles.length - 1]].slice(-3);
      }
      w.tick -= dt;
      if (w.tick > 0) return;
      w.tick = 0.35;
      // 柱と柱の間の線にふれた相手に電撃
      for (let i = 0; i + 1 < w.posts.length; i++) {
        const a = w.posts[i];
        const b = w.posts[i + 1];
        for (const o of world.balls) {
          if (o === me || o.dead) continue;
          if (segPointDist(a.x, a.y, b.x, b.y, o.x, o.y) < o.r + 5) {
            landHit(world, me, o, w.dmg, { kind: 'tesla', x: o.x, y: o.y });
            o.stun = Math.max(o.stun, 0.06);
          }
        }
      }
    },
    onHit(world, me, foe, info) {
      if (info.kind === 'tesla') me.w.dmg += 0.2;
    },
  },
  {
    id: 'sniperRifle',
    kind: 'ranged',
    name: '狙撃銃',
    en: 'Sniper Rifle',
    color: '#556b2f',
    grow: '当たるたびに ダメージ +2(赤い線でねらいを定めてから、刃でも防げないとても速い1発)',
    init(b) {
      b.w = { dmg: 14, timer: 1.5, aiming: false };
      setSpin(b, 0);
    },
    stats: (b) => [['ダメージ', fmt(b.w.dmg)]],
    update(world, me, foe, dt) {
      const w = me.w;
      w.timer -= dt;
      // ねらっている間はゆっくり相手を追う(撃つ直前は止まる)
      // 弾が届くころに相手がいる場所(進む先)をねらう
      const lead = Math.hypot(foe.x - me.x, foe.y - me.y) / 1900;
      const want = Math.atan2(foe.y + foe.vy * lead - me.y, foe.x + foe.vx * lead - me.x);
      if (w.timer > 0.15) me.angle += ((((want - me.angle + Math.PI) % TAU) + TAU) % TAU - Math.PI) * Math.min(1, dt * 10);
      w.aiming = w.timer < 1;
      if (w.timer > 0) return;
      w.timer = 2.3;
      w.aiming = false;
      shoot(world, me, me.angle, 1900, { kind: 'rifle', r: 6, life: 0.8, damage: w.dmg, blockable: false, onTouch: hitOnce() });
      world.events.push({ type: 'shock', x: me.x + Math.cos(me.angle) * (me.r + 14), y: me.y + Math.sin(me.angle) * (me.r + 14), r: 30, color: '#ffd23f' });
    },
    onHit(world, me, foe, info) {
      if (info.kind === 'rifle') me.w.dmg += 2;
    },
  },
  {
    id: 'anvil',
    kind: 'ranged',
    name: '金床',
    en: 'Anvil',
    color: '#5b6470',
    grow: '当たるたびに ダメージ +1.2(相手の頭上に影が出て、重い金床が落ちてくる)',
    init(b) {
      b.w = { dmg: 9, timer: 1 };
    },
    stats: (b) => [['ダメージ', fmt(Math.round(b.w.dmg * 10) / 10)]],
    update(world, me, foe, dt) {
      me.angle = -Math.PI / 2;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2;
      // 金床の半径(28)より内側にする(壁の外にはみ出すと出た瞬間に消える)
      const x = Math.max(32, Math.min(ARENA - 32, foe.x + foe.vx * 0.8));
      // まず床に影(予告)、少しして天井から落ちる
      spawnProjectile(world, me, {
        x,
        y: ARENA - 6,
        kind: 'anvilShadow',
        r: 26,
        life: 0.55,
        wall: 'stop',
        blockable: false,
        onExpire(world, p, owner) {
          spawnProjectile(world, owner, {
            x: p.x,
            y: 32, // 半径より下から出す(上の壁の外だと出た瞬間に消える)
            vy: 700,
            kind: 'anvil',
            r: 28,
            life: 2,
            gravity: 1.6,
            wall: 'die',
            blockable: false,
            onTouch(world, q, owner, o) {
              q.dead = true;
              world.events.push({ type: 'boom', x: q.x, y: q.y, radius: 50, kind: 'bomb' });
              if (landHit(world, owner, o, owner.w.dmg, { kind: 'anvil', x: q.x, y: q.y }) > 0) o.stun = Math.max(o.stun, 0.4);
            },
            onExpire: (world, q) => world.events.push({ type: 'quake', x: q.x, y: ARENA - 4 }),
          });
        },
      });
    },
    onHit(world, me, foe, info) {
      if (info.kind === 'anvil') me.w.dmg += 1.2;
    },
  },
  {
    id: 'rocketFist',
    kind: 'ranged',
    name: 'ロケットパンチ',
    en: 'Rocket Fist',
    color: '#d94a3a',
    grow: '当たるたびに ダメージ +0.6・吹き飛ばしアップ(こぶしを飛ばして、戻ってくる)',
    init(b) {
      b.w = { dmg: 4, knock: 380, timer: 0.9, out: false };
    },
    stats: (b) => [['ダメージ', fmt(b.w.dmg)]],
    update(world, me, foe, dt) {
      if (!me.w.out) me.angle = aimAt(me, foe);
      if (me.w.out) return;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.out = true;
      const back = (world, p, owner) => {
        owner.w.out = false;
        owner.w.timer = 0.9;
      };
      shoot(world, me, me.angle, 760, {
        kind: 'fist',
        r: 13,
        life: 2.5,
        wall: 'bounce',
        blockable: false,
        hitDone: false,
        update(world, p, owner, foe, dt) {
          if (p.age < 0.45) return;
          // 持ち主へ戻る
          const dx = owner.x - p.x;
          const dy = owner.y - p.y;
          const d = Math.hypot(dx, dy) || 1;
          p.vx = (dx / d) * 700;
          p.vy = (dy / d) * 700;
          p.angle = Math.atan2(-dy, -dx);
          if (d < owner.r + p.r) {
            p.dead = true;
            back(world, p, owner);
          }
        },
        onExpire: back,
        onTouch(world, p, owner, o) {
          if (p.hitDone) return;
          p.hitDone = true;
          world.events.push({ type: 'boom', x: p.x, y: p.y, radius: 34, kind: 'bomb' });
          if (landHit(world, owner, o, owner.w.dmg, { kind: 'fist', x: p.x, y: p.y }) > 0) {
            knockback(p, o, owner.w.knock);
            o.slamT = 0.6;
            o.slamBy = owner.id;
          }
        },
      });
    },
    onHit(world, me, foe, info) {
      if (info.kind !== 'fist') return;
      me.w.dmg += 0.6;
      me.w.knock += 20;
    },
  },
  {
    id: 'drum',
    kind: 'body',
    name: '太鼓',
    en: 'Drum',
    color: '#c0392b',
    grow: '当たるたびに テンポアップ(ドン・ドン・ドン・ドドン！ 4拍目は大きな衝撃波)',
    init(b) {
      b.w = { bpm: 70, beat: 0, timer: 0.8 };
      setSpin(b, 0);
    },
    stats: (b) => [['テンポ', fmt(Math.round(shown(b, 'bpm')))]],
    update(world, me, foe, dt) {
      me.angle = -Math.PI / 2;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 60 / me.w.bpm;
      me.w.beat = (me.w.beat + 1) % 4;
      const big = me.w.beat === 0;
      const r = big ? 230 : 140;
      world.events.push({ type: 'shock', x: me.x, y: me.y, r, color: big ? '#ff7a1a' : '#f2c230' });
      for (const o of world.balls) {
        if (o === me || o.dead || Math.hypot(o.x - me.x, o.y - me.y) > r + o.r) continue;
        if (landHit(world, me, o, big ? 5 : 1.5, { kind: 'drum', x: o.x, y: o.y }) > 0 && big) knockback(me, o, 420);
      }
    },
    onHit(world, me) {
      growStat(me, 'bpm', 4, 200, 0.5);
    },
  },
  {
    ...melee('rewind', {
      spin: 3.8,
      state: { dmg: 2.6, back: 0.5, t: 0, timer: 5 },
      blade: { rIn: 22, rOut: 86, w: 8 },
      damage: (w, me) => me.w.dmg,
      extra: {
        update(world, me, foe, dt) {
          const w = me.w;
          // 0.25秒ごとにHPを覚えておき、5秒ごとに「3秒前」まで巻き戻す
          // (state は浅いコピーなので、配列はここで1人ずつ作る)
          w.hist ||= [];
          w.t += dt;
          if (w.t >= 0.25) {
            w.t = 0;
            w.hist.push(me.hp);
            if (w.hist.length > 12) w.hist.shift();
          }
          w.timer -= dt;
          if (w.timer > 0) return;
          w.timer = 5;
          const past = w.hist[0] ?? me.hp;
          if (past > me.hp) {
            // 3人以上の試合では、何人分ものダメージを巻き戻せて強すぎるので半分
            heal(world, me, (past - me.hp) * w.back * (world.balls.length > 2 ? 0.5 : 1));
            world.events.push({ type: 'timestop', x: me.x, y: me.y, target: me.id });
          }
        },
      },
    }),
    name: '巻き戻し',
    en: 'Rewind',
    color: '#6aa0c8',
    grow: '当たるたびに ダメージ +0.4・巻き戻す量アップ(5秒ごとにHPを3秒前まで戻す)',
    stats: (b) => [
      ['ダメージ', fmt(Math.round(b.w.dmg * 10) / 10)],
      ['巻き戻し', Math.round(Math.min(1, b.w.back) * 100) + '%'],
    ],
    onHit(world, me) {
      me.w.dmg += 0.4;
      me.w.back = Math.min(1, me.w.back + 0.04);
    },
  },
  {
    id: 'bowling',
    kind: 'ranged',
    name: 'ボウリング',
    en: 'Bowling',
    color: '#2e4a7d',
    grow: '当たるたびに ダメージ +0.8・玉が大きくなる(床を転がり、相手の下で跳ね上がって打ち上げる)',
    init(b) {
      b.w = { dmg: 5, size: 15, timer: 1 };
    },
    stats: (b) => [
      ['ダメージ', fmt(Math.round(b.w.dmg * 10) / 10)],
      ['大きさ', fmt(Math.round(shown(b, 'size')))],
    ],
    update(world, me, foe, dt) {
      me.angle = Math.PI / 2;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2.3;
      const dir = Math.sign(foe.x - me.x) || 1;
      const r = me.w.size;
      spawnProjectile(world, me, {
        x: Math.max(r, Math.min(ARENA - r, me.x)),
        y: ARENA - r,
        vx: dir * 640,
        vy: 0,
        kind: 'bowl',
        r,
        life: 3,
        wall: 'bounce',
        bounces: 2,
        blockable: false,
        hitDone: false,
        leapt: false,
        update(world, p, owner, foe, dt) {
          p.angle += (p.vx / p.r) * dt;
          // 相手の真下まで転がったら、跳ね上がって打ち上げる
          if (!p.leapt && Math.abs(foe.x - p.x) < 90 && foe.y < p.y - 50) {
            p.leapt = true;
            p.vy = -1000;
            p.gravity = 1;
          }
          if (p.leapt && p.vy > 0 && p.y >= ARENA - p.r - 1) p.leapt = false; // 着地したらまた跳べる
          if (!p.leapt) {
            p.y = ARENA - p.r;
            p.vy = 0;
            p.gravity = 0;
          }
        },
        onTouch(world, p, owner, o) {
          if (p.hitDone) return;
          p.hitDone = true;
          if (landHit(world, owner, o, owner.w.dmg, { kind: 'bowl', x: p.x, y: p.y }) > 0) {
            o.vy = -820 * (o.knockMul ?? 1);
            o.vx += Math.sign(p.vx) * 220;
            o.stun = Math.max(o.stun, 0.15);
          }
        },
      });
    },
    onHit(world, me, foe, info) {
      if (info.kind !== 'bowl') return;
      me.w.dmg += 0.8;
      growStat(me, 'size', 1.2, 32, 0.4);
    },
  },
  {
    ...melee('chainsaw', {
      spin: 0,
      state: { dmg: 0.6 },
      blade: { rIn: 22, rOut: 96, w: 16, knock: 0, cd: 0.1 },
      damage: (w, me) => me.w.dmg,
      extra: {
        // 回さずに、いつも刃を相手に向ける(近づいている間ずっと削る)
        update(world, me, foe, dt) {
          const want = aimAt(me, foe);
          me.angle += ((((want - me.angle + Math.PI) % TAU) + TAU) % TAU - Math.PI) * Math.min(1, dt * 5);
        },
      },
    }),
    name: 'チェーンソー',
    en: 'Chainsaw',
    color: '#e0a21b',
    grow: '当たるたびに 1回のダメージ +0.03(刃をいつも相手に向け、ふれている間ずっと削って遅くする)',
    stats: (b) => [['削り', fmt(Math.round(b.w.dmg * 100) / 100)]],
    onHit(world, me, foe, info) {
      me.w.dmg += 0.03;
      if (info.kind === 'melee') {
        foe.slow = Math.max(foe.slow, 0.3);
        foe.slowT = 0.25;
      }
    },
  },
  // ---- 127種への追加分: 体ひとつで戦う格闘家たち(弾を出さない) ----
  {
    id: 'kungfu',
    kind: 'body',
    name: '拳法',
    en: 'Kung Fu',
    color: '#d4472f',
    grow: '当たるたびに 突きのダメージ +0.3(相手に近づくと左右の拳で連続で突く)',
    init(b) {
      b.w = { dmg: 2, timer: 0.4, jab: 0, side: 1 };
      setSpin(b, 0);
      b.blades = [makeBlade({ sprite: 'fist', rIn: b.r - 6, rOut: b.r, w: 18, damage: (w, me) => me.w.dmg, cd: 0.15, knock: 160, parry: false })];
    },
    stats: (b) => [['突き', fmt(Math.round(b.w.dmg * 10) / 10)]],
    update(world, me, foe, dt) {
      const w = me.w;
      const bl = me.blades[0];
      turnTo(me, aimAt(me, foe), dt, 10);
      w.timer -= dt;
      if (w.timer <= 0 && w.jab <= 0 && Math.hypot(foe.x - me.x, foe.y - me.y) < me.r + foe.r + 90) {
        w.timer = 0.42;
        w.jab = 0.18;
        w.side = -w.side;
        bl.off = w.side * 0.35; // 左右の拳を交互に
      }
      w.jab = Math.max(0, w.jab - dt);
      bl.rOut = me.r + Math.sin((Math.PI * w.jab) / 0.18) * 62;
      bl.rIn = me.r - 6;
    },
    onHit(world, me) {
      me.w.dmg += 0.3;
    },
  },
  {
    id: 'sumo',
    kind: 'body',
    name: '相撲',
    en: 'Sumo',
    color: '#e8b98a',
    grow: '当たるたびに ぶちかましのダメージ +0.4・体が大きくなる(ぶつかって押し出し、壁にたたきつける)',
    init(b) {
      b.w = { dmg: 2.5, push: 300, size: 1.05, cd: 0 };
      b.r = BALL_R * 1.05;
      b.speedMul = 0.92;
    },
    stats: (b) => [
      ['ぶちかまし', fmt(Math.round(b.w.dmg * 10) / 10)],
      ['大きさ', '×' + fmt(Math.round(shown(b, 'size') * 100) / 100)],
    ],
    onContact(world, me, foe) {
      if (me.w.cd > world.t) return;
      me.w.cd = world.t + 0.8;
      if (landHit(world, me, foe, me.w.dmg, { kind: 'sumo', x: (me.x + foe.x) / 2, y: (me.y + foe.y) / 2 }) <= 0) return;
      knockback(me, foe, me.w.push);
      foe.slamT = 0.5;
      foe.slamBy = me.id;
    },
    update(world, me) {
      me.angle = Math.atan2(me.vy, me.vx);
    },
    onHit(world, me) {
      me.w.dmg += 0.4;
      me.w.push += 10;
      growStat(me, 'size', 0.015, 1.6, 0.3);
      me.r = BALL_R * me.w.size;
    },
  },
  {
    id: 'judo',
    kind: 'body',
    name: '柔道',
    en: 'Judo',
    color: '#f4f4f4',
    grow: '投げるたびに 投げの威力アップ(ぶつかった相手を床にたたきつける)',
    init(b) {
      b.w = { slamMul: 1, power: 640, cd: 0 };
    },
    stats: (b) => [['投げ', '×' + fmt(Math.round(b.w.slamMul * 10) / 10)]],
    onContact(world, me, foe) {
      if (me.w.cd > world.t) return;
      me.w.cd = world.t + 1.5;
      if (landHit(world, me, foe, 1.5, { kind: 'judo', x: foe.x, y: foe.y }) <= 0) return;
      // 背負い投げ: 相手を床へ向けて勢いよく投げる(床に当たると壁ドンのダメージ)
      foe.vy = me.w.power * (foe.knockMul ?? 1);
      foe.vx = Math.sign(foe.x - me.x || 1) * 250;
      foe.slamT = 1;
      foe.slamBy = me.id;
      world.events.push({ type: 'shock', x: foe.x, y: foe.y, r: 60, color: '#ffffff' });
    },
    update(world, me) {
      me.angle = Math.atan2(me.vy, me.vx);
    },
    onHit(world, me, foe, info) {
      if (info.kind === 'slam' || info.kind === 'judo') me.w.slamMul += 0.04;
    },
  },
  {
    id: 'spinKick',
    kind: 'body',
    name: '回し蹴り',
    en: 'Spin Kick',
    color: '#4a90d9',
    grow: '当たるたびに 蹴りのダメージ +0.5(ときどき足をのばしてぐるっと回る)',
    init(b) {
      b.w = { dmg: 3, timer: 0.6, kick: 0 };
      setSpin(b, 0);
      b.blades = [makeBlade({ sprite: 'leg', rIn: b.r - 6, rOut: b.r, w: 16, damage: (w, me) => me.w.dmg, cd: 0.3, knock: 300, parry: false })];
    },
    stats: (b) => [['蹴り', fmt(Math.round(b.w.dmg * 10) / 10)]],
    update(world, me, foe, dt) {
      const w = me.w;
      const bl = me.blades[0];
      w.timer -= dt;
      if (w.timer <= 0 && w.kick <= 0) {
        w.timer = 1.2;
        w.kick = 0.4;
      }
      if (w.kick > 0) {
        // 0.4秒で1回転半
        w.kick -= dt;
        me.angle += dt * 24;
        bl.rOut = me.r + 62;
      } else {
        turnTo(me, aimAt(me, foe), dt, 4);
        bl.rOut = me.r;
      }
      bl.rIn = me.r - 6;
    },
    onHit(world, me) {
      me.w.dmg += 0.5;
    },
  },
  {
    id: 'boxer',
    kind: 'body',
    name: 'ボクサー',
    en: 'Boxer',
    color: '#c0392b',
    grow: '当たるたびに ジャブ +0.2・見切り(よける確率)+0.8%(よけると横にステップ)',
    init(b) {
      b.w = { dmg: 1.6, dodge: 3, timer: 0.4, jab: 0 };
      setSpin(b, 0);
      b.blades = [makeBlade({ sprite: 'glove', rIn: b.r - 6, rOut: b.r, w: 18, damage: (w, me) => me.w.dmg, cd: 0.2, knock: 200, parry: false })];
    },
    stats: (b) => [
      ['ジャブ', fmt(Math.round(b.w.dmg * 10) / 10)],
      ['見切り', Math.round(Math.min(30, shown(b, 'dodge'))) + '%'],
    ],
    update(world, me, foe, dt) {
      const w = me.w;
      const bl = me.blades[0];
      turnTo(me, aimAt(me, foe), dt, 12);
      w.timer -= dt;
      if (w.timer <= 0 && w.jab <= 0 && Math.hypot(foe.x - me.x, foe.y - me.y) < me.r + foe.r + 80) {
        w.timer = 0.55;
        w.jab = 0.14;
      }
      w.jab = Math.max(0, w.jab - dt);
      bl.rOut = me.r + Math.sin((Math.PI * w.jab) / 0.14) * 56;
      bl.rIn = me.r - 6;
    },
    onTakeDamage(world, me, src, amount, opts) {
      if (!src || opts.kind === 'poison' || opts.kind === 'burn' || world.rng() * 100 >= me.w.dodge) return amount;
      // 見切って横にステップ
      const a = Math.atan2(me.y - src.y, me.x - src.x) + Math.PI / 2;
      me.vx += Math.cos(a) * 260;
      me.vy += Math.sin(a) * 260;
      world.events.push({ type: 'dodge', x: me.x, y: me.y, target: me.id });
      return 0;
    },
    onHit(world, me) {
      me.w.dmg += 0.2;
      growStat(me, 'dodge', 0.8, 30, 0.3);
    },
  },
  {
    id: 'palm',
    kind: 'body',
    name: '掌底',
    en: 'Palm Strike',
    color: '#e6a15c',
    grow: '当たるたびに ダメージ +0.6・届く距離アップ(近くの相手を前方の衝撃でふっとばす)',
    init(b) {
      b.w = { dmg: 2.5, reach: 150, timer: 0.8 };
      setSpin(b, 0);
    },
    stats: (b) => [
      ['掌底', fmt(Math.round(b.w.dmg * 10) / 10)],
      ['距離', fmt(Math.round(shown(b, 'reach')))],
    ],
    update(world, me, foe, dt) {
      const w = me.w;
      turnTo(me, aimAt(me, foe), dt, 8);
      w.timer -= dt;
      if (w.timer > 0 || Math.hypot(foe.x - me.x, foe.y - me.y) > w.reach + foe.r) return;
      w.timer = 2;
      const c = Math.cos(me.angle);
      const s = Math.sin(me.angle);
      world.events.push({ type: 'shock', x: me.x + c * (me.r + 30), y: me.y + s * (me.r + 30), r: 70, color: '#ffd9a8' });
      for (const o of world.balls) {
        if (o === me || o.dead) continue;
        const dx = o.x - me.x;
        const dy = o.y - me.y;
        const d = Math.hypot(dx, dy);
        // 前方(だいたい120度の範囲)にいる相手
        if (d > w.reach + o.r || (dx * c + dy * s) / (d || 1) < 0.5) continue;
        if (landHit(world, me, o, w.dmg, { kind: 'palm', x: o.x, y: o.y }) > 0) {
          knockback(me, o, 320);
          o.slamT = 0.5;
          o.slamBy = me.id;
        }
      }
    },
    onHit(world, me, foe, info) {
      if (info.kind !== 'palm') return;
      me.w.dmg += 0.6;
      growStat(me, 'reach', 4, 260, 0.3);
    },
  },
  {
    id: 'lariat',
    kind: 'body',
    name: 'ラリアット',
    en: 'Lariat',
    color: '#8e44ad',
    grow: '当たるたびに 腕のダメージ +0.3(両腕を広げて回る。速く動くほど速く回る)',
    init(b) {
      b.w = { dmg: 1.6 };
      setSpin(b, 0);
      for (const off of [0, Math.PI]) b.blades.push(makeBlade({ sprite: 'arm', off, rIn: b.r - 6, rOut: b.r + 38, w: 16, damage: (w, me) => me.w.dmg, cd: 0.3, knock: 260, parry: false }));
    },
    stats: (b) => [['腕', fmt(Math.round(b.w.dmg * 10) / 10)]],
    update(world, me, foe, dt) {
      me.angle += dt * (2 + Math.hypot(me.vx, me.vy) / 110);
    },
    onHit(world, me) {
      me.w.dmg += 0.3;
    },
  },
  {
    id: 'bearhug',
    kind: 'body',
    name: 'ベアハッグ',
    en: 'Bear Hug',
    color: '#8b5a2b',
    grow: '締めるたびに 締めつけのダメージ +0.1(ぶつかった相手をつかまえて1秒しめつける)',
    init(b) {
      b.w = { sq: 0.8, hold: 0, tick: 0, cd: 0, target: null };
    },
    stats: (b) => [['締めつけ', fmt(Math.round(b.w.sq * 10) / 10)]],
    onContact(world, me, foe) {
      const w = me.w;
      if (w.target || w.cd > 0) return;
      w.target = foe;
      w.hold = 1;
      w.tick = 0;
      w.off = Math.atan2(foe.y - me.y, foe.x - me.x);
    },
    update(world, me, foe, dt) {
      const w = me.w;
      if (w.cd > 0) w.cd -= dt;
      const o = w.target;
      if (!o) {
        me.angle = Math.atan2(me.vy, me.vx);
        return;
      }
      if (o.dead) {
        w.target = null;
        return;
      }
      // つかまえている間は相手をくっつけたまま締める
      w.hold -= dt;
      me.angle = w.off;
      o.x = Math.max(o.r, Math.min(ARENA - o.r, me.x + Math.cos(w.off) * (me.r + o.r - 4)));
      o.y = Math.max(o.r, Math.min(ARENA - o.r, me.y + Math.sin(w.off) * (me.r + o.r - 4)));
      o.vx = me.vx;
      o.vy = me.vy;
      o.stun = Math.max(o.stun, 0.05);
      w.tick -= dt;
      if (w.tick <= 0) {
        w.tick = 0.25;
        landHit(world, me, o, w.sq, { kind: 'hug', x: o.x, y: o.y });
      }
      if (w.hold <= 0 || o.dead) {
        knockback(me, o, 400);
        w.target = null;
        w.cd = 1.5;
      }
    },
    onHit(world, me, foe, info) {
      if (info.kind === 'hug') me.w.sq += 0.1;
    },
  },
  {
    id: 'ironBody',
    kind: 'body',
    name: '鋼の体',
    en: 'Iron Body',
    color: '#7f8c8d',
    grow: '攻撃を受けるたびに 体当たりのダメージ +0.4(打たれるほど強くなる)・受けるダメージ -15%',
    init(b) {
      b.w = { dmg: 2 };
    },
    stats: (b) => [['体当たり', fmt(Math.round(b.w.dmg * 10) / 10)]],
    onContact(world, me, foe) {
      if (landHit(world, me, foe, me.w.dmg, { kind: 'iron', x: (me.x + foe.x) / 2, y: (me.y + foe.y) / 2 }) > 0) knockback(me, foe, 220);
    },
    onTakeDamage(world, me, src, amount, opts) {
      if (src && src !== me && opts.kind !== 'poison' && opts.kind !== 'burn') me.w.dmg += 0.4;
      return amount * 0.85;
    },
    update(world, me) {
      me.angle = Math.atan2(me.vy, me.vx);
    },
  },
  {
    id: 'rush',
    kind: 'body',
    name: 'ラッシュ',
    en: 'Rush',
    color: '#f39c12',
    grow: '当たるたびに 1発のダメージ +0.02(近くの相手に目にもとまらぬ連打。1.5秒打って1秒休む)',
    init(b) {
      b.w = { dmg: 0.7, on: 0, rest: 0.5, tick: 0 };
      setSpin(b, 0);
    },
    stats: (b) => [['連打', fmt(Math.round(b.w.dmg * 100) / 100)]],
    update(world, me, foe, dt) {
      const w = me.w;
      turnTo(me, aimAt(me, foe), dt, 10);
      const near = Math.hypot(foe.x - me.x, foe.y - me.y) < me.r + foe.r + 90;
      if (w.on > 0) {
        w.on -= dt;
        if (w.on <= 0) w.rest = 1;
        w.tick -= dt;
        if (w.tick <= 0 && near) {
          w.tick = 0.08;
          landHit(world, me, foe, w.dmg, { kind: 'rush', x: foe.x + (world.rng() - 0.5) * 30, y: foe.y + (world.rng() - 0.5) * 30 });
        }
        return;
      }
      w.rest -= dt;
      if (w.rest <= 0 && near) w.on = 1.5;
    },
    onHit(world, me) {
      me.w.dmg += 0.02;
    },
  },
  // ==== 155種への追加分(第1組: 動物・魔法) ====
  {
    id: 'turtle',
    kind: 'body',
    name: 'カメ',
    en: 'Turtle',
    color: '#5a8f3c',
    grow: '甲羅が当たるたびに ダメージ +0.5・こもる時間アップ(ときどき甲羅にこもって、ほぼ無敵で突っこむ)',
    init(b) {
      b.w = { dmg: 3, dur: 1, shell: 0, timer: 1.5 };
      setSpin(b, 0);
    },
    stats: (b) => [
      ['甲羅', fmt(Math.round(b.w.dmg * 10) / 10)],
      ['こもる', fmt(Math.round(shown(b, 'dur') * 10) / 10) + '秒'],
    ],
    update(world, me, foe, dt) {
      const w = me.w;
      if (w.shell > 0) {
        w.shell -= dt;
        me.angle += dt * 20;
        return;
      }
      me.angle = Math.atan2(me.vy, me.vx);
      w.timer -= dt;
      if (w.timer > 0) return;
      // 甲羅にこもって相手へ回転しながら突っこむ
      w.timer = 2.4;
      w.shell = w.dur;
      const a = aimAt(me, foe);
      me.vx = Math.cos(a) * 820;
      me.vy = Math.sin(a) * 820;
    },
    onContact(world, me, foe) {
      if (me.w.shell <= 0) return;
      if (landHit(world, me, foe, me.w.dmg, { kind: 'shell', x: (me.x + foe.x) / 2, y: (me.y + foe.y) / 2 }) > 0) knockback(me, foe, 420);
    },
    onTakeDamage: (world, me, src, amount) => (me.w.shell > 0 ? amount * 0.15 : amount),
    onHit(world, me, foe, info) {
      if (info.kind !== 'shell') return;
      me.w.dmg += 0.5;
      growStat(me, 'dur', 0.06, 2, 0.4);
    },
  },
  {
    id: 'scorpion',
    kind: 'melee',
    name: 'サソリ',
    en: 'Scorpion',
    color: '#a0522d',
    grow: '刺すたびに 毒 +1・ダメージ +0.2(頭の上のしっぽで、近づいた相手をグサッと刺す)',
    init(b) {
      b.w = { dmg: 2, timer: 0.5, sting: 0, base: -Math.PI / 2, aim: 0 };
      setSpin(b, 0);
      b.blades = [makeBlade({ sprite: 'tail', rIn: b.r - 6, rOut: b.r + 66, w: 10, damage: (w, me) => (me.w.sting > 0 ? me.w.dmg : undefined), cd: 0.3, knock: 160, parry: false })];
    },
    stats: (b) => [['毒針', fmt(Math.round(b.w.dmg * 10) / 10)]],
    update(world, me, foe, dt) {
      const w = me.w;
      w.timer -= dt;
      if (w.sting > 0) {
        // しっぽを相手へ振り下ろす
        w.sting -= dt;
        turnTo(me, w.aim, dt, 25);
        if (w.sting <= 0) w.timer = 1.1;
        return;
      }
      turnTo(me, -Math.PI / 2, dt, 6);
      if (w.timer <= 0 && Math.hypot(foe.x - me.x, foe.y - me.y) < me.r + foe.r + 90) {
        w.sting = 0.3;
        w.aim = aimAt(me, foe);
      }
    },
    onHit(world, me, foe, info) {
      if (info.kind !== 'melee') return;
      foe.poison += 1;
      foe.poisonSrc = me.id;
      me.w.dmg += 0.2;
    },
  },
  {
    id: 'octopus',
    kind: 'melee',
    name: 'タコ',
    en: 'Octopus',
    color: '#e5677f',
    grow: '当たるたびに 足のダメージ +0.15(4本の足がうねる。ときどき墨をはいて相手を遅くする)',
    init(b) {
      b.w = { dmg: 1, timer: 2, t: 0 };
      setSpin(b, 2.2);
      for (let i = 0; i < 4; i++) b.blades.push(makeBlade({ sprite: 'tentacle', off: (i * Math.PI) / 2, rIn: b.r - 6, rOut: b.r + 40, w: 12, damage: (w, me) => me.w.dmg, cd: 0.35, knock: 110, parry: false }));
    },
    stats: (b) => [['足', fmt(Math.round(b.w.dmg * 100) / 100)]],
    update(world, me, foe, dt) {
      const w = me.w;
      w.t += dt;
      me.blades.forEach((bl, i) => (bl.rOut = me.r + 32 + Math.sin(w.t * 5 + i * 1.6) * 16));
      w.timer -= dt;
      if (w.timer > 0) return;
      w.timer = 3.5;
      shoot(world, me, aimAt(me, foe), 420, {
        kind: 'ink',
        r: 10,
        life: 1.4,
        onTouch(world, p, owner, o) {
          p.dead = true;
          if (landHit(world, owner, o, 1, { kind: 'ink', x: p.x, y: p.y }) > 0) {
            o.slow = Math.max(o.slow, 0.45);
            o.slowT = 1.6;
            o.inkT = 1.6;
          }
        },
      });
    },
    onHit(world, me) {
      me.w.dmg += 0.15;
    },
  },
  {
    id: 'penguin',
    kind: 'body',
    name: 'ペンギン',
    en: 'Penguin',
    color: '#2c3e50',
    grow: '滑りこみが当たるたびに ダメージ +0.5・滑る速さアップ(床に下りると、おなかで相手へ滑りこむ)',
    init(b) {
      b.w = { dmg: 5.5, speed: 700, slide: 0, cd: 0, hit: false };
      setSpin(b, 0);
    },
    stats: (b) => [
      ['滑りこみ', fmt(Math.round(b.w.dmg * 10) / 10)],
      ['速さ', fmt(Math.round(shown(b, 'speed')))],
    ],
    update(world, me, foe, dt) {
      const w = me.w;
      w.cd -= dt;
      const floor = ARENA - me.r;
      if (w.slide > 0) {
        w.slide -= dt;
        me.y = floor;
        me.vy = 0;
        me.vx = Math.sign(me.vx || 1) * w.speed;
        me.angle = me.vx > 0 ? 0 : Math.PI;
        if (!w.hit && Math.hypot(foe.x - me.x, foe.y - me.y) < me.r + foe.r + 14) {
          w.hit = true;
          if (landHit(world, me, foe, w.dmg, { kind: 'slide', x: foe.x, y: foe.y }) > 0) {
            foe.vy = -700 * (foe.knockMul ?? 1);
            foe.vx += Math.sign(me.vx) * 300;
          }
        }
        if (w.slide <= 0) me.vy = -650; // 滑り終わったらぴょんと跳ねる
        return;
      }
      me.angle = Math.atan2(me.vy, me.vx);
      // 滑れるようになったら床へ急いで下りる
      if (w.cd <= 0 && me.vy > -200) me.vy += 1600 * dt;
      if (w.cd <= 0 && me.y >= floor - 3) {
        w.cd = 1;
        w.slide = 1;
        w.hit = false;
        me.vx = Math.sign(foe.x - me.x || 1) * w.speed;
      }
    },
    onHit(world, me, foe, info) {
      if (info.kind !== 'slide') return;
      me.w.dmg += 0.5;
      growStat(me, 'speed', 30, 1100, 0.4);
    },
  },
  {
    id: 'chameleon',
    kind: 'body',
    name: 'カメレオン',
    en: 'Chameleon',
    color: '#58c27d',
    grow: '当たるたびに 不意打ちのダメージ +0.5(ときどき透明になり、受けるダメージ半分。透明から出た最初の一撃が大きい)',
    init(b) {
      b.w = { dmg: 2.6, ambush: 8, timer: 1, hide: 0, ready: false };
      setSpin(b, 4);
      b.blades = [makeBlade({ sprite: 'claw', rIn: b.r - 4, rOut: b.r + 50, w: 14, damage: (w, me) => (me.w.ready ? me.w.ambush : me.w.dmg), cd: 0.3, knock: 140 })];
    },
    stats: (b) => [
      ['ひっかき', fmt(Math.round(b.w.dmg * 10) / 10)],
      ['不意打ち', fmt(Math.round(b.w.ambush * 10) / 10)],
    ],
    update(world, me, foe, dt) {
      const w = me.w;
      if (w.hide > 0) {
        w.hide -= dt;
        me.alpha = 0.18;
        if (w.hide <= 0) w.ready = true; // 姿をあらわした直後の一撃が大きい
        return;
      }
      me.alpha = 1;
      w.timer -= dt;
      if (w.timer <= 0) {
        w.timer = 4;
        w.hide = 1.6;
      }
    },
    onTakeDamage: (world, me, src, amount) => (me.w.hide > 0 ? amount * 0.5 : amount),
    onHit(world, me, foe, info) {
      if (me.w.ready) {
        me.w.ready = false;
        world.events.push({ type: 'crit', x: foe.x, y: foe.y });
      }
      me.w.ambush += 0.5;
      me.w.dmg += 0.1;
    },
  },
  {
    id: 'frostCircle',
    kind: 'ranged',
    name: '氷の魔法陣',
    en: 'Frost Circle',
    color: '#7fc8f8',
    grow: '当たるたびに 魔法陣が大きくなる・ダメージ +0.3(相手の足元に魔法陣、少しして中の相手を凍らせる)',
    init(b) {
      b.w = { r: 90, dmg: 3, timer: 1 };
    },
    stats: (b) => [
      ['魔法陣', fmt(Math.round(shown(b, 'r')))],
      ['ダメージ', fmt(Math.round(b.w.dmg * 10) / 10)],
    ],
    update(world, me, foe, dt) {
      me.angle = -Math.PI / 2;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2.4;
      spawnProjectile(world, me, {
        // 魔法陣が光るころ(0.6秒後)に相手がいそうな場所
        x: Math.max(20, Math.min(ARENA - 20, foe.x + foe.vx * 0.3)),
        y: Math.max(20, Math.min(ARENA - 20, foe.y + foe.vy * 0.6 + 0.5 * 1000 * 0.36)),
        kind: 'frostcircle',
        r: me.w.r,
        life: 0.6,
        wall: 'stop',
        blockable: false,
        onExpire(world, p, owner) {
          world.events.push({ type: 'shock', x: p.x, y: p.y, r: p.r, color: '#bfe6ff' });
          for (const o of world.balls) {
            if (o === owner || o.dead || Math.hypot(o.x - p.x, o.y - p.y) > p.r + o.r) continue;
            if (landHit(world, owner, o, owner.w.dmg, { kind: 'frostcircle', x: o.x, y: o.y }) > 0) {
              o.freeze = Math.max(o.freeze, 0.9);
              o.stun = Math.max(o.stun, 0.9);
            }
          }
        },
      });
    },
    onHit(world, me, foe, info) {
      if (info.kind !== 'frostcircle') return;
      growStat(me, 'r', 6, 160, 0.4);
      me.w.dmg += 0.3;
    },
  },
  {
    id: 'shrinkRay',
    kind: 'ranged',
    name: '縮小光線',
    en: 'Shrink Ray',
    color: '#c06bd6',
    grow: '当たるたびに ダメージ +0.4(当たった相手は3秒間小さくなって、与えるダメージが減る)',
    init(b) {
      b.w = { dmg: 2.5, timer: 0.8, shrunk: [], beam: 0 };
      setSpin(b, 0);
    },
    stats: (b) => [['光線', fmt(Math.round(b.w.dmg * 10) / 10)]],
    update(world, me, foe, dt) {
      const w = me.w;
      turnTo(me, aimAt(me, foe), dt, 8);
      if (w.beam > 0) w.beam -= dt;
      // 小さくした相手を元に戻す
      for (const s of w.shrunk) {
        s.t -= dt;
        if (s.t <= 0) {
          s.ball.r = s.r;
          s.ball.outMul = 1;
        }
      }
      w.shrunk = w.shrunk.filter((s) => s.t > 0);
      w.timer -= dt;
      if (w.timer > 0) return;
      w.timer = 2.4;
      // 撃つ瞬間は、相手が動く先へ向け直す
      me.angle = Math.atan2(foe.y + foe.vy * 0.05 - me.y, foe.x + foe.vx * 0.05 - me.x);
      w.beam = 0.15;
      w.beamA = me.angle;
      const ex = me.x + Math.cos(me.angle) * 1400;
      const ey = me.y + Math.sin(me.angle) * 1400;
      for (const o of world.balls) {
        if (o === me || o.dead || segPointDist(me.x, me.y, ex, ey, o.x, o.y) > o.r + 8) continue;
        if (landHit(world, me, o, w.dmg, { kind: 'shrink', x: o.x, y: o.y }) <= 0) continue;
        const s = w.shrunk.find((x) => x.ball === o);
        if (s) s.t = 3;
        else {
          w.shrunk.push({ ball: o, t: 3, r: o.r });
          o.r *= 0.75;
          o.outMul = 0.7; // 与えるダメージが減る(engine の dealDamage が見る)
        }
      }
    },
    onHit(world, me, foe, info) {
      if (info.kind === 'shrink') me.w.dmg += 0.4;
    },
  },
  {
    id: 'holyPillar',
    kind: 'ranged',
    name: '光の柱',
    en: 'Holy Pillar',
    color: '#f5d76e',
    grow: '3回当たるたびに 光の柱 +1(相手のいる列に、天井から床まで光の柱が落ちる)',
    init(b) {
      b.w = { n: 1, dmg: 4, timer: 1 };
    },
    stats: (b) => [['光の柱', fmt(Math.floor(shown(b, 'n')))]],
    update(world, me, foe, dt) {
      me.angle = -Math.PI / 2;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.8;
      const n = Math.floor(me.w.n);
      for (let i = 0; i < n; i++) {
        const x = Math.max(20, Math.min(ARENA - 20, foe.x + foe.vx * 0.55 + (i - (n - 1) / 2) * 90));
        spawnProjectile(world, me, {
          x,
          y: ARENA / 2,
          kind: 'pillar',
          r: 34,
          life: 0.6,
          wall: 'stop',
          blockable: false,
          onExpire(world, p, owner) {
            world.events.push({ type: 'pillar', x: p.x });
            for (const o of world.balls) {
              if (o === owner || o.dead || Math.abs(o.x - p.x) > p.r + o.r * 0.6) continue;
              landHit(world, owner, o, owner.w.dmg, { kind: 'pillar', x: o.x, y: o.y });
            }
          },
        });
      }
    },
    onHit(world, me, foe, info) {
      if (info.kind === 'pillar') growStat(me, 'n', 0.34, 3, 0.5);
    },
  },
  {
    id: 'golem',
    kind: 'ranged',
    name: 'ゴーレム',
    en: 'Golem',
    color: '#8d7b68',
    grow: '殴るたびに ゴーレムのダメージ +0.6(大きな石のゴーレムを1体よび、床を歩いて殴りにいく)',
    init(b) {
      b.w = { dmg: 5, timer: 0.5, alive: false };
    },
    stats: (b) => [['ゴーレム', fmt(Math.round(b.w.dmg * 10) / 10)]],
    update(world, me, foe, dt) {
      me.angle = Math.PI / 2;
      if (me.w.alive) return;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.alive = true;
      const done = (world, p, owner) => {
        owner.w.alive = false;
        owner.w.timer = 1.2;
      };
      spawnProjectile(world, me, {
        x: Math.max(30, Math.min(ARENA - 30, me.x)),
        y: ARENA - 26,
        kind: 'golem',
        r: 26,
        life: 9,
        wall: 'stop',
        blockable: false,
        punch: 0,
        hitCd: 0.6,
        update(world, p, owner, foe, dt) {
          p.y = ARENA - p.r;
          const dx = foe.x - p.x;
          p.vx = Math.abs(dx) > 40 ? Math.sign(dx) * 80 : 0;
          p.face = Math.sign(dx) || 1;
          if (p.punch > 0) p.punch -= dt;
          p.hitCd -= dt;
          if (p.hitCd > 0) return;
          // 近くの相手を殴る(少し上まで届く)
          for (const o of world.balls) {
            if (o === owner || o.dead) continue;
            if (Math.abs(o.x - p.x) < p.r + o.r + 30 && o.y > ARENA - 200) {
              p.hitCd = 1;
              p.punch = 0.25;
              if (landHit(world, owner, o, owner.w.dmg, { kind: 'golem', x: o.x, y: o.y }) > 0) knockback(p, o, 450);
              break;
            }
          }
        },
        onExpire: done,
      });
    },
    onHit(world, me, foe, info) {
      if (info.kind === 'golem') me.w.dmg += 0.6;
    },
  },
  {
    id: 'windBarrier',
    kind: 'body',
    name: '風の守り',
    en: 'Wind Barrier',
    color: '#9ed9c8',
    grow: '当たるたびに 押し返しのダメージ +0.3(まわりの風が飛んできた弾を撃ち返し、近づいた相手を押し返す)',
    init(b) {
      b.w = { dmg: 1.5, cd: 0, spin: 0 };
    },
    stats: (b) => [['押し返し', fmt(Math.round(b.w.dmg * 10) / 10)]],
    update(world, me, foe, dt) {
      const w = me.w;
      w.spin += dt * 6;
      me.angle = Math.atan2(me.vy, me.vx);
      const R = me.r + 34;
      // 風の輪に入った(単純な)弾は、自分の弾にして撃ち返す
      for (const p of world.projectiles) {
        if (p.owner === me.id || p.reflected || !STEALABLE.has(p.kind) || Math.hypot(p.x - me.x, p.y - me.y) > R) continue;
        p.reflected = true;
        p.owner = me.id;
        p.vx *= -1.1;
        p.vy *= -1.1;
        p.angle = Math.atan2(p.vy, p.vx);
        world.events.push({ type: 'block', x: p.x, y: p.y });
      }
      w.cd -= dt;
      if (w.cd > 0) return;
      for (const o of world.balls) {
        if (o === me || o.dead || Math.hypot(o.x - me.x, o.y - me.y) > R + o.r) continue;
        w.cd = 0.5;
        if (landHit(world, me, o, w.dmg, { kind: 'wind', x: o.x, y: o.y }) > 0) knockback(me, o, 360);
      }
    },
    onHit(world, me, foe, info) {
      if (info.kind === 'wind') me.w.dmg += 0.3;
    },
  },
  // ==== 第2組: 道具・自然 ====
  {
    id: 'umbrella',
    kind: 'melee',
    name: '傘',
    en: 'Umbrella',
    color: '#e74c8c',
    grow: '当たるたびに 突きのダメージ +0.4(開いた傘で前からの弾を防ぎ、ふわっと落ちる。ときどき突く)',
    init(b) {
      b.w = { dmg: 2.5, timer: 0.6, poke: 0 };
      setSpin(b, 0);
      // 傘(防ぐだけ)と、先っぽ(突く)
      b.blades = [
        makeBlade({ sprite: 'umbrella', rIn: b.r + 4, rOut: b.r + 22, w: 58, damage: undefined, parry: true }),
        makeBlade({ sprite: 'poke', rIn: b.r, rOut: b.r + 10, w: 8, damage: (w, me) => (me.w.poke > 0 ? me.w.dmg : undefined), cd: 0.3, knock: 180, parry: false }),
      ];
    },
    stats: (b) => [['突き', fmt(Math.round(b.w.dmg * 10) / 10)]],
    update(world, me, foe, dt) {
      const w = me.w;
      turnTo(me, aimAt(me, foe), dt, 6);
      // 落ちるときは傘でふわっと
      if (me.vy > 250) me.vy -= 700 * dt;
      w.timer -= dt;
      if (w.timer <= 0 && w.poke <= 0 && Math.hypot(foe.x - me.x, foe.y - me.y) < me.r + foe.r + 90) {
        w.timer = 0.7;
        w.poke = 0.2;
      }
      w.poke = Math.max(0, w.poke - dt);
      me.blades[1].rOut = me.r + 10 + Math.sin((Math.PI * w.poke) / 0.2) * 70;
    },
    onHit(world, me) {
      me.w.dmg += 0.4;
    },
  },
  {
    id: 'banana',
    kind: 'ranged',
    name: 'バナナ',
    en: 'Banana Peel',
    color: '#f4d03f',
    grow: 'すべらせるたびに ダメージ +0.5(床にバナナの皮を置き、ふんだ相手はすべって飛ばされる)',
    init(b) {
      b.w = { dmg: 3, timer: 0.6 };
    },
    stats: (b) => [['すべり', fmt(Math.round(b.w.dmg * 10) / 10)]],
    update(world, me, foe, dt) {
      me.angle = Math.PI / 2;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2.4;
      // 置いてある皮は3枚まで(古いものから消える)
      const mine = world.projectiles.filter((p) => p.owner === me.id && p.kind === 'peel' && !p.dead);
      if (mine.length >= 3) mine[0].dead = true;
      spawnProjectile(world, me, {
        x: Math.max(14, Math.min(ARENA - 14, me.x)),
        y: ARENA - 8,
        kind: 'peel',
        r: 14,
        life: 9,
        wall: 'stop',
        blockable: false,
        onTouch(world, p, owner, o) {
          if (p.age < 0.5) return;
          p.dead = true;
          if (landHit(world, owner, o, owner.w.dmg, { kind: 'peel', x: p.x, y: p.y }) > 0) {
            o.vx = Math.sign(o.vx || 1) * 900;
            o.vy = -500;
            o.stun = Math.max(o.stun, 0.4);
            o.slamT = 0.8;
            o.slamBy = owner.id;
          }
        },
      });
    },
    onHit(world, me, foe, info) {
      if (info.kind === 'peel') me.w.dmg += 0.5;
    },
  },
  {
    id: 'pie',
    kind: 'ranged',
    name: 'パイ投げ',
    en: 'Cream Pie',
    color: '#f5e6c8',
    grow: '当たるたびに ダメージ +0.4・目かくしの時間アップ(顔に当たると前が見えず、武器が遅くなる)',
    init(b) {
      b.w = { dmg: 2, blind: 1.2, timer: 0.6 };
    },
    stats: (b) => [
      ['パイ', fmt(Math.round(b.w.dmg * 10) / 10)],
      ['目かくし', fmt(Math.round(shown(b, 'blind') * 10) / 10) + '秒'],
    ],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe) - 0.3;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.1;
      shoot(world, me, aimAt(me, foe) - 0.15, 640, {
        kind: 'pie',
        r: 11,
        life: 1.8,
        gravity: 0.3,
        onTouch(world, p, owner, o) {
          p.dead = true;
          world.events.push({ type: 'shock', x: p.x, y: p.y, r: 36, color: '#fff6e0' });
          if (landHit(world, owner, o, owner.w.dmg, { kind: 'pie', x: p.x, y: p.y }) > 0) {
            o.slow = Math.max(o.slow, 0.5);
            o.slowT = owner.w.blind;
            o.pieT = owner.w.blind;
          }
        },
      });
    },
    onHit(world, me, foe, info) {
      if (info.kind !== 'pie') return;
      me.w.dmg += 0.4;
      growStat(me, 'blind', 0.1, 2.5, 0.3);
    },
  },
  {
    id: 'hammerThrow',
    kind: 'ranged',
    name: 'ハンマー投げ',
    en: 'Hammer Throw',
    color: '#5d6d7e',
    grow: '投げたハンマーが当たるたびに ダメージ +1.2(ぐるぐる回して勢いをつけ、重いハンマーを放つ)',
    init(b) {
      b.w = { dmg: 7, wind: 0, timer: 0.5 };
      setSpin(b, 0);
      b.blades = [makeBlade({ sprite: 'chainball', rIn: b.r, rOut: b.r + 70, w: 14, damage: (w, me) => (me.w.wind > 0 ? 1.5 : undefined), cd: 0.4, knock: 150, parry: false })];
    },
    stats: (b) => [['ハンマー', fmt(Math.round(b.w.dmg * 10) / 10)]],
    update(world, me, foe, dt) {
      const w = me.w;
      const bl = me.blades[0];
      if (w.wind > 0) {
        // 回して勢いをつける(だんだん速く)
        w.wind -= dt;
        me.angle += dt * (6 + (1.1 - w.wind) * 14);
        bl.rOut = me.r + 70;
        if (w.wind <= 0) {
          bl.rOut = me.r;
          const a = aimAt(me, foe);
          shoot(world, me, a, 760, {
            kind: 'hammerball',
            r: 15,
            life: 2,
            wall: 'bounce',
            bounces: 1,
            blockable: false,
            onTouch(world, p, owner, o) {
              p.dead = true;
              world.events.push({ type: 'boom', x: p.x, y: p.y, radius: 40, kind: 'bomb' });
              if (landHit(world, owner, o, owner.w.dmg, { kind: 'hammer', x: p.x, y: p.y }) > 0) {
                knockback(p, o, 520);
                o.slamT = 0.7;
                o.slamBy = owner.id;
              }
            },
          });
          w.timer = 1.6;
        }
        return;
      }
      bl.rOut = me.r;
      me.angle = aimAt(me, foe);
      w.timer -= dt;
      if (w.timer <= 0) w.wind = 1.1;
    },
    onHit(world, me, foe, info) {
      if (info.kind === 'hammer') me.w.dmg += 1.2;
    },
  },
  {
    id: 'tsunami',
    kind: 'ranged',
    name: '津波',
    en: 'Tsunami',
    color: '#2e86c1',
    grow: '波が当たるたびに 波が高くなる・ダメージ +0.5(はしから大きな波が床をおしよせ、相手を押し流す)',
    init(b) {
      b.w = { dmg: 4, h: 230, timer: 1.5, wave: null };
    },
    stats: (b) => [
      ['波の高さ', fmt(Math.round(shown(b, 'h')))],
      ['ダメージ', fmt(Math.round(b.w.dmg * 10) / 10)],
    ],
    update(world, me, foe, dt) {
      const w = me.w;
      me.angle = Math.PI / 2;
      if (w.wave) {
        const v = w.wave;
        v.x += v.dir * 430 * dt;
        for (const o of world.balls) {
          if (o === me || o.dead || v.hit.has(o) || Math.abs(o.x - v.x) > 30 + o.r || o.y < ARENA - v.h - o.r) continue;
          v.hit.add(o);
          if (landHit(world, me, o, w.dmg, { kind: 'wave', x: o.x, y: o.y }) > 0) {
            o.vx = v.dir * 700 * (o.knockMul ?? 1);
            o.vy -= 250;
            o.slamT = 0.8;
            o.slamBy = me.id;
          }
        }
        if (v.x < -60 || v.x > ARENA + 60) w.wave = null;
        return;
      }
      w.timer -= dt;
      if (w.timer > 0) return;
      w.timer = 2.6;
      // 相手から遠いほうのはしから波を起こす
      const dir = foe.x > ARENA / 2 ? 1 : -1;
      w.wave = { x: dir > 0 ? -40 : ARENA + 40, dir, h: w.h, hit: new Set() };
    },
    onHit(world, me, foe, info) {
      if (info.kind !== 'wave') return;
      growStat(me, 'h', 12, 420, 0.4);
      me.w.dmg += 0.5;
    },
  },
  {
    id: 'cactus',
    kind: 'ranged',
    name: 'サボテン',
    en: 'Cactus',
    color: '#3f9e4d',
    grow: 'ささるたびに トゲのダメージ +0.3(床にサボテンを生やす。さわった相手はトゲがささって跳ね上がる)',
    init(b) {
      b.w = { dmg: 2.5, timer: 0.8 };
    },
    stats: (b) => [['トゲ', fmt(Math.round(b.w.dmg * 10) / 10)]],
    update(world, me, foe, dt) {
      me.angle = Math.PI / 2;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.6;
      const mine = world.projectiles.filter((p) => p.owner === me.id && p.kind === 'cactus' && !p.dead);
      if (mine.length >= 4) mine[0].dead = true;
      // 相手の進む先あたりの床に生やす
      spawnProjectile(world, me, {
        x: Math.max(20, Math.min(ARENA - 20, foe.x + foe.vx * 0.6)),
        y: ARENA - 30,
        kind: 'cactus',
        r: 22,
        grow: 0,
        life: 10,
        wall: 'stop',
        blockable: false,
        hitCd: 0,
        update(world, p, owner, foe, dt) {
          p.grow = Math.min(1, p.grow + dt * 3);
          if (p.hitCd > 0) p.hitCd -= dt;
        },
        onTouch(world, p, owner, o) {
          if (p.hitCd > 0 || p.grow < 1) return;
          p.hitCd = 0.8;
          if (landHit(world, owner, o, owner.w.dmg, { kind: 'cactus', x: o.x, y: o.y }) > 0) {
            o.vy = -650 * (o.knockMul ?? 1);
            o.vx += Math.sign(o.x - p.x || 1) * 200;
          }
        },
      });
    },
    onHit(world, me, foe, info) {
      if (info.kind === 'cactus') me.w.dmg += 0.3;
    },
  },
  {
    id: 'iceSpike',
    kind: 'ranged',
    name: '氷山',
    en: 'Ice Spike',
    color: '#5dade2',
    grow: '当たるたびに 氷の高さアップ・ダメージ +0.5(相手の下の床から氷のトゲが突き出て打ち上げる)',
    init(b) {
      b.w = { dmg: 4, h: 400, timer: 1 };
    },
    stats: (b) => [
      ['氷', fmt(Math.round(b.w.dmg * 10) / 10)],
      ['高さ', fmt(Math.round(shown(b, 'h')))],
    ],
    update(world, me, foe, dt) {
      me.angle = Math.PI / 2;
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.6;
      spawnProjectile(world, me, {
        // 先読みしすぎると壁で跳ね返った相手を外すので、少しだけ
        x: Math.max(40, Math.min(ARENA - 40, foe.x + foe.vx * 0.2)),
        y: ARENA - 6,
        kind: 'spikeMark',
        r: 36,
        life: 0.4,
        wall: 'stop',
        blockable: false,
        onExpire(world, p, owner) {
          // 広いフィールド(3人以上)では、広さに合わせて高くする
          const h = (owner.w.h * ARENA) / 600;
          world.events.push({ type: 'icespike', x: p.x, h });
          for (const o of world.balls) {
            if (o === owner || o.dead || Math.abs(o.x - p.x) > p.r + o.r * 0.8 || o.y < ARENA - h - o.r) continue;
            if (landHit(world, owner, o, owner.w.dmg, { kind: 'icespike', x: o.x, y: o.y }) > 0) {
              o.vy = -800 * (o.knockMul ?? 1);
              o.slow = Math.max(o.slow, 0.3);
              o.slowT = 0.8;
            }
          }
        },
      });
    },
    onHit(world, me, foe, info) {
      if (info.kind !== 'icespike') return;
      growStat(me, 'h', 10, 540, 0.4);
      me.w.dmg += 0.5;
    },
  },
  // ==== 第3組: トリック・キャラクター ====
  {
    id: 'slot',
    kind: 'ranged',
    name: 'スロット',
    en: 'Slot Machine',
    color: '#d4ac0d',
    grow: '当たるたびに 運 +2%(3秒ごとにスロットを回す。7が3つそろうと大当たりの雷、2つでコイン3枚、はずれでコイン1枚)',
    init(b) {
      b.w = { luck: 10, timer: 1, spin: 0, reels: ['7', '7', '7'] };
    },
    stats: (b) => [['運', Math.round(Math.min(60, shown(b, 'luck'))) + '%']],
    update(world, me, foe, dt) {
      const w = me.w;
      me.angle = -Math.PI / 2;
      const syms = ['7', '🍒', '🔔', '⭐'];
      if (w.spin > 0) {
        w.spin -= dt;
        w.reels = w.reels.map(() => syms[Math.floor(world.rng() * syms.length)]);
        if (w.spin > 0) return;
        // 止まった目を決める(運が良いほど7がそろいやすい)
        const r = world.rng() * 100;
        const luck = Math.min(60, w.luck);
        if (r < luck * 0.35) w.reels = ['7', '7', '7'];
        else if (r < luck * 0.35 + 25 + luck * 0.5) w.reels = ['🍒', '🍒', syms[1 + Math.floor(world.rng() * 3)]];
        else w.reels = ['🔔', '⭐', '🍒'];
        const n = w.reels.filter((s) => s === w.reels[0]).length;
        if (n === 3) {
          // 大当たり: 相手全員に雷
          world.events.push({ type: 'jackpot', x: me.x, y: me.y });
          for (const o of world.balls) if (o !== me && !o.dead) {
            world.events.push({ type: 'zap', x: o.x, y: o.y, big: true });
            landHit(world, me, o, 10, { kind: 'slot', x: o.x, y: o.y });
          }
        } else {
          const coins = n === 2 ? 3 : 1;
          for (let i = 0; i < coins; i++) {
            shoot(world, me, aimAt(me, foe) + (i - (coins - 1) / 2) * 0.3, 420, {
              kind: 'coin',
              r: 7,
              life: 2,
              damage: 2.5,
              update: (world, p, owner, foe, dt) => homing(p, foe, 3, dt),
              onTouch: hitOnce({ kind: 'slot' }),
            });
          }
        }
        w.timer = 1.5;
        return;
      }
      w.timer -= dt;
      if (w.timer <= 0) w.spin = 0.6;
    },
    onHit(world, me, foe, info) {
      if (info.kind === 'slot' || info.kind === 'coin') growStat(me, 'luck', 2, 60, 0.4);
    },
  },
  {
    id: 'pingpong',
    kind: 'ranged',
    name: 'ピンポン',
    en: 'Ping Pong',
    color: '#e67e22',
    grow: '当たるたびに 基本ダメージ +0.2(1つの玉を打ち合う。続くほど玉が速く痛くなる＝ラリー)',
    init(b) {
      b.w = { base: 1, rally: 0, timer: 0.5, ball: null };
      setSpin(b, 0);
      b.blades = [makeBlade({ sprite: 'paddle', rIn: b.r, rOut: b.r + 22, w: 34, damage: undefined, parry: false })];
    },
    stats: (b) => [
      ['ラリー', fmt(b.w.rally)],
      ['基本', fmt(Math.round(b.w.base * 10) / 10)],
    ],
    update(world, me, foe, dt) {
      const w = me.w;
      turnTo(me, aimAt(me, foe), dt, 8);
      if (w.ball && !w.ball.dead) {
        const p = w.ball;
        // 自分のところへ戻ってきた玉は、ラケットで打ち返す
        if (p.back && Math.hypot(p.x - me.x, p.y - me.y) < me.r + 40) {
          p.back = false;
          w.rally++;
          const sp = Math.min(1300, 480 + w.rally * 45);
          const a = aimAt(me, foe);
          p.vx = Math.cos(a) * sp;
          p.vy = Math.sin(a) * sp;
          p.life = p.age + 4;
          world.events.push({ type: 'shock', x: p.x, y: p.y, r: 24, color: '#ffffff' });
        }
        return;
      }
      w.ball = null;
      w.rally = 0;
      w.timer -= dt;
      if (w.timer > 0) return;
      w.timer = 0.8;
      shoot(world, me, aimAt(me, foe), 480, {
        kind: 'pingball',
        r: 7,
        life: 4,
        wall: 'bounce',
        blockable: false,
        back: false,
        update(world, p, owner, foe, dt) {
          if (!p.back) return;
          // 持ち主へ戻る
          const a = Math.atan2(owner.y - p.y, owner.x - p.x);
          const sp = Math.hypot(p.vx, p.vy);
          p.vx = Math.cos(a) * sp;
          p.vy = Math.sin(a) * sp;
        },
        onTouch(world, p, owner, o) {
          if (p.back) return;
          p.back = true;
          landHit(world, owner, o, owner.w.base + owner.w.rally * 0.5, { kind: 'pingpong', x: p.x, y: p.y });
        },
      });
      w.ball = world.projectiles[world.projectiles.length - 1];
    },
    onHit(world, me, foe, info) {
      if (info.kind === 'pingpong') me.w.base += 0.2;
    },
  },
  {
    id: 'magician',
    kind: 'ranged',
    name: '手品師',
    en: 'Magician',
    color: '#34495e',
    grow: '当たるたびに 手品の威力 +8%(帽子から ハト・カード・ウサギ・爆弾 のどれかが出てくる)',
    init(b) {
      b.w = { mul: 1, timer: 0.8 };
    },
    stats: (b) => [['手品', '×' + fmt(Math.round(b.w.mul * 100) / 100)]],
    update(world, me, foe, dt) {
      const w = me.w;
      me.angle = aimAt(me, foe);
      w.timer -= dt;
      if (w.timer > 0) return;
      w.timer = 1.2;
      const a = me.angle;
      const k = w.mul;
      const pick = Math.floor(world.rng() * 4);
      world.events.push({ type: 'shock', x: me.x, y: me.y - me.r, r: 30, color: '#ffffff' });
      if (pick === 0) {
        shoot(world, me, a - 0.6, 300, { kind: 'dove', r: 9, life: 3, damage: 3 * k, update: (world, p, owner, foe, dt) => homing(p, foe, 3.5, dt, 360), onTouch: hitOnce({ kind: 'magic' }) });
      } else if (pick === 1) {
        for (const s of [-0.2, 0, 0.2]) shoot(world, me, a + s, 580, { kind: 'card', r: 6, life: 1.4, suit: 0, damage: 1.3 * k, onTouch: hitOnce({ kind: 'magic' }) });
      } else if (pick === 2) {
        shoot(world, me, a - 0.5, 420, { kind: 'rabbit', r: 11, life: 3, gravity: 0.8, wall: 'bounce', bounces: 4, damage: 3 * k, onTouch: hitOnce({ kind: 'magic' }) });
      } else {
        shoot(world, me, a, 300, {
          kind: 'minibomb',
          r: 9,
          life: 1.2,
          gravity: 0.4,
          onTouch: (world, p, owner, o) => explode(world, p, owner, o, 60, 4 * owner.w.mul, 'magic'),
          onExpire: (world, p, owner, o) => explode(world, p, owner, o, 60, 4 * owner.w.mul, 'magic'),
        });
      }
    },
    onHit(world, me, foe, info) {
      if (info.kind === 'magic') me.w.mul += 0.08;
    },
  },
  {
    id: 'bubbleGum',
    kind: 'ranged',
    name: '風船ガム',
    en: 'Bubble Gum',
    color: '#ff8fc8',
    grow: '割れて当たるたびに ふくらむ大きさアップ(口の前でガムをふくらませ、大きくなるか相手にふれるとパン！)',
    init(b) {
      b.w = { max: 40, size: 0, timer: 0.5 };
      setSpin(b, 0);
    },
    stats: (b) => [['最大', fmt(Math.round(shown(b, 'max')))]],
    update(world, me, foe, dt) {
      const w = me.w;
      turnTo(me, aimAt(me, foe), dt, 5);
      if (w.size > 0) {
        w.size += dt * 26;
        const bx = me.x + Math.cos(me.angle) * (me.r + w.size);
        const by = me.y + Math.sin(me.angle) * (me.r + w.size);
        w.bx = bx;
        w.by = by;
        const touch = world.balls.some((o) => o !== me && !o.dead && Math.hypot(o.x - bx, o.y - by) < o.r + w.size);
        if (touch || w.size >= w.max) {
          // パン！ ふくらんだ大きさほど広く痛い
          const R = w.size * 2;
          world.events.push({ type: 'shock', x: bx, y: by, r: R, color: '#ff8fc8' });
          for (const o of world.balls) {
            if (o === me || o.dead || Math.hypot(o.x - bx, o.y - by) > R + o.r) continue;
            if (landHit(world, me, o, 1 + w.size / 8, { kind: 'gum', x: o.x, y: o.y }) > 0) {
              knockback({ x: bx, y: by }, o, 300 + w.size * 6);
              o.slow = Math.max(o.slow, 0.3);
              o.slowT = 1;
            }
          }
          w.size = 0;
          w.timer = 1;
        }
        return;
      }
      w.timer -= dt;
      if (w.timer <= 0) w.size = 6;
    },
    onHit(world, me) {
      growStat(me, 'max', 3, 90, 0.4);
    },
  },
  {
    id: 'decoy',
    kind: 'ranged',
    name: '身代わり',
    en: 'Decoy',
    color: '#95a5a6',
    grow: '爆発が当たるたびに ダメージ +0.8(自分そっくりの身代わりを出す。ふれるか時間がたつと爆発)',
    init(b) {
      b.w = { dmg: 5, timer: 1 };
    },
    stats: (b) => [['爆発', fmt(Math.round(b.w.dmg * 10) / 10)]],
    update(world, me, foe, dt) {
      me.angle = aimAt(me, foe);
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 2.4;
      const a = aimAt(me, foe);
      spawnProjectile(world, me, {
        x: me.x,
        y: me.y,
        vx: Math.cos(a) * 380,
        vy: Math.sin(a) * 380 - 200,
        kind: 'decoy',
        r: me.r,
        color: me.def.color,
        life: 3.5,
        gravity: 1,
        wall: 'bounce',
        blockable: false,
        onTouch: (world, p, owner, o) => explode(world, p, owner, o, 85, owner.w.dmg, 'decoy'),
        onExpire: (world, p, owner, o) => explode(world, p, owner, o, 85, owner.w.dmg, 'decoy'),
      });
    },
    onHit(world, me, foe, info) {
      if (info.kind === 'decoy') me.w.dmg += 0.8;
    },
  },
  {
    id: 'robot',
    kind: 'ranged',
    name: 'ロボット',
    en: 'Robot',
    color: '#7f8fa6',
    grow: '当たるたびに 威力 +6%(4秒ごとに ドリル(近接) と 砲台(遠距離) に変形する)',
    init(b) {
      b.w = { mode: 0, timer: 4, gun: 0.4, mul: 1 };
      setSpin(b, 0);
      b.blades = [makeBlade({ sprite: 'drill', rIn: b.r - 6, rOut: b.r + 50, w: 14, damage: (w, me) => (me.w.mode === 0 ? 1.2 * me.w.mul : undefined), cd: 0.15, knock: 60 })];
    },
    stats: (b) => [
      ['形', b.w.mode === 0 ? 'ドリル' : '砲台'],
      ['威力', '×' + fmt(Math.round(b.w.mul * 100) / 100)],
    ],
    update(world, me, foe, dt) {
      const w = me.w;
      turnTo(me, aimAt(me, foe), dt, 8);
      w.timer -= dt;
      if (w.timer <= 0) {
        w.timer = 4;
        w.mode = 1 - w.mode;
        world.events.push({ type: 'shock', x: me.x, y: me.y, r: 55, color: '#d6dbe2' });
      }
      me.blades[0].rOut = w.mode === 0 ? me.r + 50 : me.r;
      if (w.mode !== 1) return;
      w.gun -= dt;
      if (w.gun > 0) return;
      w.gun = 0.5;
      shoot(world, me, me.angle, 620, { kind: 'bullet', r: 4, life: 1.5, damage: 2.5 * w.mul, onTouch: hitOnce() });
    },
    onHit(world, me) {
      me.w.mul += 0.06;
    },
  },
  {
    id: 'iai',
    kind: 'melee',
    name: '居合',
    en: 'Iai Samurai',
    color: '#922b21',
    grow: '斬るたびに ダメージ +1(刀をおさめて待ち、近づいた相手を一瞬で斬る)',
    init(b) {
      b.w = { dmg: 7, cd: 0.5, slash: 0 };
      setSpin(b, 0);
      b.blades = [makeBlade({ sprite: 'katana', rIn: b.r - 6, rOut: b.r, w: 9, damage: (w, me) => (me.w.slash > 0 ? me.w.dmg : undefined), cd: 0.3, knock: 300 })];
    },
    stats: (b) => [['居合', fmt(b.w.dmg)]],
    update(world, me, foe, dt) {
      const w = me.w;
      const bl = me.blades[0];
      if (w.slash > 0) {
        // 抜刀: ひと振りで大きく斬る
        w.slash -= dt;
        me.angle += dt * 14;
        bl.rOut = me.r + 100;
        if (w.slash <= 0) {
          bl.rOut = me.r;
          w.cd = 2;
        }
        return;
      }
      turnTo(me, aimAt(me, foe) - 0.8, dt, 8);
      w.cd -= dt;
      if (w.cd <= 0 && Math.hypot(foe.x - me.x, foe.y - me.y) < me.r + foe.r + 100) {
        w.slash = 0.12;
        world.events.push({ type: 'iai', x: me.x, y: me.y, a: me.angle });
      }
    },
    onHit(world, me) {
      me.w.dmg += 1;
    },
  },
  {
    id: 'knight',
    kind: 'melee',
    name: '騎士',
    en: 'Knight',
    color: '#566573',
    grow: '当たるたびに 剣のダメージ +0.4(剣と盾。盾の側は弾や刃を受け止める)',
    init(b) {
      b.w = { dmg: 3.4 };
      setSpin(b, 3.2);
      b.blades = [
        makeBlade({ sprite: 'sword', rIn: b.r - 6, rOut: b.r + 72, w: 10, damage: (w, me) => me.w.dmg, cd: 0.3, knock: 140 }),
        makeBlade({ sprite: 'knightShield', off: Math.PI, rIn: b.r + 2, rOut: b.r + 16, w: 46, damage: undefined, parry: true }),
      ];
    },
    stats: (b) => [['剣', fmt(Math.round(b.w.dmg * 10) / 10)]],
    onHit(world, me) {
      me.w.dmg += 0.4;
    },
  },
  {
    id: 'conductor',
    kind: 'ranged',
    name: '指揮者',
    en: 'Conductor',
    color: '#1c2833',
    grow: '3回当たるたびに 音符 +1(まわりを回る音符を、指揮棒のリズムで1つずつ相手へ飛ばす)',
    init(b) {
      b.w = { n: 3, timer: 1, left: 0, gap: 0, t: 0 };
    },
    stats: (b) => [['音符', fmt(Math.floor(shown(b, 'n')))]],
    update(world, me, foe, dt) {
      const w = me.w;
      w.t += dt;
      me.angle = Math.sin(w.t * 8) * 0.6 - Math.PI / 2; // 指揮棒をふる
      if (w.left > 0) {
        w.gap -= dt;
        if (w.gap > 0) return;
        w.gap = 0.16;
        w.left--;
        const a = w.t * 2 + w.left;
        spawnProjectile(world, me, {
          x: me.x + Math.cos(a) * (me.r + 20),
          y: me.y + Math.sin(a) * (me.r + 20),
          vx: Math.cos(a) * 200,
          vy: Math.sin(a) * 200,
          kind: 'note',
          r: 8,
          life: 2.2,
          damage: 1.6,
          update: (world, p, owner, foe, dt) => homing(p, foe, 4, dt, 460),
          onTouch: hitOnce(),
        });
        return;
      }
      w.timer -= dt;
      if (w.timer > 0) return;
      w.timer = 2.2;
      w.left = Math.floor(w.n);
      w.gap = 0;
    },
    onHit(world, me) {
      growStat(me, 'n', 0.34, 7, 0.5);
    },
  },
  {
    id: 'ufo',
    kind: 'ranged',
    name: 'UFO',
    en: 'UFO',
    color: '#76d7c4',
    grow: '落とすたびに 落とす威力アップ(相手の上に来ると光線で吸い上げ、高い所から床へ落とす)',
    init(b) {
      b.w = { slamMul: 1, cd: 1, lift: 0, target: null, gun: 1 };
    },
    stats: (b) => [['落とす威力', '×' + fmt(Math.round(b.w.slamMul * 10) / 10)]],
    update(world, me, foe, dt) {
      const w = me.w;
      me.angle = Math.PI / 2;
      // 少しふわふわ浮く
      if (me.vy > 150) me.vy -= 500 * dt;
      if (w.lift > 0) {
        const o = w.target;
        w.lift -= dt;
        if (o && !o.dead) {
          o.vy = -700;
          o.vx = (me.x - o.x) * 3;
          o.stun = Math.max(o.stun, 0.05);
          if (w.lift <= 0) {
            // てっぺんから床へたたき落とす
            o.vy = 1300 * (o.knockMul ?? 1);
            o.slamT = 1.2;
            o.slamBy = me.id;
            landHit(world, me, o, 1.5, { kind: 'ufo', x: o.x, y: o.y });
          }
        }
        if (w.lift <= 0) w.cd = 2.6;
        return;
      }
      w.cd -= dt;
      if (w.cd <= 0 && me.y < foe.y - 30 && Math.abs(foe.x - me.x) < 130) {
        w.lift = 0.6;
        w.target = foe;
        world.events.push({ type: 'shock', x: foe.x, y: foe.y, r: 50, color: '#a3f7e6' });
      }
      // 吸い上げられないときは小さな光線
      w.gun -= dt;
      if (w.gun > 0) return;
      w.gun = 1.1;
      shoot(world, me, aimAt(me, foe), 520, { kind: 'laserbit', r: 4, life: 1.4, damage: 1.5, onTouch: hitOnce() });
    },
    onHit(world, me, foe, info) {
      if (info.kind === 'slam' || info.kind === 'ufo') me.w.slamMul += 0.06;
    },
  },
  {
    id: 'clown',
    kind: 'ranged',
    name: 'ピエロ',
    en: 'Clown',
    color: '#e74c3c',
    grow: '当たるたびに ピンのダメージ +0.25(ジャグリングのピンを投げる。4本目ごとにラッパでパフッ！とまわりをしびれさせる)',
    init(b) {
      b.w = { dmg: 2, timer: 0.6, count: 0, t: 0 };
    },
    stats: (b) => [['ピン', fmt(Math.round(b.w.dmg * 100) / 100)]],
    update(world, me, foe, dt) {
      const w = me.w;
      w.t += dt;
      me.angle = -Math.PI / 2;
      w.timer -= dt;
      if (w.timer > 0) return;
      w.timer = 0.65;
      w.count++;
      if (w.count % 4 === 0) {
        // パフッ！ まわりの相手をしびれさせる
        world.events.push({ type: 'shock', x: me.x, y: me.y, r: 160, color: '#f9e79f' });
        for (const o of world.balls) {
          if (o === me || o.dead || Math.hypot(o.x - me.x, o.y - me.y) > 160 + o.r) continue;
          if (landHit(world, me, o, 1, { kind: 'honk', x: o.x, y: o.y }) > 0) o.stun = Math.max(o.stun, 0.4);
        }
        return;
      }
      shoot(world, me, aimAt(me, foe) - 0.15, 640, { kind: 'pin', r: 7, life: 1.6, gravity: 0.3, damage: w.dmg, onTouch: hitOnce() });
    },
    onHit(world, me) {
      me.w.dmg += 0.25;
    },
  },
  // ===== 大器晩成: 最初は弱いが、当てるほど姿が変わって後半に化ける =====
  {
    id: 'egg',
    kind: 'body',
    name: 'たまご',
    en: 'Egg',
    color: '#f3e5c0',
    grow: '当てるたびに 経験 +1。3回で ひよこ → 8回で ニワトリ → 15回で ドラゴン(火をはく)に進化',
    init(b) {
      b.w = { stage: 0, xp: 0, dmg: 0.8, breath: 0, timer: 2, jump: 2 };
      setSpin(b, 2);
    },
    stats: (b) => [
      ['すがた', EGG_NAMES[b.w.stage]],
      ['ダメージ', fmt(Math.round(eggDamage(b) * 10) / 10)],
    ],
    update(world, me, foe, dt) {
      const w = me.w;
      if (w.stage === 0) return; // たまごは転がるだけ
      turnTo(me, aimAt(me, foe), dt, w.stage >= 3 ? 5 : 8);
      if (w.breath > 0) w.breath -= dt;
      if (w.stage === 2) {
        // ニワトリ: ときどき相手へ飛びかかる
        w.jump -= dt;
        if (w.jump <= 0) {
          w.jump = 2;
          const a = aimAt(me, foe);
          me.vx = Math.cos(a) * 520;
          me.vy = Math.sin(a) * 520 - 200;
        }
      }
      if (w.stage < 3) return;
      // ドラゴン: 前方に火をはく(扇形の中の相手全員)
      w.timer -= dt;
      if (w.timer > 0) return;
      w.timer = 2.2;
      w.breath = 0.35;
      for (const o of world.balls) {
        if (o === me || o.dead) continue;
        const d = Math.hypot(o.x - me.x, o.y - me.y);
        const diff = Math.abs(((aimAt(me, o) - me.angle + Math.PI) % TAU + TAU) % TAU - Math.PI);
        if (d > me.r + 170 + o.r || diff > 0.5) continue;
        if (landHit(world, me, o, eggDamage(me) * 1.2, { kind: 'breath', x: o.x, y: o.y }) > 0) {
          o.burnT = Math.max(o.burnT, 2);
          o.burnDps = Math.max(o.burnDps, 1);
          o.burnSrc = me.id;
        }
      }
    },
    onContact(world, me, foe) {
      // たまごの体当たり(ひよこ以降はくちばしで戦う)
      if (me.w.stage > 0) return;
      if (landHit(world, me, foe, me.w.dmg, { kind: 'egg', x: (me.x + foe.x) / 2, y: (me.y + foe.y) / 2 }) > 0) knockback(me, foe, 120);
    },
    onHit(world, me, foe) {
      const w = me.w;
      w.dmg += 0.08;
      if (!evolveStep(world, me, [2, 6, 12], EGG_NAMES)) return;
      me.color = ['#f3e5c0', '#ffd54f', '#fafafa', '#2e8b57'][w.stage];
      if (w.stage === 1) {
        setSpin(me, 0);
        me.blades = [makeBlade({ sprite: 'beak', rIn: me.r - 6, rOut: me.r + 18, w: 12, damage: (world, me) => eggDamage(me), cd: 0.35, knock: 120, parry: false })];
      } else if (w.stage === 2) {
        me.blades[0].rOut = me.r + 30;
        me.blades[0].knock = 220;
      } else if (w.stage === 3) {
        me.r = BALL_R * 1.2;
        me.blades[0].rIn = me.r - 6;
        me.blades[0].rOut = me.r + 40;
        me.blades[0].w = 16;
        me.blades[0].knock = 300;
      }
    },
  },
  {
    id: 'forge',
    kind: 'melee',
    name: '鍛冶の剣',
    en: 'Forge',
    color: '#b5651d',
    grow: '当てるたびに きたえる +1。木の棒 → 銅 → 鉄 → 鋼 → 伝説の剣(斬撃を飛ばす)と長く強くなる',
    init(b) {
      b.w = { stage: 0, xp: 0, bonus: 0, timer: 1.5 };
      setSpin(b, 3.6);
      b.blades = [makeBlade({ sprite: 'forge', rIn: 22, rOut: FORGE_LEN[0] + 26, w: 10, damage: (world, me) => forgeDamage(me) })];
    },
    stats: (b) => [
      ['剣', FORGE_NAMES[b.w.stage]],
      ['ダメージ', fmt(Math.round(forgeDamage(b) * 10) / 10)],
    ],
    update(world, me, foe, dt) {
      if (me.w.stage < 4) return;
      // 伝説の剣: 斬撃を飛ばす
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 1.6;
      shoot(world, me, aimAt(me, foe), 520, {
        kind: 'slash',
        r: 14,
        life: 1.6,
        damage: forgeDamage(me) * 0.6,
        onTouch: hitOnce(),
      });
    },
    onHit(world, me, foe, info) {
      if (info.kind !== 'melee' && info.kind !== 'slash') return;
      me.w.bonus += 0.25;
      if (evolveStep(world, me, needsFor(world, [2, 5, 9, 14], 1.7), FORGE_NAMES)) {
        me.blades[0].stage = me.w.stage;
        me.blades[0].rOut = FORGE_LEN[me.w.stage] + 26;
        me.blades[0].w = 10 + me.w.stage * 1.5;
      }
    },
  },
  {
    id: 'piggy',
    kind: 'body',
    name: '貯金箱',
    en: 'Piggy Bank',
    color: '#f5a3c0',
    grow: '体当たりのたびに 貯金が増え、1回に入る額もアップ。目標まで貯まると 大きな金貨をドカン！(目標も上がる)',
    init(b) {
      b.w = { coins: 0, rate: 1, goal: 6, cd: 0 };
    },
    stats: (b) => [
      ['貯金', `${Math.floor(b.w.coins)}/${Math.round(b.w.goal)}`],
      ['1回', '+' + fmt(Math.round(b.w.rate * 10) / 10)],
    ],
    update(world, me, foe) {
      me.angle = Math.atan2(me.vy, me.vx);
      const w = me.w;
      if (w.coins < w.goal) return;
      // 貯まった! 割って中身を大きな金貨にして投げる
      const sum = w.coins;
      w.coins = 0;
      w.goal *= 1.25;
      world.events.push({ type: 'evolve', target: me.id, x: me.x, y: me.y, text: 'パリーン！', color: '#d4ac0d' });
      shoot(world, me, aimAt(me, foe), 460, {
        kind: 'coin',
        r: Math.min(30, 10 + sum * 0.3),
        life: 2.5,
        wall: 'bounce',
        bounces: 2,
        blockable: false,
        damage: sum * 0.75,
        onTouch(world, p, owner, o) {
          p.dead = true;
          if (landHit(world, owner, o, p.damage, { kind: 'bigcoin', x: p.x, y: p.y }) > 0) knockback(p, o, 260 + p.r * 6);
        },
      });
    },
    onContact(world, me, foe) {
      if (me.w.cd > world.t) return;
      me.w.cd = world.t + 0.6;
      if (landHit(world, me, foe, 1, { kind: 'piggy', x: (me.x + foe.x) / 2, y: (me.y + foe.y) / 2 }) > 0) knockback(me, foe, 160);
    },
    onHit(world, me, foe, info) {
      if (info.kind !== 'piggy') return;
      me.w.coins += me.w.rate;
      me.w.rate += 0.6;
    },
  },
  {
    id: 'monk',
    kind: 'body',
    name: '修行僧',
    en: 'Monk',
    color: '#e67e22',
    grow: '当てるたびに 修行 +1でレベルアップ。Lv3 回し蹴り → Lv5 気功波 → Lv7 百裂拳 と技が増える',
    init(b) {
      b.w = { lv: 1, xp: 0, need: 2, timer: 2.5, rush: 0, rushCd: 3 };
      setSpin(b, 0);
      b.blades = [makeBlade({ sprite: 'fist', rIn: b.r - 4, rOut: b.r + 14, w: 14, damage: (world, me) => monkDamage(me), cd: 0.5, knock: 150, parry: false })];
    },
    stats: (b) => [
      ['レベル', 'Lv' + b.w.lv],
      ['技', MONK_SKILLS.filter(([lv]) => b.w.lv >= lv).pop()[1]],
    ],
    update(world, me, foe, dt) {
      const w = me.w;
      turnTo(me, aimAt(me, foe), dt, 10);
      const fist = me.blades[0];
      // 百裂拳: 近くにいる相手へ、目にもとまらぬ連打
      if (w.lv >= 7) {
        w.rushCd -= dt;
        if (w.rush > 0) w.rush -= dt;
        else if (w.rushCd <= 0 && Math.hypot(foe.x - me.x, foe.y - me.y) < me.r + foe.r + 50) {
          w.rush = 1;
          w.rushCd = 3.5;
        }
      }
      fist.cd = w.rush > 0 ? 0.08 : 0.5;
      fist.rOut = me.r + 14 + (w.rush > 0 ? Math.abs(Math.sin(world.t * 40)) * 20 : 0);
      if (w.lv < 5) return;
      w.timer -= dt;
      if (w.timer > 0) return;
      w.timer = 2.5;
      shoot(world, me, aimAt(me, foe), 420, {
        kind: 'kiball',
        r: 11 + Math.min(10, w.lv - 5),
        life: 2,
        damage: monkDamage(me) * 1.4,
        onTouch: hitOnce(),
      });
    },
    onHit(world, me) {
      const w = me.w;
      w.xp++;
      if (w.xp < w.need) return;
      w.xp = 0;
      w.lv++;
      w.need = Math.min(6, w.need + 1);
      const learn = MONK_SKILLS.find(([lv]) => lv === w.lv);
      world.events.push({ type: 'evolve', target: me.id, x: me.x, y: me.y, text: 'Lv' + w.lv + (learn ? ' ' + learn[1] : '') });
      if (w.lv === 3) me.blades.push(makeBlade({ sprite: 'leg', free: true, rot: 0, rIn: me.r - 4, rOut: me.r + 34, w: 14, damage: (world, me) => monkDamage(me) * 0.8, cd: 0.6, knock: 240, parry: false, block: false }));
    },
  },
  {
    id: 'pebble',
    kind: 'body',
    name: '転がる石',
    en: 'Rolling Stone',
    color: '#9e9e9e',
    grow: 'ぶつかるたびに 大きくなる。小石 → 石 → 岩 → 大岩 と、大きいほど重くて痛い体当たり',
    init(b) {
      b.w = { size: 0.6, stage: 0, cd: 0 };
      b.r = BALL_R * 0.6;
    },
    stats: (b) => [
      ['すがた', PEBBLE_NAMES[b.w.stage]],
      ['大きさ', '×' + fmt(Math.round(shown(b, 'size') * 100) / 100)],
    ],
    update(world, me, foe, dt) {
      me.angle += Math.hypot(me.vx, me.vy) * dt * 0.02 * Math.sign(me.vx || 1);
    },
    onContact(world, me, foe, rel) {
      if (me.w.cd > world.t) return;
      me.w.cd = world.t + 0.5;
      const s = me.w.size;
      const sp = Math.min(2, (rel || 300) / 300);
      if (landHit(world, me, foe, 3 * s * s * (0.6 + sp * 0.4), { kind: 'pebble', x: (me.x + foe.x) / 2, y: (me.y + foe.y) / 2 }) > 0) knockback(me, foe, 160 * s);
    },
    onHit(world, me) {
      growStat(me, 'size', 0.06, 1.8, 0.5);
      me.r = BALL_R * me.w.size;
      const stage = me.w.size < 0.9 ? 0 : me.w.size < 1.2 ? 1 : me.w.size < 1.5 ? 2 : 3;
      if (stage > me.w.stage) {
        me.w.stage = stage;
        world.events.push({ type: 'evolve', target: me.id, x: me.x, y: me.y, text: PEBBLE_NAMES[stage] });
      }
    },
  },
  {
    id: 'apprentice',
    kind: 'ranged',
    name: '見習い魔法使い',
    en: 'Apprentice',
    color: '#5e60ce',
    grow: '当てるたびに 魔力 +5%。経験がたまると 火花 → ファイア → アイス → サンダー → メテオ と呪文を覚える',
    init(b) {
      b.w = { stage: 0, xp: 0, mag: 1, timer: 1, cast: 0 };
      setSpin(b, 0);
    },
    stats: (b) => [
      ['呪文', b.w.stage + 1 + '種'],
      ['魔力', '×' + fmt(Math.round(b.w.mag * 100) / 100)],
    ],
    update(world, me, foe, dt) {
      const w = me.w;
      turnTo(me, aimAt(me, foe), dt, 8);
      w.timer -= dt;
      if (w.timer > 0) return;
      w.timer = 1;
      // 覚えた呪文を順番に唱える
      const spell = w.cast % (w.stage + 1);
      w.cast++;
      const a = aimAt(me, foe);
      const m = w.mag;
      if (spell === 0) {
        shoot(world, me, a, 420, { kind: 'spark', r: 7, hue: 50, life: 1.2, damage: 1.2 * m, onTouch: hitOnce() });
      } else if (spell === 1) {
        shoot(world, me, a, 400, {
          kind: 'fireball',
          r: 11,
          life: 2,
          damage: 3 * m,
          onTouch(world, p, owner, o) {
            p.dead = true;
            if (landHit(world, owner, o, p.damage, { kind: 'fireball', x: p.x, y: p.y }) <= 0) return;
            o.burnT = Math.max(o.burnT, 2);
            o.burnDps = Math.max(o.burnDps, 0.8 * m);
            o.burnSrc = owner.id;
          },
        });
      } else if (spell === 2) {
        shoot(world, me, a, 560, {
          kind: 'icicle',
          r: 8,
          life: 1.6,
          damage: 2.8 * m,
          onTouch(world, p, owner, o) {
            p.dead = true;
            if (landHit(world, owner, o, p.damage, { kind: 'icicle', x: p.x, y: p.y }) <= 0) return;
            o.slow = Math.max(o.slow, 0.5);
            o.slowT = Math.max(o.slowT, 1.5);
          },
        });
      } else if (spell === 3) {
        strike(world, me, foe.x + foe.vx * 0.3, foe.y + foe.vy * 0.3, 0.5, 0, true, m);
      } else {
        // メテオ: 相手の上から大きな隕石
        spawnProjectile(world, me, {
          x: Math.max(30, Math.min(ARENA - 30, foe.x + foe.vx * 0.4)),
          y: 30,
          vx: 0,
          vy: 520,
          kind: 'meteor',
          r: 22,
          life: 2.5,
          blockable: false,
          damage: 8 * m,
          onTouch(world, p, owner, o) {
            explode(world, p, owner, o, 90, p.damage, 'meteor');
          },
          onExpire(world, p, owner, o) {
            explode(world, p, owner, o, 90, p.damage, 'meteor');
          },
        });
      }
    },
    onHit(world, me) {
      me.w.mag += 0.15;
      evolveStep(world, me, [2, 4, 7, 11], APPRENTICE_SPELLS);
    },
  },
  {
    id: 'moon',
    kind: 'melee',
    name: '月の刃',
    en: 'Moon Blade',
    color: '#f7dc6f',
    grow: '3回当たるたびに 刃 +1。三日月 → 半月 → 満月(まわり全部が刃)と満ちていく。満月になると月光の波も出す',
    init(b) {
      b.w = { n: 1, hits: 0, dmg: 1, cd: 0, timer: 3, stage: 0 };
      setSpin(b, 3.2);
      moonBlades(b);
    },
    stats: (b) => [
      ['すがた', MOON_NAMES[b.w.stage]],
      ['刃', fmt(shown(b, 'n')) + '枚'],
    ],
    update(world, me, foe, dt) {
      if (me.w.stage < 3) return;
      // 満月: 月光の波
      me.w.timer -= dt;
      if (me.w.timer > 0) return;
      me.w.timer = 3;
      const R = me.r + 140;
      world.events.push({ type: 'shock', x: me.x, y: me.y, r: R, color: '#f7dc6f' });
      for (const o of world.balls) {
        if (o === me || o.dead || Math.hypot(o.x - me.x, o.y - me.y) > R + o.r) continue;
        if (landHit(world, me, o, me.w.dmg * 1.5, { kind: 'moonlight', x: o.x, y: o.y }) > 0) knockback(me, o, 260);
      }
    },
    onHit(world, me, foe, info) {
      const w = me.w;
      w.dmg += 0.06;
      w.hits++;
      if (w.hits % 3 !== 0) return;
      growStat(me, 'n', 1, 12, 0.5);
      moonBlades(me);
      const stage = w.n < 4 ? 0 : w.n < 8 ? 1 : w.n < 12 ? 2 : 3;
      if (stage > w.stage) {
        w.stage = stage;
        world.events.push({ type: 'evolve', target: me.id, x: me.x, y: me.y, text: MOON_NAMES[stage], color: '#c9a227' });
      }
    },
  },
  {
    id: 'ember',
    kind: 'body',
    name: '火種',
    en: 'Ember',
    color: '#ff8c42',
    grow: '燃やすたびに 炎が広がる。火種 → たき火 → 大火 → 業火 と、まわりを焼く炎がどんどん大きくなる',
    init(b) {
      b.w = { rad: 46, dmg: 0.5, tick: 0.4, stage: 0 };
    },
    stats: (b) => [
      ['すがた', EMBER_NAMES[b.w.stage]],
      ['炎', fmt(Math.round(shown(b, 'rad')))],
    ],
    update(world, me, foe, dt) {
      me.angle = -Math.PI / 2;
      const w = me.w;
      w.tick -= dt;
      if (w.tick > 0) return;
      w.tick = 0.4;
      const R = me.r + w.rad;
      for (const o of world.balls) {
        if (o === me || o.dead || Math.hypot(o.x - me.x, o.y - me.y) > R + o.r) continue;
        // 炎が大きいほど熱い
        landHit(world, me, o, w.dmg * (0.6 + shown(me, 'rad') / 75), { kind: 'ember', x: o.x, y: o.y });
      }
    },
    onHit(world, me) {
      const w = me.w;
      growStat(me, 'rad', 4, 150, 0.25);
      w.dmg += 0.06;
      const stage = w.rad < 70 ? 0 : w.rad < 100 ? 1 : w.rad < 130 ? 2 : 3;
      if (stage > w.stage) {
        w.stage = stage;
        world.events.push({ type: 'evolve', target: me.id, x: me.x, y: me.y, text: EMBER_NAMES[stage], color: '#e8481a' });
      }
    },
  },
  {
    id: 'seed',
    kind: 'melee',
    name: '種',
    en: 'Seed',
    color: '#7cb342',
    grow: '当てるたびに 育つ。種 → 芽 → つぼみ → 花(当てると回復) → 大樹(太い幹でなぎはらう)',
    init(b) {
      b.w = { stage: 0, xp: 0, bonus: 0 };
      setSpin(b, 3);
      b.blades = [makeBlade({ sprite: 'plant', rIn: b.r - 4, rOut: b.r + SEED_LEN[0], w: 10, damage: (world, me) => seedDamage(me), cd: 0.3, knock: 110 })];
    },
    stats: (b) => [
      ['すがた', SEED_NAMES[b.w.stage]],
      ['ダメージ', fmt(Math.round(seedDamage(b) * 10) / 10)],
    ],
    onHit(world, me, foe, info) {
      if (info.kind !== 'melee') return;
      const w = me.w;
      w.bonus += 0.25;
      if (w.stage >= 3) heal(world, me, w.stage >= 4 ? 1.6 : 1);
      if (evolveStep(world, me, needsFor(world, [2, 5, 9, 14], 1.7), SEED_NAMES)) {
        const bl = me.blades[0];
        bl.stage = w.stage;
        bl.rOut = me.r + SEED_LEN[w.stage];
        bl.w = w.stage >= 4 ? 22 : 10 + w.stage * 2;
        bl.knock = w.stage >= 4 ? 320 : 110 + w.stage * 30;
      }
    },
  },
  {
    id: 'hero',
    kind: 'body',
    name: '変身ヒーロー',
    en: 'Hero',
    color: '#d62828',
    grow: 'パンチが当たるか 攻撃を受けると 変身ゲージがたまる。たまると変身して 大きく・速く・強く。変身するたびに 変身の時間と強さアップ',
    init(b) {
      b.w = { gauge: 0, need: 4, on: 0, dur: 4, count: 0, cd: 0, taken: 0 };
      setSpin(b, 0);
      // 変身中だけ出る光の剣(ふだんは damage なし＝当たらない)
      b.blades = [makeBlade({ sprite: 'heroBeam', rIn: b.r - 4, rOut: b.r - 4, w: 12, damage: undefined, cd: 0.3, knock: 260, parry: false })];
    },
    stats: (b) => [
      ['ゲージ', b.w.on > 0 ? '変身中' : `${b.w.gauge}/${b.w.need}`],
      ['変身', fmt(Math.round(b.w.dur * 10) / 10) + '秒'],
    ],
    update(world, me, foe, dt) {
      const w = me.w;
      const bl = me.blades[0];
      if (w.on > 0) {
        w.on -= dt;
        me.angle += dt * 9;
        bl.rOut = me.r + 50;
        if (w.on <= 0) {
          // 変身がとける(次の変身は長くなる)
          w.dur += 0.7;
          me.r = BALL_R;
          me.speedMul = 1;
          bl.rIn = me.r - 4;
          bl.rOut = me.r - 4;
          bl.damage = undefined;
        }
        return;
      }
      turnTo(me, aimAt(me, foe), dt, 8);
      if (w.gauge < w.need) return;
      w.gauge = 0;
      w.on = w.dur;
      w.count++;
      me.r = BALL_R * 1.3;
      me.speedMul = 1.35;
      bl.rIn = me.r - 4;
      bl.damage = (world, me) => 3 + me.w.count * 1.2;
      world.events.push({ type: 'evolve', target: me.id, x: me.x, y: me.y, text: '変身！', color: '#d62828' });
    },
    onContact(world, me, foe) {
      if (me.w.cd > world.t) return;
      me.w.cd = world.t + (me.w.on > 0 ? 0.3 : 0.6);
      const dmg = me.w.on > 0 ? 4 + me.w.count * 1.5 : 1;
      if (landHit(world, me, foe, dmg, { kind: 'hero', x: (me.x + foe.x) / 2, y: (me.y + foe.y) / 2 }) > 0) knockback(me, foe, me.w.on > 0 ? 380 : 150);
    },
    // 攻撃を受けても ゲージがたまる(8ダメージで +1)
    onTakeDamage(world, me, src, amount) {
      const w = me.w;
      if (w.on > 0 || !src || src === me) return amount;
      w.taken += amount;
      while (w.taken >= 8) {
        w.taken -= 8;
        w.gauge++;
      }
      return amount;
    },
    onHit(world, me) {
      const w = me.w;
      if (w.on > 0) return;
      w.gauge++;
    },
  },
];

function grow(me) {
  growStat(me, 'width', 0.25, 7);
  me.w.reflect += 1;
  me.blades[0].w = me.w.width * 14;
}

// バランス調整: 武器ごとの与ダメージの倍率。総当たり(1組20試合)の勝率が50%に近づくように決めた。
// 成長のしかたは変えずに強さだけ合わせるためのもの。ここにない武器は1
export const TUNE = {
  spear: 1.09,
  axe: 1.09,
  katana: 1.05,
  scythe: 1.04,
  whip: 1.05,
  orbital: 0.94,
  flail: 1.12,
  bomb: 0.89,
  crossbow: 0.91,
  bow: 0.96,
  potion: 1.16,
  ice: 1.27,
  boomerang: 1.22,
  unarmed: 1.04,
  spike: 1.10,
  cluster: 1.16,
  mine: 0.88,
  meteor: 0.68,
  missile: 0.96,
  shuriken: 0.84,
  bees: 0.79,
  gatling: 0.91,
  flame: 0.95,
  gas: 1.10,
  dual: 0.89,
  dual: 0.89,
  blackhole: 1.05,
  fireworks: 1.09,
  laser: 0.93,
  slime: 1.40,
  tornado: 1.04,
  yoyo: 0.86,
  bats: 0.72,
  ricochet: 0.94,
  greatsword: 0.86,
  rocket: 1.18,
  sonic: 1.17,
  snowball: 1.18,
  clone: 0.92,
  curse: 1.08,
  blizzard: 1.15,
  hook: 1.06,
  snake: 0.86,
  squeaky: 0.89,
  dice: 0.91,
  javelin: 0.84,
  drill: 0.93,
  spellbook: 0.96,
  kusarigama: 1.09,
  sticky: 1.04,
  web: 0.91,
  clock: 1.05,
  vine: 0.94,
  revolver: 0.81,
  counter: 0.86,
  saber: 0.92,
  drones: 0.96,
  quake: 1.26,
  magnet: 1.10,
  star: 1.14,
  axethrow: 1.05,
  danmaku: 1.07,
  wrecking: 0.81,
  storm: 0.81,
  giant: 1.02,
  vampire: 0.92,
  spirit: 0.77,
  lava: 0.93,
  gears: 1.43,
  kamaitachi: 1.15,
  bumper: 0.80,
  prism: 1.14,
  ghost: 1.26,
  pinball: 0.88,
  splitter: 1.23,
  frog: 1.18,
  balloon: 1.26,
  cards: 0.80,
  skeleton: 1.39,
  firecracker: 1.05,
  urchin: 1.09,
  plasma: 1.15,
  chakram: 1.06,
  butterfly: 1.25,
  cannon: 0.82,
  charger: 0.75,
  lasso: 0.65,
  spring: 1.09,
  shadow: 0.89,
  swap: 0.71,
  tesla: 1.25,
  sniperRifle: 1.66,
  anvil: 0.99,
  rocketFist: 0.93,
  drum: 1.80,
  rewind: 1.38,
  bowling: 1.10,
  chainsaw: 1.23,
  kungfu: 0.83,
  sumo: 0.55,
  judo: 0.60,
  spinKick: 1.26,
  boxer: 0.62,
  palm: 0.61,
  lariat: 1.48,
  bearhug: 0.90,
  ironBody: 0.80,
  rush: 1.05,
  turtle: 1.80,
  scorpion: 0.79,
  octopus: 1.11,
  penguin: 1.76,
  chameleon: 1.71,
  frostCircle: 1.65,
  shrinkRay: 1.07,
  holyPillar: 1.34,
  golem: 0.73,
  windBarrier: 0.84,
  umbrella: 0.96,
  banana: 0.73,
  pie: 1.40,
  hammerThrow: 0.76,
  tsunami: 1.67,
  cactus: 1.61,
  iceSpike: 1.11,
  slot: 1.46,
  pingpong: 0.55,
  magician: 1.21,
  bubbleGum: 1.51,
  decoy: 0.84,
  robot: 1.43,
  iai: 0.73,
  knight: 1.80,
  conductor: 1.50,
  ufo: 0.58,
  clown: 1.41,
  forge: 1.42,
  piggy: 0.93,
  monk: 1.07,
  pebble: 1.09,
  apprentice: 1.03,
  moon: 0.62,
  ember: 1.12,
  seed: 1.68,
  hero: 0.93,
};

// 3人以上の試合だけで掛ける倍率。4人バトルロイヤルの1位率が25%に近づくように決めた
export const TUNE_FFA = {
  sword: 0.72,
  dagger: 0.62,
  spear: 0.58,
  axe: 0.58,
  hammer: 0.78,
  katana: 0.81,
  scythe: 1.13,
  whip: 0.63,
  trident: 0.72,
  scepter: 0.52,
  lance: 0.60,
  shield: 2.20,
  orb: 1.10,
  orbital: 0.85,
  flail: 0.92,
  bomb: 1.22,
  crossbow: 1.29,
  bow: 1.10,
  potion: 1.19,
  wand: 1.48,
  ice: 1.31,
  boomerang: 1.47,
  unarmed: 1.35,
  spike: 0.99,
  cluster: 1.29,
  mine: 1.05,
  meteor: 0.50,
  missile: 0.63,
  shuriken: 0.78,
  bees: 1.78,
  gatling: 1.31,
  lightning: 1.60,
  saw: 0.79,
  flame: 0.79,
  gas: 0.84,
  dual: 0.53,
  dual: 0.53,
  blackhole: 1.36,
  fireworks: 0.94,
  laser: 2.17,
  slime: 1.10,
  tornado: 1.20,
  yoyo: 1.47,
  bats: 0.91,
  ricochet: 1.04,
  greatsword: 0.60,
  rocket: 1.08,
  sonic: 1.09,
  snowball: 0.86,
  clone: 0.80,
  curse: 1.37,
  blizzard: 0.83,
  hook: 1.69,
  snake: 1.56,
  knives: 0.91,
  squeaky: 0.73,
  dice: 1.27,
  javelin: 1.09,
  drill: 0.55,
  spellbook: 2.02,
  water: 0.95,
  kusarigama: 0.50,
  mirror: 0.86,
  sticky: 1.14,
  web: 1.03,
  clock: 1.03,
  vine: 1.84,
  revolver: 1.31,
  shark: 1.15,
  copycat: 0.94,
  counter: 1.51,
  saber: 0.71,
  drones: 1.11,
  quake: 1.49,
  phoenix: 0.83,
  magnet: 1.01,
  star: 0.79,
  axethrow: 1.01,
  danmaku: 0.50,
  wrecking: 1.95,
  storm: 0.50,
  giant: 1.24,
  vampire: 0.50,
  spirit: 1.89,
  lava: 1.77,
  gears: 0.73,
  kamaitachi: 0.78,
  bumper: 0.84,
  prism: 1.59,
  ghost: 0.90,
  sakura: 0.69,
  pinball: 0.89,
  splitter: 1.62,
  frog: 0.72,
  balloon: 0.92,
  cards: 0.77,
  skeleton: 0.98,
  firecracker: 1.43,
  urchin: 0.50,
  plasma: 0.74,
  chakram: 1.57,
  butterfly: 0.88,
  cannon: 1.06,
  charger: 1.61,
  lasso: 1.77,
  timebomb: 1.73,
  spring: 0.82,
  shadow: 1.57,
  swap: 1.52,
  tesla: 0.64,
  sniperRifle: 1.30,
  anvil: 1.42,
  rocketFist: 1.61,
  drum: 0.91,
  rewind: 0.72,
  bowling: 1.19,
  chainsaw: 0.63,
  kungfu: 0.56,
  sumo: 1.12,
  judo: 1.25,
  spinKick: 1.05,
  boxer: 0.61,
  palm: 1.21,
  lariat: 0.70,
  bearhug: 1.37,
  ironBody: 0.74,
  rush: 1.02,
  turtle: 0.84,
  scorpion: 1.26,
  octopus: 0.64,
  penguin: 1.11,
  chameleon: 0.77,
  frostCircle: 1.80,
  shrinkRay: 1.50,
  holyPillar: 0.77,
  golem: 1.22,
  windBarrier: 0.96,
  umbrella: 0.91,
  banana: 1.30,
  pie: 1.48,
  hammerThrow: 1.06,
  tsunami: 0.61,
  cactus: 0.69,
  iceSpike: 1.66,
  slot: 0.71,
  pingpong: 1.69,
  magician: 1.10,
  bubbleGum: 1.26,
  decoy: 1.19,
  robot: 0.73,
  iai: 1.31,
  knight: 0.78,
  conductor: 1.34,
  ufo: 1.13,
  clown: 1.11,
  egg: 1.08,
  forge: 1.05,
  piggy: 1.14,
  monk: 0.91,
  pebble: 1.27,
  apprentice: 1.37,
  moon: 0.75,
  ember: 1.12,
  seed: 0.85,
  hero: 1.25,
};

for (const w of WEAPONS) {
  w.tune = TUNE[w.id] ?? 1;
  w.tuneFfa = TUNE_FFA[w.id] ?? 1;
}

export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

// 安全のため: どの武器も必要な項目を持っているか(テストでも使う)
export function validateWeapon(def) {
  const missing = ['id', 'name', 'en', 'color', 'grow', 'init', 'stats'].filter((k) => !def[k]);
  return missing;
}

export { ARENA };
