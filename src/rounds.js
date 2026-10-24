// ラウンズ: 2〜4人で戦う。負けた人がスキルカードを選んで強くなり、先に target 勝した人が優勝。
// 3人以上のときは「勝ち残り」: 勝った人は残り、負けた人は列の最後へ回り、次の人が挑戦する。
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
    queue: players.map((_, i) => i), // 次に戦う順番。先頭の2人が戦う
    pending: null, // 負けた人のカード選び { player, cards, choose }
    champion: null,
    log: [],
  };
}

export function currentPair(r) {
  return [r.queue[0], r.queue[1]];
}

// ラウンドの結果を記録する。負けた人のカード選びが pending に入る
export function reportRound(r, winnerIdx, rng = Math.random) {
  const [a, b] = currentPair(r);
  if (winnerIdx !== a && winnerIdx !== b) throw new Error('この試合に出ていない');
  const loserIdx = winnerIdx === a ? b : a;
  const winner = r.players[winnerIdx];
  const loser = r.players[loserIdx];
  winner.wins++;
  r.log.push({ round: r.round, winner: winnerIdx, loser: loserIdx });
  r.round++;
  if (winner.wins >= r.target) {
    r.champion = winner;
    r.pending = null;
    return;
  }
  // 勝った人は先頭に残り、負けた人は列の最後へ
  r.queue = [winnerIdx, ...r.queue.filter((i) => i !== winnerIdx && i !== loserIdx), loserIdx];
  loser.picks++;
  const big = loser.picks % BIG_EVERY === 0;
  r.pending = { player: loserIdx, big, cards: drawSkills(big ? 4 : 3, rng, big), choose: big ? 2 : 1 };
}

// カードを選ぶ(cards は pending.cards の中から choose 枚)
export function pickSkills(r, cards) {
  const p = r.pending;
  if (!p) return;
  if (cards.length !== p.choose || cards.some((c) => !p.cards.includes(c))) throw new Error('選び方が正しくない');
  r.players[p.player].skills.push(...cards);
  r.pending = null;
}

export function cpuPickPending(r) {
  const p = r.pending;
  return cpuPick(p.cards, p.choose);
}
