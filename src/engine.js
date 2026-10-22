// 対戦シミュレーション本体。DOMに依存しないので Node のテストからそのまま動かせる。
// 座標系: 1辺 ARENA の正方形フィールド。時間は秒。

export const ARENA = 600;
export const BALL_R = 36;
export const MAX_HP = 100;
export const BASE_SPEED = 180;
// 武器の回転速度にかける倍率(定義側の数値を読みやすく保つため)
export const SPIN_SCALE = 1.8;
export const DT = 1 / 120;
// 決着がつかないとき用: この時刻から与ダメージ倍率が少しずつ上がる
export const SUDDEN_DEATH_AT = 60;
// それでも終わらなければ残りHPの多い方の勝ち
export const HARD_LIMIT = 240;

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
  const ang = ball.angle + blade.off;
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
    vy: Math.sin(angle) * BASE_SPEED,
    r: BALL_R,
    hp: MAX_HP,
    maxHp: MAX_HP,
    angle: angle + Math.PI,
    spin: 4,
    speedMul: 1,
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

export function createBattle(defA, defB, seed = 1) {
  const rng = mulberry32(seed);
  const world = {
    t: 0,
    rng,
    seed,
    balls: [],
    projectiles: [],
    events: [],
    parryCd: 0,
    dmgMul: 1,
    over: false,
    winner: null, // 0 / 1 / -1(引き分け)
  };
  const jy = (rng() - 0.5) * 200;
  const a1 = rng() * Math.PI * 2;
  const a2 = rng() * Math.PI * 2;
  world.balls.push(makeBall(defA, 0, 150, ARENA / 2 + jy, a1));
  world.balls.push(makeBall(defB, 1, ARENA - 150, ARENA / 2 - jy, a2));
  world.balls[1].spin = -world.balls[1].spin;
  for (const b of world.balls) b.def.init(b, world);
  return world;
}

export function foeOf(world, ball) {
  return world.balls[1 - ball.id];
}

export function dealDamage(world, src, target, amount, opts = {}) {
  if (target.dead || world.over || !(amount > 0)) return 0;
  amount *= world.dmgMul;
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
    kind: opts.kind || 'hit',
  });
  if (src && src !== target && src.def.onDealDamage) src.def.onDealDamage(world, src, target, amount, opts);
  if (target.hp <= 0) {
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
    if (me.def.onHit) me.def.onHit(world, me, foe, info);
  }
  return dealt;
}

export function knockback(from, target, power) {
  let dx = target.x - from.x;
  let dy = target.y - from.y;
  const d = Math.hypot(dx, dy) || 1;
  dx /= d;
  dy /= d;
  target.vx += dx * power;
  target.vy += dy * power;
}

export function spawnProjectile(world, owner, p) {
  world.projectiles.push({
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
  });
}

function stepStatus(world, b, dt) {
  if (b.stun > 0) b.stun = Math.max(0, b.stun - dt);
  if (b.slowT > 0) {
    b.slowT -= dt;
    if (b.slowT <= 0) b.slow = 0;
  }
  if (b.flash > 0) b.flash -= dt;
  if (b.contactCd > 0) b.contactCd -= dt;
  b.dotTick += dt;
  if (b.dotTick >= 0.5) {
    b.dotTick -= 0.5;
    if (b.poison > 0) dealDamage(world, world.balls[b.poisonSrc] || null, b, b.poison * 0.5 * 0.5, { kind: 'poison' });
    if (b.burnT > 0) dealDamage(world, world.balls[b.burnSrc] || null, b, b.burnDps * 0.5, { kind: 'burn' });
  }
  if (b.burnT > 0) b.burnT -= dt;
}

// 進む向きを相手の方へ少しずつ曲げる(遠くから撃つ武器は控えめ)
function steer(b, foe, dt) {
  const rate = (b.def.chase ?? (b.def.kind === 'ranged' ? 0.5 : 3)) * dt;
  if (rate === 0) return;
  const cur = Math.atan2(b.vy, b.vx);
  const want = Math.atan2(foe.y - b.y, foe.x - b.x);
  const diff = ((want - cur + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  const turn = Math.max(-Math.abs(rate), Math.min(Math.abs(rate), diff)) * Math.sign(rate);
  const sp = Math.hypot(b.vx, b.vy);
  b.vx = Math.cos(cur + turn) * sp;
  b.vy = Math.sin(cur + turn) * sp;
}

function moveBall(b, dt) {
  const speed = Math.hypot(b.vx, b.vy) || 1;
  const slowF = 1 - b.slow;
  const target = BASE_SPEED * b.speedMul * slowF * (b.stun > 0 ? 0.6 : 1);
  // ノックバックで速くなっても徐々に基本速度へ戻す(止まりもしない)
  const k = Math.min(1, dt * 2.5);
  const next = speed + (target - speed) * k;
  b.vx *= next / speed;
  b.vy *= next / speed;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  if (b.x < b.r) {
    b.x = b.r;
    b.vx = Math.abs(b.vx);
  } else if (b.x > ARENA - b.r) {
    b.x = ARENA - b.r;
    b.vx = -Math.abs(b.vx);
  }
  if (b.y < b.r) {
    b.y = b.r;
    b.vy = Math.abs(b.vy);
  } else if (b.y > ARENA - b.r) {
    b.y = ARENA - b.r;
    b.vy = -Math.abs(b.vy);
  }
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
  for (const [me, foe] of [[a, b], [b, a]]) {
    if (me.def.onContact && me.contactCd <= 0 && me.stun <= 0) {
      me.contactCd = 0.3;
      me.def.onContact(world, me, foe, rel);
    }
  }
}

function meleeStep(world, me, foe, dt) {
  for (const bl of me.blades) {
    if (bl.cdLeft > 0) bl.cdLeft -= dt;
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
    const foe = foeOf(world, owner);
    p.age += dt;
    if (p.update) p.update(world, p, owner, foe, dt);
    if (p.dead) continue;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.age >= p.life) {
      if (p.onExpire) p.onExpire(world, p, owner, foe);
      p.dead = true;
      continue;
    }
    if (p.x < p.r || p.x > ARENA - p.r || p.y < p.r || p.y > ARENA - p.r) {
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
    if (p.blockable) {
      let blocked = false;
      for (const bl of foe.blades) {
        const s = bladeSegment(foe, bl);
        if (segPointDist(s[0], s[1], s[2], s[3], p.x, p.y) < p.r + bl.w / 2) {
          blocked = true;
          break;
        }
      }
      if (blocked) {
        p.dead = true;
        world.events.push({ type: 'block', x: p.x, y: p.y });
        if (foe.def.onBlock) foe.def.onBlock(world, foe, owner);
        continue;
      }
    }
    if (p.onTouch && Math.hypot(foe.x - p.x, foe.y - p.y) < foe.r + p.r) {
      p.onTouch(world, p, owner, foe);
    }
  }
  world.projectiles = world.projectiles.filter((p) => !p.dead);
}

export function step(world, dt = DT) {
  if (world.over) return;
  world.t += dt;
  if (world.t > SUDDEN_DEATH_AT) world.dmgMul = 1 + (world.t - SUDDEN_DEATH_AT) / 15;
  if (world.parryCd > 0) world.parryCd -= dt;
  const [a, b] = world.balls;
  for (const ball of world.balls) {
    const foe = foeOf(world, ball);
    stepStatus(world, ball, dt);
    if (ball.stun <= 0) {
      ball.angle += ball.spin * SPIN_SCALE * (1 - ball.slow) * dt;
      if (ball.def.update) ball.def.update(world, ball, foe, dt);
    }
    steer(ball, foe, dt);
    moveBall(ball, dt);
  }
  collideBalls(world, a, b);
  parryStep(world, a, b);
  meleeStep(world, a, b, dt);
  meleeStep(world, b, a, dt);
  projectileStep(world, dt);
  if (a.dead || b.dead) {
    world.over = true;
    world.winner = a.dead && b.dead ? -1 : a.dead ? 1 : 0;
  } else if (world.t >= HARD_LIMIT) {
    world.over = true;
    world.winner = a.hp === b.hp ? -1 : a.hp > b.hp ? 0 : 1;
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
