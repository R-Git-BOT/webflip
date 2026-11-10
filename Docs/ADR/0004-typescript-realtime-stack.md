# TypeScriptによるリアルタイムWeb構成を採用する

MVPはReact＋ViteのSPA、Node.js 24 LTS＋Fastifyのサーバー、Socket.IO、ValkeyをTypeScriptの単一リポジトリで実装する。常時接続とサーバー権威の状態遷移を明示的に扱いつつ、クライアント・サーバー間の通信契約を共有し、1台のLinuxサーバーから将来の複数インスタンス構成へ移行しやすくするためである。

## Status

Superseded by ADR 0005 — 2026-10-10

## Considered Options

- Next.js中心の構成は、SSRを必要としないMVPに対して常時接続サーバーとの責務が曖昧になりやすいため採用しない。
- 生のWebSocketは、再接続、受理応答、ルーム配信を独自実装する範囲が広いため採用しない。
- PostgreSQLは、永続アカウントや履歴を持たないMVPでは不要なため導入しない。
- 外部の共有ストアサービスは、MVPで有料依存を増やさないため使用しない。

## Consequences

- Socket.IOの標準到達保証だけには依存せず、コマンドID、受理結果、状態リビジョン、再接続時の完全同期をWebFlipper側で実装する。
- Valkeyは永続化せず、すべてのキーへ有効期限を設定する。再起動後にルームを復元しない製品仕様を維持する。
- pnpm workspace内の `packages/domain` を深いModuleとし、HTTP、Socket.IO、ValkeyをAdapterとして外側へ置く。
