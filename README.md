# WebFlipper

ブラウザ上のCanvasへ手書きで回答し、ホストが一斉公開して正解を選ぶリアルタイムクイズです。

## Windowsで動かす

Node.jsとpnpmを用意し、リポジトリ直下で次を実行します。

```powershell
pnpm install
pnpm dev
```

- Web UI: http://127.0.0.1:5173/
- ローカルAPI: http://127.0.0.1:8787/

ローカル開発とテストはCloudflareへ接続せず、メモリ内のRoom Serviceを使います。プロセスを終了するとルームも消えます。

## 検証

```powershell
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

`pnpm test:e2e` はローカルサーバーを起動し、独立したホスト／参加者のブラウザ状態で1ラウンドを通して確認します。

## 1人でリアルタイム動作を調べる

`pnpm dev` を実行したまま、別のPowerShellでダミークライアントを起動できます。

```powershell
# ダミーホストを作り、表示された参加URLをブラウザで開く
pnpm dummy:host

# ブラウザで作ったルームへダミー参加者を入れる
pnpm dummy:participant -- K7M4PX ダミー太郎
```

ダミーホストは参加者が1人以上入ると、5つのお題を自動で進行します。提出後は回答を自動判定し、5問中ランダムな1問を「全回答正解」、別の1問を「正解者なし」にします。残る3問は回答ごとにランダム判定し、5問目の結果表示後にルームを終了します。

ダミー参加者は各ラウンドで2～5本のランダムな線を描き、ランダムな短い待ち時間の後に回答を確定します。複数のPowerShellから複数体起動できます。

どちらも自動運転中に `state` で現在状態、`help` で手動コマンド一覧、`quit` でプログラム終了ができます。

## 構成

全体像と本番・ローカルの差分は[構成図](./Docs/architecture/README.md)を参照してください。

- `packages/domain`: サーバー権威のRoomEngine
- `packages/canvas`: 描画履歴とUndo・Redo
- `packages/runtime`: ローカル用のメモリ内Adapter
- `apps/local-server`: Windowsで試せるHTTP/WebSocketサーバー
- `apps/web`: React/Vite UI

Cloudflare Adapterは `apps/worker` にあります。Workers Freeを使う匿名限定試用の設定・試用コードの扱い・停止方法は[限定公開の運用](./Docs/限定公開の運用.md)、制約と予算は[ADR 0006](./Docs/ADR/0006-limited-free-trial.md)を参照してください。Discord OAuthとGitHubからの自動デプロイは未設定です。
