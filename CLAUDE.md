# CLAUDE.md — weapon-battle

武器を持ったボール同士が戦うウェブアプリ（ブラウザで動く）。攻撃が当たるたびに武器の能力値が成長する。
ビルド不要の素の HTML / CSS / JavaScript（ES Modules）で、GitHub Pages で公開する。

**ユーザーへの返答・報告は日本語で。** 待ち時間や予定を書くときは日本時間を添える。公開URLなどはタップしてすぐ開ける形で書く。

## 構成

```
index.html, style.css     画面
src/engine.js             シミュレーション本体（DOM非依存。Nodeのテストからそのまま動く）
src/weapons.js            武器の定義（102種）。onHit で「当たったら成長」を書く
src/tournament.js         トーナメント(勝ち抜き戦)の進行（DOM非依存）
src/skills.js             スキルカード（116種: ふつう〜レジェンド69・合体進化31・武器進化10・呪い6）。engine のフックで効く（DOM非依存）
src/rounds.js             ラウンズ(2〜4人が同時に戦い、負けた全員がカードを選ぶ)の進行（DOM非依存）
src/challenge.js          チャレンジ(1人用ローグライク)のステージ・ボス・敵の強さ（DOM非依存）
src/render.js             描画（端末の解像度でそのまま描く。低解像度で引き伸ばすと画質が悪いとユーザーに不評だった）
src/sound.js              効果音（WebAudioで合成）
src/main.js               画面(ホーム → 準備 → バトル / ずかん)の切り替え・ループ
test/engine.test.js       ユニットテスト（node --test）
test/e2e.mjs              ブラウザテスト（Playwright。スクショを e2e-artifacts/ へ）
scripts/balance.mjs       総当たりの勝率表（バランス調整用）
scripts/skills-balance.mjs スキル1枚でどれくらい勝ちやすくなるか（目安: ふつう60〜70% / レア65〜80% / エピック70〜85% / レジェンド80〜92%）
```

## 開発の手順

1. 実装する。ロジックは `engine.js` / `weapons.js` に置き、DOMに依存させない。
2. テストを追加・更新する。
3. ローカルで確認する:
   - `npm test`（ユニットテスト。全組み合わせの決着・勝率10〜90%も見る）
   - `npm run e2e`（クラウド環境では `CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run e2e`）
   - 武器を足したり数値を変えたら `npm run balance` で勝率を確認する。
4. `main` に push すると GitHub Actions（`.github/workflows/ci.yml`）がテスト → `gh-pages` ブランチへ公開する。
5. Actions の結果と、公開URLで実際に新しい版が出ていることを確かめてから報告する（ページ最下部の「版:」がコミットの先頭7文字になっているか）。GitHub Pages は10分キャッシュされるので、ユーザーに古い版が見えたら再読み込みを案内する。**確かめていないことを「できた」と言わない。**

## バランスの方針

- ユーザーの好み: 爆弾のように **当てるほど数が増えて、終盤にドパッと決まる（ローグライク風）** 成長が好き。強くなりすぎないよう、増え方（1回あたりの増加量・上限）と1発の威力で調整する。
- **成長に上限を付けない**（ユーザーの指示）。見た目や仕組みに限界がある値（周回玉の数・槍の長さなど）は `growStat(me, key, step, cap, over)` を使い、超えた分は「威力」（`ball.power`、その武器の与ダメージ倍率）として伸ばし続ける。画面には本当の値と「威力 ×n」が出る。
- 逆転が起きるように **逆境ブースト**（`engine.js` の `COMEBACK_BOOST`）: HPで負けている側は、当てたときにもう一度成長しやすい。
- 目安: `npm run balance 4` で全武器の勝率が おおむね 30〜70%、1試合 30〜60秒。`node scripts/comeback.mjs` で逆転勝ち（HP30以上の差をひっくり返した試合）の割合を見る（今は約13%）。

## スキルとモード

- スキルは `ball.skills`（1枚ごとに `{ def, st }`）。engine は `outgoing / incoming / afterDeal / onHit / update / lethal / contact / apply` のフックを呼ぶ。スキルのダメージは `kind: 'skill'` で与え、武器の成長やスキルの連鎖は起こさない。
- `createBattle(a, b, seed, { a: { skills, maxHp, preGrow, power, speedMul }, b: {...} })` でスキルや強化を持たせる。
- 3人以上の同時バトルは `createMelee(defs, seed, { boosts: [...], size })`（3人以上は広さ820、1対1は600）。各ボールは一番近い相手をねらう（`foeOf`）。倒れた順は `world.outOrder`、`'out'` イベントが出る。武器のコードで「相手」が要るときは `world.balls[1 - id]` ではなく `foeOf(world, ball)` を使う。範囲攻撃は範囲内の全員に当てる。
- フィールドの広さは試合ごと（`world.size`）。`engine.js` の `ARENA` は `step` のたびに今の試合の広さに合わせ直される。1対1の結果は人数対応の前と完全に同じ（同じシードで同じ結果）。
- 進化: 合体進化（`rarity: 'fusion'`、`needs` の2枚がそろうと `makeOffer` が混ぜる。`addSkills` で材料と合体）、武器進化（`rarity: 'awaken'`、チャレンジのボスのあとに3つから1つ。`ball.awaken` が段階、名前は `awakenSuffix`）、呪い（`rarity: 'cursed'`、ときどき出る）。カードを足すときは `scripts/skills-balance.mjs` で強さを見る。
- ラウンズの大進化は軽くしてある（ふつうの確率のカードから2枚・武器進化なし）。強くすると大進化した人が一方的に勝ち続けて面白くない（ユーザーの指摘。大進化の直後に勝つ率が2人戦で74%になっていた）。
- スキルの追加の剣は `blade.free`（武器の向きと関係なく自分で回る）。遠距離武器は相手の方を向き続けるので、武器の向きに付けると当たらない（ユーザーの指摘）。
- 白っぽい武器の色はHPバーや名前で見づらい（ユーザーの指摘）。main.js の `readable()` で暗くして使い、戦場のHPの数字は縁取りを付ける。
- 画面に弾が出すぎると「めちゃくちゃ」と不評（ユーザーの指摘）。数が増える武器は `growStat` の上限（見た目の数）を20くらいまでにして、超えた分は威力にする。武器を足したら1試合の最大弾数も見る。
- 分裂弾（レジェンド）: 飛び道具の武器は `ball.extraShots` で撃つたびに弾が増える（engine の `spawnProjectile`。武器の update 中に撃った最初の動く弾だけ複製）。動く弾を撃たない武器は3方向弾。
- ユーザーは「自分の武器によってカードの相性が変わる」のが好き（ビルドのやりがい）。武器で効き方が変わるカードは `kinds: { far, near }` を書くと、カード選びに今の武器での効き方が出る。強さは近接・飛び道具に分けて測る。
- 「複数人」は同じ端末を交代で操作する方式（サーバーがないのでネット対戦はない）。

## URL パラメータ

`?a=sword&b=dagger&speed=4&autostart=1` で武器・速度・自動スタートを指定できる（テストや共有用）。`?w=bomb,sword,lightning` は3〜4人のバトルロイヤル。武器IDは `src/weapons.js` の `id`。

## 引き継ぎ

作業の区切りごとに `HANDOFF.md` を更新して commit・push する。秘密情報は書かない。
このリポジトリと公開ページは誰でも見られる。参考にした動画・作者の名前や、それらの呼び名（武器名など）はファイルにもコミットメッセージにも書かない。
