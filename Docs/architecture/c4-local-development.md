# ローカル開発構成

Windows上で現在実装済みの構成を示す。CloudflareサービスやDiscordへ接続せず、プロセス終了時にルーム状態も失われる。

```mermaid
C4Container
  title WebFlipper - ローカル開発構成（実装済み）

  Person(host, "ホスト", "ブラウザからルームを作成して進行する")
  Person(participant, "参加者", "別のブラウザ状態からルームへ参加する")

  System_Boundary(webflipperLocal, "WebFlipper Local") {
    Container(spa, "Web UI", "React 19 / Vite 6 Dev Server :5173", "ブラウザでCanvasと進行画面を表示する")
    Container(localServer, "Local Fake Server", "Node.js / HTTP / ws :8787", "HTTP API、Cookie、WebSocket、期限監視を提供する")
    ContainerDb(processMemory, "Process Memory", "Map / in-memory Adapter", "RoomEngine、セッション、回答を一時保持する")
  }

  Rel(host, spa, "ルームを作成し、ラウンドを進行する", "HTTP")
  Rel(participant, spa, "参加し、回答を描画する", "HTTP")
  Rel(spa, localServer, "コマンド送信と状態購読を行う", "JSON/HTTP + WebSocket")
  Rel(localServer, processMemory, "ルームとセッションを読み書きする", "@webflipper/runtime")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## 実装対応

- `apps/web`: Web UI
- `apps/local-server`: Local Fake Server
- `packages/runtime`: インメモリRoom Service Adapter
- `packages/domain`: `RoomEngine`
- `packages/canvas`: 描画操作履歴とUndo・Redo

