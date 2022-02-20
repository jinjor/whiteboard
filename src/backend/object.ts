import {
  RequestEvent,
  Objects,
  Object_,
  ResponseEvent,
  ObjectBody,
  RequestEventBody,
} from "../schema";
import deepEqual from "deep-equal";
import { Validator } from "@cfworker/json-schema";
// @ts-ignore
import schemaJson from "../schema.json";

const eventValidator = new Validator(schemaJson.definitions.RequestEventBody);
export function validateEvent(event: any): event is RequestEventBody {
  const result = eventValidator.validate(event);
  return result.valid;
}
const objectValidator = new Validator(schemaJson.definitions.Object_);
function validateObject(object: any): object is Object_ {
  const result = objectValidator.validate(object);
  return result.valid;
}

export class InvalidEvent extends Error {}

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
    case "patch": {
      const objectId = event.id;
      if (objects[objectId] == null) {
        console.log(objects);
        break;
      }
      const oldObject: ObjectBody = { ...objects[objectId] };
      const oldValue = (oldObject as any)[event.key];
      if (oldValue == null) {
        throw new InvalidEvent();
      }
      if (!deepEqual(oldValue, event.value.old)) {
        console.log(oldObject, event.value.old);
        break;
      }
      const newObject = {
        ...oldObject,
        [event.key]: event.value.new,
        lastEditedAt: event.uniqueTimestamp,
        lastEditedBy: event.requestedBy,
      };
      if (!validateObject(newObject)) {
        throw new InvalidEvent();
      }
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
