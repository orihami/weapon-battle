// 総当たりで勝率を出す(バランス調整用)。 node scripts/balance.mjs [各組み合わせの試合数]
import { createBattle, runToEnd } from '../src/engine.js';
import { WEAPONS } from '../src/weapons.js';

const rounds = Number(process.argv[2] || 4);
const rows = [];
let seed = 1;
for (const a of WEAPONS) {
  let win = 0;
  let games = 0;
  let time = 0;
  for (const b of WEAPONS) {
    if (a === b) continue;
    for (let r = 0; r < rounds; r++) {
      // 左右を入れ替えて公平に
      const swap = r % 2 === 1;
      const world = runToEnd(createBattle(swap ? b : a, swap ? a : b, seed++));
      const me = swap ? 1 : 0;
      if (world.winner === me) win++;
      games++;
      time += world.t;
    }
  }
  rows.push([a.id, ((win / games) * 100).toFixed(0) + '%', (time / games).toFixed(1) + 's']);
}
rows.sort((x, y) => parseInt(y[1]) - parseInt(x[1]));
for (const r of rows) console.log(r.join('\t'));
