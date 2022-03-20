# Whiteboard

Slack コマンド `/wb` でホワイトボードを作って共同編集。

## Deploy

1. Cloudflare アカウントを用意、 Workers と Durable Objects を使える状態にする（有料プラン）
1. このリポジトリをクローン
1. wrangler.toml の `account_id` を更新
1. `npm ci`
1. `npx wrangler login`
1. `npx wrangler publish`
1. `npx wrangler secret put <name>`
   - DEBUG_API: `false`
   - SLACK_APP: `true`

### Slack アプリの設定

最低限、以下を設定（任意で各種説明やアイコン `logo.png` などを設定）

1. Slack アプリを作る
1. Slash コマンドを設定
  - Command: `/wb`
  - Request URL: `https://whiteboard.{}.workers.dev/app/slack`
1. Slack アプリをワークスペースにインストール
1. `npx wrangler secret put <name>`
   - SLACK_SIGNING_SECRET: `xxxxx`

### GitHub 認証の設定

1. GitHub アプリを作る
   - Redirect URL: `https://whiteboard.{}.workers.dev/callback/github`
1. `npx wrangler secret put <name>`
   - AUTH_TYPE: `github`
   - COOKIE_SECRET: `xxxxxxx`
   - GITHUB_CLIENT_ID: `xxxxx`
   - GITHUB_CLIENT_SECRET: `xxxxx`
   - GITHUB_ORG: `xxxxx`

### Slack 認証の設定

制限: ユーザーはあらかじめブラウザでワークスペースにログインしている必要あり

1. Slack アプリの OAuth 設定:
   - Redirect URL: `https://whiteboard.{}.workers.dev/callback/slack`
   - Bot Token Scopes: `commands`
   - User Token Scopes: `identity.avatar`, `identity.basic`
1. `npx wrangler secret put <name>`
   - AUTH_TYPE: `slack`
   - COOKIE_SECRET: `xxxxxxx`
   - SLACK_CLIENT_ID: `xxxxx`
   - SLACK_CLIENT_SECRET: `xxxxx`
