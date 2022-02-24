import {
  ObjectBody,
  ObjectId,
  PathBody,
  RequestEventBody,
  TextBody,
} from "../schema";

export async function isRoomPresent(roomId: string): Promise<boolean> {
  const res = await fetch("/api/rooms/" + roomId);
  const roomExists = res.status === 200;
  if (!roomExists) {
    const errorMessage = await res.text();
    console.log(errorMessage);
  }
  return res.status === 200;
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
