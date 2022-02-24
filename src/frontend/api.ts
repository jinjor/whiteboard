import {
  ObjectBody,
  ObjectId,
  PathBody,
  RequestEventBody,
  RoomId,
  RoomInfo,
  TextBody,
} from "../schema";

export async function getRoomInfo(roomId: string): Promise<RoomInfo | null> {
  const res = await fetch("/api/rooms/" + roomId);
  if (res.status !== 200) {
    return null;
  }
  const roomInfo = await res.json();
  return roomInfo;
}

export async function createRoom(): Promise<RoomId | null> {
  const res = await fetch("/api/rooms/", {
    method: "POST",
  });
  if (res.status !== 200) {
    return null;
  }
  return await res.text();
}

function send(websocket: WebSocket, event: RequestEventBody): void {
  websocket.send(JSON.stringify(event));
}

export function addObject(websocket: WebSocket, object: ObjectBody): void {
  send(websocket, {
    kind: "add",
    object,
  });
}
export function deleteObject(websocket: WebSocket, object: ObjectBody): void {
  send(websocket, {
    kind: "delete",
    object,
  });
}
export function patchText<K extends keyof TextBody>(
  websocket: WebSocket,
  id: ObjectId,
  key: K & string,
  value: { old: TextBody[K]; new: TextBody[K] }
): void {
  send(websocket, {
    kind: "patch",
    id,
    key,
    value,
  });
}
export function patchPath<K extends keyof PathBody>(
  websocket: WebSocket,
  id: ObjectId,
  key: K & string,
  value: { old: PathBody[K]; new: PathBody[K] }
): void {
  send(websocket, {
    kind: "patch",
    id,
    key,
    value,
  });
}
