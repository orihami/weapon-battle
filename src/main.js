import { createBattle, step, DT } from './engine.js';
import { WEAPONS, WEAPON_BY_ID } from './weapons.js';
import { Renderer, drawIcon } from './render.js';
import { Sound } from './sound.js';
import { createTournament, nextMatch, reportWinner, pickEntries, roundName } from './tournament.js';

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
  tour: null, // トーナメント中なら進行状況
  bookSort: 'no',
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

// 片方だけランダムに変える(相手と同じ武器・今と同じ武器にはしない)
function randomOne(side) {
  const keep = side === 0 ? state.b : state.a;
  const now = side === 0 ? state.a : state.b;
  const pool = WEAPONS.filter((w) => w !== keep && w !== now);
  choose(side, pool[Math.floor(Math.random() * pool.length)]);
}

function newBattle() {
  state.world = createBattle(state.a, state.b, (Math.random() * 2 ** 32) >>> 0);
  state.running = false;
  renderer.particles = [];
  renderer.texts = [];
  renderer.rings = [];
  renderer.bolts = [];
  renderer.beams = [];
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
  const render = (ball) => {
    const rows = ball.def.stats(ball, w);
    // 上限を超えて成長した分は「威力」として表示する
    if (ball.power > 1.005) rows.push(['威力', '×' + ball.power.toFixed(2)]);
    return rows.map(([k, v]) => `<div style="color:${ball.def.color}">${k}:<b>${v}</b></div>`).join('');
  };
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
    if (state.tour) setTimeout(() => state.world === w && playTourMatch(), 1500); // 引き分けは同じ組み合わせでやり直し
  } else {
    // ボールの def は「ものまね」だと相手の武器になっているので、選んだ武器(state.a/b)で記録する
    const win = w.winner === 0 ? state.a : state.b;
    const lose = w.winner === 0 ? state.b : state.a;
    text.textContent = `${win.name}の勝ち！`;
    text.style.color = win.color;
    const rec = state.records;
    rec[win.id] = rec[win.id] || { w: 0, l: 0 };
    rec[lose.id] = rec[lose.id] || { w: 0, l: 0 };
    rec[win.id].w++;
    rec[lose.id].l++;
    saveRecords();
    renderBook();
    if (state.tour) {
      reportWinner(state.tour, win);
      renderBracket();
      if (state.tour.champion) {
        text.textContent = `🏆 ${win.name}が優勝！`;
      } else {
        // 少し結果を見せてから次の試合へ
        setTimeout(() => state.world === w && state.tour && playTourMatch(), 1800);
      }
    }
  }
  setTimeout(() => {
    if (state.world === w) $('overlay').hidden = false;
  }, 700);
}

function startTournament(n) {
  sound.unlock();
  state.tour = createTournament(pickEntries(WEAPONS, n));
  $('tourStopBtn').hidden = false;
  playTourMatch();
}

function stopTournament() {
  if (!state.tour) return;
  state.tour = null;
  $('tourStopBtn').hidden = true;
  renderBracket();
}

function playTourMatch() {
  const next = state.tour && nextMatch(state.tour);
  if (!next) return;
  state.a = next.match.a;
  state.b = next.match.b;
  newBattle();
  renderBracket();
  start();
  $('arenaWrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderBracket() {
  const box = $('bracket');
  box.replaceChildren();
  const t = state.tour;
  $('tourHint').hidden = !!t;
  if (!t) return;
  const now = nextMatch(t);
  t.rounds.forEach((round, r) => {
    const col = document.createElement('div');
    col.className = 'round';
    col.append(Object.assign(document.createElement('h3'), { textContent: roundName(t, r) }));
    round.forEach((m, i) => {
      const el = document.createElement('div');
      el.className = 'match' + (now && now.round === r && now.index === i && !t.champion ? ' now' : '');
      for (const side of [m.a, m.b]) {
        const row = document.createElement('div');
        row.textContent = side ? side.name : '？';
        if (side) row.style.color = side.color;
        if (m.winner) row.className = m.winner === side ? 'win' : 'lose';
        el.append(row);
      }
      col.append(el);
    });
    box.append(col);
  });
  if (t.champion) {
    const c = document.createElement('p');
    c.className = 'champion';
    c.innerHTML = `🏆 優勝: <b style="color:${t.champion.color}">${t.champion.name}</b>`;
    box.after(c);
    const old = box.parentElement.querySelectorAll('.champion');
    old.forEach((x, i) => i < old.length - 1 && x.remove());
  } else {
    box.parentElement.querySelectorAll('.champion').forEach((x) => x.remove());
  }
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
  stopTournament();
  if (side === 0) state.a = def;
  else state.b = def;
  newBattle();
}

function renderBook() {
  const grid = $('bookGrid');
  grid.replaceChildren();
  $('bookCount').textContent = `全${WEAPONS.length}種`;
  const recOf = (def) => state.records[def.id] || { w: 0, l: 0 };
  const rate = (r) => (r.w + r.l ? r.w / (r.w + r.l) : -1);
  const list = WEAPONS.slice();
  if (state.bookSort === 'rate') list.sort((x, y) => rate(recOf(y)) - rate(recOf(x)) || recOf(y).w - recOf(x).w);
  if (state.bookSort === 'games') list.sort((x, y) => recOf(y).w + recOf(y).l - (recOf(x).w + recOf(x).l));
  list.forEach((def, idx) => {
    const rec = recOf(def);
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
    const games = rec.w + rec.l;
    recEl.textContent = `${rec.w}勝 ${rec.l}敗` + (games ? `(${Math.round((rec.w / games) * 100)}%)` : '');
    if (state.bookSort === 'rate' && games) {
      recEl.prepend(Object.assign(document.createElement('span'), { className: 'rank', textContent: `${idx + 1}位` }));
    }
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
  });
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
    stopTournament();
    newBattle();
    start();
  });
  $('nextBtn').addEventListener('click', () => {
    stopTournament();
    [state.a, state.b] = randomPair();
    newBattle();
    start();
  });
  $('randomBtn').addEventListener('click', () => {
    stopTournament();
    [state.a, state.b] = randomPair();
    newBattle();
  });
  $('randomABtn').addEventListener('click', () => randomOne(0));
  $('randomBBtn').addEventListener('click', () => randomOne(1));
  $('pickerRandom').addEventListener('click', () => {
    randomOne(state.picking);
    $('picker').close();
  });
  $('swapBtn').addEventListener('click', () => {
    stopTournament();
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
  $('tour8Btn').addEventListener('click', () => startTournament(8));
  $('tour16Btn').addEventListener('click', () => startTournament(16));
  $('tourStopBtn').addEventListener('click', stopTournament);
  $('bookSort').addEventListener('change', (e) => {
    state.bookSort = e.target.value;
    renderBook();
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
