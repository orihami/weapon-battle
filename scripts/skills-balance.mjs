// スキル1枚でどれくらい勝ちやすくなるか(同じ武器どうしで、片方だけスキルを持つ)。
// node scripts/skills-balance.mjs [試合数]
import { createBattle, runToEnd } from '../src/engine.js';
import { WEAPONS } from '../src/weapons.js';
import { SKILLS, RARITY } from '../src/skills.js';

const n = Number(process.argv[2] || 120);
const rows = [];
let seed = 1;
for (const sk of SKILLS) {
  let win = 0;
  for (let i = 0; i < n; i++) {
    const w = WEAPONS[(i * 7) % WEAPONS.length];
    const swap = i % 2 === 1;
    const opts = swap ? { b: { skills: [sk] } } : { a: { skills: [sk] } };
    const world = runToEnd(createBattle(w, w, seed++, opts));
    if (world.winner === (swap ? 1 : 0)) win++;
  }
  rows.push([RARITY[sk.rarity].name, sk.id, sk.name, ((win / n) * 100).toFixed(0) + '%']);
}
for (const r of rows) console.log(r.join('\t'));
