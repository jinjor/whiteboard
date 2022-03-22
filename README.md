# Whiteboard

Slack コマンドでホワイトボードを作って共同編集。

- `/wb`: 部屋を作る
- `/wb status`: 状態を取得

## Deploy

以下は production 環境にデプロイする前提。

1. Cloudflare アカウントを用意、 Workers と Durable Objects を使える状態にする（有料プラン）
1. このリポジトリをクローン
1. wrangler.toml の `account_id` を更新
1. `npm ci`
1. `npx wrangler login`
1. `npx wrangler publish --env production`
1. `npx wrangler secret put --env production <name>`
   - DEBUG_API: `false`
   - SLACK_APP: `true`

### Slack アプリの設定

最低限、以下を設定（任意で各種説明やアイコン `logo.png` などを設定）

1. Slack アプリを作る
1. Slash コマンドを設定
   - Command: `/wb`
   - Request URL: `https://whiteboard.{}.workers.dev/app/slack`
1. Slack アプリをワークスペースにインストール
1. `npx wrangler secret put --env production <name>`
   - SLACK_SIGNING_SECRET: `xxxxx`

### 認証の設定

以下のどちらかを設定する。

#### GitHub 認証の設定

1. GitHub アプリを作る
   - Redirect URL: `https://whiteboard.{}.workers.dev/callback/github`
1. `npx wrangler secret put --env production <name>`
   - AUTH_TYPE: `github`
   - COOKIE_SECRET: `xxxxxxx`
   - GITHUB_CLIENT_ID: `xxxxx`
   - GITHUB_CLIENT_SECRET: `xxxxx`
   - GITHUB_ORG: `xxxxx`

#### Slack 認証の設定

1. Slack アプリの OAuth 設定:
   - Redirect URL: `https://whiteboard.{}.workers.dev/callback/slack`
   - Bot Token Scopes: `commands`
   - User Token Scopes: `identity.avatar`, `identity.basic`
1. Slack アプリを public distribution する
1. `npx wrangler secret put --env production <name>`
   - AUTH_TYPE: `slack`
   - COOKIE_SECRET: `xxxxxxx`
   - SLACK_CLIENT_ID: `xxxxx`
   - SLACK_CLIENT_SECRET: `xxxxx`
   - SLACK_TEAM_DOMAIN: `xxxxx`

### 環境変数の一括設定

`.env.production` に変数を書く

```
DEBUG_API=false
SLACK_APP=true
...
```

以下のコマンドで同期する

```shell
npm run sync-env -- production
```
