# Whiteboard

エレベーターピッチ
- １秒で適当な概念図を描き始めて議論をしたい
- ソフトウェア開発者向けの、
- Whiteboard というプロダクトは、
- オンライン共同編集アプリです。
- これは直感的かつ雑念の入る余地のない最低限の操作ができ、
- Google Jamboard とは違って、
- Slack コマンドから一瞬でログインできる仕組みが備わっている。

部屋仕様
- 1 時間誰も編集しないと部屋の接続が全て切れる
- 1 日経つと部屋が編集不可になる(deactivate)
- 1 週間経つと部屋が消える
- active な部屋は同時に 10 個まで
- 部屋に入れる人数は 10 人まで
- 同じ人が複数接続したら最後の接続以外が切れる
- 同じアカウントでもブラウザが違えば別人として扱われる

UI
- draw(drag)
- add text(double click)
- select(ctrl+click or ctrl+drag)
- move(drag) -> unselect
- remove(backspace) -> unselect
- undo(ctrl+Z)
- redo(ctrl+Y)

参考
- https://github.com/cloudflare/workers-chat-demo
- https://developers.cloudflare.com/workers/tutorials/build-a-slackbot
- https://developers.cloudflare.com/workers/platform/pricing
- https://developers.cloudflare.com/analytics/graphql-api/
- https://graphql.org/learn/introspection/

TODO:
- ログアウト or revoke
- HTML と JSON を正しく返し分ける
- manager の負荷を減らす（config の問い合わせも無駄）
- Storage と無駄に大きいオブジェクトをやりとりしている
- Durable Objects 完全に消したい
- 参加人数が多い時のアイコン表示
- iPhone からログイン直後に Something went wrong
- RateLimit 復活する？
- Firefox と Safari でテキストがややずれる
- デプロイ方法を確認
- GitHub auth のアイコン
- GitHub auth で org を optional に
- GitHub 要らない説
- dev 環境
- 有効期限を表示
- ogp
- コマンドのヘルプ
- HTML のテンプレート化

メモ：
- logo のフォントは Verdana


## Deploy

未確認

1. Cloudflare アカウントを用意、 Workers と Durable Objects を使える状態にする（有料プラン）
1. wrangler.toml の `account_id` を更新
1. `npm ci`
1. `npx wrangler login`
1. `npx wrangler publish`
1. Slack アプリを作る
   - Slash command
      - `/wb`: `https://whiteboard.{}.workers.dev/app/slack`
   - OAuth
      - Redirect URL: `https://whiteboard.{}.workers.dev/callback/slack`
      - Bot Token Scopes: `commands`
      - User Token Scopes: `identity.avatar`, `identity.basic`
1. Slack アプリをワークスペースにインストール
1. `npx wrangler secret put <name>`
   - AUTH_TYPE: `slack`
   - COOKIE_SECRET: `xxxxxxx`
   - DEBUG_API: `false`
   - SLACK_APP: `true`
   - SLACK_CLIENT_ID: `xxxxx`
   - SLACK_CLIENT_SECRET: `xxxxx`
   - SLACK_SIGNING_SECRET: `xxxxx`
