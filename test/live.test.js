import test from 'node:test';
import assert from 'node:assert/strict';
import { createMelee, dealDamage } from '../src/engine.js';
import { WEAPON_BY_ID } from '../src/weapons.js';
import { enableLive, applyAction, LiveClock, LiveHost, checksum, LIVE_START_EN, LIVE_LEAD } from '../src/live.js';

const defs = () => ['sword', 'bomb', 'lightning'].map((id) => WEAPON_BY_ID[id]);
const newWorld = () => {
  const w = createMelee(defs(), 1234);
  enableLive(w);
  return w;
};

test('操作バトル: エネルギーが足りないと効かず、足りれば効いてエネルギーが減る', () => {
  const w = newWorld();
  assert.equal(w.balls[0].live.en, LIVE_START_EN);
  assert.equal(applyAction(w, 0, 'rage'), false);
  assert.equal(applyAction(w, 0, 'dash'), true);
  assert.ok(w.balls[0].live.en < 0.01);
  w.balls[1].live.en = 5;
  assert.equal(applyAction(w, 1, 'guard'), true);
  assert.equal(applyAction(w, 1, 'guard'), false, 'ガード中にもう一度は使えない');
  const before = w.balls[1].hp;
  dealDamage(w, w.balls[0], w.balls[1], 40);
  assert.ok(before - w.balls[1].hp < 40 * 0.3, 'ガード中はダメージが減る');
});

test('操作バトル: tick の届き方がちがっても、全員の試合はまったく同じになる', () => {
  // ホームが作った tick の列
  const host = new LiveHost();
  const ref = new LiveClock(newWorld());
  const ticks = [];
  const plan = { 3: [{ i: 0, a: 'dash' }], 12: [{ i: 1, a: 'dash' }, { i: 2, a: 'cheer', to: 0 }], 40: [{ i: 0, a: 'guard' }], 90: [{ i: 2, a: 'rage' }] };
  for (let k = 0; k < 200 && !ref.world.over; k++) {
    for (const a of plan[k] || []) host.add(a);
    const t = host.tick(k * 12, ref);
    ticks.push(t);
    ref.receive(t);
    while (ref.canStep() && ref.frame < k * 12 + 6) ref.step();
  }
  while (ref.canStep()) ref.step();
  // 別のスマホ: 遅れてまとめて届く・少しずつ進む
  const other = new LiveClock(newWorld());
  for (let k = 0; k < ticks.length; k += 3) {
    for (const t of ticks.slice(k, k + 3)) other.receive(t);
    for (let n = 0; n < 25 && other.canStep(); n++) other.step();
  }
  while (other.canStep()) other.step();
  assert.equal(other.frame, ref.frame);
  assert.equal(checksum(other.world), checksum(ref.world));
  assert.equal(other.desync, false);
  assert.ok(ref.world.events.some((e) => e.type === 'live' && e.a === 'dash'), 'ダッシュが効いた');
});

test('操作バトル: upto より先へは進まない・操作は前の upto のコマで効く', () => {
  const host = new LiveHost();
  const c = new LiveClock(newWorld());
  c.receive(host.tick(0));
  assert.equal(c.upto, LIVE_LEAD);
  while (c.canStep()) c.step();
  assert.equal(c.frame, LIVE_LEAD);
  host.add({ i: 0, a: 'dash' });
  const t = host.tick(10);
  assert.equal(t.acts[0].f, LIVE_LEAD);
  c.receive(t);
  c.step();
  assert.ok(c.world.balls[0].live.en < LIVE_START_EN);
});
