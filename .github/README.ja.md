# KAeRU Log

[Read in English](README.md)

---

KAeRU Log は、Node.js を使って構築した軽量チャットアプリです。  

---

## ディレクトリ構成

```
./
├─ .github/
│   ├─ README.md
│   └─ README.ja.md
├─ public/
│   ├─ index.html
│   ├─ main.js
│   ├─ socket.io.min.js
│   ├─ style.css
│   ├─ logo.png
│   ├─ favicon-16x16.png
│   ├─ favicon-32x32.png
│   └─ favicon-96x96.png
├─ server.js
├─ package.json
└─ LICENSE
```

---

## 動作環境とセットアップ

Node.js (v22 以上推奨) がインストールされた環境で動作します。

### 1. リポジトリをクローン
```bash
git clone https://github.com/Yosshy-123/KAeRU-Log.git
cd KAeRU-Log
```

### 2. 依存パッケージをインストール

```bash
npm install
```

### 3. 環境変数を設定

プロジェクトルートに `.env` を作成し、以下を記述します：

```env
REDIS_URL=redis://<ホスト>:<ポート>

# 任意（推奨）
ADMIN_PASS=<管理者パスワード>
SECRET_KEY=<トークン用シークレットキー>
```

`REDIS_URL` は **必ず定義して** ください。

---

## 起動方法

.env の設定を行った上で以下の方法でサーバー起動してください。

```bash
node server.js
```

---

## デモ

アプリの動作デモはこちらからご覧いただけます。

[https://kaeru-log.onrender.com](https://kaeru-log.onrender.com)

---

## 記事

KAeRU Logの紹介記事はこちらからご覧いただけます。

[https://qiita.com/Yosshy_123/items/fa7289905f2fca60e450](https://qiita.com/Yosshy_123/items/fa7289905f2fca60e450)

---

## バグ報告・フィードバック

不具合や改善リクエストは **Issue の作成** または *Yosshy_123@proton.me* までご連絡ください。

---

## ライセンス

このプロジェクトは **MIT ライセンス** のもとで公開されています。
