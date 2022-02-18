import { Event_, ObjectId, Object_, ResponseEvent } from "./schema";

type Objects = Record<ObjectId, Object_>;

export function applyEvent(
  event: Event_,
  objects: Objects
): { event: ResponseEvent; to: "self" | "others" }[] {
  switch (event.kind) {
    case "add": {
    }
  }
  return [];
}
