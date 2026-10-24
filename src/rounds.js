// ラウンズ: 2〜4人が同じフィールドで同時に戦う。勝った人に1点、負けた人は全員スキルカードを選んで強くなる。
// 先に target 勝した人が優勝。引き分けはやり直し。
// DOMに依存しないので Node のテストから使える。

import { drawSkills, cpuPick } from './skills.js';

// 何枚目のカード選びが「大進化」(4枚から2枚選べる)になるか
export const BIG_EVERY = 3;

// players: [{ name, weapon, cpu }]
export function createRounds(players, target = 5) {
  return {
    players: players.map((p, i) => ({ ...p, idx: i, wins: 0, skills: [], picks: 0 })),
    target,
    round: 1,
    pending: null, // 今カードを選ぶ人 { player, big, cards, choose }
    waiting: [], // このあとカードを選ぶ人(先に倒れた人から)
    champion: null,
    log: [],
  };
}

// この試合に出る人(いつも全員)
export function fighters(r) {
  return r.players.map((p) => p.idx);
}

function offer(r, idx, rng) {
  const p = r.players[idx];
  p.picks++;
  const big = p.picks % BIG_EVERY === 0;
  return { player: idx, big, cards: drawSkills(big ? 4 : 3, rng, big), choose: big ? 2 : 1 };
}

// ラウンドの結果を記録する。winnerIdx = -1 は引き分け(やり直し)。
// outOrder: 倒れた順(先に倒れた人からカードを選ぶ)。省略すると番号順。
export function reportRound(r, winnerIdx, rng = Math.random, outOrder = null) {
  if (winnerIdx === -1 || winnerIdx == null) {
    r.log.push({ round: r.round, winner: -1 });
    return;
  }
  if (!r.players[winnerIdx]) throw new Error('この試合に出ていない');
  const winner = r.players[winnerIdx];
  winner.wins++;
  const losers = (outOrder || fighters(r)).filter((i) => i !== winnerIdx);
  for (const i of fighters(r)) if (i !== winnerIdx && !losers.includes(i)) losers.push(i);
  r.log.push({ round: r.round, winner: winnerIdx, losers });
  r.round++;
  if (winner.wins >= r.target) {
    r.champion = winner;
    r.pending = null;
    r.waiting = [];
    return;
  }
  const offers = losers.map((i) => offer(r, i, rng));
  r.pending = offers.shift();
  r.waiting = offers;
}

// カードを選ぶ(cards は pending.cards の中から choose 枚)。次の人へ進む
export function pickSkills(r, cards) {
  const p = r.pending;
  if (!p) return;
  if (cards.length !== p.choose || cards.some((c) => !p.cards.includes(c))) throw new Error('選び方が正しくない');
  r.players[p.player].skills.push(...cards);
  r.pending = r.waiting.shift() || null;
}

export function cpuPickPending(r) {
  const p = r.pending;
  return cpuPick(p.cards, p.choose);
}
