# はろChat

このプロジェクトは、`Node.js`を使用した軽量チャットアプリです。

`No-Redis`フォルダ内には、`Redis`を使用しないサーバー実装 (`server.js`) と `package.json` が含まれています。

## 環境変数

プロジェクトを実行するには、以下の環境変数を `.env` ファイルに設定してください。

* `REDIS_URL` （Redisを使用する場合に必要）

さらに、以下の環境変数を設定しておくことが推奨されます。

* `ADMIN_PASS` （管理者パスワード）
* `SECRET_KEY` （トークン生成用の秘密鍵）

## デモ

[デモサイト](https://server-chat-suan.onrender.com/)

## フィードバック

ご意見やご質問がある場合は、*Yosshy_123@proton.me* までご連絡ください。
