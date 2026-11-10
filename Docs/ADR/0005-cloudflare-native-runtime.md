# Cloudflareネイティブの実行基盤を採用する

## Status

Accepted — 2026-10-10

2026-11-10追記: 利用者の決定により、最初の試用公開はWorkers FreeとR2 Standardの無料枠で進める。Paidへの変更は行わず、無料枠での負荷検証後に必要性を判断する。以下のPaid前提の記述は初期決定の記録として残す。

## Context

WebFlipperは、同時20ルーム・参加者合計100人を初期目標とするリアルタイムWebアプリである。利用者はアプリ全体をオンプレミスや常設VMではなくクラウド上で管理し、MVPの固定費と運用負担を小さくしたい。

各ルームでは、確定、退出、除外、期限到来などの競合を1回だけ処理する必要がある。また、WebSocket接続がない時間にも5分のホスト復帰期限や2時間の放置終了を管理し、Canvasの下書きと確定画像を一時保存する必要がある。

## Decision

- ReactとViteで構築したSPAをWorkers Static Assetsで配信する。
- TypeScriptのCloudflare WorkerをHTTP、Discord OAuth、Cookieセッション、入力検証、試行回数制限、ルームへのルーティングを担うAdapterとする。
- 1ルームにつきSQLite-backed Durable Objectを1つ割り当てる。Durable Object内で深い `RoomEngine` Moduleを呼び出し、コマンドを直列化し、状態、セッション、期限、コマンド受理結果、状態リビジョンを保存する。
- リアルタイム通信にはDurable ObjectsのWebSocket Hibernation APIを使用し、Socket.IOは使用しない。ハイバネーション後の再開時はメモリではなく保存済み状態からルームを再構築する。
- Canvasの描画操作履歴とPNG画像はR2へ保存する。Durable ObjectにはR2の参照と小さなメタデータだけを保持する。
- 回答期限、ホスト復帰期限、放置警告・終了、終了済み情報の削除はDurable Object Alarmで管理する。Alarm処理は再実行されても安全なImplementationにする。
- `RoomEngine` はCloudflare APIから独立したModuleとし、運用時のDurable Object・R2 Adapterとテスト時のメモリAdapterを交換できるSeamを維持する。
- 通常のテスト駆動開発ではCloudflareへ接続せず、保存、期限、接続、セッション、一時バイナリ保存をインメモリのFake Adapterへ置き換える。Cloudflare実環境のスモークテストはリリース確認として分離する。
- D1、KV、PostgreSQL、Valkey、常設VM、Cloudflare ContainersはMVPの実行基盤に使用しない。
- 開発・試用は無料枠で行えるようにし、一般公開するMVPはWorkers Paidプランを前提とする。

## Considered Options

- Linux VM上のNode.js、Fastify、Socket.IO、Valkey、Caddy構成は、自由度は高いが、OS、TLS、プロセス、バックアップ不要な一時ストアを自ら運用する必要があるため採用しない。
- Cloudflare Containersは既存サーバー構成を持ち込めるが、今回の小規模MVPでは常駐コンテナの費用と運用が増え、Durable Objectsのルーム単位の直列化を活かしにくいため採用しない。
- Workerと外部マネージドRedisを組み合わせる構成は、別サービスの固定費、認証、ネットワーク、障害点が増えるため採用しない。
- Durable Object内へCanvas画像を直接保存する構成は、SQLiteの1行・値サイズ上限とCanvasの上限が近く、状態更新と大きなバイナリを同じ保存面へ集中させるため採用しない。

## Consequences

- 常設サーバーを管理せず、静的配信、リアルタイム状態、期限処理、一時オブジェクト保存をCloudflare内で完結できる。
- 1ルーム内のコマンド順序付けと状態遷移が1つのDurable Objectへ局所化され、複数アプリサーバー間の配信調停が不要になる。
- WebSocketがアイドル状態の間はHibernationを利用でき、常時実行時間の課金を抑えられる。
- 明示的終了、次ラウンド、退出・除外、期限到来時のR2とDurable Objectの削除が重要な運用要件になる。
- Cloudflare固有APIへの依存が生じる。ただし、進行規則を `RoomEngine`、外部技術をAdapterへ分けることで依存を実行時境界へ局所化する。
- R2の自動保存回数が従量課金へ影響するため、保存間隔、オブジェクト構成、書き込み回数を実装前に負荷試験で確認する必要がある。

## References

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Durable Objects WebSockets best practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
