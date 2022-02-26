export const debugging = location.protocol === "http:";
import * as api from "./api";

export async function appendCreateRoomButton(
  parent: HTMLElement
): Promise<void> {
  const div = document.createElement("div");
  const button = document.createElement("button");
  button.textContent = "Create a room for debugging";
  button.onclick = async () => {
    const roomInfo = await api.createRoom();
    if (roomInfo != null) {
      location.href = "/rooms/" + roomInfo.id;
    }
  };
  div.append(button);
  parent.append(div);
}
