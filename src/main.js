// 画面の操作。ホーム → 準備 → バトル の画面を切り替えて遊ぶ。
import { createMelee, step, DT } from './engine.js?v=7833328';
import { WEAPONS, WEAPON_BY_ID } from './weapons.js?v=7833328';
import { Renderer, drawIcon } from './render.js?v=7833328';
import { Sound } from './sound.js?v=7833328';
import { createTournament, nextMatch, reportWinner, pickEntries, roundName } from './tournament.js?v=7833328';
import { newChallenge, enemyBoost, offerCards, takeCards, isBoss } from './challenge.js?v=7833328';
import { RARITY, cpuPick } from './skills.js?v=7833328';
import { createRounds, fighters, reportRound, pickSkills } from './rounds.js?v=7833328';

const $ = (id) => document.getElementById(id);
const SPEEDS = [1, 2, 4];
const RECORD_KEY = 'weapon-battle-records';
const BEST_KEY = 'weapon-battle-challenge-best';
const PLAYER_COLORS = ['#e8484d', '#2f7de1', '#2fa84f', '#e0a600'];

// 遊び方ごとの設定。counts: 選べる人数 / fixed: 人数が決まっている
const MODES = {
  duel: { title: '⚔️ 1対1', fixed: 2, go: 'バトル開始！', hint: '武器をタップして変える。🎲 でその人だけランダム。' },
  royale: { title: '💥 バトルロイヤル', counts: [3, 4], go: 'バトル開始！', hint: '全員が広いフィールドで同時に戦います。それぞれ一番近い相手をねらい、最後に残った1人の勝ち。' },
  rounds: {
    title: '🃏 ラウンズ',
    counts: [2, 3, 4],
    go: 'ラウンズ開始！',
    hint: '全員同時に戦い、勝った人に★。負けた人はみんなスキルカードを選んで強くなる(3回目ごとは大進化で2枚)。1台を交代で操作します。',
  },
  chal: { title: '🗡️ チャレンジ', fixed: 1, go: '挑戦する！', hint: 'この武器で、だんだん強くなる敵と連戦。勝つたびにスキルカード、5ステージごとにボス(倒すと大進化)。負けたら終わり。' },
  tour: { title: '🏆 トーナメント', go: 'トーナメント開始！', hint: 'ランダムに選ばれた武器で勝ち抜き戦をします。試合は自動で次々に進みます。' },
};

// 武器の分類(選ぶ画面のタブ)
const KIND_TABS = [
  ['all', 'すべて'],
  ['near', '近接'],
  ['far', '飛び道具'],
  ['other', '特殊'],
];
const kindTab = (def) => (def.kind === 'ranged' ? 'far' : def.kind === 'body' || def.kind === 'copy' ? 'other' : 'near');

const params = new URLSearchParams(location.search);
const renderer = new Renderer($('arena'));
const sound = new Sound();

const state = {
  screen: 'home',
  mode: 'duel',
  slots: [], // 準備画面の各プレイヤー { weapon, cpu }
  count: { duel: 2, royale: 4, rounds: 2, chal: 1 },
  target: 5,
  tourSize: 8,
  fighters: [], // 今の試合で選ばれた武器(ものまねでも元の武器で記録する)
  boosts: [], // 今の試合の強化(スキルなど)
  labels: null, // ボールの上の名札
  world: null,
  running: false,
  speed: SPEEDS.includes(Number(params.get('speed'))) ? Number(params.get('speed')) : 1,
  records: loadRecords(),
  tour: null,
  chal: null,
  rounds: null,
  auto: false,
  bookSort: 'no',
  bookQuery: '',
  pickerTab: 'all',
};

// ---- 保存 ----

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

function loadBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(n) {
  try {
    localStorage.setItem(BEST_KEY, String(n));
  } catch {
    // 保存できない環境では記録しない
  }
}

// ---- 小物 ----

const pick = (list) => list[Math.floor(Math.random() * list.length)];

// 重ならないように n 個の武器を選ぶ
function randomWeapons(n, avoid = []) {
  const pool = WEAPONS.filter((w) => !avoid.includes(w));
  const out = [];
  while (out.length < n) {
    const w = pick(pool.length ? pool : WEAPONS);
    if (!out.includes(w) || out.length >= WEAPONS.length) out.push(w);
  }
  return out;
}

// アイコンは1度描いたものを使い回す
const iconCache = new Map();
function iconCanvas(def, px) {
  let base = iconCache.get(def.id);
  if (!base) {
    base = document.createElement('canvas');
    base.width = base.height = 128;
    drawIcon(base, def);
    iconCache.set(def.id, base);
  }
  const c = document.createElement('canvas');
  c.width = c.height = px;
  c.getContext('2d').drawImage(base, 0, 0, px, px);
  return c;
}

function el(tag, props = {}, ...children) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

function skillIcons(list) {
  return list.map((sk) => `<span class="ic" title="${sk.name}" style="border-color:${RARITY[sk.rarity].color}">${sk.icon}</span>`).join('');
}

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2500);
}

// ---- 画面の切り替え(スマホの「戻る」でも戻れるように履歴を使う) ----

function show(screen, push = true) {
  if (state.screen === 'battle' && screen !== 'battle') leaveBattle();
  if (push && state.screen !== screen) history.pushState({ screen }, '');
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== screen;
  state.screen = screen;
  if (screen === 'home') renderHome();
  if (screen === 'book') renderBook();
  if (screen === 'battle') requestAnimationFrame(resize);
  window.scrollTo(0, 0);
}

function goBack() {
  if (history.state && history.state.screen && history.state.screen !== 'home') history.back();
  else show('home');
}

window.addEventListener('popstate', (e) => {
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  let s = (e.state && e.state.screen) || 'home';
  if (s === 'battle' && !state.world) s = 'home';
  show(s, false);
});

// バトル画面から出たら、進行中のモードは終わりにする
function leaveBattle() {
  state.running = false;
  state.tour = null;
  state.chal = null;
  state.rounds = null;
  state.auto = false;
  state.world = null;
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
}

// ---- ホーム ----

function renderHome() {
  const best = loadBest();
  $('bestText').textContent = best ? `(最高 ${best}勝)` : '';
  $('bookCount').textContent = `全${WEAPONS.length}種`;
}

function openMode(mode) {
  sound.unlock();
  if (mode === 'auto') {
    state.mode = 'auto';
    show('battle');
    state.auto = true;
    playAuto();
    return;
  }
  state.mode = mode;
  show('setup');
  renderSetup();
}

// ---- 準備 ----

function ensureSlots() {
  while (state.slots.length < 4) {
    state.slots.push({
      weapon: randomWeapons(1, state.slots.map((s) => s.weapon))[0],
      cpu: state.slots.length > 0,
    });
  }
}

function slotCount() {
  const m = MODES[state.mode];
  return m.fixed || state.count[state.mode] || 0;
}

function renderSetup() {
  ensureSlots();
  const mode = state.mode;
  const m = MODES[mode];
  $('setupTitle').textContent = m.title;
  $('setupHint').textContent = m.hint;
  $('goBtn').textContent = m.go;
  $('countRow').hidden = !m.counts;
  if (m.counts) {
    $('countSeg').replaceChildren(
      ...m.counts.map((n) => {
        const b = el('button', { type: 'button', textContent: `${n}人`, className: n === state.count[mode] ? 'on' : '' });
        b.dataset.count = n;
        b.addEventListener('click', () => {
          state.count[mode] = n;
          renderSetup();
        });
        return b;
      }),
    );
  }
  $('targetRow').hidden = mode !== 'rounds';
  for (const b of $('targetSeg').children) b.classList.toggle('on', Number(b.dataset.target) === state.target);
  $('sizeRow').hidden = mode !== 'tour';
  for (const b of $('sizeSeg').children) b.classList.toggle('on', Number(b.dataset.size) === state.tourSize);
  $('setupTools').hidden = mode === 'tour' || mode === 'chal';
  $('swapBtn').hidden = mode !== 'duel';

  const n = mode === 'tour' ? 0 : slotCount();
  const box = $('slots');
  box.replaceChildren();
  state.slots.slice(0, n).forEach((s, i) => {
    const slot = el('div', { className: 'slot' });
    slot.style.setProperty('--c', mode === 'chal' ? '#8b3fe0' : PLAYER_COLORS[i]);
    const tag = el('span', { className: 'ptag', textContent: mode === 'chal' ? 'YOU' : `P${i + 1}` });
    const pickBtn = el(
      'button',
      { type: 'button', className: 'slot-pick' },
      iconCanvas(s.weapon, 112),
      el('span', { className: 'slot-text' }, el('b', { textContent: s.weapon.name }), el('small', { textContent: s.weapon.grow })),
    );
    pickBtn.style.setProperty('--w', s.weapon.color);
    pickBtn.setAttribute('aria-label', `P${i + 1}の武器(${s.weapon.name})を変える`);
    pickBtn.addEventListener('click', () =>
      openPicker(
        mode === 'chal' ? '挑戦する武器をえらぶ' : `P${i + 1} の武器をえらぶ`,
        (def) => {
          s.weapon = def;
          renderSetup();
        },
        () => {
          s.weapon = randomWeapons(1, state.slots.slice(0, n).map((x) => x.weapon))[0];
          renderSetup();
        },
      ),
    );
    const dice = el('button', { type: 'button', className: 'icon-btn slot-dice', textContent: '🎲' });
    dice.setAttribute('aria-label', `P${i + 1}だけランダム`);
    dice.addEventListener('click', () => {
      s.weapon = randomWeapons(1, state.slots.slice(0, n).map((x) => x.weapon))[0];
      renderSetup();
    });
    const side = el('div', { className: 'slot-side' }, dice);
    if (mode === 'rounds') {
      const who = el('button', { type: 'button', className: 'slot-who' + (s.cpu ? ' cpu' : ''), textContent: s.cpu ? '🤖 CPU' : '🙂 人' });
      who.addEventListener('click', () => {
        s.cpu = !s.cpu;
        renderSetup();
      });
      side.append(who);
    }
    slot.append(tag, pickBtn, side);
    box.append(slot);
  });
}

function begin() {
  sound.unlock();
  const mode = state.mode;
  const slots = state.slots.slice(0, slotCount());
  leaveBattle();
  show('battle');
  if (mode === 'duel' || mode === 'royale') {
    setMatch(
      slots.map((s) => s.weapon),
      [],
      mode === 'royale' ? slots.map((_, i) => ({ text: `P${i + 1}`, color: PLAYER_COLORS[i] })) : null,
    );
    play();
  } else if (mode === 'rounds') {
    state.rounds = createRounds(
      slots.map((s, i) => ({ name: `P${i + 1}`, weapon: s.weapon, cpu: s.cpu, color: PLAYER_COLORS[i] })),
      state.target,
    );
    playRound();
  } else if (mode === 'chal') {
    state.chal = newChallenge(slots[0].weapon);
    playChalStage();
  } else if (mode === 'tour') {
    state.tour = createTournament(pickEntries(WEAPONS, state.tourSize));
    playTourMatch();
  }
}

// ---- 試合 ----

function setMatch(defs, boosts = [], labels = null) {
  state.fighters = defs;
  state.boosts = boosts;
  state.labels = labels;
  newBattle();
}

function newBattle() {
  state.world = createMelee(state.fighters, (Math.random() * 2 ** 32) >>> 0, { boosts: state.boosts });
  state.running = false;
  renderer.particles = [];
  renderer.texts = [];
  renderer.rings = [];
  renderer.bolts = [];
  renderer.beams = [];
  renderer.prisms = [];
  renderer.ko = null;
  renderer.labels = state.labels;
  $('overlay').hidden = true;
  renderTitle();
  renderHud();
  renderSideInfo();
  updatePlay();
  $('shareBtn').hidden = !['duel', 'royale', 'auto'].includes(state.mode);
  resize();
}

function play() {
  sound.unlock();
  const w = state.world;
  if (!w || w.over) return;
  state.running = !state.running;
  updatePlay();
}

function updatePlay() {
  const btn = $('playBtn');
  const w = state.world;
  btn.disabled = !w || w.over;
  btn.textContent = !w || w.over ? '決着' : state.running ? '⏸ 一時停止' : w.t > 0 ? '▶ 再開' : '▶ スタート';
}

function nameOf(i) {
  const def = state.fighters[i];
  const tag = state.labels && state.labels[i];
  return tag && /^P\d/.test(tag.text) ? `${tag.text} ${def.name}` : def.name;
}

function renderTitle() {
  const t = $('battleTitle');
  const f = state.fighters;
  let html;
  if (state.rounds) {
    const r = state.rounds;
    html = `ラウンド ${r.round} <small>${r.target}勝で優勝</small>`;
  } else if (state.chal) {
    const st = state.chal.stage;
    html = `ステージ ${st}${isBoss(st) ? ' <b class="boss">BOSS</b>' : ''}`;
  } else if (state.tour) {
    const next = nextMatch(state.tour);
    html = next ? roundName(state.tour, next.round) : 'トーナメント';
  } else if (f.length === 2) {
    html = `<span style="color:${f[0].color}">${f[0].name}</span> <i>VS</i> <span style="color:${f[1].color}">${f[1].name}</span>`;
  } else {
    html = `バトルロイヤル <small>${f.length}人</small>`;
  }
  t.innerHTML = html;
  document.title = `${t.textContent} | ウェポンバトル`;
}

// 戦場の上の各プレイヤーの表示(HP・能力値・スキル)
function renderHud() {
  const w = state.world;
  const hud = $('hud');
  hud.replaceChildren();
  hud.className = 'hud n' + w.balls.length;
  w.balls.forEach((ball, i) => {
    const def = state.fighters[i];
    const tag = state.labels && state.labels[i];
    const card = el('div', { className: 'hud-card' });
    card.style.setProperty('--c', def.color);
    const top = el('div', { className: 'hud-top' });
    if (tag) {
      const t = el('span', { className: 'ptag', textContent: tag.text });
      t.style.background = tag.color;
      top.append(t);
    }
    top.append(iconCanvas(def, 56), el('span', { className: 'hud-name', textContent: def.name }));
    if (state.rounds) {
      const p = state.rounds.players[i];
      top.append(el('span', { className: 'stars', textContent: '★'.repeat(p.wins) }));
    }
    const hp = el('div', { className: 'hp' }, el('i'), el('span'));
    card.append(top, hp, el('div', { className: 'hud-stats' }), el('div', { className: 'chips' }));
    hud.append(card);
  });
  hudCache = [];
  updateHud();
}

let hudCache = [];
function updateHud() {
  const w = state.world;
  if (!w) return;
  const cards = $('hud').children;
  w.balls.forEach((ball, i) => {
    const card = cards[i];
    if (!card) return;
    const hpPct = Math.max(0, Math.min(100, (ball.hp / ball.maxHp) * 100));
    const rows = ball.def.stats(ball, w);
    // 上限を超えて成長した分は「威力」として表示する
    if (ball.power > 1.005) rows.push(['威力', '×' + ball.power.toFixed(2)]);
    const stats = rows.map(([k, v]) => `${k} <b>${v}</b>`).join('<em>・</em>');
    const chips = ball.skills.map((sk) => `<span title="${sk.def.name}" style="border-color:${RARITY[sk.def.rarity].color}">${sk.def.icon}</span>`).join('');
    const key = `${Math.ceil(ball.hp)}|${hpPct.toFixed(1)}|${stats}|${chips}|${ball.dead}`;
    if (hudCache[i] === key) return;
    hudCache[i] = key;
    card.classList.toggle('out', !!ball.dead);
    card.querySelector('.hp i').style.width = hpPct + '%';
    card.querySelector('.hp span').textContent = ball.dead ? 'OUT' : `HP ${Math.ceil(ball.hp)}`;
    card.querySelector('.hud-stats').innerHTML = stats;
    card.querySelector('.chips').innerHTML = chips;
  });
  $('timer').textContent = w.t.toFixed(1);
}

function setButtons(list) {
  $('overlayButtons').replaceChildren(
    ...list.map(({ text, primary, onClick, id }) => {
      const b = el('button', { type: 'button', textContent: text, className: primary ? 'primary' : '' });
      if (id) b.id = id;
      b.addEventListener('click', onClick);
      return b;
    }),
  );
}

function finish() {
  const w = state.world;
  state.running = false;
  updatePlay();
  updateHud();
  const text = $('resultText');
  const sub = $('resultSub');
  sub.textContent = '';
  setButtons([]);
  if (w.winner === -1) {
    text.textContent = '引き分け！';
    text.style.color = '#ffffff';
    // モード中は同じ組み合わせでやり直し
    if (state.tour) setTimeout(() => state.world === w && playTourMatch(), 1500);
    else if (state.chal) setTimeout(() => state.world === w && playChalStage(), 1500);
    else if (state.rounds) {
      reportRound(state.rounds, -1);
      setTimeout(() => state.world === w && playRound(), 1500);
    } else if (state.auto) setTimeout(() => state.world === w && playAuto(), 1800);
    else setButtons(matchButtons());
  } else {
    const win = state.fighters[w.winner];
    text.textContent = `${nameOf(w.winner)}の勝ち！`;
    text.style.color = (state.labels && state.labels[w.winner] && state.rounds ? state.labels[w.winner].color : null) || win.color;
    record(w.winner);
    if (state.rounds) roundResult(w);
    else if (state.chal) chalResult(w.winner === 0);
    else if (state.tour) tourResult(win, w);
    else if (state.auto) setTimeout(() => state.world === w && state.auto && playAuto(), 2200);
    else setButtons(matchButtons());
  }
  setTimeout(() => {
    if (state.world === w) $('overlay').hidden = false;
  }, 700);
}

// 戦績: 1対1の試合は勝ち/負け、3人以上は「バトルロイヤルで1位になった回数」を数える
function record(winnerIdx) {
  const rec = state.records;
  const f = state.fighters;
  const get = (def) => (rec[def.id] = rec[def.id] || { w: 0, l: 0 });
  if (f.length === 2) {
    get(f[winnerIdx]).w++;
    get(f[1 - winnerIdx]).l++;
  } else {
    const r = get(f[winnerIdx]);
    r.k = (r.k || 0) + 1;
  }
  saveRecords();
}

function matchButtons() {
  return [
    {
      text: 'もう一度',
      primary: true,
      id: 'againBtn',
      onClick: () => {
        newBattle();
        play();
      },
    },
    {
      text: '🎲 別の武器で',
      id: 'nextBtn',
      onClick: () => {
        const defs = randomWeapons(state.fighters.length);
        defs.forEach((d, i) => (state.slots[i].weapon = d));
        setMatch(defs, [], state.labels);
        play();
      },
    },
    { text: '準備にもどる', onClick: goBack },
  ];
}

// ---- ラウンズ ----

function playRound() {
  const r = state.rounds;
  if (!r) return;
  const ps = fighters(r).map((i) => r.players[i]);
  setMatch(
    ps.map((p) => p.weapon),
    ps.map((p) => ({ skills: p.skills })),
    ps.map((p) => ({ text: p.name, color: p.color })),
  );
  play();
}

function roundResult(w) {
  const r = state.rounds;
  const winner = r.players[w.winner];
  reportRound(r, w.winner, Math.random, w.outOrder);
  renderSideInfo();
  renderHud();
  if (r.champion) {
    $('resultText').textContent = `🏆 ${winner.name} 優勝！`;
    $('resultSub').textContent = `${winner.weapon.name}・${winner.wins}勝`;
    setButtons([
      { text: 'もう一度(同じ設定)', primary: true, onClick: begin },
      { text: 'ホームへ', onClick: () => show('home') },
    ]);
    return;
  }
  setTimeout(() => state.rounds === r && nextPick(r), 1100);
}

// 負けた人が順番にカードを選ぶ。全員選んだら次のラウンド
function nextPick(r) {
  if (state.rounds !== r) return;
  const pend = r.pending;
  if (!pend) {
    playRound();
    return;
  }
  const p = r.players[pend.player];
  showCards({
    who: `${p.name}${p.cpu ? '(CPU)' : ''} のカード選び`,
    color: p.color,
    sub: pend.big ? '🌟 大進化！ 4枚から2枚選べる' : `${p.weapon.name} を強くするカードを1枚`,
    cards: pend.cards,
    choose: pend.choose,
    cpu: p.cpu,
    mine: p.skills,
    onDone(cards) {
      pickSkills(r, cards);
      renderSideInfo();
      nextPick(r);
    },
  });
}

// ---- チャレンジ ----

function playChalStage() {
  const ch = state.chal;
  if (!ch) return;
  const enemy = pick(WEAPONS.filter((w) => w !== ch.weapon));
  ch.enemy = enemyBoost(ch.stage);
  setMatch(
    [ch.weapon, enemy],
    [{ skills: ch.skills }, ch.enemy],
    [{ text: 'YOU', color: '#8b3fe0' }, ch.enemy.boss ? { text: 'BOSS', color: '#c01f1f' } : null],
  );
  play();
}

function chalResult(won) {
  const ch = state.chal;
  const text = $('resultText');
  if (!won) {
    const cleared = ch.stage - 1;
    const best = Math.max(loadBest(), cleared);
    saveBest(best);
    text.textContent = `ステージ${ch.stage}で敗退…`;
    $('resultSub').textContent = `${cleared}勝 / 最高記録 ${best}勝`;
    const weapon = ch.weapon;
    state.chal = null;
    setButtons([
      {
        text: 'もう一度挑戦',
        primary: true,
        onClick: () => {
          state.mode = 'chal';
          state.slots[0].weapon = weapon;
          begin();
        },
      },
      { text: 'ホームへ', onClick: () => show('home') },
    ]);
    return;
  }
  const offer = offerCards(ch);
  text.textContent = ch.enemy.boss ? 'ボス撃破！' : `ステージ${ch.stage} クリア！`;
  setTimeout(() => {
    if (state.chal !== ch) return;
    showCards({
      who: 'スキルカードを選ぶ',
      color: '#8b3fe0',
      sub: offer.big ? '🌟 大進化！ 4枚から2枚選べる' : `${ch.weapon.name} を強くするカードを1枚`,
      cards: offer.cards,
      choose: offer.choose,
      mine: ch.skills,
      onDone(cards) {
        takeCards(ch, cards);
        playChalStage();
      },
    });
  }, 1100);
}

// ---- トーナメント ----

function playTourMatch() {
  const next = state.tour && nextMatch(state.tour);
  if (!next) return;
  setMatch([next.match.a, next.match.b]);
  renderBracket();
  play();
}

function tourResult(win, w) {
  reportWinner(state.tour, win);
  renderBracket();
  if (state.tour.champion) {
    $('resultText').textContent = `🏆 ${win.name}が優勝！`;
    setButtons([
      { text: '新しいトーナメント', primary: true, onClick: begin },
      { text: 'ホームへ', onClick: () => show('home') },
    ]);
  } else {
    setTimeout(() => state.world === w && state.tour && playTourMatch(), 1800);
  }
}

function renderBracket() {
  const box = $('bracket');
  box.replaceChildren();
  const t = state.tour;
  if (!t) return;
  const now = nextMatch(t);
  const cols = el('div', { className: 'bracket-cols' });
  t.rounds.forEach((round, r) => {
    const col = el('div', { className: 'round' }, el('h3', { textContent: roundName(t, r) }));
    round.forEach((m, i) => {
      const box2 = el('div', { className: 'match' + (now && now.round === r && now.index === i && !t.champion ? ' now' : '') });
      for (const side of [m.a, m.b]) {
        const row = el('div', { textContent: side ? side.name : '？' });
        if (side) row.style.color = side.color;
        if (m.winner) row.className = m.winner === side ? 'win' : 'lose';
        box2.append(row);
      }
      col.append(box2);
    });
    cols.append(col);
  });
  box.append(cols);
  if (t.champion) box.append(el('p', { className: 'champion', innerHTML: `🏆 優勝: <b style="color:${t.champion.color}">${t.champion.name}</b>` }));
}

// ---- 連続観戦 ----

function playAuto() {
  if (!state.auto) return;
  const r = Math.random();
  const n = r < 0.5 ? 2 : r < 0.75 ? 3 : 4;
  setMatch(randomWeapons(n), [], n > 2 ? Array.from({ length: n }, (_, i) => ({ text: `P${i + 1}`, color: PLAYER_COLORS[i] })) : null);
  play();
}

// ---- バトル画面の下の情報 ----

function renderSideInfo() {
  const box = $('sideInfo');
  if (state.rounds) {
    const r = state.rounds;
    box.innerHTML =
      '<h3>スコア</h3>' +
      r.players
        .map(
          (p) =>
            `<div class="board-row"><span class="ptag" style="background:${p.color}">${p.name}</span><span class="bname" style="color:${p.weapon.color}">${p.weapon.name}${p.cpu ? ' 🤖' : ''}</span><span class="stars">${'★'.repeat(p.wins)}${'☆'.repeat(Math.max(0, r.target - p.wins))}</span><span class="bskills">${skillIcons(p.skills)}</span></div>`,
        )
        .join('');
  } else if (state.chal) {
    const ch = state.chal;
    const e = ch.enemy || enemyBoost(ch.stage);
    box.innerHTML =
      `<h3>${ch.weapon.name}の挑戦(最高記録 ${loadBest()}勝)</h3>` +
      `<p>自分のスキル: ${skillIcons(ch.skills) || 'まだなし'}</p>` +
      `<p>敵: HP${e.maxHp}・初期成長+${e.preGrow}${e.skills.length ? '・' + skillIcons(e.skills) : ''}</p>`;
  } else if (state.auto) {
    box.innerHTML = '<p>ランダムな対戦を自動で流し続けます。止めるときは ← でもどる。</p>';
  } else {
    box.innerHTML = '';
  }
  box.hidden = !box.innerHTML;
}

// ---- スキルカード選び ----

function showCards({ who, color, sub, cards, choose, cpu = false, mine = [], onDone }) {
  const dlg = $('cardDialog');
  dlg.dataset.seq = Number(dlg.dataset.seq || 0) + 1; // 何回目のカード選びか(テスト用)
  $('cardWho').textContent = who;
  $('cardWho').style.background = color;
  $('cardSub').textContent = sub + (cpu ? '(CPUが選びます)' : '');
  $('cardMine').innerHTML = mine.length ? `持っているカード: ${skillIcons(mine)}` : '';
  const grid = $('cardGrid');
  grid.replaceChildren();
  const picked = new Set();
  let done = false;
  const buttons = cards.map((card) => {
    const rare = RARITY[card.rarity];
    const b = el('button', { type: 'button', className: 'skill-card' });
    b.style.setProperty('--r', rare.color);
    b.innerHTML = `<span class="sc-rare">${rare.name}</span><span class="sc-icon">${card.icon}</span><b>${card.name}</b><small>${card.desc}</small>`;
    b.addEventListener('click', () => {
      if (cpu || done) return;
      if (choose === 1) return finishPick([card]);
      if (picked.has(card)) picked.delete(card);
      else if (picked.size < choose) picked.add(card);
      b.classList.toggle('picked', picked.has(card));
      if (picked.size === choose) finishPick([...picked]);
    });
    grid.append(b);
    return [card, b];
  });
  function finishPick(list) {
    if (done) return;
    done = true;
    for (const [card, b] of buttons) b.classList.toggle('picked', list.includes(card));
    setTimeout(() => {
      if (dlg.open) dlg.close();
      onDone(list);
    }, 450);
  }
  if (!dlg.open) dlg.showModal();
  if (cpu) setTimeout(() => finishPick(cpuPick(cards, choose)), 1200);
}

// ---- 武器を選ぶ画面 ----

let pickerCb = null;
function openPicker(title, onPick, onRandom) {
  $('pickerTitle').textContent = title;
  pickerCb = { onPick, onRandom };
  $('pickerSearch').value = '';
  renderPicker();
  $('picker').showModal();
}

function renderPicker() {
  $('pickerTabs').replaceChildren(
    ...KIND_TABS.map(([id, label]) => {
      const n = id === 'all' ? WEAPONS.length : WEAPONS.filter((w) => kindTab(w) === id).length;
      const b = el('button', { type: 'button', textContent: `${label} ${n}`, className: state.pickerTab === id ? 'on' : '' });
      b.addEventListener('click', () => {
        state.pickerTab = id;
        renderPicker();
      });
      return b;
    }),
  );
  const q = $('pickerSearch').value.trim().toLowerCase();
  const list = WEAPONS.filter((w) => (state.pickerTab === 'all' || kindTab(w) === state.pickerTab) && (!q || w.name.includes(q) || w.en.toLowerCase().includes(q)));
  const grid = $('pickerGrid');
  grid.replaceChildren(
    ...list.map((def) => {
      const b = el('button', { type: 'button' }, iconCanvas(def, 104), el('span', { textContent: def.name }));
      b.dataset.id = def.id;
      b.addEventListener('click', () => {
        $('picker').close();
        pickerCb.onPick(def);
      });
      return b;
    }),
  );
  if (!list.length) grid.append(el('p', { className: 'hint', textContent: '見つかりませんでした' }));
}

// ---- ずかん ----

function renderBook() {
  const grid = $('bookGrid');
  grid.replaceChildren();
  const recOf = (def) => state.records[def.id] || { w: 0, l: 0 };
  const rate = (r) => (r.w + r.l ? r.w / (r.w + r.l) : -1);
  const q = state.bookQuery.trim().toLowerCase();
  let list = WEAPONS.filter((w) => !q || w.name.includes(q) || w.en.toLowerCase().includes(q));
  if (state.bookSort === 'rate') list.sort((x, y) => rate(recOf(y)) - rate(recOf(x)) || recOf(y).w - recOf(x).w);
  if (state.bookSort === 'games') list.sort((x, y) => recOf(y).w + recOf(y).l - (recOf(x).w + recOf(x).l));
  list.forEach((def, idx) => {
    const rec = recOf(def);
    const games = rec.w + rec.l;
    const card = el('button', { type: 'button', className: 'card' });
    card.dataset.id = def.id;
    const name = el('div', { className: 'cname', innerHTML: `<span style="color:${def.color}">${def.name}</span><small>${def.en}</small>` });
    const recEl = el('div', {
      className: 'rec',
      textContent: `${rec.w}勝 ${rec.l}敗` + (games ? `(${Math.round((rec.w / games) * 100)}%)` : '') + (rec.k ? ` 👑${rec.k}` : ''),
    });
    if (state.bookSort === 'rate' && games) recEl.prepend(el('span', { className: 'rank', textContent: `${idx + 1}位` }));
    card.append(iconCanvas(def, 88), name, recEl, el('div', { className: 'grow', textContent: def.grow }));
    card.addEventListener('click', () => {
      ensureSlots();
      state.slots[0].weapon = def;
      if (state.slots[1].weapon === def) state.slots[1].weapon = randomWeapons(1, [def])[0];
      state.mode = 'duel';
      show('setup');
      renderSetup();
    });
    grid.append(card);
  });
}

// ---- 共有 ----

async function share() {
  const f = state.fighters;
  const q = f.length === 2 ? `a=${f[0].id}&b=${f[1].id}` : `w=${f.map((d) => d.id).join(',')}`;
  const url = `${location.origin}${location.pathname}?${q}`;
  const title = `${f.map((d) => d.name).join(' VS ')} | ウェポンバトル`;
  try {
    if (navigator.share) {
      await navigator.share({ title, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast('この対戦のURLをコピーしました');
  } catch {
    toast(url);
  }
}

// ---- ループ ----

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
  if (state.screen === 'battle') {
    renderer.update(dt * (state.running ? state.speed : 1));
    if (w) renderer.draw(w);
    updateHud();
  }
  requestAnimationFrame(frame);
}

// 戦場は画面に収まる一番大きい正方形にする
function resize() {
  if (state.screen !== 'battle') return;
  const wrap = $('arenaWrap');
  const used = document.querySelector('#battle .bar').offsetHeight + $('hud').offsetHeight + document.querySelector('#battle .controls').offsetHeight + 36;
  const byW = Math.min(window.innerWidth, 860) - 24;
  const byH = window.innerHeight - used;
  const size = Math.round(Math.max(260, Math.min(byW, byH, 860)));
  wrap.style.width = size + 'px';
  renderer.resize(size - 10);
}

// ---- はじめに ----

function init() {
  for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => openMode(b.dataset.mode));
  for (const b of document.querySelectorAll('[data-back]')) b.addEventListener('click', goBack);
  $('bookOpen').addEventListener('click', () => show('book'));
  for (const b of $('targetSeg').children) {
    b.addEventListener('click', () => {
      state.target = Number(b.dataset.target);
      renderSetup();
    });
  }
  for (const b of $('sizeSeg').children) {
    b.addEventListener('click', () => {
      state.tourSize = Number(b.dataset.size);
      renderSetup();
    });
  }
  $('randomAll').addEventListener('click', () => {
    const n = slotCount();
    randomWeapons(n).forEach((d, i) => (state.slots[i].weapon = d));
    renderSetup();
  });
  $('swapBtn').addEventListener('click', () => {
    const [a, b] = state.slots;
    [a.weapon, b.weapon] = [b.weapon, a.weapon];
    renderSetup();
  });
  $('goBtn').addEventListener('click', begin);
  $('playBtn').addEventListener('click', play);
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
  $('shareBtn').addEventListener('click', share);
  $('pickerClose').addEventListener('click', () => $('picker').close());
  $('pickerSearch').addEventListener('input', renderPicker);
  $('pickerRandom').addEventListener('click', () => {
    $('picker').close();
    pickerCb.onRandom();
  });
  // カード選びは閉じられないようにする(Escキーなど)
  $('cardDialog').addEventListener('cancel', (e) => e.preventDefault());
  $('bookSort').addEventListener('change', (e) => {
    state.bookSort = e.target.value;
    renderBook();
  });
  $('bookSearch').addEventListener('input', (e) => {
    state.bookQuery = e.target.value;
    renderBook();
  });
  window.addEventListener('resize', resize);

  ensureSlots();
  history.replaceState({ screen: 'home' }, '');
  renderHome();

  // 共有URL: ?a=剣&b=短剣(1対1) / ?w=a,b,c(バトルロイヤル)
  const shared = params.get('w')
    ? params.get('w').split(',').map((id) => WEAPON_BY_ID[id]).filter(Boolean).slice(0, 4)
    : [WEAPON_BY_ID[params.get('a')], WEAPON_BY_ID[params.get('b')]].filter(Boolean);
  if (shared.length >= 2) {
    state.mode = shared.length === 2 ? 'duel' : 'royale';
    if (shared.length > 2) state.count.royale = shared.length;
    shared.forEach((d, i) => (state.slots[i].weapon = d));
    history.pushState({ screen: 'setup' }, '');
    renderSetup();
    show('battle');
    setMatch(shared, [], shared.length > 2 ? shared.map((_, i) => ({ text: `P${i + 1}`, color: PLAYER_COLORS[i] })) : null);
    if (params.get('autostart') === '1') play();
  }
  requestAnimationFrame(frame);
}

// 自動テストから状態を見るための入り口
window.__weaponBattle = { state };

init();
