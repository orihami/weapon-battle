// 数の見せ方。成長に上限がないので、とても大きな数は「万・億・兆…」でまとめる。DOM非依存。

const UNITS = [
  [1e20, '垓'],
  [1e16, '京'],
  [1e12, '兆'],
  [1e8, '億'],
  [1e4, '万'],
];

export function fmtNum(n) {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : String(n);
  const a = Math.abs(n);
  if (a >= 1e24) return n.toExponential(1).replace('e+', 'e');
  for (const [v, u] of UNITS) {
    if (a >= v) {
      const x = n / v;
      return (Math.abs(x) < 100 ? x.toFixed(1).replace(/\.0$/, '') : Math.round(x)) + u;
    }
  }
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// fmtNum や「×1.5」「30%」などの表示から数を取り出す(成長した分を出すため)。数がなければ null
export function parseNum(text) {
  const m = String(text).match(/(-?\d+(?:\.\d+)?)(?:e(-?\d+))?(垓|京|兆|億|万)?/);
  if (!m) return null;
  let v = Number(m[1]) * (m[2] ? 10 ** Number(m[2]) : 1);
  if (m[3]) v *= UNITS.find(([, u]) => u === m[3])[0];
  return v;
}
