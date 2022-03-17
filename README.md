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
- https://github.com/cloudflare/durable-objects-typescript-rollup-esm
- https://github.com/cloudflare/durable-objects-template
- https://github.com/cloudflare/durable-objects-rollup-esm
- https://github.com/cloudflare/durable-objects-webpack-commonjs
- https://developers.cloudflare.com/workers/tutorials/build-a-slackbot

TODO:
- エッジケースのバグ除去
  - 画面外で mouse up しても選択が終了しない => 終了させる
    - 画面に戻ってきて左クリックすると選択範囲が残る
  - ドラッグ中のオブジェクトが移動されたり消されたらどうなる？
- Disconnected, Inactive 状態に気づきにくい
- 部屋がユーザーでいっぱいだった時の表示
- Slack のマークダウン
- ステータス表示を洗練させる
- 部屋作成に失敗したらステータス・リミットを表示
- ログアウト or revoke
- HTML と JSON を正しく返し分ける
- 何らかの原因で session user 数 > ブラウザ数になった？
- manager の負荷を減らす
- ua 独立のテスト
- 参加人数が多い時のアイコン表示
- Cloudflare が何らかの原因で 1006 で切断する？
- RateLimit 復活する？
- Firefox と Safari でテキストがややずれる
- デプロイ方法を確認
- GitHub auth のアイコン
- GitHub auth で org を optional に
- GitHub 要らない説
- dev 環境
- updatedAt, updatedBy 要らないかも
- キャプチャ
- 有効期限を表示
- 再接続
- ogp
- コマンドのヘルプ
- HTML のテンプレート化
- object と member の element id が被りうる

メモ：
- logo のフォントは Verdana


## Deploy

未確認

1. Cloudflare アカウントを用意、 Workers と Durable Objects を使える状態にする（有料プラン）
1. wrangler.toml の `account_id` を更新
1. `npm ci`
1. `npx wrangler login`
1. `npx wrangler deploy`
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
