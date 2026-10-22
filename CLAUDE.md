# CLAUDE.md — weapon-battle

武器を持ったボール同士が戦うウェブアプリ（ブラウザで動く）。攻撃が当たるたびに武器の能力値が成長する。
ビルド不要の素の HTML / CSS / JavaScript（ES Modules）で、GitHub Pages で公開する。

**ユーザーへの返答・報告は日本語で。** 待ち時間や予定を書くときは日本時間を添える。公開URLなどはタップしてすぐ開ける形で書く。

## 構成

```
index.html, style.css     画面
src/engine.js             シミュレーション本体（DOM非依存。Nodeのテストからそのまま動く）
src/weapons.js            武器の定義（48種）。onHit で「当たったら成長」を書く
src/render.js             描画（低解像度キャンバスを拡大してドット絵風に）
src/sound.js              効果音（WebAudioで合成）
src/main.js               画面の操作・ループ
test/engine.test.js       ユニットテスト（node --test）
test/e2e.mjs              ブラウザテスト（Playwright。スクショを e2e-artifacts/ へ）
scripts/balance.mjs       総当たりの勝率表（バランス調整用）
```

## 開発の手順

1. 実装する。ロジックは `engine.js` / `weapons.js` に置き、DOMに依存させない。
2. テストを追加・更新する。
3. ローカルで確認する:
   - `npm test`（ユニットテスト。全組み合わせの決着・勝率10〜90%も見る）
   - `npm run e2e`（クラウド環境では `CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run e2e`）
   - 武器を足したり数値を変えたら `npm run balance` で勝率を確認する。
4. `main` に push すると GitHub Actions（`.github/workflows/ci.yml`）がテスト → `gh-pages` ブランチへ公開する。
5. Actions の結果と、公開URLで実際に新しい版が出ていることを確かめてから報告する。**確かめていないことを「できた」と言わない。**

## バランスの方針

- ユーザーの好み: 爆弾のように **当てるほど数が増えて、終盤にドパッと決まる（ローグライク風）** 成長が好き。強くなりすぎないよう、増え方（1回あたりの増加量・上限）と1発の威力で調整する。
- **成長に上限を付けない**（ユーザーの指示）。見た目や仕組みに限界がある値（周回玉の数・槍の長さなど）は `growStat(me, key, step, cap, over)` を使い、超えた分は「威力」（`ball.power`、その武器の与ダメージ倍率）として伸ばし続ける。画面には本当の値と「威力 ×n」が出る。
- 逆転が起きるように **逆境ブースト**（`engine.js` の `COMEBACK_BOOST`）: HPで負けている側は、当てたときにもう一度成長しやすい。
- 目安: `npm run balance 4` で全武器の勝率が おおむね 30〜70%、1試合 30〜60秒。`node scripts/comeback.mjs` で逆転勝ち（HP30以上の差をひっくり返した試合）の割合を見る（今は約13%）。

## URL パラメータ

`?a=sword&b=dagger&speed=4&autostart=1` で武器・速度・自動スタートを指定できる（テストや共有用）。武器IDは `src/weapons.js` の `id`。

## 引き継ぎ

作業の区切りごとに `HANDOFF.md` を更新して commit・push する。秘密情報は書かない。
