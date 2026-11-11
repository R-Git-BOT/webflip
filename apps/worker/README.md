# Cloudflare実行Adapter

Workers Free、SQLite-backed Durable Objects、非公開R2 Standardバケットを使う匿名限定試用を配置済み。

公開URL: https://webflipper.shojoradi-pages.workers.dev

試用コード、公開・更新・停止、GitHub Actionsの範囲は[限定公開の運用](../../Docs/限定公開の運用.md)を参照。無料枠の予算と制約は[ADR 0006](../../Docs/ADR/0006-limited-free-trial.md)、確認した内容は[検証記録](../../Docs/限定公開の検証記録.md)に記載する。

## 実装範囲

- Static AssetsとHTTP API、ルームごとのDurable Object、状態・セッション永続化、Alarmによる期限管理。
- WebSocket Hibernation、権限ごとのSnapshot、最新の接続だけへの操作権、状態リビジョン、コマンド冪等性。
- ホスト復帰待ち、5分期限、参加者の切断時ロック、再接続時のUndo・Redo復元。
- PNGと描画操作履歴のR2保存、形式・サイズ・不透明性検証、変更のない描画の保存省略。
- 保存失敗時の停止・復帰・終了、未確定Blobの削除、削除失敗の再試行、Lifecycleによる取り残し対策。
- 試用コードの認証、入口と操作の試行制限、日次予算、データ量制限、失効したCookieの削除。

## 検証

通常のTDDはFakeのRoomStore/BlobBucketとFakeClockを使い、リモートCloudflareへ接続しない。

- `pnpm build:worker`: UIビルドとWrangler dry-run。アップロードしない。
- `pnpm test:e2e`: インメモリのローカルサーバーでホスト・参加者を検証。
- `pnpm test:worker:e2e`: UIビルド後、ローカルWranglerでDO/R2互換性と利用フローを検証。
- `pnpm test:trial:e2e`: 別のローカルWranglerで試用コード付きフロー、連続アクセス、不正なWebSocket送信を検証。

## 残る一般公開向け作業

同時20ルーム・合計100人の負荷検証、Discord OAuth、ホストによる除外のUI/API接続、放置終了前の警告、全対応端末・ブラウザの確認、実障害・長時間運用確認、自動デプロイ用のGitHub連携、ログ保持要件の整備。

今回の限定試用は、これらの全要件を満たした一般公開版とは扱わない。有料プランは有効化していない。
