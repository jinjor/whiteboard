import { appendCreateRoomButton, debugging } from "./lib/debug";

(async () => {
  if (debugging) {
    await appendCreateRoomButton(document.body);
  }
})();
