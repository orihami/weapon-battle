// ボス・レイド: 2〜4人が協力して、巨大なボス1体と戦う(同じチームどうしは攻撃が当たらない)。
// ボスはHPが減ると技が増え(第2形態)、最後は怒って速くなる。
// 勝つと全員がカードを1枚選び、ボスのレベルが上がって次のボスへ。負けたら終わり。
// DOMに依存しないので Node のテストから使える。

import { ARENA, BALL_R, ally, foeOf, landHit, knockback, spawnProjectile, segPointDist } from './engine.js';
import { makeOffer, addSkills } from './skills.js';

const TAU = Math.PI * 2;

// ボスのHP(1人あたりの目安)と、強さの段階
export const BOSS_HP = 260;
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
}

// 怒り中は技の間隔が短くなる
const pace = (me, t) => (me.w.phase >= 2 ? t * 0.7 : t);

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
];

export const BOSS_BY_ID = Object.fromEntries(BOSSES.map((b) => [b.id, b]));
// ボスごとの強さの合わせ(HP・与ダメージ)。シミュレーションで、どのボスも同じくらいの勝率になるように決めた
const BOSS_TUNE = {
  slimeKing: { hp: 0.92, power: 1 },
  fortress: { hp: 0.72, power: 0.85 },
  dragonLord: { hp: 1, power: 1 },
  thunderGiant: { hp: 1.1, power: 1 },
};
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
export function bossOf(raid) {
  const def = raid.boss ? BOSS_BY_ID[raid.boss] : BOSSES[(raid.level - 1) % BOSSES.length];
  const d = DIFFICULTY[raid.difficulty] || DIFFICULTY.normal;
  const n = raid.players.length;
  const lv = raid.level - 1;
  return {
    def,
    boost: {
      maxHp: Math.round(BOSS_HP * (0.3 + 0.7 * n) * (1 + 0.28 * lv) * 1.07 ** lv * d.hp * BOSS_TUNE[def.id].hp),
      power: (1 + 0.1 * lv) * 1.05 ** lv * d.power * (0.8 + 0.2 * n) * BOSS_TUNE[def.id].power,
    },
  };
}

// 試合の組み合わせ(createMelee にそのまま渡せる): 最後がボス。チームは 0(みんな) と 1(ボス)
export function raidMatch(raid) {
  const boss = bossOf(raid);
  return {
    defs: [...raid.players.map((p) => p.weapon), boss.def],
    boosts: [...raid.players.map((p) => ({ skills: p.skills })), boss.boost],
    teams: [...raid.players.map(() => 0), 1],
  };
}

// 結果: won なら全員がカードを1枚ずつ選んで次のレベルへ
export function reportRaid(raid, won, rng = Math.random) {
  if (!won) {
    raid.over = true;
    return;
  }
  raid.level++;
  const offers = raid.players.map((p) => ({ player: p.idx, cards: makeOffer(p.skills, 3, rng), choose: 1 }));
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
