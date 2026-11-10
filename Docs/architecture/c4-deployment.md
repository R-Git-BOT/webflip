# 本番デプロイ構成

一般公開MVPをCloudflareへ配置する目標構成を示す。Workers Paidプランを前提とするが、常設VMや外部データベースは持たない。

```mermaid
C4Deployment
  title WebFlipper - 本番デプロイ構成（Cloudflare）

  Deployment_Node(client, "利用者端末", "PC / スマートフォン / タブレット") {
    Deployment_Node(browser, "Webブラウザ", "Chrome / Edge / Firefox / Safari") {
      Container(spa, "Web UI", "React 19", "Canvas描画とルームUIを実行する")
    }
  }

  Deployment_Node(cloudflare, "Cloudflare Global Network", "Managed Cloud") {
    Deployment_Node(staticAssetsNode, "Workers Static Assets", "Edge Static Hosting") {
      Container(staticAssets, "Web Assets", "HTML / CSS / JavaScript", "Viteの本番成果物を配信する")
    }
    Deployment_Node(workersNode, "Workers Runtime", "V8 Isolates") {
      Container(edgeWorker, "Edge API", "TypeScript Worker", "HTTP、OAuth、Cookie、検証、ルーティングを処理する")
    }
    Deployment_Node(durableObjectsNode, "Durable Objects", "SQLite-backed / 1 room = 1 object") {
      Container(roomRuntime, "Room Runtime", "TypeScript + RoomEngine", "ルーム状態、WebSocket、Alarmを管理する")
    }
    Deployment_Node(r2Node, "R2", "Object Storage") {
      ContainerDb(canvasStore, "Canvas Blob Store", "Drawing history + PNG", "ルーム中のCanvasデータを一時保存する")
    }
  }

  System_Ext(discord, "Discord", "OAuth 2.0 identify provider")

  Rel(spa, staticAssets, "画面資産を取得する", "HTTPS")
  Rel(spa, edgeWorker, "APIコマンドを送信する", "JSON/HTTPS")
  Rel(spa, edgeWorker, "リアルタイム状態を購読する", "WebSocket")
  Rel(edgeWorker, roomRuntime, "対象ルームへ振り分ける", "Durable Object RPC / WebSocket")
  Rel(roomRuntime, canvasStore, "Canvasデータを保存・取得・削除する", "R2 API")
  Rel(edgeWorker, discord, "任意の本人識別を行う", "OAuth 2.0 / HTTPS")

  UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")
```

## 運用上の性質

- WebSocketがアイドル中はHibernationを使い、常時実行時間を抑える。
- Durable Object Alarmが回答期限、5分のホスト復帰期限、2時間の放置終了、終了後データ削除を扱う。
- ルーム終了または次ラウンド移行時に、不要なR2オブジェクトを明示的に削除する。
- ログへお題、参加者名、Canvas、Discordアクセストークン、Cookie秘密情報を記録しない。

