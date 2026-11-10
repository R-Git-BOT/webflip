# C4 Level 3: ルーム実行基盤

Room Runtime内で、Cloudflare固有処理を深い`RoomEngine` Moduleの外側へ閉じ込める構成を示す。`RoomEngine`は実装済みで、その他のCloudflare Adapterは目標構成である。

```mermaid
C4Component
  title WebFlipper - Room Runtimeコンポーネント

  Container(edgeWorker, "Edge API", "Cloudflare Worker / TypeScript", "認証済みコマンドを対象ルームへ送る")
  ContainerDb(canvasStore, "Canvas Blob Store", "Cloudflare R2", "描画操作履歴とPNGを一時保存する")

  Container_Boundary(roomRuntime, "Room Runtime - Durable Object") {
    Component(commandHandler, "Room Command Handler", "TypeScript", "コマンドを検証し、状態遷移と保存を一度だけ調停する")
    Component(roomEngine, "RoomEngine", "@webflipper/domain", "参加資格、ラウンド、一斉提出、正解公開を決定する")
    Component(stateStore, "Room State Store", "Durable Object SQLite Adapter", "状態、セッション、受理結果、リビジョンを保存する")
    Component(connectionHub, "Connection Hub", "WebSocket Hibernation Adapter", "接続を管理し、権限別Snapshotを配信する")
    Component(deadlineScheduler, "Deadline Scheduler", "Durable Object Alarm Adapter", "回答期限、復帰期限、放置終了、削除期限を発火する")
    Component(blobAdapter, "Canvas Blob Adapter", "R2 Adapter", "描画データを検証してR2へ保存・削除する")
  }

  Rel(edgeWorker, commandHandler, "認証済みコマンドを送る", "Durable Object RPC")
  Rel(commandHandler, stateStore, "状態とコマンド受理結果を読み書きする", "SQLite API")
  Rel(commandHandler, roomEngine, "現在状態へコマンドを適用する", "TypeScript Interface")
  Rel(commandHandler, connectionHub, "権限別Snapshotを配信する", "WebSocket Hibernation API")
  Rel(commandHandler, deadlineScheduler, "次の期限を登録・解除する", "Alarm API")
  Rel(commandHandler, blobAdapter, "下書きと確定回答の保存を依頼する", "BlobStore Interface")
  Rel(blobAdapter, canvasStore, "描画操作履歴とPNGを保存・取得・削除する", "R2 API")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## テスト境界

通常のTDDではCloudflareへ接続しない。`Room State Store`、`Connection Hub`、`Deadline Scheduler`、`Canvas Blob Adapter`をインメモリFakeへ交換し、公開Interfaceから状態、イベント、期限、エラーを検証する。

