import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, createMelee, runToEnd, step, segSegDist, landHit, knockback, MAX_HP, HARD_LIMIT, bladeSegment } from '../src/engine.js';
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
  assert.equal(sword.w.dmg, 3);
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
  assert.equal(even, 12, 'HPが同じなら1回につき+1');
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
  assert.equal(world.balls[0].w.dmg, 2 + 3, '先取り成長3回で剣のダメージが5');
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

test('進化: 材料がそろうと合体進化が出て、選ぶと材料と合体する。ボスのあとは武器進化', async () => {
  const { SKILL_BY_ID: S, makeOffer, fusionsReady, fusionsNear, addSkills, awakenTier, awakenSuffix, FUSIONS, AWAKENS, CURSED } = await import('../src/skills.js');
  const { newChallenge, offerCards, takeCards, takeAwaken } = await import('../src/challenge.js');
  assert.ok(FUSIONS.length >= 20 && AWAKENS.length >= 10 && CURSED.length >= 5, '進化の種類が少ない');
  const owned = [S.vamp, S.power];
  assert.equal(fusionsReady(owned).length, 0);
  assert.ok(fusionsNear(owned).some((n) => n.fusion.id === 'vampLord' && n.missing.id === 'hp'), 'あと1枚の合体進化が出ない');
  owned.push(S.hp);
  assert.deepEqual(fusionsReady(owned).map((f) => f.id), ['vampLord']);
  // 大進化なら材料がそろった合体進化は必ず出る
  for (let i = 0; i < 20; i++) assert.ok(makeOffer(owned, 4, Math.random, true).includes(S.vampLord));
  addSkills(owned, [S.vampLord]);
  assert.deepEqual(owned.map((s) => s.id), ['power', 'vampLord'], '材料のカードが消えていない');
  const world = createBattle(W.sword, W.sword, 1, { a: { skills: owned } });
  assert.equal(world.balls[0].maxHp, 140);
  // チャレンジのボスのあと: 武器進化3つ → 大進化
  const ch = newChallenge(W.bomb);
  ch.stage = 5;
  const offer = offerCards(ch);
  assert.equal(offer.awaken.length, 3);
  assert.ok(offer.awaken.every((c) => c.rarity === 'awaken'));
  takeAwaken(ch, offer.awaken[0]);
  takeAwaken(ch, AWAKENS.find((c) => c !== offer.awaken[0]));
  takeCards(ch, offer.cards.slice(0, 2));
  assert.equal(awakenTier(ch.skills), 2);
  assert.equal(awakenSuffix(1), '・改');
  assert.equal(awakenSuffix(4), '・神');
  assert.equal(awakenSuffix(6), '・神+2');
  const w2 = createBattle(W.bomb, W.sword, 2, { a: { skills: ch.skills } });
  assert.equal(w2.balls[0].awaken, 2, '武器進化の段階がボールに付いていない');
  // 不滅は2回よみがえる
  const w3 = createBattle(W.sword, W.sword, 1, { a: { skills: [S.immortal] } });
  landHit(w3, w3.balls[1], w3.balls[0], 999);
  landHit(w3, w3.balls[1], w3.balls[0], 999);
  assert.ok(!w3.balls[0].dead, '不滅で2回よみがえらない');
  landHit(w3, w3.balls[1], w3.balls[0], 999);
  assert.ok(w3.balls[0].dead);
});

test('第3弾のスキル: カード選びが良くなる・重い体・貫通・成長の種', async () => {
  const { SKILL_BY_ID: S, makeOffer } = await import('../src/skills.js');
  // 目利き: カードが1枚ふえる(2枚まで) / 強運: 2枚ふえてレジェンドが出やすい
  assert.equal(makeOffer([], 3).length, 3);
  assert.equal(makeOffer([S.scout], 3).length, 4);
  assert.equal(makeOffer([S.scout, S.scout, S.scout], 3).length, 5);
  assert.equal(makeOffer([S.fortune], 3).length, 5);
  const legends = (owned) => {
    let n = 0;
    for (let i = 0; i < 400; i++) n += makeOffer(owned, 3).filter((c) => c.rarity === 'legend').length;
    return n;
  };
  assert.ok(legends([S.luckyDraw]) > legends([]) * 1.6, '天運でレジェンドが出やすくなっていない');
  // 重い体: 吹き飛ばされにくい
  const w1 = createBattle(W.sword, W.sword, 1, { a: { skills: [S.heavy] } });
  const [a, b] = w1.balls;
  a.vx = b.vx = a.vy = b.vy = 0;
  knockback(b, a, 100);
  knockback(a, b, 100);
  assert.ok(Math.abs(Math.hypot(a.vx, a.vy) - 60) < 1e-6 && Math.abs(Math.hypot(b.vx, b.vy) - 100) < 1e-6);
  // 貫通: 飛び道具の弾が刃で防がれない
  const w2 = createBattle(W.bow, W.sword, 1, { a: { skills: [S.pierce] } });
  for (let i = 0; i < 120 * 3; i++) step(w2);
  assert.ok(w2.balls[0].pierce && w2.projectiles.filter((p) => p.owner === 0).every((p) => !p.blockable));
  // 成長の種: 当てなくても6秒ごとに成長(相手には何も起きない)
  const w3 = createBattle(W.scythe, W.sword, 1, { a: { skills: [S.seed] } });
  const ball = w3.balls[0];
  const st = ball.skills[0].st;
  const foe = w3.balls[1];
  for (let i = 0; i < 7 * 120; i++) S.seed.update(w3, ball, foe, 1 / 120, st);
  assert.equal(foe.poison, 0, '成長の種で相手に毒が付いた');
});

test('新武器: 入れかえは場所が入れかわる・金床は落ちてくる・投げ縄は捕まえて投げる', () => {
  // 入れかえ: 撃つ瞬間に自分と相手の場所が入れかわる
  const w1 = createBattle(W.swap, W.sword, 1);
  const [me, foe] = w1.balls;
  me.w.timer = 0;
  const before = [me.x, me.y, foe.x, foe.y];
  W.swap.update(w1, me, foe, 1 / 120);
  assert.deepEqual([foe.x, foe.y, me.x, me.y], before);
  assert.ok(w1.projectiles.some((p) => p.kind === 'swapbomb'));
  // 金床: 影の予告のあと、天井近くに金床が出て(すぐ消えずに)落ちる
  const w2 = createBattle(W.anvil, W.sword, 1);
  for (let i = 0; i < 120 * 2; i++) step(w2);
  let anvilSeen = false;
  for (let i = 0; i < 120 * 4 && !anvilSeen; i++) {
    step(w2);
    anvilSeen = w2.projectiles.some((p) => p.kind === 'anvil' && p.age > 0.05);
  }
  assert.ok(anvilSeen, '金床が出てすぐ消えている');
  // 投げ縄: 当てると捕まえて振り回し、放り投げる
  const w3 = createBattle(W.lasso, W.sword, 1);
  let caught = false;
  let thrown = false;
  for (let i = 0; i < 120 * 20 && !w3.over && !thrown; i++) {
    step(w3);
    if (w3.balls[0].w.caught) caught = true;
    else if (caught) thrown = w3.balls[1].slamT > 0;
  }
  assert.ok(caught && thrown, '投げ縄で捕まえて投げていない');
});

test('格闘家: 柔道は床へ投げる・相撲は大きくなる・ボクサーはよける', () => {
  const w1 = createBattle(W.judo, W.sword, 1);
  const [judo, foe] = w1.balls;
  W.judo.onContact(w1, judo, foe);
  assert.ok(foe.vy > 500 && foe.slamT > 0, '柔道で床へ投げていない');
  const w2 = createBattle(W.sumo, W.sword, 1);
  const sumo = w2.balls[0];
  const r0 = sumo.r;
  for (let i = 0; i < 10; i++) W.sumo.onHit(w2, sumo, w2.balls[1], { kind: 'sumo' });
  assert.ok(sumo.r > r0, '相撲が大きくならない');
  const w3 = createBattle(W.boxer, W.sword, 1);
  const boxer = w3.balls[0];
  boxer.w.dodge = 100;
  assert.equal(W.boxer.onTakeDamage(w3, boxer, w3.balls[1], 5, { kind: 'melee' }), 0, 'ボクサーがよけない');
});

test('第4弾の武器: 甲羅・風の守り・バナナ・縮小光線・ピンポンのラリー', () => {
  // カメ: 甲羅にこもっている間はダメージがとても小さい
  const w1 = createBattle(W.turtle, W.sword, 1);
  const [turtle, foe] = w1.balls;
  turtle.w.shell = 1;
  const hp = turtle.hp;
  landHit(w1, foe, turtle, 10);
  assert.ok(hp - turtle.hp < 2, '甲羅でダメージが減っていない');
  // 風の守り: 近くに来た矢を自分の弾にして撃ち返す
  const w2 = createBattle(W.windBarrier, W.bow, 1);
  const [wind, archer] = w2.balls;
  w2.projectiles.push({ owner: archer.id, kind: 'arrow', x: wind.x + 50, y: wind.y, vx: -400, vy: 0, r: 4, life: 2, age: 0, damage: 2, blockable: true, wall: 'die', dead: false });
  W.windBarrier.update(w2, wind, archer, 1 / 120);
  const arrow = w2.projectiles.find((p) => p.kind === 'arrow');
  assert.ok(arrow.owner === wind.id && arrow.vx > 0, '撃ち返していない');
  // バナナ: ふんだ相手はすべって飛ばされ、しびれる
  const w3 = createBattle(W.banana, W.sword, 1);
  const [ban, f3] = w3.balls;
  ban.w.timer = 0;
  W.banana.update(w3, ban, f3, 1 / 120);
  const peel = w3.projectiles.find((p) => p.kind === 'peel');
  peel.age = 1;
  peel.onTouch(w3, peel, ban, f3);
  assert.ok(f3.stun > 0 && Math.abs(f3.vx) >= 800, 'すべっていない');
  // 縮小光線: 当たった相手は小さくなり、時間がたつと元に戻る
  const w4 = createBattle(W.shrinkRay, W.sword, 1);
  const [ray, f4] = w4.balls;
  f4.x = ray.x + 200;
  f4.y = ray.y;
  const r0 = f4.r;
  ray.w.timer = 0;
  W.shrinkRay.update(w4, ray, f4, 1 / 120);
  assert.ok(f4.r < r0 && f4.outMul < 1, '小さくなっていない');
  ray.w.timer = 99; // 次の光線は撃たせない
  for (let i = 0; i < 4 * 120; i++) W.shrinkRay.update(w4, ray, f4, 1 / 120);
  assert.ok(f4.r === r0 && f4.outMul === 1, '元に戻っていない');
  // ピンポン: 打ち合うほどラリーが続く
  let rally = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const w5 = createBattle(W.pingpong, W.sword, seed);
    for (let i = 0; i < 120 * 20 && !w5.over; i++) {
      step(w5);
      rally = Math.max(rally, w5.balls[0].w.rally);
    }
  }
  assert.ok(rally >= 2, `ラリーが続かない(${rally})`);
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

test('分裂弾: 飛び道具の武器は撃つたびに弾が2発ふえる。置くタイプや近接は3方向弾', async () => {
  const { SKILL_BY_ID } = await import('../src/skills.js');
  assert.equal(SKILL_BY_ID.split.rarity, 'legend');
  const shots = (def, skills) => {
    const w = createBattle(def, W.dagger, 3, { a: { skills } });
    let n = 0;
    for (let i = 0; i < 120 * 3; i++) {
      const before = new Set(w.projectiles);
      step(w);
      n += w.projectiles.filter((p) => !before.has(p) && p.owner === 0 && p.kind === 'bolt').length;
    }
    return n;
  };
  const base = shots(W.crossbow, []);
  assert.ok(base >= 2);
  assert.equal(shots(W.crossbow, [SKILL_BY_ID.split]), base * 3, 'クロスボウの矢が1回につき+2本になっていない');
  // 地雷は動く弾を撃たないので、代わりに3方向弾が出る
  const w = createBattle(W.mine, W.dagger, 3, { a: { skills: [SKILL_BY_ID.split] } });
  let bolts = 0;
  for (let i = 0; i < 120 * 6; i++) {
    step(w);
    bolts = Math.max(bolts, w.projectiles.filter((p) => p.kind === 'skillbolt').length);
  }
  assert.ok(bolts >= 3, '地雷で3方向弾が出ない');
});

test('スキルの追加の剣は武器と別に回るので、遠距離武器でも当たる', async () => {
  const { SKILL_BY_ID } = await import('../src/skills.js');
  for (const id of ['bow', 'laser', 'gatling']) {
    let hits = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const w = createBattle(W[id], W.dagger, seed, { a: { skills: [SKILL_BY_ID.extraBlade] } });
      for (let i = 0; i < 120 * 20 && !w.over; i++) {
        step(w);
        for (const e of w.events) if (e.type === 'hit' && e.src === 0 && e.kind === 'melee') hits++;
        w.events.length = 0;
      }
    }
    assert.ok(hits > 0, `${id} の追加の剣が当たらない`);
  }
});

test('ラウンズ: 全員同時に戦い、負けた全員がカードを選ぶ。3回目は大進化(2枚)。先に3勝で優勝', async () => {
  const { createRounds, fighters, reportRound, pickSkills, cpuPickPending, BIG_EVERY } = await import('../src/rounds.js');
  const r = createRounds(
    [
      { name: 'P1', weapon: W.sword, cpu: true },
      { name: 'P2', weapon: W.bomb, cpu: true },
      { name: 'P3', weapon: W.dagger, cpu: true },
    ],
    3,
  );
  assert.deepEqual(fighters(r), [0, 1, 2]);
  reportRound(r, -1);
  assert.equal(r.pending, null, '引き分けはカードなし');
  reportRound(r, 0, Math.random, [2, 1]);
  assert.equal(r.pending.player, 2, '先に倒れた人から選ぶ');
  assert.equal(r.pending.cards.length, 3);
  pickSkills(r, cpuPickPending(r));
  assert.equal(r.pending.player, 1, '負けた人は全員選ぶ');
  pickSkills(r, cpuPickPending(r));
  assert.equal(r.pending, null);
  assert.equal(r.players[1].skills.length, 1);
  assert.equal(r.players[2].skills.length, 1);
  let guard = 0;
  while (!r.champion && guard++ < 100) {
    const ps = fighters(r).map((i) => r.players[i]);
    const world = runToEnd(createMelee(ps.map((p) => p.weapon), guard, { boosts: ps.map((p) => ({ skills: p.skills })) }));
    reportRound(r, world.winner, Math.random, world.outOrder);
    while (r.pending) {
      const loser = r.players[r.pending.player];
      if (loser.picks % BIG_EVERY === 0) {
        assert.equal(r.pending.choose, 2, '大進化で2枚選べない');
        // ラウンズの大進化は強くなりすぎないように: 武器進化なし・ふつう〜レジェンドのカードだけ
        assert.ok(!r.pending.awaken && r.pending.cards.every((c) => c.rarity !== 'awaken'), 'ラウンズの大進化に武器進化が出た');
      }
      pickSkills(r, cpuPickPending(r));
    }
  }
  assert.ok(r.champion && r.champion.wins === 3);
});

test('バトルロイヤル: 3〜4人が同時に戦い、1人だけ残る。倒れた順が記録される', () => {
  const sets = [
    [W.sword, W.bomb, W.dagger],
    [W.lightning, W.spear, W.orbital, W.bow],
    [W.bomb, W.bomb, W.bomb, W.bomb],
    [W.copycat, W.sticky, W.scythe],
  ];
  sets.forEach((defs, k) => {
    const world = runToEnd(createMelee(defs, 7 + k));
    assert.ok(world.over, '決着しない');
    assert.equal(world.size, 820, '3人以上は広いフィールド');
    for (const b of world.balls) {
      assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.hp), '数値が壊れた');
      assert.ok(b.x >= 0 && b.x <= world.size && b.y >= 0 && b.y <= world.size, 'フィールドの外');
    }
    if (world.winner >= 0) {
      assert.equal(world.outOrder.length, defs.length - 1);
      assert.ok(!world.outOrder.includes(world.winner));
      assert.ok(world.balls.filter((b) => !b.dead).length === 1);
    }
  });
  // 1対1は今までどおり600の広さ
  assert.equal(createBattle(W.sword, W.dagger, 1).size, 600);
});

test('不死鳥は1度だけよみがえる', () => {
  const world = createBattle(W.phoenix, W.sword, 3);
  const [ph, foe] = world.balls;
  landHit(world, foe, ph, 500);
  assert.ok(!ph.dead && ph.hp > 0, '1度目でよみがえっていない');
  landHit(world, foe, ph, 500);
  assert.ok(ph.dead, '2度目もよみがえってしまった');
});

test('大器晩成の武器: 当てるほど姿が変わり、後半は最初よりずっと強い', () => {
  const evolveTexts = (world) => world.events.filter((e) => e.type === 'evolve').map((e) => e.text);
  // たまご → ひよこ → ニワトリ → ドラゴン
  const w1 = createBattle(W.egg, W.sword, 1);
  const [egg, f1] = w1.balls;
  assert.equal(egg.blades.length, 0);
  for (let i = 0; i < 12; i++) W.egg.onHit(w1, egg, f1, { kind: 'egg' });
  assert.equal(egg.w.stage, 3);
  assert.deepEqual(evolveTexts(w1), ['ひよこ', 'ニワトリ', 'ドラゴン']);
  assert.ok(egg.blades.length === 1 && egg.r > 40, 'ドラゴンになっていない');
  // 鍛冶の剣: 木の棒から伝説の剣へ。ダメージが何倍にもなる
  const w2 = createBattle(W.forge, W.sword, 1);
  const [fg, f2] = w2.balls;
  const d0 = fg.blades[0].damage(w2, fg, f2);
  for (let i = 0; i < 14; i++) W.forge.onHit(w2, fg, f2, { kind: 'melee' });
  assert.equal(fg.w.stage, 4);
  assert.ok(fg.blades[0].damage(w2, fg, f2) > d0 * 10, '伝説の剣が強くない');
  // 修行僧: Lv3 で回し蹴りの足が増える
  const w3 = createBattle(W.monk, W.sword, 1);
  const [mk, f3] = w3.balls;
  for (let i = 0; i < 5; i++) W.monk.onHit(w3, mk, f3, { kind: 'melee' });
  assert.equal(mk.w.lv, 3);
  assert.equal(mk.blades.length, 2);
  // 月の刃: 3回ごとに刃が増え、12枚で満月。何枚ふれても1回しか当たらない
  const w4 = createBattle(W.moon, W.sword, 1);
  const [mn, f4] = w4.balls;
  for (let i = 0; i < 33; i++) W.moon.onHit(w4, mn, f4, {});
  assert.equal(mn.blades.length, 12);
  assert.equal(mn.w.stage, 3);
  mn.blades[0].damage(w4, mn, f4);
  assert.ok(mn.blades.every((bl) => bl.cdLeft > 0), '刃の待ち時間がそろっていない');
  // 貯金箱: 貯まると大きな金貨を投げ、目標が上がる
  const w5 = createBattle(W.piggy, W.sword, 1);
  const [pg, f5] = w5.balls;
  for (let i = 0; i < 5; i++) W.piggy.onHit(w5, pg, f5, { kind: 'piggy' });
  W.piggy.update(w5, pg, f5, 1 / 120);
  const coin = w5.projectiles.find((p) => p.kind === 'coin');
  assert.ok(coin && coin.damage > 4 && pg.w.coins === 0 && pg.w.goal > 6, '金貨が出ていない');
  // 変身ヒーロー: ゲージがたまると変身し、時間がたつと戻る。次の変身は長い
  const w6 = createBattle(W.hero, W.sword, 1);
  const [hr, f6] = w6.balls;
  for (let i = 0; i < 4; i++) W.hero.onHit(w6, hr, f6, {});
  W.hero.update(w6, hr, f6, 1 / 120);
  assert.ok(hr.w.on > 0 && hr.r > 40 && hr.blades[0].damage, '変身していない');
  for (let i = 0; i < 5 * 120; i++) W.hero.update(w6, hr, f6, 1 / 120);
  assert.ok(hr.w.on <= 0 && hr.r === 40 && hr.blades[0].damage === undefined && hr.w.dur > 4, '変身がとけていない');
  // 転がる石・火種は当てるほど大きくなる
  const w7 = createBattle(W.pebble, W.ember, 1);
  const [pb, em] = w7.balls;
  const r0 = pb.r;
  for (let i = 0; i < 20; i++) {
    W.pebble.onHit(w7, pb, em, {});
    W.ember.onHit(w7, em, pb, {});
  }
  assert.ok(pb.r > r0 * 2 && pb.w.stage === 3, '石が大きくならない');
  assert.ok(em.w.rad > 100 && em.w.stage >= 2, '炎が広がらない');
});
