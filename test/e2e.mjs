// ブラウザ(Chromium)で実際にページを開き、対戦が最後まで動くか確かめる。
// スクリーンショットは e2e-artifacts/ に保存される。
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = join(root, 'e2e-artifacts');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  try {
    const body = await readFile(join(root, path || 'index.html'));
    res.writeHead(200, { 'content-type': TYPES[extname(path || 'index.html')] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

await mkdir(outDir, { recursive: true });
const launchOpts = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  // 読み込み失敗は requestfailed 側でURL付きで判定する
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text());
});
page.on('requestfailed', (r) => {
  if (!/fonts\.(googleapis|gstatic)/.test(r.url())) errors.push('requestfailed: ' + r.url());
});
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`);
});
// 外部フォントが取れない環境でもテストできるように遮断しておく(フォールバックの字体で描画される)
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

let failed = false;
function check(cond, msg) {
  console.log((cond ? 'OK   ' : 'FAIL ') + msg);
  if (!cond) failed = true;
}

try {
  const st = () => page.evaluate(() => {
    const s = window.__weaponBattle.state;
    return { screen: s.screen, f: s.fighters.map((d) => d.id), over: !!(s.world && s.world.over), t: s.world ? s.world.t : 0, n: s.world ? s.world.balls.length : 0, size: s.world ? s.world.size : 0, slots: s.slots.map((x) => x.weapon.id) };
  });
  const waitOverlay = () => page.waitForSelector('#overlay:not([hidden])', { timeout: 150000 });

  // 1) ホーム
  await page.goto(base + '?speed=4');
  const modes = await page.locator('[data-mode]').count();
  check(modes === 8, `ホームの遊び方: ${modes}個`);
  await page.screenshot({ path: join(outDir, '0-home.png') });

  // 2) 共有URL(剣 vs 短剣)を4倍速で自動スタートし、決着まで見る
  await page.goto(base + '?a=sword&b=dagger&speed=4&autostart=1');
  await page.waitForTimeout(1500);
  let s = await st();
  check(s.screen === 'battle' && s.t > 1, `共有URLでバトル画面へ・時間が進む (t=${s.t.toFixed(1)})`);
  check(await page.evaluate(() => window.__weaponBattle.state.awake === true), 'バトル中は画面を点けたままにする');
  const title = await page.textContent('#battleTitle');
  check(title.includes('剣') && title.includes('短剣'), `タイトル: ${title.replace(/\s+/g, ' ').trim()}`);
  await page.screenshot({ path: join(outDir, '1-battle.png') });
  await waitOverlay();
  const result = await page.textContent('#resultText');
  check(/の勝ち！|引き分け/.test(result), `決着の表示: ${result}`);
  const hud = await page.textContent('#hud');
  check(/ダメージ/.test(hud) && /HP|OUT/.test(hud), `能力とHPの表示: ${hud.replace(/\s+/g, ' ').slice(0, 60)}`);
  await page.screenshot({ path: join(outDir, '2-result.png') });
  // 「戻る」で準備画面へ
  await page.click('#battle [data-back]');
  s = await st();
  check(s.screen === 'setup' && s.slots[0] === 'sword' && s.slots[1] === 'dagger', `戻ると準備画面: ${s.screen} ${s.slots.slice(0, 2).join(' vs ')}`);
  check(await page.evaluate(() => window.__weaponBattle.state.awake === false), 'バトル画面を出たら画面の点けたままをやめる');

  // 3) 1対1の準備: 武器選び(検索)・片方だけランダム・入れ替え
  await page.goto(base + '?speed=4');
  await page.click('[data-mode="duel"]');
  await page.click('#slots .slot:nth-child(2) .slot-pick');
  await page.waitForSelector('#picker[open]');
  const count = await page.locator('#pickerGrid button').count();
  check(count >= 90, `選べる武器の数: ${count}`);
  await page.fill('#pickerSearch', '盾');
  const found = await page.locator('#pickerGrid button').count();
  check(found >= 1 && found < 5, `検索「盾」: ${found}件`);
  await page.screenshot({ path: join(outDir, '3-picker.png') });
  await page.click('#pickerGrid button[data-id="shield"]');
  s = await st();
  check(s.slots[1] === 'shield', `P2が盾になった: ${s.slots[1]}`);
  for (let k = 0; k < 4; k++) {
    const before = (await st()).slots;
    await page.click('#slots .slot:nth-child(1) .slot-dice');
    const after = (await st()).slots;
    check(after[1] === before[1] && after[0] !== before[0] && after[0] !== after[1], `P1だけランダム: ${before.slice(0, 2).join(' vs ')} → ${after.slice(0, 2).join(' vs ')}`);
  }
  {
    const before = (await st()).slots;
    await page.click('#swapBtn');
    const after = (await st()).slots;
    check(after[0] === before[1] && after[1] === before[0], `入れ替え: ${after.slice(0, 2).join(' vs ')}`);
  }
  await page.screenshot({ path: join(outDir, '3b-setup-duel.png') });
  await page.click('#goBtn');
  await page.waitForTimeout(600);
  s = await st();
  check(s.screen === 'battle' && s.n === 2 && s.t > 0, `1対1が始まる (${s.f.join(' vs ')})`);

  // 4) バトルロイヤル: 4人が広いフィールドで同時に戦う
  await page.goto(base + '?speed=4');
  await page.click('[data-mode="royale"]');
  await page.click('#countSeg [data-count="4"]');
  const slots = await page.locator('#slots .slot').count();
  check(slots === 4, `バトルロイヤルの準備: ${slots}人`);
  await page.click('#randomAll');
  await page.click('#goBtn');
  await page.waitForTimeout(2500);
  s = await st();
  check(s.n === 4 && s.size === 820 && s.t > 1, `4人同時バトル(広さ ${s.size}): ${s.f.join(', ')}`);
  await page.screenshot({ path: join(outDir, '4-royale.png') });
  await waitOverlay();
  const r4 = await page.textContent('#resultText');
  const outs = await page.evaluate(() => window.__weaponBattle.state.world.outOrder.length);
  check(/の勝ち！|引き分け/.test(r4) && (outs === 3 || /引き分け/.test(r4)), `バトルロイヤル決着: ${r4}(倒れた順 ${outs}人)`);
  check(await page.isVisible('#againBtn'), '「もう一度」ボタン');
  await page.screenshot({ path: join(outDir, '4b-royale-result.png') });
  await page.click('#nextBtn');
  await page.waitForTimeout(500);
  s = await st();
  check(s.n === 4 && s.t > 0, `「別の武器で」4人で再戦: ${s.f.join(', ')}`);

  // 5) ラウンズ: 3人同時(P1は人、P2・P3はCPU)、3勝先取。負けた人が全員カードを選ぶ
  await page.goto(base + '?speed=4');
  await page.click('[data-mode="rounds"]');
  await page.click('#countSeg [data-count="3"]');
  await page.click('#targetSeg [data-target="3"]');
  const who = await page.$$eval('#slots .slot-who', (els) => els.map((e) => e.textContent));
  check(who.length === 3 && /人/.test(who[0]) && /CPU/.test(who[1]) && /CPU/.test(who[2]), `ラウンズの準備: ${who.join(' / ')}`);
  await page.click('#goBtn');
  let humanPicks = 0;
  let cpuPicks = 0;
  let seq = 0;
  for (let k = 0; k < 80; k++) {
    const res = await page.waitForFunction(
      (seen) => {
        const t = document.querySelector('#resultText').textContent;
        if (/優勝/.test(t) && !document.querySelector('#overlay').hidden) return 'champion';
        const d = document.querySelector('#cardDialog');
        const n = Number(d.dataset.seq || 0);
        if (d.open && n > seen) return n + '|' + document.querySelector('#cardSub').textContent;
        return false;
      },
      seq,
      { timeout: 200000, polling: 100 },
    );
    const v = await res.jsonValue();
    if (v === 'champion') break;
    seq = Number(v.split('|')[0]);
    if (/CPU/.test(v)) {
      cpuPicks++;
    } else {
      humanPicks++;
      const need = /2枚/.test(v) ? 2 : 1;
      const cards = await page.$$('#cardGrid .skill-card');
      if (humanPicks === 1) await page.screenshot({ path: join(outDir, '5-cards.png') });
      for (let c = 0; c < need; c++) await cards[c].click();
    }
  }
  const champText = await page.textContent('#resultText');
  const board = await page.$$eval('#sideInfo .board-row', (rows) => rows.map((r) => r.textContent));
  check(/P\d 優勝/.test(champText) && humanPicks + cpuPicks >= 2, `ラウンズ: ${champText}(人の選択 ${humanPicks} / CPUの選択 ${cpuPicks})`);
  check(board.length === 3, `ラウンズのスコア表: ${board.map((b) => b.replace(/\s+/g, ' ')).join(' | ')}`);
  await page.screenshot({ path: join(outDir, '5b-rounds.png') });

  // 6) チャレンジ: 1ステージ戦い、勝てばカードを選んで次へ / 負ければ終了
  await page.goto(base + '?speed=4');
  await page.click('[data-mode="chal"]');
  await page.click('#slots .slot-pick');
  await page.click('#pickerGrid button[data-id="lightning"]');
  await page.click('#goBtn');
  const t1 = await page.textContent('#battleTitle');
  check(/ステージ 1/.test(t1), `チャレンジ開始: ${t1}`);
  const chal = await page.waitForFunction(
    () => (document.querySelector('#cardDialog').open ? 'card' : /敗退/.test(document.querySelector('#resultText').textContent) && !document.querySelector('#overlay').hidden ? 'lose' : false),
    null,
    { timeout: 300000 },
  );
  if ((await chal.jsonValue()) === 'card') {
    await page.click('#cardGrid .skill-card');
    await page.waitForTimeout(800);
    const t2 = await page.textContent('#battleTitle');
    const sk = await page.evaluate(() => window.__weaponBattle.state.world.balls[0].skills.length);
    check(/ステージ 2/.test(t2) && sk === 1, `勝ってカードを選び次のステージへ: ${t2}(スキル ${sk}枚)`);
  } else {
    check(/敗退/.test(await page.textContent('#resultText')), 'チャレンジ: 負けて終了');
  }
  await page.screenshot({ path: join(outDir, '6-challenge.png') });

  // 6.5) チャレンジのボスを倒したとき: 武器進化(3つから1つ) → 大進化(合体進化も出る)
  await page.goto(base + '?speed=4');
  await page.click('[data-mode="chal"]');
  await page.click('#slots .slot-pick');
  await page.click('#pickerGrid button[data-id="bow"]');
  await page.click('#goBtn');
  await page.waitForTimeout(300);
  await page.evaluate(async () => {
    const s = window.__weaponBattle.state;
    const { SKILL_BY_ID: S } = await import('./src/skills.js');
    s.chal.stage = 5;
    s.chal.enemy.boss = true;
    s.chal.skills.push(S.vamp, S.hp);
    // ボスのカード(回復する守護神など)で持ち直さないよう、カードを外してからHPを減らす
    s.world.balls[1].skills = [];
    s.world.balls[1].w.revived = true; // 不死鳥のよみがえりも使い切ったことにする
    s.world.balls[1].hp = 0.01;
  });
  await page.waitForFunction(() => document.querySelector('#cardDialog').open, null, { timeout: 200000 });
  const awakenCards = await page.locator('#cardGrid .skill-card.r-awaken').count();
  check(awakenCards === 3, `ボス撃破で武器進化の候補: ${awakenCards}つ`);
  await page.screenshot({ path: join(outDir, '6b-awaken.png') });
  await page.click('#cardGrid .skill-card');
  await page.waitForFunction(() => document.querySelector('#cardDialog').open && document.querySelector('#cardSub').textContent.includes('大進化'), null, { timeout: 30000 });
  const fusion = await page.locator('#cardGrid .skill-card.r-fusion').count();
  check(fusion >= 1, `材料がそろうと大進化に合体進化が出る: ${fusion}枚`);
  await page.screenshot({ path: join(outDir, '6c-fusion.png') });
  const big = await page.$$('#cardGrid .skill-card');
  await big[big.length - 1].click();
  await big[0].click();
  await page.waitForTimeout(1200);
  const hudName = await page.textContent('#hud .hud-card .hud-name');
  check(/弓・改/.test(hudName) && /ステージ 6/.test(await page.textContent('#battleTitle')), `武器進化した名前: ${hudName}`);

  // 6.8) ボス・レイド: みんな(チーム0)でボス(チーム1)と戦い、勝つと全員がカードを選んで次のレベルへ
  await page.goto(base + '?speed=4');
  await page.click('[data-mode="raid"]');
  await page.click('#countSeg button[data-count="3"]');
  await page.click('#diffSeg button[data-diff="easy"]');
  const comboText = await page.textContent('#slots .combo-box');
  check(/コンビ技/.test(comboText), `レイドの準備にコンビ技の表示: ${comboText.slice(0, 40)}`);
  await page.click('#goBtn');
  await page.waitForTimeout(300);
  const raidInfo = await page.evaluate(() => {
    const w = window.__weaponBattle.state.world;
    return { n: w.balls.length, teams: w.balls.map((b) => b.team).join(','), boss: w.balls[3].def.name, title: document.querySelector('#battleTitle').textContent, bossCard: !!document.querySelector('#hud .boss-card') };
  });
  check(raidInfo.n === 4 && raidInfo.teams === '0,0,0,1' && raidInfo.bossCard && /Lv1/.test(raidInfo.title), `ボス・レイド開始: ${raidInfo.title}(チーム ${raidInfo.teams})`);
  await page.evaluate(() => {
    const s = window.__weaponBattle.state;
    const boss = s.world.balls[3];
    boss.skills = [];
    boss.hp = 0.01;
    for (const p of s.raid.players) p.cpu = true; // カード選びはCPUにまかせる
  });
  await page.waitForFunction(() => /Lv2/.test(document.querySelector('#battleTitle').textContent), null, { timeout: 120000 });
  const raidCards = await page.evaluate(() => window.__weaponBattle.state.raid.players.map((p) => p.skills.length).join(','));
  check(raidCards === '1,1,1', `ボスを倒すと全員がカードを1枚: ${raidCards} → ${await page.textContent('#battleTitle')}`);
  await page.screenshot({ path: join(outDir, '6d-raid.png') });

  // 7) トーナメント(8人)を4倍速で最後まで
  await page.goto(base + '?speed=4');
  await page.click('[data-mode="tour"]');
  await page.click('#sizeSeg [data-size="8"]');
  await page.click('#goBtn');
  await page.waitForSelector('#bracket .champion', { timeout: 300000 });
  const champ = await page.textContent('#bracket .champion');
  const done = await page.evaluate(() => document.querySelectorAll('#bracket .match').length);
  check(/優勝/.test(champ) && done === 7, `トーナメント: ${champ.trim()}(試合枠 ${done})`);
  await page.screenshot({ path: join(outDir, '7-tournament.png'), fullPage: true });

  // 8) ずかん: 勝率順(ランキング)と検索
  await page.click('#battle [data-back]');
  await page.click('#setup [data-back]');
  s = await st();
  check(s.screen === 'home', `戻る2回でホームへ: ${s.screen}`);
  await page.click('#bookOpen');
  await page.selectOption('#bookSort', 'rate');
  const ranks = await page.evaluate(() => [...document.querySelectorAll('#bookGrid .rank')].map((r) => r.textContent));
  check(ranks[0] === '1位' && ranks.length >= 2, `ランキング表示: ${ranks.slice(0, 3).join(', ')}`);
  await page.screenshot({ path: join(outDir, '8-book.png') });
  await page.click('[data-book="skills"]');
  const skillRows = await page.locator('#skillBook .skill-row').count();
  check(skillRows >= 80, `カード・進化の一覧: ${skillRows}種`);
  await page.screenshot({ path: join(outDir, '8b-skill-book.png') });
  await page.click('[data-book="weapons"]');
  await page.fill('#bookSearch', '爆弾');
  const hits = await page.locator('#bookGrid .card').count();
  check(hits >= 2 && hits < 10, `ずかんの検索「爆弾」: ${hits}件`);
  await page.click('#bookGrid .card[data-id="bomb"]');
  s = await st();
  check(s.screen === 'setup' && s.slots[0] === 'bomb', `ずかんから1対1の準備へ: ${s.slots[0]}`);

  // 9) 連続観戦
  await page.goto(base + '?speed=4');
  await page.click('[data-mode="auto"]');
  await page.waitForTimeout(800);
  s = await st();
  check(s.screen === 'battle' && s.n >= 2 && s.t > 0, `連続観戦: ${s.f.join(', ')}`);

  // 10) 共有ボタン(クリップボードが使えない環境ではURLを表示)
  await page.goto(base + '?a=bomb&b=lightning');
  await page.click('#shareBtn');
  await page.waitForTimeout(300);
  const toastText = await page.textContent('#toast');
  check(/a=bomb&b=lightning|コピー/.test(toastText), `共有: ${toastText}`);

  // 10.5) オンライン: サーバーを立てて、2台(2つのページ)で同じ部屋に入り、同じ試合が流れるか
  const port = 8700 + Math.floor(Math.random() * 200);
  const game = spawn(process.execPath, [join(root, 'server/server.js')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  try {
    await new Promise((r) => setTimeout(r, 600));
    const url = base + `?server=ws://127.0.0.1:${port}&speed=4`;
    const page2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page2.on('pageerror', (e) => errors.push('pageerror(2): ' + e.message));
    await page2.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    for (const p of [page, page2]) {
      await p.goto(url);
      await p.click('[data-mode="online"]');
    }
    await page.fill('#onlineName', 'あお');
    await page.click('#onlineCreate');
    await page.waitForSelector('#onlineLobby:not([hidden])');
    const code = (await page.textContent('#roomCode')).trim();
    await page2.fill('#onlineName', 'あか');
    await page2.fill('#onlineCode', code);
    await page2.click('#onlineJoinBtn');
    await page.waitForFunction(() => document.querySelectorAll('#lobbyList .lobby-row b').length === 2, null, { timeout: 10000 });
    check(/^[A-Z0-9]{4}$/.test(code), `オンライン: 部屋 ${code} に2人(${(await page.textContent('#lobbyList')).slice(0, 30)})`);
    await page.screenshot({ path: join(outDir, '8b-online-lobby.png') });
    await page.click('#onlineStart');
    const snap = (p) => p.evaluate(() => { const w = window.__weaponBattle.state.world; return w && `${w.seed}|${w.balls.map((b) => b.def.id).join(',')}`; });
    await Promise.all([page, page2].map((p) => p.waitForFunction(() => window.__weaponBattle.state.world && window.__weaponBattle.state.world.t > 1, null, { timeout: 15000 })));
    const [s1, s2] = [await snap(page), await snap(page2)];
    check(s1 && s1 === s2, `オンライン: 2台で同じ試合 ${s1} / ${s2}`);
    await page2.close();
  } finally {
    game.kill();
  }

  // 11) 全武器を1対1と4人で少しずつ動かして、描画でエラーが出ないか
  const all = await page.evaluate(async () => (await import('./src/weapons.js')).WEAPONS.map((w) => w.id));
  check(all.length >= 90, `武器数: ${all.length}`);
  for (let k = 0; k < all.length; k += 2) {
    await page.goto(base + `?a=${all[k]}&b=${all[(k + 1) % all.length]}&speed=4&autostart=1`);
    await page.waitForTimeout(600);
  }
  for (let k = 0; k < all.length; k += 4) {
    await page.goto(base + `?w=${[0, 1, 2, 3].map((d) => all[(k + d) % all.length]).join(',')}&speed=4&autostart=1`);
    await page.waitForTimeout(900);
  }
  s = await st();
  check(s.n === 4, `?w= で4人の共有URL: ${s.f.join(', ')}`);
  await page.screenshot({ path: join(outDir, '9-royale-share.png') });

  check(errors.length === 0, `ブラウザのエラーなし ${errors.length ? JSON.stringify(errors.slice(0, 5)) : ''}`);
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
