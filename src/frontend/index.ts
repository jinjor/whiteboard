import * as api from "./api";

(async () => {
  if (location.protocol === "http:") {
    const button = document.createElement("button");
    button.textContent = "Create Room for Debug";
    button.onclick = async () => {
      const roomId = await api.createRoom();
      if (roomId != null) {
        location.href = "/rooms/" + roomId;
      }
    };
    document.body.append(button);
  }
})();
