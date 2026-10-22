import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, runToEnd, step, segSegDist, MAX_HP, HARD_LIMIT, bladeSegment } from '../src/engine.js';
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
        assert.ok(ball.hp >= 0 && ball.hp <= MAX_HP, `${a.id} vs ${b.id}: HP=${ball.hp}`);
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
