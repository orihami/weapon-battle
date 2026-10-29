# ウェポンバトル オンライン用サーバー

別々のスマホで同じ部屋に入って遊ぶ(「📡 みんなでバトル」)ための、小さな中継サーバーです。
Node.js だけで動きます(追加のパッケージは要りません)。ラズパイ・NAS・パソコンのどれでも動かせます。

## 動かす

```sh
node server/server.js            # ポート 8787
PORT=9000 node server/server.js  # ポートを変えるとき
```

ブラウザで `http://<そのマシン>:8787/` を開いて `weapon-battle server: rooms 0` と出れば動いています。

## スマホからつなぐ

公開ページ(https://orihami.github.io/weapon-battle/)は https なので、サーバーも **wss://(暗号化)** でつなぐ必要があります。
自宅のラズパイなどで動かすときは、ポートを開けずに https の入口を作れる **Cloudflare Tunnel(無料)** がおすすめです。

1. サーバーのマシンに `cloudflared` を入れる
2. `cloudflared tunnel --url http://localhost:8787` を実行すると `https://〜.trycloudflare.com` のアドレスが出る(一時的なアドレス。ずっと同じアドレスにしたいときは Cloudflare のアカウントで名前付きトンネルを作る)
3. ゲームの「📡 みんなでバトル」→「サーバーの設定」に `wss://〜.trycloudflare.com` を入れる
   (または `https://orihami.github.io/weapon-battle/?server=wss://〜.trycloudflare.com` を開くと、最初から入る)

## ずっと動かしておく(systemd の例)

`/etc/systemd/system/weapon-battle.service`:

```ini
[Unit]
Description=weapon-battle online server
After=network.target

[Service]
ExecStart=/usr/bin/node /path/to/weapon-battle/server/server.js
Restart=always
User=pi

[Install]
WantedBy=multi-user.target
```

`sudo systemctl enable --now weapon-battle`

## しくみ

- 部屋は4文字のコード。1部屋 8人まで(試合に出るのは6人まで、ほかは見るだけ)。
- サーバーは部屋の中のメッセージを全員に配るだけです。試合の計算は各スマホがします(同じ「種」なら、どのスマホでもまったく同じ試合になる)。
- 送るもの: `create`(部屋を作る) / `join`(入る) / `msg`(部屋の全員へ)。くわしくは `server.js` の先頭のコメント。
- 今の遊び方: 各自が武器を選び、部屋を作った人(ホーム)が「バトル開始」を押すと、全員のスマホで同じ試合が始まる。
  このしくみ(部屋とリアルタイムの中継)を使って、あとで協力レイドや予想など別の遊び方も足せます。
