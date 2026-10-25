// 4人バトルロイヤルを回して、武器ごとの1位率を出す(基準は25%)。node scripts/ffa-balance.mjs [試合数]
// weapons.js の TUNE_FFA(3人以上の試合だけで掛ける倍率)を決めるときに使う
import { createMelee, runToEnd, mulberry32 } from '../src/engine.js';
import { WEAPONS } from '../src/weapons.js';

const games = Number(process.argv[2] || 4000);
const rng = mulberry32(1);
const st = {};
for (let g = 0; g < games; g++) {
  const defs = [];
  while (defs.length < 4) {
    const w = WEAPONS[Math.floor(rng() * WEAPONS.length)];
    if (!defs.includes(w)) defs.push(w);
  }
  const world = runToEnd(createMelee(defs, g + 1));
  defs.forEach((d, i) => {
    const s = (st[d.id] ||= [0, 0]);
    s[1]++;
    if (world.winner === i) s[0]++;
  });
}
const rows = Object.entries(st).map(([id, [w, n]]) => [id, (w / n) * 100]);
rows.sort((a, b) => b[1] - a[1]);
for (const [id, r] of rows) console.log(`${id}\t${r.toFixed(0)}%`);
