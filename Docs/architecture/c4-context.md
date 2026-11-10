# C4 Level 1: システムコンテキスト

ホストと参加者から見たWebFlipperの責務、および唯一の外部サービスであるDiscordとの境界を示す。

```mermaid
C4Context
  title WebFlipper - システムコンテキスト

  Person(host, "ホスト", "ルームを作成し、お題、正解回答、進行を管理する")
  Person(participant, "参加者", "ルームへ参加し、Canvasへ手書き回答を作成する")

  System(webflipper, "WebFlipper", "手書き回答を集め、一斉提出、正解判定、結果公開を行うリアルタイムWebアプリ")
  System_Ext(discord, "Discord", "任意の本人識別、表示名、アバターを提供する")

  Rel(host, webflipper, "ルームを作成し、ラウンドを進行する", "HTTPS / WebSocket")
  Rel(participant, webflipper, "参加し、手書き回答を確定する", "HTTPS / WebSocket")
  Rel(webflipper, discord, "本人識別を要求する", "OAuth 2.0 identify")

  UpdateLayoutConfig($c4ShapeInRow="2", $c4BoundaryInRow="1")
```

## 境界

- ルームコードは参加先を特定する識別子であり、秘密情報ではない。
- ホスト・参加者の操作権はWebFlipper側のHttpOnly Cookieセッションで管理する。
- Discord連携は任意で、匿名参加も許可する。
- Discordは外部システムとして扱い、内部構造は図に含めない。

