import {
  Object_,
  ObjectId,
  Objects,
  Path,
  RequestEventBody,
  RoomInfo,
  Text,
} from "../../schema";

export const api = {
  getRoomInfo,
  getObjects,
  createRoom,
  createWebsocket,
  send,
};
export type API = typeof api;

async function getRoomInfo(roomId: string): Promise<RoomInfo | null> {
  const res = await fetch("/api/rooms/" + roomId);
  if (res.status !== 200) {
    return null;
  }
  const roomInfo = await res.json();
  return roomInfo;
}

async function getObjects(roomId: string): Promise<Objects | null> {
  const res = await fetch("/api/rooms/" + roomId + "/objects");
  if (res.status !== 200) {
    return null;
  }
  const objects = await res.json();
  return objects;
}

async function createRoom(): Promise<RoomInfo | null> {
  const res = await fetch("/api/rooms/", {
    method: "POST",
  });
  if (res.status !== 200) {
    return null;
  }
  return await res.json();
}

function createWebsocket(wsRoot: string, roomId: string): WebSocket {
  return new WebSocket(`${wsRoot}/api/rooms/${roomId}/websocket`);
}

function send(websocket: WebSocket, event: RequestEventBody): void {
  websocket.send(JSON.stringify(event));
}

export function makeAddObjectEvent(object: Object_): RequestEventBody {
  return {
    kind: "add",
    object,
  };
}
export function makeDeleteObjectEvent(object: Object_): RequestEventBody {
  return {
    kind: "delete",
    object,
  };
}
export function makePatchObjectEventFromText<K extends keyof Text>(
  id: ObjectId,
  key: K & string,
  value: { old: Text[K]; new: Text[K] }
): RequestEventBody {
  return {
    kind: "patch",
    id,
    key,
    value,
  };
}
export function makePatchObjectEventFromPath<K extends keyof Path>(
  id: ObjectId,
  key: K & string,
  value: { old: Path[K]; new: Path[K] }
): RequestEventBody {
  return {
    kind: "patch",
    id,
    key,
    value,
  };
}
