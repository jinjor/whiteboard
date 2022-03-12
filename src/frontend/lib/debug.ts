export const debugging = () => window.location.protocol === "http:";
export const testing = () => window.location.hostname === "example.com";
import { api } from "./api";

export async function appendCreateRoomButton(
  parent: HTMLElement
): Promise<void> {
  const div = document.createElement("div");
  const button = document.createElement("button");
  button.textContent = "Create a room for debugging";
  button.onclick = async () => {
    const roomInfo = await api.createRoom();
    if (roomInfo != null) {
      window.location.href = "/rooms/" + roomInfo.id;
    }
  };
  div.append(button);
  parent.append(div);
}
