import { RequestEvent, ObjectId, Object_, ResponseEvent } from "./schema";

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
  }
  return events;
}
