// 画面の操作。ホーム → 準備 → バトル の画面を切り替えて遊ぶ。
import { createMelee, step, DT, mulberry32 } from './engine.js';
import { WEAPONS, WEAPON_BY_ID } from './weapons.js';
import { Renderer, drawIcon } from './render.js';
import { Sound } from './sound.js';
import { createTournament, nextMatch, reportWinner, pickEntries, roundName } from './tournament.js';
import { enemyBoost, offerCards, takeAwaken, isBoss } from './challenge.js';
import { RARITY, SKILLS, SKILL_BY_ID, cpuPick, awakenSuffix, fusionsReady, fusionsNear, addSkills } from './skills.js';
import { createRounds, fighters, reportRound, pickSkills } from './rounds.js';
import { GENRES, genreOf } from './genres.js';
import { Net } from './net.js';
import { fmtNum, parseNum } from './format.js';
import { createRaid, raidMatch, reportRaid, pickRaidCards, bossOf, combosOf, DIFFICULTY } from './raid.js';

const $ = (id) => document.getElementById(id);
const SPEEDS = [0.25, 0.5, 1, 2, 4];
const speedText = (v) => '×' + ({ 0.25: '¼', 0.5: '½' }[v] || v);
const RECORD_KEY = 'weapon-battle-records';
const BEST_KEY = 'weapon-battle-challenge-best';
const RAID_BEST_KEY = 'weapon-battle-raid-best';
const SERVER_KEY = 'weapon-battle-server';
const NAME_KEY = 'weapon-battle-name';
const AUTO_KEY = 'weapon-battle-auto';
// オンラインで1試合に出られる人数(それより多い人は見るだけ)
const ONLINE_MAX_FIGHTERS = 6;
const net = new Net();
const PLAYER_COLORS = ['#e8484d', '#2f7de1', '#2fa84f', '#e0a600'];

// 遊び方ごとの設定。counts: 選べる人数 / fixed: 人数が決まっている
const MODES = {
  battle: { title: '⚔️ バトル', counts: [2, 3, 4], go: 'バトル開始！', hint: '2人なら1対1、3〜4人ならバトルロイヤル(全員が同時に戦い、最後に残った1人の勝ち)。' },
  rounds: {
    title: '🃏 ラウンズ',
    counts: [2, 3, 4],
    go: 'ラウンズ開始！',
    hint: '全員同時に戦い、勝った人に★。負けた人はみんなスキルカードを選んで強くなる(3回目ごとは大進化で2枚)。',
  },
  chal: { title: '🗡️ チャレンジ', counts: [1, 2, 3, 4], go: '挑戦する！', hint: 'だんだん強くなる敵と連戦。勝つたびにスキルカード、5ステージごとにボス(倒すと武器進化と大進化)。2人以上は同じ数の敵とチーム戦。負けたら終わり。' },
  raid: {
    title: '🐉 ボス・レイド',
    counts: [2, 3, 4],
    go: 'レイド開始！',
    hint: 'みんなで協力して巨大なボスと戦います(仲間には攻撃が当たらない)。ボスはHPが減ると技が増え、最後は怒る。勝つと全員がカードを1枚選び、次のもっと強いボスへ。',
  },
  tour: { title: '🏆 トーナメント', go: 'トーナメント開始！', hint: 'ランダムに選ばれた武器で勝ち抜き戦をします。試合は自動で次々に進みます。' },
};

// 武器の分類(選ぶ画面のタブ)
const KIND_TABS = [
  ['all', 'すべて'],
  ['near', '近接'],
  ['far', '飛び道具'],
  ['other', '特殊'],
  ['late', '📈大器晩成'],
  ['bloom', '🌱進化'],
  ...Object.entries(GENRES).map(([id, g]) => ['g:' + id, g.icon + g.name]),
];
const kindTab = (def) => (def.kind === 'ranged' ? 'far' : def.kind === 'body' || def.kind === 'copy' ? 'other' : 'near');
// タブに入るか(大器晩成は近接・飛び道具などと重なってよい)
const inTab = (def, tab) =>
  tab === 'all' || (tab === 'bloom' ? def.bloom : tab === 'late' ? def.late : tab.startsWith('g:') ? def.genre === tab.slice(2) : kindTab(def) === tab);

// ジャンルの札(アイコン+名前。色はジャンルの色)と、育ち方の印(📈大器晩成 / 🌱進化)
function genreTag(def, short = false) {
  const g = genreOf(def);
  const t = el('span', { className: 'gtag', textContent: short ? g.icon : `${g.icon}${g.name}` });
  t.style.background = g.color;
  t.title = g.name;
  const box = el('span', { className: 'gtags' }, t);
  if (def.late) box.append(el('span', { className: 'gtag late', textContent: short ? '📈' : '📈大器晩成', title: '大器晩成: 数値どおりに伸びて後半に化ける' }));
  if (def.bloom) box.append(el('span', { className: 'gtag bloom', textContent: short ? '🌱' : '🌱進化', title: '進化: 当てた回数で姿が変わる' }));
  return box;
}

const params = new URLSearchParams(location.search);
const renderer = new Renderer($('arena'));
const sound = new Sound();

const state = {
  screen: 'home',
  mode: 'battle',
  slots: [], // 準備画面の各プレイヤー { weapon, cpu }
  count: { battle: 2, rounds: 2, chal: 1, raid: 2 },
  sess: null, // 今の進め方(種つきの乱数・オンラインのカード選び)
  autoPick: false, // 🤖 オート: カードを自動でランダムに選んでどんどん進む
  difficulty: 'normal',
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
  raid: null,
  teams: null, // チーム戦(ボス・レイド)のチーム番号
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

function loadRaidBest() {
  try {
    return Number(localStorage.getItem(RAID_BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveRaidBest(n) {
  try {
    localStorage.setItem(RAID_BEST_KEY, String(n));
  } catch {
    // 保存できなくても遊べる
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

// 白っぽい色は、HPバーや名前に使うと背景にとけて見づらいので少し暗くする
function readable(hex) {
  const n = parseInt(hex.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  if (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] < 185) return hex;
  return '#' + rgb.map((c) => Math.round(c * 0.62).toString(16).padStart(2, '0')).join('');
}

// 武器進化した武器の名前(剣 → 剣・改 → 剣・真 …)
function weaponName(i) {
  const ball = state.world && state.world.balls[i];
  return state.fighters[i].name + awakenSuffix((ball && ball.awaken) || 0);
}

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2500);
}

// ---- 画面の切り替え(スマホの「戻る」でも戻れるように履歴を使う) ----

// バトル画面にいる間は、スマホの画面が自動で暗くなって消えないようにする(Screen Wake Lock)
// 対応していないブラウザでは何もしない。アプリを裏に回すとブラウザが外すので、戻ってきたらまたかける
let wakeLock = null;
async function keepAwake(on) {
  state.awake = on;
  try {
    if (on && !wakeLock && navigator.wakeLock && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    } else if (!on && wakeLock) {
      const w = wakeLock;
      wakeLock = null;
      await w.release();
    }
  } catch {
    wakeLock = null; // 電池の節約モードなどで断られたときは、あきらめる
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.awake) keepAwake(true);
});

function show(screen, push = true) {
  if (state.screen === 'battle' && screen !== 'battle') {
    // オンラインの途中で抜けたら知らせる(このあとのカードはホームが代わりに選ぶ)
    if (isOnline()) net.post({ kind: 'quit' });
    leaveBattle();
  }
  if (push && state.screen !== screen) history.pushState({ screen }, '');
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== screen;
  state.screen = screen;
  keepAwake(screen === 'battle');
  if (screen === 'home') renderHome();
  if (screen === 'book') renderBook();
  if (screen === 'online') renderOnline();
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
  state.raid = null;
  state.teams = null;
  state.auto = false;
  state.world = null;
  state.sess = null;
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
}

// ---- ホーム ----

function renderHome() {
  const best = loadBest();
  $('bestText').textContent = best ? `(最高 ${best}勝)` : '';
  const rb = loadRaidBest();
  $('raidBestText').textContent = rb ? `(最高 Lv${rb})` : '';
  $('bookCount').textContent = `全${WEAPONS.length}種`;
}

function openMode(mode) {
  sound.unlock();
  if (mode === 'online') {
    state.mode = 'online';
    show('online');
    renderOnline();
    return;
  }
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
  $('diffRow').hidden = mode !== 'raid';
  for (const b of $('diffSeg').children) b.classList.toggle('on', b.dataset.diff === state.difficulty);
  for (const b of $('targetSeg').children) b.classList.toggle('on', Number(b.dataset.target) === state.target);
  $('sizeRow').hidden = mode !== 'tour';
  for (const b of $('sizeSeg').children) b.classList.toggle('on', Number(b.dataset.size) === state.tourSize);
  const n = mode === 'tour' ? 0 : slotCount();
  $('setupTools').hidden = mode === 'tour' || n < 2;
  $('swapBtn').hidden = mode !== 'battle' || n !== 2;
  const box = $('slots');
  box.replaceChildren();
  state.slots.slice(0, n).forEach((s, i) => {
    const slot = el('div', { className: 'slot' });
    const solo = mode === 'chal' && n === 1;
    slot.style.setProperty('--c', solo ? '#8b3fe0' : PLAYER_COLORS[i]);
    const tag = el('span', { className: 'ptag', textContent: solo ? 'YOU' : `P${i + 1}` });
    const pickBtn = el(
      'button',
      { type: 'button', className: 'slot-pick' },
      iconCanvas(s.weapon, 112),
      el('span', { className: 'slot-text' }, el('b', { textContent: s.weapon.name }), genreTag(s.weapon), el('small', { textContent: s.weapon.grow })),
    );
    pickBtn.style.setProperty('--w', s.weapon.color);
    pickBtn.setAttribute('aria-label', `P${i + 1}の武器(${s.weapon.name})を変える`);
    pickBtn.addEventListener('click', () =>
      openPicker(
        solo ? '挑戦する武器をえらぶ' : `P${i + 1} の武器をえらぶ`,
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
    if (mode === 'rounds' || mode === 'raid' || (mode === 'chal' && i > 0)) {
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
  // ボス・レイド: このチームで付くコンビ技
  if (mode === 'raid') {
    const combos = combosOf(state.slots.slice(0, n).map((s) => s.weapon));
    box.append(
      el('div', {
        className: 'combo-box',
        innerHTML: combos.length
          ? '<b>コンビ技</b>' + combos.map((c) => `<span>${c.icon} ${c.name}<small>${c.desc}</small></span>`).join('')
          : '<b>コンビ技</b><small>なし(武器の組み合わせで付く: 近接と飛び道具・炎の仲間・同じ武器 など)</small>',
      }),
    );
  }
}

function begin() {
  sound.unlock();
  const mode = state.mode;
  const seed = (Math.random() * 2 ** 32) >>> 0;
  if (mode === 'tour') {
    leaveBattle();
    show('battle');
    updateAutoBtn();
    state.tour = createTournament(pickEntries(WEAPONS, state.tourSize));
    playTourMatch();
    return;
  }
  const players = state.slots.slice(0, slotCount()).map((s, i) => ({ name: `P${i + 1}`, weapon: s.weapon, cpu: i > 0 && s.cpu, color: PLAYER_COLORS[i] }));
  // ラウンズ・レイドは1人目も CPU にできる
  if (mode === 'rounds' || mode === 'raid') players[0].cpu = state.slots[0].cpu;
  startMode(mode, players, { target: state.target, difficulty: state.difficulty }, seed);
}

// ---- 試合 ----

function setMatch(defs, boosts = [], labels = null, teams = null) {
  state.fighters = defs;
  state.boosts = boosts;
  state.labels = labels;
  state.teams = teams;
  newBattle();
}

function newBattle() {
  // オンラインでは全員が同じ種(state.seed)を使うので、どのスマホでも同じ試合になる
  const seed = state.seed ?? (srng()() * 2 ** 32) >>> 0;
  state.seed = null;
  state.world = createMelee(state.fighters, seed, { boosts: state.boosts, teams: state.teams || undefined });
  state.running = false;
  if (isOnline()) {
    const sess = state.sess;
    sess.battle++;
    sess.frame = 0;
    sess.battleAt = performance.now();
  }
  $('syncText').textContent = '';
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
  $('shareBtn').hidden = !(['battle', 'auto'].includes(state.mode) && !isOnline());
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
  // オンラインは全員で同じペースで見るので、止められない。速さはホームが決める
  btn.disabled = !w || w.over || isOnline();
  $('speedBtn').disabled = isOnline() && !net.isHost;
  $('speedBtn').textContent = speedText(state.speed);
  btn.textContent = !w || w.over ? '決着' : isOnline() ? '📡 オンライン' : state.running ? '⏸ 一時停止' : w.t > 0 ? '▶ 再開' : '▶ スタート';
}

function nameOf(i) {
  const def = state.fighters[i];
  const tag = state.labels && state.labels[i];
  return tag && /^P\d/.test(tag.text) ? `${tag.text} ${weaponName(i)}` : weaponName(i);
}

function renderTitle() {
  const t = $('battleTitle');
  const f = state.fighters;
  let html;
  if (state.rounds) {
    const r = state.rounds;
    html = `ラウンド ${r.round} <small>${r.target}勝で優勝</small>`;
  } else if (state.raid) {
    html = `レイド Lv${state.raid.level} <b class="boss">${bossOf(state.raid).def.name}</b>`;
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
    card.addEventListener('click', () => openBallInfo(i));
    card.style.setProperty('--c', readable(def.color));
    if (ball.awaken) card.classList.add('awakened');
    if (def.kind === 'boss') card.classList.add('boss-card');
    const top = el('div', { className: 'hud-top' });
    if (tag) {
      const t = el('span', { className: 'ptag', textContent: tag.text });
      t.style.background = tag.color;
      top.append(t);
    }
    top.append(iconCanvas(def, 56), el('span', { className: 'hud-name', textContent: weaponName(i) }));
    if (def.kind !== 'boss') top.append(genreTag(def, true));
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
    const rows = statRows(ball, w);
    const stats = rows.map(([k, v, up]) => `<span>${k} <b>${v}</b>${up ? `<i>${up}</i>` : ''}</span>`).join('');
    const chips = ball.skills.filter((sk) => !sk.def.hidden).map((sk) => `<span title="${sk.def.name}" style="border-color:${RARITY[sk.def.rarity].color}">${sk.def.icon}</span>`).join('');
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
  if ($('ballDialog').open && performance.now() - (state.infoAt || 0) > 300) {
    state.infoAt = performance.now();
    renderBallInfo();
  }
}

// 能力値の行: [名前, 今の値, 試合が始まってから伸びた分]。上限を超えた分は「威力」
function statRows(ball, w) {
  const rows = ball.def.stats(ball, w).map(([k, v]) => [k, String(v)]);
  if (ball.power > 1.005 || (ball.startStats && ball.startStats['威力'] != null)) rows.push(['威力', '×' + (ball.power < 100 ? ball.power.toFixed(2) : fmtNum(ball.power))]);
  // 最初の値を覚えておき、伸びた分を ▲ で出す
  if (!ball.startStats) {
    ball.startStats = {};
    for (const [k, v] of rows) ball.startStats[k] = parseNum(v);
    if (ball.startStats['威力'] == null) ball.startStats['威力'] = 1;
  }
  return rows.map(([k, v]) => {
    const a = ball.startStats[k];
    const b = parseNum(v);
    if (a == null || b == null || Math.abs(b - a) < 1e-9) return [k, v, ''];
    const d = b - a;
    const text = Math.abs(d) >= 100 || Number.isInteger(d) ? fmtNum(Math.round(d)) : Math.abs(d) < 10 ? d.toFixed(2).replace(/0$/, '') : d.toFixed(1);
    return [k, v, (d > 0 ? '▲' : '▼') + text.replace('-', '')];
  });
}

// HUDのカードをタップ: そのボールの能力値・成長・カードをくわしく
function openBallInfo(i) {
  state.infoBall = i;
  renderBallInfo();
  const dlg = $('ballDialog');
  if (!dlg.open) dlg.showModal();
}

function renderBallInfo() {
  const w = state.world;
  const i = state.infoBall;
  const ball = w && w.balls[i];
  const dlg = $('ballDialog');
  if (!ball) {
    if (dlg.open) dlg.close();
    return;
  }
  const def = ball.def;
  const tag = state.labels && state.labels[i];
  const skills = ball.skills.filter((sk) => !sk.def.hidden);
  // 同じカードはまとめる。育つカードは今の状態(show)も出す
  const counts = new Map();
  for (const sk of skills) {
    const c = counts.get(sk.def) || { n: 0, st: sk.st };
    c.n++;
    counts.set(sk.def, c);
  }
  $('ballInfo').innerHTML =
    `<h3 style="color:${readable(def.color)}">${tag ? `<span class="ptag" style="background:${tag.color}">${tag.text}</span> ` : ''}${weaponName(i)}</h3>` +
    `<p class="bi-grow">${def.grow || ''}</p>` +
    `<table class="bi-stats"><tr><th></th><th>はじめ</th><th>いま</th><th>のび</th></tr>` +
    `<tr><td>HP</td><td>${fmtNum(ball.maxHp)}</td><td>${ball.dead ? 'OUT' : fmtNum(Math.ceil(ball.hp))}</td><td></td></tr>` +
    statRows(ball, w)
      .map(([k, v, up]) => `<tr><td>${k}</td><td>${ball.startStats[k] == null ? '' : fmtNum(ball.startStats[k])}</td><td><b>${v}</b></td><td class="up">${up}</td></tr>`)
      .join('') +
    `<tr><td>当てた回数</td><td></td><td><b>${fmtNum(ball.hits)}</b></td><td></td></tr>` +
    `<tr><td>与えたダメージ</td><td></td><td><b>${fmtNum(Math.round(w.dealt[i] || 0))}</b></td><td></td></tr>` +
    `</table>` +
    (skills.length
      ? `<h4>カード(${skills.length}枚)</h4><ul class="bi-cards">` +
        [...counts]
          .map(
            ([d, { n, st }]) =>
              `<li><span style="border-color:${RARITY[d.rarity] ? RARITY[d.rarity].color : '#999'}">${d.icon}</span><b>${d.name}${n > 1 ? ` ×${n}` : ''}${d.show ? ` <em>${d.show(st, ball)}</em>` : ''}</b><small>${d.desc || ''}</small></li>`,
          )
          .join('') +
        '</ul>'
      : '<p class="bi-none">カードなし</p>');
}

// 🤖 オートのボタン(カード選びのあるモードだけ)
function updateAutoBtn() {
  const b = $('autoBtn');
  b.hidden = !['rounds', 'chal', 'raid'].includes(state.mode);
  b.textContent = state.autoPick ? '🤖 オート ON' : '🤖 オート';
  b.classList.toggle('on', state.autoPick);
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
  renderSync();
  if (w.winner === -1) {
    text.textContent = '引き分け！';
    text.style.color = '#ffffff';
    // モード中は同じ組み合わせでやり直し
    if (state.tour) setTimeout(() => state.world === w && playTourMatch(), 1500);
    else if (state.chal) setTimeout(() => state.world === w && playChalStage(), 1500);
    else if (state.raid) setTimeout(() => state.world === w && playRaid(), 1500);
    else if (state.rounds) {
      reportRound(state.rounds, -1);
      setTimeout(() => state.world === w && playRound(), 1500);
    } else if (state.auto) setTimeout(() => state.world === w && playAuto(), 1800);
    else setButtons(endButtons(matchButtons()));
  } else {
    const win = state.fighters[w.winner];
    text.textContent = `${nameOf(w.winner)}の勝ち！`;
    if (state.raid) {
      raidResult(w);
      setTimeout(() => {
        if (state.world === w) $('overlay').hidden = false;
      }, 700);
      return;
    }
    text.style.color = (state.labels && state.labels[w.winner] && state.rounds ? state.labels[w.winner].color : null) || win.color;
    record(w.winner);
    if (state.rounds) roundResult(w);
    else if (state.chal) chalResult(state.chal.players.length > 1 ? w.winTeam === 0 : w.winner === 0);
    else if (state.tour) tourResult(win, w);
    else if (state.auto) setTimeout(() => state.world === w && state.auto && playAuto(), 2200);
    else setButtons(endButtons(matchButtons()));
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

// ---- 進め方(ローカルとオンラインで共通) ----
// モードの流れで使う乱数(カードの候補・敵・試合の種)はすべて state.sess.rng(種つき)から引く。
// オンラインでは全員に同じ種が配られ、カード選びは選んだ人のスマホから全員へ送るので、
// 全員のスマホで同じ流れ・同じ結果になる(試合の計算も種で決まる)。

function newSession(seed, online = false) {
  state.sess = {
    seed, rng: mulberry32(seed), online, step: 0, inbox: new Map(), gone: new Set(), run: null,
    // オンライン: 何試合目か・その試合の何コマ目か・ホームの時計・答え合わせ
    battle: 0, frame: 0, battleAt: 0, clock: null, sums: new Map(), remote: new Map(), ends: new Map(), bad: new Set(),
  };
  return state.sess;
}

// ---- オンライン: 全員が同じものを、同じ時間に見るためのしくみ ----
// 1) 試合の計算はどのブラウザでも同じ答えになる(detmath.js)。同じ種・同じカードなら、全員まったく同じ試合になる
// 2) 答え合わせ: SUM_EVERY コマごとに試合の要約(checksum)を全員へ送ってくらべる。終わったら最後の要約もくらべて「全員同じ結果」を出す
// 3) 時計: ホームが「今何コマ目か」を配り、ほかの人はそれより少し先までしか進まない(遅れていたら追いつく)
const SUM_EVERY = 240; // 2秒(試合の時間)ごと
const CLOCK_MS = 200;

function checksum(w) {
  let h = 2166136261;
  const s = w.t.toFixed(6) + '|' + w.balls.map((b) => `${b.hp.toFixed(6)},${b.x.toFixed(4)},${b.y.toFixed(4)},${b.dead ? 1 : 0}`).join(';') + '|' + w.projectiles.length;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

// 1コマ進めたあと(オンラインのときだけ)
function onlineStepped(w) {
  const sess = state.sess;
  sess.frame++;
  if (sess.frame % SUM_EVERY === 0 || w.over) {
    const h = checksum(w);
    const key = `${sess.battle}:${w.over ? 'end' : sess.frame}`;
    sess.sums.set(key, h);
    net.post({ kind: w.over ? 'end' : 'sum', s: sess.seed, b: sess.battle, f: sess.frame, h });
    compareSums(key);
  }
}

function compareSums(key) {
  const sess = state.sess;
  const mine = sess.sums.get(key);
  const theirs = sess.remote.get(key);
  if (mine === undefined || !theirs) return;
  for (const [from, h] of theirs) {
    if (h === mine) continue;
    if (!sess.bad.has(from)) {
      sess.bad.add(from);
      toast(`⚠ ${memberName(from)} の試合がずれています(版がちがう・古いページのままの可能性)`);
    }
  }
  if (key.endsWith(':end')) renderSync();
}

function memberName(id) {
  const m = net.room && net.room.members.find((x) => x.id === id);
  return m ? m.name : 'だれか';
}

// 試合の終わり: 全員の結果が同じか
function renderSync() {
  const el = $('syncText');
  const sess = state.sess;
  if (!isOnline() || !sess) {
    el.textContent = '';
    return;
  }
  const key = `${sess.battle}:end`;
  const mine = sess.sums.get(key);
  const theirs = sess.remote.get(key) || new Map();
  if (mine === undefined) {
    el.textContent = '';
    return;
  }
  const others = [...theirs];
  const bad = others.filter(([, h]) => h !== mine).map(([id]) => memberName(id));
  const total = (net.room ? net.room.members.length : 1);
  el.classList.toggle('bad', bad.length > 0);
  el.textContent = bad.length
    ? `⚠ 結果がちがう人: ${bad.join('・')}(ページを再読み込みしてもらってください)`
    : others.length + 1 >= total
      ? `✓ 全員(${total}人)同じ結果`
      : `✓ ${others.length + 1}人 同じ結果(ほかの人を確認中…)`;
}

// ほかの人が進んでよいのは、ホームの時計 + 少しまで
function onlineLimit() {
  const sess = state.sess;
  if (!isOnline() || net.isHost) return null;
  const lead = Math.round((0.3 * state.speed) / DT);
  const c = sess.clock;
  const now = performance.now();
  if (c && c.b === sess.battle) return now - c.at < 2500 ? c.f + lead : null; // ホームから届かなくなったら止めない
  return now - sess.battleAt < 2500 ? lead : null;
}

setInterval(() => {
  const sess = state.sess;
  if (isOnline() && net.isHost && state.world && sess) net.post({ kind: 'clock', s: sess.seed, b: sess.battle, f: sess.frame });
}, CLOCK_MS);

const srng = () => (state.sess ? state.sess.rng : Math.random);
const isOnline = () => !!(state.sess && state.sess.online);

// players: [{ name, weapon, cpu, color, owner(オンラインの部屋のメンバーID) }]
function startMode(mode, players, opts, seed, online = false) {
  leaveBattle();
  state.mode = mode;
  newSession(seed, online);
  show('battle');
  updateAutoBtn();
  if (mode === 'battle') {
    setMatch(
      players.map((p) => p.weapon),
      [],
      players.length > 2 || online ? players.map((p) => ({ text: p.name, color: p.color })) : null,
    );
    play();
  } else if (mode === 'rounds') {
    state.rounds = createRounds(players, opts.target);
    playRound();
  } else if (mode === 'chal') {
    state.chal = { stage: 1, players: players.map((p, i) => ({ ...p, idx: i, skills: [], picked: [] })) };
    playChalStage();
  } else if (mode === 'raid') {
    state.raid = createRaid(players, opts.difficulty);
    playRaid();
  }
}

// だれがカードを選ぶか: cpu / me(このスマホ) / remote(ほかのスマホ) / gone(抜けた人。ホームが代わりに選ぶ)
function decider(p) {
  if (p.cpu) return 'cpu';
  if (!isOnline() || p.owner === net.you) return 'me';
  if (state.sess.gone.has(p.owner)) return 'gone';
  return 'remote';
}

// カード選びをまとめて進める。items: [{ p, cards, choose, show, apply(cards) }]
// 選んだ結果は items の順番どおりに apply する(どのスマホでも同じ順番)。全部そろったら done()
function runPicks(items, done) {
  const sess = state.sess;
  const run = { step: ++sess.step, items, results: new Map(), next: 0, done, asking: false };
  sess.run = run;
  // オンラインのCPUや抜けた人のカードは、どのスマホでも同じ決め方(cpuPick)
  if (isOnline()) items.forEach((it, k) => decider(it.p) === 'cpu' && run.results.set(k, cpuPick(it.cards, it.choose)));
  // 先に届いていたほかの人の選択
  for (const [key, ids] of sess.inbox) {
    const [s, k] = key.split(':').map(Number);
    if (s === run.step) acceptPick(run, k, ids);
  }
  coverGone();
  askMine(run);
  flushPicks(run);
}

function acceptPick(run, k, ids) {
  const it = run.items[k];
  if (!it || run.results.has(k) || !Array.isArray(ids)) return;
  const cards = ids.map((id) => it.cards.find((c) => c.id === id)).filter(Boolean);
  if (cards.length === it.choose) run.results.set(k, cards);
}

function flushPicks(run) {
  const sess = state.sess;
  if (!sess || sess.run !== run) return;
  while (run.next < run.items.length && run.results.has(run.next)) {
    run.items[run.next].apply(run.results.get(run.next));
    run.next++;
  }
  renderSideInfo();
  if (run.next >= run.items.length) {
    sess.run = null;
    for (const key of [...sess.inbox.keys()]) if (Number(key.split(':')[0]) <= run.step) sess.inbox.delete(key);
    run.done();
    return;
  }
  // ほかの人を待っている
  const wait = [...new Set(run.items.filter((it, k) => !run.results.has(k) && decider(it.p) !== 'me').map((it) => it.p.name))];
  if (wait.length && !run.asking) toast(`${wait.join('・')} のカード選びを待っています…`);
}

// このスマホで選ぶカードを1つずつ出す(ローカルではCPUの選択も見せる)
function askMine(run) {
  if (run.asking || !state.sess || state.sess.run !== run) return;
  const k = run.items.findIndex((it, k) => !run.results.has(k) && (decider(it.p) === 'me' || (!isOnline() && decider(it.p) === 'cpu')));
  if (k < 0) return;
  const it = run.items[k];
  run.asking = true;
  showCards({
    ...it.show,
    cards: it.cards,
    choose: it.choose,
    cpu: decider(it.p) === 'cpu',
    onDone(cards) {
      run.asking = false;
      if (!state.sess || state.sess.run !== run) return;
      run.results.set(k, cards);
      if (isOnline()) net.post({ kind: 'card', step: run.step, k, ids: cards.map((c) => c.id) });
      askMine(run);
      flushPicks(run);
    },
  });
}

// 抜けた人のカードは、ホームが代わりに選んで全員へ送る
function coverGone() {
  const run = state.sess && state.sess.run;
  if (!run || !isOnline() || !net.isHost) return;
  run.items.forEach((it, k) => {
    if (run.results.has(k) || decider(it.p) !== 'gone') return;
    const cards = cpuPick(it.cards, it.choose);
    run.results.set(k, cards);
    net.post({ kind: 'card', step: run.step, k, ids: cards.map((c) => c.id) });
  });
  flushPicks(run);
}

// 終わったときのボタン(オンラインは部屋へ)
function endButtons(local) {
  return isOnline() ? onlineButtons() : local;
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
  reportRound(r, w.winner, srng(), w.outOrder);
  renderSideInfo();
  renderHud();
  if (r.champion) {
    $('resultText').textContent = `🏆 ${winner.name} 優勝！`;
    $('resultSub').textContent = `${winner.weapon.name}・${winner.wins}勝`;
    setButtons(
      endButtons([
        { text: 'もう一度(同じ設定)', primary: true, onClick: begin },
        { text: 'ホームへ', onClick: () => show('home') },
      ]),
    );
    return;
  }
  const items = [r.pending, ...r.waiting].map((pend) => {
    const p = r.players[pend.player];
    return {
      p,
      cards: pend.cards,
      choose: pend.choose,
      show: { who: `${p.name}${p.cpu ? '(CPU)' : ''} のカード選び`, color: p.color, sub: pend.big ? '🌟 大進化！ 4枚から2枚選べる' : `${p.weapon.name} を強くするカードを1枚`, mine: p.skills, weapon: p.weapon },
      apply: (cards) => pickSkills(r, cards),
    };
  });
  setTimeout(() => state.rounds === r && runPicks(items, playRound), 1100);
}

// ---- チャレンジ(1〜4人。2人以上は同じ数の敵とチーム戦) ----

function playChalStage() {
  const ch = state.chal;
  if (!ch) return;
  const rng = srng();
  const n = ch.players.length;
  ch.enemy = enemyBoost(ch.stage, rng);
  const mine = ch.players.map((p) => p.weapon);
  const pool = WEAPONS.filter((w) => !mine.includes(w));
  const enemies = Array.from({ length: n }, () => pool[Math.floor(rng() * pool.length)]);
  const solo = n === 1 && !isOnline();
  const foeTag = ch.enemy.boss ? { text: 'BOSS', color: '#c01f1f' } : n > 1 ? { text: '敵', color: '#555555' } : null;
  setMatch(
    [...mine, ...enemies],
    [...ch.players.map((p) => ({ skills: p.skills })), ...enemies.map(() => ch.enemy)],
    [...ch.players.map((p) => (solo ? { text: 'YOU', color: '#8b3fe0' } : { text: p.name, color: p.color })), ...enemies.map(() => foeTag)],
    n > 1 ? [...mine.map(() => 0), ...enemies.map(() => 1)] : null,
  );
  play();
}

function chalResult(won) {
  const ch = state.chal;
  const text = $('resultText');
  const names = ch.players.map((p) => p.weapon.name).join('・');
  if (!won) {
    const cleared = ch.stage - 1;
    const best = Math.max(loadBest(), cleared);
    saveBest(best);
    text.textContent = `ステージ${ch.stage}で敗退…`;
    $('resultSub').textContent = `${names}  ${cleared}勝 / 最高記録 ${best}勝`;
    state.chal = null;
    setButtons(
      endButtons([
        { text: 'もう一度挑戦', primary: true, onClick: begin },
        { text: 'ホームへ', onClick: () => show('home') },
      ]),
    );
    return;
  }
  text.textContent = ch.enemy.boss ? 'ボス撃破！' : `ステージ${ch.stage} クリア！`;
  // 全員の候補を先に決める(どのスマホでも同じ順番で乱数を引く)
  const rng = srng();
  const items = [];
  for (const p of ch.players) {
    const offer = offerCards({ skills: p.skills, stage: ch.stage }, rng);
    const tag = ch.players.length > 1 ? `${p.name} ` : '';
    if (offer.awaken) {
      // ボスのあと: まず武器進化、そのあと大進化
      const tier = p.skills.filter((c) => c.rarity === 'awaken').length;
      items.push({
        p,
        cards: offer.awaken,
        choose: 1,
        show: { who: `⚔️ ${tag}武器進化！`, color: '#ff7a1a', sub: `${p.weapon.name}${awakenSuffix(tier)} → ${p.weapon.name}${awakenSuffix(tier + 1)}  進化先を1つ選ぶ`, mine: p.skills, weapon: p.weapon },
        apply: ([card]) => takeAwaken(p, card),
      });
    }
    items.push({
      p,
      cards: offer.cards,
      choose: offer.choose,
      show: { who: `${tag}スキルカードを選ぶ`, color: ch.players.length > 1 ? p.color : '#8b3fe0', sub: offer.big ? '🌟 大進化！ 4枚から2枚選べる' : `${p.weapon.name} を強くするカードを1枚`, mine: p.skills, weapon: p.weapon },
      apply: (cards) => {
        addSkills(p.skills, cards);
        p.picked.push(...cards.map((c) => c.id));
      },
    });
  }
  setTimeout(
    () =>
      state.chal === ch &&
      runPicks(items, () => {
        ch.stage++;
        playChalStage();
      }),
    1100,
  );
}

// ---- ボス・レイド ----

function playRaid() {
  const r = state.raid;
  if (!r) return;
  const m = raidMatch(r);
  setMatch(
    m.defs,
    m.boosts,
    [...r.players.map((p) => ({ text: p.name, color: p.color })), ...m.defs.slice(r.players.length).map(() => ({ text: 'BOSS', color: '#c01f1f' }))],
    m.teams,
  );
  // ボス登場の演出(少ししてから始まる)
  const boss = bossOf(r).def;
  const w = state.world;
  $('resultText').textContent = `${boss.name} 出現！`;
  $('resultText').style.color = boss.color;
  $('resultSub').textContent = `Lv${r.level}  ${boss.grow}`;
  setButtons([]);
  $('overlay').hidden = false;
  $('overlay').classList.add('intro');
  setTimeout(() => {
    if (state.world !== w) return;
    $('overlay').hidden = true;
    $('overlay').classList.remove('intro');
    play();
  }, 1800);
}

// 与えたダメージのランキング(ボス・レイドのMVP)
function raidRanking(w, r) {
  const list = r.players.map((p, i) => ({ p, dmg: Math.round(w.dealt[i] || 0) })).sort((a, b) => b.dmg - a.dmg);
  r.lastRanking = list;
  return list.map(({ p, dmg }, k) => `${k === 0 ? '👑' : ''}${p.name} ${p.weapon.name} ${fmtNum(dmg)}`).join(' / ');
}

function raidResult(w) {
  const r = state.raid;
  const boss = bossOf(r).def;
  const won = w.winTeam === 0;
  const text = $('resultText');
  if (!won) {
    const cleared = r.level - 1;
    const best = Math.max(loadRaidBest(), cleared);
    saveRaidBest(best);
    text.textContent = `Lv${r.level} ${boss.name}に敗北…`;
    text.style.color = boss.color;
    $('resultSub').textContent = `${cleared}体たおした / 最高記録 Lv${best}\n与ダメージ: ${raidRanking(w, r)}`;
    reportRaid(r, false);
    setButtons(
      endButtons([
        { text: 'もう一度(同じ設定)', primary: true, onClick: begin },
        { text: 'ホームへ', onClick: () => show('home') },
      ]),
    );
    return;
  }
  text.textContent = `${boss.name}を倒した！`;
  text.style.color = '#2fa84f';
  saveRaidBest(Math.max(loadRaidBest(), r.level));
  const ranking = raidRanking(w, r);
  reportRaid(r, true, srng());
  $('resultSub').textContent = `MVP: ${ranking}\n次は Lv${r.level} ${bossOf(r).def.name}${r.pending && r.pending.chest ? '  🎁 宝箱！' : ''}`;
  renderSideInfo();
  // 勝ったら全員がカードを選ぶ
  const items = [r.pending, ...r.waiting].map((pend) => {
    const p = r.players[pend.player];
    return {
      p,
      cards: pend.cards,
      choose: pend.choose,
      show: { who: `${p.name}${p.cpu ? '(CPU)' : ''} のカード選び`, color: p.color, sub: pend.chest ? '🎁 宝箱！ 良いカードが出やすい4枚から2枚選べる' : `${p.weapon.name} を強くするカードを1枚`, mine: p.skills, weapon: p.weapon },
      apply: (cards) => pickRaidCards(r, cards),
    };
  });
  setTimeout(() => state.raid === r && runPicks(items, playRaid), 2200);
}

// ---- オンライン(📡 部屋に集まってから、ホームがモードを選ぶ) ----

// オンラインで遊べるモードと人数(多い人は見るだけ)
const ONLINE_MODES = {
  battle: { name: '⚔️ バトル', min: 2, max: 6 },
  rounds: { name: '🃏 ラウンズ', min: 2, max: 4 },
  chal: { name: '🗡️ チャレンジ', min: 1, max: 4 },
  raid: { name: '🐉 ボス・レイド', min: 1, max: 4 },
};
const online = { picks: {}, status: '', mode: null, target: 5, difficulty: 'normal' };

function onlineStatus(text) {
  online.status = text;
  $('onlineStatus').textContent = text;
}

function loadSetting(key, def = '') {
  try {
    return localStorage.getItem(key) || def;
  } catch {
    return def;
  }
}

function saveSetting(key, v) {
  try {
    localStorage.setItem(key, v);
  } catch {
    // 保存できなくても遊べる
  }
}

// つないで部屋を作る/入る
async function onlineGo(action) {
  const url = $('onlineServer').value.trim();
  const name = $('onlineName').value.trim() || 'ななし';
  saveSetting(NAME_KEY, name);
  if (!url) {
    $('serverBox').open = true;
    onlineStatus('サーバーが設定されていません(サーバーの設定 に wss:// から始まるアドレスを入れてください)');
    return;
  }
  saveSetting(SERVER_KEY, url);
  const code = $('onlineCode').value.trim().toUpperCase();
  if (action === 'join' && code.length !== 4) {
    onlineStatus('部屋コード(4文字)を入れてください');
    return;
  }
  onlineStatus('つないでいます…');
  try {
    if (!net.connected) await net.connect(url);
  } catch (e) {
    onlineStatus(`${e.message}。サーバーのアドレスと、サーバーが動いているかを確かめてください`);
    return;
  }
  online.picks = {};
  online.mode = null;
  if (action === 'create') net.create(name);
  else net.join(code, name);
}

net.on((m) => {
  if (m.t === 'error') onlineStatus(m.text);
  if (m.t === 'closed') {
    onlineStatus('サーバーとの接続が切れました');
    if (state.screen === 'online') renderOnline();
  }
  if (m.t === 'room') {
    onlineStatus('');
    // 入ったら自分の武器をみんなに知らせる(まだなければランダム)
    if (!online.picks[net.you]) {
      ensureSlots();
      online.myWeapon = online.myWeapon || state.slots[0].weapon;
      net.post({ kind: 'weapon', weapon: online.myWeapon.id });
    } else if (m.members.some((x) => !online.picks[x.id])) {
      // 新しく入った人に、自分の選んだ武器を知らせ直す
      net.post({ kind: 'weapon', weapon: online.picks[net.you] });
    }
    // ホームは選んだモードを知らせ直す
    if (net.isHost && online.mode) postMode();
    // 試合中に抜けた人のカードは、ホームが代わりに選ぶ
    if (isOnline()) {
      const ids = new Set(m.members.map((x) => x.id));
      for (const p of currentPlayers()) if (p.owner && !ids.has(p.owner)) state.sess.gone.add(p.owner);
      coverGone();
    }
    if (state.screen === 'online') renderOnline();
  }
  if (m.t === 'msg' && m.data) onlineMessage(m.from, m.data);
});

// 今のモードのプレイヤー
function currentPlayers() {
  const s = state.rounds || state.raid || state.chal;
  return s ? s.players : [];
}

function postMode() {
  net.post({ kind: 'mode', mode: online.mode, target: online.target, difficulty: online.difficulty });
}

function onlineMessage(from, d) {
  if (d.kind === 'weapon' && WEAPON_BY_ID[d.weapon]) {
    online.picks[from] = d.weapon;
    if (state.screen === 'online') renderOnline();
  }
  if (d.kind === 'mode' && net.room && from === net.room.host) {
    online.mode = ONLINE_MODES[d.mode] ? d.mode : null;
    online.target = [3, 5, 7].includes(d.target) ? d.target : 5;
    online.difficulty = DIFFICULTY[d.difficulty] ? d.difficulty : 'normal';
    if (state.screen === 'online') renderOnline();
  }
  if (d.kind === 'start' && ONLINE_MODES[d.mode] && Array.isArray(d.players)) {
    // ホームが決めたモード・順番・武器・種で、全員が同じ流れを始める
    const players = d.players
      .filter((o) => WEAPON_BY_ID[o.weapon])
      .map((o, i) => ({ name: o.name, weapon: WEAPON_BY_ID[o.weapon], cpu: false, color: PLAYER_COLORS[i % PLAYER_COLORS.length], owner: o.id }));
    if (players.length < ONLINE_MODES[d.mode].min) return;
    if (d.version && d.version !== $('version').textContent) {
      // 版がちがうと試合が同じにならないので、参加しない(ホームに知らせる)
      net.post({ kind: 'mismatch', v: $('version').textContent });
      onlineStatus(`ホームと版がちがうので参加できません(ホーム ${d.version} / このページ ${$('version').textContent})。ページを再読み込みしてください`);
      toast('版がちがうので参加できません。ページを再読み込みしてください');
      return;
    }
    for (const dlg of document.querySelectorAll('dialog[open]')) dlg.close();
    // 速さもホームに合わせる(全員で同じペースで見る)
    if (SPEEDS.includes(d.speed)) state.speed = d.speed;
    startMode(d.mode, players, { target: d.target, difficulty: d.difficulty }, d.seed >>> 0, true);
  }
  if (d.kind === 'card' && isOnline()) {
    const sess = state.sess;
    sess.inbox.set(`${d.step}:${d.k}`, d.ids);
    if (sess.run && sess.run.step === d.step) {
      acceptPick(sess.run, d.k, d.ids);
      flushPicks(sess.run);
    }
  }
  if ((d.kind === 'sum' || d.kind === 'end') && isOnline() && d.s === state.sess.seed && from !== net.you) {
    const key = `${d.b}:${d.kind === 'end' ? 'end' : d.f}`;
    const sess = state.sess;
    if (!sess.remote.has(key)) sess.remote.set(key, new Map());
    sess.remote.get(key).set(from, d.h);
    compareSums(key);
  }
  if (d.kind === 'clock' && isOnline() && d.s === state.sess.seed && net.room && from === net.room.host) {
    state.sess.clock = { b: d.b, f: d.f, at: performance.now() };
  }
  if (d.kind === 'mismatch' && net.isHost) {
    toast(`${memberName(from)} は版がちがうので参加できません(ページを再読み込みしてもらってください)`);
    if (isOnline()) {
      state.sess.gone.add(from);
      coverGone();
    }
  }
  if (d.kind === 'quit' && isOnline()) {
    state.sess.gone.add(from);
    coverGone();
  }
  if (d.kind === 'speed' && net.room && from === net.room.host && SPEEDS.includes(d.v) && isOnline()) {
    state.speed = d.v;
    updatePlay();
  }
}

function onlineButtons() {
  const list = [{ text: '部屋にもどる', primary: !net.isHost, onClick: () => show('online') }];
  if (net.isHost) list.unshift({ text: 'もう一度(同じ設定)', primary: true, onClick: onlineStart });
  return list;
}

// ホーム: 選んだモードで、全員の選んだ武器で始める
function onlineStart() {
  if (!net.isHost || !net.room) return;
  const m = ONLINE_MODES[online.mode];
  if (!m) {
    toast('先にモードを選んでください');
    return;
  }
  const players = net.room.members
    .filter((x) => online.picks[x.id])
    .slice(0, m.max)
    .map((x) => ({ id: x.id, name: x.name, weapon: online.picks[x.id] }));
  if (players.length < m.min) {
    toast(`${m.name} は${m.min}人そろうと始められます`);
    return;
  }
  net.post({
    kind: 'start',
    mode: online.mode,
    players,
    target: online.target,
    difficulty: online.difficulty,
    seed: (Math.random() * 2 ** 32) >>> 0,
    speed: state.speed,
    version: $('version').textContent,
  });
}

function renderOnline() {
  const inRoom = net.connected && net.room;
  $('onlineJoin').hidden = !!inRoom;
  $('onlineLobby').hidden = !inRoom;
  if (!$('onlineServer').value) $('onlineServer').value = params.get('server') || loadSetting(SERVER_KEY);
  if (!$('onlineName').value) $('onlineName').value = loadSetting(NAME_KEY);
  $('onlineStatus').textContent = online.status;
  if (!inRoom) return;
  const r = net.room;
  const host = net.isHost;
  const m = ONLINE_MODES[online.mode];
  $('roomCode').textContent = r.code;
  // モード選び(ホームだけ押せる)
  $('onlineModeSeg').replaceChildren(
    ...Object.entries(ONLINE_MODES).map(([id, om]) => {
      const b = el('button', { type: 'button', textContent: om.name, className: id === online.mode ? 'on' : '' });
      b.dataset.omode = id;
      b.disabled = !host;
      b.addEventListener('click', () => {
        online.mode = id;
        postMode();
        renderOnline();
      });
      return b;
    }),
  );
  $('onlineModeHint').textContent = m ? `${MODES[online.mode].hint}(${m.min}〜${m.max}人)` : host ? '👆 モードを選んでください' : 'ホーム(👑)がモードを選んでいます…';
  $('onlineTargetRow').hidden = online.mode !== 'rounds';
  $('onlineDiffRow').hidden = online.mode !== 'raid';
  for (const b of $('onlineTargetSeg').children) {
    b.classList.toggle('on', Number(b.dataset.target) === online.target);
    b.disabled = !host;
  }
  for (const b of $('onlineDiffSeg').children) {
    b.classList.toggle('on', b.dataset.diff === online.difficulty);
    b.disabled = !host;
  }
  $('lobbyList').replaceChildren(
    ...r.members.map((x, i) => {
      const def = WEAPON_BY_ID[online.picks[x.id]];
      const row = el('div', { className: 'lobby-row' + (x.id === net.you ? ' me' : '') });
      const tag = el('span', { className: 'ptag', textContent: x.name });
      tag.style.background = PLAYER_COLORS[i % PLAYER_COLORS.length];
      row.append(tag);
      if (x.id === r.host) row.append(el('span', { className: 'host', textContent: '👑ホーム' }));
      if (def) row.append(iconCanvas(def, 56), el('b', { textContent: def.name, style: `color:${readable(def.color)}` }), genreTag(def, true));
      else row.append(el('small', { textContent: '武器を選んでいます…' }));
      if (m && i >= m.max) row.append(el('small', { textContent: '(見るだけ)' }));
      return row;
    }),
  );
  const n = m ? Math.min(m.max, r.members.length) : 0;
  $('onlineStart').hidden = !host;
  $('onlineStart').disabled = !m || n < m.min;
  $('onlineStart').textContent = m ? `${m.name} 開始！(${n}人)` : 'モードを選ぶと開始できます';
  $('onlineWait').hidden = host;
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
  } else if (state.raid) {
    const r = state.raid;
    const b = bossOf(r);
    box.innerHTML =
      `<h3>ボス・レイド(${DIFFICULTY[r.difficulty].name}・最高記録 Lv${loadRaidBest()})</h3>` +
      `<p>Lv${r.level} <b style="color:${b.def.color}">${b.def.name}</b>: HP${b.boost.maxHp}・${b.def.grow}</p>` +
      (combosOf(r.players.map((p) => p.weapon)).length ? `<p>コンビ技: ${combosOf(r.players.map((p) => p.weapon)).map((c) => `${c.icon}${c.name}`).join('・')}</p>` : '') +
      (r.lastRanking ? `<p>前回の与ダメージ: ${r.lastRanking.map(({ p, dmg }, k) => `${k === 0 ? '👑' : ''}${p.name} ${dmg}`).join(' / ')}</p>` : '') +
      r.players
        .map(
          (p) =>
            `<div class="board-row"><span class="ptag" style="background:${p.color}">${p.name}</span><span class="bname" style="color:${p.weapon.color}">${p.weapon.name}${p.cpu ? ' 🤖' : ''}</span><span class="bskills">${skillIcons(p.skills)}</span></div>`,
        )
        .join('');
  } else if (state.chal) {
    const ch = state.chal;
    const e = ch.enemy || enemyBoost(ch.stage);
    box.innerHTML =
      `<h3>チャレンジ ステージ${ch.stage}(最高記録 ${loadBest()}勝)</h3>` +
      ch.players
        .map(
          (p) =>
            `<div class="board-row"><span class="ptag" style="background:${p.color}">${p.name}</span><span class="bname" style="color:${p.weapon.color}">${p.weapon.name}${p.cpu ? ' 🤖' : ''}</span><span class="bskills">${skillIcons(p.skills) || 'カードなし'}</span></div>` +
            recipeHints(p.skills),
        )
        .join('') +
      `<p>敵${ch.players.length > 1 ? `(${ch.players.length}体)` : ''}: HP${fmtNum(e.maxHp)}・初期成長+${e.preGrow}・威力×${e.power.toFixed(2)}${e.skills.length ? '・' + skillIcons(e.skills) : ''}</p>`;
  } else if (state.auto) {
    box.innerHTML = '<p>ランダムな対戦を自動で流し続けます。止めるときは ← でもどる。</p>';
  } else {
    box.innerHTML = '';
  }
  box.hidden = !box.innerHTML;
}

// 合体進化のヒント(作れるもの・あと1枚で作れるもの)
function recipeHints(owned) {
  const ready = fusionsReady(owned);
  const near = fusionsNear(owned);
  let html = '';
  if (ready.length) html += `<p class="recipe">🧪 合体できる: ${ready.map((f) => `${f.icon}${f.name}`).join('・')}(次のカード選びに出やすい)</p>`;
  if (near.length) html += `<p class="recipe">あと1枚で合体: ${near.slice(0, 4).map(({ fusion, missing }) => `${fusion.icon}${fusion.name}(${missing.icon}${missing.name})`).join('・')}</p>`;
  return html;
}

function recipeText(card) {
  return card.needs ? card.needs.map((id) => `${SKILL_BY_ID[id].icon}${SKILL_BY_ID[id].name}`).join(' + ') : '';
}

// ---- スキルカード選び ----

function showCards({ who, color, sub, cards, choose, cpu = false, mine = [], weapon = null, onDone }) {
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
    const b = el('button', { type: 'button', className: 'skill-card r-' + card.rarity });
    b.style.setProperty('--r', rare.color);
    const recipe = card.needs ? `<em class="sc-recipe">${recipeText(card)} を合体</em>` : '';
    // 武器によって効き方が変わるカードは、今の武器での効き方を目立たせる
    const far = weapon && weapon.kind === 'ranged';
    const fit = card.kinds && weapon ? `<em class="sc-kind">あなたの${weapon.name}(${far ? '飛び道具' : '近接'})なら → ${far ? card.kinds.far : card.kinds.near}</em>` : '';
    const rest = fit ? `(${far ? '近接' : '飛び道具'}なら: ${far ? card.kinds.near : card.kinds.far})` : card.desc;
    b.innerHTML = `<span class="sc-rare">${rare.name}</span><span class="sc-icon">${card.icon}</span><b>${card.name}</b>${recipe}${fit}<small>${rest}</small>`;
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
    state.cardAuto = null;
    for (const [card, b] of buttons) b.classList.toggle('picked', list.includes(card));
    setTimeout(() => {
      if (dlg.open) dlg.close();
      onDone(list);
    }, 450);
  }
  if (!dlg.open) dlg.showModal();
  state.cardAuto = null;
  if (cpu) setTimeout(() => finishPick(cpuPick(cards, choose)), state.autoPick ? 300 : 1200);
  else {
    // 🤖 オート: ランダムに選ぶ(あとからオートにしたときも選ぶ)
    state.cardAuto = () => {
      state.cardAuto = null;
      const pool = cards.slice();
      const list = [];
      while (list.length < choose && pool.length) list.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      finishPick(list);
    };
    if (state.autoPick) setTimeout(() => state.cardAuto && state.cardAuto(), 300);
  }
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
      const n = WEAPONS.filter((w) => inTab(w, id)).length;
      const b = el('button', { type: 'button', textContent: `${label} ${n}`, className: state.pickerTab === id ? 'on' : '' });
      b.addEventListener('click', () => {
        state.pickerTab = id;
        renderPicker();
      });
      return b;
    }),
  );
  const q = $('pickerSearch').value.trim().toLowerCase();
  const list = WEAPONS.filter((w) => inTab(w, state.pickerTab) && (!q || w.name.includes(q) || w.en.toLowerCase().includes(q)));
  const grid = $('pickerGrid');
  grid.replaceChildren(
    ...list.map((def) => {
      const b = el('button', { type: 'button' }, iconCanvas(def, 104), el('span', { textContent: def.name }), genreTag(def, true));
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

// カード・進化の一覧(レア度ごと。合体進化はレシピも出す)
function renderSkillBook() {
  const box = $('skillBook');
  const q = state.bookQuery.trim();
  box.replaceChildren();
  for (const [rarity, title] of [
    ['common', 'ふつう'],
    ['rare', 'レア'],
    ['epic', 'エピック'],
    ['legend', 'レジェンド'],
    ['fusion', '🧪 合体進化(2枚そろうとカード選びに出る。選ぶと2枚が合体)'],
    ['awaken', '⚔️ 武器進化(ボスを倒すと3つから1つ。重ねると 改→真→極→神)'],
    ['cursed', '😈 呪いのカード(とても強いが弱点もある。ときどき出る)'],
  ]) {
    const list = SKILLS.filter((c) => c.rarity === rarity && (!q || c.name.includes(q) || c.desc.includes(q) || recipeText(c).includes(q)));
    if (!list.length) continue;
    box.append(el('h3', { textContent: `${title} ${list.length}種` }));
    for (const c of list) {
      const row = el('div', { className: 'skill-row' });
      row.style.setProperty('--r', RARITY[c.rarity].color);
      row.innerHTML = `<span class="si">${c.icon}</span><b>${c.name}${c.kinds ? ' <span class="kind-tag">武器で変わる</span>' : ''}</b><small>${c.desc}</small>${c.needs ? `<em class="sc-recipe">${recipeText(c)}</em>` : ''}`;
      box.append(row);
    }
  }
}

function renderBook() {
  const skills = state.bookTab === 'skills';
  for (const b of $('bookTabs').children) b.classList.toggle('on', b.dataset.book === (state.bookTab || 'weapons'));
  $('bookGrid').hidden = skills;
  $('bookSort').hidden = skills;
  $('skillBook').hidden = !skills;
  $('bookHint').textContent = skills
    ? `カード ${SKILLS.length}種。ラウンズとチャレンジで選べます。`
    : '数字は今までの勝敗です(このブラウザにだけ保存)。タップするとその武器で1対1の準備へ。';
  if (skills) return renderSkillBook();
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
    card.append(iconCanvas(def, 88), name, genreTag(def), recEl, el('div', { className: 'grow', textContent: def.grow }));
    card.addEventListener('click', () => {
      ensureSlots();
      state.slots[0].weapon = def;
      if (state.slots[1].weapon === def) state.slots[1].weapon = randomWeapons(1, [def])[0];
      state.mode = 'battle';
      state.count.battle = 2;
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
    const online = isOnline();
    const lim = online ? onlineLimit() : null;
    if (lim !== null) {
      const sess = state.sess;
      // ホームより遅れていたら追いつく / 先に行きすぎていたら待つ
      const c = sess.clock;
      if (c && c.b === sess.battle && c.f - sess.frame > 2 * Math.round((0.3 * state.speed) / DT)) acc = Math.max(acc, (c.f - sess.frame) * DT * 0.5);
      if (sess.frame >= lim) acc = Math.min(acc, DT);
    }
    while (acc >= DT && n < 600 && (lim === null || state.sess.frame < lim)) {
      step(w);
      if (online) onlineStepped(w);
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
  for (const b of $('diffSeg').children) {
    b.addEventListener('click', () => {
      state.difficulty = b.dataset.diff;
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
  $('onlineCreate').addEventListener('click', () => onlineGo('create'));
  $('onlineJoinBtn').addEventListener('click', () => onlineGo('join'));
  $('onlineStart').addEventListener('click', onlineStart);
  for (const b of $('onlineTargetSeg').children) {
    b.addEventListener('click', () => {
      online.target = Number(b.dataset.target);
      postMode();
      renderOnline();
    });
  }
  for (const b of $('onlineDiffSeg').children) {
    b.addEventListener('click', () => {
      online.difficulty = b.dataset.diff;
      postMode();
      renderOnline();
    });
  }
  $('localBtn').addEventListener('click', () => {
    sound.unlock();
    show('modes');
  });
  $('onlineBtn').addEventListener('click', () => openMode('online'));
  $('autoBtn').addEventListener('click', () => {
    state.autoPick = !state.autoPick;
    saveSetting(AUTO_KEY, state.autoPick ? '1' : '');
    updateAutoBtn();
    if (state.autoPick && state.cardAuto) state.cardAuto();
  });
  $('onlineLeave').addEventListener('click', () => {
    net.close();
    online.picks = {};
    renderOnline();
  });
  $('onlinePick').addEventListener('click', () =>
    openPicker(
      '自分の武器をえらぶ',
      (def) => {
        online.myWeapon = def;
        net.post({ kind: 'weapon', weapon: def.id });
      },
      () => {
        online.myWeapon = randomWeapons(1)[0];
        net.post({ kind: 'weapon', weapon: online.myWeapon.id });
      },
    ),
  );
  $('playBtn').addEventListener('click', play);
  $('speedBtn').textContent = speedText(state.speed);
  $('speedBtn').addEventListener('click', () => {
    if (isOnline() && !net.isHost) return;
    state.speed = SPEEDS[(SPEEDS.indexOf(state.speed) + 1) % SPEEDS.length];
    $('speedBtn').textContent = speedText(state.speed);
    if (isOnline()) net.post({ kind: 'speed', v: state.speed });
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
  for (const b of $('bookTabs').children) {
    b.addEventListener('click', () => {
      state.bookTab = b.dataset.book;
      renderBook();
    });
  }
  $('bookSearch').addEventListener('input', (e) => {
    state.bookQuery = e.target.value;
    renderBook();
  });
  window.addEventListener('resize', resize);

  state.autoPick = loadSetting(AUTO_KEY) === '1';
  ensureSlots();
  history.replaceState({ screen: 'home' }, '');
  renderHome();

  // 共有URL: ?a=剣&b=短剣(1対1) / ?w=a,b,c(バトルロイヤル)
  const shared = params.get('w')
    ? params.get('w').split(',').map((id) => WEAPON_BY_ID[id]).filter(Boolean).slice(0, 4)
    : [WEAPON_BY_ID[params.get('a')], WEAPON_BY_ID[params.get('b')]].filter(Boolean);
  if (shared.length >= 2) {
    state.mode = 'battle';
    state.count.battle = shared.length;
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
window.__weaponBattle = { state, playRaid, net };

init();
