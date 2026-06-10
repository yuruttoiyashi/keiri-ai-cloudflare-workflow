# Keiri AI Cloudflare Workflow MVP

AI × Cloudflare を使った、経理業務改善アプリのMVPです。

## できること

- 取引先・摘要・金額から、Workers AI が勘定科目と消費税区分を提案
- 登録前に、税区分未設定・高額会議費・摘要不足などを警告
- D1 に仕訳とAI判定結果を保存
- 要確認フラグ付きの仕訳だけを監査キューで確認
- CSV出力
- CSVファイルの1行目から仕訳ドラフトを作成

## 初回セットアップ

```powershell
npm config set registry https://registry.npmjs.org/
npm install
```

Cloudflareへログインします。

```powershell
npx wrangler login
```

## D1を作成

```powershell
npm run d1:create
```

表示された `database_id` を `wrangler.toml` に貼り付けます。

```toml
[[d1_databases]]
binding = "DB"
database_name = "keiri-ai-workflow-db"
database_id = "ここに貼り付け"
```

D1のテーブルを作成します。

```powershell
npm run d1:local
npm run d1:remote
```

## ローカルでAI付きMVPとして動かす

ターミナルを2つ開きます。

### ターミナル1：Cloudflare Worker API

```powershell
npm run api:dev:ai
```

### ターミナル2：React画面

```powershell
npm run dev
```

画面は通常どおり以下で開きます。

```text
http://localhost:5173/
```

APIが接続されると、画面上部に `AI ON` / `D1 ON` が表示されます。

## デプロイ

```powershell
npm run deploy
```

この構成は、Cloudflare Workers Static Assets を使い、Reactの静的ファイルとAPI Workerを1つのWorkerとして公開します。

## 注意

画像/PDFのOCRは次フェーズ想定です。現在のMVPでは、CSVは実データからドラフト化し、画像/PDFはファイル名から仮ドラフトを作成します。
Workers AIによる仕訳判定・保存前チェック・D1保存までをMVPの完成範囲にしています。
