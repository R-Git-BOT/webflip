# Discord連携の設定

Discord Developer PortalでWebFlipperアプリのOAuth2 Redirectsへ、次のURLを登録する。

`https://webflipper.shojoradi-pages.workers.dev/api/discord/callback`

WorkerのClient IDとRedirect URIは`apps/worker/wrangler.jsonc`で管理する。Client SecretはGitやチャットへ記載しない。CloudflareのWorkers & Pagesで`webflipper`のSettings → Variables and Secretsを開き、Secretとして`DISCORD_CLIENT_SECRET`を追加し、Deployする。DiscordのClient Secretが手元にない場合は、Discord Developer Portalで所有者が再生成して設定する。

Workerへの通常の`wrangler deploy --secrets-file`は、ファイルに含まれない既存Secretを保持する。ローカルの自動テストはDiscordとCloudflareへ接続せず、Discord応答と保存先をStub/Fakeで置き換える。

認証はOAuth 2.0 authorization codeと`identify`のみを使用する。状態は同一ブラウザに結び付け、1回限りで使用する。認証直後の一時データはサーバー側に最大5分保存し、ルームの作成・参加時には消費する。未使用分は期限切れ後にAlarmで削除する。Discord IDはルーム内のセッションに保持し、ルーム終了時に削除する。OAuthアクセストークンは本人情報の取得後に保存しない。

最初の限定試用では、匿名参加と同様に試用コードが必要。既存の無料枠およびレート制限を適用し、Discordログインに必要な通信も予算に含める。
