# ADR 0006: 無料枠での匿名限定試用

- Status: Accepted
- Date: 2026-11-10

## Decision

利用者の「無料プランで、匿名参加の限定公開まで進める」という決定に合わせ、最初の公開を次の範囲に限定する。Workers Paidへ変更しない。Discord連携は今回の公開対象外とする。

- 共通の試用コードを知る利用者だけがAPIとWebSocketへアクセスできる。ルームコードとは別の秘密情報とする。
- 試用コードの認証は24時間有効な署名付きHttpOnly/Secure/SameSite Cookieとし、Secretの変更で既存の認証も無効化する。
- 同時利用はアプリ全体で1ルーム、参加者最大15人。ルームは作成から最大2時間で終了する。この絶対期限は限定試用の追加制約であり、当初の20ルーム・合計100人の性能目標の達成を示すものではない。
- API受付はアプリ全体で1日10,000回、R2読み取り予約10,000回、書き込み予約1,000回まで。R2失敗時も予約を消費し、UTC日付変更でリセットする。
- 試用ブラウザごとに再読込相当10回/分、変更操作120回/分、参加20回/分、作成5回/10分。入口はIPごと1,200回/分、試用コード照合5回/分。入口のIP制限はCloudflareの分散した概算制限、日次予算は1個のDurable Objectで直列化する厳密な予約とする。
- 1リクエスト約1.1MB、描画データJSON 1MB、PNG data URL 350,000文字まで。PNGは1024×768の不透明画像に限定し、形式・CRC・展開後サイズ・透明度を検証する。
- 履歴とPNGは同じR2 JSONオブジェクトに保存し、保存が完了するまで確定扱いにしない。変更のない描画の再保存と、下書き変更の全員への配信を避ける。
- R2は非公開のStandardバケットとし、通常の次ラウンド・終了時に削除する。失敗した削除はAlarmで再試行し、取り残されたオブジェクトには1日のLifecycleを適用する。Lifecycleの削除時刻は厳密な即時削除保証ではない。
- 保存失敗が3秒続いたら進行とCanvasを停止し、保存機能の復旧後に残り時間から再開する。最初の失敗から1分で復旧しなければ終了する。ホスト切断との重複時も一方が復帰しただけでは進行しない。
- 同一セッションの操作権は最新のWebSocket接続だけに与える。コマンドには冪等性キー、ラウンド識別子を付け、画面には古いリビジョンを適用しない。

## Limits

拒否した通信もWorkerの起動回数には含まれる。したがって、この制限はインターネットからの全トラフィックを無料枠到達前に遮断する保証ではない。Workers/DOのFree上限に達すると利用できなくなる。R2の無料枠はアカウント内の他用途とも共有されるため、他用途の消費量は本アプリの予算では管理できない。

R2書き込みは31日でも31,000回以下、読み取りは310,000回以下を目安に抑える。オブジェクト最大約1MBと日次書き込み上限、通常削除とLifecycleで保存量も抑える。課金ゼロの絶対保証や、限定試用を超える負荷保証は行わない。

## References

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [R2 object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
