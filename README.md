# はろChat

HARO‑Chat は、Node.js を使って構築した軽量チャットアプリです。  
Redis を用いた構成と、Redis を使わない単一サーバ実装の両方を含んでいます。

---

## ディレクトリ構成

```
./
├─ No-Redis/
│   ├─ server.js
│   └─ package.json
├─ public/
│   ├─ index.html
│   ├─ main.js
│   ├─ socket.io.min.js
│   ├─ style.css
│   ├─ favicon-16x16.png
│   ├─ favicon-32x32.png
│   └─ favicon-96x96.png
├─ server.js
├─ package.json
├─ README.md
└─ LICENSE
```

---

## 動作環境とセットアップ

Node.js (v16 以上推奨) がインストールされた環境で動作します。

### 1. リポジトリをクローン
```bash
git clone https://github.com/Yosshy-123/HARO-Chat.git
cd HARO-Chat
```

### 2. 依存パッケージをインストール

```bash
npm install
```

### 3. 環境変数を設定

プロジェクトルートに `.env` を作成し、以下を記述します：

```env
# Redis を使う場合
REDIS_URL=redis://<ホスト>:<ポート>

# 任意
ADMIN_PASS=<管理者パスワード>
SECRET_KEY=<トークン用シークレットキー>
```

* `REDIS_URL` は **Redis サーバを使う場合のみ** 必要です。
* 単一サーバ実装（No‑Redis）では不要です。

---

## 起動方法

### Redis を使わない場合

```bash
node No‑Redis/server.js
```

### Redis を使う場合

Redis を使う場合は、.env の設定を行った上で通常のサーバを起動してください。

---

## デモ

アプリの動作デモはこちらからご覧いただけます：

[https://server-chat-suan.onrender.com/](https://server-chat-suan.onrender.com/)

---

## バグ報告・フィードバック

不具合や改善リクエストは **Issue の作成** または以下までご連絡ください：

*Yosshy_123@proton.me*

---

## ライセンス

このプロジェクトは **MIT ライセンス** のもとで公開されています。
