ここを参考
https://github.com/cloudflare/workers-chat-demo
https://github.com/cloudflare/durable-objects-typescript-rollup-esm
https://github.com/cloudflare/durable-objects-template
https://github.com/cloudflare/durable-objects-rollup-esm
https://github.com/cloudflare/durable-objects-webpack-commonjs

仕様
- 1 時間誰も編集しないと部屋の接続が全て切れる
- 1 日経つと部屋が編集不可になる(deactivate)
- 1 週間経つと部屋が消える
- active な部屋は同時に 10 個まで
- 部屋に入れる人数は 10 人まで
- 同じ人が複数接続したら最後の接続以外が切れる
  - 同じ人の判定は当初は localstorage で判定
  - 後に GitHub or Slack 認証になる

ページ
- /
- /rooms/{room_id}

API
- POST /api/rooms
- POST? /api/rooms/{room_id}/websocket

WS API
- send { kind: "init" }
- recv { kind: "init", objects: Object[] }
- send/recv { kind: "add", object: { id: string, position: { x: number, y: number } } }
- send/recv { kind: "update", id: string, field: "position", old: { x: number, y: number }, new: { x: number, y: number } }
- send/recv { kind: "update", id: string, field: "text", old: string, new: string }
- send/recv { kind: "remove", id: string }

UI
- draw(drag)
- add text(double click)
- select(ctrl+click or ctrl+drag)
- move(drag) -> unselect
- remove(backspace) -> unselect
- undo(ctrl+Z)
- redo(ctrl+Y)