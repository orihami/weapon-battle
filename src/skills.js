// スキルカード。ラウンズ・チャレンジで選んで、ボールに重ねがけしていく。
// DOMに依存しないので Node のテストから使える。
// 1枚ごとに状態 st を持つ(同じカードを2枚取ると、効果も2回分かかる)。
//
// フック(engine.js から呼ばれる):
//   apply(world, me, st)                     試合開始時に1回
//   update(world, me, foe, dt, st)           毎フレーム
//   onHit(world, me, foe, info, st)          武器の攻撃が当たったとき
//   outgoing / incoming(world, me, other, amount, opts, st) → 補正後のダメージ
//   afterDeal(world, me, target, amount, opts, st)  ダメージを与えたあと
//   lethal(world, me, st) → true なら倒れない
//   contact(world, me, foe, st)              ボールどうしがぶつかったとき

import { ARENA, dealDamage, foeOf, heal, knockback, spawnProjectile } from './engine.js?v=7833328';

export const RARITY = {
  common: { name: 'ふつう', color: '#9aa0a6', weight: 55 },
  rare: { name: 'レア', color: '#2f7de1', weight: 30 },
  epic: { name: 'エピック', color: '#9b4fe0', weight: 12 },
  legend: { name: 'レジェンド', color: '#e0a600', weight: 3 },
};

// スキルが出すダメージ(武器の成長やスキルの連鎖は起こさない)
function skillDamage(world, me, foe, amount, x, y) {
  return dealDamage(world, me, foe, amount, { kind: 'skill', x: x ?? foe.x, y: y ?? foe.y });
}

// 体の大きさを変える(刃の位置も一緒にずらす)
function resize(me, k) {
  const r = Math.max(16, me.r * k);
  const d = r - me.r;
  me.r = r;
  for (const bl of me.blades) {
    bl.rIn += d;
    bl.rOut += d;
  }
}

function skillShot(world, me, foe, angle, speed, damage, kind = 'skillbolt', extra = {}) {
  spawnProjectile(world, me, {
    x: me.x + Math.cos(angle) * (me.r + 6),
    y: me.y + Math.sin(angle) * (me.r + 6),
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    angle,
    kind,
    r: 5,
    life: 2,
    damage,
    blockable: true,
    onTouch(world, p, owner, foe) {
      p.dead = true;
      skillDamage(world, owner, foe, p.damage, p.x, p.y);
    },
    ...extra,
  });
}

function homingStep(p, foe, turn, dt, speed) {
  const want = Math.atan2(foe.y - p.y, foe.x - p.x);
  const cur = Math.atan2(p.vy, p.vx);
  const diff = ((want - cur + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  const a = cur + Math.max(-turn * dt, Math.min(turn * dt, diff));
  p.vx = Math.cos(a) * speed;
  p.vy = Math.sin(a) * speed;
  p.angle = a;
}

// 雷を落とす(予告なし・すぐ)
function zap(world, me, foe, dmg) {
  world.events.push({ type: 'zap', x: foe.x, y: foe.y, big: false });
  skillDamage(world, me, foe, dmg);
  foe.stun = Math.max(foe.stun, 0.12);
}

// 追加の刃(剣)をボールのまわりに足す
function addBlade(me, dmg) {
  const blade = { off: 0, rIn: me.r - 8, rOut: me.r + 54, w: 8, cd: 0.3, cdLeft: 0, knock: 100, parry: true, sprite: 'sword', damage: dmg, extra: true };
  me.blades.push(blade);
  const extras = me.blades.filter((b) => b.extra);
  extras.forEach((b, i) => (b.off = Math.PI + (i * Math.PI * 2) / (extras.length + 1)));
}

export const SKILLS = [
  // ---- ふつう ----
  { id: 'hp', icon: '❤️', name: '体力アップ', desc: '最大HP +20', rarity: 'common', apply: (w, me) => ((me.maxHp += 20), (me.hp += 20)) },
  { id: 'power', icon: '💪', name: '威力アップ', desc: '与えるダメージ +15%', rarity: 'common', apply: (w, me) => (me.power *= 1.15) },
  {
    id: 'speed',
    icon: '👟',
    name: '身軽',
    desc: '動きが10%速くなり、12%の確率で攻撃をよける',
    rarity: 'common',
    apply: (w, me) => (me.speedMul *= 1.1),
    incoming(world, me, src, amount, opts) {
      if (opts.kind === 'poison' || opts.kind === 'burn' || world.rng() >= 0.12) return amount;
      world.events.push({ type: 'dodge', x: me.x, y: me.y, target: me.id });
      return 0;
    },
  },
  { id: 'haste', icon: '⚡', name: '攻撃速度アップ', desc: '武器の回転・発射が20%速くなる', rarity: 'common', apply: (w, me) => (me.haste *= 1.2) },
  {
    id: 'regen',
    icon: '🌿',
    name: '再生',
    desc: '毎秒HPが1.2回復する',
    rarity: 'common',
    update(world, me, foe, dt, st) {
      st.t = (st.t || 0) + dt;
      if (st.t >= 1) {
        st.t -= 1;
        heal(world, me, 1.2);
      }
    },
  },
  {
    id: 'pregrow',
    icon: '🌱',
    name: '先取り成長',
    desc: '試合開始の時点で4回分成長している',
    rarity: 'common',
    apply(world, me) {
      const foe = foeOf(world, me);
      if (!me.def.onHit) return;
      const saved = { poison: foe.poison, curse: foe.curse, stun: foe.stun, slow: foe.slow, freeze: foe.freeze, hp: foe.hp, maxHp: foe.maxHp };
      const mine = [me.hp, me.maxHp];
      for (let i = 0; i < 4; i++) me.def.onHit(world, me, foe, { kind: 'pre' });
      Object.assign(foe, saved);
      [me.hp, me.maxHp] = mine;
      world.events.length = 0;
    },
  },
  {
    id: 'thorns',
    icon: '🌵',
    name: 'トゲの体',
    desc: 'ぶつかった相手に1.5ダメージ',
    rarity: 'common',
    contact(world, me, foe, st) {
      if ((st.cd || 0) > world.t) return;
      st.cd = world.t + 0.3;
      skillDamage(world, me, foe, 1.5);
    },
  },
  { id: 'armor', icon: '🛡️', name: '硬い体', desc: '受けるダメージ -12%', rarity: 'common', incoming: (w, me, src, amount) => amount * 0.88 },

  // ---- レア ----
  {
    id: 'vamp',
    icon: '🧛',
    name: '吸血',
    desc: '与えたダメージの18%だけ回復',
    rarity: 'rare',
    afterDeal(world, me, target, amount, opts) {
      if (opts.kind !== 'reflect') heal(world, me, amount * 0.18);
    },
  },
  {
    id: 'poisonEdge',
    icon: '☠️',
    name: '毒の攻撃',
    desc: '攻撃が当たると毒 +1(1秒に1回まで。毒はずっと残る)',
    rarity: 'epic',
    onHit(world, me, foe, info, st) {
      if ((st.cd || 0) > world.t) return;
      st.cd = world.t + 1;
      foe.poison += 1;
      foe.poisonSrc = me.id;
    },
  },
  {
    id: 'burnEdge',
    icon: '🔥',
    name: '炎の攻撃',
    desc: '攻撃が当たると相手が燃える(2秒間)',
    rarity: 'rare',
    onHit(world, me, foe) {
      foe.burnT = 2;
      foe.burnDps = Math.max(foe.burnDps, 1.5);
      foe.burnSrc = me.id;
    },
  },
  {
    id: 'frostEdge',
    icon: '❄️',
    name: '氷の攻撃',
    desc: '攻撃が当たると +1ダメージ、相手が少し遅くなる(0.3秒に1回まで)',
    rarity: 'rare',
    onHit(world, me, foe, info, st) {
      foe.slow = Math.max(foe.slow, 0.1);
      foe.slowT = 1;
      if ((st.cd || 0) > world.t) return;
      st.cd = world.t + 0.3;
      skillDamage(world, me, foe, 1);
    },
  },
  {
    id: 'crit',
    icon: '🎯',
    name: '会心',
    desc: '20%の確率でダメージ2倍',
    rarity: 'rare',
    outgoing(world, me, target, amount, opts) {
      if (opts.kind === 'poison' || opts.kind === 'burn' || world.rng() >= 0.2) return amount;
      world.events.push({ type: 'crit', x: target.x, y: target.y });
      return amount * 2;
    },
  },
  {
    id: 'barrier',
    icon: '🫧',
    name: 'バリア',
    desc: '試合ごとに最初の10ダメージを防ぐ',
    rarity: 'rare',
    apply: (w, me, st) => ((st.left = 10), (me.barrier = (me.barrier || 0) + 10)),
    incoming(world, me, src, amount, opts, st) {
      if (st.left <= 0) return amount;
      const block = Math.min(st.left, amount);
      st.left -= block;
      me.barrier = Math.max(0, (me.barrier || 0) - block);
      if (st.left <= 0) world.events.push({ type: 'block', x: me.x, y: me.y });
      return amount - block;
    },
  },
  { id: 'extraBlade', icon: '🗡️', name: '追加の剣', desc: 'まわりを回る剣が1本ふえる(1.5ダメージ)', rarity: 'rare', apply: (w, me) => addBlade(me, 1.5) },
  {
    id: 'missiles',
    icon: '🚀',
    name: '追尾ミサイル',
    desc: '2.2秒ごとに追尾ミサイル(5ダメージ)',
    rarity: 'rare',
    update(world, me, foe, dt, st) {
      st.t = (st.t ?? 1) - dt;
      if (st.t > 0) return;
      st.t = 2.2;
      skillShot(world, me, foe, Math.atan2(foe.y - me.y, foe.x - me.x) + Math.PI, 260, 5, 'missile', {
        life: 3.5,
        update: (world, p, owner, foe, dt) => homingStep(p, foe, 3.2, dt, 420),
      });
    },
  },
  {
    id: 'big',
    icon: '🐘',
    name: '巨体',
    desc: '大きさ +20%・最大HP +40・素早さ -8%',
    rarity: 'rare',
    apply(world, me) {
      resize(me, 1.2);
      me.maxHp += 40;
      me.hp += 40;
      me.speedMul *= 0.92;
    },
  },
  {
    id: 'small',
    icon: '🐭',
    name: '小柄',
    desc: '大きさ -22%(当たりにくい)・素早さ +15%',
    rarity: 'rare',
    apply(world, me) {
      resize(me, 0.78);
      me.speedMul *= 1.15;
    },
  },

  // ---- エピック ----
  {
    id: 'chainZap',
    icon: '🌩️',
    name: '雷撃',
    desc: '攻撃が当たると25%で雷が落ちる(4ダメージ)',
    rarity: 'epic',
    onHit(world, me, foe) {
      if (world.rng() < 0.25) zap(world, me, foe, 4);
    },
  },
  {
    id: 'explode',
    icon: '💥',
    name: '爆発攻撃',
    desc: '攻撃が当たると小さな爆発(+2.5ダメージ・0.4秒に1回)',
    rarity: 'epic',
    onHit(world, me, foe, info, st) {
      if ((st.cd || 0) > world.t) return;
      st.cd = world.t + 0.4;
      world.events.push({ type: 'boom', x: foe.x, y: foe.y, radius: 50, kind: 'bomb' });
      skillDamage(world, me, foe, 2.5);
      knockback(me, foe, 120);
    },
  },
  {
    id: 'growth2',
    icon: '📈',
    name: '成長加速',
    desc: '攻撃が当たると40%でもう1回成長する',
    rarity: 'epic',
    onHit(world, me, foe, info) {
      if (me.def.onHit && world.rng() < 0.4) me.def.onHit(world, me, foe, info);
    },
  },
  {
    id: 'guts',
    icon: '😤',
    name: '根性',
    desc: '1度だけ、倒れずに踏みとどまってHP12で立ち直る',
    rarity: 'epic',
    lethal(world, me, st) {
      if (st.used) return false;
      st.used = true;
      me.hp = Math.min(me.maxHp, 12);
      world.events.push({ type: 'guts', x: me.x, y: me.y, target: me.id });
      return true;
    },
  },
  {
    id: 'rage',
    icon: '😡',
    name: '怒り',
    desc: '減ったHPが多いほど威力アップ(HP1%ごとに+1%)',
    rarity: 'epic',
    outgoing: (world, me, target, amount) => amount * (1 + Math.max(0, 1 - me.hp / me.maxHp)),
  },
  {
    id: 'reflect',
    icon: '🪞',
    name: '反撃',
    desc: '受けたダメージの25%を相手に返す',
    rarity: 'epic',
    incoming(world, me, src, amount, opts) {
      if (src && src !== me && opts.kind !== 'reflect' && opts.kind !== 'skill') {
        dealDamage(world, me, src, amount * 0.25, { kind: 'reflect' });
      }
      return amount;
    },
  },
  {
    id: 'split',
    icon: '🔱',
    name: '分裂弾',
    desc: '1.8秒ごとに3方向へ弾を撃つ(各2ダメージ)',
    rarity: 'epic',
    update(world, me, foe, dt, st) {
      st.t = (st.t ?? 0.8) - dt;
      if (st.t > 0) return;
      st.t = 1.8;
      const a = Math.atan2(foe.y - me.y, foe.x - me.x);
      for (const s of [-0.3, 0, 0.3]) skillShot(world, me, foe, a + s, 520, 2);
    },
  },
  {
    id: 'curseEdge',
    icon: '🪆',
    name: '呪いの攻撃',
    desc: '攻撃が当たると呪い +1(1秒に1回まで)',
    rarity: 'epic',
    onHit(world, me, foe, info, st) {
      if ((st.cd || 0) > world.t) return;
      st.cd = world.t + 1;
      foe.curse += 1;
    },
  },

  // ---- レジェンド ----
  {
    id: 'twin',
    icon: '⚔️',
    name: '双剣',
    desc: '追加の剣が2本ふえ、攻撃速度 +15%',
    rarity: 'legend',
    apply(world, me) {
      addBlade(me, 2.5);
      addBlade(me, 2.5);
      me.haste *= 1.15;
    },
  },
  {
    id: 'undying',
    icon: '🕊️',
    name: '不死',
    desc: '1度だけ、HP50%でよみがえる',
    rarity: 'legend',
    lethal(world, me, st) {
      if (st.used) return false;
      st.used = true;
      me.hp = me.maxHp * 0.5;
      me.poison = 0;
      me.burnT = 0;
      world.events.push({ type: 'rebirth', x: me.x, y: me.y, target: me.id });
      return true;
    },
  },
  {
    id: 'overgrow',
    icon: '🌋',
    name: '過成長',
    desc: '攻撃が当たるたびに、必ずもう1回成長する',
    rarity: 'legend',
    onHit(world, me, foe, info) {
      if (me.def.onHit) me.def.onHit(world, me, foe, info);
    },
  },
  {
    id: 'thunderGod',
    icon: '⛈️',
    name: '雷神',
    desc: '2.6秒ごとに相手へ雷(5ダメージ)',
    rarity: 'legend',
    update(world, me, foe, dt, st) {
      st.t = (st.t ?? 1.2) - dt;
      if (st.t > 0) return;
      st.t = 2.6;
      zap(world, me, foe, 5);
    },
  },
  {
    id: 'titan',
    icon: '🗿',
    name: '巨神',
    desc: '大きさ +40%・最大HP +90・威力 +30%・素早さ -10%',
    rarity: 'legend',
    apply(world, me) {
      resize(me, 1.4);
      me.maxHp += 90;
      me.hp += 90;
      me.power *= 1.3;
      me.speedMul *= 0.9;
    },
  },
  {
    id: 'timeLord',
    icon: '⏳',
    name: '時の支配者',
    desc: '3秒ごとに相手の時間を0.8秒止める',
    rarity: 'legend',
    update(world, me, foe, dt, st) {
      st.t = (st.t ?? 2) - dt;
      if (st.t > 0) return;
      st.t = 3;
      foe.freeze = Math.max(foe.freeze, 0.8);
      foe.stun = Math.max(foe.stun, 0.8);
      world.events.push({ type: 'timestop', x: foe.x, y: foe.y, target: foe.id });
    },
  },
];

export const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

// レア度の重みでランダムに n 枚(重複なし)。boost=true だと良いカードが出やすい(大進化)
export function drawSkills(n, rng = Math.random, boost = false) {
  const weight = (s) => (boost ? { common: 0, rare: 40, epic: 40, legend: 20 } : { common: 55, rare: 30, epic: 12, legend: 3 })[s.rarity];
  const pool = SKILLS.filter((s) => weight(s) > 0);
  const out = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((a, s) => a + weight(s), 0);
    let r = rng() * total;
    let i = 0;
    for (; i < pool.length - 1; i++) {
      r -= weight(pool[i]);
      if (r < 0) break;
    }
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

// CPUが選ぶとき: レア度の高いものを優先(同じなら先頭)
const RANK = { common: 0, rare: 1, epic: 2, legend: 3 };
export function cpuPick(cards, count = 1) {
  return cards
    .slice()
    .sort((a, b) => RANK[b.rarity] - RANK[a.rarity])
    .slice(0, count);
}

export { ARENA };
