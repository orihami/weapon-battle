// ブラウザ(Chromium)で実際にページを開き、対戦が最後まで動くか確かめる。
// スクリーンショットは e2e-artifacts/ に保存される。
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

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
  // 1) 剣 vs 短剣 を4倍速で自動スタートし、決着まで見る
  await page.goto(base + '?a=sword&b=dagger&speed=4&autostart=1');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(outDir, '1-battle.png') });
  const mid = await page.evaluate(() => {
    const w = window.__weaponBattle.state.world;
    return { t: w.t, hp: w.balls.map((b) => b.hp) };
  });
  check(mid.t > 1, `時間が進んでいる (t=${mid.t.toFixed(1)})`);
  const title = await page.textContent('#title');
  check(title.includes('剣') && title.includes('短剣'), `タイトル: ${title.replace(/\s+/g, ' ').trim()}`);
  await page.waitForSelector('#overlay:not([hidden])', { timeout: 120000 });
  const result = await page.textContent('#resultText');
  check(/の勝ち！|引き分け/.test(result), `決着の表示: ${result}`);
  const end = await page.evaluate(() => {
    const w = window.__weaponBattle.state.world;
    return { over: w.over, winner: w.winner, hp: w.balls.map((b) => b.hp), stats: document.querySelector('#statsA').textContent };
  });
  check(end.over && end.hp.some((h) => h === 0 || end.winner === -1), `HP: ${end.hp.map((h) => Math.ceil(h)).join(' / ')}`);
  check(/ダメージ/.test(end.stats), `剣の能力表示: ${end.stats}`);
  await page.screenshot({ path: join(outDir, '2-result.png') });

  // 2) 武器選択ダイアログから右の武器を「盾」に変える
  await page.click('#pickB');
  await page.waitForSelector('#picker[open]');
  const count = await page.locator('#pickerGrid button').count();
  check(count >= 20, `選べる武器の数: ${count}`);
  await page.screenshot({ path: join(outDir, '3-picker.png') });
  await page.click('#pickerGrid button[data-id="shield"]');
  const nameB = await page.textContent('#nameB');
  check(nameB === '盾', `右の武器が盾になった: ${nameB}`);

  // 2.5) 片方だけランダム: 左だけ変わり、右(盾)はそのまま
  for (let i = 0; i < 5; i++) {
    const before = await page.evaluate(() => [window.__weaponBattle.state.a.id, window.__weaponBattle.state.b.id]);
    await page.click('#randomABtn');
    const after = await page.evaluate(() => [window.__weaponBattle.state.a.id, window.__weaponBattle.state.b.id]);
    check(after[1] === before[1] && after[0] !== before[0] && after[0] !== after[1], `左だけランダム: ${before.join(' vs ')} → ${after.join(' vs ')}`);
  }
  {
    const before = await page.evaluate(() => [window.__weaponBattle.state.a.id, window.__weaponBattle.state.b.id]);
    await page.click('#randomBBtn');
    const after = await page.evaluate(() => [window.__weaponBattle.state.a.id, window.__weaponBattle.state.b.id]);
    check(after[0] === before[0] && after[1] !== before[1], `右だけランダム: ${before.join(' vs ')} → ${after.join(' vs ')}`);
    await page.click('#pickA');
    await page.click('#pickerRandom');
    const viaPicker = await page.evaluate(() => [window.__weaponBattle.state.a.id, window.__weaponBattle.state.b.id]);
    check(viaPicker[1] === after[1] && viaPicker[0] !== after[0], `選択画面のおまかせ: ${after.join(' vs ')} → ${viaPicker.join(' vs ')}`);
    await page.screenshot({ path: join(outDir, '3b-random-buttons.png') });
  }

  // 2.7) トーナメント(8人)を4倍速で最後まで進める
  await page.goto(base + '?speed=4');
  await page.click('#tour8Btn');
  await page.waitForSelector('.champion', { timeout: 300000 });
  const champ = await page.textContent('.champion');
  const done = await page.evaluate(() => document.querySelectorAll('#bracket .match').length);
  check(/優勝/.test(champ) && done === 7, `トーナメント: ${champ.trim()}(試合枠 ${done})`);
  await page.screenshot({ path: join(outDir, '3c-tournament.png'), fullPage: true });

  // 2.8) ランキング(勝率順)の並び替え
  await page.selectOption('#bookSort', 'rate');
  const ranks = await page.evaluate(() => [...document.querySelectorAll('#bookGrid .rank')].map((r) => r.textContent));
  check(ranks[0] === '1位' && ranks.length >= 2, `ランキング表示: ${ranks.slice(0, 3).join(', ')}`);

  // 3) 全武器を少しずつ動かして、描画でエラーが出ないか
  const ids = await page.evaluate(() => [...document.querySelectorAll('#bookGrid .card')].map((c) => c.dataset.id));
  check(ids.length >= 20, `ずかんの武器数: ${ids.length}`);
  for (let i = 0; i < ids.length; i += 2) {
    await page.goto(base + `?a=${ids[i]}&b=${ids[(i + 1) % ids.length]}&speed=4&autostart=1`);
    await page.waitForTimeout(700);
  }
  await page.goto(base + '?a=flail&b=orb&speed=2&autostart=1');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(outDir, '4-flail-orb.png') });
  await page.goto(base + '?a=trident&b=orbital&speed=2&autostart=1');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(outDir, '5-trident-orbital.png') });
  await page.goto(base);
  await page.evaluate(() => document.querySelector('.book').scrollIntoView());
  await page.screenshot({ path: join(outDir, '6-book.png') });

  check(errors.length === 0, `ブラウザのエラーなし ${errors.length ? JSON.stringify(errors.slice(0, 5)) : ''}`);
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
