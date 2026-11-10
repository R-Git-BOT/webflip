# Cloudflare実行Adapter（開発中）

このパッケージはCloudflareアカウントを使わずに検証できる本番Adapterの最初の実装。

## 実装範囲

- Workers Static Assets、ルーム作成・参加・セッション・コマンド・退出APIのルーティング
- 1ルーム1Durable Object、SQLite-backed storage APIを使った状態・セッション保存
- 保存状態からのRoomEngine復元
- WebSocket Hibernation用接続受付、接続への権限別Snapshot配信
- 回答期限のAlarm
- R2への描画操作データ保存、参照管理、次ラウンド・退出・終了時の旧データ削除
- 設定、コマンド種別、描画座標・データ量の基本検証
- Wrangler設定（リソースは未作成、デプロイ未実施）

## 検証方法

リポジトリ直下の `pnpm test` で、保存・R2・Durable ObjectのFakeを使うHTTP契約テストを実行する。Cloudflareへ接続しない。既存ブラウザE2Eは引き続きローカルサーバーAdapterを対象とする。

## 公開前に必要な残作業

- Cloudflare公式型とWranglerによるバンドル・実行互換性確認
- WebSocket HibernationとAlarmのランタイム契約テストの拡充
- PNGとRedoスタックを含む描画保存契約への拡張
- R2保存失敗時の停止・復旧、未参照オブジェクト掃除、再試行可能な削除
- セッション終了・Cookie失効・終了済み情報5分保持
- ホスト切断時の停止・5分復帰、参加者接続状態、除外
- 放置警告・終了Alarm、状態リビジョンとコマンド冪等性
- IP試行制限、全リクエストのサイズ制限、ルームコード衝突時の再試行
- Discord OAuth
- Cloudflareステージングでの最小スモークテスト

現在の実装をそのまま一般公開しない。`pnpm build` のWorker処理はTypeScript型検査であり、Wranglerバンドルではない。
