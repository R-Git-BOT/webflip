# C4 Level 2: 本番コンテナ

[ADR 0005](../ADR/0005-cloudflare-native-runtime.md)で決定したCloudflareネイティブの論理構成を示す。この図は目標構成であり、Cloudflare API・Durable Object・R2・Discord OAuth Adapterは未実装である。

```mermaid
C4Container
  title WebFlipper - 本番コンテナ構成

  Person(host, "ホスト", "ルームとラウンドを進行する")
  Person(participant, "参加者", "Canvasへ手書き回答を作成する")
  System_Ext(discord, "Discord", "任意のOAuth本人識別を提供する")

  System_Boundary(webflipper, "WebFlipper") {
    Container(spa, "Web UI", "React 19 / Vite 6", "ブラウザで描画、進行、結果表示を行うSPA")
    Container(edgeWorker, "Edge API", "Cloudflare Worker / TypeScript", "HTTP API、Cookieセッション、OAuth、入力検証、試行制限、ルーム振り分けを担う")
    Container(roomRuntime, "Room Runtime", "SQLite-backed Durable Object", "1ルーム単位でコマンドを直列化し、状態、期限、接続を管理する")
    ContainerDb(canvasStore, "Canvas Blob Store", "Cloudflare R2", "描画操作履歴と不透明PNGをルーム中だけ保存する")
  }

  Rel(host, spa, "ルームを作成し、ラウンドを進行する", "HTTPS")
  Rel(participant, spa, "回答を描画し、確定する", "HTTPS")
  Rel(spa, edgeWorker, "コマンド送信と状態購読を行う", "JSON/HTTPS + WebSocket")
  Rel(edgeWorker, roomRuntime, "認証済みコマンドと接続を振り分ける", "Durable Object RPC / WebSocket")
  Rel(roomRuntime, canvasStore, "描画履歴とPNGを保存・取得・削除する", "R2 API")
  Rel(edgeWorker, discord, "利用者情報を取得する", "OAuth 2.0 identify / HTTPS")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## 責務分担

- Web UIは残り時間を表示するが、ラウンド終了や全員確定を独自判断しない。
- Edge APIは外部入力と本人識別を扱い、ルームの進行規則を持たない。
- Room Runtimeがルーム状態と期限の唯一の正となる。
- R2にはCanvasの大きなデータだけを置き、Durable Objectには参照と小さなメタデータを保持する。
- D1、KV、PostgreSQL、Valkey、常設VM、Cloudflare ContainersはMVP構成に含めない。

