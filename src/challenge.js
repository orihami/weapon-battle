// チャレンジモード(1人用ローグライク): 自分の武器でステージを勝ち進み、勝つたびにスキルカードを選ぶ。
// 5ステージごとにボス。ボスに勝つと「武器進化」(3つから1つ)のあと「大進化」で4枚から2枚選べる。
// 材料のカードがそろうと「合体進化」が出てくる。ときどき強いが弱点もある「呪いのカード」も出る。
// 敵もステージが進むとスキルを持ち、10ステージごとのボスは武器進化もしている。
// DOMに依存しないので Node のテストから使える。

import { drawSkills, SKILLS, makeOffer, drawAwaken, addSkills } from './skills.js?v=57ad6f5';

export const BOSS_EVERY = 5;

export function newChallenge(weapon) {
  return { weapon, stage: 1, skills: [], picked: [] };
}

export function isBoss(stage) {
  return stage % BOSS_EVERY === 0;
}

// ステージの敵の強化(createBattle の opts.b)。rng は敵のスキル選び用
export function enemyBoost(stage, rng = Math.random) {
  const boss = isBoss(stage);
  const commons = SKILLS.filter((s) => s.rarity === 'common' || s.rarity === 'rare');
  const skills = [];
  for (let i = 0; i < Math.floor((stage - 1) / 2); i++) skills.push(commons[Math.floor(rng() * commons.length)]);
  if (boss) skills.push(...drawSkills(1 + Math.floor(stage / 10), rng, true), ...drawAwaken(Math.floor(stage / 10), rng));
  return {
    maxHp: Math.round((100 + 8 * (stage - 1)) * (boss ? 1.6 : 1)),
    preGrow: stage - 1,
    power: 1 + 0.03 * (stage - 1),
    skills,
    boss,
  };
}

// 勝ったあとに選べるカード。ボスのあとは大進化(4枚から2枚)で、その前に武器進化(awaken: 3つから1つ)を選ぶ
export function offerCards(ch, rng = Math.random) {
  const big = isBoss(ch.stage);
  return { big, cards: makeOffer(ch.skills, big ? 4 : 3, rng, big), choose: big ? 2 : 1, awaken: big ? drawAwaken(3, rng) : null };
}

export function takeAwaken(ch, card) {
  ch.skills.push(card);
  ch.picked.push(card.id);
}

export function takeCards(ch, cards) {
  addSkills(ch.skills, cards);
  ch.picked.push(...cards.map((c) => c.id));
  ch.stage++;
}
