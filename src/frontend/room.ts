import { ResponseEvent } from "../schema";

(async () => {
  const hostName = window.location.host;
  const splitted = window.location.pathname.split("/");
  const roomName = splitted[2];
  addLog("Fetching room...");
  const res = await fetch("/api/rooms/" + roomName);
  if (res.status !== 200) {
    const errMessage = await res.text();
    addLog("Room not found: " + roomName);
    addLog(res.status + " " + errMessage);
    return;
  }
  addLog("Found room: " + roomName);
  join(hostName, roomName);
})();

let currentWebSocket: WebSocket;
function join(hostName: string, roomName: string) {
  const ws = new WebSocket(
    // TODO: wss に
    // "wss://" + hostName + "/api/rooms/" + roomName + "/websocket"
    "ws://" + hostName + "/api/rooms/" + roomName + "/websocket"
  );
  ws.addEventListener("open", (event) => {
    currentWebSocket = ws;
  });
  ws.addEventListener("message", (event) => {
    const data: ResponseEvent = JSON.parse(event.data);
    addLog(JSON.stringify(data));
  });
  ws.addEventListener("close", (event) => {
    addLog("WebSocket closed: " + event.code + " " + event.reason);
    // TODO: rejoin
  });
  ws.addEventListener("error", (event) => {
    console.log("WebSocket error:", event);
    // TODO: rejoin
  });
}
function addLog(message: string) {
  const div = document.createElement("div");
  div.innerText = message;
  document.body.append(div);
}

document.body.onclick = () => {
  if (currentWebSocket) {
    currentWebSocket.send(
      JSON.stringify({
        kind: "add",
        object: {
          id: String(Date.now()).padStart(32, "0"),
          kind: "text",
          text: "foo",
          position: { x: 0, y: 0 },
        },
      })
    );
  }
};
