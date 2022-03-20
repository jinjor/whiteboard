# Develop

## 主なコマンド

- `npm install`
- `npm run generate-schema`
- `npm run dev`
- `npm test`
- `npm run analytics`
- `npx wrangler secret put <name>`
- `npx wrangler publish`

## 環境変数

- 認証・認可・セッション
  - AUTH_TYPE: github | slack | user_agent | header
  - GITHUB_CLIENT_ID: xxxxx
  - GITHUB_CLIENT_SECRET: xxxx
  - GITHUB_ORG: xxxx
  - SLACK_CLIENT_ID: xxxx
  - SLACK_CLIENT_SECRET: xxxx
  - COOKIE_SECRET: xxxx
- Slack アプリ
  - SLACK_APP: true | false
  - SLACK_SIGNING_SECRET: xxxx
- デバッグ
  - DEBUG_API: true | false
- オペレーション
  - ADMIN_KEY=xxxx
  - ACCOUNT_ID=xxxx
  - SCRIPT_NAME=whiteboard
  - CLOUDFLARE_API_TOKEN=xxxx
  - ORIGIN=https://whiteboard.xxxx.workers.dev

## エレベーターピッチ

- １秒で適当な概念図を描き始めて議論をしたい
- ソフトウェア開発者向けの、
- Whiteboard というプロダクトは、
- オンライン共同編集アプリです。
- これは直感的かつ雑念の入る余地のない最低限の操作ができ、
- Google Jamboard とは違って、
- Slack コマンドから一瞬でログインできる仕組みが備わっている。

## 部屋仕様

- 1 時間誰も編集しないと部屋の接続が全て切れる
- 1 日経つと部屋が編集不可になる(deactivate)
- 1 週間経つと部屋が消える
- active な部屋は同時に 10 個まで
- 部屋に入れる人数は 10 人まで
- 同じ人が複数接続したら最後の接続以外が切れる
- 同じアカウントでもブラウザが違えば別人として扱われる

## UI

| Operation | Mouse and Keyboard           | Touch           |
| :-------- | :--------------------------- | :-------------- |
| Draw path | Drag                         | Drag            |
| Add text  | Double click                 | Long tap        |
| Select    | Right drag                   | Button & Drag   |
| Move      | Select & Drag                | Select & Drag   |
| Remove    | Select & Backspace           | Select & Button |
| Undo      | Ctrl + Z                     | Button          |
| Redo      | Ctrl + Y or Ctrl + Shift + Z | Button          |

## 参考

- https://github.com/cloudflare/workers-chat-demo
- https://developers.cloudflare.com/workers/tutorials/build-a-slackbot
- https://developers.cloudflare.com/workers/platform/pricing
- https://developers.cloudflare.com/analytics/graphql-api/
- https://graphql.org/learn/introspection/

## Etc.

- logo のフォントは Verdana
