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

import { ARENA, dealDamage, foeOf, heal, knockback, spawnProjectile } from './engine.js';

export const RARITY = {
  common: { name: 'ふつう', color: '#9aa0a6', weight: 55 },
  rare: { name: 'レア', color: '#2f7de1', weight: 30 },
  epic: { name: 'エピック', color: '#9b4fe0', weight: 12 },
  legend: { name: 'レジェンド', color: '#e0a600', weight: 3 },
  // 下の3つはふつうの抽選には出ない(合体進化は材料がそろったとき、武器進化はボスのあと、呪いはときどき)
  fusion: { name: '合体進化', color: '#ff3d9a' },
  awaken: { name: '武器進化', color: '#ff7a1a' },
  cursed: { name: '呪い', color: '#6b1d2e' },
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

// 追加の刃(剣)をボールのまわりに足す。武器の向きとは関係なく、いつも自分で回り続ける。
// 攻撃だけの剣で、弾を防いだり相手の刃をはじいたりはしない(守りにも効くと強すぎた)
function addBlade(me, dmg) {
  const blade = { off: 0, rIn: me.r - 8, rOut: me.r + 54, w: 8, cd: 0.45, cdLeft: 0, knock: 100, parry: false, block: false, sprite: 'sword', damage: dmg, extra: true, free: true, rot: me.angle };
  me.blades.push(blade);
  const extras = me.blades.filter((b) => b.extra);
  // 追加の剣どうしは等間隔に並べて、いっしょに回す
  extras.forEach((b, i) => {
    b.off = (i * Math.PI * 2) / extras.length;
    b.rot = extras[0].rot;
  });
}

// スキルの効果で使う小物
const isWeaponHit = (opts) => !['poison', 'burn', 'skill', 'reflect'].includes(opts.kind);

function enemiesNear(world, me, range) {
  return world.balls.filter((o) => o !== me && !o.dead && Math.hypot(o.x - me.x, o.y - me.y) < range + o.r);
}

function dodge(rate) {
  return (world, me, src, amount, opts) => {
    if (opts.kind === 'poison' || opts.kind === 'burn' || world.rng() >= rate) return amount;
    world.events.push({ type: 'dodge', x: me.x, y: me.y, target: me.id });
    return 0;
  };
}

function regen(perSec) {
  return (world, me, foe, dt, st) => {
    st.rg = (st.rg || 0) + dt;
    if (st.rg < 1) return;
    st.rg -= 1;
    heal(world, me, perSec);
  };
}

// 武器進化の段階(見た目の光の輪と、名前の「改・真・極・神」に使う)
function awaken(me) {
  me.awaken = (me.awaken || 0) + 1;
}

// 試合前に n 回分成長させる(相手に付く効果は消しておく)
function preGrow(world, me, n) {
  const foe = foeOf(world, me);
  if (!me.def.onHit || !foe) return;
  const saved = { poison: foe.poison, curse: foe.curse, stun: foe.stun, slow: foe.slow, freeze: foe.freeze, hp: foe.hp, maxHp: foe.maxHp, gravFlip: foe.gravFlip };
  const mine = [me.hp, me.maxHp];
  for (let i = 0; i < n; i++) me.def.onHit(world, me, foe, { kind: 'pre' });
  Object.assign(foe, saved);
  [me.hp, me.maxHp] = mine;
  world.events.length = 0;
}

// 試合中に、当てなくても武器を1回成長させる(相手に付く効果は消す。出たイベントも消す)
function growQuiet(world, me, foe) {
  if (!me.def.onHit || !foe) return;
  const saved = { poison: foe.poison, curse: foe.curse, stun: foe.stun, slow: foe.slow, slowT: foe.slowT, freeze: foe.freeze, hp: foe.hp, maxHp: foe.maxHp, gravFlip: foe.gravFlip, burnT: foe.burnT, slamT: foe.slamT };
  const mine = [me.hp, me.maxHp];
  const n = world.events.length;
  me.def.onHit(world, me, foe, { kind: 'pre' });
  Object.assign(foe, saved);
  [me.hp, me.maxHp] = mine;
  world.events.length = n;
}

// 竜の息吹: 相手の方へ扇形に火の玉
function breath(world, me, foe, n, dmg) {
  const a = Math.atan2(foe.y - me.y, foe.x - me.x);
  for (let i = 0; i < n; i++) {
    skillShot(world, me, foe, a + (i - (n - 1) / 2) * 0.18, 480, dmg, 'fireball', {
      r: 8,
      life: 1.6,
      onTouch(world, p, owner, o) {
        p.dead = true;
        skillDamage(world, owner, o, p.damage, p.x, p.y);
        o.burnT = Math.max(o.burnT, 1.5);
        o.burnDps = Math.max(o.burnDps, 1.5);
        o.burnSrc = owner.id;
      },
    });
  }
}

export const SKILLS = [
  // ---- ふつう ----
  { id: 'hp', icon: '❤️', name: '体力アップ', desc: '最大HP +20', rarity: 'common', apply: (w, me) => ((me.maxHp += 20), (me.hp += 20)) },
  { id: 'power', icon: '💪', name: '威力アップ', desc: '与えるダメージ +20%', rarity: 'common', apply: (w, me) => (me.power *= 1.2) },
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
    desc: '毎秒HPが1回復する',
    rarity: 'common',
    update(world, me, foe, dt, st) {
      st.t = (st.t || 0) + dt;
      if (st.t >= 1) {
        st.t -= 1;
        heal(world, me, 1);
      }
    },
  },
  {
    id: 'pregrow',
    icon: '🌱',
    name: '先取り成長',
    desc: '試合開始の時点で3回分成長している',
    rarity: 'common',
    apply: (world, me) => preGrow(world, me, 3),
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
    desc: '攻撃が当たると毒 +1(1.8秒に1回まで。毒はずっと残る)',
    rarity: 'epic',
    onHit(world, me, foe, info, st) {
      if ((st.cd || 0) > world.t) return;
      st.cd = world.t + 1.8;
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
  { id: 'extraBlade', icon: '🗡️', name: '追加の剣', desc: 'まわりを回る剣が1本ふえる(1.2ダメージ)', rarity: 'rare', apply: (w, me) => addBlade(me, 1.2) },
  {
    id: 'missiles',
    icon: '🚀',
    name: '追尾ミサイル',
    desc: '2秒ごとに追尾ミサイル(6ダメージ)',
    rarity: 'rare',
    update(world, me, foe, dt, st) {
      st.t = (st.t ?? 1) - dt;
      if (st.t > 0) return;
      st.t = 2;
      skillShot(world, me, foe, Math.atan2(foe.y - me.y, foe.x - me.x) + Math.PI, 260, 6, 'missile', {
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
    desc: '飛び道具の武器なら、撃つたびに弾が2発ふえる。それ以外の武器(置くタイプの飛び道具も)は1.8秒ごとに3方向へ弾(各2ダメージ)',
    rarity: 'legend',
    kinds: { far: '撃つたびに弾が2発ふえる(置くタイプの武器は3方向弾)', near: '1.8秒ごとに3方向へ弾(各2ダメージ)' },
    apply(world, me) {
      if (me.def.kind === 'ranged') me.extraShots = (me.extraShots || 0) + 2;
    },
    update(world, me, foe, dt, st) {
      // 弾がふえる武器はそれで十分。地雷や雷のように動く弾を撃たない武器は、3秒たってもふえなければ3方向弾にする
      if (me.cloneUsed || (me.def.kind === 'ranged' && world.t < 3)) return;
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
    desc: '追加の剣が2本ふえ(各1.3ダメージ)、攻撃速度 +10%',
    rarity: 'legend',
    apply(world, me) {
      addBlade(me, 1.3);
      addBlade(me, 1.3);
      me.haste *= 1.1;
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
  // ---- 追加のふつう ----
  { id: 'feast', icon: '🍖', name: '満腹', desc: '最大HP +25・素早さ -5%', rarity: 'common', apply: (w, me) => ((me.maxHp += 25), (me.hp += 25), (me.speedMul *= 0.95)) },
  {
    id: 'sharp',
    icon: '🔪',
    name: '鋭さ',
    desc: '武器の攻撃のダメージ +0.5',
    rarity: 'common',
    outgoing: (world, me, target, amount, opts) => (isWeaponHit(opts) ? amount + 0.5 : amount),
  },
  {
    id: 'firstAid',
    icon: '🩹',
    name: '応急手当',
    desc: '1度だけ、HPが30%を切ったら10回復',
    rarity: 'common',
    update(world, me, foe, dt, st) {
      if (st.used || me.hp >= me.maxHp * 0.3) return;
      st.used = true;
      heal(world, me, 10);
    },
  },
  {
    id: 'sniper',
    icon: '🔭',
    name: '狙い撃ち',
    desc: '飛び道具: 離れた相手(220以上)へのダメージ +40% / 近接: ダメージ +12%',
    kinds: { far: '離れた相手(220以上)へのダメージ +40%', near: 'ダメージ +12%' },
    rarity: 'common',
    outgoing(world, me, target, amount) {
      if (me.def.kind !== 'ranged') return amount * 1.12;
      return Math.hypot(target.x - me.x, target.y - me.y) > 220 ? amount * 1.4 : amount;
    },
  },
  { id: 'jump', icon: '🦘', name: '跳躍', desc: '動きが15%速くなり、8%で攻撃をよける', rarity: 'common', apply: (w, me) => (me.speedMul *= 1.15), incoming: dodge(0.08) },

  // ---- 追加のレア ----
  {
    id: 'cyclone',
    icon: '🌀',
    name: 'つむじ風',
    desc: '3秒ごとに近くの相手を吹き飛ばしてしびれさせる(5ダメージ)',
    rarity: 'rare',
    update(world, me, foe, dt, st) {
      st.t = (st.t ?? 2) - dt;
      if (st.t > 0) return;
      st.t = 3;
      world.events.push({ type: 'shock', x: me.x, y: me.y, r: 170, color: '#9ad7ff' });
      for (const o of enemiesNear(world, me, 170)) {
        skillDamage(world, me, o, 5);
        o.stun = Math.max(o.stun, 0.3);
        knockback(me, o, 520);
      }
    },
  },
  {
    id: 'charge',
    icon: '🔋',
    name: '充電',
    desc: '5秒ためると、次に当てた攻撃が +5ダメージ',
    rarity: 'rare',
    update(world, me, foe, dt, st) {
      st.t = (st.t || 0) + dt;
    },
    onHit(world, me, foe, info, st) {
      if ((st.t || 0) < 5) return;
      st.t = 0;
      world.events.push({ type: 'zap', x: foe.x, y: foe.y, big: false });
      skillDamage(world, me, foe, 5);
    },
  },
  {
    id: 'frostArmor',
    icon: '🧊',
    name: '氷の鎧',
    desc: '攻撃されると40%で相手を0.6秒凍らせる(2秒に1回まで)',
    rarity: 'rare',
    incoming(world, me, src, amount, opts, st) {
      if (!src || src === me || !isWeaponHit(opts) || (st.cd || 0) > world.t || world.rng() >= 0.4) return amount;
      st.cd = world.t + 2;
      src.freeze = Math.max(src.freeze, 0.6);
      src.stun = Math.max(src.stun, 0.6);
      world.events.push({ type: 'timestop', x: src.x, y: src.y, target: src.id });
      return amount;
    },
  },
  {
    id: 'lucky',
    icon: '🍀',
    name: '幸運',
    desc: '10%でダメージ2倍、6%で攻撃をよける',
    rarity: 'rare',
    outgoing(world, me, target, amount, opts) {
      if (!isWeaponHit(opts) || world.rng() >= 0.1) return amount;
      world.events.push({ type: 'crit', x: target.x, y: target.y });
      return amount * 2;
    },
    incoming(world, me, src, amount, opts) {
      if (opts.kind === 'poison' || opts.kind === 'burn' || world.rng() >= 0.06) return amount;
      world.events.push({ type: 'dodge', x: me.x, y: me.y, target: me.id });
      return 0;
    },
  },
  {
    id: 'miasma',
    icon: '🐍',
    name: '毒の霧',
    desc: '4秒ごとに近くの相手全員に毒 +1',
    rarity: 'rare',
    update(world, me, foe, dt, st) {
      st.t = (st.t ?? 2) - dt;
      if (st.t > 0) return;
      st.t = 4;
      for (const o of enemiesNear(world, me, 220)) {
        o.poison += 1;
        o.poisonSrc = me.id;
      }
    },
  },

  // ---- 追加のエピック ----
  {
    id: 'double',
    icon: '🔁',
    name: '二連撃',
    desc: '武器の攻撃が30%でもう1回当たる(80%のダメージ)',
    rarity: 'epic',
    afterDeal(world, me, target, amount, opts, st) {
      if (!isWeaponHit(opts) || (st.cd || 0) > world.t || world.rng() >= 0.3) return;
      st.cd = world.t + 0.25;
      skillDamage(world, me, target, amount * 0.8);
    },
  },
  {
    id: 'gravityWell',
    icon: '🕳️',
    name: '重力井戸',
    desc: '5秒ごとに相手全員を引き寄せて3ダメージ',
    rarity: 'epic',
    update(world, me, foe, dt, st) {
      st.t = (st.t ?? 2.5) - dt;
      if (st.t > 0) return;
      st.t = 5;
      world.events.push({ type: 'shock', x: me.x, y: me.y, r: 260, color: '#5a3a8a' });
      for (const o of enemiesNear(world, me, 9999)) {
        const d = Math.hypot(me.x - o.x, me.y - o.y) || 1;
        o.vx += ((me.x - o.x) / d) * 520;
        o.vy += ((me.y - o.y) / d) * 520;
        skillDamage(world, me, o, 3);
      }
    },
  },
  {
    id: 'sun',
    icon: '☀️',
    name: '太陽の体',
    desc: '近くの相手は毎秒2.5ダメージを受けて燃える',
    rarity: 'epic',
    update(world, me, foe, dt, st) {
      st.t = (st.t || 0) + dt;
      if (st.t < 0.5) return;
      st.t -= 0.5;
      for (const o of enemiesNear(world, me, 110)) {
        skillDamage(world, me, o, 1.25);
        o.burnT = Math.max(o.burnT, 1);
        o.burnDps = Math.max(o.burnDps, 1);
        o.burnSrc = me.id;
      }
    },
  },
  {
    id: 'execute',
    icon: '🪓',
    name: '処刑',
    desc: 'HP30%以下の相手へのダメージ2.2倍',
    rarity: 'epic',
    outgoing: (world, me, target, amount) => (target.hp < target.maxHp * 0.3 ? amount * 2.2 : amount),
  },

  // ---- 追加のレジェンド ----
  {
    id: 'dragon',
    icon: '🐉',
    name: '竜の息吹',
    desc: '3秒ごとに火の玉を5発(各2.5ダメージ+やけど)',
    rarity: 'legend',
    update(world, me, foe, dt, st) {
      st.t = (st.t ?? 1.5) - dt;
      if (st.t > 0) return;
      st.t = 3;
      breath(world, me, foe, 5, 2.5);
    },
  },
  {
    id: 'starGuard',
    icon: '🌟',
    name: '星の加護',
    desc: '9秒ごとに1.5秒間、ダメージを受けない',
    rarity: 'legend',
    update(world, me, foe, dt, st) {
      st.t = (st.t ?? 3) - dt;
      if (st.t > 0) return;
      st.t = 9;
      st.until = world.t + 1.5;
      me.barrier = (me.barrier || 0) + 1;
      st.on = true;
      world.events.push({ type: 'block', x: me.x, y: me.y });
    },
    incoming(world, me, src, amount, opts, st) {
      if ((st.until || 0) > world.t) return 0;
      if (st.on) {
        st.on = false;
        me.barrier = Math.max(0, (me.barrier || 0) - 1);
      }
      return amount;
    },
  },
  {
    id: 'allMight',
    icon: '🌈',
    name: '全能',
    desc: '威力+20%・攻撃速度+20%・最大HP+25・毎秒1回復',
    rarity: 'legend',
    apply(world, me) {
      me.power *= 1.2;
      me.haste *= 1.2;
      me.maxHp += 25;
      me.hp += 25;
    },
    update: regen(1),
  },

  // ==== 合体進化: 必要なカードを2枚そろえると出てくる。選ぶと材料のカードと合体する ====
  {
    id: 'vampLord',
    icon: '🦇',
    name: '吸血鬼の王',
    desc: '最大HP +40・与えたダメージの35%を回復',
    rarity: 'fusion',
    needs: ['vamp', 'hp'],
    apply: (w, me) => ((me.maxHp += 40), (me.hp += 40)),
    afterDeal(world, me, target, amount, opts) {
      if (opts.kind !== 'reflect') heal(world, me, amount * 0.35);
    },
  },
  {
    id: 'hellfire',
    icon: '☄️',
    name: '獄炎爆破',
    desc: '攻撃が当たると大爆発(まわりの相手全員に4ダメージ)+強いやけど',
    rarity: 'fusion',
    needs: ['burnEdge', 'explode'],
    onHit(world, me, foe, info, st) {
      if ((st.cd || 0) > world.t) return;
      st.cd = world.t + 0.3;
      world.events.push({ type: 'boom', x: foe.x, y: foe.y, radius: 80, kind: 'bomb' });
      for (const o of world.balls) {
        if (o === me || o.dead || Math.hypot(o.x - foe.x, o.y - foe.y) > 80 + o.r) continue;
        skillDamage(world, me, o, 4);
        o.burnT = 3;
        o.burnDps = Math.max(o.burnDps, 2.5);
        o.burnSrc = me.id;
      }
    },
  },
  {
    id: 'frostDance',
    icon: '💃',
    name: '氷の舞',
    desc: '当てると+2ダメージ・ときどき凍らせる。15%でよける・素早さ+10%',
    rarity: 'fusion',
    needs: ['frostEdge', 'speed'],
    apply: (w, me) => (me.speedMul *= 1.1),
    onHit(world, me, foe, info, st) {
      foe.slow = Math.max(foe.slow, 0.2);
      foe.slowT = 1;
      if ((st.cd || 0) <= world.t) {
        st.cd = world.t + 0.3;
        skillDamage(world, me, foe, 2);
      }
      if ((st.fz || 0) <= world.t) {
        st.fz = world.t + 1.5;
        foe.freeze = Math.max(foe.freeze, 0.4);
        foe.stun = Math.max(foe.stun, 0.4);
      }
    },
    incoming: dodge(0.15),
  },
  {
    id: 'thunderEmperor',
    icon: '⚜️',
    name: '雷帝',
    desc: '2秒ごとに相手全員へ雷(4ダメージ)。当てると20%でさらに雷',
    rarity: 'fusion',
    needs: ['chainZap', 'thunderGod'],
    update(world, me, foe, dt, st) {
      st.t = (st.t ?? 1) - dt;
      if (st.t > 0) return;
      st.t = 2;
      for (const o of enemiesNear(world, me, 9999)) zap(world, me, o, 4);
    },
    onHit(world, me, foe) {
      if (world.rng() < 0.2) zap(world, me, foe, 4);
    },
  },
  {
    id: 'bladeDance',
    icon: '🎡',
    name: '剣の輪舞',
    desc: 'まわりを回る剣が4本(各1.1ダメージ)・攻撃速度 +5%',
    rarity: 'fusion',
    needs: ['extraBlade', 'twin'],
    apply(world, me) {
      for (let i = 0; i < 4; i++) addBlade(me, 1.1);
      me.haste *= 1.05;
    },
  },
  {
    id: 'missileRain',
    icon: '🎆',
    name: 'ミサイルの雨',
    desc: '1.5秒ごとに追尾ミサイル5発(各3ダメージ)',
    rarity: 'fusion',
    needs: ['missiles', 'split'],
    update(world, me, foe, dt, st) {
      st.t = (st.t ?? 0.8) - dt;
      if (st.t > 0) return;
      st.t = 1.5;
      const a = Math.atan2(foe.y - me.y, foe.x - me.x) + Math.PI;
      for (let i = 0; i < 5; i++) {
        skillShot(world, me, foe, a + (i - 2) * 0.4, 260, 3, 'missile', {
          life: 3.5,
          update: (world, p, owner, foe, dt) => homingStep(p, foe, 3.4, dt, 440),
        });
      }
    },
  },
  {
    id: 'immortal',
    icon: '👼',
    name: '不滅',
    desc: '2度までよみがえる(HP60% → HP30%)',
    rarity: 'fusion',
    needs: ['guts', 'undying'],
    lethal(world, me, st) {
      st.n = st.n || 0;
      if (st.n >= 2) return false;
      me.hp = me.maxHp * (st.n === 0 ? 0.6 : 0.3);
      st.n++;
      me.poison = 0;
      me.burnT = 0;
      world.events.push({ type: 'rebirth', x: me.x, y: me.y, target: me.id });
      return true;
    },
  },
  {
    id: 'deathblow',
    icon: '💀',
    name: '必殺',
    desc: '威力 +15%・35%でダメージ3倍',
    rarity: 'fusion',
    needs: ['crit', 'power'],
    apply: (w, me) => (me.power *= 1.15),
    outgoing(world, me, target, amount, opts) {
      if (opts.kind === 'poison' || opts.kind === 'burn' || world.rng() >= 0.35) return amount;
      world.events.push({ type: 'crit', x: target.x, y: target.y });
      return amount * 3;
    },
  },
  {
    id: 'fortress',
    icon: '🏰',
    name: '要塞',
    desc: '受けるダメージ -10%・15秒ごとに10ダメージを防ぐバリアを張り直す',
    rarity: 'fusion',
    needs: ['armor', 'barrier'],
    apply: (w, me, st) => ((st.left = 10), (me.barrier = (me.barrier || 0) + 10)),
    update(world, me, foe, dt, st) {
      st.t = (st.t || 0) + dt;
      if (st.t < 15) return;
      st.t = 0;
      me.barrier = (me.barrier || 0) + (10 - st.left);
      st.left = 10;
    },
    incoming(world, me, src, amount, opts, st) {
      amount *= 0.9;
      if (st.left <= 0) return amount;
      const block = Math.min(st.left, amount);
      st.left -= block;
      me.barrier = Math.max(0, (me.barrier || 0) - block);
      if (st.left <= 0) world.events.push({ type: 'block', x: me.x, y: me.y });
      return amount - block;
    },
  },
  {
    id: 'rot',
    icon: '🧪',
    name: '腐敗',
    desc: '攻撃が当たると毒 +1・呪い +1(0.5秒に1回まで)',
    rarity: 'fusion',
    needs: ['poisonEdge', 'curseEdge'],
    onHit(world, me, foe, info, st) {
      if ((st.cd || 0) > world.t) return;
      st.cd = world.t + 0.5;
      foe.poison += 1;
      foe.poisonSrc = me.id;
      foe.curse += 1;
    },
  },
  {
    id: 'worldTree',
    icon: '🌳',
    name: '世界樹',
    desc: '毎秒HPが3回復・試合開始の時点で8回分成長している',
    rarity: 'fusion',
    needs: ['regen', 'pregrow'],
    apply: (world, me) => preGrow(world, me, 8),
    update: regen(3),
  },
  {
    id: 'demon',
    icon: '👹',
    name: '鬼神',
    desc: '減ったHPが多いほど威力が大きく上がる(HP1%ごとに+1.5%)・受けたダメージの30%を返す',
    rarity: 'fusion',
    needs: ['rage', 'reflect'],
    outgoing: (world, me, target, amount) => amount * (1 + 1.5 * Math.max(0, 1 - me.hp / me.maxHp)),
    incoming(world, me, src, amount, opts) {
      if (src && src !== me && opts.kind !== 'reflect' && opts.kind !== 'skill') dealDamage(world, me, src, amount * 0.3, { kind: 'reflect' });
      return amount;
    },
  },
  {
    id: 'infinite',
    icon: '🧬',
    name: '無限進化',
    desc: '攻撃が当たるたびに、さらに2回成長する',
    rarity: 'fusion',
    needs: ['growth2', 'overgrow'],
    onHit(world, me, foe, info) {
      if (!me.def.onHit) return;
      me.def.onHit(world, me, foe, info);
      if (!foe.dead) me.def.onHit(world, me, foe, info);
    },
  },
  {
    id: 'colossus',
    icon: '🏔️',
    name: '超巨神',
    desc: '大きさ +60%・最大HP +160・威力 +50%・素早さ -12%',
    rarity: 'fusion',
    needs: ['big', 'titan'],
    apply(world, me) {
      resize(me, 1.6);
      me.maxHp += 160;
      me.hp += 160;
      me.power *= 1.5;
      me.speedMul *= 0.88;
    },
  },
  {
    id: 'ninja',
    icon: '🥷',
    name: '忍',
    desc: '大きさ -30%・素早さ +25%・攻撃速度 +15%・22%でよける',
    rarity: 'fusion',
    needs: ['small', 'haste'],
    apply(world, me) {
      resize(me, 0.7);
      me.speedMul *= 1.25;
      me.haste *= 1.15;
    },
    incoming: dodge(0.22),
  },
  {
    id: 'timeKing',
    icon: '⌛',
    name: '時の王',
    desc: '攻撃速度 +50%・2.5秒ごとに相手全員の時間を1秒止める',
    rarity: 'fusion',
    needs: ['timeLord', 'haste'],
    apply: (w, me) => (me.haste *= 1.5),
    update(world, me, foe, dt, st) {
      st.t = (st.t ?? 1.5) - dt;
      if (st.t > 0) return;
      st.t = 2.5;
      for (const o of enemiesNear(world, me, 9999)) {
        o.freeze = Math.max(o.freeze, 1);
        o.stun = Math.max(o.stun, 1);
        world.events.push({ type: 'timestop', x: o.x, y: o.y, target: o.id });
      }
    },
  },
  {
    id: 'ironThorns',
    icon: '🦔',
    name: '鉄のトゲ',
    desc: 'ぶつかった相手に5ダメージ・受けるダメージ -10%',
    rarity: 'fusion',
    needs: ['thorns', 'armor'],
    contact(world, me, foe, st) {
      if ((st.cd || 0) > world.t) return;
      st.cd = world.t + 0.3;
      skillDamage(world, me, foe, 5);
    },
    incoming: (w, me, src, amount) => amount * 0.9,
  },
  {
    id: 'sunGod',
    icon: '🔆',
    name: '太陽神',
    desc: '広い範囲の相手が毎秒4ダメージを受けて激しく燃える',
    rarity: 'fusion',
    needs: ['sun', 'burnEdge'],
    update(world, me, foe, dt, st) {
      st.t = (st.t || 0) + dt;
      if (st.t < 0.5) return;
      st.t -= 0.5;
      for (const o of enemiesNear(world, me, 170)) {
        skillDamage(world, me, o, 2);
        o.burnT = Math.max(o.burnT, 1.5);
        o.burnDps = Math.max(o.burnDps, 2);
        o.burnSrc = me.id;
      }
    },
  },
  {
    id: 'vortex',
    icon: '🌪️',
    name: '渦の王',
    desc: '2.5秒ごとに相手全員を引き寄せ、まわりを吹き飛ばす大爆発(8ダメージ)',
    rarity: 'fusion',
    needs: ['gravityWell', 'cyclone'],
    update(world, me, foe, dt, st) {
      st.t = (st.t ?? 1.5) - dt;
      if (st.t > 0) return;
      st.t = 2.5;
      world.events.push({ type: 'boom', x: me.x, y: me.y, radius: 200, kind: 'bomb' });
      for (const o of enemiesNear(world, me, 9999)) {
        const d = Math.hypot(me.x - o.x, me.y - o.y) || 1;
        if (d < 200 + o.r) {
          skillDamage(world, me, o, 8);
          knockback(me, o, 600);
        } else {
          o.vx += ((me.x - o.x) / d) * 600;
          o.vy += ((me.y - o.y) / d) * 600;
        }
      }
    },
  },
  {
    id: 'assassin',
    icon: '🦂',
    name: '暗殺者',
    desc: '武器の攻撃 +1ダメージ・HP30%以下の相手へはダメージ3倍',
    rarity: 'fusion',
    needs: ['execute', 'sharp'],
    outgoing(world, me, target, amount, opts) {
      if (isWeaponHit(opts)) amount += 1;
      return target.hp < target.maxHp * 0.3 ? amount * 3 : amount;
    },
  },
  {
    id: 'dragonKing',
    icon: '🐲',
    name: '竜王',
    desc: '2.2秒ごとに火の玉を5発(各3ダメージ+やけど)・威力 +15%',
    rarity: 'fusion',
    needs: ['dragon', 'power'],
    apply: (w, me) => (me.power *= 1.15),
    update(world, me, foe, dt, st) {
      st.t = (st.t ?? 1) - dt;
      if (st.t > 0) return;
      st.t = 2.2;
      breath(world, me, foe, 5, 3);
    },
  },
  {
    id: 'miracle',
    icon: '🌠',
    name: '奇跡',
    desc: '15%でよける・25%でダメージ2倍・8秒ごとに1.2秒無敵',
    rarity: 'fusion',
    needs: ['lucky', 'starGuard'],
    update(world, me, foe, dt, st) {
      st.t = (st.t ?? 2) - dt;
      if (st.t > 0) return;
      st.t = 8;
      st.until = world.t + 1.2;
      world.events.push({ type: 'block', x: me.x, y: me.y });
    },
    outgoing(world, me, target, amount, opts) {
      if (!isWeaponHit(opts) || world.rng() >= 0.25) return amount;
      world.events.push({ type: 'crit', x: target.x, y: target.y });
      return amount * 2;
    },
    incoming(world, me, src, amount, opts, st) {
      if ((st.until || 0) > world.t) return 0;
      return dodge(0.15)(world, me, src, amount, opts);
    },
  },

  // ==== 第3弾: 成長・体の動き・武器との組み合わせ・時間・対策・カード選びのカード ====
  // ---- ふつう ----
  {
    id: 'fastStart',
    icon: '🏁',
    name: '先手必勝',
    desc: '試合の最初の20秒、与えるダメージ +100%',
    rarity: 'common',
    outgoing: (world, me, target, amount) => (world.t < 20 ? amount * 2 : amount),
  },
  {
    id: 'cleanse',
    icon: '🧼',
    name: '浄化',
    desc: '最大HP +15・2.5秒ごとに 毒・呪いを1つずつ消し、やけど・遅くなる効果も消す',
    rarity: 'common',
    apply: (w, me) => ((me.maxHp += 15), (me.hp += 15)),
    update(world, me, foe, dt, st) {
      st.t = (st.t || 0) + dt;
      if (st.t < 2.5) return;
      st.t = 0;
      me.poison = Math.max(0, me.poison - 1);
      me.curse = Math.max(0, me.curse - 1);
      me.burnT = 0;
      me.slow = 0;
    },
  },
  {
    id: 'lastStand',
    icon: '🧱',
    name: '背水の陣',
    desc: 'HPが40%以下のあいだ、受けるダメージ -25%',
    rarity: 'common',
    incoming: (world, me, src, amount) => (me.hp < me.maxHp * 0.4 ? amount * 0.75 : amount),
  },
  {
    id: 'heavy',
    icon: '⚓',
    name: '重い体',
    desc: '吹き飛ばされにくい(-40%)・最大HP +10',
    rarity: 'common',
    apply(world, me) {
      me.knockMul = (me.knockMul ?? 1) * 0.6;
      me.maxHp += 10;
      me.hp += 10;
    },
  },
  {
    id: 'seed',
    icon: '🌰',
    name: '成長の種',
    desc: '6秒ごとに、当てなくても武器が1回成長する',
    rarity: 'common',
    update(world, me, foe, dt, st) {
      st.t = (st.t || 0) + dt;
      if (st.t < 6) return;
      st.t = 0;
      growQuiet(world, me, foe);
    },
  },

  {
    id: 'bodySlam',
    icon: '🤜',
    name: '体当たり',
    desc: '近接・体の武器: ぶつかった相手に1.5ダメージ / 飛び道具: ぶつかった相手を強く押し返して距離を取る(1ダメージ)',
    rarity: 'common',
    kinds: { far: 'ぶつかった相手を強く押し返して距離を取る(1ダメージ)', near: 'ぶつかった相手に1.5ダメージ' },
    contact(world, me, foe, st) {
      if ((st.cd || 0) > world.t) return;
      st.cd = world.t + 0.7;
      if (me.def.kind === 'ranged') {
        skillDamage(world, me, foe, 1);
        knockback(me, foe, 520);
      } else {
        skillDamage(world, me, foe, 1.5);
      }
    },
  },
  {
    id: 'quickDraw',
    icon: '🤠',
    name: '早撃ち',
    desc: '飛び道具: 攻撃速度 +18% / 近接・体の武器: 攻撃速度 +28%・素早さ +10%',
    rarity: 'rare',
    kinds: { far: '攻撃速度 +18%', near: '攻撃速度 +28%・素早さ +10%' },
    apply(world, me) {
      if (me.def.kind === 'ranged') me.haste *= 1.18;
      else {
        me.haste *= 1.28;
        me.speedMul *= 1.1;
      }
    },
  },
  // ---- レア ----
  {
    id: 'lateBloom',
    icon: '🌇',
    name: '後半型',
    desc: '試合開始から25秒たつと、与えるダメージ +45%',
    rarity: 'rare',
    outgoing: (world, me, target, amount) => (world.t >= 25 ? amount * 1.45 : amount),
  },
  {
    id: 'combo',
    icon: '🥊',
    name: '連撃',
    desc: '1.4秒以内に続けて当てるとコンボ。1コンボごとにダメージ +12%(最大+120%)。攻撃速度 +10%',
    rarity: 'rare',
    apply: (w, me) => (me.haste *= 1.1),
    onHit(world, me, foe, info, st) {
      st.n = world.t - (st.last ?? -9) < 1.4 ? Math.min(10, (st.n || 0) + 1) : 1;
      st.last = world.t;
      if (st.n >= 3 && st.n % 2 === 1) world.events.push({ type: 'combo', x: me.x, y: me.y, n: st.n });
    },
    outgoing(world, me, target, amount, opts, st) {
      if (!isWeaponHit(opts) || world.t - (st.last ?? -9) >= 1.4) return amount;
      return amount * (1 + 0.12 * (st.n || 0));
    },

  },
  {
    id: 'mastery',
    icon: '🎓',
    name: '武器の名人',
    desc: '近接武器: 刃が20%長く・30%太くなる / 飛び道具: 弾の当たり判定が50%大きくなる。どちらも威力 +12%',
    rarity: 'rare',
    kinds: { far: '弾の当たり判定が50%大きくなる', near: '刃が20%長く・30%太くなる' },
    apply(world, me) {
      me.power *= 1.12;
      if (me.def.kind === 'ranged') {
        me.shotScale = (me.shotScale || 1) * 1.5;
        return;
      }
      for (const bl of me.blades) {
        if (bl.extra) continue;
        bl.rOut = bl.rIn + (bl.rOut - bl.rIn) * 1.2;
        bl.w *= 1.3;
      }
    },
  },
  {
    id: 'landing',
    icon: '💢',
    name: '着地の衝撃',
    desc: '勢いよく床に着地すると、まわりの相手に衝撃(7ダメージ・1秒に1回まで)',
    rarity: 'rare',
    update(world, me, foe, dt, st) {
      const onFloor = me.y >= ARENA - me.r - 3;
      if (onFloor && (st.vy || 0) > 250 && (st.cd || 0) <= world.t) {
        st.cd = world.t + 1;
        world.events.push({ type: 'shock', x: me.x, y: ARENA - 6, r: 160, color: '#a07a50' });
        for (const o of enemiesNear(world, me, 160)) {
          skillDamage(world, me, o, 7);
          o.vy -= 300 * (o.knockMul ?? 1);
        }
      }
      st.vy = me.vy;
    },
  },
  {
    id: 'underdog',
    icon: '🐺',
    name: '下剋上',
    desc: 'HPの割合で相手に負けているとき、当てるともう1回成長し、ダメージ +15%',
    rarity: 'rare',
    outgoing: (world, me, target, amount) => (me.hp / me.maxHp < target.hp / target.maxHp ? amount * 1.15 : amount),
    onHit(world, me, foe, info) {
      if (me.def.onHit && me.hp / me.maxHp < foe.hp / foe.maxHp) me.def.onHit(world, me, foe, info);
    },
  },
  {
    id: 'scout',
    icon: '🔍',
    name: '目利き',
    desc: 'これから先のカード選びで、出てくるカードが1枚ふえる(重ねがけは2枚まで)・威力 +20%',
    rarity: 'rare',
    apply: (w, me) => (me.power *= 1.2),
  },

  // ---- エピック ----
  {
    id: 'focus',
    icon: '🧘',
    name: '集中',
    desc: '2秒間攻撃を受けなかったら、次に当てた攻撃が5倍・受けるダメージ -10%',
    rarity: 'epic',
    incoming(world, me, src, amount, opts, st) {
      if (isWeaponHit(opts) && amount > 0) st.calm = world.t;
      return amount * 0.9;
    },
    outgoing(world, me, target, amount, opts, st) {
      if (!isWeaponHit(opts) || world.t - Math.max(st.calm ?? 0, st.used ?? 0) < 2) return amount;
      st.used = world.t;
      world.events.push({ type: 'crit', x: target.x, y: target.y });
      return amount * 5;
    },
  },
  {
    id: 'pierce',
    icon: '🏹',
    name: '貫通',
    desc: '飛び道具: 弾が相手の刃で防がれない / 近接: 刃がはじかれない。どちらも威力 +30%',
    rarity: 'rare',
    kinds: { far: '弾が相手の刃で防がれない', near: '刃がはじかれない' },
    apply(world, me) {
      me.power *= 1.3;
      if (me.def.kind === 'ranged') me.pierce = true;
      else for (const bl of me.blades) bl.parry = false;
    },
  },
  {
    id: 'mirrorShield',
    icon: '🔰',
    name: '鏡の盾',
    desc: '飛んできた弾を35%ではね返す(自分はダメージを受けない)・受けるダメージ -15%',
    rarity: 'epic',
    incoming(world, me, src, amount, opts) {
      if (!opts.projectile || !src || src === me || world.rng() >= 0.35) return amount * 0.85;
      world.events.push({ type: 'block', x: me.x, y: me.y });
      const a = Math.atan2(src.y - me.y, src.x - me.x);
      skillShot(world, me, src, a, 560, Math.min(8, amount), 'skillbolt', {
        update: (world, p, owner, foe, dt) => homingStep(p, src.dead ? foe : src, 3, dt, 560),
      });
      return 0;
    },
  },
  {
    id: 'learn',
    icon: '📚',
    name: '学習',
    desc: '攻撃を受けると50%で、自分の武器が1回成長する(相手から学ぶ)',
    rarity: 'epic',
    incoming(world, me, src, amount, opts, st) {
      if (src && src !== me && isWeaponHit(opts) && (st.cd || 0) <= world.t && world.rng() < 0.5) {
        st.cd = world.t + 0.3;
        growQuiet(world, me, src);
      }
      return amount;
    },
  },
  {
    id: 'luckyDraw',
    icon: '🎴',
    name: '天運',
    desc: 'これから先のカード選びで、エピック・レジェンドが出やすくなる・攻撃速度 +22%',
    rarity: 'epic',
    apply: (w, me) => (me.haste *= 1.22),
  },

  // ---- レジェンド ----
  {
    id: 'spring',
    icon: '⛲',
    name: '無限の泉',
    desc: '5秒ごとに 毒・呪い・やけどを全部消して8回復し、その試合の威力が+6%ずつ上がる',
    rarity: 'legend',
    update(world, me, foe, dt, st) {
      st.t = (st.t || 0) + dt;
      if (st.t < 5) return;
      st.t = 0;
      me.poison = 0;
      me.curse = 0;
      me.burnT = 0;
      heal(world, me, 8);
      me.power *= 1.06;
    },
  },
  {
    id: 'homing',
    icon: '🧿',
    name: '必中',
    desc: '飛び道具: 自分の弾が相手の方へ曲がっていく / 近接: 刃が30%長くなる。どちらも威力 +15%',
    rarity: 'legend',
    kinds: { far: '自分の弾が相手の方へ曲がっていく', near: '刃が30%長くなる' },
    apply(world, me) {
      me.power *= 1.15;
      if (me.def.kind === 'ranged') return;
      for (const bl of me.blades) if (!bl.extra) bl.rOut = bl.rIn + (bl.rOut - bl.rIn) * 1.3;
    },
    update(world, me, foe, dt) {
      if (me.def.kind !== 'ranged') return;
      for (const p of world.projectiles) {
        if (p.owner !== me.id || p.gravity || !(p.vx || p.vy) || p.age < 0.05) continue;
        const target = foeOf(world, me);
        const want = Math.atan2(target.y - p.y, target.x - p.x);
        const cur = Math.atan2(p.vy, p.vx);
        const diff = ((want - cur + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        const a = cur + Math.max(-2.4 * dt, Math.min(2.4 * dt, diff));
        const sp = Math.hypot(p.vx, p.vy);
        p.vx = Math.cos(a) * sp;
        p.vy = Math.sin(a) * sp;
      }
    },
  },

  // ==== 第3弾の合体進化 ====
  {
    id: 'ranbu',
    icon: '💫',
    name: '乱舞',
    desc: 'コンボ1つごとにダメージ +18%(最大+234%)・武器の攻撃が45%でもう1回当たる',
    rarity: 'fusion',
    needs: ['combo', 'double'],
    onHit(world, me, foe, info, st) {
      st.n = world.t - (st.last ?? -9) < 1.4 ? Math.min(13, (st.n || 0) + 1) : 1;
      st.last = world.t;
      if (st.n >= 3 && st.n % 2 === 1) world.events.push({ type: 'combo', x: me.x, y: me.y, n: st.n });
    },
    outgoing(world, me, target, amount, opts, st) {
      if (!isWeaponHit(opts) || world.t - (st.last ?? -9) >= 1.4) return amount;
      return amount * (1 + 0.18 * (st.n || 0));
    },
    afterDeal(world, me, target, amount, opts, st) {
      if (!isWeaponHit(opts) || (st.cd || 0) > world.t || world.rng() >= 0.45) return;
      st.cd = world.t + 0.25;
      skillDamage(world, me, target, amount * 0.8);
    },
  },
  {
    id: 'marksman',
    icon: '🦅',
    name: '狙撃手',
    desc: '弾が防がれない・離れた相手へのダメージ +80%(近接なら刃がはじかれず +35%)。どちらも威力 +15%',
    rarity: 'fusion',
    kinds: { far: '弾が防がれない・離れた相手に +80%', near: '刃がはじかれず、ダメージ +35%' },
    needs: ['pierce', 'sniper'],
    apply(world, me) {
      me.power *= 1.15;
      if (me.def.kind === 'ranged') me.pierce = true;
      else for (const bl of me.blades) bl.parry = false;
    },
    outgoing(world, me, target, amount) {
      if (me.def.kind !== 'ranged') return amount * 1.35;
      return Math.hypot(target.x - me.x, target.y - me.y) > 200 ? amount * 1.8 : amount;
    },
  },
  {
    id: 'oneShot',
    icon: '🎇',
    name: '一撃必殺',
    desc: '2秒間攻撃を受けなかったら、次の攻撃が5倍・ふだんも25%でダメージ2倍',
    rarity: 'fusion',
    needs: ['focus', 'crit'],
    incoming(world, me, src, amount, opts, st) {
      if (isWeaponHit(opts) && amount > 0) st.calm = world.t;
      return amount;
    },
    outgoing(world, me, target, amount, opts, st) {
      if (!isWeaponHit(opts)) return amount;
      if (world.t - Math.max(st.calm ?? 0, st.used ?? 0) >= 2) {
        st.used = world.t;
        world.events.push({ type: 'crit', x: target.x, y: target.y });
        return amount * 5;
      }
      if (world.rng() < 0.25) {
        world.events.push({ type: 'crit', x: target.x, y: target.y });
        return amount * 2;
      }
      return amount;
    },
  },
  {
    id: 'holySpring',
    icon: '💧',
    name: '聖なる泉',
    desc: '毎秒2.5回復・毒と呪いとやけどがつかない',
    rarity: 'fusion',
    needs: ['cleanse', 'regen'],
    update(world, me, foe, dt, st) {
      me.poison = 0;
      me.curse = 0;
      me.burnT = 0;
      regen(2.5)(world, me, foe, dt, st);
    },
  },
  {
    id: 'earthRage',
    icon: '🪨',
    name: '大地の怒り',
    desc: '着地するたびに大きな地震(まわりの相手に10ダメージ)・吹き飛ばされにくい(-70%)',
    rarity: 'fusion',
    needs: ['landing', 'heavy'],
    apply: (w, me) => (me.knockMul = (me.knockMul ?? 1) * 0.3),
    update(world, me, foe, dt, st) {
      const onFloor = me.y >= ARENA - me.r - 3;
      if (onFloor && (st.vy || 0) > 200 && (st.cd || 0) <= world.t) {
        st.cd = world.t + 0.8;
        world.events.push({ type: 'quake', x: me.x, y: ARENA - 4 });
        world.events.push({ type: 'shock', x: me.x, y: ARENA - 6, r: 190, color: '#a07a50' });
        for (const o of enemiesNear(world, me, 210)) {
          skillDamage(world, me, o, 10);
          o.vy -= 420 * (o.knockMul ?? 1);
          o.stun = Math.max(o.stun, 0.2);
        }
      }
      st.vy = me.vy;
    },
  },
  {
    id: 'perfectReflect',
    icon: '💠',
    name: '完全反射',
    desc: '飛んできた弾を40%ではね返し、受けたダメージの40%を相手に返す',
    rarity: 'fusion',
    needs: ['mirrorShield', 'reflect'],
    incoming(world, me, src, amount, opts) {
      if (!src || src === me) return amount;
      if (opts.projectile && world.rng() < 0.4) {
        world.events.push({ type: 'block', x: me.x, y: me.y });
        const a = Math.atan2(src.y - me.y, src.x - me.x);
        skillShot(world, me, src, a, 600, Math.min(10, amount * 1.2), 'skillbolt', {
          update: (world, p, owner, foe, dt) => homingStep(p, src.dead ? foe : src, 3.5, dt, 600),
        });
        return 0;
      }
      if (opts.kind !== 'reflect' && opts.kind !== 'skill') dealDamage(world, me, src, amount * 0.4, { kind: 'reflect' });
      return amount;
    },
  },
  {
    id: 'genius',
    icon: '🧠',
    name: '天才',
    desc: '3秒ごとに武器が1回成長・攻撃を受けると60%でも成長',
    rarity: 'fusion',
    needs: ['seed', 'learn'],
    update(world, me, foe, dt, st) {
      st.t = (st.t || 0) + dt;
      if (st.t < 3) return;
      st.t = 0;
      growQuiet(world, me, foe);
    },
    incoming(world, me, src, amount, opts, st) {
      if (src && src !== me && isWeaponHit(opts) && (st.cd || 0) <= world.t && world.rng() < 0.6) {
        st.cd = world.t + 0.25;
        growQuiet(world, me, src);
      }
      return amount;
    },
  },
  {
    id: 'fortune',
    icon: '💎',
    name: '強運',
    desc: 'これから先のカード選びで、カードが2枚ふえてレジェンドがとても出やすくなる・威力 +40%',
    rarity: 'fusion',
    needs: ['scout', 'luckyDraw'],
    apply: (w, me) => (me.power *= 1.4),
  },
  {
    id: 'lateKing',
    icon: '🌅',
    name: '大器晩成',
    desc: '20秒たつと威力 +40%・負けているときは当てるたびに2回多く成長する',
    rarity: 'fusion',
    needs: ['lateBloom', 'underdog'],
    outgoing: (world, me, target, amount) => (world.t >= 20 ? amount * 1.4 : amount),
    onHit(world, me, foe, info) {
      if (!me.def.onHit || me.hp / me.maxHp >= foe.hp / foe.maxHp) return;
      me.def.onHit(world, me, foe, info);
      if (!foe.dead) me.def.onHit(world, me, foe, info);
    },
  },

  // ==== 武器進化: ボスを倒したときなどに選ぶ。重ねるほど武器の名前が「改 → 真 → 極 → 神」と変わる ====
  { id: 'aPower', icon: '🔺', name: '力の覚醒', desc: '武器の威力 +45%', rarity: 'awaken', apply: (w, me) => (awaken(me), (me.power *= 1.45)) },
  { id: 'aSpeed', icon: '💨', name: '速さの覚醒', desc: '攻撃速度 +30%・素早さ +10%', rarity: 'awaken', apply: (w, me) => (awaken(me), (me.haste *= 1.3), (me.speedMul *= 1.1)) },
  {
    id: 'aGrowth',
    icon: '🌻',
    name: '成長の覚醒',
    desc: '最初から3回分成長・当たると50%でもう1回成長',
    rarity: 'awaken',
    apply: (world, me) => (awaken(me), preGrow(world, me, 3)),
    onHit(world, me, foe, info) {
      if (me.def.onHit && world.rng() < 0.5) me.def.onHit(world, me, foe, info);
    },
  },
  {
    id: 'aGuard',
    icon: '🏯',
    name: '守りの覚醒',
    desc: '最大HP +50・受けるダメージ -10%',
    rarity: 'awaken',
    apply: (w, me) => (awaken(me), (me.maxHp += 50), (me.hp += 50)),
    incoming: (w, me, src, amount) => amount * 0.9,
  },
  {
    id: 'aEcho',
    icon: '👥',
    name: '残像の覚醒',
    desc: '武器の攻撃が25%でもう1回同じダメージで当たる',
    rarity: 'awaken',
    apply: (w, me) => awaken(me),
    afterDeal(world, me, target, amount, opts, st) {
      if (!isWeaponHit(opts) || (st.cd || 0) > world.t || world.rng() >= 0.25) return;
      st.cd = world.t + 0.2;
      skillDamage(world, me, target, amount);
    },
  },
  {
    id: 'aLight',
    icon: '✨',
    name: '光の覚醒',
    desc: '2秒ごとに光の衝撃波(まわりの相手全員に6ダメージ)',
    rarity: 'awaken',
    apply: (w, me) => awaken(me),
    update(world, me, foe, dt, st) {
      st.t = (st.t ?? 1.5) - dt;
      if (st.t > 0) return;
      st.t = 2;
      world.events.push({ type: 'shock', x: me.x, y: me.y, r: 190, color: '#ffe066' });
      for (const o of enemiesNear(world, me, 190)) {
        skillDamage(world, me, o, 6);
        knockback(me, o, 260);
      }
    },
  },
  {
    id: 'aBlood',
    icon: '🩸',
    name: '血の覚醒',
    desc: '当てるたびに0.8回復し、その試合の威力が+1%ずつ上がり続ける',
    rarity: 'awaken',
    apply: (w, me) => awaken(me),
    onHit(world, me) {
      heal(world, me, 0.8);
      me.power *= 1.01;
    },
  },
  {
    id: 'aFlame',
    icon: '♨️',
    name: '炎の覚醒',
    desc: '武器の攻撃で相手が燃える(2秒間・毎秒2.5)',
    rarity: 'awaken',
    apply: (w, me) => awaken(me),
    onHit(world, me, foe) {
      foe.burnT = 2;
      foe.burnDps = Math.max(foe.burnDps, 2.5);
      foe.burnSrc = me.id;
    },
  },
  {
    id: 'aKing',
    icon: '👑',
    name: '王の覚醒',
    desc: '威力+15%・最大HP+25・攻撃速度+10%・素早さ+5%',
    rarity: 'awaken',
    apply(world, me) {
      awaken(me);
      me.power *= 1.15;
      me.maxHp += 25;
      me.hp += 25;
      me.haste *= 1.1;
      me.speedMul *= 1.05;
    },
  },
  {
    id: 'aChaos',
    icon: '🎲',
    name: '混沌の覚醒',
    desc: '当てるたびにランダム: 雷(4ダメージ) / 毒+1 / 2回復',
    rarity: 'awaken',
    apply: (w, me) => awaken(me),
    onHit(world, me, foe, info, st) {
      if ((st.cd || 0) > world.t) return;
      st.cd = world.t + 0.4;
      const r = world.rng();
      if (r < 1 / 3) zap(world, me, foe, 4);
      else if (r < 2 / 3) {
        foe.poison += 1;
        foe.poisonSrc = me.id;
      } else heal(world, me, 2);
    },
  },

  // ==== 呪いのカード: とても強いが、代わりに弱点がつく ====
  {
    id: 'devil',
    icon: '😈',
    name: '悪魔の契約',
    desc: '威力 +80% / 最大HP -25',
    rarity: 'cursed',
    apply(world, me) {
      me.power *= 1.8;
      me.maxHp = Math.max(30, me.maxHp - 25);
      me.hp = Math.min(me.hp, me.maxHp);
    },
  },
  {
    id: 'bloodPrice',
    icon: '💉',
    name: '血の代償',
    desc: '攻撃速度 +50% / 毎秒HPが0.6減る(HP1より下にはならない)',
    rarity: 'cursed',
    apply: (w, me) => (me.haste *= 1.5),
    update(world, me, foe, dt) {
      me.hp = Math.max(Math.min(me.hp, 1), me.hp - 0.6 * dt);
    },
  },
  {
    id: 'gambler',
    icon: '🎰',
    name: 'ギャンブラー',
    desc: '与えるダメージが 50%で2.2倍 / 50%で半分',
    rarity: 'cursed',
    outgoing: (world, me, target, amount) => amount * (world.rng() < 0.5 ? 2.2 : 0.5),
  },
  {
    id: 'shackles',
    icon: '⛓️',
    name: '重い枷',
    desc: '威力 +30%・最大HP +45 / 素早さ -25%',
    rarity: 'cursed',
    apply(world, me) {
      me.power *= 1.3;
      me.maxHp += 45;
      me.hp += 45;
      me.speedMul *= 0.75;
    },
  },
  {
    id: 'glass',
    icon: '🥂',
    name: 'ガラスの大砲',
    desc: '威力 2.3倍 / 受けるダメージ 1.5倍',
    rarity: 'cursed',
    apply: (w, me) => (me.power *= 2.3),
    incoming: (w, me, src, amount) => amount * 1.5,
  },
  {
    id: 'berserk',
    icon: '🤬',
    name: '狂戦士',
    desc: '攻撃速度 +40%・威力 +20% / 受けるダメージ +25%',
    rarity: 'cursed',
    apply: (w, me) => ((me.haste *= 1.4), (me.power *= 1.2)),
    incoming: (w, me, src, amount) => amount * 1.25,
  },
];

export const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

// レア度の重みでランダムに n 枚(重複なし)。boost=true だと良いカードが出やすい(大進化)
export function drawSkills(n, rng = Math.random, boost = false) {
  // boost: true = 大進化 / 'lucky' = 天運 / 'fortune' = 強運
  const table =
    boost === 'fortune'
      ? { common: 20, rare: 30, epic: 30, legend: 20 }
      : boost === 'lucky'
        ? { common: 35, rare: 35, epic: 22, legend: 8 }
        : boost
          ? { common: 0, rare: 40, epic: 40, legend: 20 }
          : { common: 55, rare: 30, epic: 12, legend: 3 };
  const weight = (s) => table[s.rarity];
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

export const FUSIONS = SKILLS.filter((s) => s.rarity === 'fusion');
export const AWAKENS = SKILLS.filter((s) => s.rarity === 'awaken');
export const CURSED = SKILLS.filter((s) => s.rarity === 'cursed');

const pickFrom = (list, rng) => list[Math.floor(rng() * list.length)];

// 持っているカードで作れる合体進化
export function fusionsReady(owned) {
  const ids = owned.map((s) => s.id);
  return FUSIONS.filter((f) => f.needs.every((id) => ids.includes(id)));
}

// あと1枚で作れる合体進化 [{ fusion, missing }]
export function fusionsNear(owned) {
  const ids = owned.map((s) => s.id);
  const out = [];
  for (const f of FUSIONS) {
    const missing = f.needs.filter((id) => !ids.includes(id));
    if (missing.length === 1) out.push({ fusion: f, missing: SKILL_BY_ID[missing[0]] });
  }
  return out;
}

// カード選びに出す n 枚。材料がそろっていれば合体進化が混ざり(大進化なら必ず)、ときどき呪いのカードも出る
export function makeOffer(owned, n, rng = Math.random, big = false) {
  // 目利き・強運: 出てくるカードがふえる / 天運・強運: 良いカードが出やすい
  const has = (id) => owned.filter((s) => s.id === id).length;
  n += Math.min(2, has('scout')) + 2 * Math.min(1, has('fortune'));
  const luck = has('fortune') ? 'fortune' : has('luckyDraw') ? 'lucky' : false;
  const cards = drawSkills(n, rng, big || luck);
  const ready = fusionsReady(owned).slice();
  let slot = cards.length - 1;
  const fusionCount = ready.length ? (big ? Math.min(2, ready.length) : rng() < 0.6 ? 1 : 0) : 0;
  for (let i = 0; i < fusionCount; i++) {
    const f = ready.splice(Math.floor(rng() * ready.length), 1)[0];
    cards[slot--] = f;
  }
  if (!big && slot >= 0 && rng() < 0.15) cards[0] = pickFrom(CURSED, rng);
  return cards;
}

// 武器進化の候補(重複なし)
export function drawAwaken(n, rng = Math.random) {
  const pool = AWAKENS.slice();
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

// 選んだカードを持ち物に加える。合体進化は材料のカードを1枚ずつ使う
export function addSkills(owned, cards) {
  for (const c of cards) {
    for (const id of c.needs || []) {
      const i = owned.findIndex((s) => s.id === id);
      if (i >= 0) owned.splice(i, 1);
    }
    owned.push(c);
  }
  return owned;
}

// 武器進化の段階と、名前につける文字(改 → 真 → 極 → 神 → 神+1 …)
export function awakenTier(owned) {
  return owned.filter((s) => s.rarity === 'awaken').length;
}

export function awakenSuffix(tier) {
  if (tier <= 0) return '';
  const names = ['改', '真', '極', '神'];
  return '・' + (names[tier - 1] || `神+${tier - 4}`);
}

// CPUが選ぶとき: レア度の高いものを優先(同じなら先頭)
const RANK = { common: 0, rare: 1, cursed: 1.5, epic: 2, legend: 3, awaken: 4, fusion: 5 };
export function cpuPick(cards, count = 1) {
  return cards
    .slice()
    .sort((a, b) => RANK[b.rarity] - RANK[a.rarity])
    .slice(0, count);
}

export { ARENA };
