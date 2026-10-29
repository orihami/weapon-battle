// 対戦シミュレーション本体。DOMに依存しないので Node のテストからそのまま動かせる。
// 座標系: 1辺 ARENA の正方形フィールド。時間は秒。
// ボールは2個以上何個でもよい(バトルロイヤル)。それぞれ一番近い生きている相手を狙う。

// フィールドの広さ。試合ごとに createWorld が設定する(人数が多いと広くする)。
// 他のファイルからは import した ARENA がそのまま新しい値になる(ES Modules のライブバインディング)
export let ARENA = 600;
export const BASE_ARENA = 600;
export const BALL_R = 40;
export const MAX_HP = 100;
// 重力(下向き)。ボールは床と壁で跳ね返り、天井近くまで跳ね上がる
export const GRAVITY = 1000;
// 横方向の初速の目安(ステータス表示などでも使う「基準の速さ」)
export const BASE_SPEED = 300;
// 武器の回転速度にかける倍率(定義側の数値を読みやすく保つため)
export const SPIN_SCALE = 1.8;
export const DT = 1 / 120;
// 決着がつかないとき用: この時刻から与ダメージ倍率が少しずつ上がる
export const SUDDEN_DEATH_AT = 60;
// それでも終わらなければ残りHPの多い方の勝ち
export const HARD_LIMIT = 240;
// 逆境ブーストの強さ。HP差が最大HPの 1/COMEBACK_BOOST あると、当てるたびに成長が2回分になる
export const COMEBACK_BOOST = 4;
// 呪い1つあたり、受けるダメージが何割増えるか
export const CURSE_PER_STACK = 0.05;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function segPointDist(ax, ay, bx, by, px, py) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + dx * t - px;
  const cy = ay + dy * t - py;
  return Math.sqrt(cx * cx + cy * cy);
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

export function segSegDist(a, b) {
  // a, b: [x1, y1, x2, y2]
  const rX = a[2] - a[0];
  const rY = a[3] - a[1];
  const sX = b[2] - b[0];
  const sY = b[3] - b[1];
  const denom = cross(rX, rY, sX, sY);
  if (denom !== 0) {
    const qpX = b[0] - a[0];
    const qpY = b[1] - a[1];
    const t = cross(qpX, qpY, sX, sY) / denom;
    const u = cross(qpX, qpY, rX, rY) / denom;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return Math.min(
    segPointDist(a[0], a[1], a[2], a[3], b[0], b[1]),
    segPointDist(a[0], a[1], a[2], a[3], b[2], b[3]),
    segPointDist(b[0], b[1], b[2], b[3], a[0], a[1]),
    segPointDist(b[0], b[1], b[2], b[3], a[2], a[3]),
  );
}

// 武器の刃(線分)の両端をワールド座標で返す
export function bladeSegment(ball, blade) {
  // free: 武器とは別に自分で回る刃(スキルの追加の剣)。遠距離武器は相手の方を向き続けるので、武器の向きに付けると当たらない
  const ang = (blade.free ? blade.rot : ball.angle) + blade.off;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return [ball.x + c * blade.rIn, ball.y + s * blade.rIn, ball.x + c * blade.rOut, ball.y + s * blade.rOut];
}

export function makeBlade(o) {
  return { off: 0, rIn: 24, rOut: 90, w: 10, cd: 0.3, cdLeft: 0, knock: 120, parry: true, ...o };
}

function makeBall(def, id, x, y, angle) {
  return {
    id,
    def,
    x,
    y,
    vx: Math.cos(angle) * BASE_SPEED,
    vy: Math.sin(angle) * BASE_SPEED * 0.6,
    r: BALL_R,
    hp: MAX_HP,
    maxHp: MAX_HP,
    angle: angle + Math.PI,
    spin: 4,
    speedMul: 1,
    // 上限を超えて成長した分の与ダメージ倍率(weapons.js の growStat)
    power: 1,
    haste: 1,
    skills: [], // スキルカード { def, st }
    curse: 0,
    slamT: 0,
    gravFlip: 0,
    freeze: 0,
    slamBy: -1,
    blades: [],
    w: {},
    hits: 0,
    stun: 0,
    slow: 0,
    slowT: 0,
    burnT: 0,
    burnDps: 0,
    burnSrc: -1,
    poison: 0,
    poisonSrc: -1,
    dotTick: 0,
    contactCd: 0,
    flash: 0,
    dead: false,
  };
}

// 1対1の試合。opts: { a: 強化, b: 強化, size: フィールドの広さ }
//   強化 = { maxHp, preGrow(試合前に成長させる回数), power(与ダメージ倍率), speedMul(素早さ), skills(スキルカード) }
export function createBattle(defA, defB, seed = 1, opts = {}) {
  return createWorld([defA, defB], seed, [opts.a, opts.b], opts.size);
}

// 3人以上の同時バトル(バトルロイヤル)。boosts[i] は i 番目のボールの強化
// teams: ボールごとのチーム番号(ボス・レイドなど)。同じチームどうしは攻撃が当たらず、残ったチームが勝ち
export function createMelee(defs, seed = 1, { boosts = [], size, teams } = {}) {
  const world = createWorld(defs, seed, boosts, size ?? (defs.length > 2 ? 820 : BASE_ARENA), teams);
  return world;
}

function createWorld(defs, seed, boosts, size, teams) {
  ARENA = size || BASE_ARENA;
  const rng = mulberry32(seed);
  const world = {
    t: 0,
    rng,
    seed,
    size: ARENA,
    balls: [],
    projectiles: [],
    events: [],
    parryCd: 0,
    dmgMul: 1,
    over: false,
    winner: null, // 勝ったボールの番号 / -1(引き分け)
    outOrder: [], // 倒れた順(ボールの番号)
  };
  if (defs.length === 2) {
    const jy = (rng() - 0.5) * 200;
    const a1 = rng() * Math.PI * 2;
    const a2 = rng() * Math.PI * 2;
    world.balls.push(makeBall(defs[0], 0, ARENA * 0.25, ARENA / 2 + jy, a1));
    world.balls.push(makeBall(defs[1], 1, ARENA * 0.75, ARENA / 2 - jy, a2));
  } else {
    // 円の上に等間隔に並べる
    const base = rng() * Math.PI * 2;
    defs.forEach((def, i) => {
      const a = base + (i * Math.PI * 2) / defs.length;
      world.balls.push(makeBall(def, i, ARENA / 2 + Math.cos(a) * ARENA * 0.3, ARENA / 2 + Math.sin(a) * ARENA * 0.3, rng() * Math.PI * 2));
    });
  }
  world.balls.forEach((b) => b.id % 2 === 1 && (b.spin = -b.spin));
  if (teams) {
    world.teams = true;
    world.balls.forEach((b, i) => (b.team = teams[i]));
  }
  for (const b of world.balls) b.def.init(b, world);
  world.balls.forEach((b, i) => applyBoost(world, b, boosts[i] || {}));
  return world;
}

function applyBoost(world, b, o) {
  if (o.maxHp) b.maxHp = b.hp = o.maxHp;
  // スキルカード(同じものを何枚も持てる。1枚ごとに状態を持つ)
  for (const def of o.skills || []) {
    const sk = { def, st: {} };
    b.skills.push(sk);
    if (def.apply) def.apply(world, b, sk.st);
  }
  if (o.power) b.power *= o.power;
  if (o.speedMul) b.speedMul *= o.speedMul;
  if (o.preGrow && b.def.onHit) {
    // 試合前の成長。相手に付く効果(毒・気絶など)は消しておく
    const foe = foeOf(world, b);
    const saved = { poison: foe.poison, curse: foe.curse, stun: foe.stun, slow: foe.slow, freeze: foe.freeze, hp: foe.hp, maxHp: foe.maxHp, gravFlip: foe.gravFlip };
    const myHp = [b.hp, b.maxHp];
    for (let i = 0; i < o.preGrow; i++) b.def.onHit(world, b, foe, { kind: 'pre' });
    Object.assign(foe, saved);
    [b.hp, b.maxHp] = myHp;
    world.events.length = 0;
  }
}

// 同じチームの仲間か(チームがない試合では、いつも false)
export function ally(a, b) {
  return a.team !== undefined && a.team === b.team;
}

// ball が狙う相手: 一番近い生きている相手(いなければ誰か)
export function foeOf(world, ball) {
  const balls = world.balls;
  if (balls.length === 2) return balls[1 - ball.id];
  let best = null;
  let bestD = Infinity;
  for (const o of balls) {
    if (o === ball || o.dead || ally(o, ball)) continue;
    const d = (o.x - ball.x) ** 2 + (o.y - ball.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best || balls.find((o) => o !== ball && !ally(o, ball)) || balls.find((o) => o !== ball);
}

export function aliveOthers(world, ball) {
  return world.balls.filter((o) => o !== ball && !o.dead && !ally(o, ball));
}

export function dealDamage(world, src, target, amount, opts = {}) {
  if (target.dead || world.over || !(amount > 0)) return 0;
  // 仲間には当たらない
  if (src && src !== target && ally(src, target)) return 0;
  // erased: 消しゴムで消された分だけ与えるダメージが減る / rings: 輪投げの輪がはまっているほど受けるダメージが増える
  amount *= world.dmgMul * (src && src !== target ? src.power * (src.outMul ?? 1) * (1 - (src.erased || 0)) : 1);
  if (target.rings) amount *= 1 + target.rings * 0.05;
  // 武器ごとのバランス調整の倍率(weapons.js の TUNE。スキルのダメージには掛けない)
  // 3人以上の試合では、全員を巻き込める武器が強く、1人しかねらえない武器が弱くなるので別の倍率(TUNE_FFA)も掛ける(チーム戦はのぞく)
  if (src && src !== target && opts.kind !== 'skill') amount *= (src.def.tune ?? 1) * (world.balls.length > 2 && !world.teams ? (src.def.tuneFfa ?? 1) : 1);
  // 呪い: 重ねがけされた分だけ、どこから受けるダメージも増える
  amount *= 1 + target.curse * CURSE_PER_STACK;
  // スキル: 与えるダメージ・受けるダメージの補正
  if (src && src !== target) for (const sk of src.skills) if (sk.def.outgoing) amount = sk.def.outgoing(world, src, target, amount, opts, sk.st);
  for (const sk of target.skills) if (sk.def.incoming) amount = sk.def.incoming(world, target, src, amount, opts, sk.st);
  if (target.def.onTakeDamage) {
    const changed = target.def.onTakeDamage(world, target, src, amount, opts);
    if (changed !== undefined) amount = changed;
  }
  if (!(amount > 0)) return 0;
  target.hp -= amount;
  target.flash = 0.12;
  world.events.push({
    type: 'hit',
    x: opts.x ?? target.x,
    y: opts.y ?? target.y,
    amount,
    target: target.id,
    src: src ? src.id : -1,
    kind: opts.kind || 'hit',
  });
  if (src && src !== target && src.def.onDealDamage) src.def.onDealDamage(world, src, target, amount, opts);
  if (src && src !== target) for (const sk of src.skills) if (sk.def.afterDeal) sk.def.afterDeal(world, src, target, amount, opts, sk.st);
  if (target.hp <= 0) {
    // 倒れる直前に一度だけ生き返る武器(不死鳥)やスキル(根性)など
    for (const sk of target.skills) if (sk.def.lethal && sk.def.lethal(world, target, sk.st)) return amount;
    if (target.def.onLethal && target.def.onLethal(world, target)) return amount;
    target.hp = 0;
    target.dead = true;
  }
  return amount;
}

export function heal(world, ball, amount) {
  if (ball.dead || amount <= 0) return;
  const before = ball.hp;
  ball.hp = Math.min(ball.maxHp, ball.hp + amount);
  if (ball.hp > before) world.events.push({ type: 'heal', x: ball.x, y: ball.y, amount: ball.hp - before, target: ball.id });
}

// 攻撃が当たったときの共通処理: ダメージ → 武器の成長(onHit)
export function landHit(world, me, foe, amount, info = {}) {
  const dealt = dealDamage(world, me, foe, amount, info);
  if (dealt > 0) {
    me.hits++;
    if (me.def.onHit) {
      me.def.onHit(world, me, foe, info);
      // 逆境ブースト: HPで負けているほど、当てたときにもう一度成長しやすい(逆転が起きるように)
      // (最大HPがちがう場合もあるので、HPの割合で比べる)
      let extra = Math.max(0, foe.hp / foe.maxHp - me.hp / me.maxHp) * COMEBACK_BOOST;
      let surged = false;
      while (extra > 0 && !foe.dead) {
        if (extra >= 1 || world.rng() < extra) {
          me.def.onHit(world, me, foe, info);
          surged = true;
        }
        extra -= 1;
      }
      if (surged) world.events.push({ type: 'surge', x: me.x, y: me.y, target: me.id });
    }
    for (const sk of me.skills) if (sk.def.onHit && !foe.dead) sk.def.onHit(world, me, foe, info, sk.st);
  }
  return dealt;
}

export function knockback(from, target, power) {
  let dx = target.x - from.x;
  let dy = target.y - from.y;
  const d = Math.hypot(dx, dy) || 1;
  dx /= d;
  dy /= d;
  // knockMul: 吹き飛ばされにくさ(スキル「重い体」など。なければ1)
  const k = target.knockMul ?? 1;
  target.vx += dx * power * k;
  target.vy += dy * power * k;
}

export function spawnProjectile(world, owner, p) {
  const proj = {
    owner: owner.id,
    x: owner.x,
    y: owner.y,
    vx: 0,
    vy: 0,
    r: 5,
    damage: 1,
    life: 3,
    age: 0,
    angle: 0,
    blockable: true,
    wall: 'die',
    dead: false,
    ...p,
  };
  // スキルの効果: pierce = 刃で防がれない / shotScale = 弾の当たり判定が大きい
  if (owner.pierce) proj.blockable = false;
  if (owner.shotScale) proj.r *= owner.shotScale;
  world.projectiles.push(proj);
  // スキル「分裂弾」: 武器が1回撃つごとに、最初の動く弾の左右に同じ弾を extraShots 発ふやす
  // (武器の update の中で撃った弾だけ。弾から生まれた子弾や、置いて止まっている物はふやさない)
  if (world.shooter === owner && owner.extraShots > 0 && !world.shotCloned && (proj.vx || proj.vy)) {
    world.shotCloned = true;
    owner.cloneUsed = true;
    for (let i = 0; i < owner.extraShots; i++) {
      const side = i % 2 ? -1 : 1;
      const a = side * 0.22 * (1 + Math.floor(i / 2));
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const copy = { ...proj, vx: proj.vx * c - proj.vy * sn, vy: proj.vx * sn + proj.vy * c, angle: proj.angle + a };
      for (const k in copy) {
        if (Array.isArray(copy[k])) copy[k] = copy[k].slice();
        else if (copy[k] instanceof Set) copy[k] = new Set(copy[k]);
      }
      world.projectiles.push(copy);
    }
  }
}

function stepStatus(world, b, dt) {
  if (b.ringT > 0) {
    // 輪投げの輪は5秒ごとに1つ外れる
    b.ringT -= dt;
    if (b.ringT <= 0 && --b.rings > 0) b.ringT = 5;
  }
  if (b.stun > 0) b.stun = Math.max(0, b.stun - dt);
  if (b.gravFlip > 0) b.gravFlip -= dt;
  if (b.slowT > 0) {
    b.slowT -= dt;
    if (b.slowT <= 0) b.slow = 0;
  }
  if (b.flash > 0) b.flash -= dt;
  if (b.contactCd > 0) b.contactCd -= dt;
  b.dotTick += dt;
  if (b.dotTick >= 0.5) {
    b.dotTick -= 0.5;
    if (b.poison > 0) dealDamage(world, world.balls[b.poisonSrc] || null, b, b.poison * 0.3 * 0.5, { kind: 'poison' });
    if (b.burnT > 0) dealDamage(world, world.balls[b.burnSrc] || null, b, b.burnDps * 0.5, { kind: 'burn' });
  }
  if (b.burnT > 0) b.burnT -= dt;
}

// ボールの「元気さ」= 運動エネルギー + 位置エネルギー。
// ぶつかったりノックバックで増減しても、少しずつこの値へ戻す(ずっと跳ね続ける)
function targetEnergy(b) {
  const e0 = GRAVITY * (ARENA - 2 * b.r) * 0.92 + 0.5 * BASE_SPEED * BASE_SPEED * 0.5;
  return e0 * b.speedMul * b.speedMul;
}

function moveBall(b, dt) {
  // 氷で遅くなったボールは時間がゆっくり進む(軌道はそのまま)
  const f = dt * (1 - b.slow);
  const floorY = ARENA - b.r;
  const pe = GRAVITY * (floorY - b.y);
  const ke = 0.5 * (b.vx * b.vx + b.vy * b.vy);
  const wantKe = targetEnergy(b) - pe;
  // 重力が逆になっている間は元気さの調整をしない(天井へ落ちていく)
  if (b.gravFlip <= 0 && wantKe > 1 && ke > 1) {
    const k = Math.sqrt(wantKe / ke);
    const blend = 1 + (k - 1) * Math.min(1, dt * 1.2);
    b.vx *= blend;
    b.vy *= blend;
  }
  // 横に全く動かなくなると単調になるので、最低限の横速度を保つ
  const minVx = 90 * b.speedMul;
  if (Math.abs(b.vx) < minVx) b.vx += Math.sign(b.vx || 1) * Math.min(minVx - Math.abs(b.vx), 200 * dt);
  b.vy += GRAVITY * f * (b.gravFlip > 0 ? -1 : 1);
  b.x += b.vx * f;
  b.y += b.vy * f;
  // 壁にぶつかった勢い(壁ドンの判定に使う)
  let impact = 0;
  if (b.x < b.r) {
    b.x = b.r;
    impact = Math.max(impact, -b.vx);
    b.vx = Math.abs(b.vx);
  } else if (b.x > ARENA - b.r) {
    b.x = ARENA - b.r;
    impact = Math.max(impact, b.vx);
    b.vx = -Math.abs(b.vx);
  }
  if (b.y < b.r) {
    b.y = b.r;
    impact = Math.max(impact, -b.vy);
    b.vy = Math.abs(b.vy);
  } else if (b.y > floorY) {
    b.y = floorY;
    impact = Math.max(impact, b.vy);
    b.vy = -Math.abs(b.vy);
  }
  return impact;
}

// 吹き飛ばされて(slamT の間に)勢いよく壁に当たると、吹き飛ばした側の攻撃としてダメージ
function wallSlam(world, b, impact, dt) {
  if (b.slamT <= 0) return;
  b.slamT -= dt;
  if (impact < 420) return;
  b.slamT = 0;
  const src = world.balls[b.slamBy];
  world.events.push({ type: 'slam', x: b.x, y: b.y, target: b.id });
  landHit(world, src, b, (impact - 300) / 60 * (src.w.slamMul ?? 1), { kind: 'slam' });
}

function collideBalls(world, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const min = a.r + b.r;
  if (d >= min || d === 0) return;
  const nx = dx / d;
  const ny = dy / d;
  const overlap = min - d;
  a.x -= nx * overlap / 2;
  a.y -= ny * overlap / 2;
  b.x += nx * overlap / 2;
  b.y += ny * overlap / 2;
  const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (rel <= 0) return;
  a.vx -= rel * nx;
  a.vy -= rel * ny;
  b.vx += rel * nx;
  b.vy += rel * ny;
  world.events.push({ type: 'bump', x: a.x + nx * a.r, y: a.y + ny * a.r });
  if (ally(a, b)) return; // 仲間どうしはぶつかるだけ
  for (const [me, foe] of [[a, b], [b, a]]) {
    if (me.def.onContact && me.contactCd <= 0 && me.stun <= 0) {
      me.contactCd = 0.3;
      me.def.onContact(world, me, foe, rel);
    }
    for (const sk of me.skills) if (sk.def.contact) sk.def.contact(world, me, foe, sk.st);
  }
}

function meleeStep(world, me, foe, dt) {
  for (const bl of me.blades) {
    if (bl.cdLeft > 0) bl.cdLeft -= dt * me.haste;
  }
  if (me.stun > 0) return;
  for (const bl of me.blades) {
    if (bl.cdLeft > 0 || bl.damage === undefined) continue;
    const seg = bladeSegment(me, bl);
    const d = segPointDist(seg[0], seg[1], seg[2], seg[3], foe.x, foe.y);
    if (d < foe.r + bl.w / 2) {
      bl.cdLeft = bl.cd;
      const amount = typeof bl.damage === 'function' ? bl.damage(world, me, foe) : bl.damage;
      // 当たった位置(刃の上で相手に一番近い点のあたり)
      const hx = foe.x + (me.x - foe.x) * (foe.r / (Math.hypot(me.x - foe.x, me.y - foe.y) || 1));
      const hy = foe.y + (me.y - foe.y) * (foe.r / (Math.hypot(me.x - foe.x, me.y - foe.y) || 1));
      landHit(world, me, foe, amount, { kind: 'melee', blade: bl, x: hx, y: hy });
      knockback(me, foe, bl.knock);
    }
  }
}

function parryStep(world, a, b) {
  if (world.parryCd > 0) return;
  for (const ba of a.blades) {
    if (!ba.parry) continue;
    const sa = bladeSegment(a, ba);
    for (const bb of b.blades) {
      if (!bb.parry) continue;
      const sb = bladeSegment(b, bb);
      if (segSegDist(sa, sb) < (ba.w + bb.w) / 2) {
        world.parryCd = 0.15;
        a.spin = -a.spin;
        b.spin = -b.spin;
        knockback(a, b, 60);
        knockback(b, a, 60);
        world.events.push({ type: 'parry', x: (sa[2] + sb[2]) / 2, y: (sa[3] + sb[3]) / 2 });
        if (a.def.onParry) a.def.onParry(world, a, b);
        if (b.def.onParry) b.def.onParry(world, b, a);
        return;
      }
    }
  }
}

function projectileStep(world, dt) {
  for (const p of world.projectiles) {
    if (p.dead) continue;
    const owner = world.balls[p.owner];
    if (owner.dead) {
      // 倒れたボールの弾は消える(3人以上のとき)
      p.dead = true;
      continue;
    }
    const foe = foeOf(world, owner);
    p.age += dt;
    if (p.update) p.update(world, p, owner, foe, dt);
    if (p.dead) continue;
    if (p.gravity) p.vy += GRAVITY * p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.age >= p.life) {
      if (p.onExpire) p.onExpire(world, p, owner, foe);
      p.dead = true;
      continue;
    }
    if (p.x < p.r || p.x > ARENA - p.r || p.y < p.r || p.y > ARENA - p.r) {
      if (p.wall === 'bounce' && p.bounces !== undefined && --p.bounces < 0) {
        // 跳ね返れる回数を使い切った
        if (p.onExpire) p.onExpire(world, p, owner, foe);
        p.dead = true;
        continue;
      }
      if (p.wall === 'bounce') {
        if (p.x < p.r || p.x > ARENA - p.r) p.vx = -p.vx;
        if (p.y < p.r || p.y > ARENA - p.r) p.vy = -p.vy;
        p.x = Math.max(p.r, Math.min(ARENA - p.r, p.x));
        p.y = Math.max(p.r, Math.min(ARENA - p.r, p.y));
      } else if (p.wall === 'die') {
        if (p.onExpire) p.onExpire(world, p, owner, foe);
        p.dead = true;
        continue;
      } else {
        p.x = Math.max(p.r, Math.min(ARENA - p.r, p.x));
        p.y = Math.max(p.r, Math.min(ARENA - p.r, p.y));
      }
    }
    // 相手の刃に当たると防がれる
    // blockGrace: 撃ち返された直後の弾がすぐまた防がれて、無限に跳ね返り合わないようにする
    if (p.blockable && p.age > (p.blockGrace ?? 0)) {
      let blocker = null;
      for (const o of world.balls) {
        if (o === owner || o.dead || ally(o, owner)) continue;
        for (const bl of o.blades) {
          if (bl.block === false) continue; // スキルの追加の剣などは弾を防がない
          const s = bladeSegment(o, bl);
          if (segPointDist(s[0], s[1], s[2], s[3], p.x, p.y) < p.r + bl.w / 2) {
            blocker = o;
            break;
          }
        }
        if (blocker) break;
      }
      if (blocker) {
        p.dead = true;
        world.events.push({ type: 'block', x: p.x, y: p.y });
        if (p.onBlocked) p.onBlocked(world, p, owner, blocker);
        if (blocker.def.onBlock) blocker.def.onBlock(world, blocker, owner, p);
        continue;
      }
    }
    if (p.onTouch) {
      for (const o of world.balls) {
        if (o === owner || o.dead || ally(o, owner)) continue;
        if (Math.hypot(o.x - p.x, o.y - p.y) < o.r + p.r) {
          p.onTouch(world, p, owner, o);
          if (p.dead) break;
        }
      }
    }
  }
  world.projectiles = world.projectiles.filter((p) => !p.dead);
}

export function step(world, dt = DT) {
  ARENA = world.size;
  if (world.over) return;
  world.t += dt;
  if (world.t > SUDDEN_DEATH_AT) world.dmgMul = 1 + (world.t - SUDDEN_DEATH_AT) / 15;
  if (world.parryCd > 0) world.parryCd -= dt;
  const balls = world.balls;
  for (const ball of balls) {
    if (ball.dead) continue;
    const foe = foeOf(world, ball);
    stepStatus(world, ball, dt);
    if (ball.stun <= 0) {
      // haste: 攻撃速度(スキル)。回転も武器の発射間隔も速くなる
      ball.angle += ball.spin * SPIN_SCALE * (1 - ball.slow) * ball.haste * dt;
      for (const bl of ball.blades) if (bl.free) bl.rot += Math.sign(ball.spin || 1) * 3 * SPIN_SCALE * (1 - ball.slow) * ball.haste * dt;
      if (ball.def.update) {
        world.shooter = ball;
        world.shotCloned = false;
        ball.def.update(world, ball, foe, dt * ball.haste);
        world.shooter = null;
      }
    }
    for (const sk of ball.skills) if (sk.def.update) sk.def.update(world, ball, foe, dt, sk.st);
    // 時間停止中はその場で止まる
    if (ball.freeze > 0) ball.freeze -= dt;
    else wallSlam(world, ball, moveBall(ball, dt), dt);
  }
  // すべての組み合わせで、ぶつかり・受け流し・刃の当たりを調べる
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const a = balls[i];
      const b = balls[j];
      if (a.dead || b.dead) continue;
      collideBalls(world, a, b);
      if (ally(a, b)) continue;
      parryStep(world, a, b);
      meleeStep(world, a, b, dt);
      meleeStep(world, b, a, dt);
    }
  }
  projectileStep(world, dt);
  // 倒れたボールを記録
  for (const b of balls) {
    if (b.dead && !world.outOrder.includes(b.id)) {
      world.outOrder.push(b.id);
      world.events.push({ type: 'out', target: b.id, x: b.x, y: b.y });
    }
  }
  const alive = balls.filter((b) => !b.dead);
  if (world.teams) {
    // チーム戦: 生き残ったチームが1つになったら決着(時間切れは引き分け)
    const left = new Set(alive.map((b) => b.team));
    if (left.size <= 1 || world.t >= HARD_LIMIT) {
      world.over = true;
      world.winTeam = left.size === 1 ? alive[0].team : -1;
      world.winner = left.size === 1 ? alive[0].id : -1;
    }
  } else if (alive.length <= 1) {
    world.over = true;
    world.winner = alive.length === 1 ? alive[0].id : -1;
  } else if (world.t >= HARD_LIMIT) {
    world.over = true;
    // 時間切れ: HPの割合がいちばん多い人の勝ち
    const ratio = (b) => b.hp / b.maxHp;
    alive.sort((x, y) => ratio(y) - ratio(x));
    world.winner = ratio(alive[0]) === ratio(alive[1]) ? -1 : alive[0].id;
  }
  if (world.over) world.events.push({ type: 'end', winner: world.winner });
}

// テストや勝率計算用: 決着まで回す
export function runToEnd(world, maxSteps = Math.ceil(HARD_LIMIT / DT) + 10) {
  for (let i = 0; i < maxSteps && !world.over; i++) {
    step(world);
    world.events.length = 0;
  }
  return world;
}
