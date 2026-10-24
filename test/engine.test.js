import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, runToEnd, step, segSegDist, landHit, MAX_HP, HARD_LIMIT, bladeSegment } from '../src/engine.js';
import { WEAPONS, WEAPON_BY_ID, validateWeapon } from '../src/weapons.js';

const W = WEAPON_BY_ID;

test('武器は20種類以上あり、IDが重複していない', () => {
  assert.ok(WEAPONS.length >= 20, `武器数 ${WEAPONS.length}`);
  assert.equal(new Set(WEAPONS.map((w) => w.id)).size, WEAPONS.length);
  for (const w of WEAPONS) assert.deepEqual(validateWeapon(w), [], w.id);
});

test('線分どうしの距離', () => {
  assert.equal(segSegDist([0, 0, 10, 10], [0, 10, 10, 0]), 0);
  assert.equal(segSegDist([0, 0, 10, 0], [0, 5, 10, 5]), 5);
});

test('同じシードなら同じ結果になる(再現性)', () => {
  const a = runToEnd(createBattle(W.sword, W.dagger, 42));
  const b = runToEnd(createBattle(W.sword, W.dagger, 42));
  assert.equal(a.winner, b.winner);
  assert.equal(a.t, b.t);
  assert.equal(a.balls[0].hp, b.balls[0].hp);
});

test('剣が当たると相手のHPが減り、剣のダメージが+1される', () => {
  const world = createBattle(W.sword, W.dagger, 1);
  const [sword, foe] = world.balls;
  // 剣の刃先の位置に相手を置く
  sword.x = 300;
  sword.y = 300;
  sword.angle = 0;
  foe.x = 300 + 80;
  foe.y = 300;
  foe.angle = Math.PI / 2; // 刃同士が重ならないよう向きをずらす
  foe.blades[0].rOut = 1;
  const before = foe.hp;
  step(world);
  assert.ok(foe.hp < before, 'HPが減っていない');
  assert.equal(sword.w.dmg, 2);
  assert.equal(sword.hits, 1);
});

test('短剣は当たるたびに回転が速くなる', () => {
  const world = createBattle(W.dagger, W.unarmed, 3);
  const dagger = world.balls[0];
  const spin0 = Math.abs(dagger.spin);
  runToEnd(world);
  if (dagger.hits > 0) assert.ok(Math.abs(dagger.spin) > spin0);
});

test('刃どうしがぶつかると両方の回転が逆になる(受け流し)', () => {
  const world = createBattle(W.sword, W.sword, 5);
  const [a, b] = world.balls;
  a.x = 200;
  a.y = 300;
  b.x = 360;
  b.y = 300;
  a.angle = 0;
  b.angle = Math.PI;
  const sa = Math.sign(a.spin);
  const sb = Math.sign(b.spin);
  step(world);
  assert.equal(Math.sign(a.spin), -sa);
  assert.equal(Math.sign(b.spin), -sb);
  assert.ok(segSegDist(bladeSegment(a, a.blades[0]), bladeSegment(b, b.blades[0])) >= 0);
});

test('全ての組み合わせが制限時間内に決着し、数値が壊れない', () => {
  for (const a of WEAPONS) {
    for (const b of WEAPONS) {
      const world = runToEnd(createBattle(a, b, 7));
      assert.ok(world.over, `${a.id} vs ${b.id} が終わらない`);
      assert.ok(world.t <= HARD_LIMIT + 0.01);
      for (const ball of world.balls) {
        assert.ok(Number.isFinite(ball.x) && Number.isFinite(ball.y), `${a.id} vs ${b.id}: 位置がNaN`);
        assert.ok(ball.hp >= 0 && ball.hp <= Math.max(MAX_HP, ball.maxHp), `${a.id} vs ${b.id}: HP=${ball.hp}`);
        for (const [, v] of ball.def.stats(ball, world)) assert.ok(!String(v).includes('NaN'));
      }
    }
  }
});

test('どの武器も勝てるし、負けることもある(極端に強い/弱い武器がない)', () => {
  const wins = Object.fromEntries(WEAPONS.map((w) => [w.id, 0]));
  const games = Object.fromEntries(WEAPONS.map((w) => [w.id, 0]));
  let seed = 100;
  for (const a of WEAPONS) {
    for (const b of WEAPONS) {
      if (a === b) continue;
      const world = runToEnd(createBattle(a, b, seed++));
      games[a.id]++;
      games[b.id]++;
      if (world.winner === 0) wins[a.id]++;
      if (world.winner === 1) wins[b.id]++;
    }
  }
  for (const w of WEAPONS) {
    const rate = wins[w.id] / games[w.id];
    assert.ok(rate > 0.1 && rate < 0.9, `${w.id} の勝率 ${(rate * 100).toFixed(0)}%`);
  }
});

test('重力でボールが落ち、床で跳ね返って天井近くまで戻る', () => {
  const world = createBattle(W.unarmed, W.unarmed, 9);
  const b = world.balls[0];
  world.balls[1].x = 560; // 相手とぶつからない位置へ
  b.x = 60;
  b.y = 100;
  b.vx = 0;
  b.vy = 0;
  let maxY = 0;
  let bounced = false;
  let minYAfter = Infinity;
  for (let i = 0; i < 120 * 3; i++) {
    step(world);
    world.events.length = 0;
    maxY = Math.max(maxY, b.y);
    if (b.vy < 0 && b.y > 400) bounced = true;
    if (bounced) minYAfter = Math.min(minYAfter, b.y);
  }
  assert.ok(maxY > 540, `床まで落ちていない: ${maxY}`);
  assert.ok(bounced, '床で跳ね返っていない');
  assert.ok(minYAfter < 200, `跳ね返った後に高く上がっていない: ${minYAfter}`);
});

test('爆弾は当てるほど投げる数が増え、近くの爆弾に誘爆する', () => {
  // 増え方: 当たるたびに +0.5(2回で1個)
  const world = createBattle(W.bomb, W.unarmed, 11);
  const bomb = world.balls[0];
  const start = Math.floor(bomb.w.bombs);
  runToEnd(world);
  assert.ok(Math.floor(bomb.w.bombsT ?? bomb.w.bombs) > start, '爆弾の数が増えていない');

  // 誘爆: 1つ爆発すると、すぐそばの自分の爆弾も爆発が早まる
  const w2 = createBattle(W.bomb, W.unarmed, 12);
  const me = w2.balls[0];
  const foe = w2.balls[1];
  foe.x = 560;
  foe.y = 60;
  me.w.timer = 0;
  me.w.bombs = 6;
  step(w2);
  const bombs = w2.projectiles.filter((p) => p.kind === 'bomb');
  assert.equal(bombs.length, 6);
  bombs.forEach((p, i) => {
    p.x = 300 + i * 10;
    p.y = 300;
    p.vx = p.vy = 0;
    p.gravity = 0;
    p.life = 5;
  });
  bombs[0].life = bombs[0].age + 0.01;
  step(w2);
  step(w2);
  for (const p of bombs.slice(1)) assert.ok(p.life - p.age < 0.1, '誘爆していない');
});

test('成長に上限がない: 限界を超えた分は威力(ダメージ倍率)として伸び続ける', () => {
  const world = createBattle(W.orbital, W.unarmed, 13);
  const [me, foe] = world.balls;
  foe.hp = 1e9; // 倒れないように
  foe.maxHp = 1e9;
  me.hp = foe.hp; // 逆境ブーストが起きないようにHPをそろえる
  me.maxHp = foe.maxHp;
  for (let i = 0; i < 60; i++) landHit(world, me, foe, 1);
  assert.equal(Math.floor(me.w.n), 10, '周回玉の数は見た目の限界(10)で止まる');
  assert.ok(me.w.nT > 30, `表示用の数は伸び続ける: ${me.w.nT}`);
  assert.ok(me.power > 1.5, `威力が上がっていない: ${me.power}`);
  const before = foe.hp;
  landHit(world, me, foe, 1);
  assert.ok(before - foe.hp > 1.5, '威力がダメージに反映されていない');
});

test('逆境ブースト: HPで負けている側は当てたときに多く成長する', () => {
  const grow = (myHp) => {
    const world = createBattle(W.sword, W.unarmed, 14);
    const [me, foe] = world.balls;
    me.hp = myHp;
    for (let i = 0; i < 10; i++) {
      foe.hp = 100;
      landHit(world, me, foe, 0.01);
    }
    return me.w.dmg;
  };
  const even = grow(100);
  const behind = grow(30);
  assert.equal(even, 11, 'HPが同じなら1回につき+1');
  assert.ok(behind > even + 10, `負けている側の成長が大きくない: ${behind}`);
});

test('トーナメント: 8人で7試合行い、優勝が1人決まる', async () => {
  const { createTournament, nextMatch, reportWinner, pickEntries, roundName } = await import('../src/tournament.js');
  const entries = pickEntries(WEAPONS, 8, () => 0.3);
  assert.equal(new Set(entries).size, 8);
  const t = createTournament(entries);
  assert.equal(roundName(t, 0), '準々決勝');
  assert.equal(roundName(t, 2), '決勝');
  let games = 0;
  for (let m = nextMatch(t); m; m = nextMatch(t)) {
    // 実際に戦わせて勝者を進める
    const world = runToEnd(createBattle(m.match.a, m.match.b, 100 + games));
    reportWinner(t, world.winner === 1 ? m.match.b : m.match.a);
    games++;
  }
  assert.equal(games, 7);
  assert.ok(entries.includes(t.champion));
});

test('ものまね: 相手と同じ武器の動きになる', () => {
  const world = createBattle(W.copycat, W.orbital, 3);
  const me = world.balls[0];
  assert.equal(me.def.id, 'orbital');
  assert.equal(me.def.copyOf, 'orbital');
  assert.ok(me.w.n >= 1, '周回玉の状態を持っていない');
  runToEnd(world);
  assert.ok(world.over);
});

test('チャレンジ: スキルが試合に反映され、5ステージごとにボスと大進化', async () => {
  const { newChallenge, enemyBoost, offerCards, takeCards, isBoss } = await import('../src/challenge.js');
  const { SKILL_BY_ID } = await import('../src/skills.js');
  const ch = newChallenge(W.sword);
  takeCards(ch, [SKILL_BY_ID.hp, SKILL_BY_ID.pregrow]);
  assert.equal(ch.stage, 2);
  const world = createBattle(W.sword, W.bomb, 7, { a: { skills: ch.skills }, b: enemyBoost(2, () => 0.1) });
  assert.equal(world.balls[0].maxHp, 120);
  assert.equal(world.balls[0].w.dmg, 1 + 4, '先取り成長4回で剣のダメージが5');
  assert.equal(world.balls[1].poison, 0);
  assert.ok(isBoss(5) && !isBoss(4));
  const boss = enemyBoost(5, () => 0.5);
  assert.ok(boss.boss && boss.maxHp > enemyBoost(4, () => 0.5).maxHp * 1.4);
  ch.stage = 5;
  const offer = offerCards(ch, () => 0.4);
  assert.equal(offer.cards.length, 4);
  assert.equal(offer.choose, 2);
  runToEnd(world);
  assert.ok(world.over);
});

test('スキル: 全スキルを重ねがけしても決着し、数値が壊れない', async () => {
  const { SKILLS } = await import('../src/skills.js');
  let seed = 1;
  for (const sk of SKILLS) {
    for (const foeDef of [W.sword, W.bomb, W.lightning, W.magnet, W.copycat]) {
      const world = runToEnd(createBattle(W.dagger, foeDef, seed++, { a: { skills: [sk, sk, sk] }, b: { skills: [SKILLS[seed % SKILLS.length]] } }));
      assert.ok(world.over, `${sk.id} が終わらない`);
      for (const b of world.balls) {
        assert.ok(Number.isFinite(b.x) && Number.isFinite(b.hp) && Number.isFinite(b.r), `${sk.id} vs ${foeDef.id}: 数値がおかしい`);
      }
    }
  }
});

test('スキル: 根性・会心・追加の剣が効く', async () => {
  const { SKILL_BY_ID } = await import('../src/skills.js');
  const w1 = createBattle(W.sword, W.sword, 1, { a: { skills: [SKILL_BY_ID.guts] } });
  landHit(w1, w1.balls[1], w1.balls[0], 999);
  assert.ok(!w1.balls[0].dead && w1.balls[0].hp === 12, '根性で耐えていない');
  const w2 = createBattle(W.sword, W.sword, 1, { a: { skills: [SKILL_BY_ID.extraBlade, SKILL_BY_ID.extraBlade] } });
  assert.equal(w2.balls[0].blades.length, 3, '追加の剣が2本ふえていない');
});

test('ラウンズ: 負けた人がカードを選び、3回目は大進化(2枚)。先に3勝で優勝', async () => {
  const { createRounds, currentPair, reportRound, pickSkills, cpuPickPending, BIG_EVERY } = await import('../src/rounds.js');
  const r = createRounds(
    [
      { name: 'P1', weapon: W.sword, cpu: true },
      { name: 'P2', weapon: W.bomb, cpu: true },
      { name: 'P3', weapon: W.dagger, cpu: true },
    ],
    3,
  );
  assert.deepEqual(currentPair(r), [0, 1]);
  reportRound(r, 0);
  assert.equal(r.pending.player, 1);
  assert.equal(r.pending.cards.length, 3);
  pickSkills(r, cpuPickPending(r));
  assert.deepEqual(currentPair(r), [0, 2], '勝った人が残り、次の人が挑戦する');
  assert.equal(r.players[1].skills.length, 1);
  let guard = 0;
  while (!r.champion && guard++ < 100) {
    const [a, b] = currentPair(r);
    const pa = r.players[a];
    const pb = r.players[b];
    const world = runToEnd(createBattle(pa.weapon, pb.weapon, guard, { a: { skills: pa.skills }, b: { skills: pb.skills } }));
    reportRound(r, world.winner === 1 ? b : a);
    if (r.pending) {
      const loser = r.players[r.pending.player];
      if (loser.picks % BIG_EVERY === 0) assert.equal(r.pending.choose, 2, '大進化で2枚選べない');
      pickSkills(r, cpuPickPending(r));
    }
  }
  assert.ok(r.champion && r.champion.wins === 3);
});

test('不死鳥は1度だけよみがえる', () => {
  const world = createBattle(W.phoenix, W.sword, 3);
  const [ph, foe] = world.balls;
  landHit(world, foe, ph, 500);
  assert.ok(!ph.dead && ph.hp > 0, '1度目でよみがえっていない');
  landHit(world, foe, ph, 500);
  assert.ok(ph.dead, '2度目もよみがえってしまった');
});
