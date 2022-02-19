import {
  RequestEvent,
  ObjectId,
  Object_,
  ResponseEvent,
  ObjectBody,
} from "./schema";
import deepEqual from "deep-equal";

export type Objects = Record<ObjectId, Object_>;

export function applyEvent(
  event: RequestEvent,
  objects: Objects
): { event: ResponseEvent; to: "self" | "others" }[] {
  const events: ReturnType<typeof applyEvent> = [];
  switch (event.kind) {
    case "add": {
      if (objects[event.object.id] != null) {
        break;
      }
      const newObject = {
        ...event.object,
        lastEditedAt: event.uniqueTimestamp,
        lastEditedBy: event.requestedBy,
      };
      objects[newObject.id] = newObject;
      events.push({
        event: {
          kind: "upsert",
          object: newObject,
        },
        to: "others",
      });
      break;
    }
    case "delete": {
      const objectId = event.object.id;
      if (objects[objectId] == null) {
        console.log(objects);
        break;
      }
      const oldObject: ObjectBody = { ...objects[objectId] };
      delete (oldObject as any).lastEditedAt;
      delete (oldObject as any).lastEditedBy;
      if (!deepEqual(oldObject, event.object)) {
        console.log(oldObject, event.object);
        break;
      }
      delete objects[objectId];
      events.push({
        event: {
          kind: "delete",
          id: objectId,
        },
        to: "others",
      });
      break;
    }
  }
  return events;
}
