// チャレンジモード(ローグライク): 自分の武器でステージを勝ち進み、勝つたびに強化を1つ選ぶ。
// DOMに依存しないので Node のテストから使える。

export const UPGRADES = [
  { id: 'hp', name: '体力 +25', desc: '最大HPが25増える', apply: (s) => (s.maxHp += 25) },
  { id: 'grow', name: '初期成長 +3', desc: '試合開始の時点で3回分成長している', apply: (s) => (s.preGrow += 3) },
  { id: 'power', name: '威力 +15%', desc: '与えるダメージが15%増える', apply: (s) => (s.power *= 1.15) },
  { id: 'speed', name: '素早さ +10%', desc: '動きが10%速くなる', apply: (s) => (s.speedMul *= 1.1) },
  { id: 'all', name: 'ちょっとずつ全部', desc: '体力+8・初期成長+1・威力+5%', apply: (s) => ((s.maxHp += 8), (s.preGrow += 1), (s.power *= 1.05)) },
];

export function newChallenge(weapon) {
  return { weapon, stage: 1, stats: { maxHp: 100, preGrow: 0, power: 1, speedMul: 1 }, picked: [] };
}

// ステージが進むほど敵が強くなる
export function enemyBoost(stage) {
  return { maxHp: 100 + 12 * (stage - 1), preGrow: 2 * (stage - 1), power: 1 + 0.04 * (stage - 1) };
}

// 勝ったときに選べる強化を3つ(重複なし)
export function offerUpgrades(rng = Math.random) {
  const pool = UPGRADES.slice();
  const out = [];
  while (out.length < 3) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

export function applyUpgrade(ch, upgrade) {
  upgrade.apply(ch.stats);
  ch.picked.push(upgrade.id);
  ch.stage++;
}

// 画面に出す強化の一覧(短く)
export function describeStats(s) {
  const parts = [`HP${Math.round(s.maxHp)}`];
  if (s.preGrow) parts.push(`初期成長+${s.preGrow}`);
  if (s.power > 1.001) parts.push(`威力×${s.power.toFixed(2)}`);
  if (s.speedMul > 1.001) parts.push(`素早さ×${s.speedMul.toFixed(2)}`);
  return parts.join(' / ');
}
