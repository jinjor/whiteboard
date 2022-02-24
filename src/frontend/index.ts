import * as api from "./api";

(async () => {
  if (location.protocol === "http:") {
    const button = document.createElement("button");
    button.textContent = "Create Room for Debug";
    button.onclick = async () => {
      const roomInfo = await api.createRoom();
      if (roomInfo != null) {
        location.href = "/rooms/" + roomInfo.id;
      }
    };
    document.body.append(button);
  }
})();
