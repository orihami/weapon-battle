// トーナメント(勝ち抜き戦)の進行。DOMに依存しないので Node のテストから使える。
// rounds[0] が1回戦、最後が決勝。各試合は { a, b, winner }(a, b, winner は武器の定義)。

export const ROUND_NAMES = { 2: '決勝', 4: '準決勝', 8: '準々決勝', 16: '1回戦' };

export function createTournament(entries) {
  const n = entries.length;
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error('トーナメントの人数は2のべき乗にする');
  const first = [];
  for (let i = 0; i < n; i += 2) first.push({ a: entries[i], b: entries[i + 1], winner: null });
  const rounds = [first];
  for (let size = n / 2; size >= 2; size /= 2) {
    rounds.push(Array.from({ length: size / 2 }, () => ({ a: null, b: null, winner: null })));
  }
  return { rounds, champion: null };
}

export function roundName(t, roundIndex) {
  return ROUND_NAMES[t.rounds[roundIndex].length * 2] || `${roundIndex + 1}回戦`;
}

// 次に戦う試合(まだ勝者が決まっていない最初の試合)
export function nextMatch(t) {
  for (let r = 0; r < t.rounds.length; r++) {
    for (let i = 0; i < t.rounds[r].length; i++) {
      const m = t.rounds[r][i];
      if (!m.winner && m.a && m.b) return { round: r, index: i, match: m };
    }
  }
  return null;
}

// 試合の結果を記録し、勝者を次の回戦へ進める
export function reportWinner(t, winner) {
  const cur = nextMatch(t);
  if (!cur) return;
  const { round, index, match } = cur;
  if (winner !== match.a && winner !== match.b) throw new Error('勝者がこの試合の武器ではない');
  match.winner = winner;
  if (round === t.rounds.length - 1) {
    t.champion = winner;
    return;
  }
  const next = t.rounds[round + 1][Math.floor(index / 2)];
  if (index % 2 === 0) next.a = winner;
  else next.b = winner;
}

// 重複なしで n 個をランダムに選ぶ
export function pickEntries(pool, n, rng = Math.random) {
  const rest = pool.slice();
  const out = [];
  while (out.length < n && rest.length) out.push(rest.splice(Math.floor(rng() * rest.length), 1)[0]);
  return out;
}
