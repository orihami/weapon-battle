// 逆転がどれくらい起きるかを数える。 node scripts/comeback.mjs [srcディレクトリ]
// 「勝った側が、途中でHPが相手より30以上少なかった」試合の割合を出す。
const dir = process.argv[2] || '../src';
const { createBattle, step } = await import(new URL(dir + '/engine.js', import.meta.url));
const { WEAPONS } = await import(new URL(dir + '/weapons.js', import.meta.url));
let games = 0;
let comebacks = 0;
let seed = 1;
for (const a of WEAPONS) {
  for (const b of WEAPONS) {
    if (a === b) continue;
    const w = createBattle(a, b, seed++);
    let worst = [0, 0];
    while (!w.over) {
      step(w);
      w.events.length = 0;
      worst[0] = Math.max(worst[0], w.balls[1].hp - w.balls[0].hp);
      worst[1] = Math.max(worst[1], w.balls[0].hp - w.balls[1].hp);
    }
    games++;
    if (w.winner >= 0 && worst[w.winner] >= 30) comebacks++;
  }
}
console.log(`逆転勝ち(HP30以上の差をひっくり返した): ${((comebacks / games) * 100).toFixed(1)}% (${comebacks}/${games})`);
