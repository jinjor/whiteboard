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
  - 選択がある状態で他人がドラッグした後に自分がドラッグすると選択開始した場所からドラッグされる => ドラッグ開始時点で位置をとるべき
    - その状態でドラッグするとコンフリクトするが、自分の画面は戻らない
  - 選択中にオブジェクトが移動されたり消されたらどうなる？
  - ドラッグ中のオブジェクトが移動されたり消されたらどうなる？
  - websocket の有無をチェックする必要ある？
- 部屋がユーザーでいっぱいだった時の表示
- Slack のマークダウン
- ステータス表示を洗練させる
- 部屋作成に失敗したらステータス・リミットを表示
- ログアウト or revoke
- HTML と JSON を正しく返し分ける
- 何らかの原因で session user 数 > ブラウザ数になった？
- manager の負荷を減らす
- ua 独立のテスト
- デプロイ方法をドキュメントに書く
- 参加人数が多い時のアイコン表示
- Cloudflare が何らかの原因で 1006 で切断する？
- RateLimit 復活する？
- Firefox と Safari でテキストがややずれる
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