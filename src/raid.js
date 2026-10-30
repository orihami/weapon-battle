// ボス・レイド: 2〜4人が協力して、巨大なボス1体と戦う(同じチームどうしは攻撃が当たらない)。
// ボスはHPが減ると技が増え(第2形態)、最後は怒って速くなる。
// 勝つと全員がカードを1枚選び、ボスのレベルが上がって次のボスへ。負けたら終わり。
// DOMに依存しないので Node のテストから使える。

import { ARENA, BALL_R, ally, foeOf, landHit, knockback, spawnProjectile, segPointDist } from './engine.js?v=57ad6f5';
import { makeOffer, addSkills } from './skills.js?v=57ad6f5';

const TAU = Math.PI * 2;

// ボスのHP(1人あたりの目安)と、強さの段階
export const BOSS_HP = 260;
export const TREASURE_EVERY = 3;
export const DIFFICULTY = {
  easy: { name: 'かんたん', hp: 0.75, power: 0.8 },
  normal: { name: 'ふつう', hp: 1, power: 1 },
  hard: { name: 'むずかしい', hp: 1.15, power: 1.15 },
};

const aim = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
const foes = (world, me) => world.balls.filter((o) => o !== me && !o.dead && !ally(o, me));

// 形態: HP 2/3 まで第1形態、1/3 まで第2形態、そのあと怒り
function phaseOf(me) {
  const k = me.hp / me.maxHp;
  return k > 0.66 ? 0 : k > 0.33 ? 1 : 2;
}

// ボス共通: 形態が変わったら知らせる。怒ると速くなる
function stepPhase(world, me) {
  const p = phaseOf(me);
  if (p <= me.w.phase) return;
  me.w.phase = p;
  if (p === 2) me.speedMul *= 1.3;
  world.events.push({ type: 'evolve', target: me.id, x: me.x, y: me.y, text: p === 1 ? '第2形態！' : '怒り！', color: '#c01f1f' });
  // 怒ったとき、倒れた仲間がHP25%で1度だけ復活する(最後まで全員で戦えるように)
  if (p < 2) return;
  for (const o of world.balls) {
    if (!o.dead || ally(o, me)) continue;
    o.dead = false;
    o.hp = o.maxHp * 0.25;
    o.x = Math.max(o.r, Math.min(ARENA - o.r, ARENA / 2 + (world.rng() - 0.5) * ARENA * 0.6));
    o.y = o.r + 20;
    o.vx = 0;
    o.vy = 0;
    world.events.push({ type: 'evolve', target: o.id, x: o.x, y: o.y, text: '復活！', color: '#2fa84f' });
  }
}

// 怒り中は技の間隔が短くなる
const pace = (me, t) => (me.w.phase >= 2 ? t * 0.7 : t);

// ボスの刃の回る速さ(engine の spin と同じ向きのきまり)
function setBossSpin(b, v) {
  b.spin = Math.sign(b.spin || 1) * v;
}

function bossBase(b, r, speed) {
  b.r = BALL_R * r;
  b.speedMul = speed;
  b.knockMul = 0.3;
  b.w = { phase: 0, cd: 0, t: 0 };
}

function bossContact(dmg) {
  return (world, me, foe) => {
    if (me.w.cd > world.t) return;
    me.w.cd = world.t + 0.6;
    if (landHit(world, me, foe, dmg, { kind: 'boss', x: foe.x, y: foe.y }) > 0) knockback(me, foe, 380);
  };
}

// まわりの相手全員に衝撃
function shockwave(world, me, R, dmg, knock, color) {
  world.events.push({ type: 'shock', x: me.x, y: me.y, r: R, color });
  for (const o of foes(world, me)) {
    if (Math.hypot(o.x - me.x, o.y - me.y) > R + o.r) continue;
    if (landHit(world, me, o, dmg, { kind: 'boss', x: o.x, y: o.y }) > 0) knockback(me, o, knock);
  }
}

// 予告のあと (x, y) に雷
function bolt(world, me, x, y, delay, dmg) {
  spawnProjectile(world, me, {
    x,
    y,
    kind: 'zap',
    r: 46,
    life: delay,
    wall: 'stop',
    blockable: false,
    onExpire(world, p, owner) {
      world.events.push({ type: 'zap', x: p.x, y: p.y, big: true });
      for (const o of foes(world, owner)) {
        if (Math.hypot(o.x - p.x, o.y - p.y) >= p.r + o.r) continue;
        landHit(world, owner, o, dmg, { kind: 'zap', x: o.x, y: o.y });
        o.stun = Math.max(o.stun, 0.1);
      }
    },
  });
}

export const BOSSES = [
  {
    id: 'slimeKing',
    kind: 'boss',
    name: 'スライムキング',
    en: 'Slime King',
    color: '#5fbf3f',
    grow: '飛び上がってのしかかる。第2形態でスライムの輪、怒ると速くなる',
    init(b) {
      bossBase(b, 2, 0.7);
      b.w.jump = 3;
      b.w.ring = 4;
      b.w.air = false;
    },
    stats: (b) => [['形態', ['第1', '第2', '怒り'][b.w.phase]]],
    update(world, me, foe, dt) {
      const w = me.w;
      stepPhase(world, me);
      me.angle = aim(me, foe);
      // のしかかり: 飛び上がって、着地したら衝撃
      if (w.air && me.vy >= 0 && me.y >= ARENA - me.r - 4) {
        w.air = false;
        world.events.push({ type: 'quake', x: me.x, y: ARENA });
        shockwave(world, me, me.r + 120, 6, 420, '#5fbf3f');
      }
      w.jump -= dt;
      if (w.jump <= 0) {
        w.jump = pace(me, 4);
        w.air = true;
        me.vx = Math.cos(aim(me, foe)) * 380;
        me.vy = -760;
      }
      if (w.phase < 1) return;
      w.ring -= dt;
      if (w.ring > 0) return;
      w.ring = pace(me, 5);
      for (let i = 0; i < 8; i++) {
        const a = (i * TAU) / 8 + world.t;
        spawnProjectile(world, me, {
          x: me.x + Math.cos(a) * me.r,
          y: me.y + Math.sin(a) * me.r,
          vx: Math.cos(a) * 260,
          vy: Math.sin(a) * 260,
          kind: 'slime',
          r: 11,
          life: 2.4,
          wall: 'bounce',
          bounces: 1,
          blockable: true,
          onTouch(world, p, owner, o) {
            p.dead = true;
            landHit(world, owner, o, 3, { kind: 'boss', x: p.x, y: p.y });
            o.slow = Math.max(o.slow, 0.3);
            o.slowT = Math.max(o.slowT, 1);
          },
        });
      }
    },
    onContact: bossContact(3),
  },
  {
    id: 'fortress',
    kind: 'boss',
    name: '機械要塞',
    en: 'Iron Fortress',
    color: '#7f8c8d',
    grow: '回る光線でなぎはらう。第2形態で追尾ミサイル、怒ると光線が3本に',
    init(b) {
      bossBase(b, 2, 0.5);
      b.w.beamA = 0;
      b.w.missile = 3;
      b.w.next = {};
    },
    stats: (b) => [['形態', ['第1', '第2', '怒り'][b.w.phase]]],
    update(world, me, foe, dt) {
      const w = me.w;
      stepPhase(world, me);
      w.beamA += dt * (w.phase >= 2 ? 1 : 0.7);
      me.angle = w.beamA;
      const n = w.phase + 1;
      for (let k = 0; k < n; k++) {
        const a = w.beamA + (k * TAU) / n;
        const ex = me.x + Math.cos(a) * 1300;
        const ey = me.y + Math.sin(a) * 1300;
        for (const o of foes(world, me)) {
          if ((w.next[o.id] ?? 0) > world.t || segPointDist(me.x, me.y, ex, ey, o.x, o.y) > o.r + 12) continue;
          w.next[o.id] = world.t + 0.7;
          landHit(world, me, o, 1.5, { kind: 'beam', x: o.x, y: o.y });
        }
      }
      if (w.phase < 1) return;
      w.missile -= dt;
      if (w.missile > 0) return;
      w.missile = pace(me, 4);
      for (let i = -1; i <= 1; i++) {
        const a = aim(me, foe) + i * 0.6;
        spawnProjectile(world, me, {
          x: me.x + Math.cos(a) * (me.r + 10),
          y: me.y + Math.sin(a) * (me.r + 10),
          vx: Math.cos(a) * 300,
          vy: Math.sin(a) * 300,
          angle: a,
          kind: 'missile',
          r: 8,
          life: 3,
          update(world, p, owner, target, dt) {
            const t = foeOf(world, { ...owner, x: p.x, y: p.y, id: owner.id });
            const want = Math.atan2(t.y - p.y, t.x - p.x);
            const cur = Math.atan2(p.vy, p.vx);
            const diff = ((want - cur + Math.PI) % TAU + TAU) % TAU - Math.PI;
            const na = cur + Math.max(-2.4 * dt, Math.min(2.4 * dt, diff));
            p.vx = Math.cos(na) * 330;
            p.vy = Math.sin(na) * 330;
            p.angle = na;
          },
          onTouch(world, p, owner, o) {
            p.dead = true;
            world.events.push({ type: 'boom', x: p.x, y: p.y, radius: 40, kind: 'missile' });
            landHit(world, owner, o, 3.5, { kind: 'boss', x: p.x, y: p.y });
          },
        });
      }
    },
    onContact: bossContact(2),
  },
  {
    id: 'dragonLord',
    kind: 'boss',
    name: '竜王',
    en: 'Dragon Lord',
    color: '#c0392b',
    grow: '前に火をはく。第2形態で隕石を降らせ、怒ると突進してくる',
    init(b) {
      bossBase(b, 1.9, 0.75);
      b.w.breath = 2;
      b.w.fire = 0;
      b.w.meteor = 4;
      b.w.charge = 3;
    },
    stats: (b) => [['形態', ['第1', '第2', '怒り'][b.w.phase]]],
    update(world, me, foe, dt) {
      const w = me.w;
      stepPhase(world, me);
      if (w.fire > 0) w.fire -= dt;
      else me.angle += ((((aim(me, foe) - me.angle + Math.PI) % TAU) + TAU) % TAU - Math.PI) * Math.min(1, dt * 4);
      w.breath -= dt;
      if (w.breath <= 0) {
        w.breath = pace(me, 3);
        w.fire = 0.4;
        for (const o of foes(world, me)) {
          const d = Math.hypot(o.x - me.x, o.y - me.y);
          const diff = Math.abs(((aim(me, o) - me.angle + Math.PI) % TAU + TAU) % TAU - Math.PI);
          if (d > me.r + 230 + o.r || diff > 0.5) continue;
          if (landHit(world, me, o, 5, { kind: 'breath', x: o.x, y: o.y }) <= 0) continue;
          o.burnT = Math.max(o.burnT, 2);
          o.burnDps = Math.max(o.burnDps, 1.2);
          o.burnSrc = me.id;
        }
      }
      if (w.phase >= 1) {
        w.meteor -= dt;
        if (w.meteor <= 0) {
          w.meteor = pace(me, 5);
          for (const o of foes(world, me)) {
            spawnProjectile(world, me, {
              x: Math.max(30, Math.min(ARENA - 30, o.x + o.vx * 0.5)),
              y: 30,
              vx: 0,
              vy: 420,
              kind: 'meteor',
              r: 18,
              life: 3,
              blockable: false,
              onTouch(world, p, owner, t) {
                p.dead = true;
                world.events.push({ type: 'boom', x: p.x, y: p.y, radius: 60, kind: 'meteor' });
                landHit(world, owner, t, 5, { kind: 'boss', x: p.x, y: p.y });
              },
            });
          }
        }
      }
      if (w.phase < 2) return;
      w.charge -= dt;
      if (w.charge > 0) return;
      w.charge = 3;
      const a = aim(me, foe);
      me.vx = Math.cos(a) * 820;
      me.vy = Math.sin(a) * 820;
    },
    onContact: bossContact(3),
  },
  {
    id: 'thunderGiant',
    kind: 'boss',
    name: '雷の巨人',
    en: 'Thunder Giant',
    color: '#5d6d7e',
    grow: '全員の足元に雷を落とす。第2形態でまわりに放電、怒ると雷が2本ずつに',
    init(b) {
      bossBase(b, 2.1, 0.6);
      b.w.bolt = 2;
      b.w.ring = 3;
    },
    stats: (b) => [['形態', ['第1', '第2', '怒り'][b.w.phase]]],
    update(world, me, foe, dt) {
      const w = me.w;
      stepPhase(world, me);
      me.angle = aim(me, foe);
      w.bolt -= dt;
      if (w.bolt <= 0) {
        w.bolt = pace(me, 2.6);
        for (const o of foes(world, me)) {
          bolt(world, me, o.x + o.vx * 0.3, o.y + o.vy * 0.3, 0.6, 4);
          if (w.phase >= 2) bolt(world, me, o.x - o.vx * 0.2 + 60, o.y, 0.8, 4);
        }
      }
      if (w.phase < 1) return;
      w.ring -= dt;
      if (w.ring > 0) return;
      w.ring = pace(me, 4);
      shockwave(world, me, me.r + 150, 4, 360, '#aed6f1');
    },
    onContact: bossContact(3),
  },
  {
    id: 'shadowNinja',
    kind: 'boss',
    name: '影の忍者王',
    en: 'Shadow Ninja King',
    color: '#2c2c54',
    grow: '相手の背後へ瞬間移動して斬る。第2形態で手裏剣、怒ると移動が速くなる',
    init(b) {
      bossBase(b, 1.6, 1);
      b.w.warp = 2;
      b.w.star = 3;
    },
    stats: (b) => [['形態', ['第1', '第2', '怒り'][b.w.phase]]],
    update(world, me, foe, dt) {
      const w = me.w;
      stepPhase(world, me);
      me.angle = aim(me, foe);
      w.warp -= dt;
      if (w.warp <= 0) {
        w.warp = pace(me, 3.2);
        // ねらう相手は毎回ちがう人(いちばん近いとはかぎらない)
        const list = foes(world, me);
        const t = list[Math.floor(world.rng() * list.length)] || foe;
        const sp = Math.hypot(t.vx, t.vy) || 1;
        world.events.push({ type: 'shock', x: me.x, y: me.y, r: 50, color: '#2c2c54' });
        me.x = Math.max(me.r, Math.min(ARENA - me.r, t.x - (t.vx / sp) * (me.r + 50)));
        me.y = Math.max(me.r, Math.min(ARENA - me.r, t.y - (t.vy / sp) * (me.r + 50)));
        me.vx = 0;
        me.vy = 0;
        world.events.push({ type: 'iai', x: me.x, y: me.y });
        shockwave(world, me, me.r + 50, 3.5, 300, '#6c5ce7');
      }
      if (w.phase < 1) return;
      w.star -= dt;
      if (w.star > 0) return;
      w.star = pace(me, 3);
      const a0 = aim(me, foe);
      for (let i = -2; i <= 2; i++) {
        const a = a0 + i * 0.22;
        spawnProjectile(world, me, {
          x: me.x + Math.cos(a) * me.r,
          y: me.y + Math.sin(a) * me.r,
          vx: Math.cos(a) * 520,
          vy: Math.sin(a) * 520,
          angle: a,
          kind: 'shuriken',
          r: 8,
          life: 1.6,
          onTouch(world, p, owner, o) {
            p.dead = true;
            landHit(world, owner, o, 2, { kind: 'boss', x: p.x, y: p.y });
          },
        });
      }
    },
    onContact: bossContact(3),
  },
  {
    id: 'iceQueen',
    kind: 'boss',
    name: '氷の女王',
    en: 'Ice Queen',
    color: '#85c1e9',
    grow: '全員へ氷の矢。第2形態でまわりを凍らせる冷気、怒るとふぶきで全員が遅くなる',
    init(b) {
      bossBase(b, 1.8, 0.65);
      b.w.shard = 1.5;
      b.w.nova = 4;
    },
    stats: (b) => [['形態', ['第1', '第2', '怒り'][b.w.phase]]],
    update(world, me, foe, dt) {
      const w = me.w;
      stepPhase(world, me);
      me.angle = aim(me, foe);
      // 怒り: ふぶきで全員が少し遅くなる
      if (w.phase >= 2) for (const o of foes(world, me)) o.slow = Math.max(o.slow, 0.25);
      w.shard -= dt;
      if (w.shard <= 0) {
        w.shard = pace(me, 3);
        for (const o of foes(world, me)) {
          const a = aim(me, o);
          spawnProjectile(world, me, {
            x: me.x + Math.cos(a) * me.r,
            y: me.y + Math.sin(a) * me.r,
            vx: Math.cos(a) * 560,
            vy: Math.sin(a) * 560,
            angle: a,
            kind: 'icicle',
            r: 9,
            life: 2,
            onTouch(world, p, owner, t) {
              p.dead = true;
              if (landHit(world, owner, t, 3, { kind: 'boss', x: p.x, y: p.y }) <= 0) return;
              t.slow = Math.max(t.slow, 0.4);
              t.slowT = Math.max(t.slowT, 1.2);
            },
          });
        }
      }
      if (w.phase < 1) return;
      w.nova -= dt;
      if (w.nova > 0) return;
      w.nova = pace(me, 5);
      const R = me.r + 170;
      world.events.push({ type: 'shock', x: me.x, y: me.y, r: R, color: '#d6eaf8' });
      for (const o of foes(world, me)) {
        if (Math.hypot(o.x - me.x, o.y - me.y) > R + o.r) continue;
        if (landHit(world, me, o, 3, { kind: 'boss', x: o.x, y: o.y }) > 0) o.freeze = Math.max(o.freeze, 0.7);
      }
    },
    onContact: bossContact(2.5),
  },
  {
    id: 'venomSerpent',
    kind: 'boss',
    name: '毒の大蛇',
    en: 'Venom Serpent',
    color: '#27ae60',
    grow: 'かみついて毒。第2形態で毒の沼を作り、怒ると毒のつばも飛ばす',
    init(b) {
      bossBase(b, 1.8, 0.9);
      b.w.bite = 2;
      b.w.pool = 4;
      b.w.spit = 3;
    },
    stats: (b) => [['形態', ['第1', '第2', '怒り'][b.w.phase]]],
    update(world, me, foe, dt) {
      const w = me.w;
      stepPhase(world, me);
      me.angle = Math.atan2(me.vy, me.vx);
      w.bite -= dt;
      if (w.bite <= 0) {
        w.bite = pace(me, 3);
        const a = aim(me, foe);
        me.vx = Math.cos(a) * 720;
        me.vy = Math.sin(a) * 720;
      }
      if (w.phase >= 1) {
        w.pool -= dt;
        if (w.pool <= 0) {
          w.pool = pace(me, 5);
          // 毒の沼: 相手のいる床に、しばらく残る
          for (const o of foes(world, me).slice(0, 2)) {
            spawnProjectile(world, me, {
              x: Math.max(60, Math.min(ARENA - 60, o.x)),
              y: ARENA - 30,
              kind: 'gas',
              r: 60,
              life: 4,
              wall: 'stop',
              blockable: false,
              tick: 0,
              update(world, p, owner, t, dt) {
                p.y = ARENA - 30;
                p.tick -= dt;
                if (p.tick > 0) return;
                p.tick = 0.5;
                for (const v of foes(world, owner)) {
                  if (Math.hypot(v.x - p.x, v.y - p.y) > p.r + v.r) continue;
                  v.poison = Math.min(4, v.poison + 0.3);
                  v.poisonSrc = owner.id;
                }
              },
            });
          }
        }
      }
      if (w.phase < 2) return;
      w.spit -= dt;
      if (w.spit > 0) return;
      w.spit = 2.5;
      for (let i = -1; i <= 1; i++) {
        const a = aim(me, foe) + i * 0.3;
        spawnProjectile(world, me, {
          x: me.x + Math.cos(a) * me.r,
          y: me.y + Math.sin(a) * me.r,
          vx: Math.cos(a) * 420,
          vy: Math.sin(a) * 420,
          kind: 'slime',
          r: 9,
          life: 2,
          onTouch(world, p, owner, t) {
            p.dead = true;
            if (landHit(world, owner, t, 2, { kind: 'boss', x: p.x, y: p.y }) > 0) t.poison = Math.min(4, t.poison + 0.5);
          },
        });
      }
    },
    onContact(world, me, foe) {
      if (me.w.cd > world.t) return;
      me.w.cd = world.t + 0.6;
      if (landHit(world, me, foe, 4, { kind: 'boss', x: foe.x, y: foe.y }) <= 0) return;
      knockback(me, foe, 360);
      foe.poison = Math.min(4, foe.poison + 0.8); // 毒は消えないので、大蛇の毒には上限
      foe.poisonSrc = me.id;
    },
  },
  {
    id: 'kraken',
    kind: 'boss',
    name: 'クラーケン',
    en: 'Kraken',
    color: '#a93226',
    grow: '長い触手を振りまわす。第2形態で墨をはいて全員を遅くし、怒ると床から触手が突き上がる',
    init(b) {
      bossBase(b, 1.9, 0.6);
      b.w.ink = 4;
      b.w.slam = 3;
      setBossSpin(b, 1.2);
      for (let i = 0; i < 4; i++) b.blades.push({ off: (i * TAU) / 4, rIn: b.r - 6, rOut: b.r + 70, w: 14, cd: 0.9, cdLeft: 0, knock: 260, parry: false, sprite: 'tentacle', damage: 1.2 });
    },
    stats: (b) => [['形態', ['第1', '第2', '怒り'][b.w.phase]]],
    update(world, me, foe, dt) {
      const w = me.w;
      stepPhase(world, me);
      if (w.phase >= 1) {
        w.ink -= dt;
        if (w.ink <= 0) {
          w.ink = pace(me, 5);
          world.events.push({ type: 'shock', x: me.x, y: me.y, r: me.r + 200, color: '#1a1a2e' });
          for (const o of foes(world, me)) {
            o.slow = Math.max(o.slow, 0.45);
            o.slowT = Math.max(o.slowT, 2);
          }
        }
      }
      if (w.phase < 2) return;
      w.slam -= dt;
      if (w.slam > 0) return;
      w.slam = 3;
      // 床から触手: 全員の足元に柱
      for (const o of foes(world, me)) {
        world.events.push({ type: 'icespike', x: o.x, h: ARENA * 0.5 });
        if (o.y > ARENA * 0.5 && landHit(world, me, o, 4, { kind: 'boss', x: o.x, y: o.y }) > 0) o.vy = -700 * (o.knockMul ?? 1);
      }
    },
    onContact: bossContact(2.5),
  },
  {
    id: 'sandworm',
    kind: 'boss',
    name: '砂の大ミミズ',
    en: 'Sandworm',
    color: '#c9a66b',
    grow: '砂にもぐって(攻撃が効きにくい)、だれかの真下から飛び出す。第2形態で砂をはき、怒るともぐる時間が短くなる',
    init(b) {
      bossBase(b, 1.8, 0.8);
      b.w.dig = 0;
      b.w.next = 2.5;
      b.w.spit = 3;
    },
    stats: (b) => [['形態', ['第1', '第2', '怒り'][b.w.phase]]],
    update(world, me, foe, dt) {
      const w = me.w;
      stepPhase(world, me);
      me.angle = Math.atan2(me.vy, me.vx);
      if (w.dig > 0) {
        // もぐっている: 床にはりつき、だれかの下へ近づく
        w.dig -= dt;
        me.alpha = 0.3;
        me.y = ARENA - me.r;
        me.vy = 0;
        const t = w.target && !w.target.dead ? w.target : foe;
        me.vx = Math.sign(t.x - me.x || 1) * 340;
        if (w.dig <= 0) {
          // 飛び出す
          me.alpha = 1;
          me.vy = -1100;
          world.events.push({ type: 'quake', x: me.x, y: ARENA });
          shockwave(world, me, me.r + 90, 4.5, 520, '#c9a66b');
        }
        return;
      }
      w.next -= dt;
      if (w.next <= 0) {
        w.next = pace(me, 4.5);
        w.dig = w.phase >= 2 ? 1.2 : 1.8;
        const list = foes(world, me);
        w.target = list[Math.floor(world.rng() * list.length)];
      }
      if (w.phase < 1) return;
      w.spit -= dt;
      if (w.spit > 0) return;
      w.spit = pace(me, 3.5);
      for (let i = -1; i <= 1; i++) {
        const a = aim(me, foe) + i * 0.25;
        spawnProjectile(world, me, {
          x: me.x + Math.cos(a) * me.r,
          y: me.y + Math.sin(a) * me.r,
          vx: Math.cos(a) * 450,
          vy: Math.sin(a) * 450,
          kind: 'stone',
          r: 9,
          life: 2,
          onTouch(world, p, owner, t) {
            p.dead = true;
            landHit(world, owner, t, 2.5, { kind: 'boss', x: p.x, y: p.y });
          },
        });
      }
    },
    onTakeDamage: (world, me, src, amount) => (me.w.dig > 0 ? amount * 0.3 : amount),
    onContact: bossContact(3),
  },
  {
    id: 'twinOni',
    kind: 'boss',
    name: '双子の鬼',
    en: 'Twin Oni',
    color: '#c0392b',
    count: 2,
    grow: '赤鬼と青鬼の2体。金棒を振りまわして突進する。片方を倒すと、残った方が怒って強くなる',
    init(b) {
      bossBase(b, 1.45, 0.85);
      b.color = b.id % 2 ? '#2e86c1' : '#c0392b';
      b.w.dash = 2 + (b.id % 2);
      b.w.alone = false;
      setBossSpin(b, 3);
      b.blades.push({ off: 0, rIn: b.r - 6, rOut: b.r + 64, w: 16, cd: 0.7, cdLeft: 0, knock: 320, parry: false, sprite: 'club', damage: 1.6 });
    },
    stats: (b) => [['形態', b.w.alone ? '怒り(ひとり)' : ['第1', '第2', '怒り'][b.w.phase]]],
    update(world, me, foe, dt) {
      const w = me.w;
      stepPhase(world, me);
      // 相棒が倒れたら怒る
      if (!w.alone && world.balls.some((o) => o !== me && ally(o, me) && o.dead)) {
        w.alone = true;
        me.power *= 1.4;
        me.speedMul *= 1.25;
        world.events.push({ type: 'evolve', target: me.id, x: me.x, y: me.y, text: '相棒のかたき！', color: '#c01f1f' });
      }
      w.dash -= dt;
      if (w.dash > 0) return;
      w.dash = pace(me, w.alone ? 2 : 3);
      const a = aim(me, foe);
      me.vx = Math.cos(a) * 700;
      me.vy = Math.sin(a) * 700;
    },
    onContact: bossContact(2.5),
  },
  {
    id: 'meteorGod',
    kind: 'boss',
    name: '隕石の神',
    en: 'Meteor God',
    color: '#34495e',
    grow: '空から隕石の雨。第2形態で影の予告のあと大隕石、怒ると雨が激しくなる',
    init(b) {
      bossBase(b, 1.9, 0.55);
      b.w.rain = 1.5;
      b.w.big = 5;
    },
    stats: (b) => [['形態', ['第1', '第2', '怒り'][b.w.phase]]],
    update(world, me, foe, dt) {
      const w = me.w;
      stepPhase(world, me);
      me.angle = -Math.PI / 2;
      w.rain -= dt;
      if (w.rain <= 0) {
        w.rain = pace(me, 1.6);
        const n = w.phase >= 2 ? 3 : 2;
        for (let i = 0; i < n; i++) {
          spawnProjectile(world, me, {
            x: 30 + world.rng() * (ARENA - 60),
            y: 24,
            vx: (world.rng() - 0.5) * 120,
            vy: 380,
            kind: 'meteor',
            r: 12,
            life: 3,
            blockable: false,
            onTouch(world, p, owner, t) {
              p.dead = true;
              world.events.push({ type: 'boom', x: p.x, y: p.y, radius: 40, kind: 'meteor' });
              landHit(world, owner, t, 2, { kind: 'boss', x: p.x, y: p.y });
            },
          });
        }
      }
      if (w.phase < 1) return;
      w.big -= dt;
      if (w.big > 0) return;
      w.big = pace(me, 5);
      // 大隕石: だれかの位置に影を出し、少しして落ちる
      const list = foes(world, me);
      const t = list[Math.floor(world.rng() * list.length)] || foe;
      spawnProjectile(world, me, {
        x: Math.max(60, Math.min(ARENA - 60, t.x)),
        y: ARENA - 8,
        kind: 'anvilShadow',
        r: 60,
        life: 1.1,
        wall: 'stop',
        blockable: false,
        onExpire(world, p, owner) {
          world.events.push({ type: 'boom', x: p.x, y: ARENA - 60, radius: 120, kind: 'meteor' });
          world.events.push({ type: 'quake', x: p.x, y: ARENA });
          for (const o of foes(world, owner)) {
            if (Math.abs(o.x - p.x) > 120 + o.r || o.y < ARENA - 260) continue;
            if (landHit(world, owner, o, 6, { kind: 'boss', x: o.x, y: o.y }) > 0) o.vy = -600 * (o.knockMul ?? 1);
          }
        },
      });
    },
    onContact: bossContact(2.5),
  },
  {
    id: 'demonLord',
    kind: 'boss',
    name: '魔王',
    en: 'Demon Lord',
    color: '#4a235a',
    grow: '8レベルごとの大ボス。闇の玉の輪と全員への雷。第2形態で火の息、怒ると瞬間移動して衝撃波',
    init(b) {
      bossBase(b, 2.2, 0.6);
      b.w.orbs = 2;
      b.w.bolt = 3;
      b.w.breath = 3;
      b.w.fire = 0;
      b.w.warp = 3;
    },
    stats: (b) => [['形態', ['第1', '第2', '怒り'][b.w.phase]]],
    update(world, me, foe, dt) {
      const w = me.w;
      stepPhase(world, me);
      if (w.fire > 0) w.fire -= dt;
      else me.angle = aim(me, foe);
      w.orbs -= dt;
      if (w.orbs <= 0) {
        w.orbs = pace(me, 4);
        for (let i = 0; i < 6; i++) {
          const a = (i * TAU) / 6 + world.t;
          spawnProjectile(world, me, {
            x: me.x + Math.cos(a) * me.r,
            y: me.y + Math.sin(a) * me.r,
            vx: Math.cos(a) * 240,
            vy: Math.sin(a) * 240,
            kind: 'gorb',
            r: 12,
            life: 2.6,
            onTouch(world, p, owner, t) {
              p.dead = true;
              landHit(world, owner, t, 2.5, { kind: 'boss', x: p.x, y: p.y });
            },
          });
        }
      }
      w.bolt -= dt;
      if (w.bolt <= 0) {
        w.bolt = pace(me, 3.5);
        for (const o of foes(world, me)) bolt(world, me, o.x + o.vx * 0.3, o.y + o.vy * 0.3, 0.6, 3);
      }
      if (w.phase >= 1) {
        w.breath -= dt;
        if (w.breath <= 0) {
          w.breath = pace(me, 3.5);
          w.fire = 0.4;
          for (const o of foes(world, me)) {
            const d = Math.hypot(o.x - me.x, o.y - me.y);
            const diff = Math.abs(((aim(me, o) - me.angle + Math.PI) % TAU + TAU) % TAU - Math.PI);
            if (d > me.r + 230 + o.r || diff > 0.5) continue;
            landHit(world, me, o, 5, { kind: 'breath', x: o.x, y: o.y });
          }
        }
      }
      if (w.phase < 2) return;
      w.warp -= dt;
      if (w.warp > 0) return;
      w.warp = 3.5;
      world.events.push({ type: 'shock', x: me.x, y: me.y, r: 60, color: '#4a235a' });
      me.x = Math.max(me.r, Math.min(ARENA - me.r, foe.x + (world.rng() - 0.5) * 200));
      me.y = Math.max(me.r, Math.min(ARENA - me.r, foe.y - 120));
      shockwave(world, me, me.r + 140, 5, 420, '#8e44ad');
    },
    onContact: bossContact(3.5),
  },
];

export const BOSS_BY_ID = Object.fromEntries(BOSSES.map((b) => [b.id, b]));
// ボスごとの強さの合わせ(HP・与ダメージ)。シミュレーションで、どのボスも同じくらいの勝率になるように決めた
const BOSS_TUNE = {
  slimeKing: { hp: 0.71, power: 1 },
  fortress: { hp: 0.63, power: 0.85 },
  dragonLord: { hp: 0.83, power: 1 },
  thunderGiant: { hp: 0.89, power: 1 },
  shadowNinja: { hp: 0.65, power: 0.76 },
  iceQueen: { hp: 1.11, power: 1 },
  venomSerpent: { hp: 0.65, power: 0.65 },
  demonLord: { hp: 1.00, power: 0.70 },
  kraken: { hp: 0.70, power: 0.68 },
  sandworm: { hp: 0.70, power: 0.86 },
  twinOni: { hp: 0.70, power: 0.67 },
  meteorGod: { hp: 0.70, power: 0.82 },
};

// ==== コンビ技: チームの武器の組み合わせで付くボーナス ====
const FIRE = new Set(['wand', 'flame', 'fireworks', 'lava', 'phoenix', 'ember', 'volcano', 'firecracker', 'magma']);
const ICE = new Set(['ice', 'blizzard', 'snowball', 'frostCircle', 'iceSpike', 'snowman']);
const THUNDER = new Set(['lightning', 'tesla', 'thundercloud', 'sparky', 'plasma', 'storm']);
const isNear = (d) => d.kind !== 'ranged';
const count = (defs, f) => defs.filter(f).length;

export const COMBOS = [
  {
    id: 'vanguard',
    icon: '🛡️',
    name: '前衛と後衛',
    desc: '近接・体の武器と飛び道具がそろうと、全員の与ダメージ +10%',
    test: (defs) => count(defs, isNear) >= 1 && count(defs, (d) => !isNear(d)) >= 1,
    apply: (b) => (b.power *= 1.1),
  },
  {
    id: 'lateTeam',
    icon: '📈',
    name: '大器晩成チーム',
    desc: '📈大器晩成の武器が2つ以上で、その武器は最初から2回分成長',
    test: (defs) => count(defs, (d) => d.late) >= 2,
    apply: (b, d) => d.late && (b.preGrow += 2),
  },
  {
    id: 'genreBond',
    icon: '🎌',
    name: 'ジャンルの絆',
    desc: '同じジャンルの武器が2つ以上で、そのジャンルの武器の与ダメージ +15%',
    test: (defs) => defs.some((d) => count(defs, (x) => x.genre === d.genre) >= 2),
    apply: (b, d, defs) => count(defs, (x) => x.genre === d.genre) >= 2 && (b.power *= 1.15),
  },
  {
    id: 'bloomTeam',
    icon: '🌱',
    name: '進化チーム',
    desc: '🌱進化の武器が2つ以上で、その武器は最初から3回分成長',
    test: (defs) => count(defs, (d) => d.bloom) >= 2,
    apply: (b, d) => d.bloom && (b.preGrow += 3),
  },
  {
    id: 'fireTeam',
    icon: '🔥',
    name: '炎の仲間',
    desc: '炎の武器が2つ以上で、炎の武器の与ダメージ +20%',
    test: (defs) => count(defs, (d) => FIRE.has(d.id)) >= 2,
    apply: (b, d) => FIRE.has(d.id) && (b.power *= 1.2),
  },
  {
    id: 'iceTeam',
    icon: '❄️',
    name: '氷の仲間',
    desc: '氷・雪の武器が2つ以上で、氷・雪の武器の与ダメージ +20%',
    test: (defs) => count(defs, (d) => ICE.has(d.id)) >= 2,
    apply: (b, d) => ICE.has(d.id) && (b.power *= 1.2),
  },
  {
    id: 'thunderTeam',
    icon: '⚡',
    name: '雷の仲間',
    desc: '雷の武器が2つ以上で、雷の武器の与ダメージ +20%',
    test: (defs) => count(defs, (d) => THUNDER.has(d.id)) >= 2,
    apply: (b, d) => THUNDER.has(d.id) && (b.power *= 1.2),
  },
  {
    id: 'fighters',
    icon: '👊',
    name: '格闘家の集い',
    desc: '体で戦う武器が2つ以上で、全員の最大HP +20',
    test: (defs) => count(defs, (d) => d.kind === 'body') >= 2,
    apply: (b) => (b.maxHp += 20),
  },
  {
    id: 'twins',
    icon: '👯',
    name: '双子',
    desc: '同じ武器が2つ以上で、その武器の与ダメージ +25%',
    test: (defs) => defs.some((d, i) => defs.indexOf(d) !== i),
    apply: (b, d, defs) => count(defs, (x) => x === d) >= 2 && (b.power *= 1.25),
  },
  {
    id: 'rainbow',
    icon: '🌈',
    name: '個性ぞろい',
    desc: '3人以上で、近接・飛び道具・体の武器が全部そろうと、全員の攻撃速度 +12%',
    test: (defs) => defs.length >= 3 && ['melee', 'ranged', 'body'].every((k) => defs.some((d) => (d.kind === 'copy' ? 'melee' : d.kind) === k)),
    apply: (b) => (b.haste *= 1.12),
  },
  {
    id: 'fullTeam',
    icon: '🤝',
    name: '4人の絆',
    desc: '4人そろうと、全員の最大HP +10',
    test: (defs) => defs.length >= 4,
    apply: (b) => (b.maxHp += 10),
  },
];

// このチームで付くコンビ技
export function combosOf(defs) {
  return COMBOS.filter((c) => c.test(defs));
}
for (const b of BOSSES) b.tune = 1;

// players: [{ name, weapon, cpu, color }]
export function createRaid(players, difficulty = 'normal') {
  return {
    players: players.map((p, i) => ({ ...p, idx: i, skills: [] })),
    level: 1,
    difficulty,
    pending: null, // 今カードを選ぶ人 { player, cards, choose }
    waiting: [],
    over: false,
  };
}

// 今のレベルのボスと強さ
// レベルの順番: ふつうのボスを順に回し、8レベルごとに魔王
export const DEMON_EVERY = 8;
const REGULAR = () => BOSSES.filter((b) => b.id !== 'demonLord');
export function bossOf(raid) {
  const lvl = raid.level;
  const regular = REGULAR();
  const def = raid.boss
    ? BOSS_BY_ID[raid.boss]
    : lvl % DEMON_EVERY === 0
      ? BOSS_BY_ID.demonLord
      : regular[(lvl - 1 - Math.floor(lvl / DEMON_EVERY)) % regular.length];
  const d = DIFFICULTY[raid.difficulty] || DIFFICULTY.normal;
  const n = raid.players.length;
  const lv = raid.level - 1;
  return {
    def,
    boost: {
      maxHp: Math.round(BOSS_HP * (0.2 + 0.8 * n) * (1 + 0.28 * lv) * 1.12 ** lv * d.hp * BOSS_TUNE[def.id].hp),
      power: (1 + 0.1 * lv) * 1.08 ** lv * d.power * (0.7 + 0.3 * n) * BOSS_TUNE[def.id].power,
    },
  };
}

// 試合の組み合わせ(createMelee にそのまま渡せる): 最後がボス。チームは 0(みんな) と 1(ボス)
export function raidMatch(raid) {
  const boss = bossOf(raid);
  const defs = raid.players.map((p) => p.weapon);
  const combos = combosOf(defs);
  // 2体で出るボス(双子の鬼)は、1体あたりのHPを少なめにする
  const n = boss.def.count || 1;
  const bossBoost = n > 1 ? { ...boss.boost, maxHp: Math.round((boss.boost.maxHp * 0.6)) } : boss.boost;
  return {
    defs: [...defs, ...Array(n).fill(boss.def)],
    // コンビ技は試合開始時にボールへかける(boost.combo)
    boosts: [...raid.players.map((p) => ({ skills: p.skills, combo: (b) => combos.forEach((c) => c.apply(b, p.weapon, defs)) })), ...Array(n).fill(bossBoost)],
    teams: [...raid.players.map(() => 0), ...Array(n).fill(1)],
    combos,
  };
}

// 結果: won なら全員がカードを1枚ずつ選んで次のレベルへ
export function reportRaid(raid, won, rng = Math.random) {
  if (!won) {
    raid.over = true;
    return;
  }
  raid.level++;
  // 3体倒すごとに宝箱: 良いカードが出やすい4枚から2枚
  const chest = (raid.level - 1) % TREASURE_EVERY === 0;
  const offers = raid.players.map((p) => ({ player: p.idx, cards: makeOffer(p.skills, chest ? 4 : 3, rng, chest), choose: chest ? 2 : 1, chest }));
  raid.pending = offers.shift();
  raid.waiting = offers;
}

export function pickRaidCards(raid, cards) {
  const p = raid.pending;
  if (!p) return;
  if (cards.length !== p.choose || cards.some((c) => !p.cards.includes(c))) throw new Error('選び方が正しくない');
  addSkills(raid.players[p.player].skills, cards);
  raid.pending = raid.waiting.shift() || null;
}
