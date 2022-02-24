import {
  ObjectBody,
  ObjectId,
  PathBody,
  RequestEventBody,
  RoomInfo,
  TextBody,
} from "../../schema";

export async function getRoomInfo(roomId: string): Promise<RoomInfo | null> {
  const res = await fetch("/api/rooms/" + roomId);
  if (res.status !== 200) {
    return null;
  }
  const roomInfo = await res.json();
  return roomInfo;
}

export async function createRoom(): Promise<RoomInfo | null> {
  const res = await fetch("/api/rooms/", {
    method: "POST",
  });
  if (res.status !== 200) {
    return null;
  }
  return await res.json();
}

export function send(websocket: WebSocket, event: RequestEventBody): void {
  websocket.send(JSON.stringify(event));
}

export function makeAddObjectEvent(object: ObjectBody): RequestEventBody {
  return {
    kind: "add",
    object,
  };
}
export function makeDeleteObjectEvent(object: ObjectBody): RequestEventBody {
  return {
    kind: "delete",
    object,
  };
}
export function makePatchObjectEventFromText<K extends keyof TextBody>(
  id: ObjectId,
  key: K & string,
  value: { old: TextBody[K]; new: TextBody[K] }
): RequestEventBody {
  return {
    kind: "patch",
    id,
    key,
    value,
  };
}
export function makePatchObjectEventFromPath<K extends keyof PathBody>(
  id: ObjectId,
  key: K & string,
  value: { old: PathBody[K]; new: PathBody[K] }
): RequestEventBody {
  return {
    kind: "patch",
    id,
    key,
    value,
  };
}
