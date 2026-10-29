// ボス・レイドのバランス: node scripts/raid-balance.mjs <人数> <回数> [easy|normal|hard]
// ランダムな武器の人数分のチームで最後まで回し、レベルごとの勝率と平均で何レベルまで行けるかを出す
import { createMelee, runToEnd } from '../src/engine.js';
import { WEAPONS } from '../src/weapons.js';
import { cpuPick } from '../src/skills.js';
import { createRaid, raidMatch, reportRaid, pickRaidCards, bossOf } from '../src/raid.js';
const N = Number(process.argv[2] || 2), runs = Number(process.argv[3] || 100), diff = process.argv[4] || 'normal';
let seed = 1;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const lvWins = {}, lvGames = {}, reach = [], time = {};
const bossWins = {}, bossGames = {};
for (let r = 0; r < runs; r++) {
  const players = Array.from({ length: N }, () => ({ weapon: WEAPONS[Math.floor(rnd() * WEAPONS.length)], cpu: true }));
  const raid = createRaid(players, diff);
  while (!raid.over && raid.level <= 30) {
    const m = raidMatch(raid);
    const w = runToEnd(createMelee(m.defs, Math.floor(rnd() * 1e9), { boosts: m.boosts, teams: m.teams }));
    const lv = raid.level, b = bossOf(raid).def.id;
    lvGames[lv] = (lvGames[lv] || 0) + 1; bossGames[b] = (bossGames[b] || 0) + 1;
    time[lv] = (time[lv] || 0) + w.t;
    const won = w.winTeam === 0;
    if (won) { lvWins[lv] = (lvWins[lv] || 0) + 1; bossWins[b] = (bossWins[b] || 0) + 1; }
    reportRaid(raid, won, rnd);
    while (raid.pending) pickRaidCards(raid, cpuPick(raid.pending.cards, 1));
  }
  reach.push(raid.level);
}
const avg = reach.reduce((a, b) => a + b, 0) / reach.length;
console.log(`${N}人 ${diff}: 平均到達Lv ${avg.toFixed(1)}`, Object.keys(lvGames).slice(0, 8).map((l) => `Lv${l}:${Math.round((100 * (lvWins[l] || 0)) / lvGames[l])}%(${(time[l] / lvGames[l]).toFixed(0)}s)`).join(' '));
console.log('  ボス別', Object.keys(bossGames).map((b) => `${b}:${Math.round((100 * (bossWins[b] || 0)) / bossGames[b])}%`).join(' '));
