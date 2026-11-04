// オンラインで全員の試合をそろえるための確認: 同じ種の試合を、Node(V8)・Chromium・WebKit(iPhone の Safari の系統)・Firefox で
// 計算して、結果(勝者・時間・全員のHPと位置)がまったく同じかをくらべる。スキルカード付き・ボス・レイドも入れる。
//   node test/determinism.mjs [試合数]      (ブラウザは npx playwright install chromium webkit firefox で入れておく)
import { chromium, webkit, firefox } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const N = Number(process.argv[2] || 60);

// どこでも同じに動く「試合をたくさん回して要約を返す」関数(ブラウザにもそのまま渡す)
async function job({ N, base }) {
  const { createMelee, runToEnd, mulberry32 } = await import(base + 'src/engine.js');
  const { WEAPONS } = await import(base + 'src/weapons.js');
  const { SKILLS } = await import(base + 'src/skills.js');
  const { createRaid, raidMatch } = await import(base + 'src/raid.js');
  const pickable = SKILLS.filter((s) => s.rarity !== 'cursed' || true);
  const out = [];
  const sum = (w) => `${w.winner}|${w.t.toFixed(9)}|` + w.balls.map((b) => `${b.hp.toFixed(9)},${b.x.toFixed(6)},${b.y.toFixed(6)}`).join(';');
  for (let i = 0; i < N; i++) {
    const rng = mulberry32(777 + i);
    const n = 2 + (i % 3);
    const defs = Array.from({ length: n }, () => WEAPONS[Math.floor(rng() * WEAPONS.length)]);
    // 半分はスキルカードを持たせる
    const boosts = defs.map(() => ({ skills: i % 2 ? Array.from({ length: 1 + Math.floor(rng() * 4) }, () => pickable[Math.floor(rng() * pickable.length)]) : [] }));
    out.push(sum(runToEnd(createMelee(defs, 1000 + i, { boosts }))));
    if (i % 5 === 0) {
      // ボス・レイド
      const raid = createRaid(defs.slice(0, 2).map((w, k) => ({ name: 'P' + k, weapon: w })), 'normal');
      raid.level = 1 + (i % 9);
      const m = raidMatch(raid);
      out.push(sum(runToEnd(createMelee(m.defs, 2000 + i, { boosts: m.boosts, teams: m.teams }))));
    }
  }
  return out;
}

const server = createServer(async (req, res) => {
  let p = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (p.endsWith('/')) p += 'index.html';
  let data;
  try {
    data = await readFile(p);
  } catch {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': extname(p) === '.js' ? 'text/javascript' : 'text/html' });
  res.end(data);
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}/`;

const results = { node: await job({ N, base: pathToFileURL(root).href + '/' }) };
let failed = false;
for (const [name, bt] of [['chromium', chromium], ['webkit', webkit], ['firefox', firefox]]) {
  let b;
  try {
    b = await bt.launch(process.env.CHROMIUM_PATH && name === 'chromium' ? { executablePath: process.env.CHROMIUM_PATH } : {});
  } catch (e) {
    console.log(`SKIP ${name}: 起動できない(${e.message.split('\n')[0]})`);
    continue;
  }
  const page = await b.newPage();
  await page.goto(base + 'test/blank.html').catch(() => {});
  results[name] = await page.evaluate(job, { N, base });
  await b.close();
}
server.close();
const ref = results.node;
for (const k of Object.keys(results)) {
  const diff = results[k].map((r, i) => (r === ref[i] ? null : i)).filter((x) => x !== null);
  console.log(`${diff.length ? 'FAIL' : 'OK  '} ${k}: ${ref.length}試合中 Node とちがう結果 ${diff.length}${diff.length ? '(最初: ' + diff[0] + ')' : ''}`);
  if (diff.length) failed = true;
}
process.exit(failed ? 1 : 0);
