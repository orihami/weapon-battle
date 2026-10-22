import { createBattle, step, DT } from './engine.js';
import { WEAPONS, WEAPON_BY_ID } from './weapons.js';
import { Renderer, drawIcon } from './render.js';
import { Sound } from './sound.js';

const $ = (id) => document.getElementById(id);
const SPEEDS = [1, 2, 4];
const RECORD_KEY = 'weapon-battle-records';

const params = new URLSearchParams(location.search);
const renderer = new Renderer($('arena'));
const sound = new Sound();

const state = {
  a: WEAPON_BY_ID[params.get('a')] || null,
  b: WEAPON_BY_ID[params.get('b')] || null,
  world: null,
  running: false,
  speed: SPEEDS.includes(Number(params.get('speed'))) ? Number(params.get('speed')) : 1,
  picking: 0,
  records: loadRecords(),
};

function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem(RECORD_KEY)) || {};
  } catch {
    return {};
  }
}

function saveRecords() {
  try {
    localStorage.setItem(RECORD_KEY, JSON.stringify(state.records));
  } catch {
    // 保存できない環境(プライベートモードなど)では記録しないだけ
  }
}

function randomPair() {
  const i = Math.floor(Math.random() * WEAPONS.length);
  let j = Math.floor(Math.random() * (WEAPONS.length - 1));
  if (j >= i) j++;
  return [WEAPONS[i], WEAPONS[j]];
}

function newBattle() {
  state.world = createBattle(state.a, state.b, (Math.random() * 2 ** 32) >>> 0);
  state.running = false;
  renderer.particles = [];
  renderer.texts = [];
  renderer.rings = [];
  renderer.bolts = [];
  $('overlay').hidden = true;
  $('startBtn').textContent = 'スタート';
  updateHeader();
}

function start() {
  sound.unlock();
  if (!state.world || state.world.over) newBattle();
  state.running = !state.running;
  $('startBtn').textContent = state.running ? '一時停止' : '再開';
}

function updateHeader() {
  const { a, b } = state;
  const nA = $('nameA');
  const nB = $('nameB');
  nA.textContent = a.name;
  nA.style.color = a.color;
  nB.textContent = b.name;
  nB.style.color = b.color;
  $('subTitle').textContent = `${a.en} VS ${b.en}`;
  document.title = `${a.name} VS ${b.name} | ウェポンバトル`;
  setPickButton($('pickA'), a);
  setPickButton($('pickB'), b);
  for (const card of document.querySelectorAll('.card')) {
    card.classList.toggle('sel-a', card.dataset.id === a.id);
    card.classList.toggle('sel-b', card.dataset.id === b.id);
  }
}

function setPickButton(btn, def) {
  btn.replaceChildren(iconCanvas(def, 80), Object.assign(document.createElement('span'), { textContent: def.name }));
  btn.setAttribute('aria-label', `${def.name}を変える`);
}

function iconCanvas(def, px) {
  const c = document.createElement('canvas');
  c.width = px;
  c.height = px;
  drawIcon(c, def);
  return c;
}

let lastStats = '';
function updateStats() {
  const w = state.world;
  if (!w) return;
  const render = (ball) =>
    ball.def
      .stats(ball, w)
      .map(([k, v]) => `<div style="color:${ball.def.color}">${k}:<b>${v}</b></div>`)
      .join('');
  const html = render(w.balls[0]) + '|' + render(w.balls[1]);
  if (html !== lastStats) {
    lastStats = html;
    const [l, r] = html.split('|');
    $('statsA').innerHTML = l;
    $('statsB').innerHTML = r;
  }
  $('timer').textContent = w.t.toFixed(1);
}

function finish() {
  const w = state.world;
  state.running = false;
  $('startBtn').textContent = 'もう一度';
  const text = $('resultText');
  if (w.winner === -1) {
    text.textContent = '引き分け！';
    text.style.color = '#ffffff';
  } else {
    const win = w.balls[w.winner].def;
    const lose = w.balls[1 - w.winner].def;
    text.textContent = `${win.name}の勝ち！`;
    text.style.color = win.color;
    const rec = state.records;
    rec[win.id] = rec[win.id] || { w: 0, l: 0 };
    rec[lose.id] = rec[lose.id] || { w: 0, l: 0 };
    rec[win.id].w++;
    rec[lose.id].l++;
    saveRecords();
    renderBook();
  }
  setTimeout(() => {
    if (state.world === w) $('overlay').hidden = false;
  }, 700);
}

let last = performance.now();
let acc = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const w = state.world;
  if (w && state.running && !w.over) {
    acc += dt * state.speed;
    let n = 0;
    while (acc >= DT && n < 600) {
      step(w);
      acc -= DT;
      n++;
      if (w.over) break;
    }
  } else {
    acc = 0;
  }
  if (w) {
    const events = w.events.splice(0);
    renderer.addEvents(w, events);
    sound.play(events);
    if (events.some((e) => e.type === 'end')) finish();
  }
  renderer.update(dt * (state.running ? state.speed : 1));
  renderer.draw(w);
  updateStats();
  requestAnimationFrame(frame);
}

function resize() {
  const wrap = $('arenaWrap');
  renderer.resize(wrap.clientWidth - 10);
}

function openPicker(side) {
  state.picking = side;
  $('pickerTitle').textContent = side === 0 ? '左の武器をえらぶ' : '右の武器をえらぶ';
  const grid = $('pickerGrid');
  grid.replaceChildren();
  for (const def of WEAPONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.id = def.id;
    btn.append(iconCanvas(def, 104), Object.assign(document.createElement('span'), { textContent: def.name }));
    btn.addEventListener('click', () => {
      choose(side, def);
      $('picker').close();
    });
    grid.append(btn);
  }
  $('picker').showModal();
}

function choose(side, def) {
  if (side === 0) state.a = def;
  else state.b = def;
  newBattle();
}

function renderBook() {
  const grid = $('bookGrid');
  grid.replaceChildren();
  $('bookCount').textContent = `全${WEAPONS.length}種`;
  for (const def of WEAPONS) {
    const rec = state.records[def.id] || { w: 0, l: 0 };
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card';
    card.dataset.id = def.id;
    const name = document.createElement('div');
    name.className = 'cname';
    name.style.color = def.color;
    name.innerHTML = `<span style="-webkit-text-stroke:1px #161616;paint-order:stroke fill">${def.name}</span><small>${def.en}</small>`;
    const recEl = document.createElement('div');
    recEl.className = 'rec';
    recEl.textContent = `${rec.w}勝 ${rec.l}敗`;
    const grow = document.createElement('div');
    grow.className = 'grow';
    grow.textContent = def.grow;
    card.append(iconCanvas(def, 88), name, recEl, grow);
    card.addEventListener('click', () => {
      // 左右交互に入れ替える(左が選ばれていれば右へ)
      const side = state.a === def ? 1 : state.b === def ? 0 : state.picking;
      choose(side, def);
      state.picking = 1 - side;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    grid.append(card);
  }
  if (state.a) updateHeader();
}

function init() {
  if (!state.a || !state.b) {
    const [a, b] = randomPair();
    state.a = state.a || a;
    state.b = state.b || (b === state.a ? a : b);
  }
  $('startBtn').addEventListener('click', start);
  $('againBtn').addEventListener('click', () => {
    newBattle();
    start();
  });
  $('nextBtn').addEventListener('click', () => {
    [state.a, state.b] = randomPair();
    newBattle();
    start();
  });
  $('randomBtn').addEventListener('click', () => {
    [state.a, state.b] = randomPair();
    newBattle();
  });
  $('swapBtn').addEventListener('click', () => {
    [state.a, state.b] = [state.b, state.a];
    newBattle();
  });
  $('pickA').addEventListener('click', () => openPicker(0));
  $('pickB').addEventListener('click', () => openPicker(1));
  $('speedBtn').textContent = '×' + state.speed;
  $('speedBtn').addEventListener('click', () => {
    state.speed = SPEEDS[(SPEEDS.indexOf(state.speed) + 1) % SPEEDS.length];
    $('speedBtn').textContent = '×' + state.speed;
  });
  $('soundBtn').addEventListener('click', () => {
    sound.unlock();
    sound.enabled = !sound.enabled;
    $('soundBtn').textContent = sound.enabled ? '🔊' : '🔇';
  });
  window.addEventListener('resize', resize);
  resize();
  renderBook();
  newBattle();
  if (params.get('autostart') === '1') start();
  requestAnimationFrame(frame);
  // フォントの読み込み後にアイコン・数字を描き直す
  if (document.fonts) document.fonts.ready.then(() => updateHeader());
}

// 自動テストから状態を見るための入り口
window.__weaponBattle = { state };

init();
