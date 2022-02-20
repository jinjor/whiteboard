import { ResponseEvent } from "../schema";

(async () => {
  const hostName = window.location.host || "edge-chat-demo.jinjor.workers.dev";

  const splitted = window.location.pathname.split("/");
  switch (splitted[1]) {
    case "rooms":
      const roomName = splitted[2];
      if (!roomName) {
        addLog("Not a room.");
        return;
      }
      addLog("Fetching room...");
      const res = await fetch("/api/rooms/" + roomName);
      if (res.status !== 200) {
        const errMessage = await res.text();
        addLog("Room not found: " + roomName);
        addLog(res.status + " " + errMessage);
        if (location.hostname === "localhost") {
          const button = document.createElement("button");
          button.textContent = "Create Room for Debug";
          button.onclick = async () => {
            const res = await fetch("/api/rooms/", {
              method: "POST",
            });
            if (res.status !== 200) {
              const errMessage = await res.text();
              addLog("Failed to create room: " + roomName);
              return;
            }
            const roomName_ = await res.text();
            location.href = "/rooms/" + roomName_;
          };
          document.body.append(button);
        }
        return;
      }
      addLog("Found room: " + roomName);
      join(hostName, roomName);
      break;
    default:
      addLog("Not a room.");
      break;
  }
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
        id: String(Date.now()).padStart(32, "0"),
        message: "clicked",
      })
    );
  }
};
