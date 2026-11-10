# Cloudflare実行Adapter（開発中）

Cloudflare Freeでの試用公開を目標に開発中。通常のTDDはFake、実行互換性確認はWranglerローカル環境で行い、CloudflareのアカウントやリモートBindingへ接続しない。

## 実装範囲

- Workers Static Assets、ルーム作成・参加・セッション・コマンド・退出APIのルーティング
- 1ルーム1Durable Object、SQLite-backed storage APIを使った状態・セッション保存
- 保存状態からのRoomEngine復元
- WebSocket Hibernation用接続受付、接続への権限別Snapshot配信
- 回答期限のAlarm
- ホスト切断時の回答ロックとタイマー停止、5分以内の復帰、期限超過時の終了
- 2時間放置後の終了、終了5分後のルーム・セッション削除
- 再読み込み後のUndo・Redo履歴復元（描画操作とRedoスタックを保存）
- 参照時の不要な保存処理を削減、保存失敗時の未確定Blob削除
- R2への描画操作データ保存、参照管理、次ラウンド・退出・終了時の旧データ削除
- 設定、コマンド種別、描画座標・データ量の基本検証
- Wrangler設定（リソースは未作成、デプロイ未実施）
- Cloudflare公式型定義での型検査とWrangler dry-runバンドル

## 検証方法

リポジトリ直下の `pnpm test` は保存・R2・Durable ObjectのFakeとFakeClockで契約を検証する。各機能はテストのRedを確認してから実装。

- `pnpm build:worker`: UIビルドとWrangler dry-run。アップロードしない。
- `pnpm test:e2e`: 従来のインメモリサーバー上でブラウザ検証。
- `pnpm test:worker:e2e`: UIビルド後に実行。Wranglerをローカル起動し、Workers・DO・R2エミュレーションを通してブラウザ検証。リモート接続なし。

両E2Eで、ホスト・参加者の入退出、描画・Undo・保存・再読み込み・Redo、確定・結果公開、モバイルの入口を確認する。ホストの実回線断検出タイミングと実ハイバネーションはステージング未確認。

## 公開前に必要な残作業

- WebSocket HibernationとAlarmのランタイム契約テストの拡充
- PNG保存とサーバー側の形式・サイズ・不透明性検証
- R2保存失敗時の停止・復旧、未参照オブジェクト掃除、再試行可能な削除
- Cookie削除、期限後のストレージ完全消去
- 古い接続からのHTTP操作拒否、参加者自身の切断時ロック、除外
- 放置終了5分前の警告、状態リビジョンとコマンド冪等性
- IP試行制限、全リクエストのサイズ制限、ルームコード衝突時の再試行
- Discord OAuth
- Cloudflareステージングでの最小スモークテスト

現在の実装をそのまま一般公開しない。`pnpm build` のWorker処理は型検査、`pnpm build:worker` はWranglerバンドルも実行する。Paidの有効化や実リソース作成は行っていない。
